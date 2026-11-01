import copy,sys,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from calibration.production import PathCalibrator,REPORTING_CAP
from calibration.path_model import ResidualPool


def fixture():
    c=PathCalibrator.__new__(PathCalibrator)
    c.data={'signature':'fixture'};c.rates={};c.events={k:0 for k in ('priced','insufficient_mature_career_paths','insufficient_completed_residual_paths')}
    c.rate=lambda cutoff:dict(n=60,scale=100.,latest_label=cutoff)
    c.stats={(2024,7):1000.};c.ages={(2024,7):22.};c.experience={(2024,7):1.}
    c.bref={};c.observations={('2024-11-01',7):100.};c.agreements={7:[]};c.pick_curve={}
    c.careers=[dict(key=str(i),slot=1,cohort=2016,stage=1,horizon=4,
                   production=p)for i,p in enumerate(([20,20,0,0],[0,0,20,20]))]
    c.residuals=ResidualPool([dict(key=str(i),origin=2020,horizon=4,feature=[22,0,2.7,1],residual=r)
        for i,r in enumerate(([10,10,-10,-10],[-10,-10,10,10]))])
    c.contracts=None
    p=dict(draft_year='2023',draft_slot='1',player_name='Fixture',source_nba_id='7',cutoff_date='2024-11-01',
           healthy_current_total='0',healthy_forecast_annual_games='70',healthy_forecast_conditional_MPG='20')
    a=[dict(season=str(2025+i),league_reference_year='2024',exposure='1',annual_production='10',
        availability_overlay='1',app_effective_contract='5',salary_cap_scenario=str(REPORTING_CAP),
        scale_budget_scenario=str(REPORTING_CAP),is_unsigned_market_year='False')for i in range(4)]
    return c,p,a


class ProductionQuotes(unittest.TestCase):
    def test_expected_peak_survives_the_exported_annual_means(self):
        c,p,a=fixture();result=c.quote(p,a)
        self.assertAlmostEqual(result['mean'],96.)
        self.assertAlmostEqual(result['mean_path_quote'],56.)
        self.assertAlmostEqual(result['path_selection_premium'],40.)
        self.assertAlmostEqual(result['production_quote']+result['contract_adjustment_sum'],96.)
        self.assertAlmostEqual(sum((r['asset']-r['production'])*r['exposure']for r in result['annual_values']),result['contract_adjustment_sum'])

    def test_observed_minutes_update_reliability_and_veterans_keep_the_old_policy(self):
        c,p,a=fixture();first=c.quote(p,a)
        c.observations[p['cutoff_date'],7]=600.
        self.assertGreater(c.quote(p,a)['nba_weight'],first['nba_weight'])
        p['draft_year']='2020'
        self.assertIsNone(c.quote(p,a))

    def test_first_season_has_no_extrapolated_minute_weight(self):
        c,p,a=fixture();p['draft_year']='2024';c.observations[p['cutoff_date'],7]=2000.
        for row in c.careers:row['stage']=0
        c.pick_curve[1]=dict(peak_production_quote=80.,cumulative_production_quote=40.)
        result=c.quote(p,a)
        self.assertEqual(result['nba_weight'],0.)
        self.assertEqual(result['current_observed_minutes'],0.)

    def test_known_absence_preserves_signed_cost(self):
        c,p,a=fixture();a[0].update(availability_overlay='0',annual_production='0',app_effective_contract='10')
        result=c.quote(p,a)
        self.assertEqual(result['annual_values'][0]['production'],0.)
        self.assertAlmostEqual(result['annual_values'][0]['asset'],-8.)

    def test_release_uses_guarantee_but_good_scenarios_pay_full_salary(self):
        c,p,a=fixture();a[0]['app_effective_contract']='10'
        cells=[dict(year=2025,amount=10,waiver_option_verified=True,waiver_guaranteed_amount_asof=2.)]
        with patch('calibration.production.agreements_at',return_value=(cells,True,None)),patch('calibration.production.evidence_weight',return_value=1.):
            result=c.quote(p,a)
        self.assertAlmostEqual(result['annual_mean_cost'][0],6.)
        self.assertAlmostEqual(result['annual_mean_production'][0],10.)

    def test_immature_residual_labels_cannot_price_a_historical_snapshot(self):
        c,p,a=fixture()
        for row in c.residuals.rows:row['origin']=2022
        self.assertEqual(c.quote(p,a)['status'],'insufficient_completed_residual_paths')


if __name__=='__main__':unittest.main()
