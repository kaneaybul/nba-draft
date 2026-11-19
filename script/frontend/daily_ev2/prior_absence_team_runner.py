"""Audited Nov19 arrival-query bootstrap; never synthesize a full prior panel.

All native files and their fingerprint bytes remain unchanged. Only the missing
prior query branch is executed through this explicit, separately recorded adapter.
"""
import hashlib,inspect,json,os,runpy,sys,textwrap
from pathlib import Path
RAW='521024e8bda946176b0308c7a103d340afb2b2d8eddd9b265d8fdd822dd95ffe'
PRIOR='19b65f6cae2a3f073fff700a1614b3d96d20a7b66e8f118249f85600b51137e7'
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def evidence(raw_path,initial):
 initial=Path(initial)
 proof_path=Path(__file__).with_name('prior_absence_proof.json')
 if sha(proof_path)!='734bcbe8459740a8b6bcd29dc6ab6460e79e3fabe3fa2a4ddd0e210192daf6ed':raise ValueError('Prior raw proof manifest changed')
 proof=json.loads(proof_path.read_text())
 if proof['source_commit']!='745fb5dfc0099f9e898d559e77dd0895ae408ab7' or next(x for x in proof['files']if x['name']=='ratings.json')['sha256']!=RAW:raise ValueError('Wrong authenticated raw source binding')
 if sha(raw_path)!=RAW:raise ValueError('Unapproved prior raw provider evidence')
 manifest=initial/'manifest.json' if (initial/'manifest.json').exists() else initial/'ownership_manifest.json'
 states=initial/'states' if (initial/'states').is_dir() else initial
 hashes={'manifest.json':sha(manifest),**{'states/'+t+'.json':sha(states/f'{t}.json')for t in TEAMS}}
 if digest(hashes)!=PRIOR:raise ValueError('Unapproved prior checkpoint for absence bootstrap')
 raw=json.loads(Path(raw_path).read_text());players=raw['players']
 if raw['generated_at'][:10]!='2026-11-18' or raw['season']!=2027 or len(players)!=523 or len({p['nba_id']for p in players})!=523:
  raise ValueError('Invalid complete prior population')
 if any(type(p['nba_id'])is not int or p['nba_id']<=0 or any(p.get(k)is None for k in ['o_epm','d_epm','o_dpm','d_dpm','epm_mpg'])for p in players):raise ValueError('Incomplete prior pair evidence')
 return {p['nba_id']for p in players}

def query_absence(role,pid,key,current_cutoff,ids,witness):
 if current_cutoff!='2026-11-19' or role.previous_cutoff!='2026-11-18':raise ValueError('Absence bootstrap date out of scope')
 if type(pid)is not int or pid<=0:raise ValueError('Absence bootstrap requires canonical numeric identity')
 if pid in ids:raise ValueError('Present prior player requires exact full predecessor inputs: '+str(pid))
 # Native prior query would necessarily have zero rows: neither output producer
 # nor paired inner join can introduce a player absent from complete raw input.
 import pandas as pd
 witness.append({'prior_date':role.previous_cutoff,'current_date':current_cutoff,'nba_id':pid,'name_key':key,'query_rows':0,'raw_sha256':RAW,'checkpoint_sha256':PRIOR,'basis':'absent-from-authenticated-complete-raw-population'})
 return pd.DataFrame(columns=['nba_id','key','p_mpg'])

PATTERN="""previous_pair=self.src.pairs[self.previous_cutoff]
                    pp=previous_pair[previous_pair.nba_id==pid] if pid is not None else previous_pair[previous_pair['key']==k]"""
REPLACEMENT="""if self.previous_cutoff in self.src.pairs:
                        previous_pair=self.src.pairs[self.previous_cutoff]
                        pp=previous_pair[previous_pair.nba_id==pid] if pid is not None else previous_pair[previous_pair['key']==k]
                    else:
                        pp=certified_absence_query(self,pid,k,cutoff)"""

def main():
 raw=Path(os.environ['NBA_PRIOR_ABSENCE_RATINGS']);initial=Path(os.environ['NBA_PRIOR_ABSENCE_INITIAL'])
 ids=evidence(raw,initial);witness=[]
 native_script=Path(os.environ['NBA_PRIOR_ABSENCE_NATIVE_SCRIPT']).resolve()
 if native_script.name!='league_player_values.py' or sha(native_script)!='43ba1af22cfaca941abb97e758abdddc825654a2409254ed5b5cb8d722b30d62':raise ValueError('Wrong native team entrypoint')
 sys.path.insert(0,str(native_script.parent))
 import live_runtime
 original_install=live_runtime.install_clocks
 def install(model,role_module,*args,**kwargs):
  if sha(role_module.__file__)!='ec1a171421e71f9731a1f1fac7e37afdac8248732a367b9477ecfe32536edf67':raise ValueError('Role module differs from approved exact preimage')
  original_prepare=role_module.RoleSmoother.prepare
  text=textwrap.dedent(inspect.getsource(original_prepare))
  if text.count(PATTERN)!=1:raise ValueError('Prior query source no longer matches reviewed bootstrap')
  restore=original_install(model,role_module,*args,**kwargs)
  # Exact same daily-clock adaptation already performed by install_clocks.
  text=text.replace('self.src.schedule[evidence_year]','self.src.role_schedule_at(cutoff,evidence_year)').replace('self.src.schedule[target_year]','self.src.role_schedule_at(cutoff,target_year)')
  text=text.replace(PATTERN,REPLACEMENT)
  scope=dict(role_module.__dict__)
  scope['certified_absence_query']=lambda role,pid,k,cutoff:query_absence(role,pid,k,cutoff,ids,witness)
  exec(compile(text,'<reviewed-prior-absence-arrival-query>','exec'),scope)
  role_module.RoleSmoother.prepare=scope['prepare']
  return restore
 live_runtime.install_clocks=install
 try:
  runpy.run_path(str(native_script),run_name='__main__')
 finally:
  live_runtime.install_clocks=original_install
  # Separate per-team output; retains witnesses even if native validation fails.
  output=Path(sys.argv[sys.argv.index('--output')+1]);team=sys.argv[sys.argv.index('--team')+1]
  output=output/team;output.mkdir(parents=True,exist_ok=True)
  (output/'prior_absence_witness.json').write_text(json.dumps({'schema':'nba-prior-absence-query-witness-v1','scope':'query-only-no-prior-panel-or-fingerprint-relabel','runner_sha256':sha(__file__),'raw_sha256':RAW,'checkpoint_sha256':PRIOR,'prior_date':'2026-11-18','current_date':'2026-11-19','team':team,'queries':witness},indent=2)+'\n')
if __name__=='__main__':main()
