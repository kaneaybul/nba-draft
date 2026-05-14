import { deriveSandbox, upsertDecision } from "./capSandbox";
import type { CapSandboxScenario, CapTrackerContractCell, CapTrackerContractRow, CapTrackerData, CapTrackerTeamSeason } from "./types";

export function runCapSandboxRegressionTests(): string[] {
  return [
    waivingPartialGuaranteeAddsOnlyGuaranteedDeadMoney(),
    waivingZeroGuaranteeContractAddsNoDeadMoney(),
    renouncingHoldRecalculatesRoomAndRosterCharges(),
    decliningOptionCreatesEstimatedHold(),
    exceptionsMoveBetweenRetainedAndRoomPaths(),
    existingDeadMoneyIsNotDoubleCounted()
  ];
}

function waivingPartialGuaranteeAddsOnlyGuaranteedDeadMoney(): string {
  const tracker = fixtureTracker([
    playerRow("partial", "Partial Wing", cell(2027, 10_000_000, "partial_guarantee", { guaranteed_amount: 3_000_000, unguaranteed_amount: 7_000_000 }))
  ]);
  const scenario = withDecision("ABC", "partial", 2027, "waive_before_guarantee");
  const result = deriveSandbox(tracker, "ABC", scenario);
  const season = result.teamSeasons.find((row) => row.year === 2027)!;
  const changedCell = result.contracts.find((row) => row.id === "partial")!.cells[0];
  expect(changedCell.kind === "dead" && changedCell.amount === 3_000_000, "partial guarantee waiver should become dead money for guaranteed amount only");
  expect(season.active_salary === 0, "waived partial guarantee should remove active salary");
  expect(season.dead_money === 3_000_000, "waived partial guarantee should add only guaranteed amount to dead money");
  return "waiving a partial guarantee adds only guaranteed dead money";
}

function waivingZeroGuaranteeContractAddsNoDeadMoney(): string {
  const tracker = fixtureTracker([
    playerRow("nongtd", "Non Guarantee", cell(2027, 8_000_000, "non_guaranteed", { guaranteed_amount: 0, unguaranteed_amount: 8_000_000 }))
  ]);
  const result = deriveSandbox(tracker, "ABC", withDecision("ABC", "nongtd", 2027, "waive_before_guarantee"));
  const season = result.teamSeasons.find((row) => row.year === 2027)!;
  const changedCell = result.contracts.find((row) => row.id === "nongtd")!.cells[0];
  expect(changedCell.kind === "empty" && changedCell.amount === 0, "zero-guarantee waiver should remove the cell without dead money");
  expect(season.dead_money === 0, "zero-guarantee waiver should not create dead money");
  return "waiving a zero-guarantee contract removes salary without dead money";
}

function renouncingHoldRecalculatesRoomAndRosterCharges(): string {
  const tracker = fixtureTracker([
    playerRow("signed", "Signed Player", cell(2027, 50_000_000, "guaranteed")),
    playerRow("hold", "Hold Player", cell(2027, 20_000_000, "cap_hold"))
  ]);
  const base = deriveSandbox(tracker, "ABC", null).teamSeasons.find((row) => row.year === 2027)!;
  const sandbox = deriveSandbox(tracker, "ABC", withDecision("ABC", "hold", 2027, "renounce")).teamSeasons.find((row) => row.year === 2027)!;
  expect(sandbox.cap_holds === 0, "renounced hold should remove cap hold amount");
  expect(sandbox.hold_count === 0, "renounced hold should reduce hold count");
  expect(sandbox.room_if_holds_retained > base.room_if_holds_retained, "renouncing hold should increase retained-path room");
  expect(sandbox.roster_charges_with_holds > base.roster_charges_with_holds, "renouncing hold should add a roster charge when below 12 players");
  return "renouncing holds recalculates room and roster charges";
}

function decliningOptionCreatesEstimatedHold(): string {
  const tracker = fixtureTracker([
    playerRow("option", "Option Guard", [
      cell(2026, 10_000_000, "guaranteed"),
      cell(2027, 12_000_000, "team_option")
    ])
  ]);
  const result = deriveSandbox(tracker, "ABC", withDecision("ABC", "option", 2027, "decline"));
  const changedCell = result.contracts.find((row) => row.id === "option")!.cells.find((item) => item.year === 2027)!;
  const season = result.teamSeasons.find((row) => row.year === 2027)!;
  expect(changedCell.kind === "cap_hold", "declined option should become a retained cap hold");
  expect(changedCell.amount === 19_000_000, `declined option hold should use estimated Bird hold; got ${changedCell.amount}`);
  expect(season.option_salary === 0 && season.cap_holds === 19_000_000, "declined option should move money from option salary to cap holds");
  return "declining options creates an estimated hold when rights are retained";
}

function exceptionsMoveBetweenRetainedAndRoomPaths(): string {
  const tracker = fixtureTracker([
    playerRow("signed", "Signed Player", cell(2027, 150_000_000, "guaranteed")),
    playerRow("hold", "Large Hold", cell(2027, 35_000_000, "cap_hold"))
  ]);
  const base = deriveSandbox(tracker, "ABC", null);
  const sandbox = deriveSandbox(tracker, "ABC", withDecision("ABC", "hold", 2027, "renounce"));
  expect(base.exceptions.some((row) => row.year === 2027 && row.path === "retained" && row.name === "Non-Taxpayer MLE"), "over-cap retained path should expose retained exceptions");
  expect(sandbox.exceptions.every((row) => row.year !== 2027 || row.path !== "retained"), "renouncing the hold should remove retained-path exceptions for that year");
  expect(sandbox.exceptions.some((row) => row.year === 2027 && row.path === "renounced" && row.name === "Room Exception"), "renouncing into cap room should expose room exception");
  return "exceptions switch between retained-hold and room paths";
}

function existingDeadMoneyIsNotDoubleCounted(): string {
  const tracker = fixtureTracker([
    playerRow("dead-row", "Waived Player", cell(2027, 5_000_000, "dead"), "dead_money")
  ]);
  tracker.dead_money = [{ id: "dead-row-2027", team: "ABC", year: 2027, player_name: "Waived Player", amount: 5_000_000, source: "test", source_quality: "contract" }];
  const result = deriveSandbox(tracker, "ABC", null);
  const season = result.teamSeasons.find((row) => row.year === 2027)!;
  expect(season.dead_money === 5_000_000, `existing dead money should not be counted twice; got ${season.dead_money}`);
  expect(season.sandbox_dead_money_added === 0, "base dead money should not show as scenario-added dead money");
  return "existing displayed dead money is not double-counted in sandbox mode";
}

function fixtureTracker(rows: CapTrackerContractRow[]): CapTrackerData {
  const seasons = [
    {
      year: 2026,
      label: "2025-26",
      salary_cap: 154_647_000,
      tax_level: 187_895_000,
      first_apron: 195_945_000,
      second_apron: 207_824_000,
      salary_floor: 139_182_300,
      minimum_roster_charge: 1_200_000,
      source: "test",
      source_quality: "contract" as const
    },
    {
      year: 2027,
      label: "2026-27",
      salary_cap: 166_000_000,
      tax_level: 201_690_000,
      first_apron: 210_321_000,
      second_apron: 222_775_000,
      salary_floor: 149_400_000,
      minimum_roster_charge: 1_300_000,
      source: "test",
      source_quality: "contract" as const
    }
  ];
  return {
    schema_version: 2,
    generated_at: "2026-05-13T00:00:00.000Z",
    source_policy: "test",
    notes: [],
    seasons,
    teams: [{ team: "ABC", team_name: "ABC Test", team_abbr: "ABC" }],
    team_seasons: seasons.map((season) => emptyTeamSeason(season.year)),
    contracts: rows,
    exceptions: [],
    picks: [],
    dead_money: [],
    max_contracts: [],
    source_audit: []
  };
}

function emptyTeamSeason(year: number): CapTrackerTeamSeason {
  return {
    team: "ABC",
    year,
    guaranteed_salary: 0,
    option_salary: 0,
    non_guaranteed_salary: 0,
    salary_on_books: 0,
    draft_pick_charges: 0,
    active_salary: 0,
    dead_money: 0,
    cap_holds: 0,
    roster_charges_with_holds: 0,
    roster_charges_renounced: 0,
    likely_books_with_holds: 0,
    likely_books_renounced: 0,
    cap_room_with_holds: 0,
    cap_room_renounced: 0,
    room_if_holds_retained: 0,
    room_if_renounced: 0,
    tax_room: 0,
    first_apron_room: 0,
    second_apron_room: 0,
    tax_room_with_holds: 0,
    tax_room_renounced: 0,
    first_apron_room_with_holds: 0,
    first_apron_room_renounced: 0,
    second_apron_room_with_holds: 0,
    second_apron_room_renounced: 0,
    salary_floor_room: 0,
    roster_count: 0,
    hold_count: 0,
    status_band: "Cap Space",
    source_quality: "contract"
  };
}

function withDecision(team: string, rowId: string, year: number, action: "waive_before_guarantee" | "renounce" | "decline"): CapSandboxScenario {
  const now = "2026-05-13T00:00:00.000Z";
  return upsertDecision({ id: "scenario-test", name: "Scenario", team, created_at: now, updated_at: now, decisions: {} }, { team, row_id: rowId, year, action });
}

function playerRow(id: string, playerName: string, cells: CapTrackerContractCell | CapTrackerContractCell[], rowType: CapTrackerContractRow["row_type"] = "player"): CapTrackerContractRow {
  return {
    id,
    player_name: playerName,
    team: "ABC",
    row_type: rowType,
    display_order: 1,
    source: "test",
    source_quality: "contract",
    cells: Array.isArray(cells) ? cells : [cells]
  };
}

function cell(year: number, amount: number, kind: CapTrackerContractCell["kind"], extra: Partial<CapTrackerContractCell> = {}): CapTrackerContractCell {
  return {
    year,
    amount,
    kind,
    status: kind,
    source: "contract",
    ...extra
  };
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
