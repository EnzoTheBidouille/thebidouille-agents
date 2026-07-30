#!/usr/bin/env node
// cohorte — installer CLI for the portable multi-agent pipeline.
// Cross-platform, dependency-free port of install.sh / install.ps1.
//
//   npx cohorte install              # bundle the core into <cwd>/.claude (committable)
//   npx cohorte install [target]     # same, into another project
//   npx cohorte install --global     # one shared core in ~/.claude
//   npx cohorte update [--global]    # refresh the core, keep every generated file
//   npx cohorte version

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const pkgRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const REPO_URL = 'https://github.com/TheBidouilleAgency/cohorte';

// PreToolUse matcher for the gate hook. MUST cover Task as well as Bash:
// gate.py's preflight phase gate keys off tool_name === "Task" (the `preflight`
// block in a repo's gate-config.json). A Bash-only matcher never delivers a Task
// dispatch to the hook, so that gate silently never fires — it was dead code
// from 1.3.0 to 1.3.1. Keep in lockstep with install.sh and install.ps1.
const GATE_MATCHER = 'Bash|Task';

function usage(code) {
  console.log(`cohorte v${VERSION}

Usage:
  cohorte install   [target] [--global]
  cohorte update    [target] [--global]
  cohorte dashboard [target] [--port=N] [--host=ADDR] [--open]
  cohorte version

Commands:
  install   Fresh install. Default: bundle the core into <target>/.claude
            (committed with the repo). --global: one shared core in ~/.claude,
            available to every project on this machine.
  update    Refresh the stack-agnostic core only. PIPELINE.md, rendered surface
            agents, gate-config.json, settings.json and your filled
            ~/.claude/cohorte.config.yaml are never touched.
  dashboard Serve a local web cockpit for the pipeline (freshness, /doctor
            health, specs board, install/update actions). Binds 127.0.0.1:4317
            by default (loopback only — its actions execute code). --host=ADDR
            to expose (e.g. --host=0.0.0.0, prints a security warning). --open
            to launch the browser.
  version   Print the installed CLI version.`);
  process.exit(code);
}

// --- arg parsing -------------------------------------------------------------
const args = process.argv.slice(2);
let mode = null;
let scope = 'project';
let target = process.cwd();
let port = parseInt(process.env.COHORTE_DASHBOARD_PORT, 10) || 4317;
// Bind to loopback by default — the dashboard's action endpoints execute code (install/update/
// reset/claude), so it must NOT be reachable from the network unless the user explicitly opts in.
let host = process.env.COHORTE_DASHBOARD_HOST || '127.0.0.1';
let openBrowser = false;

for (const a of args) {
  if (a === 'install' || a === 'update' || a === 'dashboard') mode = a;
  else if (a === 'version' || a === '--version' || a === '-v') { console.log(VERSION); process.exit(0); }
  else if (a === '--global' || a === '-g') scope = 'global';
  else if (a.startsWith('--port=')) { port = parseInt(a.slice(7), 10); }
  else if (a.startsWith('--host=')) { host = a.slice(7); }
  else if (a === '--open') { openBrowser = true; }
  else if (a === 'help' || a === '--help' || a === '-h') usage(0);
  else if (a.startsWith('-')) { console.error(`error: unknown flag: ${a}`); usage(2); }
  else target = path.resolve(a);
}
if (!mode) usage(args.length ? 2 : 0);

// --- dashboard: local web cockpit -------------------------------------------
// Short-circuits before the install/update machinery (CommonJS wraps the module,
// so a top-level return is valid here). Runtime is dependency-free node `http`.
if (mode === 'dashboard') {
  const globalDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  require('../dashboard/server')({ projectRoot: target, globalDir, port, host, openBrowser, pkgRoot, version: VERSION });
  return;
}

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
  // `workflows` = the deterministic orchestration scripts (review/audit/refactor) the
  // Workflow runtime resolves from .claude/workflows (bundled) or ~/.claude/workflows
  // (global) — same copy rule in both modes, like commands.
  for (const d of ['commands', 'hooks', 'templates', 'workflows']) {
    fs.cpSync(path.join(src, 'core', d), path.join(dest, d), { recursive: true, force: true });
  }
  // 0.1.19 renamed questionnaire-domain-brief.md → research-brief.md; drop the stale copy.
  fs.rmSync(path.join(dest, 'templates', 'questionnaire-domain-brief.md'), { force: true });
  const pipelineDir = path.join(dest, 'pipeline');
  fs.mkdirSync(path.join(pipelineDir, 'scripts'), { recursive: true });
  for (const f of ['PIPELINE.template.md', 'SCHEMA.md', 'cohorte.config.template.yaml']) {
    fs.copyFileSync(path.join(src, 'profile', f), path.join(pipelineDir, f));
  }
  // Copy the *.template files AND the shipped executables (kanban-move.sh,
  // telemetry-send.sh). Until 1.2.4 this loop took only `.template`, so every
  // `npx cohorte install/update` produced a core missing both scripts — and since
  // every caller chains them with `|| true`, the result was silent: no kanban card
  // moves, no telemetry pings, no error. The shell installers named them explicitly
  // and this port drifted. The rule below needs no list to keep in sync: a `<x>.sh`
  // with an `<x>.sh.template` sibling is rendered per-project by /init-pipeline, so
  // only the template ships; every other `.sh` is a shipped executable.
  const scriptFiles = fs.readdirSync(path.join(src, 'scripts'));
  for (const f of scriptFiles) {
    const isTemplate = f.endsWith('.template');
    const isShipped = f.endsWith('.sh') && !scriptFiles.includes(`${f}.template`);
    if (!isTemplate && !isShipped) continue;
    const target = path.join(pipelineDir, 'scripts', f);
    fs.copyFileSync(path.join(src, 'scripts', f), target);
    if (isShipped && process.platform !== 'win32') {
      try { fs.chmodSync(target, 0o755); } catch { /* optional */ }
    }
  }
  fs.copyFileSync(path.join(src, 'core', 'agents', 'implementer.template.md'),
                  path.join(pipelineDir, 'implementer.template.md'));
  // /doctor reads this to tell the human what they're missing; the shell installers
  // have always copied it, this port never did.
  const changelog = path.join(src, 'CHANGELOG.md');
  if (fs.existsSync(changelog)) fs.copyFileSync(changelog, path.join(pipelineDir, 'CHANGELOG.md'));
  fs.writeFileSync(path.join(pipelineDir, 'VERSION'), VERSION + '\n');
  if (process.platform !== 'win32') {
    try { fs.chmodSync(path.join(dest, 'hooks', 'gate.py'), 0o755); } catch { /* optional */ }
  }
  scrubTddGate();
}

// The TDD gate was removed in 0.1.6. Older installs have hooks/tdd_gate.py on disk and
// registered in settings.json — copy-over never deletes, and a registered hook whose file
// is gone errors on every Write/Edit, so scrub both.
function scrubTddGate() {
  fs.rmSync(path.join(dest, 'hooks', 'tdd_gate.py'), { force: true });
  const settingsPath = path.join(dest, 'settings.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { return; }
  const pre = data && data.hooks && Array.isArray(data.hooks.PreToolUse) ? data.hooks.PreToolUse : null;
  if (!pre) return;
  const kept = pre.filter(entry => !(entry.hooks || []).some(
    h => typeof h.command === 'string' && h.command.trim().endsWith('tdd_gate.py')));
  if (kept.length !== pre.length) {
    data.hooks.PreToolUse = kept;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
    console.log('  · removed the retired tdd_gate.py hook (file + settings registration)');
  }
}

// the fixed (non-rendered) agents: the dev review/release pipeline agents
function copyFixedAgents() {
  fs.mkdirSync(path.join(dest, 'agents'), { recursive: true });
  // Every agent in core/agents/ EXCEPT the *.template.md ones, which /init-pipeline renders
  // per-surface. Until 1.2.6 this was a hardcoded ['review.md', 'release.md'] that never grew
  // the `smoke.md` the shell installers copy, so `npx cohorte install` shipped the /smoke
  // command with no `smoke` agent to dispatch — the run reported /smoke as not installed.
  // Reading the directory needs no list to keep in sync with the shell installers.
  const agentDir = path.join(src, 'core', 'agents');
  for (const f of fs.readdirSync(agentDir)) {
    if (!f.endsWith('.md') || f.endsWith('.template.md')) continue;
    fs.copyFileSync(path.join(agentDir, f), path.join(dest, 'agents', f));
  }
  // 0.1.19 split the bi-mode questionnaire-researcher into research-agent + questionnaire-architect;
  // copy-over never deletes, so scrub the retired agent lest a dead subagent_type linger.
  fs.rmSync(path.join(dest, 'agents', 'questionnaire-researcher.md'), { force: true });
  scrubResearchQuestionnaire();
}

// The research + questionnaire capability was removed. Older installs have its agents, commands,
// templates and template-step dirs on disk; copy-over never deletes, so scrub every orphan.
function scrubResearchQuestionnaire() {
  for (const f of ['research-agent.md', 'questionnaire-architect.md',
                   'questionnaire-writer.md', 'questionnaire-validator.md']) {
    fs.rmSync(path.join(dest, 'agents', f), { force: true });
  }
  for (const f of ['research.md', 'questionnaire.md']) {
    fs.rmSync(path.join(dest, 'commands', f), { force: true });
  }
  for (const f of ['research-brief.md', 'questionnaire-blueprint.md',
                   'questionnaire-declaration.md', 'questionnaire-verdict.md']) {
    fs.rmSync(path.join(dest, 'templates', f), { force: true });
  }
  for (const d of ['research', 'questionnaire']) {
    fs.rmSync(path.join(dest, 'templates', 'steps', d), { recursive: true, force: true });
  }
}

// --- interactive config helpers ---------------------------------------------
// Ask one question on the TTY. Resolves to the trimmed answer (or '' on EOF).
function ask(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res((a || '').trim()); }));
}
function yes(a) { return /^(y|yes|o|oui)$/i.test(a); }

// Set the value on the line carrying `# cfg:<cfgKey>`, preserving the yaml key + the comment.
// The config template anchors every interactive field this way, so we never parse YAML.
// Line-scoped on purpose (a multiline regex would let \s span newlines and mangle keys).
function setCfg(text, cfgKey, value) {
  const marker = `# cfg:${cfgKey}`;
  return text.split('\n').map(line => {
    const idx = line.indexOf(marker);
    if (idx === -1) return line;
    const m = line.slice(0, idx).match(/^(\s*[\w.]+:\s*)/);   // "  key: "
    return m ? `${m[1]}${value}  ${line.slice(idx)}` : line;
  }).join('\n');
}

// Fill the seeded config from a short TTY interview (shared Obsidian vault for the kanban mirror).
// Kanban is per-project, so it is wired later by /init-pipeline — not asked here.
async function promptConfig(text) {
  console.log('\n  Quick setup (Enter to skip — you can also wire this later via');
  console.log('  /init-pipeline or /update-pipeline):');
  const vault = await ask('    · absolute path to your shared Obsidian vault (for the kanban mirror): ');
  if (vault) text = setCfg(text, 'vault_path', `"${vault}"`);
  return text;
}

// The pipeline capability config is USER-level (vault, Notion DB, kanban boards) — it lives in
// ~/.claude regardless of install scope. Seed it only if the user has no copy (consolidated OR
// legacy). On a TTY, offer a quick interview to fill it; otherwise seed disabled defaults.
async function seedConfig() {
  const cfg = path.join(globalDir, 'cohorte.config.yaml');
  // Pre-rename names, newest first — read as a fallback so upgrades don't lose the config.
  const legacy = ['thebidouille.config.yaml']
    .map((n) => path.join(globalDir, n)).find(fs.existsSync);
  if (fs.existsSync(cfg)) { console.log(`  · kept your existing ${cfg}`); return; }
  if (legacy) {
    console.log(`  · found legacy ${legacy} — kept as-is (still read as a fallback).`);
    console.log('    Run /update-pipeline to migrate it into cohorte.config.yaml + wire the kanban.');
    return;
  }
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  let text = fs.readFileSync(path.join(src, 'profile', 'cohorte.config.template.yaml'), 'utf8');
  if (process.stdin.isTTY && process.stdout.isTTY) {
    text = await promptConfig(text);
    fs.writeFileSync(cfg, text);
    console.log(`  · seeded ${cfg} from your answers`);
  } else {
    fs.writeFileSync(cfg, text);
    console.log(`  · seeded ${cfg} (disabled defaults — enable via /init-pipeline or /update-pipeline)`);
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

// Register the profile-driven gate hook in the GLOBAL settings.json. Idempotent: the
// hook reads each repo's own .claude/gate-config.json (and no-ops where absent),
// so one registration serves every project.
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

  const file = path.join(dest, 'hooks', 'gate.py');
  const base = path.basename(file);
  // Trailing-quote tolerant: the Windows form is `py "C:\...\gate.py"`, and a
  // bare .endsWith() missed it — which is how repeat `npx cohorte install`
  // runs accumulated a duplicate registration every time (gate.py then ran
  // once per copy on every Bash call).
  const isGate = entry => (entry.hooks || []).some(
    h => typeof h.command === 'string' && h.command.trim().replace(/"+$/, '').endsWith(base));
  const cmd = process.platform === 'win32' ? `${python} "${file}"` : `${python} ${file}`;

  // Reconcile rather than append-if-absent: drop every existing gate.py
  // registration, then add exactly one. Idempotent, collapses duplicates older
  // installers left behind, and upgrades a stale "Bash"-only matcher in place —
  // an append-if-absent would find the stale entry and skip, pinning the bug.
  data.hooks.PreToolUse = data.hooks.PreToolUse.filter(e => !isGate(e));
  data.hooks.PreToolUse.push({ matcher: GATE_MATCHER, hooks: [{ type: 'command', command: cmd }] });

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
(async () => {
if (scope === 'global') {
  console.log(mode === 'install'
    ? `→ installing pipeline core GLOBALLY into ${dest}`
    : `→ updating pipeline core GLOBALLY in ${dest} (keeping global settings.json)`);
  copyFixedAgents();
  copyCore();
  // Register on UPDATE too — install.sh and install.ps1 always have, and this
  // port skipping it is why a duplicated or stale-matcher registration could
  // never be repaired by `npx cohorte update`: the only route that rewrites it
  // was a full re-install, which is not what anyone runs to get a fix. Safe to
  // run every time — registration reconciles only gate.py entries and leaves
  // every other hook and settings key untouched.
  const hookState = registerGlobalHook();
  await seedConfig();
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

Update later with:  npx cohorte@latest update --global

Global kanban config, user-scoped — optional:
  · One consolidated file: ${path.join(globalDir, 'cohorte.config.yaml')}
  · Don't hand-edit it — /init-pipeline (new project) and /update-pipeline (existing) wire it
    for you: creating + syncing an Obsidian kanban board of the pipeline in your shared vault.`);
} else if (mode === 'install') {
  console.log(`→ installing pipeline core into ${dest}`);
  copyFixedAgents();
  copyCore();
  await seedConfig();
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

Update later with:  npx cohorte@latest update
Prefer one shared core across all your repos?  Re-run with  --global.`);
} else {
  console.log(`→ updating pipeline core in ${dest} (keeping your PIPELINE.md + rendered agents)`);
  copyCore();
  try { copyFixedAgents(); } catch { /* best-effort, as in install.sh */ }
  await seedConfig();
  bumpPointerVersion(path.join(dest, 'pipeline.json'));
  console.log(`
✓ core refreshed to ${VERSION}. Your PIPELINE.md, rendered surface agents, gate-config.json and
  settings.json were left as-is. Re-run /init-pipeline if your stack changed.`);
}
})();
