// Check the real six dated feeds, independently integrating raw production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(resolve(root,'frontend/package.json'));
const compiled=await require('esbuild').build({stdin:{contents:'export {futureValue4y,getPlayerSortValue,futureScale4y} from "./App"; export {withAssetValueContext,playerFourYearAssetValue} from "./assetValue";',resolveDir:resolve(root,'frontend/src'),loader:'ts'},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'esm',target:'es2022',logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const read=p=>JSON.parse(readFileSync(resolve(root,'frontend/public',p.replace(/^\//,'')),'utf8'));
const index=read('/data/asset_valuation.json');
let priced=0,unavailable=0;
for(const [year,entry] of Object.entries(index.seasons)) {
 const feed=read(entry.path);
 for(const [id,q] of Object.entries(feed.players)) {
  const [player]=api.withAssetValueContext([{nba_id:Number(id),year:Number(year),value:123,scalability:0.7}],undefined,feed);
  const result=api.futureValue4y(player);
  if(!q.annual?.length || !q.raw_annual_production?.length) {
   assert.equal(result,null);unavailable++;continue;
  }
  assert.equal(q.raw_annual_production.length,q.annual.length);
  assert(Math.abs(q.annual.reduce((s,r)=>s+r.exposure,0)-4)<1e-8);
  const expected=q.raw_annual_production.reduce((s,r)=>{
   const rows=q.annual.filter(a=>a.season===r.season);assert.equal(rows.length,1);
   return s+r.production*rows[0].exposure;
  },0);
  assert(Math.abs(result-expected)<1e-6);
  assert.equal(api.getPlayerSortValue(player,'future_value_4y'),result);
  assert.equal(api.getPlayerSortValue(player,'value'),123);
  assert.equal(api.playerFourYearAssetValue(player),q.value);
  assert.equal(api.futureScale4y(player),0.7);
  priced++;
 }
}
const currentPlayers=read('/data/v2/impact_players/2027.json');
const hydrated=api.withAssetValueContext(currentPlayers,undefined,index);
let currentPriced=0;
for(const p of hydrated) {
 const value=api.futureValue4y(p);
 if(value!==null)currentPriced++;
 else assert.equal(api.getPlayerSortValue(p,'future_value_4y'),null);
}
const [early]=api.withAssetValueContext([{nba_id:2544,year:2020,value:999,projection_value_y1:999}],undefined,index);
assert.equal(api.futureValue4y(early),null,'No legacy sum outside rolling feed coverage');
assert.equal(currentPriced,523);
console.log(JSON.stringify({seasons:Object.keys(index.seasons).length,priced,unavailable,currentRows:currentPlayers.length,currentPriced,currentUnavailable:currentPlayers.length-currentPriced}));
