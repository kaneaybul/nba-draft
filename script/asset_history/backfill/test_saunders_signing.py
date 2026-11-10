"""Regression for a signed draftee with no NBA statistical appearances yet."""
import gzip,json,unittest
from pathlib import Path
from league_player_values import agreements_at
from refresh_contracts import key
from ownership_runtime import ALIASES

class SaundersSigning(unittest.TestCase):
    def test_dated_terms_and_provisional_id_join(self):
        repo=Path(__file__).resolve().parents[3]
        with gzip.open(repo/'processed/asset_history/contracts/contract_agreements.json.gz','rt') as f:
            agreements=[a for a in json.load(f) if a['nba_id']==1643563]
        self.assertEqual(ALIASES['richiesaunders'],1643563)
        self.assertFalse(agreements_at(agreements,'Richie Saunders',1643563,'2026-11-06',key)[0])
        for pid in (1643563,-2027020):
            cells,complete,agreement=agreements_at(agreements,'Richie Saunders',pid,'2026-11-10',key)
            self.assertTrue(complete)
            self.assertEqual(agreement['known_from'],'2026-11-07')
            self.assertIn('TWO-WAY',agreement['contract_type'])
            self.assertEqual(cells[0]['original_episode_amount'],608653)
            self.assertEqual(cells[0]['cap_hit'],0)
            self.assertEqual(len(cells),1)

if __name__=='__main__':unittest.main()
