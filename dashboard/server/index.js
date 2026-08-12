'use strict';
// Local dashboard HTTP server — dependency-free (node built-ins only).
// Serves the built React app from dashboard/dist and a small JSON API.
// Phase 0: GET /api/versions (freshness). Later phases add /api/state, /api/fleet, /api/action.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { versions } = require('./versions');
const { state } = require('./doctor');
const { kanban } = require('./kanban');
const { metrics } = require('./metrics');
const { usage } = require('./usage');
const fleet = require('./fleet');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

// Read + JSON-parse a request body (POST/DELETE), capped to avoid unbounded buffering.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (raw.trim() === '') return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function notBuiltPage(distDir) {
  return `<!doctype html><meta charset="utf-8"><title>dashboard — not built</title>
<body style="font:16px/1.6 ui-monospace,monospace;max-width:42rem;margin:4rem auto;padding:0 1rem;color:#ddd;background:#111">
<h1>Dashboard not built yet</h1>
<p>No <code>${distDir}</code> found. Build the React app once:</p>
<pre style="background:#000;padding:1rem;border-radius:8px;overflow:auto">npm --prefix dashboard/app install
npm --prefix dashboard/app run build</pre>
<p>Or, for live development, run the Vite dev server (<code>npm --prefix dashboard/app run dev</code>)
which proxies <code>/api</code> here.</p></body>`;
}

// Serve a static file from distDir; SPA-fallback to index.html for unknown routes.
function serveStatic(req, res, distDir) {
  let rel;
  // A malformed escape (`/%`) makes decodeURIComponent throw — a 400 is the honest
  // answer, not the caller's 500.
  try { rel = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  // Contain the path inside distDir (no traversal). Compare with the separator
  // appended: a bare startsWith would also accept a sibling `…/dist-something`.
  const abs = path.join(distDir, path.normalize(rel));
  if (abs !== distDir && !abs.startsWith(distDir + path.sep)) {
    res.writeHead(403); return res.end('forbidden');
  }

  fs.readFile(abs, (err, buf) => {
    if (err) {
      // A missing file WITH an extension is a real 404 (e.g. a stale cached
      // /assets/index-<oldhash>.js after an update) — serving index.html there
      // hands a module script text/html and it dies on an opaque MIME error.
      if (path.extname(abs)) { res.writeHead(404); return res.end('not found'); }
      // SPA fallback: hand index.html to the client router.
      const index = path.join(distDir, 'index.html');
      return fs.readFile(index, (e2, html) => {
        if (e2) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(notBuiltPage(distDir)); }
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const STREAM_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no', // defeat proxy buffering so lines stream live
};

// Run `cli.js install|update [target] [--global]` and stream its output back as a plain-text
// chunked response (the client reads it via fetch's ReadableStream). Ends with __EXIT__ <code>.
function runAction(req, res, body, { pkgRoot }) {
  const { action, scope, project } = body;
  if (action !== 'install' && action !== 'update') {
    return sendJson(res, 400, { error: "action must be 'install' or 'update'" });
  }
  // A project-scoped install writes <target>/.claude, and cli.js mkdir -p's the
  // target — so an unchecked path silently creates a pipeline tree in a directory
  // that does not exist (a typo in the fleet registry lands a phantom project on
  // disk). The other two runners already validate; this one never did.
  if (scope !== 'global' && project && !fs.existsSync(path.resolve(project))) {
    return sendJson(res, 400, { error: `project path not found: ${project}` });
  }

  const args = [path.join(pkgRoot, 'bin', 'cli.js'), action];
  if (scope === 'global') args.push('--global');
  else if (project) args.push(path.resolve(project));

  res.writeHead(200, STREAM_HEADERS);
  res.write(`$ node cli.js ${args.slice(1).join(' ')}\n\n`);

  const child = spawn(process.execPath, args, { cwd: pkgRoot, env: process.env });
  child.stdout.on('data', d => res.write(d));
  child.stderr.on('data', d => res.write(d));
  child.on('close', code => { res.write(`\n__EXIT__ ${code == null ? 1 : code}\n`); res.end(); });
  child.on('error', err => { res.write(`\nspawn error: ${err.message}\n__EXIT__ 1\n`); res.end(); });
  req.on('close', () => { try { child.kill(); } catch { /* already gone */ } });
}

// Run a pipeline slash-command through Claude Code headless (`claude -p`) in the project dir,
// streaming its output. The command is whitelisted (no arbitrary injection into claude -p) and
// runs autonomously (--dangerously-skip-permissions), so it never hangs waiting on a prompt.
// Headless caveat the UI warns about: the run starts without any confirmation prompt and there
// is no resume — if the claude process dies mid-run, the run is simply gone.
function runClaude(req, res, body) {
  const project = body.project ? path.resolve(body.project) : null;
  const command = String(body.command || '');
  if (!/^\/cohorte-(init-pipeline|update-pipeline|audit)$/.test(command)) {
    return sendJson(res, 400, { error: 'unsupported command (only /cohorte-init-pipeline, /cohorte-update-pipeline or /cohorte-audit)' });
  }
  if (!project || !fs.existsSync(project)) {
    return sendJson(res, 400, { error: 'project path not found' });
  }

  res.writeHead(200, STREAM_HEADERS);
  res.write(`$ claude -p "${command}"   (cwd: ${project})\n\n`);

  const args = ['-p', command, '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--verbose'];
  // shell on Windows: `claude` is a .cmd shim, which Node refuses to spawn
  // shell-less. Build ONE static string (no args array — that combination is
  // DEP0190-deprecated): `command` is regex-whitelisted above and nothing else
  // is request-supplied, so the shell adds no injection surface.
  const child = process.platform === 'win32'
    ? spawn(`claude ${args.map(a => (a.startsWith('/') ? `"${a}"` : a)).join(' ')}`, { cwd: project, env: process.env, shell: true })
    : spawn('claude', args, { cwd: project, env: process.env });
  child.stdout.on('data', d => res.write(d));
  child.stderr.on('data', d => res.write(d));
  child.on('close', code => { res.write(`\n__EXIT__ ${code == null ? 1 : code}\n`); res.end(); });
  child.on('error', err => {
    res.write(`\nspawn error: ${err.message}\n(is the \`claude\` CLI on PATH and authenticated?)\n__EXIT__ 1\n`);
    res.end();
  });
  req.on('close', () => { try { child.kill(); } catch { /* already gone */ } });
}

// Full project reset: back up the project's pipeline footprint (every runtime's dir, PIPELINE.md, and
// optionally specs/) to .claude.bak-<ts>, remove it, then reinstall a fresh BUNDLED core (or,
// for global-mode projects, leave the shared ~/.claude core untouched). Never touches ~/.claude.
// Streams progress; ends with __EXIT__ <code>. The profile is regenerated by /cohorte-init-pipeline after.
function runReset(req, res, body, { pkgRoot, globalDir }) {
  const project = body.project ? path.resolve(body.project) : null;
  const purgeSpecs = !!body.purgeSpecs;
  if (!project || !fs.existsSync(project)) {
    return sendJson(res, 400, { error: 'project path not found' });
  }
  // The whole promise of this endpoint — echoed in the modal's copy — is that the
  // shared global core is never touched. Nothing enforced it: reset moves
  // <project>/.claude, so a project of `~` (or wherever CLAUDE_CONFIG_DIR's parent
  // is) would move the global core itself into a backup dir, silently breaking
  // every repo on the machine. Refuse that path outright.
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (same(path.join(project, '.claude'), globalDir)) {
    return sendJson(res, 400, {
      error: `refusing to reset ${project}: its .claude IS the shared global core (${globalDir}). ` +
        'Reset only ever touches a project\'s own pipeline footprint.',
    });
  }

  res.writeHead(200, STREAM_HEADERS);
  const log = s => res.write(s + '\n');
  const done = code => { res.write(`\n__EXIT__ ${code == null ? 1 : code}\n`); res.end(); };

  try {
    const claudeDir = path.join(project, '.claude');
    const pipelineMd = path.join(project, 'PIPELINE.md');
    const specsDir = path.join(project, 'specs');

    // Detect the prior install mode before we move anything.
    let priorMode = 'unknown';
    const ptr = path.join(claudeDir, 'pipeline.json');
    if (fs.existsSync(ptr)) { try { priorMode = JSON.parse(fs.readFileSync(ptr, 'utf8')).mode || 'unknown'; } catch { /* keep unknown */ } }
    const hadBundledCore = fs.existsSync(path.join(claudeDir, 'pipeline', 'VERSION'));
    const bundled = priorMode === 'bundled' || (priorMode === 'unknown' && hadBundledCore);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(project, `.claude.bak-${ts}`);
    fs.mkdirSync(backup, { recursive: true });
    log(`Backing up the project's pipeline footprint → ${path.basename(backup)}/`);

    let moved = 0;
    if (fs.existsSync(claudeDir)) { fs.renameSync(claudeDir, path.join(backup, '.claude')); log('  · moved .claude/'); moved++; }
    // A repo installed for another coding agent keeps its footprint elsewhere. Leaving these
    // behind would make a "full reset" silently partial: the old rendered commands survive and
    // the fresh install lands next to them.
    for (const d of ['.cohorte', '.agents', '.cursor', '.gemini', '.opencode', '.codex']) {
      const from = path.join(project, d);
      if (!fs.existsSync(from)) continue;
      fs.renameSync(from, path.join(backup, d));
      log(`  · moved ${d}/`);
      moved++;
    }
    if (fs.existsSync(pipelineMd)) { fs.renameSync(pipelineMd, path.join(backup, 'PIPELINE.md')); log('  · moved PIPELINE.md'); moved++; }
    if (purgeSpecs && fs.existsSync(specsDir)) { fs.renameSync(specsDir, path.join(backup, 'specs')); log('  · moved specs/'); moved++; }
    if (!moved) log('  · nothing to move (no .claude/ or PIPELINE.md found)');

    log(`\nPrior mode: ${bundled ? 'bundled' : 'global'} — the shared ~/.claude core is never touched.`);

    if (bundled) {
      log('\nReinstalling a fresh bundled core…\n');
      const args = [path.join(pkgRoot, 'bin', 'cli.js'), 'install', project];
      const child = spawn(process.execPath, args, { cwd: pkgRoot, env: process.env });
      child.stdout.on('data', d => res.write(d));
      child.stderr.on('data', d => res.write(d));
      child.on('close', code => {
        log('\n✔ Reset complete. Now run  /cohorte-init-pipeline  in Claude Code to regenerate PIPELINE.md + the surface agents.');
        done(code);
      });
      child.on('error', err => { log(`\nspawn error: ${err.message}`); done(1); });
      req.on('close', () => { try { child.kill(); } catch { /* already gone */ } });
    } else {
      log('\n✔ Reset complete. The shared global core stays installed in ~/.claude.');
      log('Now run  /cohorte-init-pipeline  in Claude Code to regenerate this project\'s PIPELINE.md + agents.');
      done(0);
    }
  } catch (e) {
    log(`\nreset error: ${(e && e.message) || e}`);
    done(1);
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// Browser-facing guard for the API. Loopback binding is NOT a security boundary
// against a browser: any web page the user visits can fire form/fetch requests at
// 127.0.0.1 (CSRF), and DNS rebinding can even make the responses readable. Two
// checks close both without needing a token round-trip:
//   - Host must be a loopback origin (kills rebinding — an attacker-controlled
//     domain resolving to 127.0.0.1 still sends its own Host header). Skipped
//     when the user explicitly bound a non-loopback host (they were warned).
//   - State-changing methods must carry content-type: application/json. A
//     cross-origin fetch with that header triggers a CORS preflight, which this
//     server never answers — so a browser can't deliver it cross-origin; forms
//     can only send urlencoded/multipart/text.
function guardBrowser(req, res, bindHost) {
  if (LOOPBACK.has(bindHost)) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!LOOPBACK.has(host)) {
      sendJson(res, 403, { error: `forbidden host header: ${req.headers.host || '(none)'}` });
      return false;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') {
      sendJson(res, 403, { error: 'state-changing requests require content-type: application/json' });
      return false;
    }
  }
  return true;
}

// Best-effort browser open (opt-in via --open). Never throws; failure is silent.
function openBrowserAt(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); }
  catch { /* no opener available */ }
}

function start({ projectRoot, globalDir, port, host, openBrowser, pkgRoot, version }) {
  const distDir = path.join(pkgRoot, 'dashboard', 'dist');
  const bindHost = host || '127.0.0.1';
  try { fleet.ensureSeed(globalDir, projectRoot); } catch { /* registry is best-effort */ }

  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    try {
      if (url.startsWith('/api/') && !guardBrowser(req, res, bindHost)) return;
      if (url === '/api/versions') {
        return sendJson(res, 200, await versions({ projectRoot, globalDir, cliVersion: version }));
      }
      if (url === '/api/state') {
        // ?project=<abs path> overrides the launch cwd (fleet-ready); default = launch project.
        const q = new URL(req.url, 'http://localhost').searchParams.get('project');
        const root = q ? path.resolve(q) : projectRoot;
        return sendJson(res, 200, await state({ projectRoot: root, globalDir, cliVersion: version }));
      }
      if (url === '/api/fleet') {
        return sendJson(res, 200, { projects: await fleet.list(globalDir, version) });
      }
      if (url === '/api/browse') {
        const dir = new URL(req.url, 'http://localhost').searchParams.get('dir');
        return sendJson(res, 200, fleet.browse(dir));
      }
      if (url === '/api/kanban') {
        const q = new URL(req.url, 'http://localhost').searchParams.get('project');
        const root = q ? path.resolve(q) : projectRoot;
        return sendJson(res, 200, kanban({ projectRoot: root, globalDir }));
      }
      if (url === '/api/metrics') {
        const q = new URL(req.url, 'http://localhost').searchParams.get('project');
        const root = q ? path.resolve(q) : projectRoot;
        return sendJson(res, 200, metrics({ projectRoot: root, globalDir }));
      }
      if (url === '/api/usage') {
        const q = new URL(req.url, 'http://localhost');
        const root = q.searchParams.get('project') ? path.resolve(q.searchParams.get('project')) : projectRoot;
        const days = Number(q.searchParams.get('days')) || null;
        return sendJson(res, 200, usage({ projectRoot: root, days }));
      }
      if (url === '/api/projects') {
        const body = await readBody(req);
        if (req.method === 'POST') {
          if (!body.path) return sendJson(res, 400, { error: 'path is required' });
          let abs;
          try { abs = fleet.add(globalDir, body.path); }
          catch (e) { return sendJson(res, 400, { error: String((e && e.message) || e) }); }
          return sendJson(res, 200, { added: abs, projects: await fleet.list(globalDir, version) });
        }
        if (req.method === 'DELETE') {
          if (!body.path) return sendJson(res, 400, { error: 'path is required' });
          fleet.remove(globalDir, body.path);
          return sendJson(res, 200, { removed: body.path, projects: await fleet.list(globalDir, version) });
        }
        return sendJson(res, 405, { error: 'use POST to add, DELETE to remove' });
      }
      if (url === '/api/action' && req.method === 'POST') {
        let body;
        try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        if (body.action === 'reset') return runReset(req, res, body, { pkgRoot, globalDir });
        if (body.action === 'claude') return runClaude(req, res, body);
        return runAction(req, res, body, { pkgRoot });
      }
      if (url.startsWith('/api/')) {
        return sendJson(res, 404, { error: `unknown endpoint: ${url}` });
      }
      return serveStatic(req, res, distDir);
    } catch (err) {
      return sendJson(res, 500, { error: String(err && err.message || err) });
    }
  });

  server.listen(port, bindHost, () => {
    const shownHost = LOOPBACK.has(bindHost) ? 'localhost' : bindHost;
    const url = `http://${shownHost}:${port}`;
    console.log(`\n  cohorte dashboard  v${version}`);
    console.log(`  ┌${'─'.repeat(url.length + 10)}┐`);
    console.log(`  │  open  ${url}  │`);
    console.log(`  └${'─'.repeat(url.length + 10)}┘`);
    console.log(`  project : ${projectRoot}`);
    console.log(`  bind    : ${bindHost}:${port}`);
    if (!LOOPBACK.has(bindHost)) {
      console.log('  ⚠ SECURITY: bound to a non-loopback address — the dashboard\'s actions execute');
      console.log('    code (install/update/reset/claude). Anyone who can reach this host+port can');
      console.log('    run them. Only do this on a trusted network.');
    }
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.log('  note    : React app not built yet — run  npm --prefix dashboard/app run build');
    }
    console.log('  (Ctrl-C to stop)\n');
    if (openBrowser) openBrowserAt(url);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`error: port ${port} is in use — pass another with --port=<N>`);
      process.exit(1);
    }
    throw err;
  });
}

module.exports = start;
