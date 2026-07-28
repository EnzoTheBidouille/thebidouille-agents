import React from 'react';
import { freshnessBadge } from '../freshness.js';

// Freshness panel — installed core vs npm latest, install mode, pointer. Informational only:
// the update actions live in the toolbar (Update-pipeline, which also reconciles) and the fleet
// Core banner (the shared global core) — so this card doesn't duplicate them.
export default function Freshness({ data }) {
  if (!data) {
    return (
      <section className="panel">
        <h2>Freshness</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  const { installedVersion, latest, freshness, installMode, pointer, global, bundled } = data;
  const badge = freshnessBadge({ freshness, latest, installMode });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Freshness</h2>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="rows">
        <Row label="Installed core" value={installedVersion || '—'} strong />
        <Row label="Latest on npm" value={latest || 'unreachable'} />
        <Row label="Install mode" value={installMode} />
        {global.present && <Row label="Global core" value={global.version} mono />}
        {bundled.present && <Row label="Bundled core" value={bundled.version} mono />}
        {pointer.present && (
          <Row label="Repo pointer" value={`${pointer.mode || '?'} · core ${pointer.core_version || '?'}`} mono />
        )}
      </div>

      {freshness === -1 && (
        <p className="muted small fresh-hint">
          → run <strong>Update-pipeline</strong> (above) to refresh the core and reconcile this project.
        </p>
      )}
    </section>
  );
}

function Row({ label, value, strong, mono }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={`row-value${strong ? ' strong' : ''}${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}
