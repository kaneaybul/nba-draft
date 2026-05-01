library(data.table)

base_dir <- normalizePath(file.path(getwd()), winslash = "/", mustWork = TRUE)
script_path <- file.path(base_dir, "script", "draft", "build_draft_tracker_benchmark.R")
lines <- readLines(script_path, warn = FALSE, encoding = "UTF-8")
cut <- grep("^base_dir <- resolve_base_dir\\(\\)", lines)[1]
eval(parse(text = paste(lines[seq_len(cut - 1)], collapse = "\n")), envir = .GlobalEnv)
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

latest_impact_year <- max(
  fread(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), select = "year")$year,
  na.rm = TRUE
)
actual <- build_actual_outcomes(base_dir, latest_impact_year)
panel <- make_prediction_panel(base_dir)
adj <- fread(file.path(base_dir, "processed", "draft", "draft_tracker_model_adjustment.csv"))

b_age <- adj$b_age[1]
b_pick <- adj$b_pick[1]
fit_years <- as.integer(strsplit(adj$fit_years[1], ",")[[1]])
post_years <- sort(intersect(setdiff(unique(actual$draft_year), fit_years), unique(panel$draft_year)))
post_years <- post_years[post_years > max(fit_years)]

build_name_matched_actual_outcomes <- function(base_dir, latest_impact_year) {
  impact <- read_csv_required(
    file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"),
    c("nba_id", "player_name", "year", "Minutes", "o_epm", "d_epm", "o_dpm", "d_dpm")
  )
  picks <- read_csv_required(
    file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv"),
    c("player", "draft_year", "pick_overall", "college")
  )

  impact[, nba_id := as.integer(nba_id)]
  impact[, year := as.integer(year)]
  impact[, name_key := normalize_name(player_name)]
  id_names <- unique(impact[is.finite(nba_id) & name_key != "", .(name_key, nba_id)])
  id_names[, id_count := uniqueN(nba_id), by = name_key]
  id_names <- unique(id_names[id_count == 1, .(name_key, nba_id)])

  picks_small <- unique(picks[, .(
    player = as.character(player),
    draft_year = as.integer(draft_year),
    actual_pick = suppressWarnings(as.numeric(pick_overall)),
    college = as.character(college),
    name_key = normalize_name(player)
  )])
  id_map <- merge(picks_small, id_names, by = "name_key", all.x = FALSE, sort = FALSE)

  impact[, Minutes := suppressWarnings(as.numeric(Minutes))]
  impact[, epm_total := suppressWarnings(as.numeric(o_epm)) + suppressWarnings(as.numeric(d_epm))]
  impact[, dpm_total := suppressWarnings(as.numeric(o_dpm)) + suppressWarnings(as.numeric(d_dpm))]
  rows <- merge(id_map, impact[, !"name_key"], by = "nba_id", allow.cartesian = TRUE, sort = FALSE)
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

if (!length(post_years)) {
  actual <- build_name_matched_actual_outcomes(base_dir, latest_impact_year)
  post_years <- sort(intersect(setdiff(unique(actual$draft_year), fit_years), unique(panel$draft_year)))
  post_years <- post_years[post_years > max(fit_years)]
}

score_rank_panel <- function(rank_col, label, years) {
  joined <- merge(
    actual[draft_year %in% years, .(draft_year, name_key, actual_rank, actual_weight)],
    panel[draft_year %in% years, .(draft_year, name_key, rank = get(rank_col))],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    sort = FALSE
  )
  out <- joined[, .(score = score_board_year(.SD, "rank")), by = draft_year]
  out[, board := label]
  out
}

panel[, candidate_total := TOTAL_pred + b_age * age_feature + b_pick * pick_feature]
panel[, candidate_rank := frank(-candidate_total, ties.method = "first"), by = draft_year]

base_scores <- score_rank_panel("base_rank", "SCV Base Model", post_years)
adj_scores <- score_rank_panel("candidate_rank", "SCV Adjusted Model", post_years)
actual_pick_scores <- actual[draft_year %in% post_years, .(score = score_board_year(.SD, "actual_pick")), by = draft_year]
actual_pick_scores[, board := "NBA Draft - Actual"]

boards <- read_tracker_workbook_boards(base_dir, post_years)
if (nrow(boards)) {
  boards[, name_key := normalize_name(player)]
  tracker_joined <- merge(
    actual[draft_year %in% post_years, .(draft_year, name_key, actual_rank, actual_weight)],
    boards[, .(draft_year, name_key, board, board_rank)],
    by = c("draft_year", "name_key"),
    all.x = TRUE,
    allow.cartesian = TRUE,
    sort = FALSE
  )
  external_scores <- tracker_joined[!is.na(board), .(score = score_board_year(.SD, "board_rank")), by = .(draft_year, board)]
} else {
  external_scores <- data.table()
}

all_scores <- rbindlist(
  list(
    external_scores,
    actual_pick_scores[, .(draft_year, board, score)],
    base_scores[, .(draft_year, board, score)],
    adj_scores[, .(draft_year, board, score)]
  ),
  use.names = TRUE,
  fill = TRUE
)
all_scores <- all_scores[is.finite(score)]
all_scores[, z_score := {
  sig <- sd(score, na.rm = TRUE)
  if (!is.finite(sig) || sig == 0) NA_real_ else (score - mean(score, na.rm = TRUE)) / sig
}, by = draft_year]
all_scores[, year_weight := year_weight(draft_year, latest_impact_year)]

summary_scores <- all_scores[, .(
  weighted_score = weighted.mean(score, year_weight, na.rm = TRUE),
  weighted_z = weighted.mean(z_score, year_weight, na.rm = TRUE),
  years = .N
), by = board][order(-weighted_z, -weighted_score)]

cat("latest_impact_year=", latest_impact_year, "\n", sep = "")
cat("fit_years=", paste(fit_years, collapse = ","), "\n", sep = "")
cat("post_years=", paste(post_years, collapse = ","), "\n\n", sep = "")
cat("Summary:\n")
print(summary_scores)
cat("\nYear scores:\n")
print(all_scores[order(draft_year, -z_score, -score)])
cat("\nYaxel/Richie current rows:\n")
print(panel[grepl("yaxel|saunders|richie", tolower(player)), .(
  draft_year, player, draft_age, scv_draft, big_board_rank, TOTAL_pred, base_rank,
  age_feature, pick_feature, candidate_total, candidate_rank,
  adjustment_age = b_age * age_feature,
  adjustment_pick = b_pick * pick_feature
)])
