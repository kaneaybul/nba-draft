# Private same-date shared-ledger team, schedule, lineup bridge. No writes to repo.
a <- commandArgs(TRUE)
if(length(a)!=11L) stop("repo helper exact-current-impact observed-roster dated-calendar dated-outlook ledger out version asof season")
repo <- normalizePath(a[1]); helper <- normalizePath(a[2]); impact <- normalizePath(a[3])
observed <- normalizePath(a[4]); calendar <- normalizePath(a[5]); injury <- normalizePath(a[6])
input <- normalizePath(a[7]); out <- normalizePath(a[8],mustWork=FALSE); version <- a[9]
if (dir.exists(out) || startsWith(out,paste0(repo,"/"))) stop("Use a new private output directory outside the checkout")
if (any(nzchar(Sys.getenv(c("NBA_ROLLING_ROLE_FILE","NBA_ROLLING_ROLE_AS_OF","NBA_DAILY_OFFICIAL_OUTLOOK"))))) stop("Legacy role or injury override is not authorized")
setwd(repo)
rb <- readLines("script/frontend/export_frontend_data.R"); end <- grep("^base_dir <- resolve_base_dir\\(\\)$",rb)
stopifnot(length(end)==1L); eval(parse(text=rb[seq_len(end-1L)]),globalenv())
source("script/frontend/player_pool.R");source("script/frontend/injury_projections.R");source(helper)
p <- jsonlite::fromJSON(impact); r <- jsonlite::fromJSON(observed)
s <- jsonlite::fromJSON(calendar)
o <- jsonlite::fromJSON(injury,simplifyVector=FALSE)
ledger <- read.csv(input, stringsAsFactors=FALSE)
asof <- a[10]; season <- as.integer(a[11])
stopifnot(!is.na(as.Date(asof)),is.finite(season),all(ledger$asof==asof))
id <- function(x) ifelse(is.finite(x$source_nba_id),x$source_nba_id,x$nba_id)
keep <- which(p$pool_status=="roster"); k <- match(id(p)[keep],id(r))
stopifnot(nrow(p)>0L,length(keep)>0L,!anyNA(k),!anyDuplicated(k),length(k)==nrow(r),
          all(r$asof==asof),all(r$year==season),all(p$team[keep]==r$team[k]),
          all(p$team_projection_base[keep]==r$team[k]),all(p$contract_pending[keep]==r$contract_pending[k]),
          all(p$minutes_actual[keep]==r$minutes_actual[k]),all(p$minutes_actual_games[keep]==r$minutes_actual_games[k]),
          all(s$season==season),o$teams_checked==30L,o$season==season)
if(!all(c("home_win_probability","away_win_probability")%in%names(s))) {
  s$home_win_probability <- s$away_win_probability <- NA_real_
  s$home_win_probability[s$is_completed] <- as.numeric(s$home_team[s$is_completed]==s$result[s$is_completed])
  s$away_win_probability[s$is_completed] <- as.numeric(s$away_team[s$is_completed]==s$result[s$is_completed])
}
cells <- split(ledger,ledger$nba_id)
for(i in seq_along(k)) {
 j <- keep[i]; q <- cells[[as.character(id(p)[j])]]
 q <- q[q$game<=r$minutes_remaining_team_games[k[i]],,drop=FALSE]
 if(nrow(q)!=r$minutes_remaining_team_games[k[i]] || !all(q$team==p$team[j])) stop("Incorrect exact ledger coverage")
 p$Minutes[j] <- r$minutes_actual[k[i]] + sum(q$healthy_rotation)
 p$games[j] <- r$minutes_actual_games[k[i]] + sum(q$baseline_probability)
 p$p_mpg[j] <- if(p$games[j]>0) p$Minutes[j]/p$games[j] else 0
 if(!"baseline_minutes"%in%names(q)) stop("Missing preallocation ledger stage")
 pre_role <- q$baseline_minutes
 p$lineup_original_minutes[j] <- r$minutes_actual[k[i]]+sum(pre_role)
 p$lineup_adjusted_minutes[j] <- p$Minutes[j]
 p$minutes_source[j] <- version
}
# Reset only descriptive results. Forecast authority comes from shared cells, not from the old active minutes.
p$injury_base_minutes <- NA_real_
options(nba.shared_current_team_game_rotation=make_shared_current_team_game_rotation(ledger,s,asof,season,version))
dir.create(out,recursive=TRUE)
Sys.setenv(NBA_MINUTE_CAPACITY_EVIDENCE=file.path(out,"capacity.json"))
result <- apply_injury_projections(p,s,o)
rp <- result$players; rs <- result$schedules
for(i in seq_along(k)) {
 j <- keep[i]; q <- cells[[as.character(id(rp)[j])]]; q <- q[q$game<=r$minutes_remaining_team_games[k[i]],,drop=FALSE]
 if(abs(rp$Minutes[j]-r$minutes_actual[k[i]]-sum(q$expected_minutes))>1e-7 ||
    abs(rp$games[j]-r$minutes_actual_games[k[i]]-sum(q$probability))>1e-7 ||
    rp$minutes_remaining_team_games[j]!=nrow(q)) stop("Projected date loop changed the ledger")
}
teams <- apply_schedule_projections(build_team_projections(rp),rs)
teams$schedule_as_of[teams$schedule_adjusted %in% TRUE] <- asof
stopifnot(nrow(teams)==90L,nrow(rs)==nrow(s), identical(rs$game_id,s$game_id), identical(rs$is_completed,s$is_completed))
write <- function(f,data) jsonlite::write_json(data,file.path(out,f),dataframe="rows",auto_unbox=TRUE,na="null",digits=16)
write("team_projections.json",teams);write("team_schedules.json",rs)
write("player_minutes_witness.json",rp[keep,intersect(names(rp),c("nba_id","source_nba_id","team","Minutes","games","p_mpg","minutes_source","minutes_actual","minutes_actual_games","minutes_remaining","minutes_remaining_games","minutes_remaining_mpg","minutes_remaining_team_games","minutes_team_budget","lineup_original_minutes","lineup_adjusted_minutes","injury_base_minutes","injury_base_games","injury_availability","injury_games_missed","injury_minutes_lost","injury_minutes_delta","injury_projection_as_of","injury_projection_note","injury_projection_basis","injury_source_url"))])
