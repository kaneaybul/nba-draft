import assert from "node:assert/strict";
import { retainCachedCapTeams } from "./cap_roster_fallback.mjs";

const previous = { generated_at: "2026-10-03T00:00:00Z", contracts: [{ team: "NOP", id: "nop", cells: [{ year: 2027, amount: 20_000_000 }] }],
  team_seasons: [{ team: "NOP", year: 2027, active_salary: 20_000_000 }], dead_money: [] };
const inputs = { teams: ["NOP"], previous, years: [2027], contracts: [{ team: "NYK", id: "new", cells: [{ year: 2027, amount: 30_000_000 }] }], deadMoney: [],
  teamSeasons: [{ team: "NYK", year: 2027, active_salary: 30_000_000 }, { team: "NOP", year: 2027, active_salary: 0 }] };
const result = retainCachedCapTeams(inputs);
assert.equal(result.teamSeasons.find((row) => row.team === "NOP").active_salary, 20_000_000);
assert.equal(result.teamSeasons.find((row) => row.team === "NYK").active_salary, 30_000_000);
assert.equal(result.contracts.find((row) => row.team === "NOP").source_quality, "cached");
const repeated = retainCachedCapTeams({ ...inputs, previous: { ...previous, generated_at: "2026-10-19T00:00:00Z", cap_fallbacks: result.fallbacks } });
assert.equal(repeated.fallbacks[0].cached_as_of, "2026-10-03T00:00:00Z");
assert.throws(() => retainCachedCapTeams({ ...inputs, previous: null }), /refusing to publish/);
console.log("Roster fallback preserves verified cap figures and their original source timestamp.");

const { mergeSharedContracts } = await import("./shared_contracts.mjs");
const book = { generated_at:"2026-11-04T00:00:00Z",
  contracts:[{team:"NOP",id:"player-1",nba_id:1,player_name:"Signed player",cells:[
    {year:2027,kind:"guaranteed",amount:10},{year:2028,kind:"cap_hold",amount:15}]},
    {team:"NOP",id:"hold-2",nba_id:2,player_name:"Retained rights",cells:[{year:2027,kind:"cap_hold",amount:5}]}],
  dead_money:[{team:"NOP",year:2027,amount:3}],
  team_seasons:[{team:"NOP",year:2027},{team:"NOP",year:2028}]};
const fresh = {complete:true,as_of:"2026-11-05",coverage:{priced_players:1,missing_players:[]},
  players:[{team:"NOP",nba_id:1,player_name:"Signed player",cells:[{year:2027,kind:"guaranteed",amount:20}]}]};
const seed = retainCachedCapTeams({teams:["NOP"],previous:book,years:[2027,2028],contracts:[],deadMoney:[],teamSeasons:[]});
const merged = mergeSharedContracts(fresh,seed.contracts,[2027,2028],p=>"player-"+p.nba_id,s=>s.toLowerCase());
assert.equal(merged.find(r=>r.nba_id===1).cells[0].amount,20,"Fresh signed salary replaces cached pay");
assert.equal(merged.find(r=>r.nba_id===1).cells[1].amount,15,"Future hold survives a roster-only collection");
assert.equal(merged.find(r=>r.nba_id===2).cells[0].amount,5,"Unsigned retained rights survive");
assert.equal(seed.deadMoney[0].amount,3,"Dead money survives");
const next = retainCachedCapTeams({teams:["NOP"],previous:{...book,contracts:merged,cap_fallbacks:seed.fallbacks},years:[2027,2028],contracts:[],deadMoney:[],teamSeasons:[]});
assert.equal(next.fallbacks[0].cached_as_of,book.generated_at,"Repeated exports preserve the original source date");
console.log("Shared salaries refresh while retained cap components survive roster-only collection.");
