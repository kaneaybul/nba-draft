get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    script_path <- sub(file_arg, "", script_arg[[1]])
    return(dirname(normalizePath(script_path, winslash = "/", mustWork = FALSE)))
  }
  normalizePath(file.path(getwd(), "script", "draft"), winslash = "/", mustWork = FALSE)
}

script_dir <- get_script_dir()
source(file.path(script_dir, "scv_editor_app.R"), local = TRUE)

app <- build_scv_editor_app()
shiny::runApp(app, launch.browser = TRUE)
