draft_model_common_path <- file.path("script", "draft", "draft_model_common.R")
if (!file.exists(draft_model_common_path)) {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    draft_model_common_path <- file.path(dirname(normalizePath(sub(file_arg, "", script_arg[[1]]), winslash = "/", mustWork = FALSE)), "draft_model_common.R")
  }
}
source(draft_model_common_path, local = TRUE)

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")

if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required.")
}
library(data.table)

source_url <- "https://www.sportingnews.com/us/nba/news/nba-draft-combine-results-height-wingspan-measurements-2026/9a5a0b91e9b707dbd0d4894c"
source_note <- "Updated official 2026 NBA Draft Combine measurement table; pulled 2026-05-22"

updates <- data.table(
  player = c("Jeremy Fears Jr.", "Luigi Suigo", "Milos Uzan", "Richie Saunders"),
  height = c("6-0", "7-2.75", "6-3", "6-5"),
  weight = c("196", "289", "185", "204"),
  wingspan = c("6-4", "7-5.5", "6-5", "6-8.75"),
  standing_reach = c("8-1.5", "9-6", "8-2", "8-6.5"),
  height_wo_shoes_in = c(72, 86.75, 75, 77),
  weight_lbs = c(196, 289, 185, 204),
  wingspan_in = c(76, 89.5, 77, 80.75),
  standing_reach_in = c(97.5, 114, 98, 102.5)
)

update_measurement_table <- function(path) {
  if (!file.exists(path)) return(invisible(NULL))
  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"player" %in% names(dt)) return(invisible(NULL))
  for (text_col in intersect(c("height", "weight", "wingspan", "standing_reach", "measurement_status", "source", "source_url", "source_note", "pulled_at_utc"), names(dt))) {
    dt[, (text_col) := as.character(get(text_col))]
  }

  for (i in seq_len(nrow(updates))) {
    idx <- dt$player == updates$player[[i]]
    if (!any(idx, na.rm = TRUE)) next

    shared <- intersect(
      c("height", "weight", "wingspan", "standing_reach", "height_wo_shoes_in", "weight_lbs", "wingspan_in", "standing_reach_in"),
      names(dt)
    )
    for (col in shared) set(dt, which(idx), col, updates[[col]][[i]])
    if ("measurement_status" %in% names(dt)) set(dt, which(idx), "measurement_status", "reported")
    if ("source" %in% names(dt)) set(dt, which(idx), "source", "Sporting News")
    if ("source_url" %in% names(dt)) set(dt, which(idx), "source_url", source_url)
    if ("source_note" %in% names(dt)) set(dt, which(idx), "source_note", source_note)
    if ("pulled_at_utc" %in% names(dt)) set(dt, which(idx), "pulled_at_utc", "2026-05-22")
  }

  fwrite(dt, path, na = "")
  message("Updated measurement table -> ", path)
}

update_coverage_table <- function(path) {
  if (!file.exists(path)) return(invisible(NULL))
  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"player" %in% names(dt)) return(invisible(NULL))
  for (text_col in intersect(c("reported", "measurement_status", "source", "source_url", "source_note"), names(dt))) {
    dt[, (text_col) := as.character(get(text_col))]
  }

  for (i in seq_len(nrow(updates))) {
    idx <- dt$player == updates$player[[i]]
    if (!any(idx, na.rm = TRUE)) next

    if ("reported" %in% names(dt)) set(dt, which(idx), "reported", "yes")
    if ("measurement_status" %in% names(dt)) set(dt, which(idx), "measurement_status", "reported")
    if ("combine_height_wo_shoes_in" %in% names(dt)) set(dt, which(idx), "combine_height_wo_shoes_in", updates$height_wo_shoes_in[[i]])
    if ("combine_wingspan_in" %in% names(dt)) set(dt, which(idx), "combine_wingspan_in", updates$wingspan_in[[i]])
    if ("combine_weight_lbs" %in% names(dt)) set(dt, which(idx), "combine_weight_lbs", updates$weight_lbs[[i]])
    if ("standing_reach_in" %in% names(dt)) set(dt, which(idx), "standing_reach_in", updates$standing_reach_in[[i]])
    if ("source" %in% names(dt)) set(dt, which(idx), "source", "Sporting News")
    if ("source_url" %in% names(dt)) set(dt, which(idx), "source_url", source_url)
    if ("source_note" %in% names(dt)) set(dt, which(idx), "source_note", source_note)
  }

  fwrite(dt, path, na = "")
  message("Updated coverage table -> ", path)
}

update_prediction_source <- function(path) {
  if (!file.exists(path)) return(invisible(NULL))
  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"player" %in% names(dt) || !"draft_year" %in% names(dt)) return(invisible(NULL))

  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  for (text_col in intersect(c("measurement_source", "measurement_source_url", "measurement_source_note", "height_source_type", "wingspan_source_type"), names(dt))) {
    dt[, (text_col) := as.character(get(text_col))]
  }

  for (i in seq_len(nrow(updates))) {
    idx <- dt$draft_year == 2026L & dt$player == updates$player[[i]]
    if (!any(idx, na.rm = TRUE)) next

    if ("height_wo_shoes_in" %in% names(dt)) set(dt, which(idx), "height_wo_shoes_in", updates$height_wo_shoes_in[[i]])
    if ("wingspan_in" %in% names(dt)) set(dt, which(idx), "wingspan_in", updates$wingspan_in[[i]])
    if ("weight_lbs" %in% names(dt)) set(dt, which(idx), "weight_lbs", updates$weight_lbs[[i]])
    if ("standing_reach_in" %in% names(dt)) set(dt, which(idx), "standing_reach_in", updates$standing_reach_in[[i]])
    if ("measurement_source" %in% names(dt)) set(dt, which(idx), "measurement_source", "Sporting News")
    if ("measurement_source_url" %in% names(dt)) set(dt, which(idx), "measurement_source_url", source_url)
    if ("measurement_source_note" %in% names(dt)) set(dt, which(idx), "measurement_source_note", source_note)
    if ("height_source_type" %in% names(dt)) set(dt, which(idx), "height_source_type", "2026_combine_reported")
    if ("wingspan_source_type" %in% names(dt)) set(dt, which(idx), "wingspan_source_type", "2026_combine_reported")
  }

  fwrite(dt, path, na = "")
  message("Updated prediction source -> ", path)
}

update_measurement_table(file.path(draft_dir, "temp_2026_combine_measurements_combined.csv"))
update_measurement_table(file.path(draft_dir, "temp_2026_combine_measurements_sportingnews.csv"))
update_coverage_table(file.path(draft_dir, "temp_2026_combine_measurement_coverage.csv"))
update_coverage_table(file.path(draft_dir, "temp_2026_combine_measurement_coverage_combined.csv"))

update_prediction_source(file.path(draft_dir, "draft_prediction_domestic.csv"))
update_prediction_source(file.path(draft_dir, "draft_prediction_international.csv"))
update_prediction_source(file.path(draft_dir, "no_college_prediction.csv"))
update_prediction_source(file.path(draft_dir, "draft_prediction_unified.csv"))
