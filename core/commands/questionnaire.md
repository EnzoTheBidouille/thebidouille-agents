---
description: (Global capability) From an existing research run, generate an ORIGINAL Likert questionnaire in the engine format, validate it, and archive the run to Notion for review. Reads ~/.claude/questionnaire.config.yaml — works in any directory.
argument-hint: <run-id>
---

You are the **orchestrator** for the questionnaire capability's second half: turning a research run's
blueprint into a validated, engine-format questionnaire, then archiving it to Notion for human review. This
is a **global, user-scoped** command with no dependency on any project's `PIPELINE.md`. You write the files
and call Notion; the stateless agents only reason. **Nothing here reaches production** — the human reviews in
Notion and flips the status to approved before anything enters the survey engine.

> **First action, always:** read **`~/.claude/questionnaire.config.yaml`** (the global capability config).
> If it's missing or `enabled` is not `true`, **stop**: tell the human to enable the capability by editing
> that file. Otherwise note `runs_path` (default `~/.claude/questionnaire-runs`, expand `~` to `$HOME`),
> `notion_database_id`, `engine_format`, and `ui_language`.

## 1. Load the run

- Resolve `<runs_path>/$ARGUMENTS/`. If it or `blueprint.json` is missing, **stop**: tell the human to run
  `/research <pdf-url> [subject]` first.
- Read `blueprint.json` (and `report.md` for the Notion body). Confirm `notion_database_id` is set; if empty,
  tell the human to fill it in `~/.claude/questionnaire.config.yaml` before archiving (you may still generate
  + validate locally).

## 2. Dispatch `questionnaire-writer` (stateless, no tools)

The writer has no tools by design (so it cannot see the source). **Inline** the full `blueprint.json` plus
`ui_language` + `engine_format` into its dispatch prompt:

> `subagent_type: questionnaire-writer` — "Write an ORIGINAL Likert-5 questionnaire in the `<engine_format>`
> format from this blueprint. ui_language: `<ui_language>`. Blueprint: <inline the full blueprint JSON>.
> Original items only; respect `target_items` and `polarity` (negative → reverse); keep blueprint dimension
> `id`s; closed scoring vocabulary only; no interpretation. Return one JSON object only."

Write the returned JSON to `<runs_path>/$ARGUMENTS/questionnaire.json` (verify it parses).

## 3. Validate — dispatch `questionnaire-validator`, loop max 3

The validator has no tools. **Inline** `questionnaire.json` + `blueprint.json` + `ui_language`/`engine_format`:

> `subagent_type: questionnaire-validator` — "Validate this questionnaire against its blueprint and the
> `<engine_format>` rules. Constate, do not correct. Questionnaire: <inline>. Blueprint: <inline>. Return the
> verdict JSON `{ status, errors[], questionnaire }`."

Write the verdict to `<runs_path>/$ARGUMENTS/verdict.json`. If `status: "fail"`, re-dispatch the **writer**
with the `errors[]` inlined, overwrite `questionnaire.json`, then re-validate — **up to 3 rounds total**. If
still `fail` after 3 rounds, keep the last `questionnaire.json` + `verdict.json`, set the archive status to
**« Bloqué »**, and flag it to the human.

## 4. Archive to Notion (MCP) — CONFIRM FIRST

Writing to Notion is outward-facing (like the gate's spirit). **Ask the human to confirm** before writing;
if they decline, stop after reporting the local paths.

On confirmation (via the Notion MCP; if no Notion tool is connected, say so and print the connection
command `claude mcp add --transport http notion https://mcp.notion.com/mcp`, then stop):

- **If `<runs_path>/$ARGUMENTS/notion.json` exists** (page created by `/research`): **update that page** —
  flip **Statut** to `« À relire »` (pass) or `« Bloqué »` (fail after 3), and append the questionnaire
  stage to the body: `questionnaire.json` + `verdict.json` as fenced code blocks. Do not create a duplicate.
- **Otherwise**: create one page in the database `notion_database_id` with properties **Sujet** — the
  blueprint `subject` · **Cadre** — `framework` · **Statut** — `« À relire »` (pass) or `« Bloqué »`
  (fail after 3) · **Date** — today · **Run ID** — `$ARGUMENTS`; body: the readable `report.md`, then the
  three artifacts as fenced code blocks: `blueprint.json`, `questionnaire.json`, `verdict.json`. Then
  write `<runs_path>/$ARGUMENTS/notion.json` (`{ "page_id", "url" }`).

## 5. Report

Print: run-id, subject, validation status (pass / blocked after N rounds), the Notion page link (or the skip
reason), and the local run path. Remind the human: nothing enters `<engine_format>` until they review in
Notion and move the status to **Approuvé**.
