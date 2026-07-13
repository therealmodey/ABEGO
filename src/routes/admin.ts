// Admin API — every route double-guarded (requireAuth + requireAdmin, role re-checked in DB)
import { Hono } from 'hono'
import {
  type AppEnv, requireAuth, requireAdmin, rateLimit,
  logAudit, clientIp, cacheGet, cacheSet, cacheDel,
} from '../lib/middleware'

const admin = new Hono<AppEnv>()
admin.use('*', requireAuth)
admin.use('*', requireAdmin)
admin.use('*', rateLimit(120, 60, 'admin')) // rate-limit sensitive surface

// ---------- Users management ----------
admin.get('/users', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const limit = 20, offset = (page - 1) * limit

  const where = q ? "WHERE u.email LIKE ? AND u.status != 'deleted'" : "WHERE u.status != 'deleted'"
  const binds = q ? [`%${q}%`] : []

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.role, u.status, u.created_at, p.display_name,
              (SELECT plan FROM subscriptions WHERE user_id = u.id AND status = 'active' ORDER BY id DESC LIMIT 1) AS plan,
              (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND completed = 1) AS sessions
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
       ${where} ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    ).bind(...binds).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(...binds).first<{ n: number }>(),
  ])
  return c.json({ users: rows.results, total: total?.n ?? 0, page, pages: Math.ceil((total?.n ?? 0) / limit) })
})

// PUT /api/admin/users/:id/role { role: 'user'|'admin' }
admin.put('/users/:id/role', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const { role } = await c.req.json().catch(() => ({}))
  if (!['user', 'admin'].includes(role)) return c.json({ error: 'Invalid role' }, 400)
  if (id === me.sub) return c.json({ error: 'You cannot change your own role.' }, 400)

  const target = await c.env.DB.prepare('SELECT id, role, email FROM users WHERE id = ?').bind(id).first<{ id: number; role: string; email: string }>()
  if (!target) return c.json({ error: 'User not found' }, 404)

  // Safety: never demote the last remaining admin
  if (target.role === 'admin' && role === 'user') {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").first<{ n: number }>()
    if ((admins?.n ?? 0) <= 1) return c.json({ error: 'Cannot demote the last admin account.' }, 400)
  }

  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run()
  await logAudit(c.env.DB, me.sub, 'role_change', 'user', id, { from: target.role, to: role, email: target.email }, clientIp(c))
  return c.json({ ok: true })
})

// PUT /api/admin/users/:id/status { status: 'active'|'suspended' }
admin.put('/users/:id/status', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const { status } = await c.req.json().catch(() => ({}))
  if (!['active', 'suspended'].includes(status)) return c.json({ error: 'Invalid status' }, 400)
  if (id === me.sub) return c.json({ error: 'You cannot suspend yourself.' }, 400)

  const target = await c.env.DB.prepare('SELECT role, email FROM users WHERE id = ?').bind(id).first<{ role: string; email: string }>()
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.role === 'admin' && status === 'suspended') return c.json({ error: 'Admin accounts cannot be suspended. Demote first.' }, 400)

  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run()
  await logAudit(c.env.DB, me.sub, status === 'suspended' ? 'suspend_user' : 'reactivate_user', 'user', id, { email: target.email }, clientIp(c))
  return c.json({ ok: true })
})

// DELETE /api/admin/users/:id — soft delete; admin accounts protected
admin.delete('/users/:id', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  if (id === me.sub) return c.json({ error: 'You cannot delete your own account.' }, 400)

  const target = await c.env.DB.prepare('SELECT role, email FROM users WHERE id = ?').bind(id).first<{ role: string; email: string }>()
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.role === 'admin') return c.json({ error: 'Admin accounts cannot be deleted. Demote to user first.' }, 400)

  await c.env.DB.prepare("UPDATE users SET status = 'deleted', email = email || '.deleted.' || id WHERE id = ?").bind(id).run()
  await logAudit(c.env.DB, me.sub, 'delete_user', 'user', id, { email: target.email }, clientIp(c))
  return c.json({ ok: true })
})

// ---------- Analytics (cached 30s) ----------
admin.get('/analytics', async (c) => {
  const cached = cacheGet<object>('admin:analytics')
  if (cached) return c.json(cached)

  const [users, sessions, revenue, plans, signups, recentActivity] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
              SUM(CASE WHEN created_at > datetime('now','-7 days') THEN 1 ELSE 0 END) AS new_this_week
       FROM users WHERE status != 'deleted'`
    ).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN started_at > datetime('now','-24 hours') THEN 1 ELSE 0 END) AS last_24h,
              ROUND(AVG(CASE WHEN completed = 1 THEN calm_score END)) AS avg_calm
       FROM sessions`
    ).first(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount_cents ELSE 0 END),0) AS usd_cents,
              COALESCE(SUM(CASE WHEN currency = 'NGN' THEN amount_cents ELSE 0 END),0) AS ngn_kobo,
              COUNT(*) AS payments
       FROM payments WHERE status = 'succeeded'`
    ).first(),
    c.env.DB.prepare(
      `SELECT plan, COUNT(*) AS n FROM subscriptions WHERE status = 'active' GROUP BY plan`
    ).all(),
    c.env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n FROM users WHERE created_at > datetime('now','-14 days') GROUP BY day ORDER BY day`
    ).all(),
    c.env.DB.prepare(
      `SELECT a.action, a.created_at, u.email FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 15`
    ).all(),
  ])

  const payload = { users, sessions, revenue, plans: plans.results, signups: signups.results, recentActivity: recentActivity.results }
  cacheSet('admin:analytics', payload, 30)
  return c.json(payload)
})

// ---------- Audit + activity logs ----------
admin.get('/audit-logs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT al.id, al.action, al.target_type, al.target_id, al.detail_json, al.ip, al.created_at, u.email AS admin_email
     FROM audit_logs al JOIN users u ON u.id = al.admin_id ORDER BY al.created_at DESC LIMIT 100`
  ).all()
  return c.json({ logs: results })
})

admin.get('/activity-logs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.meta_json, a.ip, a.created_at, u.email
     FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 100`
  ).all()
  return c.json({ logs: results })
})

// ---------- Content management (programs) ----------
admin.get('/programs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM programs ORDER BY sort_order').all()
  return c.json({ programs: results })
})

admin.put('/programs/:id', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const b = await c.req.json().catch(() => ({}))
  const fields: string[] = [], vals: unknown[] = []
  if (typeof b.title === 'string') { fields.push('title = ?'); vals.push(b.title.slice(0, 80)) }
  if (typeof b.is_premium === 'boolean') { fields.push('is_premium = ?'); vals.push(b.is_premium ? 1 : 0) }
  if (typeof b.active === 'boolean') { fields.push('active = ?'); vals.push(b.active ? 1 : 0) }
  if (typeof b.is_new === 'boolean') { fields.push('is_new = ?'); vals.push(b.is_new ? 1 : 0) }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400)

  await c.env.DB.prepare(`UPDATE programs SET ${fields.join(', ')} WHERE id = ?`).bind(...vals, id).run()
  cacheDel('programs:')
  await logAudit(c.env.DB, me.sub, 'content_edit', 'program', id, b, clientIp(c))
  return c.json({ ok: true })
})

export default admin
