import unittest
from types import SimpleNamespace
from aging import basis


class AgingTests(unittest.TestCase):
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
