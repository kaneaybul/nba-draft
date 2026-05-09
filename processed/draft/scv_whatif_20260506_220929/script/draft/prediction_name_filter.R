read_prediction_name_filter <- function(path, key_col = "join_player") {
  if (!file.exists(path)) {
    return(NULL)
  }

  filter_dt <- data.table::fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(filter_dt)) {
    return(NULL)
  }

  name_col <- names(filter_dt)[tolower(names(filter_dt)) %in% c("name", "player", "player_name")][1]
  year_col <- names(filter_dt)[tolower(names(filter_dt)) %in% c("year", "draft_year")][1]
  if (is.na(name_col) || !nzchar(name_col)) {
    warning("Prediction name filter is missing a name/player column: ", path)
    return(NULL)
  }

  filter_dt[, prediction_filter_name := as.character(get(name_col))]
  filter_dt[, prediction_filter_key := normalize_join_name(prediction_filter_name)]
  filter_dt[, prediction_filter_year := if (!is.na(year_col) && nzchar(year_col)) {
    suppressWarnings(as.integer(get(year_col)))
  } else {
    NA_integer_
  }]
  filter_dt <- filter_dt[nzchar(prediction_filter_key)]

  if (!nrow(filter_dt)) {
    return(NULL)
  }

  out <- filter_dt[, .(
    prediction_filter_key,
    prediction_filter_year,
    prediction_filter_name
  )]
  out <- unique(out, by = c("prediction_filter_key", "prediction_filter_year"))
  data.table::setnames(out, "prediction_filter_key", key_col)
  out
}

apply_prediction_name_filter <- function(dt, filter_dt, player_key_col = "join_player", year_col = "draft_year") {
  if (is.null(filter_dt) || !nrow(filter_dt)) {
    return(dt)
  }
  if (!player_key_col %in% names(dt)) {
    warning("Prediction name filter skipped because source is missing key column: ", player_key_col)
    return(dt)
  }

  filter_copy <- data.table::copy(filter_dt)
  data.table::setnames(filter_copy, player_key_col, "prediction_filter_key")

  dt_copy <- data.table::copy(dt)
  dt_copy[, prediction_filter_key := get(player_key_col)]
  if (year_col %in% names(dt_copy)) {
    dt_copy[, prediction_filter_year_candidate := suppressWarnings(as.integer(get(year_col)))]
  } else {
    dt_copy[, prediction_filter_year_candidate := NA_integer_]
  }

  exact_filter <- filter_copy[is.finite(prediction_filter_year)]
  any_year_filter <- filter_copy[!is.finite(prediction_filter_year)]

  exact_match <- if (nrow(exact_filter)) {
    merge(
      dt_copy,
      exact_filter[, .(prediction_filter_key, prediction_filter_year, prediction_filter_name)],
      by.x = c("prediction_filter_key", "prediction_filter_year_candidate"),
      by.y = c("prediction_filter_key", "prediction_filter_year"),
      all = FALSE,
      sort = FALSE
    )
  } else {
    dt_copy[0]
  }

  any_year_match <- if (nrow(any_year_filter)) {
    merge(
      dt_copy,
      any_year_filter[, .(prediction_filter_key, prediction_filter_name)],
      by = "prediction_filter_key",
      all = FALSE,
      sort = FALSE
    )
  } else {
    dt_copy[0]
  }

  out <- data.table::rbindlist(list(exact_match, any_year_match), use.names = TRUE, fill = TRUE)
  if (!nrow(out)) {
    return(out[, setdiff(names(out), c("prediction_filter_key", "prediction_filter_year_candidate", "prediction_filter_name")), with = FALSE])
  }

  out <- unique(out, by = intersect(c(player_key_col, year_col), names(out)))
  drop_cols <- intersect(c("prediction_filter_key", "prediction_filter_year_candidate", "prediction_filter_name"), names(out))
  out[, (drop_cols) := NULL]
  out
}
