'use strict';
// Programmatic port of the /doctor checks (core/commands/doctor.md), for the dashboard.
// Read-only: inspects files only. Checks that need a live process (MCP connectivity,
// git worktree state, DesignSync) are reported as `skip` with a note — the node server
// can't run them, and honest "not checked here" beats a false green.

const fs = require('fs');
const path = require('path');
const { parseProfileBlock } = require('./yaml');
const { versions } = require('./versions');

// Rendered surface agents live alongside these fixed (non-surface) agents; exclude them
// from the orphan check so they're never mistaken for a stray surface agent.
const FIXED_AGENTS = new Set([
  'review', 'release', 'profile-reader',
  // retired (1.5.0) — still excluded so a stale install's leftover file isn't
  // reported as a stray surface agent.
  'smoke',
  'implementer.template',
]);

const VALID_STATUS = ['draft', 'frozen', 'in-review', 'shipped'];

// Artifacts the pipeline itself writes into specs/ that are NOT feature specs and have no
// front-matter status. `/audit` writes specs/refactor-backlog.md by design, so scanning it
// as a spec made /doctor warn about a file cohorte had just created — a false positive that
// fired in every project that had ever run /audit. `_`-prefixed files (e.g. _template.md)
// are already skipped by the reader below.
const NON_SPEC_FILES = new Set(['refactor-backlog.md']);

const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isTrue = v => v === true;
const sameSet = (a, b) => {
  const A = new Set(a || []), B = new Set(b || []);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
};

function mk(id, label, status, detail, fix) {
  return fix ? { id, label, status, detail, fix } : { id, label, status, detail };
}

// --- individual checks -------------------------------------------------------

function checkCore(v) {
  if (v.installMode === 'none') {
    return mk('core', 'Core & pointer', 'bad', 'no pipeline core installed for this project',
      'npx cohorte install   (or --global)');
  }
  if (v.pointer.present && v.pointer.core_version && v.installedVersion &&
      v.pointer.core_version !== v.installedVersion) {
    return mk('core', 'Core & pointer', 'warn',
      `pointer says core ${v.pointer.core_version} but installed core is ${v.installedVersion}`,
      'npx cohorte update   (reconcile the pointer)');
  }
  if (v.freshness === -1) {
    return mk('core', 'Core & pointer', 'warn',
      `core ${v.installedVersion} installed (${v.installMode}); npm latest is ${v.latest}`,
      '/update-pipeline   (or  npx cohorte update)');
  }
  const tail = v.latest ? `, npm latest ${v.latest}` : ', npm unreachable';
  return mk('core', 'Core & pointer', 'ok', `core ${v.installedVersion} (${v.installMode})${tail}`);
}

function checkProfile(profile, hasPipelineMd) {
  if (!hasPipelineMd) {
    return mk('profile', 'Profile (PIPELINE.md)', 'bad', 'PIPELINE.md not found',
      '/init-pipeline   (generate the project profile)');
  }
  if (!profile) {
    return mk('profile', 'Profile (PIPELINE.md)', 'bad',
      'PIPELINE.md present but its `yaml pipeline-profile` block is missing or unparseable',
      '/init-pipeline   (or fix the fenced yaml block)');
  }
  const n = (profile.surfaces || []).length;
  return mk('profile', 'Profile (PIPELINE.md)', n ? 'ok' : 'warn',
    `${profile.name || 'unnamed'} · ${n} surface${n === 1 ? '' : 's'}`,
    n ? undefined : 'add at least one surface to §surfaces');
}

function checkAgents(profile, projectRoot) {
  if (!profile || !(profile.surfaces || []).length) {
    return mk('agents', 'Surfaces ↔ agents', 'skip', 'no surfaces to reconcile');
  }
  const agentsDir = path.join(projectRoot, '.claude', 'agents');
  const surfaceAgents = profile.surfaces.map(s => s.agent).filter(Boolean);

  const missing = surfaceAgents.filter(a => !exists(path.join(agentsDir, `${a}.md`)));

  let files = [];
  try { files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)); }
  catch { /* dir absent → handled by `missing` */ }
  const orphans = files.filter(f => !FIXED_AGENTS.has(f) && !surfaceAgents.includes(f));

  if (missing.length) {
    return mk('agents', 'Surfaces ↔ agents', 'bad',
      `surface(s) with no rendered agent: ${missing.join(', ')}`,
      '/init-pipeline   (re-render surface agents)');
  }
  if (orphans.length) {
    return mk('agents', 'Surfaces ↔ agents', 'warn',
      `agent file(s) with no owning surface: ${orphans.join(', ')}`,
      'remove the stale agent file, or add its surface to PIPELINE.md');
  }
  return mk('agents', 'Surfaces ↔ agents', 'ok',
    `${surfaceAgents.length} surface agent(s) all rendered, no orphans`);
}

function checkGate(profile, projectRoot) {
  const gate = profile && profile.gate;
  if (!gate || (!gate.deny && !gate.ask && !gate.ask_on_default_branch && !gate.preflight)) {
    return mk('gate', 'Gate config', 'skip', 'no gate block in the profile');
  }
  const cfg = readJson(path.join(projectRoot, '.claude', 'gate-config.json'));
  if (!cfg) {
    return mk('gate', 'Gate config', 'bad', '.claude/gate-config.json missing or unreadable',
      '/init-pipeline   (regenerate gate-config.json from the gate block)');
  }
  const drifted = [];
  if (!sameSet(cfg.deny, gate.deny)) drifted.push('deny');
  if (!sameSet(cfg.ask, gate.ask)) drifted.push('ask');
  if (!sameSet(cfg.ask_on_default_branch, gate.ask_on_default_branch)) drifted.push('ask_on_default_branch');
  if ((cfg.default_branch || 'main') !== (gate.default_branch || 'main')) drifted.push('default_branch');
  // The phase gate (1.3.0) lives in the same file: a profile that enables
  // gate.preflight with a pre-1.3.0 gate-config.json silently never fires it.
  const wantPf = gate.preflight || {};
  const havePf = (cfg.preflight && typeof cfg.preflight === 'object') ? cfg.preflight : {};
  if (!!wantPf.enabled !== !!havePf.enabled
      || !sameSet(wantPf.agents || ['review'], havePf.agents || ['review'])
      || Number(wantPf.max_age_minutes || 30) !== Number(havePf.max_age_minutes || 30)) {
    drifted.push('preflight');
  }
  if (drifted.length) {
    return mk('gate', 'Gate config', 'warn',
      `gate-config.json drifted from PIPELINE.md gate block (${drifted.join(', ')})`,
      'regenerate .claude/gate-config.json to mirror the gate block');
  }
  const branchGated = (gate.ask_on_default_branch || []).length;
  return mk('gate', 'Gate config', 'ok',
    `mirrors the profile (${(gate.deny || []).length} deny, ${(gate.ask || []).length} ask` +
    (branchGated ? `, ${branchGated} gated on ${gate.default_branch || 'main'}` : '') + ')');
}

function gateRegs(settingsPath) {
  const data = readJson(settingsPath);
  const pre = data && data.hooks && Array.isArray(data.hooks.PreToolUse) ? data.hooks.PreToolUse : [];
  // Trailing-quote tolerant, like the installers since 1.3.2: the Windows form is
  // `py "C:\…\gate.py"` — a bare .endsWith() reports every healthy Windows install
  // as "not registered".
  return pre.filter(e => (e.hooks || []).some(
    h => typeof h.command === 'string' && h.command.trim().replace(/"+$/, '').endsWith('gate.py')));
}

function checkHooks(projectRoot, globalDir, installMode) {
  // A registration in EITHER scope serves the project: bundled repos get it from
  // /init-pipeline in project settings, but on a machine with the global core the
  // hook usually lives (correctly, exactly once) in global settings — warning
  // there would prescribe a re-registration that double-prompts.
  const scopes = [
    { label: 'project', path: path.join(projectRoot, '.claude', 'settings.json') },
    { label: 'global', path: path.join(globalDir, 'settings.json') },
  ];
  if (installMode === 'global') scopes.reverse();
  const found = scopes.map(s => ({ ...s, regs: gateRegs(s.path) })).filter(s => s.regs.length);

  if (!found.length) {
    return mk('hooks', 'Gate hook', 'warn', 'gate.py not registered in project or global settings.json',
      installMode === 'global'
        ? 'npx cohorte install --global   (re-registers the hook)'
        : '/init-pipeline   (register the PreToolUse gate hook)');
  }
  const total = found.reduce((n, s) => n + s.regs.length, 0);
  if (total > 1) {
    return mk('hooks', 'Gate hook', 'warn',
      `gate.py registered ${total}× (${found.map(s => `${s.regs.length} in ${s.label}`).join(', ')}) — it will double-prompt`,
      'keep exactly one PreToolUse entry (drop the project-level one when the global core is installed)');
  }
  const matcher = String(found[0].regs[0].matcher || '');
  if (!/\bTask\b/.test(matcher) || !/\bBash\b/.test(matcher)) {
    return mk('hooks', 'Gate hook', 'warn',
      `registered with matcher "${matcher}" — it must cover both Bash (command gating) and Task (preflight phase gate)`,
      'npx cohorte@latest update --global   (reconciles the matcher to Bash|Task)');
  }
  return mk('hooks', 'Gate hook', 'ok', `registered once, matcher ${matcher} (${found[0].label} settings.json)`);
}

function checkRetrieval(profile, projectRoot) {
  const provider = profile && profile.retrieval && profile.retrieval.provider;
  if (!provider || provider === 'none' || String(provider).startsWith('<')) {
    return mk('retrieval', 'Code retrieval', 'skip', 'provider: none');
  }
  // The profile alone isn't proof the provider was ever wired: /init-pipeline
  // registers it at project scope in .mcp.json. Verify the entry exists on disk;
  // live connectivity still needs a session — note it, don't fake green.
  const mcp = readJson(path.join(projectRoot, '.mcp.json'));
  const servers = (mcp && mcp.mcpServers) || {};
  const wired = Object.keys(servers).some(k => k.toLowerCase().includes(String(provider).toLowerCase()));
  if (!wired) {
    return mk('retrieval', 'Code retrieval', 'warn',
      `profile says provider: ${provider} but .mcp.json has no matching server entry`,
      '/init-pipeline or /update-pipeline   (re-wire the retrieval provider)');
  }
  return mk('retrieval', 'Code retrieval', 'ok',
    `provider: ${provider} — registered in .mcp.json (connectivity needs /doctor in-session)`);
}

function checkDesign(profile, projectRoot) {
  const d = profile && profile.design;
  if (!d || !isTrue(d.enabled)) return mk('design', 'Design system', 'skip', 'design.enabled: false');
  const targets = [['snapshot_dir', d.snapshot_dir], ['ui_kit_path', d.ui_kit_path], ['tokens_path', d.tokens_path]];
  const missing = targets.filter(([, p]) => p && !exists(path.join(projectRoot, p))).map(([k]) => k);
  if (missing.length) {
    return mk('design', 'Design system', 'warn', `missing path(s): ${missing.join(', ')}`,
      'create the missing design paths or fix them in PIPELINE.md §design');
  }
  return mk('design', 'Design system', 'ok', `provider: ${d.provider} — DS paths present`);
}

function checkIsolation(profile, projectRoot) {
  const iso = profile && profile.isolation;
  if (!iso || !isTrue(iso.enabled)) return mk('isolation', 'Isolation', 'skip', 'isolation.enabled: false');
  const scripts = ['scripts/new-feature.sh', 'scripts/remove-feature.sh'];
  const problems = [];
  for (const rel of scripts) {
    const txt = readText(path.join(projectRoot, rel));
    if (txt == null) problems.push(`${rel} missing`);
    else if (/__[A-Z_]+__/.test(txt)) problems.push(`${rel} has unrendered __TOKEN__`);
  }
  if (problems.length) {
    return mk('isolation', 'Isolation', 'warn', problems.join('; '),
      '/init-pipeline   (re-render the isolation scripts)');
  }
  return mk('isolation', 'Isolation', 'ok', 'feature scripts rendered (worktree state not checked here)');
}

// Workflow variants (review/audit/refactor as deterministic multi-agent runs) are opt-in;
// the conversational commands stay the default path, so nothing here is ever 'bad'.
// Whether the session has workflows ENABLED needs a live Claude session — /doctor
// in-session checks that; here we only check what's on disk.
function checkWorkflows(projectRoot, globalDir, installMode) {
  if (installMode === 'none') return mk('workflows', 'Workflows', 'skip', 'no core installed');
  const dir = installMode === 'bundled'
    ? path.join(projectRoot, '.claude', 'workflows')
    : path.join(globalDir, 'workflows');
  const agentsDir = installMode === 'bundled'
    ? path.join(projectRoot, '.claude', 'agents')
    : path.join(globalDir, 'agents');
  const scripts = ['review.js', 'audit.js', 'refactor.js'];
  const missing = scripts.filter(s => !exists(path.join(dir, s)));
  if (missing.length === scripts.length) {
    return mk('workflows', 'Workflows', 'warn',
      'no workflow scripts installed — conversational commands only (the default path)',
      'npx cohorte update   (ships core/workflows/)');
  }
  if (missing.length) {
    return mk('workflows', 'Workflows', 'warn', `missing script(s): ${missing.join(', ')}`,
      'npx cohorte update   (half-copied core)');
  }
  if (!exists(path.join(agentsDir, 'profile-reader.md'))) {
    return mk('workflows', 'Workflows', 'warn',
      'scripts present but the profile-reader agent (their phase 0) is missing',
      'npx cohorte update   (re-copies the fixed agents)');
  }
  return mk('workflows', 'Workflows', 'ok',
    'scripts + profile-reader installed — opt-in per run; needs Claude Code ≥ 2.1.154 with ' +
    'workflows enabled (run /doctor in-session to check the live half)');
}

function scanSpecs(projectRoot) {
  const dir = path.join(projectRoot, 'specs');
  const specs = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_') && !NON_SPEC_FILES.has(f)); }
  catch { return specs; }
  for (const f of files) {
    const txt = readText(path.join(dir, f)) || '';
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const body = fm ? fm[1] : '';
    const get = k => { const m = body.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return m ? m[1].trim() : null; };
    const status = get('status');
    specs.push({
      file: f,
      id: get('feature_id') || f.replace(/\.md$/, ''),
      title: get('title'),
      status: status ? status.split('#')[0].trim() : null,
      branch: get('branch'),
    });
  }
  return specs;
}

function checkSpecs(specs) {
  if (!specs.length) return mk('specs', 'Specs', 'skip', 'no specs yet');
  const bad = specs.filter(s => !VALID_STATUS.includes(s.status));
  const counts = {};
  for (const s of specs) counts[s.status || '?'] = (counts[s.status || '?'] || 0) + 1;
  const summary = VALID_STATUS.filter(st => counts[st]).map(st => `${counts[st]} ${st}`).join(', ');
  if (bad.length) {
    return mk('specs', 'Specs', 'warn',
      `invalid status in: ${bad.map(s => s.file).join(', ')}`,
      `set status to one of: ${VALID_STATUS.join(' · ')}`);
  }
  return mk('specs', 'Specs', 'ok', `${specs.length} spec(s) — ${summary}`);
}

// --- orchestrator ------------------------------------------------------------

async function state({ projectRoot, globalDir, cliVersion }) {
  const v = await versions({ projectRoot, globalDir, cliVersion });

  const pipelineMd = readText(path.join(projectRoot, 'PIPELINE.md'));
  const profile = pipelineMd ? parseProfileBlock(pipelineMd) : null;
  const specs = scanSpecs(projectRoot);

  const checks = [
    checkCore(v),
    checkProfile(profile, pipelineMd != null),
    checkAgents(profile, projectRoot),
    checkGate(profile, projectRoot),
    checkHooks(projectRoot, globalDir, v.installMode),
    checkRetrieval(profile, projectRoot),
    checkDesign(profile, projectRoot),
    checkIsolation(profile, projectRoot),
    checkWorkflows(projectRoot, globalDir, v.installMode),
    checkSpecs(specs),
  ];

  const summary = { ok: 0, warn: 0, bad: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;

  return {
    project: projectRoot,
    versions: v,
    profile: profile ? {
      name: profile.name,
      one_liner: profile.one_liner,
      surfaces: (profile.surfaces || []).map(s => ({
        key: s.key, label: s.label, agent: s.agent, path: s.path,
        model: s.model, uses_design: s.uses_design, tools: s.tools,
      })),
    } : null,
    specs,
    checks,
    summary,
  };
}

module.exports = { state, scanSpecs };
