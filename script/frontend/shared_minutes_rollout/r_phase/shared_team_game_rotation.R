# Shortest staged R bridge: final ledger role cells drive unchanged team rating formula.
# The caller must independently verify the exact quote-ready source/ledger receipt
# and options must only be set in the isolated shared-cutover driver.
make_shared_current_team_game_rotation <- function(ledger, source_schedule, asof, season, version) {
  fields <- c("nba_id","team","asof","forecast_version","game","team_game_clock","probability",
    "conditional_mpg","expected_minutes","baseline_probability","healthy_rotation","availability")
  if (!all(fields %in% names(ledger)) || !nrow(ledger) ||
      !all(ledger$asof==asof & ledger$forecast_version==version) ||
      anyDuplicated(paste(ledger$nba_id,ledger$game))) stop("Invalid exact shared ledger rows")
  if (any(!is.finite(unlist(ledger[, fields[!fields %in% c("team","asof","forecast_version")]])))) {
    stop("Nonfinite shared ledger")
  }
  if (any(ledger$probability<0 | ledger$probability>1 | ledger$baseline_probability<0 |
      ledger$baseline_probability>1 | ledger$conditional_mpg<0 | ledger$conditional_mpg>48+1e-7 |
      ledger$availability<0 | ledger$availability>1 | ledger$healthy_rotation<0 |
      ledger$healthy_rotation>48*ledger$baseline_probability+1e-7 |
      abs(ledger$probability*ledger$conditional_mpg-ledger$expected_minutes)>1e-7 |
      abs(ledger$probability-ledger$baseline_probability*ledger$availability)>1e-7)) {
    stop("Invalid shared ledger rotation arithmetic")
  }
  schedule_signature <- function(s) {
    x <- s[which(s$season==season & s$season_type=="Regular Season"),,drop=FALSE]
    if (anyNA(x$game_id) || any(!nzchar(x$game_id)) || anyDuplicated(x$game_id)) stop("Ambiguous source game IDs")
    sort(paste(x$game_id,x$date,x$home_team,x$away_team,x$selected_team,
       x$is_placeholder %in% TRUE,x$is_completed %in% TRUE,sep="|"))
  }
  expected_schedule <- schedule_signature(source_schedule)
  first_rows <- ledger[ledger$game==1,,drop=FALSE]
  by_player <- split(seq_len(nrow(ledger)),ledger$nba_id)
  partial <- new.env(parent=emptyenv())
  function(forecast,schedules,team_calendars,day,observation,season_now) {
    if (!identical(as.character(observation),asof) || season_now!=season) stop("Wrong shared team observation")
    # The exact game keys and date/ownership frame are invariant for the entire call.
    if (is.null(partial$checked)) {
      if (!identical(schedule_signature(schedules),expected_schedule)) stop("R schedule differs from approved shared calendar")
      if (any(schedules$season==season & schedules$season_type!="Regular Season" &
          !(schedules$is_completed %in% TRUE) & as.Date(schedules$date)>=observation)) {
        stop("No shared ledger exists for future postseason schedule")
      }
      ids <- forecast$nba_id
      if ("source_nba_id" %in% names(forecast)) ids <- ifelse(is.finite(forecast$source_nba_id),forecast$source_nba_id,ids)
      keep <- which(forecast$pool_status %in% c("roster","contract_pending"))
      if (length(keep)!=nrow(first_rows) || anyNA(ids[keep]) || anyDuplicated(ids[keep]) ||
          !setequal(paste(forecast$team[keep],ids[keep]),paste(first_rows$team,first_rows$nba_id))) stop("Shared team roster mismatch")
      cal <- lapply(team_calendars,function(c) {
        if(nrow(c)!=82L) stop("Incomplete absolute team calendar")
        future <- as.Date(c$date[!c$completed & as.Date(c$date)>=observation])
        if(anyDuplicated(future)) stop("Ambiguous simultaneous team games")
        sort(future)
      })
      for(i in keep) {
        id <- as.character(ids[i]); q <- by_player[[id]]; n <- length(cal[[forecast$team[i]]])
        if (length(q)<n || any(ledger$team[q]!=forecast$team[i])) stop("Wrong shared ledger team or length")
        q <- q[order(ledger$game[q])]
        g <- seq_len(length(q))
        if (!all(ledger$game[q]==g & ledger$team_game_clock[q]==82*(season-2000)+82-n+g-1)) stop("Disconnected shared team game clock")
        by_player[[id]] <<- q
      }
      partial$forecast_owner <- paste(forecast$team,ids)
      partial$ids <- ids; partial$keep <- keep; partial$cal <- cal; partial$checked <- TRUE
    }
    now_ids <- forecast$nba_id
    if ("source_nba_id" %in% names(forecast)) now_ids <- ifelse(is.finite(forecast$source_nba_id),forecast$source_nba_id,now_ids)
    if(!identical(paste(forecast$team,now_ids),partial$forecast_owner)) stop("Forecast owners changed during shared loop")
    mins <- gp <- healthy_m <- healthy_gp <- numeric(nrow(forecast))
    factors <- rep(1,nrow(forecast))
    date <- as.Date(day)
    for(i in partial$keep) {
      deadlines <- partial$cal[[forecast$team[i]]]
      n <- length(deadlines)
      if (date<observation || n==0L) next
      # For nonplaying teams only, use their next shared slot (or last if done).
      # Their ratings are needed only as peers in a Cup placeholder calculation.
      ordinal <- min(n,1L+sum(deadlines<date))
      g <- by_player[[as.character(partial$ids[i])]][ordinal]
      mins[i] <- 82*ledger$expected_minutes[g]; gp[i] <- 82*ledger$probability[g]
      healthy_m[i] <- 82*ledger$healthy_rotation[g]; healthy_gp[i] <- 82*ledger$baseline_probability[g]
      factors[i] <- ledger$availability[g]
    }
    list(final=list(minutes=mins,games=gp),healthy=list(minutes=healthy_m,games=healthy_gp),availability=factors)
  }
}
