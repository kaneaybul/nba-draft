"""Package the small reproducible engine fixture, excluding scraped game corpus.

This archive is a model/input seed, not a daily refresh. Its source hash manifest
lets CI verify that runtime inputs were not silently replaced.
"""
import argparse,hashlib,json,zipfile
from pathlib import Path


def build(root,destination):
    root=root.resolve();chosen=set()
    def add(rel):
        p=root/rel
        if p.is_file():chosen.add(p)
    def glob(pattern):
        for p in root.glob(pattern):
            if p.is_file():chosen.add(p)
    for pattern in ['monthly_reconstruction/projections/*.py','monthly_reconstruction/projections/app_sources/*.csv','app_model/impact_*.json','app_model/schedule_*.json']:
        glob(pattern)
    for rel in ['curated_ledger_v3.py','decision_contract_terms.py','events.json',
      'app_model/processed/draft/draft_picks_all_classes.csv','app_model/processed/livedata/impactrefresh/salary_cap_assumptions.csv','app_model/processed/livedata/impactrefresh/impactoutput.csv',
      'monthly_reconstruction/projections/annual_history.csv','monthly_reconstruction/projections/rookie_priors.csv',
      'monthly_reconstruction/projections/pre_minutes_smoothing_monthly_annual_values.csv','monthly_reconstruction/projections/pre_minutes_smoothing_monthly_player_values.csv','monthly_reconstruction/projections/role_provider_gated_backtest.json',
      'monthly_reconstruction/epm/epm_monthly.csv','monthly_reconstruction/darko/end_of_month/darko_monthly.csv',
      'monthly_reconstruction/skill/blend_monthly_skill.py','monthly_reconstruction/skill/atomic_output.py','monthly_reconstruction/skill/monthly_blended_skills.csv','monthly_reconstruction/skill/coverage_summary.json','monthly_reconstruction/skill/monthly_skill_observations.json','monthly_reconstruction/skill/roster_skill_coverage.json',
      'monthly_reconstruction/ledger/monthly_inventory.json','monthly_reconstruction/team_ratings/utah_rotations_monthly.csv',
      'monthly_reconstruction/league_ownership/monthly_league_rosters.json','monthly_reconstruction/league_ownership/monthly_role_anchors.csv','monthly_reconstruction/league_ownership/monthly_role_anchors.py','monthly_reconstruction/league_ownership/replay_summer_ratings.py','monthly_reconstruction/league_ownership/source_inventory.py',
      'monthly_reconstruction/league_ownership/opening_rosters_2021.json','monthly_reconstruction/league_ownership/league_events.json','monthly_reconstruction/league_ownership/ownership_runtime_audit.json','monthly_reconstruction/league_ownership/roster_refresh_source.json',
      'monthly_reconstruction/pick_values/trained_pick_model.json','monthly_reconstruction/pick_forecasts/standings_monthly.csv',
      'monthly_reconstruction/pick_forecasts/raw/dunks_ratings_2022-01-01.json','monthly_reconstruction/injuries/injury_overrides.json','monthly_reconstruction/injuries/current_availability.json','monthly_reconstruction/injuries/daily_availability_history.json']:
        add(rel)
    glob('monthly_reconstruction/skill/raw/nba_assignment_inputs_*.json')
    glob('monthly_reconstruction/pick_forecasts/raw/nba_team_game_logs_*.json')
    extra_schedule=Path(__file__).resolve().parents[3]/'processed/asset_history/team_schedule_2027.json'
    extras={'app_model/league_schedule_2027.json':extra_schedule.read_bytes()}if extra_schedule.exists()else {}
    manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted(chosen)}
    manifest.update({name:hashlib.sha256(data).hexdigest()for name,data in extras.items()})
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
        def put(name,data):
            info=zipfile.ZipInfo(str(name),date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,data)
        for p in sorted(chosen):put(p.relative_to(root),p.read_bytes())
        for name,data in extras.items():put(name,data)
        put('runtime_input_manifest.json',json.dumps(manifest,sort_keys=True))
    result={'archive':str(destination),'archive_sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'files':len(chosen)+len(extras),'uncompressed_bytes':sum(p.stat().st_size for p in chosen)+sum(len(v)for v in extras.values()),'compressed_bytes':destination.stat().st_size,'scope':'Canonical engine and seed inputs only; excludes bulk matchup/source HTML/PDF corpus; current sources still require refresh'}
    destination.with_suffix('.json').write_text(json.dumps(result,indent=2));return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--canonical',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(build(a.canonical,a.output)))
