# Exercise the full perimeter scoring step with a known role-only signal.
original <- getwd()
root <- tempfile('switch-test-');dir.create(root)
for(p in c('raw/live','processed/livedata/impactrefresh','processed/modelresults')) dir.create(file.path(root,p),recursive=TRUE)
set.seed(7);n <- 120
center <- rep(0:1,length.out=n);blocks <- runif(n);rebounds <- runif(n,1,10);rim <- runif(n,1,8);saved <- runif(n,-2,2)
target <- .3+center*.2+blocks*.4+rebounds*.1+rim*.05+saved*.7
db <- data.frame(nba_id=1:n,year=2026,Pos2=ifelse(center==1,'C','G'),points_saved_100=target/.6+saved,rim_points_saved_100=saved,d_FG3A_Per100=4,d_LongMidRangeFGA_Per100=2,d_ShortMidRangeFGA_Per100=4,check.names=FALSE)
db[['rimdfga/100']] <- rim
hist <- data.frame(nba_id=1:n,year=2026,d_Blocks_Per100=blocks,d_DefRebounds_Per100=rebounds,rim_points_saved_100=saved,check.names=FALSE)
hist[['rimdfga/100']] <- rim
write.csv(db,file.path(root,'raw/databallr_stats.csv'),row.names=FALSE)
write.csv(hist,file.path(root,'processed/livedata/impactrefresh/defdata.csv'),row.names=FALSE)
write.csv(data.frame(term=c('switch','perimeter_alloc_ps_resid_role'),Estimate=c(2,3)),file.path(root,'processed/modelresults/def_lm_1_results.csv'),row.names=FALSE)
x <- as.list(db[1,]);x[['dfga/100']] <- 15;x$d_Blocks_Per100 <- blocks[1];x$d_DefRebounds_Per100 <- rebounds[1]
bad <- x;bad[['dfga/100']] <- 0
unknown <- x;unknown$Pos2 <- ''
feed <- list(season=2027,switch_assignments=list('1'=.7,'2'=.7,'3'=.7),switch_status=list(status='assignments_available'),players=list(list(nba_id=1,raw_skills=list(SWITCH=NULL),perimeter_inputs=x),list(nba_id=2,raw_skills=list(SWITCH=NULL),perimeter_inputs=bad),list(nba_id=3,raw_skills=list(SWITCH=NULL),perimeter_inputs=unknown)))
path <- file.path(root,'raw/live/skill_stats.json')
jsonlite::write_json(feed,path,auto_unbox=TRUE,null='null',digits=NA)
setwd(root)
source(file.path(original,'script/frontend/refresh_live_switch.R'),local=new.env())
out <- jsonlite::fromJSON(path,simplifyVector=FALSE)
stopifnot(out$switch_status$updated_players==1,abs(out$players[[1]]$raw_skills$SWITCH-1.4)<1e-8,is.null(out$players[[2]]$raw_skills$SWITCH),is.null(out$players[[3]]$raw_skills$SWITCH))
feed$switch_assignments <- list();feed$switch_status <- list(status='unavailable',reason='No current matchups')
jsonlite::write_json(feed,path,auto_unbox=TRUE,null='null',digits=NA)
source(file.path(original,'script/frontend/refresh_live_switch.R'),local=new.env())
out <- jsonlite::fromJSON(path,simplifyVector=FALSE)
stopifnot(out$switch_status$updated_players==0,is.null(out$players[[1]]$raw_skills$SWITCH),'SWITCH' %in% unlist(out$held_components))
# During an outage retain the last valid observation and its original sample.
feed$players[[1]]$raw_skills$SWITCH <- 1.4
feed$players[[1]]$skill_evidence_minutes <- list(SWITCH=50)
feed$players[[1]]$switch_sample <- list(status='retained',covered_games=2,stats_games=3,evidence_minutes=50)
jsonlite::write_json(feed,path,auto_unbox=TRUE,null='null',digits=NA)
source(file.path(original,'script/frontend/refresh_live_switch.R'),local=new.env())
out <- jsonlite::fromJSON(path,simplifyVector=FALSE)
stopifnot(out$switch_status$updated_players==1,out$switch_status$retained_players==1,
 out$switch_status$held_players==2,out$switch_status$status=='partial',
 out$players[[1]]$raw_skills$SWITCH==1.4,out$players[[1]]$skill_evidence_minutes$SWITCH==50)
setwd(original);unlink(root,recursive=TRUE)
cat('SWITCH perimeter calibration, missing-exposure and unavailable-source tests passed\n')

# Exercise the actual historical calibration on a saved current-season example.
# Inputs are the app's published Oct 25 perimeter data and a public NBA matchup
# assignment score. No live service or credential is needed for this regression.
root <- tempfile('switch-real-test-');dir.create(root)
for(p in c('raw/live','processed/livedata/impactrefresh','processed/modelresults')) dir.create(file.path(root,p),recursive=TRUE)
for(p in c('raw/databallr_stats.csv','processed/livedata/impactrefresh/defdata.csv','processed/modelresults/def_lm_1_results.csv')) {
  stopifnot(file.symlink(file.path(original,p),file.path(root,p)))
}
x <- list(Pos2='SG',points_saved_100=-2.106,rim_points_saved_100=-1.544,
  'rimdfga/100'=4,'dfga/100'=11.2,d_FG3A_Per100=2.419,d_LongMidRangeFGA_Per100=.806,
  d_ShortMidRangeFGA_Per100=7.258,d_Blocks_Per100=0,d_DefRebounds_Per100=3.226)
feed <- list(season=2027,switch_assignments=list('1643408'=.7188977278750194),
  switch_status=list(status='assignments_available'),players=list(list(nba_id=1643408,raw_skills=list(SWITCH=NULL),perimeter_inputs=x)))
path <- file.path(root,'raw/live/skill_stats.json')
jsonlite::write_json(feed,path,auto_unbox=TRUE,null='null',digits=NA)
setwd(root)
source(file.path(original,'script/frontend/refresh_live_switch.R'),local=new.env())
out <- jsonlite::fromJSON(path,simplifyVector=FALSE)
stopifnot(out$switch_status$updated_players==1,is.finite(out$players[[1]]$raw_skills$SWITCH))
cat('Actual historical SWITCH calibration passed; Peterson example raw contribution:',out$players[[1]]$raw_skills$SWITCH,'\n')
setwd(original);unlink(root,recursive=TRUE)

