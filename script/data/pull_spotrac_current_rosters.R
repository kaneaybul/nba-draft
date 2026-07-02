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

season_labels <- function(roster_year) {
  starts <- roster_year:(roster_year + 4L)
  paste0(starts - 1L, "-", substr(starts, 3, 4))
}

teams <- data.frame(
  team = c(
    "Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls",
    "Cleveland Cavaliers", "Dallas Mavericks", "Denver Nuggets", "Detroit Pistons",
    "Golden State Warriors", "Houston Rockets", "Indiana Pacers", "Los Angeles Clippers",
    "Los Angeles Lakers", "Memphis Grizzlies", "Miami Heat", "Milwaukee Bucks",
    "Minnesota Timberwolves", "New Orleans Pelicans", "New York Knicks", "Oklahoma City Thunder",
    "Orlando Magic", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers",
    "Sacramento Kings", "San Antonio Spurs", "Toronto Raptors", "Utah Jazz", "Washington Wizards"
  ),
  slug = c(
    "atlanta-hawks", "boston-celtics", "brooklyn-nets", "charlotte-hornets", "chicago-bulls",
    "cleveland-cavaliers", "dallas-mavericks", "denver-nuggets", "detroit-pistons",
    "golden-state-warriors", "houston-rockets", "indiana-pacers", "la-clippers",
    "los-angeles-lakers", "memphis-grizzlies", "miami-heat", "milwaukee-bucks",
    "minnesota-timberwolves", "new-orleans-pelicans", "new-york-knicks", "oklahoma-city-thunder",
    "orlando-magic", "philadelphia-76ers", "phoenix-suns", "portland-trail-blazers",
    "sacramento-kings", "san-antonio-spurs", "toronto-raptors", "utah-jazz", "washington-wizards"
  ),
  stringsAsFactors = FALSE
)
teams$abbr <- normalize_team(teams$team)

clean_cell <- function(x) {
  vapply(as.character(x), function(value) {
    value <- gsub("\u00a0", " ", value, fixed = TRUE)
    parts <- trimws(unlist(strsplit(value, "\n", fixed = TRUE)))
    parts <- parts[nzchar(parts)]
    gsub("\\s+", " ", paste(parts, collapse = " | "))
  }, character(1), USE.NAMES = FALSE)
}

parse_money <- function(x) {
  x <- as.character(x)
  hit <- regmatches(x, regexpr("\\$[0-9,.]+[MK]?", x, ignore.case = TRUE))
  if (!length(hit) || is.na(hit) || !nzchar(hit)) return(NA_real_)
  mult <- if (grepl("M$", hit, ignore.case = TRUE)) 1000000 else if (grepl("K$", hit, ignore.case = TRUE)) 1000 else 1
  as.numeric(gsub("[^0-9.]", "", hit)) * mult
}

parse_status <- function(cell, section) {
  if (grepl("\\bRFA\\b", cell, ignore.case = TRUE)) return("RFA")
  if (grepl("\\bUFA\\b", cell, ignore.case = TRUE)) return("UFA")
  if (grepl("player option", cell, ignore.case = TRUE)) return("Player Option")
  if (grepl("(team|club) option", cell, ignore.case = TRUE)) return("Team Option")
  if (grepl("non[- ]guaranteed", cell, ignore.case = TRUE)) return("Non-Guaranteed")
  if (grepl("two-way", cell, ignore.case = TRUE)) return("Two-Way")
  if (grepl("1ST RD|2ND RD|draft", cell, ignore.case = TRUE)) return("Rookie FA")
  if (identical(section, "Cap Hold")) return("Cap Hold")
  if (is.finite(parse_money(cell))) return("Signed")
  NA_character_
}

fetch_page <- function(url, out_path) {
  curl <- Sys.which("curl.exe")
  if (!nzchar(curl)) curl <- Sys.which("curl")
  if (!nzchar(curl)) stop("curl/curl.exe is required to fetch Spotrac pages.")
  args <- c("-L", "--fail", "--silent", "--show-error", "--user-agent", "Mozilla/5.0", url, "-o", out_path)
  status <- system2(curl, args = args)
  if (!identical(status, 0L)) {
    stop("curl failed with status ", status, " for ", url)
  }
  out_path
}

extract_player_name <- function(row_node, fallback_text) {
  links <- rvest::html_elements(row_node, "a[href*='/nba/player'], a[href*='/redirect/player']")
  link_text <- trimws(rvest::html_text2(links))
  link_text <- link_text[nzchar(link_text)]
  if (length(link_text)) return(link_text[[1]])
  fallback_text <- trimws(fallback_text)
  fallback_text <- sub("^[A-Za-z'. -]+\\s+([A-Z][A-Za-z'. -]+)$", "\\1", fallback_text)
  gsub("\\s+", " ", fallback_text)
}

extract_spotrac_id <- function(row_node) {
  hrefs <- rvest::html_attr(rvest::html_elements(row_node, "a[href*='/nba/player'], a[href*='/redirect/player']"), "href")
  hrefs <- hrefs[!is.na(hrefs)]
  hit <- hrefs[grepl("/id/[0-9]+|/player/[0-9]+", hrefs)][1]
  if (is.na(hit)) return(NA_integer_)
  id <- sub(".*(?:/id/|/player/)([0-9]+).*", "\\1", hit)
  suppressWarnings(as.integer(id))
}

row_trade_marker <- function(row_node) {
  text <- paste(
    rvest::html_attr(rvest::html_elements(row_node, "[data-bs-original-title], [title]"), "data-bs-original-title"),
    rvest::html_attr(rvest::html_elements(row_node, "[data-bs-original-title], [title]"), "title"),
    rvest::html_attr(rvest::html_elements(row_node, "i, span, a"), "class"),
    collapse = " "
  )
  grepl("\\btrade|traded|text-trade|arrow-right-arrow-left", text, ignore.case = TRUE)
}

empty_rows <- function() {
  data.frame()
}

parse_section_table <- function(table_node, section, team_name, abbr, source_url, scraped_at, labels) {
  body_rows <- rvest::html_elements(table_node, "tbody tr")
  if (!length(body_rows)) return(empty_rows())
  out <- lapply(seq_along(body_rows), function(i) {
    cells <- rvest::html_elements(body_rows[[i]], xpath = "./td")
    if (length(cells) < 3) return(NULL)
    cell_text <- clean_cell(rvest::html_text2(cells))
    raw_row_text <- clean_cell(rvest::html_text2(body_rows[[i]]))
    is_roster_charge <- grepl("Incomplete Roster Charge", raw_row_text, ignore.case = TRUE) ||
      grepl("Incomplete Roster Charge", cell_text[[1]], ignore.case = TRUE)
    player_name <- if (is_roster_charge) "Incomplete Roster Charge" else extract_player_name(body_rows[[i]], cell_text[[1]])
    if (!nzchar(normalize_name(player_name))) return(NULL)
    marker <- row_trade_marker(body_rows[[i]])
    state <- if (identical(section, "Pending Transactions")) {
      "active_pending_done"
    } else if (identical(section, "Active Roster") && marker) {
      "traded_marker_excluded"
    } else if (identical(section, "Active Roster")) {
      "active"
    } else if (identical(section, "Cap Hold")) {
      "cap_hold"
    } else if (identical(section, "Dead Money")) {
      "dead_money"
    } else {
      tolower(gsub("[^a-z0-9]+", "_", section))
    }
    season_values <- rep("", length(labels))
    raw_seasons <- cell_text[seq.int(4, min(length(cell_text), 3 + length(labels)))]
    season_values[seq_along(raw_seasons)] <- raw_seasons
    names(season_values) <- labels
    data.frame(
      team = team_name,
      team_abbr = abbr,
      section = section,
      roster_state = state,
      entity_type = if (is_roster_charge) "roster_charge" else "player",
      player_or_entity = player_name,
      spotrac_player_id = if (is_roster_charge) NA_integer_ else extract_spotrac_id(body_rows[[i]]),
      pos = if (is_roster_charge) "" else cell_text[[2]],
      age = if (is_roster_charge) NA_real_ else suppressWarnings(as.numeric(cell_text[[3]])),
      source_url = source_url,
      scraped_at = scraped_at,
      guarantee_capture_status = "not_attempted_hover_only",
      trade_marker = marker,
      t(season_values),
      raw_row_text = raw_row_text,
      check.names = FALSE,
      stringsAsFactors = FALSE
    )
  })
  out <- out[!vapply(out, is.null, logical(1))]
  if (!length(out)) return(empty_rows())
  do.call(rbind, out)
}

scrape_team <- function(base_dir, team_row, labels) {
  if (!requireNamespace("rvest", quietly = TRUE) || !requireNamespace("xml2", quietly = TRUE)) {
    stop("Packages 'rvest' and 'xml2' are required to scrape Spotrac roster state.")
  }
  cache_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh", "spotrac_allteams_no_guarantees", "html")
  dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)
  url <- paste0("https://www.spotrac.com/nba/", team_row$slug, "/yearly/_/sort/cap_total/view/roster")
  html_path <- file.path(cache_dir, paste0(team_row$abbr, ".html"))
  fetched <- TRUE
  error_message <- ""
  tryCatch(
    fetch_page(url, html_path),
    error = function(e) {
      fetched <<- FALSE
      error_message <<- conditionMessage(e)
      if (!file.exists(html_path)) stop(e)
    }
  )
  page <- rvest::read_html(html_path)
  tables <- rvest::html_elements(page, "table")
  if (!length(tables)) {
    stop("No tables found for ", team_row$team, " at ", url)
  }
  scraped_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  sections <- vapply(tables, function(tab) {
    h <- xml2::xml_find_first(tab, "preceding::h2[1]")
    clean_cell(rvest::html_text2(h))
  }, character(1))
  wanted <- c("Pending Transactions", "Active Roster", "Cap Hold", "Dead Money")
  selected <- match(wanted, sections)
  selected <- selected[!is.na(selected)]
  rows <- lapply(selected, function(idx) {
    parse_section_table(tables[[idx]], sections[[idx]], team_row$team, team_row$abbr, url, scraped_at, labels)
  })
  rows <- rows[lengths(rows) > 0]
  wide <- if (length(rows)) do.call(rbind, rows) else data.frame()
  audit <- data.frame(
    team = team_row$team,
    source_url = url,
    status = if (fetched) "ok" else "cached_after_fetch_error",
    table_count = length(tables),
    pending_rows = sum(wide$section == "Pending Transactions", na.rm = TRUE),
    active_roster_rows = sum(wide$section == "Active Roster" & wide$roster_state == "active", na.rm = TRUE),
    traded_marker_excluded_rows = sum(wide$roster_state == "traded_marker_excluded", na.rm = TRUE),
    cap_hold_player_rows = sum(wide$section == "Cap Hold", na.rm = TRUE),
    elapsed_seconds = NA_real_,
    scraped_at = scraped_at,
    method = "curl Spotrac server HTML; table heading parser; pending transactions treated as active roster truth",
    error_message = error_message,
    stringsAsFactors = FALSE
  )
  list(wide = wide, audit = audit)
}

status_flags <- function(cell, section) {
  status <- parse_status(cell, section)
  ifelse(is.na(status), "", status)
}

to_long <- function(wide, labels) {
  if (!nrow(wide)) return(data.frame())
  out <- lapply(labels, function(label) {
    cell <- as.character(wide[[label]])
    data.frame(
      team = wide$team,
      team_abbr = wide$team_abbr,
      section = wide$section,
      roster_state = wide$roster_state,
      entity_type = wide$entity_type,
      player_or_entity = wide$player_or_entity,
      spotrac_player_id = suppressWarnings(as.integer(wide$spotrac_player_id)),
      pos = wide$pos,
      age = suppressWarnings(as.numeric(wide$age)),
      season = label,
      cell_text = cell,
      amount_text = vapply(cell, function(x) {
        amount <- parse_money(x)
        ifelse(is.finite(amount), paste0("$", format(round(amount), big.mark = ",", scientific = FALSE, trim = TRUE)), "")
      }, character(1)),
      pct_of_cap = ifelse(grepl("\\b[0-9]+(?:\\.[0-9]+)?%", cell), sub(".*\\b([0-9]+(?:\\.[0-9]+)?%).*", "\\1", cell), ""),
      status_flags = mapply(status_flags, cell, wide$section, USE.NAMES = FALSE),
      guarantee_text = "",
      guarantee_capture_status = wide$guarantee_capture_status,
      source_url = wide$source_url,
      scraped_at = wide$scraped_at,
      has_value = nzchar(trimws(cell)),
      stringsAsFactors = FALSE
    )
  })
  do.call(rbind, out)
}

read_aliases <- function(base_dir) {
  path <- file.path(base_dir, "ref", "player_name_aliases.csv")
  if (!file.exists(path)) return(data.frame(alias_key = character(), canonical_key = character()))
  aliases <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("alias", "canonical") %in% names(aliases))) {
    return(data.frame(alias_key = character(), canonical_key = character()))
  }
  data.frame(
    alias_key = normalize_name(aliases$alias),
    canonical_key = normalize_name(aliases$canonical),
    stringsAsFactors = FALSE
  )
}

build_player_universe <- function(base_dir) {
  frames <- list()
  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    name_col <- names(stats)[names(stats) %in% c("player_name", "player", "PLAYER_NAME", "name", "Name")][1]
    team_col <- names(stats)[names(stats) %in% c("TeamAbbreviation", "team", "TEAM_ABBREVIATION")][1]
    if (!is.na(name_col) && "nba_id" %in% names(stats)) {
      frames[[length(frames) + 1L]] <- data.frame(
        nba_id = suppressWarnings(as.integer(stats$nba_id)),
        player_name = as.character(stats[[name_col]]),
        team = if (!is.na(team_col)) normalize_team(stats[[team_col]]) else NA_character_,
        year = if ("year" %in% names(stats)) suppressWarnings(as.integer(stats$year)) else NA_integer_,
        source = "raw/databallr_stats.csv",
        stringsAsFactors = FALSE
      )
    }
  }
  contracts_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "contracts_2026_current.csv")
  if (file.exists(contracts_path)) {
    contracts <- read.csv(contracts_path, stringsAsFactors = FALSE, check.names = FALSE)
    if (all(c("nba_id", "player_name") %in% names(contracts))) {
      frames[[length(frames) + 1L]] <- data.frame(
        nba_id = suppressWarnings(as.integer(contracts$nba_id)),
        player_name = as.character(contracts$player_name),
        team = if ("team" %in% names(contracts)) normalize_team(contracts$team) else NA_character_,
        year = 2026L,
        source = "contracts_2026_current.csv",
        stringsAsFactors = FALSE
      )
    }
  }
  if (!length(frames)) return(data.frame())
  universe <- do.call(rbind, frames)
  universe <- universe[is.finite(universe$nba_id) & nzchar(normalize_name(universe$player_name)), , drop = FALSE]
  universe$name_key <- normalize_name(universe$player_name)
  universe <- universe[order(universe$name_key, -suppressWarnings(as.integer(universe$year))), , drop = FALSE]
  universe[!duplicated(paste(universe$nba_id, universe$name_key)), , drop = FALSE]
}

match_spotrac_players <- function(wide, universe, aliases) {
  if (!nrow(wide)) return(wide)
  if (!nrow(universe)) {
    wide$nba_id <- NA_integer_
    wide$match_method <- "no_universe"
    wide$match_confidence <- 0
    wide$matched_player_name <- NA_character_
    return(wide)
  }
  key_to_canonical <- setNames(aliases$canonical_key, aliases$alias_key)
  key <- normalize_name(wide$player_or_entity)
  key <- ifelse(key %in% names(key_to_canonical), unname(key_to_canonical[key]), key)
  wide$name_key <- key

  exact_counts <- aggregate(universe$nba_id, by = list(name_key = universe$name_key), FUN = function(v) length(unique(v)))
  names(exact_counts)[2] <- "id_count"
  exact_unique <- merge(universe, exact_counts, by = "name_key", all.x = TRUE)
  exact_unique <- exact_unique[exact_unique$id_count == 1, , drop = FALSE]
  exact_unique <- exact_unique[!duplicated(exact_unique$name_key), , drop = FALSE]

  wide$nba_id <- NA_integer_
  wide$match_method <- "unmatched"
  wide$match_confidence <- 0
  wide$matched_player_name <- NA_character_
  idx <- match(wide$name_key, exact_unique$name_key)
  hit <- !is.na(idx)
  wide$nba_id[hit] <- exact_unique$nba_id[idx[hit]]
  wide$match_method[hit] <- ifelse(normalize_name(wide$player_or_entity[hit]) == wide$name_key[hit], "exact_name", "alias_name")
  wide$match_confidence[hit] <- 1
  wide$matched_player_name[hit] <- exact_unique$player_name[idx[hit]]

  unmatched <- which(is.na(wide$nba_id) & nchar(wide$name_key) >= 6)
  universe_keys <- unique(exact_unique$name_key)
  for (i in unmatched) {
    d <- utils::adist(wide$name_key[[i]], universe_keys, ignore.case = TRUE)
    best <- which(d == min(d))
    if (length(best) == 1 && d[[best]] <= 1) {
      m <- match(universe_keys[[best]], exact_unique$name_key)
      wide$nba_id[[i]] <- exact_unique$nba_id[[m]]
      wide$match_method[[i]] <- "fuzzy_name_distance_1"
      wide$match_confidence[[i]] <- 0.92
      wide$matched_player_name[[i]] <- exact_unique$player_name[[m]]
    }
  }
  wide
}

build_current_roster_truth <- function(wide, roster_year, labels) {
  if (!nrow(wide)) return(data.frame())
  wide <- wide[wide$entity_type == "player", , drop = FALSE]
  if (!nrow(wide)) return(data.frame())
  first_label <- labels[[1]]
  wide$current_status <- mapply(parse_status, as.character(wide[[first_label]]), wide$section, USE.NAMES = FALSE)
  wide$current_status <- ifelse(
    wide$roster_state %in% c("active", "active_pending_done") & (is.na(wide$current_status) | wide$current_status %in% c("Cap Hold", "UFA", "RFA")),
    "Signed",
    wide$current_status
  )
  active <- wide[wide$roster_state %in% c("active", "active_pending_done"), , drop = FALSE]
  holds <- wide[wide$roster_state == "cap_hold", , drop = FALSE]
  if (nrow(active)) {
    active$dedupe_key <- ifelse(is.finite(active$nba_id), paste0("id:", active$nba_id), paste0("name:", active$name_key))
  } else {
    active$dedupe_key <- character()
  }
  if (nrow(holds)) {
    holds$dedupe_key <- ifelse(is.finite(holds$nba_id), paste0("id:", holds$nba_id), paste0("name:", holds$name_key))
    holds <- holds[!(holds$dedupe_key %in% active$dedupe_key), , drop = FALSE]
  }
  active_out <- if (nrow(active)) data.frame(
    year = roster_year,
    nba_id = suppressWarnings(as.integer(active$nba_id)),
    player_name = active$player_or_entity,
    team = active$team_abbr,
    rights_team = active$team_abbr,
    contract_status = active$current_status,
    roster_state = active$roster_state,
    roster_source = paste0("Spotrac ", active$section),
    pulled_at = active$scraped_at,
    spotrac_player_id = suppressWarnings(as.integer(active$spotrac_player_id)),
    match_method = active$match_method,
    match_confidence = active$match_confidence,
    stringsAsFactors = FALSE
  ) else data.frame()
  hold_out <- if (nrow(holds)) data.frame(
    year = roster_year,
    nba_id = suppressWarnings(as.integer(holds$nba_id)),
    player_name = holds$player_or_entity,
    team = "FA",
    rights_team = holds$team_abbr,
    contract_status = ifelse(holds$current_status %in% c("RFA", "UFA", "Rookie FA"), holds$current_status, "UFA"),
    roster_state = "cap_hold",
    roster_source = "Spotrac Cap Hold",
    pulled_at = holds$scraped_at,
    spotrac_player_id = suppressWarnings(as.integer(holds$spotrac_player_id)),
    match_method = holds$match_method,
    match_confidence = holds$match_confidence,
    stringsAsFactors = FALSE
  ) else data.frame()
  out <- rbind(active_out, hold_out)
  if (!nrow(out)) return(out)
  out$name_key <- normalize_name(out$player_name)
  out$priority <- ifelse(out$team != "FA", 1L, 2L)
  out <- out[order(out$priority, out$team, out$player_name), , drop = FALSE]
  out <- out[!duplicated(ifelse(is.finite(out$nba_id), paste0("id:", out$nba_id), paste0("name:", out$name_key, ":", out$team, ":", out$rights_team))), , drop = FALSE]
  out$priority <- NULL
  out$name_key <- NULL
  out
}

base_dir <- resolve_base_dir()
roster_year <- infer_roster_year(base_dir)
labels <- season_labels(roster_year)
spotrac_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh", "spotrac_allteams_no_guarantees")
dir.create(spotrac_dir, recursive = TRUE, showWarnings = FALSE)

results <- lapply(seq_len(nrow(teams)), function(i) {
  started <- Sys.time()
  result <- scrape_team(base_dir, teams[i, , drop = FALSE], labels)
  result$audit$elapsed_seconds <- round(as.numeric(difftime(Sys.time(), started, units = "secs")), 2)
  Sys.sleep(0.25)
  result
})

wide <- do.call(rbind, lapply(results, `[[`, "wide"))
audit <- do.call(rbind, lapply(results, `[[`, "audit"))
universe <- build_player_universe(base_dir)
aliases <- read_aliases(base_dir)
wide <- match_spotrac_players(wide, universe, aliases)
long <- to_long(wide, labels)
roster_truth <- build_current_roster_truth(wide, roster_year, labels)

wide_path <- file.path(spotrac_dir, "spotrac_active_roster_cap_hold_allteams_wide.csv")
long_path <- file.path(spotrac_dir, "spotrac_active_roster_cap_hold_allteams_long.csv")
audit_path <- file.path(spotrac_dir, "scrape_audit.csv")
state_path <- file.path(spotrac_dir, paste0("spotrac_roster_state_", roster_year, ".csv"))
review_path <- file.path(spotrac_dir, paste0("spotrac_roster_match_review_", roster_year, ".csv"))
roster_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", paste0("current_rosters_", roster_year, ".csv"))

write.csv(wide, wide_path, row.names = FALSE, na = "")
write.csv(long, long_path, row.names = FALSE, na = "")
write.csv(audit, audit_path, row.names = FALSE, na = "")
write.csv(wide, state_path, row.names = FALSE, na = "")
write.csv(
  wide[wide$entity_type == "player" & (wide$match_method == "unmatched" | wide$match_confidence < 1 | wide$roster_state == "traded_marker_excluded"), , drop = FALSE],
  review_path,
  row.names = FALSE,
  na = ""
)
write.csv(roster_truth, roster_path, row.names = FALSE, na = "")

summary_path <- file.path(spotrac_dir, "benchmark_summary.json")
summary <- paste0(
  "{\n",
  '  "teams_requested": ', nrow(teams), ",\n",
  '  "teams_ok": ', sum(audit$status %in% c("ok", "cached_after_fetch_error")), ",\n",
  '  "teams_error": ', sum(!(audit$status %in% c("ok", "cached_after_fetch_error"))), ",\n",
  '  "rows_wide": ', nrow(wide), ",\n",
  '  "rows_long": ', nrow(long), ",\n",
  '  "active_roster_truth_rows": ', sum(roster_truth$team != "FA"), ",\n",
  '  "free_agent_or_cap_hold_truth_rows": ', sum(roster_truth$team == "FA"), ",\n",
  '  "traded_marker_excluded_rows": ', sum(wide$roster_state == "traded_marker_excluded"), ",\n",
  '  "unmatched_rows": ', sum(wide$entity_type == "player" & wide$match_method == "unmatched"), ",\n",
  '  "generated_at": "', format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"), '"\n',
  "}\n"
)
writeLines(summary, summary_path)

message("Spotrac roster state written: ", state_path)
message("Spotrac cap wide written: ", wide_path)
message("Roster truth written: ", roster_path)
message("Rows: active=", sum(roster_truth$team != "FA"), "; FA/cap-hold=", sum(roster_truth$team == "FA"), "; review=", nrow(read.csv(review_path)))
