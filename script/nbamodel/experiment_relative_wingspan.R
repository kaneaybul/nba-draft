library(dplyr)
library(purrr)
library(readr)
library(data.table)

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

primary_pos <- function(x) {
  x <- trimws(as.character(x))
  x[is.na(x) | x == ""] <- "UNKNOWN"
  sub("-.*$", "", x)
}

add_relative_wingspan <- function(df) {
  df <- df %>%
    mutate(
      nba_id = clean_id(nba_id),
      year = as.integer(year),
      height_wo_shoes_in = suppressWarnings(as.numeric(height_wo_shoes_in)),
      wingspan_in = suppressWarnings(as.numeric(wingspan_in)),
      primary_pos = primary_pos(Pos2)
    )

  global_mean <- mean(df$wingspan_in, na.rm = TRUE)
  global_sd <- sd(df$wingspan_in, na.rm = TRUE)
  if (!is.finite(global_sd) || global_sd == 0) global_sd <- 1

  df %>%
    group_by(primary_pos) %>%
    mutate(
      pos_wing_n = sum(is.finite(wingspan_in)),
      pos_wing_mean = ifelse(pos_wing_n >= 10, mean(wingspan_in, na.rm = TRUE), global_mean),
      pos_wing_sd_raw = ifelse(pos_wing_n >= 10, sd(wingspan_in, na.rm = TRUE), global_sd),
      pos_wing_sd = ifelse(is.finite(pos_wing_sd_raw) & pos_wing_sd_raw > 0, pos_wing_sd_raw, global_sd),
      r.wingspan = (wingspan_in - pos_wing_mean) / pos_wing_sd
    ) %>%
    ungroup() %>%
    select(nba_id, year, primary_pos, height_wo_shoes_in, wingspan_in, r.wingspan)
}

process_one_switch_season <- function(raw_dir, season) {
  minutes_path <- file.path(raw_dir, paste0("minutes_", season, ".rds"))
  matchups_path <- file.path(raw_dir, paste0("matchups_", season, ".rds"))
  positions_path <- file.path(raw_dir, "player_positions.rds")
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
      player_name = first(DEF_PLAYER_NAME),
      POSS = sum(PARTIAL_POSS, na.rm = TRUE),
      avg_PTS = weighted.mean(SEASON_PTS_100, w = PARTIAL_POSS, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    inner_join(
      minutes %>% transmute(player_id = as.character(PLAYER_ID), MIN = as.numeric(MIN)),
      by = c("DEF_PLAYER_ID" = "player_id")
    ) %>%
    group_by(season) %>%
    mutate(matchup_difficulty = safe_z(avg_PTS)) %>%
    ungroup() %>%
    transmute(
      nba_id = clean_id(DEF_PLAYER_ID),
      year = as.integer(paste0("20", substr(season, 6, 7))),
      matchup_difficulty
    )
}

build_matchup_difficulty <- function(raw_dir) {
  seasons <- paste0(2016:2025, "-", substr(2017:2026, 3, 4))
  map_dfr(seasons, ~ process_one_switch_season(raw_dir, .x)) %>%
    distinct(nba_id, year, .keep_all = TRUE)
}

fit_metrics <- function(df, target, terms, model_name, compare_to = NA_real_) {
  vars <- all.vars(as.formula(paste(target, "~", paste(vapply(terms, format_formula_term, character(1)), collapse = " + "))))
  fit_df <- df[complete.cases(df[, vars]), , drop = FALSE]
  fit <- lm(as.formula(paste(target, "~", paste(vapply(terms, format_formula_term, character(1)), collapse = " + "))), data = fit_df)
  s <- summary(fit)
  coef_df <- as.data.frame(s$coefficients)
  coef_df$term <- rownames(coef_df)
  rownames(coef_df) <- NULL
  list(
    metrics = data.frame(
      model = model_name,
      rows = nobs(fit),
      r2 = unname(s$r.squared),
      adj_r2 = unname(s$adj.r.squared),
      delta_r2_vs_base = ifelse(is.finite(compare_to), unname(s$r.squared) - compare_to, NA_real_),
      sigma = unname(s$sigma),
      stringsAsFactors = FALSE
    ),
    coefficients = coef_df %>%
      transmute(
        model = model_name,
        term,
        estimate = Estimate,
        std_error = `Std. Error`,
        t_value = `t value`,
        p_value = `Pr(>|t|)`
      )
  )
}

run_family <- function(df, target, base_terms, feature_sets, family_name) {
  rows <- lapply(names(feature_sets), function(label) {
    added_terms <- feature_sets[[label]]
    common_terms <- unique(c(base_terms, added_terms))
    common_vars <- all.vars(as.formula(paste(target, "~", paste(vapply(common_terms, format_formula_term, character(1)), collapse = " + "))))
    common_df <- df[complete.cases(df[, common_vars]), , drop = FALSE]

    base_fit <- fit_metrics(common_df, target, base_terms, paste0(family_name, "__base_common_for__", label))
    augmented_fit <- fit_metrics(common_df, target, common_terms, paste0(family_name, "__plus__", label), base_fit$metrics$r2[[1]])

    list(
      metrics = bind_rows(base_fit$metrics, augmented_fit$metrics) %>% mutate(model_family = family_name, added_feature_set = label, .before = model),
      coefficients = bind_rows(base_fit$coefficients, augmented_fit$coefficients) %>% mutate(model_family = family_name, added_feature_set = label, .before = model)
    )
  })

  list(
    metrics = bind_rows(map(rows, "metrics")),
    coefficients = bind_rows(map(rows, "coefficients"))
  )
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)
live_dir <- get_live_data_dir(base_dir, create = FALSE)
raw_dir <- file.path(base_dir, "raw")
out_dir <- file.path(base_dir, "processed", "modelresults", "relative_wingspan_experiment")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)
impact_hist <- read_csv(file.path(live_dir, "impactoutput.csv"), show_col_types = FALSE) %>%
  transmute(nba_id = clean_id(nba_id), year = as.integer(year), off_dep = as.numeric(off_dep), def_dep = as.numeric(def_dep))

measurements <- fread(file.path(raw_dir, "databallr_stats.csv"), na.strings = c("", "NA", "N/A", "NaN")) %>%
  as.data.frame() %>%
  add_relative_wingspan()

off_hist <- read_csv(file.path(live_dir, "offdata.csv"), show_col_types = FALSE) %>%
  add_alias_columns() %>%
  mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
  select(-any_of("off_dep")) %>%
  left_join(impact_hist %>% select(nba_id, year, off_dep), by = c("nba_id", "year")) %>%
  left_join(measurements, by = c("nba_id", "year")) %>%
  filter(!is.na(off_dep))

matchup_dt <- build_matchup_difficulty(file.path(raw_dir, "switch"))
def_hist <- read_csv(file.path(live_dir, "defdata.csv"), show_col_types = FALSE) %>%
  add_alias_columns() %>%
  mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
  select(-any_of("def_dep")) %>%
  left_join(impact_hist %>% select(nba_id, year, def_dep), by = c("nba_id", "year")) %>%
  left_join(measurements, by = c("nba_id", "year")) %>%
  left_join(matchup_dt, by = c("nba_id", "year")) %>%
  mutate(switch = matchup_difficulty) %>%
  filter(!is.na(def_dep), !year %in% c(2016, 2017))

off_terms <- extract_model_terms(skillmap, "Offense?")
def_terms <- extract_model_terms(skillmap, "Defense?")

feature_sets <- list(
  height = c("height_wo_shoes_in"),
  wingspan = c("wingspan_in"),
  relative_wingspan = c("r.wingspan"),
  height_wingspan_relative = c("height_wo_shoes_in", "wingspan_in", "r.wingspan")
)

coverage <- bind_rows(
  off_hist %>% summarize(model_family = "offense", rows = n(), height_pct = mean(is.finite(height_wo_shoes_in)), wingspan_pct = mean(is.finite(wingspan_in)), relative_wingspan_pct = mean(is.finite(r.wingspan))),
  def_hist %>% summarize(model_family = "defense_matchup_only", rows = n(), height_pct = mean(is.finite(height_wo_shoes_in)), wingspan_pct = mean(is.finite(wingspan_in)), relative_wingspan_pct = mean(is.finite(r.wingspan)))
) %>%
  mutate(across(ends_with("_pct"), ~ round(100 * .x, 2)))

off_results <- run_family(off_hist, "off_dep", off_terms, feature_sets, "offense")
def_results <- run_family(def_hist, "def_dep", def_terms, feature_sets, "defense_matchup_only")

metrics <- bind_rows(off_results$metrics, def_results$metrics)
coefficients <- bind_rows(off_results$coefficients, def_results$coefficients)

fwrite(coverage, file.path(out_dir, "coverage.csv"), na = "")
fwrite(metrics, file.path(out_dir, "metrics.csv"), na = "")
fwrite(coefficients, file.path(out_dir, "coefficients.csv"), na = "")

cat("Coverage:\n")
print(coverage)
cat("\nMetrics:\n")
print(metrics)
cat("\nAdded feature coefficients:\n")
print(coefficients %>% filter(term %in% unique(unlist(feature_sets, use.names = FALSE))))
cat("\nOutputs written to: ", out_dir, "\n", sep = "")
