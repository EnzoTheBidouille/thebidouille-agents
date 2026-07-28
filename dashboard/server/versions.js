'use strict';
// Freshness data: which core is installed where, and how it compares to npm latest.
// Dependency-free — reads VERSION files + the committed pointer, fetches the npm registry.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readTrimmed(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Installed core in a given root (global ~/.claude or a repo's bundled .claude).
function coreAt(claudeDir) {
  const version = readTrimmed(path.join(claudeDir, 'pipeline', 'VERSION'));
  return { present: version != null, version, dir: claudeDir };
}

// The committed per-repo pointer (bundled mode); names the mode + core_version.
function pointerAt(projectRoot) {
  const ptr = readJson(path.join(projectRoot, '.claude', 'pipeline.json'));
  if (!ptr || typeof ptr !== 'object') return { present: false };
  return { present: true, mode: ptr.mode || null, core_version: ptr.core_version || null };
}

// Latest published version — registry fetch first, `npm view` as a fallback (it uses the
// user's configured registry/proxy, which works where a raw fetch may be blocked). Cached
// briefly so the dashboard's poll doesn't hammer the network. null only if both fail.
let _cache = { value: null, at: 0 };
const CACHE_MS = 5 * 60 * 1000;

async function fetchRegistry() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch('https://registry.npmjs.org/cohorte/latest', {
      signal: ctrl.signal,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function npmView() {
  try {
    const r = spawnSync('npm', ['view', 'cohorte', 'version'],
      { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32' });
    if (r.status === 0 && r.stdout) {
      const v = r.stdout.trim();
      return /^\d+\.\d+\.\d+/.test(v) ? v : null;
    }
  } catch { /* npm absent or slow */ }
  return null;
}

async function latestNpm() {
  if (_cache.value && (Date.now() - _cache.at) < CACHE_MS) return _cache.value;
  const v = (await fetchRegistry()) || npmView();
  if (v) _cache = { value: v, at: Date.now() };
  return v;
}

// Naive semver compare — returns -1|0|1 (a<b|a==b|a>b). Ignores pre-release tags.
function cmpSemver(a, b) {
  if (!a || !b) return null;
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

async function versions({ projectRoot, globalDir, cliVersion }) {
  const global = coreAt(globalDir);
  const bundled = coreAt(path.join(projectRoot, '.claude'));
  const pointer = pointerAt(projectRoot);
  const latest = await latestNpm();

  // The core that actually serves this project: bundled wins if present, else global.
  const effective = bundled.present ? bundled : global.present ? global : null;
  const installedVersion = effective ? effective.version : null;
  const behind = cmpSemver(installedVersion, latest);

  return {
    cli: cliVersion,
    latest,
    global,
    bundled,
    pointer,
    installMode: bundled.present ? 'bundled' : global.present ? 'global' : 'none',
    installedVersion,
    // -1 behind, 0 up-to-date, 1 ahead of registry (dev), null unknown
    freshness: behind,
    // freshness of the GLOBAL core specifically (for the fleet banner, independent of project mode)
    globalFreshness: global.present ? cmpSemver(global.version, latest) : null,
  };
}

module.exports = { versions };
