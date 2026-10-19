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

The **Refresh current NBA rosters** workflow refreshes all 30 rosters using Spotrac, with a fresh ESPN roster fallback for an unavailable team page, refreshes `injury_outlook.json` from ESPN/RotoWire and all 30 current regular-season schedules, then exports injury-aware projections. Model fitting is not part of this refresh. Run it manually, supply a fresh verified Spotrac snapshot, or update `raw/roster_refresh_request.json` for an explicit refresh. Ordinary code edits do not start live roster scrapes. The cached projection rebuild refreshes injuries before exporting as well.

The Injury Outlook tab shows source timestamps, reported return windows, minimum absences, re-evaluation dates, confidence, and remaining scheduled games missed. A re-evaluation is not a return date. A source saying there is no timetable overrides ESPN's estimated date. Unknown durations stay unknown; old dates are not advanced automatically. Current injury notes appear only on matching players in the active injury season. Missing a player from the list is not proof of health.

Source game counts use future regular-season dates in NBA Eastern time, exclude completed games, and exclude TBD Cup slots unless the absence is season-ending. `injury_projections.R` converts those reports into dated availability probabilities, reduces expected appearances/minutes, and redistributes vacated minutes using positional fit and remaining rotation capacity. Added workload is limited to six MPG above the baseline, capped at 36 MPG (preserving baseline rounding), and total team minutes cannot exceed the original budget or 19,680. Season-ending players receive no remaining minutes. Completed games keep their baseline contribution; actual historical statistics and per-minute skill ratings are unchanged. Only the active forecast season and its matching prior-year career-arc point change; later career horizons retain their original assumptions.

Reported windows use a uniform return probability across the window. Low-confidence provider estimates use a +/-3-day window for day-to-day listings or +/-7 days for out listings. Re-evaluation and minimum-absence dates are lower bounds, followed by an open-ended availability curve reaching 50% after 14 days. Unknown or expired dates use an open-ended curve reaching 50% after 7 days (day-to-day) or 28 days (out) from the snapshot. These are transparent model assumptions, not new medical return dates. Minimum missed-game counts are enforced. Rebuilds always start from untouched model inputs and reject already adjusted input, preventing repeated haircuts. The player's source and model assumption appear beside their adjusted minutes.

The same dated rotations generate season minute totals and each future game's team ratings. Game odds use availability on that date, so the absence stops affecting a matchup as the player returns. Team win totals are then summed from those game odds. Estimated Cup slots use the selected team's dated rating against its conference. Historical/completed game probabilities are preserved.

Run injury checks with `python3 -m unittest discover -s script/data -p 'test_injury_outlook.py'` and `Rscript script/frontend/test_injury_projections.R`. To refresh projections independently, run `python3 script/data/refresh_injury_outlook.py`, then `Rscript script/frontend/export_frontend_data.R`; the exporter also rebuilds the static manifest. Refreshing only the injury JSON does not rebuild projections. A fetch or incomplete-schedule failure preserves the last valid artifact and fails the refresh.


A roster-only ESPN fallback preserves the affected team's last published cap ledger. The Cap Tracker labels those figures as cached and preserves their original timestamp; an unavailable salary source never becomes a zero-dollar roster.
