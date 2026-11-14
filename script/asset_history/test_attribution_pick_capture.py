"""A historical replay must work after its forecast has been captured."""
import ast,json,sys,tempfile,types,unittest
from collections import defaultdict
from pathlib import Path
from unittest.mock import patch

class CapturedPickReplay(unittest.TestCase):
    def test_saved_forecast_does_not_read_newer_live_inputs(self):
        source=Path(__file__).with_name('attribution_picks.py')
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef)and n.name=='setup')
        scope=dict(json=json,defaultdict=defaultdict,load_actions=lambda:([],[]),display_years=lambda *a,**k:[2027])
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),scope)
        def future_feed(*args):raise AssertionError('Historical replay read the live feed')
        module=types.ModuleType('run_pick_refresh')
        module.current_forecast=future_feed
        module.new_pick_actions=lambda *a:([],[],[])
        with tempfile.TemporaryDirectory() as folder,patch.dict(sys.modules,run_pick_refresh=module):
            repo=Path(folder);root=repo/'processed/asset_history/picks';root.mkdir(parents=True)
            files={'opening_baseline.json':{},'dated_events.json':[],'dated_orders.json':dict(draft_completion_dates={}),
                   'trained_pick_model.json':{},'forecast_inputs.json':dict(ratings={'2026-11-03':[dict(net=1.)]},standings={})}
            for name,data in files.items():(root/name).write_text(json.dumps(data))
            ctx=dict(dates=['2026-11-03'],events=[],names={},teams=[])
            scope['setup'](ctx,repo)
            self.assertEqual(ctx['inputs']['ratings']['2026-11-03'],[dict(net=1.)])
            self.assertEqual(ctx['actions'],[])

if __name__=='__main__':unittest.main()
