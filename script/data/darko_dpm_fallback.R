darko_dpm_history_url <- function() {
  Sys.getenv(
    "DARKO_DPM_HISTORY_CSV_URL",
    unset = paste0(
      "https://docs.google.com/spreadsheets/d/",
      "1mhwOLqPu2F9026EQiVxFPIN1t9RGafGpl-dokaIsm9c",
      "/gviz/tq?tqx=out:csv&gid=142925152"
    )
  )
}

darko_dpm_history_cache_path <- function(base_dir) {
  Sys.getenv(
    "DARKO_DPM_HISTORY_CACHE",
    unset = file.path(base_dir, "raw", "darko_full_dpm_history.csv")
  )
}

read_darko_dpm_history <- function(base_dir) {
  cache_path <- darko_dpm_history_cache_path(base_dir)
  refresh <- tolower(Sys.getenv("DARKO_DPM_REFRESH", unset = "false")) %in% c("1", "true", "yes")
  history <- NULL

  if (!refresh && file.exists(cache_path)) {
    history <- read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE)
  } else {
    url <- darko_dpm_history_url()
    history <- tryCatch(
      read.csv(url, stringsAsFactors = FALSE, check.names = FALSE),
      error = function(e) {
        if (file.exists(cache_path)) {
          message("Could not refresh DARKO DPM history; using cache: ", conditionMessage(e))
          read.csv(cache_path, stringsAsFactors = FALSE, check.names = FALSE)
        } else {
          stop("Could not read DARKO DPM history from ", url, ": ", conditionMessage(e))
        }
      }
    )
    dir.create(dirname(cache_path), recursive = TRUE, showWarnings = FALSE)
    write.csv(history, cache_path, row.names = FALSE, na = "")
  }

  required <- c("nba_id", "player_name", "season", "age", "dpm", "o_dpm", "d_dpm")
  missing <- setdiff(required, names(history))
  if (length(missing) > 0) {
    stop("DARKO DPM history is missing required column(s): ", paste(missing, collapse = ", "))
  }

  history$nba_id <- suppressWarnings(as.integer(history$nba_id))
  history$year <- suppressWarnings(as.integer(history$season))
  history$age <- suppressWarnings(as.numeric(history$age))
  for (col in intersect(c("dpm", "o_dpm", "d_dpm", "box_odpm", "box_ddpm", "on_off_odpm", "on_off_ddpm"), names(history))) {
    history[[col]] <- suppressWarnings(as.numeric(history[[col]]))
  }
  history <- history[!is.na(history$nba_id) & !is.na(history$year), , drop = FALSE]
  history <- history[order(history$nba_id, history$year), , drop = FALSE]
  history <- history[!duplicated(paste(history$nba_id, history$year)), , drop = FALSE]
  history
}

first_existing_col <- function(df, candidates) {
  hit <- candidates[candidates %in% names(df)]
  if (length(hit) > 0) hit[[1]] else NA_character_
}

copy_col_if_present <- function(target, target_col, source, source_col, idx) {
  if (!is.na(target_col) && target_col %in% names(target) && source_col %in% names(source)) {
    target[[target_col]][idx] <- source[[source_col]]
  }
  target
}

append_darko_dpm_fallback_rows <- function(stats, epm_rows, base_dir, strict = TRUE) {
  if (!nrow(stats) || !nrow(epm_rows) || !all(c("nba_id", "year") %in% names(epm_rows))) {
    return(stats)
  }

  fallback_flag_col <- ".darko_dpm_fallback"
  if (!(fallback_flag_col %in% names(stats))) {
    stats[[fallback_flag_col]] <- FALSE
  }

  stats$nba_id <- suppressWarnings(as.integer(stats$nba_id))
  stats$year <- suppressWarnings(as.integer(stats$year))
  epm_rows$nba_id <- suppressWarnings(as.integer(epm_rows$nba_id))
  epm_rows$year <- suppressWarnings(as.integer(epm_rows$year))

  stats_key <- paste(stats$nba_id, stats$year)
  epm_keys <- unique(epm_rows[!is.na(epm_rows$nba_id) & !is.na(epm_rows$year), c("nba_id", "year"), drop = FALSE])
  missing_keys <- epm_keys[!(paste(epm_keys$nba_id, epm_keys$year) %in% stats_key), , drop = FALSE]
  if (!nrow(missing_keys)) {
    return(stats)
  }

  history <- read_darko_dpm_history(base_dir)
  history_key <- paste(history$nba_id, history$year)
  missing_key <- paste(missing_keys$nba_id, missing_keys$year)
  history_match <- match(missing_key, history_key)
  missing_history <- is.na(history_match)
  if (any(missing_history) && strict) {
    stop(
      "DARKO DPM fallback missing same-year rows for nba_id/year: ",
      paste(missing_key[missing_history], collapse = ", ")
    )
  }
  missing_keys <- missing_keys[!missing_history, , drop = FALSE]
  history_match <- history_match[!missing_history]
  if (!nrow(missing_keys)) {
    return(stats)
  }

  name_col <- first_existing_col(stats, c("player_name", "Name", "name", "PLAYER_NAME"))
  age_col <- first_existing_col(stats, c("Age", "age"))
  minutes_col <- first_existing_col(stats, c("Minutes", "minutes", "MIN", "min"))
  games_col <- first_existing_col(stats, c("GamesPlayed", "games", "GP"))
  mpg_col <- first_existing_col(stats, c("MPG", "mpg"))
  seconds_col <- first_existing_col(stats, c("SecondsPlayed", "seconds", "SEC"))
  odpm_col <- first_existing_col(stats, c("o_dpm", "off_dpm", "odpm", "O_DPM"))
  ddpm_col <- first_existing_col(stats, c("d_dpm", "def_dpm", "ddpm", "D_DPM"))
  dpm_col <- first_existing_col(stats, c("dpm", "DPM"))

  prior <- stats[stats$nba_id %in% missing_keys$nba_id, , drop = FALSE]
  fallback_rows <- stats[rep(1, nrow(missing_keys)), , drop = FALSE]
  for (col in names(fallback_rows)) {
    if (is.numeric(fallback_rows[[col]]) || is.integer(fallback_rows[[col]])) {
      fallback_rows[[col]] <- NA_real_
    } else if (is.logical(fallback_rows[[col]])) {
      fallback_rows[[col]] <- NA
    } else {
      fallback_rows[[col]] <- NA_character_
    }
  }

  for (i in seq_len(nrow(missing_keys))) {
    nba_id <- missing_keys$nba_id[[i]]
    year <- missing_keys$year[[i]]
    hist <- history[history_match[[i]], , drop = FALSE]
    prior_i <- prior[prior$nba_id == nba_id & prior$year < year, , drop = FALSE]
    if (nrow(prior_i)) {
      prior_i <- prior_i[order(-prior_i$year), , drop = FALSE][1, , drop = FALSE]
      fallback_rows[i, names(prior_i)] <- prior_i[1, names(fallback_rows), drop = TRUE]
    }

    fallback_rows$nba_id[[i]] <- nba_id
    fallback_rows$year[[i]] <- year
    fallback_rows[[fallback_flag_col]][[i]] <- TRUE
    if (!is.na(name_col)) fallback_rows[[name_col]][[i]] <- hist$player_name[[1]]
    if (!is.na(age_col)) fallback_rows[[age_col]][[i]] <- hist$age[[1]]
    if (!is.na(odpm_col)) fallback_rows[[odpm_col]][[i]] <- hist$o_dpm[[1]]
    if (!is.na(ddpm_col)) fallback_rows[[ddpm_col]][[i]] <- hist$d_dpm[[1]]
    if (!is.na(dpm_col)) fallback_rows[[dpm_col]][[i]] <- hist$dpm[[1]]
    fallback_rows <- copy_col_if_present(fallback_rows, first_existing_col(fallback_rows, c("box_odpm")), hist, "box_odpm", i)
    fallback_rows <- copy_col_if_present(fallback_rows, first_existing_col(fallback_rows, c("box_ddpm")), hist, "box_ddpm", i)
    fallback_rows <- copy_col_if_present(fallback_rows, first_existing_col(fallback_rows, c("on_off_odpm")), hist, "on_off_odpm", i)
    fallback_rows <- copy_col_if_present(fallback_rows, first_existing_col(fallback_rows, c("on_off_ddpm")), hist, "on_off_ddpm", i)

    if (!is.na(minutes_col)) {
      fallback_rows[[minutes_col]][[i]] <- 0
    }
    if (!is.na(games_col)) {
      fallback_rows[[games_col]][[i]] <- 0
    }
    if (!is.na(mpg_col)) {
      fallback_rows[[mpg_col]][[i]] <- 0
    }
    if (!is.na(seconds_col)) {
      fallback_rows[[seconds_col]][[i]] <- 0
    }
  }

  message("DARKO DPM fallback appended ", nrow(fallback_rows), " Databallr-style row(s).")
  rbind(stats, fallback_rows[, names(stats), drop = FALSE])
}
