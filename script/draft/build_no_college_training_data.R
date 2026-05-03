if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}

library(data.table)

get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]

  if (length(script_arg) > 0) {
    script_path <- sub(file_arg, "", script_arg[[1]])
    return(dirname(normalizePath(script_path, winslash = "/", mustWork = FALSE)))
  }

  ofile <- NULL
  frame_list <- sys.frames()
  if (length(frame_list) > 0) {
    for (i in rev(seq_along(frame_list))) {
      if (!is.null(frame_list[[i]]$ofile)) {
        ofile <- frame_list[[i]]$ofile
        break
      }
    }
  }

  if (!is.null(ofile)) {
    return(dirname(normalizePath(ofile, winslash = "/", mustWork = FALSE)))
  }

  NULL
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- c(
    getwd(),
    if (!is.null(script_dir)) script_dir else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..") else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..", "..") else NULL,
    file.path(getwd(), ".."),
    file.path(getwd(), "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  )
  candidates <- unique(candidates[!is.na(candidates) & nzchar(candidates)])

  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

resolve_no_college_cohort_file <- function(draft_dir) {
  preferred <- file.path(draft_dir, "draft_no_college_all_classes.csv")
  legacy <- file.path(draft_dir, "draft_no_college_2014_2025.csv")

  if (file.exists(preferred)) return(preferred)
  if (file.exists(legacy)) return(legacy)
  preferred
}

parse_optional_int_env <- function(var_name) {
  raw_value <- trimws(Sys.getenv(var_name, ""))
  if (!nzchar(raw_value)) return(NA_integer_)
  parsed <- suppressWarnings(as.integer(raw_value))
  if (!is.finite(parsed)) {
    warning(sprintf("Environment variable %s is not a valid integer: %s", var_name, raw_value))
    return(NA_integer_)
  }
  parsed
}

merge_target_year_rows <- function(existing_path, update_dt, target_year, key_cols) {
  update_dt <- as.data.table(copy(update_dt))

  if (!is.finite(target_year) || !file.exists(existing_path)) {
    return(update_dt)
  }

  existing_dt <- fread(existing_path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(existing_dt)) return(update_dt)

  if ("draft_year" %in% names(existing_dt)) {
    existing_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
    existing_dt <- existing_dt[is.na(draft_year) | draft_year != target_year]
  }

  combined_dt <- rbindlist(list(existing_dt, update_dt), use.names = TRUE, fill = TRUE)
  key_cols <- intersect(key_cols, names(combined_dt))
  if (length(key_cols)) {
    combined_dt <- unique(combined_dt, by = key_cols)
  }

  combined_dt
}

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  x <- gsub("\\bronald holland\\b", "ron holland", x)
  trimws(x)
}

first_non_empty <- function(x) {
  x <- as.character(x)
  x <- x[!is.na(x) & nzchar(trimws(x))]
  if (!length(x)) return(NA_character_)
  x[[1]]
}

first_finite_numeric <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  x <- x[is.finite(x)]
  if (!length(x)) return(NA_real_)
  x[[1]]
}

coalesce_numeric <- function(primary, fallback) {
  primary <- suppressWarnings(as.numeric(primary))
  fallback <- suppressWarnings(as.numeric(fallback))
  fill_idx <- !is.finite(primary) & is.finite(fallback)
  primary[fill_idx] <- fallback[fill_idx]
  primary
}

coalesce_character <- function(primary, fallback) {
  primary <- as.character(primary)
  fallback <- as.character(fallback)
  fill_idx <- (is.na(primary) | !nzchar(trimws(primary))) & !is.na(fallback) & nzchar(trimws(fallback))
  primary[fill_idx] <- fallback[fill_idx]
  primary
}

derive_per36_from_pairs <- function(dt, target_name, source_minute_pairs) {
  target_vals <- if (target_name %in% names(dt)) {
    suppressWarnings(as.numeric(dt[[target_name]]))
  } else {
    rep(NA_real_, nrow(dt))
  }

  for (pair in source_minute_pairs) {
    source_name <- pair[[1]]
    minute_name <- pair[[2]]
    if (!(source_name %in% names(dt)) || !(minute_name %in% names(dt))) next

    source_vals <- suppressWarnings(as.numeric(dt[[source_name]]))
    minute_vals <- suppressWarnings(as.numeric(dt[[minute_name]]))
    derived_vals <- ifelse(
      is.finite(source_vals) & is.finite(minute_vals) & minute_vals > 0,
      36 * source_vals / minute_vals,
      NA_real_
    )

    fill_idx <- !is.finite(target_vals) & is.finite(derived_vals)
    target_vals[fill_idx] <- derived_vals[fill_idx]
  }

  dt[, (target_name) := target_vals]
}

best_n_average <- function(x, n = 2L) {
  x <- suppressWarnings(as.numeric(x))
  x <- x[is.finite(x)]
  if (length(x) < n) return(NA_real_)
  mean(sort(x, decreasing = TRUE)[seq_len(n)])
}

aggregate_best_two_year_skill_targets <- function(train_candidates, skill_cols, window_min = 2L, window_max = 5L, min_window_year = 5L, min_eligible_seasons = 2L) {
  if (!nrow(train_candidates)) return(train_candidates)

  dt <- copy(train_candidates)
  dt[, years_after_draft := year - draft_year]
  dt[, max_years_after_draft := suppressWarnings(max(years_after_draft, na.rm = TRUE)), by = .(nba_id, player, draft_year)]
  dt <- dt[
    is.finite(years_after_draft) &
      is.finite(max_years_after_draft) &
      max_years_after_draft >= min_window_year &
      years_after_draft >= window_min &
      years_after_draft <= window_max
  ]

  if (!nrow(dt)) return(dt)

  aggregate_cols <- intersect(
    c("IMPACT_OFF", "IMPACT_DEF", "IMPACT_TOTAL", skill_cols),
    names(dt)
  )
  if (!length(intersect(skill_cols, aggregate_cols))) {
    stop("No skill target columns were available for best two-year no-college aggregation.")
  }

  aggregated <- dt[
    ,
    lapply(.SD, best_n_average, n = min_eligible_seasons),
    by = .(nba_id, player, draft_year),
    .SDcols = aggregate_cols
  ]

  setorder(dt, nba_id, player, draft_year, -year)
  meta <- dt[, .SD[1], by = .(nba_id, player, draft_year)]
  drop_cols <- intersect(c(aggregate_cols, "year", "years_after_draft"), names(meta))
  if (length(drop_cols)) meta[, (drop_cols) := NULL]

  target_counts <- dt[
    ,
    .(eligible_target_seasons = uniqueN(year[is.finite(year)])),
    by = .(nba_id, player, draft_year)
  ]

  out <- merge(meta, aggregated, by = c("nba_id", "player", "draft_year"), all.x = TRUE, sort = FALSE)
  out <- merge(out, target_counts, by = c("nba_id", "player", "draft_year"), all.x = TRUE, sort = FALSE)
  out[, year := draft_year + window_max]
  out[, years_after_draft := window_max]
  out[, target_aggregation := sprintf(
    "best_%dyr_skill_avg_y%d_y%d",
    as.integer(min_eligible_seasons),
    as.integer(window_min),
    as.integer(window_max)
  )]

  available_skills <- intersect(skill_cols, names(out))
  finite_skill_counts <- rowSums(as.data.frame(lapply(out[, ..available_skills], function(x) is.finite(suppressWarnings(as.numeric(x))))))
  out[finite_skill_counts > 0]
}

select_best_impact_target_season <- function(train_candidates, skill_cols, window_min = 3L, window_max = 4L, min_window_year = 4L) {
  if (!nrow(train_candidates)) return(train_candidates)

  dt <- copy(train_candidates)
  dt[, years_after_draft := year - draft_year]
  dt[, max_years_after_draft := suppressWarnings(max(years_after_draft, na.rm = TRUE)), by = .(nba_id, player, draft_year)]
  dt <- dt[
    is.finite(years_after_draft) &
      is.finite(max_years_after_draft) &
      max_years_after_draft >= min_window_year &
      years_after_draft >= window_min &
      years_after_draft <= window_max &
      is.finite(IMPACT_TOTAL)
  ]

  if (!nrow(dt)) return(dt)

  target_counts <- dt[
    ,
    .(eligible_target_seasons = uniqueN(year[is.finite(year)])),
    by = .(nba_id, player, draft_year)
  ]

  setorder(dt, nba_id, player, draft_year, -IMPACT_TOTAL, -year)
  out <- dt[, .SD[1], by = .(nba_id, player, draft_year)]
  out <- merge(out, target_counts, by = c("nba_id", "player", "draft_year"), all.x = TRUE, sort = FALSE)
  out[, years_after_draft := year - draft_year]
  out[, target_aggregation := sprintf(
    "best_impact_total_season_y%d_y%d",
    as.integer(window_min),
    as.integer(window_max)
  )]

  available_skills <- intersect(skill_cols, names(out))
  finite_skill_counts <- rowSums(as.data.frame(lapply(out[, ..available_skills], function(x) is.finite(suppressWarnings(as.numeric(x))))))
  out[finite_skill_counts > 0]
}

build_databallr_measurements <- function(base_dir) {
  databallr_file <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (!file.exists(databallr_file)) return(NULL)

  databallr_dt <- fread(databallr_file, na.strings = c("", "NA", "N/A", "NaN"))
  name_col <- intersect(c("player_name", "Name", "player"), names(databallr_dt))[1]
  measure_cols <- intersect(c("height_wo_shoes_in", "wingspan_in"), names(databallr_dt))

  if (is.na(name_col) || !nzchar(name_col) || !length(measure_cols)) {
    warning("Databallr measurements file is missing player name or measurement columns.")
    return(NULL)
  }

  databallr_dt[, player_key := normalize_name(get(name_col))]
  databallr_dt <- databallr_dt[player_key != ""]
  if (!nrow(databallr_dt)) return(NULL)

  databallr_dt[, source_year := if ("year" %in% names(databallr_dt)) suppressWarnings(as.integer(year)) else NA_integer_]
  databallr_dt[, (measure_cols) := lapply(.SD, function(col) suppressWarnings(as.numeric(col))), .SDcols = measure_cols]
  setorder(databallr_dt, player_key, -source_year)

  databallr_dt[, .(
    databallr_player_name = first_non_empty(get(name_col)),
    databallr_year = first_finite_numeric(source_year),
    height_wo_shoes_in = if ("height_wo_shoes_in" %in% measure_cols) first_finite_numeric(height_wo_shoes_in) else NA_real_,
    wingspan_in = if ("wingspan_in" %in% measure_cols) first_finite_numeric(wingspan_in) else NA_real_
  ), by = player_key]
}

build_measurement_supplement <- function(base_dir) {
  supplement_file <- file.path(base_dir, "processed", "draft", "no_college_measurement_supplement.csv")
  if (!file.exists(supplement_file)) return(NULL)

  supplement_dt <- fread(supplement_file, na.strings = c("", "NA", "N/A", "NaN"))
  required_cols <- c("player", "draft_year", "height_wo_shoes_in", "wingspan_in")
  if (!all(required_cols %in% names(supplement_dt))) {
    warning("Measurement supplement is missing required columns: ", supplement_file)
    return(NULL)
  }

  supplement_dt[, player := as.character(player)]
  supplement_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  supplement_dt[, player_key := normalize_name(player)]
  supplement_dt[, height_wo_shoes_in := suppressWarnings(as.numeric(height_wo_shoes_in))]
  supplement_dt[, wingspan_in := suppressWarnings(as.numeric(wingspan_in))]

  rename_map <- c(
    height_wo_shoes_in = "supp_height_wo_shoes_in",
    wingspan_in = "supp_wingspan_in",
    measurement_source = "supp_measurement_source",
    source_url = "supp_source_url",
    source_note = "supp_source_note",
    height_source_type = "supp_height_source_type",
    wingspan_source_type = "supp_wingspan_source_type"
  )

  for (source_name in names(rename_map)) {
    target_name <- rename_map[[source_name]]
    if (source_name %in% names(supplement_dt)) {
      setnames(supplement_dt, source_name, target_name)
    } else {
      supplement_dt[, (target_name) := NA]
    }
  }

  keep_cols <- c("player_key", "draft_year", unname(rename_map))
  supplement_dt <- supplement_dt[, ..keep_cols]
  unique(supplement_dt, by = c("player_key", "draft_year"))
}

append_manual_no_college_stats <- function(stats_dt, manual_stats_file) {
  if (!file.exists(manual_stats_file)) {
    return(stats_dt)
  }

  manual_dt <- fread(manual_stats_file, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(manual_dt)) {
    return(stats_dt)
  }

  if (!all(c("player", "draft_year") %in% names(manual_dt))) {
    warning("Manual no-college stats file is missing player/draft_year columns: ", manual_stats_file)
    return(stats_dt)
  }

  manual_dt[, player := as.character(player)]
  manual_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  manual_dt[, player_key___ := normalize_name(player)]
  manual_dt <- manual_dt[nzchar(player_key___) & is.finite(draft_year)]

  if (!nrow(manual_dt)) {
    return(stats_dt)
  }

  if (!"manual_replace_scope" %in% names(manual_dt)) {
    manual_dt[, manual_replace_scope := "player_year"]
  }
  manual_dt[, manual_replace_scope := tolower(trimws(as.character(manual_replace_scope)))]
  manual_dt[!manual_replace_scope %in% c("player", "player_year", "none"), manual_replace_scope := "player_year"]

  stats_dt[, player_key___ := normalize_name(player)]
  stats_dt[, draft_year := suppressWarnings(as.integer(draft_year))]

  player_replace_keys <- unique(manual_dt[manual_replace_scope == "player", player_key___])
  if (length(player_replace_keys)) {
    stats_dt <- stats_dt[!player_key___ %in% player_replace_keys]
  }

  player_year_replace_keys <- unique(
    manual_dt[manual_replace_scope == "player_year", .(player_key___, draft_year)]
  )
  if (nrow(player_year_replace_keys)) {
    stats_dt <- merge(
      stats_dt,
      player_year_replace_keys[, manual_drop_row := TRUE],
      by = c("player_key___", "draft_year"),
      all.x = TRUE,
      sort = FALSE
    )
    stats_dt <- stats_dt[is.na(manual_drop_row)]
    stats_dt[, manual_drop_row := NULL]
  }

  manual_dt[, manual_replace_scope := NULL]
  combined_dt <- rbindlist(list(stats_dt, manual_dt), use.names = TRUE, fill = TRUE)
  combined_dt[, player_key___ := NULL]
  combined_dt
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
  rank_dt[, join_player_consensus := normalize_name(player)]
  rank_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  rank_dt[, consensus_rank := suppressWarnings(as.numeric(consensus_rank))]
  rank_dt <- unique(
    rank_dt[is.finite(draft_year) & nzchar(join_player_consensus) & is.finite(consensus_rank),
      .(join_player_consensus, draft_year, consensus_rank)
    ],
    by = c("join_player_consensus", "draft_year")
  )
  dt[, join_player_consensus := normalize_name(player)]
  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt <- merge(dt, rank_dt, by = c("join_player_consensus", "draft_year"), all.x = TRUE, sort = FALSE)
  if (!"big_board_rank" %in% names(dt)) dt[, big_board_rank := NA_real_]
  dt[is.finite(consensus_rank), big_board_rank := consensus_rank]
  dt[, c("join_player_consensus", "consensus_rank") := NULL]
  dt
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
source(file.path(base_dir, "script", "draft", "prediction_name_filter.R"), local = TRUE)
target_draft_year <- parse_optional_int_env("NO_COLLEGE_TARGET_DRAFT_YEAR")
target_mode <- trimws(tolower(Sys.getenv("NO_COLLEGE_TARGET_MODE", "best_two_year_skill_avg")))
if (!target_mode %in% c("best_two_year_skill_avg", "best_impact_total_y3_y4")) {
  target_mode <- "best_two_year_skill_avg"
}
target_window_min <- parse_optional_int_env("NO_COLLEGE_TARGET_WINDOW_MIN")
if (!is.finite(target_window_min) || target_window_min < 1L) target_window_min <- 2L
target_window_max <- parse_optional_int_env("NO_COLLEGE_TARGET_WINDOW_MAX")
if (!is.finite(target_window_max) || target_window_max < target_window_min) target_window_max <- 4L
if (identical(target_mode, "best_impact_total_y3_y4")) {
  target_window_min <- 3L
  target_window_max <- 4L
}
min_window_year <- parse_optional_int_env("NO_COLLEGE_MIN_TARGET_WINDOW_YEAR")
if (!is.finite(min_window_year) || min_window_year < target_window_max) min_window_year <- target_window_max
min_eligible_target_seasons <- parse_optional_int_env("NO_COLLEGE_MIN_ELIGIBLE_TARGET_SEASONS")
if (!is.finite(min_eligible_target_seasons) || min_eligible_target_seasons < 2L) min_eligible_target_seasons <- 2L

stats_file <- file.path(draft_dir, "no_college_realgm_stats.csv")
manual_stats_file <- file.path(draft_dir, "no_college_manual_stats.csv")
prediction_names_file <- Sys.getenv("DRAFT_PREDICTION_NAMES_INPUT", file.path(base_dir, "ref", "draftprednames.csv"))
cohort_file <- resolve_no_college_cohort_file(draft_dir)
skill_file <- file.path(live_dir, "skilloutput.csv")

prediction_out <- file.path(draft_dir, "no_college_prediction.csv")
training_out <- file.path(draft_dir, "no_college_training_data.csv")
match_review_out <- file.path(draft_dir, "no_college_match_review.csv")

if (!file.exists(stats_file)) stop("Stats file not found: ", stats_file)
if (!file.exists(cohort_file)) stop("Cohort file not found: ", cohort_file)
if (!file.exists(skill_file)) stop("Skill file not found: ", skill_file)

stats_dt <- fread(stats_file, na.strings = c("", "NA", "N/A", "NaN"))
stats_dt <- append_manual_no_college_stats(stats_dt, manual_stats_file)
cohort_dt <- fread(cohort_file, na.strings = c("", "NA", "N/A", "NaN"))
skill_dt <- fread(skill_file, na.strings = c("", "NA", "N/A", "NaN"))
databallr_measure_dt <- build_databallr_measurements(base_dir)
measurement_supplement_dt <- build_measurement_supplement(base_dir)
prediction_name_filter_dt <- read_prediction_name_filter(prediction_names_file, key_col = "player_key")

if (!all(c("player", "draft_year") %in% names(stats_dt))) {
  stop("Stats file must include player and draft_year columns.")
}

stats_dt[, player := as.character(player)]
stats_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
stats_dt[, player_key := normalize_name(player)]

cohort_dt[, player := as.character(player)]
cohort_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
cohort_dt[, player_key := normalize_name(player)]

if (is.finite(target_draft_year)) {
  stats_dt <- stats_dt[draft_year == target_draft_year]
  cohort_dt <- cohort_dt[draft_year == target_draft_year]
}

stats_dt <- merge(
  stats_dt,
  cohort_dt[, .(
    player_key,
    draft_year,
    br_player_url,
    source_url,
    cohort_pos = if ("pos" %in% names(cohort_dt)) as.character(pos) else NA_character_,
    cohort_age = if ("age" %in% names(cohort_dt)) suppressWarnings(as.numeric(age)) else NA_real_,
    cohort_big_board_rank = if ("big_board_rank" %in% names(cohort_dt)) suppressWarnings(as.numeric(big_board_rank)) else NA_real_
  )],
  by = c("player_key", "draft_year"),
  all.x = TRUE
)
if (all(c("source_url.x", "source_url.y") %in% names(stats_dt))) {
  stats_dt[, source_url := coalesce_character(source_url.x, source_url.y)]
  stats_dt[, c("source_url.x", "source_url.y") := NULL]
}
if (all(c("br_player_url.x", "br_player_url.y") %in% names(stats_dt))) {
  stats_dt[, br_player_url := coalesce_character(br_player_url.x, br_player_url.y)]
  stats_dt[, c("br_player_url.x", "br_player_url.y") := NULL]
}
stats_dt[, pos := coalesce_character(if ("pos" %in% names(stats_dt)) pos else NA_character_, cohort_pos)]
stats_dt[, draft_age := coalesce_numeric(if ("draft_age" %in% names(stats_dt)) draft_age else NA_real_, cohort_age)]
stats_dt[, big_board_rank := coalesce_numeric(if ("big_board_rank" %in% names(stats_dt)) big_board_rank else NA_real_, cohort_big_board_rank)]
stats_dt[, c("cohort_pos", "cohort_age", "cohort_big_board_rank") := NULL]

derive_per36_from_pairs(stats_dt, "per36_x3pm", list(
  c("adv_xx3pm", "adv_min"),
  c("tot_xx3pm", "tot_min"),
  c("sum_xx3pm", "sum_min")
))
derive_per36_from_pairs(stats_dt, "per36_x3pa", list(
  c("adv_xx3pa", "adv_min"),
  c("tot_xx3pa", "tot_min"),
  c("sum_xx3pa", "sum_min")
))

if (!is.null(databallr_measure_dt)) {
  stats_dt <- merge(stats_dt, databallr_measure_dt, by = "player_key", all.x = TRUE)
}

if (!is.null(measurement_supplement_dt)) {
  stats_dt <- merge(stats_dt, measurement_supplement_dt, by = c("player_key", "draft_year"), all.x = TRUE)

  stats_dt[, measurement_source := fifelse(
    is.finite(height_wo_shoes_in) | is.finite(wingspan_in),
    "databallr",
    NA_character_
  )]
  stats_dt[, measurement_source_url := NA_character_]
  stats_dt[, measurement_source_note := NA_character_]
  stats_dt[, height_source_type := NA_character_]
  stats_dt[, wingspan_source_type := NA_character_]

  supplement_fill_idx <- with(
    stats_dt,
    (!is.finite(height_wo_shoes_in) & is.finite(supp_height_wo_shoes_in)) |
      (!is.finite(wingspan_in) & is.finite(supp_wingspan_in))
  )

  stats_dt[, height_wo_shoes_in := coalesce_numeric(height_wo_shoes_in, supp_height_wo_shoes_in)]
  stats_dt[, wingspan_in := coalesce_numeric(wingspan_in, supp_wingspan_in)]
  stats_dt[supplement_fill_idx, measurement_source := coalesce_character(measurement_source, supp_measurement_source)]
  stats_dt[supplement_fill_idx, measurement_source_url := coalesce_character(measurement_source_url, supp_source_url)]
  stats_dt[supplement_fill_idx, measurement_source_note := coalesce_character(measurement_source_note, supp_source_note)]
  stats_dt[supplement_fill_idx, height_source_type := coalesce_character(height_source_type, supp_height_source_type)]
  stats_dt[supplement_fill_idx, wingspan_source_type := coalesce_character(wingspan_source_type, supp_wingspan_source_type)]

  drop_supp_cols <- grep("^supp_", names(stats_dt), value = TRUE)
  if (length(drop_supp_cols)) stats_dt[, (drop_supp_cols) := NULL]
} else {
  stats_dt[, `:=`(
    measurement_source = fifelse(is.finite(height_wo_shoes_in) | is.finite(wingspan_in), "databallr", NA_character_),
    measurement_source_url = NA_character_,
    measurement_source_note = NA_character_,
    height_source_type = NA_character_,
    wingspan_source_type = NA_character_
  )]
}

skill_dt[, player_name := as.character(player_name)]
skill_dt[, year := suppressWarnings(as.integer(year))]
skill_dt[, player_key := normalize_name(player_name)]
skill_dt[, nba_id := as.character(nba_id)]

skill_players <- unique(skill_dt[, .(player_key, nba_id, nba_player = player_name)])
skill_players[, match_count := .N, by = player_key]

matched_dt <- merge(
  stats_dt,
  skill_players,
  by = "player_key",
  all.x = TRUE,
  allow.cartesian = TRUE
)

matched_dt[, match_method := fifelse(
  is.na(nba_id),
  "unmatched",
  fifelse(match_count == 1, "normalized_exact", "ambiguous_name")
)]
matched_dt[, selection_score := fifelse(
  match_method == "normalized_exact", 1,
  fifelse(match_method == "ambiguous_name", 0.5, NA_real_)
)]

review_dt <- unique(
  matched_dt[, .(
    player,
    draft_year,
    player_key,
    nba_id,
    nba_player,
    match_method,
    selection_score,
    br_player_url,
    source_url
  )]
)

skill_targets <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
available_targets <- skill_targets[paste0(skill_targets, "_raw") %in% names(skill_dt)]
for (skill_name in available_targets) {
  raw_col <- paste0(skill_name, "_raw")
  skill_dt[[skill_name]] <- suppressWarnings(as.numeric(skill_dt[[raw_col]]))
}

train_candidates <- merge(
  matched_dt[match_method == "normalized_exact" & !is.na(nba_id)],
  skill_dt[, c("nba_id", "year", "IMPACT_OFF", "IMPACT_DEF", "IMPACT_TOTAL", available_targets), with = FALSE],
  by = "nba_id",
  all.x = FALSE,
  allow.cartesian = TRUE
)

train_candidates[, years_after_draft := year - draft_year]
if (identical(target_mode, "best_impact_total_y3_y4")) {
  train_dt <- select_best_impact_target_season(
    train_candidates,
    skill_cols = skill_targets,
    window_min = target_window_min,
    window_max = target_window_max,
    min_window_year = min_window_year
  )
} else {
  train_dt <- aggregate_best_two_year_skill_targets(
    train_candidates,
    skill_cols = skill_targets,
    window_min = target_window_min,
    window_max = target_window_max,
    min_window_year = min_window_year,
    min_eligible_seasons = min_eligible_target_seasons
  )
}

setnames(train_dt, "year", "outcome_year")
train_dt[, combined_impact := IMPACT_TOTAL]
train_dt[, off_dep := IMPACT_OFF]
train_dt[, def_dep := IMPACT_DEF]

drop_cols <- intersect(c("IMPACT_OFF", "IMPACT_DEF", "IMPACT_TOTAL", "match_count", "player_key"), names(train_dt))
if (length(drop_cols)) train_dt[, (drop_cols) := NULL]

if (identical(target_mode, "best_impact_total_y3_y4")) {
  invalid_target_rows <- train_dt[
    !is.finite(years_after_draft) |
      years_after_draft < target_window_min |
      years_after_draft > target_window_max |
      !is.finite(max_years_after_draft) |
      max_years_after_draft < min_window_year |
      !is.finite(combined_impact)
  ]
  if (nrow(invalid_target_rows)) {
    stop("No-college target selection invariant failed: expected best IMPACT_TOTAL season from years 3-4.")
  }
} else {
  invalid_target_rows <- train_dt[
    !is.finite(years_after_draft) |
      years_after_draft != target_window_max |
      !is.finite(max_years_after_draft) |
      max_years_after_draft < min_window_year |
      !is.finite(eligible_target_seasons) |
      eligible_target_seasons < min_eligible_target_seasons
  ]
  if (nrow(invalid_target_rows)) {
    stop("No-college target selection invariant failed: expected best two-year skill averages from the configured full target window.")
  }
}

prediction_dt <- copy(stats_dt)
prediction_dt <- apply_prediction_name_filter(prediction_dt, prediction_name_filter_dt, player_key_col = "player_key")
prediction_year_for_rank <- if (is.finite(target_draft_year)) target_draft_year else max(prediction_dt$draft_year, na.rm = TRUE)
prediction_dt <- apply_consensus_projection_ranks(prediction_dt, draft_dir, prediction_year_for_rank)
prediction_dt[, prediction_pool := "no_college"]
prediction_dt[, player_key := NULL]

preferred_front <- c(
  "player", "draft_year", "prediction_pool", "big_board_rank", "realgm_profile_url", "pre_draft_team",
  "source_section", "source_season", "source_team", "source_league", "br_player_url", "source_url"
)
preferred_front <- preferred_front[preferred_front %in% names(prediction_dt)]
setcolorder(prediction_dt, c(preferred_front, setdiff(names(prediction_dt), preferred_front)))

train_front <- c(
  "nba_id", "outcome_year", "player", "draft_year", "nba_player", "years_after_draft",
  "max_years_after_draft", "eligible_target_seasons", "target_aggregation",
  "match_method", "selection_score", "combined_impact", "off_dep", "def_dep"
)
train_front <- train_front[train_front %in% names(train_dt)]
setcolorder(train_dt, c(train_front, setdiff(names(train_dt), train_front)))

if (is.finite(target_draft_year)) {
  prediction_dt <- merge_target_year_rows(
    prediction_out,
    prediction_dt[draft_year == target_draft_year],
    target_draft_year,
    c("player", "draft_year", "prediction_pool")
  )
  review_dt <- merge_target_year_rows(
    match_review_out,
    review_dt[draft_year == target_draft_year],
    target_draft_year,
    c("player", "draft_year")
  )
}

fwrite(prediction_dt, prediction_out, na = "")
fwrite(train_dt, training_out, na = "")
fwrite(review_dt, match_review_out, na = "")

if (!is.null(databallr_measure_dt)) {
  cat("Merged Databallr measurements from ->", file.path(base_dir, "raw", "databallr_stats.csv"), "\n")
  cat("Prediction rows with Databallr height ->", prediction_dt[is.finite(height_wo_shoes_in), .N], "\n")
  cat("Prediction rows with Databallr wingspan ->", prediction_dt[is.finite(wingspan_in), .N], "\n")
  cat("Training rows with Databallr height ->", train_dt[is.finite(height_wo_shoes_in), .N], "\n")
  cat("Training rows with Databallr wingspan ->", train_dt[is.finite(wingspan_in), .N], "\n")
}

if (!is.null(measurement_supplement_dt)) {
  cat("Merged measurement supplement from ->", file.path(base_dir, "processed", "draft", "no_college_measurement_supplement.csv"), "\n")
  cat("Prediction rows using supplement ->", prediction_dt[measurement_source != "databallr" & !is.na(measurement_source), .N], "\n")
  cat("Training rows using supplement ->", train_dt[measurement_source != "databallr" & !is.na(measurement_source), .N], "\n")
}

cat("Prediction data written ->", prediction_out, "\n")
cat("Training data written ->", training_out, "\n")
cat("Match review written ->", match_review_out, "\n")
cat("Prediction name filter:", if (is.null(prediction_name_filter_dt)) "not applied" else paste0(nrow(prediction_name_filter_dt), " name-year row(s)"), "\n")
if (is.finite(target_draft_year)) {
  cat("Target draft-year refresh applied ->", target_draft_year, "\n")
}
