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
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Package 'jsonlite' is required. Install it with install.packages('jsonlite').")
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

encode_similarity_comps <- function(comp_dt) {
  if (is.null(comp_dt) || !nrow(comp_dt)) return("[]")
  as.character(jsonlite::toJSON(comp_dt, dataframe = "rows", auto_unbox = TRUE, na = "null", digits = NA))
}

build_similarity_outputs <- function(draft, nba_candidates, draft_z, nba_candidate_z, weights, selected_skills, prefix, top_n) {
  score_col <- paste0(prefix, "_score")
  distance_col <- paste0(prefix, "_distance")
  comp_player_col <- paste0(prefix, "_comp_player")
  comp_year_col <- paste0(prefix, "_comp_year")
  comp_total_col <- paste0(prefix, "_comp_total")
  comp_off_col <- paste0(prefix, "_comp_off")
  comp_def_col <- paste0(prefix, "_comp_def")
  comp_minutes_col <- paste0(prefix, "_comp_minutes")
  comps_col <- paste0(prefix, "_comps")
  rank_col <- paste0(prefix, "_comp_rank")
  selected_cols <- paste0("similarity_", selected_skills)
  selected_idx <- match(selected_cols, colnames(draft_z))
  selected_idx <- selected_idx[is.finite(selected_idx)]

  result_rows <- vector("list", nrow(draft))
  top_rows <- vector("list", nrow(draft))
  for (i in seq_len(nrow(draft))) {
    available <- selected_idx[is.finite(draft_z[i, selected_idx]) & weights[selected_idx] > 0]
    base_row <- data.table(
      player = as.character(draft$player[[i]]),
      draft_year = as.integer(draft$draft_year[[i]])
    )
    base_row[[comp_player_col]] <- NA_character_
    base_row[[comp_year_col]] <- NA_integer_
    base_row[[score_col]] <- NA_real_
    base_row[[distance_col]] <- NA_real_
    base_row[[comp_total_col]] <- NA_real_
    base_row[[comp_off_col]] <- NA_real_
    base_row[[comp_def_col]] <- NA_real_
    base_row[[comp_minutes_col]] <- NA_real_
    base_row[[comps_col]] <- "[]"

    if (!length(available)) {
      result_rows[[i]] <- base_row
      top_rows[[i]] <- data.table()
      next
    }

    diffs <- sweep(nba_candidate_z[, available, drop = FALSE], 2L, draft_z[i, available], "-")
    distance <- sqrt(rowSums(sweep(diffs^2, 2L, weights[available], "*")) / sum(weights[available]))
    if (!any(is.finite(distance))) {
      result_rows[[i]] <- base_row
      top_rows[[i]] <- data.table()
      next
    }

    best <- data.table(row_index = seq_along(distance), distance = distance)
    best[, score := 100 * exp(-0.5 * distance^2)]
    best[, comp_minutes := nba_candidates$similarity_comp_minutes]
    best[, comp_total := nba_candidates$similarity_comp_total]
    best[, comp_player := as.character(nba_candidates$player_name)]
    setorder(best, distance, -comp_minutes, -comp_total, comp_player)
    top <- head(best, top_n)
    top[, rank := seq_len(.N)]
    top_comp_rows <- data.table(
      player = rep(as.character(draft$player[[i]]), nrow(top)),
      draft_year = rep(as.integer(draft$draft_year[[i]]), nrow(top))
    )
    top_comp_rows[, (rank_col) := as.integer(top$rank)]
    top_comp_rows[, (comp_player_col) := as.character(nba_candidates$player_name[top$row_index])]
    top_comp_rows[, (comp_year_col) := as.integer(nba_candidates$year[top$row_index])]
    top_comp_rows[, (score_col) := round(top$score, 1)]
    top_comp_rows[, (distance_col) := round(top$distance, 4)]
    top_comp_rows[, (comp_total_col) := round(nba_candidates$similarity_comp_total[top$row_index], 3)]
    top_comp_rows[, (comp_off_col) := round(nba_candidates$similarity_comp_off[top$row_index], 3)]
    top_comp_rows[, (comp_def_col) := round(nba_candidates$similarity_comp_def[top$row_index], 3)]
    top_comp_rows[, (comp_minutes_col) := round(nba_candidates$similarity_comp_minutes[top$row_index], 1)]
    top_rows[[i]] <- top_comp_rows
    top_json <- encode_similarity_comps(data.table(
      rank = top_comp_rows[[rank_col]],
      player = top_comp_rows[[comp_player_col]],
      year = top_comp_rows[[comp_year_col]],
      score = top_comp_rows[[score_col]],
      distance = top_comp_rows[[distance_col]],
      total = top_comp_rows[[comp_total_col]],
      off = top_comp_rows[[comp_off_col]],
      def = top_comp_rows[[comp_def_col]],
      minutes = top_comp_rows[[comp_minutes_col]]
    ))
    best_idx <- top$row_index[[1]]

    result_row <- data.table(
      player = as.character(draft$player[[i]]),
      draft_year = as.integer(draft$draft_year[[i]])
    )
    result_row[[comp_player_col]] <- as.character(nba_candidates$player_name[[best_idx]])
    result_row[[comp_year_col]] <- as.integer(nba_candidates$year[[best_idx]])
    result_row[[score_col]] <- round(best$score[[1]], 1)
    result_row[[distance_col]] <- round(best$distance[[1]], 4)
    result_row[[comp_total_col]] <- round(nba_candidates$similarity_comp_total[[best_idx]], 3)
    result_row[[comp_off_col]] <- round(nba_candidates$similarity_comp_off[[best_idx]], 3)
    result_row[[comp_def_col]] <- round(nba_candidates$similarity_comp_def[[best_idx]], 3)
    result_row[[comp_minutes_col]] <- round(nba_candidates$similarity_comp_minutes[[best_idx]], 1)
    result_row[[comps_col]] <- top_json
    result_rows[[i]] <- result_row
  }

  list(
    out = rbindlist(result_rows, use.names = TRUE, fill = TRUE),
    top = rbindlist(top_rows, use.names = TRUE, fill = TRUE)
  )
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
live_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
out_path <- Sys.getenv("DRAFT_SIMILARITY_OUTPUT", file.path(draft_dir, "draft_similarity_comps.csv"))
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)

year_min <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_YEAR_MIN", "2016")))
year_max <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_YEAR_MAX", "2026")))
comp_year_min <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_COMP_YEAR_MIN", "2017")))
top_n <- suppressWarnings(as.integer(Sys.getenv("DRAFT_SIMILARITY_TOP_N", "10")))
if (!is.finite(year_min)) year_min <- 2016L
if (!is.finite(year_max)) year_max <- 2026L
if (!is.finite(comp_year_min)) comp_year_min <- 2017L
if (!is.finite(top_n) || top_n < 1L) top_n <- 10L

skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
offense_skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT")
defense_skill_names <- c("DPM", "DREB", "RIMPRO", "SWITCH")

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
nba <- nba[is.finite(year) & year >= max(year_min, comp_year_min) & year <= year_max]
draft <- draft[is.finite(draft_year) & draft_year >= year_min & draft_year <= year_max]

if (!nrow(nba)) stop("No NBA comp candidate skill rows found from ", max(year_min, comp_year_min), " to ", year_max, ".")
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

total_outputs <- build_similarity_outputs(draft, nba_candidates, draft_z, nba_candidate_z, weights, skill_names, "similarity", top_n)
off_outputs <- build_similarity_outputs(draft, nba_candidates, draft_z, nba_candidate_z, weights, offense_skill_names, "off_similarity", top_n)
def_outputs <- build_similarity_outputs(draft, nba_candidates, draft_z, nba_candidate_z, weights, defense_skill_names, "def_similarity", top_n)

out <- merge(total_outputs$out, off_outputs$out, by = c("player", "draft_year"), all = TRUE)
out <- merge(out, def_outputs$out, by = c("player", "draft_year"), all = TRUE)
setorder(out, -draft_year, player)
fwrite(out, out_path, na = "")

top_out <- total_outputs$top
top_out_path <- sub("\\.csv$", sprintf("_top%s.csv", top_n), out_path)
if (!identical(top_out_path, out_path)) {
  setorder(top_out, -draft_year, player, similarity_comp_rank)
  fwrite(top_out, top_out_path, na = "")
}

off_top_out_path <- sub("\\.csv$", sprintf("_off_top%s.csv", top_n), out_path)
def_top_out_path <- sub("\\.csv$", sprintf("_def_top%s.csv", top_n), out_path)
if (!identical(off_top_out_path, out_path)) {
  setorder(off_outputs$top, -draft_year, player, off_similarity_comp_rank)
  fwrite(off_outputs$top, off_top_out_path, na = "")
}
if (!identical(def_top_out_path, out_path)) {
  setorder(def_outputs$top, -draft_year, player, def_similarity_comp_rank)
  fwrite(def_outputs$top, def_top_out_path, na = "")
}

complete_count <- sum(is.finite(out$similarity_score))
message("Draft similarity comps written -> ", out_path)
if (!identical(top_out_path, out_path)) {
  message("Draft similarity top-", top_n, " comps written -> ", top_out_path)
}
if (!identical(off_top_out_path, out_path)) {
  message("Draft offense similarity top-", top_n, " comps written -> ", off_top_out_path)
}
if (!identical(def_top_out_path, out_path)) {
  message("Draft defense similarity top-", top_n, " comps written -> ", def_top_out_path)
}
message("Rows: ", nrow(out), "; finite top comps: ", complete_count, "; NBA candidate seasons: ", nrow(nba_candidates))
