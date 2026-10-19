"""Regression cases for misleading return dates and schedule-based absences."""
from datetime import date, datetime, timezone
import unittest

from refresh_injury_outlook import calculate_absence, parse_timeline, schedule_games


class InjuryOutlookTests(unittest.TestCase):
    today = date(2026, 10, 19)

    def injury(self, text, reported="2026-10-15T18:00Z", estimated="2026-10-21"):
        return dict(date=reported, shortComment=text, longComment="", details=dict(returnDate=estimated))

    def parse(self, text, **kwargs):
        return parse_timeline(self.injury(text, **kwargs), 2027, self.today)

    def test_review_is_not_a_return(self):
        row = self.parse("The player will be re-evaluated in six weeks.")
        self.assertEqual(row["reevaluation_date"], "2026-11-26")
        self.assertIsNone(row["return_expected"])
        self.assertEqual(row["return_earliest"], "2026-11-26")

    def test_unknown_overrides_next_game_placeholder(self):
        row = self.parse("The player is without a definitive timetable for a return.")
        self.assertIsNone(row["return_expected"])
        self.assertEqual(row["provider_return_date"], "2026-10-21")

    def test_month_window_crosses_year(self):
        row = self.parse("A return between December and January is possible.")
        self.assertEqual(row["return_earliest"], "2026-12-01")
        self.assertEqual(row["return_latest"], "2027-01-31")
        self.assertEqual(row["return_expected"], "2026-12-31")

    def test_minimum_duration_is_not_exact(self):
        row = self.parse("He will miss at least the next four weeks.", reported="2026-10-07T18:00Z")
        self.assertEqual(row["return_earliest"], "2026-11-04")
        self.assertIsNone(row["return_expected"])
        self.assertIsNone(row["return_latest"])

    def test_months_use_calendar(self):
        row = self.parse("He is expected to miss six months.", reported="2026-08-24T18:00Z")
        self.assertEqual(row["return_expected"], "2027-02-24")

    def test_old_season_ending_report_does_not_end_new_season(self):
        row = self.parse("He will miss the remainder of the season.", reported="2026-02-09T18:00Z", estimated="2027-01-01")
        self.assertFalse(row["season_ending"])
        self.assertEqual(row["return_expected"], "2027-01-01")
        self.assertTrue(row["stale_report"])

    def test_current_season_ending_report(self):
        row = self.parse("He will miss the entirety of the 2026-27 season.")
        self.assertTrue(row["season_ending"])
        absence = calculate_absence(row, [], self.today, completed=10)
        self.assertEqual(absence["games_missed_expected"], 72)

    def test_unrelated_season_in_long_comment_does_not_change_season_ending_scope(self):
        injury = self.injury("He suffered a season-ending injury.")
        injury["longComment"] = "He was out of the league after the 2024-25 season."
        self.assertTrue(parse_timeline(injury, 2027, self.today)["season_ending"])
        injury = self.injury("He will miss the remainder of the season.", reported="2026-02-09T18:00Z")
        injury["longComment"] = "His absence could extend into the start of the 2026-27 season. No timetable has been announced."
        row = parse_timeline(injury, 2027, self.today)
        self.assertFalse(row["season_ending"])
        self.assertIsNone(row["return_expected"])

    def test_about_a_month_is_recognized(self):
        row = self.parse("He remains about a month away from returning to the court.", reported="2026-09-28T18:00Z")
        self.assertEqual(row["return_expected"], "2026-10-28")

    def test_expired_dates_are_not_rolled_forward(self):
        row = self.parse("Recovery continues.", estimated="2026-10-17")
        self.assertIsNone(row["return_expected"])

    def test_reported_games_do_not_reset_each_refresh(self):
        row = self.parse("He is expected to miss at least the first five or six games of the regular season.")
        self.assertEqual(row["minimum_games"], 5)
        absence = calculate_absence(row, [], self.today, completed=3)
        self.assertEqual(absence["games_missed_min"], 2)
        self.assertIsNone(absence["games_missed_expected"])

    def test_schedule_count_excludes_return_day(self):
        row = self.parse("Recovery continues.", estimated="2026-10-24")
        games = [dict(date=d, id=str(i)) for i, d in enumerate(["2026-10-21", "2026-10-23", "2026-10-24", "2026-10-27"])]
        self.assertEqual(calculate_absence(row, games, self.today)["games_missed_expected"], 2)

    def test_next_games_are_anchored_to_report_not_season_start(self):
        row = self.parse("He will miss at least the next five games.")
        absence = calculate_absence(row, [], self.today, completed=30, completed_since_report=2)
        self.assertEqual(absence["games_missed_min"], 3)

    def test_incomplete_schedule_fails(self):
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            schedule_games(dict(season=dict(year=2027), events=[]), 2027, datetime.now(timezone.utc))

    def test_expired_review_remains_uncertain(self):
        row = self.parse("He will be re-evaluated in two weeks.", reported="2026-10-01T18:00Z")
        self.assertIsNone(row["return_earliest"])
        self.assertIsNone(row["return_expected"])


if __name__ == "__main__":
    unittest.main()
