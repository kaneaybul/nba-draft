"""Identity only: optional current NBA directory lookup, never ownership or terms.

The existing signed-transaction replay remains mandatory. A failed lookup does
not invent identity or fail an otherwise complete refresh; unresolved signed
moves continue to hit the existing ownership guard.
"""
import copy
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from urllib.request import Request, urlopen

URL = 'https://www.nba.com/players'
TEAMS = set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())
MAX_BYTES = 4_000_000

def key(name):
    # Deliberately retain Jr/Sr/II etc: never merge different people by suffix.
    text = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode()
    return re.sub('[^a-z0-9]', '', text.lower())

def fetch_directory():
    with urlopen(Request(URL, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html'}), timeout=12) as response:
        if response.geturl().rstrip('/') != URL:
            raise ValueError('Unexpected official directory redirect')
        if int(response.headers.get('Age', '0')) > 86400:
            raise ValueError('Stale official directory cache')
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('Official directory oversized')
    return body

def parse_directory(body, season):
    if not isinstance(body, bytes) or len(body) > MAX_BYTES:
        raise ValueError('Invalid official directory bytes')
    matches = re.findall(r'<script\b(?=[^>]*\bid=[\"\']__NEXT_DATA__[\"\'])[^>]*>(.*?)</script>', body.decode('utf-8'), re.S)
    if len(matches) != 1:
        raise ValueError('Official directory schema changed')
    data = json.loads(matches[0])['props']['pageProps']['players']
    if not isinstance(data, list) or not 400 <= len(data) <= 1000:
        raise ValueError('Incomplete official directory')
    rows = []
    for r in data:
        pid = r['PERSON_ID']
        if type(pid) is not int or pid <= 0:
            raise ValueError('Invalid official player ID')
        name = str(r['PLAYER_FIRST_NAME']).strip() + ' ' + str(r['PLAYER_LAST_NAME']).strip()
        if not key(name) or int(r['TO_YEAR']) > season - 1:
            raise ValueError('Invalid official player season')
        rows.append({'nba_id': pid, 'name': name, 'team': r.get('TEAM_ABBREVIATION'),
                     'active': r.get('ROSTER_STATUS') == 1 and not r.get('HISTORIC'),
                     'last_season_start': int(r['TO_YEAR'])})
    if len({r['nba_id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate official player IDs')
    active = [r for r in rows if r['active'] and r['last_season_start'] == season - 1]
    if len(active) < 390 or {r['team'] for r in active} != TEAMS:
        raise ValueError('Incomplete current official team coverage')
    return rows

def enrich(pool, now=None, fetcher=fetch_directory):
    """Return a copy. Preserve all membership, terms, app IDs and timestamps."""
    now = now or datetime.now(timezone.utc)
    out = copy.deepcopy(pool)
    unresolved = [p for p in out['players'] if p.get('pool_status') == 'roster' and p.get('nba_id') is None]
    if not unresolved:
        return out  # No network and preserve prior evidence when already resolved.
    audit = {'schema': 'nba-official-player-identity-v1', 'source_url': URL,
             'observed_at': now.isoformat(), 'scope': 'identity-only-not-signed-ownership-or-contract-terms',
             'resolved': [], 'unresolved': [], 'source_sha256': None}
    out['official_identity_audit'] = audit
    try:
        if now.utcoffset() is None or out['generated_at'][:10] != now.astimezone(timezone.utc).date().isoformat():
            raise ValueError('Identity lookup requires current dated roster')
        season = int(out['season'])
        body = fetcher()
        rows = parse_directory(body, season)
        audit['source_sha256'] = hashlib.sha256(body).hexdigest()
        audit['source_rows'] = len(rows)
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as exc:
        # Do not swallow programming errors or hide ownership failures.
        audit['source_error'] = type(exc).__name__ + ': ' + str(exc)
        audit['unresolved'] = [{'app_nba_id': p['app_nba_id'], 'reason': 'official_source_unavailable_or_invalid'} for p in unresolved]
        return out
    names = {}
    for row in rows:
        names.setdefault(key(row['name']), []).append(row)
    existing = {}
    for player in out['players']:
        if player.get('nba_id') is not None:
            existing.setdefault(player['nba_id'], []).append(player['app_nba_id'])
    counts = {}
    for player in out['players']:
        counts[key(player['player_name'])] = counts.get(key(player['player_name']), 0) + 1
    for player in sorted(unresolved, key=lambda p: p['app_nba_id']):
        candidates = names.get(key(player['player_name']), [])
        reason = None
        if counts[key(player['player_name'])] != 1:
            reason = 'ambiguous_pool_name'
        elif len(candidates) != 1:
            reason = 'missing_or_ambiguous_official_name'
        else:
            row = candidates[0]
            if not row['active'] or row['last_season_start'] != season - 1 or row['team'] != player.get('team'):
                reason = 'official_roster_context_mismatch'
            elif row['nba_id'] in existing:
                reason = 'canonical_id_already_claimed'
        if reason:
            audit['unresolved'].append({'app_nba_id': player['app_nba_id'], 'reason': reason})
            continue
        pid = row['nba_id']
        profile = 'https://www.nba.com/player/' + str(pid)
        player.update(nba_id=pid, identity_status='nba_id', identity_source_url=profile)
        audit['resolved'].append({'app_nba_id': player['app_nba_id'], 'nba_id': pid,
                                  'player_name': player['player_name'], 'team': player['team'],
                                  'source_player_name': row['name'], 'profile_url': profile})
        existing[pid] = [player['app_nba_id']]
    out['provisional_ids'] = sum(p.get('nba_id') is None for p in out['players'])
    return out

def prepare_identities(repo, pool, now=None, fetcher=fetch_directory):
    """Shared producer-boundary enrichment, including reviewed explicit bridges.

    Call before any signed-event consumer. Does not create transaction facts.
    Caller must write a new dated receipt after changed source bytes.
    """
    from pathlib import Path
    out = copy.deepcopy(pool)
    path = Path(repo) / 'ref/player_identity_overrides.json'
    overrides = json.loads(path.read_text()) if path.exists() else []
    by_app = {p['app_nba_id']: p for p in out['players']}
    if len(by_app) != len(out['players']):
        raise ValueError('Duplicate app identity')
    applied = []
    for identity in overrides:
        p = by_app.get(identity['app_nba_id'])
        if p is None:
            continue
        pid = identity['nba_id']
        if (type(pid) is not int or pid <= 0 or key(p['player_name']) != key(identity['player_name'])
                or p.get('nba_id') not in (None, pid) or not identity.get('source_url')
                or any(q.get('nba_id') == pid and q['app_nba_id'] != p['app_nba_id'] for q in out['players'])):
            raise ValueError('Conflicting verified player identity: ' + p['player_name'])
        if p.get('nba_id') is None:
            applied.append({'app_nba_id': p['app_nba_id'], 'nba_id': pid, 'source_url': identity['source_url']})
        p.update(nba_id=pid, identity_status='nba_id', identity_source_url=identity['source_url'])
    if applied:
        out['reviewed_identity_enrichment'] = {'schema': 'nba-reviewed-identity-enrichment-v1',
            'identity_table_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'resolved': applied,
            'scope': 'identity-only-not-signed-ownership-or-contract-terms'}
    out = enrich(out, now, fetcher)
    out['provisional_ids'] = sum(p.get('nba_id') is None for p in out['players'])
    return out


def require_collected_identities(repo, pool):
    """Read-only consumer guard: never mutate certified bytes or fetch new evidence.

    Reviewed mappings are an input to collection, not permission to rewrite an
    already certified pool. Unknown identities retain existing downstream guards.
    """
    def no_fetch():
        raise OSError('Official identity lookup belongs to source collection')
    checked = prepare_identities(repo, pool, fetcher=no_fetch)
    changed = [p['player_name'] for p, q in zip(pool['players'], checked['players'])
               if p.get('nba_id') != q.get('nba_id')]
    if changed:
        raise ValueError('Player identities require source recollection before ownership: '
                         + ', '.join(changed)
                         + '. Run the normal collector including refresh_player_pool.py --enrich '
                         + 'and issue its genuine new dated source receipt; do not reuse or edit the old receipt.')
