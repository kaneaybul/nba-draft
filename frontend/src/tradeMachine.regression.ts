import { baseYearCompensationOutgoingSalary, capTrackerHardCap, evaluateTradeMachine, tradeBonusAmount, tradeTeamContextFromCapTracker } from "./tradeMachine";
import type { CapTrackerContractRow, CapTrackerData, CapTrackerPick, CapTrackerSeason, CapTrackerTeamSeason } from "./types";
import type { TradeMachineAsset, TradeMachineSide, TradeMachineTeamContext } from "./tradeMachine";

export function runTradeMachineRegressionTests(): string[] {
  return [
    capRoomAbsorptionClearsWithoutMatchingSalary(),
    balancedTradeValueIsModelAccepted(),
    scaleAdjustedValueCanDeclineTrade(),
    threeTeamTradeRoutesSalaryAndValueByDestination(),
    multiTeamTradeRequiresExplicitAssetDestinations(),
    modeledAssetOwnerMustMatchSendingSide(),
    missingAssetOwnerMetadataDoesNotBlockRouting(),
    multiTeamDestinationRestrictionUsesRoutedDestination(),
    standardTpeIsUsedWhenSinglePlayerSalaryFitsStandardPath(),
    aggregatedStandardTpeIsUsedWhenMultiPlayerSalaryFitsOneHundredPercentPath(),
    expandedTpeIsUsedOnlyWhenStandardPathIsInsufficient(),
    expandedTpeCarriesFirstApronTransactionRestriction(),
    offseasonExpandedTpeFailsSubsequentYearApronCheck(),
    offseasonExpandedTpeWarnsWhenSubsequentYearSalaryMissing(),
    priorTaxpayerMleBlocksExpandedTpe(),
    transitionTpeIsUsedInTwentyThreeTwentyFour(),
    transitionTpeCurrentYearApronGraceWarns(),
    aggregatedStandardTpeAboveSecondApronFailsTransactionRestriction(),
    priorTaxpayerMleDoesNotBlockAggregatedStandardTpe(),
    unprotectedBaseCompensationReducesOutgoingMatchingSalary(),
    januaryEighthWindowTreatsCurrentSeasonBaseCompensationAsProtected(),
    offseasonMatchingUsesLesserOfCurrentAndNextProtectedSalary(),
    dpePlayerDoesNotCreateTpeBalance(),
    disabledPlayerExceptionCanAcquireSingleExpiringContract(),
    disabledPlayerExceptionDoesNotAcquireMultiplePlayers(),
    disabledPlayerExceptionRejectsNonExpiringContract(),
    disabledPlayerExceptionWarnsWhenTermOrExpiryIsUnknown(),
    incomingTwoWayDoesNotCountAsTradeSalary(),
    twoWayRosterAccountingDoesNotCountAsStandardContract(),
    twoWayOutgoingDoesNotMakeSalaryMatchAggregated(),
    recentTwoWayDoesNotTriggerAggregationRestriction(),
    unknownTradeCalendarWarnsOnMinimumAggregationWindow(),
    inSeasonTradeAfterDeadlineFailsTradeWindow(),
    deadlineDayTradePassesTradeWindow(),
    offseasonTradeAfterRegularSeasonPassesTradeWindow(),
    postDeadlineTradeWindowWarnsWhenSeasonEndIsMissing(),
    tradeDateDerivesDec15ToDeadlineMinimumAggregationWindow(),
    tradeDateDerivesJan8ProtectionWindow(),
    tradeDateDerivesPostRegularSeasonProtectionWindow(),
    overCapTeamCannotAbsorbSalaryWithoutOutgoingRoomOrTpe(),
    overCapTeamCanAcquireMinimumSalaryWithoutOutgoingSalary(),
    minimumSalaryExceptionCanPairWithSalaryMatchedIncoming(),
    minimumSalaryExceptionRejectsBonusContract(),
    minimumSalaryExceptionRejectsOverTwoSeasonContract(),
    minimumSalaryExceptionWarnsWhenContractTermIsUnknown(),
    existingTpeCanAbsorbIncomingSalaryWithoutOutgoingPlayer(),
    expiredExistingTpeCannotAbsorbIncomingSalary(),
    existingTpeExpiryWarnsWhenTradeDateIsMissing(),
    existingTpeUnknownExpiryWarnsWhenTradeDateIsModeled(),
    knownExistingTpeMetadataClearsTransactionWarning(),
    existingTpeAfterRowFTimingHardCapsAtFirstApron(),
    priorTaxpayerMleWarnsOnUnknownRowFTiming(),
    signAndTradeOriginExistingTpeHardCapsAtSecondApron(),
    nonTaxpayerMleCanAcquireAssignedContract(),
    biAnnualAssignmentHardCapsAtFirstApron(),
    roomExceptionRejectsFourSeasonAssignedContract(),
    preTwentyFourTwentyFiveMleCannotAcquireByAssignment(),
    taxpayerMleDoesNotAcquireByAssignment(),
    existingTpeDoesNotCombineWithOutgoingSalary(),
    nonApronMiddleBandAllowsOutgoingPlusDelta(),
    firstApronTeamCannotTakeBackExtraSalary(),
    secondApronTeamCannotAggregateOutgoingSalary(),
    bycSalaryCountsAtGreaterOfPreviousOrHalfNewSalary(),
    stepienBlocksConsecutiveFutureFirstGaps(),
    incomingFirstCanRepairStepienGapInSameTrade(),
    protectedIncomingFirstWarnsWhenNeededForStepienCoverage(),
    secondApronBlocksSevenYearOutFirst(),
    secondApronFrozenSeventhYearFirstCannotBeTraded(),
    secondApronFrozenSeventhYearFirstSwapCannotBeTraded(),
    pickSwapDoesNotRemoveOwnFirstForStepien(),
    protectedFirstRequiresRolloverSpecificityReview(),
    protectedFirstRolloverYearsWarnOnStepienRisk(),
    signAndTradeAcquisitionHardCapsAtFirstApron(),
    priorTaxpayerMleBlocksSignAndTradeAcquisition(),
    signAndTradeUsedProhibitedExceptionFails(),
    signAndTradeMissingProhibitedExceptionFactWarns(),
    capTrackerHardCapOverrideIsEnforced(),
    capTrackerCashTotalsFeedTradeContext(),
    capTrackerTaxpayerMleSigningFeedsTradeContext(),
    capTrackerFrozenPickRowsFeedTradeContext(),
    annualCashLimitIsNotNetted(),
    aggregationIneligiblePlayerCannotBePackaged(),
    aggregationIneligiblePlayerCanBeTradedAlone(),
    secondApronAggregationCountsIneligiblePositiveSalaryPlayers(),
    recentlyAcquiredByExceptionPlayerCannotBeAggregated(),
    recentlyAcquiredByTradePlayerCannotBeAggregated(),
    recentlyAcquiredPlayerCanBeTradedAlone(),
    dec16AcquisitionAggregationRestrictionReleasesNearDeadline(),
    unknownRecentTradeAcquisitionWarnsWhenAggregated(),
    minimumSalaryAggregationRestrictionBlocksThreeForOne(),
    dateRestrictedPlayerCannotBeTradedTooEarly(),
    postDeadlineFinalContractSeasonCannotBeTraded(),
    deadlineContractRestrictionWarnsWhenCalendarIsIncomplete(),
    preDeadlineOptionSeasonClearsDeadlineRestriction(),
    draftRookieSigningMoratoriumRunsThirtyDays(),
    freeAgentSigningMoratoriumUsesLaterOfThreeMonthsOrDec15(),
    birdRaiseSigningMoratoriumUsesLaterOfThreeMonthsOrJan15(),
    missingSigningMoratoriumDateWarns(),
    unwaivedNoTradeConsentBlocksTrade(),
    timeLimitedNoTradeConsentExpiresByTradeDate(),
    destinationSpecificRestrictionOnlyBlocksMatchingTeam(),
    unusedOutgoingSalaryCreatesModeledTpe(),
    payableTradeBonusCountsAsIncomingSalary(),
    maxSalaryRuleReducesTradeBonus(),
    lesserOfTradeBonusUsesSmallerPercentOrDollarCap(),
    waivedPaidAndSignAndTradeBonusesDoNotTrigger()
  ];
}

function capRoomAbsorptionClearsWithoutMatchingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("CAP", 120_000_000, 14), []),
      side(team("SELL", 180_000_000, 14), [player("wing", 18_000_000)])
    ]
  });
  const capTeam = result.teams.find((row) => row.team === "CAP")!;
  expect(result.legal, "cap-room trade should be legal");
  expect(capTeam.salaryMatch.usedCapRoom, "cap-room team should use room rather than matching salary");
  return "cap room absorption clears without outgoing matching salary";
}

function balancedTradeValueIsModelAccepted(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("VALA", 170_000_000, 14), [player("a", 5_000_000, { tradeValue: 20_000_000, scaleValue: 1 })]),
      side(team("VALB", 170_000_000, 14), [player("b", 5_000_000, { tradeValue: 25_000_000, scaleValue: 1 })])
    ]
  });
  expect(result.legal, "balanced value test trade should be CBA legal");
  expect(result.valueBalance.verdict === "accepted", "trade value within accepted threshold should be model accepted");
  expect(result.modelAccepted, "modelAccepted should require CBA legal plus accepted value balance");
  expect(result.valueBalance.teamSaysNo === null, "accepted value balance should not identify a side saying no");
  return "balanced trade value is model accepted";
}

function scaleAdjustedValueCanDeclineTrade(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SCALEA", 170_000_000, 14), [player("a", 5_000_000, { tradeValue: 80_000_000, scaleValue: 1 })]),
      side(team("SCALEB", 170_000_000, 14), [player("b", 5_000_000, { tradeValue: 80_000_000, scaleValue: 3 })])
    ]
  });
  expect(result.legal, "scale value test trade should be CBA legal");
  expect(result.valueBalance.valueDiff === 0, "raw trade value should be balanced");
  expect(result.valueBalance.scaleAdjustedDiff > result.valueBalance.maybeThreshold, "scale-adjusted imbalance should exceed maybe threshold");
  expect(result.valueBalance.imbalanceBasis === "scale_adjusted_value", "scale-adjusted value should drive the imbalance");
  expect(result.valueBalance.verdict === "declined", "scale-adjusted imbalance should decline the trade");
  expect(!result.modelViable, "modelViable should be false when value balance is declined");
  expect(result.valueBalance.teamSaysNo === "SCALEB", "side sending more scale-adjusted value should say no");
  return "scale-adjusted value can decline a CBA-legal trade";
}

function threeTeamTradeRoutesSalaryAndValueByDestination(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("ATL", 170_000_000, 14), [player("atl-to-bos", 10_000_000, { toTeam: "BOS", tradeValue: 20_000_000, scaleValue: 1 })]),
      side(team("BOS", 170_000_000, 14), [player("bos-to-chi", 10_000_000, { toTeam: "CHI", tradeValue: 20_000_000, scaleValue: 1 })]),
      side(team("CHI", 170_000_000, 14), [player("chi-to-atl", 10_000_000, { toTeam: "ATL", tradeValue: 20_000_000, scaleValue: 1 })])
    ]
  });
  expect(result.legal, "three-team routed salary loop should be legal when each team matches salary independently");
  expect(result.teams.length === 3, "multi-team result should include every participating team");
  expect(result.teamValueBalances.length === 3, "multi-team result should include per-team value balances");
  expect(result.teams.every((teamResult) => teamResult.salaryMatch.incomingSalary === 10_000_000), "each routed team should receive only the asset sent to it");
  expect(result.teamValueBalances.every((balance) => balance.verdict === "accepted"), "balanced three-team value loop should be model accepted");
  expect(result.modelAccepted, "modelAccepted should support legal balanced multi-team trades");
  return "three-team trades route salary and value by destination";
}

function multiTeamTradeRequiresExplicitAssetDestinations(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("A", 170_000_000, 14), [player("missing-destination", 5_000_000)]),
      side(team("B", 170_000_000, 14), []),
      side(team("C", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "multi-team trade should fail when an asset has no destination");
  expect(result.checks.some((check) => check.code === "trade-routing:missing-destination" && check.status === "fail"), "routing check should identify missing destinations");
  return "multi-team trades require explicit asset destinations";
}

function modeledAssetOwnerMustMatchSendingSide(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("OWN", 170_000_000, 14), [player("wrong-team", 8_000_000, { team: "OTHER" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000, { team: "OTHER" })])
    ]
  });
  expect(!result.legal, "modeled asset ownership should match the sending side");
  expect(result.checks.some((check) => check.code === "trade-routing:invalid-sender" && check.status === "fail"), "routing check should fail assets sent by the wrong team");
  return "modeled asset owners must match the sending side";
}

function missingAssetOwnerMetadataDoesNotBlockRouting(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("OWN?", 170_000_000, 14), [player("no-owner", 8_000_000)]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "missing owner metadata should not block manually modeled trades");
  expect(result.checks.some((check) => check.code === "trade-routing" && check.status === "pass"), "routing check should pass when ownership is unmodeled");
  return "missing asset owner metadata does not block routing";
}

function multiTeamDestinationRestrictionUsesRoutedDestination(): string {
  const blocked = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    sides: [
      side(team("POR", 170_000_000, 14), [player("restricted", 8_000_000, { toTeam: "DAL", tradeRestrictionDestinationTeam: "DAL" })]),
      side(team("DAL", 170_000_000, 14), [player("dal-out", 8_000_000, { toTeam: "PHX" })]),
      side(team("PHX", 170_000_000, 14), [player("phx-out", 8_000_000, { toTeam: "POR" })])
    ]
  });
  expect(!blocked.legal, "routed multi-team destination restriction should block the prohibited destination");
  expect(blocked.teams[0].checks.some((check) => check.code === "POR:trade-date-restriction" && check.status === "fail"), "destination-specific restriction should use the routed recipient");

  const allowed = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    sides: [
      side(team("POR", 170_000_000, 14), [player("restricted", 8_000_000, { toTeam: "PHX", tradeRestrictionDestinationTeam: "DAL" })]),
      side(team("DAL", 170_000_000, 14), [player("dal-out", 8_000_000, { toTeam: "POR" })]),
      side(team("PHX", 170_000_000, 14), [player("phx-out", 8_000_000, { toTeam: "DAL" })])
    ]
  });
  expect(allowed.legal, "same player should clear when routed to a non-restricted destination");
  expect(allowed.teams[0].checks.some((check) => check.code === "POR:trade-date-restriction" && check.status === "pass"), "destination-specific restriction should pass for non-matching routed recipient");
  return "multi-team destination restrictions use routed destinations";
}

function standardTpeIsUsedWhenSinglePlayerSalaryFitsStandardPath(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 10_200_000)])
    ]
  });
  expect(result.legal, "single-player standard TPE trade should be legal");
  expect(result.teams[0].salaryMatch.exceptionType === "standard", "single-player salary match should use Standard TPE when it fits");
  expect(result.teams[0].salaryMatch.tradeExceptionCreated === 0, "salary-up standard TPE should not create a modeled TPE");
  return "single-player salary matching uses Standard TPE when the standard path is sufficient";
}

function aggregatedStandardTpeIsUsedWhenMultiPlayerSalaryFitsOneHundredPercentPath(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out-a", 6_000_000), player("out-b", 4_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 10_200_000)])
    ]
  });
  expect(result.legal, "multi-player aggregated standard TPE trade should be legal");
  expect(result.teams[0].salaryMatch.exceptionType === "aggregated_standard", "multi-player salary match should use Aggregated Standard TPE when 100% plus buffer is sufficient");
  return "multi-player salary matching uses Aggregated Standard TPE when the 100 percent path is sufficient";
}

function expandedTpeIsUsedOnlyWhenStandardPathIsInsufficient(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 17_700_000)])
    ]
  });
  expect(result.legal, "expanded TPE trade should be legal");
  expect(result.teams[0].salaryMatch.exceptionType === "expanded", "salary match should use Expanded TPE only once Standard TPE is insufficient");
  return "Expanded TPE is used only when the Standard TPE path is insufficient";
}

function expandedTpeCarriesFirstApronTransactionRestriction(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 17_700_000)])
    ]
  });
  expect(result.legal, "expanded TPE trade below the first apron should remain legal");
  expect(result.teams[0].checks.some((check) => check.code === "BUY:transaction-apron-restriction" && check.status === "pass" && check.detail.includes("Expanded TPE")), "expanded TPE should surface first-apron transaction restriction");
  return "Expanded TPE carries a first-apron transaction restriction";
}

function offseasonExpandedTpeFailsSubsequentYearApronCheck(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-06-20",
    regularSeasonEndDate: "2027-04-15",
    sides: [
      side({ ...team("NEXT", 170_000_000, 14), subsequentYearApronSalary: 207_000_000 }, [
        player("out", 10_000_000, { nextSeasonSalary: 10_000_000 })
      ]),
      side(team("SELL", 170_000_000, 14), [
        player("in", 17_700_000, { nextSeasonSalary: 17_700_000 })
      ])
    ]
  });
  expect(!result.legal, "offseason row-E transaction should fail if following-season apron salary breaches the first apron");
  expect(result.teams[0].subsequentYearApronSalaryAfter === 214_700_000, "next-year apron salary should include the outgoing/incoming next-year salary delta");
  expect(result.teams[0].checks.some((check) => check.code === "NEXT:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("subsequent-year")), "transaction restriction should fail on the subsequent-year apron check");
  return "offseason Expanded TPE fails subsequent-year apron check";
}

function offseasonExpandedTpeWarnsWhenSubsequentYearSalaryMissing(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-06-20",
    regularSeasonEndDate: "2027-04-15",
    sides: [
      side(team("MISS", 170_000_000, 14), [player("out", 10_000_000, { nextSeasonSalary: 10_000_000 })]),
      side(team("SELL", 170_000_000, 14), [player("in", 17_700_000, { nextSeasonSalary: 17_700_000 })])
    ]
  });
  expect(result.legal, "missing following-season team apron salary should warn rather than hard-fail");
  expect(result.status === "warning", "missing following-season team apron salary should produce a warning result");
  expect(result.teams[0].checks.some((check) => check.code === "MISS:transaction-apron-restriction" && check.status === "warn" && check.detail.includes("subsequent-year apron salary")), "transaction restriction should warn that following-season salary is unmodeled");
  return "offseason Expanded TPE warns when subsequent-year salary is missing";
}

function priorTaxpayerMleBlocksExpandedTpe(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("TXMLE", 170_000_000, 14), usedTaxpayerMidLevelThisYear: true }, [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 17_700_000)])
    ]
  });
  expect(!result.legal, "prior Taxpayer MLE use should bar an Expanded TPE transaction");
  expect(result.teams[0].checks.some((check) => check.code === "TXMLE:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("Taxpayer MLE")), "transaction restriction should fail from prior Taxpayer MLE use");
  return "prior Taxpayer MLE use blocks Expanded TPE transactions";
}

function transitionTpeIsUsedInTwentyThreeTwentyFour(): string {
  const result = evaluateTradeMachine({
    season: transitionSeason,
    sides: [
      side(team("TRANS", 150_000_000, 14, undefined, transitionSeason), [player("out", 10_000_000)]),
      side(team("SELL", 150_000_000, 14, undefined, transitionSeason), [player("in", 11_000_000)])
    ]
  });
  expect(result.legal, "2023-24 Transition TPE trade below the first apron should be legal");
  expect(result.teams[0].salaryMatch.exceptionType === "transition", "salary match should choose Transition TPE before the broader Expanded TPE in 2023-24");
  expect(result.teams[0].checks.some((check) => check.code === "TRANS:transaction-apron-restriction" && check.status === "pass" && check.detail.includes("Transition TPE")), "transition TPE should surface row-G transaction restriction");
  return "Transition TPE is used in 2023-24 before Expanded TPE";
}

function transitionTpeCurrentYearApronGraceWarns(): string {
  const result = evaluateTradeMachine({
    season: transitionSeason,
    sides: [
      side(team("GRACE", 172_000_000, 14, undefined, transitionSeason), [player("out", 10_000_000)]),
      side(team("SELL", 150_000_000, 14, undefined, transitionSeason), [player("in", 11_000_000)])
    ]
  });
  expect(result.legal, "2023-24 Transition TPE should not hard-fail solely for a current-year first-apron overage");
  expect(result.status === "warning", "transition TPE current-year apron grace should require review");
  expect(result.teams[0].checks.some((check) => check.code === "GRACE:first-apron" && check.status === "pass"), "first-apron salary-return shortcut should not block the Transition TPE");
  expect(result.teams[0].checks.some((check) => check.code === "GRACE:transaction-apron-restriction" && check.status === "warn" && check.detail.includes("subsequent-year")), "transition TPE should warn about unmodeled subsequent-year apron salary");
  return "Transition TPE 2023-24 current-year apron grace warns instead of hard-failing";
}

function aggregatedStandardTpeAboveSecondApronFailsTransactionRestriction(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("AGG2", 222_000_000, 15), [player("out-a", 1_000_000), player("out-b", 1_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 3_000_000)])
    ]
  });
  expect(!result.legal, "aggregated standard transaction above second apron should fail");
  expect(result.teams[0].checks.some((check) => check.code === "AGG2:transaction-apron-restriction" && check.status === "fail"), "transaction apron restriction should fail at second apron");
  return "Aggregated Standard TPE above the second apron fails the transaction restriction";
}

function priorTaxpayerMleDoesNotBlockAggregatedStandardTpe(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("AGGTAX", 170_000_000, 14), usedTaxpayerMidLevelThisYear: true }, [player("out-a", 6_000_000), player("out-b", 4_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 10_200_000)])
    ]
  });
  expect(result.legal, "prior Taxpayer MLE use should not bar row-H Aggregated Standard TPE trades by itself");
  expect(result.teams[0].checks.some((check) => check.code === "AGGTAX:transaction-apron-restriction" && check.status === "pass" && check.detail.includes("Aggregated Standard TPE")), "row-H aggregation should not be treated as a Taxpayer-MLE-blocked row");
  return "prior Taxpayer MLE use does not block Aggregated Standard TPE transactions";
}

function unprotectedBaseCompensationReducesOutgoingMatchingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("PROT", 170_000_000, 14), [player("unguaranteed", 10_000_000, { currentSeasonGuaranteedSalary: 2_000_000 })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 6_000_000)])
    ]
  });
  expect(!result.legal, "unprotected base compensation should reduce outgoing matching enough to block this trade");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 2_000_000, "outgoing matching salary should use protected current-season amount");
  expect(result.teams[0].checks.some((check) => check.code === "PROT:salary-protection" && check.status === "warn"), "salary protection disclosure should warn");
  return "unprotected base compensation reduces outgoing matching salary";
}

function januaryEighthWindowTreatsCurrentSeasonBaseCompensationAsProtected(): string {
  const result = evaluateTradeMachine({
    season,
    isJan8ToRegularSeasonEndWindow: true,
    sides: [
      side(team("JAN8", 170_000_000, 14), [player("unguaranteed", 10_000_000, { currentSeasonGuaranteedSalary: 2_000_000 })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 6_000_000)])
    ]
  });
  expect(result.legal, "Jan. 8 through regular-season window should deem current-season base compensation protected for matching");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 10_000_000, "outgoing matching salary should remain full salary in Jan. 8 window");
  return "Jan. 8 window treats current-season base compensation as protected";
}

function offseasonMatchingUsesLesserOfCurrentAndNextProtectedSalary(): string {
  const result = evaluateTradeMachine({
    season,
    isPostRegularSeasonToJune30Window: true,
    sides: [
      side(team("OFF", 170_000_000, 14), [
        player("next-unprotected", 12_000_000, {
          currentSeasonGuaranteedSalary: 12_000_000,
          nextSeasonSalary: 8_000_000,
          nextSeasonGuaranteedSalary: 2_000_000
        })
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 5_000_000)])
    ]
  });
  expect(!result.legal, "post-regular-season matching should use lesser of current and next protected salary");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 2_000_000, "outgoing matching salary should use next-season protected amount when it is lower");
  return "offseason matching uses lesser of current and next protected salary";
}

function dpePlayerDoesNotCreateTpeBalance(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("DPE", 170_000_000, 14), [player("dpe-used", 10_000_000, { disabledPlayerExceptionUsed: true })]),
      side(team("ROOM", 140_000_000, 14), [])
    ]
  });
  expect(result.legal, "salary-down trade with DPE-marked player should remain legal");
  expect(result.teams[0].salaryMatch.tradeExceptionCreated === 0, "DPE-marked outgoing player should not create a modeled TPE balance");
  expect(result.teams[0].checks.some((check) => check.code === "DPE:tpe-creation-eligibility" && check.status === "warn"), "TPE creation eligibility should warn");
  return "DPE-marked outgoing player does not create a TPE balance";
}

function disabledPlayerExceptionCanAcquireSingleExpiringContract(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("DPEBUY", 170_000_000, 14), availableTradeExceptions: [{ name: "Disabled Player Exception", amount: 8_000_000, expires: "2027-03-10" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("expiring", 8_000_000, { contractSeasonsRemaining: 1 })])
    ]
  });
  expect(result.legal, "DPE should acquire one expiring contract without outgoing salary");
  expect(result.teams[0].salaryMatch.exceptionType === "disabled_player", "salary match should use the Disabled Player Exception");
  expect(result.teams[0].checks.some((check) => check.code === "DPEBUY:disabled-player-exception-term" && check.status === "pass"), "DPE term check should pass expiring contracts");
  expect(result.teams[0].checks.some((check) => check.code === "DPEBUY:disabled-player-exception-expiry" && check.status === "pass"), "DPE expiry check should pass before expiration");
  return "Disabled Player Exception can acquire a single expiring contract";
}

function disabledPlayerExceptionDoesNotAcquireMultiplePlayers(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("DPEMULTI", 170_000_000, 14), availableTradeExceptions: [{ name: "Disabled Player Exception", amount: 8_000_000, expires: "2027-03-10" }] }, []),
      side(team("SELL", 170_000_000, 14), [
        player("first", 4_000_000, { contractSeasonsRemaining: 1 }),
        player("second", 4_000_000, { contractSeasonsRemaining: 1 })
      ])
    ]
  });
  expect(!result.legal, "DPE should not acquire multiple non-minimum players");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "multiple incoming players should not select the Disabled Player Exception");
  return "Disabled Player Exception does not acquire multiple players";
}

function disabledPlayerExceptionRejectsNonExpiringContract(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("DPETERM", 170_000_000, 14), availableTradeExceptions: [{ name: "Disabled Player Exception", amount: 8_000_000, expires: "2027-03-10" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("multi-year", 8_000_000, { contractSeasonsRemaining: 2 })])
    ]
  });
  expect(!result.legal, "DPE should fail for a non-expiring acquired contract");
  expect(result.teams[0].salaryMatch.exceptionType === "disabled_player", "salary match should identify the DPE path before term validation fails");
  expect(result.teams[0].checks.some((check) => check.code === "DPETERM:disabled-player-exception-term" && check.status === "fail"), "DPE term check should fail over-term contracts");
  return "Disabled Player Exception rejects non-expiring contracts";
}

function disabledPlayerExceptionWarnsWhenTermOrExpiryIsUnknown(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("DPEUNK", 170_000_000, 14), availableTradeExceptions: [{ name: "Disabled Player Exception", amount: 8_000_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("unknown-term", 8_000_000)])
    ]
  });
  expect(result.legal, "unknown DPE metadata should warn rather than hard-fail");
  expect(result.status === "warning", "unknown DPE term/expiry should put result in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "DPEUNK:disabled-player-exception-term" && check.status === "warn"), "DPE term check should warn when acquired term is unknown");
  expect(result.teams[0].checks.some((check) => check.code === "DPEUNK:disabled-player-exception-expiry" && check.status === "warn"), "DPE expiry check should warn when expiry is unknown");
  return "Disabled Player Exception warns when term or expiry is unknown";
}

function incomingTwoWayDoesNotCountAsTradeSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("TWBUY", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 14), [player("two-way", 500_000, { isTwoWay: true })])
    ]
  });
  expect(result.legal, "incoming Two-Way contract should not require trade salary matching");
  expect(result.teams[0].salaryMatch.incomingSalary === 0, "incoming Two-Way salary should be excluded from trade salary");
  expect(result.teams[0].salaryMatch.incomingSalaryForMatching === 0, "incoming Two-Way salary should not require matching");
  expect(result.teams[0].afterSalary === 170_000_000, "incoming Two-Way should not increase team salary");
  return "incoming Two-Way contracts do not count as trade salary";
}

function twoWayRosterAccountingDoesNotCountAsStandardContract(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("TWROSTER", 170_000_000, 15), [player("standard-out", 5_000_000)]),
      side(team("SELL", 140_000_000, 14), [player("two-way-in", 500_000, { isTwoWay: true })])
    ]
  });
  expect(result.legal, "standard-for-Two-Way trade should not fail standard roster maximum");
  expect(result.teams[0].rosterAfter === 14, "incoming Two-Way should not count as a standard contract for roster limit");
  expect(result.teams[0].checks.some((check) => check.code === "TWROSTER:roster-limit" && check.status === "pass" && check.detail.includes("14 standard")), "roster limit check should see only standard contracts");
  return "Two-Way roster accounting does not count as a standard contract";
}

function twoWayOutgoingDoesNotMakeSalaryMatchAggregated(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("TWOUT", 225_000_000, 15), [
        player("standard-out", 10_000_000),
        player("two-way-out", 500_000, { isTwoWay: true })
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 10_000_000)])
    ]
  });
  expect(result.legal, "standard plus Two-Way outgoing package should not fail second-apron aggregation");
  expect(result.teams[0].salaryMatch.exceptionType === "standard", "Two-Way outgoing should not make salary matching use the aggregated TPE path");
  expect(result.teams[0].checks.some((check) => check.code === "TWOUT:second-apron-aggregation" && check.status === "pass"), "second-apron aggregation check should ignore zero-trade-salary Two-Ways");
  return "outgoing Two-Way contracts do not make salary matching aggregated";
}

function recentTwoWayDoesNotTriggerAggregationRestriction(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("TWAREC", 170_000_000, 15), [
        player("standard-out", 10_000_000),
        player("recent-two-way", 500_000, {
          isTwoWay: true,
          acquiredByTradeDate: "2027-01-01",
          acquiredByTradeSource: "prior trade"
        })
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 10_000_000)])
    ]
  });
  expect(result.legal, "recently acquired Two-Way should not trigger aggregation restrictions when paired with one standard outgoing salary");
  expect(result.teams[0].checks.some((check) => check.code === "TWAREC:recent-trade-aggregation" && check.status === "pass"), "recent trade aggregation should ignore zero-trade-salary Two-Ways");
  return "recently acquired Two-Ways do not trigger aggregation restrictions";
}

function unknownTradeCalendarWarnsOnMinimumAggregationWindow(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MIN?", 170_000_000, 15), [
        player("min-a", 2_000_000, { isMinimumSalary: true }),
        player("min-b", 2_000_000, { isMinimumSalary: true }),
        player("salary", 14_000_000)
      ]),
      side(team("SELL", 170_000_000, 13), [player("incoming", 18_000_000)])
    ]
  });
  expect(result.legal, "unknown trade calendar should warn rather than hard-fail minimum aggregation timing");
  expect(result.teams[0].checks.some((check) => check.code === "MIN?:minimum-aggregation" && check.status === "warn"), "minimum aggregation should warn when timing is unknown");
  return "unknown trade calendar warns on the minimum aggregation timing window";
}

function inSeasonTradeAfterDeadlineFailsTradeWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-06",
    tradeDeadlineDate: "2027-02-05",
    regularSeasonEndDate: "2027-04-12",
    sides: [
      side(team("LATE", 170_000_000, 14), [player("late-out", 8_000_000)]),
      side(team("OTHER", 170_000_000, 14), [player("late-in", 8_000_000)])
    ]
  });
  expect(!result.legal, "post-deadline in-season trade should fail the global trade window");
  expect(result.checks.some((check) => check.code === "trade-window" && check.status === "fail"), "trade-window check should fail after deadline and before regular-season end");
  return "in-season trades after the trade deadline fail the trade window";
}

function deadlineDayTradePassesTradeWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-05",
    tradeDeadlineDate: "2027-02-05",
    regularSeasonEndDate: "2027-04-12",
    sides: [
      side(team("DAY", 170_000_000, 14), [player("day-out", 8_000_000)]),
      side(team("OTHER", 170_000_000, 14), [player("day-in", 8_000_000)])
    ]
  });
  expect(result.legal, "deadline-day trade should remain inside the trade window");
  expect(result.checks.some((check) => check.code === "trade-window" && check.status === "pass" && check.detail.includes("on or before")), "trade-window check should pass on deadline day");
  return "deadline-day trades pass the trade window";
}

function offseasonTradeAfterRegularSeasonPassesTradeWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-05-10",
    tradeDeadlineDate: "2027-02-05",
    regularSeasonEndDate: "2027-04-12",
    sides: [
      side(team("OFFWIN", 170_000_000, 14), [player("off-out", 8_000_000)]),
      side(team("OTHER", 170_000_000, 14), [player("off-in", 8_000_000)])
    ]
  });
  expect(result.legal, "post-regular-season trade should not fail the in-season deadline bar");
  expect(result.checks.some((check) => check.code === "trade-window" && check.status === "pass" && check.detail.includes("regular-season end")), "trade-window check should pass after regular-season end");
  return "post-regular-season trades pass the trade window";
}

function postDeadlineTradeWindowWarnsWhenSeasonEndIsMissing(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-06",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("LATE?", 170_000_000, 14), [player("maybe-out", 8_000_000)]),
      side(team("OTHER", 170_000_000, 14), [player("maybe-in", 8_000_000)])
    ]
  });
  expect(result.legal, "post-deadline trade without a season-end date should warn rather than hard-fail");
  expect(result.status === "warning", "post-deadline trade without season-end date should put the trade in warning status");
  expect(result.checks.some((check) => check.code === "trade-window" && check.status === "warn"), "trade-window check should warn when regular-season end is missing");
  return "post-deadline trade window warns when regular-season end is missing";
}

function tradeDateDerivesDec15ToDeadlineMinimumAggregationWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("MINWIN", 170_000_000, 15), [
        player("min-a", 2_000_000, { isMinimumSalary: true }),
        player("min-b", 2_000_000, { isMinimumSalary: true }),
        player("salary", 14_000_000)
      ]),
      side(team("SELL", 170_000_000, 13), [player("incoming", 18_000_000)])
    ]
  });
  expect(result.legal, "trade date inside Dec. 15-to-deadline window should satisfy minimum aggregation timing");
  expect(result.teams[0].checks.some((check) => check.code === "MINWIN:minimum-aggregation" && check.status === "pass" && check.detail.includes("inside")), "minimum aggregation should derive inside-window pass");
  return "trade date derives the Dec. 15-to-deadline minimum aggregation window";
}

function tradeDateDerivesJan8ProtectionWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    regularSeasonEndDate: "2027-04-12",
    sides: [
      side(team("JAN8D", 170_000_000, 14), [player("unguaranteed", 10_000_000, { currentSeasonGuaranteedSalary: 2_000_000 })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 6_000_000)])
    ]
  });
  expect(result.legal, "trade date after Jan. 8 and before regular-season end should derive protected current salary");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 10_000_000, "derived Jan. 8 window should use full current salary");
  return "trade date derives the Jan. 8 current-season protection window";
}

function tradeDateDerivesPostRegularSeasonProtectionWindow(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-05-10",
    regularSeasonEndDate: "2027-04-12",
    sides: [
      side(team("OFFD", 170_000_000, 14), [
        player("next-unprotected", 12_000_000, {
          currentSeasonGuaranteedSalary: 12_000_000,
          nextSeasonSalary: 8_000_000,
          nextSeasonGuaranteedSalary: 2_000_000
        })
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 5_000_000)])
    ]
  });
  expect(!result.legal, "trade date after regular-season end and through June 30 should derive next protected matching salary");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 2_000_000, "derived offseason window should use next-season protected amount");
  return "trade date derives the post-regular-season protected salary window";
}

function overCapTeamCannotAbsorbSalaryWithoutOutgoingRoomOrTpe(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("NOPE", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 100_000)])
    ]
  });
  expect(!result.legal, "over-cap team should not get phantom incoming salary allowance with no outgoing salary or TPE");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "no-outgoing over-cap absorption should have no exception path");
  expect(result.teams[0].salaryMatch.maxIncomingSalary === 0, "no-outgoing over-cap absorption should allow zero incoming salary absent TPE");
  return "over-cap teams cannot absorb salary without outgoing salary, room, or an existing TPE";
}

function overCapTeamCanAcquireMinimumSalaryWithoutOutgoingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MINEX", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 15), [player("minimum", 2_000_000, { isMinimumSalary: true, contractSeasonsRemaining: 2 })])
    ]
  });
  expect(result.legal, "over-cap team should acquire a minimum contract without outgoing salary");
  expect(result.teams[0].salaryMatch.exceptionType === "minimum_salary", "salary match should use the Minimum Player Salary Exception");
  expect(result.teams[0].salaryMatch.incomingSalaryForMatching === 0, "minimum-exception salary should not require salary matching");
  expect(result.teams[0].salaryMatch.minimumSalaryExceptionSalary === 2_000_000, "minimum-exception salary should be tracked");
  expect(result.teams[0].checks.some((check) => check.code === "MINEX:minimum-exception-term" && check.status === "pass"), "minimum exception term check should pass with a two-season contract");
  return "over-cap teams can acquire minimum salary without outgoing salary";
}

function minimumSalaryExceptionCanPairWithSalaryMatchedIncoming(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MIXMIN", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 15), [player("normal", 10_000_000), player("minimum", 2_000_000, { isMinimumSalary: true, contractSeasonsRemaining: 1 })])
    ]
  });
  expect(result.legal, "minimum exception should pair with a separately salary-matched incoming player");
  expect(result.teams[0].salaryMatch.exceptionType === "standard", "normal incoming salary should still be matched through the Standard TPE");
  expect(result.teams[0].salaryMatch.incomingSalary === 12_000_000, "total incoming salary should include the minimum player");
  expect(result.teams[0].salaryMatch.incomingSalaryForMatching === 10_000_000, "only non-minimum incoming salary should require matching");
  return "minimum salary exception can pair with salary-matched incoming";
}

function minimumSalaryExceptionRejectsBonusContract(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MINBONUS", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 15), [player("minimum-bonus", 2_000_000, { isMinimumSalary: true, tradeBonus: { amount: 100_000, remainingBaseCompensation: 2_000_000 } })])
    ]
  });
  expect(!result.legal, "minimum-salary exception should not cover a contract with a modeled bonus");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "bonus-bearing minimum-labeled player should not use the Minimum Player Salary Exception");
  expect(result.teams[0].salaryMatch.incomingSalaryForMatching > 0, "bonus-bearing minimum-labeled player should still require matching");
  return "minimum salary exception rejects bonus-bearing contracts";
}

function minimumSalaryExceptionRejectsOverTwoSeasonContract(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MINTERM", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 15), [player("minimum-long", 2_000_000, { isMinimumSalary: true, contractSeasonsRemaining: 3 })])
    ]
  });
  expect(!result.legal, "minimum salary exception should not cover a contract with more than two seasons remaining");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "over-term minimum contract should still require salary matching");
  expect(result.teams[0].checks.some((check) => check.code === "MINTERM:minimum-exception-term" && check.status === "fail"), "minimum exception term check should fail over-term contracts");
  return "minimum salary exception rejects contracts longer than two seasons";
}

function minimumSalaryExceptionWarnsWhenContractTermIsUnknown(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("MINUNK", 170_000_000, 14), []),
      side(team("SELL", 170_000_000, 15), [player("minimum-unknown", 2_000_000, { isMinimumSalary: true })])
    ]
  });
  expect(result.legal, "unknown minimum contract term should warn rather than hard-fail");
  expect(result.status === "warning", "unknown minimum contract term should put the result in warning status");
  expect(result.teams[0].salaryMatch.exceptionType === "minimum_salary", "unknown-term minimum contract can use the exception pending review");
  expect(result.teams[0].checks.some((check) => check.code === "MINUNK:minimum-exception-term" && check.status === "warn"), "minimum exception term check should warn when term is unknown");
  return "minimum salary exception warns when contract term is unknown";
}

function existingTpeCanAbsorbIncomingSalaryWithoutOutgoingPlayer(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TPE", 170_000_000, 14), availableTradeExceptions: [{ name: "Existing Traded Player Exception", amount: 8_000_000, expires: "2027-02-01" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_200_000)])
    ]
  });
  expect(result.legal, "existing TPE should absorb incoming salary without outgoing player salary");
  expect(result.teams[0].salaryMatch.exceptionType === "existing_tpe", "salary match should use existing TPE path");
  expect(result.teams[0].checks.some((check) => check.code === "TPE:existing-tpe-expiry" && check.status === "pass"), "nonexpired TPE should pass expiry check");
  return "existing TPE can absorb incoming salary without outgoing player";
}

function expiredExistingTpeCannotAbsorbIncomingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TPEEXP", 170_000_000, 14), availableTradeExceptions: [{ name: "Expired Traded Player Exception", amount: 8_000_000, expires: "2027-01-01" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "expired existing TPE should not be usable for incoming salary");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "expired existing TPE should be filtered out before salary matching");
  expect(result.teams[0].checks.some((check) => check.code === "TPEEXP:salary-match" && check.status === "fail"), "salary matching should fail when the only fitting TPE is expired");
  return "expired existing TPEs cannot absorb incoming salary";
}

function existingTpeExpiryWarnsWhenTradeDateIsMissing(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("TPEDATE", 170_000_000, 14), availableTradeExceptions: [{ name: "Dated Traded Player Exception", amount: 8_000_000, expires: "2027-01-20" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "missing trade date should not hard-fail a TPE that otherwise fits");
  expect(result.teams[0].checks.some((check) => check.code === "TPEDATE:existing-tpe-expiry" && check.status === "warn"), "TPE expiry should warn when trade date is missing");
  return "existing TPE expiry warns when trade date is missing";
}

function existingTpeUnknownExpiryWarnsWhenTradeDateIsModeled(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TPEUNK", 170_000_000, 14), availableTradeExceptions: [{ name: "Unknown Expiry Traded Player Exception", amount: 8_000_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "unknown TPE expiry should warn rather than hard-fail");
  expect(result.teams[0].checks.some((check) => check.code === "TPEUNK:existing-tpe-expiry" && check.status === "warn"), "TPE expiry should warn when expiry date is unknown");
  return "existing TPE use warns when expiry date is unknown";
}

function knownExistingTpeMetadataClearsTransactionWarning(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TPECLEAN", 170_000_000, 14), availableTradeExceptions: [{ name: "Known Clean Traded Player Exception", amount: 8_000_000, expires: "2027-05-01", firstApronRestrictionStarts: "2027-04-15", signedAndTradedContract: false }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "known clean TPE metadata should not hard-fail below the first apron");
  expect(result.teams[0].checks.some((check) => check.code === "TPECLEAN:transaction-apron-restriction" && check.status === "pass"), "known clean TPE metadata should clear the transaction timing warning");
  return "known existing TPE metadata clears transaction timing warning";
}

function existingTpeAfterRowFTimingHardCapsAtFirstApron(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-04-16",
    sides: [
      side({ ...team("TPEROWF", 206_500_000, 14), availableTradeExceptions: [{ name: "Post-Regular-Season Standard TPE", amount: 8_000_000, expires: "2027-05-01", firstApronRestrictionStarts: "2027-04-15", signedAndTradedContract: false }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "row-F TPE use should hard-cap the team at the first apron after its restriction date");
  expect(result.teams[0].checks.some((check) => check.code === "TPEROWF:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("row-F")), "row-F transaction restriction should fail above the first apron");
  return "existing TPE after row-F timing hard-caps at the first apron";
}

function priorTaxpayerMleWarnsOnUnknownRowFTiming(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TXROWF", 170_000_000, 14), usedTaxpayerMidLevelThisYear: true, availableTradeExceptions: [{ name: "Undated Existing TPE", amount: 8_000_000, expires: "2027-05-01" }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "unknown row-F timing should warn rather than hard-fail prior Taxpayer MLE interaction");
  expect(result.status === "warning", "unknown row-F timing should put the result in warning state");
  expect(result.teams[0].checks.some((check) => check.code === "TXROWF:transaction-apron-restriction" && check.status === "warn" && check.detail.includes("Taxpayer MLE")), "prior Taxpayer MLE should warn when row-F timing is unknown");
  return "prior Taxpayer MLE use warns on unknown existing-TPE row-F timing";
}

function signAndTradeOriginExistingTpeHardCapsAtSecondApron(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side({ ...team("TPESAT", 217_000_000, 14), availableTradeExceptions: [{ name: "Signed-and-Traded Contract TPE", amount: 8_000_000, expires: "2027-05-01", firstApronRestrictionStarts: "2027-06-30", signedAndTradedContract: true }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "S&T-origin TPE use should hard-cap the team at the second apron");
  expect(result.teams[0].checks.some((check) => check.code === "TPESAT:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("signed-and-traded")), "row-J transaction restriction should fail above the second apron");
  return "S&T-origin existing TPE hard-caps at the second apron";
}

function nonTaxpayerMleCanAcquireAssignedContract(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("MLE", 170_000_000, 14), availableTradeExceptions: [{ name: "Non-Taxpayer MLE", amount: 15_000_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000, { contractSeasonsRemaining: 3 })])
    ]
  });
  expect(result.legal, "non-taxpayer MLE should acquire an assigned contract in 2024-25 or later when salary and term fit");
  expect(result.teams[0].salaryMatch.exceptionType === "non_taxpayer_mle", "salary match should use the Non-Taxpayer MLE assignment path");
  expect(result.teams[0].checks.some((check) => check.code === "MLE:assignment-exception-term" && check.status === "pass"), "NTPMLE assignment should validate remaining contract term");
  expect(result.teams[0].checks.some((check) => check.code === "MLE:transaction-apron-restriction" && check.status === "pass" && check.detail.includes("Non-Taxpayer MLE")), "NTPMLE assignment should carry row-B first-apron transaction treatment");
  return "Non-Taxpayer MLE can acquire an assigned contract";
}

function biAnnualAssignmentHardCapsAtFirstApron(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("BAEAPR", 207_000_000, 14), availableTradeExceptions: [{ name: "Bi-Annual", amount: 5_500_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 4_000_000, { contractSeasonsRemaining: 2 })])
    ]
  });
  expect(!result.legal, "Bi-annual assignment should be illegal when it leaves the team above the first apron");
  expect(result.teams[0].salaryMatch.exceptionType === "bi_annual", "salary match should identify the Bi-annual assignment path");
  expect(result.teams[0].checks.some((check) => check.code === "BAEAPR:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("Bi-annual")), "BAE assignment should trigger row-A first-apron failure");
  return "Bi-annual assignment hard-caps at the first apron";
}

function roomExceptionRejectsFourSeasonAssignedContract(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("ROOMTERM", 170_000_000, 14), availableTradeExceptions: [{ name: "Room Exception", amount: 9_500_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000, { contractSeasonsRemaining: 4 })])
    ]
  });
  expect(!result.legal, "Room exception assignment should fail when remaining term exceeds three seasons");
  expect(result.teams[0].salaryMatch.exceptionType === "room_mle", "salary match should identify the room exception assignment path");
  expect(result.teams[0].checks.some((check) => check.code === "ROOMTERM:assignment-exception-term" && check.status === "fail"), "room exception term check should fail four-season contracts");
  return "Room exception rejects four-season assigned contracts";
}

function preTwentyFourTwentyFiveMleCannotAcquireByAssignment(): string {
  const result = evaluateTradeMachine({
    season: transitionSeason,
    sides: [
      side({ ...team("OLDMLE", 150_000_000, 14, undefined, transitionSeason), availableTradeExceptions: [{ name: "Non-Taxpayer MLE", amount: 12_000_000 }] }, []),
      side(team("SELL", 150_000_000, 14, undefined, transitionSeason), [player("incoming", 8_000_000, { contractSeasonsRemaining: 3 })])
    ]
  });
  expect(!result.legal, "MLE assignment acquisition should not be available before the 2024-25 salary-cap year");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "pre-2024-25 MLE should not be selected as an assignment exception");
  return "pre-2024-25 MLE cannot acquire contracts by assignment";
}

function taxpayerMleDoesNotAcquireByAssignment(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("TMLE", 170_000_000, 14), availableTradeExceptions: [{ name: "Taxpayer MLE", amount: 7_000_000 }] }, []),
      side(team("SELL", 170_000_000, 14), [player("incoming", 5_000_000, { contractSeasonsRemaining: 2 })])
    ]
  });
  expect(!result.legal, "Taxpayer MLE should not acquire assigned contracts under the modeled CBA text");
  expect(result.teams[0].salaryMatch.exceptionType === "none", "Taxpayer MLE should not be selected as an assignment exception");
  return "Taxpayer MLE does not acquire contracts by assignment";
}

function existingTpeDoesNotCombineWithOutgoingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("COMBO", 170_000_000, 14), availableTradeExceptions: [{ name: "Existing Traded Player Exception", amount: 8_000_000 }] }, [player("out", 5_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 13_000_000)])
    ]
  });
  expect(!result.legal, "existing TPE should not combine with outgoing salary to cover one incoming contract");
  expect(result.teams[0].salaryMatch.exceptionType === "expanded", "team should fail through outgoing-salary matching rather than combining an existing TPE");
  return "existing TPE does not combine with outgoing salary";
}

function nonApronMiddleBandAllowsOutgoingPlusDelta(): string {
  const legal = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 17_700_000)])
    ]
  });
  expect(legal.legal, "non-apron middle-band trade should pass when within scaled outgoing-plus-delta");

  const illegal = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 20_000_000)])
    ]
  });
  expect(!illegal.legal, "non-apron middle-band trade should fail when above scaled outgoing-plus-delta");
  return "non-apron salary band allows only the CBA return amount";
}

function firstApronTeamCannotTakeBackExtraSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("APRON", 214_000_000, 14), [player("out", 20_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 20_100_000)])
    ]
  });
  expect(!result.legal, "first-apron team taking back more than outgoing should fail");
  expect(result.teams[0].checks.some((check) => check.code === "APRON:first-apron" && check.status === "fail"), "first-apron check should fail");
  return "first-apron teams cannot take back extra salary";
}

function secondApronTeamCannotAggregateOutgoingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SECOND", 225_000_000, 15), [player("a", 12_000_000), player("b", 8_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 20_000_000)])
    ]
  });
  expect(!result.legal, "second-apron aggregation should fail");
  expect(result.teams[0].checks.some((check) => check.code === "SECOND:second-apron-aggregation" && check.status === "fail"), "aggregation rule should fail");
  return "second-apron teams cannot aggregate outgoing salaries";
}

function bycSalaryCountsAtGreaterOfPreviousOrHalfNewSalary(): string {
  expect(baseYearCompensationOutgoingSalary({ applies: true, previousSalary: 8_000_000, newSalary: 20_000_000 }) === 10_000_000, "BYC should use half new salary when it exceeds previous salary");
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BYC", 170_000_000, 14), [player("new-deal", 20_000_000, { baseYearCompensation: { applies: true, previousSalary: 8_000_000, newSalary: 20_000_000 } })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 20_000_000)])
    ]
  });
  expect(!result.legal, "BYC-reduced outgoing salary should make the incoming salary illegal");
  expect(result.teams[0].salaryMatch.outgoingSalaryForMatching === 10_000_000, "BYC outgoing matching salary should be 10M");
  return "BYC uses greater of previous salary or half new salary for outgoing matching";
}

function stepienBlocksConsecutiveFutureFirstGaps(): string {
  const context = team("PICKS", 170_000_000, 14, [2027, 2028, 2029, 2030]);
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(context, [first("2027", 2027), first("2028", 2028)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "Stepien should block consecutive missing first-round drafts");
  expect(result.teams[0].checks.some((check) => check.code === "PICKS:stepien" && check.status === "fail"), "Stepien check should fail");
  return "Stepien blocks trades that create consecutive future first gaps";
}

function incomingFirstCanRepairStepienGapInSameTrade(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("REPAIR", 170_000_000, 14, [2027, 2029, 2030, 2031, 2032, 2033, 2034]), [first("own-2027", 2027)]),
      side(team("OTHER", 170_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [first("other-2028", 2028)])
    ]
  });
  expect(result.legal, "incoming first-round pick in the same trade should count toward post-trade Stepien inventory");
  expect(result.teams[0].checks.some((check) => check.code === "REPAIR:stepien" && check.status === "pass" && check.detail.includes("Incoming first")), "Stepien detail should disclose incoming replacement firsts");
  return "incoming first-round picks can repair Stepien gaps in the same trade";
}

function protectedIncomingFirstWarnsWhenNeededForStepienCoverage(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("REVIEW", 170_000_000, 14, [2027, 2029, 2030, 2031, 2032, 2033, 2034]), [first("own-2027", 2027)]),
      side(team("OTHER", 170_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [
        first("protected-2028", 2028, {
          protection: "2028 top-10 protected, 2029 top-8 protected, converts to seconds",
          protectionCutoff: 10
        })
      ])
    ]
  });
  expect(result.legal, "protected incoming first should warn rather than hard-fail when it may cover Stepien");
  expect(result.status === "warning", "protected incoming Stepien coverage should put the trade in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "REVIEW:stepien" && check.status === "warn" && check.detail.includes("protected incoming")), "Stepien should warn when protected incoming firsts are needed for coverage");
  return "protected incoming firsts warn when needed for Stepien coverage";
}

function secondApronBlocksSevenYearOutFirst(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SECOND", 225_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [first("2035", 2035)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "second apron should block sending firsts more than seven years out");
  expect(result.teams[0].checks.some((check) => check.code === "SECOND:stepien" && check.status === "fail"), "future first limit should fail through Stepien check");
  return "second-apron teams cannot send a first more than seven drafts out";
}

function secondApronFrozenSeventhYearFirstCannotBeTraded(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SECOND", 225_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [first("2034", 2034)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "current second-apron team should not be able to trade its frozen seven-year-out first");
  expect(result.teams[0].checks.some((check) => check.code === "SECOND:second-apron-frozen-pick" && check.status === "fail"), "frozen pick check should fail");
  return "second-apron frozen seven-year-out first cannot be traded";
}

function secondApronFrozenSeventhYearFirstSwapCannotBeTraded(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SECONDSWAP", 225_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [first("swap-2034", 2034, { assetType: "pick_swap" })]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "current second-apron team should not be able to trade a swap right on its frozen seven-year-out first");
  expect(result.teams[0].checks.some((check) => check.code === "SECONDSWAP:second-apron-frozen-pick" && check.status === "fail"), "frozen pick check should fail for seventh-year first-round swap rights");
  expect(result.teams[0].checks.some((check) => check.code === "SECONDSWAP:stepien" && check.status === "pass"), "Stepien should still ignore swap rights as full outgoing firsts");
  return "second-apron frozen seven-year-out first swap cannot be traded";
}

function pickSwapDoesNotRemoveOwnFirstForStepien(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SWAP", 170_000_000, 14, [2027, 2028, 2029, 2030]), [first("swap-2027", 2027, { assetType: "pick_swap" })]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(result.legal, "pick swap should not be treated as trading away the team's own first");
  expect(result.teams[0].checks.some((check) => check.code === "SWAP:stepien" && check.status === "pass"), "Stepien should pass for pick swaps");
  expect(result.teams[0].checks.some((check) => check.code === "SWAP:pick-specificity" && check.status === "warn"), "pick swap should still carry a terms review warning");
  return "pick swaps do not remove the team's own first for Stepien";
}

function protectedFirstRequiresRolloverSpecificityReview(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("PROT", 170_000_000, 14, [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]), [first("protected-2027", 2027, { protection: "top-10 protected", protectionCutoff: 10 })]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(result.legal, "protected first can be salary-legal while still needing terms review");
  expect(result.status === "warning", "protected first should put the result in warning state");
  expect(result.teams[0].checks.some((check) => check.code === "PROT:pick-specificity" && check.status === "warn"), "protected first should warn about rollover terms");
  return "protected firsts require protection and rollover specificity review";
}

function protectedFirstRolloverYearsWarnOnStepienRisk(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("ROLL", 170_000_000, 14, [2027, 2028, 2029, 2030, 2032, 2033, 2034]), [
        first("protected-2028", 2028, {
          protection: "2028 top-10 protected, 2029 top-8 protected, 2030 top-5 protected, converts to seconds",
          protectionCutoff: 10
        })
      ]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(result.legal, "protected first rollover Stepien uncertainty should warn rather than hard-fail");
  expect(result.status === "warning", "protected first rollover Stepien risk should put the result in warning state");
  expect(result.teams[0].checks.some((check) => check.code === "ROLL:stepien" && check.status === "warn" && check.detail.includes("2030-2031")), "Stepien should warn when a protected first can roll into a consecutive-pick gap");
  return "protected first rollover years warn on Stepien risk";
}

function signAndTradeAcquisitionHardCapsAtFirstApron(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("ACQ", 211_000_000, 14), [player("out", 8_000_000)]),
      side(team("SIGN", 170_000_000, 14), [
        player("signed", 10_000_000, {
          signedAndTraded: true,
          signAndTradeContractYears: 3,
          signAndTradeFirstSeasonProtected: true,
          signAndTradeUsedProhibitedException: false,
          signAndTradeFinishedPriorSeasonWithTeam: true,
          signAndTradeBeforeRegularSeason: true
        })
      ])
    ]
  });
  expect(!result.legal, "S&T acquirer above the first apron should fail");
  expect(result.teams[0].checks.some((check) => check.code === "ACQ:sign-and-trade" && check.status === "fail"), "S&T hard-cap check should fail");
  return "signed-and-traded player acquisitions hard-cap the acquiring team at the first apron";
}

function priorTaxpayerMleBlocksSignAndTradeAcquisition(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("TXSAT", 170_000_000, 14), usedTaxpayerMidLevelThisYear: true }, [player("out", 8_000_000)]),
      side(team("SIGN", 170_000_000, 14), [
        player("signed", 8_000_000, {
          signedAndTraded: true,
          signAndTradeContractYears: 3,
          signAndTradeFirstSeasonProtected: true,
          signAndTradeUsedProhibitedException: false,
          signAndTradeFinishedPriorSeasonWithTeam: true,
          signAndTradeBeforeRegularSeason: true
        })
      ])
    ]
  });
  expect(!result.legal, "prior Taxpayer MLE use should bar sign-and-trade acquisitions even below the first apron");
  expect(result.teams[0].checks.some((check) => check.code === "TXSAT:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("Taxpayer MLE")), "transaction restriction should fail before relying on the S&T hard-cap check");
  expect(result.teams[0].checks.some((check) => check.code === "TXSAT:sign-and-trade" && check.status === "pass"), "S&T contract facts should otherwise pass so the prior Taxpayer MLE blocker is isolated");
  return "prior Taxpayer MLE use blocks sign-and-trade acquisitions";
}

function signAndTradeUsedProhibitedExceptionFails(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SATEX", 170_000_000, 14), [player("out", 8_000_000)]),
      side(team("SIGN", 170_000_000, 14), [
        player("signed", 8_000_000, {
          signedAndTraded: true,
          signAndTradeContractYears: 3,
          signAndTradeFirstSeasonProtected: true,
          signAndTradeUsedProhibitedException: true,
          signAndTradeFinishedPriorSeasonWithTeam: true,
          signAndTradeBeforeRegularSeason: true
        })
      ])
    ]
  });
  expect(!result.legal, "S&T signed using a prohibited exception should fail");
  expect(result.teams[0].checks.some((check) => check.code === "SATEX:sign-and-trade" && check.status === "fail" && check.detail.includes("cannot be signed")), "S&T check should fail on prohibited signing exception use");
  return "sign-and-trade use of prohibited signing exceptions fails";
}

function signAndTradeMissingProhibitedExceptionFactWarns(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SATUNK", 170_000_000, 14), [player("out", 8_000_000)]),
      side(team("SIGN", 170_000_000, 14), [
        player("signed", 8_000_000, {
          signedAndTraded: true,
          signAndTradeContractYears: 3,
          signAndTradeFirstSeasonProtected: true,
          signAndTradeFinishedPriorSeasonWithTeam: true,
          signAndTradeBeforeRegularSeason: true
        })
      ])
    ]
  });
  expect(result.legal, "missing prohibited-exception fact should warn rather than hard-fail");
  expect(result.status === "warning", "missing prohibited-exception fact should put the trade in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "SATUNK:sign-and-trade" && check.status === "warn"), "S&T check should warn when prohibited-exception use is unmodeled");
  return "sign-and-trade missing prohibited-exception fact warns";
}

function capTrackerHardCapOverrideIsEnforced(): string {
  const hardCap = capTrackerHardCap([
    { id: "first", team: "HC", year: season.year, hard_cap: "first_apron", trigger: "Non-taxpayer MLE", source: "test" }
  ], "HC", season.year);
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("HC", 215_000_000, 14), hardCap }, [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [player("in", 9_000_000)])
    ]
  });
  expect(hardCap === "first_apron", "cap tracker hard-cap rows should produce a first-apron hard cap");
  expect(!result.legal, "modeled hard-cap state should be enforced independently of the current trade trigger");
  expect(result.teams[0].checks.some((check) => check.code === "HC:hard-cap" && check.status === "fail"), "hard-cap check should fail when post-trade salary exceeds the modeled cap");
  return "cap tracker hard-cap override rows are enforced";
}

function capTrackerCashTotalsFeedTradeContext(): string {
  const context = tradeTeamContextFromCapTracker(
    capTrackerDataWithTeamSeason({
      ...teamSeason("CASHCTX", season.year, 170_000_000),
      cash_paid_this_year: 8_000_000,
      cash_received_this_year: 1_000_000
    }),
    "CASHCTX",
    season.year,
    14
  );
  expect(context !== null, "cap tracker team context should be built for the modeled team-season");
  expect(context.cashPaidThisYear === 8_000_000, "cap tracker cash paid total should feed the trade context");
  expect(context.cashReceivedThisYear === 1_000_000, "cap tracker cash received total should feed the trade context");

  const result = evaluateTradeMachine({
    season,
    sides: [
      side(context, [cash("context-cash-out", 1_000_000)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "team-season cash paid totals should count against the annual cash limit");
  expect(result.teams[0].checks.some((check) => check.code === "CASHCTX:cash-limit" && check.status === "fail"), "cash limit should use cap tracker season-to-date totals");
  return "cap tracker cash totals feed trade-machine annual cash accounting";
}

function capTrackerTaxpayerMleSigningFeedsTradeContext(): string {
  const context = tradeTeamContextFromCapTracker(
    capTrackerDataWithTeamSeason(
      teamSeason("TXMLECTX", season.year, 170_000_000),
      [contractRow("Taxpayer MLE signing", "TXMLECTX", season.year, "taxpayer-mid-level-exception")]
    ),
    "TXMLECTX",
    season.year,
    14
  );
  expect(context !== null, "cap tracker team context should be built for the taxpayer-MLE team-season");
  expect(context.usedTaxpayerMidLevelThisYear === true, "current-year taxpayer MLE signing should feed the trade context");

  const oldSigningContext = tradeTeamContextFromCapTracker(
    capTrackerDataWithTeamSeason(
      teamSeason("OLDTXMLE", season.year, 170_000_000),
      [contractRow("Old Taxpayer MLE signing", "OLDTXMLE", season.year - 1, "taxpayer-mid-level-exception")]
    ),
    "OLDTXMLE",
    season.year,
    14
  );
  expect(oldSigningContext?.usedTaxpayerMidLevelThisYear === false, "prior-year taxpayer MLE signings should not create a current-year restriction");

  const result = evaluateTradeMachine({
    season,
    sides: [
      side(context, [player("out", 8_000_000)]),
      side(team("SATSELL", 170_000_000, 14), [
        player("sat-in", 8_000_000, {
          signedAndTraded: true,
          signAndTradeContractYears: 3,
          signAndTradeFirstSeasonProtected: true,
          signAndTradeUsedProhibitedException: false,
          signAndTradeFinishedPriorSeasonWithTeam: true,
          signAndTradeBeforeRegularSeason: true
        })
      ])
    ]
  });
  expect(!result.legal, "cap-tracker taxpayer MLE context should block later row-C sign-and-trade acquisitions");
  expect(result.teams[0].checks.some((check) => check.code === "TXMLECTX:transaction-apron-restriction" && check.status === "fail" && check.detail.includes("Taxpayer MLE")), "transaction restriction should explain the prior Taxpayer MLE conflict");
  return "cap tracker current-year Taxpayer MLE signings feed trade-machine transaction restrictions";
}

function capTrackerFrozenPickRowsFeedTradeContext(): string {
  const pickRows = Array.from({ length: 8 }, (_, index) =>
    capTrackerPickRow("FROZENCTX", season.year + index, 1, index === 4)
  );
  const context = tradeTeamContextFromCapTracker(
    capTrackerDataWithTeamSeason(teamSeason("FROZENCTX", season.year, 170_000_000), [], pickRows),
    "FROZENCTX",
    season.year,
    14
  );
  expect(context !== null, "cap tracker team context should be built for the frozen-pick team-season");
  expect(context.secondApronFrozenFirstYears?.includes(season.year + 4) === true, "cap tracker frozen first rows should feed frozen pick years");
  expect(context.firstRoundPickYears?.length === 8, "cap tracker first-round inventory should still include all modeled firsts");

  const result = evaluateTradeMachine({
    season,
    sides: [
      side(context, [first("frozen-from-context", season.year + 4)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "a cap-tracker frozen first should be blocked even when the team is below the second apron now");
  expect(result.teams[0].checks.some((check) => check.code === "FROZENCTX:second-apron-frozen-pick" && check.status === "fail"), "frozen-pick check should use cap tracker frozen metadata");
  return "cap tracker second-apron frozen pick rows feed trade-machine frozen-year checks";
}

function annualCashLimitIsNotNetted(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side({ ...team("CASH", 170_000_000, 14), cashPaidThisYear: 8_000_000 }, [cash("cash-out", 1_000_000)]),
      side(team("OTHER", 170_000_000, 14), [])
    ]
  });
  expect(!result.legal, "team above annual cash paid limit should fail");
  expect(result.teams[0].checks.some((check) => check.code === "CASH:cash-limit" && check.status === "fail"), "cash limit check should fail");
  return "annual cash paid and received limits are tracked separately and not netted";
}

function aggregationIneligiblePlayerCannotBePackaged(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("AGGNO", 170_000_000, 14), [
        player("not-eligible", 10_000_000, { aggregationEligible: false }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 18_000_000)])
    ]
  });
  expect(!result.legal, "aggregation-ineligible player should not be packaged with another outgoing salary");
  expect(result.teams[0].salaryMatch.exceptionType === "aggregated_standard", "multi-player salary match should still identify aggregation");
  expect(result.teams[0].checks.some((check) => check.code === "AGGNO:aggregation-eligibility" && check.status === "fail"), "aggregation eligibility check should fail");
  return "aggregation-ineligible players cannot be packaged";
}

function aggregationIneligiblePlayerCanBeTradedAlone(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SOLOAGG", 170_000_000, 14), [player("not-eligible", 10_000_000, { aggregationEligible: false })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 10_000_000)])
    ]
  });
  expect(result.legal, "aggregation-ineligible player should remain tradable alone");
  expect(result.teams[0].salaryMatch.exceptionType === "standard", "single-player trade should use non-aggregated standard matching");
  expect(result.teams[0].checks.some((check) => check.code === "SOLOAGG:aggregation-eligibility" && check.status === "pass"), "aggregation eligibility check should pass without aggregation");
  return "aggregation-ineligible players can be traded alone";
}

function secondApronAggregationCountsIneligiblePositiveSalaryPlayers(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("SECONDINEL", 225_000_000, 15), [
        player("not-eligible", 12_000_000, { aggregationEligible: false }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 20_000_000)])
    ]
  });
  expect(!result.legal, "second-apron aggregation should fail even when one outgoing player is independently aggregation-ineligible");
  expect(result.teams[0].checks.some((check) => check.code === "SECONDINEL:second-apron-aggregation" && check.status === "fail"), "second-apron aggregation check should count all positive outgoing trade salaries");
  expect(result.teams[0].checks.some((check) => check.code === "SECONDINEL:aggregation-eligibility" && check.status === "fail"), "aggregation eligibility check should also fail the ineligible player");
  return "second-apron aggregation counts ineligible positive-salary players";
}

function recentlyAcquiredByExceptionPlayerCannotBeAggregated(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("AGG", 170_000_000, 14), [
        player("recent", 10_000_000, { acquiredViaExceptionDate: "2026-12-01" }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 18_000_000)])
    ]
  });
  expect(!result.legal, "recently acquired by exception player should not aggregate inside two months");
  expect(result.teams[0].checks.some((check) => check.code === "AGG:recent-trade-aggregation" && check.status === "fail"), "recent trade aggregation should fail");
  return "recently acquired-by-exception players cannot be aggregated for two months";
}

function recentlyAcquiredByTradePlayerCannotBeAggregated(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("TRADE", 170_000_000, 14), [
        player("recent-trade", 10_000_000, { acquiredByTradeDate: "2027-01-01", acquiredByTradeSource: "prior trade" }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 18_000_000)])
    ]
  });
  expect(!result.legal, "recently acquired by trade player should not be aggregated inside two months");
  expect(result.teams[0].checks.some((check) => check.code === "TRADE:recent-trade-aggregation" && check.status === "fail"), "recent trade aggregation should fail for trade-acquired player");
  return "recently acquired-by-trade players cannot be aggregated for two months";
}

function recentlyAcquiredPlayerCanBeTradedAlone(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-05",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("SOLO", 170_000_000, 14), [player("recent-alone", 10_000_000, { acquiredByTradeDate: "2027-01-01" })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 10_000_000)])
    ]
  });
  expect(result.legal, "recently acquired player should be tradable alone if not aggregated");
  expect(result.teams[0].checks.some((check) => check.code === "SOLO:recent-trade-aggregation" && check.status === "pass"), "recent trade aggregation check should pass without aggregation");
  return "recently acquired players can be traded alone without aggregation";
}

function dec16AcquisitionAggregationRestrictionReleasesNearDeadline(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-04",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("REL", 170_000_000, 14), [
        player("dec16", 10_000_000, { acquiredByTradeDate: "2026-12-16" }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 18_000_000)])
    ]
  });
  expect(result.legal, "Dec. 16-or-earlier acquisition should be aggregatable on the day before the deadline");
  expect(result.teams[0].checks.some((check) => check.code === "REL:recent-trade-aggregation" && check.status === "pass"), "deadline release should pass recent trade aggregation");
  return "Dec. 16-or-earlier trade acquisitions can aggregate on the day before the deadline";
}

function unknownRecentTradeAcquisitionWarnsWhenAggregated(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    sides: [
      side(team("UNK", 170_000_000, 14), [
        player("unknown-acquired", 10_000_000, { acquiredByTradeDateUnknown: true, acquiredByTradeSource: "TPE" }),
        player("other", 8_000_000)
      ]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 18_000_000)])
    ]
  });
  expect(result.legal, "unknown recent trade acquisition date should warn rather than hard-fail");
  expect(result.status === "warning", "unknown acquisition date should put the result in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "UNK:recent-trade-aggregation" && check.status === "warn"), "recent trade aggregation should warn when acquisition date is unknown");
  return "unknown recent trade acquisition dates warn when the player is aggregated";
}

function minimumSalaryAggregationRestrictionBlocksThreeForOne(): string {
  const result = evaluateTradeMachine({
    season,
    isDec15ToTradeDeadlineWindow: false,
    sides: [
      side(team("MIN", 170_000_000, 15), [
        player("min-a", 2_000_000, { isMinimumSalary: true }),
        player("min-b", 2_000_000, { isMinimumSalary: true }),
        player("salary", 14_000_000)
      ]),
      side(team("SELL", 170_000_000, 13), [player("incoming", 18_000_000)])
    ]
  });
  expect(!result.legal, "3-for-fewer with multiple minimum players outside the trade window should fail");
  expect(result.teams[0].checks.some((check) => check.code === "MIN:minimum-aggregation" && check.status === "fail"), "minimum aggregation check should fail");
  return "minimum-salary aggregation restriction blocks 3-for-fewer trades outside the Dec. 15-to-deadline window";
}

function dateRestrictedPlayerCannotBeTradedTooEarly(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2026-12-20",
    sides: [
      side(team("DATE", 170_000_000, 14), [player("new-signing", 8_000_000, { tradeRestrictionUntil: "2027-01-15" })]),
      side(team("SELL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "date-restricted player should fail before restriction date");
  expect(result.teams[0].checks.some((check) => check.code === "DATE:trade-date-restriction" && check.status === "fail"), "trade-date restriction check should fail");
  return "post-signing trade-date restrictions block early trades";
}

function postDeadlineFinalContractSeasonCannotBeTraded(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-06",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("EXP", 170_000_000, 14), [player("expiring", 8_000_000, { couldBeLastContractSeason: true, lastContractSeasonReason: "last contract season" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "expiring player should not be tradable after the trade deadline");
  expect(result.teams[0].checks.some((check) => check.code === "EXP:trade-deadline-contract" && check.status === "fail"), "trade-deadline contract check should fail after deadline");
  return "players in a final contract season cannot be traded after the trade deadline";
}

function deadlineContractRestrictionWarnsWhenCalendarIsIncomplete(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-06",
    sides: [
      side(team("EXP?", 170_000_000, 14), [player("expiring", 8_000_000, { couldBeLastContractSeason: true })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "missing trade deadline should warn rather than hard-fail");
  expect(result.status === "warning", "missing deadline date should put the trade in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "EXP?:trade-deadline-contract" && check.status === "warn"), "trade-deadline contract check should warn when calendar is incomplete");
  return "post-deadline contract restriction warns when the trade calendar is incomplete";
}

function preDeadlineOptionSeasonClearsDeadlineRestriction(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-02-05",
    tradeDeadlineDate: "2027-02-05",
    sides: [
      side(team("OPT", 170_000_000, 14), [player("option-next", 8_000_000, { couldBeLastContractSeason: true, lastContractSeasonReason: "2027-28 player option could make this the last season" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "option-season player should be tradable on or before the modeled deadline");
  expect(result.teams[0].checks.some((check) => check.code === "OPT:trade-deadline-contract" && check.status === "pass"), "trade-deadline contract check should pass before or on deadline");
  return "final-season and option-season contract restrictions clear before the trade deadline";
}

function draftRookieSigningMoratoriumRunsThirtyDays(): string {
  const blocked = evaluateTradeMachine({
    season,
    tradeDate: "2026-07-25",
    sides: [
      side(team("ROOK", 170_000_000, 14), [player("rookie", 8_000_000, { signingTradeRestrictionType: "draft_rookie_or_two_way", signingTradeRestrictionSignedDate: "2026-07-01" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!blocked.legal, "draft rookie should be blocked before 30 days after signing");
  expect(blocked.teams[0].checks.some((check) => check.code === "ROOK:signing-moratorium" && check.status === "fail"), "rookie signing moratorium should fail before day 30");

  const cleared = evaluateTradeMachine({
    season,
    tradeDate: "2026-07-31",
    sides: [
      side(team("ROOK", 170_000_000, 14), [player("rookie", 8_000_000, { signingTradeRestrictionType: "draft_rookie_or_two_way", signingTradeRestrictionSignedDate: "2026-07-01" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(cleared.legal, "draft rookie should clear on the 30-day restriction date");
  return "draft rookie and Two-Way signing moratorium runs 30 days";
}

function freeAgentSigningMoratoriumUsesLaterOfThreeMonthsOrDec15(): string {
  const dec15Path = evaluateTradeMachine({
    season,
    tradeDate: "2026-12-10",
    sides: [
      side(team("FA", 170_000_000, 14), [player("summer-fa", 8_000_000, { signingTradeRestrictionType: "free_agent", signingTradeRestrictionSignedDate: "2026-07-10" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!dec15Path.legal, "summer free agent should be blocked until Dec. 15 when three months is earlier");

  const threeMonthPath = evaluateTradeMachine({
    season,
    tradeDate: "2026-12-20",
    sides: [
      side(team("FA", 170_000_000, 14), [player("late-fa", 8_000_000, { signingTradeRestrictionType: "free_agent", signingTradeRestrictionSignedDate: "2026-09-25" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!threeMonthPath.legal, "late free agent should be blocked until three months after signing when that is later than Dec. 15");

  const cleared = evaluateTradeMachine({
    season,
    tradeDate: "2026-12-25",
    sides: [
      side(team("FA", 170_000_000, 14), [player("late-fa", 8_000_000, { signingTradeRestrictionType: "free_agent", signingTradeRestrictionSignedDate: "2026-09-25" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(cleared.legal, "free agent should clear once the later of three months or Dec. 15 arrives");
  return "free-agent signing moratorium uses the later of three months or Dec. 15";
}

function birdRaiseSigningMoratoriumUsesLaterOfThreeMonthsOrJan15(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-14",
    sides: [
      side(team("BIRD", 170_000_000, 14), [player("bird-raise", 8_000_000, { signingTradeRestrictionType: "bird_raise", signingTradeRestrictionSignedDate: "2026-08-01" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "Bird-rights raise signing restriction should block before Jan. 15 when Jan. 15 is later");
  expect(result.teams[0].checks.some((check) => check.code === "BIRD:signing-moratorium" && check.status === "fail"), "Bird raise signing moratorium should fail");

  const cleared = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-15",
    sides: [
      side(team("BIRD", 170_000_000, 14), [player("bird-raise", 8_000_000, { signingTradeRestrictionType: "bird_raise", signingTradeRestrictionSignedDate: "2026-08-01" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(cleared.legal, "Bird-rights raise signing restriction should clear on Jan. 15");
  return "Bird-rights signing moratorium uses the later of three months or Jan. 15";
}

function missingSigningMoratoriumDateWarns(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2026-12-20",
    sides: [
      side(team("DATE?", 170_000_000, 14), [player("unknown-sign-date", 8_000_000, { signingTradeRestrictionType: "free_agent" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(result.legal, "missing signing date should warn rather than hard-fail");
  expect(result.status === "warning", "missing signing date should put the result in warning status");
  expect(result.teams[0].checks.some((check) => check.code === "DATE?:signing-moratorium" && check.status === "warn"), "signing moratorium check should warn when signing date is missing");
  return "incomplete signing-moratorium dates warn instead of silently passing";
}

function unwaivedNoTradeConsentBlocksTrade(): string {
  const result = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-20",
    sides: [
      side(team("VETO", 170_000_000, 14), [player("implicit-veto", 8_000_000, { noTradeConsentRequired: true })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!result.legal, "unwaived no-trade consent should block the trade");
  expect(result.teams[0].checks.some((check) => check.code === "VETO:no-trade-consent" && check.status === "fail"), "no-trade consent check should fail for unwaived consent right");
  return "unwaived no-trade consent blocks trades until consent is granted";
}

function timeLimitedNoTradeConsentExpiresByTradeDate(): string {
  const beforeExpiry = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-01",
    sides: [
      side(team("CONSENT", 170_000_000, 14), [player("veto", 8_000_000, { noTradeConsentRequired: true, noTradeConsentUntil: "2027-07-06" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!beforeExpiry.legal, "time-limited no-trade consent should block before expiry");
  expect(beforeExpiry.teams[0].checks.some((check) => check.code === "CONSENT:no-trade-consent" && check.status === "fail"), "no-trade consent check should fail before expiry");

  const afterExpiry = evaluateTradeMachine({
    season,
    tradeDate: "2027-07-07",
    sides: [
      side(team("CONSENT", 170_000_000, 14), [player("veto", 8_000_000, { noTradeConsentRequired: true, noTradeConsentUntil: "2027-07-06" })]),
      side(team("OTHER", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(afterExpiry.legal, "time-limited no-trade consent should clear after expiry");
  return "time-limited no-trade consent expires by trade date";
}

function destinationSpecificRestrictionOnlyBlocksMatchingTeam(): string {
  const restrictedPlayer = player("restricted", 8_000_000, {
    tradeRestrictionUntil: "2027-07-06",
    tradeRestrictionDestinationTeam: "DAL"
  });
  const toRestrictedDestination = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-01",
    sides: [
      side(team("POR", 170_000_000, 14), [restrictedPlayer]),
      side(team("DAL", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(!toRestrictedDestination.legal, "destination-specific restriction should block matching destination before expiry");
  expect(toRestrictedDestination.teams[0].checks.some((check) => check.code === "POR:trade-date-restriction" && check.status === "fail"), "destination restriction should fail for DAL");

  const toOtherDestination = evaluateTradeMachine({
    season,
    tradeDate: "2027-01-01",
    sides: [
      side(team("POR", 170_000_000, 14), [restrictedPlayer]),
      side(team("BOS", 170_000_000, 14), [player("incoming", 8_000_000)])
    ]
  });
  expect(toOtherDestination.legal, "destination-specific restriction should not block unrelated destination");
  return "destination-specific trade restrictions only block the matching destination";
}

function unusedOutgoingSalaryCreatesModeledTpe(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("TPE", 170_000_000, 14), [player("out", 20_000_000)]),
      side(team("ROOM", 140_000_000, 14), [player("in", 8_000_000)])
    ]
  });
  expect(result.legal, "salary-down trade should be legal");
  expect(result.teams[0].salaryMatch.tradeExceptionCreated === 12_000_000, "unused outgoing matching salary should create modeled TPE amount");
  return "unused outgoing salary is exposed as a modeled traded-player exception balance";
}

function payableTradeBonusCountsAsIncomingSalary(): string {
  const result = evaluateTradeMachine({
    season,
    sides: [
      side(team("BUY", 170_000_000, 14), [player("out", 10_000_000)]),
      side(team("SELL", 170_000_000, 14), [
        player("bonus-in", 18_500_000, {
          tradeBonus: { percent: 0.15, remainingBaseCompensation: 20_000_000, yoe: 5 }
        })
      ])
    ]
  });
  expect(!result.legal, "payable trade bonus should count in incoming salary and can break matching");
  expect(result.teams[0].salaryMatch.incomingSalary === 21_500_000, "incoming salary should include the 3M payable trade bonus");
  expect(result.teams[0].checks.some((check) => check.code === "BUY:salary-match" && check.status === "fail"), "salary matching should fail after adding bonus salary");
  return "payable trade bonuses count as incoming salary in salary matching";
}

function maxSalaryRuleReducesTradeBonus(): string {
  const asset = player("maxed", 40_000_000, {
    tradeBonus: { percent: 0.15, remainingBaseCompensation: 20_000_000, yoe: 5 }
  });
  expect(tradeBonusAmount(asset, season) === 1_500_000, "trade bonus should be reduced so salary plus bonus stays at the applicable max salary");
  return "max-salary rule reduces an otherwise payable trade bonus";
}

function lesserOfTradeBonusUsesSmallerPercentOrDollarCap(): string {
  const percentWins = player("percent-wins", 20_000_000, {
    tradeBonus: { percent: 0.07, amount: 7_000_000, remainingBaseCompensation: 50_000_000 }
  });
  const dollarCapWins = player("dollar-wins", 20_000_000, {
    tradeBonus: { percent: 0.07, amount: 7_000_000, remainingBaseCompensation: 200_000_000 }
  });
  expect(tradeBonusAmount(percentWins, season) === 3_500_000, "lesser-of bonus should use percent amount when it is below the dollar cap");
  expect(tradeBonusAmount(dollarCapWins, season) === 7_000_000, "lesser-of bonus should use dollar cap when percent amount is higher");
  return "lesser-of trade bonuses use the smaller percent or dollar cap";
}

function waivedPaidAndSignAndTradeBonusesDoNotTrigger(): string {
  expect(tradeBonusAmount(player("waived", 12_000_000, { tradeBonus: { percent: 0.15, remainingBaseCompensation: 12_000_000, waived: true } }), season) === 0, "waived trade bonus should not be payable");
  expect(tradeBonusAmount(player("paid", 12_000_000, { tradeBonus: { percent: 0.15, remainingBaseCompensation: 12_000_000, previouslyEarned: true } }), season) === 0, "previously paid trade bonus should not be payable again");
  expect(tradeBonusAmount(player("sat", 12_000_000, { signedAndTraded: true, tradeBonus: { percent: 0.15, remainingBaseCompensation: 12_000_000 } }), season) === 0, "initial sign-and-trade assignment should not trigger a trade bonus");
  return "waived, already-paid, and initial S&T trade bonuses do not trigger";
}

const season: CapTrackerSeason = {
  year: 2027,
  label: "2026-27",
  salary_cap: 166_000_000,
  tax_level: 201_690_000,
  first_apron: 210_321_000,
  second_apron: 222_775_000,
  salary_floor: 149_400_000,
  minimum_roster_charge: 1_378_978,
  source: "test",
  source_quality: "contract"
};

const transitionSeason: CapTrackerSeason = {
  year: 2024,
  label: "2023-24",
  salary_cap: 136_021_000,
  tax_level: 165_294_000,
  first_apron: 172_346_000,
  second_apron: 182_794_000,
  salary_floor: 122_418_900,
  minimum_roster_charge: 1_119_563,
  source: "test",
  source_quality: "contract"
};

function team(teamName: string, teamSalary: number, rosterCount: number, firstRoundPickYears?: number[], contextSeason = season): TradeMachineTeamContext {
  return {
    team: teamName,
    seasonYear: contextSeason.year,
    teamSalary,
    rosterCount,
    firstRoundPickYears
  };
}

function side(context: TradeMachineTeamContext, sends: TradeMachineAsset[]): TradeMachineSide {
  return { team: context, sends };
}

function capTrackerDataWithTeamSeason(teamSeasonRow: CapTrackerTeamSeason, contracts: CapTrackerContractRow[] = [], picks: CapTrackerPick[] = []): CapTrackerData {
  return {
    generated_at: "test",
    source_policy: "test",
    notes: [],
    source_audit: [],
    seasons: [season],
    teams: [],
    team_seasons: [teamSeasonRow],
    contracts,
    exceptions: [],
    hard_caps: [],
    picks,
    dead_money: [],
    max_contracts: []
  };
}

function capTrackerPickRow(teamName: string, year: number, round: number, secondApronFrozen = false): CapTrackerPick {
  return {
    id: `pick-${teamName}-${year}-${round}`,
    team: teamName,
    year,
    round,
    label: `${year} round ${round}`,
    protection: null,
    second_apron_frozen: secondApronFrozen,
    source: "test",
    source_quality: "override"
  };
}

function contractRow(playerName: string, teamName: string, firstYear: number, signedUsing: string): CapTrackerContractRow {
  return {
    id: `contract-${teamName}-${playerName}`,
    player_name: playerName,
    team: teamName,
    row_type: "player",
    display_order: 1,
    signed_using: signedUsing,
    source: "test",
    source_quality: "contract",
    cells: [
      {
        year: firstYear,
        amount: 5_000_000,
        kind: "guaranteed",
        status: "active",
        source: "contract"
      },
      {
        year: firstYear + 1,
        amount: 5_000_000,
        kind: "guaranteed",
        status: "active",
        source: "contract"
      }
    ]
  };
}

function teamSeason(teamName: string, year: number, teamSalary: number): CapTrackerTeamSeason {
  return {
    team: teamName,
    year,
    guaranteed_salary: teamSalary,
    option_salary: 0,
    non_guaranteed_salary: 0,
    salary_on_books: teamSalary,
    draft_pick_charges: 0,
    active_salary: teamSalary,
    dead_money: 0,
    cap_holds: 0,
    roster_charges_with_holds: 0,
    roster_charges_renounced: 0,
    apron_salary: teamSalary,
    team_salary_renounced: teamSalary,
    likely_books_with_holds: teamSalary,
    likely_books_renounced: teamSalary,
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
    roster_count: 14,
    hold_count: 0,
    status_band: "Over Cap",
    source_quality: "contract"
  };
}

function player(id: string, salary: number, extra: Partial<TradeMachineAsset> = {}): TradeMachineAsset {
  return {
    id: `player-${id}`,
    kind: "player",
    label: id,
    salary,
    outgoingSalary: salary,
    aggregationEligible: true,
    ...extra
  };
}

function first(id: string, draftYear: number, extra: Partial<TradeMachineAsset> = {}): TradeMachineAsset {
  return {
    id: `pick-${id}`,
    kind: "pick",
    label: `${draftYear} first`,
    round: 1,
    draftYear,
    tradeValue: 25_000_000,
    ...extra
  };
}

function cash(id: string, amount: number): TradeMachineAsset {
  return {
    id: `cash-${id}`,
    kind: "cash",
    label: "Cash",
    cashAmount: amount,
    tradeValue: amount
  };
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
