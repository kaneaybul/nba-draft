if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")

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

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
target_draft_year <- parse_optional_int_env("NO_COLLEGE_TARGET_DRAFT_YEAR")

stats_file <- file.path(draft_dir, "no_college_realgm_stats.csv")
cohort_file <- resolve_no_college_cohort_file(draft_dir)
skill_file <- file.path(live_dir, "skilloutput.csv")

prediction_out <- file.path(draft_dir, "no_college_prediction.csv")
training_out <- file.path(draft_dir, "no_college_training_data.csv")
match_review_out <- file.path(draft_dir, "no_college_match_review.csv")

if (!file.exists(stats_file)) stop("Stats file not found: ", stats_file)
if (!file.exists(cohort_file)) stop("Cohort file not found: ", cohort_file)
if (!file.exists(skill_file)) stop("Skill file not found: ", skill_file)

stats_dt <- fread(stats_file, na.strings = c("", "NA", "N/A", "NaN"))
cohort_dt <- fread(cohort_file, na.strings = c("", "NA", "N/A", "NaN"))
skill_dt <- fread(skill_file, na.strings = c("", "NA", "N/A", "NaN"))
databallr_measure_dt <- build_databallr_measurements(base_dir)
measurement_supplement_dt <- build_measurement_supplement(base_dir)

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
  cohort_dt[, .(player_key, draft_year, br_player_url, source_url)],
  by = c("player_key", "draft_year"),
  all.x = TRUE
)

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
available_targets <- intersect(skill_targets, names(skill_dt))

train_candidates <- merge(
  matched_dt[match_method == "normalized_exact" & !is.na(nba_id)],
  skill_dt[, c("nba_id", "year", "IMPACT_OFF", "IMPACT_DEF", "IMPACT_TOTAL", available_targets), with = FALSE],
  by = "nba_id",
  all.x = FALSE,
  allow.cartesian = TRUE
)

train_candidates[, years_after_draft := year - draft_year]
train_candidates <- train_candidates[years_after_draft %in% 3:5]

setorder(train_candidates, player, -years_after_draft, -year)
train_dt <- train_candidates[!duplicated(paste(player, draft_year))]

setnames(train_dt, "year", "outcome_year")
train_dt[, combined_impact := IMPACT_TOTAL]
train_dt[, off_dep := IMPACT_OFF]
train_dt[, def_dep := IMPACT_DEF]

drop_cols <- intersect(c("IMPACT_OFF", "IMPACT_DEF", "IMPACT_TOTAL", "match_count", "player_key"), names(train_dt))
if (length(drop_cols)) train_dt[, (drop_cols) := NULL]

prediction_dt <- copy(stats_dt)
prediction_dt[, prediction_pool := "no_college"]
prediction_dt[, player_key := NULL]

preferred_front <- c(
  "player", "draft_year", "prediction_pool", "realgm_profile_url", "pre_draft_team",
  "source_section", "source_season", "source_team", "source_league", "br_player_url", "source_url"
)
preferred_front <- preferred_front[preferred_front %in% names(prediction_dt)]
setcolorder(prediction_dt, c(preferred_front, setdiff(names(prediction_dt), preferred_front)))

train_front <- c(
  "nba_id", "outcome_year", "player", "draft_year", "nba_player", "years_after_draft",
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
if (is.finite(target_draft_year)) {
  cat("Target draft-year refresh applied ->", target_draft_year, "\n")
}
