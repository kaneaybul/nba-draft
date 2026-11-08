# Refresh and publish without GitHub Actions

The scheduled Work refresh owns collection, projection calculations, validation,
and the frontend build. GitHub stores source and validated generated data.
Production is the existing `nba-impact-lab` Cloudflare Pages project in account
`459c82aa78b901e821b6b0935cac5bea`, branch `main`.

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
asset-history requirements. Both install without root. Set `NBA_WORK_RUNTIME`
to reuse an existing runtime directory, then source its `environment.sh`.

The refresh stops on invalid source inputs or failed projection checks. Keep the
current live deployment on any failure. Do not relabel old data as current or
publish a partial release. The frozen preseason archive and saved roster,
contract, and schedule CSVs are checked for preservation. Current player
membership, ratings, injury reports, completed results, positions, skill
evidence, draft scores, and all 30 asset portfolios are regenerated.

## Upload and publish directly

ZIP the contents of `frontend/dist` at the archive root. Run:

```sh
python3 script/frontend/upload_pages_assets.py RELEASE.zip PAGES_MANIFEST.json
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
Routine generated-data commits should include `[skip ci]`.

The archived workflow files retain their manual inputs and commands but have no
automatic triggers. Daily refreshes and deployments do not use Actions minutes.
