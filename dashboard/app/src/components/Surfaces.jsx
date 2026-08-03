import React from 'react';

// Surfaces ↔ agents map, read from PIPELINE.md.
export default function Surfaces({ profile }) {
  if (!profile) {
    return (
      <section className="panel">
        <h2>Surfaces</h2>
        <p className="muted">No PIPELINE.md profile — run <code>/cohorte-init-pipeline</code>.</p>
      </section>
    );
  }
  const surfaces = profile.surfaces || [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Surfaces ↔ agents</h2>
        <span className="badge neutral">{surfaces.length}</span>
      </div>
      {profile.one_liner && <p className="muted small" style={{ marginTop: 0 }}>{profile.one_liner}</p>}
      <div className="surfaces">
        {surfaces.map(s => (
          <div key={s.key} className="surface">
            <div className="surface-top">
              <span className="surface-key">{s.label || s.key}</span>
              {s.model && <span className={`chip model-${s.model}`}>{s.model}</span>}
              {s.uses_design && <span className="chip design">design</span>}
            </div>
            <div className="surface-meta">
              <span className="mono">→ {s.agent}.md</span>
              <span className="muted mono">{s.path}</span>
            </div>
            {Array.isArray(s.tools) && (
              <div className="surface-tools">
                {s.tools.map(t => <span key={t} className="tool">{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
