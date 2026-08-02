// AURA main app — hash-routed SPA replicating the design's 25-screen flow
(function () {
  'use strict';
  const { api, AuraState, Theme, Prefs, haptic, Tone, PHASE, orbHTML, setOrbPhase, ringHTML, icon, toast, confirmModal, upgradeModal, bgHTML, fmtTime, handleApiError, openModal, attachSlider, setSliderVal } = window.Aura;
  const root = document.getElementById('app');

  // Admin-controlled runtime flags (Super Command Centre → AI Engine). Cached per page load.
  let RUNTIME_FLAGS = null;
  const getFlags = async () => {
    if (RUNTIME_FLAGS) return RUNTIME_FLAGS;
    try { const { data } = await api.get('/app/config'); RUNTIME_FLAGS = data.flags || {}; }
    catch { RUNTIME_FLAGS = {}; }
    return RUNTIME_FLAGS;
  };

  // Back target for each route (drives swipe-back + shared back handling)
  const BACK_TARGET = {
    stats: 'home', programs: 'home', history: 'stats', profile: 'home',
    settings: 'home', mood: 'home', how: 'welcome',
  };

  // ---------- Shared UI fragments (extracted from repeated route markup) ----------
  // Standard list-screen header: back button + overline title + right slot.
  function screenHeader(title, opts) {
    opts = opts || {};
    const right = opts.right || '<span style="width:40px"></span>';
    return `<header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:${opts.mb || 24}px">
        <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">${title}</span>${right}
      </header>`;
  }
  // Wire the standard back button; target defaults to the route's BACK_TARGET.
  function wireBack(target) {
    const b = document.getElementById('back-btn');
    if (b) b.onclick = () => go(target || BACK_TARGET[(location.hash || '#').slice(1).split('?')[0]] || 'home');
  }
  // Loading placeholder: the pulsing orb IS the loader (never a static spinner).
  function loadingScreen(hue) {
    return `${bgHTML(hue)}<section class="screen" style="align-items:center;justify-content:center"><div class="orb-loading">${orbHTML(140, 'idle')}</div></section>`;
  }

  // ---------- Router with crossfade leave/enter transitions ----------
  const routes = {};
  let navToken = 0;
  function go(r) {
    const target = '#' + r;
    // Session/completion screens render without changing the hash — if the
    // target hash is already current, no hashchange fires, so route manually.
    if (location.hash === target) route();
    else location.hash = target;
  }
  // One-shot cookie-session recovery: local user state can be lost (Safari
  // ITP / storage eviction / cross-tab) while the httpOnly auth cookie is
  // still valid — every API call keeps working, but the guard would bounce
  // the user to welcome. Probe /auth/me once before giving up.
  let authProbe = null; // null = not tried, 'pending' = in flight, 'done' = resolved
  function route() {
    const h = (location.hash || '#splash').slice(1).split('?')[0];
    const user = AuraState.user;
    const publicRoutes = ['splash', 'welcome', 'login', 'signup', 'how', ''];
    if (!user && !publicRoutes.includes(h)) {
      if (authProbe === 'pending') return; // probe will re-route when it lands
      if (authProbe === null) {
        authProbe = 'pending';
        root.innerHTML = loadingScreen();
        api.get('/auth/me')
          .then(({ data }) => { AuraState.user = data.user; authProbe = 'done'; route(); })
          .catch(() => { authProbe = 'done'; go('welcome'); });
        return;
      }
      return go('welcome');
    }
    const token = ++navToken;
    const leaving = root.querySelector('.screen');
    const renderNext = () => {
      if (token !== navToken) return; // superseded by a newer navigation
      (routes[h] || routes.welcome)();
      window.scrollTo(0, 0);
    };
    if (leaving && !leaving.classList.contains('screen--leaving')) {
      leaving.classList.add('screen--leaving');
      setTimeout(renderNext, 200); // overlap: new screen fades in as old finishes
    } else {
      renderNext();
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- Swipe-back gesture (iOS-style) ----------
  // Left-edge horizontal drag follows the finger; commit past 35% width
  // (or a fast flick), otherwise spring back. Only on routes that have a
  // logical back target — never during a session or inside modals.
  (function swipeBack() {
    const EDGE = 28;            // px from left edge that arms the gesture
    const COMMIT_RATIO = 0.35;  // fraction of width to commit
    const FLICK_VX = 0.55;      // px/ms — fast flick commits regardless
    let startX = 0, startY = 0, startT = 0, dx = 0, active = false, decided = false, screen = null;

    function currentBack() {
      const h = (location.hash || '#').slice(1).split('?')[0];
      return BACK_TARGET[h] || null;
    }

    document.addEventListener('touchstart', (e) => {
      if (!currentBack() || document.body.classList.contains('modal-open')) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) return;
      screen = root.querySelector('.screen');
      if (!screen || screen.classList.contains('screen--leaving')) return;
      startX = t.clientX; startY = t.clientY; startT = e.timeStamp;
      dx = 0; active = true; decided = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!active || !screen) return;
      const t = e.touches[0];
      dx = Math.max(0, t.clientX - startX);
      const dy = Math.abs(t.clientY - startY);
      if (!decided) {
        if (dy > 12 && dy > dx) { active = false; return; } // vertical intent — bail
        if (dx > 10) { decided = true; screen.classList.add('screen--swiping'); }
        else return;
      }
      // follow the finger with slight resistance + fade
      const w = window.innerWidth;
      screen.style.transform = `translateX(${dx * 0.92}px)`;
      screen.style.opacity = String(Math.max(0.4, 1 - (dx / w) * 0.7));
    }, { passive: true });

    function finish(e) {
      if (!active || !screen) { active = false; return; }
      active = false;
      if (!decided) { screen = null; return; }
      const w = window.innerWidth;
      const vx = dx / Math.max(1, (e.timeStamp - startT));
      const commit = dx > w * COMMIT_RATIO || (vx > FLICK_VX && dx > 48);
      const el = screen; screen = null;
      el.classList.remove('screen--swiping');
      if (commit) {
        const back = currentBack();
        el.classList.add('screen--swipe-commit');
        el.style.transform = `translateX(${w}px)`;
        el.style.opacity = '0';
        haptic(6);
        setTimeout(() => { if (back) go(back); }, 170);
      } else {
        el.classList.add('screen--swipe-cancel');
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
        setTimeout(() => {
          el.classList.remove('screen--swipe-cancel');
          el.style.transform = ''; el.style.opacity = '';
        }, 280);
      }
    }
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', finish, { passive: true });
  })();

  // Onboarding local state
  const ob = { stress: 6, goal: 'relax', length: 5, sound: true, haptics: true, reminders: false };

  // ================= SPLASH =================
  routes.splash = function () {
    root.innerHTML = `${bgHTML('deep')}
    <section class="screen" style="align-items:center;justify-content:center">
      <div style="animation:auraBreatheSlow 6s ease-in-out infinite">${orbHTML(280, 'idle')}</div>
      <div style="position:absolute;bottom:90px;text-align:center">
        <h1 class="wordmark-grad" style="font-size:32px;font-weight:200;letter-spacing:20px;padding-left:20px">AURA</h1>
        <p style="font-size:11px;letter-spacing:6px;color:var(--text-tertiary);margin-top:12px;text-transform:uppercase">breathe · restore</p>
      </div>
    </section>`;
    setTimeout(() => { go(AuraState.user ? 'home' : 'welcome'); }, 1800);
  };

  // ================= 01 WELCOME =================
  routes.welcome = function () {
    root.innerHTML = `${bgHTML()}
    <section class="screen" id="welcome-screen" style="padding:24px">
      <header style="text-align:center;padding-top:28px"><span style="font-size:14px;font-weight:500;letter-spacing:8px;padding-left:8px">AURA</span></header>
      <div style="flex:1;display:flex;align-items:center;justify-content:center">${orbHTML(240, 'idle')}</div>
      <div style="text-align:center;padding-bottom:32px">
        <h1 style="font-size:32px;font-weight:600;letter-spacing:-0.5px;line-height:1.25;margin-bottom:14px">Breathe with<br/>intention.</h1>
        <p style="font-size:15px;color:var(--ink-55);max-width:280px;margin:0 auto 32px;line-height:1.5">A living orb that guides your breath — calmer in seconds, clearer in minutes.</p>
        <button class="btn-primary" id="begin-btn">Begin</button>
        <button style="margin-top:18px;font-size:14px;color:var(--text-tertiary)" id="login-link">I already have an account</button>
        <nav style="display:flex;gap:8px;justify-content:center;margin-top:28px" aria-label="Onboarding progress">
          <span style="width:20px;height:5px;border-radius:3px;background:linear-gradient(90deg,#7C3AED,#22D3EE)"></span>
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
        </nav>
      </div>
    </section>`;
    document.getElementById('begin-btn').onclick = () => go('signup');
    document.getElementById('login-link').onclick = () => go('login');
  };

  // ================= AUTH =================
  function authScreen(mode) {
    const isLogin = mode === 'login';
    root.innerHTML = `${bgHTML(isLogin ? 'blue' : '')}
    <section class="screen screen--scroll" style="padding:24px;justify-content:center">
      <div style="display:flex;justify-content:center;margin-bottom:28px">${orbHTML(120, 'idle', { intensity: 0.65 })}</div>
      <h1 style="font-size:26px;font-weight:600;text-align:center;margin-bottom:6px">${isLogin ? 'Welcome back.' : 'Create your space.'}</h1>
      <p style="font-size:14px;color:var(--text-tertiary);text-align:center;margin-bottom:30px">${isLogin ? 'Your practice is waiting.' : 'One minute to a calmer mind.'}</p>
      <form id="auth-form" style="max-width:360px;width:100%;margin:0 auto">
        <div id="auth-error"></div>
        ${isLogin ? '' : `<div class="field"><label for="f-name">NAME</label><input id="f-name" type="text" placeholder="How should we call you?" autocomplete="name"></div>`}
        <div class="field"><label for="f-email">EMAIL</label><input id="f-email" type="email" placeholder="you@example.com" autocomplete="email" required></div>
        <div class="field"><label for="f-pass">PASSWORD</label><input id="f-pass" type="password" placeholder="${isLogin ? 'Your password' : 'At least 8 characters'}" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required></div>
        <button type="submit" class="btn-primary" id="auth-submit" style="margin-top:10px">${isLogin ? 'Sign in' : 'Continue'}</button>
      </form>
      <button style="margin-top:22px;font-size:14px;color:var(--text-tertiary);text-align:center" id="auth-switch">
        ${isLogin ? "New here? <span style='color:#22D3EE'>Create an account</span>" : "Already have an account? <span style='color:#22D3EE'>Sign in</span>"}
      </button>
    </section>`;
    document.getElementById('auth-switch').onclick = () => go(isLogin ? 'signup' : 'login');
    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = isLogin ? 'Signing in…' : 'Creating…';
      try {
        const payload = {
          email: document.getElementById('f-email').value,
          password: document.getElementById('f-pass').value,
        };
        if (!isLogin) payload.name = document.getElementById('f-name').value;
        const { data } = await api.post(isLogin ? '/auth/login' : '/auth/signup', payload);
        AuraState.setToken(data.token); AuraState.user = data.user;
        if (data.user.role === 'admin') return location.href = '/admin';
        go(data.user.onboarded ? 'home' : 'how');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        document.getElementById('auth-error').innerHTML = `<div class="form-error">${msg}</div>`;
        btn.disabled = false; btn.textContent = isLogin ? 'Sign in' : 'Continue';
      }
    };
  }
  routes.login = () => authScreen('login');
  routes.signup = () => authScreen('signup');

  // ================= 02 HOW IT WORKS =================
  routes.how = function () {
    const cards = [
      { phase: 'inhale', label: 'Inhale', desc: 'Expand slowly with the orb', dur: '4s' },
      { phase: 'hold', label: 'Hold', desc: 'Pause at the peak', dur: '2s' },
      { phase: 'exhale', label: 'Exhale', desc: 'Release and soften', dur: '7s' },
    ];
    root.innerHTML = `${bgHTML('blue')}
    <section class="screen screen--scroll" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:36px">
        <span class="overline">Step 2 of 4</span>
        <button id="skip-btn" style="font-size:13px;color:var(--text-tertiary)">Skip</button>
      </header>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:28px">The rhythm is<br/>simple.</h1>
      <div style="display:flex;flex-direction:column;gap:14px;flex:1">
        ${cards.map((c) => `
        <article class="glass" style="padding:18px;display:flex;align-items:center;gap:16px">
          <div style="width:56px;height:56px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), ${PHASE[c.phase].a} 40%, ${PHASE[c.phase].b} 80%);box-shadow:0 0 24px ${PHASE[c.phase].glow}"></div>
          <div style="flex:1"><div style="font-size:16px;font-weight:500;margin-bottom:3px">${c.label}</div>
          <div style="font-size:13px;color:var(--text-tertiary)">${c.desc}</div></div>
          <span class="tabular" style="font-size:15px;color:${PHASE[c.phase].a};font-weight:500">${c.dur}</span>
        </article>`).join('')}
      </div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="next-btn">Continue</button>
        <nav style="display:flex;gap:8px;justify-content:center;margin-top:24px">
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
          <span style="width:20px;height:5px;border-radius:3px;background:linear-gradient(90deg,#7C3AED,#22D3EE)"></span>
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
          <span style="width:5px;height:5px;border-radius:3px;background:var(--dot-dim)"></span>
        </nav>
      </div>
    </section>`;
    document.getElementById('next-btn').onclick = () => go(AuraState.user ? 'personalize' : 'signup');
    document.getElementById('skip-btn').onclick = () => go(AuraState.user ? 'home' : 'signup');
  };

  // ================= 03 PERSONALIZE =================
  routes.personalize = function () {
    const stressLabel = (v) => v <= 3 ? 'Low' : v <= 6 ? 'Moderate' : 'High';
    const goals = [
      { id: 'relax', label: 'Relax', ic: 'lotus', color: '#34D399' },
      { id: 'focus', label: 'Focus', ic: 'focus', color: '#60A5FA' },
      { id: 'sleep', label: 'Sleep', ic: 'moon', color: '#A78BFA' },
    ];
    root.innerHTML = `${bgHTML()}
    <section class="screen screen--scroll" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:30px">
        <span class="overline">Step 3 of 4</span>
        <button id="skip-btn" style="font-size:13px;color:var(--text-tertiary)">Skip</button>
      </header>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;margin-bottom:30px">Tune AURA<br/>to you.</h1>

      <div style="margin-bottom:30px">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px">
          <span class="overline">Stress today</span>
          <span id="stress-val" class="slider-val" style="font-size:13px;color:#60A5FA">${stressLabel(ob.stress)} · ${ob.stress}</span>
        </div>
        <input type="range" min="0" max="10" value="${ob.stress}" class="aura-slider" id="stress-slider" aria-label="Stress level">
      </div>

      <div style="margin-bottom:30px">
        <div class="overline" style="margin-bottom:14px">Your goal</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px" id="goal-grid">
          ${goals.map((g) => `
          <button class="glass goal-card" data-goal="${g.id}" style="padding:20px 10px;display:flex;flex-direction:column;align-items:center;gap:10px;border-radius:18px;transition:all 400ms cubic-bezier(0.4,0,0.2,1);${ob.goal === g.id ? `box-shadow:0 0 32px ${g.color}55, inset 0 0 0 1px ${g.color}88;` : ''}">
            <span style="color:${g.color}">${icon(g.ic, 26)}</span>
            <span style="font-size:13px;font-weight:500">${g.label}</span>
          </button>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:30px">
        <div class="overline" style="margin-bottom:14px">Preferred session</div>
        <div style="display:flex;gap:10px" id="len-row">
          ${[3, 5, 10, 15].map((m) => `<button class="chip ${ob.length === m ? 'selected' : ''}" data-len="${m}">${m} min</button>`).join('')}
        </div>
      </div>

      <div style="flex:1"></div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="next-btn">Continue</button>
      </div>
    </section>`;
    attachSlider(document.getElementById('stress-slider'), {
      onMove: (v) => setSliderVal(document.getElementById('stress-val'), `${stressLabel(v)} · ${v}`),
      onCommit: (v) => { ob.stress = v; },
    });
    document.querySelectorAll('.goal-card').forEach((b) => b.onclick = () => { ob.goal = b.dataset.goal; routes.personalize(); });
    document.querySelectorAll('[data-len]').forEach((b) => b.onclick = () => { ob.length = +b.dataset.len; routes.personalize(); });
    document.getElementById('next-btn').onclick = () => go('permissions');
    document.getElementById('skip-btn').onclick = () => go('permissions');
  };

  // ================= 04 PERMISSIONS =================
  routes.permissions = function () {
    const rows = [
      { key: 'sound', label: 'Spatial Sound', desc: 'Breathing tones that move with you', color: '#60A5FA' },
      { key: 'haptics', label: 'Haptic Feedback', desc: 'Gentle pulses guide each phase', color: '#A78BFA' },
      { key: 'reminders', label: 'Gentle Reminders', desc: 'A soft nudge, never a guilt trip', color: '#34D399' },
    ];
    root.innerHTML = `${bgHTML('green')}
    <section class="screen screen--scroll" style="padding:24px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;margin-bottom:16px">
        <span class="overline">Step 4 of 4</span><span></span>
      </header>
      <div style="display:flex;justify-content:center;margin-bottom:24px">${orbHTML(140, 'exhale', { intensity: 0.6 })}</div>
      <h1 style="font-size:28px;font-weight:600;letter-spacing:-0.5px;text-align:center;margin-bottom:30px">Make it feel<br/>alive.</h1>
      <div class="glass" style="padding:8px 20px">
        ${rows.map((r) => `
        <div style="display:flex;align-items:center;gap:14px;padding:16px 0;border-bottom:1px solid var(--hairline-soft)">
          <div style="width:8px;height:8px;border-radius:50%;background:${r.color};box-shadow:0 0 12px ${r.color}"></div>
          <div style="flex:1"><div style="font-size:15px;font-weight:500">${r.label}</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${r.desc}</div></div>
          <button class="toggle ${ob[r.key] ? 'on' : ''}" data-key="${r.key}" role="switch" aria-checked="${ob[r.key]}" aria-label="${r.label}"></button>
        </div>`).join('')}
      </div>
      <div style="flex:1"></div>
      <div style="padding-bottom:24px">
        <button class="btn-primary" id="enter-btn">Enter AURA</button>
      </div>
    </section>`;
    document.querySelectorAll('.toggle').forEach((t) => t.onclick = () => {
      ob[t.dataset.key] = !ob[t.dataset.key];
      t.classList.toggle('on'); t.setAttribute('aria-checked', ob[t.dataset.key]);
    });
    document.getElementById('enter-btn').onclick = async () => {
      try {
        await api.put('/app/profile', {
          goal: ob.goal, baselineStress: ob.stress, sessionLength: ob.length,
          prefs: { sound: ob.sound, haptics: ob.haptics, reminders: ob.reminders }, onboarded: true,
        });
        const u = AuraState.user; u.onboarded = true; AuraState.user = u;
        go('home');
      } catch (err) { handleApiError(err); }
    };
  };

  // ================= 05 HOME =================
  routes.home = function () {
    const u = AuraState.user || {};
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    root.innerHTML = `${bgHTML()}
    <section class="screen" id="home-screen">
      <header style="padding:20px 24px 0;display:flex;justify-content:space-between;align-items:center">
        <button class="btn-icon" id="profile-btn" aria-label="Profile"><span style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#22D3EE);display:block"></span></button>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-60);letter-spacing:1px;text-transform:uppercase">
          <span class="pulse-dot" style="background:#34D399;box-shadow:0 0 8px #34D399"></span> Ready
        </div>
        <button class="btn-icon" id="settings-btn" aria-label="Settings">${icon('settings', 18)}</button>
      </header>
      <div style="padding:24px 32px 0">
        <p style="font-size:13px;color:var(--ink-50);margin-bottom:4px">${greet}, ${u.name || 'friend'}</p>
        <h1 style="font-size:22px;font-weight:500;letter-spacing:-0.3px">Let's find your calm.</h1>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center">
        <div style="position:relative;width:300px;height:300px;display:flex;align-items:center;justify-content:center">
          ${ringHTML(300, 0, 1.5)}
          ${orbHTML(220, 'idle')}
        </div>
      </div>
      <div style="padding:0 20px 12px">
        <button class="glass" id="suggestion-card" style="width:100%;padding:14px 16px;display:flex;align-items:center;gap:12px;text-align:left">
          <span style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(124,58,237,0.4),rgba(34,211,238,0.4));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 16px rgba(124,58,237,0.35)">${icon('spark', 16)}</span>
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:500;margin-bottom:2px">4-7-8 · Deep Unwind</span>
          <span style="display:block;font-size:11px;color:var(--ink-55)">Tuned to your ${hour >= 18 ? 'evening' : 'daytime'} stress · ${u.sessionLength || 5} min</span></span>
          <span style="font-size:12px;color:var(--ink-50)">Change</span>
        </button>
      </div>
      <nav style="padding:0 24px 42px;display:flex;align-items:center;justify-content:space-between">
        <button id="insights-btn" style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <span class="btn-icon" style="width:52px;height:52px">${icon('stats', 18)}</span>
          <span style="font-size:10px;color:var(--ink-50)">Insights</span>
        </button>
        <button class="fab" id="play-fab" aria-label="Start session">${icon('play', 30, '#fff')}</button>
        <button id="mood-btn" style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <span class="btn-icon" style="width:52px;height:52px">${icon('heart', 18)}</span>
          <span style="font-size:10px;color:var(--ink-50)">Mood</span>
        </button>
      </nav>
    </section>`;
    document.getElementById('play-fab').onclick = () => startSession({ inhale: 4, hold: 7, exhale: 8, cycles: 6, name: '4-7-8' });
    document.getElementById('suggestion-card').onclick = () => go('programs');
    document.getElementById('insights-btn').onclick = () => go('stats');
    document.getElementById('mood-btn').onclick = () => go('mood');
    document.getElementById('settings-btn').onclick = () => go('settings');
    document.getElementById('profile-btn').onclick = () => go('profile');
    // long-press FAB → quick start sheet
    let pressTimer;
    const fab = document.getElementById('play-fab');
    fab.onmousedown = fab.ontouchstart = () => { pressTimer = setTimeout(() => quickStartSheet(), 550); };
    fab.onmouseup = fab.onmouseleave = fab.ontouchend = () => clearTimeout(pressTimer);
  };

  // ================= 14 QUICK START (bottom sheet) =================
  function quickStartSheet() {
    let dur = 3, intent = 'relax';
    const m = openModal('modal-veil', `
      <div class="sheet">
        <div class="sheet-grabber"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px">
          <h3 style="font-size:19px;font-weight:600">Quick start</h3>
          <button class="btn-icon" data-x style="width:34px;height:34px">${icon('close', 16)}</button>
        </div>
        <div class="overline" style="margin-bottom:12px">Duration</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px">
          ${[1, 3, 5].map((mm) => `
          <button class="chip ${dur === mm ? 'selected' : ''}" data-dur="${mm}" style="padding:14px;display:flex;flex-direction:column;gap:3px;border-radius:16px">
            <span style="font-size:16px;font-weight:600">${mm} min</span>
            <span style="font-size:11px;opacity:0.6">${Math.round(mm * 60 / 19)} breaths</span>
          </button>`).join('')}
        </div>
        <div class="overline" style="margin-bottom:12px">Intention</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:26px">
          <button class="chip ${intent === 'relax' ? 'selected' : ''}" data-int="relax" style="padding:14px;border-radius:16px">Relax</button>
          <button class="chip ${intent === 'focus' ? 'selected' : ''}" data-int="focus" style="padding:14px;border-radius:16px">Focus</button>
        </div>
        <button class="btn-primary" data-begin>Begin · <span class="slider-val" data-dur-label>${dur} min</span></button>
      </div>`);
    const veil = m.veil;
    veil.querySelector('[data-x]').onclick = () => m.close();
    veil.querySelectorAll('[data-dur]').forEach((b) => b.onclick = () => {
      dur = +b.dataset.dur;
      veil.querySelectorAll('[data-dur]').forEach((x) => x.classList.toggle('selected', +x.dataset.dur === dur));
      setSliderVal(veil.querySelector('[data-dur-label]'), `${dur} min`);
    });
    veil.querySelectorAll('[data-int]').forEach((b) => b.onclick = () => {
      intent = b.dataset.int;
      veil.querySelectorAll('[data-int]').forEach((x) => x.classList.toggle('selected', x.dataset.int === intent));
    });
    veil.querySelector('[data-begin]').onclick = () => m.close(() => {
      const pat = intent === 'focus' ? { inhale: 4, hold: 4, exhale: 4 } : { inhale: 4, hold: 7, exhale: 8 };
      const cycleSec = pat.inhale + pat.hold + pat.exhale;
      startSession({ ...pat, cycles: Math.max(2, Math.round(dur * 60 / cycleSec)), name: intent === 'focus' ? 'Box' : '4-7-8' });
    });
    veil.onclick = (e) => { if (e.target === veil) m.close(); };
  }

  // ================= 21 LOADING → 06 SESSION ACTIVE =================
  let sessionCtl = null;
  async function startSession(cfg) {
    // Loading screen (screen 21 — the orb IS the loader)
    root.innerHTML = `${bgHTML('deep')}
    <section class="screen" style="align-items:center;justify-content:center;padding:24px">
      <div style="position:absolute;top:56px;display:flex;align-items:center;gap:8px" class="overline">
        <span class="pulse-dot" style="background:#A78BFA;box-shadow:0 0 8px #A78BFA"></span> Preparing
      </div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center">
        ${[0, 1, 2].map((i) => `<div style="position:absolute;width:220px;height:220px;border-radius:50%;border:1px solid rgba(167,139,250,0.35);animation:auraPulseRing 3s ease-out ${i}s infinite"></div>`).join('')}
        ${orbHTML(180, 'idle')}
      </div>
      <h2 style="font-size:22px;font-weight:500;margin-top:44px">Tuning to you…</h2>
      <p style="font-size:13px;color:var(--text-tertiary);margin-top:8px">Matching pace to your breath</p>
      <div class="shimmer-track" style="position:absolute;bottom:72px"></div>
    </section>`;
    let sessionId = null;
    try {
      const { data } = await api.post('/app/sessions/start', { inhale: cfg.inhale, hold: cfg.hold, exhale: cfg.exhale, cycles: cfg.cycles, programId: cfg.programId, mood: cfg.mood });
      sessionId = data.sessionId;
    } catch (err) {
      if (err.response && err.response.status === 402) { go('home'); setTimeout(() => upgradeModal(err.response.data.error), 400); return; }
      handleApiError(err, 'Could not start session.'); go('home'); return;
    }
    setTimeout(() => runSession(sessionId, cfg), 1400);
  }

  function runSession(sessionId, cfg) {
    const totalSec = (cfg.inhale + cfg.hold + cfg.exhale) * cfg.cycles;
    const S = sessionCtl = {
      id: sessionId, cfg, phase: 'inhale', phaseLeft: cfg.inhale, cycle: 1,
      elapsed: 0, paused: false, timer: null, done: false,
    };

    root.innerHTML = `${bgHTML('blue')}
    <section class="screen" id="session-screen">
      <header style="padding:20px 24px 0;display:flex;justify-content:space-between;align-items:center">
        <button class="btn-icon" id="close-btn" aria-label="End session">${icon('close', 17)}</button>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-60);letter-spacing:1px;text-transform:uppercase">
          <span class="pulse-dot" style="background:#60A5FA;box-shadow:0 0 8px #60A5FA"></span>
          <span class="tabular">${cfg.name || 'Custom'} · Cycle <span id="cycle-n">1</span> / ${cfg.cycles}</span>
        </div>
        <button class="btn-icon" id="sound-btn" aria-label="Sound">${icon('sound', 17)}</button>
      </header>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <div style="position:relative;width:320px;height:320px;display:flex;align-items:center;justify-content:center">
          <span id="ring-holder">${ringHTML(320, 0, 2)}</span>
          ${orbHTML(240, 'inhale', { intensity: 0.85 })}
        </div>
        <div style="text-align:center;margin-top:28px">
          <div id="phase-label" class="grad-text--blue" style="font-size:40px;font-weight:300;letter-spacing:-1px">Breathe in</div>
          <div id="phase-count" class="tabular" style="font-size:15px;color:var(--text-tertiary);margin-top:8px;letter-spacing:4px">${cfg.inhale}</div>
        </div>
      </div>
      <div style="padding:0 20px 40px">
        <div class="glass" style="padding:16px 18px;display:flex;align-items:center;gap:16px">
          <span class="tabular" id="elapsed" style="font-size:14px;color:var(--text-secondary)">00:00</span>
          <div style="flex:1;height:4px;border-radius:2px;background:var(--glass-heavy);overflow:hidden">
            <div id="progress-bar" style="height:100%;width:0%;border-radius:2px;background:linear-gradient(90deg,#7C3AED,#22D3EE);transition:width 1s linear"></div>
          </div>
          <button class="btn-icon" id="pause-btn" style="width:44px;height:44px" aria-label="Pause">${icon('pause', 17)}</button>
        </div>
      </div>
    </section>`;

    const orbEl = document.querySelector('[data-orb]');
    const labelEl = document.getElementById('phase-label');
    const countEl = document.getElementById('phase-count');
    const gradFor = { inhale: 'grad-text--blue', hold: 'grad-text--violet', exhale: 'grad-text', idle: 'grad-text' };

    function applyPhase() {
      const durSec = { inhale: cfg.inhale, hold: cfg.hold, exhale: cfg.exhale }[S.phase] || 4;
      setOrbPhase(orbEl, S.phase, 0.85, durSec * 1000);
      labelEl.textContent = PHASE[S.phase].label;
      labelEl.className = gradFor[S.phase];
      countEl.textContent = S.phaseLeft;
      // Sensory guidance — both gated by user prefs (settings toggles)
      haptic(S.phase === 'hold' ? 12 : 20);
      Tone.phase(S.phase, durSec);
    }
    applyPhase();

    function tick() {
      if (S.paused || S.done) return;
      S.elapsed++; S.phaseLeft--;
      countEl.textContent = Math.max(S.phaseLeft, 0);
      document.getElementById('elapsed').textContent = fmtTime(S.elapsed);
      document.getElementById('progress-bar').style.width = Math.min(100, (S.elapsed / totalSec) * 100) + '%';
      const ring = document.querySelector('[data-ring]');
      if (ring) {
        const circ = parseFloat(ring.getAttribute('stroke-dasharray'));
        ring.setAttribute('stroke-dashoffset', circ * (1 - Math.min(1, S.elapsed / totalSec)));
      }
      if (S.phaseLeft <= 0) {
        if (S.phase === 'inhale') { S.phase = cfg.hold > 0 ? 'hold' : 'exhale'; }
        else if (S.phase === 'hold') { S.phase = 'exhale'; }
        else {
          S.cycle++;
          if (S.cycle > cfg.cycles) return completeSession(true);
          document.getElementById('cycle-n').textContent = S.cycle;
          S.phase = 'inhale';
        }
        S.phaseLeft = { inhale: cfg.inhale, hold: cfg.hold, exhale: cfg.exhale }[S.phase];
        applyPhase();
      }
    }
    S.timer = setInterval(tick, 1000);

    document.getElementById('pause-btn').onclick = () => pauseScreen();
    document.getElementById('close-btn').onclick = async () => {
      if (await confirmModal('End session?', 'Your progress so far will still be saved.', 'End session')) completeSession(false);
    };
    document.getElementById('sound-btn').onclick = () => {
      const next = !Prefs.all.sound;
      Prefs.set({ sound: next });
      if (!next) Tone.stop();
      toast(next ? 'Breathing tones on' : 'Breathing tones off');
    };

    async function completeSession(finished) {
      if (S.done) return; S.done = true;
      clearInterval(S.timer);
      Tone.stop();
      const cyclesDone = finished ? cfg.cycles : Math.max(0, S.cycle - 1);
      try {
        const { data } = await api.post(`/app/sessions/${S.id}/complete`, { cyclesDone, durationSec: S.elapsed });
        completeScreen(data, S.elapsed);
      } catch (err) { handleApiError(err, 'Could not save session.'); go('home'); }
    }
    S.complete = completeSession;
  }

  // ================= 22 PAUSED =================
  function pauseScreen() {
    const S = sessionCtl; if (!S) return;
    S.paused = true;
    Tone.stop();
    const m = openModal('modal-veil modal-veil--center', `
      <div class="sheet--center-plain" style="text-align:center;max-width:360px;width:100%;padding:0 24px;animation:auraCenterIn 300ms var(--ease-out) both">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:9999px;background:var(--glass-medium);border:1px solid var(--glass-border);font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--text-secondary);margin-bottom:24px">
          ${icon('pause', 12)} Paused
        </div>
        <h2 style="font-size:26px;font-weight:500;margin-bottom:10px">Take your time.</h2>
        <p style="font-size:14px;color:var(--text-tertiary);margin-bottom:28px">The orb will wait for you. Nothing is lost.</p>
        <div class="glass glass--heavy" style="padding:18px;margin-bottom:24px;display:flex;justify-content:space-around">
          <div><div class="tabular" style="font-size:17px;font-weight:500">${S.cycle}/${S.cfg.cycles}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Cycle</div></div>
          <div><div class="tabular" style="font-size:17px;font-weight:500">${fmtTime(S.elapsed)}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Elapsed</div></div>
          <div><div class="tabular" style="font-size:17px;font-weight:500">${S.cfg.inhale}-${S.cfg.hold}-${S.cfg.exhale}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Pattern</div></div>
        </div>
        <button class="btn-primary" data-resume style="margin-bottom:12px">${icon('play', 18)} Resume</button>
        <button class="btn-ghost" data-end>End session</button>
      </div>`);
    m.veil.style.backdropFilter = 'blur(30px)'; // veil bg comes from theme token
    m.veil.querySelector('[data-resume]').onclick = () => m.close(() => { S.paused = false; });
    m.veil.querySelector('[data-end]').onclick = () => m.close(() => S.complete(false));
  }

  // ================= 07 COMPLETE =================
  function completeScreen(result, elapsed) {
    sessionCtl = null; // fully reset session state — no dead-ends
    root.innerHTML = `${bgHTML('green')}
    <section class="screen" style="padding:24px;align-items:center;text-align:center">
      <div style="padding-top:8px">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:9999px;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.3);font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6EE7B7">
          ${icon('check', 13)} Complete
        </div>
      </div>
      <div class="orb-stage"><div class="orb-scale">${orbHTML(170, 'exhale', { intensity: 0.6 })}</div></div>
      <div>
        <h1 style="font-size:29px;font-weight:600;letter-spacing:-0.5px;margin-bottom:10px">You're calmer now.</h1>
        <p class="compress-gap" style="font-size:14px;color:var(--text-tertiary);max-width:300px;line-height:1.55;margin:0 auto 24px">
          Heart rate down ${Math.abs(result.heartRateDelta)} bpm · Consistency ${result.consistency >= 80 ? 'improved from last session' : 'building with practice'}.
        </p>
      </div>
      <div class="stagger-in" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;max-width:380px;margin:22px 0">
        <div class="glass" style="padding:16px 10px"><div class="tabular" style="font-size:20px;font-weight:500;color:#60A5FA">${fmtTime(elapsed)}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Duration</div></div>
        <div class="glass" style="padding:16px 10px"><div class="tabular" style="font-size:20px;font-weight:500;color:#34D399">${result.consistency}%</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Consistency</div></div>
        <div class="glass" style="padding:16px 10px"><div class="tabular" style="font-size:20px;font-weight:500;color:#A78BFA">${result.calmDelta}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Calm score Δ</div></div>
      </div>
      <div class="cta-anchor" style="width:100%;max-width:380px">
        <button class="btn-primary" id="home-btn" style="margin-bottom:10px">${icon('home', 17)} Return Home</button>
        <div style="display:flex;gap:10px">
          <button class="btn-ghost" id="insights-btn" style="flex:1">${icon('stats', 15)} View Insights</button>
          <button class="btn-ghost" id="again-btn" style="flex:1">Go again</button>
        </div>
      </div>
    </section>`;
    document.getElementById('home-btn').onclick = () => go('home');
    document.getElementById('insights-btn').onclick = () => go('stats');
    document.getElementById('again-btn').onclick = () => startSession({ inhale: 4, hold: 7, exhale: 8, cycles: 6, name: '4-7-8' });
  }

  // ================= 08 MOOD CHECK-IN =================
  routes.mood = function () {
    const moods = [
      { id: 'anxious', label: 'Anxious', sub: 'racing thoughts', phase: 'inhale' },
      { id: 'calm', label: 'Calm', sub: 'steady & present', phase: 'exhale' },
      { id: 'tired', label: 'Tired', sub: 'low energy', phase: 'hold' },
      { id: 'focused', label: 'Focused', sub: 'sharp & clear', phase: 'idle' },
    ];
    let selected = null, suggestion = null;
    function render() {
      const now = new Date();
      const dayStr = now.toLocaleDateString('en-US', { weekday: 'long' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
      root.innerHTML = `${bgHTML()}
      <section class="screen screen--scroll" style="padding:24px">
        <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:26px">
          <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
          <span class="overline">Check-in</span><span style="width:40px"></span>
        </header>
        <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:6px">${dayStr} · ${timeStr}</p>
        <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:28px">How are you feeling<br/>right now?</h1>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
          ${moods.map((m) => `
          <button class="glass mood-card" data-mood="${m.id}" style="padding:20px 16px;display:flex;flex-direction:column;align-items:flex-start;gap:12px;border-radius:20px;transition:all 400ms cubic-bezier(0.4,0,0.2,1);${selected === m.id ? `box-shadow:0 0 32px ${PHASE[m.phase].glow}, inset 0 0 0 1px ${PHASE[m.phase].a}66;` : ''}">
            <span style="width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), ${PHASE[m.phase].a} 40%, ${PHASE[m.phase].b} 80%);box-shadow:0 0 18px ${PHASE[m.phase].glow}"></span>
            <span style="text-align:left"><span style="display:block;font-size:15px;font-weight:500">${m.label}</span>
            <span style="display:block;font-size:11px;color:var(--text-tertiary);margin-top:2px">${m.sub}</span></span>
          </button>`).join('')}
        </div>
        <div id="suggestion-zone">${suggestion ? `
        <div class="glass" style="padding:16px;display:flex;align-items:center;gap:14px;animation:auraSlideUp 400ms cubic-bezier(0.4,0,0.2,1);${RUNTIME_FLAGS && RUNTIME_FLAGS.emotion_ambience ? 'box-shadow:0 0 32px rgba(124,58,237,0.35), inset 0 0 0 1px rgba(124,58,237,0.25);' : ''}">
          <span style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(124,58,237,0.4),rgba(34,211,238,0.4));display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon('spark', 16)}</span>
          <span><span style="display:block;font-size:13px;font-weight:500;margin-bottom:2px">AURA suggests: ${suggestion.pattern}</span>
          <span style="display:block;font-size:11px;color:var(--text-tertiary)">${suggestion.reason} · ${suggestion.minutes} min</span></span>
        </div>` : ''}</div>
        <div style="flex:1"></div>
        <div style="padding-bottom:24px">
          <button class="btn-primary" id="begin-btn" ${!selected ? 'disabled' : ''}>Begin session</button>
        </div>
      </section>`;
      document.getElementById('back-btn').onclick = () => go('home');
      document.querySelectorAll('.mood-card').forEach((b) => b.onclick = async () => {
        selected = b.dataset.mood;
        try {
          const { data } = await api.post('/app/moods', { mood: selected });
          suggestion = data.suggestion;
          await getFlags();
        } catch (err) { handleApiError(err); }
        render();
      });
      document.getElementById('begin-btn').onclick = () => {
        if (!suggestion) return;
        const cycleSec = suggestion.inhale + suggestion.hold + suggestion.exhale;
        startSession({ inhale: suggestion.inhale, hold: suggestion.hold, exhale: suggestion.exhale, cycles: Math.max(2, Math.round(suggestion.minutes * 60 / cycleSec)), name: suggestion.pattern.split(' ')[0], mood: selected });
      };
    }
    render();
  };

  // ================= 09 STATS / INSIGHTS =================
  routes.stats = async function () {
    root.innerHTML = loadingScreen('deep');
    let d;
    try { ({ data: d } = await api.get('/app/stats')); }
    catch (err) { handleApiError(err); return go('home'); }

    // Empty state (screen 20)
    if (!d.sessions) {
      root.innerHTML = `${bgHTML('deep')}
      <section class="screen" style="padding:24px;align-items:center;justify-content:center;text-align:center">
        <div style="opacity:0.85">${orbHTML(200, 'idle')}</div>
        <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin:36px 0 12px">No data yet —<br/>just you and the orb.</h1>
        <p style="font-size:14px;color:var(--text-tertiary);max-width:300px;line-height:1.55;margin-bottom:34px">Your first session will unlock insights, trends, and gentle nudges tuned to you.</p>
        <div style="width:100%;max-width:340px">
          <button class="btn-primary" id="first-btn" style="margin-bottom:12px">Start first session</button>
          <button class="btn-ghost" id="browse-btn">Browse programs</button>
        </div>
      </section>`;
      document.getElementById('first-btn').onclick = () => startSession({ inhale: 4, hold: 7, exhale: 8, cycles: 6, name: '4-7-8' });
      document.getElementById('browse-btn').onclick = () => go('programs');
      return;
    }

    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000);
      const iso = dt.toISOString().slice(0, 10);
      const hit = (d.daily || []).find((x) => x.day === iso);
      week.push({ label: days[dt.getDay()], score: hit ? hit.score : 0, today: i === 0 });
    }
    const maxScore = Math.max(...week.map((w) => w.score), 60);

    root.innerHTML = `${bgHTML('deep')}
    <section class="screen screen--scroll" style="padding:24px 20px 40px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:24px">
        <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">Insights</span>
        <button class="btn-icon" id="history-btn" aria-label="History">${icon('doc', 16)}</button>
      </header>

      <div style="text-align:center;margin-bottom:30px">
        <div class="overline" style="margin-bottom:10px">Calm score · 7d</div>
        <div class="grad-text--violet tabular" style="font-size:68px;font-weight:300;letter-spacing:-2px;line-height:1">${d.calmScore}</div>
        <div style="font-size:13px;color:${d.calmDelta >= 0 ? '#6EE7B7' : '#FCD34D'};margin-top:8px">${d.calmDelta >= 0 ? '▲ +' : '▼ '}${d.calmDelta}</div>
      </div>

      <div class="glass" style="padding:20px;margin-bottom:14px">
        <div class="overline" style="margin-bottom:16px">Daily calm</div>
        <div style="display:flex;align-items:flex-end;gap:8px;height:90px">
          ${week.map((w) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
            ${w.today && w.score ? `<span class="tabular" style="font-size:11px;color:#A5F3FC">${w.score}</span>` : ''}
            <div style="width:100%;max-width:26px;border-radius:6px;height:${Math.max(6, (w.score / maxScore) * 70)}px;background:${w.today ? 'linear-gradient(180deg,#A78BFA,#22D3EE)' : (w.score ? 'var(--dot-dim)' : 'var(--bar-empty)')};${w.today ? 'box-shadow:0 0 16px rgba(124,58,237,0.5)' : ''}"></div>
            <span style="font-size:10px;color:var(--text-tertiary)">${w.label}</span>
          </div>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div class="glass" style="padding:18px">
          <div class="overline" style="margin-bottom:10px">Stress trend</div>
          <svg width="100%" height="36" viewBox="0 0 100 36" preserveAspectRatio="none">
            <path d="M0,8 C15,12 25,22 40,20 C55,18 65,30 80,28 C90,27 95,32 100,33" fill="none" stroke="#34D399" stroke-width="2"/>
          </svg>
          <div style="font-size:14px;color:#6EE7B7;margin-top:8px" class="tabular">${d.stressTrendPct}%</div>
        </div>
        <div class="glass" style="padding:18px">
          <div class="overline" style="margin-bottom:10px">Sessions</div>
          <div class="tabular" style="font-size:30px;font-weight:300">${d.sessions}</div>
          <div style="display:flex;gap:4px;margin-top:10px">
            ${week.map((w) => `<span style="width:7px;height:7px;border-radius:50%;background:${w.score ? 'linear-gradient(135deg,#7C3AED,#22D3EE)' : 'var(--bar-empty)'}"></span>`).join('')}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px">${d.streak}-day streak</div>
        </div>
      </div>

      <div class="glass" style="padding:18px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span class="overline">Breath consistency</span>
          <span class="tabular" style="font-size:13px;color:#A5F3FC">${d.consistency}%</span>
        </div>
        <div style="height:6px;border-radius:3px;background:var(--glass-heavy);overflow:hidden">
          <div style="height:100%;width:${d.consistency}%;border-radius:3px;background:linear-gradient(90deg,#7C3AED,#22D3EE)"></div>
        </div>
      </div>

      <div class="glass" style="padding:18px;display:flex;gap:14px;align-items:flex-start;border-color:rgba(167,139,250,0.3)">
        <span style="width:36px;height:36px;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,rgba(124,58,237,0.5),rgba(34,211,238,0.35));display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(124,58,237,0.4)">${icon('spark', 16)}</span>
        <div><div class="overline" style="margin-bottom:6px;color:#C4B5FD">AURA Insight</div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.55">${d.insight}</p></div>
      </div>

      <button class="btn-ghost" id="deep-btn" style="margin-top:16px">${icon('stats', 16)} Deep analytics ${AuraState.user && AuraState.user.plan === 'free' ? '· Pro' : ''}</button>
    </section>`;
    document.getElementById('back-btn').onclick = () => go('home');
    document.getElementById('history-btn').onclick = () => go('history');
    document.getElementById('deep-btn').onclick = async () => {
      try {
        const { data } = await api.get('/app/stats/deep');
        const best = (data.byHour || []).sort((a, b) => b.score - a.score)[0];
        toast(best ? `Deep insight: your best hour is ${best.hour}:00 (avg calm ${best.score})` : 'Complete more sessions to unlock hourly patterns.');
      } catch (err) { handleApiError(err); }
    };
  };

  // ================= 13 PROGRAMS =================
  routes.programs = async function () {
    root.innerHTML = loadingScreen();
    let d;
    try { ({ data: d } = await api.get('/app/programs')); }
    catch (err) { handleApiError(err); return go('home'); }
    const cats = { beginner: 'Beginner', deep_calm: 'Deep Calm', sleep_prep: 'Sleep Prep' };
    let filter = 'All';
    const tagFilters = ['All', 'Stress', 'Sleep', 'Focus', 'Calm'];

    // A program belongs to a filter if the intent key appears in its intents
    // list (fallback: its display tag). Fixes programs vanishing from
    // categories they logically belong to (e.g. Body Scan under Sleep).
    function matchesFilter(p, f) {
      if (f === 'All') return true;
      const key = f.toLowerCase();
      const intents = (p.intents || '').split(',').map((s) => s.trim()).filter(Boolean);
      return intents.includes(key) || (p.tag || '').toLowerCase() === key;
    }

    function render() {
      const list = d.programs.filter((p) => matchesFilter(p, filter));
      root.innerHTML = `${bgHTML()}
      <section class="screen screen--scroll" style="padding:24px 20px 40px">
        <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:22px">
          <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
          <span class="overline">Library</span><span style="width:40px"></span>
        </header>
        <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:6px">Guided journeys</h1>
        <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:20px">Curated breathing programs for every state of mind.</p>
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:22px">
          ${tagFilters.map((t) => `<button class="chip ${filter === t ? 'selected' : ''}" data-f="${t}" style="flex-shrink:0">${t}</button>`).join('')}
        </div>
        ${Object.entries(cats).map(([catId, catLabel]) => {
          const items = list.filter((p) => p.category === catId);
          if (!items.length) return '';
          return `<div class="overline" style="margin:18px 0 12px">${catLabel}</div>
          ${items.map((p) => `
          <article class="glass" style="padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:12px;${p.is_new ? 'border-color:rgba(167,139,250,0.4);box-shadow:0 0 40px rgba(124,58,237,0.2), inset 0 1px 0 rgba(255,255,255,0.1), 0 20px 40px rgba(0,0,0,0.35)' : ''}">
            <span style="width:56px;height:56px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), ${PHASE[p.phase] ? PHASE[p.phase].a : '#7C3AED'} 40%, ${PHASE[p.phase] ? PHASE[p.phase].b : '#22D3EE'} 80%);box-shadow:0 0 20px ${PHASE[p.phase] ? PHASE[p.phase].glow : 'rgba(124,58,237,0.5)'};${p.locked ? 'filter:saturate(0.4);opacity:0.6' : ''}"></span>
            <span style="flex:1">
              <span style="display:flex;align-items:center;gap:8px"><span style="font-size:15px;font-weight:500">${p.title}</span>
              ${p.is_new ? '<span class="badge badge--premium">NEW</span>' : ''}
              ${p.locked ? `<span style="color:var(--text-tertiary)">${icon('shield', 13)}</span>` : ''}</span>
              <span style="display:block;font-size:12px;color:var(--text-tertiary);margin-top:3px">${p.duration_min} min · ${p.tag} · ${p.inhale}-${p.hold}-${p.exhale}</span>
            </span>
            <button class="btn-icon" data-play="${p.id}" style="width:44px;height:44px;${p.locked ? 'opacity:0.4' : ''}" aria-label="Play ${p.title}">${icon('play', 16)}</button>
          </article>`).join('')}`;
        }).join('')}
      </section>`;
      document.getElementById('back-btn').onclick = () => go('home');
      document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
      document.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => {
        const p = d.programs.find((x) => x.id === +b.dataset.play);
        if (p.locked) return upgradeModal(`"${p.title}" is part of AURA Pro. Unlock every program plus deep analytics.`);
        sessionSetup(p);
      });
    }
    render();
  };

  // ================= 12 SESSION SETUP =================
  function sessionSetup(program) {
    // State isolated in a local object; the card renders ONCE.
    // Slider drags patch only the value nodes — the layout never re-renders.
    const st = { inhale: program.inhale, hold: program.hold, exhale: program.exhale, cycles: program.cycles };
    const COLORS = { inhale: '#60A5FA', hold: '#A78BFA', exhale: '#34D399' };
    function totalStr() {
      const s = (st.inhale + st.hold + st.exhale) * st.cycles;
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    const m = openModal('modal-veil', `
      <div class="sheet">
        <div class="sheet-grabber"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <button class="btn-icon" data-x style="width:34px;height:34px">${icon('close', 15)}</button>
          <h3 style="font-size:17px;font-weight:600">Customize</h3><span style="width:34px"></span>
        </div>
        <div style="display:flex;justify-content:center;margin-bottom:14px">${orbHTML(110, program.phase || 'idle', { intensity: 0.7 })}</div>
        <div class="tabular" style="text-align:center;font-size:26px;font-weight:300;margin-bottom:22px">
          <span class="slider-val" data-big="inhale" style="color:#60A5FA">${st.inhale}</span> <span style="color:var(--text-disabled)">·</span>
          <span class="slider-val" data-big="hold" style="color:#A78BFA">${st.hold}</span> <span style="color:var(--text-disabled)">·</span>
          <span class="slider-val" data-big="exhale" style="color:#34D399">${st.exhale}</span>
        </div>
        <div class="glass" style="padding:20px;margin-bottom:20px">
          ${[['Inhale', 'inhale', st.inhale, 2, 10], ['Hold', 'hold', st.hold, 0, 10], ['Exhale', 'exhale', st.exhale, 2, 12]].map(([label, key, val, min, max]) => `
          <div style="margin-bottom:18px">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              <span style="font-size:13px;color:var(--text-secondary)">${label}</span>
              <span class="tabular slider-val" data-val="${key}" style="font-size:15px;font-weight:500;color:${COLORS[key]};text-shadow:0 0 12px ${COLORS[key]}">${val}s</span>
            </div>
            <input type="range" min="${min}" max="${max}" value="${val}" class="aura-slider" data-k="${key}" aria-label="${label} seconds">
          </div>`).join('')}
        </div>
        <div class="overline" style="margin-bottom:12px">Cycles</div>
        <div style="display:flex;gap:8px;margin-bottom:24px" data-cycles>
          ${[4, 6, 8, 10, 12].map((n) => `<button class="chip ${st.cycles === n ? 'selected' : ''}" data-c="${n}" style="flex:1;text-align:center">${n}</button>`).join('')}
        </div>
        <button class="btn-primary" data-begin>Begin session · <span class="slider-val" data-total>${totalStr()}</span></button>
      </div>`);
    const veil = m.veil;
    const q = (sel) => veil.querySelector(sel);
    function syncTotal() { setSliderVal(q('[data-total]'), totalStr()); }

    veil.querySelectorAll('.aura-slider').forEach((s) => attachSlider(s, {
      onMove: (v) => {
        const k = s.dataset.k;
        setSliderVal(q(`[data-val="${k}"]`), v + 's');
        setSliderVal(q(`[data-big="${k}"]`), String(v));
      },
      onCommit: (v) => { st[s.dataset.k] = v; syncTotal(); },
    }));
    veil.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      st.cycles = +b.dataset.c;
      veil.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('selected', +x.dataset.c === st.cycles));
      syncTotal();
    });
    q('[data-x]').onclick = () => m.close();
    q('[data-begin]').onclick = () => m.close(() =>
      startSession({ inhale: st.inhale, hold: st.hold, exhale: st.exhale, cycles: st.cycles, name: program.title, programId: program.id }));
    veil.onclick = (e) => { if (e.target === veil) m.close(); };
  }

  // ================= 16 HISTORY =================
  routes.history = async function () {
    root.innerHTML = loadingScreen();
    let d;
    try { ({ data: d } = await api.get('/app/history')); }
    catch (err) { handleApiError(err); return go('home'); }

    const groups = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    (d.sessions || []).forEach((s) => {
      const day = (s.started_at || '').slice(0, 10);
      if (day === today) groups.Today.push(s);
      else if (day === yest) groups.Yesterday.push(s);
      else if (day > weekAgo) groups['This week'].push(s);
      else groups.Earlier.push(s);
    });
    const phaseColor = (score) => score >= 80 ? '#34D399' : score >= 60 ? '#60A5FA' : '#A78BFA';
    const streakBars = Array.from({ length: 17 }, (_, i) => i < Math.min(d.summary.streak, 17));

    root.innerHTML = `${bgHTML()}
    <section class="screen screen--scroll" style="padding:24px 20px 40px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:22px">
        <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">History</span><span style="width:40px"></span>
      </header>
      <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:6px">Your practice</h1>
      <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:22px">${d.summary.sessions} sessions · ${Math.round(d.summary.minutes)} minutes · ${d.summary.streak}-day streak</p>
      <div style="display:flex;gap:5px;margin-bottom:28px" aria-label="Streak strip">
        ${streakBars.map((lit) => `<span style="flex:1;height:34px;border-radius:5px;background:${lit ? 'linear-gradient(180deg,#7C3AED,#22D3EE)' : 'var(--bar-empty)'};${lit ? 'box-shadow:0 0 10px rgba(124,58,237,0.4)' : ''}"></span>`).join('')}
      </div>
      ${Object.entries(groups).map(([label, items]) => !items.length ? '' : `
      <div class="overline" style="margin:18px 0 12px">${label}</div>
      <div class="glass" style="padding:4px 18px">
        ${items.map((s) => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="width:32px;height:32px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.85), ${phaseColor(s.calm_score)} 45%, #22D3EE 85%)"></span>
          <span style="flex:1"><span style="display:block;font-size:13px;font-weight:500">${new Date(s.started_at + 'Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          <span style="display:block;font-size:11px;color:var(--text-tertiary);margin-top:2px">${fmtTime(s.duration_sec)} · ${s.program_title || s.pattern}</span></span>
          <span class="tabular" style="font-size:16px;font-weight:500;color:${phaseColor(s.calm_score)}">${s.calm_score}</span>
        </div>`).join('')}
      </div>`).join('') || '<p style="font-size:14px;color:var(--text-tertiary);text-align:center;margin-top:40px">No sessions yet.</p>'}
    </section>`;
    document.getElementById('back-btn').onclick = () => go('stats');
  };

  // ================= 15 PROFILE =================
  routes.profile = async function () {
    root.innerHTML = loadingScreen('violet');
    let d, me;
    try {
      [{ data: d }, { data: me }] = await Promise.all([api.get('/app/stats'), api.get('/auth/me')]);
      AuraState.user = { ...AuraState.user, ...me.user };
    } catch (err) { handleApiError(err); return go('home'); }
    const u = me.user;
    const planLabel = u.plan === 'premium' ? 'AURA Premium' : u.plan === 'pro' ? 'AURA Pro' : 'Free plan';
    const milestones = [
      { label: 'First breath', unlocked: d.sessions >= 1 },
      { label: '7-day streak', unlocked: d.streak >= 7 },
      { label: '60 minutes', unlocked: d.minutes >= 60 },
      { label: 'Calm 90+', unlocked: d.calmScore >= 90 },
    ];
    root.innerHTML = `${bgHTML()}
    <section class="screen screen--scroll" style="padding:24px 20px 40px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:26px">
        <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">Profile</span>
        <button class="btn-icon" id="logout-btn" aria-label="Log out">${icon('logout', 16)}</button>
      </header>
      <div style="text-align:center;margin-bottom:28px">
        <div style="position:relative;display:inline-block">
          <span style="display:block;width:92px;height:92px;border-radius:50%;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), #7C3AED 40%, #22D3EE 85%);box-shadow:0 0 40px rgba(124,58,237,0.5)"></span>
          ${u.plan !== 'free' ? `<span style="position:absolute;bottom:0;right:-4px;width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#22D3EE);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg-primary)">${icon('spark', 13)}</span>` : ''}
        </div>
        <h1 style="font-size:22px;font-weight:600;margin-top:16px">${u.name || 'You'}</h1>
        <p style="font-size:12px;color:var(--text-tertiary);margin-top:4px">${planLabel} · ${u.email}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
        <div class="glass" style="padding:16px 8px;text-align:center"><div class="tabular" style="font-size:22px;font-weight:400;color:#60A5FA">${d.sessions}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Sessions</div></div>
        <div class="glass" style="padding:16px 8px;text-align:center"><div class="tabular" style="font-size:22px;font-weight:400;color:#22D3EE">${d.minutes}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Minutes</div></div>
        <div class="glass" style="padding:16px 8px;text-align:center"><div class="tabular" style="font-size:22px;font-weight:400;color:#34D399">${d.streak}</div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">Streak</div></div>
      </div>
      <div class="glass" style="padding:20px;margin-bottom:16px;display:flex;align-items:center;gap:18px">
        <div><div class="overline" style="margin-bottom:8px">Calm trend · 7d</div>
        <div style="display:flex;align-items:baseline;gap:10px"><span class="grad-text--violet tabular" style="font-size:38px;font-weight:300">${d.calmScore}</span>
        <span style="font-size:13px;color:#6EE7B7">▲ +${Math.max(0, d.calmDelta)}</span></div></div>
        <svg width="110" height="40" viewBox="0 0 110 40" style="margin-left:auto" preserveAspectRatio="none">
          <path d="M0,30 C20,28 30,20 50,18 C70,16 85,10 110,6" fill="none" stroke="url(#pGrad)" stroke-width="2"/>
          <defs><linearGradient id="pGrad"><stop offset="0%" stop-color="#A78BFA"/><stop offset="100%" stop-color="#22D3EE"/></linearGradient></defs>
        </svg>
      </div>
      <div class="overline" style="margin-bottom:12px">Milestones</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        ${milestones.map((m) => `
        <div class="glass" style="padding:16px;display:flex;align-items:center;gap:12px;${m.unlocked ? '' : 'opacity:0.35'}">
          <span style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,rgba(124,58,237,0.4),rgba(34,211,238,0.3));display:flex;align-items:center;justify-content:center">${icon(m.unlocked ? 'check' : 'shield', 15)}</span>
          <span style="font-size:12px;font-weight:500">${m.label}</span>
        </div>`).join('')}
      </div>
      <a href="/billing" class="btn-ghost" style="margin-bottom:10px">${icon('card', 16)} Billing & plan</a>
      <button class="btn-ghost" id="history-btn">${icon('doc', 16)} Session history</button>
    </section>`;
    document.getElementById('back-btn').onclick = () => go('home');
    document.getElementById('history-btn').onclick = () => go('history');
    document.getElementById('logout-btn').onclick = async () => {
      if (await confirmModal('Log out?', 'Your practice is saved and will be here when you return.', 'Log out')) {
        try { await api.post('/auth/logout'); } catch (e) {}
        AuraState.clear(); go('welcome');
      }
    };
  };

  // ================= 10 SETTINGS =================
  routes.settings = async function () {
    let me;
    try { ({ data: me } = await api.get('/auth/me')); AuraState.user = { ...AuraState.user, ...me.user }; }
    catch (err) { handleApiError(err); return go('home'); }
    const u = me.user;
    // Merge server prefs into the local functional store so behavior
    // (haptics/sound/glow/theme) follows the account everywhere.
    const prefs = Prefs.set(u.prefs || {});
    const isLight = Theme.mode === 'light';
    const planLabel = u.plan === 'premium' ? 'AURA Premium' : u.plan === 'pro' ? 'AURA Pro' : 'Free plan';

    function save(patch) {
      Object.assign(prefs, Prefs.set(patch || {}));
      api.put('/app/profile', { prefs }).catch((err) => handleApiError(err));
    }

    root.innerHTML = `${bgHTML()}
    <section class="screen screen--scroll" style="padding:24px 20px 40px">
      <header style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;margin-bottom:24px">
        <button class="btn-icon" id="back-btn" aria-label="Back">${icon('back', 17)}</button>
        <span class="overline">Settings</span><span style="width:40px"></span>
      </header>
      <button class="glass" id="profile-card" style="width:100%;padding:18px;display:flex;align-items:center;gap:16px;margin-bottom:24px;text-align:left">
        <span style="width:52px;height:52px;border-radius:50%;flex-shrink:0;background:radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), #7C3AED 40%, #22D3EE 85%)"></span>
        <span style="flex:1"><span style="display:block;font-size:16px;font-weight:500">${u.name || 'You'}</span>
        <span style="display:block;font-size:12px;color:var(--text-tertiary);margin-top:3px">${planLabel}</span></span>
        ${icon('arrow', 17)}
      </button>

      <div class="overline" style="margin-bottom:12px">Sensory</div>
      <div class="glass" style="padding:6px 18px;margin-bottom:24px">
        ${[['sound', 'Spatial Audio', '#60A5FA'], ['haptics', 'Haptics', '#A78BFA']].map(([k, label, color]) => `
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color}"></span>
          <span style="flex:1;font-size:14px">${label}</span>
          <button class="toggle ${prefs[k] ? 'on' : ''}" data-pref="${k}" role="switch" aria-checked="${prefs[k]}" aria-label="${label}"></button>
        </div>`).join('')}
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0">
          <span style="width:7px;height:7px;border-radius:50%;background:#22D3EE;box-shadow:0 0 10px #22D3EE"></span>
          <span style="flex:1;font-size:14px">Glow intensity</span>
          <span style="display:flex;gap:6px" id="glow-step">
            ${['low', 'medium', 'high'].map((g) => `<button data-glow="${g}" aria-label="Glow ${g}" style="width:11px;height:11px;border-radius:50%;background:${prefs.glow === g ? 'linear-gradient(135deg,#7C3AED,#22D3EE)' : 'rgba(255,255,255,0.15)'};${prefs.glow === g ? 'box-shadow:0 0 10px rgba(124,58,237,0.6)' : ''}"></button>`).join('')}
          </span>
        </div>
      </div>

      <div class="overline" style="margin-bottom:12px">Practice</div>
      <div class="glass" style="padding:6px 18px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="flex:1;font-size:14px">Breathing style</span>
          <span style="font-size:13px;color:var(--text-tertiary)">4-7-8</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="flex:1;font-size:14px">Daily reminder</span>
          <button class="toggle ${prefs.reminders ? 'on' : ''}" data-pref="reminders" role="switch" aria-checked="${prefs.reminders}" aria-label="Daily reminder"></button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0">
          <span style="flex:1;font-size:14px">Adaptive pacing ${u.plan === 'free' ? '<span class="badge badge--premium" style="margin-left:6px">PRO</span>' : ''}</span>
          <button class="toggle ${prefs.adaptive && u.plan !== 'free' ? 'on' : ''}" data-pref="adaptive" role="switch" aria-label="Adaptive pacing"></button>
        </div>
      </div>

      <div class="overline" style="margin-bottom:12px">Ambience</div>
      <div class="glass" style="padding:6px 18px 18px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--hairline-soft)">
          <span style="width:7px;height:7px;border-radius:50%;background:${isLight ? '#F59E0B' : '#A78BFA'};box-shadow:0 0 10px ${isLight ? '#F59E0B' : '#A78BFA'}"></span>
          <span style="flex:1;font-size:14px">Appearance</span>
          <span style="display:flex;gap:6px" id="mode-seg" role="radiogroup" aria-label="Appearance">
            ${['dark', 'light'].map((mo) => `<button class="chip ${Theme.mode === mo ? 'selected' : ''}" data-mode="${mo}" role="radio" aria-checked="${Theme.mode === mo}" style="padding:7px 16px;font-size:12px;text-transform:capitalize">${mo}</button>`).join('')}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;margin:15px 0 12px">
          <span style="font-size:14px">Theme intensity</span>
          <span class="tabular slider-val" id="theme-val" style="font-size:13px;color:${isLight ? '#0891B2' : '#A5F3FC'}">${prefs.theme}%</span>
        </div>
        <input type="range" min="0" max="100" value="${prefs.theme}" class="aura-slider" id="theme-slider" aria-label="Theme intensity">
      </div>
      <a href="/pricing" class="btn-ghost">${icon('spark', 16)} ${u.plan === 'free' ? 'Upgrade to AURA Plus' : 'Manage plan'}</a>
    </section>`;
    document.getElementById('back-btn').onclick = () => go('home');
    document.getElementById('profile-card').onclick = () => go('profile');
    document.querySelectorAll('[data-pref]').forEach((t) => t.onclick = () => {
      const k = t.dataset.pref;
      if (k === 'adaptive' && u.plan === 'free') return upgradeModal('Adaptive pacing learns your rhythm and adjusts each session — part of AURA Pro.');
      t.classList.toggle('on');
      t.setAttribute('aria-checked', t.classList.contains('on'));
      save({ [k]: !prefs[k] });
      haptic(6);
    });
    // Glow steps: update dots in place (no full re-render) + live side effect
    document.querySelectorAll('[data-glow]').forEach((b) => b.onclick = () => {
      save({ glow: b.dataset.glow });
      document.querySelectorAll('[data-glow]').forEach((x) => {
        const on = x.dataset.glow === b.dataset.glow;
        x.style.background = on ? 'linear-gradient(135deg,#7C3AED,#22D3EE)' : 'rgba(128,128,160,0.25)';
        x.style.boxShadow = on ? '0 0 10px rgba(124,58,237,0.6)' : 'none';
      });
      haptic(6);
    });
    // Appearance: instant-but-smooth global switch, persisted with prefs
    document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
      if (b.dataset.mode === Theme.mode) return;
      Theme.set(b.dataset.mode, true);
      save({ mode: b.dataset.mode });
      haptic(6);
      // re-render after the crossfade so orb + accents pick up light physics
      setTimeout(() => routes.settings(), 300);
    });
    attachSlider(document.getElementById('theme-slider'), {
      onMove: (v) => {
        setSliderVal(document.getElementById('theme-val'), v + '%');
        document.documentElement.style.setProperty('--bg-vis', String(0.35 + (v / 100) * 0.65));
      },
      onCommit: (v) => save({ theme: v }),
    });
  };

  route(); // boot
  window.AuraApp = { routes, go, ob, startSession };
})();
