suppressPackageStartupMessages({
  library(data.table)
})

`%||%` <- function(x, y) {
  if (is.null(x) || !length(x) || is.na(x)) y else x
}

script_path <- tryCatch(normalizePath(sys.frame(1)$ofile, mustWork = FALSE), error = function(e) NA_character_)
if (!is.na(script_path) && nzchar(script_path)) {
  base_dir <- normalizePath(file.path(dirname(script_path), "..", ".."), mustWork = FALSE)
} else {
  base_dir <- normalizePath(getwd(), mustWork = TRUE)
}
if (!dir.exists(file.path(base_dir, "processed"))) {
  base_dir <- normalizePath(getwd(), mustWork = TRUE)
}

safe_num <- function(x) suppressWarnings(as.numeric(x))

safe_r2 <- function(actual, pred) {
  ok <- is.finite(actual) & is.finite(pred)
  if (sum(ok) < 3L) return(NA_real_)
  sse <- sum((actual[ok] - pred[ok])^2)
  sst <- sum((actual[ok] - mean(actual[ok]))^2)
  if (!is.finite(sst) || sst <= 0) return(NA_real_)
  1 - sse / sst
}

eval_lm_loyo <- function(dt, features, target = "RIM") {
  keep <- c("player", "draft_year", target, features)
  x <- copy(dt[, ..keep])
  for (col in c(target, features)) x[[col]] <- safe_num(x[[col]])
  x <- x[complete.cases(x[, c(target, features), with = FALSE])]
  years <- sort(unique(x$draft_year))
  if (length(years) < 3L || nrow(x) < 30L) return(NULL)

  preds <- vector("list", length(years))
  for (i in seq_along(years)) {
    yr <- years[[i]]
    train <- x[draft_year != yr]
    test <- x[draft_year == yr]
    if (nrow(train) < 20L || nrow(test) < 3L) next
    form <- as.formula(paste(target, "~", paste(features, collapse = " + ")))
    fit <- tryCatch(lm(form, data = train), error = function(e) NULL)
    if (is.null(fit)) next
    pred <- tryCatch(as.numeric(predict(fit, newdata = test)), error = function(e) rep(NA_real_, nrow(test)))
    preds[[i]] <- data.table(draft_year = yr, actual = test[[target]], pred = pred)
  }

  pred_dt <- rbindlist(preds, fill = TRUE)
  if (!nrow(pred_dt)) return(NULL)
  data.table(
    model = "lm_loyo",
    features = paste(features, collapse = ", "),
    n_features = length(features),
    n_rows = nrow(x),
    validation_rows = nrow(pred_dt[is.finite(actual) & is.finite(pred)]),
    temporal_r2 = safe_r2(pred_dt$actual, pred_dt$pred),
    temporal_mse = mean((pred_dt$actual - pred_dt$pred)^2, na.rm = TRUE)
  )
}

eval_ranger_loyo <- function(dt, features, target = "RIM", mtry = NULL, min_node_size = 5L, sample_fraction = 0.65) {
  if (!requireNamespace("ranger", quietly = TRUE)) return(NULL)
  keep <- c("player", "draft_year", target, features)
  x <- copy(dt[, ..keep])
  for (col in c(target, features)) x[[col]] <- safe_num(x[[col]])
  x <- x[complete.cases(x[, c(target, features), with = FALSE])]
  years <- sort(unique(x$draft_year))
  if (length(years) < 3L || nrow(x) < 30L) return(NULL)
  if (is.null(mtry)) mtry <- max(1L, min(2L, length(features)))

  preds <- vector("list", length(years))
  for (i in seq_along(years)) {
    yr <- years[[i]]
    train <- x[draft_year != yr]
    test <- x[draft_year == yr]
    if (nrow(train) < 20L || nrow(test) < 3L) next
    form <- as.formula(paste(target, "~", paste(features, collapse = " + ")))
    fit <- tryCatch(
      ranger::ranger(
        form,
        data = train,
        num.trees = 800,
        mtry = mtry,
        min.node.size = min_node_size,
        sample.fraction = sample_fraction,
        seed = 20260502
      ),
      error = function(e) NULL
    )
    if (is.null(fit)) next
    pred <- tryCatch(as.numeric(predict(fit, data = test)$predictions), error = function(e) rep(NA_real_, nrow(test)))
    preds[[i]] <- data.table(draft_year = yr, actual = test[[target]], pred = pred)
  }

  pred_dt <- rbindlist(preds, fill = TRUE)
  if (!nrow(pred_dt)) return(NULL)
  data.table(
    model = sprintf("ranger_loyo_mtry%s_node%s_sf%s", mtry, min_node_size, sample_fraction),
    features = paste(features, collapse = ", "),
    n_features = length(features),
    n_rows = nrow(x),
    validation_rows = nrow(pred_dt[is.finite(actual) & is.finite(pred)]),
    temporal_r2 = safe_r2(pred_dt$actual, pred_dt$pred),
    temporal_mse = mean((pred_dt$actual - pred_dt$pred)^2, na.rm = TRUE)
  )
}

make_shrunk <- function(dt, pct_col = "rim_pct", vol_col = "rim_100", out_col = "rim_pct_shrunk", k = 4) {
  pct <- safe_num(dt[[pct_col]])
  vol <- safe_num(dt[[vol_col]])
  avg <- mean(pct, na.rm = TRUE)
  rel <- vol / (vol + k)
  rel[!is.finite(rel)] <- NA_real_
  dt[[out_col]] <- avg + rel * (pct - avg)
  dt
}

in_path <- file.path(base_dir, "processed", "draft", "draft_training_data.csv")
out_path <- file.path(base_dir, "processed", "draft", "rim_feature_experiment.csv")

dt <- fread(in_path, na.strings = c("", "NA", "N/A", "NaN"))
dt <- make_shrunk(dt, k = 4)
dt[, rim_makes_100 := safe_num(rim_100) * safe_num(rim_pct) / 100]
dt[, rough_points_from_shot_zones := (
  2 * safe_num(rim_100) * safe_num(rim_pct) / 100 +
    2 * safe_num(mid_100) * safe_num(mid_pct) / 100 +
    3 * safe_num(`3pa_100`) * safe_num(three_pct) / 100 +
    safe_num(fta_100) * safe_num(ft_pct) / 100
)]
dt[, rough_tsa_100 := safe_num(rim_100) + safe_num(mid_100) + safe_num(`3pa_100`) + 0.44 * safe_num(fta_100)]
dt[, rough_ts_pct := 100 * rough_points_from_shot_zones / (2 * rough_tsa_100)]
dt[, assisted_rim_pressure := safe_num(rim_100) * safe_num(assisted_pct) / 100]
dt[, self_created_rim_pressure := safe_num(rim_100) * (1 - safe_num(assisted_pct) / 100)]

candidate_sets <- list(
  current = c("rim_100", "height_wo_shoes_in", "rim_pct"),
  current_plus_ua = c("rim_100", "height_wo_shoes_in", "rim_pct", "ua_rimmakes_100"),
  current_plus_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct", "assisted_pct"),
  current_plus_both = c("rim_100", "height_wo_shoes_in", "rim_pct", "ua_rimmakes_100", "assisted_pct"),
  no_rim_pct_add_ua_assisted = c("rim_100", "height_wo_shoes_in", "ua_rimmakes_100", "assisted_pct"),
  no_volume_add_ua_assisted = c("height_wo_shoes_in", "rim_pct", "ua_rimmakes_100", "assisted_pct"),
  ua_assisted_only = c("ua_rimmakes_100", "assisted_pct"),
  ua_assisted_size = c("ua_rimmakes_100", "assisted_pct", "height_wo_shoes_in"),
  rim_pct_ua_assisted = c("rim_pct", "ua_rimmakes_100", "assisted_pct"),
  rim_pct_shrunk_basic = c("rim_100", "height_wo_shoes_in", "rim_pct_shrunk"),
  rim_pct_shrunk_plus_ua = c("rim_100", "height_wo_shoes_in", "rim_pct_shrunk", "ua_rimmakes_100"),
  rim_pct_shrunk_plus_both = c("rim_100", "height_wo_shoes_in", "rim_pct_shrunk", "ua_rimmakes_100", "assisted_pct"),
  makes_size = c("rim_makes_100", "height_wo_shoes_in"),
  makes_ua_assisted = c("rim_makes_100", "ua_rimmakes_100", "assisted_pct"),
  pressure_split = c("assisted_rim_pressure", "self_created_rim_pressure", "height_wo_shoes_in"),
  pressure_split_pct = c("assisted_rim_pressure", "self_created_rim_pressure", "rim_pct", "height_wo_shoes_in"),
  full_candidate = c("rim_100", "rim_pct", "rim_pct_shrunk", "ua_rimmakes_100", "assisted_pct", "rim_makes_100", "height_wo_shoes_in", "wingspan_in", "fta_100", "or_pct")
)

ts_scv_assist_sets <- list(
  current_plus_scv = c("rim_100", "height_wo_shoes_in", "rim_pct", "scv_draft"),
  current_plus_rough_ts = c("rim_100", "height_wo_shoes_in", "rim_pct", "rough_ts_pct"),
  current_plus_assisted_fg = c("rim_100", "height_wo_shoes_in", "rim_pct", "assisted_pct"),
  current_plus_rim_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct", "rim_assisted_pct"),
  current_plus_all_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct", "assisted_pct", "rim_assisted_pct", "threes_assisted_pct"),
  current_plus_scv_ts = c("rim_100", "height_wo_shoes_in", "rim_pct", "scv_draft", "rough_ts_pct"),
  current_plus_scv_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct", "scv_draft", "assisted_pct", "rim_assisted_pct"),
  current_plus_scv_ts_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct", "scv_draft", "rough_ts_pct", "assisted_pct", "rim_assisted_pct"),
  shrunk_plus_scv_ts_assisted = c("rim_100", "height_wo_shoes_in", "rim_pct_shrunk", "scv_draft", "rough_ts_pct", "assisted_pct", "rim_assisted_pct"),
  ts_scv_assisted_only = c("rough_ts_pct", "scv_draft", "assisted_pct", "rim_assisted_pct"),
  efficiency_bundle = c("rim_pct", "close_2_pct", "mid_pct", "three_pct", "ft_pct", "rough_ts_pct"),
  efficiency_bundle_scv = c("rim_pct", "close_2_pct", "mid_pct", "three_pct", "ft_pct", "rough_ts_pct", "scv_draft"),
  efficiency_assisted_scv = c("rough_ts_pct", "scv_draft", "assisted_pct", "rim_assisted_pct", "threes_assisted_pct"),
  best_prior_plus_scv_ts = c("rim_pct_shrunk", "rim_makes_100", "height_wo_shoes_in", "wingspan_in", "scv_draft", "rough_ts_pct"),
  best_prior_plus_assisted = c("rim_pct_shrunk", "rim_makes_100", "height_wo_shoes_in", "wingspan_in", "assisted_pct", "rim_assisted_pct"),
  best_prior_plus_all = c("rim_pct_shrunk", "rim_makes_100", "height_wo_shoes_in", "wingspan_in", "scv_draft", "rough_ts_pct", "assisted_pct", "rim_assisted_pct", "threes_assisted_pct")
)
candidate_sets <- c(candidate_sets, ts_scv_assist_sets)

all_features <- unique(unlist(candidate_sets, use.names = FALSE))
missing_features <- setdiff(all_features, names(dt))
if (length(missing_features)) {
  stop("Missing experiment features: ", paste(missing_features, collapse = ", "))
}

results <- rbindlist(lapply(names(candidate_sets), function(name) {
  out <- eval_lm_loyo(dt, candidate_sets[[name]])
  if (is.null(out)) return(NULL)
  out[, spec := name]
  out
}), fill = TRUE)

setorder(results, -temporal_r2, temporal_mse)
fwrite(results, out_path)
print(results)
message("Wrote: ", out_path)

subset_features <- c(
  "rim_100", "rim_pct", "rim_pct_shrunk", "ua_rimmakes_100", "assisted_pct",
  "rim_makes_100", "height_wo_shoes_in", "wingspan_in", "fta_100", "or_pct",
  "rim_assisted_pct", "self_created_rim_pressure", "scv_draft", "rough_ts_pct",
  "close_2_pct", "mid_pct", "three_pct", "ft_pct", "threes_assisted_pct"
)
subset_features <- intersect(subset_features, names(dt))
subset_specs <- list()
for (k in 2:5) {
  cmb <- combn(subset_features, k, simplify = FALSE)
  subset_specs <- c(subset_specs, cmb)
}

subset_results <- rbindlist(lapply(subset_specs, function(features) {
  eval_lm_loyo(dt, features)
}), fill = TRUE)
setorder(subset_results, -temporal_r2, temporal_mse)
subset_results[, spec := sprintf("subset_%03d", .I)]
subset_out_path <- file.path(base_dir, "processed", "draft", "rim_feature_experiment_all_subsets.csv")
fwrite(subset_results, subset_out_path)
message("Wrote: ", subset_out_path)
print(head(subset_results, 30))

ranger_specs <- unique(c(
  list(candidate_sets$current),
  list(candidate_sets$current_plus_ua),
  list(candidate_sets$current_plus_assisted),
  list(candidate_sets$current_plus_both),
  list(candidate_sets$rim_pct_shrunk_basic),
  list(candidate_sets$rim_pct_shrunk_plus_both),
  lapply(head(subset_results, 20)$features, function(x) trimws(strsplit(x, ",", fixed = TRUE)[[1]]))
))

ranger_results <- rbindlist(lapply(seq_along(ranger_specs), function(i) {
  features <- ranger_specs[[i]]
  grid <- CJ(
    mtry = seq_len(min(3L, length(features))),
    min_node_size = c(5L, 10L),
    sample_fraction = c(0.65, 1)
  )
  out <- rbindlist(lapply(seq_len(nrow(grid)), function(j) {
    eval_ranger_loyo(
      dt,
      features,
      mtry = grid$mtry[[j]],
      min_node_size = grid$min_node_size[[j]],
      sample_fraction = grid$sample_fraction[[j]]
    )
  }), fill = TRUE)
  if (!nrow(out)) return(NULL)
  out[, spec := sprintf("ranger_spec_%02d", i)]
  out
}), fill = TRUE)
setorder(ranger_results, -temporal_r2, temporal_mse)
ranger_out_path <- file.path(base_dir, "processed", "draft", "rim_feature_experiment_ranger.csv")
fwrite(ranger_results, ranger_out_path)
message("Wrote: ", ranger_out_path)
print(head(ranger_results, 30))
