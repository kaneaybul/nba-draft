# Current injuries change playing time, not a player's per-minute skill estimate.
# Every rebuild starts from the unadjusted model output. The same dated rotations
# feed both the season minute totals and individual game probabilities.
injury_name_key <- function(value) {
  value <- iconv(as.character(value), to = "ASCII//TRANSLIT")
  value <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", tolower(value), perl = TRUE)
  gsub("[^a-z0-9]", "", value)
}

injury_date <- function(value) {
  if (is.null(value) || !length(value) || is.na(value[[1]]) || !nzchar(value[[1]])) return(as.Date(NA))
  as.Date(substr(as.character(value[[1]]), 1, 10))
}

read_injury_projection_outlook <- function(base_dir) {
  path <- file.path(base_dir, "frontend", "public", "data", "injury_outlook.json")
  if (!file.exists(path)) stop("Refresh the injury outlook before exporting projections: ", path)
  outlook <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  if (is.null(outlook$season) || is.null(outlook$players) || outlook$teams_checked != 30L) {
    stop("Incomplete injury outlook; projections were not published.")
  }
  outlook
}

injury_projection_calendar <- function(schedules, season) {
  rows <- schedules[schedules$season == season & schedules$season_type == "Regular Season", , drop = FALSE]
  if (!nrow(rows)) stop("No regular-season schedule for injury-adjusted projections: ", season)
  placeholder <- if ("is_placeholder" %in% names(rows)) rows$is_placeholder %in% TRUE else rep(FALSE, nrow(rows))
  actual <- rows[!placeholder, , drop = FALSE]
  calendar <- rbind(
    data.frame(team = actual$home_team, date = actual$date, completed = actual$is_completed %in% TRUE),
    data.frame(team = actual$away_team, date = actual$date, completed = actual$is_completed %in% TRUE)
  )
  if (any(placeholder)) {
    cup <- rows[placeholder, , drop = FALSE]
    calendar <- rbind(calendar, data.frame(team = cup$selected_team, date = cup$date, completed = FALSE))
  }
  calendar <- calendar[order(calendar$date, calendar$team), , drop = FALSE]
  if (any(is.na(injury_date(calendar$date[1])))) stop("Invalid injury projection calendar.")
  calendar
}

injury_projection_plan <- function(row, as_of, calendar) {
  # Unknown return dates stay unknown in the source artifact. These are explicit
  # probability assumptions for the forecast, never newly reported return dates.
  future <- calendar[!calendar$completed & as.Date(calendar$date) >= as_of, , drop = FALSE]
  future <- future[order(future$date), , drop = FALSE]
  minimum <- if (is.null(row$games_missed_min)) 0L else as.integer(row$games_missed_min)
  if (!is.finite(minimum)) minimum <- 0L
  minimum <- max(0L, min(nrow(future), minimum))
  through <- if (minimum > 0L) as.Date(future$date[minimum]) else as.Date(NA)
  plan <- list(kind = "none", start = as_of, end = as_of, half_life = 0,
    minimum_through = through, status = row$status, basis = row$basis,
    note = "", source_url = row$source_url)
  if (isTRUE(row$season_ending)) {
    plan$kind <- "season_ending"
    plan$note <- "Reported season-ending absence: no remaining minutes."
    return(plan)
  }
  earliest <- injury_date(row$return_earliest)
  latest <- injury_date(row$return_latest)
  expected <- injury_date(row$return_expected)
  review <- injury_date(row$reevaluation_date)
  provider <- injury_date(row$provider_return_date)
  reported <- row$basis %in% c("reported_window", "reported_duration", "reported_games")
  if (reported && !is.na(latest) && latest >= as_of && !is.na(earliest)) {
    plan$kind <- "window"
    plan$start <- max(as_of, earliest)
    plan$end <- max(plan$start, latest)
    plan$note <- "Availability increases across the reported return window."
  } else if (reported && !is.na(expected) && expected >= as_of) {
    plan$kind <- "window"
    plan$start <- expected
    plan$end <- expected
    plan$note <- "Reported return estimate used for projected availability."
  } else if (row$basis == "provider_estimate" && !is.na(provider) && provider >= as_of) {
    # A provider estimate is not confirmed clearance: retain uncertainty around it.
    spread <- if (identical(row$status, "Out")) 7 else 3
    plan$kind <- "window"
    plan$start <- max(as_of, provider - spread)
    plan$end <- provider + spread
    plan$note <- paste0("Low-confidence ESPN estimate; model uses a +/-", spread, " day availability window.")
  } else {
    plan$kind <- "uncertain"
    plan$start <- as_of
    plan$half_life <- if (identical(row$status, "Out")) 28 else 7
    if (row$basis == "reevaluation" && !is.na(review)) {
      plan$start <- max(as_of, review)
      plan$half_life <- 14
      plan$note <- "No clearance at re-evaluation; model assumes 50% availability 14 days after review, with an open-ended tail."
    } else if (!is.na(earliest) && earliest >= as_of) {
      plan$start <- earliest
      plan$half_life <- 14
      plan$note <- "Reported minimum respected; model assumes 50% availability 14 days later, with an open-ended tail."
    } else {
      plan$note <- paste0("Return unknown; model assumes 50% availability after ", plan$half_life,
        " days, with an open-ended tail. This is a planning assumption.")
    }
  }
  if (minimum > 0L) plan$note <- paste0(plan$note, " At least ", minimum, " remaining scheduled games excluded.")
  plan
}

injury_availability_on_date <- function(plan, date) {
  if (is.null(plan)) return(1)
  date <- as.Date(date)
  if (plan$kind == "season_ending") return(0)
  if (!is.na(plan$minimum_through) && date <= plan$minimum_through) return(0)
  if (plan$kind == "window") {
    width <- as.numeric(plan$end - plan$start)
    if (width == 0) return(as.numeric(date >= plan$end))
    return(max(0, min(1, as.numeric(date - plan$start) / width)))
  }
  if (plan$kind == "uncertain") {
    elapsed <- max(0, as.numeric(date - plan$start))
    return(1 - exp(-log(2) * elapsed / plan$half_life))
  }
  1
}

injury_position_shares <- function(players) {
  cols <- c("pg_share", "sg_share", "sf_share", "pf_share", "c_share")
  if (all(cols %in% names(players))) {
    shares <- as.matrix(players[, cols, drop = FALSE])
    storage.mode(shares) <- "double"
    shares[!is.finite(shares) | shares < 0] <- 0
  } else {
    shares <- t(vapply(as.character(players$position), function(position) {
      positions <- strsplit(toupper(position), "[/,-]")[[1]]
      as.numeric(c("PG", "SG", "SF", "PF", "C") %in% positions)
    }, numeric(5)))
  }
  empty <- rowSums(shares) == 0
  shares[empty, ] <- 1
  shares / rowSums(shares)
}

allocate_injury_rotation <- function(players, availability) {
  minutes <- pmax(0, as.numeric(players$Minutes))
  minutes[!is.finite(minutes)] <- 0
  games <- pmax(0, pmin(82, as.numeric(players$games)))
  games[!is.finite(games)] <- 0
  mpg <- ifelse(games > 0, minutes / games, 0)
  availability <- pmax(0, pmin(1, availability))
  adjusted <- pmin(minutes, games * 36) * availability
  # Replacement opportunity can increase a player's usual workload by at most
  # six minutes per expected appearance, with the model's existing 36-MPG cap.
  capacity <- games * availability * pmin(36, mpg + 6)
  groups <- split(seq_len(nrow(players)), players$team)
  shares <- injury_position_shares(players)
  for (indices in groups) {
    if (players$team[indices[1]] == "FA") next
    target <- min(19680, sum(minutes[indices]))
    if (sum(adjusted[indices]) > target) {
      adjusted[indices] <- adjusted[indices] * target / sum(adjusted[indices])
    }
    missing <- sum(minutes[indices] - adjusted[indices])
    if (missing < 1e-8) next
    vacancy <- colSums(shares[indices, , drop = FALSE] * (minutes[indices] - adjusted[indices]))
    fit <- as.numeric(shares[indices, , drop = FALSE] %*% vacancy) / max(1, sum(vacancy))
    fit <- 0.15 + fit # Some cross-position rotation changes remain possible.
    for (iteration in seq_len(length(indices) + 1L)) {
      remaining <- max(0, target - sum(adjusted[indices]))
      headroom <- pmax(0, capacity[indices] - adjusted[indices])
      if (remaining < 1e-8 || sum(headroom) < 1e-8) break
      weights <- headroom * fit * sqrt(pmax(1, minutes[indices]))
      increment <- pmin(headroom, remaining * weights / sum(weights))
      adjusted[indices] <- adjusted[indices] + increment
    }
  }
  list(minutes = adjusted, games = games * availability)
}

apply_injury_projections <- function(players, schedules, outlook) {
  if ("injury_base_minutes" %in% names(players) && any(is.finite(players$injury_base_minutes))) {
    stop("Injury adjustment requires original model output; refusing to compound an existing adjustment.")
  }
  projected <- if ("availability_status" %in% names(players)) {
    players$availability_status %in% c("projected", "rookie_projection")
  } else rep(FALSE, nrow(players))
  indices <- which(players$year == outlook$season & projected)
  if (!length(indices)) return(list(players = players, schedules = schedules))
  forecast <- assign_team_projection_scenario(players[indices, , drop = FALSE], "base")
  as_of_time <- as.POSIXct(outlook$generated_at, format = "%Y-%m-%dT%H:%M:%OS", tz = "UTC")
  as_of <- as.Date(format(as_of_time, "%Y-%m-%d", tz = "America/New_York"))
  if (is.na(as_of)) stop("Invalid injury snapshot date.")
  calendar <- injury_projection_calendar(schedules, outlook$season)
  team_calendars <- split(calendar, calendar$team)
  missing_teams <- setdiff(unique(forecast$team[forecast$team != "FA"]), names(team_calendars))
  if (length(missing_teams)) stop("Injury projection schedule missing: ", paste(missing_teams, collapse = ", "))
  source_keys <- vapply(outlook$players, function(row) paste(row$team, row$name_key, sep = "||"), character(1))
  if (anyDuplicated(source_keys)) stop("Ambiguous injury identities; projections were not published.")
  matches <- match(paste(forecast$team, injury_name_key(forecast$player_name), sep = "||"), source_keys)
  plans <- lapply(seq_len(nrow(forecast)), function(i) {
    if (is.na(matches[i])) return(NULL)
    injury_projection_plan(outlook$players[[matches[i]]], as_of, team_calendars[[forecast$team[i]]])
  })
  # Columns document the immediate pre-injury forecast, including replacement
  # minutes awarded to healthy teammates. Historical actuals never enter here.
  numeric_cols <- c("injury_base_minutes", "injury_base_games", "injury_availability", "injury_games_missed",
    "injury_minutes_lost", "injury_minutes_delta")
  for (col in numeric_cols) players[[col]] <- NA_real_
  players$injury_projection_note <- NA_character_
  players$injury_projection_basis <- NA_character_
  players$injury_projection_as_of <- NA_character_
  players$injury_source_url <- NA_character_
  players$injury_base_minutes[indices] <- forecast$Minutes
  players$injury_base_games[indices] <- forecast$games
  count <- vapply(forecast$team, function(team) {
    if (team == "FA") 0L else nrow(team_calendars[[team]])
  }, integer(1))
  total_minutes <- total_games <- total_availability <- missed <- rep(0, nrow(forecast))
  target_schedule <- schedules$season == outlook$season
  future_schedule <- target_schedule & !(schedules$is_completed %in% TRUE) & as.Date(schedules$date) >= as_of
  schedules$injury_adjusted <- FALSE
  schedules$home_win_probability_before_injuries <- NA_real_
  schedules$away_win_probability_before_injuries <- NA_real_
  schedules$home_projected_rating <- NA_real_
  schedules$away_projected_rating <- NA_real_
  schedules$injury_projection_as_of <- NA_character_
  # Cached player baselines can sum above the team cap. Completed-game
  # exposure uses the same healthy budget reconciliation as future rotations,
  # so mixing completed and remaining games cannot reintroduce that excess.
  baseline_rotation <- allocate_injury_rotation(forecast, rep(1, nrow(forecast)))
  dates <- sort(unique(c(calendar$date, schedules$date[future_schedule])))
  for (date in dates) {
    factors <- vapply(plans, injury_availability_on_date, numeric(1), date = date)
    rotation <- allocate_injury_rotation(forecast, factors)
    today <- calendar[calendar$date == date, , drop = FALSE]
    for (team in unique(today$team)) {
      selected <- which(forecast$team == team)
      completed <- today$completed[today$team == team]
      past <- sum(completed | as.Date(date) < as_of)
      future <- length(completed) - past
      total_minutes[selected] <- total_minutes[selected] + baseline_rotation$minutes[selected] * past + rotation$minutes[selected] * future
      total_games[selected] <- total_games[selected] + forecast$games[selected] * past + rotation$games[selected] * future
      total_availability[selected] <- total_availability[selected] + past + factors[selected] * future
      missed[selected] <- missed[selected] + (1 - factors[selected]) * future
    }
    game_indices <- which(future_schedule & schedules$date == date)
    if (!length(game_indices)) next
    dated_players <- forecast
    dated_players$Minutes <- rotation$minutes
    dated_players$games <- rotation$games
    dated_players$lineup_adjusted_minutes <- rotation$minutes
    ratings <- build_team_projections_for_scenario(dated_players, "base", "Current roster + projected offseason")
    rating <- setNames(ratings$adjusted_total, ratings$team)
    conference <- setNames(ratings$conference, ratings$team)
    for (g in game_indices) {
      home <- schedules$home_team[g]
      away <- schedules$away_team[g]
      if ("is_placeholder" %in% names(schedules) && isTRUE(schedules$is_placeholder[g])) {
        team <- schedules$selected_team[g]
        opponents <- names(rating)[conference == conference[team] & names(rating) != team]
        probability <- mean(1 / (1 + exp(-(rating[team] - rating[opponents]) / 6.6)))
        home_rating <- rating[team]
        away_rating <- mean(rating[opponents])
        away_probability <- probability # Both cells represent the selected TBD team's chance.
      } else {
        home_rating <- rating[home]
        away_rating <- rating[away]
        probability <- 1 / (1 + exp(-(home_rating - away_rating) / 6.6))
        away_probability <- 1 - round(probability, 3)
      }
      if (!is.finite(probability)) stop("Missing dated team rating: ", date, " ", home, " vs ", away)
      schedules$home_win_probability_before_injuries[g] <- schedules$home_win_probability[g]
      schedules$away_win_probability_before_injuries[g] <- schedules$away_win_probability[g]
      schedules$home_win_probability[g] <- round(probability, 3)
      schedules$away_win_probability[g] <- round(away_probability, 3)
      schedules$home_projected_rating[g] <- unname(home_rating)
      schedules$away_projected_rating[g] <- unname(away_rating)
      schedules$injury_adjusted[g] <- TRUE
      schedules$injury_projection_as_of[g] <- outlook$generated_at
    }
  }
  active <- count > 0L
  adjusted_minutes <- forecast$Minutes
  adjusted_games <- forecast$games
  availability <- rep(1, nrow(forecast))
  adjusted_minutes[active] <- total_minutes[active] / count[active]
  adjusted_games[active] <- round(total_games[active] / count[active], 3)
  availability[active] <- total_availability[active] / count[active]
  adjusted_minutes <- floor(pmin(adjusted_minutes, adjusted_games * 36) * 10 + 1e-7) / 10
  players$Minutes[indices] <- adjusted_minutes
  players$games[indices] <- adjusted_games
  players$p_mpg[indices] <- ifelse(adjusted_games > 0, round(adjusted_minutes / adjusted_games, 1), 0)
  players$lineup_adjusted_minutes[indices] <- adjusted_minutes
  if ("lineup_minutes_delta" %in% names(players)) {
    players$lineup_minutes_delta[indices] <- adjusted_minutes - players$lineup_original_minutes[indices]
  }
  # Keep volume-derived tIMIN and the season value consistent, while leaving
  # per-minute ratings and later-season career projections intact.
  ratio <- ifelse(forecast$Minutes > 0, adjusted_minutes / forecast$Minutes, 0)
  for (col in intersect(c("timin", "season_value", "value"), names(players))) {
    players[[col]][indices] <- round(players[[col]][indices] * ratio, if (col == "timin") 1 else 0)
  }
  if (all(c("value_add", "season_value", "contract") %in% names(players))) {
    players$value_add[indices] <- players$season_value[indices] - players$contract[indices]
  }
  # Current dollar value and Scale must follow the same injury-adjusted volume.
  if ('raw_minutes' %in% names(players)) players$raw_minutes[indices] <- adjusted_minutes
  if ('raw_timin' %in% names(players)) players$raw_timin[indices] <- players$timin[indices]
  if ('trade_value' %in% names(players)) players$trade_value[indices] <- round(players$value[indices] * (.45 + players$score[indices]/170),0)
  if ('scalability' %in% names(players)) {
    new_capacity <- pmin(ifelse(adjusted_minutes>0,19680/adjusted_minutes,15),15)
    cap <- cap_for_year(load_cap_assumptions(resolve_base_dir()),outlook$season,'scale_cap')
    contract_capacity <- ifelse(is.finite(players$contract[indices]) & players$contract[indices]>0,pmin(cap/players$contract[indices],15),15)
    players$scalability[indices] <- round(pmax(0,pmin(new_capacity,contract_capacity)*players$value[indices]/cap),3)
  }
  players$injury_availability[indices] <- round(availability, 5)
  players$injury_games_missed[indices] <- round(missed, 2)
  players$injury_minutes_lost[indices] <- round(forecast$Minutes * (1 - availability), 1)
  players$injury_minutes_delta[indices] <- round(adjusted_minutes - forecast$Minutes, 1)
  players$injury_projection_as_of[indices] <- outlook$generated_at
  for (i in seq_along(plans)) {
    plan <- plans[[i]]
    if (is.null(plan)) next
    players$injury_projection_note[indices[i]] <- plan$note
    players$injury_projection_basis[indices[i]] <- plan$basis
    players$injury_source_url[indices[i]] <- plan$source_url
  }
  # The previous season's career arc points at this same forecast. Actual
  # Minutes/games from that historical row, and horizons beyond this season,
  # remain untouched.
  previous <- which(players$year == outlook$season - 1L)
  match_previous <- match(players$nba_id[previous], players$nba_id[indices])
  known <- !is.na(match_previous)
  for (pair in list(c("projection_y1", "total"), c("projection_offense_y1", "offense"), c("projection_defense_y1", "defense"), c("projection_scalability_y1", "scalability"), c("projection_minutes_y1", "Minutes"), c("projection_games_y1", "games"),
      c("projection_mpg_y1", "p_mpg"), c("projection_timin_y1", "timin"), c("projection_value_y1", "season_value"))) {
    if (all(pair %in% names(players))) {
      players[[pair[1]]][previous[known]] <- players[[pair[2]]][indices[match_previous[known]]]
    }
  }
  message("Injury-aware minutes: ", sum(!is.na(matches)), " matched players; ",
    sum(abs(players$injury_minutes_delta[indices]) >= 1), " minute forecasts changed; ",
    sum(schedules$injury_adjusted), " dated game forecasts rebuilt.")
  list(players = players, schedules = schedules)
}
