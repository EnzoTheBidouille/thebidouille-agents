# Getting started

## Prerequisites

- **A supported coding agent** — Claude Code, Codex CLI, Cursor, Gemini CLI or OpenCode
  ([matrix](/reference/runtimes)). All five have real subagents, which the pipeline requires.
  On Claude Code, **≥ 2.1.154 with workflows enabled** additionally unlocks the
  [workflow variants](/guide/workflows). `/cohorte-doctor` tells you what your runtime can enforce.
- **Node ≥ 18** for `npx cohorte` (the shell installers work without Node).
- **Python 3** on PATH — the destructive-command gate hook (`gate.py`) runs through it.
- Optional: [`uv`](https://docs.astral.sh/uv/) to install **Serena** (the default code-retrieval
  provider): `uv tool install -p 3.13 serena-agent`, and make sure `~/.local/bin` is on PATH
  (`uv tool update-shell`).
- Optional: `gh` (GitHub CLI) — `/cohorte-ship` uses it to open PRs and watch CI; without it you get a
  compare URL + drafted PR body instead.

## Install the core

Two modes. Pick one per machine/project — you can mix (a bundled repo and a global core can
coexist; the bundled one wins inside its repo).

Add `--runtime=codex,cursor` (or `--all-runtimes`) to target coding agents other than Claude
Code. With no flag the installer detects what you have and asks; with no TTY it installs for
Claude Code alone.

### Global (recommended) — one core for every repo on the machine

```sh
npx cohorte install --global
```

Copies the core into `~/.claude/` and registers the gate hook once in the global
`settings.json` (it reads each repo's own `gate-config.json`, and no-ops where absent — one
registration serves every project). The commands and agents are then available in **every**
project.

### Bundled — the core committed inside one repo

```sh
# from inside the project (or pass its path):
npx cohorte install
```

Copies the core into the project (`<project>/.claude/`, or `.cohorte/<runtime>/` for the other
agents), which you commit — teammates get the exact pipeline version with the checkout.

### Without Node

```sh
curl -fsSL https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/install.sh | sh -s -- --global
```

```powershell
# Windows PowerShell 5.1+
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/install.ps1))) -Global
```

Both mirror the npm CLI exactly (same files, same scrub of retired artifacts, same config seeding).

::: tip What lands where
Either mode installs: `commands/` (the slash commands), `agents/` (the four fixed agents —
review, release, profile-reader), `hooks/gate.py`, `templates/`, `workflows/` (the four
workflow scripts), and `pipeline/` (the profile templates, `SCHEMA.md`,
`implementer.template.md` — the surface-agent template lives here, *not* in `agents/`, so it is
never mistaken for a dispatchable agent — the shipped scripts `preflight.sh` and `kanban-move.sh`,
and `VERSION` + `CHANGELOG.md`). A
user-level `~/.claude/cohorte.config.yaml` is seeded once (the kanban config; never
clobbered on update).
:::

## Initialize a project

Open the project in your coding agent and run:

```
/cohorte-init-pipeline
```

One-time per project, interactive, in five steps:

1. **Detect** — reads the repo (read-only, no questions yet): package manager, workspace layout,
   apps/services, test/lint/typecheck commands, migration tooling, CI.
2. **Interview the gaps** — asks *only* what it couldn't detect, batched:
   - **Surfaces & ownership** — one entry per independently-built area (`backend` → `apps/api`,
     `frontend` → `apps/web`, …), each with its agent name, tools, and model tier (`sonnet`
     default / `haiku` for mechanical / `inherit` only when real design decisions justify the
     lead's model).
   - **Quiet commands** — the bridled variants agents actually run (`--reporter=dot`,
     `--quiet`, failures-only) so a green test run costs lines, not pages.
   - **Contract** mechanism (shared Zod types / OpenAPI / protobuf / JSON-schema / none) and
     where feature contracts live.
   - **UI language**, **RBAC** hierarchy, **design system** (provider, kit/token paths),
     **code retrieval** provider (Serena by default), **isolation** (parallel git worktrees with
     per-feature DB + ports), **gate** patterns (destructive commands to deny / confirm), and the
     `/cohorte-brainstorm` **personas**.
   - Optional: **kanban** mirror (Obsidian board)
     question (default No).
3. **Draft** — shows you the assembled `PIPELINE.md` for approval.
4. **Write & render** — writes `PIPELINE.md`, renders one agent file per surface (conventions
   baked in), generates the project's `gate-config.json` (+ `settings.json` permissions on Claude Code
   allow-list + hooks), wires the retrieval provider (committed `.mcp.json`), renders the
   isolation scripts, seeds `specs/_template.md`, writes the committed `pipeline.json`
   pointer, and (optionally) a CI workflow.
5. **Report** — install mode, files written, surface → agent mapping.

Then:

```sh
git add PIPELINE.md .claude specs .mcp.json
git commit -m "chore: install cohorte pipeline"
```

## Sanity check

```
/cohorte-doctor
```

Verifies the whole wiring: core version + pointer coherence, agents ↔ surfaces (no orphans),
model pins, hooks + gate config, retrieval health, design paths, isolation slots, the kanban
board link, **workflows availability** (check 8), specs & metrics hygiene. Every failure
comes with its exact fix command.

## Your first feature

```
/cohorte-brainstorm          ← pressure-test the idea with the persona panel
/clear
/cohorte-spec                ← freeze specs/<id>.md — the single source of truth
/clear
/cohorte-ship <id>           ← commit, push, PR (the one human-confirmed step)
```

Prefer manual control? The conversational path is the same pipeline, one phase at a time:
`/cohorte-build <id>` → `/cohorte-review <id>` → `/cohorte-fix <id>` → `/cohorte-ship <id>`. See
[The feature cycle](/guide/feature-cycle).

## Keeping it current

```sh
npx cohorte@latest update --global   # refresh the core (never touches generated files)
```

then, inside each project:

```
/cohorte-update-pipeline
```

which **reconciles** the generated files to the new core: tops up new profile fields at their
defaults (asking only for genuine human decisions, batched), re-renders the surface agents (this
also refreshes their baked conventions), additively patches `settings.json`/`gate-config.json`,
re-runs capability wiring health checks, and shows the CHANGELOG entries you just gained.
`/cohorte-init-pipeline` never needs re-running for an upgrade.
