"""Optional incremental daily state and actual-completion clock hooks.

Canonical source files remain unchanged. Two narrow execution adapters replace
calendar-completed games with observed completed games for published intraday
nowcasts, where tonight's games remain in the forward window.
"""
from __future__ import annotations
import inspect,json,hashlib
from datetime import date
from pathlib import Path
import numpy as np
from draft_prior import nba_forecast_weight,rewrite_rule

def annual_waiver_choice(asset_value,production,cell):
    """Verified release option limits liability to the as-of cash guarantee."""
    if not cell or cell.get('waiver_option_verified')is not True:return asset_value,production,False
    guaranteed=cell.get('waiver_guaranteed_amount_asof')
    if not isinstance(guaranteed,(int,float))or guaranteed<0 or not np.isfinite(guaranteed):raise ValueError('Invalid verified waiver guarantee')
    if asset_value is None:return asset_value,production,False
    floor=-.8*guaranteed
    return (floor,0.,True)if asset_value<floor else(asset_value,production,False)

ROLE_STATE=('states','previous_roster','previous_caps','previous_cutoff','previous_labels')

def encode(x):
    if isinstance(x,(date,)):return x.isoformat()
    if isinstance(x,np.ndarray):return x.tolist()
    if isinstance(x,np.generic):return x.item()
    if isinstance(x,(set,tuple)):return [encode(v)for v in x]
    if isinstance(x,list):return [encode(v)for v in x]
    if isinstance(x,dict):return {str(k):encode(v)for k,v in x.items()}
    return x

def fingerprint(canonical):
    p=canonical/'monthly_reconstruction/projections'
    files=[p/n for n in ('valuation_engine.py','role_smoothing.py','adaptive_calibration.py','integrate_monthly.py','quote_window.py','expected_contracts.py')]
    files += [Path(__file__),Path(__file__).with_name('league_player_values.py'),Path(__file__).with_name('asset_minutes.py'),Path(__file__).with_name('draft_prior.py'),p/'app_sources/career_projection_selected_terms.csv',Path(__file__).resolve().parents[2]/'frontend/role_minutes_policy.json']
    return {f.name:hashlib.sha256(f.read_bytes()).hexdigest()for f in files}

def load_state(path,canonical):
    if not path or not path.exists():return None
    x=json.loads(path.read_text())
    if x['model_source_hashes']!=fingerprint(canonical):raise ValueError('Daily state model source changed; explicit version/reseed required')
    return x

def restore_roles(roles,state):
    for k,v in state['role_state'].items():setattr(roles,k,v)
    if roles.previous_roster is not None:roles.previous_roster={tuple(x)for x in roles.previous_roster}
    for s in roles.states.values():
        for key in ('base','posterior'):
            if key in s:s[key]={int(y):v for y,v in s[key].items()}

def persistent_calibration(original,state,capture):
    class Persistent(original):
        def __init__(self,src):
            super().__init__(src);capture['instance']=self
            if state:
                saved=state['calibration_state'];self.previous=saved['previous']
                if self.previous:self.previous['date']=date.fromisoformat(self.previous['date'])
                self.position_state={}
                for r in saved['positions']:
                    v=r['state'];v={**v,'date':date.fromisoformat(v['date']),'shares':np.array(v['shares'])}
                    self.position_state[r['identity']]=v
    return Persistent

def save_state(path,canonical,team,cutoff,roles,calibration):
    from asset_minutes import POLICY
    x={'schema_version':1,'team':team,'as_of':cutoff,'model_source_hashes':fingerprint(canonical),'role_minutes_policy':POLICY,
       'role_state':{k:getattr(roles,k,None)for k in ROLE_STATE},
       'calibration_state':{'previous':calibration.previous,'positions':[{'identity':k,'state':v}for k,v in calibration.position_state.items()]}}
    path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(encode(x),allow_nan=False));tmp.replace(path)

def install_clocks(model,role_module,src,canonical,team):
    original_run=model.run;original_prepare=role_module.RoleSmoother.prepare
    text=rewrite_rule(inspect.getsource(original_run))
    model.__dict__['_draft_nba_weight']=nba_forecast_weight
    datafile=canonical/'monthly_reconstruction/daily_input_audit.json'
    if not datafile.exists():
        exec(compile(text,'<asset-history-draft-prior>','exec'),model.__dict__)
        def restore_run():model.run=original_run
        return restore_run
    data=json.loads(datafile.read_text());history_path=datafile.with_name('daily_input_history.json')
    panels=json.loads(history_path.read_text())if history_path.exists()else[]
    panels={r['date']:r for r in panels};panels[data['date']]=data
    clocks={day:[date.fromisoformat(x)for x in panel['completed_team_dates'][team]]for day,panel in panels.items()}
    def captured(cutoff,season):return cutoff in clocks and season==int(cutoff[:4])+(int(cutoff[5:7])>=7)
    def completed(cutoff,season):
        if captured(cutoff,season):return len(clocks[cutoff])
        return sum(d<=date.fromisoformat(cutoff)for d in src.schedule[season])
    def future(cutoff,season):
        if captured(cutoff,season):
            used=list(clocks[cutoff]);out=[]
            for d in src.schedule[season]:
                if d in used:used.remove(d)
                else:out.append(d)
            return out
        return [d for d in src.schedule[season]if d>date.fromisoformat(cutoff)]
    def role_schedule(cutoff,season):
        if captured(cutoff,season):
            return clocks[cutoff]+[d for d in src.schedule[season]if d>date.fromisoformat(cutoff)]
        return src.schedule[season]
    src.completed_game_count=completed;src.forward_game_dates=future;src.role_schedule_at=role_schedule
    if getattr(src,'use_verified_waiver_options',False):
        needle='app_quote_adjustment=app_stock-app_quote_production if app_stock is not None and app_quote_production is not None else None'
        if needle not in text:raise ValueError('Canonical waiver-choice hook no longer matches reviewed source')
        model.__dict__['_annual_waiver_choice']=annual_waiver_choice
        replacement="app_stock,app_quote_production,waiver_option_used=_annual_waiver_choice(app_stock,app_quote_production,c)\n                if waiver_option_used:flags.append('source_verified_waiver_option_used_'+str(year))\n                "+needle
        text=text.replace(needle,replacement)
    a="games_future=[d for d in src.schedule[current_year] if d>cutoff]"
    b="games_played=sum(d<=cutoff for d in src.schedule[current_year])"
    if a not in text or b not in text:raise ValueError('Canonical clock hook no longer matches reviewed source')
    text=text.replace(a,"games_future=src.forward_game_dates(cutoff_s,current_year)").replace(b,"games_played=src.completed_game_count(cutoff_s,current_year)")
    exec(compile(text,'<asset-history-daily-clock>','exec'),model.__dict__)
    text=inspect.getsource(original_prepare)
    # Function is indented within a class; execute it at module scope.
    import textwrap
    text=textwrap.dedent(text)
    text=text.replace('self.src.schedule[evidence_year]','self.src.role_schedule_at(cutoff,evidence_year)').replace('self.src.schedule[target_year]','self.src.role_schedule_at(cutoff,target_year)')
    scope=dict(role_module.__dict__);exec(compile(text,'<asset-history-daily-role-clock>','exec'),scope)
    role_module.RoleSmoother.prepare=scope['prepare']
    def restore():model.run=original_run;role_module.RoleSmoother.prepare=original_prepare
    return restore
