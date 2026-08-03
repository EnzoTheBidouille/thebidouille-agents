import React, { useEffect, useRef, useState } from 'react';
import { streamAction } from '../api.js';

// Destructive full reset of a project's pipeline footprint. Backs up first (always), then
// wipes .claude/ + PIPELINE.md (+ optionally specs/) and reinstalls a fresh core.
export default function ResetModal({ project, onClose, onChanged }) {
  const [status, setStatus] = useState('confirm'); // confirm → running → done
  const [purgeSpecs, setPurgeSpecs] = useState(false);
  const [log, setLog] = useState('');
  const [exit, setExit] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function run() {
    setStatus('running');
    setLog('');
    try {
      const code = await streamAction({ action: 'reset', project, purgeSpecs }, setLog);
      setExit(code);
      setStatus('done');
      onChanged && onChanged();
    } catch (e) {
      setLog(l => `${l}\n[error] ${e.message}`);
      setExit(1);
      setStatus('done');
    }
  }

  return (
    <div className="modal-backdrop" onClick={status !== 'running' ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚠ Reset pipeline</h3>
          {status === 'done' && (
            <span className={`badge ${exit === 0 ? 'ok' : 'bad'}`}>
              {exit === 0 ? 'done' : exit == null ? 'disconnected' : `exit ${exit}`}
            </span>
          )}
        </div>

        {status === 'confirm' ? (
          <>
            <p>This wipes the project's pipeline footprint so it's managed <strong>only</strong> by the
              pipeline — removing any relics from old versions:</p>
            <ul className="reset-list">
              <li><code>.claude/</code> — core, rendered agents, gate-config, settings, pointer</li>
              <li><code>PIPELINE.md</code> — the profile</li>
              <li className={purgeSpecs ? '' : 'muted'}><code>specs/</code> — {purgeSpecs ? 'will be removed too' : 'kept'}</li>
            </ul>
            <p className="reset-note">
              Everything is first backed up to <code>.claude.bak-&lt;timestamp&gt;/</code> (reversible).
              The shared <code>~/.claude</code> global core is never touched. Afterwards, run
              <code> /cohorte-init-pipeline</code> in Claude Code to regenerate the profile.
            </p>
            <label className="reset-check">
              <input type="checkbox" checked={purgeSpecs} onChange={e => setPurgeSpecs(e.target.checked)} />
              Also remove <code>specs/</code> (your authored specs — kept in the backup)
            </label>
            <div className="modal-actions">
              <button className="danger" onClick={run}>Reset pipeline</button>
              <button className="ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <pre className="run-log" ref={logRef}>{log || '…'}</pre>
            <div className="modal-actions">
              <button className="ghost" onClick={onClose} disabled={status === 'running'}>
                {status === 'running' ? 'running…' : 'Close'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
