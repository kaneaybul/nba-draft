model <- new.env(parent=globalenv())
for(expr in parse('script/frontend/export_frontend_data.R')) {
  if(is.call(expr)&&identical(expr[[1]],as.name('<-'))&&length(expr)==3L&&is.call(expr[[3]])&&identical(expr[[3]][[1]],as.name('function'))) eval(expr,model)
}
model$TEAM_PROJECTION_PLAYER_LIMIT <- 10L
source('script/frontend/injury_projections.R',local=model)
source('script/frontend/live_minutes.R',local=model)
root <- tempfile('minute-fixture-');dir.create(file.path(root,'raw/live'),recursive=TRUE)
p <- data.frame(nba_id=1:8,player_name=paste('Player',1:8),year=2027,team='UTA',team_projection_base='UTA',
 pool_status='roster',availability_status='projected',projection_roster_status='signed',contract_status='Signed',
 position=rep(c('PG','SG','SF','C'),2),games=82,Minutes=2460,p_mpg=30,total=1,offense=.5,defense=.5,
 replacement_total=-2,timin=7380,season_value=738000,value=738000,score=60,contract=1)
for(k in model$impact_skill_names()) p[[k]] <- 0
feed <- list(generated_at='2026-10-25T12:00:00Z',players=data.frame(nba_id=1:8,epm_mpg=30,darko_mpg=25))
stats <- list(players=data.frame(nba_id=1:8,minutes=60,games=2))
jsonlite::write_json(feed,file.path(root,'raw/live/ratings.json'),auto_unbox=TRUE)
jsonlite::write_json(stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
a <- model$apply_live_minute_inputs(p,root)
stopifnot(all(a$minutes_source=='Expected EPM'),all(a$minutes_input_mpg==30),abs(sum(a$Minutes)-19680)<1e-6)
other <- p;other$total <- rev(seq(-10,10,length.out=8))
b <- model$apply_live_minute_inputs(other,root)
stopifnot(identical(a$Minutes,b$Minutes)) # Our talent ranking cannot choose the coach's rotation.
# The unadjusted GP model is a 20-game prior; actual attendance updates it daily.
gp_inputs <- p;gp_inputs$games <- c(rep(40.1,3),rep(82,5))
gp_feed <- feed;gp_feed$season <- 2027L
gp_stats <- stats;gp_stats$season <- 2027L;gp_stats$completed_games_at_fetch <- 5L
gp_stats$players$team <- 'UTA'
gp_stats$players$games <- c(4,0,5,2,2,2,2,2)
gp_stats$players$minutes <- gp_stats$players$games*30
results <- list(season=2027L,games=data.frame(game_id=as.character(1:5),
 home_team='UTA',away_team='BOS',is_completed=TRUE))
jsonlite::write_json(gp_feed,file.path(root,'raw/live/ratings.json'),auto_unbox=TRUE)
jsonlite::write_json(gp_stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
jsonlite::write_json(results,file.path(root,'raw/live/results.json'),auto_unbox=TRUE)
gp <- model$apply_live_minute_inputs(gp_inputs,root)
expected <- (20*(40.1/82)+4)/25
stopifnot(abs(gp$minutes_play_probability[1]-expected)<1e-12,
 abs(4+77*expected-46.44390243902439)<1e-10,
 gp$minutes_play_probability[2]<40.1/82,
 gp$minutes_play_probability[3]>gp$minutes_play_probability[1],
 identical(gp$minutes_gp_prior,gp_inputs$games),all(gp$minutes_gp_prior_weight==20),
 all(gp$minutes_team_games_played==5),abs(sum(gp$Minutes)-19680)<1e-6)
again <- model$apply_live_minute_inputs(gp,root)
stopifnot(identical(gp$minutes_play_probability,again$minutes_play_probability))
# A player whose season-total statistics refer to a different team retains the prior.
gp_stats$players$team[1] <- 'BOS'
jsonlite::write_json(gp_stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
traded <- model$apply_live_minute_inputs(gp_inputs,root)
stopifnot(abs(traded$minutes_play_probability[1]-40.1/82)<1e-12,
 is.na(traded$minutes_team_games_played[1]))
gp_stats$players$team[1] <- 'UTA'
# A lagging statistics source must not turn newly completed games into absences.
gp_stats$completed_games_at_fetch <- 4L
jsonlite::write_json(gp_stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
lagging <- model$apply_live_minute_inputs(gp_inputs,root)
stopifnot(all(abs(lagging$minutes_play_probability-gp_inputs$games/82)<1e-12),
 all(is.na(lagging$minutes_team_games_played)))
jsonlite::write_json(feed,file.path(root,'raw/live/ratings.json'),auto_unbox=TRUE)
jsonlite::write_json(stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
unlink(file.path(root,'raw/live/results.json'))
feed$players$epm_mpg[1:3] <- NA;feed$players$darko_mpg[2:3] <- NA
stats$players$games[3] <- 0;stats$players$minutes[3] <- 0
jsonlite::write_json(feed,file.path(root,'raw/live/ratings.json'),auto_unbox=TRUE,na='null')
jsonlite::write_json(stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
fallback <- model$apply_live_minute_inputs(p,root)
stopifnot(identical(fallback$minutes_source[1:3],c('DARKO','Actual MPG fallback','Career MPG model')))
out <- model$allocate_live_rotation(a,c(0,rep(1,7)))
stopifnot(out$minutes[1]==0,abs(sum(out$minutes)/82-240)<1e-7,all(out$minutes<=out$games*48+1e-6))
stopifnot(all(out$minutes[-1]>a$Minutes[-1]))
# Completed minutes are earned, even for a player with no remaining availability.
schedule <- data.frame(season=2027L,season_type='Regular Season',date=c('2026-10-20','2026-10-22','2026-10-26','2026-10-28'),
 home_team='UTA',away_team='BOS',is_completed=c(TRUE,TRUE,FALSE,FALSE),is_placeholder=FALSE,
 home_win_probability=.5,away_win_probability=.5)
bos <- a;bos$nba_id <- bos$nba_id+100;bos$team <- bos$team_projection_base <- 'BOS'
fixture <- rbind(a,bos)
outlook <- list(season=2027L,generated_at='2026-10-25T12:00:00Z',players=list(list(player_name='Player 1',name_key='player1',team='UTA',
 status='Out',basis='reported_window',season_ending=TRUE,games_missed_min=2,source_url='https://www.espn.com/nba/injuries')))
finished <- model$apply_injury_projections(fixture,schedule,outlook)$players
stopifnot(finished$Minutes[1]==60,finished$minutes_remaining[1]==0,finished$games[1]==2)
stopifnot(all(abs(finished$Minutes-(finished$minutes_actual+finished$minutes_remaining))<.11))
stopifnot(all(abs(finished$games-(finished$minutes_actual_games+finished$minutes_remaining_games))<1e-7))
stopifnot(abs(sum(finished$minutes_remaining[finished$team=='UTA'])-480)<1e-6)
stopifnot(identical(finished$total,fixture$total))
overtime <- fixture;overtime$minutes_actual_games[1] <- 1
ot <- model$apply_injury_projections(overtime,schedule,outlook)$players
stopifnot(ot$Minutes[1]==60,ot$games[1]==1,ot$p_mpg[1]==60,ot$minutes_remaining[1]==0)
if('--require-export' %in% commandArgs(TRUE)) {
  pub <- jsonlite::fromJSON('frontend/public/data/v2/impact_players/2027.json')
  stopifnot(all(c('minutes_gp_prior','minutes_gp_prior_weight','minutes_team_games_played') %in% names(pub)),
    all(is.finite(pub$minutes_gp_prior)),all(pub$minutes_gp_prior_weight==20))
  comparable <- pub$pool_status=='roster' & is.finite(pub$minutes_team_games_played)
  stopifnot(sum(comparable)>sum(pub$pool_status=='roster')/2)
  expected <- (20*pub$minutes_gp_prior[comparable]/82+pub$minutes_actual_games[comparable])/(20+pub$minutes_team_games_played[comparable])
  stopifnot(all(abs(pub$minutes_play_probability[comparable]-expected)<1e-10))
  stopifnot(all(!is.na(pub$minutes_source)),all(abs(pub$Minutes-pub$minutes_actual-pub$minutes_remaining)<.11),
    all(abs(pub$games-pub$minutes_actual_games-pub$minutes_remaining_games)<1e-6),
    all(pub$minutes_remaining[pub$pool_status!='roster']==0),all(pub$minutes_remaining_mpg<=48.0001),
    all(pub$minutes_remaining>=0),all(pub$Minutes>=pub$minutes_actual-.11))
  for(idx in split(which(pub$pool_status=='roster'),pub$team_projection_base[pub$pool_status=='roster'])) {
    stopifnot(abs(sum(pub$minutes_expected_mpg[idx])-240)<1e-6,
      sum(pub$Minutes[idx])<=max(pub$minutes_team_budget[idx])+.1)
  }
}
unlink(root,recursive=TRUE)
cat('Provider MPG hierarchy, attendance update, repeatability, snapshot alignment, injury redistribution, completed minutes and team budgets passed\n')

