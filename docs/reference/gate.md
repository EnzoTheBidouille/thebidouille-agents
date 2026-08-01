# Gate & permissions

Autonomous agents running Bash need guardrails that don't depend on the model's good behavior.
Cohorte layers three mechanisms, all generated from the profile.

## `hooks/gate.py` — the PreToolUse gate

A Python hook registered on the `Bash` (and `Task`) PreToolUse events — in the **global**
`~/.claude/settings.json` for a global core (registered once; it reads each repo's own config
and no-ops where absent), or the repo's `.claude/settings.json` for a bundled core. It inspects
the **full command string**, splitting on `&&`, `||`, `;`, `|` and newlines, so chained forms
like `cd apps/api && node ace migration:run` are caught — something prefix-based permission
rules can't do.

Patterns come from `.claude/gate-config.json`, generated from the profile's `gate` block:

| Tier | Behavior |
| --- | --- |
| `deny` | Hard-blocked, on any branch (destructive DB: `migration:fresh`, `db:wipe`, …). |
| `ask` | Confirmation prompt, on any branch (migrations, `psql`, …). |
| `ask_on_default_branch` | Confirmation **only when the checked-out branch is the default branch** — free on feature branches (`git commit/push/merge/rebase/reset`, `docker compose`). The branch is resolved at run time via `git rev-parse`; unknown branch (no repo / detached) ⇒ gated, to stay safe. |

Design decisions worth knowing:

- **It fires for every agent in the session** — the lead, `/build`'s implementers, and
  subagents spawned by the Workflow runtime alike. Workflow subagents run in `acceptEdits`
  whatever the session mode (their Write/Edit calls are auto-approved), but `acceptEdits` does
  **not** auto-approve Bash or Task — the gate still sees and can block them.
- **Unattended runs: ask ⇒ deny.** In `bypassPermissions` (headless `claude -p`, dashboard
  actions) there is no human to answer a prompt, so every `ask` match is escalated to a hard
  deny with the reason attached — a clear refusal beats a prompt that can never be answered.
- **Fail-open on config problems**: a missing or unparseable `gate-config.json` makes the hook
  silent, letting `settings.json` rules decide — the gate never bricks a repo.

## The preflight phase gate

The `preflight` block of `gate-config.json` (from `gate.preflight` in the profile) makes the
gate enforce **pipeline ordering**, not just command safety: a `Task` dispatch of a listed
`subagent_type` (default `review`) requires a fresh `.claude/preflight.ok` stamp —
written by `pipeline/scripts/preflight.sh` only when typecheck + lint + tests are green.
Missing stamp, stamp older than `max_age_minutes` (default 30), or HEAD moved since ⇒ the
dispatch gets an "ask": a lead can't accidentally review red code, a human can consciously
override. Profiles without the block simply skip the phase gate (older installs keep working).

## `settings.json` permissions

`/init-pipeline` writes the repo's `.claude/settings.json`:

- **`ask`/`deny` rules** mirroring the gate patterns (defense in depth — the hook catches
  chained forms the rules miss; the rules catch anything if the hook is unregistered).
- **An `allow` list** so agents never stall on prompts for read-only/verification work — and,
  since 1.3.0, never stall **mid-workflow** where nobody is watching: the per-surface
  `test/lint/typecheck/build` commands *and their quiet variants*, repo-wide equivalents,
  read-only git (`status`, `diff`, `log`, `rev-parse`), the shipped `pipeline/scripts/*.sh` for
  both install modes, and the retrieval provider's MCP tools. Nothing matching a `gate.ask`/
  `gate.deny` pattern is ever allowlisted.
- **Hooks per install mode**: bundled ⇒ the PreToolUse gate + the PostToolUse formatter are
  registered here; global ⇒ the gate is already in `~/.claude/settings.json` (re-registering
  would double-prompt), only the formatter + permissions are written.

`/update-pipeline` patches all of this **additively** — it adds missing entries, never removes
or rewrites your custom keys. `/doctor` check 3 flags drift between the profile's gate block and
`gate-config.json`, and double hook registrations.

## Division-of-labor rules the agents themselves enforce

Beyond the mechanical gate, the agent instructions carry hard rules the pipeline depends on:

- Implementers never edit the frozen **contract** (mismatch ⇒ report, never fix) and never touch
  another surface's tree.
- Migrations are **append-only** everywhere; `gate.deny` commands are never run even if the
  hook were absent.
- The `release` agent never edits source, never force-pushes, refuses staged secrets.
- `/align-ds` uses DesignSync strictly read-only — never write/delete/finalize on a curated
  design system.
- `/ship` is the only outward-facing step, and it always waits for an explicit human yes.
