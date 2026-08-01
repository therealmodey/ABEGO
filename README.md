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

## Premium Interaction Layer (2026-07-17)
Apple-level interaction refinement — visual design system untouched, behavior only:
- **Motion system**: screen crossfades (fade + 8–16px vertical, 350–500ms, `cubic-bezier(0.22,1,0.36,1)`), `navToken`-guarded router transitions, `prefers-reduced-motion` respected, GPU transforms only
- **Modal manager** (`Aura.openModal`): body scroll lock while open, sheets capped at 90dvh with internal scroll + `overscroll-behavior: contain`, animated open (fade + scale 0.96→1.0) and reverse close
- **Slider engine** (`Aura.attachSlider`): rAF-batched drag with zero re-renders, local state during drag, commit only on release, glow intensifies while dragging, haptic tick on release (`navigator.vibrate`)
- **Customize / Quick Start sheets**: render-once with targeted span patches — no card re-render during interaction
- **Viewport-perfect layout**: every core screen fits 100dvh with no scroll (flex column, bottom-anchored CTAs via `.cta-anchor`, height-based compression at ≤740px/≤640px); list-heavy routes opt out via `.screen--scroll`
- **Session completion**: primary "Return Home" CTA anchored to bottom safe area, secondary "View Insights", session state fully reset — no dead-ends
- **Loading states**: pulsing orb (`.orb-loading`) — never static spinners
- **Prod checklist**: create real D1 (`wrangler d1 create webapp-production`, update `database_id` in `wrangler.jsonc`), apply migrations `--remote`, run seed, set secrets `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`, then `wrangler pages deploy dist`
- **Last Updated**: 2026-07-17

## Design-System Refinement (2026-07-26)
UX flows, structure and logic untouched — UI, bugs, code quality and behavior only:
- **Light mode + theme engine** (`Aura.Theme`): `html[data-theme="light"]` token layer (luminous morning-sky backgrounds, frosted-white glass, soft-ink text per handoff `light_tokens`); applied at parse time (zero wrong-theme flash); switch crossfades ~250ms (`html.theme-switching` fades `#app` out → swap → in); persisted in `localStorage.aura_theme` **and** account prefs (`mode`) so it follows the user; `<meta theme-color>` synced; covers app, pricing, billing and admin
- **Settings are 100% functional** (`Aura.Prefs` store with side effects):
  - *Haptics* → gates real `navigator.vibrate` pulses (phase changes, slider/toggle ticks)
  - *Sound* → real WebAudio tone engine (`Aura.Tone`): per-phase sine swells (inhale 220Hz / hold 262 / exhale 174) with gain envelopes; in-session sound button toggles it live; stopped on pause/complete
  - *Aura glow* → `html[data-glow]` drives orb aura strength; *Theme intensity* slider → `--bg-vis` drives ambient background live while dragging
  - *Appearance* → Dark/Light segmented control in Settings
- **Orb color transitions fixed**: gradients can't interpolate, so each blob carries an `.orb-fade` overlay — next phase's gradient fades in over it (600–1200ms, ease-in-out, scaled to phase length), then promotes to the base layer; box-shadows ease natively; same-phase renders skip color work entirely (`data-phase` guard)
- **Guided-journey bug fixed (was: "Body Scan missing under Sleep")**: programs now carry an `intents` column (migration `0002`, e.g. body-scan → `sleep,stress,calm`); category chips filter on intents *or* display tag — Sleep now correctly lists 4-7-8 Unwind, Twilight Descent **and** Body Scan (verified via API + jsdom UI test)
- **Swipe-back navigation**: iOS-style left-edge gesture on all back-capable routes (`BACK_TARGET` map) — follows the finger with resistance + fade, commits past 35% width or on a fast flick, springs back otherwise; vertical-scroll intent bails out; blocked inside sessions and open modals
- **Return-Home resilience**: router now probes `/auth/me` once before bouncing an unauthenticated-looking user to welcome — recovers cleanly when local user state is lost while the auth cookie/token is still valid (this was the reported "Return Home lands on sign-in" failure mode; jsdom repro passes)
- **Code cleanup**: ~26 hardcoded color literals replaced with theme tokens (`--hairline`, `--ink-*`, `--dot-dim`, `--bar-empty`, `--veil-bg`, …); light-safe `.wordmark-grad`; shared `screenHeader` / `wireBack` / `loadingScreen` helpers; missing violet background variant added for both themes
- **Last Updated**: 2026-07-26

## Super Command Centre v2 — Full Admin Rebuild (2026-08-01)
Complete rebuild of the admin dashboard treating the `handoff3` design ZIP as **full source of truth** — every UI element in the design is implemented, including features with no prior backend (mocked with clearly-defined schemas). The previous 5-view admin is fully replaced.

### 12 views (11 sidebar sections + Settings footer)
| Route | View | Data |
|---|---|---|
| `#/overview` | Overview — 4 KPIs, sessions×calm chart, D7 retention donut, AI adaptation events, geo globe, top programs, system pulse, activity | **real** analytics + mock SCC |
| `#/live` | Mission Control — 5 live stats, globe, session timeline, phase distribution donut, anomaly boxes, 9-row live session table | mock |
| `#/ai` | AI Engine — model KPIs, 5 tuning sliders, 5 feature flags, live decision preview (input→model→4·7·8 output), rollout bar, effectiveness A/B chart | mock (PUT stubs audit-logged) |
| `#/analytics` | Analytics — cohort retention grid, activation funnel, calm-over-time (real D1 footnote), stress↓calm scatter r=0.68, drop-off bars | mock + **real** |
| `#/biometrics` | Biometrics — HR start-vs-end chart, segment rows, weekly usage heatmap, stress-reduction arc, HRV coherence | mock |
| `#/programs` | Programs — design cards w/ colored orbs + 3-stat rows + sparklines; **real** `is_premium`/`is_new`/`active` toggles (PUT round-trip), drop-off by program, completion trend | **real** + derived |
| `#/experiments` | Experiments — featured A/B card w/ winner tag + lift chart, 6-row experiments table w/ confidence bars, status tags | mock |
| `#/notifications` | Notifications — visual rule builder (WHEN/AND/THEN blocks), iOS lock-screen preview, 8 active rules w/ toggles (PUT stub, audit-logged) | mock |
| `#/revenue` | Revenue — MRR stacked bars (new/expansion/churn), plan-mix donut merged w/ **real** D1 plans, paywall funnel, LTV by cohort | mock + **real** |
| `#/health` | System Health — status banner w/ region dots, latency percentiles p50/p95/p99, 10 service rows, sensory reliability donut, by-device bars, incident log w/ codes | mock |
| `#/users` | Users — **real** D1 table (search `/` key, tier filter, pagination) + design detail panel (zap badge, live-session box, 4 stat boxes, calm trend, activity timeline, Impersonate/Add note/Full profile stubs) + **real** promote/demote/suspend/reactivate/delete w/ confirm modals | **real** + mock enrich |
| `#/settings` | Settings & Audit — workspace/compliance cards + full **real** audit-log table | **real** |

Legacy hashes still work: `#/dashboard`→overview, `#/content`→programs, `#/audit`→settings.

### New backend layer (`/api/admin/scc/*`)
- `GET /api/admin/scc/:module` — deterministic mock data for 9 modules (`overview live ai biometrics experiments notifications revenue health analytics`), returns `{module, mock:true, data}`; schema contracts documented in `src/routes/admin.ts` for future real-pipeline integration
- `PUT /api/admin/scc/ai` — validated AI-config stub (sliders/flags), audit-logged as `ai_config_update`, returns `persisted:false`
- `PUT /api/admin/scc/notifications/:id` — rule-toggle stub, audit-logged as `notification_rule_toggle`
- All pre-existing admin endpoints unchanged; nothing in the user app pipeline touched

### Frontend architecture
- `public/static/admin.js` (~1,670 lines): vanilla-JS SPA — local `AIC_PATHS` icon set (38 SVG icons from the handoff AdminIcon), pure-SVG chart library (multi-series lines, bars, donuts, globe, heatmap, cohort grid, funnel, scatter, stress arc, stacked bars), client-side `sccCache`, ⌘K global search → users view
- Dark + light mode via existing `Aura.Theme`; staggered `sccIn` panel animations; responsive collapses at 1180px/900px
- Completeness audit: 192 `scc-*` classes used, 0 missing from CSS; 40/40 handoff design elements verified present

### Verified (2026-08-01)
jsdom E2E: login → all 12 views render (nav=11, live rows=9, AI sliders=5, heatmap rows=7, experiment rows=6, rules=8, services=10, incidents=5), program-toggle + notification-toggle round-trips, user search/select/detail, audit rows, legacy aliases, theme toggle — **ALL PASS**, zero console errors. All 4 prior regression suites (session flow, state-loss recovery, programs filter, theme engine) PASS.

## Features Not Yet Implemented
- Real payment-provider round-trip (needs live Stripe/Paystack keys — simulation covers the flow today)
- Email notifications (receipts, dunning) and password reset
- Reminders toggle is persisted but push/local notifications need a service worker + permission flow
- Team/family plans, proration on mid-cycle upgrades

## Recommended Next Steps
1. Deploy to Cloudflare Pages with real D1 + secrets
2. Plug in live Stripe/Paystack keys and register webhook endpoints
3. Add password reset + transactional email (Resend/SendGrid)
4. Swap the rule-based suggestion engine for an LLM-backed one via an AI API
