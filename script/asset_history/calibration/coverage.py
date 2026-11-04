"""Recognize documented unavailable endpoint inputs without inventing grades."""
from .historical import name_key

def documented_missing_endpoint(player,grade,excluded):
    if grade.get('status')!='unavailable' or grade.get('reason')!='Missing completed endpoint rating':return False
    return any(r['key']==name_key(player) and r['reason']=='endpoint service without rating'for r in excluded)
