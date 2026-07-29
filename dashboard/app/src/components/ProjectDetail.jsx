import React, { useEffect, useState } from 'react';
import { getJson } from '../api.js';
import Freshness from './Freshness.jsx';
import Health from './Health.jsx';
import Surfaces from './Surfaces.jsx';
import SpecsBoard from './SpecsBoard.jsx';
import KanbanBoard from './KanbanBoard.jsx';
import MetricsPanel from './MetricsPanel.jsx';
import ResetModal from './ResetModal.jsx';
import ActionRunner from './ActionRunner.jsx';

const INIT_WARNING = (
  <div>
    <p><strong>Runs Claude Code headless</strong> (<code>claude -p "/init-pipeline"</code>) in this
      project, autonomously (no permission prompts). It <strong>consumes tokens</strong> and needs the
      <code> claude</code> CLI authenticated.</p>
    <p className="warn-line">⚠ Headless skips the interactive interview — Claude <strong>guesses</strong> your
      stack, surfaces and gate instead of asking. <strong>Review the generated <code>PIPELINE.md</code></strong>
      afterwards.</p>
  </div>
);

const UPDATE_WARNING = (
  <div>
    <p><strong>Runs Claude Code headless</strong> (<code>claude -p "/update-pipeline"</code>) in this
      project, autonomously. It refreshes the core and reconciles the generated files (re-renders agents,
      patches settings). <strong>Consumes tokens</strong>; needs the <code>claude</code> CLI authenticated.</p>
  </div>
);

// Drill-down view for a single project.
export default function ProjectDetail({ project }) {
  const [state, setState] = useState(null);
  const [kanban, setKanban] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [runner, setRunner] = useState(null); // { title, command, confirmText }

  async function refresh() {
    const q = encodeURIComponent(project);
    const [st, kb, mt] = await Promise.allSettled([
      getJson(`/api/state?project=${q}`),
      getJson(`/api/kanban?project=${q}`),
      getJson(`/api/metrics?project=${q}`),
    ]);
    if (st.status === 'fulfilled') { setState(st.value); setError(null); } else setError(st.reason.message);
    setKanban(kb.status === 'fulfilled' ? kb.value : { enabled: false });
    setMetrics(mt.status === 'fulfilled' ? mt.value : { present: false, features: [], batches: 0 });
  }

  useEffect(() => {
    setState(null);
    setKanban(null);
    setMetrics(null);
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [project]);

  const v = state && state.versions;
  const hasProfile = !!(state && state.profile);
  // A pipeline "footprint" worth resetting: a profile, a bundled core, or a committed pointer.
  const hasFootprint = hasProfile || !!(v && (v.bundled.present || v.pointer.present));

  return (
    <main className="grid">
      <div className="detail-crumb">
        <span className="muted small mono">{project}</span>
        {state && (
          <div className="detail-tools">
            {!hasProfile && (
              <button className="tool-btn" onClick={() => setRunner({
                title: 'Init pipeline (headless Claude)', command: '/init-pipeline', confirmText: INIT_WARNING,
              })}>Init-pipeline…</button>
            )}
            {hasProfile && (
              <button className="tool-btn" onClick={() => setRunner({
                title: 'Update pipeline (headless Claude)', command: '/update-pipeline', confirmText: UPDATE_WARNING,
              })}>Update-pipeline…</button>
            )}
            {hasFootprint && (
              <button className="danger-ghost" onClick={() => setResetting(true)}>Reset pipeline…</button>
            )}
          </div>
        )}
      </div>
      {error && <div className="panel error">API error — {error}</div>}
      {!state && !error && <div className="panel muted">Loading pipeline state…</div>}
      <Freshness data={state && state.versions} />
      <Surfaces profile={state && state.profile} />
      <Health checks={state && state.checks} summary={state && state.summary} />
      <KanbanBoard data={kanban} />
      {/* Kanban supersedes the specs board — only show specs when there's no linked board. */}
      {kanban && !kanban.enabled && <SpecsBoard specs={state && state.specs} />}
      <MetricsPanel data={metrics} />

      {resetting && (
        <ResetModal project={project} onClose={() => setResetting(false)} onChanged={refresh} />
      )}
      {runner && (
        <ActionRunner
          title={runner.title}
          action="claude"
          command={runner.command}
          confirmText={runner.confirmText}
          project={project}
          onClose={() => setRunner(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}
