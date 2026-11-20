"""Date-specific expected appearances and conditional minutes on a team-game clock."""
from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class MinutesPath:
    probability: np.ndarray
    conditional_mpg: np.ndarray

    def __post_init__(self):
        p = np.array(self.probability, dtype=float, copy=True)
        m = np.array(self.conditional_mpg, dtype=float, copy=True)
        if p.shape != m.shape or p.ndim != 1 or not p.size:
            raise ValueError("Expected equal nonempty vectors of player-game forecasts")
        if not np.all((0 <= p) & (p <= 1)) or not np.all((0 <= m) & (m <= 48)):
            raise ValueError("Invalid probability or conditional minutes")
        for name, arr in (("probability", p), ("conditional_mpg", m)):
            arr.setflags(write=False)
            object.__setattr__(self, name, arr)

    @property
    def minutes(self):
        return self.probability * self.conditional_mpg

    def totals(self, start, stop):
        if not 0 <= start < stop <= len(self.probability):
            raise ValueError("Window falls outside the forecast")
        games = float(self.probability[start:stop].sum())
        minutes = float(self.minutes[start:stop].sum())
        return games, minutes, minutes / games if games else 0.


class ComparableGames:
    """Historical outcomes indexed by forecast horizon and observation year."""
    def __init__(self, panel, as_of_year, horizons=5, complete_outcomes=None):
        if type(horizons) is not int or horizons < 1:
            raise ValueError("Invalid comparable horizon count")
        self.samples = []
        self.excluded_unknown = []
        self.scale = np.array([4., 20., 7., 1.7, 32., 5.])
        for horizon in range(1, horizons + 1):
            features, outcomes, unknown = [], [], 0
            for year in sorted(panel):
                if year + horizon > as_of_year or year + horizon not in panel:
                    continue
                for identity, row in panel[year].items():
                    if row["games"] < 5:
                        continue
                    future = panel[year+horizon].get(identity)
                    if complete_outcomes is None:
                        outcomes.append(future["games"] if future else 0.)
                    else:
                        # A verified zero is a complete-season no-appearance,
                        # never a missing impact-panel row or unresolved crosswalk.
                        gp = complete_outcomes[year+horizon][identity]
                        if gp is None:
                            unknown += 1
                            continue
                        if not np.isfinite(gp) or not 0 <= gp <= 82:
                            raise ValueError("Invalid certified appearance outcome")
                        outcomes.append(gp)
                    features.append(self.features(panel, year, identity))
            self.excluded_unknown.append(unknown)
            if len(outcomes) < 60:
                raise ValueError(f"Insufficient dated history for horizon {horizon}")
            self.samples.append((np.array(features) / self.scale, np.array(outcomes)))

    @staticmethod
    def features(panel, year, identity):
        row = panel[year][identity]
        prior = panel.get(year-1, {}).get(identity, {})
        return [row["age"], row["games"], row["mpg"], row["impact"],
                prior.get("games", 0.), row["experience"]]

    def predict(self, features):
        query = np.asarray(features) / self.scale
        if not np.isfinite(query).all():
            raise ValueError("Missing comparable-player inputs")
        result = []
        for inputs, outcomes in self.samples:
            distance = np.square(inputs-query).sum(axis=1)
            nearest = np.argsort(distance, kind="stable")[:60]
            result.append(np.average(outcomes[nearest], weights=1/(.35+distance[nearest])))
        return np.array(result)


def project_path(gp, conditional_mpg, near_gp, near_mpg, elapsed=0, length=328,
                 evidence_half_life=41., require_right_support=False):
    """Blend the known role into comparable GP and career MPG by distance in games.
    
    Annual inputs are indexed from the season opener. No season-boundary reset.
    near_gp is the healthy 82-game participation rate. Acute injury updates and
    roster allocation belong to a single downstream scenario calculation.
    """
    gp = np.asarray(gp, float)
    mpg = np.asarray(conditional_mpg, float)
    if gp.shape != mpg.shape or gp.ndim != 1 or not len(gp):
        raise ValueError("Annual role vectors must align")
    if not 0 <= elapsed <= 82 or length <= 0 or evidence_half_life <= 0:
        raise ValueError("Invalid forecast clock")
    MinutesPath(np.r_[near_gp, gp]/82, np.r_[near_mpg, mpg])
    distance = np.arange(length) + .5
    midpoints = (np.arange(len(gp))+.5)*82
    if require_right_support and elapsed + distance[-1] > midpoints[-1]:
        raise ValueError("Forecast would silently clamp beyond its final observed anchor")
    weight = np.exp2(-distance/evidence_half_life)
    probability = (weight*near_gp + (1-weight)*np.interp(elapsed+distance, midpoints, gp))/82
    minutes = weight*near_mpg + (1-weight)*np.interp(elapsed+distance, midpoints, mpg)
    return MinutesPath(probability, minutes)


