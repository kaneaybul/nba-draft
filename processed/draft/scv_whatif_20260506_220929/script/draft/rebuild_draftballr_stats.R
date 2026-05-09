library(jsonlite)
library(data.table)

cellify <- function(x) {
  if (is.null(x)) return(NA_character_)
  if (length(x) == 1 && (is.atomic(x) || is.character(x))) return(as.character(x))
  toJSON(x, auto_unbox = TRUE, null = "null")
}

read_stats_raw <- function(url) {
  tmp <- tempfile(fileext = ".json.gz")
  download.file(url, tmp, mode = "wb")
  con <- gzfile(tmp, open = "rt")
  txt <- readLines(con, warn = FALSE, encoding = "UTF-8")
  close(con)

  dat <- fromJSON(paste(txt, collapse = "\n"), simplifyVector = FALSE)

  rows <- lapply(dat$r, function(row) {
    vals <- lapply(row, cellify)
    names(vals) <- paste0("V", seq_along(vals))
    vals
  })

  out <- rbindlist(rows, fill = TRUE)
  setDT(out)
  out
}

read_named_df <- function(url) {
  tmp <- tempfile(fileext = ".json.gz")
  download.file(url, tmp, mode = "wb")
  con <- gzfile(tmp, open = "rt")
  txt <- readLines(con, warn = FALSE, encoding = "UTF-8")
  close(con)

  out <- fromJSON(paste(txt, collapse = "\n"), flatten = TRUE)
  setDT(out)
  out
}

score_match <- function(x, y) {
  x_chr <- trimws(as.character(x))
  y_chr <- trimws(as.character(y))

  if (length(x_chr) != length(y_chr)) return(NA_real_)

  chr_score <- NA_real_
  num_score <- NA_real_

  ok_chr <- !is.na(x_chr) & !is.na(y_chr) & x_chr != "" & y_chr != ""
  if (sum(ok_chr) >= 5) {
    chr_score <- mean(x_chr[ok_chr] == y_chr[ok_chr])
  }

  x_num <- suppressWarnings(as.numeric(x_chr))
  y_num <- suppressWarnings(as.numeric(y_chr))
  ok_num <- !is.na(x_num) & !is.na(y_num)
  if (sum(ok_num) >= 5) {
    num_score <- mean(abs(x_num[ok_num] - y_num[ok_num]) < 1e-8)
  }

  scores <- c(chr_score, num_score)
  scores <- scores[!is.na(scores)]

  if (length(scores) == 0) return(NA_real_)
  max(scores)
}

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
if (!dir.exists(file.path(base_dir, "script")) && dir.exists(file.path(base_dir, "..", "script"))) {
  base_dir <- normalizePath(file.path(base_dir, ".."), winslash = "/", mustWork = FALSE)
}

draft_dir <- file.path(base_dir, "processed", "draft")
dir.create(draft_dir, recursive = TRUE, showWarnings = FALSE)

output_fp <- Sys.getenv("DRAFTBALLR_OUTPUT", file.path(draft_dir, "draftballr.csv"))

raw_all <- read_stats_raw(
  "https://draftballr.com/api/stats/players?yearStart=2008&yearEnd=2026"
)

raw_2026 <- read_stats_raw(
  "https://draftballr.com/api/stats/players?yearStart=2026&yearEnd=2026"
)

bb_2026 <- read_named_df(
  "https://draftballr.com/api/big-board?year=2026"
)

player_hits <- sapply(raw_2026, function(col) sum(col %in% bb_2026$player, na.rm = TRUE))
player_col <- names(player_hits)[which.max(player_hits)]

setnames(raw_2026, player_col, "player")
setnames(raw_all, player_col, "player")

year_candidates <- names(raw_2026)[sapply(raw_2026, function(col) {
  vals <- suppressWarnings(as.integer(as.character(col)))
  any(!is.na(vals)) && all(vals[!is.na(vals)] >= 2008 & vals[!is.na(vals)] <= 2026)
})]

year_col <- NA_character_
if ("year" %in% names(raw_2026)) {
  year_col <- "year"
} else {
  year_match_counts <- sapply(year_candidates, function(col) {
    vals <- suppressWarnings(as.integer(as.character(raw_2026[[col]])))
    sum(vals == 2026, na.rm = TRUE)
  })
  if (length(year_match_counts) > 0) {
    year_col <- names(year_match_counts)[which.max(year_match_counts)]
  }
}

if (!is.na(year_col) && year_col != "year") {
  setnames(raw_2026, year_col, "year")
  if (year_col %in% names(raw_all)) {
    setnames(raw_all, year_col, "year")
  }
}

common_players <- intersect(raw_2026$player, bb_2026$player)
common_players <- common_players[!is.na(common_players)]

raw_match <- raw_2026[raw_2026$player %in% common_players, ]
bb_match <- bb_2026[bb_2026$player %in% common_players, ]

setorder(raw_match, player)
setorder(bb_match, player)

raw_match <- raw_match[!duplicated(player), ]
bb_match <- bb_match[!duplicated(player), ]

common_players <- intersect(raw_match$player, bb_match$player)
raw_match <- raw_match[raw_match$player %in% common_players, ]
bb_match <- bb_match[bb_match$player %in% common_players, ]

setorder(raw_match, player)
setorder(bb_match, player)

raw_cols <- grep("^V", names(raw_match), value = TRUE)
bb_cols <- setdiff(names(bb_match), "player")

rename_map <- list()
used_bb <- character()

for (rc in raw_cols) {
  scores <- sapply(bb_cols, function(bc) score_match(raw_match[[rc]], bb_match[[bc]]))

  if (all(is.na(scores))) next

  best_idx <- which.max(ifelse(is.na(scores), -Inf, scores))
  best_bc <- bb_cols[best_idx]
  best_score <- scores[best_idx]

  if (!is.na(best_score) && best_score >= 0.98 && !(best_bc %in% used_bb)) {
    rename_map[[rc]] <- best_bc
    used_bb <- c(used_bb, best_bc)
  }
}

for (old in names(rename_map)) {
  if (old %in% names(raw_all)) {
    setnames(raw_all, old, rename_map[[old]])
  }
}

keep_cols <- c("player", "year", unname(unlist(rename_map)))
keep_cols <- unique(keep_cols)
keep_cols <- keep_cols[keep_cols %in% names(raw_all)]

raw_all <- raw_all[, ..keep_cols]

if ("year" %in% names(raw_all)) {
  raw_all[, year := suppressWarnings(as.integer(year))]
}

if ("year" %in% names(raw_all)) {
  setorder(raw_all, player, -year)
} else {
  setorder(raw_all, player)
}

raw_all <- raw_all[!duplicated(player)]

final_cols <- c("player", "year", setdiff(names(raw_all), c("player", "year")))
final_cols <- final_cols[final_cols %in% names(raw_all)]
setcolorder(raw_all, final_cols)

fwrite(raw_all, output_fp, na = "")
cat("Wrote draftballr dataset ->", output_fp, "\n")
