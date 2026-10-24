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
    deltas <- c(); observed_raw <- c()
    for(k in names(evidence$calibration)) {
      value <- ev$raw_skills[[k]]; cal <- evidence$calibration[[k]]
      if(is.null(value)||!is.finite(value)||!is.finite(prior[[k]][i])) next
      # Fixed historical calibration prevents two-game league distributions from
      # redefining the scale. Bound extreme one-game rates at five historical SDs.
      z <- max(-5,min(5,(value-cal$mean)/cal$sd))
      observed_raw[k] <- cal$mean+z*cal$sd
      deltas[k] <- (z-prior[[k]][i])*cal$sd
      rows[[k]][i] <- round((1-w)*prior[[k]][i]+w*z,3)
    }
    offensive <- c('FTD','SHOOT','PASS','RIM','OREB')
    defensive <- c('DPM','DREB','RIMPRO','SWITCH')
    if(all(offensive %in% names(observed_raw))) {
      current_off <- evidence$intercepts$off+sum(observed_raw[offensive])
      rows$skill_model_off[i] <- (1-w)*prior$skill_model_off[i]+w*current_off
    } else rows$skill_model_off[i] <- prior$skill_model_off[i]+w*sum(deltas[intersect(offensive,names(deltas))])
    # Update SWITCH only when both current assignment and perimeter inputs exist.
    # Missing components retain their preseason contribution.
    rows$skill_model_def[i] <- prior$skill_model_def[i]+w*sum(deltas[intersect(defensive,names(deltas))])
    rows$live_skill_components_updated[i] <- length(deltas)
  }
  # Recover the external component implied by the frozen 80/20 forecast. This
  # avoids a day-one switch in modeling methods; zero actual minutes means the
  # original rating, and only accumulated minutes let current estimates take over.
  rows$off_dep <- (prior$offense-.2*prior$skill_model_off)/.8
  rows$def_dep <- (prior$defense-.2*prior$skill_model_def)/.8
  w <- rows$live_current_weight[good]
  rows$off_dep[good] <- (1-w)*rows$off_dep[good]+w*off[matched[good]]
  rows$def_dep[good] <- (1-w)*rows$def_dep[good]+w*def[matched[good]]
  rows$offense <- round(.8*rows$off_dep+.2*rows$skill_model_off,3)
  rows$defense <- round(.8*rows$def_dep+.2*rows$skill_model_def,3)
  rows$total <- round(rows$offense+rows$defense,3)
  # Preserve exact archived rounding when there is no new evidence.
  zero <- rows$live_current_weight==0
  for(k in c('offense','defense','total')) rows[[k]][zero] <- prior[[k]][zero]
  rows$skill_off_total <- rows$skill_model_off; rows$skill_def_total <- rows$skill_model_def
  for(pair in list(c('FINAL_OFF','offense'),c('FINAL_DEF','defense'),c('FINAL_TOTAL','total'))) if(pair[1] %in% names(rows)) rows[[pair[1]]] <- rows[[pair[2]]]
  rows$skill_source[good] <- 'live_expected_epm_darko'
  rows$availability_reason <- paste0('Season evidence: ',rows$live_evidence_minutes,' actual minutes; ',round(100*rows$live_current_weight,1),'% current evidence / ',round(100*(1-rows$live_current_weight),1),'% preseason prior. Expected EPM ',feed$epm_as_of,'; DARKO through ',feed$darko_through,'. Injuries affect minutes separately.')
  rows$availability_reason[!good] <- paste0(rows$availability_reason[!good],' No complete current EPM/DARKO pair; external forecast prior retained.')
  audit <- list(schema_version=2,season=feed$season,generated_at=feed$generated_at,epm_type='expected',epm_as_of=feed$epm_as_of,darko_through=feed$darko_through,epm_url=feed$epm_url,darko_url=feed$darko_url,matched_players=sum(good),total_players=nrow(rows),unmatched_players=rows$player_name[!good],skill_stats_fetched_at=evidence$generated_at,skill_updated_players=sum(rows$live_skill_components_updated>0),max_current_weight=max(rows$live_current_weight),held_skill_components=evidence$held_components,switch_status=evidence$switch_status,
    method='Actual-minute transition from the frozen preseason forecast. Up to 4,000 minutes, current season first; previous years count 75%, 56.25%, 42.19% per minute. Synthetic preseason evidence starts at 1,500 minutes and declines one-for-one with current NBA minutes; rookies fully replace this prior at 1,500 minutes. Actual historical evidence remains in the veteran weighting. SKILL incorporates available current stats using fixed historical calibration; SWITCH updates when current NBA matchups and perimeter inputs pass validation; missing components retain priors. Overall impact keeps an 80% external / 20% SKILL mix, with the external forecast moving toward expected EPM/DARKO at the same evidence weight. This transition is a conservative modeling default, not a backtested optimal weighting. Injuries and actual game results apply immediately.')
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
