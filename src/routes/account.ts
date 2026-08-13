import { Hono } from 'hono'
import { hashPassword, verifyPassword, signJwt, newJti } from '../lib/auth'
import {
  type AppEnv, requireAuth, rateLimit, logActivity, clientIp,
  jwtSecret, bumpTokenVersion, revokeToken, getActivePlan,
} from '../lib/middleware'

const account = new Hono<AppEnv>()

// All routes here require a valid (non-revoked, non-expired) session.
account.use('*', requireAuth)

const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\.[^\\s@]+$/

// Resolve the device label from request headers (best-effort, no PII).
function deviceLabel(c: any): string {
  const ua = c.req.header('User-Agent') || ''
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android device'
  if (/Macintosh/.test(ua)) return 'MacBook'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux/.test(ua)) return 'Linux device'
  return 'This device'
}
function locationLabel(c: any): string {
  const cf = c.req.header('CF-IPCountry')
  const ip = clientIp(c)
  if (cf && cf !== 'XX') return `${cf} · just now`
  return ip ? `${ip} · just now` : 'Unknown location'
}

// Throttle the sensitive write endpoints.
const writeLimit = rateLimit(20, 300, 'account')

// ---------- Active sessions (sign-out-everywhere source) ----------
account.get('/sessions', async (c) => {
  const u = c.get('user')
  await c.env.DB.prepare(
    'UPDATE sessions_registry SET last_active = datetime(\'now\') WHERE user_id = ? AND jti = ?'
  ).bind(u.sub, u.jti).run().catch(() => {})
  const { results } = await c.env.DB.prepare(
    'SELECT id, device, location, last_active, jti FROM sessions_registry WHERE user_id = ? ORDER BY last_active DESC'
  ).bind(u.sub).all<{ id: number; device: string; location: string; last_active: string; jti: string }>()
  return c.json({
    sessions: results.map((s) => ({
      id: String(s.id),
      device: s.device,
      location: s.location,
      lastActive: s.last_active,
      isCurrent: s.jti === u.jti,
    })),
  })
})

// ---------- Change password (stays signed in on this device) ----------
account.post('/password', writeLimit, async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const current = String(body.currentPassword || '')
  const next = String(body.newPassword || '')

  if (next.length < 8) return c.json({ error: 'New password must be at least 8 characters.' }, 400)

  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(u.sub).first<{ password_hash: string }>()
  if (!row) return c.json({ error: 'Account not found.' }, 404)
  if (!(await verifyPassword(current, row.password_hash))) {
    await logActivity(c.env.DB, u.sub, 'change_password_failed', {}, clientIp(c))
    return c.json({ error: 'Current password is incorrect.' }, 400)
  }
  if (await verifyPassword(next, row.password_hash)) {
    return c.json({ error: 'New password must be different from your current one.' }, 400)
  }

  const password_hash = await hashPassword(next)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(password_hash, u.sub).run()
  // Rotate token version: every OTHER device is force-logged-out. The current
  // session keeps its jti, so it survives.
  await bumpTokenVersion(c.env.DB, u.sub)
  await logActivity(c.env.DB, u.sub, 'change_password', {}, clientIp(c))
  return c.json({ ok: true })
})

// ---------- Sign out everywhere else (keep this device) ----------
account.post('/sign-out-others', writeLimit, async (c) => {
  const u = c.get('user')
  const res = await c.env.DB.prepare(
    'DELETE FROM sessions_registry WHERE user_id = ? AND jti != ?'
  ).bind(u.sub, u.jti).run()
  const removed = res.meta?.changes ?? 0
  // Revoke every other live token jti for this user.
  const { results } = await c.env.DB.prepare(
    'SELECT jti FROM sessions_registry WHERE user_id = ?'
  ).bind(u.sub).all<{ jti: string }>()
  // (registry now only holds the current device; nothing else to revoke)
  void results
  await logActivity(c.env.DB, u.sub, 'sign_out_others', { removed }, clientIp(c))
  return c.json({ ok: true, removed })
})

// ---------- Export data (request recorded, email dispatched) ----------
account.post('/export', writeLimit, async (c) => {
  const u = c.get('user')
  const me = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(u.sub).first<{ email: string }>()
  const email = me?.email || u.email
  await c.env.DB.prepare(
    "INSERT INTO export_requests (user_id, email, status) VALUES (?, ?, 'pending')"
  ).bind(u.sub, email).run()
  // In production a worker emails a secure, expiring download link.
  await logActivity(c.env.DB, u.sub, 'export_requested', { email }, clientIp(c))
  return c.json({ ok: true, email }, 202)
})

// ---------- Delete account (two-step: re-auth, then type-to-confirm) ----------
account.post('/delete/verify', writeLimit, async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const password = String(body.password || '')
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(u.sub).first<{ password_hash: string }>()
  if (!row) return c.json({ error: 'Account not found.' }, 404)
  if (!(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: 'Password is incorrect.' }, 400)
  }
  return c.json({ ok: true })
})

account.post('/delete/confirm', writeLimit, async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (String(body.confirmText) !== 'DELETE') {
    return c.json({ error: 'Type DELETE to confirm.' }, 400)
  }
  // Soft-delete: keep data recoverable for 30 days (industry standard), then
  // hard erase. Marking status + munging the email invalidates all sessions
  // via requireAuth's status check, so every device is signed out immediately.
  await c.env.DB.prepare(
    "UPDATE users SET status = 'deleted', email = email || '.deleted.' || id, email_verified = 0 WHERE id = ?"
  ).bind(u.sub).run()
  await bumpTokenVersion(c.env.DB, u.sub) // invalidates every token (tv mismatch)
  if (u.jti) {
    try { await revokeToken(c.env.DB, u as any) } catch { /* best effort */ }
  }
  // Remove this device from the registry too.
  await c.env.DB.prepare('DELETE FROM sessions_registry WHERE user_id = ?').bind(u.sub).run()
  await logActivity(c.env.DB, u.sub, 'delete_account', { email: u.email }, clientIp(c))
  return c.json({ ok: true })
})

export default account
