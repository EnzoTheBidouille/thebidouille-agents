# CONTRACT — questionnaire (engine declaration) · `<run-id>`

> Frozen contract: `questionnaire-writer`'s output, the questionnaire in the survey engine's format
> (`engine_format` from `~/.claude/questionnaire.config.yaml`). Held in memory by
> `/questionnaire` and archived in the run's Notion page. Consumed by `questionnaire-validator`. JSON.

```json
{
  "id": "<run-id or subject slug>",
  "version": "1",
  "questions": [
    { "id": "<q-kebab-id>", "type": "likert5", "label": "<ORIGINAL item, in ui_language>" }
  ],
  "dimensions": [
    {
      "id": "<dimension-id — verbatim from the blueprint>",
      "aggregate": {
        "method": "mean | sum | weighted_sum",
        "items": ["<q-id>", "<q-id>"],
        "reverse": ["<q-id of a negative-polarity item>"]
      }
    }
  ],
  "derived": [
    { "id": "<derived-id from the blueprint>", "method": "ratio | weighted_sum | mean", "of": ["<dimension-id>", "<dimension-id>"] }
  ]
}
```

Invariants (the validator checks each):

- **Likert only** for every scored question (`type: "likert5"`). Choice / free-text never sit inside a dimension.
- Scoring methods drawn **only** from `mean · sum · reverse · weight · weighted_sum · ratio`.
- Every `items[]` / `reverse[]` id exists in `questions[]`; every `derived[].of` operand is a declared dimension.
- Dimension `id`s come straight from the blueprint; every `id` unique; every `label` non-empty and in `ui_language`.
- **No interpretation** — no thresholds, levels, verdicts, or score meanings.
