library(data.table)

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
exp_dir <- file.path(base_dir, "processed", "draft", "relative_wingspan_skill_sweep")
dir.create(exp_dir, recursive = TRUE, showWarnings = FALSE)

model_script <- file.path(base_dir, "script", "draft", "draftmodeltrain.txt")
model_lines <- readLines(model_script, warn = FALSE)
cut <- grep("^candidate_exclude_targets <-", model_lines)[1]
eval(parse(text = paste(model_lines[seq_len(cut - 1)], collapse = "\n")), envir = .GlobalEnv)

primary_pos <- function(x) {
  x <- trimws(as.character(x))
  x[is.na(x) | x == ""] <- "UNKNOWN"
  sub("-.*$", "", x)
}

add_relative_wingspan <- function(dt) {
  dt <- copy(dt)
  if (!"wingspan_in" %in% names(dt)) {
    dt[, `r.wingspan` := NA_real_]
    return(dt)
  }

  dt[, pos_group_for_wing := if ("pos_code" %in% names(dt)) primary_pos(pos_code) else "UNKNOWN"]
  dt[, wingspan_numeric_for_ref := suppressWarnings(as.numeric(wingspan_in))]
  global_mean <- mean(dt$wingspan_numeric_for_ref, na.rm = TRUE)
  global_sd <- sd(dt$wingspan_numeric_for_ref, na.rm = TRUE)
  if (!is.finite(global_sd) || global_sd == 0) global_sd <- 1

  stats <- dt[, .(
    wing_n = sum(is.finite(wingspan_numeric_for_ref)),
    wing_mean = mean(wingspan_numeric_for_ref, na.rm = TRUE),
    wing_sd = sd(wingspan_numeric_for_ref, na.rm = TRUE)
  ), by = pos_group_for_wing]
  stats[wing_n < 3L | !is.finite(wing_mean), wing_mean := global_mean]
  stats[wing_n < 3L | !is.finite(wing_sd) | wing_sd == 0, wing_sd := global_sd]

  dt <- merge(dt, stats[, .(pos_group_for_wing, wing_mean, wing_sd)], by = "pos_group_for_wing", all.x = TRUE, sort = FALSE)
  dt[!is.finite(wing_mean), wing_mean := global_mean]
  dt[!is.finite(wing_sd) | wing_sd == 0, wing_sd := global_sd]
  dt[, `r.wingspan` := (wingspan_numeric_for_ref - wing_mean) / wing_sd]
  dt[, c("pos_group_for_wing", "wingspan_numeric_for_ref", "wing_mean", "wing_sd") := NULL]
  dt
}

parse_predictors <- function(x) {
  out <- trimws(strsplit(as.character(x), ",", fixed = TRUE)[[1]])
  out[nzchar(out)]
}

make_subsets <- function(features, max_size) {
  features <- unique(features[nzchar(features)])
  sizes <- seq.int(2L, min(max_size, length(features)))
  out <- list()
  for (k in sizes) {
    cmb <- combn(features, k, simplify = FALSE)
    out <- c(out, cmb)
  }
  out
}

score_feature_set <- function(train_df, skill, preds, fit_params, label) {
  score <- evaluate_exact_feature_set(
    train_df = as.data.frame(train_df),
    target_col = skill,
    preds = preds,
    model_type = "ranger",
    fit_params = fit_params,
    min_train_rows = 25L
  )
  if (is.null(score)) return(NULL)
  data.table(
    skill = skill,
    variant = label,
    predictors = paste(preds, collapse = ", "),
    predictor_set = length(preds),
    temporal_r2 = score$temporal_r2,
    temporal_mse = score$temporal_mse,
    validation_rows = score$validation_rows,
    temporal_splits = score$temporal_splits,
    includes_r_wingspan = "r.wingspan" %in% preds
  )
}

train_dt <- fread(file.path(base_dir, "processed", "draft", "draft_training_data.csv"), na.strings = c("", "NA", "N/A", "NaN"))
train_dt <- add_relative_wingspan(train_dt)
summary_dt <- fread(file.path(base_dir, "processed", "draft", "draft_model_summary.csv"), na.strings = c("", "NA", "N/A", "NaN"))
skill_targets <- summary_dt$skill
candidate_exclude_targets <- names(get_default_model_preferences())

all_rows <- list()
normal_search_rows <- list()

for (skill in skill_targets) {
  skill_name <- skill
  skill_row <- summary_dt[skill == skill_name][1]
  current_preds <- parse_predictors(skill_row$predictors)
  fit_params <- list(
    mtry = suppressWarnings(as.integer(skill_row$tuned_mtry)),
    min.node.size = suppressWarnings(as.integer(skill_row$tuned_min_node_size)),
    sample.fraction = suppressWarnings(as.numeric(skill_row$tuned_sample_fraction))
  )
  feature_cap <- suppressWarnings(as.integer(skill_row$feature_cap))
  if (!is.finite(feature_cap) || feature_cap < 2L) feature_cap <- max(2L, length(current_preds))

  model_df <- train_dt[, c("player", "draft_year", skill, setdiff(names(train_dt), c("player", "draft_year", skill))), with = FALSE]
  model_df[[skill]] <- suppressWarnings(as.numeric(model_df[[skill]]))
  model_df <- model_df[is.finite(get(skill))]

  subset_features <- unique(c(current_preds, "r.wingspan"))
  subset_features <- subset_features[subset_features %in% names(model_df)]
  subsets <- make_subsets(subset_features, max(feature_cap, length(current_preds)))

  rows <- lapply(subsets, function(preds) {
    label <- if (setequal(preds, current_preds)) {
      "current_selected"
    } else if ("r.wingspan" %in% preds && all(current_preds %in% preds)) {
      "current_plus_r.wingspan"
    } else if ("r.wingspan" %in% preds) {
      "subset_with_r.wingspan"
    } else {
      "subset_without_r.wingspan"
    }
    score_feature_set(model_df, skill, preds, fit_params, label)
  })
  rows <- rbindlist(Filter(Negate(is.null), rows), use.names = TRUE, fill = TRUE)
  if (nrow(rows)) {
    rows[, current_reported_r2 := suppressWarnings(as.numeric(skill_row$temporal_r2))]
    rows[, delta_vs_current_reported := temporal_r2 - current_reported_r2]
    setorder(rows, -temporal_r2, temporal_mse, predictor_set)
    all_rows[[skill]] <- rows
  }

  candidate_cols <- get_candidate_predictors(as.data.frame(model_df), candidate_exclude_targets, skill_name = skill)
  candidate_cols <- apply_skill_feature_policy(candidate_cols, skill)
  if ("r.wingspan" %in% names(model_df) && !("r.wingspan" %in% candidate_cols)) {
    candidate_cols <- unique(c(candidate_cols, "r.wingspan"))
  }
  usable_candidates <- candidate_cols[vapply(model_df[, ..candidate_cols], function(x) {
    vals <- suppressWarnings(as.numeric(x))
    is.finite(sd(vals, na.rm = TRUE)) && sd(vals, na.rm = TRUE) > 0
  }, logical(1))]
  anchor_preds <- unique(c(
    get_skill_forced_predictors(skill, usable_candidates),
    get_skill_anchor_predictors(skill, usable_candidates)
  ))
  search_fit <- fit_ranger_temporal_search(
    train_df = as.data.frame(model_df),
    target_col = skill,
    candidate_cols = usable_candidates,
    feature_cap = feature_cap,
    anchor_preds = anchor_preds,
    min_train_rows = 25L
  )
  if (!is.null(search_fit)) {
    normal_search_rows[[skill]] <- data.table(
      skill = skill,
      variant = "normal_search_with_r.wingspan_available",
      predictors = paste(search_fit$preds, collapse = ", "),
      predictor_set = length(search_fit$preds),
      temporal_r2 = search_fit$temporal_r2,
      temporal_mse = search_fit$temporal_mse,
      validation_rows = search_fit$validation_rows,
      temporal_splits = search_fit$temporal_splits,
      includes_r_wingspan = "r.wingspan" %in% search_fit$preds,
      current_reported_r2 = suppressWarnings(as.numeric(skill_row$temporal_r2)),
      delta_vs_current_reported = search_fit$temporal_r2 - suppressWarnings(as.numeric(skill_row$temporal_r2))
    )
  }
}

subset_results <- rbindlist(all_rows, use.names = TRUE, fill = TRUE)
normal_search <- rbindlist(normal_search_rows, use.names = TRUE, fill = TRUE)
best_by_skill <- subset_results[, .SD[1], by = skill]
best_rwing_by_skill <- subset_results[includes_r_wingspan == TRUE, .SD[1], by = skill]

fwrite(train_dt, file.path(exp_dir, "draft_training_data_with_r_wingspan.csv"), na = "")
fwrite(subset_results, file.path(exp_dir, "subset_sweep_results.csv"), na = "")
fwrite(normal_search, file.path(exp_dir, "normal_search_results.csv"), na = "")
fwrite(best_by_skill, file.path(exp_dir, "best_subset_by_skill.csv"), na = "")
fwrite(best_rwing_by_skill, file.path(exp_dir, "best_r_wingspan_subset_by_skill.csv"), na = "")

cat("Best subset by skill:\n")
print(best_by_skill[, .(skill, temporal_r2, delta_vs_current_reported, includes_r_wingspan, predictors)])
cat("\nBest r.wingspan subset by skill:\n")
print(best_rwing_by_skill[, .(skill, temporal_r2, delta_vs_current_reported, predictors)])
cat("\nNormal search with r.wingspan available:\n")
print(normal_search[, .(skill, temporal_r2, delta_vs_current_reported, includes_r_wingspan, predictors)])
cat("\nOutputs written to: ", exp_dir, "\n", sep = "")
