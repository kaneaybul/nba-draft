if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
if (!requireNamespace("readxl", quietly = TRUE)) {
  stop("Package 'readxl' is required. Install it with install.packages('readxl').")
}

library(data.table)

get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    return(dirname(normalizePath(sub(file_arg, "", script_arg[[1]]), winslash = "/", mustWork = FALSE)))
  }
  normalizePath(getwd(), winslash = "/", mustWork = FALSE)
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- unique(c(
    getwd(),
    file.path(script_dir, "..", ".."),
    file.path(getwd(), ".."),
    file.path(getwd(), "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  ))
  for (candidate in candidates) {
    candidate <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate, "processed")) && dir.exists(file.path(candidate, "script"))) {
      return(candidate)
    }
  }
  stop("Could not resolve project root.")
}

read_csv_optional <- function(path) {
  if (!file.exists(path)) return(data.table())
  tryCatch(fread(path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) data.table())
}

coalesce_character <- function(...) {
  vals <- list(...)
  out <- rep(NA_character_, length(vals[[1]]))
  for (v in vals) {
    v <- as.character(v)
    v[!nzchar(trimws(v))] <- NA_character_
    fill <- is.na(out) & !is.na(v)
    out[fill] <- v[fill]
  }
  out
}

normalize_college_key <- function(x) {
  key <- normalize_name(x)
  key <- gsub("\\buniversity\\b", " ", key)
  key <- gsub("\\bstate\\b", "st", key)
  key <- gsub("\\s+", " ", key)
  key <- trimws(key)

  alias_map <- c(
    "unc" = "north carolina",
    "uconn" = "connecticut",
    "nc st" = "north carolina st",
    "ohio university" = "ohio",
    "utah st" = "utah st",
    "uw milwaukee" = "milwaukee",
    "central florida" = "ucf",
    "pitt" = "pittsburgh",
    "ole miss" = "mississippi"
  )
  mapped <- alias_map[key]
  key[!is.na(mapped)] <- unname(mapped[!is.na(mapped)])
  key
}

parse_years <- function(raw_value, default_years) {
  raw_value <- trimws(raw_value)
  if (!nzchar(raw_value)) return(default_years)
  pieces <- trimws(unlist(strsplit(raw_value, "[,;|]", perl = TRUE), use.names = FALSE))
  years <- suppressWarnings(as.integer(pieces[nzchar(pieces)]))
  unique(years[is.finite(years)])
}

standardize_sos_dt <- function(dt, source_label) {
  dt <- as.data.table(dt)
  required <- c("School", "Year", "SOS")
  missing <- setdiff(required, names(dt))
  if (length(missing)) {
    stop("SOS source is missing required columns: ", paste(missing, collapse = ", "))
  }

  out <- data.table(
    school = as.character(dt$School),
    year = suppressWarnings(as.integer(dt$Year)),
    games = if ("G" %in% names(dt)) suppressWarnings(as.numeric(dt$G)) else NA_real_,
    wins = if ("W" %in% names(dt)) suppressWarnings(as.numeric(dt$W)) else NA_real_,
    losses = if ("L" %in% names(dt)) suppressWarnings(as.numeric(dt$L)) else NA_real_,
    win_pct = if ("W-L%" %in% names(dt)) suppressWarnings(as.numeric(dt[["W-L%"]])) else NA_real_,
    srs = if ("SRS" %in% names(dt)) suppressWarnings(as.numeric(dt$SRS)) else NA_real_,
    sos = suppressWarnings(as.numeric(dt$SOS)),
    source = source_label
  )
  out <- out[nzchar(trimws(school)) & is.finite(year) & is.finite(sos)]
  out[, school_key := normalize_college_key(school)]
  setorder(out, year, school)
  unique(out, by = c("year", "school_key"))
}

load_template_sos <- function(workbook_path) {
  if (!file.exists(workbook_path)) {
    stop("Draft template workbook not found: ", workbook_path)
  }
  raw <- suppressMessages(readxl::read_excel(workbook_path, sheet = "sos"))
  standardize_sos_dt(raw, "draft_template_sos_sheet")
}

pull_sports_reference_sos <- function(years) {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull Sports Reference ratings pages.")
  }
  if (!requireNamespace("xml2", quietly = TRUE)) {
    stop("Package 'xml2' is required to pull Sports Reference ratings pages.")
  }

  rows <- lapply(years, function(year) {
    url <- sprintf("https://www.sports-reference.com/cbb/seasons/men/%d-ratings.html", as.integer(year))
    message("Pulling Sports Reference CBB ratings: ", url)
    page <- if (requireNamespace("httr", quietly = TRUE)) {
      resp <- httr::GET(url, httr::user_agent("Mozilla/5.0"))
      httr::stop_for_status(resp)
      xml2::read_html(httr::content(resp, as = "text", encoding = "UTF-8"))
    } else {
      xml2::read_html(url)
    }
    tables <- rvest::html_table(page, fill = TRUE)
    if (!length(tables)) {
      warning("No tables found for Sports Reference ratings year ", year)
      return(NULL)
    }

    candidates <- lapply(tables, as.data.table)
    score <- vapply(candidates, function(x) sum(c("School", "SOS", "SRS") %in% names(x)), integer(1))
    dt <- candidates[[which.max(score)]]
    if (!all(c("School", "SOS") %in% names(dt))) {
      warning("Could not identify ratings table for year ", year)
      return(NULL)
    }

    dt <- dt[School != "School"]
    dt[, Year := as.integer(year)]
    standardize_sos_dt(dt, "sports_reference_ratings_page")
  })

  out <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  if (!nrow(out)) {
    stop("No Sports Reference SOS rows were pulled.")
  }
  out
}

load_template_year_teams <- function(workbook_path) {
  if (!file.exists(workbook_path)) return(data.table())
  sheet_names <- readxl::excel_sheets(workbook_path)
  year_sheets <- sheet_names[grepl("^\\d{4}$", sheet_names)]
  rows <- lapply(year_sheets, function(sheet_name) {
    year <- suppressWarnings(as.integer(sheet_name))
    dt <- tryCatch(
      as.data.table(readxl::read_excel(workbook_path, sheet = sheet_name, skip = 1)),
      error = function(e) data.table()
    )
    if (!nrow(dt) || !all(c("Name", "Team") %in% names(dt))) return(data.table())
    dt <- dt[nzchar(trimws(as.character(Name))) & nzchar(trimws(as.character(Team)))]
    data.table(
      player = as.character(dt$Name),
      draft_year = year,
      template_team = as.character(dt$Team)
    )
  })
  out <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  if (!nrow(out)) return(out)
  out[, name_key := normalize_name(player)]
  setorder(out, draft_year, name_key)
  unique(out[, .(draft_year, name_key, template_team)], by = c("draft_year", "name_key"))
}

make_prospect_team_panel <- function(base_dir, workbook_path) {
  pred <- read_csv_optional(file.path(base_dir, "processed", "draft", "draft_prediction_unified.csv"))
  if (!nrow(pred) || !all(c("player", "draft_year") %in% names(pred))) {
    stop("Missing usable draft_prediction_unified.csv.")
  }
  pred[, draft_year := suppressWarnings(as.integer(draft_year))]
  pred[, name_key := normalize_name(player)]

  picks <- read_csv_optional(file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv"))
  if (nrow(picks) && all(c("player", "draft_year", "college") %in% names(picks))) {
    picks[, draft_year := suppressWarnings(as.integer(draft_year))]
    picks[, name_key := normalize_name(player)]
    picks <- picks[nzchar(name_key), .(
      pick_college = as.character(college),
      actual_pick = suppressWarnings(as.numeric(pick_overall))
    ), by = .(draft_year, name_key)]
    setorder(picks, draft_year, name_key, actual_pick, na.last = TRUE)
    picks <- unique(picks, by = c("draft_year", "name_key"))
    pred <- merge(pred, picks, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  } else {
    pred[, `:=`(pick_college = NA_character_, actual_pick = NA_real_)]
  }

  template_teams <- load_template_year_teams(workbook_path)
  if (nrow(template_teams)) {
    pred <- merge(pred, template_teams, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  } else {
    pred[, template_team := NA_character_]
  }

  for (col in c("source_team", "pre_draft_team", "prediction_pool")) {
    if (!col %in% names(pred)) pred[, (col) := NA_character_]
  }

  pred[, team_for_sos := coalesce_character(pick_college, template_team, source_team, pre_draft_team)]
  pred[, team_source := fifelse(nzchar(trimws(as.character(pick_college))), "draft_picks_college",
    fifelse(nzchar(trimws(as.character(template_team))), "draft_template_year_sheet",
      fifelse(nzchar(trimws(as.character(source_team))), "source_team", "pre_draft_team")
    )
  )]
  pred[, team_key := normalize_college_key(team_for_sos)]
  pred[, is_non_college_pool := !is.na(prediction_pool) & tolower(trimws(as.character(prediction_pool))) == "no_college"]
  pred[, is_intl_label := is_non_college_pool | grepl("int'l|international|g league|overtime|ignite|france|germany|serbia|china|australia|spain|turkey|croatia|israel|italy|slovenia|lithuania|new zealand|madrid|olympiacos|cedevita|orthez|movistar|ratiopharm|besiktas|boulogne|perth|cairns", team_for_sos, ignore.case = TRUE)]
  pred[is.na(is_intl_label), is_intl_label := FALSE]
  pred[, .(
    player = as.character(player),
    draft_year,
    name_key,
    team_key,
    team_for_sos,
    team_source,
    prediction_pool = as.character(prediction_pool),
    is_non_college_pool,
    is_intl_label
  )]
}

add_fuzzy_suggestions <- function(audit_dt, sos_dt) {
  unmatched <- audit_dt[!sos_matched & nzchar(team_key) & !is_intl_label]
  if (!nrow(unmatched)) {
    audit_dt[, `:=`(suggested_school = NA_character_, suggested_distance = NA_real_)]
    return(audit_dt)
  }

  suggestions <- unmatched[, {
    schools <- sos_dt[year == .BY$draft_year]
    if (!nrow(schools)) {
      .(suggested_school = NA_character_, suggested_distance = NA_real_)
    } else {
      d <- utils::adist(team_key[1], schools$school_key, ignore.case = TRUE)[1, ]
      best_idx <- which.min(d)
      .(suggested_school = schools$school[best_idx], suggested_distance = as.numeric(d[best_idx]))
    }
  }, by = .(draft_year, name_key)]

  audit_dt <- merge(audit_dt, suggestions, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  audit_dt[]
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

workbook_path <- Sys.getenv(
  "DRAFT_TEMPLATE_WORKBOOK",
  file.path(base_dir, "ref", "oldfrontend", "Draft Templates v19.xlsx")
)
source_mode <- tolower(trimws(Sys.getenv("DRAFT_SOS_SOURCE", "template")))
default_years <- 2016:as.integer(format(Sys.Date(), "%Y"))
years <- parse_years(Sys.getenv("DRAFT_SOS_YEARS", ""), default_years)

sos_dt <- switch(
  source_mode,
  sports_reference = pull_sports_reference_sos(years),
  template = load_template_sos(workbook_path),
  auto = {
    template_dt <- load_template_sos(workbook_path)
    missing_years <- setdiff(years, unique(template_dt$year))
    if (length(missing_years)) {
      pulled_dt <- pull_sports_reference_sos(missing_years)
      rbindlist(list(template_dt, pulled_dt), use.names = TRUE, fill = TRUE)
    } else {
      template_dt
    }
  },
  stop("DRAFT_SOS_SOURCE must be template, sports_reference, or auto.")
)

sos_dt <- unique(sos_dt[is.finite(year) & is.finite(sos)], by = c("year", "school_key"))
prospects <- make_prospect_team_panel(base_dir, workbook_path)

audit <- merge(
  prospects,
  sos_dt[, .(draft_year = year, team_key = school_key, matched_school = school, school_srs = srs, school_sos = sos, sos_source = source)],
  by = c("draft_year", "team_key"),
  all.x = TRUE,
  sort = FALSE
)
audit[, sos_matched := is.finite(school_sos)]
audit <- add_fuzzy_suggestions(audit, sos_dt)
setorder(audit, draft_year, player)

features <- audit[, .(
  player,
  draft_year,
  team_for_sos,
  team_source,
  matched_school,
  school_sos,
  school_srs,
  sos_source,
  sos_matched,
  is_non_college_pool,
  is_intl_label
)]

fwrite(sos_dt, file.path(draft_dir, "college_sos_reference.csv"), na = "")
fwrite(features, file.path(draft_dir, "draft_prediction_sos_features.csv"), na = "")
fwrite(audit, file.path(draft_dir, "draft_prediction_sos_match_audit.csv"), na = "")

message("Wrote college SOS reference -> ", file.path(draft_dir, "college_sos_reference.csv"))
message("Wrote prospect SOS features -> ", file.path(draft_dir, "draft_prediction_sos_features.csv"))
message("Wrote SOS match audit -> ", file.path(draft_dir, "draft_prediction_sos_match_audit.csv"))
message(
  "Matched college SOS rows: ",
  audit[sos_matched == TRUE, .N],
  " / ",
  audit[is_intl_label == FALSE, .N],
  " non-international-labeled prospects"
)
