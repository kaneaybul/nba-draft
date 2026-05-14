import assert from "node:assert/strict";
import {
  buildContractDeltaMaps,
  buildReviewRows,
  classifyTransaction,
  normalizeMovementPayload,
  parseCsv,
  writeCsv
} from "./cap_transaction_rules.mjs";
import { resolveSalaryRows } from "./cap_salary_resolution.mjs";
import { applyApprovedDeadMoneyRows } from "./cap_review_state.mjs";

testClassification();
testMovementNormalizationAndFiltering();
testStatusPreservationAndDeduping();
testContractDeltas();
testSalaryResolution();
testCapReviewApplyIdempotency();
testCsvRoundTrip();

console.log("cap transaction rule tests passed");

function testClassification() {
  assert.equal(classifyTransaction("Waived G Kobe Bufkin.").classification, "waive_release");
  assert.equal(classifyTransaction("Signed DaQuan Jeffries to a 10-day contract.").classification, "ten_day_signing");
  assert.equal(classifyTransaction("Converted Jordan Miller from a two-way contract to a regular contract.").classification, "two_way_conversion");
  assert.equal(classifyTransaction("Acquired James Harden from the Clippers in exchange for Darius Garland.").classification, "trade");
  assert.equal(classifyTransaction("Exercised team option on Brandin Podziemski.").classification, "option_decision");
  assert.equal(classifyTransaction("Signed a rookie scale extension.").classification, "extension");
  assert.equal(classifyTransaction("Fined Anthony Gill $35,000.").capRelevant, false);
  assert.equal(classifyTransaction("Assigned a player to the G League.").capRelevant, false);
}

function testMovementNormalizationAndFiltering() {
  const payload = {
    NBA_Player_Movement: {
      columns: [
        { Name: "TRANSACTION_DATE" },
        { Name: "PLAYER_ID" },
        { Name: "PLAYER_NAME" },
        { Name: "TEAM_ABBREVIATION" },
        { Name: "TRANSACTION_TYPE" },
        { Name: "DESCRIPTION" }
      ],
      rows: [
        ["2026-02-20T00:00:00", 1630001, "Norchad Omier", "LAC", "Signing", "Signed Norchad Omier to a two-way contract."],
        ["2026-02-21T00:00:00", 1630002, "Injured Player", "LAC", "Injury", "Placed Injured Player on the injury list."],
        ["2026-03-31T00:00:00", 1631351, "lucas-williamson", "", "Signing", "Memphis Grizzlies signed guard Lucas Williamson to a 10-Day Contract."]
      ]
    }
  };
  const normalized = normalizeMovementPayload(payload, { sourceUrl: "fixture" });
  assert.equal(normalized.length, 3);
  const review = buildReviewRows(normalized, { startDate: "2026-02-01", endDate: "2026-03-31" });
  assert.equal(review.length, 2);
  assert.equal(review[0].classification, "ten_day_signing");
  assert.equal(review[0].player_name, "Lucas Williamson");
  assert.equal(review[0].team_to, "MEM");
  assert.equal(review[1].classification, "two_way_signing");
  assert.equal(review[1].team_to, "LAC");
  assert.equal(review[0].source_url, "fixture");
}

function testStatusPreservationAndDeduping() {
  const transactions = [
    {
      transaction_date: "2026-03-03",
      nba_id: "123",
      player_name: "Darius Brown",
      team_to: "CLE",
      transaction_type: "Waive",
      raw_text: "Waived G Darius Brown.",
      source: "fixture",
      source_url: "fixture"
    },
    {
      transaction_date: "2026-03-03",
      nba_id: "123",
      player_name: "Darius Brown",
      team_to: "CLE",
      transaction_type: "Waive",
      raw_text: "Waived G Darius Brown.",
      source: "fixture",
      source_url: "fixture"
    }
  ];
  const first = buildReviewRows(transactions, { startDate: "2026-03-01", endDate: "2026-03-31" });
  assert.equal(first.length, 1);
  const second = buildReviewRows(transactions, {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    priorRows: [{ ...first[0], status: "approved" }]
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].status, "approved");
}

function testContractDeltas() {
  const previous = [
    { nba_id: "42", player_name: "Example Player", team: "BOS", salary_y0: "100", free_agent_year: "2026" }
  ];
  const current = [
    { nba_id: "42", player_name: "Example Player", team: "NYK", salary_y0: "200", free_agent_year: "2027" }
  ];
  const { deltaById } = buildContractDeltaMaps(previous, current);
  const delta = deltaById.get("42");
  assert.match(delta, /team:BOS=>NYK/);
  assert.match(delta, /salary_y0:100=>200/);
  assert.match(delta, /free_agent_year:2026=>2027/);
}

function testSalaryResolution() {
  const rows = [
    {
      transaction_key: "waive",
      transaction_date: "2026-02-08",
      nba_id: "203957",
      player_name: "Dante Exum",
      team_to: "WAS",
      classification: "waive_release",
      raw_text: "Washington Wizards waived guard Dante Exum.",
      status: "pending_review"
    },
    {
      transaction_key: "claim",
      transaction_date: "2026-02-09",
      nba_id: "1",
      player_name: "Claimed Player",
      team_to: "UTA",
      classification: "waiver_claim",
      raw_text: "Utah Jazz claimed Claimed Player off waivers.",
      status: "pending_review"
    }
  ];
  const resolved = resolveSalaryRows(rows, {
    spotrac: [{ source_kind: "spotrac", nba_id: "203957", player_name: "Dante Exum", team: "WAS", dead_money: 3303774, source_url: "authorized.csv", label: "Authorized Spotrac source" }],
    contracts: [],
    deadMoney: []
  });
  assert.equal(resolved[0].salary_resolution_status, "exact");
  assert.equal(resolved[0].suggested_amount, "3303774");
  assert.equal(resolved[0].source_quality, "override");
  assert.equal(resolved[1].salary_resolution_status, "reconciled");
  assert.equal(resolved[1].suggested_amount, "");
}

function testCapReviewApplyIdempotency() {
  const rows = [
    {
      transaction_key: "2026-02-08|203957|waive_release|washingtonwizardswaivedguarddanteexum",
      transaction_date: "2026-02-08",
      nba_id: "203957",
      player_name: "Dante Exum",
      team_to: "WAS",
      classification: "waive_release",
      raw_text: "Washington Wizards waived guard Dante Exum.",
      salary_resolution_status: "exact",
      suggested_amount: "3303774",
      approved_amount: "3303774",
      source_quality: "override",
      salary_source_url: "authorized.csv",
      status: "approved"
    },
    {
      transaction_key: "signing",
      transaction_date: "2026-02-08",
      player_name: "Signed Player",
      team_to: "WAS",
      classification: "signing",
      suggested_amount: "100",
      status: "approved"
    }
  ];
  const first = applyApprovedDeadMoneyRows(rows, [], "2026-05-14T00:00:00.000Z");
  assert.equal(first.additions.length, 1);
  assert.equal(first.rows[0].status, "applied");
  assert.equal(first.rows[0].applied_amount, "3303774");
  assert.equal(first.rows[1].status, "approved");

  const second = applyApprovedDeadMoneyRows(first.rows.map((row) => ({ ...row, status: row.transaction_key === rows[0].transaction_key ? "approved" : row.status })), first.deadMoneyRows, "2026-05-14T01:00:00.000Z");
  assert.equal(second.additions.length, 0);
  assert.equal(second.deadMoneyRows.length, 1);
  assert.equal(second.rows[0].status, "applied");
  assert.equal(second.rows[0].applied_key, first.rows[0].applied_key);
}

function testCsvRoundTrip() {
  const rows = [{ a: "one", b: "two, with comma", c: "quote \"inside\"" }];
  assert.deepEqual(parseCsv(writeCsv(rows, ["a", "b", "c"])), rows);
}
