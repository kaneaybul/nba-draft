clean_perimeter_id <- function(x) {
  trimws(as.character(x))
}

numeric_col_or_na <- function(df, col) {
  if (!col %in% names(df)) {
    return(rep(NA_real_, nrow(df)))
  }
  suppressWarnings(as.numeric(df[[col]]))
}

coalesce_numeric_cols <- function(df, cols) {
  out <- rep(NA_real_, nrow(df))
  for (col in cols) {
    vals <- numeric_col_or_na(df, col)
    out <- ifelse(is.finite(out), out, vals)
  }
  out
}

add_perimeter_alloc_residual <- function(def_df, base_dir, fit_year_excludes = c(2016L, 2017L)) {
  databallr_path <- file.path(base_dir, "raw", "databallr_stats.csv")
  if (!file.exists(databallr_path)) {
    warning("databallr_stats.csv not found; perimeter_alloc_ps_resid_role will be NA.")
    def_df$perimeter_alloc_ps_resid_role <- NA_real_
    return(def_df)
  }

  db_raw <- readr::read_csv(databallr_path, show_col_types = FALSE)
  db_non_rim <- db_raw %>%
    transmute(
      nba_id = clean_perimeter_id(nba_id),
      year = as.integer(year),
      raw_pos2 = as.character(Pos2),
      raw_points_saved_100 = suppressWarnings(as.numeric(points_saved_100)),
      raw_rim_points_saved_100 = suppressWarnings(as.numeric(rim_points_saved_100)),
      raw_rimdfga_100 = suppressWarnings(as.numeric(`rimdfga/100`)),
      raw_def_3pa_100 = suppressWarnings(as.numeric(d_FG3A_Per100)),
      raw_def_long_mid_fga_100 = suppressWarnings(as.numeric(d_LongMidRangeFGA_Per100)),
      raw_def_short_mid_fga_100 = suppressWarnings(as.numeric(d_ShortMidRangeFGA_Per100))
    ) %>%
    distinct(nba_id, year, .keep_all = TRUE)

  out <- def_df %>%
    mutate(
      nba_id = clean_perimeter_id(nba_id),
      year = as.integer(year)
    ) %>%
    left_join(db_non_rim, by = c("nba_id", "year"))

  out$points_saved_100_for_perimeter <- coalesce_numeric_cols(out, c("points_saved_100", "raw_points_saved_100"))
  out$rim_points_saved_100 <- coalesce_numeric_cols(out, c("rim_points_saved_100", "raw_rim_points_saved_100"))
  out$rimdfga_100 <- coalesce_numeric_cols(out, c("rimdfga/100", "rimdfga_100", "raw_rimdfga_100"))
  out$def_3pa_100 <- coalesce_numeric_cols(out, c("d_FG3A_Per100", "raw_def_3pa_100"))
  out$def_long_mid_fga_100 <- coalesce_numeric_cols(out, c("d_LongMidRangeFGA_Per100", "raw_def_long_mid_fga_100"))
  out$def_short_mid_fga_100 <- coalesce_numeric_cols(out, c("d_ShortMidRangeFGA_Per100", "raw_def_short_mid_fga_100"))

  pos2 <- if ("Pos2" %in% names(out)) as.character(out$Pos2) else out$raw_pos2
  out$primary_pos <- dplyr::case_when(
    grepl("C", pos2, ignore.case = TRUE) ~ "C",
    grepl("F", pos2, ignore.case = TRUE) ~ "F",
    grepl("G", pos2, ignore.case = TRUE) ~ "G",
    TRUE ~ "Unknown"
  )
  out$is_center <- as.numeric(out$primary_pos == "C")
  out$perimeter_zone_attempts_100 <- out$def_3pa_100 + out$def_long_mid_fga_100
  out$non_rim_zone_attempts_100 <- out$perimeter_zone_attempts_100 + out$def_short_mid_fga_100
  out$perimeter_zone_share <- ifelse(
    is.finite(out$non_rim_zone_attempts_100) & out$non_rim_zone_attempts_100 > 0,
    out$perimeter_zone_attempts_100 / out$non_rim_zone_attempts_100,
    NA_real_
  )
  out$non_rim_points_saved_100 <- out$points_saved_100_for_perimeter - out$rim_points_saved_100
  out$perimeter_alloc_points_saved_100 <- out$non_rim_points_saved_100 * out$perimeter_zone_share

  residual_terms <- c(
    "perimeter_alloc_points_saved_100",
    "is_center",
    "d_Blocks_Per100",
    "d_DefRebounds_Per100",
    "rimdfga_100",
    "rim_points_saved_100"
  )
  missing_terms <- setdiff(residual_terms, names(out))
  if (length(missing_terms) > 0) {
    warning(
      "Missing perimeter residual input columns: ",
      paste(missing_terms, collapse = ", "),
      "; perimeter_alloc_ps_resid_role will be NA."
    )
    out$perimeter_alloc_ps_resid_role <- NA_real_
    return(out)
  }

  fit_data <- out %>%
    filter(!year %in% fit_year_excludes) %>%
    select(all_of(residual_terms)) %>%
    filter(complete.cases(.))

  if (nrow(fit_data) < 20) {
    warning("Too few rows to fit perimeter residual control; perimeter_alloc_ps_resid_role will be NA.")
    out$perimeter_alloc_ps_resid_role <- NA_real_
    return(out)
  }

  residual_fit <- lm(
    perimeter_alloc_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100,
    data = fit_data
  )

  score_rows <- complete.cases(out[, residual_terms])
  out$perimeter_alloc_ps_resid_role <- NA_real_
  out$perimeter_alloc_ps_resid_role[score_rows] <-
    out$perimeter_alloc_points_saved_100[score_rows] -
    as.numeric(predict(residual_fit, newdata = out[score_rows, , drop = FALSE]))

  out
}
