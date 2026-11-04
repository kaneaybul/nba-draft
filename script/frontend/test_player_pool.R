model <- new.env(parent=globalenv())
for(expr in parse('script/frontend/export_frontend_data.R')) {
 if(is.call(expr)&&identical(expr[[1]],as.name('<-'))&&length(expr)==3L&&is.call(expr[[3]])&&identical(expr[[3]][[1]],as.name('function'))) eval(expr,model)
}
source('script/frontend/player_pool.R',local=model)
archive_path <- 'frontend/public/data/archive/2027-preseason/impact_players.json'
archive_hash <- tools::md5sum(archive_path)
p <- jsonlite::fromJSON(archive_path)
p$pool_status <- ifelse(p$team_projection_base!='FA','roster','free_agent')
same <- model$season_pool_scores(p,'.')
active <- p$pool_status=='roster'
stopifnot(abs(mean(same$score[active])-50)<.05,
 isTRUE(all.equal(same$score_delta,round(same$score-p$score,1))),
 identical(same$total,p$total),identical(same$timin,p$timin),identical(same$Minutes,p$Minutes))

# A league-wide level or units change cannot move within-season ranks.
shifted <- p;shifted$total <- p$total-3;shifted$timin <- p$timin*2+1000
recentered <- model$season_pool_scores(shifted,'.')
stopifnot(identical(recentered$score,same$score))

# Unrostered tracking records do not change the current NBA reference.
added <- p[1,,drop=FALSE];added$nba_id <- -999999;added$total <- 50;added$timin <- 999999
added$pool_status <- 'free_agent';added$team_projection_base <- 'FA'
expanded <- model$season_pool_scores(rbind(p,added),'.')
stopifnot(identical(expanded$score[seq_len(nrow(p))],same$score),is.na(tail(expanded$score_delta,1)))
added$pool_status <- 'inactive'
inactive_expanded <- model$season_pool_scores(rbind(p,added),'.')
stopifnot(identical(inactive_expanded$score[seq_len(nrow(p))],same$score))
added$pool_status <- 'roster';added$team_projection_base <- 'BOS'
roster_expanded <- model$season_pool_scores(rbind(p,added),'.')
stopifnot(any(roster_expanded$score[seq_len(nrow(p))]!=same$score))

# One player's improvement changes that player's relative position.
shifted <- p;target <- which(active & p$score>30 & p$score<70)[1]
shifted$total[target] <- shifted$total[target]+1
changed <- model$season_pool_scores(shifted,'.')
stopifnot(changed$score[target]>same$score[target],abs(mean(changed$score[active])-50)<.05)

# Separate seasons recenter independently; tied distributions center at 50.
next_season <- shifted;next_season$year <- shifted$year+1L
next_season$total <- next_season$total+100
next_season$timin <- next_season$timin*3-1000
multi <- model$season_pool_scores(rbind(p,next_season),'.')
stopifnot(identical(multi$score[seq_len(nrow(p))],same$score),
 identical(tail(multi$score,nrow(p)),changed$score),
 all(is.na(tail(multi$score_delta,nrow(p)))))
tied <- p;tied$total <- 1;tied$timin <- 1
stopifnot(all(model$season_pool_scores(tied,'.')$score==50))

untracked_prospect <- p[1,,drop=FALSE];untracked_prospect$nba_id <- -99999999
untracked_prospect$availability_status <- 'rookie_projection'
pool <- model$apply_live_player_pool(rbind(p,untracked_prospect),p,'.')
stopifnot(!untracked_prospect$nba_id %in% pool$nba_id)
registry <- jsonlite::fromJSON('raw/live/player_pool.json')
roster_ids <- registry$players$app_nba_id[registry$players$pool_status=='roster']
stopifnot(all(roster_ids %in% pool$nba_id),!anyDuplicated(pool$nba_id),all(is.finite(pool$total)))
pool <- model$zero_inactive_pool_minutes(pool)
stopifnot(all(pool$Minutes[pool$pool_status=='inactive']==0))

# Exercise the new scorer on the actual current export before and after rebuild.
published <- jsonlite::fromJSON('frontend/public/data/v2/impact_players/2027.json')
expected <- model$season_pool_scores(published,'.')
active <- published$pool_status=='roster'
stopifnot(abs(mean(expected$score[active])-50)<.05,
 all(expected$score>=0 & expected$score<=100),
 identical(model$season_pool_scores(expected,'.')$score,expected$score))
baseline <- p$score[match(published$nba_id,p$nba_id)]
comparable <- active & is.finite(baseline)
cat(sprintf('Current roster Score: mean %.4f across %d players; %d down / %d up / %d unchanged versus preseason.\n',
 mean(expected$score[active]),sum(active),
 sum(expected$score_delta[comparable]<0),sum(expected$score_delta[comparable]>0),sum(expected$score_delta[comparable]==0)))
if('--require-export' %in% commandArgs(TRUE)) {
 stopifnot(all(roster_ids %in% published$nba_id),!anyDuplicated(published$nba_id),!any(published$pool_status=='draft'),
 isTRUE(all.equal(published$score,expected$score)),isTRUE(all.equal(published$score_delta,expected$score_delta)),
 all(published$team_projection_base[active]!='FA'),all(published$team_projection_base[!active]=='FA'))
}
stopifnot(identical(tools::md5sum(archive_path),archive_hash))
cat('Roster completeness, stable identity, season-relative Score, affine invariance, ties, season isolation and immutable preseason Delta tests passed\n')


# A signed roster contract remains rostered when some pay is not guaranteed.
owned <- pool[pool$pool_status=='roster',,drop=FALSE][1,,drop=FALSE]
owned$contract_status <- 'Non-Guaranteed';owned$projection_roster_status <- 'open_market'
owned <- model$enforce_roster_truth_placements(owned,2026)
stopifnot(owned$projection_roster_status=='signed',owned$pool_status=='roster')
