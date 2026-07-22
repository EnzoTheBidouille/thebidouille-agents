---
description: Apply a REVIEW REPORT (or SMOKE failures) — append it to the spec's Remediation, then re-dispatch ONLY the surfaces that have findings.
argument-hint: <feature_id> [paste REVIEW REPORT]
---

You are the **lead**. Run the fix loop for feature **$ARGUMENTS** — the scoped, cheap path after a
`REVISE`/`BLOCK` verdict. The full `/spec` (Mode B) + `/build` path still exists for review returns
that change the *contract*; `/fix` is for everything else.

> Read `PIPELINE.md` §`pipeline-profile` first: `surfaces` (paths + agent names) and `contract`.
>
> Template paths below (`.claude/templates/…`) resolve to `~/.claude/templates/…` when the core is
> installed globally — read whichever exists.
>
> **Kanban** (SCHEMA.md §Kanban): move card `#$ARGUMENTS` → **Fix** on ingest (it returns to **Review**
> when `/review` re-runs). No-op silently if no board.

## 1. Ingest the report

- The report is either pasted after the feature id, or the REVIEW REPORT / SMOKE failures from this
  session's last `/review` / `/smoke`. If you have neither, ask for it and wait.
- Append each finding to `specs/<id>.md` **`## Remediation`** (same format as `/spec` Mode B, under a
  dated/numbered subheading): `- [ ] <severity> · <file:line> · <type> · <concrete fix>`. Set
  `status: in-review`.
- **Contract check:** if any finding implies the frozen contract must change, update spec §5 and
  re-author the contract file yourself now (lead-only, per `/build` §2) — agents never edit it. If
  the contract change ripples into surfaces *without* findings, fall back to full `/build` instead
  and say so.

## 2. Scope the re-dispatch — only surfaces with findings

- Map every unchecked Remediation item to a surface by matching its `file:line` path against
  `surfaces[].path`. Items outside every surface path (contract file, root config) are yours or go
  to the most relevant surface — say which.
- Re-dispatch **ONLY the surfaces owning ≥1 item**, in parallel, in a **single message** — the exact
  fix-loop dispatch template from `/build` §3 (spec, contract read-only, "address the `## Remediation`
  items", current diff). Surfaces without findings are NOT re-dispatched — that is the point.

## 3. Integrate

When the agents return, summarize the handoffs, append one metrics line per dispatched agent to
`.claude/pipeline-metrics.jsonl` (see `/build` §4), then tell the human: re-run `/smoke` if the
failures were runtime ones, and `/review $ARGUMENTS` for the re-verdict.
