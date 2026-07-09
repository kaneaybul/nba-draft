get_script_dir <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- "--file="
  script_arg <- cmd_args[grepl(file_arg, cmd_args)]
  if (length(script_arg) > 0) {
    return(dirname(normalizePath(sub(file_arg, "", script_arg[[1]]), winslash = "/", mustWork = FALSE)))
  }
  normalizePath(getwd(), winslash = "/", mustWork = FALSE)
}

resolve_base_dir <- function() {
  script_dir <- get_script_dir()
  candidates <- unique(c(getwd(), file.path(script_dir, "..", ".."), file.path(getwd(), ".."), file.path(getwd(), "..", "..")))
  for (candidate in candidates) {
    candidate <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate, "processed")) && dir.exists(file.path(candidate, "script"))) return(candidate)
  }
  stop("Could not resolve project root.")
}

clean_money <- function(x) {
  text <- trimws(gsub(",", "", as.character(x)))
  multiplier <- ifelse(grepl("B$", text, ignore.case = TRUE), 1e9,
    ifelse(grepl("M$", text, ignore.case = TRUE), 1e6,
      ifelse(grepl("K$", text, ignore.case = TRUE), 1e3, 1)
    )
  )
  suppressWarnings(as.numeric(gsub("[^0-9.-]", "", text)) * multiplier)
}

fallback_caps <- function() {
  data.frame(
    year = 2021:2031,
    salary_cap = c(109140000, 112414000, 123655000, 136021000, 140588000, 154647000, 166000000, 174300000, 183015000, 192166000, 201774000),
    tax_level = c(132627000, 136606000, 150267000, 165294000, 170814000, 187895000, NA, NA, NA, NA, NA),
    first_apron = c(138928000, 143002000, 156983000, 172346000, 178132000, 195945000, 210321000, 220847000, 231889000, 243485000, 255659000),
    second_apron = c(NA, NA, NA, 182794000, 188931000, 207824000, 222775000, 233914000, 245610000, 258246000, 271158000),
    source = c(
      rep("historical CBA cap/apron reference", 4),
      "https://pr.nba.com/2024-25-nba-season-salary-cap/",
      "NBA 2025-26 cap/apron announcement; current local fallback",
      "Spotrac 2026-27 projection; apron estimated from current cap/apron ratio",
      "https://www.spotrac.com/nba/cap/_/year/2027/sort/cap_maximum_space",
      "Spotrac projection, 5% cap growth assumption",
      "https://www.spotrac.com/nba/cap/_/year/2029",
      "Spotrac projection, 5% cap growth assumption"
    ),
    stringsAsFactors = FALSE
  )
}

extract_first <- function(text, pattern) {
  hit <- regmatches(text, regexpr(pattern, text, ignore.case = TRUE, perl = TRUE))
  if (length(hit) == 0 || hit == "") return(NA_real_)
  money <- regmatches(hit, gregexpr("\\$[0-9][0-9,]*(?:\\.[0-9]+)?\\s*[KMB]?", hit, ignore.case = TRUE, perl = TRUE))[[1]]
  if (length(money) == 0) return(NA_real_)
  clean_money(money[length(money)])
}

fetch_spotrac_year <- function(year) {
  url <- sprintf("https://www.spotrac.com/nba/cap/_/year/%s", year)
  if (requireNamespace("httr", quietly = TRUE)) {
    response <- httr::GET(url, httr::user_agent("Mozilla/5.0"))
    if (httr::status_code(response) >= 400) stop("HTTP ", httr::status_code(response), " from ", url)
    html <- httr::content(response, as = "text", encoding = "UTF-8")
  } else {
    html <- paste(readLines(url, warn = FALSE), collapse = "\n")
  }
  data.frame(
    year = year + 1,
    salary_cap = extract_first(html, "Maximum:\\s*\\$[0-9][0-9,]*(?:\\.[0-9]+)?\\s*[KMB]?"),
    first_apron = extract_first(html, "OVER THE FIRST APRON[\\s\\S]{0,700}?Threshold:\\s*\\$[0-9][0-9,]*(?:\\.[0-9]+)?\\s*[KMB]?"),
    second_apron = extract_first(html, "OVER THE SECOND APRON[\\s\\S]{0,700}?Threshold:\\s*\\$[0-9][0-9,]*(?:\\.[0-9]+)?\\s*[KMB]?"),
    source = url,
    stringsAsFactors = FALSE
  )
}

base_dir <- resolve_base_dir()
out_path <- file.path(base_dir, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv")
dir.create(dirname(out_path), recursive = TRUE, showWarnings = FALSE)

caps <- fallback_caps()
pulled <- tryCatch(
  do.call(rbind, lapply(2026:2030, fetch_spotrac_year)),
  error = function(e) {
    warning("Could not refresh Spotrac cap projections; using fallback assumptions. Error: ", conditionMessage(e))
    NULL
  }
)

if (!is.null(pulled)) {
  for (i in seq_len(nrow(pulled))) {
    idx <- caps$year == pulled$year[i]
    for (col in c("salary_cap", "first_apron", "second_apron")) {
      if (isTRUE(is.finite(pulled[[col]][i]))) caps[[col]][idx] <- pulled[[col]][i]
    }
    caps$source[idx] <- pulled$source[i]
  }
}

caps$scale_cap <- ifelse(is.finite(caps$first_apron), caps$first_apron, caps$salary_cap)
write.csv(caps, out_path, row.names = FALSE, na = "")
message("Salary cap assumptions written: ", out_path)
message("Rows: ", nrow(caps))
