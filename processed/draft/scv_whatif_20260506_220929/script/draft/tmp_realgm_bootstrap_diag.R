library(data.table)
library(jsonlite)
library(chromote)
configure_realgm_session <- function(session) {
  session$Page$addScriptToEvaluateOnNewDocument(source = paste(
    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});",
    "Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});",
    "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"
  ))

  session$Network$setUserAgentOverride(
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    acceptLanguage = "en-US,en;q=0.9",
    platform = "Windows"
  )

  invisible(session)
}
open_realgm_session <- function(attempts = 3L) {
  browser <- Chromote$new()
  last_error <- NULL

  for (attempt in seq_len(attempts)) {
    session <- tryCatch(
      browser$new_session(wait_ = TRUE),
      error = function(e) {
        last_error <<- conditionMessage(e)
        NULL
      }
    )

    if (is.null(session)) {
      Sys.sleep(attempt)
      next
    }

    is_active <- tryCatch({
      session$Page$enable()
      session$Network$enable()
      TRUE
    }, error = function(e) {
      last_error <<- conditionMessage(e)
      FALSE
    })

    if (is_active) {
      return(list(browser = browser, session = session))
    }

    try(session$close(), silent = TRUE)
    Sys.sleep(attempt)
  }

  try(browser$close(), silent = TRUE)
  stop("Could not open an active Chromote session for RealGM. Last error: ", last_error)
}
set_chrome_args(c(
  default_chrome_args(),
  "--disable-blink-features=AutomationControlled",
  "--lang=en-US,en",
  "--window-size=1400,1000"
))
bs <- open_realgm_session()
cat('opened\n')
browser <- bs$browser
session <- bs$session
print(session)
configure_realgm_session(session)
cat('configured\n')
try(session$close(), silent = TRUE)
try(browser$close(), silent = TRUE)
