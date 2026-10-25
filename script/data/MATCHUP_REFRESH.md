# NBA matchup collection

NBA Stats completes TLS but does not send response headers to the tested GitHub
Ubuntu and macOS runners. The public source responds from the Work runtime.
Keep the model calculation on GitHub and collect only the raw matchup inputs
outside that network.

Run this collector from a network with NBA access:

```sh
python3 script/data/matchup_snapshot.py --season 2027 --output /tmp/nba-matchup-snapshot.json
```

Read the current season from `raw/live/skill_stats.json`; do not hardcode 2027
in a recurring task. The collector needs only `matchup_snapshot.py` and
`nba_transport.py` and uses no account credentials. A scheduled Work task
publishes the verified output to `raw/live/matchup_snapshot.json` on `main`
before the existing morning rebuild. Updating that file alone does not launch
another rebuild. An immediate refresh also updates `raw/live_refresh_request.json`.

The snapshot retains original defender/offender pairs, game counts and partial
possessions with the NBA response season parameters. Gzip/base64 reduces its
size; SHA-256 detects corruption. The normal daily build applies that day's
resolved positions, scoring rates, model coefficients and evidence weights.
It rejects wrong-season, stale (over six hours), duplicate, malformed or
incomplete snapshots. The existing per-player game-coverage check still applies.
Missing inputs retain the preseason component rather than becoming zero.

The collector is scheduled for 05:45 America/Denver, before the existing
13:15 UTC rebuild in either daylight or standard time. Routine success is
silent; source or publishing failures should notify the owner. If the snapshot
is absent or rejected, GitHub tries a bounded 20-second direct request before
preserving the prior. Other environments retain the 60/90-second retry budgets.
