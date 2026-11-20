"""Score the three forecasters on identical July player-seasons."""
import argparse
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_shared_roles import read_history
from shared_minutes import ComparableGames, project_path


def replay(history, archive_dir, projections):
    panel = read_history(history, 2027)
    actual = {y: {r["nba_id"]: r.get("Minutes") or 0 for r in json.loads((history/f"{y}.json").read_text())}
              for y in range(2023,2027)}
    for year in range(2022,2026):
        model = ComparableGames(panel,year)
        by_player = {}
        with (projections/f"historical_{year}.csv").open() as stream:
            for r in csv.DictReader(stream):
                by_player.setdefault(int(r["nba_id"]),{})[int(r["horizon"])]=r
        archive, = archive_dir.glob(f"*Replay*_{year}-02*.zip")
        with zipfile.ZipFile(archive) as z:
            seen=set()
            for name in z.namelist():
                if "07-31/output/" not in name or not name.endswith("/monthly_annual_values.csv"):
                    continue
                for r in csv.DictReader(io.TextIOWrapper(z.open(name))):
                    target=int(r["season"])
                    h=target-year
                    if h not in range(1,5) or target>2026 or r["active_asset"]!="True" or r["asset_type"] not in ("roster_contract","two_way"):
                        continue
                    identity=r["source_nba_id"] or r["ledger_nba_id"]
                    if not identity or not r["forecast_annual_minutes"]:
                        continue
                    pid=int(float(identity))
                    if (pid,h) in seen or pid not in by_player or panel[year].get(pid,{}).get("games",0)<5:
                        continue
                    seen.add((pid,h))
                    f=by_player[pid]
                    gp=model.predict(model.features(panel,year,pid))
                    roles=[float(f[k]["projected_mpg"]) for k in range(1,6)]
                    path=project_path(gp,roles,float(f[1]["projected_games"]),roles[0])
                    yield [h,path.totals((h-1)*82,h*82)[1],float(f[h]["projected_minutes"]),
                           float(r["forecast_annual_minutes"]),actual[target].get(pid,0)]


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("history","archive_dir","projections"):
        p.add_argument(name,type=Path)
    a=p.parse_args()
    rows=np.array(list(replay(a.history,a.archive_dir,a.projections)))
    for horizon in range(1,5):
        b=rows[rows[:,0]==horizon]
        print(horizon,len(b),np.abs(b[:,1:4]-b[:,4:5]).mean(axis=0).round(1))
