"""Dated original-team draft orders from official NBA releases.

The pre-lottery releases preserve unresolved second-round tie groups. Full
orders become facts only on the lottery publication date, never beforehand.
Removed picks retain a physical ordering position, separate from actual number.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, urllib.request
from datetime import datetime
from pathlib import Path
from lxml import html

BASE='https://pr.nba.com/'
NAMES=dict(zip(
 ['Atlanta','Brooklyn','Boston','Charlotte','Chicago','Cleveland','Dallas','Denver','Detroit','Golden State','Houston','Indiana','LA Clippers','Los Angeles Lakers','Memphis','Miami','Milwaukee','Minnesota','New Orleans','New York','Oklahoma City','Orlando','Philadelphia','Phoenix','Portland','Sacramento','San Antonio','Toronto','Utah','Washington'],
 'ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()))
NAMES['Los Angeles Clippers']='LAC'
DRAFT_COMPLETION={2021:'2021-07-29',2022:'2022-06-23',2023:'2023-06-22',2024:'2024-06-27',2025:'2025-06-26',2026:'2026-06-24'}

def urls(year):
    tie=BASE+(f'{year}-nba-draft-tiebreakers/' if year!=2023 else 'ties-broken-for-order-of-selection-in-nba-draft-2023-presented-by-state-farm/')
    lot=BASE+(f'{year}-nba-draft-lottery-results/' if year!=2024 else 'atlanta-wins-nba-draft-lottery-2024-presented-by-state-farm/')
    return {'tiebreaks':tie,'lottery':lot}

def team(text):
    text=re.sub(r'\s+',' ',text).strip()
    matches=[(name,alias)for name,alias in NAMES.items()if text.startswith(name)]
    if not matches:raise ValueError('Unknown official team label: '+text)
    return max(matches,key=lambda p:len(p[0]))[1]

def document(data):
    doc=html.fromstring(data)
    for el in doc.xpath('//sup'):el.drop_tree()
    content=doc.xpath('//div[contains(concat(" ",@class," ")," post__content ")]')[0]
    meta=doc.xpath('//div[contains(concat(" ",@class," ")," post__meta ")]')[0]
    match=re.search(r'([A-Z][a-z]+ \d{1,2}, \d{4})',meta.text_content())
    return content,datetime.strptime(match[1],'%B %d, %Y').date().isoformat()

def parse_lottery(data,year):
    content,known=document(data);rows=[]
    labels=[]
    for p in content.xpath('./p|./ol'):
        if p.tag=='ol':
            start=int(p.get('start','1'))
            labels.extend((int(li.get('value',start+i)), ' '.join(li.text_content().split()))for i,li in enumerate(p.xpath('./li')))
            continue
        text=' '.join(p.text_content().split())
        if not re.match(r'^(?:(?:1|15|31)\.|—)\s',text):continue
        pieces=re.split(r'(?:^|\s)(\d+\.|—)\s+',text)
        for i in range(1,len(pieces),2):
            marker,label=pieces[i],pieces[i+1].strip()
            if '[*]'in label:label=label.split('[*]')[0].strip()
            actual=None if marker=='—'else int(marker[:-1])
            labels.append((actual,label))
    for actual,label in labels:
        origin_match=re.search(r'\(from\s+(?:the\s+)?(.+?)(?:\s+via\s+|[;)])',label)
        origin=team(origin_match[1] if origin_match else label)
        rnd=1 if len(rows)<30 else 2
        rows.append(dict(origin=origin,year=int(year),round=rnd,physical_slot=len(rows)+1,
                         actual_slot=actual,forfeited=actual is None,label=label))
    if len(rows)!=60 or len({(r['origin'],r['round'])for r in rows})!=60:
        raise ValueError(f'{year}: official order is not a complete 60-component universe ({len(rows)})')
    if [r['actual_slot']for r in rows if not r['forfeited']]!=list(range(1,61-sum(r['forfeited']for r in rows))):
        raise ValueError('Official selection numbers do not reconcile')
    return dict(year=year,known_from=known,source=urls(year)['lottery'],rows=rows)

def parse_tiebreaks(data,year):
    content,known=document(data);tables=content.xpath('.//table')
    if len(tables)!=3:raise ValueError('Expected three official tiebreak tables')
    first=[];second=[]
    for index,table in enumerate(tables):
        position=1 if index==0 else 15 if index==1 else 31
        for tr in table.xpath('.//tr'):
            cells=[' '.join(td.text_content().split())for td in tr.xpath('./td')]
            if not cells or 'TEAM'in cells:continue
            # Some editions omit the explicit15..30 first-round column.
            explicit=re.fullmatch(r'(\d+(?:/\d+)*)\.?',cells[0]);removed=cells[0]=='—'
            label=cells[1]if explicit or removed else cells[0]
            if not any(label.startswith(n)for n in NAMES):continue
            slots=[]if removed else list(map(int,explicit[1].split('/')))if explicit else[position]
            row=dict(origin=team(label),slots=slots,label=label,physical_position=position,forfeited=removed)
            if index<2:first.append(row)
            else:second.append(row)
            position+=1
    if len(first)!=30 or len(second)!=30:raise ValueError('Official tiebreak table incomplete')
    return dict(year=year,known_from=known,source=urls(year)['tiebreaks'],first=first,second=second)

def collect(output,years=range(2022,2027)):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    jobs=[(year,kind,url)for year in years for kind,url in urls(year).items()]
    def fetch(job):
        year,kind,url=job;path=output/f'{kind}_{year}.html'
        data=path.read_bytes()if path.exists()else urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=40).read()
        path.write_bytes(data)
        row=(parse_lottery if kind=='lottery'else parse_tiebreaks)(data,year)
        row.update(kind=kind,sha256=hashlib.sha256(data).hexdigest())
        return row
    with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:rows=list(pool.map(fetch,jobs))
    result={'orders':rows,'draft_completion_dates':{str(y):d for y,d in DRAFT_COMPLETION.items()},
            'announced_draft_months':{'2027':{'month':'2027-06','source':'https://nbaexperiences.com/nba-draft-2027'}},
            'policy':'A known actual slot is used only from its official publication date. Earlier second-round ties remain conditional on the first-round result.'}
    (output/'dated_orders.json').write_text(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=collect(a.output);print(json.dumps({'releases':len(result['orders']),'physical_components':sum(len(r.get('rows',[]))for r in result['orders'])}))
