"""Keep the age inputs recorded alongside canonical annual player quotes."""
from __future__ import annotations

POLICY = 'projection-age-curve-fixed-opportunity-v1'


def basis(row, annual, calibrator):
    """Retain the original annual scorer's dollar sensitivity, without repricing."""
    if not annual or row.get('asset_type') in ('unsigned_draft_right', 'dormant_draft_right', 'dormant_retention_right'):
        return {'policy': POLICY, 'status': 'no_active_production'}
    if all(r.get('latent_total') in (None, '') and r.get('forecast_annual_minutes') in (None, '') for r in annual):
        return {'policy': POLICY, 'status': 'no_active_production'}
    raw_pid = row.get('source_nba_id') or row.get('ledger_nba_id')
    pid = int(float(raw_pid)) if raw_pid not in (None, '') else None
    source = annual[0].get('source_profile_season')
    cutoff = row['cutoff_date'] if source in (None, '') else None
    source_year = int(float(source)) if source not in (None, '') else int(cutoff[:4])+(int(cutoff[5:7])>=7)
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
