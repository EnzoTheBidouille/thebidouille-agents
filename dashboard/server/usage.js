'use strict';
// Serve the metrics collector's rollup (scripts/metrics/collect.mjs) to the dashboard:
// real cost and runtime per command, read from Claude Code's own transcripts.
//
// This is the SECOND metrics source in the cockpit, and the two answer different questions.
// `metrics.js` reads `.claude/pipeline-metrics.jsonl` — written by the model itself, so it
// carries per-surface verdicts (ok / REVISE:2 / error) that only the model knows, but it
// misses any run that ended early and can never report tokens. This one is derived from the
// transcripts, so it is complete and exact on cost and time but knows nothing about verdicts.
// Verdicts from one, money from the other; neither is a replacement for the other.
//
// The collector is ESM and this server is CommonJS, so it runs as a child process — the same
// bridge `bin/cli.js` uses. A spawn is ~1-2s on a large history, which is why the result is
// cached: the panel polls, and re-parsing tens of MB of transcripts on every poll would make
// the whole cockpit feel broken.

const path = require('path');
const { spawnSync } = require('child_process');

const COLLECT = path.join(__dirname, '..', '..', 'scripts', 'metrics', 'collect.mjs');

// Transcripts only grow, and nobody needs sub-minute freshness on a spend figure.
const CACHE_MS = 60_000;
const cache = new Map(); // projectRoot → { at, value }

function usage({ projectRoot, days = null, force = false }) {
  const key = `${projectRoot}|${days || ''}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const args = [COLLECT, projectRoot, '--json'];
  if (days) args.push(`--days=${days}`);

  let value;
  try {
    const r = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      // A pathological history must not wedge the cockpit's event loop forever.
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0 || !r.stdout) {
      value = { present: false, error: (r.stderr || '').trim().split('\n').slice(-1)[0] || 'collector failed' };
    } else {
      const parsed = JSON.parse(r.stdout);
      // No transcripts for this project is a normal state (a fresh checkout, or a project
      // driven from another machine), not an error — say so rather than rendering zeros
      // that look like "this pipeline is free".
      value = parsed.totals && parsed.totals.sessions
        ? { present: true, ...parsed }
        : { present: false, error: 'no Claude Code transcripts found for this project' };
    }
  } catch (e) {
    value = { present: false, error: String((e && e.message) || e) };
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { usage };
