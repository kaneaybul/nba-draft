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
    if (dir.exists(file.path(candidate, "raw")) && dir.exists(file.path(candidate, "script"))) {
      return(candidate)
    }
  }
  stop("Could not resolve project root.")
}

frontend_timing_run_id <- function() {
  run_id <- Sys.getenv("FRONTEND_REFRESH_RUN_ID", "")
  if (!nzchar(run_id)) {
    run_id <- format(Sys.time(), "%Y%m%dT%H%M%SZ", tz = "UTC")
    Sys.setenv(FRONTEND_REFRESH_RUN_ID = run_id)
  }
  run_id
}

frontend_timing_path <- function(base_dir) {
  file.path(base_dir, "processed", "logs", "frontend_refresh_timings.csv")
}

frontend_log_timing <- function(base_dir, phase, step, status, started_at, finished_at, detail = "") {
  path <- frontend_timing_path(base_dir)
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  elapsed_seconds <- as.numeric(difftime(finished_at, started_at, units = "secs"))
  row <- data.frame(
    run_id = frontend_timing_run_id(),
    phase = phase,
    step = step,
    status = status,
    started_at = format(started_at, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    finished_at = format(finished_at, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    elapsed_seconds = round(elapsed_seconds, 3),
    detail = detail,
    stringsAsFactors = FALSE
  )
  write.table(
    row,
    file = path,
    sep = ",",
    row.names = FALSE,
    col.names = !file.exists(path),
    append = file.exists(path),
    quote = TRUE
  )
  message(sprintf("Timing: [%s] %s - %s in %.3fs", status, step, phase, elapsed_seconds))
}

with_frontend_timing <- function(base_dir, phase, step, expr, detail = "") {
  started_at <- Sys.time()
  tryCatch(
    {
      result <- force(expr)
      frontend_log_timing(base_dir, phase, step, "success", started_at, Sys.time(), detail)
      invisible(result)
    },
    error = function(e) {
      frontend_log_timing(base_dir, phase, step, "failed", started_at, Sys.time(), conditionMessage(e))
      stop(e)
    }
  )
}

print_frontend_timing_summary <- function(base_dir) {
  path <- frontend_timing_path(base_dir)
  run_id <- frontend_timing_run_id()
  if (!file.exists(path)) {
    return(invisible(NULL))
  }
  timings <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  timings <- timings[timings$run_id == run_id, , drop = FALSE]
  if (!nrow(timings)) {
    return(invisible(NULL))
  }

  message("")
  message("Frontend refresh timing summary")
  message("Log: ", path)
  for (i in seq_len(nrow(timings))) {
    message(sprintf(
      "- %s / %s: %s (%.3fs)",
      timings$phase[i],
      timings$step[i],
      timings$status[i],
      suppressWarnings(as.numeric(timings$elapsed_seconds[i]))
    ))
  }
}

run_script <- function(base_dir, label, relative_path) {
  message("")
  message("=== ", label, " ===")
  suppress_export_summary <- basename(relative_path) == "export_frontend_data.R"
  old_suppress_export_summary <- Sys.getenv("FRONTEND_REFRESH_SUPPRESS_EXPORT_SUMMARY", unset = NA_character_)
  if (suppress_export_summary) {
    Sys.setenv(FRONTEND_REFRESH_SUPPRESS_EXPORT_SUMMARY = "true")
    on.exit({
      if (is.na(old_suppress_export_summary)) {
        Sys.unsetenv("FRONTEND_REFRESH_SUPPRESS_EXPORT_SUMMARY")
      } else {
        Sys.setenv(FRONTEND_REFRESH_SUPPRESS_EXPORT_SUMMARY = old_suppress_export_summary)
      }
    }, add = TRUE)
  }
  with_frontend_timing(
    base_dir,
    "frontend_refresh",
    label,
    source(file.path(base_dir, relative_path), local = new.env(parent = globalenv())),
    relative_path
  )
}

run_node_script <- function(base_dir, label, relative_path) {
  node_bin <- Sys.which("node")
  script_path <- file.path(base_dir, relative_path)
  if (!file.exists(script_path) || !nzchar(node_bin)) {
    message("Skipping ", label, ": node or script not available.")
    return(invisible(NULL))
  }

  message("")
  message("=== ", label, " ===")
  with_frontend_timing(
    base_dir,
    "frontend_refresh",
    label,
    {
      output <- system2(node_bin, script_path, stdout = TRUE, stderr = TRUE)
      status <- attr(output, "status")
      if (length(output)) message(paste(output, collapse = "\n"))
      if (!is.null(status) && status != 0) {
        stop(paste0(label, " failed with exit status ", status))
      }
      invisible(output)
    },
    relative_path
  )
}

base_dir <- resolve_base_dir()
if (!nzchar(Sys.getenv("REFRESH_FULL_SWITCH_HISTORY"))) {
  Sys.setenv(REFRESH_FULL_SWITCH_HISTORY = "false")
}

run_script(base_dir, "Refresh backend outputs", file.path("script", "refresh_outputs_2026.txt"))
run_script(base_dir, "Refresh Basketball-Reference availability data", file.path("script", "data", "pull_bref_player_seasons.R"))
run_script(base_dir, "Refresh contract data", file.path("script", "data", "pull_contracts_databallr.R"))
run_node_script(base_dir, "Build cap transaction review", file.path("script", "frontend", "build_cap_transaction_review.mjs"))
run_script(base_dir, "Refresh salary cap assumptions", file.path("script", "data", "pull_salary_cap_assumptions.R"))
run_script(base_dir, "Score career projections", file.path("script", "models", "score_career_projection_models.R"))
run_script(base_dir, "Export frontend data", file.path("script", "frontend", "export_frontend_data.R"))

message("")
message("Frontend refresh complete. Click Reload data in the app, or refresh the browser.")
print_frontend_timing_summary(base_dir)
