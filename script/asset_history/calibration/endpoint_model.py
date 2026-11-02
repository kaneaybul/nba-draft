"""One production prior for draft rights, young players and draft evaluation.

The fitted target is the contract-neutral production stock observable at the
end of development (seasons five through eight projected after season four).
Linked first-four-year service paths translate that prior to a daily rolling
quote. Salaries are applied only after production has been projected.
"""
from __future__ import annotations
import math
import numpy as np
from .historical import name_key
from .path_model import slot_weights, evidence_weight, fit_reliability, path_quotes

POLICY = 'year-four-production-endpoint-v1'


def production_quotes(paths):
    p = np.atleast_2d(np.asarray(paths, float))
    if p.shape[1] != 4 or not np.isfinite(p).all():
        raise ValueError('Endpoint requires four finite production years')
    return 2 * np.sort(np.maximum(p, 0), axis=1)[:, -2:].sum(axis=1)


def build_records(panel):
    records, excluded = [], []
    seen = set()
    for d in panel.drafts:
        if not d.get('pick_overall'):
            continue
        cohort, slot = int(d['draft_year']), int(d['pick_overall'])
        if cohort < 2014 or cohort + 4 > panel.last_year or (cohort, slot) in seen:
            continue
        seen.add((cohort, slot))
        key = name_key(d['player'])
        ids = panel.names.get(key, set())
        if len(ids) > 1:
            excluded.append(dict(key=key, reason='ambiguous identity'))
            continue
        pid = next(iter(ids), None)
        end = cohort + 4
        state = panel.states.get((end, pid))
        observed = panel.actual_stats.get((end, pid)) or panel.bref.get((end, key))
        if state is None and observed and float(observed.get('minutes') or 0) > 0:
            excluded.append(dict(key=key, reason='endpoint service without rating'))
            continue
        tail = np.maximum(panel.forecast(end, pid, 4) if state else [0.] * 4, 0.).tolist()
        service = [panel.outcome(key, cohort+j, pid) if cohort+j in panel.raw else None for j in range(1, 5)]
        # Unknown service is excluded from the rolling translation, never zero.
        linked = None if any(p is None for p in service) else [float(p) for p in service] + tail
        records.append(dict(key=key, player=d['player'], cohort=cohort, slot=slot,
                            end=end, endpoint=tail, value=float(production_quotes(tail)[0]),
                            production=linked))
    return records, excluded


class EndpointModel:
    def __init__(self, records):
        self.records = records
        self.cache = {}

    def prior(self, slot, cutoff, exclude=None):
        k = (int(slot), int(cutoff), exclude)
        if k in self.cache:
            return self.cache[k]
        rows = [r for r in self.records if r['end'] <= cutoff and r['key'] != exclude]
        if len(rows) < 30:
            raise ValueError('Insufficient completed year-four endpoint labels')
        x = np.column_stack([np.ones(len(rows)), np.log([r['slot'] for r in rows])])
        beta = np.linalg.lstsq(x, [r['value'] for r in rows], rcond=None)[0]
        target = max(0., float(np.array([1., math.log(slot)]) @ beta))
        linked = [r for r in rows if r.get('production') is not None]
        if len(linked) < 30:
            raise ValueError('Insufficient linked service / endpoint paths')
        weights = slot_weights([r['slot'] for r in linked], slot)
        paths = np.asarray([r['production'] for r in linked], float)
        center = float(weights @ production_quotes(paths[:, 4:8]))
        if center <= 0:
            raise ValueError('Cannot normalize a zero endpoint production prior')
        # Existing log-slot shrinkage, fitted to the NEW production endpoint.
        # One factor preserves the link between development and mature talent.
        scale = target / center
        result = dict(value=target, paths=paths*scale, weights=weights,
                      scale=scale, training_n=len(rows), linked_n=len(linked),
                      latest_label=max(r['end'] for r in rows), coefficients=beta.tolist())
        self.cache[k] = result
        return result


def learning_cases(panel, records):
    """Predict the SAME endpoint at every stage, with completed-label cutoffs."""
    model = EndpointModel(records)
    cases = []
    for r in records:
        ids = panel.names.get(r['key'], set())
        if len(ids) != 1:
            continue
        pid = next(iter(ids))
        for stage in (1, 2, 3):
            origin = r['cohort'] + stage
            if (origin, pid) not in panel.states or origin < 2018:
                continue
            try:
                prior = model.prior(r['slot'], origin, r['key'])
            except ValueError:
                continue
            full = panel.forecast(origin, pid, r['cohort']+8-origin)
            own = full[4-stage:8-stage]
            cases.append(dict(key=r['key'], player=r['player'], cohort=r['cohort'],
                              stage=stage, origin=origin, label_end=r['end'], slot=r['slot'],
                              minutes=panel.career_minutes(r['key'], pid, r['cohort'], origin),
                              prior=prior['value'], nba=float(production_quotes(own)[0]),
                              actual=r['value'], latest_prior_label=prior['latest_label']))
    holdouts = []
    for r in cases:
        fit = fit_reliability(cases, r['origin'])
        if fit['n'] >= 30:
            w = evidence_weight(r['minutes'], fit['scale'])
            holdouts.append({**r, 'prediction': r['prior']+w*(r['nba']-r['prior']),
                             'weight': w, 'latest_learning_label': fit['latest_label']})
    error = np.array([r['prediction']-r['actual'] for r in holdouts])
    return cases, dict(target=POLICY, n=len(holdouts),
                       rmse=float(np.sqrt(np.mean(error**2))) if len(error) else None,
                       mae=float(np.mean(abs(error))) if len(error) else None,
                       first_season_learning=False, holdouts=holdouts)


def pick_components(model, slot, costs, prior_model=None):
    """Translate the shared endpoint-trained prior into a current asset quote."""
    p = (prior_model or EndpointModel(model['endpoint_records'])).prior(slot, model['endpoint_training_through'])
    service = p['paths'][:, :4]
    w = p['weights']
    production = float(w @ (2*np.sort(service,axis=1)[:,-2:].sum(axis=1)))
    cumulative = float(w @ service.sum(axis=1))
    adjustment = .8 * (cumulative - sum(costs))
    raw = production + adjustment
    return dict(production_quote=production, cumulative_production=cumulative,
                contract_adjustment=adjustment, quote=max(0., raw),
                floor_adjustment=max(0., raw)-raw,
                draft_endpoint_expectation=p['value'])


def build_pick_model(previous, records, cutoff):
    import copy
    from backfill.forfeiture_rules import RoundAwarePickQuotes
    model = copy.deepcopy(previous)
    model['legacy_original_window_fit']=copy.deepcopy(previous.get('legacy_original_window_fit',previous['pick_fit']))
    for k in ('holdout_year','holdout_players','holdout_rmse','training_players','player_seasons','cohorts'):
        model['pick_fit'].pop(k,None)
    model.update(endpoint_records=records, endpoint_training_through=cutoff, production_policy=POLICY)
    model['pick_fit'].update(target=POLICY,
        model='Linked service paths normalized to log-slot year-four production endpoint; salaries applied afterward',
        endpoint_training_players=len(records), endpoint_training_through=cutoff,
        endpoint_label_scope='Retrospective production forecast observable after season four; not realized seasons five through eight or observed trade prices',
        rolling_translation='First-four service paths linked to the same mature endpoint paths',
        legacy_coefficients='Retained for archived-model compatibility only; v5 uses endpoint_records')
    quote = RoundAwarePickQuotes(model)
    for row in model['pick_curve']:
        c = quote.components(1 if row['pick'] <= 30 else 2, row['pick'])
        row.update(quote=c['quote'], peak_production_quote=c['production_quote'],
                   cumulative_production_quote=c['cumulative_production'],
                   contract_adjustment=c['contract_adjustment'],
                   draft_endpoint_expectation=c['draft_endpoint_expectation'])
    return model


def own_endpoint_path(player, annual, draft, states, runtime):
    """Read raw production before contract choices; extend own missing years."""
    from valuation_engine import AnnualState, project_path
    years = list(range(draft+5, draft+9))
    raw = {int(r['season']): max(0., float(r['annual_production'])*164961000./float(r['salary_cap_scenario']))
           for r in annual}
    if all(y in raw for y in years):
        return [raw[y] for y in years]
    first = min(annual, key=lambda r: int(r['season']))
    year = int(first['season'])
    pid = int(float(player.get('source_nba_id') or player['ledger_nba_id']))
    previous = states.get((year-1, pid))
    games = float(player['healthy_forecast_annual_games'])
    mpg = float(player.get('healthy_forecast_conditional_MPG') or 0)
    state = AnnualState(year, previous.age+1 if previous else 22.,
                        previous.yoe+1 if previous else year-draft,
                        float(player['healthy_current_total']), games, min(3300., games*mpg))
    history = [s for (y, p), s in states.items() if p == pid and y < year]
    path = {s.season:s for s in project_path(state, sorted(history, key=lambda s:s.season), max(years)-year)}
    # The producer supplies the dated production-pricing coefficient, not salary.
    coefficient = float(first['scale_budget_scenario'])/float(first['salary_cap_scenario'])*164961000.*30/float(first['league_timin'])
    replacement = float(first['replacement'])
    anchors = [y for y in raw if y in path and raw[y] > 0]
    level = lambda y: max(0., (path[y].total-replacement)*path[y].minutes*coefficient)
    scale = 1.
    if anchors:
        anchor = max(anchors)
        if level(anchor) > 0:
            scale = raw[anchor]/level(anchor)
    return [raw[y] if y in raw else scale*level(y) for y in years]
