"""Explicit non-native launcher for the reviewed Nov19 absence-query adapter."""
import argparse,os,runpy,subprocess,sys
from pathlib import Path
from prior_absence_team_runner import evidence,sha

def main():
 p=argparse.ArgumentParser();p.add_argument('--native-runner',type=Path,required=True);p.add_argument('--prior-absence-ratings',type=Path,required=True)
 args,native_args=p.parse_known_args();script=args.native_runner.resolve()
 if script.name!='run_owner_replay.py' or sha(script)!='4571fa557a01437a554e99745fc21ce36cf46c8273d6d5cb353edf2c3f4163e4':raise ValueError('Wrong native owner entrypoint')
 def value(flag):return native_args[native_args.index(flag)+1]
 if value('--through')!='2026-11-19' or value('--max-dates')!='1':raise ValueError('Absence adapter is current Nov19 only')
 initial=Path(value('--initial-state')).resolve();evidence(args.prior_absence_ratings,initial)
 leaf=script.with_name('league_player_values.py');wrapper=Path(__file__).with_name('prior_absence_team_runner.py')
 original_run=subprocess.run
 def run(cmd,*pos,**kw):
  if isinstance(cmd,list) and len(cmd)>1 and Path(cmd[1]).resolve()==leaf:
   cmd=[cmd[0],str(wrapper),*cmd[2:]]
   env=dict(kw.get('env',os.environ));env.update(NBA_PRIOR_ABSENCE_RATINGS=str(args.prior_absence_ratings.resolve()),NBA_PRIOR_ABSENCE_INITIAL=str(initial),NBA_PRIOR_ABSENCE_NATIVE_SCRIPT=str(leaf));kw['env']=env
  return original_run(cmd,*pos,**kw)
 subprocess.run=run
 sys.path.insert(0,str(script.parent));sys.argv=[str(script),*native_args]
 try:runpy.run_path(str(script),run_name='__main__')
 finally:subprocess.run=original_run
if __name__=='__main__':main()
