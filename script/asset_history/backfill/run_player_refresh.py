"""Produce all-team canonical player quotes from a verified portable runtime.

The outer publisher joins legal pick claims and performs the portfolio gates.
This command never publishes a player subtotal as total team asset value.
"""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,subprocess,sys,zipfile,shutil,math
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model_version import METHOD

TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()

def stage_state(previous,state,asof,reseed=False):
    """Keep a prior-day checkpoint so intraday retries replace one update."""
    if state.exists():shutil.rmtree(state)
    state.mkdir(parents=True)
    dates={json.loads((previous/f'{t}.json').read_text())['as_of']for t in TEAMS if(previous/f'{t}.json').exists()}
    if len(dates)>1:raise ValueError('Player states do not share a common observation date')
    latest=next(iter(dates),None)
    if latest and latest>asof:raise ValueError('Cannot replay an earlier day over a newer saved player state')
    source=previous
    if not reseed and latest==asof:
        prior=previous/'prior_day'
        prior_dates={json.loads((prior/f'{t}.json').read_text())['as_of']for t in TEAMS if(prior/f'{t}.json').exists()}
        if len(prior_dates)==1 and next(iter(prior_dates))<asof:source=prior
        else:reseed=True
    if not reseed:
        for file in source.iterdir():
            if file.is_file():shutil.copyfile(file,state/file.name)
    else:
        # A quote-method rebuild resets model states, while retaining the
        # actual dated panels and transaction/injury evidence collected since
        # the portable seed. They are source evidence, not old model state.
        for name in ('latest_inputs.json.gz','ownership_events.json','injury_episodes.json','path_calibration.json.gz'):
            file=previous/name
            if file.exists():shutil.copyfile(file,state/name)
        # Keep the earlier captured panel for deterministic same-day reseeds.
        earlier=previous/'prior_day/latest_inputs.json.gz'
        if earlier.exists():
            (state/'prior_day').mkdir(exist_ok=True)
            shutil.copyfile(earlier,state/'prior_day/latest_inputs.json.gz')
    archived=previous/'archived_inputs'
    if archived.exists():shutil.copytree(archived,state/'archived_inputs',dirs_exist_ok=True)
    # Retry keeps the same before-update checkpoint; a new day stores current
    # persistent inputs as the next before-update checkpoint.
    if latest and not reseed:
        prior=state/'prior_day';prior.mkdir()
        for file in source.iterdir():
            if file.is_file():shutil.copyfile(file,prior/file.name)
    return reseed

def unpack(seed,runtime):
    runtime.mkdir(parents=True,exist_ok=True)
    from runtime_archive import resolved_archive
    with resolved_archive(seed)as archive:
        with zipfile.ZipFile(archive)as z:
            for name in z.namelist():
                if not (runtime/name).resolve().is_relative_to(runtime.resolve()):raise ValueError('Unsafe runtime archive path')
            z.extractall(runtime)
    manifest=json.loads((runtime/'runtime_input_manifest.json').read_text())
    for name,expected in manifest.items():
        if hashlib.sha256((runtime/name).read_bytes()).hexdigest()!=expected:raise ValueError('Runtime seed digest mismatch: '+name)

def latest_inputs(runtime,state,save=False,asof=None,results_path=None):
    """Persist one previous panel, not an unbounded daily raw-data archive."""
    path=state/'latest_inputs.json.gz';monthly=runtime/'monthly_reconstruction'
    tables={'epm':(monthly/'epm/epm_monthly.csv','cutoff_date'),
      'darko':(monthly/'darko/end_of_month/darko_monthly.csv','cutoff'),
      'standings':(monthly/'pick_forecasts/standings_monthly.csv','cutoff')}
    lists={'skill':(monthly/'skill/monthly_skill_observations.json','date'),
      'roster':(monthly/'league_ownership/monthly_league_rosters.json','cutoff_date')}
    if save:
        payload={'date':asof}
        for name,(p,field)in tables.items():
            with p.open()as f:payload[name]=[r for r in csv.DictReader(f)if r[field]==asof]
        for name,(p,field)in lists.items():payload[name]=[r for r in json.loads(p.read_text())if r[field]==asof]
        payload['coverage']=[r for r in json.loads((monthly/'skill/coverage_summary.json').read_text())['rows']if r['date']==asof]
        payload['injury_availability']=json.loads((monthly/'injuries/current_availability.json').read_text())
        payload['daily_input_audit']=json.loads((monthly/'daily_input_audit.json').read_text())
        with gzip.open(path,'wt')as f:json.dump(payload,f,separators=(',',':'),allow_nan=False)
        return
    if not path.exists():return
    with gzip.open(path,'rt')as f:payload=json.load(f)
    from extend_daily_inputs import writecsv
    for name,(p,field)in tables.items():
        if name not in payload:continue
        with p.open()as f:rows=[r for r in csv.DictReader(f)if r[field]!=payload['date']]
        writecsv(p,rows+payload[name])
    for name,(p,field)in lists.items():
        rows=[r for r in json.loads(p.read_text())if r[field]!=payload['date']]+payload[name]
        p.write_text(json.dumps(rows,separators=(',',':')))
    p=monthly/'skill/coverage_summary.json';summary=json.loads(p.read_text());summary['rows']=[r for r in summary['rows']if r['date']!=payload['date']]+payload['coverage'];p.write_text(json.dumps(summary))
    if payload.get('injury_availability'):
        p=monthly/'injuries/daily_availability_history.json';history=json.loads(p.read_text())if p.exists()else[]
        history=[r for r in history if r['date']!=payload['date']]+[payload['injury_availability']];p.write_text(json.dumps(history,separators=(',',':')))
    if results_path is not None:
        from captured_clock import restore_panel_clock
        restore_panel_clock(runtime,payload,results_path)

def injury_history(runtime,state,base_file,output):
    """Keep resolved episodes long enough to prove a later observed return."""
    path=state/'injury_episodes.json';saved=json.loads(path.read_text())if path.exists()else{'records':[],'active':[]}
    current=json.loads((runtime/'monthly_reconstruction/injuries/current_availability.json').read_text())
    active=[]
    for row in current['records']:
        if row['availability']>=1:continue
        pid=row['player_nba_id'];active.append(pid)
        old=next((r for r in reversed(saved['records'])if r['player_nba_id']==pid and r['affected_season']==row['affected_season']),None)
        if old and pid in saved['active']:
            old.update({k:v for k,v in row.items()if k!='known_from'})
        else:saved['records'].append(row)
    saved['active']=active;path.write_text(json.dumps(saved,separators=(',',':')))
    base=json.loads(base_file.read_text())if base_file.exists()else[]
    if isinstance(base,dict):base=base.get('records',[])
    output.write_text(json.dumps(base+saved['records'],separators=(',',':')))

def restore_published_availability(runtime,captured,asof):
    """Restore dated overlays without reading today's raw source feeds."""
    audit=captured.get('daily_input_audit');injury=captured.get('injury_availability')
    if not audit or audit.get('date')!=asof or not injury or injury.get('date')!=asof:
        raise ValueError('Published replay requires exact dated clock and injury captures')
    monthly=runtime/'monthly_reconstruction'
    (monthly/'daily_input_audit.json').write_text(json.dumps(audit))
    (monthly/'injuries/current_availability.json').write_text(json.dumps(injury))

def require_published_observations(runtime,repo,asof):
    from model_version import LEGACY_VERSION,data_root
    manifest=json.loads((data_root(repo,LEGACY_VERSION)/'manifest.json').read_text())
    expected={r['date']for team in manifest['teams']for r in team['points']if r['date']<=asof}
    rows=json.loads((runtime/'monthly_reconstruction/league_ownership/monthly_league_rosters.json').read_text())
    missing=expected-{r['cutoff_date']for r in rows}
    if missing:raise ValueError('Missing saved published observations before reconstruction: '+', '.join(sorted(missing)))

def export(output,asof=None,calibrator=None):
    snapshots=[]
    for team in TEAMS:
        folder=output/team
        if not(folder/'league_player_coverage.json').exists():continue
        coverage=json.loads((folder/'league_player_coverage.json').read_text())
        with (folder/'monthly_player_values.csv').open() as player_file:
            rows=list(csv.DictReader(player_file))
        annual_by_player={};raw_annual_by_player={}
        with (folder/'monthly_annual_values.csv').open() as annual_file:
            for annual in csv.DictReader(annual_file):
                dt=annual['cutoff_date']
                if asof and dt!=asof:continue
                pid=annual.get('source_nba_id')or annual.get('ledger_nba_id')
                identity=str(int(float(pid)))if pid else annual['player_name']
                production=annual.get('app_annual_quote_production_reporting_rate')
                asset=annual.get('app_annual_stock_reporting_rate')
                if production in(None,'')or asset in(None,''):continue
                raw_annual_by_player.setdefault((dt,identity),[]).append(annual)
                annual_by_player.setdefault((dt,identity),[]).append({
                    'season':int(annual['season']),'production':float(production),
                    'asset':float(asset),'exposure':float(annual['exposure'])})
        for c in coverage['coverage']:
            dt=c['date']
            if asof and dt!=asof:continue
            assets=[];unpriced=[]
            for row in rows:
                if row['cutoff_date']!=dt or row['active_asset']!='True':continue
                if row['all_four_year_app_quote_priced']!='True':unpriced.append(row['player_name']);continue
                raw_id=row.get('source_nba_id')or row.get('ledger_nba_id')
                pid=int(float(raw_id))if raw_id else None
                ident='player:nba:'+str(pid)if pid is not None else'player:name:'+''.join(x for x in row['player_name'].lower()if x.isalpha())
                details={k:row.get(k)for k in ['asset_type','profile_method','skill_method','role_method','role_MPG_sample_weight','role_games_sample_weight','draft_year','draft_slot','draft_maturity_weight','app_style_four_year_peak_production_quote','app_style_four_year_contract_adjustment_sum','healthy_current_total','healthy_forecast_annual_games','healthy_forecast_conditional_MPG','injury_availability_factor','injury_model_method','flags']}
                from asset_minutes import POLICY
                details['role_minutes_policy']=POLICY
                details['annual_values']=annual_by_player.get((dt,str(pid)if pid is not None else row['player_name']),[])
                raw_path=raw_annual_by_player.get((dt,str(pid)if pid is not None else row['player_name']),[])
                details['raw_annual_production']=[dict(season=int(r['season']),
                    production=float(r['annual_production'])*164961000./float(r['salary_cap_scenario']))for r in raw_path
                    if r.get('annual_production')not in(None,'')and r.get('salary_cap_scenario')not in(None,'')]
                value=float(row['app_style_four_year_asset_quote_with_draft_prior'])
                if calibrator is not None:
                    if hasattr(calibrator,'legacy'):
                        before=calibrator.legacy.quote(row,raw_path)
                        details['v4_same_source_quote']=before['mean']if before and before.get('status')=='priced'else value
                    path=calibrator.quote(row,raw_annual_by_player.get((dt,str(pid)if pid is not None else row['player_name']),[]))
                    if path:
                        details['path_calibration']={k:v for k,v in path.items()if k!='annual_values'}
                        if path['status']=='unsigned_draft_right_existing_policy':
                            value=path['value'];details['annual_values']=[]
                            details['app_style_four_year_peak_production_quote']=str(path['production_quote'])
                            details['app_style_four_year_contract_adjustment_sum']=str(path['contract_adjustment_sum'])
                            details['draft_right_policy']='Year-four production expectation; unsigned right has no NBA evidence'
                            if path.get('draft_development'):details['draft_development']=path['draft_development']
                            if path.get('endpoint_stock_policy'):details['endpoint_stock_policy']=path['endpoint_stock_policy']
                        if path['status']=='priced':
                            for key in ('rolling_production_quote','endpoint_stock_policy','development_window_basis'):
                                if key in path:details[key]=path[key]
                            details['baseline_quote']=value
                            details['baseline_draft_maturity_weight']=details['draft_maturity_weight']
                            value=path['mean']
                            details['draft_maturity_weight']=str(path['nba_weight'])
                            details['annual_values']=path['annual_values']
                            details['app_style_four_year_peak_production_quote']=str(path['production_quote'])
                            details['app_style_four_year_contract_adjustment_sum']=str(path['contract_adjustment_sum'])
                    if row.get('asset_type')!='unsigned_draft_right' and pid is not None:
                        details['draft_development']=calibrator.draft_evaluation(row,raw_path)
                assets.append({'id':ident,'kind':'player','name':row['player_name'],'value':float(row['app_style_four_year_asset_quote_with_draft_prior']),'exposure':float(row['app_priced_season_equivalents']),
                  'source':'Dated ownership and original contract replay; paired EPM/DARKO, observed-or-prior SKILL and canonical development model',
                  'note':row.get('flags')or None,'details':details})
                assets[-1]['value']=value
                from endpoint_stock import promote_asset
                promote_asset(assets[-1],dt)
            snapshots.append({'team':team,'date':dt,'method':METHOD,'reporting_cap':164961000.,'source_cutoff':dt,
              'assets':assets,'player_subtotal':sum(a['value']for a in assets),'unpriced_players':unpriced,
              'coverage':{'ownership':True,'contracts':c['contracts_complete'],'skill':c['skill_complete'],'injury_review':c['injury_review_complete']},
              'player_coverage':c,'scope':'Player service quotes only. Join separately valued legal draft-pick inventory before publication.'})
    owned={}
    for snapshot in snapshots:
        for asset in snapshot['assets']:
            identity=(snapshot['date'],asset['id'])
            if identity in owned:raise ValueError('Duplicate modeled player identity across inventories: '+str((identity,owned[identity],snapshot['team'])))
            owned[identity]=snapshot['team']
            if not math.isfinite(asset['value'])or abs(asset['exposure']-4)>1e-8:raise ValueError('Incomplete or nonfinite four-year player quote: '+asset['name'])
    result={'schema_version':1,'method':METHOD,'snapshots':snapshots}
    (output/'player_candidates.json').write_text(json.dumps(result,separators=(',',':'),allow_nan=False))
    return result

def run(args):
    repo=args.repo.resolve();runtime=args.runtime_dir.resolve();output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    previous_state=args.state_dir.resolve();previous_state.mkdir(parents=True,exist_ok=True)
    state=output/'player_state_staged'
    from asset_minutes import POLICY
    policy_changed=any(json.loads(p.read_text()).get('role_minutes_policy')!=POLICY
        for p in previous_state.glob('*.json')if p.stem in TEAMS)
    reseed=stage_state(previous_state,state,args.as_of,args.reseed or policy_changed)
    seed=repo/'processed/asset_history/canonical_runtime_seed.zip'
    if not args.prepared_runtime:unpack(seed,runtime)
    results_path=repo/'raw/live/results.json'
    from archived_inputs import restore_archived_inputs
    restored=restore_archived_inputs(runtime,repo,args.as_of,latest_inputs)
    if restored:print('Restored exact archived panels: '+', '.join(restored),flush=True)
    if reseed:latest_inputs(runtime,previous_state/'prior_day',results_path=results_path)
    latest_inputs(runtime,state,results_path=results_path)
    if reseed:
        for team in TEAMS:(state/f'{team}.json').unlink(missing_ok=True)
    from ownership_runtime import refresh_events,replay,restore_events,save_events
    ownership_seed_ids=restore_events(runtime,state)
    if getattr(args,'use_published_inputs',False):
        capture=state/'latest_inputs.json.gz'
        if not capture.exists():raise ValueError('Method-only replay needs preserved published inputs')
        with gzip.open(capture,'rt')as f:captured=json.load(f)
        if captured.get('date')!=args.as_of or not captured.get('roster'):
            raise ValueError('Published input capture does not match the requested observation')
        if not args.skip_contract_refresh:raise ValueError('Method-only replay cannot refresh historical contract sources')
        ownership_source={'mode':'published_observation_replay','date':args.as_of,'knowledge_date':args.as_of,
                          'source':'Preserved inputs and dated facts from the last validated all-team publication'}
        # Extend revalidates the original raw exports without any network call.
        # Record the provenance of the restored ledger, not a fresh scrape.
        (runtime/'monthly_reconstruction/league_ownership/roster_refresh_source.json').write_text(json.dumps(ownership_source))
    else:
        ownership_source=refresh_events(runtime,args.as_of,args.roster_html,repo=repo)
    rosterfile=runtime/'monthly_reconstruction/league_ownership/monthly_league_rosters.json'
    dates={s['cutoff_date']for s in json.loads(rosterfile.read_text())}|{args.as_of}
    _,ownership_audit=replay(runtime,dates)
    if ownership_source.get('mode')=='espn_dated_fallback':
        from espn_ownership import capture_additions
        additions=capture_additions(runtime,json.loads((repo/'raw/live/player_pool.json').read_text()),args.as_of)
        if additions:_,ownership_audit=replay(runtime,dates)
        ownership_source['current_roster_signing_captures']=len(additions)
        (runtime/'monthly_reconstruction/league_ownership/roster_refresh_source.json').write_text(json.dumps(ownership_source,indent=2))
    if ownership_audit.get('unresolved_events'):
        raise ValueError('Unresolved dated player destinations; retain the last validated team inventories')
    contracts=repo/'processed/asset_history/contracts'
    if not args.skip_contract_refresh:
        from refresh_contracts import refresh
        prior_dates=[json.loads(p.read_text())['as_of']for p in previous_state.glob('*.json')if p.stem in TEAMS]
        report=refresh(contracts,repo/'raw/live/player_pool.json',runtime/'monthly_reconstruction/league_ownership/league_events.json',args.as_of,roster_path=rosterfile,since=min(prior_dates,default=args.as_of))
        ignored=[]
        if ownership_source.get('mode')=='espn_dated_fallback':
            from espn_ownership import validate_captures
            ignored=validate_captures(runtime,contracts,args.as_of)
            if ignored:
                _,ownership_audit=replay(runtime,dates)
                ownership_source['ignored_stale_roster_captures']=ignored
                (runtime/'monthly_reconstruction/league_ownership/roster_refresh_source.json').write_text(json.dumps(ownership_source,indent=2))
        failed=set(report['failed_mandatory_player_ids'])-{r['nba_id']for r in ignored}
        if failed or report.get('discovery',{}).get('unidentified_owned_players'):raise ValueError('Unverified new/changed contracts or unresolved owned identities; retaining last good asset observations')
    if getattr(args,'use_published_inputs',False):
        restore_published_availability(runtime,captured,args.as_of)
        require_published_observations(runtime,repo,args.as_of)
        # Recompute SKILL from the restored observations; a later live feed is
        # neither needed nor permitted during a source-identical replay.
        sys.path.insert(0,str(runtime/'monthly_reconstruction/skill'))
        import blend_monthly_skill
        blend_monthly_skill.main()
    else:
        from extend_daily_inputs import extend
        extend(runtime,repo,args.as_of)
    injuries=output/'combined_injury_episodes.json'
    injury_history(runtime,state,repo/'processed/asset_history/injuries/major_injury_additions.json',injuries)
    calibration=output/f'calibration_{args.as_of}.json'
    script=Path(__file__).with_name('league_player_values.py')
    def compute(team):
        command=[sys.executable,str(script),'--canonical',str(runtime),'--skill-dir',str(runtime/'monthly_reconstruction/skill'),
          '--agreements',str(contracts/'contract_agreements.json'),'--contract-adjustments',str(contracts/'contract_adjustments.json'),
          '--team',team,'--output',str(output),'--state-dir',str(state),'--calibration-cache',str(calibration),'--uniform-contracts']
        command+=['--injuries',str(injuries)]
        review=repo/'processed/asset_history/injuries/targeted_review.json'
        if review.exists():command+=['--injury-review',str(review)]
        with(output/f'{team}.log').open('w')as log:subprocess.run(command,check=True,stdout=log,stderr=subprocess.STDOUT)
        print('Completed player quotes: '+team,flush=True)
    # Checkpoint the expensive mean projections separately from the path target.
    # Reuse is restricted to source-identical method-only reseeds.
    from projection_checkpoint import signature,reuse,save
    checkpoint=output.parent/'annual_projection_checkpoint'
    checkpoint_signature=signature(repo,runtime,injuries,args.as_of)if args.reseed and getattr(args,'use_published_inputs',False)else None
    reused=bool(checkpoint_signature and reuse(checkpoint,output,state,TEAMS,checkpoint_signature))
    if reused:print('Reused verified source-identical annual projections',flush=True)
    else:
        if checkpoint_signature:(checkpoint/'manifest.json').unlink(missing_ok=True)
        # First team establishes one shared source-hashed league calibration.
        compute(TEAMS[0])
        with ThreadPoolExecutor(max_workers=args.workers)as pool:list(pool.map(compute,TEAMS[1:]))
        if checkpoint_signature:save(checkpoint,output,state,TEAMS,checkpoint_signature)
    from calibration.production import prepare
    calibrator=prepare(runtime,repo,state,output)
    result=export(output,None if reseed else args.as_of,calibrator)
    (output/'path_pricing_coverage.json').write_text(json.dumps(dict(calibrator.events),indent=2))
    latest_inputs(runtime,state,save=True,asof=args.as_of)
    save_events(runtime,state,ownership_seed_ids)
    return {'date':args.as_of,'teams':len({s['team']for s in result['snapshots']}),'snapshots':len(result['snapshots']),'path':str(output/'player_candidates.json'),
      'staged_state':str(state),'state_commit_policy':'Copy staged_state to the persistent state directory only after portfolio validation and publication succeed.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--runtime-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--state-dir',type=Path,required=True);p.add_argument('--as-of',required=True)
    p.add_argument('--workers',type=int,default=3);p.add_argument('--reseed',action='store_true');p.add_argument('--prepared-runtime',action='store_true');p.add_argument('--roster-html',type=Path);p.add_argument('--skip-contract-refresh',action='store_true');p.add_argument('--use-published-inputs',action='store_true')
    a=p.parse_args();print(json.dumps(run(a)))

