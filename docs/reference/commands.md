# Commands

Every slash command the core installs, in pipeline order. **Model pins:** mechanical commands pin
`model: sonnet` in their frontmatter so orchestration turns never bill at the session model;
interactive commands (`/brainstorm`, `/spec`, `/init-pipeline`) deliberately inherit the session
model — their value is the conversation.

| Command | Model | Role |
| --- | --- | --- |
| `/init-pipeline` | inherit | Detect stack → interview → generate profile + agents. Once per project. |
| `/brainstorm` | inherit | Persona panel pressure-tests a feature idea. |
| `/spec` | inherit | Freeze the spec + contract; also applies review returns (Mode B). |
| `/build <id>` | sonnet | Author the contract, dispatch one implementer per surface, parallel. |
| `/review <id>` | sonnet | Preflight, staged diff, one reviewer per touched surface, merged verdict. |
| `/fix <id>` | sonnet | Apply a report; re-dispatch only the surfaces with findings. |
| `/loop <id>` | sonnet | Autonomous `/build → /review → /fix → /review …` in child sessions, until no blocking finding. |
| `/ship <id>` | sonnet | Freshness + DoD gates, human confirm, release agent, CI watch, teardown. |
| `/audit [target]` | sonnet | Mechanical gates + convention/TDD audit → prioritized backlog. |
| `/refactor <domain…>` | sonnet | Apply the backlog per domain via the surface implementers, TDD-first. |
| `/align-ds` | sonnet | Align the code UI kit to the design system (design → code). |
| `/update-pipeline` | sonnet | Refresh the core + reconcile this repo's generated files. |
| `/doctor` | sonnet | Diagnose the whole installation; exact fix per failure. |

---

## `/init-pipeline`

One-time per project, interactive, driven by step files (`templates/steps/init-pipeline/01…05`):
**detect** the stack read-only → **interview only the gaps** (surfaces + model tiers, quiet
command variants, contract mechanism, UI language, RBAC, design, retrieval provider, isolation,
gate patterns, personas; optional kanban link and the one-time telemetry consent) → **show the
draft** → **write & render** (`PIPELINE.md`, one agent per surface with baked conventions,
`gate-config.json` incl. the preflight block, `settings.json` permissions + hooks per install
mode, retrieval wiring with health check, isolation scripts, `specs/_template.md`, the committed
`.claude/pipeline.json` pointer, optional CI workflow, gitignore entries for
`pipeline-metrics.jsonl` + `specs/reports/`) → **report**. Everything it generates goes into
*this repo* — never into `~/.claude`.

## `/brainstorm [idea]`

Interactive panel from `PIPELINE.md` §Personas; one voice per RBAC role when enabled. Rounds of
2–4 personas surfacing tensions + a focused question, until scope/roles/data/screens/risks/
non-goals are clear. Finish stages the return to `specs/reports/<id>-brainstorm.md`, settles the
`feature_id`, moves the kanban card, pings telemetry (opt-in). Empty idea + a board ⇒ it offers
the **Ideas** column cards.

## `/spec [paste]`

**Mode A (new spec):** reads the staged brainstorm return (or asks), derives the id, enforces
the ≤ ~300-line size budget (proposes a feature split past it), walks the template section by
section — §5 CONTRACT to zero-further-questions precision — authors the design brief to
`specs/design/<id>.md` (UI features), freezes with `status: frozen` (postcondition-checked).
**Mode B (review return):** appends findings to `## Remediation`, updates §5 if the contract
must change, sets `status: in-review`, routes to `/build`.

## `/build <id>`

§1 loads the spec selectively (status grep first, then only front-matter/§5/tasks/Remediation);
routes to `/fix` when only open non-contract items remain; design gate for UI features.
§1.5 **auto-reconciles surfaces** (new tree ⇒ new agent; clean bottleneck ⇒ split proposal —
rendered immediately per the shared procedure). §2 authors the contract (postcondition:
file exists). §3 dispatches all implementers in one message, byte-stable prompts, variable slots
last. §4 integrates handoffs, appends the batch metrics line + telemetry ping, recommends
`/review`, and a `/clear`.

## `/review <id>`

§0 preflight. §1 one `git diff --stat`, paths grouped by surface (shared remainder attached to
the most relevant surface), full patch staged per touched surface. §2 one reviewer per touched
surface in parallel (small re-reviews: lead verifies hunks itself). §3 merges into one report —
verdict `SHIP`/`REVISE`/`BLOCK`, capped findings — stages it, appends metrics + telemetry; on
SHIP ticks the DoD and stamps `reviewed_base`/`reviewed_digest`; on REVISE/BLOCK routes to
`/fix`. LOW/MEDIUM leftovers can be parked to the refactor backlog (`deferred:<id>`).
§3 also writes **`specs/reports/<id>.verdict.json`** on every run — counts by severity, per-surface
breakdown, normalized `blocking_items` and a stable `fingerprint` over them. That file is the only
machine contract with `/loop`; no prose is ever parsed. A red preflight writes the degraded
`{"aborted":"preflight"}` form instead of nothing, so an abort reads as a diagnosis.

## `/fix <id> [paste]`

§1 ingests the report (paste / session / staged file), appends `- [ ]` items to
`## Remediation`, re-authors the contract itself if a finding demands it (full `/build` only
when the change ripples into clean surfaces). §2 maps open items to surfaces by path and
re-dispatches **only those**, items verbatim in the dispatch. §3 ticks `- [x]` per handoff,
collapses fully-fixed rounds to one line, metrics + telemetry, routes to `/review`.

## `/loop <id> [--max=N] [--no-build] [--rebuild]`

Runs the cycle for you: `/build` (skipped when the `specs/reports/<id>.built` stamp is there —
`--no-build` never builds, `--rebuild` always does), then `/review` ⇄ `/fix` until one of four
stops. **The loop does not run in your session** — each phase is a separate `claude -p` child with
its own context, driven by [`loop.sh`](/reference/scripts); all their output lands in
`specs/reports/<id>.loop.log`, which the command is **forbidden** to read back. You get one line
per phase and a three-line summary. Child flags come from `CLAUDE_FLAGS` (default
`--permission-mode acceptEdits`). `disable-model-invocation: true` — it only starts when you ask.

| exit | stop condition |
| --- | --- |
| `0` | clean — a review returned `blocking == 0` |
| `1` | ceiling — `--max` passes used, still blocking (the fix was progressing ⇒ raise `--max`) |
| `2` | no usable verdict — `/review` produced none, or aborted on a red preflight |
| `3` | non-convergent — the same blocking fingerprint twice; a higher `--max` will not help |
| `64` | usage — bad flag, missing spec, no `claude` on PATH |

`blocking` counts CRITICAL + security findings only, so a LOW nit never costs a pass. Every fix
pass is committed (`loop(<id>): fix pass <i>`) — the way back after N autonomous passes — and **no
fix runs on the last pass**: fixing without a review behind it leaves unaudited code.

## `/ship <id>`

Pre-flight: SHIP verdict confirmed; **freshness gate** (recompute the digest — mismatch ⇒
refuse, re-review); DoD verification (open boxes need explicit human override); human
confirmation. Then: spec → `status: shipped` *before* dispatch, `release` agent (conventional
commits, plain push, PR via `gh` or compare URL + drafted body), kanban → Shipped with the PR
number, telemetry ping (only on success), CI watch, and — after the confirmed merge — the
worktree teardown proposal.

## `/audit [target]`

§1 runs the mechanical gates (quiet variants) scoped to the target, redirected to
`specs/reports/audit-gates.txt`. §2 dispatches `review` in **audit mode** (no spec; conventions +
TDD coverage + design usage as the rulebook). §3 writes the prioritized
`specs/refactor-backlog.md` grouped by domain. Never pings telemetry (outside the funnel).

## `/refactor <domain…>`

Reads the backlog, maps domains to surfaces (`shared` = the contract package, refactored by the
lead directly). Dispatches implementers — tests pinned first, then refactor, public behavior
preserved — in parallel when domains are independent, `shared` always alone and first.
Verifies per domain (quiet gates + item-by-item `file:line` check — no `/audit` re-run per
round), ticks the backlog, loops until each dispatched domain is clean.

## `/align-ds`

Design → code alignment. No-ops with a clear message when `design.enabled` is false. See
[Design system](/guide/design-system).

## `/update-pipeline [path]`

§1 detects install scope + versions (never migrates bundled ↔ global on its own). §2 runs the
installer's `--update` (npm preferred, local checkout or piped installer as fallbacks). §3
reports old → new + syncs the `pipeline.json` pointer in both modes + prints the CHANGELOG
delta. §3.5 **reconciles** this repo's generated files: profile top-up (new fields at defaults,
one batched question set for genuine decisions — e.g. quiet variants), agent re-render (refreshes
baked conventions), additive settings/gate patch, capability wiring + health checks, global
config seed, kanban sync. §4 follow-ups: session restart, per-repo reconcile for other global
repos, commit.

## `/doctor`

Nine check groups, each failure with its exact fix: **1** core & pointer (+ shipped scripts
present & executable, VERSION not newer than siblings), **2** profile ↔ agents (orphans, tool
lists, **model pins** on agents and commands), **3** hooks & gate (config drift, single
registration), **4** retrieval health, **5** design paths, **6** isolation (rendered scripts,
slot table, stale slots / zombie worktrees), **7** telemetry consent hygiene, **8** workflows
(CLI ≥ 2.1.154, the four scripts, `profile-reader`, runtime in-session, preflight wiring — with
the one-line path summary), **9** specs & metrics hygiene.
