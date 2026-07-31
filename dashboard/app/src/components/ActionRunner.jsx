import React, { useEffect, useRef, useState } from 'react';
import { streamAction } from '../api.js';

// Modal that runs an action and streams its output live. Confirms first (mutating action),
// then reads the chunked response body. `command` (a whitelisted slash-command) routes the
// server to the headless-Claude runner; otherwise it's a CLI install/update. `confirmText`
// overrides the default confirmation copy (e.g. the /init-pipeline warning).
export default function ActionRunner({ title, action, scope, project, command, confirmText, onClose, onChanged }) {
  const [status, setStatus] = useState('confirm'); // confirm → running → done
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
      const code = await streamAction({ action, scope, project, command }, setLog);
      setExit(code);
      setStatus('done');
      onChanged && onChanged();
    } catch (e) {
      setLog(l => `${l}\n[error] ${e.message}`);
      setExit(1);
      setStatus('done');
    }
  }

  const cmd = command
    ? `claude -p "${command}"   (cwd: ${project})`
    : `node cli.js ${action}${scope === 'global' ? ' --global' : project ? ` ${project}` : ''}`;

  return (
    <div className="modal-backdrop" onClick={status !== 'running' ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          {status === 'done' && (
            <span className={`badge ${exit === 0 ? 'ok' : 'bad'}`}>
              {exit === 0 ? 'success' : exit == null ? 'disconnected' : `exit ${exit}`}
            </span>
          )}
        </div>

        {status === 'confirm' ? (
          <>
            {confirmText
              ? <div className="confirm-text">{confirmText}</div>
              : <p className="muted">This runs the pipeline CLI and modifies files on disk:</p>}
            <pre className="cmd">{cmd}</pre>
            <div className="modal-actions">
              <button className="primary" onClick={run}>Run</button>
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
