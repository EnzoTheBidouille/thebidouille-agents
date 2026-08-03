#!/usr/bin/env node
// Behavioural tests for scripts/loop.sh — the autonomous /cohorte-review ⇄ /cohorte-fix driver.
//
// The driver is pure shell around two JSON files it does not write, so it is
// testable end-to-end by putting a FAKE `claude` on PATH that produces those files
// per phase. What is pinned here cannot be seen by any structural check:
//
//   · exit 4 — /cohorte-build's readiness gate said NOT-READY, so no pass count helps
//   · exit 0/3 leave the right TERMINAL status in the spec's front-matter, which is
//     what makes an interrupted loop resumable (SCHEMA.md §Spec status)
//   · the front-matter stamps are written with awk on every platform — a `sed -i`
//     would pass on GNU and corrupt every spec on BSD/macOS
//   · --resume continues at the recorded pass instead of re-paying passes 1..n-1
//   · a spec with no front-matter still runs (the stamps are a silent no-op)
//
//   node scripts/test-loop.mjs

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const LOOP = join(root, "scripts/loop.sh");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const FM = `---
feature_id: feat-x
title: Feat X
status: frozen # draft → frozen → in-progress → in-review → shipped · blocked
branch: feature/feat-x
---

# Feat X
`;

// A fake `claude`: reads the phase out of the `-p "/<cmd> <id>"` argument and
// writes whatever the scenario says that phase produces. `$PHASES` is a
// newline-separated script of `<cmd>:<what to write>` steps, consumed in order,
// so a scenario can make pass 1 and pass 2 differ.
const FAKE_CLAUDE = `#!/usr/bin/env bash
set -u
prompt=""
while [ $# -gt 0 ]; do
  case "$1" in -p) prompt="$2"; shift 2 ;; *) shift ;; esac
done
cmd="\${prompt%% *}"
# The driver must dispatch the PREFIXED command (2.0.0) — an unprefixed /build would be
# shadowed by Claude Code's own built-in and never reach the pipeline, so fail loudly
# rather than let a regression pass by being lenient here.
case "$cmd" in
  /cohorte-*) ;;
  *) echo "fake claude: expected a /cohorte-* command, got '$cmd'" >&2; exit 9 ;;
esac
cmd="\${cmd#/cohorte-}"          # scenarios are keyed on the PHASE, which stays unprefixed
# Echoed so the tests can assert what the driver hands its children: an unattended child
# that cannot answer a permission prompt, and a background ceiling that must not fire.
echo "fake claude: bgceil=\${CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS:-unset}"
n=0; [ -f "$SCEN_DIR/count" ] && n=$(cat "$SCEN_DIR/count")
n=$((n + 1)); echo "$n" >"$SCEN_DIR/count"
step=$(sed -n "\${n}p" "$SCEN_DIR/phases")
echo "fake claude: phase=$cmd step=$step"
want="\${step%%:*}"; do_what="\${step#*:}"
[ "$want" = "$cmd" ] || { echo "fake claude: expected /$want, got /$cmd" >&2; exit 9; }
mkdir -p specs/reports
case "$do_what" in
  notready)
    printf '{"id":"feat-x","phase":"readiness","ts":"t","verdict":"NOT-READY","gaps":["contract|POST /o|no success shape"],"surfaces":["backend"]}' \\
      >specs/reports/feat-x.readiness.json ;;
  ready)
    printf '{"id":"feat-x","phase":"readiness","ts":"t","verdict":"READY","gaps":[],"surfaces":["backend"]}' \\
      >specs/reports/feat-x.readiness.json
    printf '{"id":"feat-x","phase":"build","ts":"t","surfaces":{"backend":"ok"},"dead":[]}' \\
      >specs/reports/feat-x.build.json ;;
  # READY, dispatched, and then cut short before §3's report — the harness terminating
  # background implementers, a teardown, a crash. No build.json, and exit 0 anyway.
  cutshort)
    printf '{"id":"feat-x","phase":"readiness","ts":"t","verdict":"READY","gaps":[],"surfaces":["backend","frontend"]}' \\
      >specs/reports/feat-x.readiness.json ;;
  clean)
    printf '{"id":"feat-x","phase":"review","ts":"t","verdict":"SHIP","findings":2,"blocking":0,"deferred":2,"unreviewed":[],"fingerprint":""}' \\
      >specs/reports/feat-x.verdict.json ;;
  deadreviewer)
    printf '{"id":"feat-x","phase":"review","ts":"t","verdict":"REVISE","findings":0,"blocking":0,"deferred":0,"unreviewed":["backend"],"fingerprint":""}' \\
      >specs/reports/feat-x.verdict.json ;;
  deadimplementer)
    printf '{"id":"feat-x","phase":"readiness","ts":"t","verdict":"READY","gaps":[],"surfaces":["backend"]}' \\
      >specs/reports/feat-x.readiness.json
    printf '{"id":"feat-x","phase":"build","ts":"t","surfaces":{"backend":"dead","frontend":"ok"},"dead":["backend"]}' \\
      >specs/reports/feat-x.build.json ;;
  blocking)
    printf '{"id":"feat-x","phase":"review","ts":"t","verdict":"REVISE","findings":3,"blocking":2,"deferred":1,"fingerprint":"aaaa1111bbbb2222"}' \\
      >specs/reports/feat-x.verdict.json ;;
  noop) : ;;
esac
exit 0
`;

// One scratch repo per scenario: a git checkout (loop.sh cds to its toplevel), a
// spec, the fake claude on PATH, and the phase script it plays out.
function scenario(phases, { frontmatter = FM } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cohorte-loop-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "specs/reports"), { recursive: true });
  writeFileSync(join(dir, "specs/feat-x.md"), frontmatter);
  git("add", "-A");
  git("commit", "-qm", "init");

  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "phases"), phases.join("\n") + "\n");
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
  return { dir, bin };
}

function runLoop({ dir, bin }, args) {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SCEN_DIR: dir,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t",
  };
  // Never inherit these from whoever runs the suite: the default child flags and the
  // background ceiling are exactly what the assertions below are about.
  delete env.CLAUDE_FLAGS;
  delete env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
  const r = spawnSync("bash", [LOOP, ...args], { cwd: dir, encoding: "utf8", env });
  const spec = readFileSync(join(dir, "specs/feat-x.md"), "utf8");
  const fm = k => {
    const m = spec.match(new RegExp(`^${k}:\\s*([^#\\n]*)`, "m"));
    return m ? m[1].trim() : null;
  };
  const logPath = join(dir, "specs/reports/feat-x.loop.log");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return { code: r.status, out: `${r.stdout}${r.stderr}`, spec, fm, log };
}

console.log("loop.sh — readiness gate");
{
  const s = scenario(["build:notready"]);
  const r = runLoop(s, ["feat-x"]);
  check("NOT-READY ⇒ exit 4, not 2", r.code === 4, `got ${r.code}: ${r.out.trim().split("\n").pop()}`);
  check("NOT-READY ⇒ says the spec is not implementable",
    /not implementable/i.test(r.out), r.out.trim().split("\n").pop());
  check("NOT-READY ⇒ points at /cohorte-spec", /\/cohorte-spec feat-x/.test(r.out));
  check("NOT-READY ⇒ spec left blocked", r.fm("status") === "blocked", r.fm("status"));
  check("NOT-READY ⇒ no review ran (the gate is the point)", !/phase=review/.test(r.out));
  check("NOT-READY ⇒ the build stamp is NOT written",
    !existsSync(join(s.dir, "specs/reports/feat-x.built")));
}

console.log("loop.sh — clean run");
{
  const s = scenario(["build:ready", "review:clean"]);
  const r = runLoop(s, ["feat-x"]);
  check("clean ⇒ exit 0", r.code === 0, `got ${r.code}: ${r.out}`);
  check("clean ⇒ status in-review (ready to /cohorte-ship)", r.fm("status") === "in-review", r.fm("status"));
  check("clean ⇒ loop state cleared", r.fm("loop_pass") === "0" && r.fm("loop_phase") === "done",
    `${r.fm("loop_pass")}/${r.fm("loop_phase")}`);
  check("clean ⇒ the deferred count is named, not dropped",
    /2 deferred finding\(s\) parked/.test(r.out), r.out.trim().split("\n").pop());
  check("clean ⇒ the status comment survives the awk rewrite",
    /^status: in-review # draft/m.test(r.spec), r.spec.split("\n")[3]);
}

console.log("loop.sh — a dead subagent is never a clean result");
{
  // A dead implementer: /cohorte-build finishes fine having built one surface of two. Reviewing
  // that would spend N reviewers auditing a half-built feature and report its holes as
  // findings to fix — the wrong diagnosis at the wrong price.
  const s = scenario(["build:deadimplementer"]);
  const r = runLoop(s, ["feat-x"]);
  check("dead implementer ⇒ exit 2, not a review pass", r.code === 2, `got ${r.code}: ${r.out}`);
  check("dead implementer ⇒ no reviewer was spawned", !/phase=review/.test(r.out));
  check("dead implementer ⇒ names the cause", /implementer died/.test(r.out),
    r.out.trim().split("\n").pop());
  check("dead implementer ⇒ spec left blocked", r.fm("status") === "blocked", r.fm("status"));
}
{
  // THE dangerous one: blocking == 0 because the only reviewer that could have found
  // something never answered. Exiting 0 here would report "clean" about unread code and
  // send the human to /cohorte-ship.
  const s = scenario(["build:ready", "review:deadreviewer"]);
  const r = runLoop(s, ["feat-x"]);
  check("dead reviewer + blocking 0 ⇒ NOT exit 0", r.code !== 0, `got ${r.code}: ${r.out}`);
  check("dead reviewer ⇒ exit 2 (no usable verdict)", r.code === 2, `got ${r.code}`);
  check("dead reviewer ⇒ names the unreviewed surface", /reviewer died/.test(r.out),
    r.out.trim().split("\n").pop());
  check("dead reviewer ⇒ never says clean", !/✓ clean/.test(r.out));
  check("dead reviewer ⇒ spec is NOT left in-review", r.fm("status") === "blocked", r.fm("status"));
}

console.log("loop.sh — a build that never reported is never a built build");
{
  // The absent-file twin of the dead implementer, and the one the `dead[]` grep cannot
  // see: a phase cut short never reaches the step that writes build.json, so there is no
  // file to read and no surface to name — while the child still exits 0. Scoring that as
  // a clean build stamps `.built` over a half-written tree and sends reviewers at it.
  const s = scenario(["build:cutshort"]);
  const r = runLoop(s, ["feat-x"]);
  check("no build.json ⇒ exit 2, not a review pass", r.code === 2, `got ${r.code}: ${r.out}`);
  check("no build.json ⇒ no reviewer was spawned", !/phase=review/.test(r.out));
  check("no build.json ⇒ names the cut-short phase", /wrote no .*build\.json/.test(r.out),
    r.out.trim().split("\n").pop());
  check("no build.json ⇒ the build stamp is NOT written (a re-run must rebuild)",
    !existsSync(join(s.dir, "specs/reports/feat-x.built")));
  check("no build.json ⇒ spec left blocked", r.fm("status") === "blocked", r.fm("status"));
}

console.log("loop.sh — what the children are handed");
{
  // acceptEdits auto-approves Write/Edit and NOTHING else, so the first child Bash call no
  // `allow` rule covers raises a prompt no `claude -p` can answer: the child stalls, asks
  // the human in prose, and exits 0 — which the driver scores `ok`. Seen on a real run,
  // where the review child hung on its own preflight.sh call. gate.py is built for the
  // other mode: it escalates `ask` to a hard deny under bypassPermissions.
  const s = scenario(["build:ready", "review:clean"]);
  const r = runLoop(s, ["feat-x"]);
  check("default child flags are bypassPermissions, not acceptEdits",
    /# flags: --permission-mode bypassPermissions/.test(r.log) && !/acceptEdits/.test(r.log),
    r.log.split("\n")[1]);
  // Print mode TERMINATES still-running background tasks at its ceiling ("Background tasks
  // still running after 600s"), which cuts a 25–40 min implementer batch off mid-write.
  check("children inherit an unbounded background-task ceiling",
    /fake claude: bgceil=0/.test(r.log), (r.log.match(/bgceil=\S*/) || ["absent"])[0]);
}
{
  // The override is the escape hatch for a watched run — it must not have been hard-coded away.
  const s = scenario(["review:clean"]);
  const r = spawnSync("bash", [LOOP, "feat-x", "--no-build"], {
    cwd: s.dir, encoding: "utf8",
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, SCEN_DIR: s.dir,
      CLAUDE_FLAGS: "--permission-mode acceptEdits",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" },
  });
  const log = readFileSync(join(s.dir, "specs/reports/feat-x.loop.log"), "utf8");
  check("CLAUDE_FLAGS overrides the default", /# flags: --permission-mode acceptEdits/.test(log),
    `${r.status}: ${log.split("\n")[1]}`);
}

console.log("loop.sh — non-convergent + resume");
{
  const s = scenario(["build:ready", "review:blocking", "fix:noop", "review:blocking"]);
  const r = runLoop(s, ["feat-x", "--max=4"]);
  check("same fingerprint twice ⇒ exit 3", r.code === 3, `got ${r.code}: ${r.out}`);
  check("non-convergent ⇒ status blocked", r.fm("status") === "blocked", r.fm("status"));
  check("non-convergent ⇒ the pass it reached is recorded (resume anchor)",
    r.fm("loop_pass") === "2", r.fm("loop_pass"));
  check("non-convergent ⇒ the phase is recorded", r.fm("loop_phase") === "review", r.fm("loop_phase"));

  // Resume: the recorded pass is where it picks up — passes 1..n-1 are not re-paid.
  writeFileSync(join(s.dir, "count"), "0");
  writeFileSync(join(s.dir, "phases"), "review:clean\n");
  const r2 = runLoop(s, ["feat-x", "--max=4", "--resume"]);
  check("--resume ⇒ announces the pass it continues from",
    /resuming at review pass 2/.test(r2.out), r2.out.trim().split("\n")[0]);
  check("--resume ⇒ skips the build (the stamp is there)", !/phase=build/.test(r2.out));
  check("--resume ⇒ finishes clean from there", r2.code === 0, `got ${r2.code}: ${r2.out}`);
  check("--resume ⇒ reports the resumed pass count, not 1",
    /after 2 review pass\(es\)/.test(r2.out), r2.out.trim().split("\n").pop());
}
{
  const s = scenario(["review:clean"]);
  // A resume anchor past the ceiling is a usage error, not a silent restart at 1.
  writeFileSync(join(s.dir, "specs/feat-x.md"), FM.replace("branch:", "loop_pass: 9\nbranch:"));
  const r = runLoop(s, ["feat-x", "--max=3", "--resume"]);
  check("--resume past --max ⇒ exit 64 with the reason", r.code === 64 && /raise --max/.test(r.out),
    `${r.code}: ${r.out.trim()}`);
}

console.log("loop.sh — a spec with no front-matter still runs");
{
  const s = scenario(["build:ready", "review:clean"], { frontmatter: "# Feat X\n\nno front-matter\n" });
  const r = runLoop(s, ["feat-x"]);
  check("no front-matter ⇒ still exits 0 (stamps are a silent no-op)", r.code === 0,
    `got ${r.code}: ${r.out}`);
  check("no front-matter ⇒ the spec is left untouched",
    r.spec === "# Feat X\n\nno front-matter\n", JSON.stringify(r.spec));
  check("no front-matter ⇒ no stray temp file",
    !existsSync(join(s.dir, "specs/feat-x.md.loop.tmp")));
}

// ── the sleep inhibitor must never be able to fail the run ───────────────────
// loop.sh re-execs itself under caffeinate/systemd-inhibit to hold a power assertion.
// `exec` replaces the shell, so an inhibitor that EXISTS but is refused makes its own
// failure the driver's exit code and the run never starts. CI found this the hard way:
// GitHub's Linux runners ship systemd-inhibit and answer "Failed to inhibit: Access
// denied", which turned all 24 loop tests red at once.
console.log("loop.sh — the sleep inhibitor is best-effort, never fatal");
{
  const s = scenario(["build:ready", "review:clean"]);
  // Both inhibitors present on PATH and both failing — the CI shape.
  writeFileSync(join(s.bin, "systemd-inhibit"),
    '#!/bin/sh\necho "Failed to inhibit: Access denied" >&2\nexit 1\n');
  chmodSync(join(s.bin, "systemd-inhibit"), 0o755);
  writeFileSync(join(s.bin, "caffeinate"), "#!/bin/sh\nexit 127\n");
  chmodSync(join(s.bin, "caffeinate"), 0o755);
  const r = runLoop(s, ["feat-x"]);
  check("a refused inhibitor ⇒ the run still completes clean", r.code === 0,
    `got ${r.code}: ${r.out.trim().split("\n").pop()}`);
  check("a refused inhibitor ⇒ its error never reaches the driver's output",
    !/Access denied/.test(r.out), r.out.trim().split("\n").pop());

  // A WORKING inhibitor must still be used (or the probe would have disabled the feature).
  const s2 = scenario(["build:ready", "review:clean"]);
  writeFileSync(join(s2.bin, "systemd-inhibit"),
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in --*) shift ;; *) break ;; esac; done\n'
    + 'echo "INHIBIT-HELD" >&2\nexec "$@"\n');
  chmodSync(join(s2.bin, "systemd-inhibit"), 0o755);
  writeFileSync(join(s2.bin, "caffeinate"), "#!/bin/sh\nexit 127\n");
  chmodSync(join(s2.bin, "caffeinate"), 0o755);
  const r2 = runLoop(s2, ["feat-x"]);
  check("a usable inhibitor is still exec'd (the probe didn't kill the feature)",
    /INHIBIT-HELD/.test(r2.out) && r2.code === 0, `${r2.code}: ${r2.out.trim().split("\n").pop()}`);
}

if (failures) { console.error(`\ntest-loop: ${failures} failure(s)`); process.exit(1); }
console.log("\ntest-loop: OK");
