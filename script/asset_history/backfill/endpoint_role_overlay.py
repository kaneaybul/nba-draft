"""Endpoint-only, same-origin future role innovations.

Normal role posterior/current minutes, impact covariates and service pricing are
immutable inputs. State belongs to the player, not their owner. A new observed
completed-season/preseason phase resets the endpoint anchor with the same model
used after the next season's first evidence; it never carries the old recursive
rookie tail as a permanent prior.
"""
from __future__ import annotations
from copy import deepcopy
import math

POLICY='endpoint-only-same-origin-role-innovation-v1'


def normalized(state):
    out=deepcopy(state)
    for k in ('base','posterior','path'):
        if k in out:out[k]={int(y):v for y,v in out[k].items()}
    return out


def advance(model,pid,key,phase_year,provider,cutoff,role_state,prior,
            canonical_path,direct_table,team_games,allow_update,*,owner=None,role_evidence=None):
    """Pure batch/live interface; role_state and prior are never mutated.

    phase_year is canonical role_state.anchor_year, already advanced only after
    completed-season evidence. canonical_path contains required endpoint years.
    team_games is verified phase team opportunities, never player appearances.
    """
    role=normalized(role_state);canonical={int(y):v for y,v in canonical_path.items()}
    if not math.isfinite(team_games)or team_games<0:raise ValueError('Invalid team-game evidence')
    previous=normalized(prior)if prior else None
    if previous and previous['season']>phase_year:raise ValueError('Endpoint phase cannot run backward')
    seeded=previous is None or previous['season']!=phase_year
    if seeded:
        current=deepcopy(role['base'][phase_year])
        path=model.refresh_future(pid,key,phase_year,current['games'],current['mpg'],provider,cutoff,role['posterior'])
        previous={'policy':POLICY,'identity':key,'nba_id':pid,'season':phase_year,
                  'anchor_asof':cutoff,'current':current,'path':path,'innovations':{}}
    if previous.get('policy')!=POLICY:raise ValueError('Endpoint state policy mismatch')
    if previous['identity']!=key:raise ValueError('Endpoint state identity mismatch')
    now=role_evidence if role_evidence is not None else role['posterior'][phase_year]
    if not all(math.isfinite(float(now[k])) and float(now[k])>=0 for k in ('games','mpg')):raise ValueError('Invalid endpoint role evidence')
    zero=previous['current']
    neutral=model.refresh_future(pid,key,phase_year,zero['games'],zero['mpg'],provider,cutoff,role['posterior'])
    fresh=model.refresh_future(pid,key,phase_year,now['games'],now['mpg'],provider,cutoff,role['posterior'])
    # Direct fixed-horizon forecasts remain authoritative where available.
    direct=direct_table.get(str(phase_year-1),{}).get(str(pid),{})
    innovations={int(y):v for y,v in previous.get('innovations',{}).items()}
    if allow_update and team_games>0:
        innovations={y:{'games':fresh[y]['games']-neutral[y]['games'],'mpg':fresh[y]['mpg']-neutral[y]['mpg']}for y in fresh if y in neutral}
    result={};sources={}
    for year,value in canonical.items():
        if year<=phase_year or str(year)in direct:
            result[year]=float(value['games'])*float(value['mpg']);sources[year]='canonical_direct_or_current'
            continue
        if year not in previous['path']or year not in neutral or year not in fresh:
            raise ValueError(f'Missing endpoint-only horizon {key} {cutoff} {year}')
        anchor=previous['path'][year];n=neutral[year];f=fresh[year]
        # Existing injury/new-evidence gate controls innovation, not market age.
        innovation=innovations.get(year,{'games':0.,'mpg':0.})
        games=max(0.,min(82.,anchor['games']+innovation['games']))
        mpg=max(0.,min(38.,anchor['mpg']+innovation['mpg']))
        result[year]=games*mpg;sources[year]='same_model_preseason_anchor_plus_role_innovation'
    new=deepcopy(previous);new.update(last_asof=cutoff,last_owner=owner,last_team_games=team_games,innovations=innovations)
    audit={'policy':POLICY,'anchor_reset':seeded,'anchor_asof':new['anchor_asof'],
           'phase_year':phase_year,'team_games':team_games,'allow_role_innovation':bool(allow_update),
           'normal_role_state_changed':False,'sources':sources}
    return new,result,audit


def install(role_module):
    original=role_module.RoleSmoother.prepare
    def prepare(self,snapshot,current_year,key_function):
        row_start=len(self.rows);annual_start=len(self.annual_rows)
        result=original(self,snapshot,current_year,key_function)
        endpoint_state=getattr(self,'endpoint_role_state',None)or{}
        cutoff=snapshot['asof_date'];pair=self.src.pairs[cutoff];direct=getattr(self,'direct_future_minutes',{})
        diagnostics={key_function(r['player_name']):r for r in self.rows[row_start:]}
        minutes={};audits=[]
        for key,path in result.items():
            draft=self.src.draft.get(key)
            if not draft or current_year>draft[0]+4:continue
            row=diagnostics[key];pid=row.get('nba_id');provider=pair[pair.nba_id==pid]if pid is not None else pair.iloc[:0]
            if len(provider)!=1 or provider.iloc[0]['key']!=key:provider=pair[pair['key']==key]
            p=provider.iloc[0]if len(provider)==1 else None
            if p is not None:pid=int(p.nba_id)
            state=self.states[key];phase=int(state['anchor_year'])
            prior=endpoint_state.get(key)
            lookup=getattr(self.src,'owner_endpoint_lookup',None)
            if lookup:prior=lookup(pid,key,cutoff,prior)
            endpoint={int(y):v for y,v in path.items()if draft[0]+5<=int(y)<=draft[0]+8}
            if len(endpoint)!=4:raise ValueError(f'Incomplete endpoint horizon {key} {cutoff}')
            evidence=None
            if row.get('pre_roster_posterior_annual_games') is not None:
                evidence={'games':float(row['pre_roster_posterior_annual_games']),'mpg':float(row['pre_roster_posterior_conditional_MPG'])}
            new,values,audit=advance(self,pid,key,phase,p,cutoff,state,prior,endpoint,direct,
                float(row.get('team_game_opportunities_since_anchor',state.get('last_team_opportunities',0))),
                bool(row.get('future_role_LM_refreshed_from_new_NBA_evidence',False)),owner=getattr(self.src,'owner_team',None),role_evidence=evidence)
            endpoint_state[key]=new;minutes.update({(key,y):v for y,v in values.items()})
            audits.append({'identity':key,'nba_id':pid,'date':cutoff,**audit})
        self.endpoint_role_state=endpoint_state
        for r in self.annual_rows[annual_start:]:
            k=(key_function(r['player_name']),int(r['season']))
            if k in minutes:r['endpoint_forecast_annual_minutes']=minutes[k]
        self.endpoint_role_audits=getattr(self,'endpoint_role_audits',[])+audits
        return result
    role_module.RoleSmoother.prepare=prepare
    return lambda:setattr(role_module.RoleSmoother,'prepare',original)
