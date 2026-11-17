# Source-only preparer: stop before any live minute allocation occurs.
options(error=function(){traceback(4);quit(status=1)})
a<-commandArgs(trailingOnly=TRUE);stopifnot(length(a)==3L);season<-as.integer(a[3]);stopifnot(!is.na(season));base_dir<-normalizePath(a[1]);out<-normalizePath(a[2],mustWork=FALSE);setwd(base_dir)
txt<-readLines('script/frontend/export_frontend_data.R');end<-grep('^base_dir <- resolve_base_dir',txt)[1];eval(parse(text=txt[seq_len(end-1)]),globalenv())
for(f in c('script/draft/name_matching.R','script/data/darko_dpm_fallback.R','script/frontend/injury_projections.R','script/frontend/live_ratings.R','script/frontend/player_pool.R','script/frontend/live_minutes.R'))source(f)
apply_live_minute_inputs<-function(rows,base_dir){
 keys<-c('nba_id','source_nba_id','player_name','team','team_projection_base','year','age','yoe','Pos1','position','pool_status')
 x<-structure(list(message='demographics_ready',rows=rows[,intersect(keys,names(rows)),drop=FALSE]),class=c('demographics_ready','error','condition'));stop(x)
}
allocate_live_rotation<-function(...)stop('Unexpected allocation in source-only stage')
apply_injury_projections<-function(...)stop('Unexpected injury allocation in source-only stage')
result<-tryCatch({build_impact_players(base_dir);stop('No source boundary reached')},demographics_ready=function(e)e$rows)
stopifnot(length(unique(result$team[result$pool_status %in% 'roster']))==30L,nrow(result)>500,all(result$year==season),!anyDuplicated(result$nba_id))
jsonlite::write_json(result,out,dataframe='rows',auto_unbox=TRUE,na='null',digits=16)
cat('SOURCE_ONLY_DEMOGRAPHICS',nrow(result),'\n')
