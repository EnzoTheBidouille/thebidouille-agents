# Agents

Two kinds: **fixed agents** shipped as-is by the installers, and **rendered surface agents**
generated per project by `/init-pipeline` from a template. All are stateless — every dispatch
re-supplies everything they need as exact file paths.

## Fixed agents

| Agent | Model | Tools | Job |
| --- | --- | --- | --- |
| `review` | sonnet | Read, Grep, Glob, retrieval MCP | Read-only reviewer / auditor. |
| `smoke` | sonnet | Read, Write, Grep, Glob, Bash, DesignSync | Runs the built feature end-to-end. |
| `release` | haiku | Read, Grep, Glob, Bash | Commit / push / PR ritual at `/ship`. |
| `profile-reader` | haiku | Read, Grep, Glob | `PIPELINE.md` machine block → JSON (workflow phase 0). |

### `review`

Read-only **by construction** — no Write, no Edit, no Bash. Reads the staged diff file named in
its dispatch *first* (hunks + immediate context; full source files only when a finding demands
it), prefers retrieval MCP tools over grep-and-read. Checks in order: spec conformance (highest
priority — every deviation from the frozen contract is a finding), correctness, security
(any vulnerability ⇒ verdict **BLOCK**), profile conventions, RBAC and mobile-first when
enabled, TDD coverage — plus per-language traps (TS: `any`, floating promises; Python: mutable
default args, bare `except`; Rust: `.unwrap()` outside tests, `unsafe` without `// SAFETY`;
Go: discarded errors, un-`ctx`'d goroutines, `defer` in loops; SQL: `UPDATE`/`DELETE` without
`WHERE`, N+1, unindexed FK joins).

Emits the **REVIEW REPORT**: severity table, verdict (`SHIP` = no CRITICAL/security;
`REVISE` = ≥1 CRITICAL; `BLOCK` = security), findings **capped at 20, one line each, zero code
excerpts**, every finding self-sufficient (`file:line · severity · type · concrete fix`) — it
gets appended verbatim to the spec's Remediation. In **audit mode** (dispatched by `/audit`
with a path instead of a spec) it emits a prioritized refactor backlog grouped by domain
instead of a verdict.

### `smoke`

Actually runs the feature — `/review` audits code; nobody has executed it yet. Brings infra up
in the checkout named by its dispatch (compose stack, migrations, dev servers in background,
polls for ready), exercises a representative set of spec §5 endpoints with `curl` against the
real server (every route domain, every auth level, one error case per class; RBAC denials per
role boundary), drives spec §8 UI flows mobile-first (375px) and compares against the design
pages when browser tooling exists — saying so honestly when it doesn't. Keeps its own context
lean (bulky output to files, grep/jq to assert). Stages the full report to
`specs/reports/<id>.md`, tears down, returns **only** `PASS`/`FAIL:<n>` + max 10 ❌ one-liners.
Observes honestly, never fixes.

### `release`

Runs only after a human-confirmed SHIP. Sanity-checks the branch and staged files (refuses
`.env`/secrets), writes conventional commits referencing the feature id, plain `git push`
(never force, never history rewrites), opens the PR via `gh` — or emits the compare URL + a
drafted PR body from the template when `gh`/GitHub isn't available. Never edits source, never
runs migrations, never touches `gate.deny` commands.

### `profile-reader`

Reads the fenced `yaml pipeline-profile` block of `PIPELINE.md` and returns it as faithful JSON
(comments dropped, nothing invented, `<…>` placeholders passed through) — or
`{"error": "…"}` — nothing else. Exists because workflow scripts have no filesystem access;
it's the mandatory phase 0 of all four workflow scripts.

## Rendered surface agents

`/init-pipeline` (and `/build` §1.5 when a spec grows the surface list) renders one agent per
`surfaces[]` entry from `core/agents/implementer.template.md` into
`.claude/agents/<agent>.md`, substituting:

| Placeholder | Filled with |
| --- | --- |
| `<SURFACE_AGENT>` / `<SURFACE_LABEL>` / `<SURFACE_PATH>` | key, human label, owned tree |
| `<SURFACE_TOOLS>` / `<SURFACE_MODEL>` | frontmatter tools (+ `DesignSync` iff `uses_design`, retrieval MCP tools iff wired) and model tier |
| `<SURFACE_CONVENTIONS>` | the surface's convention slice **baked at render time**: §Conventions `### Shared` + its own `### Surface:` stanza + its §Testing lines |
| `<SURFACE_EXTRA_NEVER>` / `<SURFACE_DESIGN_INPUT>` / `<SURFACE_TDD_STEP1>` | surface-specific never-rules and (for design surfaces) the link-based design-input and design-first TDD step |

The rendered implementer:

- **Owns one tree** (`<path>/**`) and may touch nothing else; never edits the frozen contract
  (mismatch ⇒ report in the handoff, never fix); never runs `gate.deny` commands; migrations
  are append-only.
- **Reads only the machine block** of `PIPELINE.md` at runtime — its conventions are baked in.
  If the bake visibly contradicts the profile, it says so in its handoff (the profile wins; the
  agent needs a re-render via `/update-pipeline`).
- **Works strict TDD**: (design pull first for `uses_design` surfaces) → failing tests from the
  contract → implement to green → refactor to conventions → lint + format. Runs **bridled
  commands** (its `*_quiet_cmd`s, or `cmd 2>&1 | tail -40`).
- On a **fix loop**, doesn't re-read the spec: its dispatch carries its open Remediation items
  verbatim; it reads only the files they name, and computes its own scoped diff
  (`git diff <base> -- <its path>`) when it needs current state.
- Returns the fixed-shape **HANDOFF**: summary, migrations, test results, contract
  mismatches/assumptions, remediation addressed, TODOs — one line per item, no file lists, no
  code excerpts.

**Agent files are regenerable artifacts.** Hand-written rules belong in `PIPELINE.md`
§Conventions (which reconcile never touches), never in the agent files — `/update-pipeline`
re-renders them from the current template on every reconcile. `/doctor` enforces the no-orphan
rule both ways: every surface has its agent file, every non-fixed agent file has its surface.
