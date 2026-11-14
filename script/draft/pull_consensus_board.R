if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
if (!requireNamespace("rvest", quietly = TRUE)) {
  stop("Package 'rvest' is required. Install it with install.packages('rvest').")
}
library(data.table)
library(rvest)

resolve_base_dir <- function() {
  wd <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- unique(c(
    wd,
    file.path(wd, ".."),
    file.path(wd, "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  ))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "script")) &&
        dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

pick_col <- function(dt, candidates) {
  nm <- names(dt)
  nm[tolower(nm) %in% tolower(candidates)][1]
}

read_players <- function(path) {
  if (!file.exists(path)) return(character())
  dt <- tryCatch(fread(path, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) data.table())
  if (!nrow(dt) || !"player" %in% names(dt)) return(character())
  as.character(dt$player)
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)

draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

consensus_year <- suppressWarnings(as.integer(Sys.getenv("DRAFT_CONSENSUS_YEAR", "2026")))
if (!is.finite(consensus_year)) consensus_year <- 2026L
consensus_url <- Sys.getenv("DRAFT_CONSENSUS_URL", "https://www.rookiescale.com/2026-consensus-board/")

page <- read_html(consensus_url)
tables <- html_table(page, fill = TRUE)
board <- NULL
for (tab in tables) {
  tab <- as.data.table(tab)
  rank_col <- pick_col(tab, c("Rank"))
  player_col <- pick_col(tab, c("Prospect", "Player", "Name"))
  if (!is.na(rank_col) && !is.na(player_col)) {
    board <- tab
    break
  }
}
if (is.null(board)) {
  stop("Could not find a consensus table with Rank and Prospect/Player columns at: ", consensus_url)
}

rank_col <- pick_col(board, c("Rank"))
player_col <- pick_col(board, c("Prospect", "Player", "Name"))
age_col <- pick_col(board, c("Draft Age", "Age"))
team_col <- pick_col(board, c("Pre-Draft Team", "Team", "School"))
position_col <- pick_col(board, c("Position", "Pos"))

consensus <- data.table(
  draft_year = consensus_year,
  consensus_rank = suppressWarnings(as.numeric(board[[rank_col]])),
  consensus_player = as.character(board[[player_col]]),
  consensus_draft_age = if (!is.na(age_col)) suppressWarnings(as.numeric(board[[age_col]])) else NA_real_,
  consensus_team = if (!is.na(team_col)) as.character(board[[team_col]]) else NA_character_,
  consensus_position = if (!is.na(position_col)) as.character(board[[position_col]]) else NA_character_,
  consensus_source = consensus_url,
  pulled_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
)
consensus[, join_player := normalize_join_name(consensus_player)]
consensus <- consensus[nzchar(join_player) & is.finite(consensus_rank)]
setorder(consensus, consensus_rank)
consensus <- unique(consensus, by = "join_player")

raw_out <- file.path(draft_dir, sprintf("draft_consensus_big_board_%s.csv", consensus_year))
fwrite(consensus, raw_out, na = "")

names_fp <- file.path(base_dir, "ref", "draftprednames.csv")
prediction_names <- fread(names_fp, na.strings = c("", "NA", "N/A", "NaN"))
name_col <- pick_col(prediction_names, c("name", "player", "player_name"))
year_col <- pick_col(prediction_names, c("year", "draft_year"))
if (is.na(name_col) || is.na(year_col)) {
  stop("Prediction name file must include name/player and year/draft_year columns: ", names_fp)
}
projection <- data.table(
  player = as.character(prediction_names[[name_col]]),
  draft_year = suppressWarnings(as.integer(prediction_names[[year_col]]))
)
projection <- projection[draft_year == consensus_year & nzchar(player)]
projection[, join_player := normalize_join_name(player)]

source_players <- unique(c(
  read_players(file.path(draft_dir, "draftballr.csv")),
  read_players(file.path(draft_dir, "draft_prediction_domestic.csv")),
  read_players(file.path(draft_dir, "draft_prediction_international.csv")),
  read_players(file.path(draft_dir, "draft_no_college_all_classes.csv")),
  read_players(file.path(draft_dir, "no_college_latest_class_manual.csv")),
  read_players(file.path(draft_dir, "no_college_prediction.csv")),
  read_players(file.path(draft_dir, "no_college_manual_stats.csv"))
))
source_keys <- unique(normalize_join_name(source_players))
source_keys <- source_keys[nzchar(source_keys)]
projection[, source_validated := join_player %in% source_keys]

projection_ranks <- merge(
  projection[source_validated == TRUE],
  consensus[, .(join_player, consensus_rank, consensus_player, consensus_source)],
  by = "join_player",
  all.x = TRUE,
  sort = FALSE
)
projection_ranks[, rank_source := fifelse(
  is.finite(consensus_rank),
  "rookiescale_consensus",
  "unranked_default_60"
)]
projection_ranks[!is.finite(consensus_rank), consensus_rank := 60]
projection_ranks[is.finite(consensus_rank) & consensus_rank > 60, `:=`(
  consensus_rank = 60,
  rank_source = "rookiescale_consensus_clamped_60"
)]
setorder(projection_ranks, consensus_rank, player)

invalid_projection <- projection[source_validated != TRUE]
missing_rank <- projection_ranks[rank_source == "unranked_default_60"]

projection_out <- file.path(draft_dir, sprintf("draft_consensus_projection_ranks_%s.csv", consensus_year))
missing_out <- file.path(draft_dir, sprintf("draft_consensus_missing_%s.csv", consensus_year))
invalid_out <- file.path(draft_dir, sprintf("draft_consensus_source_unvalidated_%s.csv", consensus_year))
fwrite(projection_ranks[, .(
  player,
  draft_year,
  consensus_rank,
  consensus_player,
  rank_source,
  consensus_source,
  source_validated
)], projection_out, na = "")
fwrite(missing_rank[, .(player, draft_year, assigned_rank = consensus_rank, reason = rank_source)], missing_out, na = "")
fwrite(invalid_projection[, .(player, draft_year, reason = "not_found_in_local_projection_sources")], invalid_out, na = "")

cat("Consensus board written ->", raw_out, "\n")
cat("Projection ranks written ->", projection_out, "\n")
cat("Unranked validated players assigned 60 ->", missing_out, "\n")
if (nrow(missing_rank)) {
  cat("Unranked validated names:", paste(missing_rank$player, collapse = ", "), "\n")
} else {
  cat("Unranked validated names: none\n")
}
if (nrow(invalid_projection)) {
  cat("Projection names not found in local source data:", paste(invalid_projection$player, collapse = ", "), "\n")
}
