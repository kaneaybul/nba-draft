"""Shadow-only early shared-minute roster producer. No public output or native mutation."""
import argparse, hashlib, json, math, os, subprocess
from collections import Counter
from datetime import date
from pathlib import Path

TEAMS=set("ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())
BASE_FILES=("raw/live/ratings.json","raw/live/skill_stats.json","raw/live/player_pool.json")
PRODUCER_FILES=("script/frontend/export_frontend_data.R","script/frontend/live_minutes.R","script/frontend/injury_projections.R","script/frontend/live_ratings.R","script/frontend/player_pool.R","script/draft/name_matching.R","script/data/darko_dpm_fallback.R","processed/livedata/impactrefresh/player_career_projections.csv")

def need(ok,msg):
    if not ok: raise ValueError(msg)

def read(p): return json.loads(Path(p).read_bytes())
def bind(p):
    p=Path(p).resolve(strict=True)
    return {"path":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
def write(p,x):
    with Path(p).open("x") as s: json.dump(x,s,indent=2,allow_nan=False);s.write("\n")
def finite(x):return type(x) in (float,int) and math.isfinite(x)
def pid(r):return r.get("source_nba_id") or r.get("nba_id")

def people(rows):
    out={}
    for r in rows:
        i=pid(r)
        need(type(i) is int and i>0 and i not in out and r["team"] in TEAMS,"Invalid or duplicate roster identity")
        out[i]=r["team"]
    return out

def clocks(schedule,asof,season):
    all_slots=Counter(); future=Counter(); game_ids=set()
    for g in schedule:
        need(g["season"]==season,"Mixed schedule season")
        if g["season_type"]!="Regular Season":continue
        day=g["date"];need(date.fromisoformat(day).isoformat()==day,"Invalid scheduled date")
        need(type(g["is_completed"]) is bool,"Invalid completion fact")
        placeholder=g.get("is_placeholder") is True
        clubs=[g["selected_team"]] if placeholder else [g["home_team"],g["away_team"]]
        need(len(set(clubs))==len(clubs) and all(t in TEAMS for t in clubs),"Invalid schedule clubs")
        game_id=g["game_id"]
        need(game_id is not None and str(game_id).strip() and str(game_id) not in game_ids,"Missing or duplicate schedule game")
        game_ids.add(str(game_id))
        need(not (g["is_completed"] and (day>asof or placeholder)),"Invalid completed game")
        need(g["is_completed"] or day>=asof,"Past unresolved regular-season game")
        all_slots.update(clubs)
        if not g["is_completed"]:future.update(clubs)
    need(set(all_slots)==TEAMS and all(all_slots[t]==82 for t in TEAMS),"Schedule lacks exact 82-game team clocks")
    return {team:future[team] for team in TEAMS}

def build_rows(captured,book,schedule,ratings,stats,asof,season):
    need(book["complete"] is True and book["as_of"]==asof and book["season"]==season,"Wrong signed book date")
    regular=people(book["players"]); pending=people(book.get("contract_pending",[]))
    need(set(regular.values())==TEAMS and not set(regular)&set(pending),"Incomplete or overlapping signed book")
    need(people(captured)==regular|pending,"Upstream roster differs from dated signed book")
    clocks_by_team=clocks(schedule,asof,season); actual={}
    for s in stats["players"]:
        i=s["nba_id"]
        need(type(i) is int and i>0 and i not in actual,"Duplicate or malformed stats identity")
        gp,mins=s["games"],s["minutes"]
        need(finite(gp) and gp==int(gp) and gp>=0 and finite(mins) and mins>=0 and (gp>0 or mins==0),"Invalid observed minutes")
        actual[i]=(gp,mins)
    need(ratings["season"]==season and ratings["generated_at"][:10]==asof,"Wrong rating feed stamp")
    need(stats["season"]==season and stats["generated_at"][:10]==asof,"Wrong actuals feed stamp")
    out=[]
    for r in sorted(captured,key=pid):
        i=pid(r); p=r["contract_pending"]; club=r["team"]
        need(r["year"]==season and r["pool_status"]=="roster" and r["team_projection_base"]==club
             and type(p) is bool and p==(i in pending),"Different role placement or pending state")
        need(all(finite(r[k]) for k in ("age","total")),"Missing role features")
        gp0=r["games"];mpg0=r["p_mpg"]
        # Existing R GP fallback is 60; never derive GP from actuals or postallocation.
        if gp0 is None:gp0=60
        need(finite(gp0) and 0<=gp0<=82 and finite(mpg0) and 0<=mpg0<=48,"Missing/unphysical career role prior")
        gp,mins=actual.get(i,(0,0))
        # GP is season all-team actuals; a player's old-team games do not change the current team's clock.
        row=dict(r,minutes_gp_prior=gp0,minutes_mpg_prior=mpg0,minutes_actual_games=gp,minutes_actual=mins,
                 minutes_remaining_team_games=clocks_by_team[club],minutes_checked_at=ratings["generated_at"])
        for j in range(1,6):
            x=row[f"projection_mpg_y{j}"]
            need(x is None or finite(x) and 0<=x<=48,"Invalid career MPG anchor")
        out.append(row)
    return out

def verify_sources(repo,source_r,collector,ownership,expected,asof,season):
    pins={k:bind(p) for k,p in (("source_r",source_r),("collector",collector),("ownership",ownership))}
    need({k:v["sha256"] for k,v in pins.items()}==expected,"Daily receipt hash mismatch")
    rs,cs,ow=(read(pins[k]["path"]) for k in ("source_r","collector","ownership"))
    for receipt,schema in ((rs,"nba-source-r-demographics-calendar-v1"),(cs,"nba-source-only-coverage-v1"),(ow,"nba-existing-dated-ownership-binding-v1")):
        need((receipt["schema"],receipt["asof"],receipt["season"])==(schema,asof,season),"Daily source date/season mismatch")
    need(cs["source_checks_pass"] is True and not cs["issues"] and not cs.get("execution_error")
         and not cs.get("unexpected_changed_paths"),"Source collection not certified")
    for k in ("schedule","demographics"):
        b=bind(rs[k]["path"])
        need(rs[k]==dict(b,asof=asof),"Changed R source "+k)
        pins[k]=b
    book=bind(repo/"processed/contracts/current.json")
    need(ow["signed_book"]==book,"Signed book differs from ownership receipt")
    pins["signed_book"]=book
    for f in BASE_FILES:
        b=bind(repo/f)
        need(cs["feeds"][f]["sha256"]==b["sha256"],"Changed collected source "+f)
        pins[f]=b
    return pins

def prepare(repo,out,source_r,collector,ownership,expected,asof,season):
    repo=Path(repo).resolve(strict=True);out=Path(out).resolve()
    need(out!=repo and repo not in out.parents and not out.exists(),"Private new output directory required")
    need(date.fromisoformat(asof).isoformat()==asof and type(season) is int,"Invalid date or season")
    pins=verify_sources(repo,source_r,collector,ownership,expected,asof,season)
    driver=Path(__file__).with_name("prepare_shared_role_candidates.R")
    pins.update({rel:bind(repo/rel) for rel in PRODUCER_FILES})
    pins["capture_driver"]=bind(driver);pins["binding_driver"]=bind(__file__)
    out.mkdir();raw=out/"unallocated-roster.json"
    # Never allow ambient legacy role input, schedule refresh, or public export.
    env=dict(os.environ,TZ="UTC",NBA_REFRESH_SCHEDULES="false",NBA_ROLLING_ROLE_FILE="",NBA_ROLLING_ROLE_AS_OF="",NBA_DAILY_OFFICIAL_OUTLOOK="",OPENBLAS_NUM_THREADS="1",OMP_NUM_THREADS="1")
    with (out/"capture.log").open("x") as log:
        subprocess.run(["Rscript","--vanilla",str(driver),str(repo),str(raw),str(season)],cwd=repo,
            env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=900)
    need(all(bind(v["path"])==v for v in pins.values()),"Bound source changed during capture")
    load=lambda k:read(pins[k]["path"])
    rows=build_rows(read(raw),load("signed_book"),load("schedule"),load(BASE_FILES[0]),load(BASE_FILES[1]),asof,season)
    output=out/"role-roster.json";write(output,rows)
    write(out/"receipt.json",{"schema":"nba-shared-unallocated-roster-shadow-v1","asof":asof,"season":season,
        "input_bindings":pins,"raw_capture":bind(raw),"roster":bind(output),"signed_count":sum(not p["contract_pending"] for p in rows),
        "pending_count":sum(p["contract_pending"] for p in rows),"legacy_current_impact_read":False,
        "availability_already_applied":False,"rotation_already_applied":False,"production":False})
    return output

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("repo","out","source-r","collector","ownership","asof","source-r-sha","collector-sha","ownership-sha"):p.add_argument("--"+k,required=True)
    p.add_argument("--season",type=int,required=True)
    a=vars(p.parse_args());a["expected"]={k:a.pop(k+"_sha") for k in ("source_r","collector","ownership")}
    print(prepare(**a))
