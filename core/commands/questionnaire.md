---
description: (Global capability) OPTIONAL second step after /research — derive a conceptual blueprint from a research run's Notion page, write an ORIGINAL Likert questionnaire in the engine format, validate it, and complete the same Notion page. Nothing is stored locally.
argument-hint: <run-id-or-notion-url>
---

You are the **orchestrator** of the questionnaire derivation: turning an existing **research run** (a
Notion page produced by `/research`) into a validated, engine-format questionnaire — only because the
human asked for one; research runs are valuable without this step. **Nothing is written to local
disk** — you read the research from Notion, hold intermediate artifacts in conversation memory, and
write results back to the same Notion page. **Nothing here reaches production** — the human reviews in
Notion and flips the Statut to « Approuvé » before anything enters the survey engine.

> **First action, always:** read **`~/.claude/questionnaire.config.yaml`**. If missing or `enabled` is
> not `true`, **stop** and say how to enable. Otherwise note `notion_database_id`,
> `notion_parent_page_id`, `engine_format`, `ui_language`. If `notion_database_id` is empty, run the
> same Notion auto-setup as `/research` §0 — though with no database there is no research to derive
> from: tell the human to run `/research` first.

## 1. Load the research from Notion

Resolve `$ARGUMENTS`: a Notion URL ⇒ fetch it directly; a run-id ⇒ find the page in
`notion_database_id` whose **Run ID** property matches (query the data source, or fetch the database
and scan). If no page is found, **stop**: tell the human to run `/research <pdf> [subject]` first.
Read the page: the research report (body) and its properties. If the page already contains a
questionnaire section, ask before superseding it.

## 2. Derive the blueprint — dispatch `questionnaire-researcher` in BLUEPRINT mode

The blueprint is derived **from the research report** (our own original text — not from the source
PDF). Spawn one agent (`subagent_type: questionnaire-researcher`): "MODE: blueprint. Read
`~/.claude/questionnaire.config.yaml` first for `ui_language` + `engine_format`. Derive a conceptual
questionnaire blueprint from this research report (inline): <the full report markdown>. Return EXACTLY
one tagged block `===BLUEPRINT.JSON===` per the schema in your agent spec — dimensions/subdimensions
with concept + item_guidance (concepts, NEVER ready-made items), polarity, target_items, and a
scoring_intent restricted to the closed vocabulary mean·sum·reverse·weight·weighted_sum·ratio. No
thresholds, no interpretation; carry the licence caveats over into license_note."

Validate the JSON parses (re-dispatch once if not). Keep it in memory.

## 3. Write the items — dispatch `questionnaire-writer` (stateless, no tools)

The writer has no tools by design (it cannot see the source OR the research — licence-free by
construction). **Inline** the blueprint + `ui_language` + `engine_format` into its dispatch prompt:

> `subagent_type: questionnaire-writer` — "Write an ORIGINAL Likert-5 questionnaire in the
> `<engine_format>` format from this blueprint. ui_language: `<ui_language>`. Blueprint: <inline>.
> Original items only; respect `target_items` and `polarity` (negative → reverse); keep blueprint
> dimension `id`s; closed scoring vocabulary only; no interpretation. Return one JSON object only."

Verify it parses. Keep it in memory.

## 4. Validate — dispatch `questionnaire-validator`, loop max 3

The validator has no tools. **Inline** questionnaire + blueprint + `ui_language`/`engine_format`:

> `subagent_type: questionnaire-validator` — "Validate this questionnaire against its blueprint and the
> `<engine_format>` rules. Constate, do not correct. Questionnaire: <inline>. Blueprint: <inline>.
> Return the verdict JSON `{ status, errors[], questionnaire }`."

If `status: "fail"`, re-dispatch the **writer** with the `errors[]` inlined and re-validate — **up to 3
rounds total**. Still `fail` after 3 ⇒ keep the last versions, the Statut will be **« Bloqué »**, and
flag it to the human.

## 5. Complete the Notion page — CONFIRM FIRST

**Ask the human to confirm** the Notion write. On yes, **update the research page** (never create a
duplicate): append a `# Questionnaire` section with `blueprint.json`, `questionnaire.json`, and
`verdict.json` as fenced code blocks, and flip **Statut** → `« À relire »` (pass) or `« Bloqué »`
(fail after 3). If the human declines, print the questionnaire JSON in the conversation and stop — no
local fallback.

## 6. Report

Print: run-id, subject, item/dimension counts, validation status (pass / blocked after N rounds), and
the Notion page link. Remind the human: nothing enters `<engine_format>` until they review the page and
move the Statut to **« Approuvé »**.
