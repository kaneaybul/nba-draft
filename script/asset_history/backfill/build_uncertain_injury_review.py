"""Build separate unapproved uncertain-return evidence; never a season-zero table."""
import argparse,json
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();p=args.output;p.mkdir(parents=True,exist_ok=True)
records=[]
def add(n,pid,start,season,url,summary,status='out_return_timetable_unknown',reviewstart=None,reviewend=None,returned=None,returnsource=None):
 r=dict(player_name=n,player_nba_id=pid,nba_id=pid,known_from=start,known_through=f'{season}-06-30',affected_season=season,season_end_year=season,status=status,remaining_season_games_certain_zero=None,remaining_season_games_base_case=None,anticipated_return=None,source=url,source_published_at=start,evidence_summary=summary,team_official_confirmation=True,uncertainty='No certain return date. Re-evaluation or hoped-for timing is not clearance.',automatic_overlay_approved=False)
 if reviewstart:r['reevaluation_window_start']=reviewstart
 if reviewend:r['reevaluation_window_end']=reviewend
 if returned:r['observed_return_date']=returned;r['observed_return_source']=returnsource
 records.append(r)
add('Zion Williamson',1629627,'2021-12-16',2022,'https://www.nba.com/news/zion-williamson-foot-injection-4-6-weeks','Foot treatment limited weight-bearing activity; imaging review expected in four to six weeks.','injured_reevaluation_pending','2022-01-13','2022-01-27')
add('Michael Porter Jr.',1629008,'2021-12-01',2022,'https://www.nba.com/news/michael-porter-jr-back-surgery','Lumbar surgery; indefinite absence, with no supported full-season zero.')
add('Joel Embiid',203954,'2024-02-06',2024,'https://www.nba.com/news/joel-embiid-procedure-left-knee','Meniscus procedure; four-week re-evaluation was not a guaranteed return.','injured_reevaluation_pending','2024-03-05','2024-03-05','2024-04-02','https://www.nba.com/news/joel-embiid-returns-to-76ers-lineup-vs-thunder')
add('Chet Holmgren',1631096,'2024-11-11',2025,'https://www.nba.com/thunder/news/holmgren-241111','Pelvic fracture; team expected a same-season return and a protocol update in eight to ten weeks.','injured_reevaluation_pending','2025-01-06','2025-01-20','2025-02-07','https://www.nba.com/raptors/game/0022400739/box-score')
add('Jayson Tatum',1628369,'2025-06-26',2026,'https://www.nba.com/news/jayson-tatum-progress-achilles-surgery','Basketball president gave no return timetable after Achilles repair; no full-season absence was confirmed.',returned='2026-03-06',returnsource='https://www.nba.com/game/dal-vs-bos-0022500908?watchFullGame=true')
add('Jayson Tatum',1628369,'2025-12-17',2026,'https://www.nba.com/celtics/news/sidebar-prac-20251217-brad-stevens-praises-patience-development-one-third-into-season','Team again stated no return timetable during ongoing Achilles rehabilitation.',returned='2026-03-06',returnsource='https://www.nba.com/game/dal-vs-bos-0022500908?watchFullGame=true')
add('Jimmy Butler',202710,'2026-10-02',2027,'https://www.nba.com/player/202710','NBA player news reported team hopes for an early-2027 return; no precise clearance date.')
records[-1]['team_official_confirmation']=False
for name,pid in [('Jalen Williams',1631114),('Cason Wallace',1641717)]:
 add(name,pid,'2026-10-26',2027,'https://www.nba.com/news/thunders-jalen-williams-has-fractured-leg-dislocated-ankle-and-will-need-surgery','Team announced surgery; return timetable would follow surgery, with no season-ending forecast.')
obj={'scope':'Source-reviewed uncertain return statements requiring severity/forecast review before automatic use.','all_team_monthly_injury_review_complete':False,'automatic_overlay_approved':False,'records':records,'notes':['Observed return dates are dated later evidence and must only clear overlays once the snapshot reaches that date.','Do not use cumulative season games as proof that a player returned after a later injury.','Current 14/28-day generic return half-life is not validated for major surgical recovery; approve deliberately.','Jalen Williams/Cason Wallace Oct26 details must not enter an Oct25 snapshot.']}
(p/'uncertain_injury_review.json').write_text(json.dumps(obj,indent=2))
print(len(records))
