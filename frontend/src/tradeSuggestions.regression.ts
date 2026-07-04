import { buildTradeSuggestions } from "./App";
import type { AppData, PickAsset, PlayerImpact, TeamProjection } from "./types";

export function runTradeSuggestionRegressionTests(): string[] {
  return [
    targetPlayerAcquisitionBuildsPickPackage()
  ];
}

function targetPlayerAcquisitionBuildsPickPackage(): string {
  const season = 2027;
  const players = [
    player(1, "Package Anchor", "BUY", 8_000_000, [10_000_000, 10_000_000, 10_000_000, 10_000_000], 0.7),
    player(2, "Bench Filler", "BUY", 5_000_000, [2_500_000, 2_500_000, 2_500_000, 2_500_000], 0.1),
    player(3, "Target Wing", "SEL", 20_000_000, [16_000_000, 16_000_000, 16_000_000, 16_000_000], 2.4),
    player(4, "Seller Guard", "SEL", 6_000_000, [7_000_000, 7_000_000, 7_000_000, 7_000_000], 0.5)
  ];
  const picks: PickAsset[] = [{
    asset_id: "buy-2028-second",
    team: "BUY",
    label: "BUY 2028 second",
    pick: 38,
    round: 2,
    normalized: 0.2,
    scale_value: 1,
    value: 6_000_000,
    asset_type: "team_pick",
    origin_team: "BUY",
    draft_year: 2028,
    protection: "unprotected",
    protection_cutoff: 0
  }];
  const teams = [team("BUY", 46, -0.2), team("SEL", 28, 0.15)];
  const data = {
    manifest: { seasons: [season], latest_season: season },
    players,
    teams,
    lineups: [],
    schedules: [],
    picks,
    prospects: [],
    trackerBoardSummary: [],
    trackerBoardScores: [],
    trackerProspectScores: [],
    modelSummary: [],
    capTracker: {
      generated_at: "2027-01-01T00:00:00.000Z",
      source_policy: "regression",
      notes: [],
      seasons: [{
        year: season,
        label: "2026-27",
        salary_cap: 200_000_000,
        tax_level: 240_000_000,
        first_apron: 260_000_000,
        second_apron: 280_000_000,
        salary_floor: 180_000_000,
        minimum_roster_charge: 1_200_000,
        source: "regression",
        source_quality: "modeled"
      }],
      teams: [],
      team_seasons: [],
      contracts: [],
      exceptions: [],
      picks: [],
      dead_money: [],
      max_contracts: [],
      source_audit: []
    }
  } as unknown as AppData;

  const suggestions = buildTradeSuggestions({
    data,
    season,
    players,
    leftTeam: "BUY",
    rightTeam: "SEL",
    teamOptions: teams,
    pickContext: {
      firstRound: [{ pick: 15, probability: 1 }],
      secondRound: [{ pick: 38, probability: 1 }],
      slotValues: new Map([[38, 6_000_000]]),
      yearScale: new Map([[2028, 1]])
    },
    contractMap: new Map(),
    calendar: { tradeDate: "", tradeDeadlineDate: "", regularSeasonEndDate: "" },
    options: { limit: 20, rosterLimit: 4, includePackages: true, minScore: 0 }
  });

  const targetPackage = suggestions.find((suggestion) =>
    suggestion.left.team === "BUY"
    && suggestion.right.assets.length === 1
    && suggestion.right.assets[0]?.player?.player_name === "Target Wing"
    && suggestion.left.assets.length >= 2
    && suggestion.left.assets.some((asset) => asset.kind === "pick")
  );
  expect(targetPackage, "suggestions should include a buyer package built around the target player");
  expect(targetPackage?.reasons.includes("Target package with pick"), "target package suggestion should explain the package construction");
  return "target-player acquisition suggestions build player-plus-pick packages";
}

function team(teamName: string, projectedWins: number, needValue: number): TeamProjection {
  const row: Record<string, unknown> = {
    year: 2027,
    team: teamName,
    team_abbr: teamName,
    projected_wins: projectedWins,
    expected_wins: projectedWins,
    conference_rank: 0,
    playoff_status: ""
  };
  ["FTD", "PASS", "SHOOT", "RIM", "OREB", "DREB", "SWITCH", "DPM", "RIMPRO"].forEach((key) => {
    row[key] = needValue;
  });
  return row as TeamProjection;
}

function player(nbaId: number, name: string, teamName: string, salary: number, values: number[], total: number): PlayerImpact {
  return {
    nba_id: nbaId,
    player_name: name,
    year: 2027,
    team: teamName,
    position: "SF",
    age: 25,
    Minutes: 1800,
    off_dep: total / 2,
    def_dep: total / 2,
    offense: total / 2,
    defense: total / 2,
    total,
    score: total,
    tier: "Regression",
    timin: 0,
    value: values[0] ?? 0,
    trade_value: values.reduce((sum, value) => sum + value, 0),
    fa_value: 0,
    scalability: 1,
    projection_y1: total,
    projection_y2: total,
    projection_y3: total,
    projection_y4: total,
    projection_value_y1: values[0] ?? 0,
    projection_value_y2: values[1] ?? 0,
    projection_value_y3: values[2] ?? 0,
    projection_value_y4: values[3] ?? 0,
    projection_scalability_y1: 1,
    projection_scalability_y2: 1,
    projection_scalability_y3: 1,
    projection_scalability_y4: 1,
    contract: salary,
    contract_status: "Signed"
  } as PlayerImpact;
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
