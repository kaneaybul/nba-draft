import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromFrontend = createRequire(path.join(root, 'frontend/package.json'));
const esbuild = requireFromFrontend('esbuild');
// Bundle the real module graph so newly added local imports are exercised too.
const compiled = await esbuild.build({
  entryPoints: [path.join(root, 'frontend/src/data.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent'
});
const { loadAppData, loadNewerAppData, loadDataForView } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
// Exercise the actual publisher's version so a stale browser gate cannot pass
// by testing only against an equally stale hand-written fixture.
const publication = readFileSync(path.join(root, 'script/asset_history/model_version.py'), 'utf8');
const historyVersion = publication.match(/DATA_VERSION\s*=\s*['"]([^'"]+)['"]/)[1];
const method = publication.match(/METHOD\s*=\s*['"]([^'"]+)['"]/)[1];
const current = { generated_at: 'old', valuation_generated_at: 'initial-values' };
const updated = { generated_at: 'new', datasets: [], static_data: { schema_version: 2, seasons: [2027], datasets: {
  impact_players: { shards: [{ year: 2027, file: 'players.json', sha256: 'new-players' }] }
} } };
const player = { nba_id: 1, year: 2027, player_name: 'Fresh player' };
const originalFetch = globalThis.fetch;
let calls = [];
const initialValuations = { method, history_version: historyVersion,
  generated_at: 'initial-values', season: 2027, reporting_cap: 164961000,
  players: {}, slots: {}, picks: [] };
function serve(manifest, valuations = initialValuations) {
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
  serve(updated);
  const opened = await loadAppData('startup-regression');
  assert.equal(opened.players[0].player_name, 'Fresh player');
  assert.equal(opened.manifest.valuation_generated_at, initialValuations.generated_at);

  // A missing live feed must not switch the app to a different valuation model.
  serve(current, null);
  await assert.rejects(loadNewerAppData(current), /404/);
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
  const valuations = { ...initialValuations, generated_at: 'new-values', season: 2027, reporting_cap: 164961000,
    players: { '1': { value: 12345, annual: [] } }, slots: {}, picks: [] };
  serve(updated, valuations);
  const revalued = await loadNewerAppData({ ...updated, valuation_generated_at: 'old-values' });
  assert.equal(revalued.manifest.valuation_generated_at, 'new-values');
  assert.equal(revalued.players[0].asset_valuation.value, 12345);
  serve(updated, valuations);
  assert.equal(await loadNewerAppData(revalued.manifest), null);

  // Historical Impact and trades must quote the identical Asset History date.
  const historicalManifest = structuredClone(updated);
  historicalManifest.static_data.datasets.impact_players.shards.push({ year: 2025, file: 'players-2025.json', sha256: 'past-players' });
  const indexed = { ...valuations, seasons: { '2025': { observation_date: '2025-06-30', path: '/data/asset_valuations/v8/2025.json' } } };
  const dated = { ...valuations, season: 2025, observation_date: '2025-06-30', players: { '1': { date: '2025-06-30', value: 6789, annual: [] } } };
  const historicalFetch = globalThis.fetch;
  let badDate = false;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('/data/asset_valuations/v8/2025.json')) return { ok: true, json: async () => badDate ? { ...dated, observation_date: '2025-05-31' } : dated };
    if (url.startsWith('/data/asset_valuation.json')) return { ok: true, json: async () => indexed };
    if (url.startsWith('/data/players-2025.json')) return { ok: true, json: async () => [{ ...player, year: 2025 }] };
    return historicalFetch(url, options);
  };
  const historical = await loadDataForView({ ...revalued, manifest: historicalManifest }, 'impact', 2025, 'dated-regression');
  assert.equal(historical.players.find(row => row.year === 2025).asset_valuation.value, 6789);
  assert.equal(historical.players.find(row => row.year === 2025).asset_valuation.date, '2025-06-30');
  badDate = true;
  await assert.rejects(loadDataForView({ ...revalued, manifest: historicalManifest }, 'impact', 2025, 'bad-date-regression'), /dated asset valuation release is inconsistent/);

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(loadNewerAppData(current), /503/);
  serve(current);
  assert.equal(await loadNewerAppData(current), null);
  serve(current, { ...initialValuations, history_version: 'v4' });
  await assert.rejects(loadNewerAppData(current), /current asset valuation release/);
  serve(updated, { ...initialValuations, method: 'peak4-payroll-0.8-v5' });
  await assert.rejects(loadAppData('wrong-method'), /current asset valuation release/);
  const roleSource = 'peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster';
  const newRole = { ...valuations, method: roleSource + '-current', current_quote_source_method: roleSource,
    asset_history_version: 'v20', current_generated_at: '2026-11-17T14:00:00Z', observation_date: '2026-11-17',
    current_observation_date: '2026-11-17', pick_observation_date: '2026-11-17',
    historical_quote_release: { method, history_version: historyVersion, generated_at: valuations.generated_at } };
  serve(updated, newRole);
  const role = await loadAppData('new-role');
  assert.equal(role.players[0].asset_valuation.value, 12345);
  assert.equal(role.manifest.valuation_generated_at, newRole.current_generated_at);
  serve(updated, newRole);
  assert.equal(await loadNewerAppData(role.manifest), null);
  serve(updated, { ...newRole, current_generated_at: '2026-11-18T14:00:00Z', observation_date: '2026-11-18',
    current_observation_date: '2026-11-18', pick_observation_date: '2026-11-18' });
  assert.equal((await loadNewerAppData(role.manifest)).manifest.valuation_generated_at, '2026-11-18T14:00:00Z');
  serve(updated, { ...newRole, pick_observation_date: '2026-11-16' });
  await assert.rejects(loadAppData('mixed-e-v2'), /inconsistent source dates/);
  serve(updated, { ...newRole, current_quote_source_method: 'not-e-v2' });
  await assert.rejects(loadAppData('wrong-e-v2-source'), /inconsistent source dates/);
  serve(updated, { ...newRole, historical_quote_release: { ...newRole.historical_quote_release, history_version: 'v20' } });
  await assert.rejects(loadAppData('bad-legacy-selector'), /current asset valuation release/);
  console.log('Projection refresh, legacy history, actual e-v2 freshness stamp, required-feed outage, and mixed-method rejection passed.');
} finally {
  globalThis.fetch = originalFetch;
}

