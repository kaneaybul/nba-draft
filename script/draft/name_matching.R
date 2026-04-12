anglicize_text <- function(x) {
  raw_x <- as.character(x)
  safe_x <- suppressWarnings(iconv(raw_x, from = "UTF-8", to = "UTF-8", sub = ""))
  fill_idx <- is.na(safe_x) & !is.na(raw_x)
  safe_x[fill_idx] <- raw_x[fill_idx]
  converted <- suppressWarnings(iconv(safe_x, from = "", to = "ASCII//TRANSLIT", sub = ""))
  fill_idx <- is.na(converted) & !is.na(safe_x)
  converted[fill_idx] <- safe_x[fill_idx]
  trimws(converted)
}

collapse_initial_tokens <- function(tokens) {
  out <- character()
  buffer <- character()

  flush_buffer <- function() {
    if (!length(buffer)) return(character())
    if (length(buffer) > 1L) paste0(buffer, collapse = "") else buffer
  }

  for (token in tokens) {
    if (grepl("^[a-z]$", token)) {
      buffer <- c(buffer, token)
    } else {
      out <- c(out, flush_buffer(), token)
      buffer <- character()
    }
  }
  c(out, flush_buffer())
}

normalize_player_name_core <- function(x) {
  x <- anglicize_text(x)
  x <- gsub("[?]+", "z", x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("['`\u2018\u2019\u00b4]", "", x, perl = TRUE)
  x <- gsub(".", "", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\s+", " ", x)
  x <- trimws(x)

  vapply(strsplit(x, " ", fixed = TRUE), function(tokens) {
    tokens <- tokens[nzchar(tokens)]
    if (!length(tokens)) return("")
    tokens <- collapse_initial_tokens(tokens)
    while (length(tokens) > 1L && tail(tokens, 1L) %in% c("jr", "sr", "ii", "iii", "iv", "v")) {
      tokens <- head(tokens, -1L)
    }
    paste(tokens, collapse = " ")
  }, character(1), USE.NAMES = FALSE)
}

resolve_name_alias_path <- function(base_dir = NULL) {
  candidates <- c(
    if (!is.null(base_dir) && nzchar(base_dir)) file.path(base_dir, "ref", "player_name_aliases.csv") else NULL,
    file.path(getwd(), "ref", "player_name_aliases.csv"),
    file.path(getwd(), "..", "ref", "player_name_aliases.csv"),
    file.path(getwd(), "..", "..", "ref", "player_name_aliases.csv")
  )
  candidates <- unique(normalizePath(candidates, winslash = "/", mustWork = FALSE))
  candidates[file.exists(candidates)][1]
}

load_player_name_aliases <- function(base_dir = NULL) {
  alias_path <- resolve_name_alias_path(base_dir)
  if (is.na(alias_path) || !nzchar(alias_path) || !file.exists(alias_path)) {
    return(setNames(character(), character()))
  }

  alias_dt <- tryCatch(
    data.table::fread(alias_path, na.strings = c("", "NA", "N/A", "NaN")),
    error = function(e) data.table::data.table()
  )
  if (!nrow(alias_dt) || !all(c("alias", "canonical") %in% names(alias_dt))) {
    return(setNames(character(), character()))
  }

  alias_keys <- normalize_player_name_core(alias_dt[["alias"]])
  canonical_keys <- normalize_player_name_core(alias_dt[["canonical"]])
  keep_idx <- nzchar(alias_keys) & nzchar(canonical_keys)
  stats::setNames(canonical_keys[keep_idx], alias_keys[keep_idx])
}

get_player_name_aliases <- function(base_dir = NULL, refresh = FALSE) {
  cache_name <- ".draft_player_name_aliases"
  if (refresh || !exists(cache_name, envir = .GlobalEnv, inherits = FALSE)) {
    assign(cache_name, load_player_name_aliases(base_dir), envir = .GlobalEnv)
  }
  get(cache_name, envir = .GlobalEnv, inherits = FALSE)
}

normalize_player_name <- function(x, aliases = NULL) {
  keys <- normalize_player_name_core(x)
  if (is.null(aliases)) aliases <- get_player_name_aliases()
  mapped <- aliases[keys]
  keys[!is.na(mapped) & nzchar(mapped)] <- unname(mapped[!is.na(mapped) & nzchar(mapped)])
  keys
}

normalize_join_name <- normalize_player_name
normalize_name <- normalize_player_name
