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

process_one_switch_season <- function(raw_dir, season) {
  minutes_path <- file.path(raw_dir, paste0("minutes_", season, ".rds"))
  matchups_path <- file.path(raw_dir, paste0("matchups_", season, ".rds"))
  positions_path <- file.path(raw_dir, "player_positions.rds")
  if (!file.exists(minutes_path) || !file.exists(matchups_path) || !file.exists(positions_path)) {
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
      switch_assignment_difficulty = safe_z(avg_PTS),
      switch_versatility = safe_z(-position_concentration),
      switch_70_30_raw = 0.7 * switch_assignment_difficulty + 0.3 * switch_versatility,
      switch_70_30 = safe_z(switch_70_30_raw)
    ) %>%
    ungroup() %>%
    transmute(
      nba_id = clean_id(player_id),
      player_name,
      season,
      year = as.integer(paste0("20", substr(season, 6, 7))),
      switch_assignment_difficulty,
      switch_versatility,
      switch_70_30
    )
}

build_switch_components <- function(raw_dir) {
  seasons <- paste0(2016:2025, "-", substr(2017:2026, 3, 4))
  map_dfr(seasons, ~ process_one_switch_season(raw_dir, .x)) %>%
    distinct(nba_id, year, .keep_all = TRUE)
}

fit_one <- function(model_df, terms) {
  fit <- lm(as.formula(paste("def_dep ~", paste(vapply(terms, format_formula_term, character(1)), collapse = " + "))), data = model_df)
  coefs <- as.data.frame(summary(fit)$coefficients)
  coefs$term <- rownames(coefs)
  rownames(coefs) <- NULL
  list(
    fit = fit,
    metrics = data.frame(
      rows = nobs(fit),
      r2 = unname(summary(fit)$r.squared),
      adj_r2 = unname(summary(fit)$adj.r.squared),
      sigma = unname(summary(fit)$sigma),
      stringsAsFactors = FALSE
    ),
    coefficients = coefs %>%
      transmute(
        term,
        estimate = Estimate,
        std_error = `Std. Error`,
        t_value = `t value`,
        p_value = `Pr(>|t|)`
      )
  )
}

base_dir <- resolve_base_dir()
raw_dir <- file.path(base_dir, "raw", "switch")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
out_dir <- file.path(base_dir, "processed", "draft", "switch_separate_experiment")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

def_hist <- read_csv(file.path(live_dir, "defdata.csv"), show_col_types = FALSE) %>% add_alias_columns()
impact_hist <- read_csv(file.path(live_dir, "impactoutput.csv"), show_col_types = FALSE)
skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)
switch_components <- build_switch_components(raw_dir)

base_terms <- extract_model_terms(skillmap, "Defense?")
separate_terms <- c(
  setdiff(base_terms, "switch"),
  "switch_assignment_difficulty",
  "switch_versatility"
)

model_df <- def_hist %>%
  mutate(nba_id = clean_id(nba_id), year = as.integer(year)) %>%
  select(-any_of("def_dep")) %>%
  left_join(
    switch_components %>%
      select(nba_id, year, switch_assignment_difficulty, switch_versatility, switch_70_30),
    by = c("nba_id", "year")
  ) %>%
  mutate(switch_70_30 = ifelse(!is.na(switch_70_30), switch_70_30, switch)) %>%
  left_join(
    impact_hist %>% transmute(nba_id = clean_id(nba_id), year = as.integer(year), def_dep = as.numeric(def_dep)),
    by = c("nba_id", "year")
  ) %>%
  filter(!is.na(def_dep))

views <- list(
  all_with_2016_zero = model_df %>%
    mutate(
      switch_assignment_difficulty = ifelse(year == 2016 & is.na(switch_assignment_difficulty), 0, switch_assignment_difficulty),
      switch_versatility = ifelse(year == 2016 & is.na(switch_versatility), 0, switch_versatility),
      switch = switch_70_30
    ),
  drop_2016 = model_df %>%
    filter(year != 2016) %>%
    mutate(switch = switch_70_30)
)

results <- imap(views, function(view_df, view_name) {
  common_vars <- all.vars(as.formula(paste(
    "def_dep ~",
    paste(vapply(unique(c(base_terms, separate_terms)), format_formula_term, character(1)), collapse = " + ")
  )))
  view_df <- view_df[complete.cases(view_df[, common_vars]), ]

  current_fit <- fit_one(view_df, base_terms)
  separate_fit <- fit_one(view_df, separate_terms)

  metrics <- bind_rows(
    current_fit$metrics %>% mutate(training_view = view_name, model = "current_70_30_blend"),
    separate_fit$metrics %>% mutate(training_view = view_name, model = "separate_assignment_versatility")
  ) %>%
    mutate(delta_r2_vs_current = r2 - r2[model == "current_70_30_blend"])

  coefficients <- bind_rows(
    current_fit$coefficients %>% mutate(training_view = view_name, model = "current_70_30_blend"),
    separate_fit$coefficients %>% mutate(training_view = view_name, model = "separate_assignment_versatility")
  )

  list(metrics = metrics, coefficients = coefficients)
})

metrics <- bind_rows(map(results, "metrics")) %>%
  select(training_view, model, rows, r2, adj_r2, delta_r2_vs_current, sigma)
coefficients <- bind_rows(map(results, "coefficients")) %>%
  select(training_view, model, term, estimate, std_error, t_value, p_value)

fwrite(metrics, file.path(out_dir, "def_switch_separate_metrics.csv"), na = "")
fwrite(coefficients, file.path(out_dir, "def_switch_separate_coefficients.csv"), na = "")

cat("Metrics:\n")
print(metrics)
cat("\nSwitch-related coefficients:\n")
print(coefficients %>% filter(grepl("switch", term)))
cat("\nOutputs written to: ", out_dir, "\n", sep = "")
