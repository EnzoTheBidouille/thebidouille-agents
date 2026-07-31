#!/usr/bin/env node
// Tests for the dashboard's server modules (dashboard/server/*.js).
//
// These are shipped runtime code with real logic and zero coverage until now:
// a hand-rolled YAML parser that every /doctor check is derived from, a metrics
// aggregator, the JS port of /doctor, an Obsidian board parser, the fleet
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

// ── doctor.js ────────────────────────────────────────────────────────────────
console.log("doctor.js — the /doctor port");
{
  const spec = (fm) => `---\n${fm}\n---\n\n# x\n`;
  const d = scratch();
  mkdirSync(join(d, "specs"), { recursive: true });
  writeFileSync(join(d, "specs", "a.md"), spec("feature_id: a\ntitle: A\nstatus: frozen\nbranch: feature/a"));
  writeFileSync(join(d, "specs", "b.md"), spec("feature_id: b\nstatus: shipped   # done"));
  writeFileSync(join(d, "specs", "c.md"), "no front-matter at all");
  writeFileSync(join(d, "specs", "_template.md"), spec("status: draft"));
  const specs = scanSpecs(d);
  eq("_template.md is excluded", specs.length, 3);
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
    preflight: { enabled: true, agents: ["review", "smoke"], max_age_minutes: 30 },
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
    "    agents: [review, smoke]",
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
  for (const w of ["review.js", "audit.js", "refactor.js", "cycle.js"]) {
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

  eq("a missing hashed asset 404s (never index.html)",
    (await fetch(`${base}/assets/index-DEADBEEF.js`)).status, 404);
  eq("a malformed percent-escape is a 400, not a 500",
    (await fetch(`${base}/%`)).status, 400);
  eq("an unknown API route 404s", (await fetch(`${base}/api/nope`)).status, 404);
}

for (const d of tmps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
console.log("");
if (failures) { console.error(`test-dashboard: ${failures} failure(s)`); process.exit(1); }
console.log("test-dashboard: OK");
process.exit(0);   // the HTTP server has no handle to close
