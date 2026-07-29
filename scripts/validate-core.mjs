#!/usr/bin/env node
// Validates the structural invariants of the cohorte core — the things a
// prose refactor can silently break. Run by CI on every push/PR; run it
// locally with `node scripts/validate-core.mjs`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
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
const AGENT_MODEL = { review: "sonnet", release: "haiku", smoke: "sonnet" };
const installSh = read("install.sh");
const installPs1 = read("install.ps1");

for (const f of readdirSync(join(root, "core/agents"))) {
  const path = `core/agents/${f}`;
  const text = read(path);
  const fm = frontmatter(text);
  if (!fm) { fail(path, "missing or malformed YAML frontmatter"); continue; }
  if (f === "implementer.template.md") {
    for (const ph of ["<SURFACE_AGENT>", "<SURFACE_LABEL>", "<SURFACE_PATH>",
      "<SURFACE_TOOLS>", "<SURFACE_MODEL>", "<PROJECT_NAME>",
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
    if (["review", "release", "smoke"].includes(t)) continue;
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

// ── report ──────────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`validate-core: ${errors.length} error(s)\n`);
  for (const e of errors) console.error("  ✗ " + e);
  process.exit(1);
}
console.log("validate-core: OK");
