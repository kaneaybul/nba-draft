library(dplyr)
library(tidyr)
library(readr)
library(purrr)
library(openxlsx)

# =========================================================
# FILE PATHS
# =========================================================
resolve_base_dir <- function() {
  candidates <- c(
    getwd(),
    file.path(getwd(), ".."),
    file.path(getwd(), "..", "..")
  )

  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "raw")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

base_dir      <- resolve_base_dir()
source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)
processed_dir <- file.path(base_dir, "processed")
livedata_dir  <- get_live_data_dir(base_dir, create = TRUE)
results_dir   <- file.path(processed_dir, "modelresults")

migrate_legacy_live_data_files(
  base_dir,
  files = c("offdata.csv", "defdata.csv", "impactoutput.csv", "skilloutput.csv", "skilloutput.xlsx")
)

off_hist_path <- file.path(livedata_dir, "offdata.csv")
def_hist_path <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/switch_perimeter_defense_experiment_original193/with_steals/defdata_switch_perimeter.csv"
impact_path   <- file.path(livedata_dir, "impactoutput.csv")

skill_path <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/switch_perimeter_defense_experiment_original193/with_steals/skillmap_switch_perimeter.csv"
off_path   <- file.path(results_dir, "off_lm_1_results.csv")
def_path <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/switch_perimeter_defense_experiment_original193/with_steals/def_lm_switch_perimeter_results.csv"

out_csv <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/switch_perimeter_defense_experiment_original193/with_steals/skilloutput.csv"
out_xlsx <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/switch_perimeter_defense_experiment_original193/with_steals/skilloutput.xlsx"

# =========================================================
# HELPERS
# =========================================================
add_alias_columns <- function(df) {
  alias_pairs <- c(
    "X3PA_100" = "3PA_100",
    "X3P_PERC" = "3P_PERC",
    "X3PA"     = "3PA",
    "X3P"      = "3P"
  )

  for (target_name in names(alias_pairs)) {
    source_name <- alias_pairs[[target_name]]
    if (!(target_name %in% names(df)) && source_name %in% names(df)) {
      df[[target_name]] <- df[[source_name]]
    }
  }

  df
}

clean_display_name <- function(x) {
  x <- as.character(x)
  x <- trimws(x)
  x[x == ""] <- NA_character_
  x <- iconv(x, from = "", to = "ASCII//TRANSLIT")
  x <- gsub("[?`']", "", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

normalize_player_key <- function(x) {
  x <- clean_display_name(x)
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}

eval_term <- function(data, term_string) {
  if (term_string %in% names(data)) {
    out <- suppressWarnings(as.numeric(data[[term_string]]))
    if (length(out) != nrow(data)) {
      stop("Term did not evaluate to one value per input row: ", term_string)
    }
    return(out)
  }

  eval_data <- as.list(data)
  syntactic_names <- make.names(names(data))
  for (i in seq_along(syntactic_names)) {
    if (!(syntactic_names[[i]] %in% names(eval_data))) {
      eval_data[[syntactic_names[[i]]]] <- data[[i]]
    }
  }

  if (grepl("^I\\(.+\\)$", term_string)) {
    inner <- sub("^I\\((.*)\\)$", "\\1", term_string)
    out <- eval(parse(text = inner), envir = eval_data)
    out <- suppressWarnings(as.numeric(out))
    if (length(out) != nrow(data)) {
      stop("Term did not evaluate to one value per input row: ", term_string)
    }
    return(out)
  }

  mm <- model.matrix(
    as.formula(paste0("~ 0 + ", term_string)),
    data = as.data.frame(eval_data, check.names = FALSE),
    na.action = stats::na.pass
  )
  out <- rep(NA_real_, nrow(data))
  out[as.integer(rownames(mm))] <- as.numeric(mm[, 1])
  if (length(out) != nrow(data)) {
    stop("Term did not evaluate to one value per input row: ", term_string)
  }
  out
}

safe_z <- function(x) {
  s <- sd(x, na.rm = TRUE)
  m <- mean(x, na.rm = TRUE)

  if (is.na(s) || s == 0) {
    return(rep(0, length(x)))
  }

  (x - m) / s
}

safe_mean <- function(...) {
  vals <- c(...)
  vals <- vals[!is.na(vals)]
  if (length(vals) == 0) return(NA_real_)
  mean(vals)
}

write_csv_with_retry <- function(df, path, attempts = 5, sleep_seconds = 2) {
  last_error <- NULL

  for (i in seq_len(attempts)) {
    result <- tryCatch(
      {
        readr::write_csv(df, path)
        TRUE
      },
      error = function(e) e
    )

    if (isTRUE(result)) {
      return(invisible(TRUE))
    }

    last_error <- result
    message("Write attempt ", i, " failed for ", path)

    if (i < attempts) {
      Sys.sleep(sleep_seconds)
    }
  }

  stop(
    paste0(
      "Could not write output file: ", path, "\n",
      "If this file is open in Excel or another program, close it and try again.\n",
      "Original error: ", conditionMessage(last_error)
    )
  )
}

save_workbook_with_retry <- function(wb, path, attempts = 5, sleep_seconds = 2) {
  last_error <- NULL

  for (i in seq_len(attempts)) {
    result <- tryCatch(
      {
        saveWorkbook(wb, path, overwrite = TRUE)
        TRUE
      },
      error = function(e) e
    )

    if (isTRUE(result)) {
      return(invisible(TRUE))
    }

    last_error <- result
    message("Write attempt ", i, " failed for ", path)

    if (i < attempts) {
      Sys.sleep(sleep_seconds)
    }
  }

  stop(
    paste0(
      "Could not write output file: ", path, "\n",
      "If this file is open in Excel or another program, close it and try again.\n",
      "Original error: ", conditionMessage(last_error)
    )
  )
}

# =========================================================
# READ FILES
# =========================================================
off_hist <- read_csv(off_hist_path, show_col_types = FALSE)
def_hist <- read_csv(def_hist_path, show_col_types = FALSE)
impact_hist <- read_csv(impact_path, show_col_types = FALSE)
skillmap <- read_csv(skill_path, show_col_types = FALSE)
off_raw  <- read_csv(off_path, show_col_types = FALSE)
def_raw  <- read_csv(def_path, show_col_types = FALSE)

off_hist <- add_alias_columns(off_hist)
def_hist <- add_alias_columns(def_hist)

# =========================================================
# BASIC CHECKS
# =========================================================
required_id_cols <- c("player_name", "year")

missing_off_id_cols <- setdiff(required_id_cols, names(off_hist))
missing_def_id_cols <- setdiff(required_id_cols, names(def_hist))

if (length(missing_off_id_cols) > 0) {
  stop(
    paste0(
      "offdata.csv is missing required column(s): ",
      paste(missing_off_id_cols, collapse = ", ")
    )
  )
}

if (length(missing_def_id_cols) > 0) {
  stop(
    paste0(
      "defdata.csv is missing required column(s): ",
      paste(missing_def_id_cols, collapse = ", ")
    )
  )
}

required_impact_cols <- c("nba_id", "player_name", "year", "off_dep", "def_dep")
missing_impact_cols <- setdiff(required_impact_cols, names(impact_hist))

if (length(missing_impact_cols) > 0) {
  stop(
    paste0(
      "impactoutput.csv is missing required column(s): ",
      paste(missing_impact_cols, collapse = ", ")
    )
  )
}

if (!"VAR" %in% names(skillmap)) {
  stop("skillmap.csv must contain a VAR column.")
}

# =========================================================
# COEFFICIENT TABLES
# =========================================================
off_coef <- off_raw %>%
  select(term, estimate = Estimate) %>%
  mutate(model = "off")

def_coef <- def_raw %>%
  select(term, estimate) %>%
  mutate(model = "def")

off_intercept <- off_coef %>%
  filter(term == "(Intercept)") %>%
  pull(estimate)

def_intercept <- def_coef %>%
  filter(term == "(Intercept)") %>%
  pull(estimate)

if (length(off_intercept) != 1) stop("Could not find exactly one offense intercept.")
if (length(def_intercept) != 1) stop("Could not find exactly one defense intercept.")

off_intercept <- off_intercept[[1]]
def_intercept <- def_intercept[[1]]

# =========================================================
# SKILLMAP -> LONG
# =========================================================
skills <- setdiff(names(skillmap), "VAR")

term_rows <- skillmap %>%
  filter(grepl("^Term[0-9]+$", VAR)) %>%
  mutate(term_order = as.integer(sub("^Term", "", VAR))) %>%
  arrange(term_order)
off_row   <- skillmap %>% filter(VAR == "Offense?")
def_row   <- skillmap %>% filter(VAR == "Defense?")

if (nrow(term_rows) == 0 || nrow(off_row) != 1 || nrow(def_row) != 1) {
  stop("skillmap.csv must have at least one Term# row and exactly one row each for Offense? and Defense?.")
}

skillmap_long <- map_dfr(skills, function(skill_name) {
  these_terms <- term_rows[[skill_name]]

  these_terms <- these_terms[!is.na(these_terms) & these_terms != ""]

  tibble(
    skill = skill_name,
    term = these_terms,
    off_flag = suppressWarnings(as.numeric(off_row[[skill_name]][1])),
    def_flag = suppressWarnings(as.numeric(def_row[[skill_name]][1]))
  )
}) %>%
  mutate(
    model = case_when(
      off_flag == 1 ~ "off",
      def_flag == 1 ~ "def",
      TRUE ~ NA_character_
    )
  ) %>%
  filter(!is.na(model)) %>%
  select(skill, term, model)

# =========================================================
# MODEL-SPECIFIC TERM MAPS
# =========================================================
off_skill_terms <- skillmap_long %>%
  filter(model == "off") %>%
  inner_join(
    off_coef %>% filter(term != "(Intercept)"),
    by = c("term", "model")
  ) %>%
  distinct(skill, term, model, estimate)

def_skill_terms <- skillmap_long %>%
  filter(model == "def") %>%
  inner_join(
    def_coef %>% filter(term != "(Intercept)"),
    by = c("term", "model")
  ) %>%
  distinct(skill, term, model, estimate)

if (nrow(off_skill_terms) == 0) stop("No overlap found between offense skillmap terms and offense coefficients.")
if (nrow(def_skill_terms) == 0) stop("No overlap found between defense skillmap terms and defense coefficients.")

bad_off_terms <- off_skill_terms %>%
  count(term) %>%
  filter(n > 1)

bad_def_terms <- def_skill_terms %>%
  count(term) %>%
  filter(n > 1)

if (nrow(bad_off_terms) > 0) {
  print(bad_off_terms, n = Inf)
  stop("Offense term mapping duplicated one or more terms.")
}

if (nrow(bad_def_terms) > 0) {
  print(bad_def_terms, n = Inf)
  stop("Defense term mapping duplicated one or more terms.")
}

# =========================================================
# GENERIC MODEL BUILDER
# =========================================================
build_model_skill_table <- function(hist_df, skill_terms) {
  unique_terms <- unique(skill_terms$term)
  id_cols <- intersect(c("nba_id", "player_name", "year"), names(hist_df))

  failed_terms <- character(0)
  term_eval_list <- vector("list", length(unique_terms))
  names(term_eval_list) <- unique_terms

  for (tm in unique_terms) {
    val <- tryCatch(
      eval_term(hist_df, tm),
      error = function(e) e
    )

    if (inherits(val, "error")) {
      failed_terms <- c(failed_terms, tm)
    } else {
      term_eval_list[[tm]] <- val
    }
  }

  if (length(failed_terms) > 0) {
    stop(
      paste0(
        "These terms could not be evaluated:\n",
        paste(failed_terms, collapse = "\n")
      )
    )
  }

  term_values <- hist_df %>%
    select(all_of(id_cols))

  for (tm in unique_terms) {
    term_values[[tm]] <- term_eval_list[[tm]]
  }

  term_values_long <- term_values %>%
    pivot_longer(
      cols = -all_of(id_cols),
      names_to = "term",
      values_to = "term_value"
    )

  skill_contrib_long <- term_values_long %>%
    inner_join(skill_terms, by = "term") %>%
    mutate(contribution = term_value * estimate)

  skill_scores <- skill_contrib_long %>%
    group_by(across(all_of(id_cols)), skill) %>%
    summarise(skill_score = sum(contribution, na.rm = TRUE), .groups = "drop")

  skill_scores %>%
    select(all_of(id_cols), skill, skill_score) %>%
    pivot_wider(
      names_from = skill,
      values_from = skill_score,
      values_fill = 0
    )
}

load_draft_skill_priors <- function(base_dir, skill_cols) {
  pred_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv")
  empty <- tibble(nba_id = character(), draft_year = integer())
  for (skill_col in skill_cols) {
    empty[[skill_col]] <- numeric()
  }

  if (!file.exists(pred_path)) {
    return(empty)
  }

  pred <- read_csv(pred_path, show_col_types = FALSE)
  if (!all(c("player", "draft_year") %in% names(pred))) {
    return(empty)
  }

  raw_pred_cols <- paste0(skill_cols, "_raw_pred")
  if (!any(raw_pred_cols %in% names(pred))) {
    return(empty)
  }

  prior <- tibble(
    player_key = normalize_player_key(pred$player),
    draft_year = suppressWarnings(as.integer(pred$draft_year))
  )

  for (skill_col in skill_cols) {
    raw_col <- paste0(skill_col, "_raw_pred")
    prior[[skill_col]] <- if (raw_col %in% names(pred)) {
      suppressWarnings(as.numeric(pred[[raw_col]]))
    } else {
      NA_real_
    }
  }

  id_maps <- list()

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (file.exists(stats_path)) {
    stats <- read_csv(stats_path, show_col_types = FALSE)
    name_col <- names(stats)[names(stats) %in% c("player_name", "player", "PLAYER_NAME", "name", "Name")][1]
    if (!is.na(name_col) && all(c("nba_id", "draft_year") %in% names(stats))) {
      id_maps[[length(id_maps) + 1]] <- stats %>%
        transmute(
          player_key = normalize_player_key(.data[[name_col]]),
          draft_year = suppressWarnings(as.integer(draft_year)),
          nba_id = as.character(nba_id)
        )
    }
  }

  training_path <- file.path(base_dir, "processed", "draft", "draft_training_data.csv")
  if (file.exists(training_path)) {
    training <- read_csv(training_path, show_col_types = FALSE)
    if (all(c("player", "draft_year", "nba_id") %in% names(training))) {
      id_maps[[length(id_maps) + 1]] <- training %>%
        transmute(
          player_key = normalize_player_key(player),
          draft_year = suppressWarnings(as.integer(draft_year)),
          nba_id = as.character(nba_id)
        )
    }
    if (all(c("nba_player", "draft_year", "nba_id") %in% names(training))) {
      id_maps[[length(id_maps) + 1]] <- training %>%
        transmute(
          player_key = normalize_player_key(nba_player),
          draft_year = suppressWarnings(as.integer(draft_year)),
          nba_id = as.character(nba_id)
        )
    }
  }

  if (length(id_maps) == 0) {
    return(empty)
  }

  id_map <- bind_rows(id_maps) %>%
    filter(!is.na(nba_id), nba_id != "", !is.na(draft_year), player_key != "") %>%
    distinct(player_key, draft_year, nba_id) %>%
    group_by(player_key, draft_year) %>%
    mutate(id_count = n_distinct(nba_id)) %>%
    ungroup() %>%
    filter(id_count == 1) %>%
    select(-id_count) %>%
    distinct(player_key, draft_year, .keep_all = TRUE)

  prior %>%
    filter(!is.na(draft_year), player_key != "") %>%
    left_join(id_map, by = c("player_key", "draft_year")) %>%
    filter(!is.na(nba_id), nba_id != "") %>%
    arrange(nba_id, draft_year) %>%
    distinct(nba_id, draft_year, .keep_all = TRUE) %>%
    select(nba_id, draft_year, all_of(skill_cols))
}

stabilize_skill_columns <- function(df,
                                    skill_cols,
                                    draft_priors = NULL,
                                    window_minutes = 4000,
                                    season_decay = 0.75,
                                    draft_prior_minutes = 650,
                                    low_sample_full_weight_minutes = 2000) {
  if (length(skill_cols) == 0 || !("SOURCE_MINUTES" %in% names(df))) {
    return(df)
  }

  window_minutes <- suppressWarnings(as.numeric(window_minutes))
  season_decay <- suppressWarnings(as.numeric(season_decay))
  draft_prior_minutes <- suppressWarnings(as.numeric(draft_prior_minutes))
  low_sample_full_weight_minutes <- suppressWarnings(as.numeric(low_sample_full_weight_minutes))

  if (is.na(window_minutes) || window_minutes <= 0) window_minutes <- 4000
  if (is.na(season_decay) || season_decay <= 0 || season_decay > 1) season_decay <- 0.75
  if (is.na(draft_prior_minutes) || draft_prior_minutes < 0) draft_prior_minutes <- 650
  if (is.na(low_sample_full_weight_minutes) || low_sample_full_weight_minutes <= 0) {
    low_sample_full_weight_minutes <- 2000
  }

  df <- df %>%
    mutate(
      nba_id = as.character(nba_id),
      year = suppressWarnings(as.integer(year)),
      SOURCE_MINUTES = suppressWarnings(as.numeric(SOURCE_MINUTES))
    ) %>%
    arrange(nba_id, year)

  for (skill_col in skill_cols) {
    df[[skill_col]] <- suppressWarnings(as.numeric(df[[skill_col]]))
  }

  original_skills <- df[, skill_cols, drop = FALSE]
  out_skills <- lapply(skill_cols, function(skill_col) rep(NA_real_, nrow(df)))
  names(out_skills) <- skill_cols
  window_actual <- rep(NA_real_, nrow(df))
  window_effective <- rep(NA_real_, nrow(df))
  reliability <- rep(NA_real_, nrow(df))
  draft_prior_effective <- rep(0, nrow(df))

  draft_lookup <- list()
  if (!is.null(draft_priors) && nrow(draft_priors) > 0) {
    draft_priors <- draft_priors %>%
      mutate(
        nba_id = as.character(nba_id),
        draft_year = suppressWarnings(as.integer(draft_year))
      )
    draft_lookup <- split(draft_priors, draft_priors$nba_id)
  }

  player_rows <- split(seq_len(nrow(df)), df$nba_id)

  for (rows in player_rows) {
    rows <- rows[order(df$year[rows])]

    for (row_i in rows) {
      season <- df$year[row_i]
      remaining <- window_minutes
      hist_rows <- rows[df$year[rows] <= season & df$year[rows] >= season - 3]
      hist_rows <- hist_rows[order(df$year[hist_rows], decreasing = TRUE)]
      has_prior_nba <- any(df$year[rows] < season & !is.na(df$SOURCE_MINUTES[rows]) & df$SOURCE_MINUTES[rows] > 0)

      numerator <- setNames(rep(0, length(skill_cols)), skill_cols)
      denominator <- setNames(rep(0, length(skill_cols)), skill_cols)
      actual_used <- 0
      effective_used <- 0
      draft_effective_used <- 0

      for (hist_i in hist_rows) {
        minutes <- df$SOURCE_MINUTES[hist_i]
        if (is.na(minutes) || minutes <= 0 || remaining <= 0) next

        used_minutes <- min(remaining, minutes)
        lag <- max(0, season - df$year[hist_i])
        weight <- used_minutes * season_decay^lag

        for (skill_col in skill_cols) {
          value <- original_skills[[skill_col]][hist_i]
          if (!is.na(value) && is.finite(value)) {
            numerator[[skill_col]] <- numerator[[skill_col]] + value * weight
            denominator[[skill_col]] <- denominator[[skill_col]] + weight
          }
        }

        actual_used <- actual_used + used_minutes
        effective_used <- effective_used + weight
        remaining <- remaining - used_minutes
      }

      if (!has_prior_nba && remaining > 0 && length(draft_lookup) > 0 && df$nba_id[row_i] %in% names(draft_lookup)) {
        prior_rows <- draft_lookup[[df$nba_id[row_i]]]
        prior_rows <- prior_rows[!is.na(prior_rows$draft_year) & prior_rows$draft_year <= season, , drop = FALSE]

        if (nrow(prior_rows) > 0) {
          prior_row <- prior_rows[which.max(prior_rows$draft_year), , drop = FALSE]
          used_minutes <- min(remaining, draft_prior_minutes)
          draft_lag <- max(0, season - prior_row$draft_year[[1]] - 1)
          weight <- used_minutes * season_decay^draft_lag

          for (skill_col in skill_cols) {
            value <- prior_row[[skill_col]][[1]]
            if (!is.na(value) && is.finite(value)) {
              numerator[[skill_col]] <- numerator[[skill_col]] + value * weight
              denominator[[skill_col]] <- denominator[[skill_col]] + weight
            }
          }

          effective_used <- effective_used + weight
          draft_effective_used <- draft_effective_used + weight
        }
      }

      row_reliability <- min(1, effective_used / low_sample_full_weight_minutes)

      for (skill_col in skill_cols) {
        if (denominator[[skill_col]] > 0) {
          out_skills[[skill_col]][row_i] <- (numerator[[skill_col]] / denominator[[skill_col]]) * row_reliability
        }
      }

      window_actual[row_i] <- actual_used
      window_effective[row_i] <- effective_used
      reliability[row_i] <- row_reliability
      draft_prior_effective[row_i] <- draft_effective_used
    }
  }

  for (skill_col in skill_cols) {
    df[[skill_col]] <- out_skills[[skill_col]]
  }

  df$skill_window_minutes <- round(window_actual, 1)
  df$skill_effective_minutes <- round(window_effective, 1)
  df$skill_reliability <- round(reliability, 3)
  df$skill_draft_prior_minutes <- round(draft_prior_effective, 1)

  df
}

# =========================================================
# BUILD OFFENSE / DEFENSE TABLES
# =========================================================
off_tbl <- build_model_skill_table(
  hist_df = off_hist,
  skill_terms = off_skill_terms
)

def_tbl <- build_model_skill_table(
  hist_df = def_hist,
  skill_terms = def_skill_terms
)

# =========================================================
# CHECK FOR OVERLAPPING SKILL NAMES
# =========================================================
off_skill_names <- setdiff(names(off_tbl), c("nba_id", "player_name", "year"))
def_skill_names <- setdiff(names(def_tbl), c("nba_id", "player_name", "year"))

overlap_skills <- intersect(off_skill_names, def_skill_names)

if (length(overlap_skills) > 0) {
  stop(
    paste0(
      "These skill names exist on both offense and defense, so prefixes cannot be safely removed:\n",
      paste(overlap_skills, collapse = "\n")
    )
  )
}

# =========================================================
# MERGE TOGETHER
# =========================================================
join_keys <- intersect(names(off_tbl), names(def_tbl))
join_keys <- intersect(c("nba_id", "player_name", "year"), join_keys)

final_tbl <- full_join(off_tbl, def_tbl, by = join_keys)

skill_cols <- setdiff(names(final_tbl), c("nba_id", "player_name", "year"))
final_tbl[skill_cols] <- lapply(final_tbl[skill_cols], function(x) ifelse(is.na(x), 0, x))

impact_tbl <- impact_hist %>%
  transmute(
    nba_id = as.character(nba_id),
    player_name_impact = clean_display_name(player_name),
    year = as.integer(year),
    SOURCE_MINUTES = suppressWarnings(as.numeric(Minutes)),
    SOURCE_O_EPM = as.numeric(o_epm),
    SOURCE_O_DPM = as.numeric(o_dpm),
    SOURCE_D_EPM = as.numeric(d_epm),
    SOURCE_D_DPM = as.numeric(d_dpm),
    IMPACT_OFF = as.numeric(off_dep),
    IMPACT_DEF = as.numeric(def_dep),
    IMPACT_TOTAL = IMPACT_OFF + IMPACT_DEF
  ) %>%
  distinct(nba_id, year, .keep_all = TRUE)

final_tbl <- final_tbl %>%
  mutate(
    nba_id = as.character(nba_id),
    year = as.integer(year)
  ) %>%
  full_join(impact_tbl, by = c("nba_id", "year")) %>%
  mutate(
    player_name = clean_display_name(coalesce(player_name, player_name_impact))
  ) %>%
  select(-player_name_impact)

off_skill_cols <- off_skill_names
def_skill_cols <- def_skill_names
all_skill_cols <- c(sort(off_skill_cols), sort(def_skill_cols))
draft_skill_priors <- load_draft_skill_priors(base_dir, all_skill_cols)

final_tbl <- stabilize_skill_columns(
  final_tbl,
  skill_cols = all_skill_cols,
  draft_priors = draft_skill_priors,
  window_minutes = Sys.getenv("SKILL_STABILIZATION_MINUTES", unset = "4000"),
  season_decay = Sys.getenv("SKILL_STABILIZATION_DECAY", unset = "0.75"),
  draft_prior_minutes = Sys.getenv("SKILL_DRAFT_PRIOR_MINUTES", unset = "650"),
  low_sample_full_weight_minutes = Sys.getenv("SKILL_LOW_SAMPLE_FULL_WEIGHT_MINUTES", unset = "2000")
)

# =========================================================
# ADD INTERCEPTS AND TOTALS
# =========================================================
final_tbl <- final_tbl %>%
  mutate(
    off_intercept = off_intercept,
    def_intercept = def_intercept
  )

final_tbl <- final_tbl %>%
  mutate(
    OFF = off_intercept + rowSums(across(all_of(off_skill_cols)), na.rm = TRUE),
    DEF = def_intercept + rowSums(across(all_of(def_skill_cols)), na.rm = TRUE),
    TOTAL = OFF + DEF
  ) %>%
  arrange(year, desc(TOTAL), player_name)

# =========================================================
# FINAL IMPACT BLEND: 40% EPM / 40% DPM / 20% SKILL MODEL
# =========================================================
final_tbl <- final_tbl %>%
  group_by(year) %>%
  mutate(
    z_o_epm = safe_z(SOURCE_O_EPM),
    z_o_dpm = safe_z(SOURCE_O_DPM),
    z_skill_off = safe_z(OFF),
    z_d_epm = safe_z(SOURCE_D_EPM),
    z_d_dpm = safe_z(SOURCE_D_DPM),
    z_skill_def = safe_z(DEF),
    final_off_z_raw = 0.40 * z_o_epm + 0.40 * z_o_dpm + 0.20 * z_skill_off,
    final_def_z_raw = 0.40 * z_d_epm + 0.40 * z_d_dpm + 0.20 * z_skill_def,
    final_off_z = safe_z(final_off_z_raw),
    final_def_z = safe_z(final_def_z_raw),
    off_target_mean = mean(IMPACT_OFF, na.rm = TRUE),
    off_target_sd = sd(IMPACT_OFF, na.rm = TRUE),
    def_target_mean = mean(IMPACT_DEF, na.rm = TRUE),
    def_target_sd = sd(IMPACT_DEF, na.rm = TRUE),
    FINAL_OFF = off_target_mean + off_target_sd * final_off_z,
    FINAL_DEF = def_target_mean + def_target_sd * final_def_z,
    FINAL_TOTAL = FINAL_OFF + FINAL_DEF
  ) %>%
  ungroup() %>%
  select(
    -z_o_epm,
    -z_o_dpm,
    -z_skill_off,
    -z_d_epm,
    -z_d_dpm,
    -z_skill_def,
    -final_off_z_raw,
    -final_def_z_raw,
    -final_off_z,
    -final_def_z,
    -off_target_mean,
    -off_target_sd,
    -def_target_mean,
    -def_target_sd
  ) %>%
  arrange(year, desc(FINAL_TOTAL), player_name)

# =========================================================
# ADD Z-SCORED SKILL COLUMNS
# =========================================================
raw_skill_cols <- paste0(all_skill_cols, "_raw")

for (i in seq_along(all_skill_cols)) {
  final_tbl[[raw_skill_cols[[i]]]] <- final_tbl[[all_skill_cols[[i]]]]
}

for (i in seq_along(all_skill_cols)) {
  skill_col <- all_skill_cols[[i]]
  raw_col <- raw_skill_cols[[i]]

  final_tbl <- final_tbl %>%
    group_by(year) %>%
    mutate(!!skill_col := safe_z(.data[[raw_col]])) %>%
    ungroup()
}

# =========================================================
# REORDER COLUMNS
# =========================================================
final_tbl <- final_tbl %>%
  select(
    nba_id,
    player_name,
    year,
    IMPACT_OFF,
    IMPACT_DEF,
    IMPACT_TOTAL,
    SOURCE_O_EPM,
    SOURCE_O_DPM,
    SOURCE_D_EPM,
    SOURCE_D_DPM,
    skill_window_minutes,
    skill_effective_minutes,
    skill_reliability,
    skill_draft_prior_minutes,
    off_intercept,
    def_intercept,
    all_of(all_skill_cols),
    all_of(raw_skill_cols),
    OFF,
    DEF,
    TOTAL,
    FINAL_OFF,
    FINAL_DEF,
    FINAL_TOTAL
  )

# =========================================================
# WRITE MASTER CSV
# =========================================================
write_csv_with_retry(final_tbl, out_csv)

# =========================================================
# WRITE EXCEL WORKBOOK
# =========================================================
wb <- createWorkbook()

addWorksheet(wb, "Master")
writeData(wb, "Master", final_tbl)
freezePane(wb, "Master", firstActiveRow = 2, firstActiveCol = 3)
addFilter(wb, "Master", row = 1, cols = 1:ncol(final_tbl))
setColWidths(wb, "Master", cols = 1:ncol(final_tbl), widths = "auto")

years <- sort(unique(final_tbl$year))

for (yr in years) {
  season_df <- final_tbl %>%
    filter(year == yr) %>%
    arrange(desc(TOTAL), player_name)

  sheet_name <- as.character(yr)
  addWorksheet(wb, sheet_name)
  writeData(wb, sheet_name, season_df)
  freezePane(wb, sheet_name, firstActiveRow = 2, firstActiveCol = 3)
  addFilter(wb, sheet_name, row = 1, cols = 1:ncol(season_df))
  setColWidths(wb, sheet_name, cols = 1:ncol(season_df), widths = "auto")
}

save_workbook_with_retry(wb, out_xlsx)

cat("Done.\n")
cat("Master CSV written to:\n", out_csv, "\n")
cat("Excel workbook written to:\n", out_xlsx, "\n")
