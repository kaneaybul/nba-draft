model <- new.env(parent=globalenv())
for(expr in parse('script/frontend/export_frontend_data.R')) {
 if(is.call(expr) && identical(expr[[1]],as.name('<-')) && length(expr)==3L && is.call(expr[[3]]) && identical(expr[[3]][[1]],as.name('function'))) eval(expr,model)
}
source('script/frontend/live_ratings.R',local=model)
# Fixture applications must not overwrite the real export's source audit.
test_root <- tempfile('live-rating-test-')
dir.create(file.path(test_root,'raw/live'),recursive=TRUE)
dir.create(file.path(test_root,'frontend/public/data'),recursive=TRUE)
stopifnot(file.copy('raw/live/ratings.json',file.path(test_root,'raw/live/ratings.json')))
stopifnot(file.copy('raw/live/skill_stats.json',file.path(test_root,'raw/live/skill_stats.json')))
dir.create(file.path(test_root,'frontend/public/data/archive/2027-preseason'),recursive=TRUE)
stopifnot(file.copy('frontend/public/data/archive/2027-preseason/impact_players.json',file.path(test_root,'frontend/public/data/archive/2027-preseason/impact_players.json')))
stopifnot(model$live_evidence_weight(0,list(),2027)$weight==0,
 abs(model$live_evidence_weight(60,list(),2027)$weight-.2)<1e-9,
 model$live_evidence_weight(75,list(),2027)$weight==.25,
 model$live_evidence_weight(150,list(),2027)$weight==.5,
 model$live_evidence_weight(225,list(),2027)$weight==.75,
 abs(model$live_evidence_weight(299,list(),2027)$weight-299/300)<1e-9,
 model$live_evidence_weight(300,list(),2027)$weight==1,
 model$live_evidence_weight(300,list(),2027)$prior==0,
 model$live_evidence_weight(301,list(),2027)$weight==1,
 model$live_evidence_weight(2000,list(),2027)$weight==1,
 model$live_evidence_weight(1500,list('2026'=2500),2027)$weight<1,
 model$live_evidence_weight(60,list('2026'=2500,'2025'=2000),2027)$weight<.025,
 model$live_evidence_weight(4000,list('2026'=2500),2027)$weight==1)
# Only synthetic padding expires: observed NBA history keeps its existing weight.
stopifnot(model$live_evidence_weight(300,list('2026'=2500),2027)$prior==1875,
 abs(model$live_evidence_weight(300,list('2026'=2500),2027)$weight-300/2175)<1e-9,
 model$live_evidence_weight(150,list('2026'=100),2027)$prior==150,
 model$live_evidence_weight(300,list('2026'=100),2027)$prior==75,
 model$live_evidence_weight(0,list(),2027)$prior==300)
w <- vapply(seq(0,4000,50),function(m) model$live_evidence_weight(m,list('2026'=2500,'2025'=2000),2027)$weight,numeric(1))
stopifnot(all(diff(w)>=0))
rookie_w <- vapply(seq(0,4000,50),function(m) model$live_evidence_weight(m,list(),2027)$weight,numeric(1))
stopifnot(all(diff(rookie_w)>=0),all(rookie_w>=0 & rookie_w<=1))
p <- jsonlite::fromJSON('frontend/public/data/archive/2027-preseason/impact_players.json')
r <- model$apply_live_expected_ratings(p,test_root)
stopifnot(identical(r$Minutes,p$Minutes),identical(r$contract,p$contract),all(is.finite(r$total)))
stopifnot(sum(r$skill_source=='live_expected_epm_darko')>400)
# Reapplying identical input must not compound the adjustment.
r2 <- model$apply_live_expected_ratings(r,test_root)
stopifnot(identical(r$total,r2$total),identical(r$skill_model_off,r2$skill_model_off),identical(r$SHOOT,r2$SHOOT),identical(r$SWITCH,r2$SWITCH))
for(h in 1:5) {
 col <- paste0('projection_y',h)
 stopifnot(isTRUE(all.equal(r[[col]],p[[col]]+r$total-p$total)),identical(r[[col]],r2[[col]]))
}
stopifnot(all(r$live_current_weight>=0 & r$live_current_weight<=1),any(abs(r$skill_model_off-p$skill_model_off)>.0001))
# A newly available SWITCH observation must flow into defensive SKILL.
fixture <- jsonlite::fromJSON(file.path(test_root,'raw/live/skill_stats.json'),simplifyVector=FALSE)
i <- which(r$live_current_weight>0 & is.finite(p$SWITCH) & abs(p$SWITCH)<3 & p$nba_id>0)[1]
j <- which(vapply(fixture$players,function(x) x$nba_id==p$nba_id[i],logical(1)))[1]
stopifnot(!is.na(j))
fixture$calibration$SWITCH <- list(mean=0,sd=1)
for(k in seq_along(fixture$players)) {
 fixture$players[[k]]$raw_skills$SWITCH <- NULL
 fixture$players[[k]]$skill_evidence_minutes <- NULL
 fixture$players[[k]]$switch_sample <- NULL
}
jsonlite::write_json(fixture,file.path(test_root,'raw/live/skill_stats.json'),auto_unbox=TRUE,null='null',digits=NA)
held <- model$apply_live_expected_ratings(p,test_root)
stopifnot(identical(held$SWITCH,p$SWITCH))
fixture$players[[j]]$raw_skills$SWITCH <- p$SWITCH[i]+1
jsonlite::write_json(fixture,file.path(test_root,'raw/live/skill_stats.json'),auto_unbox=TRUE,null='null',digits=NA)
updated <- model$apply_live_expected_ratings(p,test_root)
stopifnot(abs(updated$skill_model_def[i]-held$skill_model_def[i]-held$live_current_weight[i])<1e-8,
          updated$SWITCH[i]>held$SWITCH[i],identical(updated$SWITCH[-i],held$SWITCH[-i]))
# A delayed matchup sample updates SWITCH at its own smaller evidence weight.
sample_minutes <- fixture$players[[j]]$minutes/2
fixture$players[[j]]$skill_evidence_minutes <- list(SWITCH=sample_minutes)
fixture$players[[j]]$switch_sample <- list(status='partial',covered_games=1,stats_games=2,observed_at='2026-11-01T12:00:00Z')
jsonlite::write_json(fixture,file.path(test_root,'raw/live/skill_stats.json'),auto_unbox=TRUE,null='null',digits=NA)
partial <- model$apply_live_expected_ratings(p,test_root)
history <- fixture$historical_minutes[[as.character(p$nba_id[i])]]
if(is.null(history)) history <- list()
expected_weight <- model$live_evidence_weight(sample_minutes,history,fixture$season)$weight
stopifnot(abs(partial$skill_model_def[i]-held$skill_model_def[i]-expected_weight)<1e-8,
 partial$live_switch_current_weight[i]<partial$live_current_weight[i],
 partial$live_switch_status[i]=='partial',partial$live_switch_coverage_games[i]==1,
 identical(partial$FTD,updated$FTD),identical(partial$skill_model_off,updated$skill_model_off))
# Fresh box scores cannot give a retained matchup sample more weight.
fixture$players[[j]]$minutes <- fixture$players[[j]]$minutes+100
fixture$players[[j]]$switch_sample$status <- 'retained'
jsonlite::write_json(fixture,file.path(test_root,'raw/live/skill_stats.json'),auto_unbox=TRUE,null='null',digits=NA)
retained <- model$apply_live_expected_ratings(p,test_root)
stopifnot(identical(retained$SWITCH,partial$SWITCH),
 retained$live_switch_current_weight[i]==partial$live_switch_current_weight[i],retained$live_switch_status[i]=='retained')
retained2 <- model$apply_live_expected_ratings(retained,test_root)
stopifnot(identical(retained$SWITCH,retained2$SWITCH),identical(retained$skill_model_def,retained2$skill_model_def))
file.copy('raw/live/skill_stats.json',file.path(test_root,'raw/live/skill_stats.json'),overwrite=TRUE)
# Zero actual minutes retain SKILL, but do not suppress predictive EPM/DARKO.
ev <- jsonlite::fromJSON(file.path(test_root,'raw/live/skill_stats.json'),simplifyVector=FALSE)
for(i in seq_along(ev$players)) ev$players[[i]]$minutes <- 0
jsonlite::write_json(ev,file.path(test_root,'raw/live/skill_stats.json'),auto_unbox=TRUE,null='null')
zero <- model$apply_live_expected_ratings(p,test_root)
stopifnot(identical(zero$skill_model_off,p$skill_model_off),identical(zero$skill_model_def,p$skill_model_def))
stopifnot(identical(zero$off_dep,r$off_dep),identical(zero$def_dep,r$def_dep))
stopifnot(any(abs(zero$total-p$total)>.1),all(zero$live_current_weight==0))
stopifnot(identical(zero$offense,round(.8*zero$off_dep+.2*p$skill_model_off,3)))
for(h in 1:5) {
 col <- paste0('projection_y',h)
 stopifnot(isTRUE(all.equal(zero[[col]],p[[col]]+zero$total-p$total)))
}
file.copy('raw/live/skill_stats.json',file.path(test_root,'raw/live/skill_stats.json'),overwrite=TRUE)
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
 stopifnot(any(abs(pub$total-p$total[match(pub$nba_id,p$nba_id)])>.001,na.rm=TRUE),
 all(is.finite(pub$live_current_weight)),any(pub$live_skill_components_updated>0))
 # Published weights must use the same rule as the model, including draft IDs.
 evidence <- jsonlite::fromJSON('raw/live/skill_stats.json',simplifyVector=FALSE)
 for(i in seq_len(nrow(pub))) {
  id <- if('source_nba_id' %in% names(pub) && is.finite(pub$source_nba_id[i])) pub$source_nba_id[i] else pub$nba_id[i]
  history <- evidence$historical_minutes[[as.character(id)]]
  if(is.null(history)) history <- list()
  expected <- model$live_evidence_weight(pub$live_evidence_minutes[i],history,evidence$season)
  stopifnot(abs(pub$live_current_weight[i]-expected$weight)<1e-9,
            abs(pub$live_prior_minutes[i]-expected$prior)<1e-9)
 }
 baseline <- p$score[match(pub$nba_id,p$nba_id)]
 stopifnot(isTRUE(all.equal(pub$score_delta,round(pub$score-baseline,1),check.attributes=FALSE)))
 idx <- match(pub$nba_id,p$nba_id); matched <- !is.na(idx)
 for(h in 1:5) {
  col <- paste0('projection_y',h)
  stopifnot(max(abs(pub[[col]][matched]-(p[[col]][idx[matched]]+pub$total[matched]-p$total[idx[matched]])),na.rm=TRUE)<.001)
 }
 out <- jsonlite::fromJSON('frontend/public/data/v2/team_projections/2027.json');stopifnot(sum(out$actual_wins[out$scenario_id=='base'])==sum(s2$is_completed))
}
unlink(test_root,recursive=TRUE)
cat('Live metric identity, idempotence, current-result accounting and export tests passed\n')

