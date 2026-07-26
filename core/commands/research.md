---
description: (Global capability) Deep-research a source PDF — URL or LOCAL FILE — into a standalone research report, archived as a Notion page or an Obsidian note (config `store`). The archive is auto-set-up on first run. A questionnaire can OPTIONALLY be derived later with /questionnaire.
argument-hint: <pdf-url-or-path> [subject]
---

You are the **orchestrator** of a research run: turning a source PDF into a genuine, standalone
**research report** — valuable on its own, not questionnaire-shaped.

> **Bootstrap (applies to every step):**
>
> **First action, always:** read the consolidated global config
> **`~/.claude/thebidouille.config.yaml`**; if it's absent, fall back to the legacy flat
> **`~/.claude/questionnaire.config.yaml`**. If neither exists, or `research.enabled` (legacy:
> `enabled`) is not `true`, **stop**: tell the human to enable it via `/update-pipeline` (or set
> `research.enabled: true`). Otherwise read these values — nested in the consolidated file, flat in
> the legacy one — and refer to them below by the short names on the left:
> `store` = `research.store` (missing/empty ⇒ `notion`) · `notion_database_id` =
> `research.notion_database_id` · `notion_parent_page_id` = `research.notion_parent_page_id` ·
> `obsidian_vault_path` = `obsidian.vault_path` · `obsidian_research_folder` = `research.folder` ·
> `obsidian_questionnaire_folder` = `questionnaire.folder` · `engine_format` =
> `questionnaire.engine_format` · `ui_language` = `ui_language`. When you write a value back (e.g.
> the created `notion_database_id`, or a vault path the human supplies), write it into the
> consolidated file at its nested key — creating that file from the template if only the legacy one
> existed.

## Steps — run in order

| # | Step | Does | When |
| --- | --- | --- | --- |
| 01 | `01-store-setup` | Auto-create the archive store | first run only |
| 02 | `02-name-run` | Parse args, derive & dedupe run-id | always |
| 03 | `03-frame` | Compose the research brief in memory | always |
| 04 | `04-produce` | Produce the report via research-agent | always |
| 05 | `05-archive` | Confirm, then write to the store | always |
| 06 | `06-report` | Print run-id, framework, page link | always |

**Before running a step, read its file** in `.claude/templates/steps/research/` (resolves to `~/.claude/templates/steps/research/` when the core is installed globally — read whichever exists). This table is a map, not the instructions.

## Transversal rules

- A questionnaire is an OPTIONAL later step (`/questionnaire <run-id>`), derived from the report only if the human wants one.
- This is a **global, user-scoped** command; it behaves identically in every directory.
- **The store page IS the run's storage** — you hold artifacts in conversation memory and write nothing anywhere else.
