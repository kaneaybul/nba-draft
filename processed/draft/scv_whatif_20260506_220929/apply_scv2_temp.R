library(data.table)
normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  x <- gsub("[^a-z0-9]+", "", x)
  x
}
root <- "C:/Users/brend/Documents/projects/nba&draft/processed/draft/scv_whatif_20260506_220929"
sc <- fread("C:/Users/brend/Desktop/scdraftv2.csv")
setnames(sc, names(sc), tolower(names(sc)))
sc[, join_player := normalize_name(name)]
sc[, sc_new := suppressWarnings(as.numeric(sc))]
sc <- sc[is.finite(sc_new) & nzchar(join_player)]
setorder(sc, join_player, year)
sc <- unique(sc[, .(join_player, sc_new)], by = "join_player")
update_file <- function(path) {
  if (!file.exists(path)) return(NULL)
  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  name_col <- names(dt)[tolower(names(dt)) %in% c("player", "name")][1]
  if (is.na(name_col)) return(NULL)
  dt[, join_player_tmp := normalize_name(get(name_col))]
  dt <- merge(dt, sc, by.x = "join_player_tmp", by.y = "join_player", all.x = TRUE, sort = FALSE)
  if (!"scv_draft" %in% names(dt)) dt[, scv_draft := NA_real_]
  dt[is.finite(sc_new), scv_draft := sc_new]
  changed <- sum(is.finite(dt$sc_new))
  dt[, c("join_player_tmp", "sc_new") := NULL]
  fwrite(dt, path, na = "")
  data.table(file = basename(path), rows = nrow(dt), sc_replaced_rows = changed)
}
files <- file.path(root, "processed", "draft", c(
  "draft_training_data.csv",
  "draft_prediction_domestic.csv",
  "draft_prediction_international.csv",
  "draft_prediction_source_base.csv",
  "draft_prediction_source_supplement.csv",
  "draft_prediction_unified.csv"
))
print(rbindlist(lapply(files, update_file), fill = TRUE))
