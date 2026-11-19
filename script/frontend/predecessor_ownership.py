"""Explicitly reviewed, exact predecessor snapshots; never generate historical rows."""
import copy, hashlib, json
from datetime import date
from pathlib import Path

# Authenticated Nov19 Work recovery, rooted in the retained native runtime.
# Adding a different recovery requires review, not caller-supplied expected hashes.
APPROVED = {
    'nov19-native-calendar-recovery-v1': {
        'baseline_sha256': '20d2d19b5e38a01eb38406184e26082d0ab1f11f4a2b659fb6861e0ec0470086',
        'prior_date': '2026-11-18',
        'prior_checkpoint_sha256': '19b65f6cae2a3f073fff700a1614b3d96d20a7b66e8f118249f85600b51137e7',
        'dates': ['2026-10-31', '2026-11-06', '2026-11-12', '2026-11-14'],
        'asof': '2026-11-19',
    }
}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def digest(row): return sha(json.dumps(row, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
def indexed(rows):
    if not isinstance(rows, list): raise ValueError('Ownership snapshots must be a list')
    out = {}
    for row in rows:
        d = row['cutoff_date']; date.fromisoformat(d)
        if d in out or not isinstance(row.get('roster'), list): raise ValueError('Duplicate or malformed ownership snapshot')
        out[d] = row
    return out

def merge(current, baseline_raw, receipt, asof):
    profile = APPROVED.get(receipt.get('profile'))
    if profile is None or receipt.get('schema') != 'nba-reviewed-predecessor-ownership-v1':
        raise ValueError('Unknown predecessor recovery profile')
    if any(receipt.get(k) != v for k, v in profile.items()) or asof != profile['asof']:
        raise ValueError('Unapproved predecessor digest, dates or prior checkpoint')
    if sha(baseline_raw) != profile['baseline_sha256']:
        raise ValueError('Predecessor baseline hash mismatch')
    prior = date.fromisoformat(profile['prior_date'])
    if prior >= date.fromisoformat(asof): raise ValueError('Prior checkpoint must precede current observation')
    baseline = indexed(json.loads(baseline_raw)); existing = indexed(current)
    if asof not in existing: raise ValueError('Complete current ownership snapshot required')
    out = copy.deepcopy(current); report = []
    for d in profile['dates']:
        if date.fromisoformat(d) > prior or d >= asof or d not in baseline:
            raise ValueError('Unverified predecessor snapshot date')
        row = baseline[d]
        if d in existing:
            if existing[d] != row: raise ValueError('Conflicting predecessor snapshot: ' + d)
            status = 'already_identical'
        else:
            out.append(copy.deepcopy(row)); status = 'inserted_exact_baseline'
        report.append({'date': d, 'status': status, 'snapshot_sha256': digest(row), 'rows': len(row['roster'])})
    # Never replace or reorder any existing snapshot; native consumers index by date.
    if out[:len(current)] != current: raise AssertionError('Existing snapshot changed')
    return out, {'profile': receipt['profile'], **profile, 'snapshots': report,
                 'scope': 'missing-approved-predecessors-only-current-and-existing-rows-unchanged'}

def apply(runtime, receipt_path, asof):
    root = Path(runtime) / 'monthly_reconstruction/league_ownership'
    ledger = root / 'monthly_league_rosters.json'; audit_path = root / 'roster_refresh_source.json'
    receipt_raw = Path(receipt_path).read_bytes(); receipt = json.loads(receipt_raw)
    baseline_path = Path(receipt['baseline_path']).resolve()
    original = ledger.read_bytes()
    result, report = merge(json.loads(original), baseline_path.read_bytes(), receipt, asof)
    report.update(handoff_receipt_sha256=sha(receipt_raw), producer_ledger_sha256=sha(original))
    inserted = any(r['status'] == 'inserted_exact_baseline' for r in report['snapshots'])
    output = (json.dumps(result, indent=2, allow_nan=False) + '\n').encode() if inserted else original
    report['result_ledger_sha256'] = sha(output)
    audit = json.loads(audit_path.read_bytes())
    if audit.get('knowledge_date') != asof: raise ValueError('Wrong producer ownership knowledge date')
    if inserted:
        tmp = ledger.with_suffix('.handoff.tmp'); tmp.write_bytes(output); tmp.replace(ledger)
    # Existing source evidence is retained; this is a separate reviewed supplement.
    audit['reviewed_predecessor_handoff'] = report
    audit_path.write_text(json.dumps(audit, indent=2, allow_nan=False) + '\n')
    return report
