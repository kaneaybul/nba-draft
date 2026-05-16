import csv
import re
from collections import defaultdict
from pathlib import Path

BASE = Path("processed/livedata/impactrefresh/duncd_on_cap")
OCR_WORDS = BASE / "ocr" / "ocr_words.csv"
OUT = BASE / "ocr_grid_cells.csv"

TEAM_RE = re.compile(r"^([A-Z]{3})_(top|mid|summary|draft_visible|top_left)\.png$")

COLUMNS = [
    ("row_label", 0, 160),
    ("age", 160, 198),
    ("pos", 198, 230),
    ("rank", 230, 268),
    ("contract_notes", 268, 405),
    ("2025_26", 405, 475),
    ("2026_27", 475, 545),
    ("2026_27_holds", 545, 618),
    ("2026_27_likely", 618, 690),
    ("2027_28", 690, 762),
    ("2027_28_holds", 762, 835),
    ("2027_28_likely", 835, 905),
    ("2028_29", 905, 976),
    ("2029_30", 976, 1048),
    ("2030_31", 1048, 1125),
    ("right_notes", 1125, 1405),
]


def norm_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def section_from_y(y: float) -> str:
    if y < 330:
        return "header"
    if y < 610:
        return "main_or_middle"
    return "lower"


with OCR_WORDS.open(newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

grouped = defaultdict(list)
for row in rows:
    match = TEAM_RE.match(row["file"])
    if not match:
        continue
    team, capture = match.groups()
    try:
        x = float(row["x"])
        y = float(row["y"])
    except ValueError:
        continue
    if y < 185:
        continue
    # Bucket nearby OCR lines into spreadsheet-ish rows. The screenshots use
    # small text, so a 9px bucket keeps most cell rows together without
    # overfitting to a single zoom level.
    row_bucket = round(y / 9) * 9
    grouped[(team, capture, row_bucket)].append((x, row["word"]))

out_rows = []
for (team, capture, row_bucket), words in sorted(grouped.items()):
    cells = {name: [] for name, _, _ in COLUMNS}
    for x, word in sorted(words):
        for name, left, right in COLUMNS:
            if left <= x < right:
                cells[name].append(word)
                break
    joined = {name: norm_space(" ".join(parts)) for name, parts in cells.items()}
    combined = norm_space(" ".join(joined[name] for name, _, _ in COLUMNS if joined[name]))
    if not combined:
        continue
    out_rows.append({
        "team": team,
        "capture": capture,
        "row_bucket": row_bucket,
        "section": section_from_y(row_bucket),
        **joined,
        "raw_text": combined,
    })

fieldnames = ["team", "capture", "row_bucket", "section"] + [c[0] for c in COLUMNS] + ["raw_text"]
with OUT.open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(out_rows)

print(f"Wrote {len(out_rows)} OCR grid rows to {OUT}")
