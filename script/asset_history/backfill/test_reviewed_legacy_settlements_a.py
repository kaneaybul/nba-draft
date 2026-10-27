import unittest
from pathlib import Path
import json

from pick_event_evidence import MENTION, ALIASES
from reviewed_legacy_settlements_a import resolved_claims, live_claims, build_rules

ROOT = Path(__file__).resolve().parents[4]


class LegacySettlementMentions(unittest.TestCase):
    def test_all_conditional_mentions_in_assigned_queue_are_accounted(self):
        queue = ROOT / 'league_backfill/picks/legacy_settlements/original_69_family_queue.json'
        if not queue.exists():
            self.skipTest('Research evidence queue not present in checkout')
        rows = json.loads(queue.read_text())[:29]
        resolved = {(r['date'], r['origin'], r['claim_year'], r['round'])
                    for r in resolved_claims()}
        live = {(r['date'], r['origin'], r['claim_year'], r['round'])
                for r in live_claims()}
        for i, event in enumerate(rows):
            for m in MENTION.finditer(event['text']):
                if (m['qualifier'] or '').strip() != 'conditional':
                    continue
                origin = ALIASES.get(m['origin'], m['origin'])
                origin = {'GOS': 'GSW'}.get(origin, origin)
                key = (event['date'], origin, int(m['year']), int(m['round']))
                self.assertIn(key, resolved | live, (i, key))

    def test_no_hindsight_or_event_wide_discharge(self):
        rows = resolved_claims()
        self.assertEqual(set(range(29)), {r['queue_index'] for r in rows})
        keys = [(r['date'], r['origin'], r['claim_year'], r['round']) for r in rows]
        self.assertEqual(len(keys), len(set(keys)))
        for r in rows:
            self.assertTrue(r['reviewed'])
            self.assertTrue(r['source'])
            self.assertTrue(r['evidence'])
            self.assertLessEqual(r['settled_by'], '2021-12-31')
            self.assertLessEqual(r['date'], r['settled_by'])
        self.assertNotIn(('2021-03-25', 'CHI', 2023, 1), keys)
        self.assertNotIn(('2019-07-07', 'NOP', 2023, 2), keys)
        self.assertEqual([], build_rules())

    def test_converted_claims_preserve_live_physical_residuals(self):
        rows = resolved_claims()
        cle = [r for r in rows if r['origin'] == 'CLE' and r['claim_year'] == 2019]
        self.assertEqual(2, len(cle))
        self.assertTrue(all(r['residual_claims'][0]['year'] == 2022 for r in cle))
        gsw = next(r for r in rows if r['queue_index'] == 23)
        self.assertEqual(2025, gsw['residual_claims'][0]['year'])
        self.assertEqual('converted_to_future_second', gsw['disposition'])

    def test_slices_and_reacquisition_are_distinct(self):
        rows = {r['queue_index']: r for r in resolved_claims() if r['origin'] != 'MIA'}
        self.assertEqual('extinguished', rows[0]['disposition'])
        self.assertEqual('conveyed', rows[1]['disposition'])
        self.assertEqual('reacquired_and_replaced', rows[10]['disposition'])
        self.assertEqual('2017-01-06', rows[10]['settled_by'])


if __name__ == '__main__':
    unittest.main()
