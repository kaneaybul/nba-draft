# Pure regression tests: no live fetch, model fitting or export side effects.
model <- new.env(parent = globalenv())
for (expr in parse("script/frontend/export_frontend_data.R")) {
  if (is.call(expr) && identical(expr[[1]], as.name("<-")) && length(expr) == 3L &&
      is.call(expr[[3]]) && identical(expr[[3]][[1]], as.name("function"))) eval(expr, model)
}
model$TEAM_PROJECTION_PLAYER_LIMIT <- 10L
source("script/frontend/injury_projections.R", local = model)

fixture <- do.call(rbind, lapply(seq_along(c("GSW", "UTA", "BOS", "DET")), function(i) {
  team <- c("GSW", "UTA", "BOS", "DET")[i]
  rows <- data.frame(nba_id = i * 100L + seq_len(8), year = 2027L, team = team,
    player_name = paste(team, seq_len(8)), position = c("PG", "SG", "SF", "PF", "C", "PG", "SF", "C"),
    availability_status = "projected", projection_roster_status = "signed", contract_status = "Signed",
    contract = 100, Minutes = c(2520, 2200, 2100, 2000, 1900, 1200, 1000, 800), games = 75,
    p_mpg = c(33.6, 29.3, 28, 26.7, 25.3, 16, 13.3, 10.7),
    offense = c(4, 1, 0.5, 0, 0, -1, -1.5, -2), defense = c(1, 0, 0, 0.5, 1, -0.5, 0, 0),
    stringsAsFactors = FALSE)
  rows$total <- rows$offense + rows$defense
  rows$replacement_total <- -2
  rows$timin <- (rows$total + 2) * rows$Minutes
  rows$season_value <- rows$value <- rows$timin * 100
  rows$value_add <- rows$value - rows$contract
  rows$lineup_adjusted_minutes <- rows$lineup_original_minutes <- rows$Minutes
  rows$projection_minutes_y1 <- 1700
  rows$projection_games_y1 <- 60
  rows$projection_mpg_y1 <- 28.3
  rows$projection_timin_y1 <- 2000
  rows$projection_value_y1 <- 200000
  rows$projection_minutes_y2 <- 1600
  rows$score <- 60
  rows$tier <- "Starter"
  for (skill in model$impact_skill_names()) rows[[skill]] <- 0
  rows
}))
past <- fixture[1, , drop = FALSE]
past$year <- 2026L
past$availability_status <- "observed"
past$Minutes <- 999
past$games <- 40
fixture <- rbind(past, fixture)
schedule <- data.frame(season = 2027L, season_type = "Regular Season",
  date = rep(c("2026-10-17", "2026-10-21", "2026-11-21", "2027-02-21"), each = 2),
  home_team = rep(c("GSW", "BOS"), 4), away_team = rep(c("UTA", "DET"), 4),
  is_completed = rep(c(TRUE, FALSE, FALSE, FALSE), each = 2), is_placeholder = FALSE,
  home_win_probability = 0.5, away_win_probability = 0.5, stringsAsFactors = FALSE)
outlook <- list(season = 2027L, generated_at = "2026-10-19T12:00:00Z", players = list())
neutral <- model$apply_injury_projections(fixture, schedule, outlook)
stopifnot(identical(neutral$players$Minutes, fixture$Minutes), identical(neutral$players$games, fixture$games),
  all(neutral$schedules$home_win_probability == 0.5))

row <- list(player_name = "GSW 1", name_key = "gsw1", team = "GSW", basis = "reported_window",
  status = "Out", return_earliest = "2026-11-01", return_latest = "2026-12-01",
  return_expected = "2026-11-16", games_missed_min = 1L, source_url = "https://www.espn.com/nba/injuries")
outlook$players <- list(row)
result <- model$apply_injury_projections(fixture, schedule, outlook)
star <- which(fixture$year == 2027 & fixture$nba_id == 101)
bench <- which(fixture$year == 2027 & fixture$nba_id == 106)
old <- which(fixture$year == 2026)
stopifnot(result$players$Minutes[star] < fixture$Minutes[star], result$players$games[star] < fixture$games[star],
  result$players$Minutes[bench] > fixture$Minutes[bench],
  result$players$Minutes[old] == 999, result$players$games[old] == 40,
  result$players$projection_minutes_y1[old] == result$players$Minutes[star],
  result$players$projection_minutes_y2[old] == fixture$projection_minutes_y2[old],
  identical(result$players$projection_minutes_y1[-old], fixture$projection_minutes_y1[-old]),
  identical(result$players$total, fixture$total),
  result$schedules$home_win_probability[3] < 0.5,
  result$schedules$home_win_probability[7] == 0.5,
  identical(result$schedules$home_win_probability[1:2], schedule$home_win_probability[1:2]))
teams_before <- model$build_team_projections_for_scenario(fixture, "base", "Base Case")
teams_after <- model$build_team_projections_for_scenario(result$players, "base", "Base Case")
stopifnot(teams_after$adjusted_total[teams_after$year == 2027 & teams_after$team == "GSW"] <
  teams_before$adjusted_total[teams_before$year == 2027 & teams_before$team == "GSW"])
future_only <- result$schedules[!result$schedules$is_completed, , drop = FALSE]
stopifnot(sum(future_only$home_win_probability[future_only$home_team == "GSW"]) < 1.5)
error <- try(model$apply_injury_projections(result$players, schedule, outlook), silent = TRUE)
stopifnot(inherits(error, "try-error"))
repeat_result <- model$apply_injury_projections(fixture, schedule, outlook)
stopifnot(identical(result, repeat_result))

# Source minimums and review dates cannot silently become a clearance date.
team_calendar <- model$injury_projection_calendar(schedule, 2027L)
team_calendar <- team_calendar[team_calendar$team == "GSW", ]
review <- row
review$basis <- "reevaluation"
review$return_earliest <- review$return_latest <- review$return_expected <- NULL
review$reevaluation_date <- "2026-11-01"
review$games_missed_min <- 0L
plan <- model$injury_projection_plan(review, as.Date("2026-10-19"), team_calendar)
stopifnot(model$injury_availability_on_date(plan, "2026-11-01") == 0,
  abs(model$injury_availability_on_date(plan, "2026-11-15") - 0.5) < 1e-8,
  model$injury_availability_on_date(plan, "2027-02-21") < 1)
unknown <- review
unknown$basis <- "unknown"
unknown$reevaluation_date <- NULL
unknown$provider_return_date <- "2026-10-21"
unknown_plan <- model$injury_projection_plan(unknown, as.Date("2026-10-19"), team_calendar)
stopifnot(model$injury_availability_on_date(unknown_plan, "2026-10-21") < 0.1)
minimum <- row
minimum$basis <- "reported_games"
minimum$return_earliest <- minimum$return_latest <- minimum$return_expected <- NULL
minimum$games_missed_min <- 2L
minimum_plan <- model$injury_projection_plan(minimum, as.Date("2026-10-19"), team_calendar)
stopifnot(model$injury_availability_on_date(minimum_plan, "2026-11-21") == 0)

# An entire remaining season out produces zero minutes, including Cup slots,
# while a midseason injury retains completed-game exposure.
ended <- row
ended$season_ending <- TRUE
outlook$players <- list(ended)
ended_result <- model$apply_injury_projections(fixture, schedule, outlook)
stopifnot(abs(ended_result$players$Minutes[star] - fixture$Minutes[star] / 4) < 0.11)
preseason_schedule <- schedule[!schedule$is_completed, , drop = FALSE]
ended_result <- model$apply_injury_projections(fixture, preseason_schedule, outlook)
stopifnot(ended_result$players$Minutes[star] == 0, ended_result$players$games[star] == 0)
lineups <- model$build_team_lineups_for_scenario(ended_result$players[ended_result$players$year == 2027, ], "base", "Base Case")
stopifnot(!(101L %in% lineups$nba_id))

# Rotation caps preserve budget, and a center vacancy preferentially reaches
# the reserve center when the other candidates have equal opportunity.
simple <- fixture[fixture$year == 2027 & fixture$team == "GSW", ]
allocation <- model$allocate_injury_rotation(simple, c(0, rep(1, 7)))
stopifnot(all(allocation$minutes >= 0), allocation$minutes[1] == 0,
  sum(allocation$minutes) <= sum(simple$Minutes) + 1e-6,
  all(allocation$minutes <= allocation$games * pmin(36, simple$Minutes / simple$games + 6) + 1e-6))
overfull <- simple
overfull$Minutes <- 2800
overfull$games <- 82
overfull_allocation <- model$allocate_injury_rotation(overfull, rep(1, nrow(overfull)))
stopifnot(sum(overfull_allocation$minutes) <= 19680 + 1e-6)
simple$Minutes <- 1500
simple$games <- 60
allocation <- model$allocate_injury_rotation(simple, c(1, 1, 1, 1, 0, 1, 1, 1))
stopifnot(allocation$minutes[8] > allocation$minutes[6], allocation$minutes[8] > allocation$minutes[7])

cup <- preseason_schedule[1:2, ]
cup$home_team <- cup$away_team <- cup$selected_team <- c("GSW", "BOS")
cup$is_placeholder <- TRUE
cup_result <- model$apply_injury_projections(fixture, rbind(
  transform(preseason_schedule, selected_team = NA_character_), cup), outlook)
stopifnot(all(is.finite(cup_result$schedules$home_win_probability)),
  cup_result$schedules$home_win_probability[7] == cup_result$schedules$away_win_probability[7])

# Check the generated production output when present. This test remains valid
# as names and active injury reports change; it verifies the data contract.
manifest_path <- "frontend/public/data/manifest.json"
if (file.exists(manifest_path)) {
  manifest <- jsonlite::fromJSON(manifest_path, simplifyVector = FALSE)
  dataset <- manifest$static_data$datasets$impact_players
  shard <- Filter(function(x) as.integer(x$year) == 2027L, dataset$shards)
  if (length(shard)) {
    path <- file.path("frontend/public/data", shard[[1]]$file)
    exported <- jsonlite::fromJSON(path)
    if ("--require-export" %in% commandArgs(trailingOnly = TRUE) && !("injury_availability" %in% names(exported))) {
      stop("The exporter did not incorporate the injury adjustment.")
    }
    if ("injury_availability" %in% names(exported)) {
      stopifnot(all(exported$injury_availability >= 0 & exported$injury_availability <= 1, na.rm = TRUE),
        all(exported$Minutes >= 0), all(exported$p_mpg <= 36.1, na.rm = TRUE),
        all(exported$Minutes[exported$injury_availability == 0 & !is.na(exported$injury_availability)] == 0))
      message("Published injury-aware minutes verified for ", nrow(exported), " players.")
    }
  }
}
message("Injury minutes, replacement rotation, dated game odds and historical-preservation regressions passed.")
