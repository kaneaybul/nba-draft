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

format_formula_term <- function(term) {
  term <- as.character(term)
  if (grepl("^`.*`$", term) || grepl("^I\\(", term) || grepl("^[A-Za-z.][A-Za-z0-9._]*$", term)) {
    term
  } else {
    paste0("`", term, "`")
  }
}

process_one_switch_season <- function(raw_dir, season, assignment_weight, versatility_weight) {
  offense_path <- file.path(raw_dir, paste0("offense_", season, ".rds"))
  minutes_path <- file.path(raw_dir, paste0("minutes_", season, ".rds"))
  matchups_path <- file.path(raw_dir, paste0("matchups_", season, ".rds"))
  positions_path <- file.path(raw_dir, "player_positions.rds")
  if (!file.exists(offense_path) || !file.exists(minutes_path) || !file.exists(matchups_path) || !file.exists(positions_path)) {
    message("Missing raw files for ", season, " - skipping.")
    return(NULL)
  }

  minutes <- readRDS(minutes_path)
  matchups <- readRDS(matchups_path)
  player_positions <- readRDS(positions_path)
  if (!"PTS" %in% names(matchups)) return(NULL)

  matchups2 <- matchups %>%
    rename(SEASON_PTS_100 = PTS) %>%
    mutate(
      PARTIAL_POSS = as.numeric(PARTIAL_POSS),
      PLAYER_PTS = as.numeric(PLAYER_PTS),
      MATCHUP_FGA = as.numeric(MATCHUP_FGA),
      MATCHUP_TOV = as.numeric(MATCHUP_TOV),
      MATCHUP_FTA = as.numeric(MATCHUP_FTA),
      OFF_PLAYER_ID = as.character(OFF_PLAYER_ID),
      DEF_PLAYER_ID = as.character(DEF_PLAYER_ID)
    ) %>%
    inner_join(player_positions, by = c("OFF_PLAYER_ID" = "PERSON_ID"))

  if (!nrow(matchups2)) return(NULL)

  matchups2 %>%
    group_by(DEF_PLAYER_ID, season) %>%
    summarize(
      player_name = first(DEF_PLAYER_NAME),
      POSS = sum(PARTIAL_POSS, na.rm = TRUE),
      avg_PTS = weighted.mean(SEASON_PTS_100, w = PARTIAL_POSS, na.rm = TRUE),
      C_Percentage = sum(PARTIAL_POSS * (POSITION == "C"), na.rm = TRUE) / sum(PARTIAL_POSS, na.rm = TRUE),
      F_Percentage = sum(PARTIAL_POSS * (POSITION == "F"), na.rm = TRUE) / sum(PARTIAL_POSS, na.rm = TRUE),
      G_Percentage = sum(PARTIAL_POSS * (POSITION == "G"), na.rm = TRUE) / sum(PARTIAL_POSS, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    mutate(
      player_id = as.character(DEF_PLAYER_ID),
      position_concentration = sqrt((C_Percentage^2 * 2) + F_Percentage^2 + G_Percentage^2)
    ) %>%
    inner_join(
      minutes %>% transmute(player_id = as.character(PLAYER_ID), MIN = as.numeric(MIN)),
      by = "player_id"
    ) %>%
    group_by(season) %>%
    mutate(
      z_versatility = safe_z(-position_concentration),
      z_assignment_difficulty = safe_z(avg_PTS),
      switch_raw = assignment_weight * z_assignment_difficulty + versatility_weight * z_versatility,
      switch = safe_z(switch_raw)
    ) %>%
    ungroup() %>%
    transmute(
      nba_id = clean_id(player_id),
      player_name,
      season,
      year = as.integer(paste0("20", substr(season, 6, 7))),
      switch
    )
}

build_switch_table <- function(raw_dir, assignment_weight, versatility_weight) {
  seasons <- paste0(2016:2025, "-", substr(2017:2026, 3, 4))
  map_dfr(seasons, ~ process_one_switch_season(raw_dir, .x, assignment_weight, versatility_weight)) %>%
    distinct(nba_id, year, .keep_all = TRUE)
}

fit_def_model <- function(def_hist, impact_hist, skillmap, switch_dt, drop_2016 = FALSE) {
  def_terms <- extract_model_terms(skillmap, "Defense?")
  model_df <- def_hist %>%
    mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
    left_join(switch_dt %>% select(nba_id, year, switch_exp = switch), by = c("nba_id", "year")) %>%
    mutate(switch = ifelse(!is.na(switch_exp), switch_exp, switch)) %>%
    select(-switch_exp) %>%
    left_join(
      impact_hist %>% transmute(nba_id = clean_id(nba_id), year = as.integer(year), def_dep = as.numeric(def_dep)),
      by = c("nba_id", "year")
    ) %>%
    filter(!is.na(def_dep))

  if (drop_2016) model_df <- model_df %>% filter(year != 2016)
  fit <- lm(as.formula(paste("def_dep ~", paste(vapply(def_terms, format_formula_term, character(1)), collapse = " + "))), data = model_df)
  list(
    fit = fit,
    rows = nobs(fit),
    years = paste(range(model_df$year), collapse = "-"),
    r2 = unname(summary(fit)$r.squared),
    adj_r2 = unname(summary(fit)$adj.r.squared),
    switch_coef = unname(coef(fit)[["switch"]])
  )
}

write_training_variant <- function(train_dt, switch_dt, switch_coef, out_path) {
  out_dt <- copy(train_dt)
  out_dt[, nba_id := clean_id(nba_id)]
  out_dt[, outcome_year := as.integer(outcome_year)]
  switch_join <- as.data.table(switch_dt %>% transmute(nba_id, outcome_year = year, switch_exp = switch))
  out_dt <- merge(out_dt, switch_join, by = c("nba_id", "outcome_year"), all.x = TRUE, sort = FALSE)
  missing_targets <- out_dt[!is.finite(switch_exp), .N]
  if (missing_targets > 0) stop("Missing experimental switch targets for ", missing_targets, " draft training rows.")
  out_dt[, SWITCH := switch_coef * switch_exp]
  out_dt[, switch_exp := NULL]
  fwrite(out_dt, out_path, na = "")
}

run_draft_switch_model <- function(base_dir, exp_dir, label, training_file) {
  env <- c(
    DRAFT_TRAINING_FILE = training_file,
    DRAFT_TARGET_SKILLS = "SWITCH",
    DRAFT_REFRESH_TRAINING_TARGETS = "false",
    DRAFT_PREDICTION_SPECS = paste0("none=", file.path(exp_dir, paste0(label, "_no_prediction_source.csv"))),
    DRAFT_OUTPUT_PREDS = file.path(exp_dir, paste0(label, "_predictions.csv")),
    DRAFT_MODELS_RDS = file.path(exp_dir, paste0(label, "_models.rds")),
    DRAFT_SUMMARY_FP = file.path(exp_dir, paste0(label, "_summary.csv")),
    DRAFT_DETAIL_FP = file.path(exp_dir, paste0(label, "_details.csv")),
    DRAFT_SUMMARY_HISTORY_FP = file.path(exp_dir, paste0(label, "_summary_history.csv")),
    DRAFT_PRESERVE_EXISTING_OUTPUT = "false"
  )

  old_env <- Sys.getenv(names(env), unset = NA_character_)
  restore_env <- function() {
    to_unset <- names(old_env)[is.na(old_env)]
    to_restore <- old_env[!is.na(old_env)]
    if (length(to_unset)) Sys.unsetenv(to_unset)
    if (length(to_restore)) do.call(Sys.setenv, as.list(to_restore))
  }
  on.exit(restore_env(), add = TRUE)

  do.call(Sys.setenv, as.list(env))
  source(
    file.path(base_dir, "script", "draft", "draftmodeltrain.txt"),
    local = new.env(parent = globalenv())
  )

  fread(file.path(exp_dir, paste0(label, "_summary.csv")))[skill == "SWITCH"]
}

base_dir <- resolve_base_dir()
raw_dir <- file.path(base_dir, "raw", "switch")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
draft_dir <- file.path(base_dir, "processed", "draft")
exp_dir <- file.path(draft_dir, "switch_mix_experiment")
dir.create(exp_dir, recursive = TRUE, showWarnings = FALSE)

mixes <- data.table(
  label = c(
    "current_70_assignment_30_versatility",
    "test_60_assignment_40_versatility",
    "test_50_assignment_50_versatility",
    "test_40_assignment_60_versatility"
  ),
  assignment_weight = c(0.7, 0.6, 0.5, 0.4),
  versatility_weight = c(0.3, 0.4, 0.5, 0.6)
)

def_hist <- read_csv(file.path(live_dir, "defdata.csv"), show_col_types = FALSE) %>% add_alias_columns()
impact_hist <- read_csv(file.path(live_dir, "impactoutput.csv"), show_col_types = FALSE)
skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)
train_dt <- fread(file.path(draft_dir, "draft_training_data.csv"), na.strings = c("", "NA", "N/A", "NaN"))

switch_tables <- setNames(
  lapply(seq_len(nrow(mixes)), function(i) build_switch_table(raw_dir, mixes$assignment_weight[[i]], mixes$versatility_weight[[i]])),
  mixes$label
)

nba_rows <- lapply(seq_len(nrow(mixes)), function(i) {
  label <- mixes$label[[i]]
  switch_dt <- switch_tables[[label]]
  all_fit <- fit_def_model(def_hist, impact_hist, skillmap, switch_dt, drop_2016 = FALSE)
  drop_fit <- fit_def_model(def_hist, impact_hist, skillmap, switch_dt, drop_2016 = TRUE)
  data.table(
    label = label,
    assignment_weight = mixes$assignment_weight[[i]],
    versatility_weight = mixes$versatility_weight[[i]],
    training_view = c("all_with_2016_zero", "drop_2016"),
    rows = c(all_fit$rows, drop_fit$rows),
    years = c(all_fit$years, drop_fit$years),
    r2 = c(all_fit$r2, drop_fit$r2),
    adj_r2 = c(all_fit$adj_r2, drop_fit$adj_r2),
    switch_coef = c(all_fit$switch_coef, drop_fit$switch_coef)
  )
})
nba_summary <- rbindlist(nba_rows)
fwrite(nba_summary, file.path(exp_dir, "nba_def_model_summary.csv"), na = "")

draft_rows <- lapply(seq_len(nrow(mixes)), function(i) {
  label <- mixes$label[[i]]
  switch_dt <- switch_tables[[label]]
  all_coef <- nba_summary[nba_summary[["label"]] == label & training_view == "all_with_2016_zero", switch_coef]
  training_path <- file.path(exp_dir, paste0(label, "_draft_training_data.csv"))
  write_training_variant(train_dt, switch_dt, all_coef, training_path)
  summary_dt <- run_draft_switch_model(base_dir, exp_dir, label, training_path)
  summary_dt[, `:=`(
    label = label,
    assignment_weight = mixes$assignment_weight[[i]],
    versatility_weight = mixes$versatility_weight[[i]]
  )]
  summary_dt
})
draft_summary <- rbindlist(draft_rows, use.names = TRUE, fill = TRUE)
fwrite(draft_summary, file.path(exp_dir, "college_switch_model_summary.csv"), na = "")

cat("NBA defensive model summary:\n")
print(nba_summary)
cat("\nCollege SWITCH draft model summary:\n")
print(draft_summary[, .(
  label,
  assignment_weight,
  versatility_weight,
  n_rows,
  train_r2_pct,
  temporal_r2,
  temporal_mse,
  validation_rows,
  predictors
)])
cat("\nExperiment outputs written to:\n", exp_dir, "\n", sep = "")
