# install.ps1 — install the portable multi-agent pipeline (Windows).
# Works on Windows PowerShell 5.1 and PowerShell 7+. Mirrors install.sh.
#
#   Per-project install (default — bundles the core into <target>\.claude, committable):
#     .\install.ps1 [target_dir]
#     irm <raw-url>/install.ps1 | iex
#
#   Global install (one core in ~\.claude, shared by every repo on this machine):
#     .\install.ps1 -Global
#     & ([scriptblock]::Create((irm <raw-url>/install.ps1))) -Global
#
#   Update the generic core in place (keeps any generated PIPELINE.md + rendered agents):
#     .\install.ps1 -Update [target_dir]
#     .\install.ps1 -Update -Global
#
# Per-project install copies the core into <target>\.claude; global install copies it once
# into ~\.claude and registers the gate hook there. Either way you then run `/init-pipeline`
# in each repo to generate PIPELINE.md + render the surface agents. Update refreshes ONLY the
# stack-agnostic files; generated profiles, rendered agents, gate-config.json and any project
# settings.json are left untouched.

[CmdletBinding()]
param(
    [switch]$Global,
    [switch]$Update,
    [Parameter(Position = 0)][string]$Target
)

$ErrorActionPreference = 'Stop'

$repoUrl = $env:PIPELINE_REPO
if (-not $repoUrl) { $repoUrl = 'https://github.com/TheBidouilleAgency/cohorte' }

if (-not $Target) { $Target = (Get-Location).Path }

# --- helpers -----------------------------------------------------------------

# Write JSON as UTF-8 without BOM, un-escaping \uXXXX sequences that ConvertTo-Json
# (notably on PowerShell 5.1) produces for non-ASCII and for < > & ' — so accented
# characters survive a round-trip. Escapes for control chars, `"` and `\` are kept,
# and \u preceded by an odd number of backslashes (a literal \u in a string) is untouched.
function Write-JsonFile([string]$Path, $Data) {
    $json = ConvertTo-Json -InputObject $Data -Depth 100
    $json = [regex]::Replace($json, '(?<=(?:^|[^\\])(?:\\\\)*)\\u([0-9a-fA-F]{4})', {
        param($m)
        $code = [Convert]::ToInt32($m.Groups[1].Value, 16)
        if ($code -lt 0x20 -or $code -eq 0x22 -or $code -eq 0x5C) { $m.Value }
        else { [string][char]$code }
    })
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    [System.IO.File]::WriteAllText($full, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return $null }
}

# cp -R src/. dest — deterministic merge/overwrite into an existing directory.
function Copy-Tree([string]$From, [string]$To) {
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force
}

# The gate hook runs `python <gate.py>` at tool-use time; find a working Python 3
# launcher for the hook command (skipping the Microsoft Store alias stubs, which
# exist on PATH but exit non-zero).
function Find-Python {
    foreach ($candidate in @('py', 'python', 'python3')) {
        if (-not (Get-Command $candidate -ErrorAction SilentlyContinue)) { continue }
        try {
            $null = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    return $null
}

# --- locate the source (this checkout, or clone if piped via irm|iex) --------
$tmp = $null
try {
    $src = $null
    if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'core'))) {
        $src = $PSScriptRoot
    } else {
        Write-Host "-> fetching pipeline from $repoUrl"
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            throw 'git is required to fetch the pipeline (or run install.ps1 from a checkout).'
        }
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cohorte-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        # PS 5.1 turns redirected native stderr into terminating errors under EAP=Stop;
        # relax it around the clone and rely on the exit code instead.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        git clone --depth 1 --quiet $repoUrl (Join-Path $tmp 'pipeline') 2>&1 | Out-Null
        $ErrorActionPreference = $prevEAP
        if ($LASTEXITCODE -ne 0) { throw "git clone of $repoUrl failed" }
        $src = Join-Path $tmp 'pipeline'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $src 'core'))) {
        throw "pipeline source not found (no core/ in $src)"
    }

    # --- resolve the destination .claude dir ---------------------------------
    if ($Global) {
        $dest = $env:CLAUDE_CONFIG_DIR
        if (-not $dest) { $dest = Join-Path $HOME '.claude' }
    } else {
        $dest = Join-Path $Target '.claude'
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    # version stamp so a per-repo pointer can record which core it expects:
    # the package.json semver, with the git sha for traceability on from-main installs
    $semver = ''
    try {
        $pkgPath = Join-Path $src 'package.json'
        if (Test-Path $pkgPath) {
            $pkgData = Get-Content -Raw $pkgPath | ConvertFrom-Json
            if ($pkgData.version) { $semver = "$($pkgData.version)".Trim() }
        }
    } catch { }
    $sha = ''
    try {
        $v = git -C $src rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) { $sha = "$v".Trim() }
    } catch { }
    if ($semver -and $sha)  { $ver = "$semver ($sha)" }
    elseif ($semver)        { $ver = $semver }
    elseif ($sha)           { $ver = $sha }
    else                    { $ver = 'unknown' }

    function Copy-Core {
        Copy-Tree (Join-Path $src 'core\commands')  (Join-Path $dest 'commands')
        Copy-Tree (Join-Path $src 'core\hooks')     (Join-Path $dest 'hooks')
        Copy-Tree (Join-Path $src 'core\templates') (Join-Path $dest 'templates')
        Copy-Tree (Join-Path $src 'core\workflows') (Join-Path $dest 'workflows')
        # 0.1.19 renamed questionnaire-domain-brief.md -> research-brief.md; drop the stale copy.
        Remove-Item -LiteralPath (Join-Path $dest 'templates\questionnaire-domain-brief.md') -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path (Join-Path $dest 'pipeline\scripts') | Out-Null
        Copy-Item (Join-Path $src 'profile\PIPELINE.template.md') (Join-Path $dest 'pipeline') -Force
        Copy-Item (Join-Path $src 'profile\SCHEMA.md')            (Join-Path $dest 'pipeline') -Force
        Copy-Item (Join-Path $src 'profile\cohorte.config.template.yaml') (Join-Path $dest 'pipeline') -Force
        Copy-Item (Join-Path $src 'scripts\*.template')           (Join-Path $dest 'pipeline\scripts') -Force
        Copy-Item (Join-Path $src 'scripts\kanban-move.sh')       (Join-Path $dest 'pipeline\scripts') -Force
        Copy-Item (Join-Path $src 'scripts\telemetry-send.sh')    (Join-Path $dest 'pipeline\scripts') -Force
        Copy-Item (Join-Path $src 'scripts\preflight.sh')         (Join-Path $dest 'pipeline\scripts') -Force
        Copy-Item (Join-Path $src 'core\agents\implementer.template.md') (Join-Path $dest 'pipeline') -Force
        if (Test-Path (Join-Path $src 'CHANGELOG.md')) { Copy-Item (Join-Path $src 'CHANGELOG.md') (Join-Path $dest 'pipeline') -Force }
        [System.IO.File]::WriteAllText((Join-Path $dest 'pipeline\VERSION'), "$ver`n", [System.Text.UTF8Encoding]::new($false))
        Clear-TddGate
    }

    # The TDD gate was removed in 0.1.6. Older installs have hooks\tdd_gate.py on disk and
    # possibly registered in settings.json (by the sh/npm installers) — copy-over never deletes,
    # and a registered hook whose file is gone errors on every Write/Edit, so scrub both.
    function Clear-TddGate {
        Remove-Item -LiteralPath (Join-Path $dest 'hooks\tdd_gate.py') -Force -ErrorAction SilentlyContinue
        $settingsPath = Join-Path $dest 'settings.json'
        $data = Read-JsonFile $settingsPath
        if ($data -is [pscustomobject] -and $data.PSObject.Properties['hooks'] -and
            $data.hooks.PSObject.Properties['PreToolUse']) {
            $kept = @()
            $dropped = $false
            foreach ($entry in @($data.hooks.PreToolUse)) {
                $isTdd = $false
                foreach ($h in @($entry.hooks)) {
                    if ($h -and $h.command -and "$($h.command)".Trim().TrimEnd('"').EndsWith('tdd_gate.py')) { $isTdd = $true }
                }
                if ($isTdd) { $dropped = $true } else { $kept += $entry }
            }
            if ($dropped) {
                $data.hooks.PreToolUse = $kept
                Write-JsonFile $settingsPath $data
                Write-Host "  - removed the retired tdd_gate.py hook (file + settings registration)"
            }
        }
    }

    # the fixed (non-rendered) agents: the dev review/release pipeline agents
    function Copy-FixedAgents {
        New-Item -ItemType Directory -Force -Path (Join-Path $dest 'agents') | Out-Null
        Copy-Item (Join-Path $src 'core\agents\review.md'),
                  (Join-Path $src 'core\agents\release.md'),
                  (Join-Path $src 'core\agents\smoke.md'),
                  (Join-Path $src 'core\agents\profile-reader.md') (Join-Path $dest 'agents') -Force
        # 0.1.19 split the bi-mode questionnaire-researcher into research-agent + questionnaire-architect;
        # copy-over never deletes, so scrub the retired agent lest a dead subagent_type linger.
        Remove-Item -LiteralPath (Join-Path $dest 'agents\questionnaire-researcher.md') -Force -ErrorAction SilentlyContinue
        Clear-ResearchQuestionnaire
    }

    # The research + questionnaire capability was removed. Older installs have its agents, commands,
    # templates and template-step dirs on disk; copy-over never deletes, so scrub every orphan.
    function Clear-ResearchQuestionnaire {
        foreach ($f in @('agents\research-agent.md', 'agents\questionnaire-architect.md',
                         'agents\questionnaire-writer.md', 'agents\questionnaire-validator.md',
                         'commands\research.md', 'commands\questionnaire.md',
                         'templates\research-brief.md', 'templates\questionnaire-blueprint.md',
                         'templates\questionnaire-declaration.md', 'templates\questionnaire-verdict.md')) {
            Remove-Item -LiteralPath (Join-Path $dest $f) -Force -ErrorAction SilentlyContinue
        }
        foreach ($d in @('templates\steps\research', 'templates\steps\questionnaire')) {
            Remove-Item -LiteralPath (Join-Path $dest $d) -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # pipeline capability config is USER-level (vault, Notion DB, kanban boards) — it lives in
    # the user's .claude regardless of install scope. Seed only if neither the consolidated nor
    # the legacy copy exists. Non-interactive here: seeds disabled defaults; /init-pipeline +
    # /update-pipeline wire it (npx's installer offers a quick interview instead).
    function Initialize-Config {
        $userClaude = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
        $cfg = Join-Path $userClaude 'cohorte.config.yaml'
        $legacy = @('thebidouille.config.yaml') |
            ForEach-Object { Join-Path $userClaude $_ } |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if (Test-Path -LiteralPath $cfg) {
            Write-Host "  - kept your existing $cfg"
        } elseif ($legacy) {
            Write-Host "  - found legacy $legacy — kept as-is (read as a fallback)."
            Write-Host "    Run /update-pipeline to migrate it into cohorte.config.yaml + wire the kanban."
        } else {
            New-Item -ItemType Directory -Force -Path $userClaude | Out-Null
            Copy-Item (Join-Path $src 'profile\cohorte.config.template.yaml') $cfg
            Write-Host "  - seeded $cfg (disabled defaults — enable via /init-pipeline or /update-pipeline)"
        }
    }

    # Register the profile-driven gate hook in the GLOBAL settings.json. Idempotent:
    # the hook reads each repo's own .claude/gate-config.json (and no-ops where absent),
    # so one registration serves every project.
    function Register-GlobalHook {
        $settingsPath = Join-Path $dest 'settings.json'
        $gate = Join-Path $dest 'hooks\gate.py'
        $python = Find-Python
        if (-not $python) {
            return 'skipped — no Python 3 found on PATH; install it and re-run .\install.ps1 -Global'
        }
        $cmd = '{0} "{1}"' -f $python, $gate

        $data = Read-JsonFile $settingsPath
        if ($null -eq $data -or $data -isnot [pscustomobject]) { $data = [pscustomobject]@{} }
        if (-not $data.PSObject.Properties['hooks']) {
            $data | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
        }
        if (-not $data.hooks.PSObject.Properties['PreToolUse']) {
            $data.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue @()
        }

        $already = $false
        foreach ($entry in @($data.hooks.PreToolUse)) {
            foreach ($h in @($entry.hooks)) {
                if ($h -and $h.command -and "$($h.command)".Trim().TrimEnd('"').EndsWith('gate.py')) {
                    $already = $true
                }
            }
        }
        if (-not $already) {
            $data.hooks.PreToolUse = @($data.hooks.PreToolUse) + [pscustomobject]@{
                matcher = 'Bash'
                hooks   = @([pscustomobject]@{ type = 'command'; command = $cmd })
            }
            Write-JsonFile $settingsPath $data
            return 'ok'
        }
        return 'present'
    }

    # Bump only the core_version in a repo's committed .claude/pipeline.json (bundled mode).
    # Leaves every other field intact; no-ops if the pointer is absent or has no core_version.
    function Update-PointerVersion([string]$Ptr, [string]$NewVer) {
        $data = Read-JsonFile $Ptr
        if ($data -is [pscustomobject] -and $data.PSObject.Properties['core_version']) {
            $data.core_version = $NewVer
            Write-JsonFile $Ptr $data
        }
    }

    if ($Global) {
        if (-not $Update) {
            Write-Host "-> installing pipeline core GLOBALLY into $dest"
        } else {
            Write-Host "-> updating pipeline core GLOBALLY in $dest (keeping global settings.json)"
        }
        Copy-FixedAgents
        Copy-Core
        $hookState = Register-GlobalHook
        Initialize-Config
        Write-Host @"

OK pipeline core installed globally into $dest  (version $ver)
  gate hook: $hookState  (reads each repo's .claude/gate-config.json; silent where absent)

The commands (/init-pipeline, /brainstorm, /build ...) and the review/release agents are now
available in EVERY project on this machine — nothing is copied per repo.

Per repo:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline  — it generates PIPELINE.md, renders the surface agents, writes
     .claude/gate-config.json, and drops a committed .claude/pipeline.json pointer so
     teammates know to install the global core ($repoUrl).
  3. Commit PIPELINE.md + .claude/, then  /brainstorm  to start a feature.

Code retrieval (Serena — the default provider /init-pipeline wires per repo):
  uv tool install -p 3.13 serena-agent   # once per machine
  Make sure the uv tools dir is on PATH (uv tool update-shell) — otherwise the
  registered MCP server silently fails to start.

Global kanban config, user-scoped — optional:
  · One consolidated file: ~/.claude/cohorte.config.yaml (don't hand-edit it).
  · /init-pipeline (new project) and /update-pipeline (existing) wire it for you: creating +
    syncing an Obsidian kanban board of the pipeline in your shared vault.
"@
        return
    }

    if (-not $Update) {
        Write-Host "-> installing pipeline core into $dest"
        Copy-FixedAgents
        Copy-Core
        Initialize-Config
        New-Item -ItemType Directory -Force -Path (Join-Path $Target 'specs') | Out-Null
        if (-not (Test-Path -LiteralPath (Join-Path $Target 'specs\_template.md'))) {
            Copy-Item (Join-Path $src 'core\templates\spec.template.md') (Join-Path $Target 'specs\_template.md')
        }
        Write-Host @"

OK pipeline core installed into $dest  (version $ver)

Next:
  1. Open the project in Claude Code.
  2. Run  /init-pipeline   — it detects your stack, asks the gaps, and generates
     PIPELINE.md + renders one implementer agent per surface.
  3. Commit PIPELINE.md, then  /brainstorm  to start a feature.

Code retrieval (Serena — the default provider /init-pipeline wires per repo):
  uv tool install -p 3.13 serena-agent   # once per machine
  Make sure the uv tools dir is on PATH (uv tool update-shell) — otherwise the
  registered MCP server silently fails to start.

Prefer one shared core across all your repos?  Re-run with  -Global.
"@
    } else {
        Write-Host "-> updating pipeline core in $dest (keeping your PIPELINE.md + rendered agents)"
        Copy-Core
        if (Test-Path -LiteralPath (Join-Path $dest 'agents')) {
            Copy-FixedAgents
        }
        Initialize-Config
        Update-PointerVersion (Join-Path $dest 'pipeline.json') $ver
        Write-Host @"

OK core refreshed to $ver. Your PIPELINE.md, rendered surface agents, gate-config.json and
  settings.json were left as-is. Re-run /init-pipeline if your stack changed.
"@
    }
} finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
