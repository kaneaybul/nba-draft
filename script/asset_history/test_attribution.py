import unittest
from attribution_players import clock,parts,production_bucket
from quote_window import quote_window

class AttributionTests(unittest.TestCase):
    def test_unsigned_rights_keep_production_and_contract_split(self):
        a={'name':'Unsigned selection','value':120.,'details':{'peak_production':85.,'contract_adjustment':35.}}
        self.assertEqual(parts(a)[0],85.)
        frozen=clock(a,{2027:1.,2028:1.,2029:1.,2030:1.})
        self.assertEqual(frozen['value'],120.);self.assertEqual(frozen['peak'],85.)
    def test_padding_fade_is_a_single_observed_production_change(self):
        self.assertEqual(production_bucket(2023,'2027-07-31'),'draft')
        self.assertEqual(production_bucket(2023,'2027-08-01'),'player')
        self.assertEqual(production_bucket(None,'2026-07-31'),'player')
    def test_clock_uses_fractional_seasons_and_keeps_quote_premium(self):
        annual=[{'season':2027+i,'production':p,'asset':p-4,'exposure':1.}for i,p in enumerate([10.,20.,30.,40.])]
        q=quote_window([r['production']for r in annual],[r['asset']for r in annual],[1.]*4)
        a={'name':'Test','value':q['quote']+5,'details':{'peak_production':q['production_quote']+5,'annual_values':annual}}
        moved=clock(a,{2027:.5,2028:1.,2029:1.,2030:1.,2031:.5})
        expected=quote_window([10.,20.,30.,40.,40.],[6.,16.,26.,36.,36.],[.5,1.,1.,1.,.5])
        self.assertAlmostEqual(moved['value'],expected['quote']+5)
        self.assertAlmostEqual(moved['peak'],expected['production_quote']+5)
        self.assertEqual(moved['tail_carry'],[2031])
if __name__=='__main__':unittest.main()
