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

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}

attach_contract_ids_from_history <- function(base_dir, contracts) {
  if (!("nba_id" %in% names(contracts)) || !("player_name" %in% names(contracts))) {
    return(contracts)
  }

  missing_id <- is.na(suppressWarnings(as.integer(contracts$nba_id)))
  if (!any(missing_id)) {
    return(contracts)
  }

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (!file.exists(stats_path)) {
    return(contracts)
  }

  stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
  name_col <- names(stats)[names(stats) %in% c("player_name", "player", "PLAYER_NAME", "name", "Name")][1]
  if (!all(c("nba_id") %in% names(stats)) || is.na(name_col)) {
    return(contracts)
  }

  players <- data.frame(
    nba_id = suppressWarnings(as.integer(stats$nba_id)),
    name_key = normalize_name(stats[[name_col]]),
    stringsAsFactors = FALSE
  )
  players <- players[!is.na(players$nba_id) & players$name_key != "", ]
  counts <- aggregate(players$nba_id, by = list(name_key = players$name_key), FUN = function(v) length(unique(v)))
  names(counts)[2] <- "id_count"
  players <- merge(players, counts, by = "name_key", all.x = TRUE)
  players <- players[players$id_count == 1, c("name_key", "nba_id"), drop = FALSE]
  players <- players[!duplicated(players$name_key), ]

  key <- normalize_name(contracts$player_name)
  matched <- players$nba_id[match(key, players$name_key)]
  contracts$nba_id[missing_id & !is.na(matched)] <- matched[missing_id & !is.na(matched)]
  contracts
}

load_current_contracts <- function(base_dir) {
  contract_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  current_files <- list.files(contract_dir, pattern = "^contracts_[0-9]{4}_current\\.csv$", full.names = TRUE)
  if (length(current_files) == 0) {
    return(data.frame(nba_id = integer(), contract_player_name = character(), contract_team = character(), contract = numeric()))
  }

  current_years <- suppressWarnings(as.integer(sub("^contracts_([0-9]{4})_current\\.csv$", "\\1", basename(current_files))))
  path <- current_files[order(current_years, decreasing = TRUE)][1]
  contracts <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("nba_id", "player_name", "team", "salary_y0") %in% names(contracts))) {
    return(data.frame(nba_id = integer(), contract_player_name = character(), contract_team = character(), contract = numeric()))
  }

  contracts <- attach_contract_ids_from_history(base_dir, contracts)
  out <- data.frame(
    nba_id = suppressWarnings(as.integer(contracts$nba_id)),
    contract_player_name = as.character(contracts$player_name),
    contract_team = as.character(contracts$team),
    contract = suppressWarnings(as.numeric(contracts$salary_y0)),
    rank = if ("rank" %in% names(contracts)) suppressWarnings(as.numeric(contracts$rank)) else seq_len(nrow(contracts)),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$nba_id) & !is.na(out$contract) & out$contract > 0, ]
  out <- out[order(out$nba_id, out$rank, -out$contract), ]
  out <- out[!duplicated(out$nba_id), ]
  out[, c("nba_id", "contract_player_name", "contract_team", "contract"), drop = FALSE]
}

append_latest_contract_inactive_rows <- function(panel, base_dir) {
  latest_year <- max(panel$year, na.rm = TRUE)
  contracts <- load_current_contracts(base_dir)
  if (nrow(contracts) == 0) {
    return(panel)
  }

  current_ids <- unique(panel$nba_id[panel$year == latest_year])
  missing_contracts <- contracts[!(contracts$nba_id %in% current_ids), , drop = FALSE]
  if (nrow(missing_contracts) == 0) {
    return(panel)
  }

  prior <- panel[panel$year < latest_year & panel$nba_id %in% missing_contracts$nba_id, , drop = FALSE]
  if (nrow(prior) == 0) {
    return(panel)
  }

  prior <- prior[order(prior$nba_id, -prior$year), ]
  prior <- prior[!duplicated(prior$nba_id), , drop = FALSE]
  contract_match <- match(prior$nba_id, missing_contracts$nba_id)
  year_delta <- latest_year - prior$year

  prior$player_name <- ifelse(
    !is.na(missing_contracts$contract_player_name[contract_match]) & missing_contracts$contract_player_name[contract_match] != "",
    missing_contracts$contract_player_name[contract_match],
    prior$player_name
  )
  prior$year <- latest_year
  prior$age <- suppressWarnings(as.numeric(prior$age)) + year_delta
  prior$yoe <- suppressWarnings(as.numeric(prior$yoe)) + year_delta
  prior$games <- 0
  prior$stat_minutes <- 0
  prior$minutes <- 0
  prior$games_equiv <- 0
  prior$minutes_equiv <- 0
  prior$season_max_games <- max(panel$games[panel$year == latest_year], na.rm = TRUE)
  prior$season_games_factor <- ifelse(is.finite(prior$season_max_games) & prior$season_max_games > 0, 82 / prior$season_max_games, 1)

  rbind(panel, prior[, names(panel), drop = FALSE])
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

train_model <- function(df, target, features, algorithm) {
  model_df <- prepare_model_df(df, target, features)
  formula <- as.formula(paste(target, "~ ."))
  if (algorithm == "lm") {
    return(list(algorithm = algorithm, fit = lm(formula, data = model_df)))
  }
  if (algorithm == "rpart") {
    if (!requireNamespace("rpart", quietly = TRUE)) return(NULL)
    return(list(
      algorithm = algorithm,
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
        mtry = max(2, floor(sqrt(length(features)))),
        min.node.size = 12,
        seed = 42,
        importance = "permutation"
      )
    ))
  }
  NULL
}

predict_model <- function(model, df, features) {
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
  for (metric in c("total", "games_equiv", "mpg", "minutes_equiv")) {
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

  stats <- stats[, intersect(c("nba_id", "year", "Age", "draft_year", "Pos2", "GamesPlayed", "MPG", "Minutes"), names(stats)), drop = FALSE]
  names(stats)[names(stats) == "Age"] <- "age"
  names(stats)[names(stats) == "Pos2"] <- "position"
  names(stats)[names(stats) == "GamesPlayed"] <- "games"
  names(stats)[names(stats) == "MPG"] <- "mpg"
  names(stats)[names(stats) == "Minutes"] <- "stat_minutes"

  panel <- merge(
    skill[, c("nba_id", "player_name", "year", "offense", "defense", "total")],
    stats,
    by = c("nba_id", "year"),
    all.x = TRUE
  )
  panel$position <- factor(ifelse(is.na(panel$position) | panel$position == "", "UNK", panel$position))
  panel$age <- suppressWarnings(as.numeric(panel$age))
  panel$draft_year <- suppressWarnings(as.numeric(panel$draft_year))
  panel$yoe <- ifelse(!is.na(panel$draft_year), pmax(0, panel$year - panel$draft_year), NA_real_)
  panel$games <- suppressWarnings(as.numeric(panel$games))
  panel$mpg <- suppressWarnings(as.numeric(panel$mpg))
  panel$minutes <- coalesce_num(suppressWarnings(as.numeric(panel$stat_minutes)), panel$games * panel$mpg)
  panel$season_max_games <- ave(panel$games, panel$year, FUN = function(v) max(v, na.rm = TRUE))
  panel$season_games_factor <- ifelse(is.finite(panel$season_max_games) & panel$season_max_games > 0, 82 / panel$season_max_games, 1)
  panel$games_equiv <- clamp(panel$games * panel$season_games_factor, 0, 82)
  panel$minutes_equiv <- clamp(panel$minutes * panel$season_games_factor, 0, 3300)
  panel <- append_latest_contract_inactive_rows(panel, base_dir)

  panel <- panel[order(panel$nba_id, panel$year), ]
  panel$age_sq <- panel$age^2
  panel <- add_history_features(panel)
  prev <- panel[, c("nba_id", "year", "total", "games_equiv", "mpg", "minutes_equiv")]
  prev$year <- prev$year + 1
  names(prev)[-1] <- paste0("prev_", names(prev)[-1])
  panel <- merge(panel, prev, by.x = c("nba_id", "year"), by.y = c("nba_id", "prev_year"), all.x = TRUE)
  panel$has_prev <- ifelse(is.na(panel$prev_total), 0, 1)
  panel$delta_total <- panel$total - panel$prev_total
  panel$delta_mpg <- panel$mpg - panel$prev_mpg
  panel$delta_games <- panel$games_equiv - panel$prev_games_equiv
  for (nm in c("prev_total", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_total", "delta_mpg", "delta_games")) {
    panel[[nm]][is.na(panel[[nm]])] <- 0
  }
  panel
}

make_one_year_rows <- function(panel) {
  future <- panel[, c("nba_id", "year", "offense", "defense", "total", "games_equiv", "mpg", "minutes_equiv")]
  future$source_year <- future$year - 1
  names(future)[names(future) %in% c("offense", "defense", "total", "games_equiv", "mpg", "minutes_equiv")] <-
    paste0("target_", names(future)[names(future) %in% c("offense", "defense", "total", "games_equiv", "mpg", "minutes_equiv")])
  names(future)[names(future) == "target_games_equiv"] <- "target_games"
  names(future)[names(future) == "target_minutes_equiv"] <- "target_minutes"
  out <- merge(
    panel,
    future[, c("nba_id", "source_year", "target_offense", "target_defense", "target_total", "target_games", "target_mpg", "target_minutes")],
    by.x = c("nba_id", "year"),
    by.y = c("nba_id", "source_year"),
    all.x = TRUE
  )
  out$target_exists <- ifelse(is.na(out$target_games), 0, 1)
  out$target_games <- ifelse(is.na(out$target_games), 0, out$target_games)
  out$target_mpg <- ifelse(is.na(out$target_mpg), 0, out$target_mpg)
  out$target_minutes <- ifelse(is.na(out$target_minutes), 0, out$target_minutes)
  out$target_year <- out$year + 1
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
  usage_history = c("age", "age_sq", "yoe", "games_equiv", "mpg", "minutes_equiv", "avg2_games_equiv", "avg3_games_equiv", "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv", "has_prev", "prev_total", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_mpg", "delta_games"),
  blended_history = c("age", "age_sq", "yoe", "games_equiv", "mpg", "minutes_equiv", "total", "avg2_total", "avg3_total", "avg2_games_equiv", "avg3_games_equiv", "avg2_mpg", "avg3_mpg", "avg2_minutes_equiv", "avg3_minutes_equiv", "has_prev", "prev_total", "prev_games_equiv", "prev_mpg", "prev_minutes_equiv", "delta_total", "delta_mpg", "delta_games")
)

target_feature_sets <- list(
  target_games = c("gp_reference_shape", "usage_history", "blended_history"),
  target_mpg = c("mpg_reference_shape", "usage_history", "blended_history"),
  target_total = c("total_reference_shape", "usage_history", "blended_history")
)

algorithms <- c("lm", "rpart", "ranger")
targets <- c("target_mpg", "target_total")
validation <- data.frame()
for (target in targets) {
  target_df <- train_df
  if (target %in% c("target_games", "target_mpg", "target_total")) target_df <- target_df[target_df$target_exists == 1, ]
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

all_targets <- c("target_games", targets)
selected <- lapply(all_targets, best_row)
names(selected) <- all_targets

models <- list()
for (target in all_targets) {
  target_df <- train_df
  if (target == "target_games") {
    target_df <- gp_train_df
  } else if (target %in% c("target_mpg", "target_total")) {
    target_df <- target_df[target_df$target_exists == 1, ]
  }
  set_name <- selected[[target]]$model_set
  algorithm <- selected[[target]]$algorithm
  models[[target]] <- list(
    model = train_model(target_df, target, feature_sets[[set_name]], algorithm),
    features = feature_sets[[set_name]],
    model_set = set_name,
    algorithm = algorithm
  )
}

latest <- panel[panel$year == max_year, ]
latest$position <- factor(latest$position, levels = levels(panel$position))
state <- latest
predictions <- list()
for (horizon in 1:5) {
  projected_games <- clamp(predict_model(models$target_games$model, state, models$target_games$features), 0, 82)
  projected_mpg <- clamp(predict_model(models$target_mpg$model, state, models$target_mpg$features), 0, 38)
  projected_total <- clamp(predict_model(models$target_total$model, state, models$target_total$features), -8, 10)
  projected_minutes <- projected_games * projected_mpg

  predictions[[horizon]] <- data.frame(
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
    stringsAsFactors = FALSE
  )

  old_total <- state$total
  old_games <- state$games_equiv
  old_mpg <- state$mpg
  old_minutes <- state$minutes_equiv

  state$age <- state$age + 1
  state$age_sq <- state$age^2
  state$yoe <- state$yoe + 1
  state$prev_total <- old_total
  state$prev_games_equiv <- old_games
  state$prev_mpg <- old_mpg
  state$prev_minutes_equiv <- old_minutes
  state$lag2_total <- state$lag1_total
  state$lag1_total <- old_total
  state$lag2_games_equiv <- state$lag1_games_equiv
  state$lag1_games_equiv <- old_games
  state$lag2_mpg <- state$lag1_mpg
  state$lag1_mpg <- old_mpg
  state$lag2_minutes_equiv <- state$lag1_minutes_equiv
  state$lag1_minutes_equiv <- old_minutes
  state$total <- projected_total
  state$offense <- projected_total * 0.55
  state$defense <- projected_total * 0.45
  state$games <- projected_games
  state$games_equiv <- projected_games
  state$mpg <- projected_mpg
  state$minutes <- projected_minutes
  state$minutes_equiv <- projected_minutes
  state$delta_total <- state$total - state$prev_total
  state$delta_mpg <- state$mpg - state$prev_mpg
  state$delta_games <- state$games_equiv - state$prev_games_equiv
  state$avg2_total <- rowMeans(cbind(state$total, state$lag1_total), na.rm = TRUE)
  state$avg3_total <- rowMeans(cbind(state$total, state$lag1_total, state$lag2_total), na.rm = TRUE)
  state$avg2_games_equiv <- rowMeans(cbind(state$games_equiv, state$lag1_games_equiv), na.rm = TRUE)
  state$avg3_games_equiv <- rowMeans(cbind(state$games_equiv, state$lag1_games_equiv, state$lag2_games_equiv), na.rm = TRUE)
  state$avg2_mpg <- rowMeans(cbind(state$mpg, state$lag1_mpg), na.rm = TRUE)
  state$avg3_mpg <- rowMeans(cbind(state$mpg, state$lag1_mpg, state$lag2_mpg), na.rm = TRUE)
  state$avg2_minutes_equiv <- rowMeans(cbind(state$minutes_equiv, state$lag1_minutes_equiv), na.rm = TRUE)
  state$avg3_minutes_equiv <- rowMeans(cbind(state$minutes_equiv, state$lag1_minutes_equiv, state$lag2_minutes_equiv), na.rm = TRUE)
  state$has_prev <- 1
}

out_dir <- file.path(base_dir, "processed", "modelresults")
projection_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(projection_dir, recursive = TRUE, showWarnings = FALSE)
projection_output <- do.call(rbind, predictions)

model_card <- data.frame(
  target = all_targets,
  selected_algorithm = vapply(all_targets, function(target) models[[target]]$algorithm, character(1)),
  selected_model_set = vapply(all_targets, function(target) models[[target]]$model_set, character(1)),
  holdout_rmse = vapply(all_targets, function(target) selected[[target]]$rmse, numeric(1)),
  holdout_r2 = vapply(all_targets, function(target) selected[[target]]$r2, numeric(1)),
  features = vapply(all_targets, function(target) paste(models[[target]]$features, collapse = "|"), character(1)),
  stringsAsFactors = FALSE
)

selected_terms <- do.call(rbind, lapply(all_targets, function(target) {
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
