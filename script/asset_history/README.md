# Asset history

The app explorer reads a lazy-loaded team file, displays one full-inventory line,
marks major moves and exposes player/pick accounting for every dated point.

The model is `peak4-payroll-0.8-v1`. Seasonal asset value is production plus
0.8 times production less salary. Quote production uses the best two
season-equivalents over exactly four rolling season-equivalents; all salary
adjustments over the four years remain additive. Inputs must be normalized to
the same reporting cap. The Python quote selector is shared with the Utah model.

## Snapshot publication

`python3 script/asset_history/publish.py --input <candidate.json> --require-league`

Candidates use the contract enforced by `validate` in `publish.py`. Daily
production requires all 30 teams at one common source cutoff, unique asset
ownership, complete four-season quotes, reviewed source coverage and totals that
reconcile. It does not reuse the app's old trade-value numbers or infer known
contract terms from eventual salary history.

Each month retains its newest provisional point. A candidate dated on the actual
last day of the month is sealed. A subsequent run can re-submit identical closed
content but cannot rewrite it. A missing final-day input is never relabeled as
month end; an older candidate cannot overwrite a newer provisional point.
Corrections or method changes belong in a separate version, preserving v1.

Published-at-the-time snapshots and fixed-model historical reconstructions carry
separate vintage labels. No raw-inventory increase is called causal FO value added.
Unsigned projected service is hypothetical continuation, rather than legal control.

## Current coverage

The checked-in Utah import contains the completed reconstruction through
2026-10-25. Other teams stay `pending_backfill` until their dated inventory passes
validation. A missing team is not assigned zero or ranked against complete teams.
The explorer's download includes exact asset-level inputs and provenance.

The daily publisher must be wired after the league candidate producer is verified;
a scheduled job that merely re-stamps the Utah file is not an update.

Run `python3 -m unittest discover -s script/asset_history -p 'test_*.py'`.
