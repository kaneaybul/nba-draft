"""Extract dated pick-transfer evidence from the full NBA transaction register.

These are legal-review candidates, not priced entitlement IDs. A protected first
with rolling years and a second-round fallback must eventually become one
contingent asset; the mentions below must never be summed as independent picks.
"""
import argparse, collections, json, re
from pathlib import Path
TEAMS={'Atlanta Hawks':'ATL','Boston Celtics':'BOS','Brooklyn Nets':'BKN','Charlotte Hornets':'CHA','Chicago Bulls':'CHI','Cleveland Cavaliers':'CLE','Dallas Mavericks':'DAL','Denver Nuggets':'DEN','Detroit Pistons':'DET','Golden State Warriors':'GSW','Houston Rockets':'HOU','Indiana Pacers':'IND','Los Angeles Clippers':'LAC','Los Angeles Lakers':'LAL','Memphis Grizzlies':'MEM','Miami Heat':'MIA','Milwaukee Bucks':'MIL','Minnesota Timberwolves':'MIN','New Orleans Pelicans':'NOP','New York Knicks':'NYK','Oklahoma City Thunder':'OKC','Orlando Magic':'ORL','Philadelphia Sixers':'PHI','Phoenix Suns':'PHX','Portland Trail Blazers':'POR','Sacramento Kings':'SAC','San Antonio Spurs':'SAS','Toronto Raptors':'TOR','Utah Jazz':'UTA','Washington Wizards':'WAS'}
ALIASES={'UTH':'UTA','PHL':'PHI','BRK':'BKN','PHO':'PHX','CHO':'CHA','NOH':'NOP','NOR':'NOP','SAN':'SAS'}
MENTION=re.compile(r'(?P<qualifier>conditional |More Favorable |Least Favorable |Most Favorable |Less Favorable |Swap )?(?P<year>20\d\d)\s+(?P<round>[12])(?:st|nd)\s+[Rr]ound\s+[Pp]icks?(?:\s*\((?P<origin>[A-Z]{2,3}) own\))?')

def mentions(text,from_team,to_team):
 out=[]
 for m in MENTION.finditer(text):
  qualifier=(m['qualifier']or'').strip();origin=m['origin'];origin=ALIASES.get(origin,origin)
  simple=bool(origin and not qualifier)
  out.append({'draft_year':int(m['year']),'round':int(m['round']),'origin_team':origin,'from_team':from_team,'to_team':to_team,'wording':m[0],'qualifier':qualifier or None,'review_status':'explicit_origin_transfer_still_requires_terms_confirmation'if simple else'conditional_or_origin_unresolved','kind':'swap_right'if qualifier.lower()=='swap'else'pick_reference'})
 return out

def extract(event):
 txt=event['text'];marker=re.search(r' (?:was|were) acquired by the (.+?) from the (.+?) in exchange for:',txt)
 if marker and marker[1]in TEAMS and marker[2]in TEAMS:
  target,source=TEAMS[marker[1]],TEAMS[marker[2]]
  ins=mentions(txt[:marker.start()],source,target);outs=mentions(txt[marker.end():],target,source)
  return ins+outs
 # Multi-team register has one received-assets clause per recipient. Origin
 # club is not necessarily the immediate sender of a re-traded entitlement.
 result=[]
 leg=re.compile(r'(.*?) (?:was|were) acquired by the (.+?) in exchange for (.*?)(?=\.(?: |$))')
 for m in leg.finditer(txt):
  if m[2]in TEAMS:result.extend(mentions(m[1],None,TEAMS[m[2]]))
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--events',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();events=json.loads(a.events.read_text());out=[]
 for e in events:
  if 'trade'not in e['parsed_status']:continue
  refs=extract(e)
  if refs or re.search(r'\b(?:pick|picks)\b',e['text'],re.I):
   out.append({'event_id':e['event_id'],'known_from':e['date'],'source':e['source'],'source_text':e['text'],'references':refs,'status':'references_extracted_requires_entitlement_review'if refs else'pick_text_unparsed','parse_scope':'No baseline ownership, protection resolution, forfeiture or draft settlement asserted'})
 a.output.mkdir(parents=True,exist_ok=True);(a.output/'dated_pick_event_evidence.json').write_text(json.dumps(out,indent=2))
 report={'source_events':len(events),'trade_events':sum('trade'in e['parsed_status']for e in events),'pick_bearing_events':len(out),'extracted_references':sum(len(e['references'])for e in out),'event_status_counts':dict(collections.Counter(e['status']for e in out)),'reference_status_counts':dict(collections.Counter(r['review_status']for e in out for r in e['references'])),'critical_missing_inputs':['2021-12-31 complete opening contingent rights for all 30 teams','Original dated protection and rollover terms, including later modifications','Joint entitlement allocation for baskets and nested swaps','Historical forfeitures, non-conveyances and resolution-date settlement'],'usable_as_inventory':False}
 (a.output/'pick_reconstruction_coverage.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
