import json,tempfile,types,unittest
from pathlib import Path
from datetime import date,timedelta
from draft_prior import nba_forecast_weight,rewrite_rule
from live_runtime import install_clocks

def run():
    src=Inputs()
    cutoff_s='2026-10-31';cutoff=date.fromisoformat(cutoff_s);current_year=2027
    games_future=[d for d in src.schedule[current_year] if d>cutoff]
    games_played=sum(d<=cutoff for d in src.schedule[current_year])
    completed_draft=1;draft=True
    maturity=clamp((completed_draft-1)/3,0,1) if draft else 1.
    return maturity,games_played,games_future

class DraftEvidence(unittest.TestCase):
    def test_completed_rookie_season_gets_one_third_nba_evidence(self):
        self.assertAlmostEqual(nba_forecast_weight(1),1/3)
    def test_third_year_gets_two_thirds_and_fourth_year_is_fully_nba(self):
        self.assertAlmostEqual(nba_forecast_weight(2),2/3)
        self.assertEqual(nba_forecast_weight(3),1)
    def test_before_nba_and_mature_player_boundaries(self):
        self.assertEqual(nba_forecast_weight(0),0)
        self.assertEqual(nba_forecast_weight(-1),0)
        self.assertEqual(nba_forecast_weight(12),1)
        with self.assertRaises(ValueError):nba_forecast_weight(float('nan'))
    def test_unknown_canonical_rule_stops_for_review(self):
        with self.assertRaisesRegex(ValueError,'requires review'):rewrite_rule('maturity=completed_draft/99')
    def test_actual_engine_adapter_and_archived_game_clock(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);monthly=root/'monthly_reconstruction';monthly.mkdir()
            (monthly/'daily_input_audit.json').write_text(json.dumps({'date':'2026-11-01','completed_team_dates':{'UTA':['2026-10-30','2026-10-31']}}))
            (monthly/'daily_input_history.json').write_text(json.dumps([{'date':'2026-10-31','completed_team_dates':{'UTA':['2026-10-30']}}]))
            dates=[date(2026,10,30)+timedelta(days=i)for i in range(82)]
            src=types.SimpleNamespace(schedule={2027:dates})
            class Roles:
                def prepare(self):return 0
            model=types.SimpleNamespace(run=run,Inputs=lambda:src,date=date)
            module=types.SimpleNamespace(RoleSmoother=Roles)
            restore=install_clocks(model,module,src,root,'UTA')
            try:
                weight,played,future=model.run()
                self.assertAlmostEqual(weight,1/3)
                self.assertEqual(played,1)
                self.assertEqual(len(future),81)
                self.assertIn(date(2026,10,31),future)
            finally:restore()
            self.assertIs(model.run,run)
    def test_weight_changes_without_a_live_clock_file(self):
        with tempfile.TemporaryDirectory()as folder:
            dates=[date(2026,10,30)+timedelta(days=i)for i in range(82)]
            src=types.SimpleNamespace(schedule={2027:dates})
            model=types.SimpleNamespace(run=run,Inputs=lambda:src,date=date)
            module=types.SimpleNamespace(RoleSmoother=types.SimpleNamespace(prepare=lambda:None))
            restore=install_clocks(model,module,src,Path(folder),'UTA')
            try:self.assertAlmostEqual(model.run()[0],1/3)
            finally:restore()

if __name__=='__main__':unittest.main()
