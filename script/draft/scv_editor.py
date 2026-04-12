import csv
import io
import os
import re
import sys
import tkinter as tk
import unicodedata
from tkinter import messagebox, ttk
from typing import Dict, List, Optional


_NAME_ALIAS_CACHE: Optional[Dict[str, str]] = None


def anglicize_text(value: str) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch)).strip()


def collapse_initial_tokens(tokens: List[str]) -> List[str]:
    out: List[str] = []
    buffer: List[str] = []

    def flush_buffer() -> None:
        nonlocal buffer
        if not buffer:
            return
        out.append("".join(buffer) if len(buffer) > 1 else buffer[0])
        buffer = []

    for token in tokens:
        if re.fullmatch(r"[a-z]", token):
            buffer.append(token)
        else:
            flush_buffer()
            out.append(token)
    flush_buffer()
    return out


def normalize_join_name_core(value: str) -> str:
    text = anglicize_text(value).replace("?", "z").lower().replace("&", " and ")
    text = re.sub(r"['`\u2018\u2019\u00b4]", "", text)
    text = text.replace(".", "")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    tokens = collapse_initial_tokens([token for token in text.split() if token])
    while len(tokens) > 1 and tokens[-1] in {"jr", "sr", "ii", "iii", "iv", "v"}:
        tokens.pop()
    return " ".join(tokens)


def load_name_aliases() -> Dict[str, str]:
    global _NAME_ALIAS_CACHE
    if _NAME_ALIAS_CACHE is not None:
        return _NAME_ALIAS_CACHE

    aliases: Dict[str, str] = {}
    try:
        base_dir = find_base_dir()
    except Exception:
        _NAME_ALIAS_CACHE = aliases
        return aliases

    alias_path = os.path.join(base_dir, "ref", "player_name_aliases.csv")
    if os.path.exists(alias_path):
        with open(alias_path, "r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                alias = normalize_join_name_core(row.get("alias", ""))
                canonical = normalize_join_name_core(row.get("canonical", ""))
                if alias and canonical:
                    aliases[alias] = canonical

    _NAME_ALIAS_CACHE = aliases
    return aliases


def normalize_join_name(value: str) -> str:
    key = normalize_join_name_core(value)
    return load_name_aliases().get(key, key)


def find_base_dir() -> str:
    candidates = [
        os.getcwd(),
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ]
    env_base = os.environ.get("CLEANNBA_BASE_DIR", "").strip()
    if env_base:
        candidates.append(env_base)

    for candidate in candidates:
        candidate = os.path.abspath(candidate)
        if (
            os.path.isdir(os.path.join(candidate, "script"))
            and os.path.isdir(os.path.join(candidate, "processed"))
            and os.path.isdir(os.path.join(candidate, "ref"))
        ):
            return candidate
    raise RuntimeError(f"Could not resolve project root from working directory: {os.getcwd()}")


def safe_int(value: str) -> Optional[int]:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def safe_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class ScvEditorApp:
    def __init__(self, root: tk.Tk, base_dir: str) -> None:
        self.root = root
        self.base_dir = base_dir
        self.base_scv_path = os.path.join(base_dir, "ref", "scvardraft.csv")
        self.override_path = os.path.join(base_dir, "ref", "scvardraft_overrides.csv")
        self.prediction_names_path = os.path.join(base_dir, "ref", "draftprednames.csv")
        self.draftballr_path = os.path.join(base_dir, "processed", "draft", "draftballr.csv")
        self.no_college_cohort_path = os.path.join(base_dir, "processed", "draft", "draft_no_college_all_classes.csv")
        self.no_college_stats_path = os.path.join(base_dir, "processed", "draft", "no_college_realgm_stats.csv")
        self.databallr_path = os.path.join(base_dir, "raw", "databallr_stats.csv")

        self.scope_var = tk.StringVar(value="current")
        self.pool_var = tk.StringVar(value="all")
        self.search_var = tk.StringVar(value="")
        self.only_with_values_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value=f"Loaded SCV editor from {base_dir}")

        self.edit_scv_var = tk.StringVar(value="")
        self.edit_notes_var = tk.StringVar(value="")

        self.all_rows: List[Dict[str, object]] = []
        self.filtered_rows: List[Dict[str, object]] = []
        self.current_year: Optional[int] = None
        self.sort_column = "current_class"
        self.sort_reverse = True
        self.selected_join_player: Optional[str] = None

        self._build_ui()
        self.reload_data()

    def _build_ui(self) -> None:
        self.root.title("Draft SCV Editor")
        self.root.geometry("1450x820")

        main = ttk.Frame(self.root, padding=10)
        main.pack(fill="both", expand=True)

        left = ttk.Frame(main)
        left.pack(side="left", fill="y", padx=(0, 10))

        right = ttk.Frame(main)
        right.pack(side="left", fill="both", expand=True)

        ttk.Label(left, text="View", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        for label, value in [
            ("Current class", "current"),
            ("All players", "all"),
            ("Overrides only", "overrides"),
            ("Current class missing SCV", "missing_current"),
            ("All missing SCV", "missing_all"),
        ]:
            ttk.Radiobutton(left, text=label, value=value, variable=self.scope_var, command=self.refresh_table).pack(anchor="w")

        ttk.Label(left, text="Pool").pack(anchor="w", pady=(10, 0))
        pool_box = ttk.Combobox(
            left,
            textvariable=self.pool_var,
            state="readonly",
            values=["all", "domestic", "international", "no_college", "unknown"],
        )
        pool_box.pack(fill="x")
        pool_box.bind("<<ComboboxSelected>>", lambda _event: self.refresh_table())

        ttk.Label(left, text="Name search").pack(anchor="w", pady=(10, 0))
        search_entry = ttk.Entry(left, textvariable=self.search_var)
        search_entry.pack(fill="x")
        search_entry.bind("<KeyRelease>", lambda _event: self.refresh_table())

        ttk.Checkbutton(
            left,
            text="Only rows with a current SCV",
            variable=self.only_with_values_var,
            command=self.refresh_table,
        ).pack(anchor="w", pady=(10, 0))

        ttk.Separator(left, orient="horizontal").pack(fill="x", pady=12)
        ttk.Label(left, text="Selected Player", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.selected_info = tk.Text(left, width=35, height=10, wrap="word")
        self.selected_info.pack(fill="x")
        self.selected_info.configure(state="disabled")

        ttk.Label(left, text="SCV value").pack(anchor="w", pady=(10, 0))
        ttk.Entry(left, textvariable=self.edit_scv_var).pack(fill="x")

        ttk.Label(left, text="Notes").pack(anchor="w", pady=(10, 0))
        ttk.Entry(left, textvariable=self.edit_notes_var).pack(fill="x")

        button_row = ttk.Frame(left)
        button_row.pack(fill="x", pady=(10, 0))
        ttk.Button(button_row, text="Save Change", command=self.save_override).pack(side="left", fill="x", expand=True, padx=(0, 4))
        ttk.Button(button_row, text="Clear Override", command=self.clear_override).pack(side="left", fill="x", expand=True, padx=(4, 0))

        ttk.Button(left, text="Reload From Disk", command=self.reload_data).pack(fill="x", pady=(10, 0))

        ttk.Label(
            left,
            text="This editor writes to ref/scvardraft_overrides.csv.\nTraining and output flows already read that file.",
            justify="left",
        ).pack(anchor="w", pady=(12, 0))

        self.summary_label = ttk.Label(right, text="")
        self.summary_label.pack(anchor="w", pady=(0, 8))

        table_frame = ttk.Frame(right)
        table_frame.pack(fill="both", expand=True)

        columns = [
            "player",
            "current_scv",
            "source",
            "base_scv",
            "override_scv",
            "draft_year",
            "pool",
            "big_board",
            "current_class",
        ]
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", selectmode="browse")
        headers = {
            "player": "Player",
            "current_scv": "Current SCV",
            "source": "Source",
            "base_scv": "Base SCV",
            "override_scv": "Override SCV",
            "draft_year": "Draft Year",
            "pool": "Pool",
            "big_board": "Big Board",
            "current_class": "Current Class",
        }
        widths = {
            "player": 260,
            "current_scv": 90,
            "source": 80,
            "base_scv": 90,
            "override_scv": 95,
            "draft_year": 80,
            "pool": 95,
            "big_board": 90,
            "current_class": 95,
        }
        for col in columns:
            self.tree.heading(col, text=headers[col], command=lambda c=col: self.sort_by(c))
            self.tree.column(col, width=widths[col], anchor="center")
        self.tree.column("player", anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        tree_scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        tree_scroll.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=tree_scroll.set)

        ttk.Label(right, text="Saved Overrides", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(10, 4))
        self.override_preview = tk.Text(right, height=8, wrap="none")
        self.override_preview.pack(fill="x")
        self.override_preview.configure(state="disabled")

        ttk.Label(right, textvariable=self.status_var, wraplength=900).pack(anchor="w", pady=(10, 0))

    def load_csv_rows(self, path: str) -> List[Dict[str, str]]:
        if not os.path.exists(path):
            return []
        with open(path, "rb") as handle:
            raw = handle.read()

        text = self.decode_csv_bytes(raw)
        return list(csv.DictReader(io.StringIO(text)))

    @staticmethod
    def decode_csv_bytes(raw: bytes) -> str:
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            pass

        utf8_text = raw.decode("utf-8-sig", errors="replace")
        cp1252_text = raw.decode("cp1252", errors="replace")

        def badness(text: str) -> int:
            replacement_count = text.count("\ufffd")
            mojibake_count = sum(text.count(marker) for marker in ("Ã", "Â", "Ä", "Å", "â"))
            control_count = sum(1 for ch in text if ord(ch) < 32 and ch not in "\r\n\t")
            return replacement_count * 10 + mojibake_count * 3 + control_count

        return utf8_text if badness(utf8_text) <= badness(cp1252_text) else cp1252_text

    def load_scv_lookup(self, path: str) -> Dict[str, Dict[str, object]]:
        rows = self.load_csv_rows(path)
        data: Dict[str, Dict[str, object]] = {}
        for row in rows:
            name = row.get("name", "")
            join = normalize_join_name(name)
            if not join:
                continue
            score = None
            for key in ("sc", "SC", "scv", "SCV", "shot_creation", "shot_creation_rank"):
                if key in row and str(row.get(key, "")).strip() != "":
                    score = safe_float(row.get(key, ""))
                    break
            notes = row.get("notes", "") or ""
            data[join] = {
                "player_name": name,
                "scv": score,
                "notes": notes,
            }
        return data

    def load_prediction_name_filter(self) -> Dict[str, Dict[str, object]]:
        rows = self.load_csv_rows(self.prediction_names_path)
        data: Dict[str, Dict[str, object]] = {}
        for row in rows:
            name = row.get("name") or row.get("player") or row.get("player_name") or ""
            join = normalize_join_name(name)
            if not join:
                continue
            year = safe_int(row.get("year", "") or row.get("draft_year", ""))
            existing = data.get(join)
            candidate = {
                "player_name": name,
                "draft_year": year,
            }
            if existing is None:
                data[join] = candidate
            else:
                prev_year = existing.get("draft_year")
                if prev_year is None or (year is not None and year > prev_year):
                    data[join] = candidate
        return data

    def load_draft_context(self) -> Dict[str, Dict[str, object]]:
        rows = self.load_csv_rows(self.draftballr_path)
        data: Dict[str, Dict[str, object]] = {}
        years: List[int] = []
        for row in rows:
            player = row.get("player", "")
            join = normalize_join_name(player)
            year = safe_int(row.get("year", ""))
            if not join or year is None:
                continue
            years.append(year)
            pool = "international" if not (row.get("cbbd_id", "") or "").strip() else "domestic"
            big_board = safe_float(row.get("big_board_rank", ""))
            existing = data.get(join)
            candidate = {
                "draft_player": player,
                "latest_draft_year": year,
                "prediction_pool": pool,
                "big_board_rank": big_board,
            }
            if existing is None:
                data[join] = candidate
            else:
                prev_year = existing.get("latest_draft_year")
                prev_board = existing.get("big_board_rank")
                if year > prev_year or (year == prev_year and self.compare_board(big_board, prev_board) < 0):
                    data[join] = candidate
        self.current_year = max(years) if years else None
        for item in data.values():
            item["is_current_class"] = self.current_year is not None and item["latest_draft_year"] == self.current_year
        return data

    def load_no_college_context(self) -> Dict[str, Dict[str, object]]:
        cohort_rows = self.load_csv_rows(self.no_college_cohort_path)
        stats_rows = self.load_csv_rows(self.no_college_stats_path)
        data: Dict[str, Dict[str, object]] = {}

        for row in cohort_rows:
            player = row.get("player", "")
            join = normalize_join_name(player)
            draft_year = safe_int(row.get("draft_year", ""))
            if not join or draft_year is None:
                continue
            existing = data.get(join)
            candidate = {
                "draft_player": player,
                "latest_draft_year": draft_year,
                "prediction_pool": "no_college",
                "big_board_rank": safe_float(row.get("pick_overall", "")),
                "pre_draft_team": row.get("pre_draft_team", "") or row.get("team", ""),
                "realgm_profile_url": row.get("realgm_profile_url", "") or "",
            }
            if existing is None:
                data[join] = candidate
            else:
                prev_year = existing.get("latest_draft_year")
                prev_board = existing.get("big_board_rank")
                if draft_year > prev_year or (draft_year == prev_year and self.compare_board(candidate["big_board_rank"], prev_board) < 0):
                    data[join] = candidate

        for row in stats_rows:
            player = row.get("player", "")
            join = normalize_join_name(player)
            draft_year = safe_int(row.get("draft_year", ""))
            if not join or draft_year is None:
                continue
            existing = data.get(join, {})
            candidate = {
                "draft_player": player,
                "latest_draft_year": draft_year,
                "prediction_pool": "no_college",
                "big_board_rank": existing.get("big_board_rank"),
                "pre_draft_team": row.get("pre_draft_team", "") or existing.get("pre_draft_team", ""),
                "realgm_profile_url": row.get("realgm_profile_url", "") or existing.get("realgm_profile_url", ""),
            }
            if not existing:
                data[join] = candidate
            else:
                if existing.get("latest_draft_year") is None and draft_year is not None:
                    existing["latest_draft_year"] = draft_year
                if not existing.get("pre_draft_team") and candidate["pre_draft_team"]:
                    existing["pre_draft_team"] = candidate["pre_draft_team"]
                if not existing.get("realgm_profile_url") and candidate["realgm_profile_url"]:
                    existing["realgm_profile_url"] = candidate["realgm_profile_url"]
                data[join] = existing

        return data

    def load_databallr_context(self) -> Dict[str, Dict[str, object]]:
        rows = self.load_csv_rows(self.databallr_path)
        data: Dict[str, Dict[str, object]] = {}

        for row in rows:
            player = row.get("player_name") or row.get("Name") or row.get("ShortName") or ""
            join = normalize_join_name(player)
            draft_year = safe_int(row.get("draft_year", ""))
            if not join or draft_year is None:
                continue

            overall_pick = safe_float(row.get("overall_pick", ""))
            source_year = safe_int(row.get("year", ""))
            existing = data.get(join)
            candidate = {
                "draft_player": player,
                "latest_draft_year": draft_year,
                "prediction_pool": "databallr",
                "big_board_rank": overall_pick,
                "pre_draft_team": "",
                "realgm_profile_url": "",
                "source_year": source_year,
            }
            if existing is None:
                data[join] = candidate
            else:
                prev_source_year = existing.get("source_year") or -1
                if source_year is not None and source_year > prev_source_year:
                    data[join] = candidate

        return data

    @staticmethod
    def compare_board(left: Optional[float], right: Optional[float]) -> int:
        left_val = left if left is not None else float("inf")
        right_val = right if right is not None else float("inf")
        if left_val < right_val:
            return -1
        if left_val > right_val:
            return 1
        return 0

    def build_rows(self) -> List[Dict[str, object]]:
        base_lookup = self.load_scv_lookup(self.base_scv_path)
        override_lookup = self.load_scv_lookup(self.override_path)
        prediction_name_filter = self.load_prediction_name_filter()
        draft_lookup = self.load_draft_context()
        no_college_lookup = self.load_no_college_context()
        databallr_lookup = self.load_databallr_context()

        if prediction_name_filter:
            all_years = [
                ctx.get("draft_year")
                for ctx in prediction_name_filter.values()
                if ctx.get("draft_year") is not None
            ]
        else:
            all_years = [
                ctx.get("latest_draft_year")
                for ctx in list(draft_lookup.values()) + list(no_college_lookup.values()) + list(databallr_lookup.values())
                if ctx.get("latest_draft_year") is not None
            ]
        self.current_year = max(all_years) if all_years else None

        if prediction_name_filter:
            keys = sorted(prediction_name_filter.keys())
        else:
            keys = sorted(
                set(base_lookup.keys()) |
                set(override_lookup.keys()) |
                set(draft_lookup.keys()) |
                set(no_college_lookup.keys()) |
                set(databallr_lookup.keys())
            )
        rows: List[Dict[str, object]] = []
        for join in keys:
            filter_row = prediction_name_filter.get(join, {})
            base = base_lookup.get(join, {})
            override = override_lookup.get(join, {})
            draft = draft_lookup.get(join, {})
            no_college = no_college_lookup.get(join, {})
            databallr = databallr_lookup.get(join, {})
            context = draft if draft else (no_college if no_college else databallr)
            base_scv = base.get("scv")
            override_scv = override.get("scv")
            current_scv = override_scv if override_scv is not None else base_scv
            source = "override" if override_scv is not None else ("base" if base_scv is not None else "missing")
            latest_draft_year = filter_row.get("draft_year") if filter_row else context.get("latest_draft_year")
            rows.append(
                {
                    "join_player": join,
                    "player_name": filter_row.get("player_name") or override.get("player_name") or context.get("draft_player") or base.get("player_name") or join,
                    "current_scv": current_scv,
                    "source": source,
                    "base_scv": base_scv,
                    "override_scv": override_scv,
                    "latest_draft_year": latest_draft_year,
                    "prediction_pool": context.get("prediction_pool") or "unknown",
                    "big_board_rank": context.get("big_board_rank"),
                    "pre_draft_team": context.get("pre_draft_team") or "",
                    "realgm_profile_url": context.get("realgm_profile_url") or "",
                    "is_current_class": self.current_year is not None and latest_draft_year == self.current_year,
                    "has_current_scv": current_scv is not None,
                    "override_notes": override.get("notes", ""),
                }
            )
        return rows

    def reload_data(self) -> None:
        self.all_rows = self.build_rows()
        self.refresh_table()
        self.status_var.set(f"Reloaded from disk at {self.timestamp()}")

    def apply_filters(self) -> List[Dict[str, object]]:
        rows = list(self.all_rows)
        scope = self.scope_var.get()
        pool = self.pool_var.get()
        search = self.search_var.get().strip().lower()
        only_with_values = self.only_with_values_var.get()

        if scope == "current":
            rows = [row for row in rows if row["is_current_class"]]
        elif scope == "overrides":
            rows = [row for row in rows if row["source"] == "override"]
        elif scope == "missing_current":
            rows = [row for row in rows if row["is_current_class"] and not row["has_current_scv"]]
        elif scope == "missing_all":
            rows = [row for row in rows if not row["has_current_scv"]]

        if pool != "all":
            rows = [row for row in rows if row["prediction_pool"] == pool]

        if only_with_values:
            rows = [row for row in rows if row["has_current_scv"]]

        if search:
            rows = [row for row in rows if search in str(row["player_name"]).lower()]

        return rows

    @staticmethod
    def row_key_for_column(column: str) -> str:
        return {
            "player": "player_name",
            "draft_year": "latest_draft_year",
            "pool": "prediction_pool",
            "big_board": "big_board_rank",
            "current_class": "is_current_class",
        }.get(column, column)

    def sort_key(self, row: Dict[str, object], column: str):
        row_key = self.row_key_for_column(column)
        value = row.get(row_key)
        if row_key in {"current_scv", "base_scv", "override_scv", "big_board_rank"}:
            return float("inf") if value is None else float(value)
        if row_key == "latest_draft_year":
            return -1 if value is None else int(value)
        if row_key == "is_current_class":
            return 1 if value else 0
        return str(value or "").lower()

    def sort_missing_key(self, row: Dict[str, object], column: str) -> bool:
        row_key = self.row_key_for_column(column)
        value = row.get(row_key)
        return value is None or value == ""

    def sort_by(self, column: str) -> None:
        if self.sort_column == column:
            self.sort_reverse = not self.sort_reverse
        else:
            self.sort_column = column
            self.sort_reverse = column in {"current_class", "draft_year"}
        self.refresh_table()

    def refresh_table(self) -> None:
        rows = self.apply_filters()
        rows.sort(key=lambda row: self.sort_key(row, self.sort_column), reverse=self.sort_reverse)
        rows.sort(key=lambda row: self.sort_missing_key(row, self.sort_column))
        self.filtered_rows = rows

        for item in self.tree.get_children():
            self.tree.delete(item)

        for idx, row in enumerate(rows):
            self.tree.insert(
                "",
                "end",
                iid=str(idx),
                values=(
                    row["player_name"],
                    "" if row["current_scv"] is None else self.format_number(row["current_scv"]),
                    row["source"],
                    "" if row["base_scv"] is None else self.format_number(row["base_scv"]),
                    "" if row["override_scv"] is None else self.format_number(row["override_scv"]),
                    "" if row["latest_draft_year"] is None else row["latest_draft_year"],
                    row["prediction_pool"],
                    "" if row["big_board_rank"] is None else self.format_number(row["big_board_rank"]),
                    "yes" if row["is_current_class"] else "",
                ),
            )

        missing_count = sum(1 for row in rows if not row["has_current_scv"])
        current_text = f" Current draft class: {self.current_year}." if self.current_year is not None else ""
        self.summary_label.config(text=f"Showing {len(rows)} row(s). {missing_count} without a current SCV.{current_text}")
        self.refresh_override_preview()
        self.restore_selection()

    def restore_selection(self) -> None:
        if self.selected_join_player is None:
            self.show_selected_info(None)
            return
        for idx, row in enumerate(self.filtered_rows):
            if row["join_player"] == self.selected_join_player:
                iid = str(idx)
                self.tree.selection_set(iid)
                self.tree.focus(iid)
                self.tree.see(iid)
                self.show_selected_info(row)
                return
        self.show_selected_info(None)

    def on_select(self, _event=None) -> None:
        selection = self.tree.selection()
        if not selection:
            self.selected_join_player = None
            self.show_selected_info(None)
            return
        row = self.filtered_rows[int(selection[0])]
        self.selected_join_player = row["join_player"]
        self.show_selected_info(row)

    def show_selected_info(self, row: Optional[Dict[str, object]]) -> None:
        if row is None:
            text = "Select a row in the table to edit it."
            self.edit_scv_var.set("")
            self.edit_notes_var.set("")
        else:
            text = "\n".join(
                [
                    str(row["player_name"]),
                    f"Current: {self.render_value(row['current_scv'])}",
                    f"Base: {self.render_value(row['base_scv'])}",
                    f"Override: {self.render_value(row['override_scv'], none_value='none')}",
                    f"Source: {row['source']}",
                    f"Draft year: {self.render_value(row['latest_draft_year'], none_value='n/a')}",
                    f"Pool: {row['prediction_pool']}",
                    f"Pre-draft team: {self.render_value(row['pre_draft_team'], none_value='n/a')}",
                ]
            )
            self.edit_scv_var.set("" if row["current_scv"] is None else self.format_number(row["current_scv"]))
            self.edit_notes_var.set(str(row["override_notes"] or ""))

        self.selected_info.configure(state="normal")
        self.selected_info.delete("1.0", tk.END)
        self.selected_info.insert("1.0", text)
        self.selected_info.configure(state="disabled")

    def refresh_override_preview(self) -> None:
        overrides = [row for row in self.all_rows if row["override_scv"] is not None]
        lines = ["player | override_scv | notes"]
        for row in sorted(overrides, key=lambda item: str(item["player_name"]).lower()):
            lines.append(
                f"{row['player_name']} | {self.format_number(row['override_scv'])} | {row['override_notes'] or ''}"
            )
        if len(lines) == 1:
            lines.append("No overrides saved yet.")

        self.override_preview.configure(state="normal")
        self.override_preview.delete("1.0", tk.END)
        self.override_preview.insert("1.0", "\n".join(lines))
        self.override_preview.configure(state="disabled")

    def save_override(self) -> None:
        row = self.get_selected_row()
        if row is None:
            messagebox.showinfo("SCV Editor", "Select a player before saving a change.")
            return

        try:
            new_scv = float(self.edit_scv_var.get().strip())
        except ValueError:
            messagebox.showerror("SCV Editor", "SCV must be numeric.")
            return

        notes = self.edit_notes_var.get().strip()
        for item in self.all_rows:
            if item["join_player"] == row["join_player"]:
                base_value = item["base_scv"]
                if base_value is not None and float(base_value) == new_scv and not notes:
                    item["override_scv"] = None
                    item["override_notes"] = ""
                    self.status_var.set(f"Removed override for {item['player_name']} because it matches the base value.")
                else:
                    item["override_scv"] = new_scv
                    item["override_notes"] = notes
                    self.status_var.set(f"Saved SCV {self.format_number(new_scv)} for {item['player_name']}.")
                break

        self.write_overrides()
        self.reload_data()

    def clear_override(self) -> None:
        row = self.get_selected_row()
        if row is None:
            messagebox.showinfo("SCV Editor", "Select a player before clearing an override.")
            return

        for item in self.all_rows:
            if item["join_player"] == row["join_player"]:
                item["override_scv"] = None
                item["override_notes"] = ""
                self.status_var.set(f"Cleared override for {item['player_name']}.")
                break

        self.write_overrides()
        self.reload_data()

    def get_selected_row(self) -> Optional[Dict[str, object]]:
        selection = self.tree.selection()
        if not selection:
            return None
        return self.filtered_rows[int(selection[0])]

    def write_overrides(self) -> None:
        rows = [row for row in self.all_rows if row["override_scv"] is not None]
        rows.sort(key=lambda item: str(item["player_name"]).lower())
        os.makedirs(os.path.dirname(self.override_path), exist_ok=True)
        with open(self.override_path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["name", "sc", "notes"])
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {
                        "name": row["player_name"],
                        "sc": self.format_number(row["override_scv"]),
                        "notes": row["override_notes"] or "",
                    }
                )

    @staticmethod
    def format_number(value: Optional[float]) -> str:
        if value is None:
            return ""
        text = f"{value:.4f}"
        return text.rstrip("0").rstrip(".")

    @staticmethod
    def render_value(value: Optional[object], none_value: str = "missing") -> str:
        if value is None or value == "":
            return none_value
        return str(value)

    @staticmethod
    def timestamp() -> str:
        import datetime

        return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def main() -> int:
    try:
        base_dir = find_base_dir()
        if "--check" in sys.argv:
            app = object.__new__(ScvEditorApp)
            app.base_dir = base_dir
            app.base_scv_path = os.path.join(base_dir, "ref", "scvardraft.csv")
            app.override_path = os.path.join(base_dir, "ref", "scvardraft_overrides.csv")
            app.prediction_names_path = os.path.join(base_dir, "ref", "draftprednames.csv")
            app.draftballr_path = os.path.join(base_dir, "processed", "draft", "draftballr.csv")
            app.no_college_cohort_path = os.path.join(base_dir, "processed", "draft", "draft_no_college_all_classes.csv")
            app.no_college_stats_path = os.path.join(base_dir, "processed", "draft", "no_college_realgm_stats.csv")
            app.databallr_path = os.path.join(base_dir, "raw", "databallr_stats.csv")
            app.current_year = None
            rows = ScvEditorApp.build_rows(app)
            current_class = sum(1 for row in rows if row["is_current_class"])
            with_scv = sum(1 for row in rows if row["has_current_scv"])
            overrides = sum(1 for row in rows if row["override_scv"] is not None)
            print(
                f"rows={len(rows)}; current_year={app.current_year}; current_class={current_class}; "
                f"with_scv={with_scv}; overrides={overrides}"
            )
            target_names = {"ben saraf", "bilal coulibaly"}
            for row in rows:
                if row["join_player"] in target_names:
                    print(
                        f"{row['player_name']} | draft_year={row['latest_draft_year']} | "
                        f"pool={row['prediction_pool']} | pre_draft_team={row['pre_draft_team']}"
                    )
            return 0
    except Exception as exc:
        print(f"SCV Editor failed: {exc}", file=sys.stderr)
        return 1

    root = tk.Tk()
    app = ScvEditorApp(root, base_dir)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
