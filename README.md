<div align="center">

<img src="https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/assets/cohorte-banner.png" alt="Cohorte — portable multi-agent pipeline for Claude Code" width="720">

[![npm version](https://img.shields.io/npm/v/cohorte?logo=npm&color=cb3837)](https://www.npmjs.com/package/cohorte)
[![npm downloads](https://img.shields.io/npm/dm/cohorte?logo=npm)](https://www.npmjs.com/package/cohorte)
[![Publish to npm](https://github.com/TheBidouilleAgency/cohorte/actions/workflows/publish.yml/badge.svg)](https://github.com/TheBidouilleAgency/cohorte/actions/workflows/publish.yml)
[![node >=18](https://img.shields.io/node/v/cohorte?logo=node.js&logoColor=white)](https://nodejs.org)
[![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

</div>

A **portable, stack-agnostic multi-agent pipeline** for Claude Code. Install it once globally,
then one command per project (`/init-pipeline`) adapts it to that project's stack.

- **The dev pipeline** — a human **lead** drives feature work through gated commands, dispatching
  **stateless agents** that only communicate through a frozen contract:

  ```
  /brainstorm → /spec → (design) → /build <id> → /smoke → /review → (/fix) → /ship
  ```

## How it works — three layers

| Layer | What it holds | Lives in | Scope |
| --- | --- | --- | --- |
| **Generic core** | the workflow doctrine: commands, fixed agents, templates, hooks — zero project facts | `~/.claude` (global) — or vendored in a repo's `.claude/` (bundled) | identical everywhere, installed once |
| **Project profile** | stack, surfaces, commands, conventions, gates | `PIPELINE.md` + rendered surface agents + `gate-config.json`, **committed in each repo** | generated per project by `/init-pipeline` |
| **User config** | kanban board links + shared Obsidian vault path | `~/.claude/cohorte.config.yaml` | personal, project-independent |

The core never hardcodes stack facts. Two mechanisms keep it generic:

1. **Runtime indirection** — commands/agents read project facts from `PIPELINE.md` (dev pipeline) or
   `~/.claude/cohorte.config.yaml` (kanban board links + shared vault) at run time — an agent's
   _first action_ is to read its config.
2. **Render-at-init** — things that must be in agent frontmatter (name, `tools:`, surface ownership)
   are rendered per **surface** by `/init-pipeline` from `implementer.template.md`.

## Prerequisites

Only one hard requirement — the rest is optional and independent:

- **Node ≥ 18 + npm** — _required_, for the `npx` installer that lays down the core. Nothing else needs it.
- **[`uv`](https://docs.astral.sh/uv/) + the Serena CLI** — _optional_, the default code-retrieval
  provider. Install it separately (`uv tool install -p 3.13 serena-agent && uv tool update-shell`); the
  `npx` install neither needs nor touches it, so the order between the two is irrelevant. Without Serena
  the pipeline still runs — agents just fall back to Grep/Read. Having it installed **before**
  `/init-pipeline` lets init wire it in one pass (otherwise `/update-pipeline` wires it later).
- **On a new machine cloning a repo that's already pipeline-ised:** the Serena registration is committed
  in the repo's `.mcp.json` (project scope, portable) — you don't re-wire. Just install the Serena CLI,
  restart the session, and run `/doctor` to confirm it connects.

## Install

The pipeline ships as an npm package (`cohorte`), so releases are semver-tagged and
`npx` always fetches the latest published version — no clone needed, works on macOS/Linux/Windows.

**Global (recommended)** — install the generic core ONCE into `~/.claude`; it serves every repo on
your machine. Nothing is copied per project; the gate hook is registered once and reads each repo's
own `gate-config.json`:

```sh
npx cohorte install --global
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
npx cohorte install
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
curl -fsSL https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/install.sh | sh -s -- --global
```

```powershell
# Windows (PowerShell 5.1+)
.\install.ps1 -Global         # or without -Global for per-project
# or:  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/install.ps1))) -Global
```

Script installs from a git checkout stamp the version as `<semver> (<sha>)`; the npm CLI stamps the
published semver. Both land in `.claude/pipeline/VERSION` and the `pipeline.json` pointer.

</details>

> **After installing (or updating): restart Claude Code / start a new session.** Slash commands and
> agents are scanned at session start — in an already-open session the new `/init-pipeline`,
> `/build`, etc. won't appear until you reload. This is the #1 "the install didn't work" trap.

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
npx cohorte@latest update --global    # the shared core in ~/.claude (recommended setup)
npx cohorte@latest update             # a repo's bundled core in <project>/.claude
```

(Script equivalents: `sh install.sh --update [--global]` / `.\install.ps1 -Update [-Global]`.)

The installer refreshes the generic core (commands, hook, templates) **without** touching your
`PIPELINE.md`, rendered agents, `gate-config.json`, `settings.json`, or your filled
`~/.claude/cohorte.config.yaml`.

From inside Claude Code, prefer **`/update-pipeline`**: it runs the right update invocation for your
install scope, reports `old → new` — and then **reconciles the repo's generated files to the new
core**: new profile fields are added at their defaults (you're only asked for genuinely new
decisions), surface agents are re-rendered, settings are patched additively, new capabilities get
wired. **`/init-pipeline` is one-time per project** — after init, `/update-pipeline` is the only
maintenance command you ever run (`/build` auto-grows surfaces as specs need them).

## Dashboard — a local web cockpit

A browser view of pipeline state, for when a checklist beats scanning files:

```sh
npx cohorte dashboard          # serves http://localhost:4317 (Ctrl-C to stop)
npx cohorte dashboard <path>   # start focused on another project
npx cohorte dashboard --port=4400 --open   # custom port, open the browser
```

**Bound to `127.0.0.1` by default** — the dashboard's actions execute code (install/update/reset,
and `/init-pipeline`·`/update-pipeline` via headless Claude), so it must stay on loopback. Each user
runs their own agent and drives only their own machine. `--host=0.0.0.0` exposes it to the network
(it prints a security warning) — only on a trusted network, since anyone who reaches the port can run
those actions.

- **Fleet overview** — the global core version vs npm latest, plus every tracked project's freshness
  and health at a glance. Add a project by absolute path or with the **folder picker** (Browse…); the
  set is remembered in `~/.claude/cohorte-dashboard.json`.
- **Per-project drill-down** — Freshness (installed core vs npm), `/doctor` rendered as a live
  ✅/⚠️/❌ checklist (each failure with its fix), the **Surfaces ↔ agents** map from `PIPELINE.md`,
  and one board: a **Kanban** if the project has a linked Obsidian board (columns + cards from the
  vault, with clickable PR links + live open/merged/closed status and a ship-date-sorted Shipped
  column, via `gh`), otherwise a **Specs board** from `specs/*.md` (by `draft · frozen · in-review ·
  shipped`). The Kanban supersedes the Specs board when both would apply.
- **Actions** (stream their output live) — **Update / Install core** (the shared global core, or a
  repo's bundled core); **Init-pipeline / Update-pipeline**, which run those Claude Code commands
  **headless** (`claude -p`, autonomous — Init skips the interactive interview, so review the result);
  and **Reset pipeline**, which backs up then wipes a project's pipeline footprint and reinstalls a
  fresh core. Buttons render only when they apply (e.g. Init only when there's no profile).

Runtime is **dependency-free** — node's built-in `http` server serves a prebuilt React app (the app
source lives in `dashboard/app/`, built to `dashboard/dist/` at publish time). The `/doctor` checks
are reimplemented in JS, so the dashboard needs no Claude session to compute state. See
[`dashboard/README.md`](dashboard/README.md) for the architecture.

## Releasing (maintainers)

Versions are tracked with npm semver — the published package is the release artifact.
Publishing is fully automated: [`publish.yml`](.github/workflows/publish.yml) runs on every push
to `main`; when `package.json`'s version isn't on the registry yet it publishes to npm (trusted
publishing / provenance), pushes the `vX.Y.Z` tag, and creates the GitHub release. Pushes without
a version bump just run the sanity checks.

**Releasing = editing one line.** Bump `"version"` in `package.json` (by hand, or
`npm version patch --no-git-tag-version`), commit, push — CI does the rest (publish + tag +
release). No local tagging needed.

`npx cohorte@latest …` then serves the new version everywhere; installed cores record
it in `.claude/pipeline/VERSION` and bundled repos in their committed `pipeline.json` pointer.

## The commands

| Command              | Role                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/init-pipeline`     | Detect stack → interview → generate the profile + agents. Run once per project.       |
| `/brainstorm`        | Interactive persona panel that pressure-tests a feature idea.                         |
| `/spec`              | Freeze the feature spec + contract into `specs/<id>.md` (UI features also get a standalone design brief at `specs/design/<id>.md`). Also applies review returns. |
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

### Run the loop cheaply — `/clear` between stages

Every command reloads all the state it needs **from disk** — the frozen spec, the contract, the diff, the
Remediation checkboxes, the freshness stamp, and the last `/review`·`/smoke` report (staged to a gitignored
`specs/reports/<id>.md`). Nothing essential lives in the conversation. So the loop is **`/clear`-safe at
every boundary**:

```
/spec → /clear → /build → /clear → /smoke → /clear → /review → /clear → /fix → /clear → /review → /ship
```

`/clear`-ing between stages sheds the accumulated main-thread context, which is the single biggest token
lever: long sessions (>150k) are expensive even when cached. Each command tells you when its handoff is
safe to clear. If you'd rather stay in one session, `/compact` mid-task does the lighter version. (Claude
can't fire `/clear` itself — it's a client-side command; the pipeline just makes it always safe to type.)

### Run features in parallel — one session per feature

With `isolation.enabled`, every feature already gets its own worktree, ports, and database
(`scripts/new-feature.sh <id>` — slots tracked in `.worktrees/slots.tsv`). That isolation is exactly
what makes **parallel features** safe, and it's the real throughput multiplier when you're rate-limited:
while feature A's `/build` runs its agents (minutes of wall-clock you'd otherwise spend waiting), a
second Claude Code session can `/spec` or `/review` feature B.

The pattern:

```
session 1 (main checkout):   /spec feat-a → /build feat-a  (agents run…)
session 2 (main checkout):   /spec feat-b → /build feat-b  (agents run…)
session 1:                   /smoke feat-a → /review feat-a → /ship feat-a
session 2:                   /smoke feat-b → …
```

Rules that make it safe:

- **One feature per session.** All lead-side state is keyed by feature id on disk
  (`specs/<id>.md`, `<contract.path>/<id>.*`, `specs/reports/<id>*`), so sessions never share state —
  but a single session interleaving two features accumulates both in its context, paying for both.
- **Disjoint surfaces per feature are guaranteed** (each worktree is a full checkout), and each
  feature's DB/ports come from its slot — `/smoke` runs collide on neither.
- **The contract package is the one shared tree.** Two features editing
  `<contract.path>/<their-own-id>.<ext>` never conflict (one file per feature); merge order only
  matters if a later feature *imports* an earlier one's contract — ship the dependency first.
- `/ship` one at a time: it commits from the feature's branch and the freshness gate keeps a stale
  verdict from shipping; after each merge, rebase the other live worktrees (`git rebase main`) so
  their eventual reviews diff against reality.
- `/doctor` check 6 shows the live slot table (feature ↔ worktree ↔ ports) when you lose track.

## Privacy — opt-in telemetry

Cohorte can send **anonymous** usage pings (core version, OS, phase name, duration, per-surface
result counts, and a *hash* of the feature id — never repo names, paths, code, or IPs). It is
**strictly opt-in**: `/init-pipeline` asks once per machine, the default is No, and both answers are
recorded so you're never re-asked. Withdraw anytime (`telemetry.enabled: false` in
`~/.claude/cohorte.config.yaml`); erase your history anytime (`/doctor` prints your `install_id`,
the collector's `DELETE /v1/install/<id>` drops it). Full spec + GDPR details:
`profile/SCHEMA.md` §Telemetry; reference collector in `telemetry/`.

## License

[AGPL-3.0](LICENSE). Free to use, including commercially — but if you modify it and distribute it
or offer it as a network service, you must publish your modifications under the same license.

## Profile reference

See `profile/SCHEMA.md` for every field in `PIPELINE.md` and how the pipeline uses it.

## Layout of this repo

```
package.json            # npm package (cohorte) — semver source of truth
bin/cli.js              # the npm CLI: install / update / dashboard / version (cross-platform, no deps)
install.sh              # script installer (fresh + --update) for no-Node environments
install.ps1             # same installer for Windows PowerShell (fresh + -Update)
core/                   # copied verbatim into ~/.claude (global) or <project>/.claude (bundled)
  agents/               # implementer.template.md (rendered per surface) + review.md + release.md
  commands/             # init-pipeline + the workflow commands + /update-pipeline
  hooks/                # gate.py (destructive-command gate; branch-aware — git/docker free off the default branch)
  templates/            # handoff / brainstorm-return / design-brief / review-feedback / pr-body / spec
profile/
  PIPELINE.template.md  # the profile skeleton /init-pipeline fills
  SCHEMA.md             # field reference
  cohorte.config.template.yaml   # seeds ~/.claude/cohorte.config.yaml (kanban)
scripts/                # new-feature / remove-feature worktree-isolation templates
dashboard/              # local web cockpit (npx … dashboard) — see dashboard/README.md
  server/               # dependency-free node runtime (serves the built app + JSON/stream API)
  app/                  # Vite + React source (built to dashboard/dist/ at publish time)
```
