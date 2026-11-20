"""Exact retained appearance/minute/impact service over certified absolute game windows.

Separate from appraisal formula: pass the opening owner's actual dated impact
and replacement inputs. This module cannot attest legacy dollars or infer missing
past completed service, contract terms, expectation, or calibration.
"""
import csv
from itertools import groupby
import numpy as np
from shared_minutes import MinutesPath
from shared_minutes_horizon import VERSION_BY_MPG_METHOD


def read_resolved_ledger(path, asof):
    result = {}
    version = None
    with open(path, newline="") as stream:
        for pid, rows in groupby(csv.DictReader(stream), lambda row: int(row["nba_id"])):
            rows = list(rows)
            team = rows[0]["team"]
            clock = int(rows[0]["team_game_clock"])
            if version is None:
                version = rows[0]["forecast_version"]
                if version not in VERSION_BY_MPG_METHOD.values():
                    raise ValueError("Unknown resolved ledger forecast version")
            if pid in result or any(
                row["asof"] != asof or row["team"] != team or
                row["forecast_version"] != version or int(row["game"]) != i+1 or
                int(row["team_game_clock"]) != clock+i
                for i, row in enumerate(rows)
            ):
                raise ValueError("Mixed or discontinuous resolved player-game ledger")
            path = MinutesPath([row["probability"] for row in rows],
                               [row["conditional_mpg"] for row in rows])
            ledger_minutes = np.array([float(row["expected_minutes"]) for row in rows])
            if not np.allclose(ledger_minutes, path.minutes, rtol=0, atol=1e-8):
                raise ValueError("Minutes disagree with GP × conditional MPG")
            result[pid] = (team, clock, path)
    if not result:
        raise ValueError("No resolved player-game rows")
    return result


def service(ledger, pid, team, start, stop, knots, replacement):
    owner, clock, path = ledger[pid]
    if owner != team or type(start) is not int or type(stop) is not int:
        raise ValueError("Service identity/clock mismatch")
    games, minutes, mpg = path.totals(start-clock, stop-clock)
    x, y = np.asarray(knots, dtype=float).T
    if (len(x) < 2 or not np.all(np.isfinite([x, y])) or not np.isfinite(replacement)
        or not np.all(np.diff(x) > 0) or x[0] > start or x[-1] < stop):
        raise ValueError("Dated impact curve does not cover exact service window")
    edges = np.union1d(np.arange(start, stop+1), x[(x > start) & (x < stop)])
    impact = np.interp(edges, x, y) - replacement
    pos = np.floor(edges[:-1]).astype(int) - clock
    weighted = float(np.dot(np.diff(edges)*path.minutes[pos], (impact[1:]+impact[:-1])*.5))
    return dict(start=start, stop=stop, games=games, minutes=minutes, mpg=mpg,
                above_replacement_impact_minutes=weighted)
