# Dashboard — a local web cockpit

A browser view of pipeline state, for when a checklist beats scanning files.

```sh
npx cohorte dashboard                      # http://localhost:4317
npx cohorte dashboard <path>               # focused on another project
npx cohorte dashboard --port=4400 --open   # custom port, open the browser
```

## What it shows

- **Fleet overview** — the global core version vs npm latest, plus every tracked project's
  freshness and health at a glance. Add projects by absolute path or with the folder picker; the
  set is remembered in `~/.claude/cohorte-dashboard.json`.
- **Per-project drill-down**:
  - **Freshness** — installed core (global and/or bundled) vs the npm registry, pointer
    coherence.
  - **Health** — the `/cohorte-doctor` checks reimplemented in JS as a live ✅/⚠️/❌ checklist, each
    failure with its fix: core & pointer, profile parse, surfaces ↔ agents (orphans), gate
    config drift, hook registration, retrieval, design paths, isolation scripts, **workflows**
    (scripts + `profile-reader` present, which execution path applies), specs hygiene. Checks
    that need a live Claude session (MCP connectivity, in-session Workflow tool) are honestly
    reported as "not checked here" rather than faked green.
  - **Surfaces ↔ agents** map from `PIPELINE.md`.
  - **One board** — the linked Obsidian **kanban** (cards, clickable PR links, live PR status
    via `gh`, ship-date-sorted Shipped column) or, when no board is linked, a **specs board**
    grouped by `draft · frozen · in-progress · in-review · shipped · blocked`. A card driven by a
    `/cohorte-loop` shows the pass and phase it reached (`↻ pass 3 · /cohorte-review`), so an interrupted autonomous
    run is visible — resume it with `/cohorte-loop <id> --resume`.
  - **Metrics** — the `pipeline-metrics.jsonl` batches (phase durations per feature).
- **Actions** (output streamed live into the modal):
  - **Install / Update core** — global or bundled, runs the real CLI.
  - **Init-pipeline / Update-pipeline / Audit** — run the Claude Code commands **headless**
    (`claude -p`, autonomous). Headless caveats are printed before you confirm: the run starts
    without any prompt, cannot ask you anything, consumes tokens, needs the `claude` CLI
    authenticated — and there is **no resume**: if the process dies mid-run, you relaunch.
    Init additionally skips the interactive interview (Claude guesses your stack), so review the
    generated `PIPELINE.md` afterwards. Audit is read-only on your source and writes
    `specs/refactor-backlog.md`.
  - **Reset pipeline** — backs the project's pipeline footprint up to `.claude.bak-<ts>/`
    (`.claude/`, `PIPELINE.md`, optionally `specs/`), then reinstalls a fresh bundled core (a
    global-mode project keeps the shared `~/.claude` core untouched).

Buttons render only when they apply — Init only when there's no profile, Reset only when there's
a footprint to reset.

## Security model

Binds **`127.0.0.1` by default** — the action endpoints **execute code**
(install/update/reset/headless-claude), so the dashboard must not be reachable from the network.
`--host=0.0.0.0` opts out (it prints a security warning); only do that on a trusted network,
because anyone who reaches the port can run the actions. The headless-claude runner whitelists
the commands (`/cohorte-init-pipeline`, `/cohorte-update-pipeline`, `/cohorte-audit`) — no arbitrary injection into
`claude -p`.

**Loopback binding alone is not a boundary against a browser**, so the API adds two checks:

- **Host header must be a loopback origin** — this is what stops **DNS rebinding**, where an
  attacker-controlled domain resolves to `127.0.0.1`; the browser still sends *that* domain in
  `Host`. Skipped when you explicitly bound a non-loopback host (you were warned).
- **State-changing requests must carry `content-type: application/json`** — that header forces a
  CORS preflight, which this server never answers, so a page you visit cannot deliver a
  `POST /api/action` cross-origin (**CSRF**). HTML forms can only send urlencoded/multipart/text.

Reads stay protected by the absence of CORS headers: a cross-origin page can fire the request but
cannot read the response.

**Reset refuses to touch the shared core** — a project path whose `.claude` *is* the global core
(e.g. your home directory) is rejected outright rather than backed up and moved.

## Architecture (for contributors)

```
dashboard/
  server/   → runtime, dependency-free node (http/fs/child_process). Shipped in the npm package.
  app/      → dev source: Vite + React. NOT shipped.
  dist/     → app/ built output. Shipped, served by server/. Rebuilt at publish by CI.
```

The server exposes a small JSON API (`/api/versions`, `/api/state`, `/api/fleet`,
`/api/kanban`, `/api/metrics`, `/api/browse`, `/api/projects`) plus `/api/action`, whose
responses stream chunked plain text ending in `__EXIT__ <code>`. The `/cohorte-doctor` checks are
reimplemented in `server/doctor.js` so the dashboard needs **no Claude session** to compute
state; `server/yaml.js` is a minimal block-YAML parser for the profile's machine block.

Dev loop:

```sh
node bin/cli.js dashboard              # terminal 1: the API on :4317
npm --prefix dashboard/app run dev     # terminal 2: Vite on :4318, proxying /api
```
