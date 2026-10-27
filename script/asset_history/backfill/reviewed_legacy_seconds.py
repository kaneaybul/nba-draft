"""Cross-source corrections and remaining original baseline second claims."""

def rules(candidates,order_start=4000):
 byidx={r['idx']:r for r in candidates};out=[]
 def add(idx,rid,kind,refs,**kw):
  c=byidx[idx];out.append(dict(rule_id=rid,kind=kind,known_from=c['date'],order=order_start+len(out),reviewed=True,source=c['source'],source_candidate_index=idx,reviewed_coverage_refs=refs,baseline_only=True,review_asof='2021-12-31',**kw))
 def protected(idx,rid,origin,year,to,ranges):add(idx,rid,'protected_chain',[[origin,year,2]],from_team=origin,to_team=to,branches=[dict(pick=[origin,year,2],protected_ranges=ranges)],fallback_picks=[])
 protected(13,'OPEN_MIA2024R2_ATL_51_55','MIA',2024,'ATL',[[31,50],[56,60]])
 out[-1].update(source_correction='Originalboundaryis56-60protected; retrospectiveSalarySwish56-59woulddoubleallocate60.',source_crosschecks=['https://www.sportingnews.com/ca/nba/news/nba-future-draft-picks-nba-draft-2020-first-round-second-round-protected/6mfx82kubv821szk04n3xyp0l'])
 protected(80,'OPEN_MIA2024R2_NYK_56_60','MIA',2024,'NYK',[[31,55]])
 out[-1]['source_crosschecks']=['https://www.sportingnews.com/us/nba/news/kevin-durant-nets-heat-trade-tyler-herro-kyle-lowry-draft-picks/wqwouunywin6i5kc7dajvdux']
 protected(36,'OPEN_GSW2024R2_HOU_31_55','GSW',2024,'HOU',[[56,60]])
 out[-1].update(source_correction='Originalprotectionis56-60, notretrospective56-59.',source_crosschecks=['https://www.skysports.com/nba/news/12474176/breaking-down-the-houston-rockets-rebuild-evaluating-rookies-contracts-and-decisions-facing-the-franchise','https://sports.yahoo.com/complete-list-houston-draft-assets-155211907.html'])
 protected(70,'OPEN_GSW2024R2_CLE_56_60','GSW',2024,'CLE',[[31,55]])
 add(28,'OPEN_2023_ATL_CHA_BKN_SECONDS','partition',[[t,2023,2]for t in('ATL','CHA','BKN')],picks=[[t,2023,2]for t in('ATL','CHA','BKN')],expected_owners=[[[t,2023,2],t]for t in('ATL','CHA','BKN')],owners_by_rank=['PHI','ATL','BKN'],source_crosschecks=['https://www.netsdaily.com/2022/9/12/23349117/draft-watch-nets-picks-are-limited-short-term','https://atlantahawkspr.wordpress.com/wp-content/uploads/2023/02/bey-2.9.23.pdf'])
 # Explicitoldregisterclaims omitted from the retrospectiveSalarySwishtable.
 for rid,origin,y,to,dt,season in [('OPEN_HOU2022R2_CLE','HOU',2022,'CLE','2019-02-07',2019),('OPEN_SAC2024R2_DET','SAC',2024,'DET','2021-03-25',2021)]:
  out.append(dict(rule_id=rid,kind='transfer',known_from=dt,order=order_start+len(out),reviewed=True,source=f'https://basketball.realgm.com/nba/transactions/league/{season}',reviewed_coverage_refs=[[origin,y,2]],pick=[origin,y,2],from_team=origin,to_team=to,baseline_only=True,review_asof='2021-12-31'))
 # Kabengelecreatedreciprocalnarrowsecondclaims; theKings55-60claim was
 # subsequentlysentbyLACtoNOPintheBrandonBostonrightsdeal.
 protected(104,'OPEN_SAC2022R2_NOP_55_60','SAC',2022,'NOP',[[31,54]])
 out[-1].update(source_correction='SalarySwishdisplaylabelsLAC, but originalRealGMtradeanddated2021transactionnoteidentifySAC.',source_crosschecks=['https://basketball.realgm.com/nba/transactions/league/2022','https://en.wikipedia.org/wiki/List_of_2021%E2%80%9322_NBA_season_transactions'])
 out.append(dict(rule_id='OPEN_ATL2022R2_SAC_56_60',kind='protected_chain',known_from='2021-03-22',order=order_start+len(out),reviewed=True,source='https://basketball.realgm.com/nba/transactions/league/2021',source_crosschecks=['https://prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=2013-6-21&Player=&PlayerMovementChkBx=yes&Team=Kings&start=400&submit=Search'],reviewed_coverage_refs=[['ATL',2022,2]],from_team='ATL',to_team='SAC',branches=[dict(pick=['ATL',2022,2],protected_ranges=[[31,55]])],fallback_picks=[],baseline_only=True,review_asof='2021-12-31'))
 return out
