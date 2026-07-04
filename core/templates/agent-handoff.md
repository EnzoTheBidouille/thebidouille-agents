# HANDOFF — <surface> · `<feature_id>`

Branch: <feature_branch_prefix><feature_id>
Commit/diff base: <default_branch...HEAD or "uncommitted working tree">

## Summary

<2–4 lines: what you built and the approach>

## Files touched

- `path/to/file` — <what & why>

## Migrations / schema (if any)

- `<name>` — <additive change> · run with <PIPELINE.md commands.migrate>

## Tests

- Added: <test files>
- Run: <this surface's test_cmd> · result: <pass/fail + counts>

## Contract adherence

- [ ] Implemented exactly to the frozen contract (`<contract.path>/<feature_id>.<ext>`)
- Mismatches / assumptions: <none, or describe — DO NOT edit the contract; report instead>

## Remediation addressed (fix loops only)

- <which `## Remediation` items you fixed, by file:line>

## TODO / not done

- <anything deferred, blocked, or out of scope>
