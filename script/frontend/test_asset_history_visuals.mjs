import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const frontend = process.env.ASSET_HISTORY_FRONTEND || resolve('frontend');
const require = createRequire(resolve(frontend, 'package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = readFileSync(resolve(frontend, 'src/AssetHistoryCharts.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { Waterfall, LeagueComparison } = module.exports;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const changes = [{key:'gain',label:'Gain',value:30e6},{key:'loss',label:'Loss',value:-60e6}];
const waterfall = render(Waterfall, {opening:100e6,closing:70e6,changes});
assert.match(waterfall, /Asset value changed from \$100M to \$70M/);
assert.match(waterfall, /\+\$30M/);
assert.match(waterfall, /−\$60M/);
assert.match(waterfall, /#f18f99/);
assert.doesNotMatch(render(Waterfall, {opening:100e6,closing:80e6,changes}), /<svg/);
assert.doesNotMatch(render(Waterfall, {opening:NaN,closing:80e6,changes}), /<svg/);
const point = (date,total,cap=1) => ({date,total,players:total*.7,picks:total*.3,reporting_cap:cap,vintage:'reconstructed'});
const league = render(LeagueComparison, {teams:[
 {team:'UTA',points:[point('a',100e6),point('b',70e6)]},
 {team:'BOS',points:[point('a',100e6),point('b',120e6)]},
 {team:'MIA',points:[point('a',100e6,2),point('b',130e6)]},
 {team:'ATL',points:[point('b',140e6)]}
],start:'a',end:'b',cap:1,selectedTeam:'UTA',onSelect:()=>{}});
assert.match(league, /2 \/ 2/);
assert.match(league, /1\. BOS, change: \+\$20M/);
assert.match(league, /2\. UTA, change: −\$30M/);
assert.match(league, /Missing matching observations: MIA, ATL/);
assert.match(league, /−\$10M/);
const saved=JSON.parse(readFileSync(resolve(frontend,'public/data/asset_history/analysis/UTA_2024-02-29_2026-11-01.json'),'utf8'));
assert.ok(Math.abs(saved.opening+Object.values(saved.categories).reduce((a,b)=>a+b,0)-saved.closing)<.01);
for(const [key,value] of Object.entries(saved.categories))assert.ok(Math.abs(Object.values(saved.components[key]).reduce((a,b)=>a+b,0)-value)<.01);
assert.equal(saved.draft_endpoint_benchmark.included_in_waterfall,false);
console.log('Asset History visual regression checks passed: waterfall reconciliation, gains/losses, invalid data, same-date/cap ranking, missing coverage and saved attribution.');
