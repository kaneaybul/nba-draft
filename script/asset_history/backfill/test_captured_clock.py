import csv,json,tempfile,unittest
from pathlib import Path
from captured_clock import restore_panel_clock

class CapturedGames(unittest.TestCase):
    def test_saved_morning_panel_does_not_count_later_games(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);directory=root/'monthly_reconstruction/pick_forecasts';directory.mkdir(parents=True)
            standings=directory/'standings_monthly.csv'
            standings.write_text('cutoff,team_alias,team_id,team_name,gp\n2026-09-30,UTA,1,Utah,0\n2026-09-30,BOS,2,Boston,0\n')
            result=root/'results.json'
            result.write_text(json.dumps({'games':[{'date':day,'is_completed':True,'home_team':'UTA','away_team':'BOS','result':'UTA','home_score':100,'away_score':90}for day in ['2026-10-30','2026-10-31']]}))
            panel={'date':'2026-10-31','coverage':[{'performance_cutoff':'2026-10-30'}],
                'roster':[{'roster':[{'team':'UTA'},{'team':'BOS'}]}]}
            restore_panel_clock(root,panel,result)
            with standings.open()as f:rows=[r for r in csv.DictReader(f)if r['cutoff']=='2026-10-31']
            self.assertEqual({r['team_alias']:r['gp']for r in rows},{'UTA':'1','BOS':'1'})
            saved=json.loads((root/'monthly_reconstruction/daily_input_history.json').read_text())[0]
            self.assertEqual(saved['completed_team_dates']['UTA'],['2026-10-30'])
    def test_missing_observed_cutoff_is_not_guessed(self):
        with tempfile.TemporaryDirectory()as folder:
            with self.assertRaisesRegex(ValueError,'no observed game cutoff'):
                restore_panel_clock(Path(folder),{'date':'2026-10-31'},Path(folder)/'missing.json')

if __name__=='__main__':unittest.main()
