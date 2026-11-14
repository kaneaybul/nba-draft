if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}
if (!requireNamespace("ranger", quietly = TRUE)) {
  stop("Package 'ranger' is required. Install it with install.packages('ranger').")
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

anglicize_text <- function(x) {
  x <- as.character(x)
  converted <- suppressWarnings(iconv(x, from = "", to = "ASCII//TRANSLIT"))
  fill_idx <- is.na(converted) & !is.na(x)
  converted[fill_idx] <- x[fill_idx]
  trimws(converted)
}

normalize_join_name <- function(x) {
  x <- anglicize_text(x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

read_csv_if_exists <- function(path) {
  if (!file.exists(path)) return(data.table())
  fread(path, na.strings = c("", "NA", "N/A", "NaN"))
}

load_scv_lookup <- function(base_dir) {
  paths <- c(
    file.path(base_dir, "ref", "scvardraft.csv"),
    file.path(base_dir, "ref", "scvardraft_overrides.csv")
  )
  rows <- list()
  for (i in seq_along(paths)) {
    dt <- read_csv_if_exists(paths[[i]])
    if (!nrow(dt) || !"name" %in% names(dt)) next
    score_col <- names(dt)[tolower(names(dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
    if (is.na(score_col) || !nzchar(score_col)) next
    rows[[length(rows) + 1L]] <- data.table(
      join_player = normalize_join_name(dt$name),
      scv_draft_lookup = suppressWarnings(as.numeric(dt[[score_col]])),
      source_priority = i
    )
  }
  if (!length(rows)) return(data.table(join_player = character(), scv_draft_lookup = numeric()))
  out <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  out <- out[nzchar(join_player) & is.finite(scv_draft_lookup)]
  setorder(out, join_player, -source_priority)
  unique(out[, .(join_player, scv_draft_lookup)], by = "join_player")
}

coalesce_numeric <- function(dt, cols) {
  cols <- cols[cols %in% names(dt)]
  out <- rep(NA_real_, nrow(dt))
  for (col in cols) {
    vals <- suppressWarnings(as.numeric(dt[[col]]))
    fill <- !is.finite(out) & is.finite(vals)
    out[fill] <- vals[fill]
  }
  out
}

as_percent <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  fifelse(is.finite(x) & abs(x) <= 1, 100 * x, x)
}

apply_preprocess_recipe <- function(df, recipe) {
  df <- as.data.frame(df)
  if (is.null(recipe) || !length(recipe$numeric_fill)) return(df)
  for (col_name in names(recipe$numeric_fill)) {
    if (!col_name %in% names(df)) next
    vals <- suppressWarnings(as.numeric(df[[col_name]]))
    vals[!is.finite(vals)] <- recipe$numeric_fill[[col_name]]
    df[[col_name]] <- vals
  }
  df
}

safe_prediction_z <- function(x) {
  x <- suppressWarnings(as.numeric(x))
  out <- rep(NA_real_, length(x))
  ok <- is.finite(x)
  if (!any(ok)) return(out)
  s <- stats::sd(x[ok], na.rm = TRUE)
  m <- mean(x[ok], na.rm = TRUE)
  if (!is.finite(s) || s == 0) {
    out[ok] <- 0
  } else {
    out[ok] <- (x[ok] - m) / s
  }
  out
}

load_rollup_config <- function(base_dir) {
  skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
  fallback <- list(
    offense_skills = c("FTD", "OREB", "PASS", "RIM", "SHOOT"),
    defense_skills = c("DPM", "DREB", "RIMPRO", "SWITCH"),
    off_intercept = 0,
    def_intercept = 0
  )

  skillmap_path <- file.path(base_dir, "ref", "skillmap.csv")
  if (file.exists(skillmap_path)) {
    skillmap <- read_csv_if_exists(skillmap_path)
    if (nrow(skillmap) && "VAR" %in% names(skillmap)) {
      skill_cols <- intersect(skill_names, setdiff(names(skillmap), "VAR"))
      off_row <- skillmap[VAR == "Offense?"]
      def_row <- skillmap[VAR == "Defense?"]
      offense <- skill_cols[vapply(skill_cols, function(skill) {
        nrow(off_row) == 1L && isTRUE(suppressWarnings(as.numeric(off_row[[skill]][1])) == 1)
      }, logical(1))]
      defense <- skill_cols[vapply(skill_cols, function(skill) {
        nrow(def_row) == 1L && isTRUE(suppressWarnings(as.numeric(def_row[[skill]][1])) == 1)
      }, logical(1))]
      if (length(offense)) fallback$offense_skills <- offense
      if (length(defense)) fallback$defense_skills <- defense
    }
  }

  for (side in c("off", "def")) {
    fp <- file.path(base_dir, "processed", "modelresults", paste0(side, "_lm_1_results.csv"))
    dt <- read_csv_if_exists(fp)
    if (!nrow(dt) || !"term" %in% names(dt)) next
    estimate_col <- if ("Estimate" %in% names(dt)) "Estimate" else if ("estimate" %in% names(dt)) "estimate" else NA_character_
    if (is.na(estimate_col)) next
    val <- suppressWarnings(as.numeric(dt[term == "(Intercept)", get(estimate_col)][1]))
    if (is.finite(val)) fallback[[paste0(side, "_intercept")]] <- val
  }

  fallback
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
out_dir <- file.path(draft_dir, "college_model_on_no_college_experiment")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

models_obj <- readRDS(file.path(draft_dir, "trained_skill_models.rds"))
trained_models <- models_obj$models
no_college <- read_csv_if_exists(file.path(draft_dir, "no_college_prediction.csv"))
if (!nrow(no_college)) stop("No no-college prediction rows found.")

dt <- copy(no_college)
dt[, player := as.character(player)]
dt[, draft_year := suppressWarnings(as.integer(draft_year))]
dt[, join_player := normalize_join_name(player)]

scv_lookup <- load_scv_lookup(base_dir)
if (nrow(scv_lookup)) {
  dt <- merge(dt, scv_lookup, by = "join_player", all.x = TRUE, sort = FALSE)
} else {
  dt[, scv_draft_lookup := NA_real_]
}

dt[, scv_draft := coalesce_numeric(.SD, c("scv_draft", "scv_draft_lookup"))]
dt[, ast_pct := coalesce_numeric(.SD, c("ast_pct", "misc_ast_pct"))]
dt[, stl_pct := coalesce_numeric(.SD, c("stl_pct", "misc_stl_pct"))]
dt[, blk_pct := coalesce_numeric(.SD, c("blk_pct", "misc_blk_pct"))]
dt[, or_pct := coalesce_numeric(.SD, c("or_pct", "misc_orb_pct"))]
dt[, dr_pct := coalesce_numeric(.SD, c("dr_pct", "misc_drb_pct"))]
dt[, ft_pct := as_percent(coalesce_numeric(.SD, c("ft_pct", "rate_ft_pct", "sum_ft_pct", "tot_ft_pct", "adv_ft_pct")))]
dt[, X3PA_100 := coalesce_numeric(.SD, c("X3PA_100", "per36_x3pa"))]
dt[, rim_pct := as_percent(coalesce_numeric(.SD, c("rim_pct", "rate_fg_pct", "sum_fg_pct", "tot_fg_pct", "adv_fg_pct")))]

selected_features <- unique(unlist(lapply(trained_models, function(model_entry) model_entry$selected_features), use.names = FALSE))
for (feature in selected_features) {
  if (!feature %in% names(dt)) {
    dt[, (feature) := NA_real_]
  }
}

out <- data.table(
  player = anglicize_text(dt$player),
  draft_year = dt$draft_year,
  prediction_pool = "no_college"
)

for (skill in names(trained_models)) {
  model_entry <- trained_models[[skill]]
  preds <- model_entry$selected_features
  scoring_df <- apply_preprocess_recipe(as.data.frame(dt[, ..preds]), model_entry$preprocess_recipe)
  if (identical(model_entry$model_type, "ranger")) {
    raw_pred <- as.numeric(predict(model_entry$fit, data = scoring_df)$predictions)
  } else if (identical(model_entry$model_type, "elastic_net_family")) {
    x_new <- model.matrix(as.formula(sprintf("~ %s", paste(preds, collapse = " + "))), data = scoring_df)
    x_new <- x_new[, colnames(x_new) != "(Intercept)", drop = FALSE]
    raw_pred <- as.numeric(predict(model_entry$fit, newx = x_new, s = "lambda.min"))
  } else {
    stop("Unsupported model type: ", model_entry$model_type)
  }
  out[[paste0(skill, "_raw_pred")]] <- raw_pred
}

skill_names <- c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH")
for (skill in skill_names) {
  raw_col <- paste0(skill, "_raw_pred")
  pred_col <- paste0(skill, "_pred")
  out[, (pred_col) := safe_prediction_z(get(raw_col)), by = draft_year]
}

rollup <- load_rollup_config(base_dir)
off_raw_cols <- paste0(intersect(rollup$offense_skills, skill_names), "_raw_pred")
def_raw_cols <- paste0(intersect(rollup$defense_skills, skill_names), "_raw_pred")
out[, off_intercept := rollup$off_intercept]
out[, def_intercept := rollup$def_intercept]
out[, OFF_pred := off_intercept + rowSums(.SD, na.rm = TRUE), .SDcols = off_raw_cols]
out[, DEF_pred := def_intercept + rowSums(.SD, na.rm = TRUE), .SDcols = def_raw_cols]
out[, TOTAL_pred := OFF_pred + DEF_pred]

mapped_cols <- c(
  "player", "draft_year", "scv_draft", "height_wo_shoes_in", "wingspan_in",
  "ast_pct", "stl_pct", "blk_pct", "or_pct", "dr_pct", "ft_pct", "X3PA_100", "rim_pct"
)
mapping_audit <- copy(dt[, intersect(mapped_cols, names(dt)), with = FALSE])
for (feature in selected_features) {
  audit_col <- paste0(feature, "_missing_after_mapping")
  mapping_audit[, (audit_col) := !is.finite(suppressWarnings(as.numeric(dt[[feature]])))]
}

ordered_cols <- c(
  "player", "draft_year", "prediction_pool",
  paste0(skill_names, "_pred"),
  paste0(skill_names, "_raw_pred"),
  "off_intercept", "def_intercept", "OFF_pred", "DEF_pred", "TOTAL_pred"
)
out <- out[, c(intersect(ordered_cols, names(out)), setdiff(names(out), ordered_cols)), with = FALSE]

fwrite(out, file.path(out_dir, "no_college_skill_predictions_college_model.csv"), na = "")
fwrite(mapping_audit, file.path(out_dir, "no_college_college_feature_mapping_audit.csv"), na = "")
message("College-trained model no-college predictions -> ", file.path(out_dir, "no_college_skill_predictions_college_model.csv"))
message("Feature mapping audit -> ", file.path(out_dir, "no_college_college_feature_mapping_audit.csv"))
