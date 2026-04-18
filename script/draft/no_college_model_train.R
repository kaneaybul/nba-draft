get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    script_path <- sub(file_arg, "", script_arg[[1]])
    return(dirname(normalizePath(script_path, winslash = "/", mustWork = FALSE)))
  }

  ofile <- NULL
  frame_list <- sys.frames()
  if (length(frame_list) > 0) {
    for (i in rev(seq_along(frame_list))) {
      if (!is.null(frame_list[[i]]$ofile)) {
        ofile <- frame_list[[i]]$ofile
        break
      }
    }
  }

  if (!is.null(ofile)) {
    return(dirname(normalizePath(ofile, winslash = "/", mustWork = FALSE)))
  }

  NULL
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  env_base_dir <- trimws(Sys.getenv("CLEANNBA_BASE_DIR", ""))
  candidates <- c(
    getwd(),
    if (!is.null(script_dir)) script_dir else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..") else NULL,
    if (!is.null(script_dir)) file.path(script_dir, "..", "..") else NULL,
    file.path(getwd(), ".."),
    file.path(getwd(), "..", ".."),
    if (nzchar(env_base_dir)) env_base_dir else NULL
  )
  candidates <- unique(candidates[!is.na(candidates) & nzchar(candidates)])

  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

base_dir <- resolve_base_dir()
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
  DRAFT_MODEL_FAMILIES = "elastic_net_family",
  DRAFT_GLOBAL_FEATURE_CAP = "4",
  DRAFT_MAX_FEATURE_MISSING_PCT = "0.30",
  DRAFT_FEATURE_MISSING_ALLOWLIST = "FTD=scv_draft;PASS=scv_draft"
)

source(file.path(base_dir, "script", "draft", "draftmodeltrain.txt"), local = new.env(parent = globalenv()))
