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

  normalizePath(file.path(getwd(), "script", "draft"), winslash = "/", mustWork = FALSE)
}

script_dir <- get_script_dir()
editor_script <- file.path(script_dir, "scv_editor.py")

if (!file.exists(editor_script)) {
  stop("Could not find Python SCV editor: ", editor_script)
}

python_cmd <- Sys.which("py")
if (!nzchar(python_cmd)) python_cmd <- Sys.which("python")
if (!nzchar(python_cmd)) python_cmd <- Sys.which("python3")

if (!nzchar(python_cmd)) {
  stop("Could not find Python. Install Python or run Launch SCV Editor.cmd.")
}

trailing_args <- commandArgs(trailingOnly = TRUE)
editor_args <- c(editor_script, trailing_args)
wait_for_editor <- any(trailing_args %in% c("--check", "--help", "-h"))
status <- system2(python_cmd, shQuote(editor_args), wait = wait_for_editor)
if (wait_for_editor && !identical(status, 0L)) {
  stop("Python SCV editor exited with status ", status)
}
