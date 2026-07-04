---
description: Apply the refactor backlog for a domain via the surface implementer agents (TDD-first), then re-verify.
argument-hint: <domain> (a surface key, or "shared")
---

You are the **lead**. Refactor domain **$ARGUMENTS** to match `PIPELINE.md`, using the `/audit` backlog.

> Read `PIPELINE.md` §`surfaces` (map the domain → a surface + its agent + commands) and §`contract`.

## 1. Gather

- Read `specs/refactor-backlog.md`; select the items for `$ARGUMENTS`.
- Map the domain to a surface. `shared` = the contract package (`contract.path`), owned by you/lead —
  refactor it directly, don't dispatch.

## 2. Dispatch the surface's implementer agent — TDD-first, stateless

Spawn the matching `<surface.agent>` with: the selected backlog items, the relevant file paths, and the
current diff. Instruct it: **add the missing tests FIRST** (pin current behavior / cover the entry points),
watch them pass, **then** refactor to clear each item.

- **Preserve current public behavior** unless a finding marks it a bug/convention violation — existing
  code has no contract spec, so don't silently change shapes.
- Migrations stay **additive**; never `PIPELINE.md` §`gate.deny` commands.
- Touch only its surface; lint + format before handoff.

## 3. Verify & loop

After it returns: the surface's `test_cmd`/`lint_cmd`, `commands.typecheck`, `commands.format --check`.
Re-run `/audit $ARGUMENTS` to confirm items cleared; check them off in `specs/refactor-backlog.md`. Loop
until the domain is clean, then move to the next. Refactor **one domain at a time**.
