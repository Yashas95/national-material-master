(function () {
'use strict';
const N = window.NUMMF, G = window.NUMMF_3D;
const LS_KEY = 'nummf-state-v1';
const $ = (s, el) => (el || document).querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const fmtRs = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 });
const fmtRsShort = n => n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : fmtRs(n);
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const pct1 = x => x == null ? '—' : (x * 100).toFixed(1) + '%';
const nmcFmt = n => 'NMC-' + String(n).padStart(8, '0');
const fmtDate = iso => { const d = new Date(iso); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); };
const fmtDay = iso => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const clone = o => JSON.parse(JSON.stringify(o));

const ROLES = {
  SUPER_ADMIN: { label: 'Super administrator', desc: 'Platform governance, configuration and second-level approval.', can: ['review', 'l2', 'settings', 'upload'] },
  CPSE_ADMIN: { label: 'CPSE administrator', desc: 'Uploads and reviews data for one CPSE. Other CPSEs’ codes are masked.', can: ['review', 'upload'] },
  MATERIAL_EXPERT: { label: 'Material expert', desc: 'Reviews matches, standard descriptions and attributes.', can: ['review'] },
  PROCUREMENT_OFFICER: { label: 'Procurement officer', desc: 'Read-only access to mappings and procurement opportunities.', can: [] },
  AUDITOR: { label: 'Auditor', desc: 'Read-only access to decisions, lineage and the audit log.', can: [] },
  VIEWER: { label: 'Viewer', desc: 'Read-only access to approved national materials.', can: [] },
};
const SYN_REVIEWERS = ['R. Iyer', 'S. Banerjee', 'K. Menon', 'A. Qureshi', 'P. Deshmukh'];
const STATUS = {
  PENDING: ['Pending review', 'p-acc'], APPROVED: ['Approved', 'p-ok'], AWAITING_L2: ['Awaiting second approval', 'p-warn'],
  ESCALATED: ['Escalated', 'p-warn'], REJECTED: ['Rejected', 'p-bad'],
};
const CLS = {
  EXACT_MATCH: ['Exact match', 'p-ok'], NEAR_DUPLICATE: ['Near duplicate', 'p-ok'], FUNCTIONALLY_EQUIVALENT: ['Functionally equivalent', 'p-info'],
  VARIANT: ['Variant', 'p-bad'], RELATED: ['Related', 'p-mute'], NON_MATCH: ['Non-match', 'p-mute'], REQUIRES_REVIEW: ['Requires review', 'p-warn'],
};
const BANDS = { STRONG: ['Strong match', 'p-ok'], REVIEW: ['Human review', 'p-info'], INVESTIGATE: ['Manual investigation', 'p-warn'], NO_MATCH: ['No match', 'p-mute'], SINGLE: ['Single record', 'p-mute'] };
const pill = (map, k) => { const v = map[k] || [k, 'p-mute']; return `<span class="pill ${v[1]}">${esc(v[0])}</span>`; };
const CPSE_COLORS = Object.fromEntries(N.CPSES.map(c => [c.id, c.color]));

/* ---------------- State ---------------- */
const BASE = N.generate(2026).records;
let RES = null;
const S = {
  role: null, tenant: 'A', theme: null, config: clone(N.DEFAULT_CONFIG), uploadedRecords: [], uploads: [],
  decisions: {}, attachDecisions: {}, registry: {}, nextCode: 1, retired: [], audit: [], lastReport: null,
  hero: { run: false, step: -1 }, seeded: false,
  ui: { ex: { q: '', cpse: '', cat: '', status: '', page: 0, sel: [] }, rv: { filter: 'OPEN', sel: null, a: null, b: null, editing: false }, cl: { open: null, tab: 'clusters' }, nm: { q: '', status: '', cat: '' }, mp: { cpse: '', status: '' }, pr: { sel: null }, gov: { tab: 'audit', q: '', action: '', rec: null, api: 0 }, dq: { type: '' } },
};
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, role: S.role, tenant: S.tenant, theme: S.theme, config: S.config, uploadedRecords: S.uploadedRecords, uploads: S.uploads, decisions: S.decisions, attachDecisions: S.attachDecisions, registry: S.registry, nextCode: S.nextCode, retired: S.retired, audit: S.audit.slice(0, 800), seeded: S.seeded }));
  } catch (e) { /* storage unavailable: keep in memory */ }
}
function load() {
  try { const raw = localStorage.getItem(LS_KEY); if (!raw) return false; const o = JSON.parse(raw); if (o.v !== 1) return false; Object.assign(S, o); delete S.v; return true; } catch (e) { return false; }
}
function runPipeline() {
  RES = N.run(BASE.concat(S.uploadedRecords), S.config);
  for (const c of RES.clusters) if (!S.registry[c.key]) S.registry[c.key] = S.nextCode++;
}
const actorName = () => S.role === 'CPSE_ADMIN' ? `You (${ROLES.CPSE_ADMIN.label}, CPSE ${S.tenant})` : `You (${ROLES[S.role].label})`;
function audit(action, target, detail, extra, at, actor, role) {
  S.audit.unshift({ id: 'AUD-' + String(S.audit.length + 1).padStart(6, '0'), at: at || new Date().toISOString(), actor: actor || actorName(), role: role || (S.role ? ROLES[S.role].label : 'System'), action, target, detail, extra: extra || null });
}
function seedHistory() {
  const t0 = Date.parse('2026-08-03T09:15:00Z');
  const entries = [];
  N.CPSES.forEach((c, i) => entries.push(['DATASET_INGESTED', `CPSE ${c.id}`, `${RES.records.filter(r => r.cpse === c.id && r.source.startsWith('Synthetic')).length} records ingested from ${c.erp} (${c.format}, synthetic).`, null, new Date(t0 + i * 1800e3).toISOString(), `${c.short} data steward (synthetic)`, 'CPSE administrator']));
  entries.push(['PIPELINE_RUN', 'All CPSEs', `Harmonization pipeline completed: ${RES.stats.clusters} national material candidates from ${RES.stats.records} records.`, { config: S.config }, new Date(t0 + 4 * 3600e3).toISOString(), 'Harmonization service', 'System']);
  let k = 0;
  RES.clusters.forEach(c => {
    if (c.key === N.DEMO_BOLT_KEY) return;
    const h = N.hashStr(c.key) % 100;
    const at = new Date(t0 + 86400e3 * (2 + (k++ % 52)) + h * 600e3).toISOString();
    const by = SYN_REVIEWERS[h % SYN_REVIEWERS.length] + ' (synthetic reviewer)';
    if (c.key === N.DEMO_BEARING_KEY || (h < 50 && c.band !== 'INVESTIGATE')) {
      S.decisions[c.key] = { status: 'APPROVED', by, at, note: '', versions: [{ v: 1, at, by, change: 'Created from AI recommendation', reason: 'Critical attributes and source records verified.', desc: c.stdDesc }] };
      entries.push(['NMC_APPROVED', nmcFmt(S.registry[c.key]), `Approved ${c.stdDesc} mapping ${c.members.length} legacy codes.`, null, at, by, 'Material expert']);
    } else if (c.band === 'INVESTIGATE' && h > 80) {
      S.decisions[c.key] = { status: 'ESCALATED', by, at, note: 'Price spread across CPSEs looks unusual; please verify unit of measure.', versions: [] };
      entries.push(['RECOMMENDATION_ESCALATED', nmcFmt(S.registry[c.key]), 'Escalated for second-level review: unit of measure needs confirmation.', null, at, by, 'Material expert']);
    }
  });
  RES.attachments.forEach(a => {
    const h = N.hashStr(a.recordId) % 100;
    const c = RES.clusterByKey.get(a.clusterKey);
    if (h < 30 && a.clusterKey !== N.DEMO_BOLT_KEY && S.decisions[a.clusterKey]?.status === 'APPROVED') {
      const at = new Date(Date.parse(S.decisions[a.clusterKey].at) + 3 * 3600e3).toISOString();
      const by = SYN_REVIEWERS[(h + 2) % SYN_REVIEWERS.length] + ' (synthetic reviewer)';
      S.attachDecisions[a.recordId] = { status: 'APPROVED', clusterKey: a.clusterKey, by, at, note: 'Missing attribute confirmed from purchase order text.' };
      const r = RES.byId.get(a.recordId);
      entries.push(['MAPPING_APPROVED', `${r.cpse}:${r.code}`, `Mapped incomplete record to ${nmcFmt(S.registry[c.key])} after confirming ${r.missing.map(m => N.ATTR_LABELS[m].toLowerCase()).join(', ')}.`, null, at, by, 'Material expert']);
    }
  });
  entries.sort((a, b) => a[4].localeCompare(b[4]));
  entries.forEach(e => audit(...e));
  S.seeded = true;
}

/* ---------------- Derived helpers ---------------- */
const statusOf = key => (S.decisions[key] && S.decisions[key].status) || 'PENDING';
const descOf = c => (S.decisions[c.key] && S.decisions[c.key].desc) || c.stdDesc;
const versionOf = c => { const v = S.decisions[c.key]?.versions; return v && v.length ? v[v.length - 1].v : 0; };
const nmcOf = key => nmcFmt(S.registry[key]);
const can = p => S.role && ROLES[S.role].can.includes(p);
const visible = r => S.role !== 'CPSE_ADMIN' || r.cpse === S.tenant;
const codeOf = r => visible(r) ? r.code : 'Restricted';
const descRec = r => visible(r) ? r.desc : 'Restricted to CPSE ' + r.cpse;
const cpseTag = id => `<span class="cpse"><i class="dot" style="background:${CPSE_COLORS[id]}"></i>CPSE ${id}</span>`;
const cpseDots = ids => `<span class="row" style="gap:3px">${ids.map(id => `<i class="dot" title="CPSE ${id}" style="background:${CPSE_COLORS[id]}"></i>`).join('')}</span>`;
function canReviewCluster(c) {
  if (!can('review')) return false;
  if (S.role === 'CPSE_ADMIN') return c.cpses.includes(S.tenant);
  return true;
}
function recordStatus(r) {
  if (r.category === 'UNCLASSIFIED') return ['Insufficient information', 'p-mute'];
  if (r.complete) {
    const s = statusOf(r.clusterKey);
    if (s === 'APPROVED') return ['Mapped', 'p-ok'];
    if (s === 'REJECTED') return ['Rejected', 'p-bad'];
    return ['Proposed', 'p-acc'];
  }
  const d = S.attachDecisions[r.id];
  if (d && d.status === 'APPROVED') return ['Mapped (reviewed)', 'p-ok'];
  if (d && d.status === 'REJECTED') return ['Unmapped', 'p-bad'];
  return ['Needs review', 'p-warn'];
}
function mappedNMC(r) {
  if (r.complete) return r.clusterKey;
  const d = S.attachDecisions[r.id];
  if (d && d.status === 'APPROVED') return d.clusterKey;
  return r.suggestedCluster || null;
}
function memberConf(c, id) {
  const sc = c.members.filter(m => m !== id).map(m => RES.pairOf(id, m)).filter(Boolean).map(p => p.score);
  return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
}
function counts() {
  const recs = RES.records;
  let mapped = 0, proposed = 0, unmapped = 0;
  for (const r of recs) { const s = recordStatus(r)[0]; if (s.startsWith('Mapped')) mapped++; else if (s === 'Proposed') proposed++; else unmapped++; }
  const approvedNMC = RES.clusters.filter(c => statusOf(c.key) === 'APPROVED').length;
  const pendingClusters = RES.clusters.filter(c => ['PENDING', 'ESCALATED', 'AWAITING_L2'].includes(statusOf(c.key))).length;
  const pendingAttach = RES.attachments.filter(a => !S.attachDecisions[a.recordId]).length;
  return { mapped, proposed, unmapped, approvedNMC, pendingClusters, pendingAttach, pending: pendingClusters + pendingAttach };
}

/* ---------------- Icons ---------------- */
const IC = {
  overview: '<path d="M2 2h5v5H2zM9 2h5v3H9zM9 7h5v7H9zM2 9h5v5H2z"/>',
  intake: '<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2 11v3h12v-3"/>',
  explorer: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  review: '<path d="M2 8.5 6 12l8-8"/>',
  clusters: '<circle cx="5" cy="6" r="2.5"/><circle cx="11" cy="6" r="2.5"/><circle cx="8" cy="11" r="2.5"/>',
  master: '<path d="M8 1.5 14 5v6l-6 3.5L2 11V5z"/><path d="M8 8.5V14.5M2 5l6 3.5L14 5"/>',
  mappings: '<path d="M2 4h5M2 8h5M2 12h5M9 4l5 4-5 4"/>',
  procurement: '<path d="M2 13h12M4 13V8M8 13V4M12 13V9"/>',
  governance: '<path d="M8 1.5 13.5 4v4c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V4z"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
};
const icon = (k, s) => `<svg width="${s || 16}" height="${s || 16}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
const LOGO = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="#F2A93B" stroke-width="1.6"/><circle cx="16" cy="16" r="3.2" fill="#F2A93B"/><g stroke="#8EA6BF" stroke-width="1.1"><path d="M16 16 9 11.5M16 16l7-4.5M16 16v8.5"/></g><circle cx="9" cy="11.5" r="1.7" fill="#5B8DEF"/><circle cx="23" cy="11.5" r="1.7" fill="#2FB3A3"/><circle cx="16" cy="24.5" r="1.7" fill="#A77BE0"/></svg>`;

const PAGES = [
  ['overview', 'National dashboard'], ['intake', 'Data intake'], ['explorer', 'Material explorer'], ['review', 'Match review'],
  ['clusters', 'Duplicate detection'], ['master', 'National material master'], ['mappings', 'Mapping explorer'],
  ['procurement', 'Procurement opportunities'], ['governance', 'Governance and audit'], ['settings', 'Settings and rules'],
];
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  return { page: PAGES.some(p => p[0] === page) ? page : 'overview', params };
}

/* ---------------- Shell ---------------- */
function shell() {
  const r = route();
  const c = counts();
  const nav = PAGES.map(([k, l], i) => `${i === 4 || i === 8 ? '<div class="nav-sep"></div>' : ''}<a href="#/${k}" ${r.page === k ? 'aria-current="page"' : ''}>${icon(k)}<span>${l}</span>${k === 'review' && c.pending ? `<span class="count">${c.pending}</span>` : ''}</a>`).join('');
  return `<div class="app">
  <aside class="side">
    <div class="brand">${LOGO}<div><b>National Material Master</b><span>One Nation, One Material Code</span></div></div>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="side-foot">Signed in as <b>${esc(ROLES[S.role].label)}</b>${S.role === 'CPSE_ADMIN' ? ` for CPSE <b>${S.tenant}</b>` : ''}<br><button class="btn sm on-dark" style="margin-top:8px" data-act="signout">Switch role</button></div>
  </aside>
  <div class="main">
    <header class="top">
      <form class="search" data-form="gsearch" role="search">${icon('search', 15)}<input name="q" type="search" placeholder="Search materials, e.g. stainless steel 304 bolt m16" aria-label="Search materials" value="${esc(S.ui.ex.q)}"></form>
      <div class="spacer"></div>
      <span class="synthetic" title="All CPSEs, records, prices and reviewers in this demonstration are synthetic.">Synthetic data</span>
      <label class="who">Role <select data-input="role" aria-label="Role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === S.role ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      ${S.role === 'CPSE_ADMIN' ? `<label class="who">CPSE <select data-input="tenant">${N.CPSES.map(c => `<option value="${c.id}" ${c.id === S.tenant ? 'selected' : ''}>${c.id}</option>`).join('')}</select></label>` : ''}
      <button class="btn sm" data-act="theme" aria-label="Toggle colour theme">${themeIsDark() ? 'Light' : 'Dark'}</button>
    </header>
    <main class="content" id="content"></main>
  </div></div>
  <div id="overlay"></div>`;
}
function themeIsDark() { return S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function applyTheme() { if (S.theme) document.documentElement.setAttribute('data-theme', S.theme); else document.documentElement.removeAttribute('data-theme'); }

function loginScreen() {
  return `<div class="login" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
  <div class="login-l">
    <div class="row" style="gap:12px">${LOGO}<span style="font-weight:600">National Unified Material Master Framework</span></div>
    <div>
      <h1 id="loginTitle">One Nation. One Material Code.</h1>
      <p>A shared national material identity for Central Public Sector Enterprises. Each CPSE keeps its ERP and its legacy codes; the platform finds where they describe the same material, a human approves it, and both sides stay traceable.</p>
    </div>
    <p class="fine">Demonstration build. Five CPSEs, ${fmtN(RES.records.length)} material records, prices and reviewers are all synthetic. Matching runs entirely in your browser.</p>
  </div>
  <form class="login-r" data-form="login">
    <h2 style="color:#fff">Sign in</h2>
    <p style="color:var(--bp-muted);font-size:13px;margin-top:4px">Choose a role to see what it can do. Permissions change across every screen.</p>
    <div class="roles">${Object.entries(ROLES).map(([k, v], i) => `<label class="role"><input type="radio" name="role" value="${k}" ${i === 0 ? 'checked' : ''}><span><b>${v.label}</b><span>${v.desc}</span></span></label>`).join('')}</div>
    <label class="row" style="font-size:13px;color:var(--bp-muted);margin-bottom:16px">CPSE for administrator role <select name="tenant">${N.CPSES.map(c => `<option value="${c.id}">${c.id}: ${c.name}</option>`).join('')}</select></label>
    <button class="btn primary" type="submit" style="justify-content:center;padding:10px">Enter the platform</button>
    <p style="font-size:12px;color:var(--bp-muted);margin-top:12px">Demo sign-in without a password. Production would use OAuth2 / JWT with each CPSE’s identity provider.</p>
  </form></div>`;
}

/* ---------------- Charts (inline SVG) ---------------- */
function stackedBars(rows, keys, colors, w) {
  w = w || 520; const rowH = 30, lw = 70, max = Math.max(1, ...rows.map(r => keys.reduce((s, k) => s + r[k], 0)));
  const h = rows.length * rowH + 4;
  const inner = w - lw - 46;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Stacked bar chart">${rows.map((r, i) => {
    let x = lw; const y = i * rowH + 6;
    const segs = keys.map((k, j) => { const ww = r[k] / max * inner; const s = `<rect x="${x}" y="${y}" width="${Math.max(0, ww)}" height="16" fill="${colors[j]}" rx="2"><title>${esc(r.label)}: ${k} ${r[k]}</title></rect>`; x += ww; return s; }).join('');
    const tot = keys.reduce((s, k) => s + r[k], 0);
    return `<text x="0" y="${y + 12}" font-size="12" fill="currentColor">${esc(r.label)}</text>${segs}<text x="${x + 6}" y="${y + 12}" font-size="11.5" fill="var(--muted)" font-family="var(--mono)">${tot}</text>`;
  }).join('')}</svg>`;
}
function hBars(rows, color, w, fmt) {
  w = w || 520; const rowH = 26, lw = 150, max = Math.max(1, ...rows.map(r => r.value)); const h = rows.length * rowH + 4; const inner = w - lw - 60;
  fmt = fmt || (v => v);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Bar chart">${rows.map((r, i) => {
    const y = i * rowH + 4, ww = r.value / max * inner;
    return `<text x="0" y="${y + 12}" font-size="12" fill="currentColor">${esc(r.label)}</text><rect x="${lw}" y="${y + 2}" width="${Math.max(1, ww)}" height="13" fill="${r.color || color}" rx="2"/><text x="${lw + ww + 6}" y="${y + 13}" font-size="11.5" fill="var(--muted)" font-family="var(--mono)">${fmt(r.value)}</text>`;
  }).join('')}</svg>`;
}
function histogram(values, th) {
  const bins = []; for (let b = 0.5; b < 1.0001; b += 0.025) bins.push({ lo: b, n: 0 });
  for (const v of values) { const i = Math.min(bins.length - 1, Math.max(0, Math.floor((v - 0.5) / 0.025))); bins[i].n++; }
  const w = 520, h = 170, pad = 24, max = Math.max(1, ...bins.map(b => b.n)), bw = (w - pad * 2) / bins.length;
  const xOf = v => pad + (v - 0.5) / 0.5 * (w - pad * 2);
  const col = v => v >= th.strong ? 'var(--ok)' : v >= th.review ? 'var(--info)' : v >= th.manual ? 'var(--warn)' : 'var(--faint)';
  return `<svg viewBox="0 0 ${w} ${h + 26}" width="100%" role="img" aria-label="Confidence distribution">
  ${bins.map((b, i) => { const bh = b.n / max * (h - 20); return `<rect x="${pad + i * bw + 1}" y="${h - bh}" width="${bw - 2}" height="${bh}" fill="${col(b.lo + 0.01)}" rx="1.5"><title>${Math.round(b.lo * 100)}–${Math.round((b.lo + 0.025) * 100)}%: ${b.n}</title></rect>`; }).join('')}
  <line x1="${pad}" x2="${w - pad}" y1="${h}" y2="${h}" stroke="var(--line-strong)"/>
  ${[['manual', 'Investigate'], ['review', 'Review'], ['strong', 'Strong']].map(([k, l]) => `<line x1="${xOf(th[k])}" x2="${xOf(th[k])}" y1="8" y2="${h}" stroke="var(--text)" stroke-dasharray="3 3" opacity=".5"/><text x="${xOf(th[k]) + 4}" y="16" font-size="11" fill="var(--muted)">${l} ${Math.round(th[k] * 100)}%</text>`).join('')}
  ${[0.5, 0.6, 0.7, 0.8, 0.9, 1].map(v => `<text x="${xOf(v)}" y="${h + 16}" font-size="11" fill="var(--muted)" text-anchor="middle" font-family="var(--mono)">${Math.round(v * 100)}</text>`).join('')}
  </svg>`;
}

/* ---------------- Overview ---------------- */
const STEPS = ['Upload', 'Normalize', 'Extract', 'Fingerprint', 'Match', 'Cluster', 'Standardize', 'Recommend NMC', 'Human review', 'Map'];
function stepVals() {
  const st = RES.stats, c = counts();
  return [
    [fmtN(st.records), 'records from 5 CPSEs'], [fmtN(st.records), 'descriptions cleaned'], [fmtN(st.attributesExtracted), 'attributes extracted'],
    [fmtN(RES.records.filter(r => r.complete).length), 'complete fingerprints'], [fmtN(st.compared), `pairs, ${Math.round((1 - st.compared / st.naivePairs) * 100)}% fewer than all-pairs`],
    [fmtN(st.crossCpseClusters), 'cross-CPSE clusters'], [fmtN(st.clusters), 'standard descriptions'], [fmtN(st.clusters), 'national codes proposed'],
    [fmtN(c.pending), 'awaiting a reviewer'], [fmtN(c.mapped), 'legacy codes mapped'],
  ];
}
function pageOverview() {
  const st = RES.stats, c = counts();
  const demo = RES.clusterByKey.get(N.DEMO_BOLT_KEY);
  const demoRecs = demo.members.map(id => RES.byId.get(id));
  const vals = stepVals();
  const step = S.hero.step;
  const opp = RES.procurement.length;
  const byCpse = N.CPSES.map(cp => {
    const recs = RES.records.filter(r => r.cpse === cp.id); let m = 0, p = 0, u = 0;
    recs.forEach(r => { const s = recordStatus(r)[0]; if (s.startsWith('Mapped')) m++; else if (s === 'Proposed') p++; else u++; });
    return { label: 'CPSE ' + cp.id, mapped: m, proposed: p, unmapped: u };
  });
  const byCat = N.CAT_ORDER.filter(k => k !== 'UNCLASSIFIED').map(k => ({ label: N.CATEGORIES[k].label, value: RES.records.filter(r => r.category === k).length }));
  const confs = RES.clusters.filter(x => x.conf != null).map(x => x.conf);
  const dupRate = st.duplicatesDetected / st.records;
  const stdRate = c.approvedNMC / RES.clusters.length;
  const coverage = c.mapped / st.records;
  const kpis = [
    ['Total CPSE materials', fmtN(st.records), `${N.CPSES.length} CPSEs${S.uploadedRecords.length ? ', ' + fmtN(S.uploadedRecords.length) + ' uploaded here' : ', synthetic seed data'}`],
    ['National materials', fmtN(c.approvedNMC), `approved of ${fmtN(RES.clusters.length)} proposed`],
    ['Duplicates detected', fmtN(st.duplicatesDetected), `records that collapse into another`],
    ['Procurement opportunities', fmtN(opp), 'materials bought by 2+ CPSEs'],
    ['Pending reviews', fmtN(c.pending), `${c.pendingClusters} clusters, ${c.pendingAttach} incomplete records`],
    ['Approved mappings', fmtN(c.mapped), 'legacy code to national code'],
    ['Unmapped materials', fmtN(c.unmapped), 'need review or more information'],
  ];
  return `
  <section class="hero ${S.hero.run ? (step >= 9 ? 'done' : '') : 'raw'}" id="hero" aria-label="Material constellation">
    <div class="hero-canvas" id="constellation"></div>
    <div class="hero-copy">
      <p class="hero-kicker">${fmtN(st.records)} synthetic records from five CPSEs, each point one legacy material code</p>
      <h1>Many codes.<br>One national material.</h1>
      <p class="hero-sub">${S.hero.run ? 'Records that describe the same material have pulled together around a single national code. Records that only look alike stay apart.' : 'Right now every CPSE’s records sit in their own silo. Run the pipeline to see which of them are the same physical material.'}</p>
      <div class="converge" aria-label="Example: four legacy descriptions, one national material">
        ${demoRecs.map(r => `<div class="src"><i style="color:${CPSE_COLORS[r.cpse]}">${r.cpse}</i><span>${esc(r.desc)}</span></div>`).join('')}
        <div class="out">${nmcOf(demo.key)}<small>${esc(descOf(demo))}</small></div>
      </div>
      <div class="hero-actions">
        <button class="btn primary" data-act="hero-run">${S.hero.run ? 'Show the raw silos again' : 'Run harmonization'}</button>
        <a class="btn on-dark" href="#/review?k=${encodeURIComponent(N.DEMO_BOLT_KEY)}">Review ${nmcOf(demo.key)}</a>
      </div>
    </div>
    <div class="hero-legend">${N.CPSES.map(cp => `<span><i class="dot" style="background:${cp.color}"></i>CPSE ${cp.id} ${cp.short}</span>`).join('')}<span><i class="dot" style="background:#F2A93B;box-shadow:0 0 8px #F2A93B"></i>Approved national material</span><span><i class="dot" style="background:#DCE7F2"></i>Proposed</span></div>
    <div class="hero-hint">Drag to rotate, scroll to zoom, click a point to open it</div>
    <div class="hero-tip" id="heroTip" hidden></div>
  </section>
  <section class="stepper" aria-label="Harmonization pipeline">
    ${STEPS.map((s, i) => `<div class="step ${step >= i ? 'done' : ''} ${step === i ? 'active' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span><b>${s}</b><div class="v">${step >= i ? vals[i][0] : '—'}</div><div class="s">${step >= i ? vals[i][1] : 'not run yet'}</div></div>`).join('')}
  </section>
  <section class="kpis" aria-label="Key metrics">${kpis.map(k => `<div class="kpi"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${k[2]}</div></div>`).join('')}</section>
  <section class="grid-2" style="margin-bottom:16px">
    <div class="panel"><div class="panel-h"><div><h3>Materials by CPSE</h3><p>Status of every legacy code against the national master</p></div><div class="legend"><span><i class="sw" style="background:var(--ok)"></i>Mapped</span><span><i class="sw" style="background:var(--accent-fill)"></i>Proposed</span><span><i class="sw" style="background:var(--line-strong)"></i>Unmapped</span></div></div>
      <div class="panel-b">${stackedBars(byCpse, ['mapped', 'proposed', 'unmapped'], ['var(--ok)', 'var(--accent-fill)', 'var(--line-strong)'])}</div></div>
    <div class="panel"><div class="panel-h"><div><h3>Match confidence of proposed national materials</h3><p>Thresholds are configurable in Settings</p></div></div>
      <div class="panel-b">${histogram(confs, S.config.thresholds)}</div></div>
  </section>
  <section class="grid-2">
    <div class="panel"><div class="panel-h"><div><h3>Materials by category</h3><p>Detected from descriptions, not from ERP codes</p></div></div><div class="panel-b">${hBars(byCat, 'var(--info)')}</div></div>
    <div class="panel"><div class="panel-h"><div><h3>Programme progress</h3><p>Success metrics from the framework</p></div></div><div class="panel-b stack">
      ${[['Duplicate rate', dupRate, 'Share of records that duplicate another record', 'var(--warn)'], ['Standardization rate', stdRate, 'Proposed national materials already approved', 'var(--ok)'], ['Mapping coverage', coverage, 'Legacy codes with an approved national code', 'var(--info)'], ['Matching precision', RES.eval.precision, 'Measured against synthetic ground truth', 'var(--ok)']].map(([l, v, d, col]) => `<div><div class="row" style="justify-content:space-between"><b style="font-weight:500">${l}</b><span class="mono">${pct1(v)}</span></div><div class="meter" style="margin:6px 0 3px"><i style="width:${v * 100}%;background:${col}"></i></div><div class="muted" style="font-size:12px">${d}</div></div>`).join('')}
      <p class="muted" style="font-size:12px">Pipeline ran over ${fmtN(st.records)} records in ${st.ms} ms in this browser. Blocking cut ${fmtN(st.naivePairs)} possible pairs to ${fmtN(st.compared)}.</p>
    </div></div>
  </section>`;
}
function mountOverview() {
  const el = $('#constellation'); if (!el) return;
  const C = G.Constellation;
  if (C.dataSig !== RES) { C.setData(RES, CPSE_COLORS, statusOf); C.dataSig = RES; } else C.refreshStatus(statusOf);
  C.mount(el);
  C.setTarget(S.hero.run ? 1 : 0);
  if (S.hero.run && C.p < 0.01 && !C.target) C.setTarget(1);
  const tip = $('#heroTip');
  C.onHover = (rec, key, mx, my) => {
    if (!tip) return;
    if (!rec && !key) { tip.hidden = true; return; }
    if (key) {
      const c = RES.clusterByKey.get(key);
      tip.innerHTML = `<b class="mono">${nmcOf(key)}</b> ${pill(STATUS, statusOf(key))}<span class="desc">${esc(descOf(c))}</span><span class="faint" style="display:block;margin-top:4px">${c.members.length} legacy codes from ${c.cpses.length} CPSEs. Click to open.</span>`;
    } else {
      const key2 = rec.clusterKey || rec.suggestedCluster;
      tip.innerHTML = `<b>CPSE ${rec.cpse}</b> <span class="mono">${esc(codeOf(rec))}</span><span class="desc">${esc(descRec(rec))}</span>${key2 ? `<span class="faint" style="display:block;margin-top:4px">${rec.complete ? '' : 'Suggested: '}${nmcOf(key2)}</span>` : '<span class="faint" style="display:block;margin-top:4px">Insufficient information to match</span>'}`;
    }
    tip.hidden = false; tip.style.left = Math.min(mx, el.clientWidth - 330) + 'px'; tip.style.top = Math.min(my, el.clientHeight - 110) + 'px';
  };
  C.onPickRecord = id => openRecord(id);
  C.onPickCluster = key => openNMC(key);
}
let stepTimer = null;
function heroRun() {
  S.hero.run = !S.hero.run;
  clearInterval(stepTimer);
  if (S.hero.run) {
    S.hero.step = -1;
    const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rm) { S.hero.step = 9; render(); return; }
    render();
    stepTimer = setInterval(() => {
      S.hero.step++;
      if (route().page !== 'overview') { clearInterval(stepTimer); S.hero.step = 9; return; }
      const steps = document.querySelectorAll('.step'), vals = stepVals();
      steps.forEach((s, i) => { s.classList.toggle('done', i <= S.hero.step); s.classList.toggle('active', i === S.hero.step); s.querySelector('.v').textContent = i <= S.hero.step ? vals[i][0] : '—'; s.querySelector('.s').textContent = i <= S.hero.step ? vals[i][1] : 'not run yet'; });
      if (S.hero.step >= 9) { clearInterval(stepTimer); const h = $('#hero'); if (h) h.classList.add('done'); }
    }, 260);
  } else { S.hero.step = -1; render(); }
}

/* ---------------- Data intake ---------------- */
const SAMPLE_CSV = `cpse,code,description,unit,price,qty,supplier,year
E,HE/BLT/09001,"BOLT HEX M16 X 50 MM SS304 ISO 4014",EA,29.40,1500,Deccan Fasteners (syn),2026
B,MAT-99120,"BALL BEARING 6205 2RSH MAKE KAVERI",NOS,1320,300,Kaveri Bearing Co (syn),2026
D,FM-30411,"GATE VALVE DN100 300 LB CF8M FLANGED",NO,68000,6,Godavari Valves (syn),2026
C,780115,"HEX HEAD BOLT M16 X 50 SS316",PCS,41,800,Vindhya Bolts & Nuts (syn),2026
A,MISC-10077,"SPARES AS PER OEM LIST",EA,,,,
Z,ZZ-1,"HEX BOLT M12X40 SS304",EA,12,100,Unknown,2026
B,MAT-99121,"INDUCTION MOTOR 7.5 KW 415 V 4 POLE",NOS,32000,4`;
function pageIntake() {
  const rep = S.lastReport;
  const qAll = []; RES.records.forEach(r => r.quality.forEach(q => qAll.push({ r, q })));
  const types = {}; qAll.forEach(x => types[x.q.type] = (types[x.q.type] || 0) + 1);
  const TL = { MISSING_ATTR: 'Missing critical attribute', INVALID_UNIT: 'Invalid unit', DUP_CODE: 'Duplicate legacy code', INTRA_DUP: 'Internal duplicate', PRICE_OUTLIER: 'Suspicious price', UNIT_MISMATCH: 'Unit mismatch', UNCLASSIFIED: 'Insufficient information' };
  const flt = S.ui.dq.type; const list = qAll.filter(x => (!flt || x.q.type === flt) && visible(x.r));
  const up = can('upload');
  return `<div class="page-head"><div><h2>Data intake</h2><p>Upload legacy material masters from any CPSE as CSV or JSON. Rows are validated before anything is ingested, and rejected rows are listed rather than silently dropped.</p></div></div>
  <div class="grid-2" style="margin-bottom:16px">
    <div class="panel"><div class="panel-h"><div><h3>Upload a material master</h3><p>Required columns: cpse, code, description, unit. Optional: price, qty, supplier, year, plant.</p></div></div>
      <div class="panel-b stack">
        ${up ? '' : `<p class="explain rev">Your role (${ROLES[S.role].label}) cannot upload data. Switch to CPSE administrator or Super administrator.</p>`}
        <label class="drop" id="drop"><input type="file" accept=".csv,.json,text/csv,application/json" data-input="file" class="sr" ${up ? '' : 'disabled'}><b>Choose a CSV or JSON file</b><br><span class="muted" style="font-size:12.5px">or drop it here, or paste rows below</span></label>
        <textarea class="input" id="paste" aria-label="Paste CSV" spellcheck="false" ${up ? '' : 'disabled'}>${esc(S.pasteText ?? SAMPLE_CSV)}</textarea>
        <div class="row"><button class="btn primary" data-act="ingest" ${up ? '' : 'disabled'}>Validate and ingest</button><button class="btn" data-act="sample">Reset sample rows</button><span class="muted" style="font-size:12px">The sample includes one unknown CPSE, one malformed row and one row without a price.</span></div>
      </div></div>
    <div class="panel"><div class="panel-h"><div><h3>Validation report</h3><p>${rep ? esc(rep.file) + ', ' + fmtDate(rep.at) : 'Nothing uploaded in this session yet'}</p></div></div>
      <div class="panel-b">${rep ? reportHTML(rep) : '<p class="muted">Upload the sample to see how new records are normalized, matched against the existing national master, and routed to review.</p>'}</div></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-h"><div><h3>Source datasets</h3><p>One isolated tenant per CPSE. Formats and ERPs are simulated.</p></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>CPSE</th><th>Name</th><th>Sector</th><th>Source system</th><th class="num">Records</th><th class="num">Uploaded</th><th class="num">Quality issues</th><th class="num">Mapped</th></tr></thead><tbody>
    ${N.CPSES.map(cp => { const recs = RES.records.filter(r => r.cpse === cp.id); const m = recs.filter(r => recordStatus(r)[0].startsWith('Mapped')).length; return `<tr><td>${cpseTag(cp.id)}</td><td>${esc(cp.name)}</td><td>${cp.sector}</td><td>${cp.erp} (${cp.format})</td><td class="num">${recs.length}</td><td class="num">${recs.filter(r => !r.source.startsWith('Synthetic')).length}</td><td class="num">${recs.filter(r => r.quality.length).length}</td><td class="num">${pct(m / recs.length)}</td></tr>`; }).join('')}
    </tbody></table></div></div>
  <div class="panel"><div class="panel-h"><div><h3>Data quality issues</h3><p>${list.length} issues${S.role === 'CPSE_ADMIN' ? ' in your CPSE' : ''}. Click a row to inspect the record.</p></div>
    <div class="row"><button class="btn sm ${!flt ? 'primary' : ''}" data-act="dq" data-v="">All</button>${Object.entries(types).map(([t, n]) => `<button class="btn sm ${flt === t ? 'primary' : ''}" data-act="dq" data-v="${t}">${TL[t]} <span class="mono">${n}</span></button>`).join('')}</div></div>
    <div class="tbl-wrap" style="max-height:440px;overflow:auto"><table><thead><tr><th>CPSE</th><th>Legacy code</th><th>Description</th><th>Issue</th><th>Detail</th></tr></thead><tbody>
    ${list.slice(0, 200).map(x => `<tr class="click" data-act="rec" data-id="${x.r.id}"><td>${cpseTag(x.r.cpse)}</td><td class="code">${esc(x.r.code)}</td><td class="desc">${esc(x.r.desc)}</td><td><span class="pill ${x.q.type === 'UNCLASSIFIED' || x.q.type === 'INTRA_DUP' ? 'p-mute' : x.q.type === 'PRICE_OUTLIER' || x.q.type === 'INVALID_UNIT' || x.q.type === 'DUP_CODE' ? 'p-bad' : 'p-warn'}">${TL[x.q.type]}</span></td><td class="muted" style="font-size:12.5px">${esc(x.q.msg)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No issues of this type.</td></tr>'}
    </tbody></table></div></div>`;
}
function reportHTML(rep) {
  if (rep.duplicateUpload) return `<p class="explain rev">This exact file was already uploaded. Nothing was ingested a second time.</p>`;
  const outcome = rep.outcome || [];
  return `<div class="row" style="gap:16px;margin-bottom:12px">
    <div><div class="mono" style="font-size:22px;font-weight:600">${rep.totalRows}</div><div class="muted" style="font-size:12px">rows read</div></div>
    <div><div class="mono" style="font-size:22px;font-weight:600;color:var(--ok)">${rep.accepted.length}</div><div class="muted" style="font-size:12px">ingested</div></div>
    <div><div class="mono" style="font-size:22px;font-weight:600;color:var(--bad)">${rep.rejected.length}</div><div class="muted" style="font-size:12px">rejected</div></div>
    <div><div class="mono" style="font-size:22px;font-weight:600;color:var(--warn)">${rep.warnings.length}</div><div class="muted" style="font-size:12px">warnings</div></div></div>
  ${rep.rejected.length ? `<h4 style="margin:8px 0 6px">Rejected rows</h4><ul class="ev-list blocked">${rep.rejected.map(x => `<li><span><span class="mono">Line ${x.line}</span> ${esc(x.reason)}</span></li>`).join('')}</ul>` : ''}
  ${rep.warnings.length ? `<h4 style="margin:12px 0 6px">Warnings</h4><ul class="ev-list diff">${rep.warnings.map(x => `<li><span><span class="mono">Line ${x.line}</span> ${esc(x.reason)}</span></li>`).join('')}</ul>` : ''}
  ${outcome.length ? `<h4 style="margin:12px 0 6px">What the pipeline did with the new records</h4><div class="tbl-wrap"><table><thead><tr><th>Record</th><th>Outcome</th></tr></thead><tbody>${outcome.map(o => `<tr class="click" data-act="rec" data-id="${o.id}"><td class="desc">${esc(o.desc)}</td><td style="font-size:12.5px">${o.html}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
function doIngest(text, filename) {
  if (!can('upload')) return toast('Your role cannot upload data.');
  const h = N.hashStr(text);
  if (S.uploads.includes(h)) { S.lastReport = { file: filename, at: new Date().toISOString(), duplicateUpload: true, accepted: [], rejected: [], warnings: [], totalRows: 0 }; audit('UPLOAD_DUPLICATE_BLOCKED', filename, 'Duplicate file upload detected and ignored.'); save(); render(); return; }
  const rep = N.ingest(text, filename, RES.records);
  if (S.role === 'CPSE_ADMIN') {
    const foreign = rep.accepted.filter(r => r.cpse !== S.tenant);
    foreign.forEach(r => rep.rejected.push({ line: '–', raw: r.desc, reason: `Row belongs to CPSE ${r.cpse}. A CPSE administrator can only upload for CPSE ${S.tenant}.` }));
    rep.accepted = rep.accepted.filter(r => r.cpse === S.tenant);
  }
  rep.at = new Date().toISOString();
  if (rep.accepted.length) {
    S.uploads.push(h);
    S.uploadedRecords.push(...rep.accepted);
    runPipeline();
    rep.outcome = rep.accepted.map(a => {
      const r = RES.byId.get(a.id);
      let html;
      if (r.category === 'UNCLASSIFIED') html = '<span class="pill p-mute">Insufficient information</span> Not matched. Needs a better description.';
      else if (r.complete) {
        const c = RES.clusterByKey.get(r.clusterKey);
        html = c.members.length > 1 ? `<span class="pill p-ok">Matched</span> Joins <span class="nmc">${nmcOf(c.key)}</span> ${esc(descOf(c))} with ${c.members.length - 1} other record(s).` : `<span class="pill p-acc">New national material</span> Proposed as <span class="nmc">${nmcOf(c.key)}</span>.`;
      } else html = `<span class="pill p-warn">Needs review</span> Missing ${r.missing.map(m => N.ATTR_LABELS[m].toLowerCase()).join(', ')}.` + (r.suggestedCluster ? ` Best candidate <span class="nmc">${nmcOf(r.suggestedCluster)}</span>.` : '');
      return { id: a.id, desc: a.desc, html };
    });
  }
  S.lastReport = rep;
  audit('DATASET_UPLOADED', filename, `${rep.accepted.length} ingested, ${rep.rejected.length} rejected, ${rep.warnings.length} warnings.`);
  save(); render();
  toast(`${rep.accepted.length} records ingested, ${rep.rejected.length} rejected.`);
}

/* ---------------- Material explorer ---------------- */
function searchRecords(q) {
  const norm = N.normalize(q); const { category, attrs } = N.extract(norm);
  const toks = norm.split(' ').filter(t => t.length > 1);
  const hasCat = category !== 'UNCLASSIFIED';
  const scored = [];
  for (const r of RES.records) {
    let tokHit = 0; const rt = r.norm;
    for (const t of toks) if (rt.includes(t)) tokHit++;
    const ts = toks.length ? tokHit / toks.length : 0;
    let as = 0, an = 0;
    for (const [k, v] of Object.entries(attrs)) { an++; if (String(r.attrs[k]) === String(v)) as++; else if (r.attrs[k] !== undefined) as -= 0.6; }
    let s = ts * 0.55 + (an ? (as / an) * 0.45 : ts * 0.45);
    if (hasCat && r.category !== category) s *= 0.3;
    if (s > 0.42) scored.push([s, r]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return { results: scored.map(x => x[1]), category, attrs, norm };
}
function pageExplorer() {
  const ex = S.ui.ex;
  let recs = RES.records.filter(visible);
  let interp = null;
  if (ex.q.trim()) { const s = searchRecords(ex.q); interp = s; const set = new Set(recs.map(r => r.id)); recs = s.results.filter(r => set.has(r.id)); }
  if (ex.cpse) recs = recs.filter(r => r.cpse === ex.cpse);
  if (ex.cat) recs = recs.filter(r => r.category === ex.cat);
  if (ex.status) recs = recs.filter(r => recordStatus(r)[0].startsWith(ex.status));
  const per = 40, pages = Math.max(1, Math.ceil(recs.length / per)); ex.page = Math.min(ex.page, pages - 1);
  const slice = recs.slice(ex.page * per, ex.page * per + per);
  return `<div class="page-head"><div><h2>Material explorer</h2><p>Every legacy record with its normalized form and national code. Search understands abbreviations and units, so “stainless steel 304 hexagonal bolt M16” finds “HEX BOLT M16X50 SS304”.</p></div>
    <button class="btn ${ex.sel.length === 2 ? 'primary' : ''}" data-act="compare" ${ex.sel.length === 2 ? '' : 'disabled'}>Compare selected (${ex.sel.length}/2)</button></div>
  <form class="filters" data-form="ex">
    <label class="field">Search<input class="input" name="q" type="search" value="${esc(ex.q)}" placeholder="Description, code or attributes"></label>
    ${S.role === 'CPSE_ADMIN' ? '' : `<label class="field">CPSE<select class="select" name="cpse"><option value="">All CPSEs</option>${N.CPSES.map(c => `<option value="${c.id}" ${ex.cpse === c.id ? 'selected' : ''}>${c.id}: ${c.short}</option>`).join('')}</select></label>`}
    <label class="field">Category<select class="select" name="cat"><option value="">All categories</option>${N.CAT_ORDER.map(k => `<option value="${k}" ${ex.cat === k ? 'selected' : ''}>${N.CATEGORIES[k].label}</option>`).join('')}</select></label>
    <label class="field">Status<select class="select" name="status"><option value="">Any status</option>${['Mapped', 'Proposed', 'Needs review', 'Insufficient information', 'Rejected'].map(s => `<option ${ex.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <button class="btn" type="submit">Apply</button>${ex.q || ex.cpse || ex.cat || ex.status ? '<button class="btn" type="button" data-act="ex-clear">Clear</button>' : ''}
  </form>
  ${interp ? `<div class="row" style="margin-bottom:10px;font-size:12.5px"><span class="muted">Interpreted as</span><span class="chip">${esc(interp.norm)}</span>${interp.category !== 'UNCLASSIFIED' ? `<span class="chip">${N.CATEGORIES[interp.category].label}</span>` : ''}${Object.entries(interp.attrs).map(([k, v]) => `<span class="chip">${N.ATTR_LABELS[k]}: ${esc(N.fmtAttr(k, v))}</span>`).join('')}</div>` : ''}
  <div class="panel"><div class="tbl-wrap"><table><thead><tr><th style="width:32px"><span class="sr">Select</span></th><th>CPSE</th><th>Legacy code</th><th>Original description</th><th>Normalized</th><th>Category</th><th>National code</th><th>Status</th></tr></thead><tbody>
  ${slice.map(r => { const st = recordStatus(r); const k = mappedNMC(r); return `<tr class="click ${ex.sel.includes(r.id) ? 'sel' : ''}" data-act="rec" data-id="${r.id}"><td><input type="checkbox" aria-label="Select ${esc(r.code)}" data-act="sel" data-id="${r.id}" ${ex.sel.includes(r.id) ? 'checked' : ''}></td><td>${cpseTag(r.cpse)}</td><td class="code">${esc(r.code)}</td><td class="desc">${esc(r.desc)}</td><td class="desc muted">${esc(r.norm)}</td><td>${N.CATEGORIES[r.category].label}</td><td>${k ? `<span class="nmc" style="${r.complete || st[0].startsWith('Mapped') ? '' : 'opacity:.55'}">${nmcOf(k)}</span>` : '<span class="faint">—</span>'}</td><td><span class="pill ${st[1]}">${st[0]}</span></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No records match. Try fewer words or clear a filter.</td></tr>'}
  </tbody></table></div>
  <div class="row" style="justify-content:space-between;padding:10px 14px"><span class="muted" style="font-size:12.5px">${fmtN(recs.length)} records${S.role === 'CPSE_ADMIN' ? ` in CPSE ${S.tenant} (tenant isolation)` : ''}</span>
    <div class="row"><button class="btn sm" data-act="ex-page" data-v="-1" ${ex.page ? '' : 'disabled'}>Previous</button><span class="mono" style="font-size:12px">${ex.page + 1} / ${pages}</span><button class="btn sm" data-act="ex-page" data-v="1" ${ex.page < pages - 1 ? '' : 'disabled'}>Next</button></div></div></div>`;
}

/* ---------------- Comparison panel ---------------- */
const COMP = [['semantic', 'Semantic similarity'], ['attribute', 'Attribute similarity'], ['specification', 'Specification similarity'], ['category', 'Category match'], ['unit', 'Unit compatibility'], ['procurement', 'Procurement context']];
function comparePanel(r1, r2, opts) {
  opts = opts || {};
  if (r1.category !== r2.category) return `<div class="panel"><div class="panel-b"><p class="explain block">These records are in different categories (${N.CATEGORIES[r1.category].label} and ${N.CATEGORIES[r2.category].label}). The engine never compares across categories, so they are classified as a non-match.</p></div></div>`;
  const p = N.compare(r1, r2, S.config);
  const e = N.explain(p, r1, r2);
  const W = S.config.weights, wsum = Object.values(W).reduce((a, b) => a + b, 0);
  const crit = N.CATEGORIES[r1.category].critical;
  const keys = [...new Set([...crit, 'standard', 'manufacturer'])].filter(k => crit.includes(k) || r1.attrs[k] || r2.attrs[k]);
  const res = k => {
    const a = r1.attrs[k], b = r2.attrs[k];
    if (a !== undefined && b !== undefined) {
      if (String(a) === String(b)) return '<span class="res ok">Match</span>';
      if (k === 'standard' && p.stdRel === 'equivalent') return '<span class="res ok">Equivalent</span>';
      return crit.includes(k) ? '<span class="res bad">Conflict, blocks merge</span>' : '<span class="res warn">Differs</span>';
    }
    if (a === undefined && b === undefined) return '<span class="res mute">Not stated</span>';
    return crit.includes(k) ? '<span class="res warn">Missing, needs review</span>' : '<span class="res mute">One side only</span>';
  };
  const ex = e.blocked.length ? 'block' : p.cls === 'REQUIRES_REVIEW' ? 'rev' : '';
  return `<div class="panel"><div class="panel-h"><div><h3>${opts.title || 'Material comparison'}</h3><p>Classification ${pill(CLS, p.cls)} at ${pct(p.score)} confidence</p></div>${opts.right || ''}</div>
  <div class="panel-b stack">
    <div class="vs">
      <div class="card"><div class="row" style="justify-content:space-between"><b>Material A</b>${cpseTag(r1.cpse)}</div><div class="code" style="margin-top:4px">${esc(codeOf(r1))}</div><div class="desc" style="margin-top:6px">${esc(descRec(r1))}</div><div class="muted" style="font-size:12px;margin-top:4px">Unit ${esc(r1.unit || '—')}${N.avgUnitPrice(r1) ? `, avg ${fmtRs(N.avgUnitPrice(r1))} per ${r1.unitInfo.canon}` : ''}</div></div>
      <div class="x">vs</div>
      <div class="card"><div class="row" style="justify-content:space-between"><b>Material B</b>${cpseTag(r2.cpse)}</div><div class="code" style="margin-top:4px">${esc(codeOf(r2))}</div><div class="desc" style="margin-top:6px">${esc(descRec(r2))}</div><div class="muted" style="font-size:12px;margin-top:4px">Unit ${esc(r2.unit || '—')}${N.avgUnitPrice(r2) ? `, avg ${fmtRs(N.avgUnitPrice(r2))} per ${r2.unitInfo.canon}` : ''}</div></div>
    </div>
    <div class="grid-2">
      <div><h4 style="margin-bottom:8px">Score components</h4><div class="bars">${COMP.map(([k, l]) => `<div class="br"><span>${l}</span><span class="w">${Math.round(W[k] / wsum * 100)}%</span><span class="track"><i style="width:${p.comp[k] * 100}%;${p.comp[k] < 0.5 ? 'background:var(--warn)' : ''}"></i></span><span class="val">${pct(p.comp[k])}</span></div>`).join('')}</div>
        <p class="muted" style="font-size:12px;margin-top:8px">Weighted confidence ${pct(p.score)}. ${e.blocked.length ? 'Technical conflict overrides the score (rule R-01).' : `Band: ${BANDS[N.band(p.score, S.config.thresholds)][0].toLowerCase()}.`}</p></div>
      <div><h4 style="margin-bottom:8px">Attribute comparison</h4><table class="attr-tbl"><thead><tr><th>Attribute</th><th>A</th><th>B</th><th>Result</th></tr></thead><tbody>
        ${keys.map(k => `<tr><td>${N.ATTR_LABELS[k]}${crit.includes(k) ? ' <span class="faint" title="Critical attribute">*</span>' : ''}</td><td class="mono">${esc(N.fmtAttr(k, r1.attrs[k]) || '—')}</td><td class="mono">${esc(N.fmtAttr(k, r2.attrs[k]) || '—')}</td><td>${res(k)}</td></tr>`).join('')}
      </tbody></table><p class="faint" style="font-size:11.5px;margin-top:4px">* critical attribute: a difference blocks the merge</p></div>
    </div>
    <div class="grid-3">
      <div><h4 style="margin-bottom:6px">Why they match</h4><ul class="ev-list">${e.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4 style="margin-bottom:6px">Differences</h4>${e.differences.length ? `<ul class="ev-list diff">${e.differences.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted" style="font-size:13px">None found.</p>'}</div>
      <div><h4 style="margin-bottom:6px">Blocking conflicts</h4>${e.blocked.length ? `<ul class="ev-list blocked">${e.blocked.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted" style="font-size:13px">None. No critical attribute differs.</p>'}</div>
    </div>
    <div><h4 style="margin-bottom:6px">Explanation</h4><p class="explain ${ex}">${esc(e.narrative)}</p><p class="faint" style="font-size:11.5px;margin-top:6px">Generated from the computed evidence above. Model nummf-hybrid-matcher 0.9.0-demo. Sources: ${esc(r1.cpse)}:${esc(codeOf(r1))}, ${esc(r2.cpse)}:${esc(codeOf(r2))}.</p></div>
  </div></div>`;
}

/* ---------------- Match review ---------------- */
function queueItems() {
  const items = [];
  for (const c of RES.clusters) items.push({ id: 'c:' + c.key, kind: 'CLUSTER', key: c.key, c, status: statusOf(c.key), conf: c.conf, demo: c.key === N.DEMO_BOLT_KEY });
  for (const a of RES.attachments) { const d = S.attachDecisions[a.recordId]; items.push({ id: 'a:' + a.recordId, kind: 'ATTACH', key: a.clusterKey, a, status: d ? d.status : 'PENDING', conf: a.score, demo: RES.byId.get(a.recordId).code === 'HE/BLT/04412' }); }
  return items;
}
function pageReview(params) {
  const rv = S.ui.rv;
  if (params.get('k')) { rv.sel = 'c:' + params.get('k'); rv.a = rv.b = null; rv.editing = false; history.replaceState(null, '', '#/review'); }
  let items = queueItems();
  const f = rv.filter;
  const open = s => ['PENDING', 'ESCALATED', 'AWAITING_L2'].includes(s);
  if (f === 'OPEN') items = items.filter(i => open(i.status));
  else if (f === 'ATTACH') items = items.filter(i => i.kind === 'ATTACH' && open(i.status));
  else if (f === 'ESCALATED') items = items.filter(i => i.status === 'ESCALATED' || i.status === 'AWAITING_L2');
  else if (f === 'DONE') items = items.filter(i => !open(i.status));
  if (S.role === 'CPSE_ADMIN') items = items.filter(i => i.kind === 'CLUSTER' ? i.c.cpses.includes(S.tenant) : RES.byId.get(i.a.recordId).cpse === S.tenant);
  items.sort((x, y) => (y.demo - x.demo) || (x.kind === 'ATTACH') - (y.kind === 'ATTACH') || (y.c ? y.c.cpses.length : 0) - (x.c ? x.c.cpses.length : 0) || (y.conf || 0) - (x.conf || 0));
  if (!rv.sel || !queueItems().some(i => i.id === rv.sel)) rv.sel = items[0] ? items[0].id : null;
  const all = queueItems();
  const sel = all.find(i => i.id === rv.sel);
  const cnt = k => ({ OPEN: all.filter(i => open(i.status)).length, ATTACH: all.filter(i => i.kind === 'ATTACH' && open(i.status)).length, ESCALATED: all.filter(i => i.status === 'ESCALATED' || i.status === 'AWAITING_L2').length, DONE: all.filter(i => !open(i.status)).length }[k]);
  return `<div class="page-head"><div><h2>Match review</h2><p>No national material is created and no legacy code is mapped without a person approving it. Every decision is recorded with the evidence that was on screen.</p></div></div>
  <div class="review">
    <div class="panel queue"><div class="tabs" role="tablist" style="margin:0;padding:0 6px">${[['OPEN', 'Open'], ['ATTACH', 'Incomplete'], ['ESCALATED', 'Escalated'], ['DONE', 'Decided']].map(([k, l]) => `<button role="tab" aria-selected="${f === k}" data-act="rv-filter" data-v="${k}">${l} <span class="mono faint">${cnt(k)}</span></button>`).join('')}</div>
      <div class="queue-list">${items.slice(0, 300).map(i => queueItemHTML(i)).join('') || '<p class="empty">Nothing here.</p>'}</div></div>
    <div class="stack" id="rvDetail">${sel ? (sel.kind === 'CLUSTER' ? clusterDetail(sel.c) : attachDetail(sel.a)) : '<div class="panel"><p class="empty">Select an item from the queue.</p></div>'}</div>
  </div>`;
}
function queueItemHTML(i) {
  const cur = S.ui.rv.sel === i.id;
  if (i.kind === 'CLUSTER') {
    const c = i.c;
    return `<button class="qi" data-act="rv-sel" data-v="${esc(i.id)}" aria-current="${cur}"><div class="t"><span class="nmc">${nmcOf(c.key)}</span>${pill(STATUS, i.status)}</div><div class="d">${esc(descOf(c))}</div><div class="m">${cpseDots(c.cpses)}<span>${c.members.length} codes</span><span class="mono">${c.conf != null ? pct(c.conf) : 'single'}</span>${c.band !== 'SINGLE' ? pill(BANDS, c.band) : ''}</div></button>`;
  }
  const r = RES.byId.get(i.a.recordId);
  return `<button class="qi" data-act="rv-sel" data-v="${esc(i.id)}" aria-current="${cur}"><div class="t"><span class="pill p-warn">Incomplete record</span>${pill(STATUS, i.status)}</div><div class="d">${esc(descRec(r))}</div><div class="m">${cpseTag(r.cpse)}<span>missing ${r.missing.map(m => N.ATTR_LABELS[m].toLowerCase()).join(', ')}</span><span class="mono">${pct(i.a.score)}</span></div></button>`;
}
function viewerHTML(id, c) {
  const crit = N.CATEGORIES[c.category].critical;
  return `<div class="viewer" id="${id}"><span class="lbl">${N.CATEGORIES[c.category].label}, procedural model from extracted attributes. Drag to rotate.</span><div class="cap">${crit.map(k => `<span>${esc(N.fmtAttr(k, c.attrs[k]))}</span>`).join('')}${c.material ? `<span>${c.material.replace('_', ' ')}</span>` : ''}</div></div>`;
}
function clusterDetail(c) {
  const rv = S.ui.rv;
  const st = statusOf(c.key), dec = S.decisions[c.key];
  const members = c.members.map(id => RES.byId.get(id));
  if (!rv.a || !c.members.includes(rv.a)) rv.a = c.members[0];
  if (!rv.b || !c.members.includes(rv.b) || rv.b === rv.a) rv.b = c.members.find(m => m !== rv.a) || null;
  const lookalikes = RES.variants.filter(p => c.members.includes(p.a) || c.members.includes(p.b)).slice(0, 5);
  const att = RES.attachments.filter(a => a.clusterKey === c.key);
  const proc = RES.procurement.find(p => p.clusterKey === c.key);
  const allowed = canReviewCluster(c);
  const needsL2 = c.band === 'INVESTIGATE';
  const decided = st === 'APPROVED' || st === 'REJECTED';
  const why = !can('review') ? `${ROLES[S.role].label} is read-only.` : !allowed ? `This cluster does not include CPSE ${S.tenant}.` : '';
  return `
  <div class="panel"><div class="panel-b stack">
    <div class="detail-head">
      <div style="min-width:0;flex:1">
        <div class="row"><span class="nmc" style="font-size:15px">${nmcOf(c.key)}</span>${pill(STATUS, st)}${c.members.length > 1 ? `<span class="pill p-info">${c.members.length} legacy codes, ${c.cpses.length} CPSEs</span>` : '<span class="pill p-mute">New national material (single record)</span>'}${versionOf(c) ? `<span class="pill p-mute">Version ${versionOf(c)}</span>` : ''}</div>
        ${rv.editing ? `<input class="input std" id="stdEdit" value="${esc(descOf(c))}" aria-label="Standard description" style="width:100%">` : `<div class="std">${esc(descOf(c))}</div>`}
        <div class="muted" style="font-size:12.5px;margin-top:4px">${N.CATEGORIES[c.category].group} / ${N.CATEGORIES[c.category].label}. Proposed standard description, generated from consensus attributes.</div>
      </div>
      <div class="conf"><div class="v">${c.conf != null ? pct(c.conf) : '—'}</div><div class="muted" style="font-size:12px">cluster confidence${c.minScore != null ? `, weakest pair ${pct(c.minScore)}` : ''}</div><div style="margin-top:6px">${pill(BANDS, c.band)}</div></div>
    </div>
    ${dec && dec.note ? `<p class="explain rev"><b>${esc(dec.by)}:</b> ${esc(dec.note)}</p>` : ''}
    <div class="grid-2">
      ${viewerHTML('rvViewer', c)}
      <div><h4 style="margin-bottom:8px">Fingerprint</h4><div class="fp">${N.fingerprintLines(c.category, c.attrs, 'EA').filter(l => l[0] !== 'UNIT').map(([k, v]) => `<b>${k}</b> = ${esc(v)}`).join('<br>')}</div>
        <h4 style="margin:12px 0 6px">Attribute lineage</h4><table class="attr-tbl"><tbody>${Object.entries(c.lineage).map(([k, ids]) => `<tr><td>${N.ATTR_LABELS[k]}</td><td><span class="mono">${esc(N.fmtAttr(k, c.attrs[k]))}</span> <span class="faint" style="font-size:12px">from ${ids.length} record${ids.length > 1 ? 's' : ''}: ${ids.slice(0, 4).map(id => RES.byId.get(id).cpse).join(', ')}${ids.length > 4 ? '…' : ''}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  </div></div>
  <div class="panel"><div class="panel-h"><div><h3>Source records</h3><p>Choose any two to compare. A is the left radio, B the right.</p></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>A</th><th>B</th><th>CPSE</th><th>Legacy code</th><th>Original description</th><th>Unit</th><th class="num">Match to others</th><th>Flags</th></tr></thead><tbody>
    ${members.map(r => `<tr><td><input type="radio" name="pa" aria-label="Use as A" data-act="rv-a" data-id="${r.id}" ${rv.a === r.id ? 'checked' : ''}></td><td><input type="radio" name="pb" aria-label="Use as B" data-act="rv-b" data-id="${r.id}" ${rv.b === r.id ? 'checked' : ''} ${rv.a === r.id ? 'disabled' : ''}></td><td>${cpseTag(r.cpse)}</td><td class="code"><a href="javascript:void 0" data-act="rec" data-id="${r.id}">${esc(codeOf(r))}</a></td><td class="desc">${esc(descRec(r))}</td><td class="mono">${esc(r.unit || '—')}</td><td class="num mono">${pct(memberConf(c, r.id))}</td><td>${r.quality.map(q => `<span class="pill ${q.type === 'INTRA_DUP' ? 'p-mute' : 'p-warn'}" title="${esc(q.msg)}">${q.type === 'INTRA_DUP' ? 'Internal duplicate' : q.type === 'PRICE_OUTLIER' ? 'Price outlier' : q.type === 'UNIT_MISMATCH' ? 'Unit' : q.type === 'INVALID_UNIT' ? 'Invalid unit' : q.type === 'DUP_CODE' ? 'Duplicate code' : q.type}</span>`).join(' ')}</td></tr>`).join('')}
    </tbody></table></div></div>
  ${rv.b ? comparePanel(RES.byId.get(rv.a), RES.byId.get(rv.b), { title: 'AI match review' }) : ''}
  <div class="grid-2">
    <div class="panel"><div class="panel-h"><div><h3>Look-alikes kept apart</h3><p>Records that read similarly but differ on a critical attribute</p></div></div>
      <div class="panel-b">${lookalikes.length ? `<ul class="ev-list blocked">${lookalikes.map(p => { const o = RES.byId.get(c.members.includes(p.a) ? p.b : p.a); const oc = o.clusterKey; return `<li><span><span class="desc">${esc(descRec(o))}</span> <span class="faint">(${cpseTag(o.cpse)})</span><br><span style="font-size:12.5px">${p.conflicts.map(k => `${N.ATTR_LABELS[k]}: ${esc(N.fmtAttr(k, RES.byId.get(p.a).attrs[k]))} vs ${esc(N.fmtAttr(k, RES.byId.get(p.b).attrs[k]))}`).join('; ')}. ${pct(p.score)} text-weighted similarity, blocked by R-01${oc ? `, belongs to <span class="nmc">${nmcOf(oc)}</span>` : ''}.</span></span></li>`; }).join('')}</ul>` : '<p class="muted">No close variants in this block.</p>'}</div></div>
    <div class="panel"><div class="panel-h"><div><h3>Procurement context</h3><p>Supporting evidence only. It never overrides a technical conflict.</p></div></div>
      <div class="panel-b">${proc ? `<table><tbody>${proc.rows.map(rw => `<tr><td>${cpseTag(rw.cpse)}</td><td class="mono num">${fmtRs(rw.price)} × ${fmtN(rw.qty)} ${proc.unit}</td><td class="muted" style="font-size:12px">${rw.pos} POs</td></tr>`).join('')}</tbody></table><p style="margin-top:8px;font-size:12.5px">Combined demand <b class="mono">${fmtN(proc.demand)} ${proc.unit}</b>. Price range ${fmtRs(proc.priceMin)} to ${fmtRs(proc.priceMax)}.</p>` : '<p class="muted">Bought by only one CPSE, or no comparable purchase history.</p>'}
      ${att.length ? `<h4 style="margin:12px 0 6px">Incomplete records suggesting this material</h4><ul class="ev-list diff">${att.map(a => { const r = RES.byId.get(a.recordId); return `<li><span><a href="javascript:void 0" data-act="rv-sel" data-v="a:${r.id}" class="desc">${esc(descRec(r))}</a> <span class="faint">CPSE ${r.cpse}, missing ${r.missing.map(m => N.ATTR_LABELS[m].toLowerCase()).join(', ')}</span></span></li>`; }).join('')}</ul>` : ''}</div></div>
  </div>
  <div class="actions" role="group" aria-label="Review decision">
    ${why ? `<span class="muted" style="font-size:12.5px">${esc(why)} Switch role in the top bar to act.</span>` : decided && !rv.editing ? `<span style="font-size:13px">${pill(STATUS, st)} by ${esc(dec.by)} on ${fmtDay(dec.at)}.</span><button class="btn sm" data-act="rv-reopen" data-k="${esc(c.key)}">Reopen</button>` : rv.editing ? `
      <input class="input" id="rvNote" placeholder="Reason for the change (required)" aria-label="Reason">
      <button class="btn ok" data-act="rv-save" data-k="${esc(c.key)}">Save as new version and approve</button><button class="btn" data-act="rv-cancel">Cancel</button>` : `
      <input class="input" id="rvNote" placeholder="Note for the audit log (optional for approval)" aria-label="Review note">
      <button class="btn ok" data-act="rv-approve" data-k="${esc(c.key)}">${needsL2 && st !== 'AWAITING_L2' ? 'Approve (first level)' : st === 'AWAITING_L2' ? 'Give second approval' : 'Approve'}</button>
      <button class="btn" data-act="rv-modify">Modify</button>
      <button class="btn bad" data-act="rv-reject" data-k="${esc(c.key)}">Reject</button>
      <button class="btn" data-act="rv-escalate" data-k="${esc(c.key)}" ${st === 'ESCALATED' ? 'disabled' : ''}>Escalate</button>
      ${needsL2 ? '<span class="faint" style="font-size:12px;width:100%">Confidence is in the manual-investigation band, so a second approval by a super administrator is required.</span>' : ''}`}
  </div>`;
}
function attachDetail(a) {
  const r = RES.byId.get(a.recordId);
  const d = S.attachDecisions[r.id];
  const rv = S.ui.rv;
  if (!rv.cand || !a.candidates.some(x => x.clusterKey === rv.cand)) rv.cand = a.candidates[0].clusterKey;
  const cand = RES.clusterByKey.get(rv.cand);
  const via = RES.byId.get(a.candidates.find(x => x.clusterKey === rv.cand).viaId);
  const allowed = can('review') && (S.role !== 'CPSE_ADMIN' || r.cpse === S.tenant);
  return `<div class="panel"><div class="panel-b stack">
    <div class="detail-head"><div style="flex:1;min-width:0"><div class="row"><span class="pill p-warn">Incomplete record</span>${pill(STATUS, d ? d.status : 'PENDING')}${cpseTag(r.cpse)}<span class="code">${esc(codeOf(r))}</span></div>
      <div class="std">${esc(descRec(r))}</div><div class="muted" style="font-size:12.5px;margin-top:4px">Normalized: <span class="mono">${esc(r.norm)}</span></div></div>
      <div class="conf"><div class="v">${pct(a.candidates.find(x => x.clusterKey === rv.cand).score)}</div><div class="muted" style="font-size:12px">fit to selected material</div></div></div>
    <p class="explain rev">The description does not state <b>${r.missing.map(m => N.ATTR_LABELS[m].toLowerCase()).join(', ')}</b>, which is a critical attribute for ${N.CATEGORIES[r.category].label.toLowerCase()}s. The engine will not guess (rule R-10). Its candidates are ranked by text, attributes and procurement context${a.candidates.length > 1 ? `; the top two are ${pct(a.margin)} apart, so check purchase documents before mapping` : ''}.</p>
    <div><h4 style="margin-bottom:8px">Candidate national materials</h4><table><thead><tr><th></th><th>National code</th><th>Standard description</th><th>Status</th><th class="num">Fit</th></tr></thead><tbody>
    ${a.candidates.map(x => { const c = RES.clusterByKey.get(x.clusterKey); return `<tr class="click ${x.clusterKey === rv.cand ? 'sel' : ''}" data-act="rv-cand" data-k="${esc(x.clusterKey)}"><td><input type="radio" name="cand" aria-label="Select candidate" ${x.clusterKey === rv.cand ? 'checked' : ''}></td><td class="nmc">${nmcOf(c.key)}</td><td class="desc">${esc(descOf(c))}</td><td>${pill(STATUS, statusOf(c.key))}</td><td class="num mono">${pct(x.score)}</td></tr>`; }).join('')}
    </tbody></table></div>
  </div></div>
  ${comparePanel(r, via, { title: 'Closest record in the selected material' })}
  <div class="actions">${!allowed ? `<span class="muted" style="font-size:12.5px">${ROLES[S.role].label} cannot decide on this record. Switch role in the top bar.</span>` : d && d.status !== 'ESCALATED' ? `<span style="font-size:13px">${pill(STATUS, d.status)} by ${esc(d.by)} on ${fmtDay(d.at)}${d.status === 'APPROVED' ? `, mapped to <span class="nmc">${nmcOf(d.clusterKey)}</span>` : ''}.</span><button class="btn sm" data-act="at-reopen" data-id="${r.id}">Reopen</button>` : `
    <input class="input" id="rvNote" placeholder="How was the missing attribute confirmed? (required)" aria-label="Note">
    <button class="btn ok" data-act="at-approve" data-id="${r.id}">Map to ${nmcOf(rv.cand)}</button>
    <button class="btn bad" data-act="at-reject" data-id="${r.id}">Keep unmapped</button>
    <button class="btn" data-act="at-escalate" data-id="${r.id}">Escalate</button>`}</div>`;
}
function mountReview() {
  const el = $('#rvViewer'); if (!el) return;
  const sel = queueItems().find(i => i.id === S.ui.rv.sel);
  if (sel && sel.kind === 'CLUSTER') G.Viewer.show(el, sel.c.category, sel.c.attrs, sel.c.material);
}
function recJSON(c, status) {
  const a = RES.byId.get(c.members[0]), b = c.members[1] ? RES.byId.get(c.members[1]) : null;
  const p = b ? RES.pairOf(a.id, b.id) : null;
  const e = p ? N.explain(p, RES.byId.get(p.a), RES.byId.get(p.b)) : null;
  return {
    recommendation_id: 'REC-' + String(N.hashStr(c.key) % 1e8).padStart(8, '0'),
    national_material_code: nmcOf(c.key),
    material_a: `${a.cpse}:${a.code}`, material_b: b ? `${b.cpse}:${b.code}` : null,
    cluster_members: c.members.map(id => { const r = RES.byId.get(id); return `${r.cpse}:${r.code}`; }),
    model: 'nummf-hybrid-matcher', model_version: '0.9.0-demo',
    confidence: c.conf != null ? +c.conf.toFixed(4) : null,
    matching_features: p ? Object.fromEntries(Object.entries(p.comp).map(([k, v]) => [k, +v.toFixed(4)])) : null,
    weights: S.config.weights,
    explanation: e ? e.narrative : 'Single record: proposed as a new national material.',
    rules_applied: ['R-01', 'R-08', 'R-09', 'R-10'],
    timestamp: S.decisions[c.key]?.at || '2026-08-03T13:15:00Z',
    review_status: status || statusOf(c.key),
  };
}
function decide(key, action) {
  const c = RES.clusterByKey.get(key);
  const note = ($('#rvNote') || {}).value || '';
  const now = new Date().toISOString(), by = actorName();
  const prev = S.decisions[key] || { versions: [] };
  const code = nmcOf(key);
  if (action === 'approve') {
    if (c.band === 'INVESTIGATE' && prev.status !== 'AWAITING_L2') {
      S.decisions[key] = Object.assign({}, prev, { status: 'AWAITING_L2', by, at: now, note: note || 'First-level approval recorded.' });
      audit('FIRST_LEVEL_APPROVAL', code, `First-level approval of ${descOf(c)}. Waiting for a super administrator.`, recJSON(c, 'AWAITING_L2'));
      toast('First-level approval recorded. A super administrator must give the second approval.');
    } else if (prev.status === 'AWAITING_L2' && !can('l2')) {
      return toast('Second approval needs a super administrator. Switch role in the top bar.');
    } else if (prev.status === 'AWAITING_L2' && prev.by === by) {
      return toast('The second approval must come from a different person than the first.');
    } else {
      const v = (prev.versions || []).length + 1;
      S.decisions[key] = { status: 'APPROVED', by, at: now, note, versions: (prev.versions || []).concat([{ v, at: now, by, change: v === 1 ? 'Created from AI recommendation' : 'Re-approved', reason: note || 'Approved on review of the evidence shown.', desc: descOf(c) }]), desc: prev.desc };
      audit('NMC_APPROVED', code, `Approved ${descOf(c)} and mapped ${c.members.length} legacy code(s).`, recJSON(c, 'APPROVED'));
      toast(`${code} approved. ${c.members.length} legacy code(s) mapped.`);
    }
  } else if (action === 'reject') {
    if (!note.trim()) return toast('Add a note explaining the rejection.');
    S.decisions[key] = Object.assign({}, prev, { status: 'REJECTED', by, at: now, note });
    if (!S.retired.includes(S.registry[key])) S.retired.push(S.registry[key]);
    audit('RECOMMENDATION_REJECTED', code, `Rejected: ${note}. Code ${code} is retired and will not be reused.`, recJSON(c, 'REJECTED'));
    toast(`Rejected. ${code} is retired and will never be reused.`);
  } else if (action === 'escalate') {
    S.decisions[key] = Object.assign({}, prev, { status: 'ESCALATED', by, at: now, note: note || 'Escalated for second-level review.' });
    audit('RECOMMENDATION_ESCALATED', code, `Escalated: ${note || 'no note'}.`, recJSON(c, 'ESCALATED'));
    toast('Escalated for second-level review.');
  } else if (action === 'save') {
    const desc = ($('#stdEdit') || {}).value.trim().toUpperCase();
    if (!note.trim()) return toast('A reason is required for every change to a national material.');
    if (!desc) return toast('Standard description cannot be empty.');
    const v = (prev.versions || []).length + 1;
    S.decisions[key] = { status: 'APPROVED', by, at: now, note, desc, versions: (prev.versions || []).concat([{ v, at: now, by, change: `Standard description changed from "${descOf(c)}" to "${desc}"`, reason: note, desc }]) };
    S.ui.rv.editing = false;
    audit('NMC_MODIFIED', code, `Version ${v}: description set to ${desc}. Reason: ${note}`, recJSON(c, 'APPROVED'));
    toast(`${code} saved as version ${v} and approved.`);
  } else if (action === 'reopen') {
    S.decisions[key] = Object.assign({}, prev, { status: 'PENDING', note: 'Reopened for review.' });
    audit('DECISION_REOPENED', code, 'Decision reopened for review.');
  }
  save(); render();
}
function decideAttach(id, action) {
  const a = RES.attachments.find(x => x.recordId === id); const r = RES.byId.get(id);
  const note = ($('#rvNote') || {}).value || '';
  const now = new Date().toISOString(), by = actorName();
  if (action === 'approve') {
    if (!note.trim()) return toast('Say how the missing attribute was confirmed. It goes into the audit log.');
    const key = S.ui.rv.cand;
    S.attachDecisions[id] = { status: 'APPROVED', clusterKey: key, by, at: now, note };
    audit('MAPPING_APPROVED', `${r.cpse}:${r.code}`, `Mapped to ${nmcOf(key)} (${descOf(RES.clusterByKey.get(key))}). ${note}`);
    toast(`${r.code} mapped to ${nmcOf(key)}.`);
  } else if (action === 'reject') {
    S.attachDecisions[id] = { status: 'REJECTED', clusterKey: null, by, at: now, note: note || 'Kept unmapped.' };
    audit('MAPPING_REJECTED', `${r.cpse}:${r.code}`, `Suggestion rejected; record stays unmapped. ${note}`);
  } else if (action === 'escalate') {
    S.attachDecisions[id] = { status: 'ESCALATED', clusterKey: a.clusterKey, by, at: now, note: note || 'Escalated.' };
    audit('MAPPING_ESCALATED', `${r.cpse}:${r.code}`, 'Escalated for second-level review.');
  } else if (action === 'reopen') { delete S.attachDecisions[id]; audit('DECISION_REOPENED', `${r.cpse}:${r.code}`, 'Mapping decision reopened.'); }
  save(); render();
}

/* ---------------- Duplicate detection ---------------- */
function pageClusters() {
  const st = RES.stats, cl = S.ui.cl;
  const multi = RES.clusters.filter(c => c.members.length > 1 && (S.role !== 'CPSE_ADMIN' || c.cpses.includes(S.tenant)));
  const intra = RES.clusters.reduce((s, c) => s + c.intraDup, 0);
  const tiles = [
    ['Exact duplicates', st.cls.EXACT_MATCH || 0, 'pairs with identical normalized text and unit', 'var(--ok)'],
    ['Near duplicates', st.cls.NEAR_DUPLICATE || 0, `pairs above ${pct(S.config.thresholds.strong)} confidence`, 'var(--ok)'],
    ['Functionally equivalent', st.cls.FUNCTIONALLY_EQUIVALENT || 0, 'same critical attributes, different wording', 'var(--info)'],
    ['Internal duplicates', intra, 'extra codes for one material inside a CPSE', 'var(--warn)'],
    ['Requires review', st.cls.REQUIRES_REVIEW || 0, 'pairs missing a critical attribute', 'var(--warn)'],
    ['Merges blocked', (st.cls.VARIANT || 0), 'variants differing on one critical attribute', 'var(--bad)'],
  ];
  return `<div class="page-head"><div><h2>Duplicate detection</h2><p>Pairs are only compared inside blocks of the same category and primary dimension, then classified. Clusters form only when every critical attribute agrees, so text similarity alone can never merge two materials.</p></div></div>
  <div class="grid-3" style="margin-bottom:16px">${tiles.map(t => `<div class="metric" style="border-left:3px solid ${t[3]}"><div class="l">${t[0]}</div><div class="v">${fmtN(t[1])}</div><div class="d">${t[2]}</div></div>`).join('')}</div>
  <div class="tabs" role="tablist">${[['clusters', 'Duplicate clusters'], ['blocked', 'Blocked look-alikes']].map(([k, l]) => `<button role="tab" aria-selected="${cl.tab === k}" data-act="cl-tab" data-v="${k}">${l}</button>`).join('')}</div>
  ${cl.tab === 'clusters' ? `<div class="panel"><div class="tbl-wrap"><table><thead><tr><th>National code</th><th>Standard description</th><th>CPSEs</th><th class="num">Codes</th><th>Pair classes</th><th class="num">Confidence</th><th>Status</th></tr></thead><tbody>
  ${multi.map(c => `<tr class="click ${cl.open === c.key ? 'sel' : ''}" data-act="cl-open" data-k="${esc(c.key)}"><td class="nmc">${nmcOf(c.key)}</td><td class="desc">${esc(descOf(c))}</td><td>${cpseDots(c.cpses)}</td><td class="num mono">${c.members.length}</td><td>${Object.entries(c.clsCount).map(([k, n]) => `<span class="pill ${CLS[k][1]}" title="${CLS[k][0]}">${CLS[k][0].split(' ')[0]} ${n}</span>`).join(' ')}</td><td class="num mono">${pct(c.conf)}</td><td>${pill(STATUS, statusOf(c.key))}</td></tr>
    ${cl.open === c.key ? `<tr><td colspan="7" style="background:var(--surface-2)"><div class="stack" style="gap:8px">${c.members.map(id => { const r = RES.byId.get(id); return `<div class="row" style="gap:12px">${cpseTag(r.cpse)}<span class="code" style="min-width:120px">${esc(codeOf(r))}</span><span class="desc">${esc(descRec(r))}</span><span class="faint mono" style="font-size:11.5px">${esc(r.norm)}</span></div>`; }).join('')}<div class="row"><a class="btn sm primary" href="#/review?k=${encodeURIComponent(c.key)}">Open in review</a><button class="btn sm" data-act="nmc" data-k="${esc(c.key)}">National material record</button></div></div></td></tr>` : ''}`).join('')}
  </tbody></table></div></div>` : `<div class="panel"><div class="panel-h"><div><h3>Most similar pairs the engine refused to merge</h3><p>Sorted by weighted similarity. A naive text matcher would merge many of these.</p></div></div><div class="tbl-wrap"><table><thead><tr><th>Material A</th><th>Material B</th><th>Conflict</th><th class="num">Similarity</th><th>Decision</th></tr></thead><tbody>
  ${RES.variants.filter(p => visible(RES.byId.get(p.a)) || visible(RES.byId.get(p.b))).slice(0, 60).map(p => { const a = RES.byId.get(p.a), b = RES.byId.get(p.b); return `<tr class="click" data-act="cmp" data-a="${a.id}" data-b="${b.id}"><td><div>${cpseTag(a.cpse)}</div><span class="desc">${esc(descRec(a))}</span></td><td><div>${cpseTag(b.cpse)}</div><span class="desc">${esc(descRec(b))}</span></td><td>${p.conflicts.map(k => `<span class="pill p-bad">${N.ATTR_LABELS[k]}: ${esc(N.fmtAttr(k, a.attrs[k]))} ≠ ${esc(N.fmtAttr(k, b.attrs[k]))}</span>`).join(' ')}</td><td class="num mono">${pct(p.score)}</td><td><span class="muted" style="font-size:12.5px">Blocked by R-01</span></td></tr>`; }).join('')}
  </tbody></table></div></div>`}`;
}

/* ---------------- National master ---------------- */
function pageMaster() {
  const nm = S.ui.nm;
  let list = RES.clusters.slice();
  if (S.role === 'VIEWER') list = list.filter(c => statusOf(c.key) === 'APPROVED');
  if (nm.status) list = list.filter(c => statusOf(c.key) === nm.status);
  if (nm.cat) list = list.filter(c => c.category === nm.cat);
  if (nm.q) { const q = N.normalize(nm.q); list = list.filter(c => descOf(c).includes(q) || nmcOf(c.key).includes(nm.q.toUpperCase()) || q.split(' ').every(t => descOf(c).includes(t))); }
  return `<div class="page-head"><div><h2>National material master</h2><p>One permanent code per real material. Codes are sequential, never reused, and never change when descriptions are edited: edits create a new version instead.</p></div>
    <div class="row"><span class="pill p-ok">${RES.clusters.filter(c => statusOf(c.key) === 'APPROVED').length} approved</span><span class="pill p-acc">${RES.clusters.filter(c => statusOf(c.key) !== 'APPROVED' && statusOf(c.key) !== 'REJECTED').length} proposed</span>${S.retired.length ? `<span class="pill p-bad">${S.retired.length} retired</span>` : ''}</div></div>
  <form class="filters" data-form="nm"><label class="field">Search<input class="input" name="q" type="search" value="${esc(nm.q)}" placeholder="Code or description"></label>
    <label class="field">Status<select class="select" name="status"><option value="">Any status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${nm.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
    <label class="field">Category<select class="select" name="cat"><option value="">All categories</option>${N.CAT_ORDER.filter(k => k !== 'UNCLASSIFIED').map(k => `<option value="${k}" ${nm.cat === k ? 'selected' : ''}>${N.CATEGORIES[k].label}</option>`).join('')}</select></label><button class="btn" type="submit">Apply</button></form>
  ${S.role === 'VIEWER' ? '<p class="muted" style="margin-bottom:10px;font-size:12.5px">Viewers see approved national materials only.</p>' : ''}
  <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>National code</th><th>Standard description</th><th>Category</th><th>Material</th><th>CPSEs</th><th class="num">Mapped codes</th><th class="num">Version</th><th>Status</th></tr></thead><tbody>
  ${list.map(c => `<tr class="click" data-act="nmc" data-k="${esc(c.key)}"><td class="nmc">${nmcOf(c.key)}</td><td class="desc">${esc(descOf(c))}</td><td>${N.CATEGORIES[c.category].label}</td><td class="mono" style="font-size:12px">${esc(c.material || '—')}</td><td>${cpseDots(c.cpses)}</td><td class="num mono">${c.members.length + Object.values(S.attachDecisions).filter(d => d.status === 'APPROVED' && d.clusterKey === c.key).length}</td><td class="num mono">${versionOf(c) || '—'}</td><td>${pill(STATUS, statusOf(c.key))}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No national materials match.</td></tr>'}
  </tbody></table></div></div>`;
}
function openNMC(key) {
  const c = RES.clusterByKey.get(key); if (!c) return;
  const dec = S.decisions[key] || {};
  const attached = Object.entries(S.attachDecisions).filter(([, d]) => d.status === 'APPROVED' && d.clusterKey === key).map(([id]) => RES.byId.get(id)).filter(Boolean);
  const auditFor = S.audit.filter(a => a.target === nmcOf(key));
  openDrawer(`<div><span class="nmc" style="font-size:16px">${nmcOf(key)}</span> ${pill(STATUS, statusOf(key))}</div>`, `
    <div><div class="std">${esc(descOf(c))}</div><div class="muted" style="font-size:12.5px;margin-top:4px">${N.CATEGORIES[c.category].group} / ${N.CATEGORIES[c.category].label}. ${versionOf(c) ? 'Version ' + versionOf(c) + '.' : 'Not yet approved.'}</div></div>
    ${viewerHTML('nmViewer', c)}
    <div class="grid-2"><div><h4 style="margin-bottom:8px">Attributes and lineage</h4><table class="attr-tbl"><tbody>${Object.entries(c.lineage).map(([k, ids]) => `<tr><td>${N.ATTR_LABELS[k]}</td><td><span class="mono">${esc(N.fmtAttr(k, c.attrs[k]))}</span><div class="faint" style="font-size:11.5px">${ids.map(id => { const r = RES.byId.get(id); return `${r.cpse}:${esc(codeOf(r))}`; }).join(', ')}</div></td></tr>`).join('')}</tbody></table></div>
    <div><h4 style="margin-bottom:8px">Fingerprint</h4><div class="fp">${N.fingerprintLines(c.category, c.attrs, 'EA').filter(l => l[0] !== 'UNIT').map(([k, v]) => `<b>${k}</b> = ${esc(v)}`).join('<br>')}</div></div></div>
    <div><h4 style="margin-bottom:8px">CPSE mappings</h4><table><thead><tr><th>CPSE</th><th>Legacy code</th><th>Original description</th><th>Unit</th><th>How</th></tr></thead><tbody>
      ${c.members.map(id => RES.byId.get(id)).concat(attached).map(r => `<tr class="click" data-act="rec" data-id="${r.id}"><td>${cpseTag(r.cpse)}</td><td class="code">${esc(codeOf(r))}</td><td class="desc">${esc(descRec(r))}</td><td class="mono">${esc(r.unit || '—')}</td><td>${r.complete ? '<span class="pill p-info">Cluster member</span>' : '<span class="pill p-warn">Reviewed attachment</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div><h4 style="margin-bottom:8px">Version history</h4>${(dec.versions || []).length ? `<table><thead><tr><th>Version</th><th>When</th><th>Who</th><th>Change</th><th>Reason</th></tr></thead><tbody>${dec.versions.slice().reverse().map(v => `<tr><td class="mono">v${v.v}</td><td style="white-space:nowrap">${fmtDate(v.at)}</td><td>${esc(v.by)}</td><td>${esc(v.change)}</td><td class="muted">${esc(v.reason)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No approved version yet.</p>'}</div>
    <div><h4 style="margin-bottom:8px">Audit trail</h4>${auditFor.length ? `<ul class="ev-list">${auditFor.map(a => `<li><span><span class="mono faint" style="font-size:11.5px">${fmtDate(a.at)}</span> ${esc(a.actor)}: ${esc(a.detail)}</span></li>`).join('')}</ul>` : '<p class="muted">No events yet.</p>'}</div>
    <div><h4 style="margin-bottom:8px">Recommendation record</h4><pre class="json">${esc(JSON.stringify(recJSON(c), null, 2))}</pre></div>
    <div class="row"><a class="btn primary" href="#/review?k=${encodeURIComponent(key)}" data-act="close">Open in match review</a></div>`,
    () => { const el = $('#nmViewer'); if (el) G.Viewer.show(el, c.category, c.attrs, c.material); });
}

/* ---------------- Record drawer ---------------- */
function openRecord(id) {
  const r = RES.byId.get(id); if (!r) return;
  if (!visible(r)) { toast(`Record belongs to CPSE ${r.cpse}. Tenant isolation hides it from CPSE ${S.tenant}.`); return; }
  const st = recordStatus(r), k = mappedNMC(r);
  const sims = RES.pairs.filter(p => p.a === id || p.b === id).sort((a, b) => b.score - a.score).slice(0, 6);
  openDrawer(`<div class="row">${cpseTag(r.cpse)}<span class="code" style="font-size:14px;font-weight:600">${esc(r.code)}</span><span class="pill ${st[1]}">${st[0]}</span></div>`, `
    <dl class="kv"><dt>Original description</dt><dd class="desc">${esc(r.desc)}</dd><dt>Normalized</dt><dd class="desc">${esc(r.norm)}</dd><dt>Category</dt><dd>${N.CATEGORIES[r.category].group} / ${N.CATEGORIES[r.category].label}</dd><dt>Unit</dt><dd class="mono">${esc(r.unit || '—')}${r.unitInfo ? ` <span class="faint">(${r.unitInfo.family}, canonical ${r.unitInfo.canon}${r.unitInfo.factor !== 1 ? ' × ' + r.unitInfo.factor : ''})</span>` : ' <span class="pill p-bad">not recognised</span>'}</dd><dt>Plant</dt><dd>${esc(r.plant)}</dd><dt>Source</dt><dd>${esc(r.source)}</dd>
      <dt>National code</dt><dd>${k ? `<a href="javascript:void 0" class="nmc" data-act="nmc" data-k="${esc(k)}">${nmcOf(k)}</a> ${r.complete ? '' : '<span class="faint">(suggested)</span>'}` : '<span class="faint">None. Description lacks a recognisable material.</span>'}</dd></dl>
    <div class="grid-2"><div><h4 style="margin-bottom:8px">Extracted attributes</h4><table class="attr-tbl"><tbody>${N.CATEGORIES[r.category].critical.concat(Object.keys(r.attrs).filter(x => !N.CATEGORIES[r.category].critical.includes(x))).map(k2 => `<tr><td>${N.ATTR_LABELS[k2]}</td><td class="mono">${r.attrs[k2] !== undefined ? esc(N.fmtAttr(k2, r.attrs[k2])) : '<span class="res warn">Missing</span>'}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No attributes could be extracted.</td></tr>'}</tbody></table></div>
    <div><h4 style="margin-bottom:8px">Material fingerprint</h4><div class="fp">${N.fingerprintLines(r.category, r.attrs, r.unitInfo ? r.unitInfo.canon : r.unit).map(([a, v]) => `<b>${a}</b> = ${esc(v)}`).join('<br>')}</div></div></div>
    ${r.quality.length ? `<div><h4 style="margin-bottom:6px">Data quality</h4><ul class="ev-list diff">${r.quality.map(q => `<li>${esc(q.msg)}</li>`).join('')}</ul></div>` : ''}
    <div><h4 style="margin-bottom:8px">Procurement history</h4>${r.history.length ? `<table><thead><tr><th>Year</th><th class="num">Quantity</th><th class="num">Unit price</th><th>Supplier</th></tr></thead><tbody>${r.history.map(h => `<tr><td class="mono">${h.year}</td><td class="num mono">${fmtN(h.qty)} ${esc(r.unit)}</td><td class="num mono">${fmtRs(h.price)}</td><td>${esc(h.supplier)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No purchase history.</p>'}</div>
    <div><h4 style="margin-bottom:8px">Most similar records</h4>${sims.length ? `<table><thead><tr><th>CPSE</th><th>Description</th><th>Class</th><th class="num">Score</th></tr></thead><tbody>${sims.map(p => { const o = RES.byId.get(p.a === id ? p.b : p.a); return `<tr class="click" data-act="cmp" data-a="${id}" data-b="${o.id}"><td>${cpseTag(o.cpse)}</td><td class="desc">${esc(descRec(o))}</td><td>${pill(CLS, p.cls)}</td><td class="num mono">${pct(p.score)}</td></tr>`; }).join('')}</tbody></table><p class="faint" style="font-size:12px;margin-top:6px">Click a row for the full comparison.</p>` : '<p class="muted">Not compared: unclassified records are not matched.</p>'}</div>`);
}
function openCompare(a, b) {
  const r1 = RES.byId.get(a), r2 = RES.byId.get(b);
  openDrawer('<b>Material comparison</b>', comparePanel(r1, r2));
}

/* ---------------- Mappings ---------------- */
function mappingRows() {
  const rows = [];
  for (const r of RES.records) {
    if (!visible(r)) continue;
    let key = null, conf = null, status, by = '', at = '', ver = '';
    if (r.complete) {
      key = r.clusterKey; const c = RES.clusterByKey.get(key); conf = memberConf(c, r.id); const d = S.decisions[key];
      status = statusOf(key); if (d) { by = d.by; at = d.at; ver = versionOf(c) || ''; }
    } else if (r.category !== 'UNCLASSIFIED') {
      const d = S.attachDecisions[r.id]; const a = RES.attachments.find(x => x.recordId === r.id);
      key = d && d.clusterKey ? d.clusterKey : r.suggestedCluster; conf = a ? a.score : null; status = d ? d.status : 'PENDING'; if (d) { by = d.by; at = d.at; }
    } else status = 'UNMAPPED';
    rows.push({ r, key, conf, status, by, at, ver });
  }
  return rows;
}
function pageMappings() {
  const mp = S.ui.mp;
  let rows = mappingRows();
  if (mp.cpse) rows = rows.filter(x => x.r.cpse === mp.cpse);
  if (mp.status) rows = rows.filter(x => x.status === mp.status);
  const cov = N.CPSES.filter(c => S.role !== 'CPSE_ADMIN' || c.id === S.tenant).map(c => { const rs = mappingRows().filter(x => x.r.cpse === c.id); return { c, n: rs.length, ok: rs.filter(x => x.status === 'APPROVED').length, pend: rs.filter(x => ['PENDING', 'ESCALATED', 'AWAITING_L2'].includes(x.status)).length, un: rs.filter(x => x.status === 'UNMAPPED' || x.status === 'REJECTED').length }; });
  return `<div class="page-head"><div><h2>Mapping explorer</h2><p>Every CPSE legacy code and its national code. CPSEs keep their own codes: this table is the bridge, and it is what an ERP migration would load.</p></div><button class="btn" data-act="copy-csv">Copy as CSV</button></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-h"><div><h3>Migration readiness</h3><p>Approved mappings per CPSE. Pending and unmapped codes must be resolved before cut-over.</p></div><div class="legend"><span><i class="sw" style="background:var(--ok)"></i>Approved</span><span><i class="sw" style="background:var(--accent-fill)"></i>Pending</span><span><i class="sw" style="background:var(--bad)"></i>Unmapped or rejected</span></div></div><div class="panel-b stack" style="gap:10px">
    ${cov.map(x => `<div class="row" style="gap:12px"><span style="width:90px">${cpseTag(x.c.id)}</span><div class="meter" style="flex:1;height:10px"><i style="width:${x.ok / x.n * 100}%;background:var(--ok)"></i><i style="width:${x.pend / x.n * 100}%;background:var(--accent-fill)"></i><i style="width:${x.un / x.n * 100}%;background:var(--bad)"></i></div><span class="mono" style="width:150px;text-align:right;font-size:12px">${x.ok}/${x.n} approved (${pct(x.ok / x.n)})</span></div>`).join('')}</div></div>
  <form class="filters" data-form="mp">${S.role === 'CPSE_ADMIN' ? '' : `<label class="field">CPSE<select class="select" name="cpse"><option value="">All CPSEs</option>${N.CPSES.map(c => `<option value="${c.id}" ${mp.cpse === c.id ? 'selected' : ''}>${c.id}: ${c.short}</option>`).join('')}</select></label>`}
    <label class="field">Mapping status<select class="select" name="status"><option value="">Any</option>${['APPROVED', 'PENDING', 'AWAITING_L2', 'ESCALATED', 'REJECTED', 'UNMAPPED'].map(s => `<option value="${s}" ${mp.status === s ? 'selected' : ''}>${STATUS[s] ? STATUS[s][0] : 'Unmapped'}</option>`).join('')}</select></label><button class="btn" type="submit">Apply</button></form>
  <div class="panel"><div class="tbl-wrap" style="max-height:620px;overflow:auto"><table><thead><tr><th>CPSE</th><th>Legacy code</th><th>National code</th><th>Original description</th><th>Standard description</th><th class="num">Confidence</th><th>Status</th><th>Approved by</th><th>Date</th><th class="num">Version</th></tr></thead><tbody>
  ${rows.slice(0, 400).map(x => `<tr class="click" data-act="rec" data-id="${x.r.id}"><td>${cpseTag(x.r.cpse)}</td><td class="code">${esc(x.r.code)}</td><td>${x.key ? `<span class="nmc" style="${x.status === 'APPROVED' ? '' : 'opacity:.55'}">${nmcOf(x.key)}</span>` : '<span class="faint">—</span>'}</td><td class="desc">${esc(x.r.desc)}</td><td class="desc muted">${x.key ? esc(descOf(RES.clusterByKey.get(x.key))) : ''}</td><td class="num mono">${pct(x.conf)}</td><td>${x.status === 'UNMAPPED' ? '<span class="pill p-mute">Unmapped</span>' : pill(STATUS, x.status)}</td><td style="font-size:12.5px">${esc(x.status === 'APPROVED' ? x.by : '')}</td><td style="font-size:12.5px;white-space:nowrap">${x.status === 'APPROVED' && x.at ? fmtDay(x.at) : ''}</td><td class="num mono">${x.ver ? 'v' + x.ver : ''}</td></tr>`).join('')}
  </tbody></table></div><p class="muted" style="padding:10px 14px;font-size:12.5px">${fmtN(rows.length)} mappings${rows.length > 400 ? ', first 400 shown' : ''}.</p></div>`;
}

/* ---------------- Procurement ---------------- */
function pageProcurement() {
  const pr = S.ui.pr;
  const list = RES.procurement;
  if (!pr.sel || !list.some(p => p.clusterKey === pr.sel)) pr.sel = list[0] && list[0].clusterKey;
  const p = list.find(x => x.clusterKey === pr.sel);
  const c = p && RES.clusterByKey.get(p.clusterKey);
  const maxQ = p ? Math.max(...p.rows.map(r => r.qty)) : 1;
  return `<div class="page-head"><div><h2>Procurement opportunities</h2><p>Once records share a national code, demand that was scattered across CPSEs becomes visible. These are potential opportunities for aggregation and supplier rationalisation, not savings estimates.</p></div></div>
  ${p ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><div><div class="row"><span class="nmc">${nmcOf(c.key)}</span>${pill(STATUS, statusOf(c.key))}</div><h3 style="margin-top:4px" class="mono">${esc(descOf(c))}</h3></div><a class="btn sm" href="#/review?k=${encodeURIComponent(c.key)}">Open evidence</a></div>
    <div class="panel-b grid-2">
      <div><h4 style="margin-bottom:10px">Purchase history by CPSE</h4><table><tbody>${p.rows.map(r => `<tr><td>${cpseTag(r.cpse)}</td><td class="mono" style="font-size:14px">${fmtRs(r.price)} × ${fmtN(r.qty)}</td><td class="muted" style="font-size:12px">${r.pos} PO${r.pos > 1 ? 's' : ''}, ${esc(r.suppliers.join(', '))}</td></tr>`).join('')}
        <tr><td><b>Combined</b></td><td class="mono" style="font-size:14px;font-weight:600">${fmtN(p.demand)} ${p.unit}</td><td class="muted" style="font-size:12px">${p.pos} POs, ${p.suppliers.length} suppliers</td></tr></tbody></table>
        <p class="explain" style="margin-top:12px">Potential opportunity: ${p.cpseCount} CPSEs buy the same material separately. Unit prices range from ${fmtRs(p.priceMin)} to ${fmtRs(p.priceMax)} per ${p.unit} (${pct(p.spread)} spread). No savings figure is shown: prices differ by plant, period, quantity and contract terms, and this synthetic data cannot support a savings claim.</p></div>
      <div><h4 style="margin-bottom:10px">Unit price and quantity</h4>
        <svg viewBox="0 0 420 ${p.rows.length * 46 + 30}" width="100%" role="img" aria-label="Price and quantity by CPSE">${p.rows.map((r, i) => { const y = i * 46 + 6; const w1 = r.price / p.priceMax * 250, w2 = r.qty / maxQ * 250; return `<text x="0" y="${y + 14}" font-size="12" fill="currentColor">CPSE ${r.cpse}</text><rect x="70" y="${y + 3}" width="${w1}" height="13" rx="2" fill="${CPSE_COLORS[r.cpse]}"/><text x="${76 + w1}" y="${y + 14}" font-size="11.5" font-family="var(--mono)" fill="var(--muted)">${fmtRs(r.price)}</text><rect x="70" y="${y + 20}" width="${w2}" height="8" rx="2" fill="${CPSE_COLORS[r.cpse]}" opacity=".4"/><text x="${76 + w2}" y="${y + 28}" font-size="11" font-family="var(--mono)" fill="var(--faint)">${fmtN(r.qty)} ${p.unit}</text>`; }).join('')}
        <text x="70" y="${p.rows.length * 46 + 24}" font-size="11" fill="var(--muted)">Solid bar: average unit price. Light bar: quantity bought.</text></svg>
        ${p.excluded ? `<p class="muted" style="font-size:12px;margin-top:6px">${p.excluded} record(s) excluded because their unit could not be converted.</p>` : ''}</div>
    </div></div>` : ''}
  <div class="panel"><div class="panel-h"><div><h3>All opportunities</h3><p>Ranked by spend, number of CPSEs, price spread, shared suppliers and order frequency</p></div></div><div class="tbl-wrap" style="max-height:560px;overflow:auto"><table><thead><tr><th>Material</th><th>CPSEs</th><th class="num">Combined demand</th><th class="num">Historical spend</th><th class="num">Unit price range</th><th class="num">Spread</th><th class="num">Shared suppliers</th><th class="num">POs</th><th>Status</th></tr></thead><tbody>
  ${list.map(x => { const cc = RES.clusterByKey.get(x.clusterKey); return `<tr class="click ${x.clusterKey === pr.sel ? 'sel' : ''}" data-act="pr-sel" data-k="${esc(x.clusterKey)}"><td><div class="nmc" style="font-size:12px">${nmcOf(cc.key)}</div><span class="desc">${esc(descOf(cc))}</span></td><td>${cpseDots(x.rows.map(r => r.cpse))}</td><td class="num mono">${fmtN(x.demand)} ${x.unit}</td><td class="num mono">${fmtRsShort(x.spend)}</td><td class="num mono">${fmtRs(x.priceMin)} – ${fmtRs(x.priceMax)}</td><td class="num mono">${x.outlier ? `<span class="pill p-bad" title="Very large spread: check units or prices">${pct(x.spread)}</span>` : pct(x.spread)}</td><td class="num mono">${pct(x.supplierOverlap)}</td><td class="num mono">${x.pos}</td><td>${pill(STATUS, statusOf(x.clusterKey))}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
}

/* ---------------- Governance ---------------- */
const API = [
  ['POST', '/materials/upload', 'Upload a CPSE material master (CSV, Excel, JSON).'],
  ['POST', '/materials/normalize', 'Normalize one description.'],
  ['POST', '/materials/extract-attributes', 'Extract category and attributes.'],
  ['POST', '/materials/match', 'Score two materials and explain the result.'],
  ['GET', '/materials/{id}/similar', 'Most similar records to one material.'],
  ['POST', '/clusters/generate', 'Re-run blocking, matching and clustering.'],
  ['GET', '/clusters/{id}', 'One duplicate cluster with members and evidence.'],
  ['POST', '/national-materials', 'Create a national material from an approved cluster.'],
  ['GET', '/national-materials/{nmc}', 'National material with attributes and lineage.'],
  ['POST', '/mappings/approve', 'Approve a legacy-to-national mapping.'],
  ['GET', '/mappings/{cpse_id}', 'All mappings for one CPSE.'],
  ['GET', '/procurement/opportunities', 'Ranked cross-CPSE procurement opportunities.'],
  ['GET', '/audit/logs', 'Audit events, filterable by action and target.'],
];
function apiSample(i) {
  const demo = RES.clusterByKey.get(N.DEMO_BOLT_KEY); const a = RES.byId.get(demo.members[0]), b = RES.byId.get(demo.members[1]);
  switch (i) {
    case 0: return { file: 'cpse_b_material_master.xlsx', accepted: 112, rejected: [{ line: 41, reason: 'Description is empty.' }], warnings: 3, job_id: 'ING-20261001-0007' };
    case 1: return { input: b.desc, normalized: b.norm };
    case 2: return { input: b.desc, category: b.category, attributes: b.attrs, missing: b.missing, fingerprint: Object.fromEntries(N.fingerprintLines(b.category, b.attrs, b.unitInfo.canon)) };
    case 3: { const p = RES.pairOf(a.id, b.id); const e = N.explain(p, RES.byId.get(p.a), RES.byId.get(p.b)); return { material_a: `${a.cpse}:${a.code}`, material_b: `${b.cpse}:${b.code}`, classification: p.cls, confidence: +p.score.toFixed(4), components: Object.fromEntries(Object.entries(p.comp).map(([k, v]) => [k, +v.toFixed(4)])), reasons: e.reasons, differences: e.differences, explanation: e.narrative }; }
    case 4: return { material: `${a.cpse}:${a.code}`, similar: RES.pairs.filter(p => p.a === a.id || p.b === a.id).sort((x, y) => y.score - x.score).slice(0, 4).map(p => { const o = RES.byId.get(p.a === a.id ? p.b : p.a); return { material: `${o.cpse}:${o.code}`, description: o.desc, classification: p.cls, score: +p.score.toFixed(3) }; }) };
    case 5: return { records: RES.stats.records, candidate_pairs: RES.stats.compared, naive_pairs: RES.stats.naivePairs, clusters: RES.stats.clusters, runtime_ms: RES.stats.ms };
    case 6: return { cluster_id: demo.key, members: demo.members.map(id => { const r = RES.byId.get(id); return `${r.cpse}:${r.code}`; }), confidence: +demo.conf.toFixed(4), band: demo.band, pair_classes: demo.clsCount };
    case 7: return { national_material_code: nmcOf(demo.key), standard_description: descOf(demo), status: 'PENDING_APPROVAL', source_cluster: demo.key };
    case 8: return { national_material_code: nmcOf(demo.key), standard_description: descOf(demo), category: demo.category, attributes: demo.attrs, lineage: Object.fromEntries(Object.entries(demo.lineage).map(([k, ids]) => [k, ids.map(id => { const r = RES.byId.get(id); return `${r.cpse}:${r.code}`; })])), status: statusOf(demo.key), version: versionOf(demo) };
    case 9: return { cpse_id: a.cpse, legacy_material_code: a.code, national_material_code: nmcOf(demo.key), approved_by: 'material.expert@cpse.example', approval_note: 'Verified against drawing and PO text.' };
    case 10: return { cpse_id: 'A', mappings: mappingRows().filter(x => x.r.cpse === 'A' && x.key).slice(0, 3).map(x => ({ legacy_material_code: x.r.code, national_material_code: nmcOf(x.key), status: x.status, confidence: x.conf != null ? +x.conf.toFixed(3) : null })) };
    case 11: return { opportunities: RES.procurement.slice(0, 2).map(p => ({ national_material_code: nmcOf(p.clusterKey), cpses: p.rows.map(r => r.cpse), combined_demand: p.demand, unit: p.unit, price_range: [+p.priceMin.toFixed(2), +p.priceMax.toFixed(2)], note: 'Potential opportunity. No savings estimate.' })) };
    case 12: return { events: S.audit.slice(0, 3).map(a => ({ id: a.id, timestamp: a.at, actor: a.actor, action: a.action, target: a.target, detail: a.detail })) };
  }
}
function pageGovernance() {
  const g = S.ui.gov;
  const tabs = [['audit', 'Audit log'], ['records', 'Recommendation records'], ['eval', 'Model evaluation'], ['api', 'API reference'], ['security', 'Access and security']];
  let body = '';
  if (g.tab === 'audit') {
    const actions = [...new Set(S.audit.map(a => a.action))].sort();
    let list = S.audit;
    if (g.action) list = list.filter(a => a.action === g.action);
    if (g.q) { const q = g.q.toLowerCase(); list = list.filter(a => (a.target + a.detail + a.actor).toLowerCase().includes(q)); }
    body = `<form class="filters" data-form="gov"><label class="field">Search<input class="input" name="q" type="search" value="${esc(g.q)}" placeholder="NMC code, CPSE code, actor"></label><label class="field">Action<select class="select" name="action"><option value="">All actions</option>${actions.map(a => `<option ${g.action === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label><button class="btn" type="submit">Apply</button></form>
    <div class="panel"><div class="tbl-wrap" style="max-height:640px;overflow:auto"><table><thead><tr><th>Event</th><th>Time</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
    ${list.slice(0, 300).map(a => `<tr><td class="mono" style="font-size:11.5px">${a.id}</td><td style="white-space:nowrap;font-size:12.5px">${fmtDate(a.at)}</td><td style="font-size:12.5px">${esc(a.actor)}</td><td style="font-size:12.5px">${esc(a.role)}</td><td><span class="pill ${/REJECT|BLOCK/.test(a.action) ? 'p-bad' : /ESCAL|FIRST/.test(a.action) ? 'p-warn' : /APPROV|MODIF/.test(a.action) ? 'p-ok' : 'p-mute'}">${esc(a.action)}</span></td><td class="mono" style="font-size:12px">${esc(a.target)}</td><td style="font-size:12.5px">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No events.</td></tr>'}
    </tbody></table></div><p class="muted" style="padding:10px 14px;font-size:12.5px">${list.length} events. Append-only: the interface offers no way to edit or delete an entry.</p></div>`;
  } else if (g.tab === 'records') {
    const cl = RES.clusters.filter(c => c.members.length > 1);
    if (!g.rec || !RES.clusterByKey.get(g.rec)) g.rec = N.DEMO_BOLT_KEY;
    body = `<div class="grid-2"><div class="panel"><div class="panel-h"><div><h3>Recommendations</h3><p>Every AI recommendation is stored with its features and model version</p></div></div><div class="tbl-wrap" style="max-height:560px;overflow:auto"><table><tbody>${cl.map(c => `<tr class="click ${g.rec === c.key ? 'sel' : ''}" data-act="gov-rec" data-k="${esc(c.key)}"><td class="nmc" style="font-size:12px">${nmcOf(c.key)}</td><td class="desc">${esc(descOf(c))}</td><td>${pill(STATUS, statusOf(c.key))}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-h"><h3>Record</h3></div><div class="panel-b"><pre class="json">${esc(JSON.stringify(recJSON(RES.clusterByKey.get(g.rec)), null, 2))}</pre></div></div></div>`;
  } else if (g.tab === 'eval') {
    const ev = RES.eval;
    const decs = Object.values(S.decisions).filter(d => d.status === 'APPROVED' || d.status === 'REJECTED');
    const appr = decs.length ? decs.filter(d => d.status === 'APPROVED').length / decs.length : null;
    const attOk = RES.attachments.filter(a => { const r = RES.byId.get(a.recordId); const c = RES.clusterByKey.get(a.clusterKey); return r.truthCat && RES.byId.get(c.members[0]).truth === r.truth; }).length;
    const attN = RES.attachments.filter(a => RES.byId.get(a.recordId).truthCat).length;
    const m = [
      ['Matching precision', pct1(ev.precision), `${fmtN(ev.tp)} of ${fmtN(ev.pred)} predicted same-material pairs are correct`],
      ['Matching recall', pct1(ev.recall), `${fmtN(ev.fn)} true pairs missed, all involving incomplete records sent to review`],
      ['F1 score', ev.f1.toFixed(3), 'Harmonic mean of precision and recall'],
      ['False positive rate', pct1(ev.fpr), `${fmtN(ev.fp)} wrong merges out of every non-matching pair`],
      ['False negative rate', pct1(ev.fnr), 'Missed pairs, recovered through human review'],
      ['Attribute extraction accuracy', pct1(ev.attrAcc), `${fmtN(ev.attrTotal)} stated critical attributes checked`],
      ['Category accuracy', pct1(ev.catAcc), 'Detected category against generator label'],
      ['Unsafe merges prevented', fmtN(ev.prevented), 'Look-alike pairs blocked by a critical-attribute conflict'],
      ['Review suggestion accuracy', attN ? pct1(attOk / attN) : '—', `Top candidate correct for ${attOk} of ${attN} incomplete records. Why a human decides.`],
      ['Human approval rate', appr == null ? '—' : pct1(appr), `${decs.length} decided recommendations, including seeded history`],
      ['Candidate pairs scored', fmtN(RES.stats.compared), `of ${fmtN(RES.stats.naivePairs)} possible, using ${RES.stats.blocks} blocks`],
      ['Pipeline runtime', RES.stats.ms + ' ms', `${fmtN(RES.stats.records)} records, in this browser`],
    ];
    body = `<p class="muted" style="margin-bottom:12px;max-width:80ch">Measured against ground truth: each synthetic record was generated from a known canonical item, so the true answer is known. Real deployments would measure the same metrics on an expert-labelled sample.</p>
    <div class="grid-3">${m.map(x => `<div class="metric"><div class="l">${x[0]}</div><div class="v">${x[1]}</div><div class="d">${x[2]}</div></div>`).join('')}</div>
    <div class="panel" style="margin-top:16px"><div class="panel-h"><h3>Pair classification counts</h3></div><div class="panel-b">${hBars(Object.entries(RES.stats.cls).map(([k, v]) => ({ label: CLS[k][0], value: v, color: CLS[k][1] === 'p-bad' ? 'var(--bad)' : CLS[k][1] === 'p-warn' ? 'var(--warn)' : CLS[k][1] === 'p-ok' ? 'var(--ok)' : CLS[k][1] === 'p-info' ? 'var(--info)' : 'var(--line-strong)' })), null, 620, fmtN)}</div></div>`;
  } else if (g.tab === 'api') {
    body = `<div class="grid-2"><div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Method</th><th>Endpoint</th><th>Purpose</th></tr></thead><tbody>${API.map((x, i) => `<tr class="click ${g.api === i ? 'sel' : ''}" data-act="gov-api" data-v="${i}"><td><span class="pill ${x[0] === 'GET' ? 'p-info' : 'p-acc'}">${x[0]}</span></td><td class="mono">${x[1]}</td><td style="font-size:12.5px">${x[2]}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-h"><div><h3 class="mono">${API[g.api][0]} ${API[g.api][1]}</h3><p>Sample response built from the live data in this session</p></div></div><div class="panel-b"><pre class="json">${esc(JSON.stringify(apiSample(g.api), null, 2))}</pre></div></div></div>`;
  } else {
    body = `<div class="grid-2"><div class="panel"><div class="panel-h"><h3>Role permissions</h3></div><div class="tbl-wrap"><table><thead><tr><th>Role</th><th>Review</th><th>Second approval</th><th>Upload</th><th>Settings</th><th>Data scope</th></tr></thead><tbody>${Object.entries(ROLES).map(([k, r]) => `<tr ${k === S.role ? 'class="sel"' : ''}><td>${r.label}</td>${['review', 'l2', 'upload', 'settings'].map(p => `<td>${r.can.includes(p) ? '<span class="res ok">Yes</span>' : '<span class="res mute">No</span>'}</td>`).join('')}<td style="font-size:12.5px">${k === 'CPSE_ADMIN' ? 'Own CPSE only' : k === 'VIEWER' ? 'Approved materials' : 'All CPSEs'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-h"><h3>Controls in this build</h3></div><div class="panel-b"><ul class="ev-list">
      <li>Tenant isolation: a CPSE administrator sees other CPSEs’ codes and descriptions as “Restricted”.</li>
      <li>No autonomous approval: every national code and mapping needs a named reviewer.</li>
      <li>Two-person rule for low-confidence recommendations: first and second approvals must come from different people.</li>
      <li>National codes are sequential and never reused; rejected codes are retired.</li>
      <li>Every change to a national material creates a version with a mandatory reason.</li>
      <li>Append-only audit log with the recommendation record attached to each decision.</li>
      <li>Uploads are validated; duplicate files are detected by content hash.</li>
    </ul><p class="muted" style="font-size:12.5px;margin-top:12px">Production controls not shown in this frontend: OAuth2 / JWT, encryption in transit and at rest, server-side RBAC enforcement, secrets management, rate limiting and SIEM integration.</p></div></div></div>`;
  }
  return `<div class="page-head"><div><h2>Governance and audit</h2><p>Who decided what, on which evidence, with which model version.</p></div></div>
  <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${g.tab === k}" data-act="gov-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
}

/* ---------------- Settings ---------------- */
function pageSettings() {
  const cfg = S.draftConfig || S.config;
  const W = cfg.weights, T = cfg.thresholds, wsum = Object.values(W).reduce((a, b) => a + b, 0) || 1;
  const ok = can('settings');
  return `<div class="page-head"><div><h2>Settings and rules</h2><p>Matching weights and confidence thresholds are configurable. Changing them re-scores every pair and moves recommendations between bands, but cannot make two materials with conflicting critical attributes merge.</p></div></div>
  ${ok ? '' : `<p class="explain rev" style="margin-bottom:16px">Only a super administrator can change settings. You can still explore the values.</p>`}
  <div class="grid-2" style="margin-bottom:16px">
    <div class="panel"><div class="panel-h"><div><h3>Similarity weights</h3><p>Normalized to 100%</p></div></div><div class="panel-b">
      ${COMP.map(([k, l]) => `<div class="range-row"><label for="w-${k}">${l}</label><input id="w-${k}" type="range" min="0" max="50" step="1" value="${W[k]}" data-input="w" data-k="${k}"><span class="mono" style="text-align:right">${W[k]}</span><span class="mono faint" style="text-align:right">${Math.round(W[k] / wsum * 100)}%</span></div>`).join('')}</div></div>
    <div class="panel"><div class="panel-h"><div><h3>Confidence thresholds</h3><p>Decide which band a recommendation lands in</p></div></div><div class="panel-b">
      ${[['strong', 'Strong match'], ['review', 'Human review'], ['manual', 'Manual investigation']].map(([k, l]) => `<div class="range-row"><label for="t-${k}">${l}</label><input id="t-${k}" type="range" min="0.5" max="0.99" step="0.01" value="${T[k]}" data-input="t" data-k="${k}"><span class="mono" style="text-align:right">${Math.round(T[k] * 100)}%</span><span></span></div>`).join('')}
      <p class="muted" style="font-size:12.5px;margin-top:8px">Below ${Math.round(T.manual * 100)}%: no match. Manual-investigation recommendations need a second approval.</p>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-act="cfg-apply" ${ok ? '' : 'disabled'}>Apply and re-score</button><button class="btn" data-act="cfg-reset" ${ok ? '' : 'disabled'}>Restore defaults</button>${S.draftConfig ? '<span class="pill p-warn">Unsaved changes</span>' : ''}</div></div></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-h"><div><h3>Domain rules</h3><p>Applied deterministically before and after scoring</p></div></div><div class="tbl-wrap"><table><tbody>${N.DOMAIN_RULES.map(r => `<tr><td class="mono" style="width:60px">${r.id}</td><td style="width:280px"><b style="font-weight:500">${esc(r.name)}</b></td><td class="muted">${esc(r.detail)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid-2">
    <div class="panel"><div class="panel-h"><div><h3>Abbreviation dictionary</h3><p>Used during normalization</p></div></div><div class="tbl-wrap"><table><thead><tr><th>Seen in data</th><th>Normalized to</th></tr></thead><tbody>${N.ABBREVIATIONS.map(([a, b]) => `<tr><td class="mono">${esc(a)}</td><td class="mono">${esc(b)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-h"><div><h3>Critical attributes by category</h3><p>Any difference here blocks a merge</p></div></div><div class="tbl-wrap"><table><tbody>${N.CAT_ORDER.filter(k => k !== 'UNCLASSIFIED').map(k => `<tr><td>${N.CATEGORIES[k].label}</td><td><div class="chips">${N.CATEGORIES[k].critical.map(a => `<span class="chip">${N.ATTR_LABELS[a]}</span>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>
      <div class="panel-b" style="border-top:1px solid var(--line)"><h4 style="margin-bottom:6px">Demonstration data</h4><p class="muted" style="font-size:12.5px;margin-bottom:10px">Clears decisions, uploads and the audit log stored in this browser, then restores the seeded history.</p><button class="btn bad" data-act="reset-demo">Reset demonstration</button></div></div>
  </div>`;
}
function applyConfig() {
  if (!can('settings') || !S.draftConfig) return;
  const t = S.draftConfig.thresholds;
  if (!(t.strong > t.review && t.review > t.manual)) return toast('Thresholds must be in order: strong above review above manual.');
  const before = clone(S.config);
  S.config = S.draftConfig; S.draftConfig = null;
  runPipeline(); G.Constellation.dataSig = null;
  audit('CONFIG_CHANGED', 'Matching configuration', `Weights ${JSON.stringify(S.config.weights)}, thresholds ${JSON.stringify(S.config.thresholds)}. Re-scored ${RES.stats.compared} pairs.`, { before, after: S.config });
  save(); render();
  toast('Re-scored with the new configuration.');
}

/* ---------------- Drawer / toast ---------------- */
let drawerMount = null;
function openDrawer(title, body, onMount) {
  const ov = $('#overlay');
  ov.innerHTML = `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Details"><div class="drawer-h">${title}<button class="btn sm" data-act="close">Close</button></div><div class="drawer-b">${body}</div></aside>`;
  drawerMount = onMount || null;
  if (drawerMount) drawerMount();
  const btn = ov.querySelector('.drawer-h .btn'); if (btn) btn.focus();
}
function closeDrawer() {
  $('#overlay').innerHTML = ''; drawerMount = null;
  const el = $('#rvViewer'); if (el) mountReview();
}
let toastT;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ---------------- Render ---------------- */
function render() {
  applyTheme();
  const app = $('#app');
  if (!S.role) { app.innerHTML = loginScreen(); return; }
  const { page, params } = route();
  if (!$('.app') || app.dataset.role !== S.role + S.tenant) { app.innerHTML = shell(); app.dataset.role = S.role + S.tenant; }
  else {
    const c = counts();
    document.querySelectorAll('.nav a').forEach(a => {
      const k = a.getAttribute('href').slice(2);
      if (k === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      if (k === 'review') { let b = a.querySelector('.count'); if (c.pending) { if (!b) { b = document.createElement('span'); b.className = 'count'; a.appendChild(b); } b.textContent = c.pending; } else if (b) b.remove(); }
    });
    const tb = $('[data-act="theme"]'); if (tb) tb.textContent = themeIsDark() ? 'Light' : 'Dark';
  }
  const content = $('#content');
  const fn = { overview: pageOverview, intake: pageIntake, explorer: pageExplorer, review: pageReview, clusters: pageClusters, master: pageMaster, mappings: pageMappings, procurement: pageProcurement, governance: pageGovernance, settings: pageSettings }[page];
  const y = window.scrollY, same = content.dataset.page === page;
  content.innerHTML = fn(params);
  content.dataset.page = page;
  document.title = PAGES.find(p => p[0] === page)[1] + ' | National Material Master';
  if (!same) window.scrollTo(0, 0); else window.scrollTo(0, y);
  if (page === 'overview') mountOverview();
  if (page === 'review') mountReview();
  if (drawerMount && $('#overlay').innerHTML) drawerMount();
}

/* ---------------- Events ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && act === 'sel') {
    e.stopPropagation();
    const sel = S.ui.ex.sel, id = el.dataset.id;
    const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else { sel.push(id); if (sel.length > 2) sel.shift(); }
    render(); return;
  }
  if (el.tagName === 'INPUT' && el.type === 'radio' && (act === 'rv-a' || act === 'rv-b')) {
    if (act === 'rv-a') { S.ui.rv.a = el.dataset.id; if (S.ui.rv.b === S.ui.rv.a) S.ui.rv.b = null; } else S.ui.rv.b = el.dataset.id;
    render(); return;
  }
  switch (act) {
    case 'signout': S.role = null; save(); render(); break;
    case 'theme': S.theme = themeIsDark() ? 'light' : 'dark'; save(); render(); break;
    case 'hero-run': heroRun(); break;
    case 'rec': if (e.target.closest('input')) return; e.preventDefault(); openRecord(el.dataset.id); break;
    case 'nmc': e.preventDefault(); openNMC(el.dataset.k); break;
    case 'cmp': openCompare(el.dataset.a, el.dataset.b); break;
    case 'close': closeDrawer(); break;
    case 'compare': if (S.ui.ex.sel.length === 2) openCompare(S.ui.ex.sel[0], S.ui.ex.sel[1]); break;
    case 'ex-page': S.ui.ex.page += +el.dataset.v; render(); break;
    case 'ex-clear': Object.assign(S.ui.ex, { q: '', cpse: '', cat: '', status: '', page: 0 }); render(); break;
    case 'dq': S.ui.dq.type = el.dataset.v; render(); break;
    case 'sample': S.pasteText = SAMPLE_CSV; render(); break;
    case 'ingest': { const t = $('#paste').value; S.pasteText = t; doIngest(t, 'pasted-rows.csv'); break; }
    case 'rv-filter': S.ui.rv.filter = el.dataset.v; S.ui.rv.sel = null; S.ui.rv.editing = false; render(); break;
    case 'rv-sel': e.preventDefault(); S.ui.rv.sel = el.dataset.v; S.ui.rv.a = S.ui.rv.b = null; S.ui.rv.cand = null; S.ui.rv.editing = false; if (route().page !== 'review') location.hash = '#/review'; else render(); break;
    case 'rv-cand': S.ui.rv.cand = el.dataset.k; render(); break;
    case 'rv-approve': decide(el.dataset.k, 'approve'); break;
    case 'rv-reject': decide(el.dataset.k, 'reject'); break;
    case 'rv-escalate': decide(el.dataset.k, 'escalate'); break;
    case 'rv-modify': S.ui.rv.editing = true; render(); setTimeout(() => { const i = $('#stdEdit'); if (i) i.focus(); }, 0); break;
    case 'rv-cancel': S.ui.rv.editing = false; render(); break;
    case 'rv-save': decide(el.dataset.k, 'save'); break;
    case 'rv-reopen': decide(el.dataset.k, 'reopen'); break;
    case 'at-approve': decideAttach(el.dataset.id, 'approve'); break;
    case 'at-reject': decideAttach(el.dataset.id, 'reject'); break;
    case 'at-escalate': decideAttach(el.dataset.id, 'escalate'); break;
    case 'at-reopen': decideAttach(el.dataset.id, 'reopen'); break;
    case 'cl-open': S.ui.cl.open = S.ui.cl.open === el.dataset.k ? null : el.dataset.k; render(); break;
    case 'cl-tab': S.ui.cl.tab = el.dataset.v; render(); break;
    case 'pr-sel': S.ui.pr.sel = el.dataset.k; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'gov-tab': S.ui.gov.tab = el.dataset.v; render(); break;
    case 'gov-rec': S.ui.gov.rec = el.dataset.k; render(); break;
    case 'gov-api': S.ui.gov.api = +el.dataset.v; render(); break;
    case 'cfg-apply': applyConfig(); break;
    case 'cfg-reset': S.draftConfig = clone(N.DEFAULT_CONFIG); render(); break;
    case 'copy-csv': {
      const rows = mappingRows();
      const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
      const csv = ['cpse_id,legacy_material_code,national_material_code,original_description,standard_description,confidence_score,mapping_status,approved_by,approval_date,version'].concat(rows.map(x => [x.r.cpse, x.r.code, x.key ? nmcOf(x.key) : '', x.r.desc, x.key ? descOf(RES.clusterByKey.get(x.key)) : '', x.conf != null ? x.conf.toFixed(4) : '', x.status, x.status === 'APPROVED' ? x.by : '', x.status === 'APPROVED' ? x.at : '', x.ver].map(q).join(','))).join('\n');
      const done = () => toast(`Copied ${rows.length} mappings as CSV.`);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(csv).then(done, () => fallbackCopy(csv, done)); else fallbackCopy(csv, done);
      break;
    }
    case 'reset-demo':
      if (!confirm('Reset all decisions, uploads and audit entries in this browser?')) return;
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
      Object.assign(S, { config: clone(N.DEFAULT_CONFIG), uploadedRecords: [], uploads: [], decisions: {}, attachDecisions: {}, registry: {}, nextCode: 1, retired: [], audit: [], lastReport: null, seeded: false, draftConfig: null });
      runPipeline(); seedHistory(); G.Constellation.dataSig = null; save(); render(); toast('Demonstration reset.');
      break;
  }
});
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy blocked by the browser.'); }
  ta.remove();
}
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  switch (f.dataset.form) {
    case 'login': S.role = fd.role; S.tenant = fd.tenant || 'A'; audit('SIGN_IN', ROLES[S.role].label, 'Demo sign-in.'); save(); render(); break;
    case 'gsearch': Object.assign(S.ui.ex, { q: fd.q || '', page: 0 }); if (route().page !== 'explorer') location.hash = '#/explorer'; else render(); break;
    case 'ex': Object.assign(S.ui.ex, { q: fd.q || '', cpse: fd.cpse || '', cat: fd.cat || '', status: fd.status || '', page: 0 }); render(); break;
    case 'nm': Object.assign(S.ui.nm, fd); render(); break;
    case 'mp': Object.assign(S.ui.mp, { cpse: fd.cpse || '', status: fd.status || '' }); render(); break;
    case 'gov': Object.assign(S.ui.gov, fd); render(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-input]'); if (!el) return;
  const k = el.dataset.input;
  if (k === 'role') { S.role = el.value; S.ui.rv.editing = false; audit('ROLE_SWITCHED', ROLES[S.role].label, 'Demo role switch.'); save(); render(); }
  else if (k === 'tenant') { S.tenant = el.value; save(); render(); }
  else if (k === 'file') {
    const file = el.files && el.files[0]; if (!file) return;
    if (file.size > 5e6) return toast('File is larger than 5 MB.');
    file.text().then(t => { S.pasteText = t.slice(0, 20000); doIngest(t, file.name); });
  }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input="w"],[data-input="t"]'); if (!el) return;
  S.draftConfig = S.draftConfig || clone(S.config);
  if (el.dataset.input === 'w') S.draftConfig.weights[el.dataset.k] = +el.value; else S.draftConfig.thresholds[el.dataset.k] = +el.value;
  const row = el.closest('.range-row');
  if (el.dataset.input === 'w') {
    const W = S.draftConfig.weights, sum = Object.values(W).reduce((a, b) => a + b, 0) || 1;
    document.querySelectorAll('[data-input="w"]').forEach(i => { const r = i.closest('.range-row'); r.children[2].textContent = W[i.dataset.k]; r.children[3].textContent = Math.round(W[i.dataset.k] / sum * 100) + '%'; });
  } else row.children[2].textContent = Math.round(+el.value * 100) + '%';
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#overlay') && $('#overlay').innerHTML) closeDrawer(); });
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => {
  const d = e.target.closest && e.target.closest('#drop'); if (!d) return; e.preventDefault(); d.classList.remove('over');
  const file = e.dataTransfer.files[0]; if (file) file.text().then(t => { S.pasteText = t.slice(0, 20000); doIngest(t, file.name); });
});
window.addEventListener('hashchange', () => { closeDrawer(); render(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!S.theme) render(); });

/* ---------------- Boot ---------------- */
const restored = load();
runPipeline();
if (!restored || !S.seeded) seedHistory();
save();
render();
})();
