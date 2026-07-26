---
description: (Global capability) OPTIONAL second step after /research — derive a conceptual blueprint from a research run's archived page (Notion or Obsidian), write an ORIGINAL Likert questionnaire in the engine format, validate it, and complete the same page. Nothing is stored outside the store.
argument-hint: <run-id-or-page-url>
---

You are the **orchestrator** of the questionnaire derivation: turning an existing **research run** (the
page produced by `/research` in the configured store) into a validated, engine-format questionnaire —
only because the human asked for one; research runs are valuable without this step.

> **Bootstrap (applies to every step):**
>
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

## Steps — run in order

| # | Step | Does | When |
| --- | --- | --- | --- |
| 01 | `01-load-research` | Load the research from the store | always |
| 02 | `02-derive-blueprint` | Dispatch `questionnaire-architect` for the blueprint | always |
| 03 | `03-write-items` | Dispatch `questionnaire-writer` for original items | always |
| 04 | `04-validate` | Dispatch `questionnaire-validator`, loop max 3 | always |
| 05 | `05-write-to-store` | Write to the store — confirm first | always |
| 06 | `06-report` | Print run, counts, status, result | always |

**Before running a step, read its file** in `.claude/templates/steps/questionnaire/` (resolves to `~/.claude/templates/steps/questionnaire/` when the core is installed globally — read whichever exists). This table is a map, not the instructions.

## Transversal rules

You read the research from the store, hold intermediate artifacts in conversation memory, and write the
result back to the store — notion: the **same page**; obsidian: a **separate questionnaire note
wikilinked to the research note** (research and questionnaires live in distinct folders). **Nothing here
reaches production** — the human reviews the result and flips the Statut to « Approuvé » before anything
enters the survey engine.
