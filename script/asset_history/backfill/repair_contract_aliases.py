"""One bounded alias-repair pass, requiring identity or matching draft proof."""
import argparse,concurrent.futures,csv,hashlib,json,re,unicodedata,urllib.parse,urllib.request
from collections import defaultdict
from pathlib import Path
from contracts import Tree,parse_contracts,fetch_one

def norm(n):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower())
def lastname(n):
 tokens=re.findall('[a-z]+',unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower())
 while tokens and tokens[-1]in('jr','sr','ii','iii','iv'):tokens.pop()
 return tokens[-1]if tokens else''
def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);p.add_argument('--workers',type=int,default=4);a=p.parse_args();root=a.sources.parent;output=a.contracts;coverage=json.loads((output/'coverage.json').read_text());todo=[r for r in coverage['results']if r['status']=='unavailable'];aliases=defaultdict(set)
 for f in (root/'app_model').glob('impact_*.json'):
  for r in json.loads(f.read_text()):
   if r.get('nba_id'):aliases[int(r['nba_id'])].add(r['player_name'])
 for e in json.loads((a.sources/'league_ownership/league_events.json').read_text()):
  for r in e['players']:
   if r.get('nba_id'):aliases[int(r['nba_id'])].add(r['name'])
 draft={norm(r['player']):(int(r['draft_year']),int(r['pick_overall']))for r in csv.DictReader((root/'app_model/processed/draft/draft_picks_all_classes.csv').open())if r['pick_overall']}
 def repair(player):
  pid=player['nba_id'];name=player['player_name'];names={name,*aliases[pid]};expected=next((draft[norm(n)]for n in names if norm(n)in draft),None);candidates={}
  paths=list((output/'raw').glob(f'search_{pid}*.html'))
  # A surname lookup is a bounded alias discovery, never a fuzzy identity match.
  query=lastname(name);path=output/'raw'/f'search_{pid}_surname.html'
  if not path.exists():
   try:
    with urllib.request.urlopen('https://www.salaryswish.com/search?'+urllib.parse.urlencode({'s':query}),timeout=25)as response:body=response.read()
    path.write_bytes(body)
   except Exception as e:return {'nba_id':pid,'player_name':name,'status':'search_unavailable','error':str(e)}
  if path not in paths:paths.append(path)
  for path in paths:
   tree=Tree();tree.feed(path.read_text())
   for link in tree.root.all('a'):
    href=link.attrs.get('href','');label=link.text()
    if not href.startswith('/players/'):continue
    exact=norm(label)in{norm(n)for n in names}
    related=lastname(label)==query or set(label.lower().split())==set(name.lower().split())
    if exact or related:candidates['https://www.salaryswish.com'+href]=(label,exact)
  valid=[];errors=[]
  for url,(label,exact)in sorted(candidates.items(),key=lambda item:(not item[1][1],item[0]))[:4]:
   try:
    with urllib.request.urlopen(url,timeout=25)as response:body=response.read()
    rows,issues=parse_contracts(body.decode(),name,pid,url)
    if not rows:continue
    tree=Tree();tree.feed(body.decode());text=tree.root.text();dy=re.search(r'DRAFT YEAR\s*:\s*(\d{4})',text,re.I);slot=re.search(r'DRAFTED OVERALL\s*:\s*(\d+)',text,re.I)
    proof=(int(dy.group(1)),int(slot.group(1)))if dy and slot else None
    if not(exact or expected and proof==expected):continue
    valid.append((url,body,rows,dict(source_name=label,exact_source_name_or_trusted_alias=exact,expected_draft=expected,source_draft=proof)))
   except Exception as e:errors.append(str(e))
  # Duplicate source profiles are acceptable only if the parsed original tables agree.
  def signature(rows):return [(r['known_from'],[(s['year'],s['amount'],s['kind'])for s in r['salaries']])for r in rows]
  if valid and all(signature(v[2])==signature(valid[0][2])for v in valid):
   url,body,rows,proof=valid[0];f=output/'raw'/f'{pid}.html';f.write_bytes(body);f.with_suffix('.source.json').write_text(json.dumps({'url':url,'sha256':hashlib.sha256(body).hexdigest(),'identity_proof':proof}))
   return {'nba_id':pid,'player_name':name,'status':'repaired','source':url,'identity_proof':proof}
  return {'nba_id':pid,'player_name':name,'status':'unresolved_conflicting_profiles'if valid else'no_verified_contract_profile','candidate_urls':list(candidates),'errors':errors}
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as ex:
  results=[]
  for r in ex.map(repair,todo):results.append(r);print(json.dumps(r),flush=True)
 (output/'alias_repair_audit.json').write_text(json.dumps(results,indent=2));print(json.dumps({'attempted':len(results),'repaired':sum(r['status']=='repaired'for r in results)}))
if __name__=='__main__':main()
