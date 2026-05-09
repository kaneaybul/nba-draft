library(readr)
library(dplyr)
library(purrr)

resolve_base_dir <- function() {
  candidates <- c(
    getwd(),
    file.path(getwd(), ".."),
    file.path(getwd(), "..", "..")
  )

  for (candidate in candidates) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

add_alias_columns <- function(df) {
  alias_pairs <- c(
    "X3PA_100" = "3PA_100",
    "X3P_PERC" = "3P_PERC",
    "X3PA"     = "3PA",
    "X3P"      = "3P"
  )

  for (target_name in names(alias_pairs)) {
    source_name <- alias_pairs[[target_name]]
    if (!(target_name %in% names(df)) && source_name %in% names(df)) {
      df[[target_name]] <- df[[source_name]]
    }
  }

  df
}

extract_model_terms <- function(skillmap, model_flag) {
  skills <- setdiff(names(skillmap), "VAR")

  term_rows <- skillmap %>%
    filter(grepl("^Term[0-9]+$", VAR)) %>%
    mutate(term_order = as.integer(sub("^Term", "", VAR))) %>%
    arrange(term_order)
  flag_row  <- skillmap %>% filter(VAR == model_flag)

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

score_variant <- function(skillmap, def_hist, label) {
  def_terms <- extract_model_terms(skillmap, "Defense?")
  def_terms <- def_terms[!is.na(def_terms) & nzchar(def_terms)]
  safe_terms <- vapply(def_terms, function(term) {
    if (grepl("[`()]", term)) {
      term
    } else if (grepl("^[A-Za-z.][A-Za-z0-9._]*$", term)) {
      term
    } else {
      paste0("`", term, "`")
    }
  }, character(1))

  fit <- lm(as.formula(paste("def_dep ~", paste(safe_terms, collapse = " + "))), data = def_hist)

  tibble(
    variant = label,
    r2 = summary(fit)$r.squared,
    adj_r2 = summary(fit)$adj.r.squared,
    sigma = summary(fit)$sigma,
    aic = AIC(fit),
    rimpro_terms = paste(
      skillmap %>%
        filter(grepl("^Term[0-9]+$", VAR)) %>%
        mutate(term_order = as.integer(sub("^Term", "", VAR))) %>%
        arrange(term_order) %>%
        pull(RIMPRO) %>%
        discard(~ is.na(.x) || .x == ""),
      collapse = " | "
    )
  )
}

base_dir <- resolve_base_dir()
def_hist <- read_csv(file.path(base_dir, "processed", "livedata", "impactrefresh", "defdata.csv"), show_col_types = FALSE) %>%
  add_alias_columns()
impact_hist <- read_csv(file.path(base_dir, "processed", "livedata", "impactrefresh", "impactoutput.csv"), show_col_types = FALSE)
if (!"def_dep" %in% names(def_hist)) {
  def_hist <- def_hist %>%
    left_join(
      impact_hist %>% select(nba_id, year, def_dep),
      by = c("nba_id", "year")
    )
}
def_hist <- def_hist %>% filter(!is.na(def_dep))
skillmap <- read_csv(file.path(base_dir, "ref", "skillmap.csv"), show_col_types = FALSE)

variants <- list(
  current = skillmap,
  split_no_interaction = {
    sm <- skillmap
    sm[sm$VAR == "Term4", "RIMPRO"] <- ""
    sm
  },
  old_rim_points_saved = {
    sm <- skillmap
    sm[sm$VAR == "Term2", "RIMPRO"] <- "rim_points_saved_100"
    sm[sm$VAR == "Term3", "RIMPRO"] <- ""
    sm[sm$VAR == "Term4", "RIMPRO"] <- ""
    sm
  }
)

results <- imap_dfr(variants, ~ score_variant(.x, def_hist, .y)) %>%
  arrange(desc(adj_r2), sigma)

print(results)

write_csv(results, file.path(base_dir, "processed", "draft", "rimpro_nba_term_experiment.csv"))
