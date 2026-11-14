"""Rights changes retain physical origin; actual transfers conserve value."""
import unittest
from collections import defaultdict
from unittest.mock import patch
import attribution_picks as picks

class PickRightsAttributionTests(unittest.TestCase):
    def replay(self,trade=False):
        start,end='2026-01-31','2026-02-28'
        def asset(name,origin,value):return dict(id=name,name=name,kind='pick',physical_origin=origin,value=value)
        before={'UTA':[asset('own','UTA',100.),asset('acquired','BOS',50.)],
                'BOS':[asset('boston','BOS',200.)]}
        after={'UTA':[asset('own','UTA',110. if trade else 90.),asset('acquired','BOS',60.)],
               'BOS':[asset('boston','BOS',180. if trade else 200.)]}
        old,new=dict(rules=['old']),dict(rules=['new'])
        ctx=dict(teams=['UTA','BOS'],inputs=dict(ratings={end:{}},standings={end:{}},qualifiers={}),
                 orders=dict(orders={}),model={},actions=[],
                 trade_dates=defaultdict(set,{end:{'UTA','BOS'}if trade else set()}),
                 histories={t:{start:dict(assets=before[t]),end:dict(assets=after[t])}for t in before})
        with patch.object(picks,'CTX',ctx),patch.object(picks,'view',side_effect=lambda d:old if d==start else new),\
             patch.object(picks,'years',return_value=[2027]),patch.object(picks,'simulate',return_value={}),\
             patch.object(picks,'value_portfolio',side_effect=lambda day,v,*a:dict(teams=before if v==old else after)):
            return picks.interval((start,end))

    def test_offsetting_own_and_acquired_rights_changes_are_both_retained(self):
        result=self.replay();changes=result['changes']['UTA']
        self.assertEqual(changes['own_pick_revaluation'],-10.)
        self.assertEqual(changes['acquired_pick_revaluation'],10.)
        self.assertNotIn('external_legal',changes)
        self.assertEqual(sum(r['value']for r in result['legal']if r['team']=='UTA'),0.)
        self.assertEqual(len([r for r in result['legal']if r['team']=='UTA']),2)

    def test_actual_pick_transfers_stay_in_trades_and_conserve_league_value(self):
        result=self.replay(True)
        self.assertEqual(result['changes']['UTA']['trade_picks'],20.)
        self.assertEqual(result['changes']['BOS']['trade_picks'],-20.)
        self.assertEqual(sum(v.get('trade_picks',0)for v in result['changes'].values()),0.)
        self.assertTrue(all(r['category']=='trade_picks'for r in result['legal']))

if __name__=='__main__':unittest.main()
