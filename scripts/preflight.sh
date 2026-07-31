#!/bin/sh
#
# preflight.sh — deterministic phase gate for /review and /smoke.
#
# Runs the profile's mechanical checks (typecheck, lint, tests — whatever the caller
# passes) BEFORE any agent is spawned. A red gate means the caller aborts and relays
# the raw failure — dispatching reviewers onto code that doesn't even compile burns
# their whole run on noise a compiler already printed for free.
#
#   preflight.sh <report-file> "<cmd>" ["<cmd>"...]
#
# - Each command runs through `sh -c`, all output appended to <report-file> — the bulk
#   never enters the calling agent's context.
# - First failure: prints the last 40 lines of the report raw to stderr and exits 1.
#   The caller must stop there — no agents.
# - All green: writes `<project>/.claude/preflight.ok` ("<epoch> <HEAD sha>") — the
#   stamp `hooks/gate.py` checks (gate-config.json `preflight` block) before letting
#   review/smoke agents dispatch.

set -u

report="${1:?usage: preflight.sh <report-file> \"<cmd>\" [\"<cmd>\"...]}"
shift
[ "$#" -gt 0 ] || { echo "preflight: no commands given" >&2; exit 2; }

mkdir -p "$(dirname "$report")" 2>/dev/null || true
: > "$report"

n=0
for cmd in "$@"; do
  [ -n "$cmd" ] || continue
  n=$((n + 1))
  printf '\n$ %s\n' "$cmd" >> "$report"
  if ! sh -c "$cmd" >> "$report" 2>&1; then
    echo "PREFLIGHT FAIL — $cmd" >&2
    echo "--- last 40 lines of $report ---" >&2
    tail -40 "$report" >&2
    exit 1
  fi
done

# Stamp for the gate.py phase gate: epoch + HEAD sha of the checkout we verified.
# The stamp MUST land where gate.py reads it: <main checkout>/.claude. CLAUDE_PROJECT_DIR
# is only exported to hooks — in an agent's Bash call it is unset, and a bare `.` would
# drop the stamp in the feature worktree where the gate never looks. git-common-dir
# resolves to the MAIN checkout's .git from any worktree.
proj="${CLAUDE_PROJECT_DIR:-$(dirname "$(git rev-parse --git-common-dir 2>/dev/null || echo ./.git)")}"
sha=$(git rev-parse HEAD 2>/dev/null || echo none)
# Stamp BOTH the main checkout and the cwd: gate.py reads CLAUDE_PROJECT_DIR,
# which is the worktree when the session was opened there and the main checkout
# when it wasn't — the two disagree, and either layout is supported.
now=$(date +%s)
last=""
for d in "$proj" "$(pwd)"; do
  [ "$d" = "$last" ] && continue          # same dir twice in the main checkout
  last="$d"
  mkdir -p "$d/.claude" 2>/dev/null || true
  printf '%s %s\n' "$now" "$sha" > "$d/.claude/preflight.ok" 2>/dev/null || true
done

echo "PREFLIGHT PASS ($n checks green) — full log: $report"
