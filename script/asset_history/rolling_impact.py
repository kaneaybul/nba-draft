"""Rolling impact path. Clock units are TEAM games, never player appearances.

Pure functions shared by live and historical pricing. Annual model predictions
are interpreted as points 82 team games apart, not season-wide production rates.
The fixed-model annual training has not itself been changed or retrained.
"""
from dataclasses import dataclass
from math import isfinite, isclose


def finite(x):
    x = float(x)
    if not isfinite(x):
        raise ValueError('nonfinite path input')
    return x


@dataclass(frozen=True)
class ImpactPath:
    # Absolute cumulative team-game coordinates allow a no-news forecast to
    # retain exactly the same value for exactly the same future game.
    knots: tuple

    def __post_init__(self):
        if len(self.knots) < 2:
            raise ValueError('at least two knots required')
        for i, (x, y) in enumerate(self.knots):
            finite(x); finite(y)
            if i and x <= self.knots[i-1][0]:
                raise ValueError('knots must increase strictly')

    @classmethod
    def annual(cls, clock, totals):
        return cls(tuple((finite(clock)+82*i, finite(v)) for i, v in enumerate(totals)))

    def at(self, x):
        x = finite(x)
        if not self.knots[0][0] <= x <= self.knots[-1][0]:
            raise ValueError('path horizon exhausted; extend with annual model, never extrapolate silently')
        for (a, u), (b, v) in zip(self.knots, self.knots[1:]):
            if a <= x <= b:
                return u+(v-u)*(x-a)/(b-a)
        raise AssertionError('unreachable')

    def mean(self, start, end):
        start, end = finite(start), finite(end)
        if end <= start:
            raise ValueError('positive interval required')
        cuts = [start] + [x for x, _ in self.knots if start < x < end] + [end]
        area = sum((b-a)*(self.at(a)+self.at(b))/2 for a, b in zip(cuts, cuts[1:]))
        return area/(end-start)

    def extend(self, totals):
        """Append model-produced endpoint totals at 82-game spacing."""
        last = self.knots[-1][0]
        return ImpactPath(self.knots+tuple((last+82*(i+1),finite(v)) for i,v in enumerate(totals)))


def update_path(previous, clock, observation, evidence_changed, project_totals):
    """Return (new_path, innovation), preserving same-games forecasts on track.

    Caller determines actual new evidence from payload/provenance, NOT provider
    season labels. No news means ordinary aging on the old path, not resetting
    to an old unchanged observation. Real news is compared with expected NOW.
    project_totals must return [nowcast, +82, +164, ...] from the annual model.
    """
    expected = previous.at(clock) if previous else None
    if previous and not evidence_changed:
        return previous, 0.0
    observation = finite(observation)
    innovation = observation-expected if expected is not None else None
    if previous and isclose(innovation, 0, abs_tol=1e-12):
        return previous, 0.0
    totals = tuple(project_totals(observation))
    if not totals or not isclose(totals[0], observation, abs_tol=1e-12):
        raise ValueError('annual model path must begin at current nowcast')
    return ImpactPath.annual(clock, totals), innovation


def season_slice_means(path, clock, exposures):
    """Calendar salary buckets get correct impact over their actual game span.

    Exposures are existing chronological (season, fraction) pairs summing to 4.
    Their sum is 328 team games even when the player misses every game.
    Do not group the rolling model endpoints by provider season labels.
    """
    if not isclose(sum(e for _,e in exposures),4.,abs_tol=1e-8):
        raise ValueError('four team-season equivalents required')
    result = {}
    start = finite(clock)
    for season, exposure in exposures:
        if not 0 < exposure <= 1 or season in result:
            raise ValueError('invalid/duplicate season exposure')
        end = start+82*exposure
        result[season] = path.mean(start,end)
        start = end
    return result


def split_change(old_value, aged_counterfactual_value, revised_value):
    """Ordinary aging/window carry is separate from new-evidence development.

    Counterfactual must advance the OLD forecast and use frozen calibration,
    role, contracts, and padding inputs. Do not feed actual revised value here
    and call the resulting timing movement development.
    """
    old, aged, new = map(finite,(old_value,aged_counterfactual_value,revised_value))
    return {'ordinary_aging_and_window_roll':aged-old,
            'new_evidence_and_other_changes':new-aged,
            'total_change':new-old}


def reprice_aging_counterfactual(old_path, old_clock, new_clock,
                                old_exposures, new_exposures,
                                frozen_value_fn, revised_value):
    """Reprice SAME opening path at BOTH sets of slice boundaries.

    frozen_value_fn(slice_means, exposures) must use opening role, calibration,
    salary/padding policy and quote selector. The closing slice means MUST be
    reintegrated, not copied from annualized opening buckets. Transactions and
    separate baseline changes require their own attribution legs upstream.
    """
    if new_clock < old_clock:
        raise ValueError('team-game clock cannot run backward')
    opening = frozen_value_fn(season_slice_means(old_path, old_clock, old_exposures),old_exposures)
    aged = frozen_value_fn(season_slice_means(old_path, new_clock, new_exposures),new_exposures)
    return dict(split_change(opening, aged, revised_value),
                opening_value=opening,aged_counterfactual_value=aged)
