#!/usr/bin/env node
// Behavioural tests for scripts/loop.sh — the autonomous /review ⇄ /fix driver.
//
// The driver is pure shell around two JSON files it does not write, so it is
// testable end-to-end by putting a FAKE `claude` on PATH that produces those files
// per phase. What is pinned here cannot be seen by any structural check:
//
//   · exit 4 — /build's readiness gate said NOT-READY, so no pass count helps
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
cmd="\${prompt%% *}"; cmd="\${cmd#/}"
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
  const r = spawnSync("bash", [LOOP, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SCEN_DIR: dir,
      CLAUDE_FLAGS: "--permission-mode acceptEdits",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t",
    },
  });
  const spec = readFileSync(join(dir, "specs/feat-x.md"), "utf8");
  const fm = k => {
    const m = spec.match(new RegExp(`^${k}:\\s*([^#\\n]*)`, "m"));
    return m ? m[1].trim() : null;
  };
  return { code: r.status, out: `${r.stdout}${r.stderr}`, spec, fm };
}

console.log("loop.sh — readiness gate");
{
  const s = scenario(["build:notready"]);
  const r = runLoop(s, ["feat-x"]);
  check("NOT-READY ⇒ exit 4, not 2", r.code === 4, `got ${r.code}: ${r.out.trim().split("\n").pop()}`);
  check("NOT-READY ⇒ says the spec is not implementable",
    /not implementable/i.test(r.out), r.out.trim().split("\n").pop());
  check("NOT-READY ⇒ points at /spec", /\/spec feat-x/.test(r.out));
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
  check("clean ⇒ status in-review (ready to /ship)", r.fm("status") === "in-review", r.fm("status"));
  check("clean ⇒ loop state cleared", r.fm("loop_pass") === "0" && r.fm("loop_phase") === "done",
    `${r.fm("loop_pass")}/${r.fm("loop_phase")}`);
  check("clean ⇒ the deferred count is named, not dropped",
    /2 deferred finding\(s\) parked/.test(r.out), r.out.trim().split("\n").pop());
  check("clean ⇒ the status comment survives the awk rewrite",
    /^status: in-review # draft/m.test(r.spec), r.spec.split("\n")[3]);
}

console.log("loop.sh — a dead subagent is never a clean result");
{
  // A dead implementer: /build finishes fine having built one surface of two. Reviewing
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
  // send the human to /ship.
  const s = scenario(["build:ready", "review:deadreviewer"]);
  const r = runLoop(s, ["feat-x"]);
  check("dead reviewer + blocking 0 ⇒ NOT exit 0", r.code !== 0, `got ${r.code}: ${r.out}`);
  check("dead reviewer ⇒ exit 2 (no usable verdict)", r.code === 2, `got ${r.code}`);
  check("dead reviewer ⇒ names the unreviewed surface", /reviewer died/.test(r.out),
    r.out.trim().split("\n").pop());
  check("dead reviewer ⇒ never says clean", !/✓ clean/.test(r.out));
  check("dead reviewer ⇒ spec is NOT left in-review", r.fm("status") === "blocked", r.fm("status"));
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

if (failures) { console.error(`\ntest-loop: ${failures} failure(s)`); process.exit(1); }
console.log("\ntest-loop: OK");
