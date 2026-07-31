#!/usr/bin/env node
// Behavioural tests for core/workflows/*.js.
//
// The workflow runtime hands a script an async function body with agent() /
// parallel() / pipeline() / phase() / log() / args / budget injected. Nothing in
// a script touches the filesystem, so the whole orchestration is testable by
// injecting stub agents and asserting the returned verdict object.
//
// This exists because of one specific failure mode: agent() resolves to `null`
// when a subagent dies, and a dead reviewer produces zero findings — which is
// byte-identical to a clean surface. review.js scored that as SHIP over code no
// reviewer had read. A unit test is the only thing that catches it: the
// structural checks in validate-core.mjs cannot see verdict logic.
//
//   node scripts/test-workflows.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const PROFILE = {
  name: "testproj",
  vcs: { default_branch: "main" },
  contract: { enabled: false, path: "packages/shared/src", ext: "ts", mechanism: "none" },
  commands: { typecheck: "tsc --noEmit", lint_quiet: "lint -q", test_quiet: "test --dot" },
  surfaces: [
    { key: "backend", path: "apps/api", agent: "backend", uses_design: false },
    { key: "frontend", path: "apps/web", agent: "frontend", uses_design: true },
  ],
};

const TOUCHED = [
  { key: "backend", diff: "specs/reports/f.backend.diff", files: ["apps/api/a.ts"] },
  { key: "frontend", diff: "specs/reports/f.frontend.diff", files: ["apps/web/b.tsx"] },
];

const finding = (over = {}) => ({
  severity: "HIGH", file: "apps/api/a.ts", line: 3, kind: "quality",
  problem: "p", fix: "f", ...over,
});

// Run one workflow script with a `reply(prompt, opts) => value` stub in place of
// every agent call. Returns { result, calls }.
async function run(script, reply, args = { feature: "feat-x" }) {
  const text = readFileSync(join(root, "core/workflows", script), "utf8")
    .replace(/^export const meta/m, "const meta");
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push(opts.label || "(unlabelled)");
    return reply(prompt, opts, calls);
  };
  // Mirrors the runtime's contract: a thunk that throws resolves to null, the
  // call itself never rejects.
  const parallel = thunks =>
    Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)));
  // Each item runs through every stage independently; a throwing stage drops
  // that item to null and skips its remaining stages.
  const pipeline = (items, ...stages) =>
    Promise.all(items.map(async (item, i) => {
      let v = item;
      for (const s of stages) {
        try { v = await s(v, item, i); } catch { return null; }
      }
      return v;
    }));
  const fn = new AsyncFunction(
    "agent", "parallel", "pipeline", "phase", "log", "args", "budget", "workflow", text);
  const result = await fn(
    agent, parallel, pipeline, () => {}, () => {}, args,
    { total: null, spent: () => 0, remaining: () => Infinity }, async () => {});
  return { result, calls };
}

// A reply table keyed by label prefix; the first matching prefix wins.
const replier = table => (prompt, opts) => {
  const label = opts.label || "";
  for (const [prefix, value] of table) {
    if (label === prefix || label.startsWith(prefix)) {
      return typeof value === "function" ? value(label) : value;
    }
  }
  return "ok";
};

const BASE_REVIEW = [
  ["profile", PROFILE],
  ["preflight", { pass: true }],
  ["stage-diff", { surfaces: TOUCHED }],
  ["stage-report", "done"],
];

console.log("review.js");
{
  const { result } = await run("review.js", replier([
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_REVIEW,
  ]));
  check("clean run ⇒ SHIP", result.verdict === "SHIP", `got ${result.verdict}`);
  check("clean run ⇒ no unreviewed surfaces", (result.unreviewedSurfaces || []).length === 0);
  check("clean run ⇒ next is /ship", String(result.next).startsWith("/ship"), result.next);
}
{
  // THE regression: every reviewer dies ⇒ zero findings ⇒ must NOT read as SHIP.
  const { result } = await run("review.js", replier([
    ["review:", null], ...BASE_REVIEW,
  ]));
  check("all reviewers dead ⇒ not SHIP", result.verdict !== "SHIP", `got ${result.verdict}`);
  check("all reviewers dead ⇒ both surfaces reported unreviewed",
    (result.unreviewedSurfaces || []).join(",") === "backend,frontend",
    JSON.stringify(result.unreviewedSurfaces));
  check("all reviewers dead ⇒ next says re-run",
    /re-run the review/.test(result.next), result.next);
}
{
  // One dead reviewer must not be masked by the other surface coming back clean.
  const { result } = await run("review.js", replier([
    ["review:backend", null],
    ["review:", { verdict: "SHIP", findings: [] }],
    ...BASE_REVIEW,
  ]));
  check("one reviewer dead ⇒ not SHIP", result.verdict !== "SHIP", `got ${result.verdict}`);
  check("one reviewer dead ⇒ names only that surface",
    (result.unreviewedSurfaces || []).join(",") === "backend", JSON.stringify(result.unreviewedSurfaces));
}
{
  // A SHIP carrying HIGH findings is a real verdict, but it is not "go ship it":
  // the conversational /review routes any surviving HIGH to /fix.
  const { result } = await run("review.js", replier([
    ["review:", { verdict: "SHIP", findings: [finding()] }], ...BASE_REVIEW,
  ]));
  check("SHIP + HIGH findings ⇒ verdict still SHIP", result.verdict === "SHIP");
  check("SHIP + HIGH findings ⇒ next routes to /fix, not /ship",
    String(result.next).startsWith("/fix"), result.next);
}
{
  const { result } = await run("review.js", replier([
    ["review:", { verdict: "SHIP", findings: [finding({ severity: "LOW" })] }], ...BASE_REVIEW,
  ]));
  check("SHIP + only LOW ⇒ next is /ship", String(result.next).startsWith("/ship"), result.next);
}
{
  const { result } = await run("review.js", replier([
    ["preflight", { pass: false, tail: "boom" }], ...BASE_REVIEW,
  ]));
  check("red preflight ⇒ ABORTED", result.verdict === "ABORTED", `got ${result.verdict}`);
}
{
  const { calls } = await run("review.js", replier([
    ["preflight", { pass: false, tail: "boom" }], ...BASE_REVIEW,
  ]));
  check("red preflight ⇒ zero reviewers spawned",
    !calls.some(c => c.startsWith("review:")), calls.join(","));
}

// ── args normalisation ───────────────────────────────────────────────────────
// The runtime passes `args` through verbatim, so a caller that JSON-encodes it
// hands the script a string. That string used to become the feature id itself —
// which is how a report was written to `specs/reports/{"feature": "x"}.md`.
console.log("args");
{
  const { result } = await run("review.js", replier([
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_REVIEW,
  ]), JSON.stringify({ feature: "feat-x" }));
  check("review: a JSON-encoded args string is parsed, not used as the id",
    result.verdict === "SHIP", `got ${result.verdict}`);
}
{
  let threw = "";
  try {
    await run("review.js", replier([...BASE_REVIEW]), { feature: '{"feature": "feat-x"}' });
  } catch (e) { threw = e.message; }
  check("review: a non-slug feature id throws before anything is written",
    /not a slug/.test(threw), threw || "(did not throw)");
}
{
  let threw = "";
  try {
    await run("review.js", replier([...BASE_REVIEW]), { feature: "../../etc/passwd" });
  } catch (e) { threw = e.message; }
  check("review: a path-shaped feature id is rejected",
    /not a slug/.test(threw), threw || "(did not throw)");
}

// ── Phase 0 profile handling ─────────────────────────────────────────────────
// A haiku profile-reader intermittently returns the profile as a JSON *string*
// under a wrapper field instead of at the top level. The old schema accepted that
// wrapper, so `surfaces` read as undefined ⇒ [] ⇒ parallel([]) ⇒ zero agents
// dispatched — and because every later guard compares against `surfaces`, an
// empty list made them all vacuously pass: a run reported a verdict having done
// nothing, indistinguishable from a clean run with an empty diff. Two properties
// are pinned per workflow: a wrapped return is recovered, an empty one aborts.
console.log("profile phase");
const WRAPPED = { output: JSON.stringify(PROFILE) };
const EMPTY_PROFILE = { ...PROFILE, surfaces: [] };
{
  const { result } = await run("review.js", replier([
    ["profile", WRAPPED],
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_REVIEW,
  ]));
  check("review: a string-wrapped profile is unwrapped, not silently empty",
    result.verdict === "SHIP", `got ${result.verdict}`);
}
{
  const { result, calls } = await run("review.js", replier([["profile", EMPTY_PROFILE], ...BASE_REVIEW]));
  check("review: no surfaces ⇒ ABORTED, not a verdict",
    result.verdict === "ABORTED", `got ${result.verdict}`);
  check("review: no surfaces ⇒ zero reviewers spawned",
    !calls.some(c => c.startsWith("review:")), calls.join(","));
}
{
  const { result } = await run("audit.js", replier([
    ["profile", EMPTY_PROFILE], ["gates", { failures: [] }], ["write-backlog", "done"],
  ]), {});
  check("audit: no surfaces ⇒ error, not an empty backlog",
    /no surfaces/.test(result.error || ""), JSON.stringify(result));
}
{
  const { result } = await run("refactor.js", replier([
    ["profile", EMPTY_PROFILE], ["read-backlog", { domains: [] }],
  ]), { domains: "all" });
  check("refactor: no surfaces ⇒ error, not a no-op success",
    /no surfaces/.test(result.error || ""), JSON.stringify(result));
}

// ── the dead-agent family, swept across every terminal/staging agent ─────────
// `agent()` returns null when a subagent dies. Any call whose result is turned
// into a CLAIM (a verdict, a path, "it is on disk") must distinguish "died" from
// "succeeded with nothing to say". This block is the sweep.
console.log("dead-agent sweep");
{
  const { result } = await run("review.js", replier([
    ["stage-diff", null], ...BASE_REVIEW,
  ]));
  check("review: dead diff-stager ⇒ ABORTED, not 'SHIP — nothing to review'",
    result.verdict === "ABORTED", `got ${result.verdict}: ${result.reason}`);
}
{
  const { result } = await run("review.js", replier([
    ["stage-report", null],
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_REVIEW,
  ]));
  check("review: dead report-stager ⇒ reportStaged false", result.reportStaged === false);
  check("review: dead report-stager ⇒ report path not claimed",
    !/^specs\//.test(String(result.report)), result.report);
  check("review: dead report-stager ⇒ next says nothing was written",
    /NEVER written/.test(result.next), result.next);
}
{
  const { result } = await run("audit.js", replier([
    ["profile", PROFILE], ["gates", { failures: [] }],
    ["audit:backend", null],
    ["audit:", { items: [] }], ["write-backlog", "done"],
  ]), {});
  check("audit: dead auditor ⇒ the domain is listed as NOT audited",
    (result.notAudited || []).join(",") === "backend", JSON.stringify(result.notAudited));
  check("audit: dead auditor ⇒ next tells you to re-audit it",
    /re-audit backend/.test(result.next), result.next);
}
{
  const { result } = await run("audit.js", replier([
    ["profile", PROFILE], ["gates", { failures: [] }],
    ["audit:", { items: [] }], ["write-backlog", null],
  ]), {});
  check("audit: dead backlog writer ⇒ path not claimed",
    !/^specs\//.test(String(result.backlog)), result.backlog);
}
{
  const { result } = await run("refactor.js", replier([
    ["profile", PROFILE], ["read-backlog", null],
  ]), { domains: "all" });
  check("refactor: dead backlog reader ⇒ says it died, not 'no open items'",
    /agent died/.test(String(result.error)), result.error);
}
{
  const items = ["- [ ] a", "- [ ] b", "- [ ] c", "- [ ] d", "- [ ] e"];
  const { result } = await run("refactor.js", replier([
    ["profile", PROFILE],
    ["read-backlog", { domains: [{ key: "backend", items }] }],
    ["verify:", { cleared: items, remaining: [], gatesGreen: true }],
    ["reverify:", { cleared: items, remaining: [], gatesGreen: true }],
    ["tick-backlog", null],
    ["refactor:", "handoff"],
  ]), { domains: "all" });
  check("refactor: dead ticker ⇒ backlogTicked false", result.backlogTicked === false);
  check("refactor: dead ticker ⇒ next warns the backlog still shows them open",
    /NOT ticked/.test(result.next), result.next);
}

// ── audit.js / refactor.js — smoke-level: they must return, not throw ────────
console.log("audit.js / refactor.js");
{
  const { result } = await run("audit.js", replier([
    ["profile", PROFILE],
    ["gates", { failures: [] }],
    ["audit:", { items: [{ severity: "HIGH", file: "apps/api/a.ts", line: 1, kind: "tdd", fix: "add a test" }] }],
    ["write-backlog", "done"],
  ]), {});
  check("audit returns a backlog path", result.backlog === "specs/refactor-backlog.md", JSON.stringify(result));
  check("audit counts every domain (surfaces + shared)",
    Object.keys(result.domains || {}).join(",") === "backend,frontend,shared", JSON.stringify(result.domains));
}
{
  const { result } = await run("refactor.js", replier([
    ["profile", PROFILE],
    ["read-backlog", { domains: [{ key: "backend", items: ["- [ ] a", "- [ ] b"] }] }],
  ]), { domains: "all" });
  check("refactor skips a domain below the item threshold",
    result.skipped && result.skipped.backend === 2, JSON.stringify(result));
}

console.log("");
if (failures) { console.error(`test-workflows: ${failures} failure(s)`); process.exit(1); }
console.log("test-workflows: OK");
