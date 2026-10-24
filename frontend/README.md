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

Source game counts use future regular-season dates in NBA Eastern time, exclude completed games, and exclude TBD Cup slots unless the absence is season-ending. `injury_projections.R` converts those reports into dated availability probabilities, reduces expected appearances/minutes, and redistributes vacated minutes using positional fit and remaining rotation capacity. Added workload is limited to six MPG above the baseline, capped at 36 MPG, and total team minutes cannot exceed the original budget or 19,680. Cached baseline rounding is reconciled to the MPG limit. Season-ending players receive no remaining minutes. Completed games keep their baseline contribution; actual historical statistics and per-minute skill ratings are unchanged. Only the active forecast season and its matching prior-year career-arc point change; later career horizons retain their original assumptions.

Reported windows use a uniform return probability across the window. Low-confidence provider estimates use a +/-3-day window for day-to-day listings or +/-7 days for out listings. Re-evaluation and minimum-absence dates are lower bounds, followed by an open-ended availability curve reaching 50% after 14 days. Unknown or expired dates use an open-ended curve reaching 50% after 7 days (day-to-day) or 28 days (out) from the snapshot. These are transparent model assumptions, not new medical return dates. Minimum missed-game counts are enforced. Rebuilds always start from untouched model inputs and reject already adjusted input, preventing repeated haircuts. The player's source and model assumption appear beside their adjusted minutes.

The same dated rotations generate season minute totals and each future game's team ratings. Game odds use availability on that date, so the absence stops affecting a matchup as the player returns. Team win totals are then summed from those game odds. Estimated Cup slots use the selected team's dated rating against its conference. Historical/completed game probabilities are preserved.

Run injury checks with `python3 -m unittest discover -s script/data -p 'test_injury_outlook.py'` and `Rscript script/frontend/test_injury_projections.R`. To refresh projections independently, run `python3 script/data/refresh_injury_outlook.py`, then `Rscript script/frontend/export_frontend_data.R`; the exporter also rebuilds the static manifest. Refreshing only the injury JSON does not rebuild projections. A fetch or incomplete-schedule failure preserves the last valid artifact and fails the refresh.


A roster-only ESPN fallback preserves the affected team's last published cap ledger. The Cap Tracker labels those figures as cached and preserves their original timestamp; an unavailable salary source never becomes a zero-dollar roster.


# Live 2026–27 projections and preseason archive

The October 19 published export is frozen under `frontend/public/data/archive/2027-preseason`. `snapshot.json` records its source commit and SHA-256 checksums. Refresh workflows validate those hashes and never write into the archive. The header’s Preseason archive opens player comparisons, team win totals/O-U edges and original game odds without adding main navigation tabs.

The sportsbook reference is the last documented pre-tip line located for each team (Oct 19 reported FanDuel; Oct 20 DraftKings for five teams). Exact final closing status is **not verified** and is labeled in the interface. This is a fixed season win-total benchmark, not live odds or game point spreads.

The existing **Rebuild lineup projections** GitHub workflow now runs daily at 13:15 UTC and can be run manually. It downloads public expected EPM from `https://dunksandthrees.com/epm` (never `/epm/actual`) and current DARKO from `https://www.darko.app/`. Public Svelte page data is decoded with a literal-only parser; remote JavaScript is never evaluated. Dates, season, values, duplicates and coverage are validated. A login wall, stale source or schema change stops publication and preserves the last successful export. Credentials are not required for the currently accessible source pages.

Active-season forecasts retain an 80% external / 20% SKILL mix, with an actual-minute transition from the frozen preseason forecast described below. Current skill statistics are rescored with existing coefficients; model coefficients and multi-year career models are not retrained from a two-game sample. Player values, Scale, rotations and team forecasts are recomputed in the ordinary exporter. Draft synthetic IDs resolve to current providers only by unique normalized name plus current team. Missing source pairs retain their external forecast priors and are listed in Refresh details; available measured skill components can still update.

ESPN final regular-season results share the same 30 schedule downloads used by the injury refresh. Finals are deduplicated, scores validated and joined by date/home/away. Projected wins = actual wins + expected wins in remaining games. Preseason, ongoing games and the Cup championship do not become earned regular-season wins. The normal injury model reduces dated availability and redistributes minutes before game odds are calculated. Per-minute ratings do not receive a second injury penalty.

Local refresh, after installing frontend dependencies:

```sh
node script/data/refresh_live_ratings.mjs
python3 script/data/refresh_injury_outlook.py --results-output raw/live/results.json
python3 script/data/refresh_live_skill_stats.py
Rscript script/frontend/refresh_live_switch.R
Rscript script/frontend/export_frontend_data.R
node script/frontend/validate_preseason_archive.mjs
```

Publishing uses the existing Cloudflare Pages deployment after the workflow’s tests, full export and frontend build pass. Source dates are shown separately from the export timestamp.


## Gradual in-season evidence

The daily workflow also pulls current regular-season statistics through the repository's existing Databallr connection. It scores observed FTD, SHOOT, PASS, RIM, OREB, DPM, DREB and RIMPRO with the existing coefficients. Missing components retain their preseason values; SWITCH/perimeter retains its prior until compatible current matchup inputs are available. Historical statistics and fitted models are not rewritten. Current skill observations use the previous season's fixed calibration, with individual observations bounded at five historical standard deviations.

Actual played minutes determine the transition from the immutable preseason player forecast. The 4,000-minute window takes the current season first, then up to three prior seasons, whose minutes receive weights 0.75, 0.5625 and 0.421875. Effective prior evidence is the greater of that actual historical evidence and a synthetic prior of max(0, 1,500 minus current minutes). Current weight is current minutes / (current minutes + effective prior minutes). For rookies with no prior NBA minutes, current evidence therefore receives 4% weight at 60 minutes, 20% at 300, 50% at 750, and 100% at 1,500. The synthetic prior is replaced one-for-one, while veterans retain their actual weighted history; a veteran with 2,500 minutes last year and 2,000 the previous year has 2.19% current weight after 60 minutes. At zero current minutes, the preseason talent forecast is unchanged. These are explicit conservative defaults, not backtested optimal weights. Fully replacing the app's rookie prior does not remove expected EPM/DARKO's own internal priors or manufacture missing skill observations.

The overall 80% external / 20% SKILL split remains. The external portion implied by the preseason forecast transitions toward current expected EPM/DARKO at the same evidence weight; measured SKILL components transition once at that weight as well. This is a forecast-transition rule, not a claim that expected EPM/DARKO are raw independent observations or that their own historical priors have disappeared. Injuries, rotations and completed team results still apply immediately. Every refresh recomputes from the frozen anchor, preventing repeated pulls from compounding an adjustment. Player details show actual minutes and the current/prior weights; archive refresh details report skill coverage and retained components.

### Daily SWITCH refresh

The daily job checks NBA `leagueseasonmatchups` for the exact current regular season and joins NBA player positions with current offensive scoring rates. It reproduces the historical 50/50 standardized assignment-difficulty/versatility formula, including the center concentration penalty. The old 500-minute exclusion is replaced by the existing live evidence weighting. At least 100 defenders with matchup game coverage are required for the season normalization. Empty tables, failures, wrong seasons and incomplete player inputs retain the preseason value and record a status.

A subsequent R step reproduces the historical perimeter allocation residual, with controls fit only to the saved historical panel (excluding 2016/17 and the current season). SWITCH updates only when both terms are complete, position is known, and defended-shot exposure is positive; it then updates defensive SKILL under the same minute weighting. The archive refresh details report the check time, availability reason and updated-player count. A provider-populated perimeter field alone is not independent proof of complete tracking coverage.
