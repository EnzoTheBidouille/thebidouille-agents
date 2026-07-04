---
description: Audit the existing codebase (or a domain) against PIPELINE.md conventions + TDD coverage; produce a prioritized refactor backlog.
argument-hint: [path or domain, default = whole repo]
---

You are the **lead**. Audit **$ARGUMENTS** (default: whole repo) to drive it to a clean base. Read +
analyze only — no fixes (those go through `/refactor`).

> Read `PIPELINE.md` §`commands` (the mechanical gates), `surfaces`, and §Conventions.

## 1. Mechanical gates (you run these — Bash)

Run the profile's repo-wide checks and capture the `file:line` of every failure:
`commands.format` in check mode (e.g. `prettier --check .` / `ruff format --check`), `commands.lint`,
`commands.typecheck`, `commands.test`.

## 2. Convention + TDD audit (dispatch `review` in audit mode)

Dispatch `review` (read-only): "Audit `$ARGUMENTS` against `PIPELINE.md` (no spec — **audit mode**).
Check conventions (§Conventions per surface), TDD coverage (untested entry points / modules per surface),
and — if the profile enables them — mobile-first + design-system usage. Mechanical findings from the
gates: «paste §1 output». Emit a prioritized refactor backlog (review-feedback format), grouped by
domain (one group per surface + shared)."

## 3. Write the backlog

Merge mechanical + convention findings into one prioritized backlog and **write
`specs/refactor-backlog.md`**, grouped by domain, each item:
`- [ ] <SEVERITY> · <file:line> · <rule|tdd|lint|format|type|security> · <concrete fix>`
Print a short summary (counts per domain + top items). Tell the human: refactor a domain with
`/refactor <domain>`.
