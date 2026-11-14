"""One production prior for draft rights, young players and draft evaluation.

The fitted target is the contract-neutral production stock observable at the
end of development (seasons five through eight projected after season four).
Linked first-four-year service paths translate that prior to a daily rolling
quote. Salaries are applied only after production has been projected.
"""
from __future__ import annotations
import math,json,csv
from functools import lru_cache
import numpy as np
from .historical import name_key
from .path_model import slot_weights, evidence_weight, fit_reliability, path_quotes

POLICY = 'year-four-assessed-production-paths-v3'
PICK_POLICY = 'year-four-endpoint-picks-shared-players-v4'


def production_quotes(paths):
    p = np.atleast_2d(np.asarray(paths, float))
    if p.shape[1] != 4 or not np.isfinite(p).all():
        raise ValueError('Endpoint requires four finite production years')
    return 2 * np.sort(np.maximum(p, 0), axis=1)[:, -2:].sum(axis=1)


def build_records(panel, errors=None):

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
        tail = list(panel.forecast(end, pid, 4) if state else [0.] * 4)
        # The endpoint is now known. Its label is the canonical contract-neutral
        # forward appraisal, not an extra premium for unknown years five to eight.
        paths=np.asarray([tail]);weights=np.ones(1);values=production_quotes(paths)
        audit=dict(n=1,latest_label=end,method='completed year-four assessed production',
                   verified_no_endpoint_service=state is None)
        service = [panel.outcome(key, cohort+j, pid) if cohort+j in panel.raw else None for j in range(1, 5)]
        # Unknown service is excluded from the rolling translation, never zero.
        linked = None if any(p is None for p in service) else [float(p) for p in service] + tail
        records.append(dict(key=key, player=d['player'], cohort=cohort, slot=slot,
                            end=end, endpoint=tail, value=float(weights@values),
                            endpoint_paths=paths.tolist(),endpoint_weights=weights.tolist(),
                            endpoint_audit=audit,production=linked))
    return records, excluded


class EndpointModel:
    def __init__(self, records):
        self.records = records
        self.cache = {}

    def prior(self, slot, cutoff, exclude=None, endpoint_only=False):
        k = (int(slot), int(cutoff), exclude, endpoint_only)
        if k in self.cache:
            return self.cache[k]
        rows = [r for r in self.records if r['end'] <= cutoff and r['key'] != exclude]
        if len(rows) < 30:
            raise ValueError('Insufficient completed year-four endpoint labels')
        x = np.column_stack([np.ones(len(rows)), np.log([r['slot'] for r in rows])])
        beta = np.linalg.lstsq(x, [r['value'] for r in rows], rcond=None)[0]
        target = max(0., float(np.array([1., math.log(slot)]) @ beta))
        linked = [r for r in rows if r.get('production') is not None]
        if len(linked)<30 and not endpoint_only:
            raise ValueError('Insufficient linked service / endpoint paths')
        if not linked:
            # Endpoint-only labels remain valid when early service ratings are
            # unavailable. They cannot manufacture a daily service translation.
            result=dict(value=target,paths=np.empty((0,8)),weights=np.empty(0),scale=None,
                        training_n=len(rows),linked_n=0,latest_label=max(r['end']for r in rows),coefficients=beta.tolist())
            self.cache[k]=result
            return result
        weights = slot_weights([r['slot'] for r in linked], slot)
        paths = np.asarray([r['production'] for r in linked], float)
        center = float(weights @ np.asarray([r['value'] for r in linked]))
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

    def distribution(self,slot,cutoff,exclude=None):
        prior=self.prior(slot,cutoff,exclude,endpoint_only=True)
        if 'endpoint_distribution' not in prior:
            rows=[r for r in self.records if r['end']<=cutoff and r['key']!=exclude]
            w=slot_weights([r['slot']for r in rows],slot)
            values=[];weights=[]
            center=float(w@np.asarray([r['value']for r in rows]))
            scale=prior['value']/center if center>0 else 0.
            for row,weight in zip(rows,w):
                p=row['endpoint_paths'] if 'endpoint_paths'in row else [row['endpoint'] if 'endpoint'in row else row['production'][4:8]]
                probabilities=np.asarray(row.get('endpoint_weights',[1.]),float)
                values.extend(production_quotes(p)*scale);weights.extend(weight*probabilities)
            prior['endpoint_distribution']=(np.asarray(values),np.asarray(weights))
        return prior['endpoint_distribution']


def learning_cases(panel, records, errors=None, endpoint_errors=None):
    """Predict the SAME endpoint at every stage, with completed-label cutoffs."""
    from .path_model import feature_vector
    from .endpoint_paths import EndpointRevisionPool,build_endpoint_errors
    residuals=EndpointRevisionPool(build_endpoint_errors(panel)if endpoint_errors is None else endpoint_errors)
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
                prior = model.prior(r['slot'], r['cohort']-1, r['key'],endpoint_only=True)
            except ValueError:
                continue
            full = panel.forecast(origin, pid, r['cohort']+8-origin)
            state=panel.states[origin,pid]
            paths,weights,audit=residuals.scenarios(full[4-stage:8-stage],
                feature_vector(state.age,state.total,state.minutes,state.yoe),origin,4-stage,r['key'])
            values=production_quotes(paths)
            cases.append(dict(key=r['key'], player=r['player'], cohort=r['cohort'],
                              stage=stage, origin=origin, label_end=r['end'], slot=r['slot'],
                              minutes=panel.career_minutes(r['key'], pid, r['cohort'], origin),
                              prior=prior['value'], nba=float(weights@values),
                              latest_residual_label=audit['latest_label'],
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
                       training_stages=[1,2,3],first_season_weight_extrapolation=True,holdouts=holdouts)


def pick_components(model, slot, costs, prior_model=None, draft_year=None):
    """Translate the shared endpoint-trained prior into a current asset quote."""
    cutoff=min(model['endpoint_training_through'],int(draft_year)-1) if draft_year is not None else model['endpoint_training_through']
    p = (prior_model or EndpointModel(model['endpoint_records'])).prior(slot, cutoff)
    cost_key=tuple(float(c)for c in costs)
    if model.get('stock_policy')==PICK_POLICY and cost_key in p.get('pick_cost_quotes',{}):
        return dict(p['pick_cost_quotes'][cost_key])
    service = p['paths'][:, :4]
    w = p['weights']
    production = p['value'] if model.get('stock_policy') in ('year-four-endpoint-stock-v2',PICK_POLICY) else float(w @ (2*np.sort(service,axis=1)[:,-2:].sum(axis=1)))
    cumulative = float(w @ service.sum(axis=1))
    adjustment = .8 * (cumulative - sum(costs))
    raw = production + adjustment
    # Each production career is already priced before the expectation above.
    # Salary is linear, so this equals E[P_i + .8*(service_i-cost)]. Retain
    # negative career payoffs: the right's ex-ante floor cannot erase expected
    # rookie costs after learning which player disappointed.
    quote=max(0.,raw)
    result=dict(production_quote=production, cumulative_production=cumulative,
                contract_adjustment=adjustment, quote=quote,
                floor_adjustment=quote-raw,
                draft_endpoint_expectation=p['value'])
    if model.get('stock_policy')==PICK_POLICY:p.setdefault('pick_cost_quotes',{})[cost_key]=dict(result)
    return result


def build_pick_model(previous, records, cutoff):
    import copy
    from backfill.forfeiture_rules import RoundAwarePickQuotes
    model = copy.deepcopy(previous)
    model['legacy_original_window_fit']=copy.deepcopy(previous.get('legacy_original_window_fit',previous['pick_fit']))
    for k in ('holdout_year','holdout_players','holdout_rmse','training_players','player_seasons','cohorts'):
        model['pick_fit'].pop(k,None)
    model.update(endpoint_records=records, endpoint_training_through=cutoff, production_policy=POLICY,stock_policy=PICK_POLICY)
    model['pick_fit'].update(target=POLICY,
        model='Linked service paths normalized to log-slot year-four production endpoint; salaries applied afterward',
        endpoint_training_players=len(records), endpoint_training_through=cutoff,
        endpoint_label_scope='Contract-neutral production appraisal assessed after season four; uncertainty concerns development and forecast revisions before that endpoint, never realized seasons five through eight',
        rolling_translation='First-four service paths linked to the same mature endpoint paths',
        legacy_coefficients='Retained for archived-model compatibility only; current release uses endpoint_records')
    quote = RoundAwarePickQuotes(model)
    for row in model['pick_curve']:
        c = quote.components(1 if row['pick'] <= 30 else 2, row['pick'])
        row.update(quote=c['quote'], peak_production_quote=c['production_quote'],
                   cumulative_production_quote=c['cumulative_production'],
                   contract_adjustment=c['contract_adjustment'],
                   draft_endpoint_expectation=c['draft_endpoint_expectation'])
    return model


@lru_cache(maxsize=2)
def direct_forecasts(path):
    return json.loads(path.read_text())


@lru_cache(maxsize=2)
def rookie_ages(path):
    return {name_key(r['player_name']):float(r['draft_age']) for r in csv.DictReader(path.open())
            if r.get('draft_age') not in (None,'')}


def own_endpoint_path(player, annual, draft, states, runtime, audit=None, canonical=False):
    """Read raw production before contract choices; extend own missing years."""
    from valuation_engine import AnnualState, project_path
    years = list(range(draft+5, draft+9))
    from rolling_context import path_from_player, annual_mean
    rolling=path_from_player(player)
    if rolling is not None:
        impact,clock=rolling
        first=min(annual,key=lambda r:int(r['season']));year=int(first['season'])
        coefficient=float(first['scale_budget_scenario'])/float(first['salary_cap_scenario'])*164961000.*30/float(first['league_timin'])
        replacement=float(first['replacement']);values=[];sensitivities=[];endpoint_minutes=[]
        for y in years:
            saved=next((r for r in annual if int(r['season'])==y),None)
            if saved is None or saved.get('endpoint_role_annual_minutes') in (None,''):
                raise ValueError(f'Missing anchored endpoint minutes {y}')
            minutes=float(saved['endpoint_role_annual_minutes'])
            if not math.isfinite(minutes) or minutes<0:
                raise ValueError(f'Invalid anchored endpoint minutes {y}')
            values.append((annual_mean(impact,y)-replacement)*minutes*coefficient)
            sensitivities.append(minutes*coefficient);endpoint_minutes.append(minutes)
        if audit is not None:audit.update(method='same_rolling_path_integrated_year_four_endpoint',
            team_game_clock=clock,years=years,impact_sensitivities=sensitivities,
            endpoint_annual_minutes=endpoint_minutes,endpoint_minutes_source='endpoint_only_same_origin_preseason_anchor',
            impact_path_policy='rolling-team-games-impact-v1')
        return values
    raw = {int(r['season']): float(r['annual_production'])*164961000./float(r['salary_cap_scenario'])
           for r in annual}
    if canonical:
        raw={int(r['season']):float(r['app_annual_quote_production_reporting_rate'])for r in annual}
    if audit is not None:audit.update(method='published_raw_production',extended_seasons=[y for y in years if y not in raw])
    if all(y in raw for y in years):
        return [raw[y] for y in years]
    first = min(annual, key=lambda r: int(r['season']))
    year = int(first['season'])
    pid = int(float(player.get('source_nba_id') or player['ledger_nba_id']))
    previous = states.get((year-1, pid))
    age=previous.age+1 if previous else 22.
    if previous is None and runtime is not None:
        ages=runtime/'monthly_reconstruction/projections/rookie_priors.csv'
        if ages.exists():
            draft_age=rookie_ages(ages).get(name_key(player['player_name']))
            if draft_age is not None:age=draft_age+.5+year-draft-1
    games = float(player['healthy_forecast_annual_games'])
    mpg = float(player.get('healthy_forecast_conditional_MPG') or 0)
    state = AnnualState(year, age,
                        previous.yoe+1 if previous else year-draft,
                        float(player['healthy_current_total']), games, min(3300., games*mpg))
    history = [s for (y, p), s in states.items() if p == pid and y < year]
    path = {s.season:s for s in project_path(state, sorted(history, key=lambda s:s.season), max(years)-year)}
    # The producer supplies the dated production-pricing coefficient, not salary.
    coefficient = float(first['scale_budget_scenario'])/float(first['salary_cap_scenario'])*164961000.*30/float(first['league_timin'])
    replacement = float(first['replacement'])
    anchors = raw.keys() & path.keys()
    direct={}
    if runtime is not None and (runtime/'direct_future_minutes.json').exists():
        table=direct_forecasts(runtime/'direct_future_minutes.json')
        direct=table.get(str(first['league_reference_year']),{}).get(str(pid),{})
    def level(y):
        role=direct.get(str(y))
        minutes=role['games']*role['mpg'] if role else path[y].minutes
        return (path[y].total-replacement)*minutes*coefficient
    if audit is not None:
        audit['method'] = 'own_career_model_extension'
    offset = 0.
    if anchors:
        anchor = max(anchors)
        # Production is a signed amount above replacement. Near that baseline,
        # a ratio of the two projections can magnify tiny disagreements into
        # enormous future rates. Align levels and retain the model's dollar
        # changes from the latest shared season, including zero/negative marks.
        offset = raw[anchor] - level(anchor)
        if audit is not None:
            audit.update(method='level_aligned_career_extension', anchor_season=anchor,
                         anchor_offset=offset)
    return [raw[y] if y in raw else level(y) + offset for y in years]
