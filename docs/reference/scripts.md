# Shipped scripts

Installed to `<core>/pipeline/scripts/` (`~/.claude` global, `.claude` bundled). Two families:
**shipped executables** used as-is by the commands, and **templates** rendered per project by
`/init-pipeline`. Every call site chains them with `|| true`, so a missing script is a *silent*
no-op — `/doctor` check 1 is what catches a half-copied core.

## `preflight.sh` — the deterministic phase gate

```sh
preflight.sh <report-file> "<cmd>" ["<cmd>"...]
```

Runs each command through `sh -c`, all output appended to `<report-file>` (the bulk never enters
any agent's context). First failure ⇒ prints the last 40 lines of the report raw to stderr, exit
1 — the caller (**`/review` §0, the workflow preflight phases**) must stop there
and spawn no agents. All green ⇒ writes `.claude/preflight.ok` (`<epoch> <HEAD sha>`), the stamp
`gate.py` checks before letting review dispatches through.

## `loop.sh` — the autonomous review ⇄ fix driver

```sh
loop.sh <feature-id> [--max=N] [--no-build] [--rebuild]
```

Backs [`/loop`](/reference/commands). Runs each phase as a **separate `claude -p` child session**
(flags from `CLAUDE_FLAGS`, default `--permission-mode acceptEdits`) so the calling session never
accumulates the diff, the N review reports or the N contracts — all child output goes to
`specs/reports/<id>.loop.log`, and `/loop` is forbidden to read it back. stdout is one line per
phase plus a closing verdict line, nothing else.

Reads exactly two scalars from `specs/reports/<id>.verdict.json` — `blocking` and `fingerprint` —
with `sed`, so it needs no `jq` and no runtime dependency. Stops on `blocking == 0` (exit 0), the
`--max` ceiling (1), a missing or preflight-aborted verdict (2), or a fingerprint identical to the
previous pass (3); usage errors exit 64. Skips `/fix` on the last pass, and commits each fix pass
as `loop(<id>): fix pass <i>`. The `specs/reports/<id>.built` stamp is the driver's own
bookkeeping — `/build` knows nothing about it, which is why `--no-build` ignores the stamp
entirely (a feature built before the stamp existed still skips correctly).

Unlike the other shipped executables, its call site does **not** chain `|| true` — its exit code
*is* the result, and `/doctor` check 1 verifies it is present and executable.

## `kanban-move.sh` — board updates outside agent context

```sh
kanban-move.sh <board.md> <feature_id> <column> [--pr <num>] [--title <title>]
```

Moves (or creates) the `#<feature_id>` card under the target `## <column>` heading — find,
dedupe (keeps the first), sub-notes carried along, the `%% kanban:settings %%` block preserved,
`— PR #<num>` appended with `--pr`. Exists so no agent ever reads a whole board (which grows
with every feature ever tracked) into context.

## `telemetry-send.sh` — the opt-in usage ping

```sh
telemetry-send.sh <phase> <feature_id> <seconds> [results]
```

Fire-and-forget, GDPR-first: exits silently unless `~/.claude/cohorte.config.yaml` has
`telemetry.enabled: true` **and** an `install_id` **and** an `endpoint` (all three written only
by the explicit consent flow). The phase is allowlisted client-side to the seven funnel stages
(`brainstorm spec build review fix ship`); the feature id is SHA-256-hashed to 12 hex
chars before sending; 2s timeout; never fails the pipeline. See
[Telemetry & privacy](/reference/telemetry).

## `new-feature.sh` / `remove-feature.sh` — worktree isolation (templates)

Shipped as `.template` files; `/init-pipeline` renders them to `scripts/` in your repo,
substituting the `__TOKENS__` (project slug, DB pattern, port bases, compose file, branch
prefix, install/dev/migrate commands, per-surface env stanzas).

- `new-feature.sh <id>` — creates the sibling worktree `../<slug>-<id>` on branch
  `<prefix><id>`, assigns the next free slot in `.worktrees/slots.tsv`, creates the per-feature
  DB (when `db_per_worktree`), writes the env with `port_base + slot`, runs install + migrate.
- `remove-feature.sh <id> [--drop-db]` — removes the worktree, deletes the merged branch, frees
  the slot; keeps the DB unless `--drop-db`.

## Repo-side helpers (not installed)

- `scripts/validate-core.mjs` — CI's structural validator for the core itself: command/agent
  frontmatter + model pins, template placeholders, cross-references, telemetry funnel coverage,
  installer coverage of every shipped script, dashboard phase-list parity, packaging negations,
  and workflow-script invariants (parses each `core/workflows/*.js` exactly as the runtime does —
  async body wrap — plus meta literal, `profile-reader` phase 0, no `Date.now()`).
- `scripts/test-workflows.mjs` — **behavioural** tests for `core/workflows/*.js`: runs each script
  with stub agents and asserts the returned verdict object. Structural checks cannot see verdict
  logic, and one failure mode needs exactly this — `agent()` returns `null` when a subagent dies,
  so a crashed reviewer yields zero findings, indistinguishable from a clean surface. Both
  `review.js` scored that as `SHIP` until this test existed.
- `scripts/test-gate.mjs` — **behavioural** tests for `hooks/gate.py`, driving its real
  stdin→stdout contract with PreToolUse payloads: the deny/ask tiers, chained-command splitting
  (`&&`, `;`, `|`, `||`, newlines), branch-conditional gating resolved at the *payload's* cwd,
  the `bypassPermissions` ask⇒deny escalation, config robustness (missing/unparseable ⇒ silent),
  the preflight phase gate (missing/stale/HEAD-moved/unreadable stamp), and worktree-aware HEAD
  matching. The gate is the only component that can block a user's command; `py_compile` proves
  only that it parses.
- `scripts/test-dashboard.mjs` — tests for `dashboard/server/*.js`, all shipped runtime code: the
  block-YAML parser (against the real `PIPELINE.template.md`), the metrics aggregator (new +
  legacy line formats), the JS port of `/doctor` (each check green, then each one made to fail),
  the Obsidian board parser, the fleet registry, and the HTTP guards — driven over a real socket,
  because `fetch` silently drops a forged `Host` header and would pass against no guard at all.
- `scripts/assert-gate-hook.mjs` — post-install assertion on a `settings.json`: exactly one
  `gate.py` registration (callers install twice first), with a matcher covering both `Bash` and
  `Task`. Both invariants are shipped regressions.
- `.github/workflows/ci.yml` — runs the validator, syntax-checks CLI/server/hook/installers,
  and **dry-runs both installers** into scratch homes, asserting the exact postconditions
  (agents present, scripts executable, workflows shipped, templates-not-rendered).
- `.github/workflows/publish.yml` — publish-on-main: version-diff check against the registry, a
  required CHANGELOG entry, dashboard build, `npm publish --provenance` (token-less OIDC trusted
  publishing), tag + GitHub release.
