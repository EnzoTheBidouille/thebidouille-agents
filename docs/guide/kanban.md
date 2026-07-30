# Kanban mirror (Obsidian)

An **optional, user-scoped** mirror of the dev flow: each pipeline stage moves a card across an
[Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban) board — one board per project.
Everything no-ops silently when it isn't configured; the pipeline never blocks on the board.

## Why user-scoped

The board lives in your **personal vault**, so its path is machine-specific — it belongs in the
global `~/.claude/cohorte.config.yaml`, never in the committed `PIPELINE.md`. Boards are keyed by
the project's profile `name`:

```yaml
obsidian:
  vault_path: "/Users/you/Vault"
kanban:
  enabled: true
  columns: { ideas: "Ideas", brainstorm: "Brainstorm", spec: "Spec", ready: "Ready to build",
             building: "Building", review: "Review", fix: "Fix", ship: "Ship", shipped: "Shipped" }
  boards:
    MyProject:
      board: "MyProject/Tasks.md"
```

Wired for you by `/init-pipeline` (opt-in question) or `/update-pipeline` — including creating
the board file with the right front-matter, one heading per column, and the plugin settings
block. Don't hand-edit the config; the `# cfg:` anchors in it are what the installer prompts
write to.

## Cards and the join key

A card is a list item under a `## <column>` heading:

```
- [ ] Invoice CSV export  #facture-export — PR #42
```

The `#<feature_id>` tag is the **join key** between the card and `specs/<feature_id>.md` — it's
how every stage finds *its* card. Free-text sub-bullets under an **Ideas** card are seed context
`/brainstorm` picks up. Once shipped, `/ship` appends the PR number — which the dashboard renders
as a clickable link with live open/merged/closed status.

## Stage → column

| Pipeline moment | Column |
| --- | --- |
| human drops a raw idea | `ideas` |
| `/brainstorm` picks it up | `brainstorm` |
| `/spec` opens (draft) | `spec` |
| `/spec` freezes | `ready` |
| `/build` · `/cycle` launch | `building` |
| `/review` (and `/cycle` landing SHIP-READY) | `review` |
| `/fix` (and `/cycle` landing stopped) | `fix` |
| `/ship` starts | `ship` |
| PR opened | `shipped` (+ `PR #<num>`) |

## The move script

Commands move cards through the shipped script — the whole operation happens outside the agent's
context (find, dedupe, sub-notes carried along, settings block preserved):

```sh
<core>/pipeline/scripts/kanban-move.sh <board.md> <id> <column> [--pr <num>] [--title <title>]
```

It creates the card in the target column when none exists, keeps the first and drops duplicates.
Every call site chains `|| true`, so a missing board — or a missing script — is silent;
`/doctor` is what catches a half-copied core.

## Backfill / sync

`specs/*.md` is the source of truth. The reconcile (run by `/update-pipeline`, and at board
creation) maps each spec's `status` to a column (`frozen`→ready, `in-review`→review,
`shipped`→shipped, else spec) and **fully syncs**: missing cards are added, existing cards are
*moved* to the right column — the board always reflects the specs, even where a human dragged
cards around.

## In the dashboard

When a project has a linked board, the [dashboard](/guide/dashboard) renders it (columns + cards
from the vault) instead of the plain specs board — with clickable PR links, live PR status via
`gh`, and a ship-date-sorted Shipped column.
