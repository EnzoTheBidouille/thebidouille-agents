# Telemetry & privacy

Cohorte can send the maintainers **anonymous** usage pings so the pipeline improves where it's
actually slow. The posture is GDPR-first and strictly opt-in — this page is the complete
disclosure.

## Consent

Nothing is ever sent without explicit consent. `/init-pipeline` (and `/update-pipeline` on
pre-telemetry installs) ask **one question, once per machine**, default **No**, and record the
answer — either way — in `~/.claude/cohorte.config.yaml` (`telemetry.enabled`, `install_id`,
`consent_date`), so you're never re-asked. The sender (`pipeline/scripts/telemetry-send.sh`) is
a silent no-op unless `enabled: true` **and** `install_id` **and** `endpoint` are all set — all
three written only by the consent flow.

## What is sent

One event per pipeline phase, for the **feature funnel only** — the seven stages of idea → PR:

| phase | fired when | seconds | results |
| --- | --- | --- | --- |
| `brainstorm` | return staged | 0 | — |
| `spec` | a freeze lands | 0 | `frozen` |
| `build` | after the batch | wall-clock | `ok,ok` / `error` |
| `review` | after the merge | wall-clock | `<verdict>:<count>` |
| `fix` | after the batch | wall-clock | `<fixed>/<found>` |
| `ship` | release succeeded | 0 | `pr` / `compare` |

The [workflow variants](/guide/workflows) fire the same phases with `seconds: 0` — they don't
measure wall-clock.

Setup and maintenance commands (`/doctor`, `/init-pipeline`, `/update-pipeline`, `/audit`,
`/refactor`, `/align-ds`) **never** ping — CI enforces this so the collected set can't silently
grow past what the consent text describes. The sender also allowlists the phase name
client-side.

One event (~200 bytes, strict allowlist):

```json
{"v":1,"install_id":"<random uuid>","ts":"<ISO>","core_version":"1.3.1","os":"Darwin",
 "event":"phase","phase":"build","feature_hash":"<sha256[..12] of the feature id>",
 "seconds":412,"results":"ok,ok"}
```

**Never sent:** repo or project names, file paths, code, spec content, prompts, emails,
usernames; no IP handling client-side. The feature id is hashed (12 hex chars) so cross-feature
counts work without revealing what is being built.

## Your rights, concretely

- **Withdrawal** — set `telemetry.enabled: false` in `~/.claude/cohorte.config.yaml`; effective
  on the next phase, no restart.
- **Erasure** — `/doctor` prints your `install_id`; send
  `curl -X DELETE <endpoint-origin>/v1/install/<install_id>` and the collector drops every event
  for that id (the deployed collector implements this and stores no IPs).
- **Access / portability** — events are keyed by your `install_id`; ask the operator for an
  export.

## Collector contract

Any collector implementation must honor: `POST /v1/events` (one JSON event, allowlisted
fields) · `DELETE /v1/install/<id>` (erasure) · `GET /healthz` — and must not retain IP-bearing
access logs for the ingest vhost.

## Failure posture

The ping is fire-and-forget: 2-second timeout, all errors swallowed, exit 0 always, chained
with `|| true` by every caller. Telemetry can never block, slow, or fail the pipeline — and a
*missing* sender script is equally silent, which is why `/doctor` check 1 verifies the shipped
scripts exist.
