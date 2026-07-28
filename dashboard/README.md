# Dashboard — architecture

A local web cockpit for the pipeline, launched with `npx cohorte dashboard`
(see the [root README](../README.md#dashboard--a-local-web-cockpit) for user-facing docs).

## Two halves: shipped runtime vs dev build

```
dashboard/
  server/      → RUNTIME, dependency-free (node built-ins only). Shipped in the npm package.
  app/         → DEV source: Vite + React. NOT shipped (see ../.npmignore-style dashboard/.npmignore).
  dist/        → app/ built output. Shipped, served by server/. Git-ignored, rebuilt at publish.
```

- **`server/`** is plain node (`http`, `fs`, `child_process`) — no deps, so `npx … dashboard`
  needs no install. It serves `dist/` as static files + a small JSON/stream API.
- **`app/`** is a Vite+React app built to `dist/`. `npm run build:dashboard` (root) runs
  `npm --prefix dashboard/app ci && … run build`; CI does this before `npm pack`/`publish`
  (`.github/workflows/publish.yml`), and `dashboard/.npmignore` lets the git-ignored `dist/` ship.

## Server modules (`server/`)

| File | Responsibility |
| --- | --- |
| `index.js` | HTTP server, routing, static serving (SPA fallback), streamed actions, `--host`/bind |
| `versions.js` | installed core vs npm latest (registry fetch → `npm view` fallback, 5-min cache) |
| `doctor.js` | the `/doctor` checks reimplemented in JS → `/api/state` (profile, agents, gate, hooks, …) |
| `yaml.js` | minimal block-YAML subset parser (for the `pipeline-profile` block + the config) |
| `fleet.js` | tracked-project registry (`~/.claude/cohorte-dashboard.json`) + folder browse |
| `kanban.js` | linked Obsidian board → columns/cards; PR enrichment + ship-date sort via `gh` |

## API

Read: `GET /api/versions`, `/api/state?project=`, `/api/fleet`, `/api/browse?dir=`,
`/api/kanban?project=`. Mutate: `POST /api/projects` (add) · `DELETE /api/projects` (remove);
`POST /api/action` — `{action:'install'|'update', scope, project}` (spawns the CLI),
`{action:'reset', project, purgeSpecs}` (backup+wipe+reinstall), or
`{action:'claude', command:'/init-pipeline'|'/update-pipeline', project}` (headless `claude -p`).
Action responses stream chunked plain text ending in `__EXIT__ <code>`; the client reads the
`ReadableStream` (`app/src/api.js` `streamAction`).

## Security

Binds `127.0.0.1` by default — the action endpoints **execute code**. `--host=ADDR` opts into
exposing it (prints a warning). CORS is not enabled: the frontend is same-origin (served by the
agent). If a hosted-frontend model is ever added, lock CORS to the exact frontend origin (never `*`),
or any site could drive the local agent.

## Dev loop

```sh
node bin/cli.js dashboard              # terminal 1: the node API on :4317
npm --prefix dashboard/app run dev     # terminal 2: Vite on :4318, proxies /api → :4317
```
