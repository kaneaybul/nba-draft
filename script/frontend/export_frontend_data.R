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

coalesce_col <- function(primary, fallback) {
  ifelse(!is.na(primary) & primary != "", primary, fallback)
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

clamp <- function(x, lo, hi) pmax(lo, pmin(hi, x))

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

write_json_df <- function(df, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  names(df) <- make.names(names(df), unique = TRUE)
  rows <- character(nrow(df))
  for (i in seq_len(nrow(df))) {
    fields <- vapply(names(df), function(nm) {
      paste0("\"", json_escape(nm), "\":", json_value(df[[nm]][i]))
    }, character(1))
    rows[i] <- paste0("{", paste(fields, collapse = ","), "}")
  }
  writeLines(c("[", paste(rows, collapse = ",\n"), "]"), path, useBytes = TRUE)
}

write_json_object <- function(items, path) {
  fields <- vapply(names(items), function(nm) {
    value <- items[[nm]]
    if (is.data.frame(value)) {
      tmp <- tempfile(fileext = ".json")
      write_json_df(value, tmp)
      raw <- paste(readLines(tmp, warn = FALSE), collapse = "\n")
      unlink(tmp)
      paste0("\"", json_escape(nm), "\":", raw)
    } else {
      paste0("\"", json_escape(nm), "\":", json_value(value))
    }
  }, character(1))
  writeLines(c("{", paste(fields, collapse = ",\n"), "}"), path, useBytes = TRUE)
}

team_conference <- function(team) {
  east <- c("ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS")
  west <- c("DAL", "DEN", "GSW", "HOU", "LAC", "LAL", "MEM", "MIN", "NOP", "OKC", "PHX", "POR", "SAC", "SAS", "UTA")
  ifelse(team %in% east, "East", ifelse(team %in% west, "West", "Unknown"))
}

tier_from_score <- function(score) {
  rank <- rank(-score, ties.method = "average", na.last = "keep")
  ifelse(is.na(score) | score < 0, "Out",
    ifelse(rank == 1, "MVP",
      ifelse(rank <= 10, "Superstar",
        ifelse(rank <= 30, "Star",
          ifelse(rank <= 60, "Elite Starter",
            ifelse(rank <= 120, "Starter",
              ifelse(rank <= 150, "Fringe Starter",
                ifelse(rank <= 210, "Strong Bench",
                  ifelse(rank <= 270, "Bench",
                    ifelse(rank <= 330, "Deep Bench", "Project"))))))))))
}

replacement_level <- function(position, side) {
  pos <- toupper(as.character(position))

  if (identical(side, "offense")) {
    return(ifelse(pos == "PG", -2.0,
      ifelse(pos == "SG", -1.0,
        ifelse(pos == "SF", -2.1,
          ifelse(pos == "PF", -1.9,
            ifelse(pos == "C", -1.7, -1.5))))))
  }

  ifelse(pos == "PG", -1.5,
    ifelse(pos == "SG", -0.7,
      ifelse(pos == "SF", -1.3,
        ifelse(pos == "PF", -0.8,
          ifelse(pos == "C", -0.5, -0.7)))))
}

replacement_from_data <- function(df, side) {
  metric <- if (identical(side, "offense")) df$offense else df$defense
  fallback <- replacement_level(df$position, side)
  out <- rep(NA_real_, nrow(df))
  eligible <- !is.na(metric) &
    !is.na(df$Minutes) &
    df$Minutes >= 500 &
    df$position %in% c("PG", "SG", "SF", "PF", "C")

  keys <- unique(paste(df$year, df$position, sep = "||"))
  for (key in keys) {
    parts <- strsplit(key, "\\|\\|")[[1]]
    idx <- df$year == as.integer(parts[[1]]) & df$position == parts[[2]]
    values <- metric[idx & eligible]
    if (sum(!is.na(values)) >= 8) {
      out[idx] <- as.numeric(quantile(values, 0.20, na.rm = TRUE, names = FALSE))
    }
  }

  recent_year <- max(df$year, na.rm = TRUE) - 2
  for (pos in c("PG", "SG", "SF", "PF", "C")) {
    idx <- is.na(out) & df$position == pos
    values <- metric[
      eligible &
        df$position == pos &
        df$year >= recent_year
    ]
    if (sum(!is.na(values)) >= 8) {
      out[idx] <- as.numeric(quantile(values, 0.20, na.rm = TRUE, names = FALSE))
    }
  }

  ifelse(is.na(out), fallback, out)
}

fallback_cap_assumptions <- function() {
  data.frame(
    year = 2021:2031,
    salary_cap = c(109140000, 112414000, 123655000, 136021000, 140588000, 154647000, 166000000, 174300000, 183015000, 192166000, 201774000),
    first_apron = c(138928000, 143002000, 156983000, 172346000, 178132000, 195945000, 210321000, 220847000, 231889000, 243485000, 255659000),
    scale_cap = c(138928000, 143002000, 156983000, 172346000, 178132000, 195945000, 210321000, 220847000, 231889000, 243485000, 255659000),
    stringsAsFactors = FALSE
  )
}

load_cap_assumptions <- function(base_dir) {
  path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv")
  if (!file.exists(path)) return(fallback_cap_assumptions())
  caps <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  needed <- c("year", "salary_cap", "scale_cap")
  if (!all(needed %in% names(caps))) return(fallback_cap_assumptions())
  caps
}

cap_for_year <- function(caps, year, col = "scale_cap") {
  if (!(col %in% names(caps))) col <- "salary_cap"
  out <- suppressWarnings(as.numeric(caps[[col]][match(year, caps$year)]))
  fallback <- suppressWarnings(as.numeric(caps[[col]][which.max(caps$year)]))
  out[is.na(out)] <- fallback
  as.numeric(out)
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

  contracts <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (!all(c("nba_id", "salary_y0") %in% names(contracts))) {
    return(data.frame(nba_id = integer(), contract = numeric(), stringsAsFactors = FALSE))
  }

  out <- data.frame(
    nba_id = suppressWarnings(as.integer(contracts$nba_id)),
    contract = suppressWarnings(as.numeric(contracts$salary_y0)),
    stringsAsFactors = FALSE
  )
  for (horizon in 1:5) {
    salary_col <- paste0("salary_y", horizon)
    out[[paste0("contract_y", horizon)]] <- if (salary_col %in% names(contracts)) {
      suppressWarnings(as.numeric(contracts[[salary_col]]))
    } else {
      NA_real_
    }
  }
  out <- out[!is.na(out$nba_id), ]
  out <- out[!duplicated(out$nba_id), ]
  out
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
    stat_position = character(),
    age = numeric(),
    draft_year = numeric()
  )
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    if (all(c("nba_id", "year", "Pos2") %in% names(stats))) {
      keep <- intersect(c("nba_id", "year", "Pos2", "Age", "draft_year"), names(stats))
      stat_meta <- stats[, keep, drop = FALSE]
      if (!("Age" %in% names(stat_meta))) stat_meta$Age <- NA_real_
      if (!("draft_year" %in% names(stat_meta))) stat_meta$draft_year <- NA_real_
      names(stat_meta)[names(stat_meta) == "Pos2"] <- "stat_position"
      names(stat_meta)[names(stat_meta) == "Age"] <- "age"
      stat_meta <- stat_meta[!duplicated(paste(stat_meta$year, stat_meta$nba_id)), ]
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

  x <- merge(impact, skill, by = c("nba_id", "player_name", "year"), all.x = TRUE, suffixes = c("", "_skill"))
  x <- merge(x, epm, by = c("nba_id", "year"), all.x = TRUE)
  x <- merge(x, stat_meta, by = c("nba_id", "year"), all.x = TRUE)
  x <- merge(x, positions, by = "nba_id", all.x = TRUE)
  x <- merge(x, load_contract_reference(base_dir), by = "nba_id", all.x = TRUE)
  x$player_name <- coalesce_col(x$player_name, x$name)
  x$team <- ifelse(is.na(x$team) | x$team == "", "FA", x$team)
  x$position <- coalesce_col(x$stat_position, x$position)
  x$position <- ifelse(is.na(x$position) | x$position == "", "UNK", x$position)
  x$age <- suppressWarnings(as.numeric(x$age))
  x$draft_year <- suppressWarnings(as.numeric(x$draft_year))
  x$yoe <- ifelse(!is.na(x$draft_year), pmax(0, x$year - x$draft_year), NA_real_)
  x$total <- ifelse(!is.na(x$FINAL_TOTAL), x$FINAL_TOTAL, ifelse(!is.na(x$TOTAL), x$TOTAL, x$off_dep + x$def_dep))
  x$offense <- ifelse(!is.na(x$FINAL_OFF), x$FINAL_OFF, ifelse(!is.na(x$OFF), x$OFF, x$off_dep))
  x$defense <- ifelse(!is.na(x$FINAL_DEF), x$FINAL_DEF, ifelse(!is.na(x$DEF), x$DEF, x$def_dep))

  x <- x[order(x$year, -x$total, x$player_name), ]
  x$o_rep <- replacement_from_data(x, "offense")
  x$d_rep <- replacement_from_data(x, "defense")
  x$replacement_total <- x$o_rep + x$d_rep
  x$timin <- round((x$total - x$replacement_total) * pmax(0, x$Minutes), 1)
  x$score <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    timin_pct <- percent_rank(x$timin[idx])
    total_pct <- percent_rank(x$total[idx])
    out <- 100 * (0.35 * timin_pct + 0.65 * total_pct)
    out[is.na(x$Minutes[idx]) | x$Minutes[idx] <= 0] <- -10
    round(out, 1)
  })
  prev_score <- x$score[match(paste(x$nba_id, x$year - 1), paste(x$nba_id, x$year))]
  x$score_delta <- round(x$score - prev_score, 1)
  x$tier <- unlist(ave(x$score, x$year, FUN = tier_from_score))
  x$value <- ave(seq_len(nrow(x)), x$year, FUN = function(idx) {
    league_timin <- sum(x$timin[idx], na.rm = TRUE)
    cap_proxy <- cap_for_year(cap_assumptions, x$year[idx][1], "scale_cap")
    if (is.na(league_timin) || league_timin <= 0) {
      return(rep(NA_real_, length(idx)))
    }
    round(x$timin[idx] * cap_proxy * 30 / league_timin, 0)
  })
  x$trade_value <- round(x$value * (0.45 + x$score / 170), 0)
  x$fa_value <- round(x$value * (0.85 + x$score / 350), 0)
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
    contract_col <- paste0("contract_y", horizon)
    x[[paste0("projection_contract_y", horizon)]] <- if (contract_col %in% names(x)) suppressWarnings(as.numeric(x[[contract_col]])) else NA_real_
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
        projected_timin <- (ph$projected_total[row_match[has_projection]] - x$replacement_total[has_projection]) *
          pmax(0, ph$projected_minutes[row_match[has_projection]])
        future_year <- x$year[has_projection] + horizon
        future_cap <- cap_for_year(cap_assumptions, future_year, "scale_cap")
        league_timin <- sum(x$timin[x$year == x$year[has_projection][1]], na.rm = TRUE)
        dollar_per_timin <- ifelse(is.finite(league_timin) & league_timin > 0, future_cap * 30 / league_timin, NA_real_)
        projected_value <- projected_timin * dollar_per_timin
        projected_contract <- suppressWarnings(as.numeric(x[[paste0("contract_y", horizon)]][has_projection]))
        projected_contract[is.na(projected_contract)] <- NA_real_
        minutes_capacity <- pmin(ifelse(ph$projected_minutes[row_match[has_projection]] > 0, 48 * 82 * 5 / ph$projected_minutes[row_match[has_projection]], 15), 15)
        contract_capacity <- ifelse(!is.na(projected_contract) & projected_contract > 0, pmin(future_cap / projected_contract, 15), 15)

        x[[paste0("projection_timin_y", horizon)]][has_projection] <- round(projected_timin, 1)
        x[[paste0("projection_value_y", horizon)]][has_projection] <- round(projected_value, 0)
        x[[paste0("projection_fa_value_y", horizon)]][has_projection] <- round(projected_value * (0.85 + x$score[has_projection] / 350), 0)
        x[[paste0("projection_scalability_y", horizon)]][has_projection] <- round(pmax(0, pmin(minutes_capacity, contract_capacity) * projected_value / future_cap), 3)
      }
      x$key <- NULL
    }
  }
  x$source_note <- "Impact uses 40% EPM, 40% DPM, and 20% skill model output, standardized within season and remapped to the EPM/DPM impact target scale."

  cols <- c(
    "nba_id", "player_name", "year", "team", "position", "age", "yoe", "Minutes", "p_mpg", "p_usg",
    "o_epm", "o_dpm", "d_epm", "d_dpm", "off_dep", "def_dep", "offense", "defense",
    "total", "score", "score_delta", "tier", "timin", "value", "contract", "value_add", "trade_value",
    "fa_value", "scalability", "FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB",
    "RIMPRO", "SWITCH", "FINAL_OFF", "FINAL_DEF", "FINAL_TOTAL",
    "projection_y1", "projection_y2", "projection_y3", "projection_y4", "projection_y5",
    "projection_games_y1", "projection_games_y2", "projection_games_y3", "projection_games_y4", "projection_games_y5",
    "projection_mpg_y1", "projection_mpg_y2", "projection_mpg_y3", "projection_mpg_y4", "projection_mpg_y5",
    "projection_minutes_y1", "projection_minutes_y2", "projection_minutes_y3", "projection_minutes_y4", "projection_minutes_y5",
    "projection_timin_y1", "projection_timin_y2", "projection_timin_y3", "projection_timin_y4", "projection_timin_y5",
    "projection_value_y1", "projection_value_y2", "projection_value_y3", "projection_value_y4", "projection_value_y5",
    "projection_fa_value_y1", "projection_fa_value_y2", "projection_fa_value_y3", "projection_fa_value_y4", "projection_fa_value_y5",
    "projection_scalability_y1", "projection_scalability_y2", "projection_scalability_y3", "projection_scalability_y4", "projection_scalability_y5",
    "projection_contract_y1", "projection_contract_y2", "projection_contract_y3", "projection_contract_y4", "projection_contract_y5",
    "projection_cap_y1", "projection_cap_y2", "projection_cap_y3", "projection_cap_y4", "projection_cap_y5",
    "source_note"
  )
  cols <- intersect(cols, names(x))
  x[, cols, drop = FALSE]
}

build_team_projections <- function(players) {
  players <- players[players$team != "FA" & !is.na(players$team), ]
  split_key <- paste(players$year, players$team, sep = "||")
  grouped <- split(players, split_key)
  out <- do.call(rbind, lapply(grouped, function(df) {
    minutes <- sum(df$Minutes, na.rm = TRUE)
    wavg <- function(v) if (minutes > 0) sum(v * df$Minutes, na.rm = TRUE) / minutes else mean(v, na.rm = TRUE)
    data.frame(
      year = df$year[1],
      team = df$team[1],
      conference = team_conference(df$team[1]),
      roster_count = nrow(df),
      minutes = round(minutes, 1),
      offense = round(wavg(df$offense), 2),
      defense = round(wavg(df$defense), 2),
      total = round(wavg(df$total), 2),
      win_units = round(sum(df$total * df$Minutes / 2400, na.rm = TRUE), 2),
      stringsAsFactors = FALSE
    )
  }))
  out$centered_units <- ave(out$win_units, out$year, FUN = function(v) v - mean(v, na.rm = TRUE))
  out$projected_wins <- round(clamp(41 + out$centered_units * 1.15, 12, 70), 1)
  out$rank <- ave(-out$projected_wins, out$year, FUN = rank, ties.method = "first")
  out$conference_rank <- ave(-out$projected_wins, paste(out$year, out$conference), FUN = rank, ties.method = "first")
  out <- out[order(out$year, out$rank), ]
  out[, c("year", "team", "conference", "roster_count", "minutes", "offense", "defense", "total", "win_units", "projected_wins", "rank", "conference_rank")]
}

build_pick_assets <- function() {
  picks <- 1:60
  base_value <- ifelse(picks <= 30, 34000000 * exp(-(picks - 1) / 19), 4200000 * exp(-(picks - 31) / 18))
  data.frame(
    asset_id = paste0("pick-", picks),
    label = paste0("Pick ", picks),
    pick = picks,
    round = ifelse(picks <= 30, 1, 2),
    normalized = round(base_value / max(base_value), 3),
    value = round(base_value, 0),
    stringsAsFactors = FALSE
  )
}

build_draft_prospects <- function(base_dir) {
  skill_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv")
  unified_path <- file.path(base_dir, "processed", "draft", "draft_prediction_unified.csv")
  skill <- read_csv_required(skill_path, c("player", "draft_year", "prediction_pool", "OFF_pred", "DEF_pred", "TOTAL_pred"))
  unified <- read_csv_required(unified_path, c("player", "draft_year", "scv_draft", "draft_age", "height_wo_shoes_in", "wingspan_in", "weight_lbs", "pos_code", "pre_draft_team"))
  unified <- unified[!duplicated(paste(unified$player, unified$draft_year)), ]
  x <- merge(skill, unified, by = c("player", "draft_year"), all.x = TRUE)
  x$rank_in_class <- ave(-x$TOTAL_pred, x$draft_year, FUN = rank, ties.method = "first")
  x$score <- ave(x$TOTAL_pred, x$draft_year, FUN = function(v) round(percent_rank(v) * 100, 1))
  x <- x[order(-x$draft_year, x$rank_in_class), ]
  cols <- c(
    "player", "draft_year", "rank_in_class", "score", "prediction_pool", "scv_draft",
    "draft_age", "height_wo_shoes_in", "wingspan_in", "weight_lbs", "pos_code", "pre_draft_team",
    "FTD_pred", "OREB_pred", "PASS_pred", "RIM_pred", "SHOOT_pred", "DPM_pred", "DREB_pred",
    "RIMPRO_pred", "SWITCH_pred", "OFF_pred", "DEF_pred", "TOTAL_pred"
  )
  x[, intersect(cols, names(x)), drop = FALSE]
}

base_dir <- resolve_base_dir()
out_dir <- file.path(base_dir, "frontend", "public", "data")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

players <- build_impact_players(base_dir)
teams <- build_team_projections(players)
picks <- build_pick_assets()
draft <- build_draft_prospects(base_dir)
model_summary <- read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_summary.csv"))
model_details <- read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_feature_details.csv"))

write_json_df(players, file.path(out_dir, "impact_players.json"))
write_json_df(teams, file.path(out_dir, "team_projections.json"))
write_json_df(picks, file.path(out_dir, "pick_assets.json"))
write_json_df(draft, file.path(out_dir, "draft_prospects.json"))
write_json_df(model_summary, file.path(out_dir, "draft_model_summary.json"))
write_json_df(model_details, file.path(out_dir, "draft_model_feature_details.json"))

manifest_rows <- data.frame(
  dataset = c("impact_players", "team_projections", "pick_assets", "draft_prospects", "draft_model_summary", "draft_model_feature_details"),
  rows = c(nrow(players), nrow(teams), nrow(picks), nrow(draft), nrow(model_summary), nrow(model_details)),
  file = c("impact_players.json", "team_projections.json", "pick_assets.json", "draft_prospects.json", "draft_model_summary.json", "draft_model_feature_details.json"),
  stringsAsFactors = FALSE
)

write_json_object(list(
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  source_root = base_dir,
  note = "Generated from canonical processed/raw CSV outputs. Excel workbooks are not read at runtime.",
  datasets = manifest_rows
), file.path(out_dir, "manifest.json"))

message("Frontend data export complete: ", out_dir)
message("Rows: players=", nrow(players), ", teams=", nrow(teams), ", draft=", nrow(draft))
