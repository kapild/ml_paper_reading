/* Citation map: three views over one paper's references.
   Data comes from docs/data/citations/<arxiv id>.json, written by cite_map.py. */
(() => {
'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';
const trim = (s, n) => (s || '').length > n ? s.slice(0, n - 1).trimEnd() + '…' : (s || '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function sv(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

const NOTES = {
  sub: 'Each band is one subsection citing one paper. Thickness is the number of citations, and the right-hand side is ordered to keep the bands from crossing. Tap a label to isolate it; tap a paper to open it below.',
  theme: 'The same bands with whole sections on the left and themes on the right, so you can see what kind of prior work each section leans on. Themes come from config/citation_themes.toml.',
  table: 'One row per paper, after merging references that share a title. Sort by number or by times cited; tap a row to open the full reference below.',
};

let DATA = null, REFS = [], byNum = new Map(), selected = null, tab = 'sub', sort = 'count';
let gsel = null, gLinks = [], gNodes = [];

/* ---------- data ---------- */
async function load() {
  const want = new URLSearchParams(location.search).get('paper');
  try {
    const index = await fetch('data/citations/index.json', {cache: 'no-cache'}).then(r => r.json());
    const papers = index.papers || [];
    const pick = papers.find(p => p.arxiv === want) || papers[0];
    if (!pick) throw new Error('no papers in index.json');
    DATA = await fetch(`data/citations/${encodeURIComponent(pick.arxiv)}.json`, {cache: 'no-cache'}).then(r => r.json());
  } catch (err) {
    $('#loading').innerHTML = 'Could not load the citation data. Run <code>python3 cite_map.py &lt;arxiv id&gt;</code>, ' +
      'and open this page through a web server (<code>python3 -m http.server 8000 -d docs</code>) rather than from a file. ' +
      `<br><span class="mono">${esc(err.message)}</span>`;
    return;
  }
  start();
}

function sectionTag(label) {
  const m = /^(?:appendix\s+)?([A-Z0-9]+)/i.exec(label || '');
  return m ? m[1] : (label || '').slice(0, 2);
}

function start() {
  REFS = DATA.references;
  REFS.forEach(r => r.numbers.forEach(n => byNum.set(n, r)));
  const top = REFS.slice().sort((a, b) => b.count - a.count)[0];

  document.title = `Citation map · ${DATA.paper.title || DATA.paper.arxiv}`;
  $('#stamp').textContent = `citation map · arXiv ${DATA.paper.arxiv}`;
  $('#paper-title').textContent = DATA.paper.title || DATA.paper.arxiv;
  $('#stats').innerHTML = [
    [DATA.stats.rows, 'references'],
    [DATA.stats.marks, 'citation marks'],
    [DATA.sections.length, 'sections that cite'],
    [`[${top.numbers.join(', ')}] ${top.keyword}`, `cited most, ${top.count} times`],
  ].map(([v, l]) => `<span><b>${esc(v)}</b> ${esc(l)}</span>`).join('');

  $('#loading').hidden = true;
  $('#view').hidden = false;

  $$('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.v)));
  $$('#rt-head th[data-sort] .th-btn').forEach(b => b.addEventListener('click', () => {
    sort = b.parentElement.dataset.sort;
    drawTable();
  }));

  select(top.n, {silent: true});
  setTab('sub');
}

/* ---------- views ---------- */
function setTab(v) {
  tab = v;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === v)));
  $('#note').textContent = NOTES[v];
  $('#gwrap').hidden = v === 'table';
  $('#tablewrap').hidden = v !== 'table';
  if (v === 'table') drawTable();
  else { gsel = v === 'sub' && selected ? {side: 'R', key: String(selected)} : null; drawGraph(); }
}

/* A bipartite graph: left rows in paper order, right rows ordered to reduce crossings. */
function drawGraph() {
  const bySub = tab === 'sub';
  const leftRows = bySub ? DATA.subsections : DATA.sections;
  const left = [], leftIdx = new Map(), right = new Map(), links = new Map();

  leftRows.forEach(row => {
    const node = {side: 'L', key: row.key + (bySub ? '|' + row.section : ''), w: 0, idx: left.length,
                  label: bySub ? row.label : row.label};
    leftIdx.set(row.key, node);
    left.push(node);
  });

  REFS.forEach(ref => {
    const counts = bySub ? ref.subsections : ref.sections;
    for (const key in counts) {
      const l = leftIdx.get(key);
      if (!l) continue;
      const rkey = bySub ? String(ref.n) : (ref.theme || 'Other');
      let r = right.get(rkey);
      if (!r) right.set(rkey, r = {side: 'R', key: rkey, w: 0, sum: 0,
        label: bySub ? `[${ref.numbers.join(', ')}] ${ref.keyword}` : rkey,
        tip: bySub ? ref.title : '', ref: bySub ? ref : null});
      const n = counts[key];
      l.w += n; r.w += n; r.sum += l.idx * n;
      const id = l.key + '>' + rkey;
      const link = links.get(id) || links.set(id, {l, r, w: 0}).get(id);
      link.w += n;
    }
  });

  const rights = [...right.values()].sort((a, b) => a.sum / a.w - b.sum / b.w || b.w - a.w);
  const total = left.reduce((s, d) => s + d.w, 0) || 1;
  const unit = bySub ? 7 : 9;
  const rows = Math.max(left.length, rights.length);
  const topY = 28, H = total * unit + (rows - 1) * 10;
  const lay = list => {
    const gap = list.length > 1 ? (H - list.reduce((s, d) => s + d.w, 0) * unit) / (list.length - 1) : 0;
    let y = topY;
    list.forEach(d => { d.y = y; d.h = d.w * unit; d.o = 0; y += d.h + gap; });
  };
  lay(left); lay(rights);

  const all = [...links.values()];
  all.slice().sort((a, b) => a.l.y - b.l.y || a.r.y - b.r.y).forEach(k => { k.y0 = k.l.y + k.l.o + k.w * unit / 2; k.l.o += k.w * unit; });
  all.slice().sort((a, b) => a.r.y - b.r.y || a.l.y - b.l.y).forEach(k => { k.y1 = k.r.y + k.r.o + k.w * unit / 2; k.r.o += k.w * unit; });

  const W = 1080, xL = 300, xR = 560, bw = 9;
  const g = $('#graph');
  g.textContent = '';
  g.setAttribute('viewBox', `0 0 ${W} ${Math.max(H + topY + 10, 200)}`);
  g.append(sv('text', {class: 'gh', x: xL + bw, y: 12, 'text-anchor': 'end'}, bySub ? 'Subsections' : 'Sections'),
           sv('text', {class: 'gh', x: xR, y: 12}, bySub ? 'Papers' : 'Themes'));

  all.forEach(k => {
    const a = xL + bw, b = xR, mx = (a + b) / 2;
    k.el = sv('path', {class: 'gl', d: `M${a},${k.y0} C${mx},${k.y0} ${mx},${k.y1} ${b},${k.y1}`,
                       'stroke-width': Math.max(1, k.w * unit - 1)});
    k.el.append(sv('title', {}, `${k.l.label} → ${k.r.label}: ${k.w}`));
    g.append(k.el);
  });

  const rmax = Math.max(...rights.map(d => d.w), 1);
  [...left, ...rights].forEach(d => {
    const isL = d.side === 'L';
    const grp = sv('g', {class: 'gnode', tabindex: 0, role: 'button', 'aria-label': `${d.label}, ${d.w} citations`});
    const size = isL ? 12.5 : (bySub ? 11 + (d.w - 1) / Math.max(rmax - 1, 1) * 5 : 13.5);
    const weight = isL ? 500 : (bySub ? (d.w >= 5 ? 600 : d.w >= 3 ? 500 : 400) : 500);
    d.bar = sv('rect', {class: 'gn', x: isL ? xL : xR, y: d.y, width: bw, height: Math.max(d.h, 1), rx: 2});
    const label = sv('text', {class: 'gt', x: isL ? xL - 8 : xR + bw + 8, y: d.y + d.h / 2,
      'text-anchor': isL ? 'end' : 'start', 'dominant-baseline': 'middle',
      'font-size': size.toFixed(1), 'font-weight': weight}, trim(d.label, isL ? 36 : 32) + ' ');
    label.append(sv('tspan', {class: 'k'}, '×' + d.w));
    grp.append(sv('rect', {x: isL ? 0 : xR, y: d.y - 3, width: isL ? xL + bw : W - xR, height: d.h + 6, fill: 'transparent'}),
               d.bar, label);
    grp.append(sv('title', {}, d.tip ? `${d.label} — ${d.tip}` : d.label));
    const go = () => {
      if (d.ref) { select(d.ref.n); return; }
      gsel = (gsel && gsel.side === d.side && gsel.key === d.key) ? null : {side: d.side, key: d.key};
      markGraph();
    };
    grp.addEventListener('click', go);
    grp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    d.g = grp;
    g.append(grp);
  });

  gLinks = all;
  gNodes = [...left, ...rights];
  markGraph();
}

function markGraph() {
  const hit = k => gsel && (gsel.side === 'L' ? k.l.key === gsel.key : k.r.key === gsel.key);
  const live = new Set();
  gLinks.forEach(k => {
    const on = hit(k);
    k.el.setAttribute('class', 'gl' + (gsel ? (on ? ' on' : ' dim') : ''));
    if (on) { live.add(k.l); live.add(k.r); }
  });
  gNodes.forEach(d => {
    const me = gsel && d.side === gsel.side && d.key === gsel.key;
    d.g.setAttribute('class', 'gnode' + (gsel && !me && !live.has(d) ? ' dim' : ''));
    d.bar.setAttribute('class', 'gn' + (me ? ' on' : ''));
  });
}

function drawTable() {
  const rows = REFS.slice().sort((a, b) => sort === 'count'
    ? (b.count - a.count || a.numbers[0] - b.numbers[0])
    : a.numbers[0] - b.numbers[0]);
  const max = Math.max(...rows.map(r => r.count), 1);
  const body = $('#rt-body');
  body.textContent = '';
  rows.forEach(r => {
    const tr = el('tr', 'krow' + (selected === r.n ? ' on' : ''));
    tr.tabIndex = 0;
    tr.dataset.n = r.n;
    const cnt = el('td', 'c-cnt');
    const bar = el('span', 'kbar');
    bar.style.width = Math.round(r.count / max * 84) + 'px';
    cnt.append(bar, String(r.count));
    tr.append(el('td', 'c-num', `[${r.numbers.join(', ')}]`), el('td', 'c-key', r.keyword),
              el('td', 'c-title', r.title), el('td', 'c-year', r.year || '—'), cnt);
    tr.addEventListener('click', () => select(r.n));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); select(r.n); } });
    body.append(tr);
  });
  $$('#rt-head th[data-sort]').forEach(th => th.setAttribute('aria-sort',
    th.dataset.sort === sort ? (sort === 'count' ? 'descending' : 'ascending') : 'none'));
}

/* ---------- the selected reference, docked at the foot ---------- */
function select(n, {silent = false} = {}) {
  const ref = byNum.get(n);
  if (!ref) return;
  selected = ref.n;
  drawDock(ref);
  $$('.krow').forEach(tr => tr.classList.toggle('on', +tr.dataset.n === selected));
  if (!silent && tab === 'sub') { gsel = {side: 'R', key: String(ref.n)}; markGraph(); }
}

function drawDock(ref) {
  const dock = $('#dock');
  dock.hidden = false;
  dock.textContent = '';
  const inner = el('div', 'dock-in');

  const main = el('div');
  const top = el('div', 'd-top');
  const sections = Object.keys(ref.sections).length;
  top.append(el('b', '', `[${ref.numbers.join(', ')}] ${ref.keyword}`),
    el('span', '', `cited ${ref.count}${ref.count === 1 ? ' time' : ' times'} in ${sections}${sections === 1 ? ' section' : ' sections'}`));
  main.append(top, el('div', 'd-title', ref.title),
    el('p', 'd-meta', [ref.authors, ref.venue].filter(Boolean).join(' · ') || '—'));

  const side = el('div', 'd-side');
  const strip = el('div', 'strip');
  DATA.sections.forEach(s => {
    const v = ref.sections[s.key] || 0;
    const cell = el('div', 'cell' + (v ? '' : ' z') + (v === Math.max(...Object.values(ref.sections), 0) && v ? ' hot' : ''));
    cell.title = `${s.label}: ${v}`;
    const bar = el('i');
    bar.style.height = (v ? 6 + v * 7 : 2) + 'px';
    cell.append(bar, el('span', '', sectionTag(s.label)));
    strip.append(cell);
  });
  const link = el('a', 'btn', ref.arxiv ? 'Open on arXiv ↗' : 'Find on Scholar ↗');
  link.href = ref.arxiv ? `https://arxiv.org/abs/${ref.arxiv}`
    : `https://scholar.google.com/scholar?q=${encodeURIComponent(ref.title)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  side.append(strip, link);

  inner.append(main, side);
  dock.append(inner);
}

load();
})();
