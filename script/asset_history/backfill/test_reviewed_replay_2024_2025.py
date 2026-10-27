import itertools
import json
import unittest

from reviewed_replay_2024_2025 import actions
from reviewed_transfer_helpers import apply_selected_transfer
from pick_allocator import allocate


def p(t, y=2028, r=1): return (t, y, r)


class ReviewedReplayTests(unittest.TestCase):
    def test_actions_are_repeatable(self):
        self.assertEqual(json.dumps(actions(), sort_keys=True), json.dumps(actions(), sort_keys=True))

    def test_no_unreviewed_placeholders(self):
        rows = actions()
        self.assertFalse([r for r in rows if r['kind'] == 'unresolved'])
        self.assertTrue(all(r['reviewed'] and r['source'] for r in rows))

    def test_adams_only_eligible_component(self):
        a = next(a['rule'] for a in actions() if a['event_id'] == 'L07130'
                 and a['kind'] == 'add_rule' and a['rule']['kind'] == 'selected_transfer')
        g, b = p('GSW', 2024, 2), p('BKN', 2024, 2)
        for sg, sb in [(56, 55), (40, 55), (56, 39), (40, 39)]:
            owners = {g: 'HOU', b: 'HOU'}
            apply_selected_transfer(owners, {g: sg, b: sb}, a)
            expected = min([(v, k) for k, v in [(g, sg), (b, sb)]
                            if v <= (55 if k == g else 54)], default=None)
            self.assertEqual(sum(o == 'MEM' for o in owners.values()), int(expected is not None))
            if expected:
                self.assertEqual(owners[expected[1]], 'MEM')

    def test_banton_never_doubles_the_second(self):
        a = next(a['rule'] for a in actions() if a['event_id'] == 'L07177')
        por, nop = p('POR', 2027, 2), p('NOP', 2027, 2)
        for sp, sn in [(40, 50), (40, 59), (59, 40)]:
            worse = por if sp > sn else nop
            owners = {por: 'POR' if worse == por else 'SAS', nop: 'POR' if worse == nop else 'SAS'}
            apply_selected_transfer(owners, {por: sp, nop: sn}, a)
            self.assertEqual(sum(v == 'BOS' for v in owners.values()), int(max(sp, sn) > 55))

    def test_bridges_swap_excludes_philadelphia(self):
        a = next(a['rule'] for a in actions() if a['kind'] == 'add_rule'
                 and a['rule']['rule_id'] == 'L08280_BKN_NYK_2028_SWAP')
        b, ph, f, n = [p(t) for t in ['BKN', 'PHX', 'PHI', 'NYK']]
        for order in itertools.permutations([b, ph, f, n]):
            slots = {pick: i + 9 for i, pick in enumerate(order)}
            # Original BKN/PHX option leaves Brooklyn the two best of three.
            held = sorted([b, ph, f], key=slots.get)[:2]
            owners = {pick: 'BKN' if pick in held else 'PHX' for pick in [b, ph, f]}
            owners[n] = 'NYK'
            eligible = [pick for pick in [b, ph] if owners[pick] == 'BKN']
            left = max(eligible, key=slots.get)
            if slots[n] < slots[left]: owners[left], owners[n] = owners[n], owners[left]
            bkn_ranks = sorted(slots[k] for k, o in owners.items() if o == 'BKN')
            special = order[2] == f and order.index(n) <= 1
            self.assertEqual(bkn_ranks, [9, 11] if special else [9, 10])
            self.assertEqual(a['left_pool'], [list(b), list(ph)])

    def test_future_rozier_settlement_not_backdated(self):
        rows = [a for a in actions() if a['event_id'] == 'L07064']
        self.assertFalse([a for a in rows if a['kind'] == 'add_rule'
                          and a['rule'].get('to_team') == 'MIA'])

    def test_bagley_retained_claim_can_be_empty(self):
        a = next(a['rule'] for a in actions() if a['event_id'] == 'L06984')
        d, g, w = [p(t, 2025, 2) for t in ['DET', 'GSW', 'WAS']]
        owners = {d: 'NYK', g: 'BOS', w: 'WAS'}
        before = owners.copy()
        apply_selected_transfer(owners, {d: 58, g: 32, w: 45}, a)
        self.assertEqual(owners, before)

    def test_clifford_fallback_is_sacramento_second(self):
        a = next(a['rule'] for a in actions() if a['kind'] == 'add_rule'
                 and a['rule']['rule_id'] == 'L10724_SAS2027_FIRST_TOP16')
        self.assertEqual(a['fallback_picks'], [['SAC', 2027, 2], ['CHA', 2027, 2]])

    def test_smart_residual_honors_prior_kuzma_claim(self):
        rows = [a['rule'] for a in actions() if a['kind'] == 'add_rule'
                and a['event_id'] in ['L10163', 'L10156']
                and a['rule']['kind'] == 'selected_transfer']
        rows = sorted(rows, key=lambda r: r['order'])
        self.assertEqual([r['to_team'] for r in rows], ['MIL', 'MEM'])
        d, g, w, ph = [p(t, 2025, 2) for t in ['DET', 'GSW', 'WAS', 'PHX']]
        slots = {d: 57, g: 35, w: 45, ph: 44}
        owners = {d: 'NYK', g: 'UTA', w: 'WAS', ph: 'WAS'}
        for r in rows: apply_selected_transfer(owners, slots, r)
        self.assertEqual(owners[w], 'MIL')
        self.assertEqual(owners[ph], 'MEM')
        self.assertEqual(owners[d], 'NYK')
        self.assertIn('valuation_assumption', rows[1])


if __name__ == '__main__': unittest.main()
