/* Pokie — it hunts, you decide. Screens per the design handoff; data is the handoff's view model. */
'use strict';

const PINK = '#EB6BA8', GREEN = '#1CE15F', BLUE = '#4791FF', YELLOW = '#ECE42E', DIM = '#5c5c5c';
const $ = (s, el = document) => el.querySelector(s);
const mark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="display:block;flex-shrink:0"><g transform="rotate(45 12 12)"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5.4" fill="#EB6BA8"/></g><ellipse cx="9.1" cy="12" rx="1.35" ry="2.6" fill="#fff"/><ellipse cx="14.9" cy="12" rx="1.35" ry="2.6" fill="#fff"/></svg>`;

/* ================= State ================= */
const state = {
  screen: 'chat',
  jobMode: 0,
  jobFilter: {},
  selectedJob: 'sarvam',
  teach: {},
  cv: 1,
  histTab: 0,
  undone: {},
  forgotten: {},
  runTimer: null,
  runPaused: false,
  runStep: 6,
  runScored: 34,
  mobileDetail: false,
};

/* ================= Data (from the handoff) ================= */
const NAV = [
  { title: 'Hunt', items: [
    { icon: '◎', label: 'Home', key: 'chat' },
    { icon: '✦', label: 'Jobs', key: 'jobs', badge: '7', badgeBg: 'rgba(28,225,95,.16)', badgeFg: GREEN },
    { icon: '⟳', label: 'Live run', key: 'run', badge: '●', badgeBg: 'rgba(71,145,255,.16)', badgeFg: BLUE },
    { icon: '!', label: 'Needs you', key: 'approve', badge: '3', badgeBg: 'rgba(236,226,46,.18)', badgeFg: YELLOW },
  ]},
  { title: 'Prepare', items: [
    { icon: '▤', label: 'CV Lab', key: 'cvlab' },
    { icon: '⬢', label: 'Companies', key: 'companies', stub: true },
    { icon: '✉', label: 'Outreach', key: 'outreach', stub: true },
  ]},
  { title: 'Pokie', items: [
    { icon: '◈', label: 'Memory', key: 'memory' },
    { icon: '⊞', label: 'Sources', key: 'sources', stub: true },
    { icon: '⏱', label: 'History', key: 'history' },
    { icon: '⚙', label: 'Rules', key: 'rules', stub: true },
  ]},
];

const JOBS = [
  { id: 'sarvam', initials: 'SA', color: GREEN, role: 'Senior PM, Agents', company: 'Sarvam AI', meta: 'Series B · Bangalore', comp: '₹82–98L', score: '92',
    salMin: 82, postedDays: 2, domain: 'ai', warm: true, blrRemote: true,
    note: 'warm path', noteFg: YELLOW, noteBg: 'rgba(236,226,46,.14)', opacity: 1, full: true,
    read: 'You would own the eval loop end to end — offline harness, annotation, release gate. Two PMs report in. The posting buries this under four paragraphs of boilerplate.' },
  { id: 'zepto', initials: 'ZP', color: GREEN, role: 'Group PM, Growth', company: 'Zepto', meta: 'Series F · Bangalore', comp: '₹90L–1.1Cr', score: '89',
    salMin: 90, postedDays: 1, domain: 'consumer', blrRemote: true,
    note: 'applied', noteFg: GREEN, noteBg: 'rgba(28,225,95,.14)', opacity: 1,
    read: 'Growth pod with real levers — pricing, supply density, retention. Pokie applied 6 hours after posting with your marketplace variant.' },
  { id: 'cred', initials: 'CR', color: BLUE, role: 'Group PM, Money', company: 'Cred', meta: 'Series F · Bangalore', comp: 'band unclear', score: '78',
    salMin: null, postedDays: 3, domain: 'fintech', blrRemote: true,
    note: 'scoring', noteFg: BLUE, noteBg: 'rgba(71,145,255,.14)', opacity: 1,
    read: 'Looks like a fit on scope but the JD reads two levels down on comp. Pokie is checking Levels for their band before finishing the score.' },
  { id: 'razorpay', initials: 'RZ', color: BLUE, role: 'Principal PM, Payments', company: 'Razorpay', meta: 'Series F · Bangalore', comp: '₹85L+', score: '76',
    salMin: 85, postedDays: 9, domain: 'fintech', blrRemote: true,
    note: '', opacity: 1,
    read: 'Deep payments infra scope. Solid, not thrilling — nothing here touches an eval loop, which is why it scores below the Sarvam role.' },
  { id: 'postman', initials: 'PS', color: YELLOW, role: 'Senior PM, Seller', company: 'Postman', meta: 'Series D · Remote', comp: '₹78L', score: '71',
    salMin: 78, postedDays: 12, domain: 'devtools', blrRemote: true,
    note: '', opacity: 1,
    read: 'Fully remote and stable, but ₹78L sits under your hard bar. It survives only because the recruiter hinted the band flexes for the right person.' },
  { id: 'meesho', initials: 'MS', color: YELLOW, role: 'Senior PM, Discovery', company: 'Meesho', meta: 'Series F · Bangalore', comp: '₹80L', score: '64',
    salMin: 80, postedDays: 14, domain: 'consumer', blrRemote: true,
    note: 'you skipped', noteFg: PINK, noteBg: 'rgba(235,107,168,.14)', opacity: 1,
    read: 'You skipped this one on 14 Jul. Pokie keeps it visible so the decision stays inspectable — say the word and it disappears for good.' },
  { id: 'freshworks', initials: 'FW', color: '#9A9A9A', role: 'Director PM, Platform', company: 'Freshworks', meta: 'Public · Chennai', comp: '₹68L', score: '52',
    salMin: 68, postedDays: 21, domain: 'devtools', blrRemote: false,
    note: 'under your bar', noteFg: '#9A9A9A', noteBg: '#1a1a1a', opacity: .55, dropped: true,
    read: '₹68L against your ₹80L hard bar. Kept visible so you can see what the bar is costing you.' },
  { id: 'coindcx', initials: 'CD', color: '#9A9A9A', role: 'Principal PM', company: 'CoinDCX', meta: 'Series C · Remote', comp: '₹95L', score: '—',
    salMin: 95, postedDays: 247, domain: 'crypto', blrRemote: true,
    note: 'dealbreaker: crypto', noteFg: '#9A9A9A', noteBg: '#1a1a1a', opacity: .45, dropped: true,
    read: 'Crypto — your dealbreaker. Never scored. Pokie hides 31 roles a week for this rule.' },
];

const EVERYTHING = [
  { state: 'Needs you', stateBg: 'rgba(236,226,46,.16)', stateFg: YELLOW },
  { state: 'Applied', stateBg: 'rgba(28,225,95,.14)', stateFg: GREEN },
  { state: 'Scoring', stateBg: 'rgba(71,145,255,.14)', stateFg: BLUE },
  { state: 'Watching', stateBg: '#212121', stateFg: '#9A9A9A' },
  { state: 'Watching', stateBg: '#212121', stateFg: '#9A9A9A' },
  { state: 'You skipped', stateBg: 'rgba(235,107,168,.14)', stateFg: PINK },
];

/* Filters and sorts are real: they run against job fields, not just chip styling. */
const FILTER_FNS = [
  j => j.warm === true,                                  // Has a warm path
  j => j.salMin !== null && j.salMin >= 80,              // ₹80L+
  j => j.blrRemote,                                      // Bangalore or remote
  j => !/Seed|Series A(?![–-])/.test(j.meta),            // Series B+
  j => j.postedDays <= 7,                                // Posted this week
  j => j.domain === 'ai',                                // AI / agents
];
const SORTS = [
  { label: 'Newest first', fn: (a, b) => a.postedDays - b.postedDays },
  { label: 'Best fit', fn: (a, b) => (parseInt(b.score) || 0) - (parseInt(a.score) || 0) },
  { label: 'Comp first', fn: (a, b) => (b.salMin || 0) - (a.salMin || 0) },
];
function filteredJobs() {
  let list = [...JOBS];
  Object.keys(state.jobFilter).forEach(k => { if (state.jobFilter[k] && FILTER_FNS[k]) list = list.filter(FILTER_FNS[k]); });
  list.sort(SORTS[state.sort || 0].fn);
  return list;
}

const SCORE_BARS = [
  { label: 'Domain fit', value: '96', color: GREEN, width: '96%' },
  { label: 'Comp band', value: '88', color: GREEN, width: '88%' },
  { label: 'Scope', value: '91', color: GREEN, width: '91%' },
  { label: 'Stage risk', value: '71', color: YELLOW, width: '71%' },
  { label: 'Commute', value: '84', color: BLUE, width: '84%' },
];
const SIGNALS = [
  { mark: '✓', color: GREEN, text: 'Real band is ₹82–98L on Levels. The posting understates it.' },
  { mark: '✓', color: GREEN, text: 'Two PMs hired last year, neither has left.' },
  { mark: '✓', color: GREEN, text: 'The role owns evals end to end.' },
  { mark: '!', color: YELLOW, text: 'Series B was 14 months ago. Runway unverified.' },
];
const JOB_TAGS = [
  { label: '₹82–98L verified', fg: GREEN, bg: 'rgba(28,225,95,.1)', border: 'rgba(28,225,95,.3)' },
  { label: 'Warm path', fg: YELLOW, bg: 'rgba(236,226,46,.1)', border: 'rgba(236,226,46,.3)' },
  { label: 'Owns evals', fg: '#9A9A9A', bg: 'transparent', border: 'rgba(255,255,255,.16)' },
  { label: '2 reports', fg: '#9A9A9A', bg: 'transparent', border: 'rgba(255,255,255,.16)' },
];

const RUN_STEPS = [
  { mark: '✓', color: GREEN, text: 'Pulled 412 postings from 9 sources', detail: 'LinkedIn, Wellfound, YC, Instahyre, 5 careers pages', dur: '48s' },
  { mark: '✓', color: GREEN, text: 'Dropped 361 against your hard bar', detail: '214 comp, 88 location, 59 dealbreakers', dur: '12s' },
  { mark: '✓', color: GREEN, text: 'Read all 51 job descriptions in full', detail: 'Not keywords — Pokie reads the whole post', dur: '2m 04s' },
  { mark: '✓', color: GREEN, text: 'Checked comp bands on Levels and Glassdoor', detail: '9 postings understate their real band', dur: '31s' },
  { mark: '✓', color: GREEN, text: 'Found 3 warm paths through your network', detail: 'Ex-Swiggy colleagues now at Sarvam, Cred, Zepto', dur: '22s' },
  { mark: '◐', color: BLUE, text: 'Scoring 51 roles against your memory', detail: '34 of 51 done · currently reading Cred, Group PM Money', dur: 'now' },
  { mark: '○', color: DIM, text: 'Build tailored CV for anything above 85', detail: '', dur: '' },
  { mark: '○', color: DIM, text: 'Draft outreach where a warm path exists', detail: '', dur: '' },
  { mark: '○', color: DIM, text: 'Queue everything that needs you', detail: '', dur: '' },
];
const THOUGHTS = [
  'Cred’s “Group PM, Money” looks like a fit on scope but the JD reads two levels down on comp. Checking Levels for their band before I score it.',
  'Razorpay’s posting says “competitive”. Levels says ₹85L+ for that level. Scoring with the real number.',
  'Zepto reposted the same role with a new title. Deduplicating so it doesn’t count twice.',
  'Postman’s recruiter note hints the band flexes. Holding it at 71 until there’s evidence.',
];

const DRAFT_LINES = [
  { text: 'Vivek — you wrote last month that Sarvam’s hardest problem is evals, not models.', bg: 'transparent' },
  { text: 'I spent two years on exactly that: at Swiggy I owned search relevance, where we shipped an offline eval harness that cut bad-result complaints 31% in a quarter.', bg: 'rgba(28,225,95,.10)' },
  { text: 'The part that transferred was not the model work — it was getting 40 annotators to agree on what “good” meant.', bg: 'rgba(28,225,95,.10)' },
  { text: 'You have a Senior PM role open. I would rather talk about your eval stack for 20 minutes than send you a CV. Either way, worth a conversation?', bg: 'transparent' },
];
const WHY_POINTS = [
  { mark: '◆', color: GREEN, text: 'Opened on his own public writing, not the job post — your last 3 replies all came from this pattern.' },
  { mark: '◆', color: GREEN, text: 'One number, early. Your memory says numbers first.' },
  { mark: '◆', color: BLUE, text: 'Asked for a conversation, not a role. Warmer path than an application.' },
  { mark: '◇', color: YELLOW, text: 'Left out your Zomato stint — he was there 2019-21 and it overlaps awkwardly. Say the word and Pokie puts it back.' },
];
const TEACH = ['Too long', 'Too eager', 'Wrong project cited', 'Don’t mention comp', 'More specific ask'];

const CV_VERSIONS = [
  { name: 'Base CV', note: 'Everything, chronological. Never sent as-is.', rate: '—', rateColor: DIM },
  { name: 'AI-native PM', note: 'Leads with agent evals and 0→1 work.', rate: '38%', rateColor: GREEN },
  { name: 'Fintech PM', note: 'Leads with payments scale and compliance.', rate: '24%', rateColor: BLUE },
  { name: 'Marketplace PM', note: 'Leads with supply growth at Swiggy.', rate: '11%', rateColor: YELLOW },
];
const CV_DIFF = [
  { mark: '+', color: GREEN, bg: 'rgba(28,225,95,.06)', tc: '#fff', text: 'Built an offline eval harness for search relevance — 31% fewer bad-result complaints in one quarter.', why: 'Moved to line 1. The JD names evals three times.' },
  { mark: '+', color: GREEN, bg: 'rgba(28,225,95,.06)', tc: '#fff', text: 'Ran a 40-person annotation program to define ground truth.', why: 'Added — Sarvam is hiring annotators right now.' },
  { mark: '−', color: PINK, bg: 'rgba(235,107,168,.05)', tc: '#5c5c5c', text: 'Managed roadmap across 4 squads and 3 stakeholder groups.', why: 'Cut. Generic, and pushed the eval line to page 2.' },
  { mark: '~', color: BLUE, bg: 'transparent', tc: '#9A9A9A', text: 'Grew supply 3× → Grew restaurant supply 3× in 14 months (2,100 → 6,400).', why: 'Rewritten with the real number from your case study.' },
  { mark: '~', color: BLUE, bg: 'transparent', tc: '#9A9A9A', text: 'Section order: AI work moved above marketplace work.', why: 'Recruiters read 6 seconds of page one.' },
  { mark: '!', color: YELLOW, bg: 'rgba(236,226,46,.05)', tc: '#fff', text: 'Pokie wanted to write “led the AI org” — you rejected it.', why: 'Correctly. Nothing invented, ever.' },
];
const CV_PERF = [
  { name: 'AI-native PM', rate: '38%', color: GREEN, width: '76%' },
  { name: 'Fintech PM', rate: '24%', color: BLUE, width: '48%' },
  { name: 'Marketplace PM', rate: '11%', color: YELLOW, width: '22%' },
];

const MEMORY = [
  { title: 'Identity', sub: 'from your CV, corrected by you', color: '#fff', items: [
    { id: 'i0', text: 'Senior PM, 8 years, 0→1 and scale', source: 'CV · confirmed by you on 12 Jul' },
    { id: 'i1', text: 'Writes short. Numbers first. No adjectives.', source: 'CV bullets · reinforced by 5 edits you made to drafts' },
    { id: 'i2', text: 'Bangalore, will not relocate', source: 'You said so during setup' },
  ]},
  { title: 'Preferences', sub: 'the bar you set, and what you have changed since', color: BLUE, items: [
    { id: 'p0', text: 'AI products with a real eval loop', source: 'Set at onboarding · unchanged in 6 weeks' },
    { id: 'p1', text: '₹80L+ fixed, hard', source: 'You raised this from ₹65L on 20 Jul' },
    { id: 'p2', text: 'No crypto, no ad tech', source: 'Dealbreaker · Pokie hides 31 roles a week for this' },
  ]},
  { title: 'Learned from what you did', sub: 'Pokie inferred these — the ones worth watching', color: YELLOW, items: [
    { id: 'l0', text: 'You ignore anything with “rockstar” in the post', source: 'You skipped 4 of 4 · Pokie now downranks them' },
    { id: 'l1', text: 'You reply to founders, not recruiters', source: '9 of your 11 replies went to founders' },
    { id: 'l2', text: 'You are cooler on Series A than you said', source: 'Rejected 3 of 4 seed/A matches. Pokie softened Stage on its own — undo?' },
  ]},
];

const HISTORY = [
  { day: 'Today', rows: [
    { id: 'h0', time: '06:12', actor: 'Pokie', text: 'Applied to Senior PM, Sarvam AI', detail: 'AI-native CV variant · answered 2 screening questions', action: 'Undo', undoable: true },
    { id: 'h1', time: '06:10', actor: 'Pokie', text: 'Built a CV variant for Sarvam AI', detail: '11 changes from base · none invented', action: 'Inspect' },
    { id: 'h2', time: '05:58', actor: 'Pokie', text: 'Held back outreach to Vivek Raman', detail: 'Sending is set to Ask me · waiting in Needs you', action: 'Review', review: true },
    { id: 'h3', time: '05:31', actor: 'Pokie', text: 'Softened Stage from hard to soft', detail: 'Inferred from 3 rejections · changes what you see', action: 'Undo', undoable: true },
  ]},
  { day: 'Yesterday', rows: [
    { id: 'h4', time: '21:44', actor: 'You', text: 'Rejected Pokie’s draft to Zepto', detail: 'Taught: too eager, don’t mention comp', action: 'Inspect' },
    { id: 'h5', time: '19:02', actor: 'Pokie', text: 'Skipped 3 roles quietly', detail: 'All below your hard comp bar by more than 20%', action: 'See them' },
    { id: 'h6', time: '11:20', actor: 'You', text: 'Raised comp bar to ₹80L fixed', detail: 'Removed 22 roles from the pipeline', action: 'Undo', undoable: true },
  ]},
];

const CHAT_CARDS = [
  { kind: 'Waiting on you', kindColor: YELLOW, meta: 'expires in 2 days', border: 'rgba(236,226,46,.35)',
    title: 'Sarvam AI asked for 200 words on why agents', body: 'I drafted it in your voice — one number, no adjectives. It goes nowhere until you say so.',
    primary: 'Read the draft', primaryBg: YELLOW, secondary: 'You write it', go: 'approve' },
  { kind: 'Best match in six weeks', kindColor: GREEN, meta: 'scored 92', border: 'rgba(28,225,95,.3)',
    title: 'Senior PM, Agents · Sarvam AI', body: 'Owns evals end to end. Real band is ₹82–98L, above what the posting says. Ankita from Swiggy joined them in March.',
    primary: 'Apply', primaryBg: GREEN, secondary: 'Show me why', go: 'jobs' },
];
const SKIPPED = [
  { role: 'Group PM · Cred', reason: 'titled two levels above the band' },
  { role: 'Director PM · Freshworks', reason: 'reports into engineering' },
  { role: 'Principal PM · CoinDCX', reason: 'crypto — your dealbreaker' },
  { role: 'Senior PM · Meesho', reason: '5 days in office' },
];
const CHAT_CHIPS = ['What would loosen my bar most?', 'Show everything you hid this week', 'Follow up with Zepto'];

const ONBOARD_BELIEFS = [
  { label: 'Who you are', value: 'Senior PM, 8 years, 0→1 and scale', border: 'rgba(255,255,255,.09)', wrongFg: '#9A9A9A', wrongBorder: 'rgba(255,255,255,.18)' },
  { label: 'Strongest ground', value: 'Consumer marketplaces and search relevance', border: 'rgba(255,255,255,.09)', wrongFg: '#9A9A9A', wrongBorder: 'rgba(255,255,255,.18)' },
  { label: 'I am guessing here', value: 'You want AI products with a real eval loop', border: 'rgba(236,226,46,.3)', wrongFg: YELLOW, wrongBorder: 'rgba(236,226,46,.4)' },
];
const ONBOARD_CHIPS = [
  { label: '₹80L+', on: true }, { label: 'Bangalore', on: true }, { label: 'Remote (India)', on: true },
  { label: 'AI / agents', on: true }, { label: 'Series A–B', on: false }, { label: 'Fintech', on: false },
];
const ONBOARD_PERMS = [
  { title: 'Apply to strong matches', active: 2, color: GREEN },
  { title: 'Draft outreach', active: 2, color: GREEN },
  { title: 'Send it', active: 1, color: YELLOW },
];
const SAVED_MEMORY = [
  { tag: 'Identity', tagColor: '#fff', text: 'Senior PM, 8 years, 0→1 and scale' },
  { tag: 'Identity', tagColor: '#fff', text: 'Managed a team of four for two years' },
  { tag: 'Goal', tagColor: BLUE, text: 'AI products with a real eval loop' },
  { tag: 'Bar · hard', tagColor: PINK, text: '₹80L+ fixed' },
  { tag: 'Dealbreaker', tagColor: PINK, text: 'No crypto · no 5 days in office' },
  { tag: 'Permission', tagColor: GREEN, text: 'May apply and draft on its own. Sending waits for you.' },
];

const DECISIONS = [
  { kind: 'Outreach · waiting', kindColor: YELLOW, border: 'rgba(236,226,46,.35)', age: '6h old',
    title: 'Send the Vivek Raman draft?', sub: '192 words, opens on his eval essay. Two phrases came from your Swiggy case study.',
    primary: 'Read & send', primaryBg: YELLOW, secondary: 'Not now' },
  { kind: 'Best match in six weeks', kindColor: GREEN, border: 'rgba(28,225,95,.3)', age: '2h old',
    title: 'Senior PM, Agents · Sarvam AI', sub: 'Scored 92. Real band ₹82–98L, verified. Warm path via Ankita.',
    primary: 'Apply', primaryBg: GREEN, secondary: 'Show me why' },
  { kind: 'Pokie changed something', kindColor: PINK, border: 'rgba(235,107,168,.35)', age: '1d old',
    title: 'Stage preference softened', sub: 'You rejected 3 of 4 early-stage matches, so Pokie made Series A soft instead of hard.',
    primary: 'Keep it', primaryBg: PINK, secondary: 'Undo' },
];
const HANDLED = [
  { color: GREEN, text: 'Applied to Zepto and Lumenware — both scored 87+' },
  { color: BLUE, text: 'Re-checked 3 comp bands that looked stale' },
  { color: YELLOW, text: 'Held one draft — the tone read eager' },
];

/* ================= Render helpers ================= */
function railHTML() {
  const groups = NAV.map(g => `
    <div class="nav-group">
      <div class="nav-title">${g.title}</div>
      ${g.items.map(n => `
        <button class="nav-item ${n.key === state.screen ? 'on' : ''}" data-nav="${n.key}" ${n.stub ? 'data-stub="1"' : ''}>
          <span class="ic">${n.icon}</span><span class="lb">${n.label}</span>
          ${n.badge ? `<span class="nav-badge" style="background:${n.badgeBg};color:${n.badgeFg}">${n.badge}</span>` : ''}
        </button>`).join('')}
    </div>`).join('');
  return `
    <div class="rail-logo">${mark(26)}<b>Pokie</b></div>
    ${groups}
    <div class="rail-spacer"></div>
    <div class="trust">
      <div class="trust-top"><span class="l">Trust level</span><span class="v">Semi-auto</span></div>
      <div class="trust-bar"><i></i></div>
      <span class="trust-note">Pokie applies on its own above 85. Everything else waits for you.</span>
    </div>
    <div class="rail-user">
      <span class="ava">RT</span>
      <div style="display:flex;flex-direction:column;flex:1;min-width:0">
        <span class="nm">Rachit Tiwari</span><span class="rl">Senior PM · Bangalore</span>
      </div>
      <span class="dots">⋯</span>
    </div>`;
}

const TABS = [
  { key: 'brief', icon: '◎', label: 'Today' },
  { key: 'jobs', icon: '✦', label: 'Jobs', dot: GREEN },
  { key: 'approve', icon: '!', label: 'Decide', dot: YELLOW },
  { key: 'run', icon: '⟳', label: 'Run' },
  { key: 'chat', icon: '✳', label: 'Ask' },
];
function tabbarHTML() {
  return TABS.map(t => `
    <button class="tab ${t.key === state.screen ? 'on' : ''}" data-nav="${t.key}">
      ${t.dot ? `<span class="dot" style="background:${t.dot}"></span>` : ''}
      <span class="ic">${t.icon}</span><span>${t.label}</span>
    </button>`).join('');
}

/* ================= Screens ================= */
const SCREENS = {

  onboard: () => `
    <div class="onboard rise">
      <div class="ob-main">
        <div class="ob-head">
          <span class="t">${mark(24)} Setting you up</span>
          <span class="s">Talk to me. Nothing here is a form.</span>
        </div>
        <div class="ob-scroll"><div class="ob-thread">
          <div class="agent-turn"><span class="who">Pokie</span><span class="msg">I read your CV. Before I hunt anything, tell me if I have you right.</span></div>
          ${ONBOARD_BELIEFS.map(b => `
            <div class="belief" style="border-color:${b.border}">
              <div class="lv"><span class="lb">${b.label}</span><span class="vl">${b.value}</span></div>
              <div class="btns">
                <button class="mini-pill" data-toast="Edit is inline in the real build — type the correction and Pokie re-reads your CV against it.">Edit</button>
                <button class="mini-pill" style="color:${b.wrongFg};border-color:${b.wrongBorder}" data-toast="Noted as wrong. Pokie asks a follow-up instead of guessing again.">Wrong</button>
              </div>
            </div>`).join('')}
          <div class="ob-bubble">All right. And I managed a team of four for two years.</div>
          <div class="agent-turn"><span class="who">Pokie</span><span class="msg">Saved. Now the bar — what’s worth your time? Tap what applies, or just tell me.</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${ONBOARD_CHIPS.map(c => `<button class="bar-chip" data-chip style="${c.on ? 'background:#fff;color:#070707;border-color:#fff' : 'background:transparent;color:#9A9A9A;border-color:rgba(255,255,255,.16)'}">${c.label}</button>`).join('')}
            </div>
          </div>
          <div class="ob-bubble">₹80L+ is hard. No crypto, no five-days-in-office.</div>
          <div class="agent-turn"><span class="who">Pokie</span><span class="msg">Got it. That bar would have caught 51 roles last month. Last question — what may I do on my own?</span>
            <div class="perm-card">
              ${ONBOARD_PERMS.map((p, pi) => `
                <div class="perm-row" ${pi === 0 ? 'style="border-top:none"' : ''}>
                  <span class="t">${p.title}</span>
                  <div class="seg" data-perm="${pi}">
                    ${['Never', 'Ask me', 'Auto'].map((m, i) => `<span data-mode="${i}" style="${i === p.active ? `background:${p.color};color:#070707` : ''}">${m}</span>`).join('')}
                  </div>
                </div>`).join('')}
            </div>
          </div>
        </div></div>
        <div class="ob-composer">
          <div class="composer">
            <input placeholder="Answer in your own words…" aria-label="Answer Pokie">
            <button class="start-btn" data-go="chat" data-toast="Autopilot on. First sweep runs tonight at 02:00.">Start hunting</button>
          </div>
        </div>
      </div>
      <aside class="ob-side">
        <div class="ob-side-head">
          <span class="ob-side-live"><span class="live-dot"></span>Saving as we talk</span>
          <span class="ob-side-sub">Everything lands in Memory. Edit or delete any of it, now or later.</span>
        </div>
        ${SAVED_MEMORY.map(m => `
          <div class="mem-row">
            <span class="tag" style="color:${m.tagColor}">${m.tag}</span>
            <span class="tx">${m.text}</span>
            <div class="links"><span class="e" data-toast="Edit is inline in the real build.">Edit</span><span class="d" data-toast="Deleted — and everything Pokie inferred from it. It won’t come back on its own.">Delete</span></div>
          </div>`).join('')}
      </aside>
    </div>`,

  chat: () => `
    <div class="chat-shell rise">
      <div class="chat-top">
        <span class="chat-status"><span class="live-dot"></span>Autopilot on</span>
        <span class="ava" style="width:34px;height:34px">RT</span>
      </div>
      <div class="chat-centre">
        ${mark(46)}
        <div class="chat-greet">
          <span class="h">Morning, Rachit.</span>
          <span class="s">Three things want you. Or ask me anything.</span>
        </div>
        <div class="chat-composer-wrap">
          <div class="composer">
            <input id="chatInput" placeholder="Ask Pokie anything, or tell it what to hunt" aria-label="Ask Pokie">
            <button class="send-dot" data-go="chat-active" aria-label="Send">↑</button>
          </div>
          <div class="chip-row">
            ${CHAT_CHIPS.map(c => `<button class="sug-chip" data-go="chat-active">${c}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="chat-foot"><span>Everything Pokie did last night is in History.</span></div>
    </div>`,

  'chat-active': () => `
    <div class="chat-shell rise">
      <div class="chat-top hair">
        <span class="chat-status" style="font-size:15px;color:#9A9A9A"><span class="live-dot"></span>Swept 412 roles overnight · <span style="color:#fff">3 need you</span></span>
        <span class="ava" style="width:34px;height:34px">RT</span>
      </div>
      <div class="thread-scroll"><div class="thread">
        <div class="u-bubble">What happened last night?</div>
        <span class="a-text">Seven roles cleared your bar. I applied to three. Two want you — one is time-sensitive.</span>
        ${CHAT_CARDS.map(c => `
          <div class="result-card" style="border-color:${c.border}" data-go="${c.go}">
            <div class="rc-top"><span class="rc-kind" style="color:${c.kindColor}">${c.kind}</span><span class="rc-meta">${c.meta}</span></div>
            <span class="rc-title">${c.title}</span>
            <span class="rc-body">${c.body}</span>
            <div class="rc-actions">
              <span class="rc-primary" style="background:${c.primaryBg}">${c.primary}</span>
              <span class="rc-secondary">${c.secondary}</span>
            </div>
          </div>`).join('')}
        <div class="u-bubble">What did you skip, and why?</div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <span class="a-text md">Three hundred and sixty-one, almost all on comp. The four worth naming:</span>
          <div class="list-answer">
            ${SKIPPED.map(k => `<div class="row"><span class="role">${k.role}</span><span class="why">${k.reason}</span></div>`).join('')}
          </div>
        </div>
      </div></div>
      <div class="thread-composer">
        <div class="composer">
          <input placeholder="Reply to Pokie" aria-label="Reply to Pokie">
          <button class="send-dot" data-toast="This prototype ends at the thread — the real Pokie answers." aria-label="Send">↑</button>
        </div>
      </div>
    </div>`,

  jobs: () => {
    const everything = state.jobMode === 1;
    const list = filteredJobs();
    const sel = list.find(j => j.id === state.selectedJob) || JOBS.find(j => j.id === state.selectedJob) || list[0] || JOBS[0];
    const filters = ['Has a warm path', '₹80L+', 'Bangalore or remote', 'Series B+', 'Posted this week', 'AI / agents'];
    return `
    <div class="jobs rise ${state.mobileDetail ? 'show-detail' : ''}">
      <div class="jobs-head">
        <div class="jobs-head-top">
          <div class="mode-seg">
            <span class="${!everything ? 'on' : ''}" data-mode="0">Pokie’s picks <span class="ct">51</span></span>
            <span class="${everything ? 'on' : ''}" data-mode="1">Everything <span class="ct">90</span></span>
          </div>
          <div class="jobs-note">
            <span class="n">${everything ? 'Everything that passed your dealbreakers.' : 'Fit-sorted. Pokie read every one in full.'}</span>
            <button class="sort-pill" data-sort>${SORTS[state.sort || 0].label} ⌄</button>
          </div>
        </div>
        <div class="filter-row">
          ${filters.map((f, i) => {
            const on = !!state.jobFilter[i];
            const bg = on ? (i === 0 ? PINK : '#fff') : 'transparent';
            const fg = on ? '#070707' : '#9A9A9A';
            const bd = on ? (i === 0 ? PINK : '#fff') : 'rgba(255,255,255,.16)';
            return `<button class="f-chip" data-filter="${i}" style="background:${bg};color:${fg};border-color:${bd}">${f}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="jobs-body">
        <div class="job-list">
          ${!list.length ? `<div style="padding:40px 22px;text-align:center;display:flex;flex-direction:column;gap:6px">
              <span style="font-size:16px;font-weight:600;color:#9A9A9A">Nothing matches those filters.</span>
              <span style="font-size:13px;color:#5c5c5c">Your bar is intact — Pokie just has nothing worthy today. Drop a chip.</span>
            </div>` : ''}
          ${list.map(j => {
            const on = j.id === sel.id;
            const idx = JOBS.indexOf(j);
            const st = everything && EVERYTHING[idx] ? EVERYTHING[idx] : null;
            const note = st ? st.state : j.note;
            const noteFg = st ? st.stateFg : j.noteFg;
            const noteBg = st ? st.stateBg : j.noteBg;
            return `
            <button class="job-row" data-job="${j.id}" style="opacity:${j.opacity};${on ? `background:#141414;border-left-color:${j.color};` : ''}">
              <span class="job-av" style="background:${j.color}">${j.initials}</span>
              <span class="job-col">
                <span class="job-line1"><span class="job-role">${j.role}</span><span class="job-score" style="color:${j.color}">${j.score}</span></span>
                <span class="job-co">${j.company} · ${j.meta}</span>
                <span class="job-line3">
                  <span class="job-comp">${j.comp}</span>
                  ${note ? `<span class="job-note" style="color:${noteFg};background:${noteBg}">${note}</span>` : ''}
                </span>
              </span>
            </button>`;
          }).join('')}
          <div class="job-list-foot">
            <span class="a">${everything ? '322 hidden by dealbreakers only.' : '361 more were dropped against your bar.'}</span>
            <span class="b" data-toast="${everything ? 'The full 412, including dealbreakers — nothing is ever silently deleted.' : 'Dropped roles stay inspectable. The bar is yours, not Pokie’s.'}">${everything ? 'Show all 412 →' : 'Show me those anyway →'}</span>
          </div>
        </div>
        <div class="job-detail">
          <div class="jd-inner">
            <div class="jd-head">
              <span class="jd-av" style="background:${sel.color}">${sel.initials}</span>
              <div class="jd-tt">
                <span class="jd-role">${sel.role}</span>
                <span class="jd-co">${sel.company} · ${sel.meta} · posted 2 days ago</span>
              </div>
              <div class="jd-score"><span class="n" style="color:${sel.color}">${sel.score}</span><span class="c">fit</span></div>
            </div>
            ${sel.full ? `<div class="tag-row">${JOB_TAGS.map(t => `<span class="tag" style="color:${t.fg};background:${t.bg};border-color:${t.border}">${t.label}</span>`).join('')}</div>` : ''}
            <div class="read-card">
              <span class="eyebrow">Pokie’s read</span>
              <span class="tx">${sel.read}</span>
            </div>
            ${sel.full ? `
            <div class="two-col">
              <div class="score-card">
                <span class="eyebrow">Why 92</span>
                ${SCORE_BARS.map(b => `
                  <div class="sbar">
                    <div class="sbar-line"><span class="l">${b.label}</span><span class="v" style="color:${b.color}">${b.value}</span></div>
                    <div class="bar-track"><i style="width:${b.width};background:${b.color}"></i></div>
                  </div>`).join('')}
              </div>
              <div class="score-card">
                <span class="eyebrow">Checked, not assumed</span>
                ${SIGNALS.map(s => `<div class="signal"><span class="m" style="color:${s.color}">${s.mark}</span><span class="t">${s.text}</span></div>`).join('')}
              </div>
            </div>
            <div class="warm-banner">
              <span class="t">Ankita Rao worked with you at Swiggy and joined Sarvam in March.</span>
              <span class="a" data-toast="Pokie drafts the note to Ankita — it lands in Needs you, never sends itself.">Ask her first →</span>
            </div>
            <div class="read-card posting-card">
              <span class="eyebrow">The original posting</span>
              <span class="raw">We’re looking for an experienced product leader to join our rapidly growing team and drive the roadmap for our agent platform, working cross-functionally with research, engineering and design to deliver world-class outcomes…</span>
              <span class="link">Read all of it on the company site →</span>
            </div>` : ''}
          </div>
          <div class="jd-actions">
            <button class="pill primary" style="background:${PINK}" data-toast="Queued. Pokie applies with the tailored variant and logs it to History — undoable for 30 minutes.">Let Pokie apply</button>
            <button class="pill outline" data-toast="Opens the employer’s form. You still get the tailored CV, and the application is logged so scoring learns.">Apply myself</button>
            <button class="pill outline dim" style="border-color:rgba(255,255,255,.18)" data-toast="Watching ${sel.company}. Pokie alerts you on new roles, funding, or your contacts joining.">Watch company</button>
            <span class="note">Applying yourself still gets you the tailored CV.</span>
          </div>
        </div>
      </div>
    </div>`;
  },

  run: () => `
    <div class="run rise">
      <div class="run-main">
        <div class="run-status">
          <div style="display:flex;align-items:center;gap:14px">
            <span class="spinner" id="runSpin"></span>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span class="tt">Sweep #148 running</span>
              <span class="ss" id="runMeta">started 3m 12s ago · 412 sources · step 6 of 9</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="pill" id="pauseBtn" style="font-size:14px;font-weight:500;color:#9A9A9A;border:1px solid rgba(255,255,255,.18);padding:10px 20px">Pause</button>
            <button class="pill pinkline" style="font-size:14px;font-weight:600;padding:10px 20px" data-toast="Stopped. Everything found so far is kept; nothing half-done is sent.">Stop</button>
          </div>
        </div>
        <div class="steps-card" id="stepsCard">
          ${RUN_STEPS.map((s, i) => `
            <div class="step-row" data-step="${i}" style="${i === 0 ? 'border-top:none;' : ''}${s.mark === '◐' ? 'background:rgba(71,145,255,.07)' : ''}">
              <span class="mk" style="color:${s.color}">${s.mark}</span>
              <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
                <span class="tx" style="color:${s.mark === '✓' ? '#9A9A9A' : s.mark === '◐' ? '#fff' : DIM}">${s.text}</span>
                ${s.detail ? `<span class="dt">${s.detail}</span>` : ''}
              </div>
              <span class="du">${s.dur}</span>
            </div>`).join('')}
        </div>
        <div class="interject">
          <span class="dot"></span>
          <input id="interjectInput" placeholder="Steer this run — “skip anything below ₹70L” or “don’t touch Razorpay, I know them”">
          <button class="go" id="interjectBtn">Interject</button>
        </div>
      </div>
      <div class="run-side">
        <div class="side-card" style="gap:16px">
          <span class="eyebrow" style="font-size:13px">Found so far</span>
          <div class="counter"><span class="l">Scanned</span><span class="v" style="color:#fff">412</span></div>
          <div class="counter"><span class="l">Cleared bar</span><span class="v" style="color:${BLUE}">51</span></div>
          <div class="counter"><span class="l">Scored 85+</span><span class="v" style="color:${GREEN}" id="scored85">6</span></div>
          <div class="counter"><span class="l">Will need you</span><span class="v" style="color:${YELLOW}">2</span></div>
        </div>
        <div class="side-card" style="gap:10px">
          <span class="eyebrow" style="font-size:13px">Current thought</span>
          <span class="thought" id="thought">${THOUGHTS[0]}</span>
          <span class="thinking">thinking…</span>
        </div>
      </div>
    </div>`,

  approve: () => `
    <div class="approve rise">
      <div class="ap-main">
        <div class="ap-head">
          <div style="display:flex;flex-direction:column;gap:5px">
            <span class="ap-kind">Needs you · 1 of 3</span>
            <span class="ap-title">Outreach to Vivek Raman, Sarvam AI</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="pill" style="font-size:14px;color:#5c5c5c;padding:10px 16px" data-toast="Skipped. It waits in Needs you — nothing is sent.">Skip</button>
            <button class="pill outline" style="font-size:14px;font-weight:500;padding:10px 20px;border-color:rgba(255,255,255,.18)" data-toast="Next: Sarvam’s 200-word question. 2 of 3.">Next →</button>
          </div>
        </div>
        <div class="draft-card">
          <div class="draft-meta">
            <span class="s">Subject · <b>Agents that survive contact with users</b></span>
            <span class="m">192 words · reads in 48s</span>
          </div>
          ${DRAFT_LINES.map(l => `<span class="draft-line" style="background:${l.bg}">${l.text}</span>`).join('')}
          <div class="draft-src">
            <span style="color:#5c5c5c">Highlighted phrases were pulled from your memory —</span>
            <span style="color:${GREEN}">Swiggy case study</span><span style="color:#5c5c5c">·</span><span style="color:${GREEN}">your note on eval loops</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="pill primary" style="background:${GREEN}" id="approveBtn">Approve &amp; send</button>
          <button class="pill outline" data-toast="Opens the draft in place. Your edits also teach Pokie.">Edit first</button>
          <button class="pill pinkline" style="font-size:15px;font-weight:500;padding:14px 26px" data-toast="Not sent. Tell Pokie why with a teach chip so the next one is right.">Don’t send</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="side-card">
          <span class="eyebrow" style="font-size:13px">Why Pokie wrote this</span>
          ${WHY_POINTS.map(w => `<div class="why-point"><span class="m" style="color:${w.color}">${w.mark}</span><span class="t">${w.text}</span></div>`).join('')}
        </div>
        <div class="teach-card">
          <span class="lb">Teach Pokie</span>
          <span class="ex">Whatever you change here becomes a rule for every future draft, not just this one.</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${TEACH.map((t, i) => {
              const on = !!state.teach[i];
              return `<button class="teach-chip" data-teach="${i}" style="${on ? `background:${YELLOW};color:#070707;border-color:${YELLOW}` : 'background:transparent;color:#9A9A9A;border-color:rgba(255,255,255,.16)'}">${t}</button>`;
            }).join('')}
          </div>
          <input class="teach-input" placeholder="or say it in your words…">
        </div>
        <div class="side-card" style="gap:8px">
          <span class="eyebrow" style="font-size:13px">Last 5 you approved</span>
          <span style="font-size:14px;color:#9A9A9A;line-height:1.55">You shortened 4 of 5 and cut every adjective. Pokie has already dropped its average draft to 190 words.</span>
        </div>
      </div>
    </div>`,

  cvlab: () => `
    <div class="cvlab rise">
      <div class="cv-col">
        <div class="cv-col-head"><span class="eyebrow" style="font-size:13px">Versions</span><span class="cv-new" data-toast="Describe the role family and Pokie builds the variant from base.">+ New</span></div>
        ${CV_VERSIONS.map((v, i) => `
          <button class="cv-version ${state.cv === i ? 'on' : ''}" data-cv="${i}">
            <span class="l1"><span class="nm">${v.name}</span><span class="rt" style="color:${v.rateColor}">${v.rate}</span></span>
            <span class="nt">${v.note}</span>
          </button>`).join('')}
      </div>
      <div class="cv-col" style="gap:16px">
        <div class="cv-title-row">
          <div style="display:flex;flex-direction:column;gap:5px">
            <span class="t">${CV_VERSIONS[state.cv].name}${state.cv === 1 ? ' variant' : ''}</span>
            <span class="s">${state.cv === 1 ? 'Generated for Sarvam AI · 11 changes from base · you approved 9' : state.cv === 0 ? 'The source of truth. Variants are built from here.' : 'Generated variant · diffs shown against base'}</span>
          </div>
          <button class="pill outline" style="font-size:14px;font-weight:500;padding:10px 20px;border-color:rgba(255,255,255,.18)" data-toast="PDF with the approved changes only.">Download PDF</button>
        </div>
        <div class="diff-card">
          ${CV_DIFF.map((d, i) => `
            <div class="diff-row" style="${i === 0 ? 'border-top:none;' : ''}background:${d.bg}">
              <span class="mk" style="color:${d.color}">${d.mark}</span>
              <div style="display:flex;flex-direction:column;gap:4px">
                <span class="tx" style="color:${d.tc}">${d.text}</span>
                <span class="wy">${d.why}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="cv-col" style="gap:14px">
        <div class="side-card" style="gap:14px">
          <span class="eyebrow" style="font-size:13px">How versions perform</span>
          ${CV_PERF.map(p => `
            <div class="perf-row">
              <div class="perf-line"><span class="n">${p.name}</span><span class="r" style="color:${p.color}">${p.rate}</span></div>
              <div class="perf-track"><i style="display:block;height:100%;width:${p.width};background:${p.color}"></i></div>
            </div>`).join('')}
        </div>
        <div class="insight">
          <span class="h">Pokie noticed</span>
          <span class="b">Versions that lead with a number get replies 2.4× more often. Want it to rewrite the base opener that way?</span>
          <span class="a" data-toast="Rewriting the base opener. The change lands in History — undoable.">Do it →</span>
        </div>
      </div>
    </div>`,

  memory: () => `
    <div class="memory rise">
      <div class="page-head">
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="t">What Pokie believes about you.</span>
          <span class="s">Every belief has a source. Delete one and Pokie forgets it for good — including everything it inferred from it.</span>
        </div>
        <div class="search-pill"><span class="g">⌕</span><input placeholder="search memory"></div>
      </div>
      ${MEMORY.map(g => `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="mem-group-head"><span class="l" style="color:${g.color}">${g.title}</span><span class="s">${g.sub}</span></div>
          <div class="mem-grid">
            ${g.items.filter(m => !state.forgotten[m.id]).map(m => `
              <div class="mem-card" data-mem="${m.id}">
                <span class="tx">${m.text}</span>
                <span class="src">${m.source}</span>
                <div class="btns">
                  <button class="mc-pill edit" data-toast="Edit is inline in the real build — the provenance line updates to ‘corrected by you’.">Edit</button>
                  <button class="mc-pill forget" data-forget="${m.id}">Forget</button>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`,

  history: () => {
    const tab = state.histTab;
    return `
    <div class="history rise">
      <div class="page-head">
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="t">Everything Pokie has done.</span>
          <span class="s">Complete audit trail. Anything with an undo can be pulled back — including sent mail, within 30 minutes.</span>
        </div>
        <div class="hist-tabs">
          ${['All', 'Pokie', 'Undoable'].map((t, i) => `<span class="${tab === i ? 'on' : ''}" data-htab="${i}">${t}</span>`).join('')}
        </div>
      </div>
      ${HISTORY.map(d => {
        const rows = d.rows.filter(r =>
          tab === 0 || (tab === 1 && r.actor === 'Pokie') || (tab === 2 && r.undoable && !state.undone[r.id]));
        if (!rows.length) return '';
        return `
        <div style="display:flex;flex-direction:column;gap:10px">
          <span class="day-label">${d.day}</span>
          <div class="day-card">
            ${rows.map((r, i) => {
              const undone = state.undone[r.id];
              const isPokie = r.actor === 'Pokie';
              const aBorder = undone ? 'rgba(255,255,255,.1)' : r.undoable ? 'rgba(255,255,255,.2)' : r.review ? 'rgba(236,226,46,.4)' : 'rgba(255,255,255,.14)';
              const aFg = undone ? '#5c5c5c' : r.undoable ? '#fff' : r.review ? YELLOW : '#9A9A9A';
              return `
              <div class="hist-row" style="${i === 0 ? 'border-top:none' : ''}">
                <span class="tm">${r.time}</span>
                <span class="actor" style="background:${isPokie ? 'rgba(235,107,168,.16)' : '#212121'};color:${isPokie ? PINK : '#fff'}">${r.actor}</span>
                <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
                  <span class="tx" style="${undone ? 'color:#5c5c5c;text-decoration:line-through' : ''}">${r.text}</span>
                  <span class="dt">${undone ? 'Undone just now' : r.detail}</span>
                </div>
                <button class="hist-act" data-hist="${r.id}" data-undo="${r.undoable ? 1 : 0}" style="border-color:${aBorder};color:${aFg}" ${undone ? 'disabled' : ''}>${undone ? 'Undone' : r.action}</button>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  },

  brief: () => `
    <div class="brief rise">
      <div class="brief-top">
        <span class="t">${mark(24)} Good morning</span>
        <span class="on-pill"><span class="live-dot"></span>On</span>
      </div>
      <div class="brief-hero">
        <span class="l">While you slept · sweep #148</span>
        <span class="h">7 cleared your bar. 3 are already applied to.</span>
        <div class="stats"><span>412 scanned</span><span>7 matched</span><span>3 applied</span></div>
      </div>
      <div class="brief-sec"><span class="t">3 decisions</span><span class="s">about 6 minutes</span></div>
      <div class="brief-prog"><i style="background:${GREEN}"></i><i style="background:#212121"></i><i style="background:#212121"></i></div>
      ${DECISIONS.map(d => `
        <div class="decision" style="border-color:${d.border}">
          <div class="l1"><span class="kd" style="color:${d.kindColor}">${d.kind}</span><span class="ag">${d.age}</span></div>
          <span class="tt">${d.title}</span>
          <span class="sb">${d.sub}</span>
          <div class="acts">
            <span class="p" style="background:${d.primaryBg}" data-go="approve">${d.primary}</span>
            <span class="s2" data-toast="Waits for you. Nothing expires without a nudge first.">${d.secondary}</span>
          </div>
        </div>`).join('')}
      <div class="handled">
        <span class="eyebrow">Quietly handled</span>
        ${HANDLED.map(h => `<div class="row"><span class="dot" style="background:${h.color}"></span><span class="tx">${h.text}</span></div>`).join('')}
        <span class="cta" data-go="history">See all 14 →</span>
      </div>
    </div>`,
};

/* ================= Router & wiring ================= */
const COLD = ['onboard'];
const app = $('#app'), main = $('#main'), rail = $('#rail'), tabbar = $('#tabbar');

function go(screen) {
  if (screen === state.screen && screen !== 'jobs') return;
  stopRunSim();
  state.screen = screen;
  state.mobileDetail = false;
  location.hash = screen;
  render();
}

/* State survives refresh — teach rules, forgotten memories, undone actions, filters. */
const PERSIST = ['jobMode', 'jobFilter', 'selectedJob', 'teach', 'cv', 'histTab', 'undone', 'forgotten', 'sort'];
function saveState() {
  try { localStorage.setItem('pokie-state', JSON.stringify(Object.fromEntries(PERSIST.map(k => [k, state[k]])))); } catch (e) {}
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem('pokie-state') || '{}');
    PERSIST.forEach(k => { if (raw[k] !== undefined) state[k] = raw[k]; });
  } catch (e) {}
}

function render() {
  saveState();
  const cold = COLD.includes(state.screen);
  app.classList.toggle('cold', cold);
  rail.innerHTML = cold ? '' : railHTML();
  tabbar.innerHTML = tabbarHTML();
  const fn = SCREENS[state.screen] || SCREENS.chat;
  main.innerHTML = fn();
  main.scrollTop = 0;
  if (state.screen === 'run') startRunSim();
  if (state.screen === 'chat') { const i = $('#chatInput'); if (i && matchMedia('(min-width:900px)').matches) i.focus(); }
}

/* Delegated events */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    if (nav.dataset.stub) { toast(`${nav.querySelector('.lb').textContent} is in the handoff’s IA — not built in this prototype yet.`); return; }
    go(nav.dataset.nav);
    return;
  }
  const goTo = e.target.closest('[data-go]');
  if (goTo) {
    const t = goTo.dataset.toast;
    go(goTo.dataset.go);
    if (t) toast(t);
    return;
  }
  const jobRow = e.target.closest('[data-job]');
  if (jobRow) {
    state.selectedJob = jobRow.dataset.job;
    if (matchMedia('(max-width:900px)').matches) state.mobileDetail = true;
    render();
    return;
  }
  const mode = e.target.closest('[data-mode]');
  if (mode && e.target.closest('.mode-seg')) { state.jobMode = +mode.dataset.mode; render(); return; }
  const srt = e.target.closest('[data-sort]');
  if (srt) { state.sort = ((state.sort || 0) + 1) % SORTS.length; render(); return; }
  const filt = e.target.closest('[data-filter]');
  if (filt) { state.jobFilter[filt.dataset.filter] = !state.jobFilter[filt.dataset.filter]; render(); return; }
  const teach = e.target.closest('[data-teach]');
  if (teach) { state.teach[teach.dataset.teach] = !state.teach[teach.dataset.teach]; render(); return; }
  const cv = e.target.closest('[data-cv]');
  if (cv) { state.cv = +cv.dataset.cv; render(); return; }
  const htab = e.target.closest('[data-htab]');
  if (htab) { state.histTab = +htab.dataset.htab; render(); return; }
  const hist = e.target.closest('[data-hist]');
  if (hist && !hist.disabled) {
    if (hist.dataset.undo === '1') {
      state.undone[hist.dataset.hist] = true;
      render();
      toast('Undone. The application is withdrawn and History shows both moves.');
    } else toast('Opens the full record — inputs, outputs, and what Pokie consulted.');
    return;
  }
  const forget = e.target.closest('[data-forget]');
  if (forget) {
    const card = forget.closest('.mem-card');
    card.classList.add('forgetting');
    const id = forget.dataset.forget;
    setTimeout(() => { state.forgotten[id] = true; render(); }, 300);
    toast('Forgotten — along with everything Pokie inferred from it.', 'Undo', () => { delete state.forgotten[id]; render(); });
    return;
  }
  const seg = e.target.closest('.seg [data-mode]');
  if (seg) {
    const wrap = seg.parentElement;
    const colors = [PINK, YELLOW, GREEN];
    wrap.querySelectorAll('span').forEach(s => { s.style.background = ''; s.style.color = ''; });
    seg.style.background = colors[+seg.dataset.mode];
    seg.style.color = '#070707';
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const on = chip.style.background !== 'transparent' && chip.style.background !== '';
    chip.style.cssText = on
      ? 'background:transparent;color:#9A9A9A;border-color:rgba(255,255,255,.16)'
      : 'background:#fff;color:#070707;border-color:#fff';
    return;
  }
  const tst = e.target.closest('[data-toast]');
  if (tst) { toast(tst.dataset.toast); return; }
  const ap = e.target.closest('#approveBtn');
  if (ap) {
    const taught = Object.keys(state.teach).filter(k => state.teach[k]).length;
    toast(taught
      ? `Sent — and ${taught} rule${taught > 1 ? 's' : ''} written to Memory for every future draft. Undoable for 30 minutes.`
      : 'Sent from your name. Undoable for 30 minutes — it’s in History.');
    return;
  }
  const pause = e.target.closest('#pauseBtn');
  if (pause) {
    state.runPaused = !state.runPaused;
    pause.textContent = state.runPaused ? 'Resume' : 'Pause';
    const sp = $('#runSpin');
    if (sp) sp.style.animationPlayState = state.runPaused ? 'paused' : 'running';
    toast(state.runPaused ? 'Paused mid-step. Nothing is lost.' : 'Resumed.');
    return;
  }
  const ij = e.target.closest('#interjectBtn');
  if (ij) {
    const input = $('#interjectInput');
    const v = (input.value || '').trim() || 'Skip anything below ₹70L';
    input.value = '';
    const card = $('#stepsCard');
    if (card) {
      card.insertAdjacentHTML('beforeend', `
        <div class="step-row rise" style="background:rgba(71,145,255,.07)">
          <span class="mk" style="color:${BLUE}">◐</span>
          <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
            <span class="tx" style="color:#fff">Apply your instruction: “${v}”</span>
            <span class="dt">Injected mid-run · re-checking 17 already-scored roles against it</span>
          </div>
          <span class="du">now</span>
        </div>`);
      card.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    toast('Interjected. The run adjusts without starting over.');
    return;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'chatInput') go('chat-active');
  if (e.key === 'Enter' && e.target.id === 'interjectInput') $('#interjectBtn')?.click();
});

/* Run simulation: scoring counter ticks, thought rotates */
let runIv = null, thoughtIx = 0;
function startRunSim() {
  stopRunSim();
  runIv = setInterval(() => {
    if (state.runPaused) return;
    state.runScored = Math.min(51, state.runScored + 1);
    const cur = main.querySelector('[data-step="5"] .dt');
    if (cur) cur.textContent = `${state.runScored} of 51 done · currently reading ${['Cred, Group PM Money', 'Razorpay, Principal PM', 'Postman, Senior PM Seller'][state.runScored % 3]}`;
    if (state.runScored % 4 === 0) {
      thoughtIx = (thoughtIx + 1) % THOUGHTS.length;
      const th = $('#thought');
      if (th) th.textContent = THOUGHTS[thoughtIx];
    }
    const sc = $('#scored85');
    if (sc && state.runScored > 44) sc.textContent = '7';
  }, 1800);
}
function stopRunSim() { if (runIv) { clearInterval(runIv); runIv = null; } }

/* Toast */
let toastTimer;
function toast(text, actionLabel, action) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  t.innerHTML = `<span>${text}</span>${actionLabel ? `<button>${actionLabel}</button>` : ''}`;
  if (actionLabel) t.querySelector('button').addEventListener('click', () => { action?.(); t.classList.remove('show'); });
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

/* ================= Boot ================= */
loadState();
const initial = location.hash.replace('#', '');
if (SCREENS[initial]) state.screen = initial;
window.addEventListener('hashchange', () => {
  const s = location.hash.replace('#', '');
  if (SCREENS[s] && s !== state.screen) { state.screen = s; state.mobileDetail = false; stopRunSim(); render(); }
});
render();
console.log('%c◆ Pokie — it hunts, you decide.', 'color:#EB6BA8;font-weight:600');
