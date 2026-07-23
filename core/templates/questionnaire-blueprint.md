# CONTRACT — blueprint · `<run-id>`

> Frozen contract between `questionnaire-architect` (author) and `questionnaire-writer` +
> `questionnaire-validator` (consumers). The **conceptual skeleton** of the questionnaire — constructs and
> guidance, **never items**. Derived by `/questionnaire` from the run's research report (the architect's
> `===BLUEPRINT.JSON===` block), held in memory and archived in the run's page (Notion or Obsidian, per the config `store`). JSON, not prose.

```json
{
  "subject": "<the domain>",
  "framework": "<the framing the questionnaire is built on>",
  "license_note": "<licence status of each instrument referenced: public-domain / open / proprietary / unknown>",
  "dimensions": [
    {
      "id": "<kebab-id — the writer keeps this verbatim>",
      "label": "<human label in ui_language>",
      "subdimensions": [
        {
          "id": "<kebab-id>",
          "label": "<human label>",
          "concept": "<the construct this facet captures — NOT an item>",
          "item_guidance": "<the angle/behaviour a writer should probe — NOT a sentence to answer>",
          "polarity": "positive | negative",
          "target_items": 3
        }
      ]
    }
  ],
  "scoring_intent": {
    "per_dimension": "mean | sum | weighted_sum",
    "derived": [
      { "id": "<kebab-id>", "method": "ratio | weighted_sum | mean", "of": ["<dimension-id>", "<dimension-id>"] }
    ]
  }
}
```

Rules:

- **No items.** `concept` and `item_guidance` are constructs and probing angles, never ready-to-answer
  sentences. No instrument wording is reproduced here.
- `polarity: negative` tells the writer to phrase the item in the opposite direction and reverse-score it.
- Scoring uses the **closed vocabulary** only: `mean · sum · reverse · weight · weighted_sum · ratio`.
- No thresholds, levels, or interpretation anywhere.
