"""Retrieve complete dated league registers covering opening pick trade windows."""
import argparse,concurrent.futures,hashlib,json,re,urllib.request
from datetime import datetime
from pathlib import Path
from lxml import html

def one(args):
 year,out,asof=args;url=f'https://basketball.realgm.com/nba/transactions/league/{year}';p=out/'raw'/f'realgm_league_{year}.html';p.parent.mkdir(exist_ok=True,parents=True)
 if not p.exists():
  b=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=45).read();tmp=p.with_suffix('.tmp');tmp.write_bytes(b);tmp.replace(p)
 b=p.read_bytes();doc=html.fromstring(b);main=doc.xpath('//div[@class="large-column-left"]')[-1];dt=None;events=[];dates=[]
 for el in main.iter():
  if el.tag=='h3':
   m=re.search(r'[A-Z][a-z]{2} \d{1,2}, \d{4}',el.text_content())
   if m:dt=datetime.strptime(m[0],'%b %d, %Y').date().isoformat();dates.append(dt)
  if el.tag!='li'or not dt or dt>asof:continue
  text=' '.join(el.text_content().split())
  if 'acquired'in text:events.append(dict(date=dt,text=text,source=url))
 audit=dict(season=year,source=url,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),dated_groups=len(dates),first_group=min(dates)if dates else None,last_group=max(dates)if dates else None,prebaseline_trade_records=len(events),pagination_links=[h for h in doc.xpath('//a/@href')if f'/transactions/league/{year}/'in h])
 if not dates or audit['pagination_links']:raise ValueError('Source register incomplete or paginated')
 return events,audit

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--first',type=int,default=2015);p.add_argument('--last',type=int,default=2022);p.add_argument('--asof',default='2021-12-31');a=p.parse_args();a.output.mkdir(exist_ok=True,parents=True);events=[];audits=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
  for e,c in pool.map(one,[(y,a.output,a.asof)for y in range(a.first,a.last+1)]):events.extend(e);audits.append(c);print(c['season'],len(e),flush=True)
 (a.output/'pre2022_realgm_trade_events.json').write_text(json.dumps(events,indent=2));(a.output/'pre2022_realgm_source_coverage.json').write_text(json.dumps(audits,indent=2))
if __name__=='__main__':main()
