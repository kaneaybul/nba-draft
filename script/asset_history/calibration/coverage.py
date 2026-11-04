"""Recognize documented unavailable endpoint inputs without inventing grades."""
from .historical import name_key

def documented_missing_endpoint(player,grade,excluded):
    if grade.get('status')!='unavailable' or grade.get('reason')!='Missing completed endpoint rating':return False
    return any(r['key']==name_key(player) and r['reason']=='endpoint service without rating'for r in excluded)

def documented_unobserved_endpoint(asset_id,day,grade,final_assessments):
    """A later acquisition cannot manufacture a past year-four assessment."""
    endpoint=grade.get('endpoint','')
    return (grade.get('status')=='unavailable' and
            grade.get('reason')=='No shared year-four assessment in the observed history' and
            bool(endpoint) and day>endpoint and
            (asset_id,endpoint)not in final_assessments and
            'value'not in grade and 'gain'not in grade)

