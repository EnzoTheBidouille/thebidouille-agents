# /research · 02 Name the run

Parse `$ARGUMENTS`: first token = the **source PDF** (URL or local file path); the rest (optional) = the
**subject**.

### 1. Name the run

Derive a **run-id** (kebab-case) from the subject (else from the source's last path segment). Confirm it
if ambiguous. Check the store for an existing run — notion: a page whose **Run ID** property matches;
obsidian: a note in `<obsidian_research_folder>` whose frontmatter `run_id` matches (Grep). If one exists, ask —
update that page (supersede) or pick a new run-id.
