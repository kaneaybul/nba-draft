library(data.table)

resolve_base_dir <- function() {
  wd <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
  candidates <- unique(c(wd, file.path(wd, ".."), file.path(wd, "..", "..")))
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

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

spec <- data.table(
  player = c(
    "De'Anthony Melton",
    "Mo Bamba",
    "Tre Jones",
    "Jalen Johnson",
    "Gregory Jackson",
    "Nique Clifford",
    "Tre Johnson"
  ),
  torvik_year = c(2017L, 2018L, 2020L, 2021L, 2023L, 2025L, 2025L),
  draft_year = c(2018L, 2018L, 2020L, 2021L, 2023L, 2025L, 2025L),
  player_id = c("47673", "51204", "65855", "73238", "76398", "72334", "126599"),
  draft_date = as.IDate(c(
    "2018-06-21",
    "2018-06-21",
    "2020-11-18",
    "2021-07-29",
    "2023-06-22",
    "2025-06-25",
    "2025-06-25"
  )),
  note = c(
    "USC 2017 Torvik row; draft year corrected to 2018 because he was drafted after the missed 2017-18 season.",
    "Texas 2018 Torvik row for player listed as Mohamed Bamba.",
    "Duke 2020 Torvik row.",
    "Duke 2021 Torvik row; selected by Torvik player_id to avoid same-name players.",
    "South Carolina 2023 Torvik row listed as Gregory Jackson.",
    "Colorado State 2025 Torvik row.",
    "Texas 2025 Torvik row."
  )
)

databallr_fp <- file.path(base_dir, "raw", "databallr_stats.csv")
databallr <- if (file.exists(databallr_fp)) fread(databallr_fp, na.strings = c("", "NA", "N/A", "NaN")) else data.table()
measurement_cols <- intersect(c("height_wo_shoes_in", "wingspan_in"), names(databallr))
if (nrow(databallr) && all(c("player_name", "draft_year") %in% names(databallr))) {
  databallr[, key := normalize_join_name(player_name)]
  databallr[, draft_year := suppressWarnings(as.integer(draft_year))]
  meas <- databallr[, .SD[1], by = .(key, draft_year), .SDcols = measurement_cols]
} else {
  meas <- data.table(key = character(), draft_year = integer(), height_wo_shoes_in = numeric(), wingspan_in = numeric())
}

draft_map_fp <- file.path(draft_dir, "no_college_realgm_draft_map.csv")
draft_map <- if (file.exists(draft_map_fp)) fread(draft_map_fp, na.strings = c("", "NA", "N/A", "NaN")) else data.table()
weight_col <- intersect(c("weight", "wt", "weight_lbs"), names(draft_map))[1]
if (nrow(draft_map) && all(c("player", "draft_year") %in% names(draft_map)) && !is.na(weight_col)) {
  draft_map[, key := normalize_join_name(player)]
  draft_map[, draft_year := suppressWarnings(as.integer(draft_year))]
  draft_map[, weight_lbs := suppressWarnings(as.numeric(get(weight_col)))]
  map_wt <- draft_map[, .SD[1], by = .(key, draft_year), .SDcols = "weight_lbs"]
} else {
  map_wt <- data.table(key = character(), draft_year = integer(), weight_lbs = numeric())
}

get_lookup_value <- function(dt, key_value, draft_year_value, col_name) {
  if (!nrow(dt) || !col_name %in% names(dt)) return(NA_real_)
  hit <- dt[key == key_value & draft_year == draft_year_value]
  if (!nrow(hit)) return(NA_real_)
  suppressWarnings(as.numeric(hit[[col_name]][1]))
}

make_supplement_row <- function(spec_row) {
  raw_fp <- file.path(draft_dir, sprintf("torvik_%d_raw.csv", spec_row$torvik_year))
  if (!file.exists(raw_fp)) {
    stop("Missing Torvik raw CSV: ", raw_fp)
  }

  raw <- fread(raw_fp, header = FALSE, na.strings = c("", "NA", "N/A", "NaN"))
  hit <- raw[as.character(V33) == as.character(spec_row$player_id)]
  if (!nrow(hit)) {
    stop("No Torvik row for ", spec_row$player, " player_id=", spec_row$player_id, " in ", raw_fp)
  }
  hit <- hit[1]

  key_value <- normalize_join_name(spec_row$player)
  birthdate <- as.IDate(hit$V67)
  data.table(
    player = spec_row$player,
    year = spec_row$draft_year,
    draft_year = spec_row$draft_year,
    cbbd_id = spec_row$player_id,
    player_id = spec_row$player_id,
    big_board_rank = NA_integer_,
    birthdate = as.character(birthdate),
    draft_age = round(as.numeric(spec_row$draft_date - birthdate) / 365.25, 2),
    height = as.character(hit$V27),
    height_wo_shoes_in = get_lookup_value(meas, key_value, spec_row$draft_year, "height_wo_shoes_in"),
    wingspan_in = get_lookup_value(meas, key_value, spec_row$draft_year, "wingspan_in"),
    weight_lbs = get_lookup_value(map_wt, key_value, spec_row$draft_year, "weight_lbs"),
    hometown = as.character(hit$V34),
    games = hit$V4,
    min_pct = hit$V5,
    ortg = hit$V6,
    usg = hit$V7,
    efg = hit$V8,
    ts = hit$V9,
    or_pct = hit$V10,
    dr_pct = hit$V11,
    ast_pct = hit$V12,
    ast_to_usg = round(hit$V12 / hit$V7, 4),
    to_pct = hit$V13,
    ftm = hit$V14,
    fta = hit$V15,
    ft_pct = round(100 * hit$V16, 1),
    two_m = hit$V17,
    two_a = hit$V18,
    two_pct = round(100 * hit$V19, 1),
    three_m = hit$V20,
    three_a = hit$V21,
    three_pct = round(100 * hit$V22, 1),
    blk_pct = hit$V23,
    stl_pct = hit$V24,
    ftr = hit$V25,
    ppg = hit$V64,
    prpg = hit$V29,
    manual_source = "barttorvik",
    manual_source_url = sprintf(
      "https://barttorvik.com/playerstat.php?year=%d&p=%s",
      spec_row$torvik_year,
      utils::URLencode(as.character(hit$V1), reserved = TRUE)
    ),
    manual_source_note = spec_row$note,
    manual_replace_scope = "player",
    created_at = as.character(Sys.Date())
  )
}

new_rows <- rbindlist(lapply(seq_len(nrow(spec)), function(i) make_supplement_row(spec[i])), use.names = TRUE, fill = TRUE)

supplement_fp <- file.path(draft_dir, "draft_college_manual_supplement.csv")
old_rows <- if (file.exists(supplement_fp)) {
  fread(
    supplement_fp,
    na.strings = c("", "NA", "N/A", "NaN"),
    colClasses = list(character = c("birthdate", "created_at", "cbbd_id", "player_id"))
  )
} else {
  data.table()
}
if (nrow(old_rows)) {
  old_rows[, join_player := normalize_join_name(player)]
  new_rows[, join_player := normalize_join_name(player)]
  old_rows <- old_rows[!join_player %in% new_rows$join_player]
  old_rows[, join_player := NULL]
  new_rows[, join_player := NULL]
}

out <- rbindlist(list(old_rows, new_rows), use.names = TRUE, fill = TRUE)
fwrite(out, supplement_fp, na = "")

print(new_rows[, .(
  player,
  year,
  player_id,
  games,
  ppg,
  height_wo_shoes_in,
  wingspan_in,
  weight_lbs,
  manual_source_note
)])
