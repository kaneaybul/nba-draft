library(dplyr)
library(purrr)
library(readr)
library(tibble)

resolve_base_dir <- function() {
  candidates <- c(
    getwd(),
    file.path(getwd(), ".."),
    file.path(getwd(), "..", "..")
  )

  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "raw")) &&
        dir.exists(file.path(candidate_norm, "script"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

clean_id <- function(x) {
  x <- as.character(x)
  x <- trimws(x)
  x[x == ""] <- NA_character_
  x
}

add_alias_columns <- function(df) {
  alias_pairs <- c(
    "X3PA_100" = "3PA_100",
    "X3P_PERC" = "3P_PERC",
    "X3PA" = "3PA",
    "X3P" = "3P"
  )

  for (target_name in names(alias_pairs)) {
    source_name <- alias_pairs[[target_name]]
    if (!(target_name %in% names(df)) && source_name %in% names(df)) {
      df[[target_name]] <- df[[source_name]]
    }
  }

  df
}

parse_exclude_years <- function(var_name, default_value = "2016,2017") {
  raw_value <- trimws(Sys.getenv(var_name, default_value))
  if (!nzchar(raw_value) || tolower(raw_value) %in% c("none", "false", "no", "0")) {
    return(integer(0))
  }

  years <- suppressWarnings(as.integer(trimws(strsplit(raw_value, ",", fixed = TRUE)[[1]])))
  years[is.finite(years)]
}

format_formula_term <- function(term) {
  term <- as.character(term)
  if (grepl("^`.*`$", term) || grepl("^I\\(", term) || grepl("^[A-Za-z.][A-Za-z0-9._]*$", term)) {
    term
  } else {
    paste0("`", term, "`")
  }
}

extract_model_terms <- function(skillmap, model_flag) {
  skills <- setdiff(names(skillmap), "VAR")

  term_rows <- skillmap %>%
    filter(grepl("^Term[0-9]+$", VAR)) %>%
    mutate(term_order = as.integer(sub("^Term", "", VAR))) %>%
    arrange(term_order)
  flag_row <- skillmap %>% filter(VAR == model_flag)

  if (nrow(term_rows) == 0 || nrow(flag_row) != 1) {
    stop("skillmap.csv must contain at least one Term# row and exactly one ", model_flag, " row.")
  }

  map(skills, function(skill_name) {
    use_flag <- suppressWarnings(as.numeric(flag_row[[skill_name]][1]))
    if (!identical(use_flag, 1)) {
      return(character(0))
    }

    these_terms <- term_rows[[skill_name]]
    these_terms[!is.na(these_terms) & these_terms != ""]
  }) %>%
    unlist(use.names = FALSE) %>%
    unique()
}

fit_variant <- function(label, terms, data) {
  formula <- as.formula(paste(
    "def_dep ~",
    paste(vapply(terms, format_formula_term, character(1)), collapse = " + ")
  ))

  needed_cols <- all.vars(formula)

  fit_data <- data %>%
    select(all_of(needed_cols)) %>%
    filter(if_all(everything(), is.finite))

  fit <- lm(formula, data = fit_data)
  sm <- summary(fit)

  coef_df <- as.data.frame(sm$coefficients)
  coef_df$term <- rownames(coef_df)
  rownames(coef_df) <- NULL

  list(
    label = label,
    terms = terms,
    fit = fit,
    summary = tibble(
      variant = label,
      n = length(stats::fitted(fit)),
      terms = paste(terms, collapse = " | "),
      r_squared = unname(sm$r.squared),
      adj_r_squared = unname(sm$adj.r.squared),
      sigma = unname(sm$sigma),
      aic = AIC(fit),
      bic = BIC(fit)
    ),
    coefs = coef_df %>%
      transmute(
        variant = label,
        term = term,
        estimate = Estimate,
        std_error = `Std. Error`,
        t_value = `t value`,
        p_value = `Pr(>|t|)`
      )
  )
}

base_dir <- resolve_base_dir()
source(file.path(base_dir, "script", "live_data_paths.txt"), local = TRUE)

livedata_dir <- get_live_data_dir(base_dir, create = FALSE)
out_dir <- file.path(base_dir, "processed", "modelresults", "non_rim_defense_experiment")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

def_hist <- read_csv(file.path(livedata_dir, "defdata.csv"), show_col_types = FALSE) %>%
  add_alias_columns() %>%
  mutate(
    nba_id = clean_id(nba_id),
    year = as.integer(year)
  )

impact_hist <- read_csv(file.path(livedata_dir, "impactoutput.csv"), show_col_types = FALSE) %>%
  transmute(
    nba_id = clean_id(nba_id),
    year = as.integer(year),
    def_dep = as.numeric(def_dep)
  )

if (!"def_dep" %in% names(def_hist)) {
  def_hist <- def_hist %>%
    left_join(impact_hist, by = c("nba_id", "year"))
}

db_non_rim <- read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE) %>%
  transmute(
    nba_id = clean_id(nba_id),
    year = as.integer(year),
    pos2 = as.character(Pos2),
    height_wo_shoes_in = as.numeric(height_wo_shoes_in),
    minutes = as.numeric(Minutes),
    dfga_100 = as.numeric(`dfga/100`),
    dif_pct = as.numeric(`dif%`),
    points_saved_100 = as.numeric(points_saved_100),
    rimdfga_100 = as.numeric(`rimdfga/100`),
    rim_dif_pct = as.numeric(`rim_dif%`),
    rim_points_saved_100 = as.numeric(rim_points_saved_100),
    non_rim_dfga_100 = dfga_100 - rimdfga_100,
    non_rim_points_saved_100 = points_saved_100 - rim_points_saved_100,
    non_rim_dif_pct = if_else(
      non_rim_dfga_100 > 0,
      ((dif_pct * dfga_100) - (rim_dif_pct * rimdfga_100)) / non_rim_dfga_100,
      NA_real_
    ),
    non_rim_dif_pct_from_points = if_else(
      non_rim_dfga_100 > 0,
      -100 * non_rim_points_saved_100 / (2 * non_rim_dfga_100),
      NA_real_
    ),
    primary_pos = case_when(
      grepl("C", pos2, ignore.case = TRUE) ~ "C",
      grepl("F", pos2, ignore.case = TRUE) ~ "F",
      grepl("G", pos2, ignore.case = TRUE) ~ "G",
      TRUE ~ "Unknown"
    ),
    is_center = as.numeric(primary_pos == "C"),
    is_guard = as.numeric(primary_pos == "G"),
    is_forward = as.numeric(primary_pos == "F"),
    is_non_center = as.numeric(primary_pos != "C"),
    is_big = as.numeric(primary_pos %in% c("C", "F")),
    height_centered = height_wo_shoes_in - mean(height_wo_shoes_in, na.rm = TRUE),
    def_3pa_100 = as.numeric(d_FG3A_Per100),
    def_long_mid_fga_100 = as.numeric(d_LongMidRangeFGA_Per100),
    def_short_mid_fga_100 = as.numeric(d_ShortMidRangeFGA_Per100),
    perimeter_attempt_proxy_100 = def_3pa_100 + def_long_mid_fga_100,
    non_rim_attempt_proxy_check = def_3pa_100 + def_long_mid_fga_100 + def_short_mid_fga_100
  ) %>%
  distinct(nba_id, year, .keep_all = TRUE)

def_exclude_years <- parse_exclude_years("DEF_MODEL_EXCLUDE_YEARS", "2016,2017")

model_data <- def_hist %>%
  left_join(db_non_rim, by = c("nba_id", "year"), suffix = c("", "_raw")) %>%
  filter(!is.na(def_dep)) %>%
  filter(!year %in% def_exclude_years) %>%
  filter(
    is.finite(non_rim_dfga_100),
    is.finite(non_rim_points_saved_100),
    is.finite(non_rim_dif_pct)
  )

add_residual_metric <- function(df, output_name, formula, require_finite = all.vars(formula)) {
  fit_rows <- complete.cases(df[, require_finite, drop = FALSE])
  residual_values <- rep(NA_real_, nrow(df))

  fit <- lm(formula, data = df[fit_rows, , drop = FALSE])
  residual_values[fit_rows] <- resid(fit)
  df[[output_name]] <- residual_values
  df
}

safe_z <- function(x) {
  s <- sd(x, na.rm = TRUE)
  m <- mean(x, na.rm = TRUE)

  if (is.na(s) || s == 0) {
    return(rep(0, length(x)))
  }

  (x - m) / s
}

model_data <- model_data %>%
  add_residual_metric(
    output_name = "non_rim_ps_resid_role",
    formula = non_rim_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100
  ) %>%
  add_residual_metric(
    output_name = "non_rim_ps_resid_height_role",
    formula = non_rim_points_saved_100 ~ height_centered + is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100
  ) %>%
  group_by(year, primary_pos) %>%
  mutate(
    non_rim_ps_pos_resid = {
      x <- non_rim_points_saved_100
      x - mean(x, na.rm = TRUE)
    },
    non_rim_dfga_pos_resid = {
      x <- non_rim_dfga_100
      x - mean(x, na.rm = TRUE)
    }
  ) %>%
  ungroup() %>%
  group_by(year) %>%
  mutate(
    z_non_rim_ps_resid_role = safe_z(non_rim_ps_resid_role),
    z_non_rim_points_saved_100 = safe_z(non_rim_points_saved_100),
    z_perimeter_attempt_proxy_100 = safe_z(perimeter_attempt_proxy_100),
    z_def_3pa_100 = safe_z(def_3pa_100),
    z_def_long_mid_fga_100 = safe_z(def_long_mid_fga_100),
    z_def_short_mid_fga_100 = safe_z(def_short_mid_fga_100),
    def_3pa_long_mid_100 = def_3pa_100 + def_long_mid_fga_100,
    def_3pa_short_mid_100 = def_3pa_100 + def_short_mid_fga_100,
    def_midrange_100 = def_long_mid_fga_100 + def_short_mid_fga_100,
    z_def_3pa_long_mid_100 = safe_z(def_3pa_long_mid_100),
    z_def_3pa_short_mid_100 = safe_z(def_3pa_short_mid_100),
    z_def_midrange_100 = safe_z(def_midrange_100),
    non_rim_resid_x_perimeter_proxy = z_non_rim_ps_resid_role * z_perimeter_attempt_proxy_100,
    non_rim_resid_x_3pa = z_non_rim_ps_resid_role * z_def_3pa_100,
    non_rim_resid_x_long_mid = z_non_rim_ps_resid_role * z_def_long_mid_fga_100,
    non_rim_resid_x_short_mid = z_non_rim_ps_resid_role * z_def_short_mid_fga_100,
    non_rim_resid_x_3pa_long_mid = z_non_rim_ps_resid_role * z_def_3pa_long_mid_100,
    non_rim_resid_x_3pa_short_mid = z_non_rim_ps_resid_role * z_def_3pa_short_mid_100,
    non_rim_resid_x_midrange = z_non_rim_ps_resid_role * z_def_midrange_100,
    non_rim_raw_x_perimeter_proxy = z_non_rim_points_saved_100 * z_perimeter_attempt_proxy_100,
    non_rim_resid_pos_x_perimeter_proxy_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_perimeter_attempt_proxy_100, 0),
    non_rim_resid_pos_x_3pa_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_3pa_100, 0),
    non_rim_resid_pos_x_long_mid_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_long_mid_fga_100, 0),
    non_rim_resid_pos_x_short_mid_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_short_mid_fga_100, 0),
    non_rim_resid_pos_x_3pa_long_mid_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_3pa_long_mid_100, 0),
    non_rim_resid_pos_x_3pa_short_mid_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_3pa_short_mid_100, 0),
    non_rim_resid_pos_x_midrange_pos = pmax(z_non_rim_ps_resid_role, 0) * pmax(z_def_midrange_100, 0),
    non_rim_raw_pos_x_perimeter_proxy_pos = pmax(z_non_rim_points_saved_100, 0) * pmax(z_perimeter_attempt_proxy_100, 0)
  ) %>%
  ungroup()

percent_rank_safe <- function(x) {
  out <- percent_rank(x)
  out[is.na(out)] <- 0
  out
}

harmonic_mean_safe <- function(a, b) {
  ifelse(a > 0 & b > 0, 2 * a * b / (a + b), 0)
}

model_data <- model_data %>%
  group_by(year) %>%
  mutate(
    pct_non_rim_ps_resid_role = percent_rank_safe(non_rim_ps_resid_role),
    pct_perimeter_attempt_proxy = percent_rank_safe(perimeter_attempt_proxy_100),
    pct_def_3pa_long_mid = percent_rank_safe(def_3pa_long_mid_100),
    pct_def_3pa_short_mid = percent_rank_safe(def_3pa_short_mid_100),
    pct_def_3pa = percent_rank_safe(def_3pa_100),
    pct_def_long_mid = percent_rank_safe(def_long_mid_fga_100),
    pct_def_short_mid = percent_rank_safe(def_short_mid_fga_100),
    perimeter_score_min = pmin(pct_non_rim_ps_resid_role, pct_perimeter_attempt_proxy),
    perimeter_score_hmean = harmonic_mean_safe(pct_non_rim_ps_resid_role, pct_perimeter_attempt_proxy),
    perimeter_score_geom = sqrt(pct_non_rim_ps_resid_role * pct_perimeter_attempt_proxy),
    perimeter_score_gate_60 = if_else(
      pct_perimeter_attempt_proxy >= 0.60,
      pct_non_rim_ps_resid_role,
      0
    ),
    perimeter_score_gate_75 = if_else(
      pct_perimeter_attempt_proxy >= 0.75,
      pct_non_rim_ps_resid_role,
      0
    ),
    perimeter_score_3pa_long_mid_min = pmin(pct_non_rim_ps_resid_role, pct_def_3pa_long_mid),
    perimeter_score_3pa_long_mid_hmean = harmonic_mean_safe(pct_non_rim_ps_resid_role, pct_def_3pa_long_mid),
    perimeter_score_3pa_long_mid_gate_60 = if_else(
      pct_def_3pa_long_mid >= 0.60,
      pct_non_rim_ps_resid_role,
      0
    ),
    perimeter_score_3pa_short_mid_min = pmin(pct_non_rim_ps_resid_role, pct_def_3pa_short_mid),
    perimeter_score_3pa_short_mid_hmean = harmonic_mean_safe(pct_non_rim_ps_resid_role, pct_def_3pa_short_mid),
    perimeter_score_3pa_short_mid_gate_60 = if_else(
      pct_def_3pa_short_mid >= 0.60,
      pct_non_rim_ps_resid_role,
      0
    ),
    non_rim_ps_resid_shrunk_perimeter = non_rim_ps_resid_role *
      perimeter_attempt_proxy_100 / (perimeter_attempt_proxy_100 + 10),
    non_rim_ps_resid_shrunk_3pa_long_mid = non_rim_ps_resid_role *
      def_3pa_long_mid_100 / (def_3pa_long_mid_100 + 10),
    non_rim_ps_resid_shrunk_3pa_short_mid = non_rim_ps_resid_role *
      def_3pa_short_mid_100 / (def_3pa_short_mid_100 + 10),
    non_rim_ps_resid_non_center = non_rim_ps_resid_role * is_non_center,
    non_rim_ps_resid_guard = non_rim_ps_resid_role * is_guard,
    non_rim_ps_resid_forward = non_rim_ps_resid_role * is_forward,
    non_rim_ps_raw_non_center = non_rim_points_saved_100 * is_non_center,
    non_rim_ps_raw_guard = non_rim_points_saved_100 * is_guard,
    non_rim_ps_raw_forward = non_rim_points_saved_100 * is_forward,
    perimeter_zone_attempts_100 = def_3pa_100 + def_long_mid_fga_100,
    non_rim_zone_attempts_100 = def_3pa_100 + def_long_mid_fga_100 + def_short_mid_fga_100,
    perimeter_zone_share = if_else(
      non_rim_zone_attempts_100 > 0,
      perimeter_zone_attempts_100 / non_rim_zone_attempts_100,
      NA_real_
    ),
    perimeter_alloc_points_saved_100 = non_rim_points_saved_100 * perimeter_zone_share,
    non_rim_ps_resid_perimeter_share_weighted = non_rim_ps_resid_role * perimeter_zone_share
  ) %>%
  ungroup()

model_data <- model_data %>%
  add_residual_metric(
    output_name = "non_rim_ps_resid_role_short_mid_control",
    formula = non_rim_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100 + def_short_mid_fga_100
  ) %>%
  add_residual_metric(
    output_name = "perimeter_alloc_ps_resid_role",
    formula = perimeter_alloc_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100
  ) %>%
  group_by(year) %>%
  mutate(
    pct_perimeter_alloc_ps_resid_role = percent_rank_safe(perimeter_alloc_ps_resid_role),
    pct_non_rim_ps_short_mid_control = percent_rank_safe(non_rim_ps_resid_role_short_mid_control),
    perimeter_strict_score_hmean = harmonic_mean_safe(
      pct_perimeter_alloc_ps_resid_role,
      pct_def_3pa_long_mid
    ),
    perimeter_short_mid_control_score_hmean = harmonic_mean_safe(
      pct_non_rim_ps_short_mid_control,
      pct_def_3pa_long_mid
    )
  ) %>%
  ungroup()

non_rim_check <- model_data %>%
  summarize(
    rows = n(),
    non_rim_available = sum(is.finite(non_rim_dfga_100) & is.finite(non_rim_points_saved_100)),
    min_non_rim_dfga_100 = min(non_rim_dfga_100, na.rm = TRUE),
    max_abs_dif_formula_gap = max(abs(non_rim_dif_pct - non_rim_dif_pct_from_points), na.rm = TRUE)
  )

skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)
base_terms <- extract_model_terms(skillmap, "Defense?")

variants <- list(
  current = base_terms,
  current_plus_non_rim_volume = c(base_terms, "non_rim_dfga_100"),
  current_plus_non_rim_suppression = c(base_terms, "non_rim_points_saved_100"),
  current_plus_non_rim_volume_suppression = c(base_terms, "non_rim_dfga_100", "non_rim_points_saved_100"),
  current_plus_non_rim_dif = c(base_terms, "non_rim_dif_pct"),
  current_plus_non_rim_volume_dif = c(base_terms, "non_rim_dfga_100", "non_rim_dif_pct"),
  non_rim_replaces_rim_suppression = c(
    setdiff(base_terms, "rim_points_saved_100"),
    "non_rim_points_saved_100"
  ),
  rim_and_non_rim_suppression_no_blocks = c(
    setdiff(base_terms, "d_Blocks_Per100"),
    "non_rim_points_saved_100"
  )
)

best_non_rim_terms <- c(base_terms, "non_rim_dfga_100", "non_rim_points_saved_100")

drop_steal_ftov_variants <- list(
  full_non_rim = best_non_rim_terms,
  full_non_rim_drop_steals = setdiff(best_non_rim_terms, "Steals_100"),
  full_non_rim_drop_ftovs = setdiff(best_non_rim_terms, "d_FTOVs_Per100"),
  full_non_rim_drop_steals_ftovs = setdiff(best_non_rim_terms, c("Steals_100", "d_FTOVs_Per100"))
)

height_position_variants <- list(
  full_non_rim = best_non_rim_terms,
  full_non_rim_plus_height = c(best_non_rim_terms, "height_centered"),
  full_non_rim_plus_center = c(best_non_rim_terms, "is_center"),
  full_non_rim_plus_big = c(best_non_rim_terms, "is_big"),
  full_non_rim_height_interactions = c(
    best_non_rim_terms,
    "height_centered",
    "I(non_rim_dfga_100 * height_centered)",
    "I(non_rim_points_saved_100 * height_centered)"
  ),
  full_non_rim_center_interactions = c(
    best_non_rim_terms,
    "is_center",
    "I(non_rim_dfga_100 * is_center)",
    "I(non_rim_points_saved_100 * is_center)"
  )
)

perimeter_experiment_variants <- list(
  full_non_rim = best_non_rim_terms,
  residualized_non_rim_role = c(
    base_terms,
    "non_rim_dfga_100",
    "non_rim_ps_resid_role"
  ),
  residualized_non_rim_height_role = c(
    base_terms,
    "non_rim_dfga_100",
    "non_rim_ps_resid_height_role"
  ),
  position_centered_non_rim = c(
    base_terms,
    "non_rim_dfga_pos_resid",
    "non_rim_ps_pos_resid"
  ),
  perimeter_attempt_proxy = c(
    base_terms,
    "perimeter_attempt_proxy_100"
  ),
  perimeter_proxy_plus_residual_suppression = c(
    base_terms,
    "perimeter_attempt_proxy_100",
    "non_rim_ps_resid_role"
  ),
  perimeter_proxy_plus_raw_suppression = c(
    base_terms,
    "perimeter_attempt_proxy_100",
    "non_rim_points_saved_100"
  ),
  defended_3pa_and_long_mid = c(
    base_terms,
    "def_3pa_100",
    "def_long_mid_fga_100"
  ),
  defended_3pa_long_mid_plus_residual_suppression = c(
    base_terms,
    "def_3pa_100",
    "def_long_mid_fga_100",
    "non_rim_ps_resid_role"
  )
)

perimeter_interaction_variants <- list(
  residual_only = c(base_terms, "non_rim_ps_resid_role"),
  residual_plus_perimeter_proxy = c(base_terms, "non_rim_ps_resid_role", "perimeter_attempt_proxy_100"),
  residual_plus_perimeter_proxy_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "perimeter_attempt_proxy_100",
    "non_rim_resid_x_perimeter_proxy"
  ),
  residual_plus_3pa_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_3pa_100",
    "non_rim_resid_x_3pa"
  ),
  residual_plus_long_mid_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_long_mid_fga_100",
    "non_rim_resid_x_long_mid"
  ),
  residual_plus_short_mid_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_short_mid_fga_100",
    "non_rim_resid_x_short_mid"
  ),
  residual_plus_3pa_long_mid_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_3pa_long_mid_100",
    "non_rim_resid_x_3pa_long_mid"
  ),
  residual_plus_3pa_short_mid_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_3pa_short_mid_100",
    "non_rim_resid_x_3pa_short_mid"
  ),
  residual_plus_midrange_interaction = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_midrange_100",
    "non_rim_resid_x_midrange"
  ),
  composite_only_perimeter_proxy = c(base_terms, "non_rim_resid_x_perimeter_proxy"),
  composite_only_3pa_long_mid = c(base_terms, "non_rim_resid_x_3pa_long_mid"),
  raw_suppression_x_perimeter_proxy = c(
    base_terms,
    "non_rim_points_saved_100",
    "perimeter_attempt_proxy_100",
    "non_rim_raw_x_perimeter_proxy"
  ),
  positive_combo_perimeter_proxy = c(
    base_terms,
    "non_rim_resid_pos_x_perimeter_proxy_pos"
  ),
  positive_combo_3pa = c(
    base_terms,
    "non_rim_resid_pos_x_3pa_pos"
  ),
  positive_combo_long_mid = c(
    base_terms,
    "non_rim_resid_pos_x_long_mid_pos"
  ),
  positive_combo_short_mid = c(
    base_terms,
    "non_rim_resid_pos_x_short_mid_pos"
  ),
  positive_combo_3pa_long_mid = c(
    base_terms,
    "non_rim_resid_pos_x_3pa_long_mid_pos"
  ),
  positive_combo_3pa_short_mid = c(
    base_terms,
    "non_rim_resid_pos_x_3pa_short_mid_pos"
  ),
  positive_combo_midrange = c(
    base_terms,
    "non_rim_resid_pos_x_midrange_pos"
  ),
  positive_combo_perimeter_proxy_with_main_effects = c(
    base_terms,
    "non_rim_ps_resid_role",
    "perimeter_attempt_proxy_100",
    "non_rim_resid_pos_x_perimeter_proxy_pos"
  ),
  positive_combo_3pa_long_mid_with_main_effects = c(
    base_terms,
    "non_rim_ps_resid_role",
    "def_3pa_long_mid_100",
    "non_rim_resid_pos_x_3pa_long_mid_pos"
  )
)

perimeter_score_variants <- list(
  score_min = c(base_terms, "perimeter_score_min"),
  score_hmean = c(base_terms, "perimeter_score_hmean"),
  score_geom = c(base_terms, "perimeter_score_geom"),
  score_gate_60 = c(base_terms, "perimeter_score_gate_60"),
  score_gate_75 = c(base_terms, "perimeter_score_gate_75"),
  score_3pa_long_mid_min = c(base_terms, "perimeter_score_3pa_long_mid_min"),
  score_3pa_long_mid_hmean = c(base_terms, "perimeter_score_3pa_long_mid_hmean"),
  score_3pa_long_mid_gate_60 = c(base_terms, "perimeter_score_3pa_long_mid_gate_60"),
  score_3pa_short_mid_min = c(base_terms, "perimeter_score_3pa_short_mid_min"),
  score_3pa_short_mid_hmean = c(base_terms, "perimeter_score_3pa_short_mid_hmean"),
  score_3pa_short_mid_gate_60 = c(base_terms, "perimeter_score_3pa_short_mid_gate_60"),
  shrunk_perimeter = c(base_terms, "non_rim_ps_resid_shrunk_perimeter"),
  shrunk_3pa_long_mid = c(base_terms, "non_rim_ps_resid_shrunk_3pa_long_mid"),
  shrunk_3pa_short_mid = c(base_terms, "non_rim_ps_resid_shrunk_3pa_short_mid")
)

position_specific_variants <- list(
  residual_main = c(base_terms, "non_rim_ps_resid_role"),
  residual_plus_position_controls = c(
    base_terms,
    "non_rim_ps_resid_role",
    "is_guard",
    "is_forward"
  ),
  residual_position_slopes = c(
    base_terms,
    "non_rim_ps_resid_role",
    "is_guard",
    "is_forward",
    "I(non_rim_ps_resid_role * is_guard)",
    "I(non_rim_ps_resid_role * is_forward)"
  ),
  residual_non_center_only = c(
    base_terms,
    "non_rim_ps_resid_non_center"
  ),
  residual_guard_forward_split = c(
    base_terms,
    "non_rim_ps_resid_guard",
    "non_rim_ps_resid_forward"
  ),
  raw_position_slopes = c(
    base_terms,
    "non_rim_points_saved_100",
    "is_guard",
    "is_forward",
    "I(non_rim_points_saved_100 * is_guard)",
    "I(non_rim_points_saved_100 * is_forward)"
  ),
  raw_non_center_only = c(
    base_terms,
    "non_rim_ps_raw_non_center"
  ),
  raw_guard_forward_split = c(
    base_terms,
    "non_rim_ps_raw_guard",
    "non_rim_ps_raw_forward"
  ),
  short_mid_control_residual = c(
    base_terms,
    "non_rim_ps_resid_role_short_mid_control"
  ),
  perimeter_share_weighted_residual = c(
    base_terms,
    "non_rim_ps_resid_perimeter_share_weighted"
  ),
  perimeter_alloc_residual = c(
    base_terms,
    "perimeter_alloc_ps_resid_role"
  ),
  perimeter_alloc_residual_drop_steals = c(
    setdiff(base_terms, "Steals_100"),
    "perimeter_alloc_ps_resid_role"
  ),
  perimeter_strict_hmean = c(
    base_terms,
    "perimeter_strict_score_hmean"
  ),
  perimeter_short_mid_control_hmean = c(
    base_terms,
    "perimeter_short_mid_control_score_hmean"
  )
)

fits <- imap(variants, ~ fit_variant(.y, .x, model_data))
baseline_fit <- fits$current$fit
drop_steal_ftov_fits <- imap(drop_steal_ftov_variants, ~ fit_variant(.y, .x, model_data))
height_position_fits <- imap(height_position_variants, ~ fit_variant(.y, .x, model_data))
perimeter_experiment_fits <- imap(perimeter_experiment_variants, ~ fit_variant(.y, .x, model_data))
perimeter_interaction_fits <- imap(perimeter_interaction_variants, ~ fit_variant(.y, .x, model_data))
perimeter_score_fits <- imap(perimeter_score_variants, ~ fit_variant(.y, .x, model_data))
position_specific_fits <- imap(position_specific_variants, ~ fit_variant(.y, .x, model_data))

model_summaries <- map_dfr(fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

coef_table <- map_dfr(fits, "coefs") %>%
  arrange(variant, p_value)

added_term_tests <- map_dfr(fits[names(fits) != "current"], function(x) {
  if (!all(base_terms %in% x$terms)) {
    return(tibble(
      variant = x$label,
      nested_vs_current = FALSE,
      df = NA_real_,
      sumsq = NA_real_,
      f_value = NA_real_,
      p_value = NA_real_
    ))
  }

  a <- anova(baseline_fit, x$fit)
  tibble(
    variant = x$label,
    nested_vs_current = TRUE,
    df = a$Df[2],
    sumsq = a$`Sum of Sq`[2],
    f_value = a$F[2],
    p_value = a$`Pr(>F)`[2]
  )
}) %>%
  arrange(p_value)

drop_steal_ftov_summaries <- map_dfr(drop_steal_ftov_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

drop_steal_ftov_coefs <- map_dfr(drop_steal_ftov_fits, "coefs") %>%
  filter(term %in% c(
    "Steals_100",
    "d_FTOVs_Per100",
    "non_rim_dfga_100",
    "non_rim_points_saved_100"
  )) %>%
  arrange(variant, p_value)

height_position_summaries <- map_dfr(height_position_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

height_position_coefs <- map_dfr(height_position_fits, "coefs") %>%
  filter(
    term %in% c(
      "non_rim_dfga_100",
      "non_rim_points_saved_100",
      "height_centered",
      "is_center",
      "is_big",
      "I(non_rim_dfga_100 * height_centered)",
      "I(non_rim_points_saved_100 * height_centered)",
      "I(non_rim_dfga_100 * is_center)",
      "I(non_rim_points_saved_100 * is_center)"
    )
  ) %>%
  arrange(variant, p_value)

perimeter_experiment_summaries <- map_dfr(perimeter_experiment_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

perimeter_experiment_coefs <- map_dfr(perimeter_experiment_fits, "coefs") %>%
  filter(
    term %in% c(
      "non_rim_dfga_100",
      "non_rim_points_saved_100",
      "non_rim_ps_resid_role",
      "non_rim_ps_resid_height_role",
      "non_rim_ps_pos_resid",
      "non_rim_dfga_pos_resid",
      "perimeter_attempt_proxy_100",
      "def_3pa_100",
      "def_long_mid_fga_100"
    )
  ) %>%
  arrange(variant, p_value)

perimeter_interaction_summaries <- map_dfr(perimeter_interaction_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

perimeter_interaction_coefs <- map_dfr(perimeter_interaction_fits, "coefs") %>%
  filter(
    term %in% c(
      "non_rim_ps_resid_role",
      "non_rim_points_saved_100",
      "perimeter_attempt_proxy_100",
      "def_3pa_100",
      "def_long_mid_fga_100",
      "def_short_mid_fga_100",
      "def_3pa_long_mid_100",
      "def_3pa_short_mid_100",
      "def_midrange_100",
      "non_rim_resid_x_perimeter_proxy",
      "non_rim_resid_x_3pa",
      "non_rim_resid_x_long_mid",
      "non_rim_resid_x_short_mid",
      "non_rim_resid_x_3pa_long_mid",
      "non_rim_resid_x_3pa_short_mid",
      "non_rim_resid_x_midrange",
      "non_rim_raw_x_perimeter_proxy",
      "non_rim_resid_pos_x_perimeter_proxy_pos",
      "non_rim_resid_pos_x_3pa_pos",
      "non_rim_resid_pos_x_long_mid_pos",
      "non_rim_resid_pos_x_short_mid_pos",
      "non_rim_resid_pos_x_3pa_long_mid_pos",
      "non_rim_resid_pos_x_3pa_short_mid_pos",
      "non_rim_resid_pos_x_midrange_pos",
      "non_rim_raw_pos_x_perimeter_proxy_pos"
    )
  ) %>%
  arrange(variant, p_value)

perimeter_score_summaries <- map_dfr(perimeter_score_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

perimeter_score_coefs <- map_dfr(perimeter_score_fits, "coefs") %>%
  filter(
    term %in% c(
      "perimeter_score_min",
      "perimeter_score_hmean",
      "perimeter_score_geom",
      "perimeter_score_gate_60",
      "perimeter_score_gate_75",
      "perimeter_score_3pa_long_mid_min",
      "perimeter_score_3pa_long_mid_hmean",
      "perimeter_score_3pa_long_mid_gate_60",
      "perimeter_score_3pa_short_mid_min",
      "perimeter_score_3pa_short_mid_hmean",
      "perimeter_score_3pa_short_mid_gate_60",
      "non_rim_ps_resid_shrunk_perimeter",
      "non_rim_ps_resid_shrunk_3pa_long_mid",
      "non_rim_ps_resid_shrunk_3pa_short_mid"
    )
  ) %>%
  arrange(variant, p_value)

position_specific_summaries <- map_dfr(position_specific_fits, "summary") %>%
  arrange(desc(adj_r_squared), sigma)

position_specific_coefs <- map_dfr(position_specific_fits, "coefs") %>%
  filter(
    term %in% c(
      "non_rim_ps_resid_role",
      "non_rim_points_saved_100",
      "is_guard",
      "is_forward",
      "I(non_rim_ps_resid_role * is_guard)",
      "I(non_rim_ps_resid_role * is_forward)",
      "I(non_rim_points_saved_100 * is_guard)",
      "I(non_rim_points_saved_100 * is_forward)",
      "non_rim_ps_resid_non_center",
      "non_rim_ps_resid_guard",
      "non_rim_ps_resid_forward",
      "non_rim_ps_raw_non_center",
      "non_rim_ps_raw_guard",
      "non_rim_ps_raw_forward",
      "non_rim_ps_resid_role_short_mid_control",
      "non_rim_ps_resid_perimeter_share_weighted",
      "perimeter_alloc_ps_resid_role",
      "perimeter_strict_score_hmean",
      "perimeter_short_mid_control_score_hmean"
    )
  ) %>%
  arrange(variant, p_value)

candidate_switch_fit <- position_specific_fits$perimeter_alloc_residual$fit
candidate_switch_coef <- coef(candidate_switch_fit)
candidate_switch_terms <- c("switch", "perimeter_alloc_ps_resid_role")
candidate_switch_drop_steals_fit <- position_specific_fits$perimeter_alloc_residual_drop_steals$fit
candidate_switch_drop_steals_coef <- coef(candidate_switch_drop_steals_fit)

candidate_switch_coefficients <- tibble(
  model = c(
    rep("perimeter_alloc_residual", length(candidate_switch_terms)),
    rep("perimeter_alloc_residual_drop_steals", length(candidate_switch_terms))
  ),
  term = rep(candidate_switch_terms, 2),
  estimate = c(
    as.numeric(candidate_switch_coef[candidate_switch_terms]),
    as.numeric(candidate_switch_drop_steals_coef[candidate_switch_terms])
  )
)

current_same_sample_fit <- fit_variant(
  "current_same_sample",
  base_terms,
  model_data %>% filter(is.finite(perimeter_alloc_ps_resid_role))
)

candidate_switch_model_coeff_compare <- full_join(
  current_same_sample_fit$coefs %>%
    filter(term != "(Intercept)") %>%
    select(
      term,
      current_estimate = estimate,
      current_std_error = std_error,
      current_t_value = t_value,
      current_p_value = p_value
    ),
  position_specific_fits$perimeter_alloc_residual$coefs %>%
    filter(term != "(Intercept)") %>%
    select(
      term,
      candidate_estimate = estimate,
      candidate_std_error = std_error,
      candidate_t_value = t_value,
      candidate_p_value = p_value
    ),
  by = "term"
) %>%
  mutate(
    estimate_delta = candidate_estimate - current_estimate,
    pct_estimate_delta = estimate_delta / current_estimate,
    abs_pct_estimate_delta = abs(pct_estimate_delta),
    t_value_delta = candidate_t_value - current_t_value
  ) %>%
  arrange(match(term, c(base_terms, "perimeter_alloc_ps_resid_role")))

candidate_switch_drop_steals_model_coeff_compare <- full_join(
  position_specific_fits$perimeter_alloc_residual$coefs %>%
    filter(term != "(Intercept)") %>%
    select(
      term,
      with_steals_estimate = estimate,
      with_steals_std_error = std_error,
      with_steals_t_value = t_value,
      with_steals_p_value = p_value
    ),
  position_specific_fits$perimeter_alloc_residual_drop_steals$coefs %>%
    filter(term != "(Intercept)") %>%
    select(
      term,
      drop_steals_estimate = estimate,
      drop_steals_std_error = std_error,
      drop_steals_t_value = t_value,
      drop_steals_p_value = p_value
    ),
  by = "term"
) %>%
  mutate(
    estimate_delta = drop_steals_estimate - with_steals_estimate,
    pct_estimate_delta = estimate_delta / with_steals_estimate,
    abs_pct_estimate_delta = abs(pct_estimate_delta),
    t_value_delta = drop_steals_t_value - with_steals_t_value
  ) %>%
  arrange(match(term, c(base_terms, "perimeter_alloc_ps_resid_role")))

candidate_switch_diagnostic_vars <- c(base_terms, "perimeter_alloc_ps_resid_role")

candidate_switch_diagnostic_data <- model_data %>%
  select(all_of(candidate_switch_diagnostic_vars)) %>%
  filter(if_all(everything(), is.finite))

candidate_switch_correlation_matrix <- cor(candidate_switch_diagnostic_data, use = "complete.obs")

candidate_switch_new_variable_correlations <- tibble(
  term = setdiff(candidate_switch_diagnostic_vars, "perimeter_alloc_ps_resid_role"),
  correlation_with_perimeter_alloc_resid = as.numeric(
    candidate_switch_correlation_matrix[
      "perimeter_alloc_ps_resid_role",
      setdiff(candidate_switch_diagnostic_vars, "perimeter_alloc_ps_resid_role")
    ]
  )
) %>%
  arrange(desc(abs(correlation_with_perimeter_alloc_resid)))

candidate_switch_vif <- map_dfr(candidate_switch_diagnostic_vars, function(var_name) {
  other_vars <- setdiff(candidate_switch_diagnostic_vars, var_name)
  formula <- as.formula(paste(
    format_formula_term(var_name),
    "~",
    paste(vapply(other_vars, format_formula_term, character(1)), collapse = " + ")
  ))
  r_squared_with_other_predictors <- summary(lm(formula, data = candidate_switch_diagnostic_data))$r.squared
  tibble(
    term = var_name,
    r_squared_with_other_predictors = r_squared_with_other_predictors,
    vif = 1 / (1 - r_squared_with_other_predictors)
  )
}) %>%
  arrange(desc(vif))

zone_suppression_field_check <- tibble(
  field_family = c(
    "defended_3pt_attempts",
    "defended_long_mid_attempts",
    "defended_short_mid_attempts",
    "defended_3pt_suppression",
    "defended_long_mid_suppression",
    "defended_short_mid_suppression"
  ),
  fields_found = c(
    paste(grep("^d_FG3A", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), value = TRUE), collapse = " | "),
    paste(grep("^d_LongMidRangeFGA", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), value = TRUE), collapse = " | "),
    paste(grep("^d_ShortMidRangeFGA", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), value = TRUE), collapse = " | "),
    paste(grep("3.*(dif|saved)|FG3.*(dif|saved)|three.*(dif|saved)", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), ignore.case = TRUE, value = TRUE), collapse = " | "),
    paste(grep("LongMid.*(dif|saved)", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), ignore.case = TRUE, value = TRUE), collapse = " | "),
    paste(grep("ShortMid.*(dif|saved)", names(read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE)), ignore.case = TRUE, value = TRUE), collapse = " | ")
  )
)

zone_suppression_field_check <- zone_suppression_field_check %>%
  mutate(fields_found = if_else(fields_found == "", "(none)", fields_found))

diagnostic_vars <- c(
  "switch",
  "Steals_100",
  "d_FTOVs_Per100",
  "d_DefRebounds_Per100",
  "d_Blocks_Per100",
  "rim_points_saved_100",
  "non_rim_dfga_100",
  "non_rim_points_saved_100"
)

diagnostic_data <- model_data %>%
  select(all_of(diagnostic_vars)) %>%
  filter(if_all(everything(), is.finite))

correlation_matrix <- cor(diagnostic_data, use = "complete.obs")

correlation_table <- as.data.frame(as.table(correlation_matrix)) %>%
  as_tibble() %>%
  transmute(
    var1 = as.character(Var1),
    var2 = as.character(Var2),
    correlation = Freq
  ) %>%
  filter(var1 < var2) %>%
  arrange(desc(abs(correlation)))

vif_table <- map_dfr(diagnostic_vars, function(v) {
  other_vars <- setdiff(diagnostic_vars, v)
  fit <- lm(reformulate(other_vars, response = v), data = diagnostic_data)
  r_squared <- summary(fit)$r.squared

  tibble(
    term = v,
    r_squared_with_other_predictors = unname(r_squared),
    vif = unname(1 / (1 - r_squared))
  )
}) %>%
  arrange(desc(vif))

latest_non_rim_leaders <- read_csv(file.path(base_dir, "raw", "databallr_stats.csv"), show_col_types = FALSE) %>%
  transmute(
    player_name = coalesce(player_name, Name),
    nba_id = clean_id(nba_id),
    year = as.integer(year),
    minutes = as.numeric(Minutes),
    dfga_100 = as.numeric(`dfga/100`),
    rimdfga_100 = as.numeric(`rimdfga/100`),
    points_saved_100 = as.numeric(points_saved_100),
    rim_points_saved_100 = as.numeric(rim_points_saved_100),
    non_rim_dfga_100 = dfga_100 - rimdfga_100,
    non_rim_points_saved_100 = points_saved_100 - rim_points_saved_100
  ) %>%
  filter(year == max(year, na.rm = TRUE)) %>%
  filter(is.finite(non_rim_dfga_100), is.finite(non_rim_points_saved_100))

top_non_rim_dfga_100 <- latest_non_rim_leaders %>%
  arrange(desc(non_rim_dfga_100)) %>%
  select(player_name, year, minutes, non_rim_dfga_100, non_rim_points_saved_100) %>%
  slice_head(n = 10)

top_non_rim_points_saved_100 <- latest_non_rim_leaders %>%
  arrange(desc(non_rim_points_saved_100)) %>%
  select(player_name, year, minutes, non_rim_points_saved_100, non_rim_dfga_100) %>%
  slice_head(n = 10)

latest_perimeter_experiment_leaders <- model_data %>%
  filter(year == max(year, na.rm = TRUE), minutes >= 500) %>%
  select(
    player_name,
    year,
    minutes,
    primary_pos,
    non_rim_ps_resid_role,
    non_rim_ps_pos_resid,
    perimeter_attempt_proxy_100,
    def_3pa_100,
    def_long_mid_fga_100,
    non_rim_points_saved_100,
    non_rim_dfga_100,
    non_rim_resid_x_perimeter_proxy,
    non_rim_resid_x_3pa,
    non_rim_resid_x_3pa_long_mid,
    non_rim_resid_x_3pa_short_mid,
    non_rim_resid_x_midrange,
    non_rim_resid_pos_x_perimeter_proxy_pos,
    non_rim_resid_pos_x_3pa_pos,
    non_rim_resid_pos_x_3pa_long_mid_pos,
    non_rim_resid_pos_x_3pa_short_mid_pos,
    non_rim_resid_pos_x_midrange_pos,
    perimeter_score_min,
    perimeter_score_hmean,
    perimeter_score_geom,
    perimeter_score_gate_60,
    perimeter_score_gate_75,
    perimeter_score_3pa_long_mid_min,
    perimeter_score_3pa_long_mid_hmean,
    perimeter_score_3pa_long_mid_gate_60,
    perimeter_score_3pa_short_mid_min,
    perimeter_score_3pa_short_mid_hmean,
    perimeter_score_3pa_short_mid_gate_60,
    non_rim_ps_resid_shrunk_perimeter,
    non_rim_ps_resid_shrunk_3pa_long_mid,
    non_rim_ps_resid_shrunk_3pa_short_mid,
    perimeter_zone_share,
    perimeter_alloc_points_saved_100,
    non_rim_ps_resid_role_short_mid_control,
    non_rim_ps_resid_perimeter_share_weighted,
    perimeter_alloc_ps_resid_role,
    perimeter_strict_score_hmean,
    perimeter_short_mid_control_score_hmean
  )

top_non_rim_ps_resid_role <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_ps_resid_role)) %>%
  slice_head(n = 10)

top_non_center_non_rim_ps_resid_role <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos != "C") %>%
  arrange(desc(non_rim_ps_resid_role)) %>%
  slice_head(n = 20)

top_guard_non_rim_ps_resid_role <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "G") %>%
  arrange(desc(non_rim_ps_resid_role)) %>%
  slice_head(n = 20)

top_forward_non_rim_ps_resid_role <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "F") %>%
  arrange(desc(non_rim_ps_resid_role)) %>%
  slice_head(n = 20)

top_guard_short_mid_control <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "G") %>%
  arrange(desc(non_rim_ps_resid_role_short_mid_control)) %>%
  slice_head(n = 20)

top_forward_short_mid_control <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "F") %>%
  arrange(desc(non_rim_ps_resid_role_short_mid_control)) %>%
  slice_head(n = 20)

top_guard_perimeter_alloc_resid <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "G") %>%
  arrange(desc(perimeter_alloc_ps_resid_role)) %>%
  slice_head(n = 20)

top_forward_perimeter_alloc_resid <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "F") %>%
  arrange(desc(perimeter_alloc_ps_resid_role)) %>%
  slice_head(n = 20)

top_guard_strict_hmean <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "G") %>%
  arrange(desc(perimeter_strict_score_hmean)) %>%
  slice_head(n = 20)

top_forward_strict_hmean <- latest_perimeter_experiment_leaders %>%
  filter(primary_pos == "F") %>%
  arrange(desc(perimeter_strict_score_hmean)) %>%
  slice_head(n = 20)

candidate_switch_all <- model_data %>%
  filter(year == max(year, na.rm = TRUE), minutes >= 500) %>%
  mutate(
    candidate_switch_contrib_current_switch = unname(candidate_switch_coef["switch"]) * switch,
    candidate_switch_contrib_perimeter = unname(candidate_switch_coef["perimeter_alloc_ps_resid_role"]) * perimeter_alloc_ps_resid_role,
    candidate_switch_raw = candidate_switch_contrib_current_switch + candidate_switch_contrib_perimeter,
    candidate_switch_z = safe_z(candidate_switch_raw),
    current_switch_raw = unname(candidate_switch_coef["switch"]) * switch,
    current_switch_z = safe_z(current_switch_raw),
    perimeter_contribution_share = if_else(
      abs(candidate_switch_raw) > 0,
      candidate_switch_contrib_perimeter / candidate_switch_raw,
      NA_real_
    )
  ) %>%
  mutate(
    candidate_switch_rank = min_rank(desc(candidate_switch_raw)),
    current_switch_rank = min_rank(desc(current_switch_raw)),
    switch_rank_gain = current_switch_rank - candidate_switch_rank,
    switch_z_delta = candidate_switch_z - current_switch_z
  ) %>%
  select(
    player_name,
    year,
    minutes,
    primary_pos,
    candidate_switch_rank,
    current_switch_rank,
    switch_rank_gain,
    switch_z_delta,
    candidate_switch_z,
    candidate_switch_raw,
    candidate_switch_contrib_current_switch,
    candidate_switch_contrib_perimeter,
    perimeter_contribution_share,
    current_switch_z,
    switch,
    perimeter_alloc_ps_resid_role,
    perimeter_alloc_points_saved_100,
    perimeter_zone_share
  )

candidate_switch_drop_steals_all <- model_data %>%
  filter(year == max(year, na.rm = TRUE), minutes >= 500) %>%
  mutate(
    drop_steals_switch_contrib_current_switch = unname(candidate_switch_drop_steals_coef["switch"]) * switch,
    drop_steals_switch_contrib_perimeter = unname(candidate_switch_drop_steals_coef["perimeter_alloc_ps_resid_role"]) * perimeter_alloc_ps_resid_role,
    drop_steals_switch_raw = drop_steals_switch_contrib_current_switch + drop_steals_switch_contrib_perimeter,
    drop_steals_switch_z = safe_z(drop_steals_switch_raw),
    drop_steals_switch_rank = min_rank(desc(drop_steals_switch_raw)),
    drop_steals_perimeter_contribution_share = if_else(
      abs(drop_steals_switch_raw) > 0,
      drop_steals_switch_contrib_perimeter / drop_steals_switch_raw,
      NA_real_
    )
  ) %>%
  select(
    player_name,
    year,
    minutes,
    primary_pos,
    drop_steals_switch_rank,
    drop_steals_switch_z,
    drop_steals_switch_raw,
    drop_steals_switch_contrib_current_switch,
    drop_steals_switch_contrib_perimeter,
    drop_steals_perimeter_contribution_share
  )

candidate_switch_drop_steals_comparison <- candidate_switch_all %>%
  left_join(
    candidate_switch_drop_steals_all,
    by = c("player_name", "year", "minutes", "primary_pos")
  ) %>%
  mutate(
    drop_steals_rank_gain = candidate_switch_rank - drop_steals_switch_rank,
    drop_steals_z_delta = drop_steals_switch_z - candidate_switch_z
  ) %>%
  arrange(drop_steals_switch_rank)

candidate_switch_leaders <- candidate_switch_all %>%
  arrange(candidate_switch_rank) %>%
  slice_head(n = 40)

candidate_switch_drop_steals_leaders <- candidate_switch_drop_steals_comparison %>%
  arrange(drop_steals_switch_rank) %>%
  slice_head(n = 40)

top_non_rim_ps_pos_resid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_ps_pos_resid)) %>%
  slice_head(n = 10)

top_perimeter_attempt_proxy <- latest_perimeter_experiment_leaders %>%
  arrange(desc(perimeter_attempt_proxy_100)) %>%
  slice_head(n = 10)

top_non_rim_resid_x_perimeter_proxy <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_x_perimeter_proxy)) %>%
  slice_head(n = 10)

top_non_rim_resid_x_3pa_long_mid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_x_3pa_long_mid)) %>%
  slice_head(n = 10)

top_non_rim_resid_x_3pa_short_mid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_x_3pa_short_mid)) %>%
  slice_head(n = 10)

top_non_rim_resid_pos_x_perimeter_proxy <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_pos_x_perimeter_proxy_pos)) %>%
  slice_head(n = 10)

top_non_rim_resid_pos_x_3pa_long_mid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_pos_x_3pa_long_mid_pos)) %>%
  slice_head(n = 10)

top_non_rim_resid_pos_x_3pa_short_mid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_resid_pos_x_3pa_short_mid_pos)) %>%
  slice_head(n = 10)

top_perimeter_score_hmean <- latest_perimeter_experiment_leaders %>%
  arrange(desc(perimeter_score_hmean)) %>%
  slice_head(n = 10)

top_perimeter_score_gate_60 <- latest_perimeter_experiment_leaders %>%
  arrange(desc(perimeter_score_gate_60)) %>%
  slice_head(n = 10)

top_perimeter_score_3pa_long_mid_hmean <- latest_perimeter_experiment_leaders %>%
  arrange(desc(perimeter_score_3pa_long_mid_hmean)) %>%
  slice_head(n = 10)

top_perimeter_score_3pa_short_mid_hmean <- latest_perimeter_experiment_leaders %>%
  arrange(desc(perimeter_score_3pa_short_mid_hmean)) %>%
  slice_head(n = 10)

top_non_rim_ps_resid_shrunk_3pa_long_mid <- latest_perimeter_experiment_leaders %>%
  arrange(desc(non_rim_ps_resid_shrunk_3pa_long_mid)) %>%
  slice_head(n = 10)

write_csv(model_summaries, file.path(out_dir, "model_summaries.csv"))
write_csv(coef_table, file.path(out_dir, "coefficient_tests.csv"))
write_csv(added_term_tests, file.path(out_dir, "nested_added_term_tests.csv"))
write_csv(non_rim_check, file.path(out_dir, "data_check.csv"))
write_csv(correlation_table, file.path(out_dir, "predictor_correlations.csv"))
write_csv(vif_table, file.path(out_dir, "predictor_vif.csv"))
write_csv(drop_steal_ftov_summaries, file.path(out_dir, "drop_steal_ftov_summaries.csv"))
write_csv(drop_steal_ftov_coefs, file.path(out_dir, "drop_steal_ftov_coefficients.csv"))
write_csv(height_position_summaries, file.path(out_dir, "height_position_summaries.csv"))
write_csv(height_position_coefs, file.path(out_dir, "height_position_coefficients.csv"))
write_csv(perimeter_experiment_summaries, file.path(out_dir, "perimeter_experiment_summaries.csv"))
write_csv(perimeter_experiment_coefs, file.path(out_dir, "perimeter_experiment_coefficients.csv"))
write_csv(perimeter_interaction_summaries, file.path(out_dir, "perimeter_interaction_summaries.csv"))
write_csv(perimeter_interaction_coefs, file.path(out_dir, "perimeter_interaction_coefficients.csv"))
write_csv(perimeter_score_summaries, file.path(out_dir, "perimeter_score_summaries.csv"))
write_csv(perimeter_score_coefs, file.path(out_dir, "perimeter_score_coefficients.csv"))
write_csv(position_specific_summaries, file.path(out_dir, "position_specific_summaries.csv"))
write_csv(position_specific_coefs, file.path(out_dir, "position_specific_coefficients.csv"))
write_csv(candidate_switch_coefficients, file.path(out_dir, "candidate_switch_coefficients.csv"))
write_csv(candidate_switch_model_coeff_compare, file.path(out_dir, "candidate_switch_model_coeff_compare.csv"))
write_csv(candidate_switch_drop_steals_model_coeff_compare, file.path(out_dir, "candidate_switch_drop_steals_model_coeff_compare.csv"))
write_csv(candidate_switch_new_variable_correlations, file.path(out_dir, "candidate_switch_new_variable_correlations.csv"))
write_csv(candidate_switch_vif, file.path(out_dir, "candidate_switch_vif.csv"))
write_csv(zone_suppression_field_check, file.path(out_dir, "zone_suppression_field_check.csv"))
write_csv(top_non_rim_dfga_100, file.path(out_dir, "latest_top_non_rim_dfga_100.csv"))
write_csv(top_non_rim_points_saved_100, file.path(out_dir, "latest_top_non_rim_points_saved_100.csv"))
write_csv(top_non_rim_ps_resid_role, file.path(out_dir, "latest_top_non_rim_ps_resid_role.csv"))
write_csv(top_non_center_non_rim_ps_resid_role, file.path(out_dir, "latest_top_non_center_non_rim_ps_resid_role.csv"))
write_csv(top_guard_non_rim_ps_resid_role, file.path(out_dir, "latest_top_guard_non_rim_ps_resid_role.csv"))
write_csv(top_forward_non_rim_ps_resid_role, file.path(out_dir, "latest_top_forward_non_rim_ps_resid_role.csv"))
write_csv(top_guard_short_mid_control, file.path(out_dir, "latest_top_guard_short_mid_control.csv"))
write_csv(top_forward_short_mid_control, file.path(out_dir, "latest_top_forward_short_mid_control.csv"))
write_csv(top_guard_perimeter_alloc_resid, file.path(out_dir, "latest_top_guard_perimeter_alloc_resid.csv"))
write_csv(top_forward_perimeter_alloc_resid, file.path(out_dir, "latest_top_forward_perimeter_alloc_resid.csv"))
write_csv(top_guard_strict_hmean, file.path(out_dir, "latest_top_guard_strict_hmean.csv"))
write_csv(top_forward_strict_hmean, file.path(out_dir, "latest_top_forward_strict_hmean.csv"))
write_csv(candidate_switch_all, file.path(out_dir, "latest_candidate_switch_all.csv"))
write_csv(candidate_switch_leaders, file.path(out_dir, "latest_candidate_switch_leaders.csv"))
write_csv(candidate_switch_drop_steals_all, file.path(out_dir, "latest_candidate_switch_drop_steals_all.csv"))
write_csv(candidate_switch_drop_steals_comparison, file.path(out_dir, "latest_candidate_switch_drop_steals_comparison.csv"))
write_csv(candidate_switch_drop_steals_leaders, file.path(out_dir, "latest_candidate_switch_drop_steals_leaders.csv"))
write_csv(top_non_rim_ps_pos_resid, file.path(out_dir, "latest_top_non_rim_ps_pos_resid.csv"))
write_csv(top_perimeter_attempt_proxy, file.path(out_dir, "latest_top_perimeter_attempt_proxy.csv"))
write_csv(top_non_rim_resid_x_perimeter_proxy, file.path(out_dir, "latest_top_non_rim_resid_x_perimeter_proxy.csv"))
write_csv(top_non_rim_resid_x_3pa_long_mid, file.path(out_dir, "latest_top_non_rim_resid_x_3pa_long_mid.csv"))
write_csv(top_non_rim_resid_x_3pa_short_mid, file.path(out_dir, "latest_top_non_rim_resid_x_3pa_short_mid.csv"))
write_csv(top_non_rim_resid_pos_x_perimeter_proxy, file.path(out_dir, "latest_top_non_rim_resid_pos_x_perimeter_proxy.csv"))
write_csv(top_non_rim_resid_pos_x_3pa_long_mid, file.path(out_dir, "latest_top_non_rim_resid_pos_x_3pa_long_mid.csv"))
write_csv(top_non_rim_resid_pos_x_3pa_short_mid, file.path(out_dir, "latest_top_non_rim_resid_pos_x_3pa_short_mid.csv"))
write_csv(top_perimeter_score_hmean, file.path(out_dir, "latest_top_perimeter_score_hmean.csv"))
write_csv(top_perimeter_score_gate_60, file.path(out_dir, "latest_top_perimeter_score_gate_60.csv"))
write_csv(top_perimeter_score_3pa_long_mid_hmean, file.path(out_dir, "latest_top_perimeter_score_3pa_long_mid_hmean.csv"))
write_csv(top_perimeter_score_3pa_short_mid_hmean, file.path(out_dir, "latest_top_perimeter_score_3pa_short_mid_hmean.csv"))
write_csv(top_non_rim_ps_resid_shrunk_3pa_long_mid, file.path(out_dir, "latest_top_non_rim_ps_resid_shrunk_3pa_long_mid.csv"))

cat("\nData check:\n")
print(non_rim_check)

cat("\nModel summaries:\n")
print(model_summaries, n = Inf)

cat("\nNon-rim coefficient rows:\n")
print(
  coef_table %>%
    filter(term %in% c("non_rim_dfga_100", "non_rim_points_saved_100", "non_rim_dif_pct")) %>%
    arrange(p_value) %>%
    as_tibble(),
  n = Inf
)

cat("\nNested tests vs current model:\n")
print(added_term_tests, n = Inf)

cat("\nStrongest predictor correlations:\n")
print(head(correlation_table, 20), n = Inf)

cat("\nPredictor VIF:\n")
print(vif_table, n = Inf)

cat("\nDrop steal/FTOV comparison:\n")
print(drop_steal_ftov_summaries, n = Inf)

cat("\nDrop steal/FTOV selected coefficients:\n")
print(as_tibble(drop_steal_ftov_coefs), n = Inf)

cat("\nHeight/position comparison:\n")
print(height_position_summaries, n = Inf)

cat("\nHeight/position selected coefficients:\n")
print(as_tibble(height_position_coefs), n = Inf)

cat("\nPerimeter experiment comparison:\n")
print(perimeter_experiment_summaries, n = Inf)

cat("\nPerimeter experiment selected coefficients:\n")
print(as_tibble(perimeter_experiment_coefs), n = Inf)

cat("\nZone suppression field check:\n")
print(zone_suppression_field_check, n = Inf)

cat("\nPerimeter interaction comparison:\n")
print(perimeter_interaction_summaries, n = Inf)

cat("\nPerimeter interaction selected coefficients:\n")
print(as_tibble(perimeter_interaction_coefs), n = Inf)

cat("\nPerimeter score comparison:\n")
print(perimeter_score_summaries, n = Inf)

cat("\nPerimeter score selected coefficients:\n")
print(as_tibble(perimeter_score_coefs), n = Inf)

cat("\nPosition-specific non-rim comparison:\n")
print(position_specific_summaries, n = Inf)

cat("\nPosition-specific non-rim selected coefficients:\n")
print(as_tibble(position_specific_coefs), n = Inf)

cat("\nCandidate SWITCH coefficients:\n")
print(candidate_switch_coefficients, n = Inf)

cat("\nLatest top non-rim DFGA/100:\n")
print(top_non_rim_dfga_100, n = Inf)

cat("\nLatest top non-rim points saved/100:\n")
print(top_non_rim_points_saved_100, n = Inf)

cat("\nLatest top role-residualized non-rim points saved, 500+ minutes:\n")
print(top_non_rim_ps_resid_role, n = Inf)

cat("\nLatest top non-center role-residualized non-rim points saved, 500+ minutes:\n")
print(top_non_center_non_rim_ps_resid_role, n = Inf)

cat("\nLatest top guard role-residualized non-rim points saved, 500+ minutes:\n")
print(top_guard_non_rim_ps_resid_role, n = Inf)

cat("\nLatest top forward role-residualized non-rim points saved, 500+ minutes:\n")
print(top_forward_non_rim_ps_resid_role, n = Inf)

cat("\nLatest top position-centered non-rim points saved, 500+ minutes:\n")
print(top_non_rim_ps_pos_resid, n = Inf)

cat("\nLatest top perimeter attempt proxy, 500+ minutes:\n")
print(top_perimeter_attempt_proxy, n = Inf)

cat("\nLatest top residual x perimeter proxy, 500+ minutes:\n")
print(top_non_rim_resid_x_perimeter_proxy, n = Inf)

cat("\nLatest top residual x 3PA+long-mid, 500+ minutes:\n")
print(top_non_rim_resid_x_3pa_long_mid, n = Inf)

cat("\nLatest top residual x 3PA+short-mid, 500+ minutes:\n")
print(top_non_rim_resid_x_3pa_short_mid, n = Inf)

cat("\nLatest top positive residual x positive perimeter proxy, 500+ minutes:\n")
print(top_non_rim_resid_pos_x_perimeter_proxy, n = Inf)

cat("\nLatest top positive residual x positive 3PA+long-mid, 500+ minutes:\n")
print(top_non_rim_resid_pos_x_3pa_long_mid, n = Inf)

cat("\nLatest top positive residual x positive 3PA+short-mid, 500+ minutes:\n")
print(top_non_rim_resid_pos_x_3pa_short_mid, n = Inf)

cat("\nLatest top perimeter score harmonic mean, 500+ minutes:\n")
print(top_perimeter_score_hmean, n = Inf)

cat("\nLatest top perimeter score gate 60, 500+ minutes:\n")
print(top_perimeter_score_gate_60, n = Inf)

cat("\nLatest top perimeter score 3PA+long-mid harmonic mean, 500+ minutes:\n")
print(top_perimeter_score_3pa_long_mid_hmean, n = Inf)

cat("\nLatest top perimeter score 3PA+short-mid harmonic mean, 500+ minutes:\n")
print(top_perimeter_score_3pa_short_mid_hmean, n = Inf)

cat("\nLatest top shrunk residual by 3PA+long-mid, 500+ minutes:\n")
print(top_non_rim_ps_resid_shrunk_3pa_long_mid, n = Inf)

cat("\nLatest candidate SWITCH leaders, 500+ minutes:\n")
print(candidate_switch_leaders, n = Inf)

message("Wrote non-rim defense experiment outputs to: ", out_dir)
