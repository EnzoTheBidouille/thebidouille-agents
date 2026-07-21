# CONTRACT — domain_brief · `<run-id>`

> Frozen contract: the **input** to `questionnaire-researcher`. Authored by `/research` from the command
> args (URL + optional subject) — the agents read it, never edit it. One file per run at
> `<runs_path>/<run-id>/domain_brief.json` (`runs_path` from `~/.claude/questionnaire.config.yaml`, default
> `~/.claude/questionnaire-runs`). Fields below; JSON, not prose.

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
