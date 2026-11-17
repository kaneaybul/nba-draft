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
  role_feed <- read_rolling_minute_feed(base_dir)
  if (!is.null(role_feed)) {
    rows <- apply_rolling_minute_cell(rows,role_feed,rebalance=FALSE,require_complete=TRUE)
  }
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


read_rolling_minute_feed <- function(base_dir) {
  path <- Sys.getenv("NBA_ROLLING_ROLE_FILE")
  expected_date <- Sys.getenv("NBA_ROLLING_ROLE_AS_OF")
  if (!nzchar(path) && !nzchar(expected_date)) return(NULL)
  if (!startsWith(path, "/") || !file.exists(path) || dir.exists(path)) stop("Expected a readable absolute rolling role file")
  if (!grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", expected_date) ||
      is.na(as.Date(expected_date, format="%Y-%m-%d"))) stop("Expected the reviewed rolling role date")
  x <- jsonlite::fromJSON(path,simplifyVector=FALSE)
  if (!identical(x$asof, expected_date)) stop("Rolling role file does not match the reviewed date")
  if(!identical(x$policy,'sparse-eligible-preacute-evidence-v2-transient-roster') || !identical(x$acute_overlay_applied,FALSE)) stop('Expected pre-injury direct role input')
  if(!identical(x$model_sha256,'fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f')) stop('Unapproved model hash')
  if(!identical(x$evidence_policy,'sparse-observed-role-evidence-v2-transient-roster')) stop('Wrong evidence policy')
  if(!identical(x$allocation_applied,FALSE)) stop('Refusing already allocated role input')
  if(length(unique(vapply(x$players,function(p)p$team,character(1))))!=30L) stop('Incomplete direct role input')
  x$keys <- vapply(x$players,function(p)paste(p$team,if(is.null(p$nba_id)) paste0('name:',p$name) else paste0('id:',p$nba_id),sep='|'),character(1))
  if(anyDuplicated(x$keys)) stop('Duplicate direct role identity')
  expected_teams <- strsplit("ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS", " ")[[1]]
  if (!setequal(vapply(x$players,function(p)p$team,character(1)),expected_teams)) stop("Wrong teams in direct role input")
  x
}
apply_rolling_minute_cell <- function(rows,feed,ordinal=rep(1L,nrow(rows)),rebalance=TRUE,require_complete=FALSE) {
  ids <- rows$nba_id
  if('source_nba_id'%in%names(rows)) { ok <- is.finite(rows$source_nba_id);ids[ok] <- rows$source_nba_id[ok] }
  team <- if('team_projection_base'%in%names(rows)) rows$team_projection_base else rows$team
  keys <- paste(team,ifelse(is.finite(ids),paste0('id:',format(ids,scientific=FALSE,trim=TRUE)),paste0('name:',rows$player_name)),sep='|')
  found <- match(keys,feed$keys);roster <- !is.na(rows$pool_status)&rows$pool_status=='roster'&team!='FA'
  participant_roster <- roster
  if ('contract_pending' %in% names(rows)) roster <- roster & !rows$contract_pending
  if(any(roster&is.na(found))) stop('Missing direct role for roster player: ',paste(rows$player_name[roster&is.na(found)],collapse=', '))
  if (require_complete && (anyDuplicated(keys[roster]) || !setequal(keys[roster],feed$keys))) {
    stop("Direct role ownership differs from the healthy R roster")
  }
  for(i in which(roster)) {
    k <- as.integer(ordinal[i]); p <- feed$players[[found[i]]]
    if(!identical(p$sparse_eligible,TRUE)) next
    if (!identical(p$asof, feed$asof) || !identical(p$model_sha256, feed$model_sha256)) stop("Direct role row date or model mismatch")
    if(!is.finite(k)||k<1||k>length(p$cells)) stop('Role cell outside source horizon')
    v <- as.numeric(unlist(p$cells[[k]]))
    if(length(v)!=3||any(!is.finite(v))||v[1]<0||v[1]>1+1e-8||v[2]<0||v[2]>38+1e-8||abs(v[1]*v[2]-v[3])>1e-7) stop('Invalid direct role cell')
    rows$minutes_play_probability[i] <- v[1];rows$minutes_input_mpg[i] <- v[2];rows$minutes_expected_mpg[i] <- v[3]
  }
  if(rebalance) for(idx in split(which(participant_roster),team[participant_roster])) rows$minutes_expected_mpg[idx] <- balance_live_minutes(rows$minutes_expected_mpg[idx],38*rows$minutes_play_probability[idx])
  rows$minutes_healthy_mpg <- ifelse(rows$minutes_play_probability>0,rows$minutes_expected_mpg/rows$minutes_play_probability,0)
  rows
}

