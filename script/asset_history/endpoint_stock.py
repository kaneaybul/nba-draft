"""Year-four production stock; daily salary effects remain a separate ledger.

Only supported endpoint grades are promoted. Older archived cohorts retain
legacy pricing. No endpoint error is added on top of a rolling stock change.
"""
from __future__ import annotations
import math

STOCK_POLICY='year-four-endpoint-stock-v2'

def active(details):
    return details.get('endpoint_stock_policy')==STOCK_POLICY

def promote(details,value,day):
    grade=details.get('draft_development')
    if not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return value
    endpoint=float(grade['value']);rolling=float(details['peak_production'])
    financial=float(details['contract_adjustment'])
    if not all(math.isfinite(x)for x in (endpoint,rolling,financial,value)):
        raise ValueError('Endpoint stock needs complete finite components')
    if abs(value-rolling-financial)>.05:raise ValueError('Old stock does not reconcile')
    details['rolling_production_quote']=rolling
    details['endpoint_stock_policy']=STOCK_POLICY
    details['peak_production']=endpoint
    details['app_style_four_year_peak_production_quote']=endpoint
    # This named valuation basis is observable, not a waterfall residual.
    details['development_window_basis']=rolling-endpoint
    return endpoint+financial

def promote_quote(quote,grade,day):
    """Use the SAME grade mean in live quotes and historical publications."""
    if not quote or quote.get('status')!='priced' or not grade or grade.get('status')!='priced' or day>grade['endpoint']:
        return quote
    q=dict(quote);old=float(q['production_quote']);endpoint=float(grade['value'])
    shift=endpoint-old
    q.update(rolling_production_quote=old,endpoint_stock_policy=STOCK_POLICY,
             development_window_basis=old-endpoint,production_quote=endpoint,
             mean=endpoint+q['contract_adjustment_sum'])
    q['rolling_uncertainty']={key:q.pop(key)for key in ('p10','p50','p90')if key in q}
    return q
