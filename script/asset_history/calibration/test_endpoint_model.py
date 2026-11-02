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
