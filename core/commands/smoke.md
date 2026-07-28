---
description: Exercise the built feature end-to-end in its worktree — infra up, migrations, contract endpoints, key UI flows, visual check vs design — before /review.
argument-hint: <feature_id>
---

You are the **lead**. Smoke-test feature **$ARGUMENTS** — actually run it. `/review` audits the code
read-only; nobody has executed it yet. You verify it *works*, you never fix it here (failures go
through `/fix`). Observe honestly: report what happened, not what should have happened.

> Read `PIPELINE.md` §`pipeline-profile`: `commands` (migrate/dev), `isolation` (worktree, slot
> ports, db), `contract`, `design`, `surfaces`, and the spec `specs/$ARGUMENTS.md` (§5 contract,
> §9 acceptance).
>
> **Kanban** (SCHEMA.md §Kanban): move card `#$ARGUMENTS` → **Review**. No-op silently if no board.

## 1. Bring the feature up

- Work in the feature's checkout: with `isolation.enabled`, the sibling worktree
  (`../<slug>-$ARGUMENTS`, its slot's ports + db from `.worktrees/slots.tsv`); otherwise the main
  checkout on the feature branch.
- Infra as needed: the compose stack if one is declared (the gate will ask — that's expected),
  then `commands.migrate`, then `commands.dev` **in the background**. Wait for ready (poll the
  ports), don't assume.

## 2. Exercise the contract (the real server, not the tests)

- Hit a representative set of spec §5 endpoints with `curl`: every route domain, every auth level,
  at least one error case per class (validation `422`, unauthenticated `401`, wrong-role `403`,
  conflict `409`). Compare status + response envelope against the contract.
- If `rbac.enabled`: verify at least one denial per role boundary the spec declares.
- A mismatch is a FAIL entry with the exact command, expected, and actual — precise enough for a
  stateless `/fix` agent.

## 3. Exercise the UI (only if a touched surface has `uses_design`)

- Drive the spec §8 flows against the running app, **mobile viewport first** (375px), then desktop.
- If a browser/screenshot tool is available (a project driver, playwright, an agent browser), capture
  each §8 screen and compare against the feature's design pages: each `design_files` entry is a full
  `https://claude.ai/design/p/<projectId>?file=<file>` link — extract its `<projectId>` (the `/p/…`
  segment) + `<file>` (the `?file=` query) and fetch read-only via `DesignSync get_file(<projectId>,
  <file>)`. Compare layout, states (empty/loading/error/suppressed…), copy language. Note deviations.
- No browser tooling available ⇒ **say so and skip the visual diff** — never claim a visual check
  you didn't perform.

## 4. SMOKE REPORT

- One line per check: ✅/❌ · what was exercised · (on ❌) command → expected vs actual.
- **Stage the full report to `specs/reports/$ARGUMENTS.md`** (overwrite) — the same gitignored buffer
  `/review` uses (subfolder ⇒ skipped by the non-recursive `specs/*.md` glob), so a `/fix` after a
  `/clear` still has the failures.
- Verdict **PASS** (all green) → tell the human to run `/review $ARGUMENTS`.
  Verdict **FAIL** → the failures are findings: feed them to `/fix $ARGUMENTS`, re-run `/smoke`
  after. _Either way the handoff is on disk — `/clear` before the next command is safe._
- Append one metrics line to `.claude/pipeline-metrics.jsonl` (see `/build` §4, `phase: "smoke"`).
- Tear down what you started (kill the dev server); leave shared infra as you found it.
