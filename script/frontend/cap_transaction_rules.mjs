import fs from "node:fs";

export const REVIEW_COLUMNS = [
  "transaction_key",
  "transaction_date",
  "source",
  "source_url",
  "reference_url",
  "nba_id",
  "player_name",
  "team_from",
  "team_to",
  "transaction_type",
  "raw_text",
  "classification",
  "confidence",
  "recommended_action",
  "affected_files",
  "contract_delta",
  "salary_resolution_status",
  "salary_source",
  "salary_source_url",
  "suggested_amount",
  "approved_amount",
  "source_quality",
  "resolution_note",
  "conflict_note",
  "status",
  "applied_at",
  "applied_key",
  "applied_amount",
  "last_error"
];

const NBA_MOVEMENT_SOURCE = "NBA.com Player Movement";
const NBA_MOVEMENT_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";

const TEAM_ALIASES = new Map([
  ["ATLANTA HAWKS", "ATL"],
  ["BOSTON CELTICS", "BOS"],
  ["BROOKLYN NETS", "BKN"],
  ["CHARLOTTE HORNETS", "CHA"],
  ["CHICAGO BULLS", "CHI"],
  ["CLEVELAND CAVALIERS", "CLE"],
  ["DALLAS MAVERICKS", "DAL"],
  ["DENVER NUGGETS", "DEN"],
  ["DETROIT PISTONS", "DET"],
  ["GOLDEN STATE WARRIORS", "GSW"],
  ["HOUSTON ROCKETS", "HOU"],
  ["INDIANA PACERS", "IND"],
  ["LOS ANGELES CLIPPERS", "LAC"],
  ["LA CLIPPERS", "LAC"],
  ["LOS ANGELES LAKERS", "LAL"],
  ["MEMPHIS GRIZZLIES", "MEM"],
  ["MIAMI HEAT", "MIA"],
  ["MILWAUKEE BUCKS", "MIL"],
  ["MINNESOTA TIMBERWOLVES", "MIN"],
  ["NEW ORLEANS PELICANS", "NOP"],
  ["NEW YORK KNICKS", "NYK"],
  ["OKLAHOMA CITY THUNDER", "OKC"],
  ["ORLANDO MAGIC", "ORL"],
  ["PHILADELPHIA 76ERS", "PHI"],
  ["PHOENIX SUNS", "PHX"],
  ["PORTLAND TRAIL BLAZERS", "POR"],
  ["SACRAMENTO KINGS", "SAC"],
  ["SAN ANTONIO SPURS", "SAS"],
  ["TORONTO RAPTORS", "TOR"],
  ["UTAH JAZZ", "UTA"],
  ["WASHINGTON WIZARDS", "WAS"]
]);

const TEAM_FIXUPS = new Map([
  ["BRK", "BKN"],
  ["CHO", "CHA"],
  ["PHO", "PHX"],
  ["NO", "NOP"],
  ["NOH", "NOP"],
  ["NOK", "NOP"]
]);

export function normalizeMovementPayload(payload, options = {}) {
  const sourceUrl = options.sourceUrl || NBA_MOVEMENT_URL;
  const source = options.source || NBA_MOVEMENT_SOURCE;
  const data = payload?.NBA_Player_Movement ?? payload?.nba_player_movement ?? payload;
  const columns = normalizeColumns(data?.columns ?? data?.Columns ?? data?.headers ?? []);
  const rows = data?.rows ?? data?.Rows ?? data?.data ?? [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => normalizeMovementRow(row, columns, source, sourceUrl))
    .filter(Boolean);
}

export function buildReviewRows(transactions, options = {}) {
  const startDate = parseDateOnly(options.startDate);
  const endDate = parseDateOnly(options.endDate);
  const priorByKey = new Map((options.priorRows ?? []).map((row) => [row.transaction_key, row]));
  const contractDeltaById = options.contractDeltaById ?? new Map();
  const contractDeltaByName = options.contractDeltaByName ?? new Map();
  const referenceUrl = options.referenceUrl || spotracReferenceUrl(startDate, endDate);
  const rows = [];
  const seen = new Set();

  for (const transaction of transactions) {
    const date = parseDateOnly(transaction.transaction_date);
    if (!date) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;

    const classification = classifyTransaction(transaction.raw_text, transaction.transaction_type);
    if (!classification.capRelevant) continue;

    const key = transactionKey(transaction, classification.classification);
    if (seen.has(key)) continue;
    seen.add(key);

    const prior = priorByKey.get(key) ?? {};
    const nameKey = normalizeName(transaction.player_name);
    const delta = transaction.nba_id
      ? contractDeltaById.get(String(transaction.nba_id)) || ""
      : (nameKey && contractDeltaByName.get(nameKey)) || "";

    rows.push(cleanRow({
      transaction_key: key,
      transaction_date: formatDateOnly(date),
      source: transaction.source || NBA_MOVEMENT_SOURCE,
      source_url: transaction.source_url || NBA_MOVEMENT_URL,
      reference_url: referenceUrl,
      nba_id: transaction.nba_id || "",
      player_name: transaction.player_name || "",
      team_from: transaction.team_from || "",
      team_to: transaction.team_to || "",
      transaction_type: transaction.transaction_type || "",
      raw_text: transaction.raw_text || "",
      classification: classification.classification,
      confidence: classification.confidence,
      recommended_action: classification.recommendedAction,
      affected_files: classification.affectedFiles,
      contract_delta: delta,
      salary_resolution_status: prior.salary_resolution_status || "",
      salary_source: prior.salary_source || "",
      salary_source_url: prior.salary_source_url || "",
      suggested_amount: prior.suggested_amount || "",
      approved_amount: prior.approved_amount || "",
      source_quality: prior.source_quality || "",
      resolution_note: prior.resolution_note || "",
      conflict_note: prior.conflict_note || "",
      status: prior.status || "pending_review",
      applied_at: prior.applied_at || "",
      applied_key: prior.applied_key || "",
      applied_amount: prior.applied_amount || "",
      last_error: prior.last_error || ""
    }));
  }

  return rows.sort((a, b) =>
    String(b.transaction_date).localeCompare(String(a.transaction_date)) ||
    String(a.player_name).localeCompare(String(b.player_name)) ||
    String(a.raw_text).localeCompare(String(b.raw_text))
  );
}

export function classifyTransaction(rawText, transactionType = "") {
  const text = String(rawText ?? "");
  const type = String(transactionType ?? "");
  const lower = `${type} ${text}`.toLowerCase();

  if (!lower.trim()) return ignored("empty");
  if (/\b(fined|suspended|injur|illness|coach|front office|executive|assigned to|recalled from)\b/.test(lower)) {
    return ignored("non-roster movement");
  }

  if (/\b(converted|convert)\b/.test(lower) && /\b(two-way|two way|nba contract|standard contract|regular contract)\b/.test(lower)) {
    return relevant(
      "two_way_conversion",
      "high",
      "Refresh contracts, confirm the new standard-contract salary/status, and review any two-way slot effects.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;processed/livedata/impactrefresh/contracts_bref_2026_current.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(waived|waive|released|release)\b/.test(lower)) {
    return relevant(
      "waive_release",
      "high",
      "Review remaining guarantee/dead money; add or update ref/cap_tracker_dead_money.csv if guaranteed salary remains after the contract source drops the player.",
      "ref/cap_tracker_dead_money.csv;processed/livedata/impactrefresh/contracts_2026_current.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(claimed|award(?:ed)?)\b/.test(lower) && /\bwaivers?\b/.test(lower)) {
    return relevant(
      "waiver_claim",
      "high",
      "Refresh contracts and confirm the claiming team now carries the salary; review dead-money effects for the waiving team.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;ref/cap_tracker_dead_money.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(acquired|traded|trade|sent to|from .* in exchange for)\b/.test(lower)) {
    return relevant(
      "trade",
      "medium",
      "Refresh contracts and verify team assignment/salary continuity; review TPE, pick, and dead-money overrides when the raw text mentions draft/cash/exception terms.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;ref/cap_tracker_exceptions.csv;ref/cap_tracker_picks.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(exercised|declined|picked up|team option|player option|club option)\b/.test(lower) && /\boption\b/.test(lower)) {
    return relevant(
      "option_decision",
      "high",
      "Confirm option status in contract sources; update contract status or cap-hold/dead-money overrides if the option decision is not reflected.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;processed/livedata/impactrefresh/contracts_bref_2026_current.csv;ref/cap_tracker_cap_holds.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(extension|extended)\b/.test(lower)) {
    return relevant(
      "extension",
      "medium",
      "Refresh contracts and compare future salary years; queue manual review if extension years are missing or only partially sourced.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;processed/livedata/impactrefresh/contracts_bref_2026_current.csv;frontend/public/data/cap_tracker.json"
    );
  }
  if (/\b(re-signed|resigned|signed)\b/.test(lower)) {
    if (/\b10[- ]day\b/.test(lower)) {
      return relevant(
        "ten_day_signing",
        "high",
        "Confirm prorated 10-day salary and roster slot treatment; review contract source because public salary exports can lag short-term deals.",
        "processed/livedata/impactrefresh/contracts_2026_current.csv;ref/cap_tracker_cap_holds.csv;frontend/public/data/cap_tracker.json"
      );
    }
    if (/\brest[- ]of[- ]season\b/.test(lower)) {
      return relevant(
        "rest_of_season_signing",
        "high",
        "Confirm prorated rest-of-season salary and free-agent year; review cap hold if the player replaced a two-way or 10-day slot.",
        "processed/livedata/impactrefresh/contracts_2026_current.csv;ref/cap_tracker_cap_holds.csv;frontend/public/data/cap_tracker.json"
      );
    }
    if (/\btwo[- ]way\b/.test(lower)) {
      return relevant(
        "two_way_signing",
        "high",
        "Track as a roster/status event; confirm whether the cap tracker should display two-way players or only note them outside team salary.",
        "processed/livedata/impactrefresh/contracts_2026_current.csv;frontend/public/data/cap_tracker.json"
      );
    }
    return relevant(
      "signing",
      "medium",
      "Refresh contracts and compare salary/status/free-agent year before applying any tracker source updates.",
      "processed/livedata/impactrefresh/contracts_2026_current.csv;processed/livedata/impactrefresh/contracts_bref_2026_current.csv;frontend/public/data/cap_tracker.json"
    );
  }

  return ignored("not a tracked cap event");
}

export function buildContractSnapshot(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const normalized = normalizeContractRow(row);
    if (!normalized.player_name && !normalized.nba_id) continue;
    const key = normalized.nba_id ? `id:${normalized.nba_id}` : `name:${normalizeName(normalized.player_name)}:${normalized.team}`;
    const prior = byKey.get(key);
    if (!prior || contractCompletenessScore(normalized) > contractCompletenessScore(prior)) {
      byKey.set(key, normalized);
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.nba_id || "").localeCompare(String(b.nba_id || "")) ||
    String(a.player_name || "").localeCompare(String(b.player_name || ""))
  );
}

export function buildContractDeltaMaps(previousRows, currentRows) {
  const previousById = new Map();
  const previousByName = new Map();
  for (const row of buildContractSnapshot(previousRows)) {
    if (row.nba_id) previousById.set(String(row.nba_id), row);
    const key = normalizeName(row.player_name);
    if (key) previousByName.set(key, row);
  }

  const deltaById = new Map();
  const deltaByName = new Map();
  for (const row of buildContractSnapshot(currentRows)) {
    const previous = (row.nba_id && previousById.get(String(row.nba_id))) || previousByName.get(normalizeName(row.player_name));
    const delta = describeContractDelta(previous, row);
    if (!delta) continue;
    if (row.nba_id) deltaById.set(String(row.nba_id), delta);
    const key = normalizeName(row.player_name);
    if (key) deltaByName.set(key, delta);
  }
  return { deltaById, deltaByName };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const input = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const header = rows.shift().map((value) => value.trim());
  return rows
    .filter((values) => values.some((value) => String(value).trim().length))
    .map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

export function writeCsv(rows, columns = REVIEW_COLUMNS) {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvEscape(row[column] ?? "")).join(",")).join("\n")}\n`;
}

export function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

export function writeCsvFile(filePath, rows, columns = REVIEW_COLUMNS) {
  fs.writeFileSync(filePath, writeCsv(rows, columns));
}

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function parseDateOnly(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeMovementRow(row, columns, source, sourceUrl) {
  const object = Array.isArray(row) ? Object.fromEntries(columns.map((column, index) => [column, row[index]])) : row;
  if (!object || typeof object !== "object") return null;

  const rawText =
    pick(object, ["descriptionTransaction", "DESCRIPTION", "TRANSACTION_DESCRIPTION", "Transaction_Description", "description", "Description"]) ||
    fallbackRawText(object);
  const playerName = inferPlayerName(
    pick(object, ["namePlayer", "PLAYER_NAME", "PLAYER", "Player", "PLAYER_SLUG", "player_name"]),
    rawText
  );
  const transactionDate = pick(object, ["dateTransaction", "TRANSACTION_DATE", "Transaction_Date", "transaction_date", "Date"]);
  const type = pick(object, ["typeTransaction", "TRANSACTION_TYPE", "Transaction_Type", "transaction_type", "GroupSort"]);
  const teamTo =
    normalizeTeam(pick(object, ["codeTeam", "TEAM_ABBREVIATION", "TEAM_ABBREVIATION_TO", "team_to", "Team", "TEAM"])) ||
    inferLeadTeam(rawText);
  const teamFrom = normalizeTeam(pick(object, ["codeTeamFrom", "TEAM_ABBREVIATION_FROM", "team_from", "TeamFrom"]));
  const nbaId = pick(object, ["idPlayer", "PLAYER_ID", "PERSON_ID", "nba_id", "player_id"]);

  return cleanRow({
    source,
    source_url: sourceUrl,
    transaction_date: transactionDate,
    nba_id: numericString(nbaId),
    player_name: playerName,
    team_from: teamFrom,
    team_to: teamTo,
    transaction_type: type,
    raw_text: rawText
  });
}

function normalizeColumns(columns) {
  if (!Array.isArray(columns)) return [];
  return columns.map((column) => {
    if (typeof column === "string") return column;
    return column?.Name ?? column?.name ?? column?.field ?? column?.key ?? "";
  });
}

function fallbackRawText(object) {
  const values = Object.values(object).filter((value) => typeof value === "string" && value.length > 20);
  return values[0] || "";
}

function inferPlayerName(candidate, rawText) {
  const text = String(rawText ?? "");
  const value = String(candidate ?? "").trim();
  const candidateKey = normalizeName(value);
  if (candidateKey) {
    const nameMatches = text.match(/[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,4}/g) ?? [];
    const exact = nameMatches.find((match) => normalizeName(match) === candidateKey);
    if (exact) return cleanPersonName(exact);
    if (value.includes("-")) return value.split("-").filter(Boolean).map(titleCaseWord).join(" ");
    return cleanPersonName(value);
  }

  const pattern = /\b(?:signed|waived|released|converted|claimed|acquired|exercised|declined|extended|traded)\s+(?:guard|forward|center|guards|forwards|centers|g|f|c|[A-Z]+\/[A-Z]+)?\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})/i;
  const match = text.match(pattern);
  return cleanPersonName(match?.[1] ?? "");
}

function inferLeadTeam(rawText) {
  const upper = String(rawText ?? "").toUpperCase();
  const names = Array.from(TEAM_ALIASES.keys()).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (upper.startsWith(name)) return TEAM_ALIASES.get(name);
  }
  return "";
}

function titleCaseWord(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function cleanPersonName(value) {
  return String(value ?? "").trim().replace(/[.,;:]+$/g, "");
}

function relevant(classification, confidence, recommendedAction, affectedFiles) {
  return { capRelevant: true, classification, confidence, recommendedAction, affectedFiles };
}

function ignored(reason) {
  return {
    capRelevant: false,
    classification: "ignored",
    confidence: "high",
    recommendedAction: reason,
    affectedFiles: ""
  };
}

function transactionKey(transaction, classification) {
  const identity = transaction.nba_id || normalizeName(transaction.player_name) || normalizeName(transaction.raw_text);
  return [
    formatDateOnly(parseDateOnly(transaction.transaction_date)),
    identity,
    classification,
    normalizeName(transaction.raw_text).slice(0, 80)
  ].join("|");
}

function spotracReferenceUrl(startDate, endDate) {
  if (!startDate || !endDate) return "https://www.spotrac.com/nba/transactions";
  return `https://www.spotrac.com/nba/transactions/_/start/${formatDateOnly(startDate)}/end/${formatDateOnly(endDate)}`;
}

function normalizeContractRow(row) {
  const out = {
    nba_id: numericString(row.nba_id),
    player_name: row.player_name || "",
    team: normalizeTeam(row.team),
    free_agent_status: row.free_agent_status || "",
    free_agent_year: numericString(row.free_agent_year),
    guaranteed: numericString(row.guaranteed || row.total_guaranteed),
    contract_type: row.contract_type || "",
    signed_using: row.signed_using || ""
  };
  for (let index = 0; index <= 4; index += 1) {
    out[`salary_y${index}`] = numericString(row[`salary_y${index}`]);
    out[`contract_status_y${index}`] = row[`contract_status_y${index}`] || "";
  }
  return cleanRow(out);
}

function contractCompletenessScore(row) {
  let score = 0;
  for (const field of ["team", "free_agent_status", "free_agent_year", "guaranteed", "contract_type", "signed_using"]) {
    if (row[field]) score += 1;
  }
  for (let index = 0; index <= 4; index += 1) {
    if (row[`salary_y${index}`]) score += 2;
    if (row[`contract_status_y${index}`]) score += 1;
  }
  return score;
}

function describeContractDelta(previous, current) {
  if (!previous) return "new contract row";
  const changed = [];
  for (const field of ["team", "free_agent_status", "free_agent_year", "guaranteed", "contract_type", "signed_using"]) {
    if (String(previous[field] ?? "") !== String(current[field] ?? "")) changed.push(`${field}:${previous[field] || "-"}=>${current[field] || "-"}`);
  }
  for (let index = 0; index <= 4; index += 1) {
    for (const field of [`salary_y${index}`, `contract_status_y${index}`]) {
      if (String(previous[field] ?? "") !== String(current[field] ?? "")) changed.push(`${field}:${previous[field] || "-"}=>${current[field] || "-"}`);
    }
  }
  return changed.join("; ");
}

function normalizeTeam(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  if (TEAM_FIXUPS.has(upper)) return TEAM_FIXUPS.get(upper);
  if (/^[A-Z]{2,3}$/.test(upper)) return upper;
  return TEAM_ALIASES.get(upper) || text;
}

function pick(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && String(object[key]).trim() !== "") return String(object[key]).trim();
  }
  const normalized = new Map(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase());
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function numericString(value) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "na") return "";
  const number = Number(text);
  return Number.isFinite(number) ? String(Math.trunc(number)) : text;
}

function cleanRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}
