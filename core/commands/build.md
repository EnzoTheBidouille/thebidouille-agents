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
>
> **Kanban** (SCHEMA.md §Kanban): once §1 confirms the frozen spec, move card `#$ARGUMENTS` →
> **Building**. No-op silently if no board is configured.

## 1. Load & check

- Read `specs/$ARGUMENTS.md`. If missing or `status` not `frozen`/`in-review`, stop — tell the human to
  run `/spec` first.
- **Design gate** — only if `design.enabled` and the feature has UI (some surface `uses_design`): if the
  spec front-matter `design_files` is empty, ask the human for the feature's design page link(s) and
  store them in `design_files`, then continue. Then **resolve the feature's design project**: a full
  link carries its own project — extract the project id from the URL (it wins over the profile);
  a bare file name falls back to `design.design_project`. If neither yields a project, ask the human.
  Skip if the feature is backend-only / no UI.
- If this is a fix loop (`## Remediation` has unchecked items), note them — they go to every agent.

## 1.5 Reconcile surfaces — auto-grow / specialize agents

Map every area the spec touches (§5 contract + each surface's tasks + touched paths) onto the
`surfaces[]` in `PIPELINE.md`. Two triggers add an agent — handle them BEFORE authoring the contract:

- **Unowned area → new agent.** If the spec introduces work in a tree that falls under NO existing
  `surfaces[].path` (a genuinely new thing — a new service, a new app, a new top-level area), that work
  has no owner. Auto-detect it and propose a new surface for it.
- **Bottleneck area → specialize.** If one existing surface carries a large, cleanly-separable chunk of
  this feature (e.g. a whole new feature-module) that would dominate build time, propose splitting that
  chunk into its own specialized surface. Use the heuristic in SCHEMA.md §Specialization — only when the
  boundary is clean; skip when tangled or tiny.

For each surface to add: infer its `key`, `path`, `label`, `agent`, `tools`, `model`, `*_cmd`s, and
`uses_design` (mirror a sibling surface), show the human a one-line proposal, and on go-ahead **render it now** per
SCHEMA.md §"Rendering / reconciling a surface agent" — write the `surfaces[]` entry + §Conventions/§Testing
stanza into `PIPELINE.md`, render `.claude/agents/<agent>.md` from the implementer template, applying the
shared-code rule (shared trees get a single-owner surface; cross-slice shapes go through the contract).
This is the automatic path: you don't send the human back to `/init-pipeline`. If nothing new is needed,
say so and continue. Dispatch (§3) then covers the reconciled surface list.

## 2. Author the contract (lead-only — the single sync channel)

_Only if `contract.enabled`._ From §5 of the spec, write/update the feature's contract file at
`<contract.path>/$ARGUMENTS.<contract.ext>` in the profile's `mechanism` (e.g. Zod v4 schemas + inferred
types for `shared-types-zod`). Export it from `contract.index` if set. This is the ONLY file the agents
share; they import it read-only and must not edit it. If `contract.enabled` is false, the spec prose is
the sync channel — say so and skip. **Postcondition (if `contract.enabled`):**
`test -f <contract.path>/$ARGUMENTS.<contract.ext>` — the contract file must exist before you dispatch
§3, or the stateless agents have nothing to build against.

## 3. Dispatch one implementer per surface — IN PARALLEL

Spawn every surface's agent in a **single message** (one Task call each) so they run concurrently —
NEVER serially: build wall-clock must be the slowest surface, not the sum. Use
the reconciled `surfaces` list from §1.5 (existing + any just-rendered). Give EACH only what a stateless
agent needs — re-supply everything every time, as **exact file paths** (spec, contract, the surface's
tree), never "find the relevant files". Keep the dispatch prompt **structurally identical across
dispatches and fix loops** (same template below, only the variable parts change) so repeated dispatches
hit the prompt cache. Note the epoch (`date +%s`) just before dispatching — §4's metrics line needs
the batch wall-clock. For each surface in `surfaces`:

> `subagent_type: <surface.agent>` — "Implement the **<surface.key>** surface for feature `$ARGUMENTS`.
> Read `PIPELINE.md` first. Spec: `specs/$ARGUMENTS.md`. Contract: `<contract.path>/$ARGUMENTS.<ext>`
> (import read-only). Work test-first. Touch only `<surface.path>`. [If a `uses_design` surface: design
> > files = the spec's `design_files` in project `<resolved design project id>` (from §1's design gate);
> > build mobile-first.] [If fix loop: address the
> > `## Remediation` items; current diff: …]. Return the handoff per `.claude/templates/agent-handoff.md`."

## 4. Integrate

When all return, summarize their handoffs and flag any contract mismatch reported. Append **one line
per dispatched agent** to `.claude/pipeline-metrics.jsonl` (create it if absent; it must be
gitignored):
`{"ts":"<ISO date>","feature":"$ARGUMENTS","phase":"build","surface":"<key>","seconds":<batch wall-clock>,"result":"ok|error"}`
— this is the evidence SCHEMA.md §Specialization asks for before splitting a surface.
Then tell the human: run `/smoke $ARGUMENTS` to exercise the feature end-to-end (or test by hand),
then `/review $ARGUMENTS`. Do not run the app or migrations yourself here — `/smoke` is the
sanctioned path for that. _The spec, contract and diff are all on disk — `/clear` before `/smoke`
is safe._
