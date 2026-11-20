"""Create dated mature-player quotes or bridge a pair of independently priced assemblies."""
import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from shared_minutes_accounting import bridge, impact_per_game, read_ledger, VERSION


def bind(runtime):
    sys.path.insert(0,str(runtime.resolve()/"monthly_reconstruction/projections"))
    from expected_contracts import ExpectedContracts
    from shared_mature_quote import MatureQuote
    return ExpectedContracts,MatureQuote


def price(basis, classes):
    market,quote = classes
    model = market({})
    model.cache = {int(k):v for k,v in basis["contracts"].items()}
    return quote(basis["annual"],model,basis["reporting_cap"])


def old_terms_on_new_basis(opening, closing):
    old = {row["season"]:row for row in opening["annual"]}
    terms = ("app_effective_contract","is_unsigned_market_year","waiver_option_verified",
             "waiver_guaranteed_amount_asof")
    rows = []
    for row in closing["annual"]:
        prior = old.get(row["season"])
        if prior is None:
            # Only matched seasons can enter this counterfactual.
            continue
        rows.append({**row, **{field:prior[field] for field in terms}})
    return {**closing, "annual":rows}


def snapshot(ledger, batch, runtime, asof, released_quotes=None):
    classes = bind(runtime)
    forecasts = read_ledger(ledger)
    output = {"asof":asof,"version":VERSION,"players":{},"draft_window":[]}
    published = None
    if released_quotes is not None:
        published = json.loads(released_quotes.read_text())
        if published.get("observation_date")!=asof:
            raise ValueError("Released quote packet has the wrong observation date")
    for folder in sorted(batch.iterdir()):
        if not (folder/"monthly_quote_carry_states.csv").is_file():
            continue
        curves = json.loads((folder/"asof_expected_contract_curves.json").read_text())
        with (folder/"monthly_player_values.csv").open() as stream:
            people = {row["player_name"]:row for row in csv.DictReader(stream) if row["cutoff_date"]==asof}
        groups = {}
        with (folder/"monthly_quote_carry_states.csv").open() as stream:
            for row in csv.DictReader(stream):
                if row["cutoff_date"]==asof and row["active_asset"]=="True" and row["asset_type"] in ("roster_contract","two_way"):
                    groups.setdefault(row["player_name"],[]).append(row)
        for name,rows in groups.items():
            source = people[name]
            pid = int(float(source["source_nba_id"] or source["ledger_nba_id"]))
            if any(float(r["exposure"])>0 and r["in_original_draft_window"]=="True" for r in rows):
                output["draft_window"].append(pid)
                continue
            f = forecasts[pid]
            knots = json.loads(source["impact_path_knots_json"])
            if (f.clock!=float(source["impact_team_game_clock"]) or f.asof.isoformat()!=asof
                    or f.version!=VERSION or f.team!=folder.name or pid in output["players"]):
                raise ValueError(f"Inconsistent dated owner or clock for {pid}")
            fields = ("season","in_original_draft_window","scale_budget_scenario","salary_cap_scenario",
                      "replacement","league_timin","is_unsigned_market_year","forecast_yos",
                      "league_reference_year","app_effective_contract","waiver_option_verified",
                      "waiver_guaranteed_amount_asof")
            basis = dict(knots=knots,annual=[{k:r[k] for k in fields} for r in rows],
                         contracts=curves,reporting_cap=164961000.,team=f.team,
                         coordinate_offset=float(source["impact_coordinate_offset"]),
                         coordinate_lineage=source["impact_coordinate_lineage"])
            basis["quote"] = price(basis,classes)(f.clock,f.window(f.clock)[-1],impact_per_game(knots,f.clock))
            if published is not None:
                original = published["players"][str(pid)]
                if original["date"]!=asof:
                    raise ValueError("Mixed quote packet observation dates")
                basis["same_date_prior_method"] = dict(method=published["method"],value=original["value"],
                                                        revision=basis["quote"]-original["value"])
            output["players"][pid] = basis
    if not output["players"]:
        raise ValueError("No dated player quotes")
    return output


def price_changes(old_dir, new_dir, runtime):
    classes=bind(runtime)
    old,new=[json.loads((p/"mature_quotes.json").read_text()) for p in (old_dir,new_dir)]
    if old["version"]!=new["version"]:
        raise ValueError("A valuation-method migration requires a same-date opening restatement")
    a,b=[read_ledger(p/"resolved.csv") for p in (old_dir,new_dir)]
    result={"opening_date":old["asof"],"closing_date":new["asof"],"players":{},"transfers":[]}
    for key in sorted(old["players"].keys() & new["players"].keys()):
        pid=int(key)
        left,right=old["players"][key],new["players"][key]
        if left["coordinate_lineage"]!=right["coordinate_lineage"]:
            raise ValueError("Native ownership lineage mismatch")
        shift=right["coordinate_offset"]-left["coordinate_offset"]
        if str(a[pid].asof)!=old["asof"] or str(b[pid].asof)!=new["asof"]:
            raise ValueError("Ledger and price dates differ")
        opening_price=price(left,classes)
        parts=bridge(a[pid],b[pid],left["knots"],right["knots"],
                     opening_price,price(right,classes),opening_mark=left["quote"],
                     closing_mark=right["quote"],coordinate_shift=shift,
                     closing_price_old_contract=price(old_terms_on_new_basis(left,right),classes))
        before=a[pid].clock
        after=b[pid].clock-int(shift)
        def opening_parts(clock):
            return opening_price.parts(clock,a[pid].window(clock)[-1],
                                       impact_per_game(left["knots"],clock))
        initial,carried=opening_parts(before),opening_parts(after)
        aging=carried["production_quote"]-initial["production_quote"]
        parts["contract_window_mix"]=parts.pop("expected_aging_and_window")-aging
        parts["expected_aging"]=aging
        if a[pid].team!=b[pid].team:
            result["transfers"].append(dict(player=pid,from_team=a[pid].team,to_team=b[pid].team,
                                            outgoing=-carried["quote"],incoming=carried["quote"]))
        result["players"][key]=parts
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    modes=p.add_subparsers(dest="action",required=True)
    build=modes.add_parser("snapshot")
    for key in ("ledger","batch","runtime"):
        build.add_argument(key,type=Path)
    build.add_argument("asof")
    build.add_argument("--released-quotes",type=Path)
    compare=modes.add_parser("bridge")
    for key in ("opening","closing","runtime"):
        compare.add_argument(key,type=Path)
    for cmd in (build,compare):
        cmd.add_argument("output",type=Path)
    a=p.parse_args()
    result=(snapshot(a.ledger,a.batch,a.runtime,a.asof,a.released_quotes) if a.action=="snapshot"
            else price_changes(a.opening,a.closing,a.runtime))
    with a.output.open("x") as stream:
        json.dump(result,stream,allow_nan=False,separators=(",",":"))
