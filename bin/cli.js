#!/usr/bin/env node
// thebidouille-agents — installer CLI for the portable multi-agent pipeline.
// Cross-platform, dependency-free port of install.sh / install.ps1.
//
//   npx thebidouille-agents install              # bundle the core into <cwd>/.claude (committable)
//   npx thebidouille-agents install [target]     # same, into another project
//   npx thebidouille-agents install --global     # one shared core in ~/.claude
//   npx thebidouille-agents update [--global]    # refresh the core, keep every generated file
//   npx thebidouille-agents version

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const pkgRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const REPO_URL = 'https://github.com/EnzoTheBidouille/thebidouille-agents';

function usage(code) {
  console.log(`thebidouille-agents v${VERSION}

Usage:
  thebidouille-agents install [target] [--global]
  thebidouille-agents update  [target] [--global]
  thebidouille-agents version

Commands:
  install   Fresh install. Default: bundle the core into <target>/.claude
            (committed with the repo). --global: one shared core in ~/.claude,
            available to every project on this machine.
  update    Refresh the stack-agnostic core only. PIPELINE.md, rendered surface
            agents, gate-config.json, settings.json and your filled
            ~/.claude/questionnaire.config.yaml are never touched.
  version   Print the installed CLI version.`);
  process.exit(code);
}

// --- arg parsing -------------------------------------------------------------
const args = process.argv.slice(2);
let mode = null;
let scope = 'project';
let target = process.cwd();

for (const a of args) {
  if (a === 'install' || a === 'update') mode = a;
  else if (a === 'version' || a === '--version' || a === '-v') { console.log(VERSION); process.exit(0); }
  else if (a === '--global' || a === '-g') scope = 'global';
  else if (a === 'help' || a === '--help' || a === '-h') usage(0);
  else if (a.startsWith('-')) { console.error(`error: unknown flag: ${a}`); usage(2); }
  else target = path.resolve(a);
}
if (!mode) usage(args.length ? 2 : 0);

// --- paths -------------------------------------------------------------------
const globalDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const dest = scope === 'global' ? globalDir : path.join(target, '.claude');
const src = pkgRoot;

if (!fs.existsSync(path.join(src, 'core'))) {
  console.error(`error: pipeline source not found (no core/ in ${src})`);
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });

// --- helpers (mirror install.sh) --------------------------------------------
function copyCore() {
  for (const d of ['commands', 'hooks', 'templates']) {
    fs.cpSync(path.join(src, 'core', d), path.join(dest, d), { recursive: true, force: true });
  }
  const pipelineDir = path.join(dest, 'pipeline');
  fs.mkdirSync(path.join(pipelineDir, 'scripts'), { recursive: true });
  for (const f of ['PIPELINE.template.md', 'SCHEMA.md', 'questionnaire.config.template.yaml']) {
    fs.copyFileSync(path.join(src, 'profile', f), path.join(pipelineDir, f));
  }
  for (const f of fs.readdirSync(path.join(src, 'scripts'))) {
    if (f.endsWith('.template')) {
      fs.copyFileSync(path.join(src, 'scripts', f), path.join(pipelineDir, 'scripts', f));
    }
  }
  fs.copyFileSync(path.join(src, 'core', 'agents', 'implementer.template.md'),
                  path.join(pipelineDir, 'implementer.template.md'));
  fs.writeFileSync(path.join(pipelineDir, 'VERSION'), VERSION + '\n');
  if (process.platform !== 'win32') {
    for (const h of ['gate.py', 'tdd_gate.py']) {
      try { fs.chmodSync(path.join(dest, 'hooks', h), 0o755); } catch { /* optional */ }
    }
  }
}

// the fixed (non-rendered) agents: dev review/release + the questionnaire capability's three
function copyFixedAgents() {
  fs.mkdirSync(path.join(dest, 'agents'), { recursive: true });
  for (const f of ['review.md', 'release.md', 'questionnaire-researcher.md',
                   'questionnaire-writer.md', 'questionnaire-validator.md']) {
    fs.copyFileSync(path.join(src, 'core', 'agents', f), path.join(dest, 'agents', f));
  }
}

// questionnaire capability config is USER-level (Notion DB, runs path) — it lives in
// ~/.claude regardless of install scope. Seed it only if the user has no filled copy.
function seedQuestionnaireConfig() {
  const qcfg = path.join(globalDir, 'questionnaire.config.yaml');
  if (!fs.existsSync(qcfg)) {
    fs.mkdirSync(path.dirname(qcfg), { recursive: true });
    fs.copyFileSync(path.join(src, 'profile', 'questionnaire.config.template.yaml'), qcfg);
    console.log(`  · seeded ${qcfg} (fill it in to enable /research + /questionnaire)`);
  } else {
    console.log(`  · kept your existing ${qcfg}`);
  }
}

function findPython() {
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { stdio: 'ignore', shell: false });
    if (r.status === 0) return c;
  }
  return null;
}

// Register the profile-driven hooks in the GLOBAL settings.json. Idempotent: each
// hook reads each repo's own .claude/gate-config.json (and no-ops where absent /
// where tdd.enforce is off), so one registration serves every project.
function registerGlobalHook() {
  const python = findPython();
  if (!python) return 'skipped (no python found — register the gate hook manually)';
  const settingsPath = path.join(dest, 'settings.json');
  let data = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch { /* absent or invalid → start fresh */ }
  if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {};
  if (!Array.isArray(data.hooks.PreToolUse)) data.hooks.PreToolUse = [];
  const pre = data.hooks.PreToolUse;
  const hooks = [
    { file: path.join(dest, 'hooks', 'gate.py'), matcher: 'Bash' },
    { file: path.join(dest, 'hooks', 'tdd_gate.py'), matcher: 'Write|Edit|MultiEdit' },
  ];
  for (const { file, matcher } of hooks) {
    const base = path.basename(file);
    const already = pre.some(entry => (entry.hooks || []).some(
      h => typeof h.command === 'string' && h.command.trim().endsWith(base)));
    if (!already) {
      const cmd = process.platform === 'win32' ? `${python} "${file}"` : `${python} ${file}`;
      pre.push({ matcher, hooks: [{ type: 'command', command: cmd }] });
    }
  }
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
  return 'ok';
}

// Bump only the core_version in a repo's committed .claude/pipeline.json (bundled mode).
// Leaves every other field intact; no-ops if the pointer is absent or has no core_version.
function bumpPointerVersion(ptr) {
  if (!fs.existsSync(ptr)) return;
  let data;
  try { data = JSON.parse(fs.readFileSync(ptr, 'utf8')); } catch { return; }
  if (data && typeof data === 'object' && 'core_version' in data) {
    data.core_version = VERSION;
    fs.writeFileSync(ptr, JSON.stringify(data, null, 2) + '\n');
  }
}

// --- run ---------------------------------------------------------------------
if (scope === 'global') {
  console.log(mode === 'install'
    ? `→ installing pipeline core GLOBALLY into ${dest}`
    : `→ updating pipeline core GLOBALLY in ${dest} (keeping global settings.json)`);
  copyFixedAgents();
  copyCore();
  const hookState = mode === 'install' ? registerGlobalHook() : 'unchanged';
  seedQuestionnaireConfig();
  console.log(`
✓ pipeline core installed globally into ${dest}  (version ${VERSION})
  gate hook: ${hookState}  (reads each repo's .claude/gate-config.json; silent where absent)

The commands (/init-pipeline, /brainstorm, /build …) and the review/release agents are now
available in EVERY project on this machine — nothing is copied per repo.

Per repo:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline  — it generates PIPELINE.md, renders the surface agents, writes
     .claude/gate-config.json, and drops a committed .claude/pipeline.json pointer so
     teammates know to install the global core (${REPO_URL}).
  3. Commit PIPELINE.md + .claude/, then  /brainstorm  to start a feature.

Update later with:  npx thebidouille-agents@latest update --global

Research / questionnaire capability (global, works anywhere — optional):
  1. Connect Notion:  claude mcp add --transport http notion https://mcp.notion.com/mcp
  2. Set  enabled: true  in ${path.join(globalDir, 'questionnaire.config.yaml')} — that's all: the
     Notion database is CREATED AUTOMATICALLY on the first run (nothing is stored locally).
  3. Run  /research <pdf-url-or-file> [subject]  — then optionally  /questionnaire <run-id>.`);
} else if (mode === 'install') {
  console.log(`→ installing pipeline core into ${dest}`);
  copyFixedAgents();
  copyCore();
  seedQuestionnaireConfig();
  fs.mkdirSync(path.join(target, 'specs'), { recursive: true });
  const specTemplate = path.join(target, 'specs', '_template.md');
  if (!fs.existsSync(specTemplate)) {
    fs.copyFileSync(path.join(src, 'core', 'templates', 'spec.template.md'), specTemplate);
  }
  console.log(`
✓ pipeline core installed into ${dest}  (version ${VERSION})

Next:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline   — it detects your stack, asks the gaps, and generates
     PIPELINE.md + renders one implementer agent per surface.
  3. Commit PIPELINE.md, then  /brainstorm  to start a feature.

Update later with:  npx thebidouille-agents@latest update
Prefer one shared core across all your repos?  Re-run with  --global.`);
} else {
  console.log(`→ updating pipeline core in ${dest} (keeping your PIPELINE.md + rendered agents)`);
  copyCore();
  try { copyFixedAgents(); } catch { /* best-effort, as in install.sh */ }
  seedQuestionnaireConfig();
  bumpPointerVersion(path.join(dest, 'pipeline.json'));
  console.log(`
✓ core refreshed to ${VERSION}. Your PIPELINE.md, rendered surface agents, gate-config.json and
  settings.json were left as-is. Re-run /init-pipeline if your stack changed.`);
}
