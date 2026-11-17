# Existing schedule/result/calendar code only. No player ratings or probabilities exported.
a<-commandArgs(trailingOnly=TRUE);stopifnot(length(a)==3L);season<-as.integer(a[3]);stopifnot(!is.na(season));base_dir<-normalizePath(a[1]);out<-normalizePath(a[2],mustWork=FALSE);setwd(base_dir)
txt<-readLines('script/frontend/export_frontend_data.R');end<-grep('^base_dir <- resolve_base_dir',txt)[1];eval(parse(text=txt[seq_len(end-1)]),globalenv())
source('script/frontend/live_ratings.R')
stopifnot(Sys.getenv('NBA_REFRESH_SCHEDULES')=='false',file.exists('processed/livedata/schedules/bref_team_schedules.csv'))
book<-jsonlite::fromJSON('processed/contracts/current.json');teams<-data.frame(year=season,team=sort(unique(book$players$team)),adjusted_total=NA_real_);teams$conference<-team_conference(teams$team)
stopifnot(book$season==season,length(unique(teams$team))==30L)
x<-build_team_schedules(teams);x<-x[x$season==season,];x<-x[,setdiff(names(x),c('home_win_probability','away_win_probability')),drop=FALSE]
jsonlite::write_json(x,out,dataframe='rows',auto_unbox=TRUE,na='null',digits=16);cat('SOURCE_ONLY_SCHEDULE',nrow(x),'\n')
