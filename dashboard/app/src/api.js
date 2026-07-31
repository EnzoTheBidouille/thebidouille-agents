// Tiny fetch helpers against the local dashboard API.

async function parseError(res) {
  let detail = '';
  try { detail = (await res.json()).error || ''; } catch { /* ignore */ }
  return detail || `${res.status} ${res.statusText}`;
}

export async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function sendJson(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// POST /api/action and stream the chunked log. Calls onChunk(text) as output arrives
// (the __EXIT__ marker is stripped). Resolves to the exit code (or null if absent).
export async function streamAction(body, onChunk) {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(await parseError(res));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  // The marker is only trusted at the END of the buffer: the stream relays raw
  // child stdout (claude logs, installer output), which may legitimately quote
  // "__EXIT__ N" mid-stream — an unanchored match would mis-report the exit code.
  const stripMarker = s => s.replace(/\n__EXIT__ \d+\s*$/, '');
  // A headless `claude -p --verbose` run emits megabytes. The log is a scrollback
  // pane, not an archive: keep the tail so neither the string nor the <pre> grows
  // without bound (onChunk re-renders the WHOLE buffer on every chunk).
  const MAX_CHARS = 400_000;
  let trimmed = false;
  const clamp = () => {
    if (buf.length <= MAX_CHARS) return;
    buf = buf.slice(buf.length - MAX_CHARS);
    trimmed = true;
  };
  const emit = () => onChunk((trimmed ? '… [earlier output trimmed]\n' : '') + stripMarker(buf));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    clamp();
    emit();
  }
  buf += dec.decode(); // flush a multi-byte char split at the final chunk boundary
  clamp();
  emit();
  const m = buf.match(/__EXIT__ (\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}
