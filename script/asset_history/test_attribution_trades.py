import unittest

from attribution_trades import group_pick_claims, player_routes, portfolio_changes


class TradeDetailTests(unittest.TestCase):
    def test_three_team_routes_include_intermediate_receipts(self):
        event = {
            'text': 'A.J. Johnson was acquired by the Wizards in exchange for Jericho Sims. '
                    'Jericho Sims was acquired by the Bucks in exchange for Delon Wright. '
                    'Delon Wright was acquired by the Knicks in exchange for A.J. Johnson.',
            'players': [{'name': name} for name in ('A.J. Johnson', 'Jericho Sims', 'Delon Wright')],
        }
        teams = {'Wizards': 'WAS', 'Bucks': 'MIL', 'Knicks': 'NYK'}
        routes = {p['name']: (source, target) for p, source, target, _ in player_routes(event, teams).values()}
        self.assertEqual(routes, {
            'A.J. Johnson': ('NYK', 'WAS'), 'Jericho Sims': ('WAS', 'MIL'), 'Delon Wright': ('MIL', 'NYK'),
        })

    def test_conditional_pick_bundle_is_one_asset(self):
        rule = dict(
            rule_id='case', kind='selected_transfer', from_team='UTA', to_team='LAL',
            select={'worst': [['UTA', 2028, 2], ['LAC', 2028, 2]]},
        )
        pieces = [
            dict(id='pick:UTA:2028:2', direction='in', name='2028 UTA second', value=1e6),
            dict(id='pick:LAC:2028:2', direction='in', name='2028 LAC second', value=3e6),
        ]
        result = list(group_pick_claims(pieces, [rule], 'LAL', '2025-02-06'))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['value'], 4e6)
        self.assertIn('Least favorable', result[0]['name'])
        self.assertIn('2028 LAC second-round pick', result[0]['name'])
        self.assertIn('2028 UTA second-round pick', result[0]['name'])

    def test_ownership_direction_is_independent_of_signed_value(self):
        asset = dict(id='pick:UTA:2028:2', draft_year=2028, round=2, physical_origin='UTA',
                     holding_probability=1., value=-1e6)
        result = list(portfolio_changes({'UTA': [asset], 'LAL': []},
                                        {'UTA': [], 'LAL': [asset]}, ['UTA', 'LAL']))
        self.assertEqual([(team, p['direction'], p['value']) for team, p in result],
                         [('UTA', 'out', 1e6), ('LAL', 'in', -1e6)])


if __name__ == '__main__':
    unittest.main()
