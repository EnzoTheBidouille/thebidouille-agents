---
description: (Global capability) Deep-research a source PDF — URL or LOCAL FILE — into a standalone research report, archived as a Notion page or an Obsidian note (config `store`). The archive is auto-set-up on first run. A questionnaire can OPTIONALLY be derived later with /questionnaire.
argument-hint: <pdf-url-or-path> [subject]
---

You are the **orchestrator** of a research run: turning a source PDF into a genuine, standalone
**research report** — valuable on its own, not questionnaire-shaped. A questionnaire is an OPTIONAL
later step (`/questionnaire <run-id>`), derived from the report only if the human wants one. This is a
**global, user-scoped** command; it behaves identically in every directory. **The store page IS the
run's storage** — you hold artifacts in conversation memory and write nothing anywhere else.

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

## 0. Store auto-setup (first run only)

- **`store: notion`** — if `notion_database_id` is empty: create the archive database
  **automatically** via the Notion MCP — title « Recherche », schema `Sujet` TITLE · `Cadre`
  RICH_TEXT · `Statut` SELECT('Recherche':blue, 'À relire':yellow, 'Bloqué':red, 'Approuvé':green) ·
  `Date` DATE · `Run ID` RICH_TEXT — under `notion_parent_page_id` if set, else as a workspace-level
  private page. Then **write the new database id back into `~/.claude/thebidouille.config.yaml`**
  (key `research.notion_database_id`) and tell the human where it lives. If no Notion MCP tool is connected, **stop**: print
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

Compose the research brief per the schema in `~/.claude/templates/research-brief.md`
(`subject`, `goal`, `scope`, `audience`, `constraints` — seed `ui_language` + a licence-caution note —
and `reference_frameworks` starting with the source, `role: "source-pdf"`). Frame `goal` as a **research
objective** — what the report must establish and extract from the source — **never** as "what a future
questionnaire is for"; the questionnaire is an optional downstream step and must not colour the brief.
Ask the human for `goal`/`audience`/`scope` only if they're not obvious. You will inline this brief into
the dispatch and into the archived page — never onto disk outside the store.

## 3. Produce the report — single-pass or multi-pass (all via `research-agent`, read-only)

The `research-agent` never touches the store; the orchestrator routes every artifact between passes and
holds them in memory. Each dispatch begins: "Read `~/.claude/thebidouille.config.yaml` (or legacy
`questionnaire.config.yaml`) first for `ui_language`." **The orchestrator never reads the source itself**
— every read goes through a `research-agent` pass.

Pick the path by source type and size:

- **URL source** ⇒ **single-pass** (WebFetch can't page reliably). Skip to §3a.
- **Local PDF** ⇒ first run **§3.map** to size it; then the plan's `multipass` flag picks §3a (false) or
  §3b (true).

**§3.map — reading plan.** Spawn one `research-agent` (job `map`): "Job: map. research_brief (inline):
<brief>. Source PDF: <path>. Map the table of contents / structure and return `===PLAN.JSON===` per your
spec — segments covering the whole document (~20–35 pages each), `multipass`, `total_pages`." Parse the
plan (re-dispatch once if it doesn't parse).

**§3a — single-pass** (small source, or URL). Spawn one `research-agent` (job `analyse-full`): "Job:
analyse-full. Produce a standalone research report for run `<run-id>`. research_brief (inline): <brief>.
Source: <path-or-url> — **local path ⇒ Read tool (`pages`, ~15/call, as many as needed); URL ⇒ WebFetch**
(if unreachable, flag it in the methodology note and reconstruct from secondary sources). Return EXACTLY
one `===REPORT.MD===` — the full 9-section skeleton, argued prose, precise citations, explicit epistemic
status, numbers with references, length scaled to the source (completeness is the ceiling), NOT
questionnaire-shaped." That block **is** the report; go to §4.

**§3b — multi-pass** (large source). Guarantees a long, exhaustive report by never asking one dispatch
to emit the whole thing:

1. **Fan out, one segment per agent (in parallel).** For each `segments[]` entry, spawn a `research-agent`
   (job `analyse-segment`) **in the same message** so they run concurrently: "Job: analyse-segment.
   research_brief (inline): <brief>. Source PDF: <path>. Segment: « <title> », pages <X-Y> — read ONLY
   those pages. Return EXACTLY one `===PARTIAL.MD===` per your spec (deep analysis of this segment +
   Fils transverses + Sources (segment))." Collect every partial. If a segment fails, re-dispatch it once.
2. **Synthesise the cross-cutting sections.** Spawn one `research-agent` (job `synthesise`): "Job:
   synthesise. Subject: <subject>. You are given each segment's Fils transverses + Sources (segment)
   below (not the full bodies). <inline: for every partial, its « ### Fils transverses » and « ### Sources
   (segment) » blocks, each under its segment title>. Return EXACTLY one `===SYNTH.MD===` per your spec —
   unified Synthèse/Questions ouvertes, merged deduped bibliography, unified licence table; note the
   multi-pass method (N segments) in Méthodologie."
3. **Assemble `REPORT.MD` (orchestrator, mechanical — no source reading).** Stitch, in order: `# <Subject>`
   → SYNTH's `## Sujet & périmètre`, `## Méthodologie`, `## Synthèse`, `## Cadres de référence & état de
   l'art` → then `## Analyse du domaine` whose body is **each partial's analytical block concatenated in
   segment order** (the text from `## <Segment title>` down to but excluding its `### Fils transverses`) →
   then SYNTH's `## Débats & controverses`, `## Paysage pratique & licences`, `## Questions ouvertes`,
   `## Sources`. The result is one coherent `REPORT.MD`; go to §4.

## 4. Archive to the store — CONFIRM FIRST (this IS the storage)

Show the human a short summary and **ask to confirm** the write. On yes:

- **notion** — create the page in `notion_database_id`: properties **Sujet** · **Cadre** (the main
  framework identified) · **Statut** = `« Recherche »` · **Date** = today · **Run ID** = `<run-id>`;
  body = the report, plus the research brief in a fenced JSON block at the end. If the source was a
  **local file**, also attach it (`notion-create-attachment`) — best effort, skip gracefully.
- **obsidian** — write `<vault>/<obsidian_research_folder>/<run-id>.md`: YAML frontmatter
  `run_id` · `sujet` · `cadre` · `statut: Recherche` · `date` (today, YYYY-MM-DD) ·
  `tags: [research-run]`; body = the report, plus the research brief in a fenced JSON block at the
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
