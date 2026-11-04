"""Conditional-MPG adapter; canonical attendance, injuries and roster rules stay intact."""
import inspect,linecache,textwrap,math
POLICY='veteran-conditional-mpg-ten-appearance-prior-v1'

def blend_mpg(prior,games,minutes):
    if not all(math.isfinite(v)for v in (prior,games,minutes))or min(prior,games,minutes)<0:
        raise ValueError('Invalid role evidence')
    return min(38.,(10*prior+minutes)/(10+games)),games/(10+games)

def rewrite_prepare(source):
    text=textwrap.dedent(source)
    needle="                if provider_target is not None:\n"
    replacement="""                if returning_role:
                    mpg,w_mpg=_blend_role_mpg(anchor['mpg'],observed_g,observed_m)
                    k_mpg=10.
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
    return text

def install(role_module):
    original=role_module.RoleSmoother.prepare
    text=rewrite_prepare(inspect.getsource(original))
    # The existing daily-clock adapter inspects this function a second time.
    filename='<canonical-asset-minutes-'+POLICY+'>'
    linecache.cache[filename]=(len(text),None,text.splitlines(True),filename)
    helpers={'_blend_role_mpg':blend_mpg,'_role_minutes_policy':POLICY}
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
