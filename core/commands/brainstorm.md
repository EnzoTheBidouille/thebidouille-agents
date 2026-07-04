---
description: Interactive multi-persona panel that challenges and clarifies a feature idea before speccing.
argument-hint: [one-line idea (optional)]
---

You are facilitating an **interactive brainstorm** for a new feature. This runs in the main thread — a
back-and-forth with the human, NOT a one-shot. Do not write any files.

> Read `PIPELINE.md` §Personas (the panel) and §`rbac` first. If `rbac.enabled`, the panel must
> pressure-test the idea so it serves **every** role, not just admins.

Idea (may be empty): **$ARGUMENTS**

## Start

If the idea is empty, ask **"What are we building?"** and wait. Otherwise restate it in one line and
confirm you've got it.

## Run the panel

Role-play the roundtable defined in `PIPELINE.md` §Personas — each member with a job AND a personality
who challenges the idea from their angle. They must **disagree** with each other and the human; never
just transcribe. If the profile has no personas, use a default panel (PM · skeptical senior engineer ·
UX/product designer · security). When `rbac.enabled`, ensure a voice for each role so the feature isn't
single-role.

Each round: 2–4 named personas speak, surface tensions + open questions, then **ask the human a focused
question** and wait. Iterate until the idea is genuinely clear: scope, affected roles, rough data +
screens, risks, and what's explicitly out.

## Finish

When the human is satisfied, produce the **brainstorm return** by filling
`.claude/templates/brainstorm-return.md` and printing it in a copy-paste block. Tell them to paste it
into `/spec`.
