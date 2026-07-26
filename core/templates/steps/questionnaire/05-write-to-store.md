# /questionnaire · 05 Write the questionnaire to the store

### 5. Write the questionnaire to the store — CONFIRM FIRST

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
