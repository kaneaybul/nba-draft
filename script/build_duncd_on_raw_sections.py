import csv
import re
from pathlib import Path

BASE = Path("processed/livedata/impactrefresh/duncd_on_cap")
GRID = BASE / "ocr_grid_cells.csv"

CONTRACT_OUT = BASE / "raw_contract_rows.csv"
SUMMARY_OUT = BASE / "raw_summary_rows.csv"
PICKS_DEAD_OUT = BASE / "raw_picks_dead_rows.csv"
HEADER_OUT = BASE / "raw_header_exception_rows.csv"

SUMMARY_LABELS = (
    "Roster Charges",
    "Standard-Contract Players",
    "Team Salary",
    "Salary Cap",
    "Cap Room",
    "Tax Level",
    "Tax Bands",
    "Tax Room",
    "Tax Room (14 Players)",
    "Tax Payment",
    "Team Salary Plus Tax",
    "Repeater Tax Payment",
    "First Apron Level",
    "First Apron Room",
    "Second Apron Level",
    "Second Apron Room",
    "Salary Floor",
    "Below Salary Floor",
    "MLE Up to Hard Cap",
    "Bi-Annual Up to Hard Cap",
    "Taxpayer MLE Up to Hard Cap",
    "Room Exception Up to Hard Cap",
    "Unused MLE",
    "Unused Bi-Annual",
    "Unused Taxpayer MLE",
    "Unused Room Exception",
)

SECTION_MARKERS = ("Draft Picks", "Dead Salary")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def likely_summary(label: str, raw: str) -> bool:
    text = f"{label} {raw}".lower()
    return any(key.lower() in text for key in SUMMARY_LABELS)


def likely_contract(row: dict) -> bool:
    if row["capture"] != "top":
        return False
    if not (330 <= float(row["row_bucket"]) <= 620):
        return False
    label = clean(row["row_label"])
    if not label:
        return False
    bad = ("Name", "Age", "Pos", "Rank", "Hard Cap", "Cap Room", "Tax")
    return not any(label.startswith(x) for x in bad)


def likely_picks_dead(row: dict) -> bool:
    if row["capture"] not in ("mid", "draft_visible"):
        return False
    text = clean(row["raw_text"])
    return bool(text) and (
        any(marker.lower() in text.lower() for marker in SECTION_MARKERS)
        or 330 <= float(row["row_bucket"]) <= 620
    )


with GRID.open(newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

contract_rows = []
summary_rows = []
picks_dead_rows = []
header_rows = []

for row in rows:
    row = {k: clean(v) for k, v in row.items()}
    if likely_contract(row):
        contract_rows.append(row)
    if row["capture"] == "summary" and likely_summary(row["row_label"], row["raw_text"]):
        summary_rows.append(row)
    if likely_picks_dead(row):
        picks_dead_rows.append(row)
    if row["capture"] == "top" and float(row["row_bucket"]) < 330 and clean(row["raw_text"]):
        header_rows.append(row)

fieldnames = rows[0].keys()
for path, out_rows in (
    (CONTRACT_OUT, contract_rows),
    (SUMMARY_OUT, summary_rows),
    (PICKS_DEAD_OUT, picks_dead_rows),
    (HEADER_OUT, header_rows),
):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)
    print(f"Wrote {len(out_rows)} rows to {path}")
