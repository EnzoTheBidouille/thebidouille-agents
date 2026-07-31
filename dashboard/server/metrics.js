'use strict';
// Read a project's `.claude/pipeline-metrics.jsonl` (one line per phase batch, appended by
// /build, /review, /fix and /smoke) and aggregate it per feature: wall-clock per phase, fix
// rounds, and per-surface results. Dependency-free; a missing file is simply "no data yet".
//
// Two line formats coexist in the file:
//   new    {"ts","feature","phase","seconds",surfaces:{"<key>":"ok|error"|"<verdict>:<count>"}}
//   legacy {"ts","feature","phase","surface","seconds","result"}  — one line PER surface;
//          legacy lines are grouped by ts+feature+phase into one batch (wall-clock = max).

const fs = require('fs');
const path = require('path');

// `cycle` is the workflow variant's own batch (cycle.js §Close). Without it in this
// list its per-surface results parse fine but render in no column — the surface table
// showed rows with every cell empty.
const PHASES = ['build', 'review', 'fix', 'smoke', 'cycle'];

// Parse the raw JSONL into normalized batches ({ts, feature, phase, seconds, surfaces}),
// skipping malformed lines. Legacy per-surface lines are folded into their batch.
function parseBatches(raw) {
  const batches = [];
  const legacy = new Map(); // "ts|feature|phase" → batch (legacy lines share the key)
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== 'object' || !e.feature || !e.phase) continue;
    const seconds = Number(e.seconds) || 0;
    if (e.surfaces && typeof e.surfaces === 'object') {
      // `rounds` / `smoke` are run-level facts the cycle workflow reports alongside
      // (never inside) `surfaces` — carry them through for the aggregate.
      batches.push({
        ts: e.ts || '', feature: String(e.feature), phase: String(e.phase), seconds,
        surfaces: e.surfaces, rounds: e.rounds, smoke: e.smoke,
      });
    } else if (e.surface) {
      const key = `${e.ts}|${e.feature}|${e.phase}`;
      let b = legacy.get(key);
      if (!b) {
        b = { ts: e.ts || '', feature: String(e.feature), phase: String(e.phase), seconds: 0, surfaces: {} };
        legacy.set(key, b);
        batches.push(b);
      }
      b.surfaces[String(e.surface)] = e.result == null ? '' : String(e.result);
      b.seconds = Math.max(b.seconds, seconds); // batch wall-clock = the slowest surface
    }
    // lines with neither `surfaces` nor `surface` are malformed → skipped
  }
  return batches;
}

// A surface result string counts as a failure when it is "error" or a BLOCK/REVISE verdict
// (verdict lines look like "REVISE:2"), or a non-ok/pass word. "skipped" is neutral —
// the cycle workflow reports smoke:SKIPPED when the human opted out, not a failure.
function isFailure(result) {
  const head = String(result).split(':')[0].trim().toLowerCase();
  return head !== '' && head !== 'ok' && head !== 'ship' && head !== 'pass' && head !== 'skipped';
}

// Aggregate batches per feature (newest feature first).
function aggregate(batches) {
  const byFeature = new Map();
  for (const b of batches) {
    let f = byFeature.get(b.feature);
    if (!f) {
      f = {
        feature: b.feature,
        firstTs: b.ts, lastTs: b.ts,
        totalSeconds: 0,
        fixRounds: 0,
        phases: {}, // phase → { seconds, rounds }
        surfaces: {}, // surface → { phase → latest result }, plus failure count
      };
      byFeature.set(b.feature, f);
    }
    // cycle.js reports its round count outside `surfaces` (that map is for surfaces).
    if (b.phase === 'cycle' && Number(b.rounds) > 0) f.cycleRounds = Number(b.rounds);
    if (b.ts && (!f.firstTs || b.ts < f.firstTs)) f.firstTs = b.ts;
    if (b.ts && b.ts > f.lastTs) f.lastTs = b.ts;
    f.totalSeconds += b.seconds;
    const ph = f.phases[b.phase] || (f.phases[b.phase] = { seconds: 0, rounds: 0 });
    ph.seconds += b.seconds;
    ph.rounds += 1;
    if (b.phase === 'fix') f.fixRounds += 1;
    for (const [key, result] of Object.entries(b.surfaces)) {
      const s = f.surfaces[key] || (f.surfaces[key] = { results: {}, failures: 0 });
      s.results[b.phase] = result; // batches are appended in order → last write is the latest
      if (isFailure(result)) s.failures += 1;
    }
  }
  return [...byFeature.values()].sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''));
}

function metrics({ projectRoot }) {
  const file = path.join(projectRoot, '.claude', 'pipeline-metrics.jsonl');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return { present: false, phases: PHASES, features: [], batches: 0 }; }

  const batches = parseBatches(raw);
  return { present: true, phases: PHASES, features: aggregate(batches), batches: batches.length };
}

module.exports = { metrics };
