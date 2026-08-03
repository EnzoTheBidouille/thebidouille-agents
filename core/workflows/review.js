// cohorte — /cohorte-review as a deterministic workflow (opt-in; the conversational
// /cohorte-review command remains the default path and the fallback).
//
// Invoke with args = {feature: "<feature_id>"} (or the bare feature id string).
// Requires Claude Code >= 2.1.154 with workflows enabled — /cohorte-doctor reports this.
//
// Shape (SCHEMA.md §Workflows): phase 0 reads the profile through the
// profile-reader agent (scripts have no filesystem or shell), the deterministic
// preflight aborts while red (zero reviewers spawned), the diff is staged ONCE
// per touched surface, one reviewer runs per surface in parallel, an adversarial
// cross-check tries to refute every CRITICAL/security finding, and only the
// merged verdict comes back — the full report is staged to specs/reports/.
// Mechanical phases run on haiku; reviewers run the pinned `review` agent (sonnet).

export const meta = {
  name: 'cohorte-review',
  description: 'Review a cohorte feature: preflight gate, one reviewer per touched surface, adversarial cross-check, merged verdict only',
  whenToUse: 'Only when the human explicitly asks for the review workflow of a cohorte feature. args = {feature: "<feature_id>"}.',
  phases: [
    { title: 'Profile', detail: 'PIPELINE.md → JSON via profile-reader', model: 'haiku' },
    { title: 'Preflight', detail: 'typecheck + lint + tests — abort while red', model: 'haiku' },
    { title: 'Stage', detail: 'git diff --stat once, per-surface hunks to disk', model: 'haiku' },
    { title: 'Review', detail: 'one review agent per touched surface' },
    { title: 'Cross-check', detail: 'adversarial refutation of CRITICAL/security findings' },
    { title: 'Merge', detail: 'stage merged report + metrics; return the verdict', model: 'haiku' },
  ],
}

// The Workflow runtime hands `args` to a script verbatim, so a caller that passes a
// JSON-ENCODED STRING instead of a real object gets that string back here. The old
// `typeof args === 'string' ? args.trim()` then took the whole blob as the value — which
// is how a report landed on disk named `specs/reports/{"feature": "x"}.md`, and how
// maxRounds/smoke were silently dropped on the same run. Parse it back into the object
// it was meant to be; a bare slug stays valid shorthand.
const ARGS = (() => {
  if (typeof args === 'string') {
    const t = args.trim()
    if (t.startsWith('{')) {
      try { const o = JSON.parse(t); if (o && typeof o === 'object' && !Array.isArray(o)) return o } catch {}
    }
    return { feature: t, target: t }
  }
  return args && typeof args === 'object' ? args : {}
})()
const isSlug = s => typeof s === 'string' && /^[A-Za-z0-9._-]+$/.test(s)
const feature = ARGS.feature
if (!feature) throw new Error('cohorte-review needs args = {feature: "<feature_id>"}')
if (!isSlug(feature)) {
  throw new Error(`cohorte-review got a feature id that is not a slug: ${JSON.stringify(feature)}. ` +
    'Pass args as a real object, e.g. {feature: "titlebar-project-switcher"} — not a JSON string.')
}

// The profile-reader returns through a StructuredOutput tool call, and a haiku agent
// intermittently nests the whole profile as a JSON *string* under a single wrapper field
// ({"output": "{\"surfaces\": …}"}) instead of putting the profile's keys at the top level.
// The schema here used to be {type:'object', additionalProperties:true} — no declared
// properties, no required keys — so that wrapper validated cleanly and every field then read
// as undefined: `surfaces` fell back to [], parallel([]) dispatched zero agents, the
// dead-agent guard had no surfaces to find missing, and the run reported a verdict having
// done nothing. On the surface it is indistinguishable from a clean run with an empty diff.
// Declaring the shape gives the tool layer something to validate and the agent something to
// aim at; unwrapProfile() salvages a wrapped return that still gets through; and the
// zero-surface abort below makes the silent-success path impossible either way.
// See also the structured-output section of core/agents/profile-reader.md.
const PROFILE = {
  type: 'object', additionalProperties: true,
  properties: {
    error: { type: 'string', description: 'set ONLY when PIPELINE.md is missing or unparseable' },
    surfaces: {
      type: 'array',
      description: "one entry per surface, at the TOP LEVEL of this object — never a JSON string",
      items: {
        type: 'object', required: ['key'], additionalProperties: true,
        properties: { key: { type: 'string' }, path: { type: 'string' }, agent: { type: 'string' } },
      },
    },
  },
}

// Salvage a profile handed back as JSON text rather than as an object — either the whole
// return, or nested under a single wrapper field. Anything already shaped like a profile
// (has `surfaces`, or is the documented `{error}` failure shape) passes through untouched.
const unwrapProfile = p => {
  if (typeof p === 'string') { try { return JSON.parse(p) } catch { return null } }
  if (!p || typeof p !== 'object') return null
  if (Array.isArray(p.surfaces) || p.error) return p
  for (const v of Object.values(p)) {
    if (typeof v !== 'string') continue
    try {
      const inner = JSON.parse(v)
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
    } catch {}
  }
  return p
}

const PREFLIGHT = {
  type: 'object', required: ['pass'], additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    tail: { type: 'string', description: 'on failure: the raw last lines the script printed' },
  },
}

const STAGE = {
  type: 'object', required: ['surfaces'], additionalProperties: false,
  properties: {
    surfaces: {
      type: 'array',
      items: {
        type: 'object', required: ['key', 'diff', 'files'], additionalProperties: false,
        properties: {
          key: { type: 'string' },
          diff: { type: 'string', description: 'path of the staged .diff file' },
          files: { type: 'array', items: { type: 'string' }, description: 'changed files (from --stat)' },
        },
      },
    },
  },
}

const FINDING = {
  type: 'object', required: ['severity', 'file', 'line', 'kind', 'problem', 'fix'],
  additionalProperties: false,
  properties: {
    severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    file: { type: 'string' }, line: { type: 'integer' },
    kind: { enum: ['spec-violation', 'quality', 'security'] },
    problem: { type: 'string', description: 'one line, no code excerpts' },
    fix: { type: 'string', description: 'one concrete change, one line' },
  },
}

// A DEFERRED finding is real but out of this feature's scope (pre-existing code the
// diff never touched). It carries its own out-of-scope reason, counts in no severity
// row, is never cross-checked, and can never move the verdict — it is routed to
// specs/refactor-backlog.md so /cohorte-refactor owns it. See core/agents/review.md §Deferred.
const DEFERRED = {
  type: 'object', required: ['severity', 'file', 'line', 'kind', 'problem', 'fix', 'outOfScope'],
  additionalProperties: false,
  properties: {
    severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    file: { type: 'string' }, line: { type: 'integer' },
    kind: { enum: ['quality', 'security', 'rule'] },
    problem: { type: 'string', description: 'one line, no code excerpts' },
    fix: { type: 'string', description: 'one concrete change, one line' },
    outOfScope: { type: 'string', description: 'one line: why this feature does not own it' },
  },
}

const REPORT = {
  type: 'object', required: ['verdict', 'findings'], additionalProperties: false,
  properties: {
    verdict: { enum: ['SHIP', 'REVISE', 'BLOCK'] },
    findings: { type: 'array', maxItems: 20, items: FINDING },
    deferred: { type: 'array', maxItems: 10, items: DEFERRED },
    overflow: { type: 'integer', description: 'findings beyond the 20-item cap, if any' },
    notes: { type: 'string', description: 'RBAC / mobile-first assessment only, when the profile enables them' },
  },
}

const VERDICT = {
  type: 'object', required: ['refuted', 'reason'], additionalProperties: false,
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string', description: 'one line: why the finding does or does not hold' },
  },
}

// ── Phase 0 — profile ────────────────────────────────────────────────────────
phase('Profile')
const profile = unwrapProfile(await agent(
  'Return this project\'s PIPELINE.md `yaml pipeline-profile` block as JSON, per your instructions.',
  { agentType: 'profile-reader', label: 'profile', schema: PROFILE, effort: 'low' },
))
if (!profile || profile.error) {
  return { verdict: 'ABORTED', reason: `profile unreadable: ${(profile && profile.error) || 'profile-reader returned nothing'}` }
}
const cmds = profile.commands || {}
const base = (profile.vcs && profile.vcs.default_branch) || 'main'
const surfaces = Array.isArray(profile.surfaces) ? profile.surfaces : []
// A profile with no surfaces cannot do this workflow's work, and every later
// guard compares against `surfaces` — an empty list makes them all vacuously
// pass. Fail loudly here instead of finishing with nothing done.
if (!surfaces.length) {
  return { verdict: 'ABORTED', reason: 'profile has no surfaces — nothing would be reviewed. the `yaml pipeline-profile` block in PIPELINE.md is empty or unparseable, or the profile-reader mis-returned; run /cohorte-doctor' }
}
const quiet = (q, full) => (q && !String(q).startsWith('<') ? q : full ? `${full} 2>&1 | tail -40` : '')
const checks = [cmds.typecheck, quiet(cmds.lint_quiet, cmds.lint), quiet(cmds.test_quiet, cmds.test)]
  .filter(c => c && !String(c).startsWith('<'))

// ── Phase 1 — deterministic preflight (abort while red, zero reviewers) ─────
phase('Preflight')
const pre = await agent(
  `Run the cohorte deterministic pre-flight for feature ${feature} in ONE Bash call:\n` +
  `<core>/pipeline/scripts/preflight.sh specs/reports/${feature}.preflight.txt ` +
  checks.map(c => JSON.stringify(c)).join(' ') + '\n' +
  '(<core> = .claude if .claude/pipeline/scripts/preflight.sh exists, else ~/.claude — probe with test -x. ' +
  'Script absent on both: run the quoted commands yourself, each appended to the same report file, stopping at the first failure.) ' +
  'Return pass=true only on a fully green run. On failure set pass=false and put the raw last 40 lines of the report in `tail` — verbatim, no summarizing.',
  { model: 'haiku', label: 'preflight', schema: PREFLIGHT, effort: 'low' },
)
if (!pre || !pre.pass) {
  return {
    verdict: 'ABORTED',
    reason: 'preflight red — fix the mechanical failures (or run /cohorte-fix) before any review; no reviewer was spawned',
    failures: (pre && pre.tail) || 'preflight agent returned nothing',
  }
}

// ── Phase 2 — stage the diff once ────────────────────────────────────────────
phase('Stage')
const surfaceList = surfaces.map(s => `${s.key} → ${s.path}`).join(' · ') || '(none declared)'
const staged = await agent(
  `Stage the review inputs for cohorte feature ${feature}. Diff base: ${base}. Surfaces: ${surfaceList}.\n` +
  `1. ONE call: git diff ${base} --stat > specs/reports/${feature}.stat.txt — never print the diff.\n` +
  '2. Group the changed paths by surface path prefix; paths under no surface are the `shared` remainder — attach them to the most relevant surface.\n' +
  `3. Per surface that has changed paths (ONLY those): git diff ${base} -- <surface.path> [<remainder pathspecs>] > specs/reports/${feature}.<key>.diff\n` +
  '4. Return the touched surfaces with their staged diff path and changed-file list. No changed paths at all ⇒ return an empty surfaces array.',
  { model: 'haiku', label: 'stage-diff', schema: STAGE, effort: 'low' },
)
// A DEAD staging agent returns null, which is not the same fact as "the diff is
// empty" — conflating them handed back verdict SHIP ("nothing to review") for a
// feature nobody had looked at. Distinguish them.
if (!staged) {
  return {
    verdict: 'ABORTED',
    reason: 'the diff-staging agent died — no reviewer was spawned and nothing was reviewed',
    next: `re-run the review workflow, or /cohorte-review ${feature} conversationally`,
  }
}
const touched = staged.surfaces || []
if (!touched.length) return { verdict: 'SHIP', reason: `no diff against ${base} — nothing to review`, findings: 0 }
log(`Touched surfaces: ${touched.map(s => s.key).join(', ')}`)

// ── Phases 3+4 — review each surface, cross-check its hard findings ─────────
// pipeline(): a fast surface's cross-check starts while a slow one still reviews.
const reviewed = await pipeline(
  touched,
  s => agent(
    'Review one feature surface against its frozen spec, per your agent instructions (read the staged ' +
    'diff FIRST; open a full source file only when a finding demands it; capped shape — max 20 findings, ' +
    'one line each, no code excerpts). Put anything real but OUT of this feature\'s scope in `deferred` ' +
    '(max 10, each with its out-of-scope reason) per your §Deferred rules — never in `findings`. — Variable slots: ' +
    `feature ${feature} · scope: the ${s.key} surface only · spec: specs/${feature}.md · ` +
    `staged diff: ${s.diff} · changed files: ${s.files.join(', ')}`,
    { agentType: 'review', label: `review:${s.key}`, phase: 'Review', schema: REPORT },
  ),
  async (report, s) => {
    if (!report) return null
    const hard = report.findings.filter(f => f.severity === 'CRITICAL' || f.kind === 'security')
    const rest = report.findings.filter(f => !hard.includes(f))
    // Deferred items skip the cross-check entirely: refuting one would spend an agent
    // to argue about something that cannot affect the verdict either way.
    const deferred = report.deferred || []
    if (!hard.length) return { key: s.key, report, kept: rest, refuted: [], deferred }
    const votes = await parallel(hard.map(f => () => agent(
      'Adversarially verify ONE review finding — your job is to REFUTE it if you can. Read the staged ' +
      'diff and the exact file:line; refuted=true when the code, a guard, a test, or the spec shows the ' +
      'finding does not hold. Uncertain ⇒ refuted=false (a real CRITICAL must not die on doubt). — ' +
      `Finding: [${f.severity}/${f.kind}] ${f.file}:${f.line} — ${f.problem} (proposed fix: ${f.fix}). ` +
      `Feature ${feature} · spec: specs/${feature}.md · staged diff: ${s.diff}`,
      { agentType: 'review', label: `verify:${s.key}`, phase: 'Cross-check', schema: VERDICT },
    ).then(v => ({ f, refuted: !!(v && v.refuted), reason: v ? v.reason : 'verifier died — kept' }))))
    const checkedVotes = votes.filter(Boolean)
    return {
      key: s.key,
      report,
      kept: rest.concat(checkedVotes.filter(v => !v.refuted).map(v => v.f)),
      refuted: checkedVotes.filter(v => v.refuted).map(v => ({ ...v.f, reason: v.reason })),
      deferred,
    }
  },
)

const results = reviewed.filter(Boolean)
// A reviewer that DIED returns null — and a dead reviewer produces zero findings,
// which is byte-identical to a clean surface. Left unchecked, "every reviewer
// crashed" scores SHIP: the strongest possible verdict from the weakest possible
// evidence. Name the unreviewed surfaces and refuse to certify them.
const unreviewed = touched.filter(s => !results.some(r => r.key === s.key)).map(s => s.key)
if (unreviewed.length) log(`Reviewer died on: ${unreviewed.join(', ')} — those surfaces are NOT reviewed`)
const kept = results.flatMap(r => r.kept.map(f => ({ ...f, surface: r.key })))
const refuted = results.flatMap(r => r.refuted.map(f => ({ ...f, surface: r.key })))
// Deferred findings are deliberately kept OUT of `counts`, out of `verdict` and out
// of `clean`: they belong to /cohorte-refactor, not to this feature's fix loop.
const deferredAll = results.flatMap(r => (r.deferred || []).map(f => ({ ...f, surface: r.key })))
const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
for (const f of kept) counts[f.severity] = (counts[f.severity] || 0) + 1
// Verdict from the findings that SURVIVED the cross-check (a refuted CRITICAL
// must not force a fix loop): security ⇒ BLOCK, CRITICAL ⇒ REVISE, else SHIP —
// but never SHIP while a surface went unreviewed (absence of evidence, not
// evidence of absence).
const verdict = kept.some(f => f.kind === 'security') ? 'BLOCK'
  : kept.some(f => f.severity === 'CRITICAL') ? 'REVISE'
    : unreviewed.length ? 'REVISE' : 'SHIP'
// Only a SHIP whose leftovers are all LOW is a clean bill of health. The
// conversational /cohorte-review routes any surviving CRITICAL/HIGH/security to /cohorte-fix, so
// this path must not answer "/cohorte-ship" on a SHIP that still carries HIGH findings.
const clean = verdict === 'SHIP' && kept.every(f => f.severity === 'LOW')

// ── Phase 5 — stage the merged report; only the verdict leaves the workflow ──
phase('Merge')
const findingLine = f =>
  `- [${f.severity}] \`${f.file}:${f.line}\` · ${f.kind} · ${f.problem} → **Fix:** ${f.fix}`
const reportBody = [
  '# REVIEW REPORT', `feature_id: ${feature} · merged by cohorte-review workflow`, '',
  '| Severity | Count |', '| -------- | ----- |',
  ...['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => `| ${s} | ${counts[s] || 0} |`), '',
  `Verdict: ${verdict}`, '', '## Findings', '',
  kept.length ? kept.map(findingLine).join('\n') : 'None.',
  '', '## Deferred', '',
  deferredAll.length
    ? deferredAll.map(f => `${findingLine(f)} · out of scope: ${f.outOfScope} · deferred:${feature}`).join('\n')
    : 'None.',
  ...(unreviewed.length ? ['', '## NOT reviewed (reviewer died — no verdict on these)', '',
    unreviewed.map(k => `- \`${k}\` — re-run /cohorte-review ${feature} (or the review workflow)`).join('\n')] : []),
  ...(refuted.length ? ['', '## Refuted by cross-check (no action needed)', '',
    refuted.map(f => `- ${f.file}:${f.line} · ${f.problem} — refuted: ${f.reason}`).join('\n')] : []),
].join('\n')
const staging = await agent(
  `Stage a cohorte review report and its metrics, mechanically:\n` +
  `1. Write EXACTLY this content to specs/reports/${feature}.md (overwrite):\n<<<REPORT\n${reportBody}\nREPORT\n` +
  `2. Append one line to $(dirname "$(git rev-parse --git-common-dir)")/.claude/pipeline-metrics.jsonl: ` +
  `{"ts":"<ISO now>","feature":"${feature}","phase":"review","seconds":0,"surfaces":{${results.map(r => `"${r.key}":"${verdict}:${r.kept.length}"`).join(',')}}}\n` +
  `3. Chain the opt-in usage ping: <core>/pipeline/scripts/telemetry-send.sh review "${feature}" 0 "${verdict}:${kept.length}" || true ` +
  '(<core> = .claude if .claude/pipeline/scripts/telemetry-send.sh exists, else ~/.claude; script on neither ⇒ skip the ping).\n' +
  // Deferred findings must land in the backlog on EVERY verdict — parked only on a
  // SHIP is parked nowhere the rest of the time, which is the leak this closes.
  (deferredAll.length
    ? `3b. Route the deferred findings to specs/refactor-backlog.md (create it if absent): for each line below, ` +
      `append it under the \`## <domain>\` heading named in its prefix (create that heading if absent) — with \`>>\`, ` +
      `never by rewriting the file, and skip any whose file path + first words already appear there (grep -F first, ` +
      `they may be left from a prior round or an /cohorte-audit):\n` +
      deferredAll.map(f =>
        `${f.surface}||- [ ] ${f.severity} · ${f.file}:${f.line} · ${f.kind} · ${f.fix} · deferred:${feature}`).join('\n') +
      '\n'
    : '') +
  // Stamp + tick only when nothing above LOW survived: the conversational /cohorte-review
  // keeps the stamp only for LOW findings, and a SHIP verdict here can still carry
  // HIGH/MEDIUM ones — certifying those for /cohorte-ship would ship known defects. A dead
  // reviewer already forced the verdict off SHIP, so `clean` covers that too.
  (clean
    ? `4. Stamp the freshness gate in specs/${feature}.md's front-matter, exactly as the conversational /cohorte-review §3 does ` +
      `(so /cohorte-ship can prove the reviewed code is what ships): BASE=$(git merge-base ${base} HEAD); set reviewed_base: $BASE and ` +
      `reviewed_digest: $(git diff $BASE -- . ':(exclude)specs/' | sha256sum | cut -c1-16). ` +
      '5. Tick the spec DoD boxes this run verified (spec conformance + copy language — review SHIP; tests/lint/typecheck — green preflight); leave the rest unticked.\n'
    : '') +
  'Return the single word: done.',
  { model: 'haiku', label: 'stage-report', effort: 'low' },
)

// The staging agent writes the report, the metrics line, and (when clean) the
// freshness stamp + DoD ticks. If it died, none of that is on disk — returning
// `report: <path>` and "/cohorte-ship" would point the human at a file that does not
// exist and certify a stamp that was never written.
const staged_ok = staging != null && /done/i.test(String(staging))

return {
  verdict,
  counts,
  deferred: deferredAll.length,     // parked in the backlog for /cohorte-refactor — never blocking
  refutedByCrossCheck: refuted.length,
  reportStaged: staged_ok,
  unreviewedSurfaces: unreviewed,   // reviewers that died — these carry NO verdict
  criticals: kept.filter(f => f.severity === 'CRITICAL' || f.kind === 'security')
    .map(f => `[${f.surface}] ${f.file}:${f.line} — ${f.problem}`),
  report: staged_ok ? `specs/reports/${feature}.md` : '(NOT written — the staging agent died)',
  next: !staged_ok
    ? `the report/metrics/freshness stamp were NEVER written (staging agent died) — the verdict above is real, but nothing is on disk: re-run the review workflow, or /cohorte-review ${feature}`
    : unreviewed.length
      ? `re-run the review — no reviewer completed on: ${unreviewed.join(', ')}`
      : clean
        ? `/cohorte-ship ${feature} (DoD ticked + freshness stamped)`
        : verdict === 'SHIP'
        ? `/cohorte-fix ${feature} — SHIP verdict, but ${kept.length} finding(s) above LOW survived; park them in specs/refactor-backlog.md instead if you deliberately defer them`
        : `/cohorte-fix ${feature}`,
}
