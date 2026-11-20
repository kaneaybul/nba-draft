"""Check that the actual shared ledger supports each dated rookie appraisal."""
import argparse
from collections import Counter, defaultdict
import csv
import json
from math import fsum, isfinite
from pathlib import Path


def verify(ledger, scope):
    scope = json.loads(Path(scope).read_bytes())
    assert scope["schema"] == "nba-appraisal-scope-v1"
    people = scope["players"]
    expected = {int(x) for x, r in people.items() if r["appraisal_seasons"]}
    asof = scope["asof"]
    seen, minutes, games = defaultdict(set), defaultdict(list), defaultdict(list)
    seasons = Counter()
    for pid in expected:
        for y in people[str(pid)]["appraisal_seasons"]:
            seasons[y] += 1
    versions = set()
    with Path(ledger).open(newline="") as stream:
        for row in csv.DictReader(stream):
            player = int(row["nba_id"])
            if player not in expected:
                continue
            years = people[str(player)]["appraisal_seasons"]
            if row["asof"] != asof or row["team"] != people[str(player)]["team"]:
                raise ValueError(f"Wrong observation or owner for {player}")
            versions.add(row["forecast_version"])
            clock = int(row["team_game_clock"])
            y = clock//82 + 2000
            if y not in years:
                continue
            if clock in seen[player,y]:
                raise ValueError(f"Duplicate {player} game {clock}")
            p, m, n = (float(row[k]) for k in ("probability","conditional_mpg","expected_minutes"))
            if not all(map(isfinite,(p,m,n))) or not 0<=p<=1 or not 0<=m<=48 or abs(p*m-n)>1e-7:
                raise ValueError(f"Inconsistent service math for {player} game {clock}")
            seen[player,y].add(clock)
            minutes[player,y].append(n)
            games[player,y].append(p)
    if len(versions) != 1:
        raise ValueError("Mixed or missing forecast method")
    result={}
    for pid in sorted(expected):
        team = people[str(pid)]["team"]
        result[str(pid)]={"team":team,"seasons":[]}
        for y in people[str(pid)]["appraisal_seasons"]:
            if seen[pid,y] != set(range(82*(y-2000),82*(y-1999))):
                raise ValueError(f"Incomplete rookie appraisal for {pid} {y}")
            result[str(pid)]["seasons"].append({"season":y,"expected_games":fsum(games[pid,y]),
                                               "expected_minutes":fsum(minutes[pid,y])})
    return {"asof":asof,"forecast_version":versions.pop(),"appraisals_with_complete_service":len(expected),
            "annual_service_cells":sum(seasons.values()),"season_coverage":dict(seasons),"players":result,
            "prices_generated":False,"release_ready":False}


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for k in ("ledger","scope","out"):
        p.add_argument(k)
    a=p.parse_args()
    contents=verify(a.ledger,a.scope)
    with Path(a.out).open("x") as f:
        json.dump(contents,f,allow_nan=False)
    print(json.dumps({k:v for k,v in contents.items() if k!="players"},indent=2))
