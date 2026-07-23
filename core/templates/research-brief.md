# CONTRACT — research_brief · `<run-id>`

> Frozen contract: the **input** to `research-agent`. Authored by `/research`
> from the command args (source + optional subject) — held in memory, inlined into the dispatch, and
> archived in the run's page — Notion or Obsidian, per the config `store` (nothing is stored elsewhere). Fields below; JSON, not prose.

```json
{
  "subject": "<the domain the report covers, or null to let the research-agent deduce it from the PDF>",
  "goal": "<the research objective — what this report must establish and extract from the source — one line; frame it as research, NOT as 'what a questionnaire is for'>",
  "reference_frameworks": [
    { "name": "<framework / instrument name>", "role": "primary | supporting | source-pdf", "url": "<link, incl. the source PDF>" }
  ],
  "scope": "<what this run covers and explicitly excludes>",
  "audience": "<who the research report is for (e.g. clinicians, researchers); an eventual questionnaire audience is decided later, at /questionnaire time>",
  "constraints": [ "<e.g. length cap, reading level, ui_language, licence stance>" ]
}
```

Notes:

- The **source PDF** link goes in `reference_frameworks` (or is passed in the dispatch). The research-agent
  fetches and reads it; the orchestrator does not.
- `reference_frameworks` may start with just the source PDF; the research-agent discovers and reports the rest.
- Keep this brief factual and item-free — it is a scoping contract, not content.
