// Validation harness for the app-wide motion + alignment pass.
//
// Loads the REAL public/static/{aura-core,app}.js and public/static/aura.css
// inside jsdom and asserts the invariants each fix depends on:
//
//   TASK 1  orb colour is INTERPOLATED on a single eased timeline — every
//           intermediate colour exists, endpoints match the design tokens
//           exactly, and a re-entrant phase change continues from the colour
//           on screen instead of snapping
//   TASK 2  no screen animates a LAYOUT property anywhere, and no interactive
//           surface uses `transition: all`
//   TASK 3  the Library renders once: switching guided journeys keeps every
//           node's identity and crossfades on opacity only
//   TASK 4  the countdown ring is centred on both axes with no hardcoded
//           offsets, and its geometry never changes while it animates
//
// Run: node tests/motion-global.test.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '..', 'public', 'static');
const read = (f) => readFileSync(join(STATIC, f), 'utf8');
const CSS = read('aura.css');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failures.push(name); console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every jsdom window created with pretendToBeVisual runs an internal rAF
// driver, and runSession() owns a 1s setInterval. Both keep the Node event
// loop alive forever, so each window is registered here and closed at the end.
const WINDOWS = [];
function closeAll() { WINDOWS.forEach((w) => { try { w.close(); } catch (e) { /* already closed */ } }); }

const USER = { id: 1, name: 'Tester', email: 't@e.st', plan: 'free', onboarded: true, sessionLength: 5 };
const PROGRAMS = [
  { id: 1, title: 'First Breath', category: 'beginner', phase: 'inhale', tag: 'Calm', intents: 'calm,stress', duration_min: 3, inhale: 4, hold: 2, exhale: 6, cycles: 6, locked: 0, is_new: 0 },
  { id: 2, title: 'Steady Ground', category: 'beginner', phase: 'exhale', tag: 'Stress', intents: 'stress', duration_min: 5, inhale: 4, hold: 4, exhale: 4, cycles: 8, locked: 0, is_new: 1 },
  { id: 3, title: 'Deep Unwind', category: 'deep_calm', phase: 'hold', tag: 'Calm', intents: 'calm', duration_min: 10, inhale: 4, hold: 7, exhale: 8, cycles: 10, locked: 0, is_new: 0 },
  { id: 4, title: 'Sharp Focus', category: 'deep_calm', phase: 'idle', tag: 'Focus', intents: 'focus', duration_min: 8, inhale: 5, hold: 0, exhale: 5, cycles: 9, locked: 1, is_new: 0 },
  { id: 5, title: 'Body Scan', category: 'sleep_prep', phase: 'exhale', tag: 'Calm', intents: 'sleep,calm', duration_min: 12, inhale: 4, hold: 6, exhale: 8, cycles: 12, locked: 0, is_new: 0 },
  { id: 6, title: 'Night Drift', category: 'sleep_prep', phase: 'hold', tag: 'Sleep', intents: 'sleep', duration_min: 15, inhale: 4, hold: 7, exhale: 9, cycles: 14, locked: 1, is_new: 0 },
];

// ---------------------------------------------------------------- environment
// rafSteps: when set, rAF callbacks receive synthetic monotonic timestamps so a
// colour timeline can be advanced deterministically frame by frame.
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(
    `<!doctype html><html><head><meta name="theme-color" content="#0B0F1A"></head>
     <body><div id="app"></div></body></html>`,
    { url: 'https://aura.test/#home', pretendToBeVisual: true, runScripts: 'outside-only' },
  );
  const { window } = dom;
  WINDOWS.push(window);

  // Controllable clock for the orb's rAF colour timeline.
  let clock = 1000;
  const rafQueue = [];
  Object.defineProperty(window, 'performance', {
    value: { now: () => clock }, configurable: true, writable: true,
  });
  if (opts.manualRaf) {
    window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    window.cancelAnimationFrame = (id) => { rafQueue[id - 1] = null; };
  } else {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(clock), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.navigator.vibrate = () => true;

  const calls = [];
  function mk() {
    return {
      interceptors: { request: { use() {} } },
      get(url) {
        calls.push({ method: 'GET', url });
        if (url === '/auth/me') return Promise.resolve({ data: { user: USER } });
        if (url === '/app/config') return Promise.resolve({ data: { flags: {} } });
        if (url === '/app/programs') return Promise.resolve({ data: { programs: PROGRAMS } });
        return Promise.resolve({ data: {} });
      },
      post(url, body) {
        calls.push({ method: 'POST', url, body });
        if (url === '/app/sessions/start') return Promise.resolve({ data: { sessionId: 99 } });
        return Promise.resolve({ data: {} });
      },
      put(url, body) { calls.push({ method: 'PUT', url, body }); return Promise.resolve({ data: {} }); },
    };
  }
  window.axios = { create: mk };

  const store = new Map([['aura_user', JSON.stringify(USER)]]);
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    configurable: true,
  });

  window.eval(read('aura-core.js'));
  window.eval(read('app.js'));
  return {
    window,
    calls,
    store,
    // Advance the synthetic clock and drain queued rAF callbacks once.
    frame(dt) {
      clock += dt == null ? 16 : dt;
      const due = rafQueue.splice(0, rafQueue.length);
      due.forEach((cb) => { if (cb) cb(clock); });
    },
    now: () => clock,
  };
}

// Parse an `rgba(r,g,b,a)` triple out of a gradient string by index.
function rgbas(str) {
  return (String(str).match(/rgba?\([^)]*\)/g) || []).map((s) => {
    const p = s.replace(/rgba?\(|\)/g, '').split(',').map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  });
}
const between = (v, a, b) => (a <= b ? v >= a - 0.51 && v <= b + 0.51 : v >= b - 0.51 && v <= a + 0.51);

// ================================================== TASK 1 — orb colour
console.log('\nTASK 1 — Orb colour transitions are interpolated, not swapped');
{
  const env = boot({ manualRaf: true });
  const { document } = env.window;
  const { orbHTML, setOrbPhase, PHASE } = env.window.Aura;

  document.getElementById('app').innerHTML = orbHTML(240, 'inhale', { intensity: 0.85 });
  const orb = document.querySelector('[data-orb]');
  const blobA = orb.querySelector('.orb-blob-a');
  const aura = orb.querySelector('.orb-aura');

  // The rendered start colour must be exactly the inhale token.
  const startMid = rgbas(blobA.style.background)[1];
  const inhaleA = PHASE.inhale.a; // #60A5FA
  check('orb renders the phase token colour at rest',
    startMid[0] === 0x60 && startMid[1] === 0xA5 && startMid[2] === 0xFA, `${startMid} vs ${inhaleA}`);

  // Drive inhale -> hold over a 4s phase (fadeMs = 1200, clamped).
  setOrbPhase(orb, 'hold', 0.85, 4000);
  env.frame(0);                                  // t = 0
  const t0 = rgbas(blobA.style.background)[1];
  check('timeline starts from the colour already on screen',
    t0[0] === 0x60 && t0[1] === 0xA5 && t0[2] === 0xFA, String(t0));

  const samples = [];
  for (let i = 0; i < 40; i++) { env.frame(30); samples.push(rgbas(blobA.style.background)[1]); }

  // Endpoint is exactly the hold token (#A78BFA).
  const end = samples[samples.length - 1];
  check('timeline lands exactly on the next phase token',
    end[0] === 0xA7 && end[1] === 0x8B && end[2] === 0xFA, String(end));

  // Every sample lies strictly between the two endpoints -> real interpolation.
  const inRange = samples.every((s) =>
    between(s[0], 0x60, 0xA7) && between(s[1], 0xA5, 0x8B) && between(s[2], 0xFA, 0xFA));
  check('every intermediate frame lies between the two colours (no jump)', inRange);

  // At least a dozen DISTINCT intermediate values — proves it is not a swap.
  const distinct = new Set(samples.map((s) => s.join(','))).size;
  check('many distinct intermediate colours are actually painted', distinct >= 12, `distinct=${distinct}`);

  // Monotonic on the red channel (60 -> A7 rises without reversing).
  let monotonic = true;
  for (let i = 1; i < samples.length; i++) if (samples[i][0] < samples[i - 1][0] - 0.51) monotonic = false;
  check('progression is monotonic (never overshoots or bounces back)', monotonic);

  // Ease-in-out: the middle of the timeline moves faster than the start.
  const mid = samples.slice(0, 20);
  const dStart = mid[2][0] - mid[0][0];
  const dMid = mid[12][0] - mid[10][0];
  check('easing is ease-in-out (slow start, fast middle)', dMid > dStart, `start=${dStart} mid=${dMid}`);

  // The aura/halo ride the SAME timeline as the body — one clock, not four.
  const auraGlow = rgbas(aura.style.background)[0];
  check('aura glow reaches the next phase glow on the same timeline',
    Math.round(auraGlow[0]) === 167 && Math.round(auraGlow[1]) === 139, String(auraGlow));
}

{
  const env = boot({ manualRaf: true });
  const { document } = env.window;
  const { orbHTML, setOrbPhase } = env.window.Aura;
  document.getElementById('app').innerHTML = orbHTML(240, 'inhale', { intensity: 0.85 });
  const orb = document.querySelector('[data-orb]');
  const blobA = orb.querySelector('.orb-blob-a');

  // Interrupt mid-fade: the new timeline must continue from the colour on
  // screen, so there is no snap back to the previous phase.
  setOrbPhase(orb, 'hold', 0.85, 4000);
  env.frame(0);
  for (let i = 0; i < 12; i++) env.frame(30);   // ~30% through
  const atInterrupt = rgbas(blobA.style.background)[1];
  setOrbPhase(orb, 'exhale', 0.85, 4000);
  env.frame(0);
  const afterInterrupt = rgbas(blobA.style.background)[1];
  const jump = Math.abs(afterInterrupt[0] - atInterrupt[0])
             + Math.abs(afterInterrupt[1] - atInterrupt[1])
             + Math.abs(afterInterrupt[2] - atInterrupt[2]);
  check('re-entrant phase change does NOT snap (continues from screen colour)',
    jump <= 1.6, `jump=${jump} ${atInterrupt} -> ${afterInterrupt}`);

  for (let i = 0; i < 45; i++) env.frame(30);
  // Exhale token a = #34D399 (52,211,153); index 1 is the `a` colour stop.
  const settled = rgbas(blobA.style.background)[1];
  check('interrupted timeline still lands exactly on the final phase token',
    Math.round(settled[0]) === 52 && Math.round(settled[1]) === 211 && Math.round(settled[2]) === 153,
    String(settled));
}

{
  // Exactly ONE timeline per orb: an interrupt must cancel the old rAF loop,
  // never leave two loops writing the same nodes.
  const env = boot({ manualRaf: true });
  const { document } = env.window;
  const { orbHTML, setOrbPhase } = env.window.Aura;
  document.getElementById('app').innerHTML = orbHTML(240, 'inhale');
  const orb = document.querySelector('[data-orb]');

  // Count callbacks that are still PENDING: scheduled and neither run nor
  // cancelled. Two pending at once would mean two loops writing the same orb.
  const pending = new Set();
  const idMap = new Map();
  let seq = 0;
  const realRaf = env.window.requestAnimationFrame;
  const realCancel = env.window.cancelAnimationFrame;
  env.window.requestAnimationFrame = (cb) => {
    const id = ++seq;
    pending.add(id);
    const realId = realRaf((t) => { pending.delete(id); cb(t); });
    idMap.set(realId, id);
    return realId;
  };
  env.window.cancelAnimationFrame = (realId) => {
    if (idMap.has(realId)) pending.delete(idMap.get(realId));
    return realCancel(realId);
  };

  setOrbPhase(orb, 'hold', 0.85, 4000);
  env.frame(0);
  setOrbPhase(orb, 'exhale', 0.85, 4000);
  setOrbPhase(orb, 'idle', 0.85, 4000);
  setOrbPhase(orb, 'inhale', 0.85, 4000);
  check('only one colour timeline is pending per orb after rapid interrupts',
    pending.size === 1, `pending=${pending.size}`);

  // Drain to completion, then repeating the SAME phase must schedule nothing.
  for (let i = 0; i < 60; i++) env.frame(30);
  check('timeline fully drains (no leaked rAF loop)', pending.size === 0, `pending=${pending.size}`);
  setOrbPhase(orb, 'inhale', 0.85, 4000);
  check('repeating the current phase schedules no colour work',
    pending.size === 0, `pending=${pending.size}`);
}

{
  // Colour must be derived from state, not hardcoded per call site.
  const src = read('aura-core.js');
  check('colour is derived from a phase->palette lookup (no hardcoded switch)',
    /function phasePalette\(/.test(src) && /function mixPalette\(/.test(src)
    && !/if\s*\(\s*phase\s*===\s*['"]inhale['"]/.test(src));
  check('no per-frame CSS background transition competes with the JS timeline',
    !/\.orb-blob-a\s*\{[^}]*transition:[^}]*background/.test(CSS)
    && !/\.orb-blob-b\s*\{[^}]*transition:[^}]*background/.test(CSS)
    && !/\.orb-aura\s*\{[^}]*transition:[^}]*background/.test(CSS)
    && !/\.orb-halo\s*\{[^}]*transition:[^}]*background/.test(CSS));
  check('the overlay crossfade (and its promote-to-base flash) is gone',
    !/crossfadeLayer/.test(src) && !/promote to base/.test(src));
  const app = read('app.js');
  check('session screen still drives colour purely from S.phase',
    /setOrbPhase\(orbEl,\s*S\.phase/.test(app));
}

// ================================================== TASK 4 — ring centring
console.log('\nTASK 4 — Countdown circle is centred on both axes');
{
  const env = boot();
  const { document } = env.window;
  const { ringHTML } = env.window.Aura;
  document.getElementById('app').innerHTML =
    `<div style="position:relative;width:320px;height:320px;display:flex;align-items:center;justify-content:center">${ringHTML(320, 0, 2)}</div>`;
  const svg = document.querySelector('svg.progress-ring');
  const style = svg.getAttribute('style');

  check('ring is absolutely positioned (overlays the orb, no layout cost)',
    /position:\s*absolute/.test(style));
  check('ring has a containing rectangle to be centred in (inset:0)',
    /inset:\s*0/.test(style), style);
  check('ring is centred by auto margins on both axes (margin:auto)',
    /margin:\s*auto/.test(style), style);
  check('ring uses NO hardcoded pixel offsets',
    !/(^|;)\s*(top|left|right|bottom)\s*:\s*-?\d/.test(style), style);
  check('the rotate(-90deg) start-at-12-o-clock transform is preserved',
    /transform:\s*rotate\(-90deg\)/.test(style), style);
  check('a stylesheet rule also centres .progress-ring (survives cached markup)',
    /\.progress-ring\s*\{[^}]*inset:\s*0[^}]*margin:\s*auto/.test(CSS));

  // The circles are centred inside the SVG's own coordinate system too.
  const circles = [...svg.querySelectorAll('circle')];
  check('both circles are centred in the SVG viewBox',
    circles.every((c) => +c.getAttribute('cx') === 160 && +c.getAttribute('cy') === 160));
  check('viewBox matches the intrinsic size (scales without drifting)',
    svg.getAttribute('viewBox') === '0 0 320 320'
    && svg.getAttribute('width') === '320' && svg.getAttribute('height') === '320');

  // Only stroke-dashoffset animates, so the geometry can never move.
  check('only stroke-dashoffset is animated on the ring',
    /\.progress-ring circle\s*\{\s*transition:\s*stroke-dashoffset[^}]*\}/.test(CSS));
}

{
  // Both call sites must sit inside a positioned parent, or `inset:0` would
  // resolve against the wrong box and the ring would drift off-centre.
  const app = read('app.js');
  const sites = app.match(/[^\n]*ringHTML\(\d+[^\n]*/g) || [];
  check('ring is used at exactly the two intended call sites', sites.length === 2, String(sites.length));
  check('no inline wrapper breaks the ring positioning context (ring-holder removed)',
    !/ring-holder/.test(app));

  const env = boot();
  const { document } = env.window;
  env.window.AuraApp.routes.home();
  const homeRing = document.querySelector('svg.progress-ring');
  check('home ring is present and centred', !!homeRing && /margin:\s*auto/.test(homeRing.getAttribute('style')));
  const parent = homeRing.parentElement.getAttribute('style') || '';
  check('home ring parent establishes a positioning context', /position:\s*relative/.test(parent), parent);
  check('home ring parent still centres its flex children (orb unchanged)',
    /align-items:\s*center/.test(parent) && /justify-content:\s*center/.test(parent));
}

{
  const env = boot();
  const { document } = env.window;
  env.window.AuraApp.startSession({ inhale: 4, hold: 2, exhale: 6, cycles: 3, name: 'Test' });
  await tick(); await tick();
  await sleep(1500);                              // startSession defers runSession
  const ring = document.querySelector('svg.progress-ring');
  check('session ring renders', !!ring);
  if (ring) {
    const st = ring.getAttribute('style');
    check('session ring is centred with inset:0 + margin:auto',
      /inset:\s*0/.test(st) && /margin:\s*auto/.test(st), st);
    const p = ring.parentElement.getAttribute('style') || '';
    check('session ring parent establishes a positioning context', /position:\s*relative/.test(p), p);

    // Animating the countdown must not touch geometry.
    const track = ring.querySelector('circle');
    const prog = ring.querySelector('[data-ring]');
    const geom = (c) => [c.getAttribute('cx'), c.getAttribute('cy'), c.getAttribute('r')].join('/');
    const g0 = geom(track), gp0 = geom(prog), style0 = ring.getAttribute('style');
    await sleep(2200);                            // let the 1s tick run
    check('countdown advanced (stroke-dashoffset changed)',
      prog.getAttribute('stroke-dashoffset') !== String(2 * Math.PI * ((320 - 4) / 2)));
    check('ring geometry is untouched while animating (no drift)',
      geom(track) === g0 && geom(prog) === gp0);
    check('ring positioning style is untouched while animating',
      ring.getAttribute('style') === style0);
  }
  // Tear the live session down: runSession owns a 1s setInterval that would
  // otherwise keep this process alive forever.
  env.window.close();
}

// ================================================== TASK 3 — Library
console.log('\nTASK 3 — Guided journey switching is render-once + crossfade');
let libEnv;
{
  const env = libEnv = boot();
  const { document } = env.window;
  await env.window.AuraApp.routes.programs();
  await tick(); await tick();

  const section0 = document.querySelector('section.screen');
  const bg0 = document.querySelector('.aura-bg');
  const stars0 = document.querySelector('.aura-stars');
  const chips0 = [...document.querySelectorAll('[data-f]')];
  const cards0 = [...document.querySelectorAll('[data-card]')];
  const back0 = document.getElementById('back-btn');
  const h10 = document.querySelector('h1');

  check('every journey card is rendered up front', cards0.length === PROGRAMS.length, String(cards0.length));
  check('all 5 filter chips rendered', chips0.length === 5, String(chips0.length));

  const visible = () => [...document.querySelectorAll('[data-card]')]
    .filter((c) => !c.classList.contains('lib-off')).map((c) => c.dataset.card);
  check('All shows every journey', visible().length === PROGRAMS.length);

  for (const f of ['Sleep', 'Focus', 'Calm', 'Stress', 'All', 'Sleep']) {
    document.querySelector(`[data-f="${f}"]`).click();
    await sleep(420);                             // full crossfade timeline
  }

  check('screen <section> is the same node (no rebuild)',
    document.querySelector('section.screen') === section0);
  check('.aura-bg is the same node (ambient drift never restarts)',
    document.querySelector('.aura-bg') === bg0);
  check('.aura-stars is the same node', document.querySelector('.aura-stars') === stars0);
  check('all filter chips keep identity',
    [...document.querySelectorAll('[data-f]')].every((c, i) => c === chips0[i]));
  check('all journey cards keep identity (no glass re-rasterize)',
    [...document.querySelectorAll('[data-card]')].every((c, i) => c === cards0[i]));
  check('back button keeps identity', document.getElementById('back-btn') === back0);
  check('heading keeps identity', document.querySelector('h1') === h10);
  check('screen never re-enters (no auraScreenIn replay)',
    !section0.style.animation && !section0.classList.contains('screen--leaving'));
  check('exactly one GET /app/programs for the whole session',
    env.calls.filter((c) => c.url === '/app/programs').length === 1);

  // Filtering is still correct, and matches the documented intent rules.
  const sleepIds = visible().sort();
  check('Sleep filter resolves via intents (Body Scan included)',
    sleepIds.join(',') === '5,6', sleepIds.join(','));
  document.querySelector('[data-f="Focus"]').click();
  await sleep(420);
  check('Focus filter resolves correctly', visible().join(',') === '4', visible().join(','));
  document.querySelector('[data-f="All"]').click();
  await sleep(420);
  check('All restores every journey', visible().length === PROGRAMS.length);

  // Category headings hide with their sections.
  document.querySelector('[data-f="Focus"]').click();
  await sleep(420);
  const shownHeads = [...document.querySelectorAll('[data-cat].overline')]
    .filter((h) => !h.classList.contains('lib-off')).map((h) => h.dataset.cat);
  check('empty category headings are hidden, matching the old rebuild',
    shownHeads.join(',') === 'deep_calm', shownHeads.join(','));

  // Chip selection is exclusive and eased in place.
  const sel = [...document.querySelectorAll('[data-f]')].filter((c) => c.classList.contains('selected'));
  check('exactly one chip is selected', sel.length === 1 && sel[0].dataset.f === 'Focus');
  check('chip selection eases via .chip transition (no layout props)',
    /\.chip\s*\{[^}]*transition:\s*background[^}]*\}/.test(CSS)
    && !/\.chip\s*\{[^}]*transition:[^}]*\ball\b/.test(CSS));
}

{
  // The crossfade must animate ONLY opacity, and layout must never be mutated.
  const env = boot();
  const { document } = env.window;
  await env.window.AuraApp.routes.programs();
  await tick(); await tick();

  const cards = [...document.querySelectorAll('[data-card]')];
  const layoutBefore = cards.map((c) => {
    const s = c.style;
    return [s.width, s.height, s.margin, s.marginBottom, s.padding, s.top, s.left, s.position, s.flex].join('|');
  });

  document.querySelector('[data-f="Sleep"]').click();
  await tick(); await tick();

  const trans = cards[0].style.transition;
  check('crossfade animates opacity only', /^opacity\s/.test(trans), trans);
  check('crossfade is a single timeline (no competing transitions)',
    trans.split(/,(?![^()]*\))/).length === 1, trans);
  check('crossfade is eased (ease-in-out curve)', /cubic-bezier\(0\.4,0,0\.2,1\)/.test(trans), trans);
  check('cards fade OUT first (content invisible before the list reflows)',
    cards.every((c) => c.style.opacity === '0'));
  check('visibility has NOT changed yet (swap happens at the invisible midpoint)',
    [...document.querySelectorAll('[data-card]')].filter((c) => !c.classList.contains('lib-off')).length === PROGRAMS.length);

  await sleep(500);
  check('cards end fully opaque', cards.every((c) => c.style.opacity === '1'));
  check('will-change / transition are cleaned up after the timeline',
    cards.every((c) => !c.style.willChange && !c.style.transition));

  const layoutAfter = cards.map((c) => {
    const s = c.style;
    return [s.width, s.height, s.margin, s.marginBottom, s.padding, s.top, s.left, s.position, s.flex].join('|');
  });
  check('no layout property is ever mutated on a journey card',
    layoutAfter.every((v, i) => v === layoutBefore[i]));
  check('hidden cards use display:none, indistinguishable from being absent',
    /\.lib-off\s*\{\s*display:\s*none/.test(CSS));
  check('the old render() -> root.innerHTML rebuild is gone',
    !/function render\(\)[\s\S]{0,600}root\.innerHTML/.test(read('app.js').split('13 PROGRAMS')[1] || ''));
}

// ================================================== TASK 2 — global
console.log('\nTASK 2 — Global: nothing animates a layout property');
{
  const app = read('app.js');

  // No route may re-invoke itself to repaint (the original jitter pattern).
  const selfRecalls = (app.match(/routes\.\w+\(\);?/g) || [])
    .filter((m) => !/^routes\.(mood|programs|home|settings|stats|history|profile|personalize|permissions|how|splash|welcome|login|signup)\(\);?$/.test(m) === false)
    .filter((m) => m !== 'routes.mood();');
  // Only the router's own dispatch may call a route; screens must not.
  const inHandler = app.match(/onclick\s*=\s*\([^)]*\)\s*=>\s*\{?[^;\n]*routes\.\w+\(\)/g) || [];
  check('no click handler re-invokes its own route (no full-screen rebuild)',
    inHandler.length === 0, JSON.stringify(inHandler));
  check('no deferred re-render after the theme crossfade',
    !/setTimeout\(\(\)\s*=>\s*routes\.settings\(\)/.test(app));
  void selfRecalls;

  // No `transition: all` anywhere — `all` makes layout properties animatable.
  const allTrans = (CSS.match(/transition:\s*all\b/g) || []).length
                 + (app.match(/transition:\s*all\b/g) || []).length
                 + (read('aura-core.js').match(/transition:\s*all\b/g) || []).length;
  check('no `transition: all` anywhere (would animate layout)', allTrans === 0, String(allTrans));

  // No transition may name a layout property, with one bounded exception: a
  // data-viz bar FILL whose width is the datum itself. Those cannot become a
  // transform without squashing their own gradient, so instead each lives in a
  // fixed-size clipping track carrying `contain: layout` — the animation still
  // dirties the fill but containment stops it propagating to any ancestor.
  const LAYOUT = /^(width|height|margin|margin-top|margin-bottom|margin-left|margin-right|padding|padding-top|padding-bottom|padding-left|padding-right|top|left|right|bottom|inset|flex|flex-basis|gap|font-size|border-width)$/;
  const BAR_FILLS = ['.scc-meter > i', '.scc-meter-fill', '.scc-drop-bar',
                     '.scc-bar-row .trk i', '.scc-funnel-bar', '.scc-roll-fill'];
  const decls = [];
  // Split the stylesheet into `selector { body }` rules so a flagged
  // transition can be attributed to the selector that declared it.
  const rules = CSS.match(/([^{}]+)\{([^{}]*)\}/g) || [];
  rules.forEach((rule) => {
    const m = rule.match(/([^{}]+)\{([^{}]*)\}/);
    const sel = m[1].trim().replace(/\s+/g, ' ');
    (m[2].match(/transition(?:-property)?\s*:[^;}]+/g) || []).forEach((d) => {
      // Strip durations/easings so `1s linear` can't false-positive.
      d.replace(/transition(?:-property)?\s*:/, '')
        .split(/,(?![^()]*\))/)
        .map((seg) => seg.trim().split(/\s+/)[0])
        .filter(Boolean)
        .forEach((p) => { if (LAYOUT.test(p)) decls.push({ sel, prop: p, d: d.trim() }); });
    });
  });
  const unexpected = decls.filter((x) => !BAR_FILLS.includes(x.sel));
  check('no stylesheet transition targets a layout property (outside bar fills)',
    unexpected.length === 0, unexpected.map((x) => `${x.sel}: ${x.d}`).join('; '));
  check('the only layout transitions left are contained data-viz bar fills',
    decls.length === BAR_FILLS.length && decls.every((x) => x.prop === 'width'),
    decls.map((x) => `${x.sel}:${x.prop}`).join('; '));
  // Each of those fills must sit in a track that stops the reflow escaping.
  const contained = ['.scc-meter', '.scc-meter-track', '.scc-bar-row .trk', '.scc-drop-row',
                     '.scc-funnel-track', '.scc-roll-bar']
    .every((s) => new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*contain:\\s*layout`).test(CSS));
  check('every animated bar fill is wrapped in a `contain: layout` track', contained);
  check('the session progress-bar fill is contained too',
    /overflow:hidden;contain:layout size/.test(app));

  // The toggle knob travels on a transform, not `left`.
  check('toggle knob travels via transform (composited, not laid out)',
    /\.toggle::after\s*\{[^}]*transform:\s*translateX/.test(CSS)
    && /\.toggle\.on::after\s*\{[^}]*--knob-x:\s*20px/.test(CSS));
  check('admin toggle knob also travels via transform',
    /\.scc-toggle input:checked \+ span::after\s*\{\s*transform:\s*translateX/.test(CSS));

  // Inline styles in app.js must not animate layout either (progress bar width
  // is the one deliberate exception: it is a paint-only fill inside a clipped,
  // fixed-size track, so it cannot reflow siblings).
  const inline = (app.match(/transition:\s*[^;"'`]+/g) || [])
    .filter((d) => LAYOUT.test(d.split(':')[1].split(/,(?![^()]*\))/).map((s) => s.trim().split(/\s+/)[0]).join(' ')));
  check('only the clipped progress-bar fill animates a size inline',
    inline.length === 1 && /width 1s linear/.test(inline[0]), JSON.stringify(inline));
}

{
  // Onboarding: goal + length taps must patch in place, not rebuild.
  const env = boot();
  const { document } = env.window;
  env.window.AuraApp.routes.personalize();
  await tick();

  const section0 = document.querySelector('section.screen');
  const bg0 = document.querySelector('.aura-bg');
  const goals0 = [...document.querySelectorAll('.goal-card')];
  const chips0 = [...document.querySelectorAll('[data-len]')];
  const slider0 = document.getElementById('stress-slider');

  for (const g of ['focus', 'sleep', 'relax', 'focus']) {
    document.querySelector(`[data-goal="${g}"]`).click();
    await tick();
  }
  for (const l of ['3', '15', '5']) {
    document.querySelector(`[data-len="${l}"]`).click();
    await tick();
  }

  check('personalize <section> is the same node (no rebuild)',
    document.querySelector('section.screen') === section0);
  check('personalize .aura-bg is the same node', document.querySelector('.aura-bg') === bg0);
  check('goal cards keep identity',
    [...document.querySelectorAll('.goal-card')].every((c, i) => c === goals0[i]));
  check('length chips keep identity',
    [...document.querySelectorAll('[data-len]')].every((c, i) => c === chips0[i]));
  check('stress slider keeps identity (drag state survives)',
    document.getElementById('stress-slider') === slider0);

  const onGoal = goals0.filter((g) => g.style.boxShadow);
  check('exactly one goal is glowing', onGoal.length === 1 && onGoal[0].dataset.goal === 'focus');
  const onLen = chips0.filter((c) => c.classList.contains('selected'));
  check('exactly one length chip is selected', onLen.length === 1 && onLen[0].dataset.len === '5');
  check('goal selection state is committed to the onboarding object',
    env.window.AuraApp.ob.goal === 'focus' && env.window.AuraApp.ob.length === 5);

  const gt = goals0[0].getAttribute('style').match(/transition:([^;]*)/)[1];
  check('goal card transitions only box-shadow + transform',
    /box-shadow/.test(gt) && /transform/.test(gt) && !/\ball\b/.test(gt), gt);
  check('goal card transition is eased', /cubic-bezier\(0\.4,0,0\.2,1\)/.test(gt));
}

{
  // The goal glow must be structurally interpolable with .glass, or it snaps.
  const env = boot();
  const { document } = env.window;
  env.window.AuraApp.routes.personalize();
  await tick();
  const split = (s) => s.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean);
  const glassDark = (CSS.match(/\n\.glass\s*\{[\s\S]*?box-shadow:\s*([^;]+);/) || [])[1] || '';
  document.querySelector('[data-goal="relax"]').click();
  await tick();
  const applied = document.querySelector('[data-goal="relax"]').style.boxShadow;
  const pat = (s) => split(s).map((x) => (/^inset\b/.test(x) ? 'i' : 'o')).join('');
  check('goal glow matches the dark .glass inset pattern => interpolates',
    pat(applied) === pat(glassDark), `${pat(applied)} vs ${pat(glassDark)}`);
  // jsdom echoes the authored shadow string verbatim, so match the authored
  // form: a 1px inset ring plus a 32px outset glow, both in the goal colour.
  const flat = applied.replace(/\s+/g, ' ');
  check('goal glow keeps the original ring + glow pixels',
    /inset 0 0 0 1px #34D39988/.test(flat) && /0 0 32px #34D39955/.test(flat), flat);
}

{
  // Settings appearance switch must not rebuild the screen.
  const env = boot();
  const { document } = env.window;
  await env.window.AuraApp.routes.settings();
  await tick(); await tick();

  const section0 = document.querySelector('section.screen');
  const bg0 = document.querySelector('.aura-bg');
  const slider0 = document.getElementById('theme-slider');
  const dot0 = document.getElementById('ambience-dot');
  const chips0 = [...document.querySelectorAll('[data-mode]')];

  document.querySelector('[data-mode="light"]').click();
  await sleep(500);

  check('settings <section> is the same node after a theme switch',
    document.querySelector('section.screen') === section0);
  check('settings .aura-bg is the same node', document.querySelector('.aura-bg') === bg0);
  check('theme slider keeps identity', document.getElementById('theme-slider') === slider0);
  check('appearance chips keep identity',
    document.querySelectorAll('[data-mode]').length === chips0.length
    && [...document.querySelectorAll('[data-mode]')].every((c, i) => c === chips0[i]));
  check('theme actually switched to light',
    document.documentElement.getAttribute('data-theme') === 'light');
  const sel = chips0.filter((c) => c.classList.contains('selected'));
  check('exactly the light chip is selected', sel.length === 1 && sel[0].dataset.mode === 'light');
  check('theme-literal accents were patched in place, not re-rendered',
    document.getElementById('ambience-dot') === dot0 && /245, 158, 11|#F59E0B/i.test(dot0.style.background), dot0.style.background);
  check('the app crossfade class was cleaned up',
    !document.documentElement.classList.contains('theme-switching'));
}

{
  // Reduced motion: no colour timeline at all, colours still correct.
  const env = boot({ manualRaf: true });
  env.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const { document } = env.window;
  const { orbHTML, setOrbPhase } = env.window.Aura;
  document.getElementById('app').innerHTML = orbHTML(200, 'inhale');
  const orb = document.querySelector('[data-orb]');
  const blobA = orb.querySelector('.orb-blob-a');
  setOrbPhase(orb, 'exhale', 0.8, 4000);
  const c = rgbas(blobA.style.background)[1];
  check('reduced motion applies the target colour immediately (no animation)',
    Math.round(c[0]) === 0x34 && Math.round(c[1]) === 0xD3 && Math.round(c[2]) === 0x99, String(c));
  check('reduced-motion media query still neutralises transitions globally',
    /prefers-reduced-motion:\s*reduce[\s\S]{0,400}transition-duration:\s*1ms\s*!important/.test(CSS));
}

// ---------------------------------------------------------------- summary
console.log('\n----------------------------------------------------');
console.log(`${passed} passed, ${failures.length} failed`);
void libEnv;
closeAll();
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('Motion is smooth and layout-stable across the app.\n');
// jsdom's visual-mode rAF driver can outlive close() on some builds; exit
// explicitly so the suite never leaves a process holding the event loop open.
process.exit(0);
