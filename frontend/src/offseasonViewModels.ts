import type { MarketBid, MarketLedgerRow, MarketResolution } from "./types";

export type OffseasonLens = "story" | "teams" | "markets" | "lab";
export type OffseasonEventKind = "option" | "draft" | "trade" | "signing" | "rfa_match" | "unsigned" | "cap_path";
export type OffseasonPhase = "Options" | "Draft" | "Trades" | "Free Agency" | "Final State";
export type OffseasonTone = "good" | "warn" | "bad" | "neutral";

export type OffseasonDecisionScore = {
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

export type OffseasonEvent = {
  id: string;
  kind: OffseasonEventKind;
  phase: OffseasonPhase;
  phaseOrder: number;
  sortOrder: number;
  actor: string;
  action: string;
  movement: string;
  team: string;
  teams: string[];
  playerId?: string;
  player?: string;
  amount?: number;
  amountLabel?: string;
  tool?: string;
  impact: string;
  confidence?: number;
  outcomePct?: number;
  outcomeLabel?: string;
  outcomeCount?: number;
  outcomeAvgPick?: number;
  why: string;
  tone: OffseasonTone;
  tags: string[];
  searchText: string;
  score?: OffseasonDecisionScore;
  auditRows?: MarketLedgerRow[];
  bids?: MarketBid[];
  logic?: string[];
  sourceId: string;
};

export type TeamStory = {
  team: string;
  name: string;
  mode: string;
  headline: string;
  capPath: string;
  capPathReason: string;
  payroll: number;
  capSpace: number;
  taxRoom: number;
  firstApronRoom: number;
  secondApronRoom: number;
  rosterCount: number;
  standardRosterLimit: number;
  projectedWins: number;
  rank: number;
  conferenceRank: number;
  playoffStatus: string;
  offense?: number;
  defense?: number;
  total?: number;
  adjustedTotal?: number;
  needs: string[];
  core: string[];
  warnings: string[];
  incomingCount: number;
  outgoingCount: number;
  draftCount: number;
  tradeCount: number;
  rosterDelta: number;
  eventIds: string[];
  events: OffseasonEvent[];
  unresolved: string[];
  outcomePct?: number;
  outcomeLabel?: string;
  roster: Array<{
    id: string;
    name: string;
    nbaId?: number | null;
    position: string;
    salary: number;
    marketValue?: number;
    minutes: number;
    offense?: number;
    defense?: number;
    total: number;
    score?: number;
    status?: string;
    tier: string;
  }>;
};

export type MarketStory = {
  id: string;
  playerId: string;
  player: string;
  status: string;
  fromTeam: string;
  toTeam: string;
  movement: string;
  position?: string;
  score?: number;
  tier?: string;
  marketValue?: number;
  rightsTeam?: string;
  expectedMarketMinutes?: number;
  annualSalary?: number;
  totalSalary?: number;
  years?: number;
  tool?: string;
  capPath?: string;
  winner: string;
  runnerUp?: string;
  highestBid?: string;
  moneyGap?: number;
  role?: string;
  confidence?: number;
  outcomePct?: number;
  outcomeLabel?: string;
  outcomeCount?: number;
  outcomeAvgSalary?: number;
  rfaMatchPct?: number;
  rfaMatchCount?: number;
  rfaOfferCount?: number;
  why: string;
  incumbentDecision?: string;
  offerSheetTeam?: string;
  matched?: boolean;
  unresolvedReason?: string;
  bids: MarketBid[];
  ledger: MarketLedgerRow[];
  lostReasons: string[];
  logic: string[];
};

export type LeagueDigest = {
  headline: string;
  subhead: string;
  metrics: Array<{ label: string; value: string; tone: OffseasonTone }>;
  topEvents: OffseasonEvent[];
  volatile: Array<{ label: string; detail: string; pct: number }>;
  phaseCounts: Record<OffseasonPhase, number>;
};

export type OffseasonViewModels = {
  digest: LeagueDigest;
  events: OffseasonEvent[];
  teamStories: TeamStory[];
  marketStories: MarketStory[];
};

export type MultiRunSummaryLike = {
  runs: number;
  playerDestinations: Array<{ player: string; destination: string; count: number; pct: number; avgSalary: number }>;
  optionDecisions: Array<{ player: string; team: string; decision: string; optionType: string; count: number; pct: number }>;
  draftOutcomes: Array<{ prospect: string; team: string; count: number; pct: number; avgPick: number }>;
  tradeTeams: Array<{ team: string; count: number; pct: number }>;
  teamOutcomes: Array<{ team: string; outcome: string; count: number; pct: number; avgPayroll: number; avgCapSpace: number; avgTaxRoom: number }>;
  rfaMatches: Array<{ player: string; matches: number; offers: number; pct: number }>;
  volatileDecisions: Array<{ entity: string; outcome: string; count: number; pct: number }>;
  unresolvedMarkets: Array<{ entity: string; outcome: string; count: number; pct: number }>;
};

type PlayerLike = {
  id: string;
  name: string;
  team: string;
  incumbentTeam: string;
  rightsTeam: string;
  status: string;
  position: string;
  salary: number;
  marketValue: number;
  tier: string;
  expectedMarketMinutes: number;
  score?: number;
  rights?: string;
  declinedOptionType?: string;
};

type TeamLike = {
  team: string;
  name: string;
  mode: string;
  capPath: string;
  capPathReason: string;
  payroll: number;
  capSpace: number;
  taxRoom: number;
  firstApronRoom: number;
  secondApronRoom: number;
  rosterCount: number;
  standardRosterLimit: number;
  minimumRosterCount: number;
  rosterCore: string[];
  needs: string[];
  strength: {
    projectedWins: number;
    rank: number;
    conferenceRank: number;
    playoffStatus: string;
    offense?: number;
    defense?: number;
    total?: number;
    adjustedTotal?: number;
  };
  roster: Array<{
    id: string;
    name: string;
    nbaId?: number | null;
    position: string;
    salary: number;
    marketValue?: number;
    minutes: number;
    offense?: number;
    defense?: number;
    total: number;
    score?: number;
    status?: string;
    tier: string;
  }>;
};

type DraftLike = {
  pick: number;
  team: string;
  prospect: { id: string; name: string; position: string; tier: string; rank: number };
  consensusRank: number;
  modelRank: number;
  fitDelta: number;
  reachSteal: "Reach" | "Range" | "Steal";
  score: OffseasonDecisionScore;
  explanation: string;
  plausibility: number;
};

type OptionLike = {
  player: PlayerLike;
  team: string;
  optionType: string;
  decision: "exercise" | "decline" | string;
  score: OffseasonDecisionScore;
  explanation: string;
  plausibility: number;
};

type SigningLike = {
  player: PlayerLike;
  fromTeam: string;
  toTeam: string;
  status: "UFA" | "RFA" | "Rookie FA" | string;
  years: number;
  annualSalary: number;
  totalSalary: number;
  tool: string;
  matched?: boolean;
  offerSheetTeam?: string;
  score: OffseasonDecisionScore;
  context: {
    toolName: string;
    capPath?: string;
    highestBidTeam?: string;
    highestBid?: number;
    runnerUpBid?: number;
    runnerUpTeam?: string;
    moneyGap?: number;
    expectedMarketMinutes?: number;
    marketMinutesSource?: string;
    incumbentDecision?: "matched" | "declined" | "not_applicable";
    incumbentDecisionReason?: string;
    logic: string[];
    losingReasons?: string[];
    limiter: string;
  };
  explanation: string;
  plausibility: number;
};

type TradeLike = {
  id: string;
  teamA: string;
  teamB: string;
  player: PlayerLike;
  salary: number;
  pickValue: number;
  buyerGets: string[];
  sellerGets: string[];
  sellerMotivation: string;
  buyerMotivation: string;
  scoreA: OffseasonDecisionScore;
  scoreB: OffseasonDecisionScore;
  explanation: string;
  plausibility: number;
};

type RunLike = {
  season: number;
  capYear: number;
  draftYear: number;
  draft: DraftLike[];
  options: OptionLike[];
  freeAgency: SigningLike[];
  trades: TradeLike[];
  teams: TeamLike[];
  players: PlayerLike[];
  marketBids: MarketBid[];
  marketLedger: MarketLedgerRow[];
  marketResolutions: MarketResolution[];
};

export function buildOffseasonViewModels(run: RunLike, multiRun: MultiRunSummaryLike | null = null): OffseasonViewModels {
  const events = buildEvents(run, multiRun);
  const teamStories = buildTeamStories(run, events, multiRun);
  const marketStories = buildMarketStories(run, multiRun);
  const digest = buildLeagueDigest(run, events, teamStories, multiRun);
  return { digest, events, teamStories, marketStories };
}

export function filterOffseasonEvents(
  events: OffseasonEvent[],
  filters: { team?: string; query?: string; kind?: OffseasonEventKind | "all" }
): OffseasonEvent[] {
  const team = filters.team && filters.team !== "All" ? filters.team : "";
  const query = filters.query?.trim().toLowerCase() ?? "";
  const kind = filters.kind ?? "all";
  return events.filter((event) => {
    const teamMatch = !team || event.teams.includes(team);
    const kindMatch = kind === "all" || event.kind === kind;
    const queryMatch = !query || event.searchText.includes(query);
    return teamMatch && kindMatch && queryMatch;
  });
}

function buildEvents(run: RunLike, multiRun: MultiRunSummaryLike | null): OffseasonEvent[] {
  const bidRowsByPlayer = rowsByPlayer(run.marketBids);
  const ledgerRowsByPlayer = rowsByPlayer(run.marketLedger);
  const resolutionByPlayer = new Map(run.marketResolutions.map((row) => [row.playerId, row]));
  const signedPlayerIds = new Set(run.freeAgency.map((row) => row.player.id));
  const exercisedPlayerIds = new Set(run.options.filter((row) => row.decision === "exercise").map((row) => row.player.id));
  const draftedPlayerIds = draftedProspectIds(run);
  const events: OffseasonEvent[] = [];

  run.options.forEach((decision, index) => {
    const action = `${titleCase(decision.decision)} ${decision.optionType}`;
    const outcome = optionDecisionOutcome(multiRun, decision.player.name, decision.team, decision.decision, decision.optionType);
    events.push(event({
      id: `option-${decision.team}-${decision.player.id}`,
      kind: "option",
      phase: "Options",
      sortOrder: index,
      actor: decision.player.name,
      action,
      movement: decision.team,
      team: decision.team,
      teams: [decision.team],
      playerId: decision.player.id,
      player: decision.player.name,
      amount: decision.player.salary,
      amountLabel: "salary",
      tool: decision.optionType,
      impact: `${decision.player.tier} / ${decision.player.position}`,
      confidence: decision.plausibility,
      outcomePct: outcome?.pct,
      outcomeLabel: outcome ? `${titleCase(outcome.decision)} ${outcome.optionType}` : undefined,
      outcomeCount: outcome?.count,
      why: decision.explanation,
      tone: decision.decision === "exercise" ? "good" : "warn",
      tags: ["option", decision.optionType, decision.decision],
      score: decision.score,
      sourceId: decision.player.id
    }));
  });

  run.draft.forEach((selection) => {
    const outcome = draftPairingOutcome(multiRun, selection.prospect.name, selection.team);
    events.push(event({
      id: `draft-${selection.pick}-${selection.team}`,
      kind: "draft",
      phase: "Draft",
      sortOrder: selection.pick,
      actor: selection.prospect.name,
      action: `Pick ${selection.pick}`,
      movement: selection.team,
      team: selection.team,
      teams: [selection.team],
      playerId: selection.prospect.id,
      player: selection.prospect.name,
      tool: selection.reachSteal,
      impact: `${selection.prospect.position} / model #${round(selection.modelRank)} / board #${round(selection.consensusRank)}`,
      confidence: selection.plausibility,
      outcomePct: outcome?.pct,
      outcomeLabel: outcome ? `${outcome.team} draft pairing` : undefined,
      outcomeCount: outcome?.count,
      outcomeAvgPick: outcome?.avgPick,
      why: selection.explanation,
      tone: selection.reachSteal === "Steal" ? "good" : selection.reachSteal === "Reach" ? "warn" : "neutral",
      tags: ["draft", selection.reachSteal, selection.prospect.position, selection.prospect.tier],
      score: selection.score,
      sourceId: String(selection.pick)
    }));
  });

  run.trades.forEach((trade, index) => {
    const outcome = tradeTeamOutcome(multiRun, trade.teamB);
    events.push(event({
      id: `trade-${trade.id}`,
      kind: "trade",
      phase: "Trades",
      sortOrder: index,
      actor: trade.player.name,
      action: "Trade",
      movement: `${trade.teamA} -> ${trade.teamB}`,
      team: trade.teamB,
      teams: [trade.teamA, trade.teamB],
      playerId: trade.player.id,
      player: trade.player.name,
      amount: trade.pickValue,
      amountLabel: "pick EV",
      tool: "Trade",
      impact: trade.buyerGets.join(" / "),
      confidence: trade.plausibility,
      outcomePct: outcome?.pct,
      outcomeLabel: outcome ? `${outcome.team} trade involvement` : undefined,
      outcomeCount: outcome?.count,
      why: trade.explanation,
      tone: "warn",
      tags: ["trade", trade.teamA, trade.teamB],
      score: trade.scoreB,
      sourceId: trade.id
    }));
  });

  run.freeAgency.forEach((signing, index) => {
    const isRfaMatch = signing.status === "RFA" && Boolean(signing.offerSheetTeam);
    const ownTeam = signing.toTeam === signing.fromTeam;
    events.push(event({
      id: `fa-${signing.player.id}-${signing.toTeam}`,
      kind: isRfaMatch ? "rfa_match" : "signing",
      phase: "Free Agency",
      sortOrder: index,
      actor: signing.player.name,
      action: isRfaMatch ? (signing.matched ? "Matched offer sheet" : "RFA offer sheet") : ownTeam ? "Re-signed" : "Signed",
      movement: ownTeam ? signing.toTeam : `${signing.fromTeam || "FA"} -> ${signing.toTeam}`,
      team: signing.toTeam,
      teams: uniqueTeams([signing.toTeam, signing.fromTeam, signing.offerSheetTeam]),
      playerId: signing.player.id,
      player: signing.player.name,
      amount: signing.annualSalary,
      amountLabel: "AAV",
      tool: signing.context.toolName || signing.tool,
      impact: `${signing.years} years / ${roleLabel(signing.context.expectedMarketMinutes ?? signing.player.expectedMarketMinutes)}`,
      confidence: signing.plausibility,
      why: signing.explanation,
      tone: signing.matched || ownTeam ? "neutral" : "good",
      tags: ["free agency", signing.status, signing.context.toolName, signing.toTeam, signing.fromTeam],
      score: signing.score,
      auditRows: ledgerRowsByPlayer.get(signing.player.id),
      bids: bidRowsByPlayer.get(signing.player.id),
      logic: signing.context.logic,
      sourceId: signing.player.id
    }));
  });

  run.players
    .filter((player) => isUnresolvedMarketPlayer(player, signedPlayerIds, exercisedPlayerIds, draftedPlayerIds))
    .sort((a, b) => b.marketValue - a.marketValue || a.name.localeCompare(b.name))
    .forEach((player, index) => {
      const resolution = resolutionByPlayer.get(player.id);
      events.push(event({
        id: `unsigned-${player.id}`,
        kind: "unsigned",
        phase: "Final State",
        sortOrder: index,
        actor: player.name,
        action: "Unsigned",
        movement: player.rightsTeam || player.incumbentTeam || "Open market",
        team: player.rightsTeam || player.incumbentTeam || "FA",
        teams: uniqueTeams([player.rightsTeam, player.incumbentTeam, player.team]),
        playerId: player.id,
        player: player.name,
        amount: player.marketValue,
        amountLabel: "FA value",
        tool: "None",
        impact: `${player.status} / ${roleLabel(player.expectedMarketMinutes)}`,
        why: resolution?.unresolvedReason ?? "No team used a roster spot or spending tool at the simulated price.",
        tone: player.marketValue >= 8_000_000 ? "warn" : "neutral",
        tags: ["unsigned", player.status, player.rightsTeam, player.incumbentTeam],
        auditRows: ledgerRowsByPlayer.get(player.id),
        bids: bidRowsByPlayer.get(player.id),
        sourceId: player.id
      }));
    });

  run.teams.forEach((team, index) => {
    const warnings = capWarnings(team);
    events.push(event({
      id: `cap-${team.team}`,
      kind: "cap_path",
      phase: "Final State",
      sortOrder: 500 + index,
      actor: team.team,
      action: "Cap path",
      movement: capPathLabel(team.capPath),
      team: team.team,
      teams: [team.team],
      amount: team.capSpace,
      amountLabel: "room",
      tool: capPathLabel(team.capPath),
      impact: warnings[0],
      why: team.capPathReason,
      tone: team.secondApronRoom < 0 ? "bad" : team.taxRoom < 0 ? "warn" : team.capSpace > 0 ? "good" : "neutral",
      tags: ["cap", team.capPath, team.mode, ...warnings],
      sourceId: team.team
    }));
  });

  return events.sort((a, b) => a.phaseOrder - b.phaseOrder || a.sortOrder - b.sortOrder || a.actor.localeCompare(b.actor));
}

function buildTeamStories(run: RunLike, events: OffseasonEvent[], multiRun: MultiRunSummaryLike | null): TeamStory[] {
  const draftedPlayerIds = draftedProspectIds(run);
  return run.teams.map((team) => {
    const teamEvents = events.filter((row) => row.teams.includes(team.team));
    const incoming = run.freeAgency.filter((row) => row.toTeam === team.team);
    const outgoing = run.freeAgency.filter((row) => row.fromTeam === team.team && row.toTeam !== team.team);
    const draft = run.draft.filter((row) => row.team === team.team);
    const trades = run.trades.filter((row) => row.teamA === team.team || row.teamB === team.team);
    const acquired = trades.filter((row) => row.teamB === team.team).length;
    const moved = trades.filter((row) => row.teamA === team.team).length;
    const warnings = capWarnings(team);
    const unresolved = unresolvedForTeam(run, team.team, warnings, draftedPlayerIds);
    const bestEvent = teamEvents
      .filter((row) => row.kind !== "cap_path" && row.kind !== "unsigned")
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const outcome = multiRun?.teamOutcomes.find((row) => row.team === team.team);
    return {
      team: team.team,
      name: team.name,
      mode: team.mode,
      headline: bestEvent ? `${team.team}: ${bestEvent.action} ${bestEvent.actor}` : `${team.team}: ${capPathLabel(team.capPath)} path`,
      capPath: team.capPath,
      capPathReason: team.capPathReason,
      payroll: team.payroll,
      capSpace: team.capSpace,
      taxRoom: team.taxRoom,
      firstApronRoom: team.firstApronRoom,
      secondApronRoom: team.secondApronRoom,
      rosterCount: team.rosterCount,
      standardRosterLimit: team.standardRosterLimit,
      projectedWins: team.strength.projectedWins,
      rank: team.strength.rank,
      conferenceRank: team.strength.conferenceRank,
      playoffStatus: team.strength.playoffStatus,
      offense: team.strength.offense,
      defense: team.strength.defense,
      total: team.strength.total,
      adjustedTotal: team.strength.adjustedTotal,
      needs: team.needs,
      core: team.rosterCore,
      warnings,
      incomingCount: incoming.length + acquired,
      outgoingCount: outgoing.length + moved,
      draftCount: draft.length,
      tradeCount: trades.length,
      rosterDelta: incoming.length + draft.length + acquired - outgoing.length - moved,
      eventIds: teamEvents.map((row) => row.id),
      events: teamEvents,
      unresolved,
      outcomePct: outcome?.pct,
      outcomeLabel: outcome?.outcome,
      roster: team.roster
    };
  }).sort((a, b) => storyPriority(b) - storyPriority(a) || a.team.localeCompare(b.team));
}

function buildMarketStories(run: RunLike, multiRun: MultiRunSummaryLike | null): MarketStory[] {
  const bidRowsByPlayer = rowsByPlayer(run.marketBids);
  const ledgerRowsByPlayer = rowsByPlayer(run.marketLedger);
  const signingIds = new Set(run.freeAgency.map((row) => row.player.id));
  const exercisedPlayerIds = new Set(run.options.filter((row) => row.decision === "exercise").map((row) => row.player.id));
  const draftedPlayerIds = draftedProspectIds(run);
  const resolutionByPlayer = new Map(run.marketResolutions.map((row) => [row.playerId, row]));
  const signedStories = run.freeAgency.map((signing): MarketStory => {
    const outcome = playerDestinationOutcome(multiRun, signing.player.name, signing.toTeam);
    const rfaOutcome = signing.status === "RFA" ? rfaMatchOutcome(multiRun, signing.player.name) : undefined;
    return {
      id: `market-${signing.player.id}`,
      playerId: signing.player.id,
      player: signing.player.name,
      status: signing.status,
      fromTeam: signing.fromTeam,
      toTeam: signing.toTeam,
      movement: signing.fromTeam === signing.toTeam ? `Stays with ${signing.toTeam}` : `${signing.fromTeam || "FA"} -> ${signing.toTeam}`,
      position: signing.player.position,
      score: signing.player.score,
      tier: signing.player.tier,
      marketValue: signing.player.marketValue,
      rightsTeam: signing.player.rightsTeam,
      expectedMarketMinutes: signing.context.expectedMarketMinutes ?? signing.player.expectedMarketMinutes,
      annualSalary: signing.annualSalary,
      totalSalary: signing.totalSalary,
      years: signing.years,
      tool: signing.context.toolName || signing.tool,
      capPath: signing.context.capPath,
      winner: signing.toTeam,
      runnerUp: marketBidLabel(signing.context.runnerUpTeam, signing.context.runnerUpBid),
      highestBid: marketBidLabel(signing.context.highestBidTeam, signing.context.highestBid),
      moneyGap: signing.context.moneyGap,
      role: roleLabel(signing.context.expectedMarketMinutes ?? signing.player.expectedMarketMinutes),
      confidence: signing.plausibility,
      outcomePct: outcome?.pct,
      outcomeLabel: outcome ? `${outcome.destination} destination` : undefined,
      outcomeCount: outcome?.count,
      outcomeAvgSalary: outcome?.avgSalary,
      rfaMatchPct: rfaOutcome?.pct,
      rfaMatchCount: rfaOutcome?.matches,
      rfaOfferCount: rfaOutcome?.offers,
      why: signing.explanation,
      incumbentDecision: signing.context.incumbentDecisionReason ?? signing.context.incumbentDecision,
      offerSheetTeam: signing.offerSheetTeam,
      matched: signing.matched,
      bids: bidRowsByPlayer.get(signing.player.id) ?? [],
      ledger: ledgerRowsByPlayer.get(signing.player.id) ?? [],
      lostReasons: signing.context.losingReasons ?? [],
      logic: signing.context.logic
    };
  });
  const unresolvedStories = run.players
    .filter((player) => isUnresolvedMarketPlayer(player, signingIds, exercisedPlayerIds, draftedPlayerIds))
    .map((player): MarketStory => {
      const resolution = resolutionByPlayer.get(player.id);
      const outcome = unresolvedMarketOutcome(multiRun, player.name);
      return {
        id: `market-unresolved-${player.id}`,
        playerId: player.id,
        player: player.name,
        status: player.status || "Unresolved",
        fromTeam: player.rightsTeam || player.incumbentTeam || "",
        toTeam: "Unsigned",
        movement: "Unsigned",
        position: player.position,
        score: player.score,
        tier: player.tier,
        marketValue: player.marketValue,
        rightsTeam: player.rightsTeam,
        expectedMarketMinutes: player.expectedMarketMinutes,
        winner: "Unsigned",
        why: resolution?.unresolvedReason ?? "No team used a roster spot or spending tool at the simulated price.",
        unresolvedReason: resolution?.unresolvedReason,
        outcomePct: outcome?.pct,
        outcomeLabel: outcome?.outcome,
        outcomeCount: outcome?.count,
        bids: bidRowsByPlayer.get(player.id) ?? [],
        ledger: ledgerRowsByPlayer.get(player.id) ?? [],
        lostReasons: resolution?.unresolvedReason ? [resolution.unresolvedReason] : [],
        logic: []
      };
    });
  return [...signedStories, ...unresolvedStories].sort((a, b) => (b.marketValue ?? b.annualSalary ?? 0) - (a.marketValue ?? a.annualSalary ?? 0) || a.player.localeCompare(b.player));
}

function buildLeagueDigest(
  run: RunLike,
  events: OffseasonEvent[],
  teamStories: TeamStory[],
  multiRun: MultiRunSummaryLike | null
): LeagueDigest {
  const topEvent = events
    .filter((row) => row.kind === "signing" || row.kind === "rfa_match" || row.kind === "trade")
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
  const capRoomTeams = run.teams.filter((row) => row.capPath === "cap_room").length;
  const taxTeams = run.teams.filter((row) => row.taxRoom < 0).length;
  const apronTeams = run.teams.filter((row) => row.firstApronRoom < 0).length;
  const unsignedValue = sum(events.filter((row) => row.kind === "unsigned").map((row) => row.amount ?? 0));
  const phaseCounts = phaseNames.reduce((acc, phase) => {
    acc[phase] = events.filter((row) => row.phase === phase).length;
    return acc;
  }, {} as Record<OffseasonPhase, number>);
  return {
    headline: topEvent ? `${topEvent.actor} is the lead domino` : "The model creates a low-transaction offseason",
    subhead: `${run.capYear} cap, ${run.draftYear} draft, ${run.freeAgency.length} signings, ${run.trades.length} trades, ${run.options.length} option calls.`,
    metrics: [
      { label: "Moves", value: String(events.filter((row) => row.kind !== "cap_path").length), tone: "neutral" },
      { label: "Room teams", value: String(capRoomTeams), tone: capRoomTeams > 6 ? "good" : "neutral" },
      { label: "Tax teams", value: String(taxTeams), tone: taxTeams > 8 ? "warn" : "neutral" },
      { label: "Apron teams", value: String(apronTeams), tone: apronTeams > 0 ? "bad" : "neutral" },
      { label: "Unsigned value", value: String(Math.round(unsignedValue)), tone: unsignedValue > 50_000_000 ? "warn" : "neutral" }
    ],
    topEvents: events
      .filter((row) => row.kind !== "cap_path")
      .slice()
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 8),
    volatile: multiRun
      ? multiRun.volatileDecisions.slice(0, 8).map((row) => ({ label: row.entity, detail: row.outcome, pct: row.pct }))
      : teamStories.filter((row) => row.warnings.length > 1).slice(0, 8).map((row) => ({ label: row.team, detail: row.warnings[0], pct: 0 })),
    phaseCounts
  };
}

function event(input: Omit<OffseasonEvent, "phaseOrder" | "searchText">): OffseasonEvent {
  const phaseOrder = phaseNames.indexOf(input.phase);
  const searchText = [
    input.kind,
    input.phase,
    input.actor,
    input.action,
    input.movement,
    input.team,
    input.player,
    input.tool,
    input.impact,
    input.outcomeLabel,
    input.why,
    ...input.tags,
    ...input.teams
  ].filter(Boolean).join(" ").toLowerCase();
  return { ...input, phaseOrder, searchText };
}

function rowsByPlayer<T extends { playerId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const current = map.get(row.playerId) ?? [];
    current.push(row);
    map.set(row.playerId, current);
  });
  return map;
}

function isMarketPlayer(player: PlayerLike): boolean {
  if (player.status === "Rookie FA") return false;
  if (player.status !== "Signed") return true;
  return Boolean(player.declinedOptionType);
}

function isUnresolvedMarketPlayer(
  player: PlayerLike,
  signedPlayerIds: Set<string>,
  exercisedPlayerIds: Set<string>,
  draftedPlayerIds: Set<string>
): boolean {
  return isMarketPlayer(player) &&
    !signedPlayerIds.has(player.id) &&
    !exercisedPlayerIds.has(player.id) &&
    !draftedPlayerIds.has(player.id);
}

function draftedProspectIds(run: RunLike): Set<string> {
  return new Set(run.draft.map((selection) => selection.prospect.id));
}

function unresolvedForTeam(run: RunLike, team: string, warnings: string[], draftedPlayerIds: Set<string>): string[] {
  const signedPlayerIds = new Set(run.freeAgency.map((signing) => signing.player.id));
  const exercisedPlayerIds = new Set(run.options.filter((row) => row.decision === "exercise").map((row) => row.player.id));
  const unsigned = run.players
    .filter((player) => isUnresolvedMarketPlayer(player, signedPlayerIds, exercisedPlayerIds, draftedPlayerIds) && (player.rightsTeam === team || player.incumbentTeam === team))
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 3)
    .map((player) => `Unsigned: ${player.name}`);
  return [...warnings, ...unsigned].slice(0, 5);
}

function capWarnings(team: TeamLike): string[] {
  const warnings = [
    team.rosterCount > team.standardRosterLimit ? `${team.rosterCount - team.standardRosterLimit} over roster limit` : "",
    team.secondApronRoom < 0 ? "Over second apron" : "",
    team.firstApronRoom < 0 && team.secondApronRoom >= 0 ? "Over first apron" : "",
    team.taxRoom < 0 && team.firstApronRoom >= 0 ? "Tax team" : "",
    team.capSpace < 0 ? "No practical room" : "",
    team.rosterCount < team.minimumRosterCount ? `${team.minimumRosterCount - team.rosterCount} roster charges` : ""
  ].filter(Boolean);
  return warnings.length ? warnings : ["Clean enough sheet"];
}

function storyPriority(story: TeamStory): number {
  return story.incomingCount * 4 + story.outgoingCount * 3 + story.tradeCount * 3 + story.draftCount + Math.max(0, -story.taxRoom) / 10_000_000;
}

function uniqueTeams(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value !== "FA"))));
}

function capPathLabel(path?: string): string {
  if (path === "cap_room") return "Cap room";
  if (path === "retained_rights") return "Retained rights";
  return path || "-";
}

function marketBidLabel(team?: string, amount?: number): string | undefined {
  if (!team) return undefined;
  return amount ? `${team} at ${compactMoney(amount)}` : team;
}

function playerDestinationOutcome(multiRun: MultiRunSummaryLike | null, player: string, destination: string) {
  return multiRun?.playerDestinations.find((row) => row.player === player && row.destination === destination);
}

function optionDecisionOutcome(multiRun: MultiRunSummaryLike | null, player: string, team: string, decision: string, optionType: string) {
  return multiRun?.optionDecisions.find((row) =>
    row.player === player &&
    row.team === team &&
    row.decision === decision &&
    row.optionType === optionType
  );
}

function draftPairingOutcome(multiRun: MultiRunSummaryLike | null, prospect: string, team: string) {
  return multiRun?.draftOutcomes.find((row) => row.prospect === prospect && row.team === team);
}

function tradeTeamOutcome(multiRun: MultiRunSummaryLike | null, team: string) {
  return multiRun?.tradeTeams.find((row) => row.team === team);
}

function unresolvedMarketOutcome(multiRun: MultiRunSummaryLike | null, player: string) {
  return multiRun?.unresolvedMarkets.find((row) => row.entity === player);
}

function rfaMatchOutcome(multiRun: MultiRunSummaryLike | null, player: string) {
  return multiRun?.rfaMatches.find((row) => row.player === player);
}

function compactMoney(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `$${roundTo(value / 1_000_000, 1)}M`;
  if (Math.abs(value) >= 1_000) return `$${roundTo(value / 1_000, 0)}K`;
  return `$${roundTo(value, 0)}`;
}

function roundTo(value: number, digits: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function roleLabel(minutes: number | undefined): string {
  const value = minutes ?? 0;
  if (value >= 2200) return "starter role";
  if (value >= 1300) return "rotation role";
  if (value >= 600) return "bench role";
  return "fringe role";
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function round(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "-";
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

const phaseNames: OffseasonPhase[] = ["Options", "Draft", "Trades", "Free Agency", "Final State"];
