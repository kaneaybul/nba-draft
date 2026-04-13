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

clean_money <- function(x) {
  suppressWarnings(as.numeric(gsub("[^0-9.-]", "", as.character(x))))
}

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}

normalize_team <- function(x) {
  out <- toupper(trimws(as.character(x)))
  map <- c(CHO = "CHA", BRK = "BKN", PHO = "PHX", NOK = "NOP", NOH = "NOP", NJN = "BKN")
  ifelse(out %in% names(map), unname(map[out]), out)
}

fetch_contracts <- function() {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull Basketball-Reference contracts.")
  }
  url <- "https://www.basketball-reference.com/contracts/players.html"
  page <- rvest::read_html(url)
  tables <- rvest::html_table(rvest::html_elements(page, "table"), fill = TRUE)
  if (length(tables) == 0) {
    stop("No contract table found at ", url)
  }

  raw <- as.data.frame(tables[[1]], stringsAsFactors = FALSE, check.names = FALSE)
  header <- as.character(raw[1, ])
  contracts <- raw[-1, , drop = FALSE]
  names(contracts) <- make.names(header, unique = TRUE)
  contracts <- contracts[contracts$Rk != "Rk" & nzchar(contracts$Player), , drop = FALSE]

  salary_cols <- grep("^X?20[0-9]{2}", names(contracts), value = TRUE)
  if (length(salary_cols) < 1) {
    salary_cols <- names(contracts)[4:min(8, ncol(contracts))]
  }
  salary_cols <- salary_cols[seq_len(min(5, length(salary_cols)))]

  out <- data.frame(
    rank = suppressWarnings(as.integer(contracts$Rk)),
    player_name = iconv(contracts$Player, from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(contracts$Tm),
    stringsAsFactors = FALSE
  )
  for (i in seq_along(salary_cols)) {
    out[[paste0("salary_y", i - 1)]] <- clean_money(contracts[[salary_cols[i]]])
  }
  for (i in length(salary_cols) + 1:5) {
    if (i <= 5) out[[paste0("salary_y", i - 1)]] <- NA_real_
  }
  guaranteed_col <- grep("Guaranteed", names(contracts), value = TRUE)
  out$guaranteed <- if (length(guaranteed_col) > 0) clean_money(contracts[[guaranteed_col[1]]]) else NA_real_
  out$source <- url
  out
}

attach_nba_ids <- function(base_dir, contracts) {
  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  contracts$nba_id <- NA_integer_
  contracts$match_method <- "unmatched"
  if (!file.exists(stats_path)) {
    return(contracts)
  }

  stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
  required <- c("nba_id", "player_name", "year", "TeamAbbreviation")
  if (!all(required %in% names(stats))) {
    return(contracts)
  }

  latest_year <- max(stats$year, na.rm = TRUE)
  players <- stats[stats$year == latest_year, required, drop = FALSE]
  players$name_key <- normalize_name(players$player_name)
  players$team_key <- normalize_team(players$TeamAbbreviation)
  players <- players[!duplicated(paste(players$name_key, players$team_key)), ]

  contracts$name_key <- normalize_name(contracts$player_name)
  contracts$team_key <- normalize_team(contracts$team)

  for (i in seq_len(nrow(contracts))) {
    exact <- players[players$name_key == contracts$name_key[i] & players$team_key == contracts$team_key[i], , drop = FALSE]
    if (nrow(exact) == 1) {
      contracts$nba_id[i] <- exact$nba_id
      contracts$match_method[i] <- "name_team"
      next
    }
    by_name <- players[players$name_key == contracts$name_key[i], , drop = FALSE]
    if (nrow(by_name) == 1) {
      contracts$nba_id[i] <- by_name$nba_id
      contracts$match_method[i] <- "unique_name"
    }
  }

  contracts$name_key <- NULL
  contracts$team_key <- NULL
  contracts
}

base_dir <- resolve_base_dir()
out_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "contracts_2026_current.csv")
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)

contracts <- tryCatch(
  fetch_contracts(),
  error = function(e) {
    if (file.exists(out_path)) {
      warning("Could not refresh contracts; keeping existing file. Error: ", conditionMessage(e))
      return(NULL)
    }
    stop(e)
  }
)

if (!is.null(contracts)) {
  contracts <- attach_nba_ids(base_dir, contracts)
  contracts <- contracts[, c(
    "rank", "nba_id", "player_name", "team",
    "salary_y0", "salary_y1", "salary_y2", "salary_y3", "salary_y4",
    "guaranteed", "match_method", "source"
  )]
  write.csv(contracts, out_path, row.names = FALSE, na = "")
  message("Contract data written: ", out_path)
  message("Rows: ", nrow(contracts), "; matched NBA IDs: ", sum(!is.na(contracts$nba_id)))
}
