---
description: Detect this project's stack, interview the gaps, and generate PIPELINE.md + render the agents so the portable pipeline fits this repo.
argument-hint: (none) — run once per project, re-run to refresh the profile
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
- **Per-surface commands:** derive `test`/`lint`/`format`/`typecheck`/`build` from each surface's
  `package.json` scripts + the workspace filter syntax (e.g. `pnpm --filter <pkg> test`).
- **Contract mechanism:** a shared types/schema package (`packages/shared-types`, Zod/`z.`),
  an `openapi.*`/`swagger.*` file, `.proto` files, or none.
- **DB / migrations:** migration tooling (`node ace make:migration`, `knex`, `prisma`, `alembic`,
  `golang-migrate`), a `docker-compose.yml`, DB service.
- **Design system:** an existing `design-reference/` snapshot, `components/ui`, a DesignSync MCP
  connection, Figma links, or none.
- **VCS:** `git remote -v` → host + `owner/repo`; the default branch (`git symbolic-ref refs/remotes/origin/HEAD` or `git branch`).
- **Existing `CLAUDE.md`** — read it; it may already state stack/conventions to fold in. **Existing
  `PIPELINE.md`** — if present, this is a re-run: load it as the starting draft and only reconcile deltas.

Print a compact **Detection Report**: layout, surfaces (with framework + commands), contract, DB,
design, vcs. Mark each field `detected` / `guessed` / `unknown`.

## Phase 2 — Interview the gaps (AskUserQuestion)

Ask ONLY what you couldn't confidently detect. Batch related questions. Cover:

- **Surfaces & ownership** — confirm the surface list and each one's path + owning agent name. (If a
  single-app repo, one surface.) Confirm the `tools` each agent needs (add `DesignSync` only to a
  surface with `uses_design: true`).
- **Contract** — mechanism (`shared-types-zod` / `openapi` / `protobuf` / `json-schema` / `none`) and
  where feature contracts are authored. If `none`, surfaces sync by the spec prose alone.
- **UI language** — language of all user-facing copy.
- **RBAC** — is there a role hierarchy? If yes, list it highest→lowest.
- **Design system** — enabled? provider (Claude Design / Figma / none) + project ids + kit/token paths.
- **Isolation** — build features in parallel git worktrees with per-feature DB + ports, or just in the
  main checkout? If worktrees: DB-per-worktree? port bases? compose file?
- **Gate** — confirm the destructive commands to hard-deny and the ones to confirm-first (seed from the
  detected DB/migration tooling + always git commit/push/merge/rebase/reset).
- **Personas** — keep the default `/brainstorm` panel, or customize members for this domain?

Prefer sensible defaults from Phase 1 as the first (Recommended) option in each question.

## Phase 3 — Draft the profile (show, don't write yet)

Assemble the full `PIPELINE.md` from the installer's `pipeline/PIPELINE.template.md` (resolve
bundled-vs-global per the note above), filling the `yaml pipeline-profile`
block and every prose section from Phases 1–2. **Show the human the drafted `PIPELINE.md` in a fenced
block and get a go-ahead** before writing.

## Phase 4 — Write & render (after go-ahead)

1. **Write `PIPELINE.md`** at the repo root (source: the installer's `pipeline/PIPELINE.template.md`).
2. **Wire it into `CLAUDE.md`:** if `CLAUDE.md` exists, ensure it references the profile (add a line
   near the top: `> Project profile & pipeline facts: **@PIPELINE.md**`). If not, create a minimal
   `CLAUDE.md` with that reference + a one-paragraph project intro.
3. **Render one agent per surface** from the installer's `pipeline/implementer.template.md` →
   this repo's `.claude/agents/<agent>.md`, substituting `<SURFACE_AGENT>`, `<SURFACE_LABEL>`, `<SURFACE_PATH>`,
   `<SURFACE_TOOLS>`, `<PROJECT_NAME>`, and the surface-specific blocks (`<SURFACE_EXTRA_NEVER>`,
   `<SURFACE_DESIGN_INPUT>`, `<SURFACE_TDD_STEP1>` — fill design-related ones only when `uses_design`).
   Leave `review.md` + `release.md` as-is (generic).
4. **Generate `.claude/gate-config.json`** from the `gate` block: `{"deny": [...], "ask": [...]}`.
5. **Write `.claude/settings.json`** permissions (`ask`/`deny` lists mirroring the gate) + the hooks,
   **conditioned on the install mode:**
   - **bundled:** register both hooks — PreToolUse `.claude/hooks/gate.py` and the PostToolUse formatter
     (detected formatter).
   - **global:** the PreToolUse gate hook is already registered once in `~/.claude/settings.json` and
     reads this repo's `gate-config.json` — do **not** re-register it here (double-registration
     double-prompts). Still write the PostToolUse formatter hook + the permissions.
   Preserve any existing custom keys.
6. **Render the isolation scripts** (if `isolation.enabled`) from the installer's
   `pipeline/scripts/*.template` to this repo's `scripts/new-feature.sh` and `scripts/remove-feature.sh`,
   substituting the `__TOKENS__` (project
   slug, DB pattern, port bases, compose file, branch prefix, install/dev/migrate commands, per-surface
   env stanzas). `chmod +x` them. If isolation is disabled, skip and note features build in the main checkout.
7. **Ensure `specs/_template.md`** exists (copy from the installer's `templates/spec.template.md` if missing).
8. **Write the pointer** `.claude/pipeline.json` (committed — this is how a teammate who clones the repo
   knows which core to install):
   `{ "pipeline": "thebidouille-agents", "mode": "<bundled|global>", "core_version": "<contents of the
   installer's pipeline/VERSION>", "install": "<per mode: bundled ⇒ \"sh install.sh\" note that the core
   is committed under .claude/; global ⇒ \"curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh -s -- --global\"> " }`.
   In **global** mode also add, near the top of `CLAUDE.md`, a one-liner:
   `> Pipeline: global core — run the installer above if /brainstorm etc. are missing.`
9. **Design system:** if `design.enabled` with a snapshot dir, note that `/align-ds` is active; else the
   `/align-ds` command will no-op with a clear message.

## Phase 5 — Report

Print: the install mode (bundled core under `.claude/` vs global core in `~/.claude/` + the committed
`.claude/pipeline.json` pointer), the files written/rendered, the surface→agent mapping, and the
tailored workflow line, e.g.
`/brainstorm → /spec → (design) → /build <id> → test → /review → /ship`. Tell the human to sanity-check
`PIPELINE.md`, commit it, and run `/brainstorm` to start a feature. Note they can re-run `/init-pipeline`
any time to refresh the profile after a stack change.
