# Refresh and publish without GitHub Actions

The scheduled Work refresh owns collection, projection calculations, validation,
and the frontend build. GitHub stores source and validated generated data.
Production is the existing `nba-impact-lab` Cloudflare Pages project in account
`459c82aa78b901e821b6b0935cac5bea`, branch `main`.

## Recover source without a working ZIP download

Pin the current main commit before fetching files. If a browser archive stalls,
use the GitHub connector's recursive tree and directory contents endpoints.
Reuse local files only when their Git blob hashes match that tree. For missing
files, request each directory at the pinned commit and immediately download its
returned file-specific `download_url` values in bounded concurrent batches.
These URLs expire quickly; acquire them just before downloading each batch and
request fresh directory metadata after a 404. Do not reuse one file's token for
another path. Verify every Git blob SHA before using a recovered file; changed line endings also\ninvalidate saved model fingerprints. Keep full logs on disk and read bounded\ntails rather than emitting datasets or encoded blobs into the conversation. Keep
credentials out of source, logs, and recovery checkpoints.

A failed run must preserve the last successful deployment and leave the daily
schedule enabled. Report the failing stage; do not pause future runs merely
because the current run failed. Publication is complete only after the exact
Cloudflare deployment succeeds and the production site serves the new data.

## Build a fresh release

Use a current checkout of `kaneaybul/nba-draft` and inspect applicable repository
instructions. The existing draft and NBA matchup collectors populate their raw
snapshots before this refresh. Never retrain the saved draft models or pull new
contract terms as part of the routine daily job.

```sh
bash script/frontend/setup_work_runtime.sh
source .work-runtime/environment.sh
npm ci --prefix frontend --no-audit --no-fund
NBA_REFRESH_WORK_DIR="$PWD/.work-refresh" bash script/frontend/run_work_refresh.sh
```

The R environment is pinned in `work_r_packages.lock`; Python uses the existing
asset-history requirements. Both install without root. Installer metadata and\npackage caches live inside the runtime, not the container home directory.\nSource `environment.sh` before `npm ci` so npm uses its writable cache. Set `NBA_WORK_RUNTIME`
to reuse an existing runtime directory, then source its `environment.sh`.
The runner sets `TZ=UTC` to align R's observation date with the Python source
snapshots; existing NBA Eastern rules for games and injuries remain explicit.
Each run gets a fresh scratch subdirectory so a same-day retry cannot reuse a
calibration cache built from different inputs.
Signed ownership is resolved from the existing ownership replay and saved
agreement terms before projecting minutes. The final asset capture must agree
with that same signed roster; a stale provider roster cannot add an unsigned
player to the projection or force another circular rebuild.

The refresh stops on invalid source inputs or failed projection checks. Keep the
current live deployment on any failure. Do not relabel old data as current or
publish a partial release. The frozen preseason archive and saved roster,
contract, and schedule CSVs are checked for preservation. Current player
membership, ratings, injury reports, completed results, positions, skill
evidence, draft scores, and all 30 asset portfolios are regenerated.

## Upload and publish directly

Package the contents of `frontend/dist` at the archive root, keeping the active
asset-history method and excluding unused method copies. Run:

```sh
python3 script/frontend/package_work_release.py --output .work-refresh/release.zip
python3 script/frontend/upload_pages_assets.py .work-refresh/release.zip .work-refresh/pages_manifest.json
```

The upload helper validates the archive, calculates the same BLAKE3 hashes as
Cloudflare's uploader, reuses existing assets, and verifies every uploaded hash.
It reads a short-lived Pages project upload JWT from stdin without echoing it
in an interactive terminal. Obtain that credential using the connected
Cloudflare account's `GET /accounts/{account_id}/pages/projects/nba-impact-lab/upload-token`.
Do not save the JWT in source, logs, an automation prompt, or a persistent file.
The Cloudflare connector's generic fetch authentication overrides this JWT, so
send the asset uploads from the Work Python process.

Uploading assets does not publish them. After all checks and hash verification
succeed, create a deployment with the connected Cloudflare API:

* `POST /accounts/{account_id}/pages/projects/nba-impact-lab/deployments`
* Multipart fields: `branch=main`, the current source `commit_hash`, a descriptive
  `commit_message`, and `manifest` containing the helper's manifest object.
* Attach the helper's `_headers` and `_redirects` values as text files.

Poll the returned deployment ID until its deploy stage succeeds, then verify
the normal production URL in the browser. Report source dates separately from
the publication time. Roll back only to a known successful deployment if the
live verification fails.

## Publish generated data to GitHub

Use the connected GitHub Git-data tools on the latest `main` head, with that
head as the commit parent and a non-forced `expected_sha` ref update. Preserve
concurrent changes. Include only validated source snapshots and derived app /
model outputs; omit scratch, runtimes, credentials, and intermediate diagnostics.
Routine generated-data commits should include `[skip ci]`. Commit the complete\nvalidated generated state, including player-state checkpoints, before considering\na release finished. A deployed release with uncommitted state leaves the next\nclean refresh starting from older inputs.
Store the current method's team histories as the canonical `.json.gz` files.
The ordinary `.json` files are materialized for calculation and browser builds;
do not commit both forms. The materializer restores exact bytes before use.
For large Git blob uploads, read base64 in bounded chunks of 262143 source
bytes (divisible by three), concatenate them, verify the encoded length, and
require GitHub's returned blob SHA to match the local Git blob SHA. Large
command outputs have a byte cap even when their token budget is higher.

The archived workflow files retain their manual inputs and commands but have no
automatic triggers. Daily refreshes and deployments do not use Actions minutes.
