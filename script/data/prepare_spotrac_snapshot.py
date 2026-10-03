"""Stage a fresh, hash-verified Spotrac snapshot when the runner is blocked."""
import csv
from datetime import datetime, timezone
import hashlib
import json
import lzma
from pathlib import Path
import sys

expected = set("ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split())
snapshot_path, output_path = map(Path, sys.argv[1:3])
if not snapshot_path.exists():
    print("No supplied Spotrac snapshot; use the normal live scrape.")
    sys.exit(0)
snapshot = json.loads(lzma.decompress(snapshot_path.read_bytes()))
rows = snapshot["teams"]
assert snapshot.get("schema_version") == 1
assert len(rows) == 30 and {row["team"] for row in rows} == expected
now = datetime.now(timezone.utc)
ages = [(now - datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))).total_seconds() for row in rows]
if any(age < -60 or age > 1800 for age in ages):
    print("Supplied Spotrac snapshot is stale; require a new live scrape.")
    sys.exit(0)
output_path.mkdir(parents=True, exist_ok=True)
for row in rows:
    html = row["html"].encode()
    assert hashlib.sha256(html).hexdigest() == row["sha256"], row["team"]
    assert row["source_url"].startswith("https://www.spotrac.com/nba/")
    assert b"Active Roster" in html and b"</html>" in html[-4096:] and len(html) > 100000, row["team"]
    (output_path / (row["team"] + ".html")).write_bytes(html)
with (output_path / "receipts.csv").open("w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["team", "source_url", "fetched_at", "sha256"])
    writer.writeheader()
    writer.writerows({key: row[key] for key in writer.fieldnames} for row in rows)
print("Verified fresh Spotrac snapshot for all 30 teams.")
