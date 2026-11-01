# Season evidence replaces the frozen preseason prior gradually by actual minutes.
live_evidence_weight <- function(minutes, history, season) {
  m <- max(0, min(4000, minutes)); remaining <- 4000-m; effective <- 0
  for (lag in 1:3) {
    value <- history[[as.character(season-lag)]]
    if (is.null(value) || !is.finite(value)) value <- 0
    used <- min(remaining,max(0,value))
    effective <- effective + used * .75^lag
    remaining <- remaining-used
  }
  # Synthetic evidence protects sparse-history players early, then is replaced
  # minute-for-minute. A rookie's preseason prior expires at 1,500 NBA minutes.
  prior <- max(effective,max(0,1500-m))
  list(weight=if(m+prior>0) m/(m+prior) else 0,prior=prior)
}

apply_live_expected_ratings <- function(rows, base_dir) {
  path <- file.path(base_dir,'raw/live/ratings.json')
  if (!file.exists(path)) return(rows)
  feed <- jsonlite::fromJSON(path)
  evidence <- jsonlite::fromJSON(file.path(base_dir,'raw/live/skill_stats.json'),simplifyVector=FALSE)
  if (!identical(feed$epm_type,'expected')) stop('Only expected EPM is permitted')
  if (any(rows$year != feed$season) || evidence$season!=feed$season) stop('Live rating season mismatch')
  archive <- jsonlite::fromJSON(file.path(base_dir,'frontend/public/data/archive/2027-preseason/impact_players.json'))
  prior <- rows
  anchor <- match(rows$nba_id,archive$nba_id); anchored <- !is.na(anchor)
  keys <- c('offense','defense','total','skill_model_off','skill_model_def','FTD','SHOOT','PASS','RIM','OREB','DPM','DREB','RIMPRO','SWITCH')
  for(k in keys) prior[[k]][anchored] <- archive[[k]][anchor[anchored]]
  src <- feed$players
  identity_ids <- rows$nba_id
  if('source_nba_id' %in% names(rows)) { known <- is.finite(rows$source_nba_id); identity_ids[known] <- rows$source_nba_id[known] }
  matched <- match(identity_ids,src$nba_id)
  key <- function(v) {
    v <- tolower(iconv(v,to='ASCII//TRANSLIT'))
    v <- sub(' (jr[.]?|sr[.]?|ii|iii|iv)$','',trimws(v))
    gsub('[^a-z0-9]','',v)
  }
  source_keys <- paste(key(src$player_name),src$team)
  unique_source <- !duplicated(source_keys) & !duplicated(source_keys,fromLast=TRUE)
  by_name <- match(paste(key(rows$player_name),rows$team_projection_base),ifelse(unique_source,source_keys,NA_character_))
  fallback <- is.na(matched) & rows$nba_id<0 & !is.na(by_name)
  matched[fallback] <- by_name[fallback]
  good <- !is.na(matched)
  active <- rows$team_projection_base!='FA' & !is.na(rows$team_projection_base)
  if(sum(pmax(0,rows$Minutes[good & active]),na.rm=TRUE)/sum(pmax(0,rows$Minutes[active]),na.rm=TRUE)<.9) stop('Live ratings cover less than 90% of rostered projected minutes')
  for(col in c('o_epm','d_epm','o_dpm','d_dpm')) {
    if(any(!is.finite(src[[col]]))) stop('Nonfinite live source ratings')
    rows[[col]][good] <- src[[col]][matched[good]]
  }
  blend <- function(a,b) {
    z <- function(v) (v-mean(v))/sd(v)
    mean(c(mean(a),mean(b)))+mean(c(sd(a),sd(b)))*z((z(a)+z(b))/2)
  }
  off <- blend(src$o_epm,src$o_dpm); def <- blend(src$d_epm,src$d_dpm)
  evidence_ids <- vapply(evidence$players,function(x) as.numeric(x$nba_id),numeric(1))
  canonical <- identity_ids; canonical[good] <- src$nba_id[matched[good]]
  observed <- match(canonical,evidence_ids)
  rows$live_evidence_minutes <- 0; rows$live_current_weight <- 0; rows$live_prior_minutes <- 0
  rows$live_skill_components_updated <- 0
  rows$live_switch_evidence_minutes <- 0; rows$live_switch_current_weight <- 0
  rows$live_switch_coverage_games <- 0; rows$live_switch_stats_games <- 0
  rows$live_switch_status <- 'unavailable'; rows$live_switch_observed_at <- NA_character_
  rows$skill_model_off <- prior$skill_model_off; rows$skill_model_def <- prior$skill_model_def
  for(k in names(evidence$calibration)) rows[[k]] <- prior[[k]]
  for(i in seq_len(nrow(rows))) {
    ev <- if(!is.na(observed[i])) evidence$players[[observed[i]]] else NULL
    minutes <- if(is.null(ev)) 0 else ev$minutes
    h <- evidence$historical_minutes[[as.character(canonical[i])]]
    if(is.null(h)) h <- list()
    weight <- live_evidence_weight(minutes,h,feed$season)
    w <- weight$weight
    rows$live_evidence_minutes[i] <- minutes
    rows$live_current_weight[i] <- w
    rows$live_prior_minutes[i] <- weight$prior
    if(is.null(ev)||w==0) next
    sample <- ev$switch_sample
    switch_minutes <- ev$skill_evidence_minutes$SWITCH
    if(is.null(switch_minutes)) switch_minutes <- minutes
    if(!is.finite(switch_minutes)) switch_minutes <- 0
    switch_minutes <- max(0,min(minutes,switch_minutes))
    has_switch <- !is.null(ev$raw_skills$SWITCH) && is.finite(ev$raw_skills$SWITCH)
    switch_weight <- if(has_switch) live_evidence_weight(switch_minutes,h,feed$season)$weight else 0
    rows$live_switch_evidence_minutes[i] <- if(has_switch) switch_minutes else 0
    rows$live_switch_current_weight[i] <- switch_weight
    rows$live_switch_stats_games[i] <- if(is.null(ev$games)) 0 else ev$games
    rows$live_switch_coverage_games[i] <- if(!has_switch) 0 else if(is.null(sample$covered_games)) rows$live_switch_stats_games[i] else sample$covered_games
    rows$live_switch_status[i] <- if(!has_switch) 'unavailable' else if(is.null(sample$status)) 'current' else sample$status
    if(!is.null(sample$observed_at)) rows$live_switch_observed_at[i] <- sample$observed_at
    deltas <- c(); weighted_deltas <- c(); observed_raw <- c()
    for(k in names(evidence$calibration)) {
      value <- ev$raw_skills[[k]]; cal <- evidence$calibration[[k]]
      if(is.null(value)||!is.finite(value)||!is.finite(prior[[k]][i])) next
      # Fixed historical calibration prevents two-game league distributions from
      # redefining the scale. Bound extreme one-game rates at five historical SDs.
      z <- max(-5,min(5,(value-cal$mean)/cal$sd))
      observed_raw[k] <- cal$mean+z*cal$sd
      deltas[k] <- (z-prior[[k]][i])*cal$sd
      component_weight <- if(k=='SWITCH') switch_weight else w
      weighted_deltas[k] <- component_weight*deltas[k]
      rows[[k]][i] <- round((1-component_weight)*prior[[k]][i]+component_weight*z,3)
    }
    offensive <- c('FTD','SHOOT','PASS','RIM','OREB')
    defensive <- c('DPM','DREB','RIMPRO','SWITCH')
    if(all(offensive %in% names(observed_raw))) {
      current_off <- evidence$intercepts$off+sum(observed_raw[offensive])
      rows$skill_model_off[i] <- (1-w)*prior$skill_model_off[i]+w*current_off
    } else rows$skill_model_off[i] <- prior$skill_model_off[i]+w*sum(deltas[intersect(offensive,names(deltas))])
    # SWITCH uses its own covered sample, including a retained valid sample.
    # New box-score minutes must not increase the weight of older matchups.
    rows$skill_model_def[i] <- prior$skill_model_def[i]+sum(weighted_deltas[intersect(defensive,names(weighted_deltas))])
    rows$live_skill_components_updated[i] <- length(deltas)
  }
  # Expected EPM and DARKO already handle history and small samples internally.
  # Use their latest forecasts directly; actual-minute shrinkage belongs to SKILL.
  # Retain the implied preseason external estimate only when providers are missing.
  rows$off_dep <- (prior$offense-.2*prior$skill_model_off)/.8
  rows$def_dep <- (prior$defense-.2*prior$skill_model_def)/.8
  rows$off_dep[good] <- off[matched[good]]
  rows$def_dep[good] <- def[matched[good]]
  rows$offense <- round(.8*rows$off_dep+.2*rows$skill_model_off,3)
  rows$defense <- round(.8*rows$def_dep+.2*rows$skill_model_def,3)
  rows$total <- round(rows$offense+rows$defense,3)
  # Preserve exact archived rounding only when neither input has new information.
  zero <- rows$live_current_weight==0 & !good
  for(k in c('offense','defense','total')) rows[[k]][zero] <- prior[[k]][zero]
  # Keep the preseason aging curve, but carry the new level estimate into every
  # future year. Always anchor archived players to prevent daily compounding.
  for(k in c('total','offense','defense','skill_model_off','skill_model_def')) {
    delta <- rows[[k]]-prior[[k]]
    for(h in 1:5) {
      col <- if(k=='total') paste0('projection_y',h) else paste0('projection_',k,'_y',h)
      if(!col %in% names(rows)) next
      baseline <- prior[[col]]
      if(col %in% names(archive)) baseline[anchored] <- archive[[col]][anchor[anchored]]
      rows[[col]] <- baseline+delta
    }
  }
  rows$skill_off_total <- rows$skill_model_off; rows$skill_def_total <- rows$skill_model_def
  for(pair in list(c('FINAL_OFF','offense'),c('FINAL_DEF','defense'),c('FINAL_TOTAL','total'))) if(pair[1] %in% names(rows)) rows[[pair[1]]] <- rows[[pair[2]]]
  rows$skill_source[good] <- 'live_expected_epm_darko'
  rows$availability_reason <- paste0('SKILL: ',rows$live_evidence_minutes,' actual minutes; ',round(100*rows$live_current_weight,1),'% current statistics / ',round(100*(1-rows$live_current_weight),1),'% preseason SKILL prior. Overall: 80% external forecast + 20% SKILL. Expected EPM ',feed$epm_as_of,'; DARKO through ',feed$darko_through,'. Available external forecasts apply immediately. Injuries affect minutes separately.')
  rows$availability_reason <- paste0(rows$availability_reason,' SWITCH: ',rows$live_switch_coverage_games,' of ',rows$live_switch_stats_games,' games covered; ',round(100*rows$live_switch_current_weight,1),'% observed / ',round(100*(1-rows$live_switch_current_weight),1),'% preseason; ',rows$live_switch_status,'. Covered SWITCH minutes are estimated by game coverage.')
  rows$availability_reason[!good] <- paste0(rows$availability_reason[!good],' No complete current EPM/DARKO pair; external forecast prior retained.')
  audit <- list(schema_version=2,season=feed$season,generated_at=feed$generated_at,epm_type='expected',epm_as_of=feed$epm_as_of,darko_through=feed$darko_through,epm_url=feed$epm_url,darko_url=feed$darko_url,matched_players=sum(good),total_players=nrow(rows),unmatched_players=rows$player_name[!good],skill_stats_fetched_at=evidence$generated_at,skill_updated_players=sum(rows$live_skill_components_updated>0),max_current_weight=max(rows$live_current_weight),held_skill_components=evidence$held_components,switch_status=evidence$switch_status,
    method='Overall impact is 80% latest expected EPM/DARKO blend plus 20% SKILL. Expected EPM and DARKO already incorporate historical evidence and uncertainty, so no additional current-minute shrinkage is applied to their forecasts. Gradual weighting applies only inside SKILL: up to 4,000 minutes, current season first; previous years count 75%, 56.25%, 42.19% per minute. Synthetic preseason evidence starts at 1,500 minutes and declines one-for-one; rookies fully replace this SKILL prior at 1,500 minutes. Actual historical evidence remains in veteran SKILL weighting. SWITCH uses its own matchup-covered evidence minutes, estimated by game coverage. A smaller valid matchup sample updates at a smaller weight; outages retain the last valid same-season sample without increasing its evidence weight. Missing components retain priors. The 80/20 mix is a modeling choice, not a backtested optimal weighting. Injuries and actual game results apply immediately.')
  audit$future_rating_method <- 'Future-year impact and SKILL paths retain their preseason aging shape, shifted by the current estimate minus preseason. Future values are recalculated from these updated ratings.'
  jsonlite::write_json(audit,file.path(base_dir,'frontend/public/data/live_status.json'),auto_unbox=TRUE,pretty=TRUE)
  message('Live ratings matched: ',sum(good),' / ',nrow(rows),'; SKILL updated: ',audit$skill_updated_players,'; max current weight: ',round(100*audit$max_current_weight,2),'%')
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
