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
const { Waterfall, LeagueComparison, aggregateAttribution } = module.exports;
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
const keys=['player','draft','trades','contracts','fa','own_picks','acquired_picks','lottery','pick_rules','automatic'];
const row=(start,end,opening,closing,key)=>({start,end,opening,closing,categories:Object.fromEntries(keys.map(k=>[k,k===key?closing-opening:0])),components:Object.fromEntries(keys.map(k=>[k,{movement:k===key?closing-opening:0}])),contributors:Object.fromEntries(keys.map(k=>[k,k===key?[{player:'Test player',value:closing-opening}]:[]])),reconciliation_error:0});
const ledger={team:'BOS',method:'rolling-production-attribution-v1',valuation_method:'v5',intervals:[row('a','b',100,120,'draft'),row('b','c',120,110,'contracts')]};
const combined=aggregateAttribution(ledger,'a','c',100,110,'v5');
assert.ok(combined);assert.equal(combined.categories.draft,20);assert.equal(combined.categories.contracts,-10);assert.equal(combined.change,10);assert.equal(Object.keys(combined.categories).length,10);
assert.equal(aggregateAttribution(ledger,'a','c',100,111,'v5'),null,'Never show a chart that does not match canonical totals');
assert.equal(aggregateAttribution({...ledger,method:'holdings-fallback'},'a','c',100,110,'v5'),null,'Only one attribution method is accepted');
assert.equal(aggregateAttribution({...ledger,intervals:[ledger.intervals[1]]},'a','c',100,110,'v5'),null,'Do not bridge missing periods with another method');
assert.equal(aggregateAttribution(ledger,'b','c',120,110,'v5').categories.contracts,-10);
assert.equal(aggregateAttribution(ledger,'a','a',100,100,'v5').change,0);
assert.equal(aggregateAttribution({...ledger,valuation_method:'v4'},'a','c',100,110,'v5'),null);
const malformed=structuredClone(ledger);malformed.intervals[0].components.draft.movement=15;
assert.equal(aggregateAttribution(malformed,'a','c',100,110,'v5'),null,'Category details must reconcile');
console.log('Asset History visual checks passed: one MECE method, multi-period aggregation, reconciliation, missing coverage, rank controls and no fallback.');
