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

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}

normalize_team <- function(x) {
  out <- toupper(trimws(as.character(x)))
  map <- c(
    CHO = "CHA", BRK = "BKN", PHO = "PHX", NOK = "NOP", NOH = "NOP", NJN = "BKN",
    "ATLANTA HAWKS" = "ATL", "BOSTON CELTICS" = "BOS", "BROOKLYN NETS" = "BKN",
    "CHARLOTTE HORNETS" = "CHA", "CHICAGO BULLS" = "CHI", "CLEVELAND CAVALIERS" = "CLE",
    "DALLAS MAVERICKS" = "DAL", "DENVER NUGGETS" = "DEN", "DETROIT PISTONS" = "DET",
    "GOLDEN STATE WARRIORS" = "GSW", "HOUSTON ROCKETS" = "HOU", "INDIANA PACERS" = "IND",
    "LA CLIPPERS" = "LAC", "LOS ANGELES CLIPPERS" = "LAC", "LOS ANGELES LAKERS" = "LAL",
    "MEMPHIS GRIZZLIES" = "MEM", "MIAMI HEAT" = "MIA", "MILWAUKEE BUCKS" = "MIL",
    "MINNESOTA TIMBERWOLVES" = "MIN", "NEW ORLEANS PELICANS" = "NOP", "NEW YORK KNICKS" = "NYK",
    "OKLAHOMA CITY THUNDER" = "OKC", "ORLANDO MAGIC" = "ORL", "PHILADELPHIA 76ERS" = "PHI",
    "PHILADELPHIA SIXERS" = "PHI", "PHOENIX SUNS" = "PHX", "PORTLAND TRAIL BLAZERS" = "POR",
    "SACRAMENTO KINGS" = "SAC", "SAN ANTONIO SPURS" = "SAS", "TORONTO RAPTORS" = "TOR",
    "UTAH JAZZ" = "UTA", "WASHINGTON WIZARDS" = "WAS"
  )
  out <- ifelse(out %in% names(map), unname(map[out]), out)
  ifelse(is.na(out) | !nzchar(out), "FA", out)
}

nba_team_abbrs <- function() {
  c("ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS")
}

browser_headers <- function(referer = "https://www.nba.com/") {
  httr::add_headers(
    `User-Agent` = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
    `Accept-Language` = "en-US,en;q=0.9",
    Referer = referer
  )
}

read_url_text <- function(url, referer = "https://www.nba.com/", timeout_seconds = 30) {
  if (!requireNamespace("httr", quietly = TRUE)) {
    stop("Package 'httr' is required to pull roster truth.")
  }
  response <- httr::GET(url, browser_headers(referer), httr::timeout(timeout_seconds))
  if (httr::http_error(response)) {
    stop("HTTP ", httr::status_code(response), " for ", url)
  }
  httr::content(response, as = "text", encoding = "UTF-8")
}

infer_roster_year <- function(base_dir) {
  env_year <- suppressWarnings(as.integer(Sys.getenv("CURRENT_ROSTER_YEAR", unset = "")))
  if (is.finite(env_year)) return(env_year)

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    if ("year" %in% names(stats)) {
      year <- suppressWarnings(max(as.integer(stats$year), na.rm = TRUE))
      if (is.finite(year)) return(year)
    }
  }

  today <- Sys.Date()
  calendar_year <- as.integer(format(today, "%Y"))
  month <- as.integer(format(today, "%m"))
  ifelse(month >= 7, calendar_year + 1L, calendar_year)
}

fetch_nba_player_index <- function(season_label) {
  if (!requireNamespace("httr", quietly = TRUE)) {
    stop("Package 'httr' is required to pull NBA.com roster truth.")
  }
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package 'jsonlite' is required to pull NBA.com roster truth.")
  }

  url <- "https://stats.nba.com/stats/playerindex"
  response <- httr::GET(
    url,
    query = list(
      Active = "",
      AllStar = "",
      College = "",
      Country = "",
      DraftPick = "",
      DraftRound = "",
      DraftYear = "",
      Height = "",
      Historical = "0",
      LeagueID = "00",
      Season = season_label,
      TeamID = "0",
      Weight = ""
    ),
    httr::add_headers(
      `User-Agent` = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      Accept = "application/json, text/plain, */*",
      Origin = "https://www.nba.com",
      Referer = "https://www.nba.com/"
    ),
    httr::timeout(30)
  )
  if (httr::http_error(response)) {
    stop("NBA Stats playerindex returned HTTP ", httr::status_code(response))
  }

  payload <- jsonlite::fromJSON(httr::content(response, as = "text", encoding = "UTF-8"), simplifyVector = FALSE)
  result_sets <- payload$resultSets
  if (is.null(result_sets)) result_sets <- payload$resultSet
  if (is.null(result_sets) || !length(result_sets)) {
    stop("NBA Stats playerindex returned no result sets.")
  }
  result <- result_sets[[1]]
  headers <- unlist(result$headers)
  rows <- result$rowSet
  if (!length(headers) || !length(rows)) {
    stop("NBA Stats playerindex returned an empty roster.")
  }
  roster <- as.data.frame(do.call(rbind, rows), stringsAsFactors = FALSE, check.names = FALSE)
  names(roster) <- headers

  needed <- c("PERSON_ID", "PLAYER_FIRST_NAME", "PLAYER_LAST_NAME", "TEAM_ABBREVIATION")
  if (!all(needed %in% names(roster))) {
    stop("NBA Stats playerindex did not contain expected columns: ", paste(needed, collapse = ", "))
  }

  player_name <- trimws(paste(roster$PLAYER_FIRST_NAME, roster$PLAYER_LAST_NAME))
  data.frame(
    nba_id = suppressWarnings(as.integer(roster$PERSON_ID)),
    player_name = iconv(player_name, from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(roster$TEAM_ABBREVIATION),
    roster_source = "NBA.com stats playerindex",
    stringsAsFactors = FALSE
  )
}

first_existing_col <- function(df, candidates) {
  hit <- candidates[candidates %in% names(df)]
  if (length(hit)) hit[[1]] else NA_character_
}

fetch_active_players_json <- function() {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package 'jsonlite' is required to pull NBA.com roster truth.")
  }
  url <- "https://www.nba.com/players/active_players.json"
  raw <- jsonlite::fromJSON(read_url_text(url), flatten = TRUE)
  if (is.data.frame(raw)) {
    players <- raw
  } else if (is.list(raw) && !is.null(raw$league$standard)) {
    players <- as.data.frame(raw$league$standard, stringsAsFactors = FALSE, check.names = FALSE)
  } else if (is.list(raw) && !is.null(raw$players)) {
    players <- as.data.frame(raw$players, stringsAsFactors = FALSE, check.names = FALSE)
  } else {
    stop("NBA.com active_players.json had an unexpected shape.")
  }

  id_col <- first_existing_col(players, c("personId", "person_id", "playerId", "player_id", "nba_id"))
  first_col <- first_existing_col(players, c("firstName", "first_name", "PLAYER_FIRST_NAME"))
  last_col <- first_existing_col(players, c("lastName", "last_name", "PLAYER_LAST_NAME"))
  display_col <- first_existing_col(players, c("displayName", "fullName", "playerName", "DISPLAY_FIRST_LAST"))
  team_col <- first_existing_col(players, c("teamAbbreviation", "teamTricode", "team_abbreviation", "TEAM_ABBREVIATION", "team"))
  if (is.na(id_col) || is.na(team_col) || (is.na(display_col) && (is.na(first_col) || is.na(last_col)))) {
    stop("NBA.com active_players.json did not contain recognizable player/team columns.")
  }

  player_name <- if (!is.na(display_col)) {
    as.character(players[[display_col]])
  } else {
    trimws(paste(players[[first_col]], players[[last_col]]))
  }
  data.frame(
    nba_id = suppressWarnings(as.integer(players[[id_col]])),
    player_name = iconv(player_name, from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(players[[team_col]]),
    roster_source = "NBA.com active_players.json",
    stringsAsFactors = FALSE
  )
}

espn_name_to_display <- function(x) {
  x <- trimws(as.character(x))
  has_comma <- grepl(",", x, fixed = TRUE)
  out <- x
  parts <- strsplit(x[has_comma], ",", fixed = TRUE)
  out[has_comma] <- vapply(parts, function(part) {
    paste(trimws(part[-1]), trimws(part[[1]]))
  }, character(1))
  iconv(out, from = "", to = "ASCII//TRANSLIT")
}

fetch_espn_roster_fallback <- function() {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull ESPN roster fallback.")
  }
  positions <- c("pg", "sg", "sf", "pf", "c")
  rows <- lapply(positions, function(position) {
    url <- paste0("https://www.espn.com/nba/players/_/position/", position)
    page <- rvest::read_html(read_url_text(url, "https://www.espn.com/"))
    tables <- rvest::html_table(rvest::html_elements(page, "table"), fill = TRUE)
    tables <- lapply(tables, as.data.frame, stringsAsFactors = FALSE, check.names = FALSE)
    tables <- tables[vapply(tables, function(tab) all(c("NAME", "TEAM") %in% names(tab)), logical(1))]
    if (!length(tables)) return(NULL)
    out <- do.call(rbind, tables)
    out <- out[nzchar(trimws(out$NAME)) & nzchar(trimws(out$TEAM)), , drop = FALSE]
    data.frame(
      nba_id = NA_integer_,
      player_name = espn_name_to_display(out$NAME),
      team = normalize_team(out$TEAM),
      roster_source = "ESPN roster fallback after NBA.com timeout",
      stringsAsFactors = FALSE
    )
  })
  roster <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(roster) || !nrow(roster)) {
    stop("ESPN roster fallback returned no rows.")
  }
  roster <- roster[roster$team %in% nba_team_abbrs(), , drop = FALSE]
  roster[!duplicated(normalize_name(roster$player_name)), , drop = FALSE]
}

fetch_realgm_roster_fallback <- function() {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull RealGM roster fallback.")
  }
  teams <- data.frame(
    team = nba_team_abbrs(),
    realgm_id = seq_len(30),
    stringsAsFactors = FALSE
  )
  rows <- lapply(seq_len(nrow(teams)), function(i) {
    url <- paste0("https://basketball.realgm.com/nba/teams/nba/", teams$realgm_id[[i]], "/rosters")
    page <- rvest::read_html(read_url_text(url, "https://basketball.realgm.com/"))
    tables <- rvest::html_table(rvest::html_elements(page, "table"), fill = TRUE)
    tables <- lapply(tables, as.data.frame, stringsAsFactors = FALSE, check.names = FALSE)
    roster_table <- NULL
    for (tab in tables) {
      if ("Player" %in% names(tab) && "Pos" %in% names(tab)) {
        roster_table <- tab
        break
      }
    }
    if (is.null(roster_table) || !nrow(roster_table)) return(NULL)
    player_name <- iconv(trimws(as.character(roster_table$Player)), from = "", to = "ASCII//TRANSLIT")
    player_name <- gsub("\\s+", " ", player_name)
    data.frame(
      nba_id = NA_integer_,
      player_name = player_name,
      team = teams$team[[i]],
      roster_source = "RealGM current roster fallback after NBA.com timeout",
      stringsAsFactors = FALSE
    )
  })
  roster <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(roster) || !nrow(roster)) {
    stop("RealGM roster fallback returned no rows.")
  }
  roster <- roster[nzchar(normalize_name(roster$player_name)), , drop = FALSE]
  roster[!duplicated(paste(normalize_name(roster$player_name), roster$team)), , drop = FALSE]
}

load_manual_roster_overrides <- function(base_dir, roster_year) {
  path <- file.path(base_dir, "ref", paste0("current_roster_overrides_", roster_year, ".csv"))
  if (!file.exists(path)) {
    return(data.frame(nba_id = integer(), player_name = character(), team = character(), roster_source = character(), stringsAsFactors = FALSE))
  }
  overrides <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!("player_name" %in% names(overrides)) || !("team" %in% names(overrides))) {
    stop("Manual roster overrides require player_name and team columns: ", path)
  }
  if (!("nba_id" %in% names(overrides))) overrides$nba_id <- NA_integer_
  if (!("year" %in% names(overrides))) overrides$year <- roster_year
  if (!("roster_source" %in% names(overrides))) overrides$roster_source <- "manual roster override"
  overrides <- overrides[suppressWarnings(as.integer(overrides$year)) == roster_year, , drop = FALSE]
  data.frame(
    nba_id = suppressWarnings(as.integer(overrides$nba_id)),
    player_name = iconv(as.character(overrides$player_name), from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(overrides$team),
    roster_source = as.character(overrides$roster_source),
    stringsAsFactors = FALSE
  )
}

apply_manual_roster_overrides <- function(roster, base_dir, roster_year) {
  overrides <- load_manual_roster_overrides(base_dir, roster_year)
  if (!nrow(overrides)) return(roster)
  roster$name_key <- normalize_name(roster$player_name)
  overrides$name_key <- normalize_name(overrides$player_name)
  for (i in seq_len(nrow(overrides))) {
    idx <- if (!is.na(overrides$nba_id[[i]])) {
      which(suppressWarnings(as.integer(roster$nba_id)) == overrides$nba_id[[i]])
    } else {
      integer()
    }
    if (!length(idx)) idx <- which(roster$name_key == overrides$name_key[[i]])
    if (length(idx)) {
      roster$team[idx] <- overrides$team[[i]]
      roster$roster_source[idx] <- overrides$roster_source[[i]]
    } else {
      roster <- rbind(roster, overrides[i, names(roster), drop = FALSE])
    }
  }
  roster$name_key <- NULL
  roster
}

build_local_roster_seed <- function(base_dir, roster_year, partial_roster = data.frame()) {
  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (!file.exists(stats_path)) {
    stop("Cannot build local roster seed without ", stats_path)
  }
  stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
  required <- c("nba_id", "player_name", "year", "TeamAbbreviation")
  if (!all(required %in% names(stats))) {
    stop("Local roster seed requires columns in raw/databallr_stats.csv: ", paste(required, collapse = ", "))
  }
  latest <- stats[suppressWarnings(as.integer(stats$year)) == roster_year, required, drop = FALSE]
  if (!nrow(latest)) {
    stop("No local databallr rows found for roster year ", roster_year)
  }
  latest <- latest[order(suppressWarnings(as.integer(latest$nba_id)), latest$player_name), , drop = FALSE]
  latest <- latest[!duplicated(suppressWarnings(as.integer(latest$nba_id))), , drop = FALSE]
  roster <- data.frame(
    nba_id = suppressWarnings(as.integer(latest$nba_id)),
    player_name = iconv(as.character(latest$player_name), from = "", to = "ASCII//TRANSLIT"),
    team = normalize_team(latest$TeamAbbreviation),
    roster_source = "local databallr roster seed after NBA.com timeout",
    stringsAsFactors = FALSE
  )
  if (nrow(partial_roster)) {
    roster$name_key <- normalize_name(roster$player_name)
    partial_roster$name_key <- normalize_name(partial_roster$player_name)
    for (i in seq_len(nrow(partial_roster))) {
      idx <- if (!is.na(partial_roster$nba_id[[i]])) which(roster$nba_id == partial_roster$nba_id[[i]]) else integer()
      if (!length(idx)) idx <- which(roster$name_key == partial_roster$name_key[[i]])
      if (length(idx)) {
        roster$team[idx] <- partial_roster$team[[i]]
        roster$roster_source[idx] <- paste0(partial_roster$roster_source[[i]], " partial correction")
      } else {
        roster <- rbind(roster, partial_roster[i, names(roster), drop = FALSE])
      }
    }
    roster$name_key <- NULL
  }
  roster
}

fetch_nba_roster_page <- function() {
  if (!requireNamespace("rvest", quietly = TRUE)) {
    stop("Package 'rvest' is required to pull NBA.com roster truth.")
  }
  if (!requireNamespace("xml2", quietly = TRUE)) {
    stop("Package 'xml2' is required to pull NBA.com roster truth.")
  }

  url <- "https://www.nba.com/players?os=v"
  page <- rvest::read_html(url)
  tables <- rvest::html_table(rvest::html_elements(page, "table"), fill = TRUE)
  if (!length(tables)) {
    stop("No roster table found at ", url)
  }

  roster <- as.data.frame(tables[[1]], stringsAsFactors = FALSE, check.names = FALSE)
  needed <- c("Player", "Team")
  if (!all(needed %in% names(roster))) {
    stop("NBA.com roster table did not contain expected columns: ", paste(needed, collapse = ", "))
  }

  links <- rvest::html_elements(page, "a[href*='/player/']")
  hrefs <- rvest::html_attr(links, "href")
  link_text <- trimws(rvest::html_text2(links))
  ids <- suppressWarnings(as.integer(sub(".*/player/([0-9]+).*", "\\1", hrefs)))
  link_map <- data.frame(
    name_key = normalize_name(link_text),
    nba_id = ids,
    stringsAsFactors = FALSE
  )
  link_map <- link_map[is.finite(link_map$nba_id) & nzchar(link_map$name_key), , drop = FALSE]
  link_map <- link_map[!duplicated(link_map$name_key), , drop = FALSE]

  roster$player_name <- iconv(trimws(as.character(roster$Player)), from = "", to = "ASCII//TRANSLIT")
  roster$name_key <- normalize_name(roster$player_name)
  roster$team <- normalize_team(roster$Team)
  roster$nba_id <- link_map$nba_id[match(roster$name_key, link_map$name_key)]
  roster <- roster[nzchar(roster$name_key), , drop = FALSE]
  roster <- roster[!duplicated(ifelse(is.na(roster$nba_id), paste0("name:", roster$name_key), paste0("id:", roster$nba_id))), ]
  data.frame(
    nba_id = suppressWarnings(as.integer(roster$nba_id)),
    player_name = roster$player_name,
    team = roster$team,
    roster_source = "NBA.com league roster",
    stringsAsFactors = FALSE
  )
}

base_dir <- resolve_base_dir()
roster_year <- infer_roster_year(base_dir)
out_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", paste0("current_rosters_", roster_year, ".csv"))
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)

season_label <- paste0(roster_year - 1L, "-", substr(roster_year, 3, 4))
roster <- tryCatch(
  {
    api_roster <- fetch_nba_player_index(season_label)
    if (nrow(api_roster) < 400) {
      stop("NBA Stats playerindex returned only ", nrow(api_roster), " rows.")
    }
    api_roster
  },
  error = function(e) {
    warning("NBA Stats playerindex failed; trying NBA.com active players JSON. Error: ", conditionMessage(e))
    active_roster <- tryCatch(fetch_active_players_json(), error = function(active_error) {
      warning("NBA.com active players JSON failed; trying ESPN active roster fallback. Error: ", conditionMessage(active_error))
      tryCatch(fetch_espn_roster_fallback(), error = function(espn_error) {
        warning("ESPN roster fallback failed; trying RealGM roster fallback. Error: ", conditionMessage(espn_error))
        tryCatch(fetch_realgm_roster_fallback(), error = function(realgm_error) {
          warning("RealGM roster fallback failed; trying roster page. Error: ", conditionMessage(realgm_error))
          fetch_nba_roster_page()
        })
      })
    })
    min_rows <- if (any(grepl("RealGM", active_roster$roster_source))) 300 else 400
    if (nrow(active_roster) < min_rows) {
      if (file.exists(out_path)) {
        existing <- tryCatch(read.csv(out_path, stringsAsFactors = FALSE, check.names = FALSE), error = function(existing_error) data.frame())
        if (nrow(existing) >= 400) {
          warning("Could not refresh complete NBA.com roster truth; keeping existing complete file. Fallback rows: ", nrow(active_roster))
          return(NULL)
        }
      }
      warning("Roster fallback returned only ", nrow(active_roster), " rows; building local seed with partial/override corrections.")
      active_roster <- build_local_roster_seed(base_dir, roster_year, active_roster)
    }
    active_roster
  }
)

if (!is.null(roster)) {
  roster <- apply_manual_roster_overrides(roster, base_dir, roster_year)
  roster$name_key <- normalize_name(roster$player_name)
  roster <- roster[nzchar(roster$name_key), , drop = FALSE]
  roster <- roster[!duplicated(ifelse(is.na(roster$nba_id), paste0("name:", roster$name_key), paste0("id:", roster$nba_id))), ]
  pulled_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  out <- data.frame(
    nba_id = suppressWarnings(as.integer(roster$nba_id)),
    player_name = roster$player_name,
    team = roster$team,
    roster_source = roster$roster_source,
    pulled_at = pulled_at,
    stringsAsFactors = FALSE
  )
  out <- out[order(out$team == "FA", out$team, out$player_name), , drop = FALSE]
  write.csv(out, out_path, row.names = FALSE, na = "")
  message("Roster truth written: ", out_path)
  message("Rows: ", nrow(out), "; active-team rows: ", sum(out$team != "FA"), "; free-agent/unassigned rows: ", sum(out$team == "FA"))
}
