"""Same-date recurring companion release preparation. No upload or deployment."""
import argparse
import json
from pathlib import Path
from assemble import VERSION, build, binding, enc, need, rd, sha, pin
from build_index import build as build_index

def sign(p):
    p = Path(p).resolve(strict=True)
    return {'path': str(p), 'sha256': sha(p.read_bytes())}

def read(bound):
    return json.loads(binding(bound))

def finish(c, out):
    d, y = c['asof'], c['season']
    bindings = c['inputs']
    ledger_bind = bindings['resolved_ledger']
    ledger = ledger_bind['sha256']
    binding(ledger_bind)
    ledger_receipt = read(bindings['ledger_receipt'])
    scope = read(bindings['scope'])
    native = read(bindings['native_source'])
    priced = read(bindings['priced'])
    control = read(bindings['same_date_control'])
    legacy = read(bindings['legacy_assembly'])
    r = read(bindings['r_receipt'])
    sources = read(bindings['source_collection'])
    service = read(bindings['service'])
    need(all(z['asof'] == d for z in (ledger_receipt, scope, native, priced, r, sources, legacy, service)), 'Mixed observation dates')
    need(ledger_receipt['schema'] == 'nba-shared-daily-resolved-v1' and ledger_receipt['outputs']['resolved.csv'] == ledger, 'Wrong allocator receipt')
    need(ledger_receipt['outputs']['service.json'] == bindings['service']['sha256'], 'Wrong career service input')
    need(sources['source_checks_pass'] is True and sources['provider_commands_run'] == 8 and sources['protected_bytes_unchanged'] is True and sources['season'] == y, 'Missing exact source collection')
    ledger_inputs = ledger_receipt['inputs']
    def signature(x): return x['sha256'] if isinstance(x,dict) else x
    need(signature(ledger_inputs['collector_receipt']) == bindings['source_collection']['sha256'], 'Allocator source not identical')
    allocation_scope = read(bindings.get('allocator_scope',bindings['scope']))
    need(signature(ledger_inputs['scope']) == bindings.get('allocator_scope',bindings['scope'])['sha256'] and allocation_scope['asof'] == d and allocation_scope['season'] == y, 'Wrong allocator scope')
    def model_scope(o):
        return {i:(z['team'],z['team_game_clock'],tuple(z['appraisal_seasons']),bool(z.get('contract_pending',z.get('asset_type') in ('contract_pending','confirmed_pending_explicitly_unpriced')))) for i,z in o['players'].items()}
    need(model_scope(allocation_scope) == model_scope(scope), 'Native and allocator player/team/clock/pending/appraisal scope disagree')
    need(legacy['production'] is False and legacy['candidate_index_sha256'] == bindings['same_date_control']['sha256'], 'Same-date legacy control not derived by the isolated assembler')
    need(priced['native_receipt_sha256'] == bindings['native_source']['sha256'] and native['ledger_sha256'] == r['inputs']['ledger'] == ledger, 'The consumers did not use the same ledger')
    need(native['players'] == len(priced['players']) and native['endpoint_annual_cells'] == sum(len(scope['players'][i]['appraisal_seasons']) for i in priced['players']), 'Pricing coverage differs from the signed scope')
    names = {'impact_players': f'impact_players_{y}.json', **{k: k+'.json' for k in ('team_projections','team_schedules','team_lineups','picks')}, 'pick_proof': 'picks.proof.json'}
    for label, filename in names.items():
        binding(bindings[label])
        need(r['outputs'][filename] == bindings[label]['sha256'], 'R consumer bytes changed: '+filename)
    picks, pick_proof = read(bindings['picks']), read(bindings['pick_proof'])
    need(pick_proof['asof'] == d and pick_proof['inputs']['team_projections']['sha256'] == bindings['team_projections']['sha256'] and pick_proof['pick_packet_sha256'] == bindings['picks']['sha256'], 'Picks do not use these team projections')
    idx, names, counts = build_index(control, priced, picks, pick_proof, scope, ledger, bindings['native_source']['sha256'], c['generated_at'])
    for row in read(bindings['impact_players']):
        key = str(row.get('source_nba_id') or row['nba_id'])
        if key in names and not names[key]:
            names[key] = row['player_name']
    need(all(names.values()), 'Missing names for signed players')
    rec = out.with_name(out.name+'-receipts')
    need(not rec.exists() and not out.exists(), 'Fresh output and receipt paths required')
    rec.mkdir(parents=True)
    i = rec/'asset_valuation.json'
    i.write_bytes(enc(idx))
    packet = {k: bindings[k] for k in ('impact_players','team_projections','team_schedules','team_lineups')}
    packet['asset_index'] = sign(i)
    proof = rec/'consumer_receipt.json'
    proof.write_bytes(enc(dict(asof=d, ledger_sha256=ledger, forecast_version=VERSION, outputs_sha256={k:v['sha256'] for k,v in packet.items()}, inputs=bindings, inventory_counts=counts, production_ready=False)))
    a = {**c['overlay'], 'asof': d, 'season': y, 'generated_at': c['generated_at'], 'ledger_receipt': bindings['ledger_receipt'], 'ledger_sha256': ledger, 'same_date_control': bindings['same_date_control'], 'consumer_receipt': sign(proof), 'inputs': packet, 'scope': bindings['scope'], 'names': names}
    (rec/'input_config.json').write_bytes(enc(a))
    return build(a, out)

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('config', type=Path)
    p.add_argument('sha256')
    p.add_argument('out', type=Path)
    a=p.parse_args()
    print(json.dumps(finish(json.loads(pin(a.config, a.sha256)), a.out), indent=2))
