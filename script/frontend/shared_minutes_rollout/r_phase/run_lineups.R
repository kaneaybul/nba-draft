a <- commandArgs(TRUE);stopifnot(length(a)==4L)
repo <- normalizePath(a[1]); rows <- jsonlite::fromJSON(a[2]); out <- a[3]
stopifnot(!file.exists(out),nrow(rows)>0L, all(rows$year==as.integer(a[4])))
setwd(repo); r <- readLines("script/frontend/export_frontend_data.R")
n <- grep("^base_dir <- resolve_base_dir\\(\\)$",r);stopifnot(length(n)==1L)
eval(parse(text=r[seq_len(n-1L)]),globalenv())
z <- build_team_lineups(rows);stopifnot(nrow(z)==900L, all(z$year==as.integer(a[4])))
jsonlite::write_json(z,out,dataframe="rows",auto_unbox=TRUE,na="null",digits=16)
