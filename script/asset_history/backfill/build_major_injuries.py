"""Source-reviewed additions to the Utah injury overlay; not exhaustive coverage.

This data records statements made at a known date. It never infers that a whole
season was lost from subsequent realized games. Ongoing rehab without a dated
season-ending statement remains separately unpriced review work.
"""
from pathlib import Path
import argparse,json,re,unicodedata

# name, announcement cutoff, affected season, status, source, evidence paraphrase.
# No quotations. `expected` preserves an explicit uncertain zero base forecast.
SEEDS=[
('Ricky Rubio','2021-12-29',2022,'certain','https://www.nba.com/cavaliers/releases/rubio-status-update-211229','Team MRI update ruled him out for the season after an ACL tear.'),
('Jonathan Isaac','2022-03-15',2022,'certain','https://www.nba.com/magic/orlando-magic-jonathan-isaac-injury-update-miss-remainder-season-20220315','Team ruled out a return during the remaining regular season.'),
('Damian Lillard','2022-03-21',2022,'certain','https://cdn-uat.nba.com/news/trail-blazers-damian-lillard-out-for-remainder-of-season','Team ended his season during abdominal-surgery recovery.'),
('Lonzo Ball','2022-04-07',2022,'certain','https://www.nba.com/bulls/news/lonzo-ball-injury-update-0','Team ruled out the rest of the season after another knee-rehab setback.'),
('Chet Holmgren','2022-08-25',2023,'certain','https://www.nba.com/thunder/news/holmgren-220825','Team announced his foot injury would cost the upcoming season.'),
('Cade Cunningham','2022-12-16',2023,'expected','https://www.nba.com/news/pistons-cade-cunningham-left-shin-injury','Team expected season absence after stress-fracture surgery.'),
('Lonzo Ball','2023-02-21',2023,'certain','https://www.nba.com/news/bulls-lonzo-ball-out-remainder-2022-23-season','Team ruled out a return that season.'),
('Jonathan Isaac','2023-03-03',2023,'certain','https://www.nba.com/magic/news/jonathan-isaac-orlando-magic-miss-remainer-regular-season-injury-update-20230303','Team ruled out remaining games following adductor surgery.'),
('Lonzo Ball','2023-06-23',2024,'expected','https://www.nba.com/news/bulls-lonzo-ball-knee-out-2023-24-season','Basketball executive said the team was planning for a full-season absence, without ruling out a comeback.'),
('Steven Adams','2023-10-22',2024,'certain','https://www.nba.com/news/grizzlies-steven-adams-season-ending-injury-2023','Team announced knee surgery ending the upcoming season.'),
('Ja Morant','2024-01-08',2024,'certain','https://www.nba.com/grizzlies/news/memphis-grizzlies-medical-update-010823','Team announced shoulder surgery ending his season.'),
('Zach LaVine','2024-02-03',2024,'certain','https://www.nba.com/news/bulls-zach-lavine-foot-surgery','Team announced foot surgery ending his season.'),
('Patrick Williams','2024-02-23',2024,'certain','https://www.nba.com/news/bulls-patrick-williams-to-have-season-ending-foot-surgery','Team announced foot surgery ending his season.'),
('Ben Simmons','2024-03-07',2024,'certain','https://www.nba.com/news/ben-simmons-out-for-season','Team ended his season while he sought treatment for back nerve impingement.'),
('LaMelo Ball','2023-02-28',2023,'expected','https://www.nba.com/news/lamelo-ball-fractured-ankle','Contemporaneous report expected the ankle fracture to end his season.'),
('LaMelo Ball','2024-03-28',2024,'certain','https://www.nba.com/news/hornets-lamelo-ball-out-remainder-2023-24-season','Team ruled out remaining games during ankle rehabilitation.'),
('Julius Randle','2024-04-04',2024,'certain','https://www.nba.com/news/knicks-julius-randle-out-for-2023-24-season-shoulder-injury','Team announced shoulder surgery with a five-month reassessment.'),
('Bojan Bogdanovic','2024-04-30',2024,'certain','https://www.nba.com/news/knicks-bojan-bogdanovic-season-ending-surgery','Team announced foot surgery and a three-month reassessment.'),
('Grant Williams','2024-11-24',2025,'expected','https://www.nba.com/news/hornets-grant-williams-suffers-season-ending-acl-tear-right-knee','ACL diagnosis led to an expected season-ending absence; official release described him as indefinite.'),
('Jared McCain','2025-01-10',2025,'certain','https://cdn-uat.nba.com/news/76ers-rookie-jared-mccain-out-rest-of-2024-25-season','Team statement ruled him out for the rest of the season following knee surgery.'),
('Brandon Miller','2025-01-23',2025,'certain','https://www.nba.com/hornets/news/hornets-injury-update-8','Team announced wrist surgery and no return that season.'),
('Dejounte Murray','2025-02-01',2025,'certain','https://www.nba.com/news/pelicans-murray-injury','Team confirmed an Achilles rupture ending his season.'),
('Victor Wembanyama','2025-02-20',2025,'expected','https://www.nba.com/spurs/news/spurs-injury-update-2-20-25','Team expected him to miss remaining regular-season games following a DVT diagnosis.'),
('Joel Embiid','2025-02-28',2025,'certain','https://www.nba.com/news/joel-embiid-to-miss-remainder-of-2024-25-season','Team ruled him medically unable to play the remaining season.'),
('Kyrie Irving','2025-03-04',2025,'certain','https://www.nba.com/news/kyrie-irving-knee-injury-mavericks-kings','Team confirmed an ACL tear and no return that season.'),
('Paul George','2025-03-17',2025,'certain','https://www.nba.com/news/sixers-paul-george-out-for-season','Team prescribed six weeks out after treatment, beyond the regular-season schedule.'),
('Trey Murphy III','2025-03-18',2025,'certain','https://cdn-uat.nba.com/news/pelicans-forward-trey-murphy-iii-torn-labrum-out-for-season','Team announced shoulder damage ending his season.'),
('Zion Williamson','2025-04-01',2025,'certain','https://www.nba.com/pelicans/videos/willie-green-head-coach-pelicans-practice-interview-4-1-2025','Coach discussed Williamson and McCollum missing the remaining season.'),
('CJ McCollum','2025-04-01',2025,'certain','https://www.nba.com/pelicans/videos/willie-green-head-coach-pelicans-practice-interview-4-1-2025','Same team interview confirms the season-ending shutdown.'),
('Tyrese Haliburton','2025-07-07',2026,'certain','https://cdn-uat.nba.com/news/pacers-confirm-tyrese-haliburton-will-miss-entire-2025-26-season','Basketball president expressly ruled out the entire upcoming season.'),
('Bradley Beal','2025-11-12',2026,'expected','https://www.nba.com/clippers/player/203078/bradley-beal','NBA-hosted contemporaneous report described a hip fracture requiring season-ending surgery.'),
('Dereck Lively II','2025-12-10',2026,'certain','https://cdn-uat.nba.com/news/mavericks-dereck-lively-out-season-foot-surgery','Team announced right-foot surgery ending his season.'),
('Jimmy Butler','2026-01-20',2026,'certain','https://www.nba.com/news/warriors-star-jimmy-butler-exits-early-with-right-knee-injury-vs-heat','Team confirmed an ACL tear ending his season.'),
('Steven Adams','2026-01-28',2026,'certain','https://www.nba.com/player/203500/steven-adams/profile','NBA player news reports team announcement of season-ending ankle surgery.'),
('Zach LaVine','2026-02-19',2026,'certain','https://www.nba.com/news/zach-lavine-domantas-sabonis-surgeries','Team surgery announcement confirmed the rest of the season was lost.'),
('Domantas Sabonis','2026-02-19',2026,'certain','https://www.nba.com/news/zach-lavine-domantas-sabonis-surgeries','Same announcement confirmed season-ending meniscus surgery.'),
('Damian Lillard','2025-07-08',2026,'expected','https://cdn-uat.nba.com/news/bucks-waive-damian-lillard','Contemporaneous report expected the Achilles recovery to cost the upcoming season.'),
('Ben Simmons','2026-10-21',2027,'expected','https://www.nba.com/news/kings-guard-ben-simmons-suffers-torn-achilles-tendon-during-practice-sunday','Contemporaneous report describes a season-ending Achilles injury, with team surgery confirmation.'),
('Fred VanVleet','2025-09-22',2026,'expected','https://www.nba.com/news/rockets-fred-vanvleet-tears-acl','Contemporaneous reports described a potentially season-ending ACL tear.'),
('Robert Williams III','2023-11-13',2024,'expected','https://www.nba.com/blazers/news/robert-williams-iii-undergoes-right-knee-surgery','Team projected recovery for the following season after knee reconstruction.'),
("De'Anthony Melton",'2024-11-21',2025,'certain','https://www.nba.com/news/warriors-melton-knee-surgery','Team announced ACL surgery that would end his season.'),
('Moritz Wagner','2024-12-22',2025,'certain','https://www.nba.com/magic/news/orlando-magic-center-moe-wagner-suffers-torn-acl-injury-update-20241222','Team confirmed an ACL tear and no return that season.'),
('Jalen Suggs','2025-03-04',2025,'certain','https://www.reuters.com/sports/magic-g-jalen-suggs-has-knee-surgery-out-season-2025-03-04/','Dated report quotes the team ruling out remaining games following knee surgery.'),
('Kyrie Irving','2026-02-18',2026,'certain','https://www.nba.com/news/kyrie-irving-wont-return-2025-26-season','Team announced he would not return that season during ACL recovery.'),
]

def key(v):
 v=unicodedata.normalize('NFKD',v).encode('ascii','ignore').decode().lower()
 return re.sub('[^a-z0-9]','',re.sub(r'\b(jr|sr|ii|iii|iv)\b','',v))

def build(root,output):
 ids={}
 for path in sorted((root/'app_model').glob('impact_*.json')):
  for p in json.loads(path.read_text()):
   if p.get('nba_id') is not None:ids[key(p['player_name'])]=int(p['nba_id'])
 records=[]
 for name,dt,season,certainty,url,summary in SEEDS:
  pid=ids.get(key(name));assert pid is not None,name
  expected=certainty=='expected'
  records.append(dict(player_name=name,player_nba_id=pid,nba_id=pid,known_from=dt,known_through=f'{season}-06-30',affected_season=season,season_end_year=season,status='expected_miss_rest_of_season' if expected else 'out_for_season',remaining_season_games_certain_zero=None if expected else 0,remaining_season_games_base_case=0,anticipated_return=None,source=url,source_published_at=dt,evidence_summary=summary,team_official_confirmation=not expected,uncertainty='Uncertain season-ending base forecast; do not treat as medical certainty.' if expected else 'No next-season return forecast asserted.',notes='Cutoff uses dated announcement, never subsequent realized games. Seasonal record ends June30; no injury penalty carried into next season automatically.'))
 
 for r in records:
  if r['player_name']=='Steven Adams' and r['affected_season']==2026:r['team_official_confirmation']=False
 records.sort(key=lambda r:(r['known_from'],r['player_name']))
 out={'scope':'Source-reviewed major season-ending injuries across NBA teams; targeted expansion, not a complete all-team injury archive.','all_team_monthly_injury_review_complete':False,'model_rules':['Apply only after known_from to affected_season.','Keep expected_miss_rest_of_season uncertain.','Never infer a season-ending forecast from later realized zero games.','No matching record proves health.','Do not count cumulative current_games as evidence of a return after an injury.'], 'records':records}
 output.mkdir(parents=True,exist_ok=True);(output/'major_injury_additions.json').write_text(json.dumps(out,indent=2))
 report={'records':len(records),'players':len(set(r['nba_id']for r in records)),'certain':sum(r['status']=='out_for_season'for r in records),'expected':sum(r['status']=='expected_miss_rest_of_season'for r in records),'sources':len(set(r['source']for r in records)),'minimum_known_from':min(r['known_from']for r in records),'maximum_known_from':max(r['known_from']for r in records),'exhaustive_review':False,'coverage_gaps':['Routine and multi-week injuries are not exhaustively reviewed.','Recoveries spanning an offseason need current-season forecasts, not automatic rollforward of prior-season shutdown.','Kawhi Leonard, Jamal Murray, Zion Williamson and Michael Porter Jr. 2021-22 recovery expectations need dated uncertain-return overlays.','Jayson Tatum 2025-26 recovery expectations need a dated uncertain-return overlay.','A complete official month-end injury-report archive has not been collected.']}
 (output/'injury_coverage.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 return records
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,required=True,help='Utah_Monthly_Asset_Reconstruction root');p.add_argument('--output',type=Path,required=True);a=p.parse_args();build(a.source_root,a.output)
