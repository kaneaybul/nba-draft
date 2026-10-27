"""One reviewed no-effect fingerprint migration for the MIN lookup guard.

This is not a general model-state migration. It reconstructs the exact prior
adapter source, proves unchanged rotation selection for every other team, and
accepts no difference in any other model source digest.
"""
import argparse,hashlib,json
from pathlib import Path
from live_runtime import fingerprint
from league_player_values import TEAMS

def migrate(runtime,state,output):
    source=Path(__file__).with_name('league_player_values.py').read_text()
    current="baseline=next((r for r in first[1]['ratings']if r['team_alias']==team and r.get('players_window')),None)"
    previous="baseline=next((r for r in first[1]['ratings']if r['team_alias']==team),None)"
    if source.count(current)!=1:raise ValueError('Reviewed rotation source edit no longer matches exactly')
    old_sha=hashlib.sha256(source.replace(current,previous).encode()).hexdigest()
    expected=fingerprint(runtime)
    rows=json.loads((runtime/'monthly_reconstruction/pick_forecasts/raw/dunks_ratings_2022-01-01.json').read_text())[1]['ratings']
    proof=[]
    for team in TEAMS:
        if team=='MIN':continue
        old=next((r for r in rows if r['team_alias']==team),None)
        new=next((r for r in rows if r['team_alias']==team and r.get('players_window')),None)
        if old!=new:raise ValueError('Rotation selection changed for another team: '+team)
        proof.append({'team':team,'equal':True,'selection':'public_rotation'if new else'career_and_provider_fallback'})
    changed=[];already_current=[]
    for team in TEAMS:
        path=state/f'{team}.json'
        if not path.exists():continue
        saved=json.loads(path.read_text());hashes=saved['model_source_hashes']
        if hashes==expected:already_current.append(team);continue
        if team=='MIN':raise ValueError('Minnesota must be recomputed, never migrated')
        differences={k for k in set(hashes)|set(expected)if hashes.get(k)!=expected.get(k)}
        if differences!={'league_player_values.py'}or hashes['league_player_values.py']!=old_sha:
            raise ValueError('State includes another/unreviewed source change: '+team)
        saved['model_source_hashes']=expected
        temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(saved,allow_nan=False));temporary.replace(path)
        changed.append(team)
    audit={'scope':'Reviewed no-effect source-equivalence migration; Minnesota recomputed separately',
      'old_adapter_sha256':old_sha,'new_adapter_sha256':expected['league_player_values.py'],
      'all_other_source_digests_identical':True,'rotation_selection_proof':proof,
      'migrated_teams':changed,'already_current_teams':already_current}
    output.write_text(json.dumps(audit,indent=2));return audit

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--runtime',type=Path,required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(migrate(a.runtime.resolve(),a.state,a.output)))
