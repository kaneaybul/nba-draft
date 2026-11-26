import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('build',Path(__file__).with_name('build_asset_value_data.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class HistoryRouteTests(unittest.TestCase):
 def test_absent_route_keeps_legacy_behavior(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);self.assertIsNone(module.preserved_history_route(p));(p/'asset_valuation.json').write_text('{"history_version":"v16"}');self.assertIsNone(module.preserved_history_route(p))
 def test_independent_route_is_retained(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'asset_valuation.json').write_text('{"history_version":"v16","asset_history_version":"v17"}');m=p/'asset_history/v17';m.mkdir(parents=True);(m/'manifest.json').write_text(json.dumps({'method':'peak4-payroll-0.8-v17','teams':[{}]*30}));self.assertEqual(module.preserved_history_route(p),'v17')
 def test_missing_payload_blocks_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'asset_valuation.json').write_text('{"asset_history_version":"v17"}')
   with self.assertRaisesRegex(ValueError,'payload is missing'):module.preserved_history_route(p)
 def test_bad_route_is_not_followed(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'asset_valuation.json').write_text('{"asset_history_version":"../other"}')
   with self.assertRaisesRegex(ValueError,'Invalid'):module.preserved_history_route(p)
 def test_suffixed_method_name_is_retained_and_mismatched_prefix_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'asset_valuation.json').write_text('{"history_version":"v16","asset_history_version":"v20"}');m=p/'asset_history/v20';m.mkdir(parents=True);(m/'manifest.json').write_text(json.dumps({'method':'peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster','teams':[{}]*30}));self.assertEqual(module.preserved_history_route(p),'v20')
   (p/'asset_valuation.json').write_text('{"history_version":"v16","asset_history_version":"v2"}');m2=p/'asset_history/v2';m2.mkdir(parents=True);(m2/'manifest.json').write_text(json.dumps({'method':'peak4-payroll-0.8-v20','teams':[{}]*30}))
   with self.assertRaisesRegex(ValueError,'incompatible'):module.preserved_history_route(p)
if __name__=='__main__':unittest.main()
