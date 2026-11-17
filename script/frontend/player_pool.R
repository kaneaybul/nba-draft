pool_character_fields <- c('pool_status','pool_note','pool_checked_at','pool_identity_status','position_source','position_checked_at')

apply_live_positions <- function(rows, base_dir) {
  path <- file.path(base_dir,'raw/live/positions.json')
  if (!file.exists(path)) stop('Daily position feed is required')
  feed <- jsonlite::fromJSON(path, simplifyVector=FALSE)
  if (any(rows$year != feed$season)) stop('Live position season mismatch')
  for (k in c('position_source','position_checked_at')) if (!k %in% names(rows)) rows[[k]] <- NA_character_
  records <- setNames(feed$players, vapply(feed$players, function(p) as.character(p$app_nba_id), character(1)))
  cols <- c('pg_share','sg_share','sf_share','pf_share','c_share')
  for (i in seq_len(nrow(rows))) {
    p <- records[[as.character(rows$nba_id[i])]]
    if (is.null(p) || identical(p$position,'UNK')) next
    shares <- vapply(cols, function(k) as.numeric(p[[k]]), numeric(1))
    if (any(!is.finite(shares) | shares < 0) || sum(shares) <= 0) stop('Invalid daily position shares')
    shares <- shares/sum(shares)
    for (j in seq_along(cols)) rows[[cols[j]]][i] <- shares[j]
    rows$position[i] <- p$position
    rows$position_index[i] <- sum(shares*1:5)
    rows$position_entropy[i] <- -sum(shares[shares>0]*log(shares[shares>0]))/log(5)
    rows$position_source[i] <- p$source
    rows$position_checked_at[i] <- feed$generated_at
  }
  rows
}

pool_scalar <- function(x,default=NA) if(is.null(x)||length(x)==0||is.na(x[1])) default else x[1]

new_pool_player <- function(template,record,history,season,providers) {
  row <- template[1,,drop=FALSE]
  for(k in names(row)) row[[k]] <- if(is.numeric(row[[k]])) 0 else if(is.logical(row[[k]])) FALSE else NA_character_
  candidates <- history[history$nba_id %in% c(record$app_nba_id,record$nba_id),,drop=FALSE]
  if(nrow(candidates)) {
    seed <- candidates[which.max(candidates$year),,drop=FALSE]
    common <- intersect(names(seed),names(row));row[common] <- seed[common]
    for(k in c('total','offense','defense','skill_model_off','skill_model_def')) {
      projected <- if(k=='total') 'projection_y1' else paste0('projection_',k,'_y1')
      if(projected %in% names(seed) && is.finite(seed[[projected]])) row[[k]] <- seed[[projected]]
    }
    if(is.finite(seed$projection_minutes_y1)&&seed$projection_minutes_y1>0) row$Minutes <- seed$projection_minutes_y1
    row$age <- seed$age+season-seed$year;row$yoe <- seed$yoe+season-seed$year
    row$pool_note <- 'Prior career estimate restored for roster/recent-player coverage.'
  } else {
    row$total <- -2.5;row$offense <- -1.5;row$defense <- -1
    provider <- match(pool_scalar(record$nba_id),providers$nba_id)
    if(!is.na(provider)) {
      row$offense <- mean(c(providers$o_epm[provider],providers$o_dpm[provider]))
      row$defense <- mean(c(providers$d_epm[provider],providers$d_dpm[provider]))
      row$total <- row$offense+row$defense
    }
    row$skill_model_off <- row$offense;row$skill_model_def <- row$defense
    row$age <- pool_scalar(record$age,22);row$yoe <- pool_scalar(record$experience,0)
    row$position <- pool_scalar(record$position,'UNK')
    row$pool_note <- 'Limited history: expected-provider estimate when available, otherwise replacement-level fallback; conservative bench minutes.'
  }
  for(k in grep('contract',names(row),value=TRUE)) if(is.numeric(row[[k]])) row[[k]] <- NA_real_
  row$nba_id <- record$app_nba_id;row$player_name <- record$player_name;row$year <- season
  row$skill_source <- if(nrow(candidates)) 'career_projection' else 'limited_history_fallback'
  row$skill_source_year <- season-1L;row$availability_status <- 'projected'
  row$availability_reason <- row$pool_note
  if(!is.finite(row$Minutes)||row$Minutes<=0) row$Minutes <- if(identical(record$contract_status,'Two-Way')) 210 else 480
  row$games <- if(identical(record$contract_status,'Two-Way')) 35 else 60
  row$p_mpg <- row$Minutes/row$games
  if(!is.finite(row$position_index)||row$position_index<=0) {
    pos <- toupper(pool_scalar(record$position,'G'))
    shares <- if(grepl('C',pos)) c(0,0,0,0,1) else if(grepl('F',pos)) c(0,0,.5,.5,0) else c(.5,.5,0,0,0)
    row[c('pg_share','sg_share','sf_share','pf_share','c_share')] <- as.list(shares)
    row$position_index <- sum(shares*1:5);row$position_entropy <- -sum(shares[shares>0]*log(shares[shares>0]))
    row$position <- if(grepl('C',pos)) 'C' else if(grepl('F',pos)) 'SF' else 'PG'
  }
  for(h in 1:5) {
    for(k in c('total','offense','defense','skill_model_off','skill_model_def')) {
      col <- if(k=='total') paste0('projection_y',h) else paste0('projection_',k,'_y',h)
      if(!nrow(candidates)||!is.finite(row[[col]])) row[[col]] <- row[[k]]
    }
    for(k in c('minutes','games','mpg')) {
      col <- paste0('projection_',k,'_y',h)
      if(!is.finite(row[[col]])||row[[col]]<=0) row[[col]] <- row[[c(minutes='Minutes',games='games',mpg='p_mpg')[[k]]]]
    }
  }
  row
}

resolve_pool_registry_aliases <- function(players, shared) {
  # Resolve identities BEFORE signed ownership rewrites erase FA/roster evidence.
  if (is.null(shared)) return(list(players=players, suppressed_app_ids=numeric()))
  approved <- c(shared$players, shared$contract_pending)
  approved_by_id <- setNames(approved, vapply(approved, function(p) as.character(p$nba_id), character(1)))
  ids <- vapply(players, function(p) as.character(pool_scalar(p$nba_id, NA_real_)), character(1))
  keep <- rep(TRUE, length(players)); suppressed_app_ids <- numeric()
  for (id in unique(ids[!is.na(ids) & ids != 'NA'])) {
    idx <- which(ids == id)
    if (length(idx) < 2L) next
    group <- players[idx]
    active <- vapply(group, function(p) pool_scalar(p$pool_status, '') %in% c('roster','contract_pending'), logical(1))
    owner <- approved_by_id[[id]]
    # Unowned non-roster duplicates cannot be promoted by the signed loop.
    if (is.null(owner) && !any(active)) next
    aliases <- group[!active]
    valid_aliases <- vapply(aliases, function(p) identical(pool_scalar(p$team, ''), 'FA') &&
      pool_scalar(p$pool_status, '') %in% c('inactive','free_agent'), logical(1))
    if (sum(active) != 1L || is.null(owner) ||
        !identical(group[[which(active)[1]]]$team, owner$team) || !all(valid_aliases)) {
      stop('Conflicting player registry identity: ', id)
    }
    keep[idx[!active]] <- FALSE
    suppressed_app_ids <- c(suppressed_app_ids, vapply(aliases, function(p) as.numeric(p$app_nba_id), numeric(1)))
    message('Player registry: retained verified ', owner$team, ' identity ', id,
            '; suppressed ', length(aliases), ' non-roster FA alias(es)')
  }
  retained <- players[keep]
  retained_ids <- vapply(retained, function(p) as.numeric(p$app_nba_id), numeric(1))
  list(players=retained, suppressed_app_ids=setdiff(suppressed_app_ids, retained_ids))
}

apply_live_player_pool <- function(rows,history,base_dir) {
  path <- file.path(base_dir,'raw/live/player_pool.json')
  if(!file.exists(path)) stop('Daily player registry is required')
  registry <- jsonlite::fromJSON(path,simplifyVector=FALSE)
  shared_path <- file.path(base_dir,'processed/contracts/current.json')
  shared <- if(file.exists(shared_path)) jsonlite::fromJSON(shared_path,simplifyVector=FALSE) else NULL
  shared_by_id <- list()
  shared_record <- function(pid) {
    if(length(pid)!=1L || is.na(pid)) return(NULL)
    shared_by_id[[as.character(pid)]]
  }
  if(!is.null(shared)) {
    stopifnot(isTRUE(shared$complete),shared$coverage$priced_players==length(shared$players),length(shared$coverage$missing_players)==0L)
    if(shared$as_of > substr(registry$generated_at,1,10)) stop('Shared contracts are newer than the current roster capture')
    resolved <- resolve_pool_registry_aliases(registry$players, shared)
    registry$players <- resolved$players
    rows <- rows[!rows$nba_id %in% resolved$suppressed_app_ids,,drop=FALSE]
    registry$source <- paste('Dated signed-agreement ownership ledger',shared$as_of)
    shared_by_id <- setNames(shared$players,vapply(shared$players,function(p)as.character(p$nba_id),character(1)))
    seen <- character()
    for(j in seq_along(registry$players)) {
      entry <- registry$players[[j]];id <- as.character(pool_scalar(entry$nba_id,NA_real_));signed <- shared_record(id)
      if(!is.null(signed)) {
        entry$pool_status <- 'roster';entry$team <- signed$team;entry$salary <- signed$current_salary
        entry$contract_status <- signed$current_status;entry$inactive_confirmed <- FALSE
        entry$note <- paste('Dated signed-contract ownership verified',shared$as_of)
        seen <- c(seen,id)
      } else if(identical(entry$pool_status,'roster')) {
        entry$pool_status <- 'inactive';entry$team <- 'FA';entry$inactive_confirmed <- TRUE
        entry$note <- paste('No active signed agreement in complete dated ownership ledger',shared$as_of)
      }
      registry$players[[j]] <- entry
    }
    if(length(setdiff(names(shared_by_id),seen))) stop('Signed contract identity is absent from the player registry')
  }
  season <- registry$season
  stopifnot(all(rows$year==season),registry$teams_checked==30)
  for(k in pool_character_fields) if(!k %in% names(rows)) rows[[k]] <- NA_character_
  rows$pool_review_pending <- FALSE;rows$source_nba_id <- NA_real_
  providers <- jsonlite::fromJSON(file.path(base_dir,'raw/live/ratings.json'))$players
  rows$contract_cap_salary <- NA_real_
  rows$contract_source <- NA_character_
  contract_path <- file.path(base_dir,'processed/livedata/impactrefresh/contracts_2026_spotrac.csv')
  salary_column <- 'salary_y1'
  if(!file.exists(contract_path) || file.info(contract_path)$size <= 4) {
    contract_path <- file.path(base_dir,'processed/livedata/impactrefresh/contracts_2027_current.csv')
    salary_column <- 'salary_y0'
  }
  contracts <- if(file.exists(contract_path) && file.info(contract_path)$size > 4) read.csv(contract_path,check.names=FALSE) else data.frame()
  canonical_csv <- file.path(base_dir,'processed/contracts/current.csv')
  if(file.exists(canonical_csv)) {
    contracts <- read.csv(canonical_csv,check.names=FALSE);salary_column <- 'salary_y1'
  }
  for(p in registry$players) {
    if(p$pool_status=='draft') next
    if(!p$app_nba_id %in% rows$nba_id) rows <- rbind(rows,new_pool_player(rows,p,history,season,providers))
  }
  records <- setNames(registry$players,vapply(registry$players,function(p) as.character(p$app_nba_id),character(1)))
  for(i in seq_len(nrow(rows))) {
    p <- records[[as.character(rows$nba_id[i])]]
    if(is.null(p)) {
      rows$pool_status[i] <- if(isTRUE(rows$availability_status[i]=='rookie_projection')) 'draft' else 'inactive'
      next
    }
    active <- p$pool_status=='roster';team <- if(active) p$team else 'FA'
    rows$pool_status[i] <- p$pool_status
    rows$pool_note[i] <- paste(pool_scalar(p$note,''),if(isTRUE(rows$skill_source[i]=='limited_history_fallback')) rows$availability_reason[i] else '')
    rows$pool_checked_at[i] <- registry$generated_at;rows$pool_identity_status[i] <- pool_scalar(p$identity_status,if(is.null(p$nba_id)) 'provisional_id' else 'nba_id')
    rows$pool_review_pending[i] <- isTRUE(p$review_pending);rows$source_nba_id[i] <- pool_scalar(p$nba_id,NA_real_)
    for(k in c('team','current_roster_team','roster_truth_team','market_team','team_projection_base','incumbent_team')) rows[[k]][i] <- team
    rows$roster_state[i] <- if(active) 'active' else 'inactive'
    rows$roster_status_source[i] <- if(isTRUE(p$review_pending)) 'Prior roster retained pending review' else registry$source
    rows$roster_truth_pulled_at[i] <- registry$generated_at
    known_contract <- if(nrow(contracts)) match(pool_scalar(p$nba_id,rows$nba_id[i]),contracts$nba_id) else NA_integer_
    if(!active) rows$contract[i] <- NA_real_ else if(!is.na(known_contract)&&is.finite(contracts[[salary_column]][known_contract])&&contracts[[salary_column]][known_contract]>0) {
      rows$contract[i] <- contracts[[salary_column]][known_contract]
    } else if(!is.finite(rows$contract[i])&&!is.null(p$salary)&&is.finite(p$salary)&&p$salary>0) rows$contract[i] <- p$salary
    signed <- shared_record(pool_scalar(p$nba_id,NA_real_))
    if(active && !is.null(signed)) {
      rows$contract[i] <- signed$current_salary
      cell <- Filter(function(c)c$year==season,signed$cells)[[1]]
      rows$contract_cap_salary[i] <- cell$cap_amount
      rows$contract_source[i] <- signed$source
      for(h in 1:5) {
        future <- Filter(function(c)c$year==season+h,signed$cells)[[1]]
        rows[[paste0('projection_contract_y',h)]][i] <- if(is.null(future$amount)) NA_real_ else future$amount
      }
    }
    status <- pool_scalar(p$contract_status,'Signed')
    if(active && status %in% c('UFA','RFA','Rookie FA')) status <- 'Signed'
    rows$contract_status[i] <- if(active) status else 'UFA'
    rows$projection_roster_status[i] <- if(active) 'signed' else 'open_market'
  }
  rows <- rows[rows$pool_status!='draft',,drop=FALSE]
  stopifnot(!anyDuplicated(rows$nba_id))
  message('Player pool: ',paste(names(table(rows$pool_status)),table(rows$pool_status),collapse='; '))
  rows
}

zero_inactive_pool_minutes <- function(rows) {
  if(!'pool_status' %in% names(rows)) return(rows)
  inactive <- !is.na(rows$pool_status)&rows$pool_status=='inactive'
  for(k in intersect(c('Minutes','games','p_mpg',grep('^projection_(minutes|games|mpg)_y',names(rows),value=TRUE)),names(rows))) rows[[k]][inactive] <- 0
  rows
}

season_pool_scores <- function(rows,base_dir) {
  path <- file.path(base_dir,'frontend/public/data/archive/2027-preseason/impact_players.json')
  preseason <- jsonlite::fromJSON(path)
  percentile <- function(values,ref) {
    ref <- sort(ref[is.finite(ref)])
    if (!length(ref)) stop('Current-season Score needs a finite roster reference')
    knots <- unique(ref)
    if (length(knots)==1L) return(ifelse(values<knots,0,ifelse(values>knots,1,.5)))
    ranks <- (rank(ref,ties.method='average')-1)/(length(ref)-1)
    approx(knots,ranks[match(knots,ref)],xout=values,rule=2,ties='ordered')$y
  }
  eligible <- is.finite(rows$total) & is.finite(rows$timin)
  if ('pool_status' %in% names(rows)) {
    eligible <- eligible & !is.na(rows$pool_status) & rows$pool_status=='roster'
  } else {
    eligible <- eligible & !is.na(rows$team_projection_base) & rows$team_projection_base!='FA'
  }
  current <- rep(NA_real_,nrow(rows))
  for (idx in split(seq_len(nrow(rows)),rows$year)) {
    reference <- rows[idx[eligible[idx]],,drop=FALSE]
    current[idx] <- 100*(.65*percentile(rows$total[idx],reference$total)+
      .35*percentile(rows$timin[idx],reference$timin))
  }
  # Each season uses its own roster distribution. The immutable archive is
  # used only for comparison, never to anchor the current Score scale.
  rows$score <- round(pmax(0,pmin(100,current)),1)
  idx <- match(paste(rows$nba_id,rows$year),paste(preseason$nba_id,preseason$year))
  rows$score_delta <- round(rows$score-preseason$score[idx],1)
  rows$score_label <- format(rows$score,trim=TRUE,nsmall=1)
  rows$tier <- unlist(ave(rows$score,rows$year,FUN=tier_from_score))
  if('trade_value' %in% names(rows) && 'value' %in% names(rows)) rows$trade_value <- round(rows$value*(.45+rows$score/170),0)
  rows
}



