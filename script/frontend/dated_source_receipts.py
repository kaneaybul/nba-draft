"""Capture proof of already existing Work source stages; never collect or deploy."""
import hashlib
import json
from datetime import date
from pathlib import Path


def bind(path, asof=None):
    path = Path(path).resolve(strict=True)
    row = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    return row if asof is None else {**row, "asof": asof}


def make_ownership_receipt(output, ledger, source_audit, signed_book, asof, season, native_terms=None, ownership_events=None, recent_contract_terms=None):
    if str(date.fromisoformat(asof)) != asof or type(season) is not int:
        raise ValueError("Invalid ownership receipt date or season")
    book = json.loads(Path(signed_book).read_bytes())
    audit = json.loads(Path(source_audit).read_bytes())
    snapshots = json.loads(Path(ledger).read_bytes())
    if (book.get("complete") is not True or book.get("as_of") != asof or
            book.get("season") != season or audit.get("knowledge_date") != asof):
        raise ValueError("Existing ownership and terms were not safely resolved for the requested date")
    if sum(row.get("cutoff_date") == asof for row in snapshots) != 1:
        raise ValueError("Need one dated signed ownership snapshot")
    packet = {"schema": "nba-existing-dated-ownership-binding-v1", "asof": asof, "season": season,
              "ledger": bind(ledger), "source_audit": bind(source_audit), "signed_book": bind(signed_book)}
    if native_terms is not None:
        packet["native_terms"]={name:bind(path) for name,path in native_terms.items()}
    if ownership_events is not None:
        packet["ownership_events"]=bind(ownership_events)
    if recent_contract_terms is not None:
        packet["recent_contract_terms"]={**bind(recent_contract_terms),"reviewed":True}
    write_new(output, packet)


def make_r_receipt(output, demographics, schedule, asof, season):
    if str(date.fromisoformat(asof)) != asof or type(season) is not int:
        raise ValueError("Invalid source R receipt date or season")
    rows = json.loads(Path(demographics).read_bytes())
    games = json.loads(Path(schedule).read_bytes())
    if not rows or not games or any(row.get("year") != season for row in rows) or any(row.get("season") != season for row in games):
        raise ValueError("R source season mismatch")
    if any(row.get("is_completed") is True and row["date"] > asof for row in games):
        raise ValueError("R source calendar has future completed games")
    packet = {"schema": "nba-source-r-demographics-calendar-v1", "asof": asof, "season": season,
              "demographics": bind(demographics, asof), "schedule": bind(schedule, asof)}
    write_new(output, packet)


def write_new(output, packet):
    with Path(output).open("x") as stream:
        json.dump(packet, stream, indent=2, allow_nan=False)
        stream.write("\n")

