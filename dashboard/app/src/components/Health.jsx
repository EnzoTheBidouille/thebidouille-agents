import React from 'react';

const ICON = { ok: '✓', warn: '!', bad: '✕', skip: '–' };

// Health panel — the /cohorte-doctor checklist, live.
export default function Health({ checks, summary }) {
  if (!checks) {
    return (
      <section className="panel">
        <h2>Health</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="panel span2">
      <div className="panel-head">
        <h2>Health</h2>
        <div className="summary">
          {summary.bad > 0 && <span className="badge bad">{summary.bad} failing</span>}
          {summary.warn > 0 && <span className="badge warn">{summary.warn} warning</span>}
          <span className="badge ok">{summary.ok} ok</span>
          {summary.skip > 0 && <span className="badge neutral">{summary.skip} n/a</span>}
        </div>
      </div>

      <ul className="checks">
        {checks.map(c => (
          <li key={c.id} className={`check ${c.status}`}>
            <span className={`check-icon ${c.status}`}>{ICON[c.status]}</span>
            <div className="check-body">
              <div className="check-line">
                <span className="check-label">{c.label}</span>
                <span className="check-detail">{c.detail}</span>
              </div>
              {c.fix && <div className="check-fix">fix: <code>{c.fix}</code></div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
