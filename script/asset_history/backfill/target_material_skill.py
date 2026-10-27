"""Recover material rows from actual dated played-team prefix observations."""
import argparse,csv,gzip,json,pathlib,urllib.request,urllib.parse,time,hashlib,concurrent.futures
from expand_league_skill import write

def main():
 p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--gap-file',type=pathlib.Path,required=True);a=p.parse_args();root=a.skill_dir.resolve();gaps=json.loads(a.gap_file.read_text())['material_missing_current_samples'];evidence=[]
 for year in sorted({int(z['date'][:4])+(int(z['date'][5:7])>=10)for z in gaps}):
  targets=[z for z in gaps if int(z['date'][:4])+(int(z['date'][5:7])>=10)==year];pairs={(z['date'],z['nba_id']):{}for z in targets};f=root/'matchups'/f'game_matchups_{year}_compact{"_revision_candidate"if year in [2025,2026]else""}.csv.gz'
  with gzip.open(f,'rt')as h:
   for r in csv.DictReader(h):
    off=int(r['off_person_id']);deff=int(r['def_person_id']);day=r['game_date']
    for z in targets:
     if day>z['date']:continue
     t=r['off_team_id']if off==z['nba_id']else r['def_team_id']if deff==z['nba_id']else None
     if t is not None:pairs[z['date'],z['nba_id']].setdefault(str(int(float(t))),set()).add(day)
  for z in targets:evidence.append(dict(z,season=year,actual_played_team_segments=[{'team_id':t,'first_game':min(ds),'last_game':max(ds),'observed_game_days':len(ds)}for t,ds in pairs[z['date'],z['nba_id']].items()]))
 write(root/'material_gap_team_evidence.json',evidence);jobs={}
 for z in evidence:
  # Poeltl's only invalid row field is unused; consumed fields now pass and the
  # unused provider discrepancy is preserved. No network repair is needed.
  if z['nba_id']==1627751:continue
  for t in z['actual_played_team_segments']:jobs[z['date'],t['team_id']]=z['season']
 assert len(jobs)<=12,'Bounded targeted pass only'
 def fetch(item):
  (d,t),y=item;f=root/'matchups'/f'pbp_team_{t}_{d}.json'
  if f.exists():return {'date':d,'team_id':t,'status':'cached','rows':len(json.loads(f.read_text())['multi_row_table_data'])}
  rs=json.loads((root/'matchups'/f'league_games_{y}-04-30.json').read_text())['resultSets'][0];i=rs['headers'].index('GAME_DATE');start=min(r[i][:10]for r in rs['rowSet']);params={'Season':f'{y-1}-{str(y)[-2:]}','SeasonType':'Regular Season','Type':'Player','TeamId':t,'FromDate':start,'ToDate':d};url='https://api.pbpstats.com/get-totals/nba?'+urllib.parse.urlencode(params);begin=time.time()
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'}),timeout=65)as r:body=r.read()
   x=json.loads(body);rows=x['multi_row_table_data'];assert rows;f.write_bytes(body);write(f.with_suffix('.source.json'),{'url':url,'retrieved_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sha256':hashlib.sha256(body).hexdigest(),'source_cutoff':d,'selection_basis':'Actual NBA team IDs from date-filtered game-level matchup corpus'})
   return {'date':d,'team_id':t,'status':'available','rows':len(rows),'seconds':time.time()-begin,'url':url}
  except Exception as e:return {'date':d,'team_id':t,'status':'unavailable','error':type(e).__name__+': '+str(e),'seconds':time.time()-begin,'url':url}
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3)as ex:
  for r in ex.map(fetch,jobs.items()):results.append(r);print(r,flush=True)
 write(root/'material_target_source_audit.json',{'targets':evidence,'request_results':results,'bounded_request_count':len(jobs)})
if __name__=='__main__':main()
