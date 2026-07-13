import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { hashPassword, verifyPassword, signJwt } from '../lib/auth'
import { type AppEnv, jwtSecret, requireAuth, rateLimit, logActivity, clientIp, getActivePlan } from '../lib/middleware'

const auth = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function setAuthCookie(c: any, token: string) {
  setCookie(c, 'aura_token', token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  })
}

// POST /api/auth/signup
auth.post('/signup', rateLimit(10, 300, 'signup'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const name = String(body.name || '').trim().slice(0, 60)

  if (!EMAIL_RE.test(email)) return c.json({ error: 'Please enter a valid email.' }, 400)
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: 'An account with this email already exists.' }, 409)

  const password_hash = await hashPassword(password)
  // SECURITY: role is hard-coded to 'user' — self-promotion to admin is impossible via this endpoint
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'active')"
  ).bind(email, password_hash).run()
  const userId = res.meta.last_row_id as number

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO profiles (user_id, display_name) VALUES (?, ?)').bind(userId, name || email.split('@')[0]),
    c.env.DB.prepare("INSERT INTO subscriptions (user_id, plan, status) VALUES (?, 'free', 'active')").bind(userId),
  ])
  await logActivity(c.env.DB, userId, 'signup', { email }, clientIp(c))

  const token = await signJwt({ sub: userId, email, role: 'user', plan: 'free' }, jwtSecret(c))
  setAuthCookie(c, token)
  return c.json({ token, user: { id: userId, email, name: name || email.split('@')[0], role: 'user', plan: 'free', onboarded: false } }, 201)
})

// POST /api/auth/login
auth.post('/login', rateLimit(15, 300, 'login'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, role, status FROM users WHERE email = ?'
  ).bind(email).first<{ id: number; email: string; password_hash: string; role: 'user' | 'admin'; status: string }>()

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await logActivity(c.env.DB, user?.id ?? null, 'login_failed', { email }, clientIp(c))
    return c.json({ error: 'Incorrect email or password.' }, 401)
  }
  if (user.status === 'suspended') return c.json({ error: 'Your account has been suspended.' }, 403)
  if (user.status !== 'active') return c.json({ error: 'Account unavailable.' }, 403)

  const [profile, plan] = await Promise.all([
    c.env.DB.prepare('SELECT display_name, onboarded FROM profiles WHERE user_id = ?').bind(user.id)
      .first<{ display_name: string; onboarded: number }>(),
    getActivePlan(c.env.DB, user.id),
  ])
  await logActivity(c.env.DB, user.id, 'login', {}, clientIp(c))

  const token = await signJwt({ sub: user.id, email: user.email, role: user.role, plan }, jwtSecret(c))
  setAuthCookie(c, token)
  return c.json({
    token,
    user: { id: user.id, email: user.email, name: profile?.display_name || '', role: user.role, plan, onboarded: !!profile?.onboarded },
  })
})

// POST /api/auth/logout
auth.post('/logout', async (c) => {
  deleteCookie(c, 'aura_token', { path: '/' })
  return c.json({ ok: true })
})

// GET /api/auth/me — session probe
auth.get('/me', requireAuth, async (c) => {
  const u = c.get('user')
  const [profile, plan] = await Promise.all([
    c.env.DB.prepare('SELECT display_name, goal, baseline_stress, session_length, prefs_json, onboarded FROM profiles WHERE user_id = ?')
      .bind(u.sub).first<{ display_name: string; goal: string; baseline_stress: number; session_length: number; prefs_json: string; onboarded: number }>(),
    getActivePlan(c.env.DB, u.sub),
  ])
  return c.json({
    user: {
      id: u.sub, email: u.email, role: u.role, plan,
      name: profile?.display_name || '', goal: profile?.goal || 'relax',
      baselineStress: profile?.baseline_stress ?? 5, sessionLength: profile?.session_length ?? 5,
      prefs: JSON.parse(profile?.prefs_json || '{}'), onboarded: !!profile?.onboarded,
    },
  })
})

export default auth
