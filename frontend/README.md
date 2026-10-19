# NBA Impact Lab Frontend

Local React/Vite frontend for the NBA and draft model outputs.

## Refresh Data

From the repository root:

```powershell
& 'C:\Program Files\R\R-4.3.2\bin\Rscript.exe' 'script\frontend\export_frontend_data.R'
```

The exporter writes app-ready JSON files to `frontend/public/data/`.

## Run

Node/npm are required for the React app. On Windows, prefer the repository-root launcher because the `nba&draft` folder name can break `npm run ...` path handling:

```powershell
.\Launch NBA Impact Lab.cmd
```

If the repo is moved to a path without `&`, the normal Vite command also works:

```powershell
cd frontend
npm install
npm run dev
```

Then open the local Vite URL, usually `http://127.0.0.1:5173/`.

## Build

From the repository root:

```powershell
.\Build NBA Impact Lab.ps1
```

That launcher calls Vite through `node` directly from PowerShell, so it avoids the same Windows shell issue.
On this machine, the measured frontend build/export baseline is about 2-3 seconds; slower refreshes are more likely coming from the data/model refresh path.

To run the TypeScript check directly:

```powershell
cd frontend
& 'C:\Program Files\nodejs\node.exe' '.\node_modules\typescript\bin\tsc' --noEmit
```

## Current Scope

- Player Impact board
- Player detail panel with skill shape, projection arc, and market read
- Team projections
- Trade value sandbox
- Draft board preview
- Lineup Synergy and Draft Tracker staging views

The frontend reads generated JSON only. The Excel workbooks remain reference material and are not loaded at runtime.

## Roster and injury refresh

The **Refresh current NBA rosters** workflow scrapes all 30 Spotrac rosters, exports roster-dependent projections, and refreshes `injury_outlook.json` from ESPN/RotoWire and all 30 current regular-season schedules. Model fitting is not part of this refresh. Run it manually, supply a fresh verified Spotrac snapshot, or update `raw/roster_refresh_request.json` for an explicit refresh. Ordinary code edits do not start live scrapes.

The Injury Outlook tab shows source timestamps, reported return windows, minimum absences, re-evaluation dates, confidence, and remaining scheduled games missed. A re-evaluation is not a return date. A source saying there is no timetable overrides ESPN's estimated date. Unknown durations stay unknown; old dates are not advanced automatically. Current injury notes appear only on matching players in the active injury season. Missing a player from the list is not proof of health.

Game counts use future regular-season game dates in NBA Eastern time, exclude completed games, and exclude TBD Cup slots unless the absence is season-ending. Injury information does not overwrite historical statistics, impact ratings, or the existing roster-based team projections.

Run injury checks with `python3 -m unittest discover -s script/data -p 'test_injury_outlook.py'`. Run the injury refresh independently with `python3 script/data/refresh_injury_outlook.py`, then `node script/frontend/build_static_data_manifest.mjs`. A fetch or incomplete-schedule failure leaves the last valid injury artifact in place and fails the refresh.

