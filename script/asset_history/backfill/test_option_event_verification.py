import unittest
from refresh_contracts import option_verified


class OptionEvents(unittest.TestCase):
    def test_original_dated_decision_must_match_the_option_year_and_cutoff(self):
        event=dict(date='2026-10-31',contract_option=dict(decision='exercised',kind='team_option',ordinal=3))
        agreement=dict(nba_id=7,player_name='Fixture',known_from='2025-07-01',source='fixture',salaries=[
            dict(year=2026,kind='salary'),dict(year=2027,kind='salary'),
            dict(year=2028,kind='team_option',option_used_current_diagnostic='Yes (Oct 31, 2026)')])
        self.assertTrue(option_verified(event,7,[agreement],'2026-11-01'))
        self.assertFalse(option_verified(event,7,[agreement],'2026-10-30'))
        event['contract_option']['ordinal']=4
        self.assertFalse(option_verified(event,7,[agreement],'2026-11-01'))

    def test_decline_cannot_be_satisfied_by_an_exercise(self):
        event=dict(date='2026-10-31',contract_option=dict(decision='declined',kind='team_option',ordinal=3))
        agreement=dict(nba_id=7,player_name='Fixture',known_from='2025-07-01',source='fixture',salaries=[
            dict(year=2026,kind='salary'),dict(year=2028,kind='team_option',option_used_current_diagnostic='Yes (Oct 31, 2026)')])
        self.assertFalse(option_verified(event,7,[agreement],'2026-11-01'))


if __name__=='__main__':unittest.main()
