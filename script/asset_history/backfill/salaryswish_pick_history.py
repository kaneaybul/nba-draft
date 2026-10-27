"""Cache public SalarySwish trade history using its published Load More endpoint.

Original clauses and subsequent reported resolutions are kept separate. These
are entitlement-review inputs, never an assertion of historical legal ownership.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, urllib.parse, urllib.request
from datetime import datetime,timezone
from pathlib import Path
from lxml import html

TEAM_ALIASES={'Philadelphia 76ers':'PHI','Philadelphia Sixers':'PHI','L.A. Clippers':'LAC','L.A. Lakers':'LAL','LA Clippers':'LAC','LA Lakers':'LAL'}
from pick_event_evidence import TEAMS
TEAM_ALIASES.update(TEAMS)
ORIGIN_ALIASES={'UTH':'UTA','PHL':'PHI','BRK':'BKN','PHO':'PHX','CHO':'CHA','NOH':'NOP','NOR':'NOP','SAN':'SAS','GS':'GSW','NO':'NOP','NY':'NYK','SA':'SAS'}

def clean(s):return re.sub(r'\s+',' ',s).strip()
def parse_rows(fragment,source,season,page):
 root=html.fromstring('<table><tbody>'+fragment+'</tbody></table>');trades=[];current=None
 for tr in root.xpath('.//tr'):
  cells=tr.xpath('./td')
  if not cells:continue
  raw=clean(cells[0].text_content())
  try:dt=datetime.strptime(raw,'%b %d, %Y').date().isoformat()
  except ValueError:dt=None
  if dt:
   current={'date':dt,'recipients':[],'source':source,'source_season':season,'source_page':page,'status':'requires_joint_entitlement_review'};trades.append(current)
  if current is None:continue
  for td in cells:
   heading=td.xpath('.//h6')
   if not heading:continue
   h=heading[0];teamname=clean(h.text_content()).removesuffix(' Acquire:').strip();team=TEAM_ALIASES.get(teamname)
   wrappers=h.getparent().xpath('./div')
   if not wrappers:continue
   block=wrappers[0];items=[];terms=[];results=[]
   for div in block.xpath('./div'):
    text=clean(div.text_content());cls=div.get('class','')
    if 'trade_cond'in cls:
     if re.search(r'(?:Protected|Conditional) Result:',text):results.append(text);continue
     parts=re.split(r'\*+Result:|\bResult:',text,maxsplit=1)
     original=re.sub(r'\s*\((?:DID NOT transfer|DID Transfer|Voided)\)','',parts[0],flags=re.I)
     terms.append(original)
     if len(parts)>1:results.append(parts[1])
    elif re.search(r'\b20\d\d\s+[12](?:st|nd)\s+round\s+pick',text,re.I):
     m=re.search(r'\b(20\d\d)\s+([12])(?:st|nd)\s+round\s+pick\s*\(([^)]+)\)',text,re.I)
     if m:
      inside=m[3];origin=re.split(r'\s*[-#]',inside)[0].strip();origin=ORIGIN_ALIASES.get(origin,origin)
      items.append({'draft_year':int(m[1]),'round':int(m[2]),'origin_team':origin,'label_without_realized_selection':f'{m[1]} round {m[2]} ({origin})','protected':'[Protected]'in text,'conditional':'[Conditional]'in text,'reported_selection_hindsight':inside if '#'in inside else None})
   current['recipients'].append({'team':team,'source_team_name':teamname,'pick_references':items,'original_reported_terms':terms,'subsequent_reported_results':results})
 return trades

def fetch_season(args):
 season,out=args;rawdir=out/'raw';rawdir.mkdir(exist_ok=True,parents=True);alltrades=[];pages=[];date='';tid=0;seen=set()
 for page in range(150):
  params={'season':season,'offset-date':date,'offset-trade_id':tid};url='https://www.salaryswish.com/ajax2/trades?'+urllib.parse.urlencode(params);path=rawdir/f'salaryswish_{season}_{page:03d}.json'
  try:
   if path.exists():b=path.read_bytes()
   else:
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':f'https://www.salaryswish.com/trades/{season}'})
    with urllib.request.urlopen(req,timeout=40)as r:b=r.read()
    tmp=path.with_suffix('.tmp');tmp.write_bytes(b);tmp.replace(path)
   x=json.loads(b);assert x['meta']['code']==200,x['meta'];data=x['data'];fragment=data.get('html','');trades=parse_rows(fragment,url,season,page)if fragment else[]
   pages.append({'page':page,'source':url,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'trade_rows':len(trades),'result_count':data.get('result_count')})
   alltrades.extend(trades)
   nxt=data.get('pagination')or{};cursor=(nxt.get('date'),nxt.get('tradeId'))
   if not trades or cursor in seen or not all(cursor):break
   seen.add(cursor);date,tid=cursor
  except Exception as e:return {'season':season,'status':'incomplete','pages':pages,'trades':alltrades,'error':type(e).__name__+': '+str(e)}
 else:return {'season':season,'status':'incomplete','pages':pages,'trades':alltrades,'error':'pagination_limit'}
 return {'season':season,'status':'retrieved_to_end','pages':pages,'trades':alltrades}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--first',type=int,default=2015);p.add_argument('--last',type=int,default=2027);p.add_argument('--workers',type=int,default=4);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  for x in pool.map(fetch_season,[(y,a.output)for y in range(a.first,a.last+1)]):
   results.append(x);(a.output/f'salaryswish_trade_evidence_{x["season"]}.json').write_text(json.dumps(x,indent=2));print(x['season'],x['status'],len(x['pages']),len(x['trades']),flush=True)
 alltrades=[t for x in results for t in x['trades']];unique={hashlib.sha256(json.dumps([t['date'],t['recipients']],sort_keys=True).encode()).hexdigest():t for t in alltrades}
 manifest={'generated_at':datetime.now(timezone.utc).isoformat(),'years':[{k:v for k,v in x.items()if k!='trades'}for x in results],'unique_trade_groups':len(unique),'pick_references':sum(len(r['pick_references'])for t in unique.values()for r in t['recipients']),'teams':sorted(set(r['team']for t in unique.values()for r in t['recipients']if r['team'])),'not_an_inventory':True}
 (a.output/'salaryswish_trade_manifest.json').write_text(json.dumps(manifest,indent=2));(a.output/'salaryswish_trade_evidence_all.json').write_text(json.dumps(list(unique.values()),indent=2))
if __name__=='__main__':main()
