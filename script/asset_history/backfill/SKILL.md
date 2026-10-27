# Dated league SKILL backfill

`collect_owned_skill.py` expands the audited Utah source cache to league evidence
without modifying the original reconstruction. It requires an isolated copy of
`monthly_reconstruction/skill`, with the neighboring projections, EPM, DARKO and
app-model inputs retained at their original relative paths.

Copy the original validated `monthly_skill_observations.json` to
`baseline_monthly_skill_observations.json` in that isolated directory before the
first rebuild. This preserves already researched whole-NBA performance for Utah
arrivals and avoids losing a verified observation while expanding the universe.

```sh
python3 script/asset_history/backfill/collect_owned_skill.py \
  --skill-dir /path/to/league_backfill/monthly_reconstruction/skill \
  --rosters /path/to/monthly_league_rosters.json \
  --max-new-requests 65 --workers 3 --rebuild
```

Use `--max-new-requests 0` for a completely offline rebuild. `--only-dates` bounds
network work to selected statistical cutoffs. Responses are cached with source
URL, retrieval date and SHA256; subsequent runs reuse those exact observations.

The source's league endpoint caps at 500 players. The collector first retrieves
one league table per distinct statistical cutoff, then asks only for teams with
missing **owned** players. Whole-NBA records for traded players require complete
team-segment minutes, checked with PBP seconds against dated NBA minutes. Rounded
PBP `Minutes` is not a suitable completeness test. Exact league rows take
precedence. Current PBP responses omit GamesPlayed, so the existing dated NBA
player totals supply GP explicitly. No missing games are fabricated as zero.

The FromDate uses the actual season start verified in the cached official NBA
regular-season game log. For example October19,2021 is equivalent to October1
with the regular-season filter. This recovered a February2022 aggregate which
timed out or returned502 with the older cache key. A read can still exceed60s;
HTTP failures remain explicit and do not change a missing observation to zero.

The source auditor exports `owned_league_source_audit.json` and dated
`matchups/league_owned_pbp_DATE.json`. Coverage distinguishes omitted historical
10-day players from players owned at a valuation cutoff. Missing owned evidence
retains the established SKILL prior where available and remains flagged. An
absence of NBA games is distinct from an unavailable source sample. Offseason
statistics carry only the already completed regular season.

`rebuild_owned_skill.py` then recalculates raw contributions, the original
SWITCH scorer and original prior/evidence blend. Historical SWITCH assignment
populations and NBA defensive tracking were already leaguewide and need no
per-game repull. The model version, prior weighting and prior calibration years
are unchanged. The source directory and its provenance must be preserved with
the resulting CSV; these are retrospective fixed-model reconstructions, not
archived forecasts that were actually published on those dates.

`expand_league_skill.py` is a stricter alternative for full thirty-team source
coverage: one date/one worker by default, a source-failure circuit breaker,
explicit `--all-dates` for a larger run. Its strict reconstruction helper refuses
to label partial league data as complete. The owned-player collector is more
efficient for inventory reconstruction.

## Recovering slow winter aggregates

The API's precomputed full-season totals and short later-game tails are much
more reliable than some cumulative cutoff requests. `recover_pbp_history.py`
uses a bounded source plan and `subtract_pbp_periods.py` to recover the exact
cutoff event counters. Both endpoints are PBPStats, with the same regular-season
filter and season. These are event counts, not full-season forecasts or rounded
Databallr rates. Same-vintage future-tail counters cancel exactly.

Validation against the independently retrieved December2022 cutoff found461
shared players, zero additive-count differences and zero differences in every
recoverable offensive-rebound percentage. The reconstruction independently
checks cutoff NBA points and actual seconds before accepting a player. A missing
tail row is never assumed zero unless dated NBA GP prove there were no later
games. Negative counter differences, point discrepancies and minute discrepancies
are rejected and listed in the audit. GamesPlayed comes from the dated NBA
reference. Minutes derive from exact PBP seconds, avoiding differences from
subtracting independently rounded minute displays.

Offensive-rebound percentages are recalculated from recovered opportunity
counts. An integer opportunity denominator can be recovered from positive
rebounds divided by the full-precision source percentage. A zero-rebound tail
may hide that denominator: in that case only OREB retains its prior, and the
other observed components update. Rates are never directly subtracted.

Completed-season Databallr observations are additionally reused for all
April30–September cutoffs, using the original audited canonical converter.
These raw full-season observations are already known at those dates. They do
not enter earlier in-season cutoffs. SWITCH is recomputed from dated NBA matchup
assignments with the original earlier-only residual calibration. This follows
the established Utah summer-acquisition supplement method across the league.

`owned_skill_coverage.json` gives each of1770 team/month records an exact
`source_cutoff`, missing-current player IDs, unavailable blended-player IDs and
separate no-NBA-game sample counts. Consumers should use this ownership-aware
audit rather than demanding observations for expired historical10-day players.
