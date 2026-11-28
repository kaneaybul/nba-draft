#!/usr/bin/env python3
"""Build dated shared-minutes game ledger and SHA-pinned config for daily asset pricing."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

VERSION = "shared-minutes-comparables-career-v3-conditional-tail"
HORIZON_SEASONS = 9
HORIZON_GAMES = 82 * HORIZON_SEASONS


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_shared_config(repo: Path, work_dir: Path, asof: str | None = None) -> dict:
    work_dir.mkdir(parents=True, exist_ok=True)
    pool = json.loads((repo / "raw/live/player_pool.json").read_text())
    if asof is None:
        asof = pool["generated_at"][:10]
    season = int(asof[:4]) + (1 if int(asof[5:7]) >= 7 else 0)

    history_dir = repo / "frontend/public/data/v2/impact_players"
    roster_path = history_dir / f"{season}.json"
    schedule_path = repo / f"frontend/public/data/v2/team_schedules/{season}.json"
    outlook_path = repo / "frontend/public/data/injury_outlook.json"

    rollout = repo / "script/frontend/shared_minutes_rollout"
    sys.path.insert(0, str(rollout / "core/candidate"))
    sys.path.insert(0, str(rollout / "rookie"))
    from build_shared_roles import read_history
    from shared_minutes import ComparableGames, project_path
    from build_comparable_mpg import ConditionalMpg, PROTECTED_NEAR

    history = read_history(history_dir, season)
    roster = json.loads(roster_path.read_text())
    gp_mpg = {
        yr: {pid: (r["games"], r["mpg"]) for pid, r in rows.items() if r["games"] > 0 and 0 < r["mpg"] <= 48}
        for yr, rows in history.items()
    }
    gp_model = ComparableGames(history, season - 1, horizons=HORIZON_SEASONS)
    mpg_model = ConditionalMpg(history, gp_mpg, season - 1, HORIZON_SEASONS, ComparableGames.features)

    healthy_csv = work_dir / "healthy.csv"
    resolved_csv = work_dir / "resolved.csv"
    for p in (healthy_csv, resolved_csv):
        if p.exists():
            p.unlink()

    with healthy_csv.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["asof", "team", "nba_id", "game", "probability", "conditional_mpg", "forecast_version"])
        seen = set()
        for row in roster:
            if row.get("pool_status") != "roster":
                continue
            pid = int(row.get("source_nba_id") or row["nba_id"])
            if pid in seen:
                raise ValueError(f"Duplicate roster identity: {pid}")
            seen.add(pid)
            prior = history.get(season - 1, {}).get(pid)
            elapsed = 82 - int(row["minutes_remaining_team_games"])
            near_gp = float(row["minutes_gp_prior"])
            observed_gp = float(row.get("minutes_actual_games") or 0)
            near_mpg = float(row["minutes_mpg_prior"])
            if observed_gp:
                near_mpg = (10.0 * near_mpg + float(row["minutes_actual"])) / (10.0 + observed_gp)
            if prior and prior["games"] >= 5:
                features = ComparableGames.features(history, season - 1, pid)
            else:
                features = [float(row["age"]), near_gp, near_mpg, float(row["total"]), 0.0, float(row.get("yoe") or 0)]
            gp_anchors = gp_model.predict(features)
            mpg_tail, _ = mpg_model.predict(features)
            near_roles = [float(row["minutes_mpg_prior"])]
            for i in range(1, PROTECTED_NEAR):
                nxt = row.get(f"projection_mpg_y{i}")
                near_roles.append(near_roles[-1] if nxt is None else float(nxt))
            mpg_anchors = near_roles[:PROTECTED_NEAR] + [float(x) for x in mpg_tail[PROTECTED_NEAR:]]
            curve = project_path(
                gp_anchors,
                mpg_anchors,
                near_gp,
                min(48.0, near_mpg),
                elapsed,
                length=HORIZON_GAMES - elapsed,
                require_right_support=False,
            )
            for idx, (prob, mpg) in enumerate(zip(curve.probability, curve.conditional_mpg), 1):
                writer.writerow([asof, row["team"], pid, idx, float(prob), float(mpg), VERSION])

    env = {**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    subprocess.run(
        [
            "Rscript",
            "--vanilla",
            str(rollout / "core/candidate/allocate_shared_roles.R"),
            str(repo),
            str(healthy_csv),
            str(roster_path),
            str(schedule_path),
            str(outlook_path),
            asof,
            str(resolved_csv),
        ],
        check=True,
        env=env,
    )

    eligible = {}
    with resolved_csv.open(newline="") as stream:
        for r in csv.DictReader(stream):
            if int(r["game"]) != 1:
                continue
            eligible[str(int(float(r["nba_id"])))] = {
                "team": r["team"],
                "team_game_clock": int(float(r["team_game_clock"])),
            }

    config = {
        "asof": asof,
        "forecast_version": VERSION,
        "scope": "all-eligible-current-endpoints",
        "cutover_booking": "separate-method-rebase",
        "ledger": str(resolved_csv.resolve()),
        "ledger_sha256": sha256_file(resolved_csv),
        "eligible": eligible,
    }
    config_path = work_dir / "shared_native_config.json"
    config_path.write_text(json.dumps(config, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n")
    config_sha = sha256_file(config_path)

    env_path = work_dir / "env.sh"
    env_path.write_text(
        f'export NBA_SHARED_NATIVE_CONFIG="{config_path.resolve()}"\n'
        f'export NBA_SHARED_NATIVE_CONFIG_SHA256="{config_sha}"\n'
    )
    return {
        "asof": asof,
        "season": season,
        "eligible_players": len(eligible),
        "config": str(config_path.resolve()),
        "sha256": config_sha,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--as-of", default=None)
    args = parser.parse_args()
    result = build_shared_config(args.repo.resolve(), args.work_dir.resolve(), args.as_of)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
