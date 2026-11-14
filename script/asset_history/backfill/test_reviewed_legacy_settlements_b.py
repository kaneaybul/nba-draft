"""Focused checks for the exact-mention legacy settlement review."""
import json
from pathlib import Path
import unittest

from pick_event_evidence import ALIASES, MENTION
from reviewed_legacy_settlements_b import resolved_claims, live_claims


class LegacySettlementReviewTest(unittest.TestCase):
    def test_unique_prebaseline_exact_claims(self):
        rows = resolved_claims()
        keys = {(r['date'], r['origin'], r['claim_year'], r['round']) for r in rows}
        self.assertEqual(len(rows), 29)
        self.assertEqual(len(keys), len(rows))
        self.assertTrue(all(r['date'] <= r['settled_by'] <= '2021-12-31' for r in rows))
        self.assertTrue(all(r['reviewed'] and r['source'] and r['evidence'] for r in rows))
        self.assertEqual(live_claims(), [])

    def test_complementary_seconds_and_returned_first(self):
        indexed = {(r['date'], r['origin'], r['claim_year'], r['round']): r
                   for r in resolved_claims()}
        self.assertEqual(indexed['2018-02-05', 'MIL', 2018, 2]['disposition'], 'conveyed')
        self.assertEqual(indexed['2017-11-07', 'MIL', 2018, 2]['disposition'], 'expired_no_rollover')
        self.assertEqual(indexed['2021-03-19', 'MIL', 2022, 1]['disposition'], 'returned_own')
        self.assertNotIn(('2021-03-19', 'MIL', 2022, 2), indexed)
        self.assertEqual(indexed['2020-11-19', 'OKC', 2021, 2]['disposition'], 'expired_no_rollover')

    def test_matches_archived_assigned_mentions_when_available(self):
        checkpoint = Path(__file__).resolve().parents[4] / 'league_backfill/picks/legacy_settlements/original_69_family_queue.json'
        if not checkpoint.exists():
            self.skipTest('Source-review checkpoint is outside the portable app repository')
        expected = set()
        for event in json.loads(checkpoint.read_text())[29:54]:
            for match in MENTION.finditer(event['text']):
                if (match['qualifier'] or '').strip() == 'conditional':
                    expected.add((event['date'], ALIASES.get(match['origin'], match['origin']),
                                  int(match['year']), int(match['round'])))
        actual = {(r['date'], r['origin'], r['claim_year'], r['round']) for r in resolved_claims()}
        self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
