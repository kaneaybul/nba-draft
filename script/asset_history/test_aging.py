import copy
import unittest
from pathlib import Path
from types import SimpleNamespace
from aging import POLICY, basis, expected_aging, integrated_drift, load_curve


class AgingTests(unittest.TestCase):
    def setUp(self):
        self.c = {'(Intercept)': .2, 'age_peak_distance': -.04,
                  'age_peak_distance_sq': 0., 'yoe': -.03}
        self.asset = {'name': 'Test player', 'value': 100., 'details': {
            'annual_values': [dict(season=2027+i, production=10., asset=8., exposure=1.) for i in range(4)],
            'aging_basis': {'policy': POLICY, 'status': 'priced', 'annual': [
                dict(season=2027+i, age=34+i, experience=14+i, dollars_per_total=2., total=1.) for i in range(4)]}}}

    def test_older_player_declines_without_changing_inventory_or_contracts(self):
        before = copy.deepcopy(self.asset)
        amount = expected_aging(self.asset, '2026-01-01', '2027-01-01', self.c)
        self.assertLess(amount, 0)
        self.assertEqual(self.asset, before)
        # An observed -25 movement becomes aging plus the exact residual.
        self.assertAlmostEqual(amount + (-25-amount), -25)

    def test_young_age_curve_can_gain_value(self):
        for r in self.asset['details']['aging_basis']['annual']:
            r.update(age=19, experience=0)
        self.assertGreater(expected_aging(self.asset, '2026-01-01', '2027-01-01', self.c), 0)

    def test_elapsed_calendar_time_not_number_of_games(self):
        self.assertEqual(expected_aging(self.asset, '2026-01-01', '2026-01-01', self.c), 0)
        self.assertAlmostEqual(integrated_drift(30, 10, .25, self.c)
                               + integrated_drift(30.25, 10.25, .75, self.c),
                               integrated_drift(30, 10, 1., self.c))

    def test_flat_age_curve_produces_zero_even_when_path_is_uneven(self):
        self.asset['details']['annual_values'][2]['production'] = 40.
        self.assertEqual(expected_aging(self.asset, '2026-01-01', '2027-01-01', {k:0. for k in self.c}), 0.)

    def test_missing_basis_is_an_error_not_zero_aging(self):
        del self.asset['details']['aging_basis']
        with self.assertRaisesRegex(ValueError, 'Missing aging basis'):
            expected_aging(self.asset, '2026-01-01', '2027-01-01', self.c)

    def test_basis_uses_dated_age_and_original_dollar_conversion(self):
        row = {'source_nba_id':'1', 'draft_year':'2010', 'asset_type':'roster_contract'}
        annual = [dict(season='2027', source_profile_season='2026', forecast_annual_minutes='2000',
                       scale_budget_scenario='100000000', league_timin='1500000',
                       salary_cap_scenario='164961000', latent_total='1')]
        model = SimpleNamespace(ages={(2026,1):34., (2027,1):90.}, experience={(2026,1):16.})
        b = basis(row, annual, model)
        self.assertEqual(b['annual'][0]['age'], 35.)
        self.assertEqual(b['annual'][0]['experience'], 17.)
        self.assertEqual(b['annual'][0]['dollars_per_total'], 4000000.)

    def test_current_curve_uses_shared_projection_coefficients(self):
        p=Path(__file__).resolve().parents[2]/'processed/modelresults/career_projection_selected_terms.csv'
        if not p.exists(): self.skipTest('Model coefficients not in fixture')
        c=load_curve(p)
        self.assertGreater(integrated_drift(20,1,1,c), 0)
        self.assertLess(integrated_drift(34,14,1,c), 0)

    def test_name_only_record_keeps_explicit_existing_model_age_prior(self):
        row={'source_nba_id':'','ledger_nba_id':'','draft_year':'','asset_type':'roster_contract','cutoff_date':'2026-11-04'}
        annual=[dict(season='2027',source_profile_season='2027',forecast_annual_minutes='100',
                     scale_budget_scenario='100000000',league_timin='1500000',salary_cap_scenario='164961000',latent_total='-2.5')]
        b=basis(row,annual,SimpleNamespace(ages={},experience={}))
        self.assertEqual(b['age_source'],'existing_model_age22_prior')
        self.assertEqual(b['annual'][0]['age'],22.)

    def test_unplayed_right_without_a_numeric_id_has_no_active_aging(self):
        b=basis({'source_nba_id':'','ledger_nba_id':''},[{'latent_total':'','forecast_annual_minutes':''}],SimpleNamespace())
        self.assertEqual(b['status'],'no_active_production')


if __name__ == '__main__': unittest.main()
