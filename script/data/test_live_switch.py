import unittest
from unittest.mock import patch
from live_switch import refresh_assignments,score_assignments

class SwitchTests(unittest.TestCase):
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
        players=[{'nba_id':i,'GamesPlayed':2,'Minutes':40,'d_Points_Per100':10+i/10} for i in range(1,111)]
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
        with self.assertRaises(ValueError):score_assignments(rows+[rows[0]],players,positions)
        with self.assertRaises(ValueError):score_assignments([dict(r,GP=1) for r in rows],players,positions)

if __name__=='__main__':unittest.main()
