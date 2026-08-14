# AURA — Breathe with Intention

A production-ready guided-breathing SaaS built from the 25-artboard AURA design handoff: liquid-orb breathing sessions, mood-aware AI suggestions, freemium monetization (Stripe + Paystack), and a full admin console — all on the Cloudflare edge.

## Project Overview
- **Name**: AURA (project code: webapp)
- **Goal**: Convert the high-fidelity AURA design system into a startup-ready product: auth, breathing sessions, smart personalization, subscriptions, and RBAC admin.
- **Design fidelity**: Exact tokens honored — bg `#0B0F1A`, brand `#7C3AED→#22D3EE`, phase colors `#60A5FA / #A78BFA / #34D399`, 4000ms breathe transitions, glassmorphism, amber-only errors.

## URLs
- **Local dev**: `npm install && npm run dev` → http://localhost:5173 (the sandbox above is no longer reachable; run locally to exercise the current code, including the Authentication & Account Security flow)
- **Production**: not yet deployed (see Deployment below)
- **Pages**: `/` (app SPA) · `/pricing` · `/billing` · `/admin`
- **Health**: `GET /api/health`

## First Admin Account

No account is seeded — credentials are never committed to this repo. Create the
first admin locally or in production with:

```bash
node scripts/bootstrap-admin.mjs you@example.com 'a-strong-password' > /tmp/admin.sql
npx wrangler d1 execute webapp-production --local  --file=/tmp/admin.sql   # dev
npx wrangler d1 execute webapp-production --remote --file=/tmp/admin.sql   # prod
rm /tmp/admin.sql
```

Regular users sign up through the app at `/`.

> ⚠️ `JWT_SECRET` is required (min 32 chars) — the app fails closed without it.
> Generate one with `openssl rand -base64 48`.

## Currently Completed Features
### Core product
- Signup / login / logout / me — PBKDF2 (100k iters) + HS256 JWT (Web Crypto only, Workers-safe), httpOnly cookie + Bearer; logout revokes the token server-side
- Full auth flow: email verification (dev code in dev), forgot → reset (token-from-URL works from emailed links), change password (signs out other devices), and a complete **Account & Security** surface (sign out everywhere, export data, delete account with 3-step confirmation)
- 18-screen SPA replicating the design: splash → welcome → auth → onboarding (soft entry, how-it-works, live demo, personalize, intent, preview/recommend, permissions, transition) → home with liquid orb → session engine (inhale/hold/exhale state machine, pause veil, completion stats) → mood check-in → stats → programs → session setup sheet → history → profile → settings
- Breathing session engine: 1s tick, phase-colored orb morphing, progress ring, cycle tracking
- Mood check-ins with rule-based AI: anxious→4-7-8, calm→box, tired→6-2-4 energizing, focused→coherent 5-0-5, with evening pace adaptation
- Smart insights: calm score (70% 7-day avg + 25% consistency + mood boost), streaks, daily bars, time-of-day insight generation
- 18 seeded programs across 4 intent categories — Stress / Sleep / Focus / Calm (10 free, 8 premium); each carries `intents` so the Library filter pills (All/Stress/Sleep/Focus/Calm) surface cross-intent programs via `matchesFilter`

### Admin access system (Part 2)
- RBAC `user`/`admin`; role re-validated from DB on **every** request (JWT never trusted alone)
- First admin created via `scripts/bootstrap-admin.mjs` (never seeded, no committed credentials); signup role hard-coded to `user` (no self-promotion possible)
- Admin console at `/admin`: Dashboard (KPIs, plan distribution, 14-day signup chart), Users (search, paginate, promote/demote/suspend/reactivate/delete with confirmation modals), Analytics, Content (program toggles), Audit logs
- Safety rails: can't change own role, can't demote last admin, admins can't be suspended/deleted, soft-delete with email mangling; role change / suspend / delete invalidate the target's sessions immediately
- Every admin action audited (action, target, detail JSON, IP); user activity logged

### Account & Security (Part 3)
- **Email verification**: signup returns `requiresVerification`; `/auth/verify/send` + `/auth/verify/confirm` (unauthenticated), `users.email_verified` gate
- **Password reset**: `/auth/forgot` issues a reset token; `/auth/reset` consumes it. Reset links carry the token in the URL (`#reset?token=…`), so an emailed link lands directly on the reset screen — no dead-end
- **Change password** (`/account/password`, authed): re-authenticates current password, updates hash, and bumps `token_version` to sign out every other device while keeping the current one
- **Sign out everywhere** (`/account/sign-out-others`): revokes all sessions except the current one (token-version bump)
- **Export data** (`/account/export`): queues a secure archive (session history, biometrics, preferences, insights) emailed to the user
- **Delete account** (`/account/delete/verify` → `/account/delete/confirm`): 3-step confirmation (warn → confirm password + acknowledge export → type `DELETE`), hard-deletes the user and cascades
- **Frontend**: 17 vanilla-JS screens registered on `window.AuraApp.routes` (login, signup, forgot, forgotSent, reset, resetSuccess, verify, verifySuccess, security, dataPrivacy, changePassword, signOutAll, exportData, deleteWarn, deleteConfirm, deleteFinal, deleteSuccess) — every screen has a forward CTA and a safe exit, no dead ends
- Backed by migration `0006_account_security.sql` (email_verified, verify/reset code tables, sessions registry, export requests)
- Rate limiting: signup 10/5min, login 15/5min, checkout 10/min, admin surface 120/min

### Monetization (Part 3)
- Freemium tiers: **Free** (3 sessions/day, beginner programs) · **Pro** $9.99/mo or $71.88/yr · **Premium** $19.99/mo or $143.88/yr (yearly = 40% off)
- Stripe Checkout (global, USD) + Paystack (Nigeria, NGN @ ₦1600 rate) via raw REST — no SDKs
- Webhooks with **mandatory** signature verification: Stripe HMAC-SHA256 (+ 300s timestamp window), Paystack HMAC-SHA512, replay-protected via `webhook_events`; 503 until the signing secret is configured
- **Sandbox simulation**: with no payment keys, checkout returns `503 payments_unavailable` unless `ALLOW_SIM_CHECKOUT="1"` is set, which activates the plan instantly so the flow stays testable (never set it in production — it grants paid plans for free)
- Server-side feature gating: daily usage metering (`usage_counters`), premium program locks, Pro-only deep analytics — all return HTTP 402 → frontend upgrade modal
- High-conversion `/pricing`: hero, monthly/yearly toggle, "✦ MOST POPULAR" Pro card, provider picker (Stripe / 🇳🇬 Paystack), trust signals, comparison table, FAQ accordion
- `/billing` dashboard: current plan, renew/end dates, upgrade & cancel (with confirmation), payment history

### Performance
- In-memory per-isolate TTL cache: programs 300s, user stats 60s, admin analytics 30s (invalidated on writes)
- 14 covering DB indexes on hot paths (sessions by user+time, active subscriptions, payments by provider ref, etc.)
- Single ~88 KB worker bundle; CDN-only frontend deps (axios); system-font-fallback Inter

## Functional API Surface
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | — | rate-limited, creates profile + free sub |
| POST | `/api/auth/login` | — | 403 if suspended |
| POST | `/api/auth/logout` · GET `/api/auth/me` | user | logout revokes that token's `jti` |
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
| POST | `/api/billing/webhooks/stripe` · `/paystack` | signature | verified + deduped; 503 if unconfigured |
| GET | `/api/admin/users` | admin | search + pagination |
| PUT | `/api/admin/users/:id/role` · `/status` | admin | audited, safety rails |
| DELETE | `/api/admin/users/:id` | admin | soft delete |
| GET | `/api/admin/analytics` | admin | cached 30s |
| GET | `/api/admin/audit-logs` · `/activity-logs` | admin | |
| GET/PUT | `/api/admin/programs(/:id)` | admin | content management |

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) — binding `DB`, database `webapp-production` (local dev via `--local`)
- **Tables**: `users` (incl. `token_version`), `profiles`, `programs`, `sessions`, `moods`, `subscriptions`, `payments`, `usage_counters`, `activity_logs`, `audit_logs`, `app_config`, `notification_rules`, `experiments`, `admin_notes`, `webhook_events`, `revoked_tokens`
- **Indexes**: 14 covering indexes (see `migrations/0001_initial_schema.sql`)
- **Data flow**: SPA (axios + Bearer JWT) → Hono API → D1; hot reads served from in-isolate TTL cache

## User Guide
1. Open the app → splash → **Get started** → sign up
2. Complete onboarding — soft entry, how-it-works, live demo, then personalize (stress level, session length), pick an **intent** (ease / clarity / rest), and grant permissions (sound, haptics, reminders); preferences commit via `PUT /profile`
3. On Home, tap the orb (or long-press the FAB for quick start) to begin a breathing session; follow inhale/hold/exhale cues
4. Check in your mood — AURA suggests a matching pattern
5. Explore **Programs** (premium ones show a lock → upgrade modal), **Stats**, **History**, **Profile/Settings**
6. Upgrade at `/pricing`; manage/cancel at `/billing`. With no payment keys configured, checkout returns
   `503 payments_unavailable` unless `ALLOW_SIM_CHECKOUT="1"` is set (never set it in production — it
   activates paid plans for free)
7. Admins: log in with the bootstrapped admin account → auto-redirected to `/admin`

## Development
```bash
npm run build                                              # vite build → dist/
npx wrangler d1 migrations apply webapp-production --local # apply schema
npx wrangler d1 execute webapp-production --local --file=./seed.sql        # programs/content only
pm2 start ecosystem.config.cjs                             # wrangler pages dev on :3000
npm test                                                   # UI suites + security invariants
```

## Deployment
- **Platform**: Cloudflare Pages (not yet deployed to production)
- **Status**: not deployed to a live environment; run locally with `npm run dev` (the previous sandbox instance is no longer reachable and was not kept in sync with `main`)
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
- **Prod checklist**: create real D1 (`wrangler d1 create webapp-production`, update `database_id` in `wrangler.jsonc`), apply migrations `--remote`, run seed, set secrets `JWT_SECRET` (required, >= 32 chars), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY` (webhooks return 503 until their secrets are set), bootstrap the admin account, leave `ALLOW_SIM_CHECKOUT` unset, set `ALLOWED_ORIGINS` only if another origin must call the API, then `wrangler pages deploy dist`
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

## Admin Functionality Pass — Every Control Wired (2026-08-02)
Every interactive element in the Super Command Centre now performs a real action, persists to D1, and (where applicable) changes the user-facing app. Zero "design stub" toasts remain.

**New persistence layer (migration `0003_admin_controls.sql`)**
- `app_config` — versioned AI engine config (`ai_config` key: 5 sliders + 5 flags)
- `notification_rules` — 8 behavioural rules (enable/disable, create)
- `experiments` — 6 experiments (pause/resume, promote winner, create)
- `admin_notes` — per-user admin notes

**Admin → user-app effects (shared `src/lib/aiconfig.ts`)**
- `POST /api/app/moods` suggestions honour published AI config: `auto_pacing` gates evening pacing, `stress_sensitivity ≥ 0.7` extends anxious exhale, `cross_session` lengthens sessions when calm trends low, `exploration` deterministically trials variants, `llm_guidance` appends guidance copy
- `GET /api/app/config` exposes flags to the client; `emotion_ambience` adds a glow to suggestion cards
- Programs toggles (active/premium) already governed real availability

**Wired controls per view**
- Topbar: range seg (24h/7d/30d/90d) refetches every module with `?range=`; bell opens a live activity popover; global search jumps to Users
- Overview: Line/Area chart toggle
- Mission Control: Globe/List panel toggle, All/Anxious/Flagged row filter, Filter = sort by stress
- AI Control: sliders + flags + Publish/Reset persist via `PUT /admin/scc/ai` (audit-logged, cache-invalidated); 30d/90d/YTD refetch
- Analytics: Weekly/Monthly cohorts, Avg/P50/P90 calm series, Export downloads real CSV
- Experiments: Pause/Resume + Promote winner persist; New experiment modal `POST`s; All/Running/Complete filter
- Notifications: rule toggles persist; Activate rule creates a real rule; Test refreshes the iOS preview; Manage templates modal
- Health: incident Timeline modal
- Users: Invite (temp password via `POST /users/invite`), Impersonate (real JWT swap — return to `/admin` to restore), Add note, Full profile + Replay modals with real telemetry (`GET /users/:id`), 3-filters popover (status/role); detail panel shows real sessions/calm/LTV/timeline

**Validation**: new jsdom suite `admin-interactions.js` (13 interaction round-trips incl. persist-verify via API) + 12-view suite + 4 regression suites — ALL PASS.

## Mood-Transition Jitter Fix (2026-08-04)
The Home-Screen mood check-in stuttered on every mood change. **Root cause: the screen re-rendered itself.** `routes.mood` held its state in closures and called `render()` → `root.innerHTML = ...` on every tap, so a single mood switch destroyed and rebuilt the entire screen. That fired four expensive things on one frame, right after a network round trip:

1. **Replayed screen enter animation** — the new `.screen` re-ran `auraScreenIn` (420ms), sliding the whole screen 12px and rescaling `0.99→1`. This was the visible "jump".
2. **Ambient-drift reset** — a brand-new `.aura-bg` restarted the 45s `auraAmbientDrift` keyframes, snapping the gradient back to `0% 0%`.
3. **Glass re-rasterization** — 4 `backdrop-filter: blur(24px) saturate(160%)` mood cards + the 8-layer star field were re-created and re-blurred from scratch.
4. **Suggestion card re-insert** — the card was re-added to the DOM, replaying its `auraSlideUp` from zero instead of updating in place.

A fifth, subtler cause: the selected-card glow **could not interpolate**. Its shadow list was ordered `[outset, inset]` while the base `.glass` shadow is `[inset, outset]`. `box-shadow` only interpolates when the `inset` keyword matches at every position — mismatched lists swap discretely at the midpoint, so the glow *snapped* instead of easing.

### What changed (motion/behaviour only — zero visual or layout change)
- **Render-once screen**: the markup is built one time; mood changes now patch only what differs. The `<section>`, `.aura-bg`, `.aura-stars`, all four cards, `#suggestion-zone` and the CTA keep their DOM identity for the whole visit — no remount, no replayed animations, no re-blur.
- **Interpolable glow**: the glow list is emitted as `[inset, outset]` (and `[inset, nil-inset, outset, nil-outset]` in light mode) so it positionally matches the active theme's `.glass` shadow and eases over 400ms. Inset and outset shadows paint strictly disjoint regions, so the reorder is pixel-neutral.
- **Single-timeline copy crossfade**: switching mood fades the suggestion body out (190ms), swaps the text at the zero-opacity midpoint, then fades back in — so any reflow from a different line count happens while invisible. No flicker, no competing transitions.
- **Non-layout properties only**: transitions are limited to `box-shadow`/`transform`/`opacity`; the card's `transition: all` was narrowed. No `height`/`width`/`margin`/`padding`/position is ever written.
- **Controlled update timing**: one state commit per tap (selection paints instantly and is never re-applied), a `reqToken` guard so an out-of-order response can never overwrite a newer mood, `pending` de-dupes double taps, and the mood POST + flags fetch now run in **parallel** instead of adding a second serial round trip.

**Validation**: `npm test` — 41 behaviour invariants (`tests/mood-transition.test.mjs`: DOM identity across 5 switches, exactly 1 POST per switch, banned-property audit, out-of-order race safety) + 13 visual-parity assertions (`tests/mood-visual-parity.test.mjs`: diffs the full style/text tree of the fixed screen against the original from `git HEAD`, unselected and selected). **54/54 pass** — the screen is visually identical, only smoother.

## Global Motion & Alignment Pass (2026-08-05)
Four motion/alignment defects were fixed app-wide. **No design, layout, spacing, sizing or UX structure was changed** — only how things move.

### 1. Orb colour transitions are now truly smooth
The orb changed colour by **swapping gradient strings**, which cannot interpolate: CSS has no defined midpoint between two `radial-gradient()`s, so a phase change snapped. The previous overlay crossfade also had two flaws — a one-frame handoff flash when the overlay was promoted to the base layer, and the overlay being double-composited through `.orb-blob-b`'s `mix-blend-mode: screen`. On top of that, four separate CSS `transition: background` declarations competed with the JS timeline: because JS rewrote the gradient every frame, each frame *restarted* a 400ms transition, and the two curves fighting each other read as stutter.

- **Numeric interpolation, not string swapping**: `phasePalette(phase)` derives the palette from state (never a hardcoded switch), `mixPalette()` lerps every channel of every colour, and `gradientsFrom()` rebuilds the gradient strings per frame. At `t=0` and `t=1` the output is byte-equivalent to the original design colours, so endpoints are pixel-identical.
- **One animation timeline**: `setOrbPhase` holds a single cancellable `requestAnimationFrame` handle (`_orbRaf`). A phase change mid-fade cancels the previous frame loop and interpolates **from the colour currently on screen** (`_orbShown`), so an interrupted transition continues rather than jumping.
- **Ease-in-out**: a cubic `easeInOut` over 600–1200ms (scaled from the phase duration) replaces linear stepping.
- **No competing animations**: the CSS colour transitions were removed from all four orb layers — JS now owns the only colour timeline. The `.orb-fade` overlay and `crossfadeLayer()` were retired.
- **Reduced motion** applies the target palette immediately, and a theme change invalidates the cached start colour so a light↔dark switch never mixes across palettes.

### 2. & 3. Jitter eliminated everywhere, with the same fix
The Home fix's root cause — a route holding state in a closure and calling `root.innerHTML = ...` on every interaction — existed in three more places. Each was converted to the same **render-once + patch-in-place** pattern:

- **Library (`routes.programs`)** — switching guided journeys rebuilt the whole list. Now every card and category heading is emitted once with a stable `data-card`/`data-cat` identity and toggled via a `.lib-off` visibility class. Filtering runs a **single-timeline opacity crossfade**: fade out (170ms) → swap visibility at the zero-opacity midpoint → fade in, so the unavoidable reflow happens while invisible. Category headings hide with their sections, filter semantics are unchanged, and `GET /app/programs` fires exactly once.
- **Personalize (`routes.personalize`)** — goal/length taps re-invoked the route. Now selection patches only the affected cards, so the slider's drag state and every card's DOM identity survive.
- **Settings (`routes.settings`)** — the appearance switch queued a deferred full re-render after the theme crossfade. Now the chips, ambience dot and theme label are patched in place.
- **Banned-property audit**: all 7 remaining `transition: all` declarations were replaced with explicit non-layout property lists (`transition: all` silently makes width/padding/font-size animatable). Both toggle knobs (`.toggle::after`, `.scc-toggle span::after`) now travel via `translateX` instead of `left` — composited instead of dirtying layout each frame — with the press-scale composed through a separate custom property so `:active` can't cancel the travel. The only remaining layout animations are six admin data-viz bar fills, whose `width` **is** the datum; each is wrapped in a `contain: layout` track so the reflow cannot propagate to an ancestor.

### 4. Countdown circle is now perfectly centred
`.progress-ring` used `position: absolute` with **no offsets**, so it fell back to its *static position* — which inside a centering flex container places it low and to the right of its sibling orb. That is the reported "bottom-right" bug. It is now centred with `inset: 0; margin: auto` (the SVG has an intrinsic size, so auto margins resolve symmetrically on both axes) — offset-free, responsive at any size, and stable while the countdown animates because only `stroke-dashoffset` changes. A stray inline `<span id="ring-holder">` wrapper that broke the positioning context was removed, and a `viewBox` was added so the ring scales cleanly. `rotate(-90deg)` is preserved.

**Validation**: `npm test` — **151/151 pass**. The 54 existing mood assertions confirm the Home fix is not rebroken, plus 97 new assertions in `tests/motion-global.test.mjs`: orb interpolation (≥12 distinct intermediate colours, monotonic channel progression, ease-in-out curve verification, interrupt continuity, exactly one live rAF timeline), ring centring (offset-free, geometry and style provably unchanged across the whole countdown), Library (node identity across 6 filter switches, one network call, opacity-only crossfade, zero layout mutation), and a global stylesheet audit that fails on any `transition: all` or uncontained layout-property transition.

## Layout Stability, Invisible Scrollbar & Admin Reset (2026-08-05)
Three defects fixed. **No design, spacing, layout structure or component hierarchy changed; scrolling is never disabled and no feature was removed.**

### 1. The scrollbar was the layout shift
`.screen` was `height: 100dvh; overflow: hidden` (no page scrollbar) while `.screen--scroll` — used by Library, Settings and 8 other routes — was `height: auto` (page scrollbar **appears**). With `::-webkit-scrollbar { width: 8px }` and a `max-width: 480px; margin: 0 auto` centred container, every navigation between a fixed screen and a scrolling one changed the viewport width by 8–15px and **moved the whole app sideways by half that**, then moved it back. That is the reported shift.

- **Scrollbar is now invisible everywhere**, across all three engines: `::-webkit-scrollbar { width: 0; height: 0; display: none }` (Safari/Chrome/Edge), `scrollbar-width: none` (Firefox), `-ms-overflow-style: none` (legacy Edge). Applied universally via `*` so nested scroll containers are covered too, not just the page.
- **Scrolling is completely untouched** — no `overflow: hidden`, no `touch-action` change, no height clamp. Only the scrollbar's *rendering* is suppressed.
- **`html` is now permanently `overflow-y: scroll`**, so the document never toggles between "has a scroll container" and "doesn't". Because the bar is zero-width this reserves **no pixels**, which is what makes the toggle free.
- **`100vw` is banned** (it ignores the scrollbar and overflows), and `html`/`body` lock the horizontal axis so a surprise h-scrollbar can't appear.
- **Modal open/close no longer jumps** either: the scroll lock moved to `html` (the real scroll container) and, since the bar is always zero-width, locking reclaims no space.

### 2. `dvh` was resizing the layout on every phone
Every full-height container used `100dvh` — the **dynamic** viewport height, which by definition *changes as the mobile URL bar collapses and expands during scroll*. The layout was therefore resizing mid-scroll on every phone, by design of the unit.

A single token is now the one height reference for the whole app:
```css
:root { --vh-fixed: 100vh; }                                  /* fallback */
@supports (height: 100svh) { :root { --vh-fixed: 100svh; } }  /* stable    */
```
`100svh` is the **small** viewport height — a constant that does not change when the URL bar moves. `.app-root`, `.screen`, `.screen--scroll`, `.screen--wide`, `.boot-loader`, `.sheet` and the admin shell all measure against it, so no screen can drift to a different height basis. `.screen--scroll` now overrides **only** height and overflow — never width, max-width or margin — so the scrolling and fixed variants share one bounding box.

### 3. Navigation made the incoming screen slide
`html { scroll-behavior: smooth }` applies to programmatic scrolling too, so the router's `window.scrollTo(0, 0)` was **animating** — the new screen visibly slid upward while fading in. It now uses `behavior: 'instant'` (with a legacy fallback); smooth anchor scrolling elsewhere is unaffected. Screen transitions already used only `opacity`/`transform`, and a parser-backed audit now proves **no keyframe anywhere animates a layout property**.

### 4. Admin panel data reset
New `POST /api/admin/reset` (behind the existing `requireAuth` + `requireAdmin` guards) plus a **Reset panel data** control in Settings, built from existing components (`scc-card`, `scc-btn--danger`, `confirmModal`).

- **Restores, never wipes**: AI tuning → `AI_DEFAULTS`, the 8 baseline notification rules, and the 6 baseline experiments — all via `ON CONFLICT DO UPDATE` upserts, so **every control is rebound to a non-null default** and no undefined state can survive.
- **User data is never touched**: `users`, `sessions`, `moods`, `subscriptions`, `payments`, `profiles` and the (contractually immutable) `audit_log` are all preserved; the response echoes the preserved list. The only deletes remove rules/experiments added *beyond* the baseline.
- **Functionality intact**: the cache is invalidated so the next read serves restored values, the view re-renders, the button re-enables on failure, and the pre-existing per-module AI reset still works.

- **Validation**: `npm test` → **298 checks pass, 0 fail** across `tests/copy-style.test.mjs` (23), `tests/security-critical.test.mjs` (16), `tests/security-hardening.test.mjs` (17), the layout-stability suite (91), and the existing unit/integration suites (41 + 13 + 97). The layout-stability suite parses the stylesheet rule-by-rule rather than grepping, so a rule that merely *mentions* a property cannot satisfy a check. It asserts cross-browser scrollbar hiding, that scroll is never disabled, that every full-height container uses `--vh-fixed`, that no `dvh`/`100vw` remains, that `.screen--scroll` never overrides width, that no keyframe animates layout, and 30+ admin-reset safety invariants. The reset was additionally verified **live against D1**: mutate → reset → confirm defaults restored, zero nulls, user count unchanged, second reset idempotent, and writes still working afterwards.

## Security Hardening (2026-08-05)
Two review-driven passes (PRs #4 and #5). **No screen, copy or layout changed** — the
frontend is byte-identical; all four UI suites still pass.

### Environment / bindings
| Variable | Required | Effect if unset |
|---|---|---|
| `JWT_SECRET` | **yes**, ≥ 32 chars | app fails closed — auth returns 500 instead of signing tokens with a guessable fallback |
| `STRIPE_WEBHOOK_SECRET` | for Stripe | `/webhooks/stripe` returns `503 webhooks_unconfigured` |
| `PAYSTACK_WEBHOOK_SECRET` (or `PAYSTACK_SECRET_KEY`) | for Paystack | `/webhooks/paystack` returns 503 |
| `ALLOWED_ORIGINS` | no | no cross-origin API access at all (correct default — app and API share an origin) |
| `ALLOW_SIM_CHECKOUT` | no | checkout returns `503 payments_unavailable` without payment keys. Set to `"1"` **only** in dev/test — it grants paid plans for free. Deliberately absent from `wrangler.jsonc`, so it must be set per environment (`.dev.vars` locally, env var on Pages) |

Copy `.dev.vars.example` → `.dev.vars` to get started locally.

### Fixed — critical (PR #4)
- **JWT secret fallback removed.** `jwtSecret()` throws unless a ≥32-char secret is configured, so a deploy can never sign tokens with a hardcoded default. Anyone who knew it could mint admin tokens.
- **No committed credentials.** `seed.sql` is content-only; the old seeded `admin@aura.app` account and its committed default password are gone. Use `scripts/bootstrap-admin.mjs`. ⚠️ **Rotate or delete that account on any environment seeded before this change.**
- **Webhook verification is unconditional.** It previously ran only *if* a secret was present, so an unconfigured environment accepted forged payloads that activate paid plans. Signatures now use constant-time comparison, Stripe timestamps must be within 300s, and `webhook_events` (unique on `provider, event_id`) is claimed *before* activation, so a replayed event can't re-grant a plan.
- **Simulated checkout is gated** behind `ALLOW_SIM_CHECKOUT` instead of triggering automatically whenever keys were missing.

### Fixed — session & transport (PR #5)
- **CORS allowlist.** The config reflected any `Origin` back with `credentials: true`, letting any site call the API with the victim's cookie. Origins now come from `ALLOWED_ORIGINS`; matching is exact (no suffix match, no scheme downgrade).
- **Real token revocation.** Logout only deleted the cookie; the bearer token stayed valid for 7 days. Every token now carries a `jti` recorded in `revoked_tokens` on logout (one session only — other devices stay signed in), and `users.token_version` is snapshotted as `tv` and compared per request so `bumpTokenVersion()` can kill every session at once. Tokens issued before migration `0005` have no `tv` and are treated as version 1, so deploying doesn't force-log-out live sessions.
- **Security headers** on every response: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS (https only), and `Cache-Control: no-store` on `/api/*`.
- **Impersonation scoped to 30 minutes** (was a full 7-day token for someone else's account), revocable via its `jti`, and dies with the target's other sessions.

### Migrations
`0004_webhook_events.sql` (replay protection) · `0005_token_revocation.sql` (`revoked_tokens` + `users.token_version`) — apply both with the deploy.

### Validation
`tests/security-critical.test.mjs` (16 checks) + `tests/security-hardening.test.mjs` (17 checks), both wired into `npm test`. Pure logic is executed rather than pattern-matched: the CORS allowlist is tested against unlisted, suffix-matching and scheme-downgraded origins; the `token_version` comparison against legacy, stale and forged-version tokens; the webhook dedupe and timestamp window against replayed and expired events.

### Deliberately not done yet
- **CSP** — the frontend renders inline styles via `innerHTML` and loads fonts/axios from CDNs, so a policy needs a per-page visual pass. A test asserts it stays out until then.
- Admin token still in `localStorage` (XSS-readable); no admin 2FA; rate limiting is per-isolate in memory, not global; PBKDF2 at 100k iterations (OWASP now suggests 210k).
- **Last Updated**: 2026-08-13

## Features Not Yet Implemented
- Real payment-provider round-trip (needs live Stripe/Paystack keys — `ALLOW_SIM_CHECKOUT` covers the flow in dev)
- Email delivery (verification / reset / export emails): endpoints and UI are wired, but the transactional send still needs a provider (Resend/SendGrid) + key — dev uses inline dev codes/`devResetToken` instead of sending real mail
- Reminders toggle is persisted but push/local notifications need a service worker + permission flow
- Team/family plans, proration on mid-cycle upgrades

## Recommended Next Steps
1. Deploy to Cloudflare Pages with real D1 + secrets
2. Plug in live Stripe/Paystack keys and register webhook endpoints
3. Content-Security-Policy (needs a visual pass — see Security Hardening)
4. Move the admin token out of `localStorage`; wire transactional email (Resend/SendGrid) so verification / reset / export actually send
5. Swap the rule-based suggestion engine for an LLM-backed one via an AI API
