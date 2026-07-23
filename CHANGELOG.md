# Changelog

Entries are shown by `/update-pipeline` ("What's new") after a core refresh. Keep them short,
user-facing, most recent first. One `## <version> — <YYYY-MM-DD>` section per release.

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
