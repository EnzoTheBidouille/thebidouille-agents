#!/bin/sh
#
# install.sh — install the portable multi-agent pipeline.
# POSIX sh (works with dash/bash/zsh).
#
#   Per-project install (default — bundles the core into <target>/.claude, committable):
#     sh install.sh [target_dir]
#     curl -fsSL <raw-url>/install.sh | sh
#
#   Global install (one core in ~/.claude, shared by every repo on this machine):
#     sh install.sh --global
#     curl -fsSL <raw-url>/install.sh | sh -s -- --global
#
#   Update the generic core in place (keeps any generated PIPELINE.md + rendered agents):
#     sh install.sh --update [target_dir]
#     sh install.sh --update --global
#
# Per-project install copies the core into <target>/.claude; global install copies it once
# into ~/.claude and registers the gate hook there. Either way you then run `/init-pipeline`
# in each repo to generate PIPELINE.md + render the surface agents. Update refreshes ONLY the
# stack-agnostic files; generated profiles, rendered agents, gate-config.json and any project
# settings.json are left untouched.

set -eu

REPO_URL="${PIPELINE_REPO:-https://github.com/EnzoTheBidouille/thebidouille-agents}"

mode="install"
scope="project"
positional=""
while [ $# -gt 0 ]; do
  case "$1" in
    --update) mode="update"; shift ;;
    --global) scope="global"; shift ;;
    --)       shift; break ;;
    -*)       echo "error: unknown flag: $1" >&2; exit 2 ;;
    *)        positional="$1"; shift ;;
  esac
done
target="${positional:-$PWD}"

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

# --- resolve the destination .claude dir ------------------------------------
if [ "$scope" = "global" ]; then
  dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
else
  dest="$target/.claude"
fi
mkdir -p "$dest"

# version stamp so a per-repo pointer can record which core it expects:
# the package.json semver, with the git sha for traceability on from-main installs
semver=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$src/package.json" 2>/dev/null | head -n 1)
sha=$(git -C "$src" rev-parse --short HEAD 2>/dev/null || true)
if [ -n "$semver" ] && [ -n "$sha" ]; then ver="$semver ($sha)"
elif [ -n "$semver" ]; then ver="$semver"
else ver="${sha:-unknown}"
fi

copy_core() {
  cp -R "$src/core/commands"  "$dest/"
  cp -R "$src/core/hooks"     "$dest/"
  cp -R "$src/core/templates" "$dest/"
  mkdir -p "$dest/pipeline/scripts"
  cp "$src/profile/PIPELINE.template.md" "$dest/pipeline/"
  cp "$src/profile/SCHEMA.md"            "$dest/pipeline/"
  cp "$src/profile/thebidouille.config.template.yaml" "$dest/pipeline/"
  cp "$src"/scripts/*.template           "$dest/pipeline/scripts/"
  cp "$src/core/agents/implementer.template.md" "$dest/pipeline/"
  [ -f "$src/CHANGELOG.md" ] && cp "$src/CHANGELOG.md" "$dest/pipeline/"
  printf '%s\n' "$ver" > "$dest/pipeline/VERSION"
  chmod +x "$dest/hooks/gate.py" 2>/dev/null || true
  scrub_tdd_gate
}

# The TDD gate was removed in 0.1.6. Older installs have hooks/tdd_gate.py on disk and
# registered in settings.json — copy-over never deletes, and a registered hook whose file
# is gone errors on every Write/Edit, so scrub both.
scrub_tdd_gate() {
  rm -f "$dest/hooks/tdd_gate.py"
  [ -f "$dest/settings.json" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$dest/settings.json" <<'PY'
import json, sys
settings = sys.argv[1]
try:
    with open(settings) as fh:
        data = json.load(fh)
except Exception:
    sys.exit(0)
pre = data.get("hooks", {}).get("PreToolUse")
if not isinstance(pre, list):
    sys.exit(0)
kept = [e for e in pre if not any(
    h.get("command", "").strip().endswith("tdd_gate.py") for h in e.get("hooks", []))]
if len(kept) != len(pre):
    data["hooks"]["PreToolUse"] = kept
    with open(settings, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    print("  · removed the retired tdd_gate.py hook (file + settings registration)")
PY
}

# the fixed (non-rendered) agents: dev review/release + the questionnaire capability's three
copy_fixed_agents() {
  mkdir -p "$dest/agents"
  cp "$src/core/agents/review.md" "$src/core/agents/release.md" \
     "$src/core/agents/questionnaire-researcher.md" \
     "$src/core/agents/questionnaire-writer.md" \
     "$src/core/agents/questionnaire-validator.md" \
     "$dest/agents/"
}

# pipeline capability config is USER-level (vault, Notion DB, kanban boards) — it lives in
# ~/.claude regardless of install scope. Seed it only if neither the consolidated nor the
# legacy copy exists. This piped installer is non-interactive: it seeds disabled defaults;
# /init-pipeline + /update-pipeline wire it (npx's installer offers a quick interview instead).
seed_config() {
  base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  cfg="$base/thebidouille.config.yaml"
  legacy="$base/questionnaire.config.yaml"
  if [ -f "$cfg" ]; then
    echo "  · kept your existing $cfg"
  elif [ -f "$legacy" ]; then
    echo "  · found legacy $legacy — kept as-is (read as a fallback)."
    echo "    Run /update-pipeline to migrate it into thebidouille.config.yaml + wire the kanban."
  else
    mkdir -p "$base"
    cp "$src/profile/thebidouille.config.template.yaml" "$cfg"
    echo "  · seeded $cfg (disabled defaults — enable via /init-pipeline or /update-pipeline)"
  fi
}

# Register the profile-driven gate hook in the GLOBAL settings.json. Idempotent: the
# hook reads each repo's own .claude/gate-config.json (and no-ops where absent),
# so one registration serves every project.
register_global_hook() {
  python3 - "$dest/settings.json" "$dest/hooks/gate.py" <<'PY'
import json, sys
settings, gate = sys.argv[1], sys.argv[2]
# (hook path, PreToolUse matcher)
hooks = [(gate, "Bash")]
try:
    with open(settings) as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}
pre = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
for path, matcher in hooks:
    base = path.rsplit("/", 1)[-1]
    already = any(
        h.get("command", "").strip().endswith(base)
        for entry in pre for h in entry.get("hooks", [])
    )
    if not already:
        pre.append({"matcher": matcher,
                    "hooks": [{"type": "command", "command": "python3 " + path}]})
with open(settings, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
print("ok")
PY
}

# Bump only the core_version in a repo's committed .claude/pipeline.json (bundled mode).
# Leaves every other field intact; no-ops if the pointer is absent or has no core_version.
bump_pointer_version() {
  ptr="$1"; newver="$2"
  [ -f "$ptr" ] || return 0
  python3 - "$ptr" "$newver" <<'PY'
import json, sys
ptr, newver = sys.argv[1], sys.argv[2]
try:
    with open(ptr) as fh:
        data = json.load(fh)
except Exception:
    sys.exit(0)
if isinstance(data, dict) and "core_version" in data:
    data["core_version"] = newver
    with open(ptr, "w") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
PY
}

if [ "$scope" = "global" ]; then
  if [ "$mode" = "install" ]; then
    echo "→ installing pipeline core GLOBALLY into $dest"
  else
    echo "→ updating pipeline core GLOBALLY in $dest (keeping global settings.json)"
  fi
  copy_fixed_agents
  copy_core
  hook_state=$(register_global_hook || echo "skipped")
  seed_config
  cat <<EOF

✓ pipeline core installed globally into $dest  (version $ver)
  gate hook: $hook_state  (reads each repo's .claude/gate-config.json; silent where absent)

The commands (/init-pipeline, /brainstorm, /build …) and the review/release agents are now
available in EVERY project on this machine — nothing is copied per repo.

Per repo:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline  — it generates PIPELINE.md, renders the surface agents, writes
     .claude/gate-config.json, and drops a committed .claude/pipeline.json pointer so
     teammates know to install the global core ($REPO_URL).
  3. Commit PIPELINE.md + .claude/, then  /brainstorm  to start a feature.

Code retrieval (Serena — the default provider /init-pipeline wires per repo):
  uv tool install -p 3.13 serena-agent   # once per machine
  Make sure ~/.local/bin is on PATH (uv tool update-shell) — otherwise the
  registered MCP server silently fails to start.

Global capabilities config (research / questionnaire / kanban), user-scoped — optional:
  · One consolidated file: ~/.claude/thebidouille.config.yaml (don't hand-edit it).
  · /init-pipeline (new project) and /update-pipeline (existing) wire it for you: enabling
    research/questionnaire, and creating + syncing an Obsidian kanban board of the pipeline.
  · Research with  store: notion  needs Notion first:
    claude mcp add --transport http notion https://mcp.notion.com/mcp
EOF
  exit 0
fi

if [ "$mode" = "install" ]; then
  echo "→ installing pipeline core into $dest"
  copy_fixed_agents
  copy_core
  seed_config
  mkdir -p "$target/specs"
  [ -f "$target/specs/_template.md" ] || cp "$src/core/templates/spec.template.md" "$target/specs/_template.md"
  cat <<EOF

✓ pipeline core installed into $dest  (version $ver)

Next:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline   — it detects your stack, asks the gaps, and generates
     PIPELINE.md + renders one implementer agent per surface.
  3. Commit PIPELINE.md, then  /brainstorm  to start a feature.

Code retrieval (Serena — the default provider /init-pipeline wires per repo):
  uv tool install -p 3.13 serena-agent   # once per machine
  Make sure ~/.local/bin is on PATH (uv tool update-shell) — otherwise the
  registered MCP server silently fails to start.

Prefer one shared core across all your repos?  Re-run with  --global.
EOF
else
  echo "→ updating pipeline core in $dest (keeping your PIPELINE.md + rendered agents)"
  copy_core
  copy_fixed_agents 2>/dev/null || true
  seed_config
  bump_pointer_version "$dest/pipeline.json" "$ver"
  cat <<EOF

✓ core refreshed to $ver. Your PIPELINE.md, rendered surface agents, gate-config.json and
  settings.json were left as-is. Re-run /init-pipeline if your stack changed.
EOF
fi
