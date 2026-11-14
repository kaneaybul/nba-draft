import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeSharedContracts,capCells} from './shared_contracts.mjs';
const fixture={complete:true,as_of:'2026-11-04',coverage:{priced_players:2,missing_players:[]},players:[
 {nba_id:1,player_name:'Regular',team:'UTA',cells:[{year:2027,amount:100,cap_amount:90,kind:'guaranteed',counts_against_cap:true}],source:'signed',known_from:'2026-07-01'},
 {nba_id:2,player_name:'Two Way',team:'UTA',two_way:true,cells:[{year:2027,amount:50,cap_amount:0,kind:'guaranteed',counts_against_cap:false}],source:'signed',known_from:'2026-07-01'}]};
const prior=[{id:'old',nba_id:1,player_name:'Regular',team:'UTA',cells:[{year:2027,amount:110,kind:'guaranteed'},{year:2028,amount:200,kind:'cap_hold'}]}];
const merged=mergeSharedContracts(fixture,prior,[2027,2028],p=>'player-'+p.nba_id,s=>s.toLowerCase());
assert.equal(merged.find(p=>p.nba_id===2).cells[0].amount,50);
assert.equal(merged.find(p=>p.nba_id===2).cells[0].source,'contract');
assert.equal(merged.find(p=>p.nba_id===2).cells[0].source_url,'signed');
assert.equal(capCells(merged,2027).reduce((n,c)=>n+(c.amount??0),0),90);
assert.equal(merged.find(p=>p.nba_id===1).cells[1].kind,'cap_hold');
assert.equal(merged.find(p=>p.nba_id===1).cells[1].source,'cached');
assert.equal(merged.length,2);
assert.throws(()=>mergeSharedContracts({...fixture,complete:false},prior,[2027],p=>p.nba_id,s=>s),/Incomplete/);

if(process.argv.includes('--require-export')) {
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const book=JSON.parse(fs.readFileSync(path.join(root,'processed/contracts/current.json'),'utf8'));
 const cap=JSON.parse(fs.readFileSync(path.join(root,'frontend/public/data/cap_tracker.json'),'utf8'));
 const players=JSON.parse(fs.readFileSync(path.join(root,`frontend/public/data/v2/impact_players/${book.season}.json`),'utf8'));
 const active=players.filter(p=>p.pool_status==='roster');
 assert.equal(active.length,book.players.length,'Current roster and the dated contract book must agree');
 for(const p of book.players){
   const row=active.find(r=>(r.source_nba_id??r.nba_id)===p.nba_id);
   assert.ok(row,`Missing active contract player: ${p.player_name}`);
   assert.equal(row.contract,p.current_salary,`Incorrect displayed salary: ${p.player_name}`);
   assert.equal(row.contract_cap_salary,p.cells.find(c=>c.year===book.season).cap_amount,`Incorrect trade-matching salary: ${p.player_name}`);
   for(const future of p.cells.filter(c=>c.year>book.season&&c.year<=book.season+5&&c.amount!=null)){
     assert.equal(row[`projection_contract_y${future.year-book.season}`],future.amount,`Future signed salary differs: ${p.player_name} ${future.year}`);
   }
   const c=cap.contracts.find(r=>r.nba_id===p.nba_id&&r.team===p.team);
   assert.ok(c,`Missing cap contract: ${p.player_name}`);
   for(const cell of p.cells.filter(c=>c.year>=book.season&&c.year<=book.season+4&&c.amount!=null)){
     const displayed=c.cells.find(c=>c.year===cell.year);
     assert.equal(displayed.amount,cell.amount,`Contract amount differs across views: ${p.player_name} ${cell.year}`);
     assert.equal(displayed.cap_amount,cell.cap_amount);
   }
 }
 for(const team of book.teams)for(const y of cap.seasons.map(s=>s.year)){
   const expected=capCells(cap.contracts.filter(p=>p.team===team),y).filter(c=>['guaranteed','partial_guarantee','player_option','team_option','non_guaranteed'].includes(c.kind)).reduce((n,c)=>n+(c.amount??0),0);
   assert.equal(cap.team_seasons.find(r=>r.team===team&&r.year===y).salary_on_books,Math.round(expected));
 }
 assert.equal(cap.cap_fallbacks.length,0,'Player payroll must be rebuilt from the complete shared book');
 console.log(`Complete contract coverage passed: ${book.players.length}/${book.players.length} roster players, 30 teams, all known salary years, and zero missing salaries.`);
}
console.log('Shared contract identity, guaranteed pay, cap charges, retained holds and two-way exemptions passed.');
