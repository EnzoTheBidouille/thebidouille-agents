# /research · 01 Store auto-setup

### 0. Store auto-setup (first run only)

- **`store: notion`** — if `notion_database_id` is empty: create the archive database
  **automatically** via the Notion MCP — title « Recherche », schema `Sujet` TITLE · `Cadre`
  RICH_TEXT · `Statut` SELECT('Recherche':blue, 'À relire':yellow, 'Bloqué':red, 'Approuvé':green) ·
  `Date` DATE · `Run ID` RICH_TEXT — under `notion_parent_page_id` if set, else as a workspace-level
  private page. Then **write the new database id back into `~/.claude/cohorte.config.yaml`**
  (key `research.notion_database_id`) and tell the human where it lives. If no Notion MCP tool is connected, **stop**: print
  `claude mcp add --transport http notion https://mcp.notion.com/mcp`.
- **`store: obsidian`** — if `obsidian_vault_path` is empty, ask the human for their vault path and
  **write it back into the config**. Verify the path exists (warn — don't block — if it contains no
  `.obsidian/`, it may not be a vault); create `<vault>/<obsidian_research_folder>/` (+ its
  `_sources/`) and `<vault>/<obsidian_questionnaire_folder>/` if missing. No MCP needed — notes are
  written directly.
