#!/usr/bin/env node
// Reference telemetry collector for cohorte — zero-dependency, GDPR-first.
// Deploy on any VPS behind HTTPS (Caddy/nginx). Storage: NDJSON append-only file,
// one event per line — read it from your own dashboard however you like.
//
//   TELEMETRY_DATA=/var/lib/cohorte-telemetry/events.ndjson \
//   TELEMETRY_PORT=8787 node collector.mjs
//
// GDPR notes:
//   - IPs are NEVER stored (this process doesn't read them; make sure your reverse
//     proxy's access log is disabled or anonymized for this vhost).
//   - DELETE /v1/install/<install_id> erases every event for that id (right to erasure —
//     the install_id printed by /doctor is the user's erasure key).
//   - Events are validated against a strict allowlist of fields; anything else is dropped.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DATA = process.env.TELEMETRY_DATA || "./events.ndjson";
const PORT = Number(process.env.TELEMETRY_PORT || 8787);
const MAX_BODY = 4096;

mkdirSync(dirname(DATA), { recursive: true });

const FIELDS = ["v", "install_id", "ts", "core_version", "os", "event",
  "phase", "feature_hash", "seconds", "results"];
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function sanitize(raw) {
  const e = {};
  for (const k of FIELDS) if (k in raw) e[k] = raw[k];
  if (e.v !== 1) return null;
  if (typeof e.install_id !== "string" || !ID_RE.test(e.install_id)) return null;
  if (typeof e.event !== "string" || e.event.length > 32) return null;
  for (const k of ["ts", "core_version", "os", "phase", "feature_hash", "results"])
    if (k in e && (typeof e[k] !== "string" || e[k].length > 64)) return null;
  if ("seconds" in e && typeof e.seconds !== "number") return null;
  e.received_at = new Date().toISOString();
  return e;
}

const server = createServer((req, res) => {
  const done = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

  if (req.method === "GET" && req.url === "/healthz") return done(200, { ok: true });

  if (req.method === "POST" && req.url === "/v1/events") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on("end", () => {
      try {
        const e = sanitize(JSON.parse(body));
        if (!e) return done(400, { error: "invalid event" });
        appendFileSync(DATA, JSON.stringify(e) + "\n");
        done(204, {});
      } catch { done(400, { error: "bad json" }); }
    });
    return;
  }

  // Right to erasure: drop every event carrying this install_id.
  const del = req.url?.match(/^\/v1\/install\/([A-Za-z0-9-]{8,64})$/);
  if (req.method === "DELETE" && del) {
    const id = del[1];
    let kept = [], dropped = 0;
    if (existsSync(DATA))
      for (const line of readFileSync(DATA, "utf8").split("\n")) {
        if (!line.trim()) continue;
        if (line.includes(`"install_id":"${id}"`)) { dropped++; continue; }
        kept.push(line);
      }
    writeFileSync(DATA, kept.length ? kept.join("\n") + "\n" : "");
    return done(200, { erased: dropped });
  }

  done(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`cohorte telemetry collector on :${PORT} → ${DATA}`));
