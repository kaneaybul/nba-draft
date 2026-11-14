"""Reconstructed from verified tool history after workspace loss.
Pure adapter only. NOT wired to a complete runtime or a production release.
"""
from copy import deepcopy
from datetime import date
from math import isfinite

def handoff(cache, *, checkpoint_day, refresh_day, previous_owner, receiving_owner,
            owner_clock, model_hashes, expected_model_hashes):
    start,end=map(date.fromisoformat,(checkpoint_day,refresh_day))
    if end<start:raise ValueError('Cannot hand off from a future checkpoint')
    if model_hashes!=expected_model_hashes:raise ValueError('Model version mismatch')
    if not previous_owner or not receiving_owner:raise ValueError('Verified ownership required')
    old_checkpoint=float(owner_clock(previous_owner,checkpoint_day))
    old_now=float(owner_clock(previous_owner,refresh_day))
    new_now=float(owner_clock(receiving_owner,refresh_day))
    if not all(map(isfinite,(old_checkpoint,old_now,new_now))):raise ValueError('Missing finite clocks')
    if old_now<old_checkpoint or cache['clock']>old_checkpoint:raise ValueError('Nonmonotone or future checkpoint clock')
    path=cache['path'];expected=path.at(old_now);delta=new_now-old_now
    shifted=deepcopy(cache)
    shifted['path']=type(path)(tuple((x+delta,y) for x,y in path.knots))
    shifted['clock']=cache['clock']+delta
    return shifted,dict(previous_owner=previous_owner,receiving_owner=receiving_owner,
        checkpoint_day=checkpoint_day,refresh_day=refresh_day,clock_translation=delta,
        old_owner_clock=old_now,new_owner_clock=new_now,expected_current_impact=expected)

def prepare_team_cache(local_cache, *, receiving_owner, current_player_ids,
                       verified_previous_owners, frozen_owner_caches, **kwargs):
    out=deepcopy(local_cache);audit=[]
    for identity in current_player_ids:
        if identity not in verified_previous_owners:raise ValueError(f'No verified prior owner for {identity}; classify first-seen separately')
        owner=verified_previous_owners[identity];prior=frozen_owner_caches[owner].get(identity)
        if prior is None:raise ValueError(f'Missing authoritative impact state for {identity}')
        moved,record=handoff(prior,previous_owner=owner,receiving_owner=receiving_owner,**kwargs)
        out[identity]=moved;audit.append(dict(identity=identity,**record))
    return out,audit
