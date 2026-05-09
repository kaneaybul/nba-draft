if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
library(data.table)

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
  if (!file.exists(path)) stop("Missing required input: ", path)
  out <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  missing <- setdiff(required, names(out))
  if (length(missing) > 0) {
    stop("Missing columns in ", path, ": ", paste(missing, collapse = ", "))
  }
  out
}

safe_weighted_mean <- function(value, weight) {
  value <- suppressWarnings(as.numeric(value))
  weight <- suppressWarnings(as.numeric(weight))
  ok <- is.finite(value) & is.finite(weight) & weight > 0
  if (!any(ok)) return(NA_real_)
  sum(value[ok] * weight[ok], na.rm = TRUE) / sum(weight[ok], na.rm = TRUE)
}

z_within <- function(x, group) {
  x <- suppressWarnings(as.numeric(x))
  out <- rep(0, length(x))
  for (g in unique(group)) {
    idx <- which(group == g)
    v <- x[idx]
    mu <- mean(v, na.rm = TRUE)
    sig <- stats::sd(v, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) {
      out[idx] <- 0
    } else {
      out[idx] <- (v - mu) / sig
    }
  }
  out[!is.finite(out)] <- 0
  out
}

safe_sd <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  x <- x[is.finite(x)]
  if (length(x) < 2) return(0)
  out <- stats::sd(x, na.rm = TRUE)
  if (!is.finite(out)) 0 else out
}

score_board_year <- function(actual_dt, rank_col, penalty_base = 0.97, penalty_power = 1.25, rank_cap = 60, unranked_rank = 65) {
  ranks <- suppressWarnings(as.numeric(actual_dt[[rank_col]]))
  eval_rank <- ifelse(is.finite(ranks), pmin(ranks, rank_cap), unranked_rank)
  actual_rank <- suppressWarnings(as.numeric(actual_dt$actual_rank))
  accuracy <- penalty_base ^ (abs(actual_rank - eval_rank) ^ penalty_power)
  sum(actual_dt$actual_weight * accuracy, na.rm = TRUE)
}

score_board_prospects <- function(actual_dt, rank_dt, board_name, rank_col = "board_rank", penalty_base = 0.97, penalty_power = 1.25, rank_cap = 60, unranked_rank = 65) {
  ranks <- copy(rank_dt)
  if (!(rank_col %in% names(ranks))) {
    ranks[, (rank_col) := NA_real_]
  }
  ranks <- ranks[, .(
    draft_year = as.integer(draft_year),
    name_key = as.character(name_key),
    board_rank = suppressWarnings(as.numeric(get(rank_col)))
  )]

  rows <- merge(
    actual_dt,
    ranks,
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  rows[, board := board_name]
  rows[, eval_rank := fifelse(is.finite(board_rank), pmin(board_rank, rank_cap), unranked_rank)]
  rows[, rank_error := abs(actual_rank - eval_rank)]
  rows[, correct_pct := 100 * (penalty_base ^ (rank_error ^ penalty_power))]
  rows[, weighted_score_contribution := actual_weight * correct_pct / 100]
  rows[]
}

build_tracker_prospect_scores <- function(actual, tracker_boards, panel, all_scores, years) {
  actual_small <- actual[draft_year %in% years, .(
    draft_year,
    name_key,
    player,
    nba_id,
    actual_pick,
    college,
    actual_rank,
    actual_weight,
    career_minutes,
    actual_impact,
    actual_score
  )]

  out <- list()
  board_years <- unique(tracker_boards[draft_year %in% years, .(draft_year, board)])
  if (nrow(board_years) > 0) {
    board_skeleton <- merge(
      actual_small,
      board_years,
      by = "draft_year",
      allow.cartesian = TRUE,
      sort = FALSE
    )
    board_ranks <- tracker_boards[draft_year %in% years, .(
      draft_year,
      name_key,
      board,
      board_rank = suppressWarnings(as.numeric(board_rank))
    )]
    board_rows <- merge(
      board_skeleton,
      board_ranks,
      by = c("draft_year", "name_key", "board"),
      all.x = TRUE,
      sort = FALSE
    )
    board_rows[, eval_rank := fifelse(is.finite(board_rank), pmin(board_rank, 60), 65)]
    board_rows[, rank_error := abs(actual_rank - eval_rank)]
    board_rows[, correct_pct := 100 * (0.97 ^ (rank_error ^ 1.25))]
    board_rows[, weighted_score_contribution := actual_weight * correct_pct / 100]
    out[[length(out) + 1L]] <- board_rows
  }

  out[[length(out) + 1L]] <- score_board_prospects(
    actual_small,
    actual_small[, .(draft_year, name_key, board_rank = actual_pick)],
    "NBA Draft - Actual"
  )
  out[[length(out) + 1L]] <- score_board_prospects(
    actual_small,
    panel[draft_year %in% years, .(draft_year, name_key, board_rank = base_rank)],
    "SCV Base Model"
  )
  out[[length(out) + 1L]] <- score_board_prospects(
    actual_small,
    panel[draft_year %in% years, .(draft_year, name_key, board_rank = FINAL_rank)],
    "SCV Adjusted Model"
  )

  rows <- rbindlist(out, use.names = TRUE, fill = TRUE)
  rows <- merge(
    rows,
    all_scores[, .(draft_year, board, board_year_score = score, board_year_z = z_score)],
    by = c("draft_year", "board"),
    all.x = TRUE,
    sort = FALSE
  )
  rows[, model_group := fifelse(board == "SCV Adjusted Model", "current",
    fifelse(board == "SCV Base Model", "base",
      fifelse(board == "Legacy Me Model", "legacy", "external")
    )
  )]
  rows[, display_board := fifelse(board == "SCV Adjusted Model", "SCV Current Model", board)]
  setorder(rows, -draft_year, actual_rank, display_board)
  rows[]
}

read_csv_optional <- function(path) {
  if (!file.exists(path)) return(data.table())
  tryCatch(
    fread(path, na.strings = c("", "NA", "N/A", "NaN")),
    error = function(e) data.table()
  )
}

load_scv_draft_reference <- function(base_dir) {
  path <- file.path(base_dir, "ref", "scvardraft.csv")
  dt <- read_csv_optional(path)
  if (!nrow(dt) || !"name" %in% names(dt)) {
    return(data.table(name_key = character(), scv_draft_ref = numeric()))
  }
  score_col <- names(dt)[tolower(names(dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(data.table(name_key = character(), scv_draft_ref = numeric()))
  }
  dt[, name_key := normalize_name(name)]
  dt[, scv_draft_ref := suppressWarnings(as.numeric(get(score_col)))]
  dt <- dt[nzchar(name_key) & is.finite(scv_draft_ref)]
  unique(dt[, .(name_key, scv_draft_ref)], by = "name_key")
}

load_realgm_draft_bio_reference <- function(base_dir) {
  paths <- c(
    file.path(base_dir, "processed", "draft", "no_college_realgm_draft_map.csv"),
    file.path(base_dir, "processed", "draft", "draft_no_college_all_classes.csv")
  )
  parts <- lapply(paths, function(path) {
    dt <- read_csv_optional(path)
    if (!nrow(dt) || !all(c("player", "draft_year", "age") %in% names(dt))) {
      return(data.table(draft_year = integer(), name_key = character(), draft_age_ref = numeric()))
    }
    dt
  })
  dt <- rbindlist(parts, use.names = TRUE, fill = TRUE)
  if (!nrow(dt)) {
    return(data.table(draft_year = integer(), name_key = character(), draft_age_ref = numeric()))
  }
  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt[, name_key := normalize_name(player)]
  dt[, draft_age_ref := suppressWarnings(as.numeric(age))]
  dt <- dt[is.finite(draft_year) & nzchar(name_key) & is.finite(draft_age_ref)]
  setorder(dt, draft_year, name_key)
  unique(dt[, .(draft_year, name_key, draft_age_ref)], by = c("draft_year", "name_key"))
}

build_presence_index <- function(path) {
  dt <- read_csv_optional(path)
  if (!nrow(dt) || !"player" %in% names(dt) || !"draft_year" %in% names(dt)) {
    return(data.table(
      draft_year = integer(),
      name_key = character(),
      present = logical(),
      names_seen = character()
    ))
  }

  dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  dt[, name_key := normalize_name(player)]
  dt <- dt[is.finite(draft_year) & nzchar(name_key)]
  if (!nrow(dt)) {
    return(data.table(
      draft_year = integer(),
      name_key = character(),
      present = logical(),
      names_seen = character()
    ))
  }

  dt[, .(
    present = TRUE,
    names_seen = paste(sort(unique(as.character(player))), collapse = " | ")
  ), by = .(draft_year, name_key)]
}

build_missing_actuals_audit <- function(base_dir, actual, prospect_scores, years, brendan_board = "SCV Adjusted Model") {
  draft_dir <- file.path(base_dir, "processed", "draft")
  actual_rows <- copy(actual[draft_year %in% years])
  actual_rows[, name_key := as.character(name_key)]

  source_idx <- build_presence_index(file.path(draft_dir, "draft_prediction_unified.csv"))
  setnames(source_idx, c("present", "names_seen"), c("in_prediction_source", "prediction_source_names"))
  prediction_idx <- build_presence_index(file.path(draft_dir, "draft_skill_predictions_output.csv"))
  setnames(prediction_idx, c("present", "names_seen"), c("in_model_predictions", "model_prediction_names"))

  brendan_rows <- prospect_scores[board == brendan_board, .(
    draft_year,
    name_key,
    brendan_adj_rank = board_rank,
    brendan_adj_eval_rank = eval_rank,
    brendan_adj_rank_error = rank_error,
    brendan_adj_correct_pct = correct_pct
  )]

  out <- merge(
    actual_rows[, .(
      draft_year,
      name_key,
      player,
      nba_id,
      actual_pick,
      actual_rank,
      actual_weight,
      career_minutes,
      actual_impact
    )],
    source_idx,
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  out <- merge(out, prediction_idx, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  out <- merge(out, brendan_rows, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)

  out[is.na(in_prediction_source), in_prediction_source := FALSE]
  out[is.na(in_model_predictions), in_model_predictions := FALSE]
  out[, unranked_by_brendan_adj := !is.finite(suppressWarnings(as.numeric(brendan_adj_rank)))]
  out[, missing_reason := fifelse(
    !in_prediction_source,
    "missing_from_prediction_source",
    fifelse(
      !in_model_predictions,
      "missing_from_model_predictions",
      fifelse(unranked_by_brendan_adj, "unranked_by_brendan_adj", "ranked")
    )
  )]
  setorder(out, draft_year, actual_pick, actual_rank)
  out[]
}

year_weight <- function(year, latest_impact_year) {
  pmin(5, pmax(1, latest_impact_year - year))
}

build_actual_outcomes <- function(base_dir, latest_impact_year) {
  impact <- read_csv_required(
    file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"),
    c("nba_id", "player_name", "year", "Minutes", "o_epm", "d_epm", "o_dpm", "d_dpm")
  )
  training <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_training_data.csv"),
    c("player", "draft_year", "nba_id")
  )
  picks <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv"),
    c("player", "draft_year", "pick_overall", "college")
  )

  id_map <- unique(training[is.finite(nba_id), .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    nba_id = as.integer(nba_id)
  )])
  picks_small <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = suppressWarnings(as.numeric(pick_overall)),
    college = as.character(college)
  )])
  id_map[, name_key := normalize_name(player)]
  picks_small[, name_key := normalize_name(player)]
  setorder(picks_small, draft_year, name_key, actual_pick, na.last = TRUE)
  picks_small <- unique(picks_small[, .(draft_year, name_key, pick_player = player, actual_pick, college)], by = c("draft_year", "name_key"))

  impact_name_ids <- unique(impact[is.finite(nba_id), .(
    name_key = normalize_name(player_name),
    nba_id = as.integer(nba_id)
  )])
  impact_name_ids <- impact_name_ids[name_key != "" & is.finite(nba_id)]
  id_counts <- impact_name_ids[, .(id_count = uniqueN(nba_id)), by = name_key]
  impact_name_ids <- unique(merge(impact_name_ids, id_counts, by = "name_key")[id_count == 1, .(name_key, nba_id)])
  pick_id_fallback <- merge(
    picks_small[, .(player = pick_player, draft_year, name_key)],
    impact_name_ids,
    by = "name_key",
    all.x = FALSE,
    sort = FALSE
  )
  pick_id_fallback <- pick_id_fallback[!duplicated(paste(draft_year, name_key))]
  existing_keys <- paste(id_map$draft_year, id_map$name_key)
  pick_id_fallback <- pick_id_fallback[!(paste(draft_year, name_key) %in% existing_keys)]
  if (nrow(pick_id_fallback) > 0) {
    id_map <- rbindlist(list(
      id_map,
      pick_id_fallback[, .(player, draft_year, nba_id, name_key)]
    ), use.names = TRUE, fill = TRUE)
  }
  id_map <- merge(id_map, picks_small, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)

  impact[, nba_id := as.integer(nba_id)]
  impact[, year := as.integer(year)]
  impact[, Minutes := suppressWarnings(as.numeric(Minutes))]
  impact[, epm_total := suppressWarnings(as.numeric(o_epm)) + suppressWarnings(as.numeric(d_epm))]
  impact[, dpm_total := suppressWarnings(as.numeric(o_dpm)) + suppressWarnings(as.numeric(d_dpm))]

  rows <- merge(
    id_map[, .(player, draft_year, nba_id, actual_pick, college, name_key)],
    impact,
    by = "nba_id",
    allow.cartesian = TRUE,
    sort = FALSE
  )
  rows <- rows[year >= draft_year + 1 & year <= latest_impact_year]

  outcome <- rows[, .(
    career_minutes = sum(Minutes, na.rm = TRUE),
    career_epm = safe_weighted_mean(epm_total, Minutes),
    career_dpm = safe_weighted_mean(dpm_total, Minutes),
    seasons = uniqueN(year[is.finite(Minutes) & Minutes > 0])
  ), by = .(player, draft_year, nba_id, actual_pick, college, name_key)]
  outcome[, actual_impact := rowMeans(cbind(career_epm, career_dpm), na.rm = TRUE)]
  outcome[!is.finite(actual_impact), actual_impact := NA_real_]

  outcome <- outcome[is.finite(actual_impact) & is.finite(career_minutes)]
  outcome[, class_max_minutes := max(career_minutes, na.rm = TRUE), by = draft_year]
  outcome[, class_floor_impact := min(actual_impact, na.rm = TRUE) - 0.05, by = draft_year]
  outcome[, minutes_share := sqrt(pmax(0, career_minutes) / pmax(1, class_max_minutes))]
  outcome[, blended_impact := actual_impact * minutes_share + class_floor_impact * (1 - minutes_share)]
  outcome[, actual_score := pmax(0, blended_impact - class_floor_impact) ^ 1.35]
  outcome[, actual_weight := actual_score / sum(actual_score, na.rm = TRUE), by = draft_year]
  outcome[, actual_rank := frank(-actual_score, ties.method = "first"), by = draft_year]
  setorder(outcome, draft_year, actual_rank)
  outcome[]
}

read_tracker_workbook_boards <- function(base_dir, years) {
  workbook <- file.path(base_dir, "ref", "oldfrontend", "NBA Draft Tracker.xlsx")
  if (!file.exists(workbook) || !requireNamespace("openxlsx", quietly = TRUE)) {
    return(data.table())
  }

  name_map <- c(
    Jwass = "Jonathan Wasserman",
    NBADraftRoom = "NBA Draft Room",
    `Sam Vecenie` = "Sam Vecenie",
    `Jonathan Givony` = "Jonathan Givony",
    `NBADraft.net` = "NBADraft.net",
    `Jeremy Woo` = "Jeremy Woo",
    KOC = "Kevin O'Connor",
    HI = "Hoop Intellect",
    Me.Model = "Legacy Me Model"
  )

  out <- list()
  for (year in years) {
    raw <- tryCatch(
      openxlsx::read.xlsx(workbook, sheet = as.character(year), rows = 1:90, cols = 1:31, colNames = FALSE),
      error = function(e) NULL
    )
    if (is.null(raw) || nrow(raw) < 2) next
    headers <- as.character(unlist(raw[1, ], use.names = FALSE))
    body <- as.data.table(raw[-1, ])
    names(body) <- make.names(headers, unique = TRUE)
    name_col <- names(body)[tolower(names(body)) %in% c("name", "x.na.", "x.na..1")][1]
    if (is.na(name_col)) {
      name_col <- names(body)[3]
    }
    body[, player := as.character(get(name_col))]
    body <- body[!is.na(player) & player != ""]
    for (col in intersect(names(name_map), names(body))) {
      out[[length(out) + 1L]] <- data.table(
        draft_year = as.integer(year),
        player = body$player,
        board = unname(name_map[[col]]),
        board_rank = suppressWarnings(as.numeric(body[[col]]))
      )
    }
  }
  if (!length(out)) return(data.table())
  rbindlist(out, use.names = TRUE, fill = TRUE)
}

make_prediction_panel <- function(base_dir) {
  pred <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_skill_predictions_output.csv"),
    c("player", "draft_year", "OFF_pred", "DEF_pred", "TOTAL_pred")
  )
  source <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_prediction_unified.csv"),
    c("player", "draft_year", "draft_age", "big_board_rank", "scv_draft")
  )
  picks <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv"),
    c("player", "draft_year", "pick_overall")
  )

  source <- unique(source[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    draft_age = suppressWarnings(as.numeric(draft_age)),
    big_board_rank = suppressWarnings(as.numeric(big_board_rank)),
    scv_draft = suppressWarnings(as.numeric(scv_draft))
  )])
  picks <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = suppressWarnings(as.numeric(pick_overall))
  )])
  pred[, player := as.character(player)]
  pred[, draft_year := as.integer(draft_year)]
  pred <- merge(pred, source, by = c("player", "draft_year"), all.x = TRUE, sort = FALSE)
  pred[, name_key := normalize_name(player)]
  scv_ref <- load_scv_draft_reference(base_dir)
  if (nrow(scv_ref)) {
    pred <- merge(pred, scv_ref, by = "name_key", all.x = TRUE, sort = FALSE)
    pred[, scv_draft := fifelse(is.finite(scv_draft), scv_draft, scv_draft_ref)]
    pred[, scv_draft_ref := NULL]
  }
  realgm_bio <- load_realgm_draft_bio_reference(base_dir)
  if (nrow(realgm_bio)) {
    pred <- merge(pred, realgm_bio, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
    pred[, draft_age := fifelse(is.finite(draft_age), draft_age, draft_age_ref)]
    pred[, draft_age_ref := NULL]
  }
  picks[, name_key := normalize_name(player)]
  setorder(picks, draft_year, name_key, actual_pick, na.last = TRUE)
  picks <- unique(picks[, .(draft_year, name_key, actual_pick)], by = c("draft_year", "name_key"))
  pred <- merge(pred, picks, by = c("draft_year", "name_key"), all.x = TRUE, sort = FALSE)
  pred[, pick_proxy := fifelse(is.finite(actual_pick), actual_pick, big_board_rank)]
  pred[, pick_proxy_available := is.finite(pick_proxy)]
  pred[, pick_proxy := fifelse(is.finite(pick_proxy), pick_proxy, 60)]
  pred[, age_feature := -z_within(draft_age, draft_year)]
  pred[, pick_feature := -z_within(log1p(pick_proxy), draft_year)]
  pred[, base_rank := frank(-TOTAL_pred, ties.method = "first"), by = draft_year]
  pred[]
}

load_skill_sides <- function(base_dir) {
  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  fallback <- list(
    offense = c("FTD", "OREB", "PASS", "RIM", "SHOOT"),
    defense = c("DPM", "DREB", "RIMPRO", "SWITCH")
  )
  skillmap_path <- file.path(base_dir, "ref", "skillmap.csv")
  if (!file.exists(skillmap_path)) return(fallback)

  skillmap <- tryCatch(fread(skillmap_path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
  if (is.null(skillmap) || !("VAR" %in% names(skillmap))) return(fallback)

  skill_cols <- intersect(skill_names, setdiff(names(skillmap), "VAR"))
  off_row <- skillmap[VAR == "Offense?"]
  def_row <- skillmap[VAR == "Defense?"]
  offense <- skill_cols[vapply(skill_cols, function(skill) {
    nrow(off_row) == 1L && isTRUE(suppressWarnings(as.numeric(off_row[[skill]][1])) == 1)
  }, logical(1))]
  defense <- skill_cols[vapply(skill_cols, function(skill) {
    nrow(def_row) == 1L && isTRUE(suppressWarnings(as.numeric(def_row[[skill]][1])) == 1)
  }, logical(1))]

  list(
    offense = if (length(offense)) offense else fallback$offense,
    defense = if (length(defense)) defense else fallback$defense
  )
}

make_skill_adjustment_weights <- function(dt, skills) {
  raw_cols <- intersect(paste0(skills, "_raw_pred"), names(dt))
  if (!length(raw_cols)) return(data.table(draft_year = unique(dt$draft_year)))

  skill_names <- sub("_raw_pred$", "", raw_cols)
  dt[, {
    spreads <- vapply(raw_cols, function(col) safe_sd(get(col)), numeric(1))
    spread_sum <- sum(spreads, na.rm = TRUE)
    weights <- if (is.finite(spread_sum) && spread_sum > 0) {
      spreads / spread_sum
    } else {
      rep(1 / length(raw_cols), length(raw_cols))
    }
    as.list(setNames(weights, paste0("adjustment_", skill_names, "_weight")))
  }, by = draft_year]
}

apply_final_adjustment_spread <- function(panel, best, base_dir) {
  panel <- copy(panel)
  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  skill_sides <- load_skill_sides(base_dir)

  panel[, adjustment_age_component := best$b_age * age_feature]
  panel[, adjustment_pick_component := best$b_pick * pick_feature]
  panel[, adjustment_total_component := adjustment_age_component + adjustment_pick_component]

  panel[, class_off_sd := safe_sd(OFF_pred), by = draft_year]
  panel[, class_def_sd := safe_sd(DEF_pred), by = draft_year]
  panel[, class_side_sd_sum := class_off_sd + class_def_sd]
  panel[, adjustment_off_weight := fifelse(is.finite(class_side_sd_sum) & class_side_sd_sum > 0, class_off_sd / class_side_sd_sum, 0.5)]
  panel[, adjustment_def_weight := 1 - adjustment_off_weight]
  panel[, adjustment_off_component := adjustment_total_component * adjustment_off_weight]
  panel[, adjustment_def_component := adjustment_total_component * adjustment_def_weight]
  panel[, FINAL_OFF_pred := OFF_pred + adjustment_off_component]
  panel[, FINAL_DEF_pred := DEF_pred + adjustment_def_component]
  panel[, FINAL_TOTAL_pred := FINAL_OFF_pred + FINAL_DEF_pred]

  off_weights <- make_skill_adjustment_weights(panel, skill_sides$offense)
  def_weights <- make_skill_adjustment_weights(panel, skill_sides$defense)
  panel <- merge(panel, off_weights, by = "draft_year", all.x = TRUE, sort = FALSE)
  panel <- merge(panel, def_weights, by = "draft_year", all.x = TRUE, sort = FALSE)

  for (skill in skill_names) {
    raw_col <- paste0(skill, "_raw_pred")
    if (!(raw_col %in% names(panel))) next

    final_raw_col <- paste0("FINAL_", skill, "_raw_pred")
    final_pred_col <- paste0("FINAL_", skill, "_pred")
    weight_col <- paste0("adjustment_", skill, "_weight")
    component_col <- paste0("adjustment_", skill, "_component")
    side_component_col <- if (skill %in% skill_sides$offense) "adjustment_off_component" else "adjustment_def_component"

    if (!(weight_col %in% names(panel))) {
      panel[, (weight_col) := 0]
    }
    panel[!is.finite(get(weight_col)), (weight_col) := 0]
    panel[, (component_col) := get(side_component_col) * get(weight_col)]
    panel[, (final_raw_col) := get(raw_col) + get(component_col)]
    panel[, (final_pred_col) := z_within(get(final_raw_col), draft_year)]
  }

  cleanup_cols <- c("class_off_sd", "class_def_sd", "class_side_sd_sum")
  panel[, (intersect(cleanup_cols, names(panel))) := NULL]
  panel[, FINAL_rank := frank(-FINAL_TOTAL_pred, ties.method = "first"), by = draft_year]
  panel[, tracker_adjustment_version := "tracker_v1_career_epm_dpm_sd_spread"]
  panel[]
}

score_model_candidate <- function(panel, actual, external_scores, b_age, b_pick, years, latest_impact_year) {
  work <- copy(panel[draft_year %in% years])
  work[, candidate_total := TOTAL_pred + b_age * age_feature + b_pick * pick_feature]
  work[, candidate_rank := frank(-candidate_total, ties.method = "first"), by = draft_year]
  scored <- merge(
    actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
    work[, .(draft_year, name_key, candidate_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )

  rows <- scored[, .(score = score_board_year(.SD, "candidate_rank")), by = draft_year]
  rows[, year_weight := year_weight(draft_year, latest_impact_year)]
  rows[, z_score := {
    ext <- external_scores[draft_year == .BY$draft_year & is.finite(score), score]
    vals <- c(ext, score)
    sig <- stats::sd(vals, na.rm = TRUE)
    if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(vals, na.rm = TRUE)) / sig
  }, by = draft_year]
  list(
    mean_score = weighted.mean(rows$score, rows$year_weight, na.rm = TRUE),
    mean_z = weighted.mean(rows$z_score, rows$year_weight, na.rm = TRUE),
    year_scores = rows
  )
}

fit_adjustment <- function(panel, actual, external_scores, fit_years, latest_impact_year) {
  grid_step <- suppressWarnings(as.numeric(Sys.getenv("DRAFT_TRACKER_GRID_STEP", "0.025")))
  if (!is.finite(grid_step) || grid_step <= 0 || grid_step > 0.25) grid_step <- 0.025
  grid <- CJ(
    b_age = seq(-1.2, 1.2, by = grid_step),
    b_pick = seq(-1.2, 1.2, by = grid_step)
  )
  rows <- vector("list", nrow(grid))
  for (i in seq_len(nrow(grid))) {
    candidate <- score_model_candidate(panel, actual, external_scores, grid$b_age[i], grid$b_pick[i], fit_years, latest_impact_year)
    rows[[i]] <- data.table(
      b_age = grid$b_age[i],
      b_pick = grid$b_pick[i],
      mean_score = candidate$mean_score,
      mean_z = candidate$mean_z,
      objective = candidate$mean_z - 0.03 * (grid$b_age[i]^2 + grid$b_pick[i]^2)
    )
  }
  results <- rbindlist(rows)
  setorder(results, -objective, -mean_z, -mean_score)
  best <- results[1]

  loyo <- rbindlist(lapply(fit_years, function(left_out) {
    train_years <- setdiff(fit_years, left_out)
    train_results <- copy(results)
    # Re-score only the top local neighborhood for speed and stability.
    local_grid <- train_results[abs(b_age - best$b_age) <= 0.25 & abs(b_pick - best$b_pick) <= 0.25, .(b_age, b_pick)]
    if (!nrow(local_grid)) local_grid <- results[1:50, .(b_age, b_pick)]
    train_rows <- lapply(seq_len(nrow(local_grid)), function(i) {
      candidate <- score_model_candidate(panel, actual, external_scores, local_grid$b_age[i], local_grid$b_pick[i], train_years, latest_impact_year)
      data.table(
        b_age = local_grid$b_age[i],
        b_pick = local_grid$b_pick[i],
        train_z = candidate$mean_z - 0.03 * (local_grid$b_age[i]^2 + local_grid$b_pick[i]^2)
      )
    })
    train_best <- rbindlist(train_rows)[order(-train_z)][1]
    test <- score_model_candidate(panel, actual, external_scores, train_best$b_age, train_best$b_pick, left_out, latest_impact_year)
    data.table(
      left_out_year = left_out,
      b_age = train_best$b_age,
      b_pick = train_best$b_pick,
      heldout_score = test$mean_score,
      heldout_z = test$mean_z
    )
  }))

  list(best = best, grid = results, loyo = loyo)
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

latest_impact_year <- max(fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year, na.rm = TRUE)
fit_years <- as.integer(strsplit(Sys.getenv("DRAFT_TRACKER_FIT_YEARS", "2016,2017,2018,2019,2020,2021,2022"), ",")[[1]])
fit_years <- fit_years[is.finite(fit_years)]

actual <- build_actual_outcomes(base_dir, latest_impact_year)
panel <- make_prediction_panel(base_dir)

tracker_boards <- read_tracker_workbook_boards(base_dir, fit_years)
tracker_boards[, name_key := normalize_name(player)]
tracker_joined <- merge(
  actual[, .(draft_year, name_key, actual_rank, actual_weight)],
  tracker_boards[, .(draft_year, name_key, board, board_rank)],
  by = c("draft_year", "name_key"),
  all.x = TRUE,
  allow.cartesian = TRUE,
  sort = FALSE
)
external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]

actual_pick_scores <- actual[draft_year %in% fit_years, .(score = score_board_year(.SD, "actual_pick")), by = draft_year]
actual_pick_scores[, board := "NBA Draft - Actual"]
external_scores <- rbindlist(list(external_scores, actual_pick_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)

base_joined <- merge(
  actual[, .(draft_year, name_key, actual_rank, actual_weight)],
  panel[, .(draft_year, name_key, board_rank = base_rank)],
  by = c("draft_year", "name_key"),
  all.x = TRUE,
  sort = FALSE
)
base_scores <- base_joined[draft_year %in% fit_years, .(score = score_board_year(.SD, "board_rank")), by = draft_year]
base_scores[, board := "SCV Base Model"]
external_scores <- rbindlist(list(external_scores, base_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)

fit <- fit_adjustment(panel, actual, external_scores, fit_years, latest_impact_year)
best <- fit$best

panel <- apply_final_adjustment_spread(panel, best, base_dir)

final_joined <- merge(
  actual[, .(draft_year, name_key, actual_rank, actual_weight)],
  panel[, .(draft_year, name_key, board_rank = FINAL_rank)],
  by = c("draft_year", "name_key"),
  all.x = TRUE,
  sort = FALSE
)
final_scores <- final_joined[draft_year %in% fit_years, .(score = score_board_year(.SD, "board_rank")), by = draft_year]
final_scores[, board := "SCV Adjusted Model"]
all_scores <- rbindlist(list(external_scores, final_scores[, .(draft_year, board, score)]), use.names = TRUE, fill = TRUE)
all_scores[, year_weight := year_weight(draft_year, latest_impact_year)]
all_scores[, z_score := {
  sig <- stats::sd(score, na.rm = TRUE)
  if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(score, na.rm = TRUE)) / sig
}, by = draft_year]
summary_scores <- all_scores[, .(
  weighted_score = weighted.mean(score, year_weight, na.rm = TRUE),
  weighted_z = weighted.mean(z_score, year_weight, na.rm = TRUE),
  years = sum(is.finite(score))
), by = board][order(-weighted_z, -weighted_score)]

adjustment <- data.table(
  version = "tracker_v1_career_epm_dpm_sd_spread",
  fit_years = paste(fit_years, collapse = ","),
  latest_impact_year = latest_impact_year,
  penalty_base = 0.97,
  penalty_power = 1.25,
  rank_cap = 60,
  actual_score_note = "Career actual uses minute-weighted EPM total and DPM total, blended with sqrt career-minute share by class, then top-weighted at exponent 1.35. Final adjustment is split to offense/defense and skills by within-class prediction spread.",
  b_age = best$b_age,
  b_pick = best$b_pick,
  in_sample_weighted_score = score_model_candidate(panel, actual, external_scores, best$b_age, best$b_pick, fit_years, latest_impact_year)$mean_score,
  in_sample_weighted_z = best$mean_z
)

fwrite(actual, file.path(draft_dir, "draft_tracker_actuals.csv"), na = "")
fwrite(all_scores[order(board, draft_year)], file.path(draft_dir, "draft_tracker_board_scores.csv"), na = "")
fwrite(summary_scores, file.path(draft_dir, "draft_tracker_board_summary.csv"), na = "")
prospect_scores <- build_tracker_prospect_scores(actual, tracker_boards, panel, all_scores, fit_years)
fwrite(prospect_scores, file.path(draft_dir, "draft_tracker_prospect_scores.csv"), na = "")
missing_actuals_audit <- build_missing_actuals_audit(base_dir, actual, prospect_scores, fit_years)
fwrite(missing_actuals_audit, file.path(draft_dir, "draft_tracker_actuals_audit.csv"), na = "")
fwrite(
  missing_actuals_audit[is.finite(actual_pick) & missing_reason != "ranked"],
  file.path(draft_dir, "draft_tracker_missing_actuals.csv"),
  na = ""
)
fwrite(adjustment, file.path(draft_dir, "draft_tracker_model_adjustment.csv"), na = "")
fwrite(fit$loyo, file.path(draft_dir, "draft_tracker_adjustment_loyo.csv"), na = "")
fwrite(panel, file.path(draft_dir, "draft_skill_predictions_adjusted.csv"), na = "")

message("Draft tracker benchmark complete.")
message("Best adjustment: age=", round(best$b_age, 3), ", pick=", round(best$b_pick, 3), ", weighted z=", round(best$mean_z, 3))
