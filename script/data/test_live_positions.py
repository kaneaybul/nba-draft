import csv, json, tempfile, unittest
from pathlib import Path
from live_positions import build_positions, enrich_stats_positions, matchup_position

class PositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root/'raw/live').mkdir(parents=True)
    def tearDown(self): self.temp.cleanup()
    def registry(self, players):
        (self.root/'raw/live/player_pool.json').write_text(json.dumps(dict(season=2027,players=players)))
    def test_current_pbp_shares_override_roster_and_old_season_does_not(self):
        self.registry([dict(app_nba_id=1,nba_id=1,player_name='Player A',position='SG'),
                       dict(app_nba_id=2,nba_id=2,player_name='Rookie B',position='SG')])
        path=self.root/'raw/bref_position_estimates.csv'
        path.write_text('year,player_name,pg_share,sg_share,sf_share,pf_share,c_share\n2027,Player A,0,.2,.8,0,0\n2026,Rookie B,0,0,0,0,1\n')
        stats=[dict(nba_id=1,player_name='Player A',Pos2='SG'),dict(nba_id=2,player_name='Rookie B',Pos2='')]
        feed=build_positions(stats,2027,self.root);enrich_stats_positions(stats,feed)
        a,b=feed['players']
        self.assertEqual((a['position'],a['source'],a['sf_share']),('SF','bref_pbp',.8))
        self.assertEqual((b['position'],b['source']),('SG','espn_roster'))
        self.assertEqual(stats[1]['Pos2'],'SG')
    def test_generic_roster_does_not_overwrite_precise_stats(self):
        self.registry([dict(app_nba_id=1,nba_id=1,player_name='A',position='G')])
        row=build_positions([dict(nba_id=1,player_name='A',Pos2='SG')],2027,self.root)['players'][0]
        self.assertEqual(row['position'],'SG')
    def test_provisional_app_id_keeps_daily_roster_position_when_nba_id_arrives(self):
        self.registry([dict(app_nba_id=-7,nba_id=None,player_name='New Rookie',position='PF')])
        stats=[dict(nba_id=777,player_name='New Rookie',Pos2='')]
        feed=build_positions(stats,2027,self.root);enrich_stats_positions(stats,feed)
        self.assertEqual(len(feed['players']),1)
        self.assertEqual(feed['players'][0]['app_nba_id'],-7)
        self.assertEqual(stats[0]['Pos2'],'PF')
    def test_matchup_groups_and_missing_position(self):
        self.assertEqual([matchup_position(p) for p in ['PG','SG','SF','PF','C']],['G','G','F','F','C'])
        self.assertIsNone(matchup_position(''))
    def test_wrong_registry_season_is_rejected(self):
        (self.root/'raw/live/player_pool.json').write_text('{"season":2026,"players":[]}')
        with self.assertRaises(ValueError):build_positions([],2027,self.root)

if __name__=='__main__':unittest.main()
