# Troubleshooting

First reflex, always: **`/doctor`** — it checks every piece of wiring and prints the exact fix
per failure. This page covers the failures with a story behind them.

## Installation & versions

**A command exists but its agent doesn't (or vice-versa).**
Half-copied or stale core. Re-run the installer (`npx cohorte@latest update --global` or
`update`). `/doctor` check 1 flags a `VERSION` newer than its sibling files — the signature of a
half-done update.

**Kanban cards stopped moving / telemetry went quiet — with no error anywhere.**
Every caller chains the shipped scripts with `|| true`, so a missing
`kanban-move.sh`/`telemetry-send.sh`/`preflight.sh` is a *silent* no-op. `/doctor` check 1 is
the only thing that sees it; the fix is re-running the installer.

**`pipeline.json` claims an old `core_version` on a current core.**
Global-mode drift: the shared core can't know which repos point at it. Warn-level, not broken —
`/update-pipeline` syncs the field (and tells you to commit it).

**`/cycle` says the Workflow runtime is unavailable.**
`/doctor` check 8 tells you which prerequisite fails: Claude Code < 2.1.154, workflows disabled
for the session, scripts missing (`<core>/workflows/`), or the `profile-reader` agent missing.
The conversational commands are the designed fallback — nothing is broken.

## Serena / retrieval

**Agents silently fell back to grep-and-read.**
The MCP server failed to start. Run the health check (`/doctor` check 4): the usual causes are
`serena` not on PATH in the environment Claude Code was launched from (fix: the PATH-proof
launcher entry in `.mcp.json`, or `uv tool update-shell`), the tool uninstalled, or a hand-edited
entry. After repair, a **session restart** is needed before the tools appear — `/doctor` says so
explicitly rather than reporting success on registration alone.

## Gate & permissions

**The gate prompts twice for the same command.**
Double hook registration (usually a bundled repo whose global settings also register the gate).
`/doctor` check 3 flags it; remove the duplicate PreToolUse entry.

**A review/smoke dispatch asks for confirmation about a "preflight stamp".**
The phase gate: preflight hasn't run green recently (or HEAD moved since). Run the command's §0
preflight (or let it run — the prompt is the sign something skipped it). You can consciously
confirm through it; the point is that it can't happen *accidentally*.

**Headless runs (dashboard actions, `claude -p`) get hard denies on gated commands.**
By design: in `bypassPermissions` there's nobody to answer an "ask", so the gate escalates it to
a clear deny. Run that operation interactively instead.

## The loop

**`/ship` refuses: freshness mismatch.**
Source (or the contract) changed after the SHIP verdict — the verdict is stale. Re-run
`/review <id>`; ship only on the fresh stamp. This is the gate working, not failing.

**`/build` keeps re-dispatching items that were already fixed.**
The spec's `## Remediation` checkboxes are the state. If a prior round's fixes were never ticked
`- [x]` (e.g. an interrupted `/fix`), tick what the diff shows fixed, or run `/fix` again — its
§3 reconciles the boxes from the handoffs.

**A worktree's review diffs against ancient code.**
The worktree is behind main. `/doctor` check 6 shows "behind by N commits" per live worktree;
`git rebase main` in the worktree before the next review.

**The cycle workflow returns the same `questions` every run.**
That's the signal the spec is vague, not that the loop is stuck — every recurring question maps
to a spec section to sharpen (§5 contract precision, design links, role matrix). Fix upstream in
`/spec`; the readiness gate stops flagging it.

**A workflow run died mid-flight (session killed, headless audit interrupted).**
There is no resume for headless runs. Disk state is safe by design: reports staged, remediation
appended, backlog written — relaunch the workflow (or continue conversationally) and it picks up
from the files.

## Dashboard

**"Dashboard not built yet".**
You're running from a source checkout without `dashboard/dist/`:
`npm run build:dashboard` once (the published npm package ships it prebuilt).

**Port in use / need remote access.**
`--port=N`; `--host=0.0.0.0` exposes it (security warning — the actions execute code; trusted
networks only).

## Nuclear option

The dashboard's **Reset pipeline** action backs up the project's footprint (`.claude/`,
`PIPELINE.md`, optionally `specs/`) to `.claude.bak-<ts>/`, wipes it, reinstalls a fresh core;
you then re-run `/init-pipeline`. The shared `~/.claude` global core is never touched.
