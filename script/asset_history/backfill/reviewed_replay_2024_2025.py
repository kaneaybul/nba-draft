"""Dated, source-reviewed 2024–25 pick actions.

Physical components are retransferred only if the immediate seller owns them
after earlier contingent rules. This preserves original protections and never
uses a source's subsequently appended realized-player labels.
"""
from copy import deepcopy

META = {'L06984': ('2024-01-14',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07000': ('2024-01-17',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07001': ('2024-01-17',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07064': ('2024-01-23',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07130': ('2024-02-01',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07175': ('2024-02-07',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07176': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07177': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07178': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07180': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07181': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07182': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07183': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07184': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07188': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07189': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07190': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07191': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07192': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07193': ('2024-02-08',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']),
 'L07899': ('2024-06-26',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07900': ('2024-06-26',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07901': ('2024-06-26',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07933': ('2024-06-27',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07934': ('2024-06-27',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07937': ('2024-06-27',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07939': ('2024-06-27',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L07941': ('2024-06-28',
            ['https://basketball.realgm.com/nba/transactions/league/2024',
             'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'L08248': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08260': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08262': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08264': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08277': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08280': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08298': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08343': ('2024-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2024-07-06&offset-trade_id=360',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08373': ('2024-07-08',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08450': ('2024-07-18',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08453': ('2024-07-19',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08832': ('2024-10-02',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L08950': ('2024-10-15',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L09719': ('2024-12-15',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L09733': ('2024-12-15',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L09818': ('2024-12-29',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L09990': ('2025-01-15',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10103': ('2025-02-01',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10113': ('2025-02-02',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10124': ('2025-02-03',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10134': ('2025-02-04', ['https://basketball.realgm.com/nba/transactions/league/2025']),
 'L10139': ('2025-02-05',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10140': ('2025-02-05',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10146': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10147': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10149': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10151': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10154': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10155': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10156': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10159': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10160': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10163': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10164': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10177': ('2025-02-06',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'L10676': ('2025-06-15',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10679': ('2025-06-17',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10722': ('2025-06-25',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10723': ('2025-06-25',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10724': ('2025-06-25',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10725': ('2025-06-25',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10756': ('2025-06-26',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10762': ('2025-06-28',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10790': ('2025-06-29',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L10823': ('2025-06-30',
            ['https://basketball.realgm.com/nba/transactions/league/2025',
             'https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=&offset-trade_id=0']),
 'L11078': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11094': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11104': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11106': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11122': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11123': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11126': ('2025-07-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11129': ('2025-07-07',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11149': ('2025-07-07',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11154': ('2025-07-07',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11177': ('2025-07-08',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11191': ('2025-07-09',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11326': ('2025-08-06',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2025-08-15&offset-trade_id=444']),
 'L11341': ('2025-08-15',
            ['https://basketball.realgm.com/nba/transactions/league/2026',
             'https://www.salaryswish.com/ajax2/trades?season=2026&offset-date=2026-02-05&offset-trade_id=468']),
 'DECISION_2024_06_01_NOP_LAL_DEFER': ('2024-06-01', ['https://abc7.com/sports/sources-pels-defer-lakers-1st-round-pick-from-ad-trade-to-25/14896915/']),
 'SS_2024_06_26_HOU_BKN': ('2024-06-26',
                           ['https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=&offset-trade_id=0']),
 'SS_2025_01_21_UTA_PHX': ('2025-01-21',
                           ['https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385']),
 'SS_2025_02_03_CHA_OKC': ('2025-02-03',
                           ['https://www.salaryswish.com/ajax2/trades?season=2025&offset-date=2025-02-06&offset-trade_id=385'])}


def p(team, year, rnd=2):
    return [team, year, rnd]


def actions():
    meta = deepcopy(META)
    result = []
    current = None

    def event(eid):
        nonlocal current
        current = eid

    def emit(kind, **fields):
        date, sources = meta[current]
        item = dict(event_id=current, known_from=date, order=40000 + len(result),
                    reviewed=True, source=deepcopy(sources), kind=kind, **fields)
        result.append(item)
        return item

    def rule(kind, **fields):
        date, sources = meta[current]
        rid = fields.pop('rule_id', f'{current}_{len(result)}')
        emit('add_rule', rule=dict(rule_id=rid, known_from=date,
             order=40000 + len(result), reviewed=True, source=deepcopy(sources),
             kind=kind, **fields))

    def move(origin, year, source, target, rnd=2, optional=False):
        # Optional refers to a previously reviewed conditional retained claim,
        # never to uncertain knowledge of ownership.
        rule('entitlement_transfer', picks=[p(origin, year, rnd)],
             from_team=source, to_team=target,
             count_range=[0 if optional else 1, 1])

    def basket(origins, year, source, target, rnd=2, count=1):
        rule('entitlement_transfer', picks=[p(t, year, rnd) for t in origins],
             from_team=source, to_team=target, count_range=[count, count])

    def rank(origins, year, source, target, which, rnd=2, rule_id=None):
        fields = dict(picks=[p(t, year, rnd) for t in origins],
                      from_team=source, to_team=target, rank=which)
        if rule_id:
            fields['rule_id'] = rule_id
        rule('ranked_transfer', **fields)

    def chain(origin, source, target, branches, fallback=(), rnd=1, **extra):
        rule('protected_chain', from_team=source, to_team=target,
             branches=[dict(pick=p(origin, y, rnd), protected_ranges=ranges)
                       for y, ranges in branches], fallback_picks=list(fallback), **extra)

    def swap(left, right, left_owner, right_owner, protected=()):
        rule('swap', left_pick=left, right_pick=right, left_owner=left_owner,
             right_owner=right_owner, protected_ranges=list(protected))

    def selected(expr, source, target, **extra):
        rule('selected_transfer', select=expr, from_team=source, to_team=target, **extra)

    def held(origins, year, owner, rnd=2, index=0, count=(1, 1)):
        return {'held': {'picks': [p(t, year, rnd) for t in origins],
                         'owner': owner, 'index': index, 'count_range': list(count)}}

    def best(*xs): return {'best': list(xs)}
    def worst(*xs): return {'worst': list(xs)}
    def slot_if(pick, ranges, yes, no):
        return {'if_slot_in': {'pick': pick, 'range': ranges}, 'then': yes, 'else': no}

    def blocked(reason):
        emit('unresolved', reason=reason, exact_missing_terms=reason)

    def consumed(reason='Only current draft selections/rights changed; consumed before this June month-end.'):
        emit('no_future_pick_effect', reason=reason)

    event('L06984')
    # Boston already owns the better Sasser claim. Detroit conveys only its
    # complementary residual; if DET's own second is 56-60, it belongs to NYK
    # and there is no Detroit-held 2025 entitlement left to transfer.
    selected(held(['DET', 'GSW', 'WAS'], 2025, 'DET', count=(0, 1)),
             'DET', 'WAS', allow_no_selection=True)
    selected(held(['MIN', 'NYK', 'NOP', 'POR'], 2026, 'DET'), 'DET', 'WAS')
    event('L07000')
    basket(['NOP', 'CHI'], 2024, 'NOP', 'IND')
    event('L07001')
    chain('IND', 'IND', 'TOR', [(2026, [[1, 4]]), (2027, [[1, 4]])],
          [p('UTA', 2027), p('DAL', 2028)], rule_id='L07001_IND_2026_FIRST')
    chain('IND', 'IND', 'TOR', [(2024, [[1, 3]])], rule_id='L07001_IND2024_FIRST_TOP3')
    selected(worst(*[p(t, 2024) for t in ['CLE', 'UTA', 'IND']]), 'IND', 'TOR',
             conditions=[dict(pick=p('IND', 2024, 1), range=[1, 3])])
    selected(p('IND', 2025), 'IND', 'TOR',
             conditions=[dict(pick=p('IND', 2024, 1), range=[1, 3])])
    selected(held(['OKC', 'LAC', 'HOU', 'UTA'], 2024, 'IND', rnd=1), 'IND', 'TOR')
    event('L07064')
    chain('MIA', 'MIA', 'CHA', [(2027, [[1, 14]]), (2028, [])],
          requires_gap_after_rule='MIA_PG_ORIGINAL_2019', minimum_gap_years=2,
          requires_prior_conveyance=True, rule_id='L07064_MIA2027_FIRST')
    # The later CHA-to-MIA second-round settlement was announced March 9,
    # 2026. RealGM retroactively appends it to this original trade. It must not
    # enter the January 2024 knowledge set.
    consumed('Original Rozier trade only conveyed the protected MIA first; the appended CHA second was a separately dated March 2026 settlement.')
    event('L07130')
    move('OKC', 2024, 'HOU', 'MEM')
    rank(['HOU', 'OKC'], 2025, 'HOU', 'MEM', 'best')
    selected({'best_eligible': [dict(pick=p('GSW', 2024), protected_ranges=[[56, 60]]),
                                dict(pick=p('BKN', 2024), protected_ranges=[[55, 60]])]},
             'HOU', 'MEM', allow_no_selection=True)
    event('L07175')
    move('ATL', 2027, 'BOS', 'MEM'); move('DAL', 2030, 'BOS', 'MEM')
    event('L07176')
    rank(['NOP', 'MIL', 'CLE'], 2024, 'IND', 'GSW', 'worst')
    rule('entitlement_transfer', picks=[p('CHA', 2025)], from_team='GSW', to_team='IND', count_range=[0, 1])
    event('L07177')
    selected(worst(p('POR', 2027), p('NOP', 2027)), 'POR', 'BOS', protected_ranges=[[31, 55]])
    event('L07178')
    move('NYK', 2024, 'PHI', 'DET')
    chain('DET', 'DET', 'PHI', [(2028, [[31, 55]])], rnd=2,
          rule_id='L07178_DET2028_SECOND_TOP55')
    event('L07180')
    move('NYK', 2028, 'NYK', 'DET'); move('NYK', 2029, 'NYK', 'DET')
    event('L07181')
    move('LAC', 2029, 'PHI', 'SAS'); move('POR', 2029, 'PHI', 'IND')
    selected(held(['TOR', 'IND', 'CLE', 'UTA'], 2024, 'PHI'), 'PHI', 'IND')
    event('L07182')
    rule('holder_pool_swap', left_pool=[p('OKC', 2028, 1)], right_pool=[p('DAL', 2028, 1)],
         left_owner='OKC', right_owner='DAL', rule_id='L07182_OKC_DAL_2028_SWAP')
    selected(held(['OKC', 'LAC', 'HOU', 'UTA'], 2024, 'OKC', rnd=1, index=-1, count=(1, 3)), 'OKC', 'DAL')
    selected(held(['OKC', 'LAC', 'HOU', 'UTA'], 2024, 'DAL', rnd=1), 'DAL', 'WAS')
    event('L07183')
    move('HOU', 2024, 'OKC', 'CHA'); move('PHI', 2025, 'OKC', 'CHA')
    event('L07184')
    basket(['CHI', 'NOP'], 2024, 'BOS', 'PHI')
    event('L07188')
    move('MIN', 2030, 'MIN', 'DET')
    event('L07189')
    basket(['OKC', 'LAC', 'HOU', 'UTA'], 2024, 'TOR', 'UTA', rnd=1)
    event('L07190')
    move('MIL', 2027, 'MIL', 'PHI')
    event('L07191')
    basket(['DET', 'ORL', 'MIL'], 2026, 'PHX', 'BKN')
    move('MEM', 2028, 'PHX', 'BKN'); move('MEM', 2029, 'PHX', 'BKN')
    rule('holder_pool_swap', left_pool=[p('MEM', 2026, 1)],
         right_pool=[p(t, 2026, 1) for t in ['PHX', 'WAS', 'ORL']],
         left_owner='MEM', right_owner='PHX', rule_id='L07191_MEM_PHX_2026_RESIDUAL_SWAP')
    event('L07192')
    chain('DAL', 'DAL', 'CHA', [(2027, [[1, 2]])], [p('MIA', 2028)],
          rule_id='L07192_DAL2027_FIRST_TOP2')
    move('BOS', 2024, 'CHA', 'DAL')
    rank(['CHA', 'LAC'], 2028, 'CHA', 'DAL', 'worst')
    event('L07193')
    basket(['WAS', 'MEM'], 2024, 'DET', 'UTA')
    event('L07899')
    move('DEN', 2026, 'DEN', 'PHX'); move('DEN', 2031, 'DEN', 'PHX')
    event('L07900'); consumed()
    event('L07901')
    rule('holder_pool_swap', left_pool=[p(t, 2030, 1) for t in ['SAS', 'DAL']],
         right_pool=[p('MIN', 2030, 1)], left_owner='SAS', right_owner='MIN',
         protected_ranges=[[1, 1]], rule_id='L07901_SAS_MIN2030_FIRST_SWAP')
    move('MIN', 2031, 'MIN', 'SAS', rnd=1)
    event('L07933')
    swap(p('ORL', 2030), p('NOP', 2030), 'ORL', 'NOP')
    swap(p('ORL', 2031), p('NOP', 2031), 'ORL', 'NOP')
    event('L07934')
    basket(['BOS', 'MEM'], 2025, 'OKC', 'NYK')
    move('GSW', 2026, 'OKC', 'NYK'); move('MIN', 2027, 'OKC', 'NYK')
    for index in [1, 2]:
        selected({'rank': {'picks': [p(t, 2027) for t in ['OKC', 'HOU', 'MIA', 'IND']], 'index': index}}, 'OKC', 'NYK')
    event('L07937')
    move('BOS', 2028, 'PHX', 'NYK', optional=True)
    event('L07939')
    move('MIN', 2027, 'NYK', 'POR'); move('NYK', 2030, 'NYK', 'POR')
    basket(['IND', 'WAS'], 2029, 'NYK', 'POR')
    event('L07941')
    move('POR', 2025, 'SAC', 'TOR')
    event('L08248')
    move('DAL', 2031, 'DAL', 'PHI')
    move('DEN', 2029, 'DEN', 'CHA', optional=True)
    move('DEN', 2030, 'DEN', 'CHA', optional=True)
    move('PHI', 2025, 'CHA', 'DEN')
    rank(['DEN', 'PHI'], 2025, 'DEN', 'DAL', 'best')
    basket(['DEN', 'PHI'], 2025, 'DEN', 'MIN')
    swap(p('MIN', 2031), p('GSW', 2031), 'MIN', 'GSW')
    event('L08260')
    # RealGM2024LAL nominal year is stale; original terms and SS identify2025.
    move('LAL', 2025, 'NOP', 'ATL', rnd=1)
    selected(worst(p('MIL', 2027, 1), p('NOP', 2027, 1)), 'NOP', 'ATL', protected_ranges=[[1, 4]])
    event('L08262')
    move('GSW', 2028, 'POR', 'WAS'); move('POR', 2030, 'POR', 'WAS')
    selected({'rank': {'picks': [p(t, 2029, 1) for t in ['POR', 'BOS', 'MIL']], 'index': 1}}, 'POR', 'WAS')
    event('L08264')
    move('NOP', 2025, 'SAS', 'CHA')
    event('L08277')
    move('CHI', 2027, 'WAS', 'NOP', optional=True)
    event('L08280')
    for year in [2025, 2027, 2029, 2031]:
        move('NYK', year, 'NYK', 'BKN', rnd=1)
    move('MIL', 2025, 'NYK', 'BKN', rnd=1, optional=True)
    move('BKN', 2025, 'NYK', 'BKN')
    rule('holder_pool_swap', left_pool=[p(t, 2028, 1) for t in ['BKN', 'PHX']],
         right_pool=[p('NYK', 2028, 1)], left_owner='BKN', right_owner='NYK', left_rank='worst',
         rule_id='L08280_BKN_NYK_2028_SWAP')
    basket(['DET', 'MIL', 'ORL'], 2026, 'BKN', 'NYK')
    event('L08298')
    move('TOR', 2025, 'DAL', 'DET')
    basket(['CHA', 'LAC'], 2028, 'DAL', 'DET')
    move('MIA', 2028, 'DAL', 'DET', optional=True)
    event('L08343')
    chain('MEM', 'MEM', 'MIN', [(2030, [[31, 50]])], rnd=2,
          rule_id='L08343_MEM2030_SECOND_TOP50')
    event('L08373')
    move('SAC', 2025, 'SAC', 'CHI'); move('SAC', 2028, 'SAC', 'CHI')
    swap(p('SAS', 2031, 1), p('SAC', 2031, 1), 'SAS', 'SAC')
    event('L08450')
    swap(p('UTA', 2030), p('LAC', 2030), 'UTA', 'LAC')
    event('L08453')
    move('DAL', 2030, 'MEM', 'BKN')
    event('L08832')
    rule('entitlement_transfer', picks=[p('DET', y, 1) for y in range(2022, 2028)] + [p('DET', 2027)],
         from_team='NYK', to_team='MIN', count_range=[0, 1])
    move('GSW', 2026, 'NYK', 'CHA'); move('NYK', 2031, 'NYK', 'CHA')
    basket(['DEN', 'PHI'], 2025, 'MIN', 'CHA')
    event('L08950')
    move('CHI', 2025, 'SAS', 'SAC', optional=True); move('SAC', 2031, 'SAC', 'SAS')
    event('L09719')
    for team, year in [('ATL', 2026), ('ATL', 2028), ('GSW', 2029)]:
        move(team, year, 'GSW', 'BKN')
    move('MIA', 2025, 'BKN', 'GSW', optional=True)
    event('L09733')
    swap(p('MIA', 2031), p('IND', 2031), 'MIA', 'IND')
    event('L09818')
    move('LAL', 2027, 'LAL', 'BKN', optional=True)
    move('LAL', 2030, 'LAL', 'BKN'); move('LAL', 2031, 'LAL', 'BKN')

    event('L09990')
    for team, year in [('DEN', 2026), ('DEN', 2031), ('PHX', 2031)]:
        move(team, year, 'PHX', 'CHA')
    basket(['DEN', 'PHI'], 2025, 'CHA', 'PHX')
    event('L10103')
    # Utah had swap rights; this transaction adds the remaining LAC-held pick.
    move('LAC', 2030, 'LAC', 'UTA', optional=True)
    move('UTA', 2030, 'LAC', 'UTA', optional=True)
    event('L10113')
    move('LAL', 2029, 'LAL', 'DAL', rnd=1)
    move('LAC', 2025, 'LAL', 'UTA')
    # Boston's July 2023 option has already improved its best DET/GSW/WAS
    # claim using DAL. Dallas transfers the complementary remaining physical.
    selected(held(['DAL', 'DET', 'GSW', 'WAS'], 2025, 'DAL'), 'DAL', 'UTA')
    event('L10124')
    rule('entitlement_transfer', picks=[p('CHI', y, 1) for y in range(2025, 2028)] + [p('CHI', 2028)],
         from_team='SAS', to_team='CHI', count_range=[1, 1])
    rule('entitlement_transfer', picks=[p('CHA', y, 1) for y in range(2022, 2026)] + [p('CHA', 2026), p('CHA', 2027)],
         from_team='SAS', to_team='SAC', count_range=[1, 2])
    move('SAS', 2027, 'SAS', 'SAC', rnd=1)
    move('MIN', 2031, 'SAS', 'SAC', rnd=1)
    move('DEN', 2028, 'SAS', 'SAC', optional=True)
    move('SAC', 2028, 'CHI', 'SAC')
    emit('patch_rule', rule_id='OPEN_CHI2025R2_PROTECTED_TO_SAS',
         changes=[dict(path=['branches', 0, 'protected_ranges'], expected=[[31, 55]], value=[])])
    consumed('Removing protection changes the existing SAS-to-SAC entitlement to unconditional; no additional physical second is created.')
    event('L10134')
    move('PHI', 2030, 'PHI', 'DAL')
    basket(['DEN', 'PHI'], 2025, 'DAL', 'PHI')
    event('L10139')
    basket(['NOP', 'ORL'], 2031, 'NOP', 'OKC')
    event('L10140')
    move('DEN', 2028, 'SAC', 'WAS', optional=True); move('SAC', 2029, 'SAC', 'WAS')
    event('L10146')
    chain('TOR', 'TOR', 'IND', [(2026, [[31, 55]])], rnd=2,
          rule_id='L10146_TOR2026_SECOND_TOP55')
    event('L10147')
    chain('HOU', 'HOU', 'BOS', [(2031, [[31, 55]])], rnd=2,
          rule_id='L10147_HOU2031_SECOND_TOP55')
    move('BOS', 2030, 'BOS', 'HOU')
    selected(worst(p('POR', 2027), p('NOP', 2027)), 'BOS', 'HOU', protected_ranges=[[31, 55]])
    event('L10149')
    move('MIN', 2025, 'ATL', 'LAC'); move('MEM', 2026, 'ATL', 'LAC', optional=True)
    move('LAC', 2027, 'ATL', 'LAC')
    event('L10151')
    rule('entitlement_transfer', picks=[p('IND', 2026, 1), p('IND', 2027, 1), p('UTA', 2027), p('DAL', 2028)],
         from_team='TOR', to_team='NOP', count_range=[1, 2])
    move('TOR', 2031, 'TOR', 'NOP')
    event('L10154')
    for year in [2027, 2029, 2031]:
        move('CLE', year, 'CLE', 'ATL')
    rule('holder_pool_swap', left_pool=[p(t, 2026, 1) for t in ['ATL', 'SAS']],
         right_pool=[p(t, 2026, 1) for t in ['CLE', 'UTA', 'MIN']],
         left_owner='ATL', right_owner='CLE', rule_id='L10154_ATL_CLE_2026_RESIDUAL_SWAP')
    rule('holder_pool_swap', left_pool=[p('ATL', 2028, 1)],
         right_pool=[p(t, 2028, 1) for t in ['CLE', 'UTA']],
         left_owner='ATL', right_owner='CLE', rule_id='L10154_ATL_CLE_2028_RESIDUAL_SWAP')
    event('L10155')
    chain('GSW', 'GSW', 'MIA', [(2025, [[1, 10]]), (2026, [[1, 10]]), (2027, [])],
          rule_id='L10155_GSW2025_FIRST_TO_MIA')
    move('LAL', 2026, 'MIA', 'TOR')
    basket(['GSW', 'MIN'], 2031, 'GSW', 'DET')
    basket(['MIA', 'IND'], 2031, 'MIA', 'UTA')
    selected(held(['DET', 'CHA', 'LAC', 'MIA', 'NYK'], 2028, 'DET', index=-1, count=(2, 4)), 'DET', 'UTA')
    event('L10156')
    move('SAC', 2028, 'SAC', 'MEM')
    chain('MEM', 'MEM', 'WAS', [(2025, [[1, 14]])], rule_id='L10156_MEM2025_FIRST_LOTTERY')
    selected(held(['DET', 'GSW', 'WAS', 'PHX'], 2025, 'WAS', index=-1, count=(1, 2)), 'WAS', 'MEM')
    result[-1]['rule']['valuation_assumption'] = 'Honor the earlier Milwaukee second-best claim first. Memphis receives the least of Washington remaining claims. In the counterfactual DET2025protected56–60 branch with only two original claims this is the sole residual, which differs from abbreviated overlapping least-of-original-pool descriptions.'
    result[-1]['rule']['assumption_branch'] = dict(trigger='Washington holds exactly one claim after the earlier Milwaukee second-best transfer', pool=[p(t,2025) for t in ['DET','GSW','WAS','PHX']], held_by='WAS', held_count=1, resolved_after='2025-05-12')
    result[-1]['rule']['source'].append('https://www.hoopsrumors.com/2025/02/trade-deadline-leftovers-ingram-draft-pick-details-tax-projections-more.html')
    event('L10159')
    rank(['DEN', 'GSW'], 2026, 'CHA', 'PHX', 'worst')
    selected(held(['PHX', 'WAS', 'ORL', 'MEM'], 2026, 'PHX', rnd=1), 'PHX', 'CHA')
    event('L10160')
    move('MIL', 2027, 'PHI', 'DET'); move('DAL', 2031, 'PHI', 'DET')
    event('L10163')
    rule('holder_pool_swap', left_pool=[p(t, 2028, 1) for t in ['WAS', 'PHX', 'BKN', 'PHI']],
         right_pool=[p(t, 2028, 1) for t in ['MIL', 'POR']],
         left_owner='WAS', right_owner='MIL', rule_id='L10163_WAS_MIL2028_FIRST_SWAP')
    # Milwaukee's agreement was reported February5, before the February6
    # Smart agreement. Both finalized February6; retain that earlier priority
    # within the same dated legal view, without backdating the Smart transfer.
    selected(held(['DET', 'PHX', 'GSW', 'WAS'], 2025, 'WAS', index=1, count=(2, 3)), 'WAS', 'MIL')
    result[-1]['rule']['order'] = 39990
    result[-1]['rule']['source'].append('https://www.brewhoop.com/2025/2/5/24359407/nba-trade-deadline-milwaukee-bucks-kyle-kuzma-khris-middleton-aj-johnson-first-round-pick')
    move('UTA', 2026, 'MIL', 'SAS', optional=True)
    event('L10164')
    basket(['OKC', 'LAC', 'HOU'], 2026, 'PHI', 'WAS', rnd=1)
    rank(['GSW', 'PHX'], 2027, 'WAS', 'PHI', 'best')
    move('GSW', 2028, 'WAS', 'PHI')
    rank(['PHX', 'POR'], 2030, 'WAS', 'PHI', 'best')
    move('WAS', 2030, 'WAS', 'PHI')
    event('L10177')
    move('HOU', 2028, 'ATL', 'HOU')
    event('L10676')
    for year in [2025, 2028, 2030]:
        move('ORL', year, 'ORL', 'MEM', rnd=1)
    selected(held(['ORL', 'PHX', 'WAS'], 2026, 'ORL', rnd=1), 'ORL', 'MEM')
    swap(p('MEM', 2029, 1), p('ORL', 2029, 1), 'MEM', 'ORL', [[1, 2]])
    # If Orlando's first is top two, Memphis gets its second instead.
    # The original swap rule's fallback is only triggered by that protection.
    result[-1]['rule']['fallback_picks'] = [p('ORL', 2029)]
    event('L10679')
    rule('entitlement_transfer', picks=[p('IND', 2026, 1), p('IND', 2027, 1), p('UTA', 2027), p('DAL', 2028)],
         from_team='NOP', to_team='IND', count_range=[1, 2])
    move('IND', 2025, 'IND', 'NOP', rnd=1)
    event('L10722')
    basket(['NOP', 'MIL'], 2026, 'NOP', 'ATL', rnd=1)
    event('L10723')
    move('ORL', 2028, 'MEM', 'POR', rnd=1)
    move('ATL', 2027, 'MEM', 'POR'); move('SAC', 2028, 'MEM', 'POR')
    event('L10724')
    chain('SAS', 'SAC', 'OKC', [(2027, [[1, 16]])],
          [p('SAC', 2027), p('CHA', 2027)], rule_id='L10724_SAS2027_FIRST_TOP16')
    result[-1]['rule']['source'].append('https://basketball.realgm.com/nba/draft/future_drafts/detailed')
    result[-1]['rule']['review_note'] = 'Original SS fallback labels SAN second, but seller SAC owns and promises its own second plus CHA. Detailed legal register and contemporaneous Sacramento Bee both confirm SAC, not SAN.'
    event('L10725')
    move('UTA', 2032, 'UTA', 'WAS')
    basket(['MIA', 'IND'], 2031, 'UTA', 'WAS')
    event('L10756')
    rank(['DET', 'ORL', 'MIL'], 2026, 'ORL', 'BOS', 'best')
    rank(['ORL', 'BOS'], 2027, 'ORL', 'BOS', 'best')
    event('L10762')
    move('HOU', 2029, 'OKC', 'WAS')
    event('L10790')
    rank(['LAC', 'UTA'], 2030, 'UTA', 'CHA', 'best')
    event('L10823')
    basket(['CLE', 'UTA', 'MIN'], 2029, 'PHX', 'CHA', rnd=1)
    move('PHX', 2029, 'CHA', 'PHX')
    event('L11078')
    move('BOS', 2030, 'HOU', 'BKN')
    move('HOU', 2032, 'HOU', 'PHX')
    selected(held(['BOS', 'IND', 'MIA', 'LAC'], 2026, 'HOU'), 'HOU', 'BKN')
    selected({'rank': {'picks': [p(t, 2026) for t in ['OKC', 'DAL', 'PHI']], 'index': 1}}, 'HOU', 'PHX')
    selected(held(['GSW', 'DEN'], 2026, 'PHX'), 'PHX', 'MIN')
    swap(p('ATL', 2031), p('HOU', 2031), 'ATL', 'HOU', [[56, 60]])
    move('PHX', 2032, 'PHX', 'MIN')
    rule('holder_pool_swap', left_pool=[p('PHX', 2032)], right_pool=[p('HOU', 2032)],
         left_owner='MIN', right_owner='PHX', rule_id='L11078_MIN_PHX_HOU2032_SECOND_SWAP')
    event('L11094')
    move('POR', 2029, 'IND', 'MEM')
    rule('holder_pool_swap', left_pool=[p('MEM', 2031)],
         right_pool=[p(t, 2031) for t in ['IND', 'MIA']], left_owner='MEM', right_owner='IND',
         rule_id='L11094_MEM_2031_HUFF_SWAP')
    event('L11104')
    move('CLE', 2027, 'ATL', 'MIN')
    event('L11106')
    move('CHI', 2027, 'NOP', 'WAS', optional=True)
    move('CHI', 2026, 'WAS', 'HOU'); move('SAC', 2029, 'WAS', 'HOU')
    event('L11122')
    move('SAC', 2030, 'IND', 'SAS')
    event('L11123')
    chain('GSW', 'GSW', 'MEM', [(2032, [[31, 50]])], rnd=2,
          rule_id='L11123_GSW2032_SECOND_TOP50')
    event('L11126')
    move('MIL', 2031, 'MIL', 'CHA'); move('MIL', 2032, 'MIL', 'CHA')
    event('L11129')
    move('CHA', 2026, 'SAC', 'DET', optional=True)
    rank(['MIL', 'NYK', 'DET'], 2029, 'DET', 'SAC', 'worst')
    event('L11149')
    move('CLE', 2031, 'ATL', 'BOS')
    selected(held(['BOS', 'IND', 'MIA'], 2026, 'BOS'), 'BOS', 'ATL')
    event('L11154')
    move('LAC', 2027, 'LAC', 'UTA')
    event('L11177')
    move('DEN', 2032, 'DEN', 'BKN', rnd=1)
    event('L11191')
    basket(['DAL', 'PHI', 'OKC'], 2026, 'SAS', 'WAS')
    event('L11326')
    basket(['BOS', 'ORL'], 2027, 'BOS', 'UTA')
    rank(['BOS', 'CLE'], 2031, 'BOS', 'UTA', 'best')
    event('L11341')
    move('MIA', 2032, 'MIA', 'BKN')
    chain('BKN', 'BKN', 'MIA', [(2026, [[31, 55]])], rnd=2,
          rule_id='L11341_BKN2026_SECOND_TOP55')
    result[-1]['source'].append('https://www.nba.com/nets/news/brooklyn-nets-acquire-haywood-highsmith-and-draft-compensation-from-miami/')
    result[-1]['rule']['source'].append('https://www.nba.com/nets/news/brooklyn-nets-acquire-haywood-highsmith-and-draft-compensation-from-miami/')

    event('DECISION_2024_06_01_NOP_LAL_DEFER')
    emit('patch_rule', rule_id='NOP_LAL_2024_OR_2025_AD_CHOICE',
         changes=[dict(path=['decision_by_slot'], value={str(i): 'later' for i in range(1, 31)})])

    # Pick-only transactions missing from the current RealGM pick register.
    event('SS_2024_06_26_HOU_BKN')
    move('BKN', 2026, 'HOU', 'BKN', rnd=1)
    emit('disable_rule', rule_id='HOU_BKN_2025_POST_OKC_SWAP')
    rule('holder_pool_swap', left_pool=[p(t, 2025, 1) for t in ['HOU', 'OKC']],
         right_pool=[p('PHX', 2025, 1)], left_owner='HOU', right_owner='BKN',
         rule_id='SS_2024_06_26_HOU_PHX_2025_SWAP')
    move('PHX', 2027, 'BKN', 'HOU', rnd=1)
    rule('partition', picks=[p(t, 2029, 1) for t in ['DAL', 'PHX', 'HOU']],
         expected_owners=[[p('DAL', 2029, 1), 'BKN'], [p('PHX', 2029, 1), 'BKN'], [p('HOU', 2029, 1), 'HOU']],
         owners_by_rank=['HOU', 'HOU', 'BKN'], rule_id='SS_2024_06_26_HOU_BKN2029_FIRST_PARTITION')
    event('SS_2025_01_21_UTA_PHX')
    rank(['CLE', 'MIN'], 2025, 'UTA', 'PHX', 'worst', rnd=1,
         rule_id='SS_2025_01_21_UTA_PHX_2025_BASKET')
    rank(['UTA', 'CLE', 'MIN'], 2027, 'UTA', 'PHX', 'worst', rnd=1,
         rule_id='SS_2025_01_21_UTA_PHX_2027_BASKET')
    rank(['UTA', 'CLE', 'MIN'], 2029, 'UTA', 'PHX', 'worst', rnd=1,
         rule_id='SS_2025_01_21_UTA_PHX_2029_BASKET')
    rule('transfer', pick=p('PHX', 2031, 1), from_team='PHX', to_team='UTA',
         rule_id='SS_2025_01_21_PHX2031R1_to_UTA')
    event('SS_2025_02_03_CHA_OKC')
    move('PHX', 2029, 'OKC', 'CHA'); move('DEN', 2030, 'CHA', 'OKC', optional=True)
    return deepcopy(result)
