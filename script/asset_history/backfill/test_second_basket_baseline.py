import itertools,random,unittest
from second_basket_baseline import build_rules,apply_selector_partition,affected_refs,claim_owner

class Baskets(unittest.TestCase):
 def apply(self,rule,rank):
  owners={tuple(p):owner for p,owner in rule['expected_owners']};slots={tuple(p):rank[p[0]]for p in rule['picks']}
  apply_selector_partition(owners,slots,rule);return owners
 def rule(self,year):return next(r for r in build_rules()if r['rule_id']==year)
 def test_all_orders_conserve_and_expected_claim_counts(self):
  for rule in build_rules():
   if any(v[2]==1 for v in rule['picks']):continue
   teams=[p[0]for p in rule['picks']]
   for order in itertools.permutations(teams):
    rank={t:31+j for j,t in enumerate(order)};owners=self.apply(rule,rank)
    self.assertEqual(set(owners),affected_refs(rule));self.assertEqual(len(owners),len(teams))
    expected={}
    for c in rule['claims']:expected[claim_owner(c['owner'],{tuple(v):rank[v[0]]for v in rule['picks']})]=expected.get(claim_owner(c['owner'],{tuple(v):rank[v[0]]for v in rule['picks']}),0)+1
    self.assertEqual({o:list(owners.values()).count(o)for o in set(owners.values())},expected)
 def test_hou_protected_and_unprotected(self):
  rule=self.rule('OPEN_2023_HOU_MIA_DAL_OKC_WAS_SECONDS')
  for h in [31,32,33,60]:
   rank={'HOU':h,'MIA':40,'DAL':45,'OKC':38,'WAS':36}
   owners=self.apply(rule,rank)
   self.assertEqual(owners[('HOU',2023,2)],'IND'if h<=32 or h>45 else'BOS')
   self.assertEqual(owners[('DAL',2023,2)],'BOS'if h<=32 or h>45 else'IND')
 def test_2024_three_pool(self):
  r=self.rule('OPEN_2024_IND_CLE_UTA_SECONDS');rank={'IND':40,'CLE':48,'UTA':33};x=self.apply(r,rank)
  self.assertEqual(x,{('IND',2024,2):'MEM',('CLE',2024,2):'IND',('UTA',2024,2):'NYK'})
 def test_fournier_worst_pool_entitlement_belongs_to_nyk(self):
  r=self.rule('OPEN_2023_HOU_MIA_DAL_OKC_WAS_SECONDS')
  for order in itertools.permutations(['HOU','MIA','DAL','OKC','WAS']):
   rank={t:31+j for j,t in enumerate(order)};x=self.apply(r,rank)
   better=min(['MIA','DAL'],key=rank.get);worst=max(['OKC','WAS',better],key=rank.get)
   self.assertEqual(x[(worst,2023,2)],'NYK')
 def test_2026_sas_swap_never_takes_mem_best(self):
  r=self.rule('OPEN_2026_IND_MIA_SAS_SECONDS')
  for rank in [{'IND':31,'MIA':45,'SAS':35},{'IND':40,'MIA':32,'SAS':50},{'IND':40,'MIA':42,'SAS':31}]:
   x=self.apply(r,rank);best=min(('IND','MIA'),key=rank.get)
   self.assertEqual(x[(best,2026,2)],'MEM')
   sas=next(k for k,v in x.items()if v=='SAS');self.assertLessEqual(rank[sas[0]],rank['SAS'])
 def test_crossround_miami_protection_and_compensation(self):
  r=self.rule('OPEN_2022_HOU_BKN_MIA_FIRST_AND_DEN_PHI_SECONDS')
  for order in itertools.permutations(['HOU','BKN','MIA']):
   for firstvalues in [[1,5,20],[15,20,25]]:
    for secondvalues in [[40,55],[55,40]]:
     ranks=dict(zip(order,firstvalues));ranks.update(dict(zip(['DEN','PHI'],secondvalues)))
     x=self.apply(r,ranks)
     if ranks['MIA']<=14:
      self.assertEqual(x[('MIA',2022,1)],'MIA')
      self.assertEqual(x[(max(['DEN','PHI'],key=ranks.get),2022,2)],'HOU')
     else:
      self.assertEqual(x[(max(['HOU','BKN','MIA'],key=ranks.get),2022,1)],'MIA')
      self.assertEqual(x[(max(['DEN','PHI'],key=ranks.get),2022,2)],'MIA')
     self.assertEqual(x[(min(['DEN','PHI'],key=ranks.get),2022,2)],'MIN')
     self.assertEqual(len(x),5)
 def test_malformed_or_duplicate_claims_rejected(self):
  r=build_rules()[0];r['claims'][1]['select']=r['claims'][0]['select']
  with self.assertRaisesRegex(ValueError,'twice'):self.apply(r,{'HOU':31,'MIA':35,'DAL':40,'OKC':45,'WAS':50})
 def test_owner_guard_rejects_prior_conflict(self):
  r=build_rules()[-2];owners={tuple(v):'BOS'for v in r['picks']};slots={tuple(v):31+j for j,v in enumerate(r['picks'])}
  with self.assertRaisesRegex(ValueError,'owner mismatch'):apply_selector_partition(owners,slots,r)
if __name__=='__main__':unittest.main()
