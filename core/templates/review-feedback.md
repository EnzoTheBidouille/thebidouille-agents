# REVIEW REPORT

feature_id: <feature_id>
Feature branch: <feature_branch_prefix><feature_id>
Commit SHA: <first 12 chars>

| Severity | Count | Status |
| -------- | ----- | ------ |
| CRITICAL | 0     | pass   |
| HIGH     | 0     | noted  |
| MEDIUM   | 0     | noted  |
| LOW      | 0     | -      |

Verdict: <SHIP | REVISE | BLOCK>

## Verdict rules

- **SHIP** — no CRITICAL and no security issue. Cleared for the human's manual QA + `/ship`.
- **REVISE** — one or more CRITICAL (spec violation / correctness). Must fix.
- **BLOCK** — a security vulnerability. Must fix immediately.

## Findings

> Every finding is self-sufficient: a stateless agent must be able to act on it with no other
> context. Order by severity. If none, write "None."

- **[CRITICAL]** `<surface.path>/...:42` · spec-violation · <what's wrong vs spec §X> → **Fix:** <concrete change>
- **[HIGH]** `<path>:88` · quality · <issue> → **Fix:** <concrete change>
- **[BLOCK/security]** `<path>:line` · security · <vuln> → **Fix:** <concrete change>

Each finding line format (so it pastes straight into the spec's `## Remediation`):
`[<SEVERITY>] <file:line> · <spec-violation|quality|security> · <problem> → Fix: <concrete fix>`

## Notes

<optional: patterns to watch, things verified clean; RBAC / mobile-first assessment if the profile enables them>
