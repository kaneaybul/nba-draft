# Externalized Artifacts & Repo Slimming

To keep `kaneaybul/nba-draft` fast to clone and safely below GitHub's 5 GB repository limit, large static binary/data bundles are managed via [`sync_artifacts.py`](sync_artifacts.py) and pinned in [`artifact_manifest.json`](artifact_manifest.json).

## Usage

```bash
# Verify local presence and SHA-256 checksums without downloading
python3 script/sync_artifacts.py --check

# Download any missing or mismatched bundles from the pinned GitHub Release
python3 script/sync_artifacts.py
```

`sync_artifacts.py` checks local disk first (skipping downloads when files already match their SHA-256 checksums) and fails closed on any checksum mismatch or unsafe archive entry. It uses `gh release download` when the GitHub CLI is available, falling back to the GitHub REST API with `GH_TOKEN` or `GITHUB_TOKEN`.

It is wired into:
- [`script/asset_history/materialize.py`](asset_history/materialize.py)
- [`script/frontend/run_work_refresh.sh`](frontend/run_work_refresh.sh)
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## Completing Phase 2 (Externalizing Active Static Bundles)

Because remote-agent VMs cannot upload assets to `uploads.github.com`, the 6 active static bundles remain tracked in Git for now and `sync_artifacts.py` reuses them locally. To finish moving them out of Git from a machine with full `gh` release upload access (or to Cloudflare R2):

1. Package and upload the 6 bundles listed in `artifact_manifest.json` to the `artifacts-active-v1` release:
   ```bash
   mkdir -p /tmp/artifacts-active-v1
   tar -czf /tmp/artifacts-active-v1/rolling-pricing-v16.tar.gz processed/asset_history/rolling_pricing/v16
   tar -czf /tmp/artifacts-active-v1/asset-history-v15.tar.gz frontend/public/data/asset_history/v15
   tar -czf /tmp/artifacts-active-v1/asset-history-v16.tar.gz frontend/public/data/asset_history/v16
   tar -czf /tmp/artifacts-active-v1/career-projection-models.tar.gz processed/modelresults/career_projection_models.rds
   tar -czf /tmp/artifacts-active-v1/ref-oldfrontend.tar.gz ref/oldfrontend
   tar -czf /tmp/artifacts-active-v1/runtime-seed.tar.gz processed/asset_history/runtime_seed
   (cd /tmp/artifacts-active-v1 && sha256sum *.tar.gz > SHA256SUMS.txt)
   gh release create artifacts-active-v1 --target main --title "Active Static Artifacts (v1)" /tmp/artifacts-active-v1/*
   ```
2. Update the tarball `sha256` / `bytes` entries in `script/artifact_manifest.json` to match the freshly built tarballs.
3. Add those 6 paths to `.gitignore` and `git rm -rf --cached` them, then test with a clean `python3 script/sync_artifacts.py --force`.

## Optional Phase 3 (Reclaiming Historical `.git` Size)

Removing files from `HEAD` shrinks working trees immediately (~2 GB saved in Phase 1), while historical blobs remain in `.git` until history is rewritten. Once you have backed up any desired historical archives externally, you can reclaim the GitHub storage quota with [`git-filter-repo`](https://github.com/newren/git-filter-repo) on a fresh mirror clone and force-push `main` (requiring all local/Work clones to re-clone).
