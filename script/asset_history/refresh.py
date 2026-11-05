"""Daily all-team refresh with staged model state and last-good publication."""
from __future__ import annotations
import argparse,hashlib,json,shutil,subprocess,sys
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from publish import publish,TEAMS,OUT,METHOD,atomic
from assemble import assemble
from materialize import materialize,compact
from model_version import data_root
from versioned_rebuild import legacy_snapshots,reconstruct,reprice_historical_picks
from source_signature import source_signature

def require_uniform_minutes_policy(snapshots):
    from backfill.asset_minutes import POLICY
    for snapshot in snapshots:
        for asset in snapshot['assets']:
            if asset['kind']=='player'and asset.get('details',{}).get('role_minutes_policy')!=POLICY:
                raise ValueError('Mixed minutes policies in the history window; publish a complete new valuation version')

def published_source_dates(prior,asof):
    sources={json.dumps(points[asof]['source_dates'],sort_keys=True)for points in prior.values()}
    if len(sources)!=1:raise ValueError('Published replay requires matching source provenance for all teams')
    result=json.loads(sources.pop())
    if any(date.fromisoformat(value)>date.fromisoformat(asof)for value in result.values()):
        raise ValueError('Published replay contains future source provenance')
    return result

def source_dates(repo,asof):
    ratings=json.loads((repo/'raw/live/ratings.json').read_text());skill=json.loads((repo/'raw/live/skill_stats.json').read_text())
    epm=(date.fromisoformat(ratings['epm_as_of'])-timedelta(days=1)).isoformat()
    return {'ownership':asof,'contracts':asof,'epm':epm,'darko':ratings['darko_through'],'skill':skill['generated_at'][:10]}

def main(args):
    repo=args.repo.resolve();work=args.work_dir.resolve();work.mkdir(parents=True,exist_ok=True)
    materialize(repo)
    out=data_root(repo);new_version=not(out/'manifest.json').exists()
    pool=json.loads((repo/'raw/live/player_pool.json').read_text());asof=pool['generated_at'][:10]
    published_inputs=getattr(args,'use_published_inputs',False)
    if published_inputs:
        if not new_version:raise ValueError('Published-input replay is restricted to a new method version')
        prior=legacy_snapshots(repo)
        dates={max(points)for points in prior.values()}
        if len(dates)!=1:raise ValueError('Method-only replay requires one common published observation')
        # Raw files can be fetched after UTC midnight while describing the
        # prior basketball day. A method rebuild retains that saved date.
        asof=dates.pop()
    status=out/'refresh_status.json'
    if not args.reseed and not new_version and status.exists():
        saved=json.loads(status.read_text())
        if saved.get('status')=='success'and saved.get('method')==METHOD and saved.get('observation_date')==asof and saved.get('source_signature')==source_signature(repo):
            manifest=json.loads((out/'manifest.json').read_text())
            attribution_path=out/'attribution/manifest.json'
            attribution_ok=attribution_path.exists() and json.loads(attribution_path.read_text()).get('latest')==asof and json.loads(attribution_path.read_text()).get('method')=='age-separated-attribution-v5'
            if attribution_ok and len(manifest.get('teams',[]))==30 and all(t.get('latest')==asof for t in manifest['teams']):
                return {**saved,'reused_identical_published_inputs':True}
    if asof!=datetime.now(timezone.utc).date().isoformat() and not args.allow_reconstructed:
        raise ValueError('The source refresh is not from today; retaining the last validated history')
    base=repo/'script/asset_history';state=repo/'processed/asset_history/player_state';runtime=work/'runtime';players=work/'players'
    command=[sys.executable,str(base/'backfill/run_player_refresh.py'),'--repo',str(repo),'--runtime-dir',str(runtime),'--output',str(players),'--state-dir',str(state),'--as-of',asof]
    if published_inputs:
        command+=['--use-published-inputs','--skip-contract-refresh']
    if args.reseed or new_version:command.append('--reseed')
    log_path=work/'player_refresh.log'
    with log_path.open('w')as log:
        process=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
    diagnostics=log_path.read_text();print(diagnostics,flush=True)
    if process.returncode:
        detail=next((line for line in reversed(diagnostics.splitlines())if line.strip()),'Player refresh failed')
        raise ValueError(detail)
    sys.path.insert(0,str(base/'backfill'))
    from run_pick_refresh import run as refresh_picks
    staged_model=players/'player_state_staged/endpoint_pick_model.json'
    if not staged_model.exists():raise ValueError('Missing endpoint-trained shared pick model')
    picks=refresh_picks(repo,runtime,asof,work/'pick_candidates.json',args.draws,staged_model,use_published_inputs=published_inputs)
    legacy_pick_totals=None
    if new_version:
        old_model=json.loads(staged_model.read_text())
        for k in ('production_policy','stock_policy','endpoint_records','endpoint_training_through'):old_model.pop(k,None)
        old_path=work/'legacy_pick_model.json';old_path.write_text(json.dumps(old_model))
        old_picks=refresh_picks(repo,runtime,asof,work/'legacy_pick_candidates.json',args.draws,old_path,use_published_inputs=published_inputs)
        if old_picks['source_fingerprint']!=picks['source_fingerprint']:raise ValueError('Method comparison needs identical pick sources')
        legacy_pick_totals={t:sum(a['value']for a in old_picks['teams'][t])for t in TEAMS}
    player_data=json.loads((players/'player_candidates.json').read_text())['snapshots']
    if published_inputs:
        latest={s['team']:s for s in player_data if s['date']==asof}
        for t in TEAMS:
            before={a['id']for a in prior[t][asof]['assets']if a['kind']=='player'}
            after={a['id']for a in latest[t]['assets']}
            if before!=after:raise ValueError('Method-only replay changed published ownership: '+t)
    # A new method gets a separate reconstructed history. Later daily updates
    # retain that version's preserved monthly observations.
    previous={}
    for team in TEAMS:
        path=out/'teams'/f'{team}.json'
        if path.exists():
            old=[s for s in json.loads(path.read_text())['snapshots']if s['date'][:7]<asof[:7]]
            if old:previous[team]=old[-1]
    events=json.loads((runtime/'monthly_reconstruction/league_ownership/league_events.json').read_text())
    if new_version:
        legacy=legacy_snapshots(repo)
        dates=sorted({d for points in legacy.values()for d in points if d[:7]<asof[:7]})
        repriced=reprice_historical_picks(repo,json.loads(staged_model.read_text()),dates,args.draws)
        sources=published_source_dates(prior,asof)if published_inputs else source_dates(repo,asof)
        candidates=reconstruct(player_data,picks,legacy,events,asof,sources,repriced)

    else:
        player_data=[s for s in player_data if s['date']==asof]
        candidates=assemble(player_data,{asof:picks},events,'reconstructed'if args.allow_reconstructed else'published',source_dates(repo,asof),previous)
    (work/'portfolio_candidates.json').write_text(json.dumps({'snapshots':candidates},separators=(',',':'),allow_nan=False))
    require_uniform_minutes_policy(candidates)
    if not new_version:
        for team in TEAMS:
            require_uniform_minutes_policy(json.loads((out/'teams'/f'{team}.json').read_text())['snapshots'])
    if legacy_pick_totals is not None:
        for s in candidates:
            if s['date']==asof:s['method_comparison']={'v4_same_source_pick_total':legacy_pick_totals[s['team']]}
    # publish validates the entire batch before it touches the public inventory.
    manifest=publish(candidates,out,require_league=not new_version)
    atomic(repo/'processed/asset_history/picks/trained_pick_model.json',json.loads(staged_model.read_text()))
    from attribution import run as publish_attribution
    publish_attribution(repo,runtime)
    compact(repo)
    staged=players/'player_state_staged'
    if not staged.is_dir():raise ValueError('Missing staged model state')
    replacement=state.with_name('player_state_new')
    if replacement.exists():shutil.rmtree(replacement)
    shutil.copytree(staged,replacement)
    if state.exists():shutil.rmtree(state)
    replacement.rename(state)
    audit={'status':'success','method':METHOD,'observation_date':asof,'recorded_at':datetime.now(timezone.utc).isoformat(),'teams':len({s['team']for s in candidates}),'observations':len(candidates),'version_reconstruction':new_version,'source_dates':published_source_dates(prior,asof)if published_inputs else source_dates(repo,asof),'source_signature':source_signature(repo)}
    atomic(out/'refresh_status.json',audit)
    return audit

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--draws',type=int,default=10000);p.add_argument('--reseed',action='store_true');p.add_argument('--allow-reconstructed',action='store_true');p.add_argument('--use-published-inputs',action='store_true');a=p.parse_args()
    try:print(json.dumps(main(a)))
    except Exception as exc:
        out=data_root(a.repo.resolve())
        atomic(out/'refresh_status.json',{'status':'retained_last_good','recorded_at':datetime.now(timezone.utc).isoformat(),'reason':str(exc)[:600]})
        raise




