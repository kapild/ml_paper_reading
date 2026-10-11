# Paper Read Atlas

A static site that maps the ML papers I read: themes, when each paper came out versus when I read it, idea lineages, and an Obsidian-style link graph around any paper.

## Add new papers

1. Keep logging papers in the **ML Papers** Notion database as usual.
2. Export the database to CSV and put the file ending in `_all.csv` in this folder, replacing the old one.
3. Run the build:

   ```bash
   python3 build.py
   ```

4. Read the report it prints. It lists anything that needs a fix: papers with no theme, papers with no publication year, link names that match no paper, and suggested new lineages.
5. Reload the site.

The build needs Python 3.11 or newer and no packages.

## Run the site locally

```bash
python3 -m http.server 8000 -d docs
```

Then open http://localhost:8000. Opening `docs/index.html` directly also works.

## Citation map

Maps every in-text citation in one paper to its reference, so you stop scrolling back to find out what [19] was. Build it from the paper's arXiv id:

```bash
python3 cite_map.py 2305.05065v3
```

It reads the arXiv HTML version (falling back to ar5iv), writes `docs/data/citations/<id>.json`, and prints what it found. Papers with no HTML version are reported rather than parsed; this does not read PDFs.

Papers with a map show a **Citation map** button in their detail panel, and the site's **Citations** tab holds the views: subsections to papers, sections to themes, and a sortable reference table. Tapping any paper opens its full reference in the bar at the foot of the screen, and references you have already logged are badged with their status.

To queue several papers, edit `config/citation_papers.csv` (one row per paper, written by `build.py`): set a row's `status` to `extract`, then run

```bash
python3 cite_map.py --queue
```

It extracts only the rows marked `extract` and writes each result back into the row as `done`, with the reference and mark counts, or `error` with the reason. Rows for papers with no arXiv id are marked `no-arxiv`.

Keywords and themes in the JSON are generated, so edit that file when one is wrong. Theme rules live in `config/citation_themes.toml`.

## Configuration

Everything you edit by hand lives in `config/`:

| File | What it controls |
|---|---|
| `themes.toml` | The themes, their order, and the tag → theme rules (first matching tag wins). |
| `overrides.toml` | Per-paper fixes keyed by the Notion Name: `short`, `title`, `theme`, `year`, `org`, `exclude`. |
| `lineages.toml` | The lines on the Lineages tab. The build suggests new ones; copy the ones you want. |
| `citation_themes.toml` | The themes on the citation map's "Sections → Themes" tab. |

Don't edit `docs/data/papers.js`; the build rewrites it. The build also refreshes the `?v=` version tags on the script and stylesheet links in `docs/index.html`, so browsers load the new files instead of cached ones. Run the build again after editing anything in `docs/assets/`.

## How the site works out each value

- **Publication date:** the `year` override if set, otherwise the month from the arXiv ID in the link or title, otherwise the Year column.
- **Read date:** the Date column, for papers marked Done or In progress.
- **Theme:** the `theme` override if set, otherwise the first tag rule that matches, otherwise Unsorted.
- **Short name:** the `short` override if set, otherwise the text before the first colon in the title.
- **Links:** the ML Papers backlink and fwdlink columns. A paper's backlinks are the papers it builds on.
- **Dot and circle size:** how many of your papers build on it.
- **Duplicates:** rows with the same arXiv ID or title are merged, keeping the most advanced status.

## Publish on GitHub Pages

1. Commit and push this folder to a GitHub repository.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and the `/docs` folder.

The published site is public, including paper titles, read dates, and the links to your Notion notes pages.
