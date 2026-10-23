# Expected EPM and DARKO replace the external part of the active-season forecast.
# Historical rows and skill-model priors remain unchanged; values are then rebuilt
# by the normal exporter, followed by the dated injury/rotation calculation.
apply_live_expected_ratings <- function(rows, base_dir) {
  path <- file.path(base_dir, 'raw', 'live', 'ratings.json')
  if (!file.exists(path)) return(rows)
  feed <- jsonlite::fromJSON(path)
  if (!identical(feed$epm_type, 'expected')) stop('Only expected EPM is permitted')
  if (any(rows$year != feed$season)) stop('Live rating season mismatch')
  src <- feed$players
  matched <- match(rows$nba_id, src$nba_id)
  # Draft rows use stable synthetic IDs. Resolve only unique exact normalized
  # names with matching current teams; never fuzzy-match two players.
  key <- function(v) gsub('[^a-z0-9]', '', tolower(iconv(v,to='ASCII//TRANSLIT')))
  source_keys <- paste(key(src$player_name),src$team)
  target_keys <- paste(key(rows$player_name),rows$team_projection_base)
  unique_source <- !duplicated(source_keys) & !duplicated(source_keys,fromLast=TRUE)
  by_name <- match(target_keys,ifelse(unique_source,source_keys,NA_character_))
  fallback <- is.na(matched) & rows$nba_id < 0 & !is.na(by_name)
  matched[fallback] <- by_name[fallback]
  good <- !is.na(matched)
  active <- rows$team_projection_base != 'FA' & !is.na(rows$team_projection_base)
  if (sum(pmax(0, rows$Minutes[good & active]), na.rm=TRUE) / sum(pmax(0, rows$Minutes[active]), na.rm=TRUE) < .9) stop('Live ratings cover less than 90% of rostered projected minutes')
  for (col in c('o_epm','d_epm','o_dpm','d_dpm')) {
    if (any(!is.finite(src[[col]]))) stop('Nonfinite live source ratings')
    rows[[col]][good] <- src[[col]][matched[good]]
  }
  # Same standardized, equal-weight EPM/DPM construction as createimpact.txt.
  # Estimate the distribution over the entire matched provider pool, not a team.
  blend <- function(a,b) {
    z <- function(v) (v-mean(v))/sd(v)
    mean(c(mean(a),mean(b))) + mean(c(sd(a),sd(b))) * z((z(a)+z(b))/2)
  }
  off <- blend(src$o_epm,src$o_dpm); def <- blend(src$d_epm,src$d_dpm)
  rows$off_dep[good] <- off[matched[good]]
  rows$def_dep[good] <- def[matched[good]]
  rows$offense[good] <- round(.8*rows$off_dep[good]+.2*rows$skill_model_off[good],3)
  rows$defense[good] <- round(.8*rows$def_dep[good]+.2*rows$skill_model_def[good],3)
  rows$total[good] <- round(rows$offense[good]+rows$defense[good],3)
  for (pair in list(c('FINAL_OFF','offense'),c('FINAL_DEF','defense'),c('FINAL_TOTAL','total'))) if (pair[1] %in% names(rows)) rows[[pair[1]]][good] <- rows[[pair[2]]][good]
  rows$skill_source[good] <- 'live_expected_epm_darko'
  rows$availability_reason[good] <- paste0('Expected EPM ',feed$epm_as_of,'; DARKO through ',feed$darko_through,'; existing skill-model prior. Projected minutes include current injuries.')
  rows$availability_reason[!good] <- paste0('No complete current EPM/DARKO pair; preseason player forecast retained. ',rows$availability_reason[!good])
  audit <- list(schema_version=1,season=feed$season,generated_at=feed$generated_at,epm_type='expected',epm_as_of=feed$epm_as_of,darko_through=feed$darko_through,epm_url=feed$epm_url,darko_url=feed$darko_url,matched_players=sum(good),total_players=nrow(rows),unmatched_players=rows$player_name[!good],method='80% standardized equal-weight expected EPM/DARKO blend plus 20% existing skill-model prior. Ratings feed the usual minutes, value, Scale and team projection calculations. Missing source pairs retain their preseason forecast.')
  jsonlite::write_json(audit,file.path(base_dir,'frontend/public/data/live_status.json'),auto_unbox=TRUE,pretty=TRUE)
  message('Live ratings applied: ',sum(good),' / ',nrow(rows))
  rows
}

apply_live_game_results <- function(schedules, base_dir) {
  path <- file.path(base_dir,'raw/live/results.json')
  if (!file.exists(path)) return(schedules)
  feed <- jsonlite::fromJSON(path)
  if (!length(feed$games)) return(schedules)
  games <- feed$games
  key <- function(x) paste(x$date,x$home_team,x$away_team,sep='|')
  idx <- match(key(games),key(schedules))
  if (anyNA(idx)) stop('Current game results do not match the published schedule')
  if (any(schedules$season[idx] != feed$season)) stop('Result season mismatch')
  for (k in c('home_score','away_score','is_completed','result')) schedules[[k]][idx] <- games[[k]]
  # Actual outcomes are consumed by apply_schedule_projections, never converted
  # into a new noisy player rating or added again as expected wins.
  schedules
}
