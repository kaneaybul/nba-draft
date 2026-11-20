"""Verified input boundary for one full-horizon resolved minutes ledger.

This consumes, but does not synthesize, dated appraisal scope and same-method
career MPG anchors. Existing published and shadow entrypoints are not changed.
"""
from datetime import date
from hashlib import sha256
from math import isfinite
import json
from pathlib import Path

HORIZON_VERSION = "shared-minutes-comparables-career-v2-complete-outcomes"
COMPARABLE_MPG_VERSION = "shared-minutes-comparables-career-v3-conditional-tail"
BASE_METHOD = "pr38-validated-career-conditional-mpg"
COMPARABLE_MPG_METHOD = "pr38-verified-near-plus-comparable-conditional-mpg-v2"
MPG_METHODS = {BASE_METHOD, COMPARABLE_MPG_METHOD}
VERSION_BY_MPG_METHOD = {BASE_METHOD:HORIZON_VERSION, COMPARABLE_MPG_METHOD:COMPARABLE_MPG_VERSION}
RECEIPT_SCHEMA = "nba-shared-minutes-horizon-inputs-v1"


def read_pin(path, digest):
    b = Path(path).read_bytes()
    if sha256(b).hexdigest() != digest:
        raise ValueError("Source hash mismatch: " + str(path))
    return b


def exact_int(value, label):
    if type(value) is not int:
        raise ValueError("Not an integer: " + label)
    return value


def required_length(season, last_season):
    if not season + 4 <= last_season <= season + 8:
        raise ValueError("Unexpected service horizon")
    return 82 * (last_season - season + 1)


def required_anchors(length):
    # Include right interpolation support. Never reuse the last season mean.
    return (length + 40) // 82 + 1


def load_horizon(receipt_file, expected_sha, history_root, roster_file, asof, season, players):
    receipt = json.loads(read_pin(receipt_file, expected_sha))
    date.fromisoformat(asof)
    method = receipt["mpg_method"]
    if (receipt["schema"] != RECEIPT_SCHEMA or receipt["asof"] != asof
            or receipt["season"] != season or method not in MPG_METHODS):
        raise ValueError("Unverified horizon input identity or MPG method")
    read_pin(roster_file, receipt["roster_sha256"])
    # Verify exact producer inputs and outputs. Receipt review independently binds
    # their semantics; this helper cannot authenticate arbitrary labeled values.
    sources = {}
    for category in ("scope_source", "mpg_source"):
        item = receipt[category]
        sources[category] = read_pin(item["path"], item["sha256"])
    if method == COMPARABLE_MPG_METHOD:
        archived = json.loads(sources["mpg_source"])
        if (archived["schema"], archived["asof"], archived["season"], archived["method"], archived["players"]) != (
                "nba-shared-minutes-comparable-mpg-anchors-v1", asof, season, method, receipt["mpg"]):
            raise ValueError("Comparable conditional-MPG anchors are not bound to their exact source")
    observed = {p.name: p for p in Path(history_root).glob("*.json")
                if p.stem.isdigit() and int(p.stem) < season}
    expected = receipt["history_sha256"]
    if set(observed) != set(expected) or not observed:
        raise ValueError("Incomplete or unexpected completed-season panels")
    seasons = sorted(int(Path(name).stem) for name in observed)
    if seasons != list(range(seasons[0], season)):
        raise ValueError("Missing dated completed-season panel")
    for name, p in observed.items():
        read_pin(p, expected[name])
    roster = {str(r.get("source_nba_id") or r["nba_id"]): r
              for r in players if r["pool_status"] == "roster"}
    if len(roster) != sum(p["pool_status"] == "roster" for p in players):
        raise ValueError("Duplicate identity")
    mpg, scope = receipt["mpg"], receipt["scope"]
    if set(roster) != set(mpg) or set(roster) != set(scope):
        raise ValueError("Dated inputs must exactly cover all current roster identities")
    last_season = season + 4
    for pid, row in roster.items():
        target = scope[pid]
        if target["team"] != row["team"]:
            raise ValueError("Owner mismatch in appraisal scope")
        years = target["appraisal_seasons"]
        if any(type(y) is not int for y in years) or (years and
                (len(years) != 4 or years != list(range(years[0], years[0]+4)))):
            raise ValueError("Unexpected draft appraisal scope")
        if years:
            last_season = max(last_season, years[-1])
    length = required_length(season, last_season)
    count = required_anchors(length)
    by_id = {}
    for pid, row in roster.items():
        packet = mpg[pid]
        if packet["team"] != row["team"]:
            raise ValueError("Owner mismatch in career MPG anchors")
        table = packet["anchors"]
        if set(table) != {str(season+i) for i in range(count)}:
            raise ValueError("Incomplete or extra career MPG anchors")
        values = [table[str(season+i)] for i in range(count)]
        # Pin every validated overlapping MPG anchor, including the healthy opener.
        # Missing is fatal: original PR38's carry-forward values are not evidence.
        expected_near = [row["minutes_mpg_prior"]] + [row.get(f"projection_mpg_y{i}") for i in range(1,5)]
        if method == BASE_METHOD:
            if any(x is None for x in expected_near) or values[:5] != expected_near:
                raise ValueError("Career MPG overlap disagrees with validated roster inputs")
        else:
            claims = packet["anchor_sources"]
            if set(claims) != set(table) or expected_near[0] is None:
                raise ValueError("Comparable conditional-MPG provenance incomplete")
            for i, value in enumerate(values):
                if type(value) not in (int, float) or not isfinite(value) or not 0 <= value <= 48:
                    raise ValueError("Invalid conditional MPG")
                prior = expected_near[i] if i < len(expected_near) else None
                if type(prior) in (int, float) and isfinite(prior) and 0 <= prior <= 48:
                    if value != prior or claims[str(season+i)] != "production":
                        raise ValueError("Dated Production MPG anchor cannot be changed")
                elif claims[str(season+i)] != "comparables":
                    raise ValueError("Missing or far-tail MPG must use comparable evidence")
        by_id[int(pid)] = values
    item = receipt["outcome_source"]
    raw = json.loads(read_pin(item["path"], item["sha256"]))
    if raw["schema"] != "nba-complete-appearance-outcomes-v1" or raw["through_season"] != season-1:
        raise ValueError("Missing verified completed-season outcome scope")
    outcomes = {}
    for yy, season_pin in raw["seasons"].items():
        year = int(yy)
        evidence = season_pin["source"]
        read_pin(evidence["path"], evidence["sha256"])
        uniform = season_pin.get("uniform_team_games")
        if uniform is not None and (type(uniform) is not int or not 1 <= uniform <= 82):
            raise ValueError("Unverified uniform team-game count")
        # Team schedule lengths differed in 2019–20; a league-wide mean
        # cannot certify an individual's opportunity denominator.
        if year == 2020 and uniform is not None:
            raise ValueError("2019–20 outcomes require dated individual exposure")
        rows = outcomes[year] = {}
        for pid, result in season_pin["players"].items():
            if result == {"identity_status":"unresolved","games":None,"status":"unknown"}:
                rows[int(pid)] = None
                continue
            if result["identity_status"] != "verified":
                raise ValueError("Unverified completed-season outcome identity")
            appearances = exact_int(result["games"], "appearances")
            expected_status = "appeared" if appearances else "verified_no_appearance"
            if not 0 <= appearances <= 120 or result["status"] != expected_status:
                raise ValueError("Invalid or uncertified raw appearance outcome")
            if appearances == 0:
                rows[int(pid)] = 0.
                continue
            exposure = result.get("verified_player_exposure", uniform)
            if exposure is None:
                # Known raw GP, unknown proper normalization. Keep raw
                # evidence in the input, exclude from comparator training.
                rows[int(pid)] = None
                continue
            if (type(exposure) is not int or not 1 <= exposure <= 120
                    or ("verified_player_exposure" in result and appearances > exposure)):
                raise ValueError("Invalid certified opportunity exposure")
            # A traded player may legally exceed a uniform season length.
            # Clamp only the 82-game projection target, never the raw source.
            rows[int(pid)] = min(82., 82 * appearances / exposure)
    if set(outcomes) != set(seasons):
        raise ValueError("Incomplete dated outcome seasons")
    return length, by_id, outcomes
