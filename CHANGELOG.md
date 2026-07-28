# Changelog

Entries are shown by `/update-pipeline` ("What's new") after a core refresh. Keep them short,
user-facing, most recent first. One `## <version> — <YYYY-MM-DD>` section per release.

## 0.1.27 — 2026-07-28

- **README gains a Prerequisites section.** Spells out what a new machine actually needs: Node ≥ 18 + npm
  (the only hard requirement, for the `npx` installer) versus `uv` + the Serena CLI (optional, the default
  retrieval provider — installed separately, independent of the `npx` core install, order irrelevant, and
  the pipeline still runs without it by falling back to Grep/Read). Also documents the cloned-repo case
  (Serena registration travels in the committed `.mcp.json`; just install the CLI + restart + `/doctor`).
  The mechanics were already in `SCHEMA.md` §Code retrieval, but not in the human-facing onboarding doc.

## 0.1.26 — 2026-07-28

- **The design step now references designs by full link, not a stored project id + bare filename.** A
  `design_files` entry is a self-contained `https://claude.ai/design/p/<projectId>?file=<file>` link that
  carries its own project (`/p/<projectId>`) and page (`?file=`); agents extract both and read it via
  `DesignSync get_file(<projectId>, <file>)`. No stored `design_project` id means a design-system rebuild
  (which mints a new project id) no longer breaks every spec — you just paste the new links. `design_project`
  becomes an optional legacy fallback (default `none`) for old bare-filename specs. Updated across `/build`
  (design gate + dispatch), `/smoke`, `/spec` + the spec template, `PIPELINE.md` (§design + conventions),
  `SCHEMA.md`, and `/doctor`. Crucially, the surface-agent render step now specifies the link-based
  `<SURFACE_DESIGN_INPUT>`/`<SURFACE_TDD_STEP1>` — so `/update-pipeline` re-renders design agents to resolve
  from the link instead of the stale `get_file(design_project, <file>)`. Existing specs keep their bare
  filenames until you replace them with links.

## 0.1.25 — 2026-07-27

- **`research-agent` defaults to `sonnet`** instead of silently inheriting the session model (Opus). Its
  work — MAP / ANALYSE / SYNTHESISE of pre-extracted text — is extraction-and-summary that Sonnet handles
  well at a fraction of the cost, and `/cost` showed it was one of the two heaviest subagents. The fixed
  agents were never tiered like the surfaces; this closes the biggest gap. If cross-cutting synthesis ever
  needs more, the `/research` SYNTHESISE dispatch can override the model for just that pass.
- **README documents the `/clear`-safe loop** as the top token lever — since all pipeline state lives on
  disk, `/clear`-ing between stages sheds the accumulated main-thread context (long >150k sessions are
  expensive even cached), with the safe-to-clear boundary shown for the whole `/spec → … → /ship` loop.

## 0.1.24 — 2026-07-27

- **The dev loop is now `/clear`-safe between every stage.** All pipeline state already lives on disk
  (spec, contract, diff, Remediation checkboxes, freshness stamp), so you can `/clear` between commands
  to shed the accumulated main-thread context and cut token cost — each command reloads everything from
  disk. Every command now marks its handoff as safe to `/clear` before the next step.
- **`/review` and `/smoke` stage their report to `specs/reports/<id>.md`** (a gitignored buffer in its own
  subfolder, like `specs/design/`) — the one context-coupling that a `/clear` used to break. `/fix` and
  `/spec` Mode B read the report back from disk when the context was cleared. `/init-pipeline` gitignores
  the buffer; `/doctor` reports it. The non-recursive `specs/*.md` glob skips the subfolder, so it never
  shows up as a phantom kanban card or spec.

## 0.1.23 — 2026-07-26

- **Cheaper dev loop by default — implementers now default to `sonnet`, not the Opus lead.** A surface
  agent mostly applies a frozen contract, which Sonnet handles well at a fraction of the cost;
  `/init-pipeline` and reconcile now default `surfaces[].model` to `sonnet`, keeping `haiku` for purely
  mechanical scaffolding and `inherit` only for surfaces with real design decisions. The fixed `release`
  and `questionnaire-validator` agents drop to `haiku`, `questionnaire-writer` to `sonnet`. Existing
  projects pick this up on the next `/update-pipeline` (agents re-render; a `model` you set by hand is kept).
- **Stateless agents read a *slice* of `PIPELINE.md`, not the whole file.** The implementer and reviewer
  now load the machine block + only the `### Shared` and their own `### Surface:` convention stanza
  (+ §Testing), never the other surfaces' prose — less context re-read on every parallel dispatch.
- **Leaner fix loops.** On a `/fix` re-dispatch, a surface agent works from the self-contained open
  Remediation items + the diff and reads only the files those findings name — no longer re-reading the
  whole (growing) spec or re-exploring its tree.
- **Freshness gate at `/ship`.** `/review` now fingerprints the reviewed source (`reviewed_base` +
  `reviewed_digest` in the spec front-matter) at a SHIP verdict, and `/ship` re-checks it — refusing to
  ship if any source or contract file changed after the review, so a verdict can't go stale unnoticed.
  Specs are excluded (DoD ticks + the ship status flip don't trip it); a spec predating the gate skips it.
- **Big commands lazy-load their steps (progressive disclosure).** `/init-pipeline`, `/research` and
  `/questionnaire` are now thin routers (a bootstrap block + a steps table) that read each step from
  `templates/steps/<command>/NN-*.md` as they reach it, instead of one monolithic body — the branchy
  commands (esp. `/research`) no longer pull an unused branch into context. Pure re-partition, verified
  token-for-token identical to the old bodies. No installer change (steps ride the existing `templates/` copy).
- **Machine-checkable postconditions on the two silent-failure gates** — `/spec` freeze asserts
  `status: frozen` actually landed; `/build` asserts the contract file exists before dispatching agents.
- **`/review` lets git group the diff by surface** (`git diff --name-only -- <path>` + an `:(exclude)`
  remainder) instead of the lead reasoning it out file by file — deterministic and cheaper.
- **`/fix` collapses fully-resolved Remediation rounds** to a one-line summary, so the spec every agent
  re-reads stops growing unbounded across fix loops (rounds with any open item stay expanded).
- **New SCHEMA § "Measuring cost"** — documents `/cost` (built-in per-subagent + per-command usage share)
  and the OTEL `settings.json` env block (`claude_code.token.usage` / `cost.usage`) for exact numbers.

## 0.1.22 — 2026-07-26

- **`/spec` exports a standalone design brief** — for a UI feature, freezing the spec now also writes
  §8 (the "spec return") to its own `specs/design/<id>.md`, in addition to printing the copy-paste
  block. One `.md` you can open, share, or drop straight into the design tool instead of scrolling back
  through the chat — regenerated on every freeze so it never drifts from the spec. Lives in the
  `specs/design/` subfolder on purpose, so the non-recursive `specs/*.md` glob (kanban backfill,
  `/doctor`) never mistakes it for a spec. Backend-only features are unaffected.

## 0.1.21 — 2026-07-24

- **Reliable local-PDF reading for `/research`** — subagent nodes often lack a PDF renderer (no
  poppler), which made research-agents silently fall back to a web copy of the document — fine for a
  public PDF, a silent fabrication risk for a private one. `/research` now **extracts the PDF to
  per-page text ONCE up front** (pure-Python `pypdf` in a throwaway venv — no system deps) and agents
  read that text, never the binary PDF. A local read that fails now returns a loud `===READ-FAILED===`
  instead of reconstructing from the web; the orchestrator re-extracts or surfaces it. Adds a
  scanned-PDF guard (no text layer ⇒ stop, needs OCR).

## 0.1.20 — 2026-07-24

- **`/fix` now checks off resolved Remediation items** — the lead flips `- [ ]` → `- [x]` (with a
  short "fixed" note) for every item the surface agents report addressed in their handoff, and skips
  already-`[x]` items when scoping the re-dispatch. Fixes two long-standing quirks: a spec whose
  Remediation looked permanently open even after fixes landed, and a later `/fix` re-sending
  already-fixed items from earlier rounds to the agents.
- **`/review` now ticks the §9 DoD at a SHIP verdict** — a SHIP verdict is the pipeline's statement
  that the feature is done, so the lead checks off each Acceptance-criteria item its verifying stage
  actually covered (conformance/copy = review, tests/lint/types = build, mobile-first/runtime = smoke),
  leaving open any whose stage didn't run. `/ship` gains a matching gate: it lists any still-open DoD
  item and asks before shipping (it never ticks — that's `/review`'s job).

## 0.1.19 — 2026-07-24

- **Research decoupled from the questionnaire** — `/research` now dispatches a dedicated, standalone
  **`research-agent`** (an autonomous research assistant that extracts everything important in the
  source) instead of the old bi-mode `questionnaire-researcher`. The report no longer carries any
  "future questionnaire" framing: the domain-brief `goal` is a research objective, and the brief
  template is renamed `research-brief.md`. The blueprint step moves to its own **`questionnaire-architect`**
  agent, dispatched by `/questionnaire`. New Notion archive databases are titled « Recherche ». Update
  scrubs the retired `questionnaire-researcher` agent and old template automatically.
- **Multi-pass research for large sources** — `/research` now maps a big PDF into a reading plan, runs
  one deep `research-agent` pass **per segment in parallel**, synthesises the cross-cutting sections,
  and assembles a single report. Report length scales with the source (no fixed word-count cap), so a
  dense thesis or state-of-the-art gets exhaustive coverage instead of being compressed into one pass.
  Small sources and URLs still take the single-pass path.

## 0.1.18 — 2026-07-22

- **Consolidated global config** — the research/questionnaire settings move from
  `~/.claude/questionnaire.config.yaml` into one `~/.claude/thebidouille.config.yaml` with
  `obsidian` / `research` / `questionnaire` / `kanban` sections and a shared `obsidian.vault_path`.
  The old file is still read as a fallback; `/update-pipeline` migrates it for you. The `npx`
  installer now offers a quick interactive setup on a TTY.
- **Obsidian kanban mirror** — an optional per-project board mirrors the pipeline
  (`/brainstorm`…`/ship`): each stage moves the feature's card across columns
  (Ideas → Brainstorm → Spec → Ready to build → Building → Review → Fix → Ship → Shipped).
  `/brainstorm` can pick an idea straight from the *Ideas* column; `/init-pipeline` creates + links
  a board (keyed by the project's `PIPELINE.md` name); `/update-pipeline` links/repairs it and
  **backfills existing `specs/` onto the board**, syncing each card to its spec's status. Enable it
  via `/init-pipeline` (new project) or `/update-pipeline` (existing) — no hand-editing.

## 0.1.17 — 2026-07-22

- **Serena dashboard no longer auto-opens** — the per-repo Serena launcher `/init-pipeline` wires now
  passes `--open-web-dashboard False`. The dashboard stays available (`http://localhost:24282/dashboard/`)
  but no longer pops a browser tab on every server start. The flag overrides each machine's
  `serena_config.yml`, so behaviour is uniform across the team; `/update-pipeline`'s health check appends
  the flag to launcher entries that predate it.

## 0.1.16 — 2026-07-22

- **Obsidian store: research and questionnaires split** — research notes land in
  `obsidian_research_folder` (default `Recherches/`, with `_sources/`), and a derived questionnaire
  is now a **separate note** in `obsidian_questionnaire_folder` (default `Questionnaires/`),
  wikilinked both ways with the research note. Statut lifecycle: the research note stays
  `Recherche`; the questionnaire note carries `À relire` / `Bloqué` / `Approuvé`. (Replaces
  0.1.15's single `obsidian_folder` key.) Notion store unchanged — one page per run.

## 0.1.15 — 2026-07-22

- **Obsidian store for research runs** — the research/questionnaire capability gains a `store:`
  switch in `~/.claude/questionnaire.config.yaml`: `notion` (default, unchanged) or `obsidian` —
  each run becomes a markdown note in `<vault>/<obsidian_folder>/` with frontmatter properties
  (`run_id`, `sujet`, `cadre`, `statut`, `date`), source PDFs copied to `_sources/` for provenance.
  No MCP needed; the vault path is asked once on first `/research`, then saved. Old Notion runs stay
  readable — pass their URL to `/questionnaire`.

## 0.1.14 — 2026-07-22

- **`/fix`** — scoped fix loop: appends a REVIEW REPORT (or `/smoke` failures) to the spec's
  `## Remediation` and re-dispatches ONLY the surfaces with findings, instead of the full
  paste-into-`/spec` + full `/build` round-trip.
- **`/smoke`** — end-to-end verification between `/build` and `/review`: infra up in the feature
  worktree, migrations, real contract endpoints via curl (incl. RBAC denials), spec §8 UI flows
  mobile-first, optional screenshot diff against the Claude Design pages.
- **`/doctor`** — installation diagnostic: core/pointer versions, agents↔surfaces orphans, hooks &
  gate config, retrieval health, design wiring, stale worktree slots — each failure with its exact fix.
- **Dispatch metrics** — `/build`, `/review`, `/fix`, `/smoke` append per-agent JSONL evidence to
  `.claude/pipeline-metrics.jsonl` (gitignored); SCHEMA §Specialization now points at it.
- **`/ship`** — watches the PR's CI checks (`gh pr checks --watch`) and, after the merge is
  confirmed, proposes `scripts/remove-feature.sh` (worktree + slot teardown, db kept by default).
- **`/init-pipeline`** — generates `.github/workflows/pipeline-ci.yml` from the profile's commands
  (with go-ahead) and gitignores the metrics sink.
- **CHANGELOG** — this file; shipped with the core, shown by `/update-pipeline` after an update.

## 0.1.13 — 2026-07-22

- **`/review` is parallel** — one review agent per touched surface in a single dispatch (wall-clock =
  slowest surface, not the sum); the lead merges the reports, worst verdict wins.
- **Review agent reads less** — `mcp__serena` in its toolset (harmlessly absent when a project has no
  retrieval provider) and a diff-hunks-first reading rule instead of whole-file reads.

## 0.1.12 — 2026-07-22

- **Per-feature design projects** — spec `design_files` now accepts full Claude Design links, each
  carrying its own project id (extracted at `/build`'s design gate); the profile's `design_project`
  becomes an optional fallback. Design each feature in a fresh project and just paste the link.

## 0.1.11 and earlier

Pre-changelog releases: serena wiring made PATH-proof and health-checked (0.1.9–0.1.11), OIDC npm
trusted publishing (since 0.1.4). See `git log` for details.
