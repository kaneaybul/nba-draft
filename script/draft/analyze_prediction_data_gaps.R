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

coalesce_numeric_columns <- function(df, target_name, source_names) {
  target_vals <- if (target_name %in% names(df)) {
    suppressWarnings(as.numeric(df[[target_name]]))
  } else {
    rep(NA_real_, nrow(df))
  }

  for (source_name in source_names) {
    if (!source_name %in% names(df)) next
    source_vals <- suppressWarnings(as.numeric(df[[source_name]]))
    fill_idx <- !is.finite(target_vals) & is.finite(source_vals)
    target_vals[fill_idx] <- source_vals[fill_idx]
  }

  df[[target_name]] <- target_vals
  df
}

derive_per36_from_pairs <- function(df, target_name, source_minute_pairs) {
  target_vals <- if (target_name %in% names(df)) {
    suppressWarnings(as.numeric(df[[target_name]]))
  } else {
    rep(NA_real_, nrow(df))
  }

  for (pair in source_minute_pairs) {
    source_name <- pair[[1]]
    minute_name <- pair[[2]]
    if (!(source_name %in% names(df)) || !(minute_name %in% names(df))) next

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
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

target_model <- tolower(trimws(Sys.getenv("PREDICTION_GAP_MODEL", "no_college")))
exclude_year <- suppressWarnings(as.integer(Sys.getenv("PREDICTION_GAP_EXCLUDE_YEAR", "2026")))

summary_file <- switch(
  target_model,
  college = "draft_model_summary.csv",
  no_college = "no_college_model_summary.csv",
  stop("Unsupported PREDICTION_GAP_MODEL: ", target_model)
)

prediction_dt <- fread(file.path(draft_dir, "draft_prediction_unified.csv"), na.strings = c("", "NA", "N/A", "NaN"))
summary_dt <- fread(file.path(draft_dir, summary_file), na.strings = c("", "NA", "N/A", "NaN"))
scv_lookup <- rbindlist(
  list(
    fread(file.path(base_dir, "ref", "scvardraft.csv"), na.strings = c("", "NA", "N/A", "NaN")),
    if (file.exists(file.path(base_dir, "ref", "scvardraft_overrides.csv"))) {
      fread(file.path(base_dir, "ref", "scvardraft_overrides.csv"), na.strings = c("", "NA", "N/A", "NaN"))
    } else {
      data.table()
    }
  ),
  use.names = TRUE,
  fill = TRUE
)
if (nrow(scv_lookup) && "name" %in% names(scv_lookup)) {
  score_col <- names(scv_lookup)[tolower(names(scv_lookup)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (!is.na(score_col) && nzchar(score_col)) {
    scv_lookup[, join_player := normalize_join_name(name)]
    scv_lookup[, scv_lookup_value := suppressWarnings(as.numeric(get(score_col)))]
    scv_lookup <- scv_lookup[nzchar(join_player) & is.finite(scv_lookup_value)]
    scv_lookup[, source_priority := seq_len(.N)]
    setorder(scv_lookup, join_player, -source_priority)
    scv_lookup <- unique(scv_lookup[, .(join_player, scv_lookup_value)], by = "join_player")
  } else {
    scv_lookup <- data.table()
  }
}

if (is.finite(exclude_year)) {
  prediction_dt <- prediction_dt[draft_year != exclude_year]
}

if (identical(target_model, "no_college") && "prediction_pool" %in% names(prediction_dt)) {
  prediction_dt <- prediction_dt[prediction_pool == "no_college"]
}
if (identical(target_model, "college") && "prediction_pool" %in% names(prediction_dt)) {
  prediction_dt <- prediction_dt[is.na(prediction_pool) | !nzchar(trimws(prediction_pool)) | prediction_pool %in% c("domestic", "international")]
}

prediction_dt <- add_curated_realgm_features(prediction_dt)
if (nrow(scv_lookup) && "player" %in% names(prediction_dt)) {
  prediction_dt[, row_id___ := seq_len(.N)]
  prediction_dt[, join_player___ := normalize_join_name(player)]
  prediction_dt <- merge(
    prediction_dt,
    scv_lookup,
    by.x = "join_player___",
    by.y = "join_player",
    all.x = TRUE,
    sort = FALSE
  )
  setorder(prediction_dt, row_id___)
  current_scv <- if ("scv_draft" %in% names(prediction_dt)) {
    suppressWarnings(as.numeric(prediction_dt[["scv_draft"]]))
  } else {
    rep(NA_real_, nrow(prediction_dt))
  }
  lookup_scv <- suppressWarnings(as.numeric(prediction_dt[["scv_lookup_value"]]))
  fill_idx <- !is.finite(current_scv) & is.finite(lookup_scv)
  current_scv[fill_idx] <- lookup_scv[fill_idx]
  prediction_dt[, scv_draft := current_scv]
  prediction_dt[, c("row_id___", "join_player___", "scv_lookup_value") := NULL]
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

union_counts <- count_any_missing(prediction_dt, selected_features)

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

top_missing_rows_dt <- copy(prediction_dt)
top_missing_rows_dt[, missing_selected_features := row_missing_counts]
year_gap_dt <- top_missing_rows_dt[, .(
  rows = .N,
  rows_any_missing = sum(missing_selected_features > 0),
  rows_complete = sum(missing_selected_features == 0),
  any_missing_pct = round(100 * sum(missing_selected_features > 0) / .N, 1)
), by = .(draft_year, prediction_pool)]
setorder(year_gap_dt, draft_year, prediction_pool)
top_missing_rows_dt <- top_missing_rows_dt[
  missing_selected_features > 0,
  .(player, draft_year, prediction_pool, source_section, missing_selected_features)
]
setorder(top_missing_rows_dt, -missing_selected_features, draft_year, player)

cat("Prediction data gap report\n")
cat("Model feature set:", target_model, "\n")
cat("Excluded draft year:", if (is.finite(exclude_year)) exclude_year else "none", "\n")
cat("Prediction rows:", nrow(prediction_dt), "\n")
if ("draft_year" %in% names(prediction_dt)) {
  cat("\nRows by draft year/pool:\n")
  print(prediction_dt[, .(rows = .N), by = .(draft_year, prediction_pool)][order(draft_year, prediction_pool)])
}
cat("\nSelected feature union count:", length(selected_features), "\n")
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
print(head(top_missing_rows_dt, 40))
