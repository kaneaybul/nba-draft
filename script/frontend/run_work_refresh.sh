#!/usr/bin/env bash
# Collect, calculate, validate, and build without GitHub Actions.
# Publication is a separate explicit direct upload to the existing Pages site.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
repo="$PWD"
for program in python3 node Rscript; do
  command -v "$program" >/dev/null || { echo "Missing dependency: $program" >&2; exit 1; }
done
export CURRENT_ROSTER_YEAR
CURRENT_ROSTER_YEAR="$(python3 -c 'import json; print(int(json.load(open("raw/live/skill_stats.json"))["season"])-1)')"
export VITE_PUBLIC_READ_ONLY=true
# Match the previous runner's UTC observation date. Individual game and injury
# rules keep their explicit NBA Eastern timezone inside the existing models.
export TZ=UTC
export FRONTEND_MAX_STATIC_ASSET_BYTES=26214400
export FRONTEND_MAX_INITIAL_PAYLOAD_BYTES=8388608
work_root="${NBA_REFRESH_WORK_DIR:-$repo/.work-refresh}"
mkdir -p "$work_root"
# Calibration caches are tied to exact inputs, including on same-day retries.
work="$(mktemp -d "$work_root/run-XXXXXX")"
echo "Refresh scratch: $work"

echo 'Syncing externalized static artifacts'
python3 script/sync_artifacts.py --repo "$repo"

echo 'Checking saved inputs and frozen preseason archive'
node script/frontend/validate_preseason_archive.mjs
Rscript script/frontend/test_contract_source_years.R
Rscript script/frontend/test_live_minutes.R
sha256sum "processed/livedata/impactrefresh/current_rosters_${CURRENT_ROSTER_YEAR}.csv" \
  "processed/livedata/impactrefresh/contracts_${CURRENT_ROSTER_YEAR}_spotrac.csv" \
  processed/livedata/impactrefresh/spotrac_allteams_no_guarantees/scrape_audit.csv \
  processed/livedata/schedules/bref_team_schedules.csv > "$work/preserved-inputs.sha256"

echo 'Refreshing independent sources in parallel (Wave 1)'
mkdir -p "$work/wave1"
wave1_pids=()
wave1_names=()
run_wave1() {
  local name="$1"
  shift
  "$@" > "$work/wave1/${name}.log" 2>&1 &
  wave1_pids+=("$!")
  wave1_names+=("$name")
}

run_wave1 player_pool python3 script/data/refresh_player_pool.py
run_wave1 live_ratings bash -c 'node --test script/data/test_live_ratings.mjs && node script/data/refresh_live_ratings.mjs'
run_wave1 injury_outlook python3 script/data/refresh_injury_outlook.py --results-output raw/live/results.json
run_wave1 pbp_positions python3 script/data/refresh_pbp_position_estimates.py
if [[ -f raw/draft_preview_2027_inputs.csv ]]; then
  run_wave1 draft_2027 bash -c '
    set -euo pipefail
    python3 script/draft/refresh_2027_stats.py \
      processed/draft/draft_consensus_projection_ranks_2027.csv "$1/draft-inputs.csv" \
      --snapshot raw/draft_preview_2027_inputs.csv
    if ! cmp -s "$1/draft-inputs.csv" processed/draft/draft_consensus_projection_ranks_2027.csv; then
      Rscript --vanilla script/draft/score_2027_preview.R "$1/draft-inputs.csv" "$1/draft-scores.csv"
      cp "$1/draft-inputs.csv" processed/draft/draft_consensus_projection_ranks_2027.csv
      cp "$1/draft-scores.csv" processed/draft/draft_skill_preview_2027.csv
    fi
  ' _ "$work"
fi

wave1_failed=0
for i in "${!wave1_pids[@]}"; do
  if ! wait "${wave1_pids[$i]}"; then
    echo "FAILED Wave 1 job: ${wave1_names[$i]}" >&2
    cat "$work/wave1/${wave1_names[$i]}.log" >&2
    wave1_failed=1
  else
    echo "Completed Wave 1 job: ${wave1_names[$i]}"
    cat "$work/wave1/${wave1_names[$i]}.log"
  fi
done
if [[ "$wave1_failed" -ne 0 ]]; then
  exit 1
fi

echo 'Refreshing current-season skill evidence and SWITCH (Wave 2)'
python3 script/data/refresh_live_skill_stats.py
Rscript script/frontend/refresh_live_switch.R
python3 script/data/refresh_player_pool.py --enrich

echo 'Resolving signed ownership using saved contract terms'
python3 script/frontend/prepare_work_contracts.py --repo "$repo" --work-dir "$work/contracts"
sha256sum processed/contracts/current.json processed/contracts/current.csv > "$work/signed-book.sha256"

echo 'Exporting injury-aware player and team projections'
Rscript script/frontend/export_frontend_data.R
Rscript script/frontend/test_live_ratings.R --require-export
Rscript script/frontend/test_player_pool.R --require-export
Rscript script/frontend/test_live_minutes.R --require-export
Rscript script/frontend/test_lineup_positions.R
Rscript script/frontend/test_injury_projections.R --require-export

echo 'Refreshing all 30 asset portfolios using saved contract terms'
python3 script/asset_history/materialize.py --repo "$repo"
python3 script/asset_history/refresh.py --repo "$repo" --work-dir "$work/asset-history" --skip-contract-refresh
python3 script/frontend/build_shared_contracts.py --repo "$repo"
sha256sum --check "$work/signed-book.sha256"
python3 script/frontend/build_asset_value_data.py --repo "$repo"
node script/frontend/build_cap_tracker_spotrac_data.mjs
node script/frontend/build_static_data_manifest.mjs

echo 'Validating the complete static release'
node script/frontend/test_shared_contracts.mjs --require-export
node script/frontend/test_asset_surface_consistency.mjs
if [[ -f script/frontend/history_release_policy.json ]]; then
  python3 script/frontend/test_pinned_asset_history.py --repo "$repo" --policy script/frontend/history_release_policy.json
else
  node script/frontend/test_asset_history_visuals.mjs --require-published
fi
node script/frontend/test_data_refresh.mjs
node script/frontend/validate_preseason_archive.mjs
sha256sum --check "$work/preserved-inputs.sha256"
cd frontend
npm run validate:data
npm run validate:schedule
npm run test:asset-value
npm run test:cap-tracker
npm run test:trade-machine
npm run test:trade-suggestions
npm run build
echo "WORK_REFRESH_COMPLETE: $repo/frontend/dist"

