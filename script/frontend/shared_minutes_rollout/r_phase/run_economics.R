# Same-date staged minutes-dependent Player Impact calculations only.
a <- commandArgs(TRUE)
if(length(a)!=8L) stop("repo active-impact witness exact-ledger historic-shards output first-history-season season")
repo <- normalizePath(a[1]); base <- normalizePath(a[2]); witness <- normalizePath(a[3])
ledger_path <- normalizePath(a[4]); history <- normalizePath(a[5]); out <- a[6]
first <- as.integer(a[7]); season <- as.integer(a[8]); stopifnot(first < season)
if (file.exists(out) || !startsWith(out,"/") || startsWith(out,paste0(repo,"/"))) stop("Use new private output")
setwd(repo)
rb <- readLines("script/frontend/export_frontend_data.R"); end <- grep("^base_dir <- resolve_base_dir\\(\\)$",rb)
stopifnot(length(end)==1L); eval(parse(text=rb[seq_len(end-1L)]),globalenv())
source("script/frontend/player_pool.R")
p <- jsonlite::fromJSON(base); w <- jsonlite::fromJSON(witness); ledger <- read.csv(ledger_path,stringsAsFactors=FALSE)
id <- function(x) ifelse(is.finite(x$source_nba_id),x$source_nba_id,x$nba_id)
keep <- which(p$pool_status=="roster"); k <- match(id(p)[keep],id(w))
stopifnot(length(keep)>0L,!anyNA(k),!anyDuplicated(k),all(p$team[keep]==w$team[k]))
ns <- c("year","value","contract","contract_status","availability_status")
historical <- do.call(rbind,lapply(first:(season-1L),function(y) jsonlite::fromJSON(file.path(history,paste0(y,".json")))[ns]))
stopifnot(nrow(historical)>100L, setequal(historical$year,first:(season-1L)))
cap_assumptions <- load_cap_assumptions(repo)
contract_scale_model <- fit_value_contract_scale_model(historical,cap_assumptions)
for(field in setdiff(names(w),c("nba_id","source_nba_id","team"))) p[[field]][keep] <- w[[field]][k]
split_ledger <- split(ledger,ledger$nba_id)
for(i in seq_along(keep)) {
 j <- keep[i]; q <- split_ledger[[as.character(id(p)[j])]]; q <- q[order(q$game),]
 n <- p$minutes_remaining_team_games[j]
 stopifnot(nrow(q)>=n+410L,all(q$game==seq_len(nrow(q))),all(q$team==p$team[j]))
 cur <- q[seq_len(n),]
 bgp <- sum(cur$baseline_probability); bmins <- sum(cur$healthy_rotation)
 p$minutes_play_probability[j] <- if(n>0) bgp/n else 0
 p$minutes_expected_mpg[j] <- if(n>0) bmins/n else 0
 p$minutes_healthy_mpg[j] <- if (bgp>0) bmins/bgp else 0
 p$minutes_input_mpg[j] <- p$minutes_mpg_prior[j]
 p$minutes_note[j] <- "Same dated shared availability and role ledger used by Team Forecast and Assets."
 p$p_mpg[j] <- if (p$games[j]>0) p$Minutes[j]/p$games[j] else 0
 for(h in 1:5) {
  cells <- q[n+(h-1L)*82L+seq_len(82L),]
  gp <- sum(cells$probability); mins <- sum(cells$expected_minutes)
  p[[paste0("projection_games_y",h)]][j] <- gp
  p[[paste0("projection_minutes_y",h)]][j] <- mins
  p[[paste0("projection_mpg_y",h)]][j] <- if(gp>0) mins/gp else 0
 }
}
# Exact exporter fields and formulas; immutable same-date per-minute ratings and contracts.
cap_proxy <- cap_for_year(cap_assumptions,season,"scale_cap")
if(!is.finite(cap_proxy) || cap_proxy<=0) stop("Invalid exact current cap")
p$timin[keep] <- round((p$total[keep]-p$replacement_total[keep])*pmax(0,p$Minutes[keep]),1)
league_timin <- sum(p$timin,na.rm=TRUE); stopifnot(is.finite(league_timin),league_timin>0)
p <- season_pool_scores(p,repo)
p$season_value[keep] <- round(p$timin[keep]*cap_proxy*30/league_timin,0)
p$raw_minutes[keep] <- p$Minutes[keep]; p$raw_timin[keep] <- p$timin[keep]; p$value[keep] <- p$season_value[keep]
p$value_add[keep] <- ifelse(is.finite(p$contract[keep]),round(p$value[keep]-p$contract[keep],0),NA_real_)
p$trade_value[keep] <- round(p$value[keep]*(.45+p$score[keep]/170),0)
p$scalability[keep] <- scale_from_value_contract(p$value[keep],cap_proxy,p$Minutes[keep],p$contract[keep])
for(h in 1:5) {
 future_cap <- cap_for_year(cap_assumptions,p$year+h,"scale_cap")
 stopifnot(all(is.finite(future_cap)),all(future_cap>0))
 p[[paste0("projection_cap_y",h)]][keep] <- future_cap[keep]
 t <- paste0("projection_timin_y",h); v <- paste0("projection_value_y",h)
 p[[t]][keep] <- round((p[[paste0("projection_y",h)]][keep]-p$replacement_total[keep])*pmax(0,p[[paste0("projection_minutes_y",h)]][keep]),1)
 p[[v]][keep] <- round(p[[t]][keep]*future_cap[keep]*30/league_timin,0)
}
fa_market <- calc_fa_market_values(p,cap_assumptions,horizon=1)
for(n in names(fa_market)) p[[n]][keep] <- fa_market[[n]][keep]
for(h in 1:5) p[[paste0("projection_fa_value_y",h)]][keep] <- calc_fa_market_values(p,cap_assumptions,horizon=h)$fa_value[keep]
p <- recalculate_projection_scalability(p,cap_assumptions,contract_scale_model=contract_scale_model)
pending <- keep[p$contract_pending[keep]]

for(f in c("contract","contract_cap_salary","value_add","trade_value","scalability",grep("^projection_(effective_)?contract_y",names(p),value=TRUE))) p[[f]][pending] <- NA_real_
jsonlite::write_json(p[keep,],out,dataframe="rows",auto_unbox=TRUE,na="null",digits=16)
