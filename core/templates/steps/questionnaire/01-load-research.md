# /questionnaire · 01 Load the research from the store

### 1. Load the research from the store

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
