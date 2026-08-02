// Admin API — every route double-guarded (requireAuth + requireAdmin, role re-checked in DB)
import { Hono } from 'hono'
import {
  type AppEnv, requireAuth, requireAdmin, rateLimit,
  logAudit, clientIp, cacheGet, cacheSet, cacheDel, jwtSecret,
} from '../lib/middleware'
import { signJwt, hashPassword } from '../lib/auth'
import { getAiConfig } from '../lib/aiconfig'

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

  const [users, sessions, revenue, plans, signups, recentActivity, sessionsByDay, programPerf, liveSessions] = await Promise.all([
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
    // Sessions × calm score per day — powers the main overview chart (additive)
    c.env.DB.prepare(
      `SELECT date(started_at) AS day, COUNT(*) AS n,
              ROUND(AVG(CASE WHEN completed = 1 THEN calm_score END)) AS avg_calm
       FROM sessions WHERE started_at > datetime('now','-14 days') GROUP BY day ORDER BY day`
    ).all(),
    // Program performance — usage, completion %, avg calm delta per program (additive)
    c.env.DB.prepare(
      `SELECT p.id, p.title, p.category, p.tag, p.phase, p.duration_min, p.is_premium,
              COUNT(s.id) AS starts,
              SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END) AS completions,
              ROUND(AVG(CASE WHEN s.completed = 1 THEN s.calm_delta END), 1) AS avg_calm_delta,
              ROUND(AVG(CASE WHEN s.completed = 1 THEN s.consistency END)) AS avg_consistency
       FROM programs p LEFT JOIN sessions s ON s.program_id = p.id
       WHERE p.active = 1 GROUP BY p.id ORDER BY starts DESC`
    ).all(),
    // In-flight sessions (started, not completed, < 30 min old) — mission-control style (additive)
    c.env.DB.prepare(
      `SELECT s.id, s.pattern, s.inhale, s.hold, s.exhale, s.cycles_planned, s.mood_before, s.started_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.completed = 0 AND s.started_at > datetime('now','-30 minutes')
       ORDER BY s.started_at DESC LIMIT 12`
    ).all(),
  ])

  const payload = {
    users, sessions, revenue, plans: plans.results, signups: signups.results, recentActivity: recentActivity.results,
    sessionsByDay: sessionsByDay.results, programPerf: programPerf.results, liveSessions: liveSessions.results,
  }
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

// ==========================================================================
// SCC (Super Command Centre) module data — integration-ready endpoints.
//
// SCHEMA CONTRACT (per design handoff /tmp/handoff3):
//   GET /admin/scc/overview      → { retention:{d1,d3,d7,d30}, aiEvents[], geo:{pings[],live}, systemPulse[] }
//   GET /admin/scc/live          → { stats:{live,inhaling,holding,exhaling,flagged}, timeline[], phaseDist[], anomalies[], sessions[] }
//   GET /admin/scc/ai            → { model:{version,status}, kpis, sliders[], flags[], preview, rollout, effectiveness:{a[],b[]} }
//   GET /admin/scc/biometrics    → { kpis, hr:{start[],end[],labels[]}, segments[], heatmap[7][24], arc:{milestones[]}, hrv }
//   GET /admin/scc/experiments   → { kpis, featured, rows[] }
//   GET /admin/scc/notifications → { kpis, rules[] }
//   GET /admin/scc/revenue       → { kpis, mrr:{months[]}, planMix, funnel[], ltv:{cohorts[]} }
//   GET /admin/scc/health        → { banner, kpis, latency:{p50[],p95[],p99[]}, services[], sensory, devices[], incidents[] }
//   GET /admin/scc/analytics     → { kpis, cohorts[], funnel[], dropoff[], scatter[] }
//   PUT /admin/scc/ai            → accepts { sliders?, flags? }  (stub: audit-logged, persistence wired later)
//   PUT /admin/scc/notifications/:id → accepts { enabled }      (stub: audit-logged, persistence wired later)
//
// All numeric series are DETERMINISTIC (genLine formula from handoff) so UI
// renders stably across reloads. Real telemetry pipelines replace these later.
// ==========================================================================
const genLine = (n: number, base: number, vari: number, drift = 0) =>
  Array.from({ length: n }, (_, i) =>
    Math.round((base + Math.sin(i * 0.6) * vari * 0.5 + i * drift + Math.cos(i * 1.1) * vari * 0.3) * 10) / 10)

const heatGrid = () => {
  const g: number[][] = []
  for (let d = 0; d < 7; d++) {
    const row: number[] = []
    for (let h = 0; h < 24; h++) {
      const peakAM = Math.exp(-Math.pow((h - 8) / 3, 2))
      const peakPM = Math.exp(-Math.pow((h - 20) / 3, 2))
      let v = (peakAM * 0.7 + peakPM) * (0.75 + 0.25 * Math.sin(d * 1.3 + h * 0.35))
      if (d === 0 || d === 6) v *= 0.7
      row.push(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100)
    }
    g.push(row)
  }
  return g
}

const SCC_DATA: Record<string, (n?: number) => unknown> = {
  overview: () => ({
    retention: { pct: 62, bars: [{ l: 'D1', v: 94 }, { l: 'D3', v: 78 }, { l: 'D7', v: 62 }, { l: 'D30', v: 41 }] },
    aiEvents: [
      { t: 'Pattern shifted', d: '4·7·8 → 4·4·6 for anxious cohort', ago: '2m', c: 'violet' },
      { t: 'Stress spike detected', d: '146 users flagged · EU-C', ago: '11m', c: 'amber' },
      { t: 'Auto-cooldown applied', d: 'Notification pressure reduced 14%', ago: '24m', c: 'cyan' },
      { t: 'Weight learned', d: 'HR influence ↑ 0.72 for wearable users', ago: '42m', c: 'green' },
    ],
    geo: { live: 142, pings: Array.from({ length: 16 }, (_, i) => ({ x: 60 + ((i * 137) % 580), y: 40 + ((i * 89) % 160), hot: i % 5 === 0 })) },
    systemPulse: [
      { name: 'API', ms: 82, load: 0.42, ok: true }, { name: 'AI inference', ms: 134, load: 0.58, ok: true },
      { name: 'Audio CDN', ms: 210, load: 0.74, ok: false }, { name: 'WebSocket', ms: 18, load: 0.31, ok: true },
      { name: 'Realtime DB', ms: 46, load: 0.39, ok: true },
    ],
  }),
  live: (n = 12) => ({
    stats: { live: 142, inhaling: 48, holding: 31, exhaling: 58, flagged: 5 },
    timeline: genLine(Math.max(8, Math.min(n, 24)), 120, 30, 2).map((v) => Math.round(v)),
    phaseDist: [{ l: 'Inhale', v: 34, c: '#60A5FA' }, { l: 'Hold', v: 22, c: '#A78BFA' }, { l: 'Exhale', v: 41, c: '#34D399' }, { l: 'Rest', v: 3, c: '#64748B' }],
    anomalies: [
      { t: 'High stress cluster', d: '5 users · IN-BLR', ago: 'now', sev: 'amber' },
      { t: 'Session drop-off', d: '11 exits at cycle 2 · 4-7-8', ago: '1m', sev: 'amber' },
      { t: 'Audio failure', d: 'iOS 26 · 0.4% affected', ago: '3m', sev: 'red' },
    ],
    sessions: [
      { name: 'Maya O.', sid: 'ses_74a2', region: 'NYC', pattern: '4-7-8', phase: 'inhale', stress: 0.62, calm: 74, hr: 62, dur: '4:12', hot: false },
      { name: 'Priya S.', sid: 'ses_91bc', region: 'Mumbai', pattern: '4-7-8', phase: 'hold', stress: 0.81, calm: 42, hr: 78, dur: '1:44', hot: true },
      { name: 'Jonas K.', sid: 'ses_3fe1', region: 'Berlin', pattern: 'Box', phase: 'exhale', stress: 0.34, calm: 81, hr: 58, dur: '6:03', hot: false },
      { name: 'Aiko T.', sid: 'ses_bb02', region: 'Tokyo', pattern: '4-4-4', phase: 'inhale', stress: 0.48, calm: 68, hr: 64, dur: '2:51', hot: false },
      { name: 'Leo M.', sid: 'ses_c4d9', region: 'SF', pattern: '5-0-5', phase: 'exhale', stress: 0.29, calm: 86, hr: 55, dur: '7:18', hot: false },
      { name: 'Sara B.', sid: 'ses_08aa', region: 'London', pattern: '4-7-8', phase: 'hold', stress: 0.74, calm: 51, hr: 72, dur: '0:58', hot: true },
      { name: 'Omar F.', sid: 'ses_5e77', region: 'Dubai', pattern: 'Box', phase: 'rest', stress: 0.41, calm: 77, hr: 60, dur: '5:22', hot: false },
      { name: 'Nina R.', sid: 'ses_d210', region: 'Oslo', pattern: '4-2-6', phase: 'inhale', stress: 0.55, calm: 63, hr: 66, dur: '3:07', hot: false },
      { name: 'Kai W.', sid: 'ses_66f3', region: 'Sydney', pattern: '4-4-6', phase: 'exhale', stress: 0.38, calm: 79, hr: 59, dur: '4:49', hot: false },
    ],
  }),
  ai: (n = 30) => ({
    model: { version: 'aura-2.4.1', status: 'Stable' },
    kpis: { adaptations: 42180, effectiveness: 0.82, latencyMs: 134 },
    sliders: [
      { id: 'stress_sensitivity', label: 'Stress sensitivity', desc: 'How quickly patterns shift under detected stress', v: 0.68, c: '#F59E0B', hint: 'Aggressive' },
      { id: 'adaptation_speed', label: 'Adaptation speed', desc: 'Rate of pattern transition between cycles', v: 0.45, c: '#8B5CF6', hint: 'Balanced' },
      { id: 'hr_weight', label: 'HR weight', desc: 'Influence of heart-rate signal on decisions', v: 0.72, c: '#22D3EE', hint: 'Physio-first' },
      { id: 'history_weight', label: 'History weight', desc: 'Weight of past-session outcomes', v: 0.34, c: '#60A5FA', hint: 'Present-focused' },
      { id: 'exploration', label: 'Exploration ε', desc: 'Chance of trying non-optimal patterns to learn', v: 0.12, c: '#34D399', hint: 'Conservative' },
    ],
    flags: [
      { id: 'auto_pacing', label: 'Auto-adaptive pacing', sub: 'Live pattern changes mid-session', on: true, exp: false },
      { id: 'hrv_coherence', label: 'HRV coherence detection', sub: 'Requires wearable · 12% of users', on: true, exp: false },
      { id: 'cross_session', label: 'Cross-session learning', sub: 'Personal model persists between sessions', on: true, exp: false },
      { id: 'emotion_ambience', label: 'Emotion-aware ambience', sub: 'Soundscape reacts to mood signal', on: false, exp: true },
      { id: 'llm_guidance', label: 'LLM-generated guidance', sub: 'Dynamic voice coaching lines', on: false, exp: true },
    ],
    preview: {
      input: [{ k: 'stress', v: '0.72', c: '#F59E0B' }, { k: 'hr_baseline', v: '68 bpm', c: '#22D3EE' }, { k: 'mood', v: '"anxious"', c: '#60A5FA' }, { k: 'history_avg', v: '0.54', c: '#A78BFA' }, { k: 'time_of_day', v: '20:14', c: '#94A3B8' }],
      pattern: [4, 7, 8], confidence: 0.87, fallback: '4·4·6',
    },
    rollout: { pct: 82, users: '34,821 / 42,410', prev: { v: '2.4.0', pct: 16 }, canary: { v: '2.5.0', pct: 2 } },
    effectiveness: { a: genLine(n, 74, 8, 0.3), b: genLine(n, 12, 4, 0.05) },
  }),
  biometrics: () => ({
    kpis: { hrReduction: -8.2, hrvImprovement: 14.6, recovery: '4:12', coherence: 72 },
    hr: {
      start: [76, 74, 78, 82, 80, 76, 74, 72, 74, 72, 70, 68, 66, 64],
      end: [64, 63, 65, 68, 66, 62, 61, 60, 61, 58, 57, 56, 55, 54],
      labels: ['Jul 09', 'Jul 13', 'Jul 17', 'Jul 21'],
    },
    segments: [
      { seg: 'High stress · morning', pattern: '4·2·6', c: '#F59E0B', eff: 68 },
      { seg: 'Anxious · evening', pattern: '4·7·8', c: '#A78BFA', eff: 84 },
      { seg: 'Athletic · post-workout', pattern: '5·0·5', c: '#22D3EE', eff: 72 },
      { seg: 'Insomnia · pre-sleep', pattern: '4·7·8', c: '#7C3AED', eff: 91 },
      { seg: 'General · calm', pattern: '4·4·4', c: '#34D399', eff: 63 },
    ],
    heatmap: heatGrid(), heatSessions: 32140, heatPeak: 'Peak: Tue 8pm · 0.94',
    arc: { milestones: [{ l: 'Start', v: 0.78 }, { l: '1 min', v: 0.62 }, { l: '3 min', v: 0.44 }, { l: '5 min', v: 0.28 }, { l: '8 min', v: 0.16 }] },
    hrv: { pct: 72, users: 2140, rows: [{ l: 'High coherence', v: 46, c: '#34D399' }, { l: 'Moderate', v: 26, c: '#22D3EE' }, { l: 'Low', v: 18, c: '#F59E0B' }, { l: 'Non-coherent', v: 10, c: '#F87171' }] },
  }),
  experiments: () => ({
    kpis: { live: 6, inTests: '42.1k', winning: 8, avgLift: '+9.4%' },
    featured: {
      id: 'exp_039', conf: 99, meta: '21 days · 20,180 users',
      title: 'AI aggression 0.7 vs 0.5', desc: 'Higher adaptation aggression for users with stress > 0.6. Variant B shows significant calm-score lift with no retention cost.',
      rec: 'Recommendation: promote to 100%',
      a: { name: 'A · Control', calm: 62.4, conv: '8.2%', d7: '61%', users: '10,090' },
      b: { name: 'B · Aggression 0.7', calm: 74.6, conv: '12.4%', d7: '66%', users: '10,090' },
      chart: { a: genLine(14, 62, 4, 0.1), b: genLine(14, 66, 4, 0.6), lift: '+12.6%' },
    },
    rows: [
      { id: 'exp_041', name: 'Onboarding: 1 breath before signup', days: 6, status: 'Running', variants: 2, users: '8,420', lift: '+3.1%', conf: 62 },
      { id: 'exp_040', name: 'Evening push copy v3', days: 9, status: 'Running', variants: 3, users: '14,100', lift: '+6.8%', conf: 88 },
      { id: 'exp_039', name: 'AI aggression 0.7 vs 0.5', days: 21, status: 'Winning', variants: 2, users: '20,180', lift: '+12.6%', conf: 99 },
      { id: 'exp_038', name: 'Paywall after 5th session', days: 14, status: 'Winning', variants: 2, users: '11,300', lift: '+9.2%', conf: 96 },
      { id: 'exp_037', name: 'Haptic intensity curve', days: 4, status: 'Paused', variants: 2, users: '3,900', lift: '−0.4%', conf: 22 },
      { id: 'exp_036', name: 'Sleep story narrator B', days: 30, status: 'Complete', variants: 2, users: '18,240', lift: '+4.4%', conf: 94 },
    ],
  }),
  notifications: () => ({
    kpis: { sent: '184k', open: '42.6%', conv: '14.8%', unsub: '0.12%' },
    audience: '~14,200', projOpen: '46%',
    rules: [
      { id: 1, name: 'Evening unwind', trigger: 'stress > 0.7 · 7-10pm', sent: '82,400', open: 48, on: true },
      { id: 2, name: 'Sleep prep', trigger: 'pre-sleep window · no session', sent: '41,800', open: 52, on: true },
      { id: 3, name: 'Morning intent', trigger: 'wake window · streak > 3', sent: '24,600', open: 38, on: true },
      { id: 4, name: 'Streak protect', trigger: 'streak at risk · 8pm', sent: '12,100', open: 61, on: true },
      { id: 5, name: 'Weekly insight', trigger: 'sunday 6pm', sent: '9,400', open: 44, on: true },
      { id: 6, name: 'Program suggestion', trigger: 'AI match > 0.8', sent: '7,200', open: 42, on: true },
      { id: 7, name: 'Comeback', trigger: 'inactive 7d', sent: '5,800', open: 18, on: false },
      { id: 8, name: 'Premium teaser', trigger: 'free · 10+ sessions', sent: '4,100', open: 22, on: false },
    ],
  }),
  revenue: () => ({
    kpis: { mrr: '$142.4k', arpu: '$8.42', ltv: '$62.10', churn: '3.4%' },
    mrr: {
      months: [
        { m: 'Feb', total: 98, nw: 12, exp: 4, ch: 5 }, { m: 'Mar', total: 108, nw: 14, exp: 5, ch: 4 },
        { m: 'Apr', total: 116, nw: 13, exp: 6, ch: 5 }, { m: 'May', total: 124, nw: 15, exp: 6, ch: 4 },
        { m: 'Jun', total: 133, nw: 16, exp: 7, ch: 4 }, { m: 'Jul', total: 142, nw: 17, exp: 8, ch: 3 },
      ],
    },
    planMix: { total: '16.8k', rows: [{ l: 'Yearly', pct: 68, n: '11,420', c: '#8B5CF6' }, { l: 'Monthly', pct: 28, n: '4,700', c: '#22D3EE' }, { l: 'Trial', pct: 4, n: '680', c: '#34D399' }] },
    funnel: [
      { l: 'Paywall seen', v: 24800, c: '#7C3AED' }, { l: 'Plan viewed', v: 14200, c: '#8B5CF6' },
      { l: 'Checkout started', v: 6400, c: '#22D3EE' }, { l: 'Payment entered', v: 4100, c: '#34D399' },
      { l: 'Subscribed', v: 3650, c: '#60A5FA' },
    ],
    insight: 'Users seeing paywall after their 5th session convert at 21.4% vs 8.2% overall. Recommend delaying the paywall trigger.',
    ltv: { labels: ['M0', 'M2', 'M4', 'M6', 'M8', 'M11'], cohorts: [
      { name: 'Jan cohort', c: '#8B5CF6', data: genLine(12, 20, 4, 4.2) },
      { name: 'Mar cohort', c: '#22D3EE', data: genLine(12, 18, 4, 3.6) },
      { name: 'May cohort', c: '#34D399', data: genLine(12, 16, 3, 3.1) },
    ] },
  }),
  health: (n = 24) => ({
    banner: { title: 'All systems operational', sub: '14 services · 4 regions · uptime 99.982% last 90 days', regions: [{ l: 'US-E', ok: true }, { l: 'US-W', ok: true }, { l: 'EU-C', ok: true }, { l: 'APAC', ok: false }] },
    kpis: { p50: '82ms', errRate: '0.08%', audioFails: 14, ws: 4120 },
    latency: { p50: genLine(n, 80, 10, 0.2), p95: genLine(n, 180, 25, 0.4), p99: genLine(n, 290, 40, 0.6) },
    services: [
      { name: 'API Gateway', ms: 82, up: '99.99%', st: 'ok' }, { name: 'Auth', ms: 24, up: '99.99%', st: 'ok' },
      { name: 'Session DB', ms: 46, up: '99.98%', st: 'ok' }, { name: 'AI Inference', ms: 134, up: '99.95%', st: 'ok' },
      { name: 'Audio CDN', ms: 210, up: '99.71%', st: 'warn' }, { name: 'Biometric Pipeline', ms: 68, up: '99.97%', st: 'ok' },
      { name: 'Push Delivery', ms: 112, up: '99.92%', st: 'ok' }, { name: 'WebSocket Fleet', ms: 18, up: '99.99%', st: 'ok' },
      { name: 'Analytics Ingest', ms: 95, up: '99.96%', st: 'ok' }, { name: 'Backup · APAC', ms: 0, up: '98.20%', st: 'down' },
    ],
    sensory: { pct: 99.8, rows: [{ l: 'Audio drift < 40ms', v: 99.6 }, { l: 'Haptic on-beat', v: 98.9 }, { l: 'Ambient loop OK', v: 99.9 }, { l: 'Spatial audio', v: 97.4 }] },
    devices: [{ l: 'iOS 26', v: 96 }, { l: 'iOS 25', v: 94 }, { l: 'iOS 24', v: 88 }, { l: 'Android 15', v: 82 }, { l: 'Android 14', v: 76 }, { l: 'watchOS', v: 91 }],
    incidents: [
      { t: 'Audio CDN elevated latency', code: 'SND_303', sub: 'EU-C edge · mitigating', ago: '2h', sev: 'amber' },
      { t: 'Backup replication delay', code: 'DB_412', sub: 'APAC · investigating', ago: '4h', sev: 'red' },
      { t: 'Deployment · aura-2.4.1', code: 'DPL_204', sub: 'Rolled to 82% · healthy', ago: '8h', sev: 'green' },
      { t: 'AI inference GPU scaled', code: 'AI_101', sub: '+2 nodes · autoscale', ago: '11h', sev: 'cyan' },
      { t: 'Feature flag change', code: 'FLG_089', sub: 'emotion_ambience → off', ago: '13h', sev: 'violet' },
    ],
  }),
  analytics: (n = 20) => ({
    kpis: { calmImprovement: '+18.4', conversion: '74.2%', depth: '6.4', effective: '82.6%' },
    cohorts: [
      { w: 'Jun 03', n: '1,240', v: [100, 74, 61, 52, 47, 44, 42, 41] },
      { w: 'Jun 10', n: '1,380', v: [100, 76, 63, 55, 49, 46, 44, null] },
      { w: 'Jun 17', n: '1,510', v: [100, 78, 66, 58, 52, 48, null, null] },
      { w: 'Jun 24', n: '1,620', v: [100, 79, 68, 60, 54, null, null, null] },
      { w: 'Jul 01', n: '1,790', v: [100, 81, 70, 62, null, null, null, null] },
      { w: 'Jul 08', n: '1,940', v: [100, 83, 72, null, null, null, null, null] },
      { w: 'Jul 15', n: '2,080', v: [100, 85, null, null, null, null, null, null] },
    ],
    funnel: [
      { l: 'App open', v: 82000, c: '#7C3AED' }, { l: 'Home viewed', v: 68400, c: '#8B5CF6' },
      { l: 'Session started', v: 54200, c: '#22D3EE' }, { l: 'Cycle 3 reached', v: 42100, c: '#34D399' },
      { l: 'Completed', v: 38400, c: '#60A5FA' },
    ],
    dropoff: [
      { l: 'Cycle 1', v: 4 }, { l: 'Cycle 2', v: 12, hot: true }, { l: 'Cycle 3', v: 8 },
      { l: 'Cycle 4', v: 5 }, { l: 'Cycle 5', v: 3 }, { l: 'Cycle 6+', v: 2 },
    ],
    dropInsight: 'Cycle 2 drop-off is elevated. Users of the 4·7·8 pattern with stress > 0.6 leave at 22%. Consider a shorter hold for first-time high-stress users.',
    calm: { a: genLine(n, 64, 6, 0.5), b: genLine(n, 58, 5, 0.35) },
    calmP50: { a: genLine(n, 60, 5, 0.45), b: genLine(n, 54, 4, 0.3) },
    calmP90: { a: genLine(n, 78, 7, 0.55), b: genLine(n, 70, 6, 0.4) },
    cohortsMonthly: [
      { w: 'Mar', n: '4,820', v: [100, 71, 58, 49, 44, 41, 39, 38] },
      { w: 'Apr', n: '5,410', v: [100, 74, 61, 53, 47, 44, 42, null] },
      { w: 'May', n: '5,960', v: [100, 77, 64, 56, 50, 46, null, null] },
      { w: 'Jun', n: '6,540', v: [100, 79, 67, 59, 53, null, null, null] },
      { w: 'Jul', n: '7,180', v: [100, 82, 70, 61, null, null, null, null] },
    ],
    scatter: Array.from({ length: 42 }, (_, i) => ({ x: 40 + ((i * 149) % 660), y: 200 - ((i * 97) % 170) })),
    correlation: 0.68,
  }),
}

// ---------- SCC modules: mock series + REAL persisted overlays (config / rules / experiments) ----------
const RANGE_N: Record<string, number> = { '24h': 24, '7d': 14, '30d': 30, '90d': 90, 'ytd': 40 }


admin.get('/scc/:module', async (c) => {
  const mod = c.req.param('module')
  const fn = SCC_DATA[mod]
  if (!fn) return c.json({ error: 'Unknown module' }, 404)
  const n = RANGE_N[c.req.query('range') || ''] || undefined
  const data = fn(n) as Record<string, unknown>

  // REAL overlays — DB is source of truth where persistence exists
  if (mod === 'ai') {
    const cfg = await getAiConfig(c.env.DB)
    const sliders = data.sliders as Array<{ id: string; v: number }>
    sliders.forEach((s) => { const v = (cfg.sliders as Record<string, number>)[s.id]; if (typeof v === 'number') s.v = v })
    const flags = data.flags as Array<{ id: string; on: boolean }>
    flags.forEach((f) => { const v = (cfg.flags as Record<string, boolean>)[f.id]; if (typeof v === 'boolean') f.on = v })
    ;(data.model as Record<string, unknown>).version = cfg.version
    return c.json({ module: mod, mock: false, data })
  }
  if (mod === 'notifications') {
    const { results } = await c.env.DB.prepare('SELECT id, name, trigger, body, sent, open_rate, enabled FROM notification_rules ORDER BY id').all()
    data.rules = (results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id, name: r.name, trigger: r.trigger, body: r.body,
      sent: Number(r.sent).toLocaleString('en-US'), open: Math.round(Number(r.open_rate)), on: !!r.enabled,
    }))
    return c.json({ module: mod, mock: false, data })
  }
  if (mod === 'experiments') {
    const { results } = await c.env.DB.prepare("SELECT id, name, days, status, variants, users, lift, conf, winner FROM experiments ORDER BY created_at DESC, id DESC").all()
    const rows = (results as Array<Record<string, unknown>>).map((r) => ({
      id: r.id, name: r.name, days: r.days, status: r.status, variants: r.variants,
      users: Number(r.users).toLocaleString('en-US'), lift: r.lift, conf: r.conf, winner: r.winner,
    }))
    data.rows = rows
    const feat = rows.find((r) => r.id === 'exp_039')
    if (feat) {
      const f = data.featured as Record<string, unknown>
      f.status = feat.status; f.winner = feat.winner
    }
    const running = rows.filter((r) => r.status === 'Running' || r.status === 'Winning').length
    ;(data.kpis as Record<string, unknown>).live = running
    return c.json({ module: mod, mock: false, data })
  }
  return c.json({ module: mod, mock: true, data })
})

// ---------- AI config: REAL persistence (read by the user-app suggestion engine) ----------
admin.put('/scc/ai', async (c) => {
  const me = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (b.sliders && typeof b.sliders === 'object') patch.sliders = b.sliders
  if (b.flags && typeof b.flags === 'object') patch.flags = b.flags
  if (!Object.keys(patch).length) return c.json({ error: 'Nothing to update' }, 400)

  const cur = await getAiConfig(c.env.DB)
  const next = {
    ...cur,
    sliders: { ...cur.sliders, ...(patch.sliders as object || {}) },
    flags: { ...cur.flags, ...(patch.flags as object || {}) },
  }
  // validate slider bounds
  for (const [k, v] of Object.entries(next.sliders)) {
    if (typeof v !== 'number' || v < 0 || v > 1) return c.json({ error: `Slider ${k} must be 0..1` }, 400)
  }
  await c.env.DB.prepare(
    "INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('ai_config', ?, datetime('now'), ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
  ).bind(JSON.stringify(next), me.sub).run()
  cacheDel('ai_config')
  await logAudit(c.env.DB, me.sub, 'ai_config_update', 'ai_model', 0, patch, clientIp(c))
  return c.json({ ok: true, persisted: true, config: next })
})

// ---------- Notification rules: REAL persistence ----------
admin.put('/scc/notifications/:id', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.enabled !== 'boolean') return c.json({ error: 'enabled boolean required' }, 400)
  const r = await c.env.DB.prepare('UPDATE notification_rules SET enabled = ? WHERE id = ?').bind(b.enabled ? 1 : 0, id).run()
  if (!r.meta.changes) return c.json({ error: 'Rule not found' }, 404)
  await logAudit(c.env.DB, me.sub, 'notification_rule_toggle', 'notification_rule', id, { enabled: b.enabled }, clientIp(c))
  return c.json({ ok: true, id, enabled: b.enabled, persisted: true })
})

admin.post('/scc/notifications', async (c) => {
  const me = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const name = String(b.name || '').trim().slice(0, 80)
  const trigger = String(b.trigger || '').trim().slice(0, 120)
  const body = String(b.body || '').trim().slice(0, 240)
  if (!name || !trigger) return c.json({ error: 'name and trigger required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO notification_rules (name, trigger, body, enabled) VALUES (?, ?, ?, 1)').bind(name, trigger, body).run()
  await logAudit(c.env.DB, me.sub, 'notification_rule_create', 'notification_rule', r.meta.last_row_id as number, { name, trigger }, clientIp(c))
  return c.json({ ok: true, id: r.meta.last_row_id, persisted: true }, 201)
})

// ---------- Experiments: REAL lifecycle ----------
admin.put('/scc/experiments/:id', async (c) => {
  const me = c.get('user')
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({}))
  const status = String(b.status || '')
  if (!['Running', 'Winning', 'Paused', 'Complete'].includes(status)) return c.json({ error: 'Invalid status' }, 400)
  const winner = b.winner ? String(b.winner).slice(0, 10) : null
  const r = await c.env.DB.prepare('UPDATE experiments SET status = ?, winner = COALESCE(?, winner) WHERE id = ?').bind(status, winner, id).run()
  if (!r.meta.changes) return c.json({ error: 'Experiment not found' }, 404)
  await logAudit(c.env.DB, me.sub, 'experiment_update', 'experiment', 0, { id, status, winner }, clientIp(c))
  return c.json({ ok: true, id, status, winner, persisted: true })
})

admin.post('/scc/experiments', async (c) => {
  const me = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const name = String(b.name || '').trim().slice(0, 100)
  if (!name) return c.json({ error: 'name required' }, 400)
  const variants = Number.isInteger(b.variants) && b.variants >= 2 && b.variants <= 5 ? b.variants : 2
  const nextNum = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM experiments").first<{ n: number }>()
  const id = 'exp_' + String(42 + (nextNum?.n ?? 0)).padStart(3, '0')
  await c.env.DB.prepare("INSERT INTO experiments (id, name, days, status, variants, users, lift, conf) VALUES (?, ?, 0, 'Running', ?, 0, '—', 0)").bind(id, name, variants).run()
  await logAudit(c.env.DB, me.sub, 'experiment_create', 'experiment', 0, { id, name, variants }, clientIp(c))
  return c.json({ ok: true, id, persisted: true }, 201)
})

// ---------- Users: invite / impersonate / notes / full profile ----------
admin.post('/users/invite', async (c) => {
  const me = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const email = String(b.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Valid email required' }, 400)
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (exists) return c.json({ error: 'A user with this email already exists' }, 409)

  const temp = 'Aura-' + Math.random().toString(36).slice(2, 8) + '-' + Math.floor(Math.random() * 90 + 10)
  const hash = await hashPassword(temp)
  const r = await c.env.DB.prepare("INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')").bind(email, hash).run()
  const uid = r.meta.last_row_id as number
  const name = String(b.name || '').trim().slice(0, 60) || email.split('@')[0]
  await c.env.DB.prepare('INSERT INTO profiles (user_id, display_name) VALUES (?, ?)').bind(uid, name).run()
  await logAudit(c.env.DB, me.sub, 'invite_user', 'user', uid, { email }, clientIp(c))
  return c.json({ ok: true, id: uid, email, tempPassword: temp }, 201)
})

admin.post('/users/:id/impersonate', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  if (id === me.sub) return c.json({ error: 'You are already yourself.' }, 400)
  const target = await c.env.DB.prepare("SELECT id, email, role, status FROM users WHERE id = ?").bind(id).first<{ id: number; email: string; role: string; status: string }>()
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.status !== 'active') return c.json({ error: 'Can only impersonate active users' }, 400)
  const plan = await c.env.DB.prepare("SELECT plan FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(id).first<{ plan: string }>()
  const token = await signJwt({ sub: target.id, email: target.email, role: target.role, plan: plan?.plan || 'free', imp_by: me.sub }, jwtSecret(c))
  await logAudit(c.env.DB, me.sub, 'impersonate_user', 'user', id, { email: target.email }, clientIp(c))
  return c.json({ ok: true, token, user: { id: target.id, email: target.email, role: target.role } })
})

admin.post('/users/:id/notes', async (c) => {
  const me = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const b = await c.req.json().catch(() => ({}))
  const note = String(b.note || '').trim().slice(0, 500)
  if (!note) return c.json({ error: 'Note text required' }, 400)
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first()
  if (!target) return c.json({ error: 'User not found' }, 404)
  const r = await c.env.DB.prepare('INSERT INTO admin_notes (user_id, admin_id, note) VALUES (?, ?, ?)').bind(id, me.sub, note).run()
  await logAudit(c.env.DB, me.sub, 'user_note_add', 'user', id, { note: note.slice(0, 80) }, clientIp(c))
  return c.json({ ok: true, id: r.meta.last_row_id }, 201)
})

// Full profile: everything real about one user
admin.get('/users/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400)
  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.created_at, p.display_name, p.goal, p.baseline_stress, p.session_length, p.prefs_json, p.onboarded
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
  ).bind(id).first()
  if (!user) return c.json({ error: 'User not found' }, 404)

  const [sub, sessions, recentSessions, moods, payments, notes, liveSession] = await Promise.all([
    c.env.DB.prepare("SELECT plan, status, end_date FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed, COALESCE(SUM(duration_sec),0)/60 AS minutes, ROUND(AVG(CASE WHEN completed = 1 THEN calm_score END)) AS avg_calm FROM sessions WHERE user_id = ?").bind(id).first(),
    c.env.DB.prepare("SELECT id, program_id, pattern, duration_sec, cycles_done, calm_score, completed, started_at FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 5").bind(id).all(),
    c.env.DB.prepare("SELECT mood, created_at FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").bind(id).all(),
    c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END),0) AS cents FROM payments WHERE user_id = ?").bind(id).first(),
    c.env.DB.prepare("SELECT an.id, an.note, an.created_at, u.email AS admin_email FROM admin_notes an JOIN users u ON u.id = an.admin_id WHERE an.user_id = ? ORDER BY an.created_at DESC LIMIT 10").bind(id).all(),
    c.env.DB.prepare("SELECT id, pattern, started_at, cycles_done FROM sessions WHERE user_id = ? AND completed = 0 AND started_at > datetime('now','-30 minutes') ORDER BY started_at DESC LIMIT 1").bind(id).first(),
  ])
  return c.json({
    user, subscription: sub || null, sessionSummary: sessions,
    recentSessions: recentSessions.results, moods: moods.results,
    payments, notes: notes.results, liveSession: liveSession || null,
  })
})

export default admin
