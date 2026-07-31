/* Pokie — the live app.
 *
 * This replaces the old three-file stack (pokie.js prototype + api.js adapter +
 * actions.js gate). That stack rendered a design prototype and then tried to
 * overwrite its arrays with real data; anything it could not map silently fell
 * back to sample data, and every control was matched by button *label text*, so
 * a copy change unwired it without a sound. The result was a page that looked
 * live and did nothing.
 *
 * The rules here are the opposite:
 *
 *   1. Every screen renders from the API. There is no sample data to fall back
 *      to — an endpoint that fails says so, in place, with a Retry.
 *   2. Every control is bound by identity (data-act), never by label text.
 *   3. If openapi.yaml v1.0.1 has no endpoint for something, the control is not
 *      here at all. Nothing is drawn that cannot work.
 *
 * Served same-origin from the API host at /app/, so API_BASE is '' and CORS
 * never enters the picture.
 */
'use strict';

(function () {
  /* ================= config ================= */
  // This file is served from two places: /app/ on the API host (same-origin,
  // so relative paths reach the API directly) and pokie.rachittiwari.com (its
  // own Pages site, which is cross-origin and must name the API host). Detect
  // rather than hardcode, so one build works in both and neither needs a
  // separate copy to drift out of date.
  const SAME_ORIGIN_API = /^(api\.rachittiwari\.com|localhost|127\.0\.0\.1)$/
    .test(location.hostname);
  const stored = localStorage.getItem('pokie.apiBase');
  const API_BASE = stored !== null
    ? stored
    : (SAME_ORIGIN_API ? '' : 'https://api.rachittiwari.com');
  const TOKEN_KEY = 'pokie.tokens';
  const PINK = '#EB6BA8', GREEN = '#1CE15F', BLUE = '#4791FF', YELLOW = '#ECE42E', GREY = '#9A9A9A';

  const mark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="display:block;flex-shrink:0"><g transform="rotate(45 12 12)"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5.4" fill="#EB6BA8"/></g><ellipse cx="9.1" cy="12" rx="1.35" ry="2.6" fill="#fff"/><ellipse cx="14.9" cy="12" rx="1.35" ry="2.6" fill="#fff"/></svg>`;

  /* ================= tiny helpers ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Two characters, always: one-word companies use their first two letters
  // rather than a lonely initial.
  const initials = (s) => {
    const parts = String(s || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  function daysSince(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }
  function ago(iso) {
    const d = daysSince(iso);
    if (d === null) return '—';
    if (d === 0) {
      const h = Math.floor((Date.now() - Date.parse(iso)) / 3600000);
      if (h <= 0) return 'just now';
      return h + 'h ago';
    }
    if (d === 1) return 'yesterday';
    return d + 'd ago';
  }
  const timeOf = (iso) => {
    const t = Date.parse(iso);
    return isNaN(t) ? '' : new Date(t).toTimeString().slice(0, 5);
  };
  const dayLabel = (d) => {
    const today = new Date().toISOString().slice(0, 10);
    if (d === today) return 'Today';
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (d === y) return 'Yesterday';
    return d;
  };

  function scoreColour(score) {
    if (score == null) return GREY;
    if (score >= 85) return GREEN;
    if (score >= 70) return BLUE;
    if (score >= 55) return YELLOW;
    return GREY;
  }
  const titleCase = (s) => String(s || '').replace(/_/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());

  /* ================= tokens ================= */
  const tokens = {
    get() {
      try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
      catch { return null; }
    },
    set(t) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); },
    clear() { localStorage.removeItem(TOKEN_KEY); },
  };

  /* ================= fetch ================= */
  // Resolves { ok, data, error }. Never throws, never invents data.
  async function api(path, opts = {}, retrying = false) {
    const t = tokens.get();
    if (!t) { showLogin(); return { ok: false, error: 'Not signed in.' }; }
    let res;
    try {
      res = await fetch(API_BASE + path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + t.access_token,
          ...(opts.headers || {}),
        },
      });
    } catch (err) {
      return { ok: false, error: 'Cannot reach the API (' + err.message + ').' };
    }
    if (res.status === 401 && !retrying && t.refresh_token) {
      if (await refresh(t.refresh_token)) return api(path, opts, true);
      tokens.clear();
      showLogin('Session expired — sign in again.');
      return { ok: false, error: 'Session expired.' };
    }
    if (res.status === 204) return { ok: true, data: null };
    let body = null;
    try { body = await res.json(); } catch { /* empty body is fine */ }
    if (!res.ok) {
      const msg = (body && (body.message || body.code)) || ('HTTP ' + res.status);
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, data: body };
  }

  async function refresh(refresh_token) {
    try {
      const res = await fetch(API_BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token }),
      });
      if (!res.ok) return false;
      tokens.set(await res.json());
      return true;
    } catch { return false; }
  }

  async function login(email, password) {
    const res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Wrong email or password.'
        : 'Login failed (HTTP ' + res.status + ').');
    }
    tokens.set(await res.json());
  }

  /* ================= state ================= */
  const state = {
    screen: 'home',
    jobFilter: 'all',      // all | scored | unscored | dismissed
    jobSort: 'score',      // score | newest
    selectedJob: null,
    mobileDetail: false,
    histCursor: null,
    sweepId: null,
    sweepPoll: null,
    memEdit: null,
  };
  // Per-screen cache: { loading, error, data }
  const store = {};
  function slot(key) {
    if (!store[key]) store[key] = { loading: false, error: null, data: null };
    return store[key];
  }

  /* ================= toast ================= */
  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.innerHTML = `<span>${esc(text)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  /* ================= login overlay ================= */
  function showLogin(message) {
    if ($('#pk-login')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pk-login';
    wrap.innerHTML = `
      <div class="pk-login-card">
        <div class="pk-login-top">${mark(30)}<b>Pokie</b></div>
        <div class="pk-login-sub">Sign in to reach your hunt.</div>
        ${message ? `<div class="pk-login-msg">${esc(message)}</div>` : ''}
        <input id="pk-email" type="email" placeholder="Email" autocomplete="username">
        <input id="pk-pass" type="password" placeholder="Password" autocomplete="current-password">
        <button class="pill primary" id="pk-signin" style="background:var(--pink);justify-content:center">Sign in</button>
        <div class="pk-login-err" id="pk-err"></div>
      </div>`;
    document.body.appendChild(wrap);
    const go = async () => {
      const btn = $('#pk-signin'), err = $('#pk-err');
      btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
      try {
        await login($('#pk-email').value.trim(), $('#pk-pass').value);
        wrap.remove();
        boot();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    };
    $('#pk-signin').onclick = go;
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    $('#pk-email').focus();
  }

  /* ================= nav ================= */
  const NAV = [
    { title: 'Hunt', items: [
      { icon: '◎', label: 'Home', key: 'home' },
      { icon: '✦', label: 'Jobs', key: 'jobs' },
      { icon: '⟳', label: 'Live run', key: 'run' },
      { icon: '!', label: 'Needs you', key: 'approve', badgeKey: 'reviews' },
    ]},
    { title: 'Apply', items: [
      { icon: '➤', label: 'Applications', key: 'applications', badgeKey: 'confirm' },
    ]},
    { title: 'Pokie', items: [
      { icon: '◈', label: 'Memory', key: 'memory', badgeKey: 'proposals' },
      { icon: '⊞', label: 'Sources', key: 'sources' },
      { icon: '⏱', label: 'History', key: 'history' },
      { icon: '▤', label: 'Vault', key: 'vault', badgeKey: 'gaps' },
      { icon: '⚙', label: 'Settings', key: 'settings' },
    ]},
  ];
  const TABS = [
    { icon: '◎', label: 'Home', key: 'home' },
    { icon: '✦', label: 'Jobs', key: 'jobs' },
    { icon: '⟳', label: 'Run', key: 'run' },
    { icon: '!', label: 'Needs you', key: 'approve', badgeKey: 'reviews' },
    { icon: '⋯', label: 'More', key: 'more' },
  ];

  // Badge counts come from real data once loaded; absent until then.
  const badges = {};
  function badgeFor(key) {
    const n = badges[key];
    if (!n) return '';
    const colour = key === 'reviews' ? YELLOW : key === 'gaps' ? PINK : GREEN;
    const bg = key === 'reviews' ? 'rgba(236,226,46,.18)'
      : key === 'gaps' ? 'rgba(235,107,168,.16)' : 'rgba(28,225,95,.16)';
    return `<span class="nav-badge" style="background:${bg};color:${colour}">${n}</span>`;
  }

  function railHTML() {
    return `
      <div class="rail-logo">${mark(26)}<b>Pokie</b></div>
      ${NAV.map(g => `
        <div class="nav-group">
          <div class="nav-title">${g.title}</div>
          ${g.items.map(it => `
            <button class="nav-item ${state.screen === it.key ? 'on' : ''}" data-act="go" data-screen="${it.key}">
              <span class="ic">${it.icon}</span><span class="lb">${it.label}</span>
              ${it.badgeKey ? badgeFor(it.badgeKey) : ''}
            </button>`).join('')}
        </div>`).join('')}
      <div class="rail-spacer"></div>
      <div class="rail-user">
        <div class="ava">${initials(badges.userName || 'Pokie')}</div>
        <div style="min-width:0">
          <div class="nm">${esc(badges.userName || 'Signed in')}</div>
          <div class="rl">${esc(badges.userEmail || '')}</div>
        </div>
        <button class="dots" data-act="logout" title="Sign out">⏻</button>
      </div>`;
  }
  function tabbarHTML() {
    return TABS.map(t => `
      <button class="tab ${state.screen === t.key ? 'on' : ''}" data-act="go" data-screen="${t.key}">
        <span class="ic">${t.icon}</span><span>${t.label}</span>
        ${t.badgeKey && badges[t.badgeKey] ? `<i class="dot" style="background:${YELLOW}"></i>` : ''}
      </button>`).join('');
  }

  /* ================= shared fragments ================= */
  const loadingHTML = (what) =>
    `<div class="pk-state"><span class="spinner" style="width:20px;height:20px"></span><span>Loading ${esc(what)}…</span></div>`;
  const errorHTML = (msg, retryScreen) =>
    `<div class="pk-state err">
       <div><b>Could not load this.</b><div class="s">${esc(msg)}</div></div>
       <button class="pill outline" data-act="reload" data-screen="${esc(retryScreen || state.screen)}">Retry</button>
     </div>`;
  const emptyHTML = (title, sub) =>
    `<div class="pk-state"><div><b>${esc(title)}</b>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div></div>`;

  function pageHead(title, sub, right) {
    return `<div class="page-head">
      <div><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>
      ${right || ''}
    </div>`;
  }

  /* ================= loaders =================
   * Each returns a promise; screens render from slot() state.            */
  async function load(key, path, mapper) {
    const s = slot(key);
    if (s.loading) return;
    s.loading = true; s.error = null;
    const res = await api(path);
    s.loading = false;
    if (!res.ok) { s.error = res.error; s.data = null; }
    else { s.data = mapper ? mapper(res.data) : res.data; }
    render();
  }

  async function loadHome() {
    const s = slot('home');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [jobs, reviews, funnel, spend, beats, gaps, cq] = await Promise.all([
      api('/jobs?limit=200'), api('/reviews'), api('/pipeline/funnel_stats'),
      api('/system/spend'), api('/system/heartbeats'), api('/vault/gaps'),
      api('/applications/confirm_queue'),
    ]);
    s.loading = false;
    const firstErr = [jobs, reviews, funnel, spend, beats, gaps, cq].find(r => !r.ok);
    if (firstErr) { s.error = firstErr.error; s.data = null; render(); return; }
    const items = jobs.data.items || [];
    s.data = {
      jobs: items,
      scored: items.filter(j => j.score_state === 'scored').length,
      unscored: items.filter(j => j.score_state !== 'scored').length,
      reviews: reviews.data.items || [],
      funnel: funnel.data,
      spend: spend.data,
      beats: beats.data.items || [],
      gaps: (gaps.data.items || []).filter(g => g.blocking),
      confirm: cq.data.items || [],
    };
    badges.reviews = s.data.reviews.length;
    badges.confirm = s.data.confirm.length;
    badges.gaps = s.data.gaps.length;
    render();
  }

  const loadJobs = () => load('jobs', '/jobs?limit=200', d => d.items || []);
  async function loadReviews() {
    const s = slot('reviews');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [rev, jobs] = await Promise.all([api('/reviews'), api('/jobs?limit=200')]);
    s.loading = false;
    if (!rev.ok) { s.error = rev.error; s.data = null; render(); return; }
    const byJob = {};
    if (jobs.ok) (jobs.data.items || []).forEach(j => { byJob[j.id] = j; });
    const items = rev.data.items || [];
    badges.reviews = items.filter(r => r.status === 'pending').length;
    s.data = { items, byJob };
    render();
  }
  const loadSources = () => load('sources', '/sources/health', d => d.items || []);
  const loadHistory = () => load('history', '/activity/log?limit=60', d => d.days || []);

  async function loadMemory() {
    const s = slot('memory');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [f, p, pr] = await Promise.all([
      api('/memory/facts?limit=200'), api('/memory/preferences?limit=200'),
      api('/memory/proposals?limit=200'),
    ]);
    s.loading = false;
    const bad = [f, p, pr].find(r => !r.ok);
    if (bad) { s.error = bad.error; s.data = null; render(); return; }
    const proposals = (pr.data.items || []).filter(x => x.status === 'pending');
    s.data = { facts: f.data.items || [], prefs: p.data.items || [], proposals };
    badges.proposals = proposals.length;
    render();
  }

  async function loadApplications() {
    const s = slot('applications');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [apps, cq, board, funnel, jobs] = await Promise.all([
      api('/applications?limit=100'), api('/applications/confirm_queue'),
      api('/pipeline/board'), api('/pipeline/funnel_stats'), api('/jobs?limit=200'),
    ]);
    s.loading = false;
    const bad = [apps, cq, board, funnel].find(r => !r.ok);
    if (bad) { s.error = bad.error; s.data = null; render(); return; }
    // Applications carry a job_id, not a title — resolve it so the screen
    // shows roles rather than slugs.
    const byJob = {};
    if (jobs.ok) (jobs.data.items || []).forEach(j => { byJob[j.id] = j; });
    s.data = {
      apps: apps.data.items || [], confirm: cq.data.items || [],
      board: board.data.columns || [], funnel: funnel.data, byJob,
    };
    badges.confirm = s.data.confirm.length;
    render();
  }

  async function loadVault() {
    const s = slot('vault');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [prof, gaps, qa, ev] = await Promise.all([
      api('/vault/profile'), api('/vault/gaps'), api('/vault/qa_bank?limit=100'),
      api('/vault/work_evidence?limit=100'),
    ]);
    s.loading = false;
    const bad = [prof, gaps, qa, ev].find(r => !r.ok);
    if (bad) { s.error = bad.error; s.data = null; render(); return; }
    s.data = {
      profile: prof.data, gaps: gaps.data.items || [],
      qa: qa.data.items || [], evidence: ev.data.items || [],
    };
    badges.gaps = s.data.gaps.filter(g => g.blocking).length;
    render();
  }

  async function loadSettings() {
    const s = slot('settings');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [safety, routing, spend, beats, backups] = await Promise.all([
      api('/settings/safety'), api('/settings/model_routing'), api('/system/spend'),
      api('/system/heartbeats'), api('/system/backups'),
    ]);
    s.loading = false;
    const bad = [safety, routing, spend, beats].find(r => !r.ok);
    if (bad) { s.error = bad.error; s.data = null; render(); return; }
    s.data = {
      safety: safety.data, routing: routing.data, spend: spend.data,
      beats: beats.data.items || [],
      backups: backups.ok ? backups.data : null,
    };
    render();
  }

  async function loadJobDetail(id) {
    const s = slot('job:' + id);
    if (s.loading || s.data) return;
    s.loading = true; s.error = null;
    const res = await api('/jobs/' + encodeURIComponent(id));
    s.loading = false;
    if (!res.ok) s.error = res.error; else s.data = res.data;
    render();
  }

  async function loadReviewDetail(id) {
    const s = slot('review:' + id);
    if (s.loading || s.data) return;
    s.loading = true; s.error = null;
    const res = await api('/reviews/' + encodeURIComponent(id));
    s.loading = false;
    if (!res.ok) s.error = res.error; else s.data = res.data;
    render();
  }

  /* ================= screens ================= */

  function screenHome() {
    const s = slot('home');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('your hunt')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    if (!s.data) return `<div class="pad">${loadingHTML('your hunt')}</div>`;
    const d = s.data;
    const top = [...d.jobs]
      .filter(j => j.score != null)
      .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const beatsDown = d.beats.filter(b => !b.healthy).length;

    return `<div class="pad home">
      ${pageHead('Your hunt', 'Everything below is live from the backend.',
        `<button class="pill primary" style="background:${PINK}" data-act="sweep-now">Run a sweep</button>`)}

      <div class="stat-grid">
        ${statCard('Jobs found', d.jobs.length, '#fff')}
        ${statCard('Scored', d.scored, GREEN)}
        ${statCard('Unscored', d.unscored, d.unscored ? YELLOW : GREY)}
        ${statCard('Needs you', d.reviews.length, d.reviews.length ? YELLOW : GREY)}
        ${statCard('In flight', d.funnel.total, BLUE)}
        ${statCard('LLM spend', '$' + (d.spend.llm_usd_month || 0).toFixed(2), '#fff')}
      </div>

      ${d.gaps.length ? `<div class="banner pink">
        <div class="t">${d.gaps.length} blocking gap${d.gaps.length > 1 ? 's' : ''} in your vault</div>
        <div class="s">${esc(d.gaps.map(g => g.label).join(' · '))}</div>
        <button class="pill outline" data-act="go" data-screen="vault">Fill them in</button>
      </div>` : ''}

      ${d.confirm.length ? `<div class="banner yellow">
        <div class="t">${d.confirm.length} application${d.confirm.length > 1 ? 's' : ''} waiting on you</div>
        <div class="s">Pokie filled the form and stopped before submitting.</div>
        <button class="pill outline" data-act="go" data-screen="applications">Review them</button>
      </div>` : ''}

      ${beatsDown ? `<div class="banner grey">
        <div class="t">${beatsDown} background service${beatsDown > 1 ? 's have' : ' has'} no recent heartbeat</div>
        <div class="s">${esc(d.beats.filter(b => !b.healthy).map(b => b.service).join(', '))}</div>
        <button class="pill outline" data-act="go" data-screen="settings">Open settings</button>
      </div>` : ''}

      <div class="two-col">
        <div class="score-card">
          <div class="eyebrow">Best fits right now</div>
          ${top.length ? top.map(j => `
            <button class="mini-job" data-act="open-job" data-id="${esc(j.id)}">
              <span class="job-av" style="background:${scoreColour(j.score)};width:34px;height:34px;border-radius:11px;font-size:13px">${esc(initials(j.company))}</span>
              <span class="mj-col">
                <span class="mj-role">${esc(j.title)}</span>
                <span class="mj-co">${esc(j.company)} · ${esc(j.location || '—')}</span>
              </span>
              <span class="job-score" style="color:${scoreColour(j.score)}">${j.score == null ? '—' : Math.round(j.score)}</span>
            </button>`).join('')
            : emptyHTML('No scored jobs yet', 'Run a sweep, then score what it finds.')}
        </div>
        <div class="score-card">
          <div class="eyebrow">Pipeline</div>
          ${Object.entries(d.funnel.by_state || {}).filter(([, v]) => v > 0).length
            ? Object.entries(d.funnel.by_state).filter(([, v]) => v > 0).map(([k, v]) => `
              <div class="sbar-line"><span class="l">${esc(titleCase(k))}</span><span class="v">${v}</span></div>`).join('')
            : emptyHTML('Nothing in flight', 'Applications appear here once Pokie starts applying.')}
        </div>
      </div>
    </div>`;
  }
  const statCard = (label, value, colour) => `
    <div class="stat"><div class="l">${esc(label)}</div><div class="v" style="color:${colour}">${esc(value)}</div></div>`;

  function screenJobs() {
    const s = slot('jobs');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('jobs')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const all = s.data || [];
    let list = all;
    if (state.jobFilter === 'scored') list = all.filter(j => j.score_state === 'scored');
    if (state.jobFilter === 'unscored') list = all.filter(j => j.score_state !== 'scored');
    list = [...list].sort(state.jobSort === 'score'
      ? (a, b) => (b.score ?? -1) - (a.score ?? -1)
      : (a, b) => Date.parse(b.posted_at || 0) - Date.parse(a.posted_at || 0));

    const sel = state.selectedJob && list.find(j => j.id === state.selectedJob)
      ? state.selectedJob : (list[0] && list[0].id) || null;
    if (sel !== state.selectedJob) state.selectedJob = sel;
    if (sel) loadJobDetail(sel);

    const counts = {
      all: all.length,
      scored: all.filter(j => j.score_state === 'scored').length,
      unscored: all.filter(j => j.score_state !== 'scored').length,
    };

    return `<div class="jobs ${state.mobileDetail ? 'show-detail' : ''}">
      <div class="jobs-head">
        <div class="jobs-head-top">
          <div class="mode-seg">
            ${['all', 'scored', 'unscored'].map(k => `
              <span class="${state.jobFilter === k ? 'on' : ''}" data-act="job-filter" data-v="${k}">
                ${titleCase(k)}<i class="ct">${counts[k]}</i></span>`).join('')}
          </div>
          <button class="sort-pill" data-act="job-sort">
            ${state.jobSort === 'score' ? 'Best fit' : 'Newest first'} ⌄
          </button>
        </div>
      </div>
      <div class="jobs-body">
        <div class="job-list">
          ${list.length ? list.map(j => jobRow(j, j.id === sel)).join('')
            : `<div style="padding:20px">${emptyHTML('No jobs here', 'Run a sweep to find some.')}</div>`}
        </div>
        <div class="job-detail">${sel ? jobDetail(sel) : emptyHTML('Pick a job')}</div>
      </div>
    </div>`;
  }

  function jobRow(j, on) {
    const c = scoreColour(j.score);
    const d = daysSince(j.posted_at);
    return `<button class="job-row" data-act="open-job" data-id="${esc(j.id)}"
        style="${on ? 'background:var(--panel-hov);border-left-color:' + PINK : ''}">
      <span class="job-av" style="background:${c}">${esc(initials(j.company))}</span>
      <span class="job-col">
        <span class="job-line1">
          <span class="job-role">${esc(j.title)}</span>
          <span class="job-score" style="color:${c}">${j.score == null ? '—' : Math.round(j.score)}</span>
        </span>
        <span class="job-co">${esc(j.company)} · ${esc(j.location || '—')}</span>
        <span class="job-line3">
          <span class="job-comp">${esc(j.salary || 'band unclear')}</span>
          ${d !== null ? `<span class="job-comp">· ${d === 0 ? 'today' : d + 'd old'}</span>` : ''}
          ${j.score_state !== 'scored'
            ? `<span class="job-note" style="color:${YELLOW};background:rgba(236,226,46,.14)">unscored</span>` : ''}
          ${j.ghost ? `<span class="job-note" style="color:${GREY};background:#1a1a1a">ghost</span>` : ''}
        </span>
      </span>
    </button>`;
  }

  function jobDetail(id) {
    const s = slot('job:' + id);
    if (s.loading && !s.data) return `<div class="jd-inner">${loadingHTML('the job')}</div>`;
    if (s.error) return `<div class="jd-inner">${errorHTML(s.error)}</div>`;
    const j = s.data;
    if (!j) return `<div class="jd-inner">${loadingHTML('the job')}</div>`;
    const c = scoreColour(j.score);
    const subs = j.subscores || null;
    const reqs = j.requirement_mapping || [];

    return `
      <div class="jd-inner">
        <button class="pill dim mob-back" data-act="back-list">← All jobs</button>
        <div class="jd-head">
          <div class="jd-av" style="background:${c}">${esc(initials(j.company))}</div>
          <div class="jd-tt">
            <div class="jd-role">${esc(j.title)}</div>
            <div class="jd-co">${esc(j.company)} · ${esc(j.location || '—')} · via ${esc(j.source || '—')}</div>
          </div>
          <div class="jd-score">
            <div class="n" style="color:${c}">${j.score == null ? '—' : Math.round(j.score)}</div>
            <div class="c">${j.score_state === 'scored' ? 'SCORE' : 'UNSCORED'}</div>
          </div>
        </div>
        <div class="tag-row">
          ${j.salary ? tag(j.salary, GREEN) : tag('band unclear', GREY)}
          ${j.remote ? tag('Remote', BLUE) : ''}
          ${j.employment_type ? tag(titleCase(j.employment_type), GREY) : ''}
          ${j.posted_at ? tag(ago(j.posted_at), GREY) : ''}
          ${j.repost_count ? tag('reposted ×' + j.repost_count, YELLOW) : ''}
        </div>

        ${subs ? `<div class="score-card">
          <div class="eyebrow">Why this score</div>
          ${Object.entries(subs).map(([k, v]) => `
            <div class="sbar">
              <div class="sbar-line"><span class="l">${esc(titleCase(k))}</span><span class="v" style="color:${scoreColour(v)}">${Math.round(v)}</span></div>
              <div class="bar-track"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${scoreColour(v)}"></i></div>
            </div>`).join('')}
        </div>` : ''}

        ${reqs.length ? `<div class="score-card">
          <div class="eyebrow">Requirements vs your evidence</div>
          ${reqs.map(r => `<div class="signal">
            <span class="m" style="color:${r.gap ? YELLOW : GREEN}">${r.gap ? '!' : '✓'}</span>
            <span class="t">${esc(r.requirement)}${r.gap ? ' — no evidence on file' : ''}</span>
          </div>`).join('')}
        </div>` : ''}

        ${(j.matched_skills || []).length || (j.missing_skills || []).length ? `
        <div class="two-col">
          <div class="score-card"><div class="eyebrow">Matched</div>
            ${(j.matched_skills || []).map(sk => `<div class="signal"><span class="m" style="color:${GREEN}">✓</span><span class="t">${esc(sk)}</span></div>`).join('') || '<div class="s dim">—</div>'}
          </div>
          <div class="score-card"><div class="eyebrow">Missing</div>
            ${(j.missing_skills || []).map(sk => `<div class="signal"><span class="m" style="color:${YELLOW}">!</span><span class="t">${esc(sk)}</span></div>`).join('') || '<div class="s dim">—</div>'}
          </div>
        </div>` : ''}

        <div class="read-card posting-card">
          <div class="eyebrow">The posting</div>
          <div class="raw">${esc(j.description || 'No description was captured for this posting.')}</div>
          ${j.url ? `<a class="link" href="${esc(j.url)}" target="_blank" rel="noopener">Open the original ↗</a>` : ''}
        </div>
      </div>
      <div class="jd-actions">
        <button class="pill primary" style="background:${PINK}" data-act="generate-docs" data-id="${esc(j.id)}">Draft an application</button>
        <button class="pill outline" data-act="dismiss-job" data-id="${esc(j.id)}">Not for me</button>
        ${j.apply_url ? `<a class="pill outline" href="${esc(j.apply_url)}" target="_blank" rel="noopener">Apply yourself ↗</a>` : ''}
        <span class="note">Drafting creates a review — nothing is sent without you.</span>
      </div>`;
  }
  const tag = (label, colour) =>
    `<span class="tag" style="color:${colour};border-color:${colour}33;background:${colour}14">${esc(label)}</span>`;

  function screenRun() {
    const src = slot('sources');
    const sw = slot('sweep');
    const running = sw.data && (sw.data.status === 'running' || sw.data.status === 'queued');
    return `<div class="pad run-page">
      ${pageHead('Live run', 'Trigger a real discovery sweep and watch it land.',
        running ? '' : `<button class="pill primary" style="background:${PINK}" data-act="sweep-now">Start a sweep</button>`)}

      ${sw.error ? errorHTML(sw.error) : ''}
      ${sw.data ? `
        <div class="run-status">
          <div style="display:flex;align-items:center;gap:14px">
            ${running ? '<span class="spinner"></span>' : `<span style="font-size:22px;color:${sw.data.status === 'completed' ? GREEN : PINK}">${sw.data.status === 'completed' ? '✓' : '!'}</span>`}
            <div style="display:flex;flex-direction:column;gap:2px">
              <span class="tt">Sweep ${esc(sw.data.sweep_id)} — ${esc(sw.data.status)}</span>
              <span class="ss">${sw.data.sources.length} source${sw.data.sources.length === 1 ? '' : 's'}${sw.data.started_at ? ' · started ' + ago(sw.data.started_at) : ''}</span>
            </div>
          </div>
          <div class="counter"><span class="v">${(sw.data.results || []).reduce((n, r) => n + (r.found || 0), 0)}</span></div>
        </div>
        ${(sw.data.results || []).length ? `<div class="steps-card">
          ${sw.data.results.map(r => `<div class="step-row">
            <span class="mk" style="color:${r.status === 'completed' ? GREEN : r.status === 'failed' ? PINK : BLUE}">${r.status === 'completed' ? '✓' : r.status === 'failed' ? '✕' : '•'}</span>
            <span><span class="tx">${esc(r.source)}</span><span class="dt">${esc(r.status)}</span></span>
            <span class="du">${r.found} found</span>
          </div>`).join('')}
        </div>` : ''}
      ` : emptyHTML('No sweep running', 'Start one and its per-source results appear here live.')}

      <div class="eyebrow" style="margin-top:8px">Sources Pokie will use</div>
      ${src.loading && !src.data ? loadingHTML('sources')
        : src.error ? errorHTML(src.error)
        : `<div class="steps-card">
            ${(src.data || []).filter(x => x.enabled).map(x => `<div class="step-row">
              <span class="mk" style="color:${x.health === 'healthy' ? GREEN : YELLOW}">${x.health === 'healthy' ? '✓' : '!'}</span>
              <span><span class="tx">${esc(x.name)}</span><span class="dt">${esc(titleCase(x.health))}${x.consecutive_failures ? ' · ' + x.consecutive_failures + ' failures' : ''}</span></span>
              <span class="du">${x.last_success_at ? ago(x.last_success_at) : 'never'}</span>
            </div>`).join('') || `<div style="padding:18px">${emptyHTML('No sources enabled', 'Turn some on in Sources.')}</div>`}
          </div>`}
    </div>`;
  }

  function screenApprove() {
    const s = slot('reviews');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('decisions')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const items = ((s.data && s.data.items) || []).filter(r => r.status === 'pending');
    const byJob = (s.data && s.data.byJob) || {};
    if (!items.length) {
      return `<div class="pad">${pageHead('Needs you', 'Drafts waiting on your call.')}
        ${emptyHTML('Nothing needs you', 'When Pokie drafts an application it lands here first.')}</div>`;
    }
    return `<div class="pad">
      ${pageHead('Needs you', items.length + ' waiting on your call.')}
      ${items.map(r => reviewCard(r, byJob[r.job_id])).join('')}
    </div>`;
  }

  function reviewCard(r, job) {
    const d = slot('review:' + r.id);
    if (!d.data && !d.loading && !d.error) loadReviewDetail(r.id);
    const doc = d.data && (d.data.docs || [])[0];
    return `<div class="draft-card">
      <div class="draft-meta">
        <div class="s">Draft for <b>${esc(job ? job.title : r.job_id)}</b>${job ? ' at ' + esc(job.company) : ''}</div>
        <div class="m">${esc(ago(r.created_at))}${d.data && d.data.revise_count ? ' · revised ×' + d.data.revise_count : ''}</div>
      </div>
      ${d.loading && !d.data ? loadingHTML('the draft')
        : d.error ? errorHTML(d.error)
        : doc ? `<div>
            <div class="eyebrow" style="margin-bottom:8px">${esc(titleCase(doc.doc_type))}</div>
            ${esc(doc.content).split('\n').filter(Boolean).map(l => `<div class="draft-line">${l}</div>`).join('')}
          </div>`
        : emptyHTML('No document on this review', 'Nothing was generated for it yet.')}
      ${d.data && d.data.note ? `<div class="why-point"><span class="m" style="color:${YELLOW}">◆</span><span class="t">${esc(d.data.note)}</span></div>` : ''}
      <div class="rc-actions">
        <button class="rc-primary" style="background:${GREEN}" data-act="review-approve" data-id="${esc(r.id)}">Approve</button>
        <button class="rc-secondary" data-act="review-revise" data-id="${esc(r.id)}">Ask for a revision</button>
        <button class="rc-secondary" data-act="review-reject" data-id="${esc(r.id)}">Reject</button>
      </div>
    </div>`;
  }

  function screenApplications() {
    const s = slot('applications');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('applications')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const d = s.data;
    if (!d) return `<div class="pad">${loadingHTML('applications')}</div>`;
    return `<div class="pad">
      ${pageHead('Applications', 'Everything Pokie has in flight.')}

      ${d.confirm.length ? `<div class="eyebrow">Waiting for your confirmation</div>
        ${d.confirm.map(q => {
          const j = d.byJob[q.job_id];
          return `<div class="draft-card">
          <div class="draft-meta">
            <div class="s">Pokie filled the form for <b>${esc(j ? j.title : q.job_id)}</b>${j ? ' at ' + esc(j.company) : ''}</div>
            <div class="m">${esc(ago(q.created_at))}</div>
          </div>
          <div class="kv">
            <div class="kv-row"><span class="k">State</span><span class="v">${esc(titleCase(q.state))}</span></div>
            ${j ? `<div class="kv-row"><span class="k">Location</span><span class="v">${esc(j.location || '—')}</span></div>` : ''}
            ${j && j.salary ? `<div class="kv-row"><span class="k">Band</span><span class="v">${esc(j.salary)}</span></div>` : ''}
            ${q.platform_class ? `<div class="kv-row"><span class="k">Platform</span><span class="v">${esc(titleCase(q.platform_class))}</span></div>` : ''}
          </div>
          <div class="rc-actions">
            <button class="rc-primary" style="background:${GREEN}" data-act="confirm-app" data-id="${esc(q.id)}">Submit it</button>
            <button class="rc-secondary" data-act="discard-app" data-id="${esc(q.id)}">Discard</button>
            ${j && j.apply_url ? `<a class="rc-secondary" href="${esc(j.apply_url)}" target="_blank" rel="noopener">Open the form ↗</a>` : ''}
          </div>
        </div>`; }).join('')}` : ''}

      <div class="eyebrow">Pipeline</div>
      <div class="board">
        ${d.board.filter(col => col.count > 0).map(col => `
          <div class="board-col">
            <div class="bc-head"><span>${esc(titleCase(col.state))}</span><span class="n">${col.count}</span></div>
            ${(col.applications || []).map(a => {
              const j = d.byJob[a.job_id];
              return `<div class="bc-card">
                <div class="t">${esc(j ? j.title : a.job_id)}</div>
                <div class="s">${esc(j ? j.company : '—')} · ${esc(ago(a.updated_at))}</div>
              </div>`; }).join('')}
          </div>`).join('') || emptyHTML('Nothing in the pipeline yet', 'Approved drafts become applications.')}
      </div>

      ${d.apps.length ? `<div class="eyebrow">All applications</div>
      <div class="day-card">
        ${d.apps.map(a => {
          const j = d.byJob[a.job_id];
          return `<div class="hist-row">
          <span class="tm">${esc(ago(a.created_at))}</span>
          <span class="actor" style="background:rgba(71,145,255,.16);color:${BLUE}">${esc(titleCase(a.state))}</span>
          <span><span class="tx">${esc(j ? j.title : a.job_id)}</span><span class="dt">${esc(j ? j.company : '')}${a.platform_class ? ' · ' + esc(titleCase(a.platform_class)) : ''}${a.nudge_count ? ' · nudged ×' + a.nudge_count : ''}</span></span>
          <span></span>
        </div>`; }).join('')}
      </div>` : ''}
    </div>`;
  }

  function screenMemory() {
    const s = slot('memory');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('memory')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const d = s.data;
    if (!d) return `<div class="pad">${loadingHTML('memory')}</div>`;
    return `<div class="pad">
      ${pageHead('Memory', 'What Pokie believes about you, and where each belief came from.')}

      ${d.proposals.length ? `
        <div class="eyebrow">Pokie wants to remember these</div>
        ${d.proposals.map(p => `<div class="belief">
          <div class="lv">
            <div class="lb">${esc(p.proposed_key || p.key || 'Proposal')}</div>
            <div class="vl">${esc(p.proposed_value || p.value || '')}</div>
            ${p.rationale ? `<div class="src">${esc(p.rationale)}</div>` : ''}
          </div>
          <div class="btns">
            <button class="mini-pill" data-act="prop-accept" data-id="${esc(p.id)}">Remember it</button>
            <button class="mini-pill" data-act="prop-reject" data-id="${esc(p.id)}">No</button>
          </div>
        </div>`).join('')}` : ''}

      ${memGroup('Facts', 'facts', d.facts)}
      ${memGroup('Preferences', 'preferences', d.prefs)}
    </div>`;
  }

  function memGroup(title, kind, items) {
    return `<div class="mem-group-head">
        <span class="l" style="color:${kind === 'facts' ? GREEN : BLUE}">${esc(title)}</span>
        <span class="s">${items.length}</span>
        <button class="mini-pill" data-act="mem-add" data-kind="${kind}">+ Add</button>
      </div>
      <div class="mem-grid">
        ${items.length ? items.map(m => {
          const editing = state.memEdit === kind + ':' + m.id;
          return `<div class="mem-card">
            <div class="lb">${esc(m.key)}</div>
            ${editing
              ? `<input class="teach-input" id="mem-in-${esc(kind)}-${esc(m.id)}" value="${esc(m.value)}">
                 <div class="btns">
                   <button class="mc-pill edit" data-act="mem-save" data-kind="${kind}" data-id="${esc(m.id)}" data-key="${esc(m.key)}">Save</button>
                   <button class="mc-pill edit" data-act="mem-cancel">Cancel</button>
                 </div>`
              : `<div class="tx">${esc(m.value)}</div>
                 <div class="src">updated ${esc(ago(m.updated_at || m.created_at))}</div>
                 <div class="btns">
                   <button class="mc-pill edit" data-act="mem-edit" data-kind="${kind}" data-id="${esc(m.id)}">Edit</button>
                   <button class="mc-pill forget" data-act="mem-forget" data-kind="${kind}" data-id="${esc(m.id)}">Forget</button>
                 </div>`}
          </div>`;
        }).join('') : emptyHTML('Nothing here yet', 'Add the first one.')}
      </div>`;
  }

  function screenSources() {
    const s = slot('sources');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('sources')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const items = s.data || [];
    return `<div class="pad">
      ${pageHead('Sources', 'Where Pokie looks, and whether each one is answering.')}
      <div class="day-card">
        ${items.map(x => `<div class="hist-row r3">
          <span class="actor" style="background:${x.health === 'healthy' ? 'rgba(28,225,95,.14)' : 'rgba(236,226,46,.16)'};color:${x.health === 'healthy' ? GREEN : YELLOW}">${esc(titleCase(x.health))}</span>
          <span><span class="tx">${esc(x.name)}</span><span class="dt">${x.last_success_at ? 'last ok ' + ago(x.last_success_at) : 'no successful run yet'}${x.consecutive_failures ? ' · ' + x.consecutive_failures + ' failures in a row' : ''}</span></span>
          <span style="display:flex;gap:8px;justify-content:flex-end">
            <button class="hist-act" style="color:${x.enabled ? GREY : GREEN};border-color:var(--bstrong)" data-act="source-toggle" data-id="${esc(x.id)}">${x.enabled ? 'Turn off' : 'Turn on'}</button>
            <button class="hist-act" style="color:${PINK};border-color:rgba(235,107,168,.32)" data-act="source-repair" data-id="${esc(x.id)}">Repair</button>
          </span>
        </div>`).join('') || `<div style="padding:20px">${emptyHTML('No sources registered')}</div>`}
      </div>
    </div>`;
  }

  function screenHistory() {
    const s = slot('history');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('history')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const days = s.data || [];
    return `<div class="pad">
      ${pageHead('History', 'Everything Pokie did, newest first.')}
      ${days.length ? days.map(d => `
        <div class="day-label">${esc(dayLabel(d.date))}</div>
        <div class="day-card">
          ${d.items.map(it => `<div class="hist-row">
            <span class="tm">${esc(timeOf(it.occurred_at))}</span>
            <span class="actor" style="background:${it.category === 'application' ? 'rgba(71,145,255,.16)' : 'rgba(235,107,168,.14)'};color:${it.category === 'application' ? BLUE : PINK}">${esc(it.category)}</span>
            <span><span class="tx">${esc(it.message)}</span>${it.job_id ? `<span class="dt">${esc(it.job_id)}</span>` : ''}</span>
            <span></span>
          </div>`).join('')}
        </div>`).join('')
        : emptyHTML('Nothing yet', 'Pokie logs every action it takes here.')}
    </div>`;
  }

  function screenVault() {
    const s = slot('vault');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('your vault')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const d = s.data;
    if (!d) return `<div class="pad">${loadingHTML('your vault')}</div>`;
    const FIELDS = [
      ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'],
      ['location', 'Location'], ['linkedin', 'LinkedIn'], ['portfolio', 'Portfolio'],
      ['notice_period', 'Notice period'], ['current_ctc', 'Current CTC'],
      ['expected_ctc', 'Expected CTC'], ['experience_years', 'Years of experience'],
      ['salary_min_india_lpa', 'CTC floor — India (LPA)'],
      ['salary_min_abroad_eur', 'CTC floor — abroad (EUR)'],
      ['work_authorization_india', 'Work authorization — India'],
      ['work_authorization_eu', 'Work authorization — EU'],
      ['work_authorization_us', 'Work authorization — US'],
    ];
    const gapSet = new Set(d.gaps.map(g => g.field));
    return `<div class="pad">
      ${pageHead('Vault', 'The facts Pokie fills forms with. Blanks block applications.',
        `<button class="pill primary" style="background:${PINK}" data-act="vault-save">Save changes</button>`)}
      ${d.gaps.filter(g => g.blocking).length ? `<div class="banner pink">
        <div class="t">${d.gaps.filter(g => g.blocking).length} blocking gap(s)</div>
        <div class="s">Pokie will not submit a form while these are empty.</div>
      </div>` : ''}
      <div class="mem-grid">
        ${FIELDS.map(([k, label]) => `
          <div class="mem-card ${gapSet.has(k) ? 'gap' : ''}">
            <div class="lb">${esc(label)}${gapSet.has(k) ? ' <span style="color:' + PINK + '">· required</span>' : ''}</div>
            <input class="teach-input" data-vault="${esc(k)}" value="${esc(d.profile[k] == null ? '' : d.profile[k])}" placeholder="—">
          </div>`).join('')}
      </div>

      <div class="eyebrow">Work evidence <span style="color:var(--t3)">${d.evidence.length}</span></div>
      <div class="day-card">
        ${d.evidence.length ? d.evidence.map(e => `<div class="hist-row r3">
          <span class="actor" style="background:#212121;color:${GREY}">${esc(e.company)}</span>
          <span><span class="tx">${esc(e.bullet_text)}</span><span class="dt">${esc(e.role || '')} ${esc(e.dates || '')}</span></span>
          <span></span>
        </div>`).join('') : `<div style="padding:20px">${emptyHTML('No evidence stored', 'Pokie cites these when it drafts.')}</div>`}
      </div>

      <div class="eyebrow">Answer bank <span style="color:var(--t3)">${d.qa.length}</span></div>
      <div class="day-card">
        ${d.qa.length ? d.qa.map(q => `<div class="hist-row r3">
          <span class="actor" style="background:#212121;color:${GREY}">Q</span>
          <span><span class="tx">${esc(q.question)}</span><span class="dt">${esc(q.answer)}</span></span>
          <span></span>
        </div>`).join('') : `<div style="padding:20px">${emptyHTML('No saved answers', 'Pokie reuses these on application forms.')}</div>`}
      </div>
    </div>`;
  }

  function screenSettings() {
    const s = slot('settings');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('settings')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const d = s.data;
    if (!d) return `<div class="pad">${loadingHTML('settings')}</div>`;
    // openapi.yaml FollowupMode is exactly [auto, draft_only]. Anything else
    // is rejected with a 422 by PUT /settings/safety.
    const MODES = [
      { v: 'auto', label: 'Auto-send' },
      { v: 'draft_only', label: 'Draft only' },
    ];
    return `<div class="pad">
      ${pageHead('Settings', 'What Pokie may do on its own, and what it costs.')}

      <div class="perm-card">
        <div class="perm-row" style="border-top:0">
          <div><div class="t">Auto-apply threshold</div><div class="s dim">Scores at or above this can go out without you.</div></div>
          <input class="teach-input num" data-set="auto_threshold" value="${esc(d.safety.auto_threshold)}">
        </div>
        <div class="perm-row">
          <div><div class="t">Daily cap</div><div class="s dim">Most applications Pokie sends in a day.</div></div>
          <input class="teach-input num" data-set="daily_cap" value="${esc(d.safety.daily_cap)}">
        </div>
        <div class="perm-row">
          <div><div class="t">Follow-ups</div><div class="s dim">Auto-send chases silence for ATS and email applications; draft only always leaves it for you to send.</div></div>
          <div class="seg">${MODES.map(m => `<span class="${d.safety.followup_mode === m.v ? 'on' : ''}" style="${d.safety.followup_mode === m.v ? 'background:#fff;color:#070707' : ''}" data-act="set-followup" data-v="${m.v}">${esc(m.label)}</span>`).join('')}</div>
        </div>
      </div>
      <button class="pill primary" style="background:${PINK};align-self:flex-start" data-act="save-safety">Save safety settings</button>

      <div class="eyebrow">Model routing</div>
      <div class="perm-card">
        ${Object.entries(d.routing).map(([k, v], i) => `
          <div class="perm-row" ${i === 0 ? 'style="border-top:0"' : ''}>
            <div><div class="t">${esc(titleCase(k))}</div></div>
            <input class="teach-input" data-route="${esc(k)}" value="${esc(v)}">
          </div>`).join('')}
      </div>
      <button class="pill primary" style="background:${PINK};align-self:flex-start" data-act="save-routing">Save model routing</button>

      <div class="two-col">
        <div class="score-card">
          <div class="eyebrow">Spend — ${esc(d.spend.period)}</div>
          <div class="sbar-line"><span class="l">LLM</span><span class="v">$${(d.spend.llm_usd_month || 0).toFixed(2)}</span></div>
          <div class="sbar-line"><span class="l">Proxy</span><span class="v">$${(d.spend.proxy_usd_month || 0).toFixed(2)}</span></div>
        </div>
        <div class="score-card">
          <div class="eyebrow">Background services</div>
          ${d.beats.map(b => `<div class="sbar-line">
            <span class="l">${esc(b.service)}</span>
            <span class="v" style="color:${b.healthy ? GREEN : PINK}">${b.healthy ? 'ok' : 'silent'}</span>
          </div>`).join('') || '<div class="s dim">None reporting.</div>'}
        </div>
      </div>

      <button class="pill outline" data-act="logout" style="align-self:flex-start">Sign out</button>
    </div>`;
  }

  function screenMore() {
    const rest = [
      { icon: '➤', label: 'Applications', key: 'applications' },
      { icon: '◈', label: 'Memory', key: 'memory' },
      { icon: '⊞', label: 'Sources', key: 'sources' },
      { icon: '⏱', label: 'History', key: 'history' },
      { icon: '▤', label: 'Vault', key: 'vault' },
      { icon: '⚙', label: 'Settings', key: 'settings' },
    ];
    return `<div class="pad">
      ${pageHead('More', 'The rest of Pokie.')}
      <div class="day-card">
        ${rest.map(r => `<button class="hist-row r3 more-row" data-act="go" data-screen="${r.key}">
          <span class="actor" style="background:#212121;color:${GREY}">${r.icon}</span>
          <span><span class="tx">${esc(r.label)}</span></span>
          <span style="color:var(--t3)">›</span>
        </button>`).join('')}
      </div>
    </div>`;
  }

  const SCREENS = {
    home: screenHome, jobs: screenJobs, run: screenRun, approve: screenApprove,
    applications: screenApplications, memory: screenMemory, sources: screenSources,
    history: screenHistory, vault: screenVault, settings: screenSettings,
    more: screenMore,
  };

  /* ================= data needed per screen ================= */
  function ensureData() {
    switch (state.screen) {
      case 'home': if (!slot('home').data && !slot('home').loading && !slot('home').error) loadHome(); break;
      case 'jobs': if (!slot('jobs').data && !slot('jobs').loading && !slot('jobs').error) loadJobs(); break;
      case 'run':
        if (!slot('sources').data && !slot('sources').loading && !slot('sources').error) loadSources();
        break;
      case 'approve': if (!slot('reviews').data && !slot('reviews').loading && !slot('reviews').error) loadReviews(); break;
      case 'applications': if (!slot('applications').data && !slot('applications').loading && !slot('applications').error) loadApplications(); break;
      case 'memory': if (!slot('memory').data && !slot('memory').loading && !slot('memory').error) loadMemory(); break;
      case 'sources': if (!slot('sources').data && !slot('sources').loading && !slot('sources').error) loadSources(); break;
      case 'history': if (!slot('history').data && !slot('history').loading && !slot('history').error) loadHistory(); break;
      case 'vault': if (!slot('vault').data && !slot('vault').loading && !slot('vault').error) loadVault(); break;
      case 'settings': if (!slot('settings').data && !slot('settings').loading && !slot('settings').error) loadSettings(); break;
    }
  }

  /* ================= render ================= */
  const app = () => $('#app'), mainEl = () => $('#main');
  function render() {
    const fn = SCREENS[state.screen] || screenHome;
    $('#rail').innerHTML = railHTML();
    $('#tabbar').innerHTML = tabbarHTML();
    mainEl().innerHTML = fn();
    app().classList.remove('cold');
  }

  function go(screen) {
    if (!SCREENS[screen]) screen = 'home';
    state.screen = screen;
    state.mobileDetail = false;
    if (location.hash.replace('#', '') !== screen) location.hash = screen;
    ensureData();
    render();
    mainEl().scrollTop = 0;
  }

  /* ================= actions ================= */
  const ACTIONS = {
    go: (el) => go(el.dataset.screen),
    reload: (el) => { delete store[el.dataset.screen]; store['home'] && delete store['home']; ensureData(); render(); },
    logout: () => { tokens.clear(); location.reload(); },

    'job-filter': (el) => { state.jobFilter = el.dataset.v; state.selectedJob = null; render(); },
    'job-sort': () => { state.jobSort = state.jobSort === 'score' ? 'newest' : 'score'; render(); },
    'open-job': (el) => {
      state.selectedJob = el.dataset.id;
      if (state.screen !== 'jobs') { state.screen = 'jobs'; location.hash = 'jobs'; ensureData(); }
      state.mobileDetail = true;
      loadJobDetail(el.dataset.id);
      render();
    },
    'back-list': () => { state.mobileDetail = false; render(); },

    'dismiss-job': async (el) => {
      const res = await api('/jobs/' + encodeURIComponent(el.dataset.id) + '/dismiss', {
        method: 'POST', body: JSON.stringify({ reason: 'not for me' }),
      });
      if (!res.ok) return toast('Could not dismiss: ' + res.error);
      toast('Dismissed. It will not come back.');
      delete store['jobs']; delete store['job:' + el.dataset.id]; delete store['home'];
      state.selectedJob = null; state.mobileDetail = false;
      ensureData(); render();
    },
    'generate-docs': async (el) => {
      const res = await api('/jobs/' + encodeURIComponent(el.dataset.id) + '/generate_docs', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not start a draft: ' + res.error);
      toast('Drafting — it will appear under Needs you.');
      delete store['reviews']; delete store['home'];
    },

    'sweep-now': async () => {
      const res = await api('/sweeps/trigger', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) return toast('Could not start a sweep: ' + res.error);
      state.sweepId = res.data.sweep_id;
      slot('sweep').data = res.data;
      toast('Sweep started.');
      go('run');
      pollSweep();
    },

    'review-approve': (el) => decideReview(el.dataset.id, 'approve'),
    'review-reject': (el) => decideReview(el.dataset.id, 'reject'),
    'review-revise': async (el) => {
      const note = prompt('What should Pokie change?');
      if (note == null || !note.trim()) return;
      const res = await api('/reviews/' + encodeURIComponent(el.dataset.id) + '/revise', {
        method: 'POST', body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) return toast('Revision failed: ' + res.error);
      toast('Asked for a revision.');
      delete store['reviews']; delete store['review:' + el.dataset.id];
      ensureData(); render();
    },

    'confirm-app': async (el) => {
      const res = await api('/applications/' + encodeURIComponent(el.dataset.id) + '/confirm', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not submit: ' + res.error);
      toast('Submitted.');
      delete store['applications']; delete store['home']; ensureData(); render();
    },
    'discard-app': async (el) => {
      const res = await api('/applications/' + encodeURIComponent(el.dataset.id) + '/discard', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not discard: ' + res.error);
      toast('Discarded.');
      delete store['applications']; delete store['home']; ensureData(); render();
    },

    'prop-accept': async (el) => {
      const res = await api('/memory/proposals/' + encodeURIComponent(el.dataset.id) + '/accept', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not accept: ' + res.error);
      toast('Remembered.');
      delete store['memory']; ensureData(); render();
    },
    'prop-reject': async (el) => {
      const res = await api('/memory/proposals/' + encodeURIComponent(el.dataset.id) + '/reject', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not reject: ' + res.error);
      toast('Dropped.');
      delete store['memory']; ensureData(); render();
    },
    'mem-edit': (el) => { state.memEdit = el.dataset.kind + ':' + el.dataset.id; render(); },
    'mem-cancel': () => { state.memEdit = null; render(); },
    'mem-save': async (el) => {
      const input = $(`#mem-in-${el.dataset.kind}-${el.dataset.id}`);
      if (!input) return;
      const res = await api(`/memory/${el.dataset.kind}/${encodeURIComponent(el.dataset.id)}`, {
        method: 'PUT', body: JSON.stringify({ key: el.dataset.key, value: input.value }),
      });
      if (!res.ok) return toast('Could not save: ' + res.error);
      state.memEdit = null; toast('Saved.');
      delete store['memory']; ensureData(); render();
    },
    'mem-forget': async (el) => {
      const res = await api(`/memory/${el.dataset.kind}/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
      if (!res.ok) return toast('Could not forget: ' + res.error);
      toast('Forgotten.');
      delete store['memory']; ensureData(); render();
    },
    'mem-add': async (el) => {
      const key = prompt('What should Pokie call this?');
      if (key == null || !key.trim()) return;
      const value = prompt('And the value?');
      if (value == null || !value.trim()) return;
      const res = await api('/memory/' + el.dataset.kind, {
        method: 'POST', body: JSON.stringify({ key: key.trim(), value: value.trim() }),
      });
      if (!res.ok) return toast('Could not add: ' + res.error);
      toast('Added.');
      delete store['memory']; ensureData(); render();
    },

    'source-toggle': async (el) => {
      const cur = (slot('sources').data || []).find(x => x.id === el.dataset.id);
      const res = await api('/sources/' + encodeURIComponent(el.dataset.id) + '/toggle', {
        method: 'POST', body: JSON.stringify({ enabled: !(cur && cur.enabled) }),
      });
      if (!res.ok) return toast('Could not toggle: ' + res.error);
      toast(cur && cur.enabled ? 'Source turned off.' : 'Source turned on.');
      delete store['sources']; ensureData(); render();
    },
    'source-repair': async (el) => {
      const res = await api('/sources/' + encodeURIComponent(el.dataset.id) + '/repair', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Repair failed: ' + res.error);
      toast('Repair requested.');
      delete store['sources']; ensureData(); render();
    },

    'set-followup': (el) => {
      const d = slot('settings').data;
      if (d) { d.safety.followup_mode = el.dataset.v; render(); }
    },
    'save-safety': async () => {
      const d = slot('settings').data; if (!d) return;
      const body = {
        auto_threshold: parseFloat($('[data-set="auto_threshold"]').value),
        daily_cap: parseInt($('[data-set="daily_cap"]').value, 10),
        followup_mode: d.safety.followup_mode,
      };
      const res = await api('/settings/safety', { method: 'PUT', body: JSON.stringify(body) });
      if (!res.ok) return toast('Could not save: ' + res.error);
      toast('Safety settings saved.');
      delete store['settings']; ensureData(); render();
    },
    'save-routing': async () => {
      const body = {};
      document.querySelectorAll('[data-route]').forEach(i => { body[i.dataset.route] = i.value; });
      const res = await api('/settings/model_routing', { method: 'PUT', body: JSON.stringify(body) });
      if (!res.ok) return toast('Could not save: ' + res.error);
      toast('Model routing saved.');
      delete store['settings']; ensureData(); render();
    },

    'vault-save': async () => {
      const body = {};
      document.querySelectorAll('[data-vault]').forEach(i => {
        const v = i.value.trim();
        body[i.dataset.vault] = v === '' ? null : v;
      });
      ['experience_years'].forEach(k => {
        if (body[k] != null) { const n = parseInt(body[k], 10); body[k] = isNaN(n) ? null : n; }
      });
      ['salary_min_india_lpa', 'salary_min_abroad_eur'].forEach(k => {
        if (body[k] != null) { const n = parseFloat(body[k]); body[k] = isNaN(n) ? null : n; }
      });
      const res = await api('/vault/profile', { method: 'PUT', body: JSON.stringify(body) });
      if (!res.ok) return toast('Could not save: ' + res.error);
      toast('Vault saved.');
      delete store['vault']; delete store['home']; ensureData(); render();
    },
  };

  async function decideReview(id, kind) {
    const res = await api('/reviews/' + encodeURIComponent(id) + '/' + kind, {
      method: 'POST', body: JSON.stringify({}),
    });
    if (!res.ok) return toast('That did not go through: ' + res.error);
    toast(kind === 'approve' ? 'Approved.' : 'Rejected.');
    delete store['reviews']; delete store['review:' + id]; delete store['home'];
    delete store['applications'];
    ensureData(); render();
  }

  async function pollSweep() {
    clearInterval(state.sweepPoll);
    if (!state.sweepId) return;
    const tick = async () => {
      const res = await api('/sweeps/' + encodeURIComponent(state.sweepId) + '/status');
      const s = slot('sweep');
      if (!res.ok) { s.error = res.error; clearInterval(state.sweepPoll); render(); return; }
      s.data = res.data; s.error = null;
      if (res.data.status === 'completed' || res.data.status === 'failed') {
        clearInterval(state.sweepPoll);
        state.sweepPoll = null;
        delete store['jobs']; delete store['home'];
        toast('Sweep ' + res.data.status + '.');
      }
      if (state.screen === 'run') render();
    };
    await tick();
    state.sweepPoll = setInterval(tick, 2500);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(el);
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    if (h && h !== state.screen) go(h);
  });

  /* ================= boot ================= */
  async function boot() {
    if (!tokens.get()) { showLogin(); return; }
    const h = location.hash.replace('#', '');
    state.screen = SCREENS[h] ? h : 'home';
    render();
    ensureData();
    // Badge counts and the signed-in identity the rail shows before you visit
    // those screens.
    const [rev, cq, props, prof] = await Promise.all([
      api('/reviews'), api('/applications/confirm_queue'), api('/memory/proposals'),
      api('/vault/profile'),
    ]);
    if (rev.ok) badges.reviews = (rev.data.items || []).filter(r => r.status === 'pending').length;
    if (cq.ok) badges.confirm = (cq.data.items || []).length;
    if (props.ok) badges.proposals = (props.data.items || []).filter(p => p.status === 'pending').length;
    if (prof.ok && prof.data) {
      badges.userName = prof.data.name || 'Signed in';
      badges.userEmail = prof.data.email || '';
    }
    render();
  }

  window.POKIE = { state, store, api, go, boot, logout: () => ACTIONS.logout() };
  boot();
})();
