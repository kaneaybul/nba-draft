"""Turn canonical annual paths into daily four-season asset observations.

This deliberately accepts final annual paths from the shared projection engine,
not the app's differently aggregated trade_value. That keeps draft confidence,
unsigned continuation and injury adjustments in the existing projection layer.
No missing year is supplied from a newer observation.
"""
from __future__ import annotations
from datetime import date, timedelta
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from quote_window import quote_window

SCALE=.8

def common_source_cutoff(epm_pregame_day,darko_pregame_day):
    """Provider pregame dates contain evidence only through the preceding day.

    Reject mismatched vintages rather than relabel a newer forecast as old.
    """
    if epm_pregame_day!=darko_pregame_day:raise ValueError('Provider source dates do not share a cutoff')
    return (date.fromisoformat(epm_pregame_day)-timedelta(days=1)).isoformat()

def rolling_exposures(cutoff,season,team_regular_dates):
    """Exactly four team-season equivalents starting after the cutoff."""
    cutoff=date.fromisoformat(cutoff)
    dates=sorted(set(date.fromisoformat(d)for d in team_regular_dates))
    if len(dates)!=82:raise ValueError('A complete 82-game current team schedule is required')
    remaining=sum(d>cutoff for d in dates)/82
    out=[]
    for yy,e in [(season,remaining),(season+1,1.),(season+2,1.),(season+3,1.),(season+4,1-remaining)]:
        if e>1e-12:out.append((yy,e))
    assert abs(sum(e for _,e in out)-4)<1e-9
    return out

def from_final_annual_path(cutoff,rows,exposures,reporting_cap):
    """Final annual production and asset rates match integrate_monthly exports.

    annual_asset must already implement signed .8 salary adjustments, optional
    unsigned continuation, and separately weighted draft-prior adjustment.
    It cannot be reconstructed from raw salary after those transformations.
    """
    byyear={int(r['season']):r for r in rows}
    if len(byyear)!=len(rows):raise ValueError('Duplicate annual season')
    production=[];assets=[];ex=[]
    for yy,e in exposures:
        r=byyear.get(yy)
        if r is None:raise ValueError(f'Missing annual path {yy}')
        if r['source_cutoff']!=cutoff:raise ValueError('Annual source cutoff differs from observation')
        if r['method']!='peak4-payroll-0.8-v1':raise ValueError('Valuation method mismatch')
        for k in ('production','asset','salary_cap'):
            if not isinstance(r.get(k),(int,float))or not math.isfinite(r[k]):raise ValueError('Missing/nonfinite annual '+k)
        if r['salary_cap']<=0:raise ValueError('Invalid cap')
        production.append(r['production']/r['salary_cap']*reporting_cap)
        assets.append(r['asset']/r['salary_cap']*reporting_cap)
        ex.append(e)
    result=quote_window(production,assets,ex)
    if result['quote']is None:raise ValueError('Incomplete annual quote')
    return result
