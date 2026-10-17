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
  list: 'The reference index on the left is sized by how often the paper cites each work. On the right is every sentence that carries a citation, in paper order. Tap either side and both light up.',
};

const S = {data: null, refs: [], byNum: new Map(), atlas: new Map(), sel: null,
           view: 'sub', sort: 'count', filter: null, gsel: null, links: [], nodes: [], root: null, cache: new Map()};

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
  S.sel = null;
  S.filter = null;
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
  [['sub', 'Subsections → Papers'], ['theme', 'Sections → Themes'], ['list', 'References & sentences']].forEach(([v, label]) => {
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
  const cols = el('div', 'cols');

  root.append(head, S.view === 'list' ? cols : gwrap, dock());
  if (S.view === 'list') drawList(cols);
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

function buildIndex() {
  const index = el('section', 'index');
  const head = el('div', 'head');
  head.append(el('h3', null, 'References, sized by times cited'));
  const seg = el('div', 'seg sortseg');
  [['count', 'Most cited'], ['num', 'By number']].forEach(([key, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.sort === key));
    b.addEventListener('click', () => { S.sort = key; build(); });
    seg.append(b);
  });
  head.append(seg);

  const list = el('div', 'list');
  const rows = S.refs.slice().sort((a, b) => S.sort === 'count'
    ? (b.count - a.count || a.numbers[0] - b.numbers[0])
    : a.numbers[0] - b.numbers[0]);
  const max = Math.max(...rows.map(r => r.count), 1);
  rows.forEach(r => {
    const mine = inList(r);
    const b = el('button', 'ref' + (S.sel === r.n ? ' on' : ''));
    b.type = 'button';
    b.dataset.n = r.n;
    const weight = (r.count - 1) / Math.max(max - 1, 1);
    const title = el('span', 'ttl', r.title);
    title.style.fontSize = (13.5 + weight * 5).toFixed(1) + 'px';
    title.style.fontWeight = weight > 0.55 ? 600 : weight > 0.25 ? 500 : 400;
    const mid = el('span');
    const tag = el('span', 'tag', r.keyword);
    if (mine) tag.append(el('i', 'have-dot' + (mine.status === 'done' ? ' read' : ''), ''));
    mid.append(tag, title);
    b.append(el('span', 'num', r.label || `[${r.numbers.join(', ')}]`), mid, el('span', 'cnt', '×' + r.count));
    b.title = mine ? `In your reading list as ${mine.short} (${STATUS[mine.status]})` : r.venue || '';
    // Clicking a reference keeps only its sentences on the right; clicking it again brings the rest back.
    b.addEventListener('click', () => {
      S.filter = S.filter === r.n ? null : r.n;
      select(r.n, {fromIndex: true});
      renderTrail();
    });
    list.append(b);
  });
  index.append(head, list);
  return index;
}

function buildTrail() {
  const trail = el('section', 'trail');
  const head = el('div', 'head');
  head.append(el('h3', null, 'Where each citation appears'));
  trail.append(head);

  const all = S.data.mentions || [];
  const mentions = S.filter == null ? all : all.filter(m => m.refs.includes(S.filter));
  if (S.filter != null) {
    const ref = S.byNum.get(S.filter);
    const bar = el('div', 'trail-filter');
    bar.append(el('span', null, `Showing ${mentions.length} sentence${mentions.length === 1 ? '' : 's'} citing `),
               el('b', null, `${ref.label || '[' + S.filter + ']'} ${ref.keyword}`));
    const btn = el('button', 'show-all', 'Show all');
    btn.type = 'button';
    btn.addEventListener('click', () => { S.filter = null; renderTrail(); });
    bar.append(btn);
    trail.append(bar);
  } else {
    trail.append(el('p', 'note', 'Each line is the sentence from the paper that carries the citation, in paper order. ' +
      'Tap a reference on the left to keep only its sentences.'));
  }

  const subLabel = {};
  S.data.subsections.forEach(s => { subLabel[s.key] = s.label; });
  S.data.sections.forEach(section => {
    const lines = mentions.filter(m => m.sec === section.key);
    if (!lines.length) return;
    const box = el('div', 'sec');
    const h = el('h4', null, section.label);
    h.append(el('span', null, S.filter == null ? `${section.marks} marks`
      : `${lines.reduce((n, m) => n + m.refs.filter(r => r === S.filter).length, 0)} of ${section.marks} marks`));
    box.append(h);
    let sub = null;
    lines.forEach(m => {
      if (m.sub && m.sub !== sub) {
        sub = m.sub;
        if (subLabel[sub] && subLabel[sub] !== section.label) box.append(el('div', 'subh', subLabel[sub]));
      }
      const p = el('p', 'm', m.text + ' ');
      p.dataset.refs = ' ' + m.refs.join(' ') + ' ';
      m.refs.forEach(n => {
        const ref = S.byNum.get(n);
        const chip = el('button', 'c', String(n));
        chip.type = 'button';
        chip.dataset.n = n;
        if (ref) {
          chip.title = `${ref.label || '[' + n + ']'} ${ref.keyword}: ${ref.title}`;
          chip.setAttribute('aria-label', `Reference ${n}, ${ref.title}`);
        }
        chip.addEventListener('click', () => select(n));  // chips highlight only, they never filter
        p.append(chip);
      });
      box.append(p);
    });
    trail.append(box);
  });
  return trail;
}

function drawList(cols) {
  cols.append(buildIndex(), buildTrail());
  markList();
}

function renderTrail() {
  const current = $('.trail', S.root);
  if (current) current.replaceWith(buildTrail());
  markList();
}

function markList() {
  $$('.ref', S.root).forEach(b => b.classList.toggle('on', +b.dataset.n === S.sel));
  $$('.m', S.root).forEach(p => p.classList.toggle('hit', S.sel != null && p.dataset.refs.includes(' ' + S.sel + ' ')));
  $$('.c', S.root).forEach(c => c.classList.toggle('on', +c.dataset.n === S.sel));
}

function dock() {
  const d = el('aside', 'dock');
  d.setAttribute('aria-live', 'polite');
  d.hidden = true;
  d.append(el('div', 'dock-in'));
  if (S.sel != null) setTimeout(() => drawDock(S.byNum.get(S.sel)), 0);
  return d;
}

function closeDock() {
  S.sel = null;
  const wasFiltered = S.filter != null;
  S.filter = null;
  const d = $('.dock', S.root);
  if (d) d.hidden = true;
  document.querySelector('#panel-citations').classList.remove('dock-open');
  if (wasFiltered && S.view === 'list') renderTrail();
  markList();
  if (S.nodes.length) { S.gsel = null; markGraph(); }
}

function select(n, {fromIndex = false} = {}) {
  const ref = S.byNum.get(n);
  if (!ref) return;
  S.sel = ref.n;
  drawDock(ref);
  markList();
  if (S.view === 'list' && !fromIndex) {
    const row = $(`.ref[data-n="${ref.n}"]`, S.root), list = $('.list', S.root);
    if (row && list) list.scrollTop = row.offsetTop - list.clientHeight / 3;
  }
  if (S.view === 'sub') { S.gsel = {side: 'R', key: String(ref.n)}; markGraph(); }
}

function sectionTag(label) {
  const m = /^(?:appendix\s+)?([A-Z0-9]+)/i.exec(label || '');
  return m ? m[1] : (label || '').slice(0, 2);
}

function drawDock(ref) {
  const box = $('.dock-in', S.root);
  if (!box || !ref) return;
  $('.dock', S.root).hidden = false;
  document.querySelector('#panel-citations').classList.add('dock-open');
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
  const close = el('button', 'icon-btn dock-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close this reference');
  close.addEventListener('click', closeDock);
  side.append(strip, link);
  box.append(main, side, close);
}

return {show};
})();
