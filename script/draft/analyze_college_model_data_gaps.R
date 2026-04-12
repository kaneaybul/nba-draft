library(data.table)

is_missing_value <- function(x) {
  if (is.numeric(x) || is.integer(x)) {
    return(!is.finite(as.numeric(x)))
  }
  is.na(x) | !nzchar(trimws(as.character(x)))
}

parse_predictors <- function(x) {
  x <- as.character(x)
  x[is.na(x)] <- ""
  preds <- trimws(unlist(strsplit(x, ",", fixed = TRUE), use.names = FALSE))
  preds[nzchar(preds)]
}

count_any_missing <- function(dt, cols) {
  cols_present <- intersect(cols, names(dt))
  missing_cols <- setdiff(cols, names(dt))
  if (!length(cols_present) && !length(missing_cols)) {
    return(list(any_missing = 0L, complete = nrow(dt)))
  }

  miss_parts <- lapply(cols_present, function(col_name) is_missing_value(dt[[col_name]]))
  if (length(missing_cols)) {
    miss_parts <- c(miss_parts, replicate(length(missing_cols), rep(TRUE, nrow(dt)), simplify = FALSE))
  }
  miss_mat <- do.call(cbind, miss_parts)
  any_missing <- rowSums(miss_mat) > 0

  list(
    any_missing = sum(any_missing),
    complete = sum(!any_missing)
  )
}

resolve_base_dir <- function() {
  candidates <- c(getwd(), file.path(getwd(), ".."), file.path(getwd(), "..", ".."))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")

summary_dt <- fread(file.path(draft_dir, "draft_model_summary.csv"), na.strings = c("", "NA", "N/A", "NaN"))
train_dt <- fread(file.path(draft_dir, "draft_training_data.csv"), na.strings = c("", "NA", "N/A", "NaN"))
domestic_dt <- fread(file.path(draft_dir, "draft_prediction_domestic.csv"), na.strings = c("", "NA", "N/A", "NaN"))
international_dt <- fread(file.path(draft_dir, "draft_prediction_international.csv"), na.strings = c("", "NA", "N/A", "NaN"))

domestic_dt[, prediction_pool := "domestic"]
international_dt[, prediction_pool := "international"]
prediction_dt <- rbindlist(list(domestic_dt, international_dt), use.names = TRUE, fill = TRUE)

summary_dt[, feature_list := lapply(predictors, parse_predictors)]
selected_features <- unique(unlist(summary_dt$feature_list, use.names = FALSE))
selected_features <- selected_features[nzchar(selected_features)]

skill_gap_dt <- rbindlist(lapply(seq_len(nrow(summary_dt)), function(i) {
  cols <- summary_dt$feature_list[[i]]
  train_counts <- count_any_missing(train_dt, cols)
  pred_counts <- count_any_missing(prediction_dt, cols)

  data.table(
    skill = summary_dt$skill[[i]],
    model_type = summary_dt$model_type[[i]],
    selected_feature_count = length(cols),
    selected_features = paste(cols, collapse = ", "),
    train_rows = nrow(train_dt),
    train_rows_any_missing = train_counts$any_missing,
    train_rows_complete = train_counts$complete,
    train_any_missing_pct = round(100 * train_counts$any_missing / nrow(train_dt), 1),
    prediction_rows = nrow(prediction_dt),
    prediction_rows_any_missing = pred_counts$any_missing,
    prediction_rows_complete = pred_counts$complete,
    prediction_any_missing_pct = round(100 * pred_counts$any_missing / nrow(prediction_dt), 1),
    summary_selected_complete_pct = summary_dt$selected_feature_complete_pct[[i]],
    summary_selected_max_missing_pct = summary_dt$selected_feature_max_missing_pct[[i]]
  )
}))

feature_gap_dt <- rbindlist(lapply(selected_features, function(col_name) {
  train_missing <- if (col_name %in% names(train_dt)) {
    sum(is_missing_value(train_dt[[col_name]]))
  } else {
    nrow(train_dt)
  }
  pred_missing <- if (col_name %in% names(prediction_dt)) {
    sum(is_missing_value(prediction_dt[[col_name]]))
  } else {
    nrow(prediction_dt)
  }

  data.table(
    feature = col_name,
    train_missing = train_missing,
    train_missing_pct = round(100 * train_missing / nrow(train_dt), 1),
    prediction_missing = pred_missing,
    prediction_missing_pct = round(100 * pred_missing / nrow(prediction_dt), 1),
    used_by = paste(summary_dt[vapply(feature_list, function(v) col_name %in% v, logical(1)), skill], collapse = ", ")
  )
}))
setorder(feature_gap_dt, -train_missing_pct, -prediction_missing_pct, feature)

union_train_counts <- count_any_missing(train_dt, selected_features)
union_prediction_counts <- count_any_missing(prediction_dt, selected_features)

row_missing_counts <- if (length(selected_features)) {
  miss_parts <- lapply(selected_features, function(col_name) {
    if (col_name %in% names(train_dt)) {
      is_missing_value(train_dt[[col_name]])
    } else {
      rep(TRUE, nrow(train_dt))
    }
  })
  rowSums(do.call(cbind, miss_parts))
} else {
  integer(nrow(train_dt))
}

top_missing_rows_dt <- train_dt[row_missing_counts > 0, .(
  player,
  draft_year,
  cbbd_id,
  missing_selected_features = row_missing_counts[row_missing_counts > 0]
)]
setorder(top_missing_rows_dt, -missing_selected_features, player, draft_year)

cat("College model selected-feature data gap report\n")
cat("Training rows:", nrow(train_dt), "\n")
cat("Prediction rows:", nrow(prediction_dt), "(domestic:", nrow(domestic_dt), "international:", nrow(international_dt), ")\n")
cat("Selected feature union count:", length(selected_features), "\n")
cat("Selected feature union:", paste(selected_features, collapse = ", "), "\n")
cat("Training rows missing at least one selected feature:", union_train_counts$any_missing, "/", nrow(train_dt), sprintf("(%.1f%%)", 100 * union_train_counts$any_missing / nrow(train_dt)), "\n")
cat("Prediction rows missing at least one selected feature:", union_prediction_counts$any_missing, "/", nrow(prediction_dt), sprintf("(%.1f%%)", 100 * union_prediction_counts$any_missing / nrow(prediction_dt)), "\n")

cat("\nMissingness by skill-selected feature set:\n")
print(skill_gap_dt)

cat("\nMissingness by selected feature:\n")
print(feature_gap_dt)

cat("\nTraining rows with the most selected-feature gaps:\n")
print(head(top_missing_rows_dt, 30))
