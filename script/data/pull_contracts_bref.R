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

infer_contract_year <- function(base_dir) {
  env_year <- suppressWarnings(as.integer(Sys.getenv("DATABALLR_END_YEAR", "")))
  if (!is.na(env_year)) {
    return(env_year)
  }

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    if ("year" %in% names(stats)) {
      stats_year <- suppressWarnings(max(as.integer(stats$year), na.rm = TRUE))
      if (is.finite(stats_year)) {
        return(stats_year)
      }
    }
  }

  today <- Sys.Date()
  calendar_year <- as.integer(format(today, "%Y"))
  month <- as.integer(format(today, "%m"))
  ifelse(month >= 7, calendar_year + 1L, calendar_year)
}

fetch_contracts <- function() {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull Basketball-Reference contracts.")
  }
  if (!requireNamespace("xml2", quietly = TRUE)) {
    stop("Package 'xml2' is required to pull Basketball-Reference contracts.")
  }
  url <- "https://www.basketball-reference.com/contracts/players.html"
  html_path <- Sys.getenv("BREF_CONTRACTS_HTML", unset = "")
  page <- if (nzchar(html_path) && file.exists(html_path)) {
    rvest::read_html(html_path)
  } else {
    rvest::read_html(url)
  }
  table <- rvest::html_element(page, "table#player-contracts")
  if (length(table) == 0 || is.na(xml2::xml_name(table))) {
    stop("No contract table found at ", url)
  }

  salary_nodes <- xml2::xml_find_all(table, ".//thead/tr[last()]/th[starts-with(@data-stat, 'y')]")
  salary_stats <- xml2::xml_attr(salary_nodes, "data-stat")
  salary_stats <- salary_stats[seq_len(min(5, length(salary_stats)))]
  if (!length(salary_stats)) {
    stop("No salary year columns found at ", url)
  }

  rows <- xml2::xml_find_all(table, ".//tbody/tr[td[@data-stat='player']]")
  if (!length(rows)) {
    stop("No player rows found at ", url)
  }

  cell_value <- function(row, stat) {
    node <- xml2::xml_find_first(row, paste0(".//*[@data-stat='", stat, "']"))
    if (length(node) == 0 || is.na(xml2::xml_name(node))) return(NA_character_)
    value <- xml2::xml_attr(node, "csk")
    if (is.na(value) || !nzchar(value)) value <- rvest::html_text2(node)
    value
  }
  cell_class <- function(row, stat) {
    node <- xml2::xml_find_first(row, paste0(".//*[@data-stat='", stat, "']"))
    if (length(node) == 0 || is.na(xml2::xml_name(node))) return(NA_character_)
    xml2::xml_attr(node, "class")
  }
  option_status <- function(class_name) {
    class_name <- as.character(class_name)
    if (grepl("\\bsalary-pl\\b", class_name)) return("Player Option")
    if (grepl("\\bsalary-tm\\b", class_name)) return("Team Option")
    NA_character_
  }

  out <- data.frame(
    rank = suppressWarnings(as.integer(vapply(rows, cell_value, character(1), stat = "ranker"))),
    bref_player_id = vapply(rows, function(row) {
      node <- xml2::xml_find_first(row, ".//*[@data-stat='player']")
      value <- xml2::xml_attr(node, "data-append-csv")
      ifelse(is.na(value), NA_character_, value)
    }, character(1)),
    player_name = iconv(vapply(rows, cell_value, character(1), stat = "player"), from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(vapply(rows, cell_value, character(1), stat = "team_id")),
    stringsAsFactors = FALSE
  )
  for (i in seq_along(salary_stats)) {
    out[[paste0("salary_y", i - 1)]] <- clean_money(vapply(rows, cell_value, character(1), stat = salary_stats[i]))
    out[[paste0("contract_status_y", i - 1)]] <- vapply(rows, function(row) option_status(cell_class(row, salary_stats[i])), character(1))
  }
  if (length(salary_stats) < 5) {
    for (i in (length(salary_stats) + 1):5) {
      out[[paste0("salary_y", i - 1)]] <- NA_real_
      out[[paste0("contract_status_y", i - 1)]] <- NA_character_
    }
  }
  out$guaranteed <- clean_money(vapply(rows, cell_value, character(1), stat = "remain_gtd"))
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
contract_year <- infer_contract_year(base_dir)
out_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", paste0("contracts_bref_", contract_year, "_current.csv"))
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
    "rank", "nba_id", "bref_player_id", "player_name", "team",
    "salary_y0", "salary_y1", "salary_y2", "salary_y3", "salary_y4",
    "contract_status_y0", "contract_status_y1", "contract_status_y2", "contract_status_y3", "contract_status_y4",
    "guaranteed", "match_method", "source"
  )]
  write.csv(contracts, out_path, row.names = FALSE, na = "")
  message("Contract data written: ", out_path)
  message("Rows: ", nrow(contracts), "; matched NBA IDs: ", sum(!is.na(contracts$nba_id)))
}
