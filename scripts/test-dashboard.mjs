#!/usr/bin/env node
// Tests for the dashboard's server modules (dashboard/server/*.js).
//
// These are shipped runtime code with real logic and zero coverage until now:
// a hand-rolled YAML parser that every /cohorte-doctor check is derived from, a metrics
// aggregator, the JS port of /cohorte-doctor, an Obsidian board parser, the fleet
// registry, and an HTTP layer whose guards are the dashboard's only defence
// against a web page driving the local agent.
//
//   node scripts/test-dashboard.mjs

import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { parse, parseProfileBlock } = require(join(root, "dashboard/server/yaml.js"));
const { metrics } = require(join(root, "dashboard/server/metrics.js"));
const { usage } = require(join(root, "dashboard/server/usage.js"));
const { state, scanSpecs } = require(join(root, "dashboard/server/doctor.js"));
const { kanban } = require(join(root, "dashboard/server/kanban.js"));
const fleet = require(join(root, "dashboard/server/fleet.js"));

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const tmps = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "dash-")); tmps.push(d); return d; };
const write = (p, s) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };

// ── yaml.js ──────────────────────────────────────────────────────────────────
console.log("yaml.js — the profile parser");
{
  eq("scalars: bool / int / null / quoted",
    parse("a: true\nb: 12\nc: null\nd: \"x: y\"\ne: ~"),
    { a: true, b: 12, c: null, d: "x: y", e: null });
  eq("flow array", parse("t: [Read, Write, mcp__serena]").t, ["Read", "Write", "mcp__serena"]);
  eq("flow map", parse("p: { api: 3333, web: 5173 }").p, { api: 3333, web: 5173 });
  eq("nested map", parse("a:\n  b:\n    c: 1").a.b, { c: 1 });
  eq("block sequence of scalars", parse("d:\n  - one\n  - two").d, ["one", "two"]);
  eq("block sequence of maps",
    parse("s:\n  - key: a\n    path: x\n  - key: b\n    path: y").s,
    [{ key: "a", path: "x" }, { key: "b", path: "y" }]);
  eq("comment after a value is stripped", parse("a: 1   # note").a, 1);
  eq("a # inside quotes is NOT a comment", parse('a: "x # y"').a, "x # y");
  eq("a # not preceded by whitespace is literal", parse("a: c#d").a, "c#d");
  eq("empty value ⇒ null", parse("a:").a, null);
  eq("a colon in the value survives", parse('m: "cd x && node ace migration:run"').m,
    "cd x && node ace migration:run");
  eq("empty flow array", parse("a: []").a, []);
  check("no fenced block ⇒ null", parseProfileBlock("# just prose") === null);

  // The real thing: the shipped template must round-trip.
  const tpl = readFileSync(join(root, "profile/PIPELINE.template.md"), "utf8");
  const p = parseProfileBlock(tpl);
  check("the shipped PIPELINE.template.md parses", !!p);
  eq("…surfaces are a list of 2", (p.surfaces || []).length, 2);
  eq("…surface tools survive as an array", p.surfaces[0].tools.length, 7);
  eq("…uses_design is a real boolean", p.surfaces[1].uses_design, true);
  eq("…build_cmd stays an empty string, not null", p.surfaces[0].build_cmd, "");
  eq("…gate.deny is a list of 4", p.gate.deny.length, 4);
  eq("…gate.preflight.max_age_minutes is a number", p.gate.preflight.max_age_minutes, 30);
  eq("…port_base flow map", p.isolation.port_base, { api: 3333, web: 5173 });
  eq("…a chained migrate command survives", p.commands.migrate, "cd apps/api && node ace migration:run");
}

// ── metrics.js ───────────────────────────────────────────────────────────────
console.log("metrics.js — the funnel aggregate");
{
  const d = scratch();
  const lines = [
    JSON.stringify({ ts: "2026-01-01T00:00:00Z", feature: "f1", phase: "build", seconds: 100, surfaces: { backend: "ok", frontend: "error" } }),
    JSON.stringify({ ts: "2026-01-01T01:00:00Z", feature: "f1", phase: "review", seconds: 50, surfaces: { backend: "REVISE:2" } }),
    JSON.stringify({ ts: "2026-01-01T02:00:00Z", feature: "f1", phase: "fix", seconds: 20, surfaces: { backend: "ok" } }),
    JSON.stringify({ ts: "2026-01-01T03:00:00Z", feature: "f1", phase: "cycle", seconds: 0, rounds: 3, smoke: "SKIPPED", surfaces: { backend: "SHIP:0" } }),
    // legacy: one line PER surface, folded into one batch, wall-clock = max
    JSON.stringify({ ts: "2026-01-02T00:00:00Z", feature: "f2", phase: "build", surface: "backend", seconds: 10, result: "ok" }),
    JSON.stringify({ ts: "2026-01-02T00:00:00Z", feature: "f2", phase: "build", surface: "frontend", seconds: 40, result: "ok" }),
    "not json at all",
    JSON.stringify({ ts: "x", feature: "f3" }),           // no phase ⇒ skipped
    JSON.stringify({ ts: "x", feature: "f3", phase: "build" }), // neither surfaces nor surface ⇒ skipped
  ];
  mkdirSync(join(d, ".claude"), { recursive: true });
  writeFileSync(join(d, ".claude", "pipeline-metrics.jsonl"), lines.join("\n") + "\n");
  const m = metrics({ projectRoot: d });

  eq("malformed + incomplete lines are skipped", m.batches, 5);
  const f1 = m.features.find(f => f.feature === "f1");
  const f2 = m.features.find(f => f.feature === "f2");
  eq("per-phase wall-clock", f1.phases.build.seconds, 100);
  eq("fix rounds counted", f1.fixRounds, 1);
  eq("cycle rounds surface outside `surfaces`", f1.cycleRounds, 3);
  eq("legacy lines fold into ONE batch", Object.keys(f2.surfaces).sort(), ["backend", "frontend"]);
  eq("…with wall-clock = the slowest surface", f2.phases.build.seconds, 40);
  eq("`error` counts as a surface failure", f1.surfaces.frontend.failures, 1);
  eq("a REVISE verdict counts as a failure", f1.surfaces.backend.failures, 1);
  check("newest feature first", m.features[0].feature === "f2", m.features[0].feature);
  check("no metrics file ⇒ present:false", metrics({ projectRoot: scratch() }).present === false);
}

// ── usage.js ─────────────────────────────────────────────────────────────────
// Wraps the ESM metrics collector for the CJS server. The failure that matters is
// not a crash: a project with no transcripts must say so, because rendering zeros
// reads as "this pipeline costs nothing" rather than "nothing was measured".
console.log("usage.js — the collector bridge");
{
  const empty = usage({ projectRoot: scratch() });
  check("a project with no transcripts reports present:false", empty.present === false);
  check("…and says why rather than returning silent zeros",
    typeof empty.error === "string" && empty.error.length > 0, JSON.stringify(empty));

  // Same project twice: the second call must come from cache, or the panel's polling
  // would re-parse tens of MB of transcripts on every refresh.
  const d = scratch();
  const t0 = Date.now(); usage({ projectRoot: d });
  const t1 = Date.now(); usage({ projectRoot: d }); const cached = Date.now() - t1;
  check("a repeated read is served from cache", cached <= Math.max(50, (t1 - t0)), `${cached}ms`);
}

// ── doctor.js ────────────────────────────────────────────────────────────────
console.log("doctor.js — the /cohorte-doctor port");
{
  const spec = (fm) => `---\n${fm}\n---\n\n# x\n`;
  const d = scratch();
  mkdirSync(join(d, "specs"), { recursive: true });
  writeFileSync(join(d, "specs", "a.md"), spec("feature_id: a\ntitle: A\nstatus: frozen\nbranch: feature/a"));
  writeFileSync(join(d, "specs", "b.md"), spec("feature_id: b\nstatus: shipped   # done"));
  writeFileSync(join(d, "specs", "c.md"), "no front-matter at all");
  writeFileSync(join(d, "specs", "_template.md"), spec("status: draft"));
  // /cohorte-audit writes this file by design and it has no front-matter. Scanning it as a
  // spec made /cohorte-doctor warn about a file cohorte itself had just created — it fired in
  // every project that had ever run /cohorte-audit.
  writeFileSync(join(d, "specs", "refactor-backlog.md"), "# Refactor Backlog\n\n## backend\n- [ ] x\n");
  const specs = scanSpecs(d);
  eq("_template.md is excluded", specs.length, 3);
  eq("the /cohorte-audit backlog is not scanned as a spec",
    specs.some(s => s.file === "refactor-backlog.md"), false);
  eq("front-matter fields are read", specs.find(s => s.id === "a").title, "A");
  eq("a trailing comment is stripped from status", specs.find(s => s.id === "b").status, "shipped");
  eq("no front-matter ⇒ id falls back to the filename", specs.find(s => s.file === "c.md").id, "c");
}
{
  // A fully-wired synthetic project must come back green on the checks that can
  // be computed from disk.
  const g = scratch();                       // stands in for ~/.claude
  const d = scratch();
  const gate = {
    deny: ["x"], ask: ["y"], ask_on_default_branch: ["git push"], default_branch: "main",
    preflight: { enabled: true, agents: ["review"], max_age_minutes: 30 },
  };
  writeFileSync(join(d, "PIPELINE.md"), [
    "```yaml pipeline-profile",
    "name: Proj",
    "retrieval:",
    "  provider: serena",
    "surfaces:",
    "  - key: backend",
    "    path: apps/api",
    "    agent: backend",
    "gate:",
    "  default_branch: main",
    '  deny: ["x"]',
    '  ask: ["y"]',
    '  ask_on_default_branch: ["git push"]',
    "  preflight:",
    "    enabled: true",
    "    agents: [review]",
    "    max_age_minutes: 30",
    "```",
  ].join("\n"));
  mkdirSync(join(d, ".claude", "agents"), { recursive: true });
  mkdirSync(join(d, ".claude", "pipeline"), { recursive: true });
  writeFileSync(join(d, ".claude", "pipeline", "VERSION"), "9.9.9\n");
  writeFileSync(join(d, ".claude", "agents", "backend.md"), "x");
  writeFileSync(join(d, ".claude", "gate-config.json"), JSON.stringify(gate));
  writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { serena: {} } }));
  mkdirSync(join(d, ".claude", "workflows"), { recursive: true });
  for (const w of ["review.js", "audit.js", "refactor.js"]) {
    writeFileSync(join(d, ".claude", "workflows", w), "x");
  }
  writeFileSync(join(d, ".claude", "agents", "profile-reader.md"), "x");
  writeFileSync(join(d, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash|Task", hooks: [{ type: "command", command: 'py "C:\\x\\gate.py"' }] }] },
  }));

  const by = (checks, id) => checks.find(c => c.id === id);
  let s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  eq("profile parses ⇒ ok", by(s.checks, "profile").status, "ok");
  eq("surface agent present ⇒ ok", by(s.checks, "agents").status, "ok");
  eq("gate mirrors the profile ⇒ ok", by(s.checks, "gate").status, "ok");
  eq("Windows-quoted hook command is recognised", by(s.checks, "hooks").status, "ok");
  eq("retrieval wired in .mcp.json ⇒ ok", by(s.checks, "retrieval").status, "ok");
  eq("workflows + profile-reader ⇒ ok", by(s.checks, "workflows").status, "ok");

  // Local artifacts: a versioned preflight stamp is what made the phase gate ask on
  // every review dispatch forever, so its absence from .gitignore is a hard failure.
  check("no .gitignore ⇒ local artifacts flagged bad (the stamp is the breaking one)",
    by(s.checks, "artifacts").status === "bad"
      && /preflight\.ok/.test(by(s.checks, "artifacts").detail),
    by(s.checks, "artifacts").detail);
  writeFileSync(join(d, ".gitignore"),
    "node_modules/\n.claude/preflight.ok\n.claude/pipeline-metrics.jsonl\nspecs/reports/\n");
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  eq("all local artifacts gitignored ⇒ ok", by(s.checks, "artifacts").status, "ok");
  writeFileSync(join(d, ".gitignore"), "node_modules/\n.claude/\nspecs/reports/\n");
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  eq("a `.claude/` directory rule covers the files inside it",
    by(s.checks, "artifacts").status, "ok");

  // …and each check must actually FAIL when its precondition breaks.
  writeFileSync(join(d, ".claude", "gate-config.json"),
    JSON.stringify({ ...gate, preflight: { enabled: false } }));
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  check("gate-config preflight drift is detected",
    by(s.checks, "gate").status === "warn" && /preflight/.test(by(s.checks, "gate").detail),
    by(s.checks, "gate").detail);
  writeFileSync(join(d, ".claude", "gate-config.json"), JSON.stringify(gate));

  writeFileSync(join(d, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "python3 /x/gate.py" }] }] },
  }));
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  check("a Bash-only matcher is flagged (the 1.3.0 dead phase gate)",
    by(s.checks, "hooks").status === "warn" && /Task/.test(by(s.checks, "hooks").detail),
    by(s.checks, "hooks").detail);

  writeFileSync(join(d, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [
      { matcher: "Bash|Task", hooks: [{ type: "command", command: "python3 /x/gate.py" }] },
      { matcher: "Bash|Task", hooks: [{ type: "command", command: 'py "/x/gate.py"' }] },
    ] },
  }));
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  check("a duplicate registration is flagged (it double-prompts)",
    by(s.checks, "hooks").status === "warn" && /2×/.test(by(s.checks, "hooks").detail),
    by(s.checks, "hooks").detail);

  rmSync(join(d, ".mcp.json"));
  writeFileSync(join(d, ".claude", "agents", "orphan.md"), "x");
  s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  check("provider declared but never wired ⇒ warn",
    by(s.checks, "retrieval").status === "warn", by(s.checks, "retrieval").detail);
  check("an agent file with no surface ⇒ orphan warn",
    by(s.checks, "agents").status === "warn" && /orphan/.test(by(s.checks, "agents").detail),
    by(s.checks, "agents").detail);

  const bare = scratch();
  s = await state({ projectRoot: bare, globalDir: g, cliVersion: "9.9.9" });
  eq("no PIPELINE.md ⇒ profile bad", by(s.checks, "profile").status, "bad");
  eq("no core ⇒ core bad", by(s.checks, "core").status, "bad");
}

// ── kanban.js ────────────────────────────────────────────────────────────────
console.log("kanban.js — the Obsidian board");
{
  const g = scratch(), vault = scratch(), d = scratch();
  writeFileSync(join(d, "PIPELINE.md"), "```yaml pipeline-profile\nname: Proj\n```");
  mkdirSync(join(vault, "Proj"), { recursive: true });
  writeFileSync(join(vault, "Proj", "Tasks.md"), [
    "---", "kanban-plugin: board", "---", "",
    "## Spec", "", "- [ ] Do a thing  #feat-a", "\t- a note", "",
    "## Shipped", "", "- [x] Old  #feat-z — PR #42", "",
    "%% kanban:settings", "%%", "",
  ].join("\n"));
  writeFileSync(join(g, "cohorte.config.yaml"), [
    "kanban:", "  enabled: true", "  boards:", "    Proj:", '      board: "Proj/Tasks.md"',
    "obsidian:", `  vault_path: "${vault.replace(/\\/g, "/")}"`,
  ].join("\n"));

  const k = kanban({ projectRoot: d, globalDir: g });
  check("board resolves for the profile name", k.enabled === true, k.reason);
  eq("columns parsed", k.columns.map(c => c.name), ["Spec", "Shipped"]);
  eq("cards counted", k.total, 2);
  eq("the #tag is extracted", k.columns[0].cards[0].tags, ["feat-a"]);
  eq("the tag is stripped from the display text", k.columns[0].cards[0].text, "Do a thing");
  eq("a checked card is done", k.columns[1].cards[0].done, true);
  eq("a bare #<num> is read as a PR reference", k.columns[1].cards[0].prs.map(p => p.num), ["42"]);
  check("the settings trailer is not parsed as a column",
    !k.columns.some(c => /kanban:settings/.test(c.name)));

  writeFileSync(join(g, "cohorte.config.yaml"), "kanban:\n  enabled: false\n");
  check("kanban disabled ⇒ enabled:false with a reason",
    kanban({ projectRoot: d, globalDir: g }).enabled === false);
  check("no config at all ⇒ enabled:false, never a throw",
    kanban({ projectRoot: d, globalDir: scratch() }).enabled === false);
}

// ── fleet.js ─────────────────────────────────────────────────────────────────
console.log("fleet.js — the project registry");
{
  const g = scratch(), p1 = scratch(), p2 = scratch();
  fleet.ensureSeed(g, p1);
  eq("seed adds the launch project", fleet.read(g), [p1]);
  fleet.ensureSeed(g, p1);
  eq("seeding twice does not duplicate", fleet.read(g).length, 1);
  fleet.add(g, p2);
  eq("add appends", fleet.read(g).length, 2);
  fleet.remove(g, p2);
  eq("remove drops it", fleet.read(g), [p1]);

  let threw = null;
  try { fleet.add(g, "relative/path"); } catch (e) { threw = e.message; }
  check("a relative path is rejected with a clear message",
    /must be absolute/.test(threw || ""), threw);
  threw = null;
  try { fleet.add(g, join(p1, "nope")); } catch (e) { threw = e.message; }
  check("a non-existent path is rejected", /not found/.test(threw || ""), threw);

  // legacy registry name is read, then migrated forward on the next write
  const g2 = scratch();
  writeFileSync(join(g2, "thebidouille-dashboard.json"), JSON.stringify({ projects: [p1] }));
  eq("the pre-rename registry is still read", fleet.read(g2), [p1]);

  const b = fleet.browse(p1);
  check("browse lists a directory", Array.isArray(b.dirs) && b.parent !== null);
  writeFileSync(join(p1, "PIPELINE.md"), "x");
  check("browse flags a pipeline project", fleet.browse(p1).isProject === true);
  const missing = fleet.browse(join(p1, "does-not-exist"));
  check("browse reports an unreadable dir in the body (not a throw)",
    !!missing.error && missing.dirs.length === 0, JSON.stringify(missing));
}

// ── index.js — the HTTP guards ───────────────────────────────────────────────
console.log("index.js — HTTP guards");
{
  const freePort = await new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
  });
  const home = scratch();                       // stands in for the user's home
  const globalDir = join(home, ".claude");      // …so <home>/.claude IS the global core
  mkdirSync(globalDir, { recursive: true });
  const proj = scratch();
  const start = require(join(root, "dashboard/server/index.js"));
  start({ projectRoot: proj, globalDir, port: freePort, host: "127.0.0.1", openBrowser: false, pkgRoot: root, version: "9.9.9" });
  const base = `http://127.0.0.1:${freePort}`;
  const post = (body, headers = { "content-type": "application/json" }) =>
    fetch(`${base}/api/action`, { method: "POST", headers, body: JSON.stringify(body) });

  // `Host` is a forbidden header name for fetch/undici — it silently drops it, so
  // a fetch-based assertion here passes against a server with NO guard at all.
  // Speak raw HTTP instead.
  const rawStatus = (host) => new Promise((res, rej) => {
    const s = net.connect(freePort, "127.0.0.1", () => {
      s.write(`GET /api/fleet HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    s.on("data", (c) => { buf += c; });
    s.on("end", () => res(Number((buf.match(/^HTTP\/1\.1 (\d+)/) || [])[1])));
    s.on("error", rej);
  });
  eq("a forged Host header is rejected (DNS rebinding)", await rawStatus("evil.example.com"), 403);
  eq("…while a loopback Host with a port passes", await rawStatus(`127.0.0.1:${freePort}`), 200);
  eq("…and a bracketed IPv6 loopback passes", await rawStatus(`[::1]:${freePort}`), 200);
  eq("…and bare 'localhost' passes", await rawStatus("localhost"), 200);

  const csrf = await fetch(`${base}/api/projects`, {
    method: "POST", headers: { "content-type": "text/plain" }, body: "path=/x",
  });
  eq("a state-changing request without JSON content-type is rejected (CSRF)", csrf.status, 403);

  eq("a GET on the API still works", (await fetch(`${base}/api/fleet`)).status, 200);

  const reset = await post({ action: "reset", project: home });
  eq("reset refuses a project whose .claude IS the global core", reset.status, 400);
  check("…and says why", /shared global core/.test((await reset.json()).error));

  const badPath = await post({ action: "install", project: join(proj, "nope") });
  eq("install refuses a non-existent project path", badPath.status, 400);

  const badAction = await post({ action: "rm -rf" });
  eq("an unknown action is rejected", badAction.status, 400);

  const badCmd = await post({ action: "claude", command: "/evil", project: proj });
  eq("a non-whitelisted slash command is rejected", badCmd.status, 400);

  // Both directions, because testing only the rejection missed a real bug: 2.0.0 prefixed
  // every command, the error message was updated to say `/cohorte-audit`, but the allowlist
  // regex still matched the bare names — so the server accepted the one command that no
  // longer exists and rejected the only one the UI can send. A rejection-only test is blind
  // to an allowlist that drifts away from the client.
  const staleCmd = await post({ action: "claude", command: "/audit", project: proj });
  eq("the pre-2.0.0 unprefixed command is rejected", staleCmd.status, 400);

  const goodCmd = await post({ action: "claude", command: "/cohorte-audit", project: proj });
  check("a prefixed whitelisted command passes the allowlist",
    goodCmd.status !== 400 || !/unsupported command/.test((await goodCmd.json()).error || ""));

  eq("a missing hashed asset 404s (never index.html)",
    (await fetch(`${base}/assets/index-DEADBEEF.js`)).status, 404);
  eq("a malformed percent-escape is a 400, not a 500",
    (await fetch(`${base}/%`)).status, 400);
  eq("an unknown API route 404s", (await fetch(`${base}/api/nope`)).status, 404);
}

// ── runtime.js + a non-Claude layout ────────────────────────────────────────
// Every path-dependent check used to assume `.claude/`. On a repo driven from Cursor that
// reported a healthy install as three ❌ and a ⚠️ — no core, no rendered agent, artifacts not
// ignored, hook not registered — and every one was wrong. A false red is worse than no check:
// it sends a human fixing something that is not broken.
console.log("doctor.js — a non-Claude runtime layout");
{
  const d = scratch();
  const g = join(d, "global-claude");
  mkdirSync(g, { recursive: true });

  const core = join(d, ".cohorte", "cursor");
  mkdirSync(join(core, "pipeline"), { recursive: true });
  writeFileSync(join(core, "pipeline", "VERSION"), "9.9.9\n");
  writeFileSync(join(core, "pipeline", "runtimes.json"), JSON.stringify({
    cursor: {
      label: "Cursor", scope: "project", core_version: "9.9.9",
      capabilities: { subagents: true, hooks: true, workflows: false, tool_restriction: true },
      paths: {
        core, commands: join(d, ".cursor", "commands"), agents: join(d, ".cursor", "agents"),
        hooks_config: join(d, ".cursor", "hooks.json"), state: ".cohorte",
      },
    },
  }));
  mkdirSync(join(d, ".cursor", "agents"), { recursive: true });
  writeFileSync(join(d, ".cursor", "agents", "api.md"), "---\nname: api\n---\n");
  writeFileSync(join(d, ".cursor", "hooks.json"), JSON.stringify({
    version: 1,
    hooks: { beforeShellExecution: [{ command: `python3 ${core}/hooks/gate.py --runtime cursor` }] },
  }));
  mkdirSync(join(d, ".cohorte"), { recursive: true });
  const gate = { deny: ["rm -rf /"], ask: [], ask_on_default_branch: [], default_branch: "main" };
  writeFileSync(join(d, ".cohorte", "gate-config.json"),
    JSON.stringify({ ...gate, preflight: { enabled: false } }));
  writeFileSync(join(d, ".gitignore"),
    ".cohorte/preflight.ok\n.cohorte/pipeline-metrics.jsonl\nspecs/reports/\n");
  writeFileSync(join(d, "PIPELINE.md"), [
    "```yaml pipeline-profile", "name: demo",
    "surfaces:", "  - key: api", "    path: src/api", "    agent: api",
    "gate:", "  deny:", "    - rm -rf /", "  default_branch: main",
    "  preflight:", "    enabled: false", "```",
  ].join("\n"));

  const s = await state({ projectRoot: d, globalDir: g, cliVersion: "9.9.9" });
  const pick = id => s.checks.find(c => c.id === id) || {};
  const st = id => pick(id).status;
  const dt = id => pick(id).detail;

  eq("the runtime is discovered from runtimes.json", s.runtimes.map(r => r.id), ["cursor"]);
  check("the core in .cohorte/<id>/ counts as installed", st("core") === "ok", dt("core"));
  check("agents are looked for in .cursor/agents", st("agents") === "ok", dt("agents"));
  check("gate-config is read from .cohorte, not .claude", st("gate") === "ok", dt("gate"));
  check("artifact paths are named against the right state dir",
    st("artifacts") === "ok" && !/\.claude/.test(dt("artifacts")), dt("artifacts"));
  // Cursor's registration is a flat {command} under beforeShellExecution — read with Claude's
  // matcher-group shape it looks absent, which is exactly the false red this guards.
  check("the Cursor hook envelope is recognised", st("hooks") === "ok", dt("hooks"));
  check("workflows are skipped, not reported missing",
    st("workflows") === "skip" && /Cursor/.test(dt("workflows")), dt("workflows"));
  check("nothing is reported broken on a healthy non-Claude install",
    s.summary.bad === 0 && s.summary.warn === 0, JSON.stringify(s.summary));

  // The metrics sink follows `<state>` too.
  writeFileSync(join(d, ".cohorte", "pipeline-metrics.jsonl"),
    JSON.stringify({ ts: "2026-01-01T00:00:00Z", feature: "f", phase: "build", seconds: 10,
      surfaces: { api: "ok" } }) + "\n");
  check("metrics are read from the runtime's state dir",
    metrics({ projectRoot: d, globalDir: g }).batches === 1);
}

for (const d of tmps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
console.log("");
if (failures) { console.error(`test-dashboard: ${failures} failure(s)`); process.exit(1); }
console.log("test-dashboard: OK");
process.exit(0);   // the HTTP server has no handle to close
