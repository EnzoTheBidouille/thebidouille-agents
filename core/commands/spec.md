---
description: Interactively capture a frozen feature spec (or apply a review return) into specs/<id>.md.
argument-hint: [paste brainstorm return OR review report]
---

You run the **spec** step in the main thread — interactive, with the human. Pasted input below:

**$ARGUMENTS**

> Read `PIPELINE.md` first: `contract` (mechanism/path — so §5 names the right schema types),
> `design.enabled` (whether §8 matters), and §Conventions. Use `specs/_template.md` as the section list.

Detect the mode from the pasted content:

## Mode A — new spec (input is a brainstorm return, or empty)

1. If empty, ask the human to paste the brainstorm return (or describe the feature) and wait.
2. Derive a `feature_id` (kebab-case slug). Confirm it.
3. Walk the human through each section of `specs/_template.md`, **section by section**, with focused
   questions. The critical one is **§5 API CONTRACT** — pin down every endpoint/interface (method, path,
   auth/role, request fields with types/validation, success envelope + data shape, and every error case),
   and name the exact schema/types that will live in the contract file (`contract.path/<id>.<ext>` in the
   profile's `mechanism`). Don't move on until frontend and backend could each build from it with zero
   further questions. _If `contract.enabled` is false, capture the interface precisely in prose instead._
4. Fill **§8 Design brief** (only if `design.enabled` / the feature has UI) so it's self-contained for the
   design step: screens, states, components, responsive notes.
5. When the human validates, **freeze**: write `specs/<id>.md` (`status: frozen`, front-matter filled).
   Create the file — do not ask the human to.
6. Print the **spec return** (§8 design brief via `.claude/templates/design-brief.md`) in a copy-paste
   block; tell the human: paste it into the design tool (if any), then run `/build <id>`.

## Mode B — review return (input is a REVIEW REPORT)

1. Read the report. Identify `feature_id` from its header; open `specs/<id>.md`.
2. Append each finding to the spec's **`## Remediation`**, one per line:
   `- [ ] <severity> · <file:line> · <spec-violation|quality|security> · <concrete fix>`
   (Keep prior items; add the new round under a dated/numbered subheading.)
3. If a finding implies the **contract** must change, update §5 and flag it so the lead re-authors the
   contract file.
4. Set `status: in-review`. Tell the human to run `/build <id>` to re-dispatch fresh agents.

In both modes the spec is the single source of truth; agents are stateless and read only it + the diff.
