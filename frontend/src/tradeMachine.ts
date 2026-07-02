import type { CapTrackerContractRow, CapTrackerData, CapTrackerException, CapTrackerHardCap, CapTrackerPick, CapTrackerSeason, CapTrackerTeamSeason, PickAsset, PlayerImpact } from "./types";

export type TradeMachineRuleStatus = "pass" | "fail" | "warn";
export type TradeMachineStatus = "legal" | "illegal" | "warning";
export type TradeMachineAssetKind = "player" | "pick" | "cash";
export type TradeMachineApronBand = "cap_room" | "over_cap" | "tax" | "first_apron" | "second_apron";
export type SigningTradeRestrictionType = "draft_rookie_or_two_way" | "free_agent" | "bird_raise";
export type TradeMachineValueVerdict = "accepted" | "maybe" | "declined";
export type TradeMachineAvailableExceptionKind = "traded_player" | "non_taxpayer_mle" | "bi_annual" | "room_mle" | "taxpayer_mle" | "disabled_player" | "unknown";

export const TRADE_MACHINE_VALUE_ACCEPTED_DIFF = 10_000_000;
export const TRADE_MACHINE_VALUE_MAYBE_DIFF = 20_000_000;

export type BaseYearCompensationInput = {
  applies: boolean;
  previousSalary?: number | null;
  newSalary?: number | null;
  signedWithOwnTeam?: boolean;
};

export type TradeBonusInput = {
  percent?: number | null;
  amount?: number | null;
  remainingBaseCompensation?: number | null;
  waived?: boolean;
  previouslyEarned?: boolean;
  yoe?: number | null;
  priorYearSalary?: number | null;
  maxSalaryPercent?: number | null;
  unlikelyBonuses?: number | null;
};

export type TradeMachineTimingInput = {
  isDec15ToTradeDeadlineWindow?: boolean;
  isJan8ToRegularSeasonEndWindow?: boolean;
  isPostRegularSeasonToJune30Window?: boolean;
};

export type TradeMachineAvailableException = {
  name: string;
  amount: number;
  kind?: TradeMachineAvailableExceptionKind | null;
  expires?: string | null;
  firstApronRestrictionStarts?: string | null;
  signedAndTradedContract?: boolean | null;
  sourceQuality?: string | null;
};

export type TradeMachineAsset = {
  id: string;
  kind: TradeMachineAssetKind;
  label: string;
  team?: string | null;
  toTeam?: string | null;
  salary?: number | null;
  outgoingSalary?: number | null;
  currentSeasonGuaranteedSalary?: number | null;
  nextSeasonSalary?: number | null;
  nextSeasonGuaranteedSalary?: number | null;
  contractSeasonsRemaining?: number | null;
  tradeValue?: number | null;
  scaleValue?: number | null;
  cashAmount?: number | null;
  isMinimumSalary?: boolean;
  isTwoWay?: boolean;
  disabledPlayerExceptionUsed?: boolean;
  aggregationEligible?: boolean;
  acquiredViaExceptionDate?: string | null;
  acquiredByTradeDate?: string | null;
  acquiredByTradeDateUnknown?: boolean;
  acquiredByTradeSource?: string | null;
  tradeRestrictionUntil?: string | null;
  tradeRestrictionDestinationTeam?: string | null;
  couldBeLastContractSeason?: boolean;
  lastContractSeasonReason?: string | null;
  signingTradeRestrictionType?: SigningTradeRestrictionType | null;
  signingTradeRestrictionSignedDate?: string | null;
  signingTradeRestrictionUntil?: string | null;
  signingTradeRestrictionReason?: string | null;
  signedAndTraded?: boolean;
  signAndTradeContractYears?: number | null;
  signAndTradeFirstSeasonProtected?: boolean | null;
  signAndTradeUsedProhibitedException?: boolean | null;
  signAndTradeFinishedPriorSeasonWithTeam?: boolean | null;
  signAndTradeBeforeRegularSeason?: boolean | null;
  noTradeConsentRequired?: boolean;
  noTradeConsentGranted?: boolean;
  noTradeConsentUntil?: string | null;
  baseYearCompensation?: BaseYearCompensationInput;
  tradeBonus?: TradeBonusInput;
  assetType?: string | null;
  draftYear?: number | null;
  round?: number | null;
  originTeam?: string | null;
  protection?: string | null;
  protectionCutoff?: number | null;
  possibleConveyYears?: number[] | null;
  conveyProbability?: number | null;
  counterpartyTeam?: string | null;
};

export type TradeMachineTeamContext = {
  team: string;
  seasonYear: number;
  teamSalary: number;
  subsequentYearApronSalary?: number | null;
  rosterCount: number;
  firstRoundPickYears?: number[];
  firstRoundPickInventorySource?: "cap_tracker" | "assumed_full" | "unavailable";
  secondApronFrozenFirstYears?: number[];
  cashPaidThisYear?: number | null;
  cashReceivedThisYear?: number | null;
  availableTradeExceptions?: TradeMachineAvailableException[];
  hardCap?: "first_apron" | "second_apron" | null;
  usedTaxpayerMidLevelThisYear?: boolean | null;
};

export type TradeMachineSide = {
  team: TradeMachineTeamContext;
  sends: TradeMachineAsset[];
};

export type TradeMachineSides = [TradeMachineSide, TradeMachineSide, ...TradeMachineSide[]];
export type TradeMachineTeamResults = [TradeMachineTeamResult, TradeMachineTeamResult, ...TradeMachineTeamResult[]];
export type TradeMachineTeamValueBalances = [TradeMachineTeamValueBalance, TradeMachineTeamValueBalance, ...TradeMachineTeamValueBalance[]];

export type TradeMachineInput = {
  season: CapTrackerSeason;
  sides: TradeMachineSides;
  tradeDate?: string | null;
  tradeDeadlineDate?: string | null;
  regularSeasonEndDate?: string | null;
  isDec15ToTradeDeadlineWindow?: boolean;
  isJan8ToRegularSeasonEndWindow?: boolean;
  isPostRegularSeasonToJune30Window?: boolean;
};

export type TradeMachineRuleCheck = {
  code: string;
  label: string;
  status: TradeMachineRuleStatus;
  detail: string;
};

export type TradeMachineSalaryMatch = {
  incomingSalary: number;
  incomingSalaryForMatching: number;
  minimumSalaryExceptionSalary: number;
  outgoingSalary: number;
  outgoingSalaryForMatching: number;
  maxIncomingSalary: number;
  capRoomAfterOutgoing: number;
  usedCapRoom: boolean;
  rule: string;
  exceptionType: "cap_room" | "standard" | "aggregated_standard" | "expanded" | "existing_tpe" | "transition" | "minimum_salary" | "disabled_player" | "non_taxpayer_mle" | "bi_annual" | "room_mle" | "none";
  tradeExceptionCreated: number;
  existingTradeExceptionName?: string | null;
  existingTradeExceptionExpires?: string | null;
  existingTradeExceptionFirstApronRestrictionStarts?: string | null;
  existingTradeExceptionFirstApronRestrictionApplies?: boolean | null;
  existingTradeExceptionSignedAndTradedContract?: boolean | null;
  disabledPlayerExceptionName?: string | null;
  disabledPlayerExceptionExpires?: string | null;
  disabledPlayerExceptionAmount?: number | null;
  assignmentExceptionName?: string | null;
  assignmentExceptionAmount?: number | null;
  assignmentExceptionKind?: TradeMachineAvailableExceptionKind | null;
};

export type TradeMachineTeamResult = {
  team: string;
  status: TradeMachineStatus;
  beforeSalary: number;
  afterSalary: number;
  subsequentYearApronSalaryAfter?: number | null;
  apronBefore: TradeMachineApronBand;
  apronAfter: TradeMachineApronBand;
  rosterBefore: number;
  rosterAfter: number;
  incoming: TradeMachineAsset[];
  outgoing: TradeMachineAsset[];
  salaryMatch: TradeMachineSalaryMatch;
  checks: TradeMachineRuleCheck[];
};

export type TradeMachineValueBalance = {
  leftTeam: string;
  rightTeam: string;
  leftOutgoingValue: number;
  rightOutgoingValue: number;
  leftOutgoingScaleAdjustedValue: number;
  rightOutgoingScaleAdjustedValue: number;
  valueDiff: number;
  scaleAdjustedDiff: number;
  balanceDiff: number;
  imbalanceBasis: "trade_value" | "scale_adjusted_value";
  verdict: TradeMachineValueVerdict;
  teamSaysNo: string | null;
  acceptedThreshold: number;
  maybeThreshold: number;
};

export type TradeMachineTeamValueBalance = {
  team: string;
  incomingValue: number;
  outgoingValue: number;
  incomingScaleAdjustedValue: number;
  outgoingScaleAdjustedValue: number;
  valueDeficit: number;
  scaleAdjustedDeficit: number;
  balanceDeficit: number;
  imbalanceBasis: "trade_value" | "scale_adjusted_value";
  verdict: TradeMachineValueVerdict;
  teamSaysNo: boolean;
  acceptedThreshold: number;
  maybeThreshold: number;
};

export type TradeMachineResult = {
  status: TradeMachineStatus;
  legal: boolean;
  valueBalance: TradeMachineValueBalance;
  teamValueBalances: TradeMachineTeamValueBalances;
  modelAccepted: boolean;
  modelViable: boolean;
  season: CapTrackerSeason;
  teams: TradeMachineTeamResults;
  checks: TradeMachineRuleCheck[];
};

export function evaluateTradeMachine(input: TradeMachineInput): TradeMachineResult {
  const routedSides = resolveTradeRoutes(input.sides);
  const teamResults = routedSides.map((side) =>
    evaluateTeamSide(side, incomingAssetsForSide(side, routedSides), input.season, input)
  ) as TradeMachineTeamResults;
  const checks = [tradeWindowCheck(input), ...tradeRoutingChecks(input.sides), ...teamResults.flatMap((result) => result.checks)];
  const legal = checks.every((check) => check.status !== "fail");
  const valueBalance = tradeMachineValueBalance(routedSides[0], routedSides[1]);
  const teamValueBalances = tradeMachineTeamValueBalances(routedSides);
  const valueAccepted = routedSides.length === 2
    ? valueBalance.verdict === "accepted"
    : teamValueBalances.every((balance) => balance.verdict === "accepted");
  const valueViable = routedSides.length === 2
    ? valueBalance.verdict !== "declined"
    : teamValueBalances.every((balance) => balance.verdict !== "declined");
  return {
    status: statusFromChecks(checks),
    legal,
    valueBalance,
    teamValueBalances,
    modelAccepted: legal && valueAccepted,
    modelViable: legal && valueViable,
    season: input.season,
    teams: teamResults,
    checks
  };
}

export function capTrackerSeasonForYear(capTracker: CapTrackerData | undefined, year: number): CapTrackerSeason | null {
  return capTracker?.seasons.find((season) => Number(season.year) === year) ?? null;
}

export function capTrackerTeamForYear(capTracker: CapTrackerData | undefined, team: string, year: number): CapTrackerTeamSeason | null {
  const cleanTeam = normalizeTeam(team);
  return capTracker?.team_seasons.find((row) => normalizeTeam(row.team) === cleanTeam && Number(row.year) === year) ?? null;
}

export function capTrackerTradeExceptions(rows: CapTrackerException[], team: string, year: number): TradeMachineAvailableException[] {
  return capTrackerAvailableExceptions(rows, team, year).filter(isAvailableTradedPlayerException);
}

export function capTrackerAvailableExceptions(rows: CapTrackerException[], team: string, year: number): TradeMachineAvailableException[] {
  const cleanTeam = normalizeTeam(team);
  return rows
    .filter((row) => normalizeTeam(row.team) === cleanTeam && Number(row.year) === year && modeledExceptionKind(row) !== null)
    .map((row) => ({
      name: row.name,
      amount: money(row.amount),
      kind: modeledExceptionKind(row),
      expires: row.expires,
      firstApronRestrictionStarts: row.first_apron_restriction_starts ?? null,
      signedAndTradedContract: row.signed_and_traded_contract ?? null,
      sourceQuality: row.source_quality ?? null
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function capTrackerHardCap(rows: CapTrackerHardCap[] | undefined, team: string, year: number): TradeMachineTeamContext["hardCap"] {
  const cleanTeam = normalizeTeam(team);
  const activeRows = (rows ?? []).filter((row) => normalizeTeam(row.team) === cleanTeam && Number(row.year) === year && isModeledHardCap(row.hard_cap));
  if (activeRows.some((row) => row.hard_cap === "second_apron")) return "second_apron";
  if (activeRows.some((row) => row.hard_cap === "first_apron")) return "first_apron";
  return null;
}

export function tradeTeamContextFromCapTracker(
  capTracker: CapTrackerData | undefined,
  team: string,
  year: number,
  fallbackRosterCount = 0
): TradeMachineTeamContext | null {
  const row = capTrackerTeamForYear(capTracker, team, year);
  if (!row) return null;
  const subsequentRow = capTrackerTeamForYear(capTracker, team, year + 1);
  const allPickRows = capTracker?.picks ?? [];
  const ownedFirsts = allPickRows
    .filter((pick) => normalizeTeam(pick.team) === normalizeTeam(team) && pick.round === 1 && Number.isFinite(pick.year))
    .map((pick) => Number(pick.year));
  const pickInventorySource = allPickRows.length > 0 ? "cap_tracker" : "assumed_full";
  return {
    team,
    seasonYear: year,
    teamSalary: tradeMachineTeamSalary(row),
    subsequentYearApronSalary: subsequentRow ? tradeMachineTeamSalary(subsequentRow) : null,
    rosterCount: Number.isFinite(row.roster_count) ? row.roster_count : fallbackRosterCount,
    firstRoundPickYears: pickInventorySource === "cap_tracker" ? ownedFirsts : futureFirstRoundPickYears(year),
    firstRoundPickInventorySource: pickInventorySource,
    secondApronFrozenFirstYears: capTrackerSecondApronFrozenFirstYears(allPickRows, team),
    cashPaidThisYear: capTrackerCashPaidThisYear(row),
    cashReceivedThisYear: capTrackerCashReceivedThisYear(row),
    availableTradeExceptions: capTrackerAvailableExceptions(capTracker?.exceptions ?? [], team, year),
    hardCap: capTrackerHardCap(capTracker?.hard_caps, team, year),
    usedTaxpayerMidLevelThisYear: capTrackerUsedTaxpayerMidLevelThisYear(capTracker?.contracts ?? [], team, year)
  };
}

function capTrackerSecondApronFrozenFirstYears(rows: CapTrackerPick[], team: string): number[] {
  const cleanTeam = normalizeTeam(team);
  return Array.from(new Set(rows
    .filter((pick) => normalizeTeam(pick.team) === cleanTeam && pick.round === 1 && pick.second_apron_frozen && Number.isFinite(pick.year))
    .map((pick) => Number(pick.year))))
    .sort((a, b) => a - b);
}

function capTrackerCashPaidThisYear(row: CapTrackerTeamSeason): number | null {
  return finiteNumber(row.cash_paid_this_year) ?? finiteNumber(row.cashPaidThisYear);
}

function capTrackerCashReceivedThisYear(row: CapTrackerTeamSeason): number | null {
  return finiteNumber(row.cash_received_this_year) ?? finiteNumber(row.cashReceivedThisYear);
}

function capTrackerUsedTaxpayerMidLevelThisYear(rows: CapTrackerContractRow[], team: string, year: number): boolean {
  const cleanTeam = normalizeTeam(team);
  return rows.some((row) =>
    row.row_type === "player" &&
    normalizeTeam(row.team) === cleanTeam &&
    contractSignedUsingTaxpayerMidLevel(row.signed_using) &&
    firstActiveContractYear(row) === year
  );
}

function contractSignedUsingTaxpayerMidLevel(value: string | null | undefined): boolean {
  const clean = String(value ?? "").toLowerCase();
  if (/non[-_\s]?taxpayer/.test(clean)) return false;
  return /taxpayer/.test(clean) && (/\bmle\b/.test(clean) || /mid[-_\s]?level/.test(clean));
}

function firstActiveContractYear(row: CapTrackerContractRow): number | null {
  const years = row.cells
    .filter((cell) => cell.amount > 0 && cell.kind !== "empty" && cell.kind !== "dead" && cell.kind !== "cap_hold")
    .map((cell) => Number(cell.year))
    .filter((year) => Number.isFinite(year));
  return years.length > 0 ? Math.min(...years) : null;
}

export function playerTradeMachineAsset(player: PlayerImpact, team: string, scaleValue?: number | null): TradeMachineAsset {
  const salary = tradeSalaryForPlayer(player);
  return {
    id: `player-${player.nba_id}`,
    kind: "player",
    label: player.player_name,
    team,
    salary,
    outgoingSalary: salary,
    tradeValue: finiteNumber(player.trade_value) ?? finiteNumber(player.value) ?? 0,
    scaleValue: scaleValue ?? finiteNumber(player.scalability) ?? null,
    aggregationEligible: true
  };
}

export function pickTradeMachineAsset(pick: PickAsset, team: string): TradeMachineAsset {
  return {
    id: `pick-${pick.asset_id}`,
    kind: "pick",
    label: pick.label,
    team,
    tradeValue: finiteNumber(pick.value) ?? 0,
    scaleValue: finiteNumber(pick.normalized) ?? null,
    assetType: pick.asset_type,
    draftYear: finiteNumber(pick.draft_year),
    round: finiteNumber(pick.round),
    originTeam: pick.origin_team ?? team,
    protection: pick.protection,
    protectionCutoff: finiteNumber(pick.protection_cutoff),
    possibleConveyYears: possibleConveyYearsForPick(finiteNumber(pick.draft_year) ?? Number.NaN, pick.protection),
    conveyProbability: finiteNumber(pick.convey_probability),
    counterpartyTeam: pick.counterparty_team
  };
}

export function tradeMachineTeamSalary(row: CapTrackerTeamSeason): number {
  return finiteNumber(row.apron_salary)
    ?? finiteNumber(row.team_salary_renounced)
    ?? finiteNumber(row.active_salary + row.dead_money)
    ?? 0;
}

export function tradeSalaryForPlayer(player: PlayerImpact): number {
  return finiteNumber(player.contract)
    ?? finiteNumber(player.projection_effective_contract_y1)
    ?? finiteNumber(player.projection_contract_y1)
    ?? finiteNumber(player.guaranteed_salary)
    ?? 0;
}

function tradeMachineValueBalance(left: TradeMachineSide, right: TradeMachineSide): TradeMachineValueBalance {
  const leftOutgoingValue = assetValueTotal(left.sends);
  const rightOutgoingValue = assetValueTotal(right.sends);
  const leftOutgoingScaleAdjustedValue = assetScaleAdjustedValueTotal(left.sends);
  const rightOutgoingScaleAdjustedValue = assetScaleAdjustedValueTotal(right.sends);
  const valueDiff = Math.abs(leftOutgoingValue - rightOutgoingValue);
  const scaleAdjustedDiff = Math.abs(leftOutgoingScaleAdjustedValue - rightOutgoingScaleAdjustedValue);
  const balanceDiff = Math.max(valueDiff, scaleAdjustedDiff);
  const imbalanceBasis = scaleAdjustedDiff > valueDiff ? "scale_adjusted_value" : "trade_value";
  const leftTotalForNo = imbalanceBasis === "scale_adjusted_value" ? leftOutgoingScaleAdjustedValue : leftOutgoingValue;
  const rightTotalForNo = imbalanceBasis === "scale_adjusted_value" ? rightOutgoingScaleAdjustedValue : rightOutgoingValue;
  return {
    leftTeam: left.team.team,
    rightTeam: right.team.team,
    leftOutgoingValue,
    rightOutgoingValue,
    leftOutgoingScaleAdjustedValue,
    rightOutgoingScaleAdjustedValue,
    valueDiff,
    scaleAdjustedDiff,
    balanceDiff,
    imbalanceBasis,
    verdict: valueVerdict(balanceDiff),
    teamSaysNo: balanceDiff <= TRADE_MACHINE_VALUE_ACCEPTED_DIFF ? null : leftTotalForNo > rightTotalForNo ? left.team.team : right.team.team,
    acceptedThreshold: TRADE_MACHINE_VALUE_ACCEPTED_DIFF,
    maybeThreshold: TRADE_MACHINE_VALUE_MAYBE_DIFF
  };
}

function assetValueTotal(assets: TradeMachineAsset[]): number {
  return sum(assets.map(assetValue));
}

function assetScaleAdjustedValueTotal(assets: TradeMachineAsset[]): number {
  return sum(assets.map(assetScaleAdjustedValue));
}

function assetValue(asset: TradeMachineAsset): number {
  return money(asset.tradeValue);
}

function assetScaleAdjustedValue(asset: TradeMachineAsset): number {
  const value = assetValue(asset);
  if (asset.kind !== "player") return value;
  const scale = finiteNumber(asset.scaleValue);
  if (scale === null) return value;
  const premium = clamp((scale - 1) / 5, -0.2, 0.35);
  return value * (1 + premium);
}

function valueVerdict(diff: number): TradeMachineValueVerdict {
  if (diff <= TRADE_MACHINE_VALUE_ACCEPTED_DIFF) return "accepted";
  if (diff <= TRADE_MACHINE_VALUE_MAYBE_DIFF) return "maybe";
  return "declined";
}

function tradeMachineTeamValueBalances(sides: TradeMachineSides): TradeMachineTeamValueBalances {
  return sides.map((side) => {
    const incoming = incomingAssetsForSide(side, sides);
    const outgoingValue = assetValueTotal(side.sends);
    const incomingValue = assetValueTotal(incoming);
    const outgoingScaleAdjustedValue = assetScaleAdjustedValueTotal(side.sends);
    const incomingScaleAdjustedValue = assetScaleAdjustedValueTotal(incoming);
    const valueDeficit = Math.max(0, outgoingValue - incomingValue);
    const scaleAdjustedDeficit = Math.max(0, outgoingScaleAdjustedValue - incomingScaleAdjustedValue);
    const balanceDeficit = Math.max(valueDeficit, scaleAdjustedDeficit);
    const imbalanceBasis = scaleAdjustedDeficit > valueDeficit ? "scale_adjusted_value" : "trade_value";
    return {
      team: side.team.team,
      incomingValue,
      outgoingValue,
      incomingScaleAdjustedValue,
      outgoingScaleAdjustedValue,
      valueDeficit,
      scaleAdjustedDeficit,
      balanceDeficit,
      imbalanceBasis,
      verdict: valueVerdict(balanceDeficit),
      teamSaysNo: balanceDeficit > TRADE_MACHINE_VALUE_ACCEPTED_DIFF,
      acceptedThreshold: TRADE_MACHINE_VALUE_ACCEPTED_DIFF,
      maybeThreshold: TRADE_MACHINE_VALUE_MAYBE_DIFF
    };
  }) as TradeMachineTeamValueBalances;
}

export function outgoingSalaryForMatching(asset: TradeMachineAsset, season?: CapTrackerSeason, timing: TradeMachineTimingInput = {}): number {
  if (asset.kind !== "player") return 0;
  const salary = salaryProtectionAdjustedOutgoingSalary(asset, season, timing);
  if (asset.baseYearCompensation?.applies) {
    return baseYearCompensationOutgoingSalary(asset.baseYearCompensation, salary);
  }
  const explicitOutgoing = finiteNumber(asset.outgoingSalary);
  return money(explicitOutgoing !== null ? Math.min(explicitOutgoing, salary) : salary);
}

export function tradeBonusAmount(asset: TradeMachineAsset, season: CapTrackerSeason): number {
  if (asset.kind !== "player" || !asset.tradeBonus) return 0;
  const bonus = asset.tradeBonus;
  if (bonus.waived || bonus.previouslyEarned) return 0;
  if (asset.signedAndTraded) return 0;
  const gross = grossTradeBonusAmount(asset);
  if (gross <= 0) return 0;
  const salary = money(asset.salary);
  const maxSalaryRoom = maxSalaryWithTradeBonus(asset, season) - salary - money(bonus.unlikelyBonuses);
  if (Number.isFinite(maxSalaryRoom)) return Math.round(Math.max(0, Math.min(gross, maxSalaryRoom)));
  return Math.round(gross);
}

export function tradeSalaryForAsset(asset: TradeMachineAsset, season?: CapTrackerSeason): number {
  if (asset.kind === "player" && asset.isTwoWay) return 0;
  const salary = money(asset.salary);
  return season ? salary + tradeBonusAmount(asset, season) : salary;
}

function minimumSalaryExceptionEligibleForIncoming(asset: TradeMachineAsset): boolean {
  if (asset.kind !== "player" || !asset.isMinimumSalary) return false;
  if (asset.tradeBonus) return false;
  const term = finiteNumber(asset.contractSeasonsRemaining);
  if (term !== null && term > 2) return false;
  return tradeSalaryForAsset(asset) > 0;
}

export function salaryProtectionAdjustedOutgoingSalary(asset: TradeMachineAsset, season?: CapTrackerSeason, timing: TradeMachineTimingInput = {}): number {
  const salary = tradeSalaryForAsset(asset, season);
  if (asset.isTwoWay) return 0;
  const currentProtected = protectedSalaryForAmount(salary, asset.currentSeasonGuaranteedSalary);
  if (timing.isJan8ToRegularSeasonEndWindow) return salary;
  if (timing.isPostRegularSeasonToJune30Window) {
    const nextSalary = finiteNumber(asset.nextSeasonSalary);
    if (nextSalary === null) return currentProtected;
    return Math.min(currentProtected, protectedSalaryForAmount(nextSalary, asset.nextSeasonGuaranteedSalary));
  }
  return currentProtected;
}

function subsequentYearApronSalaryAfterTrade(
  beforeSalary: number | null | undefined,
  outgoingPlayers: TradeMachineAsset[],
  incomingPlayers: TradeMachineAsset[]
): number | null {
  const base = finiteNumber(beforeSalary);
  if (base === null) return null;
  return Math.max(0, base - sum(outgoingPlayers.map(nextSeasonTradeSalary)) + sum(incomingPlayers.map(nextSeasonTradeSalary)));
}

function nextSeasonTradeSalary(asset: TradeMachineAsset): number {
  if (asset.isTwoWay) return 0;
  return money(asset.nextSeasonSalary);
}

function standardContractPlayer(asset: TradeMachineAsset): boolean {
  return asset.kind === "player" && !asset.isTwoWay;
}

function aggregationCountingPlayer(asset: TradeMachineAsset, season: CapTrackerSeason): boolean {
  return asset.kind === "player" && tradeSalaryForAsset(asset, season) > 0;
}

export function baseYearCompensationOutgoingSalary(input: BaseYearCompensationInput, fallbackNewSalary = 0): number {
  if (!input.applies) return fallbackNewSalary;
  const newSalary = money(input.newSalary ?? fallbackNewSalary);
  const previousSalary = money(input.previousSalary);
  return Math.max(previousSalary, newSalary * 0.5);
}

export function apronBand(teamSalary: number, season: CapTrackerSeason): TradeMachineApronBand {
  if (teamSalary > season.second_apron) return "second_apron";
  if (teamSalary > season.first_apron) return "first_apron";
  if (teamSalary > season.tax_level) return "tax";
  if (teamSalary > season.salary_cap) return "over_cap";
  return "cap_room";
}

function resolveTradeRoutes(sides: TradeMachineSides): TradeMachineSides {
  if (sides.length !== 2) return sides;
  const [left, right] = sides;
  return [
    {
      ...left,
      sends: left.sends.map((asset) => ({ ...asset, toTeam: asset.toTeam ?? right.team.team }))
    },
    {
      ...right,
      sends: right.sends.map((asset) => ({ ...asset, toTeam: asset.toTeam ?? left.team.team }))
    }
  ] as TradeMachineSides;
}

function incomingAssetsForSide(side: TradeMachineSide, sides: readonly TradeMachineSide[]): TradeMachineAsset[] {
  const target = normalizeTeam(side.team.team);
  return sides
    .filter((other) => normalizeTeam(other.team.team) !== target)
    .flatMap((other) => other.sends.filter((asset) => normalizeTeam(asset.toTeam) === target));
}

function tradeRoutingChecks(sides: TradeMachineSides): TradeMachineRuleCheck[] {
  const teamNames = sides.map((side) => normalizeTeam(side.team.team)).filter(Boolean);
  const uniqueTeamNames = new Set(teamNames);
  const checks: TradeMachineRuleCheck[] = [];

  if (uniqueTeamNames.size < sides.length) {
    checks.push({
      code: "trade-routing:duplicate-teams",
      label: "Trade routing",
      status: "fail",
      detail: "Each trade-machine side must represent a distinct team."
    });
  }

  const missingDestinations: string[] = [];
  const invalidDestinations: string[] = [];
  const selfDestinations: string[] = [];
  const invalidSenders: string[] = [];
  const requiresExplicitDestination = sides.length > 2;
  for (const side of sides) {
    const sender = normalizeTeam(side.team.team);
    for (const asset of side.sends) {
      const modeledOwner = normalizeTeam(asset.team);
      if (modeledOwner && modeledOwner !== sender) {
        invalidSenders.push(`${side.team.team}: ${asset.label} belongs to ${asset.team}`);
      }
      const destination = normalizeTeam(asset.toTeam);
      if (!destination && requiresExplicitDestination) {
        missingDestinations.push(`${side.team.team}: ${asset.label}`);
        continue;
      }
      if (!destination) continue;
      if (destination === sender) {
        selfDestinations.push(`${asset.label} to ${asset.toTeam}`);
      } else if (!uniqueTeamNames.has(destination)) {
        invalidDestinations.push(`${asset.label} to ${asset.toTeam}`);
      }
    }
  }

  if (missingDestinations.length > 0) {
    checks.push({
      code: "trade-routing:missing-destination",
      label: "Trade routing",
      status: "fail",
      detail: `Multi-team trades require an explicit destination for every asset: ${missingDestinations.join(", ")}.`
    });
  }
  if (invalidDestinations.length > 0) {
    checks.push({
      code: "trade-routing:invalid-destination",
      label: "Trade routing",
      status: "fail",
      detail: `Asset destination must match a participating team: ${invalidDestinations.join(", ")}.`
    });
  }
  if (selfDestinations.length > 0) {
    checks.push({
      code: "trade-routing:self-destination",
      label: "Trade routing",
      status: "fail",
      detail: `Assets cannot be routed back to the sending team: ${selfDestinations.join(", ")}.`
    });
  }
  if (invalidSenders.length > 0) {
    checks.push({
      code: "trade-routing:invalid-sender",
      label: "Trade routing",
      status: "fail",
      detail: `Each outgoing asset must belong to the sending side when ownership is modeled: ${invalidSenders.join(", ")}.`
    });
  }

  if (checks.length > 0) return checks;
  return [{
    code: "trade-routing",
    label: "Trade routing",
    status: "pass",
    detail: sides.length === 2
      ? "Two-team trade routes are inferred where asset destinations are omitted."
      : "All multi-team trade assets have modeled destinations."
  }];
}

function tradeWindowCheck(input: TradeMachineInput): TradeMachineRuleCheck {
  const date = parseDate(input.tradeDate);
  const deadline = parseDate(input.tradeDeadlineDate);
  const regularSeasonEnd = parseDate(input.regularSeasonEndDate);

  if (!input.tradeDate) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "pass",
      detail: "No trade date is modeled, so the in-season trade-deadline window is not applied."
    };
  }

  if (!date) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "warn",
      detail: "The modeled trade date could not be parsed; verify the transaction falls in an allowable trade window."
    };
  }

  if (!deadline) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "warn",
      detail: `${dateIsoLabel(date)} is modeled, but the trade deadline is missing, so the in-season trade window cannot be confirmed.`
    };
  }

  if (date.getTime() <= deadline.getTime()) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "pass",
      detail: `${dateIsoLabel(date)} is on or before the ${dateIsoLabel(deadline)} trade deadline.`
    };
  }

  if (!regularSeasonEnd) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "warn",
      detail: `${dateIsoLabel(date)} is after the ${dateIsoLabel(deadline)} trade deadline; model the regular-season end date to distinguish a prohibited in-season trade from an offseason trade.`
    };
  }

  if (date.getTime() < regularSeasonEnd.getTime()) {
    return {
      code: "trade-window",
      label: "Trade window",
      status: "fail",
      detail: `${dateIsoLabel(date)} is after the ${dateIsoLabel(deadline)} trade deadline and before the modeled ${dateIsoLabel(regularSeasonEnd)} regular-season end.`
    };
  }

  return {
    code: "trade-window",
    label: "Trade window",
    status: "pass",
    detail: `${dateIsoLabel(date)} is after the modeled regular-season end, so the in-season trade-deadline bar is not applied.`
  };
}

function evaluateTeamSide(side: TradeMachineSide, incomingAssets: TradeMachineAsset[], season: CapTrackerSeason, input: TradeMachineInput): TradeMachineTeamResult {
  const outgoing = side.sends;
  const incoming = incomingAssets;
  const outgoingPlayers = outgoing.filter((asset) => asset.kind === "player");
  const incomingPlayers = incoming.filter((asset) => asset.kind === "player");
  const outgoingStandardPlayers = outgoingPlayers.filter(standardContractPlayer);
  const incomingStandardPlayers = incomingPlayers.filter(standardContractPlayer);
  const timing = tradeMachineTiming(input);
  const outgoingBaseSalary = sum(outgoingPlayers.map((asset) => tradeSalaryForAsset(asset, season)));
  const outgoingSalaryForMatch = sum(outgoingPlayers.map((asset) => outgoingSalaryForMatching(asset, season, timing)));
  const outgoingSalaryForTpeCreation = sum(outgoingPlayers.map((asset) => tpeCreationSalaryForAsset(asset, season, timing)));
  const incomingSalary = sum(incomingPlayers.map((asset) => tradeSalaryForAsset(asset, season)));
  const minimumSalaryExceptionSalary = sum(incomingPlayers.filter(minimumSalaryExceptionEligibleForIncoming).map((asset) => tradeSalaryForAsset(asset, season)));
  const incomingSalaryForMatching = Math.max(0, incomingSalary - minimumSalaryExceptionSalary);
  const incomingBonus = sum(incomingPlayers.map((asset) => tradeBonusAmount(asset, season)));
  const beforeSalary = money(side.team.teamSalary);
  const afterSalary = Math.max(0, beforeSalary - outgoingBaseSalary + incomingSalary);
  const subsequentYearApronSalaryAfter = subsequentYearApronSalaryAfterTrade(side.team.subsequentYearApronSalary, outgoingPlayers, incomingPlayers);
  const rosterBefore = Math.max(0, Math.round(side.team.rosterCount || 0));
  const rosterAfter = rosterBefore - outgoingStandardPlayers.length + incomingStandardPlayers.length;
  const outgoingAggregationPlayerCount = outgoingPlayers.filter((asset) => aggregationCountingPlayer(asset, season)).length;
  const salaryMatch = salaryMatching(season, beforeSalary, afterSalary, outgoingBaseSalary, outgoingSalaryForMatch, outgoingSalaryForTpeCreation, incomingSalary, incomingSalaryForMatching, minimumSalaryExceptionSalary, incomingPlayers, outgoingAggregationPlayerCount, side.team.availableTradeExceptions, input.tradeDate);
  const checks: TradeMachineRuleCheck[] = [
    salaryMatchCheck(side.team.team, salaryMatch),
    existingTradeExceptionExpiryCheck(side.team.team, salaryMatch, input.tradeDate),
    disabledPlayerExceptionExpiryCheck(side.team.team, salaryMatch, input.tradeDate),
    disabledPlayerExceptionTermCheck(side.team.team, salaryMatch, incomingPlayers),
    assignmentExceptionTermCheck(side.team.team, salaryMatch, incomingPlayers),
    minimumSalaryExceptionTermCheck(side.team.team, incomingPlayers),
    firstApronCheck(side.team.team, beforeSalary, afterSalary, outgoingSalaryForMatch, salaryMatch, season),
    transactionApronRestrictionCheck(side.team, afterSalary, subsequentYearApronSalaryAfter, salaryMatch, incomingPlayers, outgoing, timing, season),
    signAndTradeCheck(side.team.team, afterSalary, incomingPlayers, season),
    secondApronAggregationCheck(side.team.team, beforeSalary, afterSalary, outgoingPlayers, season),
    secondApronCashCheck(side.team.team, beforeSalary, afterSalary, outgoing, season),
    cashLimitCheck(side.team.team, side.team, outgoing, incoming, season),
    aggregationEligibilityCheck(side.team.team, outgoingPlayers, salaryMatch, season),
    recentTradeAggregationCheck(side.team.team, outgoingPlayers, input.tradeDate, input.tradeDeadlineDate, salaryMatch, input.season),
    minimumAggregationCheck(side.team.team, outgoingPlayers, incomingPlayers, timing.isDec15ToTradeDeadlineWindow),
    tradeDeadlineContractCheck(side.team.team, outgoingPlayers, input.tradeDate, input.tradeDeadlineDate),
    signingMoratoriumCheck(side.team.team, outgoingPlayers, input.tradeDate, input.season),
    tradeRestrictionDateCheck(side.team.team, outgoingPlayers, input.tradeDate),
    hardCapCheck(side.team.team, afterSalary, side.team.hardCap, season),
    rosterLimitCheck(side.team.team, rosterAfter),
    noTradeConsentCheck(side.team.team, outgoingPlayers, input.tradeDate),
    bycDisclosureCheck(side.team.team, outgoingPlayers, season, timing),
    salaryProtectionDisclosureCheck(side.team.team, outgoingPlayers, season, timing),
    tpeCreationEligibilityCheck(side.team.team, outgoingPlayers, salaryMatch.tradeExceptionCreated),
    tradeBonusCheck(side.team.team, incomingPlayers, incomingBonus, season),
    draftPickSpecificityCheck(side.team.team, outgoing),
    secondApronFrozenPickCheck(side.team.team, side.team.seasonYear, outgoing, side.team.secondApronFrozenFirstYears, beforeSalary, afterSalary, season),
    stepienCheck(side.team.team, side.team.seasonYear, outgoing, incoming, side.team.firstRoundPickYears, side.team.firstRoundPickInventorySource)
  ];

  return {
    team: side.team.team,
    status: statusFromChecks(checks),
    beforeSalary,
    afterSalary,
    subsequentYearApronSalaryAfter,
    apronBefore: apronBand(beforeSalary, season),
    apronAfter: apronBand(afterSalary, season),
    rosterBefore,
    rosterAfter,
    incoming,
    outgoing,
    salaryMatch,
    checks
  };
}

function salaryMatching(
  season: CapTrackerSeason,
  beforeSalary: number,
  afterSalary: number,
  outgoingSalary: number,
  outgoingSalaryForMatch: number,
  outgoingSalaryForTpeCreation: number,
  incomingSalary: number,
  incomingSalaryForMatching: number,
  minimumSalaryExceptionSalary: number,
  incomingPlayers: TradeMachineAsset[],
  outgoingPlayerCount: number,
  availableTradeExceptions: TradeMachineAvailableException[] | undefined,
  tradeDate: string | null | undefined
): TradeMachineSalaryMatch {
  const buffer = tradeBuffer(afterSalary, season);
  const capRoomAfterOutgoing = season.salary_cap - Math.max(0, beforeSalary - outgoingSalary);
  const bestAssignmentException = bestAssignmentExceptionForIncoming(availableTradeExceptions, incomingPlayers, incomingSalaryForMatching, season, tradeDate);
  const bestDisabledPlayerException = bestDisabledPlayerExceptionForIncoming(availableTradeExceptions, incomingPlayers, incomingSalaryForMatching, tradeDate);
  if (beforeSalary < season.salary_cap && incomingSalaryForMatching <= Math.max(0, capRoomAfterOutgoing) + buffer) {
    return {
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatching: outgoingSalaryForMatch,
      maxIncomingSalary: Math.max(0, capRoomAfterOutgoing) + buffer,
      capRoomAfterOutgoing,
      usedCapRoom: true,
      rule: buffer > 0 ? "Room under cap plus $250,000" : "Room under cap",
      exceptionType: "cap_room",
      tradeExceptionCreated: 0
    };
  }

  const bestExistingTpe = bestTradeExceptionForIncoming(availableTradeExceptions, incomingSalaryForMatching, buffer, tradeDate);
  if (outgoingSalaryForMatch <= 0) {
    if (incomingSalaryForMatching <= 0 && minimumSalaryExceptionSalary > 0) {
      return {
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatching: outgoingSalaryForMatch,
        maxIncomingSalary: 0,
        capRoomAfterOutgoing,
        usedCapRoom: false,
        rule: "Minimum Player Salary Exception",
        exceptionType: "minimum_salary",
        tradeExceptionCreated: 0
      };
    }
    if (bestExistingTpe) {
      const firstApronRestrictionApplies = existingTpeFirstApronRestrictionApplies(bestExistingTpe, tradeDate);
      return {
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatching: outgoingSalaryForMatch,
        maxIncomingSalary: money(bestExistingTpe.amount) + buffer,
        capRoomAfterOutgoing,
        usedCapRoom: false,
        rule: `Existing Traded Player Exception: ${bestExistingTpe.name}`,
        exceptionType: "existing_tpe",
        tradeExceptionCreated: 0,
        existingTradeExceptionName: bestExistingTpe.name,
        existingTradeExceptionExpires: bestExistingTpe.expires ?? null,
        existingTradeExceptionFirstApronRestrictionStarts: bestExistingTpe.firstApronRestrictionStarts ?? null,
        existingTradeExceptionFirstApronRestrictionApplies: firstApronRestrictionApplies,
        existingTradeExceptionSignedAndTradedContract: bestExistingTpe.signedAndTradedContract ?? null
      };
    }
    if (bestDisabledPlayerException) {
      return disabledPlayerExceptionSalaryMatch(
        bestDisabledPlayerException,
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatch,
        capRoomAfterOutgoing
      );
    }
    if (bestAssignmentException) {
      return assignmentExceptionSalaryMatch(
        bestAssignmentException,
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatch,
        capRoomAfterOutgoing,
        0
      );
    }
    return {
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatching: outgoingSalaryForMatch,
      maxIncomingSalary: 0,
      capRoomAfterOutgoing,
      usedCapRoom: false,
      rule: "No cap room, outgoing salary, or existing traded-player exception",
      exceptionType: "none",
      tradeExceptionCreated: 0
    };
  }

  const firstApronConstrained = beforeSalary > season.first_apron || afterSalary > season.first_apron;
  const isAggregated = outgoingPlayerCount > 1;
  const standardExceptionType = isAggregated ? "aggregated_standard" : "standard";
  const standardRule = isAggregated ? "Aggregated Standard Traded Player Exception" : "Standard Traded Player Exception";
  if (firstApronConstrained) {
    const transitionMax = transitionTradedPlayerExceptionMax(outgoingSalaryForMatch, afterSalary, season);
    if (incomingSalaryForMatching > outgoingSalaryForMatch && incomingSalaryForMatching <= transitionMax) {
      return {
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatching: outgoingSalaryForMatch,
        maxIncomingSalary: transitionMax,
        capRoomAfterOutgoing,
        usedCapRoom: false,
        rule: "Transition Traded Player Exception: 110% salary-return limit for 2023-24",
        exceptionType: "transition",
        tradeExceptionCreated: 0
      };
    }
    if (bestAssignmentException) {
      return assignmentExceptionSalaryMatch(
        bestAssignmentException,
        incomingSalary,
        incomingSalaryForMatching,
        minimumSalaryExceptionSalary,
        outgoingSalary,
        outgoingSalaryForMatch,
        capRoomAfterOutgoing,
        outgoingSalaryForTpeCreation
      );
    }
    return {
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatching: outgoingSalaryForMatch,
      maxIncomingSalary: outgoingSalaryForMatch,
      capRoomAfterOutgoing,
      usedCapRoom: false,
      rule: `${standardRule}: 100% salary-return limit above the first apron`,
      exceptionType: outgoingSalaryForMatch > 0 ? standardExceptionType : "none",
      tradeExceptionCreated: Math.max(0, outgoingSalaryForTpeCreation - incomingSalaryForMatching)
    };
  }

  const standardMax = outgoingSalaryForMatch + buffer;
  if (incomingSalaryForMatching <= standardMax) {
    return {
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatching: outgoingSalaryForMatch,
      maxIncomingSalary: standardMax,
      capRoomAfterOutgoing,
      usedCapRoom: false,
      rule: standardRule,
      exceptionType: outgoingSalaryForMatch > 0 ? standardExceptionType : "none",
      tradeExceptionCreated: Math.max(0, outgoingSalaryForTpeCreation - incomingSalaryForMatching)
    };
  }

  const transitionMax = transitionTradedPlayerExceptionMax(outgoingSalaryForMatch, afterSalary, season);
  if (incomingSalaryForMatching <= transitionMax) {
    return {
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatching: outgoingSalaryForMatch,
      maxIncomingSalary: transitionMax,
      capRoomAfterOutgoing,
      usedCapRoom: false,
      rule: "Transition Traded Player Exception: 110% plus $250,000 for 2023-24",
      exceptionType: "transition",
      tradeExceptionCreated: 0
    };
  }

  if (bestAssignmentException) {
    return assignmentExceptionSalaryMatch(
      bestAssignmentException,
      incomingSalary,
      incomingSalaryForMatching,
      minimumSalaryExceptionSalary,
      outgoingSalary,
      outgoingSalaryForMatch,
      capRoomAfterOutgoing,
      outgoingSalaryForTpeCreation
    );
  }

  const expandedMax = expandedTradedPlayerExceptionMax(outgoingSalaryForMatch, afterSalary, season);
  return {
    incomingSalary,
    incomingSalaryForMatching,
    minimumSalaryExceptionSalary,
    outgoingSalary,
    outgoingSalaryForMatching: outgoingSalaryForMatch,
    maxIncomingSalary: expandedMax,
    capRoomAfterOutgoing,
    usedCapRoom: false,
    rule: "Expanded Traded Player Exception",
    exceptionType: outgoingSalaryForMatch > 0 ? "expanded" : "none",
    tradeExceptionCreated: 0
  };
}

function expandedTradedPlayerExceptionMax(outgoingSalaryForMatch: number, afterSalary: number, season: CapTrackerSeason): number {
  if (outgoingSalaryForMatch <= 0) return 0;
  const buffer = tradeBuffer(afterSalary, season);
  const scaledDelta = scaledTradeDelta(season);
  const doubleSalaryPath = outgoingSalaryForMatch * 2 + buffer;
  const salaryPlusDeltaPath = outgoingSalaryForMatch + scaledDelta;
  const oneTwentyFivePath = outgoingSalaryForMatch * 1.25 + buffer;
  return Math.max(Math.min(doubleSalaryPath, salaryPlusDeltaPath), oneTwentyFivePath);
}

function transitionTradedPlayerExceptionMax(outgoingSalaryForMatch: number, afterSalary: number, season: CapTrackerSeason): number {
  if (!isTransitionTpeSeason(season) || outgoingSalaryForMatch <= 0) return 0;
  return outgoingSalaryForMatch * 1.1 + tradeBuffer(afterSalary, season);
}

function isTransitionTpeSeason(season: CapTrackerSeason): boolean {
  return Number(season.year) === 2024 || season.label === "2023-24";
}

function tradeBuffer(afterSalary: number, season: CapTrackerSeason): number {
  return afterSalary > season.first_apron ? 0 : 250_000;
}

function scaledTradeDelta(season: CapTrackerSeason): number {
  return Math.round(7_500_000 * (season.salary_cap / 136_021_000));
}

function bestTradeExceptionForIncoming(
  availableTradeExceptions: TradeMachineAvailableException[] | undefined,
  incomingSalary: number,
  buffer: number,
  tradeDate: string | null | undefined
): TradeMachineAvailableException | null {
  if (incomingSalary <= 0) return null;
  const date = parseDate(tradeDate);
  return (availableTradeExceptions ?? [])
    .filter(isAvailableTradedPlayerException)
    .filter((exception) => money(exception.amount) + buffer >= incomingSalary)
    .filter((exception) => tradeExceptionAvailableOnDate(exception, date))
    .sort((a, b) => money(a.amount) - money(b.amount))[0] ?? null;
}

function bestAssignmentExceptionForIncoming(
  availableTradeExceptions: TradeMachineAvailableException[] | undefined,
  incomingPlayers: TradeMachineAsset[],
  incomingSalaryForMatching: number,
  season: CapTrackerSeason,
  tradeDate: string | null | undefined
): TradeMachineAvailableException | null {
  if (incomingSalaryForMatching <= 0 || !assignmentExceptionAcquisitionAllowedInSeason(season)) return null;
  const coveredPlayers = incomingPlayers.filter((asset) => !minimumSalaryExceptionEligibleForIncoming(asset));
  if (coveredPlayers.length === 0 || coveredPlayers.some((asset) => asset.kind !== "player" || asset.signedAndTraded)) return null;
  const date = parseDate(tradeDate);
  const salaryFitting = (availableTradeExceptions ?? [])
    .filter(isAssignmentAcquisitionException)
    .filter((exception) => money(exception.amount) >= incomingSalaryForMatching)
    .filter((exception) => tradeExceptionAvailableOnDate(exception, date))
    .sort((a, b) => money(a.amount) - money(b.amount));
  return salaryFitting.find((exception) => incomingPlayersFitAssignmentExceptionTerm(coveredPlayers, exception)) ?? salaryFitting[0] ?? null;
}

function bestDisabledPlayerExceptionForIncoming(
  availableTradeExceptions: TradeMachineAvailableException[] | undefined,
  incomingPlayers: TradeMachineAsset[],
  incomingSalaryForMatching: number,
  tradeDate: string | null | undefined
): TradeMachineAvailableException | null {
  if (incomingSalaryForMatching <= 0) return null;
  const coveredPlayers = incomingPlayers.filter((asset) => !minimumSalaryExceptionEligibleForIncoming(asset));
  if (coveredPlayers.length !== 1 || coveredPlayers.some((asset) => asset.kind !== "player" || asset.signedAndTraded)) return null;
  const date = parseDate(tradeDate);
  return (availableTradeExceptions ?? [])
    .filter(isDisabledPlayerException)
    .filter((exception) => money(exception.amount) >= incomingSalaryForMatching)
    .filter((exception) => tradeExceptionAvailableOnDate(exception, date))
    .sort((a, b) => money(a.amount) - money(b.amount))[0] ?? null;
}

function disabledPlayerExceptionSalaryMatch(
  exception: TradeMachineAvailableException,
  incomingSalary: number,
  incomingSalaryForMatching: number,
  minimumSalaryExceptionSalary: number,
  outgoingSalary: number,
  outgoingSalaryForMatch: number,
  capRoomAfterOutgoing: number
): TradeMachineSalaryMatch {
  return {
    incomingSalary,
    incomingSalaryForMatching,
    minimumSalaryExceptionSalary,
    outgoingSalary,
    outgoingSalaryForMatching: outgoingSalaryForMatch,
    maxIncomingSalary: money(exception.amount),
    capRoomAfterOutgoing,
    usedCapRoom: false,
    rule: `Disabled Player Exception: ${exception.name}`,
    exceptionType: "disabled_player",
    tradeExceptionCreated: 0,
    disabledPlayerExceptionName: exception.name,
    disabledPlayerExceptionExpires: exception.expires ?? null,
    disabledPlayerExceptionAmount: money(exception.amount)
  };
}

function assignmentExceptionSalaryMatch(
  exception: TradeMachineAvailableException,
  incomingSalary: number,
  incomingSalaryForMatching: number,
  minimumSalaryExceptionSalary: number,
  outgoingSalary: number,
  outgoingSalaryForMatch: number,
  capRoomAfterOutgoing: number,
  tradeExceptionCreated: number
): TradeMachineSalaryMatch {
  const kind = assignmentExceptionKind(exception);
  const exceptionType = assignmentExceptionType(kind);
  return {
    incomingSalary,
    incomingSalaryForMatching,
    minimumSalaryExceptionSalary,
    outgoingSalary,
    outgoingSalaryForMatching: outgoingSalaryForMatch,
    maxIncomingSalary: money(exception.amount),
    capRoomAfterOutgoing,
    usedCapRoom: false,
    rule: assignmentExceptionRuleLabel(kind, exception.name),
    exceptionType,
    tradeExceptionCreated,
    assignmentExceptionName: exception.name,
    assignmentExceptionAmount: money(exception.amount),
    assignmentExceptionKind: kind
  };
}

function tradeExceptionAvailableOnDate(exception: TradeMachineAvailableException, tradeDate: Date | null): boolean {
  if (!tradeDate) return true;
  const expires = parseDate(exception.expires);
  if (!expires) return true;
  return tradeDate.getTime() <= expires.getTime();
}

function existingTpeFirstApronRestrictionApplies(exception: TradeMachineAvailableException, tradeDate: string | null | undefined): boolean | null {
  const date = parseDate(tradeDate);
  const starts = parseDate(exception.firstApronRestrictionStarts);
  if (!date || !starts) return null;
  return date.getTime() >= starts.getTime();
}

function protectedSalaryForAmount(salary: number, guaranteedSalary: number | null | undefined): number {
  const protectedSalary = finiteNumber(guaranteedSalary);
  return protectedSalary === null ? salary : Math.max(0, Math.min(salary, protectedSalary));
}

function tpeCreationSalaryForAsset(asset: TradeMachineAsset, season: CapTrackerSeason, timing: TradeMachineTimingInput): number {
  if (asset.disabledPlayerExceptionUsed || asset.isTwoWay) return 0;
  return outgoingSalaryForMatching(asset, season, timing);
}

function modeledExceptionKind(row: CapTrackerException): TradeMachineAvailableExceptionKind | null {
  return exceptionKindFromText(`${row.name ?? ""} ${row.note ?? ""}`);
}

function isAvailableTradedPlayerException(exception: TradeMachineAvailableException): boolean {
  return availableExceptionKind(exception) === "traded_player";
}

function isDisabledPlayerException(exception: TradeMachineAvailableException): boolean {
  return availableExceptionKind(exception) === "disabled_player";
}

function isAssignmentAcquisitionException(exception: TradeMachineAvailableException): boolean {
  const kind = availableExceptionKind(exception);
  return kind === "non_taxpayer_mle" || kind === "bi_annual" || kind === "room_mle";
}

function isAssignmentExceptionType(exceptionType: TradeMachineSalaryMatch["exceptionType"]): boolean {
  return exceptionType === "non_taxpayer_mle" || exceptionType === "bi_annual" || exceptionType === "room_mle";
}

function isAggregatingTradeExceptionType(exceptionType: TradeMachineSalaryMatch["exceptionType"]): boolean {
  return exceptionType === "aggregated_standard" || exceptionType === "expanded" || exceptionType === "transition";
}

function assignmentExceptionKind(exception: TradeMachineAvailableException): "non_taxpayer_mle" | "bi_annual" | "room_mle" {
  const kind = availableExceptionKind(exception);
  if (kind === "non_taxpayer_mle" || kind === "bi_annual" || kind === "room_mle") return kind;
  return "non_taxpayer_mle";
}

function assignmentExceptionType(kind: "non_taxpayer_mle" | "bi_annual" | "room_mle"): TradeMachineSalaryMatch["exceptionType"] {
  return kind;
}

function availableExceptionKind(exception: TradeMachineAvailableException): TradeMachineAvailableExceptionKind {
  return exception.kind ?? exceptionKindFromText(exception.name) ?? "unknown";
}

function exceptionKindFromText(text: string): TradeMachineAvailableExceptionKind | null {
  const clean = text.toLowerCase();
  if (/\btpe\b/.test(clean) || /traded[-\s]?player exception/.test(clean) || /trade exception/.test(clean)) return "traded_player";
  if (/non[-\s]?taxpayer/.test(clean) && (/\bmle\b/.test(clean) || /mid[-\s]?level/.test(clean))) return "non_taxpayer_mle";
  if (/bi[-\s]?annual|\bbae\b/.test(clean)) return "bi_annual";
  if (/\broom\b/.test(clean) && (/\bmle\b/.test(clean) || /mid[-\s]?level/.test(clean) || /exception/.test(clean))) return "room_mle";
  if (/taxpayer/.test(clean) && (/\bmle\b/.test(clean) || /mid[-\s]?level/.test(clean))) return "taxpayer_mle";
  if (/disabled player|\bdpe\b/.test(clean)) return "disabled_player";
  return null;
}

function assignmentExceptionAcquisitionAllowedInSeason(season: CapTrackerSeason): boolean {
  return Number(season.year) >= 2025;
}

function assignmentExceptionMaxTerm(kind: TradeMachineAvailableExceptionKind | null | undefined): number | null {
  if (kind === "bi_annual") return 2;
  if (kind === "room_mle") return 3;
  if (kind === "non_taxpayer_mle") return 4;
  return null;
}

function incomingPlayersFitAssignmentExceptionTerm(incomingPlayers: TradeMachineAsset[], exception: TradeMachineAvailableException): boolean {
  const maxTerm = assignmentExceptionMaxTerm(availableExceptionKind(exception));
  if (maxTerm === null) return false;
  return incomingPlayers.every((asset) => {
    const term = finiteNumber(asset.contractSeasonsRemaining);
    return term === null || term <= maxTerm;
  });
}

function assignmentExceptionRuleLabel(kind: TradeMachineAvailableExceptionKind | null | undefined, fallbackName: string): string {
  if (kind === "bi_annual") return `Bi-annual Exception: ${fallbackName}`;
  if (kind === "room_mle") return `Room Mid-Level Salary Exception: ${fallbackName}`;
  if (kind === "non_taxpayer_mle") return `Non-Taxpayer Mid-Level Salary Exception: ${fallbackName}`;
  return fallbackName;
}

function tradeMachineTiming(input: TradeMachineInput): TradeMachineTimingInput {
  const tradeDate = parseDate(input.tradeDate);
  const tradeDeadlineDate = parseDate(input.tradeDeadlineDate);
  const regularSeasonEndDate = parseDate(input.regularSeasonEndDate);
  const dec15 = dateForSeason(input.season.year - 1, 12, 15);
  const jan8 = dateForSeason(input.season.year, 1, 8);
  const june30 = dateForSeason(input.season.year, 6, 30);
  return {
    isDec15ToTradeDeadlineWindow: input.isDec15ToTradeDeadlineWindow ?? dateBetweenInclusive(tradeDate, dec15, tradeDeadlineDate),
    isJan8ToRegularSeasonEndWindow: input.isJan8ToRegularSeasonEndWindow ?? dateBetweenInclusive(tradeDate, jan8, regularSeasonEndDate),
    isPostRegularSeasonToJune30Window: input.isPostRegularSeasonToJune30Window ?? dateAfterThrough(tradeDate, regularSeasonEndDate, june30)
  };
}

function grossTradeBonusAmount(asset: TradeMachineAsset): number {
  if (asset.kind !== "player" || !asset.tradeBonus) return 0;
  const bonus = asset.tradeBonus;
  if (bonus.waived || bonus.previouslyEarned || asset.signedAndTraded) return 0;
  const remainingBase = money(bonus.remainingBaseCompensation ?? asset.salary);
  if (remainingBase <= 0) return 0;
  const percent = Math.min(Math.max(finiteNumber(bonus.percent) ?? 0, 0), 0.15);
  const percentAmount = percent > 0 ? remainingBase * percent : 0;
  const specifiedAmount = finiteNumber(bonus.amount);
  if (specifiedAmount !== null && percentAmount > 0) return Math.min(specifiedAmount, percentAmount, remainingBase * 0.15);
  return specifiedAmount !== null ? Math.min(specifiedAmount, remainingBase * 0.15) : percentAmount;
}

function maxSalaryWithTradeBonus(asset: TradeMachineAsset, season: CapTrackerSeason): number {
  const bonus = asset.tradeBonus;
  if (!bonus) return Number.POSITIVE_INFINITY;
  const explicitPercent = finiteNumber(bonus.maxSalaryPercent);
  const yoe = finiteNumber(bonus.yoe);
  const percent = explicitPercent !== null
    ? explicitPercent
    : yoe === null
      ? null
      : yoe >= 10
        ? 0.35
        : yoe >= 7
          ? 0.30
          : 0.25;
  const maxByTier = percent !== null ? season.salary_cap * percent : Number.NEGATIVE_INFINITY;
  const priorSalary = finiteNumber(bonus.priorYearSalary);
  const maxByPriorSalary = priorSalary !== null ? priorSalary * 1.05 : Number.NEGATIVE_INFINITY;
  const limit = Math.max(maxByTier, maxByPriorSalary);
  return Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY;
}

function salaryMatchCheck(team: string, salaryMatch: TradeMachineSalaryMatch): TradeMachineRuleCheck {
  const legal = salaryMatch.incomingSalaryForMatching <= salaryMatch.maxIncomingSalary;
  const minimumDetail = salaryMatch.minimumSalaryExceptionSalary > 0
    ? ` ${moneyLabel(salaryMatch.minimumSalaryExceptionSalary)} is covered by the Minimum Player Salary Exception.`
    : "";
  const coverageLabel = isAssignmentExceptionType(salaryMatch.exceptionType) ? "requiring assignment-exception coverage" : "requiring salary matching";
  return {
    code: `${team}:salary-match`,
    label: `${team} salary matching`,
    status: legal ? "pass" : "fail",
    detail: legal
      ? `${team} receives ${moneyLabel(salaryMatch.incomingSalary)} with ${moneyLabel(salaryMatch.incomingSalaryForMatching)} ${coverageLabel} against ${moneyLabel(salaryMatch.maxIncomingSalary)} allowed by ${salaryMatch.rule}.${minimumDetail}`
      : `${team} receives ${moneyLabel(salaryMatch.incomingSalary)} with ${moneyLabel(salaryMatch.incomingSalaryForMatching)} ${coverageLabel}, but can receive only ${moneyLabel(salaryMatch.maxIncomingSalary)} under ${salaryMatch.rule}.${minimumDetail}`
  };
}

function disabledPlayerExceptionTermCheck(team: string, salaryMatch: TradeMachineSalaryMatch, incomingPlayers: TradeMachineAsset[]): TradeMachineRuleCheck {
  if (salaryMatch.exceptionType !== "disabled_player") {
    return {
      code: `${team}:disabled-player-exception-term`,
      label: `${team} Disabled Player Exception term`,
      status: "pass",
      detail: `${team} is not using a Disabled Player Exception to acquire a player.`
    };
  }

  const coveredPlayers = incomingPlayers.filter((asset) => !minimumSalaryExceptionEligibleForIncoming(asset));
  const tooLong = coveredPlayers.filter((asset) => {
    const term = finiteNumber(asset.contractSeasonsRemaining);
    return term !== null && term > 1;
  });
  if (tooLong.length > 0) {
    return {
      code: `${team}:disabled-player-exception-term`,
      label: `${team} Disabled Player Exception term`,
      status: "fail",
      detail: `${team} cannot acquire ${tooLong.map((asset) => asset.label).join(", ")} with ${salaryMatch.rule}; DPE trade acquisitions must be on expiring contracts.`
    };
  }

  const unknownTerm = coveredPlayers.filter((asset) => finiteNumber(asset.contractSeasonsRemaining) === null);
  return {
    code: `${team}:disabled-player-exception-term`,
    label: `${team} Disabled Player Exception term`,
    status: unknownTerm.length > 0 ? "warn" : "pass",
    detail: unknownTerm.length > 0
      ? `${team} uses ${salaryMatch.rule}; contract term is not modeled for ${unknownTerm.map((asset) => asset.label).join(", ")}.`
      : `${team} uses ${salaryMatch.rule} and the acquired contract is modeled as expiring.`
  };
}

function assignmentExceptionTermCheck(team: string, salaryMatch: TradeMachineSalaryMatch, incomingPlayers: TradeMachineAsset[]): TradeMachineRuleCheck {
  if (!isAssignmentExceptionType(salaryMatch.exceptionType)) {
    return {
      code: `${team}:assignment-exception-term`,
      label: `${team} assignment exception term`,
      status: "pass",
      detail: `${team} does not use a non-trade exception to acquire an assigned contract.`
    };
  }

  const kind = salaryMatch.assignmentExceptionKind;
  const maxTerm = assignmentExceptionMaxTerm(kind);
  const coveredPlayers = incomingPlayers.filter((asset) => !minimumSalaryExceptionEligibleForIncoming(asset));
  if (maxTerm === null) {
    return {
      code: `${team}:assignment-exception-term`,
      label: `${team} assignment exception term`,
      status: "warn",
      detail: `${team} uses ${salaryMatch.assignmentExceptionName ?? "an assignment exception"}, but the modeled exception type is not recognized for term-limit validation.`
    };
  }

  const tooLong = coveredPlayers.filter((asset) => {
    const term = finiteNumber(asset.contractSeasonsRemaining);
    return term !== null && term > maxTerm;
  });
  if (tooLong.length > 0) {
    return {
      code: `${team}:assignment-exception-term`,
      label: `${team} assignment exception term`,
      status: "fail",
      detail: `${team} cannot acquire ${tooLong.map((asset) => asset.label).join(", ")} with ${salaryMatch.rule}; remaining term exceeds ${maxTerm} seasons.`
    };
  }

  const unknownTerm = coveredPlayers.filter((asset) => finiteNumber(asset.contractSeasonsRemaining) === null);
  return {
    code: `${team}:assignment-exception-term`,
    label: `${team} assignment exception term`,
    status: unknownTerm.length > 0 ? "warn" : "pass",
    detail: unknownTerm.length > 0
      ? `${team} uses ${salaryMatch.rule}; contract term is not modeled for ${unknownTerm.map((asset) => asset.label).join(", ")}.`
      : `${team} uses ${salaryMatch.rule} and all modeled acquired contracts fit the ${maxTerm}-season remaining-term limit.`
  };
}

function minimumSalaryExceptionTermCheck(team: string, incomingPlayers: TradeMachineAsset[]): TradeMachineRuleCheck {
  const candidates = incomingPlayers.filter((asset) => asset.kind === "player" && asset.isMinimumSalary && !asset.tradeBonus);
  if (candidates.length === 0) {
    return {
      code: `${team}:minimum-exception-term`,
      label: `${team} minimum exception term`,
      status: "pass",
      detail: `${team} has no incoming player modeled for the Minimum Player Salary Exception.`
    };
  }

  const tooLong = candidates.filter((asset) => {
    const term = finiteNumber(asset.contractSeasonsRemaining);
    return term !== null && term > 2;
  });
  if (tooLong.length > 0) {
    return {
      code: `${team}:minimum-exception-term`,
      label: `${team} minimum exception term`,
      status: "fail",
      detail: `${team} cannot use the Minimum Player Salary Exception for ${tooLong.map((asset) => asset.label).join(", ")} because the modeled remaining term exceeds two seasons.`
    };
  }

  const unknownTerm = candidates.filter((asset) => finiteNumber(asset.contractSeasonsRemaining) === null);
  return {
    code: `${team}:minimum-exception-term`,
    label: `${team} minimum exception term`,
    status: unknownTerm.length > 0 ? "warn" : "pass",
    detail: unknownTerm.length > 0
      ? `${team} uses the Minimum Player Salary Exception for ${unknownTerm.map((asset) => asset.label).join(", ")}, but remaining contract term is not modeled.`
      : `${team} uses the Minimum Player Salary Exception only for contracts within the two-season term limit.`
  };
}

function existingTradeExceptionExpiryCheck(team: string, salaryMatch: TradeMachineSalaryMatch, tradeDate: string | null | undefined): TradeMachineRuleCheck {
  if (salaryMatch.exceptionType !== "existing_tpe") {
    return {
      code: `${team}:existing-tpe-expiry`,
      label: `${team} existing TPE expiry`,
      status: "pass",
      detail: `${team} does not use an existing traded-player exception.`
    };
  }

  const name = salaryMatch.existingTradeExceptionName ?? "existing traded-player exception";
  const date = parseDate(tradeDate);
  const expires = parseDate(salaryMatch.existingTradeExceptionExpires);
  if (!date) {
    return {
      code: `${team}:existing-tpe-expiry`,
      label: `${team} existing TPE expiry`,
      status: "warn",
      detail: `${team} uses ${name}; model a trade date to confirm the exception has not expired.`
    };
  }
  if (!expires) {
    return {
      code: `${team}:existing-tpe-expiry`,
      label: `${team} existing TPE expiry`,
      status: "warn",
      detail: `${team} uses ${name}, but the exception expiry date is not modeled.`
    };
  }
  if (date > expires) {
    return {
      code: `${team}:existing-tpe-expiry`,
      label: `${team} existing TPE expiry`,
      status: "fail",
      detail: `${team} uses ${name} after its ${dateIsoLabel(expires)} expiration.`
    };
  }
  return {
    code: `${team}:existing-tpe-expiry`,
    label: `${team} existing TPE expiry`,
    status: "pass",
    detail: `${team} uses ${name} before its ${dateIsoLabel(expires)} expiration.`
  };
}

function disabledPlayerExceptionExpiryCheck(team: string, salaryMatch: TradeMachineSalaryMatch, tradeDate: string | null | undefined): TradeMachineRuleCheck {
  if (salaryMatch.exceptionType !== "disabled_player") {
    return {
      code: `${team}:disabled-player-exception-expiry`,
      label: `${team} Disabled Player Exception expiry`,
      status: "pass",
      detail: `${team} is not using a Disabled Player Exception.`
    };
  }

  const name = salaryMatch.disabledPlayerExceptionName ?? "Disabled Player Exception";
  const expires = parseDate(salaryMatch.disabledPlayerExceptionExpires);
  if (!expires) {
    return {
      code: `${team}:disabled-player-exception-expiry`,
      label: `${team} Disabled Player Exception expiry`,
      status: "warn",
      detail: `${team} uses ${name}, but the DPE expiration date is not modeled.`
    };
  }

  const date = parseDate(tradeDate);
  if (!date) {
    return {
      code: `${team}:disabled-player-exception-expiry`,
      label: `${team} Disabled Player Exception expiry`,
      status: "warn",
      detail: `${team} uses ${name}; model a trade date to confirm it falls before the ${dateIsoLabel(expires)} expiration.`
    };
  }

  if (date.getTime() > expires.getTime()) {
    return {
      code: `${team}:disabled-player-exception-expiry`,
      label: `${team} Disabled Player Exception expiry`,
      status: "fail",
      detail: `${team} uses ${name} after its ${dateIsoLabel(expires)} expiration.`
    };
  }

  return {
    code: `${team}:disabled-player-exception-expiry`,
    label: `${team} Disabled Player Exception expiry`,
    status: "pass",
    detail: `${team} uses ${name} before its ${dateIsoLabel(expires)} expiration.`
  };
}

function firstApronCheck(
  team: string,
  beforeSalary: number,
  afterSalary: number,
  outgoingSalaryForMatch: number,
  salaryMatch: TradeMachineSalaryMatch,
  season: CapTrackerSeason
): TradeMachineRuleCheck {
  const constrained = beforeSalary > season.first_apron || afterSalary > season.first_apron;
  if (!constrained) {
    return {
      code: `${team}:first-apron`,
      label: `${team} first-apron trade limit`,
      status: "pass",
      detail: `${team} is not above the first apron after the trade.`
    };
  }
  if (salaryMatch.exceptionType === "transition" && isTransitionTpeSeason(season) && salaryMatch.incomingSalaryForMatching <= salaryMatch.maxIncomingSalary) {
    return {
      code: `${team}:first-apron`,
      label: `${team} first-apron trade limit`,
      status: "pass",
      detail: `${team} uses the 2023-24 Transition TPE salary-return rule rather than the ordinary 100% first-apron limit.`
    };
  }
  const legal = salaryMatch.incomingSalaryForMatching <= outgoingSalaryForMatch;
  return {
    code: `${team}:first-apron`,
    label: `${team} first-apron trade limit`,
    status: legal ? "pass" : "fail",
    detail: legal
      ? `${team} is first-apron constrained and does not take back more salary than it sends.`
      : `${team} is first-apron constrained and takes back ${moneyLabel(salaryMatch.incomingSalaryForMatching - outgoingSalaryForMatch)} more matching salary than outgoing matching salary.`
  };
}

type TransactionApronRestriction = {
  label: string;
  apron: "first_apron" | "second_apron";
  row?: "A" | "B" | "C" | "E" | "F" | "G" | "H" | "I" | "J";
  uncertain?: boolean;
  currentYearGrace?: boolean;
};

function transactionApronRestrictionCheck(
  context: TradeMachineTeamContext,
  afterSalary: number,
  subsequentYearApronSalaryAfter: number | null,
  salaryMatch: TradeMachineSalaryMatch,
  incomingPlayers: TradeMachineAsset[],
  outgoing: TradeMachineAsset[],
  timing: TradeMachineTimingInput,
  season: CapTrackerSeason
): TradeMachineRuleCheck {
  const team = context.team;
  const restrictions: TransactionApronRestriction[] = [];
  if (salaryMatch.exceptionType === "bi_annual") restrictions.push({ label: "Bi-annual Exception assignment", apron: "first_apron", row: "A" });
  if (salaryMatch.exceptionType === "non_taxpayer_mle") restrictions.push({ label: "Non-Taxpayer MLE assignment", apron: "first_apron", row: "B" });
  if (salaryMatch.exceptionType === "expanded") restrictions.push({ label: "Expanded TPE", apron: "first_apron", row: "E" });
  if (salaryMatch.exceptionType === "aggregated_standard") restrictions.push({ label: "Aggregated Standard TPE", apron: "second_apron", row: "H" });
  if (salaryMatch.exceptionType === "transition") restrictions.push({ label: "Transition TPE", apron: "first_apron", row: "G", currentYearGrace: isTransitionTpeSeason(season) });
  if (incomingPlayers.some((asset) => asset.signedAndTraded)) restrictions.push({ label: "sign-and-trade acquisition", apron: "first_apron", row: "C" });
  if (cashAmount(outgoing) > 0) restrictions.push({ label: "cash in trade", apron: "second_apron", row: "I" });
  if (salaryMatch.exceptionType === "existing_tpe") {
    if (salaryMatch.existingTradeExceptionFirstApronRestrictionApplies === true) {
      restrictions.push({ label: "existing TPE after row-F timing", apron: "first_apron", row: "F" });
    } else if (salaryMatch.existingTradeExceptionFirstApronRestrictionApplies !== false) {
      restrictions.push({ label: "existing TPE row-F timing", apron: "first_apron", row: "F", uncertain: true });
    }
    if (salaryMatch.existingTradeExceptionSignedAndTradedContract === true) {
      restrictions.push({ label: "TPE tied to a signed-and-traded contract", apron: "second_apron", row: "J" });
    }
  }
  if (restrictions.length === 0) {
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "pass",
      detail: `${team} has no modeled transaction that adds a first- or second-apron hard-cap trigger.`
    };
  }

  const taxpayerMleBlocked = context.usedTaxpayerMidLevelThisYear
    ? restrictions.filter((restriction) => taxpayerMidLevelBlocksRestriction(restriction, season))
    : [];
  const knownTaxpayerMleBlocked = taxpayerMleBlocked.filter((restriction) => !restriction.uncertain);
  const uncertainTaxpayerMleBlocked = taxpayerMleBlocked.filter((restriction) => restriction.uncertain);
  if (knownTaxpayerMleBlocked.length > 0) {
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "fail",
      detail: `${team} previously used the Taxpayer MLE this salary-cap year and cannot now use ${knownTaxpayerMleBlocked.map((item) => item.label).join(", ")} under the transaction restriction table.`
    };
  }
  if (uncertainTaxpayerMleBlocked.length > 0) {
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "warn",
      detail: `${team} previously used the Taxpayer MLE this salary-cap year; ${uncertainTaxpayerMleBlocked.map((item) => item.label).join(", ")} may be barred if the row-F timing applies.`
    };
  }

  if (timing.isPostRegularSeasonToJune30Window) {
    const subsequentYearRestrictions = restrictions.filter(subsequentYearApronRestrictionApplies);
    const certainSubsequentYearRestrictions = subsequentYearRestrictions.filter((restriction) => !restriction.uncertain);
    if (certainSubsequentYearRestrictions.length > 0) {
      if (subsequentYearApronSalaryAfter === null) {
        return {
          code: `${team}:transaction-apron-restriction`,
          label: `${team} transaction apron trigger`,
          status: "warn",
          detail: `${team} uses ${certainSubsequentYearRestrictions.map((item) => item.label).join(", ")} after the regular season; subsequent-year apron salary is required for rows E-J but is not modeled.`
        };
      }
      const subsequentFailures = certainSubsequentYearRestrictions.filter((restriction) => subsequentYearApronSalaryAfter > apronLimit(restriction.apron, season));
      if (subsequentFailures.length > 0) {
        const restriction = strongestApronRestriction(subsequentFailures);
        return {
          code: `${team}:transaction-apron-restriction`,
          label: `${team} transaction apron trigger`,
          status: "fail",
          detail: `${team} uses ${subsequentFailures.map((item) => item.label).join(", ")} after the regular season and would exceed the subsequent-year ${apronRestrictionLabel(restriction.apron)} by ${moneyLabel(subsequentYearApronSalaryAfter - apronLimit(restriction.apron, season))}.`
        };
      }
    }
  }

  const failures = restrictions.filter((restriction) => afterSalary > apronLimit(restriction.apron, season));
  const uncertainFailures = failures.filter((restriction) => restriction.uncertain);
  const graceFailures = failures.filter((restriction) => restriction.currentYearGrace);
  const hardFailures = failures.filter((restriction) => !restriction.uncertain && !restriction.currentYearGrace);
  if (hardFailures.length > 0) {
    const restriction = strongestApronRestriction(hardFailures);
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "fail",
      detail: `${team} uses ${hardFailures.map((item) => item.label).join(", ")} and would exceed the ${apronRestrictionLabel(restriction.apron)} by ${moneyLabel(afterSalary - apronLimit(restriction.apron, season))}.`
    };
  }
  if (uncertainFailures.length > 0) {
    const restriction = strongestApronRestriction(uncertainFailures);
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "warn",
      detail: `${team} uses ${uncertainFailures.map((item) => item.label).join(", ")} while above the ${apronRestrictionLabel(restriction.apron)}; source data must confirm the TPE timing before treating this as clear.`
    };
  }
  if (graceFailures.length > 0) {
    const restriction = strongestApronRestriction(graceFailures);
    return {
      code: `${team}:transaction-apron-restriction`,
      label: `${team} transaction apron trigger`,
      status: "warn",
      detail: `${team} uses ${graceFailures.map((item) => item.label).join(", ")} above the ${apronRestrictionLabel(restriction.apron)}. The 2023-24 transition rule does not by itself prohibit the current-year apron overage, but subsequent-year apron salary is not modeled.`
    };
  }

  const restriction = strongestApronRestriction(restrictions);
  const uncertainRestrictions = restrictions.filter((item) => item.uncertain);
  return {
    code: `${team}:transaction-apron-restriction`,
    label: `${team} transaction apron trigger`,
    status: uncertainRestrictions.length > 0 ? "warn" : "pass",
    detail: uncertainRestrictions.length > 0
      ? `${team} uses ${uncertainRestrictions.map((item) => item.label).join(", ")}; modeled salary remains below the ${apronRestrictionLabel(strongestApronRestriction(uncertainRestrictions).apron)}, but TPE timing still needs source confirmation.`
      : `${team} uses ${restrictions.map((item) => item.label).join(", ")} and remains below the ${apronRestrictionLabel(restriction.apron)}.`
  };
}

function signAndTradeCheck(team: string, afterSalary: number, incomingPlayers: TradeMachineAsset[], season: CapTrackerSeason): TradeMachineRuleCheck {
  const signedAndTraded = incomingPlayers.filter((asset) => asset.signedAndTraded);
  if (signedAndTraded.length === 0) {
    return {
      code: `${team}:sign-and-trade`,
      label: `${team} sign-and-trade`,
      status: "pass",
      detail: `${team} acquires no signed-and-traded player.`
    };
  }

  const violations: string[] = [];
  for (const asset of signedAndTraded) {
    const years = finiteNumber(asset.signAndTradeContractYears);
    if (years !== null && (years < 3 || years > 4)) violations.push(`${asset.label} contract length must be 3-4 seasons`);
    if (asset.signAndTradeFirstSeasonProtected === false) violations.push(`${asset.label} first season must be fully protected`);
    if (asset.signAndTradeUsedProhibitedException) violations.push(`${asset.label} cannot be signed with the non-taxpayer MLE or room MLE for S&T`);
    if (asset.signAndTradeFinishedPriorSeasonWithTeam === false) violations.push(`${asset.label} did not finish the prior season with the sign-and-trade team`);
    if (asset.signAndTradeBeforeRegularSeason === false) violations.push(`${asset.label} S&T must be completed before the regular season`);
  }
  if (afterSalary > season.first_apron) {
    violations.push(`${team} would exceed the first apron after acquiring a signed-and-traded player`);
  }

  if (violations.length > 0) {
    return {
      code: `${team}:sign-and-trade`,
      label: `${team} sign-and-trade`,
      status: "fail",
      detail: violations.join("; ") + "."
    };
  }

  const missingContractFacts = signedAndTraded.some((asset) =>
    asset.signAndTradeContractYears === undefined ||
    asset.signAndTradeFirstSeasonProtected === undefined ||
    asset.signAndTradeUsedProhibitedException === undefined ||
    asset.signAndTradeFinishedPriorSeasonWithTeam === undefined ||
    asset.signAndTradeBeforeRegularSeason === undefined
  );
  return {
    code: `${team}:sign-and-trade`,
    label: `${team} sign-and-trade`,
    status: missingContractFacts ? "warn" : "pass",
    detail: missingContractFacts
      ? `${team} stays below the first apron, but one or more S&T contract facts are not modeled.`
      : `${team} stays below the first apron and the modeled S&T contract facts pass.`
  };
}

function secondApronAggregationCheck(team: string, beforeSalary: number, afterSalary: number, outgoingPlayers: TradeMachineAsset[], season: CapTrackerSeason): TradeMachineRuleCheck {
  const constrained = beforeSalary > season.second_apron || afterSalary > season.second_apron;
  if (!constrained) {
    return {
      code: `${team}:second-apron-aggregation`,
      label: `${team} second-apron aggregation`,
      status: "pass",
      detail: `${team} is not second-apron constrained.`
    };
  }
  const aggregated = outgoingPlayers.filter((asset) => aggregationCountingPlayer(asset, season)).length > 1;
  return {
    code: `${team}:second-apron-aggregation`,
    label: `${team} second-apron aggregation`,
    status: aggregated ? "fail" : "pass",
    detail: aggregated
      ? `${team} is above the second apron and aggregates multiple outgoing player salaries.`
      : `${team} is above the second apron and is not aggregating multiple outgoing player salaries.`
  };
}

function secondApronCashCheck(team: string, beforeSalary: number, afterSalary: number, outgoing: TradeMachineAsset[], season: CapTrackerSeason): TradeMachineRuleCheck {
  const constrained = beforeSalary > season.second_apron || afterSalary > season.second_apron;
  const sendsCash = cashAmount(outgoing) > 0;
  if (!constrained || !sendsCash) {
    return {
      code: `${team}:second-apron-cash`,
      label: `${team} second-apron cash`,
      status: "pass",
      detail: constrained ? `${team} sends no cash while second-apron constrained.` : `${team} is not second-apron constrained.`
    };
  }
  return {
    code: `${team}:second-apron-cash`,
    label: `${team} second-apron cash`,
    status: "fail",
    detail: `${team} is above the second apron and sends cash.`
  };
}

function cashLimitCheck(team: string, context: TradeMachineTeamContext, outgoing: TradeMachineAsset[], incoming: TradeMachineAsset[], season: CapTrackerSeason): TradeMachineRuleCheck {
  const limit = season.salary_cap * 0.0515;
  const cashPaid = cashAmount(outgoing);
  const cashReceived = cashAmount(incoming);
  const paidTotal = money(context.cashPaidThisYear) + cashPaid;
  const receivedTotal = money(context.cashReceivedThisYear) + cashReceived;
  const violations: string[] = [];
  if (paidTotal > limit) violations.push(`paid cash would reach ${moneyLabel(paidTotal)} against a ${moneyLabel(limit)} annual limit`);
  if (receivedTotal > limit) violations.push(`received cash would reach ${moneyLabel(receivedTotal)} against a ${moneyLabel(limit)} annual limit`);
  if (violations.length > 0) {
    return {
      code: `${team}:cash-limit`,
      label: `${team} annual cash limit`,
      status: "fail",
      detail: `${team} ${violations.join(" and ")}.`
    };
  }
  return {
    code: `${team}:cash-limit`,
    label: `${team} annual cash limit`,
    status: "pass",
    detail: `${team} cash paid (${moneyLabel(paidTotal)}) and received (${moneyLabel(receivedTotal)}) are each within the ${moneyLabel(limit)} annual limit.`
  };
}

function aggregationEligibilityCheck(team: string, outgoingPlayers: TradeMachineAsset[], salaryMatch: TradeMachineSalaryMatch, season: CapTrackerSeason): TradeMachineRuleCheck {
  const aggregationPlayers = outgoingPlayers.filter((asset) => aggregationCountingPlayer(asset, season));
  const aggregatingUnderTpe = isAggregatingTradeExceptionType(salaryMatch.exceptionType) && aggregationPlayers.length > 1;
  if (!aggregatingUnderTpe) {
    return {
      code: `${team}:aggregation-eligibility`,
      label: `${team} aggregation eligibility`,
      status: "pass",
      detail: `${team} is not aggregating multiple outgoing player salaries.`
    };
  }

  const blocked = aggregationPlayers.filter((asset) => asset.aggregationEligible === false);
  if (blocked.length === 0) {
    return {
      code: `${team}:aggregation-eligibility`,
      label: `${team} aggregation eligibility`,
      status: "pass",
      detail: `${team} aggregates only players modeled as aggregation-eligible.`
    };
  }

  return {
    code: `${team}:aggregation-eligibility`,
    label: `${team} aggregation eligibility`,
    status: "fail",
    detail: `${team} cannot aggregate ${blocked.map((asset) => asset.label).join(", ")} because the player is modeled as not aggregation-eligible.`
  };
}

function recentTradeAggregationCheck(
  team: string,
  outgoingPlayers: TradeMachineAsset[],
  tradeDate: string | null | undefined,
  tradeDeadlineDate: string | null | undefined,
  salaryMatch: TradeMachineSalaryMatch,
  season: CapTrackerSeason
): TradeMachineRuleCheck {
  const aggregatingUnderTpe = isAggregatingTradeExceptionType(salaryMatch.exceptionType) && outgoingPlayers.filter((asset) => aggregationCountingPlayer(asset, season)).length > 1;
  if (!aggregatingUnderTpe) {
    return {
      code: `${team}:recent-trade-aggregation`,
      label: `${team} recent trade aggregation`,
      status: "pass",
      detail: `${team} is not aggregating multiple outgoing contracts under a traded-player exception.`
    };
  }

  const candidates = outgoingPlayers.filter((asset) =>
    asset.acquiredByTradeDate ||
    asset.acquiredViaExceptionDate ||
    asset.acquiredByTradeDateUnknown
  );
  if (candidates.length === 0) {
    return {
      code: `${team}:recent-trade-aggregation`,
      label: `${team} recent trade aggregation`,
      status: "pass",
      detail: `${team} has no modeled outgoing player recently acquired by trade or exception.`
    };
  }

  const date = parseDate(tradeDate);
  if (!date) {
    return {
      code: `${team}:recent-trade-aggregation`,
      label: `${team} recent trade aggregation`,
      status: "warn",
      detail: `${team} aggregates ${candidates.map(recentTradeAcquisitionLabel).join(", ")}, but no trade date is modeled for the two-month aggregation clock.`
    };
  }

  const deadline = parseDate(tradeDeadlineDate);
  const blocked: Array<{ asset: TradeMachineAsset; until: Date }> = [];
  const unknown: TradeMachineAsset[] = [];
  for (const asset of candidates) {
    const acquired = parseDate(asset.acquiredByTradeDate ?? asset.acquiredViaExceptionDate);
    if (!acquired) {
      unknown.push(asset);
      continue;
    }
    const until = addMonths(acquired, 2);
    if (date >= until || recentTradeAggregationDeadlineReleaseApplies(acquired, date, deadline, season)) continue;
    if (recentTradeAggregationReleaseCouldApply(acquired, date, deadline, season)) {
      unknown.push(asset);
      continue;
    }
    blocked.push({ asset, until });
  }

  if (blocked.length > 0) {
    return {
      code: `${team}:recent-trade-aggregation`,
      label: `${team} recent trade aggregation`,
      status: "fail",
      detail: `${blocked.map(({ asset, until }) => `${asset.label} before ${dateIsoLabel(until)}`).join(", ")} cannot be aggregated within two months of being acquired by trade/exception.`
    };
  }

  if (unknown.length > 0) {
    return {
      code: `${team}:recent-trade-aggregation`,
      label: `${team} recent trade aggregation`,
      status: "warn",
      detail: `${unknown.map(recentTradeAcquisitionLabel).join(", ")} needs acquisition-date or deadline confirmation for the two-month aggregation clock.`
    };
  }

  return {
    code: `${team}:recent-trade-aggregation`,
    label: `${team} recent trade aggregation`,
    status: "pass",
    detail: `${team} has no outgoing player inside a modeled two-month trade-acquisition aggregation window.`
  };
}

function recentTradeAggregationDeadlineReleaseApplies(acquired: Date, tradeDate: Date, tradeDeadlineDate: Date | null, season: CapTrackerSeason): boolean {
  if (!tradeDeadlineDate) return false;
  const dec16 = dateForSeason(season.year - 1, 12, 16);
  return acquired.getTime() <= dec16.getTime() && tradeDate.getTime() >= addDays(tradeDeadlineDate, -1).getTime();
}

function recentTradeAggregationReleaseCouldApply(acquired: Date, tradeDate: Date, tradeDeadlineDate: Date | null, season: CapTrackerSeason): boolean {
  if (tradeDeadlineDate) return false;
  const dec16 = dateForSeason(season.year - 1, 12, 16);
  return acquired.getTime() <= dec16.getTime() && tradeDate.getTime() < addMonths(acquired, 2).getTime();
}

function recentTradeAcquisitionLabel(asset: TradeMachineAsset): string {
  const source = asset.acquiredByTradeSource ? ` via ${asset.acquiredByTradeSource}` : "";
  const acquired = asset.acquiredByTradeDate ?? asset.acquiredViaExceptionDate;
  return acquired ? `${asset.label}${source} on ${acquired}` : `${asset.label}${source}`;
}

function minimumAggregationCheck(team: string, outgoingPlayers: TradeMachineAsset[], incomingPlayers: TradeMachineAsset[], isDec15ToTradeDeadlineWindow: boolean | undefined): TradeMachineRuleCheck {
  const minimumPlayers = outgoingPlayers.filter((asset) => asset.isMinimumSalary).length;
  const pattern = outgoingPlayers.length >= 3 && incomingPlayers.length < outgoingPlayers.length;
  if (!pattern || minimumPlayers <= 1) {
    return {
      code: `${team}:minimum-aggregation`,
      label: `${team} minimum-player aggregation`,
      status: "pass",
      detail: pattern
        ? `${team} includes no more than one minimum-salary player in a 3-for-fewer aggregation.`
        : `${team} is outside the minimum-player aggregation restriction pattern.`
    };
  }
  if (isDec15ToTradeDeadlineWindow === undefined) {
    return {
      code: `${team}:minimum-aggregation`,
      label: `${team} minimum-player aggregation`,
      status: "warn",
      detail: `${team} aggregates ${minimumPlayers} minimum-salary players in a 3-for-fewer trade; trade date and trade deadline are needed to determine the Dec. 15-to-deadline exception.`
    };
  }
  if (isDec15ToTradeDeadlineWindow) {
    return {
      code: `${team}:minimum-aggregation`,
      label: `${team} minimum-player aggregation`,
      status: "pass",
      detail: `${team} is inside the Dec. 15-to-deadline window for minimum-player aggregation.`
    };
  }
  return {
    code: `${team}:minimum-aggregation`,
    label: `${team} minimum-player aggregation`,
    status: "fail",
    detail: `${team} aggregates ${minimumPlayers} minimum-salary players in a 3-for-fewer trade outside the Dec. 15-to-deadline window.`
  };
}

function tradeDeadlineContractCheck(
  team: string,
  outgoingPlayers: TradeMachineAsset[],
  tradeDate: string | null | undefined,
  tradeDeadlineDate: string | null | undefined
): TradeMachineRuleCheck {
  const deadlineRestricted = outgoingPlayers.filter((asset) => asset.couldBeLastContractSeason);
  if (deadlineRestricted.length === 0) {
    return {
      code: `${team}:trade-deadline-contract`,
      label: `${team} post-deadline contract status`,
      status: "pass",
      detail: `${team} has no modeled outgoing player in a contract season that could be his last.`
    };
  }

  const date = parseDate(tradeDate);
  const deadline = parseDate(tradeDeadlineDate);
  if (!date || !deadline) {
    return {
      code: `${team}:trade-deadline-contract`,
      label: `${team} post-deadline contract status`,
      status: "warn",
      detail: `${deadlineRestricted.map(contractSeasonLabel).join(", ")} cannot be traded after the trade deadline; model both trade date and deadline to confirm.`
    };
  }

  if (date > deadline) {
    return {
      code: `${team}:trade-deadline-contract`,
      label: `${team} post-deadline contract status`,
      status: "fail",
      detail: `${deadlineRestricted.map(contractSeasonLabel).join(", ")} cannot be traded after the ${dateIsoLabel(deadline)} trade deadline.`
    };
  }

  return {
    code: `${team}:trade-deadline-contract`,
    label: `${team} post-deadline contract status`,
    status: "pass",
    detail: `${team} is trading before the deadline, so modeled final-season/option-season contract limits clear.`
  };
}

function signingMoratoriumCheck(
  team: string,
  outgoingPlayers: TradeMachineAsset[],
  tradeDate: string | null | undefined,
  season: CapTrackerSeason
): TradeMachineRuleCheck {
  const restricted = outgoingPlayers.filter((asset) =>
    !asset.signedAndTraded &&
    (asset.signingTradeRestrictionType || asset.signingTradeRestrictionSignedDate || asset.signingTradeRestrictionUntil)
  );
  if (restricted.length === 0) {
    return {
      code: `${team}:signing-moratorium`,
      label: `${team} signing trade moratorium`,
      status: "pass",
      detail: `${team} has no modeled outgoing player inside a post-signing trade moratorium.`
    };
  }

  const date = parseDate(tradeDate);
  if (!date) {
    return {
      code: `${team}:signing-moratorium`,
      label: `${team} signing trade moratorium`,
      status: "warn",
      detail: `${restricted.map(signingMoratoriumLabel).join(", ")} may be subject to a post-signing trade moratorium; model a trade date to confirm.`
    };
  }

  const unknown: TradeMachineAsset[] = [];
  const blocked: Array<{ asset: TradeMachineAsset; until: Date }> = [];
  for (const asset of restricted) {
    const until = signingMoratoriumUntil(asset, season);
    if (!until) {
      unknown.push(asset);
      continue;
    }
    if (date < until) blocked.push({ asset, until });
  }

  if (blocked.length > 0) {
    return {
      code: `${team}:signing-moratorium`,
      label: `${team} signing trade moratorium`,
      status: "fail",
      detail: `${blocked.map(({ asset, until }) => `${signingMoratoriumLabel(asset)} cannot be traded before ${dateIsoLabel(until)}`).join(", ")}.`
    };
  }

  if (unknown.length > 0) {
    return {
      code: `${team}:signing-moratorium`,
      label: `${team} signing trade moratorium`,
      status: "warn",
      detail: `${unknown.map(signingMoratoriumLabel).join(", ")} has incomplete signing-moratorium dates; verify before treating the trade as CBA-clean.`
    };
  }

  return {
    code: `${team}:signing-moratorium`,
    label: `${team} signing trade moratorium`,
    status: "pass",
    detail: `${team} clears modeled post-signing trade moratorium windows.`
  };
}

function tradeRestrictionDateCheck(team: string, outgoingPlayers: TradeMachineAsset[], tradeDate: string | null | undefined): TradeMachineRuleCheck {
  const restricted = outgoingPlayers.filter((asset) => {
    if (!asset.tradeRestrictionUntil && !asset.tradeRestrictionDestinationTeam) return false;
    const restrictedDestination = normalizeTeam(asset.tradeRestrictionDestinationTeam);
    const destination = normalizeTeam(asset.toTeam);
    return !restrictedDestination || !destination || restrictedDestination === destination;
  });
  if (restricted.length === 0) {
    return {
      code: `${team}:trade-date-restriction`,
      label: `${team} trade-date restrictions`,
      status: "pass",
      detail: `${team} has no modeled date- or destination-restricted outgoing player for the routed destinations.`
    };
  }
  const date = parseDate(tradeDate);
  const permanentDestinationBlocks = restricted.filter((asset) => asset.tradeRestrictionDestinationTeam && !asset.tradeRestrictionUntil);
  if (permanentDestinationBlocks.length > 0) {
    return {
      code: `${team}:trade-date-restriction`,
      label: `${team} trade-date restrictions`,
      status: "fail",
      detail: `${permanentDestinationBlocks.map((asset) => `${asset.label} cannot be traded to ${asset.tradeRestrictionDestinationTeam}`).join(", ")}.`
    };
  }
  if (!date) {
    return {
      code: `${team}:trade-date-restriction`,
      label: `${team} trade-date restrictions`,
      status: "warn",
      detail: `${team} has date- or destination-restricted outgoing player(s), but no trade date is modeled.`
    };
  }
  const blocked = restricted.filter((asset) => {
    const until = parseDate(asset.tradeRestrictionUntil);
    return until ? date < until : false;
  });
  if (blocked.length > 0) {
    return {
      code: `${team}:trade-date-restriction`,
      label: `${team} trade-date restrictions`,
      status: "fail",
      detail: `${blocked.map((asset) => {
        const destinationDetail = asset.toTeam ? ` to ${asset.toTeam}` : asset.tradeRestrictionDestinationTeam ? ` to ${asset.tradeRestrictionDestinationTeam}` : "";
        return `${asset.label}${destinationDetail} until ${asset.tradeRestrictionUntil}`;
      }).join(", ")}.`
    };
  }
  return {
    code: `${team}:trade-date-restriction`,
    label: `${team} trade-date restrictions`,
    status: "pass",
    detail: `${team} clears modeled trade-date and destination restriction windows.`
  };
}

function hardCapCheck(team: string, afterSalary: number, hardCap: TradeMachineTeamContext["hardCap"], season: CapTrackerSeason): TradeMachineRuleCheck {
  if (!hardCap) {
    return {
      code: `${team}:hard-cap`,
      label: `${team} hard cap`,
      status: "pass",
      detail: `${team} has no modeled transaction hard cap.`
    };
  }
  const limit = hardCap === "second_apron" ? season.second_apron : season.first_apron;
  return {
    code: `${team}:hard-cap`,
    label: `${team} hard cap`,
    status: afterSalary <= limit ? "pass" : "fail",
    detail: afterSalary <= limit
      ? `${team} remains below its ${hardCapLabel(hardCap)} hard cap.`
      : `${team} exceeds its ${hardCapLabel(hardCap)} hard cap by ${moneyLabel(afterSalary - limit)}.`
  };
}

function rosterLimitCheck(team: string, rosterAfter: number): TradeMachineRuleCheck {
  if (rosterAfter > 15) {
    return {
      code: `${team}:roster-limit`,
      label: `${team} roster limit`,
      status: "fail",
      detail: `${team} would have ${rosterAfter} standard contracts after the trade.`
    };
  }
  if (rosterAfter < 14) {
    return {
      code: `${team}:roster-limit`,
      label: `${team} roster minimum`,
      status: "warn",
      detail: `${team} would have ${rosterAfter} standard contracts and may need a follow-up signing.`
    };
  }
  return {
    code: `${team}:roster-limit`,
    label: `${team} roster limit`,
    status: "pass",
    detail: `${team} lands at ${rosterAfter} standard contracts.`
  };
}

function noTradeConsentCheck(team: string, outgoingPlayers: TradeMachineAsset[], tradeDate: string | null | undefined): TradeMachineRuleCheck {
  const date = parseDate(tradeDate);
  const blocked: TradeMachineAsset[] = [];
  const unknownTiming: TradeMachineAsset[] = [];
  outgoingPlayers.forEach((asset) => {
    if (!asset.noTradeConsentRequired || asset.noTradeConsentGranted) return;
    if (!asset.noTradeConsentUntil) {
      blocked.push(asset);
      return;
    }
    const until = parseDate(asset.noTradeConsentUntil);
    if (!date || !until) {
      unknownTiming.push(asset);
      return;
    }
    if (date < until) blocked.push(asset);
  });
  if (blocked.length === 0) {
    if (unknownTiming.length > 0) {
      return {
        code: `${team}:no-trade-consent`,
        label: `${team} no-trade consent`,
        status: "warn",
        detail: `${unknownTiming.map((asset) => `${asset.label} through ${asset.noTradeConsentUntil ?? "an unknown date"}`).join(", ")} may require consent; model a trade date to confirm.`
      };
    }
    return {
      code: `${team}:no-trade-consent`,
      label: `${team} no-trade consent`,
      status: "pass",
      detail: `${team} has no unwaived no-trade consent block in the selected assets.`
    };
  }
  return {
    code: `${team}:no-trade-consent`,
    label: `${team} no-trade consent`,
    status: "fail",
    detail: `${blocked.map((asset) => asset.noTradeConsentUntil ? `${asset.label} through ${asset.noTradeConsentUntil}` : asset.label).join(", ")} cannot be traded without consent.`
  };
}

function contractSeasonLabel(asset: TradeMachineAsset): string {
  return asset.lastContractSeasonReason ? `${asset.label} (${asset.lastContractSeasonReason})` : asset.label;
}

function signingMoratoriumUntil(asset: TradeMachineAsset, season: CapTrackerSeason): Date | null {
  const explicit = parseDate(asset.signingTradeRestrictionUntil);
  if (explicit) return explicit;
  const signed = parseDate(asset.signingTradeRestrictionSignedDate);
  if (!signed || !asset.signingTradeRestrictionType) return null;
  if (asset.signingTradeRestrictionType === "draft_rookie_or_two_way") return addDays(signed, 30);
  const threeMonths = addMonths(signed, 3);
  if (asset.signingTradeRestrictionType === "bird_raise") {
    return laterDate(threeMonths, dateForSeason(season.year, 1, 15));
  }
  return laterDate(threeMonths, dateForSeason(season.year - 1, 12, 15));
}

function signingMoratoriumLabel(asset: TradeMachineAsset): string {
  const reason = asset.signingTradeRestrictionReason || signingRestrictionTypeLabel(asset.signingTradeRestrictionType);
  return reason ? `${asset.label} (${reason})` : asset.label;
}

function signingRestrictionTypeLabel(type: SigningTradeRestrictionType | null | undefined): string {
  if (type === "draft_rookie_or_two_way") return "30-day rookie/Two-Way signing restriction";
  if (type === "free_agent") return "three-month/Dec. 15 free-agent signing restriction";
  if (type === "bird_raise") return "three-month/Jan. 15 Bird-rights signing restriction";
  return "";
}

function bycDisclosureCheck(team: string, outgoingPlayers: TradeMachineAsset[], season: CapTrackerSeason, timing: TradeMachineTimingInput): TradeMachineRuleCheck {
  const bycPlayers = outgoingPlayers.filter((asset) => asset.baseYearCompensation?.applies);
  if (bycPlayers.length === 0) {
    return {
      code: `${team}:byc`,
      label: `${team} BYC treatment`,
      status: "pass",
      detail: `${team} has no selected BYC outgoing player.`
    };
  }
  return {
    code: `${team}:byc`,
    label: `${team} BYC treatment`,
    status: "warn",
    detail: bycPlayers
      .map((asset) => `${asset.label} counts as ${moneyLabel(outgoingSalaryForMatching(asset, season, timing))} outgoing for matching and ${moneyLabel(tradeSalaryForAsset(asset, season))} incoming for the receiver.`)
      .join(" ")
  };
}

function salaryProtectionDisclosureCheck(team: string, outgoingPlayers: TradeMachineAsset[], season: CapTrackerSeason, timing: TradeMachineTimingInput): TradeMachineRuleCheck {
  const reduced = outgoingPlayers.filter((asset) => salaryProtectionAdjustedOutgoingSalary(asset, season, timing) + 1 < tradeSalaryForAsset(asset, season));
  if (reduced.length === 0) {
    return {
      code: `${team}:salary-protection`,
      label: `${team} protected compensation`,
      status: "pass",
      detail: `${team} has no modeled outgoing player whose matching salary is reduced by unprotected base compensation.`
    };
  }
  return {
    code: `${team}:salary-protection`,
    label: `${team} protected compensation`,
    status: "warn",
    detail: reduced
      .map((asset) => `${asset.label} counts as ${moneyLabel(salaryProtectionAdjustedOutgoingSalary(asset, season, timing))} for matching against ${moneyLabel(tradeSalaryForAsset(asset, season))} contract salary.`)
      .join(" ")
  };
}

function tpeCreationEligibilityCheck(team: string, outgoingPlayers: TradeMachineAsset[], tradeExceptionCreated: number): TradeMachineRuleCheck {
  const excluded = outgoingPlayers.filter((asset) => asset.disabledPlayerExceptionUsed || asset.isTwoWay);
  if (excluded.length === 0) {
    return {
      code: `${team}:tpe-creation-eligibility`,
      label: `${team} TPE creation eligibility`,
      status: "pass",
      detail: `${team} has no modeled outgoing player excluded from creating a traded-player exception.`
    };
  }
  return {
    code: `${team}:tpe-creation-eligibility`,
    label: `${team} TPE creation eligibility`,
    status: "warn",
    detail: `${excluded.map((asset) => asset.label).join(", ")} cannot create a TPE because the player is modeled as ${excluded.length === 1 && excluded[0].isTwoWay ? "a Two-Way player" : "DPE/Two-Way excluded"}; modeled TPE created is ${moneyLabel(tradeExceptionCreated)}.`
  };
}

function tradeBonusCheck(team: string, incomingPlayers: TradeMachineAsset[], incomingBonus: number, season: CapTrackerSeason): TradeMachineRuleCheck {
  const bonusPlayers = incomingPlayers.filter((asset) => asset.tradeBonus && !asset.tradeBonus.waived && !asset.tradeBonus.previouslyEarned && !asset.signedAndTraded);
  if (bonusPlayers.length === 0) {
    return {
      code: `${team}:trade-bonus`,
      label: `${team} trade bonus`,
      status: "pass",
      detail: `${team} acquires no player with a modeled payable trade bonus.`
    };
  }
  const missingFacts = bonusPlayers.filter((asset) => !finiteNumber(asset.tradeBonus?.percent) && !finiteNumber(asset.tradeBonus?.amount));
  const details = bonusPlayers.map((asset) => {
    const gross = grossTradeBonusAmount(asset);
    const payable = tradeBonusAmount(asset, season);
    const reduced = gross > payable + 1;
    return `${asset.label}: ${moneyLabel(payable)}${reduced ? ` after max-salary reduction from ${moneyLabel(gross)}` : ""}`;
  });
  return {
    code: `${team}:trade-bonus`,
    label: `${team} trade bonus`,
    status: missingFacts.length > 0 ? "warn" : "pass",
    detail: `${team} adds ${moneyLabel(incomingBonus)} in modeled current trade bonus salary. ${details.join("; ")}.`
  };
}

function draftPickSpecificityCheck(team: string, outgoing: TradeMachineAsset[]): TradeMachineRuleCheck {
  const firsts = outgoing.filter((asset) => asset.kind === "pick" && asset.round === 1);
  if (firsts.length === 0) {
    return {
      code: `${team}:pick-specificity`,
      label: `${team} pick terms`,
      status: "pass",
      detail: `${team} sends no first-round pick terms needing protection review.`
    };
  }

  const missingYears = firsts.filter((asset) => !isPickSwap(asset) && !Number.isFinite(asset.draftYear ?? Number.NaN));
  const protectedFirsts = firsts.filter((asset) => !isPickSwap(asset) && isProtectedPick(asset));
  const swaps = firsts.filter(isPickSwap);
  if (missingYears.length === 0 && protectedFirsts.length === 0 && swaps.length === 0) {
    return {
      code: `${team}:pick-specificity`,
      label: `${team} pick terms`,
      status: "pass",
      detail: `${team} sends modeled unprotected first-round pick(s) with explicit draft year(s).`
    };
  }

  const parts: string[] = [];
  if (missingYears.length > 0) parts.push(`${missingYears.map((asset) => asset.label).join(", ")} need draft-year detail`);
  if (protectedFirsts.length > 0) parts.push(`${protectedFirsts.map((asset) => asset.label).join(", ")} include protection/rollover terms that can encumber later drafts`);
  if (swaps.length > 0) parts.push(`${swaps.map((asset) => asset.label).join(", ")} are pick swaps and do not remove the team's own first for Stepien, but swap terms still need obligation review`);
  return {
    code: `${team}:pick-specificity`,
    label: `${team} pick terms`,
    status: "warn",
    detail: parts.join(". ") + "."
  };
}

function secondApronFrozenPickCheck(
  team: string,
  seasonYear: number,
  outgoing: TradeMachineAsset[],
  frozenFirstYears: number[] | undefined,
  beforeSalary: number,
  afterSalary: number,
  season: CapTrackerSeason
): TradeMachineRuleCheck {
  const firsts = outgoing.filter((asset) => asset.kind === "pick" && asset.round === 1 && Number.isFinite(asset.draftYear ?? Number.NaN));
  const frozenYears = new Set((frozenFirstYears ?? []).filter(Number.isFinite).map(Number));
  if (beforeSalary > season.second_apron || afterSalary > season.second_apron) frozenYears.add(seasonYear + 7);
  const blocked = firsts.filter((asset) => frozenYears.has(Number(asset.draftYear)));
  if (blocked.length === 0) {
    return {
      code: `${team}:second-apron-frozen-pick`,
      label: `${team} second-apron frozen pick`,
      status: "pass",
      detail: `${team} sends no modeled first-round pick or swap right currently frozen by the second-apron draft-pick penalty.`
    };
  }
  return {
    code: `${team}:second-apron-frozen-pick`,
    label: `${team} second-apron frozen pick`,
    status: "fail",
    detail: `${team} cannot trade ${blocked.map((asset) => asset.label).join(", ")} because the second-apron draft-pick penalty freezes that first-round pick or swap right.`
  };
}

function stepienCheck(
  team: string,
  seasonYear: number,
  outgoing: TradeMachineAsset[],
  incoming: TradeMachineAsset[],
  firstRoundPickYears: number[] | undefined,
  firstRoundPickInventorySource: TradeMachineTeamContext["firstRoundPickInventorySource"] | undefined
): TradeMachineRuleCheck {
  const firsts = outgoing.filter((asset) => asset.kind === "pick" && asset.round === 1 && !isPickSwap(asset));
  if (firsts.length === 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} Stepien rule`,
      status: "pass",
      detail: `${team} sends no first-round pick.`
    };
  }

  const unknownYears = firsts.filter((asset) => !Number.isFinite(asset.draftYear ?? Number.NaN));
  if (unknownYears.length > 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} Stepien rule`,
      status: "warn",
      detail: `${team} sends a first-round pick without a modeled draft year, so Stepien compliance needs pick-year detail.`
    };
  }

  const outgoingYears = firsts.map((asset) => Number(asset.draftYear)).filter(Number.isFinite);
  const horizon = seasonYear + 7;
  const tooFar = outgoingYears.filter((year) => year > horizon);
  if (tooFar.length > 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} seven-year pick limit`,
      status: "fail",
      detail: `${team} sends a first ${tooFar.map(String).join(", ")} more than seven drafts out.`
    };
  }

  if (!firstRoundPickYears || firstRoundPickYears.length === 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} Stepien rule`,
      status: "warn",
      detail: `${team} sends known first-round year(s), but available future first inventory is not modeled.`
    };
  }

  const available = new Set(firstRoundPickYears.filter(Number.isFinite));
  outgoingYears.forEach((year) => available.delete(year));
  const incomingFirsts = incoming.filter((asset) => asset.kind === "pick" && asset.round === 1 && !isPickSwap(asset));
  const incomingUnprotectedYears = incomingFirsts
    .filter((asset) => !isProtectedPick(asset))
    .map((asset) => Number(asset.draftYear))
    .filter(Number.isFinite);
  incomingUnprotectedYears.forEach((year) => available.add(year));
  const protectedRolloverRisk = protectedStepienRolloverRisk(firsts, available, seasonYear, horizon);
  const protectedIncomingGaps = protectedIncomingStepienGaps(incomingFirsts, available, seasonYear, horizon);
  for (let year = seasonYear; year < horizon; year += 1) {
    if (!available.has(year) && !available.has(year + 1)) {
      if (protectedIncomingGaps.includes(`${year}-${year + 1}`)) {
        return {
          code: `${team}:stepien`,
          label: `${team} Stepien rule`,
          status: "warn",
          detail: `${team} relies on protected incoming first-round pick terms to avoid a Stepien issue in consecutive drafts ${year} and ${year + 1}; verify conveyance terms before treating this as CBA-clean.`
        };
      }
      return {
        code: `${team}:stepien`,
        label: `${team} Stepien rule`,
        status: "fail",
        detail: `${team} would be without first-round picks in consecutive drafts ${year} and ${year + 1}.`
      };
    }
  }

  if (protectedIncomingGaps.length > 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} Stepien rule`,
      status: "warn",
      detail: `${team} receives protected first-round pick(s) that could be needed for Stepien coverage in ${protectedIncomingGaps.join(", ")} depending on conveyance.`
    };
  }

  if (protectedRolloverRisk.length > 0) {
    return {
      code: `${team}:stepien`,
      label: `${team} Stepien rule`,
      status: "warn",
      detail: `${team} sends protected first-round pick(s) whose possible rollover year(s) could create a Stepien issue if they convey later: ${protectedRolloverRisk.join("; ")}.`
    };
  }

  const incomingDetail = incomingUnprotectedYears.length > 0
    ? ` Incoming first(s) in ${Array.from(new Set(incomingUnprotectedYears)).sort((a, b) => a - b).join(", ")} are included in the post-trade inventory.`
    : "";
  return {
    code: `${team}:stepien`,
    label: `${team} Stepien rule`,
    status: firstRoundPickInventorySource === "assumed_full" ? "warn" : "pass",
    detail: firstRoundPickInventorySource === "assumed_full"
      ? `${team} retains at least one first-round pick in each adjacent future-draft pair through ${horizon}, assuming a full starting inventory because owed-pick data is unavailable.${incomingDetail}`
      : `${team} retains at least one first-round pick in each adjacent future-draft pair through ${horizon}.${incomingDetail}`
  };
}

function statusFromChecks(checks: TradeMachineRuleCheck[]): TradeMachineStatus {
  if (checks.some((check) => check.status === "fail")) return "illegal";
  if (checks.some((check) => check.status === "warn")) return "warning";
  return "legal";
}

function hardCapLabel(hardCap: NonNullable<TradeMachineTeamContext["hardCap"]>): string {
  return hardCap === "second_apron" ? "second apron" : "first apron";
}

function isModeledHardCap(value: unknown): value is NonNullable<TradeMachineTeamContext["hardCap"]> {
  return value === "first_apron" || value === "second_apron";
}

function apronLimit(apron: "first_apron" | "second_apron", season: CapTrackerSeason): number {
  return apron === "second_apron" ? season.second_apron : season.first_apron;
}

function apronRestrictionLabel(apron: "first_apron" | "second_apron"): string {
  return apron === "second_apron" ? "second apron" : "first apron";
}

function taxpayerMidLevelBlocksRestriction(restriction: TransactionApronRestriction, season: CapTrackerSeason): boolean {
  if (!restriction.row) return false;
  if (Number(season.year) === 2024) return restriction.row === "A" || restriction.row === "B" || restriction.row === "C" || restriction.row === "E";
  if (Number(season.year) >= 2025) return restriction.row === "A" || restriction.row === "B" || restriction.row === "C" || restriction.row === "E" || restriction.row === "F";
  return false;
}

function subsequentYearApronRestrictionApplies(restriction: TransactionApronRestriction): boolean {
  return restriction.row === "E" ||
    restriction.row === "F" ||
    restriction.row === "G" ||
    restriction.row === "H" ||
    restriction.row === "I" ||
    restriction.row === "J";
}

function strongestApronRestriction<T extends { apron: "first_apron" | "second_apron" }>(restrictions: T[]): T {
  return restrictions.find((restriction) => restriction.apron === "first_apron") ?? restrictions[0];
}

function futureFirstRoundPickYears(seasonYear: number): number[] {
  return Array.from({ length: 8 }, (_, index) => seasonYear + index);
}

function isPickSwap(asset: TradeMachineAsset): boolean {
  return String(asset.assetType ?? "").toLowerCase() === "pick_swap";
}

function possibleConveyYearsForPick(draftYear: number, protection: string | null | undefined): number[] | null {
  if (!Number.isFinite(draftYear)) return null;
  const years = new Set<number>([draftYear]);
  const text = String(protection ?? "");
  for (const match of text.matchAll(/\b(20\d{2})\b/g)) {
    const year = Number(match[1]);
    if (Number.isFinite(year) && year >= draftYear) years.add(year);
  }
  const through = text.match(/\b(?:through|thru|until)\s+(20\d{2})\b/i);
  if (through) {
    const end = Number(through[1]);
    for (let year = draftYear; year <= end && year <= draftYear + 7; year += 1) years.add(year);
  }
  return years.size > 1 ? Array.from(years).sort((a, b) => a - b) : null;
}

function isProtectedPick(asset: TradeMachineAsset): boolean {
  const cutoff = finiteNumber(asset.protectionCutoff);
  if (cutoff !== null && cutoff > 0) return true;
  const protection = String(asset.protection ?? "").trim().toLowerCase();
  return Boolean(protection && protection !== "unprotected" && protection !== "none");
}

function protectedStepienRolloverRisk(firsts: TradeMachineAsset[], availableAfterListedYears: Set<number>, seasonYear: number, horizon: number): string[] {
  const risks: string[] = [];
  for (const asset of firsts) {
    if (!isProtectedPick(asset)) continue;
    const listedYear = finiteNumber(asset.draftYear);
    if (listedYear === null) continue;
    const possibleYears = (asset.possibleConveyYears ?? possibleConveyYearsForPick(listedYear, asset.protection) ?? [])
      .filter((year) => Number.isFinite(year) && year !== listedYear && year <= horizon);
    for (const possibleYear of possibleYears) {
      const simulated = new Set(availableAfterListedYears);
      simulated.add(listedYear);
      simulated.delete(possibleYear);
      const gap = firstConsecutivePickGap(simulated, seasonYear, horizon);
      if (gap) risks.push(`${asset.label} could roll to ${possibleYear}, leaving ${gap[0]}-${gap[1]} uncovered`);
    }
  }
  return risks;
}

function protectedIncomingStepienGaps(incomingFirsts: TradeMachineAsset[], availableWithoutProtectedIncoming: Set<number>, seasonYear: number, horizon: number): string[] {
  const protectedYears = new Set<number>();
  for (const asset of incomingFirsts) {
    if (!isProtectedPick(asset)) continue;
    const listedYear = finiteNumber(asset.draftYear);
    if (listedYear === null) continue;
    const possibleYears = (asset.possibleConveyYears ?? possibleConveyYearsForPick(listedYear, asset.protection) ?? [listedYear])
      .filter((year) => Number.isFinite(year) && year >= seasonYear && year <= horizon);
    possibleYears.forEach((year) => protectedYears.add(year));
  }
  if (protectedYears.size === 0) return [];

  const gaps: string[] = [];
  for (let year = seasonYear; year < horizon; year += 1) {
    const leftMissing = !availableWithoutProtectedIncoming.has(year);
    const rightMissing = !availableWithoutProtectedIncoming.has(year + 1);
    if (leftMissing && rightMissing && (protectedYears.has(year) || protectedYears.has(year + 1))) {
      gaps.push(`${year}-${year + 1}`);
    }
  }
  return gaps;
}

function firstConsecutivePickGap(available: Set<number>, seasonYear: number, horizon: number): [number, number] | null {
  for (let year = seasonYear; year < horizon; year += 1) {
    if (!available.has(year) && !available.has(year + 1)) return [year, year + 1];
  }
  return null;
}

function normalizeTeam(team: string | null | undefined): string {
  return String(team ?? "").trim().toUpperCase();
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): number {
  return Math.max(0, finiteNumber(value) ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cashAmount(assets: TradeMachineAsset[]): number {
  return sum(assets.filter((asset) => asset.kind === "cash").map((asset) => money(asset.cashAmount ?? asset.tradeValue)));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateIsoLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  out.setMonth(out.getMonth() + months);
  return out;
}

function laterDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function dateForSeason(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function dateBetweenInclusive(date: Date | null, start: Date | null, end: Date | null): boolean | undefined {
  if (!date || !start || !end) return undefined;
  const value = date.getTime();
  return value >= start.getTime() && value <= end.getTime();
}

function dateAfterThrough(date: Date | null, startExclusive: Date | null, endInclusive: Date | null): boolean | undefined {
  if (!date || !startExclusive || !endInclusive) return undefined;
  const value = date.getTime();
  return value > startExclusive.getTime() && value <= endInclusive.getTime();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function moneyLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}
