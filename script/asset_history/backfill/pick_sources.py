"""Retrieve dated pick-right evidence; do not mistake extracted text for legal ownership.

A slot's current realized trade chain cannot be used as its ex ante contingent
entitlement. This resumable evidence collector preserves that distinction.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, time, urllib.request
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path

class Rows(HTMLParser):
    def __init__(self):
        super().__init__();self.rows=[];self.row=None;self.cell=None;self.depth=0
    def handle_starttag(self,tag,attrs):
        if tag=='tr':self.row=[]
        if tag in ('td','th') and self.row is not None:self.cell=[]
        if tag in ('br','p') and self.cell is not None:self.cell.append(' ')
        if tag=='img' and self.cell is not None:
            alt=dict(attrs).get('alt','');self.cell.append(' '+alt+' ')
    def handle_data(self,data):
        if self.cell is not None:self.cell.append(data)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None and self.row is not None:
            self.row.append(re.sub(r'\s+',' ',''.join(self.cell)).strip());self.cell=None
        if tag=='tr' and self.row is not None:
            if self.row:self.rows.append(self.row)
            self.row=None

def fetch(item):
    kind,year,url,out=item;local=out/'raw'/f'{kind}_{year}.html';local.parent.mkdir(parents=True,exist_ok=True)
    try:
        if local.exists():data=local.read_bytes()
        else:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=45)as r:data=r.read()
            temp=local.with_suffix('.tmp');temp.write_bytes(data);temp.replace(local)
        text=data.decode('utf-8',errors='replace');parser=Rows();parser.feed(text)
        if len(parser.rows)<5:raise ValueError('No substantive source table')
        rows=[]
        for i,cells in enumerate(parser.rows):
            joined=' | '.join(cells)
            dates=sorted(set(re.findall(r'\bon\s+(\d{4}-\d{2}-\d{2})',joined)))
            if dates or 'protected' in joined.lower() or 'swap' in joined.lower():
                rows.append({'row_index':i,'cells':cells,'transaction_dates':dates,'has_conditional_terms':bool(re.search('protect|swap|favorable|favourable|convey|defer',joined,re.I)),'status':'evidence_requires_entitlement_review','source':url})
        return {'kind':kind,'draft_year':year,'source':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'source_table_rows':len(parser.rows),'evidence_rows':rows,'status':'retrieved'}
    except Exception as e:return {'kind':kind,'draft_year':year,'source':url,'status':'unavailable','error':type(e).__name__+': '+str(e)}

def main():
    a=argparse.ArgumentParser();a.add_argument('--output',type=Path,required=True);a.add_argument('--first',type=int,default=2022);a.add_argument('--last',type=int,default=2033);args=a.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    requests=[('pst',y,f'https://www.prosportstransactions.com/basketball/DraftTrades/Years/{y}.htm',out)for y in range(args.first,args.last+1)]
    requests.append(('realgm','current','https://basketball.realgm.com/nba/draft/future_drafts/detailed',out))
    result=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
        for r in pool.map(fetch,requests):
            result.append(r);(out/'source_evidence.json').write_text(json.dumps(result,indent=2));print(r['kind'],r['draft_year'],r['status'],len(r.get('evidence_rows',[])),flush=True)
    manifest={'generated_at':datetime.now(timezone.utc).isoformat(),'coverage':'Source evidence only. No historical legal ownership or valuations asserted.','sources':[{k:v for k,v in r.items()if k!='evidence_rows'}for r in result],'evidence_rows':sum(len(r.get('evidence_rows',[]))for r in result)}
    (out/'source_manifest.json').write_text(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
