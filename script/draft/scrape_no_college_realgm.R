if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")
if (!requireNamespace("jsonlite", quietly = TRUE)) install.packages("jsonlite")
if (!requireNamespace("chromote", quietly = TRUE)) install.packages("chromote")

library(data.table)
library(jsonlite)
library(chromote)

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

resolve_no_college_cohort_file <- function(draft_dir) {
  preferred <- file.path(draft_dir, "draft_no_college_all_classes.csv")
  legacy <- file.path(draft_dir, "draft_no_college_2014_2025.csv")

  if (file.exists(preferred)) return(preferred)
  if (file.exists(legacy)) return(legacy)
  preferred
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

parse_target_players <- function(x) {
  x <- trimws(x)
  if (!nzchar(x)) return(character())
  parts <- unlist(strsplit(x, "[|;,]", perl = TRUE), use.names = FALSE)
  parts <- trimws(parts)
  parts[nzchar(parts)]
}

clean_colnames <- function(x) {
  x <- trimws(as.character(x))
  x <- gsub("%", "_pct", x, fixed = TRUE)
  x <- gsub("/", "_per_", x, fixed = TRUE)
  x <- gsub("3P", "x3P", x, fixed = TRUE)
  x <- gsub("3PM", "x3PM", x, fixed = TRUE)
  x <- gsub("3PA", "x3PA", x, fixed = TRUE)
  x <- gsub("40 ", "x40 ", x, fixed = TRUE)
  x <- gsub("[^A-Za-z0-9]+", "_", x)
  x <- tolower(x)
  x <- gsub("^_+|_+$", "", x)
  x[x == ""] <- "col"
  make.unique(x, sep = "_")
}

numify <- function(x) {
  x <- as.character(x)
  clock_match <- grepl("^\\d+:\\d{2}$", x)
  if (any(clock_match, na.rm = TRUE)) {
    mins <- suppressWarnings(as.numeric(sub(":.*$", "", x[clock_match])))
    secs <- suppressWarnings(as.numeric(sub("^.*:", "", x[clock_match])))
    x[clock_match] <- as.character(mins + secs / 60)
  }
  x <- gsub(",", "", x, fixed = TRUE)
  x <- gsub("^-$", NA_character_, x)
  suppressWarnings(as.numeric(x))
}

season_end_year <- function(x) {
  x <- gsub("\\*", "", as.character(x))
  x <- trimws(x)
  out <- rep(NA_integer_, length(x))

  full_match <- grepl("^\\d{4}$", x)
  out[full_match] <- as.integer(x[full_match])

  split_match <- grepl("^\\d{4}-\\d{2}$", x)
  if (any(split_match)) {
    start_year <- as.integer(substr(x[split_match], 1, 4))
    end_suffix <- as.integer(substr(x[split_match], 6, 7))
    century <- floor(start_year / 100) * 100L
    end_year <- century + end_suffix
    end_year[end_year < start_year] <- end_year[end_year < start_year] + 100L
    out[split_match] <- end_year
  }

  out
}

extract_json_value <- function(session, js_code) {
  result <- session$Runtime$evaluate(js_code, awaitPromise = TRUE)
  result$result$value
}

navigate_page <- function(session, url, wait_seconds = 3, attempts = 3) {
  last_error <- NULL

  for (attempt in seq_len(attempts)) {
    nav_ok <- tryCatch({
      session$Page$navigate(url = url)
      TRUE
    }, error = function(e) {
      last_error <<- conditionMessage(e)
      FALSE
    })

    if (!nav_ok) {
      Sys.sleep(attempt)
      next
    }

    Sys.sleep(wait_seconds + attempt - 1)

    page_state <- tryCatch(
      extract_json_value(
        session,
        paste0(
          "JSON.stringify({",
          "title: document.title || '',",
          "readyState: document.readyState || '',",
          "bodyText: document.body ? document.body.innerText : ''",
          "})"
        )
      ),
      error = function(e) NA_character_
    )

    if (!is.na(page_state) && nzchar(page_state)) {
      parsed <- fromJSON(page_state)
      if (nzchar(parsed$title) || nzchar(parsed$bodyText) || parsed$readyState %in% c("interactive", "complete")) {
        return(invisible(parsed))
      }
    }
  }

  if (is.null(last_error)) stop("Navigation failed for URL: ", url)
  stop("Navigation failed for URL: ", url, " (last error: ", last_error, ")")
}

configure_realgm_session <- function(session) {
  session$Page$addScriptToEvaluateOnNewDocument(source = paste(
    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});",
    "Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});",
    "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"
  ))

  session$Network$setUserAgentOverride(
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    acceptLanguage = "en-US,en;q=0.9",
    platform = "Windows"
  )

  invisible(session)
}

open_realgm_session <- function(attempts = 3L) {
  browser <- Chromote$new()
  last_error <- NULL

  for (attempt in seq_len(attempts)) {
    session <- tryCatch(
      browser$new_session(wait_ = TRUE),
      error = function(e) {
        last_error <<- conditionMessage(e)
        NULL
      }
    )

    if (is.null(session)) {
      Sys.sleep(attempt)
      next
    }

    is_active <- tryCatch({
      session$Page$enable()
      session$Network$enable()
      TRUE
    }, error = function(e) {
      last_error <<- conditionMessage(e)
      FALSE
    })

    if (is_active) {
      return(list(browser = browser, session = session))
    }

    try(session$close(), silent = TRUE)
    Sys.sleep(attempt)
  }

  try(browser$close(), silent = TRUE)
  stop("Could not open an active Chromote session for RealGM. Last error: ", last_error)
}

ensure_realgm_ready <- function(session, url) {
  page_state <- navigate_page(session, url, wait_seconds = 8)
  title <- page_state$title
  body_text <- page_state$bodyText
  is_blocked <- grepl("just a moment", title, ignore.case = TRUE) ||
    grepl("security verification", body_text, ignore.case = TRUE)

  if (!is_blocked) return(invisible(TRUE))

  cat("\nRealGM browser verification is required.\n")
  cat("A Chrome window should be open now.\n")
  cat("Please complete the RealGM security check in that browser window.\n")
  invisible(readline(prompt = "Press Enter here after the RealGM page has fully loaded: "))

  page_state <- navigate_page(session, url, wait_seconds = 5)
  title <- page_state$title
  body_text <- page_state$bodyText
  is_blocked <- grepl("just a moment", title, ignore.case = TRUE) ||
    grepl("security verification", body_text, ignore.case = TRUE)

  if (is_blocked) {
    stop("RealGM verification is still blocking page access. Please rerun the script after the challenge is cleared.")
  }

  invisible(TRUE)
}

extract_draft_rows <- function(session, year) {
  url <- sprintf("https://basketball.realgm.com/nba/draft/past_drafts/%s", year)
  navigate_page(session, url, wait_seconds = 3)

  json_text <- extract_json_value(
    session,
    paste0(
      "(function() {",
      "  const out = [];",
      "  document.querySelectorAll('table tr').forEach((tr) => {",
      "    const cells = Array.from(tr.children).map((cell) => cell.innerText.trim());",
      "    const playerLink = tr.querySelector('a[href*=\"/player/\"]');",
      "    if (!playerLink || !cells.length) return;",
      "    out.push({",
      "      cells: cells,",
      "      player_name: playerLink.innerText.trim(),",
      "      player_url: new URL(playerLink.getAttribute('href'), location.origin).href",
      "    });",
      "  });",
      "  return JSON.stringify(out);",
      "})()"
    )
  )

  rows <- fromJSON(json_text, simplifyVector = FALSE)
  if (!length(rows)) return(data.table())

  out_rows <- lapply(rows, function(row) {
    cells <- unlist(row$cells, use.names = FALSE)
    if (!length(cells)) return(NULL)

    pick <- suppressWarnings(as.integer(cells[1]))
    if (is.na(pick)) return(NULL)

    padded <- rep(NA_character_, 12)
    padded[seq_len(min(length(cells), 12))] <- cells[seq_len(min(length(cells), 12))]

    data.table(
      draft_year = year,
      pick_overall = pick,
      player = row$player_name,
      realgm_profile_url = row$player_url,
      team = padded[3],
      draft_trades = padded[4],
      pos = padded[5],
      ht = padded[6],
      wt = padded[7],
      age = padded[8],
      yos = padded[9],
      pre_draft_team = padded[10],
      draft_class = padded[11],
      nationality = padded[12]
    )
  })

  rbindlist(Filter(Negate(is.null), out_rows), fill = TRUE)
}

safe_extract_draft_rows <- function(session, year) {
  tryCatch(
    extract_draft_rows(session, year),
    error = function(e) {
      warning(sprintf("Skipping RealGM draft map extraction for %s: %s", year, conditionMessage(e)))
      data.table()
    }
  )
}

extract_profile_tables <- function(session, url) {
  navigate_page(session, url, wait_seconds = 3)

  json_text <- extract_json_value(
    session,
    paste0(
      "(function() {",
      "  let currentH2 = '';",
      "  let currentH3 = '';",
      "  const out = [];",
      "  const nodes = document.body.querySelectorAll('h2, h3, table');",
      "  nodes.forEach((node) => {",
      "    const tag = node.tagName;",
      "    if (tag === 'H2') { currentH2 = node.innerText.trim(); return; }",
      "    if (tag === 'H3') { currentH3 = node.innerText.trim(); return; }",
      "    if (tag === 'TABLE') {",
      "      const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>",
      "        Array.from(tr.children).map((cell) => cell.innerText.trim())",
      "      ).filter((row) => row.length > 0);",
      "      if (rows.length) out.push({h2: currentH2, h3: currentH3, rows: rows});",
      "    }",
      "  });",
      "  return JSON.stringify(out);",
      "})()"
    )
  )

  body_text <- extract_json_value(session, "document.body.innerText")
  list(tables = fromJSON(json_text, simplifyVector = FALSE), body_text = body_text)
}

table_entry_to_dt <- function(entry, prefix) {
  rows <- entry$rows
  if (is.null(rows) || !length(rows) || length(rows[[1]]) < 2) return(NULL)

  flatten_row <- function(row) {
    out <- unlist(row, recursive = TRUE, use.names = FALSE)
    trimws(as.character(out))
  }

  header <- clean_colnames(flatten_row(rows[[1]]))
  body <- lapply(rows[-1], flatten_row)
  if (!length(body)) return(NULL)

  max_cols <- max(vapply(body, length, integer(1)))
  if (max_cols > length(header)) {
    header <- c(header, paste0("extra_", seq_len(max_cols - length(header))))
  }

  body_mat <- t(vapply(body, function(row) {
    out <- rep(NA_character_, length(header))
    out[seq_len(min(length(row), length(header)))] <- row[seq_len(min(length(row), length(header)))]
    out
  }, character(length(header))))

  dt <- as.data.table(body_mat)
  setnames(dt, paste0(prefix, header))

  alias_from <- c("year", "event")
  alias_to <- c("season", "team")
  for (i in seq_along(alias_from)) {
    old_name <- paste0(prefix, alias_from[[i]])
    new_name <- paste0(prefix, alias_to[[i]])
    if (old_name %in% names(dt) && !new_name %in% names(dt)) {
      setnames(dt, old_name, new_name)
    }
  }

  dt[]
}

select_source_row <- function(summary_dt, draft_year, prefix = "sum_") {
  if (is.null(summary_dt) || !nrow(summary_dt)) return(NULL)

  season_col <- paste0(prefix, "season")
  team_col <- paste0(prefix, "team")
  league_col <- paste0(prefix, "league")
  min_col <- paste0(prefix, "min")

  if (!season_col %in% names(summary_dt)) return(NULL)

  dt <- copy(summary_dt)
  dt[, source_season_end := season_end_year(get(season_col))]
  dt[, source_minutes_num := if (min_col %in% names(dt)) numify(get(min_col)) else NA_real_]
  team_vals <- if (team_col %in% names(dt)) trimws(as.character(dt[[team_col]])) else rep("", nrow(dt))
  league_vals <- if (league_col %in% names(dt)) trimws(as.character(dt[[league_col]])) else rep("", nrow(dt))
  dt[, source_is_aggregate := grepl("all teams", team_vals, ignore.case = TRUE) |
       grepl("all leagues", league_vals, ignore.case = TRUE)]

  dt <- dt[!is.na(source_season_end) & source_season_end <= draft_year]
  if (!nrow(dt)) return(NULL)

  setorder(dt, -source_season_end, -source_is_aggregate, -source_minutes_num)
  dt[1]
}

match_stat_row <- function(stat_dt, selected_row, stat_prefix, source_prefix = "sum_") {
  if (is.null(stat_dt) || !nrow(stat_dt) || is.null(selected_row) || !nrow(selected_row)) {
    return(NULL)
  }

  key_map <- c("season", "team", "league")
  source_cols <- paste0(source_prefix, key_map)
  stat_cols <- paste0(stat_prefix, key_map)

  keep_keys <- key_map[
    source_cols %in% names(selected_row) &
      stat_cols %in% names(stat_dt)
  ]
  if (!length(keep_keys)) return(NULL)

  dt <- copy(stat_dt)
  keep_source_cols <- paste0(source_prefix, keep_keys)
  keep_stat_cols <- paste0(stat_prefix, keep_keys)

  for (i in seq_along(keep_keys)) {
    dt[[keep_stat_cols[i]]] <- trimws(as.character(dt[[keep_stat_cols[i]]]))
  }

  target_vals <- vapply(keep_source_cols, function(col) trimws(as.character(selected_row[[col]][1])), character(1))
  keep <- rep(TRUE, nrow(dt))
  for (i in seq_along(keep_stat_cols)) {
    keep <- keep & trimws(as.character(dt[[keep_stat_cols[i]]])) == target_vals[[i]]
  }

  match_dt <- dt[keep]
  if (!nrow(match_dt)) {
    season_end_col <- paste0(stat_prefix, "season")
    match_dt <- dt[season_end_year(get(season_end_col)) == season_end_year(target_vals[1])]
  }

  if (!nrow(match_dt)) return(NULL)
  match_dt[1]
}

extract_meta_value <- function(body_text, label) {
  pattern <- sprintf("%s:\\s*(.+)", label)
  m <- regexec(pattern, body_text, perl = TRUE)
  hit <- regmatches(body_text, m)[[1]]
  if (length(hit) >= 2) trimws(hit[2]) else NA_character_
}

build_player_row <- function(player_row, draft_row, profile_data) {
  relevant_sections <- c(
    "International Basketball Career",
    "G League Career",
    "National Basketball Career",
    "High School Basketball Career"
  )
  relevant_stat_labels <- c(
    "International Season Stats",
    "G League Season Stats",
    "G League Regular Season Stats",
    "G League Showcase Cup Stats",
    "National Season Stats",
    "High School Season Stats",
    "Overtime Elite Stats"
  )

  tables <- profile_data$tables
  if (is.null(tables) || !length(tables)) {
    return(list(data = NULL, issue = "no_tables_found"))
  }

  summary_entries <- Filter(function(x) x$h3 %in% relevant_stat_labels, tables)
  summary_entries <- Filter(function(x) x$h2 %in% relevant_sections, summary_entries)
  summary_keys <- vapply(summary_entries, function(x) paste(x$h2, x$h3, sep = "||"), character(1))
  summary_entries <- summary_entries[!duplicated(summary_keys)]
  if (!length(summary_entries)) {
    return(list(data = NULL, issue = "no_relevant_sections"))
  }

  source_priority <- function(player_row, source_stat_label) {
    pre_draft_team <- if ("pre_draft_team" %in% names(player_row)) trimws(as.character(player_row$pre_draft_team[[1]])) else ""
    priority <- 0L
    if (identical(source_stat_label, "G League Regular Season Stats")) priority <- 80L
    if (identical(source_stat_label, "G League Showcase Cup Stats")) priority <- 70L
    if (identical(source_stat_label, "Overtime Elite Stats")) priority <- 60L
    if (identical(source_stat_label, "International Season Stats")) priority <- 50L
    if (identical(source_stat_label, "National Season Stats")) priority <- 40L
    if (identical(source_stat_label, "High School Season Stats")) priority <- 30L

    if (grepl("g league", pre_draft_team, ignore.case = TRUE) && grepl("^G League", source_stat_label)) {
      priority <- priority + 25L
    }
    if (grepl("overtime elite", pre_draft_team, ignore.case = TRUE) && identical(source_stat_label, "Overtime Elite Stats")) {
      priority <- priority + 100L
    }
    if (grepl("overtime elite", pre_draft_team, ignore.case = TRUE) && grepl("^G League", source_stat_label)) {
      priority <- priority - 10L
    }
    priority
  }

  extracted_rows <- lapply(summary_entries, function(entry) {
    all_tables <- Filter(function(x) identical(x$h2, entry$h2) && identical(x$h3, entry$h3), tables)
    dt_list <- lapply(
      seq_along(all_tables),
      function(i) table_entry_to_dt(all_tables[[i]], c("sum_", "tot_", "adv_", "misc_")[pmin(i, 4)])
    )

    summary_dt <- dt_list[[1]]
    totals_dt <- if (length(dt_list) >= 2) dt_list[[2]] else NULL
    advanced_dt <- if (length(dt_list) >= 3) dt_list[[3]] else NULL
    misc_dt <- if (length(dt_list) >= 4) dt_list[[4]] else NULL

    selected_summary <- select_source_row(summary_dt, player_row$draft_year)
    if (is.null(selected_summary) || !nrow(selected_summary)) return(NULL)

    selected_totals <- match_stat_row(totals_dt, selected_summary, "tot_")
    selected_advanced <- match_stat_row(advanced_dt, selected_summary, "adv_")
    selected_misc <- match_stat_row(misc_dt, selected_summary, "misc_")

    per36_source <- selected_totals
    per36_prefix <- "tot_"
    per36_min_col <- "tot_min"
    if (is.null(per36_source) || !per36_min_col %in% names(per36_source)) {
      per36_source <- selected_summary
      per36_prefix <- "sum_"
      per36_min_col <- "sum_min"
    }

    total_min <- if (!is.null(per36_source) && per36_min_col %in% names(per36_source)) numify(per36_source[[per36_min_col]]) else NA_real_
    per36_cols <- c("pts", "trb", "ast", "stl", "blk", "tov", "fgm", "fga", "x3pm", "x3pa", "ftm", "fta", "off", "def", "pf")
    per36_vals <- setNames(as.list(rep(NA_real_, length(per36_cols))), paste0("per36_", per36_cols))
    if (is.finite(total_min) && total_min > 0 && !is.null(per36_source)) {
      for (nm in per36_cols) {
        src_col <- paste0(per36_prefix, nm)
        if (src_col %in% names(per36_source)) {
          stat_val <- numify(per36_source[[src_col]])
          per36_vals[[paste0("per36_", nm)]] <- 36 * stat_val / total_min
        }
      }
    }

    row_dt <- data.table(
      player = player_row$player,
      draft_year = player_row$draft_year,
      realgm_profile_url = draft_row$realgm_profile_url,
      pre_draft_team = draft_row$pre_draft_team,
      source_section = entry$h2,
      source_stat_label = entry$h3,
      source_season = selected_summary$sum_season[[1]],
      source_team = if ("sum_team" %in% names(selected_summary)) selected_summary$sum_team[[1]] else NA_character_,
      source_league = if ("sum_league" %in% names(selected_summary)) selected_summary$sum_league[[1]] else NA_character_,
      source_priority = source_priority(player_row, entry$h3)
    )

    piece_list <- Filter(Negate(is.null), list(
      row_dt,
      selected_summary,
      selected_totals,
      selected_advanced,
      selected_misc,
      as.data.table(per36_vals)
    ))

    combined <- as.data.table(do.call(cbind, lapply(piece_list, as.data.frame)))
    combined[, source_season_end := season_end_year(source_season)]
    combined
  })

  extracted_rows <- Filter(Negate(is.null), extracted_rows)
  if (!length(extracted_rows)) {
    return(list(data = NULL, issue = "no_pre_draft_rows"))
  }

  combined <- rbindlist(extracted_rows, use.names = TRUE, fill = TRUE)
  if (!"source_minutes_num" %in% names(combined)) combined[, source_minutes_num := NA_real_]
  setorder(combined, -source_season_end, -source_priority, -source_minutes_num)
  list(data = combined[1], issue = NA_character_)
}

merge_target_year_rows <- function(existing_path, update_dt, target_year, key_cols) {
  update_dt <- as.data.table(copy(update_dt))

  if (!is.finite(target_year) || !file.exists(existing_path)) {
    return(update_dt)
  }

  existing_dt <- fread(existing_path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(existing_dt)) return(update_dt)

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

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

cohort_file <- resolve_no_college_cohort_file(draft_dir)
if (!file.exists(cohort_file)) stop("Cohort file not found: ", cohort_file)

cohort_dt <- fread(cohort_file, na.strings = c("", "NA", "N/A", "NaN"))
cohort_dt[, player_key := normalize_name(player)]
cohort_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
if (!"realgm_profile_url" %in% names(cohort_dt)) cohort_dt[, realgm_profile_url := NA_character_]
if (!"pre_draft_team" %in% names(cohort_dt)) cohort_dt[, pre_draft_team := NA_character_]
setorder(cohort_dt, draft_year, pick_overall)

target_draft_year <- parse_optional_int_env("NO_COLLEGE_TARGET_DRAFT_YEAR")
if (is.finite(target_draft_year)) {
  cohort_dt <- cohort_dt[draft_year == target_draft_year]
}

target_players <- parse_target_players(Sys.getenv("NO_COLLEGE_TARGET_PLAYERS", ""))
if (length(target_players)) {
  target_keys <- normalize_name(target_players)
  cohort_dt <- cohort_dt[player_key %in% target_keys]
  cat("Subset mode active for players ->", paste(cohort_dt$player, collapse = ", "), "\n")
}

if (!nrow(cohort_dt)) {
  stop("No cohort rows remain after applying target filters.")
}

set_chrome_args(c(
  default_chrome_args(),
  "--disable-blink-features=AutomationControlled",
  "--lang=en-US,en",
  "--window-size=1400,1000"
))

browser_session <- open_realgm_session()
browser <- browser_session$browser
session <- browser_session$session
on.exit(try(session$close(), silent = TRUE), add = TRUE)
on.exit(try(browser$close(), silent = TRUE), add = TRUE)
cat("Chromote session opened.\n")
print(session)
configure_realgm_session(session)
cat("RealGM session configured.\n")
ensure_realgm_ready(session, "https://basketball.realgm.com/nba/draft/past_drafts/2015")

reuse_draft_map <- identical(tolower(trimws(Sys.getenv("NO_COLLEGE_USE_EXISTING_DRAFT_MAP", "false"))), "true")
draft_map_out <- file.path(draft_dir, "no_college_realgm_draft_map.csv")
subset_write_only <- length(target_players) > 0 && !is.finite(target_draft_year)

draft_map <- if (file.exists(draft_map_out)) {
  fread(draft_map_out, na.strings = c("", "NA", "N/A", "NaN"))
} else {
  data.table()
}

if (nrow(draft_map)) {
  if (!"player_key" %in% names(draft_map)) draft_map[, player_key := normalize_name(player)]
  draft_map[, draft_year := suppressWarnings(as.integer(draft_year))]
}

years_to_fetch <- sort(unique(cohort_dt[
  is.na(realgm_profile_url) | !nzchar(trimws(as.character(realgm_profile_url))),
  draft_year
]))
years_to_fetch <- years_to_fetch[is.finite(years_to_fetch)]

if (!reuse_draft_map || !file.exists(draft_map_out)) {
  fetched_map <- rbindlist(lapply(years_to_fetch, function(year) safe_extract_draft_rows(session, year)), fill = TRUE)
  if (nrow(fetched_map)) {
    fetched_map[, player_key := normalize_name(player)]
    draft_map <- rbindlist(list(draft_map, fetched_map), use.names = TRUE, fill = TRUE)
    draft_map <- unique(draft_map, by = c("draft_year", "player_key"))
  }
}

cohort_map <- merge(
  cohort_dt,
  draft_map[, .(
    draft_year,
    player_key,
    map_realgm_profile_url = realgm_profile_url,
    map_pre_draft_team = pre_draft_team
  )],
  by = c("draft_year", "player_key"),
  all.x = TRUE
)

cohort_map[, realgm_profile_url := fifelse(
  !is.na(realgm_profile_url) & nzchar(trimws(as.character(realgm_profile_url))),
  as.character(realgm_profile_url),
  as.character(map_realgm_profile_url)
)]
cohort_map[, pre_draft_team := fifelse(
  !is.na(pre_draft_team) & nzchar(trimws(as.character(pre_draft_team))),
  as.character(pre_draft_team),
  as.character(map_pre_draft_team)
)]
drop_map_cols <- intersect(c("map_realgm_profile_url", "map_pre_draft_team"), names(cohort_map))
if (length(drop_map_cols)) cohort_map[, (drop_map_cols) := NULL]

stats_rows <- list()
review_rows <- list()

for (i in seq_len(nrow(cohort_map))) {
  player_row <- cohort_map[i]
  cat(sprintf("[%d/%d] %s (%s)\n", i, nrow(cohort_map), player_row$player[[1]], player_row$draft_year[[1]]))

  profile_url <- player_row$realgm_profile_url[[1]]
  if (is.na(profile_url)) profile_url <- ""

  if (!nzchar(profile_url)) {
    review_rows[[i]] <- data.table(
      player = player_row$player[[1]],
      draft_year = player_row$draft_year[[1]],
      realgm_profile_url = NA_character_,
      issue = "missing_realgm_profile_url"
    )
    next
  }

  profile_data <- tryCatch(
    extract_profile_tables(session, profile_url),
    error = function(e) list(error = conditionMessage(e))
  )
  if (!is.null(profile_data$error)) {
    review_rows[[i]] <- data.table(
      player = player_row$player[[1]],
      draft_year = player_row$draft_year[[1]],
      realgm_profile_url = profile_url,
      issue = paste0("profile_fetch_error: ", profile_data$error)
    )
    next
  }

  built <- build_player_row(player_row, player_row, profile_data)
  if (is.null(built$data) || !nrow(built$data)) {
    review_rows[[i]] <- data.table(
      player = player_row$player[[1]],
      draft_year = player_row$draft_year[[1]],
      realgm_profile_url = profile_url,
      issue = built$issue
    )
    next
  }

  row_dt <- built$data
  row_dt[, realgm_player_name := player_row$player[[1]]]
  row_dt[, high_school := extract_meta_value(profile_data$body_text, "High School")]
  row_dt[, nationality := extract_meta_value(profile_data$body_text, "Nationality")]
  stats_rows[[i]] <- row_dt
  review_rows[[i]] <- data.table(
    player = player_row$player[[1]],
    draft_year = player_row$draft_year[[1]],
    realgm_profile_url = profile_url,
    issue = NA_character_
  )
}

stats_dt <- rbindlist(Filter(Negate(is.null), stats_rows), use.names = TRUE, fill = TRUE)
review_dt <- rbindlist(Filter(Negate(is.null), review_rows), use.names = TRUE, fill = TRUE)

numeric_cols <- setdiff(names(stats_dt), c(
  "player", "draft_year", "realgm_profile_url", "pre_draft_team", "source_section",
  "source_stat_label", "source_season", "source_team", "source_league", "realgm_player_name",
  "high_school", "nationality"
))
for (nm in intersect(numeric_cols, names(stats_dt))) {
  stats_dt[[nm]] <- numify(stats_dt[[nm]])
}

stats_out <- file.path(draft_dir, "no_college_realgm_stats.csv")
review_out <- file.path(draft_dir, "no_college_realgm_scrape_review.csv")
if (subset_write_only) {
  stats_out <- file.path(draft_dir, "no_college_realgm_stats_subset.csv")
  review_out <- file.path(draft_dir, "no_college_realgm_scrape_review_subset.csv")
}

if (is.finite(target_draft_year) && !subset_write_only) {
  stats_dt <- merge_target_year_rows(stats_out, stats_dt, target_draft_year, c("player", "draft_year"))
  review_dt <- merge_target_year_rows(review_out, review_dt, target_draft_year, c("player", "draft_year"))
}

fwrite(stats_dt, stats_out, na = "")
fwrite(review_dt, review_out, na = "")
if ((!reuse_draft_map || !file.exists(draft_map_out)) && nrow(draft_map)) {
  fwrite(draft_map, draft_map_out, na = "")
}

cat("RealGM stats written ->", stats_out, "\n")
cat("RealGM scrape review written ->", review_out, "\n")
cat("RealGM draft map written ->", draft_map_out, "\n")
if (is.finite(target_draft_year) && !subset_write_only) {
  cat("Target draft-year refresh applied ->", target_draft_year, "\n")
}
