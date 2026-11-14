import unittest
import numpy as np
from league_pick_values import new_lottery,actual_number_arrays,prepare_rule_conditions,TEAMS,EAST
from vector_pick_allocator import OWNER_INDEX

class PickForecastChecks(unittest.TestCase):
    def test_new_lottery_removes_forfeited_origin_before_drawing(self):
        names=sorted(TEAMS);index={t:i for i,t in enumerate(names)}
        confs=[np.array([index[t]for t in names if t in EAST]),np.array([index[t]for t in names if t not in EAST])]
        rng=np.random.default_rng(44);wins=rng.uniform(20,65,(3000,30));previous=np.zeros_like(wins,dtype=bool)
        twice=previous.copy();one=previous.copy();previous[:,5]=True;twice[:,5]=True;one[:,8]=True
        first,_=new_lottery(wins,rng,confs,previous,twice,one,excluded={0})
        self.assertTrue(np.all(first[:,0]==30))
        self.assertTrue(np.all(first[:,5]>5));self.assertTrue(np.all(first[:,8]!=1))
        bottom=np.argsort(wins,axis=1)[:,:3]
        for k in range(3):
            selected=bottom[:,k];active=selected!=0
            self.assertTrue(np.all(first[np.arange(len(first))[active],selected[active]]<=12))
        self.assertTrue(np.all(np.sort(first,axis=1)==np.arange(1,31)))

    def test_first_forfeit_changes_second_round_and_protection_boundary(self):
        names=sorted(TEAMS);keys=[(t,2031,r)for r in [1,2]for t in names]
        raw=np.arange(1,61,dtype=np.int16)[None,:];owners=np.zeros((1,60),dtype=np.int8)
        owners[0,14]=OWNER_INDEX['FORFEITED']
        actual,counts=actual_number_arrays(raw,owners,keys,OWNER_INDEX['FORFEITED'])
        self.assertEqual(actual[0,15],15);self.assertEqual(actual[0,30],30);self.assertEqual(counts[2031][0],1)
        original=[{'protected_ranges':[[31,55]],'branch':{'if_slot_in':{'pick':['HOU',2031,2],'range':[31,55]}}}]
        adapted=prepare_rule_conditions(original)
        self.assertEqual(adapted[0]['protected_ranges'],[[1,55]])
        self.assertEqual(adapted[0]['branch']['if_slot_in']['range'],[1,55])
        self.assertEqual(original[0]['protected_ranges'],[[31,55]])

    def test_second_forfeit_shifts_only_later_actual_numbers(self):
        names=sorted(TEAMS);keys=[(t,2025,r)for r in [1,2]for t in names]
        raw=np.arange(1,61,dtype=np.int16)[None,:];owners=np.zeros((1,60),dtype=np.int8)
        owners[0,55]=OWNER_INDEX['FORFEITED']
        actual,counts=actual_number_arrays(raw,owners,keys,OWNER_INDEX['FORFEITED'])
        self.assertEqual(actual[0,54],55);self.assertEqual(actual[0,56],56);self.assertEqual(actual[0,59],59)
        self.assertEqual(counts[2025][0],0)

if __name__=='__main__':unittest.main()
