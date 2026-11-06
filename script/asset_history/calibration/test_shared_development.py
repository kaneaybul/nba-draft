"""Economic boundary checks for the single padded development value."""
import unittest
import numpy as np
from .path_model import summarize_development,development_weight,evidence_weight,path_quotes

class SharedDevelopmentTests(unittest.TestCase):
    def quote(self,weight,cost=0.):
        # Same annual means can hide different career peaks; price each career.
        prior=np.array([[1.,1.,1.,1.],[2.,2.,2.,2.]])
        nba=np.array([[20.,20.,0.,0.],[0.,0.,20.,20.]])
        return summarize_development(prior,np.full(prior.shape,cost),[.5,.5],[100.,200.],
            nba,np.full(nba.shape,cost),[.5,.5],weight,np.ones(4))

    def test_initial_value_is_the_mature_pick_expectation(self):
        self.assertEqual(self.quote(0.)['production_quote'],150.)

    def test_interim_grade_is_the_same_padded_production_used_for_stock(self):
        q=self.quote(.5,cost=5.)
        self.assertAlmostEqual(q['production_quote'],115.)
        self.assertAlmostEqual(q['mean'],q['production_quote']+q['contract_adjustment_sum'])
        self.assertAlmostEqual(q['mean'],q['mean_path_quote']+q['path_selection_premium']+q['draft_prior_adjustment'])

    def test_full_evidence_converges_to_ordinary_scenario_averaged_asset_value(self):
        q=self.quote(1.,cost=5.)
        expected=np.mean(path_quotes([[20.,20.,0.,0.],[0.,0.,20.,20.]],np.full((2,4),5.)))
        self.assertAlmostEqual(q['mean'],expected)
        self.assertAlmostEqual(q['production_quote'],80.)
        self.assertAlmostEqual(q['draft_prior_adjustment'],0.)

    def test_salary_changes_do_not_change_the_production_draft_grade(self):
        self.assertEqual(self.quote(.5,0.)['production_quote'],self.quote(.5,50.)['production_quote'])

    def test_padding_fades_to_zero_even_for_a_low_minute_draftee(self):
        self.assertEqual(development_weight(100.,1000.,2.),evidence_weight(100.,1000.))
        weights=[development_weight(100.,1000.,t)for t in [1.,.5,.01,0.]]
        self.assertEqual(weights,sorted(weights))
        self.assertEqual(weights[-1],1.)
        self.assertEqual(development_weight(0.,1000.,0.),1.)

    def test_on_pace_endpoint_is_not_regraded_by_early_career_service(self):
        # Both endpoints say 100. Current-window service can be much lower;
        # learning more should never manufacture a negative development grade.
        for weight in (0.,.25,.75,1.):
            q=summarize_development([[1.]*4],[[0.]*4],[1.],[100.],
                [[5.]*4],[[0.]*4],[1.],weight,np.ones(4),[100.],[1.])
            self.assertAlmostEqual(q['production_quote'],100.)
            self.assertAlmostEqual(q['nba_production_quote'],100.)
            self.assertAlmostEqual(q['current_window_production_quote'],20.)

    def test_endpoint_and_service_uncertainty_preserve_both_means(self):
        q=summarize_development([[1.]*4],[[0.]*4],[1.],[100.],
            [[5.]*4,[10.]*4],[[2.]*4,[3.]*4],[.25,.75],.6,np.ones(4),[50.,150.],[.4,.6])
        self.assertAlmostEqual(q['production_quote'],106.)
        self.assertAlmostEqual(q['mean'],q['production_quote']+q['contract_adjustment_sum'])

if __name__=='__main__':unittest.main()
