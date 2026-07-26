/* AURA Admin — Super Command Centre */
(function () {
  const { api, AuraState, icon, toast, confirmModal, Theme } = window.Aura;
  const root = document.getElementById('app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let me = null;

  async function guard() {
    const token = localStorage.getItem('aura_token');
    if (!token) { location.href = '/#/login'; return false; }
    try {
      const { data } = await api.get('/auth/me');
      if (data.user.role !== 'admin') {
        toast('Admin access required', 'warn');
        setTimeout(() => (location.href = '/'), 800);
        return false;
      }
      me = data.user;
      AuraState.user = data.user;
      return true;
    } catch (e) {
      location.href = '/#/login';
      return false;
    }
  }

  const NAV = [
    { id: 'dashboard', label: 'Overview', ic: 'home' },
    { id: 'users', label: 'Users', ic: 'users' },
    { id: 'analytics', label: 'Analytics', ic: 'stats' },
    { id: 'content', label: 'Programs', ic: 'lotus' },
    { id: 'audit', label: 'Audit log', ic: 'shield' },
  ];
  const TITLES = { dashboard: 'Overview', users: 'Users', analytics: 'Analytics', content: 'Programs', audit: 'Audit log' };

  function currentView() {
    const h = location.hash.replace(/^#\/?/, '');
    return NAV.some(n => n.id === h) ? h : 'dashboard';
  }

  /* ================= format helpers ================= */
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s + (s.includes('T') || s.includes('Z') ? '' : 'Z'));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function money(cents, cur) {
    const n = (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return cur === 'NGN' ? `₦${n}` : `$${n}`;
  }
  function revenueStr(r) {
    if (!r) return '$0';
    const parts = [];
    if (r.usd_cents) parts.push(money(r.usd_cents, 'USD'));
    if (r.ngn_kobo) parts.push(money(r.ngn_kobo, 'NGN'));
    return parts.join(' + ') || '$0';
  }
  function initials(nameOrEmail) {
    const s = String(nameOrEmail || '?').trim();
    const parts = s.split(/[\s._@-]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function avatarHTML(nameOrEmail, size) {
    const sz = size || 30;
    return `<span class="scc-avatar" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.36)}px">${esc(initials(nameOrEmail))}</span>`;
  }
  function errBox(e) {
    const msg = e?.response?.data?.error || e.message || 'Something drifted off course';
    return `<div class="scc-card scc-err"><p>${esc(msg)}</p></div>`;
  }
  const spinner = `<div class="scc-loading"><div class="scc-loading-orb"></div><p>Syncing telemetry…</p></div>`;

  /* ================= SVG chart helpers (per admin_kit handoff) ================= */
  let gid = 0;
  const ACCENT_V = '#8B5CF6', ACCENT_C = '#22D3EE', GOOD = '#34D399', WARN = '#F59E0B', BAD = '#F87171', SLATE = '#64748B';

  function smoothPath(pts) {
    if (!pts.length) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return d;
  }
  function toPts(data, w, h, pad) {
    const p = pad == null ? 4 : pad;
    const max = Math.max(1, ...data), min = Math.min(0, ...data);
    const span = max - min || 1;
    return data.map((v, i) => [
      p + (i / Math.max(1, data.length - 1)) * (w - p * 2),
      h - p - ((v - min) / span) * (h - p * 2),
    ].map(n => Math.round(n * 10) / 10));
  }

  function miniSpark(data, w, h, color) {
    if (!data || data.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const id = 'sg' + (++gid);
    const pts = toPts(data, w, h);
    const line = smoothPath(pts);
    const area = `${line} L ${pts[pts.length - 1][0]} ${h} L ${pts[0][0]} ${h} Z`;
    const c = color || ACCENT_V;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${c}" stop-opacity="0.28"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" stroke="${c}" stroke-width="1.6" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${c}66)"/>
    </svg>`;
  }

  function lineChart(seriesA, seriesB, w, h, labels) {
    const id = 'lg' + (++gid);
    const pad = 10;
    const grid = [0.25, 0.5, 0.75].map(f =>
      `<line x1="${pad}" y1="${Math.round(h * f)}" x2="${w - pad}" y2="${Math.round(h * f)}" stroke="currentColor" stroke-opacity="0.07"/>`).join('');
    function series(data, color, withArea) {
      if (!data || data.length < 2) return '';
      const pts = toPts(data, w, h, pad);
      const line = smoothPath(pts);
      const dots = pts.map(([x, y], i) => i === pts.length - 1
        ? `<circle cx="${x}" cy="${y}" r="3.4" fill="${color}" style="filter:drop-shadow(0 0 6px ${color})"/>` : '').join('');
      const area = withArea ? `<path d="${line} L ${pts[pts.length - 1][0]} ${h - pad} L ${pts[0][0]} ${h - pad} Z" fill="url(#${id})"/>` : '';
      return `${area}<path d="${line}" stroke="${color}" stroke-width="2" stroke-linecap="round" fill="none" style="filter:drop-shadow(0 0 5px ${color}55)"/>${dots}`;
    }
    const lab = (labels && labels.length)
      ? `<div class="scc-chart-x">${labels.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : '';
    return `<div><svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" aria-hidden="true" style="display:block">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${ACCENT_V}" stop-opacity="0.22"/><stop offset="100%" stop-color="${ACCENT_V}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}${series(seriesA, ACCENT_V, true)}${seriesB ? series(seriesB, ACCENT_C, false) : ''}
    </svg>${lab}</div>`;
  }

  function donut(segments, size, centerLabel, centerSub) {
    const sz = size || 150, sw = 14, r = (sz - sw) / 2, C = 2 * Math.PI * r;
    const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
    let off = 0;
    const arcs = segments.filter(s => s.value > 0).map(s => {
      const len = (s.value / total) * C;
      const el = `<circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="${s.color}" stroke-width="${sw}" fill="none"
        stroke-dasharray="${len - 2} ${C - len + 2}" stroke-dashoffset="${-off}" stroke-linecap="round"
        style="filter:drop-shadow(0 0 5px ${s.color}44)"/>`;
      off += len;
      return el;
    }).join('');
    return `<div style="position:relative;width:${sz}px;height:${sz}px;margin:0 auto">
      <svg width="${sz}" height="${sz}" style="transform:rotate(-90deg)" aria-hidden="true">
        <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" stroke="currentColor" stroke-opacity="0.07" stroke-width="${sw}" fill="none"/>
        ${arcs}
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span class="scc-mono" style="font-size:22px;font-weight:600;color:var(--adm-text)">${esc(centerLabel)}</span>
        <span style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--adm-text-3)">${esc(centerSub || '')}</span>
      </div>
    </div>`;
  }

  function meter(label, value, max, right, color) {
    const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
    const c = color || ACCENT_V;
    return `<div class="scc-meter">
      <div class="scc-meter-top"><span>${esc(label)}</span><span class="scc-mono">${esc(right != null ? right : value)}</span></div>
      <div class="scc-meter-track"><div class="scc-meter-fill" style="width:${pct}%;background:linear-gradient(90deg,${c},${ACCENT_C})"></div></div>
    </div>`;
  }

  function tag(text, color) {
    const c = color || SLATE;
    return `<span class="scc-tag" style="background:${c}18;border-color:${c}40;color:${c}">${esc(text)}</span>`;
  }
  function roleTag(r) { return tag(r, r === 'admin' ? ACCENT_V : SLATE); }
  function planTag(p) { return tag(p || 'free', p === 'premium' ? ACCENT_C : p === 'pro' ? ACCENT_V : SLATE); }
  function statusTag(s) { return tag(s, s === 'active' ? GOOD : s === 'suspended' ? WARN : SLATE); }
  function dot(color, pulse) { return `<span class="scc-dot ${pulse ? 'scc-dot--pulse' : ''}" style="background:${color};color:${color}"></span>`; }

  function kpi(label, value, unit, delta, dir, sparkData, sparkColor) {
    const dcls = dir === 'up' ? 'scc-delta--up' : dir === 'down' ? 'scc-delta--down' : 'scc-delta--flat';
    const darrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    return `<div class="scc-card scc-kpi">
      <div class="scc-kpi-label">${esc(label)}</div>
      <div class="scc-kpi-row">
        <span class="scc-kpi-val scc-mono">${value}${unit ? `<span class="scc-kpi-unit">${esc(unit)}</span>` : ''}</span>
        ${delta != null ? `<span class="scc-delta ${dcls}">${darrow} ${esc(delta)}</span>` : ''}
      </div>
      ${sparkData ? `<div class="scc-kpi-spark">${miniSpark(sparkData, 150, 34, sparkColor)}</div>` : ''}
    </div>`;
  }

  function cardHead(title, sub, right) {
    return `<div class="scc-card-head">
      <div><div class="scc-card-title">${esc(title)}</div>${sub ? `<div class="scc-card-sub">${esc(sub)}</div>` : ''}</div>
      ${right || ''}
    </div>`;
  }

  /* ================= shell layout ================= */
  function layout(view, content) {
    root.innerHTML = `
      <div class="scc-bg" aria-hidden="true"></div>
      <div class="scc">
        <aside class="scc-side">
          <div class="scc-brand">
            <div class="scc-mark"></div>
            <div>
              <div class="scc-brand-name">AURA <span class="scc-ver">SCC</span></div>
              <div class="scc-brand-sub">Super Command Centre</div>
            </div>
          </div>
          <nav class="scc-nav">
            ${NAV.map(n => `
              <a href="#/${n.id}" class="scc-nav-item ${view === n.id ? 'scc-nav-item--on' : ''}" title="${esc(n.label)}">
                ${icon(n.ic, 17)}<span>${n.label}</span>
                ${n.id === 'dashboard' ? `<span class="scc-nav-live">${dot(GOOD, true)}</span>` : ''}
              </a>`).join('')}
          </nav>
          <div class="scc-side-foot">
            <a href="/" class="scc-nav-item" title="Back to app">${icon('back', 17)}<span>Back to app</span></a>
            <button class="scc-nav-item" id="scc-logout" title="Log out">${icon('logout', 17)}<span>Log out</span></button>
            <div class="scc-me">
              ${avatarHTML(me?.display_name || me?.email, 30)}
              <div>
                <div class="scc-me-name">${esc(me?.display_name || 'Admin')}</div>
                <div class="scc-me-sub">${esc(me?.email || '')}</div>
              </div>
            </div>
          </div>
        </aside>
        <main class="scc-main">
          <header class="scc-top">
            <div>
              <div class="scc-crumbs">Admin / ${esc(TITLES[view])}</div>
              <div class="scc-title">${esc(TITLES[view])}</div>
            </div>
            <div class="scc-top-right">
              <span class="scc-env">${dot(GOOD, true)} Prod</span>
              <button class="scc-btn" id="scc-theme" title="Toggle theme">${icon(Theme.mode === 'light' ? 'moon' : 'spark', 15)}<span>${Theme.mode === 'light' ? 'Dark' : 'Light'}</span></button>
              ${avatarHTML(me?.display_name || me?.email, 32)}
            </div>
          </header>
          <div class="scc-body">${content}</div>
        </main>
      </div>`;

    const lo = document.getElementById('scc-logout');
    if (lo) lo.onclick = async () => {
      try { await api.post('/auth/logout'); } catch (e) {}
      localStorage.removeItem('aura_token'); localStorage.removeItem('aura_user');
      location.href = '/#/welcome';
    };
    const th = document.getElementById('scc-theme');
    if (th) th.onclick = () => {
      Theme.set(Theme.mode === 'light' ? 'dark' : 'light', true);
      th.innerHTML = `${icon(Theme.mode === 'light' ? 'moon' : 'spark', 15)}<span>${Theme.mode === 'light' ? 'Dark' : 'Light'}</span>`;
    };
  }

  function activityRows(rows) {
    if (!rows.length) return '<p class="scc-empty">Nothing yet</p>';
    return rows.map(a => `
      <div class="scc-activity-row">
        ${dot(a.action && a.action.includes('fail') ? BAD : ACCENT_C)}
        <span class="scc-activity-what"><strong>${esc(a.email || 'unknown')}</strong> — ${esc(a.action)}${a.meta_json ? ` <em>${esc(a.meta_json)}</em>` : ''}</span>
        <span class="scc-activity-when scc-mono">${fmtDate(a.created_at)}</span>
      </div>`).join('');
  }

  const views = {};

  /* ---------- Overview (dashboard) ---------- */
  views.dashboard = async function () {
    layout('dashboard', spinner);
    let d;
    try { d = (await api.get('/admin/analytics')).data; }
    catch (e) { return layout('dashboard', errBox(e)); }

    const byDay = d.sessionsByDay || [];
    const sessSeries = byDay.map(x => x.n);
    const calmSeries = byDay.map(x => x.avg_calm || 0);
    const signupSeries = (d.signups || []).map(s => s.n);
    const dayLabels = byDay.length ? [byDay[0].day, byDay[Math.floor(byDay.length / 2)]?.day, byDay[byDay.length - 1].day].filter(Boolean).map(x => x.slice(5)) : [];

    const plans = d.plans || [];
    const planColor = { free: SLATE, pro: ACCENT_V, premium: ACCENT_C };
    const planTotal = plans.reduce((a, p) => a + p.n, 0);

    const perf = (d.programPerf || []).slice(0, 5);
    const maxStarts = Math.max(1, ...perf.map(p => p.starts));
    const live = d.liveSessions || [];

    layout('dashboard', `
      <div class="scc-kpis">
        ${kpi('Total users', d.users?.total ?? 0, '', `${d.users?.new_this_week ?? 0} new / wk`, (d.users?.new_this_week ?? 0) > 0 ? 'up' : 'flat', signupSeries.length > 1 ? signupSeries : null)}
        ${kpi('Sessions', d.sessions?.total ?? 0, '', `${d.sessions?.last_24h ?? 0} in 24h`, (d.sessions?.last_24h ?? 0) > 0 ? 'up' : 'flat', sessSeries.length > 1 ? sessSeries : null, ACCENT_C)}
        ${kpi('Revenue', revenueStr(d.revenue), '', `${d.revenue?.payments ?? 0} payments`, (d.revenue?.payments ?? 0) > 0 ? 'up' : 'flat', null)}
        ${kpi('Avg calm score', d.sessions?.avg_calm != null ? Number(d.sessions.avg_calm) : '—', d.sessions?.avg_calm != null ? '/100' : '', 'completed sessions', 'flat', calmSeries.some(v => v > 0) ? calmSeries : null, GOOD)}
      </div>

      <div class="scc-grid-2-1">
        <div class="scc-card scc-card--glow">
          ${cardHead('Sessions × Calm', 'Last 14 days — sessions (violet) vs avg calm (cyan)',
            `<div class="scc-legend"><span>${dot(ACCENT_V)} Sessions</span><span>${dot(ACCENT_C)} Avg calm</span></div>`)}
          ${sessSeries.length > 1 ? lineChart(sessSeries, calmSeries.some(v => v > 0) ? calmSeries : null, 560, 170, dayLabels) : '<p class="scc-empty">Not enough session data yet</p>'}
        </div>
        <div class="scc-stack">
          <div class="scc-card">
            ${cardHead('Plan mix', 'Active subscriptions')}
            ${planTotal ? donut(plans.map(p => ({ value: p.n, color: planColor[p.plan] || SLATE })), 140, String(planTotal), 'plans') : '<p class="scc-empty">No subscriptions yet</p>'}
            <div class="scc-donut-legend">
              ${plans.map(p => `<span>${dot(planColor[p.plan] || SLATE)} ${esc(p.plan)} <b class="scc-mono">${p.n}</b></span>`).join('')}
            </div>
          </div>
          <div class="scc-card">
            ${cardHead('Live sessions', 'Started < 30 min ago', live.length ? tag(`${live.length} LIVE`, GOOD) : '')}
            ${live.length ? live.slice(0, 5).map(s => `
              <div class="scc-activity-row">
                ${dot(GOOD, true)}
                <span class="scc-activity-what"><strong>${esc(s.email || 'unknown')}</strong> — ${esc(s.title || 'freestyle')}</span>
                <span class="scc-activity-when scc-mono">${fmtDate(s.started_at)}</span>
              </div>`).join('') : '<p class="scc-empty">No live sessions right now</p>'}
          </div>
        </div>
      </div>

      <div class="scc-grid-2-1">
        <div class="scc-card">
          ${cardHead('Top programs', 'By session starts')}
          ${perf.length ? perf.map(p => meter(p.title, p.starts, maxStarts, `${p.starts} starts · ${p.completions ?? 0} done`)).join('') : '<p class="scc-empty">No program data yet</p>'}
        </div>
        <div class="scc-card">
          ${cardHead('Recent activity', 'Latest user events')}
          ${activityRows(d.recentActivity || [])}
        </div>
      </div>
    `);
  };

  /* ---------- Users ---------- */
  let userQuery = '', userPage = 1, searchTimer = null;

  views.users = async function () {
    layout('users', spinner);
    await renderUsers();
  };

  async function renderUsers() {
    let d;
    try {
      d = (await api.get('/admin/users', { params: { q: userQuery, page: userPage } })).data;
    } catch (e) { return layout('users', errBox(e)); }

    const cols = '2fr 110px 110px 110px 80px 130px 1.4fr';
    const rows = d.users.map(u => {
      const isMe = u.id === me.id;
      const acts = [];
      if (!isMe) {
        if (u.role === 'user') acts.push(`<button class="scc-btn scc-btn--violet" data-act="promote" data-id="${u.id}" data-email="${esc(u.email)}">Make admin</button>`);
        else acts.push(`<button class="scc-btn" data-act="demote" data-id="${u.id}" data-email="${esc(u.email)}">Demote</button>`);
        if (u.role !== 'admin') {
          if (u.status === 'active') acts.push(`<button class="scc-btn scc-btn--amber" data-act="suspend" data-id="${u.id}" data-email="${esc(u.email)}">Suspend</button>`);
          else if (u.status === 'suspended') acts.push(`<button class="scc-btn scc-btn--green" data-act="reactivate" data-id="${u.id}" data-email="${esc(u.email)}">Reactivate</button>`);
          if (u.status !== 'deleted') acts.push(`<button class="scc-btn scc-btn--danger" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}">Delete</button>`);
        }
      }
      return `<div class="scc-trow" style="grid-template-columns:${cols}">
        <div class="scc-user-cell">${avatarHTML(u.display_name || u.email, 30)}
          <div><strong>${esc(u.display_name || '—')}</strong><span>${esc(u.email)}</span></div></div>
        <div>${roleTag(u.role)}${isMe ? ` ${tag('you', ACCENT_C)}` : ''}</div>
        <div>${planTag(u.plan)}</div>
        <div>${statusTag(u.status)}</div>
        <div class="scc-mono scc-cell-2">${u.sessions ?? 0}</div>
        <div class="scc-mono scc-cell-3">${fmtDate(u.created_at)}</div>
        <div class="scc-acts">${acts.join('') || '<span class="scc-empty" style="padding:0">—</span>'}</div>
      </div>`;
    }).join('');

    const totalPages = Math.max(1, d.pages || 1);

    layout('users', `
      <div class="scc-kpis">
        ${kpi('Total users', d.total ?? 0, '', null)}
        ${kpi('This page', d.users.length, '', null)}
        ${kpi('Admins', d.users.filter(u => u.role === 'admin').length, '', 'on this page', 'flat')}
        ${kpi('Suspended', d.users.filter(u => u.status === 'suspended').length, '', 'on this page', 'flat')}
      </div>
      <div class="scc-card">
        <div class="scc-filter-bar">
          <div class="scc-search" style="flex:1">${icon('focus', 15)}<input id="user-search" placeholder="Search by email or name…" value="${esc(userQuery)}" /></div>
        </div>
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <span>User</span><span>Role</span><span>Plan</span><span>Status</span><span>Sessions</span><span>Joined</span><span>Actions</span>
        </div>
        ${rows || '<p class="scc-empty">No users found</p>'}
        <div class="scc-pager">
          <button class="scc-btn" id="pg-prev" ${userPage <= 1 ? 'disabled' : ''}>← Prev</button>
          <span class="scc-mono">Page ${userPage} / ${totalPages}</span>
          <button class="scc-btn" id="pg-next" ${userPage >= totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    `);

    const search = document.getElementById('user-search');
    search.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { userQuery = search.value.trim(); userPage = 1; renderUsers(); }, 350);
    };
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);

    document.getElementById('pg-prev').onclick = () => { if (userPage > 1) { userPage--; renderUsers(); } };
    document.getElementById('pg-next').onclick = () => { if (userPage < totalPages) { userPage++; renderUsers(); } };

    document.querySelectorAll('.scc-btn[data-act]').forEach(btn => {
      btn.onclick = () => userAction(btn.dataset.act, Number(btn.dataset.id), btn.dataset.email);
    });
  }

  async function userAction(act, id, email) {
    const cfg = {
      promote: { title: 'Promote to admin?', body: `${email} will gain full admin access.`, danger: false, run: () => api.put(`/admin/users/${id}/role`, { role: 'admin' }) },
      demote: { title: 'Demote admin?', body: `${email} will lose admin access.`, danger: true, run: () => api.put(`/admin/users/${id}/role`, { role: 'user' }) },
      suspend: { title: 'Suspend user?', body: `${email} will no longer be able to sign in.`, danger: true, run: () => api.put(`/admin/users/${id}/status`, { status: 'suspended' }) },
      reactivate: { title: 'Reactivate user?', body: `${email} will regain access.`, danger: false, run: () => api.put(`/admin/users/${id}/status`, { status: 'active' }) },
      delete: { title: 'Delete user?', body: `${email} will be permanently deactivated. This cannot be undone.`, danger: true, run: () => api.delete(`/admin/users/${id}`) },
    }[act];
    if (!cfg) return;
    const ok = await confirmModal(cfg.title, cfg.body, cfg.danger ? 'Yes, do it' : 'Confirm', cfg.danger);
    if (!ok) return;
    try {
      await cfg.run();
      toast('Done', 'ok');
      renderUsers();
    } catch (e) {
      toast(e?.response?.data?.error || 'Action failed', 'warn');
    }
  }

  /* ---------- Analytics ---------- */
  views.analytics = async function () {
    layout('analytics', spinner);
    let d, logs;
    try {
      [d, logs] = await Promise.all([
        api.get('/admin/analytics').then(r => r.data),
        api.get('/admin/activity-logs', { params: { limit: 100 } }).then(r => r.data),
      ]);
    } catch (e) { return layout('analytics', errBox(e)); }

    const byDay = d.sessionsByDay || [];
    const sessSeries = byDay.map(x => x.n);
    const calmSeries = byDay.map(x => x.avg_calm || 0);
    const dayLabels = byDay.length ? [byDay[0].day, byDay[byDay.length - 1].day].map(x => x.slice(5)) : [];
    const perf = d.programPerf || [];
    const maxStarts = Math.max(1, ...perf.map(p => p.starts));

    layout('analytics', `
      <div class="scc-kpis">
        ${kpi('Active users', d.users?.active ?? 0, '', null, null, null, GOOD)}
        ${kpi('Suspended', d.users?.suspended ?? 0, '', null, null, null, WARN)}
        ${kpi('Payments', d.revenue?.payments ?? 0, '', revenueStr(d.revenue), (d.revenue?.payments ?? 0) > 0 ? 'up' : 'flat')}
        ${kpi('Sessions (24h)', d.sessions?.last_24h ?? 0, '', `${d.sessions?.total ?? 0} all time`, 'flat', sessSeries.length > 1 ? sessSeries : null, ACCENT_C)}
      </div>

      <div class="scc-grid-2-1">
        <div class="scc-card scc-card--glow">
          ${cardHead('Session volume', 'Last 14 days',
            `<div class="scc-legend"><span>${dot(ACCENT_V)} Sessions</span><span>${dot(ACCENT_C)} Avg calm</span></div>`)}
          ${sessSeries.length > 1 ? lineChart(sessSeries, calmSeries.some(v => v > 0) ? calmSeries : null, 560, 170, dayLabels) : '<p class="scc-empty">Not enough session data yet</p>'}
        </div>
        <div class="scc-card">
          ${cardHead('Program performance', 'Completion & calm impact')}
          ${perf.length ? perf.slice(0, 6).map(p => {
            const compRate = p.starts ? Math.round(((p.completions || 0) / p.starts) * 100) : 0;
            return meter(p.title, p.starts, maxStarts, `${compRate}% done${p.avg_calm_delta != null ? ` · +${p.avg_calm_delta} calm` : ''}`,
              compRate >= 60 ? GOOD : compRate >= 30 ? ACCENT_V : WARN);
          }).join('') : '<p class="scc-empty">No program data yet</p>'}
        </div>
      </div>

      <div class="scc-card">
        ${cardHead('Activity stream', 'Last 100 events', tag(`${(logs.logs || []).length} EVENTS`, ACCENT_C))}
        ${activityRows(logs.logs || [])}
      </div>
    `);
  };

  /* ---------- Programs (content) ---------- */
  views.content = async function () {
    layout('content', spinner);
    let d, perf = {};
    try {
      const [progs, analytics] = await Promise.all([
        api.get('/admin/programs').then(r => r.data),
        api.get('/admin/analytics').then(r => r.data).catch(() => null),
      ]);
      d = progs;
      (analytics?.programPerf || []).forEach(p => { perf[p.id] = p; });
    } catch (e) { return layout('content', errBox(e)); }

    const premiumCount = d.programs.filter(p => p.is_premium).length;
    const activeCount = d.programs.filter(p => p.active).length;

    const cards = d.programs.map(p => {
      const st = perf[p.id] || {};
      const compRate = st.starts ? Math.round(((st.completions || 0) / st.starts) * 100) : null;
      return `<div class="scc-card scc-prog">
        <div class="scc-prog-head">
          <div class="scc-prog-orb"></div>
          <div style="flex:1;min-width:0">
            <div class="scc-card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
            <div class="scc-card-sub">${esc(p.slug)} · ${esc(p.category)}</div>
          </div>
          ${p.is_new ? tag('NEW', ACCENT_C) : ''}
        </div>
        <div class="scc-prog-stats">
          <div><span class="scc-mono">${p.inhale}–${p.hold}–${p.exhale}</span><label>pattern</label></div>
          <div><span class="scc-mono">${st.starts ?? 0}</span><label>starts</label></div>
          <div><span class="scc-mono">${compRate != null ? compRate + '%' : '—'}</span><label>done</label></div>
          <div><span class="scc-mono">${st.avg_calm_delta != null ? '+' + st.avg_calm_delta : '—'}</span><label>calm Δ</label></div>
        </div>
        <div class="scc-prog-toggles">
          <label class="scc-prog-tg"><span>Premium</span><span class="scc-toggle"><input type="checkbox" data-field="is_premium" data-id="${p.id}" ${p.is_premium ? 'checked' : ''}/><span></span></span></label>
          <label class="scc-prog-tg"><span>New badge</span><span class="scc-toggle"><input type="checkbox" data-field="is_new" data-id="${p.id}" ${p.is_new ? 'checked' : ''}/><span></span></span></label>
          <label class="scc-prog-tg"><span>Active</span><span class="scc-toggle"><input type="checkbox" data-field="active" data-id="${p.id}" ${p.active ? 'checked' : ''}/><span></span></span></label>
        </div>
      </div>`;
    }).join('');

    layout('content', `
      <div class="scc-kpis">
        ${kpi('Programs', d.programs.length, '', null)}
        ${kpi('Active', activeCount, '', null, null, null, GOOD)}
        ${kpi('Premium', premiumCount, '', null, null, null, ACCENT_C)}
        ${kpi('Free', d.programs.length - premiumCount, '', null)}
      </div>
      <div class="scc-grid-3">${cards}</div>
      <p class="scc-empty" style="text-align:left;padding:4px 2px">Toggles save instantly and invalidate the programs cache.</p>
    `);

    document.querySelectorAll('.scc-toggle input').forEach(inp => {
      inp.onchange = async () => {
        try {
          await api.put(`/admin/programs/${inp.dataset.id}`, { [inp.dataset.field]: !!inp.checked });
          toast('Saved', 'ok');
        } catch (e) {
          inp.checked = !inp.checked;
          toast(e?.response?.data?.error || 'Save failed', 'warn');
        }
      };
    });
  };

  /* ---------- Audit ---------- */
  views.audit = async function () {
    layout('audit', spinner);
    let d;
    try { d = (await api.get('/admin/audit-logs', { params: { limit: 100 } })).data; }
    catch (e) { return layout('audit', errBox(e)); }

    const cols = '130px 1.4fr 150px 140px 2fr 110px';
    const rows = (d.logs || []).map(l => `
      <div class="scc-trow" style="grid-template-columns:${cols}">
        <div class="scc-mono scc-cell-3">${fmtDate(l.created_at)}</div>
        <div class="scc-cell-2">${esc(l.admin_email || l.admin_id)}</div>
        <div>${tag(l.action, ACCENT_V)}</div>
        <div class="scc-mono scc-cell-3">${esc(l.target_type ? `${l.target_type} #${l.target_id}` : '—')}</div>
        <div class="scc-cell-3" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.detail_json || '')}">${esc(l.detail_json || '')}</div>
        <div class="scc-mono scc-cell-3">${esc(l.ip || '—')}</div>
      </div>`).join('');

    layout('audit', `
      <div class="scc-card">
        ${cardHead('Audit log', 'Admin actions — immutable record', tag(`${(d.logs || []).length} ENTRIES`, ACCENT_V))}
        <div class="scc-thead" style="grid-template-columns:${cols}">
          <span>Time</span><span>Admin</span><span>Action</span><span>Target</span><span>Detail</span><span>IP</span>
        </div>
        ${rows || '<p class="scc-empty">No admin actions recorded yet</p>'}
      </div>
    `);
  };

  /* ---------- boot ---------- */
  async function boot() {
    if (!(await guard())) return;
    const render = () => views[currentView()]();
    window.addEventListener('hashchange', render);
    render();
  }
  boot();
})();
