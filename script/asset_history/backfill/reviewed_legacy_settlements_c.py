"""Pre-baseline settlement of PHX/POR/SAC/TOR/WAS legacy conditional claims.

This closes the exact dated original mention, never every asset in that trade.
Official orders and original terms were published before2021-12-31. Settlement
does not assign future picks; it removes an unsupported rollover footprint.
"""
ORDER={
 2016:'https://pr.nba.com/nba-draft-lottery-2016-presented-state-farm-results/',
 2017:'https://pr.nba.com/2017-nba-draft-lottery-results/',
 2018:'https://www.nba.com/news/2018-draft-order',
 2019:'https://pr.nba.com/pelicans-win-nba-draft-lottery-2019-presented-by-state-farm/',
 2020:'https://pr.nba.com/minnesota-draft-lottery-2020/',
 2021:'https://pr.nba.com/2021-nba-draft-lottery-results/',
}
HARKLESS='https://www.hoopsrumors.com/2020/08/details-on-traded-draft-picks-protected-in-2020.html'

def resolved_claims():
 out=[]
 def add(date,origin,year,rnd,settled,disposition,evidence,sources):
  out.append(dict(date=date,origin=origin,claim_year=year,round=rnd,settled_by=settled,disposition=disposition,evidence=evidence,source=sources,reviewed=True))
 add('2017-02-23','PHX',2017,2,'2017-06-22','expired_no_rollover',
     'Mike Scott consideration was top55protected2017second only. Official2017order assignsPHX32toPhoenix, and PST records this singleyearright notexercised.',
     ['https://www.nba.com/news/phoenix-suns-send-pj-tucker-toronto-get-mike-scott-atlanta-hawks',ORDER[2017],
      'https://www.prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=2010-7-21&EndDate=2019-2-15&Player=&PlayerMovementChkBx=yes&TeamCurrent=Pelicans&start=11575&start=3875&start=8675&submit=Search'])
 add('2017-09-22','PHX',2018,2,'2018-06-21','expired_no_rollover',
     'Troy Daniels return was top55protected2018second. PHX31retained, no2019+fallback; PST marks2018right notexercised.',
     ['https://www.nba.com/news/phoenix-suns-acquire-troy-daniels-memphis-grizzlies',
      'https://www.hoopsrumors.com/2017/09/suns-acquire-troy-daniels-in-trade.html',ORDER[2018],
      'https://www.prosportstransactions.com/basketball/DraftTrades/Years/2018.htm'])
 add('2018-07-20','PHX',2021,2,'2021-06-22','conveyed',
     'Dudley/Arthur2021second protected31–35. Official2021order Brooklyn(fromPhoenix)59 proves the owed physical second conveyed, extinguishing any supposed later-year footprint.',
     ['https://abcnews.com/Sports/nets-acquire-jared-dudley-2021-round-pick-suns/story?id=56712623',ORDER[2021]])
 add('2019-07-07','PHX',2021,2,'2021-07-29','expired_no_rollover',
     'Jackson/Melton2021second protected36–60 was the complement of priorBrooklynclaim. PHX59wentBrooklyn; singleyearMemphisright notexercised, with no later obligation.',
     ['https://www.nba.com/grizzlies/news/grizzlies-acquire-josh-jackson-de-anthony-melton-and-two-future-second-round-draft-picks-from-suns-190707',
      'https://www.hoopsrumors.com/2019/10/2019-offseason-in-review-memphis-grizzlies.html',ORDER[2021],
      'https://www.prosportstransactions.com/basketball/DraftTrades/Years/2020.htm'])
 add('2015-02-19','POR',2016,1,'2016-05-17','conveyed',
     'Afflalo first conveyed2016toDenver at19, as shown in official remainder-of-first-round order. No first or second fallback remained in2022.',[ORDER[2016],
      'https://www.nba.com/nuggets/news/nuggets-acquire-barton-claver-robinson-and-protected-first-round-pick-portland'])
 for date in ['2015-07-14','2016-01-12','2017-10-14','2018-07-13']:
  add(date,'POR',2020,2,'2020-08-28','expired_no_rollover',
      'Same Harkless2020top55protectedsecond passedORL→CLE→ATL→BKN; actual46remainedPortland. Contemporary2020review explicitly states obligation extinguished.',[HARKLESS,ORDER[2020],
       'https://www.nba.com/blazers/forwardcenter/after-hardest-season-his-career-harkless-ready-fresh-start-portland'])
 add('2016-01-12','SAC',2017,2,'2017-06-22','expired_no_rollover',
     'Joe Harris consideration was singleyear2017SACsecond top55protected. Official2017order Chicago(fromSacramento viaCleveland)38 and PST notexercised show ORLplaceholder failed; no rollover.',[ORDER[2017],
      'https://www.prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=&Discipli=&EndDate=&ILChkBx=yes&InjuriesChkBx=yes&NBADLChkBx=yes&PersonalChkBx=yes&Player=&PlayerMovementChkBx=yes&Team=&start=99500'])
 add('2020-11-22','POR',2021,1,'2021-06-22','conveyed',
     'Covington2021lotteryprotectedfirst conveyedHouston23 according to official2021order; no2022+rollover.',[ORDER[2021],
      'https://www.nba.com/blazers/news/trail-blazers-acquire-robert-covington'])
 add('2015-07-09','SAC',2019,1,'2019-05-14','conveyed',
     'Sacramento2019first conveyedBoston14 viaPhiladelphia; official2019order shows settled physicalorigin. The2016/17swap rights were separate and already past.',[ORDER[2019]])
 add('2017-07-13','TOR',2018,1,'2018-05-15','conveyed',
     'Carroll salarydump2018first conveyedBrooklyn29, official2018order. No laterfirstfallback remained.',[ORDER[2018]])
 add('2018-07-18','TOR',2019,1,'2019-05-14','conveyed',
     'Leonard2019first conveyedSanAntonio29, official2019order; no later-year residual.',[ORDER[2019]])
 add('2016-02-18','WAS',2016,1,'2016-05-17','conveyed',
     'Morris2016first conveyedPhoenix13, official2016lotteryorder.',[ORDER[2016]])
 add('2017-02-22','WAS',2017,1,'2017-05-16','conveyed',
     'Bogdanovic2017first conveyedBrooklyn22, official2017order.',[ORDER[2017]])
 return out
