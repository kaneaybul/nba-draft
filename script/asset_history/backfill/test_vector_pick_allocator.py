import unittest
import numpy as np
from pick_allocator import allocate, TEAMS
from vector_pick_allocator import allocate_vector, OWNER_NAMES, OWNER_INDEX

def pick(team,year=2027,rnd=1):return [team,year,rnd]
def rule(kind,**kw):return dict(rule_id='test',kind=kind,known_from='2026-01-01',order=0,reviewed=True,source='Reviewed test fixture',**kw)

class VectorPickAllocatorTests(unittest.TestCase):
    def setUp(self):
        self.keys=[(t,y,rnd)for y in range(2027,2030)for t in sorted(TEAMS)for rnd in[1,2]]
        rng=np.random.default_rng(937);self.raw=np.empty((300,len(self.keys)),np.int16)
        for year in range(2027,2030):
            for rnd in[1,2]:
                cols=[j for j,p in enumerate(self.keys)if p[1]==year and p[2]==rnd]
                self.raw[:,cols]=np.argsort(rng.random((len(self.raw),30)),axis=1)+1+(30 if rnd==2 else 0)
    def parity(self,rules,conditions=None):
        actual=allocate_vector(self.raw,self.keys,rules,'2026-10-26',conditions)
        self.assertEqual(actual.shape,self.raw.shape)
        for i,row in enumerate(self.raw):
            source=dict(zip(self.keys,map(int,row)));c=None if conditions is None else dict(zip(self.keys,map(int,conditions[i])))
            expected=allocate(source,rules,'2026-10-26',condition_slots=c)
            self.assertEqual([expected[p]for p in self.keys],[OWNER_NAMES[int(v)]for v in actual[i]])
        return actual
    def test_protected_chain_has_at_most_one_first_and_one_fallback(self):
        r=rule('protected_chain',from_team='ATL',to_team='BOS',branches=[dict(pick=pick('ATL'),protected_ranges=[[1,5]]),dict(pick=pick('ATL',2028),protected_ranges=[[1,10]])],fallback_picks=[pick('ATL',2029,2)])
        out=self.parity([r]);first=[self.keys.index(('ATL',y,1))for y in[2027,2028]];fallback=self.keys.index(('ATL',2029,2))
        conveyed=(out[:,first]==OWNER_INDEX['BOS']).sum(axis=1)
        self.assertTrue(np.all(conveyed<=1));self.assertTrue(np.all((out[:,fallback]==OWNER_INDEX['BOS'])==(conveyed==0)))
    def test_dependency_and_prior_conveyance(self):
        one=rule('protected_chain',from_team='ATL',to_team='BOS',branches=[dict(pick=pick('ATL'),protected_ranges=[[1,15]])],fallback_picks=[])
        one['rule_id']='earlier'
        two=rule('protected_chain',from_team='ATL',to_team='CHA',branches=[dict(pick=pick('ATL',2028)),dict(pick=pick('ATL',2029))],fallback_picks=[],requires_gap_after_rule='earlier',minimum_gap_years=2,requires_prior_conveyance=True)
        two['order']=1;self.parity([one,two])
    def test_swap_and_fallback_preserve_physical_components(self):
        out=self.parity([rule('swap',left_pick=pick('ATL'),right_pick=pick('BOS'),left_owner='ATL',right_owner='BOS',protected_ranges=[[1,5]],fallback_picks=[pick('BOS',2028,2)])])
        a,b=[self.keys.index((t,2027,1))for t in['ATL','BOS']]
        self.assertTrue(np.all(np.sort(out[:,[a,b]],axis=1)==np.sort([OWNER_INDEX['ATL'],OWNER_INDEX['BOS']])))
    def test_best_option_and_holder_swaps(self):
        self.parity([rule('best_option_swap',left_pick=pick('ATL'),left_owner='ATL',options=[dict(pick=pick('BOS'),owner='BOS',protected_ranges=[[1,3]]),dict(pick=pick('CHA'),owner='CHA')])])
        self.parity([rule('holder_swap',left_pool=[pick('ATL'),pick('CHA')],right_pick=pick('BOS'),left_owner='ATL',right_owner='BOS')])
        self.parity([rule('holder_pool_swap',left_pool=[pick('ATL'),pick('CHA')],right_pool=[pick('BOS'),pick('DAL')],left_owner='ATL',right_owner='BOS',left_rank='best',right_rank='worst',protected_ranges=[[1,4]])])
    def test_ranked_and_selected_entitlement_transfers(self):
        give=rule('transfer',pick=pick('CHA'),from_team='CHA',to_team='ATL')
        ranked=rule('ranked_transfer',picks=[pick('ATL'),pick('CHA')],from_team='ATL',to_team='BOS',rank='worst',protected_ranges=[[25,30]]);ranked['order']=1
        self.parity([give,ranked])
        expression={'if_slot_in':{'pick':pick('BOS'),'range':[1,15]},'then':{'held':{'picks':[pick('ATL'),pick('CHA')],'owner':'ATL','count_range':[2,2],'index':-1}},'else':{'rank':{'picks':[pick('ATL'),pick('CHA'),pick('ATL')],'index':0}}}
        selected=rule('selected_transfer',select=expression,from_team='ATL',to_team='DAL',conditions=[dict(pick=pick('BOS'),range=[1,27])],protected_ranges=[[1,4]]);selected['order']=1
        self.parity([give,selected])
    def test_no_selection_and_unexecuted_branch_do_not_raise(self):
        expr={'if_slot_in':{'pick':pick('ATL'),'range':[1,30]},'then':pick('ATL'),'else':{'held':{'picks':[pick('BOS')],'owner':'ATL','count_range':[1,1]}}}
        self.parity([rule('selected_transfer',select=expr,from_team='ATL',to_team='CHA')])
        expr={'best_eligible':[dict(pick=pick('ATL'),protected_ranges=[[1,30]])]}
        self.parity([rule('selected_transfer',select=expr,from_team='ATL',to_team='CHA',allow_no_selection=True)])
    def test_selected_swap_and_entitlement_transfer(self):
        self.parity([rule('selected_swap',left_select=pick('ATL'),right_select=pick('BOS'),left_owner='ATL',right_owner='BOS',conditions=[dict(pick=pick('CHA'),range=[1,10])],protected_ranges=[[1,4]])])
        give=rule('transfer',pick=pick('CHA'),from_team='CHA',to_team='ATL')
        r=rule('entitlement_transfer',picks=[pick('ATL'),pick('CHA'),pick('BOS')],from_team='ATL',to_team='DAL',count_range=[2,2]);r['order']=1
        self.parity([give,r])
    def test_nested_selector_partition_and_conditional_recipient(self):
        a,b,c=[pick(t,2027,2)for t in['ATL','BOS','CHA']]
        cond={'if_slot_in':dict(pick=a,range=[31,40]),'then':'ATL','else':'DAL'}
        r=rule('selector_partition',picks=[a,b,c],expected_owners=[[a,'ATL'],[b,'BOS'],[c,'CHA']],claims=[dict(owner=cond,select={'best':[a,b]}),dict(owner='BOS',select={'best':[c,{'worst':[a,b]}]}),dict(owner='CHA',select='remaining')])
        self.parity([r])
    def test_partition_and_deferred_choice(self):
        picks=[pick(t)for t in['ATL','BOS','CHA']]
        self.parity([rule('partition',picks=picks,expected_owners=[[p,p[0]]for p in picks],owners_by_rank=['BOS','CHA','ATL'])])
        self.parity([rule('deferred_choice',earlier_pick=pick('ATL'),later_pick=pick('ATL',2028),from_team='ATL',to_team='CHA',decision_by_slot={str(s):'earlier'if s<=15 else'later'for s in range(1,31)})])
    def test_next_available_second_penalty_and_numbering_conditions(self):
        give=rule('transfer',pick=pick('BOS',2027,2),from_team='BOS',to_team='ATL')
        r=rule('forfeit_next_available_second',target_team='ATL',first_eligible_year=2027,allowed_candidates=[pick('ATL',2027,2),pick('BOS',2027,2),pick('ATL',2028,2),pick('ATL',2029,2)],same_year_policy='first_selection');r['order']=1
        out=self.parity([give,r]);self.assertTrue(np.all((out==OWNER_INDEX['FORFEITED']).sum(axis=1)==1))
        cond=self.raw.copy();c=self.keys.index(('ATL',2027,2));cond[:,c]=30
        self.parity([rule('selected_transfer',select=pick('ATL',2027,2),from_team='ATL',to_team='BOS',protected_ranges=[[31,60]])],cond)
    def test_bad_owner_in_one_outcome_blocks_batch(self):
        a=pick('ATL');r=rule('selected_transfer',select=a,from_team='BOS',to_team='CHA',conditions=[dict(pick=pick('BOS'),range=[1,30])])
        with self.assertRaisesRegex(ValueError,'Chain owner mismatch'):allocate_vector(self.raw,self.keys,[r],'2026-10-26')

if __name__=='__main__':unittest.main()
