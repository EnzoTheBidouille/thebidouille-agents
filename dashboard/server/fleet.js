'use strict';
// Fleet registry — the set of projects the dashboard tracks. Persisted in
// ~/.claude/cohorte-dashboard.json (user-scoped, machine-wide). Each /api/fleet call
// runs a compact doctor pass per project so the overview shows freshness + health at a glance.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { state } = require('./doctor');

// Expand a leading ~ and require an absolute path — resolving a bare name against the
// server's cwd is surprising ("samo" → <repo>/samo), so reject it with a clear message.
function normalizeDir(dir) {
  let d = String(dir || '').trim();
  if (d === '~' || d.startsWith('~/')) d = path.join(os.homedir(), d.slice(1));
  if (!path.isAbsolute(d)) {
    throw new Error(`path must be absolute (got "${dir}") — e.g. ${path.join(os.homedir(), 'projects', 'my-app')}`);
  }
  return d;
}

function registryPath(globalDir) {
  return path.join(globalDir, 'cohorte-dashboard.json');
}

function read(globalDir) {
  // cohorte-dashboard.json, then the pre-rename legacy name (read-only fallback; the next
  // write() migrates the registry forward to the new path).
  for (const n of ['cohorte-dashboard.json', 'thebidouille-dashboard.json']) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(globalDir, n), 'utf8'));
      if (Array.isArray(data.projects)) return data.projects;
    } catch { /* try next */ }
  }
  return [];
}

function write(globalDir, projects) {
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(registryPath(globalDir), JSON.stringify({ projects }, null, 2) + '\n');
}

// Add the launch project on first use so the fleet is never empty.
function ensureSeed(globalDir, projectRoot) {
  const projects = read(globalDir);
  if (projectRoot && !projects.includes(projectRoot)) {
    projects.push(projectRoot);
    write(globalDir, projects);
  }
}

function add(globalDir, dir) {
  const abs = normalizeDir(dir);
  if (!fs.existsSync(abs)) throw new Error(`path not found: ${abs}`);
  if (!fs.statSync(abs).isDirectory()) throw new Error(`not a directory: ${abs}`);
  const projects = read(globalDir);
  if (!projects.includes(abs)) { projects.push(abs); write(globalDir, projects); }
  return abs;
}

function remove(globalDir, dir) {
  const abs = path.resolve(dir);
  const projects = read(globalDir).filter(p => p !== abs);
  write(globalDir, projects);
}

// Compact per-project summary for the overview cards.
async function summarize(projectRoot, globalDir, cliVersion) {
  if (!fs.existsSync(projectRoot)) {
    return { path: projectRoot, exists: false, error: 'path no longer exists' };
  }
  try {
    const s = await state({ projectRoot, globalDir, cliVersion });
    return {
      path: projectRoot,
      exists: true,
      name: (s.profile && s.profile.name) || path.basename(projectRoot),
      hasProfile: !!s.profile,
      surfaces: s.profile ? s.profile.surfaces.length : 0,
      specs: s.specs.length,
      versions: {
        installMode: s.versions.installMode,
        installedVersion: s.versions.installedVersion,
        latest: s.versions.latest,
        freshness: s.versions.freshness,
      },
      summary: s.summary,
    };
  } catch (e) {
    return { path: projectRoot, exists: true, error: String((e && e.message) || e) };
  }
}

async function list(globalDir, cliVersion) {
  const projects = read(globalDir);
  return Promise.all(projects.map(p => summarize(p, globalDir, cliVersion)));
}

// Server-side directory browser for the folder picker. Lists immediate sub-directories of
// `dir` (default: home), flagging those that look like a pipeline project (have PIPELINE.md).
// Localhost-only tool, so exposing the filesystem to the picker is acceptable.
function browse(dir) {
  let base = String(dir || '').trim() || os.homedir();
  if (base === '~' || base.startsWith('~/')) base = path.join(os.homedir(), base.slice(1));
  base = path.resolve(base);
  const parent = path.dirname(base);
  const looksLikeProject = d => fs.existsSync(path.join(d, 'PIPELINE.md'));
  try {
    const dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(base, e.name), isProject: looksLikeProject(path.join(base, e.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { dir: base, parent: parent === base ? null : parent, isProject: looksLikeProject(base), dirs };
  } catch (e) {
    return { dir: base, parent: parent === base ? null : parent, isProject: false, dirs: [], error: String((e && e.message) || e) };
  }
}

module.exports = { registryPath, read, ensureSeed, add, remove, list, browse };
