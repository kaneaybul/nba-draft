import copy,sys,unittest
from pathlib import Path
import numpy as np
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from endpoint_stock import promote,promote_asset,freeze_draft_results,STOCK_POLICY
from attribution_players import player_bridge,clock
from quote_window import quote_window
from calibration.endpoint_model import pick_components,EndpointModel,production_quotes
from calibration.path_model import ResidualPool,summarize,weighted_quantile
from calibration.endpoint_paths import EndpointRevisionPool

class EndpointStockTests(unittest.TestCase):
    def test_pick_uses_endpoint_not_first_rookie_service(self):
        records=[dict(key=f'p{i}',slot=1+i%30,end=2020,value=100.,production=[1.]*4+[25.]*4)for i in range(60)]
        model=dict(endpoint_records=records,endpoint_training_through=2026,stock_policy=STOCK_POLICY)
        parts=pick_components(model,10,[2.]*4)
        self.assertAlmostEqual(parts['production_quote'],100.)
        self.assertAlmostEqual(parts['quote'],100.+.8*(4.-8.))
        model['endpoint_records'] += [dict(key=f'future{i}',slot=1+i%30,end=2025,value=1000.,production=[10.]*4+[250.]*4)for i in range(60)]
        self.assertAlmostEqual(pick_components(model,10,[2.]*4,draft_year=2022)['production_quote'],100.)

    def test_pick_floor_cannot_erase_negative_career_payoffs(self):
        records=[dict(key=f'p{i}',slot=10,end=2020,value=50.,production=[0.]*4+[12.5]*4,
                    endpoint_paths=[[0.]*4,[25.]*4],endpoint_weights=[.5,.5])for i in range(60)]
        model=dict(endpoint_records=records,endpoint_training_through=2026,stock_policy=STOCK_POLICY)
        result=pick_components(model,10,[10.]*4)
        self.assertAlmostEqual(result['quote'],.5*(-32.)+.5*(100.-32.))
        self.assertAlmostEqual(result['floor_adjustment'],0.)
        self.assertLess(result['quote'],.5*(100.-32.))

    def player(self,name,production=100.,endpoint=True,financial=0.,draft=2023,grade_value=None):
        grade_value=production if grade_value is None else grade_value
        d=dict(peak_production=production,contract_adjustment=financial,draft_year=draft,
               annual_values=[dict(season=2027+i,production=production/4,asset=production/4+financial/4,exposure=1.)for i in range(4)])
        if endpoint:d.update(endpoint_stock_policy=STOCK_POLICY,rolling_production_quote=production,
            development_window_basis=production-grade_value,
            draft_development=dict(status='priced',method='year-four-assessed-production-paths-v3',value=grade_value,original_expectation=100.,gain=grade_value-100.,endpoint=f'{draft+4}-07-31'))
        return dict(id=name,name=name,kind='player',value=production+financial,details=d)

    def context(self,points):
        h={p['date']:p for p in points}
        return dict(histories={'UTA':h},league={},owners={},events=[],contracts=[],caps={2027:(164961000.,200000000.)},market=None,
                    drafts={'rookie':dict(team='UTA',year=2023)},reviewed_trades=[])

    def test_clock_alone_does_not_regrade_a_padded_draftee(self):
        a=self.player('Rookie',100.,grade_value=130.)
        a['details']['annual_values']=[dict(season=2027+i,production=p,asset=p,exposure=1.)for i,p in enumerate([40.,30.,20.,10.])]
        a['value']=140.;a['details']['peak_production']=140.
        frozen=clock(a,{2027:.4,2028:1.,2029:1.,2030:1.,2031:.6})
        self.assertAlmostEqual(frozen['peak'],140.)
        self.assertNotEqual(frozen['peak'],130.)

    def test_shared_draft_changes_telescope_once_without_a_basis_adjustment(self):
        dates=['2026-01-31','2026-02-28','2026-03-31','2026-04-30']
        points=[dict(date=day,assets=[self.player('Rookie',p,financial=-10.,grade_value=e)])
                for day,p,e in zip(dates,[100.,110.,120.,130.],[100.,90.,80.,70.])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),30.)
        self.assertFalse(any(r['category']=='timing'for r in rows))
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='contracts'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows),30.)

    def test_acquired_draftee_keeps_development_category_and_original_clock(self):
        points=[dict(date='2026-01-31',assets=[self.player('Rookie',65.)]),
                dict(date='2026-02-28',assets=[self.player('Rookie',80.)])]
        ctx=self.context(points);ctx['drafts']['rookie']['team']='BOS'
        rows=player_bridge('UTA',ctx)['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),15.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='player'),0.)
        for p in points:
            for a in p['assets']:a['details']['draft_year']=2021
        rows=player_bridge('UTA',ctx)['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='player'),15.)

    def test_contract_transition_cannot_manufacture_offsetting_draft_loss(self):
        points=[dict(date=day,assets=[self.player('Rookie',100.)])
                for day in ('2026-01-31','2026-02-28')]
        ctx=self.context(points)
        ctx['contracts']=[dict(player_name='Rookie',known_from='2026-02-15',contract_type='TWO-WAY')]
        ctx['market']=SimpleNamespace(expected=lambda *args:(1e9,None,None))
        ctx['caps'][2026]=(154647000.,190000000.)
        with patch('attribution_players.agreements_at',return_value=([],False,None)):
            rows=player_bridge('UTA',ctx)['attribution']
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='draft'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='contracts'),0.)

    def test_trade_transfers_shared_price_and_splits_development_between_owners(self):
        dates=['2026-01-31','2026-02-28','2026-03-31']
        seller=[dict(date=d,assets=[self.player('Veteran',100.,endpoint=False,draft=2010)]+
                    ([self.player('Rookie',p)]if p is not None else []))for d,p in zip(dates,[50.,65.,None])]
        buyer=[dict(date=d,assets=[self.player('Other',100.,endpoint=False,draft=2010)]+
                    ([self.player('Rookie',80.)]if d==dates[-1]else []))for d in dates]
        ctx=self.context(seller);ctx['histories']['BOS']={p['date']:p for p in buyer}
        ctx['events']=[dict(event_id='trade',date='2026-03-15',parsed_status='trade',
                            text='Trade Rookie from UTA to BOS',players=[dict(name='Rookie')])]
        for team,h in ctx['histories'].items():
            for day,snapshot in h.items():
                for a in snapshot['assets']:
                    ctx['league'][day,a['id']]=a;ctx['owners'][day,a['id']]=team
        totals={}
        for team in ('UTA','BOS'):
            rows=player_bridge(team,ctx)['attribution']
            totals[team]={k:sum(r['value']for r in rows if r['category']==k)for k in ('draft','trades','player')}
        self.assertEqual(totals['UTA'],dict(draft=15.,trades=-65.,player=0.))
        self.assertEqual(totals['BOS'],dict(draft=15.,trades=65.,player=0.))

    def test_completed_endpoint_does_not_replace_daily_price(self):
        asset=self.player('Rookie',100.,endpoint=False,financial=-20.)
        asset['details']['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.,nba_weight=1.)
        promote_asset(asset,'2027-07-31');promote_asset(asset,'2027-07-31')
        self.assertEqual(asset['value'],80.)
        self.assertNotIn('development_window_basis',asset['details'])
        self.assertEqual(asset['details']['draft_development']['value'],100.)
        self.assertEqual(asset['details']['peak_production'],100.)

    def test_waiver_separates_endpoint_basis_and_financial_claim(self):
        other=self.player('Veteran',100.,endpoint=False,draft=2010)
        points=[dict(date='2026-01-31',assets=[other,self.player('Rookie',70.,financial=-10.,grade_value=90.)]),
                dict(date='2026-02-28',assets=[other])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        for category,want in [('draft',-70.),('contracts',10.)]:
            self.assertAlmostEqual(sum(r['value']for r in rows if r['category']==category),want)

    def test_unsupported_cohort_is_not_labeled_endpoint_draft_value(self):
        points=[dict(date='2026-01-31',assets=[self.player('Rookie',100.,endpoint=False)]),
                dict(date='2026-02-28',assets=[self.player('Rookie',90.,endpoint=False)])]
        rows=player_bridge('UTA',self.context(points))['attribution']
        self.assertEqual(sum(r['value']for r in rows if r['category']=='draft'),0.)
        self.assertAlmostEqual(sum(r['value']for r in rows if r['category']=='player'),-10.)

    def test_player_development_measures_revisions_to_the_opening_forecast(self):
        def veteran(rates, exposures, annual_contract_adjustment):
            assets = [rate + annual_contract_adjustment for rate in rates]
            quote = quote_window(rates, assets, exposures)
            player = self.player('Veteran', quote['production_quote'], endpoint=False,
                                 financial=quote['contract_adjustment_sum'])
            player['details']['annual_values'] = [
                dict(season=2027+i, production=rate, asset=asset, exposure=exposure)
                for i, (rate, asset, exposure) in enumerate(zip(rates, assets, exposures))
            ]
            return player

        opening = dict(date='2026-10-31', assets=[veteran([40.,30.,20.,10.], [1.]*4, -2.)])
        for revision in (-1., 0., 1.):
            with self.subTest(revision=revision):
                closing = dict(date='2026-11-30', assets=[veteran(
                    [rate+revision for rate in [40.,30.,20.,10.,10.]], [.5,1.,1.,1.,.5], -3.)])
                rows = player_bridge('UTA', self.context([opening, closing]))['attribution']
                amounts = {key: sum(r['value'] for r in rows if r['category'] == key)
                           for key in ('aging', 'player', 'draft', 'contracts')}
                self.assertEqual(amounts, dict(aging=-20., player=4.*revision, draft=0., contracts=-4.))

    def test_unsigned_quote_flag_still_receives_complete_basis_metadata(self):
        asset=self.player('Rookie',100.,endpoint=False,financial=10.)
        asset['details'].update(endpoint_stock_policy=STOCK_POLICY,
            draft_development=dict(status='priced',endpoint='2027-07-31',value=100.,original_expectation=100.,gain=0.))
        promote_asset(asset,'2026-11-03');promote_asset(asset,'2026-11-03')
        self.assertEqual(asset['value'],110.)
        self.assertNotIn('development_window_basis',asset['details'])

    def test_salary_cannot_change_endpoint_gain_or_daily_production(self):
        d=self.player('Rookie',100.,endpoint=False,financial=-20.)['details']
        d['draft_development']=dict(status='priced',endpoint='2027-07-31',value=130.,original_expectation=100.,gain=30.)
        self.assertEqual(promote(d,80.,'2026-11-03'),80.)
        self.assertEqual(d['draft_development']['gain'],0.)
        self.assertEqual(d['contract_adjustment'],-20.)

    def test_year_four_grade_freezes_across_a_transfer_and_daily_refresh(self):
        early=self.player('Rookie',100.,draft=2022,grade_value=999.)
        final=self.player('Rookie',150.,draft=2022,grade_value=999.)
        later=self.player('Rookie',200.,draft=2022,grade_value=999.)
        final['details']['draft_development']['completed']=True
        rows=[dict(team='UTA',date='2026-06-30',assets=[early]),
              dict(team='BOS',date='2026-07-31',assets=[final]),
              dict(team='BOS',date='2026-08-31',assets=[later])]
        saved=freeze_draft_results(rows)
        self.assertEqual(final['details']['draft_development']['value'],150.)
        self.assertEqual(later['details']['draft_development']['value'],150.)
        self.assertEqual(later['value'],200.)
        daily=self.player('Rookie',220.,draft=2022,grade_value=999.)
        freeze_draft_results([dict(date='2026-09-30',assets=[daily])],saved)
        self.assertEqual(daily['details']['draft_development']['gain'],50.)
        self.assertEqual(daily['value'],220.)

    def revision_pool(self):
        feature=[22.,0.,1.,2.]
        return feature,EndpointRevisionPool([
            dict(key='a',origin=2017,lead=3,label_end=2020,feature=feature,residual=[10.,-10.,10.,-10.]),
            dict(key='b',origin=2017,lead=3,label_end=2020,feature=feature,residual=[-10.,10.,-10.,10.]),
            dict(key='future',origin=2019,lead=3,label_end=2022,feature=feature,residual=[1e8]*4),
            dict(key='target',origin=2017,lead=3,label_end=2020,feature=feature,residual=[1e9]*4)])

    def test_linked_endpoint_appraisals_are_priced_before_averaging(self):
        feature,pool=self.revision_pool()
        paths,w,audit=pool.scenarios([10.]*4,feature,2020,3.,'target')
        np.testing.assert_allclose(w@paths,[10.]*4)
        self.assertAlmostEqual(w@production_quotes(paths),80.)
        self.assertEqual(production_quotes(w@paths)[0],40.)
        self.assertEqual(audit['latest_label'],2020)
        self.assertEqual(audit['n'],2)
        self.assertTrue(all(np.count_nonzero(p)==2 for p in paths))

    def test_below_replacement_forecast_retains_development_upside(self):
        feature=[22.,0.,1.,2.]
        pool=EndpointRevisionPool([
            dict(key='a',origin=2017,lead=1,label_end=2018,feature=feature,residual=[20.]*4),
            dict(key='b',origin=2017,lead=1,label_end=2018,feature=feature,residual=[-20.]*4)])
        paths,w,audit=pool.scenarios([-10.]*4,feature,2020,1.)
        np.testing.assert_allclose(w@paths,[-10.]*4)
        self.assertAlmostEqual(w@production_quotes(paths),20.)
        self.assertEqual(production_quotes(w@paths)[0],0.)

    def test_development_uncertainty_fades_to_the_known_mature_quote(self):
        feature=[22.,0.,1.,2.]
        pool=EndpointRevisionPool([
            dict(key='a',origin=2017,lead=1,label_end=2018,feature=feature,residual=[10.,-10.,10.,-10.]),
            dict(key='b',origin=2017,lead=1,label_end=2018,feature=feature,residual=[-10.,10.,-10.,10.])])
        means=[]
        for remaining in [1.,.5,.01,0.]:
            paths,w,audit=pool.scenarios([10.]*4,feature,2020,remaining)
            means.append(float(w@production_quotes(paths)))
            np.testing.assert_allclose(w@paths,[10.]*4)
        np.testing.assert_allclose(means,[80.,60.,40.4,40.])
        # The completed endpoint uses the existing mature forecast appraisal.
        # Unknown actual production after that endpoint is not another premium.
        self.assertEqual(means[-1],production_quotes([10.]*4)[0])

    def test_zero_weight_scenarios_do_not_change_quantiles(self):
        self.assertEqual(weighted_quantile([10.,1e9],[1.,0.]),[10.,10.,10.])

if __name__=='__main__':unittest.main()

