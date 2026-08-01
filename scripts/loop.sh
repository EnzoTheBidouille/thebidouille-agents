#!/usr/bin/env bash
#
# loop.sh — autonomous /build → /review → /fix → /review … loop for ONE feature.
#
#   loop.sh <feature-id> [--max=N] [--no-build] [--rebuild]
#
# THE POINT: every phase runs as a SEPARATE `claude -p` child with its own fresh
# context. The session that typed /loop never sees the diff, the N review reports
# or the N contracts — it reads only this script's one-line-per-phase stdout and,
# at the end, the verdict JSON. Running the loop inside the calling session would
# accumulate all of it in a history that is re-sent at input price on every turn,
# which is the exact cost the pipeline's /clear discipline exists to avoid.
#
# Contract with the pipeline: /review writes specs/reports/<id>.verdict.json on
# every run. That file — `blocking` and `fingerprint` — is the ONLY channel
# between cohorte and this driver. No prose is parsed.
#
# Exit codes (three distinct diagnostics, do not collapse them):
#   0   clean — a review returned blocking == 0
#   1   ceiling — --max passes used, still blocking (the fix was progressing;
#       re-run with a higher --max)
#   2   no usable verdict — /review produced nothing, or aborted on a red
#       preflight (typecheck/lint/tests broken; the message says which)
#   3   non-convergent — two consecutive reviews returned the SAME blocking
#       fingerprint: the fix is treading water, a higher --max will not help
#   64  usage — bad flag, bad id, missing spec, no `claude` on PATH
#
# No /fix runs on the last pass: fixing without a review behind it ships
# unaudited code. Each fix pass is committed — that commit is the only way back
# after N autonomous passes.

set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: loop.sh <feature-id> [--max=N] [--no-build] [--rebuild]

  --max=N      stop after N review passes (default 5)
  --no-build   never build — re-run the /review ⇄ /fix loop on a feature that
               is already built (the common case; the build stamp is ignored)
  --rebuild    force a /build even if the stamp says it was already built

  env CLAUDE_FLAGS   flags for every child session
                     (default: --permission-mode acceptEdits)
EOF
  exit 64
}

id=""
max=5
build_mode="auto"          # auto | never | force

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
  echo "loop: no spec at $spec — run /spec $id first" >&2; exit 64; }

reports="specs/reports"
mkdir -p "$reports"
verdict="$reports/$id.verdict.json"
stamp="$reports/$id.built"
log="$reports/$id.loop.log"

: "${CLAUDE_FLAGS:=--permission-mode acceptEdits}"

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
  cmd="$1"
  printf '▶ /%-6s %-24s ' "$cmd" "$id"
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

finish() { echo "$2"; exit "$1"; }

# --- build -------------------------------------------------------------------
# The stamp is the driver's own bookkeeping — /build knows nothing about it.
case "$build_mode" in
  force) do_build=1 ;;
  never) do_build=0 ;;
  auto)  [ -f "$stamp" ] && do_build=0 || do_build=1 ;;
esac

if [ "$do_build" -eq 1 ]; then
  run_phase build || finish 2 "✗ /build failed — see $log"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$stamp"
fi

# --- review ⇄ fix ------------------------------------------------------------
prev_fp=""
pass=1
while [ "$pass" -le "$max" ]; do
  # Delete first: a stale verdict from the previous pass read as this pass's
  # answer would end the loop on someone else's numbers.
  rm -f "$verdict"
  run_phase review || true          # exit status of the child is not the verdict

  [ -f "$verdict" ] || finish 2 \
    "✗ /review wrote no verdict (pass $pass) — see $log"

  if grep -q '"aborted"' "$verdict"; then
    finish 2 "✗ /review aborted on a red preflight — typecheck/lint/tests are broken, see $reports/$id.preflight.txt"
  fi

  blocking="$(json_num "$verdict" blocking)"
  [ -n "$blocking" ] || finish 2 \
    "✗ verdict has no usable 'blocking' count (pass $pass) — see $verdict"

  [ "$blocking" -eq 0 ] && finish 0 \
    "✓ clean after $pass review pass(es) — no blocking findings"

  fp="$(json_str "$verdict" fingerprint)"
  if [ -n "$fp" ] && [ "$fp" = "$prev_fp" ]; then
    finish 3 "✗ non-convergent — the same $blocking blocking finding(s) survived a fix pass; see $verdict"
  fi
  prev_fp="$fp"

  # Last pass: report and stop. A /fix here would leave unreviewed code behind.
  [ "$pass" -eq "$max" ] && finish 1 \
    "✗ ceiling — $blocking blocking finding(s) after $max pass(es); re-run with a higher --max"

  run_phase fix || true

  # Non-fatal by design: nothing to commit is a legitimate outcome (an agent
  # that decided a finding needed no code change). The commit itself is the
  # rollback point for the pass that just ran.
  git add -A >>"$log" 2>&1
  git commit -m "loop($id): fix pass $pass" >>"$log" 2>&1 || true

  pass=$((pass + 1))
done

finish 1 "✗ ceiling — $max pass(es) exhausted"
