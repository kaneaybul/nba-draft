"""Collapsed, source-reviewed opening second-round transfers and simple protections.

Only complete physical entitlements are transferred here. Nested baskets handled
by second_basket_baseline are explicitly excluded from this module.
"""

def rules(candidates,order_start=3000):
 byidx={r['idx']:r for r in candidates};out=[]
 def add(idx,rid,kind,refs,**kw):
  c=byidx[idx];out.append(dict(rule_id=rid,kind=kind,known_from=c['date'],order=order_start+len(out),reviewed=True,source=c['source'],source_candidate_index=idx,reviewed_coverage_refs=refs,baseline_only=True,review_asof='2021-12-31',**kw))
 def straight(idx,origin,y,to):add(idx,f'OPEN_{origin}{y}R2_TO_{to}','transfer',[[origin,y,2]],pick=[origin,y,2],from_team=origin,to_team=to)
 # Latest holder at the baseline after intervening retransfers. Earlier edges
 # remain in the evidence corpus rather than being counted as extra assets.
 table=[(51,'DET',2023,'NYK'),(103,'POR',2023,'BOS'),(12,'TOR',2024,'MEM'),(17,'IND',2025,'MIL'),(18,'MIA',2022,'IND'),(29,'GSW',2026,'ATL'),(34,'SAS',2022,'CLE'),(35,'POR',2024,'SAC'),(35,'POR',2025,'SAC'),(43,'MIL',2025,'CLE'),(44,'UTA',2022,'NOP'),(89,'DET',2024,'NYK'),(45,'DET',2025,'LAC'),(88,'DET',2026,'ORL'),(105,'MEM',2022,'UTA'),(52,'MIN',2024,'OKC'),(53,'UTA',2023,'NYK'),(54,'LAL',2026,'CLE'),(60,'MIN',2026,'NYK'),(62,'UTA',2027,'CLE'),(63,'DAL',2026,'OKC'),(75,'LAC',2027,'ATL'),(65,'BOS',2024,'CHA'),(79,'BOS',2027,'ORL'),(81,'PHI',2025,'OKC'),(81,'PHI',2026,'OKC'),(83,'DEN',2027,'CLE'),(87,'WAS',2022,'CLE'),(95,'POR',2026,'NOP'),(112,'BKN',2022,'DET'),(112,'BKN',2027,'DET'),(113,'LAL',2024,'MEM'),(114,'BKN',2024,'HOU'),(108,'CHI',2024,'NOP')]
 table.extend([(5,'BKN',2025,'ATL'),(58,'CHA',2024,'OKC'),(46,'MIL',2026,'ORL'),(46,'IND',2022,'ORL'),(97,'CHI',2023,'LAL')])
 for row in table:straight(*row)
 out[-1]['source_crosschecks']=['https://www.hoopsrumors.com/2023/03/2023s-most-valuable-traded-second-round-picks.html','https://www.audacy.com/theteam980/sports/wizards/2023-nba-draft-wizards-second-round-pick-tracker']
 out[-1]['source_correction']='CHI2023protectionremovedJuly2019Satoranskytrade, beforebaseline; noactual2023slotused.'
 def protected(idx,origin,y,to,ranges):
  add(idx,f'OPEN_{origin}{y}R2_PROTECTED_TO_{to}','protected_chain',[[origin,y,2]],from_team=origin,to_team=to,branches=[dict(pick=[origin,y,2],protected_ranges=ranges)],fallback_picks=[])
 protected(110,'CHA',2022,'NYK',[[31,55]])
 out[-1]['source_crosschecks']=['https://www.nba.com/hornets/news/how-the-hornets-acquired-their-five-2023-nba-draft-picks']
 out[-1]['source_correction']='Boston transferred this placeholder to NewYork in the August2021 Fournier sign-and-trade; retrospective SalarySwish names the wrong receiving side.'
 protected(78,'CHA',2025,'GSW',[[31,55]])
 straight(65,'BOS',2023,'CHA')
 out[-1]['source_crosschecks']=['https://www.nba.com/news/hornets-acquire-gordon-hayward-future-draft-picks-in-sign-and-trade-deal']
 out[-1]['source_correction']='Original November2020 Hayward announcement explicitly says unprotected2023 and2024 seconds. The later2022 Harrell split must not be backfilled into2021 ownership.'
 protected(111,'DEN',2023,'CHI',[[31,46]])
 protected(106,'SAS',2023,'IND',[[31,55]])
 protected(107,'IND',2023,'SAS',[[31,55]])
 # SalarySwish labels thisLAC; originalRealGM and2021transactionterms identifySAC. Corrected in reviewed_legacy_seconds.
 protected(109,'CHI',2025,'SAS',[[31,55]])
 protected(37,'ATL',2024,'POR',[[31,55]])
 protected(59,'ATL',2025,'OKC',[[31,55]])
 out[-1]['source_crosschecks']=['https://boomtownhoops.com/prestis-war-chest-of-assets-explained/']
 out[-1]['source_correction']='Original2021baseline protection is31-55; the retrospective source appends a later31-40 amendment, excluded here.'
 protected(20,'NOP',2023,'ATL',[[31,45]])
 # Toronto2022was owned by GSW, with only selections55-60 sent toCharlotte.
 straight(39,'TOR',2022,'GSW')
 add(77,'OPEN_TOR2022R2_GSW_CHA_PROTECTION','protected_chain',[['TOR',2022,2]],from_team='GSW',to_team='CHA',branches=[dict(pick=['TOR',2022,2],protected_ranges=[[31,54]])],fallback_picks=[])
 # Miami2025was held byIND; Brooklyn acquired only38-60 in theOct2021deal.
 straight(18,'MIA',2025,'IND')
 add(115,'OPEN_MIA2025R2_IND_BKN_PROTECTION','protected_chain',[['MIA',2025,2]],from_team='IND',to_team='BKN',branches=[dict(pick=['MIA',2025,2],protected_ranges=[[31,37]])],fallback_picks=[])
 # CLEkeeps better(CLE,GSW)2023second; DETgets theworse. Earlier GSWincoming
 # transfers toCLE are collapsed into this joint allocation.
 add(40,'OPEN_2023_CLE_GSW_SECOND_PARTITION','partition',[[t,2023,2]for t in('CLE','GSW')],picks=[[t,2023,2]for t in('CLE','GSW')],expected_owners=[[[t,2023,2],t]for t in('CLE','GSW')],owners_by_rank=['CLE','DET'])
 # OriginalFavors consideration: OKCkeepsbestthree, Utahgets worstof4.
 add(94,'OPEN_2027_OKC_HOU_IND_MIA_SECOND_PARTITION','partition',[[t,2027,2]for t in('OKC','HOU','IND','MIA')],picks=[[t,2027,2]for t in('OKC','HOU','IND','MIA')],expected_owners=[[[t,2027,2],t]for t in('OKC','HOU','IND','MIA')],owners_by_rank=['OKC','OKC','OKC','UTA'])
 # The2022LALsecondandbetter(CHI,DET)bothendedatSASafterDeRozan.
 # SACkeepsworse(CHI,DET). RankLALagainstthosepicksdoesnotchangeSAC'sright.
 add(109,'OPEN_2022_CHI_DET_LAL_SECONDS','selector_partition',[[t,2022,2]for t in('CHI','DET','LAL')],picks=[[t,2022,2]for t in('CHI','DET','LAL')],expected_owners=[[[t,2022,2],t]for t in('CHI','DET','LAL')],claims=[dict(owner='SAS',select=['LAL',2022,2]),dict(owner='SAS',select={'best':[['CHI',2022,2],['DET',2022,2]]}),dict(owner='SAC',select='remaining')],source_crosschecks=['https://prosportstransactions.com/basketball/DraftTrades/Years/2022.htm','https://en.wikipedia.org/wiki/List_of_2021%E2%80%9322_NBA_season_transactions'])
 # Validated Utah initial portfolio: MEM2026isfullydistributedUTAtop42,
 # GSW43-60afterPaschall. Do notretainanotherMEMrightintheprotectedbranch.
 straight(105,'MEM',2026,'UTA')
 add(105,'OPEN_MEM2026R2_UTA_GSW_SPLIT','protected_chain',[['MEM',2026,2]],from_team='UTA',to_team='GSW',branches=[dict(pick=['MEM',2026,2],protected_ranges=[[31,42]])],fallback_picks=[],source_crosschecks=['Validated Utah monthly ledger MEM2026R2 retainedrange31-42; GSW43-60 under2021Paschalltrade.'])
 return out
