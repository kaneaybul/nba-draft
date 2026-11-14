import unittest
from retained_own_audit import audit

class LegacySettlementChecks(unittest.TestCase):
 def test_closes_only_reviewed_original_claim(self):
  event=dict(date='2019-07-07',source='register',text='A conditional 2020 1st round pick (CLE own) and a conditional 2021 2nd round pick (PHX own) were acquired by the New Orleans Pelicans from the Cleveland Cavaliers in exchange for: cash.')
  claim=dict(date=event['date'],origin='CLE',claim_year=2020,round=1,settled_by='2020-08-20',reviewed=True,source=['official_order'])
  result=audit([event],set(),[claim]);unknown={tuple(r['pick'])for r in result['unresolved_legacy_or_origin_claims']}
  self.assertNotIn(('CLE',2022,1),unknown);self.assertIn(('PHX',2022,2),unknown)
  proof=next(x for x in result['confirmed_retained_own']if x['pick']==['CLE',2022,1])
  self.assertIn('official_order',proof['source'])
 def test_rejects_future_settlement(self):
  with self.assertRaisesRegex(ValueError,'known by baseline'):
   audit([],set(),[dict(date='2020-01-01',origin='UTA',claim_year=2024,round=1,settled_by='2024-05-14',reviewed=True,source=['future_order'])])
 def test_seven_year_limit_uses_transaction_not_pick_year(self):
  event=dict(date='2015-07-01',source='register',text='A conditional 2020 1st round pick (CLE own) was acquired by the Atlanta Hawks from the Cleveland Cavaliers in exchange for: cash.')
  result=audit([event],set());unknown={tuple(r['pick'])for r in result['unresolved_legacy_or_origin_claims']}
  self.assertIn(('CLE',2022,1),unknown);self.assertNotIn(('CLE',2023,1),unknown)

if __name__=='__main__':unittest.main()
