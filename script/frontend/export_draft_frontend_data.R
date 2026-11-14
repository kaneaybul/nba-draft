get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    return(dirname(normalizePath(sub(file_arg, "", script_arg[[1]]), winslash = "/", mustWork = FALSE)))
  }
  normalizePath(getwd(), winslash = "/", mustWork = FALSE)
}

resolve_base_dir_local <- function() {
  script_dir <- get_script_dir()
  candidates <- unique(c(
    getwd(),
    file.path(script_dir, "..", ".."),
    file.path(getwd(), ".."),
    file.path(getwd(), "..", "..")
  ))
  for (candidate in candidates) {
    candidate <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate, "raw")) && dir.exists(file.path(candidate, "script"))) {
      return(candidate)
    }
  }
  stop("Could not resolve project root.")
}

base_dir <- resolve_base_dir_local()
export_script <- file.path(base_dir, "script", "frontend", "export_frontend_data.R")
export_lines <- readLines(export_script, warn = FALSE, encoding = "UTF-8")
export_cut <- grep("^base_dir <- resolve_base_dir\\(\\)", export_lines)[1]
if (!length(export_cut) || !is.finite(export_cut)) {
  stop("Could not find execution boundary in ", export_script)
}
eval(parse(text = paste(export_lines[seq_len(export_cut - 1)], collapse = "\n")), envir = .GlobalEnv)
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

target_draft_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_TARGET_DRAFT_YEAR", "")))
if (!is.finite(target_draft_year)) {
  stop("Draft frontend export requires DRAFT_TARGET_DRAFT_YEAR, e.g. DRAFT_TARGET_DRAFT_YEAR=2026.")
}

out_dir <- file.path(base_dir, "frontend", "public", "data")
draft_json_path <- file.path(out_dir, "draft_prospects.json")
impact_json_path <- file.path(out_dir, "impact_players.json")
if (!file.exists(draft_json_path)) {
  stop("Existing draft frontend JSON not found: ", draft_json_path)
}

read_json_df <- function(path) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package 'jsonlite' is required to read existing frontend JSON.")
  }
  as.data.frame(jsonlite::fromJSON(path, simplifyDataFrame = TRUE), stringsAsFactors = FALSE)
}

impact_reference <- NULL
replacement_reference <- NULL
if (file.exists(impact_json_path)) {
  players <- read_json_df(impact_json_path)
  latest_impact_year <- suppressWarnings(max(as.integer(players$skill_source_year), na.rm = TRUE))
  if (!is.finite(latest_impact_year)) {
    latest_impact_year <- suppressWarnings(max(as.integer(players$year), na.rm = TRUE))
  }
  if (is.finite(latest_impact_year)) {
    replacement_reference <- replacement_reference_from_players(players, latest_impact_year)
    impact_reference <- players[
      suppressWarnings(as.integer(players$year)) == latest_impact_year &
        !is.na(players$total) & is.finite(players$total) &
        !is.na(players$timin) & is.finite(players$timin) &
        !is.na(players$Minutes) & suppressWarnings(as.numeric(players$Minutes)) > 0 &
        players$score_label != "DNQ",
      c("total", "timin"),
      drop = FALSE
    ]
  }
}

existing <- read_json_df(draft_json_path)
draft <- build_draft_prospects(base_dir, impact_reference, replacement_reference)
target_rows <- draft[suppressWarnings(as.integer(draft$draft_year)) == target_draft_year, , drop = FALSE]
if (!nrow(target_rows)) {
  stop("No draft frontend rows built for ", target_draft_year)
}

existing <- existing[suppressWarnings(as.integer(existing$draft_year)) != target_draft_year, , drop = FALSE]
all_cols <- unique(c(names(target_rows), names(existing)))
for (col_name in setdiff(all_cols, names(existing))) existing[[col_name]] <- NA
for (col_name in setdiff(all_cols, names(target_rows))) target_rows[[col_name]] <- NA
merged <- rbind(existing[, all_cols, drop = FALSE], target_rows[, all_cols, drop = FALSE])
merged <- merged[order(-suppressWarnings(as.integer(merged$draft_year)), suppressWarnings(as.numeric(merged$rank_in_class))), , drop = FALSE]
write_json_df(merged, draft_json_path)

message("Draft frontend JSON updated for ", target_draft_year, " only -> ", draft_json_path)
