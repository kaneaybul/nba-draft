import csv,json,tempfile,unittest
from pathlib import Path
from draft_identity import update

class ActualDraftIdentity(unittest.TestCase):
 def fixture(self,root):
  p=root/'app_model/processed/draft/draft_picks_all_classes.csv';p.parent.mkdir(parents=True);p.write_text('player,draft_year,pick_overall\n')
  (root/'monthly_reconstruction/league_ownership').mkdir(parents=True);return p
 def event(self,name,round_number,pick,year=2026):
  return {'date':f'{year}-06-24','text':f'The Team selected {name} in Round {round_number} with Pick {pick} in the {year} NBA Draft.','players':[{'name':name}],'source':'dated_original_draft_record'}
 def test_unsigned_selected_slot_is_retained_without_nba_id(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);p=self.fixture(root);events=[self.event('First Round Last',1,30),self.event('Unsigned Rookie',2,2)]
   update(root,events)
   with p.open()as f:rows=list(csv.DictReader(f))
   r=next(r for r in rows if r['player']=='Unsigned Rookie');self.assertEqual(r['pick_overall'],'32')
   self.assertEqual(update(root,events)['added_actual_draft_rows'],[])
 def test_forfeited_first_does_not_shift_second_round_selection(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);p=self.fixture(root);update(root,[self.event('Last First',1,29,2029),self.event('First Second',2,1,2029)])
   with p.open()as f:rows=list(csv.DictReader(f))
   r=next(r for r in rows if r['player']=='First Second');self.assertEqual(r['pick_overall'],'30')
 def test_transfer_is_not_a_new_draft_selection(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);p=self.fixture(root);update(root,[{'date':'2026-06-24','text':'The draft rights to Old Player were acquired in exchange for cash.','players':[{'name':'Old Player'}],'source':'trade'}])
   self.assertNotIn('Old Player',p.read_text())

if __name__=='__main__':unittest.main()
