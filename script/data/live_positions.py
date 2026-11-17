"""Shared daily positions for the app, matchup opponents and perimeter controls.

PBP Stats supplies the five-player lineups; the position shares are inferred.
ESPN and saved positions cover players with no current lineup evidence.
"""
import csv, json, math, re, unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

POSITIONS = ('PG', 'SG', 'SF', 'PF', 'C')
SHARES = ('pg_share', 'sg_share', 'sf_share', 'pf_share', 'c_share')

def name_key(value):
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    value = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', value)
    return re.sub('[^a-z0-9]', '', value)

def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default

def position_parts(value):
    return [p for p in re.split(r'[-/\s]+', str(value).upper()) if p in POSITIONS]

def normalized_shares(row):
    try:
        values = [float(row.get(k) or 0) for k in SHARES]
    except (ValueError, TypeError):
        return None
    if any(not math.isfinite(v) or v < 0 for v in values) or sum(values) <= 0:
        return None
    return [v / sum(values) for v in values]

def label_shares(values):
    order = sorted(range(5), key=lambda i: -values[i])
    a, b = order[:2]
    return POSITIONS[a] if values[a] >= .65 or values[b] < .20 else POSITIONS[a]+'/'+POSITIONS[b]

def shares_from_label(value):
    parts = position_parts(value)
    return [float(p in parts)/len(parts) for p in POSITIONS] if parts else None

def build_positions(stats, season, root):
    root = Path(root)
    registry = read_json(root/'raw/live/player_pool.json', {})
    if registry and registry.get('season') != season:
        raise ValueError('Position registry season mismatch')
    published = read_json(root/f'frontend/public/data/v2/impact_players/{season}.json', [])
    records = {p['app_nba_id']: dict(p) for p in registry.get('players', [])}
    by_canonical = {p['nba_id']: p for p in records.values() if p.get('nba_id') is not None}
    by_name = defaultdict(list)
    for p in records.values(): by_name[name_key(p['player_name'])].append(p)
    for p in stats:
        pid = int(p['nba_id'])
        if pid not in by_canonical:
            candidates = by_name[name_key(p['player_name'])]
            if len(candidates) == 1 and candidates[0].get('nba_id') is None:
                record = candidates[0]; record['nba_id'] = pid
            else:
                record = dict(app_nba_id=pid, nba_id=pid, player_name=p['player_name'])
                records[pid] = record
            by_canonical[pid] = record
    stat_by_id = {int(p['nba_id']): p for p in stats}
    old_by_id = {p['nba_id']: p for p in published}
    pbp = {}
    path = root/'raw/live/pbp_position_estimates.csv'
    if path.exists():
        with path.open() as f:
            for p in csv.DictReader(f):
                if int(p['year']) != season:
                    raise ValueError('PBP position season mismatch')
                pid = int(p['nba_id'])
                values = normalized_shares(p)
                if pid < 1 or pid in pbp or values is None:
                    raise ValueError('Invalid or duplicate NBA id in PBP position estimates')
                pbp[pid] = values
    rows = []
    for app_id, record in records.items():
        pid = record.get('nba_id')
        stat = stat_by_id.get(pid, {})
        old = old_by_id.get(app_id, {})
        values = pbp.get(pid)
        source = 'pbpstats_lineup' if values is not None else None
        # Preserve a precise daily roster label; generic G/F labels do not
        # overwrite a precise current-stat or previously published position.
        for label, origin in [(record.get('position'), 'espn_roster'),
                              (stat.get('Pos2'), 'databallr')]:
            if values is None:
                values = shares_from_label(label)
                if values: source = origin
        if values is None:
            values = normalized_shares(old) or shares_from_label(old.get('position'))
            if values: source = 'published_position'
        if values is None:
            generic = str(record.get('position') or stat.get('Pos2') or '').upper()
            if generic in ('G', 'F'):
                values = [.5, .5, 0, 0, 0] if generic == 'G' else [0, 0, .5, .5, 0]
                source = 'roster_group'
        label = label_shares(values) if values else 'UNK'
        row = dict(app_nba_id=app_id, nba_id=pid, player_name=record['player_name'],
                   position=label, source=source or 'unknown',
                   primary_position=POSITIONS[max(range(5), key=lambda i: values[i])] if values else 'UNK')
        row.update(dict(zip(SHARES, values or [0]*5)))
        rows.append(row)
    return dict(schema_version=1, season=season, generated_at=datetime.now(timezone.utc).isoformat(),
                method='PBP Stats five-man lineup seconds with inferred position shares; daily ESPN roster, current stats and published-position fallbacks.',
                sources=dict(Counter(p['source'] for p in rows)), players=rows,
                position_status=read_json(root/'raw/live/position_status.json', {}))

def enrich_stats_positions(stats, positions):
    lookup = {p['nba_id']: p for p in positions['players'] if p.get('nba_id') is not None}
    for row in stats:
        p = lookup.get(int(row['nba_id']))
        if p and p['position'] != 'UNK':
            row['Pos2'] = p['primary_position']
            row['position_source'] = p['source']

def matchup_position(value):
    parts = position_parts(value)
    first = parts[0] if parts else str(value).upper()
    return {'PG':'G', 'SG':'G', 'SF':'F', 'PF':'F', 'C':'C', 'G':'G', 'F':'F'}.get(first)
