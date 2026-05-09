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

impact_year_from_start_season <- function(season) {
  as.integer(season) + 1L
}

infer_current_start_season <- function(base_dir) {
  env_year <- suppressWarnings(as.integer(Sys.getenv("DATABALLR_END_YEAR", unset = "")))
  if (is.finite(env_year)) return(env_year - 1L)

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    if ("year" %in% names(stats)) {
      impact_year <- suppressWarnings(max(as.integer(stats$year), na.rm = TRUE))
      if (is.finite(impact_year)) return(impact_year - 1L)
    }
  }

  today <- Sys.Date()
  calendar_year <- as.integer(format(today, "%Y"))
  month <- as.integer(format(today, "%m"))
  ifelse(month >= 7, calendar_year, calendar_year - 1L)
}

read_json_url <- function(url, attempts = 4) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package 'jsonlite' is required to pull databallr contracts.")
  }
  last_error <- NULL
  for (attempt in seq_len(attempts)) {
    out <- tryCatch(
      jsonlite::fromJSON(url, simplifyVector = FALSE),
      error = function(e) {
        last_error <<- e
        NULL
      }
    )
    if (!is.null(out)) return(out)
    if (attempt < attempts) {
      Sys.sleep(1.5 * attempt)
    }
  }
  stop(last_error)
}

value_or_na <- function(x) {
  if (is.null(x) || length(x) == 0) NA else x
}

money_or_na <- function(x) {
  out <- suppressWarnings(as.numeric(value_or_na(x)))
  ifelse(is.finite(out), out, NA_real_)
}

nested_value <- function(x, path) {
  out <- x
  for (key in path) {
    if (is.null(out) || !is.list(out) || is.null(out[[key]])) return(NA)
    out <- out[[key]]
  }
  value_or_na(out)
}

status_from_note <- function(note) {
  note <- as.character(note)
  if (grepl("exercised", note, ignore.case = TRUE)) {
    return(NA_character_)
  }
  if (grepl("Player Option", note, ignore.case = TRUE)) {
    return("Player Option")
  }
  if (grepl("Club Option|Team Option", note, ignore.case = TRUE)) {
    return("Team Option")
  }
  NA_character_
}

note_season <- function(note) {
  note <- as.character(note)
  m <- regmatches(note, regexpr("^20[0-9]{2}-[0-9]{2}", note))
  if (!length(m) || !nzchar(m)) return(NA_integer_)
  suppressWarnings(as.integer(substr(m, 1, 4)))
}

season_option_status <- function(notes, season, salary_seasons) {
  if (is.null(notes) || !length(notes)) return(NA_character_)
  salary_seasons <- suppressWarnings(as.integer(salary_seasons))
  season <- suppressWarnings(as.integer(season))
  # Old option notes can remain attached after extensions. Only expose an option
  # when that salary year is the terminal season in the active salary map.
  if (!is.finite(season) || any(is.finite(salary_seasons) & salary_seasons > season)) {
    return(NA_character_)
  }
  for (note in as.character(notes)) {
    if (identical(note_season(note), season)) {
      status <- status_from_note(note)
      if (!is.na(status)) return(status)
    }
  }
  NA_character_
}

flatten_contract_payload <- function(payload, team_id, season, num_seasons) {
  data <- payload$data
  if (is.null(data) || is.null(data$salary_map) || !length(data$salary_map)) {
    return(data.frame())
  }

  aggregates <- if (!is.null(data$aggregates)) data$aggregates else list()
  salary_map <- data$salary_map
  current_contracts <- if (!is.null(data$current_season_contracts)) data$current_season_contracts else list()
  current_by_player <- list()
  if (length(current_contracts)) {
    for (contract in current_contracts) {
      player_id <- as.character(value_or_na(contract$player_id))
      if (!is.na(player_id) && nzchar(player_id)) {
        current_by_player[[player_id]] <- contract
      }
    }
  }
  rows <- lapply(names(salary_map), function(player_id) {
    salaries <- salary_map[[player_id]]
    seasons <- suppressWarnings(as.integer(names(salaries)))
    if (!length(seasons)) return(NULL)
    salaries_by_horizon <- rep(NA_real_, num_seasons)
    status_by_horizon <- rep(NA_character_, num_seasons)
    names(salaries_by_horizon) <- paste0("salary_y", seq_len(num_seasons) - 1L)
    names(status_by_horizon) <- paste0("contract_status_y", seq_len(num_seasons) - 1L)

    aggregate <- aggregates[[player_id]]
    current_contract <- current_by_player[[player_id]]
    notes <- if (!is.null(aggregate$contract_notes)) aggregate$contract_notes else character()
    for (horizon in seq_len(num_seasons) - 1L) {
      target_season <- as.integer(season) + horizon
      season_key <- as.character(target_season)
      if (!is.null(salaries[[season_key]])) {
        salaries_by_horizon[[horizon + 1L]] <- money_or_na(salaries[[season_key]]$cap_hit)
        status_by_horizon[[horizon + 1L]] <- season_option_status(notes, target_season, seasons)
      }
    }

    player <- if (!is.null(aggregate$player)) aggregate$player else NULL
    player_info <- if (!is.null(data$player_info[[player_id]]) && is.list(data$player_info[[player_id]])) data$player_info[[player_id]] else list()
    current_player <- if (!is.null(current_contract$player) && is.list(current_contract$player)) current_contract$player else list()
    first_name <- value_or_na(player$first_name)
    last_name <- value_or_na(player$last_name)
    player_name <- trimws(paste(first_name, last_name))
    if (!nzchar(player_name) || is.na(player_name)) player_name <- value_or_na(player$player_slug)
    team <- if (!is.na(nested_value(current_contract, c("team", "id")))) nested_value(current_contract, c("team", "id")) else nested_value(player_info, "team_id")
    if (is.na(team)) team <- value_or_na(aggregate$team_id)
    team_abbr <- nested_value(current_contract, c("team", "abbreviation"))
    if (is.na(team_abbr)) team_abbr <- nested_value(aggregate, c("team", "abbreviation"))
    if (is.na(team_abbr)) team_abbr <- nested_value(player_info, c("team", "abbreviation"))
    if (is.null(team_abbr) || is.na(team_abbr)) team_abbr <- nested_value(player_info, "team_abbreviation")
    nba_id <- nested_value(current_player, "nba_id")
    if (is.na(nba_id)) nba_id <- nested_value(player_info, "nba_id")

    data.frame(
      databallr_player_id = suppressWarnings(as.numeric(player_id)),
      nba_id = suppressWarnings(as.integer(nba_id)),
      player_name = player_name,
      team = as.character(team_abbr),
      team_id = suppressWarnings(as.integer(team)),
      contract_type = value_or_na(aggregate$contract_type),
      contract_status_source = value_or_na(aggregate$contract_status),
      free_agent_status = value_or_na(aggregate$free_agent_status),
      free_agent_year = suppressWarnings(as.integer(value_or_na(aggregate$free_agent_year))),
      total_guaranteed = money_or_na(aggregate$total_guaranteed),
      guaranteed_at_signing = money_or_na(aggregate$guaranteed_at_signing),
      signed_using = value_or_na(aggregate$signed_using),
      contract_notes = if (length(notes)) paste(notes, collapse = " | ") else NA_character_,
      source_team_id = as.integer(team_id),
      stringsAsFactors = FALSE,
      check.names = FALSE
    ) |>
      cbind(as.data.frame(as.list(salaries_by_horizon), check.names = FALSE)) |>
      cbind(as.data.frame(as.list(status_by_horizon), check.names = FALSE))
  })
  do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
}

dedupe_contracts <- function(contracts) {
  if (!nrow(contracts)) return(contracts)
  contracts$has_current_salary <- is.finite(suppressWarnings(as.numeric(contracts$salary_y0))) & suppressWarnings(as.numeric(contracts$salary_y0)) > 0
  contracts$name_key <- normalize_name(contracts$player_name)
  contracts <- contracts[order(
    contracts$nba_id,
    contracts$name_key,
    -as.integer(contracts$has_current_salary),
    -suppressWarnings(as.numeric(contracts$salary_y0)),
    contracts$source_team_id
  ), ]
  contracts <- contracts[!duplicated(ifelse(!is.na(contracts$nba_id), paste0("id:", contracts$nba_id), paste0("name:", contracts$name_key, ":", contracts$team))), ]
  contracts$rank <- seq_len(nrow(contracts))
  contracts$guaranteed <- contracts$total_guaranteed
  contracts$match_method <- ifelse(!is.na(contracts$nba_id), "databallr_nba_id", "databallr_player_name")
  contracts$name_key <- NULL
  contracts$has_current_salary <- NULL
  contracts
}

contract_long_rows <- function(contracts, contract_year, num_seasons) {
  if (!nrow(contracts)) return(data.frame())
  do.call(rbind, lapply(seq_len(num_seasons) - 1L, function(horizon) {
    salary_col <- paste0("salary_y", horizon)
    status_col <- paste0("contract_status_y", horizon)
    salary <- if (salary_col %in% names(contracts)) suppressWarnings(as.numeric(contracts[[salary_col]])) else rep(NA_real_, nrow(contracts))
    status <- if (status_col %in% names(contracts)) as.character(contracts[[status_col]]) else rep(NA_character_, nrow(contracts))
    data.frame(
      nba_id = suppressWarnings(as.integer(contracts$nba_id)),
      databallr_player_id = suppressWarnings(as.numeric(contracts$databallr_player_id)),
      player_name = as.character(contracts$player_name),
      team = as.character(contracts$team),
      year = as.integer(contract_year + horizon),
      contract = salary,
      contract_status = status,
      free_agent_status = as.character(contracts$free_agent_status),
      free_agent_year = suppressWarnings(as.integer(contracts$free_agent_year)),
      source_contract_year = as.integer(contract_year),
      contract_horizon = as.integer(horizon),
      contract_rank = suppressWarnings(as.integer(contracts$rank)),
      stringsAsFactors = FALSE
    )
  }))
}

write_contract_file <- function(base_dir, contracts, contract_year, num_seasons, season) {
  contracts$source <- paste0("https://api.databallr.com/api/bdl/contracts/team/{team_id}/multi-season?season=", season, "&num_seasons=", num_seasons)
  salary_cols <- paste0("salary_y", seq_len(num_seasons) - 1L)
  status_cols <- paste0("contract_status_y", seq_len(num_seasons) - 1L)
  for (col in salary_cols) if (!(col %in% names(contracts))) contracts[[col]] <- NA_real_
  for (col in status_cols) if (!(col %in% names(contracts))) contracts[[col]] <- NA_character_
  out <- contracts[, c(
    "rank", "nba_id", "databallr_player_id", "player_name", "team", "team_id",
    salary_cols, status_cols, "free_agent_status", "free_agent_year", "guaranteed",
    "contract_type", "contract_status_source", "signed_using", "contract_notes",
    "match_method", "source"
  ), drop = FALSE]

  out_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", paste0("contracts_", contract_year, "_current.csv"))
  dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)
  write.csv(out, out_path, row.names = FALSE, na = "")
  message("Contract data written: ", out_path)
  message("Rows: ", nrow(out), "; matched NBA IDs: ", sum(!is.na(out$nba_id)))
  out
}

pull_contract_season <- function(base_dir, season, num_seasons, team_ids) {
  all_rows <- lapply(team_ids, function(team_id) {
    url <- paste0("https://api.databallr.com/api/bdl/contracts/team/", team_id, "/multi-season?season=", season, "&num_seasons=", num_seasons)
    message("Fetching contracts: season ", season, ", team ", team_id)
    payload <- read_json_url(url)
    flatten_contract_payload(payload, team_id, season, num_seasons)
  })
  contracts <- do.call(rbind, all_rows)
  contracts <- contracts[!is.na(contracts$player_name) & nzchar(contracts$player_name), , drop = FALSE]
  dedupe_contracts(contracts)
}

base_dir <- resolve_base_dir()
current_start_season <- infer_current_start_season(base_dir)
start_season <- suppressWarnings(as.integer(Sys.getenv("DATABALLR_CONTRACT_START_SEASON", unset = "2022")))
end_season <- suppressWarnings(as.integer(Sys.getenv("DATABALLR_CONTRACT_END_SEASON", unset = as.character(current_start_season))))
num_seasons <- suppressWarnings(as.integer(Sys.getenv("DATABALLR_CONTRACT_NUM_SEASONS", unset = "5")))
if (!is.finite(start_season) || !is.finite(end_season) || !is.finite(num_seasons) || num_seasons < 1) {
  stop("DATABALLR_CONTRACT_START_SEASON, DATABALLR_CONTRACT_END_SEASON, and DATABALLR_CONTRACT_NUM_SEASONS must be valid integers.")
}
if (end_season < start_season) {
  stop("DATABALLR_CONTRACT_END_SEASON must be >= DATABALLR_CONTRACT_START_SEASON.")
}

team_ids <- suppressWarnings(as.integer(strsplit(Sys.getenv("DATABALLR_CONTRACT_TEAM_IDS", unset = paste(1:30, collapse = ",")), ",")[[1]]))
team_ids <- team_ids[is.finite(team_ids)]
if (!length(team_ids)) stop("No team ids configured.")

season_contracts <- list()
long_rows <- list()
for (season in seq.int(start_season, end_season)) {
  contracts <- pull_contract_season(base_dir, season, num_seasons, team_ids)
  contract_year <- impact_year_from_start_season(season)
  season_contracts[[as.character(contract_year)]] <- write_contract_file(base_dir, contracts, contract_year, num_seasons, season)
  long_rows[[as.character(contract_year)]] <- contract_long_rows(contracts, contract_year, num_seasons)
}

contracts_long <- do.call(rbind, long_rows)
contracts_long <- contracts_long[is.finite(contracts_long$contract) & contracts_long$contract > 0, , drop = FALSE]
contracts_long <- contracts_long[order(
  contracts_long$nba_id,
  contracts_long$year,
  contracts_long$contract_horizon,
  -contracts_long$source_contract_year,
  contracts_long$contract_rank
), ]
contracts_long <- contracts_long[!duplicated(paste(contracts_long$nba_id, contracts_long$year)), , drop = FALSE]
long_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "contracts_by_year.csv")
write.csv(contracts_long, long_path, row.names = FALSE, na = "")
message("Season-indexed contract data written: ", long_path)
message("Rows: ", nrow(contracts_long), "; years: ", paste(range(contracts_long$year, na.rm = TRUE), collapse = "-"))
