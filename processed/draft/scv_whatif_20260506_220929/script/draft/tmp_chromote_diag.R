options(repos = c(CRAN = "https://cloud.r-project.org"))
library(chromote)
print(chromote_info())
set_chrome_args(c(default_chrome_args(), "--disable-blink-features=AutomationControlled", "--lang=en-US,en", "--window-size=1400,1000"))
b <- Chromote$new()
cat("browser_created\n")
s <- b$new_session(wait_ = TRUE)
cat("session_created\n")
print(s)
tryCatch({
  s$Page$enable()
  cat("page_enabled\n")
}, error = function(e) {
  cat("page_enable_error:", conditionMessage(e), "\n")
})
tryCatch({
  s$Page$addScriptToEvaluateOnNewDocument(source = "console.log(1);")
  cat("script_injected\n")
}, error = function(e) {
  cat("script_inject_error:", conditionMessage(e), "\n")
})
try(s$close(), silent = TRUE)
try(b$close(), silent = TRUE)
