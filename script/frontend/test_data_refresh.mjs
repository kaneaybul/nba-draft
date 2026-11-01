import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromFrontend = createRequire(path.join(root, 'frontend/package.json'));
const esbuild = requireFromFrontend('esbuild');
// Bundle the real module graph so newly added local imports are exercised too.
const compiled = await esbuild.build({
  entryPoints: [path.join(root, 'frontend/src/data.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent'
});
const { loadNewerAppData } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const current = { generated_at: 'old' };
const updated = { generated_at: 'new', datasets: [], static_data: { schema_version: 2, seasons: [2027], datasets: {
  impact_players: { shards: [{ year: 2027, file: 'players.json', sha256: 'new-players' }] }
} } };
const player = { nba_id: 1, year: 2027, player_name: 'Fresh player' };
const originalFetch = globalThis.fetch;
let calls = [];
function serve(manifest, valuations) {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.startsWith('/data/manifest')) return { ok: true, json: async () => manifest };
    if (url.startsWith('/data/asset_valuation')) return valuations
      ? { ok: true, json: async () => valuations } : { ok: false, status: 404 };
    if (url.startsWith('/data/players.json')) return { ok: true, json: async () => [player] };
    throw new Error(`Unexpected refresh request: ${url}`);
  };
}

try {
  // An optional valuation feed can be absent without preventing refresh checks.
  serve(current);
  assert.equal(await loadNewerAppData(current), null);
  assert.equal(calls.length, 2);
  assert(calls.every(([, options]) => options.cache === 'no-store'));

  serve(updated);
  const loaded = await loadNewerAppData(current);
  assert.equal(loaded.manifest.generated_at, 'new');
  assert.equal(loaded.players[0].player_name, 'Fresh player');
  assert(calls.some(([url]) => url === '/data/players.json?v=new-players'));
  assert.deepEqual(loaded.teams, []);

  // Asset-history updates are independent of the projection manifest timestamp.
  const valuations = { generated_at: 'new-values', season: 2027, reporting_cap: 164961000,
    players: { '1': { value: 12345, annual: [] } }, slots: {}, picks: [] };
  serve(updated, valuations);
  const revalued = await loadNewerAppData({ ...updated, valuation_generated_at: 'old-values' });
  assert.equal(revalued.manifest.valuation_generated_at, 'new-values');
  assert.equal(revalued.players[0].asset_valuation.value, 12345);
  serve(updated, valuations);
  assert.equal(await loadNewerAppData(revalued.manifest), null);

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(loadNewerAppData(current), /503/);
  serve(current);
  assert.equal(await loadNewerAppData(current), null);
  console.log('Projection and valuation refresh, versioned loading, optional-feed outage, and connection recovery passed.');
} finally {
  globalThis.fetch = originalFetch;
}
