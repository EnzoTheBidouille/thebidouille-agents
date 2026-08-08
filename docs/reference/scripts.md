# Shipped scripts

Installed to `<core>/pipeline/scripts/` (`~/.claude` global, `.claude` bundled). Two families:
**shipped executables** used as-is by the commands, and **templates** rendered per project by
`/cohorte-init-pipeline`. Every call site chains them with `|| true`, so a missing script is a *silent*
no-op — `/cohorte-doctor` check 1 is what catches a half-copied core.

## `preflight.sh` — the deterministic phase gate

```sh
preflight.sh <report-file> "<cmd>" ["<cmd>"...]
```

Runs each command through `sh -c`, all output appended to `<report-file>` (the bulk never enters
any agent's context). First failure ⇒ prints the last 40 lines of the report raw to stderr, exit
1 — the caller (**`/cohorte-review` §0, the workflow preflight phases**) must stop there
and spawn no agents. All green ⇒ writes `.claude/preflight.ok` (`<epoch> <HEAD sha> <tree digest>`), the stamp
`gate.py` checks before letting review dispatches through. It is a **local, gitignored** file —
never commit it (see [gate.md](gate.md#the-preflight-phase-gate)).

## `loop.sh` — the autonomous review ⇄ fix driver

```sh
loop.sh <feature-id> [--max=N] [--no-build] [--rebuild] [--resume]
```

Backs [`/cohorte-loop`](/reference/commands). Runs each phase as a **separate `claude -p` child session**
(flags from `CLAUDE_FLAGS`, default `--permission-mode bypassPermissions` — see below) so the calling session never
accumulates the diff, the N review reports or the N contracts — all child output goes to
`specs/reports/<id>.loop.log`, and `/cohorte-loop` is forbidden to read it back. stdout is one line per
phase plus a closing verdict line, nothing else.

Reads four fields from `specs/reports/<id>.verdict.json` — `blocking`, `fingerprint`, `deferred` and
`unreviewed` — plus `verdict` from `<id>.readiness.json` and `dead` from `<id>.build.json`, all with
`sed`/`grep`, so it needs no `jq` and no runtime dependency. A non-empty `dead[]` (an implementer never
built its surface) or `unreviewed[]` (a reviewer never audited one) aborts as **exit 2**, checked
*before* `blocking` — a dead reviewer makes `blocking == 0` a claim about code nobody read. A build
phase that produced **no `<id>.build.json` at all** aborts the same way: a phase cut short never
reaches the step that writes the report, so there is no `dead[]` to find and no surface to name,
while the child still exits 0. "No report" is not "nothing to report". Otherwise it
stops on `blocking == 0` (exit 0), the
`--max` ceiling (1), a missing or preflight-aborted verdict (2), a fingerprint identical to the
previous pass (3), or a `NOT-READY` readiness verdict from `/cohorte-build` (4 — the spec cannot be built, so
no pass count will help); usage errors exit 64. Skips `/cohorte-fix` on the last pass, and commits each fix pass
as `loop(<id>): fix pass <i>`. The `specs/reports/<id>.built` stamp is the driver's own
bookkeeping — `/cohorte-build` knows nothing about it, which is why `--no-build` ignores the stamp
entirely (a feature built before the stamp existed still skips correctly).

**State in the spec, not in the driver.** Before each phase it stamps `status: in-progress`,
`loop_pass` and `loop_phase` into `specs/<id>.md`'s front-matter with `awk` (a temp file + `mv`, so no
GNU/BSD `sed -i` divergence), and on exit a terminal `in-review` or `blocked`. `--resume` reads
`loop_pass` back and continues from that pass. A spec with no front-matter makes every stamp a silent
no-op: this is bookkeeping for resume and the dashboard, never a precondition — the loop must not die
over a status line.

**Why `bypassPermissions` and not `acceptEdits`.** `acceptEdits` auto-approves Write/Edit and nothing
else, so every child `Bash` call falls back to the `settings.json` rules — and the first one no
`allow` prefix covers raises a permission prompt that a `claude -p` child has nobody to answer. It
stalls, prints prose asking for approval, and **exits 0**, which the driver scores as a clean phase.
`bypassPermissions` is also the mode [`gate.py`](gate.md) is built for: it escalates every `ask`
match to a hard **deny** there, so the dangerous commands stay blocked deterministically from
PIPELINE.md `gate` while typecheck/lint/tests/`git diff` stop needing a human. Set `CLAUDE_FLAGS` to
run children in a stricter mode when you are watching. The driver also exports
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`: print mode otherwise *terminates* still-running background
tasks after its ceiling, which cuts a 25–40 min implementer batch off mid-write and still exits 0.

Unlike the other shipped executables, its call site does **not** chain `|| true` — its exit code
*is* the result, and `/cohorte-doctor` check 1 verifies it is present and executable.

It re-execs itself under `caffeinate -ims` (guarded by `COHORTE_CAFFEINATED`). The inhibitor is
**probed before the `exec`**, not merely looked up on PATH: `exec` replaces the shell, so an
inhibitor that exists but is *refused* — `systemd-inhibit` answers `Failed to inhibit: Access
denied` in a container, in CI, or in any session without a logind seat — would become the driver's
own exit code and the run would never start. Absent or refused both fall through to a no-op: an
unheld power assertion is a degraded run, not a failed one. System sleep aborts every in-flight `claude -p`
request, and that abort is byte-identical to "the agent returned nothing" — the `dead` family this
driver exists to catch. It **cannot** prevent lid-close sleep; no userspace assertion can.

## `loop-detach.sh` — running the driver so it outlives the session

```sh
loop-detach.sh start <feature-id> [loop.sh flags…]
loop-detach.sh wait  <feature-id>
```

Backs [`/cohorte-loop`](/reference/commands)'s launch. A multi-hour driver cannot be a foreground
Bash call (one call is capped at 600 s) and must not be a backgrounded one: a backgrounded call is
**not detached**, so the driver stays in the calling session's process group and a Claude Code
restart, crash or laptop sleep takes `loop.sh` and every `claude -p` child down with it, mid-write.
`start` launches it in its own `screen` session — `screen`'s server double-forks and reparents to
init — and returns immediately. Without `screen` on `PATH` it falls back to `nohup` and **says so**:
that fallback survives `SIGHUP` but not a teardown, and a silent downgrade would read as "safe to
walk away" when it is not.

`wait` blocks up to ~9 min (36 × 15 s, inside the tool ceiling) and prints the status file, ending
in `__EXIT__ <code>` when finished or `__RUNNING__` when not — call it again on `__RUNNING__`. The
exit code is `loop.sh`'s own, appended by the launch wrapper because `screen` discards it and
`/cohorte-loop`'s whole report table is keyed on it.

Two files, one letter apart, and the distinction is the command's entire token economy:
`specs/reports/<id>.loop.status` is the driver's stdout — one line per phase, safe to read;
`<id>.loop.log` is the full transcript of every child session and must never enter a session.
`start` refuses to launch a second driver on a feature that already has one, since two would
interleave commits and fight over the same verdict files — checked via `screen -ls` and, for the
tiers that have no session to list, `pgrep`.

### Platform support

Both scripts degrade in tiers rather than failing, but the tiers are **not** equivalent — what
matters for survival is escaping the caller's process *group*, not merely ignoring `SIGHUP`.

| | detach (`loop-detach.sh`) | stay-awake (`loop.sh`) |
| --- | --- | --- |
| **macOS** | `screen` (ships at `/usr/bin/screen`) — fully detached | `caffeinate -ims` |
| **Linux** | `screen` if present, else `setsid` (util-linux) — both fully detached | `systemd-inhibit --what=sleep:idle`, or a no-op without systemd (or where it is refused — containers, CI, seatless sessions) |
| **Windows** (Git Bash) | `nohup` only — **not** detached | no-op |

On Windows the driver still runs and still ignores `SIGHUP`, but it stays in the calling process
group, so a Claude Code restart or crash takes it down. `loop-detach.sh` prints that warning
explicitly instead of degrading silently. For an unattended Windows run, either install `screen`
into your Git Bash environment or start the driver from your own terminal — it is an ordinary
script and needs nothing from the calling session:

```sh
bash <core>/pipeline/scripts/loop.sh <feature-id>
```

Lid-close sleep cannot be prevented on **any** platform by any userspace assertion.

## `kanban-move.sh` — board updates outside agent context

```sh
kanban-move.sh auto <feature_id> <stage> [--pr <num>] [--title <title>]
kanban-move.sh <board.md> <feature_id> <column> [--pr <num>] [--title <title>]
kanban-move.sh --check
```

Moves (or creates) the `#<feature_id>` card under the target `## <column>` heading — find,
dedupe (keeps the first), sub-notes carried along, the `%% kanban:settings %%` block preserved,
`— PR #<num>` appended with `--pr`. Exists so no agent ever reads a whole board (which grows
with every feature ever tracked) into context.

**`auto` resolves the board itself** — `name` from `PIPELINE.md`, then `kanban.enabled` /
`obsidian.vault_path` / `boards[name]` from `~/.claude/cohorte.config.yaml` (override with
`COHORTE_CONFIG`; skip the profile with `--project <name>`) — and maps a **stage key** (`ideas`,
`brainstorm`, `spec`, `ready`, `building`, `review`, `fix`, `ship`, `shipped`) to that board's
heading via `boards[name].columns` → `kanban.columns` → the built-in default. An explicit board
path and a literal heading still work.

When nothing resolves it prints `kanban: <reason>` — naming the missing link — and exits **0**. A
board that *is* configured but can't be moved is loud instead: exit 2 usage, exit 3 missing board
file or unknown column. Callers report which line they got; none of them may infer "no board" on
their own. `--check` does the resolution and nothing else, which is what `/cohorte-doctor` and
`/cohorte-update-pipeline` use to tell "not configured" from "configured and broken".

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

Shipped as `.template` files; `/cohorte-init-pipeline` renders them to `scripts/` in your repo,
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
- `scripts/test-loop.mjs` — **behavioural** tests for `loop.sh`, run end-to-end with a fake
  `claude` on `PATH` that produces each phase's JSON. Pins what nothing structural can see: exit 4
  on a `NOT-READY` readiness verdict (no review spawned, no build stamp), the terminal statuses that
  make a run resumable (`in-review` clean · `blocked` otherwise, with the pass recorded), `--resume`
  continuing at that pass instead of re-paying the earlier ones, and a spec with **no** front-matter
  still running to completion. The stamps are `awk` + `mv` precisely so they behave identically on
  GNU and BSD — a `sed -i` there would pass CI on Linux and corrupt every spec on macOS.
- `scripts/test-gate.mjs` — **behavioural** tests for `hooks/gate.py`, driving its real
  stdin→stdout contract with PreToolUse payloads: the deny/ask tiers, chained-command splitting
  (`&&`, `;`, `|`, `||`, newlines), branch-conditional gating resolved at the *payload's* cwd,
  the `bypassPermissions` ask⇒deny escalation, config robustness (missing/unparseable ⇒ silent),
  the preflight phase gate (missing/stale/HEAD-moved/unreadable stamp), and worktree-aware HEAD
  matching. The gate is the only component that can block a user's command; `py_compile` proves
  only that it parses.
- `scripts/test-dashboard.mjs` — tests for `dashboard/server/*.js`, all shipped runtime code: the
  block-YAML parser (against the real `PIPELINE.template.md`), the metrics aggregator (new +
  legacy line formats), the JS port of `/cohorte-doctor` (each check green, then each one made to fail),
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
