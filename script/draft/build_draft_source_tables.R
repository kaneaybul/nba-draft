library(data.table)
library(readxl)

anglicize_text <- function(x) {
  raw_x <- as.character(x)
  safe_x <- suppressWarnings(iconv(raw_x, from = "UTF-8", to = "UTF-8", sub = ""))
  fill_idx <- is.na(safe_x) & !is.na(raw_x)
  safe_x[fill_idx] <- raw_x[fill_idx]
  converted <- suppressWarnings(iconv(safe_x, from = "", to = "ASCII//TRANSLIT", sub = ""))
  fill_idx <- is.na(converted) & !is.na(safe_x)
  converted[fill_idx] <- safe_x[fill_idx]
  trimws(converted)
}

normalize_join_name <- function(x) {
  x <- anglicize_text(x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

resolve_base_dir <- function() {
  wd <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- unique(c(
    wd,
    file.path(wd, ".."),
    file.path(wd, "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  ))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "script")) &&
        dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

read_draftvar_variables <- function(path) {
  if (!file.exists(path)) {
    stop("draftvar workbook not found: ", path)
  }
  sheet_names <- excel_sheets(path)
  if (!length(sheet_names)) {
    stop("draftvar workbook has no sheets: ", path)
  }
  draftvar_df <- as.data.table(read_excel(path, sheet = sheet_names[[1]]))
  if (!nrow(draftvar_df)) {
    stop("draftvar workbook is empty: ", path)
  }
  value_col <- names(draftvar_df)[1]
  vars <- trimws(as.character(draftvar_df[[value_col]]))
  vars <- vars[nzchar(vars) & !is.na(vars)]
  unique(vars)
}

read_scv_lookup <- function(path) {
  if (!file.exists(path)) {
    return(data.table(join_player = character(), scv_draft = numeric()))
  }
  scv_dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!all(c("name", "sc") %in% names(scv_dt))) {
    return(data.table(join_player = character(), scv_draft = numeric()))
  }
  scv_dt[, join_player := normalize_join_name(name)]
  scv_dt[, scv_draft := suppressWarnings(as.numeric(sc))]
  scv_dt <- scv_dt[nzchar(join_player) & is.finite(scv_draft)]
  setorder(scv_dt, join_player, scv_draft)
  unique(scv_dt[, .(join_player, scv_draft)], by = "join_player")
}

prepare_skill_targets <- function(skill_fp) {
  if (!file.exists(skill_fp)) {
    stop("skilloutput not found: ", skill_fp)
  }
  skill_dt <- fread(skill_fp, na.strings = c("", "NA", "N/A", "NaN"))
  base_skill_cols <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  raw_skill_cols <- paste0(base_skill_cols, "_raw")
  impact_col <- c("IMPACT_TOTAL", "TOTAL")[c("IMPACT_TOTAL", "TOTAL") %in% names(skill_dt)][1]
  required_cols <- c("nba_id", "player_name", "year", raw_skill_cols)
  missing_cols <- setdiff(required_cols, names(skill_dt))
  if (length(missing_cols)) {
    stop("skilloutput missing required columns: ", paste(missing_cols, collapse = ", "))
  }
  if (is.na(impact_col) || !nzchar(impact_col)) {
    stop("skilloutput missing IMPACT_TOTAL/TOTAL column needed for target-year selection.")
  }
  skill_dt[, outcome_year := suppressWarnings(as.integer(year))]
  skill_dt[, join_player := normalize_join_name(player_name)]
  skill_dt[, impact_total := suppressWarnings(as.numeric(get(impact_col)))]
  for (skill_name in base_skill_cols) {
    raw_col <- paste0(skill_name, "_raw")
    skill_dt[[skill_name]] <- suppressWarnings(as.numeric(skill_dt[[raw_col]]))
  }
  setorder(skill_dt, join_player, outcome_year, nba_id)
  unique(skill_dt[, .(
    join_player,
    outcome_year,
    nba_id = as.character(nba_id),
    player_name,
    impact_total,
    FTD, OREB, PASS, RIM, SHOOT, DPM, DREB, RIMPRO, SWITCH
  )], by = c("join_player", "outcome_year"))
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
ref_dir <- file.path(base_dir, "ref")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

draftballr_fp <- Sys.getenv("DRAFTBALLR_INPUT", file.path(draft_dir, "draftballr.csv"))
draftvar_fp <- Sys.getenv("DRAFTVAR_INPUT", file.path(ref_dir, "draftvar.xlsx"))
scv_fp <- Sys.getenv("SCV_INPUT", file.path(ref_dir, "scvardraft.csv"))
skill_fp <- Sys.getenv("SKILL_OUTPUT_INPUT", file.path(live_dir, "skilloutput.csv"))

training_fp <- Sys.getenv("DRAFT_TRAINING_OUTPUT", file.path(draft_dir, "draft_training_data.csv"))
domestic_fp <- Sys.getenv("DRAFT_DOMESTIC_OUTPUT", file.path(draft_dir, "draft_prediction_domestic.csv"))
international_fp <- Sys.getenv("DRAFT_INTERNATIONAL_OUTPUT", file.path(draft_dir, "draft_prediction_international.csv"))
review_fp <- Sys.getenv("DRAFT_TRAINING_MATCH_REVIEW_OUTPUT", file.path(draft_dir, "draft_training_match_review.csv"))
source_fp <- Sys.getenv("DRAFT_SOURCE_BASE_OUTPUT", file.path(draft_dir, "draft_prediction_source_base.csv"))

outcome_lag <- suppressWarnings(as.integer(Sys.getenv("DRAFT_OUTCOME_LAG", "4")))
if (!is.finite(outcome_lag) || outcome_lag < 1L) outcome_lag <- 4L
target_mode <- trimws(tolower(Sys.getenv("DRAFT_TARGET_MODE", "best_impact_post_year_1")))
if (!target_mode %in% c("best_impact_post_year_1", "best_impact_3_5", "latest_available", "fixed_lag")) {
  target_mode <- "best_impact_post_year_1"
}
min_years_after_draft <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_YEARS_AFTER_DRAFT", "4")))
if (!is.finite(min_years_after_draft) || min_years_after_draft < 0L) min_years_after_draft <- 4L
min_draft_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_DRAFT_YEAR", "0")))
if (!is.finite(min_draft_year)) min_draft_year <- 0L
max_train_draft_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MAX_TRAIN_DRAFT_YEAR", "")))
if (!is.finite(max_train_draft_year)) max_train_draft_year <- NA_integer_
target_window_min <- suppressWarnings(as.integer(Sys.getenv("DRAFT_TARGET_WINDOW_MIN", "2")))
if (!is.finite(target_window_min)) target_window_min <- 2L
target_window_max_raw <- trimws(Sys.getenv("DRAFT_TARGET_WINDOW_MAX", ""))
target_window_max <- suppressWarnings(as.integer(target_window_max_raw))
if (!is.finite(target_window_max) && nzchar(target_window_max_raw)) target_window_max <- NA_integer_
if (identical(target_mode, "best_impact_3_5")) {
  if (!is.finite(target_window_max)) target_window_max <- 5L
  if (target_window_max < target_window_min) target_window_max <- target_window_min
} else if (is.finite(target_window_max) && target_window_max < target_window_min) {
  target_window_max <- target_window_min
}
prediction_all_years <- identical(
  tolower(trimws(Sys.getenv("DRAFT_PREDICT_ALL_YEARS", "false"))),
  "true"
)

draft_dt <- fread(draftballr_fp, na.strings = c("", "NA", "N/A", "NaN"))
draft_dt[, player := anglicize_text(player)]
draft_dt[, join_player := normalize_join_name(player)]
draft_dt[, draft_year := suppressWarnings(as.integer(year))]

draftvar_vars <- read_draftvar_variables(draftvar_fp)
available_vars <- intersect(draftvar_vars, names(draft_dt))

id_cols <- c(
  "player", "join_player", "year", "draft_year", "id", "player_id", "espn_id",
  "cbbd_id", "big_board_rank", "birthdate", "draft_age", "height_wo_shoes_in",
  "wingspan_in", "weight_lbs", "pos_code", "hometown"
)
keep_cols <- unique(c(id_cols, available_vars))
keep_cols <- keep_cols[keep_cols %in% names(draft_dt)]
draft_dt <- draft_dt[, ..keep_cols]

scv_lookup <- read_scv_lookup(scv_fp)
draft_dt <- merge(draft_dt, scv_lookup, by = "join_player", all.x = TRUE, sort = FALSE)

prediction_year <- max(draft_dt$draft_year, na.rm = TRUE)

if (prediction_all_years) {
  domestic_dt <- copy(draft_dt[!is.na(cbbd_id)])
  international_dt <- copy(draft_dt[is.na(cbbd_id)])
} else {
  domestic_dt <- copy(draft_dt[draft_year == prediction_year & !is.na(cbbd_id)])
  international_dt <- copy(draft_dt[draft_year == prediction_year & is.na(cbbd_id)])
}

skill_targets_dt <- prepare_skill_targets(skill_fp)

training_candidates <- copy(draft_dt[draft_year >= min_draft_year & draft_year < prediction_year])
if (is.finite(max_train_draft_year)) {
  training_candidates <- training_candidates[draft_year <= max_train_draft_year]
}
training_candidates <- training_candidates[!is.na(scv_draft)]
training_candidates <- training_candidates[!is.na(cbbd_id)]
if (identical(target_mode, "fixed_lag")) {
  training_candidates[, outcome_year := draft_year + outcome_lag]
  training_dt <- merge(
    training_candidates,
    skill_targets_dt,
    by = c("join_player", "outcome_year"),
    all.x = TRUE,
    sort = FALSE,
    suffixes = c("", "_skill")
  )
} else if (identical(target_mode, "latest_available")) {
  training_dt <- merge(
    training_candidates,
    skill_targets_dt,
    by = "join_player",
    all.x = TRUE,
    sort = FALSE,
    suffixes = c("", "_skill"),
    allow.cartesian = TRUE
  )
  training_dt[, years_after_draft := outcome_year - draft_year]
  training_dt <- training_dt[is.na(outcome_year) | years_after_draft >= min_years_after_draft]
  setorder(training_dt, join_player, draft_year, -outcome_year)
  training_dt <- training_dt[, .SD[1], by = .(join_player, draft_year)]
} else {
  training_dt <- merge(
    training_candidates,
    skill_targets_dt,
    by = "join_player",
    all.x = TRUE,
    sort = FALSE,
    suffixes = c("", "_skill"),
    allow.cartesian = TRUE
  )
  training_dt[, years_after_draft := outcome_year - draft_year]
  training_dt <- training_dt[!is.na(outcome_year)]
  training_dt[, max_years_after_draft := suppressWarnings(max(years_after_draft, na.rm = TRUE)), by = .(join_player, draft_year)]
  training_dt <- training_dt[
    is.finite(years_after_draft) &
      is.finite(max_years_after_draft) &
      max_years_after_draft >= min_years_after_draft &
      years_after_draft >= target_window_min &
      (
        !is.finite(target_window_max) |
          years_after_draft <= target_window_max
      ) &
      is.finite(impact_total)
  ]
  setorder(training_dt, join_player, draft_year, -impact_total, -outcome_year)
  training_dt <- training_dt[, .SD[1], by = .(join_player, draft_year)]
}

if ("player_name" %in% names(training_dt)) {
  training_dt[, nba_player := player_name]
  training_dt[, player_name := NULL]
}
training_dt[, years_after_draft := outcome_year - draft_year]
training_dt[, selection_score := fifelse(!is.na(nba_id), 1, 0)]

review_dt <- training_dt[, .(
  player,
  draft_year,
  outcome_year,
  years_after_draft,
  impact_total,
  cbbd_id,
  scv_draft,
  matched_skill = !is.na(nba_id),
  nba_id,
  nba_player
)]

training_dt <- training_dt[!is.na(nba_id)]

if (identical(target_mode, "best_impact_post_year_1")) {
  invalid_target_rows <- training_dt[
    !is.finite(years_after_draft) |
      years_after_draft < target_window_min |
      !is.finite(max_years_after_draft) |
      max_years_after_draft < min_years_after_draft
  ]
  if (nrow(invalid_target_rows)) {
    stop("Target selection invariant failed: expected best-year rows from year 2 onward with at least 4 years of experience.")
  }
}

setcolorder(training_dt, c(
  intersect(c(
    "player", "draft_year", "outcome_year", "years_after_draft", "nba_id",
    "nba_player", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"
  ), names(training_dt)),
  setdiff(names(training_dt), c(
    "player", "draft_year", "outcome_year", "years_after_draft", "nba_id",
    "nba_player", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"
  ))
))

setcolorder(domestic_dt, c(
  intersect(c("player", "draft_year", "year", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"), names(domestic_dt)),
  setdiff(names(domestic_dt), c("player", "draft_year", "year", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"))
))

setcolorder(international_dt, c(
  intersect(c("player", "draft_year", "year", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"), names(international_dt)),
  setdiff(names(international_dt), c("player", "draft_year", "year", "scv_draft", "id", "player_id", "espn_id", "cbbd_id"))
))

source_dt <- rbindlist(list(copy(domestic_dt), copy(international_dt)), use.names = TRUE, fill = TRUE)
source_dt[, source_bucket := fifelse(!is.na(cbbd_id), "domestic", "international")]

fwrite(training_dt, training_fp, na = "")
fwrite(domestic_dt, domestic_fp, na = "")
fwrite(international_dt, international_fp, na = "")
fwrite(review_dt, review_fp, na = "")
fwrite(source_dt, source_fp, na = "")

cat("Built draft training data ->", training_fp, "\n")
cat("Built domestic prediction source ->", domestic_fp, "\n")
cat("Built international prediction source ->", international_fp, "\n")
cat("Built training match review ->", review_fp, "\n")
cat("Built source base ->", source_fp, "\n")
cat("Training rows:", nrow(training_dt), "\n")
cat("Domestic prediction rows:", nrow(domestic_dt), "\n")
cat("International prediction rows:", nrow(international_dt), "\n")
cat("Prediction year:", prediction_year, "\n")
cat("Predict all years:", prediction_all_years, "\n")
cat("Target mode:", target_mode, "\n")
cat("Outcome lag:", outcome_lag, "\n")
cat("Min years after draft:", min_years_after_draft, "\n")
cat("Min draft year:", min_draft_year, "\n")
cat("Max train draft year:", if (is.finite(max_train_draft_year)) max_train_draft_year else "none", "\n")
cat(
  "Target window:",
  if (is.finite(target_window_max)) {
    paste0(target_window_min, "-", target_window_max)
  } else {
    paste0(target_window_min, "+")
  },
  "\n"
)
