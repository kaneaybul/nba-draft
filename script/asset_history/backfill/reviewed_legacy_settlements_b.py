"""Exact pre-2022 settlement review: MEM/MIL/MIN/NOP/OKC/ORL/PHI.

These close dated conditional mentions, not whole trades or future inventory.
All settlement facts were knowable by the opening cutoff, 2021-12-31.
The original mention year is retained even when RealGM uses a stale year.
"""

ORDER = {
    2016: 'https://pr.nba.com/nba-draft-lottery-2016-presented-state-farm-results/',
    2017: 'https://pr.nba.com/2017-nba-draft-lottery-results/',
    2018: 'https://www.nba.com/news/2018-draft-order',
    2020: 'https://pr.nba.com/minnesota-draft-lottery-2020/',
    2021: 'https://pr.nba.com/2021-nba-draft-lottery-results/',
}


def pst(year):
    return f'https://www.prosportstransactions.com/basketball/DraftTrades/Years/{year}.htm'


def resolved_claims():
    out = []

    def add(date, origin, year, rnd, settled, disposition, evidence, sources):
        out.append(dict(date=date, origin=origin, claim_year=year, round=rnd,
                        settled_by=settled, disposition=disposition,
                        evidence=evidence, source=sources, reviewed=True))

    add('2015-01-12', 'MEM', 2019, 1, '2020-11-18', 'conveyed',
        'Jeff Green first conveyed to Boston as Memphis 2020 #14 (Aaron Nesmith). '
        'Official 2020 order lists Boston from Memphis; no residual rollover.',
        [ORDER[2020], pst(2020),
         'https://www.nba.com/grizzlies/news/grizzlies-acquire-green-smith-three-team-trade-150112'])

    for date in ['2015-01-07', '2017-02-13']:
        add(date, 'MEM', 2015, 1, '2017-06-22', 'conveyed',
            'The Memphis first acquired by Cleveland, then Denver, then Portland '
            'conveyed in 2017 at #20 (Harry Giles). RealGM keeps the original '
            '2015 nominal year in both dated mentions. Official 2017 order lists '
            'Portland from Memphis via Denver and Cleveland.', [ORDER[2017], pst(2017), pst(2015)])

    for origin, slot, name in [('MEM', 49, 'Vlatko Cancar'), ('OKC', 51, 'Monte Morris')]:
        add('2016-08-30', origin, 2017, 2, '2017-06-22', 'conveyed',
            f'Lauvergne consideration conveyed to Denver in 2017 at #{slot} ({name}). '
            'Original protection was top35 in 2017, otherwise unprotected 2018. '
            'Official 2017 order confirms both physical origins at Denver.', [ORDER[2017], pst(2017)])

    add('2019-01-07', 'MEM', 2020, 2, '2020-11-18', 'expired_no_rollover',
        'Carter-Williams consideration was only the top55-protected Memphis 2020 '
        'second. Memphis landed #44 and remained with Chicago; Houston right '
        'was not exercised, with no later-year fallback.',
        ['https://www.nba.com/bulls/news/bulls-complete-trade-rockets', ORDER[2020],
         'https://prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=2010-7-21&EndDate=2019-2-15&Player=&PlayerMovementChkBx=yes&TeamCurrent=Pelicans&start=11450&submit=Search'])
    add('2019-01-03', 'MEM', 2020, 2, '2020-11-18', 'conveyed',
        'Holiday return conveyed as Memphis 2020 #44 Marko Simonovic to Chicago. '
        'The subsequent Houston right applied only at56–60 and failed. Official '
        '2020 order explicitly lists Chicago from Memphis.',
        ['https://www.nba.com/news/release-bulls-complete-trade-grizzlies-justin-holiday',
         ORDER[2020], pst(2019)])

    add('2018-02-05', 'MIL', 2018, 2, '2018-06-21', 'conveyed',
        'Zeller consideration conveyed as Milwaukee 2018 #45 Hamidou Diallo to '
        'Brooklyn. Official 2018 order explicitly lists Brooklyn from Milwaukee. '
        'The possible 2020 fallback therefore never arose.',
        [ORDER[2018], pst(2018),
         'https://www.nba.com/nets/news/2018/02/05/brooklyn-nets-acquire-rashad-vaughn-and-second-round-draft-pick-milwaukee'])
    add('2017-11-07', 'MIL', 2018, 2, '2018-06-21', 'expired_no_rollover',
        'Bledsoe second was protected31–47 and extinguished if in that range. '
        'Milwaukee landed45; complementary Zeller claim conveyed to Brooklyn. '
        'This is not a later-year Milwaukee second obligation.',
        ['https://www.nba.com/suns/press-release/suns-acquire-greg-monroe-and-two-draft-picks-milwaukee',
         'https://basketball.realgm.com/analysis/247986/Grading-The-Deal-Suns-Trade-Eric-Bledsoe-To-Milwaukee',
         ORDER[2018], pst(2018)])
    for date in ['2017-11-07', '2019-07-06']:
        add(date, 'MIL', 2018, 1, '2020-11-18', 'conveyed',
            'Same Bledsoe first, subsequently transferred Phoenix to Boston in '
            'the Baynes/Jerome trade, conveyed as Milwaukee 2020 #30 Desmond Bane. '
            'Official 2020 order lists Boston from Milwaukee via Phoenix.', [ORDER[2020], pst(2020)])

    tucker = 'https://www.nba.com/bucks/news/milwaukee-bucks-acquire-pj-tucker-and-rodions-kurucs-houston-rockets'
    add('2021-03-19', 'MIL', 2021, 1, '2021-07-29', 'conveyed',
        'Tucker first/second swap settled in 2021: Milwaukee first24 to Houston '
        '(Josh Christopher), Houston second31 to Milwaukee (Isaiah Todd). '
        'Official 2021 order explicitly confirms both directions.', [tucker, ORDER[2021]])
    add('2021-03-19', 'MIL', 2022, 1, '2021-03-19', 'returned_own',
        'Official Bucks release explicitly returns Milwaukee own2022first from '
        'Houston. This removes the legacy conditional outgoing footprint only; '
        'the physical2022first remains owned by Milwaukee at baseline. '
        'Does not affect the separate known2022second forfeiture.', [tucker])

    add('2015-02-10', 'MIN', 2018, 1, '2018-06-21', 'conveyed',
        'Payne first conveyed to Atlanta as Minnesota 2018 #19 Kevin Huerter. '
        'Official 2018 order identifies Atlanta from Minnesota; no2022fallback remains.',
        [ORDER[2018], pst(2018),
         'https://atlantahawkspr.wordpress.com/wp-content/uploads/2015/02/trade-2-10.pdf'])
    add('2015-01-09', 'MIN', 2013, 1, '2017-06-22', 'converted_and_settled',
        'Wright first was top12protected through2016, then converted into Minnesota '
        '2016 and2017seconds. Both conveyed: 2016 #35 Rade Zagorac and2017 #37 '
        'Semi Ojeleye. Official orders list Boston from Minnesota via Phoenix. '
        'RealGM original mention uses stale2013year.',
        ['https://www.nba.com/suns/press-release/suns-acquire-brandan-wright-celtics',
         ORDER[2016], ORDER[2017], pst(2016)])
    add('2020-02-06', 'MIN', 2021, 1, '2021-07-29', 'conveyed',
        'Russell/Wiggins top3-protected2021first conveyed Golden State at7 '
        '(Jonathan Kuminga); official2021order shows Golden State from Minnesota. '
        'Possible unprotected2022fallback did not arise.', [ORDER[2021], pst(2021)])

    add('2018-02-01', 'NOP', 2018, 1, '2018-06-21', 'conveyed',
        'Mirotic first conveyed Chicago at2018 #22 Chandler Hutchison, shown in '
        'official2018order. Later conditional years/fallbackseconds never arose. '
        'The separate2021second swap is not cleared by this record.',
        [ORDER[2018], pst(2018),
         'https://www.nba.com/bulls/news/bulls-acquire-asik-nelson-allen-and-first-round-pick-new-orleans'])

    for date in ['2015-02-19', '2017-06-30']:
        add(date, 'OKC', 2018, 1, '2018-06-21', 'conveyed',
            'Same Oklahoma City first transferred to Utah in Kanter trade and '
            'then Minnesota for Rubio. Conveyed2018 #20 Josh Okogie; official '
            'order lists Minnesota from Oklahoma City via Utah.',
            [ORDER[2018], pst(2018),
             'https://www.nba.com/news/timberwolves-acquire-2018-first-round-draft-pick-utah-exchange-guard-ricky-rubio'])
    for date in ['2015-01-05', '2015-01-07', '2015-02-19']:
        add(date, 'OKC', 2015, 1, '2016-06-23', 'conveyed',
            'Same Oklahoma City first passed through Cleveland and Denver, then '
            'Philadelphia for McGee. Conveyed2016 #26 Furkan Korkmaz; official '
            '2016order lists Philadelphia from Oklahoma City via Denver and '
            'Cleveland. No2018/2019second fallback remained.', [ORDER[2016], pst(2016), pst(2015)])
    for date in ['2016-11-01', '2017-06-22', '2019-02-07']:
        add(date, 'OKC', 2020, 1, '2020-11-18', 'conveyed',
            'Same Grant first passed Philadelphia to Orlando for Pasecniks, then '
            'back to Philadelphia for Fultz. Conveyed2020 #21 Tyrese Maxey; '
            'official2020order lists Philadelphia from Oklahoma City via Orlando '
            'and Philadelphia. No2022/2023second fallback remained.', [ORDER[2020], pst(2020), pst(2019)])
    add('2020-11-19', 'OKC', 2021, 2, '2021-07-29', 'expired_no_rollover',
        'Poirier consideration was Oklahoma City2021second top55protected only. '
        'Official order shows OKC34, so Boston right was not exercised and '
        'expired; the physical34 remained available to Oklahoma City.',
        ['https://www.nba.com/celtics/news/pressrelease/celtics-finalize-trade-oklahoma-city-thunder',
         'https://www.hoopsrumors.com/2020/11/2020-nba-offseason-trades.html',
         ORDER[2021],
         'https://www.prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=&DisciplinaryChkBx=yes&EndDate=&ILChkBx=yes&InjuriesChkBx=yes&LegalChkBx=yes&NBADLChkBx=yes&PersonalChkBx=yes&Player=&PlayerMovementChkBx=yes&Submit=Search&Team=&start=128125'])

    add('2015-07-27', 'ORL', 2016, 2, '2016-06-23', 'expired_no_rollover',
        'Napier consideration was a2016second top55protected, else extinguished. '
        'Orlando landed41 and retained it; Miami right was not exercised. '
        'No2022or later footprint.',
        ['https://www.nba.com/magic/news/orlando-magic-acquire-guard-shabazz-napier-heat',
         ORDER[2016],
         'https://prosportstransactions.com/basketball/Search/SearchResults.php?BeginDate=&EndDate=&Player=&PlayerMovementChkBx=yes&Team=&start=41925&start=47100&start=48650&submit=Search'])

    for date in ['2019-02-06', '2019-06-21']:
        add(date, 'PHI', 2020, 1, '2020-11-18', 'conveyed',
            'Harris first subsequently transferred Clippers to Brooklyn for '
            'Kabengele. Philadelphia2020first conveyed19 (Saddiq Bey); official '
            '2020order lists Brooklyn from Philadelphia via LA Clippers. '
            'No2023/2024second fallback remained.', [ORDER[2020], pst(2020), pst(2021)])
    return out


def live_claims():
    """No unrepresented future claim remains in this reviewed cohort."""
    return []
