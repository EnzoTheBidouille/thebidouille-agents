#!/bin/sh
#
# install.sh — install the portable multi-agent pipeline into a project.
# POSIX sh (works with dash/bash/zsh).
#
#   Fresh install (run inside the target project, or pass its path):
#     sh install.sh [target_dir]
#     curl -fsSL <raw-url>/install.sh | sh
#
#   Update the generic core in place (keeps your PIPELINE.md + rendered agents):
#     sh install.sh --update [target_dir]
#
# Fresh install copies the generic core into <target>/.claude, then you run
# `/init-pipeline` in Claude Code to generate PIPELINE.md + render the agents.
# Update refreshes ONLY the stack-agnostic files; your generated profile,
# rendered agents, gate-config.json and settings.json are left untouched.

set -eu

REPO_URL="${PIPELINE_REPO:-https://github.com/EnzoTheBidouille/thebidouille-agents}"

mode="install"
if [ "${1:-}" = "--update" ]; then mode="update"; shift; fi
target="${1:-$PWD}"

# --- locate the source (this checkout, or clone if piped via curl) ----------
src=""
self="${0:-}"
self_dir=""
case "$self" in
  */*) self_dir=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd) ;;
esac
if [ -n "$self_dir" ] && [ -d "$self_dir/core" ]; then
  src="$self_dir"
else
  echo "→ fetching pipeline from $REPO_URL"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  git clone --depth 1 "$REPO_URL" "$tmp/pipeline" >/dev/null 2>&1
  src="$tmp/pipeline"
fi
[ -d "$src/core" ] || { echo "error: pipeline source not found (no core/ in $src)" >&2; exit 1; }

mkdir -p "$target/.claude"

copy_core() {
  cp -R "$src/core/commands"  "$target/.claude/"
  cp -R "$src/core/hooks"     "$target/.claude/"
  cp -R "$src/core/templates" "$target/.claude/"
  mkdir -p "$target/.claude/pipeline/scripts"
  cp "$src/profile/PIPELINE.template.md" "$target/.claude/pipeline/"
  cp "$src/profile/SCHEMA.md"            "$target/.claude/pipeline/"
  cp "$src"/scripts/*.template           "$target/.claude/pipeline/scripts/"
  cp "$src/core/agents/implementer.template.md" "$target/.claude/pipeline/"
  chmod +x "$target/.claude/hooks/gate.py" 2>/dev/null || true
}

if [ "$mode" = "install" ]; then
  echo "→ installing pipeline core into $target/.claude"
  mkdir -p "$target/.claude/agents"
  cp "$src/core/agents/review.md" "$src/core/agents/release.md" "$target/.claude/agents/"
  copy_core
  mkdir -p "$target/specs"
  [ -f "$target/specs/_template.md" ] || cp "$src/core/templates/spec.template.md" "$target/specs/_template.md"
  cat <<EOF

✓ pipeline core installed into $target/.claude

Next:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline   — it detects your stack, asks the gaps, and generates
     PIPELINE.md + renders one implementer agent per surface.
  3. Commit PIPELINE.md, then  /brainstorm  to start a feature.
EOF
else
  echo "→ updating pipeline core in $target/.claude (keeping your PIPELINE.md + rendered agents)"
  copy_core
  cp "$src/core/agents/review.md" "$src/core/agents/release.md" "$target/.claude/agents/" 2>/dev/null || true
  cat <<EOF

✓ core refreshed. Your PIPELINE.md, rendered surface agents, gate-config.json and
  settings.json were left as-is. Re-run /init-pipeline if your stack changed.
EOF
fi
