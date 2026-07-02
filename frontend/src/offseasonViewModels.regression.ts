import { buildOffseasonViewModels, filterOffseasonEvents } from "./offseasonViewModels";
import type { MarketResolution } from "./types";

type FixtureRun = Parameters<typeof buildOffseasonViewModels>[0];
type SigningOverrides = {
  status?: string;
  offerSheetTeam?: string;
  matched?: boolean;
  years?: number;
};

export function runOffseasonViewModelRegressionTests(): string[] {
  return [
    rfaOfferSheetsAreSeparatedFromOrdinarySignings(),
    unsignedMarketsBecomeFinalStateEvents(),
    draftedProspectsDoNotBecomeUnsignedMarkets(),
    selectedTeamFilteringIncludesBothSidesOfMovement(),
    emptyTransactionRunsStillProduceReadableDigest(),
    multiRunSignalsAttachOnlyWhenPresent(),
    multiRunMarketSignalsAttachToMarketStories()
  ];
}

function rfaOfferSheetsAreSeparatedFromOrdinarySignings(): string {
  const run = fixtureRun({
    freeAgency: [
      signing("rfa1", "Restricted Keeper", "AAA", "BBB", 12_000_000, { status: "RFA", offerSheetTeam: "BBB", matched: true }),
      signing("rfa2", "Restricted Walker", "CCC", "DDD", 10_000_000, { status: "RFA", offerSheetTeam: "DDD", matched: false })
    ],
    marketResolutions: [
      resolution("rfa1", "Restricted Keeper", "matched"),
      resolution("rfa2", "Restricted Walker", "declined")
    ]
  });
  const vm = buildOffseasonViewModels(run);
  const rfaEvents = vm.events.filter((event) => event.kind === "rfa_match");
  expect(rfaEvents.length === 2, `expected 2 RFA events; got ${rfaEvents.length}`);
  expect(vm.marketStories.some((story) => story.player === "Restricted Keeper" && story.matched), "matched RFA should preserve match flag");
  expect(vm.marketStories.some((story) => story.player === "Restricted Walker" && story.matched === false), "declined RFA should preserve declined flag");
  return "RFA matched and declined offer sheets become distinct market stories";
}

function unsignedMarketsBecomeFinalStateEvents(): string {
  const run = fixtureRun({
    players: [player("u1", "Unsigned Rotation", "AAA", "UFA", 8_500_000)],
    marketResolutions: [unresolved("u1", "Unsigned Rotation", "No acceptable roster spot remained.")]
  });
  const vm = buildOffseasonViewModels(run);
  const event = vm.events.find((row) => row.kind === "unsigned" && row.player === "Unsigned Rotation");
  expect(Boolean(event), "unsigned player should become a final-state tape event");
  expect(event?.why === "No acceptable roster spot remained.", "unsigned event should carry unresolved reason");
  expect(vm.marketStories.some((story) => story.player === "Unsigned Rotation" && story.winner === "Unsigned"), "unresolved player should become market story");
  return "unsigned free agents become final-state events and unresolved market stories";
}

function draftedProspectsDoNotBecomeUnsignedMarkets(): string {
  const prospect = player("prospect-1", "Drafted Duplicate", "FA", "Rookie FA", 12_000_000);
  const run = fixtureRun({
    draft: [draftPick(1, "AAA", "Drafted Duplicate")],
    players: [prospect],
    freeAgency: [],
    marketResolutions: [unresolved("prospect-1", "Drafted Duplicate", "No team used a roster spot.")]
  });
  const vm = buildOffseasonViewModels(run);
  expect(!vm.events.some((event) => event.kind === "unsigned" && event.player === "Drafted Duplicate"), "drafted prospects should not also appear as unsigned free agents");
  expect(!vm.marketStories.some((story) => story.player === "Drafted Duplicate"), "drafted prospects should not appear on the unsigned market board");
  return "drafted prospects are excluded from unsigned free-agent views";
}

function selectedTeamFilteringIncludesBothSidesOfMovement(): string {
  const run = fixtureRun({
    freeAgency: [signing("fa1", "Mover", "AAA", "BBB", 9_000_000)],
    trades: [trade("t1", "AAA", "CCC", "Traded Wing")]
  });
  const vm = buildOffseasonViewModels(run);
  const aaa = filterOffseasonEvents(vm.events, { team: "AAA" }).map((event) => event.id);
  const bbb = filterOffseasonEvents(vm.events, { team: "BBB" }).map((event) => event.id);
  const ccc = filterOffseasonEvents(vm.events, { team: "CCC" }).map((event) => event.id);
  expect(aaa.some((id) => id.startsWith("fa-fa1")), "old team should see outgoing signing");
  expect(bbb.some((id) => id.startsWith("fa-fa1")), "new team should see incoming signing");
  expect(aaa.some((id) => id.startsWith("trade-t1")), "seller should see trade");
  expect(ccc.some((id) => id.startsWith("trade-t1")), "buyer should see trade");
  return "selected-team filtering includes outgoing and incoming movements";
}

function emptyTransactionRunsStillProduceReadableDigest(): string {
  const run = fixtureRun({ freeAgency: [], trades: [], draft: [], options: [], players: [] });
  const vm = buildOffseasonViewModels(run);
  expect(vm.digest.headline.length > 0, "digest should have fallback headline");
  expect(vm.events.some((event) => event.kind === "cap_path"), "cap-path events should still exist");
  expect(vm.marketStories.length === 0, "no signings or unresolved markets should produce no market stories");
  return "no-trade/no-signing runs still produce a readable digest";
}

function multiRunSignalsAttachOnlyWhenPresent(): string {
  const run = fixtureRun({ trades: [trade("t1", "AAA", "CCC", "Traded Wing")] });
  const without = buildOffseasonViewModels(run);
  const withBatch = buildOffseasonViewModels(run, {
    runs: 50,
    playerDestinations: [],
    optionDecisions: [{ player: "Option Wing", team: "AAA", decision: "exercise", optionType: "Team Option", count: 42, pct: 0.84 }],
    draftOutcomes: [{ prospect: "Prospect One", team: "AAA", count: 31, pct: 0.62, avgPick: 1.4 }],
    tradeTeams: [{ team: "CCC", count: 19, pct: 0.38 }],
    teamOutcomes: [{ team: "AAA", outcome: "Room team", count: 34, pct: 0.68, avgPayroll: 120_000_000, avgCapSpace: 16_000_000, avgTaxRoom: 50_000_000 }],
    rfaMatches: [],
    volatileDecisions: [{ entity: "Player X", outcome: "AAA vs BBB", count: 21, pct: 0.42 }],
    unresolvedMarkets: []
  });
  expect(without.teamStories.find((story) => story.team === "AAA")?.outcomePct === undefined, "single run should not invent batch pct");
  expect(withBatch.teamStories.find((story) => story.team === "AAA")?.outcomePct === 0.68, "batch pct should attach to team story");
  const optionEvent = withBatch.events.find((event) => event.id === "option-AAA-opt1");
  expect(optionEvent?.outcomePct === 0.84, "batch option decision pct should attach to option event");
  expect(optionEvent?.outcomeLabel === "Exercise Team Option", "batch option decision should label the exact exercise/decline outcome");
  expect(optionEvent?.outcomeCount === 42, "batch option decision should attach run count");
  expect(filterOffseasonEvents(withBatch.events, { query: "exercise team option" }).some((event) => event.id === "option-AAA-opt1"), "option batch label should be searchable from the tape");
  expect(without.events.find((event) => event.id === "draft-1-AAA")?.outcomePct === undefined, "single-run draft event should not invent draft pairing pct");
  const draftEvent = withBatch.events.find((event) => event.id === "draft-1-AAA");
  expect(draftEvent?.outcomePct === 0.62, "batch draft pairing pct should attach to draft event");
  expect(draftEvent?.outcomeLabel === "AAA draft pairing", "batch draft pairing should label the repeated team fit");
  expect(draftEvent?.outcomeCount === 31, "batch draft pairing should attach run count");
  expect(draftEvent?.outcomeAvgPick === 1.4, "batch draft pairing should attach average pick");
  expect(filterOffseasonEvents(withBatch.events, { query: "draft pairing" }).some((event) => event.id === "draft-1-AAA"), "draft batch label should be searchable from the tape");
  const tradeEvent = withBatch.events.find((event) => event.id === "trade-t1");
  expect(tradeEvent?.outcomePct === 0.38, "batch trade-team pct should attach to trade event");
  expect(tradeEvent?.outcomeLabel === "CCC trade involvement", "batch trade-team signal should label team trade involvement without implying exact package repetition");
  expect(tradeEvent?.outcomeCount === 19, "batch trade-team signal should attach run count");
  expect(filterOffseasonEvents(withBatch.events, { query: "trade involvement" }).some((event) => event.id === "trade-t1"), "trade batch label should be searchable from the tape");
  expect(withBatch.digest.volatile[0]?.label === "Player X", "batch volatility should drive digest volatility");
  return "multi-run signals attach when present and stay absent otherwise";
}

function multiRunMarketSignalsAttachToMarketStories(): string {
  const run = fixtureRun({
    freeAgency: [
      signing("fa0", "Starter Move", "AAA", "BBB", 14_000_000),
      signing("rfa1", "Restricted Keeper", "AAA", "CCC", 11_000_000, { status: "RFA", offerSheetTeam: "CCC", matched: true })
    ],
    players: [player("u1", "Unsigned Rotation", "AAA", "UFA", 8_500_000)],
    marketResolutions: [unresolved("u1", "Unsigned Rotation", "No acceptable roster spot remained.")]
  });
  const without = buildOffseasonViewModels(run);
  const withBatch = buildOffseasonViewModels(run, {
    runs: 50,
    playerDestinations: [{ player: "Starter Move", destination: "BBB", count: 38, pct: 0.76, avgSalary: 13_600_000 }],
    optionDecisions: [],
    draftOutcomes: [],
    tradeTeams: [],
    teamOutcomes: [],
    rfaMatches: [{ player: "Restricted Keeper", matches: 18, offers: 30, pct: 0.6 }],
    volatileDecisions: [],
    unresolvedMarkets: [{ entity: "Unsigned Rotation", outcome: "Unsigned in run", count: 22, pct: 0.44 }]
  });
  const signedWithout = without.marketStories.find((story) => story.player === "Starter Move");
  const signedWith = withBatch.marketStories.find((story) => story.player === "Starter Move");
  const rfaWith = withBatch.marketStories.find((story) => story.player === "Restricted Keeper");
  const unsignedWith = withBatch.marketStories.find((story) => story.player === "Unsigned Rotation");

  expect(signedWithout?.outcomePct === undefined, "single-run market story should not invent destination pct");
  expect(signedWith?.outcomePct === 0.76, "signed market story should attach batch destination pct");
  expect(signedWith?.outcomeLabel === "BBB destination", "signed market story should label the repeated destination");
  expect(signedWith?.outcomeCount === 38, "signed market story should attach repeated destination count");
  expect(signedWith?.outcomeAvgSalary === 13_600_000, "signed market story should attach average batch salary");
  expect(rfaWith?.rfaMatchPct === 0.6, "RFA market story should attach batch match pct");
  expect(rfaWith?.rfaMatchCount === 18 && rfaWith.rfaOfferCount === 30, "RFA market story should attach batch match counts");
  expect(unsignedWith?.outcomePct === 0.44, "unsigned market story should attach unresolved batch pct");
  expect(unsignedWith?.outcomeLabel === "Unsigned in run", "unsigned market story should preserve unresolved outcome label");
  expect(unsignedWith?.outcomeCount === 22, "unsigned market story should attach unresolved run count");
  return "multi-run market destination and unresolved signals attach to market stories";
}

function fixtureRun(overrides: Partial<FixtureRun>): FixtureRun {
  const basePlayers = [player("base1", "Base Guard", "AAA", "Signed", 5_000_000)];
  return {
    season: 2026,
    capYear: 2027,
    draftYear: 2026,
    draft: overrides.draft ?? [draftPick(1, "AAA", "Prospect One")],
    options: overrides.options ?? [option("opt1", "Option Wing", "AAA", "exercise")],
    freeAgency: overrides.freeAgency ?? [signing("fa0", "Starter Move", "AAA", "BBB", 14_000_000)],
    trades: overrides.trades ?? [],
    teams: overrides.teams ?? [team("AAA"), team("BBB"), team("CCC"), team("DDD")],
    players: overrides.players ?? basePlayers,
    marketBids: overrides.marketBids ?? [],
    marketLedger: overrides.marketLedger ?? [],
    marketResolutions: overrides.marketResolutions ?? []
  };
}

function player(id: string, name: string, team: string, status: string, marketValue: number) {
  return {
    id,
    name,
    team,
    incumbentTeam: team,
    rightsTeam: team,
    status,
    position: "G",
    salary: marketValue,
    marketValue,
    tier: "Rotation",
    expectedMarketMinutes: 1500
  };
}

function team(code: string) {
  return {
    team: code,
    name: code,
    mode: "playoff hopeful",
    capPath: code === "BBB" ? "cap_room" : "retained_rights",
    capPathReason: `${code} default path`,
    payroll: 130_000_000,
    capSpace: code === "BBB" ? 18_000_000 : -4_000_000,
    taxRoom: 40_000_000,
    firstApronRoom: 50_000_000,
    secondApronRoom: 60_000_000,
    rosterCount: 13,
    standardRosterLimit: 15,
    minimumRosterCount: 12,
    rosterCore: [`${code} Star`],
    needs: ["SHOOT"],
    strength: { projectedWins: 42, rank: 14, conferenceRank: 7, playoffStatus: "Play-In" },
    roster: [{ id: `${code}-p`, name: `${code} Star`, position: "G", salary: 30_000_000, minutes: 2400, total: 2.1, tier: "Starter" }]
  };
}

function draftPick(pick: number, pickTeam: string, name: string) {
  return {
    pick,
    team: pickTeam,
    prospect: { id: `prospect-${pick}`, name, position: "F", tier: "Starter", rank: pick },
    consensusRank: pick,
    modelRank: pick + 1,
    fitDelta: 0.1,
    reachSteal: "Range" as const,
    score: score(),
    explanation: `${pickTeam} takes ${name}.`,
    plausibility: 0.7
  };
}

function option(id: string, name: string, optionTeam: string, decision: "exercise" | "decline") {
  return {
    player: player(id, name, optionTeam, "Team Option", 6_000_000),
    team: optionTeam,
    optionType: "Team Option",
    decision,
    score: score(),
    explanation: `${optionTeam} will ${decision} ${name}.`,
    plausibility: 0.75
  };
}

function signing(id: string, name: string, fromTeam: string, toTeam: string, annualSalary: number, overrides: SigningOverrides = {}) {
  const status = overrides.status ?? "UFA";
  const incumbentDecision: "matched" | "declined" | "not_applicable" = overrides.matched ? "matched" : overrides.offerSheetTeam ? "declined" : "not_applicable";
  return {
    player: player(id, name, fromTeam, status, annualSalary),
    fromTeam,
    toTeam,
    status,
    years: overrides.years ?? 3,
    annualSalary,
    totalSalary: annualSalary * (overrides.years ?? 3),
    tool: "cap",
    matched: overrides.matched,
    offerSheetTeam: overrides.offerSheetTeam,
    score: score(),
    context: {
      toolName: "Cap room",
      capPath: "cap_room",
      runnerUpTeam: fromTeam,
      runnerUpBid: annualSalary * 0.92,
      highestBidTeam: toTeam,
      highestBid: annualSalary,
      moneyGap: annualSalary * 0.08,
      expectedMarketMinutes: 1800,
      marketMinutesSource: "fixture",
      incumbentDecision,
      incumbentDecisionReason: overrides.matched ? "Incumbent matched exact terms." : overrides.offerSheetTeam ? "Incumbent declined exact terms." : undefined,
      logic: [`${toTeam} had clean cap access.`],
      losingReasons: [`${fromTeam} would not meet the price.`],
      limiter: "fixture"
    },
    explanation: `${toTeam} signs ${name}.`,
    plausibility: 0.66
  };
}

function trade(id: string, seller: string, buyer: string, name: string) {
  return {
    id,
    teamA: seller,
    teamB: buyer,
    player: player(`${id}-p`, name, seller, "Signed", 11_000_000),
    salary: 11_000_000,
    pickValue: 8_000_000,
    buyerGets: [name],
    sellerGets: ["Pick value"],
    sellerMotivation: "Seller creates flexibility.",
    buyerMotivation: "Buyer adds rotation help.",
    scoreA: score(),
    scoreB: score(),
    explanation: `${buyer} acquires ${name}.`,
    plausibility: 0.52
  };
}

function resolution(playerId: string, playerName: string, result: "matched" | "declined"): MarketResolution {
  return {
    playerId,
    player: playerName,
    round: 0,
    tier: "fixture",
    winnerTeam: result === "matched" ? "AAA" : "DDD",
    finalTeam: result === "matched" ? "AAA" : "DDD",
    offerSheetTeam: "DDD",
    finalAav: 10_000_000,
    clearingRule: "fixture",
    rfaMatchResult: result
  };
}

function unresolved(playerId: string, playerName: string, unresolvedReason: string): MarketResolution {
  return {
    playerId,
    player: playerName,
    round: 0,
    tier: "fixture",
    clearingRule: "fixture",
    unresolvedReason
  };
}

function score() {
  return {
    needFit: 0.6,
    value: 0.5,
    timeline: 0.5,
    urgency: 0.5,
    taxPain: 0.2,
    assetValue: 0.4,
    replacement: 0.4,
    upsideRisk: 0.4,
    incumbency: 0.3,
    randomness: 0,
    total: 0.54
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
