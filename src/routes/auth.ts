import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { hashPassword, verifyPassword, signJwt, verifyJwt, newJti } from '../lib/auth'
import { type AppEnv, jwtSecret, requireAuth, rateLimit, logActivity, clientIp, getActivePlan, revokeToken, bumpTokenVersion } from '../lib/middleware'

const auth = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function setAuthCookie(c: any, token: string) {
  setCookie(c, 'aura_token', token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  })
}

// Resolve a best-effort device label from the User-Agent.
function deviceLabel(ua: string): string {
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
  if (cf && cf !== 'XX') return `${cf} · just now`
  const ip = clientIp(c)
  return ip ? `${ip} · just now` : 'Unknown location'
}

// Register the current login as a device session so "sign out everywhere"
// can enumerate and revoke other devices. Best-effort: never fails the request.
async function registerSession(c: any, userId: number, jti: string) {
  try {
    await c.env.DB.prepare(
      `INSERT INTO sessions_registry (user_id, jti, device, location, last_active)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, jti) DO UPDATE SET last_active = datetime('now'), device = excluded.device`
    ).bind(userId, jti, deviceLabel(c.req.header('User-Agent') || ''), locationLabel(c)).run()
  } catch { /* missing table in older deploys — ignore */ }
}

// Small embedded common-password list for the password strength "breached"
// check. A production build would call haveibeenpwned k-anonymity; here we keep
// the client-side UX (amber breach warning) wired without an external call.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789', 'qwerty',
  'abc123', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'sunshine', 'football',
  'superman', 'princess', 'azerty', 'trustno1', 'dragon', 'baseball', 'master', 'hello',
  'freedom', 'whatever', 'qazwsx', 'passw0rd', 'batman', 'charlie', 'aa123456',
])
function passwordScore(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4
}

function genCode(len = 6): string {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10)
  return s
}
function genToken(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

// ---------- Signup ----------
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
  // New accounts start unverified; the signup flow routes to email verification.
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, password_hash, role, status, email_verified) VALUES (?, ?, 'user', 'active', 0)"
  ).bind(email, password_hash).run()
  const userId = res.meta.last_row_id as number

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO profiles (user_id, display_name) VALUES (?, ?)').bind(userId, name || email.split('@')[0]),
    c.env.DB.prepare("INSERT INTO subscriptions (user_id, plan, status) VALUES (?, 'free', 'active')").bind(userId),
  ])

  const token = await signJwt({ sub: userId, email, role: 'user', plan: 'free', jti: newJti(), tv: 1 }, jwtSecret(c))
  const jti = (await verifyJwt(token, jwtSecret(c))).jti!
  setAuthCookie(c, token)
  await registerSession(c, userId, jti)
  await logActivity(c.env.DB, userId, 'signup', { email }, clientIp(c))

  // Issue a verification code immediately so the next screen can verify.
  const code = genCode()
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    "INSERT INTO auth_codes (user_id, purpose, code, token, expires_at) VALUES (?, 'verify_email', ?, ?, ?) " +
    "ON CONFLICT(user_id, purpose) DO UPDATE SET code = excluded.code, token = excluded.token, expires_at = excluded.expires_at"
  ).bind(userId, code, genToken(), expires).run()

  return c.json({
    token,
    user: { id: userId, email, name: name || email.split('@')[0], role: 'user', plan: 'free', onboarded: false, emailVerified: false },
    requiresVerification: true,
    devCode: code,
  }, 201)
})

// ---------- Login ----------
auth.post('/login', rateLimit(15, 300, 'login'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, role, status, token_version, email_verified FROM users WHERE email = ?'
  ).bind(email).first<{ id: number; email: string; password_hash: string; role: 'user' | 'admin'; status: string; token_version: number; email_verified: number }>()

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await logActivity(c.env.DB, user?.id ?? null, 'login_failed', { email }, clientIp(c))
    return c.json({ error: 'Incorrect email or password.' }, 401)
  }
  if (user.status === 'suspended') return c.json({ error: 'Your account has been suspended.' }, 403)
  if (user.status !== 'active') return c.json({ error: 'Account unavailable.' }, 403)

  const [profile, plan] = await Promise.all([
    c.env.DB.prepare('SELECT display_name, onboarded FROM profiles WHERE user_id = ?')
      .bind(user.id).first<{ display_name: string; onboarded: number }>(),
    getActivePlan(c.env.DB, user.id),
  ])

  const token = await signJwt({ sub: user.id, email: user.email, role: user.role, plan, jti: newJti(), tv: user.token_version ?? 1 }, jwtSecret(c))
  const jti = (await verifyJwt(token, jwtSecret(c))).jti!
  setAuthCookie(c, token)
  await registerSession(c, user.id, jti)
  await logActivity(c.env.DB, user.id, 'login', {}, clientIp(c))

  const verified = !!user.email_verified
  return c.json({
    token,
    user: {
      id: user.id, email: user.email, name: profile?.display_name || '', role: user.role, plan,
      onboarded: !!profile?.onboarded, emailVerified: verified,
    },
    requiresVerification: !verified,
  })
})

// ---------- Logout ----------
auth.post('/logout', async (c) => {
  const raw = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || getCookie(c, 'aura_token')
  if (raw) {
    try {
      const payload = await verifyJwt(raw, jwtSecret(c))
      if (payload) {
        await revokeToken(c.env.DB, payload)
        await c.env.DB.prepare('DELETE FROM sessions_registry WHERE user_id = ? AND jti = ?')
          .bind(payload.sub, payload.jti).run().catch(() => {})
      }
    } catch { /* never let logout fail */ }
  }
  deleteCookie(c, 'aura_token', { path: '/' })
  return c.json({ ok: true })
})

// ---------- Session probe ----------
auth.get('/me', requireAuth, async (c) => {
  const u = c.get('user')
  await c.env.DB.prepare('UPDATE sessions_registry SET last_active = datetime(\'now\') WHERE user_id = ? AND jti = ?')
    .bind(u.sub, u.jti).run().catch(() => {})
  const [profile, plan] = await Promise.all([
    c.env.DB.prepare('SELECT display_name, goal, baseline_stress, session_length, prefs_json, onboarded FROM profiles WHERE user_id = ?')
      .bind(u.sub).first<{ display_name: string; goal: string; baseline_stress: number; session_length: number; prefs_json: string; onboarded: number }>(),
    getActivePlan(c.env.DB, u.sub),
  ])
  return c.json({
    user: {
      id: u.sub, email: profile?.email || u.email, role: u.role, plan,
      name: profile?.display_name || '', goal: profile?.goal || 'relax',
      baselineStress: profile?.baseline_stress ?? 5, sessionLength: profile?.session_length ?? 5,
      prefs: JSON.parse(profile?.prefs_json || '{}'), onboarded: !!profile?.onboarded,
    },
  })
})

// ---------- Forgot password: request a reset link ----------
auth.post('/forgot', rateLimit(10, 300, 'forgot'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Please enter a valid email.' }, 400)

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>()
  // Always respond success (do not reveal whether the email exists).
  let token: string | undefined
  if (user) {
    token = genToken()
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await c.env.DB.prepare(
      "INSERT INTO auth_codes (user_id, purpose, code, token, expires_at) VALUES (?, 'reset_password', ?, ?, ?) " +
      "ON CONFLICT(user_id, purpose) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at"
    ).bind(user.id, genCode(), token, expires).run()
    await logActivity(c.env.DB, user.id, 'password_reset_requested', { email }, clientIp(c))
  }
  // The real app emails the link; in this build we surface it so the flow is
  // traversable without an email backend. Prototype only.
  return c.json({ ok: true, devResetToken: user ? token : undefined })
})

// ---------- Reset password (via link token) ----------
auth.post('/reset', rateLimit(10, 300, 'reset'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const token = String(body.token || '')
  const newPassword = String(body.newPassword || '')
  if (newPassword.length < 8) return c.json({ error: 'Password must be at least 8 characters.' }, 400)

  const row = await c.env.DB.prepare('SELECT user_id, expires_at FROM auth_codes WHERE purpose = ? AND token = ?')
    .bind('reset_password', token).first<{ user_id: number; expires_at: string }>()
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This reset link is invalid or has expired.' }, 400)
  }

  const password_hash = await hashPassword(newPassword)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(password_hash, row.user_id).run()
  await c.env.DB.prepare('DELETE FROM auth_codes WHERE purpose = ? AND user_id = ?')
    .bind('reset_password', row.user_id).run()
  // Issuing a new token version signs out every other device.
  await bumpTokenVersionLocal(c, row.user_id)
  await logActivity(c.env.DB, row.user_id, 'password_reset', {}, clientIp(c))

  // Auto sign-in (the reset success screen says "you're signed in").
  const u = await c.env.DB.prepare('SELECT email, role, status, token_version FROM users WHERE id = ?')
    .bind(row.user_id).first<{ email: string; role: 'user' | 'admin'; status: string; token_version: number }>()
  const [profile, plan] = await Promise.all([
    c.env.DB.prepare('SELECT display_name, onboarded FROM profiles WHERE user_id = ?').bind(row.user_id)
      .first<{ display_name: string; onboarded: number }>(),
    getActivePlan(c.env.DB, row.user_id),
  ])
  const jwt = await signJwt({ sub: row.user_id, email: u.email, role: u.role, plan, jti: newJti(), tv: u.token_version ?? 1 }, jwtSecret(c))
  const jti = (await verifyJwt(jwt, jwtSecret(c))).jti!
  setAuthCookie(c, jwt)
  await registerSession(c, row.user_id, jti)
  return c.json({
    token: jwt,
    user: {
      id: row.user_id, email: u.email, name: profile?.display_name || '', role: u.role, plan,
      onboarded: !!profile?.onboarded, emailVerified: true,
    },
  })
})

// ---------- Email verification: send code ----------
auth.post('/verify/send', rateLimit(10, 120, 'verify'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>()
  const code = genCode()
  if (user) {
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    await c.env.DB.prepare(
      "INSERT INTO auth_codes (user_id, purpose, code, token, expires_at) VALUES (?, 'verify_email', ?, ?, ?) " +
      "ON CONFLICT(user_id, purpose) DO UPDATE SET code = excluded.code, token = excluded.token, expires_at = excluded.expires_at"
    ).bind(user.id, code, genToken(), expires).run()
    await logActivity(c.env.DB, user.id, 'verify_email_sent', { email }, clientIp(c))
  }
  // Prototype: surface the code so the flow is traversable without email.
  return c.json({ ok: true, devCode: user ? code : undefined })
})

// ---------- Email verification: confirm code ----------
auth.post('/verify/confirm', rateLimit(20, 120, 'verify'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>()
  if (!user) return c.json({ error: 'No account found for that email.' }, 400)
  const row = await c.env.DB.prepare('SELECT code, expires_at FROM auth_codes WHERE purpose = ? AND user_id = ?')
    .bind('verify_email', user.id).first<{ code: string; expires_at: string }>()
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'This code has expired. Request a new one.' }, 400)
  }
  if (row.code !== code) return c.json({ error: 'That code is not correct. Try again.' }, 400)
  await c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(user.id).run()
  await c.env.DB.prepare('DELETE FROM auth_codes WHERE purpose = ? AND user_id = ?').bind('verify_email', user.id).run()
  await logActivity(c.env.DB, user.id, 'email_verified', {}, clientIp(c))
  return c.json({ ok: true })
})

// ---------- Password strength check (breached lookup) ----------
auth.post('/password-check', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const pw = String(body.password || '')
  const score = passwordScore(pw)
  const breached = pw.length >= 4 && COMMON_PASSWORDS.has(pw.toLowerCase())
  return c.json({ score, breached })
})

// Local helper to bump token version (reuses middleware's implementation).
async function bumpTokenVersionLocal(c: any, userId: number) {
  await bumpTokenVersion(c.env.DB, userId)
}

export default auth
