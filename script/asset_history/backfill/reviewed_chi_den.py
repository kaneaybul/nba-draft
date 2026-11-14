"""Reviewed 2021-12-31 opening obligations: CHI, DEN and NOP firsts.

Uses original clauses, never the retrospective displayed player/slot label.
Chicago's 2021 first had already conveyed before this baseline, so its second
Vucevic obligation opens in2023. Dependent DEN/CHI claims require the preceding
first actually to convey; Stepien spacing alone is insufficient.
"""
from copy import deepcopy
import json
from pathlib import Path

EXPECTED={58:('2020-11-24','OKC'),82:('2021-03-25','ORL'),84:('2021-03-25','ORL'),109:('2021-08-11','SAS'),101:('2021-08-07','CHA')}
SUPPORT={
 'CHI_VUCEVIC_2021':[
  'https://www.nba.com/bulls/news/heres-who-the-bulls-should-consider-taking-if-they-jump-up-in-the-2023-nba-draft-lottery',
  'https://en.wikipedia.org/wiki/List_of_2020%E2%80%9321_NBA_season_transactions#Notes',
  'https://pippenainteasy.com/2021/06/30/chicago-bulls-draft-picks/'],
 'CHI_DEROZAN_2021':[
  'https://www.nba.com/bulls/news/bulls-acquire-demar-derozan',
  'https://abcnews.com/Sports/source-chicago-bulls-demar-derozan-finalizing-sign-trade/story?id=79248788',
  'https://www.bleachernation.com/bulls/2024/01/26/chicago-bulls-draft-picks/'],
 'DEN_HAMPTON_2020':[
  'https://www.nba.com/nuggets/news/nuggets-pick-zeke-rj-202011',
  'https://boomtownhoops.com/prestis-war-chest-of-assets-explained/'],
 'DEN_GORDON_2021':[
  'https://www.hoopsrumors.com/2021/03/nuggets-magic-nearing-aaron-gordon-trade.html',
  'https://www.nbcsports.com/nba/news/report-nuggets-get-their-forward-with-aaron-gordon-trade'],
 'NOP_GRAHAM_2021':[
  'https://www.nba.com/pelicans/news/pelicans-acquire-jonas-valanciunas-devonte-graham-three-team-trade-memphis-grizzlies-charlotte-hornets',
  'https://www.charlotteobserver.com/sports/charlotte-hornets/article253377203.html']}

def rules(candidates,order_start=1000):
 byidx={r['idx']:r for r in candidates};result=[]
 def chain(idx,rid,origin,target,years,cuts,fallback=(),dependency=None):
  c=byidx[idx]
  if (c['date'],c['team'])!=EXPECTED[idx]:raise ValueError('Opening evidence changed; re-review '+str(idx))
  branches=[dict(pick=[origin,y,1],protected_ranges=[[1,cut]])for y,cut in zip(years,cuts)]
  fallbacks=[[origin,y,2]for y in fallback]
  r=dict(rule_id=rid,known_from=c['date'],order=order_start+len(result),kind='protected_chain',from_team=origin,to_team=target,branches=branches,fallback_picks=fallbacks,reviewed=True,source=c['source'],source_candidate_index=idx,source_crosschecks=SUPPORT[rid],reviewed_coverage_refs=[b['pick']for b in branches]+fallbacks)
  if dependency:r.update(requires_gap_after_rule=dependency,minimum_gap_years=2,requires_prior_conveyance=True)
  result.append(r)
 chain(58,'DEN_HAMPTON_2020','DEN','OKC',[2023,2024,2025],[14,14,14],[2025,2026])
 chain(82,'DEN_GORDON_2021','DEN','ORL',[2025,2026,2027],[5,5,5],dependency='DEN_HAMPTON_2020')
 chain(84,'CHI_VUCEVIC_2021','CHI','ORL',[2023,2024],[4,3],[2026,2027])
 chain(109,'CHI_DEROZAN_2021','CHI','SAS',[2025,2026,2027],[10,8,8],[2028],dependency='CHI_VUCEVIC_2021')
 chain(101,'NOP_GRAHAM_2021','NOP','CHA',[2022],[14],[2022,2024])
 result[-1]['source_correction']='SalarySwish names NewOrleans as fallback recipient; original team release and CharlotteObserver identify Charlotte. No realized 2022 slot used.'
 return result

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--candidates',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=rules(json.loads(a.candidates.read_text()));a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps({'asof':'2021-12-31','rules':out,'source_review':'Original terms checked separately from resolved player/slot labels.'},indent=2));print('reviewed rules',len(out))
