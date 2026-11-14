# League player-history adapter

`league_player_values.py` runs the existing reviewed engine on a team's dated
ownership inventory. It reads a canonical reconstruction package and writes
only under the requested output directory. The canonical files are unchanged.

Example:

```
python3 script/asset_history/backfill/league_player_values.py \
  --canonical /path/to/Utah_Monthly_Asset_Reconstruction \
  --skill-dir /path/to/league_backfill/monthly_reconstruction/skill \
  --agreements /path/to/league_backfill/contracts/contract_agreements.json \
  --team BOS --output /path/to/league_backfill/player_values
```

Use `--through 2021-12-31` for a one-snapshot smoke run. Optional `--injuries`
accepts canonical `records` or a list of records. Generic-team uncertain
absences cannot be cleared by cumulative season games that could precede the
injury; only an explicit dated observed return establishes a return.

The adapter preserves trained development, original draft-prior weights,
90-day replacement/position calibration, fixed-anchor minutes smoothing,
team-specific regular-season exposure, expected unsigned continuation, and
`peak4(production) + all annual 0.8 * (production - cost) adjustments`.

`league_player_coverage.json` is authoritative for readiness. Incomplete
contracts or unpriced active player paths cannot produce publishable totals.
Unavailable current SKILL observations retain the established dated prior or
paired-provider fallback, with missing observations exported separately.
The injury gate reviews the source-backed major-absence corpus and current
captured app outlooks; it does not assert an exhaustive historical clinical
archive. Unannounced future maximum-contract bases remain explicitly unpriced
until their as-of terms are resolved. Historical salaries must not use future
cap realizations. Player inventory still needs the dated joint pick EV join.

The legacy Utah replay preserves its original inventory for regression checks.
`--uniform-contracts` selects the league v2 reconstruction: every team uses the
same dated original contract sources and corrected physical ownership identities.
Verified camp/two-way release options limit an annual liability to the known
cash guarantee; exercising the option contributes zero player production.
Other diagnostic table guarantees are not treated as original as-of terms.

`annual_quote_adapter.py` is the portable math/source boundary for eventual
live updates. It requires final canonical annual production and adjusted-asset
paths, not the app's trade values. The app's `projection_value_y1` means the next
season, and `projection_cap_y1` is the Scale payroll budget, not the salary-cap
normalization denominator. A naive substitution changes the valuation model.
A complete daily producer still needs the current canonical player paths,
dated ownership/contracts, source-aligned current SKILL and paired providers,
and saved role/calibration state. No schedule is activated by these modules.

## Portable daily path

`build_runtime_bundle.py` packages the engine and its seed inputs without the
bulk game-matchup/HTML/PDF corpus. The deterministic league archive is about 33 MB;
its JSON companion and internal SHA256 manifest identify exact source inputs.

The repository transports the unchanged archive as ordered 1 MiB binary parts
under `processed/asset_history/runtime_seed/`. The daily loader verifies each
part and the whole archive before extraction when a local full ZIP is absent.

Unpack it into a writable runtime directory, then:

```
python3 script/asset_history/backfill/extend_daily_inputs.py \
  --runtime /tmp/asset-runtime --repo . --as-of 2026-10-26
python3 script/asset_history/backfill/league_player_values.py \
  --canonical /tmp/asset-runtime \
  --skill-dir /tmp/asset-runtime/monthly_reconstruction/skill \
  --agreements /path/to/reviewed/contract_agreements.json \
  --contract-adjustments /path/to/reviewed/contract_adjustments.json \
  --injuries /path/to/major_injury_additions.json \
  --team BOS --state-dir processed/asset_history/player_state \
  --calibration-cache /tmp/calibration-2026-10-26.json \
  --output /tmp/asset-player-output
```

The as-of day must match the actual current-roster capture. It cannot be an
earlier historical day. Performance can lag that observation date and source
lags are exported. The source extender reads real current provider components,
raw SKILL observations, roster membership and completed results. It recomputes
the canonical SKILL blend and preserves its component-prior rules. Current
frontend player data supply metadata only; frontend trade values and future
calendar-year value columns do not feed the asset quote.

`--state-dir` persists the fixed-anchor role state and 90-day calibration state.
The first pass seeds them by replaying history; later runs process only new
observations. Model source changes require an explicit version/reseed. Cache
names should contain the current observation date; one common calibration can
then serve all 30 teams after the first team computes it. State is internal
model state, not proof that a snapshot passed ownership/pick publication gates.

Current intraday game opportunities are derived from observed completed games.
Tonight's unplayed games remain in the forward window and do not update role
evidence. Historical schedules use full NBA team game logs. The archived app
schedule files cover Utah only and are never reused as other teams' full
schedules. Current full schedules include exactly 80 scheduled games plus two
team-specific Cup placeholders, until those slots resolve.

An optional `--injury-review` JSON file can mark targeted material-outlook
reviews without asserting an exhaustive clinical archive. Its schema is
`{"rows":[{"team":"BOS","date":"2026-10-26","reviewed":true,
"sources":["https://..."],"note":"...","known_gaps":[]}]}`. Only explicit
source-backed team/date reviews supplement the global major-absence corpus.
Known gaps remain exported.

Verified checkpoint: the adapter replays all 59 Utah dates and 1,224 player
quotes within $0.00000024 of the original calculation. A portable runtime
initialized successfully. Actual October 26 live sources generated 60 dated
panels, 521 paired-provider players and 399 raw current SKILL observations.
Boston has 82 schedule opportunities in every 2022–27 season; on October 26,
2 completed plus 80 forward games include tonight's unplayed game.

The v2 expansion passes all 30 teams across 60 observation dates: 32,533 finite
active-player quotes, exactly four season-equivalents per quote, complete player
coverage gates and zero cross-team identity collisions. Source audits are in
`processed/asset_history/audits`. The outer app publisher joins the separate
legal pick ledger and preserves monthly observations.

Seven newly drafted assets without matched NBA IDs reconcile exactly to the
trained expected value of their actual selected slots at draft conversion.
`draft_identity.py` keeps actual dated selections in the runtime register and
preserves the verified original draft years of older foreign rights.

Run the production player stage with:

```
python3 script/asset_history/backfill/run_player_refresh.py \
  --repo . --runtime-dir /tmp/asset-runtime --output /tmp/asset-players \
  --state-dir processed/asset_history/player_state --as-of YYYY-MM-DD
```

The output includes `player_candidates.json` and `player_state_staged/`.
Only commit staged state after the outer portfolio publication succeeds. A
compact previous-provider panel and before-day checkpoint let intraday retries
replace today's update instead of applying it twice. Unresolved ownership
directions remain hard gates. Completed annual model inputs need their ordinary
season rollover refresh; stale inputs retain the last good publication.
