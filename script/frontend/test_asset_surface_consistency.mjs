// Compare every season's app quotes with the independently read team inventory.
import assert from 'node:assert/strict';
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
const manifest = read(`/data/asset_history/${index.history_version}/manifest.json`);
const quotes = new Map(Object.entries(index.seasons).map(([season, row]) => [Number(season), read(row.path)]));
let checked = 0;
for (const team of manifest.teams) {
  const inventory = read(team.path);
  for (const [season, data] of quotes) {
    assert.equal(data.method, index.method);
    const snapshot = inventory.snapshots.find(row => row.date === data.observation_date);
    assert(snapshot, `Missing ${team.team} observation for ${season}`);
    for (const asset of snapshot.assets.filter(row => row.kind === 'player' && row.id.startsWith('player:nba:'))) {
      const nba_id = Number(asset.id.split(':').at(-1));
      const [player] = api.withAssetValueContext([{ nba_id, player_name: asset.name, year: season, team: team.team, value: 123 }], undefined, data);
      assert.equal(player.value, 123, 'Original production value changed');
      for (const value of [api.playerFourYearAssetValue(player), api.getPlayerSortValue(player, 'asset_value'),
        api.playerTradeValue(player), api.playerTradeMachineAsset(player, team.team).tradeValue]) assert.equal(value, asset.value);
      assert.equal(player.asset_valuation.date, snapshot.date);
      checked++;
    }
  }
}
console.log(`Exact asset surface consistency passed: ${checked} player quotes, ${quotes.size} seasons, 30 teams.`);
