# /questionnaire · 03 Write the items

### 3. Write the items — dispatch `questionnaire-writer` (stateless, no tools)

The writer has no tools by design (it cannot see the source OR the research — licence-free by
construction). **Inline** the blueprint + `ui_language` + `engine_format` into its dispatch prompt:

> `subagent_type: questionnaire-writer` — "Write an ORIGINAL Likert-5 questionnaire in the
> `<engine_format>` format from this blueprint. ui_language: `<ui_language>`. Blueprint: <inline>.
> Original items only; respect `target_items` and `polarity` (negative → reverse); keep blueprint
> dimension `id`s; closed scoring vocabulary only; no interpretation. Return one JSON object only."

Verify it parses. Keep it in memory.
