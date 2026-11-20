"""Isolated post-legacy shared roster, ledger, and native stage. Never publishes."""
import argparse, csv, hashlib, importlib.util, json, math, os, re, shutil, subprocess, sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

TEAMS=set("ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())
VERSION="shared-minutes-comparables-career-v3-conditional-tail"
POLICY="resolved-shared-game-service-v1"
LAYOUT={
 "runtime/monthly_reconstruction/projections/integrate_monthly.py":("integrate_monthly.patch","ea854f90cebf21908331ee6b21aec1ce6a82a587347411143ba3e7a10f32888a","872db1f399d689a210eea8a6bc007f5e04000bfe09a110f6b1e6473529991d70"),
 "repo/script/asset_history/backfill/league_player_values.py":("league_player_values.patch","43ba1af22cfaca941abb97e758abdddc825654a2409254ed5b5cb8d722b30d62","af5d2ad40e96f1e6b7c2b23201fce6296105fb41b9bcf7bb68917562707e556b"),
 "repo/script/asset_history/calibration/endpoint_model.py":("endpoint_model.patch","781f64e5a1763f7459787669fc2045bbfe85930c5e03f57af7a8e946885814dc","693baa44ce7b59d97cf12eb8c7c92aa221370c50600c816a0eef163589dd9b09"),
}
ADAPTER="runtime/monthly_reconstruction/projections/shared_joint_adapter.py"
ADAPTER_SHA="b665248f7fc373fd01b2a33ba713673ca6299d8c46833ea63012e87099760bc3"

def require(v,msg):
 if not v: raise ValueError(msg)
def digest(p):
 with Path(p).open("rb") as f: return hashlib.file_digest(f,"sha256").hexdigest()
def read(p): return json.loads(Path(p).read_bytes())
def bind(p): p=Path(p).resolve(strict=True); return {"path":str(p),"sha256":digest(p)}
def pin(x): p=Path(x["path"]).resolve(strict=True); require(digest(p)==x["sha256"],f"Changed {p.name}"); return p
def write(p,x):
 with Path(p).open("x") as f: json.dump(x,f,sort_keys=True,separators=(",",":"),allow_nan=False);f.write("\n")
def script(s,*args,env=None):
 subprocess.run([sys.executable,str(s),*map(str,args)],check=True,env=env)
def source(root,ref,rel):
 p=pin(ref); require(p==root/rel,"Unexpected executable location: "+rel);return p
def exact_directory(path,names):
 require({p.name for p in path.iterdir()}==set(names),"Unexpected directory contents: "+path.name)
def docket(root,d):
 require(date.fromisoformat(d).isoformat()==d and root.name==d,"Use a private date-named output")
 require(not root.exists(),"Never overwrite existing phase")
 root.mkdir(parents=True)
def roster_map(rows):
 result={}
 for r in rows:
  pid=str(r.get("source_nba_id") or r["nba_id"])
  require(pid.isdigit() and pid not in result and r["team"] in TEAMS and type(r["contract_pending"]) is bool,"Invalid roster identity")
  result[pid]=r
 return result

def admitted(c):
 d=c["asof"]; day=date.fromisoformat(d); y=c["season"]
 require(y==day.year+(day.month>=7),"Date/season mismatch")
 names=("legacy_assembly","native_receipt","prepared_receipt","calibration_receipt","calibration","injuries","player_receipt","players","signed_book","collector","source_r","schedule","outlook")
 files={k:pin(c[k]) for k in names}
 a,n,p,cal,q,b,co,sr=(read(files[k]) for k in ("legacy_assembly","native_receipt","prepared_receipt","calibration_receipt","player_receipt","signed_book","collector","source_r"))
 require(all(x["asof"]==d for x in (a,n,p,cal,q,co,sr)) and a["season"]==sr["season"]==co["season"]==y,"Mixed legacy handoff dates")
 require(a["production"] is False and a["release_ready"] is False and set(("source_r","native_prepare","calibration","native_replay","player_quotes"))<=set(a["completed"]),"Legacy handoff is not complete private work")
 require(n["complete"] is True and co["source_checks_pass"] is True and co["protected_bytes_unchanged"] is True and b["complete"] is True and b["as_of"]==d and b["season"]==y,"Unaccepted source evidence")
 require(a["native_receipt_sha256"]==q["native_receipt_sha256"]==digest(files["native_receipt"]) and a["player_receipt_sha256"]==digest(files["player_receipt"]),"Wrong same-date native/quote receipt")
 require(a["signed_book_sha256"]==q["signed_book_sha256"]==digest(files["signed_book"]) and q["packet_sha256"]==digest(files["players"]),"Wrong same-date owner/quote packet")
 require(cal["reviewed"] is True and cal["fixed_parameters_only"] is True and cal["injuries_asof"]==d and cal["calibration_sha256"]==digest(files["calibration"]) and cal["injuries_sha256"]==digest(files["injuries"]),"Wrong calibration/outlook inputs")
 require(n["calibration_receipt_sha256"]==digest(files["calibration_receipt"]) and cal["source_preparation_receipt_sha256"]==q["source_preparation_receipt_sha256"]==digest(files["prepared_receipt"]),"Wrong native preparation/calibration lineage")
 require(sr["schedule"]["sha256"]==digest(files["schedule"]) and sr["schedule"]["asof"]==d,"Wrong dated schedule")
 outlook=read(files["outlook"]); require(outlook["generated_at"][:10]==d and outlook["teams_checked"]==30 and outlook["season"]==y,"Wrong short-horizon outlook")
 # Direct admitted preparation bytes, not an independently relabeled collector payload.
 require(any(v.get("sha256")==digest(files["outlook"]) for v in p["sources"].values() if isinstance(v,dict)),"Selected outlook is not explicitly bound by native preparation")
 return files,n,b

def roster_elapsed(row):
 remaining=row["minutes_remaining_team_games"]; require(type(remaining) is int and 0<=remaining<=82,"Invalid roster remaining team clock")
 elapsed=82-remaining
 require(row.get("team_elapsed_games",elapsed)==elapsed,"Conflicting team clocks")
 return elapsed

def derive_scope(c,files,n,b,roster):
 d,y=c["asof"],c["season"]; root=Path(c["legacy_native_batch"]).resolve(strict=True)
 r=roster_map(read(roster)); pr=read(files["players"])
 signed={str(x["nba_id"]):x["team"] for x in b["players"]}; pending={str(x["nba_id"]):x["team"] for x in b["contract_pending"]}
 require(len(signed)==len(b["players"]) and len(pending)==len(b["contract_pending"]) and not signed.keys()&pending.keys() and set(signed.values())==TEAMS,"Invalid legal book")
 require({pid:x["team"] for pid,x in r.items() if not x["contract_pending"]}==signed and {pid:x["team"] for pid,x in r.items() if x["contract_pending"]}==pending,"Roster disagrees with priced/pending book")
 require(pr["observation_date"]==d and pr["owners"]==signed and pr["players"].keys()==signed.keys(),"Legacy quote membership differs")
 require(digest(root/"manifest.json")==n["batch_manifest_sha256"],"Wrong legacy observation batch")
 scope={}; pins={}
 for t in sorted(TEAMS):
  f=root/"output"/t/"monthly_player_values.csv"
  key=f"{t}/{f.name}"; pins[key]=digest(f); require(pins[key]==n["output_sha256"][key],"Legacy native row proof mismatch")
  with f.open(newline="") as stream:
   for row in csv.DictReader(stream):
    pid=str(json.loads(row["impact_identity_json"]))
    require(row["cutoff_date"]==d,"Mixed legacy native observations")
    if pid not in signed or row["active_asset"].lower()!="true" or row["asset_type"]=="unsigned_draft_right": continue
    require(pid not in scope and signed[pid]==t,"Wrong native priced owner")
    clock=(y-2000)*82+roster_elapsed(r[pid])
    require(float(row["impact_team_game_clock"])==clock,"Native vs roster absolute clock mismatch")
    g=pr["players"][pid].get("draft_development") or {};years=[]
    if g.get("completed") is False:
     m=re.fullmatch(r"(20[0-9]{2})-07-31",g["endpoint"]); require(m and g["status"]=="priced","Unpriced/unrecognised open native appraisal")
     close=int(m[1]);require(close==int(float(row["draft_year"]))+4 and close>=y,"Wrong draft service endpoint")
     years=list(range(close+1,close+5))
    scope[pid]={"team":t,"team_game_clock":clock,"appraisal_seasons":years,"contract_pending":False,"asset_type":row["asset_type"],"name":row["player_name"]}
 require(scope.keys()==signed.keys(),"Native book missing eligible quotes")
 for pid,t in pending.items():
  scope[pid]={"team":t,"team_game_clock":(y-2000)*82+roster_elapsed(r[pid]),"appraisal_seasons":[],"contract_pending":True,"asset_type":"confirmed_pending_explicitly_unpriced","name":r[pid]["player_name"]}
 return {"schema":"nba-appraisal-scope-v1","asof":d,"season":y,"players":scope,"priced_players":len(signed),"confirmed_pending_unpriced":len(pending),"legacy_native_output_sha256":pins}

def validate_ledger(ledger,service,scope):
 d,y=scope["asof"],scope["season"]; players=scope["players"]; group=defaultdict(list); teamgames=defaultdict(float)
 with Path(ledger).open(newline="") as f:
  for r in csv.DictReader(f):
   pid=r["nba_id"]; require(pid in players and r["asof"]==d and r["forecast_version"]==VERSION and r["team"]==players[pid]["team"],"Unexpected shared row date/version/owner")
   clock=int(float(r["team_game_clock"])); p,m,e=map(float,(r["probability"],r["conditional_mpg"],r["expected_minutes"]))
   require(all(map(math.isfinite,(p,m,e))) and 0<=p<=1 and 0<=m<=48 and abs(e-p*m)<=1e-8,"Invalid minute equation")
   group[pid].append((clock,int(r["game"]),p,e))
   if clock<(y-1999)*82:teamgames[(r["team"],clock)]+=e
 require(group.keys()==players.keys(),"Ledger misses people from dated scope")
 for pid,rows in group.items():
  for i,(g,j,*_) in enumerate(sorted(rows),1):
   require(j==i and g==players[pid]["team_game_clock"]+i-1,"Missing/duplicate game or clock")
 require(len(teamgames)==sum((y-1999)*82-min(v["team_game_clock"] for v in players.values() if v["team"]==t) for t in TEAMS) and all(abs(e-240)<1e-6 for e in teamgames.values()),"Incomplete regulation allocation")
 s=read(service); exp={p:v["appraisal_seasons"] for p,v in players.items() if v["appraisal_seasons"]}
 require(s["asof"]==d and s["forecast_version"]==VERSION and s["players"].keys()==exp.keys() and s["annual_service_cells"]==sum(map(len,exp.values())),"Appraisal service coverage differs")
 for pid,years in exp.items():
  q=s["players"][pid];require(q["team"]==players[pid]["team"] and [x["season"] for x in q["seasons"]]==years,"Appraisal seasons/ownership mismatch")
  for a in q["seasons"]:
   g=(a["season"]-2000)*82; held=[r for r in group[pid] if g<=r[0]<g+82]
   require(len(held)==82 and abs(sum(r[2] for r in held)-a["expected_games"])<1e-8 and abs(sum(r[3] for r in held)-a["expected_minutes"])<1e-7,"Service receipt disagrees with full-82 ledger")
 return len(group),len(teamgames),s["annual_service_cells"]

def native_scope(scope):
 return {k:v for k,v in scope["players"].items() if not v["contract_pending"]}

def state_inventory(batch,d,fingerprint=None):
 m=read(batch/"manifest.json")
 require(m["as_of"]==d and (fingerprint is None or m["model_source_hashes"]==fingerprint),"Wrong native checkpoint date/fingerprint")
 exact_directory(batch/"states",[f"{t}.json" for t in TEAMS])
 for t in TEAMS:
  x=read(batch/"states"/f"{t}.json")
  require(x["as_of"]==d and x["team"]==t and x["model_source_hashes"]==m["model_source_hashes"],"Mixed native checkpoint")
 return {"manifest.json":digest(batch/"manifest.json"),**{f"states/{t}.json":digest(batch/"states"/f"{t}.json") for t in sorted(TEAMS)}}

def verify_native(batch,scope):
 d=scope["asof"]; p=native_scope(scope)
 exact_directory(batch/"output",TEAMS)
 inv=state_inventory(batch,d);seen={}; cells=0; ep=set()
 for t in sorted(TEAMS):
  for f in sorted((batch/"output"/t).iterdir()):
   require(f.is_file() and not f.is_symlink(),"Unexpected native output member")
   inv[f.relative_to(batch).as_posix()]=digest(f)
  for file in ("monthly_player_values.csv","monthly_quote_carry_states.csv"):
   f=batch/"output"/t/file
   with f.open(newline="") as io:
    for r in csv.DictReader(io):
     active=r["active_asset"].lower()=="true"
     require(r["cutoff_date"]==d,"Mixed shared native outputs")
     if not active: continue
     if file=="monthly_player_values.csv":
      pid=str(json.loads(r["impact_identity_json"]))
      if pid not in p:
       require(r["asset_type"]=="unsigned_draft_right","Unexpected active, unpriced native asset")
       continue
      require(pid not in seen and p[pid]["team"]==t and float(r["impact_team_game_clock"])==p[pid]["team_game_clock"],"Shared native player owner/clock changed")
      seen[pid]=set()
     elif r["source_nba_id"]:
      pid=str(int(float(r["source_nba_id"])))
      if pid not in p: continue
      require(pid in seen,"Annual row lacks date-native active player")
      if r["joint_pricing_policy"]==POLICY: seen[pid].add("joint")
      yr=int(r["season"])
      if yr in p[pid]["appraisal_seasons"]:
       require((pid,yr) not in ep and r["endpoint_shared_forecast_version"]==VERSION and math.isfinite(float(r["endpoint_shared_annual_impact_minutes"])) and math.isfinite(float(r["endpoint_role_annual_minutes"])),"Incorrect draft endpoint context")
       ep.add((pid,yr));cells+=1
 require(seen.keys()==p.keys() and all(x=={"joint"} for x in seen.values()) and ep=={(pid,y) for pid,v in p.items() for y in v["appraisal_seasons"]},"Incomplete shared native pricing coverage")
 return inv,cells

def install_native(prepared,roll,refs,target,legacy_prepared):
 require(prepared.is_dir() and not target.exists() and prepared not in target.parents,"Use an isolated private prepared clone")
 for name, (_,old,_) in LAYOUT.items():
  require(digest(prepared/name)==old==legacy_prepared["prepared_files_sha256"][name],"Unreviewed native seam baseline")
  require((prepared/name).is_file() and not (prepared/name).is_symlink(),"Not an ordinary patch input")
 require(not (prepared/ADAPTER).exists(),"Adapter unexpectedly present in legacy tree")
 source_pins=legacy_prepared["prepared_files_sha256"]
 require(source_pins and all(not Path(rel).is_absolute() and ".." not in Path(rel).parts and digest(prepared/rel)==h for rel,h in source_pins.items()),"Prepared runtime/package differs from exact admitted inventory")
 for directory,subdirs,files in os.walk(prepared):
  require(not any((Path(directory)/x).is_symlink() for x in [*subdirs,*files]),"Refuse symbolic links in prepared tree")
 shutil.copytree(prepared,target)
 for name,(patch,_,new) in LAYOUT.items():
  part=name.split('/')[0]; f=source(roll,refs[patch],patch)
  subprocess.run(["patch","--batch","--forward","--fuzz=0","-p1","-i",str(f)],cwd=target/part,check=True)
  require(digest(target/name)==new,"Patched native bytes do not match reviewed seam")
 f=source(roll,refs["shared_joint_adapter.py"],"shared_joint_adapter.py")
 require(digest(f)==ADAPTER_SHA,"Unreviewed adapter")
 shutil.copy2(f,target/ADAPTER)

def make_seed(c,out,fp):
 r=read(pin(c["predecessor_receipt"])); mode=c["mode"]; day=r["asof"]
 batch=Path(c["predecessor_batch"]).resolve(strict=True)
 require(day<c["asof"],"Native prior must precede target")
 inv=state_inventory(batch,day); m=read(batch/"manifest.json")
 if mode=="first-cutover":
  require(r["schema"]=="nba-archive-ready-continuation-v1" and all(r["files"].get(k)==v for k,v in inv.items()),"Missing authenticated legacy predecessor")
  before=m["model_source_hashes"];require(fp.keys()==before.keys(),"Native fingerprint keys changed")
  allowed={Path(name).name:[old,new] for name,(_,old,new) in LAYOUT.items() if Path(name).name in fp}
  require({k:[before[k],fp[k]] for k in fp if before[k]!=fp[k]}==allowed,"Not the reviewed first-only native version transition")
 else:
  require(mode=="continue-shared" and r["schema"]=="nba-shared-native-continuation-v1" and r["forecast_version"]==VERSION and r["files"]==inv and r["model_source_hashes"]==fp and m["model_source_hashes"]==fp,"Future native requires exact prior shared checkpoint; never rebase legacy")
  # Separate binding made only by sole Work after validated canonical promotion.
  promotion=read(pin(c["predecessor_promotion_receipt"]))
  require(promotion["canonical_verified"] is True and promotion["asof"]==day and promotion["shared_native_continuation_sha256"]==c["predecessor_receipt"]["sha256"],"Predecessor shared state was not verified as published")
 out.mkdir()
 for name in inv:
  src=batch/name;dest=out/("ownership_manifest.json" if name=="manifest.json" else Path(name).name)
  if mode=="continue-shared":
   shutil.copy2(src,dest);require(digest(src)==digest(dest),"Shared predecessor changed")
  else:
   old=read(src);write(dest,{**old,"model_source_hashes":fp})
   require({k:v for k,v in read(dest).items() if k!="model_source_hashes"}=={k:v for k,v in old.items() if k!="model_source_hashes"},"Legacy state payload changed")
 write(out/"transition_receipt.json",{"asof":c["asof"],"previous_asof":day,"mode":mode,"predecessor_receipt_sha256":c["predecessor_receipt"]["sha256"],"source_files":inv,"derived_files":{p.name:digest(p) for p in sorted(out.iterdir())},"production":False})
 return day

def run_native(c,out,files,scope,ledger,service):
 prepared=Path(c["legacy_prepared"]).resolve(strict=True); staged=out/"native_prepared"; roll=Path(c["native_patch_root"]).resolve(strict=True)
 prep=read(files["prepared_receipt"])
 install_native(prepared,roll,c["native_patch_pins"],staged,prep)
 repo=staged/"repo";rt=staged/"runtime"; code=repo/"script/asset_history/backfill"
 for rel in ("script/asset_history/backfill/live_runtime.py","script/asset_history/backfill/run_owner_replay.py","script/asset_history/backfill/calibration_cache.py"):
  require(digest(repo/rel)==prep["prepared_files_sha256"][f"repo/{rel}"],"Unknown native executable source")
 sys.path[:0]=[str(code),str(code.parent)]
 from live_runtime import fingerprint
 from calibration_cache import source_signature
 from run_owner_replay import observation_dates
 fp=fingerprint(rt)
 if c["mode"]=="first-cutover":
  control=read(files["native_receipt"])["prior_checkpoint"]
  predecessor=read(pin(c["predecessor_receipt"]))
  require(predecessor["asof"]==control["asof"] and predecessor["checkpoint_sha256"]==control["sha256"],"Initial native seed not the legacy control's actual predecessor")
 day=make_seed(c,out/"seed",fp); d=c["asof"]
 require([a for a in observation_dates(rt) if day<a<=d]==[d],"Post-legacy phase would replay other dates")
 old=read(files["calibration"]); new_sig=source_signature(rt,rt/"monthly_reconstruction/skill");old_sig=old["input_sha256"];seam="monthly_reconstruction/projections/integrate_monthly.py"
 _,before,after=LAYOUT["runtime/"+seam]
 require(old_sig.keys()==new_sig.keys() and {k:[old_sig[k],new_sig[k]] for k in old_sig if old_sig[k]!=new_sig[k]}=={seam:[before,after]},"Other calibration source inputs differ")
 cache=out/"shared_fixed_calibration.json";write(cache,{**old,"input_sha256":new_sig})
 cfg=out/"native_config.json";write(cfg,{"asof":d,"ledger":str(ledger),"ledger_sha256":digest(ledger),"forecast_version":VERSION,"scope":"all-eligible-current-endpoints","cutover_booking":"separate-method-rebase","eligible":{pid:{k:v[k] for k in ("team","team_game_clock")} for pid,v in native_scope(scope).items()}})
 env={**os.environ,"NBA_SHARED_NATIVE_CONFIG":str(cfg),"NBA_SHARED_NATIVE_CONFIG_SHA256":digest(cfg),"OPENBLAS_NUM_THREADS":"1","OMP_NUM_THREADS":"1","PYTHONDONTWRITEBYTECODE":"1"}
 final=out/"native_replay"
 workers=c.get("native_workers",4);require(type(workers) is int and 1<=workers<=8,"Bad native worker count")
 script(code/"run_owner_replay.py","--canonical",rt,"--repo",repo,"--output",final,"--initial-state",out/"seed","--injuries",files["injuries"],"--calibration-cache",cache,"--through",d,"--max-dates",1,"--workers",workers,env=env)
 return final/"batches"/d,{"config_sha256":digest(cfg),"original_calibration_sha256":digest(files["calibration"]),"derived_calibration_binding_sha256":digest(cache),"injuries_sha256":digest(files["injuries"]),"private_seed_transition_sha256":digest(out/"seed/transition_receipt.json")}

def verify_roster(receipt,roster,d,y,mode):
 r=read(receipt)
 schema="nba-shared-unallocated-roster-shadow-v1"
 if mode=="verify-retained":
  require(r["schema"] in {schema,"nba-reconstructed-early-role-roster-shadow-v1"},"Unexpected retained roster derivation")
 else:
  require(r["schema"]==schema and r["season"]==y and r["legacy_current_impact_read"] is False and r["production"] is False,"New dates must use preallocation capture")
 require(r["asof"]==d and r["availability_already_applied"] is False and r["rotation_already_applied"] is False and r["roster"]["sha256"]==digest(roster),"Roster binding has prior allocation or wrong date")
 return r

def run_ledger(c,out,files,n,b):
 d,y=c["asof"],c["season"]; r=Path(c["rollout_root"]).resolve(strict=True); cp=c["rollout_code"]
 for rel,ref in cp.items():source(r,ref,rel)
 required={"producer/prepare_shared_roster.py","producer/prepare_shared_role_candidates.R","rookie/build_comparable_mpg.py","assemble_horizon_receipt.py","verify_draft_service_coverage.py","daily/build_next_date_ledger.py","daily/daily_gate.py","core/candidate/build_shared_roles.py","core/candidate/shared_minutes.py","core/candidate/shared_minutes_horizon.py","core/candidate/shared_minutes_service.py","core/candidate/allocate_shared_roles.R"}
 require(set(cp)==required,"Unsealed roster/ledger producer tree")
 ownership=pin(c["ownership_receipt"]); early=Path(c["preallocation_repo"]).resolve(strict=True);capture=out/"capture"
 require(read(files["prepared_receipt"])["ownership_receipt_sha256"]==digest(ownership) and read(files["prepared_receipt"])["collector_receipt_sha256"]==digest(files["collector"]),"Collector/ownership different from legacy preparations")
 require(early!=Path(c["legacy_prepared"]).resolve()/"repo","Capture checkout must be isolated from frozen legacy/native source")
 require(digest(early/"script/frontend/export_frontend_data.R")==c["patched_early_capture_exporter_sha256"],"Unreviewed early capture exporter bytes")
 # The exact producer expects ownership path equality. Authorize relocation only
 # within this isolated capture; retain and rehash original ownership evidence.
 owner_original=read(ownership); clone_book=early/"processed/contracts/current.json"
 require(owner_original["signed_book"]["sha256"]==digest(clone_book)==digest(files["signed_book"]),"Isolated capture changed the legal book")
 owner_view=out/"capture_ownership_relocated.json"
 write(owner_view,{**owner_original,"signed_book":bind(clone_book)})
 write(out/"capture_ownership_relocation_proof.json",{"asof":d,"original":bind(ownership),"isolated_capture_view":bind(owner_view),"unchanged_signed_book_sha256":digest(clone_book),"production":False})
 script(r/"producer/prepare_shared_roster.py","--repo",early,"--out",capture,"--source-r",files["source_r"],"--source-r-sha",digest(files["source_r"]),"--collector",files["collector"],"--collector-sha",digest(files["collector"]),"--ownership",owner_view,"--ownership-sha",digest(owner_view),"--asof",d,"--season",y)
 roster=capture/"role-roster.json"; rr=capture/"receipt.json"; verify_roster(rr,roster,d,y,c["mode"])
 scope=derive_scope(c,files,n,b,roster); sp=out/"appraisal_scope.json";write(sp,scope)
 sr=out/"appraisal_scope_receipt.json";write(sr,{"asof":d,"scope_sha256":digest(sp),"roster_sha256":digest(roster),"native_receipt_sha256":digest(files["native_receipt"]),"signed_book_sha256":digest(files["signed_book"]),"production":False})
 hist=Path(c["history_root"]).resolve(strict=True); outcomes=pin(c["outcomes"]); audit=pin(c["outcome_audit"])
 require(read(audit)["history_sha256"]==c["history_sha256"],"Outcome audit lacks exact completed history")
 mpg=out/"comparable_mpg.json";last=max([y+4]+[year for p in scope["players"].values() for year in p["appraisal_seasons"]])
 script(r/"rookie/build_comparable_mpg.py","--core",r/"core/candidate","--history",hist,"--roster",roster,"--bref",c["bref_root"],"--outcome-path",outcomes,"--audit-path",audit,"--out",mpg,"--outcome-sha",digest(outcomes),"--audit-sha",digest(audit),"--roster-sha",digest(roster),"--roster-kind","preallocation","--roster-receipt",rr,"--roster-receipt-sha",digest(rr),"--asof",d,"--season",y,"--last-service-year",last)
 cfg=out/"ledger_config.json"; write(cfg,{"asof":d,"season":y,"roster":bind(roster),"scope":bind(sp),"mpg":bind(mpg),"outcomes":bind(outcomes),"schedule":bind(files["schedule"]),"outlook":bind(files["outlook"]),"collector_receipt":bind(files["collector"]),"appraisal_scope_receipt":bind(sr),"history_root":str(hist),"history_sha256":c["history_sha256"],"r_workspace":c["r_workspace"],"r_workspace_source_sha256":c["r_workspace_source_sha256"],"rscript":c["rscript"]})
 lr=out/"ledger"
 script(r/"daily/build_next_date_ledger.py",cfg,digest(cfg),lr)
 return roster,rr,sp,scope,lr/"resolved.csv",lr/"service.json",lr/"receipt.json"

def verify_retained(c,files,n,b):
 d,y=c["asof"],c["season"]
 refs={k:pin(c[k]) for k in ("roster","roster_receipt","retained_scope","ledger","service","ledger_receipt","retained_native_receipt")}
 roster,rr,sp,ledger,service,lr,nr=(refs[k] for k in ("roster","roster_receipt","retained_scope","ledger","service","ledger_receipt","retained_native_receipt"))
 verify_roster(rr,roster,d,y,"verify-retained");scope=derive_scope(c,files,n,b,roster)
 previously=read(sp)
 for pid,expected in scope["players"].items():
  require(all(expected[k]==previously["players"][pid][k] for k in ("team","team_game_clock","appraisal_seasons","asset_type")),"Retained appraisal scope not equivalent")
 require(previously["players"].keys()==scope["players"].keys(),"Wrong retained scope coverage")
 l=read(lr); raw=read(nr); batch=Path(c["retained_native_batch"]).resolve(strict=True)
 require(l["asof"]==raw["asof"]==d and l["season"]==y and l["outputs"]["resolved.csv"]==raw["ledger_sha256"]==digest(ledger) and l["outputs"]["service.json"]==raw["service_sha256"]==digest(service),"Retained native/ledger mismatch")
 for key,actual in (("roster",roster),("roster_receipt",rr),("scope",sp),("outlook",files["outlook"]),("schedule",files["schedule"]),("collector_receipt",files["collector"])):
  require(l["inputs"][key]["sha256"]==digest(actual),"Wrong repackaged source: "+key)
 require(raw["native_manifest_sha256"]==digest(batch/"manifest.json") and raw["original_prepared_receipt_sha256"]==digest(files["prepared_receipt"]) and raw["original_canonical_native_receipt_sha256"]==digest(files["native_receipt"]),"Wrong retained native batch lineage")
 return roster,rr,sp,scope,ledger,service,lr,batch,raw

def main(c,out):
 require(c["schema"]=="nba-shared-post-legacy-config-v1","Unexpected post-legacy configuration schema")
 d=c["asof"];mode=c["mode"]
 require(mode in {"first-cutover","continue-shared","verify-retained"},"Unknown phase")
 files,n,b=admitted(c)
 docket(out,d)
 if mode=="verify-retained":
  roster,rr,sp,scope,ledger,service,lr,batch,raw=verify_retained(c,files,n,b)
  native_meta={k:v for k,v in raw.items() if k in ("config_sha256","original_calibration_sha256","derived_calibration_binding_sha256","injuries_sha256","private_seed_transition_sha256")}
 else:
  roster,rr,sp,scope,ledger,service,lr=run_ledger(c,out,files,n,b)
  batch,native_meta=None,None
 count,teamgames,servicecells=validate_ledger(ledger,service,scope)
 if batch is None: batch,native_meta=run_native(c,out,files,scope,ledger,service)
 inv,endpoint_cells=verify_native(batch,scope)
 require(endpoint_cells==servicecells,"Native service count differs from resolved appraisal support")
 cp=out/"shared_native_continuation.json"; states={k:v for k,v in inv.items() if k=="manifest.json" or k.startswith("states/")}
 write(cp,{"schema":"nba-shared-native-continuation-v1","asof":d,"forecast_version":VERSION,"ledger_sha256":digest(ledger),"files":states,"model_source_hashes":read(batch/"manifest.json")["model_source_hashes"],"production":False})
 nr=out/"shared_native_candidate_receipt.json"
 write(nr,{"schema":"nba-shared-native-candidate-v1","asof":d,"forecast_version":VERSION,"ledger_sha256":digest(ledger),"service_sha256":digest(service),"scope_sha256":digest(sp),"players":len(native_scope(scope)),"teams":len(TEAMS),"endpoint_annual_cells":endpoint_cells,"native_manifest_sha256":inv["manifest.json"],"continuation_sha256":digest(cp),"output_sha256":{k:v for k,v in inv.items() if k.startswith("output/")},"production":False,"archive_publication":False,"original_canonical_native_receipt_sha256":digest(files["native_receipt"]),"original_prepared_receipt_sha256":digest(files["prepared_receipt"]),**native_meta})
 result={"schema":"nba-shared-post-legacy-stage-v1","asof":d,"mode":mode,"forecast_version":VERSION,"roster_members":count,"regulation_team_games":teamgames,"native_batch_path":str(batch),"legacy_assembly":bind(files["legacy_assembly"]),"roster_receipt":bind(rr),"roster":bind(roster),"scope":bind(sp),"resolved_ledger":bind(ledger),"service":bind(service),"ledger_receipt":bind(lr),"native_receipt":bind(nr),"continuation":bind(cp),"production":False,"release_ready":False}
 write(out/"receipt.json",result);return result

if __name__=="__main__":
 p=argparse.ArgumentParser(description=__doc__);p.add_argument("config",type=Path);p.add_argument("sha256");p.add_argument("output",type=Path);a=p.parse_args()
 print(json.dumps(main(read(pin({"path":a.config,"sha256":a.sha256})),a.output.resolve()),indent=2))
