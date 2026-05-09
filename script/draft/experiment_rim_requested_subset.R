suppressPackageStartupMessages({
  library(data.table)
  library(ranger)
})

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
  keep <- c("draft_year", target, features)
  x <- copy(dt[, ..keep])
  for (col in c(target, features)) x[[col]] <- safe_num(x[[col]])
  x <- x[complete.cases(x[, c(target, features), with = FALSE])]
  years <- sort(unique(x$draft_year))
  preds <- vector("list", length(years))

  for (i in seq_along(years)) {
    yr <- years[[i]]
    train <- x[draft_year != yr]
    test <- x[draft_year == yr]
    if (nrow(train) < 20L || nrow(test) < 3L) next
    fit <- lm(as.formula(paste(target, "~", paste(features, collapse = " + "))), data = train)
    preds[[i]] <- data.table(actual = test[[target]], pred = as.numeric(predict(fit, newdata = test)))
  }

  pred_dt <- rbindlist(preds, fill = TRUE)
  data.table(
    model = "lm",
    features = paste(features, collapse = ", "),
    n_features = length(features),
    n_rows = nrow(x),
    validation_rows = nrow(pred_dt),
    temporal_r2 = safe_r2(pred_dt$actual, pred_dt$pred),
    temporal_mse = mean((pred_dt$actual - pred_dt$pred)^2, na.rm = TRUE)
  )
}

eval_ranger_loyo <- function(dt, features, target = "RIM", mtry, min_node_size, sample_fraction) {
  keep <- c("draft_year", target, features)
  x <- copy(dt[, ..keep])
  for (col in c(target, features)) x[[col]] <- safe_num(x[[col]])
  x <- x[complete.cases(x[, c(target, features), with = FALSE])]
  years <- sort(unique(x$draft_year))
  preds <- vector("list", length(years))

  for (i in seq_along(years)) {
    yr <- years[[i]]
    train <- x[draft_year != yr]
    test <- x[draft_year == yr]
    if (nrow(train) < 20L || nrow(test) < 3L) next
    fit <- ranger(
      as.formula(paste(target, "~", paste(features, collapse = " + "))),
      data = train,
      num.trees = 1000,
      mtry = mtry,
      min.node.size = min_node_size,
      sample.fraction = sample_fraction,
      seed = 20260502
    )
    preds[[i]] <- data.table(actual = test[[target]], pred = as.numeric(predict(fit, data = test)$predictions))
  }

  pred_dt <- rbindlist(preds, fill = TRUE)
  data.table(
    model = sprintf("ranger_mtry%s_node%s_sf%s", mtry, min_node_size, sample_fraction),
    features = paste(features, collapse = ", "),
    n_features = length(features),
    n_rows = nrow(x),
    validation_rows = nrow(pred_dt),
    temporal_r2 = safe_r2(pred_dt$actual, pred_dt$pred),
    temporal_mse = mean((pred_dt$actual - pred_dt$pred)^2, na.rm = TRUE)
  )
}

base_dir <- normalizePath(getwd(), mustWork = TRUE)
dt <- fread(file.path(base_dir, "processed", "draft", "draft_training_data.csv"), na.strings = c("", "NA", "N/A", "NaN"))

requested <- c("rim_pct", "wingspan_in", "scv_draft", "three_pct", "height_wo_shoes_in", "rim_100")
missing <- setdiff(requested, names(dt))
if (length(missing)) stop("Missing requested variables: ", paste(missing, collapse = ", "))

subsets <- list()
for (k in seq_along(requested)) {
  subsets <- c(subsets, combn(requested, k, simplify = FALSE))
}

lm_results <- rbindlist(lapply(subsets, function(features) eval_lm_loyo(dt, features)), fill = TRUE)

ranger_results <- rbindlist(lapply(subsets, function(features) {
  grid <- CJ(
    mtry = seq_len(min(length(features), 3L)),
    min_node_size = c(5L, 10L),
    sample_fraction = c(0.65, 1)
  )
  rbindlist(lapply(seq_len(nrow(grid)), function(i) {
    eval_ranger_loyo(
      dt,
      features,
      mtry = grid$mtry[[i]],
      min_node_size = grid$min_node_size[[i]],
      sample_fraction = grid$sample_fraction[[i]]
    )
  }), fill = TRUE)
}), fill = TRUE)

results <- rbind(lm_results, ranger_results, fill = TRUE)
setorder(results, -temporal_r2, temporal_mse)
results[, rank_overall := .I]
results[, rank_within_size := seq_len(.N), by = n_features]

best_by_size <- results[rank_within_size == 1][order(n_features)]
best_by_size[, delta_from_prev_size := temporal_r2 - shift(temporal_r2)]
best_by_size[, delta_from_best := max(temporal_r2, na.rm = TRUE) - temporal_r2]

out_all <- file.path(base_dir, "processed", "draft", "rim_requested_subset_results.csv")
out_best <- file.path(base_dir, "processed", "draft", "rim_requested_subset_best_by_size.csv")
fwrite(results, out_all)
fwrite(best_by_size, out_best)

cat("\nTop 25 overall\n")
print(results[1:min(.N, 25), .(rank_overall, model, n_features, n_rows, temporal_r2, temporal_mse, features)])
cat("\nBest by predictor count\n")
print(best_by_size[, .(n_features, model, n_rows, temporal_r2, temporal_mse, delta_from_prev_size, delta_from_best, features)])
message("Wrote: ", out_all)
message("Wrote: ", out_best)
