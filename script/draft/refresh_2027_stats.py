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
SDV_BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
SDV_PLAYER_BOX = f"{SDV_BASE}/espn_mens_college_basketball_player_boxscores/player_box_{SEASON}.csv"
SDV_TEAM_BOX = f"{SDV_BASE}/espn_mens_college_basketball_team_boxscores/team_box_{SEASON}.csv"
SDV_PBP = f"{SDV_BASE}/espn_mens_college_basketball_pbp/play_by_play_{SEASON}.csv"
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


def _sdv_int(value):
    if value in ("", "NA", None):
        return 0
    return int(round(float(value)))


def _sdv_float(value):
    if value in ("", "NA", None):
        return 0.0
    return float(value)


def sdv_feeds(rows, today):
    today_iso = f"{today[:4]}-{today[4:6]}-{today[6:8]}"
    with urlopen(Request(SDV_TEAM_BOX, headers={"User-Agent": "NBA-Impact-Data/1.0"}), timeout=60) as resp:
        tbox = {(r["game_id"], r["team_id"]): r
                for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8-sig"))}
    by_id, by_name, team_game_min = defaultdict(list), defaultdict(set), defaultdict(float)
    with urlopen(Request(SDV_PLAYER_BOX, headers={"User-Agent": "NBA-Impact-Data/1.0"}), timeout=90) as resp:
        for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8-sig")):
            if r.get("did_not_play", "").upper() == "TRUE" or r.get("game_date", "") > today_iso:
                continue
            mins = _sdv_float(r.get("minutes"))
            if mins <= 0:
                continue
            aid = r["athlete_id"]
            by_id[aid].append(r)
            by_name[name_key(r["athlete_display_name"])].add(
                (aid, r.get("team_location", ""), r.get("team_short_display_name", ""))
            )
            team_game_min[(r["game_id"], r["team_id"])] += mins
    if not tbox or not by_id:
        raise ValueError("SportsDataverse MBB boxscore feeds are empty")
    prospect_aids = {}
    for row in rows:
        if row.get("prediction_pool") != "domestic":
            continue
        cands = by_name.get(name_key(row["player"]), set())
        aids = sorted({a for a, _, _ in cands})
        if len(aids) > 1:
            t_keys = {name_key(t) for t in (row.get("pre_draft_team", ""), row.get("stats_team", "")) if t}
            filtered = sorted({
                a for a, loc, short in cands
                if any(tk in name_key(loc) or name_key(loc) in tk or tk in name_key(short) or name_key(short) in tk
                       for tk in t_keys)
            })
            if len(filtered) == 1:
                aids = filtered
        if len(aids) == 1:
            prospect_aids[row["player"]] = aids[0]
    target_aids = set(prospect_aids.values())
    pbp = defaultdict(lambda: defaultdict(int))
    foot_re = re.compile(r"\b(\d+)-foot\b", re.I)
    if target_aids:
        with urlopen(Request(SDV_PBP, headers={"User-Agent": "NBA-Impact-Data/1.0"}), timeout=180) as resp:
            for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8-sig")):
                aid = r.get("athlete_id_1", "")
                if aid not in target_aids or r.get("game_date", "") > today_iso:
                    continue
                if r.get("shooting_play", "").lower() != "true":
                    continue
                pa = r.get("points_attempted", "")
                if pa not in ("2", "3"):
                    continue
                made = r.get("scoring_play", "").lower() == "true"
                assisted = bool(r.get("athlete_id_2") and r.get("athlete_id_2") != "NA")
                st = pbp[aid]
                if made:
                    st["fgm"] += 1
                    if assisted:
                        st["fgm_ast"] += 1
                if pa == "3":
                    if made:
                        st["3pm"] += 1
                        if assisted:
                            st["3pm_ast"] += 1
                else:
                    tt = (r.get("type_text") or "").lower()
                    txt = (r.get("text") or "").lower()
                    is_dlt = any(k in tt for k in ("dunk", "layup", "tip")) or any(
                        k in txt for k in ("dunk", "layup", "tip shot", "tip-in")
                    )
                    fm = foot_re.search(txt)
                    if is_dlt or (fm is not None and int(fm.group(1)) <= 4):
                        st["rim_fga"] += 1
                        if made:
                            st["rim_fgm"] += 1
                            if assisted:
                                st["rim_ast"] += 1
    return prospect_aids, by_id, tbox, team_game_min, pbp


def sdv_domestic_stats(row, feeds):
    prospect_aids, by_id, tbox, team_game_min, pbp = feeds
    aid = prospect_aids.get(row["player"])
    if not aid:
        return None
    games = by_id.get(aid, [])
    if not games:
        return None
    mins = sum(_sdv_float(g["minutes"]) for g in games)
    totals = {
        "pts": sum(_sdv_int(g["points"]) for g in games),
        "fgm": sum(_sdv_int(g["field_goals_made"]) for g in games),
        "fga": sum(_sdv_int(g["field_goals_attempted"]) for g in games),
        "3pm": sum(_sdv_int(g["three_point_field_goals_made"]) for g in games),
        "3pa": sum(_sdv_int(g["three_point_field_goals_attempted"]) for g in games),
        "ftm": sum(_sdv_int(g["free_throws_made"]) for g in games),
        "fta": sum(_sdv_int(g["free_throws_attempted"]) for g in games),
        "oreb": sum(_sdv_int(g["offensive_rebounds"]) for g in games),
        "dreb": sum(_sdv_int(g["defensive_rebounds"]) for g in games),
        "ast": sum(_sdv_int(g["assists"]) for g in games),
        "tov": sum(_sdv_int(g["turnovers"]) for g in games),
        "stl": sum(_sdv_int(g["steals"]) for g in games),
        "blk": sum(_sdv_int(g["blocks"]) for g in games),
        "pf": sum(_sdv_int(g["fouls"]) for g in games),
    }
    tm_min = tm_fgm = tm_fga = tm_fta = tm_orb = tm_drb = tm_tov = 0.0
    opp_fga = opp_fta = opp_orb = opp_drb = opp_tov = opp_2pa = player_poss = 0.0
    for g in games:
        gid, tid, oid = g["game_id"], g["team_id"], g["opponent_team_id"]
        tb, ob = tbox.get((gid, tid)), tbox.get((gid, oid))
        if not tb or not ob:
            continue
        g_tm_min = team_game_min[(gid, tid)]
        if g_tm_min <= 0:
            continue
        tm_min += g_tm_min
        tfga, tfgm, tfta = _sdv_float(tb["field_goals_attempted"]), _sdv_float(tb["field_goals_made"]), _sdv_float(tb["free_throws_attempted"])
        torb, tdrb, ttov = _sdv_float(tb["offensive_rebounds"]), _sdv_float(tb["defensive_rebounds"]), _sdv_float(tb["turnovers"])
        ofga, ofta = _sdv_float(ob["field_goals_attempted"]), _sdv_float(ob["free_throws_attempted"])
        oorb, odrb, otov = _sdv_float(ob["offensive_rebounds"]), _sdv_float(ob["defensive_rebounds"]), _sdv_float(ob["turnovers"])
        o3pa = _sdv_float(ob["three_point_field_goals_attempted"])
        tm_fgm += tfgm; tm_fga += tfga; tm_fta += tfta; tm_orb += torb; tm_drb += tdrb; tm_tov += ttov
        opp_fga += ofga; opp_fta += ofta; opp_orb += oorb; opp_drb += odrb; opp_tov += otov; opp_2pa += (ofga - o3pa)
        g_poss = 0.5 * ((tfga - torb + ttov + 0.475 * tfta) + (ofga - oorb + otov + 0.475 * ofta))
        player_poss += g_poss * (_sdv_float(g["minutes"]) / (g_tm_min / 5.0))
    if mins <= 0 or tm_min <= 0:
        return None
    fgm, fga, tpm, ftm, fta = totals["fgm"], totals["fga"], totals["3pm"], totals["ftm"], totals["fta"]
    orb, drb, ast, tov, stl, blk = totals["oreb"], totals["dreb"], totals["ast"], totals["tov"], totals["stl"], totals["blk"]
    or_pct = round(100.0 * (orb * (tm_min / 5.0)) / (mins * (tm_orb + opp_drb)), 1) if (tm_orb + opp_drb) else 0.0
    dr_pct = round(100.0 * (drb * (tm_min / 5.0)) / (mins * (tm_drb + opp_orb)), 1) if (tm_drb + opp_orb) else 0.0
    ast_denom = ((mins / (tm_min / 5.0)) * tm_fgm) - fgm
    ast_pct = round(100.0 * ast / ast_denom, 1) if ast_denom > 0 else 0.0
    opp_poss = opp_fga - opp_orb + opp_tov + 0.475 * opp_fta
    raw_stl_pct = round(100.0 * (stl * (tm_min / 5.0)) / (mins * opp_poss), 1) if opp_poss > 0 else 0.0
    raw_blk_pct = round(100.0 * (blk * (tm_min / 5.0)) / (mins * opp_2pa), 1) if opp_2pa > 0 else 0.0
    tm_poss = tm_fga - tm_orb + tm_tov + 0.475 * tm_fta
    tm_orb_pct = tm_orb / (tm_orb + opp_drb) if (tm_orb + opp_drb) else 0.0
    tm_play_pct = (tm_fgm + tm_fta * 0.475) / (tm_fga + tm_fta * 0.475 + tm_tov) if tm_fga else 0.0
    denom_w = (1.0 - tm_orb_pct) * tm_play_pct + tm_orb_pct * (1.0 - tm_play_pct)
    tm_orb_wt = ((1.0 - tm_orb_pct) * tm_play_pct) / denom_w if denom_w else 0.0
    fga_share = (tm_fga / tm_min) * mins * 5.0 - fga
    q_ast = (
        ((mins / (tm_min / 5.0)) * (1.14 * ((tm_fgm - fgm) / tm_fgm)))
        + ((((tm_fgm / tm_min) * mins * 5.0 - fgm) / fga_share) * (1.0 - (mins / (tm_min / 5.0))))
    ) if (tm_fgm and fga_share) else 0.0
    fg_part = fgm * (1.0 - 0.5 * ((fgm + 0.5 * tpm) / fga) * q_ast) if fga else 0.0
    ast_part = 0.5 * (((tm_fgm - fgm) / (2.0 * (tm_fga - fga))) * ast) if (tm_fga - fga) else 0.0
    ft_part = (1.0 - (1.0 - (ftm / fta)) ** 2) * 0.475 * fta if fta else 0.0
    sc_poss = (fg_part + ast_part + ft_part) * (1.0 - (tm_orb / tm_poss) * tm_orb_wt * tm_play_pct) + orb * tm_orb_wt * tm_play_pct if tm_poss else 0.0
    fgx_poss = (fga - fgm) * (1.0 - 1.07 * tm_orb_pct)
    ftx_poss = ((1.0 - (ftm / fta)) ** 2) * 0.475 * fta if fta else 0.0
    tot_poss = sc_poss + fgx_poss + ftx_poss + tov
    usg = round(100.0 * (tot_poss * (tm_min / 5.0)) / (mins * tm_poss), 1) if tm_poss > 0 else 0.0
    to_pct = round(100.0 * tov / tot_poss, 1) if tot_poss > 0 else 0.0
    st = pbp[aid]
    rim_fgm, rim_fga = st["rim_fgm"], st["rim_fga"]
    totals["rim_fgm"] = rim_fgm
    totals["rim_fga"] = rim_fga
    latest_game = max(games, key=lambda g: g["game_date"])
    return {
        **totals,
        "or_pct": or_pct, "dr_pct": dr_pct, "ast_pct": ast_pct, "to_pct": to_pct,
        # Preserve BartTorvik getadvstats.php column 22/23 convention used to train the saved models.
        "stl_pct": raw_blk_pct, "blk_pct": raw_stl_pct, "usg": usg,
        "torvik_id": row.get("torvik_id", ""), "games": len(games), "minutes": round(mins, 1),
        "ppg": round(totals["pts"] / len(games), 2),
        "stats_team": row.get("stats_team") or latest_game.get("team_location", ""),
        "stats_leagues": "NCAA", "stats_source_url": SDV_PLAYER_BOX, "torvik_game_source_url": SDV_PBP,
        "last_game_in_pull": latest_game["game_date"],
        "fg_pct": rate(fgm, fga), "three_pct": rate(tpm, totals["3pa"]),
        "ft_pct": rate(ftm, fta), "rim_pct": rate(rim_fgm, rim_fga),
        "assisted_pct": round(100.0 * st["fgm_ast"] / st["fgm"], 1) if st["fgm"] else None,
        "rim_assisted_pct": round(100.0 * st["rim_ast"] / rim_fgm, 1) if rim_fgm else None,
        "threes_assisted_pct": round(100.0 * st["3pm_ast"] / st["3pm"], 1) if st["3pm"] else None,
        "torvik_estimated_3pa_100": rate(totals["3pa"], player_poss),
        "torvik_estimated_rim_100": rate(rim_fga, player_poss),
        "stats_status": "current-season sample",
    }


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
            or any(row["draft_year"] != str(SEASON) or not (1 <= (number(row["scv_draft"]) or 0) <= 5) for row in rows)):
        raise ValueError("Expected a curated 2027 draft board with strictly increasing big_board_rank and scv_draft in 1..5")
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
    torvik = None
    sdv = None
    try:
        torvik = torvik_feeds(today)
    except (OSError, ValueError, KeyError, IndexError) as error:
        print(f"::warning::BartTorvik unavailable ({error}); falling back to SportsDataverse MBB feeds.")
        try:
            sdv = sdv_feeds(rows, today)
        except (OSError, ValueError, KeyError, IndexError) as sdv_error:
            print(f"::warning::Draft NCAA inputs retained: {sdv_error}")
    checked = 0
    for row in rows:
        try:
            if row["prediction_pool"] == "domestic":
                if torvik is not None:
                    stats = domestic_stats(row, torvik)
                elif sdv is not None:
                    stats = sdv_domestic_stats(row, sdv)
                else:
                    stats = None
            else:
                stats = international_stats(row)
            if stats is None:
                if row["games"] and (torvik is not None or sdv is not None):
                    print(f"::warning::Draft stats retained for {row['player']}: current row missing")
                continue
            if (stats["games"] < int(row["games"] or 0)
                    or stats.get("last_game_in_pull", "") < row["last_game_in_pull"]):
                raise ValueError("source went backward")
            if not stats.keys() <= set(columns):
                raise ValueError("unexpected output fields")
            row.update({key: "" if value is None else value for key, value in stats.items()})
            checked += 1
        except (OSError, ValueError, KeyError, IndexError, TypeError, StopIteration, ImportError) as error:
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
