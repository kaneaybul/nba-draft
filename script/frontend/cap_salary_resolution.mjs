import fs from "node:fs";
import path from "node:path";
import { parseCsv, readCsvFile, normalizeName } from "./cap_transaction_rules.mjs";

export const SALARY_RESOLUTION_COLUMNS = [
  "transaction_key",
  "transaction_date",
  "nba_id",
  "player_name",
  "team_from",
  "team_to",
  "classification",
  "raw_text",
  "salary_resolution_status",
  "salary_source",
  "salary_source_url",
  "suggested_amount",
  "approved_amount",
  "source_quality",
  "resolution_note",
  "conflict_note",
  "recommended_action",
  "affected_files",
  "status",
  "applied_at",
  "applied_key",
  "applied_amount",
  "last_error",
  "source_url",
  "reference_url"
];

const WAIVE_TYPES = new Set(["waive_release"]);
const CLAIM_TYPES = new Set(["waiver_claim"]);
const CONTRACT_TYPES = new Set(["signing", "ten_day_signing", "rest_of_season_signing", "two_way_signing", "two_way_conversion", "extension", "option_decision", "trade"]);

export function loadSalarySources({ spotracDir, contractsPath, brefContractsPath, deadMoneyPath }) {
  return {
    spotrac: loadSpotracSources(spotracDir),
    contracts: [...readCsvFile(contractsPath), ...readCsvFile(brefContractsPath)].map(normalizeContractSourceRow),
    deadMoney: readCsvFile(deadMoneyPath)
  };
}

export function resolveSalaryRows(reviewRows, sources) {
  const spotracById = new Map();
  const spotracByName = new Map();
  for (const row of sources.spotrac) {
    if (row.nba_id) spotracById.set(row.nba_id, row);
    const nameKey = normalizeName(row.player_name);
    if (nameKey) spotracByName.set(nameKey, row);
  }

  const contractsById = new Map();
  const contractsByName = new Map();
  for (const row of sources.contracts) {
    if (row.nba_id) contractsById.set(row.nba_id, row);
    const nameKey = normalizeName(row.player_name);
    if (nameKey) contractsByName.set(nameKey, row);
  }

  const existingDead = new Set(
    sources.deadMoney.map((row) => deadKey(row.team, row.year, row.player_name))
  );

  return reviewRows.map((row) => {
    const source = sourceFor(row, spotracById, spotracByName, contractsById, contractsByName);
    const year = seasonEndYear(row.transaction_date);
    const base = { ...row };

    if (CLAIM_TYPES.has(row.classification)) {
      return withResolution(base, {
        status: "reconciled",
        source: source?.label || "NBA.com transaction feed",
        sourceUrl: source?.source_url || row.source_url,
        amount: "",
        quality: "reconciled",
        note: "Waiver claim detected; do not create dead money for the prior team without separate evidence.",
        conflict: ""
      });
    }

    if (WAIVE_TYPES.has(row.classification)) {
      const team = row.team_to || row.team_from || source?.team || "";
      const key = deadKey(team, year, row.player_name);
      const conflict = conflictNote(row, source);
      if (existingDead.has(key)) {
        return withResolution(base, {
          status: "reconciled",
          source: "ref/cap_tracker_dead_money.csv",
          sourceUrl: "",
          amount: "",
          quality: "override",
          note: "Dead-money override already exists for this player/team/year.",
          conflict: ""
        });
      }

      const amount = deadMoneyAmount(source);
      if (amount > 0 && (!conflict || source?.source_kind === "spotrac")) {
        return withResolution(base, {
          status: source?.source_kind === "spotrac" ? "exact" : "estimated",
          source: source?.label || "Current contract exports",
          sourceUrl: source?.source_url || row.source_url,
          amount,
          quality: source?.source_kind === "spotrac" ? "override" : "estimated",
          note: source?.source_kind === "spotrac"
            ? `Authorized salary source indicates remaining/dead guarantee for ${year}.`
            : `Estimated from current contract export guarantee/salary for ${year}; review guarantee and stretch treatment before applying.`,
          conflict
        });
      }

      return withResolution(base, {
        status: "needs_research",
        source: source?.label || "",
        sourceUrl: source?.source_url || "",
        amount: "",
        quality: "",
        note: conflict
          ? "Waive/release found, but the matched salary row conflicts with the transaction team; use authorized Spotrac/source evidence or manual amount before applying."
          : "Waive/release found, but no authorized salary source or usable remaining guarantee was available.",
        conflict
      });
    }

    if (CONTRACT_TYPES.has(row.classification)) {
      const amount = currentYearSalary(source);
      const conflict = conflictNote(row, source);
      return withResolution(base, {
        status: source?.source_kind === "spotrac" && amount > 0 ? "exact" : source && amount > 0 && !conflict ? "reconciled" : "needs_research",
        source: source?.label || "",
        sourceUrl: source?.source_url || "",
        amount: amount || "",
        quality: source?.source_kind === "spotrac" ? "override" : source ? "contract" : "",
        note: source
          ? conflict ? `Matched salary row needs review before use. ${salaryStructureNote(source)}` : salaryStructureNote(source)
          : "Transaction found, but no salary structure row matched this player.",
        conflict
      });
    }

    return withResolution(base, {
      status: row.salary_resolution_status || "needs_research",
      source: row.salary_source || "",
      sourceUrl: row.salary_source_url || "",
      amount: row.suggested_amount || "",
      quality: row.source_quality || "",
      note: row.resolution_note || "",
      conflict: row.conflict_note || ""
    });
  });
}

export function resolutionSummary(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.salary_resolution_status || "unresolved"] = (counts[row.salary_resolution_status || "unresolved"] ?? 0) + 1;
  }
  return counts;
}

function loadSpotracSources(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name));
  const rows = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    try {
      if (ext === ".csv") rows.push(...parseSpotracCsv(fs.readFileSync(file, "utf8"), file));
      if (ext === ".json") rows.push(...parseSpotracJson(JSON.parse(fs.readFileSync(file, "utf8")), file));
      if (ext === ".html" || ext === ".htm") rows.push(parseSpotracHtmlSnapshot(fs.readFileSync(file, "utf8"), file));
    } catch (error) {
      rows.push({
        player_name: path.basename(file, ext),
        label: "Spotrac source parse error",
        source_url: file,
        source_kind: "spotrac",
        parse_error: error.message
      });
    }
  }
  return rows.filter(Boolean).map((row) => normalizeSalarySourceRow(row, "spotrac"));
}

function parseSpotracCsv(text, file) {
  return parseCsv(text).map((row) => ({ ...row, source_file: file }));
}

function parseSpotracJson(value, file) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.players) ? value.players : Array.isArray(value?.contracts) ? value.contracts : [value];
  return rows.map((row) => ({ ...row, source_file: file }));
}

function parseSpotracHtmlSnapshot(text, file) {
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const money = Array.from(stripped.matchAll(/\$[\d,]+/g)).map((match) => cleanMoney(match[0])).filter((value) => value > 0);
  const guaranteedMatch = stripped.match(/(?:guaranteed|dead cap|dead money)[^\$]{0,80}(\$[\d,]+)/i);
  return {
    player_name: titleFromFile(file),
    guaranteed: guaranteedMatch ? cleanMoney(guaranteedMatch[1]) : "",
    salary_y0: money[0] || "",
    salary_y1: money[1] || "",
    salary_y2: money[2] || "",
    source_file: file
  };
}

function normalizeSalarySourceRow(row, defaultKind) {
  const sourceKind = String(row.source_kind || defaultKind || "").trim();
  const out = {
    source_kind: sourceKind,
    label: sourceKind === "spotrac" ? "Authorized Spotrac source" : "Contract export",
    source_url: row.source_url || row.url || row.source || row.source_file || "",
    nba_id: text(row.nba_id || row.player_id || row.idPlayer || row.PLAYER_ID),
    player_name: text(row.player_name || row.Player || row.PLAYER || row.name || row.player),
    team: cleanTeam(row.team || row.Team || row.TEAM || row.team_abbr),
    free_agent_status: text(row.free_agent_status),
    free_agent_year: text(row.free_agent_year),
    guaranteed: cleanMoney(row.guaranteed || row.total_guaranteed || row.remaining_guaranteed || row.dead_money || row.dead_cap),
    dead_money: cleanMoney(row.dead_money || row.dead_cap || row.remaining_dead_money),
    note: text(row.note || row.notes || row.contract_notes || row.parse_error)
  };
  for (let index = 0; index <= 4; index += 1) {
    out[`salary_y${index}`] = cleanMoney(row[`salary_y${index}`] || row[`cap_hit_y${index}`] || row[`year_${index}`]);
    out[`contract_status_y${index}`] = text(row[`contract_status_y${index}`] || row[`status_y${index}`] || row[`option_y${index}`]);
  }
  return out;
}

function normalizeContractSourceRow(row) {
  return normalizeSalarySourceRow({ ...row, source_kind: "contract", source_url: row.source }, "contract");
}

function sourceFor(row, spotracById, spotracByName, contractsById, contractsByName) {
  const id = text(row.nba_id);
  const name = normalizeName(row.player_name);
  return (id && spotracById.get(id)) ||
    (name && spotracByName.get(name)) ||
    (id && contractsById.get(id)) ||
    (name && contractsByName.get(name)) ||
    null;
}

function withResolution(row, resolution) {
  return {
    ...row,
    salary_resolution_status: resolution.status || "",
    salary_source: resolution.source || "",
    salary_source_url: resolution.sourceUrl || "",
    suggested_amount: resolution.amount ? String(Math.round(Number(resolution.amount))) : "",
    approved_amount: row.approved_amount || "",
    source_quality: resolution.quality || "",
    resolution_note: resolution.note || "",
    conflict_note: resolution.conflict || ""
  };
}

function deadMoneyAmount(source) {
  if (!source) return 0;
  return Number(source.dead_money || source.guaranteed || source.salary_y0 || 0);
}

function currentYearSalary(source) {
  if (!source) return 0;
  return Number(source.salary_y0 || source.guaranteed || 0);
}

function salaryStructureNote(source) {
  const salaries = [];
  for (let index = 0; index <= 4; index += 1) {
    if (source[`salary_y${index}`]) salaries.push(`Y${index}: $${Number(source[`salary_y${index}`]).toLocaleString()}`);
  }
  const details = [
    salaries.join(", "),
    source.guaranteed ? `guaranteed $${Number(source.guaranteed).toLocaleString()}` : "",
    source.free_agent_status ? `FA ${source.free_agent_status} ${source.free_agent_year || ""}`.trim() : "",
    source.note
  ].filter(Boolean);
  return details.join(" / ");
}

function conflictNote(row, source) {
  if (!source) return "";
  const notes = [];
  if (row.team_to && source.team && row.team_to !== source.team && !WAIVE_TYPES.has(row.classification)) {
    notes.push(`transaction team ${row.team_to} differs from salary source team ${source.team}`);
  }
  if (source.parse_error) notes.push(source.parse_error);
  return notes.join("; ");
}

function seasonEndYear(dateValue) {
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return new Date().getUTCFullYear();
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

function deadKey(team, year, playerName) {
  return `${cleanTeam(team)}||${year}||${normalizeName(playerName)}`;
}

function cleanMoney(value) {
  const textValue = text(value);
  if (!textValue) return 0;
  const number = Number(textValue.replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function cleanTeam(value) {
  return text(value).toUpperCase();
}

function titleFromFile(file) {
  return path.basename(file, path.extname(file))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
