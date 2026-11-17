"""Execute the current R exporter exactly once against an accepted local native role run."""
import argparse
from collections import defaultdict
from datetime import datetime
import json
import math
import os
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo

from dated_source_receipts import bind, write_new

MODEL="fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f"
EVIDENCE="sparse-observed-role-evidence-v2-transient-roster"
METHOD="peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster"
TEAMS=set("ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())


def load(path):
    return json.loads(Path(path).read_bytes())


def sha(path):
    return bind(path)["sha256"]


def owners(rows, field="team"):
    pairs={}
    for row in rows:
        pid=row.get("source_nba_id") or row.get("nba_id")
        if type(pid) is not int or pid<1 or pid in pairs or row.get(field) not in TEAMS:
            raise ValueError("Invalid or duplicate roster identity")
        pairs[pid]=row[field]
    if set(pairs.values())!=TEAMS:
        raise ValueError("Incomplete roster team coverage")
    return pairs


def verify_outputs(players_file, teams_file, schedule_file, book_owners, asof, season, injury_time):
    rows=[r for r in load(players_file) if r.get("year")==season and r.get("pool_status")=="roster"]
    actual=owners(rows)
    if actual!=book_owners or owners(rows, "team_projection_base")!=book_owners:
        raise ValueError("R projected owners differ from the signed book")
    by_team=defaultdict(list)
    for row in rows:
        if row.get("injury_projection_as_of")!=injury_time:
            raise ValueError("R minutes do not use the exact accepted injury stamp")
        vals=[row.get(k) for k in ("Minutes","minutes_actual","minutes_remaining","minutes_remaining_team_games")]
        if any(type(v) not in (float,int) or not math.isfinite(v) or v<0 for v in vals):
            raise ValueError("Invalid R minutes")
        total,actual,remaining,games=vals
        if total+1e-6<actual or abs(total-actual-remaining)>.11 or games!=int(games) or games>82:
            raise ValueError("R minute clock or reconciliation failed")
        by_team[row["team"]].append((remaining,games))
    max_error=max(abs(sum(x[0] for x in rows)-240*max(x[1] for x in rows)) for rows in by_team.values())
    if max_error>1e-6:
        raise ValueError("R minutes do not reconcile all 30 team budgets")
    team_rows=[r.get("team") for r in load(teams_file) if r.get("year")==season and r.get("scenario_id")=="base"]
    if len(team_rows)!=30 or set(team_rows)!=TEAMS:
        raise ValueError("Incomplete base-team R projections")
    current_schedule=[r for r in load(schedule_file) if r.get("season")==season]
    if ({r["home_team"] for r in current_schedule} | {r["away_team"] for r in current_schedule}) != TEAMS:
        raise ValueError("Incomplete R team calendar")
    if any(r.get("is_completed") is True and r.get("date","9999")>asof for r in current_schedule):
        raise ValueError("R calendar contains future finals")
    return dict(teams=30,roster_count=len(book_owners),team_budget_max_error=max_error)


def run(repo, work, native_receipt, role_file, role_proof, source_r_receipt, player_quote_receipt):
    repo,work,native_receipt,role_file,role_proof,source_r_receipt,player_quote_receipt=map(lambda x:Path(x).resolve(),(repo,work,native_receipt,role_file,role_proof,source_r_receipt,player_quote_receipt))
    if repo==work or repo in work.parents or work.exists():
        raise ValueError("Use a new external claim directory and isolated checkout")
    n,p,r,q=map(load,(native_receipt,role_proof,source_r_receipt,player_quote_receipt))
    asof,season=n["asof"],n["season"]
    if (n.get("schema"),n.get("method"),n.get("model_sha256"),n.get("evidence_policy"),n.get("teams"),n.get("complete"),n.get("production")) != (
            "nba-daily-native-replay-v1",METHOD,MODEL,EVIDENCE,30,True,False):
        raise ValueError("Reviewed complete native receipt required")
    if (r.get("schema"),r.get("asof"),r.get("season"))!=("nba-source-r-demographics-calendar-v1",asof,season):
        raise ValueError("Source-only R preparation not bound to this date")
    for k in ("demographics","schedule"):
        if r[k]!=bind(r[k]["path"],asof):
            raise ValueError("Source-only R preparation artifact changed")
    if (p.get("asof"),p.get("model_sha256"),p.get("evidence_policy"),p.get("transient_once_and_tail_verified"),p.get("injury_applied")) != (
            asof,MODEL,EVIDENCE,True,False):
        raise ValueError("Reviewed exact healthy role proof required")
    if p.get("source_hashes")!={team:n["output_sha256"].get(f"{team}/monthly_player_values.csv") for team in TEAMS}:
        raise ValueError("Role proof does not match the native receipt")
    if (q.get("asof"),q.get("model_sha256"),q.get("source_method"),q.get("native_receipt_sha256"),
            q.get("signed_book_sha256"),q.get("healthy_bridge_sha256")) != (
            asof,MODEL,METHOD,sha(native_receipt),n.get("signed_book_sha256"),sha(role_file)):
        raise ValueError("Player quote receipt does not bind this exact healthy role bridge")
    b=load(role_file)
    if (b.get("asof"),b.get("model_sha256"),b.get("evidence_policy"),b.get("acute_overlay_applied"),b.get("allocation_applied")) != (
            asof,MODEL,EVIDENCE,False,False):
        raise ValueError("Wrong or already adjusted R role packet")
    player_book=repo/"processed/contracts/current.json"
    injury_file=repo/"frontend/public/data/injury_outlook.json"
    if sha(player_book)!=n.get("signed_book_sha256"):
        raise ValueError("Current R book differs from the signed native book")
    book=load(player_book)
    if book.get("as_of")!=asof or book.get("season")!=season or book.get("complete") is not True:
        raise ValueError("Signed book is stale")
    book_owners=owners(book["players"])
    if owners(b["players"])!=book_owners:
        raise ValueError("Role roster differs from the signed book")
    injury=load(injury_file)
    injury_time=injury["generated_at"]
    if injury.get("season")!=season or datetime.fromisoformat(injury_time.replace("Z","+00:00")).astimezone(ZoneInfo("America/New_York")).date().isoformat()!=asof:
        raise ValueError("R injury date or season differs from native role")
    tracked={"signed_book":player_book,"injuries":injury_file,"role":role_file,
             "healthy_role_proof":role_proof,"native_receipt":native_receipt,"source_r_receipt":source_r_receipt,
             "player_quote_receipt":player_quote_receipt,
             "demographics":Path(r["demographics"]["path"]),"calendar":Path(r["schedule"]["path"])}
    hashes={k:sha(p) for k,p in tracked.items()}
    work.mkdir(exist_ok=False)
    write_new(work/"claim.json",dict(asof=asof,season=season,input_sha256=hashes))
    with (work/"r_export.log").open("x") as log:
        subprocess.run(["Rscript","--vanilla","script/frontend/export_frontend_data.R"], cwd=repo,
                       stdout=log,stderr=subprocess.STDOUT,check=True,timeout=900,
                       env={**os.environ,"TZ":"UTC","NBA_REFRESH_SCHEDULES":"false",
                            "NBA_ROLLING_ROLE_FILE":str(role_file),"NBA_ROLLING_ROLE_AS_OF":asof})
    if hashes!={k:sha(p) for k,p in tracked.items()}:
        raise ValueError("R source changed during computation")
    data=repo/"frontend/public/data"
    shards={x:data/"v2"/x/f"{season}.json" for x in ("impact_players","team_projections","team_schedules")}
    qa=verify_outputs(*shards.values(),book_owners,asof,season,injury_time)
    if any(r.get("schedule_as_of")!=asof for r in load(shards["team_projections"])
           if r.get("year")==season and r.get("scenario_id")=="base"):
        raise ValueError("R forecast date does not match the daily pick input")
    # The static manifest and full exports feed existing downstream checks/build.
    artifact_files=[*shards.values(),*(data/f"{k}.json" for k in
       ("manifest","impact_players","team_projections","team_lineups","team_schedules","pick_assets","draft_prospects"))]
    report=dict(schema="nba-daily-role-r-export-v1", asof=asof, season=season,
                 model_sha256=MODEL, healthy_bridge_sha256=hashes["role"],
                 signed_book_sha256=hashes["signed_book"], inputs={k+"_sha256":v for k,v in hashes.items()},
                 outputs={str(p.relative_to(repo)):sha(p) for p in artifact_files},production=False, **qa)
    write_new(work/"receipt.json",report)
    return report


if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("repo","work","native-receipt","role-file","role-proof","source-r-receipt","player-quote-receipt"):
        p.add_argument("--"+name,type=Path,required=True)
    run(**vars(p.parse_args()))
