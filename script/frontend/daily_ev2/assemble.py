"""Non-publishing candidate assembly after authenticated dated Work collection."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
from pending_contracts import priced_roster,memberships

TEAMS=set("ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_bytes())
def write(p,x):
    with Path(p).open("x") as f: json.dump(x,f,sort_keys=True,indent=2);f.write("\n")

def command(base, argv, log, env=None):
    with log.open("x") as f:
        subprocess.run([str(a) for a in argv],cwd=base,env={**os.environ,**(env or {}),"PYTHONDONTWRITEBYTECODE":"1"},
                       stdout=f,stderr=subprocess.STDOUT,timeout=1200,check=True)

def require(condition,message):
    if not condition:raise ValueError(message)

def paths(config, names):
    return [Path(config[k]).resolve(strict=True) for k in names]

def assemble(config, work, execute=False, launch=command, skip_regression=False, contract_pending_ui_review_proof=None):
    """Construct a complete isolated frontend candidate. Does not package or publish."""
    repo,runtime,adapters,prior,grades,calibrator,quote_map,ownership,collection,policy,base_index,cal_seed,prior_injury,base_injury=paths(config,
        ("repo","native_seed","adapters","prior","grades","released_calibrator","quote_mapper",
         "ownership_receipt","collector_receipt","history_policy","base_index","calibration_seed_inventory","prior_injuries","base_injuries"))
    work=Path(work).resolve()
    # Choose a sibling inside one isolated workspace: native pick builder requires both.
    require(repo.parent==work.parent and repo!=work and not work.exists(),"New sibling Work staging directory required")
    require(sha(policy)==config["history_policy_sha256"],"Reviewed active history policy differs")
    require(sha(base_index)==config["base_index_sha256"],"Canonical current asset index differs")
    asof,season=config["asof"],config["season"]
    accepted=read(collection)
    require(accepted.get("source_checks_pass") is True and accepted.get("asof")==asof and accepted.get("season")==season
            and accepted.get("provider_commands_run")==8 and accepted.get("protected_bytes_unchanged") is True,
            "Run the authenticated existing Work collectors and certify the exact requested date first")
    signed=repo/"processed/contracts/current.json"; history=repo/"frontend/public/data/asset_history/v20/manifest.json"
    selector=repo/"frontend/public/data/asset_history_release.json"
    h=read(policy)
    for f in (history,selector):
        rel=str(f.relative_to(repo/"frontend/public"))
        require(sha(f)==h["protected_files"][rel],"Pinned historical input mismatch: "+rel)
    require(read(selector).get("asset_history_version")=="v20","Independent corrected history selector missing")
    require(read(ownership).get("signed_book",{}).get("sha256")==sha(signed),"Signed book differs from ownership receipt")
    for k in ("prior_checkpoint_sha256","grade_checkpoint_sha256","calibrator_sha256","quote_mapper_sha256"):
        require(isinstance(config.get(k),str) and len(config[k])==64,"Missing reviewed "+k)
    require(sha(grades)==config["grade_checkpoint_sha256"] and sha(calibrator)==config["calibrator_sha256"]
            and sha(quote_map)==config["quote_mapper_sha256"],"Reviewed grading/pricing dependency changed")
    for k,p in (("calibration_seed_inventory",cal_seed),("prior_injuries",prior_injury),("base_injuries",base_injury)):
        require(sha(p)==config[k+"_sha256"],"Reviewed fixed calibration/injury dependency changed: "+k)
    require(config.get("calibration_reviewed") is True,"Unreviewed calibration continuation; no native computation")
    names=("source_r","native_prepare","calibration","native_replay","player_quotes","r_export","picks","asset_index","frontend_checks")
    if not execute:
        return dict(asof=asof,season=season,stages=names,executed=False,production=False)
    work.mkdir()
    completed=[]
    def step(name, filename, args):
        launch(repo,[sys.executable,filename,*args],work/(name+".log"))
        completed.append(name)
        write(work/(name+".done.json"),dict(asof=asof, completed=completed))
    frontend=repo/"script/frontend"
    source_r=work/"source_r";prepared=work/"prepared";cal=work/"calibration";native=work/"native";quotes=work/"quotes";r=work/"r"
    step("source_r",frontend/"prepare_role_sources.py",["--repo",repo,"--output",source_r,"--asof",asof,"--season",season])
    official_args=[]
    if config.get("official_injury_receipt"):
        official_receipt=Path(config["official_injury_receipt"]).resolve(strict=True)
        require(sha(official_receipt)==config["official_injury_receipt_sha256"],"Official game evidence changed")
        official_args=["--official-injury-receipt",official_receipt]
    dependency_args=[]
    if config.get("prior_dependencies_sha256"):
        dependency_path=Path(config.get("prior_dependencies",prior/"continuation_inputs.json")).resolve(strict=True)
        require(sha(dependency_path)==config["prior_dependencies_sha256"],"Prior observation dependencies changed")
        dependency_args=["--prior-dependencies",dependency_path,"--prior-dependencies-sha256",config["prior_dependencies_sha256"],"--prior-checkpoint",prior,"--prior-checkpoint-sha256",config["prior_checkpoint_sha256"]]
    step("native_prepare",adapters/"fresh_native_inputs/adapter.py",[
       "--native",runtime,"--source",repo,"--demographics",source_r/"demographics.json","--schedule",source_r/"schedule.json",
       "--ownership-receipt",ownership,"--collector-receipt",collection,"--r-receipt",source_r/"receipt.json","--asof",asof,"--season",season,"--work",prepared,*official_args,*dependency_args])
    prep=prepared/"source_preparation_receipt.json"
    step("calibration",adapters/"calibration/prepare_calibration.py",[
        "--repo",prepared/"repo","--runtime",prepared/"runtime","--prepared-receipt",prep,
        "--prepared-receipt-sha256",sha(prep),"--seed-inventory",cal_seed,
        "--seed-inventory-sha256",config["calibration_seed_inventory_sha256"],"--prior-episodes",prior_injury,
        "--prior-episodes-sha256",config["prior_injuries_sha256"],"--base-injuries",base_injury,
        "--base-injuries-sha256",config["base_injuries_sha256"],"--asof",asof,"--out",cal,"--reviewed"])
    cal_receipt=cal/"calibration_receipt.json"
    absence_args=[]
    if config.get("prior_absence_ratings"):
        require(not config.get("prior_dependencies_sha256"),"Choose full exact dependencies or explicit absence bootstrap, not both")
        absence_path=Path(config["prior_absence_ratings"]).resolve(strict=True)
        require(asof=="2026-11-19" and sha(absence_path)=="521024e8bda946176b0308c7a103d340afb2b2d8eddd9b265d8fdd822dd95ffe","Unapproved prior absence evidence")
        absence_args=["--prior-absence-ratings",absence_path]
    step("native_replay",adapters/"native_invoker/invoke_current_native.py",[
        "--prepared-root",prepared,"--prepared-receipt",prep,"--prepared-receipt-sha256",sha(prep),
        "--prior-checkpoint",prior,"--prior-checkpoint-sha256",config["prior_checkpoint_sha256"],
        "--grades",grades,"--grade-checkpoint-sha256",config["grade_checkpoint_sha256"],
        "--calibration",cal/"calibration.json","--calibration-receipt",cal_receipt,"--calibration-receipt-sha256",sha(cal_receipt),
        "--injuries",cal/"injuries/combined_injury_episodes.json","--signed-book",signed,"--signed-book-sha256",sha(signed),
        "--asof",asof,"--output",native,*absence_args])
    native_report=native/"native_replay_receipt.json"
    step("player_quotes",adapters/"player_quotes/generate.py",[
        "--lane","fresh","--asof",asof,"--repo",prepared/"repo","--runtime",prepared/"runtime",
        "--batch",native/"replay/batches"/asof,"--calibrator",calibrator,"--quote-mapper",quote_map,
        "--grades",grades,"--signed-book",signed,"--binding",native_report,"--prepared-receipt",prep,"--out",quotes])
    players=quotes/"current_players.json";qreceipt=quotes/"receipt.json"
    step("r_export",frontend/"run_current_r_export.py",[
       "--repo",repo,"--work",r,"--native-receipt",native_report,"--role-file",quotes/"healthy_role_inputs.json",
       "--role-proof",quotes/"healthy_role_inputs.proof.json","--source-r-receipt",source_r/"receipt.json","--player-quote-receipt",qreceipt])
    # Derive ownership map from independently certified R output, not the current player valuation index.
    rows=read(repo/f"frontend/public/data/v2/impact_players/{season}.json")
    roster=priced_roster(rows,read(signed),asof)
    by_id={str(row.get("source_nba_id") or row["nba_id"]):row["team"] for row in roster}
    require(len(by_id)==len(roster) and set(by_id.values())==TEAMS,"Incomplete or duplicate R roster")
    write(work/"r_roster.json",by_id)
    picks=work/"picks.json"
    step("picks",adapters/"pick_seam/generate.py",[
        "--stage",work.parent,"--repo",repo,"--runtime",prepared/"runtime","--asof",asof,"--output",picks])
    # Final local join goes to separate output first, preserving the good base packet on failure.
    index=work/"asset_valuation.json"
    args=[base_index,players,picks,repo/"processed/asset_history/picks/trained_pick_model.json",
          picks.with_suffix(".proof.json"),qreceipt,asof,work/"r_roster.json",history,
          repo/"script/asset_history/backfill/reviewed_trade_packages.json",r/"receipt.json",index]
    launch(repo,[sys.executable,"-c","import attach,sys; attach.attach_files(*sys.argv[1:])",*args],
           work/"asset_index.log",{"PYTHONPATH":str(adapters/"pick_seam")})
    completed.append("asset_index")
    # Check the finished index still points to independently reviewed dated paths.
    idx=read(index);base=read(base_index)
    _,pending=memberships(read(signed),asof)
    require(not(set(map(str,pending))&set(idx["players"])),"Contract-pending participant leaked into asset totals")
    require(idx["seasons"]==base["seasons"] and idx["asset_history_version"]=="v20"
            and idx["current_observation_date"]==asof and idx["pick_observation_date"]==asof,"Mixed release lanes")
    # Only the isolated checkout is written; stage proof beside it, never inside dist.
    public=repo/"frontend/public"
    target=public/"data/asset_valuation.json"
    require(target.is_file() and sha(target)==config["base_index_sha256"],"Unexpected staged current index before swap")
    shutil.copy2(index,target)
    verification_env={"NBA_CURRENT_PLAYER_PACKET_FILE":str(players),"NBA_CURRENT_PLAYER_RECEIPT_FILE":str(qreceipt),
                      "VITE_PUBLIC_READ_ONLY":"true","FRONTEND_MAX_STATIC_ASSET_BYTES":"26214400",
                      "FRONTEND_MAX_INITIAL_PAYLOAD_BYTES":"8388608","TZ":"UTC"}
    checks=(
        (repo,["Rscript","script/frontend/test_live_ratings.R","--require-export"]),
        (repo,["Rscript","script/frontend/test_player_pool.R","--require-export"]),
        (repo,["Rscript","script/frontend/test_live_minutes.R","--require-export"]),
        (repo,["Rscript","script/frontend/test_lineup_positions.R"]),
        (repo,["Rscript","script/frontend/test_injury_projections.R","--require-export"]),
        (repo,["node","script/frontend/build_cap_tracker_spotrac_data.mjs"]),
        (repo,["node","script/frontend/build_static_data_manifest.mjs"]),
        (repo,["node","script/frontend/test_shared_contracts.mjs","--require-export"]),
        (repo,["node","script/frontend/test_asset_surface_consistency.mjs"]),
        (repo,[sys.executable,"script/frontend/test_pinned_asset_history.py","--repo",str(repo),"--policy",str(policy)]),
        (repo,["node","script/frontend/test_data_refresh.mjs"]),
        (repo,["node","script/frontend/validate_preseason_archive.mjs"]),
        *((repo/"frontend",["npm","run",name]) for name in
          ("validate:data","validate:schedule","test:asset-value","test:cap-tracker","test:trade-machine","test:trade-suggestions","build")))
    if skip_regression:
        checks=tuple((cwd,argv) for cwd,argv in checks if (
            argv[-1]=="build" or any("build_" in str(x) for x in argv)))
    # Always retain the small targeted pending-contract test, even in fast mode.
    checks=((repo,[sys.executable,"script/frontend/daily_ev2/test_pending_contracts.py"]),(repo,[sys.executable,"script/frontend/test_pending_r_validation.py"]),*checks)
    for i,(cwd,argv) in enumerate(checks,1):
        launch(cwd,argv,work/f"frontend-{i:02d}.log",verification_env)
    # Routine refresh keeps the reviewed UI. The one-off pending UI transition
    # must supply a separately reviewed, hash-bound, identical-two-build proof.
    dist=repo/"frontend/dist"
    restore_policy=policy;restore_sha=config["history_policy_sha256"];protected=h["protected_files"];ui_proof=None
    if contract_pending_ui_review_proof is not None:
        ui_path=Path(contract_pending_ui_review_proof).resolve(strict=True)
        require(sha(ui_path)==config.get("contract_pending_ui_review_proof_sha256"),"Unreviewed contract-pending UI proof")
        ui_proof=read(ui_path)
        require(ui_proof.get("build_command")==["npm","run","build"],"Unexpected reviewed UI build command")
        sys.path.insert(0,str(frontend))
        from history_release_guard import _verify_ui_policy
        proposed={**h,"protected_files":{**protected,**ui_proof["first_build"]}}
        _verify_ui_policy(dist,h,proposed,ui_proof)
        # Rehydrate every old protected file except the explicitly reviewed new index.
        protected={k:v for k,v in protected.items()if k!="index.html"}
        restore_policy=work/"old_protected_without_index.json"
        write(restore_policy,{**h,"protected_files":protected});restore_sha=sha(restore_policy)
        write(work/"proposed_ui_policy.json",proposed)
    launch(repo,[sys.executable,frontend/"rehydrate_protected_static.py","--dist",dist,
                 "--policy",restore_policy,"--policy-sha256",restore_sha,"--tracked-public",public],
         work/"rehydrate_protected_static.log",verification_env)
    require(sha(dist/"data/asset_valuation.json")==sha(index),"Built current asset index differs from validated index")
    for rel, digest in protected.items():
        require(sha(dist/rel)==digest,"Built release changed pinned history/UI: "+rel)
    if ui_proof is not None:
        _verify_ui_policy(dist,h,proposed,ui_proof)
    completed.append("frontend_checks")
    # Export an explicit archive-ready continuation, not merely a transient batch.
    # Publication remains external; consumers must verify this manifest against
    # the successful release receipt before accepting its dependency digest.
    native_binding=read(native_report)
    dependency=native_binding["continuation_inputs"]
    dependency_file=Path(dependency["path"])
    require(sha(dependency_file)==dependency["sha256"],"Continuation inputs changed")
    continuation=work/"continuation"/asof
    batch=native/"replay/batches"/asof
    shutil.copytree(batch/"states",continuation/"states")
    shutil.copy2(batch/"manifest.json",continuation/"manifest.json")
    shutil.copy2(dependency_file,continuation/"continuation_inputs.json")
    shutil.copy2(native_report,continuation/"native_replay_receipt.json")
    continuation_files={str(p.relative_to(continuation)):sha(p) for p in continuation.rglob("*") if p.is_file()}
    continuation_manifest=continuation/"continuation_manifest.json"
    write(continuation_manifest,{"schema":"nba-archive-ready-continuation-v1","asof":asof,"checkpoint_sha256":dependency["checkpoint_sha256"],"files":continuation_files,"production":False})
    report=dict(schema="nba-e-v2-current-assembly-v1",asof=asof,season=season,completed=completed,
                candidate_index_sha256=sha(index),signed_book_sha256=sha(signed),r_receipt_sha256=sha(r/"receipt.json"),
                continuation={"path":str(continuation),"manifest_sha256":sha(continuation_manifest),"checkpoint_sha256":dependency["checkpoint_sha256"],"dependencies_sha256":dependency["sha256"]},
                native_receipt_sha256=sha(native_report),player_receipt_sha256=sha(qreceipt),
                pick_receipt_sha256=sha(picks.with_suffix(".proof.json")),production=False,release_ready=False,regression_checks_skipped=skip_regression,contract_pending_ui_transition=ui_proof is not None)
    write(work/"assembly_receipt.json",report)
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--config",type=Path,required=True)
    p.add_argument("--work",type=Path,required=True)
    p.add_argument("--execute",action="store_true")
    p.add_argument("--skip-regression",action="store_true")
    p.add_argument("--contract-pending-ui-review-proof",type=Path)
    a=p.parse_args()
    print(json.dumps(assemble(read(a.config),a.work,a.execute,skip_regression=a.skip_regression,contract_pending_ui_review_proof=a.contract_pending_ui_review_proof)))

