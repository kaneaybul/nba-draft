library(data.table)

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
draft_dir <- file.path(base_dir, "processed", "draft")
out_dir <- file.path(draft_dir, "tracker_zscore_exploration")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

tracker_script <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
tracker_lines <- readLines(tracker_script, warn = FALSE, encoding = "UTF-8")
execution_cut <- grep("^base_dir <- resolve_base_dir\\(\\)", tracker_lines)[1]
if (!length(execution_cut) || !is.finite(execution_cut)) {
  stop("Could not find execution boundary in ", tracker_script)
}
eval(parse(text = paste(tracker_lines[seq_len(execution_cut - 1)], collapse = "\n")), envir = environment())
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

latest_impact_year <- max(
  fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year,
  na.rm = TRUE
)

fit_years <- 2016:2021
out_years <- 2022L
eval_years <- c(fit_years, out_years)

actual <- build_actual_outcomes(base_dir, latest_impact_year)
panel <- make_prediction_panel(base_dir)
panel[, total_feature := suppressWarnings(as.numeric(TOTAL_pred))]
panel[, off_feature := suppressWarnings(as.numeric(OFF_pred))]
panel[, def_feature := suppressWarnings(as.numeric(DEF_pred))]

adjusted_path <- file.path(draft_dir, "draft_skill_predictions_adjusted.csv")
if (file.exists(adjusted_path)) {
  adjusted_ranks <- fread(adjusted_path, na.strings = c("", "NA", "N/A", "NaN"))
  if (all(c("player", "draft_year", "FINAL_rank") %in% names(adjusted_ranks))) {
    adjusted_ranks[, draft_year := suppressWarnings(as.integer(draft_year))]
    adjusted_ranks[, name_key := normalize_name(player)]
    adjusted_ranks <- adjusted_ranks[
      is.finite(draft_year) & nzchar(name_key),
      .(draft_year, name_key, saved_FINAL_rank = suppressWarnings(as.numeric(FINAL_rank)))
    ]
    setorder(adjusted_ranks, draft_year, name_key, saved_FINAL_rank, na.last = TRUE)
    adjusted_ranks <- unique(adjusted_ranks, by = c("draft_year", "name_key"))
    panel <- merge(panel, adjusted_ranks, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  }
}

tracker_boards <- read_tracker_workbook_boards(base_dir, eval_years)
tracker_boards[, name_key := normalize_name(player)]
tracker_boards[, board_rank := suppressWarnings(as.numeric(board_rank))]

historical_consensus <- tracker_boards[
  !board %chin% c("Legacy Me Model") & is.finite(board_rank),
  .(
    hist_board_rank = mean(board_rank, na.rm = TRUE),
    hist_board_count = .N
  ),
  by = .(draft_year, name_key)
]
panel <- merge(panel, historical_consensus, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
panel[, hist_board_proxy := fifelse(is.finite(hist_board_rank), hist_board_rank, 65)]
panel[, hist_board_feature := -z_within(log1p(hist_board_proxy), draft_year)]

build_external_scores_for_years <- function(years) {
  tracker_joined <- merge(
    actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
    tracker_boards[draft_year %in% years, .(draft_year, name_key, board, board_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    allow.cartesian = TRUE,
    sort = FALSE
  )
  external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]

  actual_pick_scores <- actual[draft_year %in% years, .(score = score_board_year(.SD, "actual_pick")), by = draft_year]
  actual_pick_scores[, board := "NBA Draft - Actual"]

  base_joined <- merge(
    actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
    panel[draft_year %in% years, .(draft_year, name_key, board_rank = base_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  base_scores <- base_joined[, .(score = score_board_year(.SD, "board_rank")), by = draft_year]
  base_scores[, board := "SCV Base Model"]

  rbindlist(
    list(
      external_scores,
      actual_pick_scores[, .(draft_year, board, score)],
      base_scores[, .(draft_year, board, score)]
    ),
    use.names = TRUE,
    fill = TRUE
  )
}

external_scores <- build_external_scores_for_years(eval_years)

rank_desc <- function(x) {
  ranks <- integer(length(x))
  ranks[order(-x, seq_along(x), na.last = TRUE)] <- seq_along(x)
  ranks
}

prepare_cache <- function(feature_cols, years) {
  lapply(years, function(year) {
    year_panel <- copy(panel[draft_year == year])
    year_actual <- actual[draft_year == year]
    feature_matrix <- as.matrix(year_panel[, ..feature_cols])
    storage.mode(feature_matrix) <- "numeric"
    feature_matrix[!is.finite(feature_matrix)] <- 0
    list(
      year = year,
      feature_matrix = feature_matrix,
      actual_idx = match(year_actual$name_key, year_panel$name_key),
      actual_rank = suppressWarnings(as.numeric(year_actual$actual_rank)),
      actual_weight = suppressWarnings(as.numeric(year_actual$actual_weight))
    )
  })
}

score_rank_vector <- function(actual_rank, candidate_rank, actual_weight, penalty_base = 0.97, penalty_power = 1.25, rank_cap = 60, unranked_rank = 65) {
  eval_rank <- ifelse(is.finite(candidate_rank), pmin(candidate_rank, rank_cap), unranked_rank)
  accuracy <- penalty_base ^ (abs(actual_rank - eval_rank) ^ penalty_power)
  sum(actual_weight * accuracy, na.rm = TRUE)
}

score_cached_weights <- function(cache, weights, external_scores) {
  year_scores <- vapply(cache, function(item) {
    candidate_total <- as.numeric(item$feature_matrix %*% weights)
    candidate_rank <- rank_desc(candidate_total)
    actual_candidate_rank <- rep(NA_real_, length(item$actual_rank))
    matched <- is.finite(item$actual_idx)
    actual_candidate_rank[matched] <- candidate_rank[item$actual_idx[matched]]
    score_rank_vector(item$actual_rank, actual_candidate_rank, item$actual_weight)
  }, numeric(1))

  years <- vapply(cache, `[[`, numeric(1), "year")
  weights_by_year <- year_weight(years, latest_impact_year)
  z_scores <- vapply(seq_along(years), function(i) {
    ext <- external_scores[draft_year == years[[i]] & is.finite(score), score]
    vals <- c(ext, year_scores[[i]])
    sig <- stats::sd(vals, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (year_scores[[i]] - mean(vals, na.rm = TRUE)) / sig
  }, numeric(1))

  list(
    weighted_score = weighted.mean(year_scores, weights_by_year, na.rm = TRUE),
    weighted_z = weighted.mean(z_scores, weights_by_year, na.rm = TRUE),
    year_scores = data.table(draft_year = years, score = year_scores, year_weight = weights_by_year, z_score = z_scores)
  )
}

score_grid <- function(grid, feature_cols, years, center = NULL, penalty = 0.03) {
  cache <- prepare_cache(feature_cols, years)
  if (is.null(center)) center <- setNames(rep(0, length(feature_cols)), feature_cols)
  out <- vector("list", nrow(grid))
  for (i in seq_len(nrow(grid))) {
    weights <- as.numeric(grid[i, ..feature_cols])
    names(weights) <- feature_cols
    score <- score_cached_weights(cache, weights, external_scores)
    penalty_value <- penalty * sum((weights - center[feature_cols]) ^ 2)
    out[[i]] <- cbind(
      grid[i],
      data.table(
        weighted_score = score$weighted_score,
        weighted_z = score$weighted_z,
        objective = score$weighted_z - penalty_value
      )
    )
  }
  rbindlist(out, use.names = TRUE, fill = TRUE)
}

fine_sequence <- function(center, span, step, lower = -Inf, upper = Inf) {
  out <- seq(center - span, center + span, by = step)
  out[out >= lower & out <= upper]
}

fit_grid_two_stage <- function(feature_cols, coarse_grid, center, penalty = 0.03, span = 0.15, step = 0.025, lower = list(), upper = list()) {
  coarse <- score_grid(coarse_grid, feature_cols, fit_years, center, penalty)
  setorder(coarse, -objective, -weighted_z, -weighted_score)
  best <- coarse[1]

  fine_values <- lapply(feature_cols, function(col) {
    lo <- if (col %in% names(lower)) lower[[col]] else -Inf
    hi <- if (col %in% names(upper)) upper[[col]] else Inf
    fine_sequence(best[[col]][1], span, step, lo, hi)
  })
  names(fine_values) <- feature_cols
  fine_grid <- do.call(CJ, fine_values)
  fine <- score_grid(fine_grid, feature_cols, fit_years, center, penalty)
  setorder(fine, -objective, -weighted_z, -weighted_score)

  list(coarse = coarse, fine = fine, best = fine[1])
}

score_rank_col <- function(rank_col, years) {
  joined <- merge(
    actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
    panel[draft_year %in% years, .(draft_year, name_key, candidate_rank = get(rank_col))],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  rows <- joined[, .(score = score_board_year(.SD, "candidate_rank")), by = draft_year]
  rows[, year_weight := year_weight(draft_year, latest_impact_year)]
  rows[, z_score := {
    ext <- external_scores[draft_year == .BY$draft_year & is.finite(score), score]
    vals <- c(ext, score)
    sig <- stats::sd(vals, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(vals, na.rm = TRUE)) / sig
  }, by = draft_year]
  list(
    weighted_score = weighted.mean(rows$score, rows$year_weight, na.rm = TRUE),
    weighted_z = weighted.mean(rows$z_score, rows$year_weight, na.rm = TRUE),
    year_scores = rows
  )
}

evaluate_weights <- function(label, feature_cols, weights, source_note) {
  names(weights) <- feature_cols
  fit_score <- score_cached_weights(prepare_cache(feature_cols, fit_years), weights, external_scores)
  out_score <- score_cached_weights(prepare_cache(feature_cols, out_years), weights, external_scores)
  all_score <- score_cached_weights(prepare_cache(feature_cols, eval_years), weights, external_scores)
  list(
    summary = data.table(
      label = label,
      source_note = source_note,
      fit_weighted_z = fit_score$weighted_z,
      out_2022_z = out_score$weighted_z,
      all_weighted_z = all_score$weighted_z,
      fit_weighted_score = fit_score$weighted_score,
      out_2022_score = out_score$weighted_score,
      all_weighted_score = all_score$weighted_score,
      features = paste(feature_cols, collapse = " + "),
      weights = paste(paste(feature_cols, signif(weights, 6), sep = "="), collapse = "; ")
    ),
    year_scores = all_score$year_scores[, label := label][]
  )
}

evaluate_rank_baseline <- function(label, rank_col, source_note) {
  fit_score <- score_rank_col(rank_col, fit_years)
  out_score <- score_rank_col(rank_col, out_years)
  all_score <- score_rank_col(rank_col, eval_years)
  list(
    summary = data.table(
      label = label,
      source_note = source_note,
      fit_weighted_z = fit_score$weighted_z,
      out_2022_z = out_score$weighted_z,
      all_weighted_z = all_score$weighted_z,
      fit_weighted_score = fit_score$weighted_score,
      out_2022_score = out_score$weighted_score,
      all_weighted_score = all_score$weighted_score,
      features = rank_col,
      weights = ""
    ),
    year_scores = all_score$year_scores[, label := label][]
  )
}

adjustment_path <- file.path(draft_dir, "draft_tracker_model_adjustment.csv")
current_adjustment <- fread(adjustment_path, na.strings = c("", "NA", "N/A", "NaN"))
current_b_age <- suppressWarnings(as.numeric(current_adjustment$b_age[1]))
current_b_pick <- suppressWarnings(as.numeric(current_adjustment$b_pick[1]))

total_feature_cols <- c("total_feature", "age_feature", "pick_feature")
total_center <- c(total_feature = 1, age_feature = 0, pick_feature = 0)

fit_total <- fit_grid_two_stage(
  total_feature_cols,
  CJ(
    total_feature = seq(0.4, 1.8, by = 0.1),
    age_feature = seq(-0.6, 0.4, by = 0.05),
    pick_feature = seq(0, 1.2, by = 0.05)
  ),
  center = total_center,
  span = 0.125,
  step = 0.025,
  lower = list(total_feature = 0, pick_feature = 0)
)

offdef_feature_cols <- c("off_feature", "def_feature", "age_feature", "pick_feature")
offdef_center <- c(off_feature = 1, def_feature = 1, age_feature = 0, pick_feature = 0)
fit_offdef <- fit_grid_two_stage(
  offdef_feature_cols,
  CJ(
    off_feature = seq(0.5, 1.6, by = 0.1),
    def_feature = seq(0.5, 1.6, by = 0.1),
    age_feature = seq(-0.4, 0.3, by = 0.1),
    pick_feature = seq(0, 1.0, by = 0.1)
  ),
  center = offdef_center,
  span = 0.15,
  step = 0.05,
  lower = list(off_feature = 0, def_feature = 0, pick_feature = 0)
)

board_feature_cols <- c("total_feature", "age_feature", "hist_board_feature")
board_center <- c(total_feature = 1, age_feature = 0, hist_board_feature = 0)
fit_board <- fit_grid_two_stage(
  board_feature_cols,
  CJ(
    total_feature = seq(0, 1.5, by = 0.1),
    age_feature = seq(-0.5, 0.5, by = 0.1),
    hist_board_feature = seq(0, 1.5, by = 0.1)
  ),
  center = board_center,
  span = 0.15,
  step = 0.025,
  lower = list(total_feature = 0, hist_board_feature = 0)
)

board_pick_feature_cols <- c("total_feature", "age_feature", "pick_feature", "hist_board_feature")
board_pick_center <- c(total_feature = 1, age_feature = 0, pick_feature = 0, hist_board_feature = 0)
fit_board_pick <- fit_grid_two_stage(
  board_pick_feature_cols,
  CJ(
    total_feature = seq(0, 1.5, by = 0.15),
    age_feature = seq(-0.4, 0.4, by = 0.1),
    pick_feature = seq(0, 1.0, by = 0.1),
    hist_board_feature = seq(0, 1.5, by = 0.15)
  ),
  center = board_pick_center,
  span = 0.15,
  step = 0.05,
  lower = list(total_feature = 0, pick_feature = 0, hist_board_feature = 0)
)

summary_parts <- list()
year_score_parts <- list()

add_result <- function(result) {
  summary_parts[[length(summary_parts) + 1L]] <<- result$summary
  year_score_parts[[length(year_score_parts) + 1L]] <<- result$year_scores
}

add_result(evaluate_rank_baseline("SCV Base Model", "base_rank", "Current unadjusted model rank."))
if ("saved_FINAL_rank" %in% names(panel)) {
  add_result(evaluate_rank_baseline(
    "Saved adjusted rank",
    "saved_FINAL_rank",
    "FINAL_rank already present in draft_skill_predictions_adjusted.csv."
  ))
}
add_result(evaluate_weights(
  "Current tracker adjustment",
  total_feature_cols,
  c(1, current_b_age, current_b_pick),
  "Current live tracker coefficients from draft_tracker_model_adjustment.csv."
))
add_result(evaluate_weights(
  "LOYO-shrunk pick proxy",
  total_feature_cols,
  c(1, 0, 0.3),
  "Simple shrink toward the leave-one-year-out stable pick coefficient."
))
add_result(evaluate_weights(
  "Current age, half pick",
  total_feature_cols,
  c(1, current_b_age, current_b_pick / 2),
  "Same age coefficient, half current pick coefficient."
))
add_result(evaluate_weights(
  "Best total/age/pick grid",
  total_feature_cols,
  as.numeric(fit_total$best[, ..total_feature_cols]),
  "Two-stage grid fit on 2016-2021 with total scale allowed."
))
add_result(evaluate_weights(
  "Best off/def/age/pick grid",
  offdef_feature_cols,
  as.numeric(fit_offdef$best[, ..offdef_feature_cols]),
  "Two-stage grid fit on 2016-2021 with offense and defense separately weighted."
))
add_result(evaluate_weights(
  "Best historical-board proxy grid",
  board_feature_cols,
  as.numeric(fit_board$best[, ..board_feature_cols]),
  "Uses historical public-board consensus instead of actual-pick proxy."
))
add_result(evaluate_weights(
  "Best board + pick proxy grid",
  board_pick_feature_cols,
  as.numeric(fit_board_pick$best[, ..board_pick_feature_cols]),
  "Upper-bound blend using both historical public-board consensus and actual-pick proxy."
))

candidate_summary <- rbindlist(summary_parts, use.names = TRUE, fill = TRUE)
setorder(candidate_summary, -out_2022_z, -all_weighted_z)
year_scores <- rbindlist(year_score_parts, use.names = TRUE, fill = TRUE)

search_summary <- rbindlist(
  list(
    cbind(fit_total$best, data.table(search = "total_age_pick")),
    cbind(fit_offdef$best, data.table(search = "off_def_age_pick")),
    cbind(fit_board$best, data.table(search = "historical_board_proxy")),
    cbind(fit_board_pick$best, data.table(search = "board_plus_pick_proxy"))
  ),
  use.names = TRUE,
  fill = TRUE
)

coverage_summary <- data.table(
  metric = c(
    "latest_impact_year",
    "fit_years",
    "out_years",
    "eval_years",
    "panel_rows_eval",
    "actual_rows_eval",
    "historical_board_feature_rows_eval",
    "historical_board_feature_rows_with_rank_eval"
  ),
  value = c(
    as.character(latest_impact_year),
    paste(fit_years, collapse = ","),
    paste(out_years, collapse = ","),
    paste(eval_years, collapse = ","),
    as.character(nrow(panel[draft_year %in% eval_years])),
    as.character(nrow(actual[draft_year %in% eval_years])),
    as.character(nrow(panel[draft_year %in% eval_years])),
    as.character(nrow(panel[draft_year %in% eval_years & is.finite(hist_board_rank)]))
  )
)

fwrite(candidate_summary, file.path(out_dir, "candidate_summary.csv"), na = "")
fwrite(year_scores[order(label, draft_year)], file.path(out_dir, "candidate_year_scores.csv"), na = "")
fwrite(search_summary, file.path(out_dir, "search_best_coefficients.csv"), na = "")
fwrite(coverage_summary, file.path(out_dir, "coverage_summary.csv"), na = "")

cat("\nCoverage:\n")
print(coverage_summary)
cat("\nCandidate summary, sorted by 2022 holdout z:\n")
print(candidate_summary)
cat("\nBest fitted coefficients:\n")
print(search_summary)
cat("\nWrote scratch outputs to ", out_dir, "\n", sep = "")
