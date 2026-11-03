"""Build point-in-time-label-safe career and forecast-error panels.

The impact specification is retrospective, not an archive of forecasts that
were actually published at the time. Mean-model TERMS are reused, but their
coefficients are refit using transitions completed by each forecast origin.
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np

from .path_model import feature_vector


def name_key(name):
    s = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[.,]', ' ', s).strip()
    s = re.sub(r'\s+(jr|sr|ii|iii|iv|v)$', '', s).strip()
    k = re.sub(r'[^a-z0-9]', '', s)
    return {'juanhernangomez':'juanchohernangomez','nicolasclaxton':'nicclaxton',
            'cameronthomas':'camthomas','nathanwilliams':'natewilliams',
            'kenyonmartin':'kjmartin','ishmaelsmith':'ishsmith'}.get(k,k)


def read_csv(path):
    return list(csv.DictReader(Path(path).open()))


class HistoricalPanel:
    def __init__(self, runtime, source, reporting_cap=164961000., impute_small_service=True, last_year=2026):
        self.runtime, self.source = Path(runtime), Path(source)
        self.reporting_cap = reporting_cap
        self.last_year=int(last_year)
        self.impute_small_service = impute_small_service
        self.estimated_outcomes = {}
        self.audit = Counter()
        self.caps = {2016:70000000., 2017:94143000., 2018:99093000.,
                     2019:101869000., 2020:109140000.}
        self.caps.update({int(r['year']):float(r['salary_cap']) for r in
                         read_csv(self.source/'salary_cap_assumptions.csv')})
        self.raw = {y:json.load((self.runtime/f'app_model/impact_{y}.json').open())
                    for y in range(2016, self.last_year+1)}
        self.by_id, self.by_name, self.coefficient = {}, {}, {}
        self.bref = {}
        for r in read_csv(self.source/'bref_player_seasons.csv'):
            k = (int(r['year']), name_key(r['player_name']))
            # The all-team aggregate has more GP than any traded-team fragment.
            if k not in self.bref or float(r['games']) > float(self.bref[k]['games']):
                self.bref[k] = r
        self.actual_stats = {(int(r['season']), int(r['nba_id'])):r for r in
                             read_csv(self.runtime/'monthly_reconstruction/projections/annual_history.csv')}
        self.names = defaultdict(set)
        for year, rows in self.raw.items():
            factors = []
            for r in rows:
                base = (r['total']-r['replacement_total'])*r['Minutes']
                if r.get('season_value') is not None and abs(base) > 100:
                    factors.append(r['season_value']/base)
            self.coefficient[year] = float(np.median(factors))*reporting_cap/self.caps[year]
            self.audit['priced_season_coefficients'] += 1
            for r in rows:
                r = dict(r)
                pid = int(r['nba_id'])
                k = name_key(r['player_name'])
                self.names[k].add(pid)
                r['key'] = k
                production = r.get('season_value')
                if production is None:
                    production = (r['total']-r['replacement_total'])*r['Minutes']*self.coefficient[year]
                    self.audit['reconstructed_dnq_production'] += 1
                else:
                    production *= reporting_cap/self.caps[year]
                r['production'] = float(production)
                self.by_id[year, pid] = r
                self.by_name[year, k] = r
        self.drafts = read_csv(self.runtime/'app_model/processed/draft/draft_picks_all_classes.csv')
        self.draft_by_name = {name_key(r['player']):r for r in self.drafts}
        # Same-name profiles must never be silently joined across two people.
        self.ambiguous = {k for k, ids in self.names.items() if len(ids)>1}
        self.low_service_rates = {}
        for year in self.raw:
            rates = [r['production']/r['Minutes'] for (yy,pid),r in self.by_id.items()
                     if yy==year and 0<r['Minutes']<=500]
            self.low_service_rates[year] = np.quantile(rates,[.05,.5,.95]).tolist()
        self.states = {}
        from valuation_engine import AnnualState
        for (year, pid), r in self.by_id.items():
            stats = self.actual_stats.get((year, pid))
            bref = self.bref.get((year, r['key']))
            games = r.get('games')
            if games is None:
                games = float(stats['games']) if stats else float(bref['games']) if bref else None
            experience = r.get('yoe')
            if experience is None:
                observed = [(yy, rr['yoe']) for (yy, pp), rr in self.by_id.items()
                            if pp == pid and rr.get('yoe') is not None]
                draft = self.draft_by_name.get(r['key'])
                if observed:
                    yy, value = min(observed, key=lambda pair:abs(pair[0]-year))
                    experience = value+year-yy
                elif draft:
                    experience = year-int(draft['draft_year'])
            if games is None or experience is None or r.get('age') is None:
                self.audit['states_missing_games_or_experience'] += 1
                continue
            factor = 82 / ({2020:75, 2021:72}.get(year,82))
            self.states[year,pid] = AnnualState(year,float(r['age']),max(0,float(experience)),
                float(r['total']),min(82,float(games)*factor),min(3300,float(r['Minutes'])*factor))
        self.fit_cache = {}
        self.states_by_id = defaultdict(list)
        for (year,pid),state in self.states.items():
            self.states_by_id[pid].append(state)

    def outcome(self, key, year, pid=None):
        if pid is None and len(self.names.get(key,set())) == 1:
            pid = next(iter(self.names[key]))
        r = self.by_id.get((year, pid)) if pid is not None else self.by_name.get((year,key))
        if r is not None:
            return r['production']
        official=self.actual_stats.get((year,pid)) if pid is not None else None
        if (year,key) in self.bref or official:
            minutes = float(official['minutes']) if official else float(self.bref[year,key]['minutes'])
            if self.impute_small_service and minutes<=400:
                lo,median,hi = self.low_service_rates[year]
                # Explicit small-service estimate, never a fictitious no-service
                # zero. Keep an interval and expose every estimated label.
                self.estimated_outcomes[year,key] = dict(season=year,key=key,minutes=minutes,
                    production=median*minutes,low=lo*minutes,high=hi*minutes,
                    method='median same-season modeled production/minute among <=500-minute players')
                return median*minutes
            self.audit['unknown_outcome_with_recorded_NBA_service'] += 1
            return None
        # A verified no-NBA-service season is a real zero, not missing ratings.
        return 0.

    def history(self, year, pid):
        return [s for s in self.states_by_id[pid] if s.season<year]

    def career_minutes(self,key,pid,cohort,through):
        total=0.
        for year in range(cohort+1,through+1):
            official=self.actual_stats.get((year,pid))
            impact=self.by_id.get((year,pid))
            bref=self.bref.get((year,key))
            if official:
                total+=float(official['minutes'])
            elif impact:
                total+=float(impact['Minutes'])
            elif bref:
                total+=float(bref['minutes'])
        return total

    def fit(self, cutoff):
        if cutoff in self.fit_cache:
            return self.fit_cache[cutoff]
        from valuation_engine import state_features, load_coefficients
        terms = {k:list(v) for k,v in load_coefficients().items()
                 if k in ('target_games','target_role_mpg','target_delta_total')}
        xx, yy = defaultdict(list), defaultdict(list)
        for (year,pid), s in sorted(self.states.items()):
            if year+1>cutoff:
                continue
            nxt = self.states.get((year+1,pid))
            key = self.by_id[year,pid]['key']
            if nxt is None and (year+1,key) in self.bref:
                continue  # Rating is missing; do not label the player a dropout.
            f = state_features(s, self.history(year,pid))
            targets = {'target_games':nxt.games if nxt else 0.}
            if nxt and nxt.games>0:
                targets.update(target_role_mpg=nxt.minutes/nxt.games,
                               target_delta_total=nxt.total-s.total)
            for target, value in targets.items():
                xx[target].append([1. if t=='(Intercept)' else f[t] for t in terms[target]])
                yy[target].append(value)
        result = {}
        for target, ts in terms.items():
            if len(yy[target])<100:
                raise ValueError('Too few chronologically completed transitions')
            coefficients = np.linalg.lstsq(np.asarray(xx[target]),np.asarray(yy[target]),rcond=None)[0]
            result[target] = dict(zip(ts, coefficients.tolist()))
        self.fit_cache[cutoff] = result
        return result

    def forecast(self, year, pid, horizon=5):
        from valuation_engine import project_next_state
        current = self.states[year,pid]
        history = self.history(year,pid)
        coefficients = self.fit(year)
        base = self.by_id[year,pid]
        coefficient = self.coefficient[year]*({2020:75,2021:72}.get(year,82))/82
        production = []
        for _ in range(horizon):
            nxt = project_next_state(current,history,coefficients)
            production.append((nxt.total-base['replacement_total'])*nxt.minutes*coefficient)
            history.append(current)
            current = nxt
        return production

    def residual_rows(self):
        result = []
        for (origin,pid), state in sorted(self.states.items()):
            if origin<2017 or origin>=self.last_year:
                continue
            key = self.by_id[origin,pid]['key']
            if key in self.ambiguous:
                continue
            h = min(5,self.last_year-origin)
            observed = [self.outcome(key,origin+j,pid) for j in range(1,h+1)]
            # Retain every known prefix; a later missing season cannot erase it.
            h = next((i for i,v in enumerate(observed) if v is None),h)
            if not h:
                continue
            mean = self.forecast(origin,pid,h)
            result.append(dict(key=key,pid=pid,origin=origin,horizon=h,
                feature=feature_vector(state.age,state.total,state.minutes,state.yoe),
                mean=mean,actual=observed[:h],
                residual=(np.array(observed[:h])-np.array(mean)).tolist()))
        return result

    def career_rows(self):
        result = []
        seen = set()
        for draft in self.drafts:
            if not draft.get('pick_overall'):
                continue
            cohort, slot = int(draft['draft_year']), int(draft['pick_overall'])
            if cohort<2016 or cohort>=self.last_year:
                continue
            key = name_key(draft['player'])
            if (cohort,slot) in seen or key in self.ambiguous:
                continue
            seen.add((cohort,slot))
            for stage in range(4):
                h = min(5,self.last_year-cohort-stage)
                if h<=0:
                    continue
                p = [self.outcome(key,cohort+stage+j) for j in range(1,h+1)]
                h = next((i for i,v in enumerate(p) if v is None),h)
                if h:
                    result.append(dict(key=key,player=draft['player'],cohort=cohort,slot=slot,
                        stage=stage,horizon=h,label_end=cohort+stage+h,production=p[:h],
                        estimated_years=[cohort+stage+j for j in range(1,h+1)
                                         if (cohort+stage+j,key) in self.estimated_outcomes]))
        return result


def eligible_careers(rows, cutoff, stage=0, horizon=4):
    """Make shorter valid prefixes available without leaking later labels."""
    return [dict(r, horizon=horizon, label_end=r['cohort']+stage+horizon,
                 production=r['production'][:horizon]) for r in rows
            if r['stage']==stage and r['horizon']>=horizon
            and r['cohort']+stage+horizon<=cutoff]

