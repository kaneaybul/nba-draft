library(data.table)

resolve_base_dir <- function() {
  wd <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
  candidates <- unique(c(wd, file.path(wd, ".."), file.path(wd, "..", "..")))
  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "script")) &&
        dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }
  stop("Could not resolve project root from working directory: ", getwd())
}

base_dir <- resolve_base_dir()
draft_dir <- file.path(base_dir, "processed", "draft")
source(file.path(base_dir, "script", "draft", "name_matching.R"), local = FALSE)

gp <- 24
min_pg <- 30.6
pts_pg <- 17.96
fgm_pg <- 7.25
fga_pg <- 13.04
x3pm_pg <- 0.71
x3pa_pg <- 2.17
ftm_pg <- 1.58
fta_pg <- 2.00
orb_pg <- 3.21
drb_pg <- 7.75
trb_pg <- 10.96
ast_pg <- 1.58
stl_pg <- 0.92
blk_pg <- 0.88
tov_pg <- 1.50
pf_pg <- 2.50

per36 <- function(x) x / min_pg * 36

leonard <- data.table(
  player = "Leonard Miller",
  draft_year = 2023L,
  realgm_profile_url = "https://basketball.realgm.com/player/Leonard-Miller/Summary/150556",
  pre_draft_team = "NBA G League Ignite",
  source_section = "G League Career",
  source_stat_label = "G League Regular Season Stats",
  source_season = "2022-2023",
  source_team = "IGN",
  source_league = "NBA G League",
  source_priority = 105L,
  sum_season = "2022-2023",
  sum_age = 19,
  sum_team = "IGN",
  sum_league = "NBA G League",
  sum_gp = gp,
  sum_min = min_pg,
  sum_pts = pts_pg,
  sum_reb = trb_pg,
  sum_ast = ast_pg,
  sum_stl = stl_pg,
  sum_blk = blk_pg,
  sum_tov = tov_pg,
  sum_fg_pct = 0.556,
  sum_x3p_pct = 0.327,
  sum_ft_pct = 0.792,
  sum_fgm = fgm_pg,
  sum_fga = fga_pg,
  sum_xx3pm = x3pm_pg,
  sum_xx3pa = x3pa_pg,
  sum_ftm = ftm_pg,
  sum_fta = fta_pg,
  sum_trb = trb_pg,
  sum_pf = pf_pg,
  source_season_end = 2023L,
  source_minutes_num = min_pg,
  source_is_aggregate = FALSE,
  misc_ts_pct = round(pts_pg / (2 * (fga_pg + 0.44 * fta_pg)), 3),
  misc_efg_pct = round((fgm_pg + 0.5 * x3pm_pg) / fga_pg, 3),
  misc_pps = round(pts_pg / (fga_pg + 0.44 * fta_pg), 3),
  per36_pts = per36(pts_pg),
  per36_trb = per36(trb_pg),
  per36_ast = per36(ast_pg),
  per36_stl = per36(stl_pg),
  per36_blk = per36(blk_pg),
  per36_tov = per36(tov_pg),
  per36_fgm = per36(fgm_pg),
  per36_fga = per36(fga_pg),
  per36_x3pm = per36(x3pm_pg),
  per36_x3pa = per36(x3pa_pg),
  per36_ftm = per36(ftm_pg),
  per36_fta = per36(fta_pg),
  per36_off = per36(orb_pg),
  per36_def = per36(drb_pg),
  per36_pf = per36(pf_pg),
  realgm_player_name = "Leonard Miller",
  high_school = "Fort Erie International Academy",
  nationality = "Canada",
  manual_source = "realgm",
  manual_source_url = "https://basketball.realgm.com/player/Leonard-Miller/D-League/150556/Career/By_Split",
  source_url = "https://basketball.realgm.com/player/Leonard-Miller/D-League/150556/Career/By_Split",
  source_note = "Manual 2022-23 NBA G League Ignite regular-season per-game row from RealGM; RealGM profile scraper did not expose this as a pre-draft row automatically.",
  manual_replace_scope = "player_year"
)

manual_fp <- file.path(draft_dir, "no_college_manual_stats.csv")
old <- if (file.exists(manual_fp)) fread(manual_fp, na.strings = c("", "NA", "N/A", "NaN")) else data.table()
if (nrow(old)) {
  old[, player_key___ := normalize_join_name(player)]
  old[, draft_year := suppressWarnings(as.integer(draft_year))]
  old <- old[!(player_key___ == normalize_join_name("Leonard Miller") & draft_year == 2023L)]
  old[, player_key___ := NULL]
}

out <- rbindlist(list(old, leonard), use.names = TRUE, fill = TRUE)
fwrite(out, manual_fp, na = "")

print(leonard[, .(
  player,
  draft_year,
  source_stat_label,
  sum_gp,
  sum_min,
  sum_pts,
  sum_reb,
  sum_ast,
  sum_stl,
  sum_blk
)])
