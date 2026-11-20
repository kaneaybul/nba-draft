import json,sys,pathlib,hashlib
P=pathlib.Path
def pid(x):return x.get('source_nba_id') or x['nba_id']
read=lambda p:json.loads(P(p).read_bytes())
sha=lambda p:hashlib.sha256(P(p).read_bytes()).hexdigest()
def merge(base,projection,out):
 raw=base.read_bytes().decode("utf-8");dec=json.JSONDecoder();i=raw.index('[')+1;j=0
 rows=read(projection); update={pid(r):r for r in rows};assert len(rows)==len(update)>0
 chunks=[]
 while True:
  while raw[i].isspace() or raw[i]==',':i+=1
  if raw[i]==']':break
  a,end=dec.raw_decode(raw,i)
  if a.get('pool_status')=='roster':
   b=update.pop(pid(a))
   assert set(a)==set(b) and a['team']==b['team'] and a['contract_pending']==b['contract_pending']
   chunks.extend([raw[j:i],json.dumps(b,separators=(',',':'),allow_nan=False,ensure_ascii=False)]);j=end
  i=end
 assert not update
 chunks.append(raw[j:])
 with out.open('xb') as f:f.write(''.join(chunks).encode('utf-8'))
 assert len(read(out))==len(read(base))
