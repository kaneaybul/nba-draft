"""Release the draft prior as completed NBA seasons supply player evidence."""
import math

LEGACY_RULE='maturity=clamp((completed_draft-1)/3,0,1) if draft else 1.'
CURRENT_RULE='maturity=_draft_nba_weight(completed_draft) if draft else 1.'

def nba_forecast_weight(completed_seasons):
    seasons=float(completed_seasons)
    if not math.isfinite(seasons):raise ValueError('Completed NBA seasons must be finite')
    return max(0.,min(1.,seasons/3.))

def rewrite_rule(source):
    if source.count(LEGACY_RULE)==1:return source.replace(LEGACY_RULE,CURRENT_RULE)
    if 'completed_draft' in source:raise ValueError('Canonical draft-prior rule requires review')
    return source
