"""Build healthy role curves from dated roster inputs and completed annual player exports."""
import argparse
import csv
import json
from datetime import date
from pathlib import Path
import numpy as np
from shared_minutes import ComparableGames, project_path


def read_history(directory, season):
    panel = {}
    for path in sorted(directory.glob("*.json")):
        if not path.stem.isdigit() or int(path.stem) >= season:
            continue
        year = int(path.stem)
        rows = {}
        for r in json.loads(path.read_text()):
            games = r.get("games") or 0
            if games <= 0 or any(r.get(k) is None for k in ("age", "Minutes", "total")):
                continue
            # Shortened-season normalization matches the dated benchmark.
            scale = 82 / {2020: 72, 2021: 72}.get(year, 82)
            rows[r["nba_id"]] = dict(age=r["age"], experience=r["yoe"] or 0,
                                     games=min(82, games*scale), mpg=r["Minutes"]/games,
                                     impact=r["total"])
        panel[year] = rows
    return panel


def healthy_roles(history, players, season):
    model = ComparableGames(history, season-1)
    for row in players:
        if row["pool_status"] != "roster":
            continue
        pid = row.get("source_nba_id") or row["nba_id"]
        prior = history[season-1].get(pid)
        elapsed = 82-int(row["minutes_remaining_team_games"])
        near_gp = row["minutes_gp_prior"]
        # A trade changes the team's clock. Do not treat pre-trade appearances
        # as extra opportunities or infer absences from an incomplete stint.
        observed_gp = row.get("minutes_actual_games") or 0
        near_mpg = row["minutes_mpg_prior"]
        if observed_gp:
            near_mpg = (10*near_mpg + row["minutes_actual"])/(10+observed_gp)
        if prior and prior["games"] >= 5:
            features = model.features(history, season-1, pid)
        else:
            features = [row["age"], near_gp, near_mpg, row["total"], 0, row["yoe"] or 0]
        anchors = model.predict(features)
        roles = [row["minutes_mpg_prior"]]
        for i in range(1,5):
            next_role = row.get(f"projection_mpg_y{i}")
            roles.append(roles[-1] if next_role is None else next_role)
        curve = project_path(anchors, roles, near_gp, min(48, near_mpg), elapsed,
                             length=410-elapsed)
        yield pid, row["team"], curve


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("history", type=Path)
    parser.add_argument("roster", type=Path)
    parser.add_argument("asof", type=date.fromisoformat)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    roster = json.loads(args.roster.read_text())
    seasons = {r["year"] for r in roster if r["pool_status"]=="roster"}
    if len(seasons) != 1:
        raise ValueError("Supply a single season of dated roster inputs")
    for r in roster:
        if r["pool_status"]=="roster" and (r.get("minutes_checked_at") or "")[:10] != args.asof.isoformat():
            raise ValueError("Roster snapshot and forecast observation dates differ")
    season = seasons.pop()
    paths = list(healthy_roles(read_history(args.history,season), roster,season))
    if len({pid for pid,_,_ in paths}) != len(paths):
        raise ValueError("Duplicate roster identity")
    with args.out.open("x",newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["asof","team","nba_id","game","probability","conditional_mpg"])
        for pid,team,curve in paths:
            for i,(p,m) in enumerate(zip(curve.probability,curve.conditional_mpg),1):
                writer.writerow([args.asof,team,pid,i,p,m])

if __name__ == "__main__":
    main()
