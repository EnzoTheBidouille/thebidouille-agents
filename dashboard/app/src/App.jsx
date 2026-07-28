import React, { useEffect, useState } from 'react';
import { getJson } from './api.js';
import FleetView from './components/FleetView.jsx';
import ProjectDetail from './components/ProjectDetail.jsx';

export default function App() {
  const [fleet, setFleet] = useState(null);
  const [core, setCore] = useState(null); // global core + npm latest (from /api/versions)
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  async function refreshFleet() {
    try {
      setError(null);
      const [f, v] = await Promise.all([getJson('/api/fleet'), getJson('/api/versions')]);
      setFleet(f.projects);
      setCore(v);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (selected) return; // detail view owns its own polling
    refreshFleet();
    const id = setInterval(refreshFleet, 15000);
    return () => clearInterval(id);
  }, [selected]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setSelected(null)} style={{ cursor: 'pointer' }}>
          <span className="dot" />
          cohorte <span className="muted">· dashboard</span>
        </div>
        {selected && (
          <button className="ghost" onClick={() => setSelected(null)}>← all projects</button>
        )}
      </header>

      {selected ? (
        <ProjectDetail project={selected} onBack={() => setSelected(null)} />
      ) : (
        <FleetView
          fleet={fleet}
          core={core}
          error={error}
          onOpen={setSelected}
          onChanged={refreshFleet}
        />
      )}
    </div>
  );
}
