// Monetization: plans, Stripe + Paystack checkout, webhooks, billing dashboard data
import { Hono } from 'hono'
import {
  type AppEnv, requireAuth, rateLimit, getActivePlan, logActivity, clientIp, cacheDel,
  timingSafeEqualStr, hex,
} from '../lib/middleware'

const billing = new Hono<AppEnv>()

// ---------- Plan catalog (single source of truth) ----------
export const PLANS = {
  free: {
    name: 'Free', monthly: 0, yearly: 0,
    features: ['3 sessions per day', 'Beginner programs', 'Basic weekly stats', 'Mood check-ins (2/day)'],
  },
  pro: {
    name: 'Pro', monthly: 999, yearly: 7188, // cents — yearly = $5.99/mo (SAVE 40%)
    features: ['Unlimited sessions', 'All guided programs', 'AI adaptive pacing', 'Deep analytics & trends', 'Session history export'],
  },
  premium: {
    name: 'Premium', monthly: 1999, yearly: 14388, // yearly = $11.99/mo
    features: ['Everything in Pro', 'Spatial soundscapes', 'Personalized weekly plans', 'Data export & integrations', 'Priority support'],
  },
} as const

const NGN_RATE = 1600 // USD→NGN for Paystack charges

billing.get('/plans', (c) => {
  return c.json({
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id, name: p.name,
      monthly_usd: p.monthly / 100, yearly_usd: p.yearly / 100,
      yearly_monthly_equiv: +(p.yearly / 1200).toFixed(2),
      features: p.features,
    })),
  })
})

// ---------- Current subscription + payment history ----------
billing.get('/me', requireAuth, async (c) => {
  const u = c.get('user')
  const [sub, payments] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plan, billing_cycle, status, provider, start_date, end_date FROM subscriptions
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(u.sub).first(),
    c.env.DB.prepare(
      `SELECT id, amount_cents, currency, provider, status, description, created_at FROM payments
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(u.sub).all(),
  ])
  const plan = await getActivePlan(c.env.DB, u.sub)
  return c.json({ plan, subscription: sub, payments: payments.results })
})

// ---------- Checkout ----------
// POST /api/billing/checkout { plan: 'pro'|'premium', cycle: 'monthly'|'yearly', provider: 'stripe'|'paystack' }
billing.post('/checkout', requireAuth, rateLimit(10, 60, 'checkout'), async (c) => {
  const u = c.get('user')
  const b = await c.req.json().catch(() => ({}))
  const plan = b.plan as 'pro' | 'premium'
  const cycle = b.cycle === 'yearly' ? 'yearly' : 'monthly'
  const provider = b.provider === 'paystack' ? 'paystack' : 'stripe'
  if (!PLANS[plan] || plan === ('free' as never)) return c.json({ error: 'Invalid plan' }, 400)

  const amountCents = cycle === 'yearly' ? PLANS[plan].yearly : PLANS[plan].monthly
  const origin = new URL(c.req.url).origin

  if (provider === 'stripe') {
    const key = c.env.STRIPE_SECRET_KEY
    if (!key) {
      // Sandbox fallback: simulate checkout so full flow is testable without keys
      return simulateCheckout(c, u.sub, plan, cycle, 'stripe', amountCents, 'USD')
    }
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': `AURA ${PLANS[plan].name} (${cycle})`,
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][recurring][interval]': cycle === 'yearly' ? 'year' : 'month',
      'line_items[0][quantity]': '1',
      success_url: `${origin}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?status=canceled`,
      'metadata[user_id]': String(u.sub),
      'metadata[plan]': plan,
      'metadata[cycle]': cycle,
      customer_email: u.email,
    })
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const data = await res.json() as any
    if (!res.ok) return c.json({ error: data?.error?.message || 'Stripe error' }, 502)
    return c.json({ checkout_url: data.url, provider: 'stripe' })
  }

  // Paystack (NGN)
  const key = c.env.PAYSTACK_SECRET_KEY
  const amountKobo = Math.round((amountCents / 100) * NGN_RATE * 100)
  if (!key) {
    return simulateCheckout(c, u.sub, plan, cycle, 'paystack', amountKobo, 'NGN')
  }
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: u.email, amount: amountKobo, currency: 'NGN',
      callback_url: `${origin}/billing?status=success`,
      metadata: { user_id: u.sub, plan, cycle },
    }),
  })
  const data = await res.json() as any
  if (!res.ok || !data.status) return c.json({ error: data?.message || 'Paystack error' }, 502)
  return c.json({ checkout_url: data.data.authorization_url, provider: 'paystack' })
})

// Sandbox simulation: instantly activates the plan and records payment.
// SECURITY: this hands out paid plans for free, so it is opt-in via the
// ALLOW_SIM_CHECKOUT var and never reachable just because keys are absent.
export const simCheckoutEnabled = (c: any) => c.env.ALLOW_SIM_CHECKOUT === '1'

async function simulateCheckout(c: any, userId: number, plan: string, cycle: string, provider: string, amount: number, currency: string) {
  if (!simCheckoutEnabled(c)) {
    return c.json({
      error: 'Payments are not configured on this environment.',
      code: 'payments_unavailable',
    }, 503)
  }
  await activatePlan(c.env.DB, userId, plan as 'pro' | 'premium', cycle as 'monthly' | 'yearly', provider as 'stripe' | 'paystack', `sim_${Date.now()}`, amount, currency)
  await logActivity(c.env.DB, userId, 'plan_activated_simulated', { plan, cycle, provider }, clientIp(c))
  return c.json({ simulated: true, activated: true, plan, cycle, provider, message: `${provider} keys not configured, so the plan was activated in sandbox mode.` })
}

export async function activatePlan(
  db: D1Database, userId: number, plan: 'pro' | 'premium', cycle: 'monthly' | 'yearly',
  provider: 'stripe' | 'paystack', providerRef: string, amount: number, currency: string
) {
  const endDate = cycle === 'yearly' ? "datetime('now','+1 year')" : "datetime('now','+1 month')"
  await db.batch([
    db.prepare("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'").bind(userId),
    db.prepare(
      `INSERT INTO subscriptions (user_id, plan, billing_cycle, status, provider, provider_ref, end_date)
       VALUES (?, ?, ?, 'active', ?, ?, ${endDate})`
    ).bind(userId, plan, cycle, provider, providerRef),
    db.prepare(
      `INSERT INTO payments (user_id, amount_cents, currency, provider, provider_ref, status, description)
       VALUES (?, ?, ?, ?, ?, 'succeeded', ?)`
    ).bind(userId, amount, currency, provider, providerRef, `AURA ${plan} · ${cycle}`),
  ])
  cacheDel(`stats:${userId}`)
}

// ---------- Cancel subscription ----------
billing.post('/cancel', requireAuth, async (c) => {
  const u = c.get('user')
  const sub = await c.env.DB.prepare(
    "SELECT id, plan FROM subscriptions WHERE user_id = ? AND status = 'active' AND plan != 'free' ORDER BY id DESC LIMIT 1"
  ).bind(u.sub).first<{ id: number; plan: string }>()
  if (!sub) return c.json({ error: 'No active paid subscription to cancel.' }, 404)

  // Cancel = remains active until end_date, then falls back to free
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE id = ?").bind(sub.id),
    c.env.DB.prepare("INSERT INTO subscriptions (user_id, plan, status) VALUES (?, 'free', 'active')").bind(u.sub),
  ])
  await logActivity(c.env.DB, u.sub, 'subscription_canceled', { plan: sub.plan }, clientIp(c))
  return c.json({ ok: true, message: 'Subscription canceled. You have been moved to the Free plan.' })
})

// ---------- Webhook idempotency ----------
// Returns true if this provider/event pair is new (and claims it); false if it
// was already processed. Unique index on (provider, event_id) does the work.
export async function claimWebhookEvent(db: D1Database, provider: string, eventId: string): Promise<boolean> {
  if (!eventId) return true // nothing to dedupe on; process once, best effort
  try {
    const res = await db.prepare(
      'INSERT OR IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)'
    ).bind(provider, eventId).run()
    return (res.meta?.changes ?? 0) > 0
  } catch {
    return true // never let the dedupe table break real payment processing
  }
}

// ---------- Webhooks ----------
// Stripe: verifies signature via HMAC-SHA256 of `${t}.${payload}`
billing.post('/webhooks/stripe', async (c) => {
  const payload = await c.req.text()
  const sigHeader = c.req.header('Stripe-Signature') || ''
  const secret = c.env.STRIPE_WEBHOOK_SECRET

  // SECURITY: verification is unconditional. Without a configured secret the
  // endpoint cannot be trusted at all, so it refuses instead of accepting.
  if (!secret) return c.json({ error: 'Webhook not configured' }, 503)

  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]))
  const t = parts['t'], v1 = parts['v1']
  if (!t || !v1) return c.json({ error: 'Bad signature header' }, 400)
  const ts = parseInt(t, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return c.json({ error: 'Timestamp outside tolerance' }, 400)
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  if (!timingSafeEqualStr(hex(mac), v1)) return c.json({ error: 'Invalid signature' }, 400)

  let event: any
  try { event = JSON.parse(payload) } catch { return c.json({ error: 'Invalid JSON payload' }, 400) }

  // Replay/idempotency guard: a valid event may legitimately be delivered more
  // than once; without this, a replay stacks subscriptions and payment rows.
  if (!(await claimWebhookEvent(c.env.DB, 'stripe', String(event.id || '')))) {
    return c.json({ received: true, duplicate: true })
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object
    const userId = parseInt(s.metadata?.user_id, 10)
    const plan = s.metadata?.plan as 'pro' | 'premium'
    const cycle = (s.metadata?.cycle || 'monthly') as 'monthly' | 'yearly'
    if (userId && (plan === 'pro' || plan === 'premium')) {
      await activatePlan(c.env.DB, userId, plan, cycle, 'stripe', s.id, s.amount_total ?? 0, (s.currency || 'usd').toUpperCase())
    }
  } else if (event.type === 'invoice.payment_failed') {
    const customerEmail = event.data.object?.customer_email
    if (customerEmail) {
      const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(customerEmail).first<{ id: number }>()
      if (user) await c.env.DB.prepare("UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now') WHERE user_id = ? AND status = 'active' AND plan != 'free'").bind(user.id).run()
    }
  }
  return c.json({ received: true })
})

// Paystack: verifies x-paystack-signature (HMAC-SHA512 of body with secret key)
billing.post('/webhooks/paystack', async (c) => {
  const payload = await c.req.text()
  const sig = c.req.header('x-paystack-signature') || ''
  // Paystack signs with the live secret key; allow a dedicated override.
  const secret = c.env.PAYSTACK_WEBHOOK_SECRET || c.env.PAYSTACK_SECRET_KEY

  if (!secret) return c.json({ error: 'Webhook not configured' }, 503)
  if (!sig) return c.json({ error: 'Missing signature' }, 400)

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  if (!timingSafeEqualStr(hex(mac), sig)) return c.json({ error: 'Invalid signature' }, 400)

  let event: any
  try { event = JSON.parse(payload) } catch { return c.json({ error: 'Invalid JSON payload' }, 400) }

  const eventId = String(event.data?.id || event.data?.reference || '')
  if (!(await claimWebhookEvent(c.env.DB, 'paystack', eventId))) {
    return c.json({ received: true, duplicate: true })
  }

  if (event.event === 'charge.success') {
    const d = event.data
    const userId = parseInt(d.metadata?.user_id, 10)
    const plan = d.metadata?.plan as 'pro' | 'premium'
    const cycle = (d.metadata?.cycle || 'monthly') as 'monthly' | 'yearly'
    if (userId && (plan === 'pro' || plan === 'premium')) {
      await activatePlan(c.env.DB, userId, plan, cycle, 'paystack', d.reference, d.amount, 'NGN')
    }
  }
  return c.json({ received: true })
})

export default billing
