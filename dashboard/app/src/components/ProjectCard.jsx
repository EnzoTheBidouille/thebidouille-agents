import React from 'react';
import { freshnessBadge } from '../freshness.js';

// One tracked project at a glance: name, freshness, health summary, quick counts.
export default function ProjectCard({ p, onOpen, onRemove }) {
  if (!p.exists) {
    return (
      <div className="project-card gone">
        <div className="pc-head">
          <span className="pc-name">{shorten(p.path)}</span>
          <button className="icon-btn" title="remove" onClick={onRemove}>✕</button>
        </div>
        <p className="muted small">{p.error || 'path missing'}</p>
      </div>
    );
  }
  if (p.error) {
    return (
      <div className="project-card">
        <div className="pc-head">
          <span className="pc-name">{p.name}</span>
          <button className="icon-btn" title="remove" onClick={onRemove}>✕</button>
        </div>
        <p className="muted small">error: {p.error}</p>
      </div>
    );
  }

  const fresh = freshnessBadge(p.versions);
  const s = p.summary;

  return (
    <div className="project-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="pc-head">
        <span className="pc-name">{p.name}</span>
        <button
          className="icon-btn"
          title="stop tracking"
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >✕</button>
      </div>
      <div className="pc-path muted small mono">{shorten(p.path)}</div>

      <div className="pc-badges">
        <span className={`badge ${fresh.cls}`}>{fresh.label}</span>
        {!p.hasProfile && <span className="badge bad">no profile</span>}
      </div>

      <div className="pc-health">
        {s.bad > 0 && <span className="pill bad">{s.bad}</span>}
        {s.warn > 0 && <span className="pill warn">{s.warn}</span>}
        <span className="pill ok">{s.ok}</span>
        {s.skip > 0 && <span className="pill neutral">{s.skip}</span>}
        <span className="muted small pc-counts">{p.surfaces} surfaces · {p.specs} specs</span>
      </div>
    </div>
  );
}

function shorten(p) {
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
}
