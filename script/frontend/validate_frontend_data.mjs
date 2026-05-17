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
