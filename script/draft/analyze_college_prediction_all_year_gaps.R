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
  if (!nrow(dt) || !length(cols)) {
    return(list(any_missing = 0L, complete = nrow(dt)))
  }

  miss_parts <- lapply(cols, function(col_name) {
    if (col_name %in% names(dt)) {
      is_missing_value(dt[[col_name]])
    } else {
      rep(TRUE, nrow(dt))
    }
  })
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
source_dir <- Sys.getenv(
  "COLLEGE_GAP_SOURCE_DIR",
  file.path(draft_dir, "gap_check_college_all_years")
)
exclude_year <- suppressWarnings(as.integer(Sys.getenv("COLLEGE_GAP_EXCLUDE_YEAR", "2026")))

summary_dt <- fread(file.path(draft_dir, "draft_model_summary.csv"), na.strings = c("", "NA", "N/A", "NaN"))
domestic_dt <- fread(file.path(source_dir, "draft_prediction_domestic.csv"), na.strings = c("", "NA", "N/A", "NaN"))
international_dt <- fread(file.path(source_dir, "draft_prediction_international.csv"), na.strings = c("", "NA", "N/A", "NaN"))
domestic_dt[, prediction_pool := "domestic"]
international_dt[, prediction_pool := "international"]
prediction_dt <- rbindlist(list(domestic_dt, international_dt), use.names = TRUE, fill = TRUE)
prediction_dt[, draft_year := suppressWarnings(as.integer(draft_year))]

if (is.finite(exclude_year)) {
  prediction_dt <- prediction_dt[draft_year != exclude_year]
}

summary_dt[, feature_list := lapply(predictors, parse_predictors)]
selected_features <- unique(unlist(summary_dt$feature_list, use.names = FALSE))
selected_features <- selected_features[nzchar(selected_features)]

skill_gap_dt <- rbindlist(lapply(seq_len(nrow(summary_dt)), function(i) {
  cols <- summary_dt$feature_list[[i]]
  counts <- count_any_missing(prediction_dt, cols)

  data.table(
    skill = summary_dt$skill[[i]],
    selected_feature_count = length(cols),
    selected_features = paste(cols, collapse = ", "),
    prediction_rows = nrow(prediction_dt),
    prediction_rows_any_missing = counts$any_missing,
    prediction_rows_complete = counts$complete,
    prediction_any_missing_pct = if (nrow(prediction_dt)) round(100 * counts$any_missing / nrow(prediction_dt), 1) else NA_real_
  )
}))

feature_gap_dt <- rbindlist(lapply(selected_features, function(col_name) {
  missing_count <- if (col_name %in% names(prediction_dt)) {
    sum(is_missing_value(prediction_dt[[col_name]]))
  } else {
    nrow(prediction_dt)
  }

  data.table(
    feature = col_name,
    prediction_missing = missing_count,
    prediction_missing_pct = if (nrow(prediction_dt)) round(100 * missing_count / nrow(prediction_dt), 1) else NA_real_,
    used_by = paste(summary_dt[vapply(feature_list, function(v) col_name %in% v, logical(1)), skill], collapse = ", ")
  )
}))
setorder(feature_gap_dt, -prediction_missing_pct, feature)

row_missing_counts <- if (length(selected_features) && nrow(prediction_dt)) {
  miss_parts <- lapply(selected_features, function(col_name) {
    if (col_name %in% names(prediction_dt)) {
      is_missing_value(prediction_dt[[col_name]])
    } else {
      rep(TRUE, nrow(prediction_dt))
    }
  })
  rowSums(do.call(cbind, miss_parts))
} else {
  integer(nrow(prediction_dt))
}

prediction_dt[, missing_selected_features := row_missing_counts]
year_gap_dt <- prediction_dt[, .(
  rows = .N,
  rows_any_missing = sum(missing_selected_features > 0),
  rows_complete = sum(missing_selected_features == 0),
  any_missing_pct = round(100 * sum(missing_selected_features > 0) / .N, 1)
), by = .(draft_year, prediction_pool)]
setorder(year_gap_dt, draft_year, prediction_pool)

top_missing_rows_dt <- prediction_dt[
  missing_selected_features > 0,
  .(player, draft_year, prediction_pool, cbbd_id, scv_draft, missing_selected_features)
]
setorder(top_missing_rows_dt, -missing_selected_features, draft_year, player)

union_counts <- count_any_missing(prediction_dt, selected_features)

cat("College prediction selected-feature data gap report\n")
cat("Source dir:", source_dir, "\n")
cat("Excluded draft year:", if (is.finite(exclude_year)) exclude_year else "none", "\n")
cat("Prediction rows:", nrow(prediction_dt), "\n")
cat("Selected feature union count:", length(selected_features), "\n")
cat("Selected feature union:", paste(selected_features, collapse = ", "), "\n")
cat(
  "Rows missing at least one selected feature:",
  union_counts$any_missing,
  "/",
  nrow(prediction_dt),
  if (nrow(prediction_dt)) sprintf("(%.1f%%)", 100 * union_counts$any_missing / nrow(prediction_dt)) else "",
  "\n"
)

cat("\nMissingness by draft year/pool:\n")
print(year_gap_dt)

cat("\nMissingness by skill-selected feature set:\n")
print(skill_gap_dt)

cat("\nMissingness by selected feature:\n")
print(feature_gap_dt)

cat("\nPrediction rows with the most selected-feature gaps:\n")
print(head(top_missing_rows_dt, 60))
