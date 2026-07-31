---
layout: home

hero:
  name: Cohorte
  text: Multi-agent dev pipeline for Claude Code
  tagline: Install the core, run /init-pipeline, and a portable, stack-agnostic team of agents adapts to your project — spec-driven, TDD-first, token-frugal.
  image:
    src: /cohorte-avatar-512.png
    alt: Cohorte
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is Cohorte?
      link: /guide/what-is-cohorte
    - theme: alt
      text: GitHub
      link: https://github.com/TheBidouilleAgency/cohorte

features:
  - icon: 🧭
    title: One profile drives everything
    details: /init-pipeline detects your stack, interviews the gaps, and writes PIPELINE.md — the single machine-readable profile every command, agent, and hook reads. The core stays generic; your facts live in one place.
  - icon: 🤖
    title: One agent per surface, in parallel
    details: /build authors a frozen contract, then dispatches one stateless implementer per code surface concurrently — TDD-first, each owning exactly one tree, syncing only through the contract.
  - icon: 🪙
    title: Token-frugal by design
    details: Deterministic preflight aborts before spawning agents on red code. Quiet commands, staged diffs, capped reports, baked conventions, byte-stable prompts for cache hits, /clear-safe at every boundary.
  - icon: 🛡️
    title: Guard-railed autonomy
    details: A profile-driven PreToolUse gate hard-denies destructive commands, confirm-gates the risky ones (branch-aware), and enforces a preflight phase gate — for every agent, including workflow subagents.
  - icon: 🖥️
    title: Cockpit included
    details: npx cohorte dashboard serves a local web cockpit — fleet freshness, /doctor health, specs/kanban boards, metrics, and one-click install/update/audit actions.
---

## The loop, end to end

```
/brainstorm   →  a persona panel pressure-tests the idea
/spec         →  the frozen spec + contract — the single source of truth
/build <id>   →  one implementer per surface, in parallel
/smoke <id>   →  the app actually run, end to end
/review <id>  →  one reviewer per touched surface, adversarially cross-checked
/fix <id>     →  the findings applied, surface by surface
/ship <id>    →  commit, push, PR, CI watch — the one human-confirmed gate
```

Three moments of human attention per feature: the brainstorm, the spec freeze, and the ship
confirmation. Everything in between runs itself — and every stage hands off through files on disk,
so `/clear` between commands is always safe.

## Install in one line

```sh
npx cohorte install --global    # one shared core for every repo on this machine
# then, inside your project, in Claude Code:
/init-pipeline
```

See [Getting started](/guide/getting-started) for per-project installs, Windows, and what gets
generated.
