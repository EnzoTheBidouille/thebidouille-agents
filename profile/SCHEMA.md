# PIPELINE.md profile — field reference

`/cohorte-init-pipeline` fills the `yaml pipeline-profile` block in `PIPELINE.md` (from
`PIPELINE.template.md`) plus the prose sections. This documents every field and how the
generic pipeline uses it, so a stateless agent can read/regenerate the profile correctly.

## `yaml pipeline-profile` block

| Field                                | Type         | Used by                           | Meaning                                                       |
| ------------------------------------ | ------------ | --------------------------------- | ------------------------------------------------------------- |
| `name`                               | string       | all                               | Project name, used in agent prose + commit scopes.            |
| `one_liner`                          | string       | brainstorm/spec                   | One-sentence product description.                             |
| `ui_language`                        | string       | implementer, review               | Language of ALL user-facing copy.                             |
| `package_manager`                    | enum         | all                               | `pnpm`/`npm`/`yarn`/`bun`/`pip`/`cargo`/`go`.                 |
| `vcs.host`                           | enum         | release                           | `github`→use `gh`; else emit compare URL.                     |
| `vcs.remote`                         | string       | release                           | `owner/repo` for the PR/compare URL.                          |
| `vcs.default_branch`                 | string       | build, review, release            | Base branch for diffs + PRs.                                  |
| `vcs.feature_branch_prefix`          | string       | ship, isolation script            | `feature/` → branch `feature/<id>`.                           |
| `repo.layout`                        | enum         | build, audit                      | `monorepo` (many surfaces) or `single`.                       |
| `repo.workspace_tool`                | enum         | audit                             | `turborepo`/`nx`/`none`.                                      |
| `retrieval.provider`                 | enum         | init, update-pipeline, implementer | `serena` (default) / `graphify` / `none` — see §Code retrieval. |
| **`surfaces[]`**                     | list         | **build, review, refactor, init** | One per independently-built area. Grows via reconcile (below). |
| `surfaces[].key`                     | string       | build                             | Short id + review scope.                                      |
| `surfaces[].path`                    | string       | implementer                       | The ONLY tree that surface's agent may touch.                 |
| `surfaces[].label`                   | string       | build, init (`<SURFACE_LABEL>`)   | Human label + framework, e.g. `frontend (React)`.            |
| `surfaces[].agent`                   | string       | build (`subagent_type`)           | Rendered agent file name.                                     |
| `surfaces[].tools`                   | list         | init                              | Frontmatter `tools:` for the rendered agent.                  |
| `surfaces[].model`                   | enum         | init (`<SURFACE_MODEL>`)          | Frontmatter `model:` tier — `sonnet`/`haiku`/`inherit`. Default `sonnet` (implementers mostly apply a frozen contract — far cheaper than the Opus lead the dispatcher runs on, and Sonnet handles it well); `haiku` for purely mechanical surfaces (scaffolding); `inherit` only for surfaces with real design decisions worth the lead's model. |
| `surfaces[].*_cmd`                   | string       | implementer                       | test/lint/format/typecheck/build commands.                    |
| `surfaces[].test_quiet_cmd` `.lint_quiet_cmd` | string | implementer, preflight, workflows | Bridled variants agents actually run (dot reporter / `--quiet` / failures-only). `""` ⇒ `<cmd> 2>&1 \| tail -40`. See §Output discipline. |
| `surfaces[].uses_design`             | bool         | build, frontend                   | Whether this surface consumes designs.                        |
| `contract.enabled`                   | bool         | build                             | `false` ⇒ skip contract authoring (§2 of /cohorte-build).             |
| `contract.mechanism`                 | enum         | build, lead                       | `shared-types-zod`/`openapi`/`protobuf`/`json-schema`/`none`. |
| `contract.path` `.ext` `.index`      | string       | build                             | Where `<feature_id>` contract is authored + barrel.           |
| `contract.authored_by`               | const `lead` | build                             | Implementers import it read-only, never edit.                 |
| `commands.*`                         | string       | all                               | Repo-wide install/dev/lint/format/typecheck/test + migrate.   |
| `commands.test_quiet` `.lint_quiet`  | string       | review, audit, workflows          | Repo-wide bridled variants — what the `/cohorte-review` pre-flight runs. Same fallback as the per-surface ones. |
| `rbac.enabled`                       | bool         | brainstorm, review                | Toggle RBAC personas + authz audit.                           |
| `rbac.hierarchy`                     | list         | review                            | Highest→lowest role list.                                     |
| `design.enabled`                     | bool         | build, frontend, align-ds         | `false` ⇒ design steps are no-ops.                            |
| `design.provider`                    | enum         | frontend, align-ds                | `claude-design`/`figma`/`none`.                               |
| `design.design_system_project`       | id           | align-ds, frontend                | UI-kit source of truth.                                       |
| `design.design_project`              | id           | build, frontend                   | Legacy fallback for bare-filename `design_files` only; default `none`. New specs use full `…/design/p/<projectId>?file=<file>` links that carry their own project + page (nothing to go stale on a DS rebuild). |
| `design.snapshot_dir`                | path         | align-ds                          | Committed DS snapshot for diffing.                            |
| `design.ui_kit_path` `.tokens_path`  | path         | align-ds, frontend                | Where the kit + tokens live in code.                          |
| `isolation.enabled`                  | bool         | new-feature script                | `false` ⇒ build in main checkout.                             |
| `isolation.db_per_worktree`          | bool         | new-feature script                | Create `<name>_<id>` DB per worktree.                         |
| `isolation.db_name_pattern`          | string       | new-feature script                | `<name>_<id>`.                                                |
| `isolation.port_base`                | map          | new-feature script                | `api`/`web` base ports; +slot per worktree.                   |
| `isolation.compose_file` `.registry` | path         | new-feature script                | Docker stack + slot registry.                                 |
| `gate.deny[]`                        | list         | hooks/gate.py, settings           | Command substrings hard-denied, on any branch.                |
| `gate.ask[]`                         | list         | hooks/gate.py, settings           | Command substrings that require confirm, on any branch.       |
| `gate.ask_on_default_branch[]`       | list         | hooks/gate.py                     | Confirm ONLY on `default_branch`; free on feature branches.   |
| `gate.default_branch`                | string       | hooks/gate.py                     | Protected branch (default `main`); gate resolves via git.     |
| `gate.preflight.enabled`             | bool         | hooks/gate.py, review             | Phase gate: review dispatches need a fresh preflight stamp. See §Preflight. |
| `gate.preflight.agents[]`            | list         | hooks/gate.py                     | `subagent_type`s the stamp gates (default `[review]`).        |
| `gate.preflight.max_age_minutes`     | number       | hooks/gate.py                     | Stamp freshness window (default 30).                          |

## Prose sections

- **Conventions** — per-surface rules the implementer follows and review audits.
- **Testing** — the TDD contract per surface (what a test must cover, DB isolation).
- **Design brief note** — feeds `/cohorte-spec` §8 and the Claude Design step.
- **Personas** — the `/cohorte-brainstorm` panel; include one per RBAC role when `rbac.enabled`.

## How the pieces reference this file

- **Agents** (`implementer`, `review`, `release`) are told at dispatch: _read `PIPELINE.md`
  §Commands / §Conventions / §Surfaces first._ They have `Read`, so they load it live.
- **Commands** (`/cohorte-build`, `/cohorte-review`, …) parse the `yaml pipeline-profile` block to know how
  many surfaces to dispatch, the contract mechanism, the commands, and the capability flags.
- **Hook** (`gate.py`) reads `gate.deny`/`gate.ask`/`gate.ask_on_default_branch`/`gate.default_branch`
  from a generated `.claude/gate-config.json`. The last two make git + docker free on feature branches
  but confirm-gated on the default branch (branch resolved at run time via `git rev-parse`).
- **Scripts** (`new-feature.sh`) read the `isolation` block (rendered in at init).

## Code retrieval — `retrieval.provider`

Agents spend most of their wall-clock reading the repo; a retrieval provider replaces grep-and-read
with symbol/graph queries. The flag is a **value, not a boolean**, so switching provider later is a
one-line profile change + re-running the wiring (no agent re-render needed — the guidance agents
follow is provider-agnostic: _"prefer the retrieval MCP tools over Grep/Glob + whole-file Reads"_).

| Provider | Mechanism | Freshness | Cost |
| --- | --- | --- | --- |
| `serena` (default) | live LSP symbol navigation (find symbol, references, semantic edits) | always current | none — no index |
| `graphify` | persistent tree-sitter knowledge graph over code + docs | as fresh as the last rescan | index step + re-index discipline |
| `none` | agents fall back to Grep/Glob/Read | — | — |

**Wiring (done by `/cohorte-init-pipeline`, or `/cohorte-update-pipeline` retroactively):**

- `serena` — requires the `serena` CLI (`uv tool install -p 3.13 serena-agent`). For day-to-day CLI
  use it should also be on PATH (`uv tool update-shell`; uv installs to `~/.local/bin`). Register at
  **project scope** so the registration is committed and portable (`--project-from-cwd` resolves the
  project at server start, so the committed entry works on every machine) — and register the
  **PATH-proof launcher**, not the bare command: Claude Code spawns MCP servers with whatever
  environment it was launched from (a stale terminal, a GUI/IDE launch that never sourced a shell
  profile), where `~/.local/bin` may be missing from PATH — a bare `serena` entry then dies with
  ENOENT and agents silently fall back to Grep/Read:

  ```sh
  claude mcp add --scope project serena -- sh -c 'exec "$(command -v serena || echo "$HOME/.local/bin/serena")" start-mcp-server --context claude-code --project-from-cwd --open-web-dashboard False'
  ```

  (Windows-native teams: no `sh` — register the bare `serena` form instead and ensure the uv tools
  dir is on PATH; keep the `--open-web-dashboard False` flag.) `--open-web-dashboard False` keeps the
  dashboard available (reachable at `http://localhost:24282/dashboard/`) but stops it popping a browser
  tab on every server start — the flag overrides the machine's `serena_config.yml`, so the behaviour is
  the same for everyone on the repo. Gitignore `.serena/` (per-machine cache/config). Optionally
  pre-index large repos once: `serena project index`.
- `graphify` — requires `uv tool install graphify` + `graphify install`; build the initial graph
  (`/graphify .`) and rescan incrementally after big changes (`--update`). See graphify.net.
- Rendered agents get the provider's MCP tools appended to their `tools:` list (e.g. `mcp__serena`
  grants the whole server); `none` ⇒ nothing appended.

**Serena health check** — run after wiring in `/cohorte-init-pipeline` AND on every `/cohorte-update-pipeline`
reconcile (wiring that worked once can rot: PATH changes, tool uninstalled, entry hand-edited):

1. **CLI resolves:** `command -v serena`. Fails but `~/.local/bin/serena` exists ⇒ PATH repair
   above; missing entirely ⇒ reinstall.
2. **Registered:** this repo's `.mcp.json` has the `serena` entry ⇒ else re-run the `claude mcp add`.
   If the entry is the bare `serena` form on a POSIX machine, upgrade it to the PATH-proof launcher
   above (immune to launch-environment PATH gaps). If a launcher entry predates the
   `--open-web-dashboard False` flag, append it so the dashboard no longer auto-opens a browser tab.
3. **Gitignored:** `.serena/` is in `.gitignore` ⇒ else append it.
4. **Actually connected:** the `mcp__serena` tools are exposed in the session (or `claude mcp list`
   shows serena connected). If 1–3 pass but this fails, a session restart is needed — say so
   explicitly instead of reporting success.

Report each check's result; never report Serena "wired" on registration alone.

Teammates cloning the repo get the committed `.mcp.json` and only need the provider CLI installed
and on PATH — if either is missing, the MCP server fails to start and agents silently fall back to
Grep/Read; the health check above is the diagnostic.

## Specialization — when to split one surface into more agents

`/cohorte-build` dispatches ONE agent per surface, in parallel, so build wall-clock ≈ the **slowest single
surface**. More agents only build faster when they let the *slowest* surface's work run concurrently —
and only if the split is safe. The invariant that keeps parallelism safe is **one owner per tree, and
the frozen contract as the only cross-surface channel**. So specialization means carving a surface into
**smaller non-overlapping surfaces**, never pointing two agents at the same tree.

**Split a surface into specialized sub-surfaces only when BOTH hold:**

1. **It's a bottleneck** — the surface is large (many modules / high LOC) and dominates build time.
2. **The boundary is clean** — its work partitions into trees that don't share files, e.g. feature
   modules (`src/features/*`, `src/modules/*`), route groups, or independent services (`services/*`).

**Rules when splitting (non-negotiable — they preserve the invariant):**

- **Shared code gets its own surface with a single owner.** Anything two slices both touch — routing,
  global state/store, the design-system kit + tokens, shared utils — becomes its OWN surface (e.g.
  `web-shared`), owned by exactly one agent. Never let two feature-slice agents both edit shared trees.
- **Cross-slice references go through the contract**, not direct imports between slice trees. If
  `web-checkout` needs a shape produced by `api-billing`, that shape lives in the frozen contract.
- **Don't over-split.** A slice too small to hold ≥1 real task, or one with tangled boundaries, is worse
  than not splitting — the coordination + token cost (each stateless agent re-reads `PIPELINE.md` + spec)
  outweighs the parallelism. When boundaries aren't clean, keep one surface.

Coarse first, specialize on evidence: start with one `frontend` / `backend` surface each; split only a
surface that's proven slow and cleanly separable. The evidence lives in
the **main checkout's** `.claude/pipeline-metrics.jsonl` (gitignored) — one JSONL line per phase batch
(`ts`/`feature`/`phase`/`seconds`/`surfaces:{key: result}`), appended by `/cohorte-build`, `/cohorte-review`
and `/cohorte-fix`.
**`surfaces` keys are surface keys, nothing else** — run-level facts go in their own top-level
fields. Anything put inside `surfaces` is read
as a surface: the dashboard renders it as a row in the per-surface table and scores a non-`ok`
value as that surface failing. Always the main checkout, never the feature worktree (which dies at teardown while
metrics must accumulate across features) — resolve from anywhere with
`$(dirname "$(git rev-parse --git-common-dir)")/.claude/pipeline-metrics.jsonl`. Read it before
proposing a split: split the surface that actually dominates wall-clock, not the one that feels big.

## Measuring cost — what's slow vs what's expensive

`pipeline-metrics.jsonl` records **wall-clock seconds** per phase batch (§Specialization) — it tells you
what's SLOW. It deliberately does NOT record tokens: the lead can't reliably read a subagent's token count
to log it. For what's EXPENSIVE, use Claude Code's own accounting:

- **`/cost`** (built-in, zero setup) — reports per-**subagent** and per-**slash-command** share of your usage
  over the last 24 h / 7 d (e.g. _"Top subagents: frontend 7 %, backend 4 % · Top skills: /cohorte-build 1 %,
  /cohorte-review 1 %"_). That IS the per-phase ledger — approximate (share-of-total, machine-local, not exact
  tokens). Read it to see which surface/command actually dominates the bill before you tune a `model` tier.
- **OpenTelemetry** (exact numbers + dashboards) — add an `env` block to `~/.claude/settings.json`:
  `{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"1","OTEL_METRICS_EXPORTER":"otlp","OTEL_EXPORTER_OTLP_PROTOCOL":"http/protobuf","OTEL_EXPORTER_OTLP_ENDPOINT":"http://localhost:4318"}}`
  and point it at a collector. Metrics `claude_code.token.usage` + `claude_code.cost.usage` carry
  `session.id` + model + type (input/output/cacheRead). Subagent tokens roll into the session total;
  per-subagent attribution needs traces (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`, beta).

**Lead context discipline — the silent bill.** The lead session's conversation history is re-sent as
input on EVERY turn; a session that spans spec→build→review→fix without clearing re-pays the
accumulated spec walk-through, handoffs, and reports on each turn. The pipeline is built so this is
never necessary: every phase handoff (spec, contract, diff, staged reports) lives on disk, so `/clear`
at each phase boundary is always safe — each command's closing line recommends it. Corollaries the
commands enforce: never paste a diff into a dispatch (agents compute their own, scoped); never echo a
staged report or design brief into chat; redirect bulky command output to a file and grep it.

## Output discipline — quiet commands

A test runner's default output is written for a human watching a terminal: one line per test, banners,
timing tables. An agent pays input price for every one of those lines, on every turn they survive in its
context. The profile therefore stores **two forms of each noisy command**:

- `test_cmd` / `lint_cmd` — the full form, for a human running it by hand.
- `test_quiet_cmd` / `lint_quiet_cmd` (per surface) and `commands.test_quiet` / `commands.lint_quiet`
  (repo-wide) — the **bridled** form agents actually execute: dot/failures-only reporter
  (`--reporter=dot`, `--quiet`, `-q`, `--silent`, framework equivalent) so a green run costs lines,
  not pages, and a red run prints only the failures.

Rules for every consumer (implementers, preflight, `/cohorte-audit` gates, workflow agents):

1. Run the quiet variant when set.
2. Quiet variant empty/absent (older profile) ⇒ run `<full cmd> 2>&1 | tail -40` — never the bare
   command into your context.
3. Need the full log? Redirect it to a file and grep it; never print it.

`/cohorte-init-pipeline` **asks** for these variants (detected defaults offered first) instead of silently
storing a bare `pnpm test` as the thing agents execute; `/cohorte-update-pipeline` tops up older profiles.

## Spec status — the lifecycle state machine (and the loop's resume state)

A spec's front-matter `status` is not a label, it is the pipeline's **state**: every command routes on
it, the dashboard boards on it, the kanban backfill maps it to a column, and `/cohorte-loop --resume` reads it
back to continue an interrupted autonomous run. Six states, and exactly one writer each:

| status | meaning | written by | who may build it |
| --- | --- | --- | --- |
| `draft` | the interview is open, nothing is frozen | `/cohorte-spec` Mode A | no |
| `frozen` | the contract is frozen — the handoff to `/cohorte-build` | `/cohorte-spec` Mode A freeze | yes |
| `in-progress` | a `/cohorte-loop` is driving this spec right now (or died doing it) | `scripts/loop.sh`, before each phase | yes |
| `in-review` | reviewed / awaiting the next round or `/cohorte-ship` | `/cohorte-spec` Mode B, `/cohorte-fix`, `loop.sh` on a clean exit | yes |
| `blocked` | a loop gave up here (ceiling, non-convergent, no verdict, not implementable) | `loop.sh` on any non-zero exit | yes, with the reason named |
| `shipped` | the PR is open; the status flip is part of the release commit | `/cohorte-ship` | no |

**The resume contract.** Before every phase, `loop.sh` stamps `status: in-progress` plus `loop_pass`
(the review pass it is on) and `loop_phase` (`build`/`review`/`fix`) into the spec — deterministically,
with `awk`, spending **no tokens** on state it will need later. On exit it stamps a terminal status:
`in-review` + `loop_phase: done` when clean, `blocked` otherwise. `/cohorte-loop <id> --resume` then continues
at the recorded pass instead of pass 1, so a session killed at pass 3 of 5 does not re-pay passes 1–2.
The build is still skipped or redone by the build stamp alone (`specs/reports/<id>.built`, written only
after a build that finished), so an interrupted *build* correctly rebuilds.

Corollaries worth knowing:

- A spec with no front-matter makes every stamp a **silent no-op** — the state is bookkeeping, and the
  loop must never die over a status line.
- Child commands write `status` too (`/cohorte-fix` sets `in-review`); re-stamping before each phase is what
  keeps `in-progress` true for the duration of the run rather than for its first phase.
- `blocked` is not a failure to hide: it is the resumable state. `/cohorte-build` accepts it, names it, and
  routes by the spec's `## Remediation` (open items ⇒ `/cohorte-fix`).

## Dead agents — silence is not a green light

A subagent can die mid-run: a rate limit, a transport error that outlived its retries, its own context
exhausted on a big surface. When it does it returns **nothing** — and nothing is byte-identical to
"finished, nothing to report". Every phase that fans out therefore does a **roll call** before it
integrates anything, because the default reading of silence is the most dangerous one available:

| phase | what a dead agent looks like | what the phase must do |
| --- | --- | --- |
| `/cohorte-build` | a surface with no handoff | retry it **once** alone (byte-identical prompt), then mark it `dead`, verify the tree with that surface's own quiet commands, never call the batch ok |
| `/cohorte-review` | a reviewer with no report ⇒ **zero findings** | retry once, then list the surface in `unreviewed` and refuse to score `SHIP` |
| `/cohorte-fix` | a re-dispatched agent with no handoff | retry once, then leave **every** one of its items `- [ ]` — a dead agent never ticks a box |
| workflows | `agent()` resolves to `null` | already enforced (`review.js` `unreviewedSurfaces`) — the doctrine started here |

Non-negotiables, in every phase:

- **Retry once, alone, byte-identical.** Most deaths are transient, and the other surfaces' work is
  already on disk — so recovery costs one agent, never a rebuild. Never retry an agent that answered.
- **Never speak for a dead agent.** You did not see its work: report what the *tree* says (quiet
  commands, redirected to a file, grepped), not what a handoff would have said.
- **Never let it reach a driver as clean.** `/cohorte-build` writes `dead[]` into
  `specs/reports/<id>.build.json`, `/cohorte-review` writes `unreviewed[]` into the verdict; `scripts/loop.sh`
  aborts on either with **exit 2** *before* it reads `blocking`, since a dead reviewer makes
  `blocking == 0` a statement about code nobody read.
- **`unreviewed` is separate from `blocking` on purpose.** Faking a count in `blocking` to force a
  driver's hand would corrupt the one field the whole contract rests on; a driver reads them as two
  different facts — "what was found" and "what was covered".
- **Write the metrics line anyway** (`"<key>":"dead"`). An incomplete batch is exactly the batch worth
  recording; holding the append back "until it's complete" deletes the evidence that anything failed.

## Readiness — the gate between a frozen spec and N implementers

`/cohorte-build` §1.6 scores the frozen spec on **implementability** before authoring the contract and before
dispatching anything, and writes `specs/reports/<id>.readiness.json`
(`verdict`: `READY` · `RESERVATIONS` · `NOT-READY`, plus `gaps[]`). It costs **zero extra agents** — the
lead already holds the spec, the profile and the reconciled surface list — which is the whole economics
of the step: a spec that cannot be built does not get cheaper by being built on N surfaces in parallel.

- Five checks: contract completeness · surface coverage · dependencies exist · residual ambiguity ·
  the design gate. Each maps to `NOT-READY` (a surface would have to invent the answer) or
  `RESERVATIONS` (a surface can proceed on a stated assumption).
- **`NOT-READY` aborts the build with no agent spawned** and sends the human to `/cohorte-spec`.
  `scripts/loop.sh` reads the same file and exits **4** (`not implementable`) — the one loop outcome
  that more passes cannot fix.
- **`RESERVATIONS` never blocks.** Each gap is inlined verbatim into the dispatch of the surface it
  affects, as an assumption the implementer must apply *and* flag in its handoff. A gate that stalled a
  sound build on a missing error case would cost more human round-trips than it saves.

## Deferred findings — real, but not this feature's problem

`/cohorte-review` ends on "zero blocking findings", so everything non-blocking used to be discarded with the
report. A **deferred** finding is one the reviewer judges true and **out of this feature's scope**
(pre-existing code the staged diff never touched, adjacent debt the spec never claims to fix). The
review agent returns them in their own `## Deferred` section — never in `findings` — each carrying its
own out-of-scope reason.

- They count in **no** severity row, enter **no** verdict, and are **never** cross-checked: a deferred
  item cannot cost a fix loop an iteration, and refuting one would spend an agent arguing about
  something that cannot change the outcome.
- **Not deferrable, ever:** anything the diff touched or introduced, any spec violation, any security
  issue on a path this feature adds, calls or modifies.
- `/cohorte-review` §3.5 routes them, **on every verdict**, into `specs/refactor-backlog.md` under the
  `## <domain>` heading of the owning surface, tagged `deferred:<feature_id>` — the same grouping
  `/cohorte-audit` writes, so `/cohorte-refactor <domain>` picks them up with no extra plumbing. Never into the spec's
  `## Remediation`, which is what `/cohorte-fix` re-dispatches.
- `/cohorte-audit` **carries open `deferred:` items over** when it rewrites the backlog; overwriting them away
  is the one way they silently vanish.
- The verdict JSON carries `deferred: <n>` (informational, outside `blocking`), so `/cohorte-loop` can name
  them in its closing line without reading a report.

## Decisions — the transverse decision journal

`PIPELINE.md` is a **stack profile** (surfaces, commands, conventions); it says nothing about what this
project has *decided*. Without somewhere for those, every `/cohorte-spec` re-discovers or contradicts them.
`specs/_decisions.md` (from `core/templates/decisions.template.md`) is that place, deliberately small:

- **Append-only, one line per decision, ≤ ~160 chars:**
  `- <YYYY-MM-DD> · <area> · <decision> — because <reason> · <feature_id>`. Reversal never edits a line:
  append a superseding one (`· supersedes <date> <area>`) and move the old one to `## Superseded`. When
  `## Live` passes ~100 lines, sweep the superseded ones down.
- **Written by** `/cohorte-spec` at freeze (the decisions that outlive the feature — typically 0–3 lines, and
  zero is a normal outcome) and `/cohorte-build` §1.5 when it adds or splits a surface.
- **Read by the deciding stages only** — `/cohorte-brainstorm` (so the panel argues about the idea, not about
  settled ground), `/cohorte-spec` (so a new spec does not silently un-decide something), `/cohorte-audit` (standing
  decisions are part of the rulebook it audits against).
- **Never read by implementers or reviewers.** They work from the frozen contract, which already tells
  them what to do; shipping them the rationale would cost `surfaces × dispatches` tokens per feature
  for a fact they cannot act on. This is what keeps the journal cheap enough to be worth having.
- The `_` prefix is load-bearing: `/cohorte-doctor`, the dashboard spec scanner and the kanban backfill all skip
  `specs/_*.md`, so the journal is never mistaken for a spec (no phantom card, no bogus stage).

## Preflight — the deterministic phase gate

`/cohorte-review` starts by running `pipeline/scripts/preflight.sh` — a plain shell script (no
agent) that executes the profile's mechanical checks in order (typecheck → lint → tests, quiet
variants) with all output redirected to `specs/reports/<id>.preflight.txt`:

- **Any check red** ⇒ the script prints the last 40 lines raw and exits 1. The command **aborts
  there: zero agents are spawned.** A reviewer dispatched onto code that doesn't compile burns its
  whole run rediscovering what `tsc` already printed for free — the failure goes straight to the
  human (or `/cohorte-fix`) instead.
- **All green** ⇒ the script stamps `.claude/preflight.ok` (`<epoch> <HEAD sha> <tree digest>` —
  local and **gitignored**; a versioned stamp describes the tree *before* its own commit and rides
  into every clone and worktree, which breaks the gate both ways).

`hooks/gate.py` enforces the stamp as a **phase gate** (the `preflight` block of `gate-config.json`,
generated from `gate.preflight`): a Task dispatch of a listed `subagent_type` (default
`review`) with a missing/stale stamp — older than `max_age_minutes`, or the digest no longer
matches the working tree (`.claude` and `specs` excluded, so the pipeline's own writes and a
commit of already-verified code do not invalidate it) — gets an
"ask", so a lead can't accidentally skip the gate but a human can consciously override it. The gate
hook fires for **every** agent in the session, including subagents spawned by the Workflow runtime
(they run in `acceptEdits` whatever the session mode — Write/Edit auto-approved — but Bash and Task
still pass through hooks). In `bypassPermissions` (headless runs) every gate "ask" is escalated to a
hard deny, because nobody is there to answer a prompt.

## Rendering / reconciling a surface agent (shared procedure)

Both `/cohorte-init-pipeline` (initial render) and `/cohorte-build` (auto-reconcile when a spec needs a new agent) use
this exact procedure so a surface is always defined the same way. To add surface `S`:

1. **Add the `surfaces[]` entry** to `PIPELINE.md`: `key`, `path` (the disjoint tree it exclusively
   owns), `label`, `agent` (rendered file name), `tools` (add `DesignSync` only if `uses_design: true`;
   append the retrieval provider's MCP tools when `retrieval.provider` ≠ `none` — e.g. `mcp__serena`),
   `model` (tier for the rendered agent: `sonnet` (default) — the implementer mostly applies a frozen
   contract, which Sonnet does well at a fraction of the Opus-lead cost; `haiku` for purely mechanical
   scaffolding; `inherit` only when the surface makes real design decisions worth the lead's model),
   the five `*_cmd`s (derive from the surface's `package.json` / workspace
   filter, mirroring a sibling surface), and `uses_design`.
2. **Render the agent file** `.claude/agents/<agent>.md` from `pipeline/implementer.template.md`
   (resolve bundled `.claude/` vs global `~/.claude/`), substituting `<SURFACE_AGENT>`, `<SURFACE_LABEL>`,
   `<SURFACE_PATH>`, `<SURFACE_TOOLS>`, `<SURFACE_MODEL>`, `<PROJECT_NAME>`, and the surface-specific
   blocks (`<SURFACE_EXTRA_NEVER>`, `<SURFACE_DESIGN_INPUT>`, `<SURFACE_TDD_STEP1>` — leave the design
   ones empty unless `uses_design`). Fill `<SURFACE_CONVENTIONS>` with the surface's convention slice
   **baked at render time**: `PIPELINE.md` §Conventions `### Shared` + this surface's
   `### Surface: <key>` stanza + its §Testing lines, verbatim. At runtime the agent then reads only
   the profile's machine block (the fenced `yaml pipeline-profile`) — never the prose sections. The
   bake stays honest because §Conventions edits go through `/cohorte-update-pipeline`, whose reconcile
   re-renders every agent (step 2 below); hand-edit the prose without re-rendering and the baked
   slice goes stale — that's the trade for not re-reading the prose on every dispatch. For a `uses_design` surface, fill them **link-based** (never with a
   stored `design_project` id — that goes stale on a DS rebuild):
   - `<SURFACE_DESIGN_INPUT>` — a 4th input bullet: _"The **feature design** — the pages this feature
     touches, listed in your dispatch's design slot as full links
     (`https://claude.ai/design/p/<projectId>?file=<file>`); a slot saying `none` means a fix loop with
     no visual work — skip DesignSync entirely. For each link, extract the `<projectId>` (the
     `/p/…` segment) and `<file>` (the `?file=` query) from the URL and read it read-only via `DesignSync
     get_file(<projectId>, <file>)`; `list_files(<projectId>)` to catch linked pages (shared nav/modals)
     this feature also changes. The link is self-contained — no stored project id. Build with the code UI
     kit (the `design_system_project`'s materialization: `@/components/ui/*` + tokens); read a primitive
     via `get_file` only if it's missing/stale in code. Mobile-first."_
   - `<SURFACE_TDD_STEP1>` — a **lead-in paragraph** above the TDD list (not a numbered item; it
     renders as nothing for a non-design surface, which is why the list must not start at it):
     _"**Pull the feature design first** (skip if your dispatch's design slot
     says `none`): `DesignSync get_file(<projectId>, <file>)` for each link in the slot and translate
     each into the code design system (`@/components/ui/*`, `cn()` + CVA), mobile-first — never ad-hoc
     CSS. Then:"_
3. **Add a §Conventions + §Testing stanza** for `S` in `PIPELINE.md` (mirror a sibling surface; keep it
   rule-shaped). If `S` is a shared-code surface, its convention is "single owner of shared X; slices
   consume, never redefine."

Removing/merging a surface is the reverse: drop the `surfaces[]` entry, delete its agent file, fold its
conventions. Never leave an agent file with no matching `surfaces[]` entry (orphan) or vice-versa.

## Reconcile — bringing generated files up to the current core

`/cohorte-init-pipeline` is **one-time per project**. Afterwards, `/cohorte-update-pipeline` runs this procedure so a
core upgrade never requires re-running init — new pipeline features flow into the repo's generated
files automatically. It works because every generated artifact is a **deterministic function of
(current template × the profile's data)**; nothing needs re-detecting or re-interviewing.

1. **Profile top-up.** Diff `PIPELINE.md`'s machine block against the current
   `pipeline/PIPELINE.template.md`: every block/field the template has and the profile lacks is added
   with its documented default (e.g. `surfaces[].model: sonnet`, `retrieval.provider: serena`).
   **Ask only when a new field is a genuine human decision** (batch into ONE question set); never
   change a value the profile already sets; never rewrite the prose sections.
2. **Re-render agent frontmatter + body.** For each `surfaces[]` entry, re-render
   `.claude/agents/<agent>.md` from the current `implementer.template.md` per §Rendering above. Safe by
   doctrine: rendered agents are regenerable artifacts — hand-written rules belong in `PIPELINE.md`
   §Conventions (which reconcile never touches), NOT in agent files, where they'd be clobbered here.
3. **Additive settings patch.** Bring `.claude/settings.json` + `gate-config.json` up to the current
   init spec (missing `allow` entries, hooks per install mode) — add what's missing, never remove or
   rewrite existing/custom keys.
4. **Capability wiring.** If a top-up added a capability needing external setup (e.g. a `retrieval`
   provider whose MCP server isn't registered yet), run its wiring step from `/cohorte-init-pipeline` Phase 4.
   Even when nothing new was added, re-run the provider's health check (§Code retrieval) — wiring
   rots (PATH changes, uninstalls, hand-edits) — and repair whatever fails.
5. **Global config seed.** If `~/.claude/cohorte.config.yaml` is absent, seed it from the template
   (`profile/cohorte.config.template.yaml`) so the kanban + shared-vault config has a home. Never
   clobber an existing filled file; report what was seeded.
6. **Kanban sync.** Run the §Kanban reconcile: link/create the project's board if configured, verify
   its columns, and backfill/sync cards from `specs/*.md`. See §Kanban.
7. **Spec-template top-up.** `specs/_template.md` is seeded once at install and then **never**
   refreshed, so a repo keeps whatever front-matter the core shipped the day it was installed (a
   pre-1.6 copy has no `loop_pass`/`loop_phase`, and its `status` comment still lists four states).
   Top it up the same way as the profile: add the **front-matter fields** the current
   `templates/spec.template.md` has and the repo's copy lacks, with their documented defaults, and
   refresh the `status:` comment. Never rewrite its body — the section list is the human's to shape,
   and some repos have deliberately trimmed it. Nothing breaks without this (the fields are written on
   demand when a driver needs them); it just keeps a new spec's front-matter honest about the states
   the pipeline can put it in.

8. **Local-artifact hygiene.** The pipeline's own runtime files must stay out of git:
   `.claude/preflight.ok`, `.claude/pipeline-metrics.jsonl`, `specs/reports/`. Add any missing entry to
   `.gitignore`, and **untrack** what a pre-2.0.0 install let slip in —
   `git rm --cached --ignore-unmatch .claude/preflight.ok` (repeat per stray path). The stamp is the
   one that actively breaks: it records the tree it verified, the commit carrying it moves HEAD past
   that tree, and the committed copy lands in every clone and worktree — so the phase gate ends up
   blocking clean trees and greening unchecked ones. Report what was untracked; the human commits it.

Re-running `/cohorte-init-pipeline` remains possible (it reconciles too) but is only *needed* when the stack
itself changes in ways `/cohorte-build` §1.5 can't auto-grow (e.g. package manager or contract mechanism swap).

## Workflows — deterministic multi-agent runs (opt-in)

Three phases have a **workflow variant** — a deterministic orchestration script the Claude Code
Workflow runtime executes instead of the lead reasoning out the fan-out turn by turn:
`<core>/workflows/review.js`, `audit.js`, `refactor.js` (installed to `.claude/workflows/` bundled or
`~/.claude/workflows/` global). The conversational commands (`/cohorte-review`, `/cohorte-audit`, `/cohorte-refactor`)
**remain the default path and the fallback** — a workflow runs only when the human explicitly asks
for it ("run the review workflow"), and requires Claude Code ≥ **2.1.154** with workflows
enabled.
`/cohorte-doctor` reports which path a session will take. The interactive commands (`/cohorte-init-pipeline`,
`/cohorte-brainstorm`, `/cohorte-spec`) and the dispatch-only ones (`/cohorte-build`, `/cohorte-ship`) have **no** workflow variant on
purpose: they're interviews or already a single parallel dispatch — a script adds nothing.

Shared design, all four scripts:

- **Phase 0 is always `profile-reader`** — workflow scripts have no filesystem or shell access, so a
  dedicated agent (`core/agents/profile-reader.md`, haiku, read-only) reads `PIPELINE.md` and returns
  the `yaml pipeline-profile` block as JSON. Every later phase is parameterized from that object.
- **Mechanical phases run on haiku** (profile read, preflight, diff staging, report merging/writing);
  judgment phases dispatch the same pinned agents the commands use (`review` at sonnet, the surface
  implementers at their `surfaces[].model` tier) — the per-surface `model:` routing carries over.
- **Only the verdict comes back.** Bulk (diffs, reports, backlogs) is staged to the same disk
  buffers the commands use (`specs/reports/`, `specs/refactor-backlog.md`); the workflow's return is
  counts + verdict + paths.
- **A dead agent is never a clean result.** `agent()` resolves to `null` when a subagent dies, and a
  dead *reviewer* returns zero findings — byte-identical to a surface that is genuinely clean. Any
  script that derives a verdict from "how many findings came back" must first subtract the agents
  that never answered: `review.js` names them in `unreviewedSurfaces` and refuses to score
  `SHIP`. `scripts/test-workflows.mjs`
  pins this — it is the one invariant the structural checks in `validate-core.mjs` cannot see.
  The conversational commands enforce the same rule by roll call (§Dead agents); it was the workflows
  that had it first, and for three releases they had it **alone** — the same crash on the
  conversational path went unreported.
- **`review.js`** — preflight gate (aborts red, zero agents), one `git diff --stat` staged per
  touched surface, one reviewer per surface in parallel, then an **adversarial cross-check** phase
  that tries to refute each CRITICAL/security finding before it can trigger a fix loop.
- **`audit.js`** — one auditor per domain (each surface + `shared`), concurrency capped by the
  runtime (~16), merged into the prioritized `specs/refactor-backlog.md`.
- **`refactor.js`** — big domains only (it skips domains with a handful of open items — the
  conversational `/cohorte-refactor` is cheaper there): `shared` first and alone, then the other domains'
  implementers in parallel, each verified per-domain.
- **No input mid-run.** A workflow runs to completion without questions; anything interactive
  (contract changes, human decisions) belongs to the conversational path. The gate hook still
  fires on workflow subagents (see
  §Preflight) — in unattended runs its asks become denies.
- **Permissions:** `/cohorte-init-pipeline` and `/cohorte-update-pipeline` extend the generated `settings.json`
  `allow` list with what workflow agents need (the quiet commands, the shipped
  `pipeline/scripts/*.sh`, read-only git incl. `git rev-parse`, and the retrieval provider's MCP
  tools) so a run never stalls mid-workflow on a permission prompt nobody is watching.

## Kanban — mirroring the pipeline onto an Obsidian board

An **optional, user-scoped** mirror of the dev flow: each pipeline stage moves a card across an
[Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban) board, one board per project. Config
lives in the consolidated global config `~/.claude/cohorte.config.yaml` §`kanban` (NOT in
`PIPELINE.md` — the board path points at the user's personal vault, so it is machine-specific and must
not be committed). Everything below **no-ops silently** when the config is absent, `kanban.enabled` is
false, no board is configured for the current project, or the board file is missing — the pipeline never
blocks on the board.

**Config & board resolution.** `kanban.boards` is keyed by the project's `PIPELINE.md` `name`. To resolve
the current project's board: read `name` from `PIPELINE.md`, look up `kanban.boards[name]`. Found ⇒ the
board file is `<obsidian.vault_path>/<boards[name].board>`, its columns are `boards[name].columns` if
present else `kanban.columns`. Not found ⇒ kanban off for this project.

**Card format.** A card is a Kanban list item under a `## <column>` heading:
`- [ ] <human title>  #<feature_id>`. The `#<feature_id>` tag is the join key between a card and its
`specs/<feature_id>.md`; it is how every stage finds *its* card (Grep the board for `#<id>`). Free-text
notes a human writes as sub-bullets under an Ideas card are seed context for `/cohorte-brainstorm`. Never touch
the trailing `%% kanban:settings … %%` block or the `kanban-plugin: board` front-matter.

Once shipped, `/cohorte-ship` appends the **PR number** to the card — `- [ ] <title> #<feature_id> — PR #<num>`.
The bare `#<num>` is what the dashboard renders as a clickable link to the GitHub PR, so `/cohorte-ship` always
writes it when a PR was actually created.

**Move a card (the core op).** One call — the script does resolution AND the move outside the
agent's context (find, dedupe, sub-notes carried along, settings block preserved):

```
<core>/pipeline/scripts/kanban-move.sh auto <id> <stage> [--pr <num>] [--title <title>]
```

`<core>` is `~/.claude` (global install) or `.claude` (bundled) — probe with `test -x`. It creates
the card in the target column when none exists, keeps the first and drops duplicates, and appends
` — PR #<num>` with `--pr`.

**`auto` is not a convenience, it is the contract.** It reads `name` from `PIPELINE.md`, then
`kanban.enabled` / `obsidian.vault_path` / `boards[name]` from `~/.claude/cohorte.config.yaml`
(override with `COHORTE_CONFIG`, or skip the profile with `--project <name>`), and it maps the
**stage key** (`ideas` · `brainstorm` · `spec` · `ready` · `building` · `review` · `fix` · `ship` ·
`shipped`) to that board's heading through `boards[name].columns` → `kanban.columns` → the built-in
default. An explicit `<board.md>` path and a literal heading both still work, for one-off and
non-pipeline moves.

**Never conclude "no board is configured" without running it.** The command that resolves nothing
prints `kanban: <reason>` — naming the missing link (no config file, `enabled: false`, no entry for
this project, vault unset, board file gone) — and exits **0**. A configured board that cannot be
moved is loud instead: exit 2 on usage, exit 3 on a missing board file or an unknown column. Both
readings are on stdout, so a caller reports which one it got. This exists because inference was the
actual failure mode: with only "no-op silently if no board" to go on, a fresh phase session (every
phase runs after a `/clear`) decided there was no board without ever opening the config, and cards
stopped moving mid-pipeline while every command still reported success.

**Fallback when the script is absent** (older core): do it by hand, but never read the whole board
into context — it grows with every feature ever tracked: `grep -n` for `#<id>` and the `## ` headings
to locate lines, then use offset-limited Reads + targeted Edits around the matches. Either way: one
card per `#<id>`, whole line moved tag-preserved, card created in the target column if missing.

**Tag before you move.** The join key is the `#<id>` tag, and an **Ideas** card a human typed by hand
does not have one. Moving it first finds nothing, creates a second card, and strands the original in
Ideas — so `/cohorte-brainstorm` appends the tag to the picked line before its first move.

**Stage → column**, used both by each pipeline command (to move its card live) and by backfill:

| Pipeline moment                         | Column          |
| --------------------------------------- | --------------- |
| human drops a raw idea (manual)         | `ideas`         |
| `/cohorte-brainstorm` picks it up               | `brainstorm`    |
| `/cohorte-spec` opens (draft)                   | `spec`          |
| `/cohorte-spec` freezes (`status: frozen`)      | `ready`         |
| `/cohorte-build`                                | `building`      |
| `/cohorte-review`                               | `review`        |
| `/cohorte-fix`                                  | `fix`           |
| a `/cohorte-loop` is driving it (`in-progress`) | the current phase's column |
| a `/cohorte-loop` gave up (`blocked`)            | `fix`           |
| `/cohorte-ship` starts                          | `ship`          |
| PR opened (`status: shipped`)           | `shipped` (+ `PR #<num>` on the card) |

**Backfill / sync from specs (reconcile).** `specs/*.md` is the source of truth. For each spec, read its
`feature_id` (front-matter or filename) and `status`, map `status`→column — `frozen`→`ready`,
`in-progress`→the `loop_phase`'s column (`build`→`building`, `review`→`review`, `fix`→`fix`; unset ⇒
`building`), `in-review`→`review`, `blocked`→`fix`, `shipped`→`shipped`, anything else / a spec with no
status→`spec` — then **full
sync**: card absent ⇒ add it in that column; card present ⇒ **move it** to that column so the board
always reflects the specs (this repositions cards the human may have moved by hand). Report cards
added vs. moved vs. already-correct.

**Create a board.** When linking a project with no board file yet: write
`<obsidian.vault_path>/<folder>/Tasks.md` with the `kanban-plugin: board` front-matter, one `## <heading>`
per configured column in pipeline order, and the closing `%% kanban:settings %%` block
(`{"kanban-plugin":"board","list-collapse":[false,…]}` with one `false` per column).

## Telemetry — anonymous usage stats, strictly opt-in (GDPR-first)

Cohorte can send the maintainers anonymous usage pings so the pipeline improves where it's actually
slow. **Nothing is ever sent without explicit consent**: `/cohorte-init-pipeline` (and `/cohorte-update-pipeline` on
pre-telemetry installs) ask ONE question, once per machine, default **No**, and record the answer in
`~/.claude/cohorte.config.yaml` §`telemetry` (`enabled`, `install_id`, `consent_date`). The sender —
`pipeline/scripts/telemetry-send.sh` — is a silent no-op unless `enabled: true` AND `install_id` AND
`endpoint` are all set, times out at 2s, and never fails the pipeline. Callers chain it with
`|| true`, so a **missing** script is equally silent: `/cohorte-doctor` check 1 verifies `pipeline/scripts/`
is fully populated.

**Which commands ping** — the six that make up the feature funnel, and only those. The point is to
see where features stall, so every stage of `idea → PR` reports and nothing else does:

| phase | fired when | `seconds` | `results` |
| --- | --- | --- | --- |
| `brainstorm` | the return is staged | `0` | — |
| `spec` | a freeze lands (Mode A only) | `0` | `frozen` |
| `build` | after the batch metrics line | wall-clock | `ok,ok` / `error` |
| `review` | after the merged verdict | wall-clock | `<verdict>:<count>` |
| `fix` | after the batch metrics line | wall-clock | `<fixed>/<found>` |
| `ship` | the release agent succeeded | `0` | `pr` / `compare` |

> Workflow-variant runs (`review.js`) report `seconds: 0` for their phases — only the
> conversational commands measure wall-clock. `results` is a free-text summary field, so both
> forms are valid — but read the `fix` column knowing which path produced it.

`seconds: 0` marks a phase whose duration is human thinking time, not pipeline wall-clock — the
funnel signal there is the event, not how long it took. `/cohorte-doctor`, `/cohorte-audit`, `/cohorte-refactor`,
`/cohorte-align-ds`, `/cohorte-init-pipeline` and `/cohorte-update-pipeline` **never** ping: they sit outside the funnel, and
keeping them out is what holds the collected set to what the consent text describes.

**What one event contains** (strict allowlist, ~200 bytes):

```json
{"v":1,"install_id":"<random uuid>","ts":"<ISO>","core_version":"1.2.0","os":"Darwin",
 "event":"phase","phase":"build","feature_hash":"<sha256[..12] of the feature id>",
 "seconds":412,"results":"ok,ok"}
```

**What is NEVER sent:** repo/project names, file paths, code, spec content, prompts, emails,
usernames, IP handling client-side. The feature id is hashed (12 hex chars) so cross-feature counts
work without revealing what is being built.

**GDPR rights, concretely:**

- **Consent** — opt-in only, recorded with a date; "No" is also recorded so nothing re-asks.
- **Withdrawal** — set `telemetry.enabled: false` in `~/.claude/cohorte.config.yaml`; effective on
  the next phase, no restart.
- **Erasure** — `/cohorte-doctor` prints your `install_id`; send
  `curl -X DELETE <endpoint-origin>/v1/install/<install_id>` and the collector drops every event
  for that id (the deployed collector implements this and stores no IPs).
- **Access/portability** — events are keyed by your `install_id`; ask the operator for an export.

**Collector contract** (any implementation must honor it):
`POST /v1/events` (one JSON event, allowlisted fields) · `DELETE /v1/install/<id>` (erasure) ·
`GET /healthz`. Operators must not retain IP-bearing access logs for the ingest vhost.
