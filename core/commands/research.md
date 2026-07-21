---
description: (Global capability) From a source PDF, produce a comprehension report + a conceptual questionnaire blueprint under a named run. Reads ~/.claude/questionnaire.config.yaml — works in any directory.
argument-hint: <pdf-url> [subject]
---

You are the **orchestrator** for the questionnaire capability's first half: turning a source PDF into a
readable report + a conceptual blueprint. This is a **global, user-scoped** command — it has no dependency
on any project's `PIPELINE.md` and behaves identically in every directory. You write the files and dispatch
the stateless researcher — the agent reads, you persist.

> **First action, always:** read **`~/.claude/questionnaire.config.yaml`** (the global capability config).
> If it's missing or `enabled` is not `true`, **stop**: tell the human to enable the capability by editing
> that file (`enabled: true`) — created by `sh install.sh`; if absent, they should re-run the installer. Do
> nothing else. Otherwise note `runs_path` (default `~/.claude/questionnaire-runs`, expand `~` to `$HOME`),
> `engine_format`, and `ui_language`.

Parse `$ARGUMENTS`: the first token is the **PDF URL**; the rest (optional) is the **subject**.

## 1. Name the run & create it

- Derive a **run-id** (kebab-case): from the subject if given, else from the PDF URL's last path segment
  (e.g. `.../big-five-inventory.pdf` → `big-five-inventory`). Confirm the run-id with the human if it's
  ambiguous. This is the handle they'll later type into `/questionnaire <run-id>`.
- Create the run directory `<runs_path>/<run-id>/`. If it already exists, ask before reusing it.

## 2. Write `domain_brief.json` (you author it — the researcher's input)

Write `<runs_path>/<run-id>/domain_brief.json` per `~/.claude/templates/questionnaire-domain-brief.md`:
`subject` (the arg, or `null` to let the researcher deduce it), `goal`, `scope`, `audience`, `constraints`
(seed `ui_language` + a licence-caution note), and `reference_frameworks` starting with the source PDF
(`role: "source-pdf"`, its URL). Ask the human for `goal`/`audience`/`scope` only if they're not obvious.

## 3. Dispatch `questionnaire-researcher` (read-only)

Spawn one agent (`subagent_type: questionnaire-researcher`): "Read `~/.claude/questionnaire.config.yaml`
first for `ui_language` + `engine_format`. Structure the domain for run `<run-id>`. domain_brief:
`<runs_path>/<run-id>/domain_brief.json`. Fetch and read the source PDF. Return EXACTLY the two tagged
blocks `===REPORT.MD===` and `===BLUEPRINT.JSON===` per your agent spec — a readable report and a
conceptual blueprint. Structure only: never draft items, never reproduce instrument text, no interpretation,
flag every licence." The agent has `WebFetch, WebSearch, Read` only.

## 4. Persist the researcher's output (you write the files)

Split the returned message on the two tags and write:

- `<runs_path>/<run-id>/report.md` — the `===REPORT.MD===` body.
- `<runs_path>/<run-id>/blueprint.json` — the `===BLUEPRINT.JSON===` body (validate it parses as JSON;
  if not, re-dispatch once asking the agent to fix the JSON).

## 5. Report

Print: run-id, subject, framework + licence summary, dimension count, and the local paths. Tell the human to
review `report.md`, then run **`/questionnaire <run-id>`** to generate + validate the questionnaire and
archive it to Notion. (This command does not touch Notion — the archive happens in `/questionnaire`.)
