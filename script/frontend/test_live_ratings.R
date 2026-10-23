model <- new.env(parent=globalenv())
for(expr in parse('script/frontend/export_frontend_data.R')) {
 if(is.call(expr) && identical(expr[[1]],as.name('<-')) && length(expr)==3L && is.call(expr[[3]]) && identical(expr[[3]][[1]],as.name('function'))) eval(expr,model)
}
source('script/frontend/live_ratings.R',local=model)
p <- jsonlite::fromJSON('frontend/public/data/archive/2027-preseason/impact_players.json')
r <- model$apply_live_expected_ratings(p,'.')
stopifnot(identical(r$Minutes,p$Minutes),identical(r$contract,p$contract),all(is.finite(r$total)))
stopifnot(sum(r$skill_source=='live_expected_epm_darko')>400)
# Reapplying identical input must not compound the adjustment.
r2 <- model$apply_live_expected_ratings(r,'.');stopifnot(identical(r$total,r2$total))
feed <- jsonlite::fromJSON('raw/live/ratings.json')
j <- match(203999,feed$players$nba_id);i <- match(203999,r$nba_id)
stopifnot(abs(r$o_epm[i]-feed$players$o_epm[j])<1e-8)
# Provider omission of a generational suffix must preserve a unique rookie match.
rookie <- match(-2027019,r$nba_id); source_rookie <- match(1643516,feed$players$nba_id)
if (!is.na(rookie) && !is.na(source_rookie)) stopifnot(abs(r$o_epm[rookie]-feed$players$o_epm[source_rookie])<1e-8)
s <- jsonlite::fromJSON('frontend/public/data/archive/2027-preseason/team_schedules.json')
s2 <- model$apply_live_game_results(s,'.');s3 <- model$apply_live_game_results(s2,'.');stopifnot(identical(s2,s3))
t <- jsonlite::fromJSON('frontend/public/data/archive/2027-preseason/team_projections.json');t <- model$apply_schedule_projections(t,s2)
stopifnot(sum(t$actual_wins[t$scenario_id=='base'])==sum(s2$is_completed),sum(t$actual_losses[t$scenario_id=='base'])==sum(s2$is_completed))
for(i in which(t$scenario_id=='base')) {
 g <- s2[s2$home_team==t$team[i]|s2$away_team==t$team[i],];g<-g[!g$is_completed,]
 prob <- ifelse(g$home_team==t$team[i],g$home_win_probability,g$away_win_probability)
 stopifnot(abs(t$projected_wins[i]-(t$actual_wins[i]+sum(prob)))<.11)
}
if('--require-export' %in% commandArgs(TRUE)) {
 pub <- jsonlite::fromJSON('frontend/public/data/v2/impact_players/2027.json')
 stopifnot(any(abs(pub$total-p$total[match(pub$nba_id,p$nba_id)])>.001,na.rm=TRUE))
 out <- jsonlite::fromJSON('frontend/public/data/v2/team_projections/2027.json');stopifnot(sum(out$actual_wins[out$scenario_id=='base'])==sum(s2$is_completed))
}
cat('Live metric identity, idempotence, current-result accounting and export tests passed\n')
