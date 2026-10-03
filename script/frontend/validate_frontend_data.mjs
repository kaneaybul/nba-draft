import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(root, "frontend", "public", "data");
const manifestPath = path.join(dataDir, "manifest.json");
const maxAssetBytes = Number(process.env.FRONTEND_MAX_STATIC_ASSET_BYTES ?? 25 * 1024 * 1024);
const maxInitialBytes = Number(process.env.FRONTEND_MAX_INITIAL_PAYLOAD_BYTES ?? 8 * 1024 * 1024);

main();

function main() {
  const manifest = readJson(manifestPath);
  assert(manifest.static_data?.schema_version >= 2, "manifest.static_data schema v2 is required");
  assert(Array.isArray(manifest.static_data.seasons) && manifest.static_data.seasons.length > 0, "manifest.static_data.seasons is empty");

  const files = collectManifestFiles(manifest);
  assert(files.length > 0, "manifest references no data files");

  for (const relativeFile of files) {
    const filePath = path.join(dataDir, relativeFile);
    assert(fs.existsSync(filePath), `Missing manifest file: ${relativeFile}`);
    const stat = fs.statSync(filePath);
    assert(stat.size <= maxAssetBytes, `${relativeFile} exceeds ${maxAssetBytes} bytes (${stat.size})`);
    readJson(filePath);
  }

  for (const filePath of walk(dataDir)) {
    const stat = fs.statSync(filePath);
    const relativeFile = path.relative(dataDir, filePath).replaceAll(path.sep, "/");
    assert(stat.size <= maxAssetBytes, `${relativeFile} exceeds ${maxAssetBytes} bytes (${stat.size})`);
    if (filePath.endsWith(".json")) readJson(filePath);
  }

  validateRowCounts(manifest);
  validateInitialPayload(manifest);
  validateRosterTruthPlacements(manifest);
  validateStartingLineupImpactFloor(manifest);
  validateRookieProjectionAssignments(manifest);
  console.log(`frontend data contract passed: ${files.length} manifest files`);
}

function collectManifestFiles(manifest) {
  const files = new Set();
  for (const dataset of Object.values(manifest.static_data.datasets ?? {})) {
    if (dataset.file) files.add(dataset.file);
    for (const shard of dataset.shards ?? []) files.add(shard.file);
  }
  return Array.from(files);
}

function validateRowCounts(manifest) {
  for (const [name, dataset] of Object.entries(manifest.static_data.datasets ?? {})) {
    if (dataset.strategy === "season") {
      const rows = (dataset.shards ?? []).reduce((sum, shard) => {
        const payload = readJson(path.join(dataDir, shard.file));
        assert(Array.isArray(payload), `${name}/${shard.key} must be an array`);
        assert(payload.length === shard.rows, `${name}/${shard.key} row count mismatch: expected ${shard.rows}, got ${payload.length}`);
        return sum + payload.length;
      }, 0);
      assert(rows === dataset.rows, `${name} row count mismatch: expected ${dataset.rows}, got ${rows}`);
    } else if (dataset.file) {
      const payload = readJson(path.join(dataDir, dataset.file));
      const rows = rowCountFor(name, payload);
      assert(rows === dataset.rows, `${name} row count mismatch: expected ${dataset.rows}, got ${rows}`);
    }
  }
}

function validateInitialPayload(manifest) {
  const latestSeason = Number(manifest.static_data.seasons[0]);
  const players = manifest.static_data.datasets.impact_players?.shards?.find((shard) => Number(shard.year ?? shard.key) === latestSeason);
  assert(players, `No impact_players shard for latest season ${latestSeason}`);
  const manifestBytes = fs.statSync(manifestPath).size;
  const initialBytes = manifestBytes + fs.statSync(path.join(dataDir, players.file)).size;
  assert(initialBytes <= maxInitialBytes, `Initial manifest + player shard payload exceeds ${maxInitialBytes} bytes (${initialBytes})`);
}

function validateRookieProjectionAssignments(manifest) {
  const playerShards = manifest.static_data.datasets.impact_players?.shards ?? [];
  for (const shard of playerShards) {
    const season = Number(shard.year ?? shard.key);
    if (!Number.isFinite(season)) continue;
    const rows = readJson(path.join(dataDir, shard.file));
    const rookies = rows.filter((row) => row.availability_status === "rookie_projection");
    if (rookies.length === 0) continue;
    const teamControlledRookie = (row) =>
      ["active", "active_pending_done", "rookie_cap_hold"].includes(row.roster_state) &&
      ["Spotrac Active Roster", "Spotrac Pending Transactions", "Spotrac Rookie Cap Hold"].includes(row.roster_status_source) &&
      cleanTeam(row.roster_truth_team) !== "FA" &&
      cleanTeam(row.team) === cleanTeam(row.roster_truth_team) &&
      cleanTeam(row.current_roster_team) === cleanTeam(row.roster_truth_team) &&
      cleanTeam(row.incumbent_team) === cleanTeam(row.roster_truth_team) &&
      cleanTeam(row.market_team) === cleanTeam(row.roster_truth_team) &&
      cleanTeam(row.team_projection_base) === cleanTeam(row.roster_truth_team) &&
      ["signed", "rookie_fa"].includes(row.projection_roster_status) &&
      ["Signed", "Rookie FA", "Two-Way"].includes(row.contract_status) &&
      (
        row.contract_status === "Two-Way" ||
        (row.contract !== null && row.contract !== undefined && Number(row.contract) >= 0)
      );
    const assigned = rookies.filter((row) => !teamControlledRookie(row) && (
      cleanTeam(row.team) !== "FA" ||
      cleanTeam(row.current_roster_team) !== "FA" ||
      cleanTeam(row.incumbent_team) !== "FA" ||
      cleanTeam(row.market_team) !== "FA" ||
      cleanTeam(row.team_projection_base) !== "FA" ||
      row.projection_roster_status !== "rookie_fa" ||
      row.contract_status !== "Rookie FA"
    ));
    assert(assigned.length === 0, `Rookie projections must remain unassigned or explicit team-controlled rookie rows in ${season}: ${assigned.slice(0, 5).map((row) => row.player_name).join(", ")}`);
    const missingMinutes = rookies.filter((row) => !(Number(row.Minutes) > 0));
    assert(missingMinutes.length === 0, `Rookie projections must keep positive minutes in ${season}: ${missingMinutes.slice(0, 5).map((row) => row.player_name).join(", ")}`);
  }
}

function validateRosterTruthPlacements(manifest) {
  const playerShards = manifest.static_data.datasets.impact_players?.shards ?? [];
  const currentRosterSeason = Math.min(...playerShards
    .map((shard) => Number(shard.year ?? shard.key))
    .filter(Number.isFinite)
    .filter((season) => season >= 2026));
  for (const shard of playerShards) {
    const season = Number(shard.year ?? shard.key);
    if (!Number.isFinite(season) || season < currentRosterSeason) continue;
    const rows = readJson(path.join(dataDir, shard.file));
    const misplacedFreeAgents = rows.filter((row) =>
      cleanTeam(row.roster_truth_team) === "FA" &&
      cleanTeam(row.team) !== "FA"
    );
    assert(
      misplacedFreeAgents.length === 0,
      `Roster truth FA players assigned to teams in ${season}: ${misplacedFreeAgents.slice(0, 8).map((row) => `${row.player_name}@${row.team}`).join(", ")}`
    );
    const freeAgentsWithContracts = rows.filter((row) =>
      cleanTeam(row.roster_truth_team) === "FA" &&
      Number(row.contract) > 0
    );
    assert(
      freeAgentsWithContracts.length === 0,
      `Roster truth FA players carry active contracts in ${season}: ${freeAgentsWithContracts.slice(0, 8).map((row) => `${row.player_name}: ${row.contract}`).join(", ")}`
    );
    const implausibleContracts = rows.filter((row) =>
      Number(row.contract) > 150_000_000 ||
      [1, 2, 3, 4, 5].some((horizon) => Number(row[`projection_contract_y${horizon}`]) > 150_000_000)
    );
    assert(
      implausibleContracts.length === 0,
      `Implausible contract amount in ${season}: ${implausibleContracts.slice(0, 8).map((row) => row.player_name).join(", ")}`
    );
    const lineupsShard = manifest.static_data.datasets.team_lineups?.shards?.find((lineupShard) => Number(lineupShard.year ?? lineupShard.key) === season);
    if (!lineupsShard) continue;
    const lineupRows = readJson(path.join(dataDir, lineupsShard.file));
    const lineupKeys = new Set(lineupRows.map((row) => `${row.year}-${row.nba_id}-${cleanTeam(row.team)}`));
    const staleLineups = rows.filter((row) =>
      cleanTeam(row.roster_truth_team) === "FA" &&
      lineupKeys.has(`${row.year}-${row.nba_id}-${cleanTeam(row.team)}`)
    );
    assert(
      staleLineups.length === 0,
      `Roster truth FA players present in team lineups in ${season}: ${staleLineups.slice(0, 8).map((row) => row.player_name).join(", ")}`
    );
  }
}

function validateStartingLineupImpactFloor(manifest) {
  const lineupShards = manifest.static_data.datasets.team_lineups?.shards ?? [];
  for (const shard of lineupShards) {
    const rows = readJson(path.join(dataDir, shard.file));
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.scenario_id}-${row.year}-${cleanTeam(row.team)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const [key, group] of groups) {
      const required = [...group]
        .filter((row) => Number(row.total) > 1)
        .sort((a, b) => Number(b.total) - Number(a.total))
        .slice(0, 3);
      const starterIds = new Set(group.filter((row) => row.role_type === "Starter").map((row) => row.nba_id));
      const missing = required.filter((row) => !starterIds.has(row.nba_id));
      const starters = group.filter((row) => row.role_type === "Starter");
      const hasPositionRoles = starters.some((row) => row.lineup_position);
      if (hasPositionRoles) {
        const slots = starters.map((row) => row.lineup_position);
        assert(slots.every((slot) => ["PG", "SG", "SF", "PF", "C"].includes(slot)), `Invalid lineup role in ${key}`);
        assert(new Set(slots).size === slots.length, `Duplicated lineup role in ${key}`);
        assert(starters.length === Math.min(5, group.length), `Incorrect starter count in ${key}`);
        assert(starters.every((row) => typeof row.lineup_position_fallback === "boolean"), `Missing positional fit status in ${key}`);
        assert(starters.every((row) => row.lineup_star_lock_relaxed === (missing.length > 0)), `Incorrect star-lock status in ${key}`);
      }
      assert(
        missing.length === 0 || (hasPositionRoles && starters.every((row) => row.lineup_star_lock_relaxed)),
        `Starting lineup omits top-three +1.0 impact player for ${key}: ${missing.map((row) => row.player_name).join(", ")}`
      );
    }
  }
}

function rowCountFor(dataset, payload) {
  if (Array.isArray(payload)) return payload.length;
  if (dataset === "cap_tracker" && Array.isArray(payload?.team_seasons)) return payload.team_seasons.length;
  if (dataset === "cap_transaction_review" && Array.isArray(payload?.rows)) return payload.rows.length;
  if (dataset === "offseason_truth" && payload?.players && typeof payload.players === "object") return Object.keys(payload.players).length;
  return 1;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(root, filePath)}: ${error.message}`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(filePath));
    } else {
      out.push(filePath);
    }
  }
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanTeam(value) {
  return String(value ?? "").trim().toUpperCase() || "FA";
}
