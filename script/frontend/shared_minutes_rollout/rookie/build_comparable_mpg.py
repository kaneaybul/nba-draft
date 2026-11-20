"""Same weighted conditional-MPG model for every player's unsupported anchors."""
import argparse
from collections import Counter
from datetime import date
from hashlib import sha256
import csv
import json
from pathlib import Path
import sys

import numpy as np

METHOD = "pr38-verified-near-plus-comparable-conditional-mpg-v2"
SCHEMA = "nba-shared-minutes-comparable-mpg-anchors-v1"
FEATURE_SCALE = np.array([4., 20., 7., 1.7, 32., 5.])
NEIGHBORS = 60
REGULARIZATION = .35
PROTECTED_NEAR = 4


def sha(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def binding(path):
    return {"path":str(Path(path).resolve()),"sha256":sha(path)}


def checked(path, digest):
    if sha(path) != digest: raise ValueError("Source hash mismatch: "+str(path))
    return Path(path)


class ConditionalMpg:
    def __init__(self, panel, gp_mpg, as_of_year, count, features):
        self.folds = []
        for horizon in range(1,count+1):
            x,m,g = [],[],[]
            for origin in sorted(panel):
                target = origin+horizon
                if target>as_of_year or target not in gp_mpg:continue
                for pid,row in panel[origin].items():
                    if row["games"]<5:continue
                    pair = gp_mpg[target].get(pid)
                    if pair is None:continue
                    games, mpg=pair
                    if (not np.isfinite([games,mpg]).all() or games<=0 or not 0<mpg<=48):
                        raise ValueError("Bad confirmed conditional-MPG outcome")
                    x.append(features(panel,origin,pid));m.append(mpg);g.append(games)
            if len(x)<NEIGHBORS:
                raise ValueError(f"Insufficient confirmed positive MPG outcomes at horizon {horizon}")
            x=np.asarray(x)/FEATURE_SCALE
            if not np.isfinite(x).all():raise ValueError("Bad comparator features")
            self.folds.append((x,np.asarray(m),np.asarray(g)))

    def predict(self, feature):
        query=np.asarray(feature)/FEATURE_SCALE
        if query.shape!=FEATURE_SCALE.shape or not np.isfinite(query).all():
            raise ValueError("Bad query features")
        result=[]; effective=[]
        for x,mpg,gp in self.folds:
            d=np.square(x-query).sum(axis=1)
            idx=np.argsort(d,kind="stable")[:NEIGHBORS]
            # Match PR38's feature-distance weights, then estimate the minute
            # rate for an appearance, not the average rate of a player-season.
            # A player with two appearances must not count like one with 82.
            w=gp[idx]/(REGULARIZATION+d[idx])
            value=np.dot(w,mpg[idx])/w.sum()
            if not np.isfinite(value) or not 0<value<=48:
                raise ValueError("Bad conditional MPG prediction")
            result.append(float(value));effective.append(float(w.sum()**2/np.dot(w,w)))
        return result,effective


def completed_observations(audit, outcome, brefdir, asof_year):
    if (outcome["schema"]!="nba-complete-appearance-outcomes-v1"
        or outcome["through_season"]!=asof_year):
        raise ValueError("Wrong positive outcome packet season")
    years=set(map(int,outcome["seasons"]))
    if years!=set(map(int,audit["bref_sha256"])) or max(years)!=asof_year:
        raise ValueError("Outcome and BRef coverage differ")
    observed={}
    for y in sorted(years):
        source=outcome["seasons"][str(y)]
        came_from=source["source"]
        # Validate the admitted original raw evidence, not only the outcome table.
        checked(came_from["path"],came_from["sha256"])
        bref=checked(brefdir/f"bref_{y}.csv",audit["bref_sha256"][str(y)])
        with bref.open(newline="") as f:
            records=list(csv.DictReader(f))
        rows={r["bref_id"]:r for r in records if r["bref_id"]}
        if len(rows)!=sum(bool(r["bref_id"]) for r in records):
            raise ValueError("Duplicate BRef ID")
        byid=observed[y]={}
        for pid,o in source["players"].items():
            if o["status"]!="appeared":continue
            if o["identity_status"]!="verified":raise ValueError("Unverified positive outcome")
            if source["uniform_team_games"] is None:
                raise ValueError("Unexpected positive row from held outcome cohort")
            r=rows[audit["crosswalk"][pid]["bref_id"]]
            games=int(r["games"]);minutes=float(r["minutes"]);mpg=minutes/games
            if int(r["year"])!=y or games!=o["games"] or not np.isfinite(mpg):
                raise ValueError("Positive outcome and admitted completed source differ")
            byid[int(pid)]=(games,mpg)
    return observed


def verify_roster_origin(kind, pin, digest, roster, asof, season):
    if kind == "served-shadow":
        if pin is not None or digest is not None:raise ValueError("Unexpected roster origin pin for served shadow")
        return None
    if kind != "preallocation" or pin is None or not digest:
        raise ValueError("Pre-allocation requires authenticated capture receipt")
    r=json.loads(checked(pin,digest).read_bytes())
    if (r.get("asof")!=asof or r.get("season")!=season or r.get("roster")!=binding(roster)
          or r.get("availability_already_applied") is not False
          or r.get("rotation_already_applied") is not False
          or r.get("production") is not False):
        raise ValueError("Unverified unallocated production role input")
    if r.get("schema")=="nba-shared-unallocated-roster-shadow-v1":
        if r.get("legacy_current_impact_read") is not False:
            raise ValueError("Pre-allocation capture read legacy role allocations")
    elif r.get("schema")=="nba-reconstructed-early-role-roster-shadow-v1":
        allow={"identity and owner","date","position and per-minute demographics/features",
               "explicit unallocated priors"}
        if (r.get("reconstructed_not_early_r_capture") is not True
           or r.get("all_actuals_match") is not True
           or set(r.get("source_public_final_pass_through_only",[]))!=allow
           or set(r.get("source_inputs",{}))!={"signed_book","calendar","ratings","skills","injuries"}):
            raise ValueError("Unverified role reconstruction evidence")
        for item in [r["successful_r_receipt"],*r["source_inputs"].values()]:
            checked(item["path"],item["sha256"])
    else:
        raise ValueError("Unsupported unallocated role roster receipt")
    return binding(pin)


def assemble(core,history,roster,bref,outcome_path,outcome_sha,audit_path,audit_sha,roster_sha,asof,season,last_service_year,out,roster_kind,roster_receipt=None,roster_receipt_sha=None):
    sys.path.insert(0,str(core.resolve()))
    from shared_minutes import ComparableGames
    from build_shared_roles import read_history
    from shared_minutes_horizon import required_anchors,required_length
    date.fromisoformat(asof)
    data=json.loads(checked(roster,roster_sha).read_bytes())
    roster_origin=verify_roster_origin(roster_kind,roster_receipt,roster_receipt_sha,roster,asof,season)
    audit=json.loads(checked(audit_path,audit_sha).read_bytes())
    outcome=json.loads(checked(outcome_path,outcome_sha).read_bytes())
    hist_files={p.name:p for p in history.glob("*.json") if p.stem.isdigit() and int(p.stem)<season}
    if set(hist_files)!=set(audit["history_sha256"]):
        raise ValueError("Dated origin panels differ from completed inputs")
    for name,p in hist_files.items():checked(p,audit["history_sha256"][name])
    panel=read_history(history,season)
    count=required_anchors(required_length(season,last_service_year))
    observed=completed_observations(audit,outcome,bref,season-1)
    model=ConditionalMpg(panel,observed,season-1,count,ComparableGames.features)
    predictions={};counts={i:Counter() for i in range(count)}
    effs={i:[] for i in range(count)}
    for p in data:
        if p["pool_status"]!="roster":continue
        pid=p.get("source_nba_id") or p["nba_id"]
        if type(pid) is not int or pid<=0 or str(pid) in predictions:
            raise ValueError("Invalid roster identity")
        if p["year"]!=season or (p.get("minutes_checked_at") or "")[:10]!=asof:
            raise ValueError("Wrong roster date or season")
        prior=panel[season-1].get(pid)
        near=p["minutes_mpg_prior"]
        # Same PR38 fallback evidence when there is no eligible NBA origin;
        # rookies are not assigned a separate MPG trajectory/formula.
        if prior and prior["games"]>=5:
            query=ComparableGames.features(panel,season-1,pid)
            query_source="completed_player_features"
        else:
            gp=p["minutes_gp_prior"]
            actual_games=p.get("minutes_actual_games")or 0
            near_updated=(10*near+p["minutes_actual"])/(10+actual_games) if actual_games else near
            query=[p["age"],gp,near_updated,p["total"],0,p["yoe"]or 0]
            query_source="dated_roster_features"
        comp,effective=model.predict(query)
        anchors={};sources={}
        for i in range(count):
            year=str(season+i)
            locked=near if i==0 else p.get(f"projection_mpg_y{i}") if i<=PROTECTED_NEAR else None
            if i==0 and (type(locked) not in (int,float) or not np.isfinite(locked) or not 0<=locked<=48):
                raise ValueError("Missing or invalid production opener")
            if locked is not None and (type(locked) not in (int,float) or not np.isfinite(locked) or not 0<=locked<=48):
                raise ValueError("Invalid reported production MPG anchor")
            source="comparables" if locked is None else "production"
            anchors[year]=comp[i] if locked is None else locked
            sources[year]=source
            counts[i][source]+=1
            if source=="comparables":effs[i].append(effective[i])
        predictions[str(pid)]={"team":p["team"],"anchors":anchors,"anchor_sources":sources,
                               "query_source":query_source}
    if not predictions:raise ValueError("No supported roster")
    payload={"schema":SCHEMA,"method":METHOD,"mpg_method":METHOD,"asof":asof,"season":season,
             "last_service_year":last_service_year,"anchor_count":count,"roster":binding(roster),
             "roster_kind":roster_kind,"roster_capture_receipt":roster_origin,
             "outcome_source":binding(outcome_path),"outcome_audit":binding(audit_path),
             "history_sha256":audit["history_sha256"],
             "method_sources":{name:binding(path) for name,path in (
                 ("producer",Path(__file__)),("gp_comparison",core/"shared_minutes.py"),
                 ("origin_features",core/"build_shared_roles.py"),
                 ("horizon_clock",core/"shared_minutes_horizon.py"))},
             "players":predictions,
             "support":{"positive_samples_by_horizon":{season+i:len(fold[1]) for i,fold in enumerate(model.folds)},
                        "source_counts":{season+i:dict(c)for i,c in counts.items()},
                        "comparable_effective_neighbors_min":{season+i:min(l)for i,l in effs.items() if l},
                        "neighbor_count":NEIGHBORS,"target":"observed minutes conditional on positive GP",
                        "weights":"raw GP / (0.35 + scaled squared feature distance)",
                        "scope":"dated MPG anchors only, no allocation, pricing or appraisal scope certified"}}
    with out.open("x") as fp:json.dump(payload,fp,sort_keys=True,indent=2,allow_nan=False);fp.write("\n")
    return payload


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    for k in ("core","history","roster","bref","outcome-path","audit-path","out"):
        p.add_argument("--"+k,type=Path,required=True)
    for k in ("outcome-sha","audit-sha","roster-sha","asof"):
        p.add_argument("--"+k,required=True)
    p.add_argument("--roster-kind",required=True,choices=["served-shadow","preallocation"])
    p.add_argument("--roster-receipt",type=Path)
    p.add_argument("--roster-receipt-sha")
    for k in ("season","last-service-year"):
        p.add_argument("--"+k,type=int,required=True)
    a=p.parse_args();r=assemble(**vars(a));print(json.dumps(r["support"],indent=2))
