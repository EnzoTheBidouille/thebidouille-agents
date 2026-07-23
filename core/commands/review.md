---
description: Dispatch the read-only review agent to audit the feature against its frozen spec.
argument-hint: <feature_id>
---

You are the **lead**. Dispatch the review for feature **$ARGUMENTS**.

> Read `PIPELINE.md` §`vcs.default_branch` (diff base) and the `surfaces`/`contract` fields.
>
> Template paths below (`.claude/templates/…`) resolve to `~/.claude/templates/…` when the core is
> installed globally — read whichever exists.
>
> **Kanban** (SCHEMA.md §Kanban): move card `#$ARGUMENTS` → **Review**. No-op silently if no board.

## 1. Gather the inputs for stateless reviewers

- Confirm `specs/$ARGUMENTS.md` exists.
- Compute the diff: `git diff <default_branch>...HEAD --stat`. **Group the changed files by
  `surfaces[].path`.** The contract file and any changed file outside every surface path form a
  small `shared` remainder — attach it to the most relevant surface's reviewer and say so in its
  dispatch.

## 2. Dispatch review agents — one per touched surface, IN PARALLEL

Spawn ONE `review` agent per surface that has changed files, in a **single message** (one Task call
each, like `/build`) so they run concurrently — NEVER serially: review wall-clock must be the
slowest surface, not the sum. A diff touching a single surface ⇒ a single reviewer. For each:

> `subagent_type: review` — "Review feature `$ARGUMENTS` — **scope: the `<surface.key>` surface
> only**. Read `PIPELINE.md` first (its flags + §Conventions/§Testing for `<surface.key>`). Spec:
> `specs/$ARGUMENTS.md` (source of truth). Contract: `<contract.path>/$ARGUMENTS.<ext>`. Changed
> files in your scope (diff vs `<default_branch>`): <list, with the `--stat` counts>. Review the
> diff hunks + immediate context — not whole files. Check spec conformance first, then correctness,
> security, conventions, RBAC/mobile-first _if the profile enables them_, and TDD coverage. Emit
> the REVIEW REPORT per `.claude/templates/review-feedback.md` — every finding self-sufficient
> (`file:line` · severity · type · concrete fix)."

Note the epoch (`date +%s`) just before dispatching — §3's metrics lines need the wall-clock.

## 3. Merge & relay the verdict

Merge the returned reports into **one** REVIEW REPORT (same template): findings concatenated and
re-ordered by severity, counts summed, duplicates collapsed, verdict = the worst returned
(`BLOCK` > `REVISE` > `SHIP`). Append one line per reviewer to `.claude/pipeline-metrics.jsonl`
(gitignored): `{"ts":"<ISO>","feature":"$ARGUMENTS","phase":"review","surface":"<key>","seconds":<wall-clock>,"result":"<verdict>:<finding count>"}`.
Print the report. Then:

- **SHIP** → a SHIP verdict *is* the pipeline's statement that the feature meets its Definition of
  Done, so **tick the DoD**: in `specs/$ARGUMENTS.md` §`Acceptance criteria / DoD`, flip each `- [ ]`
  → `- [x]` for the criteria the pipeline has actually verified — spec conformance + `ui_language`
  copy (this review), tests · lint · typecheck (a green `/build`), mobile-first + runtime flows (a
  prior `/smoke`). **Leave `- [ ]` (and say which) any item whose verifying stage didn't run this
  cycle** — e.g. no `/smoke` ⇒ the mobile-first / runtime item stays open. Ticking is the lead's job
  (the reviewer is read-only). Then tell the human they can `/ship`.
- **REVISE / BLOCK**, or any finding of any severity → tell the human to run **`/fix $ARGUMENTS`** —
  it appends the report to the spec's `## Remediation` and re-dispatches ONLY the surfaces with
  findings. The full path (`/spec` Mode B then `/build`) remains for findings that change the
  contract in ways that ripple into clean surfaces.
