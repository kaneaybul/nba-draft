if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required.")
}
library(data.table)

base_dir <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
draft_dir <- file.path(base_dir, "processed", "draft")
ref_path <- file.path(base_dir, "ref", "draft_measurement_completions.csv")

source(file.path(base_dir, "script", "draft", "name_matching.R"), local = TRUE)
source(file.path(base_dir, "script", "draft", "draft_model_common.R"), local = TRUE)

read_dt <- function(path) fread(path, na.strings = c("", "NA", "N/A", "NaN"))

write_dt <- function(dt, path) {
  fwrite(dt, path, na = "")
}

norm_key <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(trimws(x))
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

apply_completions <- function(dt, completions, scv_lookup) {
  if (!nrow(dt) || !all(c("player", "draft_year") %in% names(dt))) return(dt)

  out <- copy(dt)
  for (col in c("wingspan_in", "weight_lbs", "scv_draft")) {
    if (!col %in% names(out)) out[, (col) := NA_real_]
    out[, (col) := suppressWarnings(as.numeric(get(col)))]
  }

  out[, row_id___ := .I]
  out[, key___ := norm_key(player)]
  out[, draft_year := suppressWarnings(as.integer(draft_year))]

  comp <- copy(completions[, .(
    key___,
    draft_year,
    fill_wingspan_in = suppressWarnings(as.numeric(wingspan_in)),
    fill_weight_lbs = suppressWarnings(as.numeric(weight_lbs)),
    fill_scv_draft = suppressWarnings(as.numeric(scv_draft))
  )])
  setorder(comp, key___, draft_year)
  comp <- unique(comp, by = c("key___", "draft_year"))

  merged <- merge(out, comp, by = c("key___", "draft_year"), all.x = TRUE, sort = FALSE)
  setorder(merged, row_id___)

  merged[!is.finite(wingspan_in) & is.finite(fill_wingspan_in), wingspan_in := fill_wingspan_in]
  merged[!is.finite(weight_lbs) & is.finite(fill_weight_lbs), weight_lbs := fill_weight_lbs]
  merged[!is.finite(scv_draft) & is.finite(fill_scv_draft), scv_draft := fill_scv_draft]

  merged[, c("row_id___", "key___", "fill_wingspan_in", "fill_weight_lbs", "fill_scv_draft") := NULL]
  merged <- as.data.table(add_scv_draft_feature(merged, scv_lookup))
  merged[]
}

if (!file.exists(ref_path)) {
  stop("Measurement completion reference not found: ", ref_path)
}

completions <- read_dt(ref_path)
completions[, key___ := norm_key(player)]
scv_lookup <- load_scv_draft_lookup(
  file.path(base_dir, "ref", "scvardraft.csv"),
  file.path(base_dir, "ref", "scvardraft_overrides.csv")
)

target_files <- file.path(draft_dir, c(
  "draft_training_data.csv",
  "draft_prediction_domestic.csv",
  "draft_prediction_international.csv",
  "draft_prediction_unified.csv"
))
target_files <- target_files[file.exists(target_files)]

coverage_rows <- lapply(target_files, function(path) {
  before <- read_dt(path)
  after <- apply_completions(before, completions, scv_lookup)
  write_dt(after, path)

  data.table(
    file = basename(path),
    rows = nrow(after),
    wingspan_present = sum(is.finite(suppressWarnings(as.numeric(after$wingspan_in)))),
    weight_present = sum(is.finite(suppressWarnings(as.numeric(after$weight_lbs)))),
    scv_present = sum(is.finite(suppressWarnings(as.numeric(after$scv_draft))))
  )
})

coverage <- rbindlist(coverage_rows, use.names = TRUE, fill = TRUE)
write_dt(coverage, file.path(draft_dir, "draft_measurement_completion_coverage.csv"))
print(coverage)
