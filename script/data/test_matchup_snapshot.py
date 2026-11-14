import json,tempfile,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from matchup_snapshot import make_snapshot,read_snapshot

NOW=datetime(2026,10,25,13,tzinfo=timezone.utc)
PARAMS=dict(SeasonYear='2026-27',SeasonType='Regular Season')

def example_rows():
    return [dict(SEASON_ID='22026',DEF_PLAYER_ID=i,OFF_PLAYER_ID=i%110+1,GP=2,PARTIAL_POSS=10+i/10) for i in range(1,111)]

class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'snapshot.json'
    def write(self,data):self.path.write_text(json.dumps(data))
    def test_original_pair_counts_survive_roundtrip(self):
        source=example_rows();self.write(make_snapshot(source,PARAMS,2027,now=NOW))
        rows,data=read_snapshot(self.path,2027,now=NOW+timedelta(hours=2))
        self.assertEqual(rows,source);self.assertEqual(data['matchup_rows'],110)
    def test_stale_or_future_snapshot_is_rejected(self):
        self.write(make_snapshot(example_rows(),PARAMS,2027,now=NOW))
        for moment in [NOW+timedelta(hours=7),NOW-timedelta(minutes=6)]:
            with self.assertRaises(ValueError):read_snapshot(self.path,2027,now=moment)
    def test_wrong_season_and_modified_hash_are_rejected(self):
        data=make_snapshot(example_rows(),PARAMS,2027,now=NOW);self.write(data)
        with self.assertRaises(ValueError):read_snapshot(self.path,2026,now=NOW)
        data['sha256']='0'*64;self.write(data)
        with self.assertRaises(ValueError):read_snapshot(self.path,2027,now=NOW)
    def test_duplicates_and_partial_coverage_are_rejected(self):
        source=example_rows()
        for rows in [source[:99],source+[source[0]]]:
            with self.assertRaises(ValueError):make_snapshot(rows,PARAMS,2027,now=NOW)
    def test_wrong_response_season_is_rejected(self):
        with self.assertRaises(ValueError):make_snapshot(example_rows(),dict(SeasonYear='2025-26',SeasonType='Regular Season'),2027,now=NOW)

if __name__=='__main__':unittest.main()
