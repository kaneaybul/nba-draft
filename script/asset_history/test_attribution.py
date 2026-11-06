import unittest
from attribution import TRADE_WAIVER_NONTRANSFER_COMPONENTS, attribute_trade_waiver
from attribution_players import AGING_COMPONENT,clock,parts,production_bucket
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

    def test_lonzo_receipt_and_waiver_offset_under_trades(self):
        row = dict(asset_id='player:nba:1628366', start='2026-01-31', end='2026-02-28',
                   category='trades', component='Intermediate acquired player absent at month-end', value=34.1)
        reversal = dict(row, category='contracts', component='Intermediate loss of contract control', value=-34.1)
        receipt, waiver = [attribute_trade_waiver('UTA', entry) for entry in (row, reversal)]
        self.assertEqual([r['category'] for r in (receipt, waiver)], ['trades', 'trades'])
        self.assertAlmostEqual(receipt['value'] + waiver['value'], 0.)
        self.assertNotIn(receipt['component'], TRADE_WAIVER_NONTRANSFER_COMPONENTS)
        self.assertIn(waiver['component'], TRADE_WAIVER_NONTRANSFER_COMPONENTS)
        self.assertIs(attribute_trade_waiver('CLE', row), row)

    def test_saben_reclassification_spans_both_observation_intervals(self):
        revalue = dict(asset_id='player:nba:1630240', start='2022-08-31', end='2022-09-30',
                       category='player', component='Player production forecast changes', value=13.2)
        release = dict(revalue, start='2022-09-30', end='2022-10-31', category='contracts',
                       component='Waiver or expiry of contract control', value=-29.4)
        aging = dict(release, category='aging', component=AGING_COMPONENT)
        for entry, label in [(revalue, 'Production forecast'), (aging, 'Production forecast'), (release, 'Waiver')]:
            moved = attribute_trade_waiver('UTA', entry)
            self.assertEqual(moved, dict(entry, category='trades', component=f'Saben Lee · {label}'))
        unrelated = dict(release, asset_id='player:nba:202355')
        later = dict(release, start='2022-10-31', end='2022-11-30')
        self.assertIs(attribute_trade_waiver('UTA', unrelated), unrelated)
        self.assertIs(attribute_trade_waiver('UTA', later), later)

if __name__=='__main__':unittest.main()
