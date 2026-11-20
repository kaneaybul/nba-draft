"""Seal separate private legacy + shared native checkpoints; never publishes."""
import argparse
import json
from pathlib import Path
from assemble import METHOD, VERSION, enc, need, pin, sha

TEAMS=set("ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())

def bind(f):
    p=Path(f).resolve(strict=True)
    return {'path':str(p),'sha256':sha(p.read_bytes())}

def read(r):
    return json.loads(pin(r['path'],r['sha256']))

def inventory(root):
    items={}
    for p in sorted(root.rglob('*')):
        need(not p.is_symlink(),'Symlink is not a checkpoint file: '+p.name)
        if p.is_file():
            items[p.relative_to(root).as_posix()]=bind(p)['sha256']
    return items

def preview(c):
    d=c['asof']
    legacy=c['legacy']
    native=c['shared']
    a=read(legacy['assembly_receipt'])
    b=read(legacy['archive_manifest'])
    n=read(native['native_receipt'])
    p=read(native['native_manifest'])
    e=read(c['overlay_manifest'])
    u=read(legacy['recovery_receipt'])
    need(a['schema']=='nba-e-v2-current-assembly-v1' and a['production'] is False,'Not isolated legacy continuation')
    need(b['schema']=='nba-archive-ready-continuation-v1' and b['production'] is False,'Not authenticated legacy archive')
    need(all(x==d for x in (a['asof'],b['asof'],n['asof'],p['as_of'],e['asof'],u['asof'])),'Continuation observation differs')
    need(a['continuation']['manifest_sha256']==legacy['archive_manifest']['sha256'] and a['continuation']['checkpoint_sha256']==b['checkpoint_sha256']==u['checkpoint_sha256'],'Wrong legacy checkpoint')
    need(u['dependencies_sha256']==a['continuation']['dependencies_sha256']==b['files']['continuation_inputs.json'],'Wrong legacy continuation dependencies')
    need(b['files']=={k:v for k,v in inventory(Path(legacy['archive_manifest']['path']).parent).items() if k!='continuation_manifest.json'},'Incomplete legacy state inventory')
    zipb=pin(legacy['recovery_zip']['path'],legacy['recovery_zip']['sha256'])
    import io,zipfile
    need(sha(zipb)==u['archive_sha256'],'Wrong private recovery archive')
    with zipfile.ZipFile(io.BytesIO(zipb)) as z:
        need(len(z.namelist())==len(set(z.namelist())),'Duplicate recovery archive member')
        need(set(u['files'])<=set(z.namelist()),'Incomplete recovery archive')
        for k,h in u['files'].items():
            need(not Path(k).is_absolute() and '..' not in Path(k).parts and sha(z.read(k))==h,'Invalid legacy recovery evidence: '+k)
    j=read(native['injury_state'])
    need('records' in j and 'active' in j and native['injury_state']['sha256']==u['injuries_state_sha256'],'Original injury state missing; do not use combined list')
    need(n['native_manifest_sha256']==native['native_manifest']['sha256'] and n['ledger_sha256']==e['release']['ledger_sha256'],'Shared state not the one sealed for this overlay')
    shared=Path(native['native_manifest']['path']).parent
    states=inventory(shared/'states')
    need(set(states)=={team+'.json' for team in TEAMS},'Shared states missing or unexpected files')
    need({team+'.json' for team in TEAMS}<=set(Path(k).name for k in b['files'] if k.startswith('states/')),'Private states missing')
    changed_role_states=[]
    for team in sorted(TEAMS):
        st=json.loads((shared/'states'/f'{team}.json').read_bytes())
        need(st['team']==team and st['as_of']==d and st['model_source_hashes']==p['model_source_hashes'],'Shared state identity/fingerprint differs: '+team)
        need('role_state' in st and st['role_state'] is not None,'Missing shared role state: '+team)
        legacy_st=json.loads((Path(legacy['archive_manifest']['path']).parent/'states'/f'{team}.json').read_bytes())
        if st['role_state']!=legacy_st['role_state']: changed_role_states.append(team)
    if 'continuation_receipt' in native:
        sc=read(native['continuation_receipt'])
        need(sc['schema']=='nba-shared-native-continuation-v1' and sc['asof']==d and sc['forecast_version']==VERSION and sc['ledger_sha256']==n['ledger_sha256'] and sc['production'] is False,'Wrong separate shared native continuation')
        need(n['continuation_sha256']==native['continuation_receipt']['sha256'],'Native run did not bind its continuation')
        need(sc['files']=={'manifest.json':native['native_manifest']['sha256'],**{'states/'+k:v for k,v in states.items()}} and sc['model_source_hashes']==p['model_source_hashes'],'Shared continuation file inventory differs')
    else:
        need(n['schema']=='nba-nov20-shared-native-candidate-v1' and d=='2026-11-20','Missing normalized continuation receipt')
    # Keep current state and configure future replay to use it directly. Legacy remains private and separate.
    need(changed_role_states,'Shared role seed is identical to private legacy: '+d)
    return {'schema':'nba-dual-current-continuation-v1','asof':d,'eligible_as_published_predecessor':False,'overlay':c['overlay_manifest']['sha256'],'release':e['release'],'lanes':{'legacy_private_control':{'assembly_receipt_sha256':legacy['assembly_receipt']['sha256'],'archive_manifest_sha256':legacy['archive_manifest']['sha256'],'recovery_zip_sha256':legacy['recovery_zip']['sha256'],'recovery_receipt_sha256':legacy['recovery_receipt']['sha256'],'source_preparation_receipt_sha256':u['source_preparation_receipt_sha256'],'authority_sha256':u['authority_sha256'],'injury_state_sha256':u['injuries_state_sha256']},'shared_native_published_consumer':{'native_receipt_sha256':native['native_receipt']['sha256'],'native_manifest_sha256':native['native_manifest']['sha256'],'shared_native_continuation_sha256':native.get('continuation_receipt',{}).get('sha256'),'states':states,'next_seed':'exact-successful-shared-state'}}}

def confirm(candidate, proof, proof_sha):
    c=read(candidate)
    p=json.loads(pin(proof,proof_sha))
    need(c['schema']=='nba-dual-current-continuation-v1' and c['eligible_as_published_predecessor'] is False,'Wrong prepublication seal')
    m=c['release']
    need(p['asof']==c['asof'] and p['canonical_success_verified'] is True and p['method']==METHOD,'Shared deployment is not canonical and verified')
    need(p['ledger_sha256']==m['ledger_sha256'] and p['asset_index_sha256']==m['asset_index_sha256'] and p['rebase_sha256']==m['rebase_sha256'] and p['overlay_manifest_sha256']==c['overlay'],'Canonical proof differs from sealed overlay')
    need(bool(p['deployment_id']),'Missing verified canonical deployment identifier')
    shared = c['lanes']['shared_native_published_consumer']
    need(shared['shared_native_continuation_sha256'], 'Package the initial shared states as a normalized continuation before confirming')
    return {**c,'eligible_as_published_predecessor':True,'canonical_verified':True,'shared_native_continuation_sha256':shared['shared_native_continuation_sha256'],'candidate_seal_sha256':candidate['sha256'],'verified_publication_proof_sha256':proof_sha,'deployment_id':p['deployment_id']}

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('mode',choices=('prepare','confirm'))
    ap.add_argument('input')
    ap.add_argument('sha256')
    ap.add_argument('out',type=Path)
    ap.add_argument('--public-proof')
    ap.add_argument('--public-proof-sha256')
    a=ap.parse_args()
    r={'path':a.input,'sha256':a.sha256}
    out=preview(read(r)) if a.mode=='prepare' else confirm(r,a.public_proof,a.public_proof_sha256)
    with a.out.open('xb') as f: f.write(enc(out))
