"""Mention-level legacy claim dispositions known by the opening baseline.

The register's conditional pick label often preserves the original year after a
claim has conveyed or converted. These findings discharge only the keyed claim,
never every pick mentioned in its transaction. Later live assets stay live.
"""
from copy import deepcopy

ASOF = '2021-12-31'
ORDERS = {
    2016: 'https://pr.nba.com/nba-draft-lottery-2016-presented-state-farm-results/',
    2017: 'https://pr.nba.com/2017-nba-draft-lottery-results/',
    2018: 'https://www.nba.com/news/2018-draft-order',
    2019: 'https://pr.nba.com/pelicans-win-nba-draft-lottery-2019-presented-by-state-farm/',
    2020: 'https://pr.nba.com/minnesota-draft-lottery-2020/',
    2021: 'https://pr.nba.com/2021-nba-draft-lottery-results/',
}
PST = 'https://www.prosportstransactions.com/basketball/DraftTrades/Years/'
SS2020 = 'https://www.salaryswish.com/ajax2/trades?season=2020&offset-date=&offset-trade_id=0'
EXPIRED2020 = 'https://www.hoopsrumors.com/2020/08/details-on-traded-draft-picks-protected-in-2020.html'


def resolved_claims():
    """All original conditional claims from settlement queue indices 0–28.

    `date` keys the original register event. `settled_by` is the evidence date
    or draft date by which that particular original claim was settled. Converted
    claims explicitly identify residual future physical picks; conversion does
    not declare those residual obligations settled.
    """
    out = []

    def add(index, date, origin, year, rnd, settled, disposition, evidence,
            sources, residual=()):
        out.append(dict(queue_index=index, date=date, origin=origin,
                        claim_year=year, round=rnd, settled_by=settled,
                        disposition=disposition, evidence=evidence,
                        source=sources, reviewed=True, review_asof=ASOF,
                        residual_claims=list(residual)))

    add(0, '2019-02-07', 'ATL', 2020, 2, '2020-11-18', 'extinguished',
        'Bird placeholder was top-55 protected in 2020 only. ATL physical second was 34; no conveyance or rollover. This is a different protected slice from the Fernando trade.',
        [ORDERS[2020], EXPIRED2020,
         'https://www.nba.com/celtics/news/pressrelease/celtics-complete-trade-atlanta-hawks'])
    add(1, '2019-07-07', 'ATL', 2020, 2, '2020-11-18', 'conveyed',
        'Fernando trade conveyed ATL2020 second at34 to PHI. Its protection was56–60, the opposite slice from the Bird placeholder. The independent 2023 best-of-three second remains live.',
        [ORDERS[2020], SS2020])
    for index, date in [(2, '2020-02-05'), (3, '2019-07-06')]:
        add(index, date, 'BKN', 2020, 1, '2020-11-18', 'conveyed',
            'BKN2020 first conveyed at17 to MIN through ATL. Both Crabbe/Prince and Capela register references concern this same settled physical first, not BKN2026 seconds.',
            [ORDERS[2020]])
    for index, date in [(4, '2016-02-16'), (5, '2015-07-27')]:
        add(index, date, 'BOS', 2019, 2, '2019-06-20', 'extinguished',
            'BOS2019 second was top-55 protected with no rollover. It remained BOS at51, so the Dragic claim, subsequently transferred to MEM, expired.',
            [ORDERS[2019], PST+'2020.htm',
             'https://www.nba.com/heat/news/heat-trade-zoran-dragic'])
    add(4, '2016-02-16', 'MIA', 2017, 2, '2018-06-21', 'conveyed_after_rollover',
        'MEM right was protected41–60 in2017, unprotected2018. MIA2017 was46 and went to a separate ATL entitlement; MEM right rolled and MIA2018 at46 reached HOU viaMEM. It did not create a 2022 right.',
        [ORDERS[2017], ORDERS[2018], PST+'2018.htm'])
    add(6, '2015-07-14', 'BOS', 2018, 2, '2018-06-21', 'conveyed',
        'Perry Jones top-55-protected BOS2018 second conveyed at57 toOKC.',
        [ORDERS[2018], PST+'2018.htm'])
    add(7, '2019-07-06', 'BOS', 2020, 2, '2020-11-18', 'conveyed',
        'Walker/Rozier top-53-protected BOS2020 second conveyed at56 toCHA; the reciprocal NYK/BKN second basket settled separately in2020.',
        [ORDERS[2020], PST+'2020.htm',
         'https://www.nba.com/hornets/charlotte-hornets-acquire-terry-rozier-boston-celtics-sign-and-trade-deal-kemba-walker'])
    add(8, '2021-03-25', 'CHI', 2021, 1, '2021-07-29', 'conveyed',
        'First Vucevic first-round obligation conveyed CHI2021 at8 toORL. The separate CHI2023 first remains live; no CHI2022 rollover from the first obligation.',
        [ORDERS[2021]])
    add(9, '2015-02-19', 'CLE', 2016, 1, '2016-06-23', 'conveyed',
        'CLE2016 physical first reached PHX viaBOS at28, satisfying the Thomas/Thornton claim.',
        [ORDERS[2016]])
    add(10, '2016-02-18', 'CLE', 2018, 1, '2017-01-06', 'reacquired_and_replaced',
        'CLE reacquired its2018 first fromPOR, sending its unprotected2017 first instead. Official CLE/Portland releases identify this retirement of the original obligation; replacement2017 first conveyedPOR at26.',
        ['https://www.nba.com/cavaliers/releases/portland-trade-170106', ORDERS[2017]])
    for index, date in [(11, '2017-01-07'), (13, '2019-07-07')]:
        add(index, date, 'CLE', 2019, 1, '2020-08-20', 'converted_to_seconds',
            'Korver first was top10 protected2019 and2020; CLE was5 inboth. It converted to CLE2021/22 unprotected seconds, subsequently heldNOP. CLE2021 conveyedNOP at35; CLE2022 remains a live NOP second at opening, already allocated separately. NOP2023 conditional second in the2019 event is independent.',
            [ORDERS[2019], ORDERS[2020], ORDERS[2021], EXPIRED2020, SS2020],
            [{'origin':'CLE','year':2022,'round':2,'owner':'NOP','status':'live_at_opening'}])
    add(12, '2018-02-08', 'CLE', 2018, 1, '2018-06-21', 'conveyed',
        'Clarkson/Nance CLE2018 first conveyedLAL at25. Conditional fallback years never activated.',
        [ORDERS[2018], PST+'2018.htm'])
    for index, date in [(14, '2017-02-23'), (16, '2020-02-06')]:
        add(index, date, 'DAL', 2017, 1, '2020-11-18', 'converted_and_fully_conveyed',
            'Noel2017 first was top18 protected; DAL9 triggered DAL2017/20 unprotected seconds. Those conveyed PHI at39 in2017 andGSW viaPHI at48 in2020. The2020 Burks/Robinson register retains the old2017 first label but actually transfers DAL2020 second. TOR2022 second inthat event remains independent and live.',
            [ORDERS[2017], ORDERS[2020], PST+'2017.htm', SS2020])
    add(15, '2018-06-21', 'DAL', 2019, 1, '2019-06-20', 'conveyed',
        'Doncic/Young extra first conveyed DAL2019 at10 toATL. No subsequent protection year or second fallback activated.',
        [ORDERS[2019]])
    add(17, '2015-07-09', 'DAL', 2018, 2, '2018-06-21', 'extinguished',
        'Pachulia DAL2018 second was protected31–55 in2018 only. DAL held33, so MIL claim expired without rollover.',
        [ORDERS[2018], PST+'2018.htm',
         'https://www.nba.com/mavs/mavericks-acquire-center-zaza-pachulia-from-bucks'])
    add(18, '2016-07-07', 'DAL', 2019, 2, '2019-06-20', 'extinguished',
        'Bogut DAL2019 second was protected31–55 in2019 only; DAL37 remainedDAL. Separate outgoingGSW second is not part of this expired placeholder.',
        [ORDERS[2019], PST+'2019.htm', 'https://www.shamsports.com/players/andrew-bogut'])
    add(19, '2018-07-13', 'DEN', 2019, 1, '2019-06-20', 'conveyed',
        'Faried/Arthur salary-dump DEN2019 first conveyedBKN at27. No future first-round rollover or second fallback remains.',
        [ORDERS[2019]])
    add(20, '2019-07-08', 'DEN', 2020, 1, '2020-11-18', 'conveyed',
        'Jerami Grant DEN2020 physical first conveyedOKC at25, not DEN-heldHOU2020 first at22.',
        [ORDERS[2020]])
    for index, date in [(21, '2017-02-23'), (22, '2019-02-07')]:
        add(index, date, 'DEN', 2019, 2, '2019-06-20', 'conveyed',
            'Hibbert DEN2019 second, subsequently included inMirotic deal, conveyed at57 toNOP viaMIL; noDEN2024 rollover exists.',
            [ORDERS[2019], PST+'2019.htm'])
    add(23, '2019-07-07', 'GSW', 2020, 1, '2020-08-20', 'converted_to_future_second',
        'Durant/Russell first was top20 protected in2020 only. GSW2 triggered its2025 second fallback, not a rolling first. Existing2025GSW/WAS basket models the live residual. The register also mentions2025second but it is the fallback, not anadditional independentGSW2025pick.',
        [ORDERS[2020], SS2020, EXPIRED2020],
        [{'origin':'GSW','year':2025,'round':2,'owner':'BKN_then_WAS_swap_basket','status':'live_at_opening'}])
    add(24, '2020-11-22', 'GSW', 2021, 1, '2021-07-29', 'converted_and_fully_conveyed',
        'Oubre top20-protected GSW2021 first stayedGSW at14. Fixed2021 DEN/MIN second consideration conveyedOKC at55/36; noGSW2022 first/second or2023first rollover exists.',
        [ORDERS[2021],
         'https://www.salaryswish.com/ajax2/trades?season=2021&offset-date=2021-01-22&offset-trade_id=55'])
    add(25, '2019-07-06', 'IND', 2020, 1, '2020-11-18', 'conveyed',
        'Brogdon IND2020 first conveyedMIL at24. NoIND2022–26 first-round rollover remains; second-round consideration is separate.',
        [ORDERS[2020], SS2020])
    add(26, '2015-06-25', 'LAC', 2017, 1, '2017-06-22', 'conveyed',
        'Vasquez LAC2017 physical first conveyedTOR viaMIL at23. NoLAC2022 second fallback exists.',
        [ORDERS[2017]])
    for index, date in [(27, '2016-06-24'), (28, '2016-02-18')]:
        add(index, date, 'LAC', 2019, 1, '2019-06-20', 'conveyed',
            'JeffGreen LAC2019 first, retransferredMEMtoBOS forDavis/Zagorac rights, conveyedBOS at20. No2022/23 second fallback survives.',
            [ORDERS[2019]])
    return deepcopy(out)


def live_claims():
    """Independent claims in these events which must not be blanket-dismissed."""
    return [
        dict(date='2019-07-07', origin=None, claim_year=2023, round=2,
             disposition='live_best_ATL_CHA_BKN_basket', source=[SS2020]),
        dict(date='2021-03-25', origin='CHI', claim_year=2023, round=1,
             disposition='live_second_Vucevic_first', source=[PST+'2023.htm']),
        dict(date='2019-07-07', origin='NOP', claim_year=2023, round=2,
             disposition='live_top45_protected_to_ATL', source=[SS2020]),
    ]


def build_rules():
    # All live residuals above already have reviewed baseline allocator rules.
    # Re-emitting them would double-transfer a physical pick.
    return []
