# Dunc'd On Cap Dataset Pilot

Standalone visual scrape from the open Dunc'd On Cap Sheet workbook.

## Current Coverage

- Screenshot audit teams: all 30 NBA teams
- Normalized teams: ATL, UTA
- Method: Chrome visual scrape from Excel Online, no workbook download/copy/API extraction.

## Files

- `contracts.csv`: player/team/year salary, likely, hold, option, and guarantee rows.
- `team_cap_summary.csv`: team/year cap, tax, apron, salary-floor, roster-charge, and roster-count summary rows.
- `dead_salary.csv`: dead money / waived / buyout rows.
- `draft_picks.csv`: visible pick and protection text.
- `exceptions.csv`: visible MLE/TPE/exception rows.
- `holds_options_guarantees.csv`: extracted hold, option, guarantee, and likely-outcome markers.
- `scrape_audit.csv`: scrape metadata and screenshot references.
- `screenshots/`: visual evidence used for extraction.
- `ocr/`: Windows OCR text and word-position output for every screenshot.
- `ocr_grid_cells.csv`: OCR word boxes collapsed into spreadsheet-like rows/columns for all teams.
- `raw_contract_rows.csv`: all-team OCR-derived contract/player rows.
- `raw_summary_rows.csv`: all-team OCR-derived team-summary/cap rows.
- `raw_picks_dead_rows.csv`: all-team OCR-derived draft-pick and dead-salary rows.
- `raw_header_exception_rows.csv`: all-team OCR-derived header, cap-room, exception, and TPE rows.

## Notes

This is a proof-of-usefulness dataset, not a production integration. Values marked `medium` or `low` confidence should be reviewed against the screenshot before use. Every team now has top/mid/summary screenshots in `screenshots/` and all-team OCR-derived raw section tables. ATL and UTA have also been hand-normalized into the canonical row-level CSVs. The remaining promotion step is to clean/verify the OCR-derived raw rows into the canonical CSV schemas.
