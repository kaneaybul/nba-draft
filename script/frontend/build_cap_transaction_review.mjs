import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVIEW_COLUMNS,
  buildContractDeltaMaps,
  buildContractSnapshot,
  buildReviewRows,
  formatDateOnly,
  normalizeMovementPayload,
  parseDateOnly,
  readCsvFile,
  writeCsv,
  writeCsvFile
} from "./cap_transaction_rules.mjs";
import {
  SALARY_RESOLUTION_COLUMNS,
  loadSalarySources,
  resolutionSummary,
  resolveSalaryRows
} from "./cap_salary_resolution.mjs";
import { buildReviewSummary } from "./cap_tracker_rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const liveDir = path.join(root, "processed", "livedata", "impactrefresh");
const dataDir = path.join(root, "frontend", "public", "data");
const spotracDir = path.join(root, "raw", "cap_sources", "spotrac");
const contractsPath = path.join(liveDir, "contracts_2026_current.csv");
const brefContractsPath = path.join(liveDir, "contracts_bref_2026_current.csv");
const deadMoneyPath = path.join(root, "ref", "cap_tracker_dead_money.csv");
const outPath = path.join(liveDir, "cap_transaction_review.csv");
const resolutionPath = path.join(liveDir, "cap_transaction_salary_resolution.csv");
const jsonOutPath = path.join(dataDir, "cap_transaction_review.json");
const snapshotPath = path.join(liveDir, "cap_transaction_contract_snapshot.csv");
const NBA_MOVEMENT_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json";

const args = parseArgs(process.argv.slice(2));
const today = parseDateOnly(args.end || process.env.CAP_TRANSACTION_END_DATE || new Date());
const lookbackDays = integerValue(args.lookback || process.env.CAP_TRANSACTION_LOOKBACK_DAYS, 7);
const start =
  parseDateOnly(args.start || process.env.CAP_TRANSACTION_START_DATE) ||
  new Date(today.getTime() - Math.max(lookbackDays - 1, 0) * 24 * 60 * 60 * 1000);
const sourceUrl = args.sourceUrl || process.env.CAP_TRANSACTION_SOURCE_URL || NBA_MOVEMENT_URL;
const inputPath = args.input || process.env.CAP_TRANSACTION_INPUT_JSON || "";
const strict = Boolean(args.strict || truthy(process.env.CAP_TRANSACTION_REVIEW_STRICT));

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(liveDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(spotracDir, { recursive: true });

  const priorReview = readCsvFile(outPath);
  const priorResolution = readCsvFile(resolutionPath);
  const previousSnapshot = readCsvFile(snapshotPath);
  const currentContracts = [...readCsvFile(contractsPath), ...readCsvFile(brefContractsPath)];
  const snapshot = buildContractSnapshot(currentContracts);
  const { deltaById, deltaByName } = buildContractDeltaMaps(previousSnapshot, snapshot);

  const payload = await readTransactionPayload();
  if (!payload) {
    handleMissingPayload(snapshot);
    return;
  }

  const transactions = normalizeMovementPayload(payload, { sourceUrl });
  const reviewRows = mergePriorResolution(buildReviewRows(transactions, {
    startDate: start,
    endDate: today,
    priorRows: priorReview,
    contractDeltaById: deltaById,
    contractDeltaByName: deltaByName
  }), priorResolution);
  const salarySources = loadSalarySources({ spotracDir, contractsPath, brefContractsPath, deadMoneyPath });
  const resolvedRows = resolveSalaryRows(reviewRows, salarySources);

  writeCsvFile(outPath, resolvedRows, REVIEW_COLUMNS);
  writeCsvFile(resolutionPath, resolvedRows, SALARY_RESOLUTION_COLUMNS);
  writeCsvFile(snapshotPath, snapshot, snapshotColumns());
  fs.writeFileSync(jsonOutPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    range: { start: formatDateOnly(start), end: formatDateOnly(today) },
    source_policy: "NBA.com detects player movement; salary structure resolves from authorized local Spotrac-style files in raw/cap_sources/spotrac plus local contract exports. Estimated rows must remain labeled estimated.",
    salary_sources: {
      spotrac_rows: salarySources.spotrac.length,
      contract_rows: salarySources.contracts.length,
      dead_money_rows: salarySources.deadMoney.length
    },
    resolution_summary: resolutionSummary(resolvedRows),
    review_summary: buildReviewSummary(resolvedRows),
    rows: resolvedRows
  }, null, 2)}\n`);

  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${resolutionPath}`);
  console.log(`Wrote ${jsonOutPath}`);
  console.log(`Review rows: ${resolvedRows.length}; range: ${formatDateOnly(start)} to ${formatDateOnly(today)}`);
  console.log(`Resolution summary: ${JSON.stringify(resolutionSummary(resolvedRows))}`);
  console.log(`Contract deltas attached: ${resolvedRows.filter((row) => row.contract_delta).length}`);
  console.log(`Contract snapshot rows: ${snapshot.length}`);
}

async function readTransactionPayload() {
  if (inputPath) {
    return JSON.parse(fs.readFileSync(path.resolve(root, inputPath), "utf8"));
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 cap-tracker-review/1.0",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://www.nba.com/stats/transactions/"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (strict) throw error;
    console.warn(`Could not refresh NBA transaction feed; keeping existing review file. Error: ${error.message}`);
    return null;
  }
}

function handleMissingPayload(snapshot) {
  if (!fs.existsSync(outPath)) {
    fs.writeFileSync(outPath, writeCsv([], REVIEW_COLUMNS));
    console.log(`Wrote empty review scaffold: ${outPath}`);
  }
  if (!fs.existsSync(resolutionPath)) {
    writeCsvFile(resolutionPath, [], SALARY_RESOLUTION_COLUMNS);
  }
  if (!fs.existsSync(jsonOutPath)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(jsonOutPath, `${JSON.stringify({ generated_at: new Date().toISOString(), rows: [] }, null, 2)}\n`);
  }
  writeCsvFile(snapshotPath, snapshot, snapshotColumns());
  console.log(`Updated contract snapshot rows: ${snapshot.length}`);
}

function mergePriorResolution(rows, priorResolution) {
  const priorByKey = new Map(priorResolution.map((row) => [row.transaction_key, row]));
  return rows.map((row) => {
    const prior = priorByKey.get(row.transaction_key);
    if (!prior) return row;
    return {
      ...row,
      salary_resolution_status: prior.salary_resolution_status || row.salary_resolution_status,
      salary_source: prior.salary_source || row.salary_source,
      salary_source_url: prior.salary_source_url || row.salary_source_url,
      suggested_amount: prior.suggested_amount || row.suggested_amount,
      approved_amount: prior.approved_amount || row.approved_amount,
      source_quality: prior.source_quality || row.source_quality,
      resolution_note: prior.resolution_note || row.resolution_note,
      conflict_note: prior.conflict_note || row.conflict_note,
      status: prior.status || row.status,
      applied_at: prior.applied_at || row.applied_at || "",
      applied_key: prior.applied_key || row.applied_key || "",
      applied_amount: prior.applied_amount || row.applied_amount || "",
      last_error: prior.last_error || row.last_error || ""
    };
  });
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      out.strict = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function integerValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.trunc(number);
  }
  return null;
}

function truthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function snapshotColumns() {
  return [
    "nba_id",
    "player_name",
    "team",
    "salary_y0",
    "salary_y1",
    "salary_y2",
    "salary_y3",
    "salary_y4",
    "contract_status_y0",
    "contract_status_y1",
    "contract_status_y2",
    "contract_status_y3",
    "contract_status_y4",
    "free_agent_status",
    "free_agent_year",
    "guaranteed",
    "contract_type",
    "signed_using"
  ];
}
