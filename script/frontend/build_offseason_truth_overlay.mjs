import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const dataDir = path.join(root, "frontend", "public", "data");
const contractsPath = path.join(root, "processed", "livedata", "impactrefresh", "contracts_2026_current.csv");
const brefContractsPath = path.join(root, "processed", "livedata", "impactrefresh", "contracts_bref_2026_current.csv");
const rosterPath = path.join(root, "processed", "livedata", "impactrefresh", "current_rosters_2026.csv");
const capPath = path.join(root, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv");
const playersPath = path.join(dataDir, "impact_players.json");
const outPath = path.join(dataDir, "offseason_truth.json");
const manualCorrectionsPath = path.join(root, "ref", "current_roster_overrides_2026.csv");

const capBenchmarks = new Map([
  ["CHI", { maximum_cap_space: 69985479, source: "Spotrac Bulls 2026-27 cap-space benchmark" }]
]);

const players = readPlayers();
const contracts = parseCsv(fs.readFileSync(contractsPath, "utf8"));
const brefContracts = fs.existsSync(brefContractsPath) ? parseCsv(fs.readFileSync(brefContractsPath, "utf8")) : [];
const rosters = fs.existsSync(rosterPath) ? parseCsv(fs.readFileSync(rosterPath, "utf8")) : [];
const capRows = parseCsv(fs.readFileSync(capPath, "utf8"));
const cap2027 = capRows.find((row) => Number(row.year) === 2027) ?? {};
const assumptions = {
  cap: numberValue(cap2027.salary_cap, 166000000),
  tax: numberValue(cap2027.tax_level, 201650000),
  firstApron: numberValue(cap2027.first_apron, 210321000),
  secondApron: numberValue(cap2027.second_apron, 222775000)
};
const minimumRosterCharge = 1378978;
const contractsById = new Map();
const contractsByName = new Map();
for (const contract of contracts) {
  if (contract.nba_id) contractsById.set(String(contract.nba_id), contract);
  contractsByName.set(normalizeName(contract.player_name), contract);
}
const brefContractsById = new Map();
const brefContractsByName = new Map();
for (const contract of brefContracts) {
  if (contract.nba_id) brefContractsById.set(String(contract.nba_id), contract);
  brefContractsByName.set(normalizeName(contract.player_name), contract);
}
const rosterById = new Map();
const rosterByName = new Map();
for (const roster of rosters) {
  if (roster.nba_id) rosterById.set(String(roster.nba_id), roster);
  rosterByName.set(normalizeName(roster.player_name), roster);
}
const manualCorrections = readManualCorrections(manualCorrectionsPath);

const seasonPlayers = players.filter((player) => Number(player.year) === 2026);
const truths = {};
const conflicts = [];
for (const player of seasonPlayers) {
  const key = playerKey(player);
  const contract = contractsById.get(String(player.nba_id)) ?? contractsByName.get(normalizeName(player.player_name));
  const brefContract = brefContractsById.get(String(player.nba_id)) ?? brefContractsByName.get(normalizeName(player.player_name));
  const roster = rosterById.get(String(player.nba_id)) ?? rosterByName.get(normalizeName(player.player_name));
  const truth = buildTruth(player, contract, roster, brefContract);
  const corrected = manualCorrections.get(key);
  if (corrected) Object.assign(truth, corrected);
  truths[key] = truth;
  const localSignedTeam = cleanTeam(player.team);
  if (localSignedTeam !== truth.current_roster_team && normalizeStatus(player.contract_status) === "Signed") {
    conflicts.push({
      player: player.player_name,
      team: localSignedTeam,
      issue: `Local impact row team differs from roster truth (${truth.current_roster_team}).`,
      source: truth.roster_status_source
    });
  }
}

const teamCaps = buildTeamCaps(truths);
const overlay = {
  generated_at: new Date().toISOString(),
  source_policy: "Public sources first: RealGM roster/transaction corrections, local databallr contract salaries, Basketball-Reference contract option markers, Spotrac as validation only.",
  notes: [
    "This file is a frontend/offseason truth overlay; impact projections remain intact.",
    "Active 2026 roster teams come from generated NBA.com roster truth, with optional manual overrides in ref/current_roster_overrides_2026.csv.",
    "The 2026 offseason cap sheet uses 2026-27 salary columns from the local databallr contract export, with Basketball-Reference option cell classes used to fill/validate missing player-option and team-option statuses.",
    "Manual roster corrections are applied before cap sheets are computed when the optional override file exists."
  ],
  players: truths,
  team_caps: teamCaps,
  stale_roster_conflicts: conflicts
};
fs.writeFileSync(outPath, `${JSON.stringify(overlay, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
console.log(`Players: ${Object.keys(truths).length}; team caps: ${teamCaps.length}; conflicts: ${conflicts.length}`);

function readPlayers() {
  if (fs.existsSync(playersPath)) {
    return JSON.parse(fs.readFileSync(playersPath, "utf8"));
  }
  const manifestPath = path.join(dataDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const shards = manifest.static_data?.datasets?.impact_players?.shards ?? [];
  return shards.flatMap((shard) => {
    const shardPath = path.join(dataDir, shard.file);
    return fs.existsSync(shardPath) ? JSON.parse(fs.readFileSync(shardPath, "utf8")) : [];
  });
}

function buildTruth(player, contract, roster, brefContract) {
  const key = playerKey(player);
  const nextSalary = numberValue(contract?.salary_y1, brefContract?.salary_y1, NaN);
  const databallrNextStatus = normalizeOptionalStatus(contract?.contract_status_y1);
  const brefNextStatus = normalizeOptionalStatus(brefContract?.contract_status_y1);
  const nextStatus = isOptionStatus(brefNextStatus) ? brefNextStatus : (databallrNextStatus || brefNextStatus);
  const freeAgentYear = Number(contract?.free_agent_year);
  const freeAgentStatus = String(contract?.free_agent_status ?? "").trim().toUpperCase();
  const signedUsing = String(contract?.signed_using ?? "").trim();
  const rosterTeam = roster ? cleanTeam(roster.team) : cleanTeam(player.current_roster_team || player.roster_truth_team || player.team);
  const hasNextSalary = Number.isFinite(nextSalary) && nextSalary > 0;
  const contractTeam = cleanTeam(contract?.team || brefContract?.team || player.incumbent_team || player.team);
  const usedContractTeamFallback = hasNextSalary && rosterTeam === "FA" && contractTeam !== "FA";
  const currentTeam = usedContractTeamFallback ? contractTeam : rosterTeam;
  const incumbent = currentTeam !== "FA" ? currentTeam : contractTeam;
  const isFreeAgent = !hasNextSalary && (freeAgentYear <= 2026 || normalizeStatus(player.contract_status) !== "Signed");
  const status = hasNextSalary ? (isOptionStatus(nextStatus) ? nextStatus : "Signed") : (freeAgentStatus === "RFA" ? "RFA" : "UFA");
  const contractStatusSource = isOptionStatus(brefNextStatus)
    ? "Basketball-Reference option cell class"
    : (databallrNextStatus ? "databallr contract export" : (brefNextStatus ? "Basketball-Reference contracts table" : null));
  const rights = isFreeAgent ? birdRightsFromSource(signedUsing, freeAgentStatus) : "None";
  const marketValue = numberValue(player.fa_value, player.value, player.contract, 2500000);
  const previousSalary = numberValue(contract?.salary_y0, player.contract, player.projection_effective_contract_y1, marketValue);
  const hold = isFreeAgent && rights !== "None" ? capHoldFor(status, rights, previousSalary, marketValue) : 0;
  return {
    key,
    nba_id: Number.isFinite(Number(player.nba_id)) ? Number(player.nba_id) : null,
    player_name: player.player_name,
    year: Number(player.year),
    current_roster_team: currentTeam,
    rights_team: isFreeAgent ? incumbent : currentTeam,
    bird_rights: rights,
    cap_hold: Math.round(hold),
    cap_hold_type: hold > 0 ? `${status} ${rights} cap hold` : "No retained cap hold",
    guaranteed_salary: hasNextSalary ? Math.round(nextSalary) : 0,
    dead_cap: 0,
    waived_date: null,
    roster_status_source: roster?.roster_source || (usedContractTeamFallback ? "contract team fallback for roster miss" : player.roster_status_source) || (contract ? "databallr contract export fallback" : "frontend impact row fallback"),
    contract_status: status,
    contract_status_source: contractStatusSource,
    signed_using: signedUsing || null,
    free_agent_status: freeAgentStatus || null
  };
}

function readManualCorrections(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  const corrections = new Map();
  for (const row of rows) {
    const key = row.key || `${row.year || 2026}-${row.nba_id}-${row.player_name}`;
    const correction = {};
    for (const [field, value] of Object.entries(row)) {
      if (["key", "year", "nba_id", "player_name"].includes(field) || value === "") continue;
      const targetField = field === "team" ? "current_roster_team" : field === "roster_source" ? "roster_status_source" : field;
      correction[targetField] = ["cap_hold", "guaranteed_salary", "dead_cap"].includes(targetField) ? numberValue(value, 0) : value;
    }
    if (key && Object.keys(correction).length) corrections.set(key, correction);
  }
  return corrections;
}

function buildTeamCaps(truthsByKey) {
  const teams = new Set();
  for (const truth of Object.values(truthsByKey)) {
    if (truth.current_roster_team !== "FA") teams.add(truth.current_roster_team);
    if (truth.rights_team !== "FA") teams.add(truth.rights_team);
  }
  return Array.from(teams).sort().map((team) => {
    const rows = Object.values(truthsByKey);
    const active = rows.filter((row) => row.current_roster_team === team);
    const holds = rows.filter((row) => row.rights_team === team && row.current_roster_team !== team && row.cap_hold > 0);
    const activeSalary = sum(active.map((row) => row.guaranteed_salary));
    const deadCap = sum(rows.filter((row) => row.rights_team === team || row.current_roster_team === team).map((row) => row.dead_cap));
    const capHolds = sum(holds.map((row) => row.cap_hold));
    const rosterCharges = Math.max(0, 12 - active.length) * minimumRosterCharge;
    const maximumCapSpace = assumptions.cap - activeSalary - deadCap - rosterCharges;
    const practicalCapSpace = maximumCapSpace - capHolds;
    const benchmark = capBenchmarks.get(team);
    return {
      year: 2026,
      team,
      active_salary: Math.round(activeSalary),
      guaranteed_salary: Math.round(activeSalary),
      dead_cap: Math.round(deadCap),
      cap_holds: Math.round(capHolds),
      roster_charges: Math.round(rosterCharges),
      practical_cap_space: Math.round(practicalCapSpace),
      maximum_cap_space: Math.round(maximumCapSpace),
      tax_room: Math.round(assumptions.tax - activeSalary - deadCap),
      first_apron_room: Math.round(assumptions.firstApron - activeSalary - deadCap),
      second_apron_room: Math.round(assumptions.secondApron - activeSalary - deadCap),
      active_roster_count: active.length,
      hold_count: holds.length,
      cap_validation_delta: benchmark ? Math.round(maximumCapSpace - benchmark.maximum_cap_space) : null,
      validation_source: benchmark?.source ?? null
    };
  });
}

function capHoldFor(status, rights, previousSalary, marketValue) {
  if (status === "RFA") return Math.max(marketValue * 1.15, previousSalary * 2.5);
  if (rights === "Bird") return Math.max(marketValue * 0.85, previousSalary * 1.5);
  if (rights === "Early Bird") return Math.max(marketValue * 0.7, previousSalary * 1.3);
  if (rights === "Non-Bird") return Math.max(1500000, previousSalary * 1.2);
  return 0;
}

function birdRightsFromSource(signedUsing, freeAgentStatus) {
  const source = `${signedUsing} ${freeAgentStatus}`.toLowerCase();
  if (source.includes("bird rights")) return "Bird";
  if (source.includes("early bird")) return "Early Bird";
  if (source.includes("non-bird") || source.includes("non bird")) return "Non-Bird";
  if (source.includes("rfa")) return "Bird";
  return "None";
}

function normalizeStatus(value) {
  const status = String(value ?? "").trim();
  if (status === "Player Option") return "Player Option";
  if (status === "Team Option") return "Team Option";
  if (status === "Non-Guaranteed") return "Non-Guaranteed";
  if (status === "RFA") return "RFA";
  if (status === "Rookie FA") return "Rookie FA";
  if (status === "Signed") return "Signed";
  return status || "UFA";
}

function normalizeOptionalStatus(value) {
  const status = String(value ?? "").trim();
  if (status === "Player Option") return "Player Option";
  if (status === "Team Option") return "Team Option";
  if (status === "Non-Guaranteed") return "Non-Guaranteed";
  if (status === "RFA") return "RFA";
  if (status === "Rookie FA") return "Rookie FA";
  if (status === "Signed") return "Signed";
  return status;
}

function isOptionStatus(status) {
  return status === "Player Option" || status === "Team Option";
}

function playerKey(player) {
  return `${player.year}-${player.nba_id}-${player.player_name}`;
}

function cleanTeam(value) {
  return String(value ?? "").trim().toUpperCase() || "FA";
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      field += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
