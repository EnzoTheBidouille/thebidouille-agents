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
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  // Contain the path inside distDir (no traversal).
  const abs = path.join(distDir, path.normalize(rel));
  if (!abs.startsWith(distDir)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(abs, (err, buf) => {
    if (err) {
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

  const args = [path.join(pkgRoot, 'bin', 'cli.js'), action];
  if (scope === 'global') args.push('--global');
  else if (project) args.push(project);

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
function runClaude(req, res, body) {
  const project = body.project ? path.resolve(body.project) : null;
  const command = String(body.command || '');
  if (!/^\/(init-pipeline|update-pipeline)$/.test(command)) {
    return sendJson(res, 400, { error: 'unsupported command (only /init-pipeline or /update-pipeline)' });
  }
  if (!project || !fs.existsSync(project)) {
    return sendJson(res, 400, { error: 'project path not found' });
  }

  res.writeHead(200, STREAM_HEADERS);
  res.write(`$ claude -p "${command}"   (cwd: ${project})\n\n`);

  const args = ['-p', command, '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--verbose'];
  const child = spawn('claude', args, { cwd: project, env: process.env });
  child.stdout.on('data', d => res.write(d));
  child.stderr.on('data', d => res.write(d));
  child.on('close', code => { res.write(`\n__EXIT__ ${code == null ? 1 : code}\n`); res.end(); });
  child.on('error', err => {
    res.write(`\nspawn error: ${err.message}\n(is the \`claude\` CLI on PATH and authenticated?)\n__EXIT__ 1\n`);
    res.end();
  });
  req.on('close', () => { try { child.kill(); } catch { /* already gone */ } });
}

// Full project reset: back up the project's pipeline footprint (.claude/, PIPELINE.md, and
// optionally specs/) to .claude.bak-<ts>, remove it, then reinstall a fresh BUNDLED core (or,
// for global-mode projects, leave the shared ~/.claude core untouched). Never touches ~/.claude.
// Streams progress; ends with __EXIT__ <code>. The profile is regenerated by /init-pipeline after.
function runReset(req, res, body, { pkgRoot }) {
  const project = body.project ? path.resolve(body.project) : null;
  const purgeSpecs = !!body.purgeSpecs;
  if (!project || !fs.existsSync(project)) {
    return sendJson(res, 400, { error: 'project path not found' });
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
        log('\n✔ Reset complete. Now run  /init-pipeline  in Claude Code to regenerate PIPELINE.md + the surface agents.');
        done(code);
      });
      child.on('error', err => { log(`\nspawn error: ${err.message}`); done(1); });
      req.on('close', () => { try { child.kill(); } catch { /* already gone */ } });
    } else {
      log('\n✔ Reset complete. The shared global core stays installed in ~/.claude.');
      log('Now run  /init-pipeline  in Claude Code to regenerate this project\'s PIPELINE.md + agents.');
      done(0);
    }
  } catch (e) {
    log(`\nreset error: ${(e && e.message) || e}`);
    done(1);
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

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
        if (body.action === 'reset') return runReset(req, res, body, { pkgRoot });
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
