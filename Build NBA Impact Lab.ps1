$ErrorActionPreference = "Stop"

$frontendDir = Join-Path $PSScriptRoot "frontend"
if (!(Test-Path (Join-Path $frontendDir "package.json"))) {
  throw "Could not find the frontend app here: $frontendDir"
}

$node = (Get-Command node -ErrorAction Stop).Source

if (!(Test-Path (Join-Path $frontendDir "node_modules/vite/bin/vite.js"))) {
  throw "Could not find Vite. From the frontend folder, run: npm install"
}

Push-Location $frontendDir
try {
  & $node ".\node_modules\vite\bin\vite.js" build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $publicDataDir = Join-Path $frontendDir "public\data"
  $distDataDir = Join-Path $frontendDir "dist\data"
  if (Test-Path $publicDataDir) {
    if (!(Test-Path $distDataDir)) {
      New-Item -ItemType Directory -Path $distDataDir | Out-Null
    }
    Copy-Item -Path (Join-Path $publicDataDir "*") -Destination $distDataDir -Recurse -Force
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Frontend build complete."
