import unittest
import numpy as np
from league_pick_values import first_forfeited_physical,simulate,actual_number_arrays,TEAMS
from vector_pick_allocator import allocate_vector,OWNER_INDEX

def penalty(origin,year,kind='entitlement_transfer'):
    r=dict(rule_id=f'penalty:{origin}:{year}',known_from='2026-09-02',kind=kind,from_team='LAC',to_team='FORFEITED',order=1,reviewed=True,source='Reviewed penalty fixture')
    if kind=='transfer':r['pick']=[origin,year,1]
    else:r.update(picks=[[origin,year,1]],count_range=[1,1])
    return r

class FirstForfeitRepresentationChecks(unittest.TestCase):
    def test_operation_spelling_does_not_change_pre_draw_exclusion(self):
        fixed=penalty('IND',2029,'transfer');entitlement=penalty('IND',2029)
        self.assertEqual(first_forfeited_physical([fixed]),{('IND',2029,1)})
        self.assertEqual(first_forfeited_physical([entitlement]),first_forfeited_physical([fixed]))
        self.assertEqual(first_forfeited_physical([entitlement],'2026-09-01'),set())
        self.assertEqual(first_forfeited_physical([entitlement],'2026-09-02'),{('IND',2029,1)})
    def test_contingent_first_penalty_requires_explicit_pre_draw_model(self):
        r=penalty('IND',2029);r['count_range']=[0,1]
        with self.assertRaisesRegex(ValueError,'Contingent first forfeiture'):first_forfeited_physical([r])
    def test_all_five_fixed_firsts_have_zero_lottery_probability(self):
        names=sorted(TEAMS)
        orders=[]
        for year in range(2022,2027):
            rows=[dict(origin=t,round=rnd,physical_slot=j+1+30*(rnd-1),actual_slot=j+1+30*(rnd-1))for rnd in[1,2]for j,t in enumerate(names)]
            orders.append(dict(year=year,kind='lottery',known_from=f'{year}-05-15',rows=rows))
        ratings=[dict(team_alias=t,season=2027,net=0)for t in names]
        standing={t:dict(gp=0,wins=0,season_ending=2027)for t in names}
        rules=[penalty('IND',2029)]+[penalty('LAC',y)for y in range(2030,2034)]
        sim=simulate('2026-10-25',ratings,standing,rules,orders,draws=100,max_year=2033)
        for origin,year,rnd in first_forfeited_physical(rules):
            values=sim['first'][year][:,sim['index'][origin]]
            #30is the unavailable physical placeholder, never a drawn pick.
            self.assertTrue(np.all(values==30),(origin,year))
            self.assertEqual(np.count_nonzero(values<=16),0)
        self.assertTrue(any('forfeiture'in s for s in sim['assumptions']))
    def test_earlier_forfeit_keeps_next_available_protection_stable(self):
        names=sorted(TEAMS);keys=[(t,y,rnd)for y in[2025,2026]for rnd in[1,2]for t in names]
        raw=np.tile(np.arange(1,61,dtype=np.int16),(1,2))
        def set_slot(physical,value):
            j=keys.index(physical);other=next(k for k,p in enumerate(keys)if p[1:]==physical[1:]and raw[0,k]==value)
            raw[0,j],raw[0,other]=raw[0,other],raw[0,j]
        set_slot(('NYK',2025,2),39);set_slot(('CHI',2025,2),56)
        common=dict(known_from='2022-01-01',reviewed=True,source='Reviewed protection/penalty fixture')
        rules=[dict(common,rule_id='CHI_SECOND_PROTECTED_TOP55',order=0,kind='protected_chain',from_team='CHI',to_team='SAS',branches=[dict(pick=['CHI',2025,2],protected_ranges=[[31,55]])],fallback_picks=[]),
               dict(common,rule_id='NYK_PENALTY',order=1,kind='transfer',pick=['NYK',2025,2],from_team='NYK',to_team='FORFEITED'),
               dict(common,rule_id='CHI_NEXT_AVAILABLE',order=2,kind='forfeit_next_available_second',target_team='CHI',first_eligible_year=2025,allowed_candidates=[['CHI',2025,2],['CHI',2026,2]])]
        owners=allocate_vector(raw,keys,rules,'2026-01-01')
        for _ in range(4):
            condition,_=actual_number_arrays(raw,owners,keys,OWNER_INDEX['FORFEITED'])
            updated=allocate_vector(raw,keys,rules,'2026-01-01',condition)
            if np.array_equal(updated,owners):break
            owners=updated
        else:self.fail('A removed pick was incorrectly restored to pre-penalty rank, producing an ownership cycle')
        self.assertEqual(owners[0,keys.index(('CHI',2025,2))],OWNER_INDEX['FORFEITED'])
        self.assertEqual(owners[0,keys.index(('CHI',2026,2))],OWNER_INDEX['CHI'])
        self.assertEqual(condition[0,keys.index(('CHI',2025,2))],55)

if __name__=='__main__':unittest.main()
