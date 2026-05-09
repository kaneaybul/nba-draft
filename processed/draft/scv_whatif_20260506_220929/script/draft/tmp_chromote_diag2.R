options(repos = c(CRAN = "https://cloud.r-project.org"))
library(chromote)
set_chrome_args(c(default_chrome_args(), "--disable-blink-features=AutomationControlled", "--lang=en-US,en", "--window-size=1400,1000"))
b <- Chromote$new()
s <- b$new_session(wait_ = TRUE)
cat("session_created\n")
tryCatch({
  s$Page$enable()
  s$Network$enable()
  cat("page_network_enabled\n")
}, error = function(e) {
  cat("enable_error:", conditionMessage(e), "\n")
})
tryCatch({
  s$Page$addScriptToEvaluateOnNewDocument(source = paste(
    "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});",
    "Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});",
    "Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});"
  ))
  cat("script_injected\n")
}, error = function(e) {
  cat("script_error:", conditionMessage(e), "\n")
})
tryCatch({
  s$Network$setUserAgentOverride(
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    acceptLanguage = "en-US,en;q=0.9",
    platform = "Windows"
  )
  cat("ua_set\n")
}, error = function(e) {
  cat("ua_error:", conditionMessage(e), "\n")
})
try(s$close(), silent = TRUE)
try(b$close(), silent = TRUE)
