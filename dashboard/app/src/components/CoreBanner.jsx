import React, { useState } from 'react';
import { freshnessBadge } from '../freshness.js';
import ActionRunner from './ActionRunner.jsx';

// Machine-wide core status: the GLOBAL core version vs npm latest, with a global update action.
export default function CoreBanner({ core, onChanged }) {
  const [runner, setRunner] = useState(null);

  if (!core) return <div className="core-banner muted">Loading core…</div>;

  const g = core.global || {};
  const badge = freshnessBadge({
    freshness: core.globalFreshness, // proper semver compare, done server-side
    latest: core.latest,
    installMode: g.present ? 'global' : 'none',
  });

  return (
    <div className="core-banner">
      <div className="cb-left">
        <span className="cb-title">Global core</span>
        <span className="cb-version mono">{g.present ? g.version : 'not installed'}</span>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        <span className="muted small">npm latest {core.latest || '—'}</span>
      </div>
      <div className="cb-actions">
        <button className="primary" onClick={() => setRunner('update')}>Update core…</button>
        {!g.present && <button className="ghost" onClick={() => setRunner('install')}>Install…</button>}
      </div>

      {runner && (
        <ActionRunner
          title={runner === 'update' ? 'Update global core' : 'Install global core'}
          action={runner}
          scope="global"
          onClose={() => setRunner(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
