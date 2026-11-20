"""One executable, private shared-minutes lane for the existing Work publisher.

After the isolated private native control phase, use this driver in the same
Work run. Never calls Cloudflare, GitHub, collectors, legacy publishing or CI.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
VERSION='shared-minutes-comparables-career-v3-conditional-tail'

def need(ok, why):
    if not ok: raise ValueError(why)

def digest(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def read(p):
    return json.loads(Path(p).read_bytes())

def bound(b):
    p=Path(b['path']).resolve(strict=True)
    need(digest(p)==b['sha256'],'Input bytes differ: '+p.name)
    return p

def bind(p):
    p=Path(p).resolve(strict=True)
    return {'path':str(p),'sha256':digest(p)}

def write(p, x):
    with p.open('x') as f: json.dump(x,f,indent=2,sort_keys=True);f.write('\n')
    return bind(p)

def step(p, cfg, output, log, more=()):
    with log.open('x') as f:
        subprocess.run([sys.executable,str(p),str(bound(cfg)),cfg['sha256'],str(output),*more],check=True,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})

def stage(c,w):
    need(c['schema']=='nba-shared-work-job-v1','Unknown Work job schema')
    d,y=c['asof'],c['season']
    w.mkdir()
    native_cfg=read(bound(c['post_legacy']))
    need(native_cfg['asof']==d and native_cfg['season']==y and native_cfg['mode']!='verify-retained','Wrong requested date or test-only native mode')
    native_dir=w/'native'/d; native_dir.parent.mkdir()
    step(ROOT/'post_legacy/phase.py',c['post_legacy'],native_dir,w/'native.log')
    n=read(native_dir/'receipt.json')
    need(n['asof']==d and n['forecast_version']==VERSION and n['production'] is False,'Native stage does not match this job')
    for k in ('scope','resolved_ledger','service','ledger_receipt','native_receipt','continuation','roster','roster_receipt','legacy_assembly'):
        bound(n[k])
    # Both branches receive only the exact artifacts just produced by native.
    p=read(bound(c['pricing_template']))
    batch=Path(n['native_batch_path'])
    prepared=native_dir/'native_prepared'
    p.update(asof=d,season=y,mode='current',repo=str(prepared/'repo'),runtime=str(prepared/'runtime'),native_output=str(batch/'output'))
    p['inputs'].update(native_receipt=n['native_receipt'],native_manifest=bind(batch/'manifest.json'),native_run_config=bind(native_dir/'native_config.json'),ledger=n['resolved_ledger'],scope=n['scope'],service=n['service'],signed_book=native_cfg['signed_book'],control_packet=native_cfg['players'],control_receipt=native_cfg['player_receipt'],legacy_assembly=n['legacy_assembly'])
    h=read(bound(n['native_receipt']))['output_sha256']
    p['native_output_sha256']={}
    exposed={'league_player_coverage.json','monthly_player_values.csv','monthly_annual_values.csv','monthly_quote_carry_states.csv'}
    for path, sig in h.items():
        root, team, name=Path(path).parts
        if root=='output' and name in exposed:
            p['native_output_sha256'].setdefault(team,{})[name]=sig
    r=read(bound(c['r_template']))
    r.update(asof=d,season=y,ledger_receipt=n['ledger_receipt'],ledger=n['resolved_ledger'],roster=n['roster'])
    pconf=write(w/'pricing.json',p)
    rconf=write(w/'r.json',r)
    steps=[(ROOT/'pricing/run.py',pconf,w/'pricing',w/'pricing.log'),(ROOT/'r_phase/run_next.py',rconf,w/'r',w/'r.log')]
    # Separate output roots; neither phase mutates any exact admitted input.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs=[pool.submit(step,*row) for row in steps]
        for j in jobs: j.result()
    f=read(bound(c['atomic_template']))
    f.update(asof=d,season=y)
    i=f['inputs']
    i.update(scope=n['scope'],resolved_ledger=n['resolved_ledger'],service=n['service'],ledger_receipt=n['ledger_receipt'],native_source=n['native_receipt'],legacy_assembly=n['legacy_assembly'],priced=bind(w/'pricing/candidate_players.json'),r_receipt=bind(w/'r/receipt.json'))
    r_out=w/'r/outputs'
    for key in ('team_projections','team_schedules','team_lineups','picks'):
        i[key]=bind(r_out/(key+'.json'))
    i['impact_players']=bind(r_out/f'impact_players_{y}.json')
    i['pick_proof']=bind(r_out/'picks.proof.json')
    aconf=write(w/'atomic.json',f)
    step(ROOT/'recurring_atomic/finish.py',aconf,w/'atomic',w/'atomic.log')
    x=read(bound(c['continuation_template']))
    x.update(asof=d,overlay_manifest=bind(w/'atomic/manifest.json'))
    x['legacy']['assembly_receipt']=n['legacy_assembly']
    x['shared'].update(native_receipt=n['native_receipt'],native_manifest=bind(Path(n['native_batch_path'])/'manifest.json'),continuation_receipt=n['continuation'])
    sconf=write(w/'continuation.json',x)
    with (w/'continuation.log').open('x') as log:
        subprocess.run([sys.executable,str(ROOT/'recurring_atomic/seal_continuation.py'),'prepare',str(bound(sconf)),sconf['sha256'],str(w/'dual_pending.json')],check=True,stdout=log,stderr=subprocess.STDOUT)
    return write(w/'work_receipt.json',dict(schema='nba-shared-work-candidate-v1',asof=d,ledger_sha256=n['resolved_ledger']['sha256'],atomic_manifest=bind(w/'atomic/manifest.json'),dual_continuation=bind(w/'dual_pending.json'),private_legacy_control=i['same_date_control'],production=False))

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('config',type=Path);ap.add_argument('sha256');ap.add_argument('out',type=Path)
    a=ap.parse_args()
    print(json.dumps(stage(read(bound(dict(path=a.config,sha256=a.sha256))),a.out.resolve())))
