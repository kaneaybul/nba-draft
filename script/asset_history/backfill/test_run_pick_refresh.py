import copy,json,unittest
from pathlib import Path
from run_pick_refresh import new_pick_actions
from pick_replay import active_rules

class CompleteTradePackages(unittest.TestCase):
    def event(self):
        return dict(date='2026-11-08',event_id='REFRESH_fe42b1853675a3',
            text='A TPE was acquired by the Sacramento Kings from the Oklahoma City Thunder in exchange for: Nique Clifford.',
            players=[dict(name='Nique Clifford')],parsed_status='simple_two_team_trade',
            parsed_actions=[dict(player_name='Nique Clifford',to_team='OKC',action='transfer')],source='https://basketball.realgm.com/nba/transactions/league/2027')
    def reviews(self):
        return json.loads(Path(__file__).with_name('reviewed_trade_packages.json').read_text())
    def test_missing_pick_words_still_yields_both_official_transfers(self):
        actions,catalog,unknown=new_pick_actions([self.event()],[],'2026-11-10',2027)
        self.assertFalse(unknown);self.assertEqual(len(actions),2)
        self.assertEqual([a['rule']['pick'] for a in actions],[['UTA',2028,2],['MIN',2030,2]])
        self.assertTrue(all(a['rule']['from_team']=='OKC' and a['rule']['to_team']=='SAC' for a in actions))
        self.assertTrue(all(a['source'][0].startswith('https://www.nba.com/kings/') for a in actions))
        baseline=dict(complete=True,asof='2021-12-31',rules=[])
        self.assertEqual(active_rules(baseline,actions,'2026-11-07',catalog)['rules'],[])
        view=active_rules(baseline,actions,'2026-11-08',catalog)
        self.assertTrue(view['complete']);self.assertEqual(len(view['rules']),2)
    def test_unknown_new_player_only_trade_cannot_pass_as_no_picks(self):
        e=self.event();e['date']='2026-11-09'
        actions,catalog,unknown=new_pick_actions([e],[],'2026-11-10',2027)
        self.assertFalse(actions);self.assertEqual(len(unknown),1)
        self.assertIn('independently verified',unknown[0]['reason'])
        self.assertFalse(active_rules(dict(complete=True,asof='2021-12-31',rules=[]),actions,'2026-11-10',catalog)['complete'])
    def test_even_partial_pick_text_needs_complete_new_package(self):
        e=self.event();e['date']='2026-11-09';e['text']=e['text'].replace('A TPE','A 2028 2nd Round Pick (UTA own)')
        self.assertEqual(len(new_pick_actions([e],[],'2026-11-10',2027)[2]),1)
    def test_source_correction_or_repeated_capture_does_not_duplicate_picks(self):
        e=self.event();corrected=copy.deepcopy(e);corrected['event_id']='UPDATED'
        corrected['text']=e['text'].replace('A TPE','An unprotected 2028 2nd Round Pick (UTA own) and an unprotected 2030 2nd Round Pick (MIN own)')
        actions,catalog,unknown=new_pick_actions([e,e,corrected],[],'2026-11-10',2027)
        self.assertEqual(len(actions),2);self.assertEqual(len(catalog),1);self.assertFalse(unknown)
    def test_future_and_mismatched_deals_do_not_inherit_review(self):
        self.assertEqual(new_pick_actions([self.event()],[],'2026-11-07',2027),([],[],[]))
        e=self.event();e['parsed_actions'][0]['to_team']='SAC'
        self.assertEqual(len(new_pick_actions([e],[],'2026-11-10',2027)[2]),1)
    def test_reviewed_no_pick_trade_is_explicit_and_sourced(self):
        reviews=self.reviews();p=reviews['packages'][0];p['pick_transfers']=[];p['no_pick_reason']='Fixture: complete team release confirms player-only return'
        actions,_,unknown=new_pick_actions([self.event()],[],'2026-11-10',2027,reviews)
        self.assertFalse(unknown);self.assertEqual(actions[0]['kind'],'no_future_pick_effect')
    def test_old_unresolved_conditional_pick_still_blocks(self):
        e=self.event();e['date']='2026-09-20';e['text']=e['text'].replace('A TPE','A conditional 2028 2nd Round Pick')
        self.assertEqual(len(new_pick_actions([e],[],'2026-11-10',2027)[2]),1)

if __name__=='__main__':unittest.main()
