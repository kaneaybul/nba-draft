import unittest
from datetime import datetime,timezone
from refresh_player_pool import reconcile,departure_for,roster_rows
NOW=datetime(2026,10,24,tzinfo=timezone.utc)

class PoolTests(unittest.TestCase):
    def player(self):
        return dict(app_nba_id=42,nba_id=42,player_name='Example Player',team='UTA',pool_status='roster',last_seen='2026-10-22',last_nba_season=2026)
    def test_missing_roster_is_not_a_waiver(self):
        rows,_=reconcile([self.player()],[],[],2027,NOW)
        self.assertEqual(rows[0]['team'],'UTA');self.assertTrue(rows[0]['review_pending'])
    def test_confirmed_waiver_moves_to_free_agents(self):
        t=dict(date='2026-10-23',team='UTA',description='Waived G Example Player.')
        rows,_=reconcile([self.player()],[],[t],2027,NOW)
        self.assertEqual(rows[0]['pool_status'],'free_agent');self.assertEqual(rows[0]['team'],'FA')
    def test_old_waiver_does_not_remove_resigned_player(self):
        t=dict(date='2026-10-01',team='UTA',description='Waived G Example Player.')
        rows,_=reconcile([self.player()],[],[t],2027,NOW)
        self.assertEqual(rows[0]['pool_status'],'roster')
    def test_signed_player_not_waived_by_another_clause(self):
        t=dict(date='2026-10-23',team='UTA',description='Signed G Example Player. Waived G Somebody Else.')
        self.assertIsNone(departure_for(self.player(),[t],'2026-10-22'))
    def test_new_signing_without_rating_is_included(self):
        a=dict(espn_id='123',player_name='New Player',team='UTA',salary=None,position='G')
        rows,_=reconcile([], [a],[],2027,NOW)
        self.assertEqual(rows[0]['pool_status'],'roster');self.assertEqual(rows[0]['app_nba_id'],-1000000123)
        again,_=reconcile(rows,[a],[],2027,NOW);self.assertEqual(again[0]['app_nba_id'],rows[0]['app_nba_id'])
    def test_trade_preserves_identity(self):
        a=dict(espn_id='123',player_name='Example Player',team='BOS',salary=None,position='G')
        rows,_=reconcile([self.player()],[a],[],2027,NOW)
        self.assertEqual(rows[0]['app_nba_id'],42);self.assertEqual(rows[0]['team'],'BOS')
    def test_retirement_and_inactivity_are_hidden(self):
        t=dict(date='2026-10-23',team='UTA',description='Retired G Example Player.')
        rows,_=reconcile([self.player()],[],[t],2027,NOW);self.assertEqual(rows[0]['pool_status'],'inactive')
        again,_=reconcile(rows,[],[],2027,NOW);self.assertEqual(again[0]['pool_status'],'inactive')
    def test_incomplete_league_does_not_replace_snapshot(self):
        with self.assertRaises(ValueError):roster_rows({},2027,NOW)

if __name__=='__main__':unittest.main()
