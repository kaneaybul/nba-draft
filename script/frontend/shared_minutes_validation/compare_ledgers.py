"""Reconcile dated player minutes over matching four-year windows in two daily assemblies."""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared_minutes_accounting import COMPONENTS, read_ledger


def compare(opening, closing):
    old, new = read_ledger(opening), read_ledger(closing)
    report = {"players": {}, "transfers": {}, "entrants": sorted(new.keys()-old.keys()),
              "exits": sorted(old.keys()-new.keys())}
    for pid in old.keys() & new.keys():
        a,b = old[pid],new[pid]
        if a.asof>=b.asof:
            raise ValueError("Opening observation must precede closing observation")
        if a.team != b.team:
            report["transfers"][pid] = [a.team,b.team]
            continue
        base = a.window(a.clock)[-1].sum()
        carried = a.window(b.clock)
        revised = b.window(b.clock)
        stage_changes = revised.sum(axis=1)-carried.sum(axis=1)
        components = dict(zip(COMPONENTS,np.diff(stage_changes,prepend=0).tolist()))
        components["expected_window_change"] = float(carried[-1].sum()-base)
        end = float(revised[-1].sum())
        if abs(base + sum(components.values()) - end)>1e-7:
            raise ValueError(f"Unreconciled minutes for {pid}")
        report["players"][pid] = dict(opening=float(base),closing=end,components=components)
    return report


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("opening","closing","output"):
        p.add_argument(name,type=Path)
    a=p.parse_args()
    report=compare(a.opening,a.closing)
    with a.output.open("x") as stream:
        json.dump(report,stream,allow_nan=False)
