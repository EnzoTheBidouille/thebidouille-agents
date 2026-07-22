# thebidouille-agents

[![npm version](https://img.shields.io/npm/v/thebidouille-agents?logo=npm&color=cb3837)](https://www.npmjs.com/package/thebidouille-agents)
[![npm downloads](https://img.shields.io/npm/dm/thebidouille-agents?logo=npm)](https://www.npmjs.com/package/thebidouille-agents)
[![Publish to npm](https://github.com/EnzoTheBidouille/thebidouille-agents/actions/workflows/publish.yml/badge.svg)](https://github.com/EnzoTheBidouille/thebidouille-agents/actions/workflows/publish.yml)
[![node >=18](https://img.shields.io/node/v/thebidouille-agents?logo=node.js&logoColor=white)](https://nodejs.org)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

A **portable, stack-agnostic multi-agent pipeline** for Claude Code. Install it once globally,
then one command per project (`/init-pipeline`) adapts it to that project's stack.

Two independent tracks ship with it:

- **The dev pipeline** — a human **lead** drives feature work through gated commands, dispatching
  **stateless agents** that only communicate through a frozen contract:

  ```
  /brainstorm → /spec → (design) → /build <id> → /smoke → /review → (/fix) → /ship
  ```

- **The research capability** (optional, user-scoped) — `/research` turns a source PDF into an
  academic-register report archived in Notion; `/questionnaire` optionally derives an original
  survey from it. See [Global capability](#global-capability--research--optional-questionnaire).

## How it works — three layers

| Layer | What it holds | Lives in | Scope |
| --- | --- | --- | --- |
| **Generic core** | the workflow doctrine: commands, fixed agents, templates, hooks — zero project facts | `~/.claude` (global) — or vendored in a repo's `.claude/` (bundled) | identical everywhere, installed once |
| **Project profile** | stack, surfaces, commands, conventions, gates | `PIPELINE.md` + rendered surface agents + `gate-config.json`, **committed in each repo** | generated per project by `/init-pipeline` |
| **User config** | the research capability's facts (Notion DB, language, engine format) | `~/.claude/questionnaire.config.yaml` | personal, project-independent |

The core never hardcodes stack facts. Two mechanisms keep it generic:

1. **Runtime indirection** — commands/agents read project facts from `PIPELINE.md` (dev pipeline) or
   `~/.claude/questionnaire.config.yaml` (research capability) at run time — an agent's _first
   action_ is to read its config.
2. **Render-at-init** — things that must be in agent frontmatter (name, `tools:`, surface ownership)
   are rendered per **surface** by `/init-pipeline` from `implementer.template.md`.

## Install

The pipeline ships as an npm package (`thebidouille-agents`), so releases are semver-tagged and
`npx` always fetches the latest published version — no clone needed, works on macOS/Linux/Windows.

**Global (recommended)** — install the generic core ONCE into `~/.claude`; it serves every repo on
your machine. Nothing is copied per project; the gate hook is registered once and reads each repo's
own `gate-config.json`:

```sh
npx thebidouille-agents install --global
```

The per-project part is NOT the core — it's the **profile** `/init-pipeline` generates and you
commit: `PIPELINE.md`, the rendered surface agents, `gate-config.json`, `settings.json`, `specs/`.
**That's what makes team work possible in global mode**: everything project-specific travels with the
repo; each teammate just runs the same global one-liner once, guided by the committed
`.claude/pipeline.json` pointer (core version + install command) that `/init-pipeline` writes.

<details>
<summary><strong>Alternative: per-project (bundled)</strong> — vendor the core into the repo itself.</summary>

```sh
# inside your project (or pass its path as an argument)
npx thebidouille-agents install
```

Copies the core into `<project>/.claude`, committed with the repo. Choose this when you want
**zero-setup onboarding** (teammates get the core with `git clone`, no install step at all) and a
core version **pinned per repo** (no drift between projects or teammates). Cost: the core is
duplicated in every repo and each repo updates separately.

</details>

<details>
<summary><strong>No Node/npm?</strong> The original script installers still work.</summary>

```sh
# global (recommended)                    # per-project (bundled)
sh install.sh --global                    sh install.sh
# or piped:
curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh -s -- --global
```

```powershell
# Windows (PowerShell 5.1+)
.\install.ps1 -Global         # or without -Global for per-project
# or:  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.ps1))) -Global
```

Script installs from a git checkout stamp the version as `<semver> (<sha>)`; the npm CLI stamps the
published semver. Both land in `.claude/pipeline/VERSION` and the `pipeline.json` pointer.

</details>

> **After installing (or updating): restart Claude Code / start a new session.** Slash commands and
> agents are scanned at session start — in an already-open session the new `/init-pipeline`,
> `/research`, etc. won't appear until you reload. This is the #1 "the install didn't work" trap.

Then, in Claude Code (from any repo, once the core is installed either way):

```
/init-pipeline
```

It **detects** your stack (package manager, workspaces, frameworks, test runners, linters, git remote,
design system), **interviews** you for the gaps, and **generates**:

- `PIPELINE.md` — the project profile (a machine-readable `pipeline-profile` YAML block + prose conventions)
- one implementer agent per **surface** (e.g. `backend.md`, `frontend.md`) with strict tree ownership
  and a per-surface `model:` tier (Haiku for mechanical surfaces, bigger models where design decisions live)
- `.claude/gate-config.json` + `.claude/settings.json` — the destructive-command gate, plus an
  `allow` list of the project's read-only commands so agents don't stall on permission prompts
- a **code-retrieval provider** wired as a committed project-scope MCP server —
  [Serena](https://github.com/oraios/serena) by default (live LSP symbol navigation: agents query
  symbols instead of grep-and-reading whole files; `graphify` or `none` also available via the
  profile's `retrieval.provider`)
- `scripts/new-feature.sh` + `remove-feature.sh` — parallel worktree isolation (if you enable it)
- `specs/_template.md`

Sanity-check `PIPELINE.md`, commit it, and run `/brainstorm`.

## Update

```sh
npx thebidouille-agents@latest update --global    # the shared core in ~/.claude (recommended setup)
npx thebidouille-agents@latest update             # a repo's bundled core in <project>/.claude
```

(Script equivalents: `sh install.sh --update [--global]` / `.\install.ps1 -Update [-Global]`.)

The installer refreshes the generic core (commands, hook, templates) **without** touching your
`PIPELINE.md`, rendered agents, `gate-config.json`, `settings.json`, or your filled
`~/.claude/questionnaire.config.yaml`.

From inside Claude Code, prefer **`/update-pipeline`**: it runs the right update invocation for your
install scope, reports `old → new` — and then **reconciles the repo's generated files to the new
core**: new profile fields are added at their defaults (you're only asked for genuinely new
decisions), surface agents are re-rendered, settings are patched additively, new capabilities get
wired. **`/init-pipeline` is one-time per project** — after init, `/update-pipeline` is the only
maintenance command you ever run (`/build` auto-grows surfaces as specs need them).

## Releasing (maintainers)

Versions are tracked with npm semver — the published package is the release artifact.
Publishing is fully automated: [`publish.yml`](.github/workflows/publish.yml) runs on every push
to `main`; when `package.json`'s version isn't on the registry yet it publishes to npm (trusted
publishing / provenance), pushes the `vX.Y.Z` tag, and creates the GitHub release. Pushes without
a version bump just run the sanity checks.

**Releasing = editing one line.** Bump `"version"` in `package.json` (by hand, or
`npm version patch --no-git-tag-version`), commit, push — CI does the rest (publish + tag +
release). No local tagging needed.

`npx thebidouille-agents@latest …` then serves the new version everywhere; installed cores record
it in `.claude/pipeline/VERSION` and bundled repos in their committed `pipeline.json` pointer.

## The commands

| Command              | Role                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/init-pipeline`     | Detect stack → interview → generate the profile + agents. Run once per project.       |
| `/brainstorm`        | Interactive persona panel that pressure-tests a feature idea.                         |
| `/spec`              | Freeze the feature spec + contract into `specs/<id>.md`. Also applies review returns. |
| `/build <id>`        | Lead authors the contract, then dispatches one implementer per surface in parallel.   |
| `/smoke <id>`        | Run the feature for real: infra up, contract endpoints, UI flows, design conformance. |
| `/review <id>`       | Read-only review agents (one per touched surface, parallel) audit the diff vs the spec. |
| `/fix <id>`          | Apply a review/smoke report: remediation into the spec, re-dispatch only the surfaces with findings. |
| `/ship <id>`         | Release agent commits, pushes, opens the PR; watches CI; proposes worktree teardown.  |
| `/audit [path]`      | Prioritized refactor backlog for existing code.                                       |
| `/refactor <domain>` | Apply the backlog for one surface, TDD-first.                                         |
| `/align-ds`          | Align the code UI kit to the design system (no-op if none configured).                |
| `/update-pipeline`   | Refresh the installed core (global or bundled) to the latest published version.       |
| `/doctor`            | Diagnose the installation (core, agents↔surfaces, hooks, gate, retrieval, worktrees). |
| `/research <pdf>`    | _Global capability._ Deep-research a PDF (URL or local file) into a standalone report, archived in Notion or Obsidian. |
| `/questionnaire <id>`| _Global capability._ Optional: derive + write + validate a survey from a research run's archived page. |

## Global capability — research → (optional) questionnaire

A **user-scoped** capability, separate from the dev flow (`/brainstorm…/ship`) and independent of any
project's `PIPELINE.md` — its config lives in **`~/.claude/questionnaire.config.yaml`** (seeded by the
installer, never clobbered on update) and it behaves the same in every directory. **The archived page
IS the run** — a page in a Notion database, or a markdown note in your Obsidian vault, per the
config's `store:` (Notion is the default; Obsidian needs no MCP, just `obsidian_vault_path`).

```
/research <pdf-url-or-path> [subject]        →   (optional)  /questionnaire <run-id>
   standalone research report                       blueprint + ORIGINAL Likert-5 survey + verdict
   → archived page (Statut « Recherche »)           → same page (« À relire » / « Bloqué »)
```

- **`/research`** is genuine research, valuable on its own: the read-only **researcher** reads the PDF —
  **a URL, or a local file** (pass a path to skip CAPTCHAs/paywalls entirely) — and produces a standalone
  research report (state of the art, domain analysis, debates, licences, open questions, sources). It
  **never drafts items** and never reproduces licensed instrument text. The report lands in the store
  (under your confirmation) as a page with Statut « Recherche »; a local source file is attached to the
  page (Notion) or copied to the vault's `_sources/` (Obsidian) for provenance.
- **`/questionnaire`** exists only if you want a survey out of a research run: it derives a conceptual
  **blueprint** from the report (researcher, blueprint mode), dispatches the **writer** (*original*
  Likert-5 items — no tools, so it never sees the source or the report) then the **validator** (loops up
  to 3×), and **completes the same page** (blueprint + questionnaire + verdict, Statut flipped)
  **under your confirmation**. Nothing enters the survey engine until you review the page and mark it
  « Approuvé ».

**Enable it** — one line in `~/.claude/questionnaire.config.yaml`:

```yaml
enabled: true          # that's all — the Notion database is auto-created on the first /research
# store: obsidian     # …or archive to your vault instead (obsidian_vault_path asked once, then saved)
```

(`notion_database_id` is filled back automatically; set `notion_parent_page_id` beforehand if you want
the database created under a specific page. With `store: obsidian`, runs live as notes in
`<vault>/Questionnaires/` with frontmatter properties, and old Notion runs stay readable — pass their
URL to `/questionnaire`. `engine_format` and `ui_language` default to `generic` / `French`.)

With `enabled: false` (or the file absent), `/research` and `/questionnaire` refuse cleanly and change
nothing. The capability requires the Notion MCP (it is the storage):

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
core/                   # copied verbatim into ~/.claude (global) or <project>/.claude (bundled)
  agents/               # implementer.template.md (rendered per surface) + review.md + release.md
                        #   + questionnaire-{researcher,writer,validator}.md (fixed capability agents)
  commands/             # init-pipeline + the workflow commands + /update-pipeline, /research, /questionnaire
  hooks/                # gate.py (destructive-command gate)
  templates/            # handoff / brainstorm-return / design-brief / review-feedback / pr-body / spec
                        #   + questionnaire-{domain-brief,blueprint,declaration,verdict} (frozen contracts)
profile/
  PIPELINE.template.md  # the profile skeleton /init-pipeline fills
  SCHEMA.md             # field reference
  questionnaire.config.template.yaml  # seeds ~/.claude/questionnaire.config.yaml (global capability)
scripts/                # new-feature / remove-feature worktree-isolation templates
```
