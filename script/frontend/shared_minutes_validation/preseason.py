"""Replay the immutable October 2026 preseason snapshot against Nov 19 observations."""
import argparse
import csv
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shared_minutes_export import load_paths


def score(repo, archive, actuals, output):
    root=repo/"frontend/public/data"
    frozen=root/"archive/2027-preseason"
    scripts=Path(__file__).resolve().parents[1]
    opening=json.loads((frozen/"impact_players.json").read_text())
    current={r["nba_id"]:r for r in json.loads(actuals.read_text())}
    for r in opening:
        r["pool_status"]="roster" if r["current_roster_team"]!="FA" else "FA"
        r["source_nba_id"]=r.get("source_nba_id") or r["nba_id"]
        r["minutes_remaining_team_games"]=82
        r["minutes_checked_at"]="2026-10-19"
        games=r.get("injury_base_games") or 0
        r["minutes_gp_prior"]=max(0,min(82,games))
        minutes=r.get("lineup_original_minutes") or 0
        r["minutes_mpg_prior"]=min(48,minutes/games) if games else 0
        r["minutes_actual_games"]=0
    output.mkdir()
    roster=output/"roster.json"
    roster.write_text(json.dumps(opening))
    healthy,final=output/"healthy.csv",output/"resolved.csv"
    subprocess.run([sys.executable,scripts/"build_shared_roles.py",root/"v2/impact_players",roster,"2026-10-19",healthy],check=True)
    subprocess.run(["Rscript",scripts/"allocate_shared_roles.R",repo,healthy,roster,frozen/"team_schedules.json",
                    frozen/"injury_outlook.json","2026-10-19",final],check=True)
    paths=load_paths(final,"2026-10-19")
    asset={}
    with zipfile.ZipFile(archive) as z:
        for f in z.namelist():
            if "2026-09-30/output/" not in f or not f.endswith("monthly_annual_values.csv"):
                continue
            for row in csv.DictReader(io.TextIOWrapper(z.open(f))):
                if row["active_asset"]!="True" or row["season"]!="2027" or row["asset_type"] not in ("two_way","roster_contract"):
                    continue
                identity=row["source_nba_id"] or row["ledger_nba_id"]
                if identity and row["forecast_annual_minutes"]:
                    asset[int(float(identity))]=float(row["forecast_annual_minutes"])
    errors=[]
    for r in opening:
        pid=r["nba_id"]
        if pid not in paths or pid not in current or pid not in asset:
            continue
        live=current[pid]
        if live["pool_status"]!="roster" or r["team"]!=live["team"]:
            continue
        if live["minutes_checked_at"][:10]!="2026-11-19":
            raise ValueError("Expected the Nov 19 observation")
        n=82-live["minutes_remaining_team_games"]
        prediction=np.array([paths[pid].totals(0,n)[1],n*r["Minutes"]/82,n*asset[pid]/82])
        errors.append(prediction-live["minutes_actual"])
    print(len(errors),np.abs(errors).mean(axis=0).round(2))


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("repo","archive","actuals","output"):
        p.add_argument(name,type=Path)
    a=p.parse_args()
    score(a.repo,a.archive,a.actuals,a.output)
