"""Chronological league replay. Atomic checkpoints; no remote/publication writes."""
import argparse,concurrent.futures,csv,json,os,shutil,subprocess,sys,time
from pathlib import Path
from league_player_values import TEAMS

def atomic(path,obj):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(obj,allow_nan=False));tmp.replace(path)

def observation_dates(runtime):
    monthly=runtime/'monthly_reconstruction'
    inventory={r['asof_date']for r in json.loads((monthly/'ledger/monthly_inventory.json').read_text())}
    with(monthly/'epm/epm_monthly.csv').open()as f:provider={r['cutoff_date']for r in csv.DictReader(f)}
    ownership={r['cutoff_date']for r in json.loads((monthly/'league_ownership/monthly_league_rosters.json').read_text())}
    expected=inventory|provider # identical to make_source, not roster-only events
    if expected-ownership:raise ValueError('Missing ownership snapshot for source observation')
    return sorted(expected)

def run(args):
    root=args.output.resolve();root.mkdir(parents=True,exist_ok=True)
    runtime=args.canonical.resolve();repo=args.repo.resolve();script=Path(__file__).with_name('league_player_values.py')
    agreements=repo/'processed/asset_history/contracts/contract_agreements.json'
    if not agreements.exists():
        import gzip
        compressed=agreements.with_suffix('.json.gz')
        if not compressed.exists():raise ValueError('Authoritative contract agreements missing')
        agreements.write_bytes(gzip.decompress(compressed.read_bytes()))
    if not json.loads(agreements.read_text()):raise ValueError('Empty authoritative contract agreements')
    if not args.injuries or not args.injuries.exists():raise ValueError('Explicit authoritative combined injury input required')
    from live_runtime import fingerprint
    hashes=fingerprint(runtime)
    dates=[d for d in observation_dates(runtime)if not args.through or d<=args.through]
    latest=root/'latest.json';prior=None;owners={};initial=getattr(args,'initial_state',None)
    if not latest.exists()and initial and(initial/'ownership_manifest.json').exists():
        seed=json.loads((initial/'ownership_manifest.json').read_text());seedroot=root/'batches'/seed['as_of'];(seedroot/'states').mkdir(parents=True,exist_ok=True)
        for team in TEAMS:shutil.copy2(initial/f'{team}.json',seedroot/'states'/f'{team}.json')
        atomic(seedroot/'manifest.json',seed);atomic(latest,{'batch':str(seedroot.relative_to(root))})
    if latest.exists():
        prior=root/json.loads(latest.read_text())['batch'];manifest=json.loads((prior/'manifest.json').read_text())
        if manifest['model_source_hashes']!=hashes:raise ValueError('Replay model changed; use fresh output')
        owners=manifest['owners'];dates=[d for d in dates if d>manifest['as_of']]
    if args.max_dates:dates=dates[:args.max_dates]
    for day in dates:
        begin=time.monotonic();batch=root/'batches'/day
        if batch.exists():shutil.rmtree(batch) # unpublished staged replay only
        (batch/'states').mkdir(parents=True)
        if prior:
            for p in(prior/'states').glob('*.json'):shutil.copy2(p,batch/'states'/p.name)
        calibration=args.calibration_cache if args.calibration_cache else batch/'calibration.json'
        def team_run(team):
            cmd=[sys.executable,str(script),'--canonical',str(runtime),'--skill-dir',str(runtime/'monthly_reconstruction/skill'),'--team',team,'--output',str(batch/'output'),'--through',day,'--state-dir',str(batch/'states'),'--uniform-contracts','--agreements',str(repo/'processed/asset_history/contracts/contract_agreements.json'),'--contract-adjustments',str(repo/'processed/asset_history/contracts/contract_adjustments.json'),'--injuries',str(args.injuries),'--calibration-cache',str(calibration)]
            env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
            if prior:env['NBA_OWNER_PRIOR_BATCH']=str(prior)
            else:env.pop('NBA_OWNER_PRIOR_BATCH',None)
            with(batch/f'{team}.log').open('w')as log:code=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env=env).returncode
            if code:raise RuntimeError(f'{day} {team} failed; see {batch/team}.log')
            for name in('monthly_position_usage.csv','monthly_adaptive_calibration.csv'):
                path=batch/'output'/team/name
                if not path.exists():continue
                with path.open()as f:
                    reader=csv.DictReader(f);fields=reader.fieldnames;records=[r for r in reader if r.get('cutoff_date',day)==day]
                with path.open('w')as f:
                    writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(records)
        pending=TEAMS
        if not calibration.exists():team_run(TEAMS[0]);pending=TEAMS[1:]
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers)as pool:list(pool.map(team_run,pending))
        current={};transitions=[]
        for team in TEAMS:
            state=json.loads((batch/'states'/f'{team}.json').read_text())
            if state['as_of']!=day or state['model_source_hashes']!=hashes:raise ValueError('Checkpoint date/version mismatch')
            with(batch/'output'/team/'monthly_player_values.csv').open()as f:
                for row in csv.DictReader(f):
                    if row['cutoff_date']!=day or row['active_asset']not in('True','true'):continue
                    identity=str(json.loads(row['impact_identity_json']))
                    if identity in current:raise ValueError(f'Duplicate authoritative owner {identity}')
                    current[identity]={'team':team,'last_owned_day':day,'has_impact':bool(row.get('impact_path_knots_json'))}
                    old=owners.get(identity)
                    if old and old['team']!=team:transitions.append({'identity':identity,'old':old['team'],'new':team,'day':day})
        owners.update(current)
        manifest={'schema_version':1,'as_of':day,'model_source_hashes':hashes,'owners':owners,'transitions':transitions,'seconds':time.monotonic()-begin}
        atomic(batch/'manifest.json',manifest);atomic(latest,{'batch':str(batch.relative_to(root))});prior=batch
        print(json.dumps({'day':day,'seconds':manifest['seconds'],'transitions':len(transitions)}),flush=True)
    return prior

def collect(root,output,state):
    import pandas as pd
    root=Path(root);output=Path(output);state=Path(state);state.mkdir(parents=True,exist_ok=True)
    latest=root/json.loads((root/'latest.json').read_text())['batch']
    batches=[p for p in sorted((root/'batches').iterdir())if(p/'manifest.json').exists()and p<=latest]
    for team in TEAMS:
        folders=[b/'output'/team for b in batches if(b/'output'/team).exists()];dest=output/team;dest.mkdir(parents=True,exist_ok=True)
        names=set(p.name for folder in folders for p in folder.glob('*.csv'))
        for name in names:
            frames=[pd.read_csv(f/name)for f in folders if(f/name).exists()and(f/name).stat().st_size>1]
            if frames:pd.concat(frames,ignore_index=True).drop_duplicates().to_csv(dest/name,index=False)
        covers=[json.loads((f/'league_player_coverage.json').read_text())for f in folders]
        if covers:
            summary=dict(covers[-1]);summary['coverage']=[c for v in covers for c in v['coverage']];atomic(dest/'league_player_coverage.json',summary)
        for name in('monthly_integration_status.json','role_allocations.json'):
            if folders and(folders[-1]/name).exists():shutil.copy2(folders[-1]/name,dest/name)
        shutil.copy2(latest/'states'/f'{team}.json',state/f'{team}.json')
    shutil.copy2(latest/'manifest.json',state/'ownership_manifest.json')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--canonical',type=Path,required=True);p.add_argument('--repo',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--injuries',type=Path,required=True);p.add_argument('--calibration-cache',type=Path);p.add_argument('--initial-state',type=Path);p.add_argument('--through');p.add_argument('--max-dates',type=int);p.add_argument('--workers',type=int,default=6)
    run(p.parse_args())
