library(data.table)
library(dplyr)
library(purrr)
library(readr)

resolve_base_dir <- function() {
  candidates <- c(getwd(), file.path(getwd(), ".."), file.path(getwd(), "..", ".."))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "raw")) && dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

clean_id <- function(x) trimws(as.character(x))

add_alias_columns <- function(df) {
  alias_pairs <- c(
    "X3PA_100" = "3PA_100",
    "X3P_PERC" = "3P_PERC",
    "X3PA" = "3PA",
    "X3P" = "3P"
  )
  for (target_name in names(alias_pairs)) {
    source_name <- alias_pairs[[target_name]]
    if (!(target_name %in% names(df)) && source_name %in% names(df)) {
      df[[target_name]] <- df[[source_name]]
    }
  }
  df
}

format_formula_term <- function(term) {
  term <- as.character(term)
  if (grepl("^`.*`$", term) || grepl("^I\\(", term) || grepl("^[A-Za-z.][A-Za-z0-9._]*$", term)) {
    term
  } else {
    paste0("`", term, "`")
  }
}

safe_z <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  out <- rep(NA_real_, length(x))
  finite_idx <- is.finite(x)
  if (!any(finite_idx)) return(out)
  s <- sd(x[finite_idx])
  m <- mean(x[finite_idx])
  if (!is.finite(s) || s == 0) {
    out[finite_idx] <- 0
  } else {
    out[finite_idx] <- (x[finite_idx] - m) / s
  }
  out
}

build_results_table <- function(fit) {
  fit_summary <- summary(fit)
  coef_df <- as.data.frame(fit_summary$coefficients)
  coef_df$term <- rownames(coef_df)
  rownames(coef_df) <- NULL
  coef_df %>%
    transmute(
      term,
      estimate = Estimate,
      std_error = `Std. Error`,
      t_value = `t value`,
      p_value = `Pr(>|t|)`,
      r_squared = unname(fit_summary$r.squared),
      adj_r_squared = unname(fit_summary$adj.r.squared),
      model_sigma = unname(fit_summary$sigma),
      n = length(stats::fitted(fit))
    )
}

extract_model_terms <- function(skillmap, model_flag) {
  skills <- setdiff(names(skillmap), "VAR")
  term_rows <- skillmap %>%
    filter(grepl("^Term[0-9]+$", VAR)) %>%
    mutate(term_order = as.integer(sub("^Term", "", VAR))) %>%
    arrange(term_order)
  flag_row <- skillmap %>% filter(VAR == model_flag)
  map(skills, function(skill_name) {
    use_flag <- suppressWarnings(as.numeric(flag_row[[skill_name]][1]))
    if (!identical(use_flag, 1)) return(character(0))
    these_terms <- term_rows[[skill_name]]
    these_terms[!is.na(these_terms) & these_terms != ""]
  }) %>%
    unlist(use.names = FALSE) %>%
    unique()
}

with_env <- function(env, expr) {
  old_env <- Sys.getenv(names(env), unset = NA_character_)
  restore_env <- function() {
    to_unset <- names(old_env)[is.na(old_env)]
    to_restore <- old_env[!is.na(old_env)]
    if (length(to_unset)) Sys.unsetenv(to_unset)
    if (length(to_restore)) do.call(Sys.setenv, as.list(to_restore))
  }
  on.exit(restore_env(), add = TRUE)
  do.call(Sys.setenv, as.list(env))
  force(expr)
}

write_modified_impact_script <- function(base_dir, exp_dir, exp_skillmap, exp_defdata, exp_def_results) {
  impact_script <- file.path(base_dir, "script", "output", "impactoutput.txt")
  lines <- readLines(impact_script, warn = FALSE)

  replace_assignment <- function(lines, var_name, value) {
    idx <- grep(paste0("^", var_name, "\\s*<-"), lines)
    if (length(idx) != 1L) stop("Could not replace assignment for ", var_name)
    lines[[idx]] <- paste0(var_name, " <- ", deparse(normalizePath(value, winslash = "/", mustWork = FALSE)))
    lines
  }

  lines <- replace_assignment(lines, "def_hist_path", exp_defdata)
  lines <- replace_assignment(lines, "skill_path", exp_skillmap)
  lines <- replace_assignment(lines, "def_path", exp_def_results)
  lines <- replace_assignment(lines, "out_csv", file.path(exp_dir, "skilloutput.csv"))
  lines <- replace_assignment(lines, "out_xlsx", file.path(exp_dir, "skilloutput.xlsx"))

  out_script <- file.path(exp_dir, "impactoutput_experiment.R")
  writeLines(lines, out_script, useBytes = TRUE)
  out_script
}

add_perimeter_alloc_residual <- function(def_exp, base_dir, fit_year_excludes = c(2016L, 2017L)) {
  db_non_rim <- read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE) %>%
    transmute(
      nba_id = clean_id(nba_id),
      year = as.integer(year),
      pos2 = as.character(Pos2),
      dfga_100 = as.numeric(`dfga/100`),
      points_saved_100 = as.numeric(points_saved_100),
      rimdfga_100 = as.numeric(`rimdfga/100`),
      rim_points_saved_100_raw = as.numeric(rim_points_saved_100),
      non_rim_points_saved_100 = points_saved_100 - rim_points_saved_100_raw,
      primary_pos = case_when(
        grepl("C", pos2, ignore.case = TRUE) ~ "C",
        grepl("F", pos2, ignore.case = TRUE) ~ "F",
        grepl("G", pos2, ignore.case = TRUE) ~ "G",
        TRUE ~ "Unknown"
      ),
      is_center = as.numeric(primary_pos == "C"),
      def_3pa_100 = as.numeric(d_FG3A_Per100),
      def_long_mid_fga_100 = as.numeric(d_LongMidRangeFGA_Per100),
      def_short_mid_fga_100 = as.numeric(d_ShortMidRangeFGA_Per100),
      perimeter_zone_attempts_100 = def_3pa_100 + def_long_mid_fga_100,
      non_rim_zone_attempts_100 = def_3pa_100 + def_long_mid_fga_100 + def_short_mid_fga_100,
      perimeter_zone_share = if_else(
        non_rim_zone_attempts_100 > 0,
        perimeter_zone_attempts_100 / non_rim_zone_attempts_100,
        NA_real_
      ),
      perimeter_alloc_points_saved_100 = non_rim_points_saved_100 * perimeter_zone_share
    ) %>%
    distinct(nba_id, year, .keep_all = TRUE)

  out <- def_exp %>%
    left_join(db_non_rim, by = c("nba_id", "year"), suffix = c("", "_db"))

  residual_terms <- c(
    "perimeter_alloc_points_saved_100",
    "is_center",
    "d_Blocks_Per100",
    "d_DefRebounds_Per100",
    "rimdfga_100",
    "rim_points_saved_100"
  )
  fit_rows <- out %>%
    filter(!year %in% fit_year_excludes) %>%
    select(all_of(residual_terms)) %>%
    complete.cases()
  fit_idx <- which(!out$year %in% fit_year_excludes)[fit_rows]
  residual_fit <- lm(
    perimeter_alloc_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100,
    data = out[fit_idx, , drop = FALSE]
  )

  score_rows <- complete.cases(out[, residual_terms, drop = FALSE])
  out$perimeter_alloc_ps_resid_role <- NA_real_
  out$perimeter_alloc_ps_resid_role[score_rows] <-
    out$perimeter_alloc_points_saved_100[score_rows] -
    as.numeric(predict(residual_fit, newdata = out[score_rows, , drop = FALSE]))
  out
}

build_variant_nba_outputs <- function(base_dir, variant_dir, variant) {
  source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)
  live_dir <- get_live_data_dir(base_dir, create = FALSE)

  impact_hist <- read_csv(file.path(live_dir, "impactoutput.csv"), show_col_types = FALSE) %>%
    transmute(nba_id = clean_id(nba_id), year = as.integer(year), def_dep = as.numeric(def_dep))

  def_exp <- read_csv(file.path(live_dir, "defdata.csv"), show_col_types = FALSE) %>%
    add_alias_columns() %>%
    mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
    select(-any_of("def_dep")) %>%
    left_join(impact_hist, by = c("nba_id", "year")) %>%
    add_perimeter_alloc_residual(base_dir)

  skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)
  base_terms <- extract_model_terms(skillmap, "Defense?")
  def_terms <- c(base_terms, "perimeter_alloc_ps_resid_role")
  if (identical(variant, "drop_steals")) {
    def_terms <- setdiff(def_terms, "Steals_100")
  }

  fit_df <- def_exp %>%
    filter(!year %in% c(2016L, 2017L), !is.na(def_dep)) %>%
    select(def_dep, all_of(def_terms)) %>%
    filter(complete.cases(.))
  def_formula <- as.formula(paste("def_dep ~", paste(vapply(def_terms, format_formula_term, character(1)), collapse = " + ")))
  def_fit <- lm(def_formula, data = fit_df)
  def_results <- build_results_table(def_fit)

  exp_defdata <- file.path(variant_dir, "defdata_switch_perimeter.csv")
  exp_def_results <- file.path(variant_dir, "def_lm_switch_perimeter_results.csv")
  fwrite(as.data.table(def_exp), exp_defdata, na = "")
  fwrite(as.data.table(def_results), exp_def_results, na = "")

  skillmap_dt <- as.data.table(skillmap)
  skillmap_dt[VAR == "Term2", SWITCH := "perimeter_alloc_ps_resid_role"]
  exp_skillmap <- file.path(variant_dir, "skillmap_switch_perimeter.csv")
  fwrite(skillmap_dt, exp_skillmap, na = "")

  exp_impact_script <- write_modified_impact_script(base_dir, variant_dir, exp_skillmap, exp_defdata, exp_def_results)
  source(exp_impact_script, local = new.env(parent = globalenv()))

  list(
    def_results = def_results,
    def_r2 = summary(def_fit)$r.squared,
    def_adj_r2 = summary(def_fit)$adj.r.squared,
    def_rows = nobs(def_fit),
    exp_skilloutput = file.path(variant_dir, "skilloutput.csv")
  )
}

build_experiment_draft_sources <- function(base_dir, variant_dir, exp_skilloutput) {
  env <- c(
    SKILL_OUTPUT_INPUT = exp_skilloutput,
    DRAFT_TRAINING_OUTPUT = file.path(variant_dir, "draft_training_data.csv"),
    DRAFT_DOMESTIC_OUTPUT = file.path(variant_dir, "draft_prediction_domestic.csv"),
    DRAFT_INTERNATIONAL_OUTPUT = file.path(variant_dir, "draft_prediction_international.csv"),
    DRAFT_TRAINING_MATCH_REVIEW_OUTPUT = file.path(variant_dir, "draft_training_match_review.csv"),
    DRAFT_SOURCE_BASE_OUTPUT = file.path(variant_dir, "draft_prediction_source_base.csv"),
    SCV_REVIEW_OUTPUT = file.path(variant_dir, "scv_review_latest_class.csv")
  )
  with_env(env, {
    source(file.path(base_dir, "script", "draft", "build_draft_source_tables.R"), local = new.env(parent = globalenv()))
  })
}

filter_training_to_reference_cohort <- function(base_dir, variant_dir) {
  reference_path <- Sys.getenv(
    "SWITCH_PERIMETER_COHORT_REFERENCE",
    file.path(base_dir, "processed", "draft", "draft_training_data.csv")
  )
  if (!file.exists(reference_path)) {
    stop("Cohort reference file not found: ", reference_path)
  }

  training_path <- file.path(variant_dir, "draft_training_data.csv")
  train_dt <- fread(training_path, na.strings = c("", "NA", "N/A", "NaN"))
  ref_dt <- fread(reference_path, na.strings = c("", "NA", "N/A", "NaN"))
  key_cols <- intersect(c("player", "draft_year", "outcome_year"), intersect(names(train_dt), names(ref_dt)))
  if (!all(c("player", "draft_year") %in% key_cols)) {
    stop("Cannot filter training cohort; missing required key columns.")
  }

  for (col in key_cols) {
    if (col %in% c("draft_year", "outcome_year")) {
      train_dt[, (col) := suppressWarnings(as.integer(get(col)))]
      ref_dt[, (col) := suppressWarnings(as.integer(get(col)))]
    } else {
      train_dt[, (col) := as.character(get(col))]
      ref_dt[, (col) := as.character(get(col))]
    }
  }

  ref_keys <- unique(ref_dt[, ..key_cols])
  before_rows <- nrow(train_dt)
  train_dt <- merge(ref_keys, train_dt, by = key_cols, all.x = FALSE, all.y = FALSE, sort = FALSE)
  after_rows <- nrow(train_dt)

  fwrite(train_dt, training_path, na = "")
  fwrite(
    data.table(
      reference_path = normalizePath(reference_path, winslash = "/", mustWork = FALSE),
      key_cols = paste(key_cols, collapse = ","),
      before_rows = before_rows,
      after_rows = after_rows,
      reference_rows = nrow(ref_dt)
    ),
    file.path(variant_dir, "draft_training_cohort_filter.csv"),
    na = ""
  )
}

train_experiment_draft_defense <- function(base_dir, variant_dir) {
  env <- c(
    DRAFT_TRAINING_FILE = file.path(variant_dir, "draft_training_data.csv"),
    DRAFT_TARGET_SKILLS = "DPM,DREB,RIMPRO,SWITCH",
    DRAFT_REFRESH_TRAINING_TARGETS = "false",
    DRAFT_PREDICTION_SPECS = paste(
      sprintf("domestic=%s", file.path(variant_dir, "draft_prediction_domestic.csv")),
      sprintf("international=%s", file.path(variant_dir, "draft_prediction_international.csv")),
      sep = ";"
    ),
    DRAFT_OUTPUT_PREDS = file.path(variant_dir, "draft_skill_predictions_defense_only.csv"),
    DRAFT_MODELS_RDS = file.path(variant_dir, "trained_defense_skill_models.rds"),
    DRAFT_SUMMARY_FP = file.path(variant_dir, "draft_def_model_summary.csv"),
    DRAFT_DETAIL_FP = file.path(variant_dir, "draft_def_model_feature_details.csv"),
    DRAFT_SUMMARY_HISTORY_FP = file.path(variant_dir, "draft_def_model_summary_history.csv"),
    DRAFT_PRESERVE_EXISTING_OUTPUT = "false"
  )
  with_env(env, {
    source(file.path(base_dir, "script", "draft", "draftmodeltrain.txt"), local = new.env(parent = globalenv()))
  })
}

combine_experiment_predictions <- function(base_dir, variant_dir, def_intercept) {
  default_base_predictions <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_adjusted.csv")
  base_predictions <- Sys.getenv("SWITCH_PERIMETER_BASE_PREDICTIONS", default_base_predictions)
  current <- fread(base_predictions, na.strings = c("", "NA", "N/A", "NaN"))
  defense <- fread(file.path(variant_dir, "draft_skill_predictions_defense_only.csv"), na.strings = c("", "NA", "N/A", "NaN"))

  key <- c("player", "draft_year", "prediction_pool")
  setkeyv(current, key)
  setkeyv(defense, key)
  combined <- copy(current)
  for (skill in c("DPM", "DREB", "RIMPRO", "SWITCH")) {
    raw_col <- paste0(skill, "_raw_pred")
    pred_col <- paste0(skill, "_pred")
    combined[defense, (raw_col) := get(paste0("i.", raw_col))]
    combined[defense, (pred_col) := get(paste0("i.", pred_col))]
  }
  combined[, def_intercept := def_intercept]
  combined[, DEF_pred := def_intercept + rowSums(.SD, na.rm = TRUE), .SDcols = paste0(c("DPM", "DREB", "RIMPRO", "SWITCH"), "_raw_pred")]
  combined[, TOTAL_pred := OFF_pred + DEF_pred]

  for (skill in c("DPM", "DREB", "RIMPRO", "SWITCH")) {
    raw_col <- paste0(skill, "_raw_pred")
    pred_col <- paste0(skill, "_pred")
    if (raw_col %in% names(combined)) {
      combined[, (pred_col) := safe_z(get(raw_col)), by = draft_year]
    }
  }

  out_path <- file.path(variant_dir, "draft_skill_predictions_output_combined.csv")
  fwrite(combined, out_path, na = "")
  fwrite(
    data.table(
      base_predictions = normalizePath(base_predictions, winslash = "/", mustWork = FALSE),
      base_rows = nrow(current),
      defense_rows = nrow(defense),
      combined_rows = nrow(combined),
      base_no_college_rows = if ("prediction_pool" %in% names(current)) sum(current$prediction_pool == "no_college", na.rm = TRUE) else NA_integer_,
      combined_no_college_rows = if ("prediction_pool" %in% names(combined)) sum(combined$prediction_pool == "no_college", na.rm = TRUE) else NA_integer_
    ),
    file.path(variant_dir, "draft_prediction_splice_audit.csv"),
    na = ""
  )
  out_path
}

load_tracker_functions <- function(base_dir) {
  script_path <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
  lines <- readLines(script_path, warn = FALSE, encoding = "UTF-8")
  cut <- grep("^base_dir <- resolve_base_dir\\(\\)", lines)[1]
  eval(parse(text = paste(lines[seq_len(cut - 1)], collapse = "\n")), envir = .GlobalEnv)
  source(file.path(base_dir, "script", "draft", "name_matching.R"), local = .GlobalEnv)
}

make_prediction_panel_from_file <- function(base_dir, pred_path) {
  pred <- read_csv_required(pred_path, c("player", "draft_year", "OFF_pred", "DEF_pred", "TOTAL_pred"))
  source <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_prediction_unified.csv"),
    c("player", "draft_year", "draft_age", "big_board_rank", "scv_draft")
  )
  picks <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv"),
    c("player", "draft_year", "pick_overall")
  )

  source <- unique(source[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    draft_age = suppressWarnings(as.numeric(draft_age)),
    big_board_rank = suppressWarnings(as.numeric(big_board_rank)),
    scv_draft = suppressWarnings(as.numeric(scv_draft))
  )])
  pred[, player := as.character(player)]
  pred[, draft_year := as.integer(draft_year)]
  recomputed_cols <- c(
    "name_key",
    "draft_age",
    "big_board_rank",
    "scv_draft",
    "actual_pick",
    "pick_proxy",
    "pick_proxy_available",
    "age_feature",
    "pick_feature",
    "base_rank",
    "tracker_adjustment_version",
    grep("^(adjustment_|FINAL_)", names(pred), value = TRUE)
  )
  pred[, (intersect(recomputed_cols, names(pred))) := NULL]
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

  picks <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = suppressWarnings(as.numeric(pick_overall)),
    name_key = normalize_name(player)
  )])
  setorder(picks, draft_year, name_key, actual_pick, na.last = TRUE)
  picks <- unique(picks[, .(draft_year, name_key, actual_pick)], by = c("draft_year", "name_key"))
  pred <- merge(pred, picks, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  pred[, pick_proxy := fifelse(is.finite(actual_pick), actual_pick, big_board_rank)]
  pred[, pick_proxy := fifelse(is.finite(pick_proxy), pick_proxy, 60)]
  pred[, age_feature := -z_within(draft_age, draft_year)]
  pred[, pick_feature := -z_within(log1p(pick_proxy), draft_year)]
  pred[, base_rank := frank(-TOTAL_pred, ties.method = "first"), by = draft_year]
  pred[]
}

optimize_experiment_tracker <- function(base_dir, variant_dir, pred_path) {
  load_tracker_functions(base_dir)
  latest_impact_year <- max(fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year, na.rm = TRUE)
  fit_years <- as.integer(strsplit(Sys.getenv("DRAFT_TRACKER_FIT_YEARS", "2016,2017,2018,2019,2020,2021,2022"), ",")[[1]])
  fit_years <- fit_years[is.finite(fit_years)]

  actual <- build_actual_outcomes(base_dir, latest_impact_year)
  panel <- make_prediction_panel_from_file(base_dir, pred_path)

  tracker_boards <- read_tracker_workbook_boards(base_dir, fit_years)
  tracker_boards[, name_key := normalize_name(player)]
  tracker_joined <- merge(
    actual[, .(draft_year, name_key, actual_rank, actual_weight)],
    tracker_boards[, .(draft_year, name_key, board, board_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    allow.cartesian = TRUE,
    sort = FALSE
  )
  external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]

  actual_pick_scores <- actual[draft_year %in% fit_years, .(score = score_board_year(.SD, "actual_pick")), by = draft_year]
  actual_pick_scores[, board := "NBA Draft - Actual"]
  external_scores <- rbindlist(list(external_scores, actual_pick_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)

  base_joined <- merge(
    actual[, .(draft_year, name_key, actual_rank, actual_weight)],
    panel[, .(draft_year, name_key, board_rank = base_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  base_scores <- base_joined[draft_year %in% fit_years, .(score = score_board_year(.SD, "board_rank")), by = draft_year]
  base_scores[, board := "SCV Base Model"]
  external_scores <- rbindlist(list(external_scores, base_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)

  fit <- fit_adjustment(panel, actual, external_scores, fit_years, latest_impact_year)
  best <- fit$best
  panel <- apply_final_adjustment_spread(panel, best, base_dir)

  final_joined <- merge(
    actual[, .(draft_year, name_key, actual_rank, actual_weight)],
    panel[, .(draft_year, name_key, board_rank = FINAL_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  final_scores <- final_joined[draft_year %in% fit_years, .(score = score_board_year(.SD, "board_rank")), by = draft_year]
  final_scores[, board := "SCV Adjusted Model"]
  all_scores <- rbindlist(list(external_scores, final_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)
  all_scores[, year_weight := year_weight(draft_year, latest_impact_year)]
  all_scores[, z_score := {
    sig <- stats::sd(score, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(score, na.rm = TRUE)) / sig
  }, by = draft_year]
  summary_scores <- all_scores[, .(
    weighted_score = weighted.mean(score, year_weight, na.rm = TRUE),
    weighted_z = weighted.mean(z_score, year_weight, na.rm = TRUE),
    years = sum(is.finite(score))
  ), by = board][order(-weighted_z, -weighted_score)]

  adjustment <- data.table(
    version = "switch_perimeter_defense_experiment",
    fit_years = paste(fit_years, collapse = ","),
    latest_impact_year = latest_impact_year,
    b_age = best$b_age,
    b_pick = best$b_pick,
    in_sample_weighted_score = score_model_candidate(panel, actual, external_scores, best$b_age, best$b_pick, fit_years, latest_impact_year)$mean_score,
    in_sample_weighted_z = best$mean_z
  )

  fwrite(all_scores[order(board, draft_year)], file.path(variant_dir, "draft_tracker_board_scores.csv"), na = "")
  fwrite(summary_scores, file.path(variant_dir, "draft_tracker_board_summary.csv"), na = "")
  fwrite(adjustment, file.path(variant_dir, "draft_tracker_model_adjustment.csv"), na = "")
  fwrite(fit$loyo, file.path(variant_dir, "draft_tracker_adjustment_loyo.csv"), na = "")
  fwrite(panel, file.path(variant_dir, "draft_skill_predictions_adjusted.csv"), na = "")
  summary_scores
}

compare_to_current <- function(base_dir, variant_dir, variant) {
  current_summary <- fread(file.path(base_dir, "processed", "draft", "draft_tracker_board_summary.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  exp_summary <- fread(file.path(variant_dir, "draft_tracker_board_summary.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  summary_compare <- merge(
    current_summary[, .(board, current_weighted_score = weighted_score, current_weighted_z = weighted_z, current_years = years)],
    exp_summary[, .(board, experiment_weighted_score = weighted_score, experiment_weighted_z = weighted_z, experiment_years = years)],
    by = "board",
    all = TRUE,
    sort = FALSE
  )
  summary_compare[, `:=`(
    variant = variant,
    weighted_score_delta = experiment_weighted_score - current_weighted_score,
    weighted_z_delta = experiment_weighted_z - current_weighted_z
  )]
  fwrite(summary_compare, file.path(variant_dir, "draft_tracker_summary_compare_current.csv"), na = "")

  current_pred <- fread(file.path(base_dir, "processed", "draft", "draft_skill_predictions_adjusted.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  exp_pred <- fread(file.path(variant_dir, "draft_skill_predictions_adjusted.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  key <- c("player", "draft_year", "prediction_pool")
  current_pred[, prediction_pool := as.character(prediction_pool)]
  exp_pred[, prediction_pool := as.character(prediction_pool)]
  setkeyv(current_pred, key)
  setkeyv(exp_pred, key)
  pred_compare <- exp_pred[current_pred, on = key, nomatch = 0L, .(
    player,
    draft_year,
    prediction_pool,
    current_TOTAL_pred = i.TOTAL_pred,
    experiment_TOTAL_pred = TOTAL_pred,
    current_DEF_pred = i.DEF_pred,
    experiment_DEF_pred = DEF_pred,
    current_SWITCH_pred = i.SWITCH_pred,
    experiment_SWITCH_pred = SWITCH_pred,
    current_FINAL_rank = i.FINAL_rank,
    experiment_FINAL_rank = FINAL_rank
  )]
  pred_compare[, `:=`(
    total_delta = experiment_TOTAL_pred - current_TOTAL_pred,
    def_delta = experiment_DEF_pred - current_DEF_pred,
    switch_delta = experiment_SWITCH_pred - current_SWITCH_pred,
    final_rank_delta = current_FINAL_rank - experiment_FINAL_rank
  )]
  fwrite(pred_compare, file.path(variant_dir, "draft_prediction_compare_current.csv"), na = "")

  invisible(summary_compare)
}

run_variant <- function(base_dir, exp_dir, variant) {
  variant_dir <- file.path(exp_dir, variant)
  dir.create(variant_dir, recursive = TRUE, showWarnings = FALSE)

  if (identical(variant, "current_targets")) {
    source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)
    live_dir <- get_live_data_dir(base_dir, create = FALSE)
    current_def <- fread(file.path(base_dir, "processed", "modelresults", "def_lm_1_results.csv"), na.strings = c("", "NA", "N/A", "NaN"))
    nba <- list(
      def_results = as.data.frame(current_def),
      def_r2 = current_def$r_squared[[1]],
      def_adj_r2 = current_def$adj_r_squared[[1]],
      def_rows = current_def$n[[1]],
      exp_skilloutput = file.path(live_dir, "skilloutput.csv")
    )
  } else {
    nba <- build_variant_nba_outputs(base_dir, variant_dir, variant)
  }

  build_experiment_draft_sources(base_dir, variant_dir, nba$exp_skilloutput)
  if (tolower(trimws(Sys.getenv("SWITCH_PERIMETER_USE_REFERENCE_COHORT", "false"))) %in% c("1", "true", "yes")) {
    filter_training_to_reference_cohort(base_dir, variant_dir)
  }
  train_experiment_draft_defense(base_dir, variant_dir)

  def_intercept <- nba$def_results$estimate[nba$def_results$term == "(Intercept)"][[1]]
  combined_pred_path <- combine_experiment_predictions(base_dir, variant_dir, def_intercept)
  tracker_summary <- optimize_experiment_tracker(base_dir, variant_dir, combined_pred_path)
  compare_to_current(base_dir, variant_dir, variant)

  nba_summary <- data.table(
    variant = variant,
    rows = nba$def_rows,
    r2 = nba$def_r2,
    adj_r2 = nba$def_adj_r2
  )
  fwrite(nba_summary, file.path(variant_dir, "nba_def_model_summary.csv"), na = "")

  cat("\nVariant: ", variant, "\n", sep = "")
  cat("NBA defense model:\n")
  print(nba_summary)
  cat("\nDraft defense model summary:\n")
  print(fread(file.path(variant_dir, "draft_def_model_summary.csv"))[, .(
    skill,
    model_type,
    n_rows,
    train_r2_pct,
    temporal_r2,
    temporal_mse,
    validation_rows,
    predictors
  )])
  cat("\nDraft tracker summary:\n")
  print(tracker_summary[board %in% c("SCV Adjusted Model", "SCV Base Model", "NBA Draft - Actual")])

  list(variant = variant, nba_summary = nba_summary, tracker_summary = tracker_summary)
}

base_dir <- resolve_base_dir()
exp_dir <- Sys.getenv(
  "SWITCH_PERIMETER_EXP_DIR",
  file.path(base_dir, "processed", "draft", "switch_perimeter_defense_experiment")
)
dir.create(exp_dir, recursive = TRUE, showWarnings = FALSE)

variant_env <- trimws(Sys.getenv("SWITCH_PERIMETER_VARIANTS", "with_steals,drop_steals"))
variants <- trimws(unlist(strsplit(variant_env, ",", fixed = TRUE), use.names = FALSE))
variants <- intersect(variants[nzchar(variants)], c("current_targets", "with_steals", "drop_steals"))
if (!length(variants)) stop("No valid SWITCH_PERIMETER_VARIANTS requested.")

results <- lapply(variants, function(variant) run_variant(base_dir, exp_dir, variant))

combined_nba <- rbindlist(lapply(results, `[[`, "nba_summary"), use.names = TRUE, fill = TRUE)
combined_tracker <- rbindlist(lapply(results, function(x) {
  as.data.table(x$tracker_summary)[, variant := x$variant][]
}), use.names = TRUE, fill = TRUE)
fwrite(combined_nba, file.path(exp_dir, "nba_def_model_summary_all.csv"), na = "")
fwrite(combined_tracker, file.path(exp_dir, "draft_tracker_board_summary_all.csv"), na = "")

cat("\nAll experiment outputs written to: ", exp_dir, "\n", sep = "")
