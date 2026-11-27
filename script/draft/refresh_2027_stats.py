"""Refresh current-season stats for the curated 2027 draft board."""

import argparse
import csv
import gzip
import io
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SEASON = 2027
TORVIK_SEASON = f"https://barttorvik.com/getadvstats.php?year={SEASON}&conyes=0&csv=1"
TORVIK_GAMES = f"https://barttorvik.com/{SEASON}_all_advgames.json.gz"
TEAM_ALIASES = {"Miami": "Miami FL", "Michigan State": "Michigan St.",
                "Ohio State": "Ohio St.", "UConn": "Connecticut"}
BOX_COLUMNS = {"pts": 33, "two_m": 23, "two_a": 24, "3pm": 25, "3pa": 26,
               "ftm": 27, "fta": 28, "oreb": 34, "dreb": 35, "ast": 36,
               "tov": 37, "stl": 38, "blk": 39, "pf": 42, "rim_fgm": 19, "rim_fga": 20}
SEASON_COLUMNS = {"or_pct": 9, "dr_pct": 10, "ast_pct": 11, "to_pct": 12,
                  "stl_pct": 22, "blk_pct": 23, "usg": 6}
REALGM_BOX = {"pts": "PTS", "fgm": "FGM", "fga": "FGA", "3pm": "3PM", "3pa": "3PA",
              "ftm": "FTM", "fta": "FTA", "oreb": "OFF", "dreb": "DEF", "ast": "AST",
              "tov": "TOV", "stl": "STL", "blk": "BLK", "pf": "PF"}
REALGM_RATES = {"misc_orb_pct": "ORB%", "misc_drb_pct": "DRB%", "misc_ast_pct": "AST%",
                "misc_stl_pct": "STL%", "misc_blk_pct": "BLK%", "misc_usg_pct": "USG%",
                "misc_total_s_pct": "Total S %"}


def download(url):
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as response:
        return response.read()


def name_key(name):
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name))


def number(value):
    if value in ("", "-", "--"):
        return None
    value = float(value)
    return int(value) if value.is_integer() else value


def rate(numerator, denominator, scale=100):
    return round(scale * numerator / denominator, 3) if denominator else None


def torvik_feeds(today):
    seasons = {row[32]: row for row in csv.reader(io.StringIO(download(TORVIK_SEASON).decode("utf-8-sig")))
               if len(row) > 71 and row[31] == str(SEASON)}
    games = json.loads(gzip.decompress(download(TORVIK_GAMES)))
    if not seasons or not games:
        raise ValueError("Torvik returned an empty or wrong-season feed")
    by_id, by_name, team_minutes = defaultdict(list), defaultdict(set), defaultdict(float)
    for game in games:
        if game[8] <= 0 or not f"{SEASON - 1}1101" <= game[0] <= today:
            continue
        player_id = str(game[51])
        by_id[player_id].append(game)
        by_name[name_key(game[48]), game[47]].add(player_id)
        team_minutes[game[6], game[47]] += game[8]
    duration = defaultdict(lambda: 40)
    for (game_id, _), minutes in team_minutes.items():
        duration[game_id] = max(duration[game_id], round(minutes / 25) * 5)
    return seasons, by_id, by_name, duration


def domestic_stats(row, feeds):
    seasons, by_id, by_name, duration = feeds
    player_id = row["torvik_id"]
    if not player_id:
        team = row["pre_draft_team"]
        matches = by_name[name_key(row["player"]), TEAM_ALIASES.get(team, team)]
        if len(matches) != 1:
            return None
        player_id = next(iter(matches))
    games = by_id[player_id]
    season = seasons.get(player_id)
    if not games or season is None:
        return None
    totals = {stat: sum(game[index] for game in games) for stat, index in BOX_COLUMNS.items()}
    totals["fgm"] = totals.pop("two_m") + totals["3pm"]
    totals["fga"] = totals.pop("two_a") + totals["3pa"]
    if (len({game[6] for game in games}) != len(games)
            or (number(season[3]), number(season[19]), number(season[20]))
            != (len(games), totals["3pm"], totals["3pa"])):
        raise ValueError("Torvik game and season feeds disagree")
    minutes = sum(game[8] for game in games)
    possessions = sum(game[43] * game[8] / duration[game[6]] for game in games)
    return {**totals, **{stat: number(season[index]) for stat, index in SEASON_COLUMNS.items()},
            "torvik_id": player_id, "games": len(games), "minutes": round(minutes, 1),
            "ppg": round(totals["pts"] / len(games), 2), "stats_team": max(games, key=lambda game: game[0])[47],
            "stats_leagues": "NCAA", "stats_source_url": TORVIK_SEASON, "torvik_game_source_url": TORVIK_GAMES,
            "last_game_in_pull": datetime.strptime(max(game[0] for game in games), "%Y%m%d").date().isoformat(),
            "fg_pct": rate(totals["fgm"], totals["fga"]), "three_pct": rate(totals["3pm"], totals["3pa"]),
            "ft_pct": rate(totals["ftm"], totals["fta"]), "rim_pct": rate(totals["rim_fgm"], totals["rim_fga"]),
            "assisted_pct": number(season[70]) if totals["fgm"] else None,
            "rim_assisted_pct": number(season[68]) if totals["rim_fga"] else None,
            "threes_assisted_pct": number(season[71]) if totals["3pm"] else None,
            "torvik_estimated_3pa_100": rate(totals["3pa"], possessions),
            "torvik_estimated_rim_100": rate(totals["rim_fga"], possessions),
            "stats_status": "current-season sample"}


def realgm_rows(page, section):
    season = f"{SEASON - 1}-{SEASON % 100:02d}"
    for table in page.xpath(f'//*[@id="tabs_international_reg-{section}"]/table'):
        columns = [cell.text_content().strip() for cell in table.xpath(".//thead/tr[1]/*")]
        if columns and columns[0] == "Season":
            rows = [[cell.text_content().strip() for cell in tr.xpath("./td")] for tr in table.xpath(".//tbody/tr")]
            return [dict(zip(columns, row)) for row in rows if row and row[0].startswith(season)]
    return []


def aggregate(rows):
    if len(rows) == 1:
        return rows[0]
    return next(row for row in rows if row["League"] == "All Leagues")


def international_stats(row):
    from lxml import html

    url = row["stats_source_url"]
    if not url.startswith("https://basketball.realgm.com/player/"):
        raise ValueError("Missing verified RealGM profile")
    page = html.fromstring(download(url))
    totals, advanced = realgm_rows(page, 3), realgm_rows(page, 4)
    if not totals or not advanced:
        raise ValueError("Missing current-season RealGM tables")
    box, rates = aggregate(totals), aggregate(advanced)
    minutes, games = number(box["MIN"]), int(box["GP"])
    if minutes <= 0 or games <= 0:
        return None
    stats = {field: number(box[column]) for field, column in REALGM_BOX.items()}
    return {**stats, **{field: number(rates[column]) for field, column in REALGM_RATES.items()},
            "games": games, "minutes": minutes, "ppg": round(stats["pts"] / games, 2),
            "stats_team": "; ".join(dict.fromkeys(r["Team"] for r in totals if r["Team"] != "All Teams")),
            "stats_leagues": "; ".join(dict.fromkeys(r["League"] for r in totals if r["League"] != "All Leagues")),
            "fg_pct": rate(stats["fgm"], stats["fga"]), "three_pct": rate(stats["3pm"], stats["3pa"]),
            "ft_pct": rate(stats["ftm"], stats["fta"]),
            **{f"per36_{field}": rate(stats[box_field], minutes, 36)
               for field, box_field in {"ast": "ast", "tov": "tov", "blk": "blk", "stl": "stl",
                                        "fta": "fta", "x3pa": "3pa", "def": "dreb"}.items()}}


def read_board(path):
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        columns, rows = reader.fieldnames, list(reader)
    ranks = [int(row["big_board_rank"]) for row in rows]
    if (not rows or ranks[0] < 1 or any(b <= a for a, b in zip(ranks, ranks[1:]))
            or len({row["player"] for row in rows}) != len(rows)
            or any(row["draft_year"] != str(SEASON) or row["scv_draft"] != "3" for row in rows)):
        raise ValueError("Expected a curated 2027 draft board with strictly increasing big_board_rank and shot creation set to 3")
    return columns, rows


def stage_snapshot(input_path, snapshot_path, output_path):
    columns, previous = read_board(input_path)
    snapshot_columns, current = read_board(snapshot_path)
    if columns != snapshot_columns:
        raise ValueError("Draft snapshot columns do not match the current board")
    if len(previous) != len(current):
        raise ValueError("Draft snapshot prospect count does not match the current board")
    stats_fields = (set(BOX_COLUMNS) | set(SEASON_COLUMNS) | set(REALGM_BOX) | set(REALGM_RATES)
                    | {"games", "minutes", "ppg", "torvik_id", "stats_team", "stats_leagues", "stats_status",
                       "stats_source_url", "torvik_game_source_url", "last_game_in_pull", "fg_pct", "three_pct",
                       "ft_pct", "rim_pct", "assisted_pct", "rim_assisted_pct", "threes_assisted_pct",
                       "torvik_estimated_3pa_100", "torvik_estimated_rim_100"}
                    | {field for field in columns if field.startswith("per36_")})
    board_fields = set(columns) - stats_fields
    for old, new in zip(previous, current):
        if any(new[key] != old[key] for key in board_fields):
            raise ValueError(f"Draft snapshot changes curated inputs for {old['player']}")
        if (int(new["games"] or 0) < int(old["games"] or 0)
                or new["last_game_in_pull"] < old["last_game_in_pull"]):
            raise ValueError(f"Draft snapshot rolls back stats for {old['player']}")
    output_path.write_bytes(snapshot_path.read_bytes())


def refresh(input_path, output_path):
    columns, rows = read_board(input_path)
    today = datetime.now(ZoneInfo("America/New_York")).strftime("%Y%m%d")
    try:
        torvik = torvik_feeds(today)
    except (OSError, ValueError, KeyError, IndexError) as error:
        print(f"::warning::Draft NCAA inputs retained: {error}")
        torvik = None
    checked = 0
    for row in rows:
        try:
            if row["prediction_pool"] == "domestic":
                stats = domestic_stats(row, torvik) if torvik is not None else None
            else:
                stats = international_stats(row)
            if stats is None:
                if row["games"] and torvik is not None:
                    print(f"::warning::Draft stats retained for {row['player']}: current row missing")
                continue
            if (stats["games"] < int(row["games"] or 0)
                    or stats.get("last_game_in_pull", "") < row["last_game_in_pull"]):
                raise ValueError("source went backward")
            if not stats.keys() <= set(columns):
                raise ValueError("unexpected output fields")
            row.update({key: "" if value is None else value for key, value in stats.items()})
            checked += 1
        except (OSError, ValueError, KeyError, IndexError, TypeError, StopIteration) as error:
            print(f"::warning::Draft stats retained for {row['player']}: {error}")
    if not checked:
        raise ValueError("No current prospect stats verified")
    with output_path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Verified current stats for {checked} of {len(rows)} prospects")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--snapshot", type=Path, help="Validate and stage a collected snapshot without network access")
    args = parser.parse_args()
    if args.snapshot:
        stage_snapshot(args.input, args.snapshot, args.output)
    else:
        refresh(args.input, args.output)
