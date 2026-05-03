if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
if (!requireNamespace("rvest", quietly = TRUE)) {
  stop("Package 'rvest' is required. Install it with install.packages('rvest').")
}
if (!requireNamespace("xml2", quietly = TRUE)) {
  stop("Package 'xml2' is required. Install it with install.packages('xml2').")
}

library(data.table)
library(rvest)
library(xml2)

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

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

merge_target_year_rows <- function(existing_path, update_dt, target_year, key_cols) {
  update_dt <- as.data.table(copy(update_dt))

  if (!is.finite(target_year) || !file.exists(existing_path)) {
    return(update_dt)
  }

  existing_dt <- fread(existing_path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(existing_dt)) {
    return(update_dt)
  }

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

read_manual_latest_class <- function(path) {
  if (!file.exists(path)) return(NULL)

  manual_dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(manual_dt)) return(NULL)

  required_cols <- c("draft_year", "player")
  if (!all(required_cols %in% names(manual_dt))) {
    warning("Manual no-college class file is missing required columns: ", path)
    return(NULL)
  }

  optional_cols <- c(
    "pick_overall", "pick_in_round", "team", "college", "years_in_nba",
    "source_url", "br_player_url", "realgm_profile_url", "pre_draft_team",
    "pos", "age", "big_board_rank", "manual_note"
  )
  for (col_name in optional_cols) {
    if (!col_name %in% names(manual_dt)) manual_dt[, (col_name) := NA]
  }

  manual_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  manual_dt[, player := as.character(player)]
  manual_dt[, `:=`(
    source_origin = "manual_latest_class",
    no_college_flag = is.na(college) | !nzchar(trimws(as.character(college)))
  )]
  manual_dt[]
}

fetch_draft_year <- function(year) {
  url <- sprintf("https://www.basketball-reference.com/draft/NBA_%s.html", year)
  page <- read_html(url)
  table_node <- html_element(page, "table#stats")

  if (inherits(table_node, "xml_missing")) {
    stop("Draft table not found for year: ", year)
  }

  row_nodes <- html_elements(table_node, "tbody tr")
  row_nodes <- row_nodes[!grepl("\\bthead\\b", html_attr(row_nodes, "class", default = ""))]

  rows <- lapply(row_nodes, function(row_node) {
    cell_nodes <- html_elements(row_node, "th, td")
    if (!length(cell_nodes)) return(NULL)

    cell_values <- trimws(html_text2(cell_nodes))
    cell_values[cell_values == ""] <- NA_character_

    data.table(
      draft_year = year,
      pick_overall = suppressWarnings(as.integer(cell_values[1])),
      pick_in_round = suppressWarnings(as.integer(cell_values[2])),
      team = cell_values[3],
      player = cell_values[4],
      college = cell_values[5],
      years_in_nba = suppressWarnings(as.integer(cell_values[6])),
      source_url = url,
      br_player_url = {
        player_link <- html_element(cell_nodes[4], "a")
        if (inherits(player_link, "xml_missing")) NA_character_ else url_absolute(html_attr(player_link, "href"), url)
      }
    )
  })

  out <- rbindlist(rows, fill = TRUE)
  out <- out[!is.na(pick_overall) & !is.na(player) & nzchar(player)]
  out[, no_college_flag := is.na(college) | !nzchar(trimws(college))]
  out[, `:=`(
    realgm_profile_url = NA_character_,
    pre_draft_team = NA_character_,
    manual_note = NA_character_,
    source_origin = "basketball_reference"
  )]
  out[]
}

safe_fetch_draft_year <- function(year) {
  tryCatch(
    fetch_draft_year(year),
    error = function(e) {
      warning(sprintf("Skipping draft year %s because the draft page could not be loaded: %s", year, conditionMessage(e)))
      data.table()
    }
  )
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

all_out <- file.path(draft_dir, "draft_picks_all_classes.csv")
no_college_out <- file.path(draft_dir, "draft_no_college_all_classes.csv")
summary_out <- file.path(draft_dir, "draft_no_college_all_classes_summary.csv")

legacy_all_out <- file.path(draft_dir, "draft_picks_2014_2025.csv")
legacy_no_college_out <- file.path(draft_dir, "draft_no_college_2014_2025.csv")
legacy_summary_out <- file.path(draft_dir, "draft_no_college_2014_2025_summary.csv")

target_draft_year <- parse_optional_int_env("NO_COLLEGE_TARGET_DRAFT_YEAR")
start_year <- parse_optional_int_env("NO_COLLEGE_COHORT_START_YEAR")
end_year <- parse_optional_int_env("NO_COLLEGE_COHORT_END_YEAR")

if (!is.finite(start_year)) start_year <- 2014L
if (!is.finite(end_year)) end_year <- 2025L
if (end_year < start_year) {
  stop("NO_COLLEGE_COHORT_END_YEAR must be greater than or equal to NO_COLLEGE_COHORT_START_YEAR.")
}

manual_latest_file <- Sys.getenv(
  "NO_COLLEGE_MANUAL_CLASS_FILE",
  file.path(draft_dir, "no_college_latest_class_manual.csv")
)

years_to_fetch <- if (is.finite(target_draft_year)) target_draft_year else start_year:end_year
fetched_years <- rbindlist(lapply(years_to_fetch, safe_fetch_draft_year), fill = TRUE)
manual_latest_dt <- read_manual_latest_class(manual_latest_file)
if (!is.null(manual_latest_dt) && is.finite(target_draft_year)) {
  manual_latest_dt <- manual_latest_dt[draft_year == target_draft_year]
}

all_years <- rbindlist(Filter(Negate(is.null), list(fetched_years, manual_latest_dt)), fill = TRUE)
if (!nrow(all_years)) {
  stop("No no-college cohort rows were produced. Check the remote draft pages or the manual latest-class file.")
}

all_years[, player_key := normalize_name(player)]
all_years[, manual_priority := as.integer(source_origin == "manual_latest_class")]
setorder(all_years, -manual_priority, draft_year, pick_overall, player)
all_years <- unique(all_years, by = c("draft_year", "player_key"))
all_years[, c("player_key", "manual_priority") := NULL]
setorder(all_years, draft_year, pick_overall)

no_college <- all_years[no_college_flag == TRUE]

all_years <- merge_target_year_rows(all_out, all_years, target_draft_year, c("draft_year", "player"))
no_college <- merge_target_year_rows(no_college_out, no_college, target_draft_year, c("draft_year", "player"))

fwrite(all_years, all_out, na = "")
fwrite(no_college, no_college_out, na = "")
fwrite(no_college[, .N, by = draft_year][order(draft_year)], summary_out, na = "")

fwrite(all_years, legacy_all_out, na = "")
fwrite(no_college, legacy_no_college_out, na = "")
fwrite(no_college[, .N, by = draft_year][order(draft_year)], legacy_summary_out, na = "")

cat("All draft picks written ->", all_out, "\n")
cat("No-college draft picks written ->", no_college_out, "\n")
cat("No-college summary written ->", summary_out, "\n")
cat("Legacy compatibility copies updated ->", legacy_all_out, ", ", legacy_no_college_out, ", ", legacy_summary_out, "\n", sep = "")
if (file.exists(manual_latest_file)) {
  cat("Manual latest-class file loaded ->", manual_latest_file, "\n")
}
if (is.finite(target_draft_year)) {
  cat("Target draft-year refresh applied ->", target_draft_year, "\n")
}
