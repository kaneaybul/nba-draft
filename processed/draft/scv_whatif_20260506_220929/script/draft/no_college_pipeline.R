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
  cat("\n=== ", label, " ===\n", sep = "")
  cat("Running: ", script_path, "\n", sep = "")
  source(script_path, local = new.env(parent = globalenv()))
  cat("Completed: ", label, "\n", sep = "")
}

base_dir <- resolve_base_dir()

run_step(base_dir, "Build No-College Cohort", file.path("script", "draft", "build_no_college_cohort.R"))
run_step(base_dir, "Scrape RealGM No-College Stats", file.path("script", "draft", "scrape_no_college_realgm.R"))
run_step(base_dir, "Build No-College Training Data", file.path("script", "draft", "build_no_college_training_data.R"))
run_step(base_dir, "Train No-College Models", file.path("script", "draft", "no_college_model_train.R"))

cat("\nNo-college draft pipeline complete.\n")
