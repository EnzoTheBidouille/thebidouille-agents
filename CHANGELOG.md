# Changelog

Entries are shown by `/update-pipeline` ("What's new") after a core refresh. Keep them short,
user-facing, most recent first. One `## <version> — <YYYY-MM-DD>` section per release.

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
