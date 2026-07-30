# Workflows — deterministic multi-agent runs

Since 1.3.0, the heavyweight phases also ship as **workflow scripts** for the Claude Code
Workflow runtime: the same fan-out the commands orchestrate, but driven by a deterministic
JavaScript script instead of the lead reasoning it out turn by turn. Loops, caps, "shared first",
bounded retries are *code* — free and exact — and the lead stops paying for orchestration turns.

## Prerequisites & opt-in

- **Claude Code ≥ 2.1.154** with workflows enabled. `/doctor` check 8 reports the full wiring
  (CLI version, scripts present, `profile-reader` agent, runtime available in-session) and which
  path your session will take.
- **The conversational commands stay the default and the fallback.** A workflow runs only when
  you explicitly ask ("run the review workflow") or use the `/cycle` launcher command. If the
  runtime is unavailable, nothing breaks — the commands are the same pipeline.

## Shared design

Every script follows the same skeleton:

- **Phase 0 is `profile-reader`.** Workflow scripts have no filesystem or shell access, so a tiny
  read-only haiku agent reads `PIPELINE.md` and returns the machine block as JSON. Every later
  phase is parameterized from that object.
- **Model routing.** Mechanical phases (profile read, preflight, diff staging, verification,
  report writing) run on **haiku**; judgment phases dispatch the same pinned agents the commands
  use — `review` at sonnet, the surface implementers at their `surfaces[].model` tier.
- **Only the verdict comes back.** Bulk (diffs, reports, backlogs) is staged to the same disk
  buffers the commands use (`specs/reports/`, `specs/refactor-backlog.md`, the spec's
  `## Remediation`) — so switching between workflow and conversational mid-feature always works.
- **No input mid-run.** A workflow runs to completion without questions. Decisions move to the
  edges: readiness gates refuse doomed launches up front, and everything genuinely human comes
  back in the result (the `questions` array for `/cycle`).
- **The gate still applies.** `hooks/gate.py` fires on workflow subagents too (they run in
  `acceptEdits`, which auto-approves Write/Edit but *not* Bash or Task). In unattended runs,
  gate confirms are escalated to hard denies — nobody is there to answer a prompt.
- **Permissions pre-widened.** `/init-pipeline` / `/update-pipeline` extend the generated
  `settings.json` allow-list with what workflow agents need (quiet commands, the shipped
  `pipeline/scripts/*.sh`, read-only git incl. `git rev-parse`, the retrieval MCP tools) so a
  run never stalls on a permission prompt nobody is watching.

## `cycle.js` — the full dev cycle {#cycle-js-the-full-dev-cycle}

**Launcher: `/cycle <feature_id> [max_rounds]`** — resolves the script, checks the runtime,
sanity-checks the spec, launches in the background (watch with `/workflows`), then relays the
result when it lands.

```
Profile → Ready → Contract → Build ─┬─▶ Preflight ─▶ Smoke ∥ Review(+cross-check) ─▶ SHIP+PASS? ──▶ Close
                                    └──────────────── Fix (surfaces with findings) ◀── no ─┘
```

- **Readiness gate** (before spending anything): the spec must be `frozen`. Other gaps — empty
  `design_files` on a UI feature, §5 placeholders, tasks missing for an implied surface — ride
  along as deferred questions rather than blocking.
- **Contract** authored by a lead-equivalent agent from spec §5, then **build**: one implementer
  per surface, parallel, TDD-first.
- **Rounds** (default max 5, and the token budget if one is set — both are runaway protection,
  not targets; the real exit is *zero findings + PASS*):
  1. **Preflight** — typecheck + lint + tests via `preflight.sh`. Red short-circuits straight to
     a mechanical fix round on the surfaces whose paths appear in the failure tail.
  2. **Stage** — one `git diff --stat`, per-surface patches staged for the reviewers.
  3. **Smoke ∥ Review** — both *observe*, neither edits, so they run **concurrently**: the smoke
     agent exercises the running app while one reviewer per touched surface audits the staged
     diff. Every CRITICAL/security finding then faces an **adversarial cross-check** — a second
     reviewer prompted to *refute* it; a refuted finding never triggers a fix round.
  4. **Exit check** — review `SHIP` + smoke `PASS` ⇒ done.
  5. **Fix** — findings grouped by owning surface (smoke failures mapped by their file hint);
     only those surfaces re-dispatch, each with its items verbatim.
- **Contract changes stay inside the loop.** A finding whose file lives under `contract.path`
  routes to a lead-equivalent agent that updates spec §5 + re-authors the contract file (exactly
  what conversational `/fix` does — implementers still never touch it), then the consuming
  surfaces re-dispatch. The re-authorings are reported as `contractChanges` for you to eyeball in
  the diff.
- **Close** — reports staged; on success the DoD boxes the cycle verified are ticked and the
  **freshness gate is stamped**, so `/ship <id>` right after is a straight shot (ship keeps its
  human confirmation — it's the outward-facing, irreversible step and deliberately stays outside
  the workflow). On a stop, the open findings are appended to the spec's `## Remediation` — a
  rerun of `/cycle`, or a conversational `/fix`, picks up exactly there.

The result object:

```jsonc
{
  "outcome": "SHIP-READY" | "STOPPED" | "NOT-READY" | "ABORTED",
  "rounds": 2,
  "verdict": "SHIP", "smoke": "PASS",
  "contractChanges": [],          // re-authorings the loop performed — review them in the diff
  "openFindings": [],
  "questions": [],                // your inbox from the run — empty when the spec pre-answered everything
  "report": "specs/reports/<id>.md",
  "next": "/ship <id> — …"
}
```

::: tip The spec is the answer sheet
`questions` is the exact measure of how sharp your `/brainstorm` + `/spec` were. Recurring
questions mean a vague spec — fix it upstream, and the cycle runs spec-freeze → SHIP-READY
untouched.
:::

## `review.js` — one review pass

Ask: *"run the review workflow for `<id>`"*. Preflight gate (aborts while red — **zero reviewers
spawned**) → diff staged once → one reviewer per touched surface in parallel → adversarial
cross-check of CRITICAL/security findings → merged report staged to `specs/reports/<id>.md`,
metrics + telemetry chained — and only the verdict, counts, and critical one-liners return.
`/fix <id>` consumes the staged report exactly as after a conversational `/review`.

## `audit.js` — codebase audit

Ask: *"run the audit workflow"* (optionally with a target path/domain). Mechanical gates staged
to `specs/reports/audit-gates.txt` by one haiku agent → **one auditor per domain** (every surface
plus `shared`) concurrently — the runtime caps parallelism (~16), extra domains queue → merged,
severity-ordered backlog written to `specs/refactor-backlog.md`, grouped by domain, each item
`- [ ] <SEVERITY> · <file:line> · <kind> · <fix>`. Returns per-domain counts + the top 10.

## `refactor.js` — big domains only

Ask: *"run the refactor workflow on `<domains>`"* (or `all`). Reads the open backlog items; a
domain with fewer than 5 open items is **skipped with a pointer to the conversational
`/refactor`** — cheaper there. Then: the `shared` domain (contract package — every slice imports
it) first and **alone**, next the other domains' surface implementers in parallel (their trees
are disjoint by construction), each followed by a per-domain verification (gates + item-by-item
`file:line` check) and **one bounded retry** round. Cleared items are ticked off the backlog; the
leftovers return.

## Why not workflow-ize everything?

`/init-pipeline`, `/brainstorm`, and `/spec` are interviews — their value *is* the back-and-forth,
and a workflow cannot ask. `/build` is already a single parallel dispatch; `/ship` is the human
gate. A script would add nothing to those; the four scripts cover exactly the phases where
deterministic fan-out, cross-checking, and looping pay.
