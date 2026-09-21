#!/usr/bin/env python3
"""Build the Paper Read Atlas data file from the Notion export.

    python3 build.py

Reads   the Notion CSV export ending in _all.csv in this folder, plus config/themes.toml,
        config/overrides.toml and config/lineages.toml
Writes  docs/data/papers.js, then prints a report of anything that needs a fix.

Needs Python 3.11+ and nothing else.
"""
import csv
import datetime
import glob
import hashlib
import json
import os
import re
import sys
import tomllib
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ROOT, 'config')
OUT = os.path.join(ROOT, 'docs', 'data', 'papers.js')

STATUS = {'done': 'done', 'in progress': 'reading', 'next': 'next', 'not started': 'later'}
STATUS_RANK = {'done': 0, 'reading': 1, 'next': 2, 'later': 3}
STATUS_NAME = {'done': 'read', 'reading': 'in progress', 'next': 'queued', 'later': 'someday'}
ARXIV = re.compile(r'(?:arxiv\.org/(?:abs|pdf|html)/|\[)(\d{2})(\d{2})\.(\d{4,5})')
NOTION_LINK = re.compile(r'\s*,?\s*(.+?)\s*\((https?://[^)\s]+)\)', re.S)
BRACKET_PREFIX = re.compile(r'^\[[^\]]*\]\s*(\|\s*)?')


# ---------- small helpers ----------

def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def full_key(name):
    """Exact-ish key for matching overrides to a Notion Name."""
    return re.sub(r'[^a-z0-9]', '', clean(name).lower())


def title_key(name):
    """Loose key for matching link names and spotting duplicate rows."""
    return re.sub(r'[^a-z0-9]', '', BRACKET_PREFIX.sub('', clean(name)).lower())[:40]


def clean_title(name):
    return BRACKET_PREFIX.sub('', clean(name)).strip(' ]')


def auto_short(title):
    """Short chart label: the part before the first colon, or a shortened title."""
    t = clean_title(title)
    if ':' in t:
        head = t.split(':', 1)[0].strip()
        if 1 <= len(head) <= 32:
            return head
    if len(t) <= 32:
        return t
    out = ''
    for word in t.split():
        if len(out) + len(word) + 1 > 28:
            break
        out = f'{out} {word}'.strip()
    return (out or t[:28]) + '…'


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:60] or 'paper'


def uniq(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def column(row, *names):
    for n in names:
        if n in row and row[n]:
            return row[n]
    return ''


def parse_date(s):
    m = re.match(r'([A-Za-z]+ \d{1,2}, \d{4})', clean(s))
    if not m:
        return None
    try:
        return datetime.datetime.strptime(m.group(1), '%B %d, %Y').date().isoformat()
    except ValueError:
        return None


def parse_links(s):
    return [(clean(m.group(1)), m.group(2)) for m in NOTION_LINK.finditer(s or '')]


def load_toml(name):
    path = os.path.join(CONFIG, name)
    if not os.path.exists(path):
        return {}
    with open(path, 'rb') as f:
        return tomllib.load(f)


def load_config():
    return {'themes': load_toml('themes.toml'), 'overrides': load_toml('overrides.toml'), 'lineages': load_toml('lineages.toml')}


def read_rows(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


# ---------- build ----------

def build(rows, cfg, source):
    report = defaultdict(list)
    theme_cfg = cfg.get('themes', {})
    themes = [{'key': t['key'], 'name': t['name'], 'short': t.get('short', t['name'])} for t in theme_cfg.get('theme', [])]
    theme_keys = {t['key'] for t in themes}
    rules = []
    for tag, theme in theme_cfg.get('rules', []):
        if theme not in theme_keys:
            report['config'].append(f'themes.toml: the rule for tag "{tag}" points to unknown theme "{theme}".')
        rules.append((tag.lower(), theme))

    ov_cfg = cfg.get('overrides', {})
    aliases = {k.lower(): v for k, v in ov_cfg.get('org_aliases', {}).items()}
    overrides = {full_key(k): (k, v) for k, v in ov_cfg.get('papers', {}).items()}
    used_overrides = set()

    # 1. One record per non-blank CSV row
    recs, blank, excluded = [], 0, 0
    for i, r in enumerate(rows):
        name = clean(r.get('Name'))
        if not name:
            blank += 1
            continue
        k = full_key(name)
        ov = overrides.get(k, (None, {}))[1]
        if k in overrides:
            used_overrides.add(k)
        if ov.get('exclude'):
            excluded += 1
            continue
        link = clean(r.get('Link'))
        m = ARXIV.search(f'{link} {name}')
        recs.append({
            'i': i, 'name': name, 'ov': ov, 'link': link,
            'arxiv': f'{m.group(1)}{m.group(2)}.{m.group(3)}' if m else None,
            'status': STATUS.get(clean(r.get('Status')).lower(), 'later'),
            'date': parse_date(r.get('Date')),
            'tags': [t.strip() for t in (r.get('Tags') or '').split(',') if t.strip()],
            'company': clean(r.get('Company')),
            'year': int(m2.group(0)) if (m2 := re.match(r'\d{4}', clean(r.get('Year')))) else None,
            'notes': parse_links(column(r, 'Code Sumamry', 'Code Summary')) + parse_links(r.get('ML topics')),
            'back': [n for n, _ in parse_links(r.get('ML Papers backlink'))],
            'fwd': [n for n, _ in parse_links(r.get('ML Papers fwdlink'))],
        })

    # 2. Merge duplicate rows: same arXiv ID, or same title
    parent = list(range(len(recs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    seen = {}
    for idx, rc in enumerate(recs):
        keys = []
        if rc['arxiv']:
            keys.append(('arxiv', rc['arxiv']))
        tk = title_key(rc['ov'].get('title') or rc['name'])
        if not rc['name'].lower().startswith('http') and len(tk) >= 12:
            keys.append(('title', tk))
        for key in keys:
            if key in seen:
                parent[find(idx)] = find(seen[key])
            else:
                seen[key] = idx
    groups = defaultdict(list)
    for idx, rc in enumerate(recs):
        groups[find(idx)].append(rc)

    # 3. One paper per group
    papers, merged = [], 0
    for members in groups.values():
        members.sort(key=lambda rc: (STATUS_RANK[rc['status']], rc['i']))
        merged += len(members) - 1
        prim = members[0]
        ov = {}
        for rc in reversed(members):
            ov.update(rc['ov'])
        title = ov.get('title') or clean_title(prim['name'])
        arxiv = next((rc['arxiv'] for rc in members if rc['arxiv']), None)
        tags = uniq(t for rc in members for t in rc['tags'])

        theme = ov.get('theme')
        if theme and theme not in theme_keys:
            report['config'].append(f'overrides.toml: "{prim["name"]}" uses unknown theme "{theme}".')
            theme = None
        if not theme:
            lower = {t.lower() for t in tags}
            theme = next((th for tag, th in rules if tag in lower and th in theme_keys), None)
        if not theme:
            theme = 'unsorted'
            report['unsorted'].append(f'{prim["name"]}  (tags: {", ".join(tags) or "none"})')

        if ov.get('year'):
            year, month = int(ov['year']), None
        elif arxiv:
            year, month = 2000 + int(arxiv[:2]), int(arxiv[2:4])
        else:
            year, month = next((rc['year'] for rc in members if rc['year']), None), None
        pub = None if year is None else round(year + ((month - 1) / 12 + 0.04 if month else 0.5), 3)
        if year is None:
            report['no_year'].append(prim['name'])

        status = prim['status']
        read = None
        if status in ('done', 'reading'):
            read = next((rc['date'] for rc in members if rc['date'] and rc['status'] in ('done', 'reading')), None)
        url = next((rc['link'].rstrip(')') for rc in members if rc['link'].startswith('http')), None)
        if not url and arxiv:
            url = f'https://arxiv.org/abs/{arxiv}'
        company = next((rc['company'] for rc in members if rc['company']), '')
        notes, note_urls = [], set()
        for rc in members:
            for t, u in rc['notes']:
                if u not in note_urls:
                    note_urls.add(u)
                    notes.append({'t': t, 'u': u})

        papers.append({
            '_rows': [rc['i'] for rc in members], '_names': [rc['name'] for rc in members],
            '_back': uniq(n for rc in members for n in rc['back']), '_fwd': uniq(n for rc in members for n in rc['fwd']),
            'short': ov.get('short') or auto_short(title), 'title': title,
            'year': year, 'month': month, 'pub': pub, 'arxiv': arxiv, 'url': url,
            'status': status, 'read': read, 'theme': theme,
            'org': ov.get('org') or aliases.get(company.lower(), company),
            'tags': [t for t in tags if t.lower() != 'done'], 'notes': notes,
        })

    papers.sort(key=lambda p: (p['pub'] is None, p['pub'] or 0, p['title'].lower()))
    used_keys = set()
    for p in papers:
        base = p['arxiv'] or slug(p['title'])
        key, n = base, 2
        while key in used_keys:
            key, n = f'{base}-{n}', n + 1
        used_keys.add(key)
        p['key'] = key

    # 4. Links from the backlink / fwdlink columns
    lookup = {}
    for p in papers:
        for nm in p['_names'] + [p['title']]:
            lookup.setdefault(title_key(nm), p)
    for p in papers:
        p['buildsOn'], p['builtOnBy'] = set(), set()
    unresolved = set()
    for p in papers:
        for nm in p['_back']:
            q = lookup.get(title_key(nm))
            if q is None:
                unresolved.add(nm)
            elif q is not p:
                p['buildsOn'].add(q['key'])
                q['builtOnBy'].add(p['key'])
        for nm in p['_fwd']:
            q = lookup.get(title_key(nm))
            if q is None:
                unresolved.add(nm)
            elif q is not p:
                p['builtOnBy'].add(q['key'])
                q['buildsOn'].add(p['key'])
    report['unresolved_links'] = sorted(unresolved)
    edges = {frozenset((p['key'], k)) for p in papers for k in p['builtOnBy']}
    by_key = {p['key']: p for p in papers}
    for p in papers:
        for k in sorted(p['buildsOn']):
            q = by_key[k]
            if p['pub'] is not None and q['pub'] is not None and q['pub'] > p['pub'] + 0.25:
                report['backwards'].append(f'{p["short"]} ({p["year"]}) builds on {q["short"]} ({q["year"]})')

    # 5. Lineages
    by_short = defaultdict(list)
    for p in papers:
        by_short[p['short'].lower()].append(p)
    by_arxiv = {p['arxiv']: p for p in papers if p['arxiv']}

    def station(s):
        s = clean(s)
        hits = by_short.get(s.lower(), [])
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            return None, f'"{s}" is the short name of {len(hits)} papers; use its full title or arXiv ID'
        if s in by_arxiv:
            return by_arxiv[s], None
        q = lookup.get(title_key(s))
        return (q, None) if q else (None, f'"{s}" matches no paper')

    lineages = []
    for ln in cfg.get('lineages', {}).get('line', []):
        name = ln.get('name', '(unnamed line)')
        keys = []
        for s in ln.get('stations', []):
            q, err = station(s)
            if err:
                report['lineage'].append(f'{name}: {err}')
            elif q['pub'] is None:
                report['lineage'].append(f'{name}: "{s}" has no publication year, so it can\'t be placed')
            elif q['key'] not in keys:
                keys.append(q['key'])
        if len(keys) >= 2:
            keys.sort(key=lambda k: next(p['pub'] for p in papers if p['key'] == k))
            lineages.append({'name': name, 'stations': keys})
        else:
            report['lineage'].append(f'{name}: needs at least 2 stations that match papers')

    for k, (original, _) in overrides.items():
        if k not in used_overrides:
            report['unused_overrides'].append(original)

    used_themes = {p['theme'] for p in papers}
    if 'unsorted' in used_themes:
        themes.append({'key': 'unsorted', 'name': 'Unsorted', 'short': 'Unsorted'})

    data = {
        'generated': datetime.date.today().isoformat(),
        'source': source,
        'rows': len(rows),
        'config': {'lineages': 'config/lineages.toml'},
        'themes': themes,
        'papers': [{
            'key': p['key'], 'short': p['short'], 'title': p['title'],
            'year': p['year'], 'month': p['month'], 'pub': p['pub'], 'arxiv': p['arxiv'], 'url': p['url'],
            'status': p['status'], 'read': p['read'], 'theme': p['theme'], 'org': p['org'],
            'tags': p['tags'], 'notes': p['notes'],
            'buildsOn': sorted(p['buildsOn']), 'builtOnBy': sorted(p['builtOnBy']),
        } for p in papers],
        'lineages': lineages,
    }
    stats = {'blank': blank, 'excluded': excluded, 'merged': merged, 'edges': len(edges)}
    report['suggestions'] = suggest_lineages(papers, lineages)
    return data, report, papers, stats


def suggest_lineages(papers, lineages, limit=5):
    """Longest chains of papers that build on each other, not already drawn as a line."""
    dated = {p['key']: p for p in papers if p['pub'] is not None}
    succ = defaultdict(set)
    for p in dated.values():
        for k in p['builtOnBy']:
            if k in dated and dated[k]['pub'] > p['pub']:
                succ[p['key']].add(k)
    has_pred = {k for s in succ.values() for k in s}
    paths, budget = [], [20000]

    def walk(path):
        if budget[0] <= 0:
            return
        budget[0] -= 1
        nxt = succ.get(path[-1])
        if not nxt:
            if len(path) >= 3:
                paths.append(list(path))
            return
        for k in sorted(nxt, key=lambda k: (dated[k]['pub'], k)):
            path.append(k)
            walk(path)
            path.pop()

    for k in sorted(dated, key=lambda k: (dated[k]['pub'], k)):
        if k not in has_pred and succ.get(k):
            walk([k])
    drawn = [set(ln['stations']) for ln in lineages]
    chosen = []
    for path in sorted(paths, key=lambda x: (-len(x), dated[x[0]]['pub'], x)):
        s = set(path)
        if any(len(s - d) <= 1 for d in drawn):
            continue
        if any(len(s & set(c)) >= 2 for c in chosen):
            continue
        chosen.append(path)
        if len(chosen) >= limit:
            break
    return [[dated[k] for k in path] for path in chosen]


# ---------- report ----------

def print_report(data, report, stats, csv_name, extra_warnings):
    P = data['papers']
    count = lambda s: sum(1 for p in P if p['status'] == s)
    print('Paper Read Atlas build')
    print(f'  source   {csv_name} ({data["rows"]} rows)')
    print(f'  papers   {len(P)}: {count("done")} read, {count("reading")} in progress, {count("next")} queued, {count("later")} someday')
    print(f'  cleanup  {stats["merged"]} duplicate rows merged, {stats["excluded"]} excluded by overrides, {stats["blank"]} blank')
    print(f'  links    {stats["edges"]} between papers')
    print(f'  lines    {len(data["lineages"])} lineages')
    print(f'  wrote    {os.path.relpath(OUT, ROOT)}')

    sections = [
        ('config', 'Config problems'),
        ('unsorted', 'Unsorted: no theme rule matched. Add a rule in config/themes.toml or a theme in config/overrides.toml'),
        ('no_year', 'No publication year: add year = ... for it in config/overrides.toml'),
        ('unresolved_links', 'Link names in the backlink/fwdlink columns that match no paper'),
        ('backwards', 'Links that point backwards in time (a paper builds on one that came out later). Check the backlink/fwdlink columns in Notion'),
        ('lineage', 'Lineage problems in config/lineages.toml'),
        ('unused_overrides', 'Overrides that match no Notion Name (renamed or deleted?)'),
    ]
    problems = [(title, report[key]) for key, title in sections if report.get(key)]
    if extra_warnings:
        problems.insert(0, ('Warnings', extra_warnings))
    print()
    if not problems:
        print('Nothing needs attention.')
    for title, items in problems:
        print(f'{title}:')
        for item in items:
            print(f'  - {item}')
        print()

    if report['suggestions']:
        print('Suggested lineages. To draw one, copy it into config/lineages.toml and build again:')
        for chain in report['suggestions']:
            names = ', '.join(json.dumps(p['short'], ensure_ascii=False) for p in chain)
            print(f'\n[[line]]\nname = "Name this line"  # {" → ".join(p["short"] for p in chain)}\nstations = [{names}]')


def stamp_assets():
    """Put a content hash on asset links in docs/index.html, so browsers load fresh files after a rebuild."""
    index = os.path.join(ROOT, 'docs', 'index.html')
    with open(index, encoding='utf-8') as f:
        html = f.read()

    def versioned(m):
        with open(os.path.join(ROOT, 'docs', m.group(1)), 'rb') as asset:
            digest = hashlib.sha1(asset.read()).hexdigest()[:10]
        return f'{m.group(1)}?v={digest}"'

    updated = re.sub(r'((?:assets|data)/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"', versioned, html)
    if updated != html:
        with open(index, 'w', encoding='utf-8') as f:
            f.write(updated)


def main():
    matches = sorted(glob.glob(os.path.join(ROOT, '*_all.csv')), key=os.path.getmtime, reverse=True)
    if not matches:
        sys.exit('No Notion export found. Export the ML Papers database to CSV and put the file ending in _all.csv in this folder.')
    warnings = []
    if len(matches) > 1:
        warnings.append(f'Found {len(matches)} files ending in _all.csv; used the newest, {os.path.basename(matches[0])}. Delete the others to silence this.')
    csv_path = matches[0]
    data, report, _, stats = build(read_rows(csv_path), load_config(), os.path.basename(csv_path))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Generated by build.py. Edit config/ and rebuild instead of changing this file.\n')
        f.write('window.ATLAS_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    stamp_assets()
    print_report(data, report, stats, os.path.basename(csv_path), warnings)


if __name__ == '__main__':
    main()
