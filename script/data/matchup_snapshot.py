"""Collect public NBA matchups outside the GitHub runner; verify before use.

The snapshot stores original player-pair possessions and game counts. Positions,
opponent scoring rates and all model coefficients are applied by the normal job.
No provider credential or proxy is needed.
"""
import argparse, base64, gzip, hashlib, json, math
from datetime import datetime, timezone
from pathlib import Path
from nba_transport import nba_table

FIELDS = ('SEASON_ID','DEF_PLAYER_ID','OFF_PLAYER_ID','GP','PARTIAL_POSS')
SOURCE = 'https://stats.nba.com/stats/leagueseasonmatchups'
MAX_BYTES = 40_000_000

def validate_rows(rows, season):
    expected = '2'+str(season-1)
    seen = set(); defenders = set()
    if not isinstance(rows,list) or not 100 <= len(rows) <= 500000:
        raise ValueError('Incomplete matchup snapshot')
    for r in rows:
        if str(r.get('SEASON_ID')) != expected: raise ValueError('Snapshot row season mismatch')
        defender,offender = int(r['DEF_PLAYER_ID']),int(r['OFF_PLAYER_ID'])
        gp,poss = float(r['GP']),float(r['PARTIAL_POSS'])
        if defender <= 0 or offender <= 0 or not gp.is_integer() or gp < 1 or not math.isfinite(poss) or poss < 0:
            raise ValueError('Invalid matchup snapshot row')
        if (defender,offender) in seen: raise ValueError('Duplicate matchup snapshot pair')
        seen.add((defender,offender));defenders.add(defender)
    if len(defenders) < 100: raise ValueError('Incomplete snapshot defender coverage')

def make_snapshot(rows, params, season, requests=None, now=None):
    label = f'{season-1}-{str(season)[-2:]}'
    if params.get('SeasonYear',params.get('Season')) != label or params.get('SeasonType') != 'Regular Season':
        raise ValueError('Snapshot response season mismatch')
    validate_rows(rows,season)
    compact = [[r[k] for k in FIELDS] for r in rows]
    body = json.dumps(compact,separators=(',',':'),allow_nan=False).encode()
    return dict(schema_version=1,season=season,generated_at=(now or datetime.now(timezone.utc)).isoformat(),
        source=SOURCE,parameters=params,matchup_rows=len(rows),defenders=len({r['DEF_PLAYER_ID'] for r in rows}),
        fields=list(FIELDS),encoding='gzip+base64',sha256=hashlib.sha256(body).hexdigest(),
        rows_gzip_base64=base64.b64encode(gzip.compress(body,mtime=0)).decode(),requests=requests or [])

def read_snapshot(path, season, now=None, max_age_hours=6):
    data = json.loads(Path(path).read_text())
    if data.get('schema_version') != 1 or data.get('season') != season or data.get('source') != SOURCE:
        raise ValueError('Wrong matchup snapshot source, schema or season')
    label=f'{season-1}-{str(season)[-2:]}'
    params=data.get('parameters',{})
    if params.get('SeasonYear',params.get('Season'))!=label or params.get('SeasonType')!='Regular Season':
        raise ValueError('Wrong matchup snapshot response parameters')
    fetched = datetime.fromisoformat(data['generated_at'].replace('Z','+00:00'))
    if fetched.tzinfo is None: raise ValueError('Snapshot timestamp lacks timezone')
    age = ((now or datetime.now(timezone.utc))-fetched).total_seconds()
    if not -300 <= age <= max_age_hours*3600: raise ValueError('Stale matchup snapshot')
    if data.get('fields') != list(FIELDS) or data.get('encoding') != 'gzip+base64':
        raise ValueError('Wrong matchup snapshot layout')
    compressed = base64.b64decode(data['rows_gzip_base64'],validate=True)
    # Bound the decompressed size before parsing data from an external process.
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:body=stream.read(MAX_BYTES+1)
    if len(body)>MAX_BYTES or hashlib.sha256(body).hexdigest()!=data['sha256']:
        raise ValueError('Corrupted matchup snapshot')
    compact=json.loads(body)
    if not isinstance(compact,list) or any(not isinstance(r,list) or len(r)!=len(FIELDS) for r in compact):
        raise ValueError('Malformed matchup snapshot rows')
    rows=[dict(zip(FIELDS,r)) for r in compact]
    if len(rows)!=data['matchup_rows']: raise ValueError('Snapshot row count mismatch')
    validate_rows(rows,season)
    return rows,data

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',type=int,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();season=args.season;label=f'{season-1}-{str(season)[-2:]}'
    audit=[]
    rows,params=nba_table('leagueseasonmatchups',dict(LeagueID='00',Season=label,SeasonType='Regular Season',
        PerMode='Totals',DefTeamID='',OffTeamID='',DefPlayerID='',OffPlayerID=''),'SeasonMatchups',audit)
    data=make_snapshot(rows,params,season,audit)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temp=args.output.with_suffix('.tmp');temp.write_text(json.dumps(data,separators=(',',':'))+'\n');temp.replace(args.output)
    read_snapshot(args.output,season)
    print(json.dumps({k:data[k] for k in ('season','generated_at','matchup_rows','defenders','sha256')}),flush=True)

if __name__=='__main__':main()
