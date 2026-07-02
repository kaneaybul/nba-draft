import { buildSpotracCapTrackerData } from "./build_cap_tracker_spotrac_data.mjs";

buildSpotracCapTrackerData();
process.exit(0);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAP_TRACKER_SCHEMA_VERSION,
  CBA_REFERENCES,
  canonicalContractRowId,
  canonicalDeadMoneyDisplayKey,
  cbaCapHoldAmount,
  dedupeDeadMoneyRows,
  exceptionAmount,
  guaranteeInfoForYear,
  mergeDuplicateContractSources,
  minimumRosterCharge,
  projectedFirstApron,
  projectedSecondApron,
  projectedTaxLevel,
  salaryFloor,
  statusBandForAmount as cbaStatusBandForAmount,
  systemLevelSourceQuality
} from "./cap_tracker_rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const dataDir = path.join(root, "frontend", "public", "data");
const impactPlayersPath = path.join(dataDir, "impact_players.json");
const teamProjectionsPath = path.join(dataDir, "team_projections.json");
const manifestPath = path.join(dataDir, "manifest.json");
const contractsPath = path.join(root, "processed", "livedata", "impactrefresh", "contracts_2026_current.csv");
const brefContractsPath = path.join(root, "processed", "livedata", "impactrefresh", "contracts_bref_2026_current.csv");
const capPath = path.join(root, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv");
const deadMoneyPath = path.join(root, "ref", "cap_tracker_dead_money.csv");
const exceptionOverridePath = path.join(root, "ref", "cap_tracker_exceptions.csv");
const pickOverridePath = path.join(root, "ref", "cap_tracker_picks.csv");
const holdOverridePath = path.join(root, "ref", "cap_tracker_cap_holds.csv");
const guaranteeOverridePath = path.join(root, "ref", "cap_tracker_guarantees.csv");
const rookieScalePath = path.join(root, "ref", "cap_tracker_rookie_scale.csv");
const offseasonSimulatorPath = path.join(root, "frontend", "src", "OffseasonSimulator.tsx");
const outPath = path.join(dataDir, "cap_tracker.json");

const START_YEAR = 2026;
const END_YEAR = 2031;
const YEARS = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, index) => START_YEAR + index);
const CBA_SOURCE = CBA_REFERENCES.join("; ");
const CONTRACT_SOURCE = "databallr contract export with Basketball-Reference option-marker validation";

const players = readJson(impactPlayersPath, []);
const teams = readJson(teamProjectionsPath, []);
const contracts = readCsvFile(contractsPath);
const brefContracts = readCsvFile(brefContractsPath);
const capRows = readCsvFile(capPath);
const deadOverrides = readCsvFile(deadMoneyPath);
const exceptionOverrides = readCsvFile(exceptionOverridePath);
const pickOverrides = readCsvFile(pickOverridePath);
const holdOverrides = readCsvFile(holdOverridePath);
const guaranteeOverrides = readCsvFile(guaranteeOverridePath);
const rookieScaleRows = readCsvFile(rookieScalePath);

const latestImpactYear = maxFinite(players.map((player) => numberValue(player.year))) ?? START_YEAR;
const playerMeta = buildPlayerMeta(players, latestImpactYear);
const teamMeta = buildTeamMeta(teams, latestImpactYear);
const seasons = buildSeasons(capRows);
const contractsByKey = mergeContractSources(contracts, brefContracts);
const holdOverrideMap = buildHoldOverrideMap(holdOverrides);
const guaranteeOverrideMap = buildGuaranteeOverrideMap(guaranteeOverrides);
const officialDraftOrder = readOfficialDraftOrder();
const deadMoneyBuild = buildDeadMoney(deadOverrides);
const deadMoney = deadMoneyBuild.rows;
const deadMoneySuppressions = buildDeadMoneySuppressions(deadMoney);
const contractRows = [
  ...buildContractRows(contractsByKey, playerMeta, holdOverrideMap, guaranteeOverrideMap, seasons, deadMoneySuppressions),
  ...buildDraftPickRows(officialDraftOrder, rookieScaleRows),
  ...buildDeadMoneyRows(deadMoney)
].sort(contractRowSort);
const teamSeasons = buildTeamSeasons(teamMeta, seasons, contractRows, deadMoney);
const exceptions = buildExceptions(teamSeasons, seasons, exceptionOverrides);
const picks = buildPicks(pickOverrides, officialDraftOrder);
const maxContracts = buildMaxContracts(seasons);

const payload = {
  schema_version: CAP_TRACKER_SCHEMA_VERSION,
  generated_at: new Date().toISOString(),
  source_policy: "Source-tagged cap tracker v1: contract salaries and option labels come from local public-source exports; cap holds and standard exceptions are CBA-derived estimates unless override rows are present; dead money, TPEs, and future pick obligations are override-first.",
  notes: [
    "Season years use NBA season end year: 2026 is 2025-26, 2027 is 2026-27, and so on.",
    "Known contract salaries are kept separate from cap holds, draft placeholders, dead money, roster charges, and exceptions so uncertainty is visible.",
    "The local Dunc'd On workbook captures are SharePoint/HTML viewer files and are not read as workbook data.",
    "Override CSVs in ref/ can promote estimated or unavailable items to source-tagged exact rows."
  ],
  seasons,
  teams: teamMeta,
  team_seasons: teamSeasons,
  contracts: contractRows,
  exceptions,
  picks,
  dead_money: deadMoney,
  max_contracts: maxContracts,
  validation_summary: {
    duplicate_contract_ids: 0,
    duplicate_team_seasons: 0,
    duplicate_dead_money_rows: 0,
    team_season_rows_expected: teamMeta.length * YEARS.length,
    team_season_rows_actual: teamSeasons.length
  },
  warnings: [
    ...deadMoneyBuild.warnings,
    ...projectedSystemLevelWarnings(seasons)
  ],
  source_audit: [
    { label: "Contract salaries", detail: CONTRACT_SOURCE, quality: "contract" },
    { label: "Option labels", detail: "Basketball-Reference option cell classes override blank/ambiguous contract statuses.", quality: "bref-option" },
    { label: "Cap levels", detail: "Local salary_cap_assumptions.csv, with missing tax/floor values projected from nearby cap ratios.", quality: "projected" },
    { label: "Cap holds", detail: "ref/cap_tracker_cap_holds.csv when present; otherwise salary-based CBA-style estimates from prior salary and rights source.", quality: "estimated" },
    { label: "Draft placeholders", detail: "2026 first-round picks become synthetic rookie-scale salary rows from ref/cap_tracker_rookie_scale.csv.", quality: "projected" },
    { label: "Dead money, TPEs, future picks", detail: "Override-first; absent override rows are shown as unavailable rather than fabricated.", quality: "override" },
    { label: "CBA reference", detail: CBA_SOURCE, quality: "estimated" }
  ]
};

validatePayload(payload);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
updateManifest(manifestPath, payload);
console.log(`Wrote ${outPath}`);
console.log(`Teams: ${payload.teams.length}; team seasons: ${payload.team_seasons.length}; contracts: ${payload.contracts.length}`);

function buildSeasons(rows) {
  const byYear = new Map(rows.map((row) => [numberValue(row.year), row]));
  return YEARS.map((year) => {
    const row = byYear.get(year) ?? {};
    const cap = numberValue(row.salary_cap) ?? projectedCap(year, byYear);
    const tax = numberValue(row.tax_level) ?? projectedTaxLevel(cap);
    const firstApron = numberValue(row.first_apron) ?? projectedFirstApron(cap, rows);
    const secondApron = numberValue(row.second_apron) ?? projectedSecondApron(cap, rows);
    const hasCap = Boolean(numberValue(row.salary_cap));
    const hasTax = Boolean(numberValue(row.tax_level));
    const hasFirstApron = Boolean(numberValue(row.first_apron));
    const hasSecondApron = Boolean(numberValue(row.second_apron));
    return cleanObject({
      year,
      label: seasonLabel(year),
      salary_cap: Math.round(cap),
      tax_level: Math.round(tax),
      first_apron: Math.round(firstApron),
      second_apron: Math.round(secondApron),
      salary_floor: salaryFloor(cap),
      minimum_roster_charge: minimumRosterCharge(cap),
      source: row.source || "Projected from local cap assumptions",
      source_quality: systemLevelSourceQuality(row, hasCap, hasTax, hasFirstApron, hasSecondApron)
    });
  });
}

function projectedCap(year, byYear) {
  for (let prior = year - 1; prior >= START_YEAR; prior -= 1) {
    const cap = numberValue(byYear.get(prior)?.salary_cap);
    if (cap) return Math.round(cap * Math.pow(1.05, year - prior));
  }
  return 166_000_000 * Math.pow(1.05, year - 2027);
}

function buildPlayerMeta(rows, latestYear) {
  const seasonRows = rows.filter((row) => numberValue(row.year) === latestYear);
  const ranked = [...seasonRows].sort((a, b) => finiteNumber(b.score) - finiteNumber(a.score));
  const rankById = new Map(ranked.map((row, index) => [String(row.nba_id), index + 1]));
  const byId = new Map();
  const byName = new Map();
  for (const row of seasonRows) {
    const meta = {
      nba_id: numberValue(row.nba_id),
      player_name: row.player_name,
      team: cleanTeam(row.current_roster_team || row.team),
      position: row.position || null,
      age: numberValue(row.age),
      rank: rankById.get(String(row.nba_id)) ?? null,
      market_value: finiteNumber(row.fa_value, row.value, row.contract),
      cap_hold: numberValue(row.cap_hold),
      cap_hold_type: row.cap_hold_type || null,
      bird_rights: row.bird_rights || null
    };
    if (meta.nba_id) byId.set(String(meta.nba_id), meta);
    byName.set(normalizeName(meta.player_name), meta);
  }
  return { byId, byName };
}

function buildTeamMeta(rows, latestYear) {
  const seasonRows = rows.filter((row) => numberValue(row.year) === latestYear && (row.scenario_id || "base") === "base");
  const fallbackRows = seasonRows.length ? seasonRows : rows.filter((row) => numberValue(row.year) === latestYear);
  const byTeam = new Map();
  for (const row of fallbackRows) {
    const team = cleanTeam(row.team);
    if (!team || team === "FA" || byTeam.has(team)) continue;
    byTeam.set(team, cleanObject({
      team,
      team_name: row.team_name || team,
      team_abbr: row.team_abbr || team,
      conference: row.conference || null,
      team_logo_url: row.team_logo_url || null
    }));
  }
  return Array.from(byTeam.values()).sort((a, b) => a.team.localeCompare(b.team));
}

function mergeContractSources(primaryRows, brefRows) {
  const brefById = new Map();
  const brefByName = new Map();
  for (const row of brefRows) {
    const id = stringValue(row.nba_id);
    if (id) brefById.set(id, row);
    brefByName.set(`${normalizeName(row.player_name)}||${cleanTeam(row.team)}`, row);
  }
  const merged = [];
  const seen = new Set();
  for (const row of primaryRows) {
    const id = stringValue(row.nba_id);
    const bref = (id && brefById.get(id)) || brefByName.get(`${normalizeName(row.player_name)}||${cleanTeam(row.team)}`) || {};
    merged.push({ ...row, _bref: bref });
    if (id) seen.add(id);
  }
  for (const row of brefRows) {
    const id = stringValue(row.nba_id);
    if (id && seen.has(id)) continue;
    merged.push({ ...row, _bref: row, source: row.source || "Basketball-Reference contracts table" });
  }
  return mergeDuplicateContractSources(merged);
}

function buildContractRows(rows, playerMeta, holdMap, guaranteeMap, seasonRows, deadSuppressions) {
  const out = [];
  for (const row of rows) {
    const nbaId = numberValue(row.nba_id);
    const meta = (nbaId && playerMeta.byId.get(String(nbaId))) || playerMeta.byName.get(normalizeName(row.player_name));
    const team = cleanTeam(row.team || meta?.team);
    if (!team || team === "FA") continue;
    const cells = [];
    for (const year of YEARS) {
      const horizon = year - START_YEAR;
      let cell = emptyCell(year);
      if (horizon >= 0 && horizon <= 4) {
        const amount = numberValue(row[`salary_y${horizon}`], row._bref?.[`salary_y${horizon}`]);
        if (amount && amount > 0) {
          const status = statusForHorizon(row, horizon);
          const guarantee = guaranteeInfoForYear(row, year, amount, guaranteeOverrideFor(row, meta, team, year, guaranteeMap));
          cell = cleanObject({
            year,
            amount: Math.round(amount),
            kind: cellKindForStatus(status, guarantee),
            status: status || "Signed",
            source: optionStatus(status) ? "bref-option" : "contract",
            note: optionStatus(status) ? "Option marker from Basketball-Reference contract cell" : null,
            ...guarantee
          });
        }
      }
      const hold = holdForYear(row, year, meta, holdMap, seasonRows);
      if (cell.kind === "empty" && hold.amount > 0) {
        cell = cleanObject({
          year,
          amount: Math.round(hold.amount),
          kind: "cap_hold",
          status: hold.status,
          source: hold.source,
          label: hold.label || null,
          note: hold.note
        });
      }
      const suppressedByDeadMoney = deadMoneySuppressionFor(row, meta, team, year, cell, deadSuppressions);
      if (suppressedByDeadMoney) {
        cell = cleanObject({
          year,
          amount: 0,
          kind: "empty",
          status: "Superseded by dead money",
          source: "override",
          note: `Active contract source suppressed by dead-money override: ${suppressedByDeadMoney.note || suppressedByDeadMoney.source || "dead money"}`
        });
      }
      cells.push(cell);
    }
    if (!cells.some((cell) => cell.amount > 0)) continue;
    out.push(cleanObject({
      id: canonicalContractRowId(row, team),
      canonical_key: canonicalContractRowId(row, team),
      nba_id: nbaId ?? null,
      player_name: row.player_name || meta?.player_name || "Unknown Player",
      team,
      row_type: "player",
      display_order: meta?.rank ?? numberValue(row.rank) ?? 9999,
      position: meta?.position ?? null,
      age: meta?.age ?? null,
      rank: meta?.rank ?? numberValue(row.rank) ?? null,
      contract_notes: row.contract_notes || null,
      source: row.source || CONTRACT_SOURCE,
      source_quality: "contract",
      cells
    }));
  }
  return out;
}

function contractRowSort(a, b) {
  return a.team.localeCompare(b.team)
    || (a.display_order ?? 9999) - (b.display_order ?? 9999)
    || a.player_name.localeCompare(b.player_name);
}

function statusForHorizon(row, horizon) {
  const brefStatus = normalizeStatus(row._bref?.[`contract_status_y${horizon}`]);
  const primaryStatus = normalizeStatus(row[`contract_status_y${horizon}`]);
  return optionStatus(brefStatus) ? brefStatus : primaryStatus || brefStatus || "Signed";
}

function cellKindForStatus(status, guarantee = null) {
  if (status === "Player Option") return "player_option";
  if (status === "Team Option") return "team_option";
  if (status === "Non-Guaranteed") return "non_guaranteed";
  if (guarantee && guarantee.unguaranteed_amount > 0) return guarantee.guaranteed_amount > 0 ? "partial_guarantee" : "non_guaranteed";
  return "guaranteed";
}

function holdForYear(row, year, meta, holdMap, seasonRows) {
  const team = cleanTeam(row.team || meta?.team);
  const overrideKey = holdKeys(row, meta, team, year).find((key) => holdMap.has(key));
  if (overrideKey) {
    const hold = holdMap.get(overrideKey);
    return {
      amount: numberValue(hold.amount) ?? 0,
      status: normalizeStatus(hold.status) || normalizeStatus(row.free_agent_status) || "UFA",
      source: "override",
      label: "Hold",
      note: hold.note || hold.source || "Manual cap-hold override"
    };
  }
  const timing = holdTimingForRow(row);
  if (timing.year !== year) return { amount: 0, status: "UFA", source: "unavailable", label: null, note: null };
  const rights = birdRights(row.signed_using, row.free_agent_status, meta?.bird_rights);
  if (rights === "None") return { amount: 0, status: "UFA", source: "unavailable", label: null, note: null };
  const status = normalizeStatus(row.free_agent_status) === "RFA" ? "RFA" : "UFA";
  const previousSalary = previousSalaryForYear(row, year);
  const season = seasonRows.find((item) => item.year === year);
  const estimated = estimatedCapHold(status, rights, previousSalary, row, season);
  const label = timing.ambiguous ? "Option/Hold" : "Hold";
  return {
    amount: estimated,
    status: timing.ambiguous ? "Option/Hold" : status,
    source: "estimated",
    label,
    note: [
      timing.note,
      `Estimated ${status} ${rights} cap hold from prior salary; market-value inflation is not used`
    ].filter(Boolean).join(" ")
  };
}

function holdKeys(row, meta, team, year) {
  const keys = [`${team}||${year}||name:${normalizeName(row.player_name || meta?.player_name)}`];
  const id = stringValue(row.nba_id || meta?.nba_id);
  if (id) keys.push(`${team}||${year}||id:${id}`);
  return keys;
}

function buildHoldOverrideMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const team = cleanTeam(row.team);
    const year = numberValue(row.year);
    if (!team || !year) continue;
    const id = stringValue(row.nba_id);
    if (id) map.set(`${team}||${year}||id:${id}`, row);
    if (row.player_name) map.set(`${team}||${year}||name:${normalizeName(row.player_name)}`, row);
  }
  return map;
}

function buildGuaranteeOverrideMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const team = cleanTeam(row.team);
    const year = numberValue(row.year);
    if (!team || !year) continue;
    const id = stringValue(row.nba_id);
    if (id) map.set(`${team}||${year}||id:${id}`, row);
    if (row.player_name) map.set(`${team}||${year}||name:${normalizeName(row.player_name)}`, row);
  }
  return map;
}

function guaranteeOverrideFor(row, meta, team, year, guaranteeMap) {
  const id = stringValue(row.nba_id || meta?.nba_id);
  if (id && guaranteeMap.has(`${team}||${year}||id:${id}`)) return guaranteeMap.get(`${team}||${year}||id:${id}`);
  const name = normalizeName(row.player_name || meta?.player_name);
  if (name && guaranteeMap.has(`${team}||${year}||name:${name}`)) return guaranteeMap.get(`${team}||${year}||name:${name}`);
  return null;
}

function holdTimingForRow(row) {
  const optionYear = unresolvedOptionYear(row);
  if (optionYear) {
    return {
      year: optionYear,
      ambiguous: true,
      note: "Contract note references an option season with no salary column; shown in the option offseason instead of delaying the hold."
    };
  }
  const salaryYear = firstMissingYearAfterSalary(row);
  if (salaryYear) return { year: salaryYear, ambiguous: false, note: null };
  const freeAgentYear = numberValue(row.free_agent_year);
  return { year: freeAgentYear ? freeAgentYear + 1 : null, ambiguous: false, note: null };
}

function unresolvedOptionYear(row) {
  const text = `${row.contract_notes ?? ""} ${row.notes ?? ""}`;
  const match = text.match(/(20\d{2})-(\d{2}).{0,28}(club option|team option|player option|option)/i);
  if (!match) return null;
  const endYear = Number(`20${match[2]}`);
  if (!Number.isFinite(endYear)) return null;
  const horizon = endYear - START_YEAR;
  const salary = numberValue(row[`salary_y${horizon}`], row._bref?.[`salary_y${horizon}`]);
  if (horizon >= 0 && horizon <= 4 && !salary) return endYear;
  return null;
}

function firstMissingYearAfterSalary(row) {
  let lastSalaryYear = null;
  for (let horizon = 0; horizon <= 4; horizon += 1) {
    const amount = numberValue(row[`salary_y${horizon}`], row._bref?.[`salary_y${horizon}`]);
    if (amount && amount > 0) lastSalaryYear = START_YEAR + horizon;
  }
  return lastSalaryYear ? lastSalaryYear + 1 : null;
}

function previousSalaryForYear(row, year) {
  const horizon = year - START_YEAR - 1;
  if (horizon >= 0) {
    const prior = numberValue(row[`salary_y${horizon}`], row._bref?.[`salary_y${horizon}`]);
    if (prior) return prior;
  }
  for (let index = Math.min(4, year - START_YEAR); index >= 0; index -= 1) {
    const amount = numberValue(row[`salary_y${index}`], row._bref?.[`salary_y${index}`]);
    if (amount) return amount;
  }
  return 2_500_000;
}

function estimatedCapHold(status, rights, previousSalary, row, season) {
  return cbaCapHoldAmount({
    status,
    rights,
    previousSalary,
    isRookieScale: rookieScaleSource(row),
    season
  });
}

function rookieScaleSource(row) {
  const text = `${row.signed_using ?? ""} ${row.contract_type ?? ""} ${row.contract_notes ?? ""}`.toLowerCase();
  return text.includes("rookie") || text.includes("1st round") || text.includes("first round");
}

function buildDeadMoney(rows) {
  const built = rows
    .map((row, index) => {
      const amount = numberValue(row.amount);
      if (!amount) return null;
      const team = cleanTeam(row.team);
      const year = numberValue(row.year);
      const canonical_key = row.event_key || row.transaction_key || `${team}-${year}-${normalizeName(row.player_name)}-${amount}-${normalizeName(row.note || "")}`;
      return cleanObject({
        id: `dead-${canonical_key}-${index}`,
        canonical_key,
        event_key: row.event_key || null,
        transaction_key: row.transaction_key || null,
        effective_date: row.effective_date || null,
        team,
        year,
        player_name: row.player_name,
        amount: Math.round(amount),
        note: row.note || null,
        source: row.source || "Manual dead-money override",
        source_quality: normalizeMoneySource(row.source_quality) || "override"
      });
    })
    .filter(Boolean);
  return dedupeDeadMoneyRows(built);
}

function buildDeadMoneySuppressions(rows) {
  const byExactYear = new Map();
  const cutoffByPlayerTeam = new Map();
  for (const row of rows) {
    const team = cleanTeam(row.team);
    const year = numberValue(row.year);
    const player = normalizeName(row.player_name);
    if (!team || !year || !player) continue;

    const exactKey = deadMoneySuppressionKey(team, year, player);
    if (!byExactYear.has(exactKey)) byExactYear.set(exactKey, row);

    const playerTeamKey = deadMoneyPlayerTeamKey(team, player);
    const existing = cutoffByPlayerTeam.get(playerTeamKey);
    if (!existing || year < existing.year || (year === existing.year && deadMoneyRowRemovesActiveContract(row) && !deadMoneyRowRemovesActiveContract(existing.row))) {
      cutoffByPlayerTeam.set(playerTeamKey, { year, row });
    }
  }
  return { byExactYear, cutoffByPlayerTeam };
}

function deadMoneyRowRemovesActiveContract(row) {
  const note = String(row.note ?? "").toLowerCase();
  if (note.includes("exp. 10-day") || note.includes("expired 10-day")) return false;
  return true;
}

function deadMoneySuppressionFor(row, meta, team, year, cell, suppressions) {
  if (!cell || !cell.amount || !deadMoneySuppressibleCell(cell)) return null;
  const names = new Set([
    normalizeName(row.player_name),
    normalizeName(meta?.player_name)
  ].filter(Boolean));
  for (const name of names) {
    const exact = suppressions.byExactYear.get(deadMoneySuppressionKey(team, year, name));
    if (exact) return exact;
    const cutoff = suppressions.cutoffByPlayerTeam.get(deadMoneyPlayerTeamKey(team, name));
    if (!cutoff || year < cutoff.year) continue;
    if (deadMoneyRowRemovesActiveContract(cutoff.row)) return cutoff.row;
    if (year > cutoff.year && cell.kind === "cap_hold") return cutoff.row;
  }
  return null;
}

function deadMoneySuppressibleCell(cell) {
  return ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed", "cap_hold"].includes(cell.kind);
}

function deadMoneySuppressionKey(team, year, playerName) {
  return `${cleanTeam(team)}||${year}||${normalizeName(playerName)}`;
}

function deadMoneyPlayerTeamKey(team, playerName) {
  return `${cleanTeam(team)}||${normalizeName(playerName)}`;
}

function buildDraftPickRows(officialPicks, scaleRows) {
  const scaleByPick = new Map(scaleRows.map((row) => [numberValue(row.pick), row]));
  return officialPicks
    .filter((pick) => pick.pick <= 30)
    .map((pick) => {
      const scale = scaleByPick.get(pick.pick);
      const firstYear = numberValue(scale?.first_year_salary);
      if (!firstYear) return null;
      const yearAmounts = new Map([
        [2027, { amount: firstYear, status: "Rookie Scale", note: scale.source }],
        [2028, { amount: numberValue(scale.second_year_salary) ?? Math.round(firstYear * 1.05), status: "Rookie Scale", note: scale.source }],
        [2029, { amount: numberValue(scale.third_year_salary) ?? Math.round(firstYear * 1.1), status: "Team Option", note: "Projected third-year rookie-scale team option" }],
        [2030, { amount: numberValue(scale.fourth_year_salary) ?? Math.round(firstYear * 1.15), status: "Team Option", note: "Projected fourth-year rookie-scale team option" }]
      ]);
      const cells = YEARS.map((year) => {
        const value = yearAmounts.get(year);
        if (value) {
          return cleanObject({
            year,
            amount: Math.round(value.amount),
            kind: "draft_pick",
            status: value.status,
            source: "projected",
            label: "Pick",
            note: value.note
            ,
            guaranteed_amount: Math.round(value.amount),
            unguaranteed_amount: 0,
            guarantee_deadline: null,
            guarantee_note: null,
            guarantee_source: "unavailable"
          });
        }
        if (year === 2031) {
          const fourthYear = yearAmounts.get(2030)?.amount ?? firstYear * 1.15;
          return cleanObject({
            year,
            amount: Math.round(fourthYear * 3),
            kind: "cap_hold",
            status: "RFA",
            source: "projected",
            label: "Hold",
            note: "Projected rookie-scale RFA hold at 300 percent of fourth-year salary"
          });
        }
        return emptyCell(year);
      });
      return cleanObject({
        id: `draft-pick-2026-${pick.pick}-${pick.team}`,
        nba_id: null,
        player_name: `2026 #${pick.pick} Pick`,
        team: pick.team,
        row_type: "draft_pick",
        display_order: 8000 + pick.pick,
        position: "Pick",
        age: null,
        rank: null,
        contract_notes: `Synthetic first-round rookie-scale placeholder for ${pick.label}`,
        source: scale?.source || "Projected 2026 rookie scale",
        source_quality: "projected",
        cells
      });
    })
    .filter(Boolean);
}

function buildDeadMoneyRows(deadRows) {
  return deadRows.map((row, index) => ({
    id: `${row.id}-row`,
    nba_id: null,
    player_name: row.player_name,
    team: row.team,
    row_type: "dead_money",
    display_order: 9000 + index,
    position: "Dead",
    age: null,
    rank: null,
    contract_notes: row.note || null,
    source: row.source,
    source_quality: row.source_quality || "override",
    cells: YEARS.map((year) => year === row.year ? cleanObject({
      year,
      amount: row.amount,
      kind: "dead",
      status: "Dead",
      source: row.source_quality || "override",
      label: "Dead",
      note: row.note || row.source
    }) : emptyCell(year))
  }));
}

function buildTeamSeasons(teamsMeta, seasonRows, contractRows, deadRows) {
  const seasonByYear = new Map(seasonRows.map((season) => [season.year, season]));
  const out = [];
  for (const team of teamsMeta) {
    for (const year of YEARS) {
      const season = seasonByYear.get(year);
      const teamContracts = contractRows.filter((row) => row.team === team.team);
      const cells = teamContracts.map((row) => row.cells.find((cell) => cell.year === year)).filter(Boolean);
      const guaranteed = sum(cells.filter((cell) => cell.kind === "guaranteed" || cell.kind === "partial_guarantee").map((cell) => cell.amount));
      const optionSalary = sum(cells.filter((cell) => cell.kind === "player_option" || cell.kind === "team_option").map((cell) => cell.amount));
      const nonGuaranteed = sum(cells.filter((cell) => cell.kind === "non_guaranteed").map((cell) => cell.amount));
      const draftPickCharges = sum(cells.filter((cell) => cell.kind === "draft_pick").map((cell) => cell.amount));
      const capHolds = sum(cells.filter((cell) => cell.kind === "cap_hold").map((cell) => cell.amount));
      const guaranteedBase = sum(cells.filter((cell) => ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.guaranteed_amount ?? cell.amount));
      const atRiskSalary = sum(cells.filter((cell) => ["partial_guarantee", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.unguaranteed_amount ?? 0));
      const salaryOnBooks = guaranteed + optionSalary + nonGuaranteed;
      const activeSalary = salaryOnBooks + draftPickCharges;
      const deadMoney = sum(deadRows.filter((row) => row.team === team.team && row.year === year).map((row) => row.amount));
      const rosterCount = cells.filter((cell) => ["guaranteed", "player_option", "team_option", "non_guaranteed", "draft_pick"].includes(cell.kind)).length;
      const holdCount = cells.filter((cell) => cell.kind === "cap_hold" && cell.amount > 0).length;
      const rosterChargesWithHolds = Math.max(0, 12 - rosterCount - holdCount) * season.minimum_roster_charge;
      const rosterChargesRenounced = Math.max(0, 12 - rosterCount) * season.minimum_roster_charge;
      const likelyBooksWithHolds = activeSalary + deadMoney + capHolds + rosterChargesWithHolds;
      const likelyBooksRenounced = activeSalary + deadMoney + rosterChargesRenounced;
      const taxSalary = salaryOnBooks + deadMoney;
      const apronSalary = salaryOnBooks + deadMoney;
      const sourceQuality = cells.some((cell) => ["cap_hold", "dead"].includes(cell.kind) && cell.source === "estimated") ? "estimated" : season.source_quality;
      out.push(cleanObject({
        team: team.team,
        year,
        guaranteed_salary: Math.round(guaranteed),
        option_salary: Math.round(optionSalary),
        non_guaranteed_salary: Math.round(nonGuaranteed),
        salary_on_books: Math.round(salaryOnBooks),
        guaranteed_base_salary: Math.round(guaranteedBase),
        at_risk_salary: Math.round(atRiskSalary),
        draft_pick_charges: Math.round(draftPickCharges),
        active_salary: Math.round(activeSalary),
        dead_money: Math.round(deadMoney),
        cap_holds: Math.round(capHolds),
        roster_charges_with_holds: Math.round(rosterChargesWithHolds),
        roster_charges_renounced: Math.round(rosterChargesRenounced),
        tax_salary: Math.round(taxSalary),
        apron_salary: Math.round(apronSalary),
        team_salary_with_holds: Math.round(likelyBooksWithHolds),
        team_salary_renounced: Math.round(likelyBooksRenounced),
        likely_books_with_holds: Math.round(likelyBooksWithHolds),
        likely_books_renounced: Math.round(likelyBooksRenounced),
        cap_room_with_holds: Math.round(season.salary_cap - likelyBooksWithHolds),
        cap_room_renounced: Math.round(season.salary_cap - likelyBooksRenounced),
        room_if_holds_retained: Math.round(season.salary_cap - likelyBooksWithHolds),
        room_if_renounced: Math.round(season.salary_cap - likelyBooksRenounced),
        tax_room: Math.round(season.tax_level - activeSalary - deadMoney),
        first_apron_room: Math.round(season.first_apron - activeSalary - deadMoney),
        second_apron_room: Math.round(season.second_apron - activeSalary - deadMoney),
        tax_room_with_holds: Math.round(season.tax_level - likelyBooksWithHolds),
        tax_room_renounced: Math.round(season.tax_level - likelyBooksRenounced),
        first_apron_room_with_holds: Math.round(season.first_apron - likelyBooksWithHolds),
        first_apron_room_renounced: Math.round(season.first_apron - likelyBooksRenounced),
        second_apron_room_with_holds: Math.round(season.second_apron - likelyBooksWithHolds),
        second_apron_room_renounced: Math.round(season.second_apron - likelyBooksRenounced),
        salary_floor_room: Math.round(likelyBooksWithHolds - season.salary_floor),
        roster_count: rosterCount,
        hold_count: holdCount,
        status_band: cbaStatusBandForAmount(likelyBooksWithHolds, season),
        status_band_with_holds: cbaStatusBandForAmount(likelyBooksWithHolds, season),
        status_band_renounced: cbaStatusBandForAmount(likelyBooksRenounced, season),
        tax_status_band: cbaStatusBandForAmount(taxSalary, season),
        apron_status_band: cbaStatusBandForAmount(apronSalary, season),
        source_quality: sourceQuality
      }));
    }
  }
  return out;
}

function buildExceptions(teamSeasons, seasonRows, overrideRows) {
  const seasonByYear = new Map(seasonRows.map((season) => [season.year, season]));
  const generated = [];
  for (const teamSeason of teamSeasons) {
    const season = seasonByYear.get(teamSeason.year);
    if (!season) continue;
    if (teamSeason.room_if_holds_retained <= 0) {
      if (teamSeason.first_apron_room_with_holds > 0) {
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Non-Taxpayer MLE", exceptionAmount("non_taxpayer_mle", season), "retained", "Over-cap path with holds retained; estimated non-taxpayer mid-level exception"));
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Bi-Annual", exceptionAmount("bi_annual", season), "retained", "Over-cap path with holds retained; estimated bi-annual exception"));
      } else if (teamSeason.second_apron_room_with_holds > 0) {
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Taxpayer MLE", exceptionAmount("taxpayer_mle", season), "retained", "Over-cap/tax path with holds retained; estimated taxpayer mid-level exception"));
      }
    }
    if (teamSeason.room_if_renounced > 0) {
      generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Room Exception", exceptionAmount("room_mle", season), "renounced", "Room path after renouncing holds; estimated CBA room exception"));
    }
  }
  const overrides = overrideRows
    .map((row, index) => {
      const amount = numberValue(row.amount);
      const team = cleanTeam(row.team);
      const year = numberValue(row.year);
      if (!amount || !team || !year) return null;
      return cleanObject({
        id: `exception-override-${team}-${year}-${normalizeName(row.name)}-${index}`,
        team,
        year,
        name: row.name,
        amount: Math.round(amount),
        path: row.path || "override",
        expires: row.expires || null,
        note: row.note || null,
        source: row.source || "Manual exception override",
        source_quality: "override"
      });
    })
    .filter(Boolean);
  return [...generated, ...overrides].sort((a, b) => a.team.localeCompare(b.team) || a.year - b.year || a.name.localeCompare(b.name));
}

function exceptionRow(team, year, name, amount, pathName, note) {
  return {
    id: `exception-${team}-${year}-${pathName}-${normalizeName(name)}`,
    team,
    year,
    name,
    amount: Math.round(amount),
    path: pathName,
    expires: null,
    note,
    source: `${CBA_SOURCE}; amount projected from local cap`,
    source_quality: "projected"
  };
}

function buildPicks(overrideRows, officialDraftOrder) {
  const official = officialDraftOrder.map((pick) => cleanObject({
    id: `pick-2026-${pick.pick}-${pick.team}`,
    team: pick.team,
    year: 2026,
    round: pick.pick <= 30 ? 1 : 2,
    label: `#${pick.pick} ${pick.label}`,
    protection: null,
    second_apron_frozen: null,
    source: "Local official 2026 draft order used by Offseason Simulator",
    source_quality: "contract"
  }));
  const overrides = overrideRows
    .map((row, index) => {
      const team = cleanTeam(row.team);
      const year = numberValue(row.year);
      const round = numberValue(row.round);
      if (!team || !year || !round || !row.label) return null;
      return cleanObject({
        id: `pick-override-${team}-${year}-${round}-${index}`,
        team,
        year,
        round,
        label: row.label,
        protection: row.protection || null,
        second_apron_frozen: booleanValue(row.second_apron_frozen ?? row.frozen_second_apron ?? row.frozen),
        source: row.source || "Manual future-pick override",
        source_quality: "override"
      });
    })
    .filter(Boolean);
  return [...official, ...overrides].sort((a, b) => a.team.localeCompare(b.team) || a.year - b.year || a.round - b.round || a.label.localeCompare(b.label));
}

function readOfficialDraftOrder() {
  if (!fs.existsSync(offseasonSimulatorPath)) return [];
  const text = fs.readFileSync(offseasonSimulatorPath, "utf8");
  const match = text.match(/const OFFICIAL_2026_DRAFT_ORDER[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  const picks = [];
  const pattern = /\{\s*pick:\s*(\d+),\s*team:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g;
  let item = pattern.exec(match[1]);
  while (item) {
    picks.push({ pick: Number(item[1]), team: item[2], label: item[3] });
    item = pattern.exec(match[1]);
  }
  return picks;
}

function buildMaxContracts(seasonRows) {
  return seasonRows.flatMap((season) => [0.25, 0.3, 0.35].map((pct) => {
    const firstYear = Math.round(season.salary_cap * pct);
    return {
      year: season.year,
      tier: `${Math.round(pct * 100)}%`,
      first_year_salary: firstYear,
      four_year_non_bird_total: Math.round(firstYear * (1 + 1.05 + 1.1 + 1.15)),
      five_year_bird_total: Math.round(firstYear * (1 + 1.08 + 1.16 + 1.24 + 1.32))
    };
  }));
}

function statusBand(amount, season) {
  if (amount > season.second_apron) return "Over 2nd Apron";
  if (amount > season.first_apron) return "1st Apron - 2nd Apron";
  if (amount > season.tax_level) return "Tax - 1st Apron";
  if (amount > season.salary_cap) return "Cap - Tax";
  return "Cap Space";
}

function birdRights(signedUsing, freeAgentStatus, metaRights) {
  const source = `${signedUsing ?? ""} ${freeAgentStatus ?? ""} ${metaRights ?? ""}`.toLowerCase();
  if (source.includes("early bird")) return "Early Bird";
  if (source.includes("non-bird") || source.includes("non bird")) return "Non-Bird";
  if (source.includes("bird") || source.includes("rfa")) return "Bird";
  return "None";
}

function optionStatus(status) {
  return status === "Player Option" || status === "Team Option";
}

function normalizeStatus(value) {
  const status = String(value ?? "").trim();
  if (!status) return "";
  const lower = status.toLowerCase();
  if (lower === "po" || lower.includes("player option")) return "Player Option";
  if (lower === "to" || lower.includes("team option")) return "Team Option";
  if (lower === "ng" || lower.includes("non-guaranteed") || lower.includes("non guaranteed")) return "Non-Guaranteed";
  if (lower === "rfa") return "RFA";
  if (lower === "ufa") return "UFA";
  if (lower === "signed") return "Signed";
  return status;
}

function normalizeMoneySource(value) {
  const source = String(value ?? "").trim().toLowerCase();
  if (["contract", "bref-option", "override", "estimated", "projected", "unavailable"].includes(source)) return source;
  return "";
}

function emptyCell(year) {
  return { year, amount: 0, kind: "empty", status: "", source: "unavailable", note: null };
}

function seasonLabel(year) {
  return `${year - 1}-${String(year).slice(2)}`;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parseCsv(fs.readFileSync(filePath, "utf8"));
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
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = values[index] ?? "";
    });
    return out;
  });
}

function updateManifest(filePath, payload) {
  if (!fs.existsSync(filePath)) return;
  const manifest = readJson(filePath, null);
  if (!manifest || !Array.isArray(manifest.datasets)) return;
  manifest.datasets = manifest.datasets.filter((row) => row.dataset !== "cap_tracker");
  manifest.datasets.push({ dataset: "cap_tracker", rows: payload.team_seasons.length, file: "cap_tracker.json" });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest)}\n`);
}

function validatePayload(payload) {
  const moneyFields = [
    "salary_cap",
    "tax_level",
    "first_apron",
    "second_apron",
    "salary_floor",
    "minimum_roster_charge",
    "guaranteed_salary",
    "option_salary",
    "non_guaranteed_salary",
    "salary_on_books",
    "draft_pick_charges",
    "active_salary",
    "dead_money",
    "cap_holds",
    "roster_charges_with_holds",
    "roster_charges_renounced",
    "tax_salary",
    "apron_salary",
    "team_salary_with_holds",
    "team_salary_renounced",
    "likely_books_with_holds",
    "likely_books_renounced",
    "cap_room_with_holds",
    "cap_room_renounced",
    "room_if_holds_retained",
    "room_if_renounced",
    "tax_room_with_holds",
    "tax_room_renounced",
    "first_apron_room_with_holds",
    "first_apron_room_renounced",
    "second_apron_room_with_holds",
    "second_apron_room_renounced"
  ];
  for (const item of [...payload.seasons, ...payload.team_seasons]) {
    for (const field of moneyFields) {
      if (field in item && !Number.isFinite(item[field])) {
        throw new Error(`Invalid cap tracker value ${field} for ${item.team ?? item.year}`);
      }
    }
  }
  const expectedTeamSeasons = payload.teams.length * YEARS.length;
  if (payload.team_seasons.length !== expectedTeamSeasons) {
    throw new Error(`Expected ${expectedTeamSeasons} team-season rows, found ${payload.team_seasons.length}`);
  }
  payload.validation_summary.team_season_rows_expected = expectedTeamSeasons;
  payload.validation_summary.team_season_rows_actual = payload.team_seasons.length;

  const duplicateContractIds = duplicates(payload.contracts.map((row) => row.id));
  payload.validation_summary.duplicate_contract_ids = duplicateContractIds.length;
  if (duplicateContractIds.length) {
    throw new Error(`Duplicate cap tracker contract ids: ${duplicateContractIds.slice(0, 8).join(", ")}`);
  }

  const duplicateTeamSeasonKeys = duplicates(payload.team_seasons.map((row) => `${row.team}||${row.year}`));
  payload.validation_summary.duplicate_team_seasons = duplicateTeamSeasonKeys.length;
  if (duplicateTeamSeasonKeys.length) {
    throw new Error(`Duplicate cap tracker team-season rows: ${duplicateTeamSeasonKeys.slice(0, 8).join(", ")}`);
  }

  const duplicateDeadRows = duplicates(payload.dead_money.map(canonicalDeadMoneyDisplayKey));
  payload.validation_summary.duplicate_dead_money_rows = duplicateDeadRows.length;
  if (duplicateDeadRows.length) {
    throw new Error(`Duplicate dead-money rows remain after canonicalization: ${duplicateDeadRows.slice(0, 8).join(", ")}`);
  }

  const rowsByTeam = new Map();
  for (const row of payload.contracts) {
    if (!rowsByTeam.has(row.team)) rowsByTeam.set(row.team, []);
    rowsByTeam.get(row.team).push(row);
  }
  const deadByTeamYear = new Map();
  const deadByTeamYearPlayer = new Map();
  for (const row of payload.dead_money) {
    const key = `${row.team}||${row.year}`;
    deadByTeamYear.set(key, (deadByTeamYear.get(key) ?? 0) + row.amount);
    deadByTeamYearPlayer.set(deadMoneySuppressionKey(row.team, row.year, row.player_name), row);
  }
  for (const teamSeason of payload.team_seasons) {
    const cells = (rowsByTeam.get(teamSeason.team) ?? [])
      .map((row) => row.cells.find((cell) => cell.year === teamSeason.year))
      .filter(Boolean);
    const groupedSalary = sum(cells.filter((cell) => ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.amount));
    const groupedPicks = sum(cells.filter((cell) => cell.kind === "draft_pick").map((cell) => cell.amount));
    const groupedHolds = sum(cells.filter((cell) => cell.kind === "cap_hold").map((cell) => cell.amount));
    if (groupedSalary !== teamSeason.salary_on_books || groupedPicks !== teamSeason.draft_pick_charges || groupedHolds !== teamSeason.cap_holds) {
      throw new Error(`Grouped totals do not match summary for ${teamSeason.team} ${teamSeason.year}`);
    }
    const dead = deadByTeamYear.get(`${teamSeason.team}||${teamSeason.year}`) ?? 0;
    if (dead !== teamSeason.dead_money) {
      throw new Error(`Dead money total does not match summary for ${teamSeason.team} ${teamSeason.year}`);
    }
    if (teamSeason.room_if_renounced > 0 && teamSeason.status_band_renounced !== "Cap Space") {
      throw new Error(`Renounced-room status band is inconsistent for ${teamSeason.team} ${teamSeason.year}`);
    }
  }
  const activeKinds = new Set(["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed", "cap_hold"]);
  for (const row of payload.contracts) {
    if (row.row_type !== "player") continue;
    for (const cell of row.cells) {
      if (!activeKinds.has(cell.kind) || !cell.amount) continue;
      const collision = deadByTeamYearPlayer.get(deadMoneySuppressionKey(row.team, cell.year, row.player_name));
      if (collision) {
        throw new Error(`Active contract row collides with dead money for ${row.team} ${cell.year} ${row.player_name}`);
      }
    }
  }
  const deadCutoffs = buildDeadMoneySuppressions(payload.dead_money).cutoffByPlayerTeam;
  for (const row of payload.contracts) {
    if (row.row_type !== "player") continue;
    const cutoff = deadCutoffs.get(deadMoneyPlayerTeamKey(row.team, row.player_name));
    if (!cutoff) continue;
    for (const cell of row.cells) {
      if (!cell.amount || !activeKinds.has(cell.kind) || cell.year < cutoff.year) continue;
      if (deadMoneyRowRemovesActiveContract(cutoff.row) || (cell.year > cutoff.year && cell.kind === "cap_hold")) {
        throw new Error(`Stale contract cell remains after dead-money cutoff for ${row.team} ${cell.year} ${row.player_name}`);
      }
    }
  }
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === undefined || Number.isNaN(item) ? null : item]));
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return Array.from(duplicate);
}

function projectedSystemLevelWarnings(seasonRows) {
  return seasonRows
    .filter((season) => season.source_quality !== "contract")
    .map((season) => `${season.label} system levels include projected cap/tax/apron inputs from ${season.source}.`);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const parsed = Number(String(value).replace(/[$,%]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["true", "t", "yes", "y", "1"].includes(text)) return true;
  if (["false", "f", "no", "n", "0"].includes(text)) return false;
  return null;
}

function finiteNumber(...values) {
  return numberValue(...values) ?? 0;
}

function maxFinite(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function median(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function stringValue(value) {
  const text = String(value ?? "").trim();
  return text && text !== "NA" ? text : "";
}

function cleanTeam(value) {
  return String(value ?? "").trim().toUpperCase() || "FA";
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
