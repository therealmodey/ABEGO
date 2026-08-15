// AURA — Authentication & Account security flows (design handoff)
// Vanilla-JS SPA screens that integrate into the existing hash-routed app.
// Reuses window.Aura (api, AuraState, orbHTML, icon, toast, …) and the app
// router via window.AuraApp.go / window.AuraApp.routes.
(function () {
  'use strict';
  // The HTML shell loads this file on EVERY page (pricing/billing/admin) to
  // keep <script> ordering uniform, but those pages don't load app.js — so
  // window.AuraApp is undefined there. Without this guard, the first
  // `App.routes.login = ...` below throws "Cannot read properties of undefined
  // (reading 'routes')" and aborts the IIFE. The auth routes live on
  // AuraApp.routes and are driven by the app.js router, so there is nothing
  // for this module to wire when AuraApp is absent — bail out cleanly.
  if (typeof window.AuraApp === 'undefined') {
    console.log('[aura-auth] AuraApp not loaded (non-app page) - skipping route registration');
    return;
  }
  const { api, AuraState, orbHTML, icon, toast, confirmModal, bgHTML } = window.Aura;
  const App = window.AuraApp; // { routes, go, ... } defined in app.js
  const root = document.getElementById('app');

  // Per-flow transient state (not persisted).
  const flow = { email: '', resetToken: '', verifyEmail: '' };

  function goto(r) { App.go(r); }

  // Shared screen header (back button + centered overline title).
  function authHeader(title, opts) {
    opts = opts || {};
    const back = opts.onBack === false ? '<div style="width:40px"></div>'
      : `<button class="btn-icon" data-back aria-label="Back">${icon('back', 17)}</button>`;
    return `<header style="display:flex;align-items:center;gap:12px;padding:14px 16px 0">
        ${back}
        <span class="overline" style="flex:1;text-align:center">${title}</span>
        <div style="width:40px;display:flex;justify-content:flex-end">${opts.right || ''}</div>
      </header>`;
  }
  function wireBack(target) {
    const b = root.querySelector('[data-back]');
    if (b) b.onclick = () => goto(target);
  }

  // ---- Orb with a badge chip (key / mail / lock) ----
  function orbWithBadge(size, phase, badge) {
    const b = badge ? `<div class="orb-badge" style="bottom:-4px;right:-4px;width:${badge.size || 36}px;height:${badge.size || 36}px;background:${badge.bg};box-shadow:0 0 16px ${badge.glow || 'rgba(124,58,237,0.55)'},inset 0 1px 0 rgba(255,255,255,0.25)">${icon(badge.ic, badge.icSize || 16)}</div>` : '';
    return `<div style="position:relative;display:inline-block">
        ${orbHTML(size, phase, { intensity: badge && badge.lowIntensity ? 0.6 : 0.75 })}
        ${b}
      </div>`;
  }

  // ---- Eye toggle (returns html + wires behavior via class) ----
  function eyeHTML(visible) {
    return `<button type="button" class="auth-eye ${visible ? 'on' : ''}" data-eye aria-label="Show password">
        ${visible
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="1.5"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 4l16 16" stroke="rgba(255,255,255,0.75)"/></svg>`}
      </button>`;
  }
  // Wire an eye toggle to its sibling input (toggle type, animate icon).
  function wireEye(eyeBtn, input) {
    if (!eyeBtn || !input) return;
    eyeBtn.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eyeBtn.classList.toggle('on', show);
      eyeBtn.innerHTML = show
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="1.5"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 4l16 16" stroke="rgba(255,255,255,0.75)"/></svg>`;
      input.focus();
    };
  }

  // Caps-lock hint for a password field.
  function wireCapsLock(input, hintEl) {
    if (!input || !hintEl) return;
    const check = (e) => {
      const on = e && e.getModifierState ? e.getModifierState('CapsLock') : false;
      hintEl.style.opacity = on ? '1' : '0';
    };
    input.addEventListener('keydown', check);
    input.addEventListener('keyup', check);
    input.addEventListener('blur', () => { hintEl.style.opacity = '0'; });
  }

  // ---- Password strength meter (design token spec) ----
  function passwordScore(pw) {
    if (!pw) return 0;
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, s);
  }
  const PW_LEVELS = [
    { label: 'Weak', color: '#F87171', glow: 'rgba(248,113,113,0.5)' },
    { label: 'Weak', color: '#F87171', glow: 'rgba(248,113,113,0.5)' },
    { label: 'Fair', color: '#F59E0B', glow: 'rgba(245,158,11,0.5)' },
    { label: 'Strong', color: '#22D3EE', glow: 'rgba(34,211,238,0.5)' },
    { label: 'Excellent', color: '#34D399', glow: 'rgba(52,211,153,0.55)' },
  ];
  // Build the strength block markup (meter + level + requirements).
  function strengthHTML(score, requirements, breach) {
    const s = PW_LEVELS[score] || PW_LEVELS[0];
    let html = `<div class="pw-meter">`;
    for (let i = 1; i <= 4; i++) {
      const on = i <= score;
      const bg = on ? (i === score ? `linear-gradient(90deg, ${s.color}, #22D3EE)` : s.color) : 'rgba(255,255,255,0.08)';
      html += `<div class="pw-seg" style="${on ? `background:${bg};box-shadow:0 0 8px ${s.glow}` : ''}"></div>`;
    }
    html += `</div>`;
    if (score > 0) {
      html += `<div class="pw-level"><span class="lbl">Password strength</span><span class="val" style="color:${s.color};text-shadow:0 0 8px ${s.glow}">${s.label}</span></div>`;
    }
    if (breach) {
      html += `<div class="pw-breach">${icon('warn', 12)}<span>This password appears in known breach lists. Try something unique.</span></div>`;
    }
    if (requirements) {
      html += `<div class="pw-req">` + requirements.map((r) => `
        <div class="row" style="color:${r.met ? '#34D399' : 'rgba(255,255,255,0.45)'}">
          <span class="bub" style="${r.met ? 'background:rgba(52,211,153,0.15);border-color:rgba(52,211,153,0.45);box-shadow:0 0 6px rgba(52,211,153,0.35)' : ''}">
            ${r.met ? `<svg width="8" height="8" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 7" stroke="#34D399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
          </span><span>${r.text}</span>
        </div>`).join('') + `</div>`;
    }
    return html;
  }

  // ---- Verification code dots ----
  function codeDotsHTML() {
    return `<div class="code-dots">
        ${[0,1,2,3,4,5].map((i) => `<div class="code-dot" data-dot="${i}"></div>`).join('')}
        <input class="code-input" id="code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" />
      </div>`;
  }
  function paintCodeDots(val) {
    root.querySelectorAll('[data-dot]').forEach((d, i) => {
      d.textContent = val[i] || '';
      d.classList.toggle('filled', !!val[i]);
      d.classList.toggle('active', i === val.length && i < 6);
    });
  }

  // ---- Warning / info cards ----
  const WARN_TONES = {
    warn:   { c: '#F59E0B', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.28)' },
    danger: { c: '#F87171', bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.28)' },
    info:   { c: '#60A5FA', bg: 'rgba(96,165,250,0.06)', border: 'rgba(96,165,250,0.28)' },
    success:{ c: '#34D399', bg: 'rgba(52,211,153,0.06)', border: 'rgba(52,211,153,0.28)' },
  };
  function warnCard(tone, ic, title, body) {
    const t = WARN_TONES[tone] || WARN_TONES.info;
    return `<div class="warn-card" style="background:${t.bg};border:1px solid ${t.border}">
        <div class="ic" style="background:${t.c}15;border:1px solid ${t.c}35;box-shadow:inset 0 0 10px ${t.c}30">${icon(ic, 14, t.c)}</div>
        <div><div class="t">${title}</div><div class="b">${body}</div></div>
      </div>`;
  }

  function stepPips(active) {
    return `<div class="step-pips">` + [0,1,2].map((i) => {
      if (i === active) return `<div class="step-pip active"></div>`;
      if (i < active) return `<div class="step-pip active dim" style="width:6px"></div>`;
      return `<div class="step-pip"></div>`;
    }).join('') + `</div>`;
  }

  // Full-screen toast-less inline error line.
  function inlineError(id, msg) {
    const el = root.querySelector('#' + id);
    if (!el) return;
    el.innerHTML = `<div class="form-error">${msg}</div>`;
  }

  // =====================================================================
  // A01 · LOGIN
  // =====================================================================
  App.routes.login = function () {
    root.innerHTML = `${bgHTML('blue')}
      <section class="screen screen--scroll" style="padding:24px;justify-content:center">
        ${authHeader('Sign in', { onBack: false })}
        <div style="display:flex;justify-content:center;margin:8px 0 18px">${orbHTML(120, 'idle', { intensity: 0.65 })}</div>
        <h1 style="font-size:26px;font-weight:600;text-align:center;letter-spacing:-0.4px;margin-bottom:6px">Welcome back.</h1>
        <p style="font-size:14px;color:var(--text-tertiary);text-align:center;margin-bottom:30px">Continue your practice.</p>
        <form id="auth-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="login-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-email">Email</label>
            <div class="auth-input" id="wrap-email">
              ${icon('mail', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-email" type="email" placeholder="you@example.com" autocomplete="email" value="${flow.email || ''}">
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-pass">Password</label>
            <div class="auth-input" id="wrap-pass">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-pass" type="password" placeholder="Your password" autocomplete="current-password">
              <span id="login-eye">${eyeHTML(false)}</span>
            </div>
            <div class="auth-hint" id="caps-hint" style="opacity:0;justify-content:flex-end;margin-top:-4px">${icon('warn', 10, '#F59E0B')}<span style="color:#F59E0B">CAPS LOCK ON</span></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 22px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <span id="keep-box" style="width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#7C3AED,#22D3EE);display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px rgba(124,58,237,0.5)">${icon('check', 10, '#fff', 2.5)}</span>
              <span style="font-size:12px;color:rgba(255,255,255,0.75)">Keep me signed in</span>
            </label>
            <a href="#forgot" id="forgot-link" style="font-size:12px;color:#22D3EE;font-weight:500">Forgot password?</a>
          </div>
          <button type="submit" class="btn-primary" id="auth-submit">Sign in</button>
          <div style="display:flex;align-items:center;gap:12px;margin:18px 0 6px">
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.08)"></div>
            <span style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:2px;text-transform:uppercase">or</span>
            <div style="flex:1;height:1px;background:rgba(255,255,255,0.08)"></div>
          </div>
          <button type="button" class="btn-ghost" style="margin-top:14px">Continue with Apple</button>
          <div style="text-align:center;font-size:13px;color:rgba(255,255,255,0.55);margin-top:18px">New here? <a href="#signup" style="color:#22D3EE;font-weight:500">Create an account</a></div>
        </form>
      </section>`;
    const emailEl = document.getElementById('f-email');
    const passEl = document.getElementById('f-pass');
    const wrapPass = document.getElementById('wrap-pass');
    wireEye(document.getElementById('login-eye'), passEl);
    wireCapsLock(passEl, document.getElementById('caps-hint'));
    document.getElementById('forgot-link').onclick = (e) => { e.preventDefault(); goto('forgot'); };
    root.querySelector('a[href="#signup"]').onclick = (e) => { e.preventDefault(); goto('signup'); };

    // Live focus styling
    [['f-email', 'wrap-email'], ['f-pass', 'wrap-pass']].forEach(([inp, wrap]) => {
      const i = document.getElementById(inp), w = document.getElementById(wrap);
      i.addEventListener('focus', () => w.classList.add('focus'));
      i.addEventListener('blur', () => { if (!i.value) w.classList.remove('focus'); });
    });

    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = 'Signing in…';
      document.getElementById('login-error').innerHTML = '';
      wrapPass.classList.remove('error');
      try {
        const { data } = await api.post('/auth/login', { email: emailEl.value, password: passEl.value });
        AuraState.setToken(data.token); AuraState.user = data.user;
        if (data.requiresVerification) { flow.verifyEmail = data.user.email; flow.devCode = data.devCode; goto('verify'); return; }
        goto(data.user.onboarded ? 'home' : 'how');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('login-error', msg);
        wrapPass.classList.add('error');
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    };
  };

  // =====================================================================
  // A02 · SIGNUP
  // =====================================================================
  App.routes.signup = function () {
    root.innerHTML = `${bgHTML('purple')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Create account')}
        <div style="display:flex;justify-content:center;margin:6px 0 14px">${orbHTML(100, 'idle', { intensity: 0.75 })}</div>
        <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.4px;text-align:center;margin-bottom:6px">Begin your practice.</h1>
        <p style="font-size:13px;color:var(--text-tertiary);text-align:center;margin-bottom:26px">A few details, then the orb.</p>
        <form id="auth-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="signup-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-name">Name</label>
            <div class="auth-input" id="wrap-name">
              ${icon('mail', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-name" type="text" placeholder="How should we call you?" autocomplete="name">
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-email">Email</label>
            <div class="auth-input" id="wrap-email">
              ${icon('mail', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-email" type="email" placeholder="you@example.com" autocomplete="email" value="${flow.email || ''}">
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-pass">Password</label>
            <div class="auth-input focus" id="wrap-pass">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-pass" type="password" placeholder="At least 8 characters" autocomplete="new-password">
              <span id="signup-eye">${eyeHTML(false)}</span>
            </div>
            <div id="strength-slot"></div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-confirm">Confirm password</label>
            <div class="auth-input" id="wrap-confirm">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-confirm" type="password" placeholder="Re-enter your password" autocomplete="new-password">
              <span id="confirm-eye">${eyeHTML(false)}</span>
            </div>
            <div class="auth-hint" id="confirm-hint" style="opacity:0">${icon('check', 11, '#34D399')}<span style="color:#34D399">Passwords match</span></div>
          </div>
          <div id="terms-row" style="display:flex;align-items:flex-start;gap:10px;margin:6px 0 18px;cursor:pointer">
            <span id="terms-box" style="width:18px;height:18px;border-radius:5px;flex-shrink:0;margin-top:1px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15)"></span>
            <span style="font-size:11px;color:rgba(255,255,255,0.65);line-height:1.5">I agree to the <a href="#signup" style="color:#22D3EE">Terms</a> and <a href="#signup" style="color:#22D3EE">Privacy Policy</a></span>
          </div>
          <button type="submit" class="btn-primary" id="auth-submit">Create account</button>
          <div style="text-align:center;font-size:13px;color:rgba(255,255,255,0.55);margin-top:14px">Already have one? <a href="#login" style="color:#22D3EE;font-weight:500">Sign in</a></div>
        </form>
      </section>`;
    const nameEl = document.getElementById('f-name');
    const emailEl = document.getElementById('f-email');
    const passEl = document.getElementById('f-pass');
    const confirmEl = document.getElementById('f-confirm');
    wireEye(document.getElementById('signup-eye'), passEl);
    wireEye(document.getElementById('confirm-eye'), confirmEl);

    const termsBox = document.getElementById('terms-box');
    const termsRow = document.getElementById('terms-row');
    let terms = false;
    const toggleTerms = () => {
      terms = !terms;
      termsBox.style.background = terms ? 'linear-gradient(135deg,#7C3AED,#22D3EE)' : 'rgba(255,255,255,0.06)';
      termsBox.style.borderColor = terms ? 'transparent' : 'rgba(255,255,255,0.15)';
      termsBox.innerHTML = terms ? icon('check', 10, '#fff', 2.5) : '';
    };
    // Terms acceptance must be reliable: the inline links must neither navigate
    // (a bare #signup href re-renders the screen and resets terms=false, which
    // makes the submit guard swallow the server error) nor bubble up to toggle.
    // The checkbox box and the row both toggle; the links are inert.
    termsBox.onclick = (e) => { e.stopPropagation(); toggleTerms(); };
    termsRow.onclick = (e) => {
      if (e.target.tagName === 'A') { e.preventDefault(); e.stopPropagation(); return; }
      toggleTerms();
    };

    const strengthSlot = document.getElementById('strength-slot');
    function renderStrength() {
      const pw = passEl.value;
      const score = passwordScore(pw);
      let breach = false;
      if (pw && /password|123456|qwerty|letmein/i.test(pw)) breach = true;
      strengthSlot.innerHTML = strengthHTML(score, [
        { met: pw.length >= 8, text: 'At least 8 characters' },
        { met: /[A-Z]/.test(pw) && /[a-z]/.test(pw), text: 'Mix of upper and lower case' },
        { met: /[^A-Za-z0-9]/.test(pw) || pw.length >= 12, text: 'A number or symbol' },
      ], breach);
    }
    function renderConfirm() {
      const wrap = document.getElementById('wrap-confirm');
      const hint = document.getElementById('confirm-hint');
      if (confirmEl.value && confirmEl.value === passEl.value) {
        wrap.classList.add('success'); wrap.classList.remove('error');
        hint.style.opacity = '1';
      } else if (confirmEl.value) {
        wrap.classList.add('error'); wrap.classList.remove('success');
        hint.style.opacity = '0';
      } else { wrap.classList.remove('success', 'error'); hint.style.opacity = '0'; }
    }
    passEl.addEventListener('input', () => { renderStrength(); renderConfirm(); });
    confirmEl.addEventListener('input', renderConfirm);

    document.getElementById('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      if (!terms) { toast('Please accept the Terms to continue.'); return; }
      if (passEl.value.length < 8) { toast('Password must be at least 8 characters.'); return; }
      if (passEl.value !== confirmEl.value) { toast('Passwords do not match.'); return; }
      flow.email = emailEl.value;
      const btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = 'Creating…';
      document.getElementById('signup-error').innerHTML = '';
      try {
        const { data } = await api.post('/auth/signup', { email: emailEl.value, password: passEl.value, name: nameEl.value });
        AuraState.setToken(data.token); AuraState.user = data.user;
        if (data.requiresVerification) { flow.verifyEmail = data.user.email; flow.devCode = data.devCode; goto('verify'); return; }
        goto(data.user.onboarded ? 'home' : 'how');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('signup-error', msg);
        btn.disabled = false; btn.textContent = 'Create account';
      }
    };
    wireBack('login');
  };

  // =====================================================================
  // A03A · FORGOT — enter email
  // =====================================================================
  App.routes.forgot = function () {
    root.innerHTML = `${bgHTML('blue')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Reset password')}
        <div style="display:flex;justify-content:center;margin:18px 0 24px">
          ${orbWithBadge(120, 'idle', { size: 36, bg: 'linear-gradient(135deg,#7C3AED,#22D3EE)', ic: 'key', glow: 'rgba(124,58,237,0.6)' })}
        </div>
        <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.4px;text-align:center;margin-bottom:8px">Forgot your password?</h1>
        <p style="font-size:13px;color:var(--text-tertiary);text-align:center;max-width:300px;margin:0 auto 30px;line-height:1.5">Enter the email tied to your account. We'll send a secure reset link.</p>
        <form id="forgot-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="forgot-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-email">Email</label>
            <div class="auth-input" id="wrap-email">
              ${icon('mail', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-email" type="email" placeholder="you@example.com" autocomplete="email" value="${flow.email || ''}">
            </div>
          </div>
          <button type="submit" class="btn-primary" id="forgot-submit" style="margin-top:8px">Send reset link</button>
          <div style="text-align:center;font-size:13px;color:rgba(255,255,255,0.55);margin-top:16px"><a href="#login" id="back-signin" style="color:#22D3EE;font-weight:500">Back to sign in</a></div>
        </form>
      </section>`;
    const emailEl = document.getElementById('f-email');
    document.getElementById('back-signin').onclick = (e) => { e.preventDefault(); goto('login'); };
    document.getElementById('forgot-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('forgot-submit');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const { data } = await api.post('/auth/forgot', { email: emailEl.value });
        flow.email = emailEl.value;
        if (data.devResetToken) flow.resetToken = data.devResetToken;
        goto('forgotSent');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('forgot-error', msg);
        btn.disabled = false; btn.textContent = 'Send reset link';
      }
    };
    wireBack('login');
  };

  // =====================================================================
  // A03B · FORGOT SENT — calm confirmation
  // =====================================================================
  App.routes.forgotSent = function () {
    const email = flow.email || AuraState.user && AuraState.user.email || 'your email';
    root.innerHTML = `${bgHTML('blue')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Reset password')}
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:40px 0">
          <div style="position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center">
            ${[0,1,2].map((i) => `<div style="position:absolute;width:180px;height:180px;border-radius:50%;border:1px solid rgba(96,165,250,0.30);animation:auraPulseRing 3s ease-out ${i}s infinite"></div>`).join('')}
            ${orbHTML(140, 'idle', { intensity: 0.6 })}
            <div class="orb-badge" style="bottom:30px;right:30px;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,rgba(124,58,237,0.6),rgba(34,211,238,0.6));box-shadow:0 0 20px rgba(124,58,237,0.55),inset 0 1px 0 rgba(255,255,255,0.25)">${icon('mail', 18)}</div>
          </div>
          <div style="text-align:center">
            <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:10px">Check your inbox.</h1>
            <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55">We sent a reset link to<br><span style="color:#fff;font-weight:500">${email}</span></p>
          </div>
        </div>
        <div style="width:100%;max-width:360px;margin:0 auto;display:flex;flex-direction:column;gap:12px">
          <button class="btn-primary" id="open-mail">${icon('mail', 16)} Open mail app</button>
          <div style="text-align:center;font-size:12px;color:rgba(255,255,255,0.5)">Didn't get it? <a href="#" id="resend" style="color:#22D3EE;font-weight:500">Resend in 42s</a></div>
          <div style="text-align:center"><a href="#login" id="back-signin" style="font-size:13px;color:rgba(255,255,255,0.55)">Back to sign in</a></div>
        </div>
      </section>`;
    document.getElementById('open-mail').onclick = () => {
      // In production this opens the mail client. Here we continue with the
      // reset token we surfaced, so the flow is fully traversable.
      goto('reset');
    };
    document.getElementById('back-signin').onclick = (e) => { e.preventDefault(); goto('login'); };
    // Resend countdown
    let secs = 42;
    const resend = document.getElementById('resend');
    const tick = () => {
      if (secs <= 0) {
        resend.textContent = 'Resend now';
        resend.onclick = async (e) => { e.preventDefault(); resend.textContent = 'Sending…'; try { await api.post('/auth/forgot', { email: flow.email }); toast('Reset link sent again.'); } catch {} secs = 42; resend.textContent = `Resend in 42s`; resend.onclick = null; startCountdown(); };
        return;
      }
      resend.textContent = `Resend in ${secs}s`;
      secs--;
      setTimeout(tick, 1000);
    };
    function startCountdown() { tick(); }
    startCountdown();
  };

  // =====================================================================
  // A03C · RESET PASSWORD
  // =====================================================================
  App.routes.reset = function () {
    root.innerHTML = `${bgHTML('purple')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('New password')}
        <div style="display:flex;justify-content:center;margin:6px 0 14px">
          ${orbWithBadge(100, 'idle', { size: 32, bg: 'linear-gradient(135deg,#7C3AED,#22D3EE)', ic: 'key', icSize: 14, glow: 'rgba(124,58,237,0.55)' })}
        </div>
        <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.4px;text-align:center;margin-bottom:6px">Create a new password</h1>
        <p style="font-size:13px;color:var(--text-tertiary);text-align:center;max-width:300px;margin:0 auto 26px;line-height:1.5">Something you'll remember, and no one can guess.</p>
        ${!App.routeParams.token && flow.resetToken ? `<div style="max-width:320px;margin:0 auto 4px;padding:10px 14px;border:1px dashed rgba(34,211,238,0.5);border-radius:12px;background:rgba(34,211,238,0.07);text-align:center"><div style="font-size:11px;letter-spacing:0.4px;text-transform:uppercase;color:rgba(34,211,238,0.85);margin-bottom:4px">Dev reset token (email not configured)</div><div style="font-size:13px;font-weight:600;color:#fff;word-break:break-all;font-variant-numeric:tabular-nums">${flow.resetToken}</div></div>` : ''}
        <form id="reset-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="reset-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-pass">New password</label>
            <div class="auth-input focus" id="wrap-pass">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-pass" type="password" placeholder="At least 8 characters" autocomplete="new-password">
              <span id="reset-eye">${eyeHTML(false)}</span>
            </div>
            <div id="strength-slot"></div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-confirm">Confirm new password</label>
            <div class="auth-input" id="wrap-confirm">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-confirm" type="password" placeholder="Re-enter your password" autocomplete="new-password">
              <span id="confirm-eye">${eyeHTML(false)}</span>
            </div>
            <div class="auth-hint" id="confirm-hint" style="opacity:0">${icon('check', 11, '#34D399')}<span style="color:#34D399">Passwords match</span></div>
          </div>
          <button type="submit" class="btn-primary" id="reset-submit" style="margin-top:10px">Update password</button>
        </form>
      </section>`;
    const passEl = document.getElementById('f-pass');
    const confirmEl = document.getElementById('f-confirm');
    wireEye(document.getElementById('reset-eye'), passEl);
    wireEye(document.getElementById('confirm-eye'), confirmEl);
    const strengthSlot = document.getElementById('strength-slot');
    function renderStrength() {
      const pw = passEl.value;
      const score = passwordScore(pw);
      let breach = /password|123456|qwerty|letmein/i.test(pw);
      strengthSlot.innerHTML = strengthHTML(score, [
        { met: pw.length >= 12, text: 'At least 12 characters' },
        { met: /[A-Z]/.test(pw) && /[a-z]/.test(pw), text: 'Upper and lower case letters' },
        { met: /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw), text: 'Numbers and symbols' },
        { met: !breach && pw.length >= 8, text: 'Not in common password lists' },
      ], breach);
    }
    function renderConfirm() {
      const wrap = document.getElementById('wrap-confirm');
      const hint = document.getElementById('confirm-hint');
      if (confirmEl.value && confirmEl.value === passEl.value) {
        wrap.classList.add('success'); wrap.classList.remove('error'); hint.style.opacity = '1';
      } else if (confirmEl.value) { wrap.classList.add('error'); wrap.classList.remove('success'); hint.style.opacity = '0'; }
      else { wrap.classList.remove('success', 'error'); hint.style.opacity = '0'; }
    }
    passEl.addEventListener('input', () => { renderStrength(); renderConfirm(); });
    confirmEl.addEventListener('input', renderConfirm);
    wireBack('forgot');

    document.getElementById('reset-form').onsubmit = async (e) => {
      e.preventDefault();
      if (passEl.value.length < 8) { toast('Password must be at least 8 characters.'); return; }
      if (passEl.value !== confirmEl.value) { toast('Passwords do not match.'); return; }
      const btn = document.getElementById('reset-submit');
      btn.disabled = true; btn.textContent = 'Updating…';
      try {
        await api.post('/auth/reset', { token: flow.resetToken || (App.routeParams && App.routeParams.token), newPassword: passEl.value });
        // Spec: after reset, return to the Login screen (do not auto-sign-in).
        AuraState.user = null; AuraState.setToken('');
        goto('resetSuccess');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('reset-error', msg);
        btn.disabled = false; btn.textContent = 'Update password';
      }
    };
  };

  // =====================================================================
  // A03D · RESET SUCCESS (auto-signed in)
  // =====================================================================
  App.routes.resetSuccess = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen" style="padding:32px;align-items:center;justify-content:center;text-align:center">
        <div style="position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:28px">
          <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(52,211,153,0.30) 0%,transparent 60%);filter:blur(20px)"></div>
          ${orbHTML(160, 'exhale', { intensity: 0.75 })}
          <div class="orb-badge" style="bottom:26px;right:26px;width:48px;height:48px;background:linear-gradient(135deg,#34D399,#22D3EE);box-shadow:0 0 24px rgba(52,211,153,0.6),inset 0 1px 0 rgba(255,255,255,0.35)">${icon('check', 20)}</div>
        </div>
        <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:10px">Password updated.</h1>
        <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;max-width:280px;margin:0 auto 30px">Your password is updated. Sign in with your new password to continue.</p>
        <button class="btn-primary btn-success-cta" id="continue" style="max-width:340px;margin:0 auto">${icon('arrow', 16)} Continue to sign in</button>
      </section>`;
    document.getElementById('continue').onclick = () => goto('login');
  };

  // =====================================================================
  // A04A · VERIFY EMAIL
  // =====================================================================
  App.routes.verify = function () {
    const email = flow.verifyEmail || (AuraState.user && AuraState.user.email) || 'your email';
    root.innerHTML = `${bgHTML('blue')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Verify email')}
        <div style="display:flex;justify-content:center;margin:12px 0 18px">
          <div style="position:relative;width:220px;height:220px;display:flex;align-items:center;justify-content:center">
            ${[0,1].map((i) => `<div style="position:absolute;width:170px;height:170px;border-radius:50%;border:1px solid rgba(96,165,250,0.28);animation:auraPulseRing 3.4s ease-out ${i * 1.7}s infinite"></div>`).join('')}
            ${orbHTML(140, 'idle', { intensity: 0.7 })}
            <div class="orb-badge" style="bottom:20px;right:20px;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,rgba(96,165,250,0.7),rgba(34,211,238,0.7));box-shadow:0 0 18px rgba(96,165,250,0.55),inset 0 1px 0 rgba(255,255,255,0.25)">${icon('mail', 18)}</div>
          </div>
        </div>
        <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.4px;text-align:center;margin-bottom:8px">Verify your email</h1>
        <p style="font-size:14px;color:var(--text-tertiary);text-align:center;line-height:1.55;max-width:300px;margin:0 auto 20px">We sent a 6-digit code to<br><span style="color:#fff;font-weight:500">${email}</span></p>
        ${flow.devCode ? `<div style="max-width:320px;margin:0 auto 4px;padding:10px 14px;border:1px dashed rgba(34,211,238,0.5);border-radius:12px;background:rgba(34,211,238,0.07);text-align:center"><div style="font-size:11px;letter-spacing:0.4px;text-transform:uppercase;color:rgba(34,211,238,0.85);margin-bottom:4px">Dev code (email not configured)</div><div style="font-size:22px;font-weight:700;letter-spacing:6px;color:#fff;font-variant-numeric:tabular-nums">${flow.devCode}</div></div>` : ''}
        <div id="code-area" style="padding:4px 0 8px">${codeDotsHTML()}</div>
        <div id="verify-error" style="min-height:0"></div>
        <div style="display:flex;flex-direction:column;gap:12px;max-width:340px;margin:18px auto 0">
          <button class="btn-primary" id="verify-btn">Verify</button>
          <div style="text-align:center;font-size:12px;color:rgba(255,255,255,0.5)">Didn't get it? <a href="#" id="resend" style="color:#22D3EE;font-weight:500">Resend code</a></div>
          <div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.4)">Wrong email? <a href="#signup" id="change-email" style="color:rgba(255,255,255,0.65)">Change it</a></div>
        </div>
      </section>`;
    const input = document.getElementById('code-input');
    const verifyBtn = document.getElementById('verify-btn');
    setTimeout(() => input.focus(), 50);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      paintCodeDots(input.value);
      document.getElementById('verify-error').innerHTML = '';
      if (input.value.length === 6) submitCode();
    });
    async function submitCode() {
      verifyBtn.disabled = true;
      try {
        await api.post('/auth/verify/confirm', { email, code: input.value });
        flow.devCode = null;
        goto('verifySuccess');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'That code is not correct.';
        document.getElementById('verify-error').innerHTML = `<div class="form-error">${msg}</div>`;
        input.value = ''; paintCodeDots(''); verifyBtn.disabled = false;
      }
    }
    verifyBtn.onclick = submitCode;
    root.querySelector('#resend').onclick = async (e) => {
      e.preventDefault();
      try { await api.post('/auth/verify/send', { email }); toast('A new code is on its way.'); } catch {}
    };
    root.querySelector('#change-email').onclick = (e) => { e.preventDefault(); goto('signup'); };
    wireBack('login');
  };

  // =====================================================================
  // A04B · VERIFY SUCCESS
  // =====================================================================
  App.routes.verifySuccess = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen" style="padding:32px;align-items:center;justify-content:center;text-align:center">
        <div style="position:relative;width:260px;height:260px;display:flex;align-items:center;justify-content:center;margin-bottom:26px">
          <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(52,211,153,0.28) 0%,transparent 60%);filter:blur(24px)"></div>
          ${orbHTML(180, 'exhale', { intensity: 0.8 })}
          <div class="orb-badge" style="bottom:30px;right:30px;width:54px;height:54px;background:linear-gradient(135deg,#34D399,#22D3EE);box-shadow:0 0 28px rgba(52,211,153,0.6),inset 0 1px 0 rgba(255,255,255,0.35)">${icon('check', 22)}</div>
        </div>
        <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.4px;margin-bottom:10px">You're verified.</h1>
        <p style="font-size:14px;color:var(--text-tertiary);line-height:1.55;max-width:260px;margin:0 auto 30px">Your email is confirmed. Everything's set.</p>
        <button class="btn-primary btn-success-cta" id="continue" style="max-width:340px;margin:0 auto">${icon('arrow', 16)} Continue to AURA</button>
      </section>`;
    document.getElementById('continue').onclick = () => goto(AuraState.user && AuraState.user.onboarded ? 'home' : 'how');
  };

  // =====================================================================
  // M01 · ACCOUNT & SECURITY (settings root)
  // =====================================================================
  App.routes.security = async function () {
    let me;
    try { ({ data: me } = await api.get('/auth/me')); AuraState.user = { ...AuraState.user, ...me.user }; }
    catch (err) { window.Aura.handleApiError(err); return goto('home'); }
    const u = me.user;
    const name = u.name || 'You';
    const email = u.email || 'you@example.com';
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px 20px 40px">
        ${authHeader('Account & security')}
        <div class="glass profile-card" style="margin-bottom:24px">
          <div style="width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,0.6),#A78BFA 45%,#7C3AED 75%,#22D3EE 100%);box-shadow:0 0 18px rgba(167,139,250,0.5),inset -3px -3px 8px rgba(0,0,0,0.35)"></div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:500">${name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);font-family:ui-monospace,Menlo,monospace">${email}</div>
          </div>
          <div class="verified-pill">Verified</div>
        </div>

        <div class="overline" style="padding:0 10px 10px">Password</div>
        <div class="glass" style="overflow:hidden;margin-bottom:20px">
          <div class="sec-row" data-go="changePassword">
            <div class="sec-ic">${icon('lock', 16)}</div>
            <div><div class="sec-label">Change password</div><div class="sec-detail">Update your sign-in password</div></div>
            <div style="color:rgba(255,255,255,0.4)">${icon('arrow', 14)}</div>
          </div>
          <div class="sec-row" data-go="signOutAll" style="border-bottom:none">
            <div class="sec-ic">${icon('device', 16)}</div>
            <div><div class="sec-label">Sign out of all devices</div><div class="sec-detail">End sessions on other devices</div></div>
            <div style="color:rgba(255,255,255,0.4)">${icon('arrow', 14)}</div>
          </div>
        </div>

        <div class="overline" style="padding:0 10px 10px">Your data</div>
        <div class="glass" style="overflow:hidden;margin-bottom:20px">
          <div class="sec-row" data-go="exportData">
            <div class="sec-ic">${icon('download', 16)}</div>
            <div><div class="sec-label">Export my data</div><div class="sec-detail">Sessions, biometrics, preferences</div></div>
            <div style="color:rgba(255,255,255,0.4)">${icon('arrow', 14)}</div>
          </div>
          <div class="sec-row" data-go="dataPrivacy" style="border-bottom:none">
            <div class="sec-ic">${icon('info', 16)}</div>
            <div><div class="sec-label">Data & privacy</div><div class="sec-detail">What we store and why</div></div>
            <div style="color:rgba(255,255,255,0.4)">${icon('arrow', 14)}</div>
          </div>
        </div>

        <div class="overline" style="padding:0 10px 10px">Account</div>
        <div class="glass" style="overflow:hidden">
          <div class="sec-row" data-go="deleteWarn" style="border-bottom:none">
            <div class="sec-ic" style="background:rgba(248,113,113,0.10);border-color:rgba(248,113,113,0.28);box-shadow:inset 0 0 12px rgba(248,113,113,0.20)">${icon('trash', 16, '#F87171')}</div>
            <div><div class="sec-label sec-danger">Delete account</div><div class="sec-detail">Permanently remove your data</div></div>
            <div style="color:rgba(255,255,255,0.4)">${icon('arrow', 14)}</div>
          </div>
        </div>
      </section>`;
    root.querySelectorAll('[data-go]').forEach((r) => { r.onclick = () => goto(r.dataset.go); });
    wireBack('home');
  };

  // Placeholder for data & privacy (kept minimal, no dead end).
  App.routes.dataPrivacy = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px 20px 40px">
        ${authHeader('Data & privacy')}
        <div style="margin-top:20px">
          ${warnCard('info', 'info', 'What we store', 'AURA keeps your session history, biometrics, preferences and the goals you set so your practice improves over time. Passwords are hashed with PBKDF2 and never stored in plain text.')}
          <div style="height:14px"></div>
          ${warnCard('info', 'shield', 'Your control', 'You can export a copy of everything at any time, sign out of every device, or delete your account permanently. We never sell your data.')}
        </div>
        <button class="btn-ghost" id="back" style="margin-top:24px">Back</button>
      </section>`;
    document.getElementById('back').onclick = () => goto('security');
    wireBack('security');
  };

  // =====================================================================
  // M02 · CHANGE PASSWORD
  // =====================================================================
  App.routes.changePassword = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Change password')}
        <div style="display:flex;justify-content:center;margin:6px 0 14px">
          <div style="position:relative">
            ${orbHTML(100, 'idle', { intensity: 0.65 })}
            <div class="orb-badge" style="bottom:-2px;right:-2px;width:30px;height:30px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);box-shadow:none">${icon('lock', 13)}</div>
          </div>
        </div>
        <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.3px;text-align:center;margin-bottom:6px">Change your password</h1>
        <p style="font-size:13px;color:var(--text-tertiary);text-align:center;margin-bottom:26px">Enter your current password, then set a new one.</p>
        <form id="cp-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="cp-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-current">Current password</label>
            <div class="auth-input" id="wrap-current">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-current" type="password" placeholder="Your current password" autocomplete="current-password">
              <span id="cur-eye">${eyeHTML(false)}</span>
            </div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-pass">New password</label>
            <div class="auth-input focus" id="wrap-pass">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-pass" type="password" placeholder="At least 8 characters" autocomplete="new-password">
              <span id="pass-eye">${eyeHTML(true)}</span>
            </div>
            <div id="strength-slot"></div>
          </div>
          <div class="auth-field">
            <label class="auth-label" for="f-confirm">Confirm new password</label>
            <div class="auth-input" id="wrap-confirm">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-confirm" type="password" placeholder="Re-enter your password" autocomplete="new-password">
              <span id="confirm-eye">${eyeHTML(false)}</span>
            </div>
            <div class="auth-hint" id="confirm-hint" style="opacity:0">${icon('check', 11, '#34D399')}<span style="color:#34D399">Passwords match</span></div>
          </div>
          <div style="margin:6px 0 18px">${warnCard('info', 'device', 'Signs out other devices', "For your safety, we'll sign you out everywhere else. Your current device stays signed in.")}</div>
          <button type="submit" class="btn-primary" id="cp-submit">Update password</button>
          <button type="button" class="btn-ghost" id="cp-cancel" style="margin-top:10px">Cancel</button>
        </form>
      </section>`;
    const curEl = document.getElementById('f-current');
    const passEl = document.getElementById('f-pass');
    const confirmEl = document.getElementById('f-confirm');
    wireEye(document.getElementById('cur-eye'), curEl);
    wireEye(document.getElementById('pass-eye'), passEl);
    wireEye(document.getElementById('confirm-eye'), confirmEl);
    const strengthSlot = document.getElementById('strength-slot');
    function renderStrength() {
      const pw = passEl.value; const score = passwordScore(pw);
      const breach = /password|123456|qwerty|letmein/i.test(pw);
      strengthSlot.innerHTML = strengthHTML(score, [
        { met: pw.length >= 8, text: 'At least 8 characters' },
        { met: /[A-Z]/.test(pw) && /[a-z]/.test(pw), text: 'Letters and numbers' },
        { met: pw !== curEl.value && pw.length >= 8, text: 'Different from your current password' },
      ], breach);
    }
    function renderConfirm() {
      const wrap = document.getElementById('wrap-confirm'); const hint = document.getElementById('confirm-hint');
      if (confirmEl.value && confirmEl.value === passEl.value) { wrap.classList.add('success'); wrap.classList.remove('error'); hint.style.opacity = '1'; }
      else if (confirmEl.value) { wrap.classList.add('error'); wrap.classList.remove('success'); hint.style.opacity = '0'; }
      else { wrap.classList.remove('success', 'error'); hint.style.opacity = '0'; }
    }
    passEl.addEventListener('input', () => { renderStrength(); renderConfirm(); });
    confirmEl.addEventListener('input', renderConfirm);
    document.getElementById('cp-cancel').onclick = () => goto('security');
    document.getElementById('cp-form').onsubmit = async (e) => {
      e.preventDefault();
      if (passEl.value.length < 8) { toast('New password must be at least 8 characters.'); return; }
      if (passEl.value !== confirmEl.value) { toast('Passwords do not match.'); return; }
      const btn = document.getElementById('cp-submit');
      btn.disabled = true; btn.textContent = 'Updating…';
      try {
        await api.post('/account/password', { currentPassword: curEl.value, newPassword: passEl.value });
        toast('Password updated. You stayed signed in.');
        goto('security');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('cp-error', msg);
        btn.disabled = false; btn.textContent = 'Update password';
      }
    };
    wireBack('security');
  };

  // =====================================================================
  // M03 · SIGN OUT EVERYWHERE (bottom sheet)
  // =====================================================================
  App.routes.signOutAll = async function () {
    let devices;
    try { ({ data: devices } = await api.get('/account/sessions')); }
    catch (err) { window.Aura.handleApiError(err); return goto('security'); }
    const list = (devices.sessions || []);
    const total = list.length;
    const others = list.filter((d) => !d.isCurrent).length;
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px 20px 40px;opacity:0.35;filter:blur(2px)">
        ${authHeader('Account & security')}
        <div class="glass profile-card" style="margin-top:20px"><div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.1)"></div><div style="flex:1;height:14px;background:rgba(255,255,255,0.08);border-radius:8px"></div></div>
        <div class="glass" style="margin-top:16px;height:120px"></div>
      </section>
      <div class="modal-veil" id="so-veil" style="align-items:center">
        <div class="sheet" style="max-width:480px">
          <div class="sheet-grabber"></div>
          <div style="display:flex;justify-content:center;margin-bottom:18px">
            <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,rgba(167,139,250,0.30),rgba(96,165,250,0.20));border:1px solid rgba(167,139,250,0.35);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 20px rgba(167,139,250,0.30),0 0 30px rgba(167,139,250,0.25)">${icon('device', 26, '#A78BFA')}</div>
          </div>
          <h3 style="font-size:22px;font-weight:500;letter-spacing:-0.3px;text-align:center;margin-bottom:8px">Sign out everywhere?</h3>
          <p style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;max-width:300px;margin:0 auto 18px;line-height:1.5">You'll be signed out on ${others} ${others === 1 ? 'device' : 'devices'}. You can sign back in any time.</p>
          <div class="dev-list">
            ${list.map((d) => `
              <div class="dev-row">
                ${icon('device', 14, d.isCurrent ? '#34D399' : 'rgba(255,255,255,0.55)')}
                <div style="flex:1"><div style="font-size:12px;font-weight:500">${d.device}</div><div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:1px">${d.location || (d.isCurrent ? 'This device' : 'Other device')}</div></div>
                ${d.isCurrent ? '<div class="pill-kept">Kept</div>' : ''}
              </div>`).join('') || '<div class="dev-row"><div style="font-size:12px;color:rgba(255,255,255,0.5)">No other devices</div></div>'}
          </div>
          <button class="btn-primary" id="so-confirm">Sign out other devices</button>
          <button class="btn-ghost" id="so-cancel" style="margin-top:10px">Cancel</button>
        </div>
      </div>`;
    const veil = document.getElementById('so-veil');
    function close() { veil.remove(); goto('security'); }
    document.getElementById('so-cancel').onclick = close;
    veil.onclick = (e) => { if (e.target === veil) close(); };
    document.getElementById('so-confirm').onclick = async () => {
      const btn = document.getElementById('so-confirm');
      btn.disabled = true; btn.textContent = 'Signing out…';
      try {
        const { data } = await api.post('/account/sign-out-others', {});
        toast(`Signed out of ${(data.removed ?? others)} ${others === 1 ? 'device' : 'devices'}.`);
      } catch (err) { window.Aura.handleApiError(err); }
      // Spec: sign out EVERYWHERE (incl. current) → redirect to login.
      try { await api.post('/auth/logout', {}); } catch { /* best effort */ }
      AuraState.user = null; AuraState.setToken('');
      goto('login');
    };
  };

  // =====================================================================
  // M04 · EXPORT DATA
  // =====================================================================
  App.routes.exportData = function () {
    const email = (AuraState.user && AuraState.user.email) || 'your email';
    root.innerHTML = `${bgHTML('blue')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Export data')}
        <div style="display:flex;justify-content:center;margin:6px 0 14px">
          <div style="position:relative">
            ${orbHTML(120, 'idle', { intensity: 0.7 })}
            <div class="orb-badge" style="bottom:-4px;right:-4px;width:40px;height:40px;background:linear-gradient(135deg,#22D3EE,#60A5FA);box-shadow:0 0 18px rgba(34,211,238,0.55)">${icon('download', 16)}</div>
          </div>
        </div>
        <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.4px;text-align:center;margin-bottom:6px">Export your data</h1>
        <p style="font-size:13px;color:var(--text-tertiary);text-align:center;max-width:300px;margin:0 auto 24px;line-height:1.5">We'll email you a secure download link within 24 hours.</p>
        <div class="glass" style="padding:16px 18px;margin-bottom:18px">
          <div class="overline" style="margin-bottom:12px">What's included</div>
          ${[
            { i: 'wind', l: 'Session history', s: 'Every breath you have taken' },
            { i: 'heart', l: 'Biometrics', s: 'Heart rate, HRV, stress scores' },
            { i: 'settings', l: 'Preferences', s: 'Goals, patterns, ambience' },
            { i: 'stats', l: 'Insights', s: 'All analytics we have computed' },
          ].map((r) => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0">
              <div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center">${icon(r.i, 13, 'rgba(255,255,255,0.75)')}</div>
              <div style="flex:1"><div style="font-size:13px;font-weight:500">${r.l}</div><div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:1px">${r.s}</div></div>
            </div>`).join('')}
        </div>
        ${warnCard('info', 'mail', "We'll email", `Your data will be sent to ${email}. The download link expires in 7 days.`)}
        <div style="flex:1"></div>
        <button class="btn-primary" id="export-btn" style="margin-top:18px">${icon('download', 16)} Request export</button>
        <button class="btn-ghost" id="export-cancel" style="margin-top:10px">Cancel</button>
      </section>`;
    document.getElementById('export-cancel').onclick = () => goto('security');
    document.getElementById('export-btn').onclick = async () => {
      const btn = document.getElementById('export-btn');
      btn.disabled = true; btn.textContent = 'Requesting…';
      try {
        await api.post('/account/export', {});
        toast('Check your email. Your export is on its way.');
        goto('security');
      } catch (err) {
        window.Aura.handleApiError(err);
        btn.disabled = false; btn.textContent = 'Request export';
      }
    };
    wireBack('security');
  };

  // =====================================================================
  // M05 · DELETE ACCOUNT — step 1 (warning)
  // =====================================================================
  App.routes.deleteWarn = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Delete account')}
        <div style="display:flex;justify-content:center;padding:14px 0 6px">${stepPips(0)}</div>
        <div style="display:flex;justify-content:center;margin:14px 0 18px">
          <div style="position:relative">
            ${orbHTML(100, 'idle', { intensity: 0.5, showAura: false })}
            <div style="position:absolute;inset:0;filter:grayscale(0.3) brightness(0.85);border-radius:50%"></div>
          </div>
        </div>
        <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.3px;text-align:center;margin-bottom:8px">Before you go</h1>
        <p style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;max-width:300px;margin:0 auto 22px;line-height:1.55">Deleting your account is permanent. Take a breath. Here's what happens next.</p>
        <div class="glass" style="padding:16px 18px;margin-bottom:16px">
          ${[
            { c: '#F87171', l: 'All session history removed', s: 'Every breath, erased for good' },
            { c: '#F87171', l: 'Biometric data erased', s: 'Heart rate, stress, HRV records' },
            { c: '#F87171', l: 'Personalization gone', s: 'Learned patterns cannot be restored' },
            { c: '#A78BFA', l: 'Subscription cancelled', s: 'Your plan ends immediately' },
          ].map((r) => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0">
              <div style="margin-top:5px;width:6px;height:6px;border-radius:3px;background:${r.c};box-shadow:0 0 6px ${r.c};flex-shrink:0"></div>
              <div><div style="font-size:13px;font-weight:500">${r.l}</div><div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px">${r.s}</div></div>
            </div>`).join('')}
        </div>
        ${warnCard('info', 'download', 'Want to keep your data?', "Export a copy first. We'll email you a full archive.")}
        <div style="flex:1"></div>
        <button class="btn-primary" id="keep" style="margin-top:16px">Keep my account</button>
        <button class="btn-ghost danger" id="continue" style="margin-top:10px">Continue deleting</button>
      </section>`;
    document.getElementById('keep').onclick = () => goto('security');
    document.getElementById('continue').onclick = () => goto('deleteConfirm');
    wireBack('security');
  };

  // =====================================================================
  // M06 · DELETE ACCOUNT — step 2 (confirm password)
  // =====================================================================
  App.routes.deleteConfirm = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Delete account')}
        <div style="display:flex;justify-content:center;padding:14px 0 6px">${stepPips(1)}</div>
        <div style="display:flex;justify-content:center;margin:14px 0 18px">
          <div style="width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,rgba(248,113,113,0.20),rgba(167,139,250,0.15));border:1px solid rgba(248,113,113,0.30);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 20px rgba(248,113,113,0.25),0 0 24px rgba(248,113,113,0.20)">${icon('lock', 26, '#F87171')}</div>
        </div>
        <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.3px;text-align:center;margin-bottom:8px">Confirm it's you</h1>
        <p style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;max-width:300px;margin:0 auto 24px;line-height:1.55">Enter your password to continue. Then we'll ask one more time.</p>
        <form id="dc-form" style="max-width:360px;width:100%;margin:0 auto">
          <div id="dc-error"></div>
          <div class="auth-field">
            <label class="auth-label" for="f-pass">Password</label>
            <div class="auth-input focus" id="wrap-pass">
              ${icon('lock', 16, 'rgba(255,255,255,0.5)')}
              <input id="f-pass" type="password" placeholder="Your password" autocomplete="current-password">
              <span id="dc-eye">${eyeHTML(false)}</span>
            </div>
          </div>
          <label style="display:flex;align-items:flex-start;gap:10px;margin:6px 0 18px;cursor:pointer">
            <span id="exp-box" style="width:18px;height:18px;border-radius:5px;flex-shrink:0;margin-top:1px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15)"></span>
            <span style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5">I've exported my data (or don't need it).</span>
          </label>
          <button type="submit" class="btn-danger" id="dc-submit" style="border:none;color:#fff;font-size:15px;font-weight:600;width:100%;padding:16px 24px;border-radius:9999px">Continue</button>
          <button type="button" class="btn-ghost" id="dc-cancel" style="margin-top:10px">Cancel, keep my account</button>
        </form>
      </section>`;
    const passEl = document.getElementById('f-pass');
    wireEye(document.getElementById('dc-eye'), passEl);
    const expBox = document.getElementById('exp-box');
    let exp = false;
    expBox.onclick = () => { exp = !exp; expBox.style.background = exp ? 'linear-gradient(135deg,#7C3AED,#22D3EE)' : 'rgba(255,255,255,0.06)'; expBox.style.borderColor = exp ? 'transparent' : 'rgba(255,255,255,0.15)'; expBox.innerHTML = exp ? icon('check', 10, '#fff', 2.5) : ''; };
    document.getElementById('dc-cancel').onclick = () => goto('security');
    document.getElementById('dc-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('dc-submit');
      btn.disabled = true; btn.textContent = 'Checking…';
      try {
        await api.post('/account/delete/verify', { password: passEl.value });
        goto('deleteFinal');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        inlineError('dc-error', msg);
        btn.disabled = false; btn.textContent = 'Continue';
      }
    };
    wireBack('deleteWarn');
  };

  // =====================================================================
  // M07 · DELETE ACCOUNT — step 3 (type-to-confirm)
  // =====================================================================
  App.routes.deleteFinal = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen screen--scroll" style="padding:24px">
        ${authHeader('Delete account')}
        <div style="display:flex;justify-content:center;padding:14px 0 6px">${stepPips(2)}</div>
        <div style="display:flex;justify-content:center;margin:14px 0 18px">
          <div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,rgba(248,113,113,0.28),rgba(167,139,250,0.15));border:1px solid rgba(248,113,113,0.35);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 24px rgba(248,113,113,0.30),0 0 30px rgba(248,113,113,0.25)">${icon('trash', 28, '#F87171')}</div>
        </div>
        <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.3px;text-align:center;margin-bottom:8px">One last check</h1>
        <p style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center;max-width:300px;margin:0 auto 22px;line-height:1.55">This can't be undone. Type <span style="color:#F87171;font-family:ui-monospace,Menlo,monospace">DELETE</span> to confirm.</p>
        <div class="auth-field" style="max-width:360px;margin:0 auto;width:100%">
          <label class="auth-label" for="f-confirm">Confirmation</label>
          <div class="auth-input error" id="wrap-confirm">
            <input id="f-confirm" type="text" value="DELETE" autocomplete="off" style="letter-spacing:2px">
          </div>
          <div class="auth-hint" style="opacity:1">Type DELETE exactly to enable the button below.</div>
        </div>
        <div style="flex:1"></div>
        <button class="btn-danger" id="delete-btn" style="border:none;color:#fff;font-size:15px;font-weight:600;width:100%;max-width:360px;margin:16px auto 0;padding:16px 24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;gap:8px" disabled>${icon('trash', 14)} Permanently delete account</button>
        <button class="btn-ghost" id="cancel" style="max-width:360px;margin:10px auto 0">Cancel</button>
      </section>`;
    const inputEl = document.getElementById('f-confirm');
    const delBtn = document.getElementById('delete-btn');
    const wrap = document.getElementById('wrap-confirm');
    function evalInput() {
      const ok = inputEl.value === 'DELETE';
      delBtn.disabled = !ok;
      wrap.classList.toggle('error', !ok);
      wrap.classList.toggle('success', ok);
    }
    inputEl.addEventListener('input', evalInput);
    document.getElementById('cancel').onclick = () => goto('security');
    delBtn.onclick = async () => {
      if (inputEl.value !== 'DELETE') return;
      delBtn.disabled = true; delBtn.textContent = 'Deleting…';
      try {
        await api.post('/account/delete/confirm', { confirmText: 'DELETE' });
        AuraState.clear();
        goto('deleteSuccess');
      } catch (err) {
        const msg = (err.response && err.response.data && err.response.data.error) || 'Something went wrong.';
        toast(msg);
        delBtn.disabled = false; delBtn.innerHTML = `${icon('trash', 14)} Permanently delete account`;
      }
    };
    wireBack('deleteConfirm');
  };

  // =====================================================================
  // M08 · DELETE SUCCESS (farewell)
  // =====================================================================
  App.routes.deleteSuccess = function () {
    root.innerHTML = `${bgHTML('deep')}
      <section class="screen" style="padding:32px;align-items:center;justify-content:center;text-align:center">
        <div style="position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:26px">
          <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(148,163,184,0.20) 0%,transparent 60%);filter:blur(20px)"></div>
          <div class="orb-farewell">${orbHTML(160, 'idle', { intensity: 0.4, showAura: false })}</div>
        </div>
        <h1 style="font-size:26px;font-weight:400;letter-spacing:-0.4px;margin-bottom:12px">Farewell.</h1>
        <p style="font-size:14px;color:rgba(255,255,255,0.55);line-height:1.55;max-width:300px;margin:0 auto 30px">Your account and all data have been erased. If you ever want to come back, the orb will be here.</p>
        <button class="btn-ghost" id="close-app" style="max-width:340px;margin:0 auto">Close app</button>
      </section>`;
    document.getElementById('close-app').onclick = () => { AuraState.clear(); goto('welcome'); };
  };

  console.log('[aura-auth] Authentication & Account security routes registered');
})();
