import React from 'react';

// Mirrors SCHEMA.md §Spec status — `in-progress` (a /drive is driving this spec) and
// `blocked` (a /drive gave up on it) are terminal-ish states the driver writes, and the
// board is where a human notices a loop that died mid-flight.
const STAGES = [
  { key: 'draft', label: 'Draft' },
  { key: 'frozen', label: 'Frozen' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'in-review', label: 'In review' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'blocked', label: 'Blocked' },
];

// Kanban of specs by lifecycle stage (front-matter `status`).
export default function SpecsBoard({ specs }) {
  if (!specs) {
    return (
      <section className="panel span2">
        <h2>Specs board</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const byStage = {};
  for (const st of STAGES) byStage[st.key] = [];
  const other = [];
  for (const s of specs) {
    if (byStage[s.status]) byStage[s.status].push(s);
    else other.push(s);
  }

  return (
    <section className="panel span2">
      <div className="panel-head">
        <h2>Specs board</h2>
        <span className="badge neutral">{specs.length}</span>
      </div>

      {specs.length === 0 ? (
        <p className="muted">No specs yet — run <code>/spec</code> to freeze one.</p>
      ) : (
        <div className="board-scroll">
          <div className="board">
            {STAGES.map(st => (
              <div key={st.key} className={`col col-${st.key}`}>
                <div className="col-head">
                  <span>{st.label}</span>
                  <span className="muted">{byStage[st.key].length}</span>
                </div>
                {byStage[st.key].map(s => <SpecCard key={s.file} s={s} />)}
              </div>
            ))}
            {other.length > 0 && (
              <div className="col col-other">
                <div className="col-head"><span>Other</span><span className="muted">{other.length}</span></div>
                {other.map(s => <SpecCard key={s.file} s={s} bad />)}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SpecCard({ s, bad }) {
  return (
    <div className={`spec-card${bad ? ' bad' : ''}`}>
      <div className="spec-title">{s.title || s.id}</div>
      <div className="spec-meta muted small mono">
        {s.id}{bad && s.status ? ` · status: ${s.status}` : ''}
      </div>
      {s.loop && (
        <div className="spec-loop muted small mono">
          ↻ pass {s.loop.pass}{s.loop.phase ? ` · /${s.loop.phase}` : ''} — resume with <code>--resume</code>
        </div>
      )}
      {s.branch && <div className="spec-branch muted small mono">⑂ {s.branch}</div>}
    </div>
  );
}
