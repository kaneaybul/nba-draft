import unittest,tempfile,json
from pathlib import Path
from run_current_r_export import verify_outputs,TEAMS
class PendingR(unittest.TestCase):
 def test_pending_participates_not_owned(self):
  day='2026-11-17';stamp=day+'T12:00:00Z';teams=sorted(TEAMS);signed={i+1:t for i,t in enumerate(teams)};rows=[{'nba_id':i,'team':t,'team_projection_base':t,'year':2027,'pool_status':'roster','injury_projection_as_of':stamp,'Minutes':240,'minutes_actual':0,'minutes_remaining':240,'minutes_remaining_team_games':1}for i,t in signed.items()]
  rows[0].update(Minutes=120,minutes_remaining=120);rows.append({**rows[0],'nba_id':999,'contract_pending':True})
  calendar=[{'season':2027,'home_team':t,'away_team':teams[(i+1)%30],'is_completed':False}for i,t in enumerate(teams)]
  with tempfile.TemporaryDirectory()as d:
   p=[Path(d)/n for n in ('players.json','teams.json','schedule.json')]
   for f,x in zip(p,[rows,[{'year':2027,'scenario_id':'base','team':t}for t in teams],calendar]):f.write_text(json.dumps(x))
   result=verify_outputs(*p,signed,day,2027,stamp,{999:teams[0]});self.assertEqual(result['roster_count'],30);self.assertEqual(result['participant_count'],31);self.assertEqual(result['team_budget_max_error'],0)
   with self.assertRaisesRegex(ValueError,'owners differ'):verify_outputs(*p,signed,day,2027,stamp)
   rows[-1]['minutes_remaining']=121;rows[-1]['Minutes']=121;p[0].write_text(json.dumps(rows))
   with self.assertRaisesRegex(ValueError,'team budgets'):verify_outputs(*p,signed,day,2027,stamp,{999:teams[0]})
if __name__=='__main__':unittest.main()
