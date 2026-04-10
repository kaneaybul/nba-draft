if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")
if (!requireNamespace("ranger", quietly = TRUE)) install.packages("ranger")
if (!requireNamespace("glmnet", quietly = TRUE)) install.packages("glmnet")

library(data.table)
library(ranger)
library(glmnet)

# Reconstructed from session history after the original draft pipeline files were deleted.

get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    script_path <- sub(file_arg, "", script_arg[[1]])
    return(dirname(normalizePath(script_path, winslash = "/", mustWork = FALSE)))
  }

  ofile <- NULL
  frame_list <- sys.frames()
  if (length(frame_list) > 0) {
    for (i in rev(seq_along(frame_list))) {
      if (!is.null(frame_list[[i]]$ofile)) {
        ofile <- frame_list[[i]]$ofile
        break
      }
    }
  }

  if (!is.null(ofile)) {
    return(dirname(normalizePath(ofile, winslash = "/", mustWork = FALSE)))
  }

  NULL
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- c(
    getwd(),
    if (!is.null(script_dir)) script_dir else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..") else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..", "..") else NULL,
    file.path(getwd(), ".."),
    file.path(getwd(), "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  )

  candidates <- unique(candidates[!is.na(candidates) & nzchar(candidates)])
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

anglicize_text <- function(x) {
  raw_x <- as.character(x)
  safe_x <- suppressWarnings(iconv(raw_x, from = "UTF-8", to = "UTF-8", sub = ""))
  fill_idx <- is.na(safe_x) & !is.na(raw_x)
  safe_x[fill_idx] <- raw_x[fill_idx]
  converted <- suppressWarnings(iconv(safe_x, from = "", to = "ASCII//TRANSLIT", sub = ""))
  fill_idx <- is.na(converted) & !is.na(safe_x)
  converted[fill_idx] <- safe_x[fill_idx]
  trimws(converted)
}

normalize_join_name <- function(x) {
  x <- anglicize_text(x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

add_alias_columns <- function(df) {
  alias_pairs <- list(
    "X3PA_100" = c("3PA_100", "3pa_100"),
    "X3P_PERC" = c("3P_PERC", "3p_perc"),
    "X3PA"     = c("3PA", "three_a"),
    "X3P"      = c("3P", "three_m")
  )

  for (target_name in names(alias_pairs)) {
    source_candidates <- alias_pairs[[target_name]]
    source_name <- source_candidates[source_candidates %in% names(df)][1]
    if (!(target_name %in% names(df)) && !is.na(source_name) && nzchar(source_name)) {
      df[[target_name]] <- df[[source_name]]
    }
  }

  df
}

coalesce_numeric_columns <- function(df, target_name, source_candidates) {
  source_candidates <- source_candidates[source_candidates %in% names(df)]
  if (!length(source_candidates)) {
    return(df)
  }

  target_vals <- if (target_name %in% names(df)) suppressWarnings(as.numeric(df[[target_name]])) else rep(NA_real_, nrow(df))
  for (source_name in source_candidates) {
    source_vals <- suppressWarnings(as.numeric(df[[source_name]]))
    fill_idx <- !is.finite(target_vals) & is.finite(source_vals)
    target_vals[fill_idx] <- source_vals[fill_idx]
  }

  df[[target_name]] <- target_vals
  df
}

derive_per36_from_pairs <- function(df, target_name, source_minute_pairs) {
  target_vals <- if (target_name %in% names(df)) suppressWarnings(as.numeric(df[[target_name]])) else rep(NA_real_, nrow(df))

  for (pair in source_minute_pairs) {
    source_name <- pair[[1]]
    minute_name <- pair[[2]]
    if (!(source_name %in% names(df)) || !(minute_name %in% names(df))) {
      next
    }

    source_vals <- suppressWarnings(as.numeric(df[[source_name]]))
    minute_vals <- suppressWarnings(as.numeric(df[[minute_name]]))
    derived_vals <- ifelse(
      is.finite(source_vals) & is.finite(minute_vals) & minute_vals > 0,
      36 * source_vals / minute_vals,
      NA_real_
    )

    fill_idx <- !is.finite(target_vals) & is.finite(derived_vals)
    target_vals[fill_idx] <- derived_vals[fill_idx]
  }

  df[[target_name]] <- target_vals
  df
}

add_curated_realgm_features <- function(df) {
  df <- coalesce_numeric_columns(df, "rate_fg_pct", c("sum_fg_pct", "tot_fg_pct", "adv_fg_pct"))
  df <- coalesce_numeric_columns(df, "rate_x3p_pct", c("sum_x3p_pct", "tot_x3p_pct", "adv_x3p_pct"))
  df <- coalesce_numeric_columns(df, "rate_ft_pct", c("sum_ft_pct", "tot_ft_pct", "adv_ft_pct"))
  df <- derive_per36_from_pairs(df, "per36_x3pm", list(
    c("adv_xx3pm", "adv_min"),
    c("tot_xx3pm", "tot_min"),
    c("sum_xx3pm", "sum_min")
  ))
  df <- derive_per36_from_pairs(df, "per36_x3pa", list(
    c("adv_xx3pa", "adv_min"),
    c("tot_xx3pa", "tot_min"),
    c("sum_xx3pa", "sum_min")
  ))
  df
}

load_scv_draft_lookup <- function(path) {
  if (!file.exists(path)) {
    return(NULL)
  }

  scv_dt <- tryCatch(
    fread(path, na.strings = c("", "NA", "N/A", "NaN")),
    error = function(e) NULL
  )
  if (is.null(scv_dt) || !nrow(scv_dt) || !"name" %in% names(scv_dt)) {
    return(NULL)
  }

  score_col <- names(scv_dt)[tolower(names(scv_dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(NULL)
  }

  scv_dt[, join_player := normalize_join_name(name)]
  scv_dt[, scv_draft := suppressWarnings(as.numeric(get(score_col)))]
  scv_dt <- scv_dt[nzchar(join_player) & is.finite(scv_draft)]
  if (!nrow(scv_dt)) {
    return(NULL)
  }

  setorder(scv_dt, join_player, scv_draft)
  unique(scv_dt[, .(join_player, scv_draft)], by = "join_player")
}

add_scv_draft_feature <- function(df, scv_lookup) {
  if (is.null(scv_lookup) || !nrow(scv_lookup) || !"player" %in% names(df) || !nrow(df)) {
    return(df)
  }

  df_dt <- as.data.table(copy(df))
  df_dt[, row_id___ := seq_len(.N)]
  df_dt[, join_player___ := normalize_join_name(player)]
  merged_dt <- merge(df_dt, copy(scv_lookup), by.x = "join_player___", by.y = "join_player", all.x = TRUE, sort = FALSE)
  setorder(merged_dt, row_id___)

  if ("scv_draft.x" %in% names(merged_dt) || "scv_draft.y" %in% names(merged_dt)) {
    current_vals <- if ("scv_draft.x" %in% names(merged_dt)) suppressWarnings(as.numeric(merged_dt[["scv_draft.x"]])) else rep(NA_real_, nrow(merged_dt))
    lookup_vals <- if ("scv_draft.y" %in% names(merged_dt)) suppressWarnings(as.numeric(merged_dt[["scv_draft.y"]])) else rep(NA_real_, nrow(merged_dt))
    merged_dt[, scv_draft := ifelse(is.finite(current_vals), current_vals, lookup_vals)]
    merged_dt[, c("scv_draft.x", "scv_draft.y") := NULL]
  }

  merged_dt[, c("row_id___", "join_player___") := NULL]
  as.data.frame(merged_dt)
}

mode_value <- function(x) {
  x <- x[!is.na(x)]
  if (length(x) == 0) return(NA)
  ux <- unique(x)
  ux[[which.max(tabulate(match(x, ux)))]]
}

roughfix_df <- function(df) {
  for (nm in names(df)) {
    if (is.numeric(df[[nm]]) || is.integer(df[[nm]])) {
      med <- suppressWarnings(median(df[[nm]], na.rm = TRUE))
      if (!is.finite(med)) med <- 0
      df[[nm]][is.na(df[[nm]])] <- med
    } else if (is.logical(df[[nm]])) {
      numeric_vals <- suppressWarnings(as.numeric(df[[nm]]))
      med <- suppressWarnings(median(numeric_vals, na.rm = TRUE))
      if (!is.finite(med)) med <- 0
      numeric_vals[is.na(numeric_vals)] <- med
      df[[nm]] <- numeric_vals
    } else if (is.factor(df[[nm]])) {
      fill <- mode_value(df[[nm]])
      if (is.na(fill)) {
        levels(df[[nm]]) <- c(levels(df[[nm]]), "unknown")
        fill <- "unknown"
      }
      df[[nm]][is.na(df[[nm]])] <- fill
    } else if (is.character(df[[nm]])) {
      fill <- mode_value(df[[nm]])
      if (is.na(fill) || identical(fill, "")) fill <- "unknown"
      df[[nm]][is.na(df[[nm]]) | df[[nm]] == ""] <- fill
      df[[nm]] <- factor(df[[nm]])
    }
  }
  df
}

build_preprocess_recipe <- function(df, cols) {
  cols <- unique(cols[cols %in% names(df)])
  if (!length(cols)) {
    return(list(numeric_fill = list()))
  }

  numeric_cols <- cols[vapply(df[, cols, drop = FALSE], function(x) {
    is.numeric(x) || is.integer(x) || is.logical(x)
  }, logical(1))]

  numeric_fill <- lapply(numeric_cols, function(col_name) {
    vals <- suppressWarnings(as.numeric(df[[col_name]]))
    med <- suppressWarnings(median(vals, na.rm = TRUE))
    if (!is.finite(med)) med <- 0
    med
  })
  names(numeric_fill) <- numeric_cols

  list(numeric_fill = numeric_fill)
}

apply_preprocess_recipe <- function(df, recipe) {
  if (is.null(recipe) || !length(recipe$numeric_fill)) {
    return(as.data.frame(df))
  }

  df <- as.data.frame(df)
  for (col_name in names(recipe$numeric_fill)) {
    if (!col_name %in% names(df)) next
    vals <- suppressWarnings(as.numeric(df[[col_name]]))
    fill_value <- recipe$numeric_fill[[col_name]]
    vals[!is.finite(vals)] <- fill_value
    df[[col_name]] <- vals
  }

  df
}

resolve_prediction_join_id <- function(df, candidate_cols = c("id", "player_id")) {
  if (!nrow(df)) return(character())

  join_id <- rep(NA_character_, nrow(df))
  for (col_name in candidate_cols) {
    if (!col_name %in% names(df)) next
    candidate_vals <- trimws(as.character(df[[col_name]]))
    candidate_vals[candidate_vals == ""] <- NA_character_
    fill_idx <- is.na(join_id) & !is.na(candidate_vals)
    join_id[fill_idx] <- candidate_vals[fill_idx]
  }
  join_id
}

calc_r2 <- function(actual, predicted) {
  keep <- is.finite(actual) & is.finite(predicted)
  actual <- actual[keep]
  predicted <- predicted[keep]
  if (!length(actual)) return(NA_real_)
  denom <- sum((actual - mean(actual))^2)
  if (!is.finite(denom) || denom <= 0) return(NA_real_)
  1 - sum((actual - predicted)^2) / denom
}

calc_mse <- function(actual, predicted) {
  keep <- is.finite(actual) & is.finite(predicted)
  actual <- actual[keep]
  predicted <- predicted[keep]
  if (!length(actual)) return(NA_real_)
  mean((actual - predicted)^2)
}

make_year_foldid <- function(df) {
  train_years <- suppressWarnings(as.integer(df$draft_year))
  year_groups <- sort(unique(train_years[is.finite(train_years)]))
  if (length(year_groups) < 2L) return(NULL)
  match(train_years, year_groups)
}

build_temporal_validation_splits <- function(train_df, min_train_rows = 20L, min_validation_rows = 3L, min_train_years = 3L) {
  train_years <- suppressWarnings(as.integer(train_df$draft_year))
  draft_years <- sort(unique(train_years[is.finite(train_years)]))
  if (length(draft_years) < 2L) return(list())

  split_list <- list()
  split_idx <- 1L
  for (validation_year in draft_years[-1L]) {
    train_idx <- which(is.finite(train_years) & train_years < validation_year)
    validation_idx <- which(is.finite(train_years) & train_years == validation_year)
    if (length(train_idx) < min_train_rows || length(validation_idx) < min_validation_rows) next
    if (length(unique(train_years[train_idx])) < min_train_years) next

    split_list[[split_idx]] <- list(
      validation_year = validation_year,
      train_idx = train_idx,
      validation_idx = validation_idx
    )
    split_idx <- split_idx + 1L
  }

  split_list
}

get_correlation_guard_threshold <- function() {
  threshold <- suppressWarnings(as.numeric(Sys.getenv("DRAFT_CORR_GUARD_THRESHOLD", "0.8")))
  if (!is.finite(threshold) || threshold <= 0 || threshold >= 1) threshold <- 0.8
  threshold
}

apply_correlation_guard <- function(train_df, ranked_preds, threshold, anchor_preds = character()) {
  ranked_preds <- unique(ranked_preds[nzchar(ranked_preds)])
  if (!length(ranked_preds) || !is.finite(threshold)) return(ranked_preds)

  numeric_preds <- ranked_preds[ranked_preds %in% names(train_df)]
  if (length(numeric_preds) <= 1L) return(ranked_preds)

  corr_df <- train_df[, numeric_preds, drop = FALSE]
  corr_df[] <- lapply(corr_df, function(x) suppressWarnings(as.numeric(x)))
  corr_mat <- suppressWarnings(cor(corr_df, use = "pairwise.complete.obs"))
  if (length(corr_mat) <= 1L || !all(dim(corr_mat) >= 1L)) return(ranked_preds)

  selected <- character()
  locked <- intersect(anchor_preds, ranked_preds)

  for (pred in ranked_preds) {
    if (!pred %in% rownames(corr_mat)) {
      selected <- c(selected, pred)
      next
    }
    if (!length(selected)) {
      selected <- c(selected, pred)
      next
    }

    selected_in_corr <- intersect(selected, colnames(corr_mat))
    if (!length(selected_in_corr)) {
      selected <- c(selected, pred)
      next
    }

    candidate_corr <- suppressWarnings(as.numeric(corr_mat[pred, selected_in_corr]))
    over_limit <- selected_in_corr[is.finite(candidate_corr) & abs(candidate_corr) > threshold]

    if (!length(over_limit)) {
      selected <- c(selected, pred)
      next
    }

    if (length(intersect(over_limit, locked))) {
      next
    }
  }

  selected
}

compute_selected_feature_stability <- function(stability_dt, selected_preds) {
  if (is.null(stability_dt) || !nrow(stability_dt) || !length(selected_preds)) {
    return(list(mean_frequency = NA_real_, min_frequency = NA_real_))
  }

  selected_dt <- stability_dt[variable %in% selected_preds]
  if (!nrow(selected_dt)) {
    return(list(mean_frequency = NA_real_, min_frequency = NA_real_))
  }

  list(
    mean_frequency = mean(selected_dt$selection_frequency, na.rm = TRUE),
    min_frequency = min(selected_dt$selection_frequency, na.rm = TRUE)
  )
}

default_history_path <- function(summary_path) {
  paste0(tools::file_path_sans_ext(summary_path), "_history.csv")
}

compute_prior_run_stability <- function(summary_df, history_fp) {
  if (!file.exists(history_fp)) {
    summary_df[, `:=`(
      prior_run_id = NA_character_,
      prior_feature_overlap_pct = NA_real_,
      prior_exact_feature_match = NA,
      prior_metric_delta = NA_real_
    )]
    return(summary_df)
  }

  history_dt <- tryCatch(fread(history_fp, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
  if (is.null(history_dt) || !nrow(history_dt) || !"run_id" %in% names(history_dt) || !"skill" %in% names(history_dt)) {
    summary_df[, `:=`(
      prior_run_id = NA_character_,
      prior_feature_overlap_pct = NA_real_,
      prior_exact_feature_match = NA,
      prior_metric_delta = NA_real_
    )]
    return(summary_df)
  }

  latest_run_id <- tail(history_dt$run_id[!is.na(history_dt$run_id) & nzchar(history_dt$run_id)], 1)
  if (!length(latest_run_id)) {
    summary_df[, `:=`(
      prior_run_id = NA_character_,
      prior_feature_overlap_pct = NA_real_,
      prior_exact_feature_match = NA,
      prior_metric_delta = NA_real_
    )]
    return(summary_df)
  }

  prior_dt <- history_dt[run_id == latest_run_id]
  merged_dt <- merge(
    summary_df,
    prior_dt[, .(skill, prior_run_id = run_id, prior_predictors = predictors, prior_metric_value = search_metric_value)],
    by = "skill",
    all.x = TRUE,
    sort = FALSE
  )

  merged_dt[, prior_feature_overlap_pct := vapply(seq_len(.N), function(i) {
    current_preds <- trimws(unlist(strsplit(as.character(predictors[[i]]), ",", fixed = TRUE)))
    current_preds <- current_preds[nzchar(current_preds)]
    previous_preds <- trimws(unlist(strsplit(as.character(prior_predictors[[i]]), ",", fixed = TRUE)))
    previous_preds <- previous_preds[nzchar(previous_preds)]
    union_preds <- union(current_preds, previous_preds)
    if (!length(union_preds)) return(NA_real_)
    100 * length(intersect(current_preds, previous_preds)) / length(union_preds)
  }, numeric(1))]

  merged_dt[, prior_exact_feature_match := vapply(seq_len(.N), function(i) {
    current_preds <- trimws(unlist(strsplit(as.character(predictors[[i]]), ",", fixed = TRUE)))
    current_preds <- current_preds[nzchar(current_preds)]
    previous_preds <- trimws(unlist(strsplit(as.character(prior_predictors[[i]]), ",", fixed = TRUE)))
    previous_preds <- previous_preds[nzchar(previous_preds)]
    identical(current_preds, previous_preds)
  }, logical(1))]

  merged_dt[, prior_metric_delta := suppressWarnings(as.numeric(search_metric_value) - as.numeric(prior_metric_value))]
  merged_dt[, c("prior_predictors", "prior_metric_value") := NULL]
  merged_dt
}

append_summary_history <- function(summary_df, history_fp, run_id) {
  history_append <- copy(summary_df)
  history_append[, run_id := as.character(run_id)]
  history_append[, run_timestamp := format(Sys.time(), "%Y-%m-%d %H:%M:%S")]

  if (file.exists(history_fp)) {
    existing_dt <- tryCatch(fread(history_fp, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
    if (!is.null(existing_dt) && nrow(existing_dt)) {
      history_append <- rbindlist(list(existing_dt, history_append), use.names = TRUE, fill = TRUE)
    }
  }

  fwrite(history_append, history_fp, na = "")
}

refresh_training_targets <- function(training_dt, skill_dt) {
  skill_cols <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  raw_skill_cols <- paste0(skill_cols, "_raw")
  available_skill_cols <- skill_cols[skill_cols %in% names(skill_dt) | raw_skill_cols %in% names(skill_dt)]
  if (!length(available_skill_cols)) {
    warning("No skill target columns found in skilloutput.csv - keeping existing training data targets.")
    return(training_dt)
  }

  if (!all(c("nba_id", "outcome_year") %in% names(training_dt))) {
    warning("draft_training_data.csv lacks nba_id/outcome_year - keeping existing training data targets.")
    return(training_dt)
  }

  if (!"year" %in% names(skill_dt)) {
    warning("skilloutput.csv lacks year column - keeping existing training data targets.")
    return(training_dt)
  }

  skill_join_dt <- copy(skill_dt)
  skill_join_dt[, nba_id := as.character(nba_id)]
  skill_join_dt[, outcome_year := suppressWarnings(as.integer(year))]
  for (skill in available_skill_cols) {
    raw_col <- paste0(skill, "_raw")
    source_col <- if (raw_col %in% names(skill_join_dt)) raw_col else skill
    skill_join_dt[[skill]] <- suppressWarnings(as.numeric(skill_join_dt[[source_col]]))
  }

  merged_dt <- merge(
    copy(training_dt),
    skill_join_dt[, c("nba_id", "outcome_year", available_skill_cols), with = FALSE],
    by = c("nba_id", "outcome_year"),
    all.x = TRUE,
    suffixes = c("", "_latest")
  )

  for (skill in available_skill_cols) {
    latest_col <- paste0(skill, "_latest")
    if (!latest_col %in% names(merged_dt)) next
    latest_vals <- suppressWarnings(as.numeric(merged_dt[[latest_col]]))
    current_vals <- suppressWarnings(as.numeric(merged_dt[[skill]]))
    merged_dt[[skill]] <- ifelse(!is.na(latest_vals), latest_vals, current_vals)
    merged_dt[[latest_col]] <- NULL
  }

  merged_dt
}

refresh_training_predictors <- function(training_dt, source_dt, predictor_cols) {
  predictor_cols <- intersect(predictor_cols, names(source_dt))
  predictor_cols <- setdiff(predictor_cols, c("join_player", "join_draft_year"))
  if (!length(predictor_cols)) {
    warning("No requested predictor columns found in draft prediction files - keeping existing training data predictors.")
    return(training_dt)
  }

  if (!all(c("player", "draft_year") %in% names(training_dt))) {
    warning("draft_training_data.csv lacks player/draft_year - keeping existing training data predictors.")
    return(training_dt)
  }
  if (!all(c("player", "draft_year") %in% names(source_dt))) {
    warning("Draft prediction files lack player/draft_year - keeping existing training data predictors.")
    return(training_dt)
  }

  training_join_dt <- copy(training_dt)
  source_join_dt <- copy(source_dt)
  training_join_dt[, join_player := normalize_join_name(player)]
  training_join_dt[, join_draft_year := suppressWarnings(as.integer(draft_year))]
  source_join_dt[, join_player := normalize_join_name(player)]
  source_join_dt[, join_draft_year := suppressWarnings(as.integer(draft_year))]

  for (pred in predictor_cols) {
    if (!pred %in% names(training_join_dt)) training_join_dt[[pred]] <- NA_real_
  }

  source_join_dt <- unique(source_join_dt[, c("join_player", "join_draft_year", predictor_cols), with = FALSE], by = c("join_player", "join_draft_year"))
  merged_dt <- merge(training_join_dt, source_join_dt, by = c("join_player", "join_draft_year"), all.x = TRUE, suffixes = c("", "_latest"))

  for (pred in predictor_cols) {
    latest_col <- paste0(pred, "_latest")
    if (!latest_col %in% names(merged_dt)) next
    latest_vals <- suppressWarnings(as.numeric(merged_dt[[latest_col]]))
    current_vals <- suppressWarnings(as.numeric(merged_dt[[pred]]))
    merged_dt[[pred]] <- ifelse(!is.na(latest_vals), latest_vals, current_vals)
    merged_dt[[latest_col]] <- NULL
  }

  merged_dt[, c("join_player", "join_draft_year") := NULL]
  merged_dt
}

read_pred <- function(path) {
  if (!file.exists(path)) return(NULL)

  df <- as.data.frame(fread(path, na.strings = c("", "NA", "N/A", "NaN")))
  if ("player" %in% names(df)) {
    df[["player"]] <- anglicize_text(df[["player"]])
  }
  join_id <- resolve_prediction_join_id(df)
  df <- add_alias_columns(df)
  df <- add_curated_realgm_features(df)
  df <- add_scv_draft_feature(df, scv_draft_lookup)
  if (!nrow(df)) return(df)

  join_player <- if ("player" %in% names(df)) normalize_join_name(df[["player"]]) else rep("unknown", nrow(df))
  latest_year <- if ("draft_year" %in% names(df)) {
    suppressWarnings(as.integer(df[["draft_year"]]))
  } else if ("year" %in% names(df)) {
    suppressWarnings(as.integer(df[["year"]]))
  } else {
    rep(NA_integer_, nrow(df))
  }
  created_key <- if ("created_at" %in% names(df)) as.character(df[["created_at"]]) else rep("", nrow(df))
  dedupe_key <- ifelse(!is.na(join_id) & nzchar(join_id), paste0("id:", join_id), paste0("name:", join_player))

  order_idx <- order(dedupe_key, -ifelse(is.na(latest_year), -99999L, latest_year), created_key, decreasing = FALSE)
  df <- df[order_idx, , drop = FALSE]
  df <- df[!duplicated(dedupe_key[order_idx]), , drop = FALSE]
  rownames(df) <- NULL
  df
}

filter_prediction_target_year <- function(df, target_year, tag) {
  if (is.null(df) || !nrow(df) || !is.finite(target_year)) return(df)

  year_col <- if ("draft_year" %in% names(df)) {
    "draft_year"
  } else if ("year" %in% names(df)) {
    "year"
  } else {
    NULL
  }

  if (is.null(year_col)) {
    warning(sprintf("%s data lacks a draft year column; skipping target-year filter.", tag))
    return(df[0, , drop = FALSE])
  }

  year_vals <- suppressWarnings(as.integer(df[[year_col]]))
  df[!is.na(year_vals) & year_vals == target_year, , drop = FALSE]
}

filter_prediction_year_range <- function(df, min_year = NA_integer_, max_year = NA_integer_, tag = "prediction") {
  if (is.null(df) || !nrow(df)) return(df)

  year_col <- if ("draft_year" %in% names(df)) {
    "draft_year"
  } else if ("year" %in% names(df)) {
    "year"
  } else {
    NULL
  }

  if (is.null(year_col)) {
    warning(sprintf("%s data lacks a draft year column; skipping publish-year filter.", tag))
    return(df[0, , drop = FALSE])
  }

  year_vals <- suppressWarnings(as.integer(df[[year_col]]))
  keep <- !is.na(year_vals)
  if (is.finite(min_year)) keep <- keep & year_vals >= min_year
  if (is.finite(max_year)) keep <- keep & year_vals <= max_year
  df[keep, , drop = FALSE]
}

sort_prediction_output <- function(df) {
  if (is.null(df) || !nrow(df)) return(df)
  dt <- as.data.table(copy(df))
  if ("player" %in% names(dt)) dt[, player := anglicize_text(player)]
  if ("draft_year" %in% names(dt)) dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  if ("prediction_pool" %in% names(dt)) {
    setorder(dt, draft_year, player, prediction_pool)
  } else {
    setorder(dt, draft_year, player)
  }
  as.data.frame(dt)
}

merge_prediction_output <- function(output_path, update_df, target_year) {
  update_dt <- as.data.table(copy(update_df))
  if (!is.finite(target_year) || !file.exists(output_path)) {
    return(sort_prediction_output(update_dt))
  }

  existing_dt <- fread(output_path, na.strings = c("", "NA", "N/A", "NaN"))
  if ("draft_year" %in% names(existing_dt)) {
    existing_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
    existing_dt <- existing_dt[is.na(draft_year) | draft_year != target_year]
  }

  sort_prediction_output(rbindlist(list(existing_dt, update_dt), use.names = TRUE, fill = TRUE))
}

keep_latest_prediction_rows <- function(df) {
  if (is.null(df) || !nrow(df)) return(df)

  dt <- as.data.table(copy(df))
  dt[, join_player := if ("player" %in% names(dt)) normalize_join_name(player) else "unknown"]
  if ("draft_year" %in% names(dt)) dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt[, sort_created_key := if ("created_at" %in% names(dt)) as.character(created_at) else ""]
  dt[, sort_draft_year := ifelse(is.na(draft_year), -99999L, draft_year)]
  setorder(dt, join_player, -sort_draft_year, sort_created_key, na.last = TRUE)
  dt <- unique(dt, by = "join_player")
  dt[, c("join_player", "sort_draft_year", "sort_created_key") := NULL]
  as.data.frame(dt)
}

parse_optional_year_env <- function(var_name) {
  value <- suppressWarnings(as.integer(Sys.getenv(var_name, "")))
  if (!is.finite(value)) return(NA_integer_)
  value
}

make_glmnet_matrix <- function(df, preds) {
  mm <- model.matrix(as.formula(sprintf("~ %s", paste(preds, collapse = " + "))), data = df)
  mm[, colnames(mm) != "(Intercept)", drop = FALSE]
}

get_curated_realgm_feature_map <- function() {
  list(
    FTD = c("height_wo_shoes_in", "per36_fta", "per36_fga", "per36_pts", "misc_usg_pct", "misc_ts_pct", "misc_ortg", "scv_draft"),
    OREB = c("height_wo_shoes_in", "wingspan_in", "per36_off", "per36_trb", "misc_orb_pct", "misc_trb_pct", "per36_blk", "misc_blk_pct", "scv_draft"),
    PASS = c("per36_ast", "misc_ast_pct", "misc_ppr", "misc_tov_pct", "per36_tov", "misc_usg_pct", "scv_draft"),
    RIM = c("height_wo_shoes_in", "wingspan_in", "rate_fg_pct", "misc_ts_pct", "misc_efg_pct", "per36_fta", "per36_fga", "per36_pts", "per36_off", "misc_orb_pct", "scv_draft"),
    SHOOT = c("rate_x3p_pct", "rate_ft_pct", "per36_x3pa", "per36_fta", "per36_fga", "misc_ts_pct", "misc_efg_pct", "misc_pps", "misc_ortg", "scv_draft"),
    DPM = c("height_wo_shoes_in", "wingspan_in", "per36_stl", "misc_stl_pct", "per36_blk", "misc_blk_pct", "misc_drtg", "misc_trb_pct", "scv_draft"),
    DREB = c("height_wo_shoes_in", "wingspan_in", "per36_def", "per36_trb", "misc_drb_pct", "misc_trb_pct", "per36_blk", "misc_blk_pct", "scv_draft"),
    RIMPRO = c("height_wo_shoes_in", "wingspan_in", "per36_blk", "misc_blk_pct", "per36_def", "misc_drtg", "misc_trb_pct", "scv_draft"),
    SWITCH = c("height_wo_shoes_in", "wingspan_in", "per36_stl", "misc_stl_pct", "per36_blk", "misc_blk_pct", "misc_drtg", "misc_total_s_pct", "scv_draft")
  )
}

get_curated_realgm_feature_caps <- function() {
  c(FTD = 5L, OREB = 4L, PASS = 5L, RIM = 5L, SHOOT = 4L, DPM = 5L, DREB = 5L, RIMPRO = 3L, SWITCH = 5L)
}

get_curated_realgm_feature_anchors <- function() {
  list(
    FTD = c("per36_fta", "misc_usg_pct"),
    OREB = c("per36_off", "misc_orb_pct"),
    PASS = c("per36_ast", "misc_ast_pct"),
    RIM = c("height_wo_shoes_in", "rate_fg_pct"),
    SHOOT = c("rate_x3p_pct", "per36_x3pa"),
    DPM = c("per36_stl", "misc_stl_pct"),
    DREB = c("per36_def", "misc_drb_pct"),
    RIMPRO = c("per36_blk", "wingspan_in"),
    SWITCH = c("per36_stl", "misc_blk_pct")
  )
}

build_feature_grid <- function(max_features) {
  max_features <- suppressWarnings(as.integer(max_features))
  if (!is.finite(max_features) || max_features < 2L) return(integer())
  if (max_features <= 6L) return(seq.int(2L, max_features))
  unique(as.integer(sort(pmin(c(2L, 3L, 4L, 5L, 6L, max_features), max_features))))
}

get_skill_feature_cap <- function(skill_name, max_features) {
  max_features <- suppressWarnings(as.integer(max_features))
  if (!is.finite(max_features) || max_features < 2L) return(0L)

  global_cap <- suppressWarnings(as.integer(Sys.getenv("DRAFT_GLOBAL_FEATURE_CAP", "5")))
  if (!is.finite(global_cap) || global_cap < 2L) global_cap <- 5L

  cap_map <- get_curated_realgm_feature_caps()
  if (!skill_name %in% names(cap_map)) {
    return(max(2L, min(max_features, global_cap)))
  }

  max(2L, min(max_features, as.integer(cap_map[[skill_name]]), global_cap))
}

get_skill_anchor_predictors <- function(skill_name, candidate_cols) {
  feature_profile <- trimws(tolower(Sys.getenv("DRAFT_FEATURE_PROFILE", "all_numeric")))
  if (!identical(feature_profile, "curated_realgm")) return(character())

  anchor_map <- get_curated_realgm_feature_anchors()
  if (!skill_name %in% names(anchor_map)) return(character())
  intersect(anchor_map[[skill_name]], candidate_cols)
}

get_candidate_predictors <- function(df, skill_targets, skill_name = NULL) {
  feature_profile <- trimws(tolower(Sys.getenv("DRAFT_FEATURE_PROFILE", "all_numeric")))

  if (identical(feature_profile, "curated_realgm")) {
    feature_map <- get_curated_realgm_feature_map()
    candidate_cols <- if (!is.null(skill_name) && skill_name %in% names(feature_map)) feature_map[[skill_name]] else unique(unlist(feature_map, use.names = FALSE))
    candidate_cols <- intersect(unique(candidate_cols), names(df))
    candidate_cols <- candidate_cols[vapply(df[, candidate_cols, drop = FALSE], function(x) is.numeric(x) || is.integer(x), logical(1))]
    return(candidate_cols)
  }

  exclude_cols <- c("nba_id", "outcome_year", "player", "draft_year", "nba_player", "years_after_draft", "match_method", "selection_score", "combined_impact", "impact_total", "max_years_after_draft", "off_dep", "def_dep", "3pa_100", skill_targets)
  candidate_cols <- setdiff(names(df), exclude_cols)
  candidate_cols <- candidate_cols[vapply(df[, candidate_cols, drop = FALSE], function(x) is.numeric(x) || is.integer(x), logical(1))]
  candidate_cols
}

rank_predictors_corr <- function(train_df, target_col, candidate_cols) {
  cor_dt <- lapply(candidate_cols, function(pred) {
    x <- suppressWarnings(as.numeric(train_df[[pred]]))
    y <- suppressWarnings(as.numeric(train_df[[target_col]]))
    if (!any(is.finite(x)) || sd(x, na.rm = TRUE) == 0) return(NULL)
    corr <- suppressWarnings(cor(x, y, use = "pairwise.complete.obs"))
    if (!is.finite(corr)) return(NULL)
    data.table(variable = pred, score = abs(corr))
  })

  cor_dt <- rbindlist(cor_dt, use.names = TRUE, fill = TRUE)
  if (!nrow(cor_dt)) return(character())
  setorder(cor_dt, -score, variable)
  cor_dt$variable
}

rank_predictors_ranger <- function(train_df, target_col, candidate_cols) {
  if (!length(candidate_cols)) return(character())

  rf_formula <- as.formula(sprintf("%s ~ %s", target_col, paste(candidate_cols, collapse = " + ")))
  fit <- tryCatch(
    ranger(
      formula = rf_formula,
      data = train_df[, c(target_col, candidate_cols), drop = FALSE],
      num.trees = 300,
      mtry = max(1L, floor(sqrt(length(candidate_cols)))),
      min.node.size = 5,
      seed = 123,
      importance = "impurity",
      write.forest = FALSE,
      num.threads = max(1L, parallel::detectCores() - 1L),
      respect.unordered.factors = "order"
    ),
    error = function(e) NULL
  )

  if (is.null(fit) || is.null(fit$variable.importance)) {
    return(rank_predictors_corr(train_df, target_col, candidate_cols))
  }

  imp_dt <- data.table(variable = names(fit$variable.importance), score = as.numeric(fit$variable.importance))
  imp_dt <- imp_dt[is.finite(score)]
  if (!nrow(imp_dt)) return(rank_predictors_corr(train_df, target_col, candidate_cols))
  setorder(imp_dt, -score, variable)
  imp_dt$variable
}

fit_glmnet_search <- function(train_df, target_col, ranked_preds, feature_grid, alpha_grid) {
  foldid <- make_year_foldid(train_df)
  best <- NULL

  for (feature_count in feature_grid) {
    preds <- ranked_preds[seq_len(feature_count)]
    preprocess_recipe <- build_preprocess_recipe(train_df, preds)
    train_processed <- apply_preprocess_recipe(train_df[, c("draft_year", target_col, preds), drop = FALSE], preprocess_recipe)
    x_train <- make_glmnet_matrix(train_processed, preds)
    y_train <- as.numeric(train_processed[[target_col]])

    for (alpha_value in alpha_grid) {
      cv_fit <- tryCatch({
        if (!is.null(foldid) && length(unique(foldid[is.finite(foldid)])) >= 2L) {
          cv.glmnet(x = x_train, y = y_train, alpha = alpha_value, family = "gaussian", standardize = TRUE, intercept = TRUE, foldid = foldid, type.measure = "mse")
        } else {
          cv.glmnet(x = x_train, y = y_train, alpha = alpha_value, family = "gaussian", standardize = TRUE, intercept = TRUE, nfolds = min(5L, nrow(train_df)), type.measure = "mse")
        }
      }, error = function(e) NULL)
      if (is.null(cv_fit)) next

      candidate <- list(
        feature_count = feature_count,
        preds = preds,
        alpha = alpha_value,
        lambda = cv_fit$lambda.min,
        cv_mse = min(cv_fit$cvm, na.rm = TRUE),
        fit = cv_fit,
        preprocess_recipe = preprocess_recipe
      )
      if (is.null(best) || candidate$cv_mse < best$cv_mse || (isTRUE(all.equal(candidate$cv_mse, best$cv_mse, tolerance = 1e-10)) && candidate$feature_count < best$feature_count)) {
        best <- candidate
      }
    }
  }

  best
}

make_ranger_search_grid <- function(max_features) {
  feature_grid <- build_feature_grid(max_features)
  feature_grid <- feature_grid[feature_grid >= 2L]
  grid_rows <- list()
  idx <- 1L

  for (feature_count in feature_grid) {
    mtry_values <- unique(pmax(1L, pmin(feature_count, c(floor(sqrt(feature_count)), floor(feature_count / 3), floor(feature_count / 2), floor(0.75 * feature_count)))))
    for (mtry_value in mtry_values) {
      for (min_node in c(3L, 5L, 10L)) {
        for (sample_fraction in c(0.65, 0.80, 1.00)) {
          grid_rows[[idx]] <- data.table(feature_count = feature_count, mtry = mtry_value, min.node.size = min_node, sample.fraction = sample_fraction)
          idx <- idx + 1L
        }
      }
    }
  }

  grid_dt <- rbindlist(grid_rows, use.names = TRUE, fill = TRUE)
  if (nrow(grid_dt) > 20) {
    set.seed(123 + max_features)
    anchor_idx <- unique(c(1L, floor(nrow(grid_dt) / 2), nrow(grid_dt)))
    remaining_idx <- setdiff(seq_len(nrow(grid_dt)), anchor_idx)
    keep_idx <- unique(c(anchor_idx, sample(remaining_idx, size = min(17L, length(remaining_idx)))))
    grid_dt <- grid_dt[sort(keep_idx)]
  }

  unique(grid_dt)
}

fit_ranger_search <- function(train_df, target_col, ranked_preds) {
  search_grid <- make_ranger_search_grid(length(ranked_preds))
  if (!nrow(search_grid)) return(NULL)

  best <- NULL

  for (i in seq_len(nrow(search_grid))) {
    cfg <- search_grid[i]
    preds <- ranked_preds[seq_len(cfg$feature_count[[1]])]
    preprocess_recipe <- build_preprocess_recipe(train_df, preds)
    train_processed <- apply_preprocess_recipe(train_df[, c(target_col, preds), drop = FALSE], preprocess_recipe)
    model_formula <- as.formula(sprintf("%s ~ %s", target_col, paste(preds, collapse = " + ")))
    y_train <- as.numeric(train_processed[[target_col]])
    denom <- sum((y_train - mean(y_train))^2)

    fit <- tryCatch(
      ranger(
        formula = model_formula,
        data = train_processed,
        num.trees = 350,
        mtry = cfg$mtry[[1]],
        min.node.size = cfg$min.node.size[[1]],
        sample.fraction = cfg$sample.fraction[[1]],
        seed = 123,
        importance = "none",
        write.forest = FALSE,
        num.threads = max(1L, parallel::detectCores() - 1L),
        respect.unordered.factors = "order"
      ),
      error = function(e) NULL
    )
    if (is.null(fit)) next

    oob_r2 <- NA_real_
    if (is.finite(denom) && denom > 0 && !is.null(fit$predictions)) {
      oob_r2 <- 1 - sum((y_train - fit$predictions)^2) / denom
    }
    if (!is.finite(oob_r2)) next

    candidate <- list(
      feature_count = cfg$feature_count[[1]],
      preds = preds,
      mtry = cfg$mtry[[1]],
      min.node.size = cfg$min.node.size[[1]],
      sample.fraction = cfg$sample.fraction[[1]],
      oob_r2 = oob_r2,
      preprocess_recipe = preprocess_recipe
    )
    if (is.null(best) || candidate$oob_r2 > best$oob_r2 || (isTRUE(all.equal(candidate$oob_r2, best$oob_r2, tolerance = 1e-10)) && candidate$feature_count < best$feature_count)) {
      best <- candidate
    }
  }

  best
}

prepare_temporal_rankings <- function(train_df, target_col, candidate_cols, splits, ranker_fn, feature_cap, anchor_preds = character()) {
  if (!length(splits) || !length(candidate_cols)) {
    return(list(splits = list(), stability_dt = NULL, ranked_global = character(), total_splits = 0L))
  }

  max_rank_depth <- max(8L, 3L * suppressWarnings(as.integer(feature_cap)))
  corr_guard_threshold <- get_correlation_guard_threshold()
  ranked_splits <- list()
  rank_rows <- list()
  rank_idx <- 1L

  for (split in splits) {
    split_train <- train_df[split$train_idx, , drop = FALSE]
    split_candidates <- candidate_cols[vapply(split_train[, candidate_cols, drop = FALSE], function(x) is.numeric(x) && is.finite(sd(x, na.rm = TRUE)) && sd(x, na.rm = TRUE) > 0, logical(1))]
    split_anchor <- intersect(anchor_preds, split_candidates)
    if (length(split_candidates) < max(2L, min(2L, length(split_anchor) + 1L))) next

    split_recipe <- build_preprocess_recipe(split_train, split_candidates)
    split_train_processed <- apply_preprocess_recipe(split_train, split_recipe)
    ranked_preds <- ranker_fn(split_train_processed, target_col, split_candidates)
    ranked_preds <- unique(c(split_anchor, ranked_preds))
    ranked_preds <- ranked_preds[ranked_preds %in% split_candidates]
    ranked_preds <- head(ranked_preds, min(length(ranked_preds), max_rank_depth))
    ranked_preds <- apply_correlation_guard(split_train_processed, ranked_preds, corr_guard_threshold, split_anchor)
    if (!length(ranked_preds)) next

    ranked_splits[[rank_idx]] <- c(split, list(ranked_preds = ranked_preds, split_anchor = split_anchor))
    rank_rows[[rank_idx]] <- data.table(split_id = rank_idx, validation_year = split$validation_year, variable = ranked_preds, rank = seq_along(ranked_preds), selected_top_cap = seq_along(ranked_preds) <= feature_cap)
    rank_idx <- rank_idx + 1L
  }

  if (!length(ranked_splits)) {
    return(list(splits = list(), stability_dt = NULL, ranked_global = character(), total_splits = 0L))
  }

  rank_dt <- rbindlist(rank_rows, use.names = TRUE, fill = TRUE)
  total_splits <- length(ranked_splits)
  stability_dt <- rank_dt[, .(
    split_presence = uniqueN(split_id) / total_splits,
    selection_frequency = sum(selected_top_cap, na.rm = TRUE) / total_splits,
    mean_rank = mean(rank, na.rm = TRUE),
    mean_rank_score = mean(1 / rank, na.rm = TRUE)
  ), by = variable]
  setorder(stability_dt, -selection_frequency, -mean_rank_score, mean_rank, variable)

  full_recipe <- build_preprocess_recipe(train_df, candidate_cols)
  train_processed <- apply_preprocess_recipe(train_df, full_recipe)
  ranked_global <- unique(c(anchor_preds, stability_dt$variable))
  ranked_global <- ranked_global[ranked_global %in% candidate_cols]
  ranked_global <- apply_correlation_guard(train_processed, ranked_global, corr_guard_threshold, anchor_preds)

  list(splits = ranked_splits, stability_dt = stability_dt, ranked_global = ranked_global, total_splits = total_splits)
}

fit_final_glmnet <- function(train_df, target_col, preds, alpha_value) {
  x_train <- make_glmnet_matrix(train_df, preds)
  y_train <- as.numeric(train_df[[target_col]])
  foldid <- make_year_foldid(train_df)

  tryCatch({
    if (!is.null(foldid) && length(unique(foldid[is.finite(foldid)])) >= 2L) {
      cv.glmnet(x = x_train, y = y_train, alpha = alpha_value, family = "gaussian", standardize = TRUE, intercept = TRUE, foldid = foldid, type.measure = "mse")
    } else {
      cv.glmnet(x = x_train, y = y_train, alpha = alpha_value, family = "gaussian", standardize = TRUE, intercept = TRUE, nfolds = min(5L, nrow(train_df)), type.measure = "mse")
    }
  }, error = function(e) NULL)
}

fit_glmnet_temporal_search <- function(train_df, target_col, candidate_cols, feature_cap, anchor_preds = character(), alpha_grid = c(0, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 1.00), min_train_rows = 20L) {
  splits <- build_temporal_validation_splits(train_df, min_train_rows = min_train_rows, min_validation_rows = 3L, min_train_years = 3L)
  prep <- prepare_temporal_rankings(train_df, target_col, candidate_cols, splits, rank_predictors_corr, feature_cap, anchor_preds)

  if (!length(prep$splits) || !length(prep$ranked_global)) {
    corr_guard_threshold <- get_correlation_guard_threshold()
    ranked_preds <- rank_predictors_corr(train_df, target_col, candidate_cols)
    ranked_preds <- unique(c(anchor_preds, ranked_preds))
    ranked_preds <- apply_correlation_guard(train_df, ranked_preds, corr_guard_threshold, anchor_preds)
    ranked_preds <- head(ranked_preds, feature_cap)
    feature_grid <- build_feature_grid(length(ranked_preds))
    if (length(anchor_preds) >= 2L) feature_grid <- feature_grid[feature_grid >= length(anchor_preds)]
    fallback <- fit_glmnet_search(train_df, target_col, ranked_preds, feature_grid, alpha_grid)
    if (is.null(fallback)) return(NULL)
    fallback$temporal_r2 <- NA_real_
    fallback$temporal_mse <- fallback$cv_mse
    fallback$validation_scheme <- "grouped_year_cv_fallback"
    fallback$temporal_splits <- 0L
    fallback$validation_rows <- 0L
    fallback$stability_dt <- NULL
    return(fallback)
  }

  max_features <- min(feature_cap, length(prep$ranked_global))
  feature_grid <- build_feature_grid(max_features)
  if (length(anchor_preds) >= 2L) feature_grid <- feature_grid[feature_grid >= length(intersect(anchor_preds, prep$ranked_global))]

  best <- NULL
  for (feature_count in feature_grid) {
    if (feature_count > length(prep$ranked_global)) next
    for (alpha_value in alpha_grid) {
      validation_actual <- numeric()
      validation_pred <- numeric()
      splits_used <- 0L

      for (split in prep$splits) {
        if (length(split$ranked_preds) < feature_count) next
        preds <- split$ranked_preds[seq_len(feature_count)]
        split_train <- train_df[split$train_idx, c("draft_year", target_col, preds), drop = FALSE]
        split_validation <- train_df[split$validation_idx, c("draft_year", target_col, preds), drop = FALSE]
        preprocess_recipe <- build_preprocess_recipe(split_train, preds)
        split_train_processed <- apply_preprocess_recipe(split_train, preprocess_recipe)
        split_validation_processed <- apply_preprocess_recipe(split_validation, preprocess_recipe)
        cv_fit <- fit_final_glmnet(split_train_processed, target_col, preds, alpha_value)
        if (is.null(cv_fit)) next
        fold_pred <- as.numeric(predict(cv_fit, newx = make_glmnet_matrix(split_validation_processed, preds), s = "lambda.min"))
        keep <- is.finite(split_validation_processed[[target_col]]) & is.finite(fold_pred)
        if (!any(keep)) next
        validation_actual <- c(validation_actual, as.numeric(split_validation_processed[[target_col]])[keep])
        validation_pred <- c(validation_pred, fold_pred[keep])
        splits_used <- splits_used + 1L
      }

      if (!length(validation_actual)) next

      candidate <- list(feature_count = feature_count, alpha = alpha_value, temporal_mse = calc_mse(validation_actual, validation_pred), temporal_r2 = calc_r2(validation_actual, validation_pred), validation_rows = length(validation_actual), temporal_splits = splits_used, ranked_global = prep$ranked_global, stability_dt = prep$stability_dt, validation_scheme = "rolling_draft_year")
      if (is.null(best) || candidate$temporal_mse < best$temporal_mse || (isTRUE(all.equal(candidate$temporal_mse, best$temporal_mse, tolerance = 1e-10)) && candidate$temporal_splits > best$temporal_splits) || (isTRUE(all.equal(candidate$temporal_mse, best$temporal_mse, tolerance = 1e-10)) && candidate$temporal_splits == best$temporal_splits && candidate$feature_count < best$feature_count)) {
        best <- candidate
      }
    }
  }

  if (is.null(best)) return(NULL)
  best$preds <- best$ranked_global[seq_len(best$feature_count)]
  best$preprocess_recipe <- build_preprocess_recipe(train_df, best$preds)
  train_processed <- apply_preprocess_recipe(train_df[, c("draft_year", target_col, best$preds), drop = FALSE], best$preprocess_recipe)
  best$fit <- fit_final_glmnet(train_processed, target_col, best$preds, best$alpha)
  if (is.null(best$fit)) return(NULL)
  best$lambda <- best$fit$lambda.min
  best
}

fit_ranger_temporal_search <- function(train_df, target_col, candidate_cols, feature_cap, anchor_preds = character(), min_train_rows = 20L) {
  splits <- build_temporal_validation_splits(train_df, min_train_rows = min_train_rows, min_validation_rows = 3L, min_train_years = 3L)
  prep <- prepare_temporal_rankings(train_df, target_col, candidate_cols, splits, rank_predictors_ranger, feature_cap, anchor_preds)

  if (!length(prep$splits) || !length(prep$ranked_global)) {
    corr_guard_threshold <- get_correlation_guard_threshold()
    ranked_preds <- rank_predictors_ranger(train_df, target_col, candidate_cols)
    ranked_preds <- unique(c(anchor_preds, ranked_preds))
    ranked_preds <- apply_correlation_guard(train_df, ranked_preds, corr_guard_threshold, anchor_preds)
    ranked_preds <- head(ranked_preds, feature_cap)
    fallback <- fit_ranger_search(train_df, target_col, ranked_preds)
    if (is.null(fallback)) return(NULL)
    fallback$temporal_mse <- NA_real_
    fallback$temporal_r2 <- fallback$oob_r2
    fallback$validation_scheme <- "oob_fallback"
    fallback$temporal_splits <- 0L
    fallback$validation_rows <- 0L
    fallback$stability_dt <- NULL
    return(fallback)
  }

  search_grid <- make_ranger_search_grid(min(feature_cap, length(prep$ranked_global)))
  if (!nrow(search_grid)) return(NULL)

  best <- NULL
  for (i in seq_len(nrow(search_grid))) {
    cfg <- search_grid[i]
    feature_count <- cfg$feature_count[[1]]
    if (feature_count > length(prep$ranked_global)) next

    validation_actual <- numeric()
    validation_pred <- numeric()
    splits_used <- 0L

    for (split in prep$splits) {
      if (length(split$ranked_preds) < feature_count) next
      preds <- split$ranked_preds[seq_len(feature_count)]
      split_train <- train_df[split$train_idx, c(target_col, preds), drop = FALSE]
      split_validation <- train_df[split$validation_idx, c(target_col, preds), drop = FALSE]
      preprocess_recipe <- build_preprocess_recipe(split_train, preds)
      split_train_processed <- apply_preprocess_recipe(split_train, preprocess_recipe)
      split_validation_processed <- apply_preprocess_recipe(split_validation, preprocess_recipe)
      model_formula <- as.formula(sprintf("%s ~ %s", target_col, paste(preds, collapse = " + ")))

      fit <- tryCatch(
        ranger(
          formula = model_formula,
          data = split_train_processed,
          num.trees = 350,
          mtry = cfg$mtry[[1]],
          min.node.size = cfg$min.node.size[[1]],
          sample.fraction = cfg$sample.fraction[[1]],
          seed = 123,
          importance = "none",
          write.forest = TRUE,
          num.threads = max(1L, parallel::detectCores() - 1L),
          respect.unordered.factors = "order"
        ),
        error = function(e) NULL
      )
      if (is.null(fit)) next

      fold_pred <- as.numeric(predict(fit, data = split_validation_processed)$predictions)
      keep <- is.finite(split_validation_processed[[target_col]]) & is.finite(fold_pred)
      if (!any(keep)) next

      validation_actual <- c(validation_actual, as.numeric(split_validation_processed[[target_col]])[keep])
      validation_pred <- c(validation_pred, fold_pred[keep])
      splits_used <- splits_used + 1L
    }

    if (!length(validation_actual)) next

    candidate <- list(feature_count = feature_count, mtry = cfg$mtry[[1]], min.node.size = cfg$min.node.size[[1]], sample.fraction = cfg$sample.fraction[[1]], temporal_mse = calc_mse(validation_actual, validation_pred), temporal_r2 = calc_r2(validation_actual, validation_pred), validation_rows = length(validation_actual), temporal_splits = splits_used, ranked_global = prep$ranked_global, stability_dt = prep$stability_dt, validation_scheme = "rolling_draft_year")
    candidate_score <- if (is.finite(candidate$temporal_r2)) candidate$temporal_r2 else -Inf
    best_score <- if (is.null(best) || !is.finite(best$temporal_r2)) -Inf else best$temporal_r2

    if (is.null(best) || candidate_score > best_score || (isTRUE(all.equal(candidate_score, best_score, tolerance = 1e-10)) && candidate$temporal_splits > best$temporal_splits) || (isTRUE(all.equal(candidate_score, best_score, tolerance = 1e-10)) && candidate$temporal_splits == best$temporal_splits && candidate$feature_count < best$feature_count)) {
      best <- candidate
    }
  }

  if (is.null(best)) return(NULL)
  best$preds <- best$ranked_global[seq_len(best$feature_count)]
  best$preprocess_recipe <- build_preprocess_recipe(train_df, best$preds)
  train_processed <- apply_preprocess_recipe(train_df[, c(target_col, best$preds), drop = FALSE], best$preprocess_recipe)
  best$fit <- ranger(
    formula = as.formula(sprintf("%s ~ %s", target_col, paste(best$preds, collapse = " + "))),
    data = train_processed,
    num.trees = 1200,
    mtry = best$mtry,
    min.node.size = best$min.node.size,
    sample.fraction = best$sample.fraction,
    seed = 123,
    importance = "impurity",
    write.forest = TRUE,
    num.threads = max(1L, parallel::detectCores() - 1L),
    respect.unordered.factors = "order"
  )
  best
}

get_default_model_preferences <- function() {
  c(
    FTD = "ranger",
    OREB = "elastic_net_family",
    PASS = "ranger",
    RIM = "elastic_net_family",
    SHOOT = "elastic_net_family",
    DPM = "elastic_net_family",
    DREB = "elastic_net_family",
    RIMPRO = "elastic_net_family",
    SWITCH = "ranger"
  )
}

choose_skill_model_family <- function(skill_name, candidate_fits, mse_tolerance_pct = 0.01) {
  valid_names <- names(candidate_fits)[vapply(candidate_fits, function(x) !is.null(x), logical(1))]
  if (!length(valid_names)) return(NULL)

  preference_map <- get_default_model_preferences()
  preferred_model <- if (skill_name %in% names(preference_map)) preference_map[[skill_name]] else "elastic_net_family"

  score_dt <- rbindlist(lapply(valid_names, function(model_type) {
    fit <- candidate_fits[[model_type]]
    data.table(
      model_type = model_type,
      temporal_mse = suppressWarnings(as.numeric(fit$temporal_mse)),
      temporal_r2 = suppressWarnings(as.numeric(fit$temporal_r2)),
      validation_scheme = if (!is.null(fit$validation_scheme)) as.character(fit$validation_scheme) else NA_character_
    )
  }), use.names = TRUE, fill = TRUE)

  comparable_dt <- score_dt[is.finite(temporal_mse)]
  if (!nrow(comparable_dt)) {
    chosen_type <- if (preferred_model %in% valid_names) preferred_model else valid_names[[1]]
    return(list(model_type = chosen_type, fit = candidate_fits[[chosen_type]], candidate_scores = score_dt))
  }

  best_mse <- min(comparable_dt$temporal_mse)
  allowed_dt <- comparable_dt[temporal_mse <= best_mse * (1 + mse_tolerance_pct)]
  if (preferred_model %in% allowed_dt$model_type) {
    chosen_type <- preferred_model
  } else {
    setorder(allowed_dt, -temporal_r2, temporal_mse, model_type)
    chosen_type <- allowed_dt$model_type[[1]]
  }

  list(model_type = chosen_type, fit = candidate_fits[[chosen_type]], candidate_scores = score_dt)
}

extract_glmnet_feature_details <- function(skill_name, best_fit) {
  coef_mat <- as.matrix(coef(best_fit$fit, s = "lambda.min"))
  coef_dt <- data.table(variable = rownames(coef_mat), coefficient = as.numeric(coef_mat[, 1]))
  coef_dt <- coef_dt[variable != "(Intercept)"]
  coef_dt <- coef_dt[variable %in% best_fit$preds]
  coef_dt[, abs_value := abs(coefficient)]
  setorder(coef_dt, -abs_value, variable)
  coef_dt[, detail_rank := seq_len(.N)]
  coef_dt[, `:=`(skill = skill_name, model_type = "elastic_net_family", detail_value = coefficient, detail_type = "coefficient")]
  coef_dt[, .(skill, model_type, variable, detail_type, detail_value, detail_rank)]
}

extract_ranger_feature_details <- function(skill_name, fit) {
  if (is.null(fit$variable.importance) || !length(fit$variable.importance)) return(NULL)
  detail_dt <- data.table(skill = skill_name, model_type = "ranger", variable = names(fit$variable.importance), detail_type = "importance", detail_value = as.numeric(fit$variable.importance))
  setorder(detail_dt, -detail_value, variable)
  detail_dt[, detail_rank := seq_len(.N)]
  detail_dt
}

extract_temporal_stability_details <- function(skill_name, model_type, stability_dt, selected_preds) {
  if (is.null(stability_dt) || !nrow(stability_dt) || !length(selected_preds)) return(NULL)
  selected_dt <- copy(stability_dt[variable %in% selected_preds])
  if (!nrow(selected_dt)) return(NULL)
  selected_dt[, detail_rank := match(variable, selected_preds)]
  setorder(selected_dt, detail_rank)

  freq_dt <- selected_dt[, .(skill = skill_name, model_type = model_type, variable = variable, detail_type = "temporal_selection_frequency", detail_value = selection_frequency, detail_rank = detail_rank)]
  score_dt <- selected_dt[, .(skill = skill_name, model_type = model_type, variable = variable, detail_type = "temporal_rank_score", detail_value = mean_rank_score, detail_rank = detail_rank)]
  rbindlist(list(freq_dt, score_dt), use.names = TRUE, fill = TRUE)
}

predict_model_entry <- function(model_entry, new_df) {
  preds <- model_entry$selected_features
  if (!all(preds %in% names(new_df))) return(rep(NA_real_, nrow(new_df)))
  scoring_df <- apply_preprocess_recipe(new_df, model_entry$preprocess_recipe)

  if (identical(model_entry$model_type, "elastic_net_family")) {
    x_new <- make_glmnet_matrix(scoring_df, preds)
    return(as.numeric(predict(model_entry$fit, newx = x_new, s = "lambda.min")))
  }
  if (identical(model_entry$model_type, "ranger")) {
    return(as.numeric(predict(model_entry$fit, data = scoring_df)$predictions))
  }
  stop("Unsupported model type: ", model_entry$model_type)
}

make_preds <- function(df, tag, trained_models, player_col) {
  if (is.null(df) || !nrow(df)) return(NULL)
  if (!player_col %in% names(df)) {
    warning(sprintf("%s data lacks '%s' column - skipped", tag, player_col))
    return(NULL)
  }

  df <- add_alias_columns(df)
  out <- data.frame(player = anglicize_text(df[[player_col]]), stringsAsFactors = FALSE)
  if ("draft_year" %in% names(df)) out$draft_year <- df[["draft_year"]]
  if ("year" %in% names(df) && !("draft_year" %in% names(df))) out$draft_year <- df[["year"]]
  out$prediction_pool <- tag

  for (skill in names(trained_models)) {
    out[[paste0(skill, "_pred")]] <- predict_model_entry(trained_models[[skill]], df)
  }

  out
}

parse_prediction_specs <- function(spec_string) {
  spec_string <- trimws(spec_string)
  if (!nzchar(spec_string)) return(data.table(tag = character(), path = character()))
  spec_parts <- strsplit(spec_string, ";", fixed = TRUE)[[1]]
  spec_parts <- trimws(spec_parts)
  spec_parts <- spec_parts[nzchar(spec_parts)]
  if (!length(spec_parts)) return(data.table(tag = character(), path = character()))

  rows <- lapply(spec_parts, function(part) {
    kv <- strsplit(part, "=", fixed = TRUE)[[1]]
    if (length(kv) < 2) return(NULL)
    tag <- trimws(kv[[1]])
    path <- trimws(paste(kv[-1], collapse = "="))
    if (!nzchar(tag) || !nzchar(path)) return(NULL)
    data.table(tag = tag, path = path)
  })

  rows <- Filter(Negate(is.null), rows)
  if (!length(rows)) return(data.table(tag = character(), path = character()))
  unique(rbindlist(rows, use.names = TRUE, fill = TRUE), by = c("tag", "path"))
}

parse_optional_int_env <- function(var_name) {
  raw_value <- trimws(Sys.getenv(var_name, ""))
  if (!nzchar(raw_value)) return(NA_integer_)
  parsed <- suppressWarnings(as.integer(raw_value))
  if (!is.finite(parsed)) {
    warning(sprintf("Environment variable %s is not a valid integer: %s", var_name, raw_value))
    return(NA_integer_)
  }
  parsed
}

load_rollup_config <- function(skillmap_path = NULL, off_results_path = NULL, def_results_path = NULL) {
  config <- list(
    offense_skills = character(),
    defense_skills = character(),
    off_intercept = NA_real_,
    def_intercept = NA_real_
  )

  if (!is.null(skillmap_path) && file.exists(skillmap_path)) {
    skillmap_dt <- tryCatch(fread(skillmap_path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
    if (!is.null(skillmap_dt) && nrow(skillmap_dt) && "VAR" %in% names(skillmap_dt)) {
      skill_cols <- setdiff(names(skillmap_dt), "VAR")
      off_row <- skillmap_dt[VAR == "Offense?"]
      def_row <- skillmap_dt[VAR == "Defense?"]

      if (nrow(off_row) == 1L) {
        config$offense_skills <- skill_cols[vapply(skill_cols, function(skill) {
          suppressWarnings(as.numeric(off_row[[skill]][1])) == 1
        }, logical(1))]
      }
      if (nrow(def_row) == 1L) {
        config$defense_skills <- skill_cols[vapply(skill_cols, function(skill) {
          suppressWarnings(as.numeric(def_row[[skill]][1])) == 1
        }, logical(1))]
      }
    }
  }

  if (!is.null(off_results_path) && file.exists(off_results_path)) {
    off_dt <- tryCatch(fread(off_results_path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
    if (!is.null(off_dt) && "term" %in% names(off_dt)) {
      estimate_col <- if ("Estimate" %in% names(off_dt)) "Estimate" else if ("estimate" %in% names(off_dt)) "estimate" else NA_character_
      if (is.finite(match(estimate_col, names(off_dt)))) {
        vals <- suppressWarnings(as.numeric(off_dt[term == "(Intercept)", get(estimate_col)]))
        if (length(vals) && is.finite(vals[[1]])) config$off_intercept <- vals[[1]]
      }
    }
  }

  if (!is.null(def_results_path) && file.exists(def_results_path)) {
    def_dt <- tryCatch(fread(def_results_path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
    if (!is.null(def_dt) && "term" %in% names(def_dt)) {
      estimate_col <- if ("Estimate" %in% names(def_dt)) "Estimate" else if ("estimate" %in% names(def_dt)) "estimate" else NA_character_
      if (is.finite(match(estimate_col, names(def_dt)))) {
        vals <- suppressWarnings(as.numeric(def_dt[term == "(Intercept)", get(estimate_col)]))
        if (length(vals) && is.finite(vals[[1]])) config$def_intercept <- vals[[1]]
      }
    }
  }

  config
}
add_total_predictions <- function(pred_df, rollup_config = NULL) {
  if (is.null(pred_df) || !nrow(pred_df)) return(pred_df)

  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")

  for (skill in skill_names) {
    pred_col <- paste0(skill, "_pred")
    raw_pred_col <- paste0(skill, "_raw_pred")

    if (pred_col %in% names(pred_df)) {
      pred_df[[raw_pred_col]] <- pred_df[[pred_col]]
    } else if (!raw_pred_col %in% names(pred_df)) {
      pred_df[[raw_pred_col]] <- NA_real_
    }

    pred_df[[pred_col]] <- NA_real_
  }

  extra_blank_cols <- c("off_intercept", "def_intercept", "OFF_pred", "DEF_pred", "TOTAL_pred")
  for (col_name in extra_blank_cols) {
    if (!col_name %in% names(pred_df)) {
      pred_df[[col_name]] <- NA_real_
    }
  }

  offense_skills <- intersect(if (!is.null(rollup_config$offense_skills)) rollup_config$offense_skills else character(), skill_names)
  defense_skills <- intersect(if (!is.null(rollup_config$defense_skills)) rollup_config$defense_skills else character(), skill_names)
  off_intercept <- if (!is.null(rollup_config$off_intercept) && is.finite(rollup_config$off_intercept)) rollup_config$off_intercept else 0
  def_intercept <- if (!is.null(rollup_config$def_intercept) && is.finite(rollup_config$def_intercept)) rollup_config$def_intercept else 0

  pred_df$off_intercept <- off_intercept
  pred_df$def_intercept <- def_intercept

  off_raw_cols <- paste0(offense_skills, "_raw_pred")
  def_raw_cols <- paste0(defense_skills, "_raw_pred")
  off_raw_cols <- intersect(off_raw_cols, names(pred_df))
  def_raw_cols <- intersect(def_raw_cols, names(pred_df))

  off_sum <- if (length(off_raw_cols)) rowSums(pred_df[, off_raw_cols, drop = FALSE], na.rm = TRUE) else 0
  def_sum <- if (length(def_raw_cols)) rowSums(pred_df[, def_raw_cols, drop = FALSE], na.rm = TRUE) else 0

  pred_df$OFF_pred <- off_intercept + off_sum
  pred_df$DEF_pred <- def_intercept + def_sum
  pred_df$TOTAL_pred <- pred_df$OFF_pred + pred_df$DEF_pred

  ordered_cols <- c(
    "player", "draft_year", "prediction_pool",
    paste0(skill_names, "_pred"),
    paste0(skill_names, "_raw_pred"),
    "off_intercept", "def_intercept", "OFF_pred", "DEF_pred", "TOTAL_pred"
  )
  ordered_cols <- c(intersect(ordered_cols, names(pred_df)), setdiff(names(pred_df), ordered_cols))
  pred_df[, ordered_cols, drop = FALSE]
}
base_dir <- resolve_base_dir()
ref_dir <- file.path(base_dir, 'ref')
scv_draft_lookup <- load_scv_draft_lookup(file.path(ref_dir, 'scvardraft.csv'))
df <- read_pred(file.path(base_dir, 'processed', 'draft', 'draft_prediction_domestic.csv'))
mod <- readRDS(file.path(base_dir, 'processed', 'draft', 'trained_skill_models.rds'))
out <- make_preds(df, 'domestic', mod$models, 'player')
cat('rows_after_make_preds=', nrow(out), '\n')
cat('unique_players_after_make_preds=', data.table::uniqueN(normalize_join_name(out[['player']])), '\n')
print(data.table::as.data.table(out)[, .N, by = draft_year][order(draft_year)])
out2 <- keep_latest_prediction_rows(out)
cat('rows_after_keep_latest=', nrow(out2), '\n')
cat('unique_players_after_keep_latest=', data.table::uniqueN(normalize_join_name(out2[['player']])), '\n')
print(data.table::as.data.table(out2)[, .N, by = draft_year][order(draft_year)])
