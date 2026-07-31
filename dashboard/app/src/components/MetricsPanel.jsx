import React from 'react';

// Mirrors dashboard/server/metrics.js PHASES — `cycle` is the workflow variant's
// own batch, and a phase missing here renders in no column at all.
const PHASES = ['build', 'review', 'fix', 'smoke', 'cycle'];

function fmtSeconds(s) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// A surface result reads as a failure when it isn't ok/ship/pass ("error", "REVISE:2", "BLOCK:1"…).
function resultClass(result) {
  const head = String(result).split(':')[0].trim().toLowerCase();
  if (head === '' ) return 'neutral';
  if (head === 'ok' || head === 'ship' || head === 'pass') return 'ok';
  if (head === 'revise') return 'warn';
  return 'bad';
}

// Pipeline timings per feature (from .claude/pipeline-metrics.jsonl): wall-clock per phase,
// fix rounds, and per-surface results. Presentational — data is fetched by ProjectDetail.
export default function MetricsPanel({ data }) {
  if (!data) {
    return (
      <section className="panel span2">
        <h2>Pipeline metrics</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const features = data.features || [];
  return (
    <section className="panel span2">
      <div className="panel-head">
        <h2>Pipeline metrics <span className="muted small">· wall-clock per phase</span></h2>
        {data.present && <span className="badge neutral">{data.batches} batches</span>}
      </div>

      {(!data.present || features.length === 0) ? (
        <p className="muted">
          No metrics yet — <code>/build</code>, <code>/review</code>, <code>/fix</code> and{' '}
          <code>/smoke</code> append them to <code>.claude/pipeline-metrics.jsonl</code>.
        </p>
      ) : (
        <div className="board-scroll">
          <div className="metrics-list">
            {features.map(f => <FeatureMetrics key={f.feature} f={f} />)}
          </div>
        </div>
      )}
    </section>
  );
}

function FeatureMetrics({ f }) {
  const max = Math.max(1, ...PHASES.map(p => (f.phases[p] ? f.phases[p].seconds : 0)));
  const surfaceKeys = Object.keys(f.surfaces || {});
  return (
    <div className="metric-feature">
      <div className="mf-head">
        <span className="mf-name">{f.feature}</span>
        <span className="mf-badges">
          <span className="badge neutral">total {fmtSeconds(f.totalSeconds)}</span>
          <span className={`badge ${f.fixRounds > 1 ? 'warn' : 'neutral'}`}>
            {f.fixRounds} fix round{f.fixRounds === 1 ? '' : 's'}
          </span>
          {f.cycleRounds > 0 && (
            <span className="badge neutral" title="verify→fix rounds inside the cycle workflow">
              cycle ×{f.cycleRounds}
            </span>
          )}
        </span>
      </div>

      <div className="phase-bars">
        {PHASES.map(p => {
          const ph = f.phases[p];
          return (
            <div key={p} className="phase-row" title={ph ? `${ph.rounds} run${ph.rounds === 1 ? '' : 's'}` : 'not run'}>
              <span className="phase-label">{p}</span>
              <span className="phase-track">
                {ph && <span className="phase-fill" style={{ width: `${(ph.seconds / max) * 100}%` }} />}
              </span>
              <span className="phase-value muted small">
                {ph ? `${fmtSeconds(ph.seconds)}${ph.rounds > 1 ? ` ×${ph.rounds}` : ''}` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {surfaceKeys.length > 0 && (
        <table className="surface-table">
          <thead>
            <tr>
              <th>surface</th>
              {PHASES.map(p => <th key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {surfaceKeys.map(key => (
              <tr key={key}>
                <td className="st-key">{key}</td>
                {PHASES.map(p => {
                  const r = f.surfaces[key].results[p];
                  return (
                    <td key={p}>
                      {r == null
                        ? <span className="muted">·</span>
                        : <span className={`pill ${resultClass(r)}`}>{r}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
