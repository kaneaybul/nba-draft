"""Cache the source pages behind curated injury evidence; bounded, resumable."""
import argparse,concurrent.futures,hashlib,json,time,urllib.request
from pathlib import Path

def fetch(item):
 url,directory=item;filename=hashlib.sha256(url.encode()).hexdigest()+'.html';path=directory/filename
 try:
  if not path.exists():
   req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
   with urllib.request.urlopen(req,timeout=18) as r:b=r.read()
   path.write_bytes(b)
  b=path.read_bytes()
  return {'url':url,'path':'raw/'+filename,'status':'cached','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 except Exception as e:return {'url':url,'status':'source_fetch_failed','error':type(e).__name__+': '+str(e)}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,required=True);p.add_argument('--workers',type=int,default=3);a=p.parse_args()
 raw=a.directory/'raw';raw.mkdir(parents=True,exist_ok=True);urls=set()
 for f in ['major_injury_additions.json','uncertain_injury_review.json']:
  path=a.directory/f
  if path.exists():
   for r in json.loads(path.read_text())['records']:
    urls.add(r['source'])
    if r.get('observed_return_source'):urls.add(r['observed_return_source'])
 with concurrent.futures.ThreadPoolExecutor(max_workers=min(4,a.workers))as ex:rows=list(ex.map(fetch,[(url,raw)for url in sorted(urls)]))
 (a.directory/'source_cache_manifest.json').write_text(json.dumps(rows,indent=2))
 print(json.dumps({'sources':len(rows),'cached':sum(r['status']=='cached'for r in rows),'failed':sum(r['status']!='cached'for r in rows)}))
