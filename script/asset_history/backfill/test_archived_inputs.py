import base64,gzip,hashlib,json,tempfile,unittest
from pathlib import Path
from archived_inputs import restore_archived_inputs

class ArchivedPanels(unittest.TestCase):
    def seed(self,repo):
        root=repo/'processed/asset_history/player_state/archived_inputs';root.mkdir(parents=True)
        payload=dict(date='2026-10-31',roster=[dict(cutoff_date='2026-10-31',roster=[])],
                     coverage=[dict(date='2026-10-31',performance_cutoff='2026-10-30')])
        raw=gzip.compress(json.dumps(payload).encode())
        (root/'panel.b64').write_text(base64.b64encode(raw).decode()+'\n')
        manifest=dict(captures=[dict(date='2026-10-31',file='panel.b64',sha256=hashlib.sha256(raw).hexdigest())])
        (root/'manifest.json').write_text(json.dumps(manifest));return root,payload
    def test_restores_original_date_and_does_not_insert_future_panels(self):
        with tempfile.TemporaryDirectory()as folder:
            repo=Path(folder);root,payload=self.seed(repo);seen=[]
            def restore(runtime,state,results_path):
                seen.append(json.loads(gzip.decompress((state/'latest_inputs.json.gz').read_bytes())))
            self.assertEqual(restore_archived_inputs(repo/'runtime',repo,'2026-10-30',restore),[])
            self.assertEqual(seen,[])
            self.assertEqual(restore_archived_inputs(repo/'runtime',repo,'2026-11-03',restore),['2026-10-31'])
            self.assertEqual(seen,[payload])
    def test_changed_capture_is_rejected_before_restoration(self):
        with tempfile.TemporaryDirectory()as folder:
            repo=Path(folder);root,payload=self.seed(repo)
            (root/'panel.b64').write_text(base64.b64encode(b'wrong capture').decode())
            with self.assertRaisesRegex(ValueError,'digest'):restore_archived_inputs(repo,repo,'2026-11-03',lambda *args,**kw:self.fail('restored corrupt panel'))
    def test_manifest_cannot_relabel_an_earlier_panel(self):
        with tempfile.TemporaryDirectory()as folder:
            repo=Path(folder);root,payload=self.seed(repo)
            p=root/'manifest.json';m=json.loads(p.read_text());m['captures'][0]['date']='2026-11-01';p.write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'date mismatch'):restore_archived_inputs(repo,repo,'2026-11-03',lambda *args,**kw:None)
if __name__=='__main__':unittest.main()
