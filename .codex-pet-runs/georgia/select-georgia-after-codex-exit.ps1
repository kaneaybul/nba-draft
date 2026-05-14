$ErrorActionPreference = 'Stop'

$statePath = 'C:\Users\brend\.codex\.codex-global-state.json'
$backupPath = 'C:\Users\brend\.codex\.codex-global-state.before-georgia-watcher.json'
$markerPath = 'C:\Users\brend\.codex\pets\georgia\selection-applied.txt'

function Get-CodexProcesses {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ProcessName -ieq 'Codex' -or $_.ProcessName -ieq 'codex') -and
      ($_.Path -like '*OpenAI.Codex*')
    }
}

$deadline = (Get-Date).AddMinutes(15)
while ((Get-Date) -lt $deadline) {
  $processes = @(Get-CodexProcesses)
  if ($processes.Count -eq 0) {
    break
  }
  Start-Sleep -Seconds 2
}

Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $statePath) {
  Copy-Item -LiteralPath $statePath -Destination $backupPath -Force
  $json = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
} else {
  $json = [pscustomobject]@{}
}

if (-not ($json.PSObject.Properties.Name -contains 'electron-persisted-atom-state')) {
  $json | Add-Member -NotePropertyName 'electron-persisted-atom-state' -NotePropertyValue ([pscustomobject]@{})
}

$persisted = $json.'electron-persisted-atom-state'
if ($persisted.PSObject.Properties.Name -contains 'selected-avatar-id') {
  $persisted.'selected-avatar-id' = 'custom:georgia'
} else {
  $persisted | Add-Member -NotePropertyName 'selected-avatar-id' -NotePropertyValue 'custom:georgia'
}

$json | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath $statePath -Encoding UTF8
"Georgia selected at $(Get-Date -Format o)" | Set-Content -LiteralPath $markerPath -Encoding UTF8
