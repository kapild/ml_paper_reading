/* Paper Read Atlas: every view on the site.
   Data comes from data/papers.js (window.ATLAS_DATA), which build.py generates from the Notion export. */
(() => {
'use strict';

const D = window.ATLAS_DATA;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

if (!D) {
  $('main').innerHTML = '<p class="missing">No data yet. Run <code>python3 build.py</code> in the repo folder, then reload this page.</p>';
  return;
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = {done: 'Read', reading: 'In progress', next: 'Queued', later: 'Someday'};
const GLYPH = {
  done:    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>',
  reading: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  next:    '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  later:   '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="2" fill="currentColor"/></svg>',
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: nothing to remember */ } },
};

/* ---------- themes ---------- */
const NEUTRAL = {other: 'var(--t-other)', unsorted: 'var(--t-unsorted)'};
let slot = 0;
const THEMES = D.themes.map(t => ({...t, color: NEUTRAL[t.key] || (slot < 7 ? `var(--s${++slot})` : 'var(--t-other)')}));
const thBy = Object.fromEntries(THEMES.map(t => [t.key, t]));
const C = k => (thBy[k] || NEUTRAL).color || 'var(--t-unsorted)';
const thShort = k => (thBy[k] || {short: k}).short;
const thName = k => (thBy[k] || {name: k}).name;

/* ---------- papers & links ---------- */
const P = D.papers;
const byKey = new Map(P.map(p => [p.key, p]));
const nbr = new Map(P.map(p => [p.key, new Set()]));
const edgeMap = new Map();
function addLink(from, to) {
  if (!byKey.has(from) || !byKey.has(to) || from === to) return;
  nbr.get(from).add(to);
  nbr.get(to).add(from);
  const id = from < to ? `${from}|${to}` : `${to}|${from}`;
  if (!edgeMap.has(id)) edgeMap.set(id, [from, to]);
}
for (const p of P) {
  p.buildsOn.forEach(k => addLink(k, p.key));
  p.builtOnBy.forEach(k => addLink(p.key, k));
}
const EDGES = [...edgeMap.values()];
const builtOn = p => p.builtOnBy.filter(k => byKey.has(k)).length;
const MAX_BUILT = Math.max(1, ...P.map(builtOn));
const DATED = P.filter(p => p.pub != null);
const maxPub = DATED.length ? Math.max(...DATED.map(p => p.pub)) : 2026;
const PUB0 = DATED.length ? Math.floor(Math.min(...DATED.map(p => p.pub))) : 2014;
const PUB_END = Math.max(Math.floor(maxPub) + 0.5, maxPub + 0.15);

const pubLabel = p => p.year == null ? 'Unknown' : p.month ? `${MON[p.month - 1]} ${p.year}` : String(p.year);
const readLabel = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const dnum = iso => +iso.slice(0, 4) + (+iso.slice(5, 7) - 1) / 12 + (+iso.slice(8, 10) - 1) / 365;
const themeCell = k => `<span class="thm"><span class="sw" style="background:${C(k)}"></span>${esc(thShort(k))}</span>`;
const pill = s => `<span class="pill">${GLYPH[s]}${STATUS[s]}</span>`;

/* ---------- shared state ---------- */
const TABS = ['constellation', 'timeline', 'lineages', 'graph', 'tables'];
const state = {
  tab: 'constellation',
  theme: null,
  hover: null,
  selected: null,
  centre: byKey.has(store.get('atlas.centre')) ? store.get('atlas.centre') : null,
  depth: store.get('atlas.depth') === '2' ? 2 : 1,
  table: {q: '', status: '', org: '', sort: 'read', dir: 'desc'},
};

function applyEmphasis() {
  const id = state.hover;
  const keep = id != null ? new Set([id, ...nbr.get(id)])
    : state.theme ? new Set(P.filter(p => p.theme === state.theme).map(p => p.key)) : null;
  $$('.viz [data-key]').forEach(e => {
    const k = e.dataset.key;
    e.classList.toggle('dim', !!keep && !keep.has(k));
    e.classList.toggle('hot', id != null && k === id);
  });
  $$('.viz [data-edge]').forEach(e => {
    const [a, b] = e.dataset.edge.split('|');
    let on = true, hot = false;
    if (id != null) on = hot = (a === id || b === id);
    else if (state.theme) on = byKey.get(a).theme === state.theme || byKey.get(b).theme === state.theme;
    e.classList.toggle('dim', !on);
    e.classList.toggle('hot', hot);
  });
  $$('.viz [data-th]').forEach(e => e.classList.toggle('dim', !!state.theme && id == null && e.dataset.th !== state.theme));
}

/* ---------- tooltip ---------- */
const tip = $('#tip');
function moveTip(x, y) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top + h > innerHeight - 8) top = y - h - 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; moveTip(x, y); }
function hideTip() { tip.hidden = true; }
function paperTip(p) {
  const rows = [
    ['Published', pubLabel(p) + (p.arxiv ? ` · arXiv ${p.arxiv}` : '')],
    ['Status', p.read ? `${STATUS[p.status]} · ${readLabel(p.read)}` : STATUS[p.status]],
    ['Theme', thName(p.theme)],
    ['Org', p.org || '—'],
    ['Built on by', `${builtOn(p)} of your papers`],
  ];
  return `<span class="tt">${esc(p.short)}</span><span class="tf">${esc(p.title)}</span><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

/* A mark in Constellation, Timeline or Lineages: hover highlights its links; click opens it in the graph. */
function bindPaper(node, p) {
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${p.short}, published ${pubLabel(p)}, ${STATUS[p.status]}. Open in graph`);
  const enter = () => { state.hover = p.key; applyEmphasis(); };
  const leave = () => { state.hover = null; applyEmphasis(); hideTip(); };
  node.addEventListener('pointerenter', ev => { enter(); showTip(paperTip(p), ev.clientX, ev.clientY); });
  node.addEventListener('pointermove', ev => moveTip(ev.clientX, ev.clientY));
  node.addEventListener('pointerleave', leave);
  node.addEventListener('focus', () => { enter(); const r = node.getBoundingClientRect(); showTip(paperTip(p), r.right, r.top); });
  node.addEventListener('blur', leave);
  node.addEventListener('click', () => openInGraph(p.key));
  node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInGraph(p.key); } });
}

/* ---------- tabs ---------- */
function setTab(tab, {hash = true} = {}) {
  if (!TABS.includes(tab)) tab = 'constellation';
  state.tab = tab;
  for (const t of TABS) {
    const on = t === tab;
    const b = $('#tab-' + t);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $('#panel-' + t).hidden = !on;
  }
  if (hash) {
    const h = tab === 'graph' && state.centre ? `#graph/${encodeURIComponent(state.centre)}` : `#${tab}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  state.hover = null;
  applyEmphasis();
  hideTip();
  if (tab === 'graph') renderGraph();
}
$$('.tab').forEach(b => {
  b.addEventListener('click', () => setTab(b.dataset.tab));
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.indexOf(b.dataset.tab);
    const t = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(t);
    $('#tab-' + t).focus();
  });
});
function route() {
  const [tab, raw] = location.hash.slice(1).split('/');
  const key = raw ? decodeURIComponent(raw) : null;
  if (key && byKey.has(key)) { state.centre = key; store.set('atlas.centre', key); }
  setTab(TABS.includes(tab) ? tab : 'constellation', {hash: false});
}
window.addEventListener('hashchange', route);

function openInGraph(key) {
  if (!byKey.has(key)) return;
  state.centre = key;
  store.set('atlas.centre', key);
  setTab('graph');
  openPanel(key);
}

/* ---------- theme filter ---------- */
function buildFilters() {
  const bar = $('#chips');
  const make = (key, label, count) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.id = 'chip-' + (key || 'all');
    b.setAttribute('aria-pressed', String(state.theme === key));
    b.innerHTML = (key ? `<i style="background:${C(key)}"></i>` : '') + esc(label) + (count != null ? ` <span class="ct">${count}</span>` : '');
    b.addEventListener('click', () => {
      state.theme = key;
      $$('.chip', bar).forEach(c => c.setAttribute('aria-pressed', String(c === b)));
      applyEmphasis();
      filterTables();
      graphEmphasis();
    });
    bar.appendChild(b);
  };
  make(null, 'All themes');
  THEMES.forEach(t => {
    const n = P.filter(p => p.theme === t.key).length;
    if (n) make(t.key, t.short, n);
  });
}

/* ---------- Constellation ---------- */
function drawConstellation() {
  const svg = $('#constellation');
  const W = 1100, H = 880, cx = 550, cy = 440, R0 = 58, R1 = 326;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!DATED.length) return;
  const rOf = v => R0 + (v - PUB0) / (PUB_END - PUB0) * (R1 - R0);
  const rad = d => d * Math.PI / 180;
  const pt = (a, r) => [cx + Math.cos(rad(a)) * r, cy + Math.sin(rad(a)) * r];
  const gGrid = el('g', {}, svg), gE = el('g', {}, svg), gN = el('g', {}, svg), gL = el('g', {}, svg), gT = el('g', {}, svg), gHit = el('g', {}, svg);

  for (let y = PUB0; y <= maxPub; y += 2) el('circle', {cx, cy, r: rOf(y), class: 'ring'}, gGrid);

  const groups = THEMES.map(t => ({t, ps: DATED.filter(p => p.theme === t.key).sort((a, b) => a.pub - b.pub)})).filter(g => g.ps.length);
  const GAP = 22, PAD = 2.5;
  const wsum = groups.reduce((s, g) => s + Math.max(g.ps.length, 6), 0);
  const avail = 360 - GAP - PAD * groups.length;
  const pos = new Map();
  const spoke = a => { const [x1, y1] = pt(a, R0 - 6), [x2, y2] = pt(a, R1 + 10); el('line', {x1, y1, x2, y2, class: 'spoke'}, gGrid); };
  let a = -90 + GAP / 2;
  for (const g of groups) {
    spoke(a);
    const span = avail * Math.max(g.ps.length, 6) / wsum, a0 = a + PAD / 2, a1 = a0 + span;
    g.ps.forEach((p, i) => {
      const ang = a0 + (i + 0.5) / g.ps.length * span;
      const [x, y] = pt(ang, rOf(p.pub));
      pos.set(p.key, {x, y, ang});
    });
    const m = (a0 + a1) / 2, [lx, ly] = pt(m, R1 + 30), c = Math.cos(rad(m)), s = Math.sin(rad(m));
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    const dy = s < -0.55 ? -16 : s > 0.55 ? 12 : -3;
    const read = g.ps.filter(p => p.status === 'done').length;
    const lab = el('g', {'data-th': g.t.key}, gL);
    el('text', {x: lx, y: ly + dy, 'text-anchor': anchor, class: 'strong'}, lab, g.t.short);
    el('text', {x: lx, y: ly + dy + 15, 'text-anchor': anchor, class: 'mono'}, lab, `${read} of ${g.ps.length} read`);
    a = a1 + PAD / 2;
  }
  spoke(a);

  for (const [s, t] of EDGES) {
    const A = pos.get(s), B = pos.get(t);
    if (!A || !B) continue;
    let da = Math.abs(A.ang - B.ang);
    if (da > 180) da = 360 - da;
    const f = 1 - Math.min(da, 180) / 180 * 0.8;
    const qx = cx + ((A.x + B.x) / 2 - cx) * f, qy = cy + ((A.y + B.y) / 2 - cy) * f;
    el('path', {d: `M${A.x.toFixed(1)},${A.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${B.x.toFixed(1)},${B.y.toFixed(1)}`, class: 'edge', 'data-edge': `${s}|${t}`}, gE);
  }

  const size = p => 3.2 + Math.sqrt(builtOn(p) / MAX_BUILT) * 7.4;
  const hubs = [];
  for (const p of DATED) {
    const {x, y, ang} = pos.get(p.key);
    const r = size(p);
    const g = el('g', {'data-key': p.key}, gN);
    if (p.status === 'done') el('circle', {cx: x, cy: y, r, class: 'node-done', style: `fill:${C(p.theme)}`}, g);
    else if (p.status === 'reading') el('circle', {cx: x, cy: y, r: Math.max(r, 4.4), class: 'node-ring', style: `stroke:${C(p.theme)};stroke-width:2.4`}, g);
    else if (p.status === 'next') el('circle', {cx: x, cy: y, r: Math.max(r, 4.2), class: 'node-ring', style: `stroke:${C(p.theme)};stroke-width:1.3`}, g);
    else el('circle', {cx: x, cy: y, r: Math.max(r - 0.6, 2.6), class: 'node-later'}, g);
    bindPaper(el('circle', {cx: x, cy: y, r: Math.max(r + 4, 9), class: 'hit'}, gHit), p);
    if (builtOn(p) >= 4) {
      const c = Math.cos(rad(ang)), s = Math.sin(rad(ang));
      hubs.push({p, lx: x + c * (r + 6), ly: y + s * (r + 6) + 4, anchor: c >= 0 ? 'start' : 'end'});
    }
  }
  // Label the most built-on papers first; skip a label that would land on one already placed.
  const placed = [];
  for (const h of hubs.sort((a, b) => builtOn(b.p) - builtOn(a.p))) {
    if (placed.some(q => Math.abs(q.ly - h.ly) < 16 && Math.abs(q.lx - h.lx) < 84)) continue;
    placed.push(h);
    el('text', {x: h.lx, y: h.ly, 'text-anchor': h.anchor, class: 'hub halo', 'data-key': h.p.key}, gT, h.p.short);
  }

  for (let y = PUB0; y <= maxPub; y += 2) el('text', {x: cx, y: cy - rOf(y) + 4, 'text-anchor': 'middle', class: 'mono halo'}, gT, y);
  el('text', {x: cx, y: cy - R1 - 18, 'text-anchor': 'middle', class: 'axis-title'}, gT, 'YEAR PUBLISHED');
  el('text', {x: cx, y: cy + 6, 'text-anchor': 'middle', class: 'center-n'}, gT, P.length);
  el('text', {x: cx, y: cy + 24, 'text-anchor': 'middle', class: 'mono'}, gT, 'papers');
}

/* ---------- Timeline ---------- */
function drawTimeline() {
  const svg = $('#timeline');
  const reads = DATED.filter(p => p.read).sort((a, b) => a.pub - b.pub);
  $('#timeline-note').textContent = `One line per paper you read or started (${reads.length}). Colour = theme.`;
  const W = 1040, H = 462, L = 104, R = 28, yT = 64, yB = 284, base = 420;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!reads.length) return;
  const xP = v => L + (v - PUB0) / (PUB_END - PUB0) * (W - L - R);
  const rd = reads.map(p => dnum(p.read));
  const t0 = Math.floor(Math.min(...rd));
  const t1 = Math.ceil(Math.max(...rd) * 4) / 4 + 0.25;
  const xR = v => L + (v - t0) / (t1 - t0) * (W - L - R);
  const g0 = el('g', {}, svg), gl = el('g', {}, svg), gd = el('g', {}, svg), gh = el('g', {}, svg);

  const span = Math.floor(maxPub) - PUB0;
  el('line', {x1: L, x2: W - R, y1: yT, y2: yT, class: 'axis'}, g0);
  for (let y = PUB0; y <= maxPub; y++) {
    const x = xP(y), major = span <= 8 || (y - PUB0) % 2 === 0;
    el('line', {x1: x, x2: x, y1: yT - (major ? 6 : 3), y2: yT, class: 'tick'}, g0);
    if (major) el('text', {x, y: yT - 12, 'text-anchor': 'middle', class: 'mono'}, g0, y);
  }
  el('text', {x: 0, y: yT + 4, class: 'axis-title'}, g0, 'PUBLISHED');

  el('line', {x1: L, x2: W - R, y1: yB, y2: yB, class: 'axis'}, g0);
  const quarters = Math.round((t1 - t0) * 4);
  for (let q = 0; q <= quarters; q++) {
    const x = xR(t0 + q / 4);
    el('line', {x1: x, x2: x, y1: yB, y2: yB + (q % 4 === 0 ? 7 : 3), class: 'tick'}, g0);
    if (q % 4 === 0) el('text', {x, y: yB + 22, 'text-anchor': 'middle', class: 'mono'}, g0, t0 + q / 4);
  }
  el('text', {x: 0, y: yB + 4, class: 'axis-title'}, g0, 'READ');

  const mid = (yT + yB) / 2;
  for (const p of reads) {
    const x1 = xP(p.pub), x2 = xR(dnum(p.read));
    const d = `M${x1.toFixed(1)},${yT + 4} C${x1.toFixed(1)},${mid} ${x2.toFixed(1)},${mid} ${x2.toFixed(1)},${yB - 4}`;
    el('path', {d, class: 'lag', style: `stroke:${C(p.theme)}`, 'data-key': p.key}, gl);
    el('circle', {cx: x1, cy: yT, r: 3, class: 'dot', style: `fill:${C(p.theme)}`, 'data-key': p.key}, gd);
    el('circle', {cx: x2, cy: yB, r: 3, class: 'dot', style: `fill:${C(p.theme)}`, 'data-key': p.key}, gd);
    bindPaper(el('path', {d, class: 'hitline'}, gh), p);
  }

  const months = new Map();
  for (const p of reads) { const k = p.read.slice(0, 7); months.set(k, (months.get(k) || 0) + 1); }
  const max = Math.max(...months.values());
  const bw = Math.max(2, xR(t0 + 1 / 12) - xR(t0) - 3);
  el('line', {x1: L, x2: W - R, y1: base, y2: base, class: 'axis'}, g0);
  el('text', {x: 0, y: base, class: 'axis-title'}, g0, 'PER MONTH');
  const top3 = [...months.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  for (const [k, v] of months) {
    const x = xR(+k.slice(0, 4) + (+k.slice(5) - 1) / 12) + 1.5, h = v / max * 78, rr = Math.min(3, h / 2, bw / 2);
    el('path', {d: `M${x},${base} V${base - h + rr} Q${x},${base - h} ${x + rr},${base - h} H${x + bw - rr} Q${x + bw},${base - h} ${x + bw},${base - h + rr} V${base} Z`, class: 'bar'}, g0);
    if (top3.includes(k)) el('text', {x: x + bw / 2, y: base - h - 6, 'text-anchor': 'middle', class: 'mono ink2'}, g0, v);
  }
  // Reading seasons: runs of months with gaps of five months or less.
  const seasons = [];
  for (const k of [...months.keys()].sort()) {
    const v = +k.slice(0, 4) * 12 + (+k.slice(5) - 1), s = seasons.at(-1);
    if (s && v - s.end <= 5) { s.end = v; s.n += months.get(k); } else seasons.push({start: v, end: v, n: months.get(k)});
  }
  for (const s of seasons) {
    const x1 = xR(s.start / 12) + 1.5, x2 = xR(s.end / 12) + 1.5 + bw;
    el('line', {x1, x2, y1: base + 9, y2: base + 9, class: 'bracket'}, g0);
    el('line', {x1, x2: x1, y1: base + 5, y2: base + 9, class: 'bracket'}, g0);
    el('line', {x1: x2, x2, y1: base + 5, y2: base + 9, class: 'bracket'}, g0);
    const range = MON[s.start % 12] + (s.start !== s.end ? '–' + MON[s.end % 12] : '');
    el('text', {x: (x1 + x2) / 2, y: base + 28, 'text-anchor': 'middle', class: 'mono ink2'}, g0, `${range} ${Math.floor(s.end / 12)} · ${s.n}`);
  }
}

/* ---------- Lineages ---------- */
function wrapName(name, max = 24) {
  if (name.length <= max) return [name];
  const words = name.split(' ');
  let first = '';
  while (words.length && `${first} ${words[0]}`.trim().length <= max) first = `${first} ${words.shift()}`.trim();
  return [first || words.shift(), words.join(' ')].filter(Boolean);
}
function drawLineages() {
  const svg = $('#lineages');
  $('#lineage-src').textContent = (D.config && D.config.lineages) || 'config/lineages.toml';
  const lines = (D.lineages || [])
    .map(l => ({name: l.name, ps: l.stations.map(k => byKey.get(k)).filter(p => p && p.pub != null).sort((a, b) => a.pub - b.pub)}))
    .filter(l => l.ps.length >= 2);
  $('#lineages-empty').hidden = lines.length > 0;
  svg.toggleAttribute('hidden', lines.length === 0);
  if (!lines.length) return;

  const W = 1040, G = 230, R = 40, top = 22, rowH = 86, H = top + lines.length * rowH + 36;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x = v => G + (v - PUB0) / (PUB_END - PUB0) * (W - G - R);
  for (let y = PUB0; y <= maxPub; y += 2) {
    el('line', {x1: x(y), x2: x(y), y1: top, y2: H - 30, class: 'grid'}, svg);
    el('text', {x: x(y), y: H - 12, 'text-anchor': 'middle', class: 'mono'}, svg, y);
  }
  lines.forEach((ln, i) => {
    const cy = top + i * rowH + rowH / 2;
    const counts = {};
    ln.ps.forEach(p => { counts[p.theme] = (counts[p.theme] || 0) + 1; });
    const theme = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const xs = [];
    ln.ps.forEach((p, j) => { let xx = x(p.pub); if (j && xx - xs[j - 1] < 36) xx = xs[j - 1] + 36; xs.push(xx); });

    const head = el('g', {'data-th': theme}, svg);
    const nameLines = wrapName(ln.name);
    const y0 = nameLines.length > 1 ? cy - 11 : cy - 3;
    nameLines.forEach((t, k) => el('text', {x: 0, y: y0 + k * 16, class: 'strong'}, head, t));
    el('text', {x: 0, y: y0 + nameLines.length * 16 + 1, class: 'mono'}, head, `${ln.ps.filter(p => p.status === 'done').length} of ${ln.ps.length} read`);

    for (let j = 1; j < ln.ps.length; j++) {
      const linked = nbr.get(ln.ps[j - 1].key).has(ln.ps[j].key);
      el('line', {x1: xs[j - 1], x2: xs[j], y1: cy, y2: cy, class: linked ? 'seg-line' : 'seg-gap', style: `stroke:${C(theme)}`, 'data-th': theme}, svg);
    }
    ln.ps.forEach((p, j) => {
      const g = el('g', {'data-key': p.key}, svg);
      const cls = p.status === 'done' ? 'st-done' : p.status === 'reading' ? 'st-reading' : 'st-open';
      el('circle', {cx: xs[j], cy, r: 7, class: cls, style: p.status === 'done' ? `fill:${C(p.theme)}` : `stroke:${C(p.theme)}`}, g);
      el('text', {x: xs[j], y: j % 2 === 0 ? cy - 15 : cy + 26, 'text-anchor': 'middle', class: 'st-lbl halo'}, g, p.short);
      bindPaper(el('circle', {cx: xs[j], cy, r: 15, class: 'hit'}, svg), p);
    });
  });
}

/* ---------- Graph ---------- */
const G = {centre: null, depth: null, nodes: [], edges: [], vb: [0, 0, 800, 600], view: {k: 1, tx: 0, ty: 0}, vp: null, hover: null};

function subgraph(centre, depth) {
  const lvl = new Map([[centre, 0]]);
  for (const k of nbr.get(centre)) lvl.set(k, 1);
  if (depth >= 2) {
    for (const [k, l] of [...lvl]) if (l === 1) for (const j of nbr.get(k)) if (!lvl.has(j)) lvl.set(j, 2);
  }
  return {lvl, edges: EDGES.filter(([a, b]) => lvl.has(a) && lvl.has(b))};
}

function relax(nodes, edges, idx) {
  const N = nodes.length, iters = 320;
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    const fx = new Float64Array(N), fy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = 0.1 * (j - i); dy = 0.1; d = Math.hypot(dx, dy); }
        const minD = a.r + b.r + 54;
        let f = 12000 / (d * d);
        if (d < minD) f += (minD - d) * 0.6;
        fx[i] -= dx / d * f; fy[i] -= dy / d * f;
        fx[j] += dx / d * f; fy[j] += dy / d * f;
      }
    }
    for (const [ka, kb] of edges) {
      const i = idx.get(ka), j = idx.get(kb), a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const f = (d - (a.lvl === 0 || b.lvl === 0 ? 220 : 160)) * 0.05;
      fx[i] += dx / d * f; fy[i] += dy / d * f;
      fx[j] -= dx / d * f; fy[j] -= dy / d * f;
    }
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      if (n.lvl === 0) continue;
      fx[i] -= n.x * 0.012; fy[i] -= n.y * 0.012;
      const m = Math.hypot(fx[i], fy[i]);
      if (m > 0) { const step = Math.min(m, 14 * cool + 1); n.x += fx[i] / m * step; n.y += fy[i] / m * step; }
    }
  }
}

function layoutGraph(sub) {
  const order = Object.fromEntries(THEMES.map((t, i) => [t.key, i]));
  const nodes = [...sub.lvl].map(([k, lvl]) => {
    const p = byKey.get(k);
    let r = 5 + Math.sqrt(builtOn(p) / MAX_BUILT) * 13;
    if (lvl === 0) r = Math.max(r, 12);
    if (lvl === 2) r *= 0.85;
    return {k, p, lvl, r, x: 0, y: 0, a: 0};
  });
  const idx = new Map(nodes.map((n, i) => [n.k, i]));
  const l1 = nodes.filter(n => n.lvl === 1).sort((a, b) => (order[a.p.theme] ?? 99) - (order[b.p.theme] ?? 99) || (a.p.pub ?? 0) - (b.p.pub ?? 0));
  l1.forEach((n, i) => { n.a = -Math.PI / 2 + (i + 0.5) / l1.length * Math.PI * 2; n.x = Math.cos(n.a) * 230; n.y = Math.sin(n.a) * 230; });
  const l2 = nodes.filter(n => n.lvl === 2);
  l2.forEach(n => {
    let sx = 0, sy = 0;
    for (const k of nbr.get(n.k)) { const m = nodes[idx.get(k)]; if (m && m.lvl === 1) { sx += Math.cos(m.a); sy += Math.sin(m.a); } }
    n.a = Math.atan2(sy, sx);
  });
  l2.sort((a, b) => a.a - b.a).forEach((n, i) => { const r = 420 + (i % 3) * 45; n.x = Math.cos(n.a) * r; n.y = Math.sin(n.a) * r; });
  relax(nodes, sub.edges, idx);
  return {nodes, idx};
}

function renderGraph() {
  const svg = $('#graph');
  $('#depth-1').setAttribute('aria-pressed', String(state.depth === 1));
  $('#depth-2').setAttribute('aria-pressed', String(state.depth === 2));
  const has = !!state.centre && byKey.has(state.centre);
  $('#graph-empty').hidden = has;
  svg.toggleAttribute('hidden', !has);  // SVG elements have no .hidden property
  $('#graph-zoom').hidden = $('#graph-caption').hidden = !has;
  if (!has) return;
  if (G.centre === state.centre && G.depth === state.depth) { graphEmphasis(); return; }

  const sub = subgraph(state.centre, state.depth);
  const {nodes, idx} = layoutGraph(sub);
  Object.assign(G, {centre: state.centre, depth: state.depth, nodes, view: {k: 1, tx: 0, ty: 0}, hover: null});

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const hw = Math.max(n.r, n.p.short.length * 3.7 + 6);
    x0 = Math.min(x0, n.x - hw); x1 = Math.max(x1, n.x + hw);
    y0 = Math.min(y0, n.y - n.r - 10); y1 = Math.max(y1, n.y + n.r + 26);
  }
  const vb = [x0 - 40, y0 - 60, x1 - x0 + 80, y1 - y0 + 100];
  if (vb[2] < 760) { vb[0] -= (760 - vb[2]) / 2; vb[2] = 760; }
  if (vb[3] < 520) { vb[1] -= (520 - vb[3]) / 2; vb[3] = 520; }
  G.vb = vb;
  svg.setAttribute('viewBox', vb.map(v => v.toFixed(1)).join(' '));
  svg.innerHTML = '';
  G.vp = el('g', {}, svg);
  const gE = el('g', {}, G.vp), gN = el('g', {}, G.vp);

  G.edges = sub.edges.map(([a, b]) => {
    const A = nodes[idx.get(a)], B = nodes[idx.get(b)];
    const line = el('line', {x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'g-edge' + (A.lvl === 0 || B.lvl === 0 ? ' g-edge-c' : '')}, gE);
    return {a, b, A, B, line};
  });
  for (const n of [...nodes].sort((a, b) => b.lvl - a.lvl)) {
    const g = el('g', {class: `g-node lvl${n.lvl}`, transform: `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`}, gN);
    n.g = g;
    if (n.lvl === 0) el('circle', {r: n.r + 6, class: 'g-centre-ring'}, g);
    const col = C(n.p.theme);
    if (n.p.status === 'done') el('circle', {r: n.r, class: 'g-done', style: `fill:${col}`}, g);
    else el('circle', {r: n.r, class: 'g-open', style: `stroke:${col};stroke-width:${n.p.status === 'reading' ? 3.2 : 1.8}`}, g);
    el('text', {y: n.r + (n.lvl === 0 ? 24 : 16), 'text-anchor': 'middle', class: 'g-label' + (n.lvl === 0 ? ' g-label-0' : n.lvl === 2 ? ' g-label-2' : '')}, g, n.p.short);
    bindGraphNode(el('circle', {r: Math.max(n.r + 6, 13), class: 'hit'}, g), n);
  }

  const direct = nbr.get(state.centre).size;
  $('#graph-caption').textContent = `${byKey.get(state.centre).short} · ${direct} direct link${direct === 1 ? '' : 's'}` +
    (state.depth === 2 ? ` · ${nodes.length - 1} within 2 levels` : '');
  applyView();
  graphEmphasis();
}

function graphEmphasis() {
  if (!G.nodes.length || !G.vp) return;
  const h = G.hover, keep = h ? new Set([h, ...nbr.get(h)]) : null;
  for (const n of G.nodes) {
    const dim = keep ? !keep.has(n.k) : !!state.theme && n.lvl > 0 && n.p.theme !== state.theme;
    n.g.classList.toggle('g-dim', dim);
  }
  for (const e of G.edges) {
    const hot = !!h && (e.a === h || e.b === h);
    const dim = h ? !hot : !!state.theme && e.A.p.theme !== state.theme && e.B.p.theme !== state.theme;
    e.line.classList.toggle('hot', hot);
    e.line.classList.toggle('g-dim', dim);
  }
}

function svgPoint(ev) {
  const svg = $('#graph');
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function toGraph(ev) {
  const q = svgPoint(ev);
  return {x: (q.x - G.view.tx) / G.view.k, y: (q.y - G.view.ty) / G.view.k};
}
function applyView() {
  if (G.vp) G.vp.setAttribute('transform', `translate(${G.view.tx.toFixed(2)},${G.view.ty.toFixed(2)}) scale(${G.view.k.toFixed(4)})`);
}
function zoomAt(k2, px, py) {
  k2 = Math.max(0.35, Math.min(3.5, k2));
  const v = G.view;
  v.tx = px - (px - v.tx) * (k2 / v.k);
  v.ty = py - (py - v.ty) * (k2 / v.k);
  v.k = k2;
  applyView();
}
function placeNode(n) {
  n.g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
  for (const e of G.edges) {
    if (e.A === n) { e.line.setAttribute('x1', n.x); e.line.setAttribute('y1', n.y); }
    if (e.B === n) { e.line.setAttribute('x2', n.x); e.line.setAttribute('y2', n.y); }
  }
}

/* A circle inside the graph: hover highlights its links, drag moves it, click opens its details. */
function bindGraphNode(hit, n) {
  const p = n.p;
  hit.setAttribute('tabindex', '0');
  hit.setAttribute('role', 'button');
  hit.setAttribute('aria-label', `${p.short}, ${STATUS[p.status]}. Show details`);
  let drag = null;
  hit.addEventListener('pointerenter', ev => { G.hover = n.k; graphEmphasis(); showTip(paperTip(p), ev.clientX, ev.clientY); });
  hit.addEventListener('pointerleave', () => { if (drag) return; G.hover = null; graphEmphasis(); hideTip(); });
  hit.addEventListener('focus', () => { G.hover = n.k; graphEmphasis(); const r = hit.getBoundingClientRect(); showTip(paperTip(p), r.right, r.top); });
  hit.addEventListener('blur', () => { G.hover = null; graphEmphasis(); hideTip(); });
  hit.addEventListener('pointerdown', ev => {
    ev.stopPropagation();
    hit.setPointerCapture(ev.pointerId);
    const q = toGraph(ev);
    drag = {sx: ev.clientX, sy: ev.clientY, dx: n.x - q.x, dy: n.y - q.y, moved: false};
  });
  hit.addEventListener('pointermove', ev => {
    if (!drag) { moveTip(ev.clientX, ev.clientY); return; }
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4) { drag.moved = true; hideTip(); }
    if (drag.moved) { const q = toGraph(ev); n.x = q.x + drag.dx; n.y = q.y + drag.dy; placeNode(n); }
  });
  hit.addEventListener('pointerup', () => { const d = drag; drag = null; if (d && !d.moved) openPanel(n.k); });
  hit.addEventListener('pointercancel', () => { drag = null; });
  hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(n.k); } });
}

function wireGraph() {
  const svg = $('#graph');
  let pan = null;
  svg.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.g-node')) return;
    pan = {last: svgPoint(ev)};
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('panning');
  });
  svg.addEventListener('pointermove', ev => {
    if (!pan) return;
    const q = svgPoint(ev);
    G.view.tx += q.x - pan.last.x;
    G.view.ty += q.y - pan.last.y;
    pan.last = q;
    applyView();
  });
  const endPan = () => { pan = null; svg.classList.remove('panning'); };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);
  // Pinch on a trackpad (or Ctrl/⌘ + scroll) zooms; plain scrolling still scrolls the page.
  svg.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const q = svgPoint(ev);
    zoomAt(G.view.k * Math.exp(-ev.deltaY * 0.01), q.x, q.y);
  }, {passive: false});
  const centreOfView = () => [G.vb[0] + G.vb[2] / 2, G.vb[1] + G.vb[3] / 2];
  $('#zoom-in').addEventListener('click', () => zoomAt(G.view.k * 1.25, ...centreOfView()));
  $('#zoom-out').addEventListener('click', () => zoomAt(G.view.k / 1.25, ...centreOfView()));
  $('#zoom-fit').addEventListener('click', () => { G.view = {k: 1, tx: 0, ty: 0}; applyView(); });
  [1, 2].forEach(d => $('#depth-' + d).addEventListener('click', () => {
    state.depth = d;
    store.set('atlas.depth', String(d));
    renderGraph();
  }));
  wireCombobox($('#graph-search'), $('#graph-results'), p => openInGraph(p.key));
}

/* ---------- detail drawer ---------- */
let drawerReturn = null;
function openPanel(key) {
  const p = byKey.get(key);
  if (!p) return;
  const d = $('#drawer');
  if (d.hidden) drawerReturn = document.activeElement;
  const list = keys => {
    const items = keys.filter(k => byKey.has(k)).map(k => byKey.get(k)).sort((a, b) => (b.pub ?? 0) - (a.pub ?? 0));
    if (!items.length) return '<li class="none">None in your notes yet</li>';
    return items.map(q => `<li><button type="button" class="link-btn" data-open="${esc(q.key)}"><span class="sw" style="background:${C(q.theme)}"></span><span>${esc(q.short)}<span class="lb-s">${STATUS[q.status]}</span></span><span class="lb-y">${q.year ?? ''}</span></button></li>`).join('');
  };
  const nOn = p.buildsOn.filter(k => byKey.has(k)).length;
  d.innerHTML = `
    <div class="dr-top">
      <span class="dr-theme"><span class="sw" style="background:${C(p.theme)}"></span>${esc(thName(p.theme))}</span>
      <button type="button" class="icon-btn" id="dr-close" aria-label="Close details">×</button>
    </div>
    <h2 id="drawer-title" tabindex="-1">${esc(p.short)}</h2>
    <p class="dr-full">${esc(p.title)}</p>
    <div class="dr-actions">
      ${p.key === state.centre ? '<span class="dr-note">At the centre of the graph</span>' : '<button type="button" class="btn primary" id="dr-centre">Centre graph here</button>'}
      ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open paper ↗</a>` : ''}
    </div>
    <dl class="dr-facts">
      <dt>Published</dt><dd>${esc(pubLabel(p))}${p.arxiv ? ` <span class="mono">arXiv ${esc(p.arxiv)}</span>` : ''}</dd>
      <dt>Status</dt><dd>${pill(p.status)}${p.read ? ` <span class="mono">${readLabel(p.read)}</span>` : ''}</dd>
      <dt>Org</dt><dd>${esc(p.org || '—')}</dd>
      <dt>Built on by</dt><dd>${builtOn(p)} of your papers</dd>
      ${p.tags.length ? `<dt>Notion tags</dt><dd>${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</dd>` : ''}
    </dl>
    <h3>Builds on <span class="ct">${nOn}</span></h3>
    <ul class="dr-list">${list(p.buildsOn)}</ul>
    <h3>Built on by <span class="ct">${builtOn(p)}</span></h3>
    <ul class="dr-list">${list(p.builtOnBy)}</ul>
    ${p.notes.length ? `<h3>Your notes <span class="ct">${p.notes.length}</span></h3><ul class="dr-notes">${p.notes.map(n => `<li><a href="${esc(n.u)}" target="_blank" rel="noopener">${esc(n.t)} ↗</a></li>`).join('')}</ul>` : ''}`;
  d.hidden = false;
  $('#dr-close').addEventListener('click', closePanel);
  const centreBtn = $('#dr-centre');
  if (centreBtn) centreBtn.addEventListener('click', () => openInGraph(key));
  $$('[data-open]', d).forEach(b => b.addEventListener('click', () => openPanel(b.dataset.open)));
  $('#drawer-title').focus({preventScroll: true});
  state.selected = key;
  renderConnected();
}
function closePanel() {
  $('#drawer').hidden = true;
  if (drawerReturn && drawerReturn.isConnected && drawerReturn.getClientRects().length) drawerReturn.focus({preventScroll: true});
  drawerReturn = null;
}

/* ---------- connected papers, at the foot of the page ---------- */
function connItem(q) {
  return `<li><button type="button" class="conn-item" data-open="${esc(q.key)}">` +
    `<span class="sw" style="background:${C(q.theme)}"></span>` +
    `<span class="conn-main"><span class="conn-short">${esc(q.short)}</span><span class="conn-title">${esc(q.title)}</span></span>` +
    `<span class="conn-meta"><span class="num">${q.year ?? '—'}</span>${pill(q.status)}</span></button></li>`;
}
function renderConnected() {
  const section = $('#connected');
  const p = state.selected ? byKey.get(state.selected) : null;
  section.hidden = !p;
  if (!p) return;
  const pick = keys => keys.filter(k => byKey.has(k)).map(k => byKey.get(k)).sort((a, b) => (b.pub ?? 0) - (a.pub ?? 0));
  const on = pick(p.buildsOn), by = pick(p.builtOnBy), total = on.length + by.length;
  $('#connected-sub').innerHTML = `<span class="sw" style="background:${C(p.theme)}"></span><b>${esc(p.short)}</b>` +
    ` · ${total} connected paper${total === 1 ? '' : 's'} in your notes. Click one to move the graph to it.`;
  $('#conn-on-n').textContent = on.length;
  $('#conn-by-n').textContent = by.length;
  $('#conn-on').innerHTML = on.map(connItem).join('') || '<li class="conn-none">Nothing yet. Add a backlink in Notion.</li>';
  $('#conn-by').innerHTML = by.map(connItem).join('') || '<li class="conn-none">Nothing yet. Add a fwdlink in Notion.</li>';
  $$('#connected [data-open]').forEach(b => b.addEventListener('click', () => openInGraph(b.dataset.open)));
}

/* ---------- search ---------- */
function searchPapers(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const p of P) {
    const s = p.short.toLowerCase(), t = p.title.toLowerCase();
    const score = s.startsWith(q) ? 0 : s.includes(q) ? 1 : t.includes(q) ? 2
      : (p.org.toLowerCase().includes(q) || (p.arxiv || '').includes(q) || p.tags.some(x => x.toLowerCase().includes(q))) ? 3 : -1;
    if (score >= 0) hits.push([score, p]);
  }
  return hits.sort((a, b) => a[0] - b[0] || (b[1].pub ?? 0) - (a[1].pub ?? 0)).slice(0, 8).map(h => h[1]);
}
function wireCombobox(input, list, onPick) {
  let items = [], active = -1;
  const setActive = i => {
    active = i;
    $$('[role=option]', list).forEach((li, j) => li.setAttribute('aria-selected', String(j === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', `${list.id}-${active}`); list.children[active].scrollIntoView({block: 'nearest'}); }
    else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    const q = input.value.trim();
    items = searchPapers(q);
    list.innerHTML = items.length
      ? items.map((p, i) => `<li role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="false"><span class="sw" style="background:${C(p.theme)}"></span><span class="r-s">${esc(p.short)}</span><span class="r-t">${esc(p.title)}</span><span class="r-y">${p.year ?? ''}</span></li>`).join('')
      : q ? '<li class="r-none">No papers match. Try part of a title, an org, a tag or an arXiv ID.</li>' : '';
    list.hidden = !q;
    input.setAttribute('aria-expanded', String(!!q));
    setActive(items.length ? 0 : -1);
  };
  const pick = p => { input.value = ''; render(); onPick(p); };
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; render(); }
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('[data-i]');
    if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
  });
  input.addEventListener('blur', () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); });
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  return {render};
}

const palette = $('#palette');
let paletteReturn = null;
const paletteCombo = wireCombobox($('#palette-input'), $('#palette-results'), p => { closePalette(); openInGraph(p.key); });
function openPalette() {
  paletteReturn = document.activeElement;
  palette.hidden = false;
  $('#palette-input').value = '';
  paletteCombo.render();
  $('#palette-input').focus();
}
function closePalette() {
  palette.hidden = true;
  if (paletteReturn && paletteReturn.isConnected && paletteReturn.getClientRects().length) paletteReturn.focus({preventScroll: true});
}
palette.addEventListener('pointerdown', e => { if (e.target === palette) closePalette(); });
$('#open-search').addEventListener('click', openPalette);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (palette.hidden) openPalette(); else closePalette();
    return;
  }
  if (e.key === 'Escape') {
    if (!palette.hidden) closePalette();
    else if (!$('#drawer').hidden) closePanel();
  }
});

/* ---------- tables ---------- */
const DONE_KEYS = new Set(P.filter(p => p.status === 'done').map(p => p.key));
const NEXT_RANK = {reading: 0, next: 1, later: 2};
const NEXT_ROWS = P.filter(p => p.status !== 'done')
  .map(p => ({p, linked: [...nbr.get(p.key)].filter(k => DONE_KEYS.has(k)).map(k => byKey.get(k))}))
  .filter(r => r.linked.length)
  .sort((a, b) => b.linked.length - a.linked.length || NEXT_RANK[a.p.status] - NEXT_RANK[b.p.status] || (b.p.pub ?? 0) - (a.p.pub ?? 0));

const STATUS_ORDER = {done: 0, reading: 1, next: 2, later: 3};
const SORTERS = {
  paper: p => p.short.toLowerCase(),
  published: p => p.pub ?? -1,
  read: p => p.read || '',
  theme: p => thShort(p.theme).toLowerCase(),
  status: p => STATUS_ORDER[p.status],
  org: p => (p.org || '~~').toLowerCase(),
  links: p => builtOn(p),
};
function matchesFilters(p) {
  const t = state.table;
  if (state.theme && p.theme !== state.theme) return false;
  if (t.status && p.status !== t.status) return false;
  if (t.org && (p.org || '') !== t.org) return false;
  const q = t.q.trim().toLowerCase();
  if (!q) return true;
  return [p.short, p.title, p.org, p.arxiv || '', thShort(p.theme), String(p.year ?? ''), ...p.tags]
    .some(v => String(v).toLowerCase().includes(q));
}
function allRow(p) {
  return `<tr tabindex="0" data-key="${esc(p.key)}">` +
    `<td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.short)}</a>` : `<span class="t">${esc(p.short)}</span>`}<span class="tf">${esc(p.title)}</span></td>` +
    `<td class="num">${pubLabel(p)}</td><td class="num">${p.read ? readLabel(p.read) : '—'}</td>` +
    `<td>${themeCell(p.theme)}</td><td>${pill(p.status)}</td><td>${esc(p.org || '—')}</td><td class="num">${builtOn(p)}</td></tr>`;
}
function renderAllTable() {
  const t = state.table;
  const rows = P.filter(matchesFilters);
  const value = SORTERS[t.sort] || SORTERS.read;
  rows.sort((a, b) => {
    const va = value(a), vb = value(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return (t.dir === 'asc' ? cmp : -cmp) || (b.pub ?? 0) - (a.pub ?? 0);
  });
  $('#all-body').innerHTML = rows.map(allRow).join('') || '<tr class="empty-row"><td colspan="7">No papers match these filters.</td></tr>';
  $('#all-count').textContent = rows.length === P.length ? P.length : `${rows.length} of ${P.length}`;
  $$('#all-head th[data-sort]').forEach(th => {
    const on = th.dataset.sort === t.sort;
    th.setAttribute('aria-sort', on ? (t.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  $('#tbl-clear').hidden = !(state.theme || t.status || t.org || t.q.trim());
}
function renderNextTable() {
  const rows = NEXT_ROWS.filter(({p}) => !state.theme || p.theme === state.theme);
  $('#next-body').innerHTML = rows.map(({p, linked}) =>
    `<tr tabindex="0" data-key="${esc(p.key)}"><td><span class="t">${esc(p.short)}</span><span class="tf">${esc(p.title)}</span></td>` +
    `<td class="num">${pubLabel(p)}</td><td>${themeCell(p.theme)}</td><td>${pill(p.status)}</td>` +
    `<td>${linked.map(l => esc(l.short)).join(', ')}</td></tr>`
  ).join('') || '<tr class="empty-row"><td colspan="5">No unread papers in this theme link to ones you have read.</td></tr>';
}
function filterTables() { renderNextTable(); renderAllTable(); }
function buildTables() {
  const orgs = [...new Set(P.map(p => p.org).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#tbl-org').innerHTML = '<option value="">All orgs</option>' +
    orgs.map(o => `<option value="${esc(o)}">${esc(o)} (${P.filter(p => p.org === o).length})</option>`).join('');
  $('#tbl-search').addEventListener('input', e => { state.table.q = e.target.value; renderAllTable(); });
  $('#tbl-status').addEventListener('change', e => { state.table.status = e.target.value; renderAllTable(); });
  $('#tbl-org').addEventListener('change', e => { state.table.org = e.target.value; renderAllTable(); });
  $('#tbl-clear').addEventListener('click', () => {
    Object.assign(state.table, {q: '', status: '', org: ''});
    $('#tbl-search').value = '';
    $('#tbl-status').value = '';
    $('#tbl-org').value = '';
    renderAllTable();
    $('#tbl-search').focus();
  });
  $$('#all-head .th-btn').forEach(btn => btn.addEventListener('click', () => {
    const col = btn.parentElement.dataset.sort, t = state.table;
    if (t.sort === col) t.dir = t.dir === 'asc' ? 'desc' : 'asc';
    else { t.sort = col; t.dir = ['paper', 'org', 'theme'].includes(col) ? 'asc' : 'desc'; }
    renderAllTable();
  }));
  const panel = $('#panel-tables');
  panel.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-key]');
    if (tr && !e.target.closest('a')) openInGraph(tr.dataset.key);
  });
  panel.addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-key]');
    if (tr && e.key === 'Enter' && e.target === tr) { e.preventDefault(); openInGraph(tr.dataset.key); }
  });
  filterTables();
}

/* ---------- header, footer, start ---------- */
function fillHeader() {
  const count = s => P.filter(p => p.status === s).length;
  $('#stats').innerHTML = `<b>${P.length}</b> papers · <b>${count('done')}</b> read · <b>${count('reading')}</b> in progress · <b>${count('next') + count('later')}</b> on the list · <b>${EDGES.length}</b> links`;
  $('#stamp').textContent = `paper_read · updated ${readLabel(D.generated)}`;
  $('#foot').innerHTML = `Built from <code>${esc(D.source)}</code> (${D.rows} rows) on ${readLabel(D.generated)}. To add papers, export the Notion database to CSV into the repo folder and run <code>python3 build.py</code>.`;
}

fillHeader();
buildFilters();
drawConstellation();
drawTimeline();
drawLineages();
buildTables();
wireGraph();
renderConnected();
route();
})();
