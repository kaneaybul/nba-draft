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

library(data.table)

target_draft_year <- 2026L
override_fp <- file.path(draft_dir, "temp_2026_combine_measurement_coverage_combined.csv")

temp_domestic_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_prediction_domestic.csv")
temp_international_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_prediction_international.csv")
temp_no_college_fp <- file.path(draft_dir, "temp_2026_measurement_override_no_college_prediction.csv")
temp_unified_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_prediction_unified.csv")
temp_college_output_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_skill_predictions_college_only.csv")
temp_no_college_output_fp <- file.path(draft_dir, "temp_2026_measurement_override_no_college_skill_predictions_output.csv")
temp_output_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_skill_predictions_output.csv")
temp_adjusted_fp <- file.path(draft_dir, "temp_2026_measurement_override_draft_skill_predictions_adjusted.csv")
temp_compare_fp <- file.path(draft_dir, "temp_2026_measurement_override_projection_comparison.csv")

read_dt <- function(path) {
  if (!file.exists(path)) return(data.table())
  fread(path, na.strings = c("", "NA", "N/A", "NaN"))
}

to_num <- function(x) suppressWarnings(as.numeric(x))

override_source <- function(dt, overrides) {
  if (!nrow(dt) || !"player" %in% names(dt) || !"draft_year" %in% names(dt)) return(dt)
  out <- copy(dt)
  out[, draft_year := suppressWarnings(as.integer(draft_year))]
  out[, override_key___ := normalize_join_name(player)]
  for (text_col in intersect(c("measurement_source", "measurement_source_url", "measurement_source_note", "height_source_type", "wingspan_source_type"), names(out))) {
    out[, (text_col) := as.character(get(text_col))]
  }
  overrides[, override_key___ := normalize_join_name(player)]

  idx <- out$draft_year == target_draft_year
  if (!any(idx, na.rm = TRUE)) {
    out[, override_key___ := NULL]
    return(out)
  }

  merged <- merge(
    out[idx],
    overrides[, .(
      override_key___,
      combine_height_wo_shoes_in = to_num(combine_height_wo_shoes_in),
      combine_wingspan_in = to_num(combine_wingspan_in),
      combine_weight_lbs = to_num(combine_weight_lbs),
      override_measurement_status = measurement_status,
      override_source = source,
      override_source_url = source_url,
      override_source_note = source_note
    )],
    by = "override_key___",
    all.x = TRUE,
    sort = FALSE
  )

  reported <- !is.na(merged$combine_height_wo_shoes_in) |
    !is.na(merged$combine_wingspan_in) |
    !is.na(merged$combine_weight_lbs)

  if ("height_wo_shoes_in" %in% names(merged)) {
    merged[reported & is.finite(combine_height_wo_shoes_in), height_wo_shoes_in := combine_height_wo_shoes_in]
  }
  if ("wingspan_in" %in% names(merged)) {
    merged[reported & is.finite(combine_wingspan_in), wingspan_in := combine_wingspan_in]
  }
  if ("weight_lbs" %in% names(merged)) {
    merged[reported & is.finite(combine_weight_lbs), weight_lbs := combine_weight_lbs]
  }
  if ("measurement_source" %in% names(merged)) {
    merged[reported, measurement_source := override_source]
  }
  if ("measurement_source_url" %in% names(merged)) {
    merged[reported, measurement_source_url := override_source_url]
  }
  if ("measurement_source_note" %in% names(merged)) {
    merged[reported, measurement_source_note := override_source_note]
  }
  if ("height_source_type" %in% names(merged)) {
    merged[reported, height_source_type := "2026_combine_temp_override"]
  }
  if ("wingspan_source_type" %in% names(merged)) {
    merged[reported, wingspan_source_type := "2026_combine_temp_override"]
  }

  drop_cols <- intersect(
    c(
      "combine_height_wo_shoes_in",
      "combine_wingspan_in",
      "combine_weight_lbs",
      "override_measurement_status",
      "override_source",
      "override_source_url",
      "override_source_note"
    ),
    names(merged)
  )
  merged[, (drop_cols) := NULL]
  out[idx] <- merged[, names(out), with = FALSE]
  out[, override_key___ := NULL]
  out
}

score_prediction_specs <- function(specs, models_rds, rollup_config, scv_lookup) {
  if (!nrow(specs)) return(data.table())
  models_obj <- readRDS(models_rds)
  models <- models_obj$models
  if (!is.list(models) || !length(models)) stop("Model RDS has no models: ", models_rds)

  rows <- lapply(seq_len(nrow(specs)), function(i) {
    source_df <- read_pred(specs$path[[i]])
    source_df <- filter_prediction_target_year(source_df, target_draft_year, specs$tag[[i]])
    if (is.null(source_df) || !nrow(source_df)) return(NULL)
    source_df <- add_curated_realgm_features(add_alias_columns(source_df))
    source_df <- add_scv_draft_feature(source_df, scv_lookup)
    pred_df <- make_preds(source_df, specs$tag[[i]], models, player_col)
    add_total_predictions(pred_df, rollup_config)
  })

  rows <- Filter(function(x) !is.null(x) && nrow(x), rows)
  if (!length(rows)) return(data.table())
  out <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  out <- keep_latest_prediction_rows(as.data.frame(out))
  as.data.table(standardize_prediction_skills(out))
}

build_temp_adjusted_panel <- function(pred_path, source_path) {
  pred <- fread(pred_path, na.strings = c("", "NA", "N/A", "NaN"))
  source <- fread(source_path, na.strings = c("", "NA", "N/A", "NaN"))
  picks <- fread(file.path(draft_dir, "draft_picks_all_classes.csv"), na.strings = c("", "NA", "N/A", "NaN"))

  source <- unique(source[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    draft_age = to_num(draft_age),
    big_board_rank = to_num(big_board_rank),
    scv_draft = to_num(scv_draft)
  )])
  picks <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = to_num(pick_overall)
  )])

  pred[, player := as.character(player)]
  pred[, draft_year := as.integer(draft_year)]
  pred <- merge(pred, source, by = c("player", "draft_year"), all.x = TRUE, sort = FALSE)
  pred[, name_key := normalize_name(player)]

  scv_ref <- load_scv_draft_reference(base_dir)
  if (nrow(scv_ref)) {
    pred <- merge(pred, scv_ref, by = "name_key", all.x = TRUE, sort = FALSE)
    pred[, scv_draft := fifelse(is.finite(scv_draft), scv_draft, scv_draft_ref)]
    pred[, scv_draft_ref := NULL]
  }

  realgm_bio <- load_realgm_draft_bio_reference(base_dir)
  if (nrow(realgm_bio)) {
    pred <- merge(pred, realgm_bio, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
    pred[, draft_age := fifelse(is.finite(draft_age), draft_age, draft_age_ref)]
    pred[, draft_age_ref := NULL]
  }

  picks[, name_key := normalize_name(player)]
  setorder(picks, draft_year, name_key, actual_pick, na.last = TRUE)
  picks <- unique(picks[, .(draft_year, name_key, actual_pick)], by = c("draft_year", "name_key"))
  pred <- merge(pred, picks, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  pred[, pick_proxy := fifelse(is.finite(actual_pick), actual_pick, big_board_rank)]
  pred[, pick_proxy_available := is.finite(pick_proxy)]
  pred[, pick_proxy := fifelse(is.finite(pick_proxy), pick_proxy, 60)]
  pred[, age_feature := -z_within(draft_age, draft_year)]
  pred[, pick_feature := -z_within(log1p(pick_proxy), draft_year)]
  pred[, base_rank := frank(-TOTAL_pred, ties.method = "first"), by = draft_year]
  pred[]
}

if (!file.exists(override_fp)) stop("Override coverage file not found: ", override_fp)
overrides <- fread(override_fp, na.strings = c("", "NA", "N/A", "NaN"))
overrides <- overrides[reported == "yes"]

domestic <- override_source(read_dt(file.path(draft_dir, "draft_prediction_domestic.csv")), overrides)
international <- override_source(read_dt(file.path(draft_dir, "draft_prediction_international.csv")), overrides)
no_college <- override_source(read_dt(file.path(draft_dir, "no_college_prediction.csv")), overrides)
unified <- override_source(read_dt(file.path(draft_dir, "draft_prediction_unified.csv")), overrides)

fwrite(domestic, temp_domestic_fp, na = "")
fwrite(international, temp_international_fp, na = "")
fwrite(no_college, temp_no_college_fp, na = "")
fwrite(unified, temp_unified_fp, na = "")

main_specs <- parse_prediction_specs(paste(
  sprintf("domestic=%s", temp_domestic_fp),
  sprintf("international=%s", temp_international_fp),
  sep = ";"
))
no_college_specs <- parse_prediction_specs(sprintf("no_college=%s", temp_no_college_fp))

scv_draft_lookup <- load_scv_draft_lookup(
  file.path(ref_dir, "scvardraft.csv"),
  file.path(ref_dir, "scvardraft_overrides.csv")
)
rollup_config <- load_rollup_config(
  file.path(ref_dir, "skillmap.csv"),
  file.path(model_results_dir, "off_lm_1_results.csv"),
  file.path(model_results_dir, "def_lm_1_results.csv")
)

main_rows <- score_prediction_specs(main_specs, file.path(draft_dir, "trained_skill_models.rds"), rollup_config, scv_draft_lookup)
no_college_rows <- score_prediction_specs(no_college_specs, file.path(draft_dir, "no_college_trained_skill_models.rds"), rollup_config, scv_draft_lookup)
combined_rows <- rbindlist(list(main_rows, no_college_rows), use.names = TRUE, fill = TRUE)
combined_rows <- as.data.table(standardize_prediction_skills(keep_latest_prediction_rows(as.data.frame(combined_rows))))

fwrite(main_rows, temp_college_output_fp, na = "")
fwrite(no_college_rows, temp_no_college_output_fp, na = "")
fwrite(combined_rows, temp_output_fp, na = "")

tracker_script <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
tracker_lines <- readLines(tracker_script, warn = FALSE, encoding = "UTF-8")
tracker_cut <- grep("^base_dir <- resolve_base_dir\\(\\)", tracker_lines)[1]
if (!length(tracker_cut) || !is.finite(tracker_cut)) {
  stop("Could not find execution boundary in ", tracker_script)
}
eval(parse(text = paste(tracker_lines[seq_len(tracker_cut - 1)], collapse = "\n")), envir = environment())

adjustment <- fread(file.path(draft_dir, "draft_tracker_model_adjustment.csv"), na.strings = c("", "NA", "N/A", "NaN"))
panel <- build_temp_adjusted_panel(temp_output_fp, temp_unified_fp)
adjusted_panel <- apply_final_adjustment_spread(
  panel,
  list(b_age = to_num(adjustment$b_age[[1]]), b_pick = to_num(adjustment$b_pick[[1]])),
  base_dir
)
adjusted_panel <- adjusted_panel[draft_year == target_draft_year]
fwrite(adjusted_panel, temp_adjusted_fp, na = "")

baseline <- fread(file.path(draft_dir, "draft_skill_predictions_adjusted.csv"), na.strings = c("", "NA", "N/A", "NaN"))
baseline <- baseline[draft_year == target_draft_year]
baseline[, name_key := normalize_name(player)]
adjusted_panel[, name_key := normalize_name(player)]
source_measurements <- unified[draft_year == target_draft_year, .(
  name_key = normalize_name(player),
  override_height_wo_shoes_in = to_num(height_wo_shoes_in),
  override_wingspan_in = to_num(wingspan_in),
  override_weight_lbs = to_num(weight_lbs)
)]
base_source <- fread(file.path(draft_dir, "draft_prediction_unified.csv"), na.strings = c("", "NA", "N/A", "NaN"))
base_source <- base_source[suppressWarnings(as.integer(draft_year)) == target_draft_year, .(
  name_key = normalize_name(player),
  base_height_wo_shoes_in = to_num(height_wo_shoes_in),
  base_wingspan_in = to_num(wingspan_in),
  base_weight_lbs = to_num(weight_lbs)
)]

comparison <- merge(
  adjusted_panel[, .(
    name_key,
    player,
    prediction_pool,
    override_rank = FINAL_rank,
    override_total = FINAL_TOTAL_pred,
    override_off = FINAL_OFF_pred,
    override_def = FINAL_DEF_pred
  )],
  baseline[, .(
    name_key,
    base_rank = FINAL_rank,
    base_total = FINAL_TOTAL_pred,
    base_off = FINAL_OFF_pred,
    base_def = FINAL_DEF_pred
  )],
  by = "name_key",
  all.x = TRUE,
  sort = FALSE
)
comparison <- merge(comparison, base_source, by = "name_key", all.x = TRUE, sort = FALSE)
comparison <- merge(comparison, source_measurements, by = "name_key", all.x = TRUE, sort = FALSE)
comparison[, `:=`(
  rank_change = base_rank - override_rank,
  total_change = override_total - base_total,
  off_change = override_off - base_off,
  def_change = override_def - base_def,
  height_change = override_height_wo_shoes_in - base_height_wo_shoes_in,
  wingspan_change = override_wingspan_in - base_wingspan_in,
  weight_change = override_weight_lbs - base_weight_lbs
)]
setorder(comparison, override_rank)
fwrite(comparison, temp_compare_fp, na = "")

cat("Temporary measurement override source ->", temp_unified_fp, "\n")
cat("Temporary raw predictions ->", temp_output_fp, "\n")
cat("Temporary adjusted predictions ->", temp_adjusted_fp, "\n")
cat("Temporary comparison ->", temp_compare_fp, "\n")
