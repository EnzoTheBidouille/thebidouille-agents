// cohorte — the FULL dev cycle as one deterministic workflow (opt-in):
// contract → build → [preflight → review(+cross-check) (∥ smoke if opted in) → fix]* → done.
//
// Invoke with args = {feature: "<feature_id>", maxRounds?: 5, smoke?: true} in the
// feature's checkout (main checkout on the feature branch, or its worktree).
// Smoke is OFF by default — running the app every round is the human's call
// (/cycle <id> smoke, or standalone /smoke before /ship).
//
// The contract with the human: a workflow can NEVER ask a question mid-run, so
// everything decisional is moved to the edges —
//   · UPSTREAM: the spec must be frozen and self-sufficient (design links in the
//     front-matter, complete §5 contract). A readiness gate checks this FIRST
//     and aborts with the list of gaps as `questions` before spending anything.
//     A well-run /brainstorm + /spec IS the answer sheet — the sharper it is,
//     the further the cycle runs with an empty questions array.
//   · DOWNSTREAM: the loop runs review→fix→review until ZERO open findings and
//     a PASS smoke (bounded by maxRounds + the token budget). Even a finding
//     that implies a CONTRACT change stays inside the loop: a lead-equivalent
//     agent re-authors spec §5 + the contract file (exactly what /fix does
//     conversationally — implementers still never touch it), the affected
//     surfaces re-dispatch, and the loop continues. Only what is genuinely
//     human comes back at the END, in the result's `questions` array (spec
//     ambiguities the readiness gate flagged, a hit round-cap/budget) — ready
//     to feed a follow-up fix/review loop if you decide to keep going.
// /ship stays out on purpose: it is the outward-facing, irreversible gate and
// keeps its human confirmation. A SHIP exit ticks the DoD + stamps the
// freshness gate, so `/ship <id>` right after is a straight shot.
//
// Loop economics: when smoke is opted in it runs CONCURRENTLY with review each
// round (both observe, neither edits); fix rounds re-dispatch only the surfaces
// owning findings;
// the loop is bounded by maxRounds AND by the session token budget if one is
// set. Disk state stays pipeline-coherent: reports staged to specs/reports/,
// unresolved findings appended to the spec's ## Remediation — a conversational
// /fix can always pick up where the workflow stopped.

export const meta = {
  name: 'cohorte-cycle',
  description: 'Full cohorte dev cycle: contract, parallel build, then bounded review→fix rounds (smoke opt-in via args.smoke); deferred questions in the output, never mid-run',
  whenToUse: 'Only when the human explicitly asks to run the full dev-cycle workflow on a FROZEN spec. args = {feature: "<feature_id>", maxRounds?: 5, smoke?: true}.',
  phases: [
    { title: 'Profile', detail: 'PIPELINE.md → JSON via profile-reader', model: 'haiku' },
    { title: 'Ready', detail: 'spec frozen + self-sufficient, or abort with the gaps', model: 'haiku' },
    { title: 'Contract', detail: 'author the frozen contract from spec §5' },
    { title: 'Build', detail: 'one implementer per surface, parallel' },
    { title: 'Verify', detail: 'per round: preflight → review + cross-check (∥ smoke if opted in)' },
    { title: 'Fix', detail: 'per round: re-dispatch only the surfaces with findings' },
    { title: 'Close', detail: 'reports, Remediation/DoD, freshness stamp, metrics', model: 'haiku' },
  ],
}

const feature = typeof args === 'string' ? args.trim() : args && args.feature
if (!feature) throw new Error('cohorte-cycle needs args = {feature: "<feature_id>"}')
// Runaway protection, not a target — the loop's real exit is 0 findings (+ PASS if smoking).
const MAX_ROUNDS = Math.max(1, (args && args.maxRounds) || 5)
// Smoke is the human's call: booting infra every round is expensive, and lib-only
// projects have nothing to smoke. Off ⇒ the cycle verifies by review alone, the
// runtime-flow DoD boxes stay unticked, and /smoke remains available standalone.
const SMOKE_ON = !!(args && args.smoke)

const questions = []        // every deferred human decision ends up here — emitted at the END
const contractChanges = []  // contract re-authorings the loop performed (info, not questions)

const PROFILE = { type: 'object', additionalProperties: true }
const READY = {
  type: 'object', required: ['frozen', 'gaps', 'designLinks'], additionalProperties: false,
  properties: {
    frozen: { type: 'boolean', description: 'front-matter status is frozen or in-review' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'anything the cycle would have had to ask about' },
    designLinks: { type: 'string', description: 'the design_files links, comma-joined, or "none"' },
  },
}
const PREFLIGHT = {
  type: 'object', required: ['pass'], additionalProperties: false,
  properties: { pass: { type: 'boolean' }, tail: { type: 'string' } },
}
const STAGE = {
  type: 'object', required: ['surfaces'], additionalProperties: false,
  properties: {
    surfaces: {
      type: 'array',
      items: {
        type: 'object', required: ['key', 'diff', 'files'], additionalProperties: false,
        properties: {
          key: { type: 'string' }, diff: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
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
    problem: { type: 'string' }, fix: { type: 'string' },
  },
}
const REPORT = {
  type: 'object', required: ['verdict', 'findings'], additionalProperties: false,
  properties: {
    verdict: { enum: ['SHIP', 'REVISE', 'BLOCK'] },
    findings: { type: 'array', maxItems: 20, items: FINDING },
    overflow: { type: 'integer' },
  },
}
const VERDICT = {
  type: 'object', required: ['refuted', 'reason'], additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
}
const SMOKE = {
  type: 'object', required: ['pass', 'failures'], additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    failures: {
      type: 'array', maxItems: 10,
      items: { type: 'string', description: '❌ <flow/endpoint> · expected <x> got <y> · file hint if known' },
    },
  },
}

// ── Phase 0 — profile ────────────────────────────────────────────────────────
phase('Profile')
const profile = await agent(
  'Return this project\'s PIPELINE.md `yaml pipeline-profile` block as JSON, per your instructions.',
  { agentType: 'profile-reader', label: 'profile', schema: PROFILE, effort: 'low' },
)
if (!profile || profile.error) {
  return { outcome: 'ABORTED', questions: [`profile unreadable: ${(profile && profile.error) || 'no return'} — run /init-pipeline or /doctor`] }
}
const surfaces = Array.isArray(profile.surfaces) ? profile.surfaces : []
const byKey = Object.fromEntries(surfaces.map(s => [s.key, s]))
const cmds = profile.commands || {}
const base = (profile.vcs && profile.vcs.default_branch) || 'main'
const contract = profile.contract || {}
const contractFile = contract.enabled ? `${contract.path}/${feature}.${contract.ext || 'ts'}` : ''
const quiet = (q, full) => (q && !String(q).startsWith('<') ? q : full ? `${full} 2>&1 | tail -40` : '')
const checks = [cmds.typecheck, quiet(cmds.lint_quiet, cmds.lint), quiet(cmds.test_quiet, cmds.test)]
  .filter(c => c && !String(c).startsWith('<'))

// ── Phase 1 — readiness gate: the spec must pre-answer everything ───────────
phase('Ready')
const ready = await agent(
  `Readiness check for the cohorte full-cycle workflow on spec specs/${feature}.md — the run can ask ` +
  'NOTHING mid-flight, so list every gap a lead would normally have to ask about. Read the spec ' +
  '(front-matter + §5 contract + per-surface tasks + §9 acceptance) and report:\n' +
  '- frozen: front-matter status is `frozen` or `in-review`\n' +
  '- gaps: e.g. status draft/missing; §5 contract absent or with open placeholders/TODOs; a surface\'s ' +
  'tasks empty while §5 clearly implies work there; `design_files` empty while a uses_design surface ' +
  `has tasks (uses_design surfaces: ${surfaces.filter(s => s.uses_design).map(s => s.key).join(', ') || 'none'}); ` +
  'open `## Remediation` items that imply a contract change\n' +
  '- designLinks: the design_files links comma-joined, or "none"',
  { model: 'haiku', label: 'ready', schema: READY, effort: 'low' },
)
if (!ready || !ready.frozen) {
  return {
    outcome: 'NOT-READY',
    questions: ((ready && ready.gaps) || ['spec unreadable']).concat(
      ['freeze the spec first: /spec (the cycle only runs on a frozen, self-sufficient spec)']),
  }
}
questions.push(...(ready.gaps || []))   // non-blocking gaps ride along as deferred questions
const designLinks = ready.designLinks || 'none'

// ── Phase 2 — author the contract (lead-equivalent, the single sync channel) ─
if (contract.enabled) {
  phase('Contract')
  const c = await agent(
    `Author the frozen contract for cohorte feature ${feature}, acting as the lead (/build §2): from ` +
    `spec specs/${feature}.md §5, write/update ${contractFile} in the profile's mechanism ` +
    `(${contract.mechanism})${contract.index ? `, exported from ${contract.index}` : ''}. ` +
    'Postcondition: the file exists and typechecks. Implementers import it read-only. ' +
    'Return one line: what you wrote, or what blocked you.',
    { label: 'contract' },
  )
  if (c == null) return { outcome: 'ABORTED', questions: questions.concat(['contract authoring failed — run /build manually']) }
}

// ── Phase 3 — build: one implementer per surface, parallel ───────────────────
phase('Build')
const buildPrompt = s =>
  `Implement the **${s.key}** surface for feature \`${feature}\`. Read \`PIPELINE.md\` first. ` +
  `Spec: \`specs/${feature}.md\`. Contract: \`${contractFile || 'none — spec §5 prose is the contract'}\` ` +
  '(import read-only). Work test-first. Touch only `' + s.path + '`. Need the current state of your ' +
  `tree? Compute it yourself: \`git diff ${base} -- ${s.path}\`. Return the handoff in the format ` +
  `your agent instructions define. Design files: ${s.uses_design ? designLinks : 'none'}. ` +
  'Open Remediation items for YOUR surface (`none` ⇒ first build, implement the spec\'s tasks for ' +
  'your surface): none'
const handoffs = await parallel(surfaces.map(s => () =>
  agent(buildPrompt(s), { agentType: s.agent, label: `build:${s.key}`, phase: 'Build' })
    // agent() resolves to null (never throws) when a subagent dies — wrapping
    // unconditionally would hide every death from the `dead` check below.
    .then(h => (h == null ? null : { key: s.key, handoff: h }))))
const built = handoffs.filter(Boolean)
const dead = surfaces.filter(s => !built.some(b => b.key === s.key)).map(s => s.key)
if (dead.length) questions.push(`implementer(s) died during build: ${dead.join(', ')} — inspect and re-run /build if their surface matters`)

// ── helpers for the verify/fix rounds ────────────────────────────────────────
const surfaceOf = file => {
  for (const s of surfaces) if (file && String(file).startsWith(String(s.path))) return s.key
  return null
}
const itemLine = f => `- [ ] ${f.severity} · ${f.file}:${f.line} · ${f.kind} · ${f.fix}`
const runPreflight = () => agent(
  `Run the cohorte deterministic pre-flight for feature ${feature} in ONE Bash call:\n` +
  `<core>/pipeline/scripts/preflight.sh specs/reports/${feature}.preflight.txt ` +
  checks.map(c => JSON.stringify(c)).join(' ') + '\n' +
  '(<core> = .claude if .claude/pipeline/scripts/preflight.sh exists, else ~/.claude; script absent ⇒ ' +
  'run the quoted commands yourself into the same file, stopping at the first failure.) ' +
  'pass=true only on fully green; on failure put the raw last 40 lines in tail, verbatim.',
  { model: 'haiku', label: 'preflight', phase: 'Verify', schema: PREFLIGHT, effort: 'low' },
)

let verdict = null
let smokePass = false
let smokeFails = []      // last round's smoke failures — Close reports the real count
let open = []            // findings still open, each {severity,file,line,kind,problem,fix,src}
let unreviewed = []      // surfaces whose reviewer died this round — they carry NO verdict
let rounds = 0
let fixRounds = 0        // fix dispatches performed — the close step's `fix` usage ping needs it
let preflightRed = false // did the LAST round end on a red preflight (open/verdict then stale)?

// ── Phases 4/5 — bounded verify → fix rounds ────────────────────────────────
while (rounds < MAX_ROUNDS && (!budget.total || budget.remaining() > 30000)) {
  rounds++
  log(`Round ${rounds}/${MAX_ROUNDS}`)
  phase('Verify')

  // 4a. preflight — mechanical red short-circuits straight to a fix round
  const pre = await runPreflight()
  preflightRed = !pre || !pre.pass
  if (preflightRed) {
    const tail = (pre && pre.tail) || ''
    const hit = new Set(surfaces.filter(s => tail.includes(String(s.path))).map(s => s.key))
    const targets = (hit.size ? [...hit] : built.map(b => b.key)).filter(k => byKey[k])
    // No target = nobody to dispatch, so the next round finds the same red gates
    // and spins again: the loop would burn every remaining round doing literally
    // nothing, then report a stale verdict. Stop and say why instead.
    if (!targets.length) {
      questions.push(
        'the mechanical gates are RED but no surface owns the failure (nothing in the tail matches a ' +
        `surface path, and no implementer survived the build) — fix it by hand, then rerun /cycle ${feature}. ` +
        `Failure tail:\n${tail.slice(-1500)}`)
      break
    }
    log(`Preflight red — mechanical fix round on: ${targets.join(', ')}`)
    phase('Fix')
    fixRounds++
    await parallel(targets.map(k => () => agent(
      `Fix loop for feature \`${feature}\` on your surface (**${k}**). Read \`PIPELINE.md\` first. ` +
      `Contract: \`${contractFile || 'spec §5'}\` (read-only). Touch only \`${byKey[k].path}\`. ` +
      'The mechanical gates (typecheck/lint/tests) are RED. Raw failure tail below — fix exactly ' +
      'what concerns your tree, then rerun your quiet commands until green. Failures:\n' + tail,
      { agentType: byKey[k].agent, label: `fix:${k}`, phase: 'Fix' })))
    continue
  }

  // 4b. stage the diff once for the reviewers
  const staged = await agent(
    `Stage review inputs for cohorte feature ${feature}. Diff base: ${base}. Surfaces: ` +
    surfaces.map(s => `${s.key} → ${s.path}`).join(' · ') + '.\n' +
    `1. git diff ${base} --stat > specs/reports/${feature}.stat.txt (never print it). ` +
    '2. Group changed paths by surface prefix (unowned paths = shared remainder → most relevant surface). ' +
    `3. Per touched surface only: git diff ${base} -- <path> [remainder] > specs/reports/${feature}.<key>.diff. ` +
    '4. Return the touched surfaces (empty array if no diff).',
    { model: 'haiku', label: 'stage-diff', phase: 'Verify', schema: STAGE, effort: 'low' },
  )
  // "The staging agent died" and "there is genuinely no diff" are different facts;
  // conflating them diagnosed a dead agent as a wrong branch.
  if (!staged) { questions.push('the diff-staging agent died — nothing could be reviewed this round; rerun the cycle'); break }
  const touched = staged.surfaces || []
  if (!touched.length) { questions.push(`no diff against ${base} after build — wrong branch/checkout?`); break }

  // 4c. review(+cross-check), ∥ smoke only when the human opted in — both observe, neither edits
  const [smoke, reviewed] = await parallel([
    () => !SMOKE_ON ? Promise.resolve(null) : agent(
      'Smoke-test one feature, per your agent instructions (bring it up, exercise the contract + §8 UI ' +
      'flows, stage the full SMOKE REPORT, tear down; return the capped shape — pass + max 10 one-line ' +
      `failures with a file hint when you have one). — Variable slots: feature ${feature} · spec: ` +
      `specs/${feature}.md · contract: ${contractFile || 'spec §5'} · report: specs/reports/${feature}.smoke.md · ` +
      'checkout: the current working directory (already the feature checkout) · ports/db: the profile/slot defaults',
      { agentType: 'smoke', label: 'smoke', phase: 'Verify', schema: SMOKE }),
    () => pipeline(
      touched,
      s => agent(
        'Review one feature surface against its frozen spec, per your agent instructions (staged diff ' +
        'FIRST; capped shape — max 20 one-line findings, no code excerpts). — Variable slots: ' +
        `feature ${feature} · scope: the ${s.key} surface only · spec: specs/${feature}.md · ` +
        `staged diff: ${s.diff} · changed files: ${s.files.join(', ')}`,
        { agentType: 'review', label: `review:${s.key}`, phase: 'Verify', schema: REPORT }),
      async (report, s) => {
        if (!report) return null
        const hard = report.findings.filter(f => f.severity === 'CRITICAL' || f.kind === 'security')
        const rest = report.findings.filter(f => !hard.includes(f))
        if (!hard.length) return { key: s.key, kept: rest }
        const votes = await parallel(hard.map(f => () => agent(
          'Adversarially verify ONE review finding — REFUTE it if you can (code, guard, test, or spec ' +
          'shows it does not hold); uncertain ⇒ refuted=false. — Finding: ' +
          `[${f.severity}/${f.kind}] ${f.file}:${f.line} — ${f.problem} (fix: ${f.fix}). ` +
          `Feature ${feature} · spec: specs/${feature}.md · staged diff: ${s.diff}`,
          { agentType: 'review', label: `verify:${s.key}`, phase: 'Verify', schema: VERDICT },
        ).then(v => ({ f, refuted: !!(v && v.refuted) }))))
        return { key: s.key, kept: rest.concat(votes.filter(Boolean).filter(v => !v.refuted).map(v => v.f)) }
      },
    ),
  ])

  smokePass = !!(smoke && smoke.pass)
  smokeFails = (smoke && smoke.failures) || []
  const reviewedOk = (reviewed || []).filter(Boolean)
  // A reviewer that DIED returns null, and a dead reviewer yields zero findings —
  // byte-identical to a clean surface. Unchecked, "every reviewer crashed" scores
  // SHIP and this loop exits SHIP-READY, ticking the DoD and stamping the freshness
  // gate over code nobody read. Track the surfaces that carry no verdict.
  unreviewed = touched.filter(s => !reviewedOk.some(r => r.key === s.key)).map(s => s.key)
  open = reviewedOk.flatMap(r => r.kept.map(f => ({ ...f, src: r.key })))
  verdict = open.some(f => f.kind === 'security') ? 'BLOCK'
    : (open.length || unreviewed.length) ? 'REVISE' : 'SHIP'
  log(`Round ${rounds}: review ${verdict} (${open.length} finding(s)` +
    `${unreviewed.length ? `, ${unreviewed.length} surface(s) UNREVIEWED: ${unreviewed.join(', ')}` : ''}) · ` +
    `smoke ${!SMOKE_ON ? 'SKIPPED' : smokePass ? 'PASS' : `FAIL:${smokeFails.length}`}`)

  // The loop's contract is ZERO open findings on FULLY reviewed surfaces + a smoke
  // PASS when smoking — a SHIP verdict alone (which older revisions granted despite
  // HIGH/MEDIUM leftovers) is not enough. Smoke off ⇒ review alone decides, at the
  // human's explicit risk.
  if (!open.length && !unreviewed.length && (smokePass || !SMOKE_ON)) break
  if (rounds >= MAX_ROUNDS) break
  // Nothing to fix, but a reviewer died: spend the next round re-reviewing rather
  // than dispatching a fix round with no items (which would fall through to the
  // "findings map to no surface" abort and end the run on a misleading question).
  if (!open.length && !smokeFails.length && unreviewed.length) {
    log(`No findings, but ${unreviewed.join(', ')} went unreviewed — retrying the review round`)
    continue
  }

  // 5. fix round. Contract-impacting findings stay INSIDE the loop: a
  //    lead-equivalent agent re-authors spec §5 + the contract file (implementers
  //    still never touch it — same division of labor as conversational /fix §1),
  //    and the surfaces it names re-dispatch against the updated shapes.
  phase('Fix')
  fixRounds++
  const contractFindings = contractFile
    ? open.filter(f => String(f.file).startsWith(String(contract.path))) : []
  let rippleSurfaces = []
  if (contractFindings.length) {
    const cf = await agent(
      `Act as the cohorte lead on a contract change for feature ${feature} (exactly /fix §1's contract ` +
      `check): the findings below show the frozen contract is wrong. Update spec specs/${feature}.md §5 ` +
      `accordingly, then re-author ${contractFile} (mechanism: ${contract.mechanism}` +
      `${contract.index ? `, exported from ${contract.index}` : ''}) until it typechecks. Findings:\n` +
      contractFindings.map(f => `- ${f.file}:${f.line} — ${f.problem} (fix: ${f.fix})`).join('\n') + '\n' +
      'Return ONE line: `<what changed> || <comma-separated surface keys that consume the changed shapes>` ' +
      `(surfaces: ${surfaces.map(s => s.key).join(', ')}; when in doubt list them all).`,
      { label: 'contract-fix', phase: 'Fix' },
    )
    // A DEAD contract agent (agent() ⇒ null) must not be reported as a successful
    // re-authoring: doing so both fabricates a `contractChanges` entry and hands
    // every consuming surface a CRITICAL "the contract was RE-AUTHORED — realign"
    // item pointing at a file nobody touched. Same failure shape as a dead
    // reviewer scoring SHIP.
    if (cf == null) {
      questions.push(
        `the contract needed a change (${contractFindings.length} finding(s) under ${contract.path}) but the ` +
        `contract agent died — the contract is UNCHANGED; re-run /fix ${feature} or author it yourself`)
    } else {
      const [what, keys] = String(cf).split('||').map(x => x && x.trim())
      contractChanges.push(what || 'contract re-authored (agent gave no summary)')
      rippleSurfaces = (keys ? keys.split(',').map(k => k.trim()) : surfaces.map(s => s.key))
        .filter(k => byKey[k])
    }
  }

  //    Group the remaining findings by owning surface; smoke failures ride with
  //    the surface their file hint maps to, else the surface with most findings.
  const perSurface = {}
  for (const k of rippleSurfaces) {
    (perSurface[k] = perSurface[k] || []).push(
      `- [ ] CRITICAL · ${contractFile} · spec-violation · the contract was RE-AUTHORED this round (${contractChanges[contractChanges.length - 1]}) — re-read it and realign your surface's implementation + tests`)
  }
  // A finding whose file sits under no surface path AND whose reporting surface
  // is not a live key has no owner: it stays in `open` (so the loop can never
  // exit clean) while nobody is ever dispatched to fix it — a guaranteed burn to
  // the round cap. Surface them instead of dropping them silently.
  const orphaned = []
  for (const f of open.filter(f => !contractFindings.includes(f))) {
    const k = surfaceOf(f.file) || f.src
    if (byKey[k]) (perSurface[k] = perSurface[k] || []).push(itemLine(f))
    else orphaned.push(f)
  }
  if (orphaned.length) {
    questions.push(
      `${orphaned.length} finding(s) map to no surface and were never dispatched — fix them by hand ` +
      `or give their tree a surface in PIPELINE.md: ` +
      orphaned.slice(0, 5).map(f => `${f.file}:${f.line}`).join(', ') +
      (orphaned.length > 5 ? `, +${orphaned.length - 5} more` : ''))
  }
  const fallbackKey = Object.keys(perSurface).sort((a, b) => perSurface[b].length - perSurface[a].length)[0]
    || (built[0] && built[0].key)
  for (const line of smokeFails) {
    const k = surfaceOf((line.match(/[\w./-]+\.\w{1,4}/) || [])[0]) || fallbackKey
    if (byKey[k]) (perSurface[k] = perSurface[k] || []).push(`- [ ] HIGH · runtime · smoke failure · ${line}`)
  }
  if (!Object.keys(perSurface).length) { questions.push('open findings map to no surface — run /fix manually'); break }
  await parallel(Object.entries(perSurface).map(([k, items]) => () => agent(
    `Fix loop for feature \`${feature}\` on your surface (**${k}**). Read \`PIPELINE.md\` first. ` +
    `Contract: \`${contractFile || 'spec §5'}\` (read-only — report mismatches, never edit it). Touch only ` +
    `\`${byKey[k].path}\`. Need your tree's current state? \`git diff ${base} -- ${byKey[k].path}\`. ` +
    'Fix exactly the open items below (self-contained — read only the files they name), then rerun your ' +
    'quiet commands until green. Return the handoff your agent instructions define. Design files: ' +
    `${byKey[k].uses_design ? designLinks : 'none'}. Open items for YOUR surface:\n` + items.join('\n'),
    { agentType: byKey[k].agent, label: `fix:${k}`, phase: 'Fix' })))
}

const smokeOk = !SMOKE_ON || smokePass
const smokeLabel = !SMOKE_ON ? 'SKIPPED' : smokePass ? 'PASS' : 'FAIL'
if (preflightRed) {
  questions.push('the last round ended on a RED preflight — the reported verdict/findings are from the previous round and may already be fixed; rerun /review after the mechanical fixes land')
}
// Only meaningful when the last round actually reviewed: after a preflight-red
// round `unreviewed` still holds the PREVIOUS round's value, and preflightRed's
// own question already says the reported state is one round stale.
if (unreviewed.length && !preflightRed) {
  questions.push(`no reviewer completed on: ${unreviewed.join(', ')} — those surfaces are NOT reviewed (the verdict covers the others only); rerun /review ${feature}`)
}
if (rounds >= MAX_ROUNDS && !(verdict === 'SHIP' && smokeOk)) {
  questions.push(`round cap (${MAX_ROUNDS}) reached with ${open.length} finding(s) open — rerun the cycle (maxRounds higher) or continue with /fix ${feature} + /review`)
}
if (budget.total && budget.remaining() <= 30000 && !(verdict === 'SHIP' && smokeOk)) {
  questions.push('token budget nearly spent — cycle stopped early; rerun the cycle or continue conversationally')
}

// ── Phase 6 — close: reports, spec bookkeeping, freshness stamp, metrics ────
phase('Close')
const success = verdict === 'SHIP' && smokeOk && !unreviewed.length
const findingLine = f => `- **[${f.severity}]** \`${f.file}:${f.line}\` · ${f.kind} · ${f.problem} → **Fix:** ${f.fix}`
const reportBody = [
  '# REVIEW REPORT', `feature_id: ${feature} · merged by cohorte-cycle workflow (round ${rounds})`, '',
  `Verdict: ${verdict || 'NOT-REACHED'} · smoke: ${smokeLabel}`, '', '## Findings', '',
  open.length ? open.map(findingLine).join('\n') : 'None.',
  ...(unreviewed.length ? ['', '## NOT reviewed (reviewer died — no verdict on these)', '',
    unreviewed.map(k => `- \`${k}\` — rerun /review ${feature}`).join('\n')] : []),
].join('\n')
// Per-surface results for the metrics line. `surfaces` means SURFACES: putting the
// run summary (rounds/verdict/smoke) in there made the dashboard render them as
// three phantom surface rows and score `rounds:"1"` as a failed surface.
const surfaceResults = built.map(b => `"${b.key}":"${
  unreviewed.includes(b.key) ? 'error' : `${verdict || 'none'}:${open.filter(f => f.src === b.key).length}`}"`).join(',')
const closed = await agent(
  `Close a cohorte cycle run for feature ${feature}, mechanically:\n` +
  `1. Write EXACTLY this to specs/reports/${feature}.md (overwrite):\n<<<REPORT\n${reportBody}\nREPORT\n` +
  (success
    ? `2. In specs/${feature}.md tick the DoD boxes the cycle verified (spec conformance + copy language — ` +
      'review SHIP; tests/lint/typecheck — green preflight; ' +
      (SMOKE_ON ? 'runtime flows — smoke PASS' : 'runtime flows — LEAVE UNTICKED, smoke was skipped this run') +
      '); leave anything ' +
      'unverified unticked. 3. Stamp the freshness gate in the spec front-matter, exactly as /review §3 ' +
      `does: BASE=$(git merge-base ${base} HEAD); reviewed_base: $BASE; reviewed_digest: ` +
      `$(git diff $BASE -- . ':(exclude)specs/' | sha256sum | cut -c1-16).\n` :
    `2. Append the open findings to specs/${feature}.md \`## Remediation\` under a subheading ` +
      `\`### cohorte-cycle round ${rounds}\`, one \`- [ ]\` line each (so a conversational /fix picks them ` +
      'up):\n' + (open.map(itemLine).join('\n') || '(none — see questions in the workflow result)') + '\n' +
      `3. Set the front-matter status: in-review.\n`) +
  `4. Append ONE metrics line to $(dirname "$(git rev-parse --git-common-dir)")/.claude/pipeline-metrics.jsonl: ` +
  `{"ts":"<ISO now>","feature":"${feature}","phase":"cycle","seconds":0,"rounds":${rounds},"smoke":"${smokeLabel}","surfaces":{${surfaceResults}}}\n` +
  '5. Chain the opt-in usage pings (all funnel phases this run executed, 0 seconds each; ' +
  '<core> = .claude if .claude/pipeline/scripts/telemetry-send.sh exists, else ~/.claude — script on neither ⇒ skip the pings): ' +
  // One result per DECLARED surface, not per survivor: `built` holds only the
  // implementers that returned, so mapping over it reported 2-of-3 as "ok,ok" and
  // the dead one vanished from the funnel entirely.
  `<core>/pipeline/scripts/telemetry-send.sh build "${feature}" 0 "${
    surfaces.map(s => (built.some(b => b.key === s.key) ? 'ok' : 'error')).join(',') || 'error'}" || true; ` +
  (SMOKE_ON ? `<core>/pipeline/scripts/telemetry-send.sh smoke "${feature}" 0 "${smokePass ? 'PASS' : 'FAIL:' + smokeFails.length}" || true; ` : '') +
  (fixRounds ? `<core>/pipeline/scripts/telemetry-send.sh fix "${feature}" 0 "rounds:${fixRounds}" || true; ` : '') +
  `<core>/pipeline/scripts/telemetry-send.sh review "${feature}" 0 "${verdict || 'none'}:${open.length}" || true\n` +
  'Return the single word: done.',
  { model: 'haiku', label: 'close', effort: 'low' },
)

// The close agent is what actually writes the report, ticks the DoD, stamps the
// freshness gate and appends the metrics. If it died, NONE of that is on disk —
// and "SHIP-READY · /ship is a straight shot" would be a claim about a stamp that
// was never written (/ship's freshness gate skips silently when the fields are
// absent, so the human would ship on it).
const closeOk = closed != null && /done/i.test(String(closed))
if (!closeOk) {
  questions.push(
    'the close agent died — the report, DoD ticks, freshness stamp and metrics were NEVER written. ' +
    'The verdict above is real, but nothing landed on disk: rerun the cycle, or run /review ' +
    `${feature} to re-stamp before /ship.`)
}

return {
  outcome: success && closeOk ? 'SHIP-READY' : 'STOPPED',
  rounds,
  verdict: verdict || 'not reached',
  smoke: smokeLabel,
  contractChanges,   // re-authorings the loop performed itself — review them in the diff
  unreviewedSurfaces: unreviewed,   // reviewers that died — these carry NO verdict
  openFindings: open.slice(0, 10).map(f => `[${f.severity}] ${f.file}:${f.line} — ${f.problem}`),
  questions,         // everything deferred to you — empty when /brainstorm + /spec did their job
  report: closeOk ? `specs/reports/${feature}.md` : '(NOT written — the close agent died)',
  next: !closeOk
    ? `nothing was written to disk (close agent died) — rerun the cycle, or /review ${feature} to re-stamp`
    : success
    ? (SMOKE_ON
      ? `/ship ${feature} — DoD ticked + freshness stamped, ship is a straight shot (human confirm stays)`
      : `/ship ${feature} — or /smoke ${feature} first: the cycle skipped it (opt-in), nobody has RUN this code; the runtime DoD boxes are unticked`)
    : `answer the questions, then rerun the cycle — or continue with /fix ${feature} + /review (Remediation is up to date)`,
}
