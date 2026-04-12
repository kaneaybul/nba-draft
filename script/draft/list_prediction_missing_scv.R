library(data.table)

resolve_base_dir <- function() {
  candidates <- c(getwd(), file.path(getwd(), ".."), file.path(getwd(), "..", ".."))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

read_scv_lookup <- function(path, priority) {
  if (!file.exists(path)) {
    return(data.table(join_player = character(), scv_lookup = numeric(), source_priority = integer()))
  }

  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"name" %in% names(dt)) {
    return(data.table(join_player = character(), scv_lookup = numeric(), source_priority = integer()))
  }

  score_col <- names(dt)[tolower(names(dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(data.table(join_player = character(), scv_lookup = numeric(), source_priority = integer()))
  }

  dt[, join_player := normalize_join_name(name)]
  dt[, scv_lookup := suppressWarnings(as.numeric(get(score_col)))]
  dt[, source_priority := as.integer(priority)]
  dt[nzchar(join_player) & is.finite(scv_lookup), .(join_player, scv_lookup, source_priority)]
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
ref_dir <- file.path(base_dir, "ref")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

prediction_dt <- fread(file.path(draft_dir, "draft_prediction_unified.csv"), na.strings = c("", "NA", "N/A", "NaN"))
prediction_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
prediction_dt[, prediction_pool := as.character(prediction_pool)]
prediction_dt[, player := as.character(player)]

scv_lookup <- rbindlist(
  list(
    read_scv_lookup(file.path(ref_dir, "scvardraft.csv"), 1L),
    read_scv_lookup(file.path(ref_dir, "scvardraft_overrides.csv"), 2L)
  ),
  use.names = TRUE,
  fill = TRUE
)
setorder(scv_lookup, join_player, -source_priority)
scv_lookup <- unique(scv_lookup[, .(join_player, scv_lookup)], by = "join_player")

prediction_dt[, row_id___ := seq_len(.N)]
prediction_dt[, join_player := normalize_join_name(player)]
prediction_dt <- merge(prediction_dt, scv_lookup, by = "join_player", all.x = TRUE, sort = FALSE)
setorder(prediction_dt, row_id___)

current_scv <- if ("scv_draft" %in% names(prediction_dt)) {
  suppressWarnings(as.numeric(prediction_dt[["scv_draft"]]))
} else {
  rep(NA_real_, nrow(prediction_dt))
}
lookup_scv <- suppressWarnings(as.numeric(prediction_dt[["scv_lookup"]]))
current_scv[!is.finite(current_scv) & is.finite(lookup_scv)] <- lookup_scv[!is.finite(current_scv) & is.finite(lookup_scv)]
prediction_dt[, scv_draft_filled := current_scv]

non_2026_dt <- prediction_dt[draft_year != 2026]
no_college_missing <- non_2026_dt[
  prediction_pool == "no_college" & !is.finite(scv_draft_filled),
  .(player, draft_year, prediction_pool, source_section)
]
setorder(no_college_missing, draft_year, player)

college_missing <- non_2026_dt[
  is.na(prediction_pool) |
    !nzchar(trimws(prediction_pool)) |
    prediction_pool %in% c("domestic", "international")
][
  !is.finite(scv_draft_filled),
  .(player, draft_year, prediction_pool)
]
setorder(college_missing, draft_year, player)

cat("No-college non-2026 prediction rows missing SCV after lookup fill:", nrow(no_college_missing), "\n")
print(no_college_missing)

cat("\nCollege non-2026 prediction rows missing SCV after lookup fill:", nrow(college_missing), "\n")
print(college_missing)

cat("\nCollege non-2026 prediction row count:", non_2026_dt[
  is.na(prediction_pool) |
    !nzchar(trimws(prediction_pool)) |
    prediction_pool %in% c("domestic", "international"),
  .N
], "\n")
