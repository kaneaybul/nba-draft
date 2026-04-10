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

run_step <- function(base_dir, label, relative_path) {
  script_path <- file.path(base_dir, relative_path)
  message("")
  message("=== ", label, " ===")
  message("Running: ", script_path)

  tryCatch(
    {
      source(script_path, local = new.env(parent = globalenv()))
      message("Completed: ", label)
    },
    error = function(e) {
      stop(
        paste0(
          "Pipeline stopped at '", label, "' (", relative_path, ").\n",
          "Error: ", conditionMessage(e)
        ),
        call. = FALSE
      )
    }
  )
}

run_step_if_present <- function(base_dir, label, relative_path) {
  script_path <- file.path(base_dir, relative_path)
  if (!file.exists(script_path)) {
    message("")
    message("=== ", label, " ===")
    message("Skipping missing optional step: ", script_path)
    return(invisible(NULL))
  }
  run_step(base_dir, label, relative_path)
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

run_full_no_college_pipeline <- identical(
  tolower(trimws(Sys.getenv("DRAFT_RUN_FULL_NO_COLLEGE_PIPELINE", "false"))),
  "true"
)

run_step(base_dir, "Build Draft Source Tables", file.path("script", "draft", "build_draft_source_tables.R"))
run_step_if_present(base_dir, "Pull Torvik Player Cache", file.path("script", "draft", "pull_torvik_player_cache.R"))
run_step(base_dir, "Build Torvik College Supplements", file.path("script", "draft", "build_torvik_college_supplement.R"))
run_step(base_dir, "Apply Main Draft Source Supplements", file.path("script", "draft", "apply_main_prediction_supplements.R"))
run_step(base_dir, "Refresh Main Draft Predictions", file.path("script", "draft", "draftmodeltrain.txt"))

if (run_full_no_college_pipeline) {
  run_step_if_present(base_dir, "Refresh Full No-College Pipeline", file.path("script", "draft", "no_college_pipeline.R"))
} else {
  run_step(base_dir, "Build No-College Training Data", file.path("script", "draft", "build_no_college_training_data.R"))
  run_step(base_dir, "Refresh No-College Predictions", file.path("script", "draft", "no_college_model_train.R"))
}

run_step(base_dir, "Combine Draft Prediction Outputs", file.path("script", "draft", "combine_draft_prediction_outputs.R"))

message("")
message("Unified draft prediction pipeline complete.")
message("Tip: set DRAFT_RUN_FULL_NO_COLLEGE_PIPELINE=true if you want this wrapper to rerun the full RealGM no-college scrape path too.")
