"""Reuse the reviewed Utah engine with dated team-specific inputs.

The canonical package is opened read-only. No NBA-team metadata on a ratings
page establishes ownership. Incomplete contract/SKILL/injury evidence produces
explicit coverage failures, never an automatically publishable league total.
"""
from __future__ import annotations
import argparse, csv, hashlib, importlib, json, sys
from datetime import date,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model_version import METHOD

TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()


def agreements_at(agreements,name,pid,cutoff,key,cap_for_year=None):
    eligible=[a for a in agreements if a['known_from']<=cutoff]
    id_matches=[a for a in eligible if pid is not None and a.get('nba_id')is not None and int(pid)in[int(a['nba_id']),*map(int,a.get('app_id_aliases',[]))]]
    if id_matches:matches=id_matches
    else:
        matches=[a for a in eligible if key(a['player_name'])==key(name)or key(name)in[key(n)for n in a.get('player_name_aliases',[])]]
        if pid is not None:
            if int(pid)<=-9000000000:matches=[]  # A known different source profile is a different person.
            else:matches=[a for a in matches if a.get('nba_id')is None or int(a['nba_id'])<=-9000000000]
        if len({a.get('nba_id')for a in matches})>1:matches=[]
    if not matches:return [],False,None
    import copy
    matches=copy.deepcopy(matches)
    for agreement in matches:
        current_year=int(cutoff[:4])+(int(cutoff[5:7])>=7)
        if agreement.get('table_complete'):
            unresolved=[int(y)for y in agreement.get('annual_rate_unresolved_years',[])if current_year<=int(y)<=current_year+4]
            first_cap=agreement.get('first_cap_known_from')
            future_max=agreement.get('max_salary_asof_review_required',False)and first_cap and cutoff<first_cap
            agreement['schedule_complete']=not unresolved and not future_max
        rule=agreement.get('max_salary_asof_formula')
        if not rule or not agreement.get('max_salary_asof_formula_verified')or rule['rule_known_from']>cutoff or not cap_for_year:continue
        first=int(rule['first_year'])
        if f'{first-1}-07-01'<=cutoff:continue
        floor=float(rule['prior_salary_amount'])*float(rule.get('prior_salary_multiplier',1.05))
        fraction=float(rule['cap_fraction'])
        for event in sorted(rule.get('cap_fraction_events',[]),key=lambda r:r['known_from']):
            if event['known_from']<=cutoff:fraction=float(event['cap_fraction'])
        cap_salary=fraction*cap_for_year(first,cutoff)
        base=floor if rule.get('first_year_rule')=='fixed_prior_salary_multiplier'else max(floor,cap_salary)
        old_first=next((r['amount']for r in agreement['salaries']if int(r['year'])==first),None)
        retain_nominal=floor>=cap_salary and old_first is not None and abs(float(old_first)-round(floor))<=1
        for cell in agreement['salaries']:
            yy=int(cell['year'])
            if first<=yy<=int(rule['last_year']):
                amount=cell['amount']if retain_nominal else round(round(base)*(1+float(rule['annual_raise_fraction_of_first_salary'])*(yy-first)))
                if rule.get('first_year_rule')=='fixed_original_schedule':amount=cell['amount']
                amount=rule.get('annual_salary_overrides',{}).get(str(yy),amount)
                cell['amount']=amount
                if cell.get('guaranteed_amount')is not None:cell['guaranteed_amount']=amount
                cell['quality']='dated_verified_max_formula_asof_cap_projection'
                cell['max_formula_sources']=rule['sources']
                if rule.get('conditional_salary_policy'):
                    cell['conditional_salary_policy']=rule['conditional_salary_policy']
                    upper=max(floor,float(rule['conditional_cap_fraction_upper'])*cap_for_year(first,cutoff))
                    cell['conditional_upper_salary']=round(upper*(1+float(rule['annual_raise_fraction_of_first_salary'])*(yy-first)))
                    cell['cap_fraction_asof']=fraction
        agreement['max_formula_resolved']=True;agreement['schedule_complete']=agreement.get('table_complete',False)
    contracts=[r for r in matches if not r.get('adjustment_only')]
    if not contracts:return [],False,None
    a=max(contracts,key=lambda r:r['known_from'])
    cells={}
    for agreement in sorted(matches,key=lambda r:(r['known_from'],0 if r.get('adjustment_only')else 1)):
        contract_type=str(agreement.get('contract_type','')).lower()
        if contract_type and 'extension'not in contract_type and 'renegotiat'not in contract_type:cells={}
        for yy in agreement.get('remove_years',[]):cells.pop(int(yy),None)
        for yy in agreement.get('exercise_years',[]):
            if int(yy)in cells:cells[int(yy)]['option_exercised_asof']=agreement['known_from']
        for r in agreement['salaries']:
            if r.get('known_from',agreement['known_from'])<=cutoff:
                cells[int(r['year'])]={**r,'known_from':r.get('known_from',agreement['known_from']),'source':r.get('source',agreement.get('source')),'quality':r.get('quality',agreement.get('quality'))}
    # A current history table's future-start max salary can embed a later
    # realized cap or award. Keep it unpriced until dated terms resolve it.
    unannounced_max=[]
    for agreement in matches:
        years=[int(r['year'])for r in agreement['salaries']]
        relevant_years=[yy for yy in years if current_year<=yy<=current_year+4]
        if not agreement.get('max_formula_resolved') and relevant_years and agreement.get('max_salary_years') and f'{min(years)-1}-07-01'>cutoff:
            unannounced_max.append(agreement)
            for r in agreement['salaries']:
                yy=int(r['year'])
                if yy in cells and cells[yy]['known_from']==agreement['known_from']:
                    cells[yy]['amount']=None;cells[yy]['quality']='unpriced_future_max_base_requires_asof_terms'
    for cell in cells.values():
        release=cell.get('waiver_option')
        if not release or release['known_from']>cutoff or cell.get('amount')is None:continue
        vested=cutoff>=release['full_guarantee_from']
        cell['waiver_option_verified']=True
        cell['waiver_guaranteed_amount_asof']=cell['amount']if vested else min(float(cell['amount']),float(release['guaranteed_amount_before_vesting']))
        cell['waiver_option_source']=release['source']
        cell['waiver_vests_on']=release['full_guarantee_from']
    return list(cells.values()),a.get('schedule_complete',False) and not unannounced_max,a


def team_inventory(source,team,agreements,dates,key,cap_for_year=None):
    inventories=[];coverage=[]
    for snap in source:
        cutoff=snap['cutoff_date']
        if cutoff not in dates:continue
        assets=[];missing=[]
        for r in snap['roster']:
            if r['team']!=team:continue
            pid=r.get('nba_id');n=r['player_name']
            contract_pid=pid
            if contract_pid is None and r.get('realgm_profile'):
                try:contract_pid=-9000000000-int(r['realgm_profile'].rstrip('/').split('/')[-1])
                except ValueError:pass
            schedule,complete,agreement=agreements_at(agreements,n,contract_pid,cutoff,key,cap_for_year)
            kind='unsigned_draft_right' if r.get('draft_rights') else 'two_way' if r.get('two_way') else 'roster_contract'
            if kind!='unsigned_draft_right' and not complete:missing.append(n)
            assets.append({'player_name':n,'nba_id':pid,'asset_type':kind,'acquired_date':min(r['known_from'],cutoff),
                           'acquisition_event':'Initial inventory' if cutoff==min(dates) else 'Dated league transaction replay',
                           'contract_schedule':schedule,'source':r.get('source','Dated RealGM league register'),
                           'contract_schedule_complete':complete,'contract_agreement':agreement})
        inventories.append({'asof_date':cutoff,'roster_and_rights':assets})
        coverage.append({'date':cutoff,'team':team,'owned_players':len(assets),'contracts_complete':not missing,'missing_complete_contracts':missing})
    return sorted(inventories,key=lambda r:r['asof_date']),coverage


def make_source(canonical,skill_dir,team,agreements,uniform_contracts=False):
    projections=canonical/'monthly_reconstruction/projections'
    sys.path.insert(0,str(projections))
    import pandas as pd
    import integrate_monthly as model
    src=model.Inputs()
    sparse=[dt for dt,rows in src.pairs.items()if len(rows)<300]
    if sparse:raise ValueError('Incomplete league provider panels: '+', '.join(sparse))
    dates={s['asof_date']for s in src.inventory}|set(src.pairs)
    roster=json.loads((canonical/'monthly_reconstruction/league_ownership/monthly_league_rosters.json').read_text())
    original_inventory=src.inventory
    src.inventory,coverage=team_inventory(roster,team,agreements,dates,model.key,lambda yy,dt:src.cap_scenario(int(dt[:4])+(int(dt[5:7])>=7),yy,date.fromisoformat(dt))[0])
    if team=='UTA' and not uniform_contracts:
        original_dates={s['asof_date']for s in original_inventory}
        src.inventory=original_inventory+[s for s in src.inventory if s['asof_date']not in original_dates]
        for c in coverage:
            if c['date']in original_dates:c['contracts_complete']=True;c['missing_complete_contracts']=[]
    assert len(src.inventory)==len(dates),'Missing dated team inventory'
    src.skill=pd.read_csv(skill_dir/'monthly_blended_skills.csv');src.skill['key']=src.skill['name'].map(model.key)
    if uniform_contracts:
        skill_counts=src.skill.groupby('date').size().to_dict()
        sparse_skill={dt:int(skill_counts.get(dt,0))for dt in dates if skill_counts.get(dt,0)<300}
        if sparse_skill:raise ValueError('League reconstruction requires leaguewide SKILL panels: '+str(sparse_skill))
    src.skill_by={(r.date,int(r.nba_id)):r._asdict()for r in src.skill.itertuples()}
    summary=json.loads((skill_dir/'coverage_summary.json').read_text())
    src.skill_coverage={r['date']:r for r in summary['rows']}
    from profile_draft import apply_profile_drafts
    src.profile_draft_audit=apply_profile_drafts(src,agreements,model.key)
    for snapshot in src.inventory:
        cutoff=snapshot['asof_date'];year=int(cutoff[:4])+(int(cutoff[5:7])>=7)
        paired=src.pairs[cutoff]
        for asset in snapshot['roster_and_rights']:
            pid=asset.get('nba_id')
            if pid is not None:
                match=paired[paired.nba_id==int(pid)]
                if len(match)==1 and model.key(asset['player_name'])!=model.key(match.iloc[0]['name']):
                    asset['source_ledger_name']=asset['player_name'];asset['player_name']=match.iloc[0]['name']
            # Old unsigned foreign draft rights are inventory, but not a
            # four-season forecast of active NBA service.
            if asset['asset_type']=='unsigned_draft_right':
                source_row=next((r for s in roster if s['cutoff_date']==cutoff for r in s['roster']if r['team']==team and r['player_name']==asset.get('source_ledger_name',asset['player_name'])),None)
                draft=src.draft.get(model.key(asset['player_name']))
                actual_year=draft[0]if draft else int((source_row or{}).get('draft_year')or 0)
                if actual_year<year-1:asset['asset_type']='dormant_draft_right'
    for y in range(2022,2028):
        raw=json.loads((canonical/f'app_model/schedule_{y}.json').read_text())
        ds=sorted(date.fromisoformat(r['date'])for r in raw if r.get('date') and r['season_type']=='Regular Season' and team in (r['home_team'],r['away_team']))
        if team!='UTA':
            complete=canonical/f'monthly_reconstruction/pick_forecasts/raw/nba_team_game_logs_{y}.json'
            league_schedule=canonical/f'app_model/league_schedule_{y}.json'
            if not league_schedule.exists():league_schedule=Path(__file__).resolve().parents[3]/f'processed/asset_history/team_schedule_{y}.json'
            if complete.exists():
                log=json.loads(complete.read_text())['resultSets'][0];records=[dict(zip(log['headers'],r))for r in log['rowSet']]
                ds=sorted(date.fromisoformat(r['GAME_DATE'][:10])for r in records if r['TEAM_ABBREVIATION']==team)
            if (not complete.exists()or len(ds)!=82)and league_schedule.exists():
                full=json.loads(league_schedule.read_text())
                ds=sorted(date.fromisoformat(r['date'])for r in full if r.get('date') and r['season_type']=='Regular Season' and (r.get('selected_team')==team if r.get('is_placeholder')else team in (r['home_team'],r['away_team'])))
            if len(ds)!=82:raise ValueError(f'Complete league schedule unavailable for {team} {y}; Utah-opponent subset or partial current game log cannot stand in for a full team schedule')
        assert len(ds)==82,f'Incomplete {team} schedule {y}: {len(ds)} games'
        src.schedule[y]=ds;src.reg_start[y]=min(ds);src.reg_end[y]=max(ds)
    src.ownership_expiry_audit=[]
    if uniform_contracts:
        for snapshot in src.inventory:
            cutoff=snapshot['asof_date'];retained=[]
            for asset in snapshot['roster_and_rights']:
                agreement=asset.get('contract_agreement')or{}
                if '10-DAY'in str(agreement.get('contract_type','')).upper():
                    start=date.fromisoformat(agreement['known_from']);season=start.year+(start.month>=7)
                    opportunities=[d for d in src.schedule.get(season,[])if d>=start]
                    expiry=max(start+timedelta(days=9),opportunities[2]if len(opportunities)>=3 else start+timedelta(days=9))
                    if cutoff>expiry.isoformat():
                        src.ownership_expiry_audit.append({'date':cutoff,'player_name':asset['player_name'],'nba_id':asset.get('nba_id'),'contract_start':start.isoformat(),'expiry':expiry.isoformat(),'source':agreement.get('source'),'reason':'Actual ten-day NBA service agreement expired; no later dated agreement known'})
                        continue
                if asset.get('nba_id')==1642379 and cutoff>='2025-10-10':
                    asset['asset_type']='dormant_retention_right'
                    asset['dormant_source']='https://www.dubaibasketball.com/media-article/dubai-adds-australian-guard-taran-armstrong'
                    asset['dormant_note']='Overseas signing announced October10,2025; NBA restricted free-agent rights retained separately from active NBA service.'
                retained.append(asset)
            snapshot['roster_and_rights']=retained
        bydate={s['asof_date']:s for s in src.inventory}
        for c in coverage:
            assets=bydate[c['date']]['roster_and_rights'];active=[a for a in assets if a['asset_type']in('roster_contract','two_way','unsigned_draft_right')]
            c['owned_players']=len(active);c['dormant_rights']=len(assets)-len(active)
            c['missing_complete_contracts']=[a['player_name']for a in active if a['asset_type']!='unsigned_draft_right'and not a.get('contract_schedule_complete')]
            c['contracts_complete']=not c['missing_complete_contracts']
    first=json.loads((canonical/'monthly_reconstruction/pick_forecasts/raw/dunks_ratings_2022-01-01.json').read_text())
    baseline=next((r for r in first[1]['ratings']if r['team_alias']==team and r.get('players_window')),None)
    src.first_rotation={r['player_id']:r for r in baseline['players_window']}if baseline else {}
    if team!='UTA':
        # All-team dated anchors supply role seeds, while posterior updates
        # remain the same fixed-anchor smoother used for Utah.
        refs=pd.read_csv(canonical/'monthly_reconstruction/league_ownership/monthly_role_anchors.csv')
        refs=refs[(refs.team==team)&~refs.player_departed]
        src.rotations=pd.DataFrame([{'cutoff_date':r.cutoff_date,'nba_id':r.nba_id,
          'projected_minutes_per_team_game':float(r.expected_mpg),'source_day':r.cutoff_date,'is_carried':False}for r in refs.itertuples()if pd.notna(r.nba_id)])
    return model,src,coverage


def run(args):
    import pandas as pd
    canonical=args.canonical.resolve();out=args.output.resolve()/args.team;out.mkdir(parents=True,exist_ok=True)
    agreements=json.loads(args.agreements.read_text())if args.agreements and args.agreements.exists()else []
    if args.contract_adjustments:
        adjustments=json.loads(args.contract_adjustments.read_text())
        agreements += [{**r,'adjustment_only':True,'salaries':[]}for r in adjustments]
    model,src,coverage=make_source(canonical,args.skill_dir,args.team,agreements,getattr(args,'uniform_contracts',False))
    src.use_verified_waiver_options=getattr(args,'uniform_contracts',False)
    if args.through:
        src.inventory=[s for s in src.inventory if s['asof_date']<=args.through]
        coverage=[c for c in coverage if c['date']<=args.through]
        if not src.inventory:raise ValueError('No snapshots at or before requested cutoff')
    major_injury_corpus_review=False
    if args.injuries:
        extra=json.loads(args.injuries.read_text());extra=extra.get('records',[])if isinstance(extra,dict)else extra
        major_injury_corpus_review=bool(extra)and all(r.get('known_from')and r.get('source')and r.get('affected_season')for r in extra)
        old={(r['player_name'],r['known_from'],r['affected_season']):r for r in src.injuries}
        old.update({(r['player_name'],r['known_from'],r['affected_season']):r for r in extra});src.injuries=list(old.values())
    if args.team!='UTA':
        original_injury=src.injury
        def conservative_injury(pid,k,cutoff,season,future_game_dates,current_games):
            records=[r for r in src.injuries if (r.get('player_nba_id')==pid or model.key(r['player_name'])==k)and r['known_from']<=cutoff.isoformat()and int(r['affected_season'])==season]
            if records:
                latest=max(records,key=lambda r:r['known_from'])
                returned=latest.get('observed_return_date')
                if returned and latest['known_from']<returned<=cutoff.isoformat():return 1.,None,False,'dated_observed_return_after_injury'
            # Cumulative season appearances can precede a later injury.
            # Never treat them as proof that an uncertain absence ended.
            return original_injury(pid,k,cutoff,season,future_game_dates,0)
        src.injury=conservative_injury
    current_injury_file=canonical/'monthly_reconstruction/injuries/current_availability.json'
    if current_injury_file.exists():
        current_injuries=json.loads(current_injury_file.read_text());injury_date=current_injuries['date']
        history_file=current_injury_file.with_name('daily_availability_history.json')
        panels=json.loads(history_file.read_text())if history_file.exists()else[]
        panels=[p for p in panels if p['date']!=injury_date]+[current_injuries]
        availability={(p['date'],r['player_nba_id']):r for p in panels for r in p['records']}
        src.injuries += [r for r in availability.values()if r['availability']<1]
        historical_injury=src.injury
        def current_injury(pid,k,cutoff,season,future_game_dates,current_games):
            record=availability.get((cutoff.isoformat(),pid))
            if record and season==record['affected_season']:
                return record['availability'],record,record.get('basis')not in(None,'season_ending'),'current_app_dated_remaining_schedule_availability'
            return historical_injury(pid,k,cutoff,season,future_game_dates,current_games)
        src.injury=current_injury
    import role_smoothing
    from live_runtime import load_state,restore_roles,persistent_calibration,save_state,install_clocks
    state_file=args.state_dir/f'{args.team}.json'if args.state_dir else None
    state=load_state(state_file,canonical)
    if state:
        src.inventory=[s for s in src.inventory if s['asof_date']>state['as_of']]
        coverage=[c for c in coverage if c['date']>state['as_of']]
        if not src.inventory:raise ValueError('No new source observation after saved daily state')
    restore_clock=install_clocks(model,role_smoothing,src,canonical,args.team)
    roles=role_smoothing.RoleSmoother(src)
    observations=json.loads((args.skill_dir/'monthly_skill_observations.json').read_text())
    roles.obs={(r['date'],int(r['nba_id'])):r for r in observations}
    anchors=pd.read_csv(canonical/'monthly_reconstruction/league_ownership/monthly_role_anchors.csv')
    refs=anchors[(anchors.team==args.team)&~anchors.player_departed]
    roles.reference={(r.cutoff_date,int(r.nba_id)):r._asdict()for r in refs.itertuples()if pd.notna(r.nba_id)}
    roles.reference_names={}
    for r in refs.itertuples():roles.reference_names.setdefault(r.cutoff_date,[]).append(r._asdict())
    # The original smoother reads preserved pre-smoothing diagnostics from the
    # canonical package, then all per-team data are replaced here.
    if args.team!='UTA':roles.provider_minutes={}
    if state:restore_roles(roles,state)
    for snapshot in src.inventory:
        dt=snapshot['asof_date'];year=int(dt[:4])+(int(dt[5:7])>=7)
        roles.prepare(snapshot,year,model.key)
    pd.DataFrame(roles.rows).to_csv(out/'monthly_role_posteriors.csv',index=False)
    pd.DataFrame(roles.annual_rows).to_csv(out/'monthly_role_annual_states.csv',index=False)
    (out/'role_allocations.json').write_text(json.dumps(roles.allocations,indent=2))
    original_here=model.HERE;original_inputs=model.Inputs;original_calibration=model.AdaptiveCalibration
    from calibration_cache import source_signature,frozen_class
    signature=source_signature(canonical,args.skill_dir)
    calibration_capture={}
    calibration_base=original_calibration
    if args.calibration_cache and args.calibration_cache.exists():
        calibration_base=frozen_class(original_calibration,args.calibration_cache,signature)
    model.AdaptiveCalibration=persistent_calibration(calibration_base,state,calibration_capture)if args.state_dir else calibration_base
    try:
        model.HERE=out;model.Inputs=lambda:src
        model.run()
    finally:
        model.HERE=original_here;model.Inputs=original_inputs;model.AdaptiveCalibration=original_calibration
        restore_clock()
    if state_file:
        save_state(state_file,canonical,args.team,src.inventory[-1]['asof_date'],roles,calibration_capture['instance'])
    if args.calibration_cache and not args.calibration_cache.exists():
        status=json.loads((out/'monthly_integration_status.json').read_text())
        cached={'input_sha256':signature,'calibration':status['monthly_calibration'],'rows':pd.read_csv(out/'monthly_adaptive_calibration.csv').to_dict('records'),'positions':pd.read_csv(out/'monthly_position_usage.csv').to_dict('records')}
        for r in cached['positions']:
            if pd.isna(r.get('nba_id')):r['nba_id']=None
        args.calibration_cache.parent.mkdir(parents=True,exist_ok=True)
        def clean(x):
            import math
            if isinstance(x,float)and not math.isfinite(x):return None
            if isinstance(x,list):return [clean(v)for v in x]
            if isinstance(x,dict):return {k:clean(v)for k,v in x.items()}
            return x
        args.calibration_cache.write_text(json.dumps(clean(cached),allow_nan=False))
    bydate={s['asof_date']:s for s in src.inventory}
    rows=pd.read_csv(out/'monthly_player_values.csv')
    injury_reviews={}
    if args.injury_review:
        reviews=json.loads(args.injury_review.read_text())
        for r in reviews.get('rows',[]):
            if r.get('reviewed')is True and r.get('sources'):
                injury_reviews[(r['team'],r['date'])]=r
    for c in coverage:
        dt=c['date'];snap=bydate[dt];year=int(dt[:4])+(int(dt[5:7])>=7)
        missing=[]
        for a in snap['roster_and_rights']:
            pid=a.get('nba_id');sk=src.skill_by.get((dt,int(pid)))if pid is not None else None
            observed=roles.actual(dt,pid,year)[0]
            if observed and observed['minutes']>0 and not sk:missing.append(a['player_name'])
        month=rows[(rows.cutoff_date==dt)&rows.active_asset]
        unpriced=month[~month.all_four_year_app_quote_priced].player_name.tolist()
        global_review=getattr(args,'uniform_contracts',False)and major_injury_corpus_review
        c.update(skill_complete=not unpriced if getattr(args,'uniform_contracts',False)else not missing,
                 observed_skill_complete=not missing,missing_current_skill=missing,unpriced_active_players=unpriced,
                 injury_review_complete=global_review or args.team=='UTA' or (args.team,dt)in injury_reviews,
                 injury_review_note='Source-reviewed dated major-absence corpus and current captured app injury overlays; targeted method review, not an exhaustive historical clinical archive.'if global_review else injury_reviews.get((args.team,dt),{}).get('note'),
                 injury_review_known_gaps=injury_reviews.get((args.team,dt),{}).get('known_gaps',[]),
                 priced_players=int(((rows.cutoff_date==dt)&rows.all_four_year_app_quote_priced).sum()))
        c['publishable_player_inventory']=all(c[k]for k in ('contracts_complete','skill_complete','injury_review_complete'))
    status={'team':args.team,'method':METHOD if getattr(args,'uniform_contracts',False)else'peak4-payroll-0.8-v1','canonical_engine_sha256':hashlib.sha256((canonical/'monthly_reconstruction/projections/integrate_monthly.py').read_bytes()).hexdigest(),
            'scope':'Player inventory only; joint pick ownership/EV must be joined separately',
            'coverage':coverage,'canonical_files_modified':False}
    status['ownership_expiry_audit']=src.ownership_expiry_audit
    status['draft_identity_audit']=src.profile_draft_audit
    (out/'league_player_coverage.json').write_text(json.dumps(status,indent=2))
    return status

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--canonical',type=Path,required=True);p.add_argument('--skill-dir',type=Path,required=True);p.add_argument('--team',choices=TEAMS,required=True);p.add_argument('--agreements',type=Path);p.add_argument('--injuries',type=Path);p.add_argument('--contract-adjustments',type=Path);p.add_argument('--injury-review',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--through');p.add_argument('--calibration-cache',type=Path);p.add_argument('--state-dir',type=Path);p.add_argument('--uniform-contracts',action='store_true')
    a=p.parse_args();x=run(a);print(json.dumps({'team':a.team,'snapshots':len(x['coverage']),'publishable':sum(c['publishable_player_inventory']for c in x['coverage'])}))
