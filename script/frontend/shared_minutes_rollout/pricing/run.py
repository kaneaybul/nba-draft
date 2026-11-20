"""Build one receipt-bound current or historical singleton shared player quote set. Never publishes."""
import argparse, contextlib, csv, hashlib, importlib.util, json, math, os, shutil, sys, warnings
from datetime import date
from pathlib import Path
SCHEMA="nba-shared-daily-player-pricing-config-v1"
VERSION="shared-minutes-comparables-career-v3-conditional-tail"
METHOD="peak4-payroll-0.8-v20-"+VERSION+"-current"
TEAMS=set("ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())
FILES=("league_player_coverage.json","monthly_player_values.csv","monthly_annual_values.csv","monthly_quote_carry_states.csv")
CALFILES={"released_calibrator.py","original_path_calibration.json.gz","original_endpoint_pick_model.json","reconstructed_calibration.json.gz","exact_released_training_components.json.gz"}
MODULE_FILES={"script/asset_history/backfill/run_player_refresh.py","script/asset_history/joint_pricing.py","script/asset_history/endpoint_stock.py"}

def need(x,msg):
    if not x:raise ValueError(msg)
def sha(p):
    h=hashlib.sha256()
    with Path(p).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()
def load(p):return json.loads(Path(p).read_bytes())
def digest(s):
    return isinstance(s,str) and len(s)==64 and all(x in "0123456789abcdef" for x in s)
def pinned(root, item):
    p=(root/item["path"]).resolve(strict=True); h=item["sha256"]
    need(digest(h) and p.is_file() and sha(p)==h,"Digest differs: "+str(p))
    return p
def compact(x):return json.dumps(x,separators=(",",":"),allow_nan=False)
def write(p,x):
    with p.open("x") as f:f.write(compact(x)+"\n")
def check_day(s):
    need(date.fromisoformat(s).isoformat()==s,"Invalid knowledge date")
    return s
def module(p,name):
    s=importlib.util.spec_from_file_location(name,p)
    m=importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
def roster(book,day,season):
    need(book["as_of"]==day and book["season"]==season and book["complete"] is True,"Stale or incomplete ownership")
    def members(rows):
        r={}
        for row in rows:
            pid=str(row["nba_id"]);t=row["team"]
            need(pid.isdigit() and int(pid)>0 and pid not in r and t in TEAMS,"Invalid roster identity")
            r[pid]=t
        return r
    s,p=members(book["players"]),members(book.get("contract_pending",[]))
    need(not s.keys()&p.keys() and set(s.values())==TEAMS,"Pending/signed overlap or incomplete league")
    return s,p
def normalize_scope(raw,owners,pending,day,season):
    need(raw.get("asof")==day and raw.get("season")==season,"Stale appraisal scope")
    rows=raw.get("scope",raw.get("players"))
    need(set(rows) in (set(owners),set(owners)|set(pending)),"Appraisal scope does not match exact owners")
    ret={}
    for pid,r in rows.items():
        need(r["team"]==(owners|pending)[pid],"Scope team differs from ownership")
        yrs=r["appraisal_seasons"]; clock=r["team_game_clock"]
        need(type(clock) in (int,float) and math.isfinite(clock) and clock==int(clock) and (season-2000)*82<=clock<(season-1999)*82,"Scope team clock invalid")
        need(isinstance(yrs,list) and (not yrs or (len(yrs)==4 and all(type(y) is int for y in yrs) and yrs==list(range(yrs[0],yrs[0]+4)) and yrs[0]>season)),"Incomplete or invalid year-four scope")
        if pid in pending:need(not yrs,"Do not price pending owners")
        else:ret[pid]=r
    return ret

def verify_service(service,scope,day,stamp):
    need(service["asof"]==day and service["forecast_version"]==VERSION and service["prices_generated"] is False,"Invalid service scope/version")
    app={pid:r for pid,r in scope.items() if r["appraisal_seasons"]}
    n=sum(len(r["appraisal_seasons"]) for r in app.values())
    need(set(app)==set(service["players"]) and service["appraisals_with_complete_service"]==len(app) and service["annual_service_cells"]==stamp["endpoint_annual_cells"]==n,"Service count/identities differ")
    for pid,r in app.items():
        s=service["players"][pid]
        need(s["team"]==r["team"] and [x["season"] for x in s["seasons"]]==r["appraisal_seasons"],"Service team/years differ")
        for x in s["seasons"]:
            g,m=x["expected_games"],x["expected_minutes"]
            need(math.isfinite(g) and math.isfinite(m) and 0<=g<=82+1e-8 and 0<=m<=48*g+1e-7,"Invalid expected service")
    return n
def verify_carry(team_paths,scope,day):
    saw=set();n=0
    by={t:{} for t in TEAMS}
    for pid,r in scope.items():by[r["team"]][pid]=r
    for t in TEAMS:
        rows={}
        with team_paths[t]["monthly_quote_carry_states.csv"].open() as f:
            for r in csv.DictReader(f):
                need(r["cutoff_date"]==day,"Mixed-date native carry")
                if r["active_asset"].lower()!="true" or not r["source_nba_id"]: continue
                pid=str(int(float(r["source_nba_id"])))
                if pid not in by[t]:
                    need(pid not in scope,"Native carry owner differs")
                    continue
                need(r["joint_pricing_policy"]=="resolved-shared-game-service-v1","Signed current carry used legacy pricing")
                y=int(r["season"]); player=rows.setdefault(pid,{})
                need(y not in player,"Duplicate carry year")
                player[y]=r
        need(rows.keys()==by[t].keys(),"Native carry lacks signed owner")
        for pid,r in by[t].items():
            for y in r["appraisal_seasons"]:
                row=rows[pid].get(y)
                need(row is not None and row["endpoint_shared_forecast_version"]==VERSION and math.isfinite(float(row["endpoint_shared_annual_impact_minutes"])),"Native endpoint did not consume shared service")
                n+=1
            saw.add(pid)
    need(saw==set(scope),"Incomplete signed carry")
    return n
def vintage_index(x,key,expected):
    d=check_day(x[key]);need(d==expected and isinstance(x["players"],dict),"Wrong valuation source vintage");return d
def grade_policy(grades,day):
    for key,row in grades.items():
        p,sep,endpoint=key.partition("|");need(p.startswith("player:") and sep and check_day(endpoint)<=day,"Future grade checkpoint")
        need(row["completed"] is True and row["status"]=="priced" and check_day(row["assessment_date"])<=day and row["endpoint"]==endpoint,"Invalid frozen grade checkpoint")

def run(config, config_sha, dest, check_only=False):
    root=config.parent; c=load(pinned(root,{"path":str(config),"sha256":config_sha}))
    need(c["schema"]==SCHEMA and c["forecast_version"]==VERSION and c["method"]==METHOD,"Unreviewed quote method")
    day=check_day(c["asof"]);season=int(day[:4])+(int(day[5:7])>=7)
    need(c["season"]==season and c["mode"] in ("current","archived_same_date_replay"),"Wrong mode or season")
    repo=(root/c["repo"]).resolve(strict=True);rt=(root/c["runtime"]).resolve(strict=True)
    z={k:pinned(root,v) for k,v in c["inputs"].items()}
    needed={"native_receipt","native_manifest","native_run_config","ledger","service","signed_book","scope","control_packet","control_receipt","legacy_assembly","grade_vintage_index","grade_checkpoint","calibrator","calibration_pick","mapper","shared_adapter"}
    need(set(z)==needed,"Missing explicit pricing input pin")
    source={x:pinned(repo,{"path":x,"sha256":h}) for x,h in c["pricing_source_sha256"].items()}
    need(set(source)==MODULE_FILES,"Missing pricing module pin")
    stamp=load(z["native_receipt"]);man=load(z["native_manifest"]); orig=load(z["native_run_config"])
    need(stamp["schema"] in {"nba-nov20-shared-native-candidate-v1","nba-shared-native-candidate-v1","nba-dated-shared-native-candidate-v1"} and stamp["asof"]==day and stamp["forecast_version"]==VERSION and stamp["teams"]==30 and stamp.get("production",stamp.get("archive_publication")) is False,"Wrong or incomplete native replay receipt")
    need(stamp["config_sha256"]==c["inputs"]["native_run_config"]["sha256"] and stamp["native_manifest_sha256"]==c["inputs"]["native_manifest"]["sha256"] and man["as_of"]==day,"Native receipt/config/batch conflict")
    need(stamp["ledger_sha256"]==orig["ledger_sha256"]==c["inputs"]["ledger"]["sha256"] and stamp["service_sha256"]==c["inputs"]["service"]["sha256"],"Native prices not bound to actual shared ledger")
    signed,pending=roster(load(z["signed_book"]),day,season);scope=normalize_scope(load(z["scope"]),signed,pending,day,season)
    expected={p:{k:r[k] for k in ("team","team_game_clock")} for p,r in scope.items()}
    if "scope_sha256" in stamp:need(stamp["scope_sha256"]==sha(z["scope"]),"Native replay scope pin differs")
    need(orig["asof"]==day and orig["forecast_version"]==VERSION and orig["eligible"]==expected and stamp["players"]==len(signed),"Native eligible set differs from authoritative roster")
    need(orig["scope"]=="all-eligible-current-endpoints" and orig["cutover_booking"]=="separate-method-rebase","Wrong native pricing seam")
    for p,t in signed.items():
        owner=man["owners"].get(p,{})
        need(owner.get("team")==t and owner.get("last_owned_day")==day and owner.get("has_impact") is True,"Native ownership manifest differs")
    control=load(z["control_packet"]); control_receipt=load(z["control_receipt"])
    vintage_index(control,"observation_date",day)
    need(set(control["players"])==set(signed) and control["owners"]==signed,"Control roster differs")
    legacy=load(z["legacy_assembly"])
    need(legacy["asof"]==day and legacy["production"] is False and legacy["player_receipt_sha256"]==sha(z["control_receipt"]) and legacy["native_receipt_sha256"]==control_receipt["native_receipt_sha256"] and legacy["signed_book_sha256"]==sha(z["signed_book"]),"Current same-date legacy control assembly provenance differs")
    need(control_receipt["asof"]==day and control_receipt["packet_sha256"]==c["inputs"]["control_packet"]["sha256"] and control_receipt["signed_book_sha256"]==c["inputs"]["signed_book"]["sha256"],"Control prices not bound to exact dated pre-shared inputs")
    if "original_canonical_native_receipt_sha256" in stamp:
        need(control_receipt["native_receipt_sha256"]==stamp["original_canonical_native_receipt_sha256"] and control_receipt["source_preparation_receipt_sha256"]==stamp["original_prepared_receipt_sha256"],"Retained control and shared replay provenance differ")
    base=load(z["grade_vintage_index"])
    vintage=check_day(c["grade_vintage_asof"])
    vintage_index(base,"current_observation_date",vintage)
    need(vintage<=day,"Archived replay cannot borrow future graded knowledge")
    grades=load(z["grade_checkpoint"]);grade_policy(grades,day)
    cal={n:pinned(z["calibrator"].parent,{"path":n,"sha256":h}) for n,h in c["calibration_dependency_sha256"].items()}
    need(set(cal)==CALFILES and cal["released_calibrator.py"]==z["calibrator"] and c["calibration_dependency_sha256"]==control_receipt["calibration_dependencies"] and control_receipt["calibrator_sha256"]==sha(z["calibrator"]),"Calibrator differs from released components")
    need(z["calibration_pick"]==z["calibrator"].parent.parent/"exact_trained_pick_model.json","Unexpected calibrator pick location")
    n=verify_service(load(z["service"]),scope,day,stamp)
    stage=(root/c["native_output"]).resolve(strict=True)
    need(stage==z["native_manifest"].parent/"output","Wrong native output sibling")
    hashes=c["native_output_sha256"];need(set(hashes)==TEAMS,"Missing 30-team batch proof")
    if "output_sha256" in stamp:
        need(all(stamp["output_sha256"].get(f"output/{t}/{n}")==h for t,paths in hashes.items() for n,h in paths.items()),"Native output pin differs from upstream receipt")
    team_paths={t:{k:pinned(stage/t,{"path":k,"sha256":h}) for k,h in paths.items()} for t,paths in hashes.items()}
    need(all(set(paths)==set(FILES) for paths in team_paths.values()),"Incomplete native team input list")
    need(verify_carry(team_paths,scope,day)==n,"Native appraisal proof count differs")
    completed={}
    for p,row in base["players"].items():
        g=row.get("draft_development") or {}
        if p in scope and g.get("completed") is True:
            need(check_day(g["endpoint"])<=vintage and check_day(g["assessment_date"])<=vintage and not scope[p]["appraisal_seasons"],"Frozen grade vintage clashes with open appraisal")
            completed[p]=g
    proof={"schema":"nba-dated-shared-player-pricing-receipt-v1","asof":day,"season":season,"method":METHOD,"forecast_version":VERSION,"ledger_sha256":sha(z["ledger"]),"service_sha256":sha(z["service"]),"native_receipt_sha256":sha(z["native_receipt"]),"native_manifest_sha256":sha(z["native_manifest"]),"native_run_config_sha256":sha(z["native_run_config"]),"grade_vintage_sha256":sha(z["grade_vintage_index"]),"grade_vintage_asof":vintage,"signed_book_sha256":sha(z["signed_book"]),"scope_sha256":sha(z["scope"]),"endpoint_annual_cells":n,"teams":30,"players":len(signed),"pending_explicitly_unpriced":len(pending),"frozen_completed_grades":len(completed),"config_sha256":config_sha,"production":False,"release_ready":False}
    if check_only:return proof
    need(not dest.exists(),"Use a fresh output directory")
    dest.mkdir(parents=True);tmp=dest/"native_pricing"
    for t,paths in team_paths.items():
        (tmp/t).mkdir(parents=True)
        for name,p in paths.items():shutil.copyfile(p,tmp/t/name)
    chk=tmp/"player_state_staged/final_draft_results.json";chk.parent.mkdir();shutil.copyfile(z["grade_checkpoint"],chk)
    local=dest/"pricing_context_relocated.json"
    # Relocate only the executor's path. Original native config and its external pin still
    # certify the archived content, and the CSV digest must remain identical.
    write(local, orig|{"ledger":str(z["ledger"])})
    os.environ["NBA_SHARED_NATIVE_CONFIG"]=str(local)
    os.environ["NBA_SHARED_NATIVE_CONFIG_SHA256"]=sha(local)
    sys.path[:0]=[str(repo/"script"),str(repo/"script/asset_history"),str(repo/"script/asset_history/backfill"),str(rt/"monthly_reconstruction/projections")]
    import run_player_refresh,joint_pricing
    for mod,rel in ((run_player_refresh,"script/asset_history/backfill/run_player_refresh.py"),(joint_pricing,"script/asset_history/joint_pricing.py")):
        need(Path(mod.__file__).resolve()==source[rel],"Imported unexpected pricing source")
    service=module(z["shared_adapter"],"reviewed_shared_quote_context")
    native_validate=joint_pricing.validate
    def checked_context(ctx):
        if ctx.get("policy")!=service.POLICY:return native_validate(ctx)
        expected=service.configured_context(ctx["nba_id"],ctx["team"],ctx["cells"][0][0],ctx["asof"])
        need(ctx==expected,"Serialized pricing path differs from pinned shared ledger")
        return ctx
    joint_pricing.validate=checked_context
    calibrator=module(z["calibrator"],"released_daily_calibrator").create(repo,rt)
    mapper=module(z["mapper"],"released_daily_mapper")
    packet=run_player_refresh.export(tmp,day,calibrator)
    players={};owners={};open_grades=0; unsigned=[]
    need({r["team"] for r in packet["snapshots"]}==TEAMS and len(packet["snapshots"])==30,"Incomplete pricing snapshots")
    for row in packet["snapshots"]:
        need(row["date"]==day and not row["unpriced_players"],"Incomplete signed price")
        for a in row["assets"]:
            if not a["id"].startswith("player:nba:"):
                need(a["details"]["asset_type"]=="unsigned_draft_right","Unknown native asset identity");unsigned.append(a["id"]);continue
            pid=a["id"].split(":")[-1]
            need(pid not in players and signed.get(pid)==row["team"] and math.isfinite(a["value"]) and abs(a["exposure"]-4)<1e-8,"Wrong price ownership or exposure")
            r=mapper.player_quote(a,day)
            if pid in completed:r["draft_development"]=completed[pid];a["details"]["draft_development"]=completed[pid]
            if scope[pid]["appraisal_seasons"]:
                d=r.get("draft_development",{});old=control["players"][pid].get("draft_development",{});y=scope[pid]["appraisal_seasons"][0]-1
                need(d.get("status")=="priced" and d.get("completed") is False and d.get("endpoint")==old.get("endpoint")==f"{y}-07-31" and d["original_expectation"]==old.get("original_expectation") and math.isfinite(d["value"]),"Open endpoint appraisal missing or prior/vintage changed");open_grades+=1
            players[pid]=r;owners[pid]=row["team"]
    need(owners==signed and open_grades==n//4,"Missing signed prices or open grades")
    result={"schema":"nba-dated-shared-player-quotes-v1","asof":day,"season":season,"method":METHOD,"players":players,"owners":owners,"model_forecast_version":VERSION,"ledger_sha256":proof["ledger_sha256"],"native_receipt_sha256":proof["native_receipt_sha256"],"baseline_private_source_sha256":sha(z["control_packet"]),"calibrator_sha256":sha(z["calibrator"]),"ready_to_publish":False}
    write(dest/"candidate_players.json",result)
    write(dest/"native_asset_packet.json",packet|{"current_quote_method":METHOD,"forecast_version":VERSION,"ledger_sha256":proof["ledger_sha256"],"native_receipt_sha256":proof["native_receipt_sha256"]})
    proof.update(candidate_sha256=sha(dest/"candidate_players.json"),asset_packet_sha256=sha(dest/"native_asset_packet.json"),frozen_grade_checkpoint_sha256=sha(chk),relocated_execution_config_sha256=sha(local),open_appraisals=open_grades,unsigned_draft_rights_excluded=len(unsigned))
    write(dest/"receipt.json",proof)
    return proof

if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("config",type=Path);p.add_argument("sha256");p.add_argument("out",type=Path);p.add_argument("--check-only",action="store_true");a=p.parse_args()
    print(json.dumps(run(a.config.resolve(),a.sha256,a.out.resolve(),a.check_only),indent=2))
