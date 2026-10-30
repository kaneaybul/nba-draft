# Asset history

The explorer covers all 30 NBA teams from 2021-12-31 through 2026-10-26: 59 displayed
monthly observations per team. The 60-date player reconstruction contains 32,533
finite four-season quotes with no duplicate ownership. Pick portfolios use 10,000
joint outcomes per date; all team totals conserve the league portfolio.

## Valuation

`peak4-payroll-0.8-v2` preserves the agreed mathematics: annual production plus
0.8 times production less salary, normalized to a fixed$164,961,000 reporting cap.
Production uses twice the best two season-equivalents; contract adjustments span
exactly four rolling season-equivalents. Completed games determine the fractional
current/final seasons. Tonight’s unplayed games remain in the forward window.
Drafted players use the trained pick prior and evidence weights; an unobserved
new draft conversion reconciles to the pick’s expected value.

Version 2 reconstructs every team using the same dated contract/ownership sources.
The original Utah v1 files are preserved. Historical reconstructions and future
observations recorded at publication have separate vintage labels. Full inventory
includes automatic own-pick horizon additions and hypothetical unsigned service;
it excludes cash, cap room, trade exceptions and dormant overseas service.
Inventory changes are not a causal front-office performance grade.

## Updates

`Refresh asset history` runs after the existing successful daily lineup refresh,
or manually. It collects current player inputs and dated transactions, refreshes
original contracts, updates the shared player model, prices joint pick claims,
and publishes only a complete same-date league portfolio. New uncomplicated
fixed-pick transfers are guarded automatically; new conditional terms require
review rather than being assigned zero. Source failures retain the last validated
view and record a visible update status.

If RealGM rejects the runner, the updater uses the complete, fresh ESPN dated
transaction feed. Unknown identities, complex trades and conditional pick terms
still stop publication for review. Fresh ESPN roster additions are dated to the
capture, and a separate original contract must confirm the destination and a
signing after any prior waiver. A retained run is not a successful data update;
`refresh_status.json` records the underlying error and the last good view stays
visible. Source-code fixes also trigger the asset refresh immediately.

The current month retains its newest validated observation. After the month ends,
that observation is sealed with its actual date and source cutoffs. Missing days
are never invented. Closed financial content cannot be overwritten; substantive
corrections require a versioned reconstruction. Forecast/role state is committed
only after portfolio validation succeeds. Same-day retries restore the prior-day
checkpoint before updating evidence.

Historical injuries use a reviewed major-absence corpus, not an exhaustive
short-term medical archive. Disclosed pick assumptions cover unpublished fallback
or priority details, first-forfeiture interactions, and continuing current lottery
rules beyond the NBA’s announced term. Daily team-strength projections carry a
fixed source calibration to avoid a forecast-provider handoff jump.

Annual model inputs and officially announced draft calendars must remain current.
The updater explicitly stops with the last good snapshot if a completed-season
SKILL/calibration/position refresh or new draft-completion date is unavailable.
It does not silently carry stale annual models into a new season.

## Running

Install `script/asset_history/requirements.txt`, then:

```sh
python3 script/asset_history/materialize.py --repo .
python3 script/asset_history/refresh.py --repo . --work-dir /tmp/asset-history
```

The runtime seed is stored as verified 1 MiB parts to keep transfers bounded. Large
contract and browser-history JSON are committed as gzip sources; materialization
restores ordinary JSON before the daily job and static deployment. No browser
changes or decompression support are required to view the chart.

```sh
python3 -m unittest discover -s script/asset_history -p 'test_*.py'
python3 -m unittest discover -s script/asset_history/backfill -p 'test_*.py'
```
