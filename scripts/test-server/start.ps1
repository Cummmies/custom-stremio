# The tracker test server, on this PC only (http://127.0.0.1:8100). Copies
# the server code from ..\movie review next to its own copy of the data in
# ..\tracker-test-server (beside both repos), then runs it with everything that
# reaches real accounts switched off (serve.py says what).
#
#   .\start.ps1           code copied fresh, data kept from last time
#   .\start.ps1 -Fresh    data copied again from the real database here
#   .\start.ps1 -Token 48 a sign-in for a test app (user 48), then exits
#
# A test app talks to it with `npx vite --mode lbtest` (.env.lbtest).
param([switch]$Fresh, [int]$Port = 8100, [int]$Token = 0)
$ErrorActionPreference = 'Stop'

$Server = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\movie review')).Path
$Python = Join-Path $Server '.venv\Scripts\python.exe'
$Root = Join-Path (Split-Path $Server) 'tracker-test-server'
$Code = Join-Path $Root 'server'
$Db = Join-Path $Code 'movie_tracker.db'

# The code, as it is in the server folder now (your uncommitted work too).
# Left out: settings, the database, data\ and anything machine-made. /MIR
# never removes what it leaves out, so the copy's own data stays.
New-Item -ItemType Directory -Force $Code | Out-Null
robocopy $Server $Code /MIR /XD .venv .git data pgdata backups logs __pycache__ .pytest_cache node_modules `
    /XF *.db *.db-shm *.db-wal .env /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the server code failed (robocopy $LASTEXITCODE)." }

if ($Fresh -or -not (Test-Path $Db)) {
    Write-Host 'Copying the data (read-only from the real database)...'
    Remove-Item -Force -ErrorAction SilentlyContinue "$Db", "$Db-wal", "$Db-shm"
    $Data = Join-Path $Code 'data'
    New-Item -ItemType Directory -Force $Data | Out-Null
    # Not the key files: the copy makes its own, so the Stremio sign-ins kept
    # in the real data can't be read here.
    Copy-Item (Join-Path $Server 'data\anime-list-full.json') $Data -Force
    robocopy (Join-Path $Server 'data\uploads') (Join-Path $Data 'uploads') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying the uploads failed (robocopy $LASTEXITCODE)." }
    $src = (Join-Path $Server 'movie_tracker.db') -replace '\\', '/'
    & $Python -I -c "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" $src $Db
    if ($LASTEXITCODE -ne 0) { throw 'Copying the database failed.' }
}

if ($Token) {
    & $Python (Join-Path $PSScriptRoot 'serve.py') $Code --token $Token 'Test app'
    exit $LASTEXITCODE
}

Write-Host "Test server: http://127.0.0.1:$Port (this PC only)"
& $Python (Join-Path $PSScriptRoot 'serve.py') $Code $Port
