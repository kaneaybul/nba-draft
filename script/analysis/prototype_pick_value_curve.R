base_dir <- normalizePath(file.path(getwd()), winslash = "/", mustWork = TRUE)

normalize_name <- function(x) {
  x <- iconv(as.character(x), from = "", to = "ASCII//TRANSLIT")
  x <- tolower(x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", "", x)
  gsub("[^a-z0-9]+", "", x)
}

read_impact_players <- function(base_dir, max_year = 2026L) {
  impact_dir <- file.path(base_dir, "frontend", "public", "data", "v2", "impact_players")
  paths <- list.files(impact_dir, pattern = "^[0-9]{4}\\.json$", full.names = TRUE)
  paths <- paths[as.integer(sub("\\.json$", "", basename(paths))) <= max_year]
  rows <- lapply(paths, function(path) {
    x <- jsonlite::fromJSON(path, simplifyDataFrame = TRUE)
    keep <- intersect(
      c("nba_id", "player_name", "year", "value", "season_value", "value_add", "trade_value", "total", "Minutes"),
      names(x)
    )
    x[, keep, drop = FALSE]
  })
  out <- do.call(rbind, rows)
  out$join_player <- normalize_name(out$player_name)
  out$year <- suppressWarnings(as.integer(out$year))
  for (col in intersect(c("value", "season_value", "value_add", "trade_value", "total", "Minutes"), names(out))) {
    out[[col]] <- suppressWarnings(as.numeric(out[[col]]))
  }
  out
}

load_training_targets <- function(base_dir) {
  draft_path <- file.path(base_dir, "processed", "draft", "draft_picks_all_classes.csv")
  draft <- read.csv(draft_path, stringsAsFactors = FALSE, check.names = FALSE)
  draft$join_player <- normalize_name(draft$player)
  draft$draft_year <- suppressWarnings(as.integer(draft$draft_year))
  draft$pick <- suppressWarnings(as.integer(draft$pick_overall))
  draft <- draft[
    is.finite(draft$draft_year) & draft$pick %in% 1:60 & nzchar(draft$join_player),
    c("join_player", "draft_year", "pick", "team", "player"),
    drop = FALSE
  ]
  draft <- draft[!duplicated(paste(draft$join_player, draft$draft_year, draft$pick)), ]

  impact <- read_impact_players(base_dir)
  impact <- impact[
    nzchar(impact$join_player) & is.finite(impact$year) & is.finite(impact$value),
    c("join_player", "year", "value", "season_value", "value_add", "trade_value", "total", "Minutes"),
    drop = FALSE
  ]

  training <- merge(draft, impact, by = "join_player", all = FALSE)
  training$nba_year <- training$year - training$draft_year
  training <- training[training$nba_year %in% c(3L, 4L), , drop = FALSE]

  player_target <- aggregate(
    value ~ join_player + player + draft_year + pick + team,
    data = training,
    FUN = function(x) max(x, na.rm = TRUE)
  )
  names(player_target)[names(player_target) == "value"] <- "max_season_value_y3_y4"
  player_target$max_season_value_y3_y4 <- pmax(0, player_target$max_season_value_y3_y4)
  player_target$four_year_value <- 4 * player_target$max_season_value_y3_y4

  value_by_nba_year <- reshape(
    training[, c("join_player", "draft_year", "pick", "nba_year", "value")],
    idvar = c("join_player", "draft_year", "pick"),
    timevar = "nba_year",
    direction = "wide"
  )
  names(value_by_nba_year) <- sub("^value\\.", "value_y", names(value_by_nba_year))
  player_target <- merge(player_target, value_by_nba_year, by = c("join_player", "draft_year", "pick"), all.x = TRUE)
  player_target[order(player_target$pick, -player_target$four_year_value), ]
}

fit_pick_curve <- function(targets) {
  targets <- targets[is.finite(targets$four_year_value) & targets$pick %in% 1:60, , drop = FALSE]
  picks <- 1:60
  obs <- aggregate(
    four_year_value ~ pick,
    data = targets,
    FUN = function(x) c(n = length(x), mean = mean(x), median = median(x), p75 = as.numeric(quantile(x, 0.75)))
  )
  obs_out <- data.frame(
    pick = obs$pick,
    training_n = obs$four_year_value[, "n"],
    observed_mean = obs$four_year_value[, "mean"],
    observed_median = obs$four_year_value[, "median"],
    observed_p75 = obs$four_year_value[, "p75"]
  )

  fit <- mgcv::gam(
    log1p(observed_mean) ~ s(pick, k = 10, bs = "cs"),
    data = obs_out,
    weights = sqrt(obs_out$training_n),
    method = "REML"
  )
  pred_log <- as.numeric(predict(fit, newdata = data.frame(pick = picks), type = "response"))
  raw_expected <- pmax(0, expm1(pred_log))
  iso <- isoreg(picks, -raw_expected)
  smooth_expected <- pmax(0, -iso$yf)

  out <- merge(data.frame(pick = picks, smooth_four_year_value = smooth_expected), obs_out, by = "pick", all.x = TRUE)
  out$round <- ifelse(out$pick <= 30, 1L, 2L)
  out$normalized <- round(out$smooth_four_year_value / max(out$smooth_four_year_value, na.rm = TRUE), 3)
  out
}

lottery_distributions <- function() {
  combos <- c(140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5)
  n <- length(combos)
  dist <- matrix(0, nrow = n, ncol = n)
  total <- sum(combos)
  for (a in seq_len(n)) {
    pa <- combos[a] / total
    remaining_a <- total - combos[a]
    for (b in setdiff(seq_len(n), a)) {
      pb <- pa * combos[b] / remaining_a
      remaining_b <- remaining_a - combos[b]
      for (c in setdiff(seq_len(n), c(a, b))) {
        pc <- pb * combos[c] / remaining_b
        remaining_c <- remaining_b - combos[c]
        for (d in setdiff(seq_len(n), c(a, b, c))) {
          pd <- pc * combos[d] / remaining_c
          top4 <- c(a, b, c, d)
          for (slot in seq_along(top4)) {
            dist[top4[slot], slot] <- dist[top4[slot], slot] + pd
          }
          rest <- setdiff(seq_len(n), top4)
          rest <- rest[order(rest)]
          for (i in seq_along(rest)) {
            dist[rest[i], i + 4L] <- dist[rest[i], i + 4L] + pd
          }
        }
      }
    }
  }
  out <- lapply(seq_len(n), function(seed) {
    data.frame(seed = seed, pick = seq_len(n), probability = dist[seed, ])
  })
  names(out) <- paste0("seed_", seq_len(n))
  out
}

seed_distribution <- function(seeds, lottery) {
  seeds <- as.integer(seeds)
  lottery_seeds <- seeds[seeds <= 14L]
  fixed_seeds <- seeds[seeds >= 15L & seeds <= 30L]
  parts <- list()
  if (length(lottery_seeds)) {
    parts[[length(parts) + 1L]] <- do.call(rbind, lottery[paste0("seed_", lottery_seeds)])
  }
  if (length(fixed_seeds)) {
    parts[[length(parts) + 1L]] <- data.frame(seed = fixed_seeds, pick = fixed_seeds, probability = 1)
  }
  x <- do.call(rbind, parts)
  aggregate(probability / length(seeds) ~ pick, data = x, FUN = sum) |>
    setNames(c("pick", "probability"))
}

distribution_value <- function(distribution, curve, protection_cutoff = 0L) {
  x <- merge(distribution, curve[, c("pick", "smooth_four_year_value")], by = "pick", all.x = TRUE)
  x$smooth_four_year_value[!is.finite(x$smooth_four_year_value)] <- 0
  conveyed <- if (protection_cutoff > 0L) x$pick > protection_cutoff else rep(TRUE, nrow(x))
  data.frame(
    expected_pick = sum(x$pick * x$probability),
    convey_probability = sum(x$probability[conveyed]),
    four_year_value = sum(x$probability[conveyed] * x$smooth_four_year_value[conveyed])
  )
}

swap_value <- function(own_distribution, counterparty_distribution, curve) {
  own <- merge(own_distribution, curve[, c("pick", "smooth_four_year_value")], by = "pick", all.x = TRUE)
  other <- merge(counterparty_distribution, curve[, c("pick", "smooth_four_year_value")], by = "pick", all.x = TRUE)
  names(own)[names(own) == "smooth_four_year_value"] <- "own_value"
  names(other)[names(other) == "smooth_four_year_value"] <- "counterparty_value"
  grid <- merge(
    own[, c("pick", "probability", "own_value")],
    other[, c("pick", "probability", "counterparty_value")],
    by = NULL,
    suffixes = c("_own", "_counterparty")
  )
  grid$probability <- grid$probability_own * grid$probability_counterparty
  grid$gain <- pmax(0, grid$counterparty_value - grid$own_value)
  data.frame(
    expected_pick_own = sum(grid$pick_own * grid$probability),
    expected_pick_counterparty = sum(grid$pick_counterparty * grid$probability),
    positive_probability = sum(grid$probability[grid$gain > 0]),
    four_year_value = sum(grid$probability * grid$gain)
  )
}

build_scenarios <- function(curve) {
  lottery <- lottery_distributions()
  all_first <- seed_distribution(1:30, lottery)
  lottery_avg <- seed_distribution(1:14, lottery)
  bottom3 <- seed_distribution(1:3, lottery)
  bottom5 <- seed_distribution(1:5, lottery)
  play_in <- seed_distribution(7:14, lottery)
  playoff <- seed_distribution(15:30, lottery)
  contender <- seed_distribution(25:30, lottery)
  second <- data.frame(pick = 31:60, probability = 1 / 30)

  first_scenarios <- list(
    "Unprotected 1st - random NBA team" = all_first,
    "Unprotected 1st - average lottery team" = lottery_avg,
    "Unprotected 1st - bottom-3 team" = bottom3,
    "Unprotected 1st - bottom-5 team" = bottom5,
    "Unprotected 1st - play-in/late-lottery team" = play_in,
    "Unprotected 1st - average playoff team" = playoff,
    "Unprotected 1st - contender" = contender,
    "Generic 2nd" = second
  )

  protection_cutoffs <- c(0L, 3L, 5L, 8L, 10L, 14L)
  protection_labels <- c("unprotected", "top-3 protected", "top-5 protected", "top-8 protected", "top-10 protected", "lottery protected")
  first_rows <- do.call(rbind, lapply(names(first_scenarios), function(name) {
    distribution <- first_scenarios[[name]]
    cutoffs <- if (name == "Generic 2nd") 0L else protection_cutoffs
    labels <- if (name == "Generic 2nd") "none" else protection_labels
    do.call(rbind, Map(function(cutoff, label) {
      value <- distribution_value(distribution, curve, cutoff)
      data.frame(
        asset_type = ifelse(name == "Generic 2nd", "second", "first"),
        scenario = name,
        protection = label,
        expected_pick = round(value$expected_pick, 2),
        convey_probability = round(value$convey_probability, 3),
        four_year_value = round(value$four_year_value, 0)
      )
    }, cutoffs, labels))
  }))

  swap_defs <- list(
    "Swap - own contender, counterparty random NBA team" = list(own = contender, other = all_first),
    "Swap - own contender, counterparty average lottery team" = list(own = contender, other = lottery_avg),
    "Swap - own playoff team, counterparty play-in/late-lottery team" = list(own = playoff, other = play_in),
    "Swap - both random NBA teams" = list(own = all_first, other = all_first)
  )
  swap_rows <- do.call(rbind, lapply(names(swap_defs), function(name) {
    value <- swap_value(swap_defs[[name]]$own, swap_defs[[name]]$other, curve)
    data.frame(
      asset_type = "swap",
      scenario = name,
      protection = "unprotected",
      expected_pick = round(value$expected_pick_counterparty, 2),
      convey_probability = round(value$positive_probability, 3),
      four_year_value = round(value$four_year_value, 0)
    )
  }))

  rbind(first_rows, swap_rows)
}

targets <- load_training_targets(base_dir)
curve <- fit_pick_curve(targets)

current_path <- file.path(base_dir, "frontend", "public", "data", "pick_assets.json")
if (file.exists(current_path)) {
  current <- jsonlite::fromJSON(current_path, simplifyDataFrame = TRUE)
  current <- current[current$asset_type == "slot_value", c("pick", "value", "normalized", "training_n")]
  names(current) <- c("pick", "current_slot_value", "current_normalized", "current_training_n")
  current$current_ui_trade_value_x4 <- current$current_slot_value * 4
  curve <- merge(curve, current, by = "pick", all.x = TRUE)
}

scenarios <- build_scenarios(curve)

out_dir <- file.path(base_dir, "processed", "analysis")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
write.csv(targets, file.path(out_dir, "pick_value_training_targets_y3_y4.csv"), row.names = FALSE)
write.csv(curve, file.path(out_dir, "pick_value_curve_prototype.csv"), row.names = FALSE)
write.csv(scenarios, file.path(out_dir, "pick_asset_value_scenarios_prototype.csv"), row.names = FALSE)

cat("training players:", nrow(targets), "\n")
cat("outputs:\n")
cat(file.path(out_dir, "pick_value_training_targets_y3_y4.csv"), "\n")
cat(file.path(out_dir, "pick_value_curve_prototype.csv"), "\n")
cat(file.path(out_dir, "pick_asset_value_scenarios_prototype.csv"), "\n")
