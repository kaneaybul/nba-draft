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

run_script <- function(base_dir, label, relative_path) {
  message("")
  message("=== ", label, " ===")
  source(file.path(base_dir, relative_path), local = new.env(parent = globalenv()))
}

base_dir <- resolve_base_dir()
if (!nzchar(Sys.getenv("REFRESH_FULL_SWITCH_HISTORY"))) {
  Sys.setenv(REFRESH_FULL_SWITCH_HISTORY = "false")
}

run_script(base_dir, "Refresh backend outputs", file.path("script", "refresh_outputs_2026.txt"))
run_script(base_dir, "Refresh Basketball-Reference availability data", file.path("script", "data", "pull_bref_player_seasons.R"))
run_script(base_dir, "Refresh contract data", file.path("script", "data", "pull_contracts_databallr.R"))
run_script(base_dir, "Refresh salary cap assumptions", file.path("script", "data", "pull_salary_cap_assumptions.R"))
run_script(base_dir, "Score career projections", file.path("script", "models", "score_career_projection_models.R"))
run_script(base_dir, "Export frontend data", file.path("script", "frontend", "export_frontend_data.R"))

message("")
message("Frontend refresh complete. Click Reload data in the app, or refresh the browser.")
