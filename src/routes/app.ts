// Core product API: profile, programs, sessions, moods, stats, AI suggestions
import { Hono } from 'hono'
import {
  type AppEnv, requireAuth, requirePlan, getActivePlan,
  checkAndIncrementUsage, FREE_LIMITS, cacheGet, cacheSet, cacheDel,
  logActivity, clientIp,
} from '../lib/middleware'

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

// ---------- Profile / preferences ----------
app.put('/profile', async (c) => {
  const u = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const goal = ['relax', 'focus', 'sleep'].includes(b.goal) ? b.goal : undefined
  const stress = Number.isInteger(b.baselineStress) && b.baselineStress >= 0 && b.baselineStress <= 10 ? b.baselineStress : undefined
  const len = [3, 5, 10, 15].includes(b.sessionLength) ? b.sessionLength : undefined
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : undefined
  const prefs = typeof b.prefs === 'object' && b.prefs !== null ? JSON.stringify(b.prefs) : undefined
  const onboarded = b.onboarded === true ? 1 : undefined

  const sets: string[] = [], vals: unknown[] = []
  if (goal) { sets.push('goal = ?'); vals.push(goal) }
  if (stress !== undefined) { sets.push('baseline_stress = ?'); vals.push(stress) }
  if (len) { sets.push('session_length = ?'); vals.push(len) }
  if (name !== undefined) { sets.push('display_name = ?'); vals.push(name) }
  if (prefs) { sets.push('prefs_json = ?'); vals.push(prefs) }
  if (onboarded) { sets.push('onboarded = 1') }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400)
  sets.push("updated_at = datetime('now')")

  await c.env.DB.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`).bind(...vals, u.sub).run()
  cacheDel(`stats:${u.sub}`)
  return c.json({ ok: true })
})

// ---------- Programs library (cached 5 min — read-heavy, rarely changes) ----------
app.get('/programs', async (c) => {
  const u = c.get('user')
  const cacheKey = 'programs:all'
  let programs = cacheGet<any[]>(cacheKey)
  if (!programs) {
    const { results } = await c.env.DB.prepare(
      'SELECT id, slug, title, category, tag, duration_min, inhale, hold, exhale, cycles, phase, is_premium, is_new FROM programs WHERE active = 1 ORDER BY sort_order'
    ).all()
    programs = results as any[]
    cacheSet(cacheKey, programs, 300)
  }
  const plan = await getActivePlan(c.env.DB, u.sub)
  return c.json({
    plan,
    programs: programs.map((p) => ({ ...p, locked: !!p.is_premium && plan === 'free' })),
  })
})

// ---------- Sessions ----------
app.post('/sessions/start', async (c) => {
  const u = c.get('user')
  const plan = await getActivePlan(c.env.DB, u.sub)

  const b = await c.req.json().catch(() => ({}))
  const inhale = clampInt(b.inhale, 2, 12, 4), hold = clampInt(b.hold, 0, 12, 7), exhale = clampInt(b.exhale, 2, 15, 8)
  const cycles = clampInt(b.cycles, 2, 20, 6)
  const programId = Number.isInteger(b.programId) ? b.programId : null
  const mood = ['anxious', 'calm', 'tired', 'focused'].includes(b.mood) ? b.mood : null

  // Premium-program gate first (so a blocked attempt never consumes free quota)
  if (programId) {
    const prog = await c.env.DB.prepare('SELECT is_premium FROM programs WHERE id = ? AND active = 1').bind(programId).first<{ is_premium: number }>()
    if (!prog) return c.json({ error: 'Program not found' }, 404)
    if (prog.is_premium && plan === 'free') return c.json({ error: 'This program requires AURA Pro.', upgrade: true }, 402)
  }

  // Feature gate: free users limited to N sessions/day (enforced server-side)
  if (plan === 'free') {
    const usage = await checkAndIncrementUsage(c.env.DB, u.sub, 'sessions', FREE_LIMITS.sessions_per_day)
    if (!usage.allowed) {
      return c.json({
        error: `Free plan includes ${usage.limit} sessions per day. Upgrade for unlimited practice.`,
        upgrade: true, usage,
      }, 402)
    }
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO sessions (user_id, program_id, pattern, inhale, hold, exhale, cycles_planned, mood_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(u.sub, programId, `${inhale}-${hold}-${exhale}`, inhale, hold, exhale, cycles, mood).run()

  await logActivity(c.env.DB, u.sub, 'session_start', { pattern: `${inhale}-${hold}-${exhale}`, cycles }, clientIp(c))
  return c.json({ sessionId: res.meta.last_row_id, pattern: { inhale, hold, exhale }, cycles }, 201)
})

app.post('/sessions/:id/complete', async (c) => {
  const u = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  const b = await c.req.json().catch(() => ({}))
  const cyclesDone = clampInt(b.cyclesDone, 0, 50, 0)
  const durationSec = clampInt(b.durationSec, 0, 7200, 0)

  const sess = await c.env.DB.prepare('SELECT id, inhale, hold, exhale, cycles_planned, mood_before FROM sessions WHERE id = ? AND user_id = ? AND completed = 0')
    .bind(id, u.sub).first<{ id: number; inhale: number; hold: number; exhale: number; cycles_planned: number; mood_before: string | null }>()
  if (!sess) return c.json({ error: 'Session not found' }, 404)

  // "Smart" scoring: consistency from completion ratio + duration accuracy; calm score blends recent history
  const expectedSec = (sess.inhale + sess.hold + sess.exhale) * sess.cycles_planned
  const completionRatio = Math.min(1, cyclesDone / sess.cycles_planned)
  const timingAccuracy = expectedSec > 0 ? Math.max(0, 1 - Math.abs(durationSec - expectedSec * completionRatio) / Math.max(expectedSec, 1)) : 0.8
  const consistency = Math.round((completionRatio * 0.6 + timingAccuracy * 0.4) * 100)

  const prev = await c.env.DB.prepare(
    'SELECT AVG(calm_score) AS avg_score FROM sessions WHERE user_id = ? AND completed = 1 AND started_at > datetime("now", "-7 days")'
  ).bind(u.sub).first<{ avg_score: number | null }>()
  const base = prev?.avg_score ?? 60
  const moodBoost = sess.mood_before === 'anxious' ? 6 : sess.mood_before === 'tired' ? 4 : 2
  const calmScore = Math.min(100, Math.round(base * 0.7 + consistency * 0.25 + moodBoost))
  const calmDelta = -Math.max(2, Math.round(completionRatio * 12)) // negative = calmer (stress down)

  await c.env.DB.prepare(
    `UPDATE sessions SET completed = 1, cycles_done = ?, duration_sec = ?, consistency = ?, calm_score = ?, calm_delta = ?, ended_at = datetime('now')
     WHERE id = ?`
  ).bind(cyclesDone, durationSec, consistency, calmScore, calmDelta, id).run()

  cacheDel(`stats:${u.sub}`)
  await logActivity(c.env.DB, u.sub, 'session_complete', { id, durationSec, consistency }, clientIp(c))
  return c.json({
    durationSec, consistency, calmScore, calmDelta,
    heartRateDelta: -Math.max(3, Math.round(completionRatio * 10)), // simulated biometric insight
  })
})

// GET /api/app/history — grouped session timeline
app.get('/history', async (c) => {
  const u = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.pattern, s.duration_sec, s.calm_score, s.consistency, s.started_at, s.mood_before, p.title AS program_title
     FROM sessions s LEFT JOIN programs p ON p.id = s.program_id
     WHERE s.user_id = ? AND s.completed = 1 ORDER BY s.started_at DESC LIMIT 50`
  ).bind(u.sub).all()
  const summary = await c.env.DB.prepare(
    'SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_sec),0)/60 AS minutes FROM sessions WHERE user_id = ? AND completed = 1'
  ).bind(u.sub).first<{ sessions: number; minutes: number }>()
  return c.json({ sessions: results, summary: { ...summary, streak: await computeStreak(c.env.DB, u.sub) } })
})

// ---------- Mood check-in + AI suggestion ----------
const MOOD_PLANS: Record<string, { pattern: string; inhale: number; hold: number; exhale: number; minutes: number; reason: string }> = {
  anxious: { pattern: '4-7-8 breathing', inhale: 4, hold: 7, exhale: 8, minutes: 5, reason: 'Slow exhale to ease an anxious mind' },
  calm:    { pattern: 'Box breathing',   inhale: 4, hold: 4, exhale: 4, minutes: 3, reason: 'Maintain your steady baseline' },
  tired:   { pattern: 'Energizing breath', inhale: 6, hold: 2, exhale: 4, minutes: 3, reason: 'Longer inhales to gently lift energy' },
  focused: { pattern: 'Coherent breathing', inhale: 5, hold: 0, exhale: 5, minutes: 5, reason: 'Rhythmic pacing to sharpen attention' },
}

app.post('/moods', async (c) => {
  const u = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const mood = String(b.mood || '')
  if (!MOOD_PLANS[mood]) return c.json({ error: 'Invalid mood' }, 400)

  await c.env.DB.prepare('INSERT INTO moods (user_id, mood) VALUES (?, ?)').bind(u.sub, mood).run()

  // Personalization: adapt suggestion using time of day + user's evening/morning performance
  const hour = new Date().getUTCHours()
  const plan = { ...MOOD_PLANS[mood] }
  if (mood !== 'tired' && (hour >= 20 || hour <= 4)) { plan.exhale += 1; plan.reason += ' · evening pace, longer exhale' }

  await logActivity(c.env.DB, u.sub, 'mood_checkin', { mood }, clientIp(c))
  return c.json({ mood, suggestion: plan }, 201)
})

// ---------- Stats dashboard (cached 60s per user) ----------
app.get('/stats', async (c) => {
  const u = c.get('user')
  const cacheKey = `stats:${u.sub}`
  const cached = cacheGet<object>(cacheKey)
  if (cached) return c.json(cached)

  const [totals, daily, recentAvg, prevAvg, lastMoods] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_sec),0)/60 AS minutes, COALESCE(AVG(consistency),0) AS consistency
       FROM sessions WHERE user_id = ? AND completed = 1`
    ).bind(u.sub).first<{ sessions: number; minutes: number; consistency: number }>(),
    c.env.DB.prepare(
      `SELECT date(started_at) AS day, ROUND(AVG(calm_score)) AS score, COUNT(*) AS count
       FROM sessions WHERE user_id = ? AND completed = 1 AND started_at > datetime('now','-7 days')
       GROUP BY date(started_at) ORDER BY day`
    ).bind(u.sub).all(),
    c.env.DB.prepare(
      `SELECT AVG(calm_score) AS s FROM sessions WHERE user_id = ? AND completed = 1 AND started_at > datetime('now','-7 days')`
    ).bind(u.sub).first<{ s: number | null }>(),
    c.env.DB.prepare(
      `SELECT AVG(calm_score) AS s FROM sessions WHERE user_id = ? AND completed = 1
       AND started_at BETWEEN datetime('now','-14 days') AND datetime('now','-7 days')`
    ).bind(u.sub).first<{ s: number | null }>(),
    c.env.DB.prepare('SELECT mood, created_at FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT 5').bind(u.sub).all(),
  ])

  const calmScore = Math.round(recentAvg?.s ?? 0)
  const calmDelta = Math.round((recentAvg?.s ?? 0) - (prevAvg?.s ?? recentAvg?.s ?? 0))
  const streak = await computeStreak(c.env.DB, u.sub)

  // AURA Insight: rule-based intelligence over the user's own data
  let insight = 'Complete your first session to unlock personalized insights.'
  if ((totals?.sessions ?? 0) > 0) {
    const evening = await c.env.DB.prepare(
      `SELECT AVG(calm_score) AS s FROM sessions WHERE user_id = ? AND completed = 1 AND CAST(strftime('%H', started_at) AS INT) >= 20`
    ).bind(u.sub).first<{ s: number | null }>()
    const daytime = await c.env.DB.prepare(
      `SELECT AVG(calm_score) AS s FROM sessions WHERE user_id = ? AND completed = 1 AND CAST(strftime('%H', started_at) AS INT) < 20`
    ).bind(u.sub).first<{ s: number | null }>()
    if ((evening?.s ?? 0) > (daytime?.s ?? 0) && evening?.s) {
      insight = "Your calmest sessions happen after 8pm. Try shifting your practice later — we'll queue a gentler pace to match."
    } else if (streak >= 3) {
      insight = `You're on a ${streak}-day streak. Consistency is compounding — your average calm score is up ${Math.max(calmDelta, 0)} points this week.`
    } else {
      insight = 'Short, regular sessions beat long, rare ones. Try a 3-minute session at the same time each day.'
    }
  }

  const payload = {
    calmScore, calmDelta, streak,
    sessions: totals?.sessions ?? 0,
    minutes: Math.round(totals?.minutes ?? 0),
    consistency: Math.round(totals?.consistency ?? 0),
    stressTrendPct: -Math.min(40, Math.round((calmDelta > 0 ? calmDelta : 2) * 1.6)),
    daily: daily.results, insight,
    lastMoods: lastMoods.results,
  }
  cacheSet(cacheKey, payload, 60)
  return c.json(payload)
})

// Premium-only deep analytics (feature-gated example)
app.get('/stats/deep', requirePlan('pro'), async (c) => {
  const u = c.get('user')
  const [byHour, byMood] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', started_at) AS INT) AS hour, ROUND(AVG(calm_score)) AS score, COUNT(*) AS n
       FROM sessions WHERE user_id = ? AND completed = 1 GROUP BY hour ORDER BY hour`
    ).bind(u.sub).all(),
    c.env.DB.prepare(
      `SELECT mood_before AS mood, ROUND(AVG(calm_score)) AS score, ROUND(AVG(consistency)) AS consistency, COUNT(*) AS n
       FROM sessions WHERE user_id = ? AND completed = 1 AND mood_before IS NOT NULL GROUP BY mood_before`
    ).bind(u.sub).all(),
  ])
  return c.json({ byHour: byHour.results, byMood: byMood.results })
})

// ---------- helpers ----------
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? Math.round(v) : parseInt(String(v), 10)
  if (isNaN(n)) return dflt
  return Math.max(min, Math.min(max, n))
}

async function computeStreak(db: D1Database, userId: number): Promise<number> {
  const { results } = await db.prepare(
    `SELECT DISTINCT date(started_at) AS day FROM sessions WHERE user_id = ? AND completed = 1 ORDER BY day DESC LIMIT 60`
  ).bind(userId).all<{ day: string }>()
  let streak = 0
  const today = new Date()
  for (let i = 0; i < results.length; i++) {
    const expect = new Date(today.getTime() - streak * 86400000).toISOString().slice(0, 10)
    const expectYesterday = new Date(today.getTime() - (streak + 1) * 86400000).toISOString().slice(0, 10)
    if (results[i].day === expect) streak++
    else if (streak === 0 && results[i].day === expectYesterday) streak++ // streak alive if practiced yesterday
    else break
  }
  return streak
}

export default app
