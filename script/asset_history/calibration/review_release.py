"""Semantic gates for the complete career-path / rolling-window release."""
import argparse,gzip,json,sys
from collections import Counter
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model_version import METHOD,LEGACY_VERSION,data_root
from publish import TEAMS,atomic
from validate_attribution import validate
from calibration.endpoint_model import production_quotes,POLICY,PICK_POLICY
from calibration.path_model import evidence_weight
from calibration.coverage import documented_missing_endpoint

def report(repo):
    with gzip.open(repo/'processed/asset_history/player_state/path_calibration.json.gz','rt')as f:data=json.load(f)
    assert data['policy']==POLICY
    model=json.loads((repo/'processed/asset_history/picks/trained_pick_model.json').read_text())
    assert model['stock_policy']==PICK_POLICY and model['production_policy']==POLICY
    premiums=[]
    for r in data['endpoint_records']:
        w=np.asarray(r['endpoint_weights']);p=np.asarray(r['endpoint_paths']);q=production_quotes(p)
        assert abs(float(w@q)-r['value'])<.01
        np.testing.assert_allclose(w@p,r['endpoint'],rtol=1e-10,atol=1e-6)
        audit=r['endpoint_audit'];assert audit['latest_label']<=r['end']
        premiums.append(r['value']-float(production_quotes(w@p)[0]))
    assert max(abs(p)for p in premiums)<.01,'Completed endpoint gained a new mature-player uncertainty premium'
    for r in data['endpoint_errors']:
        assert r['label_end']==r['origin']+r['lead'] and r['label_end']<=data['training_through']
        assert len(r['residual'])==4
    for r in data['cases']:
        assert r['latest_prior_label']<r['cohort'],'Moving original draft expectation'
        assert r['latest_residual_label']<=r['origin'],'Future endpoint simulation error'
    for r in data['report']['holdouts']:
        assert r['latest_learning_label']<=r['origin'],'Future reliability label'
    baselines={};counts=Counter();differences=[];unavailable=[]
    for team in TEAMS:
        current=json.loads((data_root(repo)/'teams'/f'{team}.json').read_text())
        legacy=json.loads((data_root(repo,LEGACY_VERSION)/'teams'/f'{team}.json').read_text())
        old={s['date']:s for s in legacy['snapshots']}
        for s in current['snapshots']:
            old_players={a['id']:a for a in old[s['date']]['assets']if a['kind']=='player'}
            new_players={a['id']:a for a in s['assets']if a['kind']=='player'}
            assert set(new_players)==set(old_players),'Method-only replay changed ownership'
            for pid,a in new_players.items():
                d=a.get('details',{})
                from backfill.asset_minutes import POLICY as MINUTES_POLICY
                assert d.get('role_minutes_policy')==MINUTES_POLICY,'Player bypassed the current minutes policy'
                draft=int(float(d.get('draft_year')or 0))
                if draft<2022 or not d.get('draft_slot'):
                    from backfill.asset_minutes import POLICY as MINUTES_POLICY
                    assert d.get('role_minutes_policy')==MINUTES_POLICY,'Older cohort bypassed current minutes policy'
                    counts['recomputed_older_cohort_player_observations']+=1
                    continue
                grade=d.get('draft_development',{})
                if grade.get('status')!='priced' and d.get('asset_type')in ('unsigned_draft_right','dormant_draft_right') and s['date']>f'{draft+4}-07-31':
                    counts['post_window_unsigned_right_existing_policy']+=1
                    continue
                if documented_missing_endpoint(a['name'],grade,data['endpoint_excluded']):
                    assert d.get('endpoint_stock_policy')!=PICK_POLICY,'Unavailable appraisal used as an endpoint stock'
                    assert 'value'not in grade and 'gain'not in grade,'Missing rating became an invented grade'
                    counts['documented_unavailable_endpoint_observations']+=1
                    unavailable.append(dict(team=team,date=s['date'],player=a['name'],reason=grade['reason']))
                    continue
                if grade.get('status')!='priced':
                    raise ValueError(('Supported draft appraisal missing',team,s['date'],a['name'],grade))
                assert grade['method']==POLICY
                assert grade['baseline_latest_label']<draft
                key=pid,draft
                if key in baselines:assert abs(baselines[key]-grade['original_expectation'])<.01
                baselines[key]=grade['original_expectation']
                assert grade['contract_effect']==0.
                if s['date']<=grade['endpoint']:
                    assert abs(d['peak_production']-grade['value']-d['development_window_basis'])<.01
                c=d.get('path_calibration',{})
                if c.get('status')=='priced':
                    assert c.get('endpoint_stock_policy')==PICK_POLICY
                    assert abs(a['value']-c['mean'])<.01
                    assert 'p10'in c and 'p90'in c,'Lost rolling-path quantiles'
                    assert abs(c['mean']-c['production_quote']-c['contract_adjustment_sum'])<.01
                    counts['rolling_scenario_quotes']+=1
                if grade.get('own_production_value')is not None and grade.get('own_mean_path_value')is not None:
                    if grade['own_production_value']-grade['own_mean_path_value']>1.:counts['own_endpoint_path_premium_quotes']+=1
                if grade['completed']:
                    assert abs(grade['value']-grade['own_mean_path_value'])<.01
                    counts['frozen_completed_endpoint_quotes']+=1
                elif grade['nba_weight']==0.:
                    assert abs(grade['gain'])<.01
                    counts['zero_evidence_original_prior_quotes']+=1
                counts['supported_player_observations']+=1
        differences.append(dict(team=team,date=current['snapshots'][-1]['date'],
            before=legacy['snapshots'][-1]['total'],after=current['snapshots'][-1]['total']))
    checks=validate(repo)
    result=dict(method=METHOD,checks=checks,counts=dict(counts),endpoint_labels=len(premiums),
        label_selection_premium_mean=float(np.mean(premiums)),label_selection_premium_max=float(max(premiums)),
        endpoint_revision_training_paths=len(data['endpoint_errors']),learning_holdouts={k:v for k,v in data['report'].items()if k!='holdouts'},
        teams=differences,unavailable_endpoint_observations=unavailable,limitations=['Indexed old-chat excerpts were retrievable; a complete verbatim transcript was unavailable.',
        'Endpoint draft attribution supports 2022+ cohorts; all earlier cohort rolling quotes are recomputed with the same current minutes policy.',
        'Documented missing endpoint ratings remain explicitly unavailable, never zero; affected observations are listed.',
        'Endpoint uncertainty is learned from revisions to assessed forecasts before year four; mature-player pricing is retained.'])
    atomic(repo/'processed/asset_history/methodology_review.json',result)
    print(json.dumps(result),flush=True)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());a=p.parse_args();report(a.repo.resolve())

