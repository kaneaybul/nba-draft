"""Keep actual selected slots when an unsigned draftee has no NBA ID yet."""
from __future__ import annotations
import csv,io,json,re,unicodedata
from pathlib import Path

OLD_RIGHTS=[
 {'name':'Chinemelu Elonu','draft_year':2009,'slot':59,'known_from':'2009-06-25','source':'https://lalweb.blob.core.windows.net/public/lakers/media-relations/2025-26-Lakers-Media-Guide.pdf'},
 {'name':'Latavious Williams','draft_year':2010,'slot':48,'known_from':'2010-06-24','source':'https://cdn.nba.com/teams/uploads/sites/1610612748/2023/11/2023-24-Miami-Heat-Media-Guide_39884007.pdf'}]

def key(name):
    name=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]','',re.sub(r'\b(jr|sr|ii|iii|iv)\b','',name))

def update(runtime,events):
    path=runtime/'app_model/processed/draft/draft_picks_all_classes.csv'
    with path.open()as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
    known={key(r['player']):(int(float(r['draft_year'])),int(float(r['pick_overall'])))for r in rows if r.get('draft_year')and r.get('pick_overall')}
    first_round_last={}
    for event in events:
        if re.search(r'selected.+NBA Draft',event['text']):
            match=re.search(r'Round 1 with Pick (\d+)',event['text'])
            if match:
                year=int(event['date'][:4]);first_round_last[year]=max(first_round_last.get(year,0),int(match[1]))
    facts=list(OLD_RIGHTS)
    for event in events:
        if not re.search(r'selected.+NBA Draft',event['text']):continue
        match=re.search(r'Round (\d) with Pick (\d+)',event['text'])
        if not match or not event['players']:continue
        year=int(event['date'][:4]);round_number=int(match[1])
        if round_number==2 and year not in first_round_last:raise ValueError('Actual first-round length is unavailable; cannot label a second-round selection')
        offset=first_round_last[year]if round_number==2 else 0
        facts.append({'name':event['players'][0]['name'],'draft_year':year,'slot':offset+int(match[2]),'known_from':event['date'],'source':event['source']})
    added=[]
    for fact in facts:
        identity=key(fact['name']);value=(fact['draft_year'],fact['slot'])
        if not 1<=value[1]<=60:raise ValueError('Invalid actual draft slot')
        if identity in known:
            if known[identity]!=value:raise ValueError('Conflicting actual draft identities require review: '+fact['name'])
            continue
        row={field:''for field in fields};row.update(player=fact['name'],draft_year=str(value[0]),pick_overall=str(value[1]))
        rows.append(row);known[identity]=value;added.append(fact)
    if added:
        temporary=path.with_suffix('.tmp')
        with temporary.open('w',newline='')as f:w=csv.DictWriter(f,fields);w.writeheader();w.writerows(rows)
        temporary.replace(path)
    audit={'method':'Original dated draft selections, never mock slots or transfer-year guesses','added_actual_draft_rows':added,'source_facts_considered':len(facts)}
    (runtime/'monthly_reconstruction/league_ownership/draft_identity_source_audit.json').write_text(json.dumps(audit,indent=2));return audit
