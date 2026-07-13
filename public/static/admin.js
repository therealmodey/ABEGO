/* AURA Admin Panel */
(function () {
  const { api, AuraState, icon, toast, confirmModal, bgHTML } = window.Aura;
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
    { id: 'dashboard', label: 'Dashboard', ic: 'home' },
    { id: 'users', label: 'Users', ic: 'users' },
    { id: 'analytics', label: 'Analytics', ic: 'stats' },
    { id: 'content', label: 'Content', ic: 'lotus' },
    { id: 'audit', label: 'Audit logs', ic: 'doc' },
  ];

  function currentView() {
    const h = location.hash.replace(/^#\/?/, '');
    return NAV.some(n => n.id === h) ? h : 'dashboard';
  }

  function layout(view, content) {
    root.innerHTML = `
      ${bgHTML(258)}
      <div class="admin-shell">
        <aside class="admin-side glass">
          <div class="admin-brand">
            <div class="admin-brand-orb"></div>
            <div>
              <div class="admin-brand-name">AURA</div>
              <div class="admin-brand-sub">Admin console</div>
            </div>
          </div>
          <nav class="admin-nav">
            ${NAV.map(n => `
              <a href="#/${n.id}" class="admin-nav-item ${view === n.id ? 'admin-nav-item--active' : ''}">
                ${icon(n.ic, 18)}<span>${n.label}</span>
              </a>`).join('')}
          </nav>
          <div class="admin-side-foot">
            <a href="/" class="admin-nav-item">${icon('back', 18)}<span>Back to app</span></a>
            <button class="admin-nav-item" id="admin-logout" style="width:100%;background:none;border:none;cursor:pointer">
              ${icon('logout', 18)}<span>Log out</span>
            </button>
            <div class="admin-me">${esc(me?.email || '')}</div>
          </div>
        </aside>
        <main class="admin-main">${content}</main>
      </div>`;
    const lo = document.getElementById('admin-logout');
    if (lo) lo.onclick = async () => {
      try { await api.post('/auth/logout'); } catch (e) {}
      localStorage.removeItem('aura_token'); localStorage.removeItem('aura_user');
      location.href = '/#/welcome';
    };
  }

  const spinner = `<div class="admin-loading"><div class="pulse-ring"></div><p>Loading…</p></div>`;

  function statTile(label, value, sub, ic) {
    return `
      <div class="glass admin-tile">
        <div class="admin-tile-ic">${icon(ic, 20)}</div>
        <div class="admin-tile-val">${value}</div>
        <div class="admin-tile-label">${label}</div>
        ${sub ? `<div class="admin-tile-sub">${sub}</div>` : ''}
      </div>`;
  }

  function badge(text, kind) {
    return `<span class="a-badge a-badge--${kind}">${esc(text)}</span>`;
  }

  function roleBadge(r) { return badge(r, r === 'admin' ? 'violet' : 'slate'); }
  function planBadge(p) { return badge(p || 'free', p === 'premium' ? 'cyan' : p === 'pro' ? 'violet' : 'slate'); }
  function statusBadge(s) { return badge(s, s === 'active' ? 'green' : s === 'suspended' ? 'amber' : 'slate'); }

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

  const views = {};

  /* ---------- Dashboard ---------- */
  views.dashboard = async function () {
    layout('dashboard', spinner);
    let d;
    try { d = (await api.get('/admin/analytics')).data; }
    catch (e) { return layout('dashboard', errBox(e)); }

    const rev = revenueStr(d.revenue);
    const maxPlan = Math.max(1, ...(d.plans || []).map(p => p.n));
    const maxDay = Math.max(1, ...(d.signups || []).map(s => s.n));

    layout('dashboard', `
      <h1 class="admin-h1">Dashboard</h1>
      <div class="admin-tiles">
        ${statTile('Total users', d.users?.total ?? 0, `${d.users?.new_this_week ?? 0} new this week`, 'users')}
        ${statTile('Sessions', d.sessions?.total ?? 0, `${d.sessions?.last_24h ?? 0} in 24h`, 'play')}
        ${statTile('Revenue', rev, `${d.revenue?.payments ?? 0} payments`, 'card')}
        ${statTile('Avg calm score', d.sessions?.avg_calm != null ? Number(d.sessions.avg_calm) : '—', 'across completed sessions', 'stats')}
      </div>

      <div class="admin-cols">
        <div class="glass admin-card">
          <h3 class="admin-card-title">Plan distribution</h3>
          ${(d.plans || []).map(p => `
            <div class="admin-bar-row">
              <span class="admin-bar-label">${esc(p.plan)}</span>
              <div class="admin-bar-track"><div class="admin-bar-fill admin-bar-fill--${p.plan}" style="width:${Math.round((p.n / maxPlan) * 100)}%"></div></div>
              <span class="admin-bar-val">${p.n}</span>
            </div>`).join('') || '<p class="admin-empty">No subscriptions yet</p>'}
        </div>

        <div class="glass admin-card">
          <h3 class="admin-card-title">Signups — last 14 days</h3>
          <div class="admin-chart">
            ${(d.signups || []).map(s => `
              <div class="admin-chart-col" title="${esc(s.day)}: ${s.n}">
                <div class="admin-chart-bar" style="height:${Math.max(6, Math.round((s.n / maxDay) * 100))}%"></div>
              </div>`).join('') || '<p class="admin-empty">No data</p>'}
          </div>
        </div>
      </div>

      <div class="glass admin-card">
        <h3 class="admin-card-title">Recent activity</h3>
        ${activityList(d.recentActivity || [])}
      </div>
    `);
  };

  function activityList(rows) {
    if (!rows.length) return '<p class="admin-empty">Nothing yet</p>';
    return `<div class="admin-activity">${rows.map(a => `
      <div class="admin-activity-row">
        <span class="admin-activity-dot"></span>
        <span class="admin-activity-what"><strong>${esc(a.email || 'unknown')}</strong> — ${esc(a.action)}${a.meta_json ? ` <em>${esc(a.meta_json)}</em>` : ''}</span>
        <span class="admin-activity-when">${fmtDate(a.created_at)}</span>
      </div>`).join('')}</div>`;
  }

  function revenueStr(r) {
    if (!r) return '$0';
    const parts = [];
    if (r.usd_cents) parts.push(money(r.usd_cents, 'USD'));
    if (r.ngn_kobo) parts.push(money(r.ngn_kobo, 'NGN'));
    return parts.join(' + ') || '$0';
  }

  function errBox(e) {
    const msg = e?.response?.data?.error || e.message || 'Something drifted off course';
    return `<div class="glass admin-card" style="border-color:rgba(251,191,36,.3)">
      <p style="color:#FBBF24;margin:0">${esc(msg)}</p></div>`;
  }

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

    const rows = d.users.map(u => {
      const isMe = u.id === me.id;
      const acts = [];
      if (!isMe) {
        if (u.role === 'user') acts.push(`<button class="a-act a-act--violet" data-act="promote" data-id="${u.id}" data-email="${esc(u.email)}">Make admin</button>`);
        else acts.push(`<button class="a-act" data-act="demote" data-id="${u.id}" data-email="${esc(u.email)}">Demote</button>`);
        if (u.role !== 'admin') {
          if (u.status === 'active') acts.push(`<button class="a-act a-act--amber" data-act="suspend" data-id="${u.id}" data-email="${esc(u.email)}">Suspend</button>`);
          else if (u.status === 'suspended') acts.push(`<button class="a-act a-act--green" data-act="reactivate" data-id="${u.id}" data-email="${esc(u.email)}">Reactivate</button>`);
          if (u.status !== 'deleted') acts.push(`<button class="a-act a-act--danger" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}">Delete</button>`);
        }
      }
      return `<tr>
        <td><div class="a-user-cell"><strong>${esc(u.display_name || '—')}</strong><span>${esc(u.email)}</span></div></td>
        <td>${roleBadge(u.role)}${isMe ? ' <span class="a-you">you</span>' : ''}</td>
        <td>${planBadge(u.plan)}</td>
        <td>${statusBadge(u.status)}</td>
        <td>${u.sessions ?? 0}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td class="a-acts">${acts.join('') || '<span class="admin-empty">—</span>'}</td>
      </tr>`;
    }).join('');

    const totalPages = Math.max(1, d.pages || 1);

    layout('users', `
      <h1 class="admin-h1">Users <span class="admin-h1-sub">${d.total ?? 0} total</span></h1>
      <div class="glass admin-card">
        <input id="user-search" class="admin-search" placeholder="Search by email or name…" value="${esc(userQuery)}" />
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>User</th><th>Role</th><th>Plan</th><th>Status</th><th>Sessions</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="admin-empty">No users found</td></tr>'}</tbody>
          </table>
        </div>
        <div class="admin-pager">
          <button class="a-act" id="pg-prev" ${userPage <= 1 ? 'disabled' : ''}>← Prev</button>
          <span>Page ${userPage} / ${totalPages}</span>
          <button class="a-act" id="pg-next" ${userPage >= totalPages ? 'disabled' : ''}>Next →</button>
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

    document.querySelectorAll('.a-act[data-act]').forEach(btn => {
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

    layout('analytics', `
      <h1 class="admin-h1">Analytics</h1>
      <div class="admin-tiles">
        ${statTile('Active users', d.users?.active ?? 0, '', 'users')}
        ${statTile('Suspended', d.users?.suspended ?? 0, '', 'pause')}
        ${statTile('Payments', d.revenue?.payments ?? 0, revenueStr(d.revenue), 'card')}
        ${statTile('Sessions (24h)', d.sessions?.last_24h ?? 0, `${d.sessions?.total ?? 0} all time`, 'play')}
      </div>
      <div class="glass admin-card">
        <h3 class="admin-card-title">Activity stream — last 100 events</h3>
        ${activityList(logs.logs || [])}
      </div>
    `);
  };

  /* ---------- Content ---------- */
  views.content = async function () {
    layout('content', spinner);
    let d;
    try { d = (await api.get('/admin/programs')).data; }
    catch (e) { return layout('content', errBox(e)); }

    const rows = d.programs.map(p => `
      <tr>
        <td><div class="a-user-cell"><strong>${esc(p.title)}</strong><span>${esc(p.slug)} · ${esc(p.category)}</span></div></td>
        <td>${p.inhale}–${p.hold}–${p.exhale} · ${p.cycles} cycles · ${p.duration_min} min</td>
        <td><label class="a-switch"><input type="checkbox" data-field="is_premium" data-id="${p.id}" ${p.is_premium ? 'checked' : ''}/><span></span></label></td>
        <td><label class="a-switch"><input type="checkbox" data-field="is_new" data-id="${p.id}" ${p.is_new ? 'checked' : ''}/><span></span></label></td>
        <td><label class="a-switch"><input type="checkbox" data-field="active" data-id="${p.id}" ${p.active ? 'checked' : ''}/><span></span></label></td>
      </tr>`).join('');

    layout('content', `
      <h1 class="admin-h1">Content <span class="admin-h1-sub">${d.programs.length} programs</span></h1>
      <div class="glass admin-card">
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Program</th><th>Pattern</th><th>Premium</th><th>New badge</th><th>Active</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="admin-hint">Toggles save instantly and invalidate the programs cache.</p>
      </div>
    `);

    document.querySelectorAll('.a-switch input').forEach(inp => {
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

    const rows = (d.logs || []).map(l => `
      <tr>
        <td>${fmtDate(l.created_at)}</td>
        <td>${esc(l.admin_email || l.admin_id)}</td>
        <td>${badge(l.action, 'violet')}</td>
        <td>${esc(l.target_type ? `${l.target_type} #${l.target_id}` : '—')}</td>
        <td class="a-detail">${esc(l.detail_json || '')}</td>
        <td>${esc(l.ip || '—')}</td>
      </tr>`).join('');

    layout('audit', `
      <h1 class="admin-h1">Audit logs</h1>
      <div class="glass admin-card">
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="admin-empty">No admin actions recorded yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `);
  };

  /* ---------- Boot ---------- */
  async function boot() {
    if (!(await guard())) return;
    const render = () => views[currentView()]();
    window.addEventListener('hashchange', render);
    render();
  }
  boot();
})();
