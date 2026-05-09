if (!requireNamespace("shiny", quietly = TRUE)) {
  stop("Package 'shiny' is required. Install it with install.packages('shiny').")
}
if (!requireNamespace("data.table", quietly = TRUE)) {
  stop("Package 'data.table' is required. Install it with install.packages('data.table').")
}

library(shiny)
library(data.table)

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0) y else x
}

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

normalize_join_name <- function(x) {
  x <- anglicize_text(x)
  x <- tolower(trimws(x))
  x <- gsub("&", " and ", x, fixed = TRUE)
  x <- gsub("[^a-z0-9 ]+", " ", x)
  x <- gsub("\\b(jr|sr|ii|iii|iv|v)\\b", " ", x)
  x <- gsub("\\s+", " ", x)
  trimws(x)
}

resolve_base_dir <- function() {
  wd <- normalizePath(getwd(), winslash = "/", mustWork = FALSE)
  candidates <- unique(c(
    wd,
    file.path(wd, ".."),
    file.path(wd, "..", ".."),
    Sys.getenv("CLEANNBA_BASE_DIR", "")
  ))

  for (candidate in candidates[nzchar(candidates)]) {
    candidate_norm <- normalizePath(candidate, winslash = "/", mustWork = FALSE)
    if (dir.exists(file.path(candidate_norm, "script")) &&
        dir.exists(file.path(candidate_norm, "processed")) &&
        dir.exists(file.path(candidate_norm, "ref"))) {
      return(candidate_norm)
    }
  }

  stop("Could not resolve project root from working directory: ", getwd())
}

resolve_paths <- function(base_dir) {
  list(
    base_dir = base_dir,
    draftballr_fp = file.path(base_dir, "processed", "draft", "draftballr.csv"),
    base_scv_fp = file.path(base_dir, "ref", "scvardraft.csv"),
    override_fp = file.path(base_dir, "ref", "scvardraft_overrides.csv")
  )
}

load_scv_entries <- function(path, source_label) {
  if (!file.exists(path)) {
    return(data.table(
      join_player = character(),
      player_name = character(),
      scv = numeric(),
      notes = character(),
      source_label = character()
    ))
  }

  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!"name" %in% names(dt)) {
    return(data.table(
      join_player = character(),
      player_name = character(),
      scv = numeric(),
      notes = character(),
      source_label = character()
    ))
  }

  score_col <- names(dt)[tolower(names(dt)) %in% c("sc", "scv", "shot_creation", "shot_creation_rank")][1]
  if (is.na(score_col) || !nzchar(score_col)) {
    return(data.table(
      join_player = character(),
      player_name = character(),
      scv = numeric(),
      notes = character(),
      source_label = character()
    ))
  }

  notes_col <- names(dt)[tolower(names(dt)) == "notes"][1]
  if (is.na(notes_col) || !nzchar(notes_col)) {
    dt[, notes := ""]
  } else {
    dt[, notes := as.character(get(notes_col))]
  }

  dt[, player_name := as.character(name)]
  dt[, join_player := normalize_join_name(player_name)]
  dt[, scv := suppressWarnings(as.numeric(get(score_col)))]
  dt[, source_label := source_label]
  dt <- dt[nzchar(join_player)]
  setorder(dt, join_player)
  unique(dt[, .(join_player, player_name, scv, notes, source_label)], by = "join_player")
}

load_draft_context <- function(path) {
  if (!file.exists(path)) {
    return(list(
      players = data.table(
        join_player = character(),
        draft_player = character(),
        latest_draft_year = integer(),
        prediction_pool = character(),
        big_board_rank = numeric(),
        is_current_class = logical()
      ),
      current_year = NA_integer_
    ))
  }

  dt <- fread(path, na.strings = c("", "NA", "N/A", "NaN"))
  if (!nrow(dt) || !"player" %in% names(dt) || !"year" %in% names(dt)) {
    return(list(
      players = data.table(
        join_player = character(),
        draft_player = character(),
        latest_draft_year = integer(),
        prediction_pool = character(),
        big_board_rank = numeric(),
        is_current_class = logical()
      ),
      current_year = NA_integer_
    ))
  }

  dt[, draft_player := as.character(player)]
  dt[, join_player := normalize_join_name(draft_player)]
  dt[, latest_draft_year := suppressWarnings(as.integer(year))]
  dt[, big_board_rank := suppressWarnings(as.numeric(big_board_rank))]
  dt[, prediction_pool := fifelse(is.na(cbbd_id), "international", "domestic")]
  dt <- dt[nzchar(join_player) & is.finite(latest_draft_year)]

  if (!nrow(dt)) {
    return(list(
      players = data.table(
        join_player = character(),
        draft_player = character(),
        latest_draft_year = integer(),
        prediction_pool = character(),
        big_board_rank = numeric(),
        is_current_class = logical()
      ),
      current_year = NA_integer_
    ))
  }

  current_year <- max(dt$latest_draft_year, na.rm = TRUE)
  setorder(dt, join_player, -latest_draft_year, big_board_rank, draft_player)
  player_dt <- unique(dt[, .(
    join_player,
    draft_player,
    latest_draft_year,
    prediction_pool,
    big_board_rank
  )], by = "join_player")
  player_dt[, is_current_class := latest_draft_year == current_year]

  list(players = player_dt, current_year = current_year)
}

build_editor_table <- function(paths) {
  base_dt <- load_scv_entries(paths$base_scv_fp, "base")
  override_dt <- load_scv_entries(paths$override_fp, "override")
  draft_info <- load_draft_context(paths$draftballr_fp)
  draft_dt <- draft_info$players

  all_keys <- data.table(join_player = unique(c(
    base_dt$join_player,
    override_dt$join_player,
    draft_dt$join_player
  )))

  editor_dt <- merge(all_keys, draft_dt, by = "join_player", all.x = TRUE, sort = FALSE)
  editor_dt <- merge(
    editor_dt,
    base_dt[, .(join_player, base_name = player_name, base_scv = scv)],
    by = "join_player",
    all.x = TRUE,
    sort = FALSE
  )
  editor_dt <- merge(
    editor_dt,
    override_dt[, .(join_player, override_name = player_name, override_scv = scv, override_notes = notes)],
    by = "join_player",
    all.x = TRUE,
    sort = FALSE
  )

  editor_dt[, player_name := fcoalesce(override_name, draft_player, base_name, join_player)]
  editor_dt[, current_scv := fcoalesce(override_scv, base_scv)]
  editor_dt[, source := fifelse(!is.na(override_scv), "override", fifelse(!is.na(base_scv), "base", "missing"))]
  editor_dt[, has_current_scv := !is.na(current_scv)]
  editor_dt[, prediction_pool := fcoalesce(prediction_pool, "unknown")]
  editor_dt[, override_notes := fcoalesce(override_notes, "")]
  editor_dt[, is_override := source == "override"]
  editor_dt[, scv_sort := fifelse(is.na(current_scv), Inf, current_scv)]
  setorder(editor_dt, -is_current_class, scv_sort, big_board_rank, player_name)

  list(
    editor_dt = editor_dt[, .(
      join_player,
      player_name,
      current_scv,
      source,
      base_scv,
      override_scv,
      latest_draft_year,
      prediction_pool,
      big_board_rank,
      is_current_class,
      has_current_scv,
      override_notes
    )],
    current_year = draft_info$current_year
  )
}

persist_overrides <- function(editor_dt, path) {
  override_dt <- copy(editor_dt[!is.na(override_scv)])
  if (!nrow(override_dt)) {
    fwrite(data.table(name = character(), sc = numeric(), notes = character()), path, na = "")
    return(invisible(NULL))
  }

  save_dt <- override_dt[, .(
    name = player_name,
    sc = override_scv,
    notes = override_notes
  )]
  setorder(save_dt, name)
  fwrite(save_dt, path, na = "")
}

build_scv_editor_app <- function() {
  ui <- fluidPage(
    titlePanel("Draft SCV Editor"),
    fluidRow(
      column(
        width = 3,
        h4("View"),
        radioButtons(
          "scope",
          label = NULL,
          choices = c(
            "Current class" = "current",
            "All players" = "all",
            "Overrides only" = "overrides",
            "Current class missing SCV" = "missing_current"
          ),
          selected = "current"
        ),
        selectInput(
          "pool_filter",
          "Pool",
          choices = c("All" = "all", "Domestic" = "domestic", "International" = "international", "Unknown" = "unknown"),
          selected = "all",
          selectize = FALSE
        ),
        textInput("search_name", "Name search", value = ""),
        checkboxInput("show_only_values", "Only rows with a current SCV", value = FALSE),
        hr(),
        h4("Selected Player"),
        uiOutput("selected_player_info"),
        numericInput("edit_scv", "SCV value", value = 3, min = 0, max = 10, step = 1),
        textInput("edit_notes", "Notes", value = ""),
        fluidRow(
          column(width = 6, actionButton("save_override", "Save Change", class = "btn-primary")),
          column(width = 6, actionButton("clear_override", "Clear Override"))
        ),
        br(),
        actionButton("reload_data", "Reload From Disk"),
        hr(),
        p("This editor writes to ref/scvardraft_overrides.csv. Your training and output flows already read that file.")
      ),
      column(
        width = 9,
        uiOutput("summary_text"),
        dataTableOutput("scv_table"),
        hr(),
        h4("Saved Overrides"),
        tableOutput("override_preview"),
        hr(),
        verbatimTextOutput("status_text")
      )
    )
  )

  server <- function(input, output, session) {
    base_dir <- resolve_base_dir()
    paths <- resolve_paths(base_dir)
    editor_state <- reactiveVal(build_editor_table(paths))
    status_text <- reactiveVal(sprintf("Loaded SCV editor from %s", base_dir))

    filtered_dt <- reactive({
      editor_dt <- copy(editor_state()$editor_dt)

      if (identical(input$scope, "current")) {
        editor_dt <- editor_dt[is_current_class %in% TRUE]
      } else if (identical(input$scope, "overrides")) {
        editor_dt <- editor_dt[source == "override"]
      } else if (identical(input$scope, "missing_current")) {
        editor_dt <- editor_dt[is_current_class %in% TRUE & !has_current_scv]
      }

      if (!identical(input$pool_filter, "all")) {
        editor_dt <- editor_dt[prediction_pool == input$pool_filter]
      }

      if (isTRUE(input$show_only_values)) {
        editor_dt <- editor_dt[has_current_scv]
      }

      search_value <- trimws(input$search_name %||% "")
      if (nzchar(search_value)) {
        search_pattern <- tolower(search_value)
        editor_dt <- editor_dt[grepl(search_pattern, tolower(player_name), fixed = TRUE)]
      }

      editor_dt
    })

    selected_row <- reactive({
      row_idx <- input$scv_table_rows_selected
      if (!length(row_idx)) return(NULL)
      view_dt <- filtered_dt()
      if (!nrow(view_dt) || row_idx[[1]] > nrow(view_dt)) return(NULL)
      view_dt[row_idx[[1]]]
    })

    observeEvent(selected_row(), {
      row <- selected_row()
      if (is.null(row) || !nrow(row)) return()

      updateNumericInput(
        session,
        "edit_scv",
        value = if (is.na(row$current_scv[[1]])) 3 else row$current_scv[[1]]
      )
      updateTextInput(session, "edit_notes", value = row$override_notes[[1]] %||% "")
    }, ignoreNULL = FALSE)

    observeEvent(input$reload_data, {
      editor_state(build_editor_table(paths))
      status_text(sprintf("Reloaded from disk at %s", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
    })

    observeEvent(input$save_override, {
      row <- selected_row()
      if (is.null(row) || !nrow(row)) {
        status_text("Select a player before saving a change.")
        return()
      }

      editor_dt <- copy(editor_state()$editor_dt)
      join_key <- row$join_player[[1]]
      new_scv <- suppressWarnings(as.numeric(input$edit_scv))
      if (!is.finite(new_scv)) {
        status_text("SCV must be numeric.")
        return()
      }

      note_value <- trimws(input$edit_notes %||% "")
      base_value <- editor_dt[join_player == join_key, base_scv][[1]]

      if (is.finite(base_value) && identical(as.numeric(new_scv), as.numeric(base_value)) && !nzchar(note_value)) {
        editor_dt[join_player == join_key, `:=`(override_scv = NA_real_, override_notes = "")]
        status_text(sprintf("Removed override for %s because it matches the base value.", row$player_name[[1]]))
      } else {
        editor_dt[join_player == join_key, `:=`(override_scv = new_scv, override_notes = note_value)]
        status_text(sprintf("Saved SCV %.2f for %s.", new_scv, row$player_name[[1]]))
      }

      persist_overrides(editor_dt, paths$override_fp)
      editor_state(build_editor_table(paths))
    })

    observeEvent(input$clear_override, {
      row <- selected_row()
      if (is.null(row) || !nrow(row)) {
        status_text("Select a player before clearing an override.")
        return()
      }

      editor_dt <- copy(editor_state()$editor_dt)
      join_key <- row$join_player[[1]]
      editor_dt[join_player == join_key, `:=`(override_scv = NA_real_, override_notes = "")]
      persist_overrides(editor_dt, paths$override_fp)
      editor_state(build_editor_table(paths))
      status_text(sprintf("Cleared override for %s.", row$player_name[[1]]))
    })

    output$summary_text <- renderUI({
      current_year <- editor_state()$current_year
      dt <- filtered_dt()
      total_count <- nrow(dt)
      missing_count <- sum(!dt$has_current_scv, na.rm = TRUE)

      if (is.finite(current_year)) {
        tags$p(
          sprintf("Showing %s row(s). %s without a current SCV. Current draft class: %s.",
                  total_count, missing_count, current_year)
        )
      } else {
        tags$p(sprintf("Showing %s row(s). %s without a current SCV.", total_count, missing_count))
      }
    })

    output$selected_player_info <- renderUI({
      row <- selected_row()
      if (is.null(row) || !nrow(row)) {
        return(tags$p("Select a row in the table to edit it."))
      }

      tags$div(
        tags$strong(row$player_name[[1]]),
        tags$br(),
        sprintf("Current: %s", if (is.na(row$current_scv[[1]])) "missing" else row$current_scv[[1]]),
        tags$br(),
        sprintf("Base: %s", if (is.na(row$base_scv[[1]])) "missing" else row$base_scv[[1]]),
        tags$br(),
        sprintf("Override: %s", if (is.na(row$override_scv[[1]])) "none" else row$override_scv[[1]]),
        tags$br(),
        sprintf("Source: %s", row$source[[1]]),
        tags$br(),
        sprintf("Draft year: %s", if (is.na(row$latest_draft_year[[1]])) "n/a" else row$latest_draft_year[[1]]),
        tags$br(),
        sprintf("Pool: %s", row$prediction_pool[[1]])
      )
    })

    output$scv_table <- renderDataTable({
      view_dt <- copy(filtered_dt())
      view_dt[, current_class := fifelse(is_current_class, "yes", "")]
      view_dt[, current_scv := ifelse(is.na(current_scv), NA, current_scv)]
      view_dt[, base_scv := ifelse(is.na(base_scv), NA, base_scv)]
      view_dt[, override_scv := ifelse(is.na(override_scv), NA, override_scv)]

      view_dt[, .(
        player = player_name,
        current_scv,
        source,
        base_scv,
        override_scv,
        draft_year = latest_draft_year,
        pool = prediction_pool,
        big_board = big_board_rank,
        current_class
      )]
    },
    filter = "top",
    selection = "single",
    rownames = FALSE,
    options = list(pageLength = 25, scrollX = TRUE, autoWidth = TRUE))

    output$override_preview <- renderTable({
      dt <- copy(editor_state()$editor_dt[source == "override"])
      if (!nrow(dt)) {
        return(data.frame(Message = "No overrides saved yet.", check.names = FALSE))
      }

      dt[, .(player = player_name, override_scv, notes = override_notes)]
    }, rownames = FALSE)

    output$status_text <- renderText({
      status_text()
    })
  }

  shinyApp(ui = ui, server = server)
}
