import unittest,json,tempfile
from pathlib import Path
from unittest.mock import patch
from live_switch import refresh_assignments,score_assignments
from matchup_snapshot import make_snapshot

class SwitchTests(unittest.TestCase):
    def setUp(self):
        isolated=patch.dict('os.environ',{'NBA_MATCHUP_SNAPSHOT':'/missing/test-matchup-snapshot.json'})
        isolated.start();self.addCleanup(isolated.stop)

    def test_fresh_external_snapshot_avoids_runner_network(self):
        players=[dict(nba_id=i,GamesPlayed=2,TeamId=1,d_Points_Per100=10+i/10,Pos2=['SG','PF','C'][i%3]) for i in range(1,111)]
        rows=[dict(SEASON_ID='22026',DEF_PLAYER_ID=i,OFF_PLAYER_ID=j,PARTIAL_POSS=10+i%5,GP=2) for i in range(1,111) for j in (i,i%110+1)]
        data=make_snapshot(rows,dict(SeasonYear='2026-27',SeasonType='Regular Season'),2027)
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'snapshot.json';path.write_text(json.dumps(data))
            with patch.dict('os.environ',{'NBA_MATCHUP_SNAPSHOT':str(path)}),patch('live_switch.nba_table',side_effect=AssertionError('Runner network used')):
                scores,audit=refresh_assignments(players,2027)
        self.assertEqual(len(scores),110)
        self.assertEqual(audit['transport'],'verified_external_snapshot')
        self.assertEqual(audit['status'],'assignments_available')

    def test_complete_matchups_use_shared_positions_without_another_nba_call(self):
        players=[dict(nba_id=i,GamesPlayed=2,TeamId=1,d_Points_Per100=10+i/10,Pos2=['SG','PF','C'][i%3]) for i in range(1,111)]
        rows=[dict(SEASON_ID='22026',DEF_PLAYER_ID=i,OFF_PLAYER_ID=j,PARTIAL_POSS=10+i%5,GP=2) for i in range(1,111) for j in (i,i%110+1)]
        with patch('live_switch.nba_table',return_value=(rows,{'SeasonYear':'2026-27','SeasonType':'Regular Season'})) as fetch:
            scores,audit=refresh_assignments(players,2027)
        self.assertEqual(len(scores),110)
        self.assertEqual(audit['status'],'assignments_available')
        self.assertEqual(fetch.call_count,1)
        # NBA treats ID=0 as a filter and returns an empty table; omitted
        # optional player/team filters are represented by blank strings.
        for key in ('DefPlayerID','OffPlayerID','DefTeamID','OffTeamID'):
            self.assertEqual(fetch.call_args.args[1][key],'')

    def test_empty_current_table_holds_prior(self):
        with patch('live_switch.nba_table',return_value=([],{'SeasonYear':'2026-27','SeasonType':'Regular Season'})):
            scores,audit=refresh_assignments([],2027)
        self.assertEqual(scores,{})
        self.assertIn('empty',audit['reason'])

    def test_wrong_season_never_used(self):
        with patch('live_switch.nba_table',return_value=([],{'SeasonYear':'2025-26','SeasonType':'Regular Season'})):
            scores,audit=refresh_assignments([],2027)
        self.assertEqual(scores,{})
        self.assertIn('failed validation',audit['reason'])

    def test_outage_holds_prior(self):
        with patch('live_switch.nba_table',side_effect=TimeoutError):
            scores,audit=refresh_assignments([],2027)
        self.assertEqual(scores,{})
        self.assertEqual(audit['status'],'unavailable')

    def test_current_low_minute_players_are_scored(self):
        players=[{'nba_id':i,'GamesPlayed':2,'Minutes':40,'TeamId':1,'d_Points_Per100':10+i/10} for i in range(1,111)]
        positions={i:['G','F','C'][i%3] for i in range(1,111)}
        rows=[]
        for i in range(1,111):
            for j in (i,i%110+1):
                rows.append(dict(DEF_PLAYER_ID=i,OFF_PLAYER_ID=j,PARTIAL_POSS=10+i%5,GP=2))
        scores=score_assignments(rows,players,positions)
        self.assertEqual(len(scores),110)
        self.assertAlmostEqual(sum(scores.values()),0,places=8)
        # Repeated pulls are deterministic; duplicate pairs and missing coverage fail.
        self.assertEqual(scores,score_assignments(rows,players,positions))
        # Two games against different teams have GP=1 per opponent pair.
        teams=[dict(p,TeamId=p['nba_id']%2) for p in players]
        two_opponents=[dict(r,GP=1) for r in rows]
        self.assertEqual(len(score_assignments(two_opponents,teams,positions)),110)
        with self.assertRaises(ValueError):score_assignments(rows+[rows[0]],players,positions)
        with self.assertRaises(ValueError):score_assignments([dict(r,GP=1) for r in rows],players,positions)

if __name__=='__main__':unittest.main()

