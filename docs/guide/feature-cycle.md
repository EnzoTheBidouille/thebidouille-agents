# The feature cycle

This page walks one feature through the whole pipeline, conversationally — what each command
does, what lands on disk, and where the human decisions sit. (The autonomous alternative for the
middle of this loop is run command by command.)

```
/brainstorm → /spec → /build → /review → (/fix → /review)* → /ship
     ↑ human      ↑ human                          ↑ human
```

Between every two commands: **`/clear`**. Every handoff is on disk; clearing sheds the lead's
accumulated history, which is re-sent at input price on every turn it survives.

## 1. `/brainstorm` — pressure-test the idea

An interactive roundtable in the main thread. The panel comes from `PIPELINE.md` §Personas (PM,
skeptical senior engineer, UX designer, security… one voice per RBAC role when `rbac.enabled`),
each with a job *and* a personality. They disagree with each other and with you — the point is to
surface tensions, scope cuts, risks, and what's explicitly **out**, a few focused questions per
round.

When you're satisfied, it stages the **brainstorm return** to
`specs/reports/<feature_id>-brainstorm.md` and settles the `feature_id` (kebab-case slug — the
join key used by every later stage and the kanban card). With a board configured, the card moves
to **Brainstorm**.

If you start `/brainstorm` with no idea, it lists the cards in your kanban **Ideas** column (with
their notes as seed context) and lets you pick one.

## 2. `/spec` — freeze the source of truth

Interactive, section by section over `specs/_template.md`. The critical section is **§5 CONTRACT**:
every endpoint/interface — method, path, auth/role, request fields with types and validation,
success envelope, every error case — plus the exact schema type names that will live in the
contract file. The bar: frontend and backend could each build from it with **zero further
questions**.

Discipline built in:

- **Size budget** — target ≤ ~300 lines. Every implementer re-reads the spec on every first
  build, so each extra line is paid `surfaces × dispatches` times. A spec that genuinely needs
  more is two features — `/spec` proposes the split.
- **Design brief** (UI features only) — authored to `specs/design/<id>.md`; spec §8 keeps only a
  summary + pointer so non-design surfaces never pay for it. You paste the resulting design page
  links (full `https://claude.ai/design/p/<projectId>?file=<file>` URLs) into the spec's
  `design_files` — each link carries its own project + page, so a design-system rebuild never
  invalidates the profile.
- **New-surface heads-up** — if the feature introduces a tree no surface owns, the spec notes it;
  `/build` auto-reconciles (renders the new agent) later.

On your validation it **freezes**: `status: frozen` in the front-matter. Kanban → **Ready to
build**.

`/spec` has a second mode: paste (or let it read) a REVIEW REPORT and it applies the findings to
the spec's `## Remediation` instead — the re-entry path for review returns that change the
contract.

::: tip The spec is the autonomy dial
Everything the cycle can't ask you mid-run, it reads from the spec. Edge cases, error envelopes,
role matrices, design links pinned down here = fix rounds and deferred questions you never see
later.
:::

## 3. `/build` — contract first, then parallel implementers

1. **Checks** the spec is frozen; routes you to `/fix` instead if only open remediation items
   remain (cheaper). For UI features, the **design gate** collects the `design_files` links if
   missing.
2. **Reconciles surfaces** — if the spec touches an unowned tree, or one surface carries a
   cleanly-separable bottleneck, `/build` proposes a new/split surface, renders its agent on
   your go-ahead, and continues. You never go back to `/init-pipeline` for this.
3. **Authors the contract** — the lead writes `<contract.path>/<id>.<ext>` from spec §5 (e.g.
   Zod v4 schemas + inferred types), exports it from the barrel. This is the *only* file surfaces
   share; implementers import it read-only.
4. **Dispatches one implementer per surface, in a single message** — parallel, never serial:
   build wall-clock is the slowest surface, not the sum. Each dispatch is byte-stable (variable
   slots at the end, for the prompt cache) and self-sufficient: spec path, contract path, its
   tree, its design links or `none`, its remediation items or `none`.

Each implementer works **strict TDD** — failing tests from the contract first, then green, then
refactor to conventions, lint + format before handoff — inside its own tree only, running its
quiet commands. Its return is a tight **handoff** (summary, migrations, test results, contract
mismatches, TODOs — no file lists, no code excerpts).

The lead integrates: flags contract mismatches and failing tests, appends one metrics line to
`.claude/pipeline-metrics.jsonl` (the evidence used later to decide surface splits). Kanban →
**Building**.

## 4. `/review` — audit the diff against the spec

Nothing in the pipeline *runs* the app: the preflight gate (**typecheck + lint + tests via
`preflight.sh`; red aborts with the raw failure, zero agents spawned**) is the mechanical proof,
and anything that needs the app up is yours to exercise by hand before or after this step. Then:

1. The lead computes the diff **once**: one `git diff --stat`, grouped by surface path, then a
   full patch staged per touched surface to `specs/reports/<id>.<surface>.diff`. Reviewers are
   read-only (no Bash) — the staged artifact is how they review hunks instead of whole files.
2. **One `review` agent per touched surface, in parallel.** Checks, in order: spec conformance,
   correctness, security, conventions, RBAC + mobile-first (if enabled), TDD coverage, plus
   language-specific traps (floating promises, mutable default args, `.unwrap()` outside tests,
   un-`ctx`'d goroutines, `UPDATE` without `WHERE`, …).
3. The lead merges reports: severity-ordered findings (deduped), summed counts, worst verdict —
   **`SHIP`** (no CRITICAL, no security) / **`REVISE`** (≥ 1 CRITICAL) / **`BLOCK`** (any
   security vulnerability). Full report staged to `specs/reports/<id>.md`; chat gets only the
   verdict, the severity table, and one-liners for the criticals.

On **SHIP**, the lead ticks the verified DoD boxes in the spec and **stamps the freshness gate**:
`reviewed_base` (merge-base SHA) + `reviewed_digest` (hash of exactly the reviewed source) in the
front-matter. Leftover LOW/MEDIUM nits can be parked to `specs/refactor-backlog.md` tagged
`deferred:<id>` instead of forcing a fix cycle.

Small re-reviews (≤ 2 files, ~40 lines, no contract/security) take a fast path: the lead verifies
the hunks itself against the open remediation items instead of dispatching.

## 5. `/fix` — the scoped loop

Reads the staged report (pasted, from this session, or from `specs/reports/<id>.md` after a
`/clear`), appends findings to the spec's `## Remediation` as `- [ ]` items, then re-dispatches
**only the surfaces owning open items** — each agent gets its items verbatim, reads only the
files they name. If a finding implies the **contract** must change, the lead re-authors it itself
(and falls back to a full `/build` only when the change ripples into clean surfaces).

When agents return, the lead ticks `- [x]` what each handoff reports fixed, collapses fully-fixed
rounds to one summary line (the spec stays bounded), and sends you back to `/review` for the
re-verdict. Kanban → **Fix**, then back to **Review**.

## 6. `/ship` — the human gate

- Confirms the last verdict was **SHIP**; recomputes the freshness digest — **if the source
  changed since the review verdict, it refuses** and sends you back to `/review`.
- Verifies the DoD checkboxes; open items require your explicit "ship anyway".
- Asks you to confirm. Then: spec `status: shipped` (before dispatch, so it ships in the same
  commit), and the `release` agent writes conventional commits, pushes (never force), opens the
  PR (`gh` when available, otherwise compare URL + drafted body from the template). It never
  edits source and refuses staged secrets.
- Watches CI (`gh pr checks --watch`); red ⇒ back to `/fix`. After the merge, proposes the
  worktree teardown (`scripts/remove-feature.sh <id>`). Kanban → **Shipped**, with the PR number
  written on the card.

## The disk artifacts, at a glance

| Path | Written by | Read by |
| --- | --- | --- |
| `specs/<id>.md` | `/spec` (+ `/fix` remediation, `/review` DoD + freshness stamp) | everyone |
| `specs/design/<id>.md` | `/spec` | design surfaces, design tools |
| `<contract.path>/<id>.<ext>` | the lead (`/build`, `/fix`) | implementers (read-only), reviewers |
| `specs/reports/<id>.md` | `/review` (gitignored buffer) | `/fix` after a `/clear` |
| `specs/reports/<id>.<surface>.diff` | `/review` §1 | the per-surface reviewers |
| `specs/reports/<id>.preflight.txt` | `preflight.sh` | you, on abort |
| `.claude/pipeline-metrics.jsonl` | `/build` `/review` `/fix` (gitignored) | surface-split decisions, dashboard |
| `specs/refactor-backlog.md` | `/audit` (+ deferred review nits) | `/refactor` |
