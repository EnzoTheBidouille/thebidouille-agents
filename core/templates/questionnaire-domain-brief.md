# CONTRACT — domain_brief · `<run-id>`

> Frozen contract: the **input** to `questionnaire-researcher` (mode research). Authored by `/research`
> from the command args (source + optional subject) — held in memory, inlined into the dispatch, and
> archived in the run's page — Notion or Obsidian, per the config `store` (nothing is stored elsewhere). Fields below; JSON, not prose.

```json
{
  "subject": "<the domain to measure, or null to let the researcher deduce it from the PDF>",
  "goal": "<what the eventual questionnaire is for — one line>",
  "reference_frameworks": [
    { "name": "<framework / instrument name>", "role": "primary | supporting | source-pdf", "url": "<link, incl. the source PDF>" }
  ],
  "scope": "<what this run covers and explicitly excludes>",
  "audience": "<who answers the questionnaire>",
  "constraints": [ "<e.g. length cap, reading level, ui_language, licence stance>" ]
}
```

Notes:

- The **source PDF** link goes in `reference_frameworks` (or is passed in the dispatch). The researcher
  fetches and reads it; the orchestrator does not.
- `reference_frameworks` may start with just the source PDF; the researcher discovers and reports the rest.
- Keep this brief factual and item-free — it is a scoping contract, not content.
