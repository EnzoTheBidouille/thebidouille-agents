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
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    onChunk(buf.replace(/\n__EXIT__ \d+\n?/, ''));
  }
  const m = buf.match(/__EXIT__ (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
