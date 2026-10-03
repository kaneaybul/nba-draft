import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalContractRowId,
  cbaCapHoldAmount,
  dedupeDeadMoneyRows,
  exceptionAmount,
  guaranteeInfoForYear,
  mergeDuplicateContractSources,
  parseGuaranteeFromNotes,
  statusBandForAmount
} from "./cap_tracker_rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

testContractSourceDeduping();
testDeadMoneyDeduping();
testCbaFormulas();
testPartialGuaranteeParsing();
testGeneratedPayloadInvariants();

console.log("cap tracker data tests passed");

function testContractSourceDeduping() {
  const rows = mergeDuplicateContractSources([
    { player_name: "Tre Scott", team: "BKN", salary_y0: "129503", source: "bref" },
    { player_name: "Tre Scott", team: "BKN", salary_y0: "129503", source: "bref" },
    { nba_id: "42", player_name: "Example Player", team: "UTA", salary_y0: "100", source: "primary" },
    { nba_id: "42", player_name: "Example Player", team: "UTA", salary_y0: "100", contract_status_y0: "Team Option", source: "bref" }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(canonicalContractRowId(rows.find((row) => row.nba_id === "42"), "UTA"), "player-42");
  assert.match(rows.find((row) => row.nba_id === "42").source, /primary|bref/);
}

function testDeadMoneyDeduping() {
  const { rows, warnings } = dedupeDeadMoneyRows([
    { team: "BOS", year: 2026, player_name: "Charles Bassey", amount: 131970, note: "Exp. 10-day", source: "baseline" },
    { team: "BOS", year: 2026, player_name: "Charles Bassey", amount: 131970, note: "Exp. 10-day", source: "baseline" },
    { team: "BOS", year: 2026, player_name: "Charles Bassey", amount: 50000, note: "Waived", source: "manual" }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(warnings.length, 1);
}

function testCbaFormulas() {
  const season = { salary_cap: 166_000_000, tax_level: 201_690_000, first_apron: 210_321_000, second_apron: 222_775_000 };
  assert.equal(Math.round(exceptionAmount("non_taxpayer_mle", season)), 15_139_200);
  assert.equal(Math.round(exceptionAmount("room_mle", season)), 9_425_480);
  assert.equal(Math.round(cbaCapHoldAmount({ status: "UFA", rights: "Bird", previousSalary: 10_000_000, isRookieScale: false, season })), 19_000_000);
  assert.equal(Math.round(cbaCapHoldAmount({ status: "RFA", rights: "Bird", previousSalary: 7_000_000, isRookieScale: true, season })), 21_000_000);
  assert.equal(statusBandForAmount(150_000_000, season), "Cap Space");
  assert.equal(statusBandForAmount(225_000_000, season), "Over 2nd Apron");
}

function testPartialGuaranteeParsing() {
  const notes = "2026-27: $3,000,000 guaranteed | 2027-28: $3,136,364 guaranteed (player option)";
  const parsed2027 = parseGuaranteeFromNotes(notes, 2027, 9_658_536);
  assert.equal(parsed2027.guaranteed_amount, 3_000_000);
  assert.equal(parsed2027.unguaranteed_amount, 6_658_536);
  assert.equal(parsed2027.guarantee_source, "contract_notes");

  const parsed2028 = parseGuaranteeFromNotes(notes, 2028, 10_097_560);
  assert.equal(parsed2028.guaranteed_amount, 3_136_364);
  assert.equal(parsed2028.unguaranteed_amount, 6_961_196);

  const override = guaranteeInfoForYear(
    { contract_notes: notes, notes: "" },
    2027,
    9_658_536,
    { guaranteed_amount: "4500000", guarantee_deadline: "2026-07-01", note: "Manual verified", source: "override", source_quality: "exact" }
  );
  assert.equal(override.guaranteed_amount, 4_500_000);
  assert.equal(override.unguaranteed_amount, 5_158_536);
  assert.equal(override.guarantee_source, "override");
}

function testGeneratedPayloadInvariants() {
  const payload = JSON.parse(fs.readFileSync(path.join(root, "frontend", "public", "data", "cap_tracker.json"), "utf8"));
  assert.equal(payload.schema_version, 2);
  assert.deepEqual(payload.seasons.map((season) => season.year), [2027, 2028, 2029, 2030, 2031]);
  assert.equal(payload.teams.length, 30);
  assert.equal(payload.team_seasons.length, 150);
  assert.equal(Array.isArray(payload.hard_caps), true);
  assert.equal(duplicateCount(payload.contracts.map((row) => row.id)), 0);
  assert.equal(payload.validation_summary.duplicate_contract_ids, 0);
  assert.equal(payload.validation_summary.duplicate_team_seasons, 0);
  assert.equal(payload.validation_summary.duplicate_dead_money_rows, 0);
  assert.equal(payload.team_seasons.filter((row) => row.room_if_renounced > 0 && row.status_band_renounced !== "Cap Space").length, 0);
  assert.match(payload.source_policy, /Spotrac-first/);
  assert.equal(payload.source_audit.some((row) => row.quality === "spotrac"), true);

  const dallasRows = payload.contracts.filter((row) => row.team === "DAL");
  assert.ok(dallasRows.length >= 20, "Dallas should retain active roster plus cap-hold rows from Spotrac");
  assert.equal(dallasRows.some((row) => row.cells.some((cell) => cell.kind === "cap_hold" && cell.amount > 0)), true);

  const jalen = payload.contracts.find((row) => row.team === "ATL" && row.player_name === "Jalen Johnson");
  assert.ok(jalen, "Jalen Johnson should be present in generated Spotrac cap tracker payload");
  const jalen2027 = jalen.cells.find((cell) => cell.year === 2027);
  const jalen2029 = jalen.cells.find((cell) => cell.year === 2029);
  const jalen2030 = jalen.cells.find((cell) => cell.year === 2030);
  const jalen2031 = jalen.cells.find((cell) => cell.year === 2031);
  assert.equal(jalen2027?.kind, "guaranteed");
  assert.equal(jalen2027?.amount, 30_000_000);
  assert.equal(jalen2029?.kind, "guaranteed");
  assert.equal(jalen2029?.amount, 30_000_000);
  assert.equal(jalen2030?.kind, "guaranteed");
  assert.equal(jalen2030?.amount, 30_000_000);
  assert.equal(jalen2031?.kind, "cap_hold");
  assert.ok(jalen2031?.amount > 0, "Jalen Johnson should carry a positive 2031 cap hold after his 2029-30 salary");
}

function duplicateCount(values) {
  return new Set(values.filter((value, index) => values.indexOf(value) !== index)).size;
}
