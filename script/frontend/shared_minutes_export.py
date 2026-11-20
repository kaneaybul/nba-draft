"""Export production totals and four-year asset service from one resolved game ledger."""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from shared_minutes import MinutesPath


def load_paths(filename, asof):
    groups = defaultdict(list)
    with filename.open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row["asof"] != asof:
                raise ValueError("Mixed forecast dates")
            groups[int(row["nba_id"])].append(row)
    paths = {}
    for pid, rows in groups.items():
        rows.sort(key=lambda row: int(row["game"]))
        if any(int(row["game"]) != i for i, row in enumerate(rows, 1)):
            raise ValueError(f"Missing or duplicate game for {pid}")
        paths[pid] = MinutesPath([r["probability"] for r in rows], [r["conditional_mpg"] for r in rows])
    return paths


def service(path, start, stop, knots, replacement):
    """Minutes are constant within a game. Integrate piecewise linear impact exactly."""
    x, y = np.array(knots, dtype=float).T
    if (len(x) < 2 or not np.all(np.isfinite([x, y])) or
            not np.all(np.diff(x) > 0) or x[0] > start or x[-1] < stop):
        raise ValueError("Impact curve does not cover the pricing window")
    edges = np.union1d(np.arange(start, stop + 1), x[(x > start) & (x < stop)])
    impact = np.interp(edges, x, y) - replacement
    mins = path.minutes[np.floor(edges[:-1]).astype(int)]
    return float(np.dot(np.diff(edges)*mins, (impact[1:]+impact[:-1])/2))


def export(ledger, roster, batch, asof):
    paths = load_paths(ledger, asof)
    players = json.loads(roster.read_text())
    production, assets = {}, {}
    for r in players:
        if r["pool_status"] != "roster":
            continue
        pid = int(r.get("source_nba_id") or r["nba_id"])
        path = paths[pid]
        remaining = int(r["minutes_remaining_team_games"])
        start = 0
        production[pid] = []
        for offset, width in enumerate([remaining,82,82,82,82]):
            games, minutes, _ = path.totals(start,start+width) if width else (0,0,0)
            actual_gp = (r.get("minutes_actual_games") or 0) if offset == 0 else 0
            actual_min = (r.get("minutes_actual") or 0) if offset == 0 else 0
            season_gp = games+actual_gp
            season_minutes = minutes+actual_min
            production[pid].append(dict(season=r["year"]+offset, future_games=games,
                                        future_minutes=minutes, games=season_gp, minutes=season_minutes,
                                        mpg=season_minutes/season_gp if season_gp else 0))
            start += width
    if set(paths)!=set(production):
        raise ValueError("Production roster differs from game ledger")
    for team in sorted(batch.iterdir()):
        if not team.is_dir() or not (team/"monthly_annual_values.csv").is_file():
            continue
        with (team/"monthly_player_values.csv").open() as stream:
            impact_rows = {r["player_name"]:r for r in csv.DictReader(stream)}
        with (team/"monthly_annual_values.csv").open() as stream:
            for row in csv.DictReader(stream):
                if row["active_asset"]!="True" or row["asset_type"] not in ("roster_contract","two_way"):
                    continue
                exposure = float(row["exposure"])
                if exposure <= 0:
                    continue
                pid = int(float(row["source_nba_id"] or row["ledger_nba_id"]))
                path = paths[pid]
                source = impact_rows[row["player_name"]]
                if row["cutoff_date"] != asof or source["cutoff_date"] != asof:
                    raise ValueError("Pricing observation date mismatch")
                clock = float(source["impact_team_game_clock"])
                season = int(row["season"])
                start = max(0, 82*(season-2000)-clock)
                stop = min(328, 82*(season+1-2000)-clock)
                if start!=int(start) or stop!=int(stop) or abs(stop-start-82*exposure)>1e-7:
                    raise ValueError("Asset and schedule clocks disagree")
                start,stop=int(start),int(stop)
                knots=[(x-clock,y) for x,y in json.loads(source["impact_path_knots_json"])]
                games,minutes,mpg=path.totals(start,stop)
                weighted=service(path,start,stop,knots,float(row["replacement"]))
                cells=assets.setdefault(pid,{})
                if season in cells:
                    raise ValueError("Duplicate priced player season")
                cells[season]=dict(start=start,stop=stop,games=games,minutes=minutes,mpg=mpg,
                                   annual_minutes=minutes/exposure,annual_impact_minutes=weighted/exposure)
    for pid,cells in assets.items():
        ordered=sorted(cells.values(),key=lambda c:c["start"])
        if ordered[0]["start"]!=0 or ordered[-1]["stop"]!=328 or any(
                a["stop"]!=b["start"] for a,b in zip(ordered,ordered[1:])):
            raise ValueError("Incomplete four-year window")
        for season,c in cells.items():
            prod=next(r for r in production[pid] if r["season"]==season)
            if c["stop"]<328 and abs(c["minutes"]-prod["future_minutes"])>1e-7:
                raise ValueError("Production and asset minutes disagree")
    return dict(asof=asof,production=production,asset_service=assets)


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("ledger","roster","batch","output"):
        p.add_argument(name,type=Path)
    p.add_argument("asof")
    a=p.parse_args()
    result=export(a.ledger,a.roster,a.batch,a.asof)
    with a.output.open("x") as stream:
        json.dump(result,stream,allow_nan=False,separators=(",",":"))
