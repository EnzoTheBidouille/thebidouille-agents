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

The pipeline ships as an npm package (`thebidouille-agents`), so releases are semver-tagged and
`npx` always fetches the latest published version — no clone needed, works on macOS/Linux/Windows.
Two ways to place the portable core; both end at the same `/init-pipeline`.

**Per-project** (default) — bundles the core into `<project>/.claude`, so it's committed and your
teammates get it with the repo:

```sh
# inside your project (or pass its path as an argument)
npx thebidouille-agents install
```

**Global** — one core in `~/.claude`, shared by every repo on your machine (nothing copied per repo;
the gate hook is registered once and reads each repo's own `gate-config.json`):

```sh
npx thebidouille-agents install --global
```

<details>
<summary><strong>No Node/npm?</strong> The original script installers still work.</summary>

```sh
# per-project                             # global
sh install.sh                             sh install.sh --global
# or piped:
curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh -s -- --global
```

```powershell
# Windows (PowerShell 5.1+)
.\install.ps1              # or  -Global
# or:  irm https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.ps1 | iex
```

Script installs from a git checkout stamp the version as `<semver> (<sha>)`; the npm CLI stamps the
published semver. Both land in `.claude/pipeline/VERSION` and the `pipeline.json` pointer.

</details>

Trade-off: global is leanest for a solo dev across many repos and updates everywhere at once, but all
projects share one core version and teammates must install it themselves. In global mode `/init-pipeline`
writes a committed **`.claude/pipeline.json` pointer** recording the core version + install command, so a
teammate who clones the repo knows to run the global installer.

Then, in Claude Code (from any repo, once the core is installed either way):

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
npx thebidouille-agents@latest update             # per-project core in <project>/.claude
npx thebidouille-agents@latest update --global    # the shared core in ~/.claude
```

(Script equivalents: `sh install.sh --update [--global]` / `.\install.ps1 -Update [-Global]`.)

Refreshes the generic core (commands, hook, templates) **without** touching your `PIPELINE.md`,
rendered agents, `gate-config.json`, `settings.json`, or your filled
`~/.claude/questionnaire.config.yaml`. Re-run `/init-pipeline` if your stack changed.

From inside Claude Code you can also just run **`/update-pipeline`** — it runs the right
update invocation for your install scope and reports `old → new` from the VERSION stamp.

## Releasing (maintainers)

Versions are tracked with npm semver — the published package is the release artifact:

```sh
npm version patch          # or minor / major — bumps package.json + creates the git tag
git push --follow-tags
npm publish
```

`npx thebidouille-agents@latest …` then serves the new version everywhere; installed cores record
it in `.claude/pipeline/VERSION` and bundled repos in their committed `pipeline.json` pointer.

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
| `/update-pipeline`   | Refresh the installed core (global or bundled) from the repo's latest `main`.         |
| `/research <pdf>`    | _Global capability._ Structure a PDF (URL or local file) into a report + blueprint, archived to Notion. |
| `/questionnaire <id>`| _Global capability._ Write + validate the questionnaire, complete the Notion page.     |

## Global capability — questionnaire pipeline (PDF → survey)

A **user-scoped** content-generation capability, separate from the dev flow (`/brainstorm…/ship`) and
independent of any project's `PIPELINE.md` — its config lives in **`~/.claude/questionnaire.config.yaml`**
(seeded by the installer, never clobbered on update) and it behaves the same in every directory. It turns
a source PDF into a review-ready survey — never straight to production.

```
/research <pdf-url-or-path> [subject]      →   /questionnaire <run-id>
   report.md + blueprint.json                    questionnaire.json + verdict.json
   → Notion page (Statut « Recherche »)          → same Notion page (« À relire » / « Bloqué »)
```

- **`/research`** dispatches the read-only **researcher**: it reads the PDF — **a URL, or a local file**
  (pass a path to skip CAPTCHAs/paywalls entirely; the file is staged into the run dir) — and structures
  the domain into a readable `report.md` + a conceptual `blueprint.json`. It **structures, never drafts
  items**, and never reproduces licensed instrument text. The report is archived to Notion (under your
  confirmation) as a page with Statut « Recherche », so you review it there.
- **`/questionnaire`** dispatches the **writer** (writes *original* Likert-5 items — it has no tools, so it
  never sees the source) then the **validator** (checks format + blueprint match, loops up to 3×), and
  **updates the same Notion page** (questionnaire + verdict appended, Statut flipped) **under your
  confirmation**. Nothing enters the survey engine until you review the Notion page and mark it approved.

**Enable it** by editing `~/.claude/questionnaire.config.yaml`:

```yaml
enabled: true
notion_database_id: "<your Notion database id/URL>"
runs_path: ~/.claude/questionnaire-runs      # runs are written here, project-independent
engine_format: samo-surveys
ui_language: French
```

With `enabled: false` (or the file absent), `/research` and `/questionnaire` refuse cleanly and change
nothing. Archiving needs the Notion MCP connected:

```sh
claude mcp add --transport http notion https://mcp.notion.com/mcp
```

## License

[AGPL-3.0](LICENSE). Free to use, including commercially — but if you modify it and distribute it
or offer it as a network service, you must publish your modifications under the same license.

## Profile reference

See `profile/SCHEMA.md` for every field in `PIPELINE.md` and how the pipeline uses it.

## Layout of this repo

```
package.json            # npm package (thebidouille-agents) — semver source of truth
bin/cli.js              # the npm CLI: install / update / version (cross-platform, no deps)
install.sh              # script installer (fresh + --update) for no-Node environments
install.ps1             # same installer for Windows PowerShell (fresh + -Update)
core/                   # copied verbatim into <project>/.claude (or ~/.claude with --global)
  agents/               # implementer.template.md (rendered per surface) + review.md + release.md
                        #   + questionnaire-{researcher,writer,validator}.md (fixed capability agents)
  commands/             # init-pipeline + the workflow commands + /update-pipeline, /research, /questionnaire
  hooks/gate.py         # profile-driven destructive-command gate
  templates/            # handoff / brainstorm-return / design-brief / review-feedback / pr-body / spec
                        #   + questionnaire-{domain-brief,blueprint,declaration,verdict} (frozen contracts)
profile/
  PIPELINE.template.md  # the profile skeleton /init-pipeline fills
  SCHEMA.md             # field reference
  questionnaire.config.template.yaml  # seeds ~/.claude/questionnaire.config.yaml (global capability)
scripts/                # new-feature / remove-feature worktree-isolation templates
```
