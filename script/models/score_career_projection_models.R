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

build_panel <- function(base_dir) {
  skill <- read.csv(file.path(base_dir, "processed", "livedata", "impactrefresh", "skilloutput.csv"), stringsAsFactors = FALSE, check.names = FALSE)
  stats <- read.csv(file.path(base_dir, "raw", "databallr_stats.csv"), stringsAsFactors = FALSE, check.names = FALSE)

  skill$offense <- coalesce_num(skill$FINAL_OFF, skill$OFF)
  skill$defense <- coalesce_num(skill$FINAL_DEF, skill$DEF)
  skill$total <- coalesce_num(skill$FINAL_TOTAL, skill$TOTAL)
  for (skill_name in skill_names) {
    final_col <- paste0("FINAL_", skill_name)
    if (final_col %in% names(skill)) {
      skill[[skill_name]] <- coalesce_num(skill[[final_col]], skill[[skill_name]])
    }
    skill[[skill_name]] <- suppressWarnings(as.numeric(skill[[skill_name]]))
  }

  stats <- stats[, intersect(c("nba_id", "year", "Age", "draft_year", "Pos2", "GamesPlayed", "MPG", "Minutes"), names(stats)), drop = FALSE]
  names(stats)[names(stats) == "Age"] <- "age"
  names(stats)[names(stats) == "Pos2"] <- "position"
  names(stats)[names(stats) == "GamesPlayed"] <- "games"
  names(stats)[names(stats) == "MPG"] <- "mpg"
  names(stats)[names(stats) == "Minutes"] <- "stat_minutes"

  panel <- merge(
    skill[, c("nba_id", "player_name", "year", "offense", "defense", "total", skill_names)],
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
  panel$mpg_sample_reliability <- clamp(panel$minutes_equiv / (panel$minutes_equiv + 750), 0, 1)
  panel$role_prior_mpg <- ifelse(
    panel$has_prev == 1 & is.finite(panel$avg3_mpg),
    panel$avg3_mpg,
    clamp(14 + 2 * panel$total, 8, 24)
  )
  panel$adjusted_mpg <- panel$mpg_sample_reliability * panel$mpg +
    (1 - panel$mpg_sample_reliability) * panel$role_prior_mpg
  panel
}

base_dir <- resolve_base_dir()
model_path <- file.path(base_dir, "processed", "modelresults", "career_projection_models.rds")
if (!file.exists(model_path)) {
  stop("Missing trained career projection model artifact: ", model_path)
}

artifact <- readRDS(model_path)
models <- artifact$models
model_targets <- artifact$model_targets
has_minutes_model <- "target_minutes" %in% names(models)
usage_target <- if (has_minutes_model) "target_minutes" else "target_mpg"
needed_targets <- c("target_games", usage_target, "target_delta_offense", "target_delta_defense", paste0("target_", skill_names))
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
  if (has_minutes_model) {
    fallback_minutes <- fallback_games * fallback_mpg
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
  projected_offense <- clamp(state$offense + coalesce_num(
    predict_model(models$target_delta_offense$model, state, models$target_delta_offense$features),
    -0.06 * state$offense
  ), -8, 10)
  projected_defense <- clamp(state$defense + coalesce_num(
    predict_model(models$target_delta_defense$model, state, models$target_delta_defense$features),
    -0.06 * state$defense
  ), -8, 10)
  projected_total <- projected_offense + projected_defense
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
  state$mpg_sample_reliability <- clamp(state$minutes_equiv / (state$minutes_equiv + 750), 0, 1)
  state$role_prior_mpg <- ifelse(
    state$has_prev == 1 & is.finite(state$avg3_mpg),
    state$avg3_mpg,
    clamp(14 + 2 * state$total, 8, 24)
  )
  state$adjusted_mpg <- state$mpg_sample_reliability * state$mpg +
    (1 - state$mpg_sample_reliability) * state$role_prior_mpg
}

projection_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
dir.create(projection_dir, recursive = TRUE, showWarnings = FALSE)
projection_output <- do.call(rbind, predictions)
write.csv(projection_output, file.path(projection_dir, "player_career_projections.csv"), row.names = FALSE, na = "")

message("Career projection inference complete using existing model artifact.")
message("Models loaded from: ", model_path)
message("Predictions: ", file.path(projection_dir, "player_career_projections.csv"))
