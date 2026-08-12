---
model: sonnet
description: Refresh the pipeline core (global ~/.claude, or a repo's bundled .claude) to the latest published cohorte version, then reconcile this repo's generated files to it — /cohorte-init-pipeline stays one-time.
argument-hint: [path-to-local-checkout]
---

You are the **pipeline updater**. Refresh the installed pipeline core to the latest version of the pipeline
repo. The installer's `--update` mode never touches generated files: `PIPELINE.md`, rendered surface agents,
`gate-config.json`, `settings.json`, and the filled `<config>` are all preserved.
YOU then bring those generated files up to the new core yourself (§3.5) — additively, never clobbering
the human's choices — so `/cohorte-init-pipeline` never needs re-running for an upgrade.

## 1. Detect the install scope + current version

- **Global** install ⇒ `<core>/pipeline/VERSION` exists. **Bundled** ⇒ this repo's
  `<core>/pipeline/VERSION` exists. (Both can exist; prefer the bundled one when running inside such a
  repo, and update both if the human wants.)
- **Never migrate a repo between bundled and global mode on your own.** Updating means refreshing the
  core *in its current mode*. Only migrate (e.g. delete a bundled core in favor of the global one) if
  the human explicitly asks — and confirm before deleting anything, since it rewrites the repo's
  committed `.claude/` and the `pipeline.json` pointer teammates rely on.
- Read the VERSION file(s) — a semver like `0.1.0`, possibly suffixed `(abc1234)` for from-main
  installs, or a bare commit hash on old cores. If missing, note "unknown (pre-versioning)".

## 2. Run the update

- If `$ARGUMENTS` is a path to a local checkout of the pipeline repo (contains `core/` + `install.sh`),
  run from there — useful when iterating on the pipeline itself:

  ```sh
  sh <path>/install.sh --update --global     # global core
  sh <path>/install.sh --update              # bundled core of the current repo
  ```

- Otherwise use the published npm package (preferred — installs the latest tagged release):

  ```sh
  npx cohorte@latest update --global   # global core
  npx cohorte@latest update            # bundled core of the current repo
  ```

- If npm/npx is unavailable, fall back to piping the installer from the repo's latest `main`:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/TheBidouilleAgency/cohorte/main/install.sh | sh -s -- --update --global
  # bundled:  … | sh -s -- --update
  ```

  (The piped installer clones the repo itself; `-s --` forwards the flags.)

## 3. Report old → new

Re-read the VERSION file(s) and print `old → new`. If unchanged, say the core was already up to date.

**Sync the pointer — in BOTH modes.** If this repo has a `<state>/pipeline.json` whose `core_version`
differs from the core you just installed, rewrite that one field (leave every other field untouched)
and tell the human to commit it. In **bundled** mode the installer already did it; in **global** mode
**nothing does** — the installer refreshes one shared core and cannot know which repos point at it,
so before 1.2.5 the field simply drifted forever (a repo on a current core still claiming `1.0.0`).
`/cohorte-doctor` check 1 requires the pointer to be coherent with the VERSION file, so a drifted field reads
as a broken install when nothing is broken.

Then print **What's new**: read the installed `<core>/pipeline/CHANGELOG.md` and show the entries
between the old and new versions (most recent first). File absent ⇒ the old core predates 0.1.14 —
skip silently.

## 3.5 Reconcile this repo's generated files

Only when the current repo has a `PIPELINE.md`: run the **Reconcile procedure** from the installed
`pipeline/SCHEMA.md` §Reconcile — top up the profile's machine block with new fields at their defaults
(one batched question set for any genuinely new human decision — e.g. choosing a `retrieval` provider,
or the **quiet command variants**: `test_quiet_cmd`/`lint_quiet_cmd` + `commands.test_quiet`/
`lint_quiet`, proposing the detected bridled forms per §Output discipline; `gate.preflight` tops up
silently at its defaults), re-render the surface agents from the current `implementer.template.md`
(this refreshes each agent's **baked §Conventions slice** — required after any hand-edit of the
profile's prose), additively patch `settings.json`/`gate-config.json` (including the `preflight`
block and the workflow-agent `allow` entries from init step 5), and run any newly-added capability's
wiring (e.g. Serena's project-scope `claude mcp add`). Verify the refreshed core actually carries
`<core>/workflows/` + `agents/profile-reader.md` — missing means the update half-ran: re-run the
installer. Even when no capability is new, **re-run the retrieval provider's
health check** (SCHEMA.md §Code retrieval: CLI resolvable from PATH, `.mcp.json` entry present —
upgrading a bare `serena` entry to the PATH-proof launcher form, `.serena/` gitignored, server
actually connected) and repair whatever fails — wiring that worked at
init can rot (PATH changes, uninstalls, hand-edits). Report what was reconciled; if nothing was
missing, say so. This is why `/cohorte-init-pipeline` never needs re-running for a core upgrade.

Four of the §Reconcile steps matter specifically here:

- **Local-artifact hygiene** (§Reconcile step 8): gitignore + untrack the pipeline's runtime files
  (`<state>/preflight.ok`, `<state>/pipeline-metrics.jsonl`, `specs/reports/`). A tracked
  `preflight.ok` — what every pre-2.0.0 install ends up with once a release agent stages `.claude/` —
  makes the phase gate ask on every single review dispatch, so fix it here and say so.

- **Spec-template top-up** (§Reconcile step 7): `specs/_template.md` was seeded at install and never
  refreshed since, so add the front-matter fields the current `templates/spec.template.md` has and the
  repo's copy lacks — and drop `loop_pass`/`loop_phase`, retired with `/cohorte-loop` in 2.2.0 —
  front-matter only, never the body.

- **Global config seed** (§Reconcile step 5): if `<config>` is absent, seed it
  from the template so the kanban + shared-vault config has a home. Never clobber an existing filled
  file. Report what was seeded. If the existing file has NO `telemetry:` block with a `consent_date`
  (pre-telemetry install), top up the block from the template and ask the ONE opt-in consent
  question defined in `templates/steps/init-pipeline/02-interview-gaps.md` §Telemetry — record the
  answer either way so it is never re-asked. Consent is strictly opt-in; "No" is the default.
- **Kanban sync** (§Reconcile step 6): resolve this project's board with
  `<core>/pipeline/scripts/kanban-move.sh --check` — it prints either the board path or the exact
  missing link. **Not linked** → offer to link/create a board (confirm the vault + `<folder>/Tasks.md`,
  write the `boards` entry, create the board file per §Kanban). **Linked** → verify the board file
  exists (recreate if the human confirms) and its columns match `kanban.columns` (repair drift). Either
  way, run the §Kanban **full sync/backfill** from `specs/*.md` — one
  `kanban-move.sh auto <id> <stage>` per spec, `<stage>` from the status mapping — this is what adds
  every already-developed feature to the board and repositions cards to match each spec's `status`.
  Report cards added / moved / already-correct. Skip silently if `kanban.enabled` is false and the
  human doesn't want to turn it on.
- **A project renamed since its last update loses its board silently** — `boards` is keyed by the
  profile `name`, so a `name:` edit orphans the old entry and no lookup matches the new one. When
  `--check` finds no entry for `<name>` but `boards` holds exactly one other key whose board file
  exists, say so and offer to re-key it rather than creating a second board.

## 4. Tell the human the follow-ups

- **Restart / reload the Claude Code session** so it picks up updated commands, agents, and any
  newly-registered MCP server.
- **Other repos using the global core:** their core is already fresh, but reconcile is per-repo — run
  `/cohorte-update-pipeline` inside each (it will skip the already-done core update and just reconcile).
- **Commit** the reconciled files (`PIPELINE.md`, `.claude/`, `.mcp.json` if added) so teammates get them.
- The kanban config is global and user-scoped
  (`<config>`) — never committed. The core update never touches it; only the
  reconcile above seeds the file and writes kanban board links (into that global file, not the repo).
