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
  const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
    // Chat is home. Everything the app can do, it can do from here; the
    // dashboard is still one tap away, as 'overview'.
    screen: 'chat',
    jobFilter: 'all',      // all | scored | unscored | dismissed
    jobSort: 'score',      // score | newest
    selectedJob: null,
    mobileDetail: false,
    histCursor: null,
    sweepId: null,
    sweepPoll: null,
    backlogPoll: null,
    memEdit: null,
    // chat
    chatConv: null,        // active conversation id
    chatTypeId: null,      // id of the agent turn currently typing itself out
    chatTypeAt: 0,         // how many characters of it are revealed
    chatSending: false,    // a turn is in flight -> typing indicator
    chatDraft: '',         // composer text, preserved across re-renders
    // One flag drives the conversation list everywhere it appears: the
    // desktop sidebar panel AND the mobile header dropdown are the same
    // control conceptually, just rendered in two spots. Collapsed by default.
    chatListOpen: false,
    chatError: null,       // last send failure, shown in place
    reviewPick: {},   // review id -> chosen cv_version_id (not yet submitted)
    expandedDiff: {}, // cv_version_id -> bool, CV Lab diff-vs-default toggle
    // Role/keyword filter chip row (chat + vault). Collapsed by default;
    // roleFilterEdit is the working copy while the editor is open, discarded
    // on collapse or after a successful save (which re-fetches instead).
    roleFiltersOpen: false,
    roleFilterEdit: null,
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
      // Chat takes the home slot: it is the way you talk to Pokie, and it can
      // do everything the other screens can. Overview is the old dashboard.
      { icon: '◎', label: 'Chat', key: 'chat' },
      { icon: '▦', label: 'Overview', key: 'overview' },
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
      { icon: '✎', label: 'CV Lab', key: 'cvlab' },
      { icon: '⚙', label: 'Settings', key: 'settings' },
    ]},
  ];
  // Five slots, and the phone gets the same two-first ordering as the rail.
  // Live run moves into More rather than being dropped — it is still reachable,
  // just not one of the five things you reach for every day.
  const TABS = [
    { icon: '◎', label: 'Chat', key: 'chat' },
    { icon: '▦', label: 'Overview', key: 'overview' },
    { icon: '✦', label: 'Jobs', key: 'jobs' },
    { icon: '!', label: 'Needs you', key: 'approve', badgeKey: 'reviews' },
    { icon: '⋯', label: 'More', key: 'more' },
  ];

  // Badge counts come from real data once loaded; absent until then.
  const badges = {};

  // The "Needs you" badge counts BOTH things waiting on the user: drafts to
  // approve AND questions Pokie could not answer from its own data. An
  // unanswered question blocks a real application, so it cannot be the one
  // thing the badge stays silent about. The components are kept beside the
  // total so screens can still show them separately.
  function setNeedsYouBadge(reviewCount, escalationCount) {
    badges.reviewsOnly = reviewCount || 0;
    badges.escalations = escalationCount || 0;
    badges.reviews = badges.reviewsOnly + badges.escalations;
  }

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
            </button>
            ${it.key === 'chat' && state.screen === 'chat' ? railChatBlock() : ''}`).join('')}
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

  // Screens that actually have a store slot to refetch — every SCREENS key
  // except 'more', which is pure navigation and loads nothing of its own.
  const REFRESHABLE_SCREENS = new Set([
    'chat', 'overview', 'jobs', 'run', 'approve', 'applications', 'memory',
    'sources', 'history', 'vault', 'cvlab', 'settings',
  ]);

  // The desktop refresh control: one small icon button, same look and spot
  // on every screen that has data to refetch. Icon-only (not a labelled
  // pill) so it never risks pushing chat-top's or jobs-head-top's
  // non-wrapping flex rows into horizontal overflow on a narrow screen.
  function refreshBtn() {
    const busy = isScreenLoading();
    return `<button class="mini-pill" data-act="refresh" title="Refresh this screen"
        aria-label="Refresh this screen" ${busy ? 'disabled aria-busy="true"' : ''}
        style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
               padding:0;flex-shrink:0;${busy ? 'opacity:.55;' : ''}">
      <span aria-hidden="true" style="display:inline-block;font-size:15px;line-height:1;
        ${busy && !REDUCE_MOTION ? 'animation:pk-spin 1s linear infinite;' : ''}">⟳</span>
    </button>`;
  }

  function pageHead(title, sub, right) {
    return `<div class="page-head">
      <div><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${right || ''}
        ${REFRESHABLE_SCREENS.has(state.screen) ? refreshBtn() : ''}
      </div>
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

  async function loadOverview() {
    const s = slot('overview');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [jobs, reviews, funnel, spend, beats, gaps, cq, safety, esc, logins] = await Promise.all([
      api('/jobs?limit=200'), api('/reviews'), api('/pipeline/funnel_stats'),
      api('/system/spend'), api('/system/heartbeats'), api('/vault/gaps'),
      api('/applications/confirm_queue'), api('/settings/safety'),
      api('/escalations?status=pending'), api('/sources/login_challenges'),
    ]);
    s.loading = false;
    // `logins` is intentionally NOT in the error list: a paused browser login
    // is an extra prompt, never a reason to blank the whole home screen.
    const firstErr = [jobs, reviews, funnel, spend, beats, gaps, cq, safety, esc].find(r => !r.ok);
    if (firstErr) { s.error = firstErr.error; s.data = null; render(); return; }
    const items = jobs.data.items || [];
    s.data = {
      jobs: items,
      scored: items.filter(j => j.score_state === 'scored').length,
      unscored: items.filter(j => j.score_state !== 'scored').length,
      reviews: reviews.data.items || [],
      escalations: esc.data.items || [],
      funnel: funnel.data,
      spend: spend.data,
      beats: beats.data.items || [],
      gaps: (gaps.data.items || []).filter(g => g.blocking),
      confirm: cq.data.items || [],
      safety: safety.data,
      logins: logins.ok ? (logins.data.items || []) : [],
    };
    setNeedsYouBadge(s.data.reviews.length, s.data.escalations.length);
    badges.confirm = s.data.confirm.length;
    badges.gaps = s.data.gaps.length;
    render();
  }

  const loadJobs = () => load('jobs', '/jobs?limit=200', d => d.items || []);
  async function loadReviews() {
    const s = slot('reviews');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [rev, jobs, esc] = await Promise.all([
      api('/reviews'), api('/jobs?limit=200'), api('/escalations?status=pending'),
    ]);
    s.loading = false;
    if (!rev.ok) { s.error = rev.error; s.data = null; render(); return; }
    const byJob = {};
    if (jobs.ok) (jobs.data.items || []).forEach(j => { byJob[j.id] = j; });
    const items = rev.data.items || [];
    // A failed escalations read is NOT fatal to this screen: the drafts half is
    // still true and useful. The section reports its own error instead.
    const escalations = esc.ok ? (esc.data.items || []) : [];
    setNeedsYouBadge(items.filter(r => r.status === 'pending').length,
                     escalations.length);
    s.data = { items, byJob, escalations, escalationsError: esc.ok ? null : esc.error };
    render();
  }
  // Sources = health + any login challenge a paused browser login is waiting
  // on. The challenge fetch is deliberately NON-BLOCKING: if it fails, the
  // screen still shows every source's health rather than one big error.
  async function loadSources() {
    const s = slot('sources');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const [health, ch] = await Promise.all([
      api('/sources/health'), api('/sources/login_challenges'),
    ]);
    s.loading = false;
    if (!health.ok) { s.error = health.error; s.data = null; render(); return; }
    s.data = {
      items: health.data.items || [],
      challenges: ch.ok ? (ch.data.items || []) : [],
    };
    render();
  }
  const loadBacklog = () => load('backlog', '/jobs/score_backlog/status');
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

  const loadCvVersions = () => load('cvVersions', '/cv/versions', d => d.items || []);
  async function loadCvDiff(id) {
    const s = slot('cvdiff:' + id);
    if (s.loading || s.data) return;
    s.loading = true; s.error = null;
    const res = await api('/cv/versions/' + encodeURIComponent(id) + '/diff');
    s.loading = false;
    if (!res.ok) s.error = res.error; else s.data = res.data;
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

  /* ---- chat ----
   * Two slots: 'chat' is the conversation LIST (+ suggestion chips), and
   * 'chat:<id>' is one transcript. They are separate because sending a message
   * invalidates the transcript but not the list, and because the list has to be
   * on screen while a transcript is still loading.                          */
  async function loadChat() {
    const s = slot('chat');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const res = await api('/chat/conversations?limit=50');
    s.loading = false;
    if (!res.ok) { s.error = res.error; s.data = null; render(); return; }
    s.data = {
      convs: res.data.items || [],
      suggestions: res.data.suggestions || [],
    };
    // Land in the most recent conversation rather than an empty screen — the
    // list is newest-first, so item 0 is where the user left off.
    if (!state.chatConv && s.data.convs.length) {
      state.chatConv = s.data.convs[0].id;
    }
    if (state.chatConv) loadChatThread(state.chatConv);
    render();
  }

  async function loadChatThread(id, force) {
    const key = 'chat:' + id;
    const s = slot(key);
    if (s.loading || (s.data && !force)) return;
    s.loading = true; s.error = null;
    const res = await api('/chat/conversations/' + encodeURIComponent(id));
    s.loading = false;
    if (!res.ok) { s.error = res.error; s.data = null; }
    else s.data = res.data;
    render();
  }

  // Shared by the chat screen and the Vault: what Pokie is currently hunting
  // for. Backend may not have shipped this yet — a 404 (or any other error)
  // is kept in slot.error and shown honestly, never faked into an empty list.
  async function loadRoleFilters() {
    const s = slot('roleFilters');
    if (s.loading) return;
    s.loading = true; s.error = null;
    const res = await api('/vault/role_filters');
    s.loading = false;
    if (!res.ok) { s.error = res.error; s.data = null; render(); return; }
    s.data = {
      target_titles: res.data.target_titles || [],
      exclude_keywords: res.data.exclude_keywords || [],
      source: res.data.source || null,
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

  function screenOverview() {
    const s = slot('overview');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('your hunt')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    if (!s.data) return `<div class="pad">${loadingHTML('your hunt')}</div>`;
    const d = s.data;
    const top = [...d.jobs]
      .filter(j => j.score != null)
      .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const beatsDown = d.beats.filter(b => !b.healthy).length;
    const balance = d.spend.balance_usd;
    const floor = (d.safety && d.safety.llm_balance_floor_usd) || 0;
    const balanceLow = balance != null && floor > 0 && balance < floor;

    return `<div class="pad home">
      ${pageHead('Your hunt', 'Everything below is live from the backend.',
        `<button class="pill primary" style="background:${PINK}" data-act="sweep-now">Run a sweep</button>`)}

      <div class="stat-grid">
        ${statCard('Jobs found', d.jobs.length, '#fff')}
        ${statCard('Scored', d.scored, GREEN)}
        ${statCard('Unscored', d.unscored, d.unscored ? YELLOW : GREY)}
        ${statCard('Needs you', d.reviews.length + d.escalations.length,
                   (d.reviews.length + d.escalations.length) ? YELLOW : GREY)}
        ${statCard('In flight', d.funnel.total, BLUE)}
        ${statCard('Balance', balance == null ? '—' : '$' + balance.toFixed(2),
          balanceLow ? PINK : '#fff',
          'used $' + (d.spend.used_month_usd || 0).toFixed(2) + ' this mo')}
      </div>

      ${balanceLow ? `<div class="banner pink">
        <div class="t">Balance low — unattended AI work is paused</div>
        <div class="s">DeepSeek balance is $${balance.toFixed(2)}, below the $${floor.toFixed(2)} floor set in Settings.</div>
        <button class="pill outline" data-act="go" data-screen="settings">Open settings</button>
      </div>` : ''}

      ${d.gaps.length ? `<div class="banner pink">
        <div class="t">${d.gaps.length} blocking gap${d.gaps.length > 1 ? 's' : ''} in your vault</div>
        <div class="s">${esc(d.gaps.map(g => g.label).join(' · '))}</div>
        <button class="pill outline" data-act="go" data-screen="vault">Fill them in</button>
      </div>` : ''}

      ${d.escalations.length ? `<div class="banner yellow">
        <div class="t">${d.escalations.length} question${d.escalations.length > 1 ? 's' : ''} Pokie could not answer</div>
        <div class="s">${esc(d.escalations[0].question)}${d.escalations.length > 1 ? ' …' : ''}</div>
        <button class="pill outline" data-act="go" data-screen="approve">Answer them</button>
      </div>` : ''}

      ${d.logins.length ? `<div class="banner pink">
        <div class="t">A login needs your code</div>
        <div class="s">${esc(d.logins.map(c => c.source).join(', '))} — Pokie signed in and the site asked for a verification code. It is holding the page open for a few minutes.</div>
        <button class="pill outline" data-act="go" data-screen="sources">Enter the code</button>
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
  const statCard = (label, value, colour, sub) => `
    <div class="stat"><div class="l">${esc(label)}</div><div class="v" style="color:${colour}">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

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
          <div style="display:flex;align-items:center;gap:8px;">
            ${refreshBtn()}
            <button class="sort-pill" data-act="job-sort">
              ${state.jobSort === 'score' ? 'Best fit' : 'Newest first'} ⌄
            </button>
          </div>
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

  // One scoring pass, in the same visual language as the per-source rows.
  // Every count is the backend's own: 'failed' means the LLM call failed and
  // the job stayed honestly unscored — nothing was invented for it.
  function scoringCard(sc, heading) {
    const rows = [
      ['Scored', sc.scored, GREEN],
      ['Gated out before any LLM call', sc.gated_out, GREY],
      ['Failed — still unscored', sc.unscored, sc.unscored ? YELLOW : GREY],
    ];
    return `<div class="eyebrow" style="margin-top:8px">${esc(heading)}</div>
      <div class="steps-card">
        ${sc.skipped_reason ? `<div class="step-row">
          <span class="mk" style="color:${YELLOW}">!</span>
          <span><span class="tx">Stopped</span><span class="dt">${esc(sc.skipped_reason)}</span></span>
          <span class="du"></span>
        </div>` : ''}
        ${rows.map(([label, n, colour]) => `<div class="step-row">
          <span class="mk" style="color:${colour}">•</span>
          <span><span class="tx">${esc(label)}</span></span>
          <span class="du">${esc(n == null ? 0 : n)}</span>
        </div>`).join('')}
        ${sc.remaining_unscored == null ? '' : `<div class="step-row">
          <span class="mk" style="color:${sc.remaining_unscored ? YELLOW : GREEN}">•</span>
          <span><span class="tx">Still waiting to be scored</span></span>
          <span class="du">${esc(sc.remaining_unscored)}</span>
        </div>`}
      </div>`;
  }

  function screenRun() {
    const src = slot('sources');
    const sw = slot('sweep');
    const bl = slot('backlog');
    const jobs = slot('jobs').data || [];
    const unscored = jobs.filter(j => j.score_state !== 'scored').length;
    const scoring = bl.data && bl.data.running;
    const running = sw.data && (sw.data.status === 'running' || sw.data.status === 'queued');
    return `<div class="pad run-page">
      ${pageHead('Live run', 'Trigger a real discovery sweep and watch it land.',
        running ? '' : `<button class="pill primary" style="background:${PINK}" data-act="sweep-now">Start a sweep</button>`)}

      ${unscored && !scoring ? `<div class="banner yellow">
        <div class="t">${unscored} job${unscored > 1 ? 's have' : ' has'} no score yet</div>
        <div class="s">Scoring reads each one against your vault. Sweeps do it automatically; this catches up on the backlog.</div>
        <button class="pill outline" data-act="score-backlog">Score backlog</button>
      </div>` : ''}
      ${bl.error ? errorHTML(bl.error) : ''}
      ${bl.data && (scoring || bl.data.selected || bl.data.skipped_reason) ? `
        <div class="run-status">
          <div style="display:flex;align-items:center;gap:14px">
            ${scoring ? '<span class="spinner"></span>' : `<span style="font-size:22px;color:${GREEN}">✓</span>`}
            <div style="display:flex;flex-direction:column;gap:2px">
              <span class="tt">Backlog scoring — ${scoring ? 'running' : 'finished'}</span>
              <span class="ss">${esc(bl.data.selected)} job${bl.data.selected === 1 ? '' : 's'} picked up so far</span>
            </div>
          </div>
          <div class="counter"><span class="v">${esc(bl.data.scored)}</span></div>
        </div>
        ${scoringCard(bl.data, 'This backlog run')}` : ''}

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
        ${sw.data.scoring ? scoringCard(sw.data.scoring, 'Scoring after this sweep') : ''}
      ` : emptyHTML('No sweep running', 'Start one and its per-source results appear here live.')}

      <div class="eyebrow" style="margin-top:8px">Sources Pokie will use</div>
      ${src.loading && !src.data ? loadingHTML('sources')
        : src.error ? errorHTML(src.error)
        : `<div class="steps-card">
            ${(((src.data || {}).items) || []).filter(x => x.enabled).map(x => `<div class="step-row">
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
    const questions = (s.data && s.data.escalations) || [];
    const questionsError = s.data && s.data.escalationsError;
    const waiting = items.length + questions.length;

    // Questions come FIRST: an unanswered one is blocking an application that
    // is already half-filled, and answering it is also what teaches Pokie not
    // to ask again.
    const questionsHTML = questionsError
      ? `<div class="eyebrow">Questions for you</div>${errorHTML(questionsError, 'approve')}`
      : questions.length
        ? `<div class="eyebrow">Questions for you</div>
           ${questions.map(escalationCard).join('')}`
        : '';

    if (!waiting && !questionsError) {
      return `<div class="pad">${pageHead('Needs you', 'Drafts and questions waiting on your call.')}
        ${emptyHTML('Nothing needs you', 'Drafts to approve and questions Pokie cannot answer both land here.')}</div>`;
    }
    return `<div class="pad">
      ${pageHead('Needs you', waiting + ' waiting on your call.')}
      ${questionsHTML}
      ${items.length ? `<div class="eyebrow">Drafts to approve</div>` : ''}
      ${items.map(r => reviewCard(r, byJob[r.job_id])).join('')}
    </div>`;
  }

  function escalationCard(e) {
    // Pokie asks only what it could not answer from the vault, the Q&A bank,
    // memory or its work evidence — and the answer given here is remembered, so
    // the same question is never asked again.
    const where = e.job_title
      ? esc(e.job_title) + (e.company ? ' at ' + esc(e.company) : '')
      : esc(e.job_id || 'an application');
    return `<div class="draft-card">
      <div class="draft-meta">
        <div class="s">Pokie needs an answer for <b>${where}</b></div>
        <div class="m">${esc(ago(e.created_at))}${e.field_name ? ' · ' + esc(e.field_name) : ''}</div>
      </div>
      <div class="draft-line">${esc(e.question)}</div>
      <input class="teach-input" id="esc-in-${esc(e.id)}" placeholder="Your answer"
             autocomplete="off">
      <div class="rc-actions">
        <button class="rc-primary" style="background:${GREEN}"
                data-act="answer-escalation" data-id="${esc(e.id)}">Answer it</button>
      </div>
    </div>`;
  }

  function variantName(id) {
    const items = (slot('cvVersions').data || []);
    const v = items.find(x => String(x.id) === String(id));
    return v ? v.name : null;
  }

  function reviewCard(r, job) {
    const d = slot('review:' + r.id);
    if (!d.data && !d.loading && !d.error) loadReviewDetail(r.id);
    const needsVariant = !!(d.data && d.data.needs_variant_choice);
    if (needsVariant && !slot('cvVersions').data && !slot('cvVersions').loading) loadCvVersions();
    const doc = d.data && (d.data.docs || []).find(x => x.doc_type === 'cv');
    const picked = state.reviewPick[r.id];
    const variantPool = slot('cvVersions').data || [];

    return `<div class="draft-card">
      <div class="draft-meta">
        <div class="s">Draft for <b>${esc(job ? job.title : r.job_id)}</b>${job ? ' at ' + esc(job.company) : ''}</div>
        <div class="m">${esc(ago(r.created_at))}${d.data && d.data.revise_count ? ' · revised ×' + d.data.revise_count : ''}</div>
      </div>
      ${d.loading && !d.data ? loadingHTML('the draft')
        : d.error ? errorHTML(d.error)
        : doc ? `<div>
            <div class="eyebrow" style="margin-bottom:2px">CV${doc.cv_version_id && variantName(doc.cv_version_id) ? ' — ' + esc(variantName(doc.cv_version_id)) : ''}</div>
            ${doc.file_path ? `<div class="s dim" style="margin-bottom:8px">${esc(doc.file_path.split('/').pop())}</div>` : ''}
            ${esc(doc.content).split('\n').filter(Boolean).slice(0, 12).map(l => `<div class="draft-line">${l}</div>`).join('')}
          </div>`
        : needsVariant
          ? `<div class="why-point"><span class="m" style="color:${YELLOW}">◆</span><span class="t">This job scored high enough to pick a CV variant yourself — choose one below, then approve.</span></div>`
          : emptyHTML('No document on this review', 'Nothing was generated for it yet.')}
      ${d.data && d.data.note ? `<div class="why-point"><span class="m" style="color:${YELLOW}">◆</span><span class="t">${esc(d.data.note)}</span></div>` : ''}

      ${needsVariant ? `<div style="margin-top:10px">
        <div class="s dim" style="margin-bottom:6px">Pick a CV variant:</div>
        ${variantPool.length ? `<div class="seg" style="flex-wrap:wrap">
          ${variantPool.map(v => `<span class="${String(picked) === String(v.id) ? 'on' : ''}"
              style="${String(picked) === String(v.id) ? 'background:#fff;color:#070707' : ''}"
              data-act="pick-variant" data-id="${esc(r.id)}" data-variant="${esc(v.id)}">${esc(v.name)}</span>`).join('')}
        </div>` : (slot('cvVersions').loading
          ? loadingHTML('variants')
          : `<div class="s dim">No variants generated yet — Approve uses the default CV. Generate them from <b>CV Lab</b>.</div>`)}
      </div>` : ''}

      <div class="rc-actions">
        <button class="rc-primary" style="background:${GREEN}" data-act="review-approve" data-id="${esc(r.id)}"
          ${needsVariant && !picked && variantPool.length ? 'disabled title="Pick a CV variant first"' : ''}>Approve</button>
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

  // The real state of one source, in the colour the rest of the app already
  // uses: green = answering, pink = it needs YOU, yellow = degraded/expired,
  // grey = deliberately off.
  const SOURCE_TONE = {
    healthy: GREEN, needs_login: PINK, session_expired: YELLOW,
    degraded: YELLOW, disabled: GREY,
  };
  const sourceTone = (health) => SOURCE_TONE[health] || YELLOW;
  const SOURCE_LABEL = {
    healthy: 'Healthy', needs_login: 'Needs login',
    session_expired: 'Session expired', degraded: 'Degraded', disabled: 'Off',
  };

  function screenSources() {
    const s = slot('sources');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('sources')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const items = (s.data && s.data.items) || [];
    const challenges = (s.data && s.data.challenges) || [];
    const bySource = {};
    challenges.forEach(c => { if (!bySource[c.source]) bySource[c.source] = c; });
    return `<div class="pad">
      ${pageHead('Sources', 'Where Pokie looks, and whether each one is answering.')}
      ${challenges.length ? `<div class="banner pink" style="margin-bottom:18px">
        <div class="t">${challenges.length === 1 ? 'A login needs your code' : challenges.length + ' logins need your code'}</div>
        <div class="s">Type the code the site sent you next to the source below. Pokie is holding the page open.</div>
      </div>` : ''}
      <div class="day-card">
        ${items.map(x => {
          const tone = sourceTone(x.health);
          const ch = bySource[x.id];
          return `<div class="hist-row r3">
          <span class="actor" style="background:${tone}22;color:${tone}">${esc(SOURCE_LABEL[x.health] || titleCase(x.health))}</span>
          <span><span class="tx">${esc(x.name)}</span><span class="dt">${x.last_success_at ? 'last ok ' + ago(x.last_success_at) : 'no successful run yet'}${x.consecutive_failures ? ' · ' + x.consecutive_failures + ' failures in a row' : ''}</span></span>
          <span style="display:flex;gap:8px;justify-content:flex-end">
            <button class="hist-act" style="color:${x.enabled ? GREY : GREEN};border-color:var(--bstrong)" data-act="source-toggle" data-id="${esc(x.id)}">${x.enabled ? 'Turn off' : 'Turn on'}</button>
            <button class="hist-act" style="color:${PINK};border-color:rgba(235,107,168,.32)" data-act="source-repair" data-id="${esc(x.id)}">${x.health === 'needs_login' ? 'Log in' : 'Repair'}</button>
          </span>
        </div>${ch ? `<div class="hist-row r3">
          <span class="actor" style="background:${PINK}22;color:${PINK}">Code</span>
          <span><span class="tx">${esc(ch.question)}</span><span class="dt">asked ${esc(ago(ch.created_at))} · Pokie stops waiting a few minutes after that</span></span>
          <span style="display:flex;gap:8px;justify-content:flex-end">
            <input class="teach-input" id="otp-in-${esc(ch.id)}" style="width:130px" placeholder="Code" autocomplete="one-time-code">
            <button class="hist-act" style="color:${PINK};border-color:rgba(235,107,168,.32)" data-act="source-otp" data-id="${esc(ch.id)}">Send code</button>
          </span>
        </div>` : ''}`;
        }).join('') || `<div style="padding:20px">${emptyHTML('No sources registered')}</div>`}
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
      ${roleFiltersRow(true)}
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

  function screenCvLab() {
    const s = slot('cvVersions');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('the CV variant pool')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error)}</div>`;
    const items = s.data || [];
    return `<div class="pad">
      ${pageHead('CV Lab', 'Named content variants of your CV — one gets picked (or auto-picked) per job.',
        `<div style="display:flex;gap:8px">
          <button class="pill outline" data-act="improve-variants">Improve from feedback</button>
          <button class="pill primary" style="background:${PINK}" data-act="generate-variants">Generate variants</button>
        </div>`)}
      ${items.length
        ? `<div class="perm-card">${items.map((v, i) => cvVariantRow(v, i === 0)).join('')}</div>`
        : emptyHTML('No variants yet', 'Generate variants to seed the pool from your master CV.')}
    </div>`;
  }

  function cvVariantRow(v, first) {
    const expanded = !!state.expandedDiff[v.id];
    if (expanded) loadCvDiff(v.id);
    const diffSlot = slot('cvdiff:' + v.id);
    return `<div class="perm-row" ${first ? 'style="border-top:0"' : ''}>
      <div style="flex:1;min-width:0">
        <div class="t">${esc(v.name)}${v.is_default ? ` <span class="tag" style="color:${GREEN};border-color:${GREEN}33;background:${GREEN}14">default</span>` : ''}</div>
        <div class="s dim">${v.usage_count} sent · reply rate ${v.reply_rate == null ? '—' : Math.round(v.reply_rate * 100) + '%'}${v.note ? ' · ' + esc(v.note) : ''}</div>
        ${expanded ? `<div style="margin-top:8px">
          ${diffSlot.loading && !diffSlot.data ? loadingHTML('the diff')
            : diffSlot.error ? errorHTML(diffSlot.error)
            : (diffSlot.data && diffSlot.data.items.length
              ? diffSlot.data.items.map(d => `<div class="signal">
                  <span class="m" style="color:${d.op === 'cut' || d.op === 'rejected' ? YELLOW : GREEN}">${d.op === 'cut' ? '−' : d.op === 'add' ? '+' : '~'}</span>
                  <span class="t">${esc(d.text)}${d.reason ? ` <span class="dim">(${esc(d.reason)})</span>` : ''}</span>
                </div>`).join('')
              : '<div class="s dim">Identical to Default.</div>')}
        </div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="pill dim" data-act="toggle-variant-diff" data-id="${esc(v.id)}">${expanded ? 'Hide diff' : 'View diff'}</button>
        ${!v.is_default ? `<button class="pill outline" data-act="set-default-variant" data-id="${esc(v.id)}">Set default</button>` : ''}
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
          <div><div class="t">Daily scoring cap</div><div class="s dim">Most jobs Pokie will score in a day — one LLM call each. Separate from the send cap above.</div></div>
          <input class="teach-input num" data-set="score_daily_cap" value="${esc(d.safety.score_daily_cap)}">
        </div>
        <div class="perm-row">
          <div><div class="t">Follow-ups</div><div class="s dim">Auto-send chases silence for ATS and email applications; draft only always leaves it for you to send.</div></div>
          <div class="seg">${MODES.map(m => `<span class="${d.safety.followup_mode === m.v ? 'on' : ''}" style="${d.safety.followup_mode === m.v ? 'background:#fff;color:#070707' : ''}" data-act="set-followup" data-v="${m.v}">${esc(m.label)}</span>`).join('')}</div>
        </div>
        <div class="perm-row">
          <div><div class="t">Balance floor</div><div class="s dim">Pause unattended AI work when the DeepSeek balance drops below this (USD). 0 disables it.</div></div>
          <input class="teach-input num" data-set="llm_balance_floor_usd" value="${esc(d.safety.llm_balance_floor_usd)}">
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
          ${Object.entries(d.spend.by_task || {}).map(([k, v]) => `
            <div class="sbar-line"><span class="l dim">${esc(titleCase(k))}</span><span class="v">$${(v || 0).toFixed(2)}</span></div>`).join('')}
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
      // Live run lost its tab slot to Overview; it is still one tap away, and
      // a screen you cannot reach is a screen that does not exist.
      { icon: '⟳', label: 'Live run', key: 'run' },
      { icon: '➤', label: 'Applications', key: 'applications' },
      { icon: '◈', label: 'Memory', key: 'memory' },
      { icon: '⊞', label: 'Sources', key: 'sources' },
      { icon: '⏱', label: 'History', key: 'history' },
      { icon: '▤', label: 'Vault', key: 'vault' },
      { icon: '✎', label: 'CV Lab', key: 'cvlab' },
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

  /* ================= chat ================= */

  // Markdown-lite, and lite on purpose: line breaks and bold, nothing else.
  // ESCAPING HAPPENS FIRST and unconditionally — the model's output is
  // untrusted text, and a chat that renders whatever an LLM emits is an XSS
  // hole with a personality. Only these two patterns are re-introduced, over
  // already-escaped text, so no tag can survive from the source.
  const mdLite = (s) => esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');

  const convLabel = (c) =>
    (c.title && c.title.trim()) ? c.title : 'Untitled chat';

  function chatBlock(b) {
    const p = b.payload || {};
    if (b.type === 'text') {
      return `<div class="a-text md">${mdLite(p.text || '')}</div>`;
    }
    if (b.type === 'tool_call') {
      // Deliberately NOT clickable: it is a receipt of what Pokie did, and a
      // control that looks tappable but does nothing is the thing this app
      // does not ship.
      const colour = p.ok === false ? PINK : p.pending ? YELLOW : p.writes ? GREEN : GREY;
      return `<div class="tool-round">
        <span class="mk" style="color:${colour}">${p.ok === false ? '✕' : p.pending ? '⏸' : '✓'}</span>
        <span class="nm">${esc(p.tool || 'tool')}</span>
        <span class="sm">${esc(p.error || p.summary || '')}</span>
        ${p.writes ? `<span class="wr" style="color:${GREEN}">write</span>` : ''}
      </div>`;
    }
    if (b.type === 'job_list') {
      const items = p.items || [];
      if (!items.length) return '';
      return `<div class="score-card">
        ${items.map(j => `
          <button class="mini-job" data-act="open-job" data-id="${esc(j.id)}">
            <span class="job-av" style="background:${scoreColour(j.score)};width:34px;height:34px;border-radius:11px;font-size:13px">${esc(initials(j.company))}</span>
            <span class="mj-col">
              <span class="mj-role">${esc(j.title)}</span>
              <span class="mj-co">${esc(j.company)} · ${esc(j.location || '—')}</span>
            </span>
            <span class="job-score" style="color:${scoreColour(j.score)}">${j.score == null ? '—' : Math.round(j.score)}</span>
          </button>`).join('')}
        ${p.total && p.total > items.length
          ? `<div class="s dim">…and ${p.total - items.length} more.</div>` : ''}
      </div>`;
    }
    if (b.type === 'confirm') return confirmBlock(b, p);
    // An unknown block type is skipped rather than guessed at — a future
    // block kind must not render as garbage in an old client.
    return '';
  }

  function confirmBlock(b, p) {
    const preview = p.preview || [];
    const resolved = b.status && b.status !== 'pending';
    return `<div class="confirm-card ${resolved ? 'done' : ''}">
      <div class="cc-top">
        <span class="cc-tag" style="color:${resolved ? GREY : YELLOW}">
          ${resolved ? esc(titleCase(b.status)) : 'Needs your say-so'}</span>
        <span class="cc-n">${p.matched_count == null ? '' : p.matched_count + ' item' + (p.matched_count === 1 ? '' : 's')}</span>
      </div>
      <div class="cc-title">${esc(p.summary || 'Pokie wants to do something')}</div>
      ${p.preview_error ? `<div class="cc-warn">Could not resolve what this would touch: ${esc(p.preview_error)}</div>` : ''}
      ${preview.length ? `<div class="kv">
        ${preview.slice(0, 8).map(i => `<div class="kv-row">
          <span class="k">${esc(i.title || i.job_id || i.id || '—')}</span>
          <span class="v">${esc(i.company || i.state || '')}</span>
        </div>`).join('')}
        ${preview.length > 8 || p.truncated
          ? `<div class="kv-row"><span class="k">…and more</span><span class="v"></span></div>` : ''}
      </div>` : ''}
      ${resolved ? '' : `<div class="rc-actions">
        <button class="rc-primary" style="background:${GREEN}" data-act="chat-confirm" data-id="${esc(b.id)}">Do it</button>
        <button class="rc-secondary" data-act="chat-cancel" data-id="${esc(b.id)}">Cancel</button>
      </div>`}
    </div>`;
  }

  function chatTurn(m) {
    if (m.role === 'user') {
      return `<div class="u-bubble">${mdLite(m.text || '')}</div>`;
    }
    const blocks = (m.blocks || []).map(chatBlock).join('');
    // While this turn is typing itself out we render PLAIN text up to the
    // revealed length, not markdown: half-parsed markdown flickers as the
    // characters arrive. The full markdown render lands the moment it
    // finishes. The .typing marker is deliberate — every wait in the app and
    // in tests/e2e_chat_rig.js already treats it as "not settled yet", so the
    // reveal is covered by those waits for free.
    if (m.id === state.chatTypeId) {
      // The prose is the LAST text block, not m.text — a turn is usually a
      // tool receipt, then cards, then the sentence about them. Everything
      // before that sentence renders normally; only the sentence types.
      const list = m.blocks || [];
      let lastText = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].type === 'text') { lastText = i; break; }
      }
      const before = list.slice(0, lastText === -1 ? list.length : lastText)
        .map(chatBlock).join('');
      const full = lastText === -1 ? (m.text || '')
        : ((list[lastText].payload || {}).text || '');
      return `<div class="a-turn">
        <span class="a-mark">${mark(22)}</span>
        <div class="a-body">
          ${before}
          <div class="a-text md"><span id="chat-typing-node">${esc(full.slice(0, state.chatTypeAt))}</span><span
            class="typing" style="display:inline-block;width:7px;height:15px;
            vertical-align:-2px;margin-left:2px;background:${PINK};
            border-radius:2px;opacity:.85"></span></div>
        </div>
      </div>`;
    }
    return `<div class="a-turn">
      <span class="a-mark">${mark(22)}</span>
      <div class="a-body">
        ${blocks || `<div class="a-text md">${mdLite(m.text || '')}</div>`}
        ${m.status === 'error' ? `<div class="cc-warn">That turn did not finish cleanly.</div>` : ''}
      </div>
    </div>`;
  }

  const typingHTML = () => `<div class="a-turn">
      <span class="a-mark">${mark(22)}</span>
      <div class="a-body"><div class="typing"><i></i><i></i><i></i></div></div>
    </div>`;

  function chatComposer(suggestions) {
    return `<div class="chat-composer-outer">
      ${state.chatError ? `<div class="cc-warn">${esc(state.chatError)}</div>` : ''}
      ${suggestions.length ? `<div class="chip-row">
        ${suggestions.slice(0, 5).map(s => `
          <button class="sug-chip" data-act="chat-suggest" data-text="${esc(s.text || s.label)}">${esc(s.label)}</button>`).join('')}
      </div>` : ''}
      <div class="chat-composer">
        <textarea id="chat-input" rows="1" placeholder="Ask Pokie anything, or tell it what to change…"
          ${state.chatSending ? 'disabled' : ''}></textarea>
        <button class="send-dot" data-act="chat-send" title="Send"
          ${state.chatSending ? 'disabled' : ''}>↑</button>
      </div>
      <div class="chat-hint">Enter sends · Shift+Enter for a new line. Pokie acts on what you say; only a real submission or a bulk change over 10 rows asks first.</div>
    </div>`;
  }

  // The list body — "+ New chat" pinned at the top, then every conversation —
  // is identical wherever it shows up: the desktop sidebar panel and the
  // mobile header dropdown are the same dropdown conceptually, just mounted
  // in two different spots, so they share this one render function.
  function chatConvListBody(convs) {
    return `<div class="conv-list">
      <button class="conv-item" data-act="chat-new"
        style="flex-direction:row;align-items:center;gap:8px;font-weight:600;color:${PINK}">
        <span aria-hidden="true">+</span><span>New chat</span>
      </button>
      ${convs.length ? convs.map(c => `
        <button class="conv-item ${c.id === state.chatConv ? 'on' : ''}" data-act="chat-open" data-id="${esc(c.id)}">
          <span class="ct">${esc(convLabel(c))}</span>
          <span class="cm">${esc(ago(c.last_message_at || c.created_at))} · ${c.message_count} msg</span>
        </button>`).join('')
        : `<div class="conv-empty">No other chats yet.</div>`}
    </div>`;
  }

  // Lives in the nav rail now, directly under the "Chat" item — see
  // railHTML(). Visually subordinate to a nav-item: nav-title's 11px
  // uppercase scale for the collapsed toggle's meta line, nothing here as
  // large as a nav-item's 15px label. Collapsed by default; expanding it
  // reuses the exact same list body as the mobile header dropdown.
  function railChatBlock() {
    const convs = (slot('chat').data && slot('chat').data.convs) || [];
    const active = convs.find(c => c.id === state.chatConv) || null;
    const count = convs.length;
    const countLabel = count + ' chat' + (count === 1 ? '' : 's');
    if (!state.chatListOpen) {
      return `<div style="margin:2px 12px 8px 34px;display:flex;flex-direction:column;gap:1px;min-width:0;">
        <button data-act="chat-new" title="New chat"
          style="display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border-radius:9px;
                 background:none;border:0;color:${PINK};font:inherit;font-weight:600;font-size:12px;
                 cursor:pointer;text-align:left;">
          <span aria-hidden="true">+</span><span>New chat</span>
        </button>
        <button data-act="chat-list-toggle" title="Show all chats"
          style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;min-width:0;
                 padding:6px 10px;border-radius:9px;background:none;border:0;color:inherit;font:inherit;
                 text-align:left;cursor:pointer;">
          <span style="font-size:12.5px;font-weight:500;color:var(--t2);max-width:100%;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;">${esc(active ? convLabel(active) : 'New chat')}</span>
          <span style="font-size:11px;color:var(--t3);">${countLabel} ⌄</span>
        </button>
      </div>`;
    }
    return `<div style="margin:2px 12px 8px 34px;display:flex;flex-direction:column;gap:4px;min-width:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;">
        <span class="nav-title" style="padding:0;">${countLabel}</span>
        <button class="mini-pill" data-act="chat-list-toggle" title="Collapse" style="padding:4px 10px;font-size:11px;">Collapse ⌃</button>
      </div>
      <div style="max-height:38vh;overflow-y:auto;">${chatConvListBody(convs)}</div>
    </div>`;
  }

  /* ---- role filters (chat + vault) ----
   * GET/PUT /vault/role_filters. May 404 until the backend ships it — every
   * path here degrades to an honest inline message, never a blank or fake
   * row. Collapsed by default; the same render function is shared between
   * screenChat() and screenVault() since it is the same data either place. */
  const rfChip = (text, act, i) => `
    <span class="tag" style="display:inline-flex;align-items:center;gap:7px;color:var(--t2);
      border-color:var(--bstrong);background:var(--panel-hov);">
      <span>${esc(text)}</span>
      <button data-act="${act}" data-i="${i}" title="Remove ${esc(text)}" aria-label="Remove ${esc(text)}"
        style="background:none;border:0;color:inherit;font:inherit;font-size:14px;line-height:1;
        cursor:pointer;padding:0;">×</button>
    </span>`;

  function roleFiltersSummary(d) {
    const titles = d.target_titles || [], kws = d.exclude_keywords || [];
    if (!titles.length && !kws.length) return 'No role filters set yet.';
    let head = titles.length
      ? 'Hunting: ' + (titles.length <= 2 ? titles.join(', ')
          : titles.slice(0, 2).join(', ') + ' +' + (titles.length - 2))
      : 'Hunting: anything';
    if (kws.length) {
      head += ' · excluding ' + (kws.length <= 3 ? kws.join(', ')
        : kws.slice(0, 3).join(', ') + ' +' + (kws.length - 3));
    }
    return head;
  }

  // embedded=true (Vault) drops the edge-to-edge chat-top-style bar in favour
  // of a normal rounded card, since it sits inside .pad's own padded column
  // rather than flush under a full-bleed header. Same slot, same state, same
  // actions either way.
  function roleFiltersRow(embedded) {
    const outerStyle = embedded
      ? 'border:1px solid var(--border);border-radius:22px;background:var(--panel);'
      : `border-bottom:1px solid var(--hair);background:var(--panel);`;
    const pad = embedded ? '20px' : (window.innerWidth > 900 ? '40px' : '18px');
    const s = slot('roleFilters');
    if (s.error) {
      return `<div style="padding:12px ${pad};${outerStyle}min-width:0;display:flex;
        align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--t3);">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">Role filters unavailable — ${esc(s.error)}</span>
        <button class="pill outline" style="flex-shrink:0;padding:7px 16px;font-size:13px;" data-act="rf-retry">Retry</button>
      </div>`;
    }
    if (!s.data) {
      return `<div style="padding:12px ${pad};${outerStyle}min-width:0;font-size:13px;color:var(--t3);">
        Loading role filters…
      </div>`;
    }
    const d = s.data;
    if (!state.roleFiltersOpen) {
      return `<button data-act="rf-toggle" title="Edit role filters"
        style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;
        min-width:0;padding:10px ${pad};border:0;${outerStyle}
        color:var(--t2);font:inherit;font-size:13px;cursor:pointer;text-align:left;">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;">${esc(roleFiltersSummary(d))}</span>
        <span style="flex-shrink:0;color:var(--t3);">Edit ⌄</span>
      </button>`;
    }
    // Lazy-init the working draft the same way cvVariantRow() lazy-loads its
    // diff: a side effect during render, matching this file's own pattern.
    if (!state.roleFilterEdit) {
      state.roleFilterEdit = {
        target_titles: [...d.target_titles], exclude_keywords: [...d.exclude_keywords],
      };
    }
    const draft = state.roleFilterEdit;
    return `<div style="padding:14px ${pad};${outerStyle}min-width:0;
      display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <span class="eyebrow">Role filters${d.source ? ' · ' + esc(d.source) : ''}</span>
        <button class="mini-pill" data-act="rf-toggle" title="Collapse">Collapse ⌃</button>
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:8px;">Target titles</div>
        <div class="chip-row" style="justify-content:flex-start;">
          ${draft.target_titles.length ? draft.target_titles.map((t, i) => rfChip(t, 'rf-remove-title', i)).join('')
            : '<span class="dim" style="font-size:13px;">None set — Pokie hunts anything.</span>'}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input id="rf-title-in" class="teach-input" placeholder="Add a target title…" style="flex:1;">
          <button class="mini-pill" data-act="rf-add-title">Add</button>
        </div>
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom:8px;">Exclude keywords</div>
        <div class="chip-row" style="justify-content:flex-start;">
          ${draft.exclude_keywords.length ? draft.exclude_keywords.map((t, i) => rfChip(t, 'rf-remove-kw', i)).join('')
            : '<span class="dim" style="font-size:13px;">None set.</span>'}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input id="rf-kw-in" class="teach-input" placeholder="Add a keyword to exclude…" style="flex:1;">
          <button class="mini-pill" data-act="rf-add-kw">Add</button>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="mini-pill" style="background:${PINK};color:#070707;font-weight:600;border-color:${PINK};"
          data-act="rf-save">Save</button>
      </div>
    </div>`;
  }

  function screenChat() {
    const s = slot('chat');
    if (s.loading && !s.data) return `<div class="pad">${loadingHTML('your chats')}</div>`;
    if (s.error) return `<div class="pad">${errorHTML(s.error, 'chat')}</div>`;

    const convs = (s.data && s.data.convs) || [];
    const suggestions = (s.data && s.data.suggestions) || [];
    const active = convs.find(c => c.id === state.chatConv) || null;
    const thread = state.chatConv ? slot('chat:' + state.chatConv) : null;
    const messages = (thread && thread.data && thread.data.messages) || [];

    let body;
    if (!state.chatConv) {
      // Cold start: greeting + composer, centred. Nothing is faked here — there
      // genuinely is no conversation yet.
      //
      // Root cause of the mobile "won't scroll" bug: .chat-centre used
      // `justify-content:center` with no overflow-y/min-height override. A
      // flex item centred that way overflows equally above AND below its own
      // box once its content (greeting + composer + a full suggestion row,
      // or the same content squeezed by an on-screen keyboard) is taller
      // than the space available — and the half that bleeds ABOVE the box's
      // nominal top edge is not part of any container's normal scrollable
      // range, so it renders clipped and no amount of scrolling reaches it.
      // #main (the real scroll container, overflow-y:auto) works fine for
      // downward overflow — verified in a real browser at 390x844 shrunk to
      // 390x500 — so the fix is to stop the content from bleeding upward at
      // all: swap `justify-content:center` for the `margin:auto` centring
      // trick on an inner wrapper. Auto margins centre exactly like
      // `justify-content:center` while there is spare room, then collapse to
      // 0 (not negative) once content overflows, so the overflow only ever
      // grows downward — in-flow, and fully reachable by #main's scroll.
      body = `<div class="chat-centre" style="justify-content:flex-start;overflow-y:auto;min-height:0;">
        <div style="margin:auto 0;display:flex;flex-direction:column;align-items:center;gap:34px;width:100%;">
          <div class="chat-greet">
            ${mark(46)}
            <div class="h">What should I do next?</div>
            <div class="s">I can read anything and change anything. Ask, or just tell me.</div>
          </div>
          <div class="chat-composer-wrap">${chatComposer(suggestions)}</div>
        </div>
      </div>`;
    } else if (thread && thread.loading && !thread.data) {
      body = `<div class="pad">${loadingHTML('this chat')}</div>`;
    } else if (thread && thread.error) {
      body = `<div class="pad">${errorHTML(thread.error, 'chat')}</div>`;
    } else {
      body = `
        <div class="thread-scroll" id="chat-scroll">
          <div class="thread">
            ${messages.length ? messages.map(chatTurn).join('')
              : emptyHTML('Nothing said yet', 'Ask for something and Pokie will get on with it.')}
            ${state.chatSending ? typingHTML() : ''}
          </div>
        </div>
        <div class="thread-composer">
          <div class="chat-composer-wrap">${chatComposer(messages.length ? [] : suggestions)}</div>
        </div>`;
    }

    // The conversation list now lives in the nav rail (railChatBlock(),
    // desktop-only — the rail is display:none below 900px), so this column
    // is just the thread; .chat-layout's own CSS still assumes two columns
    // (250px 1fr), hence the inline override to one. Below 900px the
    // stylesheet's own media query already collapses it the same way, but
    // forcing it here too means this no longer depends on that cascade.
    const desktopWide = window.innerWidth > 900;

    return `<div class="chat-layout" style="grid-template-columns:1fr;">
      <div class="chat-shell" style="min-width:0;">
        <div class="chat-top hair" style="min-width:0;">
          ${desktopWide ? '' : `<button class="mini-pill" data-act="chat-new" title="New chat"
            style="flex-shrink:0;padding:7px 12px;font-size:12px;">+ New</button>`}
          <button class="conv-trigger" data-act="chat-list-toggle" style="min-width:0;flex:1;">
            <span class="ct">${esc(active ? convLabel(active) : 'New chat')}</span>
            <span class="cv">${state.chatListOpen ? '⌃' : '⌄'}</span>
          </button>
          <div class="chat-status" style="flex-shrink:0;">
            <span class="live-dot"></span>${window.innerWidth > 480 ? '<span>Pokie is listening</span>' : ''}
          </div>
          ${refreshBtn()}
        </div>
        ${state.chatListOpen && !desktopWide ? `<div class="conv-menu" style="min-width:0;">${chatConvListBody(convs)}</div>` : ''}
        ${roleFiltersRow(false)}
        ${body}
      </div>
    </div>`;
  }

  const SCREENS = {
    chat: screenChat, overview: screenOverview,
    jobs: screenJobs, run: screenRun, approve: screenApprove,
    applications: screenApplications, memory: screenMemory, sources: screenSources,
    history: screenHistory, vault: screenVault, cvlab: screenCvLab,
    settings: screenSettings, more: screenMore,
  };

  /* ================= data needed per screen ================= */
  // Returns a promise that settles once everything this call kicked off has
  // finished — reload/refresh/pull-to-refresh await it to know when to hide
  // their spinner. Screens that need nothing new (their slots are already
  // populated) resolve immediately, same as before this return value existed.
  function ensureData() {
    const jobs = [];
    switch (state.screen) {
      case 'chat':
        if (!slot('chat').data && !slot('chat').loading && !slot('chat').error) jobs.push(loadChat());
        if (!slot('roleFilters').data && !slot('roleFilters').loading && !slot('roleFilters').error) jobs.push(loadRoleFilters());
        break;
      case 'overview': if (!slot('overview').data && !slot('overview').loading && !slot('overview').error) jobs.push(loadOverview()); break;
      case 'jobs': if (!slot('jobs').data && !slot('jobs').loading && !slot('jobs').error) jobs.push(loadJobs()); break;
      case 'run':
        if (!slot('sources').data && !slot('sources').loading && !slot('sources').error) jobs.push(loadSources());
        // The feed tells this screen whether a backlog is waiting; the status
        // endpoint tells it whether a run is already going (e.g. started
        // before a reload, or by the sweep tail).
        if (!slot('jobs').data && !slot('jobs').loading && !slot('jobs').error) jobs.push(loadJobs());
        if (!slot('backlog').data && !slot('backlog').loading && !slot('backlog').error) {
          // A run started before a reload is still going on the server; pick
          // its progress back up rather than showing a frozen snapshot.
          jobs.push(loadBacklog().then(() => {
            const b = slot('backlog').data;
            if (b && b.running && !state.backlogPoll) pollBacklog();
          }));
        }
        break;
      case 'approve': if (!slot('reviews').data && !slot('reviews').loading && !slot('reviews').error) jobs.push(loadReviews()); break;
      case 'applications': if (!slot('applications').data && !slot('applications').loading && !slot('applications').error) jobs.push(loadApplications()); break;
      case 'memory': if (!slot('memory').data && !slot('memory').loading && !slot('memory').error) jobs.push(loadMemory()); break;
      case 'sources': if (!slot('sources').data && !slot('sources').loading && !slot('sources').error) jobs.push(loadSources()); break;
      case 'history': if (!slot('history').data && !slot('history').loading && !slot('history').error) jobs.push(loadHistory()); break;
      case 'vault':
        if (!slot('vault').data && !slot('vault').loading && !slot('vault').error) jobs.push(loadVault());
        if (!slot('roleFilters').data && !slot('roleFilters').loading && !slot('roleFilters').error) jobs.push(loadRoleFilters());
        break;
      case 'cvlab': if (!slot('cvVersions').data && !slot('cvVersions').loading && !slot('cvVersions').error) jobs.push(loadCvVersions()); break;
      case 'settings': if (!slot('settings').data && !slot('settings').loading && !slot('settings').error) jobs.push(loadSettings()); break;
    }
    return Promise.all(jobs);
  }

  // Screens whose primary data does not live in a store slot named after the
  // screen itself (loadX() always calls slot('run') would be wrong — 'run'
  // spreads across sources/backlog/jobs/sweep) — everything else's loader
  // writes straight into slot(<screen key>), so no entry is needed for those.
  const SCREEN_SLOTS = { run: ['sources', 'backlog', 'jobs', 'sweep'] };
  function slotsFor(screen) {
    const base = SCREEN_SLOTS[screen] || [screen];
    return (screen === 'chat' && state.chatConv) ? base.concat(['chat:' + state.chatConv]) : base;
  }
  function isScreenLoading(screen) {
    return slotsFor(screen || state.screen).some(k => slot(k).loading);
  }
  // The one place both the Retry button and the new refresh control (desktop
  // button + mobile pull-to-refresh) funnel through: drop the cached slot(s)
  // so the next ensureData() genuinely refetches rather than re-rendering
  // what's already in store, then render immediately so the screen's own
  // loading state shows right away. Returns ensureData()'s promise so a
  // caller can know when the refetch has actually settled.
  function reloadScreen(screen) {
    slotsFor(screen).forEach(k => delete store[k]);
    delete store['overview'];
    const p = ensureData();
    render();
    return p;
  }

  /* ================= render ================= */
  const app = () => $('#app'), mainEl = () => $('#main');
  let typeTimer = null;

  function render() {
    const fn = SCREENS[state.screen] || screenChat;
    $('#rail').innerHTML = railHTML();
    $('#tabbar').innerHTML = tabbarHTML();
    mainEl().innerHTML = fn();
    app().classList.remove('cold');
    if (state.screen === 'chat') restoreChatComposer();
  }

  // innerHTML replacement throws away the composer's value, its caret and its
  // focus every render — and a render happens on every poll, badge update and
  // action. The draft is therefore kept in state and put back here, so typing
  // a long message while something else refreshes does not lose it.
  function restoreChatComposer() {
    const input = $('#chat-input');
    if (input) {
      input.value = state.chatDraft;
      autoGrow(input);
      // Do not steal focus (and with it, on mobile, the scroll position —
      // focusing an input scrolls it into view) while the user has the
      // conversation dropdown or the role-filters editor open. Either means
      // they tapped a chevron to browse or edit something, not to type, and
      // grabbing focus mid-browse is exactly what silently scrolled "+ New
      // chat" off the top of the mobile dropdown.
      if (!state.chatSending && !state.chatListOpen && !state.roleFiltersOpen) input.focus();
    }
    const scroll = $('#chat-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(160, el.scrollHeight) + 'px';
  }

  function go(screen) {
    if (!SCREENS[screen]) screen = 'chat';
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
    reload: (el) => { reloadScreen(el.dataset.screen); },
    // Desktop's always-available refresh control (see pageHead()/jobs-head/
    // chat-top). Same path as Retry and pull-to-refresh; a no-op while a
    // fetch for this screen is already in flight rather than piling on a
    // second one.
    refresh: () => { if (!isScreenLoading()) reloadScreen(state.screen); },
    logout: () => { tokens.clear(); location.reload(); },

    /* ---- chat ---- */
    'chat-new': async () => {
      state.chatListOpen = false;
      const res = await api('/chat/conversations', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not start a chat: ' + res.error);
      state.chatConv = res.data.id;
      state.chatDraft = ''; state.chatError = null;
      slot('chat:' + res.data.id).data = {
        conversation: res.data, messages: [], suggestions: [],
      };
      loadChat();
      render();
    },
    'chat-open': (el) => {
      state.chatConv = el.dataset.id;
      state.chatListOpen = false;
      state.chatError = null;
      loadChatThread(el.dataset.id);
      render();
    },
    // Drives both the desktop sidebar panel and the mobile header dropdown —
    // see chatListOpen in state.
    'chat-list-toggle': () => { state.chatListOpen = !state.chatListOpen; render(); },
    'chat-suggest': (el) => { state.chatDraft = el.dataset.text || ''; sendChat(); },
    'chat-send': () => sendChat(),

    'chat-confirm': (el) => resolveChatAction(el.dataset.id, 'confirm'),
    'chat-cancel': (el) => resolveChatAction(el.dataset.id, 'reject'),

    /* ---- role filters (chat + vault) ---- */
    'rf-toggle': () => {
      state.roleFiltersOpen = !state.roleFiltersOpen;
      if (!state.roleFiltersOpen) state.roleFilterEdit = null;
      render();
    },
    'rf-remove-title': (el) => {
      if (!state.roleFilterEdit) return;
      state.roleFilterEdit.target_titles.splice(parseInt(el.dataset.i, 10), 1);
      render();
    },
    'rf-remove-kw': (el) => {
      if (!state.roleFilterEdit) return;
      state.roleFilterEdit.exclude_keywords.splice(parseInt(el.dataset.i, 10), 1);
      render();
    },
    'rf-add-title': () => {
      const input = $('#rf-title-in');
      if (!input || !state.roleFilterEdit) return;
      const v = input.value.trim();
      if (!v) return;
      state.roleFilterEdit.target_titles.push(v);
      render();
    },
    'rf-add-kw': () => {
      const input = $('#rf-kw-in');
      if (!input || !state.roleFilterEdit) return;
      const v = input.value.trim();
      if (!v) return;
      state.roleFilterEdit.exclude_keywords.push(v);
      render();
    },
    'rf-save': async () => {
      const draft = state.roleFilterEdit || { target_titles: [], exclude_keywords: [] };
      const res = await api('/vault/role_filters', {
        method: 'PUT',
        body: JSON.stringify({
          target_titles: draft.target_titles, exclude_keywords: draft.exclude_keywords,
        }),
      });
      if (!res.ok) return toast('Could not save role filters: ' + res.error);
      toast('Role filters saved.');
      state.roleFilterEdit = null;
      delete store['roleFilters'];
      ensureData(); render();
    },
    'rf-retry': () => { delete store['roleFilters']; ensureData(); render(); },

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
      delete store['jobs']; delete store['job:' + el.dataset.id]; delete store['overview'];
      state.selectedJob = null; state.mobileDetail = false;
      ensureData(); render();
    },
    'generate-docs': async (el) => {
      const res = await api('/jobs/' + encodeURIComponent(el.dataset.id) + '/generate_docs', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not start a draft: ' + res.error);
      toast('Drafting — it will appear under Needs you.');
      delete store['reviews']; delete store['overview'];
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

    'score-backlog': async () => {
      const res = await api('/jobs/score_backlog', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) return toast('Could not start scoring: ' + res.error);
      slot('backlog').data = res.data;
      slot('backlog').error = null;
      toast(res.data.status === 'already_running'
        ? 'Scoring is already running.' : 'Scoring the backlog.');
      go('run');
      pollBacklog();
    },
    'answer-escalation': async (el) => {
      const input = $('#esc-in-' + el.dataset.id);
      const answer = input ? input.value.trim() : '';
      if (!answer) return toast('Type an answer first.');
      const res = await api('/escalations/' + encodeURIComponent(el.dataset.id) + '/answer', {
        method: 'POST', body: JSON.stringify({ answer }),
      });
      if (!res.ok) return toast('Could not save that answer: ' + res.error);
      toast('Answered — Pokie will not ask that again.');
      // Home and Applications both show escalation-derived counts, and Memory
      // may have gained a proposal from this answer.
      delete store['reviews']; delete store['overview']; delete store['applications'];
      delete store['memory'];
      ensureData(); render();
    },


    'review-approve': (el) => {
      const picked = state.reviewPick[el.dataset.id];
      decideReview(el.dataset.id, 'approve', picked ? { cv_version_id: picked } : {});
    },
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
      delete store['applications']; delete store['overview']; ensureData(); render();
    },
    'discard-app': async (el) => {
      const res = await api('/applications/' + encodeURIComponent(el.dataset.id) + '/discard', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not discard: ' + res.error);
      toast('Discarded.');
      delete store['applications']; delete store['overview']; ensureData(); render();
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
      const cur = (((slot('sources').data || {}).items) || [])
        .find(x => x.id === el.dataset.id);
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
      const status = res.data && res.data.status;
      // A browser login runs in the background and may come back asking for a
      // code — say that, rather than implying it is already fixed.
      toast(status === 'started' ? 'Signing in — watch this screen for a code request.'
        : status === 'in_progress' ? 'Already signing in.'
        : status === 'not_applicable' ? 'That source has no login to repair.'
        : 'Repair requested.');
      delete store['sources']; delete store['overview']; ensureData(); render();
    },
    'source-otp': async (el) => {
      const input = $('#otp-in-' + el.dataset.id);
      const answer = input ? input.value.trim() : '';
      if (!answer) return toast('Type the code the site sent you first.');
      const res = await api(
        '/sources/login_challenges/' + encodeURIComponent(el.dataset.id) + '/answer',
        { method: 'POST', body: JSON.stringify({ answer }) });
      if (!res.ok) return toast('Could not send the code: ' + res.error);
      toast('Code sent — finishing the login.');
      delete store['sources']; delete store['overview']; ensureData(); render();
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
        llm_balance_floor_usd: parseFloat($('[data-set="llm_balance_floor_usd"]').value),
      };
      // Additive field: only sent when the input is actually on screen, so an
      // older backend that does not know it is never handed a surprise.
      const scoreCap = $('[data-set="score_daily_cap"]');
      if (scoreCap) body.score_daily_cap = parseInt(scoreCap.value, 10);
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
      delete store['vault']; delete store['overview']; ensureData(); render();
    },

    'generate-variants': async () => {
      const res = await api('/cv/versions/generate', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) return toast('Could not generate variants: ' + res.error);
      toast('Variant pool ready.');
      delete store['cvVersions']; ensureData(); render();
    },
    'improve-variants': async () => {
      const res = await api('/cv/versions/improve', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) return toast('Could not improve variants: ' + res.error);
      toast(res.data.consumed
        ? `Consumed ${res.data.consumed} note${res.data.consumed === 1 ? '' : 's'} — ${res.data.variants_updated.length} variant${res.data.variants_updated.length === 1 ? '' : 's'} updated.`
        : 'No new feedback to consume.');
      delete store['cvVersions'];
      res.data.variants_updated.forEach(id => delete store['cvdiff:' + id]);
      ensureData(); render();
    },
    'set-default-variant': async (el) => {
      const res = await api('/cv/versions/' + encodeURIComponent(el.dataset.id) + '/set_default', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!res.ok) return toast('Could not set default: ' + res.error);
      toast('Default variant updated.');
      delete store['cvVersions']; ensureData(); render();
    },
    'toggle-variant-diff': (el) => {
      const id = el.dataset.id;
      state.expandedDiff[id] = !state.expandedDiff[id];
      render();
    },
    'pick-variant': (el) => {
      state.reviewPick[el.dataset.id] = el.dataset.variant;
      render();
    },
  };

  /* ================= chat plumbing ================= */
  async function sendChat() {
    const input = $('#chat-input');
    const text = ((input && input.value) || state.chatDraft || '').trim();
    if (!text || state.chatSending) return;

    // Start a conversation on the first message rather than up front, so an
    // opened-and-abandoned chat never leaves an empty row behind.
    if (!state.chatConv) {
      const made = await api('/chat/conversations', {
        method: 'POST', body: JSON.stringify({}),
      });
      if (!made.ok) { state.chatError = 'Could not start a chat: ' + made.error; render(); return; }
      state.chatConv = made.data.id;
      slot('chat:' + made.data.id).data = {
        conversation: made.data, messages: [], suggestions: [],
      };
    }

    const id = state.chatConv;
    const thread = slot('chat:' + id);
    if (!thread.data) thread.data = { conversation: null, messages: [], suggestions: [] };

    // Echo the user's own words immediately. This is not fabricated content —
    // it is what they just typed — and waiting up to 90s to see it would make
    // the app feel broken. Pokie's side is never optimistic.
    thread.data.messages = thread.data.messages.concat([{
      id: 'pending-' + Date.now(), role: 'user', text, blocks: [],
      status: 'complete',
    }]);
    state.chatDraft = ''; state.chatError = null; state.chatSending = true;
    render();

    const res = await api('/chat/conversations/' + encodeURIComponent(id) + '/messages', {
      method: 'POST', body: JSON.stringify({ text }),
    });
    state.chatSending = false;

    if (!res.ok) {
      // Put the words back in the box so nothing is lost, and say what failed.
      state.chatDraft = text;
      state.chatError = res.error;
      thread.data.messages = thread.data.messages.filter(
        m => String(m.id).indexOf('pending-') !== 0);
      render();
      return;
    }

    // Re-read the transcript rather than splicing the response in: the turn may
    // have changed things elsewhere, and the server's copy is the real one.
    // The cached slots are REFRESHED, not deleted — deleting them flips the
    // whole screen to a loading state for the length of a round-trip, so every
    // message would blank the conversation you are reading.
    await loadChatThread(id, true);
    loadChat();
    // A turn can dismiss jobs, change settings or start a sweep, so every
    // cached screen is now suspect. Drop them all; they refetch on visit.
    ['overview', 'jobs', 'reviews', 'applications', 'memory', 'sources',
     'history', 'vault', 'settings'].forEach(k => { delete store[k]; });
    typeOutNewestTurn(id);
    render();
  }

  /* The reply arrives complete — the chat API is a plain POST, not a token
   * stream, because the agent performs real writes and a stream that dies
   * mid-flight leaves the client unable to say whether one happened. So the
   * ChatGPT feel is produced here instead: reveal the finished text at a
   * readable pace. It costs nothing in latency (the answer is already in
   * hand) and it is skipped entirely for anyone who asked for less motion. */
  function typeOutNewestTurn(convId) {
    const thread = slot('chat:' + convId);
    const msgs = (thread.data && thread.data.messages) || [];
    let newest = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'user') { newest = msgs[i]; break; }
    }
    if (!newest) return;
    // Reveal the closing sentence — the last text block, falling back to the
    // message's own text. A turn that is only cards has no prose to type, and
    // animating nothing would be theatre.
    const list = newest.blocks || [];
    let lastText = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === 'text') { lastText = i; break; }
    }
    const full = lastText === -1 ? (newest.text || '')
      : ((list[lastText].payload || {}).text || '');
    if (!full) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    state.chatTypeId = newest.id;
    state.chatTypeAt = 0;
    // Long answers must not take longer to reveal than to read — step size
    // scales so the whole thing lands inside about a second and a half.
    const step = Math.max(1, Math.ceil(full.length / 90));
    typeTimer = setInterval(() => {
      state.chatTypeAt += step;
      const node = document.getElementById('chat-typing-node');
      if (state.chatTypeAt >= full.length) {
        clearInterval(typeTimer); typeTimer = null;
        state.chatTypeId = null; state.chatTypeAt = 0;
        render();                      // final pass renders the real markdown
        return;
      }
      if (node) {
        // Patch this one node in place rather than re-rendering the whole
        // screen 90 times — a full render per frame drops the composer focus
        // and makes the thread jump. textContent, not firstChild.nodeValue:
        // at zero characters there is no text node yet.
        node.textContent = full.slice(0, state.chatTypeAt);
        const sc = document.getElementById('chat-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
      } else {
        render();
      }
    }, 16);
  }

  async function resolveChatAction(blockId, kind) {
    const id = state.chatConv;
    if (!id) return;
    state.chatSending = true; render();
    const res = await api('/chat/conversations/' + encodeURIComponent(id)
      + '/' + kind + '/' + encodeURIComponent(blockId), {
      method: 'POST', body: JSON.stringify({}),
    });
    state.chatSending = false;
    if (!res.ok) {
      state.chatError = res.error;
      render();
      return;
    }
    toast(kind === 'confirm' ? 'Done.' : 'Cancelled.');
    await loadChatThread(id, true);
    ['overview', 'jobs', 'reviews', 'applications', 'memory', 'sources',
     'history', 'vault', 'settings'].forEach(k => { delete store[k]; });
    render();
  }

  async function decideReview(id, kind, body) {
    const res = await api('/reviews/' + encodeURIComponent(id) + '/' + kind, {
      method: 'POST', body: JSON.stringify(body || {}),
    });
    if (!res.ok) return toast('That did not go through: ' + res.error);
    toast(kind === 'approve' ? 'Approved.' : 'Rejected.');
    delete state.reviewPick[id];
    delete store['reviews']; delete store['review:' + id]; delete store['overview'];
    delete store['applications']; delete store['cvVersions'];
    ensureData(); render();
  }

  async function pollSweep() {
    clearInterval(state.sweepPoll);
    if (!state.sweepId) return;
    let announced = false, waitedForScoring = 0;
    const tick = async () => {
      const res = await api('/sweeps/' + encodeURIComponent(state.sweepId) + '/status');
      const s = slot('sweep');
      if (!res.ok) { s.error = res.error; clearInterval(state.sweepPoll); render(); return; }
      s.data = res.data; s.error = null;
      const terminal = res.data.status === 'completed' || res.data.status === 'failed';
      if (terminal && !announced) {
        announced = true;
        delete store['jobs']; delete store['overview'];
        toast('Sweep ' + res.data.status + '.');
      }
      // A sweep scores what it found AFTER writing its terminal status, so
      // stopping the instant the status flips would miss the scoring block.
      // Keep polling for it, but bounded: a sweep whose scoring record never
      // lands (process restart) must not poll forever.
      if (terminal && (res.data.scoring || waitedForScoring >= 8)) {
        clearInterval(state.sweepPoll);
        state.sweepPoll = null;
      } else if (terminal) {
        waitedForScoring += 1;
      }
      if (state.screen === 'run') render();
    };
    await tick();
    state.sweepPoll = setInterval(tick, 2500);
  }

  // Backlog scoring has no WS event (it writes the same job rows the feed
  // already serves), so the run screen polls its status endpoint the same way
  // it polls a sweep.
  async function pollBacklog() {
    clearInterval(state.backlogPoll);
    const tick = async () => {
      const res = await api('/jobs/score_backlog/status');
      const s = slot('backlog');
      if (!res.ok) {
        s.error = res.error;
        clearInterval(state.backlogPoll); state.backlogPoll = null;
        render(); return;
      }
      s.data = res.data; s.error = null;
      if (!res.data.running) {
        clearInterval(state.backlogPoll);
        state.backlogPoll = null;
        // Scores changed: the feed and the home stats are now stale.
        delete store['jobs']; delete store['overview'];
        toast(res.data.skipped_reason
          ? 'Scoring stopped: ' + res.data.skipped_reason
          : 'Scoring finished — ' + res.data.scored + ' scored.');
        if (state.screen === 'run') ensureData();
      }
      if (state.screen === 'run') render();
    };
    await tick();
    const now = slot('backlog').data;
    if (now && now.running) state.backlogPoll = setInterval(tick, 2500);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(el);
  });

  // The composer is a textarea, not a form: Enter sends, Shift+Enter breaks a
  // line. Bound on document because the element is destroyed and recreated by
  // every render.
  document.addEventListener('keydown', (e) => {
    if (!e.target || e.target.id !== 'chat-input') return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'chat-input') return;
    state.chatDraft = e.target.value;
    autoGrow(e.target);
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    // An empty hash is the home screen, which is the chat.
    const screen = h || 'chat';
    if (screen !== state.screen) go(screen);
  });

  /* ================= pull-to-refresh (#main, mobile) =================
   * The app shell is fixed (html/body/.app all overflow:hidden at 100dvh) so
   * only #main scrolls — the document itself never does, which means the
   * browser's native pull-to-refresh can never fire. This reimplements the
   * gesture by hand on #main: touchstart only arms it when already at the
   * very top (scrollTop===0), touchmove tracks a downward drag and shows a
   * small indicator past a threshold, touchend past that threshold refetches
   * through the exact same reloadScreen() path as the desktop button and the
   * Retry links. Anything that is not a clean top-of-scroll downward drag —
   * scrolling that is already underway, an upward flick, a mostly-horizontal
   * swipe, a second pull while one is already loading — falls straight
   * through to native touch/scroll behaviour untouched.                   */
  (function initPullToRefresh() {
    const THRESHOLD = 70, MAX_PULL = 110;
    let startX = null, startY = null, lastDy = 0, tracking = false, pulling = false;

    function indicator() {
      let el = document.getElementById('pk-ptr');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'pk-ptr';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span>';
      el.style.cssText = 'position:fixed;left:50%;top:0;z-index:60;width:36px;height:36px;'
        + 'border-radius:50%;background:var(--panel);border:1px solid var(--border);'
        + 'display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;'
        + 'transform:translate(-50%,-48px);'
        + (REDUCE_MOTION ? '' : 'transition:transform .2s ease,opacity .2s ease;');
      document.body.appendChild(el);
      return el;
    }
    function setPull(dy, ready) {
      const el = indicator();
      const clamped = Math.min(MAX_PULL, dy);
      el.style.transition = 'none'; // follow the finger exactly while dragging
      el.style.opacity = clamped > 4 ? '1' : '0';
      el.style.transform = `translate(-50%, ${-48 + Math.min(64, clamped)}px)`;
      const spin = el.querySelector('.spinner');
      if (spin) spin.style.borderTopColor = ready ? 'var(--pink)' : 'var(--blue)';
    }
    function resting(offset) {
      const el = indicator();
      el.style.transition = REDUCE_MOTION ? 'none' : 'transform .2s ease,opacity .2s ease';
      el.style.opacity = offset ? '1' : '0';
      el.style.transform = `translate(-50%, ${offset}px)`;
    }

    document.addEventListener('touchstart', (e) => {
      const main = mainEl();
      if (!main || !main.contains(e.target)) return;
      if (main.scrollTop > 0 || isScreenLoading()) { tracking = false; return; }
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; lastDy = 0;
      tracking = true; pulling = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const main = mainEl();
      if (!main || main.scrollTop > 0) { tracking = false; pulling = false; resting(0); return; }
      const t = e.touches[0];
      const dy = t.clientY - startY, dx = t.clientX - startX;
      if (!pulling && Math.abs(dx) > Math.abs(dy)) { tracking = false; return; } // horizontal swipe — not ours
      if (dy <= 0) { pulling = false; resting(0); return; }
      pulling = true;
      lastDy = dy;
      // Own the gesture once it's a real downward pull at the top of the
      // scroll area, so the browser doesn't also try to rubber-band it.
      if (e.cancelable) e.preventDefault();
      setPull(dy, dy >= THRESHOLD);
    }, { passive: false });

    async function finishPull() {
      if (isScreenLoading()) { resting(14); }
      else resting(0);
      try { await reloadScreen(state.screen); }
      finally { resting(0); }
    }

    document.addEventListener('touchend', () => {
      if (!tracking) return;
      const shouldRefresh = pulling && lastDy >= THRESHOLD && !isScreenLoading();
      tracking = false; pulling = false; lastDy = 0;
      if (shouldRefresh) finishPull();
      else resting(0);
    });
    document.addEventListener('touchcancel', () => {
      tracking = false; pulling = false; lastDy = 0; resting(0);
    });
  })();

  /* ================= boot ================= */
  async function boot() {
    if (!tokens.get()) { showLogin(); return; }
    const h = location.hash.replace('#', '');
    // No hash, or an unknown one, lands on the chat — it is the home screen.
    state.screen = SCREENS[h] ? h : 'chat';
    render();
    ensureData();
    // Badge counts and the signed-in identity the rail shows before you visit
    // those screens.
    const [rev, cq, props, prof, esc] = await Promise.all([
      api('/reviews'), api('/applications/confirm_queue'), api('/memory/proposals'),
      api('/vault/profile'), api('/escalations?status=pending'),
    ]);
    // Needs you = pending drafts + pending questions (see setNeedsYouBadge).
    setNeedsYouBadge(
      rev.ok ? (rev.data.items || []).filter(r => r.status === 'pending').length : 0,
      esc.ok ? (esc.data.items || []).length : 0);
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
