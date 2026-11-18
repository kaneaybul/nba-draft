"""Admit a dated, reviewed NBA game-status supplement without replacing collected evidence."""
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import urlsplit


def need(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_bytes())


def checked(binding):
    path = Path(binding["path"]).resolve(strict=True)
    need(sha256(path.read_bytes()).hexdigest() == binding["sha256"],
         "Changed official game-status evidence: " + path.name)
    return path


def admit(receipt, collector, repo, schedule, asof):
    evidence = read(receipt)
    need(evidence.get("schema") == "nba-official-same-game-outlook-v1" and evidence.get("asof") == asof,
         "Wrong official game-status date or schema")
    need(checked(evidence["collector_receipt"]) == Path(collector).resolve(strict=True),
         "Official game-status receipt refers to a different collector")
    original_path = checked(evidence["source_outlook"])
    need(original_path == repo / "frontend/public/data/injury_outlook.json",
         "Official game-status supplement refers to a different injury source")
    reports = set()
    for entry in evidence["official_reports"]:
        url = urlsplit(entry["url"])
        need(url.scheme == "https" and url.hostname in {"ak-static.cms.nba.com", "www.nba.com"},
             "Official game-status source must be on NBA.com")
        checked(entry)
        reports.add(entry["url"])
    away, home = (evidence["matchup"][key] for key in ("away", "home"))
    games = {(g["game_id"], g["date"]) for g in read(schedule) if g["date"] == asof
             and g["away_team"] == away and g["home_team"] == home and not g["is_completed"]
             and not g.get("is_placeholder")}
    need(len(games) == 1, "Official injury report does not match a single scheduled game")

    original = read(original_path)
    rows = {(r["team"], r["name_key"]): r for r in original["players"]}
    need(len(rows) == len(original["players"]), "Duplicate original injury identity")
    signed = {(r["team"], int(r["nba_id"])) for r in read(repo / "processed/contracts/current.json")["players"]}
    seen = set()
    for row in evidence["statuses"]:
        key = (row["team"], row["name_key"])
        overlay = {k: row[k] for k in ("game_date", "status", "source_url")}
        need(key not in seen and key[0] in {home, away} and (key[0], row["nba_id"]) in signed
             and overlay["game_date"] == asof and overlay["source_url"] in reports
             and overlay["status"] in {"Out", "Doubtful", "Questionable"},
             "Invalid official game-status row")
        seen.add(key)
        if key in rows:
            need("official_game_status" not in rows[key], "Original injury source contains a supplement")
            rows[key]["official_game_status"] = overlay
    need(seen, "Empty official game-status supplement")

    output = checked(evidence["supplemented_outlook"])
    revised = read(output)
    added = [r for r in revised["players"] if (r["team"], r["name_key"]) not in rows]
    for r in added:
        key = (r["team"], r["name_key"])
        source = next((s for s in evidence["statuses"] if (s["team"], s["name_key"]) == key), {})
        need(key in seen and source.get("status") == "Out" and source.get("nba_id") == r.get("nba_id")
             and set(r) == {"team", "name_key", "player_name", "nba_id", "status", "basis", "source_url", "official_game_status"}
             and r.get("status") == "Out" and r.get("basis") == "official_game_status_only"
             and r.get("source_url") == source.get("source_url")
             and r["official_game_status"] == {k: source[k] for k in ("game_date", "status", "source_url")},
             "New injury row lacks a game-only confirmed absence")
    need(seen <= set(rows) | {(r["team"], r["name_key"]) for r in added}, "Missing supplemented injury row")
    expected = dict(original, players=list(rows.values()) + added)
    need(revised == expected, "Official receipt changed unrelated injury data")
    return output
