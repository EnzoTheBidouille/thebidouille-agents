---
description: (Global capability) Deep-research a source PDF — URL or LOCAL FILE — into a standalone research report, archived as a Notion page or an Obsidian note (config `store`). The archive is auto-set-up on first run. A questionnaire can OPTIONALLY be derived later with /questionnaire.
argument-hint: <pdf-url-or-path> [subject]
---

You are the **orchestrator** of a research run: turning a source PDF into a genuine, standalone
**research report** — valuable on its own, not questionnaire-shaped. A questionnaire is an OPTIONAL
later step (`/questionnaire <run-id>`), derived from the report only if the human wants one. This is a
**global, user-scoped** command; it behaves identically in every directory. **The store page IS the
run's storage** — you hold artifacts in conversation memory and write nothing anywhere else.

> **First action, always:** read **`~/.claude/questionnaire.config.yaml`** (the global capability
> config). If it's missing or `enabled` is not `true`, **stop**: tell the human to set `enabled: true`
> in that file. Otherwise note `store` (missing/empty ⇒ `notion`), its store-specific keys
> (`notion_database_id` + `notion_parent_page_id`, or `obsidian_vault_path` +
> `obsidian_research_folder`/`obsidian_questionnaire_folder`),
> `engine_format`, `ui_language`.

## 0. Store auto-setup (first run only)

- **`store: notion`** — if `notion_database_id` is empty: create the archive database
  **automatically** via the Notion MCP — title « Questionnaires », schema `Sujet` TITLE · `Cadre`
  RICH_TEXT · `Statut` SELECT('Recherche':blue, 'À relire':yellow, 'Bloqué':red, 'Approuvé':green) ·
  `Date` DATE · `Run ID` RICH_TEXT — under `notion_parent_page_id` if set, else as a workspace-level
  private page. Then **write the new database id back into `~/.claude/questionnaire.config.yaml`**
  and tell the human where it lives. If no Notion MCP tool is connected, **stop**: print
  `claude mcp add --transport http notion https://mcp.notion.com/mcp`.
- **`store: obsidian`** — if `obsidian_vault_path` is empty, ask the human for their vault path and
  **write it back into the config**. Verify the path exists (warn — don't block — if it contains no
  `.obsidian/`, it may not be a vault); create `<vault>/<obsidian_research_folder>/` (+ its
  `_sources/`) and `<vault>/<obsidian_questionnaire_folder>/` if missing. No MCP needed — notes are
  written directly.

Parse `$ARGUMENTS`: first token = the **source PDF** (URL or local file path); the rest (optional) = the
**subject**.

## 1. Name the run

Derive a **run-id** (kebab-case) from the subject (else from the source's last path segment). Confirm it
if ambiguous. Check the store for an existing run — notion: a page whose **Run ID** property matches;
obsidian: a note in `<obsidian_research_folder>` whose frontmatter `run_id` matches (Grep). If one exists, ask —
update that page (supersede) or pick a new run-id.

## 2. Frame the research (in memory — no file)

Compose the domain brief per the schema in `~/.claude/templates/questionnaire-domain-brief.md`
(`subject`, `goal`, `scope`, `audience`, `constraints` — seed `ui_language` + a licence-caution note —
and `reference_frameworks` starting with the source, `role: "source-pdf"`). Ask the human for
`goal`/`audience`/`scope` only if they're not obvious. You will inline this brief into the dispatch and
into the archived page — never onto disk outside the store.

## 3. Dispatch `questionnaire-researcher` in RESEARCH mode (read-only)

Spawn one agent (`subagent_type: questionnaire-researcher`): "MODE: research. Read
`~/.claude/questionnaire.config.yaml` first for `ui_language`. Produce a standalone research report for
run `<run-id>`. domain_brief (inline): <the full brief JSON>. Source PDF: <path-or-url> — **local path ⇒
Read tool (`pages` parameter, ~15 pages per call, as many calls as needed); URL ⇒ WebFetch** (if
unreachable, flag it and reconstruct from secondary sources). Return EXACTLY one tagged block
`===REPORT.MD===` — an academic-register research report (Sujet & périmètre · Méthodologie · Synthèse ·
Cadres & état de l'art · Analyse du domaine · Débats & controverses · Paysage pratique & licences ·
Questions ouvertes · Sources), per your agent spec: **argued prose, precise citations
(chapter/page + author–date), explicit epistemic status (established/debated/hypothesis), numbers with
references, 2 500–5 000 words** — NOT an executive summary, NOT questionnaire-shaped. Never draft
items, never reproduce instrument text, flag every licence."

## 4. Archive to the store — CONFIRM FIRST (this IS the storage)

Show the human a short summary and **ask to confirm** the write. On yes:

- **notion** — create the page in `notion_database_id`: properties **Sujet** · **Cadre** (the main
  framework identified) · **Statut** = `« Recherche »` · **Date** = today · **Run ID** = `<run-id>`;
  body = the report, plus the domain brief in a fenced JSON block at the end. If the source was a
  **local file**, also attach it (`notion-create-attachment`) — best effort, skip gracefully.
- **obsidian** — write `<vault>/<obsidian_research_folder>/<run-id>.md`: YAML frontmatter
  `run_id` · `sujet` · `cadre` · `statut: Recherche` · `date` (today, YYYY-MM-DD) ·
  `tags: [questionnaire-run]`; body = the report, plus the domain brief in a fenced JSON block at the
  end. If the source was a **local file**, copy the PDF to
  `<obsidian_research_folder>/_sources/<run-id>.pdf`
  and link it near the top (`![[_sources/<run-id>.pdf]]`).

If the human declines the write, print the report in the conversation instead and stop — there is
deliberately no fallback location.

## 5. Report

Print: run-id, subject, main framework + licence summary, and the page — notion: the page link;
obsidian: the note path + the
`obsidian://open?vault=<vault folder name>&file=<obsidian_research_folder>/<run-id>` URI. Tell the human: review the research; if — and only if — they want a survey derived from it, run
**`/questionnaire <run-id>`**.
