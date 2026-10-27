"""Evaluate source-reviewed contingent entitlements without extra physical picks."""
from pick_allocator import ref, guarded_transfer


def select_entitlement(expr, slots, owners):
    if isinstance(expr, (list, tuple)):
        return ref(expr)
    if not isinstance(expr, dict):
        raise ValueError('Invalid reviewed entitlement selector')
    if 'if_slot_in' in expr:
        c = expr['if_slot_in']
        inside = c['range'][0] <= slots[ref(c['pick'])] <= c['range'][1]
        branch = expr['then'] if inside else expr['else']
        return None if branch is None else select_entitlement(branch, slots, owners)
    if 'held' in expr:
        c = expr['held']
        candidates = [ref(p) for p in c['picks'] if owners[ref(p)] == c['owner']]
        if 'count_range' in c:
            lo, hi = c['count_range']
            if not lo <= len(candidates) <= hi:
                raise ValueError('Held entitlement count outside reviewed bounds')
        index = int(c.get('index', 0))
    elif 'rank' in expr:
        c = expr['rank']
        candidates = [select_entitlement(p, slots, owners) for p in c['picks']]
        candidates = [p for p in candidates if p is not None]
        index = int(c['index'])
    else:
        op = next((k for k in ['best', 'worst', 'best_eligible'] if k in expr), None)
        if op is None:
            raise ValueError('Unsupported reviewed entitlement selector')
        if op == 'best_eligible':
            candidates = [ref(b['pick']) for b in expr[op]
                          if not any(lo <= slots[ref(b['pick'])] <= hi
                                     for lo, hi in b.get('protected_ranges', []))]
        else:
            candidates = [select_entitlement(p, slots, owners) for p in expr[op]]
            candidates = [p for p in candidates if p is not None]
        index = -1 if op == 'worst' else 0
    if not candidates:
        return None
    ordered = sorted(set(candidates), key=lambda p: (slots[p], p))
    if not -len(ordered) <= index < len(ordered):
        raise ValueError('Entitlement rank outside eligible candidate set')
    return ordered[index]


def apply_selected_transfer(owners, slots, rule):
    for c in rule.get('conditions', []):
        inside = c['range'][0] <= slots[ref(c['pick'])] <= c['range'][1]
        if inside != c.get('inside', True):
            return
    chosen = select_entitlement(rule['select'], slots, owners)
    if chosen is None:
        if rule.get('allow_no_selection') is not True:
            raise ValueError('Reviewed selector unexpectedly has no entitlement')
        return
    if any(lo <= slots[chosen] <= hi for lo, hi in rule.get('protected_ranges', [])):
        return
    guarded_transfer(owners, chosen, rule['from_team'], rule['to_team'])


def apply_ranked_transfer(owners, slots, rule):
    held = [ref(p) for p in rule['picks'] if owners[ref(p)] == rule['from_team']]
    if not held:
        raise ValueError('Ranked entitlement transfer has no held candidates')
    if rule['rank'] not in ('best', 'worst'):
        raise ValueError('Invalid entitlement rank')
    chosen = (min if rule['rank'] == 'best' else max)(held, key=lambda p: (slots[p], p))
    if any(lo <= slots[chosen] <= hi for lo, hi in rule.get('protected_ranges', [])):
        return
    guarded_transfer(owners, chosen, rule['from_team'], rule['to_team'])
