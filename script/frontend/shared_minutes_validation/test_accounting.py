import unittest
from datetime import date
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shared_minutes_accounting import Snapshot, bridge, impact_per_game


class ForecastAccounting(unittest.TestCase):
    def setUp(self):
        self.clock=1000
        base=np.tile(np.linspace(28,12,410),(4,1))
        self.old=Snapshot(1,"CHI",date(2026,11,17),self.clock,base)
        self.new=Snapshot(1,"CHI",date(2026,11,19),self.clock+1,base[:,1:].copy())
        self.knots=[[1000,2],[1082.5,1.1],[1411,0]]
        self.price=lambda clock,m,v: float(np.dot(m,v))

    def calc(self,old,new,knots):
        def mark(s,k):
            return self.price(s.clock,s.window(s.clock)[-1],impact_per_game(k,s.clock))
        return bridge(old,new,self.knots,knots,self.price,self.price,
                      opening_mark=mark(old,self.knots),closing_mark=mark(new,knots))

    def test_frozen_forecast_only_ages(self):
        parts=self.calc(self.old,self.new,self.knots)
        self.assertLess(parts.pop("expected_aging_and_window"),0)
        self.assertTrue(all(abs(v)<1e-8 for v in parts.values()))

    def test_injury_and_impact_interaction(self):
        self.new.stages[2:,0]-=10
        self.new.stages[3,0]+=1
        parts=self.calc(self.old,self.new,[[x,y+1] for x,y in self.knots])
        average=impact_per_game(self.knots,self.new.clock)[0]+.5
        self.assertAlmostEqual(parts["direct_injury"],-10*average)
        self.assertAlmostEqual(parts["redistribution"],average)
        self.assertAlmostEqual(parts["role_forecast"],0)

    def test_mixed_model_or_untranslated_trade(self):
        from dataclasses import replace
        with self.assertRaisesRegex(ValueError,"migration"):
            self.calc(self.old,replace(self.new,version="another"),self.knots)
        with self.assertRaisesRegex(ValueError,"ownership"):
            self.calc(self.old,replace(self.new,team="UTA"),self.knots)


if __name__=="__main__":
    unittest.main()
