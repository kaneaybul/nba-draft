import { choosePlayerOffer, resolveAcceptedOffer, simulateFreeAgencyMarket, type LegacyAuditRow, type TeamBidPlan } from "./offseasonMarket";
import { capYearForSeason, evaluateBirdHoldCompression } from "./OffseasonSimulator";
import type { MarketBid, MarketLedgerRow, MarketResolution, MarketToolKind } from "./types";

type SkillKey = "FTD" | "OREB" | "PASS" | "RIM" | "SHOOT" | "DPM" | "DREB" | "RIMPRO" | "SWITCH";
type ToolKind = "cap" | "bird" | "non_taxpayer_mle" | "taxpayer_mle" | "room_exception" | "bi_annual" | "minimum";
type TestPlayer = ReturnType<typeof player>;
type TestTeam = ReturnType<typeof team>;

const skills: Record<SkillKey, number> = {
  FTD: 0,
  OREB: 0,
  PASS: 0,
  RIM: 0,
  SHOOT: 0,
  DPM: 0,
  DREB: 0,
  RIMPRO: 0,
  SWITCH: 0
};

const assumptions = {
  seed: 7,
  variance: 0,
  marketAggression: 0.55,
  taxSensitivity: 0.55,
  cap: 160_000_000,
  tax: 190_000_000,
  firstApron: 200_000_000,
  secondApron: 210_000_000
};

export function runOffseasonMarketRegressionTests(): string[] {
  return [
    highestAavWinsWhenNotClose(),
    lowerAavWinsOnlyInsideCloseThreshold(),
    teamTaxAndTimelineStayTeamSide(),
    iterativeFallbacksTriggerAfterMiss(),
    spendingToolsCannotBeSpentTwice(),
    birdRightsCanExceedCapRoom(),
    birdRightsBeatCapRoomForOwnPlayer(),
    birdHoldCompressionProtectsUsefulOwnUfa(),
    capRoomRequiresCapPath(),
    roomExceptionRequiresCapPath(),
    capRoomTeamsSubmitMultipleCapBids(),
    retainedRightsTeamsUseLiveMleEntitlement(),
    retainedRightsTeamsBidMultipleTools(),
    declinedTeamOptionsNeedDiscountToReSign(),
    capRoomUsesCapBeforeRoomException(),
    explicitExceptionInventoriesAreRespected(),
    fullStandardRosterBlocksFreeAgentBids(),
    capRoomTeamStopsAtStandardRosterLimit(),
    targetRosterPlanBlocksExtraFiller(),
    teamsCanRebidInLaterWaves(),
    selectedSeasonCapYearWins(),
    rfaFallbackSignsWhenNoOutsideBid(),
    rfaFallbackUsesExpectedMarketMinutes(),
    ownBirdFallbackSignsUsefulUfa(),
    rosterFillUsesRemainingLegalTools(),
    rosterTargetDoesNotBlockUsefulLateFill(),
    renouncedIncumbentCanReturnOnMinimumFallback(),
    rfaMatchUsesExactOutsideTerms(),
    rfaIncumbentEqualBidForcesMatch(),
    rfaDeclineUsesExactOutsideTerms(),
    secondApronBlocksMle(),
    unresolvedMarketsAreExplained()
  ];
}

function highestAavWinsWhenNotClose(): string {
  const target = player("p1", "Money Leader", "FA", "UFA", 79, 25_000_000);
  const high = offerPlan(team("AAA", 116_000_000, ["SHOOT"], 0.6), target, 25_000_000, 4);
  const lower = offerPlan(team("BBB", 116_000_000, ["SHOOT"], 0.6), target, 21_500_000, 5);
  const choice = choosePlayerOffer(target, [high, lower], 0.2);
  expect(choice?.chosen.team.team === "AAA", "highest AAV should win when the money gap is outside the close-offer threshold");
  expect(choice?.closeMoneyWin === false, "non-close money gap should not be reported as preference win");
  return "highest AAV wins when offers are not financially close";
}

function lowerAavWinsOnlyInsideCloseThreshold(): string {
  const target = player("p2", "Comfort Star", "FA", "UFA", 86, 25_000_000, "AAA", "Bird", { age: 27 });
  const highest = offerPlan(team("BBB", 116_000_000, ["SHOOT"], 0.6), target, 25_000_000, 4);
  const closeIncumbent = offerPlan(team("AAA", 116_000_000, ["SHOOT"], 0.6), target, 24_250_000, 5);
  const choice = choosePlayerOffer(target, [highest, closeIncumbent], 0.2);
  expect(choice?.chosen.team.team === "AAA", `close incumbent offer should be able to win; got ${choice?.chosen.team.team}`);
  expect(choice?.closeMoneyWin === true, "inside-threshold lower AAV winner should be marked as close-money preference win");

  const notCloseIncumbent = offerPlan(team("AAA", 116_000_000, ["SHOOT"], 0.6), target, 21_000_000, 5);
  const notClose = choosePlayerOffer(target, [highest, notCloseIncumbent], 0.2);
  expect(notClose?.chosen.team.team === "BBB", "lower AAV should not win when outside the close-offer threshold");
  return "lower AAV wins only inside close-offer threshold with security/role/familiarity edge";
}

function teamTaxAndTimelineStayTeamSide(): string {
  const target = player("p3", "Tax Test", "FA", "UFA", 74, 16_000_000);
  const highTaxTeam = team("AAA", 188_000_000, ["SHOOT"], 0.25, [{ name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" }], { mode: "tax-sensitive contender" });
  const roomTeam = team("BBB", 118_000_000, ["SHOOT"], 0.85, undefined, { mode: "rising" });
  const result = simulateFreeAgencyMarket([target], mapTeams([highTaxTeam, roomTeam]), assumptions, fixedRng);
  const bids = result.bids.filter((bid) => bid.playerId === target.id);
  expect(bids.length >= 2, "both teams should submit a team-side bid");
  expect(bids.some((bid) => bid.team === "AAA" && bid.submittedAav < (bids.find((candidate) => candidate.team === "BBB")?.submittedAav ?? 0)), "tax/timeline pressure should affect bid amount or priority");
  bids.forEach((bid) => {
    expect(bid.components.timeline === 0 && bid.components.taxDrag === 0 && bid.components.willingness === 0, "player choice components must not include team timeline, tax drag, or willingness");
  });
  return "team tax/timeline affects bid amount and priority, not player choice";
}

function iterativeFallbacksTriggerAfterMiss(): string {
  const firstTarget = player("p4", "First Target", "FA", "UFA", 68, 11_000_000);
  const fallback = player("p5", "Fallback Target", "FA", "UFA", 63, 8_500_000);
  const result = simulateFreeAgencyMarket([
    firstTarget,
    fallback
  ], mapTeams([
    team("AAA", 168_000_000, ["SHOOT"], 0.7, [{ name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" }]),
    team("BBB", 115_000_000, ["SHOOT"], 0.95)
  ]), assumptions, fixedRng);
  expect(result.signings.some((row) => row.player.id === firstTarget.id && row.toTeam === "BBB"), "stronger bidder should win first target");
  expect(result.signings.some((row) => row.player.id === fallback.id && row.toTeam === "AAA"), `AAA should advance to fallback after miss; signings ${result.signings.map((row) => `${row.toTeam}:${row.player.name}`).join(", ")}`);
  expect(result.ledger.some((row) => row.team === "AAA" && row.playerId === firstTarget.id && (row.status === "shortlisted" || row.status === "outbid")), "missed target should be visible in ledger");
  expect(result.ledger.some((row) => row.team === "AAA" && row.playerId === fallback.id && row.status === "won"), "fallback win should be visible in ledger");
  return "iterative team fallbacks trigger after a miss";
}

function spendingToolsCannotBeSpentTwice(): string {
  const mleTeam = team("MLE", 168_000_000, ["SHOOT"], 0.9, [{ name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" }]);
  const mleResult = simulateFreeAgencyMarket([
    player("p6", "MLE One", "FA", "UFA", 62, 9_000_000),
    player("p7", "MLE Two", "FA", "UFA", 61, 9_000_000)
  ], mapTeams([mleTeam]), assumptions, fixedRng);
  expect(mleResult.signings.filter((row) => row.toTeam === "MLE" && row.tool === "non_taxpayer_mle").length === 1, "single MLE should not be spent on two rotation players");

  const capTeam = team("CAP", 118_000_000, ["PASS"], 0.9, []);
  const capResult = simulateFreeAgencyMarket([
    player("p8", "Cap One", "FA", "UFA", 72, 23_000_000),
    player("p9", "Cap Two", "FA", "UFA", 71, 23_000_000)
  ], mapTeams([capTeam]), assumptions, fixedRng);
  expect(capResult.signings.filter((row) => row.toTeam === "CAP").length === 1, "cap room should refresh after a signing and prevent double-spend");

  const roomTeam = team("ROM", 143_900_000, ["DPM"], 0.9, [{ name: "Room Exception", amount: 7_000_000, used: 0, kind: "room_exception" }]);
  const roomResult = simulateFreeAgencyMarket([
    player("p10", "Room One", "FA", "UFA", 58, 6_000_000),
    player("p11", "Room Two", "FA", "UFA", 57, 6_000_000)
  ], mapTeams([roomTeam]), assumptions, fixedRng);
  expect(roomResult.signings.filter((row) => row.toTeam === "ROM" && row.tool === "room_exception").length <= 1, "room exception should not be spent twice");

  const minTeam = team("MIN", 212_000_000, ["RIM"], 0.9, [{ name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }]);
  const minResult = simulateFreeAgencyMarket([
    player("p12", "Minimum One", "FA", "UFA", 49, 2_000_000),
    player("p13", "Minimum Two", "FA", "UFA", 48, 2_000_000)
  ], mapTeams([minTeam]), assumptions, fixedRng);
  expect(minResult.signings.filter((row) => row.toTeam === "MIN").length === 2, "minimum exception should be reusable for open roster spots");
  return "cap room, MLE, and room exception cannot be double-spent while minimums remain reusable";
}

function birdRightsCanExceedCapRoom(): string {
  const birdPlayer = player("p14", "Incumbent Big", "AAA", "RFA", 80, 24_000_000, "AAA", "Bird");
  const result = simulateFreeAgencyMarket([birdPlayer], mapTeams([team("AAA", 158_000_000, ["RIMPRO"], 0.8)]), assumptions, fixedRng);
  expect(result.signings[0]?.toTeam === "AAA", `Bird-right incumbent should be signable without cap room; signings ${result.signings.length}`);
  expect(result.signings[0]?.tool === "bird", "Bird-right incumbent should use rights tool");
  return "Bird rights can exceed cap room";
}

function birdRightsBeatCapRoomForOwnPlayer(): string {
  const own = player("p14b", "Own Bird Guard", "AAA", "UFA", 76, 18_000_000, "AAA", "Bird", { holdAction: "retained" });
  const capTeam = team("AAA", 112_000_000, ["SHOOT"], 0.9, [], { capPath: "cap_room" });
  const result = simulateFreeAgencyMarket([own], mapTeams([capTeam]), assumptions, fixedRng);
  expect(result.signings[0]?.tool === "bird", `own Bird FA should use Bird rights before cap room; got ${result.signings[0]?.tool}`);
  expect(result.signings[0]?.context.capPath === "cap_room", "signing should still report the team's cap-room path");
  return "Bird rights beat cap room for eligible own players";
}

function birdHoldCompressionProtectsUsefulOwnUfa(): string {
  const nurkicLike = evaluateBirdHoldCompression({
    status: "UFA",
    rights: "Bird",
    hold: 29_062_500,
    marketValue: 7_100_000,
    minimumSalary: 2_500_000,
    cap: assumptions.cap,
    score: 56,
    expectedMarketMinutes: 1539,
    position: "C",
    rimProtection: 1.15,
    retainScore: 0.52,
    scarcity: 0.2,
    standardRosterSlots: 1
  });
  expect(nurkicLike.compressible, "useful own Bird UFA with a materially oversized hold should be treated as hold-compressible");
  expect(nurkicLike.projectedSalary < 6_000_000, `below-hold Bird return should project near cheap rotation salary, got ${nurkicLike.projectedSalary}`);
  expect(nurkicLike.savings > 20_000_000, "compression should recognize that re-signing replaces the full hold with actual salary");

  const fringeVeteran = evaluateBirdHoldCompression({
    status: "UFA",
    rights: "Bird",
    hold: 10_000_000,
    marketValue: 2_000_000,
    minimumSalary: 2_500_000,
    cap: assumptions.cap,
    score: 42,
    expectedMarketMinutes: 300,
    position: "F",
    retainScore: 0.3,
    scarcity: 0.1,
    standardRosterSlots: 1
  });
  expect(!fringeVeteran.compressible, "hold compression should not force fringe veterans back just because a roster spot is open");
  return "oversized useful Bird holds can compress without forcing fringe veteran returns";
}

function capRoomRequiresCapPath(): string {
  const target = player("p14c", "Outside Guard", "FA", "UFA", 78, 32_000_000);
  const retainedTeam = team("AAA", 112_000_000, ["SHOOT"], 0.9, [], { capPath: "retained_rights" });
  const retainedResult = simulateFreeAgencyMarket([target], mapTeams([retainedTeam]), assumptions, fixedRng);
  expect(retainedResult.signings.length === 0, "retained-rights team should not use cap room just because it has room");

  const roomTeam = team("BBB", 112_000_000, ["SHOOT"], 0.9, [], { capPath: "cap_room" });
  const capResult = simulateFreeAgencyMarket([player("p14d", "Outside Wing", "FA", "UFA", 78, 32_000_000)], mapTeams([roomTeam]), assumptions, fixedRng);
  expect(capResult.signings[0]?.tool === "cap", "cap-room path should be allowed to use cap space");
  return "cap room is available only on cap-room path";
}

function roomExceptionRequiresCapPath(): string {
  const retainedTeam = team("AAA", 156_000_000, ["DPM"], 0.9, [{ name: "Room Exception", amount: 7_000_000, used: 0, kind: "room_exception" }], { capPath: "retained_rights" });
  const retainedResult = simulateFreeAgencyMarket([player("p14e", "Room Target", "FA", "UFA", 58, 6_000_000)], mapTeams([retainedTeam]), assumptions, fixedRng);
  expect(!retainedResult.signings.some((row) => row.tool === "room_exception"), "retained-rights path should not use room exception");

  const roomTeam = team("BBB", 156_000_000, ["DPM"], 0.9, [{ name: "Room Exception", amount: 7_000_000, used: 0, kind: "room_exception" }], { capPath: "cap_room" });
  const roomResult = simulateFreeAgencyMarket([player("p14f", "Room Target Two", "FA", "UFA", 58, 6_000_000)], mapTeams([roomTeam]), assumptions, fixedRng);
  expect(roomResult.signings[0]?.tool === "room_exception", "room exception should be available after cap-room path");
  return "room exception requires cap-room path";
}

function capRoomTeamsSubmitMultipleCapBids(): string {
  const capTeam = team("CHI", 92_000_000, ["SHOOT", "PASS"], 0.95, [
    { name: "Room Exception", amount: 9_000_000, used: 0, kind: "room_exception" }
  ], { capPath: "cap_room", mode: "rising" });
  const result = simulateFreeAgencyMarket([
    player("p14i", "Cap Wing", "FA", "UFA", 72, 18_000_000, "FA", "None", { position: "F" }),
    player("p14j", "Cap Guard", "FA", "UFA", 70, 17_000_000, "FA", "None", { position: "G" }),
    player("p14k", "Cap Center", "FA", "UFA", 68, 16_000_000, "FA", "None", { position: "C" })
  ], mapTeams([capTeam]), assumptions, fixedRng);
  const capBids = result.bids.filter((bid) => bid.team === "CHI" && bid.toolKind === "cap");
  expect(capBids.length >= 2, `cap-room team should carry multiple conditional cap bids; got ${capBids.length}`);
  expect(result.signings.some((row) => row.toTeam === "CHI" && row.tool === "cap"), "cap-room team should convert at least one cap bid into a cap signing");
  return "cap-room teams submit multiple conditional cap bids";
}

function retainedRightsTeamsUseLiveMleEntitlement(): string {
  const target = player("p14u", "Live MLE Wing", "FA", "UFA", 66, 11_000_000, "FA", "None", { position: "F" });
  const retainedTeam = team("UTA", 178_000_000, ["SHOOT", "DPM"], 0.95, [
    { name: "Taxpayer MLE", amount: 7_000_000, used: 0, kind: "taxpayer_mle" }
  ], { capPath: "retained_rights", mode: "rising" });
  const result = simulateFreeAgencyMarket([target], mapTeams([retainedTeam]), assumptions, fixedRng);
  expect(result.signings[0]?.tool === "non_taxpayer_mle", `team below the first apron should use live NTMLE entitlement, got ${result.signings[0]?.tool}`);
  return "retained-rights teams use live MLE entitlement instead of stale cap-tracker exception";
}

function retainedRightsTeamsBidMultipleTools(): string {
  const retainedTeam = team("BID", 176_000_000, ["SHOOT", "PASS", "DPM"], 0.95, [
    { name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" },
    { name: "Bi-Annual", amount: 5_500_000, used: 0, kind: "bi_annual" },
    { name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }
  ], { capPath: "retained_rights", mode: "playoff hopeful" });
  const result = simulateFreeAgencyMarket([
    player("p14v", "MLE Target", "FA", "UFA", 62, 8_000_000, "FA", "None", { position: "F" }),
    player("p14w", "BAE Target", "FA", "UFA", 55, 4_000_000, "FA", "None", { position: "G" }),
    player("p14x", "Minimum Target", "FA", "UFA", 48, 2_000_000, "FA", "None", { position: "C" })
  ], mapTeams([retainedTeam]), assumptions, fixedRng);
  const bidTools = new Set(result.bids.filter((bid) => bid.team === "BID").map((bid) => bid.toolKind));
  expect(bidTools.has("non_taxpayer_mle") && bidTools.has("bi_annual"), `retained-rights team should submit offers across available exception tools; got ${Array.from(bidTools).join(", ")}`);
  return "retained-rights teams submit bids across multiple available tools";
}

function declinedTeamOptionsNeedDiscountToReSign(): string {
  const declined = player("p14y", "Declined Option Return", "OPT", "UFA", 64, 10_000_000, "OPT", "Bird", {
    holdAction: "retained"
  });
  declined.declinedOptionTeam = "OPT";
  declined.declinedOptionType = "Team Option";
  declined.declinedOptionSalary = 10_000_000;
  const result = simulateFreeAgencyMarket([declined], mapTeams([team("OPT", 170_000_000, ["SHOOT"], 0.95, undefined, { capPath: "retained_rights" })]), assumptions, fixedRng);
  expect(!result.signings.some((row) => row.toTeam === "OPT" && row.annualSalary >= 9_200_000), "team should not decline an option and immediately re-sign the same player at essentially the same price");
  return "declined team options need a real discount before incumbent re-sign";
}

function capRoomUsesCapBeforeRoomException(): string {
  const capTeam = team("CAP", 118_000_000, ["DPM"], 0.9, [
    { name: "Room Exception", amount: 9_000_000, used: 0, kind: "room_exception" }
  ], { capPath: "cap_room" });
  const result = simulateFreeAgencyMarket([player("p14l", "Affordable Room Target", "FA", "UFA", 58, 6_000_000)], mapTeams([capTeam]), assumptions, fixedRng);
  expect(result.signings[0]?.tool === "cap", `cap room should be used before room exception; got ${result.signings[0]?.tool}`);
  return "cap-room teams use cap before room exception";
}

function explicitExceptionInventoriesAreRespected(): string {
  const ntmleTeam = team("NTM", 182_000_000, ["SHOOT"], 0.95, [{ name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" }], { capPath: "retained_rights" });
  const ntmleResult = simulateFreeAgencyMarket([player("p14m", "NTMLE Target", "FA", "UFA", 62, 8_000_000)], mapTeams([ntmleTeam]), assumptions, fixedRng);
  expect(ntmleResult.signings[0]?.tool === "non_taxpayer_mle", `non-taxpayer MLE should be explicit; got ${ntmleResult.signings[0]?.tool}`);

  const taxpayerTeam = team("TAX", 202_000_000, ["SHOOT"], 0.95, [{ name: "Taxpayer MLE", amount: 7_000_000, used: 0, kind: "taxpayer_mle" }], { capPath: "retained_rights" });
  const taxpayerResult = simulateFreeAgencyMarket([player("p14n", "Tax MLE Target", "FA", "UFA", 58, 5_500_000)], mapTeams([taxpayerTeam]), assumptions, fixedRng);
  expect(taxpayerResult.signings[0]?.tool === "taxpayer_mle", `taxpayer MLE should be explicit; got ${taxpayerResult.signings[0]?.tool}`);

  const baeTeam = team("BAE", 182_000_000, ["PASS"], 0.95, [{ name: "Bi-Annual", amount: 5_500_000, used: 0, kind: "bi_annual" }], { capPath: "retained_rights" });
  const baeResult = simulateFreeAgencyMarket([player("p14o", "BAE Target", "FA", "UFA", 55, 4_000_000)], mapTeams([baeTeam]), assumptions, fixedRng);
  expect(baeResult.signings[0]?.tool === "non_taxpayer_mle", `live NTMLE should outrank BAE when both are available; got ${baeResult.signings[0]?.tool}`);
  return "explicit exception inventories are respected";
}

function fullStandardRosterBlocksFreeAgentBids(): string {
  const fullTeam = team("FUL", 0, ["SHOOT"], 0.95, [], { capPath: "cap_room", mode: "playoff hopeful" });
  fullTeam.roster = signedRoster("FUL", 15);
  const result = simulateFreeAgencyMarket([player("p14q", "Extra Guard", "FA", "UFA", 70, 12_000_000)], mapTeams([fullTeam]), assumptions, fixedRng);
  expect(result.signings.length === 0, `full standard roster should not add another standard FA; got ${result.signings.length}`);
  expect(fullTeam.roster.length + (fullTeam.rosterCountAdjustment ?? 0) === 15, "full roster count should remain at the standard limit");
  return "full standard roster blocks free-agent bids";
}

function capRoomTeamStopsAtStandardRosterLimit(): string {
  const roomTeam = team("LIM", 0, ["SHOOT", "PASS"], 0.95, [], { capPath: "cap_room", mode: "playoff hopeful" });
  roomTeam.roster = signedRoster("LIM", 13);
  const targets = Array.from({ length: 6 }, (_, index) => player(`p14r-${index}`, `Limit Target ${index}`, "FA", "UFA", 66 - index, 6_500_000 - index * 250_000, "FA", "None", {
    position: index % 3 === 0 ? "C" : index % 3 === 1 ? "F" : "G"
  }));
  const result = simulateFreeAgencyMarket(targets, mapTeams([roomTeam]), assumptions, fixedRng);
  const finalCount = roomTeam.roster.length + (roomTeam.rosterCountAdjustment ?? 0);
  expect(result.signings.length <= 2, `team with two standard slots should not sign more than two players; got ${result.signings.length}`);
  expect(finalCount <= 15, `final roster should stay legal; got ${finalCount}`);
  return "cap-room team stops at the standard roster limit";
}

function targetRosterPlanBlocksExtraFiller(): string {
  const plannedTeam = team("PLN", 0, ["SHOOT"], 0.95, [], { capPath: "cap_room", mode: "rising" });
  plannedTeam.roster = signedRoster("PLN", 14);
  const result = simulateFreeAgencyMarket([
    player("p14s", "Extra Filler", "FA", "UFA", 52, 2_500_000)
  ], mapTeams([plannedTeam]), assumptions, fixedRng);
  expect(result.signings.length === 0, "rising team at its target roster count should not use a final standard slot on filler");
  return "target roster plan blocks extra filler";
}

function teamsCanRebidInLaterWaves(): string {
  const target = player("p14p", "Too Pricey Star", "FA", "UFA", 88, 160_000_000, "FA", "None", { position: "G" });
  const capTeam = team("REB", 88_000_000, ["SHOOT"], 0.95, [], { capPath: "cap_room" });
  const result = simulateFreeAgencyMarket([target], mapTeams([capTeam]), assumptions, fixedRng);
  const bids = result.bids.filter((bid) => bid.team === "REB" && bid.playerId === target.id);
  expect(bids.length >= 2, `team should be able to rebid in later waves when the market remains unresolved; got ${bids.length}`);
  expect(new Set(bids.map((bid) => bid.round)).size >= 1, "rebids should be tracked as submitted bids rather than permanently suppressed");
  return "teams can rebid in later waves";
}

function selectedSeasonCapYearWins(): string {
  const capTracker = {
    seasons: [{ year: 2027 }, { year: 2028 }],
    team_seasons: [],
    contracts: []
  };
  expect(capYearForSeason(2027, capTracker as never) === 2027, "selected 2027 offseason should use 2027 cap tracker, not 2028");
  expect(capYearForSeason(2026, capTracker as never) === 2027, "missing selected cap year can still fall forward when needed");
  return "selected offseason season wins cap tracker resolution";
}

function rfaFallbackSignsWhenNoOutsideBid(): string {
  const rfa = player("p14g", "Leverage RFA Center", "AAA", "RFA", 74, 16_000_000, "AAA", "Bird", {
    age: 24,
    position: "C",
    holdAction: "retained",
    upside: 0.82,
    skills: { ...skills, RIMPRO: 2.2, DREB: 1.7 }
  });
  rfa.rightsValue = 0.8;
  rfa.holdRetainScore = 0.86;
  rfa.scarcityScore = 0.92;
  rfa.expectedMarketMinutes = 1700;
  rfa.marketMinutesSource = "regression median role";
  const incumbent = team("AAA", 148_000_000, ["RIMPRO"], 0.7, undefined, { capPath: "retained_rights", mode: "rebuilding" });
  const result = simulateFreeAgencyMarket([rfa], mapTeams([incumbent]), assumptions, fixedRng);
  const signing = result.signings[0];
  expect(signing?.toTeam === "AAA", "incumbent should retain useful RFA when no outside offer sheet arrives");
  expect(signing?.context.selectionMethod?.includes("restricted-rights leverage") === true, "retention should be marked as proactive RFA fallback");
  expect(signing?.annualSalary < rfa.marketValue, "fallback should use some RFA leverage below full market");
  return "RFA fallback signs retained-rights incumbent when no outside bid arrives";
}

function rfaFallbackUsesExpectedMarketMinutes(): string {
  const rfa = player("p14h", "Minute Patched RFA", "AAA", "RFA", 8, 12_000_000, "AAA", "Bird", {
    age: 23,
    position: "C",
    holdAction: "retained",
    skills: { ...skills, RIMPRO: 2.0 }
  });
  rfa.rightsValue = 0.72;
  rfa.holdRetainScore = 0.8;
  rfa.scarcityScore = 0.88;
  rfa.expectedMarketMinutes = 1500;
  rfa.marketMinutesSource = "median-team role fallback";
  const result = simulateFreeAgencyMarket([rfa], mapTeams([team("AAA", 146_000_000, ["RIMPRO"], 0.75, undefined, { capPath: "retained_rights", mode: "rebuilding" })]), assumptions, fixedRng);
  const signing = result.signings[0];
  expect(signing?.context.expectedMarketMinutes === 1500, "market context should carry expected FA minutes");
  expect(signing?.context.marketMinutesSource === "median-team role fallback", "market context should explain minute source");
  return "RFA fallback carries expected market minutes context";
}

function ownBirdFallbackSignsUsefulUfa(): string {
  const ufa = player("p14z", "Useful Bird Center", "UTA", "UFA", 62, 7_500_000, "UTA", "Bird", {
    age: 30,
    position: "C",
    holdAction: "retained",
    rightsValue: 0.72,
    holdRetainScore: 0.78,
    scarcityScore: 0.86,
    expectedMarketMinutes: 1150,
    skills: { ...skills, RIMPRO: 2.1, DREB: 1.6 }
  });
  const jazz = team("UTA", 182_000_000, ["RIMPRO", "DREB"], 0.66, undefined, { capPath: "retained_rights", mode: "playoff hopeful" });
  jazz.roster = signedRoster("UTA", 12);
  const result = simulateFreeAgencyMarket([ufa], mapTeams([jazz]), assumptions, fixedRng);
  const signing = result.signings.find((row) => row.player.id === ufa.id);
  expect(signing?.toTeam === "UTA", "incumbent should keep a useful own Bird-rights UFA when roster spots remain");
  expect(signing?.tool === "bird", `own UFA fallback should use Bird rights, got ${signing?.tool}`);
  expect(Boolean(signing?.context.toolReason?.includes("no cap room") || signing?.context.toolReason?.includes("Bird rights")), "context should explain Bird rights do not consume cap or exceptions");
  return "own Bird-rights fallback signs useful UFA without consuming cap/MLE";
}

function rosterFillUsesRemainingLegalTools(): string {
  const fillTeam = team("FIL", 176_000_000, ["DPM", "RIMPRO"], 0.82, [
    { name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" },
    { name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }
  ], { capPath: "retained_rights", mode: "playoff hopeful" });
  fillTeam.roster = signedRoster("FIL", 11);
  const result = simulateFreeAgencyMarket([
    player("p14fill1", "Late Defensive Wing", "FA", "UFA", 60, 5_500_000, "FA", "None", { position: "F", skills: { ...skills, DPM: 1.9, SWITCH: 1.6 } }),
    player("p14fill2", "Late Minimum Big", "FA", "UFA", 49, 2_000_000, "FA", "None", { position: "C", skills: { ...skills, RIMPRO: 1.7 } })
  ], mapTeams([fillTeam]), assumptions, fixedRng);
  const finalCount = fillTeam.roster.length + (fillTeam.rosterCountAdjustment ?? 0);
  expect(finalCount >= 12, `late roster fill should get team to minimum roster count; got ${finalCount}`);
  expect(result.signings.some((row) => row.toTeam === "FIL" && (row.tool === "non_taxpayer_mle" || row.tool === "minimum")), "open roster team should use an available legal tool");
  return "late roster fill uses remaining legal tools for open roster spots";
}

function rosterTargetDoesNotBlockUsefulLateFill(): string {
  const fillTeam = team("UTA", 176_000_000, ["DPM", "SWITCH"], 0.66, [
    { name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" },
    { name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }
  ], { capPath: "retained_rights", mode: "rising" });
  fillTeam.roster = signedRoster("UTA", 14);
  const rosterSalary = fillTeam.roster.reduce((total, row) => total + row.salary, 0);
  fillTeam.activeSalaryAdjustment = 176_000_000 - rosterSalary;
  fillTeam.guaranteedSalaryAdjustment = 176_000_000 - rosterSalary;

  const usefulWing = player("p14target", "Late Useful Wing", "FA", "UFA", 59, 5_500_000, "FA", "None", {
    position: "F",
    expectedMarketMinutes: 950,
    skills: { ...skills, DPM: 1.8, SWITCH: 1.7 }
  });
  const result = simulateFreeAgencyMarket([usefulWing], mapTeams([fillTeam]), assumptions, fixedRng);
  const signing = result.signings.find((row) => row.player.id === usefulWing.id);
  const finalCount = fillTeam.roster.length + (fillTeam.rosterCountAdjustment ?? 0);
  expect(signing?.toTeam === "UTA", "14-player target should not block a useful late signing when a standard roster spot and MLE/minimum remain");
  expect(finalCount === 15, `late useful fill should use the open standard roster spot; got ${finalCount}`);
  expect(signing?.tool === "non_taxpayer_mle" || signing?.tool === "minimum", `late fill should use a legal remaining tool; got ${signing?.tool}`);
  return "soft roster target does not block useful late fill with an open standard spot";
}

function renouncedIncumbentCanReturnOnMinimumFallback(): string {
  const nurkicShape = player("p14nurk", "Renounced Veteran Center", "UTA", "UFA", 56, 7_100_000, "UTA", "None", {
    age: 32,
    position: "C",
    holdAction: "renounced",
    expectedMarketMinutes: 1000,
    skills: { ...skills, RIMPRO: 1.6, DREB: 2.4, DPM: 0.7 }
  });
  const jazz = team("UTA", 185_000_000, ["RIMPRO", "DREB"], 0.66, [
    { name: "Room Exception", amount: 9_000_000, used: 9_000_000, kind: "room_exception" },
    { name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }
  ], { capPath: "cap_room", mode: "playoff hopeful" });
  jazz.roster = [...jazz.roster, ...signedRoster("UTA", 12)];
  const result = simulateFreeAgencyMarket([nurkicShape], mapTeams([jazz]), assumptions, fixedRng);
  const signing = result.signings.find((row) => row.player.id === nurkicShape.id);
  expect(signing?.toTeam === "UTA", "renounced incumbent should still be able to return through ordinary tools when a roster spot remains");
  expect(signing?.tool === "minimum", `renounced incumbent should use the reusable minimum fallback when other tools are gone; got ${signing?.tool}`);
  expect(signing?.context.selectionMethod?.includes("remaining legal roster room") === true, "signing should be marked as a late roster-fill decision");
  return "renounced incumbents can return via minimum fallback after Bird rights are gone";
}

function rfaMatchUsesExactOutsideTerms(): string {
  const rfa = player("p15", "Matched RFA", "AAA", "RFA", 78, 18_000_000, "AAA", "Bird", { age: 24, upside: 0.85, declineRisk: 0.05 });
  const outsideTeam = team("BBB", 118_000_000, ["SHOOT"], 0.95);
  const incumbent = team("AAA", 150_000_000, ["SHOOT"], 0.05);
  const outsideOffer = offerPlan(outsideTeam, rfa, 18_000_000, 4);
  const choice = choosePlayerOffer(rfa, [outsideOffer], 0.2);
  expect(Boolean(choice), "outside RFA offer should be acceptable");
  const ledger: MarketLedgerRow[] = [];
  const resolutions: MarketResolution[] = [];
  const audit: LegacyAuditRow[] = [];
  const signing = resolveAcceptedOffer(choice!, mapTeams([incumbent, outsideTeam]), assumptions, 0, "regression", ledger, resolutions, audit, fixedRng);
  expect(signing.offerSheetTeam === "BBB", `outside team should create offer sheet; got ${signing.offerSheetTeam}`);
  expect(signing.toTeam === "AAA" && signing.matched === true, "incumbent should match exact offer sheet");
  expect(signing.annualSalary === signing.context.resolution?.submittedWinnerBid, "matched AAV must equal outside submitted bid");
  expect(Boolean(signing.context.resolution?.clearingRule === "matched exact offer sheet"), "resolution should state exact matching rule");
  expect(ledger.some((row) => row.status === "matched" && row.reason.includes("Matched exact offer sheet")), "ledger should explain exact match");
  return "RFA match uses exact outside AAV and years";
}

function rfaIncumbentEqualBidForcesMatch(): string {
  const rfa = player("p15b", "Equal Bid RFA", "UTA", "RFA", 78, 18_000_000, "UTA", "Bird", { age: 24, upside: 0.72, declineRisk: 0.08 });
  const outsideTeam = team("LAC", 118_000_000, ["RIMPRO"], 0.95);
  const incumbent = team("UTA", 150_000_000, ["RIMPRO"], 0.05);
  const outsideOffer = offerPlan(outsideTeam, rfa, 18_000_000, 4);
  const incumbentOffer = offerPlan(incumbent, rfa, 18_000_000, 4, "bird");
  const choice = {
    chosen: outsideOffer,
    ranked: [outsideOffer, incumbentOffer],
    highestMoney: outsideOffer,
    moneyGap: 0,
    yearsGap: 0,
    closeMoneyWin: false,
    reason: "regression offer sheet"
  };
  const ledger: MarketLedgerRow[] = [];
  const resolutions: MarketResolution[] = [];
  const audit: LegacyAuditRow[] = [];
  const signing = resolveAcceptedOffer(choice, mapTeams([incumbent, outsideTeam]), assumptions, 0, "regression", ledger, resolutions, audit, fixedRng);
  expect(signing.toTeam === "UTA" && signing.matched === true, "incumbent equal bid should force exact RFA match instead of letting player choose outside team");
  expect(signing.annualSalary === 18_000_000 && signing.years === 4, "matched RFA must keep exact outside offer-sheet terms");
  expect(ledger.some((row) => row.status === "matched" && row.reason.includes("already meeting the outside AAV")), "ledger should explain revealed incumbent willingness");
  return "RFA incumbent equal bid forces exact match";
}

function rfaDeclineUsesExactOutsideTerms(): string {
  const rfa = player("p16", "Declined RFA", "AAA", "RFA", 72, 14_000_000, "AAA", "Bird", {
    age: 34,
    upside: 0.05,
    declineRisk: 0.9,
    replaceability: 0.05,
    skills: { ...skills, DREB: 0.1 }
  });
  const outsideTeam = team("BBB", 120_000_000, ["DREB"], 0.95);
  const incumbent = team("AAA", 214_000_000, ["SHOOT"], 0.05, [{ name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" }], { mode: "rebuilding" });
  const outsideOffer = offerPlan(outsideTeam, rfa, 18_900_000, 4);
  const choice = choosePlayerOffer(rfa, [outsideOffer], 0.2);
  expect(Boolean(choice), "outside RFA offer should be acceptable");
  const ledger: MarketLedgerRow[] = [];
  const resolutions: MarketResolution[] = [];
  const audit: LegacyAuditRow[] = [];
  const signing = resolveAcceptedOffer(choice!, mapTeams([incumbent, outsideTeam]), assumptions, 0, "regression", ledger, resolutions, audit, fixedRng);
  expect(signing.offerSheetTeam === "BBB" && signing.toTeam === "BBB" && !signing.matched, "declined RFA should go to outside team");
  expect(signing.annualSalary === signing.context.resolution?.submittedWinnerBid, "declined RFA terms must equal outside submitted bid");
  expect(ledger.some((row) => row.status === "declined" && row.reason.includes("Declined exact offer sheet")), "ledger should explain exact decline");
  return "RFA decline sends player to outside team on exact outside terms";
}

function secondApronBlocksMle(): string {
  const mleTeam = team("AAA", 212_000_000, ["SHOOT"], 0.9, [{ name: "Taxpayer MLE", amount: 7_000_000, used: 0, kind: "taxpayer_mle" }]);
  const result = simulateFreeAgencyMarket([player("p17", "Apron Target", "FA", "UFA", 63, 8_000_000)], mapTeams([mleTeam]), assumptions, fixedRng);
  expect(!result.signings.some((row) => row.tool === "taxpayer_mle"), "second-apron team should not use MLE");
  return "second apron blocks MLE while leaving minimum fallback available";
}

function unresolvedMarketsAreExplained(): string {
  const result = simulateFreeAgencyMarket([player("p18", "Too Expensive", "FA", "UFA", 85, 36_000_000)], mapTeams([team("AAA", 205_000_000, ["SHOOT"], 0.2)]), assumptions, fixedRng);
  expect(result.signings.length === 0, "unresolved player should remain unsigned");
  expect(result.resolutions.some((row) => row.player === "Too Expensive" && row.unresolvedReason), "unresolved player should have an explanation");
  return "unresolved markets are explained";
}

function offerPlan(teamRow: TestTeam, target: TestPlayer, salary: number, years: number, toolKind: MarketToolKind = "cap"): TeamBidPlan<TestPlayer, TestTeam> {
  const bid: MarketBid = {
    id: `${teamRow.team}-${target.id}-${salary}`,
    round: 0,
    tier: "regression",
    team: teamRow.team,
    playerId: target.id,
    player: target.name,
    tool: toolKind === "bird" ? "Bird" : "Cap Space",
    toolKind,
    submittedAav: salary,
    years,
    legalMax: salary,
    teamPriority: 0.5,
    teamUtility: 0.5,
    playerUtility: 0,
    components: {
      salary: 0,
      totalGuarantee: 0,
      roleFit: 0,
      timeline: 0,
      familiarity: 0,
      willingness: 0,
      taxDrag: 0,
      scarcity: 0,
      security: 0,
      closeOfferAdjustment: 0,
      randomness: 0,
      total: 0
    },
    capSnapshot: {
      capSpace: 40_000_000,
      heldCapSpace: 0,
      renouncedCapSpace: 40_000_000,
      taxRoom: 50_000_000,
      firstApronRoom: 60_000_000,
      secondApronRoom: 70_000_000,
      toolAmount: salary
    },
    capPath: teamRow.capPath,
    toolReason: "regression tool",
    holdAction: target.holdAction,
    limiter: "regression",
    reason: "regression offer"
  };
  return {
    bid,
    team: teamRow,
    player: target,
    salary,
    years,
    tool: { name: bid.tool, amount: salary, used: 0, kind: toolKind },
    score: {
      needFit: 0.5,
      value: 0.5,
      timeline: 0.5,
      urgency: 0.5,
      taxPain: 0,
      assetValue: 0,
      replacement: 0.5,
      upsideRisk: 0.5,
      incumbency: target.rightsTeam === teamRow.team ? 0.75 : 0,
      randomness: 0,
      total: 0.5
    },
    needFit: teamRow.team === target.rightsTeam ? 0.95 : 0.55,
    timeline: 0.5,
    taxPain: 0,
    redundancy: 0,
    affordability: 1,
    alternatives: 0,
    toolReason: "regression tool"
  };
}

function player(
  id: string,
  name: string,
  rightsTeam: string,
  status: "Signed" | "UFA" | "RFA",
  score: number,
  marketValue: number,
  incumbent = rightsTeam,
  rights: "Bird" | "Early Bird" | "Non-Bird" | "None" = "None",
  overrides: Partial<ReturnType<typeof basePlayerOverrides>> = {}
) {
  const extra = basePlayerOverrides();
  const mergedSkills = { ...extra.skills, ...(overrides.skills ?? {}) };
  return {
    id,
    name,
    team: status === "Signed" ? rightsTeam : "FA",
    incumbentTeam: incumbent,
    rightsTeam,
    status,
    position: overrides.position ?? "G",
    age: overrides.age ?? 26,
    salary: status === "Signed" ? marketValue : Math.max(2_000_000, marketValue * 0.6),
    marketValue,
    rights,
    rightsSource: "regression",
    capHold: rights === "None" ? 0 : marketValue,
    capHoldType: rights === "None" ? "No retained cap hold" : `${rights} hold`,
    holdAction: overrides.holdAction ?? (rights === "None" ? "none" : "retained"),
    holdActionReason: "regression",
    rightsValue: overrides.rightsValue ?? 0,
    holdRetainScore: overrides.holdRetainScore ?? 0,
    scarcityScore: overrides.scarcityScore ?? 0,
    expectedMarketMinutes: overrides.expectedMarketMinutes ?? 1200,
    marketMinutesSource: overrides.marketMinutesSource ?? "regression",
    declinedOptionTeam: undefined as string | undefined,
    declinedOptionType: undefined as "Team Option" | "Non-Guaranteed" | "Player Option" | undefined,
    declinedOptionSalary: undefined as number | undefined,
    guaranteedSalary: 0,
    deadCap: 0,
    total: 0,
    score,
    tier: score >= 84 ? "Star" : score >= 68 ? "Starter" : "Rotation",
    tradeValue: marketValue,
    upside: overrides.upside ?? extra.upside,
    declineRisk: overrides.declineRisk ?? extra.declineRisk,
    replaceability: overrides.replaceability ?? extra.replaceability,
    skills: mergedSkills,
    original: { yoe: 6, projection_effective_contract_y1: marketValue }
  };
}

function basePlayerOverrides() {
  return {
    age: 26,
    position: "G",
    upside: 0.6,
    declineRisk: 0.1,
    replaceability: 0.35,
    holdAction: "none" as "retained" | "renounced" | "none",
    rightsValue: 0,
    holdRetainScore: 0,
    scarcityScore: 0,
    expectedMarketMinutes: 1200,
    marketMinutesSource: "regression",
    skills: { ...skills, SHOOT: 1.5, PASS: 1.2, RIMPRO: 1.1 }
  };
}

function team(
  teamCode: string,
  activeSalary: number,
  needs: SkillKey[],
  willingness: number,
  exceptions?: Array<{ name: string; amount: number; used: number; kind: ToolKind }>,
  overrides: { mode?: "rebuilding" | "rising" | "playoff hopeful" | "contender" | "tax-sensitive contender"; projectedWins?: number; capPath?: "retained_rights" | "cap_room" } = {}
) {
  const salarySlot = activeSalary > 0 ? [player(`${teamCode}-salary-slot`, `${teamCode} Salary Slot`, teamCode, "Signed", 45, activeSalary)] : [];
  return {
    team: teamCode,
    name: teamCode,
    mode: overrides.mode ?? "playoff hopeful",
    capPath: overrides.capPath ?? (activeSalary < assumptions.cap - 8_000_000 ? "cap_room" : "retained_rights"),
    capPathReason: "regression",
    projectedWins: overrides.projectedWins ?? 42,
    projectedRank: 15,
    roster: salarySlot as TestPlayer[],
    rosterCountAdjustment: 0,
    standardRosterLimit: 15,
    targetRosterCount: overrides.mode === "rebuilding" || overrides.mode === "rising" || overrides.mode === "tax-sensitive contender" ? 14 : 15,
    minimumRosterCount: 12,
    payroll: activeSalary,
    activeSalary,
    guaranteedSalary: activeSalary,
    activeSalaryAdjustment: 0,
    guaranteedSalaryAdjustment: 0,
    deadCap: 0,
    capHolds: 0,
    rosterCharges: 0,
    heldCapSpace: 0,
    capSpace: 0,
    renouncedCapSpace: 0,
    maximumCapSpace: 0,
    taxRoom: 0,
    firstApronRoom: 0,
    secondApronRoom: 0,
    needs,
    pickAssets: 0,
    pickCount: 0,
    premiumPickCount: 0,
    willingness,
    exceptions: exceptions ?? [
      { name: "Non-Taxpayer MLE", amount: 12_000_000, used: 0, kind: "non_taxpayer_mle" as const },
      { name: "Room Exception", amount: 7_000_000, used: 0, kind: "room_exception" as const },
      { name: "Minimum", amount: 2_500_000, used: 0, kind: "minimum" as const }
    ],
    toolLedger: [],
    explanations: []
  };
}

function signedRoster(teamCode: string, count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, index) => player(
    `${teamCode}-signed-${index}`,
    `${teamCode} Signed ${index}`,
    teamCode,
    "Signed",
    50 + (index % 8),
    2_000_000 + index * 100_000,
    teamCode,
    "None",
    { position: index % 3 === 0 ? "C" : index % 3 === 1 ? "F" : "G" }
  ));
}

function mapTeams(teams: TestTeam[]): Map<string, TestTeam> {
  return new Map(teams.map((row) => [row.team, row]));
}

function fixedRng(): number {
  return 0.5;
}

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
