"""Compare the current published inventory with the experimental path method.

Read-only. Pick portfolios are deliberately not approximated by their mean
selection: those require replaying the joint legal-rights allocator.
"""
import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
REPO=Path(__file__).resolve().parents[3]
RUNTIME=Path('.')
sys.path[:0]=[str(REPO/'script'),str(REPO/'script/asset_history/backfill'),
              str(RUNTIME/'monthly_reconstruction/projections')]
from asset_history.calibration.path_model import (CareerPool,ResidualPool,summarize,
    path_quotes,feature_vector,evidence_weight,slot_weights,regularize_paths)
from asset_history.calibration.historical import HistoricalPanel,eligible_careers,name_key
from league_player_values import agreements_at


def write_csv(path, rows):
    if not rows:
        return
    with path.open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    runtime=args.runtime;source=args.source;out=args.out
    sys.path.insert(0,str(runtime/'monthly_reconstruction/projections'))
    from expected_contracts import ExpectedContracts
    panel=HistoricalPanel(runtime,source)
    career_rows=json.load((out/'careers.json').open())
    residuals=ResidualPool(json.load((out/'residuals.json').open()))
    summary=json.load((out/'backtest_summary.json').open())
    scale=summary['final_reliability']['scale']
    old_model=json.load((source/'trained_pick_model.json').open())
    old_curve={int(r['pick']):r for r in old_model['pick_curve']}
    agreements=json.load((source/'contract_agreements.json').open())
    agreements += [dict(r,adjustment_only=True,salaries=[]) for r in json.load((source/'contract_adjustments.json').open())]
    cap_rows=list(csv.DictReader((source/'salary_cap_assumptions.csv').open()))
    caps={int(r['year']):(float(r['salary_cap']),float(r['scale_cap'])) for r in cap_rows}
    reporting=164961000.
    caps[2027]=(reporting,caps[2027][1])
    cap=lambda year: caps[2027][0]*1.05**(year-2027)
    budget=lambda year: caps[2027][1]*1.05**(year-2027)
    contract_model=ExpectedContracts(caps)
    contract_model.curve(2026)
    original=eligible_careers(career_rows,2026)
    pick_comparison=[]
    for slot in range(1,61):
        p=np.array([r['production'] for r in original])
        w=slot_weights([r['slot'] for r in original],slot)
        costs=np.array(old_curve[slot]['annual_expected_salary_reporting_dollars'])
        result=summarize(p,costs,w)
        new=max(0,result['mean'])
        pick_comparison.append(dict(pick=slot,old=old_curve[slot]['quote'],candidate=new,
            difference=new-old_curve[slot]['quote'],p10=result['p10'],p50=result['p50'],p90=result['p90'],
            annual_mean_production=result['annual_mean_production'],
            path_selection_premium=result['path_selection_premium'],training_n=len(p)))
    players=[];teams=[];audit=Counter();reconstruction=[]
    for file in sorted(source.glob('???.json')):
        data=json.load(file.open())
        if 'snapshots' not in data:
            continue
        snapshot=data['snapshots'][-1];team=data['team']
        for asset in snapshot['assets']:
            if asset['kind']!='player':
                continue
            details=asset.get('details',{})
            annual=details.get('annual_values',[])
            if not annual or details.get('asset_type')=='dormant_draft_right':
                audit['not_active_four_year_quote']+=1
                continue
            if len(annual) not in (4,5):
                raise ValueError('Unexpected annual window')
            pid=int(asset['id'].split(':')[-1]) if ':nba:' in asset['id'] else None
            key=name_key(asset['name'])
            cohort=int(float(details['draft_year'])) if details.get('draft_year') else None
            slot=int(float(details['draft_slot'])) if details.get('draft_slot') else None
            stage=2026-cohort if cohort is not None else 20
            old_weight=float(details.get('draft_maturity_weight') or 1)
            q=float(details.get('injury_availability_factor') or 0)
            known,complete,agreement=agreements_at(agreements,asset['name'],pid,snapshot['date'],name_key,
                                                   lambda year,cutoff:cap(year))
            signed={int(r['year']):r for r in known}
            e=np.array([r['exposure'] for r in annual])
            baseline=path_quotes([r['production'] for r in annual],
                [(1.8*r['production']-r['asset'])/.8 for r in annual],e)[0]
            if abs(baseline-asset['value'])>1:
                raise ValueError('Published quote did not reconcile')
            mean=[];costs=[];unsigned=[];waiver=[]
            for j,r in enumerate(annual):
                year=r['season'];in_draft=cohort is not None and cohort<year<=cohort+4
                w=old_weight if in_draft else 1.
                availability=q if j==0 else 1.
                pp=old_curve[slot]['peak_production_quote']/4 if in_draft and slot else 0.
                adj=old_curve[slot]['annual_contract_adjustment_reporting_dollars'][year-cohort-1] if in_draft and slot else 0.
                denominator=.8*(1-(1-w)*availability)
                if abs(denominator)>1e-12:
                    c=(1.8*r['production']+(1-w)*availability*(adj-.8*pp)-r['asset'])/denominator
                else:
                    cell=signed.get(year,{})
                    c=float(cell.get('amount') or old_curve[slot]['annual_expected_salary_reporting_dollars'][year-cohort-1])*reporting/cap(year)
                c=max(0,float(c))
                # Recover the option-adjusted NBA mean from the published blend.
                # A fully prior-weighted rookie has no identifiable NBA component;
                # no completed NBA evidence means its new weight is also zero.
                nba=(r['production']-(1-w)*availability*pp)/w if w>0 else 0.
                nba=nba/availability if availability>0 else 0.
                mean.append(float(nba));costs.append(c)
                cell=signed.get(year)
                is_unsigned=cell is None and j>0
                unsigned.append(is_unsigned)
                waiver.append(float(cell['waiver_guaranteed_amount_asof'])*reporting/cap(year)
                    if cell and cell.get('waiver_option_verified') else None)
                # Signed current costs recovered from the quote are authoritative;
                # the new method changes the payoff distribution, not obligations.
            base=panel.by_id.get((2026,pid),{})
            age=float(base.get('age') or 24)
            total=float(details.get('healthy_current_total') or base.get('total') or -3)
            minutes=float(details.get('healthy_forecast_annual_games') or 0)*float(details.get('healthy_forecast_conditional_MPG') or 0)
            experience=float(base.get('yoe') or max(1,stage))
            feature=feature_vector(age,total,minutes,experience)
            nba,nw,meta=residuals.scenarios(mean,feature,2026,True,key)
            nba[:,0]*=q
            nba_cost=np.broadcast_to(costs,nba.shape).copy()
            years=[r['season'] for r in annual]
            def price_continuations(paths, path_cost):
                paths=paths.copy();path_cost=path_cost.copy()
                for j,year in enumerate(years):
                    if unsigned[j]:
                        yos=max(0,experience+year-2026-1)
                        for i in range(len(paths)):
                            salary=contract_model.expected(paths[i,j]*cap(year)/reporting,
                                budget(year),cap(year),yos,2026)[0]
                            path_cost[i,j]=salary*reporting/cap(year)
                        decline=1.8*paths[:,j]-.8*path_cost[:,j]<0
                        paths[decline,j]=0.;path_cost[decline,j]=0.
                    elif waiver[j] is not None:
                        release=1.8*paths[:,j]-.8*path_cost[:,j] < -.8*waiver[j]
                        paths[release,j]=0.;path_cost[release,j]=waiver[j]
                return paths,path_cost
            nba,nba_cost=price_continuations(nba,nba_cost)
            career_minutes=panel.career_minutes(key,pid,cohort,2026) if cohort is not None else 0.
            weight=evidence_weight(career_minutes,scale) if 0<=stage<4 and slot else 1.
            if 0<=stage<4 and slot:
                pool=[r for r in career_rows if r['stage']==stage and r['horizon']>=len(annual)
                      and r['cohort']+stage+len(annual)<=2026 and r['key']!=key]
                if not pool:
                    raise ValueError('No mature same-stage draft paths')
                prior=np.array([r['production'][:len(annual)] for r in pool])
                pw=slot_weights([r['slot'] for r in pool],slot)
                target_payoff=None
                if stage==0 and len(annual)==4:
                    target_payoff=old_curve[slot]['peak_production_quote']+.8*old_curve[slot]['cumulative_production_quote']
                prior,prior_scale=regularize_paths(prior,[r['slot'] for r in pool],slot,pw,e,target_payoff)
                prior[:,0]*=q
                prior,pc=price_continuations(prior,np.broadcast_to(costs,prior.shape).copy())
                paths=np.concatenate([prior,nba]);path_cost=np.concatenate([pc,nba_cost])
                weights=np.concatenate([(1-weight)*pw,weight*nw])
                cw=np.concatenate([(1-old_weight)*pw,old_weight*nw])
                calendar=summarize(paths,path_cost,cw,e)['mean']
            else:
                paths,path_cost,weights=nba,nba_cost,nw
                calendar=summarize(paths,path_cost,weights,e)['mean']
            result=summarize(paths,path_cost,weights,e)
            repriced='source_verified_waiver_option_used' not in details.get('flags','')
            if not repriced:
                # Published option-adjusted means do not identify the raw
                # pre-release forecast. Repricing those would invent upside
                # around a truncated mean. Require the canonical annual export.
                result.update(mean=asset['value'],p10=None,p50=None,p90=None)
                calendar=asset['value']
                audit['retained_pending_unfloored_annual_input']+=1
            young_candidate=result['mean'] if 0<=stage<4 and slot else asset['value']
            players.append(dict(team=team,player=asset['name'],nba_id=pid,draft_year=cohort,
                draft_slot=slot,completed_seasons=stage,old=asset['value'],candidate=result['mean'],
                difference=result['mean']-asset['value'],calendar_path_candidate=calendar,
                young_only_candidate=young_candidate,young_only_difference=young_candidate-asset['value'],
                reliability_effect=result['mean']-calendar,old_nba_weight=old_weight,new_nba_weight=weight,
                completed_career_minutes=career_minutes if cohort is not None else None,p10=result['p10'],p50=result['p50'],p90=result['p90'],
                scenarios=result['scenarios'],contract_schedule_complete=complete,
                current_absence_factor=q))
            players[-1]['repriced']=repriced
            audit['compared_players']+=1
        team_players=[r for r in players if r['team']==team]
        old_p=sum(a['value'] for a in snapshot['assets'] if a['kind']=='player')
        new_p=sum(r['candidate'] for r in team_players)
        omitted=old_p-sum(r['old'] for r in team_players)
        young_difference=sum(r['young_only_difference'] for r in team_players)
        teams.append(dict(team=team,old_player_value=old_p,candidate_player_value=new_p+omitted,
            player_difference=new_p+omitted-old_p,old_pick_value=sum(a['value'] for a in snapshot['assets'] if a['kind']=='pick'),
            old_total=snapshot['total'],young_only_difference=young_difference,
            young_only_total=snapshot['total']+young_difference,players_compared=len(team_players)))
    write_csv(out/'current_players.csv',players)
    write_csv(out/'current_team_player_values.csv',teams)
    write_csv(out/'pick_curve.csv',[{k:v for k,v in r.items() if k!='annual_mean_production'} for r in pick_comparison])
    (out/'current_comparison.json').write_text(json.dumps(dict(players=players,teams=teams,picks=pick_comparison,
        audit=dict(audit),asof='2026-11-01',candidate_only=True,
        caveats=['Forward residuals approximate uncertainty around the published core model.',
            'Learning uses completed NBA minutes; current-season minutes are not added in this prototype.',
            'The learned reliability is evaluated on fixed original rookie-window production, not market trades.',
            'No blanket veteran uplift is approved by the rolling holdout.',
            'Pick curve uses existing expected salary costs; future pick portfolios require the joint allocator.',
            'Signed and verified waiver costs are retained; unsigned costs reprice within each scenario.']),indent=2,allow_nan=False))
    print(json.dumps(dict(audit=dict(audit),total_player_difference=sum(r['player_difference'] for r in teams),
        jazz=[r for r in players if r['team']=='UTA'],picks=[r for r in pick_comparison if r['pick'] in (1,2,5,10,16,20,30,40,50,60)]),indent=2))


if __name__=='__main__':
    main()
