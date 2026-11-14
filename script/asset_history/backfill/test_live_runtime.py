import json,tempfile,types,unittest
from datetime import date,timedelta
from pathlib import Path
import numpy as np
from live_runtime import install_clocks,restore_roles,persistent_calibration,encode,annual_waiver_choice

def run():
    src=Inputs()
    cutoff_s='2026-10-26';cutoff=date.fromisoformat(cutoff_s);current_year=2027
    games_future=[d for d in src.schedule[current_year] if d>cutoff]
    games_played=sum(d<=cutoff for d in src.schedule[current_year])
    return games_played,games_future

class Role:
    def prepare(self):
        cutoff='2026-10-26';evidence_year=2027
        return sum(d.isoformat()<=cutoff for d in self.src.schedule[evidence_year])

class Check(unittest.TestCase):
 def test_verified_waiver_limits_cost_without_creating_production(self):
  self.assertEqual(annual_waiver_choice(-1500000,300000,{'waiver_option_verified':True,'waiver_guaranteed_amount_asof':75000}),(-60000,0,True))
  self.assertEqual(annual_waiver_choice(1000000,300000,{'waiver_option_verified':True,'waiver_guaranteed_amount_asof':0}),(1000000,300000,False))
 def test_diagnostic_guarantee_is_not_an_asof_release_option(self):
  self.assertEqual(annual_waiver_choice(-1500000,300000,{'guaranteed_amount':0}),(-1500000,300000,False))
 def test_tonights_game_is_forward(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);p=root/'monthly_reconstruction/daily_input_audit.json';p.parent.mkdir()
   p.write_text(json.dumps({'date':'2026-10-26','completed_team_dates':{'BOS':['2026-10-20','2026-10-23']}}))
   dates=[date(2026,10,20),date(2026,10,23),date(2026,10,26)]+[date(2026,10,27)+timedelta(days=i)for i in range(79)]
   src=types.SimpleNamespace(schedule={2027:dates})
   model=types.SimpleNamespace(run=run,Inputs=lambda:src,date=date)
   module=types.SimpleNamespace(RoleSmoother=Role)
   restore=install_clocks(model,module,src,root,'BOS')
   try:
    played,future=model.run();self.assertEqual(played,2);self.assertEqual(len(future),80);self.assertIn(date(2026,10,26),future)
    r=Role();r.src=src;self.assertEqual(r.prepare(),2)
   finally:restore()
   self.assertIs(model.run,run)
 def test_role_state_years_and_roster_restore(self):
  roles=types.SimpleNamespace()
  restore_roles(roles,{'role_state':{'states':{'a':{'base':{'2027':{'games':70}},'posterior':{'2027':{'games':71}}}},'previous_roster':[['a','roster_contract']]}})
  self.assertEqual(roles.states['a']['posterior'][2027]['games'],71);self.assertEqual(roles.previous_roster,{('a','roster_contract')})
 def test_encode_keeps_negative_and_arrays(self):
  x=encode({'when':date(2026,10,26),'x':np.array([-1.,2.])});self.assertEqual(x,{'when':'2026-10-26','x':[-1,2]})
 def test_calibration_state_restores_dates_and_identity(self):
  class Base:
   def __init__(self,src):pass
  capture={};state={'calibration_state':{'previous':{'date':'2026-10-25','levels':{'C':-2},'league_timin':1},'positions':[{'identity':123,'state':{'date':'2026-10-25','shares':[0,0,0,0,1]}}]}}
  cls=persistent_calibration(Base,state,capture);r=cls(None)
  self.assertEqual(r.previous['date'],date(2026,10,25));self.assertTrue(np.array_equal(r.position_state[123]['shares'],[0,0,0,0,1]));self.assertIs(capture['instance'],r)
if __name__=='__main__':unittest.main()
