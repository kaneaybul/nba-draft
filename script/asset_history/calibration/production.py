"""Versioned young-player path quotes from full, unfloored annual forecasts.

The producer owns means, minutes, injuries, ownership and salary schedules.
This layer prices linked scenarios, then exports expected annual components
and an expected peak quote. It never prices the peak of averaged scenarios.
"""
from __future__ import annotations
import csv,gzip,hashlib,json,math,sys
from collections import defaultdict
from pathlib import Path
import numpy as np
from .historical import HistoricalPanel,name_key
from .path_model import ResidualPool,slot_weights,regularize_paths,summarize,evidence_weight,fit_reliability

REPORTING_CAP=164961000.
POLICY='young-career-paths-v1'


def number(value):
    if value in (None,''):return None
    n=float(value)
    if not math.isfinite(n):raise ValueError('Nonfinite calibration input')
    return n


def prepare(runtime,repo,state,output):
    """Refit only when completed training data or model source changes."""
    annual=runtime/'monthly_reconstruction/projections/annual_history.csv'
    last=max(int(r['season'])for r in csv.DictReader(annual.open()))
    source=output/'path_calibration_inputs';source.mkdir(exist_ok=True)
    inputs={'bref_player_seasons.csv':repo/'raw/bref_player_seasons.csv',
            'salary_cap_assumptions.csv':repo/'processed/livedata/impactrefresh/salary_cap_assumptions.csv'}
    for name,path in inputs.items():(source/name).write_bytes(path.read_bytes())
    files=[annual,*inputs.values(),runtime/'app_model/processed/draft/draft_picks_all_classes.csv',
           runtime/'monthly_reconstruction/projections/app_sources/career_projection_selected_terms.csv',
           runtime/'monthly_reconstruction/projections/valuation_engine.py',
           *[runtime/f'app_model/impact_{y}.json'for y in range(2016,last+1)],
           *[Path(__file__).with_name(n)for n in ('production.py','path_model.py','historical.py','run_backtest.py')]]
    hashes=[(p.name,hashlib.sha256(p.read_bytes()).hexdigest())for p in files]
    signature=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()
    cache=state/'path_calibration.json.gz'
    data=None
    if cache.exists():
        with gzip.open(cache,'rt')as f:saved=json.load(f)
        if saved.get('signature')==signature:data=saved
    sys.path.insert(0,str(runtime/'monthly_reconstruction/projections'))
    if data is None:
        from .run_backtest import evaluate
        panel=HistoricalPanel(runtime,source,last_year=last)
        errors=panel.residual_rows();careers=panel.career_rows()
        training=output/'path_calibration_training';training.mkdir(exist_ok=True)
        report=evaluate(panel,errors,careers,training)
        cases=json.loads((training/'young_holdouts.json').read_text())
        data=dict(policy=POLICY,signature=signature,training_through=last,errors=errors,careers=careers,cases=cases,
                  report=report,source_hashes=hashes,audit=dict(panel.audit))
        with gzip.open(cache,'wt',compresslevel=6)as f:json.dump(data,f,separators=(',',':'),allow_nan=False)
    panel=None  # Production evidence uses actual annual stats, not imputed production.
    (output/'path_calibration_status.json').write_text(json.dumps({k:v for k,v in data.items()
        if k not in ('errors','careers','cases')},indent=2,allow_nan=False))
    return PathCalibrator(runtime,repo,data)


class PathCalibrator:
    def __init__(self,runtime,repo,data):
        self.runtime=runtime;self.repo=repo;self.data=data
        self.residuals=ResidualPool(data['errors']);self.careers=data['careers'];self.cases=data['cases']
        self.stats={};self.ages={};self.experience={}
        for r in csv.DictReader((runtime/'monthly_reconstruction/projections/annual_history.csv').open()):
            self.stats[int(r['season']),int(r['nba_id'])]=float(r['minutes'])
            self.ages[int(r['season']),int(r['nba_id'])]=float(r['age'])
        for year in range(2016,data['training_through']+1):
            for r in json.loads((runtime/f'app_model/impact_{year}.json').read_text()):
                if r.get('age')is not None:self.ages[year,int(r['nba_id'])]=float(r['age'])
                if r.get('yoe')is not None:self.experience[year,int(r['nba_id'])]=float(r['yoe'])
        self.bref={}
        for r in csv.DictReader((repo/'raw/bref_player_seasons.csv').open()):
            if r.get('minutes')in(None,''):continue
            k=(int(r['year']),name_key(r['player_name']))
            self.bref[k]=max(self.bref.get(k,0),float(r['minutes']))
        self.observations={}
        for r in json.loads((runtime/'monthly_reconstruction/skill/monthly_skill_observations.json').read_text()):
            if r.get('nba_id')is not None and r.get('minutes')is not None:
                self.observations[r['date'],int(r['nba_id'])]=float(r['minutes'])
        self.caps={int(r['year']):(float(r['salary_cap']),float(r['scale_cap']))for r in
                   csv.DictReader((runtime/'app_model/processed/livedata/impactrefresh/salary_cap_assumptions.csv').open())}
        self.caps[2027]=(REPORTING_CAP,self.caps[2027][1])
        from expected_contracts import ExpectedContracts
        self.contracts=ExpectedContracts(self.caps)
        self.pick_curve={int(r['pick']):r for r in json.loads((repo/'processed/asset_history/picks/trained_pick_model.json').read_text())['pick_curve']}
        agreements=json.loads((repo/'processed/asset_history/contracts/contract_agreements.json').read_text())
        adjustments=json.loads((repo/'processed/asset_history/contracts/contract_adjustments.json').read_text())
        agreements += [dict(r,adjustment_only=True,salaries=[])for r in adjustments]
        self.agreements=defaultdict(list)
        for r in agreements:
            for pid in [r.get('nba_id'),*r.get('app_id_aliases',[])]:
                if pid is not None:self.agreements[int(pid)].append(r)
        self.rates={};self.events=defaultdict(int)

    def rate(self,cutoff):
        if cutoff not in self.rates:self.rates[cutoff]=fit_reliability(self.cases,cutoff)
        return self.rates[cutoff]

    def quote(self,player,annual):
        draft=number(player.get('draft_year'));slot=number(player.get('draft_slot'))
        if draft is None or slot is None:return None
        annual=sorted([r for r in annual if number(r['exposure'])>0],key=lambda r:int(r['season']))
        if not annual:raise ValueError('Missing full annual path')
        cutoff=int(annual[0]['league_reference_year']);stage=cutoff-int(draft)
        if stage<0 or stage>=4:return None  # Veteran and generic pick policies are retained.
        key=name_key(player['player_name']);raw_id=player.get('source_nba_id')or player.get('ledger_nba_id')
        pid=int(float(raw_id))if raw_id not in(None,'')else None
        if pid is None:raise ValueError('A selected active player needs a stable identity')
        dt=player['cutoff_date'];h=len(annual);e=np.array([float(r['exposure'])for r in annual])
        if not np.isclose(e.sum(),4):raise ValueError('Path calibration requires four full season-equivalents')
        fitted=self.rate(cutoff)
        if fitted['n']<30:
            self.events['insufficient_mature_learning_labels']+=1
            return dict(status='insufficient_mature_learning_labels',cutoff=cutoff)
        pool=[r for r in self.careers if r['stage']==stage and r['horizon']>=h and
              r['cohort']+stage+h<=cutoff and r['key']!=key]
        if not pool:
            self.events['insufficient_mature_career_paths']+=1
            return dict(status='insufficient_mature_career_paths',cutoff=cutoff)
        # Raw production is before both continuation and release choices.
        mean=np.array([float(r['annual_production'])*REPORTING_CAP/float(r['salary_cap_scenario'])for r in annual])
        available=np.array([float(r['availability_overlay'])for r in annual])
        healthy=np.divide(mean,available,out=np.zeros(h),where=available>0)
        costs=np.array([float(r['app_effective_contract'])*REPORTING_CAP/float(r['salary_cap_scenario'])for r in annual])
        total=float(player['healthy_current_total'])
        games=float(player['healthy_forecast_annual_games']);mpg=float(player['healthy_forecast_conditional_MPG'])
        # Age is knowable at the cutoff; full annual state rows supply the
        # current impact/role and reference-year history supplies reliability.
        age=self.ages.get((cutoff,pid),22.)
        from .path_model import feature_vector
        feature=feature_vector(age,total,games*mpg,self.experience.get((cutoff,pid),max(1,stage)))
        try:nba,nw,residual_meta=self.residuals.scenarios(healthy,feature,cutoff,True,key)
        except ValueError:
            self.events['insufficient_completed_residual_paths']+=1
            return dict(status='insufficient_completed_residual_paths',cutoff=cutoff)
        nba*=available
        prior=np.array([r['production'][:h]for r in pool]);pw=slot_weights([r['slot']for r in pool],int(slot))
        target=None
        if stage==0 and h==4:
            curve=self.pick_curve[int(slot)]
            target=curve['peak_production_quote']+.8*curve['cumulative_production_quote']
        prior,prior_scale=regularize_paths(prior,[r['slot']for r in pool],int(slot),pw,e,target)
        prior*=available
        minutes=sum(self.stats.get((y,pid),self.bref.get((y,key),0.))for y in range(int(draft)+1,cutoff+1))
        # The reliability fit has no first-season training cases. Keep that
        # draft prior intact; update established young players as minutes accrue.
        observed=self.observations.get((dt,pid),0.)if stage>=1 else 0.
        weight=0. if stage==0 else evidence_weight(minutes+observed,fitted['scale'])
        from league_player_values import agreements_at
        cap_by_year={int(r['season']):float(r['salary_cap_scenario'])for r in annual}
        def cap(year,_):
            if year in cap_by_year:return cap_by_year[year]
            base=min(cap_by_year);return cap_by_year[base]*1.05**(year-base)
        known,_,_=agreements_at(self.agreements.get(pid,[]),player['player_name'],pid,dt,name_key,cap)
        cells={int(r['year']):r for r in known}
        def price(p):
            p=p.copy();c=np.broadcast_to(costs,p.shape).copy()
            for j,row in enumerate(annual):
                year=int(row['season']);nominal_cap=float(row['salary_cap_scenario'])
                if row['is_unsigned_market_year']=='True':
                    yos=max(0,stage+year-int(annual[0]['season']))
                    for i,value in enumerate(p[:,j]):
                        salary=self.contracts.expected(value*nominal_cap/REPORTING_CAP,
                            float(row['scale_budget_scenario']),nominal_cap,yos,cutoff)[0]
                        c[i,j]=salary*REPORTING_CAP/nominal_cap
                    decline=1.8*p[:,j]-.8*c[:,j]<0
                    p[decline,j]=0;c[decline,j]=0
                else:
                    cell=cells.get(year)
                    if cell and cell.get('waiver_option_verified'):
                        guaranteed=float(cell['waiver_guaranteed_amount_asof'])*REPORTING_CAP/nominal_cap
                        release=1.8*p[:,j]-.8*c[:,j]<-.8*guaranteed
                        p[release,j]=0;c[release,j]=guaranteed
            return p,c
        nba,nc=price(nba);prior,pc=price(prior)
        paths=np.concatenate([prior,nba]);cost_paths=np.concatenate([pc,nc]);weights=np.concatenate([(1-weight)*pw,weight*nw])
        result=summarize(paths,cost_paths,weights,e)
        result.update(status='priced',policy=POLICY,cutoff=cutoff,training_signature=self.data['signature'],
            nba_weight=weight,completed_minutes=minutes,current_observed_minutes=observed,
            learning_scale=fitted['scale'],learning_training_n=fitted['n'],
            latest_learning_label=fitted['latest_label'],latest_residual_label=residual_meta['latest_label'],
            latest_prior_label=max(r['cohort']+stage+h for r in pool),prior_scale=prior_scale)
        result['annual_values']=[dict(season=int(row['season']),exposure=float(row['exposure']),
            production=p,asset=1.8*p-.8*c)for row,p,c in zip(annual,result['annual_mean_production'],result['annual_mean_cost'])]
        self.events['priced']+=1
        return result
