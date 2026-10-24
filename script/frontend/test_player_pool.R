model <- new.env(parent=globalenv())
for(expr in parse('script/frontend/export_frontend_data.R')) {
 if(is.call(expr)&&identical(expr[[1]],as.name('<-'))&&length(expr)==3L&&is.call(expr[[3]])&&identical(expr[[3]][[1]],as.name('function'))) eval(expr,model)
}
source('script/frontend/player_pool.R',local=model)
p <- jsonlite::fromJSON('frontend/public/data/archive/2027-preseason/impact_players.json')
same <- model$fixed_pool_scores(p,'.')
stopifnot(isTRUE(all.equal(same$score,p$score)),all(same$score_delta==0))
added <- p[1,,drop=FALSE];added$nba_id <- -999999;added$total <- 50;added$timin <- 999999
expanded <- model$fixed_pool_scores(rbind(p,added),'.')
stopifnot(identical(expanded$score[seq_len(nrow(p))],same$score),is.na(tail(expanded$score_delta,1)))
shifted <- p;shifted$total[100] <- shifted$total[100]+1
changed <- model$fixed_pool_scores(shifted,'.')
stopifnot(changed$score_delta[100]>0,identical(changed$score[-100],same$score[-100]))
untracked_prospect <- p[1,,drop=FALSE];untracked_prospect$nba_id <- -99999999
untracked_prospect$availability_status <- 'rookie_projection'
pool <- model$apply_live_player_pool(rbind(p,untracked_prospect),p,'.')
stopifnot(!untracked_prospect$nba_id %in% pool$nba_id)
registry <- jsonlite::fromJSON('raw/live/player_pool.json')
roster_ids <- registry$players$app_nba_id[registry$players$pool_status=='roster']
stopifnot(all(roster_ids %in% pool$nba_id),!anyDuplicated(pool$nba_id),all(is.finite(pool$total)))
pool <- model$zero_inactive_pool_minutes(pool)
stopifnot(all(pool$Minutes[pool$pool_status=='inactive']==0))
if('--require-export' %in% commandArgs(TRUE)) {
 published <- jsonlite::fromJSON('frontend/public/data/v2/impact_players/2027.json')
 stopifnot(all(roster_ids %in% published$nba_id),!anyDuplicated(published$nba_id),!any(published$pool_status=='draft'))
 expected <- model$fixed_pool_scores(published,'.')
 stopifnot(isTRUE(all.equal(published$score,expected$score)),isTRUE(all.equal(published$score_delta,expected$score_delta)))
 active <- published$pool_status=='roster'
 stopifnot(all(published$team_projection_base[active]!='FA'),all(published$team_projection_base[!active]=='FA'))
}
cat('Roster completeness, stable identity, fixed Score calibration and preseason Delta tests passed\n')
