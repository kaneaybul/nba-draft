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
