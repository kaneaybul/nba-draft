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
