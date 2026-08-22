'use strict';
// Read a project's linked Obsidian Kanban board (from ~/.claude/cohorte.config.yaml) and
// parse it into columns + cards. The board is a plain markdown file in the user's vault, so this
// stays local + dependency-free. The kanban mirror is Obsidian-only by design.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse, parseProfileBlock } = require('./yaml');

// owner/repo from the project's GitHub origin remote (SSH or HTTPS form), or null.
function githubRepo(projectRoot) {
  try {
    const r = spawnSync('git', ['-C', projectRoot, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0 || !r.stdout) return null;
    const m = r.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

// PR metadata (state, draft, dates) for the repo, keyed by number. Uses the user's authenticated
// `gh` CLI; cached 60s so the dashboard poll doesn't hammer the API. Empty map if gh is absent/fails.
let _prCache = { repo: null, at: 0, map: {} };
function fetchPRs(repo) {
  if (!repo) return {};
  if (_prCache.repo === repo && Date.now() - _prCache.at < 60000) return _prCache.map;
  try {
    const r = spawnSync('gh', ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200',
      '--json', 'number,state,isDraft,createdAt,mergedAt,url,headRefName'], { encoding: 'utf8', timeout: 8000 });
    if (r.status !== 0 || !r.stdout) return _prCache.repo === repo ? _prCache.map : {};
    const map = {};
    for (const pr of JSON.parse(r.stdout)) map[String(pr.number)] = pr;
    _prCache = { repo, at: Date.now(), map };
    return map;
  } catch { return {}; }
}

function readConfig(globalDir) {
  // cohorte.config.yaml under the Claude global dir first, then `~/.cohorte/` — where the
  // installer seeds it for every non-Claude runtime (the shipped scripts probe the same two,
  // in the same order) — then the pre-rename legacy name (read-only fallback).
  const candidates = [
    path.join(globalDir, 'cohorte.config.yaml'),
    path.join(os.homedir(), '.cohorte', 'cohorte.config.yaml'),
    path.join(globalDir, 'thebidouille.config.yaml'),
  ];
  for (const p of candidates) {
    try { return parse(fs.readFileSync(p, 'utf8')); } catch { /* try next */ }
  }
  return null;
}

// The project's PIPELINE.md `name`, or the directory basename as a fallback (a purged project
// has no profile, but its board is still keyed by the old name — match case-insensitively).
function projectName(projectRoot) {
  const md = (() => { try { return fs.readFileSync(path.join(projectRoot, 'PIPELINE.md'), 'utf8'); } catch { return null; } })();
  const profile = md ? parseProfileBlock(md) : null;
  return (profile && profile.name) || path.basename(projectRoot);
}

// Resolve the board key for this project: exact name, else case-insensitive basename match.
function boardEntry(boards, name, projectRoot) {
  if (!boards || typeof boards !== 'object') return null;
  if (boards[name]) return boards[name];
  const base = path.basename(projectRoot).toLowerCase();
  const key = Object.keys(boards).find(k => k.toLowerCase() === name.toLowerCase() || k.toLowerCase() === base);
  return key ? boards[key] : null;
}

// Parse an Obsidian Kanban markdown file into columns of cards. `repo` (owner/repo) turns
// bare `#123` PR references into links.
function parseBoard(md, repo) {
  const cols = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^%%/.test(line)) break; // the `%% kanban:settings %%` trailer ends the board
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { name: h[1], cards: [] }; cols.push(cur); continue; }
    const c = line.match(/^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/);
    if (c && cur) {
      const src = c[2];
      // `#123` = PR reference; `#word` (letter-first) = a feature tag.
      const prs = [...src.matchAll(/#(\d+)\b/g)].map(m => ({
        num: m[1], url: repo ? `https://github.com/${repo}/pull/${m[1]}` : null,
      }));
      // A tag is any #-word that is not a bare number (`#123` = PR ref) — feature ids
      // may start with a digit (`#2fa-login`), which a letter-first pattern dropped
      // from tags while the text-strip below still removed it: the card lost its join key.
      const tags = [...src.matchAll(/#(?!\d+\b)([\wÀ-ɏ][\wÀ-ɏ/-]*)/g)].map(m => m[1]);
      const text = src
        .replace(/#[\wÀ-ɏ/-]+/g, '')   // strip tags + PR refs
        .replace(/\bPR\b/g, '')         // and the leftover "PR" label
        .replace(/[—–-]\s*$/, '')       // trailing dash
        .replace(/\s{2,}/g, ' ').trim();
      cur.cards.push({ text, done: c[1].toLowerCase() === 'x', tags, prs });
    }
  }
  return cols;
}

function kanban({ projectRoot, globalDir }) {
  const cfg = readConfig(globalDir);
  if (!cfg) return { enabled: false, reason: 'no cohorte.config.yaml' };
  const k = cfg.kanban;
  if (!k || k.enabled !== true) return { enabled: false, reason: 'kanban disabled in config' };
  const vault = cfg.obsidian && cfg.obsidian.vault_path;
  if (!vault) return { enabled: false, reason: 'no obsidian.vault_path configured' };

  const name = projectName(projectRoot);
  const entry = boardEntry(k.boards, name, projectRoot);
  if (!entry || !entry.board) return { enabled: false, reason: `no board linked for "${name}"` };

  const boardPath = path.join(vault, entry.board);
  let md;
  try { md = fs.readFileSync(boardPath, 'utf8'); }
  catch { return { enabled: false, reason: `board file unreadable: ${entry.board}` }; }

  const repo = githubRepo(projectRoot);
  const columns = parseBoard(md, repo);

  // Enrich PR refs with live status (state/draft/dates) from gh, and compute each card's ship date.
  const prMap = fetchPRs(repo);
  const byBranch = {};
  for (const pr of Object.values(prMap)) if (pr.headRefName) byBranch[pr.headRefName] = pr;
  const applyMeta = (pr, meta) => {
    pr.state = meta.state; pr.draft = meta.isDraft; pr.mergedAt = meta.mergedAt; pr.createdAt = meta.createdAt;
    pr.url = pr.url || meta.url; pr.num = pr.num || String(meta.number);
  };
  // A card with a `#<feature_id>` tag but no explicit `#<num>`: infer its PR from the branch
  // `<...>/<feature_id>` (the old cards predate "always write the PR number"). Marked inferred.
  const inferPR = tags => {
    for (const t of tags) {
      const hit = byBranch[`feature/${t}`] || Object.values(prMap).find(p => p.headRefName && p.headRefName.endsWith(`/${t}`));
      if (hit) return { num: String(hit.number), inferred: true };
    }
    return null;
  };

  for (const col of columns) {
    for (const card of col.cards) {
      if (card.prs.length === 0) {
        const inf = inferPR(card.tags);
        if (inf) card.prs.push(inf);
      }
      let latest = null;
      for (const pr of card.prs) {
        const meta = prMap[pr.num];
        if (meta) {
          applyMeta(pr, meta);
          const d = meta.mergedAt || meta.createdAt;
          if (d && (!latest || d > latest)) latest = d;
        }
      }
      card.shipDate = latest; // ISO string of the newest merge/creation among the card's PRs
    }
    // Shipped column: most-recently-shipped first (cards without a date sink to the bottom).
    if (/shipped/i.test(col.name)) {
      col.cards.sort((a, b) => (b.shipDate || '').localeCompare(a.shipDate || ''));
    }
  }

  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  return { enabled: true, name, boardRel: entry.board, prSource: Object.keys(prMap).length ? 'gh' : 'none', columns, total };
}

module.exports = { kanban };
