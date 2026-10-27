"""Reconstruct dated contract schedules from SalarySwish original contract tables.

Only factual table fields are parsed. Contemporary option exercise/decline state
is NOT copied backward: the original option type remains contingent until a
separate dated transaction resolves it. Sources are retrospective compilations,
not archives of originally published contract models.
"""
from __future__ import annotations
import argparse,concurrent.futures,csv,hashlib,json,re,time,unicodedata,urllib.request,urllib.error,urllib.parse,threading,functools
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
from episode_contracts import annualize_episode

_service_lock=threading.Lock()
_service_overloads=0
_service_circuit=threading.Event()

@functools.lru_cache(maxsize=1)
def max_templates():
 path=Path(__file__).with_name('max_salary_templates.json')
 return json.loads(path.read_text()) if path.exists() else []

class Node:
 def __init__(self,tag='',attrs=()):self.tag=tag;self.attrs=dict(attrs);self.parts=[]
 def text(self):return ' '.join(' '.join(p.text() if isinstance(p,Node) else p for p in self.parts).split())
 def all(self,tag=None,cls=None):
  out=[]
  for p in self.parts:
   if isinstance(p,Node):
    if (not tag or p.tag==tag) and (not cls or cls in p.attrs.get('class','').split()):out.append(p)
    out.extend(p.all(tag,cls))
  return out
class Tree(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs);self.stack[-1].parts.append(n)
  if tag not in ('area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'):self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:self.stack=self.stack[:i];break
 def handle_data(self,data):self.stack[-1].parts.append(data)

def slug(n):
 n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower()
 n=re.sub(r'[^a-z0-9 ]','',n)
 n=re.sub(r' (jr|sr)$',r'\1',n)
 return re.sub(r' +','-',n).strip('-')
def money(s):
 m=re.search(r'\$([\d,]+)',s)
 return float(m.group(1).replace(',','')) if m else None

def annotate_waiver_options(agreement,training_camp=False):
 """Record a narrow, sourced release option rather than a forced full salary.

 Exhibit10/camp and partially guaranteed two-way schedules are the reviewed
 scope. Do not infer original guarantees for arbitrary veteran agreements from
 a current retrospective guarantee cell.
 """
 title=agreement.get('contract_type','').upper()
 camp='EXHIBIT 10'in title or training_camp
 two_way='TWO-WAY'in title
 if not(camp or two_way):return
 for cell in agreement['salaries']:
  amount=cell.get('amount');guarantee=cell.get('guaranteed_amount')
  if amount is None or guarantee is None or not 0<=guarantee<amount:continue
  year=int(cell['year']);vesting_day=18 if two_way and year<=2023 else 8
  cell['waiver_option']={'known_from':agreement['known_from'],
   'guaranteed_amount_before_vesting':guarantee,
   'full_guarantee_from':f'{year}-01-{vesting_day:02d}',
   'source':agreement['source'],
   'scope':'original_training_camp_contract'if camp else'original_partially_guaranteed_two_way',
   'note':'Release option preserves known guarantee floor; remaining full salary is payable only if retained. The date includes the waiver-clearance lead time.'}
 agreement['waiver_option_reviewed']=any('waiver_option'in s for s in agreement['salaries'])

def parse_contracts(html,name,nba_id,url):
 t=Tree();t.feed(html);out=[];issues=[]
 canonical=[n.attrs.get('href','')for n in t.root.all('link')if n.attrs.get('rel')=='canonical' and n.attrs.get('href','').startswith('https://www.salaryswish.com/players/')]
 if len(canonical)==1:url=canonical[0]
 text=t.root.text();dy=re.search(r'DRAFT YEAR\s*:\s*(\d{4})',text,re.I);pick=re.search(r'DRAFTED OVERALL\s*:\s*(\d+)',text,re.I);born=re.search(r'BORN\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})',text,re.I);h=t.root.all('h1')
 profile=dict(source_profile_draft_year=int(dy.group(1))if dy else None,source_profile_draft_pick=int(pick.group(1))if pick else None,source_profile_birthdate=born.group(1)if born else None,source_profile_name=h[0].text().split('#')[0].strip()if h else None)
 for block in t.root.all(cls='sw_playerContract'):
  metas=block.all(cls='sw_playerContract__meta')
  if not metas:continue
  meta=metas[0].text();m=re.search(r'Signing Date\s*:\s*([A-Za-z]+ \d{1,2}, \d{4})',meta)
  if not m:issues.append('missing_signing_date');continue
  known=datetime.strptime(m.group(1),'%B %d, %Y').date().isoformat()
  title=block.all(cls='sw_playerContract__title');title=title[0].text() if title else ''
  seasons=[];errors=[]
  for body in block.all('tbody'):
   for tr in body.all('tr'):
    cells=tr.all('td');texts=[c.text() for c in cells]
    if len(cells)<6:continue
    sm=re.match(r'^(20\d\d)-(\d\d)\b',texts[0])
    if not sm:continue
    yy=int(sm.group(1))+1;amount=money(texts[4]);cap=money(texts[3]);guaranteed=money(texts[5]);option=texts[1].lower()
    if amount is None:errors.append(f'missing_salary_{yy}');continue
    kind='player_option' if 'player' in option else 'team_option' if 'team' in option else 'salary'
    # OptionUsed reflects current hindsight. Retain only as raw diagnostic.
    seasons.append(dict(year=yy,amount=amount,kind=kind,guaranteed_amount=None if kind!='salary' else guaranteed,
      cap_hit=cap,known_from=known,source=url,quality='original_contract_table_retrospective',
      option_used_current_diagnostic=texts[2],option_state_method='original_contingent_option_not_current_resolution',
      maximum_salary=any(n.text().strip().lower()=='max' and 'maximum contract salary' in n.attrs.get('title','').lower()for n in cells[0].all(cls='contract_maximum')),
      raw_salary_text=texts[4]))
  if not seasons:issues.append('empty_salary_table_'+known);continue
  years=[s['year']for s in seasons];contiguous=sorted(years)==list(range(min(years),max(years)+1))
  value=re.search(r'Value\s*:\s*\$([\d,]+)',meta);total=float(value.group(1).replace(',','')) if value else None
  optionoutcomes=[s for s in seasons if s['option_used_current_diagnostic']]
  # Length ranges encode optional seasons; row completeness must be explicit.
  length=re.search(r'Length\s*:\s*(\d+)(?:\s*-\s*(\d+))?\s*year',meta)
  stated_years=int(length.group(2) or length.group(1)) if length else None
  complete=not errors and contiguous and (stated_years is None or len(seasons)==stated_years)
  if not complete:errors.append('salary_table_length_or_contiguity_mismatch')
  team=re.search(r'Signing Team\s*:\s*([A-Z]{2,3})\b',meta)
  cp=re.search(r'Cap %\s*:\s*([\d.]+)',meta)
  details=[n.text()for n in block.all(cls='sw_playerContract__financialDetails')]
  table_complete=complete
  short_episode='10-DAY' in title.upper() or 'REST OF SEASON' in title.upper()
  if short_episode:complete=False;errors.append('short_episode_requires_annual_rate_and_expiry_review')
  maximum_rows=[s['year']for s in seasons if s['maximum_salary']]
  first_cap_known_from=f"{min(years)-1}-07-01"
  max_review=bool(maximum_rows) and known<first_cap_known_from
  if max_review:complete=False;errors.append('future_max_base_or_award_clause_unreviewed')
  a=dict(player_name=name,nba_id=nba_id,known_from=known,salaries=seasons,source=url,
    quality='original_contract_table_retrospective',contract_type=title,
    resets_prior_schedule=('EXTENSION' not in title.upper() and 'RENEGOTIATION' not in title.upper() and ('CONTRACT' in title.upper() or 'OFFER SHEET' in title.upper() or 'QUALIFYING OFFER' in title.upper())),
    signing_team=team.group(1) if team else None,
    expiry_season=max(years),schedule_complete=complete,table_complete=table_complete,source_known_until=max(years),
    max_salary_asof_review_required=max_review,first_cap_known_from=first_cap_known_from if maximum_rows else None,
    amount_terms_fixed_from=first_cap_known_from if max_review else known,
    stated_length=stated_years,stated_total=total,annual_salary_total=sum(s['amount']for s in seasons),
    first_year_cap_pct_current_diagnostic=float(cp.group(1))/100 if cp else None,
    financial_details_current_diagnostic=details,short_episode=short_episode,annual_rate_unresolved_years=[min(years)]if short_episode else[],
    note='Original agreement dates and year amounts from current SalarySwish history. Current Option Used states are diagnostic only. Future maximum-salary cap bases and amended guarantees require as-of review.',
    max_salary_years=[s['year']for s in seasons if s['maximum_salary']],issues=errors)
  template=next((r for r in max_templates()if r['nba_id']==nba_id and r['agreement_known_from']==known),None)
  a.update(profile)
  a['max_salary_asof_formula_verified']=template is not None
  if template:a['max_salary_asof_formula']=template
  annualize_episode(a)
  annotate_waiver_options(a,training_camp='Includes Exhibit 9'in block.text())
  out.append(a)
 return out,issues

def load_players(root,live_pool=None):
 rosters=json.loads((root/'league_ownership/monthly_league_rosters.json').read_text());players={}
 for snapshot in rosters:
  for r in snapshot['roster']:
   pid=r.get('nba_id')
   if pid:players.setdefault(int(pid),dict(nba_id=int(pid),player_name=r['player_name']))
 if live_pool and Path(live_pool).exists():
  for r in json.loads(Path(live_pool).read_text())['players']:
   pid=r.get('nba_id')
   if pid and r.get('pool_status')=='roster' and r.get('team') not in (None,'FA') and not r.get('inactive_confirmed'):
    players.setdefault(int(pid),dict(nba_id=int(pid),player_name=r['player_name'],live_only=True))['current_live_roster']=True
 salaries=list(csv.DictReader((root/'pick_values/salary_sources/historical_player_salaries.csv').open()))
 key=lambda s:re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
 salary={}
 for r in salaries:
  if int(r['season_year'])>=2021:salary[key(r['player'])]=max(salary.get(key(r['player']),0),float(r['salary']))
 for p in players.values():p['priority_salary']=salary.get(key(p['player_name']),0)
 return sorted(players.values(),key=lambda p:-p['priority_salary'])

def canonical_search(name,output,nba_id):
 key=lambda n:re.sub(r'(jr|sr|iii|ii|iv)$','',re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower()))
 url='https://www.salaryswish.com/search?'+urllib.parse.urlencode({'s':name})
 path=output/'raw'/f'search_{nba_id}.html'
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():body=path.read_bytes()
 else:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=30)as r:body=r.read()
  path.write_bytes(body)
 tree=Tree();tree.feed(body.decode())
 hits={a.attrs['href'] for a in tree.root.all('a') if a.attrs.get('href','').startswith('/players/') and key(a.text())==key(name)}
 if len(hits)==1:return 'https://www.salaryswish.com'+hits.pop()
 return None

def fetch_one(p,output,refresh=False,raw_dir=None,asof=None):
 global _service_overloads
 f=(raw_dir or output/'raw')/f"{p['nba_id']}.html";u=p.get('source_url') or 'https://www.salaryswish.com/players/'+slug(p['player_name'])
 sidecar=f.with_suffix('.source.json');existing_metadata={}
 if sidecar.exists():
  existing_metadata=json.loads(sidecar.read_text());existing_url=existing_metadata.get('url','')
  if existing_url.startswith('https://www.salaryswish.com/players/'):u=existing_url
 try:
  if not f.exists() or refresh:
   if _service_circuit.is_set():return dict(**p,status='deferred',url=u,error='Source429/503circuitopen; resumelater',agreements=[])
   req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 (compatible; asset-history-research/1.0)'})
   with urllib.request.urlopen(req,timeout=30)as r:body=r.read()
   if b'sw_playerContract' not in body:
    canonical=canonical_search(p['player_name'],output,p['nba_id'])
    if canonical and canonical!=u:
     u=canonical
     with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30)as r:body=r.read()
    if b'sw_playerContract' not in body:raise ValueError('No original contract table in source or exact-name search')
   tmp=f.with_suffix('.tmp');tmp.write_bytes(body);tmp.replace(f)
   time.sleep(.2)
  body=f.read_bytes();agreements,issues=parse_contracts(body.decode('utf-8'),p['player_name'],p['nba_id'],u)
  if agreements:u=agreements[0]['source']
  f.with_suffix('.source.json').write_text(json.dumps({**existing_metadata,'url':u,'sha256':hashlib.sha256(body).hexdigest(),'retrieved_at':datetime.fromtimestamp(f.stat().st_mtime,timezone.utc).isoformat()}))
  # Do not emit irrelevant ancient contracts unless they overlap scope.
  cutoff=asof or datetime.now(timezone.utc).date().isoformat()
  relevant=[a for a in agreements if a['expiry_season']>=2022 and a['known_from']<=cutoff]
  return dict(**p,status='available' if relevant else 'no_in_scope_contract',url=u,agreements=relevant,parse_issues=issues,sha256=hashlib.sha256(body).hexdigest())
 except Exception as e:
  if isinstance(e,urllib.error.HTTPError) and e.code in (429,503):
   with _service_lock:
    _service_overloads+=1
    if _service_overloads>=3:_service_circuit.set()
  return dict(**p,status='unavailable',url=u,error=type(e).__name__+': '+str(e),agreements=[])

def build(root,output,limit=None,workers=4,refresh=False,live_pool=None):
 output.mkdir(parents=True,exist_ok=True);(output/'raw').mkdir(exist_ok=True)
 players=load_players(root,live_pool)
 canonical={}
 for index in (output/'raw').glob('index_*.json'):
  for name,url in json.loads(index.read_text()):canonical[name]='https://www.salaryswish.com'+url
 for player in players:
  if player['player_name'] in canonical:player['source_url']=canonical[player['player_name']]
 if limit:players=players[:limit]
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers)as ex:
  for i,r in enumerate(ex.map(lambda p:fetch_one(p,output,refresh),players),1):
   results.append(r)
   if i%10==0 or i==len(players):
    write_outputs(results,players,output)
    print(json.dumps(dict(done=i,total=len(players),available=sum(r['status']=='available' for r in results),unavailable=sum(r['status']=='unavailable'for r in results))),flush=True)
 write_outputs(results,players,output)

def option_adjustments(agreements):
 out=[]
 for a in agreements:
  for s in a['salaries']:
   text=s.get('option_used_current_diagnostic','');m=re.search(r'^(Yes|No)\s*\(([A-Za-z]+ \d{1,2}, \d{4})\)',text)
   if not m:continue
   try:dt=datetime.strptime(m.group(2),'%b %d, %Y').date().isoformat()
   except ValueError:
    try:dt=datetime.strptime(m.group(2),'%B %d, %Y').date().isoformat()
    except ValueError:continue
   out.append(dict(player_name=a['player_name'],nba_id=a['nba_id'],known_from=dt,remove_years=[s['year']] if m.group(1)=='No' else [],exercise_years=[s['year']] if m.group(1)=='Yes' else [],source=a['source'],quality='dated_option_resolution_from_contract_history'))
 return out

def write_outputs(results,players,output):
 agreements=[a for r in results for a in r['agreements']]
 supplement_file=Path(__file__).with_name('supplemental_contract_agreements.json');supplements=json.loads(supplement_file.read_text())if supplement_file.exists()else[]
 requested_ids={p['nba_id']for p in players};existing_keys={(a['nba_id'],a['known_from'])for a in agreements}
 supplements=[a for a in supplements if a['nba_id']in requested_ids and(a['nba_id'],a['known_from'])not in existing_keys]
 agreements.extend(supplements);agreements.sort(key=lambda a:(a['known_from'],a['nba_id']))
 coverage=dict(generated_at=datetime.now(timezone.utc).isoformat(),scope='2021-12-31 through 2026-10-26',requested_players=len(players),processed_players=len(results),available_players=sum(r['status']=='available'for r in results),agreements=len(agreements),schedule_complete_agreements=sum(a['schedule_complete']for a in agreements),supplemental_estimated_agreements=len(supplements),supplemental_estimated_players=[a['player_name']for a in supplements],results=[{k:v for k,v in r.items()if k!='agreements'}for r in results],limitations=['Retrospective original-contract tables are not publication-vintage archives.','Current option exercise/decline labels cannot resolve an earlier option; dated events required.','Maximum salary starting in a then-future season depends on as-of projected cap and performance triggers; current realized cap bases require adaptation.','Historical partial guarantees can be amended. Source-reported guarantee cells need dated original-term review.'])
 for name,x in [('contract_agreements.json',agreements),('contract_adjustments.json',option_adjustments(agreements)),('coverage.json',coverage)]:
  f=output/name;tmp=f.with_suffix('.tmp');tmp.write_text(json.dumps(x,indent=2,allow_nan=False));tmp.replace(f)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--limit',type=int);p.add_argument('--workers',type=int,default=4);p.add_argument('--refresh',action='store_true');p.add_argument('--live-pool',type=Path);a=p.parse_args();build(a.sources,a.output,a.limit,a.workers,a.refresh,a.live_pool)
