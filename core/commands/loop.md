---
model: sonnet
description: Autonomous /build → /review → /fix → /review loop for one feature, until no blocking finding remains.
argument-hint: <feature_id> [--max=N] [--no-build] [--rebuild]
allowed-tools: Bash(bash ~/.claude/pipeline/scripts/loop.sh:*), Bash(bash .claude/pipeline/scripts/loop.sh:*), Bash(test:*), Read(specs/reports/**)
disable-model-invocation: true
---

You are the **launcher**, not the loop. Run the driver for **$ARGUMENTS** and relay three lines.

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
`--no-build`, `--rebuild`) and exits 64 on anything it doesn't know. Don't validate flags yourself,
don't rewrite them, don't add any.

**Never read `specs/reports/<id>.loop.log`.** It holds the full transcript of every child session —
the entire diff, every review report, every fix handoff. Pulling it into this session re-imports
exactly the context the loop was built to keep out, and it is the one mistake that turns this
command into the most expensive one in the pipeline. Point the human at the path instead; they can
open it in an editor for free. The same goes for the per-surface `.diff` and `.preflight.txt` files.

## 2. Report — three lines, from the exit code

The script prints one line per phase and one closing line; that is your raw material. For exit
**1** or **3** only, also Read `specs/reports/<id>.verdict.json` (small, structured, safe) to name
the remaining findings — never the markdown report, which is the findings body in full.

| exit | meaning | what to say |
| ---- | ------- | ----------- |
| `0` | clean | no blocking findings left; the human can `/ship <id>` |
| `1` | ceiling hit | the fix was progressing but ran out of passes ⇒ re-run with a higher `--max` |
| `2` | no usable verdict | `/review` produced nothing, or aborted on a red preflight — the closing line says which; point at `specs/reports/<id>.preflight.txt` |
| `3` | non-convergent | the same blocking findings survived a fix pass; a higher `--max` will NOT help — the human needs to look at them (list them from the verdict) |
| `64` | usage | relay the script's own message verbatim |

Then print exactly three lines and nothing else:

```
outcome:    <one clause — clean / ceiling / no verdict / non-convergent / usage>
iterations: <n> review pass(es)<, m fix pass(es) committed>
remaining:  <blocking count + one short phrase per blocking item, or "none">
```

Add at most one follow-up sentence: the next command to run. Never restate a finding's fix, never
summarize the log, never open the diff. Each fix pass is already committed
(`loop(<id>): fix pass <i>`) — say so on a non-zero exit, since those commits are the way back.
