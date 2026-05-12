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

if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
library(data.table)

coalesce_numeric_columns <- function(dt, cols) {
  out <- rep(NA_real_, nrow(dt))
  for (col_name in cols) {
    if (!col_name %in% names(dt)) next
    vals <- suppressWarnings(as.numeric(dt[[col_name]]))
    fill <- !is.finite(out) & is.finite(vals)
    out[fill] <- vals[fill]
  }
  out
}

read_required <- function(path, label) {
  if (!file.exists(path)) {
    stop("Missing ", label, ": ", path)
  }
  fread(path, na.strings = c("", "NA", "N/A", "NaN"))
}

choose_draft_skill_path <- function(draft_dir) {
  adjusted_path <- file.path(draft_dir, "draft_skill_predictions_adjusted.csv")
  base_path <- file.path(draft_dir, "draft_skill_predictions_output.csv")
  env_path <- trimws(Sys.getenv("DRAFT_SIMILARITY_PREDICTIONS", ""))
  if (nzchar(env_path)) return(env_path)
  if (file.exists(adjusted_path)) return(adjusted_path)
  base_path
}

safe_sd <- function(x) {
  vals <- suppressWarnings(as.numeric(x))
  vals <- vals[is.finite(vals)]
  if (length(vals) < 2L) return(NA_real_)
  sd(vals)
}

standardize_against <- function(mat, center, scale) {
  sweep(sweep(mat, 2L, center, "-"), 2L, scale, "/")
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
out_path <- Sys.getenv("DRAFT_SIMILARITY_OUTPUT", file.path(draft_dir, "draft_similarity_comps.csv"))
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)

year_min <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_YEAR_MIN", "2016")))
year_max <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_YEAR_MAX", "2026")))
if (!is.finite(year_min)) year_min <- 2016L
if (!is.finite(year_max)) year_max <- 2026L

skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")

nba_path <- file.path(live_dir, "skilloutput.csv")
draft_path <- choose_draft_skill_path(draft_dir)
nba <- read_required(nba_path, "NBA skill output")
draft <- read_required(draft_path, "draft skill predictions")

missing_nba <- setdiff(c("player_name", "year"), names(nba))
missing_draft <- setdiff(c("player", "draft_year"), names(draft))
if (length(missing_nba)) stop("NBA skill output missing columns: ", paste(missing_nba, collapse = ", "))
if (length(missing_draft)) stop("Draft predictions missing columns: ", paste(missing_draft, collapse = ", "))

nba[, year := suppressWarnings(as.integer(year))]
draft[, draft_year := suppressWarnings(as.integer(draft_year))]
nba <- nba[is.finite(year) & year >= year_min & year <= year_max]
draft <- draft[is.finite(draft_year) & draft_year >= year_min & draft_year <= year_max]

if (!nrow(nba)) stop("No NBA skill rows found from ", year_min, " to ", year_max, ".")
if (!nrow(draft)) stop("No draft prediction rows found from ", year_min, " to ", year_max, ".")

for (skill in skill_names) {
  nba[[paste0("similarity_", skill)]] <- coalesce_numeric_columns(nba, c(paste0(skill, "_raw"), skill))
  draft[[paste0("similarity_", skill)]] <- coalesce_numeric_columns(draft, c(
    paste0("FINAL_", skill, "_raw_pred"),
    paste0(skill, "_raw_pred"),
    paste0("FINAL_", skill, "_pred"),
    paste0(skill, "_pred")
  ))
}

nba_skill_cols <- paste0("similarity_", skill_names)
draft_skill_cols <- paste0("similarity_", skill_names)
nba_matrix <- as.matrix(nba[, ..nba_skill_cols])
draft_matrix <- as.matrix(draft[, ..draft_skill_cols])
storage.mode(nba_matrix) <- "numeric"
storage.mode(draft_matrix) <- "numeric"

skill_center <- apply(nba_matrix, 2L, function(x) mean(x[is.finite(x)], na.rm = TRUE))
skill_scale <- apply(nba_matrix, 2L, safe_sd)
skill_scale[!is.finite(skill_scale) | skill_scale <= 0] <- 1

weights <- skill_scale
if (!any(is.finite(weights) & weights > 0)) {
  weights <- rep(1, length(skill_names))
}
weights[!is.finite(weights) | weights <= 0] <- median(weights[is.finite(weights) & weights > 0])
weights <- weights / mean(weights)

nba_z <- standardize_against(nba_matrix, skill_center, skill_scale)
draft_z <- standardize_against(draft_matrix, skill_center, skill_scale)

nba_complete <- apply(nba_z, 1L, function(row) all(is.finite(row)))
nba_candidates <- nba[nba_complete]
nba_candidate_z <- nba_z[nba_complete, , drop = FALSE]
if (!nrow(nba_candidates)) {
  stop("No NBA rows have complete similarity skill vectors.")
}

nba_candidates[, similarity_comp_total := coalesce_numeric_columns(.SD, c("FINAL_TOTAL", "TOTAL", "IMPACT_TOTAL"))]
nba_candidates[, similarity_comp_off := coalesce_numeric_columns(.SD, c("FINAL_OFF", "OFF", "IMPACT_OFF"))]
nba_candidates[, similarity_comp_def := coalesce_numeric_columns(.SD, c("FINAL_DEF", "DEF", "IMPACT_DEF"))]
nba_candidates[, similarity_comp_minutes := coalesce_numeric_columns(.SD, c("skill_effective_minutes", "skill_window_minutes"))]

result_rows <- vector("list", nrow(draft))
for (i in seq_len(nrow(draft))) {
  available <- is.finite(draft_z[i, ]) & weights > 0
  base_row <- data.table(
    player = as.character(draft$player[[i]]),
    draft_year = as.integer(draft$draft_year[[i]]),
    similarity_comp_player = NA_character_,
    similarity_comp_year = NA_integer_,
    similarity_score = NA_real_,
    similarity_distance = NA_real_,
    similarity_comp_total = NA_real_,
    similarity_comp_off = NA_real_,
    similarity_comp_def = NA_real_,
    similarity_comp_minutes = NA_real_
  )

  if (!any(available)) {
    result_rows[[i]] <- base_row
    next
  }

  diffs <- sweep(nba_candidate_z[, available, drop = FALSE], 2L, draft_z[i, available], "-")
  distance <- sqrt(rowSums(sweep(diffs^2, 2L, weights[available], "*")) / sum(weights[available]))
  if (!any(is.finite(distance))) {
    result_rows[[i]] <- base_row
    next
  }

  best <- data.table(row_index = seq_along(distance), similarity_distance = distance)
  best[, similarity_score := 100 * exp(-0.5 * similarity_distance^2)]
  best[, similarity_comp_minutes := nba_candidates$similarity_comp_minutes]
  best[, similarity_comp_total := nba_candidates$similarity_comp_total]
  best[, similarity_comp_player := as.character(nba_candidates$player_name)]
  setorder(best, similarity_distance, -similarity_comp_minutes, -similarity_comp_total, similarity_comp_player)
  best_idx <- best$row_index[[1]]

  result_rows[[i]] <- data.table(
    player = as.character(draft$player[[i]]),
    draft_year = as.integer(draft$draft_year[[i]]),
    similarity_comp_player = as.character(nba_candidates$player_name[[best_idx]]),
    similarity_comp_year = as.integer(nba_candidates$year[[best_idx]]),
    similarity_score = round(best$similarity_score[[1]], 1),
    similarity_distance = round(best$similarity_distance[[1]], 4),
    similarity_comp_total = round(nba_candidates$similarity_comp_total[[best_idx]], 3),
    similarity_comp_off = round(nba_candidates$similarity_comp_off[[best_idx]], 3),
    similarity_comp_def = round(nba_candidates$similarity_comp_def[[best_idx]], 3),
    similarity_comp_minutes = round(nba_candidates$similarity_comp_minutes[[best_idx]], 1)
  )
}

out <- rbindlist(result_rows, use.names = TRUE, fill = TRUE)
setorder(out, -draft_year, player)
fwrite(out, out_path, na = "")

complete_count <- sum(is.finite(out$similarity_score))
message("Draft similarity comps written -> ", out_path)
message("Rows: ", nrow(out), "; finite top comps: ", complete_count, "; NBA candidate seasons: ", nrow(nba_candidates))
