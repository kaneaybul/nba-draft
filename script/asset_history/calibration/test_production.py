import copy,sys,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from calibration.production import PathCalibrator,REPORTING_CAP
from calibration.path_model import ResidualPool
from calibration.endpoint_paths import EndpointRevisionPool
from calibration.endpoint_model import own_endpoint_path


def fixture():
    c=PathCalibrator.__new__(PathCalibrator)
    c.data={'signature':'fixture','training_through':2024};c.rates={};c.events={k:0 for k in ('priced','insufficient_mature_career_paths','insufficient_completed_residual_paths','unsigned_draft_right_existing_policy')}
    c.rate=lambda cutoff:dict(n=60,scale=100.,latest_label=cutoff)
    c.stats={(2024,7):1000.};c.ages={(2024,7):22.};c.experience={(2024,7):1.}
    c.bref={};c.observations={('2024-11-01',7):100.};c.observation_seasons={('2024-11-01',7):2025};c.agreements={7:[]};c.pick_curve={1:dict(peak_production_quote=80.,cumulative_production_quote=40.)}
    c.careers=[dict(key=str(i),slot=1,cohort=2016,stage=0,horizon=4,
                   production=p)for i,p in enumerate(([20,20,0,0],[0,0,20,20]))]
    c.endpoint=SimpleNamespace(prior=lambda *args:dict(paths=np.array([[20,20,0,0,10,10,10,10],[0,0,20,20,10,10,10,10]]),
        weights=np.array([.5,.5]),scale=1.,latest_label=2020))
    c.pick_curve[1]['quote']=112.
    c.residuals=ResidualPool([dict(key=str(i),origin=2020,horizon=4,feature=[22,0,2.7,1],residual=r)
        for i,r in enumerate(([10,10,-10,-10],[-10,-10,10,10]))])
    c.endpoint_residuals=EndpointRevisionPool([dict(key=str(i),origin=2020,lead=lead,label_end=2020+lead,feature=[22,0,2.7,1],residual=r)
        for lead in (1,2,3,4) for i,r in enumerate(([10,10,-10,-10],[-10,-10,10,10]))])
    c.contracts=None;c.runtime=None;c.endpoint_states={}
    p=dict(draft_year='2023',draft_slot='1',player_name='Fixture',source_nba_id='7',cutoff_date='2024-11-01',
           healthy_current_total='0',healthy_forecast_annual_games='70',healthy_forecast_conditional_MPG='20')
    a=[dict(season=str(2025+i),league_reference_year='2024',exposure='1',annual_production='10',
        availability_overlay='1',app_effective_contract='5',salary_cap_scenario=str(REPORTING_CAP),
        scale_budget_scenario=str(REPORTING_CAP),is_unsigned_market_year='False',
        app_annual_quote_production_reporting_rate='10',app_annual_stock_reporting_rate='14')for i in range(4)]
    return c,p,a


class ProductionQuotes(unittest.TestCase):
    def setUp(self):
        def endpoint(player,annual,draft,*args,**kwargs):
            rates={int(r['season']):float(r['app_annual_quote_production_reporting_rate'])for r in annual}
            return [rates.get(y,10.)for y in range(draft+5,draft+9)]
        mock=patch('calibration.production.own_endpoint_path',side_effect=endpoint)
        mock.start();self.addCleanup(mock.stop)

    def test_zero_growth_anchor_cannot_erase_positive_published_production(self):
        c,p,a=fixture()
        annual=[dict(season=2027+i,annual_production=10.,salary_cap_scenario=REPORTING_CAP,
                     scale_budget_scenario=REPORTING_CAP,league_timin=1e6,replacement=0.)for i in range(5)]
        engine=SimpleNamespace(AnnualState=lambda *args:SimpleNamespace(season=args[0]),
            project_path=lambda s,h,n:[SimpleNamespace(season=s.season+j,total=0.,minutes=0.)for j in range(n+1)])
        audit={}
        with patch.dict(sys.modules,{'valuation_engine':engine}):
            self.assertEqual(own_endpoint_path(p,annual,2024,{},None,audit),[10,10,10,10])
        self.assertEqual(audit['method'],'flat_last_positive_raw_rate')
        self.assertEqual(audit['extended_seasons'],[2032])

    def test_endpoint_uses_raw_own_production_even_if_contract_choices_zero_asset_rates(self):
        annual=[dict(season=2028+i,annual_production=10*(i+1),salary_cap_scenario=REPORTING_CAP,
                     app_annual_quote_production_reporting_rate=0,app_effective_contract=1e9)for i in range(4)]
        engine=SimpleNamespace(AnnualState=None,project_path=None)
        with patch.dict(sys.modules,{'valuation_engine':engine}):
            self.assertEqual(own_endpoint_path({},annual,2023,{},None),[10,20,30,40])
            for r in annual:r['app_effective_contract']=1
            self.assertEqual(own_endpoint_path({},annual,2023,{},None),[10,20,30,40])

    def test_completed_draft_endpoint_does_not_roll_with_new_forecasts(self):
        c,p,a=fixture();p.update(draft_year='2022',app_style_four_year_peak_production_quote='170')
        for row in a:row['league_reference_year']='2026'
        c.endpoint=SimpleNamespace(prior=lambda slot,cutoff,key,**kwargs:dict(value=100.,latest_label=2021),
            distribution=lambda *args:(np.array([100.]),np.array([1.])))
        c.data['endpoint_records']=[dict(key='fixture',cohort=2022,value=170.,endpoint=[40,40,45,35],
            endpoint_paths=[[40,40,45,35]],endpoint_weights=[1.],endpoint_audit={'latest_label':2026})]
        before=c.draft_evaluation(p,a)
        for row in a:row['annual_production']='999999999'
        after=c.draft_evaluation(p,a)
        self.assertEqual(before,after)
        self.assertEqual(after['gain'],70.)
        self.assertEqual(after['contract_effect'],0.)

    def test_dormant_right_keeps_its_price_but_completes_the_draft_grade(self):
        c,p,a=fixture();p.update(draft_year='2022',asset_type='unsigned_draft_right',
            app_style_four_year_asset_quote_with_draft_prior='112',app_style_four_year_peak_production_quote='80')
        for row in a:row['league_reference_year']='2026'
        c.endpoint=SimpleNamespace(prior=lambda *args,**kw:dict(value=100.,latest_label=2021))
        c.data['endpoint_records']=[dict(key='fixture',cohort=2022,value=0.,endpoint=[0.]*4,endpoint_audit={'latest_label':2026})]
        result=c.quote(p,a)
        self.assertEqual(result['value'],112.)
        self.assertEqual(result['production_quote'],80.)
        self.assertEqual(result['draft_development']['gain'],-20.)
        self.assertTrue(result['draft_development']['completed'])
        self.assertEqual(result['draft_development']['contract_effect'],0.)

    def test_draft_grade_uses_the_shared_player_quote_and_separates_salary(self):
        c,p,a=fixture();c.runtime=None;c.endpoint_states={}
        c.endpoint=SimpleNamespace(prior=lambda *args,**kwargs:dict(value=40.,latest_label=2021),
            distribution=lambda *args:(np.array([40.]),np.array([1.])))
        c.rate=lambda cutoff:dict(n=60,scale=100.,latest_label=cutoff)
        shared=dict(status='priced',production_quote=90.,nba_weight=.8)
        result=c.draft_evaluation(p,a,shared)
        for row in a:row['app_effective_contract']='1000000000'
        self.assertEqual(c.draft_evaluation(p,a,shared),result)
        self.assertAlmostEqual(result['value'],90.)
        self.assertAlmostEqual(result['gain'],50.)
        self.assertEqual(result['contract_effect'],0.)
        self.assertLess(result['baseline_latest_label'],int(p['draft_year']))

    def test_expected_peak_survives_the_exported_annual_means(self):
        c,p,a=fixture();result=c.quote(p,a)
        self.assertAlmostEqual(result['mean'],92.66666666666667)
        self.assertAlmostEqual(result['mean_path_quote'],56.)
        self.assertAlmostEqual(result['path_selection_premium'],30.)
        self.assertAlmostEqual(result['draft_prior_adjustment'],6.666666666666667)
        self.assertAlmostEqual(result['production_quote']+result['contract_adjustment_sum'],92.66666666666667)
        self.assertAlmostEqual(sum((r['asset']-r['production'])*r['exposure']for r in result['annual_values']),result['contract_adjustment_sum'])

    def test_observed_minutes_update_reliability_and_veterans_keep_the_old_policy(self):
        c,p,a=fixture();first=c.quote(p,a)
        c.observations[p['cutoff_date'],7]=600.
        self.assertGreater(c.quote(p,a)['nba_weight'],first['nba_weight'])
        p['draft_year']='2020'
        self.assertIsNone(c.quote(p,a))

    def test_completed_season_minutes_are_not_counted_again_in_offseason(self):
        c,p,a=fixture();c.observation_seasons[p['cutoff_date'],7]=2024
        c.observations[p['cutoff_date'],7]=1000.
        result=c.quote(p,a)
        self.assertEqual(result['completed_minutes'],1000.)
        self.assertEqual(result['current_observed_minutes'],0.)
        self.assertAlmostEqual(result['nba_weight'],1000./1100.)

    def test_last_development_season_continuously_reaches_the_normal_quote(self):
        c,p,a=fixture()
        base=dict(a[0],league_reference_year='2026')
        a=[dict(base,season=str(2027+i),exposure='1')for i in range(5)]
        a[0]['exposure']='0.000001';a[-1]['exposure']='0.999999'
        shared=c.quote(p,a)
        self.assertGreater(shared['nba_weight'],.99999)
        self.assertAlmostEqual(shared['mean'],56.,places=3)
        a=a[1:]
        a[-1]['exposure']='1'
        self.assertIsNone(c.quote(p,a))

    def test_first_season_updates_the_endpoint_with_verified_nba_evidence(self):
        c,p,a=fixture();p['draft_year']='2024';c.observations[p['cutoff_date'],7]=2000.
        for row in c.careers:row['stage']=0
        c.pick_curve[1]=dict(peak_production_quote=80.,cumulative_production_quote=40.)
        result=c.quote(p,a)
        self.assertGreater(result['nba_weight'],0.)
        self.assertEqual(result['current_observed_minutes'],2000.)
        c.observations[p['cutoff_date'],7]=0.
        self.assertEqual(c.quote(p,a)['nba_weight'],0.)

    def test_known_absence_preserves_signed_cost(self):
        c,p,a=fixture();a[0].update(availability_overlay='0',annual_production='0',app_effective_contract='10')
        result=c.quote(p,a)
        self.assertEqual(result['annual_values'][0]['production'],0.)
        self.assertAlmostEqual(result['annual_values'][0]['asset'],-8.)

    def test_historical_prior_center_does_not_use_a_later_generic_pick_fit(self):
        c,p,a=fixture();p['draft_year']='2024';c.data['training_through']=2026
        for row in c.careers:row['stage']=0
        c.pick_curve[1]=dict(peak_production_quote=1e9,cumulative_production_quote=1e9)
        first=c.quote(p,a)['mean']
        c.pick_curve[1]=dict(peak_production_quote=1e6,cumulative_production_quote=1e6)
        self.assertEqual(c.quote(p,a)['mean'],first)

    def test_release_uses_guarantee_but_good_scenarios_pay_full_salary(self):
        c,p,a=fixture();a[0]['app_effective_contract']='10'
        cells=[dict(year=2025,amount=10,waiver_option_verified=True,waiver_guaranteed_amount_asof=2.)]
        with patch('calibration.production.agreements_at',return_value=(cells,True,None)),patch('calibration.production.development_weight',return_value=1.):
            result=c.quote(p,a)
        self.assertAlmostEqual(result['annual_mean_cost'][0],6.)
        self.assertAlmostEqual(result['annual_mean_production'][0],10.)

    def test_immature_residual_labels_cannot_price_a_historical_snapshot(self):
        c,p,a=fixture()
        for row in c.residuals.rows:row['origin']=2022
        self.assertEqual(c.quote(p,a)['status'],'insufficient_completed_residual_paths')

    def test_post_rookie_years_keep_the_canonical_means_and_contract_choices(self):
        c,p,a=fixture();result=c.quote(p,a)
        self.assertEqual(result['annual_values'][-1]['production'],10.)
        self.assertEqual(result['annual_values'][-1]['asset'],14.)

    def test_zero_game_role_can_have_undefined_conditional_mpg(self):
        c,p,a=fixture();p['healthy_forecast_annual_games']='0';p['healthy_forecast_conditional_MPG']=''
        a[0]['annual_production']='0'
        self.assertEqual(c.quote(p,a)['status'],'priced')
        p['healthy_forecast_annual_games']='70'
        with self.assertRaisesRegex(ValueError,'require conditional MPG'):c.quote(p,a)

    def test_dormant_draft_right_keeps_its_existing_quote_without_an_nba_identity(self):
        c,p,a=fixture();p['asset_type']='unsigned_draft_right';p['source_nba_id']=''
        self.assertEqual(c.quote(p,a)['status'],'unsigned_draft_right_existing_policy')
        self.assertEqual(c.events['unsigned_draft_right_existing_policy'],1)
        p['draft_year']='2010'
        self.assertIsNone(c.quote(p,a))
        p['draft_year']='2023'
        p['asset_type']='signed_player'
        with self.assertRaisesRegex(ValueError,'stable identity'):c.quote(p,a)

    def test_aging_out_has_no_discrete_uncertainty_premium_drop(self):
        c,p,a=fixture();c.data['training_through']=2026
        for row in a:row['league_reference_year']='2026'
        a[0].update(season='2027',exposure='0.000001')
        for i,row in enumerate(a[1:],1):row['season']=str(2027+i)
        a.append({**a[-1],'season':'2031','exposure':'0.999999'})
        for r in c.residuals.rows:r['horizon']=5;r['residual'].append(r['residual'][0])
        result=c.quote(p,a)
        self.assertAlmostEqual(result['mean'],56.,places=3)


if __name__=='__main__':unittest.main()


