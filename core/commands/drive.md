---
model: sonnet
description: Autonomous /build → /review → /fix → /review loop for one feature, until no blocking finding remains.
argument-hint: <feature_id> [--max=N] [--no-build] [--rebuild] [--resume]
allowed-tools: Bash(bash ~/.claude/pipeline/scripts/loop.sh:*), Bash(bash .claude/pipeline/scripts/loop.sh:*), Bash(test:*), Read(specs/reports/**)
disable-model-invocation: true
---

You are the **launcher**, not the loop. Run the driver for **$ARGUMENTS** and relay three lines.

> **This command was `/drive` until 1.6.0.** Claude Code ships its own built-in `/drive` (run a prompt on
> a recurring interval), which **shadowed** this one: typing `/drive <id>` started the interval runner
> with the feature id as its prompt, so the driver below never ran and the session reported a loop that
> did not exist. The shipped script keeps its `loop.sh` name — nothing about a user's install path
> changes, only what you type.
>
> This command exists because a slash command cannot `/clear` itself. Every phase of the loop runs
> as a **separate `claude -p` child session** with its own fresh context, driven by a bash script —
> so the diff, the N review reports and the N contracts never accumulate in YOUR history, which is
> re-sent at input price on every turn. Running the loop conversationally here would cost more than
> the loop saves.

## 1. Launch

Probe the core, then run the script — ONE Bash call, and let it run to completion:

```
test -f .claude/pipeline/scripts/loop.sh \
  && bash .claude/pipeline/scripts/loop.sh $ARGUMENTS \
  || bash ~/.claude/pipeline/scripts/loop.sh $ARGUMENTS
```

Pass `$ARGUMENTS` through untouched — the script owns its own flag parsing (`--max=N`,
`--no-build`, `--rebuild`, `--resume`) and exits 64 on anything it doesn't know. Don't validate flags
yourself, don't rewrite them, don't add any.

**Resume is the human's call, not yours.** The loop records its position in the spec's front-matter
(`status: in-progress` · `loop_pass` · `loop_phase` — SCHEMA.md §Spec status), so a run killed by a
dead session, a ceiling or a `blocked` exit can continue with `--resume` instead of re-paying the
passes it already made. If the human types `/drive <id>` on a spec whose front-matter says
`status: in-progress` or `blocked` with `loop_pass` > 1, say so in one line and ask whether to resume
or restart — never silently add the flag, and never silently restart from pass 1.

**Never read `specs/reports/<id>.loop.log`.** It holds the full transcript of every child session —
the entire diff, every review report, every fix handoff. Pulling it into this session re-imports
exactly the context the loop was built to keep out, and it is the one mistake that turns this
command into the most expensive one in the pipeline. Point the human at the path instead; they can
open it in an editor for free. The same goes for the per-surface `.diff` and `.preflight.txt` files.

## 2. Report — three lines, from the exit code

The script prints one line per phase and one closing line; that is your raw material. For exit
**1** or **3** only, also Read `specs/reports/<id>.verdict.json` (small, structured, safe) to name
the remaining findings — never the markdown report, which is the findings body in full. For exit
**4**, Read `specs/reports/<id>.readiness.json` instead (also small) and relay its `gaps`. On any
other exit the closing line already carries the deferred count, so read nothing.

| exit | meaning | what to say |
| ---- | ------- | ----------- |
| `0` | clean | no blocking findings left; the human can `/ship <id>` |
| `1` | ceiling hit | the fix was progressing but ran out of passes ⇒ re-run with a higher `--max` |
| `2` | no usable verdict | `/review` produced nothing, or aborted on a red preflight — the closing line says which; point at `specs/reports/<id>.preflight.txt` |
| `3` | non-convergent | the same blocking findings survived a fix pass; a higher `--max` will NOT help — the human needs to look at them (list them from the verdict) |
| `4` | not implementable | `/build`'s readiness gate returned `NOT-READY` — the frozen spec cannot be built and **no agent ran**; Read `specs/reports/<id>.readiness.json` (small, structured) and relay its `gaps`, then point at `/spec <id>`. More passes cannot fix this |
| `64` | usage | relay the script's own message verbatim |

Then print exactly three lines and nothing else — plus a fourth **only when the verdict carries
`deferred` > 0** (findings that were real but out of this feature's scope, parked in the backlog by
`/review` §3.5; they are not blocking and never cost a pass, but they are not nothing either):

```
outcome:    <one clause — clean / ceiling / no verdict / non-convergent / not implementable / usage>
iterations: <n> review pass(es)<, m fix pass(es) committed>
remaining:  <blocking count + one short phrase per blocking item, or "none">
deferred:   <n> parked in specs/refactor-backlog.md — /refactor <domain> when you want them
```

Add at most one follow-up sentence: the next command to run. Never restate a finding's fix, never
summarize the log, never open the diff. Each fix pass is already committed
(`loop(<id>): fix pass <i>`) — say so on a non-zero exit, since those commits are the way back.
