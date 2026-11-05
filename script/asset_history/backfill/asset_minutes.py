"""Keep current rotation updates separate from direct future forecasts."""
import inspect,linecache,textwrap,math,json
from pathlib import Path
from future_minutes import apply_forecast
SETTINGS=json.loads((Path(__file__).resolve().parents[2]/'frontend/role_minutes_policy.json').read_text())
POLICY=SETTINGS['policy']+'+direct-future-seasons-v1'
PRIOR_APPEARANCES=float(SETTINGS['prior_appearances'])
MAXIMUM_BASELINE_MPG=float(SETTINGS['maximum_baseline_mpg'])

def blend_mpg(prior,games,minutes):
    if not all(math.isfinite(v)for v in (prior,games,minutes))or min(prior,games,minutes)<0:
        raise ValueError('Invalid role evidence')
    return min(MAXIMUM_BASELINE_MPG,(PRIOR_APPEARANCES*prior+minutes)/(PRIOR_APPEARANCES+games)),games/(PRIOR_APPEARANCES+games)

def rewrite_prepare(source):
    text=textwrap.dedent(source)
    needle="                if provider_target is not None:\n"
    replacement="""                if returning_role:
                    mpg,w_mpg=_blend_role_mpg(anchor['mpg'],observed_g,observed_m)
                    k_mpg=_role_prior_appearances
                    actual_method='actual_conditional_MPG_ten_appearance_model_prior'
                elif provider_target is not None:
"""
    if text.count(needle)!=1:raise ValueError('Canonical MPG update interface changed')
    text=text.replace(needle,replacement)
    marker="        provider_target=self.rotation_minutes.get((cutoff,pid),self.provider_minutes.get((cutoff,asset['player_name'])))"
    if text.count(marker)!=1:raise ValueError('Canonical player identity interface changed')
    text=text.replace(marker,"        returning_role=pid is not None and bool(((self.src.annual.season==evidence_year-1)&(self.src.annual.nba_id==pid)&self.src.annual.games.gt(0)).any())\n"+marker)
    old="'role_evidence_mode':'provider_expected_MIN_gated_by_new_regular_team_opportunities'"
    if text.count(old)!=1:raise ValueError('Canonical role diagnostic interface changed')
    text=text.replace(old,"'role_evidence_mode':_role_minutes_policy if returning_role else 'provider_expected_MIN_gated_by_new_regular_team_opportunities'")
    # Apply team rotation changes only to the season being allocated.
    for expression in (
        "base={yy:{'games':clamp(v['games']+dg,0,82),'mpg':clamp(v['mpg']+dm,0,38)} for yy,v in base.items()}",
        "info['path']={yy:{'games':clamp(v['games']+dg,0,82),'mpg':clamp(v['mpg']+dm,0,38)} for yy,v in info['path'].items()}",
    ):
        if text.count(expression) != 1:
            raise ValueError('Canonical roster role allocation interface changed')
        text = text.replace(expression, expression.replace(" for yy,v", " if yy==target_year else v for yy,v"))
    marker = "        info=pending[ident];st=info['state'];st['posterior']=info['path'];self.states[ident]=st"
    if text.count(marker) != 1:
        raise ValueError('Canonical role persistence interface changed')
    replacement = """        info=pending[ident];st=info['state']
        forecasts=getattr(self,'direct_future_minutes',{})
        if forecasts and not info['unobserved_camp']:
            diagnostic=info['diagnostic']
            evidence=st.get('direct_role_evidence')
            if evidence is None or evidence['season']!=current_year:
                evidence={'season':current_year,'games':0.,'minutes':0.}
            observed=diagnostic['actual_cumulative_games']
            if diagnostic['actual_source_season']==current_year and observed>=evidence['games']:
                evidence={'season':current_year,'games':observed,
                          'minutes':diagnostic['actual_cumulative_minutes']}
            st['direct_role_evidence']=evidence
            info['path']=_apply_direct_forecast(info['path'],forecasts,diagnostic['nba_id'],
                current_year,target_year,dt>self.src.reg_end[current_year],
                evidence['games'],evidence['minutes'])
            for yy,v in info['path'].items():
                if self.signed_two_way(asset,yy,current_year,cutoff):
                    v['games']=min(50,v['games'])
        st['posterior']=info['path'];self.states[ident]=st"""
    return text.replace(marker,replacement)

def install(role_module):
    original=role_module.RoleSmoother.prepare
    text=rewrite_prepare(inspect.getsource(original))
    # The existing daily-clock adapter inspects this function a second time.
    filename='<canonical-asset-minutes-'+POLICY+'>'
    linecache.cache[filename]=(len(text),None,text.splitlines(True),filename)
    helpers={'_blend_role_mpg':blend_mpg,'_role_minutes_policy':POLICY,'_role_prior_appearances':PRIOR_APPEARANCES,
             '_apply_direct_forecast':apply_forecast}
    previous={k:role_module.__dict__.get(k)for k in helpers}
    role_module.__dict__.update(helpers)
    scope=dict(role_module.__dict__)
    exec(compile(text,filename,'exec'),scope)
    role_module.RoleSmoother.prepare=scope['prepare']
    def restore():
        role_module.RoleSmoother.prepare=original
        for key,value in previous.items():
            if value is None:role_module.__dict__.pop(key,None)
            else:role_module.__dict__[key]=value
    return restore

