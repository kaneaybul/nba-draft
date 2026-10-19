"""Refresh factual NBA injury timelines from ESPN/RotoWire and NBA game dates.

No medical recovery priors: unknown return times stay unknown. News text is
parsed in memory; the public artifact contains facts and source links only.
"""
from __future__ import annotations

import argparse
import calendar
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
TEAM_IDS = dict(zip(
    "ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split(),
    [1, 2, 17, 30, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 29, 14, 15, 16, 3, 18, 25, 19, 20, 21, 22, 23, 24, 28, 26, 27]))
ALIASES = {"UTAH": "UTA", "GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "WSH": "WAS", "PHO": "PHX", "BRK": "BKN"}
WORDS = {v: i for i, v in enumerate("zero one two three four five six seven eight nine ten eleven twelve".split())}
WORDS.update({"a": 1, "an": 1})
NUM = r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an|a)"
SPAN = rf"(?P<lo>{NUM})(?:\s*(?:-\s*(?:to\s*-?)?|to|or|–|—)\s*(?P<hi>{NUM}))?\s*(?P<unit>days?|weeks?|months?|games?)"
MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
ET = ZoneInfo("America/New_York")


def iso_datetime(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def number(value):
    return int(value) if value.isdigit() else WORDS[value.lower()]


def add_span(day, amount, unit):
    if unit.startswith("month"):
        month = day.month - 1 + amount
        year = day.year + month // 12
        month = month % 12 + 1
        return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))
    return day + timedelta(days=amount * (7 if unit.startswith("week") else 1))


def name_key(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", value))


def season_for(day):
    return day.year + (day.month >= 7)


def parse_timeline(injury, season, today):
    report = iso_datetime(injury["date"]).astimezone(ET).date()
    text = " ".join(str(injury.get(k, "")) for k in ("shortComment", "longComment"))
    details = injury.get("details") or {}
    provider = details.get("returnDate")
    try:
        provider = date.fromisoformat(provider[:10]) if provider else None
    except (ValueError, TypeError):
        provider = None
    stale = (today - report).days > 30
    result = dict(return_earliest=None, return_expected=None, return_latest=None,
                  reevaluation_date=None, reevaluation_latest=None, minimum_games=None, minimum_games_from_start=False,
                  provider_return_date=provider.isoformat() if provider else None,
                  basis="unknown", confidence="low", season_ending=False,
                  stale_report=stale, timeline_note="Return timetable unknown.")
    # 'Remainder of the season' in an old report refers to THAT season.
    full_season = re.search(r"season[- ]ending|miss (?:the (?:entirety of the )?|all of (?:the )?|the remainder of (?:the )?|the rest of (?:the )?)(?:20\d{2}-\d{2} )?season", text, re.I)
    # Scope season labels to the actual season-ending statement, not unrelated
    # history or 'may miss the start of next season' elsewhere in the update.
    season_sentence = ""
    if full_season:
        left = max(text.rfind(mark, 0, full_season.start()) for mark in ".!?") + 1
        right = min([pos for mark in ".!?" if (pos := text.find(mark, full_season.end())) >= 0] or [len(text)])
        season_sentence = text[left:right]
    seasons = [int(m[1]) + 1 for m in re.finditer(r"\b(20\d{2})-\d{2}\b", season_sentence)]
    same_season = season in seasons if seasons else season_for(report) == season
    if full_season and same_season:
        result.update(basis="season_ending", confidence="medium" if re.search(r"believed|suspected|likely|could", season_sentence, re.I) else "high", season_ending=True,
                      timeline_note=f"Reported out for the {season - 1}-{str(season)[2:]} season.")
        return result

    # A re-evaluation is a review of progress, never a clearance date.
    review = re.search(rf"re[- ]?evaluat\w*[^.;]{{0,65}}?\b(?:in|after)\s+(?P<span>{SPAN})", text, re.I)
    if review:
        lo, hi = number(review["lo"].lower()), number((review["hi"] or review["lo"]).lower())
        low, high = add_span(report, lo, review["unit"]), add_span(report, hi, review["unit"])
        result.update(reevaluation_date=low.isoformat(), reevaluation_latest=high.isoformat(),
                      return_earliest=low.isoformat() if low > today else None,
                      basis="reevaluation", confidence="low",
                      timeline_note=f"Re-evaluation {low.isoformat()}" + (f" to {high.isoformat()}" if high != low else "") + "; return remains uncertain.")
        return result

    # Explicit month windows outrank a site's first-possible-game placeholder.
    window = re.search(rf"(?:between|from)\s+({MONTH})\s+(?:and|to)\s+({MONTH})", text, re.I)
    if window:
        months = {calendar.month_name[i].lower(): i for i in range(1, 13)}
        first, last = months[window[1].lower()], months[window[2].lower()]
        first_year = report.year + (first < report.month)
        last_year = first_year + (last < first)
        low = date(first_year, first, 1)
        high = date(last_year, last, calendar.monthrange(last_year, last)[1])
        result.update(return_earliest=low.isoformat(), return_expected=(low + (high - low) // 2).isoformat(),
                      return_latest=high.isoformat(), basis="reported_window", confidence="medium",
                      timeline_note="Reported return window; midpoint used for the planning estimate.")
    else:
        # Only durations explicitly tied to missing time / returning are used.
        duration = re.search(rf"(?:miss|sidelined for|out for|away from returning[^.;]{{0,20}}|return in|away from (?:a )?return)\s+(?:at least\s+|about\s+|approximately\s+|the next\s+|the first\s+|at least the (?:next|first)\s+)?{SPAN}", text, re.I)
        if not duration:
            duration = re.search(rf"(?:about\s+)?{SPAN}\s+away from (?:returning|a return)", text, re.I)
        if duration and not duration["unit"].lower().startswith("game"):
            low = add_span(report, number(duration["lo"].lower()), duration["unit"].lower())
            high = add_span(report, number((duration["hi"] or duration["lo"]).lower()), duration["unit"].lower())
            minimum = "at least" in duration[0].lower()
            result.update(return_earliest=low.isoformat(), return_expected=None if minimum else (low + (high - low) // 2).isoformat(),
                          return_latest=None if minimum else high.isoformat(), basis="reported_minimum" if minimum else "reported_duration",
                          confidence="medium", timeline_note="Reported minimum absence; later return possible." if minimum else "Reported absence duration, measured from the report date.")
        elif duration:
            result.update(minimum_games=number(duration["lo"].lower()), basis="reported_games", confidence="medium",
                          minimum_games_from_start=bool(re.search(r"\bfirst\b", duration[0], re.I)),
                          timeline_note="Reported minimum games missed; no confirmed return date.")

    no_timetable = re.search(r"(?:without|no|doesn.t have|hasn.t (?:set|provided))\s+(?:(?:a|any|definitive|firm|clear|set|specific|official)\s+)*(?:return\s+)?(?:timetable|timeline)|return (?:timetable|timeline)\s+(?:is\s+)?(?:unclear|unknown)", text, re.I)
    if result["basis"] == "unknown" and no_timetable:
        result["timeline_note"] = "Team return timetable unknown; ESPN's estimated date is not treated as clearance."
    elif result["basis"] == "unknown" and provider and provider >= today:
        result.update(return_expected=provider.isoformat(), basis="provider_estimate", confidence="low",
                      timeline_note="ESPN/RotoWire estimate; subject to change, not confirmed clearance.")
    # Never roll an expired date forward to 'tomorrow'.
    for key in ("return_earliest", "return_expected", "return_latest"):
        if result[key] and date.fromisoformat(result[key]) < today:
            result[key] = None
    if stale:
        result["confidence"] = "low"
        result["timeline_note"] += " Latest listed report is over 30 days old."
    return result


def schedule_games(payload, season, now):
    if int(payload.get("season", {}).get("year", 0)) != season:
        raise ValueError("ESPN schedule season does not match injury season")
    events = {str(e["id"]): e for e in payload.get("events", [])
              if int(e.get("season", {}).get("year", 0)) == season
              and int(e.get("seasonType", {}).get("type", 0)) == 2}
    if not 70 <= len(events) <= 82:
        raise ValueError(f"Incomplete regular-season schedule: {len(events)} events")
    games = []
    completed = 0
    for e in events.values():
        competition = e.get("competitions", [{}])[0]
        done = competition.get("status", {}).get("type", {}).get("completed", False)
        completed += bool(done)
        when = iso_datetime(e["date"])
        if not done and when >= now:
            games.append(dict(id=str(e["id"]), date=when.astimezone(ET).date().isoformat()))
    return sorted(games, key=lambda x: (x["date"], x["id"])), completed, max(0, 82 - len(events))


def calculate_absence(timeline, games, today, completed=0, completed_since_report=0):
    def count_until(value):
        return sum(g["date"] < value for g in games) if value else None
    def days_until(value):
        return max(0, (date.fromisoformat(value) - today).days) if value else None
    low, expected, high = (count_until(timeline[k]) for k in ("return_earliest", "return_expected", "return_latest"))
    if timeline["season_ending"]:
        low = expected = high = max(0, 82 - completed)
    if timeline["minimum_games"] is not None:
        # Opening games count from season start; 'next N' counts from the report.
        elapsed_games = completed if timeline["minimum_games_from_start"] else completed_since_report
        low = max(low or 0, max(0, timeline["minimum_games"] - elapsed_games))
    if expected is not None and low is not None:
        expected = max(low, expected)
    return dict(days_remaining_min=days_until(timeline["return_earliest"]),
                days_remaining_expected=days_until(timeline["return_expected"]),
                days_remaining_max=days_until(timeline["return_latest"]),
                games_missed_min=low, games_missed_expected=expected, games_missed_max=high)


def fetch_json(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "NBA-Impact-Lab/1.0", "Accept": "application/json"}), timeout=25) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def build_outlook(feed, schedules, now):
    if feed.get("status") != "success" or not isinstance(feed.get("injuries"), list):
        raise ValueError("Invalid ESPN injury response; refusing to replace the last outlook")
    season = int(feed["season"]["year"])
    if season != season_for(now.astimezone(ET).date()):
        raise ValueError("ESPN injury season is stale")
    age = (now - iso_datetime(feed["timestamp"])).total_seconds()
    if not -300 <= age <= 6 * 3600:
        raise ValueError("ESPN injury feed timestamp is stale")
    if set(schedules) != set(TEAM_IDS):
        raise ValueError("Schedules for all 30 teams are required")
    today = now.astimezone(ET).date()
    schedule_data = {team: schedule_games(payload, season, now) for team, payload in schedules.items()}
    rows = {}
    for group in feed["injuries"]:
        team = next((k for k, v in TEAM_IDS.items() if str(v) == str(group["id"])), None)
        if not team:
            raise ValueError(f"Unrecognized ESPN team {group['id']}")
        games, completed, tbd = schedule_data[team]
        for injury in group.get("injuries", []):
            athlete = injury["athlete"]
            timeline = parse_timeline(injury, season, today)
            report_time = iso_datetime(injury["date"])
            completed_since_report = len({str(event["id"]) for event in schedules[team].get("events", [])
                if int(event.get("seasonType", {}).get("type", 0)) == 2
                and event.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("completed", False)
                and iso_datetime(event["date"]) >= report_time})
            link = next((x["href"] for x in athlete.get("links", []) if "news" in x.get("rel", []) and x["href"].startswith("https://")), "https://www.espn.com/nba/injuries")
            row = dict(player_name=athlete["displayName"], name_key=name_key(athlete["displayName"]),
                       team=team, season=season, status=injury["status"],
                       injury_type=(injury.get("details") or {}).get("type", "Undisclosed"),
                       report_date=injury["date"], source="ESPN / RotoWire", source_url=link,
                       schedule_games_remaining=len(games), schedule_games_tbd=tbd,
                       **timeline, **calculate_absence(timeline, games, today, completed, completed_since_report))
            key = (team, row["name_key"])
            if key not in rows or row["report_date"] > rows[key]["report_date"]:
                rows[key] = row
    players = sorted(rows.values(), key=lambda r: (r["team"], r["player_name"]))
    return dict(schema_version=1, generated_at=now.isoformat().replace("+00:00", "Z"),
                source_updated_at=feed["timestamp"], season=season, teams_checked=30,
                source_url="https://www.espn.com/nba/injuries", source="ESPN / RotoWire",
                policy="Report windows and minimum absences take precedence over provider estimates. Re-evaluation is not a return date. Unknown timetables stay unknown. Game counts use future regular-season dates in NBA Eastern time; TBD Cup games are excluded except for season-ending absences.",
                players=players)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "frontend/public/data/injury_outlook.json")
    parser.add_argument("--feed", type=Path, help="Read an already fetched feed for reproducible checks")
    parser.add_argument("--schedules-dir", type=Path, help="Read already fetched team schedules")
    args = parser.parse_args()
    feed = json.loads(args.feed.read_text()) if args.feed else fetch_json(f"{API}/injuries")
    season = int(feed["season"]["year"])
    def get_schedule(item):
        team, ident = item
        if args.schedules_dir:
            return team, json.loads((args.schedules_dir / f"{team}.json").read_text())
        return team, fetch_json(f"{API}/teams/{ident}/schedule?season={season}&seasontype=2")
    with ThreadPoolExecutor(max_workers=6) as pool:
        schedules = dict(pool.map(get_schedule, TEAM_IDS.items()))
    outlook = build_outlook(feed, schedules, datetime.now(timezone.utc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(outlook, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(args.output)
    print(f"Injury outlook refreshed: {len(outlook['players'])} players; 30 schedules; season {season}; {outlook['generated_at']}")


if __name__ == "__main__":
    main()
