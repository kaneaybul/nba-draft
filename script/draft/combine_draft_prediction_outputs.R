resolve_base_dir <- function() {
  candidates <- c(getwd(), file.path(getwd(), ".."))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")
library(data.table)

read_if_exists <- function(path) {
  if (!file.exists(path)) return(NULL)
  fread(path, na.strings = c("", "NA", "N/A", "NaN"))
}

normalize_join_name <- function(x) {
  raw_x <- as.character(x)
  safe_x <- suppressWarnings(iconv(raw_x, from = "UTF-8", to = "UTF-8", sub = ""))
  fill_idx <- is.na(safe_x) & !is.na(raw_x)
  safe_x[fill_idx] <- raw_x[fill_idx]
  converted <- suppressWarnings(iconv(safe_x, from = "", to = "ASCII//TRANSLIT", sub = ""))
  fill_idx <- is.na(converted) & !is.na(safe_x)
  converted[fill_idx] <- safe_x[fill_idx]
  x <- tolower(trimws(converted))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

parse_optional_year_env <- function(var_name, default = NA_integer_) {
  value <- suppressWarnings(as.integer(Sys.getenv(var_name, "")))
  if (!is.finite(value)) return(default)
  value
}

publish_year_min <- parse_optional_year_env("DRAFT_PUBLISH_YEAR_MIN", 2016L)
publish_year_max <- parse_optional_year_env("DRAFT_PUBLISH_YEAR_MAX", 2026L)

filter_publish_year_range <- function(dt, min_year, max_year) {
  if (is.null(dt) || !nrow(dt) || !"draft_year" %in% names(dt)) return(dt)
  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  keep <- !is.na(dt$draft_year)
  if (is.finite(min_year)) keep <- keep & dt$draft_year >= min_year
  if (is.finite(max_year)) keep <- keep & dt$draft_year <= max_year
  dt[keep]
}

keep_latest_player_rows <- function(dt) {
  if (is.null(dt) || !nrow(dt)) return(dt)
  if ("player" %in% names(dt)) dt[, player := as.character(player)]
  if ("draft_year" %in% names(dt)) dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt[, join_player := if ("player" %in% names(dt)) normalize_join_name(player) else "unknown"]
  dt[, sort_created_key := if ("created_at" %in% names(dt)) as.character(created_at) else ""]
  dt[, sort_draft_year := ifelse(is.na(draft_year), -99999L, draft_year)]
  setorder(dt, join_player, -sort_draft_year, sort_created_key, na.last = TRUE)
  dt <- unique(dt, by = "join_player")
  dt[, c("join_player", "sort_draft_year", "sort_created_key") := NULL]
  dt
}

college_pred_fp <- file.path(draft_dir, "draft_skill_predictions_output.csv")
college_pred_backup_fp <- file.path(draft_dir, "draft_skill_predictions_college_only.csv")
no_college_pred_fp <- file.path(draft_dir, "no_college_skill_predictions_output.csv")
final_pred_fp <- file.path(draft_dir, "draft_skill_predictions_output.csv")

domestic_source_fp <- file.path(draft_dir, "draft_prediction_domestic.csv")
intl_source_fp <- file.path(draft_dir, "draft_prediction_international.csv")
no_college_source_fp <- file.path(draft_dir, "no_college_prediction.csv")
unified_source_fp <- file.path(draft_dir, "draft_prediction_unified.csv")

college_pred <- read_if_exists(college_pred_fp)
if (!is.null(college_pred) && nrow(college_pred)) {
  if ("prediction_pool" %in% names(college_pred)) {
    college_pred <- college_pred[is.na(prediction_pool) | prediction_pool != "no_college"]
  }
  fwrite(college_pred, college_pred_backup_fp, na = "")
  message("College-only draft predictions backup -> ", college_pred_backup_fp)
}

pred_parts <- Filter(Negate(is.null), list(college_pred, read_if_exists(no_college_pred_fp)))
if (length(pred_parts)) {
  combined_preds <- rbindlist(pred_parts, use.names = TRUE, fill = TRUE)
  combined_preds <- filter_publish_year_range(combined_preds, publish_year_min, publish_year_max)
  combined_preds <- keep_latest_player_rows(combined_preds)
  fwrite(combined_preds, final_pred_fp, na = "")
  message("Unified draft predictions written -> ", final_pred_fp)
}

source_parts <- Filter(Negate(is.null), list(read_if_exists(domestic_source_fp), read_if_exists(intl_source_fp), read_if_exists(no_college_source_fp)))
if (length(source_parts)) {
  combined_sources <- rbindlist(source_parts, use.names = TRUE, fill = TRUE)
  combined_sources <- filter_publish_year_range(combined_sources, publish_year_min, publish_year_max)
  combined_sources <- keep_latest_player_rows(combined_sources)
  fwrite(combined_sources, unified_source_fp, na = "")
  message("Unified prediction pool written -> ", unified_source_fp)
}
