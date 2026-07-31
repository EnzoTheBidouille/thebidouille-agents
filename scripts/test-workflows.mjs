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
// byte-identical to a clean surface. Both review.js and cycle.js scored that as
// SHIP, and cycle.js went on to tick the DoD and stamp the freshness gate over
// code no reviewer had read. A unit test is the only thing that catches it: the
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

const BASE_CYCLE = [
  ["profile", PROFILE],
  ["ready", { frozen: true, gaps: [], designLinks: "none" }],
  ["preflight", { pass: true }],
  ["stage-diff", { surfaces: TOUCHED }],
  ["build:", "handoff ok"],
  ["fix:", "handoff ok"],
  ["close", "done"],
];

// ── review.js ────────────────────────────────────────────────────────────────
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

// ── cycle.js ─────────────────────────────────────────────────────────────────
console.log("cycle.js");
{
  const { result } = await run("cycle.js", replier([
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]));
  check("clean run, smoke off ⇒ SHIP-READY", result.outcome === "SHIP-READY", `got ${result.outcome}`);
  check("smoke off ⇒ smoke: SKIPPED", result.smoke === "SKIPPED", result.smoke);
  check("smoke off ⇒ next warns nobody ran the code",
    /\/smoke/.test(result.next), result.next);
  check("clean run ⇒ no questions", (result.questions || []).length === 0, JSON.stringify(result.questions));
}
{
  const { result } = await run("cycle.js", replier([
    ["smoke", { pass: true, failures: [] }],
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]), { feature: "feat-x", smoke: true });
  check("clean run, smoke on ⇒ SHIP-READY", result.outcome === "SHIP-READY", `got ${result.outcome}`);
  check("smoke on ⇒ smoke: PASS", result.smoke === "PASS", result.smoke);
  check("smoke on + clean ⇒ next is a straight /ship",
    /straight shot/.test(result.next), result.next);
}
{
  // THE regression, cycle-side: dead reviewers used to exit SHIP-READY, which
  // ticks the DoD and stamps the freshness gate.
  const { result } = await run("cycle.js", replier([
    ["review:", null], ...BASE_CYCLE,
  ]), { feature: "feat-x", maxRounds: 2 });
  check("all reviewers dead ⇒ not SHIP-READY", result.outcome !== "SHIP-READY", `got ${result.outcome}`);
  check("all reviewers dead ⇒ verdict not SHIP", result.verdict !== "SHIP", result.verdict);
  check("all reviewers dead ⇒ surfaces reported",
    (result.unreviewedSurfaces || []).length === 2, JSON.stringify(result.unreviewedSurfaces));
  check("all reviewers dead ⇒ a question names them",
    (result.questions || []).some(q => /not reviewed/i.test(q)), JSON.stringify(result.questions));
}
{
  // …and it must retry the review round rather than dispatching an empty fix round.
  const { calls } = await run("cycle.js", replier([
    ["review:", null], ...BASE_CYCLE,
  ]), { feature: "feat-x", maxRounds: 3 });
  check("dead reviewers ⇒ review retried across rounds",
    calls.filter(c => c.startsWith("review:")).length > 2,
    `review calls: ${calls.filter(c => c.startsWith("review:")).length}`);
  check("dead reviewers ⇒ no empty fix round dispatched",
    !calls.some(c => c.startsWith("fix:")), calls.join(","));
}
{
  const { result } = await run("cycle.js", replier([
    ["ready", { frozen: false, gaps: ["status is draft"], designLinks: "none" }], ...BASE_CYCLE,
  ]));
  check("unfrozen spec ⇒ NOT-READY", result.outcome === "NOT-READY", `got ${result.outcome}`);
  check("unfrozen spec ⇒ the gap is in questions",
    (result.questions || []).some(q => /draft/.test(q)), JSON.stringify(result.questions));
}
{
  const { result } = await run("cycle.js", replier([
    ["smoke", { pass: false, failures: ["❌ POST /x · expected 201 got 500 · apps/api/a.ts"] }],
    ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]), { feature: "feat-x", smoke: true, maxRounds: 1 });
  check("smoke on + FAIL ⇒ not SHIP-READY", result.outcome !== "SHIP-READY", `got ${result.outcome}`);
  check("smoke on + FAIL ⇒ smoke: FAIL", result.smoke === "FAIL", result.smoke);
}
{
  // A finding in round 1 that the fix clears must let round 2 exit clean.
  let round = 0;
  const { result } = await run("cycle.js", (prompt, opts) => {
    const l = opts.label || "";
    if (l.startsWith("review:")) {
      round++;
      return round <= 2 ? { verdict: "REVISE", findings: [finding({ severity: "CRITICAL" })] }
        : { verdict: "SHIP", findings: [] };
    }
    if (l.startsWith("verify:")) return { refuted: false, reason: "holds" };
    return replier(BASE_CYCLE)(prompt, opts);
  }, { feature: "feat-x", maxRounds: 4 });
  check("findings then clean ⇒ SHIP-READY", result.outcome === "SHIP-READY", `got ${result.outcome}`);
  check("findings then clean ⇒ took >1 round", result.rounds > 1, `rounds ${result.rounds}`);
}
{
  // A refuted CRITICAL must not force a fix round.
  const { result, calls } = await run("cycle.js", (prompt, opts) => {
    const l = opts.label || "";
    if (l.startsWith("review:")) return { verdict: "REVISE", findings: [finding({ severity: "CRITICAL" })] };
    if (l.startsWith("verify:")) return { refuted: true, reason: "guarded upstream" };
    return replier(BASE_CYCLE)(prompt, opts);
  }, { feature: "feat-x", maxRounds: 2 });
  check("cross-check refutes the only CRITICAL ⇒ SHIP-READY",
    result.outcome === "SHIP-READY", `got ${result.outcome}`);
  check("refuted finding ⇒ no fix round", !calls.some(c => c.startsWith("fix:")), calls.join(","));
}
{
  const { result } = await run("cycle.js", replier([
    ["build:", null], ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]));
  check("dead implementers ⇒ a question names them",
    (result.questions || []).some(q => /implementer\(s\) died/.test(q)), JSON.stringify(result.questions));
}
{
  const { result } = await run("cycle.js", replier([
    ["profile", { error: "PIPELINE.md not found" }], ...BASE_CYCLE,
  ]));
  check("unreadable profile ⇒ ABORTED", result.outcome === "ABORTED", `got ${result.outcome}`);
}
{
  // A DEAD contract agent must not be reported as a successful re-authoring, and
  // must not hand every surface a "the contract was RE-AUTHORED, realign" item
  // pointing at a file nobody touched.
  const CONTRACT_PROFILE = {
    ...PROFILE,
    contract: { enabled: true, path: "packages/shared/src", ext: "ts", mechanism: "shared-types-zod", index: "" },
  };
  const contractFinding = finding({ severity: "CRITICAL", file: "packages/shared/src/feat-x.ts" });
  const { result, calls } = await run("cycle.js", (prompt, opts) => {
    const l = opts.label || "";
    if (l === "profile") return CONTRACT_PROFILE;
    if (l === "contract-fix") return null;              // the agent dies
    if (l.startsWith("review:")) return { verdict: "REVISE", findings: [contractFinding] };
    if (l.startsWith("verify:")) return { refuted: false, reason: "holds" };
    return replier(BASE_CYCLE)(prompt, opts);
    // maxRounds ≥ 2: the loop breaks at the cap BEFORE the fix block, so a
    // 1-round run never reaches the contract path at all (a vacuous test).
  }, { feature: "feat-x", maxRounds: 2 });
  check("dead contract agent ⇒ no fabricated contractChanges entry",
    (result.contractChanges || []).length === 0, JSON.stringify(result.contractChanges));
  check("dead contract agent ⇒ a question says the contract is UNCHANGED",
    (result.questions || []).some(q => /contract agent died/.test(q)), JSON.stringify(result.questions));
  check("dead contract agent ⇒ no surface told to realign against it",
    !calls.some(c => c.startsWith("fix:")), calls.join(","));
}
{
  // Preflight red with no owning surface used to spin the loop doing nothing
  // until the round cap, then report a stale verdict.
  const { result, calls } = await run("cycle.js", replier([
    ["preflight", { pass: false, tail: "error in vendor/thing.go: boom" }],
    ["build:", null],                                   // no implementer survives
    ...BASE_CYCLE,
  ]), { feature: "feat-x", maxRounds: 5 });
  check("red preflight with no owning surface ⇒ stops instead of spinning",
    result.rounds === 1, `burned ${result.rounds} round(s)`);
  check("…and dispatches no fix agent", !calls.some(c => c.startsWith("fix:")), calls.join(","));
  check("…and the question carries the failure tail",
    (result.questions || []).some(q => /no surface owns the failure/.test(q)),
    JSON.stringify(result.questions));
}
{
  // A finding under no surface path has no owner: it keeps the loop from exiting
  // clean while nobody is ever dispatched to fix it. Reachable because `touched`
  // is agent-supplied — the stage-diff agent can name a key the profile lacks.
  const orphan = finding({ severity: "CRITICAL", file: "tools/thing.sh", line: 9 });
  const { result } = await run("cycle.js", (prompt, opts) => {
    const l = opts.label || "";
    if (l === "stage-diff") return { surfaces: [{ key: "tools", diff: "d", files: ["tools/thing.sh"] }] };
    if (l.startsWith("review:")) return { verdict: "REVISE", findings: [orphan] };
    if (l.startsWith("verify:")) return { refuted: false, reason: "holds" };
    return replier(BASE_CYCLE)(prompt, opts);
  }, { feature: "feat-x", maxRounds: 3 });
  check("a finding owned by no surface names the file, not just 'run /fix manually'",
    (result.questions || []).some(q => /never dispatched/.test(q) && /tools\/thing\.sh:9/.test(q)),
    JSON.stringify(result.questions));
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
  const { result } = await run("cycle.js", replier([
    ["stage-diff", null], ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]));
  check("cycle: dead diff-stager ⇒ diagnosed as such, not 'wrong branch'",
    (result.questions || []).some(q => /diff-staging agent died/.test(q)),
    JSON.stringify(result.questions));
}
{
  const { result } = await run("cycle.js", replier([
    ["close", null], ["review:", { verdict: "SHIP", findings: [] }], ...BASE_CYCLE,
  ]));
  check("cycle: dead close agent ⇒ NOT SHIP-READY",
    result.outcome !== "SHIP-READY", `got ${result.outcome}`);
  check("cycle: dead close agent ⇒ a question says nothing was written",
    (result.questions || []).some(q => /NEVER written/.test(q)), JSON.stringify(result.questions));
  check("cycle: dead close agent ⇒ report path not claimed",
    !/^specs\//.test(String(result.report)), result.report);
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
