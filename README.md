# claude-pipeline

A **portable, stack-agnostic multi-agent development pipeline** for Claude Code. Push it once,
pull it into any project, run one command, and it adapts itself to that project's stack.

It's the generalized form of a working pipeline: a human **lead** drives feature work through
gated commands, dispatching **stateless agents** that only communicate through a frozen contract.

```
/brainstorm → /spec → (design) → /build <id> → test → /review → /ship
```

## How it works — two layers

| Layer                                                                        | Lives in      | Varies per project?         |
| ---------------------------------------------------------------------------- | ------------- | --------------------------- |
| **Portable core** — the workflow doctrine: agents, commands, templates, hook | `.claude/`    | No — identical everywhere   |
| **Project profile** — stack, paths, commands, conventions, capability flags  | `PIPELINE.md` | Yes — generated per project |

The core never hardcodes stack facts. Two mechanisms keep it generic:

1. **Runtime indirection** — agents/commands read all project facts from `PIPELINE.md` at run time
   (agents' _first action_ is to read it).
2. **Render-at-init** — things that must be in agent frontmatter (name, `tools:`, surface ownership)
   are rendered per **surface** by `/init-pipeline` from `implementer.template.md`.

## Install

```sh
# inside your project (or pass its path)
sh install.sh
# or:  curl -fsSL <raw-url>/install.sh | sh
```

Then, in Claude Code:

```
/init-pipeline
```

It **detects** your stack (package manager, workspaces, frameworks, test runners, linters, git remote,
design system), **interviews** you for the gaps, and **generates**:

- `PIPELINE.md` — the project profile (a machine-readable `pipeline-profile` YAML block + prose conventions)
- one implementer agent per **surface** (e.g. `backend.md`, `frontend.md`) with strict tree ownership
- `.claude/gate-config.json` + `.claude/settings.json` — the destructive-command gate
- `scripts/new-feature.sh` + `remove-feature.sh` — parallel worktree isolation (if you enable it)
- `specs/_template.md`

Sanity-check `PIPELINE.md`, commit it, and run `/brainstorm`.

## Update

```sh
sh install.sh --update
```

Refreshes the generic core (commands, hook, templates) **without** touching your `PIPELINE.md`,
rendered agents, `gate-config.json`, or `settings.json`. Re-run `/init-pipeline` if your stack changed.

## The commands

| Command              | Role                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/init-pipeline`     | Detect stack → interview → generate the profile + agents. Run once per project.       |
| `/brainstorm`        | Interactive persona panel that pressure-tests a feature idea.                         |
| `/spec`              | Freeze the feature spec + contract into `specs/<id>.md`. Also applies review returns. |
| `/build <id>`        | Lead authors the contract, then dispatches one implementer per surface in parallel.   |
| `/review <id>`       | Read-only review agent audits the diff against the frozen spec.                       |
| `/ship <id>`         | Release agent commits, pushes, opens the PR (with your confirmation).                 |
| `/audit [path]`      | Prioritized refactor backlog for existing code.                                       |
| `/refactor <domain>` | Apply the backlog for one surface, TDD-first.                                         |
| `/align-ds`          | Align the code UI kit to the design system (no-op if none configured).                |

## Profile reference

See `profile/SCHEMA.md` for every field in `PIPELINE.md` and how the pipeline uses it.

## Layout of this repo

```
install.sh              # installer (fresh + --update)
core/                   # copied verbatim into <project>/.claude
  agents/               # implementer.template.md (rendered per surface) + review.md + release.md
  commands/             # init-pipeline + the workflow commands
  hooks/gate.py         # profile-driven destructive-command gate
  templates/            # handoff / brainstorm-return / design-brief / review-feedback / pr-body / spec
profile/
  PIPELINE.template.md  # the profile skeleton /init-pipeline fills
  SCHEMA.md             # field reference
scripts/                # new-feature / remove-feature worktree-isolation templates
```
