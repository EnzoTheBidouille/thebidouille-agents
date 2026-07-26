# /research · 04 Produce the report

### 3. Produce the report — single-pass or multi-pass (all via `research-agent`, read-only)

The `research-agent` never touches the store; the orchestrator routes every artifact between passes and
holds them in memory. Each dispatch begins: "Read `~/.claude/thebidouille.config.yaml` (or legacy
`questionnaire.config.yaml`) first for `ui_language`." The orchestrator does the one-time text
**extraction** below (a mechanical Bash step — it never loads the source *content* into its own
context); every actual *reading* of the source still goes through a `research-agent` pass.

Pick the path by source type and size:

- **URL source** ⇒ **single-pass** (WebFetch can't page reliably); no extraction. Skip to §3a.
- **Local PDF** ⇒ run **§3.extract**, then **§3.map** to size it; the plan's `multipass` flag picks §3a
  (false) or §3b (true).

**§3.extract — normalise the local PDF to page text (once, on the orchestrator node).** Subagent nodes
often can't render a PDF (no poppler), so a local source is extracted to plain text ONCE, up front, and
agents read the text — never the binary PDF, and **never a web copy** (which would silently fabricate for
a private document). Run:

```bash
PDF="<local path>"; WORK="$(mktemp -d)/pages"; mkdir -p "$WORK"
PY=python3
$PY -c 'import fitz' 2>/dev/null || $PY -c 'import pypdf' 2>/dev/null || {   # bootstrap a throwaway venv
  $PY -m venv "$WORK/../venv" && PY="$WORK/../venv/bin/python" && "$WORK/../venv/bin/pip" install -q pypdf; }
"$PY" - "$PDF" "$WORK" <<'EOF'
import sys, os
src, out = sys.argv[1], sys.argv[2]
try:
    import fitz; pages=[p.get_text() for p in fitz.open(src)]
except Exception:
    import pypdf; pages=[(p.extract_text() or "") for p in pypdf.PdfReader(src).pages]
for i,t in enumerate(pages,1): open(os.path.join(out,f"p{i:04d}.txt"),"w").write(t)
avg=sum(len(t) for t in pages)//max(len(pages),1)
print(f"PAGES={len(pages)} AVGCHARS={avg} WORK={out}")
EOF
```

Note the printed `WORK=` dir and `PAGES=`. **Scanned-PDF guard:** if `AVGCHARS` is very low (≲ 100),
the PDF has no text layer (image scan) — **stop** and tell the human it needs OCR (out of scope), or to
supply a text PDF. Otherwise pass the `WORK` dir + page count to every subsequent pass.

**§3.map — reading plan.** Spawn one `research-agent` (job `map`): "Job: map. research_brief (inline):
<brief>. Extracted page text in `<WORK>` (`p0001.txt` … `p{PAGES}.txt`), total_pages `<PAGES>`. Read the
front-matter / TOC pages there and return `===PLAN.JSON===` per your spec — segments covering the whole
document (~20–35 pages each), `multipass`, `total_pages`." Parse the plan (re-dispatch once if it doesn't
parse).

**§3a — single-pass** (small source, or URL). Spawn one `research-agent` (job `analyse-full`): "Job:
analyse-full. Produce a standalone research report for run `<run-id>`. research_brief (inline): <brief>.
Source: **local ⇒ extracted page text in `<WORK>` (`p0001.txt` … `p{PAGES}.txt`) — read it, never the
PDF, never a web copy; URL ⇒ WebFetch `<url>`** (if unreachable, flag it in the methodology note and
reconstruct from clearly-labelled secondary sources). Return EXACTLY one `===REPORT.MD===` — the full
9-section skeleton, argued prose, precise citations, explicit epistemic status, numbers with references,
length scaled to the source (completeness is the ceiling), NOT questionnaire-shaped." That block **is**
the report; go to §4.

**§3b — multi-pass** (large source). Guarantees a long, exhaustive report by never asking one dispatch
to emit the whole thing:

1. **Fan out, one segment per agent (in parallel).** For each `segments[]` entry, spawn a `research-agent`
   (job `analyse-segment`) **in the same message** so they run concurrently: "Job: analyse-segment.
   research_brief (inline): <brief>. Extracted page text in `<WORK>`. Segment: « <title> », pages <X-Y>
   — read ONLY `p{X..Y}.txt` there (never the PDF, never a web copy). Return EXACTLY one
   `===PARTIAL.MD===` per your spec (deep analysis of this segment + Fils transverses + Sources
   (segment))." Collect every partial. **If a segment returns `===READ-FAILED===`** (missing/empty page
   text), re-extract that range and re-dispatch once; if it still fails, surface it to the human — never
   accept a partial that reconstructed a local source from the web.
2. **Synthesise the cross-cutting sections.** Spawn one `research-agent` (job `synthesise`): "Job:
   synthesise. Subject: <subject>. You are given each segment's Fils transverses + Sources (segment)
   below (not the full bodies). <inline: for every partial, its « ### Fils transverses » and « ### Sources
   (segment) » blocks, each under its segment title>. Return EXACTLY one `===SYNTH.MD===` per your spec —
   unified Synthèse/Questions ouvertes, merged deduped bibliography, unified licence table; note the
   multi-pass method (N segments) in Méthodologie."
3. **Assemble `REPORT.MD` (orchestrator, mechanical — no source reading).** Stitch, in order: `# <Subject>`
   → SYNTH's `## Sujet & périmètre`, `## Méthodologie`, `## Synthèse`, `## Cadres de référence & état de
   l'art` → then `## Analyse du domaine` whose body is **each partial's analytical block concatenated in
   segment order** (the text from `## <Segment title>` down to but excluding its `### Fils transverses`) →
   then SYNTH's `## Débats & controverses`, `## Paysage pratique & licences`, `## Questions ouvertes`,
   `## Sources`. The result is one coherent `REPORT.MD`; go to §4.
