"""Join complete player quotes and conserved pick EVs for the explorer."""
from __future__ import annotations
import argparse,copy,json,re
from datetime import date,timedelta
from pathlib import Path
from publish import METHOD,TEAMS,validate

HISTORICAL_INJURIES='Historical injury coverage uses reviewed major absence reports; it is not a complete archive of short-term medical reports.'

def bridge(previous,current):
    old={a['id']:a for a in previous['assets']};new={a['id']:a for a in current['assets']};out=[]
    for kind,label in [('player','player'),('pick','draft-right')]:
        added=sum(a['value']for aid,a in new.items()if aid not in old and a['kind']==kind)
        removed=-sum(a['value']for aid,a in old.items()if aid not in new and a['kind']==kind)
        changed=sum(a['value']-old[aid]['value']for aid,a in new.items()if aid in old and a['kind']==kind)
        labels=[('added',f'New {label} holdings'+(' and horizon additions'if kind=='pick'else''),added),('removed',f'Removed {label} holdings',removed),('repriced',f'Continuing {label} values',changed)]
        out.extend(dict(key=kind+'_'+key,label=text,value=value)for key,text,value in labels if abs(value)>.005)
    if abs(sum(x['value']for x in out)-(current['total']-previous['total']))>.01:raise ValueError('Interval bridge does not reconcile')
    return out

def moves(events,team,after,through,assets):
    out=[];seen=set();valuable={a['name']for a in assets if a['kind']=='player'and abs(a['value'])>=30e6}
    for event in events:
        if not(after<event['date']<=through)or event['parsed_status']in('administrative','g_league'):continue
        text=event['text'];teams={r.get('to_team')for r in event.get('parsed_actions',[])}
        teams.update(r.get('name')for r in event.get('teams',[]))
        # Source team links carry full names. Aliases are stable in the source
        # parser and include its Philadelphia/Los Angeles spelling variants.
        names={'ATL':'Atlanta Hawks','BKN':'Brooklyn Nets','BOS':'Boston Celtics','CHA':'Charlotte Hornets','CHI':'Chicago Bulls','CLE':'Cleveland Cavaliers','DAL':'Dallas Mavericks','DEN':'Denver Nuggets','DET':'Detroit Pistons','GSW':'Golden State Warriors','HOU':'Houston Rockets','IND':'Indiana Pacers','LAC':'Los Angeles Clippers','LAL':'Los Angeles Lakers','MEM':'Memphis Grizzlies','MIA':'Miami Heat','MIL':'Milwaukee Bucks','MIN':'Minnesota Timberwolves','NOP':'New Orleans Pelicans','NYK':'New York Knicks','OKC':'Oklahoma City Thunder','ORL':'Orlando Magic','PHI':'Philadelphia Sixers','PHX':'Phoenix Suns','POR':'Portland Trail Blazers','SAC':'Sacramento Kings','SAS':'San Antonio Spurs','TOR':'Toronto Raptors','UTA':'Utah Jazz','WAS':'Washington Wizards'}
        if team not in teams and names[team]not in text and not(team=='PHI'and'Philadelphia 76ers'in text)and not(team=='LAC'and'LA Clippers'in text):continue
        key=(event['date'],text)
        if key in seen:continue
        seen.add(key);players=[p['name']for p in event.get('players',[])]
        trade='trade'in event['parsed_status'];draft='NBA Draft'in text
        major=(trade and bool(re.search(r'1st [Rr]ound',text)))or bool(set(players)&valuable)or draft
        category='Trade'if trade else'Draft'if draft else'Extension'if'extension'in text.lower()else'Roster move'
        label=category+': '+(', '.join(players[:5])if players else text)
        if len(players)>5:label+=' and others'
        out.append(dict(date=event['date'],label=label,major=major,source=event['source'],description=text))
    if after<'2026-05-28'<=through:out.append(dict(date='2026-05-28',label='NBA approves the new lottery system',major=True,source='https://pr.nba.com/nba-board-of-governors-approves-new-draft-lottery-system-to-address-tanking/'))
    if team=='LAC'and after<'2026-09-02'<=through:out.append(dict(date='2026-09-02',label='NBA forfeits five Clippers first-round picks',major=True,source='https://pr.nba.com/nba-investigation-clippers-kawhi-leonard/'))
    return sorted(out,key=lambda r:(r['date'],not r['major'],r['label']))

def assemble(players,picks,events,vintage,source_dates=None,previous=None):
    out=[];previous=copy.deepcopy(previous or {});latest={}
    for s in players:latest[s['date'][:7]]=max(latest.get(s['date'][:7],''),s['date'])
    dates=set(latest.values())
    for day in sorted(dates):
        p=picks[day]
        if not p['complete']or set(p['teams'])!=set(TEAMS):raise ValueError('Incomplete pick portfolio')
        rows=[s for s in players if s['date']==day]
        if len(rows)!=30 or {s['team']for s in rows}!=set(TEAMS):raise ValueError('Incomplete same-date player league')
        for row in sorted(rows,key=lambda r:r['team']):
            if row.get('unpriced_players'):raise ValueError('Unpriced players '+str(row['unpriced_players']))
            s=copy.deepcopy(row);s.pop('scope',None);s.pop('player_subtotal',None)
            s.update(method=METHOD,vintage=vintage,assets=s['assets']+copy.deepcopy(p['teams'][s['team']]),coverage={**s['coverage'],'pick_rights':True})
            for a in s['assets']:
                if isinstance(a.get('source'),list):a['source']='; '.join(a['source'])
                details=a.get('details',{})
                if a['kind']=='player':
                    for key,source in [('peak_production','app_style_four_year_peak_production_quote'),('contract_adjustment','app_style_four_year_contract_adjustment_sum')]:
                        if details.get(source)not in(None,''):details[key]=float(details[source])
            s['total']=sum(a['value']for a in s['assets'])
            s['assumptions']=list(p.get('assumptions',[]))+([HISTORICAL_INJURIES]if vintage=='reconstructed'else[])
            if source_dates:s['source_dates']=source_dates
            prior=previous.get(s['team']);s['moves']=moves(events,s['team'],prior['date']if prior else day,day,s['assets']+(prior['assets']if prior else[]))
            if prior:s['bridge']=bridge(prior,s)
            validate(s);out.append(s);previous[s['team']]=s
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--players',type=Path,required=True);p.add_argument('--picks-dir',type=Path,required=True);p.add_argument('--events',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--vintage',choices=['reconstructed','published'],default='reconstructed');p.add_argument('--source-dates',type=Path);a=p.parse_args()
    players=json.loads(a.players.read_text())['snapshots'];picks={d:json.loads((a.picks_dir/f'{d}.json').read_text())for d in {s['date']for s in players}}
    result=assemble(players,picks,json.loads(a.events.read_text()),a.vintage,json.loads(a.source_dates.read_text())if a.source_dates else None)
    a.output.write_text(json.dumps({'snapshots':result},separators=(',',':'),allow_nan=False));print(json.dumps({'snapshots':len(result),'teams':len({s['team']for s in result})}))
