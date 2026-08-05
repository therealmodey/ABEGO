import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyJwt, type JwtPayload } from './auth'

export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  PAYSTACK_SECRET_KEY?: string
  PAYSTACK_WEBHOOK_SECRET?: string
  ALLOW_SIM_CHECKOUT?: string
  ALLOWED_ORIGINS?: string
}

export type AppEnv = { Bindings: Bindings; Variables: { user: JwtPayload } }

// SECURITY: fail closed. A hardcoded fallback secret means a single missing
// binding turns every JWT into a forgeable token (including role:'admin'),
// so a missing/short JWT_SECRET is a hard configuration error, never a default.
export const MIN_JWT_SECRET_LENGTH = 32

export function jwtSecret(c: Context<AppEnv>): string {
  const secret = c.env.JWT_SECRET
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is missing or too short (need >= ${MIN_JWT_SECRET_LENGTH} chars). ` +
      'Set it with: wrangler pages secret put JWT_SECRET'
    )
  }
  return secret
}

// Constant-time comparison of two hex/ascii strings (signature verification).
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- CORS ----------
// SECURITY: the previous config reflected any Origin back with credentials:true,
// which lets any website on the internet call this API with the user's cookie.
// The app is served from the same origin as its API, so cross-origin access is
// not needed at all: nothing is allowed unless ALLOWED_ORIGINS names it.
export function parseAllowedOrigins(raw?: string): string[] {
  return (raw || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function corsOrigin(env: Bindings): (origin: string) => string | null {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
  return (origin: string) => (origin && allowed.includes(origin.replace(/\/$/, '')) ? origin : null)
}

// ---------- Security headers ----------
// Defence-in-depth headers that cannot alter layout or behaviour. A
// Content-Security-Policy is intentionally NOT set here: the frontend renders
// inline styles via innerHTML and loads fonts/axios from CDNs, so a policy needs
// a visual pass first and ships separately.
export async function securityHeaders(c: Context<AppEnv>, next: Next) {
  await next()
  const h = c.res.headers
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('X-Frame-Options', 'DENY')
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  if (new URL(c.req.url).protocol === 'https:') {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  // Never let a shared cache or proxy retain authenticated API responses.
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    h.set('Cache-Control', 'no-store')
  }
}

// ---------- Token revocation ----------
// JWTs are stateless, so without this a stolen token is valid until it expires
// (7 days) and logout only clears the cookie. See migration 0005.
export async function revokeToken(db: D1Database, payload: JwtPayload): Promise<void> {
  if (!payload.jti) return
  await db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(payload.jti, payload.sub, payload.exp).run()
  // Opportunistic sweep so the table cannot grow forever.
  await db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?')
    .bind(Math.floor(Date.now() / 1000)).run()
}

export async function isTokenRevoked(db: D1Database, jti?: string): Promise<boolean> {
  if (!jti) return false
  const row = await db.prepare('SELECT 1 AS hit FROM revoked_tokens WHERE jti = ?').bind(jti).first()
  return !!row
}

// Invalidates every existing token for a user (suspension, role change, and
// password reset once that ships).
export async function bumpTokenVersion(db: D1Database, userId: number): Promise<void> {
  await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(userId).run()
}

// ---------- Auth guard: validates JWT from cookie or Authorization header ----------
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  const token = bearer || getCookie(c, 'aura_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJwt(token, jwtSecret(c))
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401)

  // Re-validate role + status server-side on EVERY request (never trust the token alone)
  const row = await c.env.DB.prepare('SELECT role, status, token_version FROM users WHERE id = ?')
    .bind(payload.sub).first<{ role: string; status: string; token_version: number }>()
  if (!row || row.status !== 'active') return c.json({ error: 'Account unavailable' }, 403)

  // Revocation: this exact token (logout), or every token for the user (bump).
  // Tokens minted before migration 0005 carry no `tv`; treat them as version 1
  // so an existing session is not force-logged-out by the deploy itself.
  if ((payload.tv ?? 1) !== (row.token_version ?? 1)) {
    return c.json({ error: 'Session expired, please sign in again.' }, 401)
  }
  if (await isTokenRevoked(c.env.DB, payload.jti)) {
    return c.json({ error: 'Session expired, please sign in again.' }, 401)
  }
  payload.role = row.role as 'user' | 'admin'
  c.set('user', payload)
  await next()
}

// ---------- Admin guard: role checked against DB, not just JWT ----------
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden: admin access required' }, 403)
  await next()
}

// ---------- Plan gate factory: enforce subscription tier server-side ----------
const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, premium: 2 }

export async function getActivePlan(db: D1Database, userId: number): Promise<'free' | 'pro' | 'premium'> {
  const sub = await db.prepare(
    `SELECT plan FROM subscriptions WHERE user_id = ? AND status = 'active'
     AND (end_date IS NULL OR end_date > datetime('now')) ORDER BY id DESC LIMIT 1`
  ).bind(userId).first<{ plan: string }>()
  return (sub?.plan as 'free' | 'pro' | 'premium') || 'free'
}

export function requirePlan(minPlan: 'pro' | 'premium') {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    const plan = await getActivePlan(c.env.DB, user.sub)
    if (PLAN_RANK[plan] < PLAN_RANK[minPlan]) {
      return c.json({ error: 'Upgrade required', required_plan: minPlan, current_plan: plan, upgrade: true }, 402)
    }
    await next()
  }
}

// ---------- Usage limits (free plan metering) ----------
export const FREE_LIMITS = { sessions_per_day: 3, ai_suggestions_per_day: 2 }

export async function checkAndIncrementUsage(
  db: D1Database, userId: number, metric: string, limit: number
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const day = new Date().toISOString().slice(0, 10)
  const row = await db.prepare('SELECT count FROM usage_counters WHERE user_id = ? AND day = ? AND metric = ?')
    .bind(userId, day, metric).first<{ count: number }>()
  const count = row?.count || 0
  if (count >= limit) return { allowed: false, count, limit }
  await db.prepare(
    `INSERT INTO usage_counters (user_id, day, metric, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, day, metric) DO UPDATE SET count = count + 1`
  ).bind(userId, day, metric).run()
  return { allowed: true, count: count + 1, limit }
}

// ---------- In-memory rate limiter (per-isolate; fine for sensitive endpoint hardening) ----------
const rlBuckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(maxReq: number, windowSec: number, keyPrefix = '') {
  return async (c: Context<AppEnv>, next: Next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'local'
    const key = `${keyPrefix}:${ip}`
    const now = Date.now()
    let bucket = rlBuckets.get(key)
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowSec * 1000 }
      rlBuckets.set(key, bucket)
    }
    bucket.count++
    if (rlBuckets.size > 5000) { // prevent unbounded growth
      for (const [k, v] of rlBuckets) if (v.resetAt < now) rlBuckets.delete(k)
    }
    if (bucket.count > maxReq) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return c.json({ error: 'Too many requests, slow down.' }, 429)
    }
    await next()
  }
}

// ---------- Tiny in-memory TTL cache (per-isolate, for read-heavy endpoints) ----------
const memCache = new Map<string, { value: unknown; expiresAt: number }>()

export function cacheGet<T>(key: string): T | null {
  const hit = memCache.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) { memCache.delete(key); return null }
  return hit.value as T
}
export function cacheSet(key: string, value: unknown, ttlSec: number) {
  if (memCache.size > 1000) memCache.clear()
  memCache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 })
}
export function cacheDel(prefix: string) {
  for (const k of memCache.keys()) if (k.startsWith(prefix)) memCache.delete(k)
}

// ---------- Logging helpers ----------
export async function logActivity(db: D1Database, userId: number | null, action: string, meta: object = {}, ip?: string) {
  try {
    await db.prepare('INSERT INTO activity_logs (user_id, action, meta_json, ip) VALUES (?, ?, ?, ?)')
      .bind(userId, action, JSON.stringify(meta), ip || null).run()
  } catch { /* logging must never break requests */ }
}

export async function logAudit(db: D1Database, adminId: number, action: string, targetType: string, targetId: number | null, detail: object = {}, ip?: string) {
  await db.prepare('INSERT INTO audit_logs (admin_id, action, target_type, target_id, detail_json, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(adminId, action, targetType, targetId, JSON.stringify(detail), ip || null).run()
}

export const clientIp = (c: Context<AppEnv>) => c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined
