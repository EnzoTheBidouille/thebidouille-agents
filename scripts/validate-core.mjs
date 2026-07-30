#!/usr/bin/env node
// Validates the structural invariants of the cohorte core — the things a
// prose refactor can silently break. Run by CI on every push/PR; run it
// locally with `node scripts/validate-core.mjs`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname — on Windows the latter yields "/C:/…", which
// join() then resolves against the cwd drive ("C:\C:\…") and every read ENOENTs.
const root = fileURLToPath(new URL("..", import.meta.url));
const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

const read = (p) => readFileSync(join(root, p), "utf8");
const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? m[1] : null;
};

// ── commands ────────────────────────────────────────────────────────────────
// Mechanical commands must pin model: sonnet (otherwise the lead's
// orchestration turn silently bills at the session model — Opus/Fable).
// Interactive commands must stay unpinned (they inherit on purpose).
const PINNED = ["build", "review", "fix", "smoke", "ship", "audit",
  "refactor", "doctor", "align-ds", "update-pipeline"];
const UNPINNED = ["brainstorm", "spec", "init-pipeline"];

for (const f of readdirSync(join(root, "core/commands"))) {
  const path = `core/commands/${f}`;
  const fm = frontmatter(read(path));
  if (!fm) { fail(path, "missing or malformed YAML frontmatter"); continue; }
  if (!/^description:\s*\S/m.test(fm)) fail(path, "frontmatter lacks a description");
  const name = f.replace(/\.md$/, "");
  const pinned = /^model:\s*sonnet\s*$/m.test(fm);
  if (PINNED.includes(name) && !pinned)
    fail(path, "mechanical command must carry `model: sonnet` in frontmatter");
  if (UNPINNED.includes(name) && /^model:/m.test(fm))
    fail(path, "interactive command must NOT pin a model (inherits the session)");
}

// ── fixed agents ────────────────────────────────────────────────────────────
// Every non-template agent needs name/tools/model, and must be shipped by
// both installers (a new agent that install.sh doesn't copy never reaches
// a global install — the exact bug that motivated this check).
const AGENT_MODEL = { review: "sonnet", release: "haiku", smoke: "sonnet",
  "profile-reader": "haiku" };
const installSh = read("install.sh");
const installPs1 = read("install.ps1");

for (const f of readdirSync(join(root, "core/agents"))) {
  const path = `core/agents/${f}`;
  const text = read(path);
  const fm = frontmatter(text);
  if (!fm) { fail(path, "missing or malformed YAML frontmatter"); continue; }
  if (f === "implementer.template.md") {
    for (const ph of ["<SURFACE_AGENT>", "<SURFACE_LABEL>", "<SURFACE_PATH>",
      "<SURFACE_TOOLS>", "<SURFACE_MODEL>", "<PROJECT_NAME>", "<SURFACE_CONVENTIONS>",
      "<SURFACE_EXTRA_NEVER>", "<SURFACE_DESIGN_INPUT>", "<SURFACE_TDD_STEP1>"])
      if (!text.includes(ph)) fail(path, `render placeholder ${ph} disappeared`);
    continue;
  }
  const name = f.replace(/\.md$/, "");
  if (!/^name:\s*\S/m.test(fm)) fail(path, "frontmatter lacks name");
  if (!/^tools:\s*\S/m.test(fm)) fail(path, "frontmatter lacks tools");
  const want = AGENT_MODEL[name];
  if (want && !new RegExp(`^model:\\s*${want}\\s*$`, "m").test(fm))
    fail(path, `frontmatter must pin \`model: ${want}\``);
  if (text.includes("<SURFACE_"))
    fail(path, "unrendered <SURFACE_*> placeholder in a non-template agent");
  if (!installSh.includes(`core/agents/${f}`))
    fail("install.sh", `does not copy core/agents/${f} (copy_fixed_agents)`);
  if (!installPs1.includes(`core\\agents\\${f}`))
    fail("install.ps1", `does not copy core\\agents\\${f} (Copy-FixedAgents)`);
}

// ── cross-references ────────────────────────────────────────────────────────
// Any `.claude/templates/<x>.md` referenced by a command or agent must exist
// in core/templates (they resolve to the installed copy of exactly that file).
const allDocs = [];
for (const dir of ["core/commands", "core/agents", "core/templates"])
  for (const f of readdirSync(join(root, dir)))
    if (f.endsWith(".md")) allDocs.push(`${dir}/${f}`);

for (const path of allDocs) {
  const text = read(path);
  for (const m of text.matchAll(/\.claude\/templates\/([a-z0-9.-]+\.md)/g)) {
    if (!existsSync(join(root, "core/templates", m[1])))
      fail(path, `references .claude/templates/${m[1]} which is not in core/templates/`);
  }
  for (const m of text.matchAll(/subagent_type:\s*(?:`|)([a-z-]+)(?:`|)/g)) {
    const t = m[1];
    if (["review", "release", "smoke", "profile-reader"].includes(t)) continue;
    if (t.startsWith("<")) continue; // <surface.agent> placeholder
    if (!existsSync(join(root, "core/agents", `${t}.md`)))
      fail(path, `dispatches subagent_type ${t} with no core/agents/${t}.md`);
  }
}

// ── profile ─────────────────────────────────────────────────────────────────
for (const p of ["profile/PIPELINE.template.md", "profile/SCHEMA.md",
  "profile/cohorte.config.template.yaml"])
  if (!existsSync(join(root, p))) fail(p, "missing");

const tpl = read("profile/PIPELINE.template.md");
if (/^\s*model:\s*inherit\b/m.test(tpl))
  fail("profile/PIPELINE.template.md",
    "a surfaces[] example pins `model: inherit` — examples must default to sonnet " +
    "(inherit bills at the lead session's model)");

// ── init-pipeline router steps ──────────────────────────────────────────────
const steps = join(root, "core/templates/steps/init-pipeline");
if (!existsSync(steps) || readdirSync(steps).length === 0)
  fail("core/templates/steps/init-pipeline", "router step files missing/empty");

// ── telemetry coverage ──────────────────────────────────────────────────────
// The funnel is only readable if every one of its stages pings — a single missing
// one silently truncates it (that is how /smoke, /review and /fix went unreported
// until 1.2.3). The phase list here must match SCHEMA.md §Telemetry's table.
const FUNNEL = ["brainstorm", "spec", "build", "smoke", "review", "fix", "ship"];
for (const c of FUNNEL)
  if (!/usage ping/i.test(read(`core/commands/${c}.md`)))
    fail(`core/commands/${c}.md`, "funnel command with no usage ping — breaks the telemetry funnel");
// …and nothing outside the funnel may ping (consent text scopes it to the funnel).
for (const f of readdirSync(join(root, "core/commands"))) {
  const c = f.replace(/\.md$/, "");
  // `telemetry-send.sh` + an argument = a call site; the bare filename (e.g. /doctor
  // listing the scripts it checks for) is a mention, not a ping.
  if (!FUNNEL.includes(c) && /telemetry-send\.sh +\S|usage ping/i.test(read(`core/commands/${f}`)))
    fail(`core/commands/${f}`, "non-funnel command pings telemetry — outside the consented scope");
}

// ── shipped scripts ─────────────────────────────────────────────────────────
// Every scripts/*.sh must be copied by BOTH shell installers. Callers chain these
// with `|| true`, so one an installer forgets is a silent no-op forever — no kanban
// card moves, no telemetry ping, no error. CI is the only place this is loud.
// The third installer, bin/cli.js (what `npx cohorte` runs), copies by rule rather
// than by name, so grepping for filenames can't see it — ci.yml dry-runs it into a
// scratch HOME and asserts the same postconditions instead. Both are needed: this
// check catches a forgotten name, that one catches a drifted rule.
// A `<name>.sh` with a `<name>.sh.template` sibling is a locally-rendered artifact
// (this repo dogfoods its own /init-pipeline), not a core asset — skip those.
const installers = { "install.sh": read("install.sh"), "install.ps1": read("install.ps1") };
const shipped = readdirSync(join(root, "scripts"));
for (const f of shipped.filter((f) => f.endsWith(".sh") && !shipped.includes(`${f}.template`)))
  for (const [name, src] of Object.entries(installers))
    if (!src.includes(`scripts/${f}`) && !src.includes(`scripts\\${f}`))
      fail(name, `never copies scripts/${f} into pipeline/scripts/ (silent no-op at runtime)`);

// ── workflow scripts ────────────────────────────────────────────────────────
// core/workflows/*.js run inside the Claude Code Workflow runtime: an async
// function body with agent()/pipeline()/… injected, plus one `export const
// meta` line. Validate the syntax the same way the runtime parses it (plain
// `node --check` would reject the top-level return/await), and the invariants:
// a meta literal, phase 0 through profile-reader, and no Date.now()-family
// calls (they would break workflow resume).
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflowsDir = join(root, "core/workflows");
if (!existsSync(workflowsDir) || readdirSync(workflowsDir).length === 0)
  fail("core/workflows", "workflow scripts missing/empty");
else for (const f of readdirSync(workflowsDir)) {
  if (!f.endsWith(".js")) continue;
  const path = `core/workflows/${f}`;
  const text = read(path);
  if (!/^export const meta = \{/m.test(text))
    fail(path, "missing the `export const meta = {…}` literal");
  if (!text.includes("agentType: 'profile-reader'"))
    fail(path, "phase 0 must read the profile via the profile-reader agent");
  if (/\bDate\.now\(\)|\bMath\.random\(\)|new Date\(\)/.test(text))
    fail(path, "Date.now()/Math.random()/new Date() are unavailable in workflow scripts");
  try {
    new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "args",
      "budget", "workflow", text.replace(/^export const meta/m, "const meta"));
  } catch (e) {
    fail(path, `does not parse as a workflow body: ${e.message}`);
  }
}
// Both shell installers must copy the workflows dir (bin/cli.js copies by rule,
// covered by the ci.yml dry-run).
if (!installSh.includes("core/workflows"))
  fail("install.sh", "does not copy core/workflows (copy_core)");
if (!installPs1.includes("core\\workflows"))
  fail("install.ps1", "does not copy core\\workflows (Copy-Core)");

// ── report ──────────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`validate-core: ${errors.length} error(s)\n`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log("validate-core: OK");
