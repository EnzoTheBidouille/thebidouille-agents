import React, { useState } from 'react';
import { sendJson } from '../api.js';
import ProjectCard from './ProjectCard.jsx';
import CoreBanner from './CoreBanner.jsx';
import FolderPicker from './FolderPicker.jsx';

// Fleet overview: global core banner + the tracked projects + an add form / folder picker.
export default function FleetView({ fleet, core, error, onOpen, onChanged }) {
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [picking, setPicking] = useState(false);

  async function submit(p) {
    if (!p || !p.trim()) return;
    setAdding(true);
    setAddErr(null);
    try {
      await sendJson('/api/projects', 'POST', { path: p.trim() });
      setPath('');
      onChanged();
    } catch (e) {
      setAddErr(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(p) {
    try { await sendJson('/api/projects', 'DELETE', { path: p }); onChanged(); }
    catch (e) { setAddErr(e.message); }
  }

  return (
    <main className="fleet">
      <CoreBanner core={core} onChanged={onChanged} />

      <div className="fleet-head">
        <h2>Tracked projects {fleet && <span className="badge neutral">{fleet.length}</span>}</h2>
        <div className="add-wrap">
          <form className="add-form" onSubmit={e => { e.preventDefault(); submit(path); }}>
            <input
              className={`path-input${addErr ? ' invalid' : ''}`}
              placeholder="/absolute/path/to/a/pipeline/project"
              value={path}
              onChange={e => { setPath(e.target.value); if (addErr) setAddErr(null); }}
            />
            <button className="ghost" type="button" onClick={() => setPicking(true)}>Browse…</button>
            <button className="primary" type="submit" disabled={adding}>{adding ? 'adding…' : '+ add'}</button>
          </form>
          {addErr && <div className="add-error">⚠ {addErr}</div>}
        </div>
      </div>

      {error && <div className="panel error">API error — {error}</div>}

      {!fleet && <div className="panel muted">Loading fleet…</div>}
      {fleet && fleet.length === 0 && (
        <div className="panel muted">No projects tracked yet — add one above.</div>
      )}

      <div className="fleet-grid">
        {fleet && fleet.map(p => (
          <ProjectCard key={p.path} p={p} onOpen={() => onOpen(p.path)} onRemove={() => remove(p.path)} />
        ))}
      </div>

      {picking && (
        <FolderPicker
          onClose={() => setPicking(false)}
          onPick={p => { setPicking(false); submit(p); }}
        />
      )}
    </main>
  );
}
