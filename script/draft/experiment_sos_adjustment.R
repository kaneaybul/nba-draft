if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
library(data.table)

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
tracker_script <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
tracker_lines <- readLines(tracker_script, warn = FALSE, encoding = "UTF-8")
cut <- grep("^base_dir <- resolve_base_dir\\(\\)", tracker_lines)[1]
eval(parse(text = paste(tracker_lines[seq_len(cut - 1)], collapse = "\n")), envir = .GlobalEnv)
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

rank_desc <- function(x) {
  ranks <- integer(length(x))
  ranks[order(-x, seq_along(x), na.last = TRUE)] <- seq_along(x)
  ranks
}

score_rank_vector <- function(actual_rank, candidate_rank, actual_weight, penalty_base = 0.97, penalty_power = 1.25, rank_cap = 60, unranked_rank = 65) {
  eval_rank <- ifelse(is.finite(candidate_rank), pmin(candidate_rank, rank_cap), unranked_rank)
  accuracy <- penalty_base ^ (abs(actual_rank - eval_rank) ^ penalty_power)
  sum(actual_weight * accuracy, na.rm = TRUE)
}

load_panel_with_sos <- function(base_dir) {
  feature_fp <- file.path(base_dir, "processed", "draft", "draft_prediction_sos_features.csv")
  if (!file.exists(feature_fp)) {
    source(file.path(base_dir, "script", "draft", "build_college_sos_reference.R"), local = new.env(parent = globalenv()))
  }
  if (!file.exists(feature_fp)) {
    stop("Missing SOS feature file after build attempt: ", feature_fp)
  }

  panel <- make_prediction_panel(base_dir)
  sos <- fread(feature_fp, na.strings = c("", "NA", "N/A", "NaN"))
  sos[, draft_year := suppressWarnings(as.integer(draft_year))]
  sos[, name_key := normalize_name(player)]
  sos[, school_sos := suppressWarnings(as.numeric(school_sos))]
  sos[, school_srs := suppressWarnings(as.numeric(school_srs))]
  sos <- unique(
    sos[, .(
      draft_year,
      name_key,
      source_team_for_sos = as.character(team_for_sos),
      matched_school = as.character(matched_school),
      school_sos,
      school_srs,
      sos_matched = as.logical(sos_matched),
      is_non_college_pool = as.logical(is_non_college_pool),
      is_intl_label = as.logical(is_intl_label)
    )],
    by = c("draft_year", "name_key")
  )

  panel <- merge(panel, sos, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  panel[, sos_feature := z_within(school_sos, draft_year)]
  panel[!is.finite(sos_feature), sos_feature := 0]
  panel[]
}

build_external_scores_for_years <- function(base_dir, actual, panel, years) {
  tracker_boards <- read_tracker_workbook_boards(base_dir, years)
  if (nrow(tracker_boards)) {
    tracker_boards[, name_key := normalize_name(player)]
    tracker_joined <- merge(
      actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
      tracker_boards[, .(draft_year, name_key, board, board_rank)],
      by = c("draft_year", "name_key"),
      all.x = TRUE,
      allow.cartesian = TRUE,
      sort = FALSE
    )
    external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]
  } else {
    external_scores <- data.table(draft_year = integer(), board = character(), score = numeric())
  }

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
  )[is.finite(score)]
}

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
      sos = suppressWarnings(as.numeric(year_panel$sos_feature)),
      actual_idx = actual_idx,
      actual_rank = suppressWarnings(as.numeric(year_actual$actual_rank)),
      actual_weight = suppressWarnings(as.numeric(year_actual$actual_weight))
    )
  })
}

score_cached_candidate <- function(cache, external_scores, b_age, b_pick, b_sos, latest_impact_year) {
  years <- vapply(cache, `[[`, numeric(1), "year")
  year_scores <- vapply(cache, function(item) {
    candidate_total <- item$total + b_age * item$age + b_pick * item$pick + b_sos * item$sos
    candidate_rank <- rank_desc(candidate_total)
    actual_candidate_rank <- rep(NA_real_, length(item$actual_rank))
    matched_idx <- is.finite(item$actual_idx)
    actual_candidate_rank[matched_idx] <- candidate_rank[item$actual_idx[matched_idx]]
    score_rank_vector(item$actual_rank, actual_candidate_rank, item$actual_weight)
  }, numeric(1))

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
    year_scores = data.table(draft_year = years, score = year_scores, z_score = z_scores, year_weight = weights)
  )
}

score_grid <- function(grid, cache, external_scores, latest_impact_year) {
  rows <- vector("list", nrow(grid))
  for (i in seq_len(nrow(grid))) {
    candidate <- score_cached_candidate(
      cache,
      external_scores,
      grid$b_age[[i]],
      grid$b_pick[[i]],
      grid$b_sos[[i]],
      latest_impact_year
    )
    rows[[i]] <- data.table(
      b_age = grid$b_age[[i]],
      b_pick = grid$b_pick[[i]],
      b_sos = grid$b_sos[[i]],
      mean_score = candidate$mean_score,
      mean_z = candidate$mean_z,
      objective = candidate$mean_z - 0.03 * (grid$b_age[[i]]^2 + grid$b_pick[[i]]^2 + grid$b_sos[[i]]^2)
    )
  }
  out <- rbindlist(rows)
  setorder(out, -objective, -mean_z, -mean_score)
  out
}

fit_adjustment_grid <- function(cache, external_scores, latest_impact_year, include_sos = TRUE) {
  coarse_step <- suppressWarnings(as.numeric(Sys.getenv("DRAFT_SOS_COARSE_STEP", "0.1")))
  fine_step <- suppressWarnings(as.numeric(Sys.getenv("DRAFT_SOS_FINE_STEP", "0.025")))
  if (!is.finite(coarse_step) || coarse_step <= 0 || coarse_step > 0.25) coarse_step <- 0.1
  if (!is.finite(fine_step) || fine_step <= 0 || fine_step > 0.1) fine_step <- 0.025

  coarse_grid <- CJ(
    b_age = seq(-1.2, 1.2, by = coarse_step),
    b_pick = seq(-1.2, 1.2, by = coarse_step),
    b_sos = if (include_sos) seq(-1.2, 1.2, by = coarse_step) else 0
  )
  coarse <- score_grid(coarse_grid, cache, external_scores, latest_impact_year)
  coarse_best <- coarse[1]

  fine_grid <- CJ(
    b_age = seq(coarse_best$b_age - 0.15, coarse_best$b_age + 0.15, by = fine_step),
    b_pick = seq(coarse_best$b_pick - 0.15, coarse_best$b_pick + 0.15, by = fine_step),
    b_sos = if (include_sos) seq(coarse_best$b_sos - 0.15, coarse_best$b_sos + 0.15, by = fine_step) else 0
  )
  fine <- score_grid(fine_grid, cache, external_scores, latest_impact_year)
  list(best = fine[1], coarse = coarse, fine = fine)
}

fit_loyo <- function(panel, actual, external_scores, fit_years, latest_impact_year, include_sos) {
  rbindlist(lapply(fit_years, function(left_out) {
    train_years <- setdiff(fit_years, left_out)
    train_cache <- prepare_year_cache(panel, actual, train_years)
    fit <- fit_adjustment_grid(train_cache, external_scores, latest_impact_year, include_sos = include_sos)
    best <- fit$best
    test_cache <- prepare_year_cache(panel, actual, left_out)
    test <- score_cached_candidate(test_cache, external_scores, best$b_age, best$b_pick, best$b_sos, latest_impact_year)
    data.table(
      left_out_year = left_out,
      b_age = best$b_age,
      b_pick = best$b_pick,
      b_sos = best$b_sos,
      heldout_score = test$mean_score,
      heldout_z = test$mean_z
    )
  }))
}

latest_impact_year <- max(
  fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year,
  na.rm = TRUE
)
fit_years <- as.integer(strsplit(Sys.getenv("DRAFT_TRACKER_FIT_YEARS", "2016,2017,2018,2019,2020,2021,2022"), ",")[[1]])
fit_years <- fit_years[is.finite(fit_years)]

actual <- build_actual_outcomes(base_dir, latest_impact_year)
panel <- load_panel_with_sos(base_dir)
fit_external_scores <- build_external_scores_for_years(base_dir, actual, panel, fit_years)
fit_cache <- prepare_year_cache(panel, actual, fit_years)

fit_no_sos <- fit_adjustment_grid(fit_cache, fit_external_scores, latest_impact_year, include_sos = FALSE)
fit_with_sos <- fit_adjustment_grid(fit_cache, fit_external_scores, latest_impact_year, include_sos = TRUE)

loyo_no_sos <- fit_loyo(panel, actual, fit_external_scores, fit_years, latest_impact_year, include_sos = FALSE)
loyo_no_sos[, model := "age_pick"]
loyo_with_sos <- fit_loyo(panel, actual, fit_external_scores, fit_years, latest_impact_year, include_sos = TRUE)
loyo_with_sos[, model := "age_pick_sos"]
loyo <- rbindlist(list(loyo_no_sos, loyo_with_sos), use.names = TRUE, fill = TRUE)

post_years <- sort(intersect(setdiff(unique(actual$draft_year), fit_years), unique(panel$draft_year)))
post_years <- post_years[post_years > max(fit_years)]
post_external_scores <- build_external_scores_for_years(base_dir, actual, panel, post_years)
post_cache <- prepare_year_cache(panel, actual, post_years)
post_no_sos <- score_cached_candidate(
  post_cache,
  post_external_scores,
  fit_no_sos$best$b_age,
  fit_no_sos$best$b_pick,
  fit_no_sos$best$b_sos,
  latest_impact_year
)
post_with_sos <- score_cached_candidate(
  post_cache,
  post_external_scores,
  fit_with_sos$best$b_age,
  fit_with_sos$best$b_pick,
  fit_with_sos$best$b_sos,
  latest_impact_year
)

coverage <- panel[, .(
  prospects = .N,
  sos_matched = sum(sos_matched == TRUE, na.rm = TRUE),
  college_sos_available = sum(is.finite(school_sos), na.rm = TRUE)
), by = draft_year][order(draft_year)]

summary <- rbindlist(list(
  data.table(
    model = "age_pick",
    b_age = fit_no_sos$best$b_age,
    b_pick = fit_no_sos$best$b_pick,
    b_sos = fit_no_sos$best$b_sos,
    fit_mean_score = fit_no_sos$best$mean_score,
    fit_mean_z = fit_no_sos$best$mean_z,
    fit_objective = fit_no_sos$best$objective,
    loyo_mean_score = mean(loyo_no_sos$heldout_score, na.rm = TRUE),
    loyo_mean_z = mean(loyo_no_sos$heldout_z, na.rm = TRUE),
    post_mean_score = post_no_sos$mean_score,
    post_mean_z = post_no_sos$mean_z
  ),
  data.table(
    model = "age_pick_sos",
    b_age = fit_with_sos$best$b_age,
    b_pick = fit_with_sos$best$b_pick,
    b_sos = fit_with_sos$best$b_sos,
    fit_mean_score = fit_with_sos$best$mean_score,
    fit_mean_z = fit_with_sos$best$mean_z,
    fit_objective = fit_with_sos$best$objective,
    loyo_mean_score = mean(loyo_with_sos$heldout_score, na.rm = TRUE),
    loyo_mean_z = mean(loyo_with_sos$heldout_z, na.rm = TRUE),
    post_mean_score = post_with_sos$mean_score,
    post_mean_z = post_with_sos$mean_z
  )
))

year_scores <- rbindlist(list(
  cbind(model = "age_pick", fit_no_sos$best[, .(b_age, b_pick, b_sos)], score_cached_candidate(fit_cache, fit_external_scores, fit_no_sos$best$b_age, fit_no_sos$best$b_pick, fit_no_sos$best$b_sos, latest_impact_year)$year_scores, sample = "fit"),
  cbind(model = "age_pick_sos", fit_with_sos$best[, .(b_age, b_pick, b_sos)], score_cached_candidate(fit_cache, fit_external_scores, fit_with_sos$best$b_age, fit_with_sos$best$b_pick, fit_with_sos$best$b_sos, latest_impact_year)$year_scores, sample = "fit"),
  cbind(model = "age_pick", fit_no_sos$best[, .(b_age, b_pick, b_sos)], post_no_sos$year_scores, sample = "post"),
  cbind(model = "age_pick_sos", fit_with_sos$best[, .(b_age, b_pick, b_sos)], post_with_sos$year_scores, sample = "post")
), use.names = TRUE, fill = TRUE)

out_dir <- file.path(base_dir, "processed", "draft", "sos_adjustment_experiment")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
fwrite(summary, file.path(out_dir, "summary.csv"), na = "")
fwrite(loyo[order(model, left_out_year)], file.path(out_dir, "loyo.csv"), na = "")
fwrite(year_scores[order(sample, draft_year, model)], file.path(out_dir, "year_scores.csv"), na = "")
fwrite(coverage, file.path(out_dir, "coverage.csv"), na = "")

cat("SOS adjustment experiment complete.\n")
cat("fit_years=", paste(fit_years, collapse = ","), "\n", sep = "")
cat("post_years=", paste(post_years, collapse = ","), "\n\n", sep = "")
print(summary)
cat("\nLOYO:\n")
print(loyo[order(model, left_out_year)])
