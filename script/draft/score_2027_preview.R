source("script/draft/draft_model_common.R")

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) stop("Usage: score_2027_preview.R INPUT_CSV OUTPUT_CSV")
draft_dir <- "processed/draft"
rows <- fread(args[[1]])
stopifnot(identical(rows$big_board_rank, 1:45), all(rows$draft_year == 2027L),
          all(rows$scv_draft == 3), !anyDuplicated(rows$player),
          all(rows$prediction_pool %in% c("domestic", "no_college")))

rows[, `:=`(X3PA_100 = torvik_estimated_3pa_100, rate_fg_pct = fg_pct / 100,
            rate_x3p_pct = three_pct / 100, rate_ft_pct = ft_pct / 100)]
rollup <- load_rollup_config("ref/skillmap.csv", "processed/modelresults/off_lm_1_results.csv",
                             "processed/modelresults/def_lm_1_results.csv")

score_pool <- function(pool, model_file) {
  inputs <- as.data.frame(rows[prediction_pool == pool & is.finite(games) & games > 0])
  if (!nrow(inputs)) return(NULL)
  models <- readRDS(file.path(draft_dir, model_file))$models
  if (pool == "domestic") {
    defense <- readRDS(file.path(draft_dir, "trained_defense_skill_models_publish.rds"))$models
    stopifnot(all(c("DPM", "DREB", "RIMPRO", "SWITCH") %in% names(defense)))
    models[names(defense)] <- defense
  }
  needed <- unique(unlist(lapply(models, function(model) model$selected_features)))
  for (column in setdiff(needed, names(inputs))) inputs[[column]] <- NA_real_
  as.data.table(add_total_predictions(make_preds(inputs, pool, models, "player"), rollup))
}

pred <- rbindlist(list(score_pool("domestic", "trained_skill_models.rds"),
                       score_pool("no_college", "no_college_trained_skill_models.rds")), fill = TRUE)
eligible <- rows[is.finite(games) & games > 0]
stopifnot(nrow(pred) > 0, nrow(pred) == nrow(eligible))
pred <- as.data.table(standardize_prediction_skills(as.data.frame(pred)))
panel <- merge(pred, eligible[, .(player = anglicize_text(player), draft_year, draft_age,
                                  scv_draft, big_board_rank, games)], by = c("player", "draft_year"))
stopifnot(nrow(panel) == nrow(eligible), !anyDuplicated(panel$big_board_rank))

tracker <- readLines("script/draft/build_draft_tracker_benchmark.R", warn = FALSE)
boundary <- grep("^base_dir <- resolve_base_dir", tracker)[1]
stopifnot(is.finite(boundary))
eval(parse(text = paste(tracker[seq_len(boundary - 1)], collapse = "\n")))
panel[, `:=`(pick_proxy = big_board_rank, pick_proxy_available = TRUE,
             age_feature = -z_within(draft_age, draft_year),
             pick_feature = -z_within(log1p(big_board_rank), draft_year),
             base_rank = frank(-TOTAL_pred, ties.method = "first"))]
adjustment <- fread(file.path(draft_dir, "draft_tracker_model_adjustment.csv"))
adjusted <- apply_final_adjustment_spread(panel,
  list(b_age = adjustment$b_age[[1]], b_pick = adjustment$b_pick[[1]]), getwd())

score_cols <- paste0("FINAL_", c("OFF", "DEF", "TOTAL", "FTD", "OREB", "PASS", "RIM", "SHOOT",
                                 "DPM", "DREB", "RIMPRO", "SWITCH"), "_pred")
stopifnot(identical(sort(as.integer(adjusted$FINAL_rank)), seq_len(nrow(eligible))),
          all(vapply(adjusted[, ..score_cols], function(x) all(is.finite(x)), logical(1))))
preview <- rows[, .(player, draft_year, big_board_rank, pre_draft_team, prediction_pool,
                    scv_draft, games, minutes, wingspan_in, wingspan_source_type, stats_status)]
scores <- adjusted[, c("big_board_rank", "FINAL_rank", score_cols), with = FALSE]
setnames(scores, "FINAL_rank", "model_rank")
preview <- merge(preview, scores, by = "big_board_rank", all.x = TRUE)
setcolorder(preview, c("player", "draft_year", "big_board_rank"))
stopifnot(nrow(preview) == 45, sum(is.finite(preview$model_rank)) == nrow(eligible))
fwrite(preview, args[[2]], na = "")
message("Scored ", nrow(eligible), " of 45 prospects using the saved draft models.")
