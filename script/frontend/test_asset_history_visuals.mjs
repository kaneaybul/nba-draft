import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
const { Waterfall, TradeBreakdown, LeagueComparison, aggregateAttribution, categoryLabels, leagueRows, leagueMetricValue, rankLeague } = module.exports;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
// Render the exact expanded state reached by each category button, without
// changing production components or requiring an external browser service.
const expandedWaterfalls=Object.fromEntries(Object.keys(categoryLabels).map(key=>{
 const scope={exports:{}};
 const requireExpanded=name=>name==='react'?{...React,useState:()=>[key,()=>{}]}:require(name);
 new Function('require','module','exports',compiled)(requireExpanded,scope,scope.exports);
 return [key,scope.exports.Waterfall];
}));

const rangeSource=readFileSync(resolve(frontend,'src/AssetHistoryDateRange.tsx'),'utf8');
const rangeCompiled=ts.transpileModule(rangeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const rangeModule={exports:{}};
new Function('require','module','exports',rangeCompiled)(require,rangeModule,rangeModule.exports);
const {normalizeHistoryRange}=rangeModule.exports;
const refreshedDates=['2026-06-30','2026-10-31','2026-11-05'];
assert.deepEqual(normalizeHistoryRange(refreshedDates,{start:'2026-06-30',end:'2026-11-04'},'2026-11-04'),{start:'2026-06-30',end:'2026-11-05'},'Latest selection follows the replacement daily snapshot');
assert.deepEqual(normalizeHistoryRange(refreshedDates,{start:'2026-06-30',end:'2026-10-31'},'2026-11-04'),{start:'2026-06-30',end:'2026-10-31'},'Historical end dates stay fixed');
assert.deepEqual(normalizeHistoryRange(refreshedDates,{start:'2026-11-04',end:'2026-11-04'},'2026-11-04'),{start:'2026-11-05',end:'2026-11-05'},'A zero-length latest range remains zero-length');
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
assert.match(league, /1\. BOS, Value change: \+\$20M/);
assert.match(league, /2\. UTA, Value change: −\$30M/);
assert.match(league, /Missing matching observations: MIA, ATL/);
assert.match(league, /−\$10M/);
const keys=['aging','player','draft','trades','contracts','fa','own_picks','acquired_picks','lottery','automatic'];
const row=(start,end,opening,closing,key)=>({start,end,opening,closing,categories:Object.fromEntries(keys.map(k=>[k,k===key?closing-opening:0])),components:Object.fromEntries(keys.map(k=>[k,{movement:k===key?closing-opening:0}])),contributors:Object.fromEntries(keys.map(k=>[k,k===key?[{player:'Test player',value:closing-opening}]:[]])),reconciliation_error:0});
const ledger={team:'BOS',method:'forecast-based-attribution-v7',valuation_method:'peak4-payroll-0.8-v5',intervals:[row('a','b',100,120,'draft'),row('b','c',120,110,'contracts')]};

const v13={...ledger,method:'forecast-based-attribution-v8',valuation_method:'peak4-payroll-0.8-v13'};
assert.ok(aggregateAttribution(v13,'a','c',100,110,v13.valuation_method));
assert.equal(aggregateAttribution({...v13,method:'forecast-based-attribution-v7'},'a','c',100,110,v13.valuation_method),null,'v13 must reject stale v7 attribution');
assert.equal(aggregateAttribution({...ledger,method:'forecast-based-attribution-v8'},'a','c',100,110,ledger.valuation_method),null,'Older valuation must reject v8 attribution');
assert.equal(aggregateAttribution({...v13,valuation_method:'peak4-payroll-0.8-v14'},'a','c',100,110,'peak4-payroll-0.8-v14'),null,'Unknown future pairs fail closed');
const combined=aggregateAttribution(ledger,'a','c',100,110,'peak4-payroll-0.8-v5');
assert.ok(combined);assert.equal(combined.categories.draft,20);assert.equal(combined.categories.contracts,-10);assert.equal(combined.change,10);assert.equal(Object.keys(combined.categories).length,10);
assert.equal(aggregateAttribution(ledger,'a','c',100,111,'peak4-payroll-0.8-v5'),null,'Never show a chart that does not match canonical totals');
assert.equal(aggregateAttribution({...ledger,method:'holdings-fallback'},'a','c',100,110,'peak4-payroll-0.8-v5'),null,'Only one attribution method is accepted');
assert.equal(aggregateAttribution({...ledger,intervals:[ledger.intervals[1]]},'a','c',100,110,'peak4-payroll-0.8-v5'),null,'Do not bridge missing periods with another method');
assert.equal(aggregateAttribution(ledger,'b','c',120,110,'peak4-payroll-0.8-v5').categories.contracts,-10);
assert.equal(aggregateAttribution(ledger,'a','a',100,100,'peak4-payroll-0.8-v5').change,0);
assert.equal(aggregateAttribution({...ledger,valuation_method:'peak4-payroll-0.8-v4'},'a','c',100,110,'peak4-payroll-0.8-v5'),null);
const malformed=structuredClone(ledger);malformed.intervals[0].components.draft.movement=15;
assert.equal(aggregateAttribution(malformed,'a','c',100,110,'peak4-payroll-0.8-v5'),null,'Category details must reconcile');
const waived={...ledger,trade_waivers:[{player:'Test player',acquired:'a',waived:'b',dead_cap:100,source:'https://example.com'}]};
assert.deepEqual(aggregateAttribution(waived,'a','b',100,120,'peak4-payroll-0.8-v5').tradeWaivers,waived.trade_waivers);
assert.deepEqual(aggregateAttribution(waived,'b','c',120,110,'peak4-payroll-0.8-v5').tradeWaivers,[]);
assert.deepEqual(aggregateAttribution(ledger,'a','b',100,120,'peak4-payroll-0.8-v5').tradeWaivers,[]);

const trade = { id:'deal-1', date:'b', source:'https://example.com', counterparties:['LAL'], net:27e6, pieces:[
 {id:'low', name:'Reserve', direction:'in', value:2e6},
 {id:'pick', name:'2029 LAL first-round pick', direction:'in', value:30e6},
 {id:'sent', name:'Veteran', direction:'out', value:-5e6},
] };
const traded = {...ledger, trade_deals:[trade, {...trade, id:'deal-2', date:'c'}]};
assert.deepEqual(aggregateAttribution(traded,'a','b',100,120,'peak4-payroll-0.8-v5').tradeDeals,[trade]);
assert.deepEqual(aggregateAttribution(traded,'b','c',120,110,'peak4-payroll-0.8-v5').tradeDeals.map(x=>x.id),['deal-2']);
const dealMarkup = render(TradeBreakdown, {deals:[trade]});
assert.match(dealMarkup,/Net \+\$27M/);
assert.match(dealMarkup,/Incoming.*2029 LAL first-round pick.*Reserve.*Outgoing.*Veteran/);

// Category amounts must come from the same reconciled range as each waterfall.
const teams = [
 {team:'BOS',points:[point('a',100),point('b',120),point('c',110)]},
 {team:'UTA',points:[point('a',100),point('b',95),point('c',125)]},
 {team:'ATL',points:[point('a',100),point('b',140),point('c',150)]},
 {team:'MIA',points:[point('a',100,2),point('b',140),point('c',150)]}
];
const ledgers = {BOS:ledger, UTA:{...ledger,team:'UTA',intervals:[row('a','b',100,95,'draft'),row('b','c',95,125,'contracts')]}};
const rankedRows = leagueRows(teams,ledgers,'a','c',1,'peak4-payroll-0.8-v5');
assert.equal(rankedRows.length,3);
assert.deepEqual(rankLeague(rankedRows,'draft').map(r=>[r.team,r.value]),[['BOS',20],['UTA',-5]]);
assert.deepEqual(rankLeague(rankedRows,'contracts').map(r=>[r.team,r.value]),[['UTA',30],['BOS',-10]]);
assert.deepEqual(rankLeague(rankedRows,'change').map(r=>r.team),['ATL','UTA','BOS']);
assert.deepEqual(rankLeague(leagueRows(teams,ledgers,'b','c',1,'peak4-payroll-0.8-v5'),'draft').map(r=>r.value),[0,0]);
assert.equal(rankLeague(leagueRows(teams,ledgers,'a','c',1,'old'),'draft').length,0);
assert.equal(rankLeague(leagueRows(teams,{...ledgers,BOS:{...ledger,team:'UTA'}},'a','c',1,'peak4-payroll-0.8-v5'),'draft').length,1);
const broken = structuredClone(ledgers);broken.BOS.intervals[0].categories.draft=999;
assert.deepEqual(rankLeague(leagueRows(teams,broken,'a','c',1,'peak4-payroll-0.8-v5'),'draft').map(r=>r.team),['UTA']);
for(const key of keys){
 assert.ok(league.includes(`value="${key}"`),`Missing ranking control: ${key}`);
 for(const team of rankedRows.filter(r=>r.categories)){
  assert.equal(leagueMetricValue(team,key),aggregateAttribution(ledgers[team.team],'a','c',100,team.total,'peak4-payroll-0.8-v5').categories[key]);
 }
}
const completeMarkup=render(LeagueComparison,{teams,ledgers,start:'a',end:'c',cap:1,valuationMethod:'peak4-payroll-0.8-v5',selectedTeam:'UTA',onSelect:()=>{}});
assert.match(completeMarkup,/Waterfall categories unavailable: ATL/);
assert.match(completeMarkup,/aria-sort="descending"/);
assert.match(completeMarkup,/Full league table/);
assert.match(completeMarkup,/Contract Management/);
assert.match(completeMarkup,/Draftee Development/);
assert.match(completeMarkup,/Aging/);
assert.doesNotMatch(completeMarkup,/Player Development &amp; Aging|Draft Value Added/);
const categoryMarkup=render(LeagueComparison,{teams,ledgers,start:'a',end:'c',cap:1,valuationMethod:'peak4-payroll-0.8-v5',selectedTeam:'UTA',metric:'contracts',onSelect:()=>{}});
assert.match(categoryMarkup,/1\. UTA, Contract Management: \$0M/);
assert.match(categoryMarkup,/League combined · Contract Management/);
assert.match(categoryMarkup,/Waterfall categories unavailable: ATL/);

// Exercise every team against the actual published ledgers when available.
const versionSource = readFileSync(resolve(frontend,'../script/asset_history/model_version.py'),'utf8');
const version = versionSource.match(/DATA_VERSION\s*=\s*['"]([^'"]+)['"]/)[1];
const data = resolve(frontend,`public/data/asset_history/${version}`);
if(process.argv.includes('--require-published')) assert.ok(existsSync(resolve(data,'manifest.json')), 'Release requires actual published Asset History feeds');
if(existsSync(resolve(data,'manifest.json'))){
 const manifest=JSON.parse(readFileSync(resolve(data,'manifest.json'),'utf8'));
 assert.equal(manifest.teams.length,30);
 if(version==='v13') assert.equal(manifest.method,'peak4-payroll-0.8-v13');
 const books=Object.fromEntries(manifest.teams.map(t=>[t.team,JSON.parse(readFileSync(resolve(data,`attribution/${t.team}.json`),'utf8'))]));
 for (const book of Object.values(books)) {
  const dealIds = new Set();
  for (const deal of book.trade_deals ?? []) {
   const key = deal.date + deal.id;
   assert.ok(!dealIds.has(key), `Duplicate trade ${book.team} ${key}`);
   dealIds.add(key);
   assert.ok(deal.pieces.length > 0 && deal.counterparties.length > 0);
   assert.ok(Math.abs(deal.pieces.reduce((sum, p) => sum + (p.value ?? 0), 0) - deal.net) < .01);
   assert.ok(deal.pieces.every(p => p.value === null || Number.isFinite(p.value)));
  }
 }
 const dates=manifest.teams[0].points.map(p=>p.date), end=dates.at(-1), cap=manifest.teams[0].points.at(-1).reporting_cap;
 for(const start of [dates[0],'2024-02-29',dates.at(-2),end]){
  const actualRows=leagueRows(manifest.teams,books,start,end,cap,manifest.method);
  assert.equal(actualRows.length,30);
  for(const key of Object.keys(categoryLabels)){
   assert.equal(rankLeague(actualRows,key).length,30,`${start}: missing ${key} attribution`);
   for(const r of actualRows){
    const first=manifest.teams.find(t=>t.team===r.team).points.find(p=>p.date===start);
    const waterfall=aggregateAttribution(books[r.team],start,end,first.total,r.total,manifest.method);
    assert.equal(leagueMetricValue(r,key),waterfall.categories[key]);
    const markup=render(expandedWaterfalls[key],{opening:waterfall.opening,closing:waterfall.closing,
     changes:Object.entries(waterfall.categories).map(([key,value])=>({key,label:key,value})),analysis:waterfall});
    assert.match(markup,/class="ah-drilldown"/,`${r.team} ${start} ${key}: missing expanded category`);
    assert.ok(markup.includes(`<h3>${categoryLabels[key]}</h3>`));
    assert.ok(markup.includes('aria-pressed="true"'));

   }
  }
  for(const r of actualRows)assert.ok(Math.abs(Object.values(r.categories).reduce((a,b)=>a+b,0)-r.change)<.01);
 }
 console.log('Published league checks passed: 30 teams, all ten waterfall categories, four date ranges, and all 1,200 expanded category drilldowns.');
}
console.log('Asset History checks passed: category rankings, signed amounts, dates/cap/method alignment, invalid-data exclusion, and waterfall reconciliation.');
