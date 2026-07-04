base_dir <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)

source_url <- "https://basketball.realgm.com/nba/draft/future_drafts/team"
out_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
out_csv <- file.path(out_dir, "future_draft_picks_realgm.csv")
raw_html <- file.path(out_dir, "future_draft_picks_realgm.html")
raw_text <- file.path(out_dir, "future_draft_picks_realgm.txt")

team_name_map <- c(
  "Atlanta Hawks" = "ATL",
  "Boston Celtics" = "BOS",
  "Brooklyn Nets" = "BKN",
  "Charlotte Hornets" = "CHA",
  "Chicago Bulls" = "CHI",
  "Cleveland Cavaliers" = "CLE",
  "Dallas Mavericks" = "DAL",
  "Denver Nuggets" = "DEN",
  "Detroit Pistons" = "DET",
  "Golden State Warriors" = "GSW",
  "Houston Rockets" = "HOU",
  "Indiana Pacers" = "IND",
  "LA Clippers" = "LAC",
  "Los Angeles Clippers" = "LAC",
  "Los Angeles Lakers" = "LAL",
  "Memphis Grizzlies" = "MEM",
  "Miami Heat" = "MIA",
  "Milwaukee Bucks" = "MIL",
  "Minnesota Timberwolves" = "MIN",
  "New Orleans Pelicans" = "NOP",
  "New York Knicks" = "NYK",
  "Oklahoma City Thunder" = "OKC",
  "Orlando Magic" = "ORL",
  "Philadelphia Sixers" = "PHI",
  "Philadelphia 76ers" = "PHI",
  "Phoenix Suns" = "PHX",
  "Portland Trail Blazers" = "POR",
  "Sacramento Kings" = "SAC",
  "San Antonio Spurs" = "SAS",
  "Toronto Raptors" = "TOR",
  "Utah Jazz" = "UTA",
  "Washington Wizards" = "WAS"
)

team_code_map <- c(
  "ATL" = "ATL", "BOS" = "BOS", "BRK" = "BKN", "BKN" = "BKN",
  "CHA" = "CHA", "CHI" = "CHI", "CLE" = "CLE", "DAL" = "DAL",
  "DEN" = "DEN", "DET" = "DET", "GOS" = "GSW", "GSW" = "GSW",
  "HOU" = "HOU", "IND" = "IND", "LAC" = "LAC", "LAL" = "LAL",
  "MEM" = "MEM", "MIA" = "MIA", "MIL" = "MIL", "MIN" = "MIN",
  "NOP" = "NOP", "NYK" = "NYK", "OKC" = "OKC", "ORL" = "ORL",
  "PHL" = "PHI", "PHI" = "PHI", "PHX" = "PHX", "POR" = "POR",
  "SAC" = "SAC", "SAN" = "SAS", "SAS" = "SAS", "TOR" = "TOR",
  "UTH" = "UTA", "UTA" = "UTA", "WAS" = "WAS"
)

clean_text <- function(x) {
  x <- gsub("\u00a0", " ", as.character(x), fixed = TRUE)
  x <- gsub("[[:space:]]+", " ", x)
  trimws(x)
}

repo_team_code <- function(x) {
  x <- clean_text(x)
  direct <- unname(team_name_map[x])
  ifelse(!is.na(direct), direct, x)
}

map_short_code <- function(x) {
  x <- toupper(clean_text(x))
  out <- unname(team_code_map[x])
  ifelse(!is.na(out), out, x)
}

validate_source_html <- function(html, source_label) {
  if (!length(html) || !any(nzchar(trimws(html)))) {
    stop("RealGM future-picks HTML from ", source_label, " is empty. Save rendered HTML to ", raw_html,
         " or set REALGM_FUTURE_PICKS_HTML.")
  }
  if (any(grepl("cf_chl|Enable JavaScript and cookies|Just a moment|Performing security verification", html, ignore.case = TRUE))) {
    stop("RealGM future-picks HTML from ", source_label, " is a browser challenge. Save rendered HTML to ", raw_html,
         " or set REALGM_FUTURE_PICKS_HTML.")
  }
  if (!any(grepl("NBA Future Draft Picks By Team|Future NBA Draft Picks", html, ignore.case = TRUE))) {
    stop("RealGM future-picks HTML from ", source_label, " does not contain the expected future-picks table.")
  }
  html
}

validate_source_text <- function(text, source_label) {
  if (!length(text) || !any(nzchar(trimws(text)))) {
    stop("RealGM future-picks text from ", source_label, " is empty. Save a text snapshot to ", raw_text,
         " or set REALGM_FUTURE_PICKS_TEXT.")
  }
  if (any(grepl("cf_chl|Enable JavaScript and cookies|Just a moment|Performing security verification", text, ignore.case = TRUE))) {
    stop("RealGM future-picks text from ", source_label, " is a browser challenge. Save table text to ", raw_text,
         " or set REALGM_FUTURE_PICKS_TEXT.")
  }
  if (!any(grepl("NBA Future Draft Picks By Team|Future NBA Draft Picks", text, ignore.case = TRUE))) {
    stop("RealGM future-picks text from ", source_label, " does not contain the expected future-picks table.")
  }
  text
}

read_source_text <- function() {
  text_arg <- Sys.getenv("REALGM_FUTURE_PICKS_TEXT", unset = "")
  if (nzchar(text_arg)) {
    if (!file.exists(text_arg)) stop("REALGM_FUTURE_PICKS_TEXT does not exist: ", text_arg)
    return(validate_source_text(readLines(text_arg, warn = FALSE, encoding = "UTF-8"), text_arg))
  }
  if (file.exists(raw_text)) {
    return(validate_source_text(readLines(raw_text, warn = FALSE, encoding = "UTF-8"), raw_text))
  }
  NULL
}

read_source_html <- function() {
  html_arg <- Sys.getenv("REALGM_FUTURE_PICKS_HTML", unset = "")
  if (nzchar(html_arg) && file.exists(html_arg)) {
    return(validate_source_html(readLines(html_arg, warn = FALSE, encoding = "UTF-8"), html_arg))
  }
  if (file.exists(raw_html)) {
    return(validate_source_html(readLines(raw_html, warn = FALSE, encoding = "UTF-8"), raw_html))
  }
  tf <- tempfile(fileext = ".html")
  on.exit(unlink(tf), add = TRUE)
  ok <- tryCatch({
    utils::download.file(
      source_url,
      tf,
      mode = "wb",
      quiet = TRUE,
      headers = c("User-Agent" = "Mozilla/5.0")
    )
    TRUE
  }, error = function(e) FALSE, warning = function(w) FALSE)
  if (!ok || !file.exists(tf)) {
    stop("Could not download RealGM future-picks page. Save rendered HTML to ", raw_html,
         " or set REALGM_FUTURE_PICKS_HTML.")
  }
  html <- validate_source_html(readLines(tf, warn = FALSE, encoding = "UTF-8"), source_url)
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  writeLines(html, raw_html, useBytes = TRUE)
  html
}

read_source <- function() {
  text <- read_source_text()
  if (!is.null(text)) return(list(kind = "text", lines = text))
  list(kind = "html", lines = read_source_html())
}

split_pick_fragments <- function(text) {
  text <- clean_text(text)
  if (!nzchar(text) || text %in% c("---", "-")) return(character())
  chars <- strsplit(text, "", fixed = TRUE)[[1]]
  depth <- 0L
  for (i in seq_along(chars)) {
    if (chars[i] == "(" || chars[i] == "[") depth <- depth + 1L
    if (chars[i] == ")" || chars[i] == "]") depth <- max(0L, depth - 1L)
    if (chars[i] == ";" && depth > 0L) chars[i] <- "\u0001"
  }
  text <- paste(chars, collapse = "")
  parts <- unlist(strsplit(text, "\\s*;\\s*|\\s+---\\s+", perl = TRUE), use.names = FALSE)
  parts <- gsub("\u0001", ";", parts, fixed = TRUE)
  parts <- clean_text(parts)
  parts[nzchar(parts)]
}

count_value <- function(x) {
  x <- clean_text(x)
  if (!nzchar(x)) return(NA_real_)
  nums <- suppressWarnings(as.numeric(unlist(regmatches(x, gregexpr("[0-9]+", x)))))
  if (!length(nums)) return(NA_real_)
  sum(nums)
}

starts_outgoing <- function(x) {
  grepl(
    "^(to|[0-9]+-[0-9]+\\s+to|(?:least|less|more|most|second|third|two)\\b.*\\bto\\b)",
    clean_text(x),
    ignore.case = TRUE
  )
}

is_non_asset_fragment <- function(x) {
  grepl(
    "^(\\*?reportedly\\b|\\(?\\s*via\\b|\\[[^]]+\\]$)",
    clean_text(x),
    ignore.case = TRUE
  )
}

pick_asset_type <- function(x) {
  if (grepl("\\bswap\\b", x, ignore.case = TRUE)) "pick_swap" else "team_pick"
}

protection_cutoff <- function(x) {
  x <- clean_text(x)
  m <- regexec("\\b([0-9]+)-30\\b", x, ignore.case = TRUE, perl = TRUE)
  hit <- regmatches(x, m)[[1]]
  if (length(hit) >= 2) return(max(0L, suppressWarnings(as.integer(hit[2])) - 1L))
  patterns <- c(
    "protected for selections 1-([0-9]+)",
    "prot\\.?\\s*1-([0-9]+)",
    "\\b1-([0-9]+)\\s+own\\b",
    "\\btop[- ]?([0-9]+)"
  )
  for (pattern in patterns) {
    m <- regexec(pattern, x, ignore.case = TRUE, perl = TRUE)
    hit <- regmatches(x, m)[[1]]
    if (length(hit) >= 2) return(suppressWarnings(as.integer(hit[2])))
  }
  NA_integer_
}

origin_team <- function(x, fallback_team) {
  if (grepl("\\bown\\b", x, ignore.case = TRUE)) return(fallback_team)
  codes <- unlist(regmatches(x, gregexpr("\\b[A-Z]{3}\\b", x, perl = TRUE)), use.names = FALSE)
  codes <- map_short_code(codes)
  codes <- codes[codes %in% unname(team_code_map)]
  if (length(codes)) codes[1] else NA_character_
}

counterparty_team <- function(x, fallback_team) {
  codes <- unlist(regmatches(x, gregexpr("\\b[A-Z]{3}\\b", x, perl = TRUE)), use.names = FALSE)
  codes <- unique(map_short_code(codes))
  codes <- codes[codes %in% unname(team_code_map) & codes != fallback_team]
  if (length(codes)) codes[1] else NA_character_
}

normalize_pick_rows <- function(team, year, round, text, count_text) {
  fragments <- split_pick_fragments(text)
  if (!length(fragments)) return(NULL)
  total_count <- count_value(count_text)
  rows <- lapply(seq_along(fragments), function(i) {
    fragment <- fragments[i]
    if (starts_outgoing(fragment)) return(NULL)
    if (is_non_asset_fragment(fragment)) return(NULL)
    cutoff <- protection_cutoff(fragment)
    data.frame(
      team = team,
      draft_year = as.integer(year),
      round = as.integer(round),
      asset_index = as.integer(i),
      asset_type = pick_asset_type(fragment),
      description = fragment,
      pick_count = total_count,
      protection = ifelse(is.na(cutoff), NA_character_, paste0("top-", cutoff)),
      protection_cutoff = cutoff,
      origin_team = origin_team(fragment, team),
      counterparty_team = counterparty_team(fragment, team),
      source = "RealGM Future Draft Picks By Team",
      source_url = source_url,
      scraped_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
      stringsAsFactors = FALSE
    )
  })
  out <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(out) || !nrow(out)) return(NULL)
  out
}

parse_realgm_tables <- function(html) {
  if (!requireNamespace("xml2", quietly = TRUE) || !requireNamespace("rvest", quietly = TRUE)) {
    stop("Packages 'xml2' and 'rvest' are required.")
  }
  doc <- xml2::read_html(paste(html, collapse = "\n"))
  headers <- rvest::html_elements(doc, xpath = "//h2[contains(., 'Future NBA Draft Picks')]")
  rows <- lapply(headers, function(header) {
    header_text <- clean_text(rvest::html_text2(header))
    team_name <- sub("\\s+Future NBA Draft Picks$", "", header_text)
    team <- repo_team_code(team_name)
    table <- rvest::html_element(header, xpath = "following::table[1]")
    if (length(table) == 0 || is.na(table)) return(NULL)
    html_rows <- rvest::html_elements(table, xpath = ".//tr")
    parsed_rows <- lapply(html_rows, function(row) {
      cells <- rvest::html_elements(row, xpath = "./td")
      if (length(cells) < 3) return(NULL)
      year <- suppressWarnings(as.integer(clean_text(rvest::html_text2(cells[[1]]))))
      if (!is.finite(year)) return(NULL)
      first <- parse_html_pick_cell(cells[[2]])
      second <- parse_html_pick_cell(cells[[3]])
      rbind(
        normalize_pick_rows(team, year, 1L, first$text, first$count),
        normalize_pick_rows(team, year, 2L, second$text, second$count)
      )
    })
    do.call(rbind, parsed_rows[!vapply(parsed_rows, is.null, logical(1))])
  })
  out <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(out)) out <- data.frame()
  out
}

is_count_line <- function(x) {
  grepl("^(0|[0-9]+)(\\s*(\\+|or)\\s*[0-9]+)*$", clean_text(x), ignore.case = TRUE)
}

collapse_text_lines <- function(x) {
  x <- clean_text(x)
  x <- x[nzchar(x)]
  paste(x, collapse = "; ")
}

parse_html_pick_cell <- function(cell) {
  lines <- unlist(strsplit(rvest::html_text2(cell), "\n", fixed = TRUE), use.names = FALSE)
  lines <- clean_text(lines)
  lines <- lines[nzchar(lines)]
  if (!length(lines)) return(list(text = "", count = NA_character_))
  count <- NA_character_
  if (is_count_line(lines[length(lines)])) {
    count <- lines[length(lines)]
    lines <- lines[-length(lines)]
  }
  list(text = collapse_text_lines(lines), count = count)
}

parse_realgm_text_section <- function(team, lines) {
  lines <- clean_text(lines)
  lines <- lines[nzchar(lines)]
  out <- list()
  i <- 1L
  while (i <= length(lines)) {
    if (!grepl("^[0-9]{4}$", lines[i])) {
      i <- i + 1L
      next
    }
    year <- suppressWarnings(as.integer(lines[i]))
    i <- i + 1L
    row_lines <- character()
    while (i <= length(lines) && !grepl("^[0-9]{4}$", lines[i]) && !grepl("^##\\s+", lines[i])) {
      row_lines <- c(row_lines, lines[i])
      i <- i + 1L
    }
    row_lines <- row_lines[!grepl("^Year\\s+First Round\\s+Second Round$", row_lines, ignore.case = TRUE)]
    count_idx <- which(vapply(row_lines, is_count_line, logical(1)))
    if (length(count_idx) < 2L) next
    first_text <- collapse_text_lines(row_lines[seq_len(count_idx[1L] - 1L)])
    first_count <- row_lines[count_idx[1L]]
    second_start <- count_idx[1L] + 1L
    second_end <- count_idx[2L] - 1L
    second_text <- if (second_start <= second_end) collapse_text_lines(row_lines[second_start:second_end]) else ""
    second_count <- row_lines[count_idx[2L]]
    out[[length(out) + 1L]] <- rbind(
      normalize_pick_rows(team, year, 1L, first_text, first_count),
      normalize_pick_rows(team, year, 2L, second_text, second_count)
    )
  }
  out <- do.call(rbind, out[!vapply(out, is.null, logical(1))])
  if (is.null(out)) data.frame() else out
}

parse_realgm_text <- function(text) {
  lines <- clean_text(text)
  lines <- lines[nzchar(lines)]
  heading_idx <- grep("^##\\s+.+\\s+Future NBA Draft Picks$", lines)
  rows <- lapply(seq_along(heading_idx), function(pos) {
    start <- heading_idx[pos]
    end <- if (pos < length(heading_idx)) heading_idx[pos + 1L] - 1L else length(lines)
    header <- sub("^##\\s+", "", lines[start])
    team_name <- sub("\\s+Future NBA Draft Picks$", "", header)
    team <- repo_team_code(team_name)
    parse_realgm_text_section(team, lines[(start + 1L):end])
  })
  out <- do.call(rbind, rows[!vapply(rows, is.null, logical(1))])
  if (is.null(out)) out <- data.frame()
  out
}

source <- read_source()
picks <- if (source$kind == "text") parse_realgm_text(source$lines) else parse_realgm_tables(source$lines)
if (!nrow(picks)) {
  stop("Parsed zero RealGM future-pick rows from ", source$kind, " source.")
}
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
utils::write.csv(picks, out_csv, row.names = FALSE, na = "")
cat("Wrote", nrow(picks), "future pick rows to", out_csv, "\n")
