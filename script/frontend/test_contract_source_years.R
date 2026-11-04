# Verify salary years when a cached source is overlaid on a newer export.
expressions <- parse("script/frontend/export_frontend_data.R")
env <- new.env(parent = globalenv())
wanted <- c("spotrac_contract_path", "normalize_spotrac_contract_status", "read_spotrac_contracts")
for (expr in expressions) {
  if (is.call(expr) && identical(expr[[1]], as.name("<-")) && as.character(expr[[2]]) %in% wanted) eval(expr, env)
}
root <- tempfile("contract-year-"); dir.create(file.path(root, "processed/livedata/impactrefresh"), recursive = TRUE)
row <- data.frame(nba_id = 1, player_name = "Test", team = "UTA", salary_y0 = 100, salary_y1 = 110, salary_y2 = 120,
                  contract_status_y0 = "Signed", contract_status_y1 = "Signed", contract_status_y2 = "Team Option")
write.csv(row, file.path(root, "processed/livedata/impactrefresh/contracts_2026_spotrac.csv"), row.names = FALSE)
same <- env$read_spotrac_contracts(root, 2026)
next_year <- env$read_spotrac_contracts(root, 2027)
stopifnot(same$salary_y0 == 100, next_year$salary_y0 == 110, next_year$salary_y1 == 120,
          next_year$contract_status_y1 == "Team Option", is.na(next_year$salary_y2), next_year$source_contract_year == 2027)
write.csv(data.frame(), file.path(root, "processed/livedata/impactrefresh/contracts_2026_spotrac.csv"), row.names = FALSE)
stopifnot(nrow(env$read_spotrac_contracts(root, 2027)) == 0L)
unlink(root, recursive = TRUE)
cat("Cached contract salary horizons remain on the correct NBA season.\n")
