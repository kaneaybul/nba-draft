import ast,inspect,os,sys,types,unittest,importlib.util
from pathlib import Path
from datetime import date,timedelta
import pandas as pd
from asset_minutes import blend_mpg,install,POLICY,SETTINGS

class Check(unittest.TestCase):
 def test_shared_frontend_policy_and_edge_cases(self):
  for row in SETTINGS['parity_cases']:
   mpg,weight=blend_mpg(row['prior'],row['games'],row['minutes'])
   self.assertAlmostEqual(mpg,row['mpg']);self.assertAlmostEqual(weight,row['weight'])
 def test_weights_and_zero_sample(self):
  for n,expected in [(0,20),(5,70/3),(10,25),(40,28)]:
   mpg,w=blend_mpg(20,n,30*n);self.assertAlmostEqual(mpg,expected);self.assertAlmostEqual(w,n/(10+n))
  with self.assertRaises(ValueError):blend_mpg(20,-1,30)
 def test_real_canonical_roles_and_dollar_path(self):
  path=os.environ.get('CANONICAL_ROLE_FILE')
  if not path:self.skipTest('Portable canonical source supplied by integration workflow')
  # Execute the actual reviewed method, with fixed sources and no roster event.
  text=Path(path).read_text();tree=ast.parse(text)
  node=next(n for c in tree.body if isinstance(c,ast.ClassDef) for n in c.body if isinstance(n,ast.FunctionDef)and n.name=='prepare')
  text=''.join(text.splitlines(True)[node.lineno-1:node.end_lineno]);import textwrap,linecache
  text=textwrap.dedent(text);filename='<original-canonical-role-fixture>'
  linecache.cache[filename]=(len(text),None,text.splitlines(True),filename)
  scope={'date':date,'timedelta':timedelta,'pd':pd,'clamp':lambda v,l,h:max(l,min(h,v)),
         'roster_change_role_deltas':lambda *a:(_ for _ in ()).throw(AssertionError('Unexpected roster change'))}
  exec(compile(text,filename,'exec'),scope)
  class Role:
   @staticmethod
   def signed_two_way(*a):return False
  Role.prepare=scope['prepare'];module=types.ModuleType('fixture_role');module.__dict__.update(scope);module.RoleSmoother=Role
  def run(target,returning=True,injured=False,patched=False):
   restore=install(module)if patched else lambda:None
   if patched:
    # The daily clock adapter recompiles this source with module globals.
    clock_scope=dict(module.__dict__)
    exec(compile(inspect.getsource(Role.prepare),'<daily-clock-composition>','exec'),clock_scope)
    Role.prepare=clock_scope['prepare']
   try:
    r=Role();r.states={};r.previous_roster=None;r.previous_caps={};r.previous_cutoff=None;r.rows=[];r.annual_rows=[];r.allocations=[];r.reference={};r.reference_names={}
    days=[date(2026,10,20)+timedelta(days=i)for i in range(82)]
    annual=pd.DataFrame([{'season':2026,'nba_id':1,'games':60,'key':'player'}]if returning else [],columns=['season','nba_id','games','key'])
    injuries=[{'player_nba_id':1,'player_name':'player','known_from':'2026-10-23','known_through':'2026-11-23','affected_season':2027}]if injured else []
    r.src=types.SimpleNamespace(reg_end={2027:days[-1]},reg_start={2027:days[0]},schedule={2027:days},
       pairs={'2026-10-24':pd.DataFrame(columns=['nba_id','key'])},annual=annual,injuries=injuries)
    r.seed=lambda *a:({y:{'games':60.,'mpg':20.}for y in range(2027,2039)},'app_completed_season_career_role_prior')
    r.actual=lambda *a:({'games':5.,'minutes':150.,'data_cutoff':'2026-10-24'},'verified')
    r.weights=lambda y:(20.,20.);r.rotation_minutes={('2026-10-24',1):target};r.provider_minutes={}
    # A deterministic existing career path makes movement attributable only to
    # the role input; ratings, contracts, dates and attendance are identical.
    r.refresh_future=lambda pid,k,year,g,mpg,p,cutoff,existing:{y:{'games':60.,'mpg':mpg}for y in existing}
    snap={'asof_date':'2026-10-24','roster_and_rights':[{'asset_type':'roster_contract','player_name':'player','nba_id':1,'acquired_date':'2026-07-01'}]}
    result=r.prepare(snap,2027,lambda n:n)
    again=r.prepare(snap,2027,lambda n:n)
    self.assertEqual(result,again)
    return result['player'],r.rows[0]
   finally:restore()
  low,old=run(10);high,_=run(30);new,diag=run(10,patched=True);new_high,_=run(30,patched=True)
  self.assertAlmostEqual(new[2027]['mpg'],70/3)
  self.assertEqual(new,new_high);self.assertEqual(old['posterior_annual_games'],diag['posterior_annual_games'])
  self.assertEqual(diag['role_evidence_mode'],POLICY)
  self.assertNotEqual(new[2028]['mpg'],low[2028]['mpg'])
  # Same production/contract pricing as annualAssetValue/fourYearAssetQuote.
  def quote(path):
   rows=[(v['games']*v['mpg']*10000,5000000)for y,v in sorted(path.items())if 2027<=y<=2030]
   return 2*sum(sorted((p for p,c in rows),reverse=True)[:2])+.8*sum(p-c for p,c in rows)
  self.assertNotEqual(quote(low),quote(high));self.assertEqual(quote(new),quote(new_high))
  print('CONTROLLED_ASSET_DOLLAR_CHECK',{'old_provider_shock':quote(high)-quote(low),'new_provider_shock':quote(new_high)-quote(new),'fixed_source_quote_delta':quote(new)-quote(low)},flush=True)
  for returning,injured in [(False,False),(True,True)]:
   self.assertEqual(run(10,returning,injured)[0],run(10,returning,injured,True)[0])
if __name__=='__main__':unittest.main()
