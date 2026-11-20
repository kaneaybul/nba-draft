"""Assemble reviewed current inputs for the actual shared-horizon builder."""
import argparse
import hashlib
import json
from pathlib import Path

from shared_minutes_horizon import BASE_METHOD, COMPARABLE_MPG_METHOD, RECEIPT_SCHEMA, load_horizon


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pin(file, sha):
    path = Path(file).resolve(strict=True)
    if digest(path) != sha:
        raise ValueError(f"Reviewed input changed: {path.name}")
    return {"path": str(path), "sha256": sha}


def assemble(asof, season, roster, history, reviews, review_sha, out):
    pin(reviews, review_sha)
    cfg = json.loads(Path(reviews).read_bytes())
    if (cfg["schema"], cfg["asof"], cfg["season"]) != ("nba-shared-cutover-reviewed-inputs-v1", asof, season):
        raise ValueError("Wrong review date, season, or schema")
    roster = Path(roster).resolve(strict=True)
    history = Path(history).resolve(strict=True)
    out = Path(out).resolve()
    if out.exists():
        raise ValueError("Refusing to overwrite a receipt")
    pin(roster, cfg["roster_sha256"])
    scope_bind, mpg_bind, outcomes = [pin(cfg[k]["path"], cfg[k]["sha256"])
                                     for k in ("appraisal_scope", "mpg_anchors", "appearance_outcomes")]
    scopes, anchors = [json.loads(Path(b["path"]).read_bytes()) for b in (scope_bind, mpg_bind)]
    if (scopes["schema"], scopes["asof"], scopes["season"]) != ("nba-appraisal-scope-v1", asof, season):
        raise ValueError("Wrong appraisal scope")
    schemas={BASE_METHOD:"nba-verified-conditional-mpg-anchors-v1",
             COMPARABLE_MPG_METHOD:"nba-shared-minutes-comparable-mpg-anchors-v1"}
    if (anchors["schema"],anchors["asof"],anchors["season"]) != (schemas.get(anchors["method"]),asof,season):
        raise ValueError("Wrong conditional MPG source")
    receipt = dict(schema=RECEIPT_SCHEMA, asof=asof, season=season, mpg_method=anchors["method"],
                   roster_sha256=cfg["roster_sha256"], history_sha256=cfg["history_sha256"],
                   scope_source=scope_bind, mpg_source=mpg_bind, outcome_source=outcomes,
                   scope=scopes["players"], mpg=anchors["players"])
    # A validated receipt is still staging input, not release authorization.
    staged = out.with_name(out.name + ".checking")
    with staged.open("x") as f:
        f.write(json.dumps(receipt, sort_keys=True, allow_nan=False))
    try:
        expected = digest(staged)
        length, eligible, observed = load_horizon(staged, expected, history, roster, asof, season,
                                                  json.loads(roster.read_bytes()))
        # Link rather than replace, so unrelated output cannot be overwritten.
        out.hardlink_to(staged)
    finally:
        staged.unlink()
    return {"receipt":str(out), "sha256":expected, "player_count":len(eligible),
            "regular_season_length":length, "history_seasons":len(observed), "release_ready":False}


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("asof")
    p.add_argument("season",type=int)
    for key in ("roster","history","reviews","review_sha","out"):
        p.add_argument(key)
    print(json.dumps(assemble(**vars(p.parse_args())),indent=2))

