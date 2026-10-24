import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../../frontend/src/data.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { loadNewerAppData } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const current = { generated_at: 'old' };
let calls = [];
globalThis.fetch = async (url, options) => {
  calls.push([url, options]);
  return { ok: true, json: async () => current };
};
assert.equal(await loadNewerAppData(current), null);
assert.equal(calls.length, 1);
assert.equal(calls[0][1].cache, 'no-store');
const updated = { generated_at: 'new', datasets: [], static_data: { schema_version: 2, seasons: [2027], datasets: {
  impact_players: { shards: [{ year: 2027, file: 'players.json', sha256: 'new-players' }] }
} } };
globalThis.fetch = async (url, options) => {
  calls.push([url, options]);
  return { ok: true, json: async () => url.startsWith('/data/manifest') ? updated : [{ year: 2027, player_name: 'Fresh player' }] };
};
const loaded = await loadNewerAppData(current);
assert.equal(loaded.manifest.generated_at, 'new');
assert.equal(loaded.players[0].player_name, 'Fresh player');
assert(calls.some(([url]) => url === '/data/players.json?v=new-players'));
assert.deepEqual(loaded.teams, []);
globalThis.fetch = async () => ({ ok: false, status: 503 });
await assert.rejects(loadNewerAppData(current), /503/);
globalThis.fetch = async () => ({ ok: true, json: async () => current });
assert.equal(await loadNewerAppData(current), null);
console.log('New export detection, versioned data loading, and connection recovery passed.');
