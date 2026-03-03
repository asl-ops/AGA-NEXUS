$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtimeDir = Join-Path $repoRoot ".runtime"
$pidFile = Join-Path $runtimeDir "aga-nexus-preview.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "No hay servidor AGA Nexus en ejecución (no existe PID)."
  exit 0
}

$pid = Get-Content $pidFile -ErrorAction SilentlyContinue
if (-not $pid) {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  Write-Output "PID vacío. Archivo limpiado."
  exit 0
}

$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
if ($proc) {
  $proc | Stop-Process -Force
  Write-Output "Servidor AGA Nexus detenido (PID $pid)."
} else {
  Write-Output "No se encontró proceso con PID $pid."
}

Remove-Item $pidFile -ErrorAction SilentlyContinue
