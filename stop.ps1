# stop.ps1 — stops the backend and frontend started by start.ps1, and frees
# ports 8000 and 3000.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $root 'logs'

function Stop-ByPidFile($name, $pidFile) {
    if (-not (Test-Path $pidFile)) {
        Write-Host "  [i] $name was not running (no PID file)."
        return
    }
    $targetPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($targetPid) {
        $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
            Write-Host "  [OK] $name stopped (PID $targetPid)."
        } else {
            Write-Host "  [i] $name was not running (stale PID file)."
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "============================================"
Write-Host " SIHATUNA IRAQ ERP - Stopping"
Write-Host "============================================"
Write-Host ""

Stop-ByPidFile "Backend"  (Join-Path $logsDir 'backend.pid')
Stop-ByPidFile "Frontend" (Join-Path $logsDir 'frontend.pid')

# Best-effort: anything still bound to our ports after the PID-based stop
# above (e.g. a child process the PID file didn't capture) gets cleared too,
# so start.ps1 never fails next time with "port already in use".
foreach ($port in 8000, 3000) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Freed port $port (was held by PID $($conn.OwningProcess))."
    }
}

Write-Host ""
Write-Host "Done."
Write-Host ""
