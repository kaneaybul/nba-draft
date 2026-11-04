import json, tempfile, unittest
from pathlib import Path
from pick_forecast_capture import capture

class Capture(unittest.TestCase):
    def test_new_live_feed_preserves_the_previous_dated_forecast(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'forecast_inputs.json'
            path.write_text(json.dumps(dict(ratings={'2026-10-31': []}, standings={'2026-10-31': {}})))
            old = [dict(date='2026-11-03', net=1.)]
            capture(path, '2026-11-03', old, {'ATL': dict(wins=3, gp=5)})
            capture(path, '2026-11-04', [dict(date='2026-11-04', net=2.)], {'ATL': dict(wins=4, gp=6)})
            saved = json.loads(path.read_text())
            self.assertEqual(saved['ratings']['2026-11-03'], old)
            self.assertEqual(saved['standings']['2026-11-03']['ATL']['wins'], 3)
            with self.assertRaises(ValueError):
                capture(path, '2026-11-03', [dict(date='2026-11-03', net=3.)], {})
            self.assertEqual(json.loads(path.read_text()), saved)

if __name__ == '__main__': unittest.main()
