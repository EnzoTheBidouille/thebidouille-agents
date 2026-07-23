---
description: (Global capability) OPTIONAL second step after /research — derive a conceptual blueprint from a research run's archived page (Notion or Obsidian), write an ORIGINAL Likert questionnaire in the engine format, validate it, and complete the same page. Nothing is stored outside the store.
argument-hint: <run-id-or-page-url>
---

You are the **orchestrator** of the questionnaire derivation: turning an existing **research run** (the
page produced by `/research` in the configured store) into a validated, engine-format questionnaire —
only because the human asked for one; research runs are valuable without this step. You read the
research from the store, hold intermediate artifacts in conversation memory, and write the result back
to the store — notion: the **same page**; obsidian: a **separate questionnaire note wikilinked to the
research note** (research and questionnaires live in distinct folders). **Nothing here reaches
production** — the human reviews the result and flips the Statut to « Approuvé » before anything
enters the survey engine.

> **First action, always:** read the consolidated global config
> **`~/.claude/thebidouille.config.yaml`**; if absent, fall back to the legacy flat
> **`~/.claude/questionnaire.config.yaml`**. If neither exists, or `questionnaire.enabled` (legacy:
> `enabled`) is not `true`, **stop** and say how to enable (via `/update-pipeline`). Otherwise read
> these values (nested in the consolidated file, flat in the legacy one), referred to below by the
> short names on the left: `store` = `research.store` (missing/empty ⇒ `notion`) · `notion_database_id`
> = `research.notion_database_id` · `obsidian_vault_path` = `obsidian.vault_path` ·
> `obsidian_research_folder` = `research.folder` · `obsidian_questionnaire_folder` =
> `questionnaire.folder` · `engine_format` = `questionnaire.engine_format` · `ui_language` =
> `ui_language`. If the store was never set up (empty `notion_database_id` / empty
> `obsidian_vault_path`), there is no research to derive from: tell the human to run `/research` first.

## 1. Load the research from the store

Resolve `$ARGUMENTS`:

- a **Notion URL** ⇒ fetch that page directly via the Notion MCP (works regardless of `store` — old
  Notion runs stay readable after a switch to obsidian);
- a **run-id** ⇒ notion: find the page in `notion_database_id` whose **Run ID** property matches
  (query the data source, or fetch the database and scan); obsidian: the note in
  `<vault>/<obsidian_research_folder>/` whose frontmatter `run_id` matches (Grep, then Read).

If nothing is found, **stop**: tell the human to run `/research <pdf> [subject]` first. Read the page:
the research report (body) and its properties/frontmatter. If a questionnaire already exists for the
run (notion: a `# Questionnaire` section on the page; obsidian: a note
`<obsidian_questionnaire_folder>/<run-id>.md`), ask before superseding it.

## 2. Derive the blueprint — dispatch `questionnaire-architect`

The blueprint is derived **from the research report** (our own original text — not from the source
PDF). Spawn one agent (`subagent_type: questionnaire-architect`): "Read
`~/.claude/thebidouille.config.yaml` (or legacy `questionnaire.config.yaml`) first for `ui_language` + `engine_format`. Derive a conceptual
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

## 5. Write the questionnaire to the store — CONFIRM FIRST

**Ask the human to confirm** the write. On yes:

- **notion** — **update the research page** (never create a duplicate): append a `# Questionnaire`
  section with `blueprint.json`, `questionnaire.json`, and `verdict.json` as fenced code blocks, and
  flip the **Statut** property → `« À relire »` (pass) or `« Bloqué »` (fail after 3).
- **obsidian** — write a **separate note** `<vault>/<obsidian_questionnaire_folder>/<run-id>.md`
  (superseding it only after the §1 confirmation): YAML frontmatter `run_id` · `sujet` ·
  `statut: À relire` (pass) or `Bloqué` (fail after 3) · `date` (today) ·
  `recherche: "[[<obsidian_research_folder>/<run-id>]]"` · `tags: [questionnaire]`; body = a
  wikilink line to the research note, then `blueprint.json`, `questionnaire.json`, `verdict.json` as
  fenced code blocks. Then add `questionnaire: "[[<obsidian_questionnaire_folder>/<run-id>]]"` to
  the **research note's** frontmatter (Edit — frontmatter only, body untouched; its `statut` stays
  `Recherche`).

If the human declines, print the questionnaire JSON in the conversation and stop — no fallback
location.

## 6. Report

Print: run-id, subject, item/dimension counts, validation status (pass / blocked after N rounds), and
the result (notion: page link; obsidian: questionnaire note path + `obsidian://` URI). Remind the
human: nothing enters `<engine_format>` until they review it and move the Statut (notion: the page
property; obsidian: the questionnaire note's frontmatter) to **« Approuvé »**.
