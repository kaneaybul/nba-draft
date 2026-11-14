"""Forecast future rotation MPG and expected games from completed seasons."""
from __future__ import annotations

import csv
import json
import shutil
import sys
from pathlib import Path

FORECAST_FILE = 'direct_future_minutes.json'
HORIZONS = range(1, 6)


def features(panel, year, pid):
    from valuation_engine import state_features

    state = panel.states[year, pid]
    result = state_features(state, panel.history(year, pid))
    for lag in (1, 2):
        old = panel.states.get((year - lag, pid))
        for field in ('games', 'minutes', 'total', 'age'):
            result[f'lag{lag}_{field}'] = getattr(old, field) if old else float('nan')
        result[f'lag{lag}_mpg'] = old.minutes / old.games if old and old.games else float('nan')
    result['role_trend'] = result['mpg'] - result['lag1_mpg']
    position = panel.by_id[year, pid].get('position') or ''
    for role in ('G', 'F', 'C'):
        result['position_' + role] = float(role in position)
    return result


def fit_forecasts(panel, first_origin=2020):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline
    from threadpoolctl import threadpool_limits

    keys = sorted(key for key, state in panel.states.items() if state.games >= 5)
    inputs = np.array([list(features(panel, *key).values()) for key in keys])
    years = np.array([year for year, _ in keys])
    forecasts = {}
    with threadpool_limits(limits=1):
        for horizon in HORIZONS:
            games = np.full(len(keys), np.nan)
            mpg = np.full(len(keys), np.nan)
            for index, (year, pid) in enumerate(keys):
                outcome = year + horizon
                if outcome > panel.last_year:
                    continue
                target = panel.states.get((outcome, pid))
                if target is not None:
                    games[index] = target.games
                    if target.games >= 5:
                        mpg[index] = target.minutes / target.games
                else:
                    name = panel.by_id[year, pid]['key']
                    if (outcome, name) not in panel.bref and (outcome, pid) not in panel.actual_stats:
                        games[index] = 0
            for origin in range(first_origin, panel.last_year + 1):
                test = years == origin
                eligible = years + horizon <= origin
                role_train = eligible & np.isfinite(mpg)
                games_train = eligible & np.isfinite(games)
                if not test.any() or role_train.sum() < 200 or games_train.sum() < 200:
                    continue
                predictions = []
                for target, train, limit in ((games, games_train, 82), (mpg, role_train, 38)):
                    model = make_pipeline(
                        SimpleImputer(strategy='median', add_indicator=True, keep_empty_features=True),
                        HistGradientBoostingRegressor(max_iter=160, max_leaf_nodes=7,
                            learning_rate=.045, l2_regularization=15, min_samples_leaf=35,
                            random_state=615),
                    )
                    model.fit(inputs[train], target[train])
                    predictions.append(np.clip(model.predict(inputs[test]), 0, limit))
                for index, games_pred, mpg_pred in zip(np.flatnonzero(test), *predictions):
                    _, pid = keys[index]
                    row = forecasts.setdefault(str(origin), {}).setdefault(str(pid), {})
                    row[str(origin + horizon)] = {'games': round(float(games_pred), 6),
                                                 'mpg': round(float(mpg_pred), 6)}
    return forecasts


def train(runtime, repo, output):
    from calibration.historical import HistoricalPanel

    projections = runtime / 'monthly_reconstruction/projections'
    sys.path.insert(0, str(projections))
    with (projections / 'annual_history.csv').open() as stream:
        last = max(int(row['season']) for row in csv.DictReader(stream))
    source = output / 'future_minutes_inputs'
    source.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(repo / 'raw/bref_player_seasons.csv', source / 'bref_player_seasons.csv')
    shutil.copyfile(repo / 'processed/livedata/impactrefresh/salary_cap_assumptions.csv',
                    source / 'salary_cap_assumptions.csv')
    panel = HistoricalPanel(runtime, source, last_year=last)
    forecasts = fit_forecasts(panel)
    if str(last) not in forecasts:
        raise ValueError('No direct minutes forecasts for the latest completed season')
    path = runtime / FORECAST_FILE
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(forecasts, separators=(',', ':'), allow_nan=False))
    temporary.replace(path)
    return forecasts


def apply_forecast(path, table, pid, current_year, target_year, regular_season_finished,
                   observed_games=None, observed_minutes=None):
    """Keep current rotation separate from future estimates and use dated season cutoffs."""
    origin = current_year if regular_season_finished else current_year - 1
    rows = table.get(str(origin), {}).get(str(pid), {})
    anchor = rows.get(str(current_year))
    role_change = 0.0
    if not regular_season_finished and anchor and observed_games and observed_minutes is not None:
        # Use only verified appearances. The roster allocator and the injury
        # overlay do not supply evidence for future-season conditional MPG.
        observed_mpg = observed_minutes / observed_games
        weight = .5 * min(observed_games / 82, 1) * observed_games / (observed_games + 10)
        role_change = weight * (observed_mpg - anchor['mpg'])
    result = {}
    for year, value in path.items():
        row = rows.get(str(year)) if year > target_year else None
        if row is None:
            result[year] = value
        else:
            mpg = row['mpg'] + role_change / (year - target_year)
            result[year] = {'games': row['games'], 'mpg': max(0, min(38, mpg))}
    return result
