import copy,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from calibration.endpoint_model import EndpointModel,production_quotes,pick_components


def records():
    return [dict(key=str(i),slot=1+i%30,end=2020,cohort=2016,
                 endpoint=[10.,20.,30.,40.],value=140.,
                 production=[1.,2.,3.,4.,10.,20.,30.,40.])for i in range(60)]


class EndpointTests(unittest.TestCase):
    def test_endpoint_is_mature_production_not_first_four_service(self):
        r=records();p=EndpointModel(r).prior(2,2020)
        self.assertAlmostEqual(p['value'],140.)
        self.assertAlmostEqual(float(p['weights']@production_quotes(p['paths'][:,4:])),140.)
        self.assertAlmostEqual(float(p['weights']@production_quotes(p['paths'][:,:4])),14.)

    def test_future_completed_labels_do_not_change_original_baseline(self):
        r=records();first=EndpointModel(r).prior(5,2020)['value']
        r += [{**x,'key':'future'+x['key'],'end':2022,'value':1e9}for x in records()]
        self.assertEqual(EndpointModel(r).prior(5,2020)['value'],first)

    def test_pick_cost_changes_do_not_change_the_production_prior(self):
        m=dict(endpoint_records=records(),endpoint_training_through=2020)
        a=pick_components(m,5,[1,1,1,1]);b=pick_components(m,5,[5,5,5,5])
        self.assertEqual(a['draft_endpoint_expectation'],b['draft_endpoint_expectation'])
        self.assertEqual(a['production_quote'],b['production_quote'])
        self.assertAlmostEqual(a['contract_adjustment']-b['contract_adjustment'],12.8)

    def test_unknown_service_cannot_become_zero_service(self):
        r=records()
        for row in r[:35]:row['production']=None
        with self.assertRaisesRegex(ValueError,'linked service'):EndpointModel(r).prior(3,2020)

    def test_target_player_is_excluded_from_its_prior(self):
        r=records();a=EndpointModel(r).prior(1,2020,'0')['value']
        r[0]['value']=1e12
        self.assertEqual(EndpointModel(r).prior(1,2020,'0')['value'],a)

    def test_non_linear_peak_is_priced_before_averaging(self):
        p=np.array([[100,100,0,0],[0,0,100,100]])
        self.assertEqual(production_quotes(p).mean(),400.)
        self.assertEqual(production_quotes(p.mean(axis=0))[0],200.)


if __name__=='__main__':unittest.main()

class AnchoredEndpointTailTests(unittest.TestCase):
    def inputs(self):
        import json
        player={'impact_path_knots_json':json.dumps([[82*2027-164000,2.],[82*2037-164000,2.]]),'impact_team_game_clock':82*27}
        rows=[dict(season=y,latent_annual_minutes=9999,endpoint_role_annual_minutes=100+y-2027,
                   scale_budget_scenario=1,salary_cap_scenario=164961000,league_timin=30,
                   replacement=0,league_reference_year=2026,annual_production=7)for y in range(2027,2032)]
        return player,rows
    def run_endpoint(self,player,rows,audit=None):
        import types
        from unittest.mock import patch
        from calibration.endpoint_model import own_endpoint_path
        def forbidden(*args):raise AssertionError('Generic role fallback must not run')
        with patch.dict(sys.modules,{'valuation_engine':types.SimpleNamespace(AnnualState=forbidden,project_path=forbidden)}):
            return own_endpoint_path(player,rows,2023,{},None,audit,True)
    def test_actual_endpoint_years_use_anchored_minutes_not_generic(self):
        p,r=self.inputs();audit={};values=self.run_endpoint(p,r,audit)
        self.assertEqual(values,[202.,204.,206.,208.])
        self.assertEqual(audit['years'],[2028,2029,2030,2031])
        self.assertEqual(audit['endpoint_annual_minutes'],[101.,102.,103.,104.])
        self.assertEqual(audit['endpoint_minutes_source'],'fixed_anchor_RoleSmoother_full_posterior')
    def test_csv_and_frozen_context_keep_endpoint_tail(self):
        import csv,io
        from rolling_export import serialize_impact_context
        p,r=self.inputs();buf=io.StringIO();w=csv.DictWriter(buf,fieldnames=list(r[0]));w.writeheader();w.writerows(r);buf.seek(0)
        parsed=list(csv.DictReader(buf));context=serialize_impact_context(p,parsed)
        self.assertEqual(self.run_endpoint(p,context['annual_pricing_rows']),[202.,204.,206.,208.])
    def test_missing_column_fails_closed(self):
        p,r=self.inputs()
        for row in r:row.pop('endpoint_role_annual_minutes')
        with self.assertRaisesRegex(ValueError,'Missing anchored'):self.run_endpoint(p,r)
    def test_missing_late_year_and_nonfinite_fail_closed(self):
        p,r=self.inputs()
        with self.assertRaisesRegex(ValueError,'2031'):self.run_endpoint(p,r[:-1])
        r[-1]['endpoint_role_annual_minutes']='nan'
        with self.assertRaisesRegex(ValueError,'Invalid anchored'):self.run_endpoint(p,r)
    def test_legacy_nonrolling_full_path_unchanged(self):
        p,r=self.inputs();p={}
        for row in r:row['app_annual_quote_production_reporting_rate']=7
        self.assertEqual(self.run_endpoint(p,r),[7.,7.,7.,7.])
