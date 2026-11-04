"""One shared padded player price and its frozen year-four draft result."""
from __future__ import annotations
import copy,math

STOCK_POLICY='year-four-endpoint-picks-shared-players-v4'

def active(details):
    return details.get('endpoint_stock_policy')==STOCK_POLICY

def promote(details,value,day):
    grade=details.get('draft_development')
    if not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return value
    production=float(details['peak_production'])
    financial=float(details['contract_adjustment'])
    if not all(math.isfinite(x)for x in (production,financial,value)):
        raise ValueError('Shared development value needs finite components')
    if abs(value-production-financial)>.05:
        raise ValueError('Shared player stock does not reconcile')
    grade.update(value=production,gain=production-float(grade['original_expectation']),
                 valuation_basis='shared padded player production',contract_effect=0.)
    details['endpoint_stock_policy']=STOCK_POLICY
    details.pop('development_window_basis',None)
    return value

def promote_quote(quote,grade,day):
    if not quote or quote.get('status')!='priced' or not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return quote
    q=dict(quote,endpoint_stock_policy=STOCK_POLICY)
    q.pop('development_window_basis',None)
    return q

def promote_asset(asset,day):
    d=asset.get('details',{})
    if not d.get('draft_development'):return asset
    d.setdefault('peak_production',float(d.get('app_style_four_year_peak_production_quote',asset['value'])))
    d.setdefault('contract_adjustment',float(d.get('app_style_four_year_contract_adjustment_sum',asset['value']-d['peak_production'])))
    asset['value']=promote(d,asset['value'],day)
    if active(d) and d.get('path_calibration',{}).get('status')=='priced':
        d['path_calibration']=promote_quote(d['path_calibration'],d['draft_development'],day)
    return asset

def freeze_draft_results(snapshots,saved=None):
    """Freeze shared production at Y4; later player prices keep moving.

    Save globally by player identity so transfers do not reset an assessment.
    The small checkpoint also preserves the final grade during daily refreshes
    which export only today's observations instead of the complete history.
    """
    saved=copy.deepcopy(saved or {})
    for snapshot in sorted(snapshots,key=lambda row:row['date']):
        day=snapshot['date']
        for asset in snapshot['assets']:
            grade=asset.get('details',{}).get('draft_development')
            if not grade or grade.get('status')!='priced':continue
            key=asset['id']+'|'+grade['endpoint']
            if day<=grade['endpoint']:
                promote_asset(asset,day)
                if grade.get('completed') or day==grade['endpoint']:
                    saved[key]=dict(grade,assessment_date=day,completed=True)
                    asset['details']['draft_development']=copy.deepcopy(saved[key])
            elif key in saved:
                asset['details']['draft_development']=copy.deepcopy(saved[key])
            else:
                asset['details']['draft_development']=dict(status='unavailable',
                    reason='No shared year-four assessment in the observed history')
    return saved
