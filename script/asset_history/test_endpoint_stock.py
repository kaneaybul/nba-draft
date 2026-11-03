import copy,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from endpoint_stock import promote,promote_asset,STOCK_POLICY
from attribution_players import player_bridge,clock
from calibration.endpoint_model import pick_components,EndpointModel,endpoint_scenarios,production_quotes
from calibration.path_model import ResidualPool,summarize,weighted_quantile

class EndpointStockTests(unittest.TestCase):
    def test_pick_uses_endpoint_not_first_rookie_service(self):
        records=[dict(key=f'p{i}',slot=1+i%30,end=2020,value=100.,production=[1.]*4+[25.]*4)for i in range(60)]
        model=dict(endpoint_records=records,endpoint_training_through=2026,stock_policy=STOCK_POLICY)
        parts=pick_components(model,10,[2.]*4)
        self.assertAlmostEqual(parts['production_quote'],100.)
        self.assertAlmostEqual(parts['quote'],100.+.8*(4.-8.))
        model['endpoint_records'] += [dict(key=f'future{i}',slot=1+i%30,end=2025,value=1000.,production=[10.]*4+[250.]*4)for i in range(60)]
        self.assertAlmostEqual(pick_components(model,10,[2.]*4,draft_year=2022)['production_quote'],100.)

    def test_pick_option_floor_is_applied_per_outcome(self):
        records=[dict(key=f'p{i}',slot=10,end=2020,value=50.,production=[0.]*4+[12.5]*4,
                    endpoint_paths=[[0.]*4,[25.]*4],endpoint_weights=[.5,.5])for i in range(60)]
        model=dict(endpoint_records=records,endpoint_training_through=2026,stock_policy=STOCK_POLICY)
        result=pick_components(model,10,[10.]*4)
        self.assertAlmostEqual(result['quote'],.5*(100.-32.))
        self.assertAlmostEqual(result['floor_adjustment'],16.)
        self.assertGreater(result['quote'],max(0.,50.-32.))

    def player(self,name,production=100.,endpoint=True,financial=0.,draft=2023,grade_value=None):
        grade_value=production if grade_value is None else grade_value
        d=dict(peak_production=production,contract_adjustment=financial,draft_year=draft,
               annual_values=[dict(season=2027+i,production=production/4,asset=production/4+financial/4,exposure=1.)for i in range(4)])
        if endpoint:d.update(endpoint_stock_policy=STOCK_POLICY,rolling_production_quote=production,
            development_window_basis=production-grade_value,
            draft_development=dict(status='priced',method='year-four-production-endpoint-paths-v2',value=grade_value,original_expectation=100.,gain=grade_value-100.,endpoint=f'{draft+4}-07-31'))
        return dict(id=name,name=name,kind='player',value=production+financial,details=d)

    def context(self,points):
        h={p['date']:p for p in points}
        return dict(histories={'UTA':h},league={},owners={},events=[],contracts=[],caps={2027:(164961000.,200000000.)},market=None,
                    drafts={'rookie':dict(team='UTA',year=2023)},reviewed_trades=[])

    def test_daily_stock_retains_the_rolling_window(self):
        a=self.player('Rookie',100.,grade_value=130.)
        a['details']['annual_values']=[dict(season=2027+i,production=p,asset=p,exposure=1.)for i,p in enumerate([40.,30.,20.,10.])]
        a['value']=140.;a['details']['peak_production']=140.
        frozen=clock(a,{2027:.4,2028:1.,2029:1.,2030:1.,2031:.6})
        self.assertAlmostEqual(frozen['peak'],2*(.4*40+30+.6*20))
        self.assertNotEqual(frozen['peak'],130.)

    def test_draft_result_and_basis_each_telescope_once(self):
        dates=['2026-01-31','2026-02-28','2026-03-31','2026-04-30']
        points=[dict(date=day,assets=[self.player('Rookie',p,financial=-10.,grade_value=e)])
                for day,p,e in zip(dates,[100.,110.,120.,130.],[100.,90.,80.,70.])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),-30.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='timing'),60.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='contracts'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows),30.)

    def test_completed_endpoint_does_not_replace_daily_price(self):
        asset=self.player('Rookie',100.,endpoint=False,financial=-20.)
        asset['details']['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.,nba_weight=1.)
        promote_asset(asset,'2027-07-31');promote_asset(asset,'2027-07-31')
        self.assertEqual(asset['value'],80.)
        self.assertEqual(asset['details']['development_window_basis'],-30.)
        self.assertEqual(asset['details']['peak_production'],100.)

    def test_waiver_separates_endpoint_basis_and_financial_claim(self):
        other=self.player('Veteran',100.,endpoint=False,draft=2010)
        points=[dict(date='2026-01-31',assets=[other,self.player('Rookie',70.,financial=-10.,grade_value=90.)]),
                dict(date='2026-02-28',assets=[other])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        for category,want in [('draft',-90.),('timing',20.),('contracts',10.)]:
            self.assertAlmostEqual(sum(r['value']for r in rows if r['category']==category),want)

    def test_unsupported_cohort_is_not_labeled_endpoint_draft_value(self):
        points=[dict(date='2026-01-31',assets=[self.player('Rookie',100.,endpoint=False)]),
                dict(date='2026-02-28',assets=[self.player('Rookie',90.,endpoint=False)])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        self.assertEqual(sum(r['value']for r in rows if r['category']=='draft'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='player'),-10.)

    def test_salary_cannot_change_endpoint_gain_or_daily_production(self):
        d=self.player('Rookie',100.,endpoint=False,financial=-20.)['details']
        d['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.)
        self.assertEqual(promote(d,80.,'2026-11-03'),80.)
        self.assertEqual(d['draft_development']['gain'],30.)
        self.assertEqual(d['contract_adjustment'],-20.)

    def test_linked_endpoint_paths_are_priced_before_averaging(self):
        feature=[22.,0.,1.,2.]
        rows=[dict(key='a',origin=2016,horizon=4,feature=feature,residual=[10.,-10.,10.,-10.]),
              dict(key='b',origin=2016,horizon=4,feature=feature,residual=[-10.,10.,-10.,10.]),
              dict(key='future',origin=2020,horizon=4,feature=feature,residual=[1e8]*4)]
        paths,w,values,audit=endpoint_scenarios([10.]*4,feature,2020,ResidualPool(rows),'target')
        np.testing.assert_allclose(w@paths,[10.]*4)
        self.assertAlmostEqual(w@values,80.)
        self.assertEqual(production_quotes(w@paths)[0],40.)
        self.assertEqual(audit['latest_label'],2020)
        self.assertEqual(audit['n'],2)
        self.assertTrue(all(np.count_nonzero(p)==2 for p in paths))

    def test_early_prefix_extension_is_explicit_and_no_future_errors_enter(self):
        feature=[22.,0.,1.,2.]
        rows=[dict(key='a',origin=2017,horizon=8,feature=feature,residual=[2.,99.,99.,99.,99.,99.,99.,99.]),
              dict(key='b',origin=2017,horizon=1,feature=feature,residual=[-2.])]
        paths,w,values,audit=endpoint_scenarios([10.]*7,feature,2018,ResidualPool(rows),offset=3)
        self.assertEqual(audit['observed_error_horizon'],1)
        self.assertEqual(audit['requested_error_horizon'],7)
        self.assertEqual(audit['latest_label'],2018)
        np.testing.assert_allclose(paths,[[12.]*4,[8.]*4])

    def test_zero_weight_scenarios_do_not_change_quantiles(self):
        self.assertEqual(weighted_quantile([10.,1e9],[1.,0.]),[10.,10.,10.])

if __name__=='__main__':unittest.main()
