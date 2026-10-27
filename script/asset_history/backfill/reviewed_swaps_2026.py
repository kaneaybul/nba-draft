"""Evaluate dated swaps of nested legal entitlements, preserving every owner."""
from reviewed_transfer_helpers import select_entitlement
from pick_allocator import ref


def apply_selected_swap(owners, slots, rule):
    for c in rule.get('conditions', []):
        inside = c['range'][0] <= slots[ref(c['pick'])] <= c['range'][1]
        if inside != c.get('inside', True):
            return
    left = select_entitlement(rule['left_select'], slots, owners)
    right = select_entitlement(rule['right_select'], slots, owners)
    if left is None or right is None:
        if rule.get('allow_no_selection'):
            return
        raise ValueError('Reviewed swap unexpectedly has no selected entitlement')
    if left == right:
        raise ValueError('Selected swap repeats one physical pick')
    if any(lo <= slots[right] <= hi for lo, hi in rule.get('protected_ranges', [])):
        return
    if owners[left] != rule['left_owner'] or owners[right] != rule['right_owner']:
        raise ValueError('Selected swap legal owner mismatch')
    if slots[right] < slots[left]:
        owners[left], owners[right] = owners[right], owners[left]
