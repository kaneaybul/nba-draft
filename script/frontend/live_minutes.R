# Predict coaching usage independently of our impact/optimal-lineup ranking.
live_minute_numeric_fields <- c('minutes_input_mpg','minutes_healthy_mpg','minutes_expected_mpg',
  'minutes_play_probability','minutes_epm_mpg','minutes_darko_mpg','minutes_actual',
  'minutes_actual_games','minutes_actual_mpg','minutes_remaining','minutes_remaining_games',
  'minutes_remaining_mpg','minutes_remaining_team_games','minutes_team_budget',
  'minutes_gp_prior','minutes_gp_prior_weight','minutes_team_games_played')
live_minute_character_fields <- c('minutes_source','minutes_note','minutes_checked_at')

# Match attendance to the same completed-game snapshot as the player statistics.
# If a source lags, retain the GP prior rather than treating missing data as DNPs.
live_gp_team_games <- function(base_dir, stats_feed, season) {
  path <- file.path(base_dir,'raw/live/results.json')
  if(!file.exists(path)) return(NULL)
  results <- jsonlite::fromJSON(path)
  if(!identical(as.integer(results$season),as.integer(season)) ||
     !identical(as.integer(stats_feed$season),as.integer(season))) return(NULL)
  games <- results$games
  completed <- if(is.data.frame(games)) games[games$is_completed %in% TRUE,,drop=FALSE] else data.frame()
  coverage <- suppressWarnings(as.numeric(stats_feed$completed_games_at_fetch))
  if(length(coverage)!=1L || !is.finite(coverage) || coverage!=nrow(completed)) return(NULL)
  if(!nrow(completed)) return(setNames(numeric(),character()))
  if(!all(c('game_id','home_team','away_team') %in% names(completed)) ||
     anyDuplicated(completed$game_id)) return(NULL)
  table(c(as.character(completed$home_team),as.character(completed$away_team)))
}

balance_live_minutes <- function(desired, capacity, target=240, weights=NULL) {
  desired[!is.finite(desired)|desired<0] <- 0
  capacity[!is.finite(capacity)|capacity<0] <- 0
  out <- pmin(desired,capacity)
  target <- min(target,sum(capacity))
  if(sum(out)>target) return(out*target/sum(out))
  if(is.null(weights)) weights <- pmax(desired, .1)
  for(i in seq_len(length(out)+1L)) {
    gap <- target-sum(out); headroom <- pmax(0,capacity-out)
    if(gap<1e-8||sum(headroom)<1e-8) break
    weight <- headroom*pmax(weights,.001)
    out <- out+pmin(headroom,gap*weight/sum(weight))
  }
  out
}

allocate_live_rotation <- function(players,availability=rep(1,nrow(players))) {
  probability <- players$minutes_play_probability*pmax(0,pmin(1,availability))
  baseline <- pmax(0,players$minutes_expected_mpg)
  desired <- baseline*pmax(0,pmin(1,availability))
  result <- desired
  shares <- injury_position_shares(players)
  groups <- split(seq_len(nrow(players)),players$team)
  for(idx in groups) {
    if(players$team[idx[1]]=='FA') {result[idx] <- 0;next}
    vacancy <- colSums(shares[idx,,drop=FALSE]*(baseline[idx]-desired[idx]))
    fit <- .15+as.numeric(shares[idx,,drop=FALSE]%*%vacancy)/max(1,sum(vacancy))
    soft_cap <- probability[idx]*pmin(48,players$minutes_healthy_mpg[idx]+6)
    weights <- fit*sqrt(pmax(.1,baseline[idx]))
    result[idx] <- balance_live_minutes(desired[idx],soft_cap,240,weights)
    # Severe absences can require a larger role change, within 48 minutes when playing.
    if(sum(result[idx])<240-1e-7) result[idx] <- balance_live_minutes(result[idx],48*probability[idx],240,weights)
  }
  list(minutes=result*82,games=probability*82)
}

apply_live_minute_inputs <- function(rows,base_dir) {
  feed <- jsonlite::fromJSON(file.path(base_dir,'raw/live/ratings.json'))
  stats_feed <- jsonlite::fromJSON(file.path(base_dir,'raw/live/skill_stats.json'))
  stats <- stats_feed$players
  # Preserve the unadjusted model forecast even if the function is called again.
  gp_prior <- if('minutes_gp_prior' %in% names(rows)) rows$minutes_gp_prior else rep(NA_real_,nrow(rows))
  gp_prior[!is.finite(gp_prior)] <- rows$games[!is.finite(gp_prior)]
  gp_prior[!is.finite(gp_prior)] <- 60
  gp_prior <- pmax(0,pmin(82,gp_prior))
  ids <- rows$nba_id
  if('source_nba_id' %in% names(rows)) {known <- is.finite(rows$source_nba_id);ids[known] <- rows$source_nba_id[known]}
  src <- match(ids,feed$players$nba_id);actual <- match(ids,stats$nba_id)
  for(k in live_minute_numeric_fields) rows[[k]] <- 0
  for(k in live_minute_character_fields) rows[[k]] <- NA_character_
  rows$minutes_epm_mpg <- feed$players$epm_mpg[src]
  rows$minutes_darko_mpg <- feed$players$darko_mpg[src]
  rows$minutes_actual <- ifelse(is.na(actual),0,stats$minutes[actual])
  rows$minutes_actual_games <- ifelse(is.na(actual),0,stats$games[actual])
  rows$minutes_actual_mpg <- ifelse(rows$minutes_actual_games>0,rows$minutes_actual/rows$minutes_actual_games,NA_real_)
  valid <- function(x) is.finite(x)&x>=0&x<=48
  fallback <- ifelse(valid(rows$p_mpg),rows$p_mpg,ifelse(rows$games>0,rows$Minutes/rows$games,0))
  rows$minutes_input_mpg <- pmax(0,pmin(48,fallback))
  rows$minutes_source <- 'Career MPG model'
  observed <- rows$minutes_actual_games>=2 & is.finite(rows$minutes_actual_mpg)
  rows$minutes_input_mpg[observed] <- pmin(48,rows$minutes_actual_mpg[observed]);rows$minutes_source[observed] <- 'Actual MPG fallback'
  darko <- valid(rows$minutes_darko_mpg)
  rows$minutes_input_mpg[darko] <- rows$minutes_darko_mpg[darko];rows$minutes_source[darko] <- 'DARKO'
  epm <- valid(rows$minutes_epm_mpg)
  rows$minutes_input_mpg[epm] <- rows$minutes_epm_mpg[epm];rows$minutes_source[epm] <- 'Expected EPM'
  roster <- rows$pool_status=='roster' & !is.na(rows$pool_status)
  rows$minutes_gp_prior <- gp_prior
  rows$minutes_gp_prior_weight <- 20
  rows$minutes_team_games_played <- NA_real_
  probability <- gp_prior/82
  season <- unique(rows$year)
  team_games <- if(length(season)==1L) live_gp_team_games(base_dir,stats_feed,season) else NULL
  if(!is.null(team_games)) {
    n <- as.numeric(team_games[match(rows$team_projection_base,names(team_games))])
    n[is.na(n)] <- 0
    # Season-total appearances cannot be attributed to a new team after a trade.
    same_team <- is.na(actual) | as.character(stats$team[actual])==as.character(rows$team_projection_base)
    comparable <- roster & same_team & is.finite(n) & n>=rows$minutes_actual_games
    comparable[is.na(comparable)] <- FALSE
    rows$minutes_team_games_played[comparable] <- n[comparable]
    probability[comparable] <- (20*probability[comparable]+rows$minutes_actual_games[comparable])/(20+n[comparable])
  }
  rows$minutes_play_probability <- ifelse(roster & rows$minutes_input_mpg>0,probability,0)
  rows$minutes_expected_mpg <- rows$minutes_input_mpg*rows$minutes_play_probability
  for(idx in split(which(roster),rows$team_projection_base[roster])) {
    rows$minutes_expected_mpg[idx] <- balance_live_minutes(rows$minutes_expected_mpg[idx],48*rows$minutes_play_probability[idx])
  }
  rows$minutes_healthy_mpg <- ifelse(rows$minutes_play_probability>0,rows$minutes_expected_mpg/rows$minutes_play_probability,0)
  rows$lineup_original_minutes <- rows$Minutes
  rows$Minutes <- rows$minutes_expected_mpg*82
  rows$games <- rows$minutes_play_probability*82
  rows$p_mpg <- round(rows$minutes_healthy_mpg,1)
  rows$lineup_adjusted_minutes <- rows$Minutes
  rows$lineup_role <- NA_character_;rows$lineup_role_order <- NA_integer_;rows$lineup_role_band_minutes <- NA_real_
  rows$minutes_checked_at <- feed$generated_at
  rows$minutes_note <- paste0(rows$minutes_source, ' baseline; GP model updated with current attendance using a 20-game prior; team minutes reconciled without impact-based role assignment. Injuries applied once by date.')
  skipped <- roster & !is.finite(rows$minutes_team_games_played)
  rows$minutes_note[skipped] <- paste0(rows$minutes_note[skipped], ' Attendance update skipped: comparable player/team game counts unavailable; original GP prior retained.')
  changed <- observed & abs(rows$minutes_actual_mpg-rows$minutes_input_mpg)>=6 & rows$minutes_actual_games>=3
  rows$minutes_note[changed] <- paste0(rows$minutes_note[changed], ' Observed MPG differs by at least six minutes; review recent role/context.')
  rows$minutes_note[!roster] <- 'No current NBA roster spot: actual minutes retained, no future team minutes assigned.'
  message('Live minutes: ',paste(names(table(rows$minutes_source[roster])),table(rows$minutes_source[roster]),collapse='; '),
    '; attendance updated ',sum(roster & is.finite(rows$minutes_team_games_played)),'/',sum(roster))
  rows
}

