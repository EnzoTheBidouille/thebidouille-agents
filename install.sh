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
# into ~/.claude and registers the gate hook there. Either way you then run `/cohorte-init-pipeline`
# in each repo to generate PIPELINE.md + render the surface agents. Update refreshes ONLY the
# stack-agnostic files; generated profiles, rendered agents, gate-config.json and any project
# settings.json are left untouched.

set -eu

REPO_URL="${PIPELINE_REPO:-https://github.com/TheBidouilleAgency/cohorte}"

mode="install"
scope="project"
positional=""
while [ $# -gt 0 ]; do
  case "$1" in
    --update) mode="update"; shift ;;
    --global) scope="global"; shift ;;
    -h|--help)
      cat <<'USAGE'
install.sh — install the cohorte pipeline core.

  sh install.sh [target_dir]        per-project: bundle the core into <target>/.claude
  sh install.sh --global            one shared core in ~/.claude (recommended)
  sh install.sh --update [target]   refresh the core in place, keep every generated file
  sh install.sh --update --global

Honours $CLAUDE_CONFIG_DIR for the global destination and $PIPELINE_REPO for the
source when piped through curl. The npm CLI (`npx cohorte install`) does the same
thing and is the documented route; this script exists for Node-less environments.
USAGE
      exit 0 ;;
    --)       shift; break ;;
    -*)       echo "error: unknown flag: $1 (try --help)" >&2; exit 2 ;;
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

# --- delegate to the Node CLI ------------------------------------------------
# Since 2.2.0 the commands in core/ are runtime-NEUTRAL sources: they carry capability
# conditionals (`<!-- cohorte:if subagents -->`) and path tokens (`<core>`, `<state>`) that
# the adapter resolves per coding agent. Copying them verbatim, as this script used to,
# would install prompts full of unresolved markers — an install that looks successful and
# instructs the model with text meant for a different runtime. There is no shell renderer,
# so hand the whole job to bin/cli.js, which is the documented route anyway.
if command -v node >/dev/null 2>&1; then
  set -- install
  [ "$mode" = "update" ] && set -- update
  [ "$scope" = "global" ] && set -- "$@" --global
  [ "$scope" = "project" ] && set -- "$@" "$target"
  exec node "$src/bin/cli.js" "$@"
fi
echo "error: cohorte needs Node ≥ 18 to install." >&2
echo "  The pipeline's commands are rendered per coding agent (Claude Code, Codex, Cursor," >&2
echo "  Gemini CLI, OpenCode) at install time; there is no shell equivalent of that step," >&2
echo "  and a raw copy would install prompts this runtime cannot follow." >&2
echo "  Install Node, then:  npx cohorte install${scope:+ }$([ "$scope" = global ] && echo --global)" >&2
exit 1

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
  cp -R "$src/core/workflows" "$dest/"
  # A Python bytecode cache appears in a source checkout the moment anyone compiles
  # or imports gate.py (CI does) and `cp -R` carries it along — machine- and
  # interpreter-specific, and copy-over would never delete it later.
  rm -rf "$dest/hooks/__pycache__"
  # 0.1.19 renamed questionnaire-domain-brief.md → research-brief.md; drop the stale copy.
  rm -f "$dest/templates/questionnaire-domain-brief.md"
  mkdir -p "$dest/pipeline/scripts"
  cp "$src/profile/PIPELINE.template.md" "$dest/pipeline/"
  cp "$src/profile/SCHEMA.md"            "$dest/pipeline/"
  cp "$src/profile/cohorte.config.template.yaml" "$dest/pipeline/"
  cp "$src"/scripts/*.template           "$dest/pipeline/scripts/"
  cp "$src/scripts/kanban-move.sh"       "$dest/pipeline/scripts/"
  cp "$src/scripts/preflight.sh"         "$dest/pipeline/scripts/"
  chmod +x "$dest/pipeline/scripts/kanban-move.sh" \
           "$dest/pipeline/scripts/preflight.sh" 2>/dev/null || true
  # 2.3.0 removed telemetry. Copy-over never deletes, so an existing install would keep an
  # executable that still POSTs to the collector — scrub the script itself. The dead
  # `telemetry:` block in the user's config is not this installer's to parse; the interactive
  # /cohorte-update-pipeline deletes it (SCHEMA.md §Reconcile step 5).
  rm -f "$dest/pipeline/scripts/telemetry-send.sh"
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

# the fixed (non-rendered) agents: the dev review/release pipeline agents
copy_fixed_agents() {
  mkdir -p "$dest/agents"
  cp "$src/core/agents/review.md" "$src/core/agents/release.md" \
     "$src/core/agents/profile-reader.md" \
     "$dest/agents/"
  # 1.5.0 removed the /smoke phase; copy-over never deletes, so scrub the orphan agent.
  rm -f "$dest/agents/smoke.md" "$dest/commands/smoke.md"
  # 1.4.0 removed /cycle and its workflow — and no installer ever scrubbed them, so every
  # install since has kept offering a command that dispatches a workflow whose phases were
  # later deleted. A dead command is worse than a missing one: the model can still fire it.
  rm -f "$dest/commands/cycle.md" "$dest/workflows/cycle.js"
  # 1.6.0 renamed /loop → /drive: Claude Code's own built-in /loop shadowed ours, so a leftover
  # commands/loop.md is a command the user can never reach — scrub it rather than leave a decoy.
  rm -f "$dest/commands/loop.md"
  # 2.0.0 prefixed every command with `cohorte-`, which ends the shadowing problem for good.
  # Copy-over never deletes, so all 13 bare names would survive an upgrade as decoys — and a
  # stale /build is the worst kind: it still dispatches implementers, from a 1.x command file
  # that knows nothing of this core's contract. /drive goes too (it became /cohorte-loop).
  for c in align-ds audit brainstorm build doctor drive fix init-pipeline \
           refactor review ship spec update-pipeline; do
    rm -f "$dest/commands/$c.md"
  done
  # 0.1.19 split the bi-mode questionnaire-researcher into research-agent + questionnaire-architect;
  # copy-over never deletes, so scrub the retired agent lest a dead subagent_type linger.
  rm -f "$dest/agents/questionnaire-researcher.md"
  scrub_research_questionnaire
}

# The research + questionnaire capability was removed. Older installs have its agents, commands,
# templates and template-step dirs on disk; copy-over never deletes, so scrub every orphan.
scrub_research_questionnaire() {
  rm -f "$dest/agents/research-agent.md" \
        "$dest/agents/questionnaire-architect.md" \
        "$dest/agents/questionnaire-writer.md" \
        "$dest/agents/questionnaire-validator.md" \
        "$dest/commands/research.md" \
        "$dest/commands/questionnaire.md" \
        "$dest/templates/research-brief.md" \
        "$dest/templates/questionnaire-blueprint.md" \
        "$dest/templates/questionnaire-declaration.md" \
        "$dest/templates/questionnaire-verdict.md"
  rm -rf "$dest/templates/steps/research" "$dest/templates/steps/questionnaire"
}

# pipeline capability config is USER-level (vault, Notion DB, kanban boards) — it lives in
# ~/.claude regardless of install scope. Seed it only if neither the consolidated nor the
# legacy copy exists. This piped installer is non-interactive: it seeds disabled defaults;
# /cohorte-init-pipeline + /cohorte-update-pipeline wire it (npx's installer offers a quick interview instead).
seed_config() {
  base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  cfg="$base/cohorte.config.yaml"
  legacy=""
  for n in thebidouille.config.yaml; do
    [ -f "$base/$n" ] && { legacy="$base/$n"; break; }
  done
  if [ -f "$cfg" ]; then
    echo "  · kept your existing $cfg"
  elif [ -n "$legacy" ]; then
    echo "  · found legacy $legacy — kept as-is (read as a fallback)."
    echo "    Run /cohorte-update-pipeline to migrate it into cohorte.config.yaml + wire the kanban."
  else
    mkdir -p "$base"
    cp "$src/profile/cohorte.config.template.yaml" "$cfg"
    echo "  · seeded $cfg (disabled defaults — enable via /cohorte-init-pipeline or /cohorte-update-pipeline)"
  fi
}

# Register the profile-driven gate hook in the GLOBAL settings.json. Idempotent: the
# hook reads each repo's own .claude/gate-config.json (and no-ops where absent),
# so one registration serves every project.
register_global_hook() {
  python3 - "$dest/settings.json" "$dest/hooks/gate.py" <<'PY'
import json, sys
settings, gate = sys.argv[1], sys.argv[2]
# The matcher MUST cover Task as well as Bash: gate.py's preflight phase gate
# keys off tool_name == "Task" (the `preflight` block in a repo's
# gate-config.json). A Bash-only matcher never delivers a Task dispatch to the
# hook, so that gate silently never fires — it was dead code from 1.3.0 to 1.3.1.
MATCHER = "Bash|Task"
base = gate.rsplit("/", 1)[-1]


def is_gate(entry):
    # Trailing-quote tolerant: the Windows form is `py "C:\...\gate.py"`, and a
    # bare .endswith() missed it — which is how repeat installs accumulated a
    # duplicate registration every time (gate.py then ran once per copy).
    return any(
        (h.get("command") or "").strip().rstrip('"').endswith(base)
        for h in entry.get("hooks", [])
    )


try:
    with open(settings) as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}
pre = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
# Reconcile rather than append-if-absent: drop every existing gate.py
# registration, then add exactly one. Idempotent, collapses duplicates older
# installers left behind, and upgrades a stale "Bash"-only matcher in place —
# an append-if-absent would find the stale entry and skip, pinning the bug.
kept = [e for e in pre if not is_gate(e)]
kept.append({"matcher": MATCHER,
             "hooks": [{"type": "command", "command": "python3 " + gate}]})
data["hooks"]["PreToolUse"] = kept
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

The commands (/cohorte-init-pipeline, /cohorte-brainstorm, /cohorte-build …) and the review/release agents are now
available in EVERY project on this machine — nothing is copied per repo.

Per repo:
  1. Open the project in Claude Code.
  2. Run  /cohorte-init-pipeline  — it generates PIPELINE.md, renders the surface agents, writes
     .claude/gate-config.json, and drops a committed .claude/pipeline.json pointer so
     teammates know to install the global core ($REPO_URL).
  3. Commit PIPELINE.md + .claude/, then  /cohorte-brainstorm  to start a feature.

Code retrieval (Serena — the default provider /cohorte-init-pipeline wires per repo):
  uv tool install -p 3.13 serena-agent   # once per machine
  Make sure ~/.local/bin is on PATH (uv tool update-shell) — otherwise the
  registered MCP server silently fails to start.

Global kanban config, user-scoped — optional:
  · One consolidated file: ~/.claude/cohorte.config.yaml (don't hand-edit it).
  · /cohorte-init-pipeline (new project) and /cohorte-update-pipeline (existing) wire it for you: creating +
    syncing an Obsidian kanban board of the pipeline in your shared vault.
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
  2. Run  /cohorte-init-pipeline   — it detects your stack, asks the gaps, and generates
     PIPELINE.md + renders one implementer agent per surface.
  3. Commit PIPELINE.md, then  /cohorte-brainstorm  to start a feature.

Code retrieval (Serena — the default provider /cohorte-init-pipeline wires per repo):
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
  settings.json were left as-is. Re-run /cohorte-init-pipeline if your stack changed.
EOF
fi
