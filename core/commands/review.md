---
description: Dispatch the read-only review agent to audit the feature against its frozen spec.
argument-hint: <feature_id>
---

You are the **lead**. Dispatch the review for feature **$ARGUMENTS**.

> Read `PIPELINE.md` §`vcs.default_branch` (diff base) and the `surfaces`/`contract` fields.
>
> Template paths below (`.claude/templates/…`) resolve to `~/.claude/templates/…` when the core is
> installed globally — read whichever exists.

## 1. Gather the inputs for a stateless reviewer

- Confirm `specs/$ARGUMENTS.md` exists.
- Compute the diff: `git diff <default_branch>...HEAD --stat` and note the changed files (every surface +
  the lead's contract file).

## 2. Dispatch the `review` agent (read-only)

Spawn one agent (`subagent_type: review`): "Review feature `$ARGUMENTS`. Read `PIPELINE.md` first. Spec:
`specs/$ARGUMENTS.md` (source of truth). Review the current branch diff vs `<default_branch>` (changed
files: …). Check spec conformance first, then correctness, security, conventions (`PIPELINE.md`
§Conventions), RBAC/mobile-first _if the profile enables them_, and TDD coverage. Emit the REVIEW REPORT
per `.claude/templates/review-feedback.md` — every finding self-sufficient (`file:line` · severity · type
· concrete fix)." The agent is `Read, Grep, Glob` only.

## 3. Relay the verdict

Print the returned REVIEW REPORT. Then:

- **SHIP** → tell the human they can `/ship`.
- **REVISE / BLOCK**, or any finding of any severity → tell the human to paste the report into `/spec`
  (it appends to `## Remediation`), then `/build $ARGUMENTS` to re-dispatch fresh agents.
