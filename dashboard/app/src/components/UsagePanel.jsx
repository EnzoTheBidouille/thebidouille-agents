import React from 'react';

// Real cost and runtime per command, from /api/usage (scripts/metrics/collect.mjs reading
// Claude Code's own transcripts). Sibling of MetricsPanel, deliberately NOT a replacement:
// MetricsPanel shows per-surface verdicts, which only the model knows and the transcripts
// never contain; this shows money and time, which the model cannot report and the
// transcripts record exactly. Presentational — ProjectDetail fetches the data.

const fmtUsd = (n) =>
  n == null ? '—' : n >= 100 ? `$${Math.round(n)}` : n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;

const fmtTok = (n) =>
  n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

const fmtDur = (s) =>
  s == null ? '—' : s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`;

export default function UsagePanel({ data }) {
  if (!data) {
    return (
      <section className="panel span2">
        <h2>Cost &amp; runtime</h2>
        <p className="muted">Reading transcripts…</p>
      </section>
    );
  }

  if (!data.present) {
    return (
      <section className="panel span2">
        <h2>Cost &amp; runtime</h2>
        <p className="muted">
          {data.error || 'No data.'} Figures come from Claude Code&apos;s own transcripts in{' '}
          <code>~/.claude/projects</code> — nothing to enable, but the project has to have been
          driven from this machine.
        </p>
      </section>
    );
  }

  const { totals, commands = [] } = data;
  // The catch-all is real spend and must be shown, but it is not a command — keep it last so
  // it never sits at the top of a list people read as a ranking of the pipeline.
  const rows = [...commands].sort((a, b) => {
    if ((a.command === '(chat)') !== (b.command === '(chat)')) return a.command === '(chat)' ? 1 : -1;
    return b.cost.total - a.cost.total;
  });
  const max = Math.max(...rows.map((r) => r.cost.total), 0.01);

  return (
    <section className="panel span2">
      <div className="panel-head">
        <h2>Cost &amp; runtime <span className="muted small">· from Claude Code transcripts</span></h2>
        <span className="badge neutral">{fmtUsd(totals.cost)} total</span>
      </div>

      <p className="muted small">
        {totals.runs} runs · {totals.sessions} sessions · {totals.agents} subagents · prices as of{' '}
        {data.pricesUpdated}. Wall is elapsed; active drops gaps longer than{' '}
        {Math.round((data.idleGapSeconds || 120) / 60)} min.
      </p>

      <div className="usage-list">
        <div className="usage-row usage-head">
          <span>command</span>
          <span className="usage-num">runs</span>
          <span className="usage-num">$/run</span>
          <span className="usage-bar-head">$ total</span>
          <span className="usage-num">tok/run</span>
          <span className="usage-num">wall</span>
          <span className="usage-num" title="Elapsed minus idle gaps — the time the command was actually working.">active</span>
          <span className="usage-num" title="Median subagents per run. A build or review reporting 0 did no fan-out at all.">agents</span>
        </div>
        {rows.map((r) => {
          const tokens = Object.values(r.tokensPerRun || {}).reduce((a, b) => a + b, 0);
          return (
            <div key={r.command} className={`usage-row${r.command === '(chat)' ? ' usage-chat' : ''}`}>
              <span className="usage-cmd">{r.command}</span>
              <span className="usage-num">{r.runs}</span>
              <span className="usage-num">{fmtUsd(r.cost.perRun)}</span>
              <span className="usage-bar" title={fmtUsd(r.cost.total)}>
                <span className="usage-fill" style={{ width: `${Math.max(2, (r.cost.total / max) * 100)}%` }} />
                <span className="usage-bar-label">{fmtUsd(r.cost.total)}</span>
              </span>
              <span className="usage-num">{fmtTok(tokens)}</span>
              <span className="usage-num">{fmtDur(r.wallS.p50)}</span>
              <span className="usage-num">{fmtDur(r.activeS.p50)}</span>
              <span className="usage-num">{r.agents.perRunP50}</span>
            </div>
          );
        })}
      </div>

      <p className="muted small">
        <code>(chat)</code> is every turn that named no command. Attributing a command typed
        inside a sentence is a heuristic — a long message that merely discusses one is not
        counted as running it.
      </p>
    </section>
  );
}
