library(data.table)
library(readxl)

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

read_single_scv_lookup <- function(path, priority = 1L) {
  if (!file.exists(path)) {
    return(data.table(join_player = character(), scv_draft = numeric(), source_priority = integer()))
  }
  scv_dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!"name" %in% names(scv_dt)) {
    return(data.table(join_player = character(), scv_draft = numeric(), source_priority = integer()))
  }
  score_col <- names(scv_dt)[tolower(names(scv_dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(data.table(join_player = character(), scv_draft = numeric(), source_priority = integer()))
  }
  scv_dt[, join_player := normalize_join_name(name)]
  scv_dt[, scv_draft := suppressWarnings(as.numeric(get(score_col)))]
  scv_dt[, source_priority := as.integer(priority)]
  scv_dt <- scv_dt[nzchar(join_player) & is.finite(scv_draft)]
  scv_dt[, .(join_player, scv_draft, source_priority)]
}

read_scv_lookup <- function(path, override_path = NULL) {
  combined_dt <- rbindlist(
    list(
      read_single_scv_lookup(path, priority = 1L),
      read_single_scv_lookup(override_path, priority = 2L)
    ),
    use.names = TRUE,
    fill = TRUE
  )
  if (!nrow(combined_dt)) {
    return(data.table(join_player = character(), scv_draft = numeric()))
  }
  setorder(combined_dt, join_player, -source_priority)
  unique(combined_dt[, .(join_player, scv_draft)], by = "join_player")
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

best_n_average <- function(x, n = 2L) {
  x <- suppressWarnings(as.numeric(x))
  x <- x[is.finite(x)]
  if (length(x) < n) return(NA_real_)
  mean(sort(x, decreasing = TRUE)[seq_len(n)])
}

aggregate_best_two_year_skill_targets <- function(training_dt, skill_cols, window_min, window_max, min_window_year, min_eligible_seasons) {
  if (!nrow(training_dt)) return(training_dt)
  if (!is.finite(window_max)) {
    stop("Best two-year skill average target requires a finite target window max.")
  }

  dt <- copy(training_dt)
  dt[, years_after_draft := outcome_year - draft_year]
  dt[, max_years_after_draft := suppressWarnings(max(years_after_draft, na.rm = TRUE)), by = .(join_player, draft_year)]
  dt <- dt[
    is.finite(years_after_draft) &
      is.finite(max_years_after_draft) &
      max_years_after_draft >= min_window_year &
      years_after_draft >= window_min &
      years_after_draft <= window_max
  ]

  if (!nrow(dt)) return(dt)

  skill_cols <- intersect(skill_cols, names(dt))
  if (!length(skill_cols)) {
    stop("No skill columns were available for best two-year target aggregation.")
  }

  aggregate_cols <- c(skill_cols, intersect("impact_total", names(dt)))
  aggregated <- dt[
    ,
    lapply(.SD, best_n_average, n = min_eligible_seasons),
    by = .(join_player, draft_year),
    .SDcols = aggregate_cols
  ]

  setorder(dt, join_player, draft_year, -outcome_year)
  meta <- dt[, .SD[1], by = .(join_player, draft_year)]
  drop_cols <- intersect(c(aggregate_cols, "outcome_year", "years_after_draft"), names(meta))
  if (length(drop_cols)) meta[, (drop_cols) := NULL]

  target_counts <- dt[
    ,
    .(eligible_target_seasons = uniqueN(outcome_year[is.finite(outcome_year)])),
    by = .(join_player, draft_year)
  ]

  out <- merge(meta, aggregated, by = c("join_player", "draft_year"), all.x = TRUE, sort = FALSE)
  out <- merge(out, target_counts, by = c("join_player", "draft_year"), all.x = TRUE, sort = FALSE)

  out[, outcome_year := draft_year + window_max]
  out[, years_after_draft := window_max]
  out[, target_aggregation := sprintf(
    "best_%dyr_skill_avg_y%d_y%d",
    as.integer(min_eligible_seasons),
    as.integer(window_min),
    as.integer(window_max)
  )]

  finite_skill_counts <- rowSums(as.data.frame(lapply(out[, ..skill_cols], function(x) is.finite(suppressWarnings(as.numeric(x))))))
  out[finite_skill_counts > 0]
}

select_best_impact_target_season <- function(training_dt, skill_cols, window_min, window_max, min_window_year) {
  if (!nrow(training_dt)) return(training_dt)
  if (!is.finite(window_max)) {
    stop("Best impact target season requires a finite target window max.")
  }

  dt <- copy(training_dt)
  dt[, years_after_draft := outcome_year - draft_year]
  dt[, max_years_after_draft := suppressWarnings(max(years_after_draft, na.rm = TRUE)), by = .(join_player, draft_year)]
  dt <- dt[
    is.finite(years_after_draft) &
      is.finite(max_years_after_draft) &
      max_years_after_draft >= min_window_year &
      years_after_draft >= window_min &
      years_after_draft <= window_max &
      is.finite(impact_total)
  ]

  if (!nrow(dt)) return(dt)

  target_counts <- dt[
    ,
    .(eligible_target_seasons = uniqueN(outcome_year[is.finite(outcome_year)])),
    by = .(join_player, draft_year)
  ]

  setorder(dt, join_player, draft_year, -impact_total, -outcome_year)
  out <- dt[, .SD[1], by = .(join_player, draft_year)]
  out <- merge(out, target_counts, by = c("join_player", "draft_year"), all.x = TRUE, sort = FALSE)
  out[, years_after_draft := outcome_year - draft_year]
  out[, target_aggregation := sprintf(
    "best_impact_total_season_y%d_y%d",
    as.integer(window_min),
    as.integer(window_max)
  )]

  available_skills <- intersect(skill_cols, names(out))
  finite_skill_counts <- rowSums(as.data.frame(lapply(out[, ..available_skills], function(x) is.finite(suppressWarnings(as.numeric(x))))))
  out[finite_skill_counts > 0]
}

read_college_manual_supplement <- function(path) {
  if (!file.exists(path)) {
    return(data.table())
  }

  supplement_dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(supplement_dt)) {
    return(data.table())
  }

  if (!"player" %in% names(supplement_dt)) {
    warning("Manual college supplement is missing player column: ", path)
    return(data.table())
  }

  if (!"year" %in% names(supplement_dt) && "draft_year" %in% names(supplement_dt)) {
    supplement_dt[, year := draft_year]
  }
  if (!"year" %in% names(supplement_dt)) {
    warning("Manual college supplement is missing year/draft_year column: ", path)
    return(data.table())
  }

  supplement_dt[, player := anglicize_text(player)]
  supplement_dt[, join_player := normalize_join_name(player)]
  supplement_dt[, draft_year := suppressWarnings(as.integer(year))]
  supplement_dt <- supplement_dt[nzchar(join_player) & is.finite(draft_year)]

  if (!"manual_replace_scope" %in% names(supplement_dt)) {
    supplement_dt[, manual_replace_scope := "player"]
  }
  supplement_dt[, manual_replace_scope := tolower(trimws(as.character(manual_replace_scope)))]
  supplement_dt[!manual_replace_scope %in% c("player", "player_year", "none"), manual_replace_scope := "player"]

  supplement_dt
}

apply_college_manual_supplement <- function(draft_dt, supplement_dt) {
  if (!nrow(supplement_dt)) {
    return(draft_dt)
  }

  player_replace_keys <- unique(supplement_dt[manual_replace_scope == "player", join_player])
  if (length(player_replace_keys)) {
    draft_dt <- draft_dt[!join_player %in% player_replace_keys]
  }

  player_year_replace_keys <- unique(
    supplement_dt[manual_replace_scope == "player_year", .(join_player, draft_year)]
  )
  if (nrow(player_year_replace_keys)) {
    draft_dt <- merge(
      draft_dt,
      player_year_replace_keys[, manual_drop_row := TRUE],
      by = c("join_player", "draft_year"),
      all.x = TRUE,
      sort = FALSE
    )
    draft_dt <- draft_dt[is.na(manual_drop_row)]
    draft_dt[, manual_drop_row := NULL]
  }

  supplement_dt[, manual_replace_scope := NULL]
  rbindlist(list(draft_dt, supplement_dt), use.names = TRUE, fill = TRUE, ignore.attr = TRUE)
}

apply_consensus_projection_ranks <- function(dt, draft_dir, target_year) {
  rank_fp <- file.path(draft_dir, sprintf("draft_consensus_projection_ranks_%s.csv", target_year))
  if (!file.exists(rank_fp) || !nrow(dt) || !"player" %in% names(dt) || !"draft_year" %in% names(dt)) {
    return(dt)
  }
  rank_dt <- fread(rank_fp, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(rank_dt) || !all(c("player", "draft_year", "consensus_rank") %in% names(rank_dt))) {
    return(dt)
  }
  if (!"rank_source" %in% names(rank_dt)) rank_dt[, rank_source := NA_character_]
  rank_dt[, join_player_consensus := normalize_join_name(player)]
  rank_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  rank_dt[, consensus_rank := suppressWarnings(as.numeric(consensus_rank))]
  rank_dt <- unique(
    rank_dt[is.finite(draft_year) & nzchar(join_player_consensus) & is.finite(consensus_rank),
      .(join_player_consensus, draft_year, consensus_rank, consensus_rank_source = rank_source)
    ],
    by = c("join_player_consensus", "draft_year")
  )
  dt[, join_player_consensus := normalize_join_name(player)]
  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt <- merge(dt, rank_dt, by = c("join_player_consensus", "draft_year"), all.x = TRUE, sort = FALSE)
  if (!"big_board_rank" %in% names(dt)) dt[, big_board_rank := NA_real_]
  dt[is.finite(consensus_rank), big_board_rank := consensus_rank]
  dt[, c("join_player_consensus", "consensus_rank", "consensus_rank_source") := NULL]
  dt
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
ref_dir <- file.path(base_dir, "ref")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
source(file.path(base_dir, "script", "draft", "prediction_name_filter.R"), local = TRUE)
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

draftballr_fp <- Sys.getenv("DRAFTBALLR_INPUT", file.path(draft_dir, "draftballr.csv"))
prediction_names_fp <- Sys.getenv("DRAFT_PREDICTION_NAMES_INPUT", file.path(ref_dir, "draftprednames.csv"))
college_manual_supplement_fp <- Sys.getenv(
  "DRAFT_COLLEGE_MANUAL_SUPPLEMENT_INPUT",
  file.path(draft_dir, "draft_college_manual_supplement.csv")
)
draftvar_fp <- Sys.getenv("DRAFTVAR_INPUT", file.path(ref_dir, "draftvar.xlsx"))
scv_fp <- Sys.getenv("SCV_INPUT", file.path(ref_dir, "scvardraft.csv"))
scv_override_fp <- Sys.getenv("SCV_OVERRIDE_INPUT", file.path(ref_dir, "scvardraft_overrides.csv"))
skill_fp <- Sys.getenv("SKILL_OUTPUT_INPUT", file.path(live_dir, "skilloutput.csv"))

training_fp <- Sys.getenv("DRAFT_TRAINING_OUTPUT", file.path(draft_dir, "draft_training_data.csv"))
domestic_fp <- Sys.getenv("DRAFT_DOMESTIC_OUTPUT", file.path(draft_dir, "draft_prediction_domestic.csv"))
international_fp <- Sys.getenv("DRAFT_INTERNATIONAL_OUTPUT", file.path(draft_dir, "draft_prediction_international.csv"))
review_fp <- Sys.getenv("DRAFT_TRAINING_MATCH_REVIEW_OUTPUT", file.path(draft_dir, "draft_training_match_review.csv"))
source_fp <- Sys.getenv("DRAFT_SOURCE_BASE_OUTPUT", file.path(draft_dir, "draft_prediction_source_base.csv"))
scv_review_fp <- Sys.getenv("SCV_REVIEW_OUTPUT", file.path(draft_dir, "scv_review_latest_class.csv"))

outcome_lag <- suppressWarnings(as.integer(Sys.getenv("DRAFT_OUTCOME_LAG", "4")))
if (!is.finite(outcome_lag) || outcome_lag < 1L) outcome_lag <- 4L
target_mode <- trimws(tolower(Sys.getenv("DRAFT_TARGET_MODE", "best_two_year_skill_avg")))
if (!target_mode %in% c("best_two_year_skill_avg", "best_impact_total_y3_y4", "best_impact_post_year_1", "best_impact_3_5", "latest_available", "fixed_lag")) {
  target_mode <- "best_two_year_skill_avg"
}
default_min_years_after_draft <- if (identical(target_mode, "best_two_year_skill_avg")) "5" else "4"
min_years_after_draft <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_YEARS_AFTER_DRAFT", default_min_years_after_draft)))
if (!is.finite(min_years_after_draft) || min_years_after_draft < 0L) min_years_after_draft <- 4L
if (identical(target_mode, "best_two_year_skill_avg") && min_years_after_draft < 5L) min_years_after_draft <- 5L
min_draft_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_DRAFT_YEAR", "2016")))
if (!is.finite(min_draft_year)) min_draft_year <- 0L
max_train_draft_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MAX_TRAIN_DRAFT_YEAR", "")))
if (!is.finite(max_train_draft_year)) max_train_draft_year <- NA_integer_
target_window_min <- suppressWarnings(as.integer(Sys.getenv("DRAFT_TARGET_WINDOW_MIN", "2")))
if (!is.finite(target_window_min)) target_window_min <- 2L
target_window_max_raw <- trimws(Sys.getenv("DRAFT_TARGET_WINDOW_MAX", ""))
target_window_max <- suppressWarnings(as.integer(target_window_max_raw))
if (!is.finite(target_window_max) && nzchar(target_window_max_raw)) target_window_max <- NA_integer_
if (identical(target_mode, "best_impact_total_y3_y4")) {
  target_window_min <- 3L
  target_window_max <- 4L
} else if (identical(target_mode, "best_two_year_skill_avg")) {
  if (!is.finite(target_window_max)) target_window_max <- 5L
  if (target_window_max < target_window_min) target_window_max <- target_window_min
} else if (identical(target_mode, "best_impact_3_5")) {
  if (!is.finite(target_window_max)) target_window_max <- 5L
  if (target_window_max < target_window_min) target_window_max <- target_window_min
} else if (is.finite(target_window_max) && target_window_max < target_window_min) {
  target_window_max <- target_window_min
}
min_eligible_target_seasons <- suppressWarnings(as.integer(Sys.getenv("DRAFT_MIN_ELIGIBLE_TARGET_SEASONS", "2")))
if (!is.finite(min_eligible_target_seasons) || min_eligible_target_seasons < 2L) min_eligible_target_seasons <- 2L
prediction_all_years <- identical(
  tolower(trimws(Sys.getenv("DRAFT_PREDICT_ALL_YEARS", "false"))),
  "true"
)

draft_dt <- fread(draftballr_fp, na.strings = c("", "NA", "N/A", "NaN"))
draft_dt[, player := anglicize_text(player)]
draft_dt[, join_player := normalize_join_name(player)]
draft_dt[, draft_year := suppressWarnings(as.integer(year))]

college_manual_supplement_dt <- read_college_manual_supplement(college_manual_supplement_fp)
manual_supplement_rows <- nrow(college_manual_supplement_dt)
draft_dt <- apply_college_manual_supplement(draft_dt, college_manual_supplement_dt)

draftvar_vars <- unique(c(read_draftvar_variables(draftvar_fp), "3pa_100"))
available_vars <- intersect(draftvar_vars, names(draft_dt))

id_cols <- c(
  "player", "join_player", "year", "draft_year", "id", "player_id", "espn_id",
  "cbbd_id", "big_board_rank", "birthdate", "draft_age", "height_wo_shoes_in",
  "wingspan_in", "weight_lbs", "pos_code", "hometown", "manual_source",
  "manual_source_url", "manual_source_note"
)
keep_cols <- unique(c(id_cols, available_vars))
keep_cols <- keep_cols[keep_cols %in% names(draft_dt)]
draft_dt <- draft_dt[, ..keep_cols]

scv_lookup <- read_scv_lookup(scv_fp, scv_override_fp)
draft_dt <- merge(draft_dt, scv_lookup, by = "join_player", all.x = TRUE, sort = FALSE)
prediction_name_filter_dt <- read_prediction_name_filter(prediction_names_fp)

prediction_year <- max(draft_dt$draft_year, na.rm = TRUE)
prediction_filter_years <- if (!is.null(prediction_name_filter_dt) && nrow(prediction_name_filter_dt)) {
  sort(unique(prediction_name_filter_dt[is.finite(prediction_filter_year), prediction_filter_year]))
} else {
  integer()
}
prediction_filter_all_years <- length(prediction_filter_years) > 0L && any(prediction_filter_years != prediction_year)

if (prediction_all_years || prediction_filter_all_years) {
  domestic_dt <- copy(draft_dt[!is.na(cbbd_id)])
  international_dt <- copy(draft_dt[is.na(cbbd_id)])
} else {
  domestic_dt <- copy(draft_dt[draft_year == prediction_year & !is.na(cbbd_id)])
  international_dt <- copy(draft_dt[draft_year == prediction_year & is.na(cbbd_id)])
}
domestic_dt <- apply_prediction_name_filter(domestic_dt, prediction_name_filter_dt)
international_dt <- apply_prediction_name_filter(international_dt, prediction_name_filter_dt)
domestic_dt <- apply_consensus_projection_ranks(domestic_dt, draft_dir, prediction_year)
international_dt <- apply_consensus_projection_ranks(international_dt, draft_dir, prediction_year)

scv_review_dt <- copy(draft_dt[draft_year == prediction_year])
scv_review_dt <- apply_prediction_name_filter(scv_review_dt, prediction_name_filter_dt)
if (nrow(scv_review_dt)) {
  scv_review_dt[, prediction_pool := fifelse(is.na(cbbd_id), "international", "domestic")]
  scv_review_dt[, has_scv := !is.na(scv_draft)]
  setorder(scv_review_dt, prediction_pool, player)
  fwrite(
    scv_review_dt[, .(player, draft_year, prediction_pool, scv_draft, has_scv)],
    scv_review_fp,
    na = ""
  )
}

skill_targets_dt <- prepare_skill_targets(skill_fp)

training_candidates <- copy(draft_dt[draft_year >= min_draft_year & draft_year < prediction_year])
if (is.finite(max_train_draft_year)) {
  training_candidates <- training_candidates[draft_year <= max_train_draft_year]
}
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
} else if (identical(target_mode, "best_two_year_skill_avg")) {
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
  training_dt <- aggregate_best_two_year_skill_targets(
    training_dt,
    skill_cols = c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"),
    window_min = target_window_min,
    window_max = target_window_max,
    min_window_year = min_years_after_draft,
    min_eligible_seasons = min_eligible_target_seasons
  )
} else if (identical(target_mode, "best_impact_total_y3_y4")) {
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
  training_dt <- select_best_impact_target_season(
    training_dt,
    skill_cols = c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"),
    window_min = target_window_min,
    window_max = target_window_max,
    min_window_year = min_years_after_draft
  )
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
  target_aggregation = if ("target_aggregation" %in% names(training_dt)) target_aggregation else NA_character_,
  eligible_target_seasons = if ("eligible_target_seasons" %in% names(training_dt)) eligible_target_seasons else NA_integer_,
  cbbd_id,
  scv_draft,
  matched_skill = !is.na(nba_id),
  nba_id,
  nba_player
)]

training_dt <- training_dt[!is.na(nba_id)]

if (identical(target_mode, "best_two_year_skill_avg")) {
  invalid_target_rows <- training_dt[
    !is.finite(years_after_draft) |
      years_after_draft != target_window_max |
      !is.finite(max_years_after_draft) |
      max_years_after_draft < min_years_after_draft |
      !is.finite(eligible_target_seasons) |
      eligible_target_seasons < min_eligible_target_seasons
  ]
  if (nrow(invalid_target_rows)) {
    stop("Target selection invariant failed: expected best two-year skill averages from a full target window.")
  }
} else if (identical(target_mode, "best_impact_total_y3_y4")) {
  invalid_target_rows <- training_dt[
    !is.finite(years_after_draft) |
      years_after_draft < target_window_min |
      years_after_draft > target_window_max |
      !is.finite(max_years_after_draft) |
      max_years_after_draft < min_years_after_draft |
      !is.finite(impact_total)
  ]
  if (nrow(invalid_target_rows)) {
    stop("Target selection invariant failed: expected best IMPACT_TOTAL season from years 3-4.")
  }
} else if (identical(target_mode, "best_impact_post_year_1")) {
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
cat("Manual college supplement rows:", manual_supplement_rows, "\n")
cat("Prediction name filter:", if (is.null(prediction_name_filter_dt)) "not applied" else paste0(nrow(prediction_name_filter_dt), " name-year row(s)"), "\n")
if (length(prediction_filter_years)) {
  cat("Prediction name filter years:", paste(prediction_filter_years, collapse = ", "), "\n")
}
cat("Prediction year:", prediction_year, "\n")
cat("Predict all years:", prediction_all_years, "\n")
cat("Predict all filter years:", prediction_filter_all_years, "\n")
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
