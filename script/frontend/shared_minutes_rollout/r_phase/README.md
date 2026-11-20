# Dated shared R forecasts, Player Impact, Lineups and legal Picks
Stage in the **existing** Work run, after certified source handoff and the resolved
ledger, before atomic packaging. No publisher, schedule, provider collection,
native quote generation or historical export is invoked by this adapter.

```sh
python run_next.py /private/date-r-phase.json CONFIG_SHA256 /private/new-r-phase --check
python run_next.py /private/date-r-phase.json CONFIG_SHA256 /private/new-r-phase
```

The Work caller must pin the config from trusted current-run sources. A SHA from an
unreviewed caller is not provenance. It may use `--check` for a read-only admission
check; this scans actual rows and never starts R or Picks. The output folder must
be new. The command makes only private minimal copies; legal Picks updates only
its private forecast-input capture. Do not put the output folder inside served
data. Preserve source and upstream stage receipts independently.

## Config contract

Start with `config.example.json`. Every normal file binding is
`{"path":"/consumer-local/file","sha256":"<trusted exact hash>"}`.
Verify each native input from the approved receipt and rebind paths to this
Work executor; do not change previous receipts' historical absolute paths.

- `ledger_receipt`: successful `nba-shared-daily-resolved-v1` generation receipt.
  Its output `resolved.csv` and its input roster, schedule and official outlook
  hashes equal `ledger`, `roster`, `schedule` and `outlook`.
- `control_r_receipt`: dated `r/receipt.json` from the private source-control
  assembly. `control_impact` is its exact full same-date 2027-style current shard,
  not the preceding day or a current published fallback. Its intrinsic fields
  provide the original ratings, positional shares, contracts and reference
  fields. Only trusted observed minutes/GP survive from the old minute columns;
  every active current and future volume and the affected economics are rebuilt.
  We require exact same roster owner, current actuals, and pending flags with
  the roster producer. Includes active/pending and FA/inactive rows; private
  daily old model output cannot publish after cutover.
- `ownership_receipt`, `signed_book`, `ownership_events`:
  exact dated authoritative ownership/source evidence. The former binds the other
  two and the R control consumed the same signed/pending book.
- `sources`: keys in `SOURCE_FILES` route inspected files to their original
  relative paths under private work. `shared_injury_r` must pin reviewed shared
  source, e.g. included `injury_projections.shared.R`, whose differences from the
  original are only the dated shared-R Team loop and same-ledger healthy reference.
  Do not pass an unpatched base. Re-review exact patch/context if main changes.
  `preseason` is the protected current-season preseason reference, `caps` the
  accepted cap assumptions, `results` the exact collected full league games.
- `history`: historical market-fit impact shards keyed by completed season;
  hashes from protected/approved inputs, consecutive from `first_history_season`
  (2016 for this family) through current season minus one.
- `pick_reference_receipt`: same-date private native legal pick control's
  `picks.proof.json`. `pick_inputs` exact five source JSON files; initial
  `forecast_inputs` must match the proof's **before** SHA. Continuation must
  archive those original bytes, not just the post-simulation snapshot. The
  shared rerun uses its own newly built same-date Team slice with identical legal
  source policy, 10,000 draws and usual trade-review guards. `pick_source`
  includes exact unchanged Python runner, all its imports and reviewed trades
  file paths relative to private repo; root pin from exact checkout.
- `adapter_sha256` pins all six local lane code pieces. Work can obtain reviewed
  file pins from the staging package or replay audit and must compare against
  the target-repo version before use.

## Outputs
`NEW_PRIVATE_OUT/outputs` holds `team_projections.json`, `team_schedules.json`,
`team_lineups.json`, `impact_players_<SEASON>.json`, `picks.json` and original
`picks.proof.json`, and capacity/player-minute witnesses. `receipt.json`
binds every emitted companion plus exact `asof`, `season`, `inputs.ledger`,
config and source-control pins; `production:false`, `release_ready:false`.
Each team's 82 mapped clock, full current+five-year rows, all 30 teams, actual
game results, independent owners and per-game volume checks stay mandatory.
Current non-roster objects retain bytes and order and pending contract salary/
Scale/value above contract remain unpriced. The legal packet is intended for the
same atomic current-index assembler; aggregate and history merges remain other
lanes. No runtime forecast or provider source data is included in this code.

## Intentional holds
- The current producer contract assumes one canonical regular-season game slot
  per team/day with mapped Cup placeholders, 82 slots and no undecided past
  game. No support for future postseason rows, incomplete calendar, unexpected
  schema, future service gap, unresolved transaction identity, wrong-date old
  control or unidentified player capacity. Insufficient healthy volume and the
  reviewed per-team shortfall cap fail closed; this is not a partial publish
  permission.
- The original app has 3 current team scenarios and 10 lineup entries per team;
  row totals 90/900 are schema checks, not holdover current player/game totals.
- Missing future per-minute impact (e.g. some y5 vintages) remains missing even
  if future volume is now known. No new skill ratings or dollar assumptions.
- Nov20 true run was verified with the one-date predecessor of this adapter.
  Local focused checks verify restored exact receipt/output contracts and the
  real Nov20 CSV preflight, not an authenticated new-date build. First new
  date needs the normal Work verification and native same-ledger admission.
