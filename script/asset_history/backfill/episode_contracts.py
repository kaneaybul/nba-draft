"""Convert a partial-season contract's cash amount to a comparable salary rate.

Original cash is retained. The model applies remaining game exposure separately;
feeding episode cash into that step would prorate the same salary twice.
"""
from datetime import date, timedelta

SEASONS = {
    2021: ('2020-12-22', '2021-05-16'),
    2022: ('2021-10-19', '2022-04-10'),
    2023: ('2022-10-18', '2023-04-09'),
    2024: ('2023-10-24', '2024-04-14'),
    2025: ('2024-10-22', '2025-04-13'),
    2026: ('2025-10-21', '2026-04-12'),
    2027: ('2026-10-20', '2027-04-11'),
}
PRORATION_SOURCE = 'https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf'


def annualize_episode(agreement):
    if not agreement.get('short_episode') or not agreement.get('salaries'):
        return
    first = min(int(s['year']) for s in agreement['salaries'])
    if first not in SEASONS:
        return
    start, end = map(date.fromisoformat, SEASONS[first])
    signed = date.fromisoformat(agreement['known_from'])
    if signed > end:
        return
    season_days = (end-start).days+1
    ten_day = '10-DAY' in agreement.get('contract_type', '').upper()
    covered = 10 if ten_day else (end-max(signed, start)).days+1
    expiry = min(signed+timedelta(days=9), end) if ten_day else end
    for cell in agreement['salaries']:
        if int(cell['year']) != first:
            continue
        original = cell['amount']
        cell['original_episode_amount'] = original
        cell['original_episode_guaranteed_amount'] = cell.get('guaranteed_amount')
        cell['amount'] = round(original*season_days/covered)
        if cell.get('guaranteed_amount') is not None:
            cell['guaranteed_amount'] = round(cell['guaranteed_amount']*season_days/covered)
        cell['quality'] = 'original_episode_cash_annualized_rate_estimate'
        cell['annualization'] = dict(regular_season_days=season_days,
            contract_days=covered, scheduled_expiry=expiry.isoformat(),
            source=PRORATION_SOURCE,
            assumption='Ten-day cash divided by ten; three-game minimum may extend an individual episode.' if ten_day else 'Original episode cash divided by regular-season days remaining at signing.')
    agreement['annual_rate_unresolved_years'] = []
    agreement['episode_annual_rate_estimated'] = True
    agreement['episode_scheduled_expiry'] = expiry.isoformat()
    agreement['schedule_complete'] = agreement.get('table_complete', False) and not agreement.get('max_salary_asof_review_required', False)
