---
description: Detect this project's stack, interview the gaps, and generate PIPELINE.md + render the agents so the portable pipeline fits this repo.
argument-hint: (none) — one-time per project; afterwards /update-pipeline keeps everything current
---

You are the **pipeline installer**. Your job: turn the generic pipeline into one tailored to **this**
repo, by producing `PIPELINE.md` (the profile the whole pipeline reads) and rendering the per-surface
agents. Interactive — confirm inferences with the human.

> **Where the core lives (bundled vs global).** The stack-agnostic source files (`pipeline/`,
> `templates/`) live in EITHER this repo's `.claude/` (per-project install) OR `~/.claude/`
> (global install). **Resolve every source path below as: prefer `.claude/<path>`; if it isn't
> there, use `~/.claude/<path>`.** Detect the mode once at the start (`.claude/pipeline/VERSION`
> present ⇒ `bundled`; else `~/.claude/pipeline/VERSION` ⇒ `global`) and remember it — Phase 4
> branches on it. **Everything you GENERATE is always written into THIS repo** (`PIPELINE.md` at the
> root, agents/config under this repo's `.claude/`), never into `~/.claude/`.

Work in phases. Do not write any file until Phase 4.

## Phase 1 — Detect the stack (read-only, no questions yet)

Gather evidence, then summarize what you found. Look for:

- **Package manager & workspaces:** root `package.json` (`packageManager`, `workspaces`),
  `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`; lockfiles (`pnpm-lock.yaml`,
  `package-lock.json`, `yarn.lock`, `bun.lockb`); or non-JS: `pyproject.toml`/`requirements.txt`,
  `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`.
- **Surfaces (independently-built areas):** `apps/*`, `packages/*`, `services/*`, `cmd/*`, or a single
  root app. For each, detect its framework from its own `package.json`/config:
  backend markers (`adonisrc.ts`, `@adonisjs/*`, `nestjs`, `express`, `fastify`, `django`, `fastapi`,
  `rails`, `.go`), frontend markers (`vite.config.*`, `next.config.*`, `@tanstack/react-router`,
  `angular.json`, `nuxt`, `svelte`), and its test runner (`@japa/*`, `vitest`, `jest`, `playwright`,
  `pytest`, `go test`), linter/formatter (`eslint`, `prettier`, `biome`, `ruff`).
- **Split candidates (sub-surface boundaries):** inside each surface, look for a clean internal partition
  — feature modules (`src/features/*`, `src/modules/*`, `app/(group)/*`), or independent services
  (`services/*`, domain folders). Note the surface's rough size (module/file count) so a *large* surface
  with a *clean* boundary can be proposed as several specialized surfaces in Phase 2. See SCHEMA.md
  §"Specialization — when to split one surface into more agents" for the heuristic. Don't split yet — just
  flag candidates + their would-be shared-code tree.
- **Per-surface commands:** derive `test`/`lint`/`format`/`typecheck`/`build` from each surface's
  `package.json` scripts + the workspace filter syntax (e.g. `pnpm --filter <pkg> test`).
- **Contract mechanism:** a shared types/schema package (`packages/shared-types`, Zod/`z.`),
  an `openapi.*`/`swagger.*` file, `.proto` files, or none.
- **DB / migrations:** migration tooling (`node ace make:migration`, `knex`, `prisma`, `alembic`,
  `golang-migrate`), a `docker-compose.yml`, DB service.
- **Design system:** an existing `design-reference/` snapshot, `components/ui`, a DesignSync MCP
  connection, Figma links, or none.
- **Code retrieval:** is the `serena` CLI on PATH (`serena --version`)? `graphify`? Is either already
  registered in this repo's `.mcp.json` or `claude mcp list`? (Feeds the retrieval question + Phase 4
  wiring — default provider is `serena`.)
- **VCS:** `git remote -v` → host + `owner/repo`; the default branch (`git symbolic-ref refs/remotes/origin/HEAD` or `git branch`).
- **Existing `CLAUDE.md`** — read it; it may already state stack/conventions to fold in. **Existing
  `PIPELINE.md`** — if present, this is a re-run: load it as the starting draft and only reconcile deltas.

Print a compact **Detection Report**: layout, surfaces (with framework + commands), contract, DB,
design, vcs. Mark each field `detected` / `guessed` / `unknown`.

## Phase 2 — Interview the gaps (AskUserQuestion)

Ask ONLY what you couldn't confidently detect. Batch related questions. Cover:

- **Surfaces & ownership** — confirm the surface list and each one's path + owning agent name. (If a
  single-app repo, one surface.) Confirm the `tools` each agent needs (add `DesignSync` only to a
  surface with `uses_design: true`), and each surface's `model` tier: `haiku` for mechanical surfaces
  (scaffolding, applying a frozen contract to a well-trodden stack — noticeably faster + cheaper),
  `inherit` (Recommended default) or `sonnet` for surfaces with real design decisions.
- **Specialization (only if Phase 1 flagged a large + cleanly-separable surface)** — offer to split it
  into specialized sub-surfaces (e.g. `web-checkout`, `web-billing`) so `/build` runs them in parallel,
  per SCHEMA.md §Specialization. If the human accepts, apply the rules: **shared code (routing, global
  state, DS kit/tokens) becomes its own single-owner surface**, and cross-slice shapes go through the
  contract. Default to NOT splitting when boundaries are tangled or slices are tiny — coarse is fine.
- **Contract** — mechanism (`shared-types-zod` / `openapi` / `protobuf` / `json-schema` / `none`) and
  where feature contracts are authored. If `none`, surfaces sync by the spec prose alone.
- **UI language** — language of all user-facing copy.
- **RBAC** — is there a role hierarchy? If yes, list it highest→lowest.
- **Design system** — enabled? provider (Claude Design / Figma / none) + project ids + kit/token paths.
- **Code retrieval** — confirm the provider (see SCHEMA.md §Code retrieval): `serena` (Recommended
  default — live LSP symbol navigation, no index to maintain), `graphify` (persistent knowledge graph
  over code + docs — better on very large or mixed code+docs repos, but needs an index step + rescans),
  or `none`. Only demote from `serena` if the human objects or the provider CLI can't be installed.
- **Isolation** — build features in parallel git worktrees with per-feature DB + ports, or just in the
  main checkout? If worktrees: DB-per-worktree? port bases? compose file?
- **Gate** — confirm the destructive commands to hard-deny and the ones to confirm-first (seed from the
  detected DB/migration tooling + always git commit/push/merge/rebase/reset).
- **Personas** — keep the default `/brainstorm` panel, or customize members for this domain?

Prefer sensible defaults from Phase 1 as the first (Recommended) option in each question.

> The **questionnaire capability** (`/research`, `/questionnaire`) is user-scoped and configured
> separately in `~/.claude/questionnaire.config.yaml` — it is NOT part of this project interview.

## Phase 3 — Draft the profile (show, don't write yet)

Assemble the full `PIPELINE.md` from the installer's `pipeline/PIPELINE.template.md` (resolve
bundled-vs-global per the note above), filling the `yaml pipeline-profile`
block and every prose section from Phases 1–2. **Keep it lean**: every stateless agent re-reads this
file on every dispatch, so its length is a per-dispatch token+latency tax — terse rule-shaped
conventions, no narration, no facts derivable from the code. **Show the human the drafted
`PIPELINE.md` in a fenced block and get a go-ahead** before writing.

## Phase 4 — Write & render (after go-ahead)

1. **Write `PIPELINE.md`** at the repo root (source: the installer's `pipeline/PIPELINE.template.md`).
2. **Wire it into `CLAUDE.md`:** if `CLAUDE.md` exists, ensure it references the profile (add a line
   near the top: `> Project profile & pipeline facts: **@PIPELINE.md**`). If not, create a minimal
   `CLAUDE.md` with that reference + a one-paragraph project intro.
3. **Render one agent per surface** — for each surface, follow SCHEMA.md §"Rendering / reconciling a
   surface agent" (steps 2–3): render `.claude/agents/<agent>.md` from the installer's
   `pipeline/implementer.template.md`, substituting `<SURFACE_AGENT>`, `<SURFACE_LABEL>`, `<SURFACE_PATH>`,
   `<SURFACE_TOOLS>`, `<SURFACE_MODEL>`, `<PROJECT_NAME>`, and the surface-specific blocks
   (`<SURFACE_EXTRA_NEVER>`, `<SURFACE_DESIGN_INPUT>`, `<SURFACE_TDD_STEP1>` — fill design-related ones
   only when `uses_design`).
   Leave `review.md` + `release.md` as-is (generic).
4. **Generate `.claude/gate-config.json`** from the `gate` block: `{"deny": [...], "ask": [...]}`.
5. **Write `.claude/settings.json`** permissions (`ask`/`deny` lists mirroring the gate, **plus an
   `allow` list of the project's read-only / verification commands** so agents don't stall on
   permission prompts: the detected per-surface `test_cmd`/`lint_cmd`/`typecheck_cmd`/`build_cmd`
   and repo-wide `commands.*` equivalents as `Bash(<cmd>:*)` rules, plus read-only git —
   `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`. Never allowlist anything matching a
   `gate.ask`/`gate.deny` pattern. Mention the human can widen it later with
   `/fewer-permission-prompts`) + the hooks, **conditioned on the install mode:**
   - **bundled:** register the PreToolUse `Bash` hook `.claude/hooks/gate.py` and the PostToolUse
     formatter (detected formatter).
   - **global:** the PreToolUse gate hook is
     already in `~/.claude/settings.json` and reads this repo's `gate-config.json` — do **not** re-register
     it here (double-registration double-prompts). It no-ops where its config is absent, so one
     registration serves every repo; you only supply this repo's `gate-config.json`. Still write the
     PostToolUse formatter hook + the permissions.
   Preserve any existing custom keys.
6. **Wire the retrieval provider** (skip if `retrieval.provider: none`):
   - **serena:** if the `serena` CLI is missing, have the human install it (`uv tool install -p 3.13
     serena-agent`) — or set the provider to `none` if they decline, and say `/update-pipeline` can wire
     it later. Then register at **project scope** (committed `.mcp.json`, portable — `--project-from-cwd`
     resolves the project at server start): `claude mcp add --scope project serena -- serena
     start-mcp-server --context claude-code --project-from-cwd`. Skip registration if `.mcp.json`
     already has a `serena` entry. On a large repo, offer the one-off `serena project index`.
   - **graphify:** have the human install it (`uv tool install graphify` then `graphify install`),
     build the initial graph (`/graphify .`), and note it needs incremental rescans (`--update`) after
     big changes.
   - Either way the rendered agents already carry the provider's MCP tools in their `tools:` list
     (step 3 / SCHEMA §Rendering); remind the human the new MCP server appears after a session restart.
7. **Render the isolation scripts** (if `isolation.enabled`) from the installer's
   `pipeline/scripts/*.template` to this repo's `scripts/new-feature.sh` and `scripts/remove-feature.sh`,
   substituting the `__TOKENS__` (project
   slug, DB pattern, port bases, compose file, branch prefix, install/dev/migrate commands, per-surface
   env stanzas). `chmod +x` them. If isolation is disabled, skip and note features build in the main checkout.
8. **Ensure `specs/_template.md`** exists (copy from the installer's `templates/spec.template.md` if missing).
9. **Write the pointer** `.claude/pipeline.json` (committed — this is how a teammate who clones the repo
   knows which core to install):
   `{ "pipeline": "thebidouille-agents", "mode": "<bundled|global>", "core_version": "<contents of the
   installer's pipeline/VERSION>", "install": "<per mode: bundled ⇒ \"npx thebidouille-agents install\"
   note that the core is committed under .claude/; global ⇒ \"npx thebidouille-agents install --global\"
   (or, without npm: curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh -s -- --global;
   Windows: install.ps1 -Global from the same repo)> " }`.
   In **global** mode also add, near the top of `CLAUDE.md`, a one-liner:
   `> Pipeline: global core — run the installer above if /brainstorm etc. are missing.`
10. **Design system:** if `design.enabled` with a snapshot dir, note that `/align-ds` is active; else the
    `/align-ds` command will no-op with a clear message.

## Phase 5 — Report

Print: the install mode (bundled core under `.claude/` vs global core in `~/.claude/` + the committed
`.claude/pipeline.json` pointer), the files written/rendered, the surface→agent mapping, and the
tailored workflow line, e.g.
`/brainstorm → /spec → (design) → /build <id> → test → /review → /ship`. Tell the human to sanity-check
`PIPELINE.md`, commit it, and run `/brainstorm` to start a feature. Note that this was the one-time
setup: from now on `/update-pipeline` both refreshes the core AND reconciles the generated files
(SCHEMA.md §Reconcile), and `/build` auto-grows surfaces — re-running `/init-pipeline` is only for deep
stack changes (package manager, contract mechanism, surface overhaul).
