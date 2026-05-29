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
  candidates <- unique(c(getwd(), file.path(script_dir, "..", ".."), file.path(getwd(), ".."), file.path(getwd(), "..", "..")))
  for (candidate in candidates) {
    candidate <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate, "raw")) && dir.exists(file.path(candidate, "script"))) return(candidate)
  }
  stop("Could not resolve project root.")
}

clean_player <- function(x) {
  x <- gsub("\\*", "", as.character(x))
  trimws(iconv(x, from = "", to = "ASCII//TRANSLIT"))
}

normalize_name <- function(x) {
  x <- clean_player(x)
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  gsub("[^a-z0-9]+", "", x)
}

fetch_year <- function(year) {
  if (!requireNamespace("rvest", quietly = TRUE)) stop("Package 'rvest' is required.")
  if (!requireNamespace("xml2", quietly = TRUE)) stop("Package 'xml2' is required.")

  url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%s_per_game.html", year)
  page <- rvest::read_html(url)
  table_node <- rvest::html_element(page, "table#per_game_stats")
  if (is.na(table_node)) stop("Could not find per-game table for ", year)

  rows <- rvest::html_elements(table_node, "tbody tr")
  out <- lapply(rows, function(row) {
    cell <- rvest::html_element(row, xpath = ".//*[@data-stat='name_display']")
    if (length(cell) == 0 || is.na(rvest::html_text2(cell)) || !nzchar(rvest::html_text2(cell))) return(NULL)
    link <- rvest::html_element(cell, "a")
    data.frame(
      year = year,
      bref_id = {
        append_csv <- rvest::html_attr(cell, "data-append-csv")
        if (!is.na(append_csv) && nzchar(append_csv)) append_csv else ifelse(length(link) > 0, sub(".*/players/[a-z]/([^./]+).*", "\\1", rvest::html_attr(link, "href")), NA_character_)
      },
      player_name = clean_player(rvest::html_text2(cell)),
      pos = rvest::html_text2(rvest::html_element(row, "td[data-stat='pos']")),
      age = suppressWarnings(as.numeric(rvest::html_text2(rvest::html_element(row, "td[data-stat='age']")))),
      team = rvest::html_text2(rvest::html_element(row, "td[data-stat='team_name_abbr']")),
      games = suppressWarnings(as.numeric(rvest::html_text2(rvest::html_element(row, "td[data-stat='games']")))),
      games_started = suppressWarnings(as.numeric(rvest::html_text2(rvest::html_element(row, "td[data-stat='games_started']")))),
      mpg = suppressWarnings(as.numeric(rvest::html_text2(rvest::html_element(row, "td[data-stat='mp_per_g']")))),
      source = url,
      stringsAsFactors = FALSE
    )
  })
  raw <- do.call(rbind, out[!vapply(out, is.null, logical(1))])
  raw$minutes <- raw$games * raw$mpg

  raw$player_key <- ifelse(!is.na(raw$bref_id) & nzchar(raw$bref_id), raw$bref_id, normalize_name(raw$player_name))
  raw <- raw[order(raw$player_key, raw$team != "TOT", -raw$minutes), ]
  raw <- raw[!duplicated(raw$player_key), ]
  raw
}

infer_years <- function(base_dir) {
  env_years <- trimws(Sys.getenv("BREF_PLAYER_SEASONS_YEARS", ""))
  if (nzchar(env_years)) {
    years <- suppressWarnings(as.integer(trimws(unlist(strsplit(env_years, ",")))))
    years <- years[is.finite(years)]
    if (length(years) > 0) return(sort(unique(years)))
  }

  epm_dir <- file.path(base_dir, "raw", "epm")
  epm_files <- list.files(epm_dir, pattern = "^epm\\d{2}\\.csv$", full.names = FALSE)
  epm_years <- suppressWarnings(as.integer(paste0("20", sub("^epm(\\d{2})\\.csv$", "\\1", epm_files))))
  epm_years <- epm_years[is.finite(epm_years)]
  if (length(epm_years) == 0) return(2016:2025)
  seq.int(min(2016L, min(epm_years)), max(epm_years))
}

base_dir <- resolve_base_dir()
out_path <- file.path(base_dir, "raw", "bref_player_seasons.csv")
cache_dir <- file.path(base_dir, "raw", "bref_player_seasons_by_year")
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)
dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

years <- infer_years(base_dir)
seasons <- do.call(rbind, lapply(years, function(year) {
  cache_path <- file.path(cache_dir, paste0("bref_player_seasons_", year, ".csv"))
  if (file.exists(cache_path)) {
    message("Using cached Basketball-Reference ", year)
    return(read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE))
  }
  message("Fetching Basketball-Reference ", year)
  out <- tryCatch(fetch_year(year), error = function(e) {
    if (file.exists(cache_path)) return(read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE))
    stop(e)
  })
  write.csv(out, cache_path, row.names = FALSE, na = "")
  Sys.sleep(2)
  out
}))

write.csv(seasons, out_path, row.names = FALSE, na = "")
message("Basketball-Reference player seasons written: ", out_path)
message("Rows: ", nrow(seasons))
