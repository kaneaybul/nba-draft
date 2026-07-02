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
    if (dir.exists(file.path(candidate, "processed")) && dir.exists(file.path(candidate, "script"))) {
      return(candidate)
    }
  }
  stop("Could not resolve project root.")
}

if (!exists("frontend_timing_run_id", mode = "function")) {
  frontend_timing_run_id <- function() {
    run_id <- Sys.getenv("FRONTEND_REFRESH_RUN_ID", "")
    if (!nzchar(run_id)) {
      run_id <- format(Sys.time(), "%Y%m%dT%H%M%SZ", tz = "UTC")
      Sys.setenv(FRONTEND_REFRESH_RUN_ID = run_id)
    }
    run_id
  }
}

if (!exists("frontend_timing_path", mode = "function")) {
  frontend_timing_path <- function(base_dir) {
    file.path(base_dir, "processed", "logs", "frontend_refresh_timings.csv")
  }
}

if (!exists("frontend_log_timing", mode = "function")) {
  frontend_log_timing <- function(base_dir, phase, step, status, started_at, finished_at, detail = "") {
    path <- frontend_timing_path(base_dir)
    dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
    elapsed_seconds <- as.numeric(difftime(finished_at, started_at, units = "secs"))
    row <- data.frame(
      run_id = frontend_timing_run_id(),
      phase = phase,
      step = step,
      status = status,
      started_at = format(started_at, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
      finished_at = format(finished_at, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
      elapsed_seconds = round(elapsed_seconds, 3),
      detail = detail,
      stringsAsFactors = FALSE
    )
    write.table(
      row,
      file = path,
      sep = ",",
      row.names = FALSE,
      col.names = !file.exists(path),
      append = file.exists(path),
      quote = TRUE
    )
    message(sprintf("Timing: [%s] %s - %s in %.3fs", status, step, phase, elapsed_seconds))
  }
}

if (!exists("with_frontend_timing", mode = "function")) {
  with_frontend_timing <- function(base_dir, phase, step, expr, detail = "") {
    started_at <- Sys.time()
    tryCatch(
      {
        result <- force(expr)
        frontend_log_timing(base_dir, phase, step, "success", started_at, Sys.time(), detail)
        invisible(result)
      },
      error = function(e) {
        frontend_log_timing(base_dir, phase, step, "failed", started_at, Sys.time(), conditionMessage(e))
        stop(e)
      }
    )
  }
}

if (!exists("print_frontend_timing_summary", mode = "function")) {
  print_frontend_timing_summary <- function(base_dir) {
    path <- frontend_timing_path(base_dir)
    run_id <- frontend_timing_run_id()
    if (!file.exists(path)) {
      return(invisible(NULL))
    }
    timings <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    timings <- timings[timings$run_id == run_id, , drop = FALSE]
    if (!nrow(timings)) {
      return(invisible(NULL))
    }

    message("")
    message("Frontend refresh timing summary")
    message("Log: ", path)
    for (i in seq_len(nrow(timings))) {
      message(sprintf(
        "- %s / %s: %s (%.3fs)",
        timings$phase[i],
        timings$step[i],
        timings$status[i],
        suppressWarnings(as.numeric(timings$elapsed_seconds[i]))
      ))
    }
  }
}

read_csv_required <- function(path, required = character()) {
  if (!file.exists(path)) {
    stop("Missing required input: ", path)
  }
  out <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  missing <- setdiff(required, names(out))
  if (length(missing) > 0) {
    stop("Missing columns in ", path, ": ", paste(missing, collapse = ", "))
  }
  out
}

read_csv_optional <- function(path, cols = character()) {
  if (file.exists(path)) {
    return(read.csv(path, stringsAsFactors = FALSE, check.names = FALSE))
  }
  out <- as.data.frame(setNames(replicate(length(cols), logical(), simplify = FALSE), cols), stringsAsFactors = FALSE)
  out
}

coalesce_col <- function(primary, fallback) {
  ifelse(!is.na(primary) & primary != "", primary, fallback)
}

coalesce_numeric <- function(primary, fallback) {
  primary <- suppressWarnings(as.numeric(primary))
  fallback <- suppressWarnings(as.numeric(fallback))
  ifelse(is.finite(primary), primary, fallback)
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

is_blank_text <- function(x) {
  is.na(x) | !nzchar(trimws(as.character(x)))
}

attach_contract_ids_from_history <- function(base_dir, contracts) {
  if (!("nba_id" %in% names(contracts)) || !("player_name" %in% names(contracts))) {
    return(contracts)
  }

  missing_id <- is.na(suppressWarnings(as.integer(contracts$nba_id)))
  if (!any(missing_id)) {
    return(contracts)
  }

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (!file.exists(stats_path)) {
    return(contracts)
  }

  stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
  name_col <- names(stats)[names(stats) %in% c("player_name", "player", "PLAYER_NAME", "name", "Name")][1]
  if (!("nba_id" %in% names(stats)) || is.na(name_col)) {
    return(contracts)
  }

  players <- data.frame(
    nba_id = suppressWarnings(as.integer(stats$nba_id)),
    name_key = normalize_name(stats[[name_col]]),
    stringsAsFactors = FALSE
  )
  players <- players[!is.na(players$nba_id) & players$name_key != "", ]
  counts <- aggregate(players$nba_id, by = list(name_key = players$name_key), FUN = function(v) length(unique(v)))
  names(counts)[2] <- "id_count"
  players <- merge(players, counts, by = "name_key", all.x = TRUE)
  players <- players[players$id_count == 1, c("name_key", "nba_id"), drop = FALSE]
  players <- players[!duplicated(players$name_key), ]

  key <- normalize_name(contracts$player_name)
  matched <- players$nba_id[match(key, players$name_key)]
  contracts$nba_id[missing_id & !is.na(matched)] <- matched[missing_id & !is.na(matched)]
  contracts
}

percent_rank <- function(x) {
  ok <- !is.na(x)
  out <- rep(NA_real_, length(x))
  if (sum(ok) == 1) {
    out[ok] <- 1
  } else if (sum(ok) > 1) {
    out[ok] <- (rank(x[ok], ties.method = "average") - 1) / (sum(ok) - 1)
  }
  out
}

percent_rank_against <- function(x, reference) {
  x <- suppressWarnings(as.numeric(x))
  reference <- sort(suppressWarnings(as.numeric(reference)))
  reference <- reference[is.finite(reference)]
  out <- rep(NA_real_, length(x))
  if (length(reference) == 1) {
    out[is.finite(x)] <- ifelse(x[is.finite(x)] >= reference[[1]], 1, 0)
    return(out)
  }
  if (length(reference) > 1) {
    ok <- is.finite(x)
    below <- findInterval(x[ok], reference, left.open = FALSE)
    out[ok] <- clamp((below - 1) / (length(reference) - 1), 0, 1)
  }
  out
}

clamp <- function(x, lo, hi) pmax(lo, pmin(hi, x))

zero_sum_round <- function(x, digits = 2) {
  rounded <- round(x, digits)
  finite <- which(is.finite(rounded))
  if (!length(finite)) return(rounded)
  scale <- 10^digits
  residual_units <- as.integer(round(sum(rounded[finite], na.rm = TRUE) * scale))
  if (residual_units == 0L) return(rounded)
  adjust_count <- min(abs(residual_units), length(finite))
  adjust_idx <- finite[seq_len(adjust_count)]
  rounded[adjust_idx] <- rounded[adjust_idx] - sign(residual_units) / scale
  rounded
}

json_escape <- function(x) {
  x <- as.character(x)
  x <- gsub("\\\\", "\\\\\\\\", x, fixed = FALSE)
  x <- gsub("\"", "\\\\\"", x, fixed = TRUE)
  x <- gsub("\r", "\\\\r", x, fixed = TRUE)
  x <- gsub("\n", "\\\\n", x, fixed = TRUE)
  x <- gsub("\t", "\\\\t", x, fixed = TRUE)
  x
}

json_value <- function(x) {
  if (length(x) == 0 || is.na(x)) {
    return("null")
  }
  if (inherits(x, "Date") || inherits(x, "POSIXt")) {
    return(paste0("\"", json_escape(format(x, "%Y-%m-%dT%H:%M:%SZ")), "\""))
  }
  if (is.logical(x)) {
    return(ifelse(isTRUE(x), "true", "false"))
  }
  if (is.numeric(x) || is.integer(x)) {
    if (!is.finite(x)) return("null")
    return(format(x, scientific = FALSE, trim = TRUE, digits = 12))
  }
  paste0("\"", json_escape(x), "\"")
}

prepare_json_df <- function(df) {
  names(df) <- make.names(names(df), unique = TRUE)
  for (nm in names(df)) {
    if (is.numeric(df[[nm]]) || is.integer(df[[nm]])) {
      bad <- !is.finite(df[[nm]])
      if (any(bad, na.rm = TRUE)) {
        df[[nm]][bad] <- NA
      }
    }
  }
  df
}

write_json_df_fallback <- function(df, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  df <- prepare_json_df(df)
  rows <- character(nrow(df))
  for (i in seq_len(nrow(df))) {
    fields <- vapply(names(df), function(nm) {
      paste0("\"", json_escape(nm), "\":", json_value(df[[nm]][i]))
    }, character(1))
    rows[i] <- paste0("{", paste(fields, collapse = ","), "}")
  }
  writeLines(c("[", paste(rows, collapse = ",\n"), "]"), path, useBytes = TRUE)
}

write_json_object_fallback <- function(items, path) {
  fields <- vapply(names(items), function(nm) {
    value <- items[[nm]]
    if (is.data.frame(value)) {
      tmp <- tempfile(fileext = ".json")
      write_json_df_fallback(value, tmp)
      raw <- paste(readLines(tmp, warn = FALSE), collapse = "\n")
      unlink(tmp)
      paste0("\"", json_escape(nm), "\":", raw)
    } else {
      paste0("\"", json_escape(nm), "\":", json_value(value))
    }
  }, character(1))
  writeLines(c("{", paste(fields, collapse = ",\n"), "}"), path, useBytes = TRUE)
}

replace_file <- function(tmp, path) {
  if (file.exists(path)) {
    unlink(path)
  }
  ok <- file.rename(tmp, path)
  if (!ok) {
    copied <- file.copy(tmp, path, overwrite = TRUE)
    if (!copied) {
      stop("Could not replace JSON output: ", path)
    }
    unlink(tmp)
  }
  invisible(NULL)
}

jsonlite_available <- function() {
  requireNamespace("jsonlite", quietly = TRUE)
}

write_json_df <- function(df, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  df <- prepare_json_df(df)
  tmp <- tempfile(pattern = paste0(basename(path), "."), tmpdir = dirname(path))
  on.exit(unlink(tmp), add = TRUE)
  if (jsonlite_available()) {
    jsonlite::write_json(
      df,
      tmp,
      dataframe = "rows",
      na = "null",
      auto_unbox = TRUE,
      digits = 12
    )
    replace_file(tmp, path)
    return(invisible(NULL))
  }
  write_json_df_fallback(df, tmp)
  replace_file(tmp, path)
}

write_json_object <- function(items, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  items <- lapply(items, function(value) {
    if (is.data.frame(value)) {
      prepare_json_df(value)
    } else {
      value
    }
  })
  tmp <- tempfile(pattern = paste0(basename(path), "."), tmpdir = dirname(path))
  on.exit(unlink(tmp), add = TRUE)
  if (jsonlite_available()) {
    jsonlite::write_json(
      items,
      tmp,
      dataframe = "rows",
      na = "null",
      auto_unbox = TRUE,
      digits = 12
    )
    replace_file(tmp, path)
    return(invisible(NULL))
  }
  write_json_object_fallback(items, tmp)
  replace_file(tmp, path)
}

team_conference <- function(team) {
  east <- c("ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS")
  west <- c("DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA")
  ifelse(team %in% east, "East", ifelse(team %in% west, "West", "Unknown"))
}

team_metadata <- function() {
  data.frame(
    team_abbr = c(
      "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
      "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
      "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
    ),
    team_name = c(
      "Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls",
      "Cleveland Cavaliers", "Dallas Mavericks", "Denver Nuggets", "Detroit Pistons",
      "Golden State Warriors", "Houston Rockets", "Indiana Pacers", "LA Clippers",
      "Los Angeles Lakers", "Memphis Grizzlies", "Miami Heat", "Milwaukee Bucks",
      "Minnesota Timberwolves", "New Orleans Pelicans", "New York Knicks", "Oklahoma City Thunder",
      "Orlando Magic", "Philadelphia 76ers", "Phoenix Suns", "Portland Trail Blazers",
      "Sacramento Kings", "San Antonio Spurs", "Toronto Raptors", "Utah Jazz", "Washington Wizards"
    ),
    nba_team_id = c(
      1610612737, 1610612738, 1610612751, 1610612766, 1610612741, 1610612739,
      1610612742, 1610612743, 1610612765, 1610612744, 1610612745, 1610612754,
      1610612746, 1610612747, 1610612763, 1610612748, 1610612749, 1610612750,
      1610612740, 1610612752, 1610612760, 1610612753, 1610612755, 1610612756,
      1610612757, 1610612758, 1610612759, 1610612761, 1610612762, 1610612764
    ),
    conference = team_conference(c(
      "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
      "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
      "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
    )),
    stringsAsFactors = FALSE
  )
}

team_logo_url <- function(nba_team_id) {
  ifelse(
    is.finite(suppressWarnings(as.numeric(nba_team_id))),
    paste0("https://cdn.nba.com/logos/nba/", nba_team_id, "/primary/L/logo.svg"),
    NA_character_
  )
}

team_abbr_from_name <- function(team_name) {
  meta <- team_metadata()
  names <- c(meta$team_name, "Los Angeles Clippers", "LA Clippers", "Phoenix Suns", "Brooklyn Nets", "Charlotte Bobcats")
  abbrs <- c(meta$team_abbr, "LAC", "LAC", "PHX", "BKN", "CHA")
  key <- trimws(as.character(team_name))
  out <- abbrs[match(key, names)]
  normalize_team(ifelse(is.na(out), key, out))
}

team_count <- function() 30L

rotation_slots_per_position <- function() {
  2L * team_count()
}

replacement_slots_per_position <- function() {
  65L
}

replacement_pool_years <- function() {
  3L
}

replacement_min_minutes <- function() {
  250
}

rank_cutoff_value <- function(values, cutoff) {
  values <- sort(values[is.finite(values)], decreasing = TRUE)
  if (length(values) == 0) {
    return(NA_real_)
  }
  values[[min(cutoff, length(values))]]
}

weighted_rank_cutoff_value <- function(values, weights, cutoff) {
  values <- suppressWarnings(as.numeric(values))
  weights <- suppressWarnings(as.numeric(weights))
  keep <- is.finite(values) & is.finite(weights) & weights > 0
  values <- values[keep]
  weights <- weights[keep]
  if (length(values) == 0 || sum(weights) <= 0) return(NA_real_)
  ord <- order(values, decreasing = TRUE)
  values <- values[ord]
  weights <- weights[ord]
  hit <- which(cumsum(weights) >= cutoff)
  values[[if (length(hit) > 0) hit[[1]] else length(values)]]
}

valid_positions <- function() c("PG", "SG", "SF", "PF", "C")

position_share_columns <- function() {
  c("pg_share", "sg_share", "sf_share", "pf_share", "c_share")
}

position_parts <- function(position) {
  parts <- unlist(strsplit(toupper(as.character(position)), "[-/[:space:]]+"))
  parts[parts %in% valid_positions()]
}

normalize_position_label <- function(position) {
  vapply(as.character(position), function(pos) {
    parts <- position_parts(pos)
    if (length(parts) == 0) return(NA_character_)
    paste(parts, collapse = "/")
  }, character(1), USE.NAMES = FALSE)
}

primary_position_label <- function(position) {
  vapply(as.character(position), function(pos) {
    parts <- position_parts(pos)
    if (length(parts) == 0) return(NA_character_)
    parts[[1]]
  }, character(1), USE.NAMES = FALSE)
}

position_share_matrix_from_labels <- function(position) {
  cols <- position_share_columns()
  out <- matrix(0, nrow = length(position), ncol = length(cols), dimnames = list(NULL, cols))
  for (i in seq_along(position)) {
    parts <- position_parts(position[[i]])
    if (length(parts) == 0) next
    col_idx <- match(tolower(parts), sub("_share$", "", cols))
    out[i, col_idx] <- 1 / length(parts)
  }
  out
}

normalize_position_share_matrix <- function(shares, fallback_position = NULL) {
  cols <- position_share_columns()
  if (is.null(shares) || !is.data.frame(shares) || !all(cols %in% names(shares))) {
    if (is.null(fallback_position)) fallback_position <- rep(NA_character_, 0)
    return(position_share_matrix_from_labels(fallback_position))
  }
  out <- as.matrix(shares[, cols, drop = FALSE])
  storage.mode(out) <- "numeric"
  out[!is.finite(out) | out < 0] <- 0
  row_sums <- rowSums(out, na.rm = TRUE)
  can_normalize <- row_sums > 0
  out[can_normalize, ] <- out[can_normalize, , drop = FALSE] / row_sums[can_normalize]
  if (!is.null(fallback_position)) {
    fallback <- position_share_matrix_from_labels(fallback_position)
    needs_fallback <- !can_normalize & rowSums(fallback, na.rm = TRUE) > 0
    out[needs_fallback, ] <- fallback[needs_fallback, , drop = FALSE]
  }
  colnames(out) <- cols
  out
}

position_label_from_shares <- function(shares, fallback_position = NA_character_, single_threshold = 0.65, secondary_threshold = 0.20) {
  positions <- valid_positions()
  names(shares) <- positions
  shares[!is.finite(shares)] <- 0
  if (sum(shares) <= 0) return(normalize_position_label(fallback_position))
  ord <- order(shares, decreasing = TRUE)
  primary <- positions[[ord[[1]]]]
  secondary <- positions[[ord[[2]]]]
  if (shares[[ord[[1]]]] >= single_threshold || shares[[ord[[2]]]] < secondary_threshold) {
    return(primary)
  }
  paste(primary, secondary, sep = "/")
}

position_labels_from_share_matrix <- function(shares, fallback_position = NA_character_) {
  vapply(seq_len(nrow(shares)), function(i) {
    fb <- if (length(fallback_position) >= i) fallback_position[[i]] else NA_character_
    position_label_from_shares(shares[i, ], fb)
  }, character(1), USE.NAMES = FALSE)
}

primary_position_from_shares <- function(shares, fallback_position = NA_character_) {
  positions <- valid_positions()
  names(shares) <- positions
  shares[!is.finite(shares)] <- 0
  if (sum(shares) <= 0) return(primary_position_label(fallback_position))
  positions[[order(shares, decreasing = TRUE)[[1]]]]
}

primary_position_labels_from_share_matrix <- function(shares, fallback_position = NA_character_) {
  vapply(seq_len(nrow(shares)), function(i) {
    fb <- if (length(fallback_position) >= i) fallback_position[[i]] else NA_character_
    primary_position_from_shares(shares[i, ], fb)
  }, character(1), USE.NAMES = FALSE)
}

primary_position_export <- function(df) {
  if (!("position" %in% names(df))) return(df)
  share_cols <- intersect(position_share_columns(), names(df))
  if (length(share_cols) > 0) {
    shares <- normalize_position_share_matrix(df[, share_cols, drop = FALSE], df$position)
    df$position <- primary_position_labels_from_share_matrix(shares, df$position)
  } else {
    df$position <- primary_position_label(df$position)
  }
  df$position <- ifelse(is.na(df$position) | df$position == "", "UNK", df$position)
  df
}

lineup_position_export <- function(df) {
  if (!all(c("position", "position_group") %in% names(df))) return(primary_position_export(df))
  df$position <- vapply(seq_len(nrow(df)), function(i) {
    parts <- position_parts(df$position[[i]])
    group <- as.character(df$position_group[[i]])
    preferred <- switch(group,
      Guard = parts[parts %in% c("PG", "SG")],
      Forward = parts[parts %in% c("SF", "PF")],
      Center = parts[parts == "C"],
      character(0)
    )
    if (length(preferred)) return(preferred[[1]])
    primary_position_label(df$position[[i]])
  }, character(1), USE.NAMES = FALSE)
  df$position <- ifelse(is.na(df$position) | df$position == "", "UNK", df$position)
  df
}

position_entropy_from_shares <- function(shares) {
  apply(shares, 1, function(row) {
    row <- row[is.finite(row) & row > 0]
    if (length(row) == 0) return(NA_real_)
    -sum(row * log(row)) / log(5)
  })
}

position_index_from_shares <- function(shares) {
  idx <- as.numeric(seq_along(valid_positions()))
  out <- as.numeric(shares %*% idx)
  out[rowSums(shares, na.rm = TRUE) <= 0] <- NA_real_
  out
}

tier_from_score <- function(score) {
  rank <- rank(-score, ties.method = "first", na.last = "keep")
  out <- rep("Project", length(score))
  out[is.na(score) | score < 0] <- "Out"
  valid <- !is.na(score) & score >= 0 & !is.na(rank)
  out[valid & rank <= 330] <- "Deep Bench"
  out[valid & rank <= 270] <- "Bench"
  out[valid & rank <= 210] <- "Strong Bench"
  out[valid & rank <= 150] <- "Fringe Starter"
  out[valid & rank <= 120] <- "Starter"
  out[valid & rank <= 60] <- "Elite Starter"
  out[valid & rank <= 30] <- "Star"
  out[valid & rank <= 10] <- "Superstar"
  out[valid & rank == 1] <- "MVP"
  out
}

replacement_level <- function(position, side) {
  if (identical(side, "total")) {
    return(replacement_level(position, "offense") + replacement_level(position, "defense"))
  }

  pos <- normalize_position_label(position)
  default <- if (identical(side, "offense")) -1.5 else -0.7
  level_map <- if (identical(side, "offense")) {
    c(PG = -2.0, SG = -1.0, SF = -2.1, PF = -1.9, C = -1.7)
  } else {
    c(PG = -1.5, SG = -0.7, SF = -1.3, PF = -0.8, C = -0.5)
  }
  vapply(pos, function(one_pos) {
    parts <- position_parts(one_pos)
    if (length(parts) == 0) return(default)
    mean(unname(level_map[parts]), na.rm = TRUE)
  }, numeric(1), USE.NAMES = FALSE)
}

replacement_reference_lookup <- function(replacement_reference, position, side = "total") {
  if (is.null(replacement_reference) || !is.data.frame(replacement_reference)) {
    return(rep(NA_real_, length(position)))
  }
  needed <- c("position", paste0("replacement_", side))
  if (!all(needed %in% names(replacement_reference))) {
    return(rep(NA_real_, length(position)))
  }
  ref_pos <- toupper(as.character(replacement_reference$position))
  ref_val <- suppressWarnings(as.numeric(replacement_reference[[paste0("replacement_", side)]]))
  vapply(as.character(position), function(pos) {
    parts <- position_parts(pos)
    vals <- ref_val[match(parts, ref_pos)]
    vals <- vals[is.finite(vals)]
    if (length(vals) == 0) NA_real_ else mean(vals)
  }, numeric(1))
}

draft_position_from_code <- function(pos_code) {
  code <- suppressWarnings(as.integer(pos_code))
  ifelse(code == 1, "PG",
    ifelse(code == 2, "SG",
      ifelse(code == 3, "SF",
        ifelse(code == 4, "PF",
          ifelse(code == 5, "C",
            ifelse(code == 12, "PG/SG",
              ifelse(code == 23, "SG/SF",
                ifelse(code == 34, "SF/PF",
                  ifelse(code == 45, "PF/C", "UNK")))))))))
}

primary_draft_position_from_code <- function(pos_code) {
  code <- suppressWarnings(as.integer(pos_code))
  ifelse(code == 1 | code == 12, "PG",
    ifelse(code == 2 | code == 23, "SG",
      ifelse(code == 3 | code == 34, "SF",
        ifelse(code == 4 | code == 45, "PF",
          ifelse(code == 5, "C", "UNK")))))
}

draft_tier_from_score <- function(score) {
  out <- rep("Project", length(score))
  out[is.na(score) | score < 0] <- "Out"
  out[score >= 25] <- "Deep Bench"
  out[score >= 45] <- "Bench"
  out[score >= 59] <- "Strong Bench"
  out[score >= 69] <- "Fringe Starter"
  out[score >= 79] <- "Starter"
  out[score >= 89] <- "Elite Starter"
  out[score >= 94] <- "Star"
  out[score >= 97] <- "Superstar"
  out[score >= 99.5] <- "MVP"
  out
}

draft_replacement_total <- function(position, replacement_reference = NULL, shares = NULL) {
  share_matrix <- NULL
  if (!is.null(shares)) {
    share_df <- as.data.frame(shares, stringsAsFactors = FALSE)
    share_matrix <- normalize_position_share_matrix(share_df, position)
  }

  ref_positions <- valid_positions()
  ref_values <- replacement_level(ref_positions, "total")
  if (!is.null(replacement_reference) && is.data.frame(replacement_reference)) {
    needed <- c("position", "replacement_total")
    if (all(needed %in% names(replacement_reference))) {
      match_idx <- match(ref_positions, toupper(as.character(replacement_reference$position)))
      matched_values <- suppressWarnings(as.numeric(replacement_reference$replacement_total[match_idx]))
      ref_values[is.finite(matched_values)] <- matched_values[is.finite(matched_values)]
    }
  }

  from_reference <- replacement_reference_lookup(replacement_reference, position, "total")
  vapply(seq_along(position), function(i) {
    if (!is.null(share_matrix) && i <= nrow(share_matrix)) {
      row_shares <- share_matrix[i, ]
      use <- is.finite(row_shares) & row_shares > 0 & is.finite(ref_values)
      if (any(use)) {
        return(sum(ref_values[use] * row_shares[use]) / sum(row_shares[use]))
      }
    }

    pos <- as.character(position[[i]])
    ref_value <- from_reference[[i]]
    if (is.finite(ref_value)) {
      return(ref_value)
    }
    parts <- position_parts(pos)
    if (length(parts) == 0) {
      return(replacement_level("UNK", "total"))
    }
    mean(replacement_level(parts, "total"), na.rm = TRUE)
  }, numeric(1))
}

replacement_from_data <- function(df, side) {
  metric <- if (identical(side, "offense")) {
    df$offense
  } else if (identical(side, "defense")) {
    df$defense
  } else {
    df$total
  }
  fallback <- replacement_level(df$position, side)
  out <- rep(NA_real_, nrow(df))
  shares <- normalize_position_share_matrix(df[, intersect(position_share_columns(), names(df)), drop = FALSE], df$position)
  cutoff <- replacement_slots_per_position()
  pool_years <- replacement_pool_years()
  replacement_minutes <- if ("Minutes" %in% names(df)) suppressWarnings(as.numeric(df$Minutes)) else rep(Inf, nrow(df))
  eligible <- !is.na(metric) &
    is.finite(metric) &
    is.finite(replacement_minutes) &
    replacement_minutes >= replacement_min_minutes() &
    rowSums(shares, na.rm = TRUE) > 0

  years <- sort(unique(df$year[is.finite(df$year)]))
  positions <- valid_positions()
  levels <- matrix(NA_real_, nrow = length(years), ncol = length(positions), dimnames = list(as.character(years), positions))

  for (target_year in years) {
    for (target_pos in positions) {
      pos_col <- match(tolower(target_pos), sub("_share$", "", position_share_columns()))
      pool_idx <- eligible &
        df$year <= target_year &
        df$year > target_year - pool_years &
        shares[, pos_col] > 0
      pool_seasons <- unique(df$year[pool_idx])
      pooled_cutoff <- cutoff * max(1, length(pool_seasons))
      min_sample <- pooled_cutoff * 0.75
      weights <- shares[pool_idx, pos_col]
      if (sum(weights[is.finite(weights)], na.rm = TRUE) >= min_sample) {
        levels[as.character(target_year), target_pos] <- weighted_rank_cutoff_value(metric[pool_idx], weights, pooled_cutoff)
      }
    }
  }

  recent_year <- max(df$year, na.rm = TRUE) - pool_years + 1
  for (target_pos in positions) {
    pos_col <- match(tolower(target_pos), sub("_share$", "", position_share_columns()))
    values_idx <-
      eligible &
        df$year >= recent_year &
        shares[, pos_col] > 0
    recent_seasons <- unique(df$year[
      values_idx
    ])
    pooled_cutoff <- cutoff * max(1, length(recent_seasons))
    min_sample <- pooled_cutoff * 0.75
    weights <- shares[values_idx, pos_col]
    recent_level <- if (sum(weights[is.finite(weights)], na.rm = TRUE) >= min_sample) {
      weighted_rank_cutoff_value(metric[values_idx], weights, pooled_cutoff)
    } else {
      NA_real_
    }
    needs_recent <- is.na(levels[, target_pos])
    if (is.finite(recent_level) && any(needs_recent)) {
      levels[needs_recent, target_pos] <- recent_level
    }
  }

  for (i in seq_len(nrow(df))) {
    year_key <- as.character(df$year[[i]])
    if (!year_key %in% rownames(levels)) next
    vals <- levels[year_key, ]
    row_shares <- shares[i, ]
    use <- is.finite(vals) & is.finite(row_shares) & row_shares > 0
    if (any(use)) {
      out[[i]] <- sum(vals[use] * row_shares[use]) / sum(row_shares[use])
    }
  }

  ifelse(is.na(out), fallback, out)
}

replacement_reference_from_players <- function(players, latest_year = NULL) {
  if (is.null(players) || !is.data.frame(players) || nrow(players) == 0) {
    return(data.frame(position = valid_positions(), replacement_total = replacement_level(valid_positions(), "total")))
  }
  if (is.null(latest_year)) {
    latest_year <- max(players$year, na.rm = TRUE)
  }
  players <- players[
    is.finite(players$total) &
      suppressWarnings(as.integer(players$year)) <= latest_year,
    ,
    drop = FALSE
  ]
  shares <- normalize_position_share_matrix(players[, intersect(position_share_columns(), names(players)), drop = FALSE], players$position)
  ref_total <- replacement_from_data(players, "total")
  rows <- data.frame(position = valid_positions(), replacement_total = NA_real_, stringsAsFactors = FALSE)
  latest_rows <- players$year == latest_year
  for (pos in valid_positions()) {
    pos_col <- match(tolower(pos), sub("_share$", "", position_share_columns()))
    pos_rows <- latest_rows & shares[, pos_col] > 0 & is.finite(ref_total)
    if (any(pos_rows)) {
      rows$replacement_total[rows$position == pos] <- stats::weighted.mean(ref_total[pos_rows], shares[pos_rows, pos_col], na.rm = TRUE)
    }
  }
  missing_pos <- setdiff(valid_positions(), rows$position)
  if (length(missing_pos) > 0) {
    rows <- rbind(
      rows,
      data.frame(position = missing_pos, replacement_total = replacement_level(missing_pos, "total"), stringsAsFactors = FALSE)
    )
  }
  rows$replacement_total <- ifelse(is.finite(rows$replacement_total), rows$replacement_total, replacement_level(rows$position, "total"))
  rows[match(valid_positions(), rows$position), , drop = FALSE]
}

fallback_cap_assumptions <- function() {
  data.frame(
    year = 2016:2031,
    salary_cap = c(
      70000000, 94143000, 99093000, 101869000, 109140000,
      109140000, 112414000, 123655000, 136021000, 140588000,
      154647000, 166000000, 174300000, 183015000, 192166000, 201774000
    ),
    tax_level = c(
      84740000, 113287000, 119266000, 123733000, 132627000,
      132627000, 136606000, 150267000, 165294000, 170814000,
      187895000, NA_real_, NA_real_, NA_real_, NA_real_, NA_real_
    ),
    first_apron = c(
      NA_real_, NA_real_, NA_real_, NA_real_, NA_real_,
      138928000, 143002000, 156983000, 172346000, 178132000,
      195945000, 210321000, 220847000, 231889000, 243485000, 255659000
    ),
    second_apron = c(
      NA_real_, NA_real_, NA_real_, NA_real_, NA_real_,
      NA_real_, NA_real_, NA_real_, 182794000, 188931000,
      207824000, 222775000, 233914000, 245610000, 258246000, 271158000
    ),
    scale_cap = c(
      84740000, 113287000, 119266000, 123733000, 132627000,
      138928000, 143002000, 156983000, 172346000, 178132000,
      195945000, 210321000, 220847000, 231889000, 243485000, 255659000
    ),
    stringsAsFactors = FALSE
  )
}

load_cap_assumptions <- function(base_dir) {
  path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv")
  if (!file.exists(path)) return(fallback_cap_assumptions())
  caps <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  needed <- c("year", "salary_cap", "scale_cap")
  if (!all(needed %in% names(caps))) return(fallback_cap_assumptions())
  fallback <- fallback_cap_assumptions()
  for (nm in setdiff(names(fallback), names(caps))) {
    caps[[nm]] <- NA
  }
  for (nm in setdiff(names(caps), names(fallback))) {
    fallback[[nm]] <- NA
  }
  caps <- rbind(caps[, names(fallback), drop = FALSE], fallback[!(fallback$year %in% caps$year), names(fallback), drop = FALSE])
  caps <- caps[order(caps$year), ]
  caps
}

cap_for_year <- function(caps, year, col = "scale_cap") {
  if (!(col %in% names(caps))) col <- "salary_cap"
  out <- suppressWarnings(as.numeric(caps[[col]][match(year, caps$year)]))
  fallback <- suppressWarnings(as.numeric(caps[[col]][which.max(caps$year)]))
  out[is.na(out)] <- fallback
  as.numeric(out)
}

min_salary_for_yos <- function(yos, year, caps) {
  base_cap <- 140588000
  base_min <- c(
    `0` = 1157153,
    `1` = 1862265,
    `2` = 2087519,
    `3` = 2162606,
    `4` = 2237691,
    `5` = 2425403,
    `6` = 2613120,
    `7` = 2800834,
    `8` = 2988550,
    `9` = 3003427,
    `10` = 3303771
  )
  yos <- suppressWarnings(as.numeric(yos))
  yos <- ifelse(is.na(yos), 0, pmax(0, pmin(10, floor(yos))))
  scale <- cap_for_year(caps, year, "salary_cap") / base_cap
  round(as.numeric(base_min[as.character(yos)]) * scale, 0)
}

max_salary_pct_for_yos <- function(yos) {
  yos <- suppressWarnings(as.numeric(yos))
  ifelse(is.na(yos) | yos <= 6, 0.25, ifelse(yos <= 9, 0.30, 0.35))
}

max_salary_tier_for_yos <- function(yos) {
  yos <- suppressWarnings(as.numeric(yos))
  ifelse(is.na(yos) | yos <= 6, "0-6", ifelse(yos <= 9, "7-9", "10+"))
}

max_salary_for_yos <- function(yos, year, caps, prior_salary = NA_real_) {
  cap <- cap_for_year(caps, year, "salary_cap")
  base_max <- cap * max_salary_pct_for_yos(yos)
  prior_salary <- suppressWarnings(as.numeric(prior_salary))
  prior_max <- ifelse(!is.na(prior_salary) & prior_salary > 0, prior_salary * 1.05, NA_real_)
  round(pmax(base_max, prior_max, na.rm = TRUE), 0)
}

is_rookie_scale_rfa <- function(year, draft_year, overall_pick) {
  year <- suppressWarnings(as.numeric(year))
  draft_year <- suppressWarnings(as.numeric(draft_year))
  overall_pick <- suppressWarnings(as.numeric(overall_pick))
  is.finite(year) &
    is.finite(draft_year) &
    is.finite(overall_pick) &
    overall_pick >= 1 &
    overall_pick <= 30 &
    year - draft_year == 5
}

contract_status_from_salary <- function(
  salary,
  yoe,
  age,
  team = NA_character_,
  fallback = NA_character_,
  year = NA_real_,
  draft_year = NA_real_,
  overall_pick = NA_real_
) {
  salary <- suppressWarnings(as.numeric(salary))
  yoe <- suppressWarnings(as.numeric(yoe))
  age <- suppressWarnings(as.numeric(age))
  team <- as.character(team)
  fallback <- as.character(fallback)
  fallback <- ifelse(fallback == "Option/NG", NA_character_, fallback)
  out <- ifelse(is.finite(salary) & salary > 0, "Signed", NA_character_)
  out <- ifelse(!is.na(fallback) & nzchar(trimws(fallback)), fallback, out)
  is_fa <- is.na(out) & (!is.na(team) & team == "FA")
  rookie_scale_rfa <- rep(is_rookie_scale_rfa(year, draft_year, overall_pick), length.out = length(salary))
  out[is_fa] <- ifelse(
    rookie_scale_rfa[is_fa] |
      (!is.na(yoe[is_fa]) & yoe[is_fa] <= 4 & (is.na(age[is_fa]) | age[is_fa] <= 27)),
    "RFA",
    "UFA"
  )
  out
}

contract_status_label <- function(status, salary) {
  status <- as.character(status)
  status <- ifelse(status == "Option/NG", "Player Option", status)
  salary <- suppressWarnings(as.numeric(salary))
  ifelse(is.finite(salary) & salary > 0 & !is.na(status) & status != "Signed", status,
    ifelse(!is.finite(salary) | salary <= 0, status, "Signed")
  )
}

projection_roster_status <- function(status, salary) {
  status <- contract_status_label(status, salary)
  out <- rep("open_market", length(status))
  out[status == "Signed"] <- "signed"
  out[status == "RFA"] <- "restricted"
  out[status == "Team Option"] <- "team_controlled"
  out[status == "Player Option"] <- "player_option"
  out[status == "Rookie FA"] <- "rookie_fa"
  out[status == "UFA"] <- "open_ufa"
  out
}

prune_low_impact_ufas <- function(rows, impact_col = "projection_y1") {
  if (!nrow(rows) || !(impact_col %in% names(rows))) {
    return(rows)
  }
  threshold <- suppressWarnings(as.numeric(Sys.getenv("FRONTEND_UFA_MIN_PROJECTED_TOTAL", unset = "-2.5")))
  if (!is.finite(threshold)) threshold <- -2.5
  roster_status <- if ("projection_roster_status" %in% names(rows)) {
    as.character(rows$projection_roster_status)
  } else {
    projection_roster_status(rows$contract_status, rows$contract)
  }
  impact <- suppressWarnings(as.numeric(rows[[impact_col]]))
  rows[!(roster_status == "open_ufa" & is.finite(impact) & impact < threshold), , drop = FALSE]
}

live_minutes_estimate <- function(minutes, games, mpg, projection_minutes) {
  minutes <- suppressWarnings(as.numeric(minutes))
  games <- suppressWarnings(as.numeric(games))
  mpg <- suppressWarnings(as.numeric(mpg))
  projection_minutes <- suppressWarnings(as.numeric(projection_minutes))

  current_mpg <- ifelse(!is.na(games) & games > 0, minutes / games, mpg)
  role_minutes <- ifelse(!is.na(current_mpg) & current_mpg > 0, current_mpg * 70, NA_real_)
  blended <- ifelse(
    !is.na(role_minutes) & !is.na(projection_minutes),
    0.4 * role_minutes + 0.6 * projection_minutes,
    ifelse(!is.na(projection_minutes), projection_minutes,
      ifelse(!is.na(role_minutes), role_minutes, minutes)
    )
  )
  ifelse(!is.na(blended), clamp(blended, 250, 2850), NA_real_)
}

impact_skill_names <- function() c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")

projection_skill_col <- function(skill_name) paste0("projected_", tolower(skill_name))

final_pred_value <- function(df, metric) {
  final_col <- paste0("FINAL_", metric, "_pred")
  pred_col <- paste0(metric, "_pred")
  if (final_col %in% names(df) && pred_col %in% names(df)) {
    return(coalesce_numeric(df[[final_col]], df[[pred_col]]))
  }
  if (final_col %in% names(df)) return(suppressWarnings(as.numeric(df[[final_col]])))
  if (pred_col %in% names(df)) return(suppressWarnings(as.numeric(df[[pred_col]])))
  rep(NA_real_, nrow(df))
}

read_adjusted_draft_predictions <- function(base_dir) {
  adjusted_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_adjusted.csv")
  base_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv")
  path <- if (file.exists(adjusted_path)) adjusted_path else base_path
  if (!file.exists(path)) return(data.frame())
  read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
}

fit_rookie_deage_curves <- function(base_dir) {
  pred <- read_adjusted_draft_predictions(base_dir)
  skill_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "skilloutput.csv")
  impact_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv")
  if (!nrow(pred) || !file.exists(skill_path) || !file.exists(impact_path)) {
    return(list(metric_models = list(), minutes_model = NULL, fallback_minutes = 900))
  }

  skill_names <- impact_skill_names()
  metrics <- c("OFF", "DEF", "TOTAL", skill_names)
  pred$join_player <- if ("name_key" %in% names(pred)) as.character(pred$name_key) else normalize_name(pred$player)
  pred$draft_year <- suppressWarnings(as.integer(pred$draft_year))
  if (!("draft_age" %in% names(pred))) pred$draft_age <- NA_real_
  pred$draft_age <- suppressWarnings(as.numeric(pred$draft_age))
  if (!("pick_proxy" %in% names(pred))) pred$pick_proxy <- if ("actual_pick" %in% names(pred)) pred$actual_pick else NA_real_
  pred$pick_proxy <- suppressWarnings(as.numeric(pred$pick_proxy))
  if (!("FINAL_rank" %in% names(pred))) pred$FINAL_rank <- ave(-final_pred_value(pred, "TOTAL"), pred$draft_year, FUN = rank, ties.method = "first")
  pred$FINAL_rank <- suppressWarnings(as.numeric(pred$FINAL_rank))
  for (metric in metrics) {
    pred[[paste0("pred_", metric)]] <- final_pred_value(pred, metric)
  }
  pred$pred_TOTAL <- coalesce_numeric(pred$pred_TOTAL, pred$pred_OFF + pred$pred_DEF)

  skill <- read.csv(skill_path, stringsAsFactors = FALSE, check.names = FALSE)
  skill$join_player <- normalize_name(skill$player_name)
  skill$year <- suppressWarnings(as.integer(skill$year))
  for (skill_name in skill_names) {
    final_col <- paste0("FINAL_", skill_name)
    if (final_col %in% names(skill)) {
      skill[[skill_name]] <- coalesce_numeric(skill[[final_col]], skill[[skill_name]])
    }
  }
  skill$OFF_actual <- if ("FINAL_OFF" %in% names(skill)) coalesce_numeric(skill$FINAL_OFF, skill$OFF) else suppressWarnings(as.numeric(skill$OFF))
  skill$DEF_actual <- if ("FINAL_DEF" %in% names(skill)) coalesce_numeric(skill$FINAL_DEF, skill$DEF) else suppressWarnings(as.numeric(skill$DEF))
  skill$TOTAL_actual <- if ("FINAL_TOTAL" %in% names(skill)) coalesce_numeric(skill$FINAL_TOTAL, skill$TOTAL) else suppressWarnings(as.numeric(skill$TOTAL))
  for (skill_name in skill_names) {
    skill[[paste0(skill_name, "_actual")]] <- suppressWarnings(as.numeric(skill[[skill_name]]))
  }

  impact <- read.csv(impact_path, stringsAsFactors = FALSE, check.names = FALSE)
  impact$join_player <- normalize_name(impact$player_name)
  impact$year <- suppressWarnings(as.integer(impact$year))
  if (!("Minutes" %in% names(impact))) impact$Minutes <- NA_real_
  impact$rookie_minutes <- suppressWarnings(as.numeric(impact$Minutes))

  actual_cols <- c("join_player", "year", paste0(metrics, "_actual"))
  actual <- merge(
    skill[, intersect(actual_cols, names(skill)), drop = FALSE],
    impact[, c("join_player", "year", "rookie_minutes"), drop = FALSE],
    by = c("join_player", "year"),
    all.x = TRUE
  )
  pred$rookie_year <- pred$draft_year + 1L
  joined <- merge(pred, actual, by.x = c("join_player", "rookie_year"), by.y = c("join_player", "year"), all.x = FALSE)
  joined <- joined[is.finite(joined$draft_age), , drop = FALSE]

  metric_models <- list()
  for (metric in metrics) {
    actual_col <- paste0(metric, "_actual")
    pred_col <- paste0("pred_", metric)
    if (!all(c(actual_col, pred_col) %in% names(joined))) next
    df <- joined[is.finite(joined[[actual_col]]) & is.finite(joined[[pred_col]]) & is.finite(joined$draft_age), , drop = FALSE]
    if (nrow(df) < 20) next
    df$diff <- df[[actual_col]] - df[[pred_col]]
    metric_models[[metric]] <- tryCatch(lm(diff ~ draft_age, data = df), error = function(e) NULL)
  }

  minutes_df <- joined[
    is.finite(joined$rookie_minutes) &
      joined$rookie_minutes > 0 &
      is.finite(joined$pred_TOTAL) &
      is.finite(joined$draft_age),
    ,
    drop = FALSE
  ]
  if (!("pick_proxy" %in% names(minutes_df)) || sum(is.finite(minutes_df$pick_proxy)) < 20) {
    minutes_df$pick_proxy <- minutes_df$FINAL_rank
  }
  minutes_model <- NULL
  if (nrow(minutes_df) >= 40 && sum(is.finite(minutes_df$pick_proxy)) >= 40) {
    minutes_model <- tryCatch(lm(rookie_minutes ~ pick_proxy + pred_TOTAL + draft_age, data = minutes_df), error = function(e) NULL)
  }
  fallback_minutes <- if (nrow(minutes_df)) median(minutes_df$rookie_minutes, na.rm = TRUE) else 900
  list(metric_models = metric_models, minutes_model = minutes_model, fallback_minutes = fallback_minutes)
}

predict_rookie_adjustment <- function(curves, metric, draft_age) {
  model <- curves$metric_models[[metric]]
  if (is.null(model)) return(rep(0, length(draft_age)))
  out <- suppressWarnings(as.numeric(predict(model, newdata = data.frame(draft_age = draft_age))))
  out[!is.finite(out)] <- 0
  clamp(out, -2.5, 2.5)
}

predict_rookie_minutes <- function(curves, pick_proxy, total, draft_age) {
  pick_proxy <- suppressWarnings(as.numeric(pick_proxy))
  total <- suppressWarnings(as.numeric(total))
  draft_age <- suppressWarnings(as.numeric(draft_age))
  if (!is.null(curves$minutes_model)) {
    out <- suppressWarnings(as.numeric(predict(curves$minutes_model, newdata = data.frame(
      pick_proxy = pick_proxy,
      pred_TOTAL = total,
      draft_age = draft_age
    ))))
  } else {
    out <- rep(curves$fallback_minutes, length(total))
  }
  out[!is.finite(out)] <- curves$fallback_minutes
  clamp(out, 120, 2400)
}

load_rookie_scale_contracts <- function(base_dir) {
  path <- file.path(base_dir, "ref", "cap_tracker_rookie_scale.csv")
  if (!file.exists(path)) {
    return(data.frame(
      pick = integer(),
      first_year_salary = numeric(),
      second_year_salary = numeric(),
      third_year_salary = numeric(),
      fourth_year_salary = numeric(),
      stringsAsFactors = FALSE
    ))
  }
  scale <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  needed <- c("pick", "first_year_salary", "second_year_salary", "third_year_salary", "fourth_year_salary")
  if (!all(needed %in% names(scale))) return(scale[FALSE, , drop = FALSE])
  for (col in needed) scale[[col]] <- suppressWarnings(as.numeric(scale[[col]]))
  scale[is.finite(scale$pick), needed, drop = FALSE]
}

load_official_draft_order <- function(base_dir) {
  path <- file.path(base_dir, "frontend", "src", "OffseasonSimulator.tsx")
  if (!file.exists(path)) {
    return(data.frame(pick = integer(), team = character(), label = character(), stringsAsFactors = FALSE))
  }
  text <- paste(readLines(path, warn = FALSE), collapse = "\n")
  matches <- gregexpr("\\{\\s*pick:\\s*([0-9]+),\\s*team:\\s*\"([^\"]+)\",\\s*label:\\s*\"([^\"]+)\"\\s*\\}", text, perl = TRUE)
  items <- regmatches(text, matches)[[1]]
  if (!length(items) || identical(items, character(0))) {
    return(data.frame(pick = integer(), team = character(), label = character(), stringsAsFactors = FALSE))
  }
  parsed <- do.call(rbind, lapply(items, function(item) {
    groups <- regmatches(item, regexec("\\{\\s*pick:\\s*([0-9]+),\\s*team:\\s*\"([^\"]+)\",\\s*label:\\s*\"([^\"]+)\"\\s*\\}", item, perl = TRUE))[[1]]
    data.frame(
      pick = suppressWarnings(as.integer(groups[2])),
      team = normalize_team(groups[3]),
      label = groups[4],
      stringsAsFactors = FALSE
    )
  }))
  parsed[is.finite(parsed$pick), , drop = FALSE]
}

mock_picks_from_rank <- function(rank_proxy, model_rank, player) {
  n <- length(rank_proxy)
  rank_proxy <- suppressWarnings(as.numeric(rank_proxy))
  model_rank <- suppressWarnings(as.numeric(model_rank))
  fallback <- seq_len(n)
  rank_proxy[!is.finite(rank_proxy)] <- 999
  model_rank[!is.finite(model_rank)] <- fallback[!is.finite(model_rank)]
  ord <- order(rank_proxy, model_rank, as.character(player), na.last = TRUE)
  out <- rep(NA_integer_, n)
  out[ord] <- seq_len(n)
  out
}

rookie_projection_path <- function(rookie_value, model_value, horizon) {
  rookie_value <- suppressWarnings(as.numeric(rookie_value))
  model_value <- suppressWarnings(as.numeric(model_value))
  progress <- c(0.40, 0.65, 0.85, 1.00, 1.05)[horizon]
  target <- coalesce_numeric(model_value, rookie_value)
  out <- rookie_value + (target - rookie_value) * progress
  out[!is.finite(out)] <- rookie_value[!is.finite(out)]
  out
}

calc_fa_market_values <- function(df, caps, horizon = 1, target_roster_spots = 450) {
  n <- nrow(df)
  out <- data.frame(
    fa_value = rep(NA_real_, n),
    fa_raw_value = rep(NA_real_, n),
    fa_uncapped_value = rep(NA_real_, n),
    fa_min_salary = rep(NA_real_, n),
    fa_max_salary = rep(NA_real_, n),
    fa_market_adjustment = rep(NA_real_, n),
    fa_projected_timin = rep(NA_real_, n),
    fa_missing_roster_slots = rep(NA_real_, n),
    fa_is_max = rep(FALSE, n),
    fa_max_tier = rep(NA_character_, n),
    stringsAsFactors = FALSE
  )

  timin_col <- paste0("projection_timin_y", horizon)
  minutes_col <- paste0("projection_minutes_y", horizon)
  prior_col <- if (horizon == 1) "contract" else paste0("projection_contract_y", horizon - 1)

  market_timin <- if (timin_col %in% names(df)) suppressWarnings(as.numeric(df[[timin_col]])) else rep(NA_real_, n)
  market_minutes <- if (minutes_col %in% names(df)) suppressWarnings(as.numeric(df[[minutes_col]])) else rep(NA_real_, n)
  if (horizon == 1) {
    market_timin <- ifelse(is.na(market_timin), df$timin, market_timin)
    market_minutes <- ifelse(is.na(market_minutes), df$Minutes, market_minutes)
  }
  market_timin <- pmax(0, market_timin)
  market_year <- df$year + horizon
  market_yos <- suppressWarnings(as.numeric(df$yoe)) + horizon - 1
  prior_salary <- if (prior_col %in% names(df)) suppressWarnings(as.numeric(df[[prior_col]])) else rep(NA_real_, n)
  current_contract_year <- max(df$year, na.rm = TRUE)
  prior_salary <- ifelse(df$year == current_contract_year, prior_salary, NA_real_)

  for (season in sort(unique(df$year))) {
    idx <- which(df$year == season & !is.na(market_timin))
    if (length(idx) == 0) next

    active <- idx[!is.na(market_minutes[idx]) & market_minutes[idx] > 0]
    if (length(active) == 0) next

    floor_salary <- min_salary_for_yos(market_yos[active], market_year[active], caps)
    max_salary <- max_salary_for_yos(market_yos[active], market_year[active], caps, prior_salary[active])
    market_pool <- cap_for_year(caps, season + horizon, "scale_cap") * 30

    missing_slots <- max(0, target_roster_spots - length(active))
    missing_slot_salary <- min_salary_for_yos(1, season + horizon, caps)
    missing_floor_pool <- missing_slots * missing_slot_salary
    modeled_floor_pool <- sum(floor_salary, na.rm = TRUE)
    premium_pool <- max(0, market_pool - modeled_floor_pool - missing_floor_pool)
    league_timin <- sum(market_timin[active], na.rm = TRUE)
    raw_dollars_per_timin <- ifelse(league_timin > 0, premium_pool / league_timin, 0)

    raw_value <- floor_salary + market_timin[active] * raw_dollars_per_timin
    max_candidates <- raw_value >= max_salary
    max_surplus <- sum(pmax(0, raw_value[max_candidates] - max_salary[max_candidates]), na.rm = TRUE)
    nonmax_timin <- sum(market_timin[active][!max_candidates], na.rm = TRUE)
    adjustment <- ifelse(nonmax_timin > 0, max_surplus / nonmax_timin, 0)
    adjusted_dollars_per_timin <- raw_dollars_per_timin + adjustment
    uncapped_value <- floor_salary + market_timin[active] * adjusted_dollars_per_timin
    fa_value <- pmin(max_salary, pmax(floor_salary, uncapped_value))

    out$fa_value[active] <- round(fa_value, 0)
    out$fa_raw_value[active] <- round(raw_value, 0)
    out$fa_uncapped_value[active] <- round(uncapped_value, 0)
    out$fa_min_salary[active] <- floor_salary
    out$fa_max_salary[active] <- max_salary
    out$fa_market_adjustment[active] <- round(adjustment, 2)
    out$fa_projected_timin[active] <- round(market_timin[active], 1)
    out$fa_missing_roster_slots[active] <- missing_slots
    out$fa_is_max[active] <- fa_value >= max_salary - 1
    out$fa_max_tier[active] <- max_salary_tier_for_yos(market_yos[active])
  }

  out
}

scale_from_value_contract <- function(value, cap, minutes, contract) {
  value <- suppressWarnings(as.numeric(value))
  cap <- suppressWarnings(as.numeric(cap))
  minutes <- suppressWarnings(as.numeric(minutes))
  contract <- suppressWarnings(as.numeric(contract))
  minutes_capacity <- pmin(ifelse(is.finite(minutes) & minutes > 0, 48 * 82 * 5 / minutes, 15), 15)
  contract_capacity <- ifelse(is.finite(contract) & contract > 0 & is.finite(cap) & cap > 0, pmin(cap / contract, 15), 15)
  round(pmax(0, pmin(minutes_capacity, contract_capacity) * value / cap), 3)
}

fit_value_contract_scale_model <- function(rows, cap_assumptions) {
  empty_model <- list(x = c(0.01, 0.04, 0.08, 0.14, 0.22, 0.32, 0.48), scale = c(0.25, 0.42, 0.65, 0.85, 0.95, 1.10, 1.35))
  needed <- c("year", "value", "contract")
  if (!all(needed %in% names(rows)) || nrow(rows) == 0) return(empty_model)

  year <- suppressWarnings(as.numeric(rows$year))
  cap <- cap_for_year(cap_assumptions, year, "scale_cap")
  value <- suppressWarnings(as.numeric(rows$value))
  contract <- suppressWarnings(as.numeric(rows$contract))
  status <- if ("contract_status" %in% names(rows)) as.character(rows$contract_status) else rep(NA_character_, nrow(rows))
  availability <- if ("availability_status" %in% names(rows)) as.character(rows$availability_status) else rep(NA_character_, nrow(rows))
  open_market_status <- trimws(status) %in% c("UFA", "RFA", "Rookie FA")

  observed <- data.frame(
    value_pct = value / cap,
    value_contract_scale = value / contract,
    stringsAsFactors = FALSE
  )
  keep <- is.finite(observed$value_pct) &
    is.finite(observed$value_contract_scale) &
    observed$value_pct > 0 &
    observed$value_contract_scale > 0 &
    is.finite(contract) &
    contract > 0 &
    !open_market_status &
    availability != "DNQ"
  observed <- observed[keep, , drop = FALSE]
  if (nrow(observed) < 100) return(empty_model)

  observed$value_pct <- clamp(observed$value_pct, 0.001, 0.65)
  observed$value_contract_scale <- clamp(observed$value_contract_scale, 0.10, 3.00)
  breaks <- c(0, 0.015, 0.035, 0.065, 0.105, 0.160, 0.235, 0.330, 0.470, Inf)
  bucket <- cut(observed$value_pct, breaks = breaks, include.lowest = TRUE, right = FALSE)
  bucket_levels <- levels(bucket)
  anchors <- do.call(rbind, lapply(bucket_levels, function(level) {
    idx <- which(bucket == level)
    if (length(idx) < 20) return(NULL)
    data.frame(
      x = stats::median(observed$value_pct[idx], na.rm = TRUE),
      scale = as.numeric(stats::quantile(observed$value_contract_scale[idx], probs = 0.25, na.rm = TRUE, names = FALSE)),
      n = length(idx),
      stringsAsFactors = FALSE
    )
  }))
  if (is.null(anchors) || nrow(anchors) < 4) return(empty_model)

  anchors <- rbind(
    data.frame(x = 0.000, scale = 0.18, n = 1000),
    anchors,
    data.frame(x = 0.600, scale = max(1.30, max(anchors$scale, na.rm = TRUE)), n = 1000)
  )
  anchors <- anchors[order(anchors$x), , drop = FALSE]
  smoothed <- tryCatch(stats::lowess(anchors$x, anchors$scale, f = 0.55, iter = 1), error = function(e) NULL)
  if (is.null(smoothed) || length(smoothed$x) < 4) {
    out <- anchors[, c("x", "scale"), drop = FALSE]
  } else {
    out <- data.frame(x = smoothed$x, scale = smoothed$y)
  }
  out <- out[is.finite(out$x) & is.finite(out$scale), , drop = FALSE]
  out <- out[order(out$x), , drop = FALSE]
  out$scale <- cummax(clamp(out$scale, 0.15, 1.60))
  list(x = out$x, scale = out$scale)
}

predict_value_contract_scale <- function(value, cap, contract_scale_model) {
  value <- suppressWarnings(as.numeric(value))
  cap <- suppressWarnings(as.numeric(cap))
  value_pct <- value / cap
  fallback <- rep(0.8, length(value_pct))
  if (is.null(contract_scale_model) || is.null(contract_scale_model$x) || is.null(contract_scale_model$scale)) {
    return(fallback)
  }
  predicted <- approx(
    x = contract_scale_model$x,
    y = contract_scale_model$scale,
    xout = value_pct,
    rule = 2,
    ties = "ordered"
  )$y
  predicted[!is.finite(predicted)] <- fallback[!is.finite(predicted)]
  clamp(predicted, 0.15, 1.60)
}

expected_projection_contract <- function(projected_value, cap, season_year, yos, cap_assumptions, contract_scale_model) {
  projected_value <- suppressWarnings(as.numeric(projected_value))
  cap <- suppressWarnings(as.numeric(cap))
  season_year <- suppressWarnings(as.numeric(season_year))
  yos <- suppressWarnings(as.numeric(yos))

  floor_salary <- min_salary_for_yos(yos, season_year, cap_assumptions)
  max_salary <- max_salary_for_yos(yos, season_year, cap_assumptions)
  expected_scale <- predict_value_contract_scale(projected_value, cap, contract_scale_model)
  curve_contract <- ifelse(is.finite(projected_value) & projected_value > 0, projected_value / expected_scale, NA_real_)
  nonmax_ceiling <- pmax(floor_salary, max_salary * 0.98)

  ifelse(
    is.finite(projected_value) & projected_value > 0,
    ifelse(
      is.finite(max_salary) & projected_value >= max_salary,
      max_salary,
      pmax(floor_salary, pmin(curve_contract, nonmax_ceiling), na.rm = TRUE)
    ),
    floor_salary
  )
}

impute_projection_contract <- function(
  projected_contract,
  projected_value,
  cap,
  season_year,
  yos,
  cap_assumptions,
  contract_scale_model
) {
  projected_contract <- suppressWarnings(as.numeric(projected_contract))
  projected_value <- suppressWarnings(as.numeric(projected_value))
  expected_contract <- expected_projection_contract(projected_value, cap, season_year, yos, cap_assumptions, contract_scale_model)
  ifelse(
    is.finite(projected_contract) & projected_contract > 0,
    projected_contract,
    expected_contract
  )
}

projection_contract_source <- function(projected_contract, projected_value, season_year, yos, cap_assumptions) {
  projected_contract <- suppressWarnings(as.numeric(projected_contract))
  projected_value <- suppressWarnings(as.numeric(projected_value))
  max_salary <- max_salary_for_yos(yos, season_year, cap_assumptions)
  ifelse(
    is.finite(projected_contract) & projected_contract > 0,
    "contract",
    ifelse(
      is.finite(projected_value) & projected_value <= 0,
      "minimum_floor",
      ifelse(
      is.finite(projected_value) & is.finite(max_salary) & projected_value >= max_salary,
      "value_contract_max",
      ifelse(is.finite(projected_value), "value_contract_curve", NA_character_)
      )
    )
  )
}

recalculate_projection_scalability <- function(rows, cap_assumptions, horizons = 1:5, contract_scale_model = NULL) {
  if (is.null(contract_scale_model)) {
    contract_scale_model <- fit_value_contract_scale_model(rows, cap_assumptions)
  }
  for (horizon in horizons) {
    value_col <- paste0("projection_value_y", horizon)
    minutes_col <- paste0("projection_minutes_y", horizon)
    contract_col <- paste0("projection_contract_y", horizon)
    cap_col <- paste0("projection_cap_y", horizon)
    scale_col <- paste0("projection_scalability_y", horizon)
    effective_col <- paste0("projection_effective_contract_y", horizon)
    source_col <- paste0("projection_contract_source_y", horizon)
    if (!(value_col %in% names(rows)) || !(minutes_col %in% names(rows))) next

    value <- suppressWarnings(as.numeric(rows[[value_col]]))
    minutes <- suppressWarnings(as.numeric(rows[[minutes_col]]))
    projected_contract <- if (contract_col %in% names(rows)) suppressWarnings(as.numeric(rows[[contract_col]])) else rep(NA_real_, nrow(rows))
    cap <- if (cap_col %in% names(rows)) suppressWarnings(as.numeric(rows[[cap_col]])) else cap_for_year(cap_assumptions, rows$year + horizon, "scale_cap")
    season_year <- suppressWarnings(as.numeric(rows$year)) + horizon
    yos <- if ("yoe" %in% names(rows)) suppressWarnings(as.numeric(rows$yoe)) + horizon - 1 else rep(NA_real_, nrow(rows))
    effective_contract <- impute_projection_contract(
      projected_contract = projected_contract,
      projected_value = value,
      cap = cap,
      season_year = season_year,
      yos = yos,
      cap_assumptions = cap_assumptions,
      contract_scale_model = contract_scale_model
    )

    rows[[effective_col]] <- round(effective_contract, 0)
    rows[[source_col]] <- projection_contract_source(projected_contract, value, season_year, yos, cap_assumptions)
    rows[[scale_col]] <- scale_from_value_contract(value, cap, minutes, effective_contract)
  }
  rows
}

blank_like <- function(template, n) {
  out <- template[rep(1, n), , drop = FALSE]
  for (nm in names(out)) {
    if (is.logical(out[[nm]])) {
      out[[nm]] <- rep(FALSE, n)
    } else if (is.numeric(out[[nm]]) || is.integer(out[[nm]])) {
      out[[nm]] <- rep(NA_real_, n)
    } else {
      out[[nm]] <- rep(NA_character_, n)
    }
  }
  out
}

shift_future_columns <- function(rows, cap_assumptions) {
  projection_groups <- c(
    "projection_y", "projection_games_y", "projection_mpg_y", "projection_minutes_y",
    "projection_offense_y", "projection_defense_y",
    "projection_skill_model_off_y", "projection_skill_model_def_y",
    "projection_timin_y", "projection_value_y", "projection_fa_value_y",
    "projection_scalability_y", "projection_contract_y", "projection_effective_contract_y",
    "projection_cap_y", "projection_contract_status_y", "projection_contract_source_y"
  )
  for (prefix in projection_groups) {
    old <- lapply(1:5, function(horizon) {
      col <- paste0(prefix, horizon)
      if (col %in% names(rows)) rows[[col]] else rep(NA_real_, nrow(rows))
    })
    for (horizon in 1:4) {
      col <- paste0(prefix, horizon)
      if (col %in% names(rows)) rows[[col]] <- old[[horizon + 1]]
    }
    col5 <- paste0(prefix, 5)
    if (col5 %in% names(rows)) rows[[col5]] <- NA_real_
  }
  for (horizon in 1:5) {
    cap_col <- paste0("projection_cap_y", horizon)
    if (cap_col %in% names(rows)) rows[[cap_col]] <- cap_for_year(cap_assumptions, rows$year + horizon, "scale_cap")
  }
  rows
}

build_rookie_2027_rows <- function(template, base_dir, cap_assumptions, impact_reference, replacement_reference, target_year) {
  draft <- build_draft_prospects(base_dir, impact_reference, replacement_reference)
  if (!nrow(draft)) return(template[FALSE, , drop = FALSE])
  draft <- draft[draft$draft_year == max(draft$draft_year, na.rm = TRUE), , drop = FALSE]
  if (!nrow(draft)) return(template[FALSE, , drop = FALSE])

  skill_names <- impact_skill_names()
  curves <- fit_rookie_deage_curves(base_dir)
  rows <- blank_like(template, nrow(draft))
  pick_proxy <- if ("pick_proxy" %in% names(draft)) draft$pick_proxy else NA_real_
  actual_pick <- if ("actual_pick" %in% names(draft)) draft$actual_pick else NA_real_
  rank_proxy_raw <- coalesce_numeric(pick_proxy, coalesce_numeric(actual_pick, draft$rank_in_class))
  mock_pick <- mock_picks_from_rank(rank_proxy_raw, draft$rank_in_class, draft$player)
  actual_pick_num <- suppressWarnings(as.numeric(actual_pick))
  rank_proxy <- ifelse(is.finite(actual_pick_num), actual_pick_num, mock_pick)
  draft_age <- suppressWarnings(as.numeric(draft$draft_age))
  draft_age[!is.finite(draft_age)] <- median(draft_age, na.rm = TRUE)
  if (!any(is.finite(draft_age))) draft_age[] <- 19.5

  model_off <- final_pred_value(draft, "OFF")
  model_def <- final_pred_value(draft, "DEF")
  off <- model_off + predict_rookie_adjustment(curves, "OFF", draft_age)
  def <- model_def + predict_rookie_adjustment(curves, "DEF", draft_age)
  total <- off + def
  minutes <- predict_rookie_minutes(curves, rank_proxy, total, draft_age)
  games <- clamp(54 - 0.28 * rank_proxy + 2.5 * total - 0.6 * pmax(0, draft_age - 20), 18, 82)
  games[!is.finite(games)] <- clamp(minutes[!is.finite(games)] / 18, 18, 82)
  mpg <- ifelse(games > 0, minutes / games, NA_real_)
  rookie_scale <- load_rookie_scale_contracts(base_dir)
  scale_match <- match(rank_proxy, rookie_scale$pick)
  first_year_salary <- rookie_scale$first_year_salary[scale_match]
  second_year_salary <- rookie_scale$second_year_salary[scale_match]
  third_year_salary <- rookie_scale$third_year_salary[scale_match]
  fourth_year_salary <- rookie_scale$fourth_year_salary[scale_match]
  first_round_scale <- is.finite(first_year_salary) & rank_proxy >= 1 & rank_proxy <= 30
  draft_order <- load_official_draft_order(base_dir)
  pick_team <- draft_order$team[match(rank_proxy, draft_order$pick)]
  projected_pick_team <- ifelse(!is.na(pick_team) & nzchar(trimws(pick_team)), normalize_team(pick_team), NA_character_)

  rows$nba_id <- -as.integer(2027000 + seq_len(nrow(rows)))
  rows$player_name <- as.character(draft$player)
  rows$year <- target_year
  drafted_team <- if ("drafted_team" %in% names(draft)) as.character(draft$drafted_team) else rep(NA_character_, nrow(draft))
  actual_drafted_team <- ifelse(
    !is.na(drafted_team) & nzchar(trimws(drafted_team)) & is.finite(actual_pick_num),
    normalize_team(drafted_team),
    NA_character_
  )
  projected_pick_team <- coalesce_col(actual_drafted_team, projected_pick_team)
  rows$team <- "FA"
  if ("current_roster_team" %in% names(rows)) rows$current_roster_team <- rows$team
  if ("roster_truth_team" %in% names(rows)) rows$roster_truth_team <- rows$team
  if ("roster_status_source" %in% names(rows)) rows$roster_status_source <- "unassigned rookie projection"
  rows$position <- ifelse(!is.na(draft$position) & nzchar(trimws(draft$position)), as.character(draft$position), "UNK")
  rookie_position_shares <- position_share_matrix_from_labels(rows$position)
  for (share_col in position_share_columns()) {
    if (share_col %in% names(rows)) rows[[share_col]] <- round(rookie_position_shares[, share_col], 4)
  }
  if ("position_index" %in% names(rows)) rows$position_index <- round(position_index_from_shares(rookie_position_shares), 4)
  if ("position_entropy" %in% names(rows)) rows$position_entropy <- round(position_entropy_from_shares(rookie_position_shares), 4)
  rows$age <- round(draft_age + 0.5, 1)
  rows$yoe <- 0
  rows$games <- round(games, 1)
  rows$Minutes <- round(minutes, 0)
  rows$p_mpg <- round(mpg, 1)
  rows$p_usg <- NA_real_
  rows$off_dep <- round(off, 3)
  rows$def_dep <- round(def, 3)
  rows$offense <- round(off, 3)
  rows$defense <- round(def, 3)
  rows$total <- round(total, 3)
  rows$availability_status <- "rookie_projection"
  rows$availability_reason <- "Draft model de-aged to rookie season"
  rows$skill_source <- "draft_model_deaged"
  rows$skill_source_year <- draft$draft_year
  rows$contract <- ifelse(first_round_scale, first_year_salary, NA_real_)
  rows$contract_status <- "Rookie FA"
  rows$incumbent_team <- "FA"
  rows$market_team <- "FA"
  rows$team_projection_base <- "FA"
  rows$projection_roster_status <- "rookie_fa"
  rookie_truth <- load_current_roster_truth(base_dir, target_year - 1L)
  if (nrow(rookie_truth)) {
    roster_match <- match(suppressWarnings(as.integer(rows$nba_id)), suppressWarnings(as.integer(rookie_truth$nba_id)))
    matched_rookie <- !is.na(roster_match) &
      rookie_truth$roster_state[roster_match] == "rookie_cap_hold" &
      rookie_truth$roster_truth_team[roster_match] != "FA"
    if (any(matched_rookie, na.rm = TRUE)) {
      matched_idx <- roster_match[matched_rookie]
      truth_team <- rookie_truth$roster_truth_team[matched_idx]
      rows$team[matched_rookie] <- truth_team
      if ("current_roster_team" %in% names(rows)) rows$current_roster_team[matched_rookie] <- truth_team
      if ("roster_truth_team" %in% names(rows)) rows$roster_truth_team[matched_rookie] <- truth_team
      if ("roster_status_source" %in% names(rows)) rows$roster_status_source[matched_rookie] <- rookie_truth$roster_truth_source[matched_idx]
      if ("roster_truth_pulled_at" %in% names(rows)) rows$roster_truth_pulled_at[matched_rookie] <- rookie_truth$roster_truth_pulled_at[matched_idx]
      if ("roster_state" %in% names(rows)) rows$roster_state[matched_rookie] <- rookie_truth$roster_state[matched_idx]
      if ("roster_contract_status" %in% names(rows)) rows$roster_contract_status[matched_rookie] <- rookie_truth$roster_contract_status[matched_idx]
      if ("rights_team" %in% names(rows)) rows$rights_team[matched_rookie] <- rookie_truth$rights_team[matched_idx]
      rows$incumbent_team[matched_rookie] <- truth_team
      rows$market_team[matched_rookie] <- truth_team
      rows$team_projection_base[matched_rookie] <- truth_team
    }
  }
  spotrac_contracts <- read_spotrac_contracts(base_dir, target_year - 1L)
  if (nrow(spotrac_contracts)) {
    spotrac_match <- match(suppressWarnings(as.integer(rows$nba_id)), suppressWarnings(as.integer(spotrac_contracts$nba_id)))
    has_spotrac_contract <- !is.na(spotrac_match) &
      suppressWarnings(as.numeric(spotrac_contracts$salary_y0[spotrac_match])) > 0
    missing_contract <- !is.finite(suppressWarnings(as.numeric(rows$contract))) | suppressWarnings(as.numeric(rows$contract)) <= 0
    fill_contract <- has_spotrac_contract & missing_contract
    rows$contract[fill_contract] <- suppressWarnings(as.numeric(spotrac_contracts$salary_y0[spotrac_match[fill_contract]]))
  }
  if ("overall_pick" %in% names(rows)) rows$overall_pick <- rank_proxy
  if ("draft_year" %in% names(rows)) rows$draft_year <- draft$draft_year
  if ("source_note" %in% names(rows)) {
    pick_note <- ifelse(
      !is.na(projected_pick_team) & nzchar(trimws(projected_pick_team)),
      paste0("Consensus/mock pick team ", projected_pick_team, " is used only for pick/salary context; player remains unassigned."),
      "Consensus/mock rookie projection remains unassigned until actually drafted."
    )
    rows$source_note <- pick_note
  }

  if ("skill_model_off" %in% names(rows)) rows$skill_model_off <- rows$offense
  if ("skill_model_def" %in% names(rows)) rows$skill_model_def <- rows$defense
  if ("skill_off_total" %in% names(rows)) rows$skill_off_total <- rows$offense
  if ("skill_def_total" %in% names(rows)) rows$skill_def_total <- rows$defense
  if ("FINAL_OFF" %in% names(rows)) rows$FINAL_OFF <- rows$offense
  if ("FINAL_DEF" %in% names(rows)) rows$FINAL_DEF <- rows$defense
  if ("FINAL_TOTAL" %in% names(rows)) rows$FINAL_TOTAL <- rows$total

  for (skill_name in skill_names) {
    value <- final_pred_value(draft, skill_name) + predict_rookie_adjustment(curves, skill_name, draft_age)
    value <- clamp(value, -5, 5)
    rows[[skill_name]] <- round(value, 3)
    final_col <- paste0("FINAL_", skill_name)
    if (final_col %in% names(rows)) rows[[final_col]] <- rows[[skill_name]]
  }

  for (horizon in 1:5) {
    projection_off <- rookie_projection_path(rows$offense, model_off, horizon)
    projection_def <- rookie_projection_path(rows$defense, model_def, horizon)
    rows[[paste0("projection_y", horizon)]] <- round(projection_off + projection_def, 2)
    if (paste0("projection_offense_y", horizon) %in% names(rows)) rows[[paste0("projection_offense_y", horizon)]] <- round(projection_off, 2)
    if (paste0("projection_defense_y", horizon) %in% names(rows)) rows[[paste0("projection_defense_y", horizon)]] <- round(projection_def, 2)
    if (paste0("projection_skill_model_off_y", horizon) %in% names(rows)) rows[[paste0("projection_skill_model_off_y", horizon)]] <- round(projection_off, 3)
    if (paste0("projection_skill_model_def_y", horizon) %in% names(rows)) rows[[paste0("projection_skill_model_def_y", horizon)]] <- round(projection_def, 3)
    rows[[paste0("projection_games_y", horizon)]] <- round(clamp(rows$games + horizon * 1.5, 0, 82), 1)
    rows[[paste0("projection_mpg_y", horizon)]] <- round(clamp(rows$p_mpg + horizon * 0.4, 0, 34), 1)
    rows[[paste0("projection_minutes_y", horizon)]] <- round(rows[[paste0("projection_games_y", horizon)]] * rows[[paste0("projection_mpg_y", horizon)]], 0)
    rows[[paste0("projection_contract_y", horizon)]] <- switch(
      as.character(horizon),
      "1" = ifelse(first_round_scale, second_year_salary, NA_real_),
      "2" = ifelse(first_round_scale, third_year_salary, NA_real_),
      "3" = ifelse(first_round_scale, fourth_year_salary, NA_real_),
      "4" = ifelse(first_round_scale, round(fourth_year_salary * 3, 0), NA_real_),
      NA_real_
    )
    rows[[paste0("projection_contract_status_y", horizon)]] <- switch(
      as.character(horizon),
      "1" = ifelse(first_round_scale, "Signed", NA_character_),
      "2" = ifelse(first_round_scale, "Team Option", NA_character_),
      "3" = ifelse(first_round_scale, "Team Option", NA_character_),
      "4" = ifelse(first_round_scale, "RFA", NA_character_),
      NA_character_
    )
    rows[[paste0("projection_cap_y", horizon)]] <- cap_for_year(cap_assumptions, rows$year + horizon, "scale_cap")
  }
  for (skill_name in skill_names) {
    model_skill <- final_pred_value(draft, skill_name)
    for (horizon in 1:5) {
      projection_col <- paste0("projection_", skill_name, "_y", horizon)
      if (projection_col %in% names(rows)) {
        rows[[projection_col]] <- round(rookie_projection_path(rows[[skill_name]], model_skill, horizon), 2)
      }
    }
  }
  rows
}

lineup_role_plan <- function() {
  data.frame(
    role_order = seq_len(10),
    role_label = c("Guard 1", "Guard 2", "Forward 1", "Forward 2", "Center", paste0("Bench ", 1:5)),
    role_type = c(rep("Starter", 5), rep("Bench", 5)),
    position_group = c("Guard", "Guard", "Forward", "Forward", "Center", rep("Bench", 5)),
    role_band_minutes = c(2700, 2400, 2700, 2400, 2700, 1900, 1600, 1300, 900, 500),
    stringsAsFactors = FALSE
  )
}

lineup_role_score <- function(df) {
  total <- suppressWarnings(as.numeric(df$total))
  total[!is.finite(total)] <- -Inf
  total
}

lineup_position_flags <- function(position) {
  pos <- toupper(trimws(as.character(position)))
  parts <- lapply(pos, position_parts)
  has_guard <- vapply(parts, function(part) any(part %in% c("PG", "SG")), logical(1))
  has_forward <- vapply(parts, function(part) any(part %in% c("SF", "PF")), logical(1))
  has_center <- vapply(parts, function(part) any(part == "C"), logical(1))
  has_pf <- vapply(parts, function(part) any(part == "PF"), logical(1))
  data.frame(
    has_guard = has_guard,
    has_forward = has_forward,
    has_center = has_center,
    has_pf = has_pf,
    stringsAsFactors = FALSE
  )
}

lineup_candidate_indices <- function(df, position_group, selected) {
  available <- which(!(df$.lineup_row_id %in% selected))
  if (!length(available)) return(integer())
  if (identical(position_group, "Bench")) return(available)

  flags <- lineup_position_flags(df$position)
  strict <- switch(position_group,
    Guard = flags$has_guard,
    Forward = flags$has_forward,
    Center = flags$has_center,
    rep(TRUE, nrow(df))
  )
  idx <- available[strict[available]]
  if (!length(idx) && identical(position_group, "Center")) {
    idx <- available[flags$has_pf[available]]
  }
  if (!length(idx)) idx <- available
  idx
}

estimate_team_lineup_rows <- function(df) {
  if (!nrow(df)) return(data.frame())
  if (!(".lineup_row_id" %in% names(df))) df$.lineup_row_id <- seq_len(nrow(df))
  plan <- lineup_role_plan()
  df$.lineup_role_score <- lineup_role_score(df)
  flags <- lineup_position_flags(df$position)
  minutes <- suppressWarnings(as.numeric(df$Minutes))
  total <- suppressWarnings(as.numeric(df$total))
  player_name <- as.character(df$player_name)
  selected <- rep(FALSE, nrow(df))
  out <- vector("list", nrow(plan))
  out_count <- 0L

  for (i in seq_len(nrow(plan))) {
    available <- which(!selected)
    if (!length(available)) next
    position_group <- plan$position_group[[i]]
    if (identical(position_group, "Bench")) {
      idx <- available
    } else {
      strict <- switch(position_group,
        Guard = flags$has_guard,
        Forward = flags$has_forward,
        Center = flags$has_center,
        rep(TRUE, nrow(df))
      )
      idx <- available[strict[available]]
      if (!length(idx) && identical(position_group, "Center")) {
        idx <- available[flags$has_pf[available]]
      }
      if (!length(idx)) idx <- available
    }
    if (!length(idx)) next
    idx <- idx[order(
      -df$.lineup_role_score[idx],
      -minutes[idx],
      -total[idx],
      player_name[idx],
      na.last = TRUE
    )]
    picked <- idx[[1]]
    selected[picked] <- TRUE
    row <- cbind(plan[i, , drop = FALSE], df[picked, , drop = FALSE])
    out_count <- out_count + 1L
    row$lineup_rank <- out_count
    row$is_starter <- row$role_type == "Starter"
    row$role_score <- round(df$.lineup_role_score[[picked]], 2)
    out[[out_count]] <- row
  }

  if (!out_count) return(data.frame())
  do.call(rbind, out[seq_len(out_count)])
}

free_agent_impact_role_order <- function(total, position) {
  total <- suppressWarnings(as.numeric(total))
  flags <- lineup_position_flags(position)
  starter_order <- ifelse(
    flags$has_center,
    5L,
    ifelse(flags$has_forward, 3L, ifelse(flags$has_guard, 1L, 6L))
  )
  secondary_starter_order <- ifelse(
    starter_order == 3L,
    4L,
    ifelse(starter_order == 1L, 2L, starter_order)
  )
  ifelse(
    is.finite(total) & total >= 1.20,
    starter_order,
    ifelse(
      is.finite(total) & total >= 0.25,
      secondary_starter_order,
      ifelse(
        is.finite(total) & total >= -0.40,
        6L,
        ifelse(
          is.finite(total) & total >= -1.00,
          7L,
          ifelse(
            is.finite(total) & total >= -1.60,
            8L,
            ifelse(is.finite(total) & total >= -2.20, 9L, 10L)
          )
        )
      )
    )
  )
}

free_agent_minutes_role_order <- function(minutes, position) {
  plan <- lineup_role_plan()
  flags <- lineup_position_flags(position)
  minutes <- suppressWarnings(as.numeric(minutes))
  vapply(seq_along(minutes), function(i) {
    starter_allowed <- rep(FALSE, nrow(plan))
    starter_allowed[plan$role_type == "Bench"] <- TRUE
    if (isTRUE(flags$has_guard[[i]])) starter_allowed[plan$role_order %in% c(1L, 2L)] <- TRUE
    if (isTRUE(flags$has_forward[[i]])) starter_allowed[plan$role_order %in% c(3L, 4L)] <- TRUE
    if (isTRUE(flags$has_center[[i]])) starter_allowed[plan$role_order == 5L] <- TRUE
    candidates <- plan[starter_allowed, , drop = FALSE]
    if (!nrow(candidates)) candidates <- plan
    if (!is.finite(minutes[[i]])) return(10L)
    candidates$role_order[[which.min(abs(candidates$role_band_minutes - minutes[[i]]))]]
  }, integer(1))
}

expected_free_agent_role_rows <- function(df) {
  if (!nrow(df)) return(data.frame())
  if (!(".lineup_row_id" %in% names(df))) df$.lineup_row_id <- seq_len(nrow(df))
  plan <- lineup_role_plan()
  minutes <- suppressWarnings(as.numeric(df$Minutes))
  impact_order <- free_agent_impact_role_order(df$total, df$position)
  minutes_order <- free_agent_minutes_role_order(minutes, df$position)
  impact_target <- plan$role_band_minutes[match(impact_order, plan$role_order)]
  minutes_target <- plan$role_band_minutes[match(minutes_order, plan$role_order)]
  role_order <- ifelse(
    is.finite(impact_target) & impact_target >= minutes_target,
    impact_order,
    minutes_order
  )
  role_order[!is.finite(role_order)] <- 10L
  out <- merge(
    data.frame(.lineup_row_id = df$.lineup_row_id, role_order = as.integer(role_order), stringsAsFactors = FALSE),
    plan,
    by = "role_order",
    all.x = TRUE,
    sort = FALSE
  )
  out$lineup_rank <- match(out$.lineup_row_id, df$.lineup_row_id)
  out$is_starter <- out$role_type == "Starter"
  role_score <- round(lineup_role_score(df), 2)
  out$role_score <- role_score[match(out$.lineup_row_id, df$.lineup_row_id)]
  out
}

apply_expected_free_agent_minute_adjustment <- function(rows) {
  free_agents <- rows[rows$team == "FA" & !is.na(rows$team), , drop = FALSE]
  fa_roles <- expected_free_agent_role_rows(free_agents)
  if (is.null(fa_roles) || !nrow(fa_roles)) return(rows)
  for (i in seq_len(nrow(fa_roles))) {
    idx <- fa_roles$.lineup_row_id[[i]]
    original_minutes <- suppressWarnings(as.numeric(rows$Minutes[[idx]]))
    if (!is.finite(original_minutes)) original_minutes <- 0
    role_target <- fa_roles$role_band_minutes[[i]]
    games <- suppressWarnings(as.numeric(rows$games[[idx]]))
    adjusted <- max(original_minutes, 0.4 * original_minutes + 0.6 * role_target, na.rm = TRUE)
    adjusted <- clamp(adjusted, 0, 82 * 36)
    if (!is.finite(games) || games <= 0) games <- ifelse(adjusted > 0, min(82, adjusted / 36), 0)
    if (adjusted > games * 36) {
      games <- min(82, adjusted / 36)
    }
    rows$Minutes[[idx]] <- round(adjusted, 0)
    rows$games[[idx]] <- round(games, 1)
    rows$p_mpg[[idx]] <- round(ifelse(games > 0, rows$Minutes[[idx]] / games, rows$p_mpg[[idx]]), 1)
    rows$lineup_role[[idx]] <- paste("Expected", fa_roles$role_label[[i]])
    rows$lineup_role_order[[idx]] <- fa_roles$role_order[[i]]
    rows$lineup_role_band_minutes[[idx]] <- fa_roles$role_band_minutes[[i]]
  }
  rows
}

apply_lineup_minute_adjustment <- function(rows, adjust_free_agents = FALSE) {
  if (!nrow(rows)) return(rows)
  rows$lineup_original_minutes <- suppressWarnings(as.numeric(rows$Minutes))
  rows$lineup_adjusted_minutes <- suppressWarnings(as.numeric(rows$Minutes))
  rows$lineup_role <- NA_character_
  rows$lineup_role_order <- NA_integer_
  rows$lineup_role_band_minutes <- NA_real_
  rows$.lineup_row_id <- seq_len(nrow(rows))

  eligible <- rows[rows$team != "FA" & !is.na(rows$team), , drop = FALSE]
  if (!nrow(eligible)) {
    if (isTRUE(adjust_free_agents)) {
      rows <- apply_expected_free_agent_minute_adjustment(rows)
      rows$lineup_adjusted_minutes <- suppressWarnings(as.numeric(rows$Minutes))
    }
    rows$.lineup_row_id <- NULL
    return(rows)
  }

  grouped <- split(eligible, normalize_team(eligible$team))
  selections <- do.call(rbind, lapply(grouped, estimate_team_lineup_rows))
  selected_ids <- if (!is.null(selections) && nrow(selections)) selections$.lineup_row_id else integer()
  nonselected_ids <- setdiff(eligible$.lineup_row_id, selected_ids)
  if (length(nonselected_ids)) {
    original_minutes <- suppressWarnings(as.numeric(rows$Minutes[nonselected_ids]))
    original_minutes[!is.finite(original_minutes)] <- 0
    rows$Minutes[nonselected_ids] <- round(0.5 * original_minutes, 0)
    games <- suppressWarnings(as.numeric(rows$games[nonselected_ids]))
    rows$p_mpg[nonselected_ids] <- round(ifelse(is.finite(games) & games > 0, rows$Minutes[nonselected_ids] / games, rows$p_mpg[nonselected_ids]), 1)
  }
  if (!is.null(selections) && nrow(selections)) {
    for (i in seq_len(nrow(selections))) {
      idx <- selections$.lineup_row_id[[i]]
      original_minutes <- suppressWarnings(as.numeric(rows$Minutes[[idx]]))
      if (!is.finite(original_minutes)) original_minutes <- 0
      role_target <- selections$role_band_minutes[[i]]
      games <- suppressWarnings(as.numeric(rows$games[[idx]]))
      adjusted <- 0.4 * original_minutes + 0.6 * role_target
      adjusted <- clamp(adjusted, 0, 82 * 36)
      if (!is.finite(games) || games <= 0) games <- ifelse(adjusted > 0, min(82, adjusted / 36), 0)
      if (adjusted > games * 36) {
        games <- min(82, adjusted / 36)
      }
      rows$Minutes[[idx]] <- round(adjusted, 0)
      rows$games[[idx]] <- round(games, 1)
      rows$p_mpg[[idx]] <- round(ifelse(games > 0, rows$Minutes[[idx]] / games, rows$p_mpg[[idx]]), 1)
      rows$lineup_role[[idx]] <- selections$role_label[[i]]
      rows$lineup_role_order[[idx]] <- selections$role_order[[i]]
      rows$lineup_role_band_minutes[[idx]] <- selections$role_band_minutes[[i]]
    }
  }

  if (isTRUE(adjust_free_agents)) {
    rows <- apply_expected_free_agent_minute_adjustment(rows)
  }

  for (team in sort(unique(rows$team[rows$team != "FA" & !is.na(rows$team)]))) {
    idx <- which(rows$team == team)
    team_minutes <- sum(suppressWarnings(as.numeric(rows$Minutes[idx])), na.rm = TRUE)
    if (is.finite(team_minutes) && team_minutes > 19680) {
      scale <- 19680 / team_minutes
      rows$Minutes[idx] <- round(suppressWarnings(as.numeric(rows$Minutes[idx])) * scale, 0)
      games <- suppressWarnings(as.numeric(rows$games[idx]))
      rows$p_mpg[idx] <- round(ifelse(is.finite(games) & games > 0, rows$Minutes[idx] / games, rows$p_mpg[idx]), 1)
    }
  }

  rows$lineup_adjusted_minutes <- suppressWarnings(as.numeric(rows$Minutes))
  rows$.lineup_row_id <- NULL
  rows
}

skill_rollup_groups <- function() {
  list(
    off = c("FTD", "OREB", "PASS", "RIM", "SHOOT"),
    def = c("DPM", "DREB", "RIMPRO", "SWITCH")
  )
}

calibrated_skill_rollup <- function(rows, reference, skill_cols, target_col) {
  row_cols <- intersect(skill_cols, names(rows))
  ref_cols <- intersect(skill_cols, names(reference))
  if (!length(row_cols) || !length(ref_cols) || !(target_col %in% names(reference))) {
    return(rep(NA_real_, nrow(rows)))
  }

  row_sum <- rowSums(rows[, row_cols, drop = FALSE], na.rm = TRUE)
  ref_sum <- rowSums(reference[, ref_cols, drop = FALSE], na.rm = TRUE)
  ref_target <- suppressWarnings(as.numeric(reference[[target_col]]))
  keep <- is.finite(ref_sum) & is.finite(ref_target)
  if (sum(keep) < 20) {
    return(row_sum)
  }

  ref_sum_sd <- stats::sd(ref_sum[keep], na.rm = TRUE)
  ref_target_sd <- stats::sd(ref_target[keep], na.rm = TRUE)
  if (!is.finite(ref_sum_sd) || ref_sum_sd <= 0 || !is.finite(ref_target_sd) || ref_target_sd <= 0) {
    return(row_sum)
  }

  out <- mean(ref_target[keep], na.rm = TRUE) +
    (row_sum - mean(ref_sum[keep], na.rm = TRUE)) * ref_target_sd / ref_sum_sd
  clamp(out, -8, 10)
}

recalculate_projected_skill_rollups <- function(rows, reference) {
  if (!nrow(rows)) return(rows)
  if (!("skill_model_off" %in% names(rows))) rows$skill_model_off <- NA_real_
  if (!("skill_model_def" %in% names(rows))) rows$skill_model_def <- NA_real_
  current_off <- if ("OFF" %in% names(rows)) rows$OFF else rows$skill_model_off
  current_def <- if ("DEF" %in% names(rows)) rows$DEF else rows$skill_model_def
  missing_off <- !is.finite(suppressWarnings(as.numeric(rows$skill_model_off)))
  missing_def <- !is.finite(suppressWarnings(as.numeric(rows$skill_model_def)))
  if (any(missing_off, na.rm = TRUE)) {
    rows$skill_model_off[missing_off] <- aggregate_skill_projection_fallback(current_off[missing_off], rows$offense[missing_off])
  }
  if (any(missing_def, na.rm = TRUE)) {
    rows$skill_model_def[missing_def] <- aggregate_skill_projection_fallback(current_def[missing_def], rows$defense[missing_def])
  }
  rows$skill_off_total <- rows$skill_model_off
  rows$skill_def_total <- rows$skill_model_def
  if ("OFF" %in% names(rows)) rows$OFF <- rows$skill_model_off
  if ("DEF" %in% names(rows)) rows$DEF <- rows$skill_model_def
  if ("TOTAL" %in% names(rows)) rows$TOTAL <- rows$skill_model_off + rows$skill_model_def
  rows
}

aggregate_skill_projection_fallback <- function(current_skill, projected_impact, rate = 0.15, max_delta = 0.35) {
  current_skill <- suppressWarnings(as.numeric(current_skill))
  projected_impact <- suppressWarnings(as.numeric(projected_impact))
  base <- ifelse(is.finite(current_skill), current_skill, 0)
  target <- ifelse(is.finite(projected_impact), projected_impact, base)
  base + clamp((target - base) * rate, -max_delta, max_delta)
}

build_projected_2027_rows <- function(x, base_dir, cap_assumptions, contract_year, contract_scale_model = NULL) {
  target_year <- contract_year + 1L
  latest <- x[x$year == contract_year, , drop = FALSE]
  if (!nrow(latest)) return(latest)
  if (is.null(contract_scale_model)) {
    contract_scale_model <- fit_value_contract_scale_model(x, cap_assumptions)
  }

  impact_reference <- x[
    x$year == contract_year &
      is.finite(x$total) &
      is.finite(x$timin) &
      is.finite(x$Minutes) &
      x$Minutes > 0 &
      x$score_label != "DNQ",
    c("total", "timin"),
    drop = FALSE
  ]
  replacement_reference <- replacement_reference_from_players(x, contract_year)

  vets <- latest[is.finite(latest$projection_minutes_y1) & latest$projection_minutes_y1 > 0, , drop = FALSE]
  if (nrow(vets)) {
    original <- vets
    vets$year <- target_year
    vets$age <- coalesce_numeric(original$age + 1, original$age)
    vets$yoe <- coalesce_numeric(original$yoe + 1, original$yoe)
    vets$games <- original$projection_games_y1
    vets$p_mpg <- original$projection_mpg_y1
    vets$Minutes <- original$projection_minutes_y1
    if ("projection_offense_y1" %in% names(original)) {
      vets$offense <- coalesce_numeric(original$projection_offense_y1, original$projection_y1 * 0.55)
    } else {
      vets$offense <- original$projection_y1 * 0.55
    }
    if ("projection_defense_y1" %in% names(original)) {
      vets$defense <- coalesce_numeric(original$projection_defense_y1, original$projection_y1 - vets$offense)
    } else {
      vets$defense <- original$projection_y1 - vets$offense
    }
    vets$total <- original$projection_y1
    vets$off_dep <- vets$offense
    vets$def_dep <- vets$defense
    if ("FINAL_OFF" %in% names(vets)) vets$FINAL_OFF <- vets$offense
    if ("FINAL_DEF" %in% names(vets)) vets$FINAL_DEF <- vets$defense
    if ("FINAL_TOTAL" %in% names(vets)) vets$FINAL_TOTAL <- vets$total
    if ("OFF" %in% names(vets)) vets$OFF <- vets$offense
    if ("DEF" %in% names(vets)) vets$DEF <- vets$defense
    if ("TOTAL" %in% names(vets)) vets$TOTAL <- vets$total
    for (skill_name in impact_skill_names()) {
      projected_col <- paste0("projection_", skill_name, "_y1")
      if (projected_col %in% names(original)) {
        vets[[skill_name]] <- coalesce_numeric(original[[projected_col]], original[[skill_name]])
      }
      final_col <- paste0("FINAL_", skill_name)
      if (final_col %in% names(vets)) vets[[final_col]] <- vets[[skill_name]]
    }
    projected_skill_off <- if ("projection_skill_model_off_y1" %in% names(original)) {
      suppressWarnings(as.numeric(original$projection_skill_model_off_y1))
    } else {
      rep(NA_real_, nrow(original))
    }
    projected_skill_def <- if ("projection_skill_model_def_y1" %in% names(original)) {
      suppressWarnings(as.numeric(original$projection_skill_model_def_y1))
    } else {
      rep(NA_real_, nrow(original))
    }
    if ("skill_model_off" %in% names(vets)) {
      vets$skill_model_off <- coalesce_numeric(
        projected_skill_off,
        aggregate_skill_projection_fallback(original$skill_model_off, vets$offense)
      )
    }
    if ("skill_model_def" %in% names(vets)) {
      vets$skill_model_def <- coalesce_numeric(
        projected_skill_def,
        aggregate_skill_projection_fallback(original$skill_model_def, vets$defense)
      )
    }
    if ("skill_off_total" %in% names(vets)) vets$skill_off_total <- vets$skill_model_off
    if ("skill_def_total" %in% names(vets)) vets$skill_def_total <- vets$skill_model_def
    if ("OFF" %in% names(vets)) vets$OFF <- vets$skill_model_off
    if ("DEF" %in% names(vets)) vets$DEF <- vets$skill_model_def
    if ("TOTAL" %in% names(vets)) vets$TOTAL <- vets$skill_model_off + vets$skill_model_def
    next_contract <- suppressWarnings(as.numeric(original$projection_contract_y1))
    vets$contract <- ifelse(is.finite(next_contract) & next_contract > 0, next_contract, NA_real_)
    next_status <- if ("projection_contract_status_y1" %in% names(original)) as.character(original$projection_contract_status_y1) else NA_character_
    initial_status_team <- ifelse(!is.finite(vets$contract) | vets$contract <= 0, "FA", vets$team)
    vets$contract_status <- contract_status_from_salary(
      vets$contract,
      vets$yoe,
      vets$age,
      initial_status_team,
      next_status,
      vets$year,
      vets$draft_year,
      vets$overall_pick
    )
    incumbent_team <- normalize_team(original$team)
    contract_team <- if ("contract_team" %in% names(original)) normalize_team(original$contract_team) else rep(NA_character_, nrow(original))
    missing_incumbent <- incumbent_team == "FA" | is_blank_text(incumbent_team)
    contract_controlled_next <- is.finite(vets$contract) & vets$contract > 0
    use_contract_team <- missing_incumbent & contract_controlled_next & !is_blank_text(contract_team) & contract_team != "FA"
    incumbent_team[use_contract_team] <- contract_team[use_contract_team]
    vets$incumbent_team <- incumbent_team
    vets$projection_roster_status <- projection_roster_status(vets$contract_status, vets$contract)
    keep_with_incumbent <- vets$projection_roster_status %in% c("signed", "team_controlled", "restricted", "player_option")
    option_status <- vets$contract_status %in% c("Player Option", "Team Option")
    should_enter_market <- (!is.finite(vets$contract) | vets$contract <= 0) | option_status
    vets$market_team <- ifelse(should_enter_market, "FA", vets$incumbent_team)
    vets$team_projection_base <- ifelse(keep_with_incumbent, vets$incumbent_team, "FA")
    vets$team <- vets$market_team
    vets$contract_status <- contract_status_from_salary(
      vets$contract,
      vets$yoe,
      vets$age,
      vets$team,
      vets$contract_status,
      vets$year,
      vets$draft_year,
      vets$overall_pick
    )
    vets$projection_roster_status <- projection_roster_status(vets$contract_status, vets$contract)
    vets$availability_status <- "projected"
    vets$availability_reason <- "Synthetic 2027 career projection"
    vets$skill_source <- "career_projection"
    vets$skill_source_year <- contract_year
    vets <- shift_future_columns(vets, cap_assumptions)
    vets <- prune_low_impact_ufas(vets, "total")
  }

  rookies <- build_rookie_2027_rows(latest, base_dir, cap_assumptions, impact_reference, replacement_reference, target_year)
  rows <- rbind(vets, rookies[, names(vets), drop = FALSE])
  if (!nrow(rows)) return(rows)
  rows <- recalculate_projected_skill_rollups(rows, x)

  rows$replacement_total <- draft_replacement_total(
    rows$position,
    replacement_reference,
    rows[, intersect(position_share_columns(), names(rows)), drop = FALSE]
  )
  rows$timin <- round((rows$total - rows$replacement_total) * pmax(0, rows$Minutes), 1)
  rows$score <- 100 * (0.35 * percent_rank(rows$timin) + 0.65 * percent_rank(rows$total))
  rows$score <- round(ifelse(is.finite(rows$score), rows$score, -10), 1)
  minute_rows <- assign_team_projection_scenario(rows, "base")
  minute_rows <- apply_lineup_minute_adjustment(minute_rows, adjust_free_agents = TRUE)
  rows$games <- minute_rows$games
  rows$Minutes <- minute_rows$Minutes
  rows$p_mpg <- minute_rows$p_mpg
  rows$lineup_original_minutes <- minute_rows$lineup_original_minutes
  rows$lineup_adjusted_minutes <- minute_rows$lineup_adjusted_minutes
  rows$lineup_role <- minute_rows$lineup_role
  rows$lineup_role_order <- minute_rows$lineup_role_order
  rows$lineup_role_band_minutes <- minute_rows$lineup_role_band_minutes

  rows$replacement_total <- draft_replacement_total(
    rows$position,
    replacement_reference,
    rows[, intersect(position_share_columns(), names(rows)), drop = FALSE]
  )
  rows$timin <- round((rows$total - rows$replacement_total) * pmax(0, rows$Minutes), 1)
  rows$score <- 100 * (0.35 * percent_rank(rows$timin) + 0.65 * percent_rank(rows$total))
  rows$score <- round(ifelse(is.finite(rows$score), rows$score, -10), 1)
  previous_pool <- x[x$year == contract_year, c("nba_id", "score"), drop = FALSE]
  previous_scores <- previous_pool$score[match(rows$nba_id, previous_pool$nba_id)]
  rows$score_delta <- round(rows$score - previous_scores, 1)
  rows$score_delta[rows$availability_status == "rookie_projection"] <- NA_real_
  rows$score_label <- format(round(rows$score, 1), trim = TRUE, nsmall = 1)
  rows$tier <- tier_from_score(rows$score)

  league_timin <- sum(rows$timin, na.rm = TRUE)
  cap_proxy <- cap_for_year(cap_assumptions, target_year, "scale_cap")
  rows$season_value <- if (is.finite(league_timin) && league_timin > 0) round(rows$timin * cap_proxy * 30 / league_timin, 0) else NA_real_
  rows$raw_minutes <- rows$Minutes
  rows$raw_timin <- rows$timin
  rows$value <- rows$season_value
  rows$value_add <- ifelse(is.finite(rows$contract), round(rows$season_value - rows$contract, 0), NA_real_)
  rows$trade_value <- round(rows$value * (0.45 + rows$score / 170), 0)
  rows$scalability <- {
    minutes_capacity <- pmin(ifelse(rows$Minutes > 0, 48 * 82 * 5 / rows$Minutes, 15), 15)
    contract_capacity <- ifelse(is.finite(rows$contract) & rows$contract > 0, pmin(cap_proxy / rows$contract, 15), 15)
    round(pmax(0, pmin(minutes_capacity, contract_capacity) * rows$value / cap_proxy), 3)
  }

  for (horizon in 1:5) {
    rows[[paste0("projection_timin_y", horizon)]] <- round((rows[[paste0("projection_y", horizon)]] - rows$replacement_total) *
      pmax(0, rows[[paste0("projection_minutes_y", horizon)]]), 1)
    rows[[paste0("projection_value_y", horizon)]] <- if (is.finite(league_timin) && league_timin > 0) {
      round(rows[[paste0("projection_timin_y", horizon)]] *
        cap_for_year(cap_assumptions, rows$year + horizon, "scale_cap") * 30 / league_timin, 0)
    } else {
      NA_real_
    }
    projected_contract <- suppressWarnings(as.numeric(rows[[paste0("projection_contract_y", horizon)]]))
    minutes_capacity <- pmin(ifelse(rows[[paste0("projection_minutes_y", horizon)]] > 0, 48 * 82 * 5 / rows[[paste0("projection_minutes_y", horizon)]], 15), 15)
    future_cap <- cap_for_year(cap_assumptions, rows$year + horizon, "scale_cap")
    contract_capacity <- ifelse(is.finite(projected_contract) & projected_contract > 0, pmin(future_cap / projected_contract, 15), 15)
    rows[[paste0("projection_scalability_y", horizon)]] <- round(pmax(0, pmin(minutes_capacity, contract_capacity) *
      rows[[paste0("projection_value_y", horizon)]] / future_cap), 3)
  }

  fa_market <- calc_fa_market_values(rows, cap_assumptions, horizon = 1)
  rows$fa_value <- fa_market$fa_value
  rows$fa_raw_value <- fa_market$fa_raw_value
  rows$fa_uncapped_value <- fa_market$fa_uncapped_value
  rows$fa_min_salary <- fa_market$fa_min_salary
  rows$fa_max_salary <- fa_market$fa_max_salary
  rows$fa_market_adjustment <- fa_market$fa_market_adjustment
  rows$fa_projected_timin <- fa_market$fa_projected_timin
  rows$fa_missing_roster_slots <- fa_market$fa_missing_roster_slots
  rows$fa_is_max <- fa_market$fa_is_max
  rows$fa_max_tier <- fa_market$fa_max_tier
  for (horizon in 1:5) {
    rows[[paste0("projection_fa_value_y", horizon)]] <- calc_fa_market_values(rows, cap_assumptions, horizon = horizon)$fa_value
  }
  rows <- recalculate_projection_scalability(rows, cap_assumptions, contract_scale_model = contract_scale_model)
  rows$contract_status <- contract_status_label(rows$contract_status, rows$contract)

  rows
}

load_contract_option_reference <- function(base_dir) {
  option_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  paths <- list.files(option_dir, pattern = "^contract_options_[0-9]{4}\\.csv$", full.names = TRUE)
  bref_paths <- list.files(option_dir, pattern = "^contracts_bref_[0-9]{4}_current\\.csv$", full.names = TRUE)
  if (!length(paths) && !length(bref_paths)) {
    return(data.frame(
      nba_id = integer(),
      impact_year = integer(),
      name_key = character(),
      team_key = character(),
      contract_status = character(),
      stringsAsFactors = FALSE
    ))
  }

  refs <- lapply(paths, function(path) {
    x <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    if (!("impact_year" %in% names(x))) {
      x$impact_year <- suppressWarnings(as.integer(sub("^contract_options_([0-9]{4})\\.csv$", "\\1", basename(path))))
    }
    if (!("nba_id" %in% names(x))) x$nba_id <- NA_integer_
    if (!("player_name" %in% names(x))) x$player_name <- NA_character_
    if (!("team" %in% names(x))) x$team <- NA_character_
    if (!("contract_status" %in% names(x))) {
      if ("option_type" %in% names(x)) {
        option_type <- trimws(as.character(x$option_type))
        x$contract_status <- ifelse(
          grepl("^player$", option_type, ignore.case = TRUE),
          "Player Option",
          ifelse(grepl("^(club|team)$", option_type, ignore.case = TRUE), "Team Option", NA_character_)
        )
      } else {
        x$contract_status <- NA_character_
      }
    }
    data.frame(
      nba_id = suppressWarnings(as.integer(x$nba_id)),
      impact_year = suppressWarnings(as.integer(x$impact_year)),
      name_key = normalize_name(x$player_name),
      team_key = normalize_team(x$team),
      contract_status = as.character(x$contract_status),
      stringsAsFactors = FALSE
    )
  })
  bref_refs <- lapply(bref_paths, function(path) {
    x <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    contract_year <- suppressWarnings(as.integer(sub("^contracts_bref_([0-9]{4})_current\\.csv$", "\\1", basename(path))))
    if (!is.finite(contract_year)) contract_year <- 2026L
    if (!("nba_id" %in% names(x))) x$nba_id <- NA_integer_
    if (!("player_name" %in% names(x))) x$player_name <- NA_character_
    if (!("team" %in% names(x))) x$team <- NA_character_
    out <- lapply(0:5, function(horizon) {
      status_col <- paste0("contract_status_y", horizon)
      if (!(status_col %in% names(x))) {
        return(NULL)
      }
      data.frame(
        nba_id = suppressWarnings(as.integer(x$nba_id)),
        impact_year = contract_year + horizon,
        name_key = normalize_name(x$player_name),
        team_key = normalize_team(x$team),
        contract_status = as.character(x[[status_col]]),
        stringsAsFactors = FALSE
      )
    })
    do.call(rbind, out[!vapply(out, is.null, logical(1))])
  })
  refs <- do.call(rbind, c(refs, bref_refs))
  refs <- refs[refs$contract_status %in% c("Player Option", "Team Option") & is.finite(refs$impact_year), , drop = FALSE]
  refs <- refs[order(refs$impact_year, refs$nba_id, refs$name_key), ]
  refs[!duplicated(paste(refs$impact_year, refs$nba_id, refs$name_key, refs$team_key)), , drop = FALSE]
}

option_note_exercised_for_year <- function(contracts, impact_year) {
  notes <- if ("contract_notes" %in% names(contracts)) as.character(contracts$contract_notes) else rep("", nrow(contracts))
  label <- paste0(impact_year - 1L, "-", substr(as.character(impact_year), 3, 4))
  typo_label <- paste0(impact_year - 1L, "-", substr(as.character(impact_year - 1L), 3, 4))
  vapply(notes, function(note) {
    if (is.na(note) || !nzchar(note) || (!grepl(label, note, fixed = TRUE) && !grepl(typo_label, note, fixed = TRUE))) return(FALSE)
    parts <- strsplit(note, "\\s*\\|\\s*")[[1]]
    any(
      (grepl(label, parts, fixed = TRUE) | grepl(typo_label, parts, fixed = TRUE)) &
        grepl("\\bexercised\\b", parts, ignore.case = TRUE)
    )
  }, logical(1))
}

spotrac_contract_path <- function(base_dir, contract_year = NULL) {
  contract_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  if (!is.null(contract_year) && is.finite(contract_year)) {
    path <- file.path(contract_dir, paste0("contracts_", as.integer(contract_year), "_spotrac.csv"))
    if (file.exists(path)) return(path)
  }
  paths <- list.files(contract_dir, pattern = "^contracts_[0-9]{4}_spotrac\\.csv$", full.names = TRUE)
  if (!length(paths)) return(NA_character_)
  years <- suppressWarnings(as.integer(sub("^contracts_([0-9]{4})_spotrac\\.csv$", "\\1", basename(paths))))
  paths[order(years, decreasing = TRUE)][[1]]
}

normalize_spotrac_contract_status <- function(status, amount) {
  status <- as.character(status)
  amount <- suppressWarnings(as.numeric(amount))
  status <- ifelse(status %in% c("Signed", "UFA", "RFA", "Player Option", "Team Option", "Non-Guaranteed", "Two-Way", "Rookie FA"), status, NA_character_)
  ifelse(is.na(status) & is.finite(amount) & amount > 0, "Signed", status)
}

read_spotrac_contracts <- function(base_dir, contract_year = NULL) {
  path <- spotrac_contract_path(base_dir, contract_year)
  if (is.na(path) || !file.exists(path)) return(data.frame())
  x <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("nba_id", "player_name", "team") %in% names(x))) return(data.frame())
  if (!("rank" %in% names(x))) x$rank <- seq_len(nrow(x))
  if (!("source_contract_year" %in% names(x))) {
    source_year <- suppressWarnings(as.integer(sub("^contracts_([0-9]{4})_spotrac\\.csv$", "\\1", basename(path))))
    x$source_contract_year <- ifelse(is.finite(source_year), source_year, contract_year)
  }
  salary_cols <- grep("^salary_y[0-9]+$", names(x), value = TRUE)
  status_cols <- paste0("contract_status_y", sub("^salary_y", "", salary_cols))
  for (col in salary_cols) x[[col]] <- suppressWarnings(as.numeric(x[[col]]))
  for (col in status_cols) {
    if (!(col %in% names(x))) x[[col]] <- NA_character_
  }
  for (salary_col in salary_cols) {
    horizon <- sub("^salary_y", "", salary_col)
    status_col <- paste0("contract_status_y", horizon)
    x[[status_col]] <- normalize_spotrac_contract_status(x[[status_col]], x[[salary_col]])
  }
  x
}

overlay_spotrac_contracts <- function(contracts, spotrac) {
  if (!nrow(spotrac)) return(contracts)
  for (col in names(spotrac)) {
    if (!(col %in% names(contracts))) contracts[[col]] <- NA
  }
  salary_cols <- grep("^salary_y[0-9]+$", names(spotrac), value = TRUE)
  status_cols <- paste0("contract_status_y", sub("^salary_y", "", salary_cols))
  for (col in c(salary_cols, status_cols)) {
    if (!(col %in% names(contracts))) contracts[[col]] <- NA
  }

  for (i in seq_len(nrow(spotrac))) {
    nba_id <- suppressWarnings(as.integer(spotrac$nba_id[[i]]))
    if (!is.finite(nba_id)) next
    idx <- match(nba_id, suppressWarnings(as.integer(contracts$nba_id)))
    if (is.na(idx)) {
      new_row <- contracts[NA_integer_, , drop = FALSE]
      new_row[1, ] <- NA
      contracts <- rbind(contracts, new_row)
      idx <- nrow(contracts)
      contracts$nba_id[[idx]] <- nba_id
      if ("rank" %in% names(contracts)) contracts$rank[[idx]] <- 10000L + i
    }

    for (col in intersect(c("player_name", "team", "free_agent_status", "free_agent_year", "contract_type", "contract_status_source", "signed_using", "contract_notes", "match_method", "source"), names(contracts))) {
      value <- spotrac[[col]][[i]]
      if (!is.na(value) && nzchar(trimws(as.character(value)))) contracts[[col]][[idx]] <- value
    }
    if ("source" %in% names(contracts)) contracts$source[[idx]] <- "Spotrac roster table"
    for (salary_col in salary_cols) {
      horizon <- sub("^salary_y", "", salary_col)
      status_col <- paste0("contract_status_y", horizon)
      amount <- suppressWarnings(as.numeric(spotrac[[salary_col]][[i]]))
      status <- if (status_col %in% names(spotrac)) as.character(spotrac[[status_col]][[i]]) else NA_character_
      has_status <- !is.na(status) && nzchar(trimws(status))
      has_amount <- is.finite(amount) && amount > 0
      existing_amount <- suppressWarnings(as.numeric(contracts[[salary_col]][[idx]]))
      existing_status <- if (status_col %in% names(contracts)) as.character(contracts[[status_col]][[idx]]) else NA_character_
      has_existing_amount <- is.finite(existing_amount) && existing_amount > 0
      has_existing_status <- !is.na(existing_status) && nzchar(trimws(existing_status))
      is_fa_estimate <- has_status && status %in% c("UFA", "RFA") && !has_amount
      if (has_status || has_amount) {
        if (has_amount) {
          contracts[[salary_col]][[idx]] <- amount
          contracts[[status_col]][[idx]] <- normalize_spotrac_contract_status(status, amount)
        } else if (!is_fa_estimate || (!has_existing_amount && !has_existing_status)) {
          contracts[[salary_col]][[idx]] <- NA_real_
          contracts[[status_col]][[idx]] <- normalize_spotrac_contract_status(status, amount)
        }
      }
    }
  }
  contracts
}

spotrac_contract_year_rows <- function(base_dir, contract_year = NULL) {
  spotrac <- read_spotrac_contracts(base_dir, contract_year)
  if (!nrow(spotrac)) return(data.frame())
  source_year <- suppressWarnings(as.integer(spotrac$source_contract_year))
  source_year[!is.finite(source_year)] <- ifelse(is.null(contract_year), NA_integer_, as.integer(contract_year))
  rows <- lapply(grep("^salary_y[0-9]+$", names(spotrac), value = TRUE), function(salary_col) {
    horizon <- suppressWarnings(as.integer(sub("^salary_y", "", salary_col)))
    status_col <- paste0("contract_status_y", horizon)
    salary <- suppressWarnings(as.numeric(spotrac[[salary_col]]))
    status <- if (status_col %in% names(spotrac)) as.character(spotrac[[status_col]]) else NA_character_
    data.frame(
      nba_id = suppressWarnings(as.integer(spotrac$nba_id)),
      player_name = as.character(spotrac$player_name),
      team = normalize_team(spotrac$team),
      year = source_year + horizon,
      contract = salary,
      contract_status = normalize_spotrac_contract_status(status, salary),
      free_agent_status = as.character(spotrac$free_agent_status),
      free_agent_year = suppressWarnings(as.integer(spotrac$free_agent_year)),
      source_contract_year = source_year,
      contract_horizon = horizon,
      contract_rank = -1L,
      stringsAsFactors = FALSE
    )
  })
  out <- do.call(rbind, rows)
  out[is.finite(out$nba_id) & is.finite(out$year), , drop = FALSE]
}

load_contract_reference <- function(base_dir) {
  contract_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  current_files <- list.files(contract_dir, pattern = "^contracts_[0-9]{4}_current\\.csv$", full.names = TRUE)
  if (length(current_files) > 0) {
    current_years <- suppressWarnings(as.integer(sub("^contracts_([0-9]{4})_current\\.csv$", "\\1", basename(current_files))))
    current_files <- current_files[order(current_years, decreasing = TRUE)]
  }
  reference_path <- file.path(contract_dir, "contracts_2026_reference.csv")
  path <- if (length(current_files) > 0 && file.exists(current_files[[1]])) current_files[[1]] else reference_path
  if (!file.exists(path)) {
    return(data.frame(nba_id = integer(), contract = numeric(), stringsAsFactors = FALSE))
  }
  contract_year <- suppressWarnings(as.integer(sub("^contracts_([0-9]{4}).*$", "\\1", basename(path))))
  if (!is.finite(contract_year)) contract_year <- 2026L

  contracts <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("nba_id", "salary_y0") %in% names(contracts))) {
    return(data.frame(nba_id = integer(), contract = numeric(), stringsAsFactors = FALSE))
  }
  contracts <- overlay_spotrac_contracts(contracts, read_spotrac_contracts(base_dir, contract_year))
  if (!("player_name" %in% names(contracts))) contracts$player_name <- NA_character_
  if (!("team" %in% names(contracts))) contracts$team <- NA_character_
  if (!("rank" %in% names(contracts))) contracts$rank <- seq_len(nrow(contracts))
  if (!("guaranteed" %in% names(contracts))) contracts$guaranteed <- NA_real_
  contracts <- attach_contract_ids_from_history(base_dir, contracts)
  option_reference <- load_contract_option_reference(base_dir)
  infer_status <- function(horizon) {
    salary_col <- paste0("salary_y", horizon)
    if (!(salary_col %in% names(contracts))) return(rep(NA_character_, nrow(contracts)))
    salary <- suppressWarnings(as.numeric(contracts[[salary_col]]))
    status_col <- paste0("contract_status_y", horizon)
    out <- ifelse(is.finite(salary) & salary > 0, "Signed", NA_character_)
    if (status_col %in% names(contracts)) {
      explicit_status <- as.character(contracts[[status_col]])
      has_explicit_status <- !is.na(explicit_status) & nzchar(trimws(explicit_status))
      out[has_explicit_status] <- explicit_status[has_explicit_status]
    }
    if (!nrow(option_reference)) return(out)

    options <- option_reference[option_reference$impact_year == contract_year + horizon, , drop = FALSE]
    if (!nrow(options)) return(out)
    exercised_option <- option_note_exercised_for_year(contracts, contract_year + horizon)

    id_match <- match(contracts$nba_id, options$nba_id)
    has_id_match <- !is.na(id_match) & !is.na(contracts$nba_id) & !exercised_option
    out[has_id_match] <- options$contract_status[id_match[has_id_match]]

    needs_name_match <- is.na(out) | out == "Signed"
    contract_key <- paste(normalize_name(contracts$player_name), normalize_team(contracts$team), sep = "||")
    option_key <- paste(options$name_key, options$team_key, sep = "||")
    name_match <- match(contract_key, option_key)
    has_name_match <- needs_name_match & !is.na(name_match) & !exercised_option
    out[has_name_match] <- options$contract_status[name_match[has_name_match]]
    out
  }

  out <- data.frame(
    nba_id = suppressWarnings(as.integer(contracts$nba_id)),
    contract_player_name = as.character(contracts$player_name),
    contract_team = as.character(contracts$team),
    contract = suppressWarnings(as.numeric(contracts$salary_y0)),
    contract_status = infer_status(0),
    contract_rank = suppressWarnings(as.numeric(contracts$rank)),
    stringsAsFactors = FALSE
  )
  for (horizon in 1:5) {
    salary_col <- paste0("salary_y", horizon)
    out[[paste0("contract_y", horizon)]] <- if (salary_col %in% names(contracts)) {
      suppressWarnings(as.numeric(contracts[[salary_col]]))
    } else {
      NA_real_
    }
    out[[paste0("contract_status_y", horizon)]] <- infer_status(horizon)
  }
  out <- out[!is.na(out$nba_id), ]
  out <- out[order(out$nba_id, out$contract_rank, -out$contract), ]
  out <- out[!duplicated(out$nba_id), ]
  out$contract_rank <- NULL
  out
}

load_contract_year_reference <- function(base_dir) {
  path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "contracts_by_year.csv")
  if (!file.exists(path)) {
    return(data.frame(nba_id = integer(), year = integer(), stringsAsFactors = FALSE))
  }
  contracts <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  required <- c("nba_id", "year", "contract")
  if (!all(required %in% names(contracts))) {
    return(data.frame(nba_id = integer(), year = integer(), stringsAsFactors = FALSE))
  }
  if (!("team" %in% names(contracts))) contracts$team <- NA_character_
  if (!("contract_status" %in% names(contracts))) contracts$contract_status <- NA_character_
  if (!("free_agent_status" %in% names(contracts))) contracts$free_agent_status <- NA_character_
  if (!("free_agent_year" %in% names(contracts))) contracts$free_agent_year <- NA_integer_
  if (!("source_contract_year" %in% names(contracts))) contracts$source_contract_year <- NA_integer_
  if (!("contract_horizon" %in% names(contracts))) contracts$contract_horizon <- NA_integer_
  if (!("contract_rank" %in% names(contracts))) contracts$contract_rank <- seq_len(nrow(contracts))
  spotrac_rows <- spotrac_contract_year_rows(base_dir)
  if (nrow(spotrac_rows)) {
    for (col in setdiff(names(contracts), names(spotrac_rows))) spotrac_rows[[col]] <- NA
    for (col in setdiff(names(spotrac_rows), names(contracts))) contracts[[col]] <- NA
    contracts <- rbind(contracts, spotrac_rows[, names(contracts), drop = FALSE])
  }

  contracts <- contracts[is.finite(suppressWarnings(as.numeric(contracts$contract))) & suppressWarnings(as.numeric(contracts$contract)) > 0, , drop = FALSE]
  contracts <- contracts[order(
    suppressWarnings(as.integer(contracts$nba_id)),
    suppressWarnings(as.integer(contracts$year)),
    suppressWarnings(as.integer(contracts$contract_horizon)),
    -suppressWarnings(as.integer(contracts$source_contract_year)),
    suppressWarnings(as.integer(contracts$contract_rank))
  ), ]
  contracts <- contracts[!duplicated(paste(contracts$nba_id, contracts$year)), ]
  data.frame(
    nba_id = suppressWarnings(as.integer(contracts$nba_id)),
    year = suppressWarnings(as.integer(contracts$year)),
    contract_year_team = as.character(contracts$team),
    contract_year_contract = suppressWarnings(as.numeric(contracts$contract)),
    contract_year_status = as.character(contracts$contract_status),
    contract_year_fa_status = as.character(contracts$free_agent_status),
    contract_year_fa_year = suppressWarnings(as.integer(contracts$free_agent_year)),
    stringsAsFactors = FALSE
  )
}

append_latest_contract_inactive_rows <- function(x, contract_reference, latest_year) {
  if (nrow(contract_reference) == 0 || !("contract" %in% names(contract_reference))) {
    return(x)
  }

  current_ids <- unique(x$nba_id[x$year == latest_year])
  missing_contracts <- contract_reference[
    !(contract_reference$nba_id %in% current_ids) &
      !is.na(contract_reference$contract) &
      contract_reference$contract > 0,
    ,
    drop = FALSE
  ]
  if (nrow(missing_contracts) == 0) {
    return(x)
  }

  prior <- x[x$year < latest_year & x$nba_id %in% missing_contracts$nba_id, , drop = FALSE]
  if (nrow(prior) == 0) {
    return(x)
  }

  prior <- prior[order(prior$nba_id, -prior$year), ]
  inactive <- prior[!duplicated(prior$nba_id), , drop = FALSE]
  contract_match <- match(inactive$nba_id, missing_contracts$nba_id)
  year_delta <- latest_year - inactive$year

  inactive$player_name <- ifelse(
    !is.na(missing_contracts$contract_player_name[contract_match]) & missing_contracts$contract_player_name[contract_match] != "",
    missing_contracts$contract_player_name[contract_match],
    inactive$player_name
  )
  inactive$year <- latest_year
  inactive$team <- ifelse(
    !is.na(missing_contracts$contract_team[contract_match]) & missing_contracts$contract_team[contract_match] != "",
    missing_contracts$contract_team[contract_match],
    inactive$team
  )
  inactive$age <- suppressWarnings(as.numeric(inactive$age)) + year_delta
  inactive$yoe <- suppressWarnings(as.numeric(inactive$yoe)) + year_delta
  inactive$Minutes <- 0
  if ("games" %in% names(inactive)) inactive$games <- 0
  if ("p_usg" %in% names(inactive)) inactive$p_usg <- NA_real_
  for (source_col in intersect(c("o_epm", "o_dpm", "d_epm", "d_dpm", "off_dep", "def_dep"), names(inactive))) {
    inactive[[source_col]] <- NA_real_
  }
  inactive$contract <- missing_contracts$contract[contract_match]
  for (horizon in 1:5) {
    contract_col <- paste0("contract_y", horizon)
    if (contract_col %in% names(inactive) && contract_col %in% names(missing_contracts)) {
      inactive[[contract_col]] <- missing_contracts[[contract_col]][contract_match]
    }
    status_col <- paste0("contract_status_y", horizon)
    if (status_col %in% names(inactive) && status_col %in% names(missing_contracts)) {
      inactive[[status_col]] <- missing_contracts[[status_col]][contract_match]
    }
  }
  if ("contract_status" %in% names(inactive) && "contract_status" %in% names(missing_contracts)) {
    inactive$contract_status <- missing_contracts$contract_status[contract_match]
  }
  inactive$availability_status <- "DNQ"
  inactive$availability_reason <- "No qualifying current-season sample"
  inactive$skill_source <- "carried_forward"
  inactive$skill_source_year <- latest_year - year_delta

  rbind(x, inactive[, names(x), drop = FALSE])
}

carry_forward_dnq_profiles <- function(x, latest_year) {
  min_games <- suppressWarnings(as.numeric(Sys.getenv("IMPACT_DNQ_MIN_GAMES", unset = "25")))
  if (is.na(min_games)) min_games <- 25

  if (!("availability_status" %in% names(x))) x$availability_status <- "qualified"
  if (!("availability_reason" %in% names(x))) x$availability_reason <- ""
  if (!("skill_source" %in% names(x))) x$skill_source <- "current"
  if (!("skill_source_year" %in% names(x))) x$skill_source_year <- x$year
  if (!("games" %in% names(x))) x$games <- NA_real_

  current <- x$year == latest_year
  limited_sample <- current & !is.na(x$games) & x$games > 0 & x$games < min_games
  inactive <- current & (!is.na(x$Minutes) & x$Minutes <= 0)
  dnq <- limited_sample | inactive | x$availability_status == "DNQ"
  x$availability_status[dnq] <- "DNQ"
  x$availability_reason[limited_sample] <- paste0("Limited current-season sample: ", round(x$games[limited_sample], 0), " games")
  x$availability_reason[inactive] <- "No qualifying current-season sample"

  carry_cols <- intersect(
    c(
      "FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH",
      "OFF", "DEF", "TOTAL", "FINAL_OFF", "FINAL_DEF", "FINAL_TOTAL"
    ),
    names(x)
  )
  prior_pool <- x[x$year < latest_year & (is.na(x$games) | x$games >= min_games), , drop = FALSE]
  prior_pool <- prior_pool[order(prior_pool$nba_id, -prior_pool$year), ]
  prior_pool <- prior_pool[!duplicated(prior_pool$nba_id), , drop = FALSE]

  carry_forward <- dnq & inactive

  for (i in which(carry_forward)) {
    prior_idx <- match(x$nba_id[i], prior_pool$nba_id)
    if (is.na(prior_idx)) {
      next
    }
    for (col in carry_cols) {
      x[[col]][i] <- prior_pool[[col]][prior_idx]
    }
    x$skill_source[i] <- "carried_forward"
    x$skill_source_year[i] <- prior_pool$year[prior_idx]
  }

  x
}

load_current_roster_truth <- function(base_dir, roster_year) {
  roster_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  path <- file.path(roster_dir, paste0("current_rosters_", roster_year, ".csv"))
  if (!file.exists(path)) {
    return(data.frame(
      nba_id = integer(),
      player_name = character(),
      name_key = character(),
      roster_truth_team = character(),
      roster_truth_source = character(),
      roster_truth_pulled_at = character(),
      stringsAsFactors = FALSE
    ))
  }

  roster <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  required <- c("player_name", "team")
  if (!all(required %in% names(roster))) {
    stop("Roster truth file is missing required columns: ", path)
  }
  if (!("nba_id" %in% names(roster))) roster$nba_id <- NA_integer_
  if (!("roster_source" %in% names(roster))) roster$roster_source <- "NBA.com league roster"
  if (!("pulled_at" %in% names(roster))) roster$pulled_at <- NA_character_
  if (!("rights_team" %in% names(roster))) roster$rights_team <- roster$team
  if (!("contract_status" %in% names(roster))) roster$contract_status <- NA_character_
  if (!("roster_state" %in% names(roster))) roster$roster_state <- ifelse(normalize_team(roster$team) == "FA", "free_agent", "active")

  out <- data.frame(
    nba_id = suppressWarnings(as.integer(roster$nba_id)),
    player_name = as.character(roster$player_name),
    name_key = normalize_name(roster$player_name),
    roster_truth_team = normalize_team(roster$team),
    rights_team = normalize_team(roster$rights_team),
    roster_contract_status = as.character(roster$contract_status),
    roster_state = as.character(roster$roster_state),
    roster_truth_source = as.character(roster$roster_source),
    roster_truth_pulled_at = as.character(roster$pulled_at),
    stringsAsFactors = FALSE
  )
  out$roster_truth_team[is_blank_text(out$roster_truth_team)] <- "FA"
  out$rights_team[is_blank_text(out$rights_team)] <- ifelse(out$roster_truth_team == "FA", "FA", out$roster_truth_team)
  out <- out[nzchar(out$name_key), , drop = FALSE]
  out <- out[order(is.na(out$nba_id), out$nba_id, out$name_key), , drop = FALSE]
  out[!duplicated(ifelse(!is.na(out$nba_id), paste0("id:", out$nba_id), paste0("name:", out$name_key))), , drop = FALSE]
}

apply_current_roster_truth <- function(x, base_dir, roster_year) {
  roster <- load_current_roster_truth(base_dir, roster_year)
  x$current_roster_team <- normalize_team(x$team)
  x$roster_truth_team <- NA_character_
  x$roster_status_source <- NA_character_
  x$roster_truth_pulled_at <- NA_character_
  x$roster_contract_status <- NA_character_
  if (!("rights_team" %in% names(x))) x$rights_team <- NA_character_
  if (!("roster_state" %in% names(x))) x$roster_state <- NA_character_

  latest_rows <- x$year == roster_year
  if (!any(latest_rows, na.rm = TRUE)) {
    return(x)
  }
  if (!nrow(roster)) {
    allow_missing <- tolower(trimws(Sys.getenv("FRONTEND_ALLOW_MISSING_ROSTER_TRUTH", "false"))) %in% c("1", "true", "yes")
    message("Roster truth not found for ", roster_year, ". Set FRONTEND_ALLOW_MISSING_ROSTER_TRUTH=true to keep legacy team assignments.")
    if (!allow_missing) {
      stop("Missing current roster truth for ", roster_year, ". Run script/data/pull_current_nba_rosters.R first.")
    }
    return(x)
  }

  row_ids <- suppressWarnings(as.integer(x$nba_id))
  id_match <- match(row_ids, roster$nba_id)
  name_match <- match(normalize_name(x$player_name), roster$name_key)
  roster_match <- ifelse(!is.na(id_match), id_match, name_match)
  matched <- latest_rows & !is.na(roster_match)
  missing <- latest_rows & is.na(roster_match)

  truth_team <- rep(NA_character_, nrow(x))
  truth_team[matched] <- roster$roster_truth_team[roster_match[matched]]
  truth_source <- rep(NA_character_, nrow(x))
  truth_source[matched] <- roster$roster_truth_source[roster_match[matched]]
  truth_pulled_at <- rep(NA_character_, nrow(x))
  truth_pulled_at[matched] <- roster$roster_truth_pulled_at[roster_match[matched]]
  truth_rights_team <- rep(NA_character_, nrow(x))
  truth_rights_team[matched] <- roster$rights_team[roster_match[matched]]
  truth_contract_status <- rep(NA_character_, nrow(x))
  truth_contract_status[matched] <- roster$roster_contract_status[roster_match[matched]]
  truth_roster_state <- rep(NA_character_, nrow(x))
  truth_roster_state[matched] <- roster$roster_state[roster_match[matched]]

  x$roster_truth_team[matched] <- truth_team[matched]
  x$roster_status_source[matched] <- truth_source[matched]
  x$roster_truth_pulled_at[matched] <- truth_pulled_at[matched]
  x$roster_contract_status[matched] <- truth_contract_status[matched]
  x$rights_team[matched] <- truth_rights_team[matched]
  x$roster_state[matched] <- truth_roster_state[matched]
  x$roster_truth_team[missing] <- "FA"
  x$roster_status_source[missing] <- "NBA.com league roster missing player"
  x$rights_team[missing] <- "FA"
  x$roster_state[missing] <- "missing_roster_truth"

  active <- matched & truth_team != "FA" & !is_blank_text(truth_team)
  inactive <- latest_rows & !active

  x$team[active] <- truth_team[active]
  x$incumbent_team[active] <- truth_team[active]
  x$market_team[active] <- truth_team[active]
  x$team_projection_base[active] <- truth_team[active]
  x$current_roster_team[active] <- truth_team[active]
  x$rights_team[active & is_blank_text(x$rights_team)] <- truth_team[active & is_blank_text(x$rights_team)]

  x$team[inactive] <- "FA"
  x$market_team[inactive] <- "FA"
  x$team_projection_base[inactive] <- "FA"
  x$current_roster_team[inactive] <- "FA"
  x$projection_roster_status[inactive] <- "open_market"
  roster_fa_status <- truth_contract_status[inactive]
  roster_fa_status <- ifelse(roster_fa_status %in% c("RFA", "UFA", "Rookie FA"), roster_fa_status, NA_character_)
  x$contract_status[inactive] <- ifelse(
    !is.na(roster_fa_status) & nzchar(trimws(roster_fa_status)),
    roster_fa_status,
    ifelse(x$contract_status[inactive] %in% c("RFA", "Rookie FA"), x$contract_status[inactive], "UFA")
  )
  x$rights_team[inactive & is_blank_text(x$rights_team)] <- "FA"

  projected_rookies <- !latest_rows &
    row_ids < 0 &
    !is.na(id_match) &
    roster$roster_state[id_match] == "rookie_cap_hold" &
    roster$roster_truth_team[id_match] != "FA"
  if (any(projected_rookies, na.rm = TRUE)) {
    rookie_roster_idx <- id_match[projected_rookies]
    rookie_team <- roster$roster_truth_team[rookie_roster_idx]
    x$roster_truth_team[projected_rookies] <- rookie_team
    x$roster_status_source[projected_rookies] <- roster$roster_truth_source[rookie_roster_idx]
    x$roster_truth_pulled_at[projected_rookies] <- roster$roster_truth_pulled_at[rookie_roster_idx]
    x$roster_contract_status[projected_rookies] <- roster$roster_contract_status[rookie_roster_idx]
    x$roster_state[projected_rookies] <- roster$roster_state[rookie_roster_idx]
    x$rights_team[projected_rookies] <- roster$rights_team[rookie_roster_idx]
    x$team[projected_rookies] <- rookie_team
    x$incumbent_team[projected_rookies] <- rookie_team
    x$market_team[projected_rookies] <- rookie_team
    x$team_projection_base[projected_rookies] <- rookie_team
    x$current_roster_team[projected_rookies] <- rookie_team
    x$contract_status[projected_rookies] <- "Rookie FA"
    x$projection_roster_status[projected_rookies] <- "rookie_fa"
  }

  message(
    "Roster truth applied for ", roster_year, ": active=", sum(active, na.rm = TRUE),
    ", FA/missing=", sum(inactive, na.rm = TRUE),
    ", roster rows=", nrow(roster)
  )
  x
}

enforce_roster_truth_placements <- function(x, roster_year) {
  if (!("roster_truth_team" %in% names(x))) return(x)
  player_year <- suppressWarnings(as.integer(x$year))
  latest_rows <- player_year >= roster_year & !is_blank_text(x$roster_truth_team)
  truth_team <- normalize_team(x$roster_truth_team)
  truth_team[is_blank_text(truth_team)] <- NA_character_
  active <- latest_rows & !is.na(truth_team) & truth_team != "FA"
  inactive <- latest_rows & !active

  if (any(active, na.rm = TRUE)) {
    x$team[active] <- truth_team[active]
    x$current_roster_team[active] <- truth_team[active]
    x$incumbent_team[active] <- truth_team[active]
    x$market_team[active] <- truth_team[active]
    x$team_projection_base[active] <- truth_team[active]
    x$projection_roster_status[active] <- projection_roster_status(x$contract_status[active], x$contract[active])
    if ("rights_team" %in% names(x)) {
      x$rights_team[active & is_blank_text(x$rights_team)] <- truth_team[active & is_blank_text(x$rights_team)]
    }
  }

  if (any(inactive, na.rm = TRUE)) {
    x$team[inactive] <- "FA"
    x$current_roster_team[inactive] <- "FA"
    x$market_team[inactive] <- "FA"
    x$team_projection_base[inactive] <- "FA"
    if ("contract" %in% names(x)) x$contract[inactive] <- NA_real_
    if ("value_add" %in% names(x)) x$value_add[inactive] <- NA_real_
    for (col in grep("^projection_contract_y[0-9]+$", names(x), value = TRUE)) x[[col]][inactive] <- NA_real_
    for (col in grep("^projection_effective_contract_y[0-9]+$", names(x), value = TRUE)) x[[col]][inactive] <- NA_real_
    x$projection_roster_status[inactive] <- "open_market"
    if ("roster_contract_status" %in% names(x)) {
      roster_status <- as.character(x$roster_contract_status[inactive])
      roster_status <- ifelse(roster_status %in% c("RFA", "UFA", "Rookie FA"), roster_status, NA_character_)
      x$contract_status[inactive] <- ifelse(
        !is.na(roster_status) & nzchar(trimws(roster_status)),
        roster_status,
        ifelse(x$contract_status[inactive] %in% c("RFA", "Rookie FA"), x$contract_status[inactive], "UFA")
      )
    } else {
      x$contract_status[inactive] <- ifelse(x$contract_status[inactive] %in% c("RFA", "Rookie FA"), x$contract_status[inactive], "UFA")
    }
  }
  x
}

write_roster_truth_audit <- function(base_dir, players, teams, team_lineups, roster_year) {
  roster <- load_current_roster_truth(base_dir, roster_year)
  out_dir <- file.path(base_dir, "processed", "livedata", "impactrefresh")
  audit_path <- file.path(out_dir, paste0("current_roster_audit_", roster_year, ".csv"))
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

  season_players <- players[players$year == roster_year, , drop = FALSE]
  if (!nrow(season_players)) {
    return(data.frame())
  }
  season_players$name_key <- normalize_name(season_players$player_name)

  if (nrow(roster)) {
    id_match <- match(suppressWarnings(as.integer(season_players$nba_id)), roster$nba_id)
    name_match <- match(season_players$name_key, roster$name_key)
    roster_match <- ifelse(!is.na(id_match), id_match, name_match)
    truth_team <- ifelse(!is.na(roster_match), roster$roster_truth_team[roster_match], "FA")
    truth_source <- ifelse(!is.na(roster_match), roster$roster_truth_source[roster_match], "NBA.com league roster missing player")
  } else {
    truth_team <- rep(NA_character_, nrow(season_players))
    truth_source <- rep("missing roster truth file", nrow(season_players))
  }

  lineup_keys <- unique(paste(
    suppressWarnings(as.integer(team_lineups$year)),
    suppressWarnings(as.integer(team_lineups$nba_id)),
    normalize_team(team_lineups$team),
    sep = "||"
  ))
  lineup_team <- normalize_team(season_players$team)
  in_lineup <- paste(roster_year, suppressWarnings(as.integer(season_players$nba_id)), lineup_team, sep = "||") %in% lineup_keys

  audit <- data.frame(
    year = roster_year,
    nba_id = suppressWarnings(as.integer(season_players$nba_id)),
    player_name = season_players$player_name,
    impact_team = normalize_team(season_players$team),
    roster_truth_team = truth_team,
    in_team_lineup = in_lineup,
    contract_status = as.character(season_players$contract_status),
    roster_status_source = truth_source,
    stringsAsFactors = FALSE
  )
  audit$issue <- ifelse(
    is.na(audit$roster_truth_team),
    "missing_roster_truth",
    ifelse(
      audit$in_team_lineup & audit$roster_truth_team == "FA",
      "fa_player_in_lineup",
      ifelse(
        audit$in_team_lineup & audit$impact_team != audit$roster_truth_team,
        "lineup_team_mismatch",
        ifelse(audit$impact_team != audit$roster_truth_team, "impact_team_mismatch", "")
      )
    )
  )
  write.csv(audit, audit_path, row.names = FALSE, na = "")

  if (nrow(roster)) {
    lineup_season <- team_lineups[suppressWarnings(as.integer(team_lineups$year)) == roster_year, , drop = FALSE]
    if (nrow(lineup_season)) {
      lineup_id_match <- match(suppressWarnings(as.integer(lineup_season$nba_id)), roster$nba_id)
      lineup_name_match <- match(normalize_name(lineup_season$player_name), roster$name_key)
      lineup_match <- ifelse(!is.na(lineup_id_match), lineup_id_match, lineup_name_match)
      lineup_truth_team <- ifelse(!is.na(lineup_match), roster$roster_truth_team[lineup_match], "FA")
      stale_lineups <- lineup_season[
        is.na(lineup_match) |
          lineup_truth_team == "FA" |
          normalize_team(lineup_season$team) != lineup_truth_team,
        ,
        drop = FALSE
      ]
      if (nrow(stale_lineups)) {
        stale_names <- paste(utils::head(paste(stale_lineups$player_name, stale_lineups$team, sep = "@"), 20), collapse = ", ")
        stop("Roster truth audit failed: stale ", roster_year, " lineup rows found: ", stale_names)
      }
    }

    active_counts <- aggregate(
      season_players$nba_id,
      by = list(team = normalize_team(season_players$team)),
      FUN = function(v) length(unique(v))
    )
    names(active_counts)[2] <- "expected_count"
    active_counts <- active_counts[active_counts$team != "FA", , drop = FALSE]
    team_scenario <- if ("scenario_id" %in% names(teams)) as.character(teams$scenario_id) else rep("base", nrow(teams))
    base_teams <- teams[suppressWarnings(as.integer(teams$year)) == roster_year & (is.na(team_scenario) | team_scenario == "base"), , drop = FALSE]
    team_counts <- merge(
      active_counts,
      base_teams[, intersect(c("team", "roster_count"), names(base_teams)), drop = FALSE],
      by = "team",
      all.x = TRUE
    )
    team_counts$expected_projection_count <- pmin(team_counts$expected_count, TEAM_PROJECTION_PLAYER_LIMIT)
    bad_counts <- team_counts[
      is.na(team_counts$roster_count) | team_counts$expected_projection_count != team_counts$roster_count,
      ,
      drop = FALSE
    ]
    if (nrow(bad_counts)) {
      bad <- paste(utils::head(paste0(bad_counts$team, " expected ", bad_counts$expected_projection_count, " got ", bad_counts$roster_count), 20), collapse = ", ")
      stop("Roster truth audit failed: team projection top-player roster counts do not match corrected player pools: ", bad)
    }
  }

  message("Roster truth audit written: ", audit_path)
  audit
}

build_impact_players <- function(base_dir) {
  cap_assumptions <- load_cap_assumptions(base_dir)
  impact_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv")
  skill_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "skilloutput.csv")
  impact <- read_csv_required(impact_path, c("nba_id", "player_name", "year", "Minutes", "off_dep", "def_dep"))
  skill <- read_csv_required(skill_path, c("nba_id", "player_name", "year", "FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH", "OFF", "DEF", "TOTAL"))

  raw_epm_dir <- file.path(base_dir, "raw", "epm")
  epm_files <- list.files(raw_epm_dir, pattern = "^epm\\d+\\.csv$", full.names = TRUE)
  epm <- do.call(rbind, lapply(epm_files, function(path) {
    x <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    keep <- intersect(c("season", "nba_id", "name", "team", "p_mpg", "p_usg", "oepm", "depm", "epm"), names(x))
    x <- x[, keep, drop = FALSE]
    names(x)[names(x) == "season"] <- "year"
    x
  }))
  epm <- epm[!duplicated(paste(epm$year, epm$nba_id)), ]

  stats_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  stat_meta <- data.frame(
    nba_id = integer(),
    year = integer(),
    databallr_position = character(),
    age = numeric(),
    draft_year = numeric(),
    overall_pick = numeric(),
    games = numeric(),
    stat_minutes = numeric(),
    stat_mpg = numeric()
  )
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    latest_impact_year <- max(suppressWarnings(as.integer(impact$year)), na.rm = TRUE)
    latest_impact_keys <- unique(impact[impact$year == latest_impact_year, c("nba_id", "year"), drop = FALSE])
    stats <- append_darko_dpm_fallback_rows(
      stats = stats,
      epm_rows = latest_impact_keys,
      base_dir = base_dir,
      strict = TRUE
    )
    if (all(c("nba_id", "year", "Pos2") %in% names(stats))) {
      keep <- intersect(c("nba_id", "year", "Pos2", "Age", "draft_year", "overall_pick", "GamesPlayed", "Minutes", "MPG"), names(stats))
      stat_meta <- stats[, keep, drop = FALSE]
      if (!("Age" %in% names(stat_meta))) stat_meta$Age <- NA_real_
      if (!("draft_year" %in% names(stat_meta))) stat_meta$draft_year <- NA_real_
      if (!("overall_pick" %in% names(stat_meta))) stat_meta$overall_pick <- NA_real_
      if (!("GamesPlayed" %in% names(stat_meta))) stat_meta$GamesPlayed <- NA_real_
      if (!("Minutes" %in% names(stat_meta))) stat_meta$Minutes <- NA_real_
      if (!("MPG" %in% names(stat_meta))) stat_meta$MPG <- NA_real_
      names(stat_meta)[names(stat_meta) == "Pos2"] <- "databallr_position"
      names(stat_meta)[names(stat_meta) == "Age"] <- "age"
      names(stat_meta)[names(stat_meta) == "GamesPlayed"] <- "games"
      names(stat_meta)[names(stat_meta) == "Minutes"] <- "stat_minutes"
      names(stat_meta)[names(stat_meta) == "MPG"] <- "stat_mpg"
      stat_meta$databallr_position <- normalize_position_label(stat_meta$databallr_position)
      stat_meta <- stat_meta[!duplicated(paste(stat_meta$year, stat_meta$nba_id)), ]
    }
  }

  bref_path <- file.path(base_dir, "raw", "bref_player_seasons.csv")
  bref_meta <- data.frame(year = integer(), name_key = character(), bref_position = character(), stringsAsFactors = FALSE)
  if (file.exists(bref_path)) {
    bref <- read.csv(bref_path, stringsAsFactors = FALSE, check.names = FALSE)
    if (all(c("year", "player_name", "pos") %in% names(bref))) {
      if (!("minutes" %in% names(bref))) bref$minutes <- NA_real_
      if (!("team" %in% names(bref))) bref$team <- NA_character_
      bref$name_key <- normalize_name(bref$player_name)
      bref$minutes <- suppressWarnings(as.numeric(bref$minutes))
      bref <- bref[
        bref$name_key != "" &
          bref$pos %in% c("PG", "SG", "SF", "PF", "C"),
        c("year", "name_key", "pos", "team", "minutes"),
        drop = FALSE
      ]
      bref <- bref[order(bref$year, bref$name_key, -as.integer(bref$team == "TOT"), -bref$minutes), ]
      bref <- bref[!duplicated(paste(bref$year, bref$name_key)), ]
      bref_meta <- data.frame(
        year = suppressWarnings(as.integer(bref$year)),
        name_key = bref$name_key,
        bref_position = bref$pos,
        stringsAsFactors = FALSE
      )
    }
  }

  bref_position_path <- file.path(base_dir, "raw", "bref_position_estimates.csv")
  bref_position_meta <- data.frame(
    year = integer(),
    name_key = character(),
    bref_position_estimate = character(),
    pg_share = numeric(),
    sg_share = numeric(),
    sf_share = numeric(),
    pf_share = numeric(),
    c_share = numeric(),
    position_entropy = numeric(),
    position_index = numeric(),
    stringsAsFactors = FALSE
  )
  if (file.exists(bref_position_path)) {
    bref_pos <- read.csv(bref_position_path, stringsAsFactors = FALSE, check.names = FALSE)
    needed_cols <- c("year", "player_name", "position_estimate", position_share_columns())
    if (all(needed_cols %in% names(bref_pos))) {
      if (!("minutes" %in% names(bref_pos))) bref_pos$minutes <- NA_real_
      bref_pos$name_key <- normalize_name(bref_pos$player_name)
      if (!("position_entropy" %in% names(bref_pos))) bref_pos$position_entropy <- NA_real_
      if (!("position_index" %in% names(bref_pos))) bref_pos$position_index <- NA_real_
      bref_pos$minutes <- suppressWarnings(as.numeric(bref_pos$minutes))
      for (share_col in position_share_columns()) {
        bref_pos[[share_col]] <- suppressWarnings(as.numeric(bref_pos[[share_col]]))
      }
      bref_pos <- bref_pos[
        bref_pos$name_key != "" & !is.na(bref_pos$year),
        c("year", "name_key", "position_estimate", position_share_columns(), "position_entropy", "position_index", "minutes"),
        drop = FALSE
      ]
      bref_pos <- bref_pos[order(bref_pos$year, bref_pos$name_key, -bref_pos$minutes), ]
      bref_pos <- bref_pos[!duplicated(paste(bref_pos$year, bref_pos$name_key)), ]
      bref_position_meta <- data.frame(
        year = suppressWarnings(as.integer(bref_pos$year)),
        name_key = bref_pos$name_key,
        bref_position_estimate = normalize_position_label(bref_pos$position_estimate),
        pg_share = bref_pos$pg_share,
        sg_share = bref_pos$sg_share,
        sf_share = bref_pos$sf_share,
        pf_share = bref_pos$pf_share,
        c_share = bref_pos$c_share,
        position_entropy = suppressWarnings(as.numeric(bref_pos$position_entropy)),
        position_index = suppressWarnings(as.numeric(bref_pos$position_index)),
        stringsAsFactors = FALSE
      )
    }
  }

  positions_path <- file.path(base_dir, "raw", "switch", "player_positions.rds")
  positions <- data.frame(nba_id = integer(), position = character())
  if (file.exists(positions_path)) {
    pos <- readRDS(positions_path)
    if (all(c("PERSON_ID", "POSITION") %in% names(pos))) {
      positions <- data.frame(nba_id = pos$PERSON_ID, position = pos$POSITION, stringsAsFactors = FALSE)
      positions <- positions[!duplicated(positions$nba_id), ]
    }
  }

  x <- merge(impact, skill, by = c("nba_id", "player_name", "year"), all = TRUE, suffixes = c("", "_skill"))
  x <- merge(x, epm, by = c("nba_id", "year"), all.x = TRUE)
  x <- merge(x, stat_meta, by = c("nba_id", "year"), all.x = TRUE)
  x <- merge(x, positions, by = "nba_id", all.x = TRUE)
  contract_reference <- load_contract_reference(base_dir)
  contract_year_reference <- load_contract_year_reference(base_dir)
  x <- merge(x, contract_year_reference, by = c("nba_id", "year"), all.x = TRUE)
  x <- merge(x, contract_reference, by = "nba_id", all.x = TRUE)
  for (pair in list(
    c("o_epm", "SOURCE_O_EPM"),
    c("o_dpm", "SOURCE_O_DPM"),
    c("d_epm", "SOURCE_D_EPM"),
    c("d_dpm", "SOURCE_D_DPM"),
    c("off_dep", "IMPACT_OFF"),
    c("def_dep", "IMPACT_DEF")
  )) {
    target_col <- pair[[1]]
    source_col <- pair[[2]]
    if (target_col %in% names(x) && source_col %in% names(x)) {
      x[[target_col]] <- coalesce_numeric(x[[target_col]], x[[source_col]])
    }
  }
  source_cols <- intersect(c("o_epm", "o_dpm", "d_epm", "d_dpm"), names(x))
  if (length(source_cols) == 4) {
    has_current_sources <- Reduce(
      `&`,
      lapply(source_cols, function(col) is.finite(suppressWarnings(as.numeric(x[[col]]))))
    )
    x <- x[has_current_sources, , drop = FALSE]
  }
  x$player_name <- coalesce_col(x$player_name, x$name)
  x$team <- ifelse(is.na(x$team) | x$team == "", "FA", x$team)
  x$name_key <- normalize_name(x$player_name)
  x <- merge(x, bref_meta, by = c("year", "name_key"), all.x = TRUE)
  x <- merge(x, bref_position_meta, by = c("year", "name_key"), all.x = TRUE)
  x$position <- coalesce_col(x$bref_position_estimate, coalesce_col(x$databallr_position, coalesce_col(x$bref_position, x$position)))
  x$name_key <- NULL
  x$bref_position <- NULL
  x$bref_position_estimate <- NULL
  x$databallr_position <- NULL
  x$position <- normalize_position_label(x$position)
  x$position <- ifelse(is.na(x$position) | x$position == "", "UNK", x$position)
  position_shares <- normalize_position_share_matrix(x[, intersect(position_share_columns(), names(x)), drop = FALSE], x$position)
  for (share_col in position_share_columns()) {
    x[[share_col]] <- round(position_shares[, share_col], 4)
  }
  x$position <- position_labels_from_share_matrix(position_shares, x$position)
  x$position <- ifelse(is.na(x$position) | x$position == "", "UNK", x$position)
  x$position_entropy <- ifelse(is.finite(x$position_entropy), x$position_entropy, position_entropy_from_shares(position_shares))
  x$position_index <- ifelse(is.finite(x$position_index), x$position_index, position_index_from_shares(position_shares))
  x$position_entropy <- round(x$position_entropy, 4)
  x$position_index <- round(x$position_index, 4)
  x$age <- suppressWarnings(as.numeric(x$age))
  x$draft_year <- suppressWarnings(as.numeric(x$draft_year))
  x$overall_pick <- suppressWarnings(as.numeric(x$overall_pick))
  x$yoe <- ifelse(!is.na(x$draft_year), pmax(0, x$year - x$draft_year), NA_real_)
  x$games <- suppressWarnings(as.numeric(x$games))
  x$Minutes <- suppressWarnings(as.numeric(x$Minutes))
  if ("stat_minutes" %in% names(x)) {
    x$Minutes <- coalesce_numeric(x$Minutes, x$stat_minutes)
  }
  if ("stat_mpg" %in% names(x) && "p_mpg" %in% names(x)) {
    x$p_mpg <- coalesce_numeric(x$p_mpg, x$stat_mpg)
  }
  x$availability_status <- "qualified"
  x$availability_reason <- ""
  x$skill_source <- "current"
  x$skill_source_year <- x$year
  contract_year <- max(x$year, na.rm = TRUE)
  x$total <- ifelse(!is.na(x$FINAL_TOTAL), x$FINAL_TOTAL, ifelse(!is.na(x$TOTAL), x$TOTAL, x$off_dep + x$def_dep))
  x$offense <- ifelse(!is.na(x$FINAL_OFF), x$FINAL_OFF, ifelse(!is.na(x$OFF), x$OFF, x$off_dep))
  x$defense <- ifelse(!is.na(x$FINAL_DEF), x$FINAL_DEF, ifelse(!is.na(x$DEF), x$DEF, x$def_dep))
  hide_zero_minute_low_impact <- x$year == contract_year &
    is.finite(x$Minutes) &
    x$Minutes <= 0 &
    is.finite(x$total) &
    x$total < -2.5
  if (any(hide_zero_minute_low_impact, na.rm = TRUE)) {
    x <- x[!hide_zero_minute_low_impact, , drop = FALSE]
  }
  dnq_min_minutes <- suppressWarnings(as.numeric(Sys.getenv("IMPACT_DNQ_MIN_MINUTES", unset = "500")))
  if (!is.finite(dnq_min_minutes) || dnq_min_minutes < 0) dnq_min_minutes <- 500
  current_low_minutes <- x$year == contract_year &
    is.finite(x$Minutes) &
    x$Minutes < dnq_min_minutes
  x$availability_status[current_low_minutes] <- "DNQ"
  x$availability_reason[current_low_minutes] <- paste0("Below ", round(dnq_min_minutes, 0), "-minute score threshold")
  x$skill_model_off <- x$OFF
  x$skill_model_def <- x$DEF
  x$skill_off_total <- x$skill_model_off
  x$skill_def_total <- x$skill_model_def
  year_contract <- if ("contract_year_contract" %in% names(x)) suppressWarnings(as.numeric(x$contract_year_contract)) else rep(NA_real_, nrow(x))
  year_status <- if ("contract_year_status" %in% names(x)) as.character(x$contract_year_status) else rep(NA_character_, nrow(x))
  year_team <- if ("contract_year_team" %in% names(x)) as.character(x$contract_year_team) else rep(NA_character_, nrow(x))
  has_year_contract <- is.finite(year_contract) & year_contract > 0
  x$contract <- ifelse(has_year_contract, year_contract, ifelse(x$year == contract_year, x$contract, NA_real_))
  x$contract_status <- ifelse(!is.na(year_status) & nzchar(trimws(year_status)), year_status, x$contract_status)
  x$team <- ifelse(has_year_contract & !is.na(year_team) & nzchar(trimws(year_team)) & x$year == contract_year, year_team, x$team)
  contract_status_fallback <- ifelse(has_year_contract, year_status, x$contract_status)
  x$contract_status <- contract_status_from_salary(
    x$contract,
    x$yoe,
    x$age,
    x$team,
    contract_status_fallback,
    x$year,
    x$draft_year,
    x$overall_pick
  )
  x$incumbent_team <- normalize_team(x$team)
  x$market_team <- ifelse(is_blank_text(x$team), "FA", normalize_team(x$team))
  x$team_projection_base <- x$market_team
  x$projection_roster_status <- projection_roster_status(x$contract_status, x$contract)
  x <- append_latest_contract_inactive_rows(x, contract_reference, contract_year)
  x <- carry_forward_dnq_profiles(x, contract_year)
  x <- apply_current_roster_truth(x, base_dir, contract_year)

  x <- x[order(x$year, -x$total, x$player_name), ]
  x$replacement_total <- replacement_from_data(x, "total")
  x$timin <- round((x$total - x$replacement_total) * pmax(0, x$Minutes), 1)
  x$score <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    timin_pct <- percent_rank(x$timin[idx])
    total_pct <- percent_rank(x$total[idx])
    out <- 100 * (0.35 * timin_pct + 0.65 * total_pct)
    out[is.na(x$Minutes[idx]) | x$Minutes[idx] <= 0] <- -10
    round(out, 1)
  })
  current_dnq <- x$year == contract_year & x$availability_status == "DNQ"
  x$score[current_dnq] <- -10
  prev_score <- x$score[match(paste(x$nba_id, x$year - 1), paste(x$nba_id, x$year))]
  x$score_delta <- round(x$score - prev_score, 1)
  x$score_delta[current_dnq] <- NA_real_
  x$score_label <- ifelse(current_dnq, "DNQ", format(round(x$score, 1), trim = TRUE, nsmall = 1))
  x$tier <- unlist(ave(x$score, x$year, FUN = tier_from_score))
  x$tier[current_dnq] <- "DNQ"
  x$value <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    league_timin <- sum(x$timin[idx], na.rm = TRUE)
    cap_proxy <- cap_for_year(cap_assumptions, x$year[idx][1], "scale_cap")
    if (is.na(league_timin) || league_timin <= 0) {
      return(rep(NA_real_, length(idx)))
    }
    round(x$timin[idx] * cap_proxy * 30 / league_timin, 0)
  })
  x$season_value <- x$value
  x$trade_value <- NA_real_
  x$fa_value <- NA_real_
  x$value_add <- NA_real_

  for (skill_name in c("SHOOT", "PASS", "SWITCH", "DPM")) {
    x[[paste0(skill_name, "_pct")]] <- ave(x[[skill_name]], x$year, FUN = function(v) percent_rank(v) * 100)
  }
  x$scalability <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    league_timin <- sum(x$timin[idx], na.rm = TRUE)
    cap <- cap_for_year(cap_assumptions, x$year[idx][1], "scale_cap")
    if (is.na(league_timin) || league_timin <= 0) {
      return(rep(NA_real_, length(idx)))
    }
    value <- x$timin[idx] * cap * 30 / league_timin
    minutes_capacity <- pmin(ifelse(x$Minutes[idx] > 0, 48 * 82 * 5 / x$Minutes[idx], 15), 15)
    contract_capacity <- ifelse(!is.na(x$contract[idx]) & x$contract[idx] > 0, pmin(cap / x$contract[idx], 15), 15)
    round(pmax(0, pmin(minutes_capacity, contract_capacity) * value / cap), 3)
  })

  x$projection_y1 <- round(x$total * 0.94, 2)
  x$projection_y2 <- round(x$total * 0.88, 2)
  x$projection_y3 <- round(x$total * 0.82, 2)
  x$projection_y4 <- round(x$total * 0.76, 2)
  x$projection_y5 <- round(x$total * 0.70, 2)
  for (horizon in 1:5) {
    x[[paste0("projection_games_y", horizon)]] <- NA_real_
    x[[paste0("projection_mpg_y", horizon)]] <- NA_real_
    x[[paste0("projection_minutes_y", horizon)]] <- NA_real_
    x[[paste0("projection_timin_y", horizon)]] <- NA_real_
    x[[paste0("projection_value_y", horizon)]] <- NA_real_
    x[[paste0("projection_fa_value_y", horizon)]] <- NA_real_
    x[[paste0("projection_scalability_y", horizon)]] <- NA_real_
    x[[paste0("projection_offense_y", horizon)]] <- NA_real_
    x[[paste0("projection_defense_y", horizon)]] <- NA_real_
    x[[paste0("projection_skill_model_off_y", horizon)]] <- NA_real_
    x[[paste0("projection_skill_model_def_y", horizon)]] <- NA_real_
    for (skill_name in impact_skill_names()) {
      x[[paste0("projection_", skill_name, "_y", horizon)]] <- NA_real_
    }
    contract_col <- paste0("contract_y", horizon)
    x[[paste0("projection_contract_y", horizon)]] <- if (contract_col %in% names(x)) suppressWarnings(as.numeric(x[[contract_col]])) else NA_real_
    x[[paste0("projection_contract_y", horizon)]] <- ifelse(
      x$year == contract_year,
      x[[paste0("projection_contract_y", horizon)]],
      NA_real_
    )
    status_col <- paste0("contract_status_y", horizon)
    x[[paste0("projection_contract_status_y", horizon)]] <- if (status_col %in% names(x)) as.character(x[[status_col]]) else NA_character_
    x[[paste0("projection_contract_status_y", horizon)]] <- ifelse(
      x$year == contract_year,
      x[[paste0("projection_contract_status_y", horizon)]],
      NA_character_
    )
    x[[paste0("projection_cap_y", horizon)]] <- cap_for_year(cap_assumptions, x$year + horizon, "scale_cap")
  }

  projection_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "player_career_projections.csv")
  if (file.exists(projection_path)) {
    projections <- read.csv(projection_path, stringsAsFactors = FALSE, check.names = FALSE)
    needed <- c("nba_id", "base_year", "horizon", "projected_games", "projected_mpg", "projected_minutes", "projected_total")
    if (all(needed %in% names(projections))) {
      projections$key <- paste(projections$nba_id, projections$base_year)
      x$key <- paste(x$nba_id, x$year)
      for (horizon in 1:5) {
        ph <- projections[projections$horizon == horizon, ]
        row_match <- match(x$key, ph$key)
        has_projection <- !is.na(row_match)
        x[[paste0("projection_y", horizon)]][has_projection] <- round(ph$projected_total[row_match[has_projection]], 2)
        x[[paste0("projection_games_y", horizon)]][has_projection] <- round(ph$projected_games[row_match[has_projection]], 1)
        x[[paste0("projection_mpg_y", horizon)]][has_projection] <- round(ph$projected_mpg[row_match[has_projection]], 1)
        x[[paste0("projection_minutes_y", horizon)]][has_projection] <- round(ph$projected_minutes[row_match[has_projection]], 0)
        if ("projected_offense" %in% names(ph)) {
          x[[paste0("projection_offense_y", horizon)]][has_projection] <- round(ph$projected_offense[row_match[has_projection]], 2)
        }
        if ("projected_defense" %in% names(ph)) {
          x[[paste0("projection_defense_y", horizon)]][has_projection] <- round(ph$projected_defense[row_match[has_projection]], 2)
        }
        if ("projected_skill_model_off" %in% names(ph)) {
          x[[paste0("projection_skill_model_off_y", horizon)]][has_projection] <- round(ph$projected_skill_model_off[row_match[has_projection]], 3)
        }
        if ("projected_skill_model_def" %in% names(ph)) {
          x[[paste0("projection_skill_model_def_y", horizon)]][has_projection] <- round(ph$projected_skill_model_def[row_match[has_projection]], 3)
        }
        for (skill_name in impact_skill_names()) {
          projected_col <- projection_skill_col(skill_name)
          if (projected_col %in% names(ph)) {
            x[[paste0("projection_", skill_name, "_y", horizon)]][has_projection] <- round(ph[[projected_col]][row_match[has_projection]], 2)
          }
        }
        projected_timin <- (ph$projected_total[row_match[has_projection]] - x$replacement_total[has_projection]) *
          pmax(0, ph$projected_minutes[row_match[has_projection]])
        base_year <- x$year[has_projection]
        future_year <- base_year + horizon
        future_cap <- cap_for_year(cap_assumptions, future_year, "scale_cap")
        league_timin <- vapply(base_year, function(year) sum(x$timin[x$year == year], na.rm = TRUE), numeric(1))
        dollar_per_timin <- ifelse(is.finite(league_timin) & league_timin > 0, future_cap * 30 / league_timin, NA_real_)
        projected_value <- projected_timin * dollar_per_timin
        projected_contract <- suppressWarnings(as.numeric(x[[paste0("contract_y", horizon)]][has_projection]))
        projected_contract[is.na(projected_contract)] <- NA_real_
        minutes_capacity <- pmin(ifelse(ph$projected_minutes[row_match[has_projection]] > 0, 48 * 82 * 5 / ph$projected_minutes[row_match[has_projection]], 15), 15)
        contract_capacity <- ifelse(!is.na(projected_contract) & projected_contract > 0, pmin(future_cap / projected_contract, 15), 15)

        x[[paste0("projection_timin_y", horizon)]][has_projection] <- round(projected_timin, 1)
        x[[paste0("projection_value_y", horizon)]][has_projection] <- round(projected_value, 0)
        x[[paste0("projection_scalability_y", horizon)]][has_projection] <- round(pmax(0, pmin(minutes_capacity, contract_capacity) * projected_value / future_cap), 3)
      }
      x$key <- NULL
    }
  }
  x <- prune_low_impact_ufas(x, "projection_y1")
  current_dnq <- x$year == contract_year & x$availability_status == "DNQ"

  current_games <- ifelse(!is.na(x$p_mpg) & x$p_mpg > 0, x$Minutes / x$p_mpg, NA_real_)
  x$raw_minutes <- live_minutes_estimate(
    minutes = x$Minutes,
    games = current_games,
    mpg = x$p_mpg,
    projection_minutes = x$projection_minutes_y1
  )
  x$raw_timin <- round((x$total - x$replacement_total) * pmax(0, x$raw_minutes), 1)
  x$value <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    league_timin <- sum(x$timin[idx], na.rm = TRUE)
    cap_proxy <- cap_for_year(cap_assumptions, x$year[idx][1], "scale_cap")
    if (is.na(league_timin) || league_timin <= 0) {
      return(rep(NA_real_, length(idx)))
    }
    round(x$raw_timin[idx] * cap_proxy * 30 / league_timin, 0)
  })
  x$value_add <- ifelse(!is.na(x$contract), round(x$season_value - x$contract, 0), NA_real_)
  x$season_value[current_dnq] <- NA_real_
  x$value_add[current_dnq] <- NA_real_
  x$trade_value <- round(x$value * (0.45 + x$score / 170), 0)

  fa_market <- calc_fa_market_values(x, cap_assumptions, horizon = 1)
  x$fa_value <- fa_market$fa_value
  x$fa_raw_value <- fa_market$fa_raw_value
  x$fa_uncapped_value <- fa_market$fa_uncapped_value
  x$fa_min_salary <- fa_market$fa_min_salary
  x$fa_max_salary <- fa_market$fa_max_salary
  x$fa_market_adjustment <- fa_market$fa_market_adjustment
  x$fa_projected_timin <- fa_market$fa_projected_timin
  x$fa_missing_roster_slots <- fa_market$fa_missing_roster_slots
  x$fa_is_max <- fa_market$fa_is_max
  x$fa_max_tier <- fa_market$fa_max_tier
  for (horizon in 1:5) {
    projection_fa <- calc_fa_market_values(x, cap_assumptions, horizon = horizon)
    x[[paste0("projection_fa_value_y", horizon)]] <- projection_fa$fa_value
  }
  contract_scale_model <- fit_value_contract_scale_model(x, cap_assumptions)
  x <- recalculate_projection_scalability(x, cap_assumptions, contract_scale_model = contract_scale_model)
  x <- enforce_roster_truth_placements(x, contract_year)

  x$lineup_original_minutes <- x$Minutes
  x$lineup_adjusted_minutes <- x$Minutes
  x$lineup_role <- NA_character_
  x$lineup_role_order <- NA_integer_
  x$lineup_role_band_minutes <- NA_real_

  projected_2027 <- build_projected_2027_rows(x, base_dir, cap_assumptions, contract_year, contract_scale_model)
  if (nrow(projected_2027) > 0) {
    x <- rbind(x, projected_2027[, names(x), drop = FALSE])
  }

  x <- enforce_roster_truth_placements(x, contract_year)

  x$source_note <- "Impact uses 40% EPM, 40% DPM, and 20% skill model output. Skill dimensions use a current-season-first 4,000-minute stabilized window with 0.75 per-season prior decay, light draft priors for first-year players, and low-sample shrinkage. Position is built from Basketball-Reference play-by-play position-share estimates when available, and replacement is a trailing 3-year fractional position-share cutoff at the 65th rotation-useful player per position-season. Raw value live-casts current impact over blended expected minutes; Szn VA is season-produced value above available salary; FA value uses projected TIMIN, salary floors, max caps, market redistribution, and unmodeled roster reserves. Future scale uses known future contracts when available and otherwise estimates contract from a smoothed value-to-contract curve, with max salary only when projected value is at least the player's legal max."

  cols <- c(
    "nba_id", "player_name", "year", "team", "current_roster_team", "roster_truth_team", "rights_team", "roster_state", "roster_status_source", "roster_truth_pulled_at",
    "incumbent_team", "market_team", "team_projection_base",
    "projection_roster_status", "position", "pg_share", "sg_share", "sf_share", "pf_share", "c_share",
    "position_index", "position_entropy", "age", "yoe", "games", "Minutes", "p_mpg", "p_usg",
    "o_epm", "o_dpm", "d_epm", "d_dpm", "off_dep", "def_dep", "offense", "defense",
    "total", "replacement_total", "score", "score_label", "score_delta", "tier", "availability_status", "availability_reason",
    "skill_source", "skill_source_year", "timin", "season_value", "raw_minutes", "raw_timin",
    "value", "contract", "contract_status", "value_add", "trade_value",
    "fa_value", "fa_raw_value", "fa_uncapped_value", "fa_min_salary", "fa_max_salary",
    "fa_market_adjustment", "fa_projected_timin", "fa_missing_roster_slots", "fa_is_max",
    "fa_max_tier", "scalability", "skill_model_off", "skill_model_def", "skill_off_total", "skill_def_total",
    "FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB",
    "RIMPRO", "SWITCH", "FINAL_OFF", "FINAL_DEF", "FINAL_TOTAL",
    "projection_y1", "projection_y2", "projection_y3", "projection_y4", "projection_y5",
    "projection_games_y1", "projection_games_y2", "projection_games_y3", "projection_games_y4", "projection_games_y5",
    "projection_mpg_y1", "projection_mpg_y2", "projection_mpg_y3", "projection_mpg_y4", "projection_mpg_y5",
    "projection_minutes_y1", "projection_minutes_y2", "projection_minutes_y3", "projection_minutes_y4", "projection_minutes_y5",
    "projection_offense_y1", "projection_offense_y2", "projection_offense_y3", "projection_offense_y4", "projection_offense_y5",
    "projection_defense_y1", "projection_defense_y2", "projection_defense_y3", "projection_defense_y4", "projection_defense_y5",
    "projection_skill_model_off_y1", "projection_skill_model_off_y2", "projection_skill_model_off_y3", "projection_skill_model_off_y4", "projection_skill_model_off_y5",
    "projection_skill_model_def_y1", "projection_skill_model_def_y2", "projection_skill_model_def_y3", "projection_skill_model_def_y4", "projection_skill_model_def_y5",
    "projection_timin_y1", "projection_timin_y2", "projection_timin_y3", "projection_timin_y4", "projection_timin_y5",
    "projection_value_y1", "projection_value_y2", "projection_value_y3", "projection_value_y4", "projection_value_y5",
    "projection_fa_value_y1", "projection_fa_value_y2", "projection_fa_value_y3", "projection_fa_value_y4", "projection_fa_value_y5",
    "projection_scalability_y1", "projection_scalability_y2", "projection_scalability_y3", "projection_scalability_y4", "projection_scalability_y5",
    "projection_contract_y1", "projection_contract_y2", "projection_contract_y3", "projection_contract_y4", "projection_contract_y5",
    "projection_effective_contract_y1", "projection_effective_contract_y2", "projection_effective_contract_y3", "projection_effective_contract_y4", "projection_effective_contract_y5",
    "projection_contract_source_y1", "projection_contract_source_y2", "projection_contract_source_y3", "projection_contract_source_y4", "projection_contract_source_y5",
    "projection_cap_y1", "projection_cap_y2", "projection_cap_y3", "projection_cap_y4", "projection_cap_y5",
    "lineup_original_minutes", "lineup_adjusted_minutes", "lineup_role", "lineup_role_order", "lineup_role_band_minutes",
    "source_note"
  )
  cols <- intersect(cols, names(x))
  x[, cols, drop = FALSE]
}

team_projection_scenarios <- function() {
  data.frame(
    scenario_id = c("base", "guaranteed", "open_market"),
    scenario_label = c("Base Case", "Guaranteed Only", "Open Market"),
    stringsAsFactors = FALSE
  )
}

TEAM_PROJECTION_PLAYER_LIMIT <- 10L

team_projection_minutes_rank <- function(players) {
  projected <- if ("projection_minutes_y1" %in% names(players)) {
    suppressWarnings(as.numeric(players$projection_minutes_y1))
  } else {
    rep(NA_real_, nrow(players))
  }
  adjusted <- if ("lineup_adjusted_minutes" %in% names(players)) {
    suppressWarnings(as.numeric(players$lineup_adjusted_minutes))
  } else {
    rep(NA_real_, nrow(players))
  }
  actual <- if ("Minutes" %in% names(players)) {
    suppressWarnings(as.numeric(players$Minutes))
  } else {
    rep(NA_real_, nrow(players))
  }
  minutes <- coalesce_numeric(projected, coalesce_numeric(adjusted, actual))
  minutes[!is.finite(minutes)] <- 0
  minutes
}

limit_team_projection_players <- function(players, limit = TEAM_PROJECTION_PLAYER_LIMIT) {
  if (!nrow(players) || nrow(players) <= limit) return(players)
  minutes <- team_projection_minutes_rank(players)
  order_idx <- order(-minutes, players$player_name, players$nba_id, na.last = TRUE)
  players[order_idx[seq_len(limit)], , drop = FALSE]
}

assign_team_projection_scenario <- function(players, scenario_id) {
  assigned <- players
  projected_year <- max(suppressWarnings(as.numeric(assigned$year)), na.rm = TRUE)
  is_projected <- assigned$year == projected_year &
    assigned$availability_status %in% c("projected", "rookie_projection")
  roster_status <- if ("projection_roster_status" %in% names(assigned)) {
    as.character(assigned$projection_roster_status)
  } else {
    projection_roster_status(assigned$contract_status, assigned$contract)
  }
  incumbent <- if ("incumbent_team" %in% names(assigned)) normalize_team(assigned$incumbent_team) else normalize_team(assigned$team)
  market <- if ("market_team" %in% names(assigned)) normalize_team(assigned$market_team) else normalize_team(assigned$team)
  base <- if ("team_projection_base" %in% names(assigned)) normalize_team(assigned$team_projection_base) else normalize_team(assigned$team)
  base[is_blank_text(base)] <- "FA"
  market[is_blank_text(market)] <- "FA"
  incumbent[is_blank_text(incumbent)] <- "FA"

  scenario_team <- normalize_team(assigned$team)
  scenario_team[is_blank_text(scenario_team)] <- "FA"
  if (scenario_id == "base") {
    scenario_team[is_projected] <- base[is_projected]
  } else if (scenario_id == "guaranteed") {
    controlled <- roster_status[is_projected] %in% c("signed", "rookie_fa")
    scenario_team[is_projected] <- ifelse(controlled, incumbent[is_projected], "FA")
  } else if (scenario_id == "open_market") {
    scenario_team[is_projected] <- market[is_projected]
  }
  assigned$team <- scenario_team
  assigned$team_projection_scenario <- scenario_id
  assigned
}

build_team_projections_for_scenario <- function(players, scenario_id, scenario_label) {
  players <- assign_team_projection_scenario(players, scenario_id)
  players <- players[players$team != "FA" & !is.na(players$team), ]
  if (!nrow(players)) {
    return(data.frame())
  }
  players$team <- normalize_team(players$team)
  skill_names <- impact_skill_names()
  meta <- team_metadata()
  split_key <- paste(players$year, players$team, sep = "||")
  grouped <- split(players, split_key)
  out <- do.call(rbind, lapply(grouped, function(df) {
    df <- limit_team_projection_players(df)
    minutes <- sum(suppressWarnings(as.numeric(df$Minutes)), na.rm = TRUE)
    weighted <- function(v) {
      v <- suppressWarnings(as.numeric(v))
      if (minutes > 0) {
        sum(v * suppressWarnings(as.numeric(df$Minutes)) / minutes, na.rm = TRUE)
      } else {
        mean(v, na.rm = TRUE)
      }
    }
    row <- data.frame(
      scenario_id = scenario_id,
      scenario_label = scenario_label,
      year = df$year[1],
      team = df$team[1],
      team_abbr = df$team[1],
      conference = team_conference(df$team[1]),
      roster_count = nrow(df),
      minutes = round(minutes, 1),
      raw_offense = round(weighted(df$offense) * 5, 2),
      raw_defense = round(weighted(df$defense) * 5, 2),
      raw_total = round(weighted(df$total) * 5, 2),
      stringsAsFactors = FALSE
    )
    for (skill_name in skill_names) {
      row[[skill_name]] <- if (skill_name %in% names(df)) round(weighted(df[[skill_name]]), 2) else NA_real_
    }
    row
  }))
  out <- merge(out, meta, by = c("team_abbr", "conference"), all.x = TRUE, sort = FALSE)
  out$team_name <- coalesce_col(out$team_name, out$team)
  out$team_logo_url <- team_logo_url(out$nba_team_id)
  out$raw_offense <- round(out$raw_offense - ave(out$raw_offense, out$year, FUN = function(v) mean(v, na.rm = TRUE)), 2)
  out$raw_defense <- round(out$raw_defense - ave(out$raw_defense, out$year, FUN = function(v) mean(v, na.rm = TRUE)), 2)
  out$raw_total <- round(out$raw_offense + out$raw_defense, 2)
  out$minutes_coverage <- round(clamp(out$minutes / 19680, 0, 1), 3)
  out$missing_minute_offense <- ave(out$raw_offense, out$year, FUN = function(v) {
    fill <- suppressWarnings(as.numeric(stats::quantile(v, probs = 0.2, na.rm = TRUE, names = FALSE)))
    ifelse(is.finite(fill), pmin(0, fill), 0)
  })
  out$missing_minute_defense <- ave(out$raw_defense, out$year, FUN = function(v) {
    fill <- suppressWarnings(as.numeric(stats::quantile(v, probs = 0.2, na.rm = TRUE, names = FALSE)))
    ifelse(is.finite(fill), pmin(0, fill), 0)
  })
  out$offense <- ifelse(
    out$minutes >= 19680,
    out$raw_offense,
    out$raw_offense * out$minutes_coverage + out$missing_minute_offense * (1 - out$minutes_coverage)
  )
  out$defense <- ifelse(
    out$minutes >= 19680,
    out$raw_defense,
    out$raw_defense * out$minutes_coverage + out$missing_minute_defense * (1 - out$minutes_coverage)
  )
  out$offense <- out$offense - ave(out$offense, out$year, FUN = function(v) mean(v, na.rm = TRUE))
  out$defense <- out$defense - ave(out$defense, out$year, FUN = function(v) mean(v, na.rm = TRUE))
  out$total <- out$offense + out$defense
  out$adjusted_total <- out$total
  out$offense <- ave(out$offense, out$year, FUN = zero_sum_round)
  out$defense <- ave(out$defense, out$year, FUN = zero_sum_round)
  out$total <- round(out$offense + out$defense, 2)
  out$adjusted_total <- out$total
  out$win_units <- out$adjusted_total
  out$centered_units <- ave(out$win_units, out$year, FUN = function(v) v - mean(v, na.rm = TRUE))
  out$projected_wins <- round(clamp(41 + out$centered_units * 2.8, 12, 70), 1)
  out$projected_losses <- round(82 - out$projected_wins, 1)
  out$win_pct <- round(out$projected_wins / 82, 3)
  out$expected_wins <- out$projected_wins
  out$expected_losses <- out$projected_losses
  out$league_rank <- ave(-out$projected_wins, out$year, FUN = function(v) rank(v, ties.method = "first"))
  out$rank <- out$league_rank
  out$conference_rank <- ave(-out$projected_wins, paste(out$year, out$conference), FUN = function(v) rank(v, ties.method = "first"))
  out$playoff_status <- ifelse(out$conference_rank <= 6, "Playoff", ifelse(out$conference_rank <= 10, "Play-In", "Lottery"))
  out <- out[order(out$year, out$league_rank), ]
  keep <- c(
    "scenario_id", "scenario_label", "year", "team", "team_name", "team_abbr", "team_logo_url", "conference", "roster_count",
    "minutes", "minutes_coverage", "raw_offense", "raw_defense", "raw_total", "adjusted_total",
    "offense", "defense", "total", "win_units", "projected_wins", "projected_losses", "win_pct",
    "expected_wins", "expected_losses", "league_rank", "rank", "conference_rank", "playoff_status",
    skill_names
  )
  out[, keep, drop = FALSE]
}

build_team_projections <- function(players) {
  scenarios <- team_projection_scenarios()
  out <- do.call(rbind, lapply(seq_len(nrow(scenarios)), function(i) {
    build_team_projections_for_scenario(players, scenarios$scenario_id[i], scenarios$scenario_label[i])
  }))
  row.names(out) <- NULL
  out
}

build_team_lineups_for_scenario <- function(players, scenario_id, scenario_label) {
  empty <- function() {
    data.frame(
      scenario_id = character(),
      scenario_label = character(),
      year = integer(),
      team = character(),
      team_name = character(),
      team_abbr = character(),
      team_logo_url = character(),
      conference = character(),
      role_order = integer(),
      role_label = character(),
      role_type = character(),
      position_group = character(),
      role_band_minutes = numeric(),
      lineup_rank = integer(),
      is_starter = logical(),
      nba_id = integer(),
      player_name = character(),
      position = character(),
      original_minutes = numeric(),
      adjusted_minutes = numeric(),
      minutes_delta = numeric(),
      games = numeric(),
      mpg = numeric(),
      offense = numeric(),
      defense = numeric(),
      total = numeric(),
      score = numeric(),
      tier = character(),
      role_score = numeric(),
      contract_status = character(),
      stringsAsFactors = FALSE
    )
  }
  if (!nrow(players)) {
    return(empty())
  }

  players <- assign_team_projection_scenario(players, scenario_id)
  x <- players[players$team != "FA" & !is.na(players$team), , drop = FALSE]
  if (!nrow(x)) return(empty())
  x$team <- normalize_team(x$team)
  x$.lineup_row_id <- seq_len(nrow(x))
  lineup_cols <- c(
    "year", "team", "nba_id", "player_name", "position",
    "lineup_original_minutes", "lineup_adjusted_minutes", "Minutes", "games", "p_mpg",
    "offense", "defense", "total", "score", "tier", "contract_status", ".lineup_row_id"
  )
  x <- x[, intersect(lineup_cols, names(x)), drop = FALSE]
  grouped <- split(x, paste(x$year, x$team, sep = "||"))
  out <- do.call(rbind, lapply(grouped, estimate_team_lineup_rows))
  if (is.null(out) || !nrow(out)) return(empty())

  out$scenario_id <- scenario_id
  out$scenario_label <- scenario_label
  meta <- team_metadata()
  out$team_abbr <- out$team
  out$conference <- team_conference(out$team)
  out <- merge(out, meta, by = c("team_abbr", "conference"), all.x = TRUE, sort = FALSE)
  out$team_name <- coalesce_col(out$team_name, out$team)
  out$team_logo_url <- team_logo_url(out$nba_team_id)
  original_minutes <- if ("lineup_original_minutes" %in% names(out)) suppressWarnings(as.numeric(out$lineup_original_minutes)) else suppressWarnings(as.numeric(out$Minutes))
  adjusted_minutes <- if ("lineup_adjusted_minutes" %in% names(out)) suppressWarnings(as.numeric(out$lineup_adjusted_minutes)) else suppressWarnings(as.numeric(out$Minutes))
  out$original_minutes <- round(original_minutes, 0)
  out$adjusted_minutes <- round(adjusted_minutes, 0)
  out$minutes_delta <- round(out$adjusted_minutes - out$original_minutes, 0)
  out$mpg <- suppressWarnings(as.numeric(out$p_mpg))

  keep <- c(
    "scenario_id", "scenario_label", "year", "team", "team_name", "team_abbr", "team_logo_url", "conference",
    "role_order", "role_label", "role_type", "position_group", "role_band_minutes",
    "lineup_rank", "is_starter", "nba_id", "player_name", "position",
    "original_minutes", "adjusted_minutes", "minutes_delta", "games", "mpg",
    "offense", "defense", "total", "score", "tier", "role_score", "contract_status"
  )
  out <- out[order(out$year, out$team, out$role_order), intersect(keep, names(out)), drop = FALSE]
  row.names(out) <- NULL
  out
}

build_team_lineups <- function(players) {
  scenarios <- team_projection_scenarios()
  out <- do.call(rbind, lapply(seq_len(nrow(scenarios)), function(i) {
    build_team_lineups_for_scenario(players, scenarios$scenario_id[i], scenarios$scenario_label[i])
  }))
  row.names(out) <- NULL
  out
}

bref_schedule_empty <- function() {
  data.frame(
    season = integer(),
    season_type = character(),
    date = character(),
    time = character(),
    home_team = character(),
    away_team = character(),
    home_score = numeric(),
    away_score = numeric(),
    home_win_probability = numeric(),
    away_win_probability = numeric(),
    result = character(),
    arena = character(),
    notes = character(),
    is_completed = logical(),
    stringsAsFactors = FALSE
  )
}

download_bref_html <- function(url) {
  cache_dir <- getOption("bref_schedule_cache_dir", NULL)
  cache_path <- NULL
  if (!is.null(cache_dir)) {
    dir.create(cache_dir, recursive = TRUE, showWarnings = FALSE)
    cache_key <- paste0(gsub("[^A-Za-z0-9]+", "_", url), ".html")
    cache_path <- file.path(cache_dir, cache_key)
    if (file.exists(cache_path) && file.info(cache_path)$size > 0) {
      return(tryCatch(xml2::read_html(cache_path), error = function(e) NULL))
    }
  }
  tmp <- tempfile(fileext = ".html")
  on.exit(unlink(tmp), add = TRUE)
  ok <- tryCatch({
    utils::download.file(
      url,
      tmp,
      quiet = TRUE,
      mode = "wb",
      method = "libcurl",
      headers = c("User-Agent" = "Mozilla/5.0")
    )
    TRUE
  }, error = function(e) FALSE, warning = function(w) FALSE)
  if (!ok || !file.exists(tmp) || file.info(tmp)$size == 0) return(NULL)
  if (!is.null(cache_path)) {
    file.copy(tmp, cache_path, overwrite = TRUE)
  }
  tryCatch(xml2::read_html(tmp), error = function(e) NULL)
}

parse_bref_schedule_doc <- function(season, season_type, doc) {
  rows <- rvest::html_elements(doc, "table#schedule tbody tr")
  if (!length(rows)) return(bref_schedule_empty())
  text_at <- function(row, stat) {
    node <- rvest::html_element(row, paste0("[data-stat='", stat, "']"))
    if (length(node) == 0 || is.na(node)) return(NA_character_)
    trimws(rvest::html_text2(node))
  }
  out <- do.call(rbind, lapply(rows, function(row) {
    if (length(rvest::html_element(row, "[data-stat='date_game']")) == 0) return(NULL)
    date_text <- text_at(row, "date_game")
    if (is.na(date_text) || date_text == "") return(NULL)
    away_score <- suppressWarnings(as.numeric(text_at(row, "visitor_pts")))
    home_score <- suppressWarnings(as.numeric(text_at(row, "home_pts")))
    data.frame(
      season = season,
      season_type = season_type,
      date = as.character(suppressWarnings(as.Date(date_text, format = "%a, %b %d, %Y"))),
      time = text_at(row, "game_start_time"),
      home_team = team_abbr_from_name(text_at(row, "home_team_name")),
      away_team = team_abbr_from_name(text_at(row, "visitor_team_name")),
      home_score = home_score,
      away_score = away_score,
      arena = text_at(row, "arena_name"),
      notes = text_at(row, "game_remarks"),
      is_completed = is.finite(home_score) & is.finite(away_score),
      stringsAsFactors = FALSE
    )
  }))
  if (is.null(out) || !nrow(out)) return(bref_schedule_empty())
  out$result <- ifelse(
    out$is_completed,
    ifelse(out$home_score > out$away_score, out$home_team, out$away_team),
    NA_character_
  )
  out$home_win_probability <- NA_real_
  out$away_win_probability <- NA_real_
  out
}

parse_bref_schedule <- function(season, season_type, url) {
  doc <- download_bref_html(url)
  if (is.null(doc)) return(bref_schedule_empty())
  docs <- list(doc)
  if (season_type == "Regular Season") {
    hrefs <- rvest::html_attr(rvest::html_elements(doc, "div.filter a"), "href")
    hrefs <- hrefs[!is.na(hrefs) & grepl(sprintf("/leagues/NBA_%s_games-", season), hrefs)]
    if (length(hrefs)) {
      urls <- unique(paste0("https://www.basketball-reference.com", hrefs))
      month_docs <- lapply(urls, download_bref_html)
      month_docs <- month_docs[!vapply(month_docs, is.null, logical(1))]
      if (length(month_docs)) docs <- month_docs
    }
  }
  out <- do.call(rbind, lapply(docs, function(item) parse_bref_schedule_doc(season, season_type, item)))
  if (is.null(out) || !nrow(out)) return(bref_schedule_empty())
  out <- out[!duplicated(paste(out$season, out$season_type, out$date, out$home_team, out$away_team)), ]
  out[order(out$date, out$time, out$home_team), ]
}

classify_extra_regular_games <- function(schedules) {
  if (!nrow(schedules)) return(schedules)
  for (season in sort(unique(schedules$season))) {
    idx <- which(schedules$season == season & schedules$season_type == "Regular Season")
    if (!length(idx)) next
    idx <- idx[order(schedules$date[idx], schedules$time[idx], schedules$home_team[idx])]
    counts <- setNames(rep(0L, length(team_metadata()$team_abbr)), team_metadata()$team_abbr)
    for (row_idx in idx) {
      home <- schedules$home_team[row_idx]
      away <- schedules$away_team[row_idx]
      is_extra <- (!is.na(counts[home]) && counts[home] >= 82L) || (!is.na(counts[away]) && counts[away] >= 82L)
      if (is_extra || grepl("play-in|cup final", schedules$notes[row_idx], ignore.case = TRUE)) {
        schedules$season_type[row_idx] <- "Play-In"
      } else {
        counts[home] <- counts[home] + 1L
        counts[away] <- counts[away] + 1L
      }
    }
  }
  schedules
}

build_team_schedules <- function(teams) {
  schedule_dir <- file.path(resolve_base_dir(), "processed", "livedata", "schedules")
  options(bref_schedule_cache_dir = file.path(schedule_dir, "bref_html"))
  schedule_cache <- file.path(schedule_dir, "bref_team_schedules.csv")
  seasons <- sort(unique(teams$year[is.finite(teams$year) & teams$year <= 2026]))
  if (!length(seasons)) return(bref_schedule_empty())
  force_refresh <- tolower(Sys.getenv("NBA_REFRESH_SCHEDULES", "false")) %in% c("1", "true", "yes")
  if (file.exists(schedule_cache) && !force_refresh) {
    schedules <- read.csv(schedule_cache, stringsAsFactors = FALSE, check.names = FALSE)
  } else {
    schedules <- do.call(rbind, lapply(seasons, function(season) {
      regular <- parse_bref_schedule(
        season,
        "Regular Season",
        sprintf("https://www.basketball-reference.com/leagues/NBA_%s_games.html", season)
      )
      playoffs <- parse_bref_schedule(
        season,
        "Playoffs",
        sprintf("https://www.basketball-reference.com/playoffs/NBA_%s_games.html", season)
      )
      if (nrow(regular) && nrow(playoffs)) {
        playoff_keys <- paste(playoffs$date, playoffs$home_team, playoffs$away_team)
        regular <- regular[!(paste(regular$date, regular$home_team, regular$away_team) %in% playoff_keys), , drop = FALSE]
      }
      rbind(regular, playoffs)
    }))
    if (!is.null(schedules) && nrow(schedules)) {
      dir.create(schedule_dir, recursive = TRUE, showWarnings = FALSE)
      write.csv(schedules, schedule_cache, row.names = FALSE, na = "")
    }
  }
  if (is.null(schedules) || !nrow(schedules)) return(bref_schedule_empty())
  schedules <- classify_extra_regular_games(schedules)
  rating_key <- paste(teams$year, teams$team, sep = "||")
  ratings <- teams$adjusted_total
  names(ratings) <- rating_key
  home_rating <- ratings[paste(schedules$season, schedules$home_team, sep = "||")]
  away_rating <- ratings[paste(schedules$season, schedules$away_team, sep = "||")]
  diff <- suppressWarnings(as.numeric(home_rating) - as.numeric(away_rating))
  schedules$home_win_probability <- round(1 / (1 + exp(-diff / (2.2 * 3))), 3)
  schedules$away_win_probability <- round(1 - schedules$home_win_probability, 3)
  schedules
}

apply_schedule_projections <- function(teams, schedules) {
  if (!nrow(schedules)) return(teams)
  teams$expected_wins <- teams$projected_wins
  teams$expected_losses <- teams$projected_losses
  teams$actual_wins <- NA_real_
  teams$actual_losses <- NA_real_
  teams$remaining_games <- NA_real_
  teams$playoff_projected_wins <- NA_real_
  teams$playoff_projected_losses <- NA_real_
  teams$playoff_actual_wins <- NA_real_
  teams$playoff_actual_losses <- NA_real_
  for (idx in seq_len(nrow(teams))) {
    team <- teams$team[idx]
    season <- teams$year[idx]
    games <- schedules[schedules$season == season & (schedules$home_team == team | schedules$away_team == team), , drop = FALSE]
    if (!nrow(games)) next
    regular <- games[games$season_type == "Regular Season", , drop = FALSE]
    playoffs <- games[games$season_type == "Playoffs", , drop = FALSE]
    is_home <- regular$home_team == team
    completed <- regular$is_completed
    win_prob <- ifelse(is_home, regular$home_win_probability, regular$away_win_probability)
    actual_wins <- sum(completed & regular$result == team, na.rm = TRUE)
    actual_losses <- sum(completed & regular$result != team, na.rm = TRUE)
    future_wins <- sum(win_prob[!completed], na.rm = TRUE)
    expected_wins <- sum(win_prob, na.rm = TRUE)
    teams$actual_wins[idx] <- actual_wins
    teams$actual_losses[idx] <- actual_losses
    teams$remaining_games[idx] <- sum(!completed, na.rm = TRUE)
    teams$expected_wins[idx] <- round(expected_wins, 1)
    teams$expected_losses[idx] <- round(nrow(regular) - expected_wins, 1)
    teams$projected_wins[idx] <- round(actual_wins + future_wins, 1)
    teams$projected_losses[idx] <- round(actual_losses + sum(1 - win_prob[!completed], na.rm = TRUE), 1)
    teams$win_pct[idx] <- round(ifelse(nrow(regular) > 0, teams$projected_wins[idx] / nrow(regular), NA_real_), 3)
    if (nrow(playoffs)) {
      playoff_is_home <- playoffs$home_team == team
      playoff_completed <- playoffs$is_completed
      playoff_prob <- ifelse(playoff_is_home, playoffs$home_win_probability, playoffs$away_win_probability)
      playoff_actual_wins <- sum(playoff_completed & playoffs$result == team, na.rm = TRUE)
      playoff_actual_losses <- sum(playoff_completed & playoffs$result != team, na.rm = TRUE)
      teams$playoff_actual_wins[idx] <- playoff_actual_wins
      teams$playoff_actual_losses[idx] <- playoff_actual_losses
      teams$playoff_projected_wins[idx] <- round(playoff_actual_wins + sum(playoff_prob[!playoff_completed], na.rm = TRUE), 1)
      teams$playoff_projected_losses[idx] <- round(playoff_actual_losses + sum(1 - playoff_prob[!playoff_completed], na.rm = TRUE), 1)
    }
  }
  rank_group <- if ("scenario_id" %in% names(teams)) paste(teams$year, teams$scenario_id) else teams$year
  conference_rank_group <- if ("scenario_id" %in% names(teams)) paste(teams$year, teams$scenario_id, teams$conference) else paste(teams$year, teams$conference)
  teams$league_rank <- ave(-teams$projected_wins, rank_group, FUN = function(v) rank(v, ties.method = "first"))
  teams$rank <- teams$league_rank
  teams$conference_rank <- ave(-teams$projected_wins, conference_rank_group, FUN = function(v) rank(v, ties.method = "first"))
  teams$playoff_status <- ifelse(teams$conference_rank <= 6, "Playoff", ifelse(teams$conference_rank <= 10, "Play-In", "Lottery"))
  order_key <- if ("scenario_id" %in% names(teams)) teams$scenario_id else ""
  teams[order(teams$year, order_key, teams$league_rank), ]
}

build_pick_assets <- function(base_dir, players) {
  picks <- 1:60
  fallback_value <- ifelse(picks <= 30, 34000000 * exp(-(picks - 1) / 19), 4200000 * exp(-(picks - 31) / 18))
  value <- fallback_value
  training_n <- rep(0L, length(picks))

  draft_path <- file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv")
  if (file.exists(draft_path) && is.data.frame(players) && nrow(players)) {
    draft <- read.csv(draft_path, stringsAsFactors = FALSE, check.names = FALSE)
    required <- c("player", "draft_year", "pick_overall")
    if (all(required %in% names(draft)) && all(c("player_name", "year", "value") %in% names(players))) {
      latest_impact_year <- max(suppressWarnings(as.integer(players$skill_source_year)), na.rm = TRUE)
      if (!is.finite(latest_impact_year)) {
        latest_impact_year <- max(suppressWarnings(as.integer(players$year)), na.rm = TRUE)
      }
      impact <- players
      impact$join_player <- normalize_name(impact$player_name)
      impact$year <- suppressWarnings(as.integer(impact$year))
      impact$value <- suppressWarnings(as.numeric(impact$value))
      impact <- impact[
        !is.na(impact$join_player) & impact$join_player != "" &
          !is.na(impact$year) & impact$year <= latest_impact_year &
          is.finite(impact$value),
        c("join_player", "year", "value"),
        drop = FALSE
      ]

      draft_ref <- data.frame(
        join_player = normalize_name(draft$player),
        draft_year = suppressWarnings(as.integer(draft$draft_year)),
        pick = suppressWarnings(as.integer(draft$pick_overall)),
        stringsAsFactors = FALSE
      )
      draft_ref <- draft_ref[
        !is.na(draft_ref$join_player) & draft_ref$join_player != "" &
          !is.na(draft_ref$draft_year) & draft_ref$pick %in% picks,
        ,
        drop = FALSE
      ]
      draft_ref <- draft_ref[!duplicated(paste(draft_ref$join_player, draft_ref$draft_year, draft_ref$pick)), ]
      training <- merge(draft_ref, impact, by = "join_player", all = FALSE)
      training$nba_year <- training$year - training$draft_year
      training <- training[training$nba_year %in% c(3, 4), , drop = FALSE]

      if (nrow(training)) {
        target <- aggregate(
          value ~ join_player + draft_year + pick,
          data = training,
          FUN = function(x) 4 * max(x, na.rm = TRUE)
        )
        target$value <- pmax(0, suppressWarnings(as.numeric(target$value)))
        target <- target[is.finite(target$value), , drop = FALSE]
        training_counts <- table(target$pick)
        training_n[as.integer(names(training_counts))] <- as.integer(training_counts)

        if (nrow(target) >= 30 && length(unique(target$pick)) >= 20) {
          target_by_pick <- aggregate(target$value, by = list(pick = target$pick), FUN = median)
          names(target_by_pick)[2] <- "target_value"
          target_by_pick <- target_by_pick[order(target_by_pick$pick), , drop = FALSE]
          fit <- isoreg(target_by_pick$pick, -log1p(target_by_pick$target_value))
          fitted_curve <- approx(
            x = target_by_pick$pick,
            y = fit$yf,
            xout = picks,
            rule = 2,
            ties = mean
          )$y
          trained_value <- pmax(0, expm1(-fitted_curve))
          if (all(is.finite(trained_value)) && max(trained_value, na.rm = TRUE) > 0) {
            value <- trained_value
          }
        }
      }
    }
  }

  data.frame(
    asset_id = paste0("pick-", picks),
    label = paste0("Pick ", picks),
    pick = picks,
    round = ifelse(picks <= 30, 1, 2),
    normalized = round(value / max(value, na.rm = TRUE), 3),
    value = round(value, 0),
    asset_type = "slot_value",
    origin_team = NA_character_,
    draft_year = NA_integer_,
    protection = NA_character_,
    protection_cutoff = NA_integer_,
    counterparty_team = NA_character_,
    convey_probability = NA_real_,
    expected_pick = picks,
    training_n = training_n,
    stringsAsFactors = FALSE
  )
}

load_draft_college_reference <- function(base_dir) {
  path <- file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv")
  if (!file.exists(path)) {
    return(data.frame(join_player = character(), draft_year = integer(), college = character(), actual_pick = numeric(), drafted_team = character()))
  }
  picks <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("player", "draft_year", "college", "pick_overall", "team") %in% names(picks))) {
    return(data.frame(join_player = character(), draft_year = integer(), college = character(), actual_pick = numeric(), drafted_team = character()))
  }
  out <- data.frame(
    join_player = normalize_name(picks$player),
    draft_year = suppressWarnings(as.integer(picks$draft_year)),
    college = as.character(picks$college),
    actual_pick = suppressWarnings(as.numeric(picks$pick_overall)),
    drafted_team = as.character(picks$team),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$join_player) & out$join_player != "" & !is.na(out$draft_year), ]
  out <- out[order(out$draft_year, out$join_player, out$actual_pick), ]
  out <- out[!duplicated(paste(out$join_player, out$draft_year)), ]
  out
}

load_draft_position_overrides <- function(base_dir) {
  path <- file.path(base_dir, "ref", "draft_position_overrides.csv")
  if (!file.exists(path)) {
    return(data.frame(join_player = character(), draft_year = integer(), position_override = character()))
  }
  overrides <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("player", "draft_year", "position") %in% names(overrides))) {
    return(data.frame(join_player = character(), draft_year = integer(), position_override = character()))
  }
  valid_positions <- c("PG", "SG", "SF", "PF", "C", "PG/SG", "SG/SF", "SF/PF", "PF/C")
  out <- data.frame(
    join_player = normalize_name(overrides$player),
    draft_year = suppressWarnings(as.integer(overrides$draft_year)),
    position_override = toupper(trimws(as.character(overrides$position))),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$join_player) & out$join_player != "" & !is.na(out$draft_year), ]
  out <- out[out$position_override %in% valid_positions, ]
  out <- out[!duplicated(paste(out$join_player, out$draft_year)), ]
  out
}

load_realgm_draft_positions <- function(base_dir) {
  paths <- c(
    file.path(base_dir, "processed", "draft", "no_college_realgm_draft_map.csv"),
    file.path(base_dir, "processed", "draft", "draft_no_college_all_classes.csv")
  )
  parts <- lapply(paths[file.exists(paths)], function(path) {
    map <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    if (!all(c("player", "draft_year", "pos") %in% names(map))) return(NULL)
    map[, c("player", "draft_year", "pos"), drop = FALSE]
  })
  map <- do.call(rbind, parts[!vapply(parts, is.null, logical(1))])
  if (is.null(map) || !nrow(map)) {
    return(data.frame(join_player = character(), draft_year = integer(), realgm_position = character()))
  }
  firm_positions <- c("PG", "SG", "SF", "PF", "C")
  out <- data.frame(
    join_player = normalize_name(map$player),
    draft_year = suppressWarnings(as.integer(map$draft_year)),
    realgm_position = toupper(trimws(as.character(map$pos))),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$join_player) & out$join_player != "" & !is.na(out$draft_year), ]
  out <- out[out$realgm_position %in% firm_positions, ]
  out <- out[!duplicated(paste(out$join_player, out$draft_year)), ]
  out
}

load_realgm_draft_bio_reference <- function(base_dir) {
  paths <- c(
    file.path(base_dir, "processed", "draft", "no_college_realgm_draft_map.csv"),
    file.path(base_dir, "processed", "draft", "draft_no_college_all_classes.csv")
  )
  parts <- lapply(paths[file.exists(paths)], function(path) {
    map <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
    if (!all(c("player", "draft_year", "age") %in% names(map))) return(NULL)
    map[, c("player", "draft_year", "age"), drop = FALSE]
  })
  map <- do.call(rbind, parts[!vapply(parts, is.null, logical(1))])
  if (is.null(map) || !nrow(map)) {
    return(data.frame(join_player = character(), draft_year = integer(), draft_age_ref = numeric()))
  }
  out <- data.frame(
    join_player = normalize_name(map$player),
    draft_year = suppressWarnings(as.integer(map$draft_year)),
    draft_age_ref = suppressWarnings(as.numeric(map$age)),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$join_player) & out$join_player != "" & !is.na(out$draft_year) & is.finite(out$draft_age_ref), ]
  out <- out[!duplicated(paste(out$join_player, out$draft_year)), ]
  out
}

load_draft_scv_reference <- function(base_dir) {
  path <- file.path(base_dir, "ref", "scvardraft.csv")
  if (!file.exists(path)) {
    return(data.frame(join_player = character(), scv_draft_ref = numeric()))
  }
  scv <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!("name" %in% names(scv))) {
    return(data.frame(join_player = character(), scv_draft_ref = numeric()))
  }
  score_col <- names(scv)[tolower(names(scv)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(data.frame(join_player = character(), scv_draft_ref = numeric()))
  }
  out <- data.frame(
    join_player = normalize_name(scv$name),
    scv_draft_ref = suppressWarnings(as.numeric(scv[[score_col]])),
    stringsAsFactors = FALSE
  )
  out <- out[!is.na(out$join_player) & out$join_player != "" & is.finite(out$scv_draft_ref), ]
  out <- out[!duplicated(out$join_player), ]
  out
}

build_draft_prospects <- function(base_dir, impact_reference = NULL, replacement_reference = NULL) {
  draft_dir <- file.path(base_dir, "processed", "draft")
  adjusted_skill_path <- Sys.getenv(
    "DRAFT_FRONTEND_ADJUSTED_SKILL_PATH",
    file.path(draft_dir, "draft_skill_predictions_adjusted.csv")
  )
  base_skill_path <- Sys.getenv(
    "DRAFT_FRONTEND_BASE_SKILL_PATH",
    file.path(draft_dir, "draft_skill_predictions_output.csv")
  )
  skill_path <- if (file.exists(adjusted_skill_path)) adjusted_skill_path else base_skill_path
  unified_path <- Sys.getenv(
    "DRAFT_FRONTEND_UNIFIED_SOURCE_PATH",
    file.path(draft_dir, "draft_prediction_unified.csv")
  )
  similarity_path <- file.path(draft_dir, "draft_similarity_comps.csv")
  skill <- read_csv_required(skill_path, c("player", "draft_year", "prediction_pool", "OFF_pred", "DEF_pred", "TOTAL_pred"))
  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  similarity_cols <- c(
    "similarity_comp_player", "similarity_comp_year", "similarity_score", "similarity_distance",
    "similarity_comp_total", "similarity_comp_off", "similarity_comp_def", "similarity_comp_minutes",
    "similarity_comps",
    "off_similarity_comp_player", "off_similarity_comp_year", "off_similarity_score", "off_similarity_distance",
    "off_similarity_comp_total", "off_similarity_comp_off", "off_similarity_comp_def", "off_similarity_comp_minutes",
    "off_similarity_comps",
    "def_similarity_comp_player", "def_similarity_comp_year", "def_similarity_score", "def_similarity_distance",
    "def_similarity_comp_total", "def_similarity_comp_off", "def_similarity_comp_def", "def_similarity_comp_minutes",
    "def_similarity_comps"
  )
  skill_cols <- c(
    "player", "draft_year", "prediction_pool",
    paste0(skill_names, "_pred"), paste0("FINAL_", skill_names, "_pred"),
    "OFF_pred", "DEF_pred", "TOTAL_pred", "FINAL_OFF_pred", "FINAL_DEF_pred", "FINAL_TOTAL_pred",
    "base_rank", "FINAL_rank", "pick_proxy", "pick_proxy_available",
    "age_feature", "pick_feature", "adjustment_age_component", "adjustment_pick_component",
    "adjustment_total_component", "adjustment_off_component", "adjustment_def_component",
    paste0("adjustment_", skill_names, "_component"),
    "tracker_adjustment_version"
  )
  skill <- skill[, intersect(skill_cols, names(skill)), drop = FALSE]
  unified <- read_csv_required(unified_path, c("player", "draft_year", "scv_draft", "draft_age", "height_wo_shoes_in", "wingspan_in", "weight_lbs", "pos_code", "pre_draft_team", "source_team"))
  unified <- unified[!duplicated(paste(unified$player, unified$draft_year)), ]
  x <- merge(skill, unified, by = c("player", "draft_year"), all.x = TRUE)
  similarity <- read_csv_optional(similarity_path, c("player", "draft_year", similarity_cols))
  if (nrow(similarity)) {
    similarity <- similarity[, intersect(c("player", "draft_year", similarity_cols), names(similarity)), drop = FALSE]
    similarity <- similarity[!duplicated(paste(similarity$player, similarity$draft_year)), , drop = FALSE]
    x <- merge(x, similarity, by = c("player", "draft_year"), all.x = TRUE)
  }
  for (col_name in similarity_cols) {
    if (!col_name %in% names(x)) {
      x[[col_name]] <- NA
    }
  }
  if (!"prediction_pool" %in% names(x)) {
    prediction_pool_x <- if ("prediction_pool.x" %in% names(x)) x[["prediction_pool.x"]] else NA_character_
    prediction_pool_y <- if ("prediction_pool.y" %in% names(x)) x[["prediction_pool.y"]] else NA_character_
    x$prediction_pool <- coalesce_col(prediction_pool_x, prediction_pool_y)
  }
  x$join_player <- normalize_name(x$player)
  college_ref <- load_draft_college_reference(base_dir)
  x <- merge(x, college_ref, by = c("join_player", "draft_year"), all.x = TRUE)
  scv_ref <- load_draft_scv_reference(base_dir)
  x <- merge(x, scv_ref, by = "join_player", all.x = TRUE)
  x$scv_draft <- coalesce_numeric(x$scv_draft, x$scv_draft_ref)
  x$scv_draft_ref <- NULL
  realgm_bio <- load_realgm_draft_bio_reference(base_dir)
  x <- merge(x, realgm_bio, by = c("join_player", "draft_year"), all.x = TRUE)
  x$draft_age <- coalesce_numeric(x$draft_age, x$draft_age_ref)
  x$draft_age_ref <- NULL
  realgm_positions <- load_realgm_draft_positions(base_dir)
  x <- merge(x, realgm_positions, by = c("join_player", "draft_year"), all.x = TRUE)
  position_overrides <- load_draft_position_overrides(base_dir)
  x <- merge(x, position_overrides, by = c("join_player", "draft_year"), all.x = TRUE)
  x$join_player <- NULL
  x$position <- primary_draft_position_from_code(x$pos_code)
  x$position <- coalesce_col(x$position, x$realgm_position)
  x$realgm_position <- NULL
  x$position <- coalesce_col(x$position_override, x$position)
  x$position_override <- NULL
  draft_position_shares <- position_share_matrix_from_labels(x$position)
  for (share_col in position_share_columns()) {
    x[[share_col]] <- round(draft_position_shares[, share_col], 4)
  }
  x$position_index <- round(position_index_from_shares(draft_position_shares), 4)
  x$position_entropy <- round(position_entropy_from_shares(draft_position_shares), 4)
  college <- if ("college" %in% names(x)) as.character(x[["college"]]) else rep(NA_character_, nrow(x))
  source_team <- if ("source_team" %in% names(x)) as.character(x[["source_team"]]) else rep(NA_character_, nrow(x))
  pre_draft_team <- if ("pre_draft_team" %in% names(x)) as.character(x[["pre_draft_team"]]) else rep(NA_character_, nrow(x))
  prediction_pool <- if ("prediction_pool" %in% names(x)) as.character(x[["prediction_pool"]]) else rep(NA_character_, nrow(x))
  is_no_college <- !is.na(prediction_pool) & trimws(tolower(prediction_pool)) == "no_college"
  no_college_source_team <- ifelse(is_no_college, source_team, NA_character_)
  x$college <- ifelse(
    !is.na(no_college_source_team) & nzchar(trimws(no_college_source_team)),
    no_college_source_team,
    ifelse(!is.na(college) & nzchar(trimws(college)), college, pre_draft_team)
  )
  x$pre_draft_team <- ifelse(
    !is.na(no_college_source_team) & nzchar(trimws(no_college_source_team)),
    no_college_source_team,
    pre_draft_team
  )
  x$replacement_total <- draft_replacement_total(
    x$position,
    replacement_reference,
    x[, intersect(position_share_columns(), names(x)), drop = FALSE]
  )
  if (!("FINAL_TOTAL_pred" %in% names(x))) {
    x$FINAL_TOTAL_pred <- x$TOTAL_pred
  }
  if (!("FINAL_OFF_pred" %in% names(x))) {
    x$FINAL_OFF_pred <- x$OFF_pred
  }
  if (!("FINAL_DEF_pred" %in% names(x))) {
    x$FINAL_DEF_pred <- x$DEF_pred
  }
  x$FINAL_TOTAL_pred <- ifelse(is.na(x$FINAL_TOTAL_pred), x$TOTAL_pred, x$FINAL_TOTAL_pred)
  x$FINAL_OFF_pred <- ifelse(is.na(x$FINAL_OFF_pred), x$OFF_pred, x$FINAL_OFF_pred)
  x$FINAL_DEF_pred <- ifelse(is.na(x$FINAL_DEF_pred), x$DEF_pred, x$FINAL_DEF_pred)
  for (skill_name in skill_names) {
    pred_col <- paste0(skill_name, "_pred")
    final_pred_col <- paste0("FINAL_", skill_name, "_pred")
    if (final_pred_col %in% names(x)) {
      if (!(pred_col %in% names(x))) {
        x[[pred_col]] <- NA_real_
      }
      x[[pred_col]] <- ifelse(is.na(x[[final_pred_col]]), x[[pred_col]], x[[final_pred_col]])
    }
  }
  x$OFF_pred <- x$FINAL_OFF_pred
  x$DEF_pred <- x$FINAL_DEF_pred
  x$TOTAL_pred <- x$FINAL_TOTAL_pred
  if (!("base_rank" %in% names(x))) {
    x$base_rank <- ave(-x$TOTAL_pred, x$draft_year, FUN = rank, ties.method = "first")
  }
  x$base_rank_in_class <- suppressWarnings(as.numeric(x$base_rank))
  if (!("FINAL_rank" %in% names(x))) {
    x$FINAL_rank <- ave(-x$TOTAL_pred, x$draft_year, FUN = rank, ties.method = "first")
  }
  x$FINAL_rank <- ifelse(is.na(x$FINAL_rank), ave(-x$TOTAL_pred, x$draft_year, FUN = rank, ties.method = "first"), x$FINAL_rank)
  x$timin <- round((x$TOTAL_pred - x$replacement_total) * 1800, 1)
  x$rank_in_class <- suppressWarnings(as.numeric(x$FINAL_rank))
  impact_reference <- if (is.null(impact_reference)) data.frame(total = numeric(), timin = numeric())
  reference_total <- impact_reference$total
  reference_timin <- impact_reference$timin
  if (length(reference_total) < 2 || length(reference_timin) < 2) {
    reference_total <- x$TOTAL_pred
    reference_timin <- x$timin
  }
  timin_pct <- percent_rank_against(x$timin, reference_timin)
  total_pct <- percent_rank_against(x$TOTAL_pred, reference_total)
  x$score <- round(100 * (0.35 * timin_pct + 0.65 * total_pct), 1)
  x$tier <- draft_tier_from_score(x$score)
  x <- x[order(-x$draft_year, x$rank_in_class), ]
  cols <- c(
    "player", "draft_year", "rank_in_class", "base_rank_in_class", "score", "prediction_pool", "tier", "scv_draft",
    "draft_age", "height_wo_shoes_in", "wingspan_in", "weight_lbs", "pos_code", "position",
    "pg_share", "sg_share", "sf_share", "pf_share", "c_share", "position_index", "position_entropy",
    "replacement_total", "timin", "college", "pre_draft_team",
    paste0(skill_names, "_pred"),
    "OFF_pred", "DEF_pred", "TOTAL_pred",
    similarity_cols,
    "actual_pick", "drafted_team", "pick_proxy", "pick_proxy_available", "age_feature", "pick_feature",
    "adjustment_age_component", "adjustment_pick_component", "adjustment_total_component",
    "adjustment_off_component", "adjustment_def_component", paste0("adjustment_", skill_names, "_component"),
    "tracker_adjustment_version"
  )
  x[, intersect(cols, names(x)), drop = FALSE]
}

build_draft_tracker <- function(base_dir) {
  draft_dir <- file.path(base_dir, "processed", "draft")
  drop_legacy <- function(df) {
    if ("board" %in% names(df)) {
      return(df[df$board != "Legacy Me Model", , drop = FALSE])
    }
    df
  }
  rename_frontend_boards <- function(df) {
    if ("board" %in% names(df)) {
      df$board <- ifelse(df$board == "SCV Adjusted Model", "Brendan Model", df$board)
      df$board <- ifelse(df$board == "SCV Base Model", "Brendan Base", df$board)
    }
    if ("display_board" %in% names(df)) {
      df$display_board <- ifelse(df$display_board == "SCV Current Model", "Brendan Model", df$display_board)
      df$display_board <- ifelse(df$display_board == "SCV Base Model", "Brendan Base", df$display_board)
    }
    df
  }
  list(
    board_summary = rename_frontend_boards(drop_legacy(read_csv_optional(
      file.path(draft_dir, "draft_tracker_board_summary.csv"),
      c("board", "weighted_score", "weighted_z", "years")
    ))),
    board_scores = rename_frontend_boards(drop_legacy(read_csv_optional(
      file.path(draft_dir, "draft_tracker_board_scores.csv"),
      c("draft_year", "board", "score", "year_weight", "z_score")
    ))),
    prospect_scores = rename_frontend_boards(drop_legacy(read_csv_optional(
      file.path(draft_dir, "draft_tracker_prospect_scores.csv"),
      c(
        "draft_year", "board", "display_board", "model_group", "player", "nba_id", "actual_pick", "college",
        "actual_rank", "actual_weight", "career_minutes", "actual_impact", "actual_score",
        "board_rank", "eval_rank", "rank_error", "correct_pct", "weighted_score_contribution",
        "board_year_score", "board_year_z"
      )
    )))
  )
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)
source(file.path(base_dir, "script", "data", "darko_dpm_fallback.R"), local = FALSE)
out_dir <- file.path(base_dir, "frontend", "public", "data")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

players <- with_frontend_timing(base_dir, "frontend_export", "build_impact_players", build_impact_players(base_dir))
teams <- with_frontend_timing(base_dir, "frontend_export", "build_team_projections", build_team_projections(players))
team_lineups <- with_frontend_timing(base_dir, "frontend_export", "build_team_lineups", build_team_lineups(players))
schedules <- with_frontend_timing(base_dir, "frontend_export", "build_team_schedules", build_team_schedules(teams))
teams <- with_frontend_timing(base_dir, "frontend_export", "apply_schedule_projections", apply_schedule_projections(teams, schedules))
picks <- with_frontend_timing(base_dir, "frontend_export", "build_pick_assets", build_pick_assets(base_dir, players))
latest_impact_year <- max(suppressWarnings(as.integer(players$skill_source_year)), na.rm = TRUE)
if (!is.finite(latest_impact_year)) {
  latest_impact_year <- max(players$year, na.rm = TRUE)
}
roster_audit <- with_frontend_timing(
  base_dir,
  "frontend_export",
  "write_roster_truth_audit",
  write_roster_truth_audit(base_dir, players, teams, team_lineups, latest_impact_year),
  paste0("roster year ", latest_impact_year)
)
replacement_reference <- replacement_reference_from_players(players, latest_impact_year)
impact_reference <- players[
  players$year == latest_impact_year &
    !is.na(players$total) & is.finite(players$total) &
    !is.na(players$timin) & is.finite(players$timin) &
    !is.na(players$Minutes) & players$Minutes > 0 &
    players$score_label != "DNQ",
  c("total", "timin"),
  drop = FALSE
]
draft <- with_frontend_timing(base_dir, "frontend_export", "build_draft_prospects", build_draft_prospects(base_dir, impact_reference, replacement_reference))
tracker <- with_frontend_timing(base_dir, "frontend_export", "build_draft_tracker", build_draft_tracker(base_dir))
model_summary <- with_frontend_timing(base_dir, "frontend_export", "read_draft_model_summary", read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_summary.csv")))
model_details <- with_frontend_timing(base_dir, "frontend_export", "read_draft_model_feature_details", read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_feature_details.csv")))

players_export <- primary_position_export(players)
team_lineups_export <- lineup_position_export(team_lineups)
draft_export <- primary_position_export(draft)

with_frontend_timing(base_dir, "frontend_export_write", "write_impact_players_json", write_json_df(players_export, file.path(out_dir, "impact_players.json")), paste0(nrow(players_export), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_team_projections_json", write_json_df(teams, file.path(out_dir, "team_projections.json")), paste0(nrow(teams), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_team_lineups_json", write_json_df(team_lineups_export, file.path(out_dir, "team_lineups.json")), paste0(nrow(team_lineups_export), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_team_schedules_json", write_json_df(schedules, file.path(out_dir, "team_schedules.json")), paste0(nrow(schedules), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_pick_assets_json", write_json_df(picks, file.path(out_dir, "pick_assets.json")), paste0(nrow(picks), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_prospects_json", write_json_df(draft_export, file.path(out_dir, "draft_prospects.json")), paste0(nrow(draft_export), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_tracker_board_summary_json", write_json_df(tracker$board_summary, file.path(out_dir, "draft_tracker_board_summary.json")), paste0(nrow(tracker$board_summary), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_tracker_board_scores_json", write_json_df(tracker$board_scores, file.path(out_dir, "draft_tracker_board_scores.json")), paste0(nrow(tracker$board_scores), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_tracker_prospect_scores_json", write_json_df(tracker$prospect_scores, file.path(out_dir, "draft_tracker_prospect_scores.json")), paste0(nrow(tracker$prospect_scores), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_model_summary_json", write_json_df(model_summary, file.path(out_dir, "draft_model_summary.json")), paste0(nrow(model_summary), " rows"))
with_frontend_timing(base_dir, "frontend_export_write", "write_draft_model_feature_details_json", write_json_df(model_details, file.path(out_dir, "draft_model_feature_details.json")), paste0(nrow(model_details), " rows"))

offseason_truth_path <- file.path(out_dir, "offseason_truth.json")
offseason_truth_script <- file.path(base_dir, "script", "frontend", "build_offseason_truth_overlay.mjs")
node_bin <- Sys.which("node")
if (file.exists(offseason_truth_script) && nzchar(node_bin)) {
  with_frontend_timing(
    base_dir,
    "frontend_export_write",
    "write_offseason_truth_json",
    system2(node_bin, offseason_truth_script, stdout = TRUE, stderr = TRUE),
    "offseason truth overlay"
  )
}

cap_tracker_path <- file.path(out_dir, "cap_tracker.json")
cap_tracker_script <- file.path(base_dir, "script", "frontend", "build_cap_tracker_data.mjs")
if (file.exists(cap_tracker_script) && nzchar(node_bin)) {
  with_frontend_timing(
    base_dir,
    "frontend_export_write",
    "write_cap_tracker_json",
    system2(node_bin, cap_tracker_script, stdout = TRUE, stderr = TRUE),
    "multi-year cap tracker"
  )
}

manifest_rows <- data.frame(
  dataset = c(
    "impact_players", "team_projections", "team_lineups", "team_schedules", "pick_assets", "draft_prospects",
    "draft_tracker_board_summary", "draft_tracker_board_scores", "draft_tracker_prospect_scores",
    "draft_model_summary", "draft_model_feature_details"
  ),
  rows = c(
    nrow(players), nrow(teams), nrow(team_lineups), nrow(schedules), nrow(picks), nrow(draft),
    nrow(tracker$board_summary), nrow(tracker$board_scores), nrow(tracker$prospect_scores),
    nrow(model_summary), nrow(model_details)
  ),
  file = c(
    "impact_players.json", "team_projections.json", "team_lineups.json", "team_schedules.json", "pick_assets.json", "draft_prospects.json",
    "draft_tracker_board_summary.json", "draft_tracker_board_scores.json", "draft_tracker_prospect_scores.json",
    "draft_model_summary.json", "draft_model_feature_details.json"
  ),
  stringsAsFactors = FALSE
)
if (file.exists(offseason_truth_path)) {
  manifest_rows <- rbind(manifest_rows, data.frame(
    dataset = "offseason_truth",
    rows = sum(players$year == latest_impact_year, na.rm = TRUE),
    file = "offseason_truth.json",
    stringsAsFactors = FALSE
  ))
}
if (file.exists(cap_tracker_path)) {
  cap_tracker_rows <- length(unique(teams$team)) * 6
  if (requireNamespace("jsonlite", quietly = TRUE)) {
    cap_tracker_data <- tryCatch(jsonlite::fromJSON(cap_tracker_path), error = function(e) NULL)
    if (!is.null(cap_tracker_data) && "team_seasons" %in% names(cap_tracker_data)) {
      cap_tracker_rows <- nrow(cap_tracker_data$team_seasons)
    }
  }
  manifest_rows <- rbind(manifest_rows, data.frame(
    dataset = "cap_tracker",
    rows = cap_tracker_rows,
    file = "cap_tracker.json",
    stringsAsFactors = FALSE
  ))
}

with_frontend_timing(
  base_dir,
  "frontend_export_write",
  "write_manifest_json",
  write_json_object(list(
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    source_root = base_dir,
    note = "Generated from canonical processed/raw CSV outputs. Excel workbooks are not read at runtime.",
    datasets = manifest_rows
  ), file.path(out_dir, "manifest.json")),
  paste0(nrow(manifest_rows), " datasets")
)

static_manifest_script <- file.path(base_dir, "script", "frontend", "build_static_data_manifest.mjs")
if (file.exists(static_manifest_script) && nzchar(node_bin)) {
  with_frontend_timing(
    base_dir,
    "frontend_export_write",
    "write_static_data_manifest",
    system2(node_bin, static_manifest_script, stdout = TRUE, stderr = TRUE),
    "season shards and deploy manifest"
  )
}

message("Frontend data export complete: ", out_dir)
message("Rows: players=", nrow(players), ", teams=", nrow(teams), ", draft=", nrow(draft))
if (!identical(tolower(Sys.getenv("FRONTEND_REFRESH_SUPPRESS_EXPORT_SUMMARY", "false")), "true")) {
  print_frontend_timing_summary(base_dir)
}
