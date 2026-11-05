import { mergeSharedContracts, capCells } from './shared_contracts.mjs';
import { retainCachedCapTeams } from "./cap_roster_fallback.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAP_TRACKER_SCHEMA_VERSION,
  canonicalContractRowId,
  cleanTeam,
  exceptionAmount,
  normalizeName,
  numberValue,
  projectedFirstApron,
  projectedSecondApron,
  projectedTaxLevel,
  salaryFloor,
  statusBandForAmount,
  stringValue,
  systemLevelSourceQuality
} from "./cap_tracker_rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const dataDir = path.join(root, "frontend", "public", "data");
const spotracDir = path.join(root, "processed", "livedata", "impactrefresh", "spotrac_allteams_no_guarantees");
const spotracWidePath = path.join(spotracDir, "spotrac_active_roster_cap_hold_allteams_wide.csv");
const spotracLongPath = path.join(spotracDir, "spotrac_active_roster_cap_hold_allteams_long.csv");
const spotracAuditPath = path.join(spotracDir, "scrape_audit.csv");
const capPath = path.join(root, "processed", "livedata", "impactrefresh", "salary_cap_assumptions.csv");
const impactPlayersPath = path.join(dataDir, "impact_players.json");
const teamProjectionsPath = path.join(dataDir, "team_projections.json");
const contractsPath = path.join(root, "processed", "livedata", "impactrefresh", "contracts_2026_current.csv");
const guaranteeOverridePath = path.join(root, "ref", "cap_tracker_guarantees.csv");
const exceptionOverridePath = path.join(root, "ref", "cap_tracker_exceptions.csv");
const hardCapOverridePath = path.join(root, "ref", "cap_tracker_hard_caps.csv");
const pickOverridePath = path.join(root, "ref", "cap_tracker_picks.csv");
const manifestPath = path.join(dataDir, "manifest.json");
const outPath = path.join(dataDir, "cap_tracker.json");
const discrepancyPath = path.join(spotracDir, "spotrac_databallr_discrepancies.csv");

const START_YEAR = 2027;
const END_YEAR = 2031;
const YEARS = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, index) => START_YEAR + index);
const SEASON_LABELS = new Map(YEARS.map((year) => [seasonLabel(year), year]));
const SOURCE = "Spotrac multi-year team cap table";

const TEAM_ABBR = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS"
};

export function buildSpotracCapTrackerData() {
  const shared = readJson(path.join(root,"processed/contracts/current.json"),null);
  const spotracRows = readCsvFile(spotracWidePath);
  if (!spotracRows.length) {
    throw new Error(`Missing Spotrac scrape rows at ${spotracWidePath}`);
  }

  const capRows = readCsvFile(capPath);
  const impactPlayers = readJson(impactPlayersPath, []);
  const teamProjectionRows = readJson(teamProjectionsPath, []);
  const databallrRows = readCsvFile(contractsPath);
  const databallrContractMeta = buildDataballrContractMetaLookup(databallrRows);
  const guaranteeOverrides = buildGuaranteeOverrideMap(readCsvFile(guaranteeOverridePath));
  const seasons = buildSeasons(capRows);
  const teamMeta = buildTeamMeta(teamProjectionRows, spotracRows);
  let contractRows = [
    ...buildContractRows(spotracRows, teamMeta, guaranteeOverrides, databallrContractMeta),
    ...buildProjectedRookieContractRows(impactPlayers)
  ].sort(contractRowSort);
  const fallbackTeams = [...new Set([
    ...spotracRows.filter((row) => row.source_url?.startsWith("https://site.api.espn.com/")).map((row) => cleanTeam(row.team_abbr || TEAM_ABBR[row.team])),
    ...readCsvFile(spotracAuditPath).filter((row) => row.status === "fresh_espn_roster_after_spotrac_error").map((row) => TEAM_ABBR[row.team] || cleanTeam(row.team))
  ])];
  const previous = readJson(outPath, null);
  let deadMoney = buildDeadMoneyRows(spotracRows);
  // ESPN verifies membership only. Seed missing cap components from the last
  // verified book before replacing every signed salary with shared terms.
  const cached = shared ? retainCachedCapTeams({ teams: fallbackTeams, previous, years: YEARS,
    contracts: contractRows, deadMoney, teamSeasons: [] }) : null;
  if (shared) {
    contractRows = mergeSharedContracts(shared, cached.contracts, YEARS, canonicalContractRowId, normalizeName).sort(contractRowSort);
    deadMoney = cached.deadMoney.map(r => ({...r, source_quality: "cached"}));
  }
  let teamSeasons = buildTeamSeasons(teamMeta, seasons, contractRows, deadMoney, shared ? spotracRows.filter(r=>r.entity_type!=="roster_charge") : spotracRows);
  const retained = shared ? { contracts: contractRows, deadMoney, teamSeasons,
    fallbacks: cached.fallbacks.map(row => ({...row, reason: "Spotrac unavailable; roster refreshed from ESPN; signed salaries refreshed from the shared agreement ledger; cap holds and dead money retain their dated sources."}))
  } : retainCachedCapTeams({ teams: fallbackTeams, previous, years: YEARS,
    contracts: contractRows, deadMoney, teamSeasons });
  contractRows = retained.contracts;
  deadMoney = retained.deadMoney;
  teamSeasons = retained.teamSeasons;
  const exceptions = buildExceptions(teamSeasons, seasons, readCsvFile(exceptionOverridePath));
  const hardCaps = buildOverrideHardCaps(readCsvFile(hardCapOverridePath));
  const picks = buildOverridePicks(readCsvFile(pickOverridePath));
  const maxContracts = buildMaxContracts(seasons);
  const discrepancyRows = buildDataballrDiscrepancies(contractRows, databallrRows);

  const warnings = [
    ...retained.fallbacks.map((row) => `${row.team}: ${row.reason} Retained source date: ${row.cached_as_of}.`),
    ...buildAuditWarnings(),
    ...projectedSystemLevelWarnings(seasons),
    shared ? "Known guarantees use the signed agreement table; missing guarantee terms remain unavailable. Two-way pay is displayed and excluded from cap payroll." : "Guarantee percentages are not scraped from Spotrac hover-only tooltips; normal active salary cells are treated as fully on-book salary unless ref/cap_tracker_guarantees.csv overrides them.",
    shared ? "Player payroll is recomputed from current signed terms. Cap-hold, dead-money and override-only rights sources are retained separately." : "Spotrac option/non-guaranteed color classes are not yet available in the persisted scrape, so v1 maps only text-visible option/non-guarantee labels."
  ];

  const payload = {
    schema_version: CAP_TRACKER_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    cap_fallbacks: retained.fallbacks,
    contract_coverage: shared?.coverage ?? null,
    contract_as_of: shared?.as_of ?? null,
    cached_cap_components: shared ? ["Cap-hold estimates", "Dead-money source rows", "Exception and pick-right overrides"] : [],
    source_policy: shared ? "Shared agreement ledger: all signed player salaries, options and guarantees use the same dated terms as Player Impact. Team payroll is recomputed, with two-way salaries excluded from cap charges. Cap holds, dead money and override-only rights retain their dated source." : "Spotrac-first cap tracker v1: pending transactions, active roster, cap holds, and visible money cells come from Spotrac multi-year team pages. Databallr contract metadata is retained for CBA rule inference and QA, but does not override displayed salary rows.",
    notes: [
      ...(shared ? ["All current signed player contracts use the complete dated agreement ledger. Cap holds and dead-money source rows remain separately identified as retained estimates."] : []),
      "Season years use NBA season end year: 2027 is 2026-27, 2028 is 2027-28, and so on.",
      "The Spotrac-powered tracker starts at 2026-27 and intentionally drops the prior 2025-26 tracker season.",
      "Guarantee percentages are hover-only on Spotrac and are not captured at scale in v1.",
      shared ? "Displayed player pay and known options use the complete shared signed-agreement ledger." : "Databallr contract metadata is preserved for CBA rule inference, but Spotrac remains the displayed salary source.",
      "Manual guarantee, pick, and exception override CSVs remain available for targeted additions."
    ],
    seasons,
    teams: teamMeta,
    team_seasons: teamSeasons,
    contracts: contractRows,
    exceptions,
    hard_caps: hardCaps,
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
    warnings,
    source_audit: [
      ...retained.fallbacks.map((row) => ({ label: `${row.team} cap snapshot`, detail: `${row.reason} As of ${row.cached_as_of}.`, quality: "cached" })),
      { label: "Player contract source", detail: shared ? `Complete dated agreement ledger: ${shared.players.length} signed players, as of ${shared.as_of}.` : "Spotrac all-team scrape: Pending Transactions, Active Roster, and Cap Hold sections.", quality: shared ? "contract" : "spotrac" },
      { label: "Guarantees", detail: shared ? "Signed agreement guarantees when known; unknown terms remain unavailable." : "Manual override only; Spotrac hover-only guarantee percentages are not scraped in v1.", quality: shared ? "contract" : "unavailable" },
      { label: "Dead money", detail: "Supported by this builder when Spotrac dead-money rows are present in the normalized input; current scrape does not include a persisted dead-money section.", quality: "unavailable" },
      { label: "Projected rookie scale", detail: "Consensus/mock first-round rookies are added from impact_players.json with salaries seeded from ref/cap_tracker_rookie_scale.csv.", quality: "projected" },
      { label: "Contract metadata", detail: "Databallr contract_type, signed_using, and free-agent status are retained for trade-machine CBA rule inference only.", quality: "contract" },
      { label: "Databallr comparison", detail: `QA discrepancy report written to ${path.relative(root, discrepancyPath)}`, quality: "spotrac" },
      { label: "Cap levels", detail: "Existing salary_cap_assumptions.csv is retained until Spotrac summary rows are persisted.", quality: "projected" }
    ]
  };

  validatePayload(payload);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeCsvFile(discrepancyPath, discrepancyRows, [
    "team",
    "player_name",
    "year",
    "spotrac_amount",
    "databallr_amount",
    "delta",
    "spotrac_status",
    "source_url"
  ]);
  updateManifest(manifestPath, payload);
  console.log(`Wrote ${outPath}`);
  console.log(`Teams: ${payload.teams.length}; team seasons: ${payload.team_seasons.length}; contracts: ${payload.contracts.length}`);
  console.log(`Databallr QA discrepancies: ${discrepancyRows.length}`);
  return payload;
}

function buildSeasons(rows) {
  const byYear = new Map(rows.map((row) => [numberValue(row.year), row]));
  return YEARS.map((year) => {
    const row = byYear.get(year) ?? {};
    const cap = numberValue(row.salary_cap) ?? projectedCap(year, byYear);
    const tax = numberValue(row.tax_level) ?? projectedTaxLevel(cap);
    const firstApron = numberValue(row.first_apron) ?? projectedFirstApron(cap, rows);
    const secondApron = numberValue(row.second_apron) ?? projectedSecondApron(cap, rows);
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
      source_quality: systemLevelSourceQuality(row, Boolean(row.salary_cap), Boolean(row.tax_level), Boolean(row.first_apron), Boolean(row.second_apron))
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

function buildTeamMeta(teamProjectionRows, spotracRows) {
  const latestYear = Math.max(...teamProjectionRows.map((row) => numberValue(row.year)).filter(Number.isFinite), 0);
  const byAbbr = new Map();
  for (const row of teamProjectionRows) {
    if (numberValue(row.year) !== latestYear || (row.scenario_id || "base") !== "base") continue;
    const team = cleanTeam(row.team);
    if (!team || team === "FA" || byAbbr.has(team)) continue;
    byAbbr.set(team, cleanObject({
      team,
      team_name: row.team_name || team,
      team_abbr: row.team_abbr || team,
      conference: row.conference || null,
      team_logo_url: row.team_logo_url || null
    }));
  }

  const seenFullNames = new Set(spotracRows.map((row) => row.team).filter(Boolean));
  return Array.from(seenFullNames)
    .map((fullName) => {
      const abbr = TEAM_ABBR[fullName] || cleanTeam(fullName);
      const meta = byAbbr.get(abbr);
      return cleanObject({
        team: abbr,
        team_name: meta?.team_name || fullName,
        team_abbr: meta?.team_abbr || abbr,
        conference: meta?.conference || null,
        team_logo_url: meta?.team_logo_url || null
      });
    })
    .sort((a, b) => a.team.localeCompare(b.team));
}

function buildContractRows(rows, teamMeta, guaranteeOverrides, databallrContractMeta) {
  const teamSet = new Set(teamMeta.map((row) => row.team));
  const byPlayer = new Map();
  for (const row of rows) {
    const team = TEAM_ABBR[row.team] || cleanTeam(row.team);
    if (!teamSet.has(team)) continue;
    if (row.entity_type === "roster_charge") continue;
    if (row.section === "Dead Money") continue;
    const playerName = row.player_or_entity;
    if (!playerName) continue;
    const key = `${team}||${normalizeName(playerName)}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        team,
        player_name: playerName,
        position: row.pos || null,
        age: numberValue(row.age),
        source_url: row.source_url,
        raw_sections: new Set(),
        cellByYear: new Map()
      });
    }
    const merged = byPlayer.get(key);
    merged.raw_sections.add(row.section);
    if (!merged.position && row.pos) merged.position = row.pos;
    if (!merged.age && numberValue(row.age)) merged.age = numberValue(row.age);
    for (const [label, year] of SEASON_LABELS) {
      const text = row[label] || "";
      if (!text.trim()) continue;
      const candidate = cellFromSpotracText(text, row.section, year, row, guaranteeOverrides);
      const prior = merged.cellByYear.get(year);
      if (!prior || cellPriority(candidate) > cellPriority(prior)) {
        merged.cellByYear.set(year, candidate);
      }
    }
  }

  return Array.from(byPlayer.values())
    .map((row, index) => {
      const synthetic = { player_name: row.player_name, team: row.team };
      const cells = YEARS.map((year) => row.cellByYear.get(year) || emptyCell(year));
      const spotracNote = `Spotrac sections: ${Array.from(row.raw_sections).join(", ")}`;
      const databallrMeta = databallrContractMeta.get(`${row.team}||${normalizeName(row.player_name)}`);
      const databallrNote = databallrMeta?.contract_notes;
      return cleanObject({
        id: canonicalContractRowId(synthetic, row.team),
        nba_id: numberValue(databallrMeta?.nba_id),
        player_name: row.player_name,
        team: row.team,
        row_type: "player",
        display_order: index + 1,
        position: row.position,
        age: row.age,
        rank: null,
        contract_type: databallrMeta?.contract_type ?? null,
        contract_status_source: databallrMeta?.contract_status_source ?? null,
        signed_using: databallrMeta?.signed_using ?? null,
        free_agent_status: databallrMeta?.free_agent_status ?? null,
        free_agent_year: numberValue(databallrMeta?.free_agent_year),
        contract_notes: databallrNote ? `${spotracNote}; Databallr notes: ${databallrNote}` : spotracNote,
        source: row.source_url || SOURCE,
        source_quality: "spotrac",
        cells
      });
    })
    .filter((row) => row.cells.some((cell) => cell.amount > 0))
    .sort(contractRowSort);
}

function buildDataballrContractMetaLookup(rows) {
  const out = new Map();
  for (const row of rows) {
    const team = cleanTeam(row.team);
    const name = normalizeName(row.player_name);
    if (!team || !name) continue;
    const key = `${team}||${name}`;
    const prior = out.get(key);
    const meta = cleanObject({
      nba_id: numberValue(row.nba_id),
      databallr_player_id: numberValue(row.databallr_player_id),
      contract_type: stringValue(row.contract_type) || null,
      contract_status_source: stringValue(row.contract_status_source) || null,
      signed_using: stringValue(row.signed_using) || null,
      free_agent_status: stringValue(row.free_agent_status) || null,
      free_agent_year: numberValue(row.free_agent_year),
      contract_notes: stringValue(row.contract_notes) || null
    });
    if (!prior) {
      out.set(key, meta);
      continue;
    }
    out.set(key, {
      ...prior,
      ...Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== null && value !== "")),
      contract_notes: mergeDataballrNotes(prior.contract_notes, meta.contract_notes)
    });
  }
  return out;
}

function mergeDataballrNotes(left, right) {
  if (!left) return right || null;
  if (!right || left.includes(right)) return left;
  return `${left} | ${right}`;
}

function buildProjectedRookieContractRows(players) {
  if (!Array.isArray(players) || !players.length) return [];
  return players
    .filter((row) => numberValue(row.year) === START_YEAR)
    .filter((row) => row.availability_status === "rookie_projection")
    .filter((row) => numberValue(row.contract) > 0)
    .map((row, index) => {
      const team = cleanTeam(row.team_projection_base || row.current_roster_team || row.team);
      if (!team || team === "FA") return null;
      const yearAmount = new Map([
        [START_YEAR, { amount: numberValue(row.contract), kind: "draft_pick", status: "Rookie Scale" }],
        [START_YEAR + 1, { amount: numberValue(row.projection_contract_y1), kind: "draft_pick", status: "Rookie Scale" }],
        [START_YEAR + 2, { amount: numberValue(row.projection_contract_y2), kind: "draft_pick", status: "Team Option" }],
        [START_YEAR + 3, { amount: numberValue(row.projection_contract_y3), kind: "draft_pick", status: "Team Option" }],
        [START_YEAR + 4, { amount: numberValue(row.projection_contract_y4), kind: "cap_hold", status: "RFA" }]
      ]);
      const cells = YEARS.map((year) => {
        const value = yearAmount.get(year);
        if (!value?.amount) return emptyCell(year);
        return cleanObject({
          year,
          amount: Math.round(value.amount),
          kind: value.kind,
          status: value.status,
          source: "projected",
          label: value.kind === "cap_hold" ? "Hold" : "Pick",
          note: value.kind === "cap_hold" ? "Projected rookie-scale RFA hold at 300 percent of fourth-year salary" : "Projected consensus/mock rookie-scale contract",
          guaranteed_amount: value.kind === "cap_hold" ? null : Math.round(value.amount),
          unguaranteed_amount: value.kind === "cap_hold" ? null : 0,
          guarantee_deadline: null,
          guarantee_note: null,
          guarantee_source: "unavailable"
        });
      });
      return cleanObject({
        id: `projected-rookie-${normalizeName(row.player_name)}-${team}`,
        nba_id: numberValue(row.nba_id),
        player_name: row.player_name,
        team,
        row_type: "draft_pick",
        display_order: 8000 + index,
        position: row.position || "Pick",
        age: numberValue(row.age),
        rank: null,
        contract_notes: "Projected first-round rookie-scale contract from consensus/mock rank",
        source: "impact_players.json rookie projection; ref/cap_tracker_rookie_scale.csv",
        source_quality: "projected",
        cells
      });
    })
    .filter(Boolean);
}

function cellFromSpotracText(text, section, year, row, guaranteeOverrides) {
  const amount = parseMoney(text);
  if (!amount) {
    return emptyCell(year);
  }
  const status = statusFromText(text, section);
  const kind = kindFromStatus(status, section, text);
  const override = guaranteeOverrideFor(row, year, guaranteeOverrides);
  const guarantee = guaranteeForAmount(amount, kind, override);
  return cleanObject({
    year,
    amount,
    kind,
    status,
    source: "spotrac",
    label: kind === "cap_hold" ? "Hold" : null,
    note: text,
    ...guarantee
  });
}

function kindFromStatus(status, section, text) {
  if (section === "Cap Hold" || status === "UFA" || status === "RFA") return "cap_hold";
  if (/player option/i.test(text)) return "player_option";
  if (/(team|club) option/i.test(text)) return "team_option";
  if (/non[- ]guaranteed/i.test(text)) return "non_guaranteed";
  return "guaranteed";
}

function statusFromText(text, section) {
  if (/\bRFA\b/i.test(text)) return "RFA";
  if (/\bUFA\b/i.test(text)) return "UFA";
  if (/player option/i.test(text)) return "Player Option";
  if (/(team|club) option/i.test(text)) return "Team Option";
  if (/non[- ]guaranteed/i.test(text)) return "Non-Guaranteed";
  if (/two-way/i.test(text)) return "Two-Way";
  if (section === "Cap Hold") return "Cap Hold";
  return "Signed";
}

function guaranteeForAmount(amount, kind, override) {
  const overrideAmount = numberValue(override?.guaranteed_amount);
  if (override && overrideAmount !== null) {
    return {
      guaranteed_amount: Math.max(0, Math.min(amount, Math.round(overrideAmount))),
      unguaranteed_amount: Math.max(0, amount - Math.round(overrideAmount)),
      guarantee_deadline: override.guarantee_deadline || null,
      guarantee_note: override.note || override.source || "Manual guarantee override",
      guarantee_source: "override"
    };
  }
  if (kind === "cap_hold") {
    return {
      guaranteed_amount: null,
      unguaranteed_amount: null,
      guarantee_deadline: null,
      guarantee_note: null,
      guarantee_source: "unavailable"
    };
  }
  return {
    guaranteed_amount: amount,
    unguaranteed_amount: 0,
    guarantee_deadline: null,
    guarantee_note: null,
    guarantee_source: "unavailable"
  };
}

function cellPriority(cell) {
  if (!cell || !cell.amount) return 0;
  if (cell.kind === "guaranteed") return 4;
  if (["player_option", "team_option", "non_guaranteed"].includes(cell.kind)) return 3;
  if (cell.kind === "cap_hold") return 2;
  return 1;
}

function buildDeadMoneyRows(rows) {
  return rows
    .filter((row) => row.section === "Dead Money" && row.entity_type !== "roster_charge")
    .flatMap((row, index) => {
      const team = TEAM_ABBR[row.team] || cleanTeam(row.team);
      return YEARS.map((year) => {
        const amount = parseMoney(row[seasonLabel(year)]);
        if (!amount) return null;
        return cleanObject({
          id: `spotrac-dead-${team}-${normalizeName(row.player_or_entity)}-${year}-${index}`,
          canonical_key: `${team}||${year}||${normalizeName(row.player_or_entity)}||${amount}`,
          event_key: null,
          transaction_key: null,
          effective_date: null,
          team,
          year,
          player_name: row.player_or_entity,
          amount,
          note: row.raw_row_text || null,
          source: row.source_url || SOURCE,
          source_quality: "spotrac"
        });
      }).filter(Boolean);
    });
}

function buildTeamSeasons(teamsMeta, seasons, contractRows, deadRows, spotracRows) {
  const seasonByYear = new Map(seasons.map((season) => [season.year, season]));
  const rosterCharges = buildRosterChargeMap(spotracRows);
  const out = [];
  for (const team of teamsMeta) {
    for (const year of YEARS) {
      const season = seasonByYear.get(year);
      const teamContracts = contractRows.filter((row) => row.team === team.team);
      const cells = capCells(teamContracts,year);
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
      const rosterCount = cells.filter((cell) => ["guaranteed", "player_option", "team_option", "non_guaranteed", "draft_pick"].includes(cell.kind) && cell.amount > 0).length;
      const holdCount = cells.filter((cell) => cell.kind === "cap_hold" && cell.amount > 0).length;
      const spotracRosterCharge = rosterCharges.get(`${team.team}||${year}`);
      const rosterChargesWithHolds = spotracRosterCharge ?? Math.max(0, 12 - rosterCount - holdCount) * season.minimum_roster_charge;
      const rosterChargesRenounced = Math.max(0, 12 - rosterCount) * season.minimum_roster_charge;
      const likelyBooksWithHolds = activeSalary + deadMoney + capHolds + rosterChargesWithHolds;
      const likelyBooksRenounced = activeSalary + deadMoney + rosterChargesRenounced;
      const taxSalary = salaryOnBooks + deadMoney;
      const apronSalary = salaryOnBooks + deadMoney;
      out.push(cleanObject({
        team: team.team,
        year,
        guaranteed_salary: Math.round(guaranteed),
        guaranteed_base_salary: Math.round(guaranteedBase),
        at_risk_salary: Math.round(atRiskSalary),
        option_salary: Math.round(optionSalary),
        non_guaranteed_salary: Math.round(nonGuaranteed),
        salary_on_books: Math.round(salaryOnBooks),
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
        tax_room: Math.round(season.tax_level - likelyBooksWithHolds),
        first_apron_room: Math.round(season.first_apron - likelyBooksWithHolds),
        second_apron_room: Math.round(season.second_apron - likelyBooksWithHolds),
        tax_room_with_holds: Math.round(season.tax_level - likelyBooksWithHolds),
        tax_room_renounced: Math.round(season.tax_level - likelyBooksRenounced),
        first_apron_room_with_holds: Math.round(season.first_apron - likelyBooksWithHolds),
        first_apron_room_renounced: Math.round(season.first_apron - likelyBooksRenounced),
        second_apron_room_with_holds: Math.round(season.second_apron - likelyBooksWithHolds),
        second_apron_room_renounced: Math.round(season.second_apron - likelyBooksRenounced),
        salary_floor_room: Math.round(season.salary_floor - likelyBooksWithHolds),
        roster_count: rosterCount,
        hold_count: holdCount,
        status_band: statusBandForAmount(likelyBooksWithHolds, season),
        status_band_with_holds: statusBandForAmount(likelyBooksWithHolds, season),
        status_band_renounced: statusBandForAmount(likelyBooksRenounced, season),
        tax_status_band: likelyBooksWithHolds > season.tax_level ? "Tax" : "No Tax",
        apron_status_band: statusBandForAmount(apronSalary, season),
        source_quality: "spotrac"
      }));
    }
  }
  return out;
}

function buildRosterChargeMap(rows) {
  const out = new Map();
  for (const row of rows) {
    if (row.entity_type !== "roster_charge") continue;
    const team = TEAM_ABBR[row.team] || cleanTeam(row.team);
    for (const [label, year] of SEASON_LABELS) {
      const amount = parseMoney(row[label]);
      if (amount) out.set(`${team}||${year}`, amount);
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
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Non-Taxpayer MLE", exceptionAmount("non_taxpayer_mle", season), "retained", "Over-cap path with holds retained; projected non-taxpayer mid-level exception"));
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Bi-Annual", exceptionAmount("bi_annual", season), "retained", "Over-cap path with holds retained; projected bi-annual exception"));
      } else if (teamSeason.second_apron_room_with_holds > 0) {
        generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Taxpayer MLE", exceptionAmount("taxpayer_mle", season), "retained", "Over-cap/tax path with holds retained; projected taxpayer mid-level exception"));
      }
    }
    if (teamSeason.room_if_renounced > 0) {
      generated.push(exceptionRow(teamSeason.team, teamSeason.year, "Room Exception", exceptionAmount("room_mle", season), "renounced", "Room path after renouncing holds; projected room exception"));
    }
  }
  return [...generated, ...buildOverrideExceptions(overrideRows)]
    .sort((a, b) => a.team.localeCompare(b.team) || a.year - b.year || a.name.localeCompare(b.name));
}

function buildOverrideExceptions(rows) {
  return rows.map((row, index) => {
    const amount = numberValue(row.amount);
    const year = numberValue(row.year);
    const team = cleanTeam(row.team);
    if (!amount || !year || !team || !YEARS.includes(year)) return null;
    return cleanObject({
      id: row.id || `exception-${team}-${year}-${index}`,
      team,
      year,
      name: row.name || row.exception || "Exception",
      amount: Math.round(amount),
      path: row.path || "override",
      expires: row.expires || null,
      first_apron_restriction_starts: row.first_apron_restriction_starts || null,
      signed_and_traded_contract: booleanValue(row.signed_and_traded_contract),
      note: row.note || null,
      source: row.source || "Manual exception override",
      source_quality: "override"
    });
  }).filter(Boolean);
}

function buildOverrideHardCaps(rows) {
  return rows.map((row, index) => {
    const year = numberValue(row.year);
    const team = cleanTeam(row.team);
    const hardCap = hardCapValue(row.hard_cap || row.apron || row.level);
    if (!year || !team || !YEARS.includes(year) || !hardCap) return null;
    return cleanObject({
      id: row.id || `hard-cap-${team}-${year}-${hardCap}-${index}`,
      team,
      year,
      hard_cap: hardCap,
      trigger: row.trigger || "Manual hard-cap override",
      transaction_date: row.transaction_date || row.date || null,
      expires: row.expires || null,
      note: row.note || null,
      source: row.source || "Manual hard-cap override",
      source_quality: "override"
    });
  }).filter(Boolean);
}

function exceptionRow(team, year, name, amount, pathName, note) {
  return cleanObject({
    id: `exception-${team}-${year}-${pathName}-${normalizeName(name)}`,
    team,
    year,
    name,
    amount: Math.round(amount),
    path: pathName,
    expires: null,
    note,
    source: `${SOURCE}; projected from local CBA ratios`,
    source_quality: "projected"
  });
}

function buildOverridePicks(rows) {
  return rows.map((row, index) => {
    const year = numberValue(row.year);
    const round = numberValue(row.round);
    const team = cleanTeam(row.team);
    if (!year || !round || !team || !YEARS.includes(year)) return null;
    return cleanObject({
      id: row.id || `pick-${team}-${year}-${round}-${index}`,
      team,
      year,
      round,
      label: row.label || row.pick || `${year} Round ${round}`,
      protection: row.protection || null,
      second_apron_frozen: booleanValue(row.second_apron_frozen ?? row.frozen_second_apron ?? row.frozen),
      source: row.source || "Manual pick override",
      source_quality: "override"
    });
  }).filter(Boolean);
}

function buildMaxContracts(seasons) {
  return seasons.flatMap((season) => [
    maxContractRow(season, "25%", 0.25),
    maxContractRow(season, "30%", 0.30),
    maxContractRow(season, "35%", 0.35)
  ]);
}

function maxContractRow(season, tier, pct) {
  const first = Math.round(season.salary_cap * pct);
  return {
    year: season.year,
    tier,
    first_year_salary: first,
    four_year_non_bird_total: Math.round(first * 4.3),
    five_year_bird_total: Math.round(first * 5.5)
  };
}

function buildDataballrDiscrepancies(spotracContracts, databallrRows) {
  const spotracByKey = new Map();
  for (const row of spotracContracts) {
    for (const cell of row.cells) {
      if (!cell.amount || cell.kind === "cap_hold") continue;
      spotracByKey.set(`${row.team}||${normalizeName(row.player_name)}||${cell.year}`, { row, cell });
    }
  }
  const out = [];
  for (const row of databallrRows) {
    const team = cleanTeam(row.team);
    const name = normalizeName(row.player_name);
    for (const year of YEARS) {
      const horizon = year - 2026;
      if (horizon < 0 || horizon > 4) continue;
      const databallrAmount = numberValue(row[`salary_y${horizon}`]);
      if (!databallrAmount) continue;
      const spotrac = spotracByKey.get(`${team}||${name}||${year}`);
      if (!spotrac) continue;
      const delta = spotrac.cell.amount - Math.round(databallrAmount);
      if (Math.abs(delta) < 5000) continue;
      out.push({
        team,
        player_name: spotrac.row.player_name,
        year,
        spotrac_amount: spotrac.cell.amount,
        databallr_amount: Math.round(databallrAmount),
        delta,
        spotrac_status: spotrac.cell.status,
        source_url: spotrac.row.source
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildGuaranteeOverrideMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const team = cleanTeam(row.team);
    const year = numberValue(row.year);
    if (!team || !year) continue;
    if (row.player_name) map.set(`${team}||${year}||name:${normalizeName(row.player_name)}`, row);
  }
  return map;
}

function guaranteeOverrideFor(row, year, guaranteeMap) {
  const team = TEAM_ABBR[row.team] || cleanTeam(row.team);
  const name = normalizeName(row.player_or_entity);
  return guaranteeMap.get(`${team}||${year}||name:${name}`) || null;
}

function buildAuditWarnings() {
  const audit = readCsvFile(spotracAuditPath);
  const warnings = [];
  const failed = audit.filter((row) => row.status && !["ok", "fresh_snapshot_after_fetch_error", "fresh_espn_roster_after_spotrac_error"].includes(row.status));
  if (failed.length) warnings.push(`${failed.length} Spotrac scrape audit rows failed: ${failed.map((row) => row.team).join(", ")}.`);
  const longRows = readCsvFile(spotracLongPath);
  if (!longRows.length) warnings.push("Spotrac long-form QA file is missing or empty.");
  return warnings;
}

function validatePayload(payload) {
  const expected = payload.teams.length * YEARS.length;
  if (payload.team_seasons.length !== expected) {
    throw new Error(`Expected ${expected} team-season rows, found ${payload.team_seasons.length}`);
  }
  payload.validation_summary.team_season_rows_expected = expected;
  payload.validation_summary.team_season_rows_actual = payload.team_seasons.length;

  const duplicateContractIds = duplicates(payload.contracts.map((row) => row.id));
  payload.validation_summary.duplicate_contract_ids = duplicateContractIds.length;
  if (duplicateContractIds.length) throw new Error(`Duplicate contract ids: ${duplicateContractIds.slice(0, 8).join(", ")}`);

  const duplicateTeamSeasons = duplicates(payload.team_seasons.map((row) => `${row.team}||${row.year}`));
  payload.validation_summary.duplicate_team_seasons = duplicateTeamSeasons.length;
  if (duplicateTeamSeasons.length) throw new Error(`Duplicate team season rows: ${duplicateTeamSeasons.slice(0, 8).join(", ")}`);

  const duplicateDeadRows = duplicates(payload.dead_money.map((row) => row.canonical_key));
  payload.validation_summary.duplicate_dead_money_rows = duplicateDeadRows.length;
  if (duplicateDeadRows.length) throw new Error(`Duplicate dead-money rows: ${duplicateDeadRows.slice(0, 8).join(", ")}`);

  const rowsByTeam = new Map();
  for (const row of payload.contracts) {
    if (!rowsByTeam.has(row.team)) rowsByTeam.set(row.team, []);
    rowsByTeam.get(row.team).push(row);
  }
  for (const teamSeason of payload.team_seasons) {
    const cells = capCells(rowsByTeam.get(teamSeason.team) ?? [],teamSeason.year);
    const salary = sum(cells.filter((cell) => ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.amount));
    const holds = sum(cells.filter((cell) => cell.kind === "cap_hold").map((cell) => cell.amount));
    if (salary !== teamSeason.salary_on_books || holds !== teamSeason.cap_holds) {
      throw new Error(`Grouped totals do not match summary for ${teamSeason.team} ${teamSeason.year}`);
    }
    if (teamSeason.room_if_renounced > 0 && teamSeason.status_band_renounced !== "Cap Space") {
      throw new Error(`Renounced-room status band is inconsistent for ${teamSeason.team} ${teamSeason.year}`);
    }
  }
}

function contractRowSort(a, b) {
  return a.team.localeCompare(b.team)
    || (a.display_order ?? 9999) - (b.display_order ?? 9999)
    || a.player_name.localeCompare(b.player_name);
}

function parseMoney(value) {
  const text = String(value ?? "");
  const match = text.match(/\$([0-9]+(?:,[0-9]{3})*(?:\.\d+)?|[0-9]+(?:\.\d+)?)(M|K)?/i);
  if (!match) return 0;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const suffix = match[2]?.toUpperCase();
  if (suffix === "M") return Math.round(base * 1_000_000);
  if (suffix === "K") return Math.round(base * 1_000);
  return Math.round(base);
}

function emptyCell(year) {
  return { year, amount: 0, kind: "empty", status: "", source: "unavailable", note: null };
}

function seasonLabel(year) {
  return `${year - 1}-${String(year).slice(2)}`;
}

function minimumRosterCharge(cap) {
  return Math.round(cap * (1_378_978 / 166_000_000));
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
  if (!rows.length) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = values[index] ?? "";
    });
    return out;
  });
}

function writeCsvFile(filePath, rows, cols) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = [
    cols.join(","),
    ...rows.map((row) => cols.map((col) => csvEscape(row[col])).join(","))
  ].join("\r\n");
  fs.writeFileSync(filePath, `${body}\r\n`);
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function updateManifest(filePath, payload) {
  if (!fs.existsSync(filePath)) return;
  const manifest = readJson(filePath, null);
  if (!manifest || !Array.isArray(manifest.datasets)) return;
  manifest.datasets = manifest.datasets.filter((row) => row.dataset !== "cap_tracker");
  manifest.datasets.push({ dataset: "cap_tracker", rows: payload.team_seasons.length, file: "cap_tracker.json" });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest)}\n`);
}

function projectedSystemLevelWarnings(seasonRows) {
  return seasonRows
    .filter((season) => season.source_quality !== "contract")
    .map((season) => `${season.label} system levels include projected cap/tax/apron inputs from ${season.source}.`);
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === undefined || Number.isNaN(item) ? null : item]));
}

function booleanValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return null;
}

function hardCapValue(value) {
  const text = String(value ?? "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["first_apron", "first", "1st_apron", "1st"].includes(text)) return "first_apron";
  if (["second_apron", "second", "2nd_apron", "2nd"].includes(text)) return "second_apron";
  return null;
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

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSpotracCapTrackerData();
}


