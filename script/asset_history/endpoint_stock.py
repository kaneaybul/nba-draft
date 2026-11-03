"""Keep daily rolling stock and fixed-endpoint draft appraisal distinct.

The named basis is rolling production minus endpoint production. Attribution
can split their changes exactly; publication never substitutes the appraisal
for the price of the rolling service claim.
"""
from __future__ import annotations
import math
STOCK_POLICY='year-four-endpoint-picks-rolling-players-v3'

def active(details):
    return details.get('endpoint_stock_policy')==STOCK_POLICY

def promote(details,value,day):
    grade=details.get('draft_development')
    if not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return value
    endpoint=float(grade['value']);rolling=float(details['peak_production'])
    financial=float(details['contract_adjustment'])
    if not all(math.isfinite(x)for x in (endpoint,rolling,financial,value)):
        raise ValueError('Rolling stock and endpoint appraisal need finite components')
    if abs(value-rolling-financial)>.05:raise ValueError('Rolling stock does not reconcile')
    details.update(rolling_production_quote=rolling,endpoint_stock_policy=STOCK_POLICY,
                   development_window_basis=rolling-endpoint)
    return value

def promote_quote(quote,grade,day):
    if not quote or quote.get('status')!='priced' or not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return quote
    q=dict(quote)
    q.update(rolling_production_quote=q['production_quote'],endpoint_stock_policy=STOCK_POLICY,
             development_window_basis=float(q['production_quote'])-float(grade['value']))
    return q

def promote_asset(asset,day):
    d=asset.get('details',{})
    if active(d):return asset
    if not d.get('draft_development'):return asset
    d.setdefault('peak_production',float(d.get('app_style_four_year_peak_production_quote',asset['value'])))
    d.setdefault('contract_adjustment',float(d.get('app_style_four_year_contract_adjustment_sum',asset['value']-d['peak_production'])))
    asset['value']=promote(d,asset['value'],day)
    if active(d) and d.get('path_calibration',{}).get('status')=='priced':
        d['path_calibration']=promote_quote(d['path_calibration'],d['draft_development'],day)
    return asset
