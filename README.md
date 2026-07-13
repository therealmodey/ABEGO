# AURA — Breathe with Intention

A production-ready guided-breathing SaaS built from the 25-artboard AURA design handoff: liquid-orb breathing sessions, mood-aware AI suggestions, freemium monetization (Stripe + Paystack), and a full admin console — all on the Cloudflare edge.

## Project Overview
- **Name**: AURA (project code: webapp)
- **Goal**: Convert the high-fidelity AURA design system into a startup-ready product: auth, breathing sessions, smart personalization, subscriptions, and RBAC admin.
- **Design fidelity**: Exact tokens honored — bg `#0B0F1A`, brand `#7C3AED→#22D3EE`, phase colors `#60A5FA / #A78BFA / #34D399`, 4000ms breathe transitions, glassmorphism, amber-only errors.

## URLs
- **Sandbox (dev)**: https://3000-ia43ccw2kmvyc6mb46wnh-82b888ba.sandbox.novita.ai
- **Production**: not yet deployed (see Deployment below)
- **Pages**: `/` (app SPA) · `/pricing` · `/billing` · `/admin`
- **Health**: `GET /api/health`

## Demo Accounts
| Role | Email | Password |
|---|---|---|
| Admin | `admin@aura.app` | `Admin123!` |
| User | `test@example.com` | `Test1234!` |

> ⚠️ Change the admin password and set a real `JWT_SECRET` before production deploy.

## Currently Completed Features
### Core product
- Signup / login / logout / me — PBKDF2 (100k iters) + HS256 JWT (Web Crypto only, Workers-safe), httpOnly cookie + Bearer
- 18-screen SPA replicating the design: splash → welcome → auth → onboarding (how-it-works, personalize, permissions) → home with liquid orb → session engine (inhale/hold/exhale state machine, pause veil, completion stats) → mood check-in → stats → programs → session setup sheet → history → profile → settings
- Breathing session engine: 1s tick, phase-colored orb morphing, progress ring, cycle tracking
- Mood check-ins with rule-based AI: anxious→4-7-8, calm→box, tired→6-2-4 energizing, focused→coherent 5-0-5, with evening pace adaptation
- Smart insights: calm score (70% 7-day avg + 25% consistency + mood boost), streaks, daily bars, time-of-day insight generation
- 6 seeded programs across 3 categories (2 free, 4 premium)

### Admin access system (Part 2)
- RBAC `user`/`admin`; role re-validated from DB on **every** request (JWT never trusted alone)
- Seeded initial admin; signup role hard-coded to `user` (no self-promotion possible)
- Admin console at `/admin`: Dashboard (KPIs, plan distribution, 14-day signup chart), Users (search, paginate, promote/demote/suspend/reactivate/delete with confirmation modals), Analytics, Content (program toggles), Audit logs
- Safety rails: can't change own role, can't demote last admin, admins can't be suspended/deleted, soft-delete with email mangling
- Every admin action audited (action, target, detail JSON, IP); user activity logged
- Rate limiting: signup 10/5min, login 15/5min, checkout 10/min, admin surface 120/min

### Monetization (Part 3)
- Freemium tiers: **Free** (3 sessions/day, beginner programs) · **Pro** $9.99/mo or $71.88/yr · **Premium** $19.99/mo or $143.88/yr (yearly = 40% off)
- Stripe Checkout (global, USD) + Paystack (Nigeria, NGN @ ₦1600 rate) via raw REST — no SDKs
- Webhooks with signature verification: Stripe HMAC-SHA256, Paystack HMAC-SHA512
- **Sandbox simulation**: when API keys are absent, checkout instantly activates the plan so the whole flow is testable
- Server-side feature gating: daily usage metering (`usage_counters`), premium program locks, Pro-only deep analytics — all return HTTP 402 → frontend upgrade modal
- High-conversion `/pricing`: hero, monthly/yearly toggle, "✦ MOST POPULAR" Pro card, provider picker (Stripe / 🇳🇬 Paystack), trust signals, comparison table, FAQ accordion
- `/billing` dashboard: current plan, renew/end dates, upgrade & cancel (with confirmation), payment history

### Performance
- In-memory per-isolate TTL cache: programs 300s, user stats 60s, admin analytics 30s (invalidated on writes)
- 14 covering DB indexes on hot paths (sessions by user+time, active subscriptions, payments by provider ref, etc.)
- Single 58 KB worker bundle; CDN-only frontend deps (axios); system-font-fallback Inter

## Functional API Surface
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | — | rate-limited, creates profile + free sub |
| POST | `/api/auth/login` | — | 403 if suspended |
| POST | `/api/auth/logout` · GET `/api/auth/me` | user | |
| PUT | `/api/app/profile` | user | onboarding prefs |
| GET | `/api/app/programs` | user | cached, `locked` flags |
| POST | `/api/app/sessions/start` | user | 402 on free daily limit / premium program |
| POST | `/api/app/sessions/:id/complete` | user | computes consistency + calm score |
| GET | `/api/app/history` · `/api/app/stats` | user | stats cached 60s |
| GET | `/api/app/stats/deep` | pro+ | 402 otherwise |
| POST | `/api/app/moods` | user | returns AI suggestion |
| GET | `/api/billing/plans` | — | catalog |
| GET | `/api/billing/me` | user | sub + payment history |
| POST | `/api/billing/checkout` | user | `{plan, cycle, provider}` → checkout URL or simulated activation |
| POST | `/api/billing/cancel` | user | reverts to free |
| POST | `/api/billing/webhooks/stripe` · `/paystack` | signature | |
| GET | `/api/admin/users` | admin | search + pagination |
| PUT | `/api/admin/users/:id/role` · `/status` | admin | audited, safety rails |
| DELETE | `/api/admin/users/:id` | admin | soft delete |
| GET | `/api/admin/analytics` | admin | cached 30s |
| GET | `/api/admin/audit-logs` · `/activity-logs` | admin | |
| GET/PUT | `/api/admin/programs(/:id)` | admin | content management |

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) — binding `DB`, database `webapp-production` (local dev via `--local`)
- **Tables**: `users`, `profiles`, `programs`, `sessions`, `moods`, `subscriptions`, `payments`, `usage_counters`, `activity_logs`, `audit_logs`
- **Indexes**: 14 covering indexes (see `migrations/0001_initial_schema.sql`)
- **Data flow**: SPA (axios + Bearer JWT) → Hono API → D1; hot reads served from in-isolate TTL cache

## User Guide
1. Open the app → splash → **Get started** → sign up
2. Complete onboarding (stress level, goal, session length)
3. On Home, tap the orb (or long-press the FAB for quick start) to begin a breathing session; follow inhale/hold/exhale cues
4. Check in your mood — AURA suggests a matching pattern
5. Explore **Programs** (premium ones show a lock → upgrade modal), **Stats**, **History**, **Profile/Settings**
6. Upgrade at `/pricing` (in sandbox mode checkout activates instantly); manage/cancel at `/billing`
7. Admins: log in as `admin@aura.app` → auto-redirected to `/admin`

## Development
```bash
npm run build                                              # vite build → dist/
npx wrangler d1 migrations apply webapp-production --local # apply schema
npx wrangler d1 execute webapp-production --local --file=./seed.sql
pm2 start ecosystem.config.cjs                             # wrangler pages dev on :3000
```

## Deployment
- **Platform**: Cloudflare Pages (not yet deployed to production)
- **Status**: ✅ Active in sandbox (PM2 + wrangler pages dev, local D1)
- **Tech Stack**: Hono 4 + TypeScript + Cloudflare D1 + vanilla-JS SPA + hand-rolled design-token CSS
- **Prod checklist**: create real D1 (`wrangler d1 create webapp-production`, update `database_id` in `wrangler.jsonc`), apply migrations `--remote`, run seed, set secrets `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`, then `wrangler pages deploy dist`
- **Last Updated**: 2026-07-13

## Features Not Yet Implemented
- Real payment-provider round-trip (needs live Stripe/Paystack keys — simulation covers the flow today)
- Email notifications (receipts, dunning) and password reset
- Haptics/audio guidance toggles are stored but not wired to real device APIs
- Team/family plans, proration on mid-cycle upgrades

## Recommended Next Steps
1. Deploy to Cloudflare Pages with real D1 + secrets
2. Plug in live Stripe/Paystack keys and register webhook endpoints
3. Add password reset + transactional email (Resend/SendGrid)
4. Swap the rule-based suggestion engine for an LLM-backed one via an AI API
