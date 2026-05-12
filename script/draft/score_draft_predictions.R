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
model_results_dir <- file.path(base_dir, "processed", "modelresults")
ref_dir <- file.path(base_dir, "ref")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

target_draft_year <- parse_optional_int_env("DRAFT_TARGET_DRAFT_YEAR")
if (!is.finite(target_draft_year)) {
  stop("Score-only draft prediction requires DRAFT_TARGET_DRAFT_YEAR, e.g. DRAFT_TARGET_DRAFT_YEAR=2026.")
}

default_main_specs <- paste(
  sprintf("domestic=%s", file.path(draft_dir, "draft_prediction_domestic.csv")),
  sprintf("international=%s", file.path(draft_dir, "draft_prediction_international.csv")),
  sep = ";"
)
default_no_college_specs <- sprintf("no_college=%s", file.path(draft_dir, "no_college_prediction.csv"))

main_specs <- parse_prediction_specs(Sys.getenv("DRAFT_MAIN_PREDICTION_SPECS", default_main_specs))
no_college_specs <- parse_prediction_specs(Sys.getenv("DRAFT_NO_COLLEGE_PREDICTION_SPECS", default_no_college_specs))

main_models_rds <- Sys.getenv("DRAFT_MODELS_RDS", file.path(draft_dir, "trained_skill_models.rds"))
no_college_models_rds <- Sys.getenv("DRAFT_NO_COLLEGE_MODELS_RDS", file.path(draft_dir, "no_college_trained_skill_models.rds"))
college_only_output <- Sys.getenv("DRAFT_COLLEGE_ONLY_OUTPUT_PREDS", file.path(draft_dir, "draft_skill_predictions_college_only.csv"))
no_college_output <- Sys.getenv("DRAFT_NO_COLLEGE_OUTPUT_PREDS", file.path(draft_dir, "no_college_skill_predictions_output.csv"))
final_output <- Sys.getenv("DRAFT_OUTPUT_PREDS", file.path(draft_dir, "draft_skill_predictions_output.csv"))
adjusted_output <- Sys.getenv("DRAFT_ADJUSTED_OUTPUT_PREDS", file.path(draft_dir, "draft_skill_predictions_adjusted.csv"))
unified_source_output <- Sys.getenv("DRAFT_UNIFIED_SOURCE_OUTPUT", file.path(draft_dir, "draft_prediction_unified.csv"))

skillmap_fp <- file.path(ref_dir, "skillmap.csv")
off_results_fp <- file.path(model_results_dir, "off_lm_1_results.csv")
def_results_fp <- file.path(model_results_dir, "def_lm_1_results.csv")
scv_draft_lookup <- load_scv_draft_lookup(
  file.path(ref_dir, "scvardraft.csv"),
  file.path(ref_dir, "scvardraft_overrides.csv")
)
rollup_config <- load_rollup_config(skillmap_fp, off_results_fp, def_results_fp)

overwrite_scv_draft_feature <- function(df, scv_lookup) {
  if (is.null(df) || !nrow(df) || is.null(scv_lookup) || !nrow(scv_lookup) || !"player" %in% names(df)) {
    return(df)
  }

  dt <- as.data.table(copy(df))
  dt[, row_id___ := seq_len(.N)]
  dt[, join_player___ := normalize_join_name(player)]
  merged <- merge(dt, copy(scv_lookup), by.x = "join_player___", by.y = "join_player", all.x = TRUE, sort = FALSE)
  setorder(merged, row_id___)

  lookup_col <- if ("scv_draft.y" %in% names(merged)) {
    "scv_draft.y"
  } else if ("scv_draft" %in% names(merged) && !("scv_draft.x" %in% names(merged))) {
    "scv_draft"
  } else {
    NA_character_
  }
  current_col <- if ("scv_draft.x" %in% names(merged)) {
    "scv_draft.x"
  } else if ("scv_draft" %in% names(merged) && is.na(lookup_col)) {
    "scv_draft"
  } else {
    NA_character_
  }
  lookup_vals <- if (!is.na(lookup_col)) suppressWarnings(as.numeric(merged[[lookup_col]])) else rep(NA_real_, nrow(merged))
  current_vals <- if (!is.na(current_col)) suppressWarnings(as.numeric(merged[[current_col]])) else rep(NA_real_, nrow(merged))
  merged[, scv_draft := ifelse(is.finite(lookup_vals), lookup_vals, current_vals)]
  drop_cols <- intersect(c("row_id___", "join_player___", "scv_draft.x", "scv_draft.y"), names(merged))
  merged[, (drop_cols) := NULL]
  as.data.frame(merged)
}

read_models <- function(path) {
  if (!file.exists(path)) stop("Model RDS not found: ", path)
  obj <- readRDS(path)
  if (!is.list(obj) || is.null(obj$models) || !length(obj$models)) {
    stop("Model RDS does not contain a non-empty $models list: ", path)
  }
  obj$models
}

score_prediction_specs <- function(specs, models_rds) {
  if (!nrow(specs)) return(data.table())
  models <- read_models(models_rds)
  rows <- lapply(seq_len(nrow(specs)), function(i) {
    source_df <- read_pred(specs$path[[i]])
    source_df <- filter_prediction_target_year(source_df, target_draft_year, specs$tag[[i]])
    if (is.null(source_df) || !nrow(source_df)) return(NULL)
    source_df <- add_curated_realgm_features(add_alias_columns(source_df))
    source_df <- overwrite_scv_draft_feature(source_df, scv_draft_lookup)
    pred_df <- make_preds(source_df, specs$tag[[i]], models, player_col)
    add_total_predictions(pred_df, rollup_config)
  })
  rows <- Filter(function(x) !is.null(x) && nrow(x), rows)
  if (!length(rows)) return(data.table())
  out <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  out <- keep_latest_prediction_rows(as.data.frame(out))
  as.data.table(standardize_prediction_skills(out))
}

merge_target_year_rows <- function(path, update_dt, target_year, label) {
  if (!nrow(update_dt)) {
    message("No ", label, " rows produced for ", target_year, "; skipping ", path)
    return(invisible(NULL))
  }
  merged <- merge_prediction_output(path, update_dt, target_year)
  merged <- keep_latest_prediction_rows(as.data.frame(merged))
  fwrite(as.data.table(merged), path, na = "")
  message("Updated ", label, " rows for ", target_year, " -> ", path)
}

update_source_scv_file <- function(path, target_year) {
  if (!file.exists(path)) return(invisible(NULL))
  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"draft_year" %in% names(dt) || !"player" %in% names(dt)) return(invisible(NULL))
  target_idx <- suppressWarnings(as.integer(dt$draft_year)) == target_year
  if (!any(target_idx, na.rm = TRUE)) return(invisible(NULL))

  updated <- as.data.table(overwrite_scv_draft_feature(dt[target_idx], scv_draft_lookup))
  shared_cols <- intersect(names(dt), names(updated))
  dt[target_idx, (shared_cols) := updated[, .SD, .SDcols = shared_cols]]
  fwrite(dt, path, na = "")
  message("Updated source SC values for ", target_year, " -> ", path)
}

update_source_scv_file(file.path(draft_dir, "draft_prediction_domestic.csv"), target_draft_year)
update_source_scv_file(file.path(draft_dir, "draft_prediction_international.csv"), target_draft_year)
update_source_scv_file(file.path(draft_dir, "no_college_prediction.csv"), target_draft_year)
update_source_scv_file(unified_source_output, target_draft_year)

main_rows <- score_prediction_specs(main_specs, main_models_rds)
no_college_rows <- score_prediction_specs(no_college_specs, no_college_models_rds)

merge_target_year_rows(college_only_output, main_rows, target_draft_year, "college-only prediction")
merge_target_year_rows(no_college_output, no_college_rows, target_draft_year, "no-college prediction")

combined_rows <- rbindlist(list(main_rows, no_college_rows), use.names = TRUE, fill = TRUE)
if (nrow(combined_rows)) {
  combined_rows <- keep_latest_prediction_rows(as.data.frame(combined_rows))
  combined_rows <- as.data.table(standardize_prediction_skills(combined_rows))
}
merge_target_year_rows(final_output, combined_rows, target_draft_year, "unified prediction")

tracker_script <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
tracker_lines <- readLines(tracker_script, warn = FALSE, encoding = "UTF-8")
tracker_cut <- grep("^base_dir <- resolve_base_dir\\(\\)", tracker_lines)[1]
if (!length(tracker_cut) || !is.finite(tracker_cut)) {
  stop("Could not find execution boundary in ", tracker_script)
}
eval(parse(text = paste(tracker_lines[seq_len(tracker_cut - 1)], collapse = "\n")), envir = environment())

adjustment_path <- file.path(draft_dir, "draft_tracker_model_adjustment.csv")
if (file.exists(adjustment_path)) {
  adjustment <- fread(adjustment_path, na.strings = c("", "NA", "N/A", "NaN"))
  if (nrow(adjustment) && all(c("b_age", "b_pick") %in% names(adjustment))) {
    panel <- make_prediction_panel(base_dir)
    adjusted_panel <- apply_final_adjustment_spread(
      panel,
      list(b_age = suppressWarnings(as.numeric(adjustment$b_age[[1]])), b_pick = suppressWarnings(as.numeric(adjustment$b_pick[[1]]))),
      base_dir
    )
    merge_target_year_rows(adjusted_output, adjusted_panel[draft_year == target_draft_year], target_draft_year, "adjusted prediction")
  } else {
    warning("Adjustment file lacks b_age/b_pick; adjusted predictions were not refreshed.")
  }
} else {
  warning("Adjustment file not found; adjusted predictions were not refreshed: ", adjustment_path)
}

similarity_script <- file.path(base_dir, "script", "draft", "build_draft_similarity_comps.R")
if (file.exists(similarity_script)) {
  source(similarity_script, local = new.env(parent = globalenv()))
} else {
  warning("Draft similarity script not found: ", similarity_script)
}

message("Score-only draft prediction complete for ", target_draft_year, ". Existing models were loaded, not retrained.")
