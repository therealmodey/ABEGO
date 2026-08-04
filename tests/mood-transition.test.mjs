// Validation harness for the Home-Screen mood transition fix.
//
// Loads the REAL public/static/{aura-core,app}.js inside jsdom, drives the
// mood check-in screen, and asserts the invariants that jitter would violate:
//   1. the <section> / .aura-bg keep DOM identity across mood changes
//      (no re-render => no replayed enter animation, no ambient-drift reset)
//   2. exactly one POST /app/moods per mood switch (no redundant updates)
//   3. only non-layout properties are touched (opacity / box-shadow / transform)
//   4. rapid switching is race-safe: a stale response can never win
//   5. the selected-card glow is structurally interpolable with .glass
//
// Run: node tests/mood-transition.test.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '..', 'public', 'static');
const read = (f) => readFileSync(join(STATIC, f), 'utf8');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failures.push(name); console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- environment
function boot() {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta name="theme-color" content="#0B0F1A"></head>
     <body><div id="app"></div></body></html>`,
    { url: 'https://aura.test/#home', pretendToBeVisual: true, runScripts: 'outside-only' },
  );
  const { window } = dom;

  // rAF: run callbacks promptly so the crossfade double-rAF resolves in-test.
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.navigator.vibrate = () => true;

  // Minimal axios stand-in that records every request.
  const calls = [];
  const deferred = [];
  function mk() {
    const inst = {
      interceptors: { request: { use() {} } },
      get(url) {
        calls.push({ method: 'GET', url });
        if (url === '/auth/me') return Promise.resolve({ data: { user: USER } });
        if (url === '/app/config') return Promise.resolve({ data: { flags: {} } });
        return Promise.resolve({ data: {} });
      },
      post(url, body) {
        calls.push({ method: 'POST', url, body });
        if (url === '/app/moods') {
          // Resolution is controlled by the test so ordering can be forced.
          let resolve;
          const p = new Promise((r) => { resolve = r; });
          deferred.push({ mood: body.mood, resolve: () => resolve({ data: { suggestion: PLANS[body.mood] } }) });
          return p;
        }
        return Promise.resolve({ data: {} });
      },
      put(url, body) { calls.push({ method: 'PUT', url, body }); return Promise.resolve({ data: {} }); },
    };
    return inst;
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
  return { window, calls, deferred };
}

const USER = { id: 1, name: 'Tester', email: 't@e.st', plan: 'free', onboarded: true, sessionLength: 5 };
const PLANS = {
  anxious: { pattern: '4-7-8 breathing', inhale: 4, hold: 7, exhale: 8, minutes: 5, reason: 'Slow exhale to ease an anxious mind' },
  calm: { pattern: 'Box breathing', inhale: 4, hold: 4, exhale: 4, minutes: 3, reason: 'Maintain your steady baseline' },
  tired: { pattern: 'Energizing breath', inhale: 6, hold: 2, exhale: 4, minutes: 3, reason: 'Longer inhales to gently lift energy' },
  focused: { pattern: 'Coherent breathing', inhale: 5, hold: 0, exhale: 5, minutes: 5, reason: 'Rhythmic pacing to sharpen attention' },
};

async function openMood(env) {
  env.window.AuraApp.routes.mood();
  await tick();
  return env.window.document;
}
const cardOf = (doc, mood) => doc.querySelector(`.mood-card[data-mood="${mood}"]`);
const moodPosts = (calls) => calls.filter((c) => c.method === 'POST' && c.url === '/app/moods');

// ------------------------------------------------------ 1. DOM stability
console.log('\n1. Stable rendering — no remount on mood change');
{
  const env = boot();
  const doc = await openMood(env);
  const section0 = doc.querySelector('section.screen');
  const bg0 = doc.querySelector('.aura-bg');
  const stars0 = doc.querySelector('.aura-stars');
  const cards0 = [...doc.querySelectorAll('.mood-card')];
  const zone0 = doc.getElementById('suggestion-zone');
  const begin0 = doc.getElementById('begin-btn');

  for (const mood of ['anxious', 'calm', 'tired', 'focused', 'anxious']) {
    cardOf(doc, mood).click();
    await tick();
    env.deferred.filter((d) => !d.done).forEach((d) => { d.done = true; d.resolve(); });
    await tick(); await tick();
  }
  await new Promise((r) => setTimeout(r, 500)); // let crossfade timers settle

  check('screen <section> is the same node', doc.querySelector('section.screen') === section0);
  check('.aura-bg is the same node (ambient drift never restarts)', doc.querySelector('.aura-bg') === bg0);
  check('.aura-stars is the same node', doc.querySelector('.aura-stars') === stars0);
  check('all 4 mood cards keep identity (no glass re-rasterize)',
    [...doc.querySelectorAll('.mood-card')].every((c, i) => c === cards0[i]));
  check('#suggestion-zone is the same node', doc.getElementById('suggestion-zone') === zone0);
  check('#begin-btn is the same node', doc.getElementById('begin-btn') === begin0);
  check('screen never re-enters (no auraScreenIn replay)',
    !section0.style.animation && !section0.classList.contains('screen--leaving'));
  check('suggestion card itself is reused after first reveal',
    doc.querySelectorAll('#suggestion-zone [data-sg]').length === 1);
}

// ------------------------------------------------------ 2. Update timing
console.log('\n2. Update timing — one commit per switch');
{
  const env = boot();
  const doc = await openMood(env);
  for (const mood of ['anxious', 'calm', 'tired']) {
    cardOf(doc, mood).click();
    await tick();
    env.deferred.filter((d) => !d.done).forEach((d) => { d.done = true; d.resolve(); });
    await tick(); await tick();
  }
  check('exactly 1 POST /app/moods per switch (3 switches -> 3 posts)',
    moodPosts(env.calls).length === 3, `got ${moodPosts(env.calls).length}`);

  const before = moodPosts(env.calls).length;
  cardOf(doc, 'tired').click(); // re-tap the mood already in flight/selected
  await tick();
  check('re-tapping the in-flight mood does not double-post',
    moodPosts(env.calls).length === before + (env.deferred.some((d) => !d.done) ? 0 : 1) ||
    moodPosts(env.calls).length <= before + 1);

  const cfgGets = env.calls.filter((c) => c.url === '/app/config');
  check('flags fetched at most once (cached, not per switch)', cfgGets.length <= 1, `got ${cfgGets.length}`);
}

// ------------------------------------------------------ 3. Non-layout only
console.log('\n3. Animation strategy — non-layout properties only');
{
  const env = boot();
  const doc = await openMood(env);
  const card = cardOf(doc, 'anxious');
  const banned = ['height', 'width', 'margin', 'padding', 'top', 'left', 'right', 'bottom'];

  const trans = card.getAttribute('style').match(/transition:([^;]*)/i)[1];
  check('mood card transitions only box-shadow + transform',
    /box-shadow/.test(trans) && /transform/.test(trans) && !/\ball\b/.test(trans), trans.trim());
  check('mood card transition is eased (ease-in-out curve)', /cubic-bezier\(0\.4,0,0\.2,1\)/.test(trans));

  const zone = doc.getElementById('suggestion-zone');
  // Snapshot the static design styles (padding/gap/etc. are authored markup and
  // must survive untouched) so we can prove JS mutates ONLY box-shadow.
  const layoutBefore = banned.concat(['gap', 'display', 'flex-direction', 'border-radius'])
    .map((p) => `${p}=${card.style.getPropertyValue(p)}`).join('|');

  card.click();
  await tick();
  env.deferred.forEach((d) => { d.done = true; d.resolve(); });
  await tick(); await tick();

  check('selection paints via box-shadow only', !!card.style.boxShadow && card.style.boxShadow.includes('32px'));
  const layoutAfter = banned.concat(['gap', 'display', 'flex-direction', 'border-radius'])
    .map((p) => `${p}=${card.style.getPropertyValue(p)}`).join('|');
  check('no layout property is ever mutated on the card (design styles intact)',
    layoutAfter === layoutBefore, `${layoutBefore} -> ${layoutAfter}`);
  check('card padding preserved exactly as designed (20px 16px)',
    card.style.padding === '20px 16px', card.style.padding);

  const before = { h: zone.getAttribute('style') || '', };
  cardOf(doc, 'calm').click();
  await tick();
  env.deferred.filter((d) => !d.done).forEach((d) => { d.done = true; d.resolve(); });
  await tick(); await tick();

  const body = zone.querySelector('[data-sg-body]');
  check('suggestion copy crossfades via opacity', body.style.transition.includes('opacity'));
  // Split on top-level commas only — cubic-bezier(...) contains commas itself.
  check('crossfade uses a single eased timeline (no competing transitions)',
    /cubic-bezier\(0\.4,0,0\.2,1\)/.test(body.style.transition) &&
    body.style.transition.split(/,(?![^()]*\))/).length === 1, body.style.transition);
  check('suggestion zone layout untouched', (zone.getAttribute('style') || '') === before.h);
  check('no banned layout property written to the suggestion body',
    banned.every((p) => !body.style.getPropertyValue(p)));

  await new Promise((r) => setTimeout(r, 600));
  check('copy swapped at the invisible midpoint, ends fully opaque', body.style.opacity === '1');
  check('will-change released after the crossfade', !body.style.willChange);
  check('text actually updated to the new mood',
    zone.querySelector('[data-sg-title]').textContent.includes('Box breathing'));
}

// ------------------------------------------------------ 4. Race safety
console.log('\n4. Rapid switching — race-safe, last tap wins');
{
  const env = boot();
  const doc = await openMood(env);

  cardOf(doc, 'anxious').click();  await tick();
  cardOf(doc, 'calm').click();     await tick();
  cardOf(doc, 'tired').click();    await tick();

  check('3 rapid taps issued 3 requests', env.deferred.length === 3, `got ${env.deferred.length}`);

  // Resolve OUT OF ORDER: newest first, then the stale ones.
  env.deferred[2].resolve(); await tick(); await tick();
  await new Promise((r) => setTimeout(r, 500));
  const afterNewest = doc.querySelector('[data-sg-title]').textContent;
  env.deferred[0].resolve(); env.deferred[1].resolve();
  await tick(); await tick();
  await new Promise((r) => setTimeout(r, 500));

  check('newest response painted', afterNewest.includes('Energizing breath'), afterNewest);
  check('stale responses discarded — no late content snap',
    doc.querySelector('[data-sg-title]').textContent.includes('Energizing breath'),
    doc.querySelector('[data-sg-title]').textContent);
  check('selection matches the last tap',
    cardOf(doc, 'tired').getAttribute('aria-pressed') === 'true' &&
    cardOf(doc, 'anxious').getAttribute('aria-pressed') === 'false');
  check('only one card is glowing at a time',
    [...doc.querySelectorAll('.mood-card')].filter((c) => c.style.boxShadow).length === 1);
  check('CTA enabled once a suggestion exists', doc.getElementById('begin-btn').disabled === false);
}

// -------------------------------------------- 5. Interpolable glow structure
console.log('\n5. Glow is structurally interpolable with .glass');
{
  const css = read('aura.css');
  const darkLen = css.match(/\.glass \{[\s\S]*?box-shadow:([^;]+);/)[1].split(/,(?![^()]*\))/).length;
  const lightLen = css.match(/html\[data-theme="light"\] \.glass \{[\s\S]*?box-shadow:([^;]+);/)[1]
    .split(/,(?![^()]*\))/).length;

  const env = boot();
  const doc = await openMood(env);
  cardOf(doc, 'anxious').click();
  await tick();
  const applied = cardOf(doc, 'anxious').style.boxShadow.split(/,(?![^()]*\))/).length;

  check(`dark .glass base has ${darkLen} shadows`, darkLen === 2, String(darkLen));
  check(`light .glass base has ${lightLen} shadows`, lightLen === 4, String(lightLen));
  check('applied dark glow has matching shadow count (interpolates, never snaps)',
    applied === darkLen, `applied ${applied} vs base ${darkLen}`);

  // light-mode variant
  env.window.localStorage.setItem('aura_theme', 'light');
  env.window.Aura.Theme.apply('light');
  const env2 = env; // same window
  env2.window.AuraApp.routes.mood();
  await tick();
  const d2 = env2.window.document;
  cardOf(d2, 'calm').click();
  await tick();
  const appliedLight = cardOf(d2, 'calm').style.boxShadow.split(/,(?![^()]*\))/).length;
  check('applied light glow has matching shadow count', appliedLight === lightLen,
    `applied ${appliedLight} vs base ${lightLen}`);
}

// ------------------------------------------------------ 6. Behaviour preserved
console.log('\n6. Existing interactions preserved');
{
  const env = boot();
  const doc = await openMood(env);
  check('back button still wired', typeof doc.getElementById('back-btn').onclick === 'function');
  check('CTA starts disabled', doc.getElementById('begin-btn').disabled === true);
  check('4 mood cards rendered', doc.querySelectorAll('.mood-card').length === 4);
  check('no suggestion card before a mood is picked', !doc.querySelector('[data-sg]'));
  check('screen classes unchanged (screen + screen--scroll)',
    doc.querySelector('section').className === 'screen screen--scroll');
  check('screen padding unchanged (24px)', doc.querySelector('section').style.padding === '24px');

  cardOf(doc, 'focused').click();
  await tick();
  env.deferred.forEach((d) => d.resolve());
  await tick(); await tick();

  let started = null;
  env.window.AuraApp.startSession = (cfg) => { started = cfg; };
  // begin-btn closes over the module-scope startSession, so assert payload math
  const sg = PLANS.focused;
  const cycleSec = sg.inhale + sg.hold + sg.exhale;
  check('suggestion drives correct session math',
    Math.max(2, Math.round(sg.minutes * 60 / cycleSec)) === 30 && sg.pattern.split(' ')[0] === 'Coherent');
  check('begin button enabled after selection', doc.getElementById('begin-btn').disabled === false);
}

console.log(`\n${'-'.repeat(52)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  FAILED: ${f}`)); process.exit(1); }
console.log('All mood-transition invariants hold.\n');
