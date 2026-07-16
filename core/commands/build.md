---
description: Author the contract from the frozen spec, then dispatch one implementer agent per surface in parallel.
argument-hint: <feature_id>
---

You are the **lead**. Build feature **$ARGUMENTS** from its frozen spec.

> Read `PIPELINE.md` §`pipeline-profile` first: the `surfaces` list (how many implementers to
> dispatch + their agent names), `contract` (mechanism + path), and the `design` flag.
>
> Template paths below (`.claude/templates/…`) resolve to `~/.claude/templates/…` when the core is
> installed globally — read whichever exists.

## 1. Load & check

- Read `specs/$ARGUMENTS.md`. If missing or `status` not `frozen`/`in-review`, stop — tell the human to
  run `/spec` first.
- **Design gate** — only if `design.enabled` and the feature has UI (some surface `uses_design`): if the
  spec front-matter `design_files` is empty, ask the human for the feature's design page link(s), extract
  the file name(s) into `design_files`, then continue. Skip if the feature is backend-only / no UI.
- If this is a fix loop (`## Remediation` has unchecked items), note them — they go to every agent.

## 2. Author the contract (lead-only — the single sync channel)

_Only if `contract.enabled`._ From §5 of the spec, write/update the feature's contract file at
`<contract.path>/$ARGUMENTS.<contract.ext>` in the profile's `mechanism` (e.g. Zod v4 schemas + inferred
types for `shared-types-zod`). Export it from `contract.index` if set. This is the ONLY file the agents
share; they import it read-only and must not edit it. If `contract.enabled` is false, the spec prose is
the sync channel — say so and skip.

## 3. Dispatch one implementer per surface — IN PARALLEL

Spawn every surface's agent in a **single message** (one Task call each) so they run concurrently. Give
EACH only what a stateless agent needs — re-supply everything every time. For each surface in `surfaces`:

> `subagent_type: <surface.agent>` — "Implement the **<surface.key>** surface for feature `$ARGUMENTS`.
> Read `PIPELINE.md` first. Spec: `specs/$ARGUMENTS.md`. Contract: `<contract.path>/$ARGUMENTS.<ext>`
> (import read-only). Work test-first. Touch only `<surface.path>`. [If a `uses_design` surface: design
> > files = the spec's `design_files` in `design_project`; build mobile-first.] [If fix loop: address the
> > `## Remediation` items; current diff: …]. Return the handoff per `.claude/templates/agent-handoff.md`."

## 4. Integrate

When all return, summarize their handoffs, flag any contract mismatch reported, and tell the human to
test (bring up infra if any, run migrations, `commands.dev`, smoke-test across surfaces), then `/review`.
Do not run the app or migrations yourself unless asked — the human holds the test gate.
