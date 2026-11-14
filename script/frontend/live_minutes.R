# Predict coaching usage independently of our impact/optimal-lineup ranking.
live_minute_numeric_fields <- c('minutes_input_mpg','minutes_healthy_mpg','minutes_expected_mpg',
  'minutes_play_probability','minutes_epm_mpg','minutes_darko_mpg','minutes_actual',
  'minutes_actual_games','minutes_actual_mpg','minutes_remaining','minutes_remaining_games',
  'minutes_remaining_mpg','minutes_remaining_team_games','minutes_team_budget',
  'minutes_gp_prior','minutes_mpg_prior','minutes_mpg_current_weight','minutes_mpg_prior_captured')
live_minute_character_fields <- c('minutes_source','minutes_note','minutes_checked_at')

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
  policy <- jsonlite::fromJSON(file.path(base_dir,'script/frontend/role_minutes_policy.json'))
  prior_appearances <- policy$prior_appearances
  baseline_cap <- policy$maximum_baseline_mpg
  feed <- jsonlite::fromJSON(file.path(base_dir,'raw/live/ratings.json'))
  stats_feed <- jsonlite::fromJSON(file.path(base_dir,'raw/live/skill_stats.json'))
  stats <- stats_feed$players
  # Capture the untouched career-model MPG before providers or team balancing.
  # Persist it on repeat calls; never blend yesterday's blend into itself.
  mpg_prior <- if('minutes_mpg_prior' %in% names(rows)) rows$minutes_mpg_prior else rep(NA_real_,nrow(rows))
  captured <- if('minutes_mpg_prior_captured' %in% names(rows)) rows$minutes_mpg_prior_captured else rep(0,nrow(rows))
  missing_prior <- !is.finite(captured) | captured!=1
  mpg_prior[missing_prior] <- rows$p_mpg[missing_prior]
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
  rows$minutes_input_mpg <- pmax(0,pmin(baseline_cap,fallback))
  rows$minutes_source <- 'Career MPG model'
  observed <- rows$minutes_actual_games>=2 & is.finite(rows$minutes_actual_mpg)
  rows$minutes_input_mpg[observed] <- pmin(baseline_cap,rows$minutes_actual_mpg[observed]);rows$minutes_source[observed] <- 'Actual MPG fallback'
  darko <- valid(rows$minutes_darko_mpg)
  rows$minutes_input_mpg[darko] <- pmin(baseline_cap,rows$minutes_darko_mpg[darko]);rows$minutes_source[darko] <- 'DARKO'
  epm <- valid(rows$minutes_epm_mpg)
  rows$minutes_input_mpg[epm] <- pmin(baseline_cap,rows$minutes_epm_mpg[epm]);rows$minutes_source[epm] <- 'Expected EPM'
  # The ten-appearance prior was selected on 2024-25 and tested on 2025-26
  # remaining-season conditional MPG. Rookies/unknown model priors retain
  # the provider hierarchy: the backtest did not cover them.
  experience <- if('yoe' %in% names(rows)) rows$yoe else rep(NA_real_,nrow(rows))
  blend <- is.finite(experience) & experience>=1 & valid(mpg_prior)
  rows$minutes_mpg_prior <- mpg_prior
  rows$minutes_mpg_prior_captured <- 1
  n <- pmax(0,rows$minutes_actual_games)
  n[!is.finite(n) | !is.finite(rows$minutes_actual_mpg)] <- 0
  weight <- n/(prior_appearances+n)
  rows$minutes_mpg_current_weight <- ifelse(blend,weight,0)
  actual_mpg <- ifelse(n>0,rows$minutes_actual_mpg,0)
  rows$minutes_input_mpg[blend] <- pmin(baseline_cap,pmax(0,
    (1-weight[blend])*mpg_prior[blend]+weight[blend]*actual_mpg[blend]))
  rows$minutes_source[blend] <- 'Career MPG + season MPG (10-game prior)'
  roster <- rows$pool_status=='roster' & !is.na(rows$pool_status)
  rows$minutes_gp_prior <- gp_prior
  # The trained full-season GP forecast supplies a stable participation rate.
  # Actual appearances are retained separately; the dated injury plan adjusts
  # only future games in apply_injury_projections().
  probability <- gp_prior/82
  rows$minutes_play_probability <- ifelse(roster & rows$minutes_input_mpg>0,probability,0)
  rows$minutes_expected_mpg <- rows$minutes_input_mpg*rows$minutes_play_probability
  for(idx in split(which(roster),rows$team_projection_base[roster])) {
    rows$minutes_expected_mpg[idx] <- balance_live_minutes(rows$minutes_expected_mpg[idx],baseline_cap*rows$minutes_play_probability[idx])
  }
  rows$minutes_healthy_mpg <- ifelse(rows$minutes_play_probability>0,rows$minutes_expected_mpg/rows$minutes_play_probability,0)
  rows$lineup_original_minutes <- rows$Minutes
  rows$Minutes <- rows$minutes_expected_mpg*82
  rows$games <- rows$minutes_play_probability*82
  rows$p_mpg <- round(rows$minutes_healthy_mpg,1)
  rows$lineup_adjusted_minutes <- rows$Minutes
  rows$lineup_role <- NA_character_;rows$lineup_role_order <- NA_integer_;rows$lineup_role_band_minutes <- NA_real_
  rows$minutes_checked_at <- feed$generated_at
  rows$minutes_note <- paste0(rows$minutes_source, ' baseline; trained GP participation rate applied to injury-adjusted remaining games; actual appearances retained; team minutes reconciled without impact-based role assignment. Injuries applied once by date.')
  rows$minutes_note[blend] <- paste0(rows$minutes_note[blend], ' Model MPG prior: ',
    round(mpg_prior[blend],2), '; observed MPG weight: ',round(100*weight[blend],1),
    '%. Remaining-season role blend; future career model retained.')
  changed <- observed & abs(rows$minutes_actual_mpg-rows$minutes_input_mpg)>=6 & rows$minutes_actual_games>=3
  rows$minutes_note[changed] <- paste0(rows$minutes_note[changed], ' Observed MPG differs by at least six minutes; review recent role/context.')
  rows$minutes_note[!roster] <- 'No current NBA roster spot: actual minutes retained, no future team minutes assigned.'
  message('Live minutes: ',paste(names(table(rows$minutes_source[roster])),table(rows$minutes_source[roster]),collapse='; '),
    '; trained GP participation rate; dated injuries applied to remaining games')
  rows
}
