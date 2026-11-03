import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from endpoint_stock import promote,promote_asset,STOCK_POLICY
from attribution_players import player_bridge,clock
from calibration.endpoint_model import pick_components,EndpointModel

class EndpointStockTests(unittest.TestCase):
    def test_pick_uses_endpoint_not_first_rookie_service(self):
        records=[dict(key=f'p{i}',slot=1+i%30,end=2020,value=100.,production=[1.,1.,1.,1.,25.,25.,25.,25.])for i in range(60)]
        model=dict(endpoint_records=records,endpoint_training_through=2026,stock_policy=STOCK_POLICY)
        parts=pick_components(model,10,[2.]*4)
        self.assertAlmostEqual(parts['production_quote'],100.)
        self.assertAlmostEqual(parts['quote'],100.+.8*(4.-8.))
        self.assertNotAlmostEqual(parts['production_quote'],4.)
        model['endpoint_records']+= [dict(key=f'future{i}',slot=1+i%30,end=2025,value=1000.,production=[10.]*4+[250.]*4)for i in range(60)]
        self.assertAlmostEqual(pick_components(model,10,[2.]*4,draft_year=2022)['production_quote'],100.)

    def player(self,name,production=100.,endpoint=True,financial=0.,draft=2023):
        d=dict(peak_production=production,contract_adjustment=financial,draft_year=draft,
               annual_values=[dict(season=2027+i,production=25.,asset=25.+financial/4,exposure=1.)for i in range(4)])
        if endpoint:d.update(endpoint_stock_policy=STOCK_POLICY,rolling_production_quote=100.)
        return dict(id=name,name=name,kind='player',value=production+financial,details=d)

    def context(self,points):
        h={p['date']:p for p in points}
        return dict(histories={'UTA':h},league={},owners={},events=[],contracts=[],caps={2027:(164961000.,200000000.)},market=None,
                    drafts={'rookie':dict(team='UTA',year=2023)},reviewed_trades=[])

    def test_time_alone_does_not_create_draft_loss(self):
        a=self.player('Rookie',130.)
        frozen=clock(a,{2027:.4,2028:1.,2029:1.,2030:1.,2031:.6})
        self.assertEqual(frozen['peak'],130.)
        self.assertEqual(frozen['value'],130.)

    def test_draft_outcome_telescopes_once_and_salary_stays_separate(self):
        dates=['2026-01-31','2026-02-28','2026-03-31','2026-04-30']
        values=[100.,90.,80.,70.];points=[]
        for day,value in zip(dates,values):points.append(dict(date=day,assets=[self.player('Rookie',value,financial=-10.)]))
        book=player_bridge('UTA',self.context(points));rows=book['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),-30.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='contracts'),0.)
        self.assertTrue(all(r['component']=='Year-four endpoint valuation change'for r in rows if r['category']=='draft'))

    def test_completed_endpoint_handoff_is_explicit_timing(self):
        points=[dict(date='2027-07-31',assets=[self.player('Rookie',120.)]),
                dict(date='2027-08-31',assets=[self.player('Rookie',100.,endpoint=False)])]
        book=player_bridge('UTA',self.context(points));rows=book['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='timing'),-20.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']in('draft','player')),0.)

    def test_waived_draft_rights_charge_production_to_draft_not_contracts(self):
        other=self.player('Veteran',100.,endpoint=False,draft=2010)
        points=[dict(date='2026-01-31',assets=[other,self.player('Rookie',70.,financial=-10.)]),
                dict(date='2026-02-28',assets=[other])]
        book=player_bridge('UTA',self.context(points));rows=book['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),-70.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='contracts'),10.)

    def test_publication_promotes_the_exact_completed_endpoint_once(self):
        asset=self.player('Rookie',100.,endpoint=False,financial=-20.)
        asset['details']['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.,nba_weight=1.)
        promote_asset(asset,'2027-07-31');promote_asset(asset,'2027-07-31')
        self.assertEqual(asset['value'],110.)
        self.assertEqual(asset['details']['path_calibration']['mean'],110.)
        self.assertEqual(asset['details']['path_calibration']['mean_path_quote'],80.)

    def test_unsupported_archived_cohort_is_not_labeled_endpoint_draft_value(self):
        points=[dict(date='2026-01-31',assets=[self.player('Rookie',100.,endpoint=False)]),
                dict(date='2026-02-28',assets=[self.player('Rookie',90.,endpoint=False)])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        self.assertEqual(sum(r['value']for r in rows if r['category']=='draft'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='player'),-10.)

    def test_salary_cannot_change_endpoint_gain(self):
        d=self.player('Rookie',100.,endpoint=False,financial=-20.)['details']
        d['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.)
        self.assertEqual(promote(d,80.,'2026-11-03'),110.)
        self.assertEqual(d['draft_development']['gain'],30.)
        self.assertEqual(d['contract_adjustment'],-20.)

if __name__=='__main__':unittest.main()
