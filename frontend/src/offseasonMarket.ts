import type { MarketBid, MarketComponentBreakdown, MarketLedgerRow, MarketResolution, MarketToolKind } from "./types";
import { clamp, formatMoney, formatNumber } from "./utils";

type TeamMode = "rebuilding" | "rising" | "playoff hopeful" | "contender" | "tax-sensitive contender";
type ContractStatus = "Signed" | "UFA" | "RFA" | "Player Option" | "Team Option" | "Non-Guaranteed" | "Rookie FA";
type BirdRight = "Bird" | "Early Bird" | "Non-Bird" | "None";
type SkillKey = "FTD" | "OREB" | "PASS" | "RIM" | "SHOOT" | "DPM" | "DREB" | "RIMPRO" | "SWITCH";

export type MarketScore = {
  needFit: number;
  value: number;
  timeline: number;
  urgency: number;
  taxPain: number;
  assetValue: number;
  replacement: number;
  upsideRisk: number;
  incumbency: number;
  randomness: number;
  total: number;
};

export type MarketTool = {
  name: string;
  amount: number;
  used: number;
  kind: MarketToolKind;
  path?: string;
  source?: string;
};

type MarketPlayer = {
  id: string;
  name: string;
  team: string;
  incumbentTeam: string;
  rightsTeam: string;
  status: ContractStatus;
  position: string;
  age: number;
  salary: number;
  marketValue: number;
  rights: BirdRight;
  rightsSource: string;
  capHold: number;
  capHoldType: string;
  holdAction?: "retained" | "renounced" | "none" | string;
  holdActionReason?: string;
  rightsValue?: number;
  holdRetainScore?: number;
  scarcityScore?: number;
  expectedMarketMinutes?: number;
  marketMinutesSource?: string;
  guaranteedSalary: number;
  deadCap: number;
  total: number;
  score: number;
  tier: string;
  tradeValue: number;
  upside: number;
  declineRisk: number;
  replaceability: number;
  skills: Record<SkillKey, number>;
  original?: { yoe?: number | null; projection_effective_contract_y1?: number | null } | undefined;
};

type MarketTeam<TPlayer extends MarketPlayer> = {
  team: string;
  name: string;
  mode: TeamMode;
  capPath?: "retained_rights" | "cap_room" | string;
  capPathReason?: string;
  projectedWins: number;
  projectedRank: number;
  roster: TPlayer[];
  rosterCountAdjustment?: number;
  standardRosterLimit?: number;
  targetRosterCount?: number;
  minimumRosterCount?: number;
  minimumRosterCharge?: number;
  payroll: number;
  activeSalary: number;
  guaranteedSalary: number;
  activeSalaryAdjustment?: number;
  guaranteedSalaryAdjustment?: number;
  deadCap: number;
  capHolds: number;
  initialCapHolds?: number;
  holdsRetained?: number;
  holdsRenounced?: number;
  rosterCharges: number;
  heldCapSpace: number;
  capSpace: number;
  renouncedCapSpace: number;
  maximumCapSpace: number;
  taxRoom: number;
  firstApronRoom: number;
  secondApronRoom: number;
  needs: SkillKey[];
  pickAssets: number;
  pickCount: number;
  premiumPickCount: number;
  willingness: number;
  exceptions: MarketTool[];
  toolLedger?: Array<{ player: string; tool: MarketToolKind; amount: number; remaining: number; reason: string }>;
  explanations: string[];
};

type MarketAssumptions = {
  seed: number;
  variance: number;
  marketAggression: number;
  taxSensitivity: number;
  cap: number;
  tax: number;
  firstApron: number;
  secondApron: number;
};

export type TeamBidPlan<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>> = {
  bid: MarketBid;
  team: TTeam;
  player: TPlayer;
  salary: number;
  years: number;
  tool: MarketTool;
  score: MarketScore;
  needFit: number;
  timeline: number;
  taxPain: number;
  redundancy: number;
  affordability: number;
  alternatives: number;
  toolReason: string;
};

export type PlayerChoice<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>> = {
  chosen: TeamBidPlan<TPlayer, TTeam>;
  ranked: TeamBidPlan<TPlayer, TTeam>[];
  highestMoney: TeamBidPlan<TPlayer, TTeam>;
  moneyGap: number;
  yearsGap: number;
  closeMoneyWin: boolean;
  reason: string;
};

type LegacyAuditStatus = "offer" | "reject" | "signed" | "matched" | "declined";

export type LegacyAuditRow = {
  id: string;
  round: number;
  team: string;
  player: string;
  playerId: string;
  status: LegacyAuditStatus;
  reason: string;
  toolName?: string;
  offer?: number;
  legalMax?: number;
  marketValue: number;
  priority?: number;
  needFit?: number;
  rightsSource?: string;
  capHoldType?: string;
};

export type MarketFreeAgentSigning<TPlayer extends MarketPlayer = MarketPlayer> = {
  player: TPlayer;
  fromTeam: string;
  toTeam: string;
  status: "UFA" | "RFA" | "Rookie FA";
  years: number;
  annualSalary: number;
  totalSalary: number;
  tool: MarketToolKind;
  matched?: boolean;
  offerSheetTeam?: string;
  score: MarketScore;
  context: {
    toolName: string;
    toolAmount: number;
    legalMax: number;
    playerMarket: number;
    limiter: string;
    capPath?: string;
    toolReason?: string;
    holdAction?: string;
    rightsValue?: number;
    holdRetainScore?: number;
    scarcityScore?: number;
    expectedMarketMinutes?: number;
    marketMinutesSource?: string;
    postToolRemaining?: number;
    preCapSpace: number;
    preHeldCapSpace?: number;
    preRenouncedCapSpace?: number;
    preTaxRoom: number;
    preFirstApronRoom: number;
    preSecondApronRoom: number;
    needFit: number;
    priority: number;
    utility: number;
    alternatives: string[];
    logic: string[];
    rightsSource?: string;
    capHoldType?: string;
    originalAsk?: number;
    clearingBid?: number;
    highestBid?: number;
    highestBidTeam?: string;
    runnerUpBid?: number;
    runnerUpTeam?: string;
    selectionMethod?: string;
    bidComponents?: MarketComponentBreakdown;
    resolution?: MarketResolution;
    losingReasons?: string[];
    moneyGap?: number;
    yearsGap?: number;
    highestMoneyLostReason?: string;
  };
  explanation: string;
  plausibility: number;
  marketResolution: MarketResolution;
  bids: MarketBid[];
  ledger: MarketLedgerRow[];
};

export type MarketSimulationResult<TPlayer extends MarketPlayer = MarketPlayer> = {
  signings: MarketFreeAgentSigning<TPlayer>[];
  bids: MarketBid[];
  ledger: MarketLedgerRow[];
  resolutions: MarketResolution[];
  audit: LegacyAuditRow[];
};

const marketTiers = [
  { label: "Star / max market", minScore: 84, minValue: 28_000_000, acceptance: 0.72, maxPasses: 36 },
  { label: "Starter market", minScore: 68, minValue: 10_000_000, acceptance: 0.66, maxPasses: 44 },
  { label: "Exception market", minScore: 54, minValue: 3_500_000, acceptance: 0.58, maxPasses: 52 },
  { label: "Minimum / filler market", minScore: 0, minValue: 0, acceptance: 0.45, maxPasses: 64 }
];

const STANDARD_ROSTER_LIMIT = 15;
const MINIMUM_STANDARD_ROSTER = 12;

export function simulateFreeAgencyMarket<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  players: TPlayer[],
  teams: Map<string, TTeam>,
  assumptions: MarketAssumptions,
  rng: () => number
): MarketSimulationResult<TPlayer> {
  const signings: MarketFreeAgentSigning<TPlayer>[] = [];
  const bids: MarketBid[] = [];
  const ledger: MarketLedgerRow[] = [];
  const resolutions: MarketResolution[] = [];
  const audit: LegacyAuditRow[] = [];
  const freeAgents = players
    .filter((player) => player.status === "UFA" || player.status === "RFA" || (player.team === "FA" && player.status !== "Rookie FA"))
    .filter((player) => player.status !== "Player Option" && player.status !== "Team Option" && player.status !== "Non-Guaranteed")
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 220);
  const unsigned = new Set(freeAgents.map((player) => player.id));
  const attemptedTargets = new Map<string, Set<string>>();

  for (let round = 0; round < marketTiers.length; round += 1) {
    const tier = marketTiers[round];
    for (let pass = 0; pass < tier.maxPasses && unsigned.size > 0; pass += 1) {
      const wave = Math.floor(pass / 4);
      const tierPlayers = freeAgents
        .filter((player) => unsigned.has(player.id))
        .filter((player) => player.score >= tier.minScore || player.marketValue >= tier.minValue);
      if (!tierPlayers.length) break;

      refreshTeamPayrolls(teams, assumptions);
      const offersByPlayer = new Map<string, TeamBidPlan<TPlayer, TTeam>[]>();
      const sortedTeams = Array.from(teams.values())
        .sort((a, b) => teamSpendingPower(b, assumptions) - teamSpendingPower(a, assumptions) || b.willingness - a.willingness);

      sortedTeams.forEach((team) => {
        const attempts = attemptedTargets.get(team.team) ?? new Set<string>();
        const remainingTargets = tierPlayers.filter((player) => !attempts.has(`${round}:${wave}:${player.id}`));
        const plans = buildTeamBidPlans(team, remainingTargets, assumptions, rng, round, tier.label, pass, ledger, audit);
        if (!plans.length) return;
        plans.forEach((plan) => {
          attempts.add(`${round}:${wave}:${plan.player.id}`);
          bids.push(plan.bid);
          ledger.push(ledgerFromBid(plan.bid, "submitted", `Priority ${formatNumber(plan.bid.teamPriority, 2)} target; ${bidSlotReason(team, plan)}`));
          audit.push(auditFromBid(plan.bid, plan.player, "offer", "Submitted wave bid"));
          const list = offersByPlayer.get(plan.player.id) ?? [];
          list.push(plan);
          offersByPlayer.set(plan.player.id, list);
        });
        attemptedTargets.set(team.team, attempts);
      });

      const activeMarkets = Array.from(offersByPlayer.values())
        .sort((a, b) => b[0].player.marketValue - a[0].player.marketValue || b.length - a.length);
      if (!activeMarkets.length) continue;

      let signedThisPass = false;
      for (const marketOffers of activeMarkets) {
        const player = marketOffers[0]?.player;
        if (!player || !unsigned.has(player.id)) continue;
        const available = marketOffers.filter((offer) => canHonorOffer(offer, assumptions));
        marketOffers
          .filter((offer) => !available.includes(offer))
          .forEach((offer) => ledger.push(ledgerFromBid(offer.bid, "withdrawn", "Budget/tool was consumed before this priority offer resolved")));
        if (!available.length) {
          recordUnresolved(player, round, tier.label, "Team budget consumed before a legal offer could resolve", ledger, resolutions);
          continue;
        }

        const choice = choosePlayerOffer(player, available, tier.acceptance);
        if (!choice) {
          const best = available.slice().sort((a, b) => b.salary - a.salary)[0];
          recordUnresolved(player, round, tier.label, `Best offer ${best ? formatMoney(best.salary) : "-"} below player acceptance threshold`, ledger, resolutions);
          continue;
        }

        const signing = resolveAcceptedOffer(choice, teams, assumptions, round, tier.label, ledger, resolutions, audit, rng);
        signings.push(signing);
        unsigned.delete(player.id);
        signedThisPass = true;
      }

      if (!signedThisPass && activeMarkets.length === 0) continue;
    }
  }

  const fallbackSignings = resolveRfaFallbackOffers(freeAgents, unsigned, teams, assumptions, rng, ledger, resolutions, audit);
  fallbackSignings.forEach((signing) => signings.push(signing));

  freeAgents
    .filter((player) => unsigned.has(player.id))
    .forEach((player) => recordUnresolved(player, marketTiers.length, "Unresolved market", "No acceptable legal offer before market closed", ledger, resolutions));

  refreshTeamPayrolls(teams, assumptions);
  return { signings, bids, ledger, resolutions, audit };
}

function resolveRfaFallbackOffers<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  freeAgents: TPlayer[],
  unsigned: Set<string>,
  teams: Map<string, TTeam>,
  assumptions: MarketAssumptions,
  rng: () => number,
  ledger: MarketLedgerRow[],
  resolutions: MarketResolution[],
  audit: LegacyAuditRow[]
): MarketFreeAgentSigning<TPlayer>[] {
  const signings: MarketFreeAgentSigning<TPlayer>[] = [];
  freeAgents
    .filter((player) => unsigned.has(player.id))
    .filter((player) => player.status === "RFA" && player.rights !== "None" && player.holdAction !== "renounced")
    .sort((a, b) => b.marketValue - a.marketValue)
    .forEach((player) => {
      const incumbent = teams.get(player.rightsTeam);
      if (!incumbent) return;
      const plan = buildRfaFallbackOffer(incumbent, player, freeAgents, assumptions, rng, marketTiers.length, "RFA fallback", ledger.length);
      if (!plan || !canHonorOffer(plan, assumptions)) return;
      ledger.push(ledgerFromBid(plan.bid, "submitted", "Incumbent submitted proactive RFA fallback after no acceptable outside offer sheet"));
      audit.push(auditFromBid(plan.bid, player, "offer", "Submitted proactive RFA fallback"));
      const choice = choosePlayerOffer(player, [plan], 0.18);
      if (!choice) return;
      const signing = resolveAcceptedOffer(choice, teams, assumptions, marketTiers.length, "RFA fallback", ledger, resolutions, audit, rng);
      signing.marketResolution.clearingRule = "proactive RFA fallback";
      signing.context.selectionMethod = "Incumbent used restricted-rights leverage after no outside offer sheet became acceptable.";
      signing.context.toolReason = "Proactive RFA fallback with retained Bird/RFA rights; no cap room or exception was consumed.";
      signing.explanation = `${incumbent.team} retained ${player.name} with a proactive RFA offer after the market did not produce an acceptable outside offer sheet.`;
      unsigned.delete(player.id);
      signings.push(signing);
    });
  return signings;
}

function buildRfaFallbackOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  marketPlayers: TPlayer[],
  assumptions: MarketAssumptions,
  rng: () => number,
  round: number,
  tier: string,
  pass: number
): TeamBidPlan<TPlayer, TTeam> | null {
  refreshTeamPayroll(team, assumptions);
  const tool = bestSpendingTool(team, player, assumptions);
  if (!tool || tool.kind !== "bird") return null;
  const maxOffer = maxLegalOffer(team, player, assumptions, tool.kind);
  const legalMax = Math.min(tool.amount, maxOffer.legalMax);
  const minSalary = minimumSalary(player);
  if (legalMax < minSalary) return null;
  const needFit = needFitScore(team, player.position, player.skills);
  const timeline = timelineFit(team, player);
  const taxPain = taxPainScore(team, Math.min(legalMax, player.marketValue), assumptions);
  const redundancy = rosterRedundancyPenalty(team, player);
  const alternatives = countAlternatives(team, player, marketPlayers);
  const teamPriority = teamPriorityForPlayer(team, player, legalMax, assumptions, needFit, timeline, taxPain, redundancy, alternatives);
  const rightsBoost = clamp(rightsLeverageScore(team, player, assumptions) * 0.24 + (player.holdRetainScore ?? 0) * 0.12 + (player.scarcityScore ?? 0) * 0.08, 0, 0.34);
  if (teamPriority + rightsBoost < (player.marketValue >= 8_000_000 ? 0.42 : 0.3)) return null;
  const years = player.age <= 26 && player.marketValue >= 8_000_000 ? 4 : player.marketValue >= 5_000_000 ? 3 : 2;
  const leverageDiscount = player.marketValue >= 18_000_000 ? 0.82 : player.marketValue >= 8_000_000 ? 0.76 : 0.68;
  const targetMultiplier = Math.min(0.96, leverageDiscount + teamPriority * 0.11 + needFit * 0.04 + rightsBoost - taxPain * 0.08 + centeredRandom(rng, assumptions.variance) * 0.015);
  const salary = clamp(player.marketValue * targetMultiplier, minSalary, legalMax);
  if (salary < Math.min(player.marketValue * 0.55, 7_000_000) && player.marketValue > 10_000_000) return null;
  const components = playerChoiceComponents(team, player, salary, years, needFit, 0.18, true);
  const score = makeScore({
    needFit,
    value: valueScore(player, salary),
    timeline,
    urgency: urgencyScore(team),
    taxPain,
    assetValue: player.tradeValue / Math.max(assumptions.cap, 1),
    replacement: player.replaceability,
    upsideRisk: player.upside - player.declineRisk,
    incumbency: 1,
    randomness: 0
  });
  const bid: MarketBid = {
    id: `${round}-${pass}-${team.team}-${player.id}-rfa-fallback`,
    round,
    tier,
    team: team.team,
    playerId: player.id,
    player: player.name,
    tool: tool.name,
    toolKind: tool.kind,
    submittedAav: salary,
    years,
    legalMax,
    teamPriority,
    teamUtility: clamp(teamPriority + rightsBoost + valueScore(player, salary) * 0.14 - taxPain * 0.12, 0, 1.25),
    playerUtility: components.total,
    components,
    capSnapshot: {
      capSpace: team.capSpace,
      heldCapSpace: team.heldCapSpace,
      renouncedCapSpace: team.renouncedCapSpace,
      taxRoom: team.taxRoom,
      firstApronRoom: team.firstApronRoom,
      secondApronRoom: team.secondApronRoom,
      toolAmount: tool.amount,
      toolRemaining: tool.amount
    },
    capPath: team.capPath ?? "retained_rights",
    toolReason: "Proactive RFA fallback after no acceptable outside offer sheet; retained rights preserve cap room and exceptions.",
    holdAction: player.holdAction ?? "retained",
    rightsValue: player.rightsValue,
    holdRetainScore: player.holdRetainScore,
    scarcityScore: player.scarcityScore,
    expectedMarketMinutes: player.expectedMarketMinutes,
    marketMinutesSource: player.marketMinutesSource,
    limiter: maxOffer.limiter,
    reason: `RFA fallback: retained match rights, rights value ${formatNumber(player.rightsValue ?? 0, 2)}, scarcity ${formatNumber(player.scarcityScore ?? 0, 2)}, no outside sheet cleared.`
  };
  return { bid, team, player, salary, years, tool: { ...tool, amount: legalMax }, score, needFit, timeline, taxPain, redundancy, affordability: clamp(legalMax / Math.max(player.marketValue, 1), 0, 1.35), alternatives, toolReason: bid.toolReason ?? "" };
}

export function buildTeamBidPlan<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  players: TPlayer[],
  assumptions: MarketAssumptions,
  rng: () => number,
  round: number,
  tier: string,
  pass: number,
  ledger: MarketLedgerRow[],
  audit: LegacyAuditRow[]
): TeamBidPlan<TPlayer, TTeam> | null {
  return buildTeamBidPlans(team, players, assumptions, rng, round, tier, pass, ledger, audit)[0] ?? null;
}

function buildTeamBidPlans<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  players: TPlayer[],
  assumptions: MarketAssumptions,
  rng: () => number,
  round: number,
  tier: string,
  pass: number,
  ledger: MarketLedgerRow[],
  audit: LegacyAuditRow[]
): TeamBidPlan<TPlayer, TTeam>[] {
  refreshTeamPayroll(team, assumptions);
  const maxActiveOffers = maxActiveOffersForTeam(team, assumptions);
  const candidatePlayers = buildEligibleTeamBoard(team, players, assumptions);
  const plans = candidatePlayers
    .map((player) => buildOfferForTarget(team, player, players, assumptions, rng, round, tier, pass, ledger, audit, false))
    .filter((plan): plan is TeamBidPlan<TPlayer, TTeam> => Boolean(plan))
    .sort((a, b) => b.bid.teamPriority - a.bid.teamPriority || b.bid.teamUtility - a.bid.teamUtility || b.salary - a.salary);
  if (plans.length) return plans.slice(0, maxActiveOffers);
  candidatePlayers
    .slice()
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 4)
    .forEach((player) => buildOfferForTarget(team, player, players, assumptions, rng, round, tier, pass, ledger, audit, true));
  return [];
}

function buildEligibleTeamBoard<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, players: TPlayer[], assumptions: MarketAssumptions): TPlayer[] {
  return uniquePlayers(players)
    .map((player) => {
      const rosterFit = rosterOfferFit(team, player, assumptions);
      const need = needFitScore(team, player.position, player.skills);
      const timeline = timelineFit(team, player);
      const redundancy = rosterRedundancyPenalty(team, player);
      const ownRights = player.rightsTeam === team.team && player.rights !== "None";
      const rightsLeverage = ownRights ? rightsLeverageScore(team, player, assumptions) : 0;
      const rawPriority = need * 0.3 + timeline * 0.18 + clamp(player.score / 100, 0, 1) * 0.24 + team.willingness * 0.1 + rightsLeverage * 0.22 - redundancy * 0.18;
      const capUrgency = capRoomUrgencyActive(team, assumptions) && player.marketValue >= Math.min(team.capSpace * 0.2, assumptions.cap * 0.08) ? 0.08 : 0;
      return { player, priority: rawPriority + capUrgency + rosterFit.priorityAdjustment, rosterFit };
    })
    .filter((row) => row.rosterFit.allowed && (row.priority >= 0.24 || (row.rosterFit.belowMinimum && row.player.marketValue <= minimumSalary(row.player) * 1.8)))
    .sort((a, b) => b.priority - a.priority || b.player.marketValue - a.player.marketValue)
    .slice(0, capRoomUrgencyActive(team, assumptions) ? 72 : 42)
    .map((row) => row.player);
}

function shouldReserveCapForHigherTarget<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  players: TPlayer[],
  assumptions: MarketAssumptions,
  priority: number
): boolean {
  if (!capRoomUrgencyActive(team, assumptions)) return false;
  if (player.marketValue >= Math.max(assumptions.cap * 0.08, team.capSpace * 0.28)) return false;
  return players.some((candidate) =>
    candidate.id !== player.id &&
    candidate.rightsTeam !== team.team &&
    candidate.marketValue >= player.marketValue + Math.max(5_000_000, player.marketValue * 0.35) &&
    candidate.marketValue <= team.capSpace * 1.15 &&
    needFitScore(team, candidate.position, candidate.skills) >= needFitScore(team, player.position, player.skills) - 0.08 &&
    capPathTargetPriority(team, candidate, assumptions) >= priority + 0.04
  );
}

function capPathTargetPriority<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions): number {
  return needFitScore(team, player.position, player.skills) * 0.34 +
    timelineFit(team, player) * 0.2 +
    clamp(player.score / 100, 0, 1) * 0.26 +
    team.willingness * 0.12 +
    clamp(player.marketValue / Math.max(assumptions.cap * 0.16, 1), 0, 0.12) -
    rosterRedundancyPenalty(team, player) * 0.18;
}

function maxActiveOffersForTeam<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, assumptions: MarketAssumptions): number {
  const openSlots = legalRosterSlotsRemaining(team);
  if (openSlots <= 0) return 0;
  return Math.min(openSlots, capRoomUrgencyActive(team, assumptions) ? 3 : 1);
}

function capRoomUrgencyActive<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, assumptions: MarketAssumptions): boolean {
  const capPath = team.capPath ?? "retained_rights";
  const createdRoom = Math.max(team.maximumCapSpace, team.renouncedCapSpace, team.capSpace, 0);
  return capPath === "cap_room" && createdRoom >= Math.max(20_000_000, assumptions.cap * 0.12) && team.capSpace > 1_500_000;
}

function bidSlotReason<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, plan: TeamBidPlan<TPlayer, TTeam>): string {
  if ((team.capPath ?? "retained_rights") === "cap_room" && plan.bid.toolKind === "cap") {
    return `cap-room wave bid using ${plan.bid.tool}`;
  }
  return `single active ${plan.bid.tool} offer`;
}

function buildOfferForTarget<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  marketPlayers: TPlayer[],
  assumptions: MarketAssumptions,
  rng: () => number,
  round: number,
  tier: string,
  pass: number,
  ledger: MarketLedgerRow[],
  audit: LegacyAuditRow[],
  recordRejections: boolean
): TeamBidPlan<TPlayer, TTeam> | null {
  const reject = (reason: string, toolName?: string, offer?: number, legalMax?: number) => {
    if (recordRejections) recordRejectedOffer(team, player, round, tier, reason, toolName, offer, legalMax, ledger, audit);
    return null;
  };
  if (player.status === "RFA" && player.rightsTeam === team.team && player.rights !== "None" && tier !== "RFA fallback") {
    return reject("Incumbent is preserving RFA match leverage rather than bidding against itself before offer sheets");
  }
  const rosterFit = rosterOfferFit(team, player, assumptions);
  if (!rosterFit.allowed) {
    return reject(rosterFit.reason);
  }
  const tool = bestSpendingTool(team, player, assumptions);
  if (!tool) {
    return reject("No cap room, rights, or usable exception");
  }
  const toolReason = spendingToolReason(team, player, tool);

  const maxOffer = maxLegalOffer(team, player, assumptions, tool.kind);
  const legalMax = Math.min(tool.amount, maxOffer.legalMax);
  const minSalary = minimumSalary(player);
  if (legalMax < minSalary) {
    return reject("Legal max below minimum salary", tool.name, legalMax, maxOffer.legalMax);
  }
  if (tool.kind === "minimum" && player.marketValue > 4_000_000 && player.score > 55) {
    return reject("Only minimum available for non-minimum market player", tool.name, minSalary, legalMax);
  }
  if (isMarketExceptionTool(tool.kind) && player.marketValue > legalMax * 1.65 && player.score > 68 && player.rightsTeam !== team.team) {
    return reject(`Exception too small for market (${formatMoney(legalMax)} max vs ${formatMoney(player.marketValue)} value)`, tool.name, legalMax, legalMax);
  }
  if (hardCapsAtFirstApron(tool.kind) && team.payroll + Math.min(legalMax, player.marketValue) > assumptions.firstApron) {
    return reject("Exception apron blocked: non-taxpayer MLE/BAE would hard-cap team above first apron", tool.name, legalMax, legalMax);
  }
  if (tool.kind === "taxpayer_mle" && team.payroll + Math.min(legalMax, player.marketValue) > assumptions.secondApron) {
    return reject("Exception apron blocked: taxpayer MLE unavailable above second apron", tool.name, legalMax, legalMax);
  }
  if (tool.kind === "room_exception" && capRoomUrgencyActive(team, assumptions) && !capRoomMateriallyUsed(team) && team.capSpace > legalMax + 1_000_000) {
    return reject("Exception unavailable by path: reserved room exception until cap-room bids are used or cap is exhausted", tool.name, legalMax, legalMax);
  }

  const needFit = needFitScore(team, player.position, player.skills);
  const timeline = timelineFit(team, player);
  const taxPain = taxPainScore(team, Math.min(legalMax, player.marketValue), assumptions);
  const redundancy = rosterRedundancyPenalty(team, player);
  const urgency = urgencyScore(team);
  const alternatives = countAlternatives(team, player, marketPlayers);
  const affordability = clamp(legalMax / Math.max(player.marketValue, 1), 0, 1.35);
  const randomness = centeredRandom(rng, assumptions.variance) * 0.5;
  const teamPriority = clamp(teamPriorityForPlayer(team, player, legalMax, assumptions, needFit, timeline, taxPain, redundancy, alternatives) + rosterFit.priorityAdjustment, 0, 1);
  if (tool.kind === "cap" && pass < 8 && shouldReserveCapForHigherTarget(team, player, marketPlayers, assumptions, teamPriority)) {
    return reject("Reserved cap budget for higher target board", tool.name, undefined, legalMax);
  }
  if (teamPriority < 0.2 && player.marketValue > 6_000_000) {
    return reject(`Low team priority after needs, alternatives, tax, and redundancy (${formatNumber(teamPriority, 2)})`, tool.name, undefined, legalMax);
  }

  const years = contractYears(player, team, rng);
  const assertivePassBump = Math.min(0.08, pass * 0.012);
  const targetMultiplier = 0.78 +
    assumptions.marketAggression * 0.2 +
    teamPriority * 0.22 +
    needFit * 0.08 +
    urgency * 0.04 +
    affordability * 0.06 -
    taxPain * 0.18 -
    redundancy * 0.12 -
    alternatives * 0.035 +
    assertivePassBump +
    randomness * 0.04;
  const salary = clamp(player.marketValue * targetMultiplier, minSalary, legalMax);
  if (salary < Math.min(player.marketValue * 0.48, 8_000_000) && player.marketValue > 12_000_000) {
    return reject("Offer too far below player market to be credible", tool.name, salary, legalMax);
  }

  const components = playerChoiceComponents(team, player, salary, years, needFit, 0, false);
  const teamUtility = clamp(teamPriority + valueScore(player, salary) * 0.18 - taxPain * 0.16 + affordability * 0.08, 0, 1.25);
  const score = makeScore({
    needFit,
    value: valueScore(player, salary),
    timeline,
    urgency,
    taxPain,
    assetValue: player.tradeValue / Math.max(assumptions.cap, 1),
    replacement: player.replaceability,
    upsideRisk: player.upside - player.declineRisk,
    incumbency: rightsLeverageScore(team, player, assumptions),
    randomness
  });
  const bid: MarketBid = {
    id: `${round}-${pass}-${team.team}-${player.id}-${tool.kind}`,
    round,
    tier,
    team: team.team,
    playerId: player.id,
    player: player.name,
    tool: tool.name,
    toolKind: tool.kind,
    submittedAav: salary,
    years,
    legalMax,
    teamPriority,
    teamUtility,
    playerUtility: components.total,
    components,
    capSnapshot: {
      capSpace: team.capSpace,
      heldCapSpace: team.heldCapSpace,
      renouncedCapSpace: team.renouncedCapSpace,
      taxRoom: team.taxRoom,
      firstApronRoom: team.firstApronRoom,
      secondApronRoom: team.secondApronRoom,
      toolAmount: tool.amount,
      toolRemaining: tool.amount
    },
    capPath: team.capPath ?? "retained_rights",
    toolReason,
    holdAction: player.holdAction ?? "none",
    rightsValue: player.rightsValue,
    holdRetainScore: player.holdRetainScore,
    scarcityScore: player.scarcityScore,
    expectedMarketMinutes: player.expectedMarketMinutes,
    marketMinutesSource: player.marketMinutesSource,
    limiter: maxOffer.limiter,
    reason: `Team bid plan: need ${formatNumber(needFit, 2)}, roster job ${formatNumber(rosterFit.slotFit, 2)}, timeline ${formatNumber(timeline, 2)}, alternatives ${alternatives}, tax drag ${formatNumber(taxPain, 2)}`
  };
  return { bid, team, player, salary, years, tool: { ...tool, amount: legalMax }, score, needFit, timeline, taxPain, redundancy, affordability, alternatives, toolReason };
}

export function choosePlayerOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  player: TPlayer,
  offers: TeamBidPlan<TPlayer, TTeam>[],
  acceptance: number
): PlayerChoice<TPlayer, TTeam> | null {
  const highestMoney = offers.slice().sort((a, b) => b.salary - a.salary || b.years - a.years)[0];
  if (!highestMoney) return null;
  const closeThreshold = Math.max(1_500_000, highestMoney.salary * 0.08);
  const ranked = offers
    .map((offer) => {
      const moneyGap = highestMoney.salary - offer.salary;
      const closeOfferAdjustment = offer.team.team === highestMoney.team.team ? 0 : moneyGap <= closeThreshold ? clamp((closeThreshold - moneyGap) / closeThreshold, 0, 1) : 0;
      offer.bid.components = playerChoiceComponents(offer.team, player, offer.salary, offer.years, offer.needFit, closeOfferAdjustment, offer.team.team === highestMoney.team.team);
      offer.bid.playerUtility = offer.bid.components.total;
      return offer;
    })
    .sort((a, b) => b.bid.playerUtility - a.bid.playerUtility || b.salary - a.salary);
  const bestClose = ranked.find((offer) => highestMoney.salary - offer.salary <= closeThreshold) ?? highestMoney;
  const chosen = bestClose !== highestMoney && bestClose.bid.playerUtility >= highestMoney.bid.playerUtility + 0.045 ? bestClose : highestMoney;
  if (chosen.bid.playerUtility < acceptance && chosen.salary < player.marketValue * 0.5) return null;
  const moneyGap = Math.max(0, highestMoney.salary - chosen.salary);
  const yearsGap = chosen.years - highestMoney.years;
  const closeMoneyWin = chosen.team.team !== highestMoney.team.team && moneyGap > 0;
  const reason = playerChoiceReason(player, chosen, highestMoney, moneyGap, yearsGap, closeThreshold, closeMoneyWin);
  return { chosen, ranked, highestMoney, moneyGap, yearsGap, closeMoneyWin, reason };
}

function playerChoiceReason<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  player: TPlayer,
  chosen: TeamBidPlan<TPlayer, TTeam>,
  highestMoney: TeamBidPlan<TPlayer, TTeam>,
  moneyGap: number,
  yearsGap: number,
  closeThreshold: number,
  closeMoneyWin: boolean
): string {
  const components = chosen.bid.components;
  const profileLabel = player.score >= 82 || player.marketValue >= 24_000_000
    ? "prime-money player"
    : player.age >= 31
      ? "veteran"
      : player.age <= 26 && player.upside > 0.35
        ? "young upside bet"
        : player.marketValue <= Math.max(minimumSalary(player) * 2.2, 4_000_000)
          ? "roster-spot player"
          : "rotation player";
  const drivers = [
    { label: "money", value: components.salary },
    { label: "security", value: Math.max(components.security, components.totalGuarantee) },
    { label: "role", value: components.roleFit },
    { label: "familiarity", value: components.familiarity }
  ].sort((a, b) => b.value - a.value).slice(0, 2).map((row) => row.label).join(" and ");
  if (closeMoneyWin) {
    return `Close-money player choice: as a ${profileLabel}, ${player.name} gives up ${formatMoney(moneyGap)} AAV inside the ${formatMoney(closeThreshold)} close-offer band because ${drivers} made ${chosen.team.team} more attractive than ${highestMoney.team.team}.`;
  }
  if (chosen.team.team !== highestMoney.team.team) {
    return `Player choice: ${chosen.team.team} beat the richer raw offer from ${highestMoney.team.team} because ${drivers} outweighed a ${formatMoney(moneyGap)} AAV gap.`;
  }
  if (yearsGap > 0) {
    return `Highest AAV and security win: ${chosen.team.team} offered ${formatMoney(chosen.salary)} over ${chosen.years} years, with ${drivers} supporting the choice.`;
  }
  return `Highest AAV offer wins: ${chosen.team.team} offered ${formatMoney(chosen.salary)} over ${chosen.years} years, and the player-choice model still liked the ${drivers} case.`;
}

export function resolveAcceptedOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  choice: PlayerChoice<TPlayer, TTeam>,
  teams: Map<string, TTeam>,
  assumptions: MarketAssumptions,
  round: number,
  tier: string,
  ledger: MarketLedgerRow[],
  resolutions: MarketResolution[],
  audit: LegacyAuditRow[],
  rng: () => number
): MarketFreeAgentSigning<TPlayer> {
  const { chosen, ranked, highestMoney, moneyGap, yearsGap, closeMoneyWin } = choice;
  const player = chosen.player;
  const originalStatus = player.status;
  const offerSheetTeam = player.status === "RFA" && player.rightsTeam !== chosen.team.team ? chosen.team.team : undefined;
  let signingTeam = chosen.team;
  let signingTool = chosen.tool.kind;
  let score = chosen.score;
  let matched = false;

  const resolution: MarketResolution = {
    playerId: player.id,
    player: player.name,
    round,
    tier,
    winnerTeam: chosen.team.team,
    finalTeam: chosen.team.team,
    offerSheetTeam,
    finalAav: chosen.salary,
    submittedWinnerBid: chosen.salary,
    runnerUpTeam: ranked.find((offer) => offer.team.team !== chosen.team.team)?.team.team,
    runnerUpBid: ranked.find((offer) => offer.team.team !== chosen.team.team)?.salary,
    highestRawBidTeam: highestMoney.team.team,
    highestRawBid: highestMoney.salary,
    clearingRule: "accepted submitted offer",
    rfaMatchResult: "not_applicable"
  };

  ledger.push(ledgerFromBid(chosen.bid, "won", closeMoneyWin ? choice.reason : `Accepted highest-money offer at exact submitted terms: ${formatMoney(chosen.salary)} over ${chosen.years} years`));
  audit.push(auditFromBid(chosen.bid, player, "signed", `Accepted exact submitted terms: ${formatMoney(chosen.salary)} over ${chosen.years} years`));
  ranked
    .filter((offer) => offer.team.team !== chosen.team.team)
    .slice(0, 5)
    .forEach((offer, index) => {
      const reason = offer.team.team === highestMoney.team.team && closeMoneyWin
        ? choice.reason
        : `Lost player decision: ${formatMoney(offer.salary)} over ${offer.years} years vs chosen ${formatMoney(chosen.salary)} over ${chosen.years}`;
      ledger.push(ledgerFromBid(offer.bid, index < 3 ? "shortlisted" : "outbid", reason));
    });

  if (offerSheetTeam) {
    const incumbent = teams.get(player.rightsTeam);
    if (incumbent) {
      const match = rfaMatchDecision(incumbent, player, chosen.salary, chosen.years, assumptions, rng);
      if (match.canMatch && match.score.total > 0.54) {
        signingTeam = incumbent;
        signingTool = player.rights === "None" ? "minimum" : "bird";
        score = match.score;
        matched = true;
        resolution.finalTeam = incumbent.team;
        resolution.rfaMatchResult = "matched";
        resolution.clearingRule = "matched exact offer sheet";
        ledger.push({
          id: `${round}-${incumbent.team}-${player.id}-matched-${ledger.length}`,
          round,
          tier,
          team: incumbent.team,
          playerId: player.id,
          player: player.name,
          status: "matched",
          reason: `Matched exact offer sheet: ${formatMoney(chosen.salary)} AAV, ${chosen.years} years`,
          offer: chosen.salary,
          legalMax: match.legalMax,
          tool: player.rights,
          playerUtility: match.score.total,
          teamUtility: match.score.total,
          teamPriority: match.score.total,
          needFit: match.score.needFit,
          rightsSource: player.rightsSource,
          capHoldType: player.capHoldType
        });
        audit.push(auditFromMatch(incumbent.team, player, round, "matched", `Matched exact ${offerSheetTeam} offer sheet`, chosen.salary, match.legalMax, match.score));
      } else {
        resolution.rfaMatchResult = "declined";
        ledger.push({
          id: `${round}-${incumbent?.team ?? player.rightsTeam}-${player.id}-declined-${ledger.length}`,
          round,
          tier,
          team: incumbent?.team ?? player.rightsTeam,
          playerId: player.id,
          player: player.name,
          status: "declined",
          reason: match.canMatch
            ? `Declined exact offer sheet: match score ${formatNumber(match.score.total, 2)} below threshold after tax/apron, value, redundancy, and replacement`
            : `Could not legally match exact offer sheet: ${match.reason}`,
          offer: chosen.salary,
          legalMax: match.legalMax,
          tool: player.rights,
          playerUtility: match.score.total,
          teamUtility: match.score.total,
          teamPriority: match.score.total,
          needFit: match.score.needFit,
          rightsSource: player.rightsSource,
          capHoldType: player.capHoldType
        });
        if (incumbent) audit.push(auditFromMatch(incumbent.team, player, round, "declined", "Declined exact offer sheet", chosen.salary, match.legalMax, match.score));
      }
    }
  }

  player.team = signingTeam.team;
  player.salary = chosen.salary;
  player.status = "Signed";
  addPlayerToRoster(signingTeam, player);
  releaseCapHold(teams, player);
  const postToolRemaining = consumeSpendingTool(signingTeam, signingTool, chosen.salary);
  recordToolUse(signingTeam, player, signingTool, chosen.salary, postToolRemaining, matched ? "Matched offer sheet with retained rights." : chosen.toolReason);
  signingTeam.explanations.push(`${player.name} signed for ${formatMoney(chosen.salary)} AAV`);
  refreshTeamPayroll(signingTeam, assumptions);
  refreshTeamNeeds(signingTeam);
  resolutions.push(resolution);

  const alternatives = ranked
    .filter((offer) => offer.team.team !== chosen.team.team)
    .slice(0, 3)
    .map((offer) => `${offer.team.team}: ${formatMoney(offer.salary)} / ${offer.years} yrs / player score ${formatNumber(offer.bid.playerUtility, 2)}`);
  const losingReasons = ranked
    .filter((offer) => offer.team.team !== chosen.team.team)
    .slice(0, 3)
    .map((offer) => offer.team.team === highestMoney.team.team && closeMoneyWin
      ? `${offer.team.team}: highest AAV lost only because the money gap (${formatMoney(moneyGap)}) was inside the close-offer threshold`
      : `${offer.team.team}: lower money or weaker terms (${formatMoney(offer.salary)}, ${offer.years} yrs)`);
  const teamLogic = [
    `Team bid logic: need ${formatNumber(chosen.needFit, 2)}, roster count ${teamRosterCount(signingTeam)}/${standardRosterLimit(signingTeam)}, timeline ${formatNumber(chosen.timeline, 2)}, alternatives ${chosen.alternatives}, redundancy ${formatNumber(chosen.redundancy, 2)}`,
    `Ability to pay: ${chosen.bid.tool} up to ${formatMoney(chosen.bid.legalMax)}; pre-offer cap ${formatMoney(chosen.bid.capSnapshot.capSpace)}, A1 room ${formatMoney(chosen.bid.capSnapshot.firstApronRoom)}`,
    `Tool path: ${chosen.bid.capPath ?? "retained_rights"}; ${chosen.bid.toolReason ?? chosen.toolReason}`,
    player.holdActionReason ? `Hold planning: ${player.holdActionReason}` : `Market role: ${formatNumber(player.expectedMarketMinutes ?? 0, 0)} minutes from ${player.marketMinutesSource ?? "player projection"}`,
    `Tax/apron drag ${formatNumber(chosen.taxPain, 2)} and affordability ${formatNumber(chosen.affordability, 2)} shaped the bid amount, not the player choice`
  ];
  const explanation = matched
    ? `${signingTeam.team} matched ${offerSheetTeam}'s exact offer sheet for ${player.name}: ${formatMoney(chosen.salary)} AAV over ${chosen.years} years.`
    : offerSheetTeam && resolution.rfaMatchResult === "declined"
      ? `${offerSheetTeam} signed ${player.name} because ${player.rightsTeam} declined to match the exact ${formatMoney(chosen.salary)} AAV, ${chosen.years}-year offer sheet.`
      : `${chosen.team.team} signed ${player.name} on exact submitted terms: ${formatMoney(chosen.salary)} AAV over ${chosen.years} years. ${choice.reason}`;

  return {
    player,
    fromTeam: player.rightsTeam,
    toTeam: signingTeam.team,
    status: originalStatus === "Rookie FA" ? "Rookie FA" : matched || originalStatus === "RFA" ? "RFA" : "UFA",
    years: chosen.years,
    annualSalary: chosen.salary,
    totalSalary: chosen.salary * chosen.years,
    tool: signingTool,
    matched,
    offerSheetTeam,
    score,
    context: {
      toolName: matched ? player.rights : chosen.bid.tool,
      toolAmount: chosen.bid.capSnapshot.toolAmount,
      legalMax: chosen.bid.legalMax,
      playerMarket: player.marketValue,
      limiter: chosen.bid.limiter,
      capPath: matched ? incumbentCapPath(teams, player.rightsTeam) : chosen.bid.capPath,
      toolReason: matched ? "Matched with retained Bird/RFA rights; cap room and exceptions are not consumed." : chosen.bid.toolReason,
      holdAction: player.holdAction ?? "none",
      rightsValue: player.rightsValue,
      holdRetainScore: player.holdRetainScore,
      scarcityScore: player.scarcityScore,
      expectedMarketMinutes: player.expectedMarketMinutes,
      marketMinutesSource: player.marketMinutesSource,
      postToolRemaining,
      preCapSpace: chosen.bid.capSnapshot.capSpace,
      preHeldCapSpace: chosen.bid.capSnapshot.heldCapSpace,
      preRenouncedCapSpace: chosen.bid.capSnapshot.renouncedCapSpace,
      preTaxRoom: chosen.bid.capSnapshot.taxRoom,
      preFirstApronRoom: chosen.bid.capSnapshot.firstApronRoom,
      preSecondApronRoom: chosen.bid.capSnapshot.secondApronRoom,
      needFit: chosen.needFit,
      priority: chosen.bid.teamPriority,
      utility: chosen.bid.playerUtility,
      alternatives,
      logic: teamLogic,
      rightsSource: player.rightsSource,
      capHoldType: player.capHoldType,
      originalAsk: chosen.salary,
      clearingBid: chosen.salary,
      highestBid: highestMoney.salary,
      highestBidTeam: highestMoney.team.team,
      runnerUpBid: resolution.runnerUpBid,
      runnerUpTeam: resolution.runnerUpTeam,
      selectionMethod: closeMoneyWin
        ? "Player chose a close-money offer because years, role, and familiarity outweighed a small AAV gap."
        : "Player accepted the highest-money offer; team-side tax/timeline affected bid amount only.",
      bidComponents: chosen.bid.components,
      resolution,
      losingReasons,
      moneyGap,
      yearsGap,
      highestMoneyLostReason: closeMoneyWin ? choice.reason : undefined
    },
    explanation,
    plausibility: plausibilityFromScore(score, 0.5),
    marketResolution: resolution,
    bids: ranked.map((offer) => offer.bid),
    ledger: ledger.filter((row) => row.playerId === player.id)
  };
}

function canHonorOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(offer: TeamBidPlan<TPlayer, TTeam>, assumptions: MarketAssumptions): boolean {
  refreshTeamPayroll(offer.team, assumptions);
  if (!rosterOfferFit(offer.team, offer.player, assumptions).allowed) return false;
  if (offer.tool.kind === "bird") return offer.player.rightsTeam === offer.team.team && offer.player.rights !== "None" && offer.salary <= birdRightsAmount(offer.team, offer.player) + 100_000;
  if (offer.tool.kind === "cap") return offer.salary <= Math.max(0, offer.team.capSpace) + 100_000;
  if (offer.tool.kind === "non_taxpayer_mle" || offer.tool.kind === "bi_annual") {
    const tool = offer.team.exceptions.find((candidate) => candidate.kind === offer.tool.kind);
    const remaining = tool ? tool.amount - tool.used : 0;
    return (offer.team.capPath ?? "retained_rights") === "retained_rights" &&
      offer.team.payroll + offer.salary <= assumptions.firstApron + 100_000 &&
      offer.salary <= Math.min(remaining, Math.max(0, offer.team.firstApronRoom)) + 100_000;
  }
  if (offer.tool.kind === "taxpayer_mle") {
    const tool = offer.team.exceptions.find((candidate) => candidate.kind === "taxpayer_mle");
    const remaining = tool ? tool.amount - tool.used : 0;
    return (offer.team.capPath ?? "retained_rights") === "retained_rights" &&
      offer.team.payroll + offer.salary <= assumptions.secondApron + 100_000 &&
      offer.salary <= Math.min(remaining, Math.max(0, offer.team.secondApronRoom)) + 100_000;
  }
  if (offer.tool.kind === "room_exception") {
    const tool = offer.team.exceptions.find((candidate) => candidate.kind === "room_exception");
    const remaining = tool ? tool.amount - tool.used : 0;
    return (offer.team.capPath ?? "retained_rights") === "cap_room" && offer.salary <= remaining + 100_000;
  }
  const tool = offer.team.exceptions.find((candidate) => candidate.kind === "minimum");
  const remaining = tool ? tool.amount - tool.used : minimumSalary(offer.player);
  return offer.salary <= remaining + 100_000;
}

function recordUnresolved<TPlayer extends MarketPlayer>(
  player: TPlayer,
  round: number,
  tier: string,
  reason: string,
  ledger: MarketLedgerRow[],
  resolutions: MarketResolution[]
) {
  const alreadyResolved = resolutions.some((row) => row.playerId === player.id && row.unresolvedReason === reason);
  if (alreadyResolved) return;
  const id = `${round}-FA-${player.id}-unresolved-${ledger.length}`;
  ledger.push({ id, round, tier, team: "FA", playerId: player.id, player: player.name, status: "unresolved", reason });
  resolutions.push({ playerId: player.id, player: player.name, round, tier, clearingRule: "no signing", unresolvedReason: reason });
}

function playerChoiceComponents<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  salary: number,
  years: number,
  needFit: number,
  closeOfferAdjustment: number,
  isHighestMoney: boolean
): MarketComponentBreakdown {
  const profile = playerPreferenceProfile(player);
  const salaryComponent = clamp(salary / Math.max(player.marketValue, 1), 0, 1.35);
  const totalGuarantee = clamp((salary * years) / Math.max(player.marketValue * 4, 1), 0, 1.35);
  const roleFit = clamp(needFit * 0.72 + (1 - rosterRedundancyPenalty(team, player)) * 0.28, 0, 1);
  const familiarity = destinationFamiliarity(team, player);
  const security = clamp(years / 5, 0, 1);
  const scarcity = clamp((player.scarcityScore ?? 0) * 0.5 + clamp(player.marketValue / 34_000_000, 0, 1) * 0.5, 0, 1);
  const randomness = isHighestMoney ? 0.012 : 0;
  const total = clamp(
    salaryComponent * profile.salary +
      totalGuarantee * profile.totalGuarantee +
      security * profile.security +
      roleFit * profile.role +
      familiarity * profile.familiarity +
      scarcity * profile.scarcity +
      closeOfferAdjustment * profile.closeMoney +
      randomness,
    0,
    1.35
  );
  return {
    salary: salaryComponent,
    totalGuarantee,
    roleFit,
    timeline: 0,
    familiarity,
    willingness: 0,
    taxDrag: 0,
    scarcity,
    security,
    closeOfferAdjustment,
    randomness,
    total
  };
}

function rfaMatchDecision<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  salary: number,
  years: number,
  assumptions: MarketAssumptions,
  rng: () => number
) {
  const needFit = needFitScore(team, player.position, player.skills);
  const taxPain = taxPainScore(team, salary, assumptions);
  const legalMax = maxLegalOffer(team, player, assumptions, "bird").legalMax;
  const rosterFit = rosterOfferFit(team, player, assumptions);
  const canMatch = player.rightsTeam === team.team && player.rights !== "None" && salary <= legalMax + 100_000 && rosterFit.allowed;
  const rightsLeverage = rightsLeverageScore(team, player, assumptions);
  const score = makeScore({
    needFit,
    value: clamp(player.marketValue / Math.max(salary, 1), 0, 1.5),
    timeline: timelineFit(team, player),
    urgency: urgencyScore(team),
    taxPain,
    assetValue: player.tradeValue / Math.max(assumptions.cap, 1),
    replacement: player.replaceability,
    upsideRisk: player.upside - player.declineRisk - Math.max(0, years - 3) * 0.025,
    incumbency: clamp(0.78 + rightsLeverage * 0.3, 0, 1.1),
    randomness: centeredRandom(rng, assumptions.variance)
  });
  return {
    canMatch,
    legalMax,
    score,
    reason: canMatch
      ? "matching rights available"
      : !rosterFit.allowed
        ? rosterFit.reason
        : "no matching rights or outside offer exceeds legal max"
  };
}

function playerPreferenceProfile<TPlayer extends MarketPlayer>(player: TPlayer) {
  const star = player.score >= 82 || player.marketValue >= 24_000_000;
  const youngUpside = player.age <= 26 && (player.upside > 0.35 || player.marketValue >= 8_000_000);
  const veteran = player.age >= 31;
  const fringe = player.marketValue <= Math.max(minimumSalary(player) * 2.2, 4_000_000) || player.score < 52;
  if (star) {
    return { salary: 0.42, totalGuarantee: 0.16, security: 0.12, role: 0.14, familiarity: 0.06, scarcity: 0.04, closeMoney: 0.06 };
  }
  if (youngUpside) {
    return { salary: 0.38, totalGuarantee: 0.19, security: 0.17, role: 0.17, familiarity: 0.04, scarcity: 0.02, closeMoney: 0.04 };
  }
  if (veteran) {
    return { salary: 0.34, totalGuarantee: 0.24, security: 0.19, role: 0.1, familiarity: 0.08, scarcity: 0.02, closeMoney: 0.04 };
  }
  if (fringe) {
    return { salary: 0.39, totalGuarantee: 0.15, security: 0.13, role: 0.2, familiarity: 0.06, scarcity: 0.02, closeMoney: 0.05 };
  }
  return { salary: 0.38, totalGuarantee: 0.17, security: 0.15, role: 0.15, familiarity: 0.06, scarcity: 0.03, closeMoney: 0.05 };
}

function destinationFamiliarity<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer): number {
  if (player.rightsTeam === team.team) return player.holdAction === "renounced" ? 0.62 : 0.92;
  if (player.incumbentTeam === team.team) return 0.78;
  return 0.2;
}

function bestSpendingTool<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions): MarketTool | null {
  refreshTeamPayroll(team, assumptions);
  const capPath = team.capPath ?? (team.capSpace > minimumSalary(player) ? "cap_room" : "retained_rights");
  const rightsAmount = birdRightsAmount(team, player);
  const tools: MarketTool[] = [];
  if (player.rightsTeam === team.team && player.rights !== "None" && rightsAmount > minimumSalary(player)) {
    tools.push({ name: player.rights, amount: rightsAmount, used: 0, kind: "bird" });
  }
  if (capPath === "cap_room" && team.capSpace > minimumSalary(player)) {
    tools.push({ name: "Cap Space", amount: Math.max(team.capSpace, 0), used: 0, kind: "cap" });
  }
  team.exceptions.forEach((tool) => {
    const remaining = tool.amount - tool.used;
    if (remaining <= minimumSalary(player)) return;
    if (tool.kind === "room_exception" && capPath !== "cap_room") return;
    if (tool.kind === "room_exception" && team.capSpace > minimumSalary(player) && !capRoomMateriallyUsed(team)) return;
    if (isOverCapException(tool.kind) && capPath !== "retained_rights") return;
    if ((tool.kind === "non_taxpayer_mle" || tool.kind === "bi_annual") && team.firstApronRoom <= minimumSalary(player)) return;
    if (tool.kind === "taxpayer_mle" && team.secondApronRoom <= minimumSalary(player)) return;
    const apronLimitedAmount = hardCapsAtFirstApron(tool.kind)
      ? Math.min(remaining, Math.max(0, team.firstApronRoom))
      : tool.kind === "taxpayer_mle"
        ? Math.min(remaining, Math.max(0, team.secondApronRoom))
        : remaining;
    if (apronLimitedAmount > minimumSalary(player)) tools.push({ ...tool, amount: apronLimitedAmount });
  });
  return tools
    .map((tool) => ({ ...tool, amount: Math.max(0, tool.amount - tool.used) }))
    .filter((tool) => tool.amount >= minimumSalary(player))
    .sort((a, b) => Number(b.amount >= player.marketValue * 0.9) - Number(a.amount >= player.marketValue * 0.9) || toolRank(a.kind) - toolRank(b.kind) || b.amount - a.amount)[0] ?? null;
}

function maxLegalOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions, toolKind: MarketToolKind): { legalMax: number; limiter: string } {
  const individualMax = individualMaxSalary(player, assumptions);
  if (toolKind === "bird") return player.rightsTeam === team.team && player.rights !== "None"
    ? { legalMax: individualMax, limiter: `${player.rights} rights held by ${player.rightsTeam}; ${player.rightsSource || "local rights overlay"}` }
    : { legalMax: 0, limiter: `No Bird rights held by ${team.team}` };
  if (toolKind === "cap") return { legalMax: Math.min(Math.max(0, team.capSpace), individualMax), limiter: "cap room and individual max" };
  if (toolKind === "non_taxpayer_mle") return { legalMax: Math.min(exceptionAmount("non_taxpayer_mle", assumptions), Math.max(0, team.firstApronRoom), individualMax), limiter: "non-taxpayer MLE and first apron hard cap" };
  if (toolKind === "bi_annual") return { legalMax: Math.min(exceptionAmount("bi_annual", assumptions), Math.max(0, team.firstApronRoom), individualMax), limiter: "bi-annual exception and first apron hard cap" };
  if (toolKind === "taxpayer_mle") return { legalMax: Math.min(exceptionAmount("taxpayer_mle", assumptions), Math.max(0, team.secondApronRoom), individualMax), limiter: "taxpayer MLE and second apron limit" };
  if (toolKind === "room_exception") return { legalMax: Math.min(exceptionAmount("room_exception", assumptions), individualMax), limiter: "room exception after cap-room path" };
  return { legalMax: Math.min(minimumSalary(player), individualMax), limiter: "minimum exception" };
}

function spendingToolReason<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, tool: MarketTool): string {
  const capPath = team.capPath ?? "retained_rights";
  if (tool.kind === "bird") return `${player.rights}${player.status === "RFA" ? " / RFA match" : ""} rights retained for own free agent; team can exceed cap without spending room or exceptions.`;
  if (tool.kind === "cap") return `Cap-room path after modeled renouncements; ${team.capPathReason ?? "team opened room before outside bidding"}`;
  if (tool.kind === "room_exception") return "Room exception is available only after the cap-room path and after cap room has been used or exhausted.";
  if (tool.kind === "non_taxpayer_mle") return "Non-taxpayer MLE on retained-rights path; hard-capped at the first apron.";
  if (tool.kind === "taxpayer_mle") return "Taxpayer MLE on retained-rights tax path; blocked above the second apron.";
  if (tool.kind === "bi_annual") return "Bi-annual exception on retained-rights path; hard-capped at the first apron.";
  return capPath === "cap_room" ? "Minimum exception after cap-room spending." : "Minimum exception while retaining rights.";
}

function incumbentCapPath<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(teams: Map<string, TTeam>, team: string): string {
  return teams.get(team)?.capPath ?? "retained_rights";
}

function individualMaxSalary<TPlayer extends MarketPlayer>(player: TPlayer, assumptions: MarketAssumptions): number {
  const yoe = finiteNumber(player.original?.yoe, 0);
  const serviceMax = yoe >= 10 ? assumptions.cap * 0.35 : yoe >= 7 ? assumptions.cap * 0.3 : assumptions.cap * 0.25;
  return Math.max(serviceMax, player.salary * 1.05);
}

function teamPriorityForPlayer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  legalMax: number,
  assumptions: MarketAssumptions,
  need: number,
  timeline: number,
  taxPain: number,
  redundancy: number,
  alternatives: number
): number {
  const quality = clamp(player.score / 100, 0, 1);
  const affordability = clamp(legalMax / Math.max(player.marketValue, 1), 0, 1.25);
  const rightsLeverage = rightsLeverageScore(team, player, assumptions);
  const spendingPower = Math.max(teamSpendingPower(team, assumptions), minimumSalary(player));
  const maxCommitment = clamp(Math.min(legalMax, player.marketValue) / spendingPower, 0, 1);
  return clamp(
    need * 0.22 +
      quality * 0.19 +
      timeline * 0.15 +
      affordability * 0.12 +
      team.willingness * 0.09 +
      urgencyScore(team) * 0.07 +
      rightsLeverage * 0.18 -
      redundancy * 0.2 -
      taxPain * 0.12 -
      alternatives * 0.035 -
      maxCommitment * 0.04,
    0,
    1
  );
}

function rightsLeverageScore<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions): number {
  if (player.rightsTeam !== team.team || player.rights === "None") return 0;
  const rightType = player.status === "RFA" ? 0.48 : player.rights === "Bird" ? 0.34 : player.rights === "Early Bird" ? 0.2 : 0.08;
  const matchControl = player.status === "RFA" ? 0.18 : 0;
  const capBypass = (team.capPath ?? "retained_rights") === "retained_rights" && team.capSpace <= minimumSalary(player) ? 0.2 : 0;
  const holdScore = clamp(player.holdRetainScore ?? 0, 0, 1) * 0.16;
  const scarcity = clamp(player.scarcityScore ?? 0, 0, 1) * 0.1;
  const scale = clamp(player.marketValue / Math.max(assumptions.cap * 0.2, 1), 0, 0.16);
  return clamp(rightType + matchControl + capBypass + holdScore + scarcity + scale, 0, 1);
}

type RosterOfferFit = {
  allowed: boolean;
  reason: string;
  priorityAdjustment: number;
  slotFit: number;
  belowMinimum: boolean;
  clearUpgrade: boolean;
};

function rosterOfferFit<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions): RosterOfferFit {
  const count = teamRosterCount(team);
  const limit = standardRosterLimit(team);
  const legalRemaining = limit - count;
  const minimum = minimumRosterCount(team);
  const target = targetRosterCount(team);
  const targetRemaining = target - count;
  const belowMinimum = count < minimum;
  const slotFit = rosterJobFit(team, player, assumptions);
  const clearUpgrade = isClearRosterUpgrade(team, player, assumptions, slotFit);
  if (legalRemaining <= 0) {
    return { allowed: false, reason: `Standard roster limit reached (${count}/${limit})`, priorityAdjustment: -1, slotFit, belowMinimum, clearUpgrade };
  }
  if (targetRemaining <= 0 && !clearUpgrade) {
    return { allowed: false, reason: `Target roster size reached (${count}/${target}); only clear upgrades remain active`, priorityAdjustment: -0.6, slotFit, belowMinimum, clearUpgrade };
  }
  const finalSlotReserve = legalRemaining <= 1 &&
    !belowMinimum &&
    !clearUpgrade &&
    player.marketValue <= Math.max(minimumSalary(player) * 3, assumptions.cap * 0.025);
  if (finalSlotReserve) {
    return { allowed: false, reason: "Final standard roster slot reserved for a clearer rotation upgrade", priorityAdjustment: -0.5, slotFit, belowMinimum, clearUpgrade };
  }
  const priorityAdjustment = clamp(
    (belowMinimum ? 0.16 : targetRemaining > 0 ? 0.06 : -0.08) +
      (slotFit - 0.5) * 0.16 +
      (clearUpgrade ? 0.05 : 0) -
      (legalRemaining <= 2 && !belowMinimum ? 0.04 : 0),
    -0.28,
    0.28
  );
  return { allowed: true, reason: `Roster job fit ${formatNumber(slotFit, 2)} with ${legalRemaining} standard slot${legalRemaining === 1 ? "" : "s"} open`, priorityAdjustment, slotFit, belowMinimum, clearUpgrade };
}

function rosterJobFit<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions): number {
  const active = team.roster.filter((candidate) => candidate.status === "Signed");
  const credible = active.filter((candidate) => credibleRosterPlayer(candidate, assumptions));
  const primary = primaryPosition(player.position);
  const samePosition = credible.filter((candidate) => primaryPosition(candidate.position) === primary).length;
  const rotationCount = credible.length + Math.max(0, (team.rosterCountAdjustment ?? 0) * 0.35);
  const targetRotation = team.mode === "contender" || team.mode === "tax-sensitive contender" ? 9 : 8;
  const positionNeed = primary === "C"
    ? samePosition === 0 ? 0.9 : samePosition === 1 ? 0.62 : samePosition === 2 ? 0.34 : 0.16
    : samePosition <= 1 ? 0.82 : samePosition === 2 ? 0.58 : samePosition === 3 ? 0.34 : 0.16;
  const skillNeed = topPlayerSkills(player).some((skill) => team.needs.includes(skill)) ? 0.72 : 0.36;
  const rotationNeed = clamp((targetRotation - rotationCount) / Math.max(targetRotation, 1), 0, 1);
  const qualityNeed = clamp(player.score / 100 + player.marketValue / Math.max(assumptions.cap * 0.35, 1), 0, 1.15);
  return clamp(positionNeed * 0.34 + skillNeed * 0.26 + rotationNeed * 0.2 + qualityNeed * 0.2, 0, 1);
}

function credibleRosterPlayer<TPlayer extends MarketPlayer>(player: TPlayer, assumptions: MarketAssumptions): boolean {
  return player.score >= 58 || player.marketValue >= assumptions.cap * 0.045 || player.salary >= assumptions.cap * 0.045 || (player.expectedMarketMinutes ?? 0) >= 1100;
}

function isClearRosterUpgrade<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, assumptions: MarketAssumptions, slotFit: number): boolean {
  if (player.score >= 72 || player.marketValue >= assumptions.cap * 0.07) return true;
  const signed = team.roster.filter((candidate) => candidate.status === "Signed");
  const weakest = signed.slice().sort((a, b) => a.score - b.score || a.marketValue - b.marketValue)[0];
  if (!weakest) return true;
  return player.score >= 62 && slotFit >= 0.66 && (player.score >= weakest.score + 8 || player.marketValue >= weakest.marketValue + assumptions.cap * 0.018);
}

function teamRosterCount<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  return team.roster.length + (team.rosterCountAdjustment ?? 0);
}

function standardRosterLimit<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  return team.standardRosterLimit ?? STANDARD_ROSTER_LIMIT;
}

function minimumRosterCount<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  return team.minimumRosterCount ?? MINIMUM_STANDARD_ROSTER;
}

function targetRosterCount<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  if (typeof team.targetRosterCount === "number") return Math.min(standardRosterLimit(team), Math.max(minimumRosterCount(team), team.targetRosterCount));
  if (team.mode === "tax-sensitive contender" || team.mode === "rebuilding" || team.mode === "rising") return Math.min(standardRosterLimit(team), 14);
  return standardRosterLimit(team);
}

function legalRosterSlotsRemaining<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  return Math.max(0, standardRosterLimit(team) - teamRosterCount(team));
}

function addPlayerToRoster<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer) {
  team.roster = team.roster.filter((candidate) => candidate.id !== player.id);
  team.roster.push(player);
}

function teamSpendingPower<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, assumptions: MarketAssumptions): number {
  refreshTeamPayroll(team, assumptions);
  const capPath = team.capPath ?? "retained_rights";
  const exceptionPower = team.exceptions.reduce((total, tool) => {
    if (isOverCapException(tool.kind) && capPath !== "retained_rights") return total;
    if (tool.kind === "room_exception" && capPath !== "cap_room") return total;
    if ((tool.kind === "non_taxpayer_mle" || tool.kind === "bi_annual") && team.firstApronRoom <= 0) return total;
    if (tool.kind === "taxpayer_mle" && team.secondApronRoom <= 0) return total;
    const apronLimit = hardCapsAtFirstApron(tool.kind)
      ? team.firstApronRoom
      : tool.kind === "taxpayer_mle"
        ? team.secondApronRoom
        : tool.amount;
    return total + Math.max(0, Math.min(tool.amount - tool.used, apronLimit));
  }, 0);
  const capPower = capPath === "cap_room" ? Math.max(0, team.capSpace) : 0;
  const rightsPower = capPath === "retained_rights" ? Math.min(assumptions.cap * 0.35, Math.max(0, team.renouncedCapSpace - team.capSpace)) : 0;
  return Math.max(capPower, exceptionPower, rightsPower * 0.45);
}

function refreshTeamPayrolls<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(teams: Map<string, TTeam>, assumptions: MarketAssumptions) {
  teams.forEach((team) => refreshTeamPayroll(team, assumptions));
}

function refreshTeamPayroll<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, assumptions: MarketAssumptions) {
  team.activeSalary = sum(team.roster.map((player) => player.salary)) + (team.activeSalaryAdjustment ?? 0);
  team.guaranteedSalary = sum(team.roster.map((player) => player.guaranteedSalary || player.salary)) + (team.guaranteedSalaryAdjustment ?? 0);
  team.payroll = team.activeSalary + team.deadCap;
  team.rosterCharges = Math.max(0, minimumRosterCount(team) - teamRosterCount(team)) * (team.minimumRosterCharge ?? assumptions.cap * 0.008);
  team.maximumCapSpace = assumptions.cap - team.payroll - team.rosterCharges;
  team.heldCapSpace = team.maximumCapSpace - team.capHolds;
  const capPath = team.capPath ?? (team.maximumCapSpace > assumptions.cap * 0.09 && team.heldCapSpace < team.maximumCapSpace - assumptions.cap * 0.03 ? "cap_room" : "retained_rights");
  team.capSpace = capPath === "cap_room" ? Math.max(0, team.heldCapSpace) : team.heldCapSpace;
  team.renouncedCapSpace = team.maximumCapSpace;
  team.taxRoom = assumptions.tax - team.payroll;
  team.firstApronRoom = assumptions.firstApron - team.payroll;
  team.secondApronRoom = assumptions.secondApron - team.payroll;
}

function refreshTeamNeeds<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam) {
  const signed = team.roster.filter((player) => player.status === "Signed");
  if (signed.length === 0) return;
  const skillKeys: SkillKey[] = ["FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"];
  team.needs = skillKeys
    .map((skill) => ({ skill, value: avg(signed.map((player) => player.skills[skill])) - (skill === "PASS" || skill === "SHOOT" ? 0.15 : 0) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((row) => row.skill);
}

function releaseCapHold<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(teams: Map<string, TTeam>, player: TPlayer) {
  const incumbent = teams.get(player.rightsTeam);
  if (!incumbent) return;
  const hold = capHoldForPlayer(player);
  incumbent.capHolds = Math.max(0, incumbent.capHolds - hold);
  if (typeof incumbent.holdsRetained === "number") incumbent.holdsRetained = Math.max(0, incumbent.holdsRetained - hold);
}

function consumeSpendingTool<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, kind: MarketToolKind, salary: number): number {
  if (kind === "cap") return Math.max(0, team.capSpace - salary);
  if (kind === "bird") return 0;
  const tool = team.exceptions.find((candidate) => candidate.kind === kind && candidate.amount - candidate.used > 0);
  if (!tool) return 0;
  tool.used = Math.min(tool.amount, tool.used + salary);
  return Math.max(0, tool.amount - tool.used);
}

function recordToolUse<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, kind: MarketToolKind, salary: number, remaining: number, reason: string) {
  if (!team.toolLedger) team.toolLedger = [];
  team.toolLedger.push({ player: player.name, tool: kind, amount: salary, remaining, reason });
}

function makeScore(parts: Omit<MarketScore, "total">): MarketScore {
  const total = clamp(
    parts.needFit * 0.16 +
      parts.value * 0.22 +
      parts.timeline * 0.12 +
      parts.urgency * 0.1 -
      parts.taxPain * 0.14 +
      parts.assetValue * 0.1 +
      parts.replacement * 0.06 +
      parts.upsideRisk * 0.1 +
      parts.incumbency * 0.08 +
      parts.randomness * 0.08,
    0,
    1
  );
  return { ...parts, total };
}

function ledgerFromBid(bid: MarketBid, status: MarketLedgerRow["status"], reason: string): MarketLedgerRow {
  return {
    id: `${bid.round}-${bid.team}-${bid.playerId}-${status}-${bid.toolKind}-${Math.round(bid.submittedAav)}`,
    round: bid.round,
    tier: bid.tier,
    team: bid.team,
    playerId: bid.playerId,
    player: bid.player,
    status,
    reason,
    offer: bid.submittedAav,
    legalMax: bid.legalMax,
    tool: bid.tool,
    playerUtility: bid.playerUtility,
    teamUtility: bid.teamUtility,
    teamPriority: bid.teamPriority,
    needFit: bid.components.roleFit,
    capHoldType: bid.limiter,
    capPath: bid.capPath,
    toolReason: bid.toolReason,
    holdAction: bid.holdAction,
    rightsValue: bid.rightsValue,
    holdRetainScore: bid.holdRetainScore,
    scarcityScore: bid.scarcityScore,
    expectedMarketMinutes: bid.expectedMarketMinutes,
    marketMinutesSource: bid.marketMinutesSource
  };
}

function auditFromBid<TPlayer extends MarketPlayer>(bid: MarketBid, player: TPlayer, status: LegacyAuditStatus, reason: string): LegacyAuditRow {
  return {
    id: `${bid.round}-${bid.team}-${bid.playerId}-${status}-${bid.toolKind}`,
    round: bid.round,
    team: bid.team,
    player: bid.player,
    playerId: bid.playerId,
    status,
    reason,
    toolName: bid.tool,
    offer: bid.submittedAav,
    legalMax: bid.legalMax,
    marketValue: player.marketValue,
    priority: bid.teamPriority,
    needFit: bid.components.roleFit,
    rightsSource: player.rightsSource,
    capHoldType: player.capHoldType
  };
}

function recordRejectedOffer<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(
  team: TTeam,
  player: TPlayer,
  round: number,
  tier: string,
  reason: string,
  toolName: string | undefined,
  offer: number | undefined,
  legalMax: number | undefined,
  ledger: MarketLedgerRow[],
  audit: LegacyAuditRow[]
) {
  const material = player.score >= 70 || player.marketValue >= 10_000_000 || player.rightsTeam === team.team;
  if (!material) return;
  const id = `${round}-${team.team}-${player.id}-rejected-${ledger.length}`;
  ledger.push({
    id,
    round,
    tier,
    team: team.team,
    playerId: player.id,
    player: player.name,
    status: "rejected",
    reason,
    offer,
    legalMax,
    tool: toolName,
    rightsSource: player.rightsSource,
    capHoldType: player.capHoldType
  });
  audit.push({
    id,
    round,
    team: team.team,
    player: player.name,
    playerId: player.id,
    status: "reject",
    reason,
    toolName,
    offer,
    legalMax,
    marketValue: player.marketValue,
    rightsSource: player.rightsSource,
    capHoldType: player.capHoldType
  });
}

function auditFromMatch<TPlayer extends MarketPlayer>(team: string, player: TPlayer, round: number, status: "matched" | "declined", reason: string, offer: number, legalMax: number, score: MarketScore): LegacyAuditRow {
  return {
    id: `${round}-${team}-${player.id}-${status}`,
    round,
    team,
    player: player.name,
    playerId: player.id,
    status,
    reason,
    toolName: player.rights,
    offer,
    legalMax,
    marketValue: player.marketValue,
    priority: score.total,
    needFit: score.needFit,
    rightsSource: player.rightsSource,
    capHoldType: player.capHoldType
  };
}

function valueScore<TPlayer extends MarketPlayer>(player: TPlayer, salary: number): number {
  return clamp(player.marketValue / Math.max(salary, 1), 0, 1.6);
}

function countAlternatives<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer, players: TPlayer[]): number {
  return players.filter((candidate) =>
    candidate.id !== player.id &&
    Math.abs(candidate.marketValue - player.marketValue) <= Math.max(5_000_000, player.marketValue * 0.28) &&
    needFitScore(team, candidate.position, candidate.skills) >= needFitScore(team, player.position, player.skills) - 0.08
  ).length;
}

function uniquePlayers<TPlayer extends MarketPlayer>(players: TPlayer[]): TPlayer[] {
  const seen = new Set<string>();
  return players.filter((player) => {
    if (seen.has(player.id)) return false;
    seen.add(player.id);
    return true;
  });
}

function needFitScore<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, position: string, skills: Record<SkillKey, number>): number {
  const skillNeed = avg(team.needs.map((skill) => clamp((skills[skill] + 2.5) / 5, 0, 1)));
  const rosterPositionCount = team.roster.filter((player) => primaryPosition(player.position) === primaryPosition(position)).length;
  const positionNeed = clamp(1 - rosterPositionCount / 5, 0.2, 1);
  return clamp(skillNeed * 0.72 + positionNeed * 0.28, 0, 1);
}

function timelineFit<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer): number {
  if (team.mode === "rebuilding") return clamp(player.upside * 0.7 + (28 - player.age) / 18, 0, 1);
  if (team.mode === "contender" || team.mode === "tax-sensitive contender") return clamp(player.score / 100 - player.declineRisk * 0.25, 0, 1);
  return clamp(0.65 - Math.abs(player.age - 27) / 14 + player.score / 260, 0, 1);
}

function urgencyScore<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): number {
  const rosterNeed = clamp((minimumRosterCount(team) - teamRosterCount(team)) / 7, 0, 1);
  const modeUrgency = team.mode === "contender" ? 0.82 : team.mode === "tax-sensitive contender" ? 0.68 : team.mode === "playoff hopeful" ? 0.62 : team.mode === "rising" ? 0.54 : 0.42;
  const capUrgency = team.capSpace > 12_000_000 ? 0.68 : team.taxRoom < 0 ? 0.36 : 0.5;
  return clamp(modeUrgency * 0.5 + rosterNeed * 0.28 + capUrgency * 0.22, 0, 1);
}

function taxPainScore<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, salary: number, assumptions: MarketAssumptions): number {
  const postPayroll = team.payroll + salary;
  const tax = Math.max(0, postPayroll - assumptions.tax) / assumptions.cap;
  const apron1 = Math.max(0, postPayroll - assumptions.firstApron) / assumptions.cap;
  const apron2 = Math.max(0, postPayroll - assumptions.secondApron) / assumptions.cap;
  return clamp((tax * 0.8 + apron1 * 1.4 + apron2 * 2.2) * assumptions.taxSensitivity, 0, 1);
}

function rosterRedundancyPenalty<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer): number {
  const active = team.roster.filter((candidate) => candidate.status === "Signed");
  const samePosition = active.filter((candidate) => primaryPosition(candidate.position) === primaryPosition(player.position) && candidate.score >= 58).length;
  const sameSkill = topPlayerSkills(player)
    .map((skill) => active.filter((candidate) => candidate.skills[skill] >= 1.1 && candidate.score >= 55).length)
    .reduce((total, count) => total + Math.max(0, count - 1), 0);
  const countPressure = Math.max(0, teamRosterCount(team) - targetRosterCount(team)) * 0.12;
  return clamp(samePosition * 0.16 + sameSkill * 0.08 + countPressure, 0, 0.75);
}

function primaryPosition(position: string): string {
  const value = position.toUpperCase();
  if (value.includes("PG") || value.includes("SG") || value.includes("G")) return "G";
  if (value.includes("SF") || value.includes("PF") || value.includes("F")) return "F";
  if (value.includes("C")) return "C";
  return value.slice(0, 1) || "U";
}

function topPlayerSkills<TPlayer extends MarketPlayer>(player: TPlayer): SkillKey[] {
  const skillKeys: SkillKey[] = ["FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"];
  return skillKeys
    .map((skill) => ({ skill, value: player.skills[skill] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((row) => row.skill);
}

function contractYears<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(player: TPlayer, team: TTeam, rng: () => number): number {
  if (player.marketValue > 32_000_000 && player.age < 30) return player.rightsTeam === team.team ? 5 : 4;
  if (player.marketValue > 20_000_000 && player.age < 32) return rng() > 0.25 ? 4 : 3;
  if (player.marketValue > 15_000_000) return rng() > 0.35 ? 3 : 4;
  if (player.age > 32) return rng() > 0.55 ? 1 : 2;
  return rng() > 0.5 ? 2 : 3;
}

function birdRightsAmount<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam, player: TPlayer): number {
  if (player.rightsTeam !== team.team) return 0;
  if (player.rights === "Bird") return player.marketValue * 1.35;
  if (player.rights === "Early Bird") return Math.max(player.marketValue * 1.05, player.salary * 1.75);
  if (player.rights === "Non-Bird") return Math.max(minimumSalary(player), player.salary * 1.2);
  return 0;
}

function capHoldForPlayer<TPlayer extends MarketPlayer>(player: TPlayer): number {
  if (player.capHold > 0) return player.capHold;
  if (player.status === "Rookie FA") return 0;
  const projectionHold = finiteNumber(player.original?.projection_effective_contract_y1, 0);
  const marketHold = player.marketValue * (player.status === "RFA" ? 1.15 : 0.85);
  const salaryHold = player.salary * (player.status === "Team Option" || player.status === "Player Option" ? 1 : 1.2);
  return Math.max(minimumSalary(player), Math.min(Math.max(projectionHold, salaryHold, marketHold), player.marketValue * 1.45));
}

function minimumSalary<TPlayer extends MarketPlayer>(player: TPlayer): number {
  return player.age > 30 ? 2_500_000 : 1_500_000;
}

function toolRank(kind: MarketToolKind): number {
  if (kind === "bird") return 0;
  if (kind === "cap") return 1;
  if (kind === "non_taxpayer_mle") return 2;
  if (kind === "taxpayer_mle") return 3;
  if (kind === "bi_annual") return 4;
  if (kind === "room_exception") return 5;
  return 6;
}

const TAXPAYER_MLE_BASE_2024 = 5_000_000;
const TAXPAYER_MLE_BASE_CAP_2024 = 136_021_000;

function exceptionAmount(kind: MarketToolKind, assumptions: MarketAssumptions): number {
  if (kind === "non_taxpayer_mle") return assumptions.cap * 0.0912;
  if (kind === "bi_annual") return assumptions.cap * 0.0353;
  if (kind === "room_exception") return assumptions.cap * 0.05678;
  if (kind === "taxpayer_mle") return TAXPAYER_MLE_BASE_2024 * (assumptions.cap / TAXPAYER_MLE_BASE_CAP_2024);
  return 0;
}

function isMarketExceptionTool(kind: MarketToolKind): boolean {
  return kind === "non_taxpayer_mle" || kind === "taxpayer_mle" || kind === "room_exception" || kind === "bi_annual";
}

function isOverCapException(kind: MarketToolKind): boolean {
  return kind === "non_taxpayer_mle" || kind === "taxpayer_mle" || kind === "bi_annual";
}

function hardCapsAtFirstApron(kind: MarketToolKind): boolean {
  return kind === "non_taxpayer_mle" || kind === "bi_annual";
}

function capRoomMateriallyUsed<TPlayer extends MarketPlayer, TTeam extends MarketTeam<TPlayer>>(team: TTeam): boolean {
  return (team.toolLedger ?? []).some((row) => row.tool === "cap" && row.amount >= 1_000_000);
}

function plausibilityFromScore(score: MarketScore, floor: number): number {
  return clamp(floor + score.total * 0.42 - Math.abs(score.randomness) * 0.08, 0.05, 0.98);
}

function centeredRandom(rng: () => number, variance: number): number {
  return (rng() - 0.5) * 2 * variance;
}

function finiteNumber(...values: Array<number | null | undefined>): number {
  const value = values.find((item) => typeof item === "number" && Number.isFinite(item));
  return value ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
