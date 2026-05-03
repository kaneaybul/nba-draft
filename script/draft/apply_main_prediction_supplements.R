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

anglicize_text <- function(x) {
  x <- as.character(x)
  converted <- suppressWarnings(iconv(x, from = "", to = "ASCII//TRANSLIT"))
  fill_idx <- is.na(converted) & !is.na(x)
  converted[fill_idx] <- x[fill_idx]
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

resolve_source_join_id <- function(dt, candidate_cols = c("player_id", "id")) {
  join_id <- rep(NA_character_, nrow(dt))
  for (col_name in candidate_cols) {
    if (!col_name %in% names(dt)) next
    vals <- trimws(as.character(dt[[col_name]]))
    vals[vals == ""] <- NA_character_
    fill_idx <- is.na(join_id) & !is.na(vals)
    join_id[fill_idx] <- vals[fill_idx]
  }
  join_id
}

keep_latest_source_rows <- function(dt) {
  if (!nrow(dt)) return(dt)

  dt <- copy(dt)
  dt[, join_player := if ("player" %in% names(dt)) normalize_join_name(player) else "unknown"]
  if ("draft_year" %in% names(dt)) dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt[, join_id := resolve_source_join_id(dt)]
  dt[, created_key___ := if ("created_at" %in% names(dt)) as.character(created_at) else ""]
  dt[, score_id___ := fifelse(is.na(join_id), 0L, 1L)]
  setorder(dt, join_player, draft_year, -score_id___, created_key___)
  dt <- unique(dt, by = c("join_player", "draft_year"))
  dt[, c("join_player", "join_id", "created_key___", "score_id___") := NULL]
  dt
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

domestic_fp <- file.path(draft_dir, "draft_prediction_domestic.csv")
supplement_fp <- file.path(draft_dir, "draft_prediction_source_supplement.csv")

if (!file.exists(domestic_fp)) {
  fwrite(data.table(), domestic_fp)
}

domestic_dt <- fread(domestic_fp, na.strings = c("", "NA", "N/A", "NaN"))
supplement_dt <- if (file.exists(supplement_fp)) fread(supplement_fp, na.strings = c("", "NA", "N/A", "NaN")) else data.table()

if (nrow(supplement_dt)) {
  combined_dt <- rbindlist(list(domestic_dt, supplement_dt), use.names = TRUE, fill = TRUE)
  combined_dt <- keep_latest_source_rows(combined_dt)
  fwrite(combined_dt, domestic_fp, na = "")
  message("Applied ", nrow(supplement_dt), " domestic supplement row(s) -> ", domestic_fp)
} else {
  fwrite(keep_latest_source_rows(domestic_dt), domestic_fp, na = "")
  message("No domestic supplement rows found; domestic file normalized -> ", domestic_fp)
}
