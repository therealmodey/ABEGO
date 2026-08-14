# ONBOARDING EXTENDED FLOW — BUILD CONTRACT (authoritative)

Repo: `~/Desktop/MODEY.INC/CLAUDE/AURA-repo` (ABEGO / AURA app, Cloudflare Pages).
This contract is the single source of truth. Read it fully before writing any code.
You are one of 3 parallel agents building `public/static/aura-onboard.js`.
Each agent writes a DISJOINT set of route functions into that ONE file.
DO NOT edit any other file. DO NOT touch `app.js`, `aura-auth.js`, `src/`, CSS, or shell.

## ARCHITECTURE (mirror aura-auth.js exactly)
File: `public/static/aura-onboard.js` — an IIFE:
```js
(function () {
  'use strict';
  const { api, AuraState, orbHTML, icon, toast, bgHTML } = window.Aura;
  const App = window.AuraApp;            // { routes, go, ... }
  const root = document.getElementById('app');
  // Per-flow transient state (NOT persisted):
  const ob = { stress: 6, goal: 'relax', length: 5, sound: true, haptics: true, reminders: false, intent: 'ease' };
  // re-declare goalGlow (it is local to app.js, NOT global):
  function goalGlow(color) { return `inset 0 0 0 1px ${color}88, 0 0 32px ${color}55`; }
  function goto(r) { App.go(r); }
  // ... your route functions (ASSIGNED to App.routes.<name>) ...
  // DO NOT reassign window.AuraApp. DO NOT call route(). Just register routes.
})();
```

## NATIVE DESIGN RULES (no new UI language — user explicit)
Reuse EXISTING tokens/classes/atoms ONLY:
- Layout shell: `${bgHTML()}` at top of every screen, inside `<section class="screen ...">`.
- Classes (all exist in aura.css): `.screen`, `.screen--scroll`, `.glass`, `.glass--heavy`,
  `.btn-primary`, `.btn-ghost`, `.btn-icon`, `.chip`, `.chip.selected`, `.toggle`, `.toggle.on`,
  `.aura-slider`, `.overline`, `.grad-text`, `.grad-text--blue`, `.grad-text--violet`,
  `.tabular`, `.pulse-dot`, `.hidden`, `.field`, `.form-error`.
- Atoms (from window.Aura): `orbHTML(size, phase, opts)`, `icon(name, px)`, `bgHTML(variant)`,
  `toast(msg)`, `haptic(n)`, `attachSlider(el, {onMove,onCommit})`, `setSliderVal(el, txt)`.
- PHASE colors (object on window.Aura): `PHASE.inhale/hold/exhale` = {a,b,glow}. Use e.g.
  `PHASE.inhale.a` for gradient/caption colors.
- Colors: use CSS vars / literals from aura.css: `--brand-start #7C3AED`, `--brand-end #22D3EE`,
  `--inhale #60A5FA`, `--hold #A78BFA`, `--exhale #34D399`, `--warning #F59E0B`,
  `var(--text-primary/secondary/tertiary/disabled)`, `rgba(255,255,255,0.04/0.06/0.08/0.10/0.12)`.
- Fonts: Inter; titles 28px/600/letter-spacing -0.5; overline 11px/500/letter-spacing 2px/uppercase;
  body 13-15px; CTA 15-16px/600.
- Progress dots (bottom nav): render with `.pulse-dot` style inline. Lit dot =
  `width:20px;height:5px;border-radius:3px;background:linear-gradient(90deg,#7C3AED,#22D3EE)`.
  Dim dot = `width:5px;height:5px;border-radius:3px;background:var(--dot-dim)` (use
  `rgba(255,255,255,0.18)` if `--dot-dim` not defined). Exactly 10 dots, index per screen below.

## ICON CONSTRAINT (IMPORTANT — prevents broken icons)
Existing icon() names: `arrow, back, card, check, close, doc, heart, home, lock, logout,
pause, play, settings, shield, sound, spark, stats, device, download, info, mail, trash, warn`.
The following icons DO NOT EXIST — DO NOT call `icon('lotus'|'eye'|'moon'|'bell'|'haptics')`.
For those, INLINE a 24x24 SVG (stroke=currentColor, stroke-width=1.5, fill=none, viewBox 0 0 24 24):
- lotus (Ease/Relax): petals — use a simple symmetric flower path.
- eye (Clear/Focus): circle + pupil.
- moon (Rest/Sleep): crescent path `M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z`.
- haptics: use `icon('spark', 22)` (acceptable substitute) OR inline a small pulse/wave SVG.
- reminders: use `icon('heart', 22)` or inline a bell SVG.
Keep inline SVGs minimal and on-brand (thin stroke, brand/violet/blue/green color via style).

## ROUTE FLOW (exact order — screens 1..10)
softEntry → welcome → guided → how → liveDemo → personalize → intent → previewRecommend → permissions → transition → (home, existing)

Each route function: `App.routes.<name> = function () { root.innerHTML = ...; wire handlers; };`
Wire `go(target)` for forward/back. Every screen needs a forward CTA AND a back affordance (back
button top-left using `icon('back',17)` inside a `.btn-icon`, or a "Back" text link). No dead ends.

## AGENT ASSIGNMENTS (disjoint — do not overlap)
- AGENT A (screens 1-4): softEntry, welcome, guided, how
- AGENT B (screens 5-7): liveDemo, personalize, intent
- AGENT C (screens 8-10): previewRecommend, permissions, transition

## EXACT SCREEN COPY + BEHAVIOR (from PNGs — use verbatim)
### 1 softEntry (dot index 0)
Full-bleed centered orb (orbHTML 260 'idle'), no header. Copy: small overline "SOFT ENTRY" optional;
big title "Just arrive." (28/600); sub "A moment to land before we begin."; a faint "TAP ANYWHERE"
hint (overline style, low opacity). Behavior: clicking anywhere on the screen → goto('welcome').
Also a visible primary CTA "Begin" (btn-primary) as fallback that also → welcome.

### 2 welcome (dot index 1)  [existing screen, recreate faithfully]
Wordmark "AURA" (letter-spacing 8px, 14px/500, centered, padding-top 28). 240 orb ('idle').
Title "Breathe with intention." (32/600, -0.5, line-height 1.25). Sub "A living orb that guides
your breath. Calmer in seconds, clearer in minutes." (15, var(--ink-55)/text-tertiary, max-width 280).
Primary CTA "Begin" → goto('guided')  (NOTE: flow now starts at guided, not signup — see mapping).
Text link "I already have an account" → goto('login'). Dot nav (index 1 lit).

### 3 guided (dot index 2)  [NEW]
Header optional. Title "Meet the orb." (28/600). Sub "Touch it. Hold it. It'll respond."
Centered orb (~180, phase 'idle') that on pointerdown scales up + brightens (transform scale(1.08),
box-shadow boost) and on pointerup eases back (CSS transition 400ms). A pill below orb:
`<span class="pulse-dot" style="background:#34D399"></span> RESPONDING TO YOU` (overline, green).
Forward CTA "Tap when ready" (btn-primary) → goto('how'). Back → welcome.

### 4 how (dot index 3)  [existing, recreate]
Header left "Step 3 of 4" overline + right "Skip" text link → goto('liveDemo') (skip goes forward
in new flow). 3 cards (reuse existing structure): Inhale 4s (PHASE.inhale), Hold 2s (PHASE.hold),
Exhale 7s (PHASE.exhale). Title "The rhythm is simple." (28/600). Continue btn-primary →
goto('liveDemo'). Back → guided.

### 5 liveDemo (dot index 4)  [NEW]
Overline "TRY ONE BREATH". Title "Follow the orb." (28/600). Centered orb (~160) wrapped in a
breathing ring (a div with border + animation auraPulseRing or a scale pulse synced to caption).
Caption element that cycles: "Breathe in" (inhale, blue) → "Hold" (hold, violet) → "Breathe out"
(exhale, green) over ~13s (use setInterval updating text+color, cleared on screen change by storing
interval id on a module variable and clearing at top of each route fn). Label small "PREVIEW · ONE
CYCLE". Forward CTA "Continue" (btn-primary) → goto('personalize'). Back → how.

### 6 personalize (dot index 5)  [existing, recreate]
Header "Step 3 of 4" + Skip → goto('intent'). Stress slider (0-10, value ob.stress, label
Low/Moderate/High via stressLabel). Goal 3 cards: Relax(lotus,#34D399)/Focus(eye,#60A5FA)/
Sleep(moon,#A78BFA) — INLINE those 3 SVGs. Session length chips 3/5/10/15 (ob.length).
Selection must patch SAME nodes (goalGlow on select, chip.selected toggle) — do NOT re-render screen
(see app.js personalize pattern). Continue btn-primary → goto('intent'). Back → liveDemo.

### 7 intent (dot index 6)  [NEW]
Overline "WHAT BRINGS YOU HERE". Sub "You want to…". 3 big selectable cards (single-select, like
goal cards): Ease (lotus green) "to unwind & release tension"; Clear (eye blue) "to sharpen & focus";
Rest (moon purple) "to slow down for sleep". Store into ob.intent ('ease'|'clear'|'rest').
Continue btn-primary (disabled until a choice made, or default 'ease' selected) → goto('previewRecommend').
Back → personalize.

### 8 previewRecommend (dot index 7)  [NEW]
Overline pill "• TUNED TO YOU" (green dot + text). Title "We recommend a 3-minute reset" (28/600) with
"3-minute reset" possibly grad-text. Centered orb (~150). Glass card: program name (fetch from
`GET /api/programs` — pick first non-premium, or match intent: ease→relax cat, clear→focus, rest→sleep;
fallback title "4-7-8 · Deep Unwind") + sub "Slow exhale · calms the nervous system". A timeline row of
3 mini stats: Inhale 4s / Hold 7s / Exhale 8s (use PHASE colors). Footer line "SESSION LENGTH 3:00 · 6
cycles" (overline/tabular). Two CTAs: ghost "Customize" → toast("Customize after your first session") OR
goto('setup') if setup route exists (prefer toast to avoid dead-end); primary "Sounds right" →
goto('permissions'). Back → intent. (Wrap the GET in try/catch; on failure use fallback copy so no dead screen.)

### 9 permissions (dot index 8)  [existing, recreate]
Header "Step 4 of 4" (no skip). 3 toggle rows in a .glass: Spatial Sound (icon('sound'), blue),
Haptic Feedback (inline pulse SVG or icon('spark'), violet), Gentle Reminders (inline bell SVG or
icon('heart'), green). Each row: dot + label + desc + `.toggle` switch (on by default per ob).
Toggle click flips ob[key] + toggles .on class + aria-checked. Title "Make it feel alive." (per existing
app screen) OR "One last thing" if you prefer the PNG; use existing app copy "Make it feel alive." to stay
native. Primary CTA "Enter AURA" (btn-primary) → goto('transition'). Back → previewRecommend.

### 10 transition (dot index 9)  [NEW — final]
Centered orb (~150). Title "Let's begin." (28/600). Sub "Your first breath is ready when you are."
Pill "YOUR FIRST BREATH" (overline). Primary CTA "Start your first session" with play icon
(icon('play',18)) → commits profile + goes home:
```
document.getElementById('start-btn').onclick = async () => {
  try {
    await api.put('/profile', {
      goal: ob.goal,
      baselineStress: ob.stress,
      sessionLength: ob.length,
      prefs: { sound: ob.sound, haptics: ob.haptics, reminders: ob.reminders, intent: ob.intent },
      onboarded: true,
    });
    const u = AuraState.user; if (u) { u.onboarded = true; AuraState.user = u; }
    goto('home');
  } catch (err) { (window.Aura.handleApiError || toast)(err); }
};
```
Back → permissions. Dot nav (last lit).

## SHARED MODULE GLOBALS (declare ONCE, at top of file — all 3 agents' code shares the file;
the INTEGRATOR assembles. Each agent should assume these already exist; if writing the FULL file
stub, include them. To avoid duplicate-declaration conflicts, agents must NOT redefine `ob`,
`goalGlow`, `goto`, `App`, `root`, `api`, `AuraState`, `orbHTML`, `icon`, `toast`, `bgHTML`.
Only define YOUR assigned route functions.)

## VALIDATION BEFORE YOU FINISH
- `node --check public/static/aura-onboard.js` must pass (no syntax errors).
- Do NOT run build/test (integrator does). Just ensure your slice is syntactically valid and uses
  only the atoms/classes listed above.
- Every goto() target you reference must be a real route name from the flow above.
- No `window.AuraApp =` reassignment. No `route()` call. No edits outside this file.
