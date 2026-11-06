"""As-of transaction estimates for the Trades drilldown."""
from bisect import bisect_left, bisect_right
from collections import defaultdict
from itertools import groupby
import re

from attribution_players import name_key
from league_pick_values import portfolio_quote, simulate, value_portfolio
from pick_replay import active_rules


def trade_teams(text, names):
    return {team for name, team in names.items() if name in text}


def player_routes(event, names):
    """Read the team on either side of each acquisition clause."""
    people = {name_key(p['name']): p for p in event.get('players', [])}
    incoming, outgoing, rights = {}, {}, set()
    aliases = '|'.join(re.escape(name) for name in sorted(names, key=len, reverse=True))
    clause = re.compile(
        rf'(?P<in>.+?) (?:was|were) acquired by (?:the )?(?P<to>{aliases})'
        rf'(?: from (?:the )?(?P<from>{aliases}))?'
        r'(?: in exchange for:?\s*(?P<out>.+))?'
    )
    # Initials and suffixes in player names are not clause boundaries.
    sentences = re.split(r'(?<!\b[A-Z])(?<!Jr)(?<!Sr)\.\s+(?=[A-Z])', event['text'])
    for sentence in sentences:
        match = clause.match(sentence.rstrip('.'))
        if not match:
            continue
        for side, team in [('in', match['to']), ('out', match['from'])]:
            terms = match[side] or ''
            for key in people:
                if key not in name_key(terms):
                    continue
                if side == 'in':
                    incoming[key] = names[team]
                    if match['from']:
                        outgoing[key] = names[match['from']]
                elif team:
                    incoming[key] = names[team]
                    outgoing[key] = names[match['to']]
                if 'draft rights to' in terms.lower() and key in name_key(terms.lower().split('draft rights to', 1)[1]):
                    rights.add(key)
        # In multi-team deals the return is listed from the receiving team's perspective.
        if match['out'] and not match['from']:
            for key in people:
                if key in name_key(match['out']):
                    outgoing[key] = names[match['to']]
    for action in event.get('parsed_actions', []):
        key = name_key(action['player_name'])
        if action.get('action') == 'transfer' and key in people:
            incoming[key] = action['to_team']
            if action.get('draft_rights'):
                rights.add(key)
    teams = trade_teams(event['text'], names) | set(incoming.values()) | set(outgoing.values())
    if len(teams) == 2:
        for key, target in incoming.items():
            outgoing.setdefault(key, next(iter(teams - {target})))
    return {
        key: (person, outgoing[key], target, key in rights)
        for key, target in incoming.items()
        if (person := people.get(key)) and key in outgoing and outgoing[key] != target
    }


def portfolio_changes(before, after, teams):
    """Name physical picks even when the transferred interest is conditional."""
    for team in teams:
        old = {a['id']: a for a in before[team]}
        new = {a['id']: a for a in after[team]}
        for key in sorted(old.keys() | new.keys()):
            a, b = old.get(key, {}), new.get(key, {})
            change = b.get('value', 0.) - a.get('value', 0.)
            if abs(change) < .000001:
                continue
            asset = b or a
            probability = b.get('holding_probability', 0.) - a.get('holding_probability', 0.)
            direction = 'in' if probability > 1e-9 else 'out' if probability < -1e-9 else (
                'terms' if key.startswith('pick:') else 'in' if change > 0 else 'out'
            )
            if asset.get('physical_origin'):
                round_name = 'first' if asset['round'] == 1 else 'second'
                label = f"{asset['draft_year']} {asset['physical_origin']} {round_name}-round pick"
                if abs(probability) < .999999:
                    label += ' · conditional rights'
            else:
                label = asset['name'].removesuffix(' obligation')
            yield team, dict(id=key, name=label, direction=direction, value=change)


def add_piece(deal, team, piece):
    deal['pieces'][team].append(piece)


def physical_picks(node):
    if isinstance(node, list):
        if (len(node) == 3 and isinstance(node[0], str) and
                isinstance(node[1], int) and node[2] in (1, 2)):
            return {tuple(node)}
        return set().union(*(physical_picks(item) for item in node))
    if isinstance(node, dict):
        return set().union(*(physical_picks(value) for key, value in node.items()
                             if key not in ('conditions', 'if_slot_in')))
    return set()


def pick_label(pick):
    team, year, rnd = pick
    return f"{year} {team} {'first' if rnd == 1 else 'second'}-round pick"


def group_pick_claims(pieces, rules, team, day):
    """One line per reviewed right when its physical legs are separable."""
    claims = []
    for rule in rules:
        source, target = rule.get('from_team'), rule.get('to_team')
        swap = rule['kind'] in ('swap', 'selected_swap', 'holder_swap', 'holder_pool_swap')
        if swap:
            source, target = rule.get('right_owner'), rule.get('left_owner')
        picks = sorted(p for p in physical_picks(rule) if p[1] >= int(day[:4]))
        if team in (source, target) and source and target and picks:
            ids = {f'pick:{origin}:{year}:{rnd}' for origin, year, rnd in picks}
            claims.append((rule, picks, ids, 'in' if team == target else 'out', swap))
    consumed = set()
    for rule, picks, ids, direction, swap in claims:
        if any(other is not ids and ids & other for _, _, other, _, _ in claims):
            continue
        matches = [p for p in pieces if p['id'] in ids]
        if not swap and any(p['direction'] != direction for p in matches):
            continue
        if len(picks) == 1:
            name = pick_label(picks[0])
            ranges = rule.get('protected_ranges') or next(
                (branch.get('protected_ranges') for branch in rule.get('branches', [])
                 if branch.get('protected_ranges')), []
            )
            if ranges:
                name += ' · protected ' + ', '.join(f'No. {a}–{b}' for a, b in ranges)
            elif rule.get('conditions') or any('conditional' in p['name'] for p in matches):
                name += ' · conditional rights'
        else:
            selector = rule.get('select')
            selector = selector if isinstance(selector, dict) else {}
            rank = rule.get('rank') or next((k for k in ('best', 'worst') if k in selector), '')
            label = ('Pick swap' if swap else 'Most favorable pick' if rank == 'best' else
                     'Least favorable pick' if rank == 'worst' else 'Protected pick with rollover'
                     if rule['kind'] == 'protected_chain' else 'Conditional pick rights')
            name = label + ' · ' + ' / '.join(pick_label(pick) for pick in picks)
        yield dict(id=rule['rule_id'], name=name, direction=direction,
                   value=sum(p['value'] for p in matches), pick_ids=sorted(ids))
        consumed.update(p['id'] for p in matches)
    yield from (p for p in pieces if p['id'] not in consumed)


def price_day(ctx, day, quote_date, prior, day_actions, groups, deals, ratings_dates):
    cutoff = ratings_dates[bisect_right(ratings_dates, quote_date) - 1]
    full = active_rules(ctx['baseline'], prior + day_actions, day)
    # Keep a common draft order on both sides so value changes come from rights.
    sim = simulate(quote_date, ctx['inputs']['ratings'][cutoff], ctx['inputs']['standings'][cutoff],
                   full['rules'], ctx['orders']['orders'], ctx['inputs']['qualifiers'],
                   5000, max(2033, int(day[:4]) + 7))
    years = range(int(day[:4]), int(day[:4]) + 8)

    def price(applied):
        legal = active_rules(ctx['baseline'], applied, day)
        return value_portfolio(day, legal, sim, ctx['model'], years)['teams']

    errors = []

    def try_price(applied):
        try:
            return price(applied)
        except (ValueError, KeyError) as error:
            if not errors:
                errors.append(str(error))
            return None

    before = try_price(prior)
    additions = defaultdict(list)
    missing = set()
    applied = list(prior)
    # Preserve reviewed ordering when deals on the same day affect the same right.
    for key, chunk in groupby(day_actions, key=lambda a: groups.get(a['event_id'])):
        chunk = list(chunk)
        applied.extend(chunk)
        after = try_price(applied)
        if key and (before is None or after is None):
            missing.add(key)
        elif key:
            day_pieces = additions[key]
            changes = defaultdict(list)
            for team, piece in portfolio_changes(before, after, deals[key]['teams']):
                changes[team].append(piece)
            rules = [a['rule'] for a in chunk if a['kind'] == 'add_rule']
            for team in deals[key]['teams']:
                for piece in group_pick_claims(changes[team], rules, team, day):
                    day_pieces.append((team, dict(piece, basis_date=quote_date)))
        before = after
    if errors:
        print(f'Incomplete trade pick replay on {day} using {quote_date}: {errors[0]}', flush=True)
    return {key: pieces for key, pieces in additions.items() if key not in missing}


def pick_estimates(ctx, deals, actions_by_day):
    """Replay each deal separately with a shared draft forecast on both sides."""
    actions = sorted(ctx['actions'], key=lambda a: (a['known_from'], a.get('order', 0)))
    ratings_dates = sorted(ctx['inputs']['ratings'])
    prior = []
    for day, group in groupby(actions, key=lambda a: a['known_from']):
        day_actions = list(group)
        groups = actions_by_day.get(day, {})
        if groups and ctx['dates'][0] < day <= ctx['dates'][-1]:
            closing = ctx['dates'][bisect_left(ctx['dates'], day)]
            missing = set(groups.values())
            for quote_date in dict.fromkeys((day, closing)):
                if not missing or quote_date < ratings_dates[0]:
                    break
                try:
                    additions = price_day(ctx, day, quote_date, prior, day_actions, groups, deals, ratings_dates)
                except (ValueError, KeyError) as error:
                    print(f'Trade pick forecast unavailable on {day} using {quote_date}: {error}', flush=True)
                    continue
                for key in missing.intersection(additions):
                    for team, piece in additions[key]:
                        add_piece(deals[key], team, piece)
                missing.difference_update(additions)
            for action in day_actions:
                key = groups.get(action['event_id'])
                if key in missing and action['kind'] == 'add_rule':
                    for team in deals[key]['teams']:
                        for piece in group_pick_claims([], [action['rule']], team, day):
                            add_piece(deals[key], team, dict(piece, value=None))
        prior.extend(day_actions)


def enrich_trade_details(ctx, ledgers):
    names = {name: team for team, name in ctx['names'].items()}
    names['Philadelphia Sixers'] = 'PHI'
    dates = ctx['dates']
    deals = {}
    raw = {(e['date'], e['event_id']): e for e in ctx['events'] if 'trade' in e['parsed_status']}
    catalog = {(e['known_from'], e['event_id']): e for e in ctx['catalog']}
    marks = defaultdict(dict)
    names_at_date = defaultdict(dict)
    for (day, aid), asset in ctx['league'].items():
        marks[day][aid] = asset
        names_at_date[day][name_key(asset['name'])] = aid
    contributors = {
        (team, row['end']): {name_key(p['player']) for p in row['contributors']['trades']}
        for team, ledger in ledgers.items() for row in ledger['intervals']
    }

    def add_deal(day, event_id, source, text, teams):
        key = (day, text or event_id)
        if key not in deals:
            deals[key] = dict(id=event_id, date=day, source=source, teams=set(), pieces=defaultdict(list))
        deals[key]['teams'].update(teams)
        return key

    actions_by_day = defaultdict(dict)
    rescinded = set()
    for action in ctx['actions']:
        day, event_id = action['known_from'], action['event_id']
        if action['kind'] == 'no_future_pick_effect' and 'rescind' in action.get('reason', '').lower():
            rescinded.add((day, event_id))
        if not dates[0] < day <= dates[-1] or action['kind'] == 'no_future_pick_effect':
            continue
        event = raw.get((day, event_id), {})
        record = catalog.get((day, event_id), {})
        text = event.get('text') or record.get('source_text', '')
        rule = action.get('rule') or action.get('claim') or {}
        teams = trade_teams(text, names)
        teams.update(rule.get(k) for k in ('from_team', 'to_team', 'left_owner', 'right_owner'))
        teams.intersection_update(ledgers)
        if len(teams) >= 2:
            sources = action['source']
            source = event.get('source') or record.get('source') or (sources[0] if isinstance(sources, list) else sources)
            actions_by_day[day][event_id] = add_deal(day, event_id, source, text, teams)
    pick_estimates(ctx, deals, actions_by_day)

    # Full transaction records take precedence over short per-player notices.
    seen_routes = set()
    events = sorted(raw.values(), key=lambda e: (e['date'], 'in exchange for' not in e['text'], e['event_id']))
    for event in events:
        day = event['date']
        if not dates[0] < day <= dates[-1] or (day, event['event_id']) in rescinded:
            continue
        index = bisect_left(dates, day)
        opening, closing = dates[index - 1], dates[index]
        known_deal = actions_by_day[day].get(event['event_id'])
        full_package = 'in exchange for' in event['text']
        for key, (person, source, target, draft_rights) in player_routes(event, names).items():
            if source not in ledgers or target not in ledgers:
                continue
            route = day, person.get('nba_id') or key, source, target
            if route in seen_routes:
                continue
            if not (known_deal or full_package or
                    key in contributors[target, closing] or key in contributors[source, closing]):
                continue
            seen_routes.add(route)
            deal_key = known_deal or add_deal(day, event['event_id'], event['source'], event['text'],
                                             trade_teams(event['text'], names))
            deal = deals[deal_key]
            deal['teams'].update((source, target))
            aid = names_at_date[opening].get(key) or names_at_date[closing].get(key)
            if person.get('nba_id') is not None:
                aid = f"player:nba:{person['nba_id']}"
            mark = marks[opening].get(aid)
            value = mark['value'] if mark else None
            label = person['name']
            basis = opening if mark else None
            if draft_rights:
                label = f'Draft rights to {label}'
                selected = marks[closing].get(aid, {}).get('details', {})
                year, slot = selected.get('draft_year'), selected.get('draft_slot')
                if year and slot and int(float(year)) == int(day[:4]):
                    slot = int(float(slot))
                    lottery = next((r for r in ctx['orders']['orders'] if int(r['year']) == int(float(year))
                                    and r['kind'] == 'lottery' and r['known_from'] <= day), None)
                    first_count = sum(r['round'] == 1 for r in lottery['rows']) if lottery else 30
                    # If the same selection already appears as a priced pick
                    # entitlement in this package, retain the original right.
                    physical = next((r for r in lottery['rows'] if r.get('actual_slot') == slot), None) if lottery else None
                    if physical:
                        pick_id = f"pick:{physical['origin']}:{int(float(year))}:{physical['round']}"
                        if any(pick_id in p.get('pick_ids', [p['id']]) for p in deal['pieces'][target]):
                            continue
                    value = portfolio_quote(ctx['model'])(1 if slot <= first_count else 2, slot, 30-first_count, int(float(year)))
                    basis = day
                    label += f' ({year} No. {slot})'
            for team, direction, sign in [(target, 'in', 1), (source, 'out', -1)]:
                add_piece(deal, team, dict(id=aid or key, name=label, direction=direction,
                                          value=None if value is None else sign * value, basis_date=basis))

    for ledger in ledgers.values():
        ledger['trade_deals'] = []
    for deal in deals.values():
        for team, pieces in deal['pieces'].items():
            if not pieces:
                continue
            pieces.sort(key=lambda p: (p['value'] is None, -abs(p['value'] or 0), p['name']))
            net = sum(p['value'] for p in pieces if p['value'] is not None)
            counterparties = sorted(deal['teams'] - {team})
            ledgers[team]['trade_deals'].append(dict(
                id=deal['id'], date=deal['date'], source=deal['source'],
                counterparties=counterparties, pieces=pieces, net=net,
            ))
    for ledger in ledgers.values():
        ledger['trade_deals'].sort(key=lambda d: (d['date'], d['id']), reverse=True)
    print(f"Built dated trade summaries for {len(ledgers)} teams", flush=True)
