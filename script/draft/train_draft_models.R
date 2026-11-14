draft_model_common_path <- file.path("script", "draft", "draft_model_common.R")
if (!file.exists(draft_model_common_path)) {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    draft_model_common_path <- file.path(dirname(normalizePath(sub(file_arg, "", script_arg[[1]]), winslash = "/", mustWork = FALSE)), "draft_model_common.R")
  }
}
source(draft_model_common_path, local = TRUE)

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
model_results_dir <- file.path(base_dir, "processed", "modelresults")
ref_dir <- file.path(base_dir, "ref")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

training_file <- file.path(draft_dir, "draft_training_data.csv")
default_pred_specs <- paste(
  sprintf("domestic=%s", file.path(draft_dir, "draft_prediction_domestic.csv")),
  sprintf("international=%s", file.path(draft_dir, "draft_prediction_international.csv")),
  sep = ";"
)

training_file <- Sys.getenv("DRAFT_TRAINING_FILE", file.path(draft_dir, "draft_training_data.csv"))
pred_specs <- parse_prediction_specs(Sys.getenv("DRAFT_PREDICTION_SPECS", default_pred_specs))
output_preds <- Sys.getenv("DRAFT_OUTPUT_PREDS", file.path(draft_dir, "draft_skill_predictions_output.csv"))
models_rds <- Sys.getenv("DRAFT_MODELS_RDS", file.path(draft_dir, "trained_skill_models.rds"))
summary_fp <- Sys.getenv("DRAFT_SUMMARY_FP", file.path(draft_dir, "draft_model_summary.csv"))
detail_fp <- Sys.getenv("DRAFT_DETAIL_FP", file.path(draft_dir, "draft_model_feature_details.csv"))
summary_history_fp <- Sys.getenv("DRAFT_SUMMARY_HISTORY_FP", default_history_path(summary_fp))
skill_file <- file.path(live_dir, "skilloutput.csv")
skillmap_fp <- file.path(ref_dir, "skillmap.csv")
scv_draft_fp <- file.path(ref_dir, "scvardraft.csv")
scv_draft_override_fp <- file.path(ref_dir, "scvardraft_overrides.csv")
off_results_fp <- file.path(model_results_dir, "off_lm_1_results.csv")
def_results_fp <- file.path(model_results_dir, "def_lm_1_results.csv")
scv_draft_lookup <- load_scv_draft_lookup(scv_draft_fp, scv_draft_override_fp)
rollup_config <- load_rollup_config(skillmap_fp, off_results_fp, def_results_fp)
target_draft_year <- parse_optional_int_env("DRAFT_TARGET_DRAFT_YEAR")
publish_year_min <- parse_optional_year_env("DRAFT_PUBLISH_YEAR_MIN")
publish_year_max <- parse_optional_year_env("DRAFT_PUBLISH_YEAR_MAX")
preserve_existing_output <- identical(
  tolower(trimws(Sys.getenv("DRAFT_PRESERVE_EXISTING_OUTPUT", if (is.finite(target_draft_year)) "true" else "false"))),
  "true"
)

set.seed(123)
min_train_rows <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_TRAIN_ROWS", "25")))
if (!is.finite(min_train_rows) || min_train_rows < 5L) min_train_rows <- 25L

if (is.finite(target_draft_year)) {
  cat("Target draft-year scoring mode active ->", target_draft_year, "\n")
}

cat("Loading training data ...\n")
if (!file.exists(training_file)) {
  stop("Training file not found: ", training_file)
}

train_df <- as.data.frame(fread(training_file, na.strings = c("", "NA", "N/A", "NaN")))
train_df <- add_alias_columns(train_df)
train_df <- add_curated_realgm_features(train_df)

refresh_training_targets_enabled <- !tolower(trimws(Sys.getenv("DRAFT_REFRESH_TRAINING_TARGETS", "true"))) %in% c("0", "false", "no")
has_aggregated_training_targets <- "target_aggregation" %in% names(train_df) &&
  any(grepl("^best_[0-9]+yr_skill_avg", as.character(train_df$target_aggregation)))

if (refresh_training_targets_enabled && has_aggregated_training_targets) {
  cat("Skipping single-season target refresh because training data uses aggregated skill targets.\n")
} else if (refresh_training_targets_enabled && file.exists(skill_file)) {
  skill_dt <- fread(skill_file, na.strings = c("", "NA", "N/A", "NaN"))
  train_dt <- as.data.table(train_df)
  train_dt[, nba_id := as.character(nba_id)]
  train_dt[, outcome_year := suppressWarnings(as.integer(outcome_year))]
  skill_dt <- as.data.table(add_alias_columns(skill_dt))
  train_dt <- refresh_training_targets(train_dt, skill_dt)
  fwrite(train_dt, training_file, na = "")
  train_df <- as.data.frame(train_dt)
  cat("Refreshed training targets from ->", skill_file, "\n")
  cat("Updated training data ->", training_file, "\n")
}

predictor_source_files <- pred_specs$path[file.exists(pred_specs$path)]
if (length(predictor_source_files)) {
  predictor_source_dt <- rbindlist(lapply(predictor_source_files, function(fp) fread(fp, na.strings = c("", "NA", "N/A", "NaN"))), use.names = TRUE, fill = TRUE)
  train_dt <- as.data.table(train_df)
  refresh_exclude_cols <- unique(c("nba_id", "outcome_year", "player", "draft_year", "nba_player", "years_after_draft", "match_method", "selection_score", "combined_impact", "impact_total", "max_years_after_draft", "eligible_target_seasons", "target_aggregation", "off_dep", "def_dep", candidate_exclude_targets))
  refresh_predictor_cols <- setdiff(intersect(names(train_dt), names(predictor_source_dt)), refresh_exclude_cols)
  train_dt <- refresh_training_predictors(train_dt, predictor_source_dt, predictor_cols = refresh_predictor_cols)
  fwrite(train_dt, training_file, na = "")
  train_df <- as.data.frame(train_dt)
  cat("Refreshed training predictors from draft prediction files ->", paste(predictor_source_files, collapse = ", "), "\n")
  cat("Updated training data ->", training_file, "\n")
}

train_df <- add_curated_realgm_features(train_df)
train_df <- add_scv_draft_feature(train_df, scv_draft_lookup)

trained_models <- list()
summary_rows <- list()
detail_rows <- list()

for (skill in skill_targets) {
  if (!skill %in% names(train_df)) {
    warning(sprintf("Target skill column '%s' not found - skipped", skill))
    next
  }

  skill_candidate_cols <- get_candidate_predictors(train_df, candidate_exclude_targets, skill_name = skill)
  skill_candidate_cols <- apply_skill_feature_policy(skill_candidate_cols, skill)
  model_df <- train_df[, c("player", "draft_year", skill, skill_candidate_cols), drop = FALSE]
  model_df[[skill]] <- suppressWarnings(as.numeric(model_df[[skill]]))
  model_df <- model_df[is.finite(model_df[[skill]]), , drop = FALSE]

  if (nrow(model_df) < min_train_rows) {
    warning(sprintf("[%s] too few non-missing rows to train (need %d, found %d) - skipped", skill, min_train_rows, nrow(model_df)))
    next
  }

  usable_candidates <- skill_candidate_cols[vapply(model_df[, skill_candidate_cols, drop = FALSE], function(x) is.numeric(x) && is.finite(sd(x, na.rm = TRUE)) && sd(x, na.rm = TRUE) > 0, logical(1))]
  usable_candidates_before_missing_filter <- usable_candidates
  usable_candidates <- filter_candidate_predictors_by_missingness(model_df, usable_candidates, skill)
  missingness_dropped_predictors <- setdiff(usable_candidates_before_missing_filter, usable_candidates)
  if (length(usable_candidates) < 2L) {
    warning(sprintf("[%s] not enough usable predictors after filtering - skipped", skill))
    next
  }

  feature_cap <- get_skill_feature_cap(skill, length(usable_candidates))
  anchor_preds <- unique(c(
    get_skill_forced_predictors(skill, usable_candidates),
    get_skill_anchor_predictors(skill, usable_candidates)
  ))
  enabled_model_families <- get_enabled_model_families()
  candidate_fits <- list()
  if ("elastic_net_family" %in% enabled_model_families) {
    candidate_fits$elastic_net_family <- fit_glmnet_temporal_search(model_df, skill, usable_candidates, feature_cap, anchor_preds, c(0, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 1.00), min_train_rows)
  }
  if ("ranger" %in% enabled_model_families) {
    candidate_fits$ranger <- fit_ranger_temporal_search(model_df, skill, usable_candidates, feature_cap, anchor_preds, min_train_rows)
  }
  chosen_model <- choose_skill_model_family(skill, candidate_fits)
  if (is.null(chosen_model)) {
    warning(sprintf("[%s] all model searches failed - skipped", skill))
    next
  }

  model_type <- chosen_model$model_type
  best_fit <- chosen_model$fit
  protected_preds <- get_skill_forced_predictors(skill, usable_candidates)
  best_fit <- prune_selected_features_by_validation(model_df, skill, model_type, best_fit, min_train_rows, protected_preds)
  scoring_df <- apply_preprocess_recipe(model_df, best_fit$preprocess_recipe)

  if (model_type == "elastic_net_family") {
    train_pred <- as.numeric(predict(best_fit$fit, newx = make_glmnet_matrix(scoring_df, best_fit$preds), s = "lambda.min"))
    trained_models[[skill]] <- list(
      model_type = model_type,
      fit = best_fit$fit,
      selected_features = best_fit$preds,
      preprocess_recipe = best_fit$preprocess_recipe,
      tuned_alpha = best_fit$alpha,
      tuned_lambda = best_fit$lambda,
      tuned_mtry = NA_real_,
      tuned_min_node_size = NA_real_,
      tuned_sample_fraction = NA_real_
    )
    detail_rows[[skill]] <- rbindlist(Filter(Negate(is.null), list(extract_glmnet_feature_details(skill, best_fit), extract_temporal_stability_details(skill, model_type, best_fit$stability_dt, best_fit$preds))), use.names = TRUE, fill = TRUE)
    search_metric <- if (identical(best_fit$validation_scheme, "rolling_draft_year")) "temporal_mse" else "cv_mse"
    search_metric_value <- if (identical(best_fit$validation_scheme, "rolling_draft_year")) best_fit$temporal_mse else best_fit$cv_mse
    tuned_alpha <- round(best_fit$alpha, 4)
    tuned_lambda <- round(best_fit$lambda, 6)
    tuned_mtry <- NA_integer_
    tuned_min_node_size <- NA_integer_
    tuned_sample_fraction <- NA_real_
  } else if (model_type == "ranger") {
    train_pred <- as.numeric(predict(best_fit$fit, data = scoring_df)$predictions)
    trained_models[[skill]] <- list(
      model_type = model_type,
      fit = best_fit$fit,
      selected_features = best_fit$preds,
      preprocess_recipe = best_fit$preprocess_recipe,
      tuned_alpha = NA_real_,
      tuned_lambda = NA_real_,
      tuned_mtry = best_fit$mtry,
      tuned_min_node_size = best_fit$min.node.size,
      tuned_sample_fraction = best_fit$sample.fraction
    )
    detail_rows[[skill]] <- rbindlist(Filter(Negate(is.null), list(extract_ranger_feature_details(skill, best_fit$fit), extract_temporal_stability_details(skill, model_type, best_fit$stability_dt, best_fit$preds))), use.names = TRUE, fill = TRUE)
    search_metric <- if (identical(best_fit$validation_scheme, "rolling_draft_year")) "temporal_r2" else "oob_r2"
    search_metric_value <- if (identical(best_fit$validation_scheme, "rolling_draft_year")) best_fit$temporal_r2 else best_fit$oob_r2
    tuned_alpha <- NA_real_
    tuned_lambda <- NA_real_
    tuned_mtry <- best_fit$mtry
    tuned_min_node_size <- best_fit$min.node.size
    tuned_sample_fraction <- best_fit$sample.fraction
  } else {
    warning(sprintf("[%s] selected unsupported model type '%s' - skipped", skill, model_type))
    next
  }

  selected_stability <- compute_selected_feature_stability(best_fit$stability_dt, best_fit$preds)
  selected_complete_rows <- count_complete_numeric_rows(model_df, best_fit$preds)
  candidate_complete_rows <- count_complete_numeric_rows(model_df, usable_candidates)
  measurement_complete_rows <- count_complete_numeric_rows(
    train_df[is.finite(suppressWarnings(as.numeric(train_df[[skill]]))), , drop = FALSE],
    c("height_wo_shoes_in", "wingspan_in")
  )
  selected_complete_pct <- if (is.finite(selected_complete_rows) && nrow(model_df) > 0) round(100 * selected_complete_rows / nrow(model_df), 2) else NA_real_
  candidate_complete_pct <- if (is.finite(candidate_complete_rows) && nrow(model_df) > 0) round(100 * candidate_complete_rows / nrow(model_df), 2) else NA_real_
  measurement_complete_pct <- if (is.finite(measurement_complete_rows) && nrow(model_df) > 0) round(100 * measurement_complete_rows / nrow(model_df), 2) else NA_real_
  selected_max_missing_pct <- max_missing_numeric_pct(model_df, best_fit$preds)
  validation_quality_flag <- assess_validation_quality(best_fit$validation_scheme, best_fit$temporal_splits, best_fit$validation_rows)
  detail_dt <- detail_rows[[skill]]
  top_variable <- if (!is.null(detail_dt) && nrow(detail_dt)) detail_dt$variable[[1]] else NA_character_
  top_value <- if (!is.null(detail_dt) && nrow(detail_dt)) round(detail_dt$detail_value[[1]], 4) else NA_real_

  summary_rows[[skill]] <- data.table(
    skill = skill,
    model_type = model_type,
    n_rows = nrow(model_df),
    candidate_pool_size_before_missing_filter = length(usable_candidates_before_missing_filter),
    candidate_pool_size = length(usable_candidates),
    missingness_dropped_predictors = paste(missingness_dropped_predictors, collapse = ", "),
    ablation_pruned_features = paste(best_fit$ablation_pruned_features, collapse = ", "),
    feature_cap = feature_cap,
    anchor_features = paste(anchor_preds, collapse = ", "),
    predictor_set = length(best_fit$preds),
    train_r2_pct = round(100 * calc_r2(scoring_df[[skill]], train_pred), 2),
    search_metric = search_metric,
    search_metric_value = round(search_metric_value, 6),
    temporal_mse = round(best_fit$temporal_mse, 6),
    temporal_r2 = round(best_fit$temporal_r2, 6),
    validation_scheme = best_fit$validation_scheme,
    validation_quality_flag = validation_quality_flag,
    temporal_splits = best_fit$temporal_splits,
    validation_rows = best_fit$validation_rows,
    selected_feature_complete_rows = selected_complete_rows,
    selected_feature_complete_pct = selected_complete_pct,
    selected_feature_max_missing_pct = selected_max_missing_pct,
    candidate_feature_complete_rows = candidate_complete_rows,
    candidate_feature_complete_pct = candidate_complete_pct,
    measurement_complete_rows = measurement_complete_rows,
    measurement_complete_pct = measurement_complete_pct,
    selected_feature_mean_temporal_freq = round(selected_stability$mean_frequency, 6),
    selected_feature_min_temporal_freq = round(selected_stability$min_frequency, 6),
    top_variable = top_variable,
    top_variable_value = top_value,
    predictors = paste(best_fit$preds, collapse = ", "),
    tuned_alpha = tuned_alpha,
    tuned_lambda = tuned_lambda,
    tuned_mtry = tuned_mtry,
    tuned_min_node_size = tuned_min_node_size,
    tuned_sample_fraction = tuned_sample_fraction
  )
}

if (length(summary_rows) == 0) stop("No models trained - aborting.")

summary_df <- rbindlist(summary_rows, use.names = TRUE, fill = TRUE)
setorder(summary_df, skill)
summary_df[, model_rank := frank(-temporal_r2, ties.method = "min", na.last = "keep")]
summary_df <- compute_prior_run_stability(summary_df, summary_history_fp)

detail_df <- rbindlist(Filter(Negate(is.null), detail_rows), use.names = TRUE, fill = TRUE)

saveRDS(
  list(
    models = trained_models,
    production_model_map = setNames(vapply(trained_models, function(x) x$model_type, character(1)), names(trained_models)),
    candidate_predictors = setNames(lapply(skill_targets, function(skill) {
      apply_skill_feature_policy(get_candidate_predictors(train_df, candidate_exclude_targets, skill_name = skill), skill)
    }), skill_targets)
  ),
  models_rds
)
fwrite(summary_df, summary_fp, na = "")
append_summary_history(summary_df, summary_history_fp, format(Sys.time(), "%Y-%m-%d %H:%M:%S"))
if (nrow(detail_df)) fwrite(detail_df, detail_fp, na = "")

cat("Models saved ->", models_rds, "\n")
cat("Summary saved ->", summary_fp, "\n")
cat("Summary history saved ->", summary_history_fp, "\n")
if (file.exists(detail_fp)) cat("Feature details saved ->", detail_fp, "\n")


cat(sprintf("Trained %d production draft skill models.\n", length(trained_models)))
cat("Training-only run complete. Use script/draft/score_draft_predictions.R to score/publish predictions without retraining.\n")
