# /questionnaire · 02 Derive the blueprint

### 2. Derive the blueprint — dispatch `questionnaire-architect`

The blueprint is derived **from the research report** (our own original text — not from the source
PDF). Spawn one agent (`subagent_type: questionnaire-architect`): "Read
`~/.claude/thebidouille.config.yaml` (or legacy `questionnaire.config.yaml`) first for `ui_language` + `engine_format`. Derive a conceptual
questionnaire blueprint from this research report (inline): <the full report markdown>. Return EXACTLY
one tagged block `===BLUEPRINT.JSON===` per the schema in your agent spec — dimensions/subdimensions
with concept + item_guidance (concepts, NEVER ready-made items), polarity, target_items, and a
scoring_intent restricted to the closed vocabulary mean·sum·reverse·weight·weighted_sum·ratio. No
thresholds, no interpretation; carry the licence caveats over into license_note."

Validate the JSON parses (re-dispatch once if not). Keep it in memory.
