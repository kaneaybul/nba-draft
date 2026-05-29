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

parse_numeric <- function(x) {
  x <- gsub(",", "", as.character(x))
  x[x == ""] <- NA_character_
  suppressWarnings(as.numeric(x))
}

cell_text <- function(row, stat) {
  node <- rvest::html_element(row, paste0("*[data-stat='", stat, "']"))
  if (length(node) == 0 || is.na(node)) return(NA_character_)
  txt <- rvest::html_text2(node)
  if (is.na(txt) || !nzchar(txt)) NA_character_ else txt
}

cell_csk_or_text_numeric <- function(row, stat, percent_display = FALSE) {
  node <- rvest::html_element(row, paste0("*[data-stat='", stat, "']"))
  if (length(node) == 0 || is.na(node)) return(NA_real_)
  csk <- rvest::html_attr(node, "csk")
  if (!is.na(csk) && nzchar(csk)) return(parse_numeric(csk))
  value <- parse_numeric(rvest::html_text2(node))
  if (isTRUE(percent_display) && is.finite(value)) value / 100 else value
}

position_entropy <- function(shares) {
  shares <- shares[is.finite(shares) & shares > 0]
  if (length(shares) == 0) return(NA_real_)
  -sum(shares * log(shares)) / log(5)
}

position_label_from_shares <- function(shares, single_threshold = 0.65, secondary_threshold = 0.20) {
  names(shares) <- c("PG", "SG", "SF", "PF", "C")
  shares[!is.finite(shares)] <- 0
  if (sum(shares) <= 0) return(NA_character_)
  ord <- order(shares, decreasing = TRUE)
  primary <- names(shares)[ord[[1]]]
  secondary <- names(shares)[ord[[2]]]
  if (shares[[ord[[1]]]] >= single_threshold || shares[[ord[[2]]]] < secondary_threshold) {
    return(primary)
  }
  paste(primary, secondary, sep = "/")
}

fetch_year <- function(year) {
  if (!requireNamespace("rvest", quietly = TRUE)) stop("Package 'rvest' is required.")
  if (!requireNamespace("xml2", quietly = TRUE)) stop("Package 'xml2' is required.")

  url <- sprintf("https://www.basketball-reference.com/leagues/NBA_%s_play-by-play.html", year)
  page <- rvest::read_html(url)
  table_node <- rvest::html_element(page, "table#pbp_stats")
  if (is.na(table_node)) stop("Could not find play-by-play table for ", year)

  rows <- rvest::html_elements(table_node, "tbody tr")
  out <- lapply(rows, function(row) {
    cell <- rvest::html_element(row, xpath = ".//*[@data-stat='name_display']")
    player <- if (length(cell) == 0 || is.na(cell)) NA_character_ else rvest::html_text2(cell)
    if (is.na(player) || !nzchar(player)) return(NULL)

    link <- rvest::html_element(cell, "a")
    row_class <- rvest::html_attr(row, "class")
    shares <- c(
      cell_csk_or_text_numeric(row, "pct_1", TRUE),
      cell_csk_or_text_numeric(row, "pct_2", TRUE),
      cell_csk_or_text_numeric(row, "pct_3", TRUE),
      cell_csk_or_text_numeric(row, "pct_4", TRUE),
      cell_csk_or_text_numeric(row, "pct_5", TRUE)
    )
    shares[!is.finite(shares)] <- 0
    share_sum <- sum(shares)
    if (share_sum > 0 && abs(share_sum - 1) > 0.05) {
      shares <- shares / share_sum
    }

    data.frame(
      year = year,
      bref_id = {
        append_csv <- rvest::html_attr(cell, "data-append-csv")
        if (!is.na(append_csv) && nzchar(append_csv)) append_csv else ifelse(length(link) > 0, sub(".*/players/[a-z]/([^./]+).*", "\\1", rvest::html_attr(link, "href")), NA_character_)
      },
      player_name = clean_player(player),
      age = cell_csk_or_text_numeric(row, "age"),
      team = cell_text(row, "team_name_abbr"),
      bref_pos = cell_text(row, "pos"),
      games = cell_csk_or_text_numeric(row, "games"),
      games_started = cell_csk_or_text_numeric(row, "games_started"),
      minutes = cell_csk_or_text_numeric(row, "mp"),
      pg_share = shares[[1]],
      sg_share = shares[[2]],
      sf_share = shares[[3]],
      pf_share = shares[[4]],
      c_share = shares[[5]],
      position_estimate = position_label_from_shares(shares),
      position_entropy = position_entropy(shares),
      position_index = sum(shares * 1:5),
      is_partial_team_row = !is.na(row_class) && grepl("partial_table", row_class),
      source = url,
      stringsAsFactors = FALSE
    )
  })

  raw <- do.call(rbind, out[!vapply(out, is.null, logical(1))])
  raw$player_key <- ifelse(!is.na(raw$bref_id) & nzchar(raw$bref_id), raw$bref_id, normalize_name(raw$player_name))
  raw$name_key <- normalize_name(raw$player_name)
  raw <- raw[order(raw$player_key, raw$is_partial_team_row, !grepl("^[0-9]+TM$", raw$team), -raw$minutes), ]
  raw <- raw[!duplicated(raw$player_key), ]
  raw[order(raw$player_name), ]
}

infer_years <- function(base_dir) {
  env_years <- trimws(Sys.getenv("BREF_POSITION_YEARS", ""))
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
out_path <- file.path(base_dir, "raw", "bref_position_estimates.csv")
cache_dir <- file.path(base_dir, "raw", "bref_position_estimates_by_year")
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)
dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)

years <- infer_years(base_dir)
seasons <- do.call(rbind, lapply(years, function(year) {
  cache_path <- file.path(cache_dir, paste0("bref_position_estimates_", year, ".csv"))
  if (file.exists(cache_path)) {
    message("Using cached Basketball-Reference position estimates ", year)
    return(read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE))
  }
  message("Fetching Basketball-Reference position estimates ", year)
  out <- tryCatch(fetch_year(year), error = function(e) {
    if (file.exists(cache_path)) return(read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE))
    stop(e)
  })
  write.csv(out, cache_path, row.names = FALSE, na = "")
  Sys.sleep(2)
  out
}))

write.csv(seasons, out_path, row.names = FALSE, na = "")
message("Basketball-Reference position estimates written: ", out_path)
message("Rows: ", nrow(seasons))
