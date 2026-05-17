import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(root, "frontend", "public", "data");
const v2Dir = path.join(dataDir, "v2");
const maxAssetBytes = Number(process.env.FRONTEND_MAX_STATIC_ASSET_BYTES ?? 25 * 1024 * 1024);

const seasonDatasets = [
  { dataset: "impact_players", source: "impact_players.json", key: "year", dir: "impact_players" },
  { dataset: "team_projections", source: "team_projections.json", key: "year", dir: "team_projections" },
  { dataset: "team_lineups", source: "team_lineups.json", key: "year", dir: "team_lineups" },
  { dataset: "team_schedules", source: "team_schedules.json", key: "season", dir: "team_schedules" }
];

const singletonDatasets = [
  "pick_assets",
  "draft_prospects",
  "draft_tracker_board_summary",
  "draft_tracker_board_scores",
  "draft_tracker_prospect_scores",
  "draft_model_summary",
  "draft_model_feature_details",
  "offseason_truth",
  "cap_tracker",
  "cap_transaction_review"
];

const manifestPath = path.join(dataDir, "manifest.json");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const originalManifest = readJsonIfExists(manifestPath) ?? {};
  const previousDatasets = originalManifest.static_data?.datasets ?? {};
  const generatedAt = new Date().toISOString();
  const offseasonTruth = readJsonIfExists(path.join(dataDir, "offseason_truth.json"));

  fs.mkdirSync(v2Dir, { recursive: true });

  const staticDatasets = {};
  const manifestRows = [];
  let normalizedPlayers = null;

  for (const spec of seasonDatasets) {
    const sourcePath = path.join(dataDir, spec.source);
    if (!fs.existsSync(sourcePath)) {
      const previous = previousDatasets[spec.dataset];
      if (previous?.strategy === "season" && Array.isArray(previous.shards)) {
        staticDatasets[spec.dataset] = previous;
        manifestRows.push({ dataset: spec.dataset, rows: previous.rows, file: `v2/${spec.dir}/{season}.json` });
        if (spec.dataset === "impact_players") {
          normalizedPlayers = readShards(previous.shards);
        }
      }
      continue;
    }
    let rows = readJsonIfExists(sourcePath) ?? [];
    if (!Array.isArray(rows)) continue;

    if (spec.dataset === "impact_players" && offseasonTruth) {
      rows = normalizePlayers(rows, offseasonTruth);
      normalizedPlayers = rows;
    } else if (spec.dataset === "team_lineups" && offseasonTruth && normalizedPlayers) {
      rows = normalizeLineups(rows, normalizedPlayers);
    }

    const shards = [];
    const groups = groupBy(rows, spec.key);
    const outDir = path.join(v2Dir, spec.dir);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    for (const key of Array.from(groups.keys()).sort((a, b) => Number(a) - Number(b))) {
      const groupRows = groups.get(key) ?? [];
      const relativeFile = path.posix.join("v2", spec.dir, `${key}.json`);
      const info = writeJson(path.join(dataDir, relativeFile), groupRows);
      shards.push({
        key: String(key),
        year: Number.isFinite(Number(key)) ? Number(key) : undefined,
        rows: groupRows.length,
        file: relativeFile,
        bytes: info.bytes,
        sha256: info.sha256
      });
    }

    const rowCount = rows.length;
    staticDatasets[spec.dataset] = {
      strategy: "season",
      rows: rowCount,
      shards
    };
    manifestRows.push({ dataset: spec.dataset, rows: rowCount, file: `v2/${spec.dir}/{season}.json` });

    const sourceSize = fs.statSync(sourcePath).size;
    if (sourceSize > maxAssetBytes || process.env.FRONTEND_REMOVE_LEGACY_DATA === "true") {
      fs.rmSync(sourcePath, { force: true });
    }
  }

  for (const dataset of singletonDatasets) {
    const file = `${dataset}.json`;
    const sourcePath = path.join(dataDir, file);
    if (!fs.existsSync(sourcePath)) continue;
    const payload = readJsonIfExists(sourcePath);
    const stat = fs.statSync(sourcePath);
    const sha256 = hashFile(sourcePath);
    const rows = rowCountFor(dataset, payload);
    staticDatasets[dataset] = {
      strategy: "singleton",
      rows,
      file,
      bytes: stat.size,
      sha256
    };
    manifestRows.push({ dataset, rows, file });
  }

  const seasons = collectYears(staticDatasets, "impact_players");
  const draftYears = collectDraftYears(staticDatasets);
  const manifest = {
    ...originalManifest,
    generated_at: originalManifest.generated_at ?? generatedAt,
    note: "Generated from canonical processed/raw CSV outputs. Public runtime uses static_data shards.",
    datasets: manifestRows,
    static_data: {
      schema_version: 2,
      generated_at: generatedAt,
      max_asset_bytes: maxAssetBytes,
      seasons,
      draft_years: draftYears,
      initial_view: "impact",
      datasets: staticDatasets
    }
  };
  delete manifest.source_root;

  writeJson(manifestPath, manifest, 2);
  console.log(`Static data manifest written with ${Object.keys(staticDatasets).length} datasets.`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload, space = 0) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(payload, null, space)}\n`;
  fs.writeFileSync(filePath, text);
  return { bytes: Buffer.byteLength(text), sha256: hashText(text) };
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row?.[key];
    if (value === undefined || value === null || value === "") continue;
    const normalized = String(value);
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(row);
  }
  return groups;
}

function rowCountFor(dataset, payload) {
  if (Array.isArray(payload)) return payload.length;
  if (dataset === "cap_tracker" && Array.isArray(payload?.team_seasons)) return payload.team_seasons.length;
  if (dataset === "cap_transaction_review" && Array.isArray(payload?.rows)) return payload.rows.length;
  if (dataset === "offseason_truth" && payload?.players && typeof payload.players === "object") return Object.keys(payload.players).length;
  return 1;
}

function collectYears(datasets, dataset) {
  return (datasets[dataset]?.shards ?? [])
    .map((shard) => Number(shard.year ?? shard.key))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
}

function collectDraftYears(datasets) {
  const file = datasets.draft_prospects?.file;
  if (!file) return [];
  const rows = readJsonIfExists(path.join(dataDir, file));
  if (!Array.isArray(rows)) return [];
  return Array.from(new Set(rows.map((row) => Number(row.draft_year)).filter(Number.isFinite))).sort((a, b) => b - a);
}

function readShards(shards) {
  return shards.flatMap((shard) => {
    const filePath = path.join(dataDir, shard.file);
    return fs.existsSync(filePath) ? readJsonIfExists(filePath) ?? [] : [];
  });
}

function normalizePlayers(players, truth) {
  if (!truth?.players) return players;
  return players.map((player) => {
    const row = truth.players[`${player.year}-${player.nba_id}-${player.player_name}`];
    if (!row) return player;
    const currentTeam = cleanTeam(row.current_roster_team);
    const rightsTeam = cleanTeam(row.rights_team);
    const truthStatus = normalizeTruthStatus(row.contract_status, row.current_roster_team);
    const isActiveRoster = currentTeam !== "FA";
    const seasonContract = numberValue(player.contract);
    const hasSeasonContract = isActiveRoster && seasonContract !== null && seasonContract > 0;
    const status = hasSeasonContract ? normalizeSeasonContractStatus(player.contract_status, currentTeam) : truthStatus;
    const contract = hasSeasonContract ? seasonContract : (isContractControlledStatus(status) ? numberValue(row.guaranteed_salary) ?? 0 : player.contract ?? null);
    const isContractControlled = isContractControlledStatus(status);
    return {
      ...player,
      current_roster_team: currentTeam,
      rights_team: rightsTeam,
      bird_rights: row.bird_rights,
      cap_hold: row.cap_hold,
      cap_hold_type: row.cap_hold_type,
      guaranteed_salary: row.guaranteed_salary,
      dead_cap: row.dead_cap,
      waived_date: row.waived_date,
      roster_status_source: row.roster_status_source,
      team: isActiveRoster ? currentTeam : "FA",
      incumbent_team: rightsTeam !== "FA" ? rightsTeam : currentTeam,
      market_team: isActiveRoster ? currentTeam : "FA",
      team_projection_base: isActiveRoster ? currentTeam : "FA",
      projection_roster_status: projectionRosterStatus(status, contract),
      contract_status: status,
      contract,
      projection_effective_contract_y1: isContractControlled && !hasSeasonContract ? contract : player.projection_effective_contract_y1
    };
  });
}

function normalizeLineups(lineups, players) {
  const playersByIdYear = new Map(players.map((player) => [`${player.year}-${player.nba_id}`, player]));
  return lineups
    .map((lineup) => {
      const player = playersByIdYear.get(`${lineup.year}-${lineup.nba_id}`);
      if (!player) return lineup;
      const currentTeam = cleanTeam(player.current_roster_team);
      if (currentTeam === "FA") return null;
      return {
        ...lineup,
        team: currentTeam,
        contract_status: player.contract_status ?? lineup.contract_status
      };
    })
    .filter(Boolean);
}

function cleanTeam(value) {
  return String(value ?? "").trim().toUpperCase() || "FA";
}

function normalizeTruthStatus(status, currentTeam) {
  const value = String(status ?? "").trim();
  return ["Signed", "UFA", "RFA", "Player Option", "Team Option", "Non-Guaranteed", "Rookie FA"].includes(value)
    ? value
    : cleanTeam(currentTeam) === "FA"
      ? "UFA"
      : "Signed";
}

function normalizeSeasonContractStatus(status, currentTeam) {
  const value = String(status ?? "").trim();
  if (["Player Option", "Team Option", "Non-Guaranteed"].includes(value)) return value;
  if (cleanTeam(currentTeam) === "FA") return value === "RFA" || value === "Rookie FA" ? value : "UFA";
  return "Signed";
}

function isContractControlledStatus(status) {
  return ["Signed", "Player Option", "Team Option", "Non-Guaranteed"].includes(String(status ?? "").trim());
}

function projectionRosterStatus(status, contract) {
  if (isContractControlledStatus(status) && numberValue(contract) !== null && numberValue(contract) > 0) return "signed";
  if (status === "RFA") return "restricted";
  if (status === "Rookie FA") return "rookie_fa";
  return "open_market";
}

function numberValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
