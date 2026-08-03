#!/usr/bin/env bash
#
# loop-detach.sh — run loop.sh so it outlives the session that launched it.
#
#   loop-detach.sh start <feature-id> [loop.sh flags…]
#   loop-detach.sh wait  <feature-id>
#
# WHY THIS EXISTS. `/cohorte-loop` used to run the driver as one foreground Bash
# call ("let it run to completion"). Two things make that impossible for a real
# feature:
#
#   1. The Bash tool caps a single call at 600 s. A build is 25–40 min, so the
#      call was killed mid-`/cohorte-build` and the loop reported nothing.
#   2. A backgrounded Bash call is NOT detached — the child stays in the calling
#      session's process group, so when Claude Code goes down (a restart, a
#      crash, a laptop sleep) `loop.sh` and every `claude -p` child die with it.
#      Diagnosed on a real run: four teardowns in 45 min, each one aborting both
#      surface implementers mid-write and leaving a half-built tree.
#
# `screen -dmS` is the fix: its server double-forks and reparents to init, so the
# driver is in its own session and survives the launching process entirely. The
# exit code — which `/cohorte-loop` keys its whole report table on — would be lost
# that way, so the wrapper appends `__EXIT__ <code>` to the status file.
#
# STATUS FILE vs LOG — these are different files and the distinction is the whole
# token economy of this command. loop.sh writes ONE LINE PER PHASE to stdout; that
# is what lands in <id>.loop.status and it is safe to read. The full transcript of
# every child session — the diff, every review report, every handoff — goes to
# <id>.loop.log, which must never be read into a session. Do not merge them.

set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: loop-detach.sh start <feature-id> [loop.sh flags…]
       loop-detach.sh wait  <feature-id>

  start   launch the driver detached; returns immediately
  wait    block up to ~9 min waiting for it to finish (safely under the Bash
          tool's 600 s ceiling), then print the small status file. Call again
          while it prints __RUNNING__.
EOF
  exit 64
}

mode="${1:-}"; id="${2:-}"
[ -n "$mode" ] && [ -n "$id" ] || usage
shift 2 2>/dev/null || usage
case "$mode" in start|wait) ;; *) echo "loop-detach: unknown mode: $mode" >&2; usage ;; esac

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "loop-detach: not inside a git checkout" >&2; exit 64; }
cd "$root" || exit 64

status="$root/specs/reports/$id.loop.status"
sess="cohorte-$id"

# ── wait ─────────────────────────────────────────────────────────────────────
# 36 × 15 s = 540 s, comfortably inside the 600 s tool ceiling. The driver is
# detached, so this timing out means nothing to the run — call wait again.
if [ "$mode" = "wait" ]; then
  [ -f "$status" ] || { echo "loop-detach: no run to wait on ($status absent)" >&2; exit 64; }
  i=0
  while [ "$i" -lt 36 ]; do
    grep -q '__EXIT__' "$status" 2>/dev/null && break
    sleep 15
    i=$((i + 1))
  done
  cat "$status"
  grep -q '__EXIT__' "$status" 2>/dev/null || echo "__RUNNING__"
  exit 0
fi

# ── start ────────────────────────────────────────────────────────────────────
# Refuse to double-launch: two drivers on one feature would interleave commits and
# fight over the same verdict files, and the second would silently win the report.
# `screen -ls` exits 1 when it DOES find sessions, so under `pipefail` a piped
# `| grep -q` reports failure on the very case we are testing for — the guard
# silently never fired. Capture first, match second.
sessions="$(screen -ls 2>/dev/null || true)"
if [ -n "$sessions" ] && printf '%s\n' "$sessions" | grep -q "[.]$sess[[:space:]]"; then
  echo "loop-detach: '$sess' is already running — 'wait $id' to follow it, or"
  echo "             'screen -S $sess -X quit' to stop it first" >&2
  exit 64
fi
# The screen check above only sees the screen tier. On the setsid/nohup tiers there is
# no session to list, so match the process itself — otherwise the guard silently covers
# macOS and misses every platform that lacks screen. `[l]oop.sh` keeps this pgrep from
# matching itself. Skipped where pgrep is absent (Git Bash): the guard degrades to
# nothing there rather than blocking a legitimate launch.
if command -v pgrep >/dev/null 2>&1 && pgrep -f "[l]oop\.sh .*$id" >/dev/null 2>&1; then
  echo "loop-detach: a driver is already running for '$id' — 'wait $id' to follow it," >&2
  echo "             or stop that process before launching another" >&2
  exit 64
fi

loop=""
for cand in "$root/.claude/pipeline/scripts/loop.sh" "$HOME/.claude/pipeline/scripts/loop.sh"; do
  [ -f "$cand" ] && { loop="$cand"; break; }
done
[ -n "$loop" ] || { echo "loop-detach: no loop.sh in .claude/ or ~/.claude/ — run /cohorte-doctor" >&2; exit 64; }

mkdir -p "$root/specs/reports"
: >"$status"

# A self-deleting wrapper, rather than interpolating "$@" into a `sh -c` string:
# feature ids and flags would otherwise need shell-correct quoting at two nesting
# levels, and getting that subtly wrong silently drops a flag (`--max=3` becoming
# `--max`). `printf %q` is a bash builtin — present even in macOS's bash 3.2.
wrapper="$(mktemp "${TMPDIR:-/tmp}/cohorte-detach-XXXXXX")" || exit 1
{
  echo '#!/usr/bin/env bash'
  printf 'rm -f -- %q\n' "$wrapper"          # self-delete: no litter in TMPDIR
  printf 'cd %q || exit 1\n' "$root"
  printf 'bash %q %q' "$loop" "$id"
  for a in "$@"; do printf ' %q' "$a"; done
  printf ' >>%q 2>&1\n' "$status"
  printf 'printf "__EXIT__ %%s\\n" "$?" >>%q\n' "$status"
} >"$wrapper"
chmod +x "$wrapper"

# Three tiers, because "detached" means different things per platform and only the
# first two are actually detached. What matters is escaping the caller's process
# GROUP — not just ignoring SIGHUP — since that is what a Claude Code teardown kills.
#
#   screen  — macOS + Linux (macOS ships it at /usr/bin/screen). Its server
#             double-forks and reparents to init: fully out of our session.
#   setsid  — Linux (util-linux, effectively always present; NOT on macOS, and not
#             in Git Bash). Puts the child in a brand-new session directly.
#   nohup   — last resort, and NOT equivalent: it survives SIGHUP but stays in this
#             process group, so a teardown still takes it. This is the Windows/Git
#             Bash path today.
if command -v screen >/dev/null 2>&1; then
  screen -dmS "$sess" "$wrapper"
  echo "▶ detached as screen session '$sess' — survives this session ending"
  echo "  follow it live with: screen -r $sess"
elif command -v setsid >/dev/null 2>&1; then
  setsid "$wrapper" >/dev/null 2>&1 &
  echo "▶ detached with setsid (no 'screen' on PATH) — survives this session ending"
else
  # Say so plainly. A silent downgrade here reads as "safe to walk away" when it is
  # not, which is the exact failure that made a half-built tree look like a cohorte
  # bug for three hours.
  nohup "$wrapper" >/dev/null 2>&1 &
  echo "▶ launched with nohup — no 'screen' or 'setsid' on PATH."
  echo "  WARNING: this does NOT survive the calling session being torn down. It"
  echo "  ignores SIGHUP but stays in this process group. For a truly unattended"
  echo "  run, install screen, or start the driver from your own terminal:"
  echo "    bash <core>/pipeline/scripts/loop.sh $id"
fi

echo "  status: specs/reports/$id.loop.status   (small — one line per phase)"
echo "  log:    specs/reports/$id.loop.log      (full transcript — never read this)"
