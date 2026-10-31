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
# Historical GP is the participation rate. Actual appearances, including zero
# appearances during an injury, must not become a second future-availability update.
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
stopifnot(all(abs(gp$minutes_play_probability-gp_inputs$games/82)<1e-12),
 identical(gp$minutes_gp_prior,gp_inputs$games),abs(sum(gp$Minutes)-19680)<1e-6,
 all(gp$minutes_actual_games==gp_stats$players$games))
again <- model$apply_live_minute_inputs(gp,root)
stopifnot(identical(gp$minutes_play_probability,again$minutes_play_probability),
 identical(gp$minutes_gp_prior,again$minutes_gp_prior))
# Missing current observations retain the same trained baseline and zero actuals.
gp_stats$players <- gp_stats$players[-2,]
jsonlite::write_json(gp_stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
absent <- model$apply_live_minute_inputs(gp_inputs,root)
stopifnot(abs(absent$minutes_play_probability[2]-40.1/82)<1e-12,
 absent$minutes_actual_games[2]==0,absent$minutes_actual[2]==0)
# Team changes and asynchronous result coverage do not alter the GP baseline.
gp_stats$players$team[1] <- 'BOS';gp_stats$completed_games_at_fetch <- 4L
jsonlite::write_json(gp_stats,file.path(root,'raw/live/skill_stats.json'),auto_unbox=TRUE)
lagging <- model$apply_live_minute_inputs(gp_inputs,root)
stopifnot(identical(gp$minutes_play_probability,lagging$minutes_play_probability))
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
# A past injury absence stays in actual GP. Only the remaining injury dates
# affect future GP: actual appearances + trained rate * dated availability.
ratio_fixture <- fixture
ratio_fixture$minutes_play_probability <- .9
ratio_fixture$minutes_gp_prior <- 73.8
ratio_fixture$minutes_actual_games <- 2
ratio_fixture$minutes_actual <- 60
ratio_fixture$minutes_actual_games[2] <- 0
ratio_fixture$minutes_actual[2] <- 0
healthy <- model$apply_injury_projections(ratio_fixture,schedule,
 list(season=2027L,generated_at='2026-10-25T12:00:00Z',players=list()))$players
stopifnot(abs(healthy$games[1]-(2+2*.9))<1e-10,
 abs(healthy$games[2]-2*.9)<1e-10)
injury <- list(player_name='Player 2',name_key='player2',team='UTA',
 status='Out',basis='reported_window',season_ending=FALSE,games_missed_min=1,
 return_earliest='2026-10-28',return_latest='2026-10-28',source_url='https://www.espn.com/nba/injuries')
ratio_outlook <- list(season=2027L,generated_at='2026-10-25T12:00:00Z',players=list(injury))
recovering <- model$apply_injury_projections(ratio_fixture,schedule,ratio_outlook)$players
stopifnot(abs(recovering$games[2]-.9)<1e-10,
 identical(recovering$minutes_play_probability,ratio_fixture$minutes_play_probability))
# Advancing past a missed injury game consumes that calendar date without
# lowering the post-recovery rate or subtracting the missed game again.
advanced_schedule <- schedule;advanced_schedule$is_completed[3] <- TRUE
advanced_outlook <- ratio_outlook;advanced_outlook$generated_at <- '2026-10-27T12:00:00Z'
advanced_outlook$players[[1]]$games_missed_min <- 0L
advanced <- model$apply_injury_projections(ratio_fixture,advanced_schedule,advanced_outlook)$players
stopifnot(abs(advanced$games[2]-recovering$games[2])<1e-10,
 abs(advanced$minutes_play_probability[2]-.9)<1e-12)
# An uncertain return weights individual future games instead of rounding
# the expected injury absence into a hard number of games.
partial_outlook <- ratio_outlook;partial_outlook$players[[1]]$games_missed_min <- 0L
partial_outlook$players[[1]]$return_earliest <- '2026-10-25'
partial_outlook$players[[1]]$return_latest <- '2026-10-27'
partial <- model$apply_injury_projections(ratio_fixture,schedule,partial_outlook)$players
stopifnot(abs(partial$games[2]-1.5*.9)<1e-10,
 identical(partial$total,ratio_fixture$total))
if('--require-export' %in% commandArgs(TRUE)) {
  pub <- jsonlite::fromJSON('frontend/public/data/v2/impact_players/2027.json')
  stopifnot('minutes_gp_prior' %in% names(pub),all(is.finite(pub$minutes_gp_prior)))
  roster <- pub$pool_status=='roster'
  expected <- ifelse(roster & pub$minutes_input_mpg>0,pub$minutes_gp_prior/82,0)
  stopifnot(all(abs(pub$minutes_play_probability-expected)<1e-10))
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
cat('Provider MPG hierarchy, trained GP participation, repeatability, dated injury recovery, completed minutes and team budgets passed\n')

