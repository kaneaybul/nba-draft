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

team_count <- function() 30L

rotation_slots_per_position <- function() {
  2L * team_count()
}

replacement_slots_per_position <- function() {
  rotation_slots_per_position() + ceiling(team_count() / 2)
}

rank_cutoff_value <- function(values, cutoff) {
  values <- sort(values[is.finite(values)], decreasing = TRUE)
  if (length(values) == 0) {
    return(NA_real_)
  }
  values[[min(cutoff, length(values))]]
}

valid_positions <- function() c("PG", "SG", "SF", "PF", "C")

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
  pos <- toupper(as.character(position))

  if (identical(side, "total")) {
    return(replacement_level(pos, "offense") + replacement_level(pos, "defense"))
  }

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

position_parts <- function(position) {
  parts <- strsplit(toupper(as.character(position)), "/", fixed = TRUE)[[1]]
  parts[parts %in% valid_positions()]
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

draft_replacement_total <- function(position, replacement_reference = NULL) {
  from_reference <- replacement_reference_lookup(replacement_reference, position, "total")
  vapply(seq_along(position), function(i) {
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
  cutoff <- replacement_slots_per_position()
  min_sample <- ceiling(rotation_slots_per_position() * 0.75)
  eligible <- !is.na(metric) &
    df$position %in% valid_positions()

  keys <- unique(paste(df$year, df$position, sep = "||"))
  for (key in keys) {
    parts <- strsplit(key, "\\|\\|")[[1]]
    idx <- df$year == as.integer(parts[[1]]) & df$position == parts[[2]]
    values <- metric[idx & eligible]
    if (sum(is.finite(values)) >= min_sample) {
      out[idx] <- rank_cutoff_value(values, cutoff)
    }
  }

  recent_year <- max(df$year, na.rm = TRUE) - 2
  for (pos in valid_positions()) {
    idx <- is.na(out) & df$position == pos
    values <- metric[
      eligible &
        df$position == pos &
        df$year >= recent_year
    ]
    recent_seasons <- unique(df$year[
      eligible &
        df$position == pos &
        df$year >= recent_year
    ])
    pooled_cutoff <- cutoff * max(1, length(recent_seasons))
    if (sum(is.finite(values)) >= min_sample) {
      out[idx] <- rank_cutoff_value(values, pooled_cutoff)
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
  rows <- players[
    players$year == latest_year &
      players$position %in% valid_positions() &
      is.finite(players$replacement_total),
    c("position", "replacement_total"),
    drop = FALSE
  ]
  rows <- rows[!duplicated(rows$position), ]
  missing_pos <- setdiff(valid_positions(), rows$position)
  if (length(missing_pos) > 0) {
    rows <- rbind(
      rows,
      data.frame(position = missing_pos, replacement_total = replacement_level(missing_pos, "total"), stringsAsFactors = FALSE)
    )
  }
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
  if (!("player_name" %in% names(contracts))) contracts$player_name <- NA_character_
  if (!("team" %in% names(contracts))) contracts$team <- NA_character_
  if (!("rank" %in% names(contracts))) contracts$rank <- seq_len(nrow(contracts))
  contracts <- attach_contract_ids_from_history(base_dir, contracts)

  out <- data.frame(
    nba_id = suppressWarnings(as.integer(contracts$nba_id)),
    contract_player_name = as.character(contracts$player_name),
    contract_team = as.character(contracts$team),
    contract = suppressWarnings(as.numeric(contracts$salary_y0)),
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
  }
  out <- out[!is.na(out$nba_id), ]
  out <- out[order(out$nba_id, out$contract_rank, -out$contract), ]
  out <- out[!duplicated(out$nba_id), ]
  out$contract_rank <- NULL
  out
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

  for (i in which(dnq)) {
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
    draft_year = numeric(),
    games = numeric()
  )
  if (file.exists(stats_path)) {
    stats <- read.csv(stats_path, stringsAsFactors = FALSE, check.names = FALSE)
    if (all(c("nba_id", "year", "Pos2") %in% names(stats))) {
      keep <- intersect(c("nba_id", "year", "Pos2", "Age", "draft_year", "GamesPlayed"), names(stats))
      stat_meta <- stats[, keep, drop = FALSE]
      if (!("Age" %in% names(stat_meta))) stat_meta$Age <- NA_real_
      if (!("draft_year" %in% names(stat_meta))) stat_meta$draft_year <- NA_real_
      if (!("GamesPlayed" %in% names(stat_meta))) stat_meta$GamesPlayed <- NA_real_
      names(stat_meta)[names(stat_meta) == "Pos2"] <- "stat_position"
      names(stat_meta)[names(stat_meta) == "Age"] <- "age"
      names(stat_meta)[names(stat_meta) == "GamesPlayed"] <- "games"
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
  contract_reference <- load_contract_reference(base_dir)
  x <- merge(x, contract_reference, by = "nba_id", all.x = TRUE)
  x$player_name <- coalesce_col(x$player_name, x$name)
  x$team <- ifelse(is.na(x$team) | x$team == "", "FA", x$team)
  x$name_key <- normalize_name(x$player_name)
  x <- merge(x, bref_meta, by = c("year", "name_key"), all.x = TRUE)
  x$position <- coalesce_col(x$bref_position, coalesce_col(x$stat_position, x$position))
  x$name_key <- NULL
  x$bref_position <- NULL
  x$position <- ifelse(is.na(x$position) | x$position == "", "UNK", x$position)
  x$age <- suppressWarnings(as.numeric(x$age))
  x$draft_year <- suppressWarnings(as.numeric(x$draft_year))
  x$yoe <- ifelse(!is.na(x$draft_year), pmax(0, x$year - x$draft_year), NA_real_)
  x$games <- suppressWarnings(as.numeric(x$games))
  x$availability_status <- "qualified"
  x$availability_reason <- ""
  x$skill_source <- "current"
  x$skill_source_year <- x$year
  contract_year <- max(x$year, na.rm = TRUE)
  x <- append_latest_contract_inactive_rows(x, contract_reference, contract_year)
  x <- carry_forward_dnq_profiles(x, contract_year)
  x$total <- ifelse(!is.na(x$FINAL_TOTAL), x$FINAL_TOTAL, ifelse(!is.na(x$TOTAL), x$TOTAL, x$off_dep + x$def_dep))
  x$offense <- ifelse(!is.na(x$FINAL_OFF), x$FINAL_OFF, ifelse(!is.na(x$OFF), x$OFF, x$off_dep))
  x$defense <- ifelse(!is.na(x$FINAL_DEF), x$FINAL_DEF, ifelse(!is.na(x$DEF), x$DEF, x$def_dep))
  x$skill_model_off <- x$OFF
  x$skill_model_def <- x$DEF
  x$skill_off_total <- x$skill_model_off
  x$skill_def_total <- x$skill_model_def
  x$contract <- ifelse(x$year == contract_year, x$contract, NA_real_)

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
  x$tier[current_dnq] <- "Out"
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
    contract_col <- paste0("contract_y", horizon)
    x[[paste0("projection_contract_y", horizon)]] <- if (contract_col %in% names(x)) suppressWarnings(as.numeric(x[[contract_col]])) else NA_real_
    x[[paste0("projection_contract_y", horizon)]] <- ifelse(
      x$year == contract_year,
      x[[paste0("projection_contract_y", horizon)]],
      NA_real_
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
  x$source_note <- "Impact uses 40% EPM, 40% DPM, and 20% skill model output. Skill dimensions use a current-season-first 4,000-minute stabilized window with 0.75 per-season prior decay, light draft priors for first-year players, and low-sample shrinkage. Replacement is a position-count cutoff below the top 60 rotation-useful players per position, using the 90th slot as the roster-edge baseline. Raw value live-casts current impact over blended expected minutes; Szn VA is season-produced value above available salary; FA value uses projected TIMIN, salary floors, max caps, market redistribution, and unmodeled roster reserves."

  cols <- c(
    "nba_id", "player_name", "year", "team", "position", "age", "yoe", "games", "Minutes", "p_mpg", "p_usg",
    "o_epm", "o_dpm", "d_epm", "d_dpm", "off_dep", "def_dep", "offense", "defense",
    "total", "replacement_total", "score", "score_label", "score_delta", "tier", "availability_status", "availability_reason",
    "skill_source", "skill_source_year", "timin", "season_value", "raw_minutes", "raw_timin",
    "value", "contract", "value_add", "trade_value",
    "fa_value", "fa_raw_value", "fa_uncapped_value", "fa_min_salary", "fa_max_salary",
    "fa_market_adjustment", "fa_projected_timin", "fa_missing_roster_slots", "fa_is_max",
    "fa_max_tier", "scalability", "skill_model_off", "skill_model_def", "skill_off_total", "skill_def_total",
    "FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB",
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
  adjusted_skill_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_adjusted.csv")
  base_skill_path <- file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv")
  skill_path <- if (file.exists(adjusted_skill_path)) adjusted_skill_path else base_skill_path
  unified_path <- file.path(base_dir, "processed", "draft", "draft_prediction_unified.csv")
  skill <- read_csv_required(skill_path, c("player", "draft_year", "prediction_pool", "OFF_pred", "DEF_pred", "TOTAL_pred"))
  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
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
  unified <- read_csv_required(unified_path, c("player", "draft_year", "scv_draft", "draft_age", "height_wo_shoes_in", "wingspan_in", "weight_lbs", "pos_code", "pre_draft_team"))
  unified <- unified[!duplicated(paste(unified$player, unified$draft_year)), ]
  x <- merge(skill, unified, by = c("player", "draft_year"), all.x = TRUE)
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
  x$college <- coalesce_col(x$college, x$pre_draft_team)
  x$replacement_total <- draft_replacement_total(x$position, replacement_reference)
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
    "replacement_total", "timin", "college", "pre_draft_team",
    paste0(skill_names, "_pred"),
    "OFF_pred", "DEF_pred", "TOTAL_pred",
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
out_dir <- file.path(base_dir, "frontend", "public", "data")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

players <- build_impact_players(base_dir)
teams <- build_team_projections(players)
picks <- build_pick_assets()
latest_impact_year <- max(players$year, na.rm = TRUE)
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
draft <- build_draft_prospects(base_dir, impact_reference, replacement_reference)
tracker <- build_draft_tracker(base_dir)
model_summary <- read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_summary.csv"))
model_details <- read_csv_required(file.path(base_dir, "processed", "draft", "draft_model_feature_details.csv"))

write_json_df(players, file.path(out_dir, "impact_players.json"))
write_json_df(teams, file.path(out_dir, "team_projections.json"))
write_json_df(picks, file.path(out_dir, "pick_assets.json"))
write_json_df(draft, file.path(out_dir, "draft_prospects.json"))
write_json_df(tracker$board_summary, file.path(out_dir, "draft_tracker_board_summary.json"))
write_json_df(tracker$board_scores, file.path(out_dir, "draft_tracker_board_scores.json"))
write_json_df(tracker$prospect_scores, file.path(out_dir, "draft_tracker_prospect_scores.json"))
write_json_df(model_summary, file.path(out_dir, "draft_model_summary.json"))
write_json_df(model_details, file.path(out_dir, "draft_model_feature_details.json"))

manifest_rows <- data.frame(
  dataset = c(
    "impact_players", "team_projections", "pick_assets", "draft_prospects",
    "draft_tracker_board_summary", "draft_tracker_board_scores", "draft_tracker_prospect_scores",
    "draft_model_summary", "draft_model_feature_details"
  ),
  rows = c(
    nrow(players), nrow(teams), nrow(picks), nrow(draft),
    nrow(tracker$board_summary), nrow(tracker$board_scores), nrow(tracker$prospect_scores),
    nrow(model_summary), nrow(model_details)
  ),
  file = c(
    "impact_players.json", "team_projections.json", "pick_assets.json", "draft_prospects.json",
    "draft_tracker_board_summary.json", "draft_tracker_board_scores.json", "draft_tracker_prospect_scores.json",
    "draft_model_summary.json", "draft_model_feature_details.json"
  ),
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
