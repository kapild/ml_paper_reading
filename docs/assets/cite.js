/* Citation map views, mounted by the Citations tab in app.js.
   Data comes from docs/data/citations/<arxiv id>.json, written by cite_map.py. */
window.CiteMap = (() => {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const trim = (s, n) => (s || '').length > n ? s.slice(0, n - 1).trimEnd() + '…' : (s || '');
const tkey = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
const base = id => (id || '').replace(/v\d+$/, '');
const STATUS = {done: 'Read', reading: 'In progress', next: 'Queued', later: 'Someday'};

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
  sub: 'Each band is one subsection citing one paper. Thickness is the number of citations, and the right-hand side is ordered to keep the bands from crossing. Tap a label to isolate it; tap a paper to open it below. A dot marks a reference already in your reading list.',
  theme: 'The same bands with whole sections on the left and themes on the right, so you can see what kind of prior work each section leans on. Themes come from config/citation_themes.toml.',
  table: 'One row per paper, after merging references that share a title. Sort by number or by times cited, and see which references are already in your reading list.',
};

const S = {data: null, refs: [], byNum: new Map(), atlas: new Map(), sel: null,
           view: 'sub', sort: 'count', gsel: null, links: [], nodes: [], root: null, cache: new Map()};

async function show({root, paper, atlas}) {
  S.root = root;
  S.atlas = new Map();
  (atlas || []).forEach(p => {
    if (p.arxiv) S.atlas.set('a:' + base(p.arxiv), p);
    S.atlas.set('t:' + tkey(p.title), p);
  });
  root.textContent = '';
  root.append(el('p', 'empty-note', 'Loading the citation map…'));
  try {
    if (!S.cache.has(paper)) {
      S.cache.set(paper, await fetch(`data/citations/${encodeURIComponent(paper)}.json`, {cache: 'no-cache'})
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
    }
    S.data = S.cache.get(paper);
  } catch (err) {
    root.textContent = '';
    const p = el('p', 'empty-note');
    p.innerHTML = `Could not load <code>data/citations/${esc(paper)}.json</code> (${esc(err.message)}). ` +
      'Open the site through a web server rather than from a file, or rebuild the map.';
    root.append(p);
    return;
  }
  S.refs = S.data.references;
  S.byNum = new Map();
  S.refs.forEach(r => r.numbers.forEach(n => S.byNum.set(n, r)));
  S.sel = S.refs.slice().sort((a, b) => b.count - a.count)[0].n;
  S.view = 'sub';
  build();
}

function inList(ref) {
  return S.atlas.get('a:' + base(ref.arxiv)) || S.atlas.get('t:' + tkey(ref.title)) || null;
}

function build() {
  const root = S.root;
  root.textContent = '';

  const head = el('div', 'cite-head');
  const tabs = el('div', 'seg tabs');
  tabs.setAttribute('role', 'tablist');
  [['sub', 'Subsections → Papers'], ['theme', 'Sections → Themes'], ['table', 'Reference table']].forEach(([v, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(S.view === v));
    b.dataset.v = v;
    b.addEventListener('click', () => { S.view = v; build(); });
    tabs.append(b);
  });
  head.append(tabs, el('p', 'note', NOTES[S.view]));

  const gwrap = el('div', 'gwrap');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'g');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Which part of the paper cites which reference');
  gwrap.append(svg);
  const tableWrap = el('div', 'tbl-wrap');

  root.append(head, S.view === 'table' ? tableWrap : gwrap, dock());
  if (S.view === 'table') drawTable(tableWrap);
  else { S.gsel = S.view === 'sub' && S.sel ? {side: 'R', key: String(S.sel)} : null; drawGraph(svg); }
}

function drawGraph(g) {
  const bySub = S.view === 'sub';
  const leftRows = bySub ? S.data.subsections : S.data.sections;
  const left = [], leftIdx = new Map(), right = new Map(), links = new Map();

  leftRows.forEach(row => {
    const node = {side: 'L', key: row.key + (bySub ? '|' + row.section : ''), w: 0, idx: left.length, label: row.label};
    leftIdx.set(row.key, node);
    left.push(node);
  });
  S.refs.forEach(ref => {
    const counts = bySub ? ref.subsections : ref.sections;
    for (const key in counts) {
      const l = leftIdx.get(key);
      if (!l) continue;
      const rkey = bySub ? String(ref.n) : (ref.theme || 'Other');
      let r = right.get(rkey);
      if (!r) right.set(rkey, r = {side: 'R', key: rkey, w: 0, sum: 0, ref: bySub ? ref : null,
        label: bySub ? `[${ref.numbers.join(', ')}] ${ref.keyword}` : rkey, tip: bySub ? ref.title : ''});
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
  const topY = 28, H = total * unit + (Math.max(left.length, rights.length) - 1) * 10;
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
    const mine = d.ref ? inList(d.ref) : null;
    const grp = sv('g', {class: 'gnode', tabindex: 0, role: 'button',
      'aria-label': `${d.label}, ${d.w} citations${mine ? `, in your list: ${STATUS[mine.status]}` : ''}`});
    const size = isL ? 12.5 : (bySub ? 11 + (d.w - 1) / Math.max(rmax - 1, 1) * 5 : 13.5);
    const weight = isL ? 500 : (bySub ? (d.w >= 5 ? 600 : d.w >= 3 ? 500 : 400) : 500);
    d.bar = sv('rect', {class: 'gn', x: isL ? xL : xR, y: d.y, width: bw, height: Math.max(d.h, 1), rx: 2});
    const textX = isL ? xL - 8 : xR + bw + 8 + (mine ? 12 : 0);
    const label = sv('text', {class: 'gt', x: textX, y: d.y + d.h / 2, 'text-anchor': isL ? 'end' : 'start',
      'dominant-baseline': 'middle', 'font-size': size.toFixed(1), 'font-weight': weight},
      trim(d.label, isL ? 36 : 32) + ' ');
    label.append(sv('tspan', {class: 'k'}, '×' + d.w));
    grp.append(sv('rect', {x: isL ? 0 : xR, y: d.y - 3, width: isL ? xL + bw : W - xR, height: d.h + 6, fill: 'transparent'}), d.bar);
    if (mine) grp.append(sv('circle', {class: 'g-have' + (mine.status === 'done' ? ' read' : ''),
      cx: xR + bw + 13, cy: d.y + d.h / 2, r: 3.6}));
    grp.append(label, sv('title', {}, (d.tip ? `${d.label} — ${d.tip}` : d.label) +
      (mine ? `\nIn your reading list as ${mine.short} (${STATUS[mine.status]})` : '')));
    const go = () => {
      if (d.ref) { select(d.ref.n); return; }
      S.gsel = (S.gsel && S.gsel.side === d.side && S.gsel.key === d.key) ? null : {side: d.side, key: d.key};
      markGraph();
    };
    grp.addEventListener('click', go);
    grp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    d.g = grp;
    g.append(grp);
  });

  S.links = all;
  S.nodes = [...left, ...rights];
  markGraph();
}

function markGraph() {
  const hit = k => S.gsel && (S.gsel.side === 'L' ? k.l.key === S.gsel.key : k.r.key === S.gsel.key);
  const live = new Set();
  S.links.forEach(k => {
    const on = hit(k);
    k.el.setAttribute('class', 'gl' + (S.gsel ? (on ? ' on' : ' dim') : ''));
    if (on) { live.add(k.l); live.add(k.r); }
  });
  S.nodes.forEach(d => {
    const me = S.gsel && d.side === S.gsel.side && d.key === S.gsel.key;
    d.g.setAttribute('class', 'gnode' + (S.gsel && !me && !live.has(d) ? ' dim' : ''));
    d.bar.setAttribute('class', 'gn' + (me ? ' on' : ''));
  });
}

function drawTable(wrap) {
  const rows = S.refs.slice().sort((a, b) => S.sort === 'count'
    ? (b.count - a.count || a.numbers[0] - b.numbers[0])
    : a.numbers[0] - b.numbers[0]);
  const max = Math.max(...rows.map(r => r.count), 1);
  const table = el('table', 'rt');
  const head = el('thead');
  const hr = el('tr');
  const sortable = (label, key) => {
    const th = el('th');
    th.dataset.sort = key;
    th.setAttribute('aria-sort', S.sort === key ? (key === 'count' ? 'descending' : 'ascending') : 'none');
    const b = el('button', 'th-btn', label);
    b.type = 'button';
    b.addEventListener('click', () => { S.sort = key; build(); });
    th.append(b);
    return th;
  };
  hr.append(sortable('[Number]', 'num'), el('th', null, 'Keyword'), el('th', null, 'Full title'),
            el('th', null, 'Year'), el('th', null, 'In your list'), sortable('Times cited', 'count'));
  head.append(hr);
  const body = el('tbody');
  rows.forEach(r => {
    const mine = inList(r);
    const tr = el('tr', 'krow' + (S.sel === r.n ? ' on' : ''));
    tr.tabIndex = 0;
    tr.dataset.n = r.n;
    const cnt = el('td', 'c-cnt');
    const bar = el('span', 'kbar');
    bar.style.width = Math.round(r.count / max * 84) + 'px';
    cnt.append(bar, String(r.count));
    const have = el('td', 'c-have');
    if (mine) have.append(el('span', 'have-pill' + (mine.status === 'done' ? ' read' : ''), `${mine.short} · ${STATUS[mine.status]}`));
    else have.textContent = '—';
    tr.append(el('td', 'c-num', r.label || `[${r.numbers.join(', ')}]`), el('td', 'c-key', r.keyword),
              el('td', 'c-title', r.title), el('td', 'c-year', r.year || '—'), have, cnt);
    tr.addEventListener('click', () => select(r.n));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); select(r.n); } });
    body.append(tr);
  });
  table.append(head, body);
  wrap.append(table);
}

function dock() {
  const d = el('aside', 'dock');
  d.setAttribute('aria-live', 'polite');
  d.append(el('div', 'dock-in'));
  setTimeout(() => drawDock(S.byNum.get(S.sel)), 0);
  return d;
}

function select(n) {
  const ref = S.byNum.get(n);
  if (!ref) return;
  S.sel = ref.n;
  drawDock(ref);
  $$('.krow', S.root).forEach(tr => tr.classList.toggle('on', +tr.dataset.n === S.sel));
  if (S.view === 'sub') { S.gsel = {side: 'R', key: String(ref.n)}; markGraph(); }
}

function sectionTag(label) {
  const m = /^(?:appendix\s+)?([A-Z0-9]+)/i.exec(label || '');
  return m ? m[1] : (label || '').slice(0, 2);
}

function drawDock(ref) {
  const box = $('.dock-in', S.root);
  if (!box || !ref) return;
  box.textContent = '';
  const mine = inList(ref);

  const main = el('div');
  const top = el('div', 'd-top');
  const sections = Object.keys(ref.sections).length;
  top.append(el('b', '', `${ref.label || '[' + ref.numbers.join(', ') + ']'} ${ref.keyword}`),
    el('span', '', `cited ${ref.count}${ref.count === 1 ? ' time' : ' times'} in ${sections}${sections === 1 ? ' section' : ' sections'}`));
  if (mine) top.append(el('span', 'have-pill' + (mine.status === 'done' ? ' read' : ''),
    `in your list: ${mine.short} · ${STATUS[mine.status]}`));
  main.append(top, el('div', 'd-title', ref.title),
    el('p', 'd-meta', [ref.authors, ref.venue].filter(Boolean).join(' · ') || '—'));

  const side = el('div', 'd-side');
  const strip = el('div', 'strip');
  const peak = Math.max(...Object.values(ref.sections), 0);
  S.data.sections.forEach(s => {
    const v = ref.sections[s.key] || 0;
    const cell = el('div', 'cell' + (v ? (v === peak ? ' hot' : '') : ' z'));
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
  box.append(main, side);
}

return {show};
})();
