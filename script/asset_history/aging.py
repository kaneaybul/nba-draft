"""Age-only attribution using the existing total-impact projection curve.

Freeze minutes, availability, replacement, dollars per impact point, contracts,
and the opening four-season exposures. Integrate the model's age/experience
drift over elapsed calendar time, then reprice the same production path. Recent
performance momentum is excluded. This is an attribution counterfactual, never
a new player valuation. Draftee expectation comparisons remain intact.
"""
from __future__ import annotations
import csv, math
from datetime import date
from pathlib import Path
from quote_window import quote_window

POLICY = 'projection-age-curve-fixed-opportunity-v1'
AGE_TERMS = {'(Intercept)', 'age_peak_distance', 'age_peak_distance_sq', 'yoe'}


def load_curve(path):
    with Path(path).open() as f:
        rows = [r for r in csv.DictReader(f)
                if r['target'] == 'target_delta_total' and r['algorithm'] == 'lm']
    terms = {r['term']: float(r['estimate']) for r in rows}
    if set(terms) != AGE_TERMS | {'delta_total'}:
        raise ValueError('Review aging attribution for changed projection terms')
    return {k: terms[k] for k in sorted(AGE_TERMS)}


def integrated_drift(age, experience, years, coefficients):
    """Integral of the same annual delta model with performance momentum zero."""
    if years < 0 or not all(math.isfinite(x) for x in (age, experience, years)):
        raise ValueError('Invalid aging interval')
    x = age - 27.
    return (coefficients['(Intercept)'] * years
            + coefficients['age_peak_distance'] * (x * years + years**2 / 2)
            + coefficients['age_peak_distance_sq'] * (x*x*years + x*years**2 + years**3/3)
            + coefficients['yoe'] * (experience*years + years**2/2))


def basis(row, annual, calibrator):
    """Retain the original annual scorer's dollar sensitivity, without repricing."""
    if not annual or row.get('asset_type') in ('unsigned_draft_right', 'dormant_draft_right', 'dormant_retention_right'):
        return {'policy': POLICY, 'status': 'no_active_production'}
    pid = int(float(row.get('source_nba_id') or row['ledger_nba_id']))
    source_year = int(float(annual[0]['source_profile_season']))
    known = [(y, age) for (y, p), age in calibrator.ages.items() if p == pid and y <= source_year]
    if not known:
        # Match the scorer's explicit limited-history age prior; expose it.
        age, age_year, age_source = 22., source_year, 'existing_model_age22_prior'
    else:
        age_year, age = max(known)
        age_source = 'dated_player_age'
    experience = [(y, value) for (y, p), value in calibrator.experience.items() if p == pid and y <= source_year]
    if experience:
        exp_year, exp = max(experience)
    else:
        exp_year = source_year
        draft = row.get('draft_year')
        exp = max(0., source_year-int(float(draft))) if draft not in (None, '') else max(0., age+source_year-age_year-19.)
    path = []
    for r in annual:
        year = int(r['season'])
        minutes = float(r['forecast_annual_minutes'])
        sensitivity = (minutes * float(r['scale_budget_scenario']) * 30.
                       / float(r['league_timin']) * 164961000. / float(r['salary_cap_scenario']))
        path.append(dict(season=year, age=age+year-age_year,
                         experience=max(0., exp+year-exp_year),
                         dollars_per_total=sensitivity, total=float(r['latent_total'])))
    return dict(policy=POLICY, status='priced', age_source=age_source, annual=path)


def expected_aging(asset, start, end, coefficients):
    d = asset.get('details', {})
    annual = d.get('annual_values', [])
    if not annual:
        return 0.
    b = d.get('aging_basis')
    if not b or b.get('policy') != POLICY:
        raise ValueError('Missing aging basis: '+asset['name']+' '+start)
    if b['status'] == 'no_active_production':
        return 0.
    years = (date.fromisoformat(end)-date.fromisoformat(start)).days / 365.2425
    byyear = {r['season']: r for r in b['annual']}
    before, after, exposure = [], [], []
    for r in annual:
        state = byyear[int(r['season'])]
        drift = integrated_drift(state['age'], state['experience'], years, coefficients)
        drift = max(-8., min(12., state['total']+drift)) - state['total']
        # A declined continuation is a financial option, not active production.
        change = drift * state['dollars_per_total'] if r['production'] != 0 else 0.
        before.append(r['production']); after.append(r['production']+change)
        exposure.append(r['exposure'])
    return (quote_window(after, after, exposure)['production_quote']
            - quote_window(before, before, exposure)['production_quote'])
