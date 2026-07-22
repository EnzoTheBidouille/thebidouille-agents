# PIPELINE.md profile — field reference

`/init-pipeline` fills the `yaml pipeline-profile` block in `PIPELINE.md` (from
`PIPELINE.template.md`) plus the prose sections. This documents every field and how the
generic pipeline uses it, so a stateless agent can read/regenerate the profile correctly.

## `yaml pipeline-profile` block

| Field                                | Type         | Used by                           | Meaning                                                       |
| ------------------------------------ | ------------ | --------------------------------- | ------------------------------------------------------------- |
| `name`                               | string       | all                               | Project name, used in agent prose + commit scopes.            |
| `one_liner`                          | string       | brainstorm/spec                   | One-sentence product description.                             |
| `ui_language`                        | string       | implementer, review               | Language of ALL user-facing copy.                             |
| `package_manager`                    | enum         | all                               | `pnpm`/`npm`/`yarn`/`bun`/`pip`/`cargo`/`go`.                 |
| `vcs.host`                           | enum         | release                           | `github`→use `gh`; else emit compare URL.                     |
| `vcs.remote`                         | string       | release                           | `owner/repo` for the PR/compare URL.                          |
| `vcs.default_branch`                 | string       | build, review, release            | Base branch for diffs + PRs.                                  |
| `vcs.feature_branch_prefix`          | string       | ship, isolation script            | `feature/` → branch `feature/<id>`.                           |
| `repo.layout`                        | enum         | build, audit                      | `monorepo` (many surfaces) or `single`.                       |
| `repo.workspace_tool`                | enum         | audit                             | `turborepo`/`nx`/`none`.                                      |
| `retrieval.provider`                 | enum         | init, update-pipeline, implementer | `serena` (default) / `graphify` / `none` — see §Code retrieval. |
| **`surfaces[]`**                     | list         | **build, review, refactor, init** | One per independently-built area. Grows via reconcile (below). |
| `surfaces[].key`                     | string       | build                             | Short id + review scope.                                      |
| `surfaces[].path`                    | string       | implementer                       | The ONLY tree that surface's agent may touch.                 |
| `surfaces[].label`                   | string       | build, init (`<SURFACE_LABEL>`)   | Human label + framework, e.g. `frontend (React)`.            |
| `surfaces[].agent`                   | string       | build (`subagent_type`)           | Rendered agent file name.                                     |
| `surfaces[].tools`                   | list         | init                              | Frontmatter `tools:` for the rendered agent.                  |
| `surfaces[].model`                   | enum         | init (`<SURFACE_MODEL>`)          | Frontmatter `model:` tier — `inherit`/`sonnet`/`haiku`. `haiku` for mechanical surfaces; default `inherit`. |
| `surfaces[].*_cmd`                   | string       | implementer                       | test/lint/format/typecheck/build commands.                    |
| `surfaces[].uses_design`             | bool         | build, frontend                   | Whether this surface consumes designs.                        |
| `contract.enabled`                   | bool         | build                             | `false` ⇒ skip contract authoring (§2 of /build).             |
| `contract.mechanism`                 | enum         | build, lead                       | `shared-types-zod`/`openapi`/`protobuf`/`json-schema`/`none`. |
| `contract.path` `.ext` `.index`      | string       | build                             | Where `<feature_id>` contract is authored + barrel.           |
| `contract.authored_by`               | const `lead` | build                             | Implementers import it read-only, never edit.                 |
| `commands.*`                         | string       | all                               | Repo-wide install/dev/lint/format/typecheck/test + migrate.   |
| `rbac.enabled`                       | bool         | brainstorm, review                | Toggle RBAC personas + authz audit.                           |
| `rbac.hierarchy`                     | list         | review                            | Highest→lowest role list.                                     |
| `design.enabled`                     | bool         | build, frontend, align-ds         | `false` ⇒ design steps are no-ops.                            |
| `design.provider`                    | enum         | frontend, align-ds                | `claude-design`/`figma`/`none`.                               |
| `design.design_system_project`       | id           | align-ds, frontend                | UI-kit source of truth.                                       |
| `design.design_project`              | id           | build, frontend                   | Fallback project for per-feature screens; a full link in spec `design_files` wins. |
| `design.snapshot_dir`                | path         | align-ds                          | Committed DS snapshot for diffing.                            |
| `design.ui_kit_path` `.tokens_path`  | path         | align-ds, frontend                | Where the kit + tokens live in code.                          |
| `isolation.enabled`                  | bool         | new-feature script                | `false` ⇒ build in main checkout.                             |
| `isolation.db_per_worktree`          | bool         | new-feature script                | Create `<name>_<id>` DB per worktree.                         |
| `isolation.db_name_pattern`          | string       | new-feature script                | `<name>_<id>`.                                                |
| `isolation.port_base`                | map          | new-feature script                | `api`/`web` base ports; +slot per worktree.                   |
| `isolation.compose_file` `.registry` | path         | new-feature script                | Docker stack + slot registry.                                 |
| `gate.deny[]`                        | list         | hooks/gate.py, settings           | Command substrings hard-denied.                               |
| `gate.ask[]`                         | list         | hooks/gate.py, settings           | Command substrings that require confirm.                      |

## Prose sections

- **Conventions** — per-surface rules the implementer follows and review audits.
- **Testing** — the TDD contract per surface (what a test must cover, DB isolation).
- **Design brief note** — feeds `/spec` §8 and the Claude Design step.
- **Personas** — the `/brainstorm` panel; include one per RBAC role when `rbac.enabled`.

## How the pieces reference this file

- **Agents** (`implementer`, `review`, `release`) are told at dispatch: _read `PIPELINE.md`
  §Commands / §Conventions / §Surfaces first._ They have `Read`, so they load it live.
- **Commands** (`/build`, `/review`, …) parse the `yaml pipeline-profile` block to know how
  many surfaces to dispatch, the contract mechanism, the commands, and the capability flags.
- **Hook** (`gate.py`) reads `gate.deny`/`gate.ask` from a generated `.claude/gate-config.json`.
- **Scripts** (`new-feature.sh`) read the `isolation` block (rendered in at init).

## Code retrieval — `retrieval.provider`

Agents spend most of their wall-clock reading the repo; a retrieval provider replaces grep-and-read
with symbol/graph queries. The flag is a **value, not a boolean**, so switching provider later is a
one-line profile change + re-running the wiring (no agent re-render needed — the guidance agents
follow is provider-agnostic: _"prefer the retrieval MCP tools over Grep/Glob + whole-file Reads"_).

| Provider | Mechanism | Freshness | Cost |
| --- | --- | --- | --- |
| `serena` (default) | live LSP symbol navigation (find symbol, references, semantic edits) | always current | none — no index |
| `graphify` | persistent tree-sitter knowledge graph over code + docs | as fresh as the last rescan | index step + re-index discipline |
| `none` | agents fall back to Grep/Glob/Read | — | — |

**Wiring (done by `/init-pipeline`, or `/update-pipeline` retroactively):**

- `serena` — requires the `serena` CLI (`uv tool install -p 3.13 serena-agent`). For day-to-day CLI
  use it should also be on PATH (`uv tool update-shell`; uv installs to `~/.local/bin`). Register at
  **project scope** so the registration is committed and portable (`--project-from-cwd` resolves the
  project at server start, so the committed entry works on every machine) — and register the
  **PATH-proof launcher**, not the bare command: Claude Code spawns MCP servers with whatever
  environment it was launched from (a stale terminal, a GUI/IDE launch that never sourced a shell
  profile), where `~/.local/bin` may be missing from PATH — a bare `serena` entry then dies with
  ENOENT and agents silently fall back to Grep/Read:

  ```sh
  claude mcp add --scope project serena -- sh -c 'exec "$(command -v serena || echo "$HOME/.local/bin/serena")" start-mcp-server --context claude-code --project-from-cwd --open-web-dashboard False'
  ```

  (Windows-native teams: no `sh` — register the bare `serena` form instead and ensure the uv tools
  dir is on PATH; keep the `--open-web-dashboard False` flag.) `--open-web-dashboard False` keeps the
  dashboard available (reachable at `http://localhost:24282/dashboard/`) but stops it popping a browser
  tab on every server start — the flag overrides the machine's `serena_config.yml`, so the behaviour is
  the same for everyone on the repo. Gitignore `.serena/` (per-machine cache/config). Optionally
  pre-index large repos once: `serena project index`.
- `graphify` — requires `uv tool install graphify` + `graphify install`; build the initial graph
  (`/graphify .`) and rescan incrementally after big changes (`--update`). See graphify.net.
- Rendered agents get the provider's MCP tools appended to their `tools:` list (e.g. `mcp__serena`
  grants the whole server); `none` ⇒ nothing appended.

**Serena health check** — run after wiring in `/init-pipeline` AND on every `/update-pipeline`
reconcile (wiring that worked once can rot: PATH changes, tool uninstalled, entry hand-edited):

1. **CLI resolves:** `command -v serena`. Fails but `~/.local/bin/serena` exists ⇒ PATH repair
   above; missing entirely ⇒ reinstall.
2. **Registered:** this repo's `.mcp.json` has the `serena` entry ⇒ else re-run the `claude mcp add`.
   If the entry is the bare `serena` form on a POSIX machine, upgrade it to the PATH-proof launcher
   above (immune to launch-environment PATH gaps). If a launcher entry predates the
   `--open-web-dashboard False` flag, append it so the dashboard no longer auto-opens a browser tab.
3. **Gitignored:** `.serena/` is in `.gitignore` ⇒ else append it.
4. **Actually connected:** the `mcp__serena` tools are exposed in the session (or `claude mcp list`
   shows serena connected). If 1–3 pass but this fails, a session restart is needed — say so
   explicitly instead of reporting success.

Report each check's result; never report Serena "wired" on registration alone.

Teammates cloning the repo get the committed `.mcp.json` and only need the provider CLI installed
and on PATH — if either is missing, the MCP server fails to start and agents silently fall back to
Grep/Read; the health check above is the diagnostic.

## Specialization — when to split one surface into more agents

`/build` dispatches ONE agent per surface, in parallel, so build wall-clock ≈ the **slowest single
surface**. More agents only build faster when they let the *slowest* surface's work run concurrently —
and only if the split is safe. The invariant that keeps parallelism safe is **one owner per tree, and
the frozen contract as the only cross-surface channel**. So specialization means carving a surface into
**smaller non-overlapping surfaces**, never pointing two agents at the same tree.

**Split a surface into specialized sub-surfaces only when BOTH hold:**

1. **It's a bottleneck** — the surface is large (many modules / high LOC) and dominates build time.
2. **The boundary is clean** — its work partitions into trees that don't share files, e.g. feature
   modules (`src/features/*`, `src/modules/*`), route groups, or independent services (`services/*`).

**Rules when splitting (non-negotiable — they preserve the invariant):**

- **Shared code gets its own surface with a single owner.** Anything two slices both touch — routing,
  global state/store, the design-system kit + tokens, shared utils — becomes its OWN surface (e.g.
  `web-shared`), owned by exactly one agent. Never let two feature-slice agents both edit shared trees.
- **Cross-slice references go through the contract**, not direct imports between slice trees. If
  `web-checkout` needs a shape produced by `api-billing`, that shape lives in the frozen contract.
- **Don't over-split.** A slice too small to hold ≥1 real task, or one with tangled boundaries, is worse
  than not splitting — the coordination + token cost (each stateless agent re-reads `PIPELINE.md` + spec)
  outweighs the parallelism. When boundaries aren't clean, keep one surface.

Coarse first, specialize on evidence: start with one `frontend` / `backend` surface each; split only a
surface that's proven slow and cleanly separable. The evidence lives in
`.claude/pipeline-metrics.jsonl` (gitignored) — one JSONL line per dispatched agent
(`ts`/`feature`/`phase`/`surface`/`seconds`/`result`), appended by `/build`, `/review`, `/fix` and
`/smoke`. Read it before proposing a split: split the surface that actually dominates wall-clock,
not the one that feels big.

## Rendering / reconciling a surface agent (shared procedure)

Both `/init-pipeline` (initial render) and `/build` (auto-reconcile when a spec needs a new agent) use
this exact procedure so a surface is always defined the same way. To add surface `S`:

1. **Add the `surfaces[]` entry** to `PIPELINE.md`: `key`, `path` (the disjoint tree it exclusively
   owns), `label`, `agent` (rendered file name), `tools` (add `DesignSync` only if `uses_design: true`;
   append the retrieval provider's MCP tools when `retrieval.provider` ≠ `none` — e.g. `mcp__serena`),
   `model` (tier for the rendered agent: `haiku` when the surface's work is mechanical — scaffolding,
   applying a frozen contract to a well-trodden stack; `inherit` (default) or `sonnet` when it makes
   real design decisions), the five `*_cmd`s (derive from the surface's `package.json` / workspace
   filter, mirroring a sibling surface), and `uses_design`.
2. **Render the agent file** `.claude/agents/<agent>.md` from `pipeline/implementer.template.md`
   (resolve bundled `.claude/` vs global `~/.claude/`), substituting `<SURFACE_AGENT>`, `<SURFACE_LABEL>`,
   `<SURFACE_PATH>`, `<SURFACE_TOOLS>`, `<SURFACE_MODEL>`, `<PROJECT_NAME>`, and the surface-specific
   blocks (`<SURFACE_EXTRA_NEVER>`, `<SURFACE_DESIGN_INPUT>`, `<SURFACE_TDD_STEP1>` — fill the design
   ones only when `uses_design`).
3. **Add a §Conventions + §Testing stanza** for `S` in `PIPELINE.md` (mirror a sibling surface; keep it
   rule-shaped). If `S` is a shared-code surface, its convention is "single owner of shared X; slices
   consume, never redefine."

Removing/merging a surface is the reverse: drop the `surfaces[]` entry, delete its agent file, fold its
conventions. Never leave an agent file with no matching `surfaces[]` entry (orphan) or vice-versa.

## Reconcile — bringing generated files up to the current core

`/init-pipeline` is **one-time per project**. Afterwards, `/update-pipeline` runs this procedure so a
core upgrade never requires re-running init — new pipeline features flow into the repo's generated
files automatically. It works because every generated artifact is a **deterministic function of
(current template × the profile's data)**; nothing needs re-detecting or re-interviewing.

1. **Profile top-up.** Diff `PIPELINE.md`'s machine block against the current
   `pipeline/PIPELINE.template.md`: every block/field the template has and the profile lacks is added
   with its documented default (e.g. `surfaces[].model: inherit`, `retrieval.provider: serena`).
   **Ask only when a new field is a genuine human decision** (batch into ONE question set); never
   change a value the profile already sets; never rewrite the prose sections.
2. **Re-render agent frontmatter + body.** For each `surfaces[]` entry, re-render
   `.claude/agents/<agent>.md` from the current `implementer.template.md` per §Rendering above. Safe by
   doctrine: rendered agents are regenerable artifacts — hand-written rules belong in `PIPELINE.md`
   §Conventions (which reconcile never touches), NOT in agent files, where they'd be clobbered here.
3. **Additive settings patch.** Bring `.claude/settings.json` + `gate-config.json` up to the current
   init spec (missing `allow` entries, hooks per install mode) — add what's missing, never remove or
   rewrite existing/custom keys.
4. **Capability wiring.** If a top-up added a capability needing external setup (e.g. a `retrieval`
   provider whose MCP server isn't registered yet), run its wiring step from `/init-pipeline` Phase 4.
   Even when nothing new was added, re-run the provider's health check (§Code retrieval) — wiring
   rots (PATH changes, uninstalls, hand-edits) — and repair whatever fails.

Re-running `/init-pipeline` remains possible (it reconciles too) but is only *needed* when the stack
itself changes in ways `/build` §1.5 can't auto-grow (e.g. package manager or contract mechanism swap).

## Global capability — research → (optional) questionnaire

A **user-scoped** track, separate from the dev flow and NOT configured in `PIPELINE.md`. Its facts live
in **`~/.claude/questionnaire.config.yaml`** (template: `profile/questionnaire.config.template.yaml`,
seeded by the installer, never clobbered on update). **Nothing is stored locally: each run lives
entirely as a page in the Notion database**, which is **auto-created on the first `/research`**.

| Field                   | Used by                   | Meaning                                                         |
| ----------------------- | ------------------------- | --------------------------------------------------------------- |
| `enabled`               | /research, /questionnaire | `false`/absent ⇒ both commands refuse cleanly.                  |
| `notion_database_id`    | /research, /questionnaire | The archive database. Empty ⇒ auto-created on first run, id written back. |
| `notion_parent_page_id` | /research (setup)         | Optional parent page for the auto-created database.             |
| `engine_format`         | writer, validator         | Label of the user's target survey-engine format.                |
| `ui_language`           | researcher, writer        | Language of the reports + all questionnaire labels.             |

- `/research <pdf-url-or-path> [subject]` → dispatches `questionnaire-researcher` (**mode research**,
  read-only): produces a **standalone research report** (state of the art, domain analysis, debates,
  licences, open questions, sources) — genuine research, not questionnaire-shaped. A **local file**
  source is read via the Read tool (no internet dependency) and attached to the page for provenance; a
  URL goes through WebFetch. The report becomes a Notion page (Statut « Recherche ») **under human
  confirmation**. No local artifact.
- `/questionnaire <run-id-or-url>` → the OPTIONAL derivation, only if the human wants a survey: loads
  the research from its Notion page, dispatches `questionnaire-researcher` (**mode blueprint** — derives
  the conceptual skeleton from the report), then `questionnaire-writer` and `questionnaire-validator`
  (both stateless, no tools; JSON inlined so the writer never sees the source or the report), loops
  max 3, and **completes the same Notion page** (blueprint + questionnaire + verdict appended, Statut →
  « À relire »/« Bloqué ») **under human confirmation**. Frozen contracts:
  `templates/questionnaire-{domain-brief,blueprint,declaration,verdict}.md`.

Guarantees the workflow preserves: researcher analyses/structures but never drafts items; writer drafts
original Likert-5 items but never sees the source; nothing is interpreted (no thresholds/levels); agents
are read-only, the orchestrator does all Notion writes, each write is confirmation-gated; nothing enters
the survey engine until the human flips the page's Statut to « Approuvé ».
