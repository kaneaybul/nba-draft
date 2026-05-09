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

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}

metrics <- function(actual, predicted) {
  ok <- is.finite(actual) & is.finite(predicted)
  actual <- actual[ok]
  predicted <- predicted[ok]
  if (length(actual) == 0) return(c(n = 0, mae = NA_real_, rmse = NA_real_, r2 = NA_real_))
  sse <- sum((actual - predicted)^2)
  sst <- sum((actual - mean(actual))^2)
  c(n = length(actual), mae = mean(abs(actual - predicted)), rmse = sqrt(mean((actual - predicted)^2)), r2 = ifelse(sst > 0, 1 - sse / sst, NA_real_))
}

prepare_model_df <- function(df, target, features) {
  model_df <- df[, c(target, features), drop = FALSE]
  model_df[complete.cases(model_df), , drop = FALSE]
}

rank_features_by_target <- function(model_df, target, features) {
  scores <- vapply(features, function(feature) {
    suppressWarnings(abs(cor(model_df[[feature]], model_df[[target]], use = "complete.obs")))
  }, numeric(1))
  scores[!is.finite(scores)] <- 0
  scores
}

prune_correlated_features <- function(model_df, target, features, cutoff = 0.92) {
  if (length(features) <= 1) return(features)
  feature_scores <- rank_features_by_target(model_df, target, features)
  remaining <- features

  repeat {
    if (length(remaining) <= 1) break
    corr <- suppressWarnings(abs(cor(model_df[, remaining, drop = FALSE], use = "pairwise.complete.obs")))
    corr[!is.finite(corr)] <- 0
    diag(corr) <- 0
    max_corr <- max(corr, na.rm = TRUE)
    if (!is.finite(max_corr) || max_corr < cutoff) break

    pair <- which(corr == max_corr, arr.ind = TRUE)[1, ]
    pair_features <- remaining[pair]
    drop_feature <- pair_features[which.min(feature_scores[pair_features])]
    if (length(drop_feature) != 1 || is.na(drop_feature)) drop_feature <- pair_features[[2]]
    remaining <- setdiff(remaining, drop_feature)
  }

  remaining
}

vif_values <- function(model_df, features) {
  if (length(features) <= 1) return(setNames(rep(1, length(features)), features))
  corr <- suppressWarnings(cor(model_df[, features, drop = FALSE], use = "complete.obs"))
  if (any(!is.finite(corr))) return(setNames(rep(Inf, length(features)), features))
  inv <- tryCatch(solve(corr), error = function(e) NULL)
  if (is.null(inv)) return(setNames(rep(Inf, length(features)), features))
  setNames(diag(inv), features)
}

prune_vif_features <- function(model_df, target, features, cutoff = 8, min_features = 3) {
  if (length(features) <= min_features) return(features)
  feature_scores <- rank_features_by_target(model_df, target, features)
  remaining <- features

  repeat {
    if (length(remaining) <= min_features) break
    vifs <- vif_values(model_df, remaining)
    max_vif <- max(vifs, na.rm = TRUE)
    if (!is.finite(max_vif) || max_vif <= cutoff) break

    tied <- names(vifs)[vifs == max_vif]
    drop_feature <- tied[which.min(feature_scores[tied])]
    if (length(drop_feature) != 1 || is.na(drop_feature)) drop_feature <- tied[[1]]
    remaining <- setdiff(remaining, drop_feature)
  }

  remaining
}

select_model_features <- function(model_df, target, features, algorithm) {
  features <- intersect(features, names(model_df))
  if (length(features) == 0) return(features)

  numeric_features <- features[vapply(features, function(feature) is.numeric(model_df[[feature]]) || is.integer(model_df[[feature]]), logical(1))]
  features <- numeric_features
  if (length(features) == 0) return(features)

  variances <- vapply(features, function(feature) var(model_df[[feature]], na.rm = TRUE), numeric(1))
  unique_counts <- vapply(features, function(feature) length(unique(model_df[[feature]][is.finite(model_df[[feature]])])), integer(1))
  features <- features[is.finite(variances) & variances > 1e-8 & unique_counts > 1]
  if (length(features) == 0) return(features)

  cor_cutoff <- as.numeric(Sys.getenv("CAREER_FEATURE_COR_CUTOFF", unset = "0.92"))
  if (is.na(cor_cutoff) || cor_cutoff <= 0 || cor_cutoff >= 1) cor_cutoff <- 0.92
  features <- prune_correlated_features(model_df, target, features, cutoff = cor_cutoff)

  max_features <- if (algorithm == "lm") {
    as.integer(Sys.getenv("CAREER_MAX_LM_FEATURES", unset = "18"))
  } else {
    as.integer(Sys.getenv("CAREER_MAX_TREE_FEATURES", unset = "24"))
  }
  if (is.na(max_features) || max_features <= 0) max_features <- length(features)
  if (length(features) > max_features) {
    scores <- rank_features_by_target(model_df, target, features)
    features <- names(sort(scores, decreasing = TRUE))[seq_len(max_features)]
  }

  if (algorithm == "lm") {
    vif_cutoff <- as.numeric(Sys.getenv("CAREER_FEATURE_VIF_CUTOFF", unset = "8"))
    if (is.na(vif_cutoff) || vif_cutoff <= 1) vif_cutoff <- 8
    features <- prune_vif_features(model_df, target, features, cutoff = vif_cutoff)

    use_stepwise <- tolower(Sys.getenv("CAREER_LM_STEPWISE", unset = "true")) %in% c("1", "true", "yes")
    if (use_stepwise && length(features) > 1) {
      lm_df <- model_df[, c(target, features), drop = FALSE]
      fit <- tryCatch(lm(as.formula(paste(target, "~ .")), data = lm_df), error = function(e) NULL)
      if (!is.null(fit)) {
        stepped <- tryCatch(
          suppressWarnings(step(fit, direction = "both", trace = 0, k = log(nrow(lm_df)))),
          error = function(e) fit
        )
        term_labels <- attr(terms(stepped), "term.labels")
        if (length(term_labels) > 0) features <- intersect(term_labels, features)
      }
    }
  }

  features
}

train_model <- function(df, target, features, algorithm) {
  model_df <- prepare_model_df(df, target, features)
  selected_features <- select_model_features(model_df, target, features, algorithm)
  if (length(selected_features) == 0) return(NULL)
  model_df <- model_df[, c(target, selected_features), drop = FALSE]
  formula <- as.formula(paste(target, "~ ."))
  if (algorithm == "lm") {
    return(list(algorithm = algorithm, fit = lm(formula, data = model_df), features = selected_features))
  }
  if (algorithm == "rpart") {
    if (!requireNamespace("rpart", quietly = TRUE)) return(NULL)
    return(list(
      algorithm = algorithm,
      features = selected_features,
      fit = rpart::rpart(formula, data = model_df, method = "anova", control = rpart::rpart.control(cp = 0.004, minbucket = 18))
    ))
  }
  if (algorithm == "ranger") {
    if (!requireNamespace("ranger", quietly = TRUE)) return(NULL)
    return(list(
      algorithm = algorithm,
      fit = ranger::ranger(
        formula = formula,
        data = model_df,
        num.trees = 700,
        mtry = max(2, floor(sqrt(length(selected_features)))),
        min.node.size = 12,
        seed = 42,
        importance = "permutation"
      ),
      features = selected_features
    ))
  }
  NULL
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
  panel$pos_big <- as.numeric(grepl("PF|C", pos_text))
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

make_one_year_rows <- function(panel) {
  future_metrics <- c(projection_metrics, "total", "games_equiv", "mpg", "minutes_equiv")
  future <- panel[, c("nba_id", "year", future_metrics), drop = FALSE]
  future$source_year <- future$year - 1
  names(future)[names(future) %in% future_metrics] <-
    paste0("target_", names(future)[names(future) %in% future_metrics])
  names(future)[names(future) == "target_games_equiv"] <- "target_games"
  names(future)[names(future) == "target_minutes_equiv"] <- "target_minutes"
  out <- merge(
    panel,
    future[, c("nba_id", "source_year", paste0("target_", projection_metrics), "target_total", "target_games", "target_mpg", "target_minutes"), drop = FALSE],
    by.x = c("nba_id", "year"),
    by.y = c("nba_id", "source_year"),
    all.x = TRUE
  )
  out$target_exists <- ifelse(is.na(out$target_games), 0, 1)
  out$target_games <- ifelse(is.na(out$target_games), 0, out$target_games)
  out$target_mpg <- ifelse(is.na(out$target_mpg), 0, out$target_mpg)
  out$target_minutes <- ifelse(is.na(out$target_minutes), 0, out$target_minutes)
  out$target_year <- out$year + 1
  for (metric in c(projection_metrics, "total")) {
    target_col <- paste0("target_", metric)
    delta_col <- paste0("target_delta_", metric)
    if (all(c(target_col, metric) %in% names(out))) {
      out[[delta_col]] <- out[[target_col]] - out[[metric]]
    }
  }
  out
}

build_bref_gp_rows <- function(base_dir) {
  path <- file.path(base_dir, "raw", "bref_player_seasons.csv")
  if (!file.exists(path)) return(NULL)
  bref <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  needed <- c("player_key", "year", "age", "games", "mpg", "minutes")
  if (!all(needed %in% names(bref))) return(NULL)

  panel <- data.frame(
    nba_id = bref$player_key,
    player_name = bref$player_name,
    year = suppressWarnings(as.integer(bref$year)),
    age = suppressWarnings(as.numeric(bref$age)),
    games = suppressWarnings(as.numeric(bref$games)),
    mpg = suppressWarnings(as.numeric(bref$mpg)),
    minutes = suppressWarnings(as.numeric(bref$minutes)),
    total = 0,
    stringsAsFactors = FALSE
  )
  panel <- panel[is.finite(panel$year) & is.finite(panel$games) & is.finite(panel$mpg), ]
  panel$minutes[!is.finite(panel$minutes)] <- panel$games[!is.finite(panel$minutes)] * panel$mpg[!is.finite(panel$minutes)]
  panel$season_max_games <- ave(panel$games, panel$year, FUN = function(v) max(v, na.rm = TRUE))
  panel$season_games_factor <- ifelse(is.finite(panel$season_max_games) & panel$season_max_games > 0, 82 / panel$season_max_games, 1)
  panel$games_equiv <- clamp(panel$games * panel$season_games_factor, 0, 82)
  panel$minutes_equiv <- clamp(panel$minutes * panel$season_games_factor, 0, 3300)
  panel$age_sq <- panel$age^2
  panel <- add_history_features(panel)
  panel <- panel[order(panel$nba_id, panel$year), ]
  prev <- panel[, c("nba_id", "year", "games_equiv", "mpg", "minutes_equiv")]
  prev$year <- prev$year + 1
  names(prev)[-1] <- paste0("prev_", names(prev)[-1])
  panel <- merge(panel, prev, by.x = c("nba_id", "year"), by.y = c("nba_id", "prev_year"), all.x = TRUE)
  panel$delta_mpg <- panel$mpg - panel$prev_mpg
  panel$delta_games <- panel$games_equiv - panel$prev_games_equiv
  for (nm in c("prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_mpg", "delta_games")) {
    panel[[nm]][is.na(panel[[nm]])] <- 0
  }

  future <- panel[, c("nba_id", "year", "games_equiv")]
  future$source_year <- future$year - 1
  names(future)[names(future) == "games_equiv"] <- "target_games"
  out <- merge(panel, future[, c("nba_id", "source_year", "target_games")], by.x = c("nba_id", "year"), by.y = c("nba_id", "source_year"), all.x = FALSE)
  out <- out[is.finite(out$target_games), ]
  out
}

base_dir <- resolve_base_dir()

panel <- build_panel(base_dir)
max_year <- max(panel$year, na.rm = TRUE)
latest_is_partial <- max(panel$games[panel$year == max_year], na.rm = TRUE) < 70
complete_target_year <- if (latest_is_partial) max_year - 1 else max_year
train_df <- make_one_year_rows(panel)
train_df <- train_df[!is.na(train_df$age) & !is.na(train_df$yoe) & train_df$target_year <= complete_target_year, ]
train_df$position <- factor(train_df$position, levels = levels(panel$position))

feature_sets <- list(
  gp_reference_shape = c("games_equiv", "total"),
  mpg_reference_shape = c("mpg", "age", "total"),
  total_reference_shape = c("age", "age_sq", "yoe", "total", "avg2_total", "avg3_total", "mpg", "games_equiv"),
  component_reference_shape = c("age", "age_sq", "yoe", "total", "avg2_total", "avg3_total", "mpg", "games_equiv", "offense", "defense", skill_names),
  component_delta_age_curve = c(
    "pos_guard", "pos_wing", "pos_forward", "pos_big", "pos_center",
    "age_peak_distance", "age_peak_distance_sq",
    "offense", "defense", "total",
    "avg2_total", "avg3_total",
    "mpg", "games_equiv", "minutes_equiv",
    "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv",
    "has_prev", "delta_offense", "delta_defense", "delta_total", "delta_mpg", "delta_games"
  ),
  skill_reference_shape = c("age", "age_sq", "yoe", "total", "avg2_total", "avg3_total", "mpg", "games_equiv", skill_names),
  usage_history = c("age", "age_sq", "yoe", "games_equiv", "mpg", "minutes_equiv", "avg2_games_equiv", "avg3_games_equiv", "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv", "has_prev", "prev_total", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_mpg", "delta_games"),
  blended_history = c("age", "age_sq", "yoe", "games_equiv", "mpg", "minutes_equiv", "total", "avg2_total", "avg3_total", "avg2_games_equiv", "avg3_games_equiv", "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv", "has_prev", "prev_total", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_total", "delta_mpg", "delta_games"),
  minutes_role_history = c(
    "age", "age_sq", "yoe",
    "games_equiv", "minutes_equiv",
    "adjusted_mpg", "mpg_sample_reliability", "role_prior_mpg",
    "total", "avg2_total", "avg3_total",
    "avg2_games_equiv", "avg3_games_equiv",
    "avg2_minutes_equiv", "avg3_minutes_equiv",
    "has_prev", "prev_total", "prev_games_equiv", "prev_minutes_equiv",
    "delta_total", "delta_games"
  )
)

target_feature_sets <- list(
  target_games = c("gp_reference_shape", "usage_history", "blended_history"),
  target_minutes = c("minutes_role_history", "usage_history", "blended_history"),
  target_total = c("total_reference_shape", "usage_history", "blended_history"),
  target_offense = c("component_reference_shape", "total_reference_shape"),
  target_defense = c("component_reference_shape", "total_reference_shape"),
  target_delta_offense = c("component_delta_age_curve"),
  target_delta_defense = c("component_delta_age_curve")
)
for (skill_name in skill_names) {
  target_feature_sets[[paste0("target_", skill_name)]] <- c("skill_reference_shape", "total_reference_shape")
}

algorithms <- c("lm", "rpart", "ranger")
validation_targets <- c(
  "target_minutes", "target_total", "target_offense", "target_defense",
  "target_delta_offense", "target_delta_defense",
  paste0("target_", skill_names)
)
validation <- data.frame()
for (target in validation_targets) {
  target_df <- train_df
  if (target %in% c("target_games", validation_targets)) target_df <- target_df[target_df$target_exists == 1, ]
  holdout_years <- sort(unique(target_df$target_year))
  holdout_years <- holdout_years[holdout_years >= max(min(holdout_years) + 4, complete_target_year - 4) & holdout_years <= complete_target_year]
  for (set_name in target_feature_sets[[target]]) {
    features <- feature_sets[[set_name]]
    for (algorithm in algorithms) {
      actual_all <- numeric()
      pred_all <- numeric()
      used_years <- integer()
      for (holdout_year in holdout_years) {
        train_idx <- target_df$target_year < holdout_year
        holdout_idx <- target_df$target_year == holdout_year
        if (sum(train_idx) < 200 || sum(holdout_idx) < 50) next
        model <- train_model(target_df[train_idx, ], target, features, algorithm)
        if (is.null(model)) next
        pred <- predict_model(model, target_df[holdout_idx, ], features)
        actual_all <- c(actual_all, target_df[[target]][holdout_idx])
        pred_all <- c(pred_all, pred)
        used_years <- c(used_years, holdout_year)
      }
      if (length(pred_all) == 0) next
      m <- metrics(actual_all, pred_all)
      validation <- rbind(validation, data.frame(
        algorithm = algorithm,
        model_set = set_name,
        target = target,
        holdout_years = paste(unique(used_years), collapse = "|"),
        n = m[["n"]],
        mae = m[["mae"]],
        rmse = m[["rmse"]],
        r2 = m[["r2"]],
        stringsAsFactors = FALSE
      ))
    }
  }
}

gp_feature_sets <- list(
  gp_reference_shape = c("games_equiv", "mpg", "age", "age_sq"),
  gp_history = c("age", "age_sq", "games_equiv", "mpg", "minutes_equiv", "avg2_games_equiv", "avg3_games_equiv", "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_mpg", "delta_games")
)
gp_train_df <- build_bref_gp_rows(base_dir)
if (is.null(gp_train_df) || nrow(gp_train_df) < 1000) {
  warning("BRef GP dataset unavailable; falling back to impact-panel GP model.")
  gp_train_df <- train_df[train_df$target_exists == 1, ]
  gp_feature_sets <- list(gp_reference_shape = c("games_equiv", "total"), gp_history = feature_sets$usage_history)
}
for (set_name in names(gp_feature_sets)) {
  features <- gp_feature_sets[[set_name]]
  for (algorithm in algorithms) {
    actual_all <- numeric()
    pred_all <- numeric()
    used_years <- integer()
    holdout_years <- sort(unique(gp_train_df$year + 1))
    holdout_years <- holdout_years[holdout_years >= max(min(holdout_years) + 4, max(holdout_years) - 4)]
    for (holdout_year in holdout_years) {
      train_idx <- gp_train_df$year + 1 < holdout_year
      holdout_idx <- gp_train_df$year + 1 == holdout_year
      if (sum(train_idx) < 1000 || sum(holdout_idx) < 200) next
      model <- train_model(gp_train_df[train_idx, ], "target_games", features, algorithm)
      if (is.null(model)) next
      pred <- predict_model(model, gp_train_df[holdout_idx, ], features)
      actual_all <- c(actual_all, gp_train_df$target_games[holdout_idx])
      pred_all <- c(pred_all, pred)
      used_years <- c(used_years, holdout_year)
    }
    if (length(pred_all) == 0) next
    m <- metrics(actual_all, clamp(pred_all, 0, 82))
    validation <- rbind(validation, data.frame(
      algorithm = algorithm,
      model_set = set_name,
      target = "target_games",
      holdout_years = paste(unique(used_years), collapse = "|"),
      n = m[["n"]],
      mae = m[["mae"]],
      rmse = m[["rmse"]],
      r2 = m[["r2"]],
      stringsAsFactors = FALSE
    ))
  }
}
feature_sets <- c(feature_sets, gp_feature_sets)

best_row <- function(target) {
  rows <- validation[validation$target == target, ]
  penalty <- ifelse(rows$algorithm == "lm", 1, ifelse(rows$algorithm == "ranger", 1.005, 1.02))
  rows$selection_score <- rows$rmse * penalty
  rows[which.min(rows$selection_score), , drop = FALSE]
}

all_validation_targets <- c("target_games", validation_targets)
selected <- lapply(all_validation_targets, best_row)
names(selected) <- all_validation_targets

validate_component_total <- function(train_df, feature_sets, selected, complete_target_year) {
  target_df <- train_df[train_df$target_exists == 1, ]
  holdout_years <- sort(unique(target_df$target_year))
  holdout_years <- holdout_years[
    holdout_years >= max(min(holdout_years) + 4, complete_target_year - 4) &
      holdout_years <= complete_target_year
  ]
  off_target <- "target_delta_offense"
  def_target <- "target_delta_defense"
  off_features <- feature_sets[[selected[[off_target]]$model_set]]
  def_features <- feature_sets[[selected[[def_target]]$model_set]]
  actual_all <- numeric()
  pred_all <- numeric()
  used_years <- integer()
  for (holdout_year in holdout_years) {
    train_idx <- target_df$target_year < holdout_year
    holdout_idx <- target_df$target_year == holdout_year
    if (sum(train_idx) < 200 || sum(holdout_idx) < 50) next
    off_model <- train_model(target_df[train_idx, ], off_target, off_features, selected[[off_target]]$algorithm)
    def_model <- train_model(target_df[train_idx, ], def_target, def_features, selected[[def_target]]$algorithm)
    if (is.null(off_model) || is.null(def_model)) next
    off_pred <- target_df$offense[holdout_idx] + predict_model(off_model, target_df[holdout_idx, ], off_features)
    def_pred <- target_df$defense[holdout_idx] + predict_model(def_model, target_df[holdout_idx, ], def_features)
    pred <- off_pred + def_pred
    actual_all <- c(actual_all, target_df$target_total[holdout_idx])
    pred_all <- c(pred_all, pred)
    used_years <- c(used_years, holdout_year)
  }
  if (length(pred_all) == 0) return(NULL)
  m <- metrics(actual_all, pred_all)
  data.frame(
    algorithm = "derived",
    model_set = paste(selected[[off_target]]$model_set, selected[[def_target]]$model_set, sep = "+"),
    target = "target_total_from_components",
    holdout_years = paste(unique(used_years), collapse = "|"),
    n = m[["n"]],
    mae = m[["mae"]],
    rmse = m[["rmse"]],
    r2 = m[["r2"]],
    stringsAsFactors = FALSE
  )
}

validate_delta_level <- function(train_df, feature_sets, selected, metric, complete_target_year) {
  target <- paste0("target_delta_", metric)
  target_df <- train_df[train_df$target_exists == 1, ]
  holdout_years <- sort(unique(target_df$target_year))
  holdout_years <- holdout_years[
    holdout_years >= max(min(holdout_years) + 4, complete_target_year - 4) &
      holdout_years <= complete_target_year
  ]
  features <- feature_sets[[selected[[target]]$model_set]]
  actual_all <- numeric()
  pred_all <- numeric()
  used_years <- integer()
  for (holdout_year in holdout_years) {
    train_idx <- target_df$target_year < holdout_year
    holdout_idx <- target_df$target_year == holdout_year
    if (sum(train_idx) < 200 || sum(holdout_idx) < 50) next
    model <- train_model(target_df[train_idx, ], target, features, selected[[target]]$algorithm)
    if (is.null(model)) next
    pred <- target_df[[metric]][holdout_idx] + predict_model(model, target_df[holdout_idx, ], features)
    actual_all <- c(actual_all, target_df[[paste0("target_", metric)]][holdout_idx])
    pred_all <- c(pred_all, pred)
    used_years <- c(used_years, holdout_year)
  }
  if (length(pred_all) == 0) return(NULL)
  m <- metrics(actual_all, pred_all)
  data.frame(
    algorithm = selected[[target]]$algorithm,
    model_set = selected[[target]]$model_set,
    target = paste0("target_", metric, "_from_delta"),
    holdout_years = paste(unique(used_years), collapse = "|"),
    n = m[["n"]],
    mae = m[["mae"]],
    rmse = m[["rmse"]],
    r2 = m[["r2"]],
    stringsAsFactors = FALSE
  )
}

component_total_validation <- validate_component_total(train_df, feature_sets, selected, complete_target_year)
if (!is.null(component_total_validation)) {
  validation <- rbind(validation, component_total_validation)
}
delta_level_validations <- do.call(rbind, Filter(Negate(is.null), list(
  validate_delta_level(train_df, feature_sets, selected, "offense", complete_target_year),
  validate_delta_level(train_df, feature_sets, selected, "defense", complete_target_year)
)))
if (!is.null(delta_level_validations) && nrow(delta_level_validations)) {
  validation <- rbind(validation, delta_level_validations)
}

models <- list()
model_targets <- c("target_games", "target_minutes", "target_delta_offense", "target_delta_defense", paste0("target_", skill_names))
for (target in model_targets) {
  target_df <- train_df
  if (target == "target_games") {
    target_df <- gp_train_df
  } else if (target %in% validation_targets) {
    target_df <- target_df[target_df$target_exists == 1, ]
  }
  set_name <- selected[[target]]$model_set
  algorithm <- selected[[target]]$algorithm
  fitted_model <- train_model(target_df, target, feature_sets[[set_name]], algorithm)
  if (is.null(fitted_model)) stop("Could not train selected model for target: ", target)
  models[[target]] <- list(
    model = fitted_model,
    features = fitted_model$features,
    candidate_features = feature_sets[[set_name]],
    model_set = set_name,
    algorithm = algorithm
  )
}

latest <- panel[panel$year == max_year, ]
latest$position <- factor(latest$position, levels = levels(panel$position))
state <- latest
predictions <- list()
for (horizon in 1:5) {
  fallback_games <- clamp(coalesce_num(state$games_equiv, state$games), 0, 82)
  fallback_games[!is.finite(fallback_games)] <- 0
  fallback_mpg <- clamp(coalesce_num(state$adjusted_mpg, coalesce_num(state$mpg, ifelse(fallback_games > 0, state$minutes_equiv / fallback_games, 0))), 0, 38)
  fallback_mpg[!is.finite(fallback_mpg)] <- 0
  fallback_minutes <- fallback_games * fallback_mpg
  projected_games <- clamp(coalesce_num(
    predict_model(models$target_games$model, state, models$target_games$features),
    fallback_games
  ), 0, 82)
  projected_minutes <- clamp(coalesce_num(
    predict_model(models$target_minutes$model, state, models$target_minutes$features),
    fallback_minutes
  ), 0, 3300)
  projected_mpg <- clamp(ifelse(projected_games > 0, projected_minutes / projected_games, 0), 0, 38)
  projected_minutes <- projected_games * projected_mpg
  projected_offense <- clamp(state$offense + predict_model(models$target_delta_offense$model, state, models$target_delta_offense$features), -8, 10)
  projected_defense <- clamp(state$defense + predict_model(models$target_delta_defense$model, state, models$target_delta_defense$features), -8, 10)
  projected_total <- projected_offense + projected_defense
  projected_skills <- lapply(skill_names, function(skill_name) {
    target <- paste0("target_", skill_name)
    clamp(predict_model(models[[target]]$model, state, models[[target]]$features), -5, 5)
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

out_dir <- file.path(base_dir, "processed", "modelresults")
projection_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(projection_dir, recursive = TRUE, showWarnings = FALSE)
projection_output <- do.call(rbind, predictions)

model_card_targets <- c("target_games", "target_minutes", "target_total", "target_delta_offense", "target_delta_defense", paste0("target_", skill_names))
modeled_card_targets <- setdiff(model_card_targets, "target_total")
model_card <- data.frame(
  target = modeled_card_targets,
  selected_algorithm = vapply(modeled_card_targets, function(target) models[[target]]$algorithm, character(1)),
  selected_model_set = vapply(modeled_card_targets, function(target) models[[target]]$model_set, character(1)),
  holdout_rmse = vapply(modeled_card_targets, function(target) selected[[target]]$rmse, numeric(1)),
  holdout_r2 = vapply(modeled_card_targets, function(target) selected[[target]]$r2, numeric(1)),
  features = vapply(modeled_card_targets, function(target) paste(models[[target]]$features, collapse = "|"), character(1)),
  stringsAsFactors = FALSE
)
model_card$target[model_card$target == "target_delta_offense"] <- "target_offense"
model_card$target[model_card$target == "target_delta_defense"] <- "target_defense"
for (metric in c("offense", "defense")) {
  level_row <- validation[validation$target == paste0("target_", metric, "_from_delta"), , drop = FALSE]
  idx <- which(model_card$target == paste0("target_", metric))
  if (length(idx) == 1 && nrow(level_row) == 1) {
    model_card$holdout_rmse[idx] <- level_row$rmse
    model_card$holdout_r2[idx] <- level_row$r2
  }
}
if (!is.null(component_total_validation)) {
  total_card <- data.frame(
    target = "target_total",
    selected_algorithm = "derived",
    selected_model_set = "target_delta_offense+target_delta_defense",
    holdout_rmse = component_total_validation$rmse,
    holdout_r2 = component_total_validation$r2,
    features = paste(
      paste0("offense_delta:", paste(models$target_delta_offense$features, collapse = "|")),
      paste0("defense_delta:", paste(models$target_delta_defense$features, collapse = "|")),
      sep = ";"
    ),
    stringsAsFactors = FALSE
  )
  model_card <- rbind(
    model_card[model_card$target %in% c("target_games", "target_minutes"), , drop = FALSE],
    total_card,
    model_card[!(model_card$target %in% c("target_games", "target_minutes")), , drop = FALSE]
  )
}

selected_terms <- do.call(rbind, lapply(model_targets, function(target) {
  model <- models[[target]]$model
  if (model$algorithm == "lm") {
    coefs <- coef(model$fit)
    return(data.frame(
      target = target,
      algorithm = "lm",
      term = names(coefs),
      estimate = as.numeric(coefs),
      stringsAsFactors = FALSE
    ))
  }
  if (model$algorithm == "ranger" && !is.null(model$fit$variable.importance)) {
    importance <- sort(model$fit$variable.importance, decreasing = TRUE)
    return(data.frame(
      target = target,
      algorithm = "ranger",
      term = names(importance),
      estimate = as.numeric(importance),
      stringsAsFactors = FALSE
    ))
  }
  data.frame(target = target, algorithm = model$algorithm, term = character(), estimate = numeric(), stringsAsFactors = FALSE)
}))

saveRDS(
  list(
    models = models,
    feature_sets = feature_sets,
    gp_feature_sets = gp_feature_sets,
    target_feature_sets = target_feature_sets,
    selected = selected,
    component_total_validation = component_total_validation,
    model_targets = model_targets,
    trained_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    latest_year = max_year,
    complete_target_year = complete_target_year,
    latest_is_partial = latest_is_partial
  ),
  file.path(out_dir, "career_projection_models.rds")
)
write.csv(validation, file.path(out_dir, "career_projection_validation.csv"), row.names = FALSE, na = "")
write.csv(model_card, file.path(out_dir, "career_projection_model_card.csv"), row.names = FALSE, na = "")
write.csv(selected_terms, file.path(out_dir, "career_projection_selected_terms.csv"), row.names = FALSE, na = "")
write.csv(projection_output, file.path(projection_dir, "player_career_projections.csv"), row.names = FALSE, na = "")

message("Recursive one-year career projection models trained.")
message("Model card: ", file.path(out_dir, "career_projection_model_card.csv"))
message("Validation: ", file.path(out_dir, "career_projection_validation.csv"))
message("Predictions: ", file.path(projection_dir, "player_career_projections.csv"))
