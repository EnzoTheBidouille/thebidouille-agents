# Troubleshooting

First reflex, always: **`/cohorte-doctor`** — it checks every piece of wiring and prints the exact fix
per failure. This page covers the failures with a story behind them.

## Installation & versions

**A command exists but its agent doesn't (or vice-versa).**
Half-copied or stale core. Re-run the installer (`npx cohorte@latest update --global` or
`update`). `/cohorte-doctor` check 1 flags a `VERSION` newer than its sibling files — the signature of a
half-done update.

**Kanban cards stopped moving / telemetry went quiet — with no error anywhere.**
Every caller chains the shipped scripts with `|| true`, so a missing
`kanban-move.sh`/`telemetry-send.sh`/`preflight.sh` is a *silent* no-op. `/cohorte-doctor` check 1 is
the only thing that sees it; the fix is re-running the installer.

**Cards move for some stages and not others.**
Run `kanban-move.sh --check` (or `/cohorte-doctor` check 7b): it prints the resolved board, or the
exact link that is missing. Before 2.0.2 the stages only *described* the move, so a phase session —
each one starts after a `/clear`, with no memory of the config — could conclude "no board is
configured" without opening it, and report success either way. Update the core; every stage now
calls the resolver and reports what it printed.

**The board went quiet right after renaming the project.**
`kanban.boards` is keyed by the profile `name`, so editing `name:` in `PIPELINE.md` orphans the old
entry and no lookup matches the new one — a legitimate "no board configured", indistinguishable from
never having had one. `/cohorte-update-pipeline` spots the orphan and offers to re-key it; or edit
the key in `~/.claude/cohorte.config.yaml` by hand.

**`pipeline.json` claims an old `core_version` on a current core.**
Global-mode drift: the shared core can't know which repos point at it. Warn-level, not broken —
`/cohorte-update-pipeline` syncs the field (and tells you to commit it).

**A workflow says the Workflow runtime is unavailable.**
`/cohorte-doctor` check 8 tells you which prerequisite fails: Claude Code < 2.1.154, workflows disabled
for the session, scripts missing (`<core>/workflows/`), or the `profile-reader` agent missing.
The conversational commands are the designed fallback — nothing is broken.

## Serena / retrieval

**Agents silently fell back to grep-and-read.**
The MCP server failed to start. Run the health check (`/cohorte-doctor` check 4): the usual causes are
`serena` not on PATH in the environment Claude Code was launched from (fix: the PATH-proof
launcher entry in `.mcp.json`, or `uv tool update-shell`), the tool uninstalled, or a hand-edited
entry. After repair, a **session restart** is needed before the tools appear — `/cohorte-doctor` says so
explicitly rather than reporting success on registration alone.

## Gate & permissions

**The gate prompts twice for the same command.**
Double hook registration (usually a bundled repo whose global settings also register the gate).
`/cohorte-doctor` check 3 flags it; remove the duplicate PreToolUse entry.

**A review dispatch asks for confirmation about a "preflight stamp".**
The phase gate: preflight hasn't run green recently, or the code changed since it did. Run the
command's §0 preflight (or let it run — the prompt is the sign something skipped it). You can
consciously confirm through it; the point is that it can't happen *accidentally*.

**Every review dispatch claims the stamp is stale / "HEAD moved" on a clean tree.**
`.claude/preflight.ok` got committed. The stamp names the tree it verified, so the commit carrying
it moves HEAD past that tree — the copy in git can never match its own commit, and it rides into
every clone and new worktree as a green nobody earned. Untrack it:
`git rm --cached .claude/preflight.ok` and add `.claude/preflight.ok` to `.gitignore`
(`/cohorte-doctor` check 3 flags this as ❌). Since 2.0.0 the stamp also carries a content digest
instead of keying on HEAD, so committing already-verified code no longer invalidates it.

**Headless runs (dashboard actions, `claude -p`) get hard denies on gated commands.**
By design: in `bypassPermissions` there's nobody to answer an "ask", so the gate escalates it to
a clear deny. Run that operation interactively instead.

## The loop

**`/cohorte-ship` refuses: freshness mismatch.**
Source (or the contract) changed after the SHIP verdict — the verdict is stale. Re-run
`/cohorte-review <id>`; ship only on the fresh stamp. This is the gate working, not failing.

**`/cohorte-build` keeps re-dispatching items that were already fixed.**
The spec's `## Remediation` checkboxes are the state. If a prior round's fixes were never ticked
`- [x]` (e.g. an interrupted `/cohorte-fix`), tick what the diff shows fixed, or run `/cohorte-fix` again — its
§3 reconciles the boxes from the handoffs.

**A worktree's review diffs against ancient code.**
The worktree is behind main. `/cohorte-doctor` check 6 shows "behind by N commits" per live worktree;
`git rebase main` in the worktree before the next review.

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
you then re-run `/cohorte-init-pipeline`. The shared `~/.claude` global core is never touched.
