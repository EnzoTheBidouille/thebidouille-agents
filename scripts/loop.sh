#!/usr/bin/env bash
#
# loop.sh — autonomous /cohorte-build → /cohorte-review → /cohorte-fix → /cohorte-review …
#           loop for ONE feature.
#
#   loop.sh <feature-id> [--max=N] [--no-build] [--rebuild] [--resume]
#
# THE POINT: every phase runs as a SEPARATE `claude -p` child with its own fresh
# context. The session that typed /cohorte-loop never sees the diff, the N review reports
# or the N contracts — it reads only this script's one-line-per-phase stdout and,
# at the end, the verdict JSON. Running the loop inside the calling session would
# accumulate all of it in a history that is re-sent at input price on every turn,
# which is the exact cost the pipeline's /clear discipline exists to avoid.
#
# Contract with the pipeline: /cohorte-review writes specs/reports/<id>.verdict.json on
# every run, and /cohorte-build writes <id>.readiness.json + <id>.build.json. Those three
# files — `blocking`, `fingerprint`, `unreviewed`, `verdict`, `dead` — are the ONLY
# channel between cohorte and this driver. No prose is parsed.
#
# Two of those fields exist for the same reason: a subagent that DIES returns
# nothing, and nothing is byte-identical to "clean". A dead implementer means a
# surface was never built; a dead reviewer means a surface was never audited, and
# `blocking == 0` would then certify code no one read. Both abort as exit 2.
#
# Exit codes (distinct diagnostics, do not collapse them):
#   0   clean — a review returned blocking == 0
#   1   ceiling — --max passes used, still blocking (the fix was progressing;
#       re-run with a higher --max)
#   2   no usable verdict — /cohorte-review produced nothing, or aborted on a red
#       preflight (typecheck/lint/tests broken; the message says which)
#   3   non-convergent — two consecutive reviews returned the SAME blocking
#       fingerprint: the fix is treading water, a higher --max will not help
#   4   not implementable — /cohorte-build's readiness gate returned NOT-READY and spawned
#       no agent: the frozen spec cannot be built (missing contract shape, unowned
#       area, absent dependency). Needs /cohorte-spec, not more passes.
#   64  usage — bad flag, bad id, missing spec, no `claude` on PATH
#
# No /cohorte-fix runs on the last pass: fixing without a review behind it ships
# unaudited code. Each fix pass is committed — that commit is the only way back
# after N autonomous passes.
#
# RESUME: the spec's front-matter IS the loop's state (SCHEMA.md §Spec status).
# Before every phase this script stamps `status: in-progress` + `loop_phase` +
# `loop_pass` into specs/<id>.md — deterministically, with awk, costing no tokens
# — and on exit stamps a terminal status (`in-review` clean, `blocked` otherwise).
# `--resume` reads `loop_pass` back and continues from that pass instead of 1, so
# a session that died at pass 3 of 5 does not re-pay passes 1 and 2. The build is
# skipped or redone by the same stamp logic as always (the stamp is only written
# on a build that finished), so an interrupted build still rebuilds.

set -uo pipefail

# --- hold the machine awake for the whole run --------------------------------
# System sleep aborts every in-flight `claude -p` request, so a loop that spans
# hours must own a power assertion for its entire life — a driver killed at hour
# two has spent hour one for nothing, and the abort is indistinguishable from a
# clean "agent returned nothing" (which is the `dead` family this script exists
# to catch). Re-exec ourselves under caffeinate once; the guard keeps it to one
# level, and `exec` leaves no extra process to reap.
#
# macOS `caffeinate -ims`: `-i` idle system sleep · `-m` disk sleep · `-s` system
# sleep (AC only). NOT `-d`/`-u` — an unattended build has no reason to hold the
# display on. Linux gets the systemd equivalent. Windows has no scriptable
# equivalent, and neither does a systemd-less Linux, so both fall through to a
# no-op rather than pretending: the run still works, it is just as sleep-proof as
# the machine's own settings make it. A *refused* inhibitor falls through the same
# way — an unheld power assertion is a degraded run, not a failed one.
#
# THIS CANNOT PREVENT LID-CLOSE SLEEP on any platform. No userspace assertion can
# override it — keep the lid open, or use clamshell mode (AC + external display +
# external input).
#
# PROBE before exec'ing. `exec` replaces this shell, so an inhibitor that *exists* but is
# refused — `systemd-inhibit` in a container, in CI, or in any session without a logind
# seat answers `Failed to inhibit: Access denied` and exits 1 — would become the driver's
# own exit code, and the run would never start at all. "Present" and "usable" are not the
# same test; only the second one is safe to build an `exec` on. One fast subprocess on a
# run measured in hours.
if [ -z "${COHORTE_CAFFEINATED:-}" ]; then
  if command -v caffeinate > /dev/null 2>&1 && caffeinate -ims true > /dev/null 2>&1; then
    COHORTE_CAFFEINATED=1 exec caffeinate -ims "$0" "$@"
  elif command -v systemd-inhibit > /dev/null 2>&1 \
    && systemd-inhibit --what=sleep:idle --who=cohorte --why="probe" true > /dev/null 2>&1; then
    COHORTE_CAFFEINATED=1 exec systemd-inhibit \
      --what=sleep:idle --who=cohorte --why="autonomous $0 run" "$0" "$@"
  fi
fi

usage() {
  cat >&2 <<'EOF'
usage: loop.sh <feature-id> [--max=N] [--no-build] [--rebuild] [--resume]

  --max=N      stop after N review passes (default 5) — a ceiling on the TOTAL
               pass count, so it still means "5 passes" when resuming at pass 3
  --no-build   never build — re-run the /cohorte-review ⇄ /cohorte-fix loop on a feature that
               is already built (the common case; the build stamp is ignored)
  --rebuild    force a /cohorte-build even if the stamp says it was already built
  --resume     continue from the pass recorded in the spec's front-matter
               (loop_pass), instead of starting over at pass 1

  env CLAUDE_FLAGS   flags for every child session
                     (default: --permission-mode bypassPermissions)
EOF
  exit 64
}

id=""
max=5
build_mode="auto"          # auto | never | force
resume=0

for arg in "$@"; do
  case "$arg" in
    --max=*)
      max="${arg#--max=}"
      case "$max" in
        ''|*[!0-9]*) echo "loop: --max must be a positive integer (got '${arg#--max=}')" >&2; exit 64 ;;
      esac
      [ "$max" -ge 1 ] || { echo "loop: --max must be >= 1" >&2; exit 64; }
      ;;
    --no-build) build_mode="never" ;;
    --rebuild)  build_mode="force" ;;
    --resume)   resume=1 ;;
    -h|--help)  usage ;;
    -*)         echo "loop: unknown flag: $arg" >&2; usage ;;
    *)
      [ -z "$id" ] || { echo "loop: unexpected argument: $arg" >&2; usage; }
      id="$arg"
      ;;
  esac
done

[ -n "$id" ] || usage
# --no-build --rebuild together is a contradiction, not a precedence puzzle.
case " $* " in
  *" --no-build "*) case " $* " in *" --rebuild "*)
    echo "loop: --no-build and --rebuild are mutually exclusive" >&2; exit 64 ;; esac ;;
esac

command -v claude >/dev/null 2>&1 || {
  echo "loop: no 'claude' on PATH — the loop drives child claude -p sessions" >&2
  exit 64
}

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "loop: not inside a git checkout" >&2; exit 64; }
cd "$root" || exit 64

spec="specs/$id.md"
[ -f "$spec" ] || {
  echo "loop: no spec at $spec — run /cohorte-spec $id first" >&2; exit 64; }

reports="specs/reports"
mkdir -p "$reports"
verdict="$reports/$id.verdict.json"
readiness="$reports/$id.readiness.json"
buildjson="$reports/$id.build.json"
stamp="$reports/$id.built"
log="$reports/$id.loop.log"

# --- the spec front-matter as loop state -------------------------------------
# Best-effort by design: a spec with no front-matter (or an unwritable one) makes
# every fm_* call a silent no-op. This is bookkeeping for resume + the dashboard,
# never a precondition — the loop must not die over a status line.
fm_get() {                        # fm_get <key>  → value, or empty
  [ -f "$spec" ] || return 0
  awk -v k="$1" '
    NR==1 && $0=="---" { fm=1; next }
    fm==1 && $0=="---" { exit }
    fm==1 && $0 ~ "^"k":" {
      sub("^"k":[[:space:]]*", ""); sub("#.*", "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit
    }
  ' "$spec"
}

fm_set() {                        # fm_set <key> <value>  (replace, else append)
  [ -f "$spec" ] || return 0
  awk -v k="$1" -v v="$2" '
    NR==1 && $0!="---" { nofm=1 }
    nofm { print; next }
    NR==1 { fm=1; print; next }
    fm==1 && $0=="---" {
      if (!done) print k ": " v          # key absent: add it before the closing ---
      fm=2; print; next
    }
    fm==1 && $0 ~ "^"k":" {
      if (done) next                     # a duplicate key: drop it
      c=""; i=index($0, "#"); if (i>0) c=" " substr($0, i)   # keep a trailing comment
      print k ": " v c; done=1; next
    }
    { print }
  ' "$spec" >"$spec.loop.tmp" 2>/dev/null &&
    mv "$spec.loop.tmp" "$spec" 2>/dev/null || rm -f "$spec.loop.tmp"
}

# --- child session flags -----------------------------------------------------
# bypassPermissions, NOT acceptEdits. acceptEdits auto-approves Write/Edit and
# NOTHING else, so every Bash call in a child falls back to the settings.json
# rules — and the first one no `allow` prefix covers raises a permission prompt.
# In `claude -p` there is nobody to answer it: the child stalls, eventually
# prints prose asking the human to approve, and EXITS 0. The driver then reads
# that as a clean phase. Observed on a real run: the review child hung on its own
# preflight.sh call ("could you approve the pending tool-call prompt") and the
# loop scored the phase `ok`.
#
# This is also what the gate hook is built for: hooks/gate.py escalates every
# `ask` match to a hard DENY under bypassPermissions, precisely because an
# unattended run has nobody to confirm. The dangerous commands stay blocked — by
# the gate, deterministically, from PIPELINE.md `gate` — while the mechanical
# ones (typecheck, lint, tests, git diff) stop needing a human. Driving the loop
# in acceptEdits gets this backwards: nothing is auto-denied and everything is
# auto-hung. Override with CLAUDE_FLAGS to run in a stricter mode interactively.
: "${CLAUDE_FLAGS:=--permission-mode bypassPermissions}"

# A `/cohorte-build` implementer batch runs 25–40 min as background tasks. In print
# mode the harness waits a bounded time for background work and then TERMINATES it
# ("Background tasks still running after 600s; terminating"), which cuts implementers
# off mid-write and still exits the child 0. 0 = wait indefinitely; the caffeinate
# assertion above and the phase's own completion are what bound a phase, not a
# stopwatch that fires in the middle of the longest one.
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0

: >"$log"
{
  printf '# loop %s — max=%s build=%s\n' "$id" "$max" "$build_mode"
  printf '# flags: %s\n' "$CLAUDE_FLAGS"
} >>"$log"

# --- one phase = one throwaway child session ---------------------------------
# ALL child output is redirected into $log and never surfaces here: if the
# parent re-imports the children's transcripts, the whole point is lost.
# $CLAUDE_FLAGS is intentionally unquoted — it is a flag list, not one word.
run_phase() {
  # $1 is the PHASE name (build|review|fix), which is not the same string as the
  # command that runs it (`/cohorte-build`). Every command gained a `cohorte-`
  # prefix in 2.0.0 so Claude Code's built-ins can never shadow them again — but
  # the phase name is a DATA CONTRACT, written into the spec's `loop_phase`, into
  # specs/reports/<id>.*.json and into pipeline-metrics.jsonl, and read back by
  # --resume and the dashboard. Prefixing it too would orphan every historical
  # metrics line and break resume on specs written by 1.x. So: prefix the command,
  # never the phase.
  phase="$1"
  cmd="cohorte-$phase"
  # Stamp the state BEFORE the phase runs: if this child dies (or the whole
  # session does), the spec already says where the loop was — that is what
  # --resume reads back. Child commands write `status` themselves (/cohorte-fix
  # sets in-review); re-stamping here each phase keeps `in-progress` true.
  fm_set status in-progress
  fm_set loop_pass "$pass"
  fm_set loop_phase "$phase"
  printf '▶ /%-14s %-24s ' "$cmd" "$id"
  printf '\n\n===== /%s %s =====\n' "$cmd" "$id" >>"$log"
  # shellcheck disable=SC2086
  if claude -p "/$cmd $id" $CLAUDE_FLAGS >>"$log" 2>&1; then
    echo "ok"
    return 0
  fi
  echo "fail"
  return 1
}

# Scalar reads on a flat JSON object — no jq dependency (the pipeline ships no
# runtime deps). Only `blocking` and `fingerprint` are ever read; both are
# top-level scalars by construction of the verdict contract.
json_num() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n1; }
json_str() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n1; }

# Terminal status goes into the spec, not just into this stdout: a clean run
# leaves the feature ready to /cohorte-ship, any failure leaves it visibly `blocked` for
# the human and for the dashboard. Exit 64 never reaches here (usage dies earlier),
# so every code handled below is a real run outcome.
finish() {
  if [ "$1" -eq 0 ]; then
    fm_set status in-review
    fm_set loop_pass 0
    fm_set loop_phase done
  else
    fm_set status blocked
  fi
  echo "$2"
  exit "$1"
}

# One short clause naming the deferred findings, appended to a closing line.
# They are NOT blocking (they live in the backlog, not in ## Remediation), so
# they never change an exit code — but a loop that silently drops them is the
# leak /cohorte-review §3.5 exists to close, so the driver names them.
def_note() {
  d="$(json_num "$verdict" deferred 2>/dev/null)"
  case "$d" in ''|0) return 0 ;; esac
  printf ' · %s deferred finding(s) parked in specs/refactor-backlog.md' "$d"
}

# --- build -------------------------------------------------------------------
# The stamp is the driver's own bookkeeping — /cohorte-build knows nothing about it.
case "$build_mode" in
  force) do_build=1 ;;
  never) do_build=0 ;;
  auto)  [ -f "$stamp" ] && do_build=0 || do_build=1 ;;
esac

# --resume: continue from the pass the spec records, not from 1. A missing or
# junk value falls back to 1 — resuming must never be less safe than starting.
pass=1
if [ "$resume" -eq 1 ]; then
  rp="$(fm_get loop_pass)"
  case "$rp" in ''|*[!0-9]*|0) rp=1 ;; esac
  [ "$rp" -le "$max" ] || {
    echo "loop: --resume says pass $rp but --max=$max — raise --max to continue" >&2; exit 64; }
  pass="$rp"
  [ "$pass" -eq 1 ] || printf '↻ resuming at review pass %s (from %s)\n' "$pass" "$spec"
fi

if [ "$do_build" -eq 1 ]; then
  # Delete first: a NOT-READY left by a previous build would abort this one on
  # someone else's verdict (and a stale READY would hide a gate that never ran).
  rm -f "$readiness" "$buildjson"
  build_ok=0
  run_phase build && build_ok=1
  # The readiness gate is checked BEFORE the child's exit status: /cohorte-build aborting
  # on NOT-READY is a cleaner diagnosis than "/cohorte-build failed", and it is the one
  # outcome that more passes cannot fix.
  if [ -f "$readiness" ] &&
     grep -q '"verdict"[[:space:]]*:[[:space:]]*"NOT-READY"' "$readiness"; then
    finish 4 "✗ spec not implementable — /cohorte-build's readiness gate returned NOT-READY and \
spawned no agent; see $readiness, then /cohorte-spec $id"
  fi
  # A dead implementer returns nothing, so /cohorte-build can finish "successfully" having
  # built one surface of two. Reviewing that would spend N reviewers auditing a
  # half-built feature and report its gaps as findings to fix — the wrong diagnosis
  # at the wrong price. `dead` is a non-empty array only when a surface died twice.
  if [ -f "$buildjson" ] && grep -q '"dead"[[:space:]]*:[[:space:]]*\[[^]]' "$buildjson"; then
    finish 2 "✗ an implementer died — the surface(s) in \"dead\" were never built; see $buildjson and $log"
  fi
  [ "$build_ok" -eq 1 ] || finish 2 "✗ /cohorte-build failed — see $log"
  # An ABSENT build.json is the same class of lie as a dead implementer, and the `dead`
  # check above cannot see it: a phase cut short (harness background-task ceiling, a
  # Claude Code teardown, a crash) never reaches §3's report, so there is no file to
  # grep and no surface to name — while the child still exits 0. Treating "no report"
  # as "nothing to report" is what let a build of 3 surfaces stamp itself green with 2
  # of them never written, and sent reviewers at the result.
  [ -f "$buildjson" ] || finish 2 "✗ /cohorte-build wrote no $buildjson — the phase was cut short \
(background-task ceiling, teardown or crash) and the surfaces it never reported are unbuilt; see $log"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$stamp"
fi

# --- review ⇄ fix ------------------------------------------------------------
prev_fp=""
while [ "$pass" -le "$max" ]; do
  # Delete first: a stale verdict from the previous pass read as this pass's
  # answer would end the loop on someone else's numbers.
  rm -f "$verdict"
  run_phase review || true          # exit status of the child is not the verdict

  [ -f "$verdict" ] || finish 2 \
    "✗ /cohorte-review wrote no verdict (pass $pass) — see $log"

  if grep -q '"aborted"' "$verdict"; then
    finish 2 "✗ /cohorte-review aborted on a red preflight — typecheck/lint/tests are broken, \
see $reports/$id.preflight.txt"
  fi

  # A reviewer that died twice leaves its surface unaudited, and `blocking` counts only
  # what the SURVIVING reviewers found — so blocking == 0 here would mean "clean" about
  # code nobody read. Checked BEFORE blocking, because it invalidates it.
  if grep -q '"unreviewed"[[:space:]]*:[[:space:]]*\[[^]]' "$verdict"; then
    finish 2 "✗ a reviewer died — the surface(s) in \"unreviewed\" carry no verdict (pass $pass); see $verdict"
  fi

  blocking="$(json_num "$verdict" blocking)"
  [ -n "$blocking" ] || finish 2 \
    "✗ verdict has no usable 'blocking' count (pass $pass) — see $verdict"

  [ "$blocking" -eq 0 ] && finish 0 \
    "✓ clean after $pass review pass(es) — no blocking findings$(def_note)"

  fp="$(json_str "$verdict" fingerprint)"
  if [ -n "$fp" ] && [ "$fp" = "$prev_fp" ]; then
    finish 3 "✗ non-convergent — the same $blocking blocking finding(s) survived a fix pass; see $verdict"
  fi
  prev_fp="$fp"

  # Last pass: report and stop. A /cohorte-fix here would leave unreviewed code behind.
  [ "$pass" -eq "$max" ] && finish 1 \
    "✗ ceiling — $blocking blocking finding(s) after $max pass(es); re-run with a higher --max --resume$(def_note)"

  run_phase fix || true

  # Non-fatal by design: nothing to commit is a legitimate outcome (an agent
  # that decided a finding needed no code change). The commit itself is the
  # rollback point for the pass that just ran.
  git add -A >>"$log" 2>&1
  git commit -m "loop($id): fix pass $pass" >>"$log" 2>&1 || true

  pass=$((pass + 1))
done

finish 1 "✗ ceiling — $max pass(es) exhausted"
