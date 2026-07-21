# CONTRACT — verdict · `<run-id>`

> Frozen contract: `questionnaire-validator`'s output. Written by `/questionnaire` to
> `<runs_path>/<run-id>/verdict.json` (`runs_path` from `~/.claude/questionnaire.config.yaml`). Drives the
> writer↔validator fix loop (max 3 rounds) and the Notion status. JSON.

```json
{
  "status": "pass | fail",
  "errors": [
    "<one self-sufficient message per violation: names the exact id/field and the rule broken, actionable by a stateless writer>"
  ],
  "questionnaire": { }
}
```

Semantics:

- `status` is `"pass"` **only** when `errors` is empty; otherwise `"fail"`.
- Each `errors[]` entry is self-contained (e.g.
  `"dimensions[extraversion].aggregate.items references 'q-x9' which is not in questions[]"`) so the writer
  can fix it blindly on the next loop.
- `questionnaire` echoes the exact document validated — the validator never edits it.
- **Loop:** on `fail`, `/questionnaire` re-dispatches the writer with these `errors[]`, then re-validates —
  up to **3 rounds**. Still `fail` after 3 ⇒ the run is archived with Notion status **« Bloqué »**.
