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

safe_z <- function(x) {
  s <- sd(x, na.rm = TRUE)
  m <- mean(x, na.rm = TRUE)
  if (is.na(s) || s == 0) return(rep(0, length(x)))
  (x - m) / s
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

process_one_matchup_season <- function(raw_switch_dir, season) {
  minutes_path <- file.path(raw_switch_dir, paste0("minutes_", season, ".rds"))
  matchups_path <- file.path(raw_switch_dir, paste0("matchups_", season, ".rds"))
  positions_path <- file.path(raw_switch_dir, "player_positions.rds")
  if (!file.exists(minutes_path) || !file.exists(matchups_path) || !file.exists(positions_path)) return(NULL)

  minutes <- readRDS(minutes_path)
  matchups <- readRDS(matchups_path)
  player_positions <- readRDS(positions_path)
  if (!"PTS" %in% names(matchups)) return(NULL)

  matchups %>%
    rename(SEASON_PTS_100 = PTS) %>%
    mutate(
      PARTIAL_POSS = as.numeric(PARTIAL_POSS),
      OFF_PLAYER_ID = as.character(OFF_PLAYER_ID),
      DEF_PLAYER_ID = as.character(DEF_PLAYER_ID)
    ) %>%
    inner_join(player_positions, by = c("OFF_PLAYER_ID" = "PERSON_ID")) %>%
    group_by(DEF_PLAYER_ID, season) %>%
    summarize(
      matchup_possessions = sum(PARTIAL_POSS, na.rm = TRUE),
      avg_assignment_pts_100 = weighted.mean(SEASON_PTS_100, w = PARTIAL_POSS, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    inner_join(
      minutes %>% transmute(player_id = as.character(PLAYER_ID), MIN = as.numeric(MIN)),
      by = c("DEF_PLAYER_ID" = "player_id")
    ) %>%
    group_by(season) %>%
    mutate(matchup_difficulty = safe_z(avg_assignment_pts_100)) %>%
    ungroup() %>%
    transmute(
      nba_id = clean_id(DEF_PLAYER_ID),
      year = as.integer(paste0("20", substr(season, 6, 7))),
      matchup_difficulty
    )
}

build_matchup_difficulty <- function(raw_switch_dir) {
  seasons <- paste0(2016:2025, "-", substr(2017:2026, 3, 4))
  map_dfr(seasons, ~ process_one_matchup_season(raw_switch_dir, .x)) %>%
    distinct(nba_id, year, .keep_all = TRUE)
}

primary_pos <- function(x) {
  x <- trimws(as.character(x))
  x[is.na(x) | x == ""] <- "UNKNOWN"
  sub("-.*$", "", x)
}

add_relative_wingspan_with_reference <- function(df, ref_stats = NULL) {
  dt <- as.data.table(copy(df))
  if (!"wingspan_in" %in% names(dt)) {
    dt[, `r.wingspan` := NA_real_]
    return(dt)
  }
  dt[, pos_group_for_wing := if ("pos_code" %in% names(dt)) primary_pos(pos_code) else "UNKNOWN"]
  dt[, wingspan_numeric_for_ref := suppressWarnings(as.numeric(wingspan_in))]

  if (is.null(ref_stats)) {
    global_mean <- mean(dt$wingspan_numeric_for_ref, na.rm = TRUE)
    global_sd <- sd(dt$wingspan_numeric_for_ref, na.rm = TRUE)
    if (!is.finite(global_sd) || global_sd == 0) global_sd <- 1
    ref_stats <- dt[, .(
      wing_n = sum(is.finite(wingspan_numeric_for_ref)),
      wing_mean = mean(wingspan_numeric_for_ref, na.rm = TRUE),
      wing_sd = sd(wingspan_numeric_for_ref, na.rm = TRUE)
    ), by = pos_group_for_wing]
    ref_stats[wing_n < 3L | !is.finite(wing_mean), wing_mean := global_mean]
    ref_stats[wing_n < 3L | !is.finite(wing_sd) | wing_sd == 0, wing_sd := global_sd]
    attr(ref_stats, "global_mean") <- global_mean
    attr(ref_stats, "global_sd") <- global_sd
  }

  global_mean <- attr(ref_stats, "global_mean")
  global_sd <- attr(ref_stats, "global_sd")
  if (!is.finite(global_mean)) global_mean <- mean(dt$wingspan_numeric_for_ref, na.rm = TRUE)
  if (!is.finite(global_sd) || global_sd == 0) global_sd <- sd(dt$wingspan_numeric_for_ref, na.rm = TRUE)
  if (!is.finite(global_sd) || global_sd == 0) global_sd <- 1

  dt <- merge(dt, ref_stats[, .(pos_group_for_wing, wing_mean, wing_sd)], by = "pos_group_for_wing", all.x = TRUE, sort = FALSE)
  dt[!is.finite(wing_mean), wing_mean := global_mean]
  dt[!is.finite(wing_sd) | wing_sd == 0, wing_sd := global_sd]
  dt[, `r.wingspan` := (wingspan_numeric_for_ref - wing_mean) / wing_sd]
  dt[, c("pos_group_for_wing", "wingspan_numeric_for_ref", "wing_mean", "wing_sd") := NULL]
  attr(dt, "ref_stats") <- ref_stats
  dt
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

build_experiment_nba_outputs <- function(base_dir, exp_dir) {
  source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)
  live_dir <- get_live_data_dir(base_dir, create = FALSE)
  raw_dir <- file.path(base_dir, "raw")

  matchup_dt <- build_matchup_difficulty(file.path(raw_dir, "switch"))
  measurements <- fread(file.path(raw_dir, "databallr_stats.csv"), na.strings = c("", "NA", "N/A", "NaN")) %>%
    as.data.frame() %>%
    transmute(
      nba_id = clean_id(nba_id),
      year = as.integer(year),
      height_wo_shoes_in = suppressWarnings(as.numeric(height_wo_shoes_in))
    ) %>%
    distinct(nba_id, year, .keep_all = TRUE)

  impact_hist <- read_csv(file.path(live_dir, "impactoutput.csv"), show_col_types = FALSE) %>%
    transmute(nba_id = clean_id(nba_id), year = as.integer(year), def_dep = as.numeric(def_dep))

  def_exp <- read_csv(file.path(live_dir, "defdata.csv"), show_col_types = FALSE) %>%
    add_alias_columns() %>%
    mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
    select(-any_of("def_dep")) %>%
    left_join(impact_hist, by = c("nba_id", "year")) %>%
    left_join(matchup_dt, by = c("nba_id", "year")) %>%
    left_join(measurements, by = c("nba_id", "year"))

  def_terms <- c(
    "matchup_difficulty",
    "Steals_100",
    "d_FTOVs_Per100",
    "d_DefRebounds_Per100",
    "d_Blocks_Per100",
    "rim_points_saved_100",
    "height_wo_shoes_in"
  )
  fit_df <- def_exp %>%
    filter(!year %in% c(2016, 2017), !is.na(def_dep)) %>%
    select(def_dep, all_of(def_terms)) %>%
    filter(complete.cases(.))
  def_formula <- as.formula(paste("def_dep ~", paste(vapply(def_terms, format_formula_term, character(1)), collapse = " + ")))
  def_fit <- lm(def_formula, data = fit_df)
  def_results <- build_results_table(def_fit)

  exp_defdata <- file.path(exp_dir, "defdata_matchup_height.csv")
  exp_def_results <- file.path(exp_dir, "def_lm_matchup_height_results.csv")
  fwrite(def_exp, exp_defdata, na = "")
  fwrite(def_results, exp_def_results, na = "")

  skillmap <- fread(file.path(base_dir, "ref", "skillmap.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  term_rows <- grep("^Term[0-9]+$", skillmap$VAR)
  ensure_term_row <- function(skillmap, term_name) {
    if (term_name %in% skillmap$VAR) return(skillmap)
    empty <- as.list(rep(NA_character_, ncol(skillmap)))
    names(empty) <- names(skillmap)
    empty$VAR <- term_name
    rbind(skillmap, as.data.table(empty), fill = TRUE)
  }
  skillmap <- ensure_term_row(skillmap, "Term3")
  skillmap[VAR == "Term1", SWITCH := "matchup_difficulty"]
  skillmap[VAR == "Term2", SWITCH := NA_character_]
  skillmap[VAR == "Term3", RIMPRO := "height_wo_shoes_in"]
  exp_skillmap <- file.path(exp_dir, "skillmap_matchup_height.csv")
  fwrite(skillmap, exp_skillmap, na = "")

  exp_impact_script <- write_modified_impact_script(base_dir, exp_dir, exp_skillmap, exp_defdata, exp_def_results)
  source(exp_impact_script, local = new.env(parent = globalenv()))

  skilloutput <- fread(file.path(exp_dir, "skilloutput.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  if ("SWITCH" %in% names(skilloutput)) skilloutput[, MATCHUP := SWITCH]
  if ("SWITCH_raw" %in% names(skilloutput)) skilloutput[, MATCHUP_raw := SWITCH_raw]
  fwrite(skilloutput, file.path(exp_dir, "skilloutput.csv"), na = "")

  list(
    def_results = def_results,
    def_r2 = summary(def_fit)$r.squared,
    def_adj_r2 = summary(def_fit)$adj.r.squared,
    def_rows = nobs(def_fit),
    exp_skillmap = exp_skillmap,
    exp_skilloutput = file.path(exp_dir, "skilloutput.csv")
  )
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

add_relative_wingspan_to_experiment_sources <- function(exp_dir) {
  training_path <- file.path(exp_dir, "draft_training_data.csv")
  domestic_path <- file.path(exp_dir, "draft_prediction_domestic.csv")
  international_path <- file.path(exp_dir, "draft_prediction_international.csv")

  train_dt <- fread(training_path, na.strings = c("", "NA", "N/A", "NaN"))
  train_dt <- add_relative_wingspan_with_reference(train_dt)
  ref_stats <- attr(train_dt, "ref_stats")
  fwrite(train_dt, training_path, na = "")

  for (path in c(domestic_path, international_path)) {
    dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
    dt <- add_relative_wingspan_with_reference(dt, ref_stats)
    fwrite(dt, path, na = "")
  }
}

build_experiment_draft_sources <- function(base_dir, exp_dir, exp_skilloutput) {
  env <- c(
    SKILL_OUTPUT_INPUT = exp_skilloutput,
    DRAFT_TRAINING_OUTPUT = file.path(exp_dir, "draft_training_data.csv"),
    DRAFT_DOMESTIC_OUTPUT = file.path(exp_dir, "draft_prediction_domestic.csv"),
    DRAFT_INTERNATIONAL_OUTPUT = file.path(exp_dir, "draft_prediction_international.csv"),
    DRAFT_TRAINING_MATCH_REVIEW_OUTPUT = file.path(exp_dir, "draft_training_match_review.csv"),
    DRAFT_SOURCE_BASE_OUTPUT = file.path(exp_dir, "draft_prediction_source_base.csv"),
    SCV_REVIEW_OUTPUT = file.path(exp_dir, "scv_review_latest_class.csv")
  )
  with_env(env, {
    source(file.path(base_dir, "script", "draft", "build_draft_source_tables.R"), local = new.env(parent = globalenv()))
  })
  add_relative_wingspan_to_experiment_sources(exp_dir)
}

train_experiment_draft_defense <- function(base_dir, exp_dir) {
  env <- c(
    DRAFT_TRAINING_FILE = file.path(exp_dir, "draft_training_data.csv"),
    DRAFT_TARGET_SKILLS = "DPM,DREB,RIMPRO,SWITCH",
    DRAFT_REFRESH_TRAINING_TARGETS = "false",
    DRAFT_MODEL_FAMILIES = "ranger",
    DRAFT_PREDICTION_SPECS = paste(
      sprintf("domestic=%s", file.path(exp_dir, "draft_prediction_domestic.csv")),
      sprintf("international=%s", file.path(exp_dir, "draft_prediction_international.csv")),
      sep = ";"
    ),
    DRAFT_OUTPUT_PREDS = file.path(exp_dir, "draft_skill_predictions_defense_only.csv"),
    DRAFT_MODELS_RDS = file.path(exp_dir, "trained_defense_skill_models.rds"),
    DRAFT_SUMMARY_FP = file.path(exp_dir, "draft_def_model_summary.csv"),
    DRAFT_DETAIL_FP = file.path(exp_dir, "draft_def_model_feature_details.csv"),
    DRAFT_SUMMARY_HISTORY_FP = file.path(exp_dir, "draft_def_model_summary_history.csv"),
    DRAFT_PRESERVE_EXISTING_OUTPUT = "false"
  )
  with_env(env, {
    source(file.path(base_dir, "script", "draft", "draftmodeltrain.txt"), local = new.env(parent = globalenv()))
  })
}

safe_prediction_z <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  finite_idx <- is.finite(x)
  out <- rep(NA_real_, length(x))
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

combine_experiment_predictions <- function(base_dir, exp_dir, def_intercept) {
  current <- fread(file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv"), na.strings = c("", "NA", "N/A", "NaN"))
  defense <- fread(file.path(exp_dir, "draft_skill_predictions_defense_only.csv"), na.strings = c("", "NA", "N/A", "NaN"))

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
  combined[, MATCHUP_raw_pred := SWITCH_raw_pred]
  combined[, MATCHUP_pred := SWITCH_pred]

  for (skill in c("DPM", "DREB", "RIMPRO", "SWITCH", "MATCHUP")) {
    raw_col <- paste0(skill, "_raw_pred")
    pred_col <- paste0(skill, "_pred")
    if (raw_col %in% names(combined)) {
      combined[, (pred_col) := safe_prediction_z(get(raw_col)), by = draft_year]
    }
  }

  out_path <- file.path(exp_dir, "draft_skill_predictions_output_combined.csv")
  fwrite(combined, out_path, na = "")
  out_path
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
  picks <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = suppressWarnings(as.numeric(pick_overall))
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

evaluate_experiment_tracker <- function(base_dir, exp_dir, pred_path) {
  script_path <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
  lines <- readLines(script_path, warn = FALSE, encoding = "UTF-8")
  cut <- grep("^base_dir <- resolve_base_dir\\(\\)", lines)[1]
  eval(parse(text = paste(lines[seq_len(cut - 1)], collapse = "\n")), envir = .GlobalEnv)
  source(file.path(base_dir, "script", "draft", "name_matching.R"), local = .GlobalEnv)

  latest_impact_year <- max(fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year, na.rm = TRUE)
  actual <- build_actual_outcomes(base_dir, latest_impact_year)
  panel <- make_prediction_panel_from_file(base_dir, pred_path)
  adj <- fread(file.path(base_dir, "processed", "draft", "draft_tracker_model_adjustment.csv"))

  b_age <- adj$b_age[1]
  b_pick <- adj$b_pick[1]
  fit_years <- as.integer(strsplit(adj$fit_years[1], ",")[[1]])
  post_years <- sort(intersect(setdiff(unique(actual$draft_year), fit_years), unique(panel$draft_year)))
  post_years <- post_years[post_years > max(fit_years)]

  score_rank_panel <- function(rank_col, label, years) {
    joined <- merge(
      actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
      panel[draft_year %in% years, .(draft_year, name_key, rank = get(rank_col))],
      by = c("draft_year", "name_key"),
      all.x = TRUE,
      sort = FALSE
    )
    out <- joined[, .(score = score_board_year(.SD, "rank")), by = draft_year]
    out[, board := label]
    out
  }

  panel[, candidate_total := TOTAL_pred + b_age * age_feature + b_pick * pick_feature]
  panel[, candidate_rank := frank(-candidate_total, ties.method = "first"), by = draft_year]

  base_scores <- score_rank_panel("base_rank", "SCV Base Model", post_years)
  adj_scores <- score_rank_panel("candidate_rank", "SCV Adjusted Model", post_years)
  actual_pick_scores <- actual[draft_year %in% post_years, .(score = score_board_year(.SD, "actual_pick")), by = draft_year]
  actual_pick_scores[, board := "NBA Draft - Actual"]

  boards <- read_tracker_workbook_boards(base_dir, post_years)
  if (nrow(boards)) {
    boards[, name_key := normalize_name(player)]
    tracker_joined <- merge(
      actual[draft_year %in% post_years, .(draft_year, name_key, actual_rank, actual_weight)],
      boards[, .(draft_year, name_key, board, board_rank)],
      by = c("draft_year", "name_key"),
      all.x = TRUE,
      allow.cartesian = TRUE,
      sort = FALSE
    )
    external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]
  } else {
    external_scores <- data.table()
  }

  all_scores <- rbindlist(
    list(
      external_scores,
      actual_pick_scores[, .(draft_year, board, score)],
      base_scores[, .(draft_year, board, score)],
      adj_scores[, .(draft_year, board, score)]
    ),
    use.names = TRUE,
    fill = TRUE
  )
  all_scores <- all_scores[is.finite(score)]
  all_scores[, z_score := {
    sig <- sd(score, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(score, na.rm = TRUE)) / sig
  }, by = draft_year]
  all_scores[, year_weight := year_weight(draft_year, latest_impact_year)]
  summary_scores <- all_scores[, .(
    weighted_score = weighted.mean(score, year_weight, na.rm = TRUE),
    weighted_z = weighted.mean(z_score, year_weight, na.rm = TRUE),
    years = .N
  ), by = board][order(-weighted_z, -weighted_score)]

  fwrite(summary_scores, file.path(exp_dir, "draft_tracker_board_summary.csv"), na = "")
  fwrite(all_scores[order(draft_year, -z_score, -score)], file.path(exp_dir, "draft_tracker_board_scores.csv"), na = "")
  summary_scores
}

base_dir <- resolve_base_dir()
exp_dir <- file.path(base_dir, "processed", "draft", "matchup_height_experiment")
dir.create(exp_dir, recursive = TRUE, showWarnings = FALSE)

nba <- build_experiment_nba_outputs(base_dir, exp_dir)
build_experiment_draft_sources(base_dir, exp_dir, nba$exp_skilloutput)
train_experiment_draft_defense(base_dir, exp_dir)

def_intercept <- nba$def_results$estimate[nba$def_results$term == "(Intercept)"][[1]]
combined_pred_path <- combine_experiment_predictions(base_dir, exp_dir, def_intercept)
tracker_summary <- evaluate_experiment_tracker(base_dir, exp_dir, combined_pred_path)

nba_summary <- data.table(
  model = "def_matchup_height",
  rows = nba$def_rows,
  r2 = nba$def_r2,
  adj_r2 = nba$def_adj_r2,
  pithy_switch_name = "MATCHUP"
)
fwrite(nba_summary, file.path(exp_dir, "nba_def_model_summary.csv"), na = "")

cat("\nNBA defense summary:\n")
print(nba_summary)
cat("\nDraft defense model summary:\n")
print(fread(file.path(exp_dir, "draft_def_model_summary.csv"))[, .(
  skill,
  display_skill = fifelse(skill == "SWITCH", "MATCHUP", skill),
  model_type,
  n_rows,
  train_r2_pct,
  temporal_r2,
  temporal_mse,
  validation_rows,
  predictors
)])
cat("\nDraft tracker summary:\n")
print(tracker_summary)
cat("\nExperiment outputs written to: ", exp_dir, "\n", sep = "")
