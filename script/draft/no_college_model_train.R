base_dir <- normalizePath(file.path(getwd()), winslash = "/", mustWork = FALSE)
if (!dir.exists(file.path(base_dir, "processed"))) {
  base_dir <- normalizePath(file.path(getwd(), ".."), winslash = "/", mustWork = FALSE)
}

draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

Sys.setenv(
  DRAFT_TRAINING_FILE = file.path(draft_dir, "no_college_training_data.csv"),
  DRAFT_PREDICTION_SPECS = sprintf("no_college=%s", file.path(draft_dir, "no_college_prediction.csv")),
  DRAFT_OUTPUT_PREDS = file.path(draft_dir, "no_college_skill_predictions_output.csv"),
  DRAFT_MODELS_RDS = file.path(draft_dir, "no_college_trained_skill_models.rds"),
  DRAFT_SUMMARY_FP = file.path(draft_dir, "no_college_model_summary.csv"),
  DRAFT_DETAIL_FP = file.path(draft_dir, "no_college_model_feature_details.csv"),
  DRAFT_SUMMARY_HISTORY_FP = file.path(draft_dir, "no_college_model_summary_history.csv"),
  DRAFT_MIN_TRAIN_ROWS = "20",
  DRAFT_FEATURE_PROFILE = "curated_realgm",
  DRAFT_MAX_FEATURE_MISSING_PCT = "0.30",
  DRAFT_FEATURE_MISSING_ALLOWLIST = "FTD=scv_draft;PASS=scv_draft"
)

source(file.path(base_dir, "script", "draft", "draftmodeltrain.txt"), local = new.env(parent = globalenv()))
