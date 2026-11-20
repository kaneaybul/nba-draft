"""Reprice a continuing player's 328-game window using dated, aligned forecast cells."""
import csv
from dataclasses import dataclass
from datetime import date
from itertools import groupby
from math import isclose, isfinite

import numpy as np


STAGES = ("baseline_minutes", "healthy_rotation", "direct_minutes", "expected_minutes")
COMPONENTS = ("role_forecast", "healthy_team_rotation", "direct_injury", "redistribution")
VERSION = "shared-minutes-comparables-career-v1"


@dataclass(frozen=True)
class Snapshot:
    player: int
    team: str
    asof: date
    clock: int
    stages: np.ndarray
    version: str = VERSION

    def window(self, start):
        offset = start - self.clock
        if offset < 0 or offset + 328 > self.stages.shape[1]:
            raise ValueError("Opening forecast does not cover the requested games")
        return self.stages[:, offset:offset+328]


def read_ledger(path):
    result = {}
    with open(path, newline="") as stream:
        for key, rows in groupby(csv.DictReader(stream), lambda r: int(r["nba_id"])):
            group = list(rows)
            first = group[0]
            clock = int(first["team_game_clock"])
            if key in result or any(int(r["team_game_clock"]) != clock+i or
                                    int(r["game"]) != i+1 or r["asof"] != first["asof"] or
                                    r["team"] != first["team"] for i,r in enumerate(group)):
                raise ValueError(f"Duplicate, mixed or discontinuous ledger for {key}")
            values = np.array([[float(r[k]) for r in group] for k in STAGES])
            p, m, availability, base_p = np.array([
                [float(r[k]) for r in group] for k in
                ("probability", "conditional_mpg", "availability", "baseline_probability")])
            if (not np.isfinite(values).all() or np.any(values < 0) or np.any(values > 48+1e-8)
                    or not np.all((0 <= base_p) & (base_p <= 1))
                    or not np.all((0 <= availability) & (availability <= 1))
                    or not np.all((0 <= m) & (m <= 48+1e-8))
                    or not np.allclose(p, base_p*availability, rtol=0, atol=1e-8)
                    or not np.allclose(values[2], values[1]*availability, rtol=0, atol=1e-8)
                    or not np.allclose(values[3], p*m, rtol=0, atol=1e-8)):
                raise ValueError(f"Invalid forecast or injury reconciliation for {key}")
            values.setflags(write=False)
            result[key] = Snapshot(key, first["team"], date.fromisoformat(first["asof"]), clock, values)
    return result


def impact_per_game(knots, start):
    x, y = np.asarray(knots, dtype=float).T
    if (not np.isfinite([x,y]).all() or len(x)<2 or not np.all(np.diff(x)>0)
            or x[0]>start or x[-1]<start+328):
        raise ValueError("Impact forecast does not cover the full window")
    edges = np.union1d(np.arange(start, start+329), x[(x>start) & (x<start+328)])
    endpoints = np.interp(edges, x, y)
    return np.bincount(np.floor(edges[:-1]-start).astype(int),
                       weights=np.diff(edges)*(endpoints[1:]+endpoints[:-1])/2, minlength=328)


def bridge(opening, closing, opening_knots, closing_knots, opening_price, closing_price,
           *, opening_mark, closing_mark, coordinate_shift=None, closing_price_old_contract=None):
    """Price callback takes (absolute clock, 328 expected minutes, 328 per-minute impacts).

    Supply the same pricing function used for each endpoint, including its contracts,
    market rules and draft calibration. Marks come from those independently recorded
    valuations. The closing basis is introduced last and is reported separately.
    """
    if opening.player != closing.player or opening.asof >= closing.asof:
        raise ValueError("Require ordered observations of one player")
    if opening.version != closing.version:
        raise ValueError("Restate opening under closing method and book migration separately")
    if opening.team != closing.team and coordinate_shift is None:
        raise ValueError("Trade needs the native ownership clock translation")
    shift = 0 if coordinate_shift is None else coordinate_shift
    if int(shift) != shift:
        raise ValueError("Expected integral team-game coordinate translation")
    old_clock = closing.clock-int(shift)
    old = opening.window(old_clock)
    new = closing.window(closing.clock)
    old_impact = impact_per_game(opening_knots, old_clock)
    new_impact = impact_per_game(closing_knots, closing.clock)
    start_value = opening_price(opening.clock, opening.window(opening.clock)[-1],
                                impact_per_game(opening_knots, opening.clock))
    if not isclose(start_value, opening_mark, rel_tol=0, abs_tol=.005):
        raise ValueError("Opening quote fails independent reconstruction")
    # Separate a traded player's clock translation from the old owner's time passage.
    frozen = opening_price(old_clock, old[-1], old_impact)
    repriced = opening_price(closing.clock, old[-1], old_impact)
    components = {"expected_aging_and_window": frozen-start_value, "ownership_clock": repriced-frozen}
    value = lambda minutes, impact: opening_price(closing.clock, minutes, impact)
    impact_delta = .5*((value(old[-1], new_impact)-repriced) +
                       (value(new[-1], new_impact)-value(new[-1], old_impact)))
    components["impact_revision"] = impact_delta
    previous = 0.
    for category, old_stage, new_stage in zip(COMPONENTS, old, new):
        # Average the two orders of the impact and minutes changes. Repricing each
        # stage preserves the nonlinear peak selection and option decisions.
        delta = .5*sum(value(new_stage, impact)-value(old_stage, impact)
                       for impact in (old_impact, new_impact))
        components[category] = delta-previous
        previous = delta
    end_value = closing_price(closing.clock, new[-1], new_impact)
    if not isclose(end_value, closing_mark, rel_tol=0, abs_tol=.005):
        raise ValueError("Closing quote fails independent reconstruction")
    before_basis_change = value(new[-1], new_impact)
    if closing_price_old_contract is None:
        components["pricing_basis_change"] = end_value-before_basis_change
    else:
        old_terms = closing_price_old_contract(closing.clock, new[-1], new_impact)
        components["pricing_and_market_calibration"] = old_terms-before_basis_change
        components["contract_terms"] = end_value-old_terms
    if (not all(map(isfinite, components.values())) or
            not isclose(sum(components.values()), closing_mark-opening_mark, rel_tol=0, abs_tol=.011)):
        raise ValueError("Price bridge does not reconcile")
    return components
