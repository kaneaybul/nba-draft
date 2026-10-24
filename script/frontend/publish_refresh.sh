#!/usr/bin/env bash
# Never publish data built from an older source revision over newer work.
set -euo pipefail
message=${1:?Commit message required}
base=$(git rev-parse HEAD)
report_superseded() {
  echo 'Refresh superseded by a newer main commit; keeping the last published data.'
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo 'Refresh superseded by newer source changes. No stale data was published; the next scheduled or explicitly requested refresh will rebuild main.' >> "$GITHUB_STEP_SUMMARY"
  fi
}
git fetch origin main
if [[ $(git rev-parse origin/main) != "$base" ]]; then
  report_superseded
  exit 0
fi
if git diff --cached --quiet; then
  echo 'No data changes to commit.'
  exit 0
fi
git commit -m "$message"
if ! git push origin HEAD:main; then
  git fetch origin main
  if [[ $(git rev-parse origin/main) != "$base" ]]; then
    report_superseded
    exit 0
  fi
  echo 'Publishing failed without a superseding source change.' >&2
  exit 1
fi
