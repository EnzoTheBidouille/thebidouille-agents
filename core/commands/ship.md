---
description: At a SHIP verdict, dispatch the release agent to commit, push, and open the PR (with your confirmation).
argument-hint: <feature_id>
---

You are the **lead**. Ship feature **$ARGUMENTS**. This is the outward-facing gate.

> Read `PIPELINE.md` §`vcs` (host, remote, default_branch, feature_branch_prefix).

## 1. Pre-flight (confirm before doing anything irreversible)

- Confirm the latest `/review` returned **SHIP** (no CRITICAL, no security). If not reviewed, or the
  verdict was REVISE/BLOCK, stop and say so.
- Show `git status` + `git diff --stat`; confirm the branch is `<feature_branch_prefix>$ARGUMENTS`.
- **Ask the human to confirm** they want to commit, push, and open the PR. Wait for yes.

## 2. Mark the spec shipped (BEFORE dispatch, so it ships in the same commit)

Once the human confirms, edit `specs/$ARGUMENTS.md` front-matter `status: → shipped` — **before**
dispatching the release agent, so the status flip is part of the tree it commits (otherwise it lands
uncommitted after the PR opens). Only flip after the human's "yes"; if they decline, leave it.

## 3. Dispatch the `release` agent

Spawn one agent (`subagent_type: release`): "Release feature `$ARGUMENTS` on branch
`<feature_branch_prefix>$ARGUMENTS`. Read `PIPELINE.md` §vcs first. Spec: `specs/$ARGUMENTS.md` (already
`status: shipped` — stage it). Write conventional commit(s), push (no force), open the PR (use `gh` if
`host: github` + available; else emit the compare URL + drafted PR body from `.claude/templates/pr-body.md`).
Stage **all** the feature's changes including `specs/$ARGUMENTS.md`. Never edit source, never force-push,
never run migrations."

## 4. Relay

Print the release agent's report: commit SHA(s), pushed branch, PR URL (or compare URL + drafted body).
Confirm `specs/$ARGUMENTS.md` was committed as `status: shipped` (part of the release commit).

## 5. After the PR — CI gate + teardown

- If `host: github` and `gh` is available, watch the PR's checks (`gh pr checks <url> --watch`) and
  report the result — the human merges only on green. A red check ⇒ back to `/fix $ARGUMENTS`.
- Once the human confirms the PR is **merged**: if `isolation.enabled`, propose the teardown —
  `scripts/remove-feature.sh $ARGUMENTS` (add `--drop-db` to also drop the feature db; kept by
  default). It removes the worktree, deletes the merged branch, frees the slot. Never run it before
  the merge is confirmed, and only with the human's go-ahead (the gate will ask anyway).
