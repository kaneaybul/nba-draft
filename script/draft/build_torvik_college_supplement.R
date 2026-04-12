if (!requireNamespace("data.table", quietly = TRUE)) install.packages("data.table")
library(data.table)

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

anglicize_text <- function(x) {
  x <- as.character(x)
  converted <- suppressWarnings(iconv(x, from = "", to = "ASCII//TRANSLIT"))
  fill_idx <- is.na(converted) & !is.na(x)
  converted[fill_idx] <- x[fill_idx]
  trimws(converted)
}

normalize_join_name <- function(x) {
  x <- anglicize_text(x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

load_torvik_cache <- function(draft_dir) {
  torvik_files <- list.files(draft_dir, pattern = "^torvik_\\d{4}\\.csv$", full.names = TRUE)
  if (!length(torvik_files)) {
    return(NULL)
  }

  cache_dt <- rbindlist(lapply(torvik_files, function(fp) {
    tryCatch(fread(fp, na.strings = c("", "NA", "N/A", "NaN")), error = function(e) NULL)
  }), use.names = TRUE, fill = TRUE)

  if (!nrow(cache_dt)) {
    return(NULL)
  }

  if ("player" %in% names(cache_dt)) {
    cache_dt[, player := anglicize_text(player)]
    cache_dt[, join_player := normalize_join_name(player)]
  } else {
    cache_dt[, join_player := ""]
  }

  if ("year" %in% names(cache_dt) && !"draft_year" %in% names(cache_dt)) {
    cache_dt[, draft_year := suppressWarnings(as.integer(year))]
  } else if ("season" %in% names(cache_dt) && !"draft_year" %in% names(cache_dt)) {
    cache_dt[, draft_year := suppressWarnings(as.integer(season))]
  } else if ("draft_year" %in% names(cache_dt)) {
    cache_dt[, draft_year := suppressWarnings(as.integer(draft_year))]
  } else {
    cache_dt[, draft_year := NA_integer_]
  }

  if ("id" %in% names(cache_dt) && !"player_id" %in% names(cache_dt)) {
    cache_dt[, player_id := as.character(id)]
  } else if ("player_id" %in% names(cache_dt)) {
    cache_dt[, player_id := as.character(player_id)]
  }

  cache_dt
}

load_supplement_specs <- function(path) {
  if (file.exists(path)) {
    spec_dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
    if (nrow(spec_dt)) {
      if (!"player" %in% names(spec_dt) || !"draft_year" %in% names(spec_dt)) {
        stop("Torvik supplement target file must include player and draft_year columns: ", path)
      }
      if (!"player_id" %in% names(spec_dt)) spec_dt[, player_id := NA_character_]
      return(spec_dt[, .(player = as.character(player), draft_year = suppressWarnings(as.integer(draft_year)), player_id = as.character(player_id))])
    }
  }

  rbindlist(list(
    data.table(player = "Donovan Mitchell", draft_year = 2017L, player_id = "41754"),
    data.table(player = "Bam Adebayo", draft_year = 2017L, player_id = "47569"),
    data.table(player = "Mo Bamba", draft_year = 2018L, player_id = "51204"),
    data.table(player = "Svi Mykhailiuk", draft_year = 2018L, player_id = "34388"),
    data.table(player = "Grant Williams", draft_year = 2019L, player_id = "49187"),
    data.table(player = "GG Jackson", draft_year = 2023L, player_id = "76398"),
    data.table(player = "DJ Mitchell", draft_year = 2018L, player_id = "49374")
  ))
}

extract_torvik_player_row <- function(dt, player_name = NULL, player_id = NULL, draft_year = NULL) {
  work_dt <- copy(dt)
  if (!is.null(draft_year) && is.finite(draft_year)) {
    draft_year_value <- suppressWarnings(as.integer(draft_year))
    work_dt <- work_dt[draft_year == draft_year_value]
  }

  if (!is.null(player_id) && nzchar(trimws(player_id)) && "player_id" %in% names(work_dt)) {
    id_value <- as.character(player_id)
    id_match <- work_dt[as.character(player_id) == id_value]
    if (nrow(id_match)) return(id_match[1])
  }

  if (!is.null(player_name) && nzchar(trimws(player_name))) {
    name_match <- work_dt[join_player == normalize_join_name(player_name)]
    if (nrow(name_match)) return(name_match[1])
  }

  NULL
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

cache_pull_script <- file.path(base_dir, "script", "draft", "pull_torvik_player_cache.R")
output_fp <- file.path(draft_dir, "draft_prediction_source_supplement.csv")
target_fp <- Sys.getenv(
  "TORVIK_SUPPLEMENT_TARGETS_FILE",
  file.path(draft_dir, "torvik_supplement_targets.csv")
)
auto_pull <- identical(tolower(trimws(Sys.getenv("TORVIK_AUTO_PULL", "false"))), "true")

torvik_dt <- load_torvik_cache(draft_dir)
if ((is.null(torvik_dt) || !nrow(torvik_dt)) && auto_pull && file.exists(cache_pull_script)) {
  source(cache_pull_script, local = new.env(parent = globalenv()))
  torvik_dt <- load_torvik_cache(draft_dir)
}

if (is.null(torvik_dt) || !nrow(torvik_dt)) {
  fwrite(data.table(player = character(), draft_year = integer(), player_id = character()), output_fp)
  message("No cached Torvik CSVs found. Wrote empty supplement -> ", output_fp)
} else {
  supplement_specs <- load_supplement_specs(target_fp)

  rows <- lapply(seq_len(nrow(supplement_specs)), function(i) {
    spec <- supplement_specs[i]
    row <- extract_torvik_player_row(
      torvik_dt,
      player_name = spec$player[[1]],
      player_id = spec$player_id[[1]],
      draft_year = spec$draft_year[[1]]
    )

    if (is.null(row) || !nrow(row)) {
      return(data.table(
        player = spec$player[[1]],
        draft_year = spec$draft_year[[1]],
        player_id = spec$player_id[[1]]
      ))
    }

    out <- as.data.table(copy(row))
    out[, player := anglicize_text(spec$player[[1]])]
    out[, draft_year := spec$draft_year[[1]]]
    if (!"player_id" %in% names(out)) out[, player_id := spec$player_id[[1]]]
    out
  })

  supplement_dt <- rbindlist(rows, use.names = TRUE, fill = TRUE)
  fwrite(supplement_dt, output_fp, na = "")
  message("Wrote Torvik-based college supplement -> ", output_fp)
}
