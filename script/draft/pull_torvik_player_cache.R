if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")
if (!requireNamespace("toRvik", quietly = TRUE)) install.packages("toRvik")

library(data.table)

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

parse_optional_int_env <- function(var_name) {
  raw_value <- trimws(Sys.getenv(var_name, ""))
  if (!nzchar(raw_value)) {
    return(NA_integer_)
  }

  parsed <- suppressWarnings(as.integer(raw_value))
  if (!is.finite(parsed)) {
    warning(sprintf("Environment variable %s is not a valid integer: %s", var_name, raw_value))
    return(NA_integer_)
  }

  parsed
}

parse_target_years <- function(raw_value) {
  raw_value <- trimws(raw_value)
  if (!nzchar(raw_value)) {
    return(integer())
  }

  pieces <- unlist(strsplit(raw_value, "[,;|]", perl = TRUE), use.names = FALSE)
  pieces <- trimws(pieces)
  pieces <- pieces[nzchar(pieces)]
  years <- suppressWarnings(as.integer(pieces))
  unique(years[is.finite(years)])
}

standardize_torvik_dt <- function(dt, year) {
  dt <- as.data.table(dt)
  if (!nrow(dt)) {
    return(dt)
  }

  if (!"year" %in% names(dt)) {
    dt[, year := year]
  } else {
    dt[, year := suppressWarnings(as.integer(year))]
  }

  if (!"season" %in% names(dt)) {
    dt[, season := year]
  }

  if ("id" %in% names(dt) && !"player_id" %in% names(dt)) {
    dt[, player_id := as.character(id)]
  } else if ("player_id" %in% names(dt)) {
    dt[, player_id := as.character(player_id)]
  }

  if ("player" %in% names(dt)) {
    dt[, player := as.character(player)]
  }

  dt[, created_at := format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")]
  dt[, source_year := year]
  dt[]
}

fetch_torvik_all <- function(year) {
  fetch_one <- function(stat_name) {
    out <- tryCatch(
      toRvik::bart_player_season(year = year, stat = stat_name),
      error = function(e) NULL
    )
    if (is.null(out) || !nrow(out)) {
      return(NULL)
    }

    out <- as.data.table(out)
    prefix_cols <- setdiff(names(out), c("player", "id", "player_id", "team", "conf", "year", "season", "pos", "exp"))
    setnames(out, prefix_cols, paste0(stat_name, "_", prefix_cols))
    out
  }

  merged <- tryCatch(
    {
      all_dt <- toRvik::bart_player_season(year = year, stat = "all")
      if (!is.null(all_dt) && nrow(all_dt)) {
        return(standardize_torvik_dt(all_dt, year))
      }
      NULL
    },
    error = function(e) NULL
  )
  if (!is.null(merged) && nrow(merged)) {
    return(merged)
  }

  stat_dts <- Filter(Negate(is.null), list(
    fetch_one("box"),
    fetch_one("advanced"),
    fetch_one("shooting")
  ))

  if (!length(stat_dts)) {
    stop("No Torvik data returned for year ", year)
  }

  key_cols <- c("player", "id", "player_id", "team", "conf", "year", "season", "pos", "exp")
  merged_dt <- stat_dts[[1]]
  for (i in seq(2, length(stat_dts))) {
    merge_keys <- intersect(key_cols, intersect(names(merged_dt), names(stat_dts[[i]])))
    merged_dt <- merge(merged_dt, stat_dts[[i]], by = merge_keys, all = TRUE, sort = FALSE)
  }

  standardize_torvik_dt(merged_dt, year)
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

target_years <- parse_target_years(Sys.getenv("TORVIK_TARGET_YEARS", ""))
start_year <- parse_optional_int_env("TORVIK_START_YEAR")
end_year <- parse_optional_int_env("TORVIK_END_YEAR")
refresh_existing <- identical(tolower(trimws(Sys.getenv("TORVIK_REFRESH_EXISTING", "false"))), "true")

if (!length(target_years)) {
  if (!is.finite(start_year)) start_year <- 2014L
  if (!is.finite(end_year)) end_year <- as.integer(format(Sys.Date(), "%Y"))
  if (end_year < start_year) {
    stop("TORVIK_END_YEAR must be greater than or equal to TORVIK_START_YEAR.")
  }
  target_years <- start_year:end_year
}

message("Pulling Bart Torvik player-season cache for years: ", paste(target_years, collapse = ", "))

for (year in target_years) {
  output_fp <- file.path(draft_dir, sprintf("torvik_%d.csv", year))
  if (file.exists(output_fp) && !refresh_existing) {
    message("Skipping existing Torvik cache -> ", output_fp)
    next
  }

  message("Fetching Torvik data for ", year, " ...")
  year_dt <- fetch_torvik_all(year)
  fwrite(year_dt, output_fp, na = "")
  message("Wrote Torvik cache -> ", output_fp)
}

message("Torvik cache refresh complete.")
