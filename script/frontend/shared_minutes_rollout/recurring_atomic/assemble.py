"""Deterministic verified current-only overlay; never deploys. Baseline from immutable deployment."""
import argparse,hashlib,json,math,re,zipfile
from pathlib import Path
from datetime import datetime,date
VERSION='shared-minutes-comparables-career-v3-conditional-tail'
METHOD='peak4-payroll-0.8-v20-'+VERSION+'-current'
DATASETS=('impact_players','team_projections','team_schedules','team_lineups')

def sha(b):return hashlib.sha256(b).hexdigest()
def rd(p):return json.loads(p.read_bytes())
def need(x,m):
 if not x:raise ValueError(m)
def pin(p,d):
 b=Path(p).read_bytes();need(sha(b)==d,'SHA mismatch '+str(p));return b
def put(p,b):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
def enc(x):return json.dumps(x,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def binding(x):return pin(x['path'],x['sha256'])
def spans(raw):
 s=raw.decode();d=json.JSONDecoder();i=0
 def spaces(i):
  while i<len(s)and s[i].isspace():i+=1
  return i
 i=spaces(i);need(s[i]=='[','Expected JSON array');i=spaces(i+1);r=[]
 while s[i]!=']':
  obj,end=d.raw_decode(s,i);r.append((i,end,obj));i=spaces(end)
  if s[i]==',':i=spaces(i+1)
  else:need(s[i]==']','Invalid array separator')
 need(spaces(i+1)==len(s),'Extra array content');return s,r

def patch_aggregate(old,fresh,year,name):
 s,rs=spans(old);field='season' if name=='team_schedules' else 'year';ids=[i for i,r in enumerate(rs)if r[2][field]==year]
 need(bool(ids) and all(r[field]==year for r in fresh),'Current aggregate slice date differs: '+name)
 if name=='impact_player_history':
  by={int(r['nba_id']):r for r in fresh};need(len(by)==len(fresh),'Duplicate Impact identity')
  oldids={int(rs[i][2]['nba_id'])for i in ids};fields=tuple(rs[ids[0]][2])
  need(all(set(rs[i][2])==set(fields)for i in ids),'Historical mirror shape differs')
  if set(by)==oldids and len(by)==len(ids):
   chunks=[];prev=0
   for i in ids:
    a,b,r=rs[i];nr=by[int(r['nba_id'])];chunks.extend([s[prev:a],enc({k:nr[k] for k in r}).decode()]);prev=b
   chunks.append(s[prev:]);result=''.join(chunks)
  else:
   need(ids==list(range(ids[0],ids[-1]+1)),'Mixed current Impact spans')
   result=s[:rs[ids[0]][0]]+','.join(enc({k:r[k] for k in fields}).decode() for r in fresh)+s[rs[ids[-1]][1]:]
 else:
  need(ids==list(range(ids[0],ids[-1]+1)),'Mixed current season spans')
  result=s[:rs[ids[0]][0]]+','.join(enc(x).decode() for x in fresh)+s[rs[ids[-1]][1]:]
 _,ar=spans(result.encode());need([s[a:b]for a,b,r in rs if r[field]!=year]==[result[a:b]for a,b,r in ar if r[field]!=year],'Historical aggregate row bytes changed')
 return result.encode()

def pick_keys(i):
 keys={(r['team'],r['origin'],r['year'],r['round'])for r in i['picks']};need(len(keys)==len(i['picks']),'Nonunique legal pick keys');return keys

def build(c,out):
 d=c['asof'];date.fromisoformat(d);y=c['season'];stamp=c['generated_at'];datetime.fromisoformat(stamp.replace('Z','+00:00'));need(y==int(d[:4])+(int(d[5:7])>=7),'Season differs')
 proof=json.loads(binding(c['baseline_proof']));need(proof['asof']<=d and proof['deployment_id']==c['baseline_deployment'],'Invalid canonical base date/deployment')
 inventory=json.loads(binding(c['baseline_inventory']));need(inventory['id']==c['baseline_deployment'] and inventory['stage']['status']=='success','Baseline deployment inventory differs')
 base=Path(c['baseline_root']).resolve();baseline_sha=c['baseline_input_sha256'];policy=json.loads(binding(c['policy']));need(c['policy']['sha256']==proof['history_policy_sha256'],'Different active protected policy');protected=policy['protected_files'];need(all('/'+f in inventory['files'] for f in protected if f not in ('_headers','_redirects')),'Protected file absent from exact deployment')
 for f,h in protected.items():
  if f not in ('_headers','_redirects'):need(proof['hashes'].get(f)==h,'Protected proof mismatch '+f)
 def old(f):
  b=pin(base/f,baseline_sha[f]);need(f not in proof['hashes'] or sha(b)==proof['hashes'][f],'Published SHA mismatch '+f);need('/'+f in inventory['files'],'Unlisted baseline '+f);return b
 base_index_raw=old('data/asset_valuation.json');need(sha(base_index_raw)==proof['current_index_sha256'],'Baseline index digest differs');base_index=json.loads(base_index_raw);need(base_index['current_observation_date']==base_index['pick_observation_date']==proof['asof'],'Canonical base date differs')
 control=json.loads(binding(c['same_date_control'])) if 'same_date_control' in c else base_index
 need(control['current_observation_date']==control['pick_observation_date']==d,'Exact same-date private ownership control required')
 need(control['asset_history_version']==base_index['asset_history_version'] and control['seasons']==base_index['seasons'],'Control changed protected history lineage')
 cap=json.loads(binding(c['ledger_receipt']));need(cap['asof']==d and cap['schema']=='nba-shared-daily-resolved-v1','Wrong shared ledger observation');L=c['ledger_sha256'];need(L==cap['outputs']['resolved.csv'],'Ledger receipt mismatch')
 packet=json.loads(binding(c['consumer_receipt']));need(packet['asof']==d and packet['ledger_sha256']==L and packet['forecast_version']==VERSION,'Consumers not bound to same ledger/date/version')
 expected={'asset_index',*DATASETS};need(set(c['inputs'])==expected and set(packet['outputs_sha256'])==expected,'Missing atomic consumer outputs')
 actual={k:binding(x) for k,x in c['inputs'].items()};need(all(sha(b)==packet['outputs_sha256'][k]for k,b in actual.items()),'Companion packet bytes changed')
 idx=json.loads(actual['asset_index']);need(idx['method']==METHOD and idx['current_observation_date']==idx['pick_observation_date']==d,'Index not fresh shared player + legal pick')
 need(idx['asset_history_version']==base_index['asset_history_version'] and idx['seasons']==base_index['seasons'],'Historic valuation lineage diverged');need(set(idx['players'])==set(control['players'])and pick_keys(idx)==pick_keys(control),'Signed ownership or legal pick IDs differ from same-date legacy')
 owners=json.loads(binding(c['scope']));need(owners['asof']==d and {i for i,row in owners['players'].items()if not row['contract_pending']}==set(idx['players']),'Current signed owner scope differs');
 for k,o in idx['players'].items():need(o['date']==d and math.isfinite(o['value']),'Invalid fresh player quote '+k)
 rebase={'schema':'nba-shared-minutes-same-date-rebase-v1','asof':d,'old_method':control['method'],'new_method':METHOD,'forecast_version':VERSION,'ledger_sha256':L,'new_index_sha256':sha(actual['asset_index']),'not_development_or_trade':True,'players':{i:{'team':owners['players'][i]['team'],'name':c.get('names',{}).get(i),'old_value':control['players'][i]['value'],'new_value':p['value'],'same_date_method_change':p['value']-control['players'][i]['value']} for i,p in idx['players'].items()}}
 frozen_keys=('rebase_asof','rebase_ledger_sha256','rebase_asset_index_sha256');m=json.loads(old('data/manifest.json'));current=m.get('shared_minutes_release');
 if base_index['method']==METHOD:
  need(current is not None,'Missing prior cutover manifest');bridge=old('data/shared_minutes_rebase.json');o=json.loads(bridge);F=(current.get(frozen_keys[0],current['asof']),current.get(frozen_keys[1],current['ledger_sha256']),current.get(frozen_keys[2],current['asset_index_sha256']));need((o['asof'],o['ledger_sha256'],o['new_index_sha256'])==F and sha(bridge)==current['rebase_sha256'],'Original frozen rebase differs')
 else:
  need(control['method']!=METHOD,'First rebase must compare the old minutes method');bridge=enc(rebase);F=(d,L,sha(actual['asset_index']))
 data={'data/asset_valuation.json':actual['asset_index'],'data/shared_minutes_rebase.json':bridge};static=m['static_data'];m['generated_at']=static['generated_at']=stamp
 for k in DATASETS:
  rows=json.loads(actual[k]);f=f'data/v2/{k}/{y}.json';data[f]=actual[k];ds=static['datasets'][k];choices=[s for s in ds['shards'] if int(s.get('year',s['key']))==y];need(len(choices)==1 and 'data/'+choices[0]['file']==f,'wrong current shard reference');current=choices[0];delta=len(rows)-current['rows'];current.update(rows=len(rows),bytes=len(actual[k]),sha256=sha(actual[k]),shared_ledger_sha256=L)
  if 'rows'in ds:ds['rows']+=delta
  for entry in m.get('datasets',[]):
   if entry['dataset']==k:entry['rows']+=delta
  if k=='impact_players':
   mirror='data/impact_player_history.json';data[mirror]=patch_aggregate(old(mirror),rows,y,'impact_player_history');item=static['datasets']['impact_player_history'];item.update(rows=len(json.loads(data[mirror])),bytes=len(data[mirror]),sha256=sha(data[mirror]),shared_ledger_sha256=L)
  else:
   mirror=f'data/{k}.json';data[mirror]=patch_aggregate(old(mirror),rows,y,k)
 release={'schema':1,'asof':d,'season':y,'forecast_version':VERSION,'ledger_sha256':L,'asset_index_sha256':sha(actual['asset_index']),'rebase_sha256':sha(bridge),**dict(zip(frozen_keys,F))};m['shared_minutes_release']=release;data['data/manifest.json']=enc(m)
 # Template provides frontend only; no dated Nov19 data bytes may be copied.
 ui={};hosting={}
 if c.get('frontend_template'):
  import io
  z=zipfile.ZipFile(io.BytesIO(binding(c['frontend_template'])));manifest=json.loads(z.read('manifest.json'));files=manifest['paths_sha256'];
  for n,h in files.items():
   if n=='delta/index.html' or n.startswith('delta/assets/') or n.startswith('hosting/'):
    b=z.read(n);need(sha(b)==h,'Template frontend content changed');(hosting if n.startswith('hosting/')else ui)[n.split('/',1)[1]]=b
  need('index.html'in ui and all(b'2026-11-19' not in v for v in ui.values()),'Template frontend appears date-bound');need({k:sha(b)for k,b in hosting.items()}=={k:protected[k]for k in ('_headers','_redirects')},'Hosting config drift');expect=c['reviewed_frontend_sha256'];need({k:sha(b) for k,b in ui.items()}==expect,'Template UI not independently reviewed')
 need(not(set(data)&set(protected)),'Current candidate would touch protected history');need(not(set(ui)&set(protected)-{'index.html'}),'Template UI overwrites protected file');need(not out.exists(),'Fresh output directory required');out.mkdir(parents=True)
 for group,prefix in [(data,'delta'),(ui,'delta'),(hosting,'hosting')]:
  for k,b in sorted(group.items()):put(out/prefix/k,b)
 receipt={'schema':'nba-shared-current-atomic-overlay-v1','asof':d,'stage_only':True,'production_ready':False,'baseline_deployment':c['baseline_deployment'],'baseline_proof_sha256':c['baseline_proof']['sha256'],'baseline_inventory_sha256':c['baseline_inventory']['sha256'],'policy_sha256':c['policy']['sha256'],'baseline_inventory_paths':len(inventory['files']),'baseline_input_sha256':baseline_sha,'release':release,'paths_sha256':{str(p.relative_to(out)):sha(p.read_bytes())for p in sorted(out.rglob('*'))if p.is_file()},'protected_sha256':protected,'consumer_receipt_sha256':c['consumer_receipt']['sha256']};put(out/'manifest.json',enc(receipt));return receipt
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('config',type=Path);ap.add_argument('config_sha');ap.add_argument('out',type=Path);a=ap.parse_args();print(json.dumps(build(json.loads(pin(a.config,a.config_sha)),a.out),indent=2))
