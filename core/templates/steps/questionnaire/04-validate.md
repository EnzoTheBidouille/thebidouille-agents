# /questionnaire · 04 Validate

### 4. Validate — dispatch `questionnaire-validator`, loop max 3

The validator has no tools. **Inline** questionnaire + blueprint + `ui_language`/`engine_format`:

> `subagent_type: questionnaire-validator` — "Validate this questionnaire against its blueprint and the
> `<engine_format>` rules. Constate, do not correct. Questionnaire: <inline>. Blueprint: <inline>.
> Return the verdict JSON `{ status, errors[], questionnaire }`."

If `status: "fail"`, re-dispatch the **writer** with the `errors[]` inlined and re-validate — **up to 3
rounds total**. Still `fail` after 3 ⇒ keep the last versions, the Statut will be **« Bloqué »**, and
flag it to the human.
