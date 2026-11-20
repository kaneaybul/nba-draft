# Shadow producer: use actual upstream R code, exit before any minute/forecast export.
a <- commandArgs(trailingOnly = TRUE)
if (length(a) != 3L) stop("Expected isolated repo, private output and season")
base_dir <- normalizePath(a[1L], mustWork = TRUE)
out <- a[2L]
season <- as.integer(a[3L])
if (!startsWith(out, "/") || file.exists(out) || startsWith(out, paste0(base_dir, "/")) ||
    is.na(season)) stop("Need fresh private output outside checkout")
setwd(base_dir)
txt <- readLines("script/frontend/export_frontend_data.R")
end <- grep("^base_dir <- resolve_base_dir\\(\\)$", txt)
if (length(end) != 1L) stop("Unknown exporter entry point")
eval(parse(text = txt[seq_len(end - 1L)]), globalenv())
for (name in c("script/draft/name_matching.R", "script/data/darko_dpm_fallback.R",
               "script/frontend/injury_projections.R", "script/frontend/live_ratings.R",
               "script/frontend/player_pool.R", "script/frontend/live_minutes.R")) source(name)
options(nba.shared_minutes_input_capture = function(rows) {
  keys <- c("year", "team", "team_projection_base", "nba_id", "source_nba_id",
            "player_name", "age", "yoe", "total", "games", "p_mpg", "Minutes",
            "pool_status", "contract_pending", "pg_share", "sg_share", "sf_share", "pf_share", "c_share",
            paste0("projection_mpg_y", 1:5))
  if (!all(keys %in% names(rows))) stop("Incomplete upstream shared role schema")
  rows <- rows[which(rows$pool_status == "roster" & rows$year == season), keys, drop = FALSE]
  if (!nrow(rows)) stop("No current signed role candidates")
  jsonlite::write_json(rows, out, dataframe = "rows", auto_unbox = TRUE, na = "null", digits = 16)
  stop(structure(list(message = "Private upstream capture complete", call = NULL),
                 class = c("shared_minutes_capture_done", "error", "condition")))
})
captured <- tryCatch({build_impact_players(base_dir); FALSE},
                     shared_minutes_capture_done = function(e) TRUE)
if (!captured || !file.exists(out)) stop("Early capture hook did not run")
