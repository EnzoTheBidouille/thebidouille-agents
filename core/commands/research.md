---
description: (Global capability) From a source PDF — a URL or a LOCAL FILE — produce a comprehension report + a conceptual questionnaire blueprint under a named run, and archive the report to Notion for review. Reads ~/.claude/questionnaire.config.yaml — works in any directory.
argument-hint: <pdf-url-or-path> [subject]
---

You are the **orchestrator** for the questionnaire capability's first half: turning a source PDF into a
readable report + a conceptual blueprint. This is a **global, user-scoped** command — it has no dependency
on any project's `PIPELINE.md` and behaves identically in every directory. You write the files and dispatch
the stateless researcher — the agent reads, you persist.

> **First action, always:** read **`~/.claude/questionnaire.config.yaml`** (the global capability config).
> If it's missing or `enabled` is not `true`, **stop**: tell the human to enable the capability by editing
> that file (`enabled: true`) — created by the installer; if absent, they should re-run it. Do nothing
> else. Otherwise note `runs_path` (default `~/.claude/questionnaire-runs`, expand `~` to `$HOME`),
> `notion_database_id`, `engine_format`, and `ui_language`.

Parse `$ARGUMENTS`: the first token is the **source PDF** — either a URL **or a local file path**; the
rest (optional) is the **subject**.

## 1. Name the run & create it

- Derive a **run-id** (kebab-case): from the subject if given, else from the source's last path segment
  (e.g. `.../big-five-inventory.pdf` → `big-five-inventory`). Confirm the run-id with the human if it's
  ambiguous. This is the handle they'll later type into `/questionnaire <run-id>`.
- Create the run directory `<runs_path>/<run-id>/`. If it already exists, ask before reusing it.

## 2. Stage the source (local files remove the internet-accessibility problem)

- **Local file** (the path exists on disk): copy it into the run dir as `<runs_path>/<run-id>/source.pdf`
  so the run is self-contained, and use THAT path as the source reference. This is the reliable path —
  no CAPTCHA, no paywall, no dead link.
- **URL**: keep it as-is. If the researcher later reports the URL unreachable (CAPTCHA/paywall), relay
  that to the human and suggest re-running with a downloaded local file.

## 3. Write `domain_brief.json` (you author it — the researcher's input)

Write `<runs_path>/<run-id>/domain_brief.json` per `~/.claude/templates/questionnaire-domain-brief.md`:
`subject` (the arg, or `null` to let the researcher deduce it), `goal`, `scope`, `audience`, `constraints`
(seed `ui_language` + a licence-caution note), and `reference_frameworks` starting with the source PDF
(`role: "source-pdf"`, its URL **or the staged local path**). Ask the human for `goal`/`audience`/`scope`
only if they're not obvious.

## 4. Dispatch `questionnaire-researcher` (read-only)

Spawn one agent (`subagent_type: questionnaire-researcher`): "Read `~/.claude/questionnaire.config.yaml`
first for `ui_language` + `engine_format`. Structure the domain for run `<run-id>`. domain_brief:
`<runs_path>/<run-id>/domain_brief.json`. Read the source PDF — **local path ⇒ use the Read tool (its
`pages` parameter, ~15 pages per call, as many calls as needed); URL ⇒ WebFetch**. Return EXACTLY the two
tagged blocks `===REPORT.MD===` and `===BLUEPRINT.JSON===` per your agent spec — a readable report and a
conceptual blueprint. Structure only: never draft items, never reproduce instrument text, no
interpretation, flag every licence." The agent has `WebFetch, WebSearch, Read` only.

## 5. Persist the researcher's output (you write the files)

Split the returned message on the two tags and write:

- `<runs_path>/<run-id>/report.md` — the `===REPORT.MD===` body.
- `<runs_path>/<run-id>/blueprint.json` — the `===BLUEPRINT.JSON===` body (validate it parses as JSON;
  if not, re-dispatch once asking the agent to fix the JSON).

## 6. Archive the report to Notion (MCP) — CONFIRM FIRST

Writing to Notion is outward-facing: **ask the human to confirm** before creating the page; if they
decline, skip (they can still archive at `/questionnaire` time).

On confirmation, create one page in the database `notion_database_id` (via the Notion MCP; if no Notion
tool is connected, say so, print `claude mcp add --transport http notion https://mcp.notion.com/mcp`, and
skip). Properties: **Sujet** — the blueprint `subject` · **Cadre** — `framework` · **Statut** —
`« Recherche »` · **Date** — today · **Run ID** — `<run-id>`. Body: the readable `report.md`, then
`domain_brief.json` and `blueprint.json` as fenced code blocks.

Then write `<runs_path>/<run-id>/notion.json`: `{ "page_id": "…", "url": "…" }` — `/questionnaire` will
**update this same page** (append the questionnaire + verdict, flip the Statut) instead of creating a new one.

## 7. Report

Print: run-id, subject, framework + licence summary, dimension count, the Notion page link (or the skip
reason), and the local paths. Tell the human to review `report.md` (locally or in Notion), then run
**`/questionnaire <run-id>`** to generate + validate the questionnaire and complete the Notion page.
