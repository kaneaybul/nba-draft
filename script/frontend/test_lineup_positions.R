# Load definitions only: tests must not launch a scrape, export or model refresh.
load_functions <- function(path, env) {
  for (expr in parse(path)) {
    if (is.call(expr) && identical(expr[[1]], as.name("<-")) && length(expr) == 3L &&
        is.call(expr[[3]]) && identical(expr[[3]][[1]], as.name("function"))) {
      eval(expr, envir = env)
    }
  }
}

model <- new.env(parent = globalenv())
load_functions("script/frontend/export_frontend_data.R", model)
scraper <- new.env(parent = globalenv())
load_functions("script/data/pull_spotrac_current_rosters.R", scraper)

# Fresh roster fallback must keep its provider identity and must never create
# Spotrac salary claims from ESPN's roster-only data.
espn_fixture <- list(season = list(year = 2027), team = list(displayName = "New Orleans Pelicans"),
  athletes = lapply(seq_len(10), function(i) list(displayName = paste("Fallback Player", i), age = 23,
    position = list(abbreviation = "F"))))
espn_rows <- scraper$espn_roster_rows(espn_fixture, data.frame(team = "New Orleans Pelicans", abbr = "NOP"),
  scraper$season_labels(2026L), "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/3/roster?season=2027", "2026-10-19T04:00:00Z")
espn_rows$nba_id <- seq_len(10)
espn_rows$name_key <- scraper$normalize_name(espn_rows$player_or_entity)
stopifnot(nrow(espn_rows) == 10L, all(espn_rows$source_first_season == "2026-27"))
stopifnot(!nrow(scraper$build_spotrac_contract_export(espn_rows, 2026L, scraper$season_labels(2026L))))
espn_truth <- scraper$build_current_roster_truth(espn_rows, 2026L, scraper$season_labels(2026L))
stopifnot(all(espn_truth$team == "NOP"), all(espn_truth$roster_source == "ESPN Active Roster"))

# Nicknames and formal names must resolve symmetrically to the existing NBA
# identity, including aliases already used by the cached model/contract data.
universe <- data.frame(nba_id = c(1630529L, 1642353L, 1641713L, 1641842L),
  player_name = c("Herbert Jones", "Cam Christie", "GG Jackson", "Ronald Holland II"))
universe$name_key <- scraper$normalize_name(universe$player_name)
matched <- scraper$match_spotrac_players(data.frame(player_or_entity =
  c("Herb Jones", "Cameron Christie", "G.G. Jackson", "Ron Holland II")), universe, scraper$read_aliases("."))
stopifnot(identical(matched$nba_id, universe$nba_id), all(matched$match_confidence == 1))

fixture <- function(positions, totals = seq_along(positions), passing = 0, shooting = 0, rimpro = 0, rebounding = 0) {
  n <- length(positions)
  rows <- data.frame(year = 2027L, team = "TEST", nba_id = seq_len(n), player_name = paste0("Player ", seq_len(n)),
    position = positions, total = totals, Minutes = 1500, PASS = passing, SHOOT = shooting, RIMPRO = rimpro,
    DREB = rebounding, stringsAsFactors = FALSE)
  for (skill in setdiff(model$lineup_skill_names(), names(rows))) rows[[skill]] <- 0
  rows
}

pick <- function(rows) {
  candidates <- model$build_lineup_candidate_set(rows)
  result <- model$estimate_team_lineup_rows(rows, candidates, model$lineup_skill_benchmarks(list(candidates)))
  starters <- result[result$is_starter, , drop = FALSE]
  stopifnot(nrow(starters) == min(5L, nrow(rows)), !anyDuplicated(starters$nba_id), !anyDuplicated(starters$lineup_position))
  starters
}

# An extra highly rated forward must not displace the only point guard.
rows <- fixture(c("PG", "SG", "SF", "PF", "C", "PF"), c(-1, 3, 4, 5, 6, 7))
rows[1, model$lineup_skill_names()] <- -4
starters <- pick(rows)
stopifnot(1L %in% starters$nba_id, !any(starters$lineup_position_fallback), all(c(4L, 5L, 6L) %in% starters$nba_id) == FALSE)

# Positional completeness takes priority over incompatible three-center locks.
rows <- fixture(c("PG", "SG", "SF", "PF", "C", "C", "C"), c(0, 0, 0, 0, 7, 6, 5))
starters <- pick(rows)
stopifnot(sum(starters$position == "C") == 1, 5L %in% starters$nba_id, all(starters$lineup_star_lock_relaxed))

# A dual-position player cannot fill PG and SF at the same time.
rows <- fixture(c("PG/SF", "PF", "PF", "C", "C", "SG", "SF"), c(6, 5, 4, 3, 2, -1, -2))
starters <- pick(rows)
stopifnot(6L %in% starters$nba_id, 7L %in% starters$nba_id, !any(starters$lineup_position_fallback))

# A genuine point forward can organize a five without a nominal PG.
rows <- fixture(c("SF", "SG", "SF", "PF", "C"), c(6, 2, 3, 4, 5), passing = c(2, 0, 0, 0, 3))
starters <- pick(rows)
stopifnot(starters$lineup_position[starters$nba_id == 1] == "PG", !any(starters$lineup_position_fallback))
stopifnot(!model$lineup_position_eligibility(rows)[5, "PG"])

# Stretch centers and credible small-ball PFs remain valid frontcourt options.
rows <- fixture(c("PG", "SG", "SF", "C", "C"), c(1, 2, 3, 4, 5), shooting = c(0, 0, 0, 1, -1))
starters <- pick(rows)
stopifnot(starters$lineup_position[starters$nba_id == 4] == "PF", !any(starters$lineup_position_fallback))
rows <- fixture(c("PG", "SG", "SF", "PF", "PF"), rimpro = c(0, 0, 0, 0, 1))
starters <- pick(rows)
stopifnot(starters$lineup_position[starters$nba_id == 5] == "C", !any(starters$lineup_position_fallback))

# Explicit position shares preserve secondary roles even with a primary label.
rows <- fixture(c("PG", "SG", "SF", "PF", "PF"))
shares <- model$position_share_matrix_from_labels(rows$position)
shares[5, ] <- c(0, 0, 0.10, 0.60, 0.30)
for (col in model$position_share_columns()) rows[[col]] <- shares[, col]
starters <- pick(rows)
stopifnot(starters$lineup_position[starters$nba_id == 5] == "C", !any(starters$lineup_position_fallback))

# Incomplete or unknown-position rosters return a deterministic, marked fallback.
rows <- fixture(rep("UNK", 4), passing = NA_real_)
first <- pick(rows)
second <- pick(rows)
stopifnot(identical(first$nba_id, second$nba_id), identical(first$lineup_position, second$lineup_position), all(first$lineup_position_fallback))
stopifnot(length(model$pick_lineup_starters(model$build_lineup_candidate_set(rows[FALSE, ]), list())) == 0)

# Distinct-role matching agrees with the actual assignment, including deficits.
set.seed(20261003)
for (i in seq_len(30)) {
  rows <- fixture(sample(c("PG", "SG", "SF", "PF", "C", "PG/SG", "SF/PF", "PF/C", "UNK"), 5, replace = TRUE),
    passing = rnorm(5), shooting = rnorm(5), rimpro = rnorm(5), rebounding = rnorm(5))
  assigned <- model$assign_lineup_positions(rows)
  eligibility <- model$lineup_position_eligibility(rows)
  expected <- sum(!eligibility[cbind(seq_len(5), match(assigned, model$valid_positions()))])
  stopifnot(model$build_lineup_candidate_set(rows)$position_shortfalls == expected)
}

# A major impact loss cannot win on skill fit (the Collier/George failure).
rows <- fixture(c("PG", "SG", "SF", "PF", "C", "PG"), c(-0.38, 0.2, 2, 2, 2, -1.75))
rows[6, model$lineup_skill_names()] <- 3
starters <- pick(rows)
stopifnot(1L %in% starters$nba_id, !(6L %in% starters$nba_id))

# Fit may choose a modestly weaker guard inside the band, including its edge.
rows$total[6] <- -0.68
stopifnot(6L %in% pick(rows)$nba_id)
rows$total[6] <- -0.88
stopifnot(6L %in% pick(rows)$nba_id)
rows$total[6] <- -0.88001
stopifnot(1L %in% pick(rows)$nba_id)

# Unbalanced and incompatible bench-heavy fives cannot distort benchmarks.
rows <- fixture(c("PG", "SG", "SF", "PF", "C", "C", "C"), c(-1, -1, -1, -1, 3, 2.9, 2.8))
rows$PASS[6:7] <- 100
candidate <- model$build_lineup_candidate_set(rows)
references <- model$lineup_skill_benchmarks(list(candidate))[["2027"]]
stopifnot(all(vapply(references, function(values) identical(values, 0), logical(1))))

# A percentile threshold changes fit continuously, even when gap count changes.
candidate <- list(year = 2027L, combos = matrix(seq_len(10), nrow = 2),
  skill_totals = matrix(0.9, nrow = 2, ncol = length(model$lineup_skill_names()),
    dimnames = list(NULL, model$lineup_skill_names())), total_sum = c(0, 0))
candidate$skill_totals[, "FTD"] <- c(0.4999, 0.5001)
references <- list("2027" = setNames(rep(list(seq(0, 1, by = 0.0001)), length(model$lineup_skill_names())), model$lineup_skill_names()))
scored <- model$score_lineup_candidates(candidate, references)
stopifnot(scored$gaps[1] != scored$gaps[2], abs(diff(scored$fit_score)) < 1e-5)

# Blank source seasons leave historical salaries alone; an explicit future UFA
# supersedes an old contract. A season advance shifts contract horizons with impact.
old <- data.frame(nba_id = 1L, player_name = "Player", team = "TEST", salary_y0 = 10, salary_y1 = 20,
  contract_status_y0 = "Signed", contract_status_y1 = "Signed")
fresh <- old
fresh$salary_y0 <- NA_real_
fresh$contract_status_y0 <- NA_character_
fresh$salary_y1 <- NA_real_
fresh$contract_status_y1 <- "UFA"
overlaid <- model$overlay_spotrac_contracts(old, fresh)
stopifnot(overlaid$salary_y0 == 10, is.na(overlaid$salary_y1), overlaid$contract_status_y1 == "UFA")
model$cap_for_year <- function(...) 100
rows <- data.frame(year = 2027L, contract_y1 = 10, contract_y2 = 20, contract_status_y1 = "Signed", contract_status_y2 = "Team Option")
shifted <- model$shift_future_columns(rows, data.frame())
stopifnot(shifted$contract_y1 == 20, shifted$contract_status_y1 == "Team Option")
stopifnot(scraper$parse_status("Exhibit 10", "Active Roster") == "Non-Guaranteed")
stopifnot(scraper$contract_status_from_spotrac_cell("Exhibit 9", "Active Roster") == "Non-Guaranteed")
stopifnot(is.na(scraper$contract_amount_from_spotrac_cell("Exhibit 10", "Active Roster")))
stopifnot(model$projection_roster_status("Non-Guaranteed", NA_real_) == "open_market")

# Official game IDs retain leading zeroes, and truncated cached rows cannot
# silently corrupt season grouping during a roster-dependent data export.
schedule_fixture <- tempfile(fileext = ".csv")
writeLines(c('season,season_type,date,home_team,away_team,game_id',
  '2027,Regular Season,2026-10-20,DET,BOS,0022600001'), schedule_fixture)
cached <- model$read_schedule_cache(schedule_fixture)
stopifnot(identical(cached$game_id, "0022600001"), cached$season == 2027L)
writeLines(c('season,season_type,date,home_team,away_team,game_id',
  '... bytes omitted ...'), schedule_fixture)
invalid_cache <- try(model$read_schedule_cache(schedule_fixture), silent = TRUE)
stopifnot(inherits(invalid_cache, "try-error"))
unlink(schedule_fixture)

# Exercise the real HTML parser with a shifted season, extra future columns,
# header descriptions, a two-way player and a rookie hold.
if (requireNamespace("rvest", quietly = TRUE) && requireNamespace("xml2", quietly = TRUE)) {
  html <- paste0('<table><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>2026-27</th><th>2027-28 salary</th></tr></thead><tbody>',
    '<tr><td><a href="/nba/player/123">Test Player</a></td><td>PG</td><td>25</td><td>$12,000,000</td><td>UFA</td></tr></tbody></table>')
  table <- rvest::html_element(rvest::read_html(html), "table")
  labels <- scraper$season_labels(2026L)
  parsed <- scraper$parse_section_table(table, "Active Roster", "TEST", "TEST", "fixture", "2026-10-03T19:00:00Z", labels)
  stopifnot(parsed[["2025-26"]] == "", parsed[["2026-27"]] == "$12,000,000", parsed[["2027-28"]] == "UFA")
  parsed$nba_id <- 1L
  parsed$match_method <- "exact_name"
  parsed$match_confidence <- 1
  contracts <- scraper$build_spotrac_contract_export(parsed, 2026L, labels)
  stopifnot(is.na(contracts$salary_y0), contracts$salary_y1 == 12000000, contracts$contract_status_y2 == "UFA")
  parsed[["2026-27"]] <- "Two-Way"
  truth <- scraper$build_current_roster_truth(parsed, 2026L, labels)
  stopifnot(truth$contract_status == "Two-Way")
  parsed$section <- "Cap Hold"
  parsed$roster_state <- "cap_hold"
  parsed[["2026-27"]] <- "1ST RD"
  parsed <- scraper$classify_rookie_cap_holds(parsed, labels)
  stopifnot(parsed$roster_state == "rookie_cap_hold")
  message("Spotrac season-header parser regressions passed.")
}

# Validate the generated selections against the complete exported player pool.
# This catches role deficits and unnecessary star omissions on real rosters.
if (requireNamespace("jsonlite", quietly = TRUE) && file.exists("frontend/public/data/manifest.json")) {
  data_dir <- "frontend/public/data"
  manifest <- jsonlite::fromJSON(file.path(data_dir, "manifest.json"), simplifyVector = FALSE)
  read_export <- function(name) {
    dataset <- manifest$static_data$datasets[[name]]
    stopifnot(length(dataset$shards) > 0)
    paths <- vapply(dataset$shards, function(shard) file.path(data_dir, shard$file), character(1))
    stopifnot(all(file.exists(paths)))
    rows <- as.data.frame(data.table::rbindlist(lapply(paths, jsonlite::fromJSON), use.names = TRUE, fill = TRUE))
    stopifnot(is.data.frame(rows), nrow(rows) == dataset$rows)
    rows
  }
  players <- read_export("impact_players")
  lineups <- read_export("team_lineups")
  contract_path <- "processed/livedata/impactrefresh/contracts_2026_spotrac.csv"
  if (file.exists(contract_path)) {
    contracts <- read.csv(contract_path, stringsAsFactors = FALSE)
    current <- players[players$year == 2027L & players$roster_truth_team != "FA", , drop = FALSE]
    match_idx <- match(current$nba_id, contracts$nba_id)
    known <- !is.na(match_idx) & is.finite(contracts$salary_y1[match_idx]) & contracts$salary_y1[match_idx] > 0
    stopifnot(all(is.finite(current$contract[known])), all(abs(current$contract[known] - contracts$salary_y1[match_idx[known]]) < 1))
    message("2026-27 salaries match the fresh Spotrac contract season: ", sum(known), " players.")
  }
  scenario_pools <- setNames(lapply(unique(lineups$scenario_id), function(scenario) {
    assigned <- model$assign_team_projection_scenario(players, scenario)
    split(assigned, paste(assigned$year, assigned$team, sep = "||"))
  }), unique(lineups$scenario_id))
  groups <- split(lineups, paste(lineups$scenario_id, lineups$year, lineups$team, sep = "||"))
  for (group in groups) {
    scenario <- group$scenario_id[[1]]
    key <- paste(group$year[[1]], group$team[[1]], sep = "||")
    pool <- scenario_pools[[scenario]][[key]]
    if (is.null(pool)) stop("Generated lineup has no player pool: ", scenario, "||", key)
    selected <- group[group$is_starter, , drop = FALSE]
    if (anyDuplicated(selected$lineup_position) || nrow(selected) != min(5L, nrow(pool))) {
      stop("Incorrect starter count or repeated role in ", scenario, "||", key, ": ", nrow(selected), " starters from ", nrow(pool), " players")
    }
    candidates <- model$build_lineup_candidate_set(pool)
    actual <- pool[match(selected$nba_id, pool$nba_id), , drop = FALSE]
    eligibility <- model$lineup_position_eligibility(actual)
    fallback <- !eligibility[cbind(seq_len(nrow(actual)), match(selected$lineup_position, model$valid_positions()))]
    stopifnot(identical(as.logical(selected$lineup_position_fallback), as.logical(fallback)))
    stopifnot(sum(fallback) + 5L - nrow(actual) == min(candidates$position_shortfalls))
    selected_indices <- match(selected$nba_id, pool$nba_id)
    viable <- which(candidates$position_shortfalls == min(candidates$position_shortfalls))
    for (idx in candidates$required_starter_indices) {
      includes_star <- rowSums(candidates$combos[viable, , drop = FALSE] == idx) > 0
      if (any(includes_star)) {
        stopifnot(idx %in% selected_indices)
        viable <- viable[includes_star]
      }
    }
    actual_impact <- sum(model$lineup_numeric_col(actual, "total", -99))
    best_impact <- max(candidates$total_sum[viable])
    stopifnot(actual_impact >= best_impact - model$lineup_impact_tolerance() - 1e-6)
  }
  message("Generated lineup positional audits passed: ", length(groups), " team/season/scenario groups.")
}

message("Lineup positional and contract-season regressions passed.")

