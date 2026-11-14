import types,unittest
from profile_draft import apply_profile_drafts
class Pair:
 def itertuples(self):return iter([types.SimpleNamespace(nba_id=1,name='A')])
class Check(unittest.TestCase):
 def test_missing_slot_is_filled_from_real_id(self):
  src=types.SimpleNamespace(pairs={'x':Pair()},inventory=[{'roster_and_rights':[{'nba_id':1,'player_name':'A'}]}],draft={})
  a=[{'nba_id':1,'player_name':'A','source_profile_draft_year':2026,'source_profile_draft_pick':16,'source':'profile'}]
  x=apply_profile_drafts(src,a,str.lower);self.assertEqual(src.draft['a'],(2026,16));self.assertEqual(src.draft_by_id[1],(2026,16));self.assertTrue(x['added'])
 def test_reviewed_slot_is_not_overwritten(self):
  src=types.SimpleNamespace(pairs={'x':Pair()},inventory=[],draft={'a':(2026,3)})
  a=[{'nba_id':1,'player_name':'A','source_profile_draft_year':2026,'source_profile_draft_pick':16,'source':'profile'}]
  x=apply_profile_drafts(src,a,str.lower);self.assertEqual(src.draft_by_id[1],(2026,3));self.assertTrue(x['conflicts'])
if __name__=='__main__':unittest.main()
