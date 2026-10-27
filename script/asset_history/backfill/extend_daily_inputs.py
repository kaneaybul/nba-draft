"""Extend a portable engine fixture from the app's actual live source exports.

This records a published nowcast: prior performance can lag today's observation.
It does not reinterpret current rosters as historical month-end ownership.
"""
import argparse,csv,json,sys
from datetime import date,datetime
from pathlib import Path


def load(path):return json.loads(Path(path).read_text())
def stamp(x):return datetime.fromisoformat(x.replace('Z','+00:00'))
def csvrows(p):
    with p.open()as f:return list(csv.DictReader(f))
def writecsv(p,rows):
    fields=list(dict.fromkeys(k for r in rows for k in r))
    import tempfile,os
    with tempfile.NamedTemporaryFile('w',dir=p.parent,prefix=p.name+'.',suffix='.tmp',delete=False,newline='')as f:
        w=csv.DictWriter(f,fields);w.writeheader();w.writerows(rows);tmp=Path(f.name)
    reread=csvrows(tmp)
    if len(reread)!=len(rows):
        tmp.unlink();raise ValueError(f'CSV row count changed while writing {p}: {len(rows)} to {len(reread)}')
    os.replace(tmp,p)
def appendcsv(p,new,cutoff,field):
    rows=[r for r in csvrows(p)if r[field]!=cutoff]+new;writecsv(p,rows)

def extend(runtime,repo,asof):
    raw=repo/'raw/live';ratings=load(raw/'ratings.json');skills=load(raw/'skill_stats.json');pool=load(raw/'player_pool.json');results=load(raw/'results.json');season=int(ratings['season'])
    cutoff=date.fromisoformat(asof)
    for label,x in [('ratings',ratings),('skill',skills),('rosters',pool),('results',results)]:
        observed=stamp(x['generated_at']).date()
        if observed>cutoff:raise ValueError(f'{label} was observed after requested knowledge date; cannot backfill ownership from current inputs')
        if label=='rosters' and observed!=cutoff:raise ValueError('Current roster capture must be on the published nowcast date')
    epm_day=date.fromisoformat(ratings['epm_as_of']);darko_day=date.fromisoformat(ratings['darko_through'])
    # EPM source is pregame; DARKO export explicitly labels through-date.
    if epm_day.toordinal()-1>cutoff.toordinal()or darko_day>cutoff:raise ValueError('Provider includes future performance')
    if int(skills['season'])!=season or int(pool['season'])!=season:raise ValueError('Live source seasons differ')
    annual=list(csv.DictReader((runtime/'monthly_reconstruction/projections/annual_history.csv').open()))
    completed_max=max(int(r['season'])for r in annual)
    if completed_max<season-1:raise ValueError('Previous completed-season model inputs are stale; refresh annual history, SKILL calibration and positions before publication')
    previous_schedule=runtime/f'app_model/schedule_{season}.json'
    if previous_schedule.exists():
        season_end=max(r['date']for r in load(previous_schedule)if r.get('season_type')=='Regular Season'and r.get('date'))
        if asof>season_end and completed_max<season:raise ValueError('Completed annual model inputs are stale after the season ended; refresh annual history, SKILL calibration and positions before publication')
    current_schedule=repo/f'frontend/public/data/v2/team_schedules/{season}.json'
    if current_schedule.exists():(runtime/f'app_model/league_schedule_{season}.json').write_bytes(current_schedule.read_bytes())
    monthly=runtime/'monthly_reconstruction';epath=monthly/'epm/epm_monthly.csv';dpath=monthly/'darko/end_of_month/darko_monthly.csv'
    oldd=csvrows(dpath);input_provider_counts={'epm':len(csvrows(epath)),'darko':len(oldd)};latest={int(r['nba_id']):r for r in sorted(oldd,key=lambda r:r['cutoff'])}
    playerfile=repo/f'frontend/public/data/v2/impact_players/{season}.json';metadata={}
    for p in load(playerfile):
        for pid in (p.get('nba_id'),p.get('source_nba_id')):
            if pid is not None:metadata[int(pid)]=p
    eout=[];dout=[];missing=[]
    for p in ratings['players']:
        pid=int(p['nba_id']);old=latest.get(pid);meta=metadata.get(pid,{})
        age=meta.get('age');yoe=meta.get('yoe');position=meta.get('Pos1')or meta.get('position')
        if age is None and old:age=float(old['age'])+season-int(old['season'])
        rookie=int(old['rookie_season'])if old else season-int(yoe)+1 if yoe is not None else None
        if not position and old:position=old['position']
        if age is None or rookie is None or not position:missing.append(pid);continue
        required=['o_epm','d_epm','o_dpm','d_dpm','epm_mpg']
        if any(p.get(k)is None for k in required):missing.append(pid);continue
        eout.append({'cutoff_date':asof,'requested_source_day':ratings['epm_as_of'],'actual_source_day':ratings['epm_as_of'],'season':season,'nba_id':pid,'name':p['player_name'],'team':p.get('team'),'p_mpg':p['epm_mpg'],'oepm':p['o_epm'],'depm':p['d_epm']})
        dout.append({'cutoff':asof,'source_date':ratings['darko_through'],'data_date':ratings['darko_through'],'season':season,'nba_id':pid,'player_name':p['player_name'],'position':position,'age':age,'rookie_season':rookie,'o_dpm':p['o_dpm'],'d_dpm':p['d_dpm']})
    existing_league=load(monthly/'league_ownership/monthly_league_rosters.json')
    earlier=[s for s in existing_league if s['cutoff_date']<asof]
    previous=max(earlier,key=lambda s:s['cutoff_date'])if earlier else {'roster':[]}
    previous_members={(r['team'],r.get('nba_id')):r for r in previous['roster']if r.get('nba_id')is not None}
    dated=next((s for s in existing_league if s['cutoff_date']==asof),None)
    source_audit=monthly/'league_ownership/roster_refresh_source.json'
    if not dated or not source_audit.exists()or load(source_audit)['knowledge_date']!=asof:
        raise ValueError('Refresh the dated ownership ledger before current inputs; a current roster feed cannot supersede dated removals')
    roster=dated['roster']
    ledger_ids={r['nba_id']:r for r in roster if r.get('nba_id')is not None and not r.get('draft_rights')}
    feed_ids={p.get('nba_id')or p.get('app_nba_id'):p for p in pool['players']if p.get('pool_status')=='roster'and not p.get('inactive_confirmed')and p.get('team')not in(None,'FA')}
    roster_differences={'dated_only':[{'nba_id':pid,'name':r['player_name'],'team':r['team']}for pid,r in ledger_ids.items()if pid not in feed_ids],
      'feed_only':[{'nba_id':pid,'name':r['player_name'],'team':r['team']}for pid,r in feed_ids.items()if pid not in ledger_ids],
      'different_team':[{'nba_id':pid,'name':r['player_name'],'dated_team':r['team'],'feed_team':feed_ids[pid]['team']}for pid,r in ledger_ids.items()if pid in feed_ids and r['team']!=feed_ids[pid]['team']]}
    injury_rows=[]
    for pid,p in metadata.items():
        observed=p.get('injury_projection_as_of');factor=p.get('injury_availability')
        if not observed or factor is None or pid<=0:continue
        if stamp(observed).date()>cutoff:raise ValueError('Injury outlook captured after knowledge date')
        if not 0<=float(factor)<=1:raise ValueError('Invalid current injury availability')
        injury_rows.append({'player_nba_id':pid,'player_name':p['player_name'],'known_from':asof,'known_through':asof,
         'affected_season':season,'availability':float(factor),'status':'current_app_availability',
         'source':p.get('injury_source_url'),'basis':p.get('injury_projection_basis'),
         'note':p.get('injury_projection_note'),'observed_at':observed})
    observations=load(monthly/'skill/monthly_skill_observations.json')
    newobs=[{'date':asof,'data_cutoff':asof,'nba_id':int(p['nba_id']),'name':p['player_name'],'minutes':p['minutes'],'games':p['games'],'raw_skills':p['raw_skills'],'current_raw_source':'Current Databallr all-team source captured by the app; component publishing lags retain prior'}for p in skills['players']]
    played=[g for g in results['games']if g.get('is_completed') and g['date']<=asof]
    if any(g['date']>asof and g.get('is_completed')for g in results['games']):raise ValueError('Completed result after knowledge date')
    states={t:{'gp':0,'wins':0,'losses':0}for t in {r['team']for r in roster}}
    for g in played:
        for t in (g['home_team'],g['away_team']):
            states[t]['gp']+=1;states[t]['wins']+=g['result']==t;states[t]['losses']+=g['result']!=t
    team_meta={r['team_alias']:r for r in csvrows(monthly/'pick_forecasts/standings_monthly.csv')}
    standings=[]
    for t,r in states.items():
        games=[g for g in played if t in (g['home_team'],g['away_team'])]
        points=sum(g['home_score']if g['home_team']==t else g['away_score']for g in games)
        diff=sum((g['home_score']-g['away_score'])*(1 if g['home_team']==t else -1)for g in games)
        standings.append({'cutoff':asof,'season_ending':season,'team_alias':t,'team_id':team_meta[t]['team_id'],'team_name':team_meta[t]['team_name'],**r,'win_pct':r['wins']/r['gp']if r['gp']else 0,'last_game_date':max((g['date']for g in games),default=None),'point_differential':diff,'points_scored':points})
    # All validation precedes mutations to the extracted runtime fixture.
    if len(eout)<300 or len(roster)<400 or pool.get('teams_checked')!=30:raise ValueError('Incomplete live league source coverage')
    appendcsv(monthly/'pick_forecasts/standings_monthly.csv',standings,asof,'cutoff');appendcsv(epath,eout,asof,'cutoff_date');appendcsv(dpath,dout,asof,'cutoff')
    observations=[r for r in observations if r['date']!=asof]+newobs
    (monthly/'skill/monthly_skill_observations.json').write_text(json.dumps(observations))
    league=load(monthly/'league_ownership/monthly_league_rosters.json');league=[r for r in league if r['cutoff_date']!=asof]+[{'cutoff_date':asof,'roster':roster}]
    (monthly/'league_ownership/monthly_league_rosters.json').write_text(json.dumps(league))
    summary=load(monthly/'skill/coverage_summary.json');summary['rows']=[r for r in summary['rows']if r['date']!=asof]+[{'date':asof,'pbp_scope':'complete_league_current_export','performance_cutoff':max((g['date']for g in played),default=None),'raw_players':len(newobs),'blended_players':None}]
    (monthly/'skill/coverage_summary.json').write_text(json.dumps(summary))
    injury_file=monthly/'injuries/current_availability.json';history_file=monthly/'injuries/daily_availability_history.json'
    history=load(history_file)if history_file.exists()else[]
    if injury_file.exists():
        previous_injury=load(injury_file)
        if previous_injury['date']!=asof:history=[r for r in history if r['date']!=previous_injury['date']]+[previous_injury]
    history_file.write_text(json.dumps(history,separators=(',',':')))
    injury_file.write_text(json.dumps({'date':asof,'records':injury_rows},indent=2))
    # Identical canonical evidence budget and prior/calibration rules. The
    # main app's more recent evidence weighting does not replace this method.
    sys.path.insert(0,str(monthly/'skill'));import blend_monthly_skill;blend_monthly_skill.main()
    audit={'date':asof,'scope':'Current source nowcast; dated roster replay overrides stale current-feed entries','input_provider_rows':input_provider_counts,'output_provider_rows':{'epm':len(csvrows(epath)),'darko':len(csvrows(dpath))},'provider_players':len(eout),'missing_metadata_or_pair_ids':missing,'owned_players':len(roster),'current_skill_observations':len(newobs),'current_injury_rows':len(injury_rows),'roster_feed_differences':roster_differences,'completed_team_dates':{t:[g['date']for g in played if t in (g['home_team'],g['away_team'])]for t in states},'source_dates':{'epm_pregame':ratings['epm_as_of'],'darko_through':ratings['darko_through'],'skill_captured_at':skills['generated_at'],'roster_captured_at':pool['generated_at']},'missing_components':skills.get('held_components',[]),'source_lag_note':'Knowledge date is source observation date; latest performance can lag. No current roster is inserted into an earlier knowledge date.'}
    (monthly/'daily_input_audit.json').write_text(json.dumps(audit,indent=2));return audit

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--runtime',type=Path,required=True);p.add_argument('--repo',type=Path,required=True);p.add_argument('--as-of',required=True);a=p.parse_args();print(json.dumps(extend(a.runtime,a.repo,a.as_of)))
