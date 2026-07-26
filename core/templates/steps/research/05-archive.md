# /research · 05 Archive to the store

### 4. Archive to the store — CONFIRM FIRST (this IS the storage)

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
