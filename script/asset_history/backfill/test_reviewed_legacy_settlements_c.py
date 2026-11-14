import json,unittest
from pathlib import Path
from pick_event_evidence import MENTION,ALIASES
from reviewed_legacy_settlements_c import resolved_claims

class LegacyCChecks(unittest.TestCase):
 def test_exact_mention_coverage(self):
  roots=[p for p in Path(__file__).resolve().parents if(p/'league_backfill/picks/legacy_settlements/original_69_family_queue.json').exists()]
  if not roots:self.skipTest('Source fixture not supplied')
  queue=json.loads((roots[0]/'league_backfill/picks/legacy_settlements/original_69_family_queue.json').read_text())
  keys={(r['date'],r['origin'],r['claim_year'],r['round'])for r in resolved_claims()}
  for event in queue[54:69]:
   for m in MENTION.finditer(event['text']):
    if(m['qualifier']or'').strip()!='conditional':continue
    origin=ALIASES.get(m['origin'],m['origin'])
    self.assertIn((event['date'],origin,int(m['year']),int(m['round'])),keys)
 def test_sources_known_before_baseline(self):
  rows=resolved_claims();self.assertEqual(len(rows),16)
  for r in rows:
   self.assertTrue(r['reviewed']);self.assertTrue(r['source']);self.assertLessEqual(r['settled_by'],'2021-12-31')
 def test_no_duplicate_keys(self):
  rows=resolved_claims();self.assertEqual(len(rows),len({(r['date'],r['origin'],r['claim_year'],r['round'])for r in rows}))

if __name__=='__main__':unittest.main()
