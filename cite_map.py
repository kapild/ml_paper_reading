#!/usr/bin/env python3
"""Build a citation map for one paper from its arXiv HTML.

    python3 cite_map.py 2305.05065v3
    python3 cite_map.py https://arxiv.org/abs/2305.05065v3
    python3 cite_map.py 2305.05065v3 --html saved.html   # parse a local copy instead

Reads   https://arxiv.org/html/<id> (falls back to ar5iv), plus config/citation_themes.toml
Writes  docs/data/citations/<id>.json and docs/data/citations/index.json,
        then prints a report of what it found.

Needs Python 3.11+ and nothing else. Papers with no HTML version are reported, not parsed:
this script does not read PDFs.
"""
import argparse
import csv
import datetime
import glob
import json
import os
import re
import sys
import tomllib
import urllib.error
import urllib.request
from collections import defaultdict
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ROOT, 'config')
OUT_DIR = os.path.join(ROOT, 'docs', 'data', 'citations')
QUEUE = os.path.join(CONFIG, 'citation_papers.csv')
QUEUE_FIELDS = ['key', 'short', 'title', 'year', 'arxiv', 'status', 'references', 'marks', 'extracted', 'note']
SOURCES = ['https://arxiv.org/html/{id}', 'https://ar5iv.labs.arxiv.org/html/{id}']
UA = 'paper-read-atlas/0.1 (citation map; https://github.com/kapild/ml_paper_reading)'
ARXIV_IN_TEXT = re.compile(r'arxiv[:\s/]*(?:abs/)?(\d{4}\.\d{4,5})', re.I)
YEAR = re.compile(r'\b(19|20)\d{2}\b')
LINE_TAGS = {'p', 'figcaption', 'caption', 'td', 'th', 'li'}
ABBREV = re.compile(r'(?:\b(?:al|e\.g|i\.e|cf|vs|Fig|Eq|Sec|No|Dr|Mr|Ms|St|approx|etc)\.)$', re.I)
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def title_key(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def paper_id(arg):
    """Accept a bare id, an arXiv URL, or an id with a version suffix."""
    m = re.search(r'(\d{4}\.\d{4,5}(?:v\d+)?)', arg)
    if not m:
        sys.exit(f'Not an arXiv id or URL: {arg}')
    return m.group(1)


# ---------- HTML parsing ----------

class LatexmlDoc(HTMLParser):
    """Pulls references, citation marks and their section context out of arXiv's LaTeXML HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []              # open tag names; its length is the current depth
        self.depth = 0
        self.open_sections = []      # innermost last
        self.sections = {}           # key -> dict, in document order
        self.doc_title = []
        self.bibitems = []           # dicts in document order
        self.marks = []              # (ref number, section key, subsection key)
        self.mentions = []           # one entry per citing sentence, in document order
        self._line = None            # the block of text being read, with its citation offsets
        self._bib = None
        self._cite_depth = None
        self._note_depth = None      # footnotes sit inside titles; skip their text
        self._caps = []              # active text captures: (list, depth, kind, target)

    # -- helpers

    def _attr(self, attrs, name):
        for k, v in attrs:
            if k == name:
                return v or ''
        return ''

    def _capture(self, kind, target=None):
        buf = []
        self._caps.append((buf, self.depth, kind, target))
        return buf

    def _section(self, *kinds):
        for s in reversed(self.open_sections):
            if s['kind'] in kinds:
                return s
        return None

    # -- parser callbacks

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        self.stack.append(tag)
        self.depth = len(self.stack)
        cls = self._attr(attrs, 'class')
        sid = self._attr(attrs, 'id')

        if ('ltx_note' in cls or 'ltx_pubnote' in cls) and self._note_depth is None:
            self._note_depth = self.depth

        if tag == 'section':
            kind = ('section' if 'ltx_section' in cls else 'appendix' if 'ltx_appendix' in cls
                    else 'subsection' if 'ltx_subsection' in cls else 'paragraph' if 'ltx_paragraph' in cls
                    else 'other')
            sec = {'key': sid or f'sec{len(self.sections)}', 'kind': kind, 'label': '', 'depth': self.depth,
                   'order': len(self.sections)}
            self.open_sections.append(sec)
            if kind != 'other':
                self.sections[sec['key']] = sec
            return

        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6') and 'ltx_title' in cls:
            if 'ltx_title_document' in cls:
                self._caps.append((self.doc_title, self.depth, 'text', None))
            elif self.open_sections:
                self._capture('title', self.open_sections[-1])
            return

        if tag == 'li' and 'ltx_bibitem' in cls:
            m = re.match(r'bib\.bib(\d+)', sid or '')
            self._bib = {'id': sid, 'number': int(m.group(1)) if m else None,
                         'label': '', 'blocks': [], 'depth': self.depth}
            self.bibitems.append(self._bib)
            return

        if self._bib is not None:
            if 'ltx_tag' in cls:
                self._capture('bibtag', self._bib)
            elif 'ltx_bibblock' in cls:
                self._capture('bibblock', self._bib)
            return

        if tag in LINE_TAGS and self._line is None:
            top, sub = self._section('section', 'appendix'), self._section('subsection') or self._section('paragraph')
            self._line = {'parts': [], 'marks': [], 'depth': self.depth,
                          'sec': top['key'] if top else '', 'sub': (sub or top or {}).get('key', '')}

        if tag == 'cite' and 'ltx_cite' in cls:
            self._cite_depth = self.depth
            return

        if tag == 'a' and self._cite_depth is not None:
            m = re.match(r'#bib\.bib(\d+)', self._attr(attrs, 'href'))
            if m:
                top = self._section('section', 'appendix')
                sub = self._section('subsection') or self._section('paragraph')
                tk = top['key'] if top else ''
                num = int(m.group(1))
                self.marks.append((num, tk, sub['key'] if sub else tk))
                if self._line is not None:
                    self._line['marks'].append((sum(len(p) for p in self._line['parts']), num))

    def handle_startendtag(self, tag, attrs):
        pass  # self-closing tags never change depth or context

    def handle_endtag(self, tag):
        if tag in VOID or tag not in self.stack:
            return
        # Close everything the document left open inside this element, then the element itself.
        depth = len(self.stack) - 1 - self.stack[::-1].index(tag)
        del self.stack[depth:]
        self.depth = depth

        while self._caps and self._caps[-1][1] > self.depth:
            buf, _, kind, target = self._caps.pop()
            text = clean(''.join(buf))
            if kind == 'title' and not target['label']:
                target['label'] = text
            elif kind == 'bibtag' and not target['label']:
                # "[19]" in a numbered bibliography, "Abnar et al. [2021]" in an author-year one
                target['label'] = text
                if target['number'] is None:
                    m = re.search(r'\d+', text)
                    target['number'] = int(m.group(0)) if m else None
            elif kind == 'bibblock' and text:
                target['blocks'].append(text)

        if self._line is not None and self._line['depth'] > self.depth:
            self._close_line()
        while self.open_sections and self.open_sections[-1]['depth'] > self.depth:
            self.open_sections.pop()
        if self._bib is not None and self._bib['depth'] > self.depth:
            self._bib = None
        if self._cite_depth is not None and self._cite_depth > self.depth:
            self._cite_depth = None
        if self._note_depth is not None and self._note_depth > self.depth:
            self._note_depth = None

    def _close_line(self):
        """Turn the block just read into one mention per citing sentence."""
        line, self._line = self._line, None
        if not line['marks']:
            return
        text = ''.join(line['parts'])
        spans = split_sentences(text)
        groups = {}
        for offset, num in line['marks']:
            idx = next((i for i, (a, b) in enumerate(spans) if a <= offset <= b), len(spans) - 1)
            groups.setdefault(idx, []).append(num)
        for idx in sorted(groups):
            a, b = spans[idx]
            sentence = clean(text[a:b])
            if len(sentence) > 320:
                sentence = sentence[:300].rsplit(' ', 1)[0] + '…'
            self.mentions.append({'sec': line['sec'], 'sub': line['sub'],
                                  'text': sentence, 'refs': groups[idx]})

    def handle_data(self, data):
        if self._note_depth is not None:
            return
        if self._line is not None:
            self._line['parts'].append(data)
        for buf, _, _, _ in self._caps:
            buf.append(data)


def split_sentences(text):
    """Rough sentence spans, skipping the usual abbreviations so "et al." stays put."""
    spans, start = [], 0
    for m in re.finditer(r'(?<=[.!?])["\')\]]*\s+(?=[A-Z(\[“"])', text):
        if ABBREV.search(text[max(0, m.start() - 12):m.start()]):
            continue
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(text)))
    return [(a, b) for a, b in spans if b > a] or [(0, len(text))]


def fetch(pid, local=None):
    if local:
        with open(local, encoding='utf-8', errors='replace') as f:
            return f.read(), os.path.abspath(local)
    problems = []
    for template in SOURCES:
        url = template.format(id=pid)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode('utf-8', 'replace')
            if 'ltx_bibitem' in html:
                return html, url
            problems.append(f'{url} has no LaTeXML bibliography')
        except urllib.error.HTTPError as e:
            problems.append(f'{url} returned HTTP {e.code}')
        except Exception as e:  # noqa: BLE001 - report whatever urllib raised and move on
            problems.append(f'{url} failed: {e}')
    sys.exit('No arXiv HTML version found for this paper, so there is nothing to parse:\n  '
             + '\n  '.join(problems)
             + '\nOlder papers often have no HTML version. This script does not read PDFs.')


# ---------- turning bibitems into references ----------

STOP = {'a', 'an', 'the', 'of', 'for', 'and', 'with', 'in', 'on', 'to', 'via', 'using', 'towards',
        'learning', 'neural', 'deep', 'model', 'models', 'based', 'from', 'by', 'at', 'is', 'are'}


def smart_case(name):
    """bert4rec -> BERT4Rec, s3-rec -> S3-Rec, dsi -> DSI. arXiv lowercases titles in bibliographies."""
    def piece(w, first):
        if not w or w.isupper():
            return w
        m = re.match(r'^([a-zA-Z]+)(\d)(.*)$', w)
        if m:
            stem, digit, tail = m.groups()
            stem = stem.upper() if len(stem) <= 6 else stem[:1].upper() + stem[1:]
            return stem + digit + (tail[:1].upper() + tail[1:] if tail else '')
        if first and len(w) <= 5 and w.isalpha():
            return w.upper()
        return w[:1].upper() + w[1:]
    return '-'.join(piece(p, i == 0) for i, p in enumerate(name.split('-')))


def keyword_for(title):
    """A short name for a paper: its acronym where it has one, else its first words."""
    t = clean(title).rstrip('.')
    paren = re.findall(r'\(([A-Za-z][A-Za-z0-9\-]{0,13})\)', t)
    for cand in reversed(paren):
        if len(cand) <= 10 and re.search(r'[A-Za-z]', cand):
            return smart_case(cand)
    head = t.split(':', 1)[0].strip() if ':' in t else ''
    if head and len(head) <= 22 and len(head.split()) <= 2:
        return smart_case(head)
    for word in t.split():
        w = word.strip('.,()')
        if len(w) > 2 and (re.search(r'[a-z][A-Z]', w) or re.search(r'[A-Za-z]\d', w) or (w.isupper() and len(w) > 2)):
            return smart_case(w)
    words = [w.strip('.,:()') for w in t.split()]
    keep = [w for w in words if w.lower() not in STOP][:2] or words[:2]
    out = ' '.join(keep)
    return out[:1].upper() + out[1:]


def load_themes():
    path = os.path.join(CONFIG, 'citation_themes.toml')
    if not os.path.exists(path):
        return []
    with open(path, 'rb') as f:
        cfg = tomllib.load(f)
    return [(t['name'], [w.lower() for w in t.get('match', [])]) for t in cfg.get('theme', [])]


def theme_for(ref, rules):
    hay = f"{ref['title']} {ref['venue']} {ref['keyword']}".lower()
    for name, words in rules:
        if any(w in hay for w in words):
            return name
    return 'Other'


def build_references(doc, rules):
    """One entry per bibitem, then merge entries whose titles match."""
    refs = {}
    for item in doc.bibitems:
        n = item['number']
        if n is None:
            continue
        blocks = item['blocks']
        authors = blocks[0].rstrip('.') if blocks else ''
        title = (blocks[1] if len(blocks) > 1 else '').rstrip('.')
        venue = clean(' '.join(blocks[2:])) if len(blocks) > 2 else ''
        # Some styles run the title and the venue together in one block: "Title. In Proceedings of ..."
        cut = re.search(r'\.\s+(?=(?:In\b|Proceedings\b|arXiv\b|IEEE\b|ACM\b|Journal\b|Advances\b|Transactions\b|\d{4}\b))', title)
        if cut and cut.start() >= 12:
            venue = clean(title[cut.end():] + (' ' + venue if venue else ''))
            title = title[:cut.start()]
        venue = clean(re.sub(r'https?://\S+', '', venue))
        years = YEAR.findall(venue) or YEAR.findall(' '.join(blocks))
        year = re.findall(r'\b((?:19|20)\d{2})\b', venue or ' '.join(blocks))
        arx = ARXIV_IN_TEXT.search(' '.join(blocks))
        ref = {'n': n, 'numbers': [n], 'label': item.get('label') or f'[{n}]',
               'authors': authors, 'title': title, 'venue': venue,
               'year': year[-1] if year else '', 'arxiv': arx.group(1) if arx else '',
               'count': 0, 'sections': {}, 'subsections': {}}
        ref['keyword'] = keyword_for(title or authors)
        ref['theme'] = theme_for(ref, rules)
        refs[n] = ref
        del years
    return refs


def merge_duplicates(refs):
    """A preprint and its published version share a title: one row, counts summed."""
    by_title, order, merged = {}, [], 0
    for n in sorted(refs):
        ref = refs[n]
        key = title_key(ref['title'])
        first = by_title.get(key)
        if key and first:
            first['numbers'].append(n)
            if ref['label'] and ref['label'] not in first['label']:
                first['label'] += ' · ' + ref['label']
            first['count'] += ref['count']
            for field in ('sections', 'subsections'):
                for k, v in ref[field].items():
                    first[field][k] = first[field].get(k, 0) + v
            if not first['arxiv'] and ref['arxiv']:
                first['arxiv'] = ref['arxiv']
            if ref['year'] and ref['year'] not in first['year'].split(', '):
                first['year'] = ', '.join(filter(None, [first['year'], ref['year']]))
            merged += 1
        else:
            by_title[key] = ref
            order.append(ref)
    return order, merged


def extract_paper(pid, local=None):
    """Fetch, parse and write one paper's citation map. Returns (data, report, output path)."""
    html, source = fetch(pid, local)
    doc = LatexmlDoc()
    doc.feed(html)

    rules = load_themes()
    refs = build_references(doc, rules)
    report = defaultdict(list)

    sec_marks, sub_marks, unknown = defaultdict(int), defaultdict(int), set()
    for n, sec, sub in doc.marks:
        ref = refs.get(n)
        if not ref:
            unknown.add(n)
            continue
        ref['count'] += 1
        if sec:
            ref['sections'][sec] = ref['sections'].get(sec, 0) + 1
            sec_marks[sec] += 1
        if sub:
            ref['subsections'][sub] = ref['subsections'].get(sub, 0) + 1
            sub_marks[sub] += 1
    if unknown:
        report['unknown'].append(f'{len(unknown)} citation marks point to reference numbers with no bibitem: '
                                 + ', '.join(f'[{n}]' for n in sorted(unknown)))

    rows, merged = merge_duplicates(refs)
    uncited = [r for r in rows if not r['count']]
    if uncited:
        report['uncited'].append(f'{len(uncited)} references are never cited in the text: '
                                 + ', '.join(f'[{r["numbers"][0]}]' for r in uncited))

    # Sections and subsections, in paper order, keeping only those that cite something.
    sections, subsections = [], []
    for sec in doc.sections.values():
        if sec['kind'] in ('section', 'appendix') and sec_marks.get(sec['key']):
            sections.append({'key': sec['key'], 'label': sec['label'] or sec['key'],
                             'kind': sec['kind'], 'marks': sec_marks[sec['key']]})
        elif sec['kind'] in ('subsection', 'paragraph') and sub_marks.get(sec['key']):
            parent = next((s['key'] for s in doc.sections.values()
                           if s['kind'] in ('section', 'appendix') and sec['key'].startswith(s['key'] + '.')), '')
            subsections.append({'key': sec['key'], 'section': parent, 'kind': sec['kind'],
                                'label': (sec['label'] or sec['key']).rstrip('.'), 'marks': sub_marks[sec['key']]})

    # Marks sitting directly in a section, with no subsection of their own, get a row for the section.
    for sec in sections:
        direct = sub_marks.get(sec['key'], 0)
        if direct:
            subsections.append({'key': sec['key'], 'section': sec['key'], 'kind': 'section',
                                'label': sec['label'], 'marks': direct})
    order = {s['key']: i for i, s in enumerate(sections)}
    subsections.sort(key=lambda s: (order.get(s['section'], 99), s['key']))

    themes = []
    for r in rows:
        if r['theme'] not in themes:
            themes.append(r['theme'])
    if len(themes) > 8:
        keep = sorted(themes, key=lambda t: -sum(x['count'] for x in rows if x['theme'] == t))[:7]
        for r in rows:
            if r['theme'] not in keep:
                r['theme'] = 'Other'
        themes = [t for t in themes if t in keep] + ['Other']
    if len(themes) < 5:
        report['themes'].append(f'Only {len(themes)} themes matched. Add rules to config/citation_themes.toml '
                                'for a more useful "Sections → Themes" tab.')

    data = {
        'generated': datetime.date.today().isoformat(),
        'paper': {'arxiv': pid, 'title': clean(''.join(doc.doc_title)), 'source': source},
        'stats': {'references': len(refs), 'rows': len(rows), 'merged': merged,
                  'marks': sum(r['count'] for r in rows), 'sections': len(sections)},
        'themes': themes,
        'sections': sections,
        'subsections': subsections,
        'references': rows,
        'mentions': [m for m in doc.mentions if any(n in refs for n in m['refs'])],
    }
    data['stats']['mentions'] = len(data['mentions'])
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f'{pid}.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    write_index()

    return data, report, out


def write_index():
    """Rebuild docs/data/citations/index.json from the maps on disk, so it never keeps stale rows."""
    papers = []
    for path in sorted(glob.glob(os.path.join(OUT_DIR, '*.json'))):
        if os.path.basename(path) == 'index.json':
            continue
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        papers.append({'arxiv': d['paper']['arxiv'], 'title': d['paper']['title'],
                       'references': d['stats']['rows'], 'marks': d['stats']['marks'],
                       'generated': d['generated']})
    with open(os.path.join(OUT_DIR, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'papers': papers}, f, ensure_ascii=False, indent=1)


def print_map_report(data, report, out):
    rows, sections, subsections = data['references'], data['sections'], data['subsections']
    themes, merged = data['themes'], data['stats']['merged']
    top = max(rows, key=lambda r: r['count'])
    print('Citation map')
    print(f'  source     {data["paper"]["source"]}')
    print(f'  paper      {data["paper"]["title"] or "(no title found)"}')
    print(f'  references {data['stats']['references']} bibitems, {len(rows)} rows after merging {merged} duplicate title(s)')
    print(f'  marks      {data["stats"]["marks"]} citation marks')
    print(f'  sections   {len(sections)} cite something, {len(subsections)} subsection rows')
    print(f'  sentences  {data["stats"].get("mentions", 0)} citing sentences captured')
    print(f'  most cited [{top["numbers"][0]}] {top["keyword"]} — {top["count"]} times')
    print(f'  themes     {len(themes)}: ' + ', '.join(themes))
    print(f'  wrote      {os.path.relpath(out, ROOT)}')
    if report:
        print()
        for title, items in [('Unmatched citation marks', report['unknown']),
                             ('Never cited', report['uncited']),
                             ('Themes', report['themes'])]:
            for item in items:
                print(f'  - {item}')



def stamp_pages():
    """Refresh the ?v= hashes so a browser picks up new data."""
    try:
        sys.path.insert(0, ROOT)
        import build
        for page in ('index.html', 'cite.html'):
            build.stamp_assets(page)
    except Exception as e:  # noqa: BLE001 - stamping is a convenience, not the job
        print(f'  (could not stamp the pages: {e})')


# ---------- the queue in config/citation_papers.csv ----------

def read_queue():
    if not os.path.exists(QUEUE):
        sys.exit(f'No {os.path.relpath(QUEUE, ROOT)} yet. Run python3 build.py once and it will create the list.')
    with open(QUEUE, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def write_queue(rows):
    with open(QUEUE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=QUEUE_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, '') for k in QUEUE_FIELDS})


def run_queue(limit=None):
    """Extract every row whose status is "extract", then write the result back into the CSV."""
    rows = read_queue()
    todo = [r for r in rows if (r.get('status') or '').strip().lower() == 'extract']
    where = os.path.relpath(QUEUE, ROOT)
    if not todo:
        print(f'Nothing marked for extraction in {where}.')
        print('Set a row\'s status column to "extract" and run this again.')
        return
    if limit:
        todo = todo[:limit]
    print(f'Extracting {len(todo)} paper(s) marked "extract" in {where}.\n')
    today = datetime.date.today().isoformat()
    done = failed = 0
    for row in todo:
        name = row.get('short') or row.get('key') or row.get('arxiv')
        arxiv = (row.get('arxiv') or '').strip()
        if not arxiv:
            row.update(status='no-arxiv', note='no arXiv id for this paper', extracted=today)
            print(f'  {name}: no arXiv id, skipped')
            failed += 1
        else:
            try:
                data, paper_report, out = extract_paper(arxiv)
            except (SystemExit, Exception) as e:  # noqa: BLE001 - one bad paper must not stop the queue
                row.update(status='error', note=clean(str(e))[:200], extracted=today)
                print(f'  {name}: failed — {clean(str(e))[:110]}')
                failed += 1
            else:
                trouble = paper_report.get('unknown') or []
                if not data['stats']['marks']:
                    trouble = trouble or ['no citation marks were found in the HTML']
                row.update(status='check' if trouble else 'done', references=str(data['stats']['rows']),
                           marks=str(data['stats']['marks']), extracted=data['generated'],
                           note=clean(trouble[0])[:200] if trouble else '')
                print(f"  {name}: {data['stats']['rows']} references, {data['stats']['marks']} marks "
                      f"-> {os.path.relpath(out, ROOT)}" + (f'\n      check: {clean(trouble[0])[:110]}' if trouble else ''))
                done += 1
        write_queue(rows)  # after each paper, so an interrupted run keeps what it finished
    print(f'\n{done} extracted, {failed} failed. Statuses written back to {where}.')
    stamp_pages()


def main():
    ap = argparse.ArgumentParser(description='Build citation maps from arXiv HTML.')
    ap.add_argument('paper', nargs='?', help='arXiv id (2305.05065v3) or URL')
    ap.add_argument('--html', help='parse this local HTML file instead of fetching')
    ap.add_argument('--queue', action='store_true',
                    help='extract every paper whose status is "extract" in config/citation_papers.csv')
    ap.add_argument('--limit', type=int, help='with --queue, stop after this many papers')
    args = ap.parse_args()

    if args.queue:
        run_queue(args.limit)
        return
    if not args.paper:
        ap.error('give an arXiv id or URL, or --queue to work through config/citation_papers.csv')
    data, report, out = extract_paper(paper_id(args.paper), args.html)
    print_map_report(data, report, out)
    stamp_pages()


if __name__ == '__main__':
    main()
