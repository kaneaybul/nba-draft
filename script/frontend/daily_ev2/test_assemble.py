import json
from pathlib import Path
import shutil
import tempfile
import unittest
from assemble import assemble,sha,TEAMS

class Pipeline(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.repo=self.root/"repo";self.repo.mkdir()
        self.work=self.root/"work";self.seen=[]
        self.put(self.repo/"frontend/public/data/asset_history/v20/manifest.json",{})
        self.put(self.repo/"frontend/public/data/asset_history_release.json",{"asset_history_version":"v20"})
        self.put(self.repo/"processed/contracts/current.json",{})
        index=self.repo/"frontend/public/data/asset_valuation.json"
        self.put(index,{"seasons":{"2022":"old"}})
        protected=["data/asset_history/v20/manifest.json","data/asset_history_release.json"]
        d={k:sha(self.repo/"frontend/public"/k) for k in protected}
        self.c={"asof":"2026-11-17","season":2027,"repo":str(self.repo),"base_index":str(index),"base_index_sha256":sha(index)}
        for name in ("native_seed","adapters","prior"):
            p=self.root/name;p.mkdir();self.c[name]=str(p)
        for name in ("grades","released_calibrator","quote_mapper","ownership_receipt","collector_receipt","history_policy","calibration_seed_inventory","prior_injuries","base_injuries"):
            p=self.root/name;self.put(p,{});self.c[name]=str(p)
        self.put(self.root/"ownership_receipt",{"signed_book":{"sha256":sha(self.repo/"processed/contracts/current.json")}})
        self.put(self.root/"collector_receipt",{"source_checks_pass":True,"asof":self.c["asof"],"season":2027,
             "provider_commands_run":8,"protected_bytes_unchanged":True})
        self.put(self.root/"history_policy",{"protected_files":d})
        self.c["calibration_reviewed"]=True
        for x in ("calibration_seed_inventory","prior_injuries","base_injuries"):
            self.c[x+"_sha256"]=sha(self.root/x)
        for field,name in (("prior_checkpoint","grades"),("grade_checkpoint","grades"),
            ("calibrator","released_calibrator"),("quote_mapper","quote_mapper"),("history_policy","history_policy")):
            self.c[field+"_sha256"]=sha(self.root/name)
    def tearDown(self):self.tmp.cleanup()
    def put(self,p,obj):
        p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj))
    def mock(self,cwd,argv,log,env=None):
        self.seen.append(log.stem);tail={"native_prepare":"prepared/source_preparation_receipt.json",
            "calibration":"calibration/calibration_receipt.json","native_replay":"native/native_replay_receipt.json",
            "player_quotes":"quotes/receipt.json","r_export":"r/receipt.json","picks":"picks.proof.json"}
        if log.stem in tail:self.put(self.work/tail[log.stem],{})
        if log.stem=="r_export":
            self.put(self.repo/"frontend/public/data/v2/impact_players/2027.json",
                [{"nba_id":i+1,"team":t,"pool_status":"roster"} for i,t in enumerate(sorted(TEAMS))])
        if log.stem=="asset_index":
            self.put(self.work/"asset_valuation.json",{"seasons":{"2022":"old"},"asset_history_version":"v20",
                "current_observation_date":"2026-11-17","pick_observation_date":"2026-11-17"})
        if log.stem=="rehydrate_protected_static":
            shutil.copytree(self.repo/"frontend/public",self.repo/"frontend/dist")
    def test_safe_plan(self):
        p=assemble(self.c,self.work)
        self.assertFalse(p["executed"]);self.assertEqual(len(p["stages"]),9)
        self.assertFalse(self.work.exists())
    def test_failed_collect(self):
        self.put(self.root/"collector_receipt",{"source_checks_pass":False})
        with self.assertRaisesRegex(ValueError,"collectors"):assemble(self.c,self.work,True,self.mock)
        self.assertFalse(self.work.exists())
    def test_preserved_history_mismatch(self):
        self.put(self.repo/"frontend/public/data/asset_history_release.json",{"asset_history_version":"v19"})
        with self.assertRaisesRegex(ValueError,"historical input"):assemble(self.c,self.work,True,self.mock)
    def test_execution_flow_with_fake_stages_never_publishes(self):
        p=assemble(self.c,self.work,True,self.mock)
        self.assertEqual(p["completed"][:8],self.seen[:8]);self.assertEqual(p["completed"][-1],"frontend_checks")
        self.assertFalse(p["production"]);self.assertFalse(p["release_ready"])
        self.assertTrue((self.work/"assembly_receipt.json").is_file())
    def test_step_failure_does_not_swap(self):
        original=(self.repo/"frontend/public/data/asset_valuation.json").read_bytes()
        def fail(cwd,argv,log,env=None):
            if log.stem=="picks":raise RuntimeError("license or legal-data gate")
            self.mock(cwd,argv,log,env)
        with self.assertRaisesRegex(RuntimeError,"data gate"):assemble(self.c,self.work,True,fail)
        self.assertEqual((self.repo/"frontend/public/data/asset_valuation.json").read_bytes(),original)
        self.assertFalse((self.work/"assembly_receipt.json").exists())
if __name__=="__main__":unittest.main()
