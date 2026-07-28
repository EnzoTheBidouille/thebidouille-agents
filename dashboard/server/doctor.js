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
  'review', 'release', 'research-agent',
  'questionnaire-architect', 'questionnaire-writer', 'questionnaire-validator',
  'implementer.template',
]);

const VALID_STATUS = ['draft', 'frozen', 'in-review', 'shipped'];

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
      'npx thebidouille-agents install   (or --global)');
  }
  if (v.pointer.present && v.pointer.core_version && v.installedVersion &&
      v.pointer.core_version !== v.installedVersion) {
    return mk('core', 'Core & pointer', 'warn',
      `pointer says core ${v.pointer.core_version} but installed core is ${v.installedVersion}`,
      'npx thebidouille-agents update   (reconcile the pointer)');
  }
  if (v.freshness === -1) {
    return mk('core', 'Core & pointer', 'warn',
      `core ${v.installedVersion} installed (${v.installMode}); npm latest is ${v.latest}`,
      '/update-pipeline   (or  npx thebidouille-agents update)');
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
  if (!gate || (!gate.deny && !gate.ask && !gate.ask_on_default_branch)) {
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

function checkHooks(projectRoot, globalDir, installMode) {
  const settingsPath = installMode === 'global'
    ? path.join(globalDir, 'settings.json')
    : path.join(projectRoot, '.claude', 'settings.json');
  const data = readJson(settingsPath);
  const pre = data && data.hooks && Array.isArray(data.hooks.PreToolUse) ? data.hooks.PreToolUse : [];
  const regs = pre.filter(e => (e.hooks || []).some(
    h => typeof h.command === 'string' && h.command.trim().endsWith('gate.py')));

  if (regs.length === 0) {
    return mk('hooks', 'Gate hook', 'warn', `gate.py not registered in ${installMode} settings.json`,
      installMode === 'global'
        ? 'npx thebidouille-agents install --global   (re-registers the hook)'
        : '/init-pipeline   (register the PreToolUse gate hook)');
  }
  if (regs.length > 1) {
    return mk('hooks', 'Gate hook', 'warn', `gate.py registered ${regs.length}× — it will double-prompt`,
      'remove the duplicate PreToolUse entry in settings.json');
  }
  return mk('hooks', 'Gate hook', 'ok', `registered once (${installMode} settings.json)`);
}

function checkRetrieval(profile) {
  const provider = profile && profile.retrieval && profile.retrieval.provider;
  if (!provider || provider === 'none' || String(provider).startsWith('<')) {
    return mk('retrieval', 'Code retrieval', 'skip', 'provider: none');
  }
  // Connectivity (server actually connects) needs a live session — note it, don't fake green.
  return mk('retrieval', 'Code retrieval', 'ok',
    `provider: ${provider} — connectivity not checked here (run /doctor in-session)`);
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

function scanSpecs(projectRoot) {
  const dir = path.join(projectRoot, 'specs');
  const specs = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')); }
  catch { return specs; }
  for (const f of files) {
    const txt = readText(path.join(dir, f)) || '';
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const body = fm ? fm[1] : '';
    const get = k => { const m = body.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return m ? m[1].trim() : null; };
    specs.push({
      file: f,
      id: get('feature_id') || f.replace(/\.md$/, ''),
      title: get('title'),
      status: get('status') ? get('status').split('#')[0].trim() : null,
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
    checkRetrieval(profile),
    checkDesign(profile, projectRoot),
    checkIsolation(profile, projectRoot),
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
