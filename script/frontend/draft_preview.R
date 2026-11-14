build_draft_preview <- function(base_dir, impact_reference, replacement_reference, published_years) {
  draft_dir <- file.path(base_dir, "processed", "draft")
  score_path <- file.path(draft_dir, "draft_skill_preview_2027.csv")
  source_path <- file.path(draft_dir, "draft_consensus_projection_ranks_2027.csv")
  if (2027L %in% published_years || !file.exists(score_path) || !file.exists(source_path)) {
    return(NULL)
  }

  scores <- read.csv(score_path, check.names = FALSE)
  sources <- read.csv(source_path, check.names = FALSE)
  key <- function(rows) paste(rows$draft_year, rows$big_board_rank, rows$player)
  stopifnot(!anyDuplicated(key(scores)), !anyDuplicated(key(sources)),
            setequal(key(scores), key(sources)), all(scores$draft_year == 2027L))
  scores <- scores[!is.na(scores$model_rank), , drop = FALSE]
  if (!nrow(scores)) return(NULL)
  sources <- sources[match(key(scores), key(sources)), , drop = FALSE]

  rows <- data.frame(
    player = scores$player,
    draft_year = scores$draft_year,
    rank_in_class = scores$model_rank,
    prediction_pool = scores$prediction_pool,
    scv_draft = scores$scv_draft,
    draft_age = sources$draft_age,
    height_wo_shoes_in = sources$height_wo_shoes_in,
    wingspan_in = sources$wingspan_in,
    weight_lbs = sources$weight_lbs,
    position = sources$board_position,
    college = sources$pre_draft_team,
    pre_draft_team = sources$pre_draft_team,
    pick_proxy = scores$big_board_rank,
    pick_proxy_available = TRUE,
    stringsAsFactors = FALSE
  )
  for (skill in c("FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH", "OFF", "DEF", "TOTAL")) {
    column <- paste0(skill, "_pred")
    values <- scores[[paste0("FINAL_", column)]]
    stopifnot(length(values) == nrow(rows), all(is.finite(values)))
    rows[[column]] <- values
  }
  shares <- position_share_matrix_from_labels(rows$position)
  rows <- cbind(rows, as.data.frame(shares))
  rows$position_index <- round(position_index_from_shares(shares), 4)
  rows$position_entropy <- round(position_entropy_from_shares(shares), 4)
  rows$replacement_total <- draft_replacement_total(rows$position, replacement_reference, as.data.frame(shares))
  rows$timin <- round((rows$TOTAL_pred - rows$replacement_total) * 1800, 1)
  rows$score <- round(100 * (
    0.35 * percent_rank_against(rows$timin, impact_reference$timin) +
      0.65 * percent_rank_against(rows$TOTAL_pred, impact_reference$total)
  ), 1)
  rows$tier <- draft_tier_from_score(rows$score)
  rows[order(rows$rank_in_class), , drop = FALSE]
}
