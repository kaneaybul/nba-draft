import unittest
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from calibration.path_model import (path_quotes,summarize,ResidualPool,CareerPool,fit_reliability,
                        regularize_paths,slot_weights)


class PathModelTests(unittest.TestCase):
    def test_uncertain_peak_does_not_disappear_in_the_average(self):
        p=np.array([[100,100,0,0],[0,0,100,100]])
        result=summarize(p,[0,0,0,0],[.5,.5])
        self.assertAlmostEqual(result['mean'],560)
        self.assertAlmostEqual(result['mean_path_quote'],360)

    def test_guarantees_are_charged_even_outside_the_peak(self):
        self.assertAlmostEqual(path_quotes([100,100,0,0],[0,0,50,50])[0],480)

    def test_fractional_window_integrates_two_full_peak_equivalents(self):
        p=[100,90,80,70,60]
        e=[.25,1,1,1,.75]
        # Peak .25*100 + 90 + .75*80 = 175; sum production = 310.
        self.assertAlmostEqual(path_quotes(p,[0]*5,e)[0],598)

    def test_incomplete_or_missing_input_is_not_zero(self):
        with self.assertRaises(ValueError):
            path_quotes([1,2,3],[0]*3)
        with self.assertRaises(ValueError):
            path_quotes([1,2,3,np.nan],[0]*4)

    def test_residual_labels_are_complete_before_use(self):
        rows=[dict(key='old',origin=2017,horizon=5,feature=[25,0,1,3],residual=[1,2,3,4,5]),
              dict(key='future',origin=2020,horizon=5,feature=[25,0,1,3],residual=[100]*5)]
        p,w,meta=ResidualPool(rows).scenarios([0]*4,[25,0,1,3],2021,False)
        np.testing.assert_allclose(p,[[1,2,3,4]])
        self.assertEqual(meta['latest_label'],2021)
        # The eligible four-year prefix can be used before year five completes.
        rows=[dict(key='a',stage=0,horizon=5,label_end=2022,production=[1]*5,slot=1)]
        p,_,_=CareerPool(rows).scenarios(1,0,4,2021)
        self.assertEqual(p.shape,(1,4))

    def test_joint_error_vectors_are_not_independently_shuffled(self):
        rows=[dict(key='a',origin=2017,horizon=4,feature=[25,0,1,3],residual=[1,2,3,4]),
              dict(key='b',origin=2017,horizon=4,feature=[25,0,1,3],residual=[-1,-2,-3,-4])]
        p,_,_=ResidualPool(rows).scenarios([0]*4,[25,0,1,3],2021)
        self.assertTrue(np.all(p[:,3]==4*p[:,0]))

    def test_future_payoffs_cannot_choose_learning_rate(self):
        cases=[dict(label_end=2020,minutes=100,prior=0,nba=100,actual=50),
               dict(label_end=2024,minutes=100,prior=0,nba=100,actual=0)]
        result=fit_reliability(cases,2020,scales=[100,10000])
        self.assertEqual(result['scale'],100)
        self.assertEqual(result['n'],1)

    def test_regularization_retains_zero_service_and_payoff_center(self):
        p=np.array([[0,0,0,0],[10,10,20,30],[5,10,15,20]])
        w=slot_weights([1,5,10],5)
        scaled,factor=regularize_paths(p,[1,5,10],5,w,target_payoff=100)
        np.testing.assert_allclose(scaled[0],0)
        self.assertAlmostEqual(float(w@path_quotes(scaled,[0]*4)),100)


if __name__=='__main__':
    unittest.main()
