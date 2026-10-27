"""Common four-year stock target, with exact fractional-season selection.

The developed-production quote is four times the mean of the best two
season-equivalents. Every annual contract adjustment remains additive.
Inputs must already be in common cap-normalized dollars. Missing years are
never imputed as zero, and a short partial year cannot count as a whole year.
"""
from __future__ import annotations
import math


def select_best_two(rates, exposures):
    """Return selected exposure for each annual rate, or None if incomplete."""
    if len(rates) != len(exposures):
        raise ValueError('annual rate/exposure lengths differ')
    if any(not math.isfinite(float(e)) or e <= 0 or e > 1+1e-9 for e in exposures):
        raise ValueError('exposure must be in (0,1]')
    if not math.isclose(sum(exposures), 4., abs_tol=1e-8):
        raise ValueError('quote requires exactly four season-equivalents')
    if any(v is None or not math.isfinite(float(v)) for v in rates):
        return None
    chosen=[0.]*len(rates)
    left=2.
    for i in sorted(range(len(rates)),key=lambda i:(-rates[i],i)):
        take=min(exposures[i],max(0.,left))
        chosen[i]=take
        left-=take
    if not math.isclose(sum(chosen),2.,abs_tol=1e-8):
        raise AssertionError('peak selector failed to integrate two seasons')
    return chosen


def quote_window(production, assets, exposures):
    """Q=peak4(production)+sum(asset-production), plus audit comparisons."""
    chosen=select_best_two(production,exposures)
    pure_chosen=select_best_two(assets,exposures)
    if chosen is None or pure_chosen is None:
        return {'quote':None,'annual_sum':None,'pure_peak_asset':None,
                'production_quote':None,'contract_adjustment_sum':None,
                'selected_exposure':None,'pure_asset_selected_exposure':None}
    prod_quote=2*sum(v*e for v,e in zip(production,chosen))
    adjustment=sum((a-v)*e for a,v,e in zip(assets,production,exposures))
    return {'quote':prod_quote+adjustment,
            'annual_sum':sum(a*e for a,e in zip(assets,exposures)),
            'pure_peak_asset':2*sum(a*e for a,e in zip(assets,pure_chosen)),
            'production_quote':prod_quote,'contract_adjustment_sum':adjustment,
            'selected_exposure':chosen,'pure_asset_selected_exposure':pure_chosen}
