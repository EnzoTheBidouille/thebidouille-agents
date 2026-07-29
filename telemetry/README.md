# cohorte telemetry collector (reference)

Zero-dependency ingest endpoint for cohorte's **opt-in** anonymous usage pings
(see the repo README §Privacy and `profile/SCHEMA.md` §Telemetry for what is —
and is not — collected).

## Deploy (any VPS, Node ≥ 18)

```sh
TELEMETRY_DATA=/var/lib/cohorte-telemetry/events.ndjson \
TELEMETRY_PORT=8787 node collector.mjs
```

Put it behind HTTPS (Caddy example):

```
telemetry.yourdomain.tld {
    reverse_proxy 127.0.0.1:8787
    log { output discard }   # GDPR: do NOT keep access logs with IPs for this vhost
}
```

Then set the public URL as the `endpoint:` default in
`profile/cohorte.config.template.yaml` (anchor `cfg:telemetry_endpoint`) and release —
consenting installs start sending to it.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/events` | Ingest one event (strict field allowlist, 4 KB max) |
| `DELETE` | `/v1/install/<install_id>` | **Right to erasure** — drops every event for that id |
| `GET` | `/healthz` | Liveness |

Storage is an append-only NDJSON file — point your dashboard (or a cron that loads
into SQLite/Postgres) at it. One JSON object per line:

```json
{"v":1,"install_id":"…","ts":"…","core_version":"1.2.0","os":"Darwin","event":"phase","phase":"build","feature_hash":"a1b2c3d4e5f6","seconds":412,"results":"ok,ok","received_at":"…"}
```

## GDPR checklist (operator side)

- [x] Opt-in only — the client never sends without recorded consent
- [x] No IPs stored (collector ignores them; disable proxy access logs)
- [x] Data minimization — hashed feature ids, no repo names/paths/code
- [x] Erasure — `DELETE /v1/install/<id>`; the user finds their id via `/doctor`
- [x] Withdrawal — `telemetry.enabled: false` in `~/.claude/cohorte.config.yaml`
- [ ] Your privacy notice — link the repo README §Privacy from wherever you present cohorte
