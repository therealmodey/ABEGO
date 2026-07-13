import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyJwt, type JwtPayload } from './auth'

export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  PAYSTACK_SECRET_KEY?: string
}

export type AppEnv = { Bindings: Bindings; Variables: { user: JwtPayload } }

export const jwtSecret = (c: Context<AppEnv>) => c.env.JWT_SECRET || 'dev-secret-change-in-production'

// ---------- Auth guard: validates JWT from cookie or Authorization header ----------
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  const token = bearer || getCookie(c, 'aura_token')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJwt(token, jwtSecret(c))
  if (!payload) return c.json({ error: 'Invalid or expired token' }, 401)

  // Re-validate role + status server-side on EVERY request (never trust the token alone)
  const row = await c.env.DB.prepare('SELECT role, status FROM users WHERE id = ?')
    .bind(payload.sub).first<{ role: string; status: string }>()
  if (!row || row.status !== 'active') return c.json({ error: 'Account unavailable' }, 403)
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
