"""Original first-round swap/deferral clauses known at the 2021 baseline."""
from copy import deepcopy

EXACT_SWAP_SOURCE='https://sportstwo.com/threads/around-the-nba-2022-offseason.376888/page-5'
ORIGINAL_OKC_SOURCE='https://boomtownhoops.com/prestis-war-chest-of-assets-explained/'

def rules(candidates,order_start=2000):
 byidx={r['idx']:r for r in candidates};out=[]
 def add(idx,rid,kind,refs,**kw):
  c=byidx[idx];out.append(dict(rule_id=rid,known_from=c['date'],order=order_start+len(out),kind=kind,reviewed=True,source=c['source'],source_candidate_index=idx,reviewed_coverage_refs=refs,**kw))
 def swap(idx,rid,left,right,leftowner,rightowner):add(idx,rid,'swap',[left,right],left_pick=left,right_pick=right,left_owner=leftowner,right_owner=rightowner)
 swap(32,'OKC_LAC_2023_SWAP',['OKC',2023,1],['LAC',2023,1],'OKC','LAC')
 out[-1]['source_crosschecks']=[ORIGINAL_OKC_SOURCE]
 # The original clause permits exchanging OKC's own pick for EITHER eligible
 # HOU or LAC. Choose one candidate; successive swaps alter the other teams'
 # residual entitlements and are not equivalent.
 add(33,'OKC_HOU_LAC_2025_OPTION','best_option_swap',[[t,2025,1]for t in('OKC','HOU','LAC')],left_pick=['OKC',2025,1],left_owner='OKC',options=[dict(pick=['HOU',2025,1],owner='HOU',protected_ranges=[[1,10]]),dict(pick=['LAC',2025,1],owner='LAC',protected_ranges=[])],source_crosschecks=[ORIGINAL_OKC_SOURCE,EXACT_SWAP_SOURCE])
 for y in(2023,2027):swap(68,f'HOU_BKN_{y}_HARDEN_SWAP',['HOU',y,1],['BKN',y,1],'HOU','BKN')
 add(68,'HOU_BKN_2025_POST_OKC_SWAP','holder_swap',[[t,2025,1]for t in('HOU','OKC','BKN')],left_pool=[['HOU',2025,1],['OKC',2025,1]],left_owner='HOU',right_pick=['BKN',2025,1],right_owner='BKN',source_crosschecks=[EXACT_SWAP_SOURCE])
 # Harden gave Houston the Brooklyn2022first; the March2021 Oladipo trade
 # allowed Houston to improve THAT acquired first using Miami's2022first.
 add(68,'BKN_2022_HARDEN_TO_HOU','transfer',[['BKN',2022,1]],pick=['BKN',2022,1],from_team='BKN',to_team='HOU')
 # The protected mixed-round HOU/BKN/MIA2022 basket is defined by second_basket_baseline.
 for y in(2024,2026):swap(57,f'NOP_MIL_{y}_JRUE_SWAP',['NOP',y,1],['MIL',y,1],'NOP','MIL')
 swap(24,'NOP_LAL_2023_AD_SWAP',['NOP',2023,1],['LAL',2023,1],'NOP','LAL')
 add(24,'NOP_LAL_2024_OR_2025_AD_CHOICE','deferred_choice',[['LAL',2024,1],['LAL',2025,1]],earlier_pick=['LAL',2024,1],later_pick=['LAL',2025,1],from_team='LAL',to_team='NOP',policy_information='At2024decision, known2024slot versus model2025EV conditional on2024slot. Never choose using the realized2025draw.',valuation_policy_approximation='Slot-only conditional information; richer2024observable-state option valuation is not reconstructed.')
 out.append(dict(rule_id='OPEN_MEM_BOS_2026_SECOND_SWAP',kind='holder_swap',known_from='2021-09-15',order=order_start+len(out),reviewed=True,source='https://basketball.realgm.com/nba/transactions/league/2022',source_crosschecks=['https://en.wikipedia.org/wiki/List_of_2021%E2%80%9322_NBA_season_transactions','https://www.basketball-reference.com/leagues/NBA_2022_transactions.html'],reviewed_coverage_refs=[[t,2026,2]for t in('IND','MIA','BOS')],left_pool=[['IND',2026,2],['MIA',2026,2]],left_owner='MEM',right_pick=['BOS',2026,2],right_owner='BOS',baseline_only=True,review_asof='2021-12-31'))
 return out
