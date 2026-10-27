"""Reuse a league-wide calibration across independent team inventories.

Dollar conversion and position smoothing depend on the league input panel,
not which team's ownership ledger is being valued. Verify the exact source
fingerprint before sharing these computations across teams.
"""
import hashlib,json
from pathlib import Path
import numpy as np


def source_signature(canonical,skill_dir):
    canonical=canonical.resolve();skill_dir=skill_dir.resolve()
    paths=[canonical/'monthly_reconstruction/epm/epm_monthly.csv',canonical/'monthly_reconstruction/darko/end_of_month/darko_monthly.csv',skill_dir/'monthly_blended_skills.csv',canonical/'monthly_reconstruction/projections/annual_history.csv',canonical/'monthly_reconstruction/projections/app_sources/skilloutput.csv',canonical/'monthly_reconstruction/projections/adaptive_calibration.py']
    paths += list((canonical/'monthly_reconstruction/projections/app_sources').glob('bref_positions_*.csv'))
    paths += [canonical/'monthly_reconstruction/projections/valuation_engine.py',canonical/'monthly_reconstruction/projections/integrate_monthly.py',canonical/'monthly_reconstruction/projections/rookie_priors.csv',canonical/'monthly_reconstruction/projections/app_sources/career_projection_selected_terms.csv',canonical/'monthly_reconstruction/pick_forecasts/standings_monthly.csv']
    return {str(p.relative_to(canonical))if p.is_relative_to(canonical)else 'external/'+p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in paths}


def frozen_class(original,cache,signature):
    saved=json.loads(Path(cache).read_text())
    if saved['input_sha256']!=signature:raise ValueError('League calibration cache source hashes differ')
    class Frozen(original):
        def __init__(self,src):
            super().__init__(src)
            self.results=saved['calibration']
            self.rows=saved['rows']
            self.position_rows=saved['positions']
            self.byposition={(r['cutoff_date'],int(r['nba_id'])):r for r in saved['positions']if r.get('nba_id')is not None}
        def at(self,cutoff,year,completed):
            if cutoff not in self.results:raise ValueError('Missing cached league cutoff '+cutoff)
            result=self.results[cutoff]
            from datetime import date
            self.previous={'date':date.fromisoformat(cutoff),'levels':dict(result['levels']),'league_timin':result['league_timin']}
            for (dt,pid),r in self.byposition.items():
                if dt==cutoff:self.position_state[pid]={'date':date.fromisoformat(dt),'shares':np.array([r[s]for s in ('pg_share','sg_share','sf_share','pf_share','c_share')])}
            return result
        def position(self,pid,k,completed,provider,cutoff):
            r=self.byposition.get((cutoff,int(pid)))if pid is not None else None
            if r:return np.array([r[s]for s in ('pg_share','sg_share','sf_share','pf_share','c_share')]),r.get('method','asof90day_smoothed_completed_usage_and_dated_provider_role')
            return super().position(pid,k,completed,provider,cutoff)
    return Frozen
