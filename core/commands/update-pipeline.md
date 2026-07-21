---
description: Refresh the pipeline core (global ~/.claude, or a repo's bundled .claude) from the thebidouille-agents repo's latest main. Keeps your questionnaire.config.yaml and every generated file.
argument-hint: [path-to-local-checkout]
---

You are the **pipeline updater**. Refresh the installed pipeline core to the latest version of the pipeline
repo. The installer's `--update` mode never touches generated files: `PIPELINE.md`, rendered surface agents,
`gate-config.json`, `settings.json`, and the filled `~/.claude/questionnaire.config.yaml` are all preserved.

## 1. Detect the install scope + current version

- **Global** install ⇒ `~/.claude/pipeline/VERSION` exists. **Bundled** ⇒ this repo's
  `.claude/pipeline/VERSION` exists. (Both can exist; prefer the bundled one when running inside such a
  repo, and update both if the human wants.)
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
  npx thebidouille-agents@latest update --global   # global core
  npx thebidouille-agents@latest update            # bundled core of the current repo
  ```

- If npm/npx is unavailable, fall back to piping the installer from the repo's latest `main`:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/EnzoTheBidouille/thebidouille-agents/main/install.sh | sh -s -- --update --global
  # bundled:  … | sh -s -- --update
  ```

  (The piped installer clones the repo itself; `-s --` forwards the flags.)

## 3. Report old → new

Re-read the VERSION file(s) and print `old → new`. If unchanged, say the core was already up to date.
For a bundled repo, note that `.claude/pipeline.json`'s `core_version` was bumped and should be committed.

## 4. Tell the human the follow-ups

- **Restart / reload the Claude Code session** so it picks up updated commands and agents.
- **Per repo using the dev pipeline:** re-run `/init-pipeline` to reconcile if the update changed
  `implementer.template.md`, the hooks, or the scripts (it loads the existing `PIPELINE.md` and only
  applies deltas) — harmless otherwise.
- The questionnaire capability needs nothing per repo — its config is global
  (`~/.claude/questionnaire.config.yaml`) and untouched by updates.
