library(data.table)

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)

# This sources the tracker once to reuse its current panel/actual/external scoring setup.
source(file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R"), local = .GlobalEnv)

prepare_year_cache <- function(panel, actual, years) {
  lapply(years, function(year) {
    year_panel <- copy(panel[draft_year == year])
    year_actual <- actual[draft_year == year]
    actual_idx <- match(year_actual$name_key, year_panel$name_key)
    list(
      year = year,
      total = suppressWarnings(as.numeric(year_panel$TOTAL_pred)),
      age = suppressWarnings(as.numeric(year_panel$age_feature)),
      pick = suppressWarnings(as.numeric(year_panel$pick_feature)),
      actual_idx = actual_idx,
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

rank_desc <- function(x) {
  ranks <- integer(length(x))
  ranks[order(-x, seq_along(x), na.last = TRUE)] <- seq_along(x)
  ranks
}

score_cached_candidate <- function(cache, external_scores, b_total, b_age, b_pick, latest_impact_year) {
  year_scores <- vapply(cache, function(item) {
    candidate_total <- b_total * item$total + b_age * item$age + b_pick * item$pick
    candidate_rank <- rank_desc(candidate_total)
    actual_candidate_rank <- rep(NA_real_, length(item$actual_rank))
    matched_idx <- is.finite(item$actual_idx)
    actual_candidate_rank[matched_idx] <- candidate_rank[item$actual_idx[matched_idx]]
    score_rank_vector(
      actual_rank = item$actual_rank,
      candidate_rank = actual_candidate_rank,
      actual_weight = item$actual_weight
    )
  }, numeric(1))

  years <- vapply(cache, `[[`, numeric(1), "year")
  weights <- year_weight(years, latest_impact_year)
  z_scores <- vapply(seq_along(years), function(i) {
    ext <- external_scores[draft_year == years[[i]] & is.finite(score), score]
    vals <- c(ext, year_scores[[i]])
    sig <- stats::sd(vals, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (year_scores[[i]] - mean(vals, na.rm = TRUE)) / sig
  }, numeric(1))

  list(
    mean_score = weighted.mean(year_scores, weights, na.rm = TRUE),
    mean_z = weighted.mean(z_scores, weights, na.rm = TRUE),
    year_scores = data.table(draft_year = years, score = year_scores, year_weight = weights, z_score = z_scores)
  )
}

score_grid <- function(grid, cache, external_scores, latest_impact_year) {
  out <- vector("list", nrow(grid))
  for (i in seq_len(nrow(grid))) {
    candidate <- score_cached_candidate(
      cache,
      external_scores,
      grid$b_total[[i]],
      grid$b_age[[i]],
      grid$b_pick[[i]],
      latest_impact_year
    )
    out[[i]] <- data.table(
      b_total = grid$b_total[[i]],
      b_age = grid$b_age[[i]],
      b_pick = grid$b_pick[[i]],
      mean_score = candidate$mean_score,
      mean_z = candidate$mean_z,
      objective = candidate$mean_z - 0.03 * ((grid$b_total[[i]] - 1)^2 + grid$b_age[[i]]^2 + grid$b_pick[[i]]^2)
    )
  }
  rbindlist(out)
}

cache <- prepare_year_cache(panel, actual, fit_years)

coarse_grid <- CJ(
  b_total = seq(0.4, 1.8, by = 0.1),
  b_age = seq(-1.5, 1.5, by = 0.1),
  b_pick = seq(-1.5, 1.5, by = 0.1)
)

coarse_results <- score_grid(coarse_grid, cache, external_scores, latest_impact_year)
setorder(coarse_results, -objective, -mean_z, -mean_score)
coarse_best <- coarse_results[1]

fine_grid <- CJ(
  b_total = seq(coarse_best$b_total - 0.15, coarse_best$b_total + 0.15, by = 0.025),
  b_age = seq(coarse_best$b_age - 0.15, coarse_best$b_age + 0.15, by = 0.025),
  b_pick = seq(coarse_best$b_pick - 0.15, coarse_best$b_pick + 0.15, by = 0.025)
)
fine_grid <- fine_grid[b_total > 0]

fine_results <- score_grid(fine_grid, cache, external_scores, latest_impact_year)
setorder(fine_results, -objective, -mean_z, -mean_score)

cat("\nCurrent tracker adjustment:\n")
print(data.table(b_total = 1, b_age = best$b_age, b_pick = best$b_pick, mean_z = best$mean_z))

cat("\nTop objective candidates with fitted total weight:\n")
print(fine_results[1:20])

setorder(fine_results, -mean_z, -mean_score)
cat("\nTop raw-z candidates with fitted total weight:\n")
print(fine_results[1:20])

best_candidate <- fine_results[1]
candidate_scores <- score_cached_candidate(
  cache,
  external_scores,
  best_candidate$b_total,
  best_candidate$b_age,
  best_candidate$b_pick,
  latest_impact_year
)

cat("\nBest raw-z per-year scores:\n")
print(candidate_scores$year_scores)
