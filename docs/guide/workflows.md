# Workflows — deterministic multi-agent runs

**Claude Code only** — the other runtimes have no workflow engine, so these scripts are not
installed there and the conversational commands (the default everywhere) are the only path.

Since 1.3.0, the heavyweight phases also ship as **workflow scripts** for the Claude Code
Workflow runtime: the same fan-out the commands orchestrate, but driven by a deterministic
JavaScript script instead of the lead reasoning it out turn by turn. Loops, caps, "shared first",
bounded retries are *code* — free and exact — and the lead stops paying for orchestration turns.

## Prerequisites & opt-in

- **Claude Code ≥ 2.1.154** with workflows enabled. `/cohorte-doctor` check 8 reports the full wiring
  (CLI version, scripts present, `profile-reader` agent, runtime available in-session) and which
  path your session will take.
- **The conversational commands stay the default and the fallback.** A workflow runs only when
  you explicitly ask ("run the review workflow"). If the
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
  back in the result.
- **The gate still applies.** `hooks/gate.py` fires on workflow subagents too (they run in
  `acceptEdits`, which auto-approves Write/Edit but *not* Bash or Task). In unattended runs,
  gate confirms are escalated to hard denies — nobody is there to answer a prompt.
- **Permissions pre-widened.** `/cohorte-init-pipeline` / `/cohorte-update-pipeline` extend the generated
  `settings.json` allow-list with what workflow agents need (quiet commands, the shipped
  `pipeline/scripts/*.sh`, read-only git incl. `git rev-parse`, the retrieval MCP tools) so a
  run never stalls on a permission prompt nobody is watching.

## `review.js` — one review pass

Ask: *"run the review workflow for `<id>`"*. Preflight gate (aborts while red — **zero reviewers
spawned**) → diff staged once → one reviewer per touched surface in parallel → adversarial
cross-check of CRITICAL/security findings → merged report staged to `specs/reports/<id>.md`,
metrics + telemetry chained — and only the verdict, counts, and critical one-liners return. Deferred
findings (real, but out of the feature's scope) skip the cross-check — they cannot move the verdict —
and are appended to `specs/refactor-backlog.md` under their surface's domain heading, tagged
`deferred:<id>`, exactly as the conversational `/cohorte-review` §3.5 does.
`/cohorte-fix <id>` consumes the staged report exactly as after a conversational `/cohorte-review`.

## `audit.js` — codebase audit

Ask: *"run the audit workflow"* (optionally with a target path/domain). Mechanical gates staged
to `specs/reports/audit-gates.txt` by one haiku agent → **one auditor per domain** (every surface
plus `shared`) concurrently — the runtime caps parallelism (~16), extra domains queue → merged,
severity-ordered backlog written to `specs/refactor-backlog.md`, grouped by domain, each item
`- [ ] <SEVERITY> · <file:line> · <kind> · <fix>`. Returns per-domain counts + the top 10.

## `refactor.js` — big domains only

Ask: *"run the refactor workflow on `<domains>`"* (or `all`). Reads the open backlog items; a
domain with fewer than 5 open items is **skipped with a pointer to the conversational
`/cohorte-refactor`** — cheaper there. Then: the `shared` domain (contract package — every slice imports
it) first and **alone**, next the other domains' surface implementers in parallel (their trees
are disjoint by construction), each followed by a per-domain verification (gates + item-by-item
`file:line` check) and **one bounded retry** round. Cleared items are ticked off the backlog; the
leftovers return.

## Why not workflow-ize everything?

`/cohorte-init-pipeline`, `/cohorte-brainstorm`, and `/cohorte-spec` are interviews — their value *is* the back-and-forth,
and a workflow cannot ask. `/cohorte-build` is already a single parallel dispatch; `/cohorte-ship` is the human
gate. A script would add nothing to those; the four scripts cover exactly the phases where
deterministic fan-out, cross-checking, and looping pay.
