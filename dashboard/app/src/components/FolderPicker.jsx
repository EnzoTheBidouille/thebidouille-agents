import React, { useEffect, useState } from 'react';
import { getJson } from '../api.js';

// Server-side folder browser. Navigate directories, then "Add this folder".
export default function FolderPicker({ onPick, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function load(dir) {
    try {
      setError(null);
      setData(await getJson('/api/browse' + (dir ? `?dir=${encodeURIComponent(dir)}` : '')));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Pick a project folder</h3>
          {data && data.isProject && <span className="badge ok">pipeline project</span>}
        </div>

        <div className="picker-path mono small">{data ? data.dir : 'loading…'}</div>
        {error && <div className="add-error">⚠ {error}</div>}

        <div className="picker-list">
          {data && data.parent && (
            <button className="picker-row up" onClick={() => load(data.parent)}>↑ ..</button>
          )}
          {data && data.dirs.length === 0 && <div className="muted small picker-empty">no sub-folders</div>}
          {data && data.dirs.map(d => (
            <button key={d.path} className="picker-row" onClick={() => load(d.path)}>
              <span className="picker-icon">{d.isProject ? '◆' : '▸'}</span>
              <span className="picker-name">{d.name}</span>
              {d.isProject && <span className="badge ok small">project</span>}
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="primary" disabled={!data} onClick={() => onPick(data.dir)}>
            Add this folder
          </button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
