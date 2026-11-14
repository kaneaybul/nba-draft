get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  script_arg <- cmd_args[grepl("--file=", cmd_args)]
  if (length(script_arg) > 0) {
    return(dirname(normalizePath(sub("--file=", "", script_arg[[1]]), winslash = "/", mustWork = FALSE)))
  }
  normalizePath(getwd(), winslash = "/", mustWork = FALSE)
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  candidates <- unique(c(getwd(), file.path(script_dir, "..", ".."), file.path(getwd(), ".."), file.path(getwd(), "..", "..")))
  for (candidate in candidates) {
    candidate <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate, "processed")) && dir.exists(file.path(candidate, "script"))) return(candidate)
  }
  stop("Could not resolve project root.")
}

clamp <- function(x, lo, hi) pmax(lo, pmin(hi, x))
coalesce_num <- function(primary, fallback) ifelse(!is.na(primary), primary, fallback)
skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
projection_metrics <- c("offense", "defense", skill_names)
aggregate_skill_metrics <- c("skill_model_off", "skill_model_def")

if (requireNamespace("ranger", quietly = TRUE)) {
  library(ranger)
}
if (requireNamespace("rpart", quietly = TRUE)) {
  library(rpart)
}

predict_model <- function(model, df, features) {
  features <- if (!is.null(model$features)) model$features else features
  pred_df <- df[, features, drop = FALSE]
  keep <- complete.cases(pred_df)
  out <- rep(NA_real_, nrow(df))
  if (!any(keep)) return(out)
  if (model$algorithm == "ranger") {
    out[keep] <- predict(model$fit, data = pred_df[keep, , drop = FALSE])$predictions
  } else {
    out[keep] <- as.numeric(predict(model$fit, newdata = pred_df[keep, , drop = FALSE]))
  }
  out
}

add_history_features <- function(panel) {
  make_lags <- function(v, lag_n) head(c(rep(NA_real_, lag_n), v), length(v))
  panel <- panel[order(panel$nba_id, panel$year), ]
  for (metric in c("total", projection_metrics, "games_equiv", "mpg", "minutes_equiv")) {
    if (!(metric %in% names(panel))) next
    panel[[paste0("lag1_", metric)]] <- NA_real_
    panel[[paste0("lag2_", metric)]] <- NA_real_
    pieces <- split(seq_len(nrow(panel)), panel$nba_id)
    for (idx in pieces) {
      values <- panel[[metric]][idx]
      panel[[paste0("lag1_", metric)]][idx] <- make_lags(values, 1)
      panel[[paste0("lag2_", metric)]][idx] <- make_lags(values, 2)
    }
    panel[[paste0("avg2_", metric)]] <- rowMeans(cbind(panel[[metric]], panel[[paste0("lag1_", metric)]]), na.rm = TRUE)
    panel[[paste0("avg3_", metric)]] <- rowMeans(cbind(panel[[metric]], panel[[paste0("lag1_", metric)]], panel[[paste0("lag2_", metric)]]), na.rm = TRUE)
  }
  panel
}

add_role_mpg_features <- function(panel) {
  panel$mpg_sample_reliability <- clamp((panel$minutes_equiv - 300) / 1700, 0, 1)
  lag1_mpg <- if ("lag1_mpg" %in% names(panel)) panel$lag1_mpg else rep(NA_real_, nrow(panel))
  lag2_mpg <- if ("lag2_mpg" %in% names(panel)) panel$lag2_mpg else rep(NA_real_, nrow(panel))
  lag1_minutes <- if ("lag1_minutes_equiv" %in% names(panel)) panel$lag1_minutes_equiv else rep(NA_real_, nrow(panel))
  lag2_minutes <- if ("lag2_minutes_equiv" %in% names(panel)) panel$lag2_minutes_equiv else rep(NA_real_, nrow(panel))
  prior_avg_mpg <- rowMeans(cbind(lag1_mpg, lag2_mpg), na.rm = TRUE)
  prior_avg_minutes <- rowMeans(cbind(lag1_minutes, lag2_minutes), na.rm = TRUE)
  prior_avg_mpg[!is.finite(prior_avg_mpg)] <- NA_real_
  prior_avg_minutes[!is.finite(prior_avg_minutes)] <- NA_real_
  panel$prior_history_role_mpg <- ifelse(
    is.finite(prior_avg_mpg) & is.finite(prior_avg_minutes) & prior_avg_minutes >= 650,
    prior_avg_mpg,
    ifelse(is.finite(lag1_mpg) & is.finite(lag1_minutes) & lag1_minutes >= 650, lag1_mpg, NA_real_)
  )
  panel$history_role_mpg <- ifelse(
    is.finite(panel$avg3_mpg) & is.finite(panel$avg3_minutes_equiv) & panel$avg3_minutes_equiv >= 650,
    panel$avg3_mpg,
    ifelse(
      is.finite(panel$avg2_mpg) & is.finite(panel$avg2_minutes_equiv) & panel$avg2_minutes_equiv >= 650,
      panel$avg2_mpg,
      NA_real_
    )
  )
  dnp_or_tiny_sample <- !is.finite(panel$minutes_equiv) | panel$minutes_equiv < 300
  panel$role_prior_mpg <- ifelse(
    panel$has_prev == 1 & dnp_or_tiny_sample & is.finite(panel$prior_history_role_mpg),
    panel$prior_history_role_mpg,
    ifelse(
    panel$has_prev == 1 & is.finite(panel$history_role_mpg),
    panel$history_role_mpg,
    clamp(14 + 2 * panel$total, 8, 24)
    )
  )
  panel$reliable_role_mpg <- panel$mpg_sample_reliability * panel$mpg +
    (1 - panel$mpg_sample_reliability) * panel$role_prior_mpg
  panel$reliable_role_mpg <- clamp(panel$reliable_role_mpg, 0, 38)
  panel$adjusted_mpg <- panel$reliable_role_mpg
  panel
}

role_mpg_history_floor <- function(state, projected_age) {
  avg2_minutes <- ifelse(is.finite(state$avg2_minutes_equiv), state$avg2_minutes_equiv, NA_real_)
  avg3_minutes <- ifelse(is.finite(state$avg3_minutes_equiv), state$avg3_minutes_equiv, NA_real_)
  prior_minutes <- if ("lag1_minutes_equiv" %in% names(state)) state$lag1_minutes_equiv else rep(NA_real_, nrow(state))
  prior2_minutes <- if ("lag2_minutes_equiv" %in% names(state)) state$lag2_minutes_equiv else rep(NA_real_, nrow(state))
  avg_history_minutes <- pmax(
    ifelse(is.na(avg2_minutes), -Inf, avg2_minutes),
    ifelse(is.na(avg3_minutes), -Inf, avg3_minutes),
    ifelse(is.na(prior_minutes), -Inf, prior_minutes),
    ifelse(is.na(prior2_minutes), -Inf, prior2_minutes)
  )
  avg_history_minutes[!is.finite(avg_history_minutes)] <- NA_real_
  floor_role_mpg <- if ("prior_history_role_mpg" %in% names(state)) {
    ifelse(is.finite(state$prior_history_role_mpg), state$prior_history_role_mpg, state$reliable_role_mpg)
  } else {
    state$reliable_role_mpg
  }
  eligible <- is.finite(avg_history_minutes) &
    avg_history_minutes >= 1400 &
    is.finite(floor_role_mpg) &
    floor_role_mpg >= 26
  decline <- pmax(0, projected_age - 30) * 0.55 + pmax(0, projected_age - 34) * 0.85
  floor_mpg <- clamp(floor_role_mpg - decline, 0, 36.5)
  ifelse(eligible & is.finite(floor_mpg), floor_mpg, NA_real_)
}

games_history_floor <- function(state, projected_age) {
  games_sources <- c("games_equiv", "lag1_games_equiv", "lag2_games_equiv", "avg2_games_equiv", "avg3_games_equiv")
  minute_sources <- c("minutes_equiv", "lag1_minutes_equiv", "lag2_minutes_equiv", "avg2_minutes_equiv", "avg3_minutes_equiv")

  best_games <- rep(-Inf, nrow(state))
  for (nm in intersect(games_sources, names(state))) {
    values <- ifelse(is.finite(state[[nm]]), state[[nm]], -Inf)
    best_games <- pmax(best_games, values)
  }
  best_games[!is.finite(best_games)] <- NA_real_

  best_minutes <- rep(-Inf, nrow(state))
  for (nm in intersect(minute_sources, names(state))) {
    values <- ifelse(is.finite(state[[nm]]), state[[nm]], -Inf)
    best_minutes <- pmax(best_minutes, values)
  }
  best_minutes[!is.finite(best_minutes)] <- NA_real_

  eligible <- is.finite(best_games) &
    best_games >= 62 &
    is.finite(best_minutes) &
    best_minutes >= 1400 &
    is.finite(state$reliable_role_mpg) &
    state$reliable_role_mpg >= 26
  decline <- pmax(0, projected_age - 30) * 0.8 + pmax(0, projected_age - 34) * 1.2
  floor_games <- clamp(pmin(best_games, 66) - decline, 0, 72)
  ifelse(eligible & is.finite(floor_games), floor_games, NA_real_)
}

reconcile_projected_components <- function(component_offense, component_defense, projected_total) {
  component_total <- component_offense + component_defense
  residual <- projected_total - component_total
  projected_offense <- clamp(component_offense + residual * 0.5, -8, 10)
  projected_defense <- projected_total - projected_offense
  projected_defense <- clamp(projected_defense, -8, 10)
  projected_offense <- clamp(projected_total - projected_defense, -8, 10)
  data.frame(offense = projected_offense, defense = projected_total - projected_offense)
}

build_panel <- function(base_dir) {
  skill <- read.csv(file.path(base_dir, "processed", "livedata", "impactrefresh", "skilloutput.csv"), stringsAsFactors = FALSE, check.names = FALSE)
  stats <- read.csv(file.path(base_dir, "raw", "databallr_stats.csv"), stringsAsFactors = FALSE, check.names = FALSE)

  skill$offense <- coalesce_num(skill$FINAL_OFF, skill$OFF)
  skill$defense <- coalesce_num(skill$FINAL_DEF, skill$DEF)
  skill$total <- coalesce_num(skill$FINAL_TOTAL, skill$TOTAL)
  skill$skill_model_off <- suppressWarnings(as.numeric(skill$OFF))
  skill$skill_model_def <- suppressWarnings(as.numeric(skill$DEF))
  for (skill_name in skill_names) {
    final_col <- paste0("FINAL_", skill_name)
    if (final_col %in% names(skill)) {
      skill[[skill_name]] <- coalesce_num(skill[[final_col]], skill[[skill_name]])
    }
    skill[[skill_name]] <- suppressWarnings(as.numeric(skill[[skill_name]]))
  }

  latest_skill_year <- max(suppressWarnings(as.integer(skill$year)), na.rm = TRUE)
  latest_skill_keys <- unique(skill[skill$year == latest_skill_year, c("nba_id", "year"), drop = FALSE])
  stats <- append_darko_dpm_fallback_rows(
    stats = stats,
    epm_rows = latest_skill_keys,
    base_dir = base_dir,
    strict = TRUE
  )

  stats <- stats[, intersect(c("nba_id", "year", "Age", "draft_year", "Pos2", "GamesPlayed", "MPG", "Minutes"), names(stats)), drop = FALSE]
  names(stats)[names(stats) == "Age"] <- "age"
  names(stats)[names(stats) == "Pos2"] <- "position"
  names(stats)[names(stats) == "GamesPlayed"] <- "games"
  names(stats)[names(stats) == "MPG"] <- "mpg"
  names(stats)[names(stats) == "Minutes"] <- "stat_minutes"

  panel <- merge(
    skill[, c("nba_id", "player_name", "year", "offense", "defense", "total", aggregate_skill_metrics, skill_names)],
    stats,
    by = c("nba_id", "year"),
    all.x = TRUE
  )
  panel$position <- factor(ifelse(is.na(panel$position) | panel$position == "", "UNK", panel$position))
  pos_text <- toupper(as.character(panel$position))
  panel$pos_guard <- as.numeric(grepl("PG|SG|\\bG\\b", pos_text))
  panel$pos_wing <- as.numeric(grepl("SG|SF|\\bG\\b|\\bF\\b", pos_text))
  panel$pos_forward <- as.numeric(grepl("SF|PF|\\bF\\b", pos_text))
  panel$pos_big <- as.numeric(grepl("PF|C|\\bF\\b|\\bC\\b", pos_text))
  panel$pos_center <- as.numeric(grepl("\\bC\\b|(^|[-/ ])C($|[-/ ])", pos_text))
  panel$age <- suppressWarnings(as.numeric(panel$age))
  panel$draft_year <- suppressWarnings(as.numeric(panel$draft_year))
  panel$yoe <- ifelse(
    !is.na(panel$draft_year),
    pmax(0, panel$year - panel$draft_year),
    ifelse(!is.na(panel$age), pmax(0, panel$age - 19), 0)
  )
  panel$games <- suppressWarnings(as.numeric(panel$games))
  panel$mpg <- suppressWarnings(as.numeric(panel$mpg))
  panel$minutes <- coalesce_num(suppressWarnings(as.numeric(panel$stat_minutes)), panel$games * panel$mpg)
  panel$season_max_games <- ave(panel$games, panel$year, FUN = function(v) max(v, na.rm = TRUE))
  panel$season_games_factor <- ifelse(is.finite(panel$season_max_games) & panel$season_max_games > 0, 82 / panel$season_max_games, 1)
  panel$games_equiv <- clamp(panel$games * panel$season_games_factor, 0, 82)
  panel$minutes_equiv <- clamp(panel$minutes * panel$season_games_factor, 0, 3300)
  panel <- panel[order(panel$nba_id, panel$year), ]
  panel$age_sq <- panel$age^2
  panel$age_under_25 <- pmax(0, 25 - panel$age)
  panel$age_25_to_29 <- pmax(0, pmin(panel$age, 29) - 25)
  panel$age_over_29 <- pmax(0, panel$age - 29)
  panel$age_over_33 <- pmax(0, panel$age - 33)
  panel$age_peak_distance <- panel$age - 27
  panel$age_peak_distance_sq <- panel$age_peak_distance^2
  panel <- add_history_features(panel)

  prev_metrics <- c("total", projection_metrics, "games_equiv", "mpg", "minutes_equiv")
  prev <- panel[, c("nba_id", "year", prev_metrics), drop = FALSE]
  prev$year <- prev$year + 1
  names(prev)[-1] <- paste0("prev_", names(prev)[-1])
  panel <- merge(panel, prev, by.x = c("nba_id", "year"), by.y = c("nba_id", "prev_year"), all.x = TRUE)
  panel$has_prev <- ifelse(is.na(panel$prev_total), 0, 1)
  panel$delta_total <- panel$total - panel$prev_total
  for (metric in projection_metrics) {
    prev_col <- paste0("prev_", metric)
    delta_col <- paste0("delta_", metric)
    if (prev_col %in% names(panel) && metric %in% names(panel)) {
      panel[[delta_col]] <- panel[[metric]] - panel[[prev_col]]
    }
  }
  panel$delta_mpg <- panel$mpg - panel$prev_mpg
  panel$delta_games <- panel$games_equiv - panel$prev_games_equiv
  panel$young_total <- panel$age_under_25 * panel$total
  panel$young_offense <- panel$age_under_25 * panel$offense
  panel$young_defense <- panel$age_under_25 * panel$defense
  panel$decline_total <- panel$age_over_29 * panel$total
  panel$decline_offense <- panel$age_over_29 * panel$offense
  panel$decline_defense <- panel$age_over_29 * panel$defense
  fill_zero_cols <- c(
    paste0("prev_", c("total", projection_metrics, "games_equiv", "mpg", "minutes_equiv")),
    paste0("delta_", c("total", projection_metrics)),
    "delta_mpg", "delta_games"
  )
  for (nm in intersect(fill_zero_cols, names(panel))) {
    panel[[nm]][is.na(panel[[nm]])] <- 0
  }
  panel <- add_role_mpg_features(panel)
  panel
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "data", "darko_dpm_fallback.R"), local = TRUE)
model_path <- file.path(base_dir, "processed", "modelresults", "career_projection_models.rds")
if (!file.exists(model_path)) {
  stop("Missing trained career projection model artifact: ", model_path)
}

artifact <- readRDS(model_path)
models <- artifact$models
model_targets <- artifact$model_targets
has_minutes_model <- "target_minutes" %in% names(models)
has_role_mpg_model <- "target_role_mpg" %in% names(models)
usage_target <- if (has_role_mpg_model) "target_role_mpg" else if (has_minutes_model) "target_minutes" else "target_mpg"
has_offense_level_model <- "target_offense" %in% names(models)
has_component_level_models <- all(c("target_offense", "target_defense") %in% names(models))
component_targets <- if (has_component_level_models) c("target_offense", "target_defense") else if (has_offense_level_model) "target_offense" else c("target_delta_offense", "target_delta_defense")
has_total_delta_model <- "target_delta_total" %in% names(models)
has_total_level_model <- "target_total" %in% names(models)
total_targets <- if (has_total_delta_model) "target_delta_total" else if (has_total_level_model) "target_total" else character()
needed_targets <- c("target_games", usage_target, total_targets, component_targets, paste0("target_", aggregate_skill_metrics), paste0("target_", skill_names))
missing_targets <- setdiff(needed_targets, names(models))
if (length(missing_targets) > 0) {
  stop("Model artifact is missing targets: ", paste(missing_targets, collapse = ", "))
}

panel <- build_panel(base_dir)
max_year <- max(panel$year, na.rm = TRUE)
latest <- panel[panel$year == max_year, ]
latest$position <- factor(latest$position, levels = levels(panel$position))
state <- latest
predictions <- list()

for (horizon in 1:5) {
  fallback_games <- clamp(coalesce_num(state$games_equiv, state$games), 0, 82)
  fallback_games[!is.finite(fallback_games)] <- 0
  fallback_mpg <- clamp(coalesce_num(state$adjusted_mpg, coalesce_num(state$mpg, ifelse(fallback_games > 0, state$minutes_equiv / fallback_games, 0))), 0, 38)
  fallback_mpg[!is.finite(fallback_mpg)] <- 0

  projected_games <- clamp(coalesce_num(
    predict_model(models$target_games$model, state, models$target_games$features),
    fallback_games
  ), 0, 82)
  games_floor <- games_history_floor(state, state$age + 1)
  projected_games <- ifelse(is.finite(games_floor), pmax(projected_games, games_floor), projected_games)
  projected_games <- clamp(projected_games, 0, 82)
  if (has_role_mpg_model) {
    state$target_games <- projected_games
    state$target_minutes_at_adjusted_mpg <- projected_games * state$adjusted_mpg
    state$target_minutes_at_avg3_mpg <- projected_games * state$avg3_mpg
    state$target_minutes_at_reliable_role_mpg <- projected_games * state$reliable_role_mpg
    projected_mpg <- clamp(coalesce_num(
      predict_model(models$target_role_mpg$model, state, models$target_role_mpg$features),
      fallback_mpg
    ), 0, 38)
    mpg_floor <- role_mpg_history_floor(state, state$age + 1)
    projected_mpg <- ifelse(is.finite(mpg_floor), pmax(projected_mpg, mpg_floor), projected_mpg)
    projected_minutes <- projected_games * projected_mpg
  } else if (has_minutes_model) {
    fallback_minutes <- fallback_games * fallback_mpg
    state$target_games <- projected_games
    state$target_minutes_at_adjusted_mpg <- projected_games * state$adjusted_mpg
    state$target_minutes_at_avg3_mpg <- projected_games * state$avg3_mpg
    state$target_minutes_at_reliable_role_mpg <- projected_games * state$reliable_role_mpg
    projected_minutes <- clamp(coalesce_num(
      predict_model(models$target_minutes$model, state, models$target_minutes$features),
      fallback_minutes
    ), 0, 3300)
    projected_mpg <- clamp(ifelse(projected_games > 0, projected_minutes / projected_games, 0), 0, 38)
    projected_minutes <- projected_games * projected_mpg
  } else {
    projected_mpg <- clamp(coalesce_num(
      predict_model(models$target_mpg$model, state, models$target_mpg$features),
      fallback_mpg
    ), 0, 38)
    projected_minutes <- projected_games * projected_mpg
  }
  if (has_offense_level_model) {
    projected_offense_component <- clamp(coalesce_num(
      predict_model(models$target_offense$model, state, models$target_offense$features),
      state$offense
    ), -8, 10)
    component_defense <- NULL
    if (has_component_level_models) {
      component_defense <- clamp(coalesce_num(
      predict_model(models$target_defense$model, state, models$target_defense$features),
      state$defense
      ), -8, 10)
    }
  } else {
    projected_offense_component <- clamp(state$offense + coalesce_num(
      predict_model(models$target_delta_offense$model, state, models$target_delta_offense$features),
      -0.06 * state$offense
    ), -8, 10)
    component_defense <- clamp(state$defense + coalesce_num(
      predict_model(models$target_delta_defense$model, state, models$target_delta_defense$features),
      -0.06 * state$defense
    ), -8, 10)
  }
  component_total <- if (!is.null(component_defense)) projected_offense_component + component_defense else NA_real_
  projected_total <- if (has_total_delta_model) {
    clamp(state$total + coalesce_num(
      predict_model(models$target_delta_total$model, state, models$target_delta_total$features),
      0
    ), -8, 12)
  } else if (has_total_level_model) {
    clamp(coalesce_num(
      predict_model(models$target_total$model, state, models$target_total$features),
      component_total
    ), -8, 12)
  } else {
    component_total
  }
  projected_offense <- if (has_component_level_models) {
    reconcile_projected_components(projected_offense_component, component_defense, projected_total)$offense
  } else {
    projected_offense_component
  }
  projected_defense <- projected_total - projected_offense
  projected_skill_model_off <- clamp(coalesce_num(
    predict_model(models$target_skill_model_off$model, state, models$target_skill_model_off$features),
    state$skill_model_off
  ), -8, 10)
  projected_skill_model_def <- clamp(coalesce_num(
    predict_model(models$target_skill_model_def$model, state, models$target_skill_model_def$features),
    state$skill_model_def
  ), -8, 10)
  projected_skills <- lapply(skill_names, function(skill_name) {
    target <- paste0("target_", skill_name)
    clamp(coalesce_num(
      predict_model(models[[target]]$model, state, models[[target]]$features),
      state[[skill_name]]
    ), -5, 5)
  })
  names(projected_skills) <- paste0("projected_", tolower(skill_names))
  pred_row <- data.frame(
    nba_id = state$nba_id,
    player_name = state$player_name,
    base_year = max_year,
    horizon = horizon,
    projected_year = max_year + horizon,
    projected_age = state$age + 1,
    projected_games = projected_games,
    projected_mpg = projected_mpg,
    projected_minutes = projected_minutes,
    projected_total = projected_total,
    projected_offense = projected_offense,
    projected_defense = projected_defense,
    projected_skill_model_off = projected_skill_model_off,
    projected_skill_model_def = projected_skill_model_def,
    stringsAsFactors = FALSE
  )
  for (skill_name in skill_names) {
    pred_row[[paste0("projected_", tolower(skill_name))]] <- projected_skills[[paste0("projected_", tolower(skill_name))]]
  }
  predictions[[horizon]] <- pred_row

  old_total <- state$total
  old_projection_metrics <- state[, projection_metrics, drop = FALSE]
  old_games <- state$games_equiv
  old_mpg <- state$mpg
  old_minutes <- state$minutes_equiv

  state$age <- state$age + 1
  state$age_sq <- state$age^2
  state$age_under_25 <- pmax(0, 25 - state$age)
  state$age_25_to_29 <- pmax(0, pmin(state$age, 29) - 25)
  state$age_over_29 <- pmax(0, state$age - 29)
  state$age_over_33 <- pmax(0, state$age - 33)
  state$age_peak_distance <- state$age - 27
  state$age_peak_distance_sq <- state$age_peak_distance^2
  state$yoe <- state$yoe + 1
  state$prev_total <- old_total
  for (metric in projection_metrics) {
    prev_col <- paste0("prev_", metric)
    if (prev_col %in% names(state)) {
      state[[prev_col]] <- old_projection_metrics[[metric]]
    }
  }
  state$prev_games_equiv <- old_games
  state$prev_mpg <- old_mpg
  state$prev_minutes_equiv <- old_minutes
  state$lag2_total <- state$lag1_total
  state$lag1_total <- old_total
  for (metric in projection_metrics) {
    lag1_col <- paste0("lag1_", metric)
    lag2_col <- paste0("lag2_", metric)
    if (lag1_col %in% names(state) && lag2_col %in% names(state)) {
      state[[lag2_col]] <- state[[lag1_col]]
      state[[lag1_col]] <- old_projection_metrics[[metric]]
    }
  }
  state$lag2_games_equiv <- state$lag1_games_equiv
  state$lag1_games_equiv <- old_games
  state$lag2_mpg <- state$lag1_mpg
  state$lag1_mpg <- old_mpg
  state$lag2_minutes_equiv <- state$lag1_minutes_equiv
  state$lag1_minutes_equiv <- old_minutes
  state$total <- projected_total
  state$offense <- projected_offense
  state$defense <- projected_defense
  state$skill_model_off <- projected_skill_model_off
  state$skill_model_def <- projected_skill_model_def
  for (skill_name in skill_names) {
    state[[skill_name]] <- projected_skills[[paste0("projected_", tolower(skill_name))]]
  }
  state$games <- projected_games
  state$games_equiv <- projected_games
  state$mpg <- projected_mpg
  state$minutes <- projected_minutes
  state$minutes_equiv <- projected_minutes
  state$delta_total <- state$total - state$prev_total
  for (metric in projection_metrics) {
    prev_col <- paste0("prev_", metric)
    delta_col <- paste0("delta_", metric)
    if (prev_col %in% names(state) && delta_col %in% names(state)) {
      state[[delta_col]] <- state[[metric]] - state[[prev_col]]
    }
  }
  state$delta_mpg <- state$mpg - state$prev_mpg
  state$delta_games <- state$games_equiv - state$prev_games_equiv
  state$young_total <- state$age_under_25 * state$total
  state$young_offense <- state$age_under_25 * state$offense
  state$young_defense <- state$age_under_25 * state$defense
  state$decline_total <- state$age_over_29 * state$total
  state$decline_offense <- state$age_over_29 * state$offense
  state$decline_defense <- state$age_over_29 * state$defense
  state$avg2_total <- rowMeans(cbind(state$total, state$lag1_total), na.rm = TRUE)
  state$avg3_total <- rowMeans(cbind(state$total, state$lag1_total, state$lag2_total), na.rm = TRUE)
  for (metric in projection_metrics) {
    lag1_col <- paste0("lag1_", metric)
    lag2_col <- paste0("lag2_", metric)
    avg2_col <- paste0("avg2_", metric)
    avg3_col <- paste0("avg3_", metric)
    if (all(c(lag1_col, lag2_col, avg2_col, avg3_col) %in% names(state))) {
      state[[avg2_col]] <- rowMeans(cbind(state[[metric]], state[[lag1_col]]), na.rm = TRUE)
      state[[avg3_col]] <- rowMeans(cbind(state[[metric]], state[[lag1_col]], state[[lag2_col]]), na.rm = TRUE)
    }
  }
  state$avg2_games_equiv <- rowMeans(cbind(state$games_equiv, state$lag1_games_equiv), na.rm = TRUE)
  state$avg3_games_equiv <- rowMeans(cbind(state$games_equiv, state$lag1_games_equiv, state$lag2_games_equiv), na.rm = TRUE)
  state$avg2_mpg <- rowMeans(cbind(state$mpg, state$lag1_mpg), na.rm = TRUE)
  state$avg3_mpg <- rowMeans(cbind(state$mpg, state$lag1_mpg, state$lag2_mpg), na.rm = TRUE)
  state$avg2_minutes_equiv <- rowMeans(cbind(state$minutes_equiv, state$lag1_minutes_equiv), na.rm = TRUE)
  state$avg3_minutes_equiv <- rowMeans(cbind(state$minutes_equiv, state$lag1_minutes_equiv, state$lag2_minutes_equiv), na.rm = TRUE)
  state$has_prev <- 1
  state <- add_role_mpg_features(state)
}

projection_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
dir.create(projection_dir, recursive = TRUE, showWarnings = FALSE)
projection_output <- do.call(rbind, predictions)
write.csv(projection_output, file.path(projection_dir, "player_career_projections.csv"), row.names = FALSE, na = "")

message("Career projection inference complete using existing model artifact.")
message("Models loaded from: ", model_path)
message("Predictions: ", file.path(projection_dir, "player_career_projections.csv"))
