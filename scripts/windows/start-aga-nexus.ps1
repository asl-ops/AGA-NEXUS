param(
  [int]$Port = 4174
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtimeDir = Join-Path $repoRoot ".runtime"
$pidFile = Join-Path $runtimeDir "aga-nexus-preview.pid"
$logFile = Join-Path $runtimeDir "aga-nexus-preview.log"

if (-not (Test-Path $runtimeDir)) {
  New-Item -Path $runtimeDir -ItemType Directory | Out-Null
}

function Ensure-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "No se encontró '$name'. Instala $name y vuelve a intentarlo."
  }
}

Ensure-Command "git"
Ensure-Command "npm"
Ensure-Command "node"

Push-Location $repoRoot
try {
  if (Test-Path ".git") {
    git fetch origin --prune | Out-Null
    git pull --ff-only origin main | Out-Null
  }

  npm ci --silent
  npm run build | Out-Null

  if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid) {
      $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
      if ($existingProc) {
        $existingProc | Stop-Process -Force
      }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }

  $npmCmd = "npm run preview -- --host 0.0.0.0 --port $Port --strictPort"
  $previewProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c $npmCmd >> `\"$logFile`\" 2>&1" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru

  $previewProc.Id | Set-Content $pidFile
  Start-Sleep -Seconds 2

  Start-Process "http://localhost:$Port"
}
finally {
  Pop-Location
}
