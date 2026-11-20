"""Generate both proposed consumer inputs from an existing dated daily assembly."""
import argparse
import subprocess
import sys
from pathlib import Path


def assemble(repo, assembly, asof, season, out):
    scripts=Path(__file__).resolve().parents[1]
    history=repo/"frontend/public/data/v2/impact_players"
    roster=history/f"{season}.json"
    injuries=assembly/"prepared/repo/frontend/public/data/injury_outlook.json"
    schedule=assembly/"source_r/schedule.json"
    batch=assembly/"native/replay/batches"/asof/"output"
    out.mkdir()
    healthy=out/"healthy.csv"
    final=out/"resolved.csv"
    commands=[
        [sys.executable,scripts/"build_shared_roles.py",history,roster,asof,healthy],
        ["Rscript",scripts/"allocate_shared_roles.R",repo,healthy,roster,schedule,injuries,asof,final],
        [sys.executable,scripts/"shared_minutes_export.py",final,roster,batch,out/"consumer_inputs.json",asof],
    ]
    for argv in commands:
        subprocess.run(argv,check=True)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("repo","assembly","out"):
        p.add_argument(name,type=Path)
    p.add_argument("asof")
    p.add_argument("season",type=int)
    a=p.parse_args()
    assemble(a.repo,a.assembly,a.asof,a.season,a.out)
