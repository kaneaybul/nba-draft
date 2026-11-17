// Compare every season's app quotes with the independently read team inventory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'frontend/package.json'));
const esbuild = require('esbuild');
const compiled = await esbuild.build({ stdin: {
  contents: 'export * from "./assetValue"; export { playerTradeValue, getPlayerSortValue } from "./App"; export { playerTradeMachineAsset } from "./tradeMachine";',
  resolveDir: resolve(root, 'frontend/src'), loader: 'ts'
}, bundle: true, write: false, loader: { '.css': 'empty' }, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const read = path => JSON.parse(readFileSync(resolve(root, 'frontend/public', path.replace(/^\//, '')), 'utf8'));
const index = read('/data/asset_valuation.json');
const EVIDENCE_METHOD = 'peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster';
const CURRENT_METHOD = EVIDENCE_METHOD + '-current';
const quotes = new Map(Object.entries(index.seasons).map(([season, row]) => [Number(season), read(row.path)]));
function checkQuote(data, season, nba_id, team, expected, name = '') {
  const [player] = api.withAssetValueContext([{ nba_id: Number(nba_id), player_name: name, year: season, team, value: 123 }], undefined, data);
  assert.equal(player.value, 123, 'Original production value changed');
  for (const value of [api.playerFourYearAssetValue(player), api.getPlayerSortValue(player, 'asset_value'),
    api.playerTradeValue(player), api.playerTradeMachineAsset(player, team).tradeValue]) assert.equal(value, expected);
  assert.equal(player.asset_valuation.date, data.observation_date);
}
let checked = 0;
if (index.historical_quote_release) {
  // Historical snapshots and daily quotes are independently published. Archived
  // quote bytes are pinned by the release guard, not re-priced from the new index.
  const legacy = index.historical_quote_release;
  assert.equal(index.history_version, legacy.history_version);
  for (const [season, data] of quotes) {
    const pointer = index.seasons[season];
    assert.equal(pointer.path, `/data/asset_valuations/${legacy.history_version}/${season}.json`);
    assert.equal(data.method, legacy.method);
    assert.equal(data.history_version, legacy.history_version);
    assert.equal(data.observation_date, pointer.observation_date);
    for (const [id, q] of Object.entries(data.players)) {
      assert.equal(q.date, data.observation_date);
      assert(Number.isFinite(q.value));
      checkQuote(data, season, id, 'UTA', q.value);
      checked++;
    }
  }
} else {
  const manifest = read(`/data/asset_history/${index.history_version}/manifest.json`);
  for (const team of manifest.teams) {
    const inventory = read(team.path);
    for (const [season, data] of quotes) {
      assert.equal(data.method, index.method);
      const snapshot = inventory.snapshots.find(row => row.date === data.observation_date);
      assert(snapshot, `Missing ${team.team} observation for ${season}`);
      for (const asset of snapshot.assets.filter(row => row.kind === 'player' && row.id.startsWith('player:nba:'))) {
        checkQuote(data, season, asset.id.split(':').at(-1), team.team, asset.value, asset.name);
        checked++;
      }
    }
  }
}
const packetPath = process.env.NBA_CURRENT_PLAYER_PACKET_FILE;
const receiptPath = process.env.NBA_CURRENT_PLAYER_RECEIPT_FILE;
if (index.method === CURRENT_METHOD || packetPath || receiptPath) {
  assert.equal(index.method, CURRENT_METHOD);
  assert.equal(index.current_quote_source_method, EVIDENCE_METHOD);
  assert.equal(index.asset_history_version, 'v20');
  const history = read('/data/asset_history_release.json');
  assert.equal(history.asset_history_version, 'v20');
  assert.equal(history.method, EVIDENCE_METHOD);
  assert(packetPath && receiptPath, 'New current quotes require the independent player packet and receipt');
  const raw = readFileSync(packetPath);
  const packet = JSON.parse(raw);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.equal(createHash('sha256').update(raw).digest('hex'), receipt.packet_sha256);
  assert.equal(receipt.asof, index.observation_date);
  assert.equal(packet.observation_date, index.observation_date);
  assert.equal(packet.method, index.method);
  assert.equal(packet.source_method, EVIDENCE_METHOD);
  assert.equal(new Set(Object.values(packet.owners)).size, 30);
  assert.equal(Object.keys(packet.players).length, receipt.players);
  assert.deepEqual(Object.keys(packet.owners).sort(), Object.keys(packet.players).sort());
  assert.deepEqual(index.players, packet.players);
  const n = Number(index.season);
  for (const [id, value] of Object.entries(packet.players)) {
    checkQuote(index, n, id, packet.owners[id], value.value);
    checked++;
  }
}
console.log(`Exact asset surface consistency passed: ${checked} player quotes; ${quotes.size} independently dated seasons.`);
