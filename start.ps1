# start.ps1 — starts the backend and frontend in the background using the
# bundled portable Node.js runtime, waits until both respond, then opens
# the browser. No installation step of any kind runs here.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = Join-Path $root 'node-runtime\node.exe'
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$logsDir = Join-Path $root 'logs'
$envFile = Join-Path $backendDir '.env'
$maxLogBytes = 10MB

Write-Host ""
Write-Host "============================================"
Write-Host " SIHATUNA IRAQ ERP - Starting"
Write-Host "============================================"
Write-Host ""

# ── .env must exist ─────────────────────────────────────────────────────────
if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] backend\.env is missing." -ForegroundColor Red
    Write-Host "        Copy backend\.env.example to backend\.env and fill in real values first."
    exit 1
}

# ── Logs folder, with a simple size cap (rotate one backup deep) ───────────
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
function Rotate-LogIfLarge($path) {
    if ((Test-Path $path) -and (Get-Item $path).Length -gt $maxLogBytes) {
        $old = "$path.old"
        if (Test-Path $old) { Remove-Item $old -Force }
        Move-Item $path $old
    }
}
Rotate-LogIfLarge (Join-Path $logsDir 'backend.log')
Rotate-LogIfLarge (Join-Path $logsDir 'backend-error.log')
Rotate-LogIfLarge (Join-Path $logsDir 'frontend.log')
Rotate-LogIfLarge (Join-Path $logsDir 'frontend-error.log')

# ── Already running? ────────────────────────────────────────────────────────
function Test-RunningPid($pidFile) {
    if (-not (Test-Path $pidFile)) { return $false }
    $p = Get-Content $pidFile -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    return [bool](Get-Process -Id $p -ErrorAction SilentlyContinue)
}
$backendPidFile = Join-Path $logsDir 'backend.pid'
$frontendPidFile = Join-Path $logsDir 'frontend.pid'
if ((Test-RunningPid $backendPidFile) -and (Test-RunningPid $frontendPidFile)) {
    Write-Host "[i] Already running. Opening the browser..."
    Start-Process "http://localhost:3000"
    exit 0
}

# ── Port-conflict check (only matters if we don't already own the port) ────
function Test-PortBusyByOther($port, $ownPidFile) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return $false }
    $ownPid = if (Test-Path $ownPidFile) { Get-Content $ownPidFile -ErrorAction SilentlyContinue } else { $null }
    foreach ($c in $conns) {
        if ("$($c.OwningProcess)" -ne "$ownPid") { return $c.OwningProcess }
    }
    return $false
}
$busy8000 = Test-PortBusyByOther 8000 $backendPidFile
if ($busy8000) {
    Write-Host "[ERROR] Port 8000 (backend) is already used by another program (PID $busy8000)." -ForegroundColor Red
    Write-Host "        Stop that program, or change PORT in backend\.env, then try again."
    exit 1
}
$busy3000 = Test-PortBusyByOther 3000 $frontendPidFile
if ($busy3000) {
    Write-Host "[ERROR] Port 3000 (frontend) is already used by another program (PID $busy3000)." -ForegroundColor Red
    Write-Host "        Stop that program, then try again."
    exit 1
}

# ── Prepare the database (schema + migrations + first admin if needed) ────
# Runs in the foreground on purpose: a first-run admin password is printed
# here once and must be visible immediately, not buried in a log file.
Write-Host "[*] Preparing the database..."
Push-Location $backendDir
& $nodeExe "scripts\bootstrapDatabase.js"
$bootstrapExit = $LASTEXITCODE
Pop-Location
if ($bootstrapExit -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Database setup failed - see the message above." -ForegroundColor Red
    Write-Host "        Common causes: PostgreSQL is not running, or PG_* values in backend\.env are wrong."
    exit 1
}
Write-Host ""

# ── Start the backend ────────────────────────────────────────────────────────
Write-Host "[*] Starting backend on port 8000..."
$backendProc = Start-Process -FilePath $nodeExe -ArgumentList 'server.js' -WorkingDirectory $backendDir `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logsDir 'backend.log') `
    -RedirectStandardError (Join-Path $logsDir 'backend-error.log')
$backendProc.Id | Out-File $backendPidFile -Encoding ascii

# ── Start the frontend ───────────────────────────────────────────────────────
Write-Host "[*] Starting frontend on port 3000..."
$frontendProc = Start-Process -FilePath $nodeExe -ArgumentList 'serve.js' -WorkingDirectory $frontendDir `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logsDir 'frontend.log') `
    -RedirectStandardError (Join-Path $logsDir 'frontend-error.log')
$frontendProc.Id | Out-File $frontendPidFile -Encoding ascii

# ── Wait until both respond (or clearly report why they didn't) ────────────
function Wait-Ready($url, $proc, $label, $errorLogPath, $timeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            Write-Host ""
            Write-Host "[ERROR] $label exited immediately. Last lines of its error log:" -ForegroundColor Red
            if (Test-Path $errorLogPath) { Get-Content $errorLogPath -Tail 15 | ForEach-Object { Write-Host "    $_" } }
            return $false
        }
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode) { return $true }
        } catch {
            # 503 (degraded, e.g. DB still unreachable) still means the server answered.
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -ge 400) { return $true }
        }
        Start-Sleep -Seconds 1
    }
    Write-Host ""
    Write-Host "[ERROR] $label did not respond within $timeoutSeconds seconds." -ForegroundColor Red
    if (Test-Path $errorLogPath) {
        Write-Host "        Last lines of its error log:"
        Get-Content $errorLogPath -Tail 15 | ForEach-Object { Write-Host "    $_" }
    }
    return $false
}

$backendOk = Wait-Ready "http://localhost:8000/api/health" $backendProc "Backend" (Join-Path $logsDir 'backend-error.log') 30
$frontendOk = Wait-Ready "http://localhost:3000/" $frontendProc "Frontend" (Join-Path $logsDir 'frontend-error.log') 30

if (-not ($backendOk -and $frontendOk)) {
    exit 1
}

Write-Host ""
Write-Host "[OK] Both backend and frontend are up."
Write-Host ""
Start-Process "http://localhost:3000"
