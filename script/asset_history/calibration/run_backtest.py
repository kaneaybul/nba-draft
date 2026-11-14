"""Reproducible read-only candidate calibration and chronological evaluation."""
import argparse
import json
import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'script'))
from asset_history.calibration.historical import HistoricalPanel, eligible_careers, name_key
from asset_history.calibration.path_model import (CareerPool, ResidualPool, path_quotes,
    summarize, feature_vector, evidence_weight, fit_reliability, slot_weights,regularize_paths)


def metrics(rows, column):
    if not rows:
        return dict(n=0)
    error = np.array([r[column]-r['actual'] for r in rows])
    actual = np.array([r['actual'] for r in rows])
    return dict(n=len(rows),mean_error=float(error.mean()),mae=float(np.abs(error).mean()),
                rmse=float(np.sqrt(np.square(error).mean())),
                actual_total=float(actual.sum()),predicted_total=float(actual.sum()+error.sum()))


def evaluate(panel, errors, careers, out):
    residuals = ResidualPool(errors)
    rolling = []
    # The quote's nonlinear production part is evaluated before contracts.
    # An identical fixed signed cost cancels from forecast errors.
    for r in errors:
        h=4
        if r['horizon']<h:
            continue
        origin=r['origin']
        try:
            paths,w,meta=residuals.scenarios(r['mean'][:h],r['feature'],origin,True,r['key'])
            uncentered,_,_=residuals.scenarios(r['mean'][:h],r['feature'],origin,False,r['key'])
        except ValueError:
            continue
        centered=summarize(paths,np.zeros(h),w)
        rolling.append(dict(origin=origin,key=r['key'],
            experience=r['feature'][3],
            actual=float(path_quotes(r['actual'][:h],np.zeros(h))[0]),
            mean_path=float(path_quotes(r['mean'][:h],np.zeros(h))[0]),
            path_value=centered['mean'],bias_corrected=float(w@path_quotes(uncentered,np.zeros(h))),
            p10=centered['p10'],p90=centered['p90'],latest_training_label=meta['latest_label']))
    young=[]
    original=[r for r in careers if r['stage']==0 and r['horizon']>=4 and r['cohort']<=panel.last_year-4]
    for r in original:
        key,cohort=r['key'],r['cohort']
        if key in panel.ambiguous:
            continue
        ids=panel.names.get(key,set())
        if len(ids)!=1:
            continue
        pid=next(iter(ids))
        for stage in (1,2,3):
            origin=cohort+stage
            state=panel.states.get((origin,pid))
            if state is None or origin<2020:
                continue
            pool=eligible_careers(careers,origin)
            if len(pool)<30:
                continue
            past=np.asarray(r['production'][:stage])
            pw=slot_weights([s['slot'] for s in pool],r['slot'])
            complete_prior=np.array([s['production'] for s in pool])
            complete_prior,_=regularize_paths(complete_prior,[s['slot'] for s in pool],r['slot'],pw)
            prior_paths=complete_prior[:,stage:4]
            prior=np.concatenate([np.broadcast_to(past,(len(pw),stage)),prior_paths],axis=1)
            mean=panel.forecast(origin,pid,4-stage)
            feature=feature_vector(state.age,state.total,state.minutes,state.yoe)
            try:
                nba,nw,meta=residuals.scenarios(mean,feature,origin,True,key)
            except ValueError:
                continue
            nba=np.concatenate([np.broadcast_to(past,(len(nw),stage)),nba],axis=1)
            prior_q=float(pw@path_quotes(prior,np.zeros(4)))
            nba_q=float(nw@path_quotes(nba,np.zeros(4)))
            calendar=stage/3
            blended_mean=calendar*(nw@nba)+(1-calendar)*(pw@prior)
            minutes=panel.career_minutes(key,pid,cohort,origin)
            young.append(dict(key=key,player=r['player'],cohort=cohort,stage=stage,
                origin=origin,label_end=cohort+4,slot=r['slot'],minutes=minutes,
                prior=prior_q,nba=nba_q,actual=float(path_quotes(r['production'][:4],np.zeros(4))[0]),
                calendar_mean=float(path_quotes(blended_mean,np.zeros(4))[0]),
                calendar_paths=calendar*nba_q+(1-calendar)*prior_q,
                latest_residual_label=meta['latest_label']))
    for case in young:
        fitted=fit_reliability(young,case['origin'])
        if fitted['n']>=30:
            w=evidence_weight(case['minutes'],fitted['scale'])
            case.update(learned=case['prior']+w*(case['nba']-case['prior']),learned_weight=w,
                        evidence_scale=fitted['scale'],training_n=fitted['n'],
                        latest_reliability_label=fitted['latest_label'])
    learned=[r for r in young if 'learned' in r]
    pick_tests=[]
    for cohort in range(2020,panel.last_year-3):
        training=eligible_careers(careers,cohort)
        test=[r for r in original if r['cohort']==cohort]
        if not training:
            continue
        x=np.array([[1,np.log(r['slot'])] for r in training])
        y=np.array([path_quotes(r['production'],np.zeros(4))[0] for r in training])
        coef=np.linalg.lstsq(x,y,rcond=None)[0]
        for r in test:
            w=slot_weights([s['slot'] for s in training],r['slot'])
            pick_tests.append(dict(cohort=cohort,slot=r['slot'],player=r['player'],
                actual=float(path_quotes(r['production'][:4],np.zeros(4))[0]),
                ols=float(np.array([1,np.log(r['slot'])])@coef),
                empirical=float(w@y),training_n=len(training),latest_label=max(s['label_end'] for s in training)))
    summary=dict(
        rolling_four_year={c:metrics(rolling,c) for c in ('mean_path','path_value','bias_corrected')},
        experienced_rolling_four_year={c:metrics([r for r in rolling if r['experience']>=4],c)
            for c in ('mean_path','path_value','bias_corrected')},
        rolling_by_origin={str(y):{c:metrics([r for r in rolling if r['origin']==y],c)
            for c in ('mean_path','path_value','bias_corrected')} for y in sorted({r['origin'] for r in rolling})},
        rolling_interval_80_coverage=float(np.mean([r['p10']<=r['actual']<=r['p90'] for r in rolling])),
        young_learned_holdout={c:metrics(learned,c) for c in ('calendar_mean','calendar_paths','learned')},
        young_by_stage={str(s):{c:metrics([r for r in learned if r['stage']==s],c)
            for c in ('calendar_mean','calendar_paths','learned')} for s in (1,2,3)},
        pick_chronological={c:metrics(pick_tests,c) for c in ('ols','empirical')},
        pick_by_cohort={str(y):{c:metrics([r for r in pick_tests if r['cohort']==y],c)
            for c in ('ols','empirical')} for y in range(2020,panel.last_year-3)},
        final_reliability=fit_reliability(young,panel.last_year))
    groups=sorted({r['cohort'] for r in learned})
    if groups:
        sse=np.array([[sum((r['calendar_mean']-r['actual'])**2 for r in learned if r['cohort']==g),
                       sum((r['learned']-r['actual'])**2 for r in learned if r['cohort']==g)] for g in groups])
        indices=np.random.default_rng(20261101).integers(0,len(groups),(5000,len(groups)))
        sampled=sse[indices].sum(axis=1)
        improvement=1-np.sqrt(sampled[:,1]/sampled[:,0])
        summary['young_cohort_bootstrap']=dict(cohorts=groups,draws=5000,seed=20261101,
            rmse_improvement_90_interval=np.quantile(improvement,[.05,.95]).tolist(),
            note='Exploratory cohort-cluster bootstrap; few independent draft classes')
    for filename,data in [('rolling_holdouts',rolling),('young_holdouts',young),('pick_holdouts',pick_tests)]:
        (out/f'{filename}.json').write_text(json.dumps(data,indent=2,allow_nan=False))
    return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--no-impute-small-service',action='store_true')
    args=parser.parse_args()
    args.out.mkdir(exist_ok=True,parents=True)
    sys.path.insert(0,str(args.runtime/'monthly_reconstruction/projections'))
    panel=HistoricalPanel(args.runtime,args.source,impute_small_service=not args.no_impute_small_service)
    print('Historical annual panel built',flush=True)
    errors=panel.residual_rows()
    careers=panel.career_rows()
    (args.out/'residuals.json').write_text(json.dumps(errors,allow_nan=False))
    (args.out/'careers.json').write_text(json.dumps(careers,allow_nan=False))
    print('Panels',len(errors),'forecast error paths;',len(careers),'career segments',flush=True)
    summary=evaluate(panel,errors,careers,args.out)
    summary['audit']=dict(panel.audit)
    summary['audit']['estimated_low_service_seasons']=len(panel.estimated_outcomes)
    summary['audit']['estimated_low_service_minutes']=sum(r['minutes'] for r in panel.estimated_outcomes.values())
    (args.out/'estimated_outcomes.json').write_text(json.dumps(list(panel.estimated_outcomes.values()),indent=2))
    summary['scope']=dict(asof='2026-11-01',completed_seasons_through=2026,
        archived_contemporaneous_forecasts=False,mean_coefficients_refit_at_each_origin=True,
        sources='Existing retrospective impact specification, official annual games/minutes, BRef service coverage',
        monetary_basis='164,961,000 salary cap',contracts_in_forecast_backtest=False,
        label_rule='last season of outcome segment <= forecast origin',
        injury_vs_benching_labels=False)
    (args.out/'backtest_summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False))
    print(json.dumps(summary,indent=2),flush=True)


if __name__=='__main__':
    main()
