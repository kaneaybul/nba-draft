import { useEffect, useMemo, useRef, useState } from "react";
import { simulateFreeAgencyMarket } from "./offseasonMarket";
import type {
  MarketBid,
  MarketComponentBreakdown,
  MarketLedgerRow,
  MarketResolution,
  AppData,
  CapTrackerContractCell,
  CapTrackerContractRow,
  CapTrackerData,
  CapTrackerException,
  CapTrackerSeason,
  CapTrackerTeamSeason,
  DraftProspect,
  OffseasonPlayerTruth,
  OffseasonTeamCapSheet,
  OffseasonTruthData,
  PickAsset,
  PlayerImpact,
  TeamProjection
} from "./types";
import { clamp, cls, formatMoney, formatNumber, formatSignedMoney } from "./utils";

type TeamMode = "rebuilding" | "rising" | "playoff hopeful" | "contender" | "tax-sensitive contender";
type OffseasonTab = "dashboard" | "warRoom" | "league" | "draft" | "options" | "freeAgency" | "trades" | "teams" | "markets" | "overrides";
type DecisionKind = "draft" | "option" | "ufa" | "rfa" | "trade";
type ContractStatus = "Signed" | "UFA" | "RFA" | "Player Option" | "Team Option" | "Non-Guaranteed" | "Rookie FA";
type SkillKey = "FTD" | "OREB" | "PASS" | "RIM" | "SHOOT" | "DPM" | "DREB" | "RIMPRO" | "SWITCH";
type BirdRight = "Bird" | "Early Bird" | "Non-Bird" | "None";
type CapPath = "retained_rights" | "cap_room";
type HoldAction = "retained" | "renounced" | "none";

type ToolLedgerEntry = {
  player: string;
  tool: SpendingTool["kind"];
  amount: number;
  remaining: number;
  reason: string;
};

type BiddingHealth = {
  totalBidsSubmitted: number;
  capBidsSubmitted: number;
  capDollarsOffered: number;
  capDollarsSpent: number;
  unusedCapRoom: number;
  availableTools: string[];
  warning: string;
};

type CapTrackerIndex = {
  capYear: number;
  season?: CapTrackerSeason;
  teams: Map<string, CapTrackerTeamSeason>;
  exceptionsByTeam: Map<string, CapTrackerException[]>;
  cellsByNbaId: Map<string, CapTrackerMatchedCell>;
  cellsByNameTeam: Map<string, CapTrackerMatchedCell>;
  draftPickPlaceholdersByTeam: Map<string, { count: number; salary: number }>;
};

type CapTrackerMatchedCell = {
  row: CapTrackerContractRow;
  cell: CapTrackerContractCell;
};

type SimulatorAssumptions = {
  seed: number;
  variance: number;
  draftFitWeight: number;
  marketAggression: number;
  tradeAggression: number;
  taxSensitivity: number;
  runCount: number;
  cap: number;
  tax: number;
  firstApron: number;
  secondApron: number;
};

type TeamOverride = {
  mode?: TeamMode;
  needs?: SkillKey[];
  willingness?: number;
};

type PlayerOverride = {
  status?: ContractStatus;
  marketValue?: number;
  incumbentTeam?: string;
};

type ProspectOverride = {
  rank?: number;
  tier?: string;
};

type SimulatorOverrides = {
  teams: Record<string, TeamOverride>;
  players: Record<string, PlayerOverride>;
  prospects: Record<string, ProspectOverride>;
};

type TeamState = {
  team: string;
  name: string;
  mode: TeamMode;
  capYear: number;
  capPath: CapPath;
  capPathReason: string;
  projectedWins: number;
  projectedRank: number;
  roster: SimPlayer[];
  rosterCountAdjustment: number;
  standardRosterLimit: number;
  targetRosterCount: number;
  minimumRosterCount: number;
  draftPickPlaceholderCount: number;
  draftPickPlaceholderSalary: number;
  minimumRosterCharge: number;
  activeRosterCountBase: number;
  payroll: number;
  activeSalary: number;
  guaranteedSalary: number;
  activeSalaryAdjustment: number;
  guaranteedSalaryAdjustment: number;
  deadCap: number;
  capHolds: number;
  initialCapHolds: number;
  holdsRetained: number;
  holdsRenounced: number;
  rosterCharges: number;
  heldCapSpace: number;
  capSpace: number;
  renouncedCapSpace: number;
  maximumCapSpace: number;
  capRoomWithHolds: number;
  capRoomRenounced: number;
  statusBand?: string;
  statusBandWithHolds?: string;
  statusBandRenounced?: string;
  taxRoom: number;
  firstApronRoom: number;
  secondApronRoom: number;
  needs: SkillKey[];
  pickAssets: number;
  pickCount: number;
  premiumPickCount: number;
  willingness: number;
  exceptions: SpendingTool[];
  toolLedger: ToolLedgerEntry[];
  explanations: string[];
};

type SimPlayer = {
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
  guaranteedSalary: number;
  deadCap: number;
  capTrackerTeam?: string;
  capTrackerKind?: string;
  capTrackerStatus?: string;
  holdAction: HoldAction;
  holdActionReason?: string;
  rightsValue: number;
  holdRetainScore: number;
  scarcityScore: number;
  expectedMarketMinutes: number;
  marketMinutesSource: string;
  waivedDate?: string | null;
  rosterStatusSource: string;
  total: number;
  score: number;
  tier: string;
  tradeValue: number;
  upside: number;
  declineRisk: number;
  replaceability: number;
  skills: Record<SkillKey, number>;
  original?: PlayerImpact;
};

type SimProspect = {
  id: string;
  name: string;
  draftYear: number;
  rank: number;
  consensusRank: number;
  modelRank: number;
  tier: string;
  position: string;
  score: number;
  upside: number;
  risk: number;
  bpa: number;
  skills: Record<SkillKey, number>;
  original: DraftProspect;
};

type SpendingTool = {
  name: string;
  amount: number;
  used: number;
  kind: "cap" | "bird" | "non_taxpayer_mle" | "taxpayer_mle" | "room_exception" | "bi_annual" | "minimum";
  path?: "retained" | "renounced" | "either" | string;
  source?: string;
};

type DecisionScore = {
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

type DraftSelection = {
  pick: number;
  team: string;
  pickLabel: string;
  prospect: SimProspect;
  consensusRank: number;
  modelRank: number;
  fitDelta: number;
  reachSteal: "Reach" | "Range" | "Steal";
  score: DecisionScore;
  explanation: string;
  plausibility: number;
};

type OptionDecision = {
  player: SimPlayer;
  team: string;
  optionType: "Player Option" | "Team Option" | "Non-Guaranteed";
  decision: "exercise" | "decline";
  score: DecisionScore;
  explanation: string;
  plausibility: number;
};

type FreeAgentSigning = {
  player: SimPlayer;
  fromTeam: string;
  toTeam: string;
  status: "UFA" | "RFA" | "Rookie FA";
  years: number;
  annualSalary: number;
  totalSalary: number;
  tool: SpendingTool["kind"];
  matched?: boolean;
  offerSheetTeam?: string;
  score: DecisionScore;
  context: OfferContext;
  explanation: string;
  plausibility: number;
  marketResolution?: MarketResolution;
  bids?: MarketBid[];
  ledger?: MarketLedgerRow[];
};

type OfferContext = {
  toolName: string;
  toolAmount: number;
  legalMax: number;
  playerMarket: number;
  limiter: string;
  capPath?: CapPath | string;
  toolReason?: string;
  holdAction?: HoldAction | string;
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
  incumbentDecision?: "matched" | "declined" | "not_applicable";
  incumbentDecisionReason?: string;
  incumbentBid?: number;
  incumbentBidYears?: number;
  incumbentBidTool?: string;
  incumbentCanMatch?: boolean;
  incumbentLegalMax?: number;
  incumbentMatchScore?: number;
};

type OfferAudit = {
  id: string;
  round: number;
  team: string;
  player: string;
  playerId: string;
  status: "offer" | "reject" | "signed" | "matched" | "declined";
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

type TradeMove = {
  id: string;
  teamA: string;
  teamB: string;
  player: SimPlayer;
  salary: number;
  buyerOutgoingSalary: number;
  pickValue: number;
  buyerGets: string[];
  sellerGets: string[];
  sellerMotivation: string;
  buyerMotivation: string;
  salaryRule: string;
  scoreA: DecisionScore;
  scoreB: DecisionScore;
  explanation: string;
  plausibility: number;
};

type TeamSummary = {
  team: string;
  name: string;
  mode: TeamMode;
  capYear: number;
  capPath: CapPath;
  capPathReason: string;
  rosterCount: number;
  standardRosterLimit: number;
  targetRosterCount: number;
  minimumRosterCount: number;
  rosterCore: string[];
  payroll: number;
  activeSalary: number;
  guaranteedSalary: number;
  deadCap: number;
  capHolds: number;
  initialCapHolds: number;
  holdsRetained: number;
  holdsRenounced: number;
  rosterCharges: number;
  heldCapSpace: number;
  capSpace: number;
  renouncedCapSpace: number;
  maximumCapSpace: number;
  capRoomWithHolds: number;
  capRoomRenounced: number;
  statusBand?: string;
  statusBandWithHolds?: string;
  statusBandRenounced?: string;
  taxRoom: number;
  firstApronRoom: number;
  secondApronRoom: number;
  needs: SkillKey[];
  pickAssets: number;
  pickCount: number;
  premiumPickCount: number;
  toolLedger: ToolLedgerEntry[];
  biddingHealth: BiddingHealth;
  majorMoves: string[];
};

type SimulationRun = {
  id: string;
  seed: number;
  season: number;
  capYear: number;
  draftYear: number;
  draft: DraftSelection[];
  options: OptionDecision[];
  freeAgency: FreeAgentSigning[];
  trades: TradeMove[];
  teams: TeamSummary[];
  players: SimPlayer[];
  marketAudit: OfferAudit[];
  marketBids: MarketBid[];
  marketLedger: MarketLedgerRow[];
  marketResolutions: MarketResolution[];
  tradeDiagnostics: string[];
  explanations: Array<{ kind: DecisionKind; title: string; team?: string; player?: string; explanation: string; score: DecisionScore; plausibility: number }>;
};

type MultiRunSummary = {
  runs: number;
  playerDestinations: Array<{ player: string; destination: string; count: number; pct: number; avgSalary: number }>;
  draftOutcomes: Array<{ prospect: string; team: string; count: number; pct: number; avgPick: number }>;
  tradeTeams: Array<{ team: string; count: number; pct: number }>;
  rfaMatches: Array<{ player: string; matches: number; offers: number; pct: number }>;
  payrolls: Array<{ team: string; avgPayroll: number; highPayroll: number; lowPayroll: number }>;
  teamOutcomes: Array<{ team: string; outcome: string; count: number; pct: number; avgPayroll: number; avgCapSpace: number; avgTaxRoom: number }>;
  taxOutcomes: OutcomeDistribution[];
  stableDecisions: OutcomeDistribution[];
  volatileDecisions: OutcomeDistribution[];
  unresolvedMarkets: OutcomeDistribution[];
  surprises: Array<{ label: string; detail: string; frequency: number }>;
};

type MultiRunAccumulator = {
  runs: number;
  destinationRows: Map<string, { count: number; salary: number }>;
  draftRows: Map<string, { count: number; pick: number }>;
  tradeTeams: Map<string, number>;
  rfaRows: Map<string, { matches: number; offers: number }>;
  payrollRows: Map<string, number[]>;
  teamOutcomeRows: Map<string, { count: number; payroll: number; capSpace: number; taxRoom: number }>;
  taxRows: Map<string, number>;
  decisionRows: Map<string, number>;
  decisionOutcomeCounts: Map<string, Set<string>>;
  unresolvedRows: Map<string, number>;
  surpriseRows: Map<string, { detail: string; count: number }>;
};

type DriverTone = "good" | "warn" | "bad" | "neutral";

type DecisionDriver = {
  label: string;
  value: string;
  tone: DriverTone;
  explanation: string;
};

type ScenarioPreset = {
  id: string;
  name: string;
  intent: string;
  patch: Partial<SimulatorAssumptions>;
};

type OutcomeDistribution = {
  entity: string;
  outcome: string;
  count: number;
  pct: number;
  avgMoney?: number;
  avgPick?: number;
  detail?: string;
};

type DigestTone = "good" | "warn" | "bad" | "neutral";

type ResultDigestItem = {
  label: string;
  value: string;
  detail: string;
  tone: DigestTone;
};

type TeamWarRoomPlan = {
  team: TeamSummary;
  objective: string;
  urgency: number;
  flexibility: number;
  taxDanger: number;
  assetLeverage: number;
  clarity: number;
  rosterHoles: string[];
  priorities: Array<{ kind: DecisionKind | "cap" | "avoid"; label: string; detail: string; drivers: DecisionDriver[]; score?: DecisionScore; plausibility?: number }>;
  warnings: string[];
  finalPayroll: number;
};

type OfficialDraftPick = {
  pick: number;
  team: string;
  label: string;
};

const skillKeys: SkillKey[] = ["FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"];
const STANDARD_ROSTER_LIMIT = 15;
const MINIMUM_STANDARD_ROSTER = 12;
const defaultOverrides: SimulatorOverrides = { teams: {}, players: {}, prospects: {} };
const OFFSEASON_TAB_STORAGE_KEY = "offseason:activeTab:v2";
const OFFSEASON_TEAM_STORAGE_KEY = "offseason:selectedTeam:v1";
const OFFSEASON_PRESET_STORAGE_KEY = "offseason:preset:v1";
let offseasonRunCache: { data: AppData; key: string; run: SimulationRun } | null = null;
const scenarioPresets: ScenarioPreset[] = [
  {
    id: "balanced",
    name: "Balanced",
    intent: "Default market with fit, value, and cap caution in balance.",
    patch: { variance: 0.42, draftFitWeight: 0.22, marketAggression: 0.54, tradeAggression: 0.34, taxSensitivity: 0.56 }
  },
  {
    id: "cap-squeeze",
    name: "Cap Squeeze",
    intent: "Tax and apron pressure drive conservative spending and more relief trades.",
    patch: { variance: 0.36, draftFitWeight: 0.2, marketAggression: 0.42, tradeAggression: 0.52, taxSensitivity: 0.82 }
  },
  {
    id: "hot-market",
    name: "Hot Market",
    intent: "Aggressive bidders chase scarce talent and raise offer-sheet pressure.",
    patch: { variance: 0.52, draftFitWeight: 0.18, marketAggression: 0.78, tradeAggression: 0.42, taxSensitivity: 0.46 }
  },
  {
    id: "fit-draft",
    name: "Fit Draft",
    intent: "Teams let roster needs break more close draft calls.",
    patch: { variance: 0.34, draftFitWeight: 0.42, marketAggression: 0.5, tradeAggression: 0.32, taxSensitivity: 0.58 }
  }
];
const CAP_SETTINGS_BY_SEASON: Record<number, { cap: number; tax: number; firstApron: number; secondApron: number }> = {
  2026: { cap: 166_000_000, tax: 201_650_000, firstApron: 210_321_000, secondApron: 222_775_000 },
  2027: { cap: 166_000_000, tax: 201_650_000, firstApron: 210_321_000, secondApron: 222_775_000 },
  2028: { cap: 174_300_000, tax: 211_850_000, firstApron: 220_847_000, secondApron: 233_914_000 },
  2029: { cap: 183_015_000, tax: 222_440_000, firstApron: 231_889_000, secondApron: 245_610_000 },
  2030: { cap: 192_166_000, tax: 233_560_000, firstApron: 243_485_000, secondApron: 258_246_000 }
};
const OFFICIAL_2026_DRAFT_ORDER: OfficialDraftPick[] = [
  { pick: 1, team: "WAS", label: "Washington" },
  { pick: 2, team: "UTA", label: "Utah" },
  { pick: 3, team: "MEM", label: "Memphis" },
  { pick: 4, team: "CHI", label: "Chicago" },
  { pick: 5, team: "LAC", label: "LA Clippers (from Indiana)" },
  { pick: 6, team: "BKN", label: "Brooklyn" },
  { pick: 7, team: "SAC", label: "Sacramento" },
  { pick: 8, team: "ATL", label: "Atlanta (from New Orleans)" },
  { pick: 9, team: "DAL", label: "Dallas" },
  { pick: 10, team: "MIL", label: "Milwaukee" },
  { pick: 11, team: "GSW", label: "Golden State" },
  { pick: 12, team: "OKC", label: "Oklahoma City (from LA Clippers)" },
  { pick: 13, team: "MIA", label: "Miami" },
  { pick: 14, team: "CHA", label: "Charlotte" },
  { pick: 15, team: "CHI", label: "Chicago (from Portland)" },
  { pick: 16, team: "MEM", label: "Memphis (from Phoenix via Orlando)" },
  { pick: 17, team: "OKC", label: "Oklahoma City (from Philadelphia)" },
  { pick: 18, team: "CHA", label: "Charlotte (from Orlando via Phoenix)" },
  { pick: 19, team: "TOR", label: "Toronto" },
  { pick: 20, team: "SAS", label: "San Antonio (from Atlanta)" },
  { pick: 21, team: "DET", label: "Detroit (from Minnesota)" },
  { pick: 22, team: "PHI", label: "Philadelphia (from Houston via Oklahoma City)" },
  { pick: 23, team: "ATL", label: "Atlanta (from Cleveland)" },
  { pick: 24, team: "NYK", label: "New York" },
  { pick: 25, team: "LAL", label: "Los Angeles Lakers" },
  { pick: 26, team: "DEN", label: "Denver" },
  { pick: 27, team: "BOS", label: "Boston" },
  { pick: 28, team: "MIN", label: "Minnesota (from Detroit)" },
  { pick: 29, team: "CLE", label: "Cleveland (from San Antonio via Atlanta)" },
  { pick: 30, team: "DAL", label: "Dallas (from Oklahoma City via Washington and Philadelphia)" },
  { pick: 31, team: "NYK", label: "New York (from Washington via Oklahoma City and Houston)" },
  { pick: 32, team: "MEM", label: "Memphis (from Indiana via Milwaukee)" },
  { pick: 33, team: "BKN", label: "Brooklyn" },
  { pick: 34, team: "SAC", label: "Sacramento" },
  { pick: 35, team: "SAS", label: "San Antonio (from Utah via Minnesota)" },
  { pick: 36, team: "LAC", label: "LA Clippers (from Memphis via Atlanta and Utah)" },
  { pick: 37, team: "OKC", label: "Oklahoma City (from Dallas)" },
  { pick: 38, team: "CHI", label: "Chicago (from New Orleans via Boston, Detroit, and Portland)" },
  { pick: 39, team: "HOU", label: "Houston (from Chicago via Washington)" },
  { pick: 40, team: "BOS", label: "Boston (from Milwaukee via Orlando)" },
  { pick: 41, team: "MIA", label: "Miami (from Golden State via Charlotte, New York, Oklahoma City, and Atlanta)" },
  { pick: 42, team: "SAS", label: "San Antonio (from Portland via New Orleans)" },
  { pick: 43, team: "BKN", label: "Brooklyn (from LA Clippers via Houston)" },
  { pick: 44, team: "SAS", label: "San Antonio (from Miami via Indiana)" },
  { pick: 45, team: "SAC", label: "Sacramento (from Charlotte via San Antonio, Atlanta, and New York)" },
  { pick: 46, team: "ORL", label: "Orlando" },
  { pick: 47, team: "PHX", label: "Phoenix (from Philadelphia via Houston and Oklahoma City)" },
  { pick: 48, team: "DAL", label: "Dallas (from Phoenix via Washington)" },
  { pick: 49, team: "DEN", label: "Denver (from Atlanta via Brooklyn and Golden State)" },
  { pick: 50, team: "TOR", label: "Toronto" },
  { pick: 51, team: "WAS", label: "Washington (from Minnesota via Detroit and New York)" },
  { pick: 52, team: "LAC", label: "LA Clippers (from Cleveland)" },
  { pick: 53, team: "HOU", label: "Houston" },
  { pick: 54, team: "GSW", label: "Golden State (from LA Lakers via Toronto, Miami, and Cleveland)" },
  { pick: 55, team: "NYK", label: "New York" },
  { pick: 56, team: "CHI", label: "Chicago (from Denver via Minnesota, Phoenix, Charlotte, and Phoenix)" },
  { pick: 57, team: "ATL", label: "Atlanta (from Boston)" },
  { pick: 58, team: "NOP", label: "New Orleans (from Detroit via New York, Brooklyn, Phoenix, Orlando, and LA Clippers)" },
  { pick: 59, team: "MIN", label: "Minnesota (from San Antonio via Indiana)" },
  { pick: 60, team: "WAS", label: "Washington (from Oklahoma City via San Antonio and Miami)" }
];

export function OffseasonSimulatorWorkspace({ data, season }: { data: AppData; season: number }) {
  const capYear = useMemo(() => capYearForSeason(season, data.capTracker), [data.capTracker, season]);
  const baseCapSettings = useMemo(() => capSettingsForSeason(capYear, data.capTracker), [capYear, data.capTracker]);
  const [assumptions, setAssumptions] = useState<SimulatorAssumptions>(() => ({
    seed: 2701,
    variance: 0.42,
    draftFitWeight: 0.22,
    marketAggression: 0.54,
    tradeAggression: 0.34,
    taxSensitivity: 0.56,
    runCount: 50,
    cap: baseCapSettings.cap,
    tax: baseCapSettings.tax,
    firstApron: baseCapSettings.firstApron,
    secondApron: baseCapSettings.secondApron
  }));
  const [overrides, setOverrides] = useState<SimulatorOverrides>(defaultOverrides);
  const [activeTab, setActiveTab] = useState<OffseasonTab>(() => readStoredOffseasonTab());
  const [run, setRun] = useState<SimulationRun | null>(() => readCachedSimulationRun(data, simulationCacheKey(season, capYear, assumptions, overrides)));
  const [isSimulating, setIsSimulating] = useState(() => run === null);
  const [simulationStatus, setSimulationStatus] = useState<string | null>(null);
  const [runOffset, setRunOffset] = useState(0);
  const [multiRun, setMultiRun] = useState<MultiRunSummary | null>(null);
  const [selectedTeam, setSelectedTeam] = useState(() => readStoredString(OFFSEASON_TEAM_STORAGE_KEY, "All"));
  const [activePreset, setActivePreset] = useState(() => readStoredString(OFFSEASON_PRESET_STORAGE_KEY, "balanced"));
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedTeamCode, setSelectedTeamCode] = useState("");
  const [selectedProspectId, setSelectedProspectId] = useState("");
  const activeRunJobRef = useRef(0);

  const seasonPlayers = useMemo(() => data.players.filter((player) => player.year === season), [data.players, season]);
  const draftYear = useMemo(() => inferDraftYear(data.prospects, season), [data.prospects, season]);
  const prospects = useMemo(() => data.prospects.filter((prospect) => prospect.draft_year === draftYear), [data.prospects, draftYear]);
  const teamCodes = useMemo(() => buildTeamMeta(data.teams, season).map((team) => team.team), [data.teams, season]);
  const teams = useMemo(() => ["All", ...teamCodes], [teamCodes]);
  const filteredTeamRows = !run ? [] : selectedTeam === "All" ? run.teams : run.teams.filter((team) => team.team === selectedTeam);
  const filteredSignings = selectedTeam === "All"
    ? run?.freeAgency ?? []
    : run?.freeAgency.filter((signing) => signing.toTeam === selectedTeam || signing.fromTeam === selectedTeam) ?? [];
  const filteredTrades = selectedTeam === "All"
    ? run?.trades ?? []
    : run?.trades.filter((trade) => trade.teamA === selectedTeam || trade.teamB === selectedTeam) ?? [];
  const selectedPlayer = seasonPlayers.find((player) => playerKey(player) === selectedPlayerId) ?? seasonPlayers[0] ?? null;
  const selectedProspect = prospects.find((prospect) => prospectKey(prospect) === selectedProspectId) ?? prospects[0] ?? null;
  const selectedTeamForEdit = selectedTeamCode || teamCodes[0] || "";
  const headline = useMemo(() => run ? buildRunHeadline(run) : null, [run]);
  const warRoomPlans = useMemo(() => run ? buildWarRoomPlans(run, assumptions) : [], [assumptions, run]);
  const selectedPlan = selectedTeam === "All" ? null : warRoomPlans.find((plan) => plan.team.team === selectedTeam) ?? null;
  const overrideStats = useMemo(() => summarizeOverrides(overrides), [overrides]);

  useEffect(() => {
    const key = simulationCacheKey(season, capYear, assumptions, overrides);
    const cached = readCachedSimulationRun(data, key);
    if (cached) {
      setRun(cached);
      setIsSimulating(false);
      setSimulationStatus(null);
      return;
    }
    const jobId = activeRunJobRef.current + 1;
    activeRunJobRef.current = jobId;
    setRun(null);
    setMultiRun(null);
    setRunOffset(0);
    setIsSimulating(true);
    setSimulationStatus("Generating first run...");
    let cancelled = false;
    const runTask = () => {
      const next = runSimulation(data, season, capYear, assumptions, overrides, 0);
      writeCachedSimulationRun(data, key, next);
      if (!cancelled && activeRunJobRef.current === jobId) {
        setRun(next);
        setIsSimulating(false);
        setSimulationStatus(null);
      }
    };
    const handle = scheduleIdleWork(runTask);
    return () => {
      cancelled = true;
      cancelIdleWork(handle);
    };
  }, [data, season, capYear]);

  useEffect(() => {
    if (!teams.includes(selectedTeam)) setSelectedTeam("All");
  }, [selectedTeam, teams]);

  useEffect(() => {
    window.localStorage.setItem(OFFSEASON_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    window.localStorage.setItem(OFFSEASON_TEAM_STORAGE_KEY, selectedTeam);
  }, [selectedTeam]);

  useEffect(() => {
    window.localStorage.setItem(OFFSEASON_PRESET_STORAGE_KEY, activePreset);
  }, [activePreset]);

  const updateAssumption = (key: keyof SimulatorAssumptions, value: number) => {
    setAssumptions((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (preset: ScenarioPreset) => {
    setActivePreset(preset.id);
    setAssumptions((current) => ({ ...current, ...preset.patch }));
  };

  const runOne = () => {
    const jobId = activeRunJobRef.current + 1;
    activeRunJobRef.current = jobId;
    const nextOffset = runOffset + 1;
    setIsSimulating(true);
    setSimulationStatus("Running one simulation...");
    setMultiRun(null);
    window.setTimeout(() => {
      if (activeRunJobRef.current !== jobId) return;
      const next = runSimulation(data, season, capYear, assumptions, overrides, nextOffset);
      if (activeRunJobRef.current !== jobId) return;
      writeCachedSimulationRun(data, simulationCacheKey(season, capYear, assumptions, overrides), next);
      setRunOffset(nextOffset);
      setRun(next);
      setIsSimulating(false);
      setSimulationStatus(null);
    }, 16);
  };

  const runMany = () => {
    const total = clamp(Math.round(assumptions.runCount), 2, 500);
    const jobId = activeRunJobRef.current + 1;
    activeRunJobRef.current = jobId;
    const accumulator = createMultiRunAccumulator();
    let completed = 0;
    let firstRun: SimulationRun | null = null;
    setIsSimulating(true);
    setSimulationStatus(`Running 0/${total} simulations...`);
    setMultiRun(null);

    const step = () => {
      if (activeRunJobRef.current !== jobId) return;
      const next = runSimulation(data, season, capYear, assumptions, overrides, completed);
      if (!firstRun) firstRun = next;
      addRunToAccumulator(accumulator, next);
      completed += 1;

      if (completed === 1 || completed % 5 === 0 || completed === total) {
        setSimulationStatus(`Running ${completed}/${total} simulations...`);
      }

      if (completed < total) {
        window.setTimeout(step, 0);
        return;
      }

      if (activeRunJobRef.current !== jobId || !firstRun) return;
      writeCachedSimulationRun(data, simulationCacheKey(season, capYear, assumptions, overrides), firstRun);
      setRunOffset((current) => current + total);
      setRun(firstRun);
      setMultiRun(finalizeMultiRunAccumulator(accumulator));
      setIsSimulating(false);
      setSimulationStatus(null);
    };

    window.setTimeout(step, 16);
  };

  const exportRun = (kind: "json" | "csv") => {
    if (!run) return;
    const payload = kind === "json" ? JSON.stringify(run, null, 2) : runToCsv(run);
    const mime = kind === "json" ? "application/json" : "text/csv";
    downloadText(`offseason-simulation-${run.seed}.${kind}`, payload, mime);
  };

  const importOverrides = (text: string) => {
    try {
      const parsed = JSON.parse(text) as Partial<SimulatorOverrides>;
      setOverrides({
        teams: parsed.teams ?? {},
        players: parsed.players ?? {},
        prospects: parsed.prospects ?? {}
      });
    } catch {
      window.alert("That JSON did not parse. Keep the shape as { teams, players, prospects }.");
    }
  };

  return (
    <main className="workspace offseason-workspace">
      <section className="offseason-shell">
        <section className="offseason-main">
          {run && headline ? (
            <OffseasonCommandBar
              season={season}
              capYear={capYear}
              draftYear={draftYear}
              run={run}
              headline={headline}
              teams={teams}
              selectedTeam={selectedTeam}
              assumptions={assumptions}
              activePreset={activePreset}
              overrideStats={overrideStats}
              isSimulating={isSimulating}
              simulationStatus={simulationStatus}
              onTeamSelect={setSelectedTeam}
              onRunOne={runOne}
              onRunMany={runMany}
              onExport={exportRun}
              onAssumptionChange={updateAssumption}
              onPreset={applyPreset}
            />
          ) : (
            <OffseasonLoadingPanel season={season} draftYear={draftYear} isSimulating={isSimulating} simulationStatus={simulationStatus} />
          )}
          {run && headline && (
            <>
          <div className="offseason-tabs" role="tablist" aria-label="Offseason simulator sections">
            {[
              ["dashboard", "Dashboard"],
              ["warRoom", "War Room"],
              ["league", "League Board"],
              ["draft", "Draft"],
              ["options", "Options"],
              ["freeAgency", "Free Agency"],
              ["trades", "Trades"],
              ["teams", "Cap Sheets"],
              ["markets", "Markets"],
              ["overrides", `Overrides${overrideStats.total ? ` (${overrideStats.total})` : ""}`]
            ].map(([key, label]) => (
              <button key={key} className={cls(activeTab === key && "active")} onClick={() => setActiveTab(key as OffseasonTab)}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === "dashboard" && (
            <DashboardView run={run} selectedTeam={selectedTeam} multiRun={multiRun} />
          )}

          {activeTab === "warRoom" && (
            <div className="offseason-stack">
              <div className="offseason-kpis">
                <MetricCard label="Draft picks" value={String(run.draft.length)} />
                <MetricCard label="Options" value={String(run.options.length)} />
                <MetricCard label="Signings" value={String(run.freeAgency.length)} />
                <MetricCard label="Trades" value={String(run.trades.length)} />
                <MetricCard label="Avg payroll" value={formatMoney(avg(run.teams.map((team) => team.payroll)))} />
              </div>
              <WarRoomView plans={warRoomPlans} selectedTeam={selectedTeam} selectedPlan={selectedPlan} multiRun={multiRun} />
              <DecisionBoard run={run} selectedTeam={selectedTeam} />
              {multiRun && <MultiRunPanel summary={multiRun} />}
            </div>
          )}

          {activeTab === "league" && <LeagueBoardView plans={warRoomPlans} onSelectTeam={setSelectedTeam} />}
          {activeTab === "draft" && <DraftResultsTable selections={run.draft} selectedTeam={selectedTeam} />}
          {activeTab === "options" && <OptionResultsTable decisions={run.options} selectedTeam={selectedTeam} />}
          {activeTab === "freeAgency" && <SigningResultsTable signings={filteredSignings} audit={run.marketAudit} selectedTeam={selectedTeam} />}
          {activeTab === "trades" && <TradeResultsTable trades={filteredTrades} diagnostics={run.tradeDiagnostics} />}
          {activeTab === "teams" && <TeamCapTable teams={filteredTeamRows} />}
          {activeTab === "markets" && <MarketPlanView run={run} selectedTeam={selectedTeam} />}
          {activeTab === "overrides" && (
            <DataEditor
              players={seasonPlayers}
              prospects={prospects}
              teamCodes={teamCodes}
              selectedPlayer={selectedPlayer}
              selectedProspect={selectedProspect}
              selectedTeam={selectedTeamForEdit}
              overrides={overrides}
              offseasonTruth={data.offseasonTruth}
              season={season}
              onPlayerSelect={setSelectedPlayerId}
              onProspectSelect={setSelectedProspectId}
              onTeamSelect={setSelectedTeamCode}
              onOverridesChange={setOverrides}
              onImport={importOverrides}
            />
          )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function runSimulation(data: AppData, season: number, capYear: number, assumptions: SimulatorAssumptions, overrides: SimulatorOverrides, runIndex: number): SimulationRun {
  const rng = mulberry32((Math.round(assumptions.seed) + runIndex * 9973) >>> 0);
  const teamMeta = buildTeamMeta(data.teams, season);
  const capIndex = buildCapTrackerIndex(data.capTracker, season, capYear);
  const players = buildSimPlayers(data.players.filter((player) => player.year === season), overrides, data.offseasonTruth, capIndex);
  const draftYear = inferDraftYear(data.prospects, season);
  const prospects = buildSimProspects(data.prospects.filter((prospect) => prospect.draft_year === draftYear), overrides);
  const teams = initializeTeams(teamMeta, players, data.picks, assumptions, overrides, data.offseasonTruth, season, capIndex);
  const explanations: SimulationRun["explanations"] = [];
  const tradeDiagnostics: string[] = [];

  const options = simulateOptions(players, teams, assumptions, rng);
  options.forEach((decision) => explanations.push({
    kind: "option",
    title: `${decision.player.name} ${decision.decision === "exercise" ? "exercises" : "declines"} ${decision.optionType}`,
    team: decision.team,
    player: decision.player.name,
    explanation: decision.explanation,
    score: decision.score,
    plausibility: decision.plausibility
  }));

  const draft = simulateDraft(prospects, teams, data.picks, assumptions, rng);
  draft.forEach((selection) => explanations.push({
    kind: "draft",
    title: `${selection.team} drafts ${selection.prospect.name}`,
    team: selection.team,
    player: selection.prospect.name,
    explanation: selection.explanation,
    score: selection.score,
    plausibility: selection.plausibility
  }));

  applyCapPathDecisions(teams, players, assumptions);

  const preMarketTrades = simulateTrades(teams, assumptions, rng, tradeDiagnostics, "pre-fa");
  const market = simulateFreeAgencyMarket(players, teams, assumptions, rng);
  const freeAgency = market.signings;
  freeAgency.forEach((signing) => explanations.push({
    kind: signing.status === "RFA" ? "rfa" : "ufa",
    title: `${signing.player.name} to ${signing.toTeam}`,
    team: signing.toTeam,
    player: signing.player.name,
    explanation: signing.explanation,
    score: signing.score,
    plausibility: signing.plausibility
  }));

  const postMarketTrades = simulateTrades(teams, assumptions, rng, tradeDiagnostics, "post-fa");
  const trades = [...preMarketTrades, ...postMarketTrades];
  trades.forEach((trade) => explanations.push({
    kind: "trade",
    title: `${trade.player.name} traded to ${trade.teamB}`,
    team: trade.teamB,
    player: trade.player.name,
    explanation: trade.explanation,
    score: trade.scoreB,
    plausibility: trade.plausibility
  }));

  refreshTeamPayrolls(teams, assumptions);
  const teamSummaries = Array.from(teams.values())
    .map((team) => teamSummary(team, market.bids))
    .sort((a, b) => b.payroll - a.payroll);

  return {
    id: `run-${assumptions.seed}-${runIndex}`,
    seed: Math.round(assumptions.seed) + runIndex * 9973,
    season,
    capYear,
    draftYear,
    draft,
    options,
    freeAgency,
    trades,
    teams: teamSummaries,
    players,
    marketAudit: market.audit,
    marketBids: market.bids,
    marketLedger: market.ledger,
    marketResolutions: market.resolutions,
    tradeDiagnostics,
    explanations: explanations.sort((a, b) => b.plausibility - a.plausibility)
  };
}

function OffseasonLoadingPanel({ season, draftYear, isSimulating, simulationStatus }: { season: number; draftYear: number; isSimulating: boolean; simulationStatus: string | null }) {
  return (
    <section className="offseason-panel offseason-loading-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Preparing Offseason Sandbox</h2>
          <p>{`Building an isolated ${season} roster/value season with the ${draftYear} draft class. Player Impact data stays read-only.`}</p>
        </div>
      </div>
      <div className="loading-state-card">
        <strong>{simulationStatus ?? (isSimulating ? "Generating run..." : "Ready")}</strong>
        <span>Free agency, trades, options, and draft outcomes are simulated in local copies before the workspace renders.</span>
      </div>
    </section>
  );
}

type IdleWorkHandle = { id: number; idle: boolean };

function scheduleIdleWork(task: () => void): IdleWorkHandle {
  const win = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (typeof win.requestIdleCallback === "function") {
    return { id: win.requestIdleCallback(task, { timeout: 120 }), idle: true };
  }
  return { id: window.setTimeout(task, 16), idle: false };
}

function cancelIdleWork(handle: IdleWorkHandle) {
  const win = window as Window & { cancelIdleCallback?: (id: number) => void };
  if (handle.idle && typeof win.cancelIdleCallback === "function") win.cancelIdleCallback(handle.id);
  else window.clearTimeout(handle.id);
}

function simulationCacheKey(season: number, capYear: number, assumptions: SimulatorAssumptions, overrides: SimulatorOverrides): string {
  return JSON.stringify({
    season,
    capYear,
    seed: Math.round(assumptions.seed),
    variance: assumptions.variance,
    draftFitWeight: assumptions.draftFitWeight,
    marketAggression: assumptions.marketAggression,
    tradeAggression: assumptions.tradeAggression,
    taxSensitivity: assumptions.taxSensitivity,
    cap: assumptions.cap,
    tax: assumptions.tax,
    firstApron: assumptions.firstApron,
    secondApron: assumptions.secondApron,
    overrides
  });
}

function readCachedSimulationRun(data: AppData, key: string): SimulationRun | null {
  return offseasonRunCache?.data === data && offseasonRunCache.key === key ? offseasonRunCache.run : null;
}

function writeCachedSimulationRun(data: AppData, key: string, run: SimulationRun) {
  offseasonRunCache = { data, key, run };
}

function simulateOptions(players: SimPlayer[], teams: Map<string, TeamState>, assumptions: SimulatorAssumptions, rng: () => number): OptionDecision[] {
  const decisions: OptionDecision[] = [];
  players
    .filter((player) => player.status === "Player Option" || player.status === "Team Option" || player.status === "Non-Guaranteed")
    .sort((a, b) => b.marketValue - a.marketValue)
    .forEach((player) => {
      const team = teams.get(player.rightsTeam);
      if (!team) return;
      const optionSalary = player.salary || player.marketValue;
      const needFit = needFitScore(team, player.position, player.skills);
      const taxPain = taxPainScore(team, optionSalary, assumptions);
      const risk = player.declineRisk + Math.max(0, (player.age - 30) / 16);
      const randomness = centeredRandom(rng, assumptions.variance);
      const isPlayerOption = player.status === "Player Option";
      const isNonGuaranteed = player.status === "Non-Guaranteed";
      const total = isPlayerOption
        ? optionSalary / Math.max(player.marketValue, 1) - 0.42 * risk + randomness
        : player.marketValue / Math.max(optionSalary, 1) + 0.3 * needFit - 0.4 * taxPain + team.willingness * 0.12 + randomness;
      const decision = isPlayerOption
        ? total >= 0.96 ? "exercise" : "decline"
        : total >= (isNonGuaranteed ? 0.86 : 0.96) ? "exercise" : "decline";
      const score = makeScore({
        needFit,
        value: clamp(isPlayerOption ? optionSalary / Math.max(player.marketValue, 1) : player.marketValue / Math.max(optionSalary, 1), 0, 2),
        timeline: timelineFit(team, player),
        urgency: urgencyScore(team),
        taxPain,
        assetValue: player.tradeValue / Math.max(assumptions.cap, 1),
        replacement: player.replaceability,
        upsideRisk: player.upside - risk,
        incumbency: 0.8,
        randomness
      });
      const optionType = isPlayerOption ? "Player Option" : isNonGuaranteed ? "Non-Guaranteed" : "Team Option";
      const explanation = optionExplanation(player, team, decision, optionSalary, score, optionType);
      resolveTrackedRosterPlaceholder(team, player, optionSalary);
      if (decision === "exercise") {
        player.team = team.team;
        player.salary = optionSalary;
        player.status = "Signed";
        addPlayerToTeamRoster(team, player);
        releaseCapHold(teams, player);
      } else {
        player.team = "FA";
        player.status = "UFA";
      }
      decisions.push({
        player,
        team: team.team,
        optionType,
        decision,
        score,
        explanation,
        plausibility: plausibilityFromScore(score, 0.58)
      });
    });
  refreshTeamPayrolls(teams, assumptions);
  return decisions;
}

function simulateDraft(
  prospects: SimProspect[],
  teams: Map<string, TeamState>,
  picks: PickAsset[],
  assumptions: SimulatorAssumptions,
  rng: () => number
): DraftSelection[] {
  const selections: DraftSelection[] = [];
  const available = [...prospects].sort((a, b) => a.consensusRank - b.consensusRank || a.modelRank - b.modelRank).slice(0, 75);
  const pickValues = new Map(picks.map((pick) => [pick.pick, pick.value]));
  const order = draftOrder(Array.from(teams.values()), prospects[0]?.draftYear, rng);
  for (const officialPick of order.slice(0, Math.min(60, available.length))) {
    const pick = officialPick.pick;
    const team = teams.get(officialPick.team);
    if (!team) continue;
    const isContender = team.mode === "contender" || team.mode === "tax-sensitive contender";
    const poolDepth = pick <= 14 ? 9 : pick <= 30 ? 13 : 18;
    const pool = available
      .map((prospect) => {
        const bestConsensus = available[0]?.consensusRank ?? prospect.consensusRank;
        const tierPenalty = Math.max(0, tierRank(prospect.tier) - tierRank(available[0]?.tier ?? prospect.tier)) * 0.18;
        const reachPenalty = Math.max(0, prospect.consensusRank - pick) * (pick <= 14 ? 0.072 : pick <= 30 ? 0.046 : 0.028);
        const stealBonus = Math.max(0, pick - prospect.consensusRank) * (pick <= 14 ? 0.024 : 0.018);
        const consensusScore = clamp((80 - prospect.consensusRank) / 80 + Math.max(0, 12 - Math.abs(prospect.consensusRank - pick)) / 48, 0, 1.25);
        const fit = prospectFit(team, prospect);
        const modelBpa = prospect.bpa;
        const readiness = isContender ? Math.max(0, 1 - prospect.risk) : prospect.upside;
        const fitNudge = fit * assumptions.draftFitWeight * (pick <= 14 ? 0.16 : 0.24);
        const randomness = centeredRandom(rng, assumptions.variance) * (pick <= 8 ? 0.16 : 0.38);
        const consensusDiscipline = Math.max(0, prospect.consensusRank - bestConsensus) * 0.01;
        const total = consensusScore * 0.62 + modelBpa * 0.26 + fitNudge + readiness * 0.06 + stealBonus - reachPenalty - tierPenalty - consensusDiscipline + randomness;
        return { prospect, fit, bpa: modelBpa, readiness, randomness, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, poolDepth);
    const winner = weightedChoice(pool, (item) => Math.exp(item.total * 2.6), rng);
    available.splice(available.findIndex((prospect) => prospect.id === winner.prospect.id), 1);
    const salary = rookieScaleSalary(pick, assumptions.cap);
    consumeDraftPickPlaceholder(team, salary);
    addPlayerToTeamRoster(team, prospectToPlayer(winner.prospect, team.team, salary, pick));
    team.pickAssets = Math.max(0, team.pickAssets - (pickValues.get(pick) ?? 0) * 0.2);
    const fitDelta = winner.fit - avg(team.needs.map((skill) => winner.prospect.skills[skill]));
    const consensusDelta = winner.prospect.consensusRank - pick;
    const reachSteal = consensusDelta >= 8 ? "Reach" : consensusDelta <= -8 ? "Steal" : "Range";
    const score = makeScore({
      needFit: winner.fit,
      value: winner.bpa,
      timeline: winner.readiness,
      urgency: urgencyScore(team),
      taxPain: taxPainScore(team, salary, assumptions),
      assetValue: safeRatio(pickValues.get(pick) ?? 0, assumptions.cap),
      replacement: 0.5,
      upsideRisk: winner.prospect.upside - winner.prospect.risk,
      incumbency: 0,
      randomness: winner.randomness
    });
    selections.push({
      pick,
      team: team.team,
      pickLabel: officialPick.label,
      prospect: winner.prospect,
      consensusRank: winner.prospect.consensusRank,
      modelRank: winner.prospect.modelRank,
      fitDelta,
      reachSteal,
      score,
      explanation: `${officialPick.label} used the official pick slot. Consensus rank ${formatNumber(winner.prospect.consensusRank, 0)} led the board, model/BPA rank ${formatNumber(winner.prospect.modelRank, 0)} was second, and ${team.needs.join(", ")} fit only nudged close calls.`,
      plausibility: plausibilityFromScore(score, 0.52)
    });
  }
  refreshTeamPayrolls(teams, assumptions);
  return selections;
}

function simulateTrades(teams: Map<string, TeamState>, assumptions: SimulatorAssumptions, rng: () => number, diagnostics: string[], phase: "pre-fa" | "post-fa"): TradeMove[] {
  const trades: TradeMove[] = [];
  const allTeams = Array.from(teams.values());
  const rejected: string[] = [];
  const maxTrades = Math.round(1 + assumptions.tradeAggression * 5 + rng() * 2);
  const candidates = allTeams.flatMap((seller) => {
    const sellers = seller.roster
      .filter((player) => isReasonableTradeCandidate(seller, player, assumptions))
      .map((player) => ({ seller, player }));
    return sellers;
  }).sort((a, b) => tradeCandidatePriority(b.seller, b.player, assumptions) - tradeCandidatePriority(a.seller, a.player, assumptions));

  for (const candidate of candidates) {
    if (trades.length >= maxTrades) break;
    if (trades.length > 0 && rng() > assumptions.tradeAggression + (phase === "pre-fa" ? 0.22 : 0.36)) continue;
    const seller = candidate.seller;
    const player = candidate.player;
    const buyers = allTeams
      .filter((team) => team.team !== seller.team && standardRosterSlotsRemaining(team) > 0)
      .map((buyer) => {
        const need = needFitScore(buyer, player.position, player.skills);
        const winNow = urgencyScore(buyer);
        const matching = tradeMatchingContext(buyer, seller, player.salary, assumptions);
        const legal = matching.legal;
        const preTradePain = taxPainScore(seller, 0, assumptions);
        const postTradePain = taxPainScore(seller, -player.salary, assumptions);
        const salaryRelief = Math.max(0, preTradePain - postTradePain);
        const sellerPain = Math.max(0, -seller.firstApronRoom / assumptions.cap) + preTradePain;
        const assetPrice = player.tradeValue * (0.52 + 0.24 * rng()) * (sellerPain > 0.4 ? 0.82 : 1);
        const buyerScore = makeScore({
          needFit: need,
          value: clamp(safeRatio(player.tradeValue - matching.outgoingSalary * 0.3, assumptions.cap) + 0.52, 0, 1.35),
          timeline: timelineFit(buyer, player),
          urgency: winNow,
          taxPain: taxPainScore(buyer, player.salary - matching.outgoingSalary, assumptions),
          assetValue: safeRatio(assetPrice, assumptions.cap),
          replacement: player.replaceability,
          upsideRisk: player.upside - player.declineRisk,
          incumbency: 0,
          randomness: centeredRandom(rng, assumptions.variance)
        });
        const sellerScore = makeScore({
          needFit: sellerPain,
          value: safeRatio(assetPrice + player.salary * (0.28 + salaryRelief), assumptions.cap),
          timeline: seller.mode === "rebuilding" || seller.mode === "rising" ? 0.8 : 0.35,
          urgency: seller.mode === "tax-sensitive contender" ? 0.9 : 0.35,
          taxPain: postTradePain,
          assetValue: safeRatio(assetPrice, assumptions.cap),
          replacement: 1 - player.replaceability,
          upsideRisk: seller.mode === "rebuilding" ? 0.7 : 0.25,
          incumbency: 0,
          randomness: centeredRandom(rng, assumptions.variance)
        });
        return { buyer, legal, matching, assetPrice, buyerScore, sellerScore };
      })
      .filter((item) => {
        const ok = item.legal && item.buyerScore.total > 0.38 && item.sellerScore.total > 0.36 && item.assetPrice <= Math.max(item.buyer.pickAssets * 1.35, assumptions.cap * 0.018);
        if (!ok && rejected.length < 12) {
          rejected.push(`${item.buyer.team}/${seller.team}/${player.name}: ${!item.legal ? item.matching.reason : `buyer ${formatNumber(item.buyerScore.total, 2)} seller ${formatNumber(item.sellerScore.total, 2)} price ${formatMoney(item.assetPrice)}`}`);
        }
        return ok;
      })
      .sort((a, b) => b.buyerScore.total + b.sellerScore.total - (a.buyerScore.total + a.sellerScore.total));
    const winner = buyers[0];
    if (!winner) continue;
    movePlayer(candidate.seller, winner.buyer, player);
    const pickValue = Math.min(winner.assetPrice, winner.buyer.pickAssets);
    winner.buyer.pickAssets = Math.max(0, winner.buyer.pickAssets - pickValue);
    candidate.seller.pickAssets += pickValue;
    refreshTeamPayroll(candidate.seller, assumptions);
    refreshTeamPayroll(winner.buyer, assumptions);
    const trade: TradeMove = {
      id: `trade-${candidate.seller.team}-${winner.buyer.team}-${player.id}`,
      teamA: candidate.seller.team,
      teamB: winner.buyer.team,
      player,
      salary: player.salary,
      buyerOutgoingSalary: winner.matching.outgoingSalary,
      pickValue,
      buyerGets: [`${player.name} (${player.position}, ${formatMoney(player.salary)} salary)`],
      sellerGets: [`${formatMoney(pickValue)} pick-equivalent value`, `${formatMoney(Math.max(0, player.salary - winner.matching.outgoingSalary))} net salary relief`, `${formatMoney(winner.matching.outgoingSalary)} matching salary`],
      sellerMotivation: tradeSellerMotivation(candidate.seller, player, assumptions),
      buyerMotivation: tradeBuyerMotivation(winner.buyer, player),
      salaryRule: winner.matching.reason,
      scoreA: winner.sellerScore,
      scoreB: winner.buyerScore,
      explanation: `${winner.buyer.team} adds a ${player.position} who fits ${winner.buyer.needs.join(", ")} needs; ${candidate.seller.team} gets ${formatMoney(Math.max(0, player.salary - winner.matching.outgoingSalary))} net relief and about ${formatMoney(pickValue)} in pick-equivalent value. ${tradeSellerMotivation(candidate.seller, player, assumptions)}`,
      plausibility: clamp((winner.buyerScore.total + winner.sellerScore.total) / 2, 0, 1)
    };
    trades.push(trade);
  }
  if (trades.length === 0) {
    diagnostics.push(`${phase}: no trade cleared. Top rejected paths: ${rejected.slice(0, 5).join(" / ") || "no seller candidates met baseline thresholds"}`);
  }
  return trades;
}

function isReasonableTradeCandidate(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions): boolean {
  if (player.salary < assumptions.cap * 0.012) return false;
  if (player.tradeValue < assumptions.cap * 0.004) return false;
  if (isFranchiseAnchor(team, player)) return false;
  const taxPressure = team.taxRoom < assumptions.cap * 0.04 || team.firstApronRoom < assumptions.cap * 0.06;
  const timelineMismatch = timelineFit(team, player) < 0.5;
  const expendableRole = player.replaceability > 0.25 || player.score < 82;
  const rebuildVeteran = (team.mode === "rebuilding" || team.mode === "rising") && player.age >= 29 && player.salary > player.marketValue * 0.9;
  return taxPressure || timelineMismatch || expendableRole || rebuildVeteran;
}

function isFranchiseAnchor(team: TeamState, player: SimPlayer): boolean {
  const topRosterScore = Math.max(...team.roster.map((candidate) => candidate.score), 0);
  const topSalary = Math.max(...team.roster.map((candidate) => candidate.salary), 0);
  const eliteTier = player.tier === "MVP" || player.tier === "Superstar" || player.score >= 93;
  const coreStar = (player.score >= 88 || player.salary >= topSalary * 0.92) && player.score >= topRosterScore - 3;
  const stillPrime = player.age <= 32 || player.upside > 0.35;
  return stillPrime && (eliteTier || coreStar);
}

function tradeCandidatePriority(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions): number {
  const taxPressure = Math.max(0, -team.taxRoom / assumptions.cap) + Math.max(0, (assumptions.cap * 0.04 - team.firstApronRoom) / assumptions.cap);
  const mismatch = 1 - timelineFit(team, player);
  const salaryWeight = player.salary / assumptions.cap;
  return taxPressure * 1.4 + mismatch * 0.8 + player.replaceability * 0.6 + salaryWeight;
}

function tradeSellerMotivation(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions): string {
  if (team.taxRoom < 0 || team.firstApronRoom < assumptions.cap * 0.03) return `${team.team} is reacting to tax/apron pressure.`;
  if ((team.mode === "rebuilding" || team.mode === "rising") && player.age >= 29) return `${team.team} moves a veteran who is ahead of its timeline.`;
  if (player.replaceability > 0.45) return `${team.team} treats the role as replaceable enough to monetize.`;
  return `${team.team} gets asset value without moving a franchise-level player.`;
}

function tradeBuyerMotivation(team: TeamState, player: SimPlayer): string {
  const fit = needFitScore(team, player.position, player.skills);
  if (team.mode === "contender" || team.mode === "tax-sensitive contender") return `${team.team} buys a win-now role with ${formatNumber(fit, 2)} need fit.`;
  if (team.mode === "playoff hopeful") return `${team.team} tries to convert flexibility into a rotation upgrade.`;
  return `${team.team} uses asset depth to add a player closer to its timeline.`;
}

function tradeMatchingContext(buyer: TeamState, seller: TeamState, salary: number, assumptions: SimulatorAssumptions): { legal: boolean; outgoingSalary: number; reason: string } {
  if (buyer.capSpace >= salary) {
    return { legal: true, outgoingSalary: 0, reason: `${buyer.team} can absorb ${formatMoney(salary)} into bottom-up cap room.` };
  }
  if (buyer.secondApronRoom < 0 && salary > assumptions.cap * 0.035) {
    return { legal: false, outgoingSalary: 0, reason: `${buyer.team} is second-apron constrained; incoming salary is too large.` };
  }
  const outgoingCapacity = buyer.roster
    .filter((player) => !isFranchiseAnchor(buyer, player) && player.id !== seller.team)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .reduce((total, player) => total + player.salary, 0);
  const requiredOutgoing = Math.max(0, salary / 1.25 - 250_000);
  const apronBlocked = buyer.firstApronRoom < salary * 0.2 && seller.firstApronRoom < 0;
  const legal = outgoingCapacity >= requiredOutgoing && !apronBlocked;
  return {
    legal,
    outgoingSalary: legal ? requiredOutgoing : Math.min(outgoingCapacity, requiredOutgoing),
    reason: legal
      ? `${buyer.team} can aggregate about ${formatMoney(requiredOutgoing)} outgoing salary from non-anchor contracts for ${formatMoney(salary)} incoming.`
      : `${buyer.team} lacks matching salary: needs ${formatMoney(requiredOutgoing)}, model found ${formatMoney(outgoingCapacity)}.`
  };
}

function initializeTeams(
  projections: TeamProjection[],
  players: SimPlayer[],
  picks: PickAsset[],
  assumptions: SimulatorAssumptions,
  overrides: SimulatorOverrides,
  truthData: OffseasonTruthData | undefined,
  season: number,
  capIndex: CapTrackerIndex
): Map<string, TeamState> {
  const teams = new Map<string, TeamState>();
  const slotPickValue = picks.reduce((sum, pick) => sum + (pick.round === 1 ? pick.value : pick.value * 0.35), 0) / 30;
  const slotValues = new Map(picks.map((pick) => [pick.pick, pick.value]));
  const officialPickCache = OFFICIAL_2026_DRAFT_ORDER.reduce<Record<string, { count: number; premium: number; value: number }>>((cache, pick) => {
    const row = cache[pick.team] ?? { count: 0, premium: 0, value: 0 };
    row.count += 1;
    if (pick.pick <= 20) row.premium += 1;
    row.value += slotValues.get(pick.pick) ?? 0;
    cache[pick.team] = row;
    return cache;
  }, {});
  const capByTeam = new Map((truthData?.team_caps ?? []).filter((row) => row.year === season).map((row) => [row.team, row]));
  projections.forEach((projection) => {
    const signedRoster = players.filter((player) => player.team === projection.team && player.status === "Signed");
    const baseMode = teamMode(projection);
    const override = overrides.teams[projection.team];
    const pickCache = officialPickCache[projection.team] ?? { count: 0, premium: 0, value: 0 };
    const capTruth = capByTeam.get(projection.team);
    const trackerTeam = capIndex.teams.get(projection.team);
    const signedSalary = sum(signedRoster.map((player) => player.salary));
    const signedGuaranteed = sum(signedRoster.map((player) => player.guaranteedSalary || player.salary));
    const trackerActiveSalary = trackerTeam?.active_salary ?? capTruth?.active_salary;
    const trackerGuaranteedSalary = trackerTeam?.guaranteed_salary ?? capTruth?.guaranteed_salary;
    const deadCap = trackerTeam?.dead_money ?? capTruth?.dead_cap ?? sum(players.filter((player) => player.rightsTeam === projection.team || player.team === projection.team).map((player) => player.deadCap));
    const capHolds = trackerTeam?.cap_holds ?? capTruth?.cap_holds ?? sum(players.filter((player) => player.rightsTeam === projection.team && player.status !== "Signed").map(capHoldForPlayer));
    const activeRosterCountBase = trackerTeam?.roster_count ?? signedRoster.length;
    const rosterCountAdjustment = Math.max(0, activeRosterCountBase - signedRoster.length);
    const standardRosterLimit = STANDARD_ROSTER_LIMIT;
    const minimumRosterCount = MINIMUM_STANDARD_ROSTER;
    const targetRosterCount = targetRosterCountForMode(override?.mode ?? baseMode, standardRosterLimit, minimumRosterCount);
    const draftPickPlaceholders = capIndex.draftPickPlaceholdersByTeam.get(projection.team) ?? { count: 0, salary: 0 };
    const minimumRosterCharge = capIndex.season?.minimum_roster_charge ?? assumptions.cap * 0.008;
    const team: TeamState = {
      team: projection.team,
      name: projection.team_name,
      mode: override?.mode ?? baseMode,
      capYear: capIndex.capYear,
      capPath: "retained_rights",
      capPathReason: "Retained holds by default while preserving own-player rights.",
      projectedWins: projection.projected_wins,
      projectedRank: projection.rank,
      roster: [...signedRoster],
      rosterCountAdjustment,
      standardRosterLimit,
      targetRosterCount,
      minimumRosterCount,
      draftPickPlaceholderCount: draftPickPlaceholders.count,
      draftPickPlaceholderSalary: draftPickPlaceholders.salary,
      minimumRosterCharge,
      activeRosterCountBase,
      payroll: trackerActiveSalary ?? signedSalary,
      activeSalary: trackerActiveSalary ?? signedSalary,
      guaranteedSalary: trackerGuaranteedSalary ?? signedGuaranteed,
      activeSalaryAdjustment: Math.max(0, (trackerActiveSalary ?? signedSalary) - signedSalary),
      guaranteedSalaryAdjustment: Math.max(0, (trackerGuaranteedSalary ?? signedGuaranteed) - signedGuaranteed),
      deadCap,
      capHolds,
      initialCapHolds: capHolds,
      holdsRetained: capHolds,
      holdsRenounced: 0,
      rosterCharges: capTruth?.roster_charges ?? 0,
      heldCapSpace: 0,
      capSpace: 0,
      renouncedCapSpace: 0,
      maximumCapSpace: 0,
      capRoomWithHolds: trackerTeam?.cap_room_with_holds ?? capTruth?.practical_cap_space ?? 0,
      capRoomRenounced: trackerTeam?.cap_room_renounced ?? capTruth?.maximum_cap_space ?? 0,
      statusBand: trackerTeam?.status_band,
      statusBandWithHolds: trackerTeam?.status_band_with_holds,
      statusBandRenounced: trackerTeam?.status_band_renounced,
      taxRoom: 0,
      firstApronRoom: 0,
      secondApronRoom: 0,
      needs: override?.needs ?? inferNeeds(projection),
      pickAssets: Math.max(pickCache.value, slotPickValue * pickAssetMultiplier(baseMode)),
      pickCount: pickCache.count,
      premiumPickCount: pickCache.premium,
      willingness: override?.willingness ?? willingnessForMode(baseMode),
      exceptions: buildSpendingToolsForTeam(projection.team, trackerTeam, capIndex, assumptions),
      toolLedger: [],
      explanations: []
    };
    refreshTeamPayroll(team, assumptions);
    teams.set(projection.team, team);
  });
  return teams;
}

const TAXPAYER_MLE_BASE_2024 = 5_000_000;
const TAXPAYER_MLE_BASE_CAP_2024 = 136_021_000;

function buildSpendingToolsForTeam(team: string, trackerTeam: CapTrackerTeamSeason | undefined, capIndex: CapTrackerIndex, assumptions: SimulatorAssumptions): SpendingTool[] {
  const trackerTools = (capIndex.exceptionsByTeam.get(team) ?? [])
    .map((row) => spendingToolFromCapException(row))
    .filter((tool): tool is SpendingTool => Boolean(tool));
  const tools = trackerTools.length ? trackerTools : modeledExceptionTools(trackerTeam, assumptions);
  const byKind = new Map<SpendingTool["kind"], SpendingTool>();
  [...tools, { name: "Minimum", amount: minimumExceptionAmount(assumptions), used: 0, kind: "minimum" as const, path: "either", source: "modeled minimum exception" }]
    .forEach((tool) => {
      const prior = byKind.get(tool.kind);
      if (!prior || tool.amount > prior.amount) byKind.set(tool.kind, { ...tool, amount: Math.round(tool.amount), used: tool.used ?? 0 });
    });
  return Array.from(byKind.values()).sort((a, b) => spendingToolSort(a.kind) - spendingToolSort(b.kind));
}

function spendingToolFromCapException(row: CapTrackerException): SpendingTool | null {
  const kind = exceptionKindFromName(row.name);
  if (!kind || row.amount <= 0) return null;
  return {
    name: row.name,
    amount: row.amount,
    used: 0,
    kind,
    path: row.path,
    source: row.source_quality === "override" ? "cap tracker override" : "cap tracker projection"
  };
}

function modeledExceptionTools(trackerTeam: CapTrackerTeamSeason | undefined, assumptions: SimulatorAssumptions): SpendingTool[] {
  const tools: SpendingTool[] = [];
  const roomWithHolds = trackerTeam?.room_if_holds_retained ?? trackerTeam?.cap_room_with_holds ?? 0;
  const firstApronWithHolds = trackerTeam?.first_apron_room_with_holds ?? trackerTeam?.first_apron_room ?? 0;
  const secondApronWithHolds = trackerTeam?.second_apron_room_with_holds ?? trackerTeam?.second_apron_room ?? 0;
  const roomIfRenounced = trackerTeam?.room_if_renounced ?? trackerTeam?.cap_room_renounced ?? 0;
  if (roomWithHolds <= 0) {
    if (firstApronWithHolds > minimumExceptionAmount(assumptions)) {
      tools.push({ name: "Non-Taxpayer MLE", amount: exceptionAmount("non_taxpayer_mle", assumptions), used: 0, kind: "non_taxpayer_mle", path: "retained", source: "modeled from cap tracker apron room" });
      tools.push({ name: "Bi-Annual", amount: exceptionAmount("bi_annual", assumptions), used: 0, kind: "bi_annual", path: "retained", source: "modeled from cap tracker apron room" });
    } else if (secondApronWithHolds > minimumExceptionAmount(assumptions)) {
      tools.push({ name: "Taxpayer MLE", amount: exceptionAmount("taxpayer_mle", assumptions), used: 0, kind: "taxpayer_mle", path: "retained", source: "modeled from cap tracker apron room" });
    }
  }
  if (roomIfRenounced > roomThresholdForCapPath(assumptions)) {
    tools.push({ name: "Room Exception", amount: exceptionAmount("room_exception", assumptions), used: 0, kind: "room_exception", path: "renounced", source: "modeled from cap tracker renounced room" });
  }
  return tools;
}

function exceptionKindFromName(name: string): SpendingTool["kind"] | null {
  const value = name.toLowerCase();
  if (value.includes("non-taxpayer") || value.includes("non taxpayer")) return "non_taxpayer_mle";
  if (value.includes("taxpayer")) return "taxpayer_mle";
  if (value.includes("room")) return "room_exception";
  if (value.includes("annual") || value.includes("bae")) return "bi_annual";
  if (value.includes("minimum")) return "minimum";
  if (value.includes("cap")) return "cap";
  if (value.includes("bird")) return "bird";
  return null;
}

function exceptionAmount(kind: SpendingTool["kind"], assumptions: SimulatorAssumptions): number {
  if (kind === "non_taxpayer_mle") return assumptions.cap * 0.0912;
  if (kind === "bi_annual") return assumptions.cap * 0.0353;
  if (kind === "room_exception") return assumptions.cap * 0.05678;
  if (kind === "taxpayer_mle") return TAXPAYER_MLE_BASE_2024 * (assumptions.cap / TAXPAYER_MLE_BASE_CAP_2024);
  if (kind === "minimum") return minimumExceptionAmount(assumptions);
  return 0;
}

function minimumExceptionAmount(assumptions: SimulatorAssumptions): number {
  return Math.max(2_500_000, assumptions.cap * 0.012);
}

function spendingToolSort(kind: SpendingTool["kind"]): number {
  if (kind === "cap") return 0;
  if (kind === "bird") return 1;
  if (kind === "non_taxpayer_mle") return 2;
  if (kind === "taxpayer_mle") return 3;
  if (kind === "bi_annual") return 4;
  if (kind === "room_exception") return 5;
  return 6;
}

function applyCapPathDecisions(teams: Map<string, TeamState>, players: SimPlayer[], assumptions: SimulatorAssumptions) {
  teams.forEach((team) => {
    refreshTeamPayroll(team, assumptions);
    const ownFreeAgents = players.filter((player) =>
      (player.status === "UFA" || player.status === "RFA") &&
      player.rightsTeam === team.team &&
      player.rights !== "None" &&
      capHoldForPlayer(player) > 0
    );
    const usableMaxRoom = Math.max(0, team.maximumCapSpace);
    const holdPlans = ownFreeAgents.map((player) => ownHoldPlan(team, player, assumptions));
    const outsideBoard = buildCapRoomTargetBoard(team, players, assumptions, usableMaxRoom);
    const bestOwn = holdPlans.slice().sort((a, b) => b.retainScore - a.retainScore)[0];
    const bestOutside = outsideBoard[0];
    const roomGain = Math.max(0, team.renouncedCapSpace - team.heldCapSpace);
    const roomThreshold = roomThresholdForCapPath(assumptions);
    const matchedHoldTotal = sum(holdPlans.map((plan) => plan.hold));
    const unmatchedHolds = Math.max(0, team.initialCapHolds - matchedHoldTotal);
    const lowEfficiencyHoldTotal = sum(holdPlans
      .filter((plan) => lowEfficiencyHold(plan, assumptions))
      .map((plan) => plan.hold));
    const retainedRightsScore = retainedRightsProgramScore(team, holdPlans, lowEfficiencyHoldTotal, assumptions);
    const capRoomProgram = buildCapRoomProgram(team, holdPlans, outsideBoard, assumptions);
    const shouldOpenRoom = usableMaxRoom >= roomThreshold &&
      roomGain >= roomThreshold &&
      outsideBoard.length > 0 &&
      capRoomProgram.score >= retainedRightsScore + 0.04;

    if (shouldOpenRoom) {
      team.capPath = "cap_room";
      const retainedIds = capRoomProgram.retainedIds;
      const retainedMatchedHolds = capRoomProgram.retainedHoldTotal;
      const modeledRoom = Math.max(0, team.maximumCapSpace - retainedMatchedHolds);

      const renouncedPlayers: SimPlayer[] = [];
      holdPlans.forEach((plan) => {
        const retain = retainedIds.has(plan.player.id);
        applyHoldPlanToPlayer(plan, retain, bestOutside?.player.name);
        if (!retain) renouncedPlayers.push(plan.player);
      });

      team.capPathReason = `Opened cap-room program: ${formatMoney(modeledRoom)} usable room after selective holds; outside board led by ${bestOutside?.player.name ?? "outside market"} beat retained-rights score ${formatNumber(retainedRightsScore, 2)}.`;
      team.holdsRetained = retainedMatchedHolds;
      team.holdsRenounced = Math.max(0, team.initialCapHolds - retainedMatchedHolds);
      team.capHolds = retainedMatchedHolds;
      if (unmatchedHolds > 0) {
        team.explanations.push(`Renounced ${formatMoney(unmatchedHolds)} in unmatched tracker holds to open room`);
      }
      if (lowEfficiencyHoldTotal > roomThreshold) {
        team.explanations.push(`Identified ${formatMoney(lowEfficiencyHoldTotal)} in low-efficiency holds before cap-room bidding`);
      }
      renouncedPlayers.slice(0, 3).forEach((player) => team.explanations.push(`Renounced ${player.name} hold`));
    } else {
      team.capPath = "retained_rights";
      team.capPathReason = bestOwn
        ? `Kept retained-rights path because ${bestOwn.player.name} has the highest rights option value.`
        : "Kept retained-rights path because the outside cap-room board did not clear the program threshold.";
      team.holdsRetained = team.initialCapHolds;
      team.holdsRenounced = 0;
      team.capHolds = team.initialCapHolds;
      holdPlans.forEach((plan) => applyHoldPlanToPlayer(plan, true, bestOutside?.player.name));
    }

    refreshTeamPayroll(team, assumptions);
  });
}

type CapRoomTarget = {
  player: SimPlayer;
  priority: number;
};

type CapRoomProgram = {
  score: number;
  retainedIds: Set<string>;
  retainedHoldTotal: number;
};

type OwnHoldPlan = {
  player: SimPlayer;
  hold: number;
  priority: number;
  rightsValue: number;
  scarcity: number;
  retainScore: number;
  protectedHold: boolean;
};

function buildCapRoomTargetBoard(team: TeamState, players: SimPlayer[], assumptions: SimulatorAssumptions, usableMaxRoom: number): CapRoomTarget[] {
  if (usableMaxRoom < roomThresholdForCapPath(assumptions)) return [];
  return players
    .filter((player) =>
      (player.status === "UFA" || player.status === "RFA") &&
      player.rightsTeam !== team.team &&
      player.marketValue >= minimumSalary(player) &&
      player.marketValue <= Math.max(usableMaxRoom * 1.45, assumptions.cap * 0.09)
    )
    .map((player) => ({
      player,
      priority: capPathPlayerPriority(team, player, assumptions, false) +
        clamp(player.marketValue / Math.max(usableMaxRoom, 1), 0, 0.16) +
        clamp((usableMaxRoom - player.marketValue) / Math.max(assumptions.cap, 1), -0.04, 0.08)
    }))
    .filter((row) => row.priority >= 0.34 || row.player.marketValue >= assumptions.cap * 0.055)
    .sort((a, b) => b.priority - a.priority || b.player.marketValue - a.player.marketValue)
    .slice(0, 18);
}

function retainedRightsProgramScore(team: TeamState, holdPlans: OwnHoldPlan[], lowEfficiencyHoldTotal: number, assumptions: SimulatorAssumptions): number {
  const bestOwn = holdPlans.slice().sort((a, b) => b.retainScore - a.retainScore)[0];
  const protectedValue = sum(holdPlans
    .filter((plan) => plan.protectedHold)
    .map((plan) => plan.retainScore * Math.min(plan.hold, assumptions.cap * 0.16) / assumptions.cap));
  const contenderBias = isContenderMode(team.mode) ? 0.08 : 0;
  const lowHoldDrag = clamp(lowEfficiencyHoldTotal / Math.max(assumptions.cap * 0.7, 1), 0, 0.34);
  return clamp((bestOwn?.retainScore ?? 0) * 0.72 + protectedValue * 0.6 + contenderBias - lowHoldDrag, 0, 1.2);
}

function buildCapRoomProgram(team: TeamState, holdPlans: OwnHoldPlan[], outsideBoard: CapRoomTarget[], assumptions: SimulatorAssumptions): CapRoomProgram {
  const roomThreshold = roomThresholdForCapPath(assumptions);
  const retainedIds = new Set<string>();
  let retainedHoldTotal = 0;
  const boardScore = outsideBoard
    .slice(0, 6)
    .reduce((total, row, index) => total + row.priority * (1 - index * 0.09) * 0.18, outsideBoard[0]?.priority ?? 0);
  const lowHoldRoomGain = sum(holdPlans.filter((plan) => lowEfficiencyHold(plan, assumptions)).map((plan) => plan.hold));
  const roomBonus = clamp(team.maximumCapSpace / Math.max(assumptions.cap, 1), 0, 0.28);
  const lowHoldBonus = clamp(lowHoldRoomGain / Math.max(assumptions.cap, 1), 0, 0.28);
  const retainable = holdPlans
    .filter((plan) => valuableHoldForCapRoom(plan, assumptions))
    .sort((a, b) => b.retainScore - a.retainScore || a.hold - b.hold);

  retainable.forEach((plan) => {
    const roomAfterRetain = team.maximumCapSpace - retainedHoldTotal - plan.hold;
    const keepUsefulRoom = roomAfterRetain >= roomThreshold &&
      (!outsideBoard[0] || roomAfterRetain >= Math.min(outsideBoard[0].player.marketValue * 0.72, assumptions.cap * 0.18));
    const keepWithoutRoom = outsideBoard.length === 0 && plan.retainScore >= 0.82;
    if (!keepUsefulRoom && !keepWithoutRoom) return;
    retainedIds.add(plan.player.id);
    retainedHoldTotal += plan.hold;
  });

  const protectedLossPenalty = holdPlans
    .filter((plan) => plan.protectedHold && !retainedIds.has(plan.player.id))
    .reduce((total, plan) => total + plan.retainScore * (plan.player.status === "RFA" ? 0.16 : 0.1), 0);
  return {
    score: clamp(boardScore + roomBonus + lowHoldBonus - protectedLossPenalty, 0, 1.25),
    retainedIds,
    retainedHoldTotal
  };
}

function valuableHoldForCapRoom(plan: OwnHoldPlan, assumptions: SimulatorAssumptions): boolean {
  if (plan.hold <= 0) return false;
  const efficiency = plan.player.marketValue / Math.max(plan.hold, minimumSalary(plan.player));
  if (plan.player.status === "RFA") return plan.retainScore >= 0.46 || plan.scarcity >= 0.62 || efficiency >= 0.72;
  return plan.retainScore >= 0.7 && (efficiency >= 0.62 || plan.player.marketValue >= assumptions.cap * 0.12);
}

function lowEfficiencyHold(plan: OwnHoldPlan, assumptions: SimulatorAssumptions): boolean {
  const efficiency = plan.player.marketValue / Math.max(plan.hold, minimumSalary(plan.player));
  if (plan.player.status === "RFA" && (plan.retainScore >= 0.58 || plan.scarcity >= 0.72)) return false;
  return plan.hold >= assumptions.cap * 0.035 && (efficiency < 0.72 || plan.retainScore < 0.46);
}

function roomThresholdForCapPath(assumptions: SimulatorAssumptions): number {
  return Math.max(8_000_000, assumptions.cap * 0.05);
}

function ownHoldPlan(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions): OwnHoldPlan {
  const hold = capHoldForPlayer(player);
  const priority = capPathPlayerPriority(team, player, assumptions, true);
  const scarcity = positionalScarcityScore(team, player);
  const rightsValue = rightsOptionValue(team, player, assumptions, hold, scarcity);
  const rfaControlPremium = player.status === "RFA" ? clamp(0.08 + player.upside * 0.08 + (player.age <= 25 ? 0.08 : 0), 0, 0.22) : 0;
  const birdToolPremium = player.rights === "Bird" && team.heldCapSpace <= 0 ? 0.08 : player.rights === "Early Bird" && team.heldCapSpace <= 0 ? 0.04 : 0;
  const retainScore = clamp(priority * 0.38 + rightsValue * 0.42 + scarcity * 0.16 + rfaControlPremium + birdToolPremium, 0, 1.3);
  const protectedHold = player.status === "RFA"
    ? retainScore >= 0.44 || scarcity >= 0.58 || player.marketValue >= 7_500_000 || player.age <= 24
    : retainScore >= 0.64 || (player.rights === "Bird" && player.marketValue >= assumptions.cap * 0.07) || player.marketValue >= assumptions.cap * 0.12 || ["MVP", "Superstar", "All-Star", "Starter"].includes(player.tier);
  player.rightsValue = rightsValue;
  player.holdRetainScore = retainScore;
  player.scarcityScore = scarcity;
  return { player, hold, priority, rightsValue, scarcity, retainScore, protectedHold };
}

function applyHoldPlanToPlayer(plan: OwnHoldPlan, retain: boolean, targetName?: string) {
  const player = plan.player;
  player.rightsValue = plan.rightsValue;
  player.holdRetainScore = plan.retainScore;
  player.scarcityScore = plan.scarcity;
  if (retain) {
    player.holdAction = "retained";
    player.holdActionReason = player.status === "RFA"
      ? `Retained RFA rights: option value ${formatNumber(plan.rightsValue, 2)}, scarcity ${formatNumber(plan.scarcity, 2)}, hold score ${formatNumber(plan.retainScore, 2)}.`
      : `Hold retained: rights value ${formatNumber(plan.rightsValue, 2)} and retain score ${formatNumber(plan.retainScore, 2)}.`;
    return;
  }
  player.holdAction = "renounced";
  player.holdActionReason = `Renounced for selective cap-room path toward ${targetName ?? "outside market"}; hold score ${formatNumber(plan.retainScore, 2)} did not justify ${formatMoney(plan.hold)}.`;
  player.rights = "None";
  if (player.status === "RFA") player.status = "UFA";
  player.capHold = 0;
  player.capHoldType = "Renounced cap hold";
  player.rightsSource = "renounced by simulator cap-room path";
}

function rightsOptionValue(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions, hold: number, scarcity: number): number {
  const holdEfficiency = hold > 0 ? clamp((player.marketValue / Math.max(hold, minimumSalary(player)) - 0.65) / 1.35, 0, 0.45) : 0;
  const matchOption = player.status === "RFA" ? 0.32 : player.rights === "Bird" ? 0.2 : player.rights === "Early Bird" ? 0.1 : 0.03;
  const restrictedLeverage = player.status === "RFA"
    ? clamp(player.marketValue / Math.max(assumptions.cap * 0.18, 1), 0, 0.18)
    : 0;
  const birdOverCapLeverage = player.rights === "Bird" && team.heldCapSpace <= 0
    ? clamp(player.marketValue / Math.max(assumptions.cap * 0.2, 1), 0, 0.14)
    : player.rights === "Early Bird" && team.heldCapSpace <= 0
      ? clamp(player.marketValue / Math.max(assumptions.cap * 0.26, 1), 0, 0.07)
      : 0;
  const ageTimeline = player.age <= 25 ? 0.14 : player.age <= 28 ? 0.09 : player.age <= 31 ? 0.04 : 0;
  const marketWeight = clamp(player.marketValue / Math.max(assumptions.cap * 0.16, 1), 0, 1) * 0.12;
  const teamTimeline = timelineFit(team, player) * 0.12;
  return clamp(holdEfficiency + matchOption + restrictedLeverage + birdOverCapLeverage + ageTimeline + marketWeight + teamTimeline + scarcity * 0.22, 0, 1.25);
}

function positionalScarcityScore(team: TeamState, player: SimPlayer): number {
  const primary = primaryPosition(player.position);
  const signed = team.roster.filter((candidate) => candidate.status === "Signed" && candidate.id !== player.id);
  const samePosition = signed.filter((candidate) => primaryPosition(candidate.position) === primary && credibleRosterPlayer(candidate)).length;
  const topSkills = Object.entries(player.skills)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([skill]) => skill as SkillKey);
  const skillNeed = topSkills.some((skill) => team.needs.includes(skill)) ? 0.18 : 0;
  if (primary === "C") {
    const rimCoverage = signed.filter((candidate) => (primaryPosition(candidate.position) === "C" || candidate.skills.RIMPRO >= 1.1) && credibleRosterPlayer(candidate)).length;
    if (samePosition === 0) return clamp(0.82 + (player.skills.RIMPRO > 1.4 ? 0.16 : 0) + skillNeed, 0, 1);
    if (rimCoverage === 0 && player.skills.RIMPRO > 1.4) return clamp(0.72 + skillNeed, 0, 1);
    if (samePosition === 1 && player.score >= 65) return clamp(0.42 + skillNeed, 0, 0.82);
    return clamp(0.12 + skillNeed, 0, 0.5);
  }
  if (samePosition === 0) return clamp(0.62 + skillNeed, 0, 0.92);
  if (samePosition === 1 && player.score >= 68) return clamp(0.32 + skillNeed, 0, 0.7);
  return clamp(0.08 + skillNeed, 0, 0.46);
}

function credibleRosterPlayer(player: SimPlayer): boolean {
  return player.score >= 55 || player.marketValue >= 8_000_000 || player.salary >= 8_000_000 || player.expectedMarketMinutes >= 1200;
}

function primaryPosition(position: string): "G" | "F" | "C" | "U" {
  const value = position.toUpperCase();
  if (value.includes("C")) return "C";
  if (value.includes("PG") || value.includes("SG") || value.includes("G")) return "G";
  if (value.includes("SF") || value.includes("PF") || value.includes("F")) return "F";
  return "U";
}

function capPathPlayerPriority(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions, incumbent: boolean): number {
  const need = needFitScore(team, player.position, player.skills);
  const timeline = timelineFit(team, player);
  const quality = clamp(player.score / 100, 0, 1.1);
  const marketFit = clamp(player.marketValue / Math.max(assumptions.cap * 0.14, 1), 0, 1.2);
  const taxDrag = taxPainScore(team, player.marketValue, assumptions);
  const rightsLeverage = incumbent ? rightsPlanningLeverage(team, player, assumptions) : 0;
  return clamp(need * 0.23 + timeline * 0.18 + quality * 0.23 + marketFit * 0.1 + team.willingness * 0.08 + (incumbent ? 0.1 : 0) + rightsLeverage * 0.18 - taxDrag * 0.12, 0, 1.3);
}

function rightsPlanningLeverage(team: TeamState, player: SimPlayer, assumptions: SimulatorAssumptions): number {
  if (player.rightsTeam !== team.team || player.rights === "None") return 0;
  const hold = capHoldForPlayer(player);
  const holdEfficiency = hold > 0 ? clamp(player.marketValue / Math.max(hold, minimumSalary(player)), 0, 1.5) : 0;
  const overCapNeed = team.heldCapSpace <= 0 ? 0.26 : 0;
  const rightType = player.status === "RFA" ? 0.42 : player.rights === "Bird" ? 0.32 : player.rights === "Early Bird" ? 0.18 : 0.06;
  const teamControl = player.status === "RFA" && player.age <= 26 ? 0.18 : player.status === "RFA" ? 0.1 : 0;
  const marketScale = clamp(player.marketValue / Math.max(assumptions.cap * 0.18, 1), 0, 0.22);
  return clamp(rightType + teamControl + overCapNeed + holdEfficiency * 0.12 + marketScale, 0, 1);
}

function isContenderMode(mode: TeamMode): boolean {
  return mode === "contender" || mode === "tax-sensitive contender";
}

function expectedMarketMinutesForPlayer(player: PlayerImpact, status: ContractStatus, marketValue: number): { minutes: number; source: string } {
  const candidates: Array<[string, number | null | undefined]> = [
    ["selected-season FA value", player.fa_value && marketValue > 0 ? player.projection_minutes_y1 : undefined],
    ["expected FA role band", player.lineup_role_band_minutes],
    ["expected FA lineup minutes", player.lineup_adjusted_minutes],
    ["career projection", player.projection_minutes_y1],
    ["current role estimate", player.raw_minutes],
    ["listed minutes", player.Minutes]
  ];
  for (const [source, value] of candidates) {
    const minutes = finitePositive(value);
    if (minutes) return { minutes, source };
  }
  const isMarketPlayer = status === "UFA" || status === "RFA" || status === "Player Option" || status === "Team Option" || status === "Non-Guaranteed";
  if (!isMarketPlayer) return { minutes: 0, source: "no market-minute adjustment" };
  if (marketValue >= 20_000_000) return { minutes: 1800, source: "median starter FA role from market value" };
  if (marketValue >= 10_000_000) return { minutes: 1450, source: "median rotation FA role from market value" };
  if (marketValue >= 4_000_000) return { minutes: 850, source: "median bench FA role from market value" };
  return { minutes: 420, source: "deep bench FA role from market value" };
}

function marketPlanningScore(player: PlayerImpact, status: ContractStatus, marketValue: number, expectedMinutes: number): number {
  const currentScore = finiteNumber(player.score, 50);
  const isMarketPlayer = status === "UFA" || status === "RFA" || status === "Player Option" || status === "Team Option" || status === "Non-Guaranteed";
  if (!isMarketPlayer || currentScore > 20) return currentScore;
  const projectedScore = marketScoreFromValue(marketValue);
  const minuteRole = clamp(expectedMinutes / 2200, 0, 1);
  const impactRole = clamp((finiteNumber(player.projection_y1, player.total, 0) + 2.4) / 5.2, 0, 1);
  return Math.max(currentScore, Math.round((projectedScore * 0.72 + (42 + minuteRole * 28 + impactRole * 18) * 0.28) * 10) / 10);
}

function marketScoreFromValue(marketValue: number): number {
  if (marketValue >= 30_000_000) return 86;
  if (marketValue >= 20_000_000) return 78;
  if (marketValue >= 12_000_000) return 68;
  if (marketValue >= 6_000_000) return 56;
  if (marketValue >= 3_000_000) return 44;
  return 34;
}

function refreshTeamPayrolls(teams: Map<string, TeamState>, assumptions: SimulatorAssumptions) {
  teams.forEach((team) => refreshTeamPayroll(team, assumptions));
}

function refreshTeamPayroll(team: TeamState, assumptions: SimulatorAssumptions) {
  team.activeSalary = sum(team.roster.map((player) => player.salary)) + team.activeSalaryAdjustment;
  team.guaranteedSalary = sum(team.roster.map((player) => player.guaranteedSalary || player.salary)) + team.guaranteedSalaryAdjustment;
  team.payroll = team.activeSalary + team.deadCap;
  const rosterCharges = incompleteRosterCharge(team, assumptions);
  team.rosterCharges = rosterCharges;
  team.maximumCapSpace = assumptions.cap - team.payroll - rosterCharges;
  team.heldCapSpace = team.maximumCapSpace - team.capHolds;
  team.capSpace = team.capPath === "cap_room" ? Math.max(0, team.heldCapSpace) : team.heldCapSpace;
  team.renouncedCapSpace = team.maximumCapSpace;
  team.capRoomWithHolds = team.heldCapSpace;
  team.capRoomRenounced = team.maximumCapSpace;
  team.taxRoom = assumptions.tax - team.payroll;
  team.firstApronRoom = assumptions.firstApron - team.payroll;
  team.secondApronRoom = assumptions.secondApron - team.payroll;
}

function addPlayerToTeamRoster(team: TeamState, player: SimPlayer) {
  team.roster = team.roster.filter((candidate) => candidate.id !== player.id);
  team.roster.push(player);
}

function resolveTrackedRosterPlaceholder(team: TeamState, player: SimPlayer, salary: number) {
  if (player.capTrackerTeam !== team.team) return;
  const activeKinds = new Set(["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed", "draft_pick"]);
  if (!player.capTrackerKind || !activeKinds.has(player.capTrackerKind)) return;
  consumeRosterPlaceholder(team, salary);
}

function consumeRosterPlaceholder(team: TeamState, salary: number) {
  if (team.rosterCountAdjustment <= 0 && team.activeSalaryAdjustment <= 0 && team.guaranteedSalaryAdjustment <= 0) return;
  team.rosterCountAdjustment = Math.max(0, team.rosterCountAdjustment - 1);
  const amount = Math.max(0, salary);
  team.activeSalaryAdjustment = Math.max(0, team.activeSalaryAdjustment - amount);
  team.guaranteedSalaryAdjustment = Math.max(0, team.guaranteedSalaryAdjustment - amount);
}

function consumeDraftPickPlaceholder(team: TeamState, salary: number) {
  if (team.draftPickPlaceholderCount <= 0) return;
  team.draftPickPlaceholderCount = Math.max(0, team.draftPickPlaceholderCount - 1);
  const amount = Math.min(Math.max(0, salary), Math.max(0, team.draftPickPlaceholderSalary || salary));
  team.draftPickPlaceholderSalary = Math.max(0, team.draftPickPlaceholderSalary - amount);
  consumeRosterPlaceholder(team, amount);
}

function standardRosterCount(team: TeamState): number {
  return team.roster.length + team.rosterCountAdjustment;
}

function standardRosterSlotsRemaining(team: TeamState): number {
  return Math.max(0, team.standardRosterLimit - standardRosterCount(team));
}

function buildTeamMeta(teams: TeamProjection[], season: number): TeamProjection[] {
  const seasonRows = teams.filter((team) => team.year === season && (team.scenario_id ?? "base") === "base");
  const fallback = teams.filter((team) => team.year === season);
  const rows = seasonRows.length > 0 ? seasonRows : fallback;
  const byTeam = new Map<string, TeamProjection>();
  rows.forEach((row) => {
    if (!byTeam.has(row.team)) byTeam.set(row.team, row);
  });
  return Array.from(byTeam.values()).sort((a, b) => a.team.localeCompare(b.team));
}

function buildSimPlayers(rows: PlayerImpact[], overrides: SimulatorOverrides, truthData?: OffseasonTruthData, capIndex?: CapTrackerIndex): SimPlayer[] {
  return rows.map((player) => {
    const override = overrides.players[playerKey(player)];
    const truth = playerTruth(player, truthData);
    const tracker = capTrackerCellForPlayer(player, capIndex);
    const trackerStatus = contractStatusFromCapCell(tracker?.cell);
    const truthStatus = normalizeStatus(truth?.contract_status ?? player.contract_status);
    const optionTruthStatus = truthStatus === "Player Option" || truthStatus === "Team Option" || truthStatus === "Non-Guaranteed" ? truthStatus : undefined;
    const status = override?.status ?? optionTruthStatus ?? trackerStatus ?? truthStatus;
    const marketValue = override?.marketValue ?? finiteNumber(player.fa_value, player.value, player.contract, 2_500_000);
    const marketMinutes = expectedMarketMinutesForPlayer(player, status, marketValue);
    const planningScore = marketPlanningScore(player, status, marketValue, marketMinutes.minutes);
    const planningTier = planningScore > finiteNumber(player.score, 50) && (player.tier === "DNQ" || finiteNumber(player.score, 50) < 20)
      ? tierFromScore(planningScore)
      : player.tier || "Bench";
    const trackerAmount = tracker?.cell.amount && tracker.cell.kind !== "empty" ? tracker.cell.amount : undefined;
    const guaranteedSalary = finiteNumber(
      tracker?.cell.kind === "guaranteed" || tracker?.cell.kind === "partial_guarantee" ? trackerAmount : undefined,
      truth?.guaranteed_salary,
      player.guaranteed_salary,
      status === "Signed" ? player.projection_effective_contract_y1 : undefined,
      status === "Signed" ? player.contract : undefined
    );
    const salary = status === "Signed"
      ? finiteNumber(guaranteedSalary, trackerAmount, player.contract, player.projection_effective_contract_y1, marketValue)
      : finiteNumber(tracker?.cell.kind === "cap_hold" ? undefined : trackerAmount, player.contract, player.projection_effective_contract_y1, marketValue);
    const trackerTeam = tracker?.row.team ? cleanTeam(tracker.row.team) : undefined;
    const currentRosterTeam = cleanTeam(override?.status === "Signed" ? override.incumbentTeam ?? trackerTeam ?? truth?.current_roster_team ?? player.current_roster_team ?? player.team : status === "Signed" ? trackerTeam ?? truth?.current_roster_team ?? player.current_roster_team ?? player.team : truth?.current_roster_team ?? player.current_roster_team ?? player.team);
    const rightsTeam = cleanTeam(override?.incumbentTeam ?? trackerTeam ?? truth?.rights_team ?? player.rights_team ?? player.incumbent_team ?? player.team);
    const rosterStatusSource = truth?.roster_status_source ?? player.roster_status_source ?? "impact row fallback";
    const rights = normalizeBirdRight(truth?.bird_rights ?? player.bird_rights ?? rightsForPlayer(player, status));
    const trackerHold = tracker?.cell.kind === "cap_hold" ? tracker.cell.amount : undefined;
    return {
      id: playerKey(player),
      name: player.player_name,
      team: status === "Signed" && currentRosterTeam !== "FA" ? currentRosterTeam : "FA",
      incumbentTeam: rightsTeam,
      rightsTeam,
      status,
      position: player.position || "UNK",
      age: finiteNumber(player.age, 25),
      salary,
      marketValue,
      rights,
      rightsSource: tracker ? `cap tracker ${capIndex?.capYear}` : truth?.signed_using ?? player.roster_status_source ?? rosterStatusSource,
      capHold: finiteNumber(trackerHold, truth?.cap_hold, player.cap_hold, 0),
      capHoldType: tracker?.cell.kind === "cap_hold" ? `Cap tracker ${tracker.cell.status || status} hold` : truth?.cap_hold_type ?? player.cap_hold_type ?? (rights === "None" ? "No retained cap hold" : `${status} ${rights} cap hold`),
      guaranteedSalary,
      deadCap: finiteNumber(truth?.dead_cap, player.dead_cap, 0),
      capTrackerTeam: trackerTeam,
      capTrackerKind: tracker?.cell.kind,
      capTrackerStatus: tracker?.cell.status,
      holdAction: "none",
      rightsValue: 0,
      holdRetainScore: 0,
      scarcityScore: 0,
      expectedMarketMinutes: marketMinutes.minutes,
      marketMinutesSource: marketMinutes.source,
      waivedDate: truth?.waived_date ?? player.waived_date ?? null,
      rosterStatusSource,
      total: finiteNumber(player.total, 0),
      score: planningScore,
      tier: planningTier,
      tradeValue: finiteNumber(player.trade_value, player.value, marketValue),
      upside: upsideScore(player),
      declineRisk: declineRisk(player),
      replaceability: replaceabilityScore(player),
      skills: skillProfile(player),
      original: { ...player }
    };
  });
}

function buildSimProspects(rows: DraftProspect[], overrides: SimulatorOverrides): SimProspect[] {
  return rows.map((prospect) => {
    const override = overrides.prospects[prospectKey(prospect)];
    const modelRank = finiteNumber(prospect.rank_in_class, 99);
    const consensusRank = override?.rank ?? consensusRankForProspect(prospect);
    const rank = consensusRank;
    const tier = override?.tier ?? prospect.tier ?? tierFromScore(prospect.score);
    return {
      id: prospectKey(prospect),
      name: prospect.player,
      draftYear: prospect.draft_year,
      rank,
      consensusRank,
      modelRank,
      tier,
      position: prospect.position || "UNK",
      score: finiteNumber(prospect.score, 45),
      upside: prospectUpside(prospect),
      risk: prospectRisk(prospect),
      bpa: clamp((105 - modelRank) / 100 + finiteNumber(prospect.TOTAL_pred, 0) * 0.08, 0, 1.4),
      skills: prospectSkills(prospect),
      original: { ...prospect }
    };
  });
}

function teamSummary(team: TeamState, bids: MarketBid[]): TeamSummary {
  const rosterCount = standardRosterCount(team);
  const teamBids = bids.filter((bid) => bid.team === team.team);
  return {
    team: team.team,
    name: team.name,
    mode: team.mode,
    capYear: team.capYear,
    capPath: team.capPath,
    capPathReason: team.capPathReason,
    rosterCount,
    standardRosterLimit: team.standardRosterLimit,
    targetRosterCount: team.targetRosterCount,
    minimumRosterCount: team.minimumRosterCount,
    rosterCore: team.roster
      .slice()
      .sort((a, b) => b.salary - a.salary || b.score - a.score)
      .slice(0, 7)
      .map((player) => player.name),
    payroll: team.payroll,
    activeSalary: team.activeSalary,
    guaranteedSalary: team.guaranteedSalary,
    deadCap: team.deadCap,
    capHolds: team.capHolds,
    initialCapHolds: team.initialCapHolds,
    holdsRetained: team.holdsRetained,
    holdsRenounced: team.holdsRenounced,
    rosterCharges: team.rosterCharges,
    heldCapSpace: team.heldCapSpace,
    capSpace: team.capSpace,
    renouncedCapSpace: team.renouncedCapSpace,
    maximumCapSpace: team.maximumCapSpace,
    capRoomWithHolds: team.capRoomWithHolds,
    capRoomRenounced: team.capRoomRenounced,
    statusBand: team.statusBand,
    statusBandWithHolds: team.statusBandWithHolds,
    statusBandRenounced: team.statusBandRenounced,
    taxRoom: team.taxRoom,
    firstApronRoom: team.firstApronRoom,
    secondApronRoom: team.secondApronRoom,
    needs: team.needs,
    pickAssets: team.pickAssets,
    pickCount: team.pickCount,
    premiumPickCount: team.premiumPickCount,
    toolLedger: [...team.toolLedger],
    biddingHealth: biddingHealthForTeam(team, teamBids),
    majorMoves: team.explanations.slice(-5)
  };
}

function biddingHealthForTeam(team: TeamState, bids: MarketBid[]): BiddingHealth {
  const capBids = bids.filter((bid) => bid.toolKind === "cap");
  const capDollarsSpent = sum(team.toolLedger.filter((row) => row.tool === "cap").map((row) => row.amount));
  const unusedCapRoom = team.capPath === "cap_room" ? Math.max(0, team.capSpace) : 0;
  const significantRoom = 20_000_000;
  const availableTools = availableToolLabels(team);
  let warning = "Healthy";
  if (team.capPath === "cap_room" && Math.max(0, team.maximumCapSpace) >= significantRoom && capBids.length === 0) {
    warning = "No cap bids despite room";
  } else if (team.capPath === "cap_room" && unusedCapRoom >= 12_000_000 && capDollarsSpent === 0) {
    warning = "Cap room untouched";
  } else if (team.capPath === "cap_room" && unusedCapRoom >= 12_000_000) {
    warning = "Unused cap room";
  } else if (team.capPath === "retained_rights" && team.renouncedCapSpace >= 20_000_000) {
    warning = "Passed on room for rights";
  }
  return {
    totalBidsSubmitted: bids.length,
    capBidsSubmitted: capBids.length,
    capDollarsOffered: sum(capBids.map((bid) => bid.submittedAav)),
    capDollarsSpent,
    unusedCapRoom,
    availableTools,
    warning
  };
}

function availableToolLabels(team: TeamState): string[] {
  const labels: string[] = [];
  if (team.capPath === "cap_room" && team.capSpace > 1_500_000) labels.push("Cap");
  team.exceptions
    .filter((tool) => tool.amount - tool.used > 1_000_000)
    .filter((tool) => {
      if (tool.kind === "room_exception") return team.capPath === "cap_room";
      if (tool.kind === "non_taxpayer_mle" || tool.kind === "bi_annual") return team.capPath === "retained_rights" && team.firstApronRoom > 0;
      if (tool.kind === "taxpayer_mle") return team.capPath === "retained_rights" && team.secondApronRoom > 0;
      return true;
    })
    .forEach((tool) => labels.push(toolKindLabel(tool.kind)));
  return Array.from(new Set(labels));
}

function releaseCapHold(teams: Map<string, TeamState>, player: SimPlayer) {
  const incumbent = teams.get(player.rightsTeam);
  if (!incumbent) return;
  const hold = capHoldForPlayer(player);
  incumbent.capHolds = Math.max(0, incumbent.capHolds - hold);
  incumbent.holdsRetained = Math.max(0, incumbent.holdsRetained - hold);
}

function capHoldForPlayer(player: SimPlayer): number {
  if (player.capHold > 0) return player.capHold;
  if (player.status === "Rookie FA") return 0;
  const projectionHold = finiteNumber(player.original?.projection_effective_contract_y1, 0);
  const marketHold = player.marketValue * (player.status === "RFA" ? 1.15 : 0.85);
  const salaryHold = player.salary * (player.status === "Team Option" || player.status === "Player Option" ? 1 : 1.2);
  return Math.max(minimumSalary(player), Math.min(Math.max(projectionHold, salaryHold, marketHold), player.marketValue * 1.45));
}

function incompleteRosterCharge(team: TeamState, assumptions: SimulatorAssumptions): number {
  const openSpots = Math.max(0, team.minimumRosterCount - standardRosterCount(team));
  return openSpots * (team.minimumRosterCharge || assumptions.cap * 0.008);
}

function buildWarRoomPlans(run: SimulationRun, assumptions: SimulatorAssumptions): TeamWarRoomPlan[] {
  return run.teams.map((team) => {
    const picks = run.draft.filter((item) => item.team === team.team);
    const signings = run.freeAgency.filter((item) => item.toTeam === team.team || item.fromTeam === team.team);
    const trades = run.trades.filter((item) => item.teamA === team.team || item.teamB === team.team);
    const options = run.options.filter((item) => item.team === team.team);
    const outgoing = signings.filter((item) => item.fromTeam === team.team && item.toTeam !== team.team);
    const incoming = signings.filter((item) => item.toTeam === team.team);
    const urgentCap = clamp(Math.max(0, -team.taxRoom) / assumptions.cap + Math.max(0, -team.firstApronRoom) / assumptions.cap * 1.4, 0, 1);
    const rosterUrgency = clamp((team.minimumRosterCount - team.rosterCount) / 7, 0, 1);
    const modeUrgency = team.mode === "contender" || team.mode === "tax-sensitive contender" ? 0.78 : team.mode === "playoff hopeful" ? 0.64 : 0.48;
    const urgency = clamp(modeUrgency * 0.42 + urgentCap * 0.38 + rosterUrgency * 0.2, 0, 1);
    const flexibility = clamp((Math.max(0, team.capSpace) + Math.max(0, team.taxRoom) * 0.18 + Math.max(0, team.renouncedCapSpace) * 0.28) / assumptions.cap, 0, 1);
    const taxDanger = clamp(Math.max(0, (team.payroll - assumptions.tax) / assumptions.cap) + Math.max(0, (team.payroll - assumptions.firstApron) / assumptions.cap) * 1.4 + Math.max(0, (team.payroll - assumptions.secondApron) / assumptions.cap) * 2, 0, 1);
    const assetLeverage = clamp(team.pickAssets / (assumptions.cap * 0.62) + team.premiumPickCount * 0.08, 0, 1);
    const moveCount = picks.length + incoming.length + trades.length + options.length;
    const unresolvedPressure = clamp(outgoing.length / 5 + Math.max(0, team.minimumRosterCount - 2 - team.rosterCount) / 6, 0, 1);
    const clarity = clamp(0.42 + moveCount * 0.07 + team.needs.length * 0.04 + assetLeverage * 0.18 - unresolvedPressure * 0.22 - taxDanger * 0.12, 0, 1);
    const priorities: TeamWarRoomPlan["priorities"] = [];

    options.slice(0, 2).forEach((item) => priorities.push({
      kind: "option",
      label: `${item.decision === "exercise" ? "Keep" : "Decline"} ${item.player.name}`,
      detail: item.explanation,
      drivers: driversFromScore(item.score),
      score: item.score,
      plausibility: item.plausibility
    }));
    picks.slice(0, 2).forEach((item) => priorities.push({
      kind: "draft",
      label: `Draft ${item.prospect.name} at ${item.pick}`,
      detail: `${item.prospect.tier} ${item.prospect.position}; rank ${formatNumber(item.prospect.rank, 0)} with ${formatNumber(item.score.needFit, 2)} need fit.`,
      drivers: driversFromScore(item.score),
      score: item.score,
      plausibility: item.plausibility
    }));
    incoming.slice(0, 3).forEach((item) => priorities.push({
      kind: item.status === "RFA" ? "rfa" : "ufa",
      label: `${item.toTeam === item.fromTeam ? "Retain" : "Sign"} ${item.player.name}`,
      detail: `${formatMoney(item.annualSalary)} AAV via ${item.context.toolName}; ${item.context.limiter}.`,
      drivers: driversFromScore(item.score),
      score: item.score,
      plausibility: item.plausibility
    }));
    trades.slice(0, 2).forEach((item) => priorities.push({
      kind: "trade",
      label: item.teamB === team.team ? `Acquire ${item.player.name}` : `Move ${item.player.name}`,
      detail: item.teamB === team.team ? item.explanation : `${item.sellerMotivation} Return modeled around ${formatMoney(item.pickValue)} pick-equivalent value.`,
      drivers: driversFromScore(item.teamB === team.team ? item.scoreB : item.scoreA),
      score: item.teamB === team.team ? item.scoreB : item.scoreA,
      plausibility: item.plausibility
    }));

    const warnings = [
      team.secondApronRoom < 0 ? "Second-apron pressure: avoid adding salary without an offset." : "",
      team.firstApronRoom < assumptions.cap * 0.025 && team.firstApronRoom >= 0 ? "Thin first-apron margin: preserve exception flexibility." : "",
      outgoing.length >= 2 ? `${outgoing.length} modeled losses: do not assume incumbent continuity.` : "",
      team.rosterCount < 10 ? "Roster charges and minimum slots still matter after headline moves." : "",
      team.mode.includes("contender") && incoming.length === 0 && picks.length === 0 ? "Win-now team did not add a rotation answer in this run." : ""
    ].filter(Boolean);

    if (warnings.length) {
      priorities.push({
        kind: "avoid",
        label: "Avoid self-inflicted constraints",
        detail: warnings[0],
        drivers: [
          { label: "Tax", value: formatNumber(taxDanger, 2), tone: taxDanger > 0.6 ? "bad" : "warn", explanation: "Combined tax and apron pressure." },
          { label: "Flex", value: formatNumber(flexibility, 2), tone: flexibility < 0.35 ? "bad" : "neutral", explanation: "Remaining cap and exception flexibility." }
        ]
      });
    }

    if (!priorities.length) {
      priorities.push({
        kind: "cap",
        label: "Preserve optionality",
        detail: "No major move cleared this run; protect cap sheet and revisit the market after higher-priority teams spend.",
        drivers: [
          { label: "Flex", value: formatNumber(flexibility, 2), tone: flexibility > 0.55 ? "good" : "neutral", explanation: "Room to react after the first market wave." },
          { label: "Assets", value: formatNumber(assetLeverage, 2), tone: assetLeverage > 0.55 ? "good" : "neutral", explanation: "Draft and pick-equivalent trade leverage." }
        ]
      });
    }

    return {
      team,
      objective: objectiveForTeam(team, urgency, taxDanger, flexibility),
      urgency,
      flexibility,
      taxDanger,
      assetLeverage,
      clarity,
      rosterHoles: rosterHolesForTeam(team),
      priorities,
      warnings,
      finalPayroll: team.payroll
    };
  }).sort((a, b) => b.urgency + b.taxDanger * 0.45 + b.assetLeverage * 0.2 - (a.urgency + a.taxDanger * 0.45 + a.assetLeverage * 0.2));
}

function objectiveForTeam(team: TeamSummary, urgency: number, taxDanger: number, flexibility: number): string {
  if (taxDanger > 0.64) return "Untangle apron pressure while protecting the top of the roster.";
  if (team.mode === "contender" || team.mode === "tax-sensitive contender") return "Convert limited flexibility into one reliable playoff rotation upgrade.";
  if (team.mode === "rebuilding") return "Monetize veterans, draft for upside, and avoid long salary traps.";
  if (team.mode === "rising") return "Add young fits without crowding the future core.";
  if (flexibility > 0.48 && urgency > 0.55) return "Use cap flexibility before the best market tiers close.";
  return "Keep optionality and let value fall into the available spending tools.";
}

function rosterHolesForTeam(team: TeamSummary): string[] {
  const holes = team.needs.map((need) => `${need} need`);
  if (team.rosterCount < team.minimumRosterCount) holes.push(`${team.minimumRosterCount - team.rosterCount} roster slots below ${team.minimumRosterCount}`);
  if (team.rosterCount > team.standardRosterLimit) holes.push(`${team.rosterCount - team.standardRosterLimit} excess standard roster slots`);
  if (team.premiumPickCount > 0) holes.push(`${team.premiumPickCount} premium pick decision${team.premiumPickCount > 1 ? "s" : ""}`);
  if (team.capSpace < 0 && team.renouncedCapSpace > team.capSpace + 5_000_000) holes.push("Cap-hold cleanup path");
  return holes.slice(0, 5);
}

function capWarnings(team: TeamSummary): string[] {
  const warnings = [
    team.rosterCount > team.standardRosterLimit ? `${team.rosterCount - team.standardRosterLimit} over standard roster limit` : "",
    team.secondApronRoom < 0 ? "Over second apron" : "",
    team.firstApronRoom < 0 && team.secondApronRoom >= 0 ? "Over first apron" : "",
    team.taxRoom < 0 && team.firstApronRoom >= 0 ? "Tax team" : "",
    team.capSpace < 0 && team.renouncedCapSpace > 0 ? "Cap holds block room" : "",
    team.rosterCount < team.minimumRosterCount ? `${team.minimumRosterCount - team.rosterCount} roster charges` : ""
  ].filter(Boolean);
  return warnings.length ? warnings : ["Clean enough sheet"];
}

function auditRowsForPlayer(audit: OfferAudit[], player: string, team?: string): OfferAudit[] {
  const playerKeyValue = player.toLowerCase();
  return audit
    .filter((row) => row.player.toLowerCase() === playerKeyValue && (!team || row.team === team || row.status === "offer" || row.status === "reject"))
    .sort((a, b) => a.round - b.round || statusRank(a.status) - statusRank(b.status) || b.marketValue - a.marketValue)
    .slice(0, 12);
}

function groupFreeAgentMarkets(signings: FreeAgentSigning[], audit: OfferAudit[], selectedTeam: string) {
  return signings
    .slice()
    .sort((a, b) => b.annualSalary - a.annualSalary || b.player.marketValue - a.player.marketValue)
    .map((signing) => {
      const auditRows = auditRowsForPlayer(audit, signing.player.name);
      const selectedRows = selectedTeam === "All"
        ? auditRows
        : auditRows.filter((row) => row.team === selectedTeam || signing.toTeam === selectedTeam || signing.fromTeam === selectedTeam);
      const submittedOffers = selectedRows
        .filter((row) => row.status === "offer" || row.status === "signed" || row.status === "matched" || row.status === "declined")
        .sort((a, b) => (b.offer ?? 0) - (a.offer ?? 0));
      const rejectedOffers = selectedRows
        .filter((row) => row.status === "reject")
        .sort((a, b) => (b.offer ?? 0) - (a.offer ?? 0));
      return {
        signing,
        auditRows: selectedRows.length ? selectedRows : auditRows,
        submittedOffers,
        rejectedOffers
      };
    });
}

function driversFromScore(score: DecisionScore): DecisionDriver[] {
  return [
    { label: "Value", value: formatNumber(score.value, 2), tone: score.value >= 0.9 ? "good" : score.value < 0.45 ? "bad" : "neutral", explanation: "Modeled value relative to cost or pick price." },
    { label: "Need", value: formatNumber(score.needFit, 2), tone: score.needFit >= 0.62 ? "good" : score.needFit < 0.35 ? "warn" : "neutral", explanation: "How well the player/prospect addresses team needs." },
    { label: "Timeline", value: formatNumber(score.timeline, 2), tone: score.timeline >= 0.62 ? "good" : score.timeline < 0.36 ? "warn" : "neutral", explanation: "Age, team mode, and competitive arc fit." },
    { label: "Tax", value: formatNumber(score.taxPain, 2), tone: score.taxPain > 0.62 ? "bad" : score.taxPain > 0.34 ? "warn" : "good", explanation: "Tax and apron pain from the transaction." },
    { label: "Assets", value: formatNumber(score.assetValue, 2), tone: score.assetValue > 0.45 ? "good" : "neutral", explanation: "Pick value, trade value, or asset leverage in the decision." },
    { label: "Rights", value: formatNumber(score.incumbency, 2), tone: score.incumbency > 0.6 ? "good" : "neutral", explanation: "Incumbent rights or familiarity advantage." },
    { label: "Noise", value: formatNumber(score.randomness, 2), tone: Math.abs(score.randomness) > 0.32 ? "warn" : "neutral", explanation: "Seeded variance contribution." }
  ];
}

function summarizeOverrides(overrides: SimulatorOverrides) {
  const playerTeams = Object.values(overrides.players).map((row) => row.incumbentTeam).filter((team): team is string => Boolean(team));
  const affectedTeams = Array.from(new Set([...Object.keys(overrides.teams), ...playerTeams.map(cleanTeam)])).filter(Boolean).sort();
  return {
    teams: Object.keys(overrides.teams).length,
    players: Object.keys(overrides.players).length,
    prospects: Object.keys(overrides.prospects).length,
    total: Object.keys(overrides.teams).length + Object.keys(overrides.players).length + Object.keys(overrides.prospects).length,
    affectedTeams
  };
}

function createMultiRunAccumulator(): MultiRunAccumulator {
  return {
    runs: 0,
    destinationRows: new Map(),
    draftRows: new Map(),
    tradeTeams: new Map(),
    rfaRows: new Map(),
    payrollRows: new Map(),
    teamOutcomeRows: new Map(),
    taxRows: new Map(),
    decisionRows: new Map(),
    decisionOutcomeCounts: new Map(),
    unresolvedRows: new Map(),
    surpriseRows: new Map()
  };
}

function addRunToAccumulator(accumulator: MultiRunAccumulator, run: SimulationRun) {
  accumulator.runs += 1;
  run.freeAgency.forEach((signing) => {
    const key = `${signing.player.name}|${signing.toTeam}`;
    const row = accumulator.destinationRows.get(key) ?? { count: 0, salary: 0 };
    row.count += 1;
    row.salary += signing.annualSalary;
    accumulator.destinationRows.set(key, row);
    if (signing.status === "RFA") {
      const rfa = accumulator.rfaRows.get(signing.player.name) ?? { matches: 0, offers: 0 };
      rfa.offers += 1;
      if (signing.matched) rfa.matches += 1;
      accumulator.rfaRows.set(signing.player.name, rfa);
    }
    if (signing.toTeam !== signing.fromTeam && signing.annualSalary < signing.player.marketValue * 0.72) {
      const label = `${signing.player.name} discount`;
      accumulator.surpriseRows.set(label, { detail: `${signing.player.name} lands with ${signing.toTeam} below model market`, count: (accumulator.surpriseRows.get(label)?.count ?? 0) + 1 });
    }
  });
  run.draft.forEach((selection) => {
    const key = `${selection.prospect.name}|${selection.team}`;
    const row = accumulator.draftRows.get(key) ?? { count: 0, pick: 0 };
    row.count += 1;
    row.pick += selection.pick;
    accumulator.draftRows.set(key, row);
    if (Math.abs(selection.pick - selection.prospect.rank) >= 10 && selection.pick <= 30) {
      const label = `${selection.prospect.name} range move`;
      accumulator.surpriseRows.set(label, { detail: `${selection.prospect.name} moves far from rank ${selection.prospect.rank}`, count: (accumulator.surpriseRows.get(label)?.count ?? 0) + 1 });
    }
  });
  run.trades.forEach((trade) => {
    accumulator.tradeTeams.set(trade.teamA, (accumulator.tradeTeams.get(trade.teamA) ?? 0) + 1);
    accumulator.tradeTeams.set(trade.teamB, (accumulator.tradeTeams.get(trade.teamB) ?? 0) + 1);
  });
  run.teams.forEach((team) => {
    const payrollRow = accumulator.payrollRows.get(team.team) ?? [];
    payrollRow.push(team.payroll);
    accumulator.payrollRows.set(team.team, payrollRow);
    const taxOutcome = team.secondApronRoom < 0 ? "Second apron" : team.firstApronRoom < 0 ? "First apron" : team.taxRoom < 0 ? "Tax" : "Below tax";
    accumulator.taxRows.set(`${team.team}|${taxOutcome}`, (accumulator.taxRows.get(`${team.team}|${taxOutcome}`) ?? 0) + 1);
    const teamOutcome = teamBatchOutcome(run, team);
    const outcomeKey = `${team.team}|${teamOutcome}`;
    const outcomeRow = accumulator.teamOutcomeRows.get(outcomeKey) ?? { count: 0, payroll: 0, capSpace: 0, taxRoom: 0 };
    outcomeRow.count += 1;
    outcomeRow.payroll += team.payroll;
    outcomeRow.capSpace += team.capSpace;
    outcomeRow.taxRoom += team.taxRoom;
    accumulator.teamOutcomeRows.set(outcomeKey, outcomeRow);
  });
  run.explanations.forEach((item) => {
    const entity = item.player ?? item.title;
    const outcome = item.team ? `${item.kind}: ${item.team}` : item.kind;
    const key = `${entity}|${outcome}`;
    accumulator.decisionRows.set(key, (accumulator.decisionRows.get(key) ?? 0) + 1);
    const outcomes = accumulator.decisionOutcomeCounts.get(entity) ?? new Set<string>();
    outcomes.add(outcome);
    accumulator.decisionOutcomeCounts.set(entity, outcomes);
  });
  run.players
    .filter((player) => player.status !== "Signed" && player.status !== "Rookie FA")
    .forEach((player) => accumulator.unresolvedRows.set(player.name, (accumulator.unresolvedRows.get(player.name) ?? 0) + 1));
}

function finalizeMultiRunAccumulator(accumulator: MultiRunAccumulator): MultiRunSummary {
  const runs = Math.max(accumulator.runs, 1);
  const decisionDistributions = Array.from(accumulator.decisionRows.entries()).map(([key, count]) => {
    const [entity, outcome] = key.split("|");
    return { entity, outcome, count, pct: count / runs };
  });

  return {
    runs: accumulator.runs,
    playerDestinations: Array.from(accumulator.destinationRows.entries())
      .map(([key, value]) => {
        const [player, destination] = key.split("|");
        return { player, destination, count: value.count, pct: value.count / runs, avgSalary: value.salary / value.count };
      })
      .sort((a, b) => b.count - a.count || b.avgSalary - a.avgSalary)
      .slice(0, 18),
    draftOutcomes: Array.from(accumulator.draftRows.entries())
      .map(([key, value]) => {
        const [prospect, team] = key.split("|");
        return { prospect, team, count: value.count, pct: value.count / runs, avgPick: value.pick / value.count };
      })
      .sort((a, b) => b.count - a.count || a.avgPick - b.avgPick)
      .slice(0, 18),
    tradeTeams: Array.from(accumulator.tradeTeams.entries())
      .map(([team, count]) => ({ team, count, pct: count / runs }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    rfaMatches: Array.from(accumulator.rfaRows.entries())
      .map(([player, row]) => ({ player, matches: row.matches, offers: row.offers, pct: row.offers > 0 ? row.matches / row.offers : 0 }))
      .sort((a, b) => b.offers - a.offers)
      .slice(0, 12),
    payrolls: Array.from(accumulator.payrollRows.entries())
      .map(([team, values]) => ({ team, avgPayroll: avg(values), highPayroll: Math.max(...values), lowPayroll: Math.min(...values) }))
      .sort((a, b) => b.avgPayroll - a.avgPayroll)
      .slice(0, 30),
    teamOutcomes: Array.from(accumulator.teamOutcomeRows.entries())
      .map(([key, row]) => {
        const [team, outcome] = key.split("|");
        return { team, outcome, count: row.count, pct: row.count / runs, avgPayroll: row.payroll / row.count, avgCapSpace: row.capSpace / row.count, avgTaxRoom: row.taxRoom / row.count };
      })
      .sort((a, b) => b.pct - a.pct || b.count - a.count || a.team.localeCompare(b.team))
      .slice(0, 42),
    taxOutcomes: Array.from(accumulator.taxRows.entries())
      .map(([key, count]) => {
        const [entity, outcome] = key.split("|");
        return { entity, outcome, count, pct: count / runs };
      })
      .sort((a, b) => b.pct - a.pct || a.entity.localeCompare(b.entity))
      .slice(0, 30),
    stableDecisions: decisionDistributions
      .filter((row) => row.pct >= 0.7)
      .sort((a, b) => b.pct - a.pct || b.count - a.count)
      .slice(0, 12),
    volatileDecisions: decisionDistributions
      .filter((row) => row.pct >= 0.18 && row.pct <= 0.62 && (accumulator.decisionOutcomeCounts.get(row.entity)?.size ?? 0) >= 2)
      .sort((a, b) => Math.abs(0.5 - a.pct) - Math.abs(0.5 - b.pct))
      .slice(0, 12),
    unresolvedMarkets: Array.from(accumulator.unresolvedRows.entries())
      .map(([entity, count]) => ({ entity, outcome: "Unsigned in run", count, pct: count / runs }))
      .sort((a, b) => b.pct - a.pct || b.count - a.count)
      .slice(0, 12),
    surprises: Array.from(accumulator.surpriseRows.entries())
      .map(([label, row]) => ({ label, detail: row.detail, frequency: row.count / runs }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
  };
}

function AssumptionInput({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{step >= 1 ? formatNumber(value, 0) : formatNumber(value, 2)}</strong>
    </label>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input value={Math.round(value / 1_000_000)} onChange={(event) => onChange(Number(event.target.value) * 1_000_000)} />
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-pill offseason-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OffseasonCommandBar({
  season,
  capYear,
  draftYear,
  run,
  headline,
  teams,
  selectedTeam,
  assumptions,
  activePreset,
  overrideStats,
  isSimulating,
  simulationStatus,
  onTeamSelect,
  onRunOne,
  onRunMany,
  onExport,
  onAssumptionChange,
  onPreset
}: {
  season: number;
  capYear: number;
  draftYear: number;
  run: SimulationRun;
  headline: ReturnType<typeof buildRunHeadline>;
  teams: string[];
  selectedTeam: string;
  assumptions: SimulatorAssumptions;
  activePreset: string;
  overrideStats: ReturnType<typeof summarizeOverrides>;
  isSimulating: boolean;
  simulationStatus: string | null;
  onTeamSelect: (team: string) => void;
  onRunOne: () => void;
  onRunMany: () => void;
  onExport: (kind: "json" | "csv") => void;
  onAssumptionChange: (key: keyof SimulatorAssumptions, value: number) => void;
  onPreset: (preset: ScenarioPreset) => void;
}) {
  const focusTeam = selectedTeam === "All" ? null : run.teams.find((team) => team.team === selectedTeam) ?? null;
  return (
    <section className="offseason-command-panel war-room-command">
      <div className="offseason-command-copy">
        <span>{`Run ${run.seed} / ${season} roster-value season / ${capYear} cap / ${draftYear} draft`}</span>
        <h2>{focusTeam ? `${focusTeam.team} Front Office War Room` : "Leaguewide Offseason War Room"}</h2>
        <p>
          {focusTeam
            ? `${focusTeam.mode}; ${formatMoney(focusTeam.payroll)} payroll, ${formatSignedMoney(focusTeam.taxRoom)} tax room, ${focusTeam.needs.join(", ")} needs.`
            : `${headline.majorMoves} simulated decisions with ${formatNumber(headline.avgPlausibility * 100, 0)} average plausibility, ${headline.taxTeams} tax teams, and ${formatMoney(headline.tradeValue)} pick-equivalent trade value.`}
        </p>
      </div>
      <div className="command-controls">
        <label className="command-field">
          <span>Team Scope</span>
          <select value={selectedTeam} onChange={(event) => onTeamSelect(event.target.value)}>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>
        <div className="offseason-button-row command-buttons">
          <button className="hdr-btn primary" disabled={isSimulating} onClick={onRunOne}>{isSimulating ? "Running..." : "Run one"}</button>
          <button className="hdr-btn" disabled={isSimulating} onClick={onRunMany}>{isSimulating ? "Running..." : `Run ${Math.round(assumptions.runCount)}`}</button>
          <button className="hdr-btn" disabled={isSimulating} onClick={() => onExport("csv")}>CSV</button>
          <button className="hdr-btn" disabled={isSimulating} onClick={() => onExport("json")}>JSON</button>
        </div>
        {simulationStatus && <div className="simulation-progress-strip">{simulationStatus}</div>}
        <div className="quick-run-control">
          <AssumptionInput label="Batch simulations" value={assumptions.runCount} min={10} max={500} step={10} onChange={(value) => onAssumptionChange("runCount", value)} />
        </div>
        <div className="scenario-preset-row">
          {scenarioPresets.map((preset) => (
            <button
              key={preset.id}
              className={cls("scenario-chip", activePreset === preset.id && "active")}
              title={preset.intent}
              onClick={() => onPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
          {overrideStats.total > 0 && <span className="override-count">{`${overrideStats.total} overrides / ${overrideStats.affectedTeams.length} teams`}</span>}
        </div>
        <details className="cap-assumption-drawer advanced-simulation-drawer">
          <summary>Advanced simulation settings</summary>
          <div className="command-slider-grid">
            <AssumptionInput label="Variance" value={assumptions.variance} min={0} max={1} step={0.01} onChange={(value) => onAssumptionChange("variance", value)} />
            <AssumptionInput label="Market heat" value={assumptions.marketAggression} min={0} max={1} step={0.01} onChange={(value) => onAssumptionChange("marketAggression", value)} />
            <AssumptionInput label="Trade rate" value={assumptions.tradeAggression} min={0} max={1} step={0.01} onChange={(value) => onAssumptionChange("tradeAggression", value)} />
            <AssumptionInput label="Draft fit" value={assumptions.draftFitWeight} min={0} max={0.55} step={0.01} onChange={(value) => onAssumptionChange("draftFitWeight", value)} />
            <AssumptionInput label="Tax caution" value={assumptions.taxSensitivity} min={0} max={1} step={0.01} onChange={(value) => onAssumptionChange("taxSensitivity", value)} />
          </div>
        </details>
        <details className="cap-assumption-drawer">
          <summary>Cap assumptions</summary>
          <div className="offseason-cap-grid">
            <MoneyInput label="Cap" value={assumptions.cap} onChange={(value) => onAssumptionChange("cap", value)} />
            <MoneyInput label="Tax" value={assumptions.tax} onChange={(value) => onAssumptionChange("tax", value)} />
            <MoneyInput label="First apron" value={assumptions.firstApron} onChange={(value) => onAssumptionChange("firstApron", value)} />
            <MoneyInput label="Second apron" value={assumptions.secondApron} onChange={(value) => onAssumptionChange("secondApron", value)} />
          </div>
        </details>
      </div>
    </section>
  );
}

function DashboardView({ run, selectedTeam, multiRun }: { run: SimulationRun; selectedTeam: string; multiRun: MultiRunSummary | null }) {
  const scopedSignings = selectedTeam === "All" ? run.freeAgency : run.freeAgency.filter((item) => item.toTeam === selectedTeam || item.fromTeam === selectedTeam);
  const topPlayerOutcomes = scopedSignings
    .slice()
    .sort((a, b) => Math.max(b.annualSalary, b.player.marketValue) - Math.max(a.annualSalary, a.player.marketValue))
    .slice(0, 14);
  const teams = selectedTeam === "All" ? run.teams : run.teams.filter((team) => team.team === selectedTeam);
  const moveGroups = dashboardMoveGroups(run, selectedTeam);
  return (
    <section className="offseason-stack dashboard-stack">
      <RunResultDigest run={run} selectedTeam={selectedTeam} multiRun={multiRun} />
      {multiRun && <DistributionSpotlight summary={multiRun} selectedTeam={selectedTeam} />}
      <TeamOutcomeBreakdown run={run} teams={teams} selectedTeam={selectedTeam} multiRun={multiRun} />
      <section className="offseason-panel dashboard-hero-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>{`League Dashboard / ${run.season} Roster-Value Season`}</h2>
            <p>{`${run.capYear} cap, ${run.draftYear} draft, ${run.freeAgency.length} signings, ${run.draft.length} picks, ${run.options.length} option calls. Trades are modeled but parked outside this view.`}</p>
          </div>
          <div className="dashboard-pill-row">
            <span>{`${run.teams.filter((team) => team.capPath === "cap_room").length} cap-room teams`}</span>
            <span>{`${run.teams.filter((team) => team.capPath === "retained_rights").length} retained-rights teams`}</span>
            {multiRun && <span>{`${multiRun.runs} run distribution loaded`}</span>}
          </div>
        </div>
        <div className="dashboard-grid">
          <div className="dashboard-table-card dashboard-player-outcomes">
            <h3>Top Player Outcomes</h3>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead><tr><th>Player</th><th>Final</th><th>Incumbent</th><th>AAV</th><th>Tool</th><th>Path</th><th>Reason</th><th>Runner-up</th></tr></thead>
                <tbody>
                  {topPlayerOutcomes.map((signing) => (
                    <tr key={`${signing.player.id}-${signing.toTeam}`}>
                      <td><strong>{signing.player.name}</strong><span>{`${signing.status} / ${formatNumber(signing.context.expectedMarketMinutes ?? signing.player.expectedMarketMinutes, 0)} min`}</span></td>
                      <td>{signing.toTeam}</td>
                      <td>{signing.fromTeam}</td>
                      <td>{formatMoney(signing.annualSalary)}</td>
                      <td>{signing.context.toolName}</td>
                      <td>{capPathLabel(signing.context.capPath)}</td>
                      <td>{shortSigningReason(signing)}</td>
                      <td>{marketChaserLabel(signing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <TeamToolLedgerPanel teams={teams} />
        </div>
      </section>
      <BiddingHealthPanel teams={teams} />
      <DashboardDraftBoard selections={run.draft} selectedTeam={selectedTeam} />
      <section className="offseason-panel dashboard-move-tape">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Move Tape</h2>
            <p>Grouped offseason ledger before trade cleanup.</p>
          </div>
        </div>
        <div className="move-tape-grid">
          {moveGroups.map((group) => (
            <div key={group.title} className="move-tape-group">
              <h3>{group.title}</h3>
              {group.items.length === 0 && <p className="mini-empty">No moves</p>}
              {group.items.slice(0, 12).map((item) => <p key={`${group.title}-${item}`}>{item}</p>)}
              {group.items.length > 12 && <p>{`+${group.items.length - 12} more`}</p>}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function RunResultDigest({ run, selectedTeam, multiRun }: { run: SimulationRun; selectedTeam: string; multiRun: MultiRunSummary | null }) {
  const team = selectedTeam === "All" ? null : run.teams.find((row) => row.team === selectedTeam) ?? null;
  const items = buildResultDigestItems(run, selectedTeam, multiRun);
  const headline = team ? teamVerdict(run, team) : leagueVerdict(run);
  const subhead = team
    ? `${team.mode}; ${capPathLabel(team.capPath)} path, ${team.needs.join(", ") || "balanced"} needs, ${capWarnings(team)[0]}.`
    : `${run.freeAgency.length} free-agent decisions, ${run.draft.length} draft picks, ${run.trades.length} trades, ${run.teams.filter((row) => row.capPath === "cap_room").length} cap-room teams.`;
  return (
    <section className="offseason-panel result-digest-panel">
      <div className="result-digest-copy">
        <span>{selectedTeam === "All" ? "Simulation Result" : `${selectedTeam} Result`}</span>
        <h2>{headline}</h2>
        <p>{subhead}</p>
      </div>
      <div className="result-digest-grid">
        {items.map((item) => (
          <div key={item.label} className={cls("result-digest-card", `digest-${item.tone}`)}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamOutcomeBreakdown({ run, teams, selectedTeam, multiRun }: { run: SimulationRun; teams: TeamSummary[]; selectedTeam: string; multiRun: MultiRunSummary | null }) {
  const rows = teams
    .slice()
    .sort((a, b) => teamOutcomePriority(run, b) - teamOutcomePriority(run, a) || a.team.localeCompare(b.team))
    .slice(0, selectedTeam === "All" ? 12 : 1);
  return (
    <section className="offseason-panel team-outcome-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{selectedTeam === "All" ? "Team Breakdowns" : `${selectedTeam} Breakdown`}</h2>
          <p>Each card condenses the team result, cap path, move stack, and remaining front-office problem.</p>
        </div>
      </div>
      <div className="team-outcome-grid">
        {rows.map((team) => {
          const moves = teamMoveDigest(run, team);
          const firstWarning = capWarnings(team)[0];
          const dist = multiRun?.teamOutcomes.find((row) => row.team === team.team);
          return (
            <article key={`${team.team}-outcome`} className="team-outcome-card">
              <div className="team-outcome-head">
                <div>
                  <span>{team.mode}</span>
                  <strong>{team.team}</strong>
                </div>
                <b>{formatMoney(team.payroll)}</b>
              </div>
              <h3>{teamVerdict(run, team)}</h3>
              <p>{frontOfficeRead(run, team)}</p>
              <div className="team-outcome-facts">
                <Fact label="Cap path" value={capPathLabel(team.capPath)} />
                <Fact label="Room" value={formatSignedMoney(team.capSpace)} />
                <Fact label="Tax" value={formatSignedMoney(team.taxRoom)} />
                <Fact label="Needs" value={team.needs.slice(0, 3).join(", ") || "-"} />
              </div>
              <MoveList title="Move Stack" items={moves.length ? moves : ["No major modeled move"]} />
              <MoveList title="Rights / Holds" items={rightsDigestForTeam(run, team)} />
              <div className="team-outcome-footer">
                <span>{firstWarning}</span>
                {dist && <strong>{`${formatNumber(dist.pct * 100, 0)}% ${dist.outcome} in batch`}</strong>}
              </div>
              {multiRun && selectedTeam !== "All" && <TeamDistributionStrip summary={multiRun} team={team.team} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DistributionSpotlight({ summary, selectedTeam }: { summary: MultiRunSummary; selectedTeam: string }) {
  const teamMode = selectedTeam !== "All";
  const destinationRows = summary.playerDestinations
    .filter((row) => !teamMode || row.destination === selectedTeam)
    .slice(0, 8)
    .map((row) => ({ label: `${row.player} -> ${row.destination}`, value: `${formatMoney(row.avgSalary)} avg`, pct: row.pct }));
  const taxRows = summary.taxOutcomes
    .filter((row) => !teamMode || row.entity === selectedTeam)
    .slice(0, 8)
    .map((row) => ({ label: `${row.entity}: ${row.outcome}`, value: `${row.count}/${summary.runs}`, pct: row.pct }));
  const volatilityRows = summary.volatileDecisions
    .filter((row) => !teamMode || row.outcome.includes(selectedTeam) || row.entity.includes(selectedTeam))
    .slice(0, 8)
    .map((row) => ({ label: row.entity, value: row.outcome, pct: row.pct }));
  const teamRows = summary.teamOutcomes
    .filter((row) => !teamMode || row.team === selectedTeam)
    .slice(0, 8)
    .map((row) => ({ label: `${row.team}: ${row.outcome}`, value: `${formatMoney(row.avgPayroll)} avg payroll`, pct: row.pct }));
  return (
    <section className="offseason-panel distribution-spotlight-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{`${summary.runs} Simulation Distribution`}</h2>
          <p>{teamMode ? `${selectedTeam} outcome frequencies across the batch.` : "Most common destinations, team paths, volatility, and apron outcomes across the batch."}</p>
        </div>
      </div>
      <div className="distribution-spotlight-grid">
        <DistributionBars title="Player Destinations" rows={destinationRows} empty="No repeated player destination signal yet" />
        <DistributionBars title="Team Outcomes" rows={teamRows} empty="No team outcome signal yet" />
        <DistributionBars title="Volatile Calls" rows={volatilityRows} empty="No material volatility in this scope" />
        <DistributionBars title="Apron / Tax" rows={taxRows} empty="No tax outcome signal yet" />
      </div>
    </section>
  );
}

function DistributionBars({ title, rows, empty }: { title: string; rows: Array<{ label: string; value: string; pct: number }>; empty: string }) {
  return (
    <div className="distribution-bars">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="mini-empty">{empty}</p>}
      {rows.map((row) => (
        <div key={`${title}-${row.label}-${row.value}`} className="distribution-bar-row">
          <div>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
          <i><b style={{ width: `${clamp(row.pct, 0, 1) * 100}%` }} /></i>
          <em>{`${formatNumber(row.pct * 100, 0)}%`}</em>
        </div>
      ))}
    </div>
  );
}

function TeamToolLedgerPanel({ teams }: { teams: TeamSummary[] }) {
  return (
    <div className="dashboard-table-card dashboard-tool-ledger">
      <h3>Cap And Tool Ledger</h3>
      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead><tr><th>Team</th><th>Path</th><th>Holds</th><th>Room</th><th>Tools Used</th><th>Apron</th></tr></thead>
          <tbody>
            {teams
              .slice()
              .sort((a, b) => a.capPath.localeCompare(b.capPath) || a.team.localeCompare(b.team))
              .map((team) => (
                <tr key={team.team}>
                  <td><strong>{team.team}</strong><span>{team.statusBand ?? team.mode}</span></td>
                  <td>{capPathLabel(team.capPath)}</td>
                  <td>{`${formatMoney(team.holdsRetained)} kept / ${formatMoney(team.holdsRenounced)} cut`}</td>
                  <td>{`${formatSignedMoney(team.heldCapSpace)} held / ${formatSignedMoney(team.renouncedCapSpace)} max`}</td>
                  <td>{team.toolLedger.length ? team.toolLedger.slice(0, 2).map((row) => `${toolKindLabel(row.tool)}: ${formatMoney(row.amount)}`).join("; ") : "None"}</td>
                  <td>{capWarnings(team).join("; ")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BiddingHealthPanel({ teams }: { teams: TeamSummary[] }) {
  const rows = teams
    .slice()
    .sort((a, b) =>
      warningRank(a.biddingHealth.warning) - warningRank(b.biddingHealth.warning) ||
      b.biddingHealth.unusedCapRoom - a.biddingHealth.unusedCapRoom ||
      a.team.localeCompare(b.team)
    );
  return (
    <section className="offseason-panel dashboard-bidding-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Bidding Health</h2>
          <p>Cap-room usage, active bid pressure, available tools, and idle-room warnings by team.</p>
        </div>
      </div>
      <div className="dashboard-table-wrap">
        <table className="dashboard-table bidding-health-table">
          <thead><tr><th>Team</th><th>Path</th><th>Cap Bids</th><th>Cap Offered</th><th>Cap Spent</th><th>Unused Room</th><th>Tools</th><th>Warning</th></tr></thead>
          <tbody>
            {rows.map((team) => (
              <tr key={`${team.team}-bidding-health`}>
                <td><strong>{team.team}</strong><span>{team.capPathReason}</span></td>
                <td>{capPathLabel(team.capPath)}</td>
                <td>{`${team.biddingHealth.capBidsSubmitted} / ${team.biddingHealth.totalBidsSubmitted}`}</td>
                <td>{formatMoney(team.biddingHealth.capDollarsOffered)}</td>
                <td>{formatMoney(team.biddingHealth.capDollarsSpent)}</td>
                <td>{formatMoney(team.biddingHealth.unusedCapRoom)}</td>
                <td>{team.biddingHealth.availableTools.join(", ") || "None"}</td>
                <td><span className={cls("bidding-warning", warningRank(team.biddingHealth.warning) <= 1 && "hot")}>{team.biddingHealth.warning}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function warningRank(value: string): number {
  if (value.includes("No cap bids") || value.includes("untouched")) return 0;
  if (value.includes("Unused")) return 1;
  if (value.includes("Passed")) return 2;
  return 3;
}

function DashboardDraftBoard({ selections, selectedTeam }: { selections: DraftSelection[]; selectedTeam: string }) {
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState(selectedTeam);
  const teamOptions = ["All", ...Array.from(new Set(selections.map((selection) => selection.team))).sort()];
  const activeTeam = selectedTeam !== "All" ? selectedTeam : teamFilter;
  const normalizedQuery = query.trim().toLowerCase();
  const rows = selections.filter((selection) =>
    (activeTeam === "All" || selection.team === activeTeam) &&
    (!normalizedQuery || selection.prospect.name.toLowerCase().includes(normalizedQuery) || selection.team.toLowerCase().includes(normalizedQuery) || selection.prospect.position.toLowerCase().includes(normalizedQuery))
  );
  return (
    <section className="offseason-panel dashboard-draft-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Final Draft Board</h2>
          <p>All picks with model, consensus, and range markers.</p>
        </div>
        <div className="dashboard-filter-row">
          <select value={activeTeam} disabled={selectedTeam !== "All"} onChange={(event) => setTeamFilter(event.target.value)}>
            {teamOptions.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search draft" />
        </div>
      </div>
      <div className="dashboard-table-wrap">
        <table className="dashboard-table draft-dashboard-table">
          <thead><tr><th>Pick</th><th>Team</th><th>Player</th><th>Pos</th><th>Tier</th><th>Consensus</th><th>Model</th><th>Marker</th></tr></thead>
          <tbody>
            {rows.map((selection) => (
              <tr key={selection.pick}>
                <td>{selection.pick}</td>
                <td>{selection.team}</td>
                <td><strong>{selection.prospect.name}</strong></td>
                <td>{selection.prospect.position}</td>
                <td>{selection.prospect.tier}</td>
                <td>{formatNumber(selection.consensusRank, 0)}</td>
                <td>{formatNumber(selection.modelRank, 0)}</td>
                <td><span className={cls("draft-marker", selection.reachSteal.toLowerCase())}>{selection.reachSteal}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function dashboardMoveGroups(run: SimulationRun, selectedTeam: string): Array<{ title: string; items: string[] }> {
  const teamFilter = (team: string) => selectedTeam === "All" || team === selectedTeam;
  return [
    {
      title: "Options",
      items: run.options
        .filter((item) => teamFilter(item.team))
        .map((item) => `${item.team}: ${item.decision} ${item.player.name} at ${formatMoney(item.player.salary)}`)
    },
    {
      title: "Draft",
      items: run.draft
        .filter((item) => teamFilter(item.team))
        .map((item) => `${item.pick}. ${item.team}: ${item.prospect.name} (${item.reachSteal})`)
    },
    {
      title: "Own FA",
      items: run.freeAgency
        .filter((item) => item.toTeam === item.fromTeam && teamFilter(item.toTeam))
        .map((item) => `${item.toTeam}: retained ${item.player.name} via ${item.context.toolName} (${formatMoney(item.annualSalary)})`)
    },
    {
      title: "Outside FA",
      items: run.freeAgency
        .filter((item) => item.toTeam !== item.fromTeam && (teamFilter(item.toTeam) || teamFilter(item.fromTeam)))
        .map((item) => `${item.toTeam}: signed ${item.player.name} from ${item.fromTeam} via ${item.context.toolName} (${formatMoney(item.annualSalary)})`)
    }
  ];
}

function buildResultDigestItems(run: SimulationRun, selectedTeam: string, multiRun: MultiRunSummary | null): ResultDigestItem[] {
  const team = selectedTeam === "All" ? null : run.teams.find((row) => row.team === selectedTeam) ?? null;
  const scopedSignings = selectedTeam === "All" ? run.freeAgency : run.freeAgency.filter((row) => row.toTeam === selectedTeam || row.fromTeam === selectedTeam);
  const scopedDraft = selectedTeam === "All" ? run.draft : run.draft.filter((row) => row.team === selectedTeam);
  const scopedTrades = selectedTeam === "All" ? run.trades : run.trades.filter((row) => row.teamA === selectedTeam || row.teamB === selectedTeam);
  const topSigning = scopedSignings.slice().sort((a, b) => b.annualSalary - a.annualSalary || b.player.score - a.player.score)[0];
  const draftSignal = scopedDraft.slice().sort((a, b) => {
    const aDelta = a.reachSteal === "Steal" ? 2 : a.reachSteal === "Reach" ? 1 : 0;
    const bDelta = b.reachSteal === "Steal" ? 2 : b.reachSteal === "Reach" ? 1 : 0;
    return bDelta - aDelta || a.pick - b.pick;
  })[0];
  const tradeSignal = scopedTrades.slice().sort((a, b) => b.pickValue - a.pickValue)[0];
  const batchSignal = multiRun ? batchDigestForScope(multiRun, selectedTeam) : null;
  const items: ResultDigestItem[] = [];

  if (team) {
    items.push({
      label: "Cap Result",
      value: capPathLabel(team.capPath),
      detail: `${formatSignedMoney(team.capSpace)} room, ${formatSignedMoney(team.taxRoom)} tax room, ${formatMoney(team.holdsRenounced)} holds renounced.`,
      tone: team.secondApronRoom < 0 ? "bad" : team.taxRoom < 0 ? "warn" : team.capSpace > 0 ? "good" : "neutral"
    });
  } else {
    items.push({
      label: "League Shape",
      value: `${run.teams.filter((row) => row.capPath === "cap_room").length} room teams`,
      detail: `${run.teams.filter((row) => row.taxRoom < 0).length} tax teams, ${run.teams.filter((row) => row.secondApronRoom < 0).length} second-apron teams.`,
      tone: run.teams.some((row) => row.secondApronRoom < 0) ? "warn" : "neutral"
    });
  }

  items.push(topSigning ? {
    label: "Top FA Outcome",
    value: `${topSigning.player.name} -> ${topSigning.toTeam}`,
    detail: `${formatMoney(topSigning.annualSalary)} AAV via ${topSigning.context.toolName}; ${shortSigningReason(topSigning)}.`,
    tone: topSigning.toTeam === topSigning.fromTeam ? "neutral" : "good"
  } : {
    label: "Top FA Outcome",
    value: "No signing",
    detail: "No free-agent outcome matched this scope.",
    tone: "neutral"
  });

  items.push(draftSignal ? {
    label: "Draft Signal",
    value: `${draftSignal.pick}. ${draftSignal.prospect.name}`,
    detail: `${draftSignal.team} took a ${draftSignal.reachSteal.toLowerCase()} relative to the board; fit ${formatNumber(draftSignal.score.needFit, 2)}.`,
    tone: draftSignal.reachSteal === "Steal" ? "good" : draftSignal.reachSteal === "Reach" ? "warn" : "neutral"
  } : {
    label: "Draft Signal",
    value: "No pick",
    detail: "No draft pick landed in this scope.",
    tone: "neutral"
  });

  items.push(tradeSignal ? {
    label: "Trade Signal",
    value: `${tradeSignal.teamB} gets ${tradeSignal.player.name}`,
    detail: `${formatMoney(tradeSignal.pickValue)} pick-equivalent value; ${tradeSignal.sellerMotivation}`,
    tone: "warn"
  } : {
    label: "Trade Signal",
    value: "No trade",
    detail: "No two-team trade cleared both front-office thresholds.",
    tone: "neutral"
  });

  const rightsSignal = rightsSignalForScope(run, selectedTeam);
  if (rightsSignal) items.push(rightsSignal);
  if (batchSignal) items.push(batchSignal);
  return items.slice(0, 5);
}

function rightsSignalForScope(run: SimulationRun, selectedTeam: string): ResultDigestItem | null {
  const players = run.players.filter((player) =>
    (player.status === "UFA" || player.status === "RFA") &&
    player.rights !== "None" &&
    (selectedTeam === "All" || player.rightsTeam === selectedTeam)
  );
  const retained = players.filter((player) => player.holdAction === "retained");
  const renounced = run.players.filter((player) =>
    player.holdAction === "renounced" &&
    (selectedTeam === "All" || player.rightsTeam === selectedTeam)
  );
  const topRetained = retained.slice().sort((a, b) => b.holdRetainScore - a.holdRetainScore || b.marketValue - a.marketValue)[0];
  const topRenounced = renounced.slice().sort((a, b) => b.capHold - a.capHold || b.marketValue - a.marketValue)[0];
  if (topRetained) {
    return {
      label: "Rights Signal",
      value: `${topRetained.rightsTeam} keeps ${topRetained.name}`,
      detail: `${topRetained.rights} ${topRetained.status} rights; hold score ${formatNumber(topRetained.holdRetainScore, 2)}, option value ${formatNumber(topRetained.rightsValue, 2)}.`,
      tone: topRetained.status === "RFA" || topRetained.rights === "Bird" ? "good" : "neutral"
    };
  }
  if (topRenounced) {
    return {
      label: "Rights Signal",
      value: `${topRenounced.rightsTeam} renounces ${topRenounced.name}`,
      detail: `Opened room by dropping ${formatMoney(topRenounced.capHold)} hold; ${topRenounced.holdActionReason ?? "cap-room path."}`,
      tone: "warn"
    };
  }
  return null;
}

function batchDigestForScope(summary: MultiRunSummary, selectedTeam: string): ResultDigestItem | null {
  if (selectedTeam !== "All") {
    const row = summary.teamOutcomes.find((item) => item.team === selectedTeam);
    if (!row) return null;
    return {
      label: "Batch Read",
      value: `${formatNumber(row.pct * 100, 0)}% ${row.outcome}`,
      detail: `${formatMoney(row.avgPayroll)} avg payroll, ${formatSignedMoney(row.avgTaxRoom)} avg tax room across ${summary.runs} runs.`,
      tone: row.outcome.includes("Apron") || row.outcome.includes("Tax") ? "warn" : row.outcome.includes("Room") ? "good" : "neutral"
    };
  }
  const volatile = summary.volatileDecisions[0];
  if (!volatile) return {
    label: "Batch Read",
    value: `${summary.runs} runs stable`,
    detail: "No high-frequency volatile decision crossed the display threshold.",
    tone: "good"
  };
  return {
    label: "Batch Read",
    value: `${volatile.entity}`,
    detail: `${volatile.outcome} in ${formatNumber(volatile.pct * 100, 0)}% of runs.`,
    tone: "warn"
  };
}

function leagueVerdict(run: SimulationRun): string {
  const topSigning = run.freeAgency.slice().sort((a, b) => b.annualSalary - a.annualSalary)[0];
  if (topSigning) return `${topSigning.player.name} headlines a ${run.freeAgency.length}-signing market`;
  if (run.trades.length) return `${run.trades.length} trades define a quiet free-agent market`;
  return "The model produces a patient, low-transaction offseason";
}

function teamVerdict(run: SimulationRun, team: TeamSummary): string {
  const incoming = run.freeAgency.filter((row) => row.toTeam === team.team);
  const outgoing = run.freeAgency.filter((row) => row.fromTeam === team.team && row.toTeam !== team.team);
  const acquired = run.trades.filter((row) => row.teamB === team.team);
  const moved = run.trades.filter((row) => row.teamA === team.team);
  const picks = run.draft.filter((row) => row.team === team.team);
  const bestIncoming = incoming.slice().sort((a, b) => b.annualSalary - a.annualSalary)[0];
  if (bestIncoming) return `${team.team} ${bestIncoming.toTeam === bestIncoming.fromTeam ? "keeps" : "lands"} ${bestIncoming.player.name}`;
  if (acquired[0]) return `${team.team} trades for ${acquired[0].player.name}`;
  if (moved[0]) return `${team.team} converts ${moved[0].player.name} into flexibility`;
  if (picks[0]) return `${team.team} drafts ${picks[0].prospect.name}`;
  if (outgoing[0]) return `${team.team} loses ${outgoing[0].player.name} and protects flexibility`;
  return `${team.team} mostly preserves optionality`;
}

function frontOfficeRead(run: SimulationRun, team: TeamSummary): string {
  const incoming = run.freeAgency.filter((row) => row.toTeam === team.team);
  const losses = run.freeAgency.filter((row) => row.fromTeam === team.team && row.toTeam !== team.team);
  const trades = run.trades.filter((row) => row.teamA === team.team || row.teamB === team.team);
  const pressure = capWarnings(team)[0];
  if (team.secondApronRoom < 0) return `The office is operating under second-apron stress, so every added dollar needs a rotation-level reason. ${pressure}`;
  if (team.capPath === "cap_room" && incoming.length) return `The office chose room over blanket hold retention, then spent into a target that fit the board. ${team.capPathReason}`;
  if (team.capPath === "retained_rights" && incoming.some((row) => row.toTeam === row.fromTeam)) return `The office valued continuity and matching power more than a clean-room swing. ${team.capPathReason}`;
  if (trades.length) return `The trade path mattered more than the open market, with asset value and salary matching steering the result.`;
  if (losses.length && !incoming.length) return `The model lets the market walk rather than chase replacement cost into a weak cap position.`;
  return team.capPathReason;
}

function teamMoveDigest(run: SimulationRun, team: TeamSummary): string[] {
  const moves: string[] = [];
  run.options
    .filter((row) => row.team === team.team)
    .slice(0, 2)
    .forEach((row) => moves.push(`${row.decision === "exercise" ? "Kept" : "Declined"} ${row.player.name} option`));
  run.draft
    .filter((row) => row.team === team.team)
    .slice(0, 3)
    .forEach((row) => moves.push(`Pick ${row.pick}: ${row.prospect.name} (${row.reachSteal})`));
  run.freeAgency
    .filter((row) => row.toTeam === team.team)
    .slice(0, 4)
    .forEach((row) => moves.push(`${row.toTeam === row.fromTeam ? "Retained" : "Signed"} ${row.player.name} at ${formatMoney(row.annualSalary)}`));
  run.freeAgency
    .filter((row) => row.fromTeam === team.team && row.toTeam !== team.team)
    .slice(0, 2)
    .forEach((row) => moves.push(`Lost ${row.player.name} to ${row.toTeam}`));
  run.trades
    .filter((row) => row.teamA === team.team || row.teamB === team.team)
    .slice(0, 2)
    .forEach((row) => moves.push(row.teamB === team.team ? `Acquired ${row.player.name}` : `Moved ${row.player.name}`));
  return moves.slice(0, 7);
}

function rightsDigestForTeam(run: SimulationRun, team: TeamSummary): string[] {
  const retained = run.players
    .filter((player) => player.rightsTeam === team.team && player.holdAction === "retained" && player.rights !== "None")
    .sort((a, b) => b.holdRetainScore - a.holdRetainScore || b.marketValue - a.marketValue)
    .slice(0, 4)
    .map((player) => `${player.name}: retained ${player.rights}${player.status === "RFA" ? " RFA" : ""} rights, score ${formatNumber(player.holdRetainScore, 2)}`);
  const renounced = run.players
    .filter((player) => player.rightsTeam === team.team && player.holdAction === "renounced")
    .sort((a, b) => b.capHold - a.capHold || b.marketValue - a.marketValue)
    .slice(0, 3)
    .map((player) => `${player.name}: renounced hold to create room`);
  const matched = run.freeAgency
    .filter((signing) => signing.matched && signing.toTeam === team.team)
    .map((signing) => `${signing.player.name}: matched ${formatMoney(signing.annualSalary)} offer sheet`);
  const declinedSheets = run.freeAgency
    .filter((signing) => signing.offerSheetTeam && !signing.matched && signing.fromTeam === team.team)
    .map((signing) => `${signing.player.name}: declined ${signing.offerSheetTeam} sheet at ${formatMoney(signing.annualSalary)}`);
  const drafted = run.draft
    .filter((selection) => selection.team === team.team && selection.pick <= 30)
    .slice(0, 2)
    .map((selection) => `${selection.prospect.name}: rookie-scale control from pick ${selection.pick}`);
  const rows = [...matched, ...declinedSheets, ...retained, ...renounced, ...drafted];
  return rows.length ? rows.slice(0, 6) : ["No meaningful rights decision"];
}

function teamOutcomePriority(run: SimulationRun, team: TeamSummary): number {
  const moves = teamMoveDigest(run, team).length;
  const capPressure = (team.secondApronRoom < 0 ? 5 : team.firstApronRoom < 0 ? 4 : team.taxRoom < 0 ? 2 : 0);
  const spend = sum(run.freeAgency.filter((row) => row.toTeam === team.team).map((row) => row.annualSalary)) / 10_000_000;
  return moves + capPressure + spend + team.premiumPickCount * 0.6;
}

function teamBatchOutcome(run: SimulationRun, team: TeamSummary): string {
  const incoming = run.freeAgency.filter((row) => row.toTeam === team.team);
  const outside = incoming.filter((row) => row.fromTeam !== team.team);
  const retained = incoming.filter((row) => row.fromTeam === team.team);
  const tradesIn = run.trades.filter((row) => row.teamB === team.team);
  const tradesOut = run.trades.filter((row) => row.teamA === team.team);
  if (team.secondApronRoom < 0) return "Second Apron";
  if (team.firstApronRoom < 0) return "First Apron";
  if (outside.length > 0 && team.capPath === "cap_room") return "Room Spend";
  if (outside.length > 0) return "Outside FA Add";
  if (retained.length > 0) return "Retained Core";
  if (tradesIn.length > 0) return "Trade Buyer";
  if (tradesOut.length > 0) return "Trade Seller";
  if (run.draft.some((row) => row.team === team.team && row.pick <= 20)) return "Draft Focus";
  if (team.taxRoom < 0) return "Tax Hold";
  return "Hold Pattern";
}

function capPathLabel(value: string | null | undefined): string {
  return value === "cap_room" ? "Cap room" : "Retained rights";
}

function toolKindLabel(value: SpendingTool["kind"] | string): string {
  if (value === "cap") return "Cap";
  if (value === "bird") return "Bird";
  if (value === "non_taxpayer_mle") return "NTMLE";
  if (value === "taxpayer_mle") return "Tax MLE";
  if (value === "room_exception") return "Room Ex";
  if (value === "bi_annual") return "BAE";
  if (value === "minimum") return "Min";
  return value;
}

function marketChaserLabel(signing: FreeAgentSigning): string {
  if (signing.offerSheetTeam) return `${signing.offerSheetTeam} sheet ${formatMoney(signing.context.highestBid ?? signing.annualSalary)}`;
  if (signing.context.runnerUpTeam) return `${signing.context.runnerUpTeam} ${signing.context.runnerUpBid ? formatMoney(signing.context.runnerUpBid) : ""}`;
  return "-";
}

function shortSigningReason(signing: FreeAgentSigning): string {
  if (signing.context.selectionMethod?.includes("restricted-rights leverage")) return "RFA fallback";
  if (signing.matched) return "Matched sheet";
  if (signing.context.holdAction === "retained" && signing.toTeam === signing.fromTeam) return "Rights retained";
  if (signing.context.capPath === "cap_room") return "Cap-room target";
  return signing.context.toolReason?.split(";")[0] ?? signing.marketResolution?.clearingRule ?? "Market offer";
}

function rfaIncumbentDecisionLabel(signing: FreeAgentSigning): string {
  if (!signing.offerSheetTeam) return "-";
  if (signing.context.incumbentDecision === "matched" || signing.matched) return `${signing.fromTeam} matched`;
  if (signing.context.incumbentDecision === "declined") return `${signing.fromTeam} declined`;
  return "Pending";
}

function rfaIncumbentBidLabel(signing: FreeAgentSigning): string {
  if (!signing.offerSheetTeam) return "-";
  const bid = signing.context.incumbentBid;
  if (!bid) return "No incumbent bid";
  const years = signing.context.incumbentBidYears ? ` x ${signing.context.incumbentBidYears}` : "";
  const tool = signing.context.incumbentBidTool ? ` via ${signing.context.incumbentBidTool}` : "";
  return `${formatMoney(bid)}${years}${tool}`;
}

function rfaIncumbentDecisionItems(signing: FreeAgentSigning): string[] {
  if (!signing.offerSheetTeam) return [];
  const legal = typeof signing.context.incumbentLegalMax === "number"
    ? `Legal match capacity: ${formatMoney(signing.context.incumbentLegalMax)}; ${signing.context.incumbentCanMatch ? "could match" : "could not match"}`
    : `${signing.fromTeam} matching rights were evaluated`;
  const score = typeof signing.context.incumbentMatchScore === "number"
    ? `Match score: ${formatNumber(signing.context.incumbentMatchScore, 2)}`
    : "Match score unavailable";
  return [
    `${signing.offerSheetTeam} offer sheet: ${formatMoney(signing.annualSalary)} AAV x ${signing.years} years`,
    `${signing.fromTeam} incumbent bid: ${rfaIncumbentBidLabel(signing)}`,
    `${rfaIncumbentDecisionLabel(signing)} exact terms`,
    legal,
    score,
    signing.context.incumbentDecisionReason ?? (signing.matched ? "Incumbent exercised full RFA matching control." : "Incumbent declined to match the exact offer sheet.")
  ];
}

function WarRoomView({
  plans,
  selectedTeam,
  selectedPlan,
  multiRun
}: {
  plans: TeamWarRoomPlan[];
  selectedTeam: string;
  selectedPlan: TeamWarRoomPlan | null;
  multiRun: MultiRunSummary | null;
}) {
  const visiblePlans = selectedPlan ? [selectedPlan] : plans.slice(0, 6);
  return (
    <section className="offseason-panel war-room-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{selectedTeam === "All" ? "Priority War Rooms" : `${selectedTeam} Action Stack`}</h2>
          <p>Team objective, move order, constraint warnings, and cap consequences from this run.</p>
        </div>
      </div>
      <div className="war-room-grid">
        {visiblePlans.map((plan) => (
          <article key={plan.team.team} className="war-room-card">
            <div className="war-room-card-head">
              <div>
                <span>{plan.team.mode}</span>
                <strong>{plan.team.team}</strong>
                <p>{plan.objective}</p>
              </div>
              <b>{formatNumber(plan.urgency * 100, 0)}</b>
            </div>
            <div className="strategy-meter-grid">
              <StrategyMeter label="Urgency" value={plan.urgency} />
              <StrategyMeter label="Flex" value={plan.flexibility} />
              <StrategyMeter label="Tax Risk" value={plan.taxDanger} invert />
              <StrategyMeter label="Assets" value={plan.assetLeverage} />
              <StrategyMeter label="Clarity" value={plan.clarity} />
            </div>
            <div className="cap-strip">
              <CapChip label="Payroll" value={plan.finalPayroll} neutral />
              <CapChip label="Room" value={plan.team.capSpace} />
              <CapChip label="Held room" value={plan.team.heldCapSpace} />
              <CapChip label="Max room" value={plan.team.maximumCapSpace} />
              <CapChip label="Tax" value={plan.team.taxRoom} />
              <CapChip label="A2" value={plan.team.secondApronRoom} />
            </div>
            <MoveList title="Roster Holes" items={plan.rosterHoles.length ? plan.rosterHoles : ["No acute hole in this run"]} />
            {plan.warnings.length > 0 && <MoveList title="Avoid" items={plan.warnings} />}
            <div className="action-stack">
              {plan.priorities.slice(0, 5).map((priority) => (
                <DecisionCard
                  key={`${plan.team.team}-${priority.kind}-${priority.label}`}
                  title={priority.label}
                  meta={priority.kind.toUpperCase()}
                  explanation={priority.detail}
                  drivers={priority.drivers}
                  score={priority.score}
                  plausibility={priority.plausibility}
                />
              ))}
            </div>
            {multiRun && selectedTeam !== "All" && <TeamDistributionStrip summary={multiRun} team={plan.team.team} />}
          </article>
        ))}
      </div>
    </section>
  );
}

function LeagueBoardView({ plans, onSelectTeam }: { plans: TeamWarRoomPlan[]; onSelectTeam: (team: string) => void }) {
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>League Strategy Board</h2>
          <p>Teams ranked by urgency, flexibility, tax danger, asset leverage, and how coherent their simulated path looks.</p>
        </div>
      </div>
      <div className="league-board">
        <div className="league-board-head">
          <span>Team</span>
          <span>Objective</span>
          <span>Urgency</span>
          <span>Flex</span>
          <span>Tax</span>
          <span>Assets</span>
          <span>Clarity</span>
        </div>
        {plans.map((plan) => (
          <button key={plan.team.team} className="league-board-row" onClick={() => onSelectTeam(plan.team.team)}>
            <strong>{plan.team.team}</strong>
            <span>{plan.objective}</span>
            <MeterCell value={plan.urgency} />
            <MeterCell value={plan.flexibility} />
            <MeterCell value={plan.taxDanger} tone={plan.taxDanger > 0.6 ? "bad" : "neutral"} />
            <MeterCell value={plan.assetLeverage} />
            <MeterCell value={plan.clarity} tone={plan.clarity < 0.45 ? "warn" : "good"} />
          </button>
        ))}
      </div>
    </section>
  );
}

function DecisionBoard({ run, selectedTeam }: { run: SimulationRun; selectedTeam: string }) {
  const rows = run.explanations
    .filter((item) => selectedTeam === "All" || item.team === selectedTeam)
    .sort((a, b) => b.plausibility - a.plausibility)
    .slice(0, selectedTeam === "All" ? 10 : 18);
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Decision Intelligence</h2>
          <p>Top moves with score drivers exposed instead of buried in table text.</p>
        </div>
      </div>
      <div className="decision-card-grid">
        {rows.map((item) => (
          <DecisionCard
            key={`${item.kind}-${item.team}-${item.player}-${item.title}`}
            title={item.title}
            meta={`${item.kind} / ${formatNumber(item.plausibility * 100, 0)}% plaus`}
            explanation={item.explanation}
            drivers={driversFromScore(item.score)}
            score={item.score}
            plausibility={item.plausibility}
            auditRows={item.player ? auditRowsForPlayer(run.marketAudit, item.player, item.team) : []}
          />
        ))}
      </div>
    </section>
  );
}

function DecisionCard({
  title,
  meta,
  explanation,
  drivers,
  score,
  plausibility,
  auditRows = []
}: {
  title: string;
  meta: string;
  explanation: string;
  drivers: DecisionDriver[];
  score?: DecisionScore;
  plausibility?: number;
  auditRows?: OfferAudit[];
}) {
  return (
    <details className="decision-card">
      <summary>
        <span>{meta}</span>
        <strong>{title}</strong>
        {typeof plausibility === "number" && <b>{`${formatNumber(plausibility * 100, 0)}%`}</b>}
      </summary>
      <p>{explanation}</p>
      <DriverChips drivers={drivers} />
      {score && <ScoreBreakdown score={score} />}
      {auditRows.length > 0 && <OfferAuditMini rows={auditRows} />}
    </details>
  );
}

function OfferAuditMini({ rows }: { rows: OfferAudit[] }) {
  return (
    <div className="offer-audit-mini">
      <span>Offer Audit</span>
      {rows.slice(0, 8).map((row) => (
        <div key={row.id} className={cls("offer-audit-mini-row", `audit-${row.status}`)}>
          <b>{`${row.team} ${row.status}`}</b>
          <p>{`${row.offer ? formatMoney(row.offer) : "-"}${row.toolName ? ` via ${row.toolName}` : ""}: ${row.reason}`}</p>
        </div>
      ))}
      {rows.length > 8 && <p>{`+${rows.length - 8} more audit rows`}</p>}
    </div>
  );
}

function DriverChips({ drivers }: { drivers: DecisionDriver[] }) {
  return (
    <div className="driver-chip-row">
      {drivers.map((driver) => (
        <span key={`${driver.label}-${driver.value}`} className={cls("driver-chip", `driver-${driver.tone}`)} title={driver.explanation}>
          <b>{driver.label}</b>
          {driver.value}
        </span>
      ))}
    </div>
  );
}

function ScoreBreakdown({ score }: { score: DecisionScore }) {
  return (
    <div className="score-breakdown">
      {[
        ["Need", score.needFit],
        ["Value", score.value],
        ["Timeline", score.timeline],
        ["Urgency", score.urgency],
        ["Tax", score.taxPain],
        ["Assets", score.assetValue],
        ["Replace", score.replacement],
        ["Upside", score.upsideRisk],
        ["Rights", score.incumbency],
        ["Noise", score.randomness]
      ].map(([label, value]) => (
        <div key={String(label)} className="score-mini-bar">
          <span>{label}</span>
          <i style={{ width: `${clamp(Number(value), 0, 1) * 100}%` }} />
          <b>{formatNumber(Number(value), 2)}</b>
        </div>
      ))}
    </div>
  );
}

function StrategyMeter({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const tone = invert ? (value > 0.62 ? "bad" : value > 0.36 ? "warn" : "good") : value > 0.62 ? "good" : value > 0.36 ? "warn" : "neutral";
  return (
    <div className={cls("strategy-meter", `meter-${tone}`)}>
      <span>{label}</span>
      <i><b style={{ width: `${clamp(value, 0, 1) * 100}%` }} /></i>
      <strong>{formatNumber(value * 100, 0)}</strong>
    </div>
  );
}

function MeterCell({ value, tone = "neutral" }: { value: number; tone?: DriverTone }) {
  return (
    <span className={cls("meter-cell", `driver-${tone}`)}>
      <i style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
      <b>{formatNumber(value * 100, 0)}</b>
    </span>
  );
}

function TeamDistributionStrip({ summary, team }: { summary: MultiRunSummary; team: string }) {
  const destinations = summary.playerDestinations.filter((row) => row.destination === team).slice(0, 3);
  const trades = summary.tradeTeams.find((row) => row.team === team);
  const tax = summary.taxOutcomes.filter((row) => row.entity === team).slice(0, 2);
  return (
    <div className="team-distribution-strip">
      <h3>{`${summary.runs} Run Read`}</h3>
      {destinations.map((row) => <span key={`${row.player}-${row.destination}`}>{`${row.player}: ${formatNumber(row.pct * 100, 0)}%`}</span>)}
      {trades && <span>{`Trade involvement: ${formatNumber(trades.pct * 100, 0)}%`}</span>}
      {tax.map((row) => <span key={`${row.entity}-${row.outcome}`}>{`${row.outcome}: ${formatNumber(row.pct * 100, 0)}%`}</span>)}
      {!destinations.length && !trades && !tax.length && <span>No strong multi-run signal yet</span>}
    </div>
  );
}

function buildRunHeadline(run: SimulationRun) {
  const plausibilities = [
    ...run.draft.map((item) => item.plausibility),
    ...run.options.map((item) => item.plausibility),
    ...run.freeAgency.map((item) => item.plausibility),
    ...run.trades.map((item) => item.plausibility)
  ];
  return {
    majorMoves: run.draft.length + run.options.length + run.freeAgency.length + run.trades.length,
    avgPlausibility: avg(plausibilities),
    rfaSheets: run.freeAgency.filter((item) => item.status === "RFA" && item.offerSheetTeam).length,
    rfaMatches: run.freeAgency.filter((item) => item.matched).length,
    taxTeams: run.teams.filter((team) => team.taxRoom < 0).length,
    tradeValue: sum(run.trades.map((trade) => trade.pickValue))
  };
}

function MoveList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="move-list">
      <span>{title}</span>
      {items.slice(0, 5).map((item) => <p key={`${title}-${item}`}>{item}</p>)}
      {items.length > 5 && <p>{`+${items.length - 5} more`}</p>}
    </div>
  );
}

function CapChip({ label, value, neutral = false }: { label: string; value: number; neutral?: boolean }) {
  return (
    <div className={cls("cap-chip", !neutral && value < 0 && "bad", !neutral && value >= 0 && "ok")}>
      <span>{label}</span>
      <strong>{neutral ? formatMoney(value) : formatSignedMoney(value)}</strong>
    </div>
  );
}

function MultiRunPanel({ summary }: { summary: MultiRunSummary }) {
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{`${summary.runs} Run Distribution`}</h2>
          <p>Common destinations, draft pairings, volatility, apron outcomes, unresolved markets, and payroll bands.</p>
        </div>
      </div>
      <div className="multi-grid">
        <MiniRank title="Player Destinations" rows={summary.playerDestinations.slice(0, 8).map((row) => [`${row.player} -> ${row.destination}`, `${formatNumber(row.pct * 100, 0)}% / ${formatMoney(row.avgSalary)}`])} />
        <MiniRank title="Draft Outcomes" rows={summary.draftOutcomes.slice(0, 8).map((row) => [`${row.prospect} -> ${row.team}`, `${formatNumber(row.pct * 100, 0)}% / pick ${formatNumber(row.avgPick, 1)}`])} />
        <MiniRank title="Trade Frequency" rows={summary.tradeTeams.slice(0, 8).map((row) => [row.team, `${formatNumber(row.pct * 100, 0)}%`])} />
        <MiniRank title="RFA Matches" rows={summary.rfaMatches.slice(0, 8).map((row) => [row.player, `${row.matches}/${row.offers} matched`])} />
        <MiniRank title="Team Outcomes" rows={summary.teamOutcomes.slice(0, 8).map((row) => [row.team, `${row.outcome} / ${formatNumber(row.pct * 100, 0)}%`])} />
        <MiniRank title="Stable Decisions" rows={summary.stableDecisions.slice(0, 8).map((row) => [row.entity, `${row.outcome} / ${formatNumber(row.pct * 100, 0)}%`])} />
        <MiniRank title="Volatile Decisions" rows={summary.volatileDecisions.slice(0, 8).map((row) => [row.entity, `${row.outcome} / ${formatNumber(row.pct * 100, 0)}%`])} />
        <MiniRank title="Apron Outcomes" rows={summary.taxOutcomes.slice(0, 8).map((row) => [row.entity, `${row.outcome} / ${formatNumber(row.pct * 100, 0)}%`])} />
        <MiniRank title="Unresolved Market" rows={summary.unresolvedMarkets.slice(0, 8).map((row) => [row.entity, `${formatNumber(row.pct * 100, 0)}% unsigned`])} />
        <MiniRank title="Payroll Outcomes" rows={summary.payrolls.slice(0, 8).map((row) => [row.team, `${formatMoney(row.avgPayroll)} avg / ${formatMoney(row.highPayroll)} high`])} />
        <MiniRank title="Surprises" rows={summary.surprises.slice(0, 8).map((row) => [row.label, `${formatNumber(row.frequency * 100, 0)}%`])} />
      </div>
    </section>
  );
}

function MiniRank({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="mini-rank">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="mini-empty">No qualifying outcomes</p>}
      {rows.map(([label, value]) => (
        <div key={`${title}-${label}`} className="mini-rank-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function DraftResultsTable({ selections, selectedTeam }: { selections: DraftSelection[]; selectedTeam: string }) {
  const rows = selectedTeam === "All" ? selections : selections.filter((selection) => selection.team === selectedTeam);
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Draft Board</h2>
          <p>BPA versus fit, reach/steal markers, and the team logic behind each pick.</p>
        </div>
      </div>
      <div className="draft-board-grid">
        {rows.map((selection) => {
          const marker = selection.reachSteal;
          return (
            <article key={selection.pick} className={cls("draft-pick-card", marker.toLowerCase())}>
              <div className="draft-pick-head">
                <b>{selection.pick}</b>
                <div>
                  <strong>{selection.prospect.name}</strong>
                  <span>{`${selection.team} / ${selection.prospect.position} / ${selection.prospect.tier}`}</span>
                </div>
                <em>{marker}</em>
              </div>
              <div className="transaction-facts">
                <Fact label="Consensus" value={formatNumber(selection.consensusRank, 0)} />
                <Fact label="Model/BPA" value={formatNumber(selection.modelRank, 0)} />
                <Fact label="Fit delta" value={formatNumber(selection.fitDelta, 2)} />
                <Fact label="Plaus" value={`${formatNumber(selection.plausibility * 100, 0)}%`} />
              </div>
              <DriverChips drivers={driversFromScore(selection.score)} />
              <p className="transaction-why">{selection.explanation}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OptionResultsTable({ decisions, selectedTeam }: { decisions: OptionDecision[]; selectedTeam: string }) {
  const rows = selectedTeam === "All" ? decisions : decisions.filter((decision) => decision.team === selectedTeam);
  return (
    <TablePanel title="Option Decisions" detail="Player, team, and non-guaranteed style choices use market value, risk, replacement, need, and tax pressure.">
      <table className="data-table offseason-table">
        <thead><tr><th>Player</th><th>Team</th><th>Type</th><th>Decision</th><th>Salary</th><th>Market</th><th>Need</th><th>Tax</th><th>Plaus</th><th>Why</th></tr></thead>
        <tbody>
          {rows.map((decision) => (
            <tr key={decision.player.id}>
              <td>{decision.player.name}</td>
              <td>{decision.team}</td>
              <td>{decision.optionType}</td>
              <td>{decision.decision}</td>
              <td>{formatMoney(decision.player.salary)}</td>
              <td>{formatMoney(decision.player.marketValue)}</td>
              <td>{formatNumber(decision.score.needFit, 2)}</td>
              <td>{formatNumber(decision.score.taxPain, 2)}</td>
              <td>{formatNumber(decision.plausibility * 100, 0)}</td>
              <td>{decision.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  );
}

function SigningResultsTable({ signings, audit, selectedTeam }: { signings: FreeAgentSigning[]; audit: OfferAudit[]; selectedTeam: string }) {
  const groups = groupFreeAgentMarkets(signings, audit, selectedTeam);
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Free Agency Market Board</h2>
          <p>Player-grouped markets with winner, runner-up signals, offer mechanics, and audit trail.</p>
        </div>
      </div>
      <div className="fa-market-grid">
        {groups.length === 0 && <p className="mini-empty">No free-agent signings generated for this filter.</p>}
        {groups.map(({ signing, auditRows, submittedOffers, rejectedOffers }) => (
          <article key={`${signing.player.id}-${signing.toTeam}`} className="fa-market-card">
            <div className="fa-market-head">
              <div>
                <strong>{signing.player.name}</strong>
                <span>{`${signing.status}${signing.matched ? " matched" : ""} / ${signing.fromTeam} -> ${signing.toTeam}`}</span>
              </div>
              <b>{formatMoney(signing.annualSalary)} AAV</b>
            </div>
            <div className="fa-market-layout">
              <div className="market-result-block">
                <h3>Market Result</h3>
                <div className="transaction-facts">
                  <Fact label="Final team" value={signing.toTeam} />
                  <Fact label="Offer sheet" value={signing.offerSheetTeam ?? "-"} />
                  <Fact label="Incumbent" value={signing.fromTeam} />
                  <Fact label="Inc. decision" value={rfaIncumbentDecisionLabel(signing)} />
                  <Fact label="Inc. bid" value={rfaIncumbentBidLabel(signing)} />
                  <Fact label="Status" value={signing.matched ? "RFA match" : signing.status} />
                  <Fact label="Highest AAV" value={`${signing.context.highestBidTeam ?? "-"} ${signing.context.highestBid ? formatMoney(signing.context.highestBid) : "-"}`} />
                  <Fact label="Money gap" value={signing.context.moneyGap ? formatMoney(signing.context.moneyGap) : "-"} />
                  <Fact label="Plausibility" value={`${formatNumber(signing.plausibility * 100, 0)}%`} />
                </div>
                <DriverChips drivers={driversFromScore(signing.score)} />
                {signing.context.bidComponents && <MarketComponentBars components={signing.context.bidComponents} />}
                {signing.offerSheetTeam && (
                  <p className="transaction-note">{`${signing.offerSheetTeam} created an exact ${formatMoney(signing.annualSalary)} x ${signing.years} offer sheet${signing.matched ? "; incumbent matched those exact terms." : "; incumbent declined those exact terms."}`}</p>
                )}
                {signing.context.highestMoneyLostReason && <p className="transaction-note">{signing.context.highestMoneyLostReason}</p>}
                <p className="transaction-why">{signing.explanation}</p>
              </div>
              <div className="market-result-block">
                <h3>Contract And Tool</h3>
                <div className="transaction-facts">
                  <Fact label="Years" value={String(signing.years)} />
                  <Fact label="Years gap" value={signing.context.yearsGap ? String(signing.context.yearsGap) : "-"} />
                  <Fact label="Total" value={formatMoney(signing.totalSalary)} />
                  <Fact label="Chosen offer" value={formatMoney(signing.context.originalAsk ?? signing.annualSalary)} />
                  <Fact label="Tool" value={signing.context.toolName || signing.tool} />
                  <Fact label="Cap path" value={capPathLabel(signing.context.capPath)} />
                  <Fact label="Hold" value={String(signing.context.holdAction ?? "-")} />
                  <Fact label="Rights value" value={formatNumber(signing.context.rightsValue ?? signing.player.rightsValue, 2)} />
                  <Fact label="Scarcity" value={formatNumber(signing.context.scarcityScore ?? signing.player.scarcityScore, 2)} />
                  <Fact label="Role minutes" value={`${formatNumber(signing.context.expectedMarketMinutes ?? signing.player.expectedMarketMinutes, 0)} / ${signing.context.marketMinutesSource ?? signing.player.marketMinutesSource}`} />
                  <Fact label="Tool max" value={formatMoney(signing.context.toolAmount)} />
                  <Fact label="Legal max" value={formatMoney(signing.context.legalMax)} />
                </div>
                <div className="cap-strip compact">
                  <CapChip label="Pre cap" value={signing.context.preCapSpace} />
                  <CapChip label="Pre tax" value={signing.context.preTaxRoom} />
                  <CapChip label="Pre A1" value={signing.context.preFirstApronRoom} />
                  <div className="cap-chip ok"><span>Need</span><strong>{formatNumber(signing.context.needFit, 2)}</strong></div>
                </div>
                {signing.context.toolReason && <p className="transaction-note">{signing.context.toolReason}</p>}
              </div>
            </div>
            <div className="market-bid-board">
              {signing.offerSheetTeam && <MoveList title="RFA Incumbent Decision" items={rfaIncumbentDecisionItems(signing)} />}
              <MoveList title="Team Bid Logic" items={signing.context.logic.length ? signing.context.logic : ["No team bid details emitted"]} />
              <MoveList title="Other Bidders" items={signing.context.alternatives.length ? signing.context.alternatives : submittedOffers.filter((row) => row.team !== signing.toTeam).slice(0, 4).map((row) => `${row.team}: ${row.offer ? formatMoney(row.offer) : "-"} via ${row.toolName ?? "tool"}`)} />
              <MoveList title="Why Others Lost" items={signing.context.losingReasons?.length ? signing.context.losingReasons : rejectedOffers.slice(0, 5).map((row) => `${row.team}: ${row.reason}`)} />
            </div>
            <OfferLogic signing={signing} />
            <OfferAuditMini rows={auditRows} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MarketComponentBars({ components }: { components: MarketComponentBreakdown }) {
  const rows: Array<[string, number, boolean]> = [
    ["AAV", components.salary, false],
    ["Total guarantee", components.totalGuarantee, false],
    ["Noise", components.randomness, components.randomness < 0]
  ];
  rows.splice(2, 0, ["Years", components.security, false], ["Role", components.roleFit, false], ["Familiar", components.familiarity, false], ["Scarcity", components.scarcity, false], ["Close offer", components.closeOfferAdjustment, components.closeOfferAdjustment < 0]);
  return (
    <div className="market-component-bars">
      <span>Player Choice Logic</span>
      {rows.map(([label, value, invert]) => {
        const width = `${clamp(Math.abs(value), 0, 1) * 100}%`;
        return (
          <div key={label} className="market-component-row">
            <small>{label}</small>
            <div><i className={invert ? "bad" : "good"} style={{ width }} /></div>
            <b>{formatNumber(value, 2)}</b>
          </div>
        );
      })}
    </div>
  );
}

function TradeResultsTable({ trades, diagnostics }: { trades: TradeMove[]; diagnostics: string[] }) {
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Trade Board</h2>
          <p>Only non-anchor two-team trades that clear salary/apron checks and benefit both sides.</p>
        </div>
      </div>
      <div className="transaction-grid trade-card-grid">
        {trades.length === 0 && (
          <div className="trade-diagnostics">
            <p className="mini-empty">No reasonable trades cleared the model thresholds in this run.</p>
            {diagnostics.map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
        {trades.map((trade) => (
          <article key={trade.id} className="transaction-card trade-card">
            <div className="trade-matchup">
              <div>
                <span>Buyer</span>
                <strong>{trade.teamB}</strong>
              </div>
              <div>
                <span>Seller</span>
                <strong>{trade.teamA}</strong>
              </div>
              <b>{`${formatNumber(trade.plausibility * 100, 0)}%`}</b>
            </div>
            <div className="trade-assets">
              <MoveList title={`${trade.teamB} gets`} items={trade.buyerGets} />
              <MoveList title={`${trade.teamA} gets`} items={trade.sellerGets} />
            </div>
            <div className="transaction-facts">
              <Fact label="Buyer score" value={formatNumber(trade.scoreB.total, 2)} />
              <Fact label="Seller score" value={formatNumber(trade.scoreA.total, 2)} />
              <Fact label="Salary" value={formatMoney(trade.salary)} />
              <Fact label="Outgoing" value={formatMoney(trade.buyerOutgoingSalary)} />
              <Fact label="Pick EV" value={formatMoney(trade.pickValue)} />
            </div>
            <DriverChips drivers={driversFromScore(trade.scoreB)} />
            <p className="transaction-note">{trade.buyerMotivation}</p>
            <p className="transaction-note">{trade.sellerMotivation}</p>
            <p className="transaction-note">{trade.salaryRule}</p>
            <p className="transaction-why">{trade.explanation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TeamCapTable({ teams }: { teams: TeamSummary[] }) {
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Final Cap Sheets</h2>
          <p>Readable cap cards after options, draft picks, free agency, and trades.</p>
        </div>
      </div>
      <div className="cap-card-grid">
        {teams.map((team) => (
          <article key={team.team} className="cap-card">
            <div className="team-ledger-head">
              <div>
                <strong>{team.team}</strong>
                <span>{`${team.mode} / ${team.rosterCount}/${team.standardRosterLimit} players`}</span>
              </div>
              <b>{formatMoney(team.payroll)}</b>
            </div>
            <div className="cap-strip">
              <CapChip label="Room" value={team.capSpace} />
              <CapChip label="Held" value={team.heldCapSpace} />
              <CapChip label="Tax" value={team.taxRoom} />
              <CapChip label="A1" value={team.firstApronRoom} />
              <CapChip label="A2" value={team.secondApronRoom} />
            </div>
            <div className="cap-card-body">
              <Fact label="Active salary" value={formatMoney(team.activeSalary)} />
              <Fact label="Dead money" value={formatMoney(team.deadCap)} />
              <Fact label="Cap holds" value={formatMoney(team.capHolds)} />
              <Fact label="Roster charges" value={formatMoney(team.rosterCharges)} />
              <Fact label="Renounced room" value={formatSignedMoney(team.renouncedCapSpace)} />
              <Fact label="Max room" value={formatSignedMoney(team.maximumCapSpace)} />
              <Fact label="Pick EV" value={formatMoney(team.pickAssets)} />
              <Fact label="Picks" value={`${team.pickCount} (${team.premiumPickCount} top-20)`} />
            </div>
            <div className="cap-card-section">
              <span>Needs</span>
              <p>{team.needs.join(", ") || "-"}</p>
            </div>
            <div className="cap-card-section">
              <span>Core</span>
              <p>{team.rosterCore.join(" / ") || "-"}</p>
            </div>
            <div className="cap-card-section">
              <span>Moves</span>
              <p>{team.majorMoves.join(" / ") || "-"}</p>
            </div>
            <div className="cap-warning-strip">
              {capWarnings(team).map((warning) => <span key={`${team.team}-${warning}`}>{warning}</span>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MarketPlanView({ run, selectedTeam }: { run: SimulationRun; selectedTeam: string }) {
  const teams = selectedTeam === "All" ? run.teams.slice(0, 12) : run.teams.filter((team) => team.team === selectedTeam);
  const unsigned = run.players
    .filter((player) => player.status !== "Signed" && player.status !== "Rookie FA")
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 18);
  return (
    <section className="offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Market War Room</h2>
          <p>Team priority queues, budget/tool consumption, fallback movement, and why offers were capped.</p>
        </div>
      </div>
      <div className="market-plan-grid">
        {teams.map((team) => {
          const signings = run.freeAgency.filter((item) => item.toTeam === team.team);
          const losses = run.freeAgency.filter((item) => item.fromTeam === team.team && item.toTeam !== team.team);
          const trades = run.trades.filter((item) => item.teamA === team.team || item.teamB === team.team);
          const ledgerRows = run.marketLedger.filter((row) => row.team === team.team);
          const lostBids = ledgerRows
            .filter((row) => row.status === "shortlisted" || row.status === "outbid" || row.status === "declined")
            .slice(0, 4)
            .map((row) => `${row.player}: ${row.reason}`);
          const skippedMarkets = ledgerRows
            .filter((row) => row.status === "withdrawn" || row.status === "rejected")
            .slice(0, 4)
            .map((row) => `${row.player}: ${row.reason}`);
          const priorityQueue = ledgerRows
            .filter((row) => row.status === "submitted" || row.status === "won" || row.status === "outbid" || row.status === "withdrawn")
            .slice(0, 5)
            .map((row) => `${row.player}: ${row.status}${row.offer ? ` at ${formatMoney(row.offer)}` : ""} via ${row.tool ?? "tool"}`);
          const bestContext = signings[0]?.context;
          return (
            <article key={team.team} className="market-plan-card">
              <div className="team-ledger-head">
                <div>
                  <strong>{team.team}</strong>
                  <span>{team.mode}</span>
                </div>
                <b>{bestContext ? formatMoney(bestContext.preCapSpace) : formatSignedMoney(team.capSpace)} cap</b>
              </div>
              <div className="transaction-facts">
                <Fact label="Needs" value={team.needs.join(", ") || "-"} />
                <Fact label="Tax room" value={formatSignedMoney(team.taxRoom)} />
                <Fact label="Apron 1" value={formatSignedMoney(team.firstApronRoom)} />
                <Fact label="Pick EV" value={formatMoney(team.pickAssets)} />
              </div>
              <MoveList title="Won / retained" items={signings.length ? signings.map((item) => `${item.player.name}: ${formatMoney(item.annualSalary)} via ${item.context.toolName}`) : ["No FA wins"]} />
              <MoveList title="Priority Queue" items={priorityQueue.length ? priorityQueue : ["No submitted priority rows"]} />
              <MoveList title="Lost / passed" items={lostBids.length ? lostBids : losses.length ? losses.map((item) => `${item.player.name} to ${item.toTeam}`) : ["No major losses"]} />
              <MoveList title="Skipped / blocked" items={skippedMarkets.length ? skippedMarkets : ["No blocked target rows"]} />
              <MoveList title="Trade path" items={trades.length ? trades.map((item) => item.teamB === team.team ? `Acquire ${item.player.name}` : `Move ${item.player.name}`) : ["No trade cleared"]} />
              {signings[0] && <OfferLogic signing={signings[0]} />}
            </article>
          );
        })}
      </div>
      {selectedTeam === "All" && (
        <div className="unsigned-strip">
          <h3>Unresolved Market</h3>
          {unsigned.map((player) => (
            <span key={player.id}>{`${player.name} ${formatMoney(player.marketValue)}`}</span>
          ))}
        </div>
      )}
      <OfferAuditPanel audit={run.marketAudit} selectedTeam={selectedTeam} />
    </section>
  );
}

function OfferAuditPanel({ audit, selectedTeam }: { audit: OfferAudit[]; selectedTeam: string }) {
  const rows = audit
    .filter((row) => selectedTeam === "All" || row.team === selectedTeam)
    .sort((a, b) => a.round - b.round || statusRank(a.status) - statusRank(b.status) || b.marketValue - a.marketValue)
    .slice(0, selectedTeam === "All" ? 80 : 180);
  return (
    <div className="offer-audit">
      <div className="offer-audit-head">
        <h3>Offer Audit</h3>
        <p>Shows submitted bids and rejected attempts, including unused MLE/cap paths.</p>
      </div>
      <div className="offer-audit-table">
        <div className="ledger-head">
          <span>Round</span>
          <span>Team</span>
          <span>Player</span>
          <span>Status</span>
          <span>Offer</span>
          <span>Tool</span>
          <span>Rights</span>
          <span>Reason</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className={cls("ledger-row", `audit-${row.status}`)}>
            <span>{String(row.round + 1)}</span>
            <strong>{row.team}</strong>
            <span>{row.player}</span>
            <span>{row.status}</span>
            <span>{row.offer ? formatMoney(row.offer) : "-"}</span>
            <span>{row.toolName ?? "-"}</span>
            <span>{row.capHoldType ?? row.rightsSource ?? "-"}</span>
            <span>{row.reason}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="mini-empty">No offer audit rows matched this filter.</p>}
      </div>
    </div>
  );
}

function statusRank(status: OfferAudit["status"]): number {
  if (status === "signed" || status === "matched") return 0;
  if (status === "offer") return 1;
  if (status === "declined") return 2;
  return 3;
}

function OfferLogic({ signing }: { signing: FreeAgentSigning }) {
  return (
    <div className="offer-logic">
      <span>Methodology Trace</span>
      <p>{`${signing.player.name}: market ${formatMoney(signing.context.playerMarket)}, legal max ${formatMoney(signing.context.legalMax)}, offered ${formatMoney(signing.annualSalary)}.`}</p>
      {signing.context.selectionMethod && <p>{signing.context.selectionMethod}</p>}
      {signing.context.resolution && <p>{`Rule: ${signing.context.resolution.clearingRule}; final team ${signing.context.resolution.finalTeam ?? signing.toTeam}.`}</p>}
      <p>{`Chosen bid ${formatMoney(signing.context.originalAsk ?? signing.annualSalary)} for ${signing.years} years; runner-up ${signing.context.runnerUpTeam ?? "-"} ${signing.context.runnerUpBid ? formatMoney(signing.context.runnerUpBid) : "-"}.`}</p>
      <p>{`Highest AAV ${signing.context.highestBidTeam ?? "-"} ${signing.context.highestBid ? formatMoney(signing.context.highestBid) : "-"}; money gap ${signing.context.moneyGap ? formatMoney(signing.context.moneyGap) : "-"}; years gap ${signing.context.yearsGap ?? 0}.`}</p>
      {signing.context.highestMoneyLostReason && <p>{signing.context.highestMoneyLostReason}</p>}
      <p>{`Limiter: ${signing.context.limiter}. Priority ${formatNumber(signing.context.priority, 2)}, utility ${formatNumber(signing.context.utility, 2)}.`}</p>
      {signing.context.alternatives.length > 0 && <p>{`Other bidders: ${signing.context.alternatives.join(" / ")}`}</p>}
    </div>
  );
}

function TablePanel({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="table-panel offseason-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>
      <div className="table-wrap offseason-table-wrap">{children}</div>
    </section>
  );
}

function DataEditor({
  players,
  prospects,
  teamCodes,
  selectedPlayer,
  selectedProspect,
  selectedTeam,
  overrides,
  offseasonTruth,
  season,
  onPlayerSelect,
  onProspectSelect,
  onTeamSelect,
  onOverridesChange,
  onImport
}: {
  players: PlayerImpact[];
  prospects: DraftProspect[];
  teamCodes: string[];
  selectedPlayer: PlayerImpact | null;
  selectedProspect: DraftProspect | null;
  selectedTeam: string;
  overrides: SimulatorOverrides;
  offseasonTruth?: OffseasonTruthData;
  season: number;
  onPlayerSelect: (value: string) => void;
  onProspectSelect: (value: string) => void;
  onTeamSelect: (value: string) => void;
  onOverridesChange: (value: SimulatorOverrides) => void;
  onImport: (value: string) => void;
}) {
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(overrides, null, 2));
  const [teamQuery, setTeamQuery] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const [prospectQuery, setProspectQuery] = useState("");
  const selectedPlayerKey = selectedPlayer ? playerKey(selectedPlayer) : "";
  const playerOverride = selectedPlayerKey ? overrides.players[selectedPlayerKey] ?? {} : {};
  const selectedProspectKey = selectedProspect ? prospectKey(selectedProspect) : "";
  const prospectOverride = selectedProspectKey ? overrides.prospects[selectedProspectKey] ?? {} : {};
  const teamOverride = selectedTeam ? overrides.teams[selectedTeam] ?? {} : {};
  const overrideStats = summarizeOverrides(overrides);
  const truthCap = selectedTeam ? truthTeamCap(selectedTeam, season, offseasonTruth) : undefined;
  const conflictRows = (offseasonTruth?.stale_roster_conflicts ?? []).slice(0, 12);
  const filteredTeams = teamCodes.filter((team) => team.includes(teamQuery.trim().toUpperCase())).slice(0, 30);
  const filteredPlayers = players
    .slice()
    .sort((a, b) => a.player_name.localeCompare(b.player_name))
    .filter((player) => !playerQuery.trim() || player.player_name.toLowerCase().includes(playerQuery.trim().toLowerCase()))
    .slice(0, 120);
  const filteredProspects = prospects
    .slice()
    .sort((a, b) => a.rank_in_class - b.rank_in_class)
    .filter((prospect) => !prospectQuery.trim() || prospect.player.toLowerCase().includes(prospectQuery.trim().toLowerCase()))
    .slice(0, 120);

  const updatePlayer = (patch: PlayerOverride) => {
    if (!selectedPlayerKey) return;
    onOverridesChange({ ...overrides, players: { ...overrides.players, [selectedPlayerKey]: { ...playerOverride, ...patch } } });
  };
  const updateProspect = (patch: ProspectOverride) => {
    if (!selectedProspectKey) return;
    onOverridesChange({ ...overrides, prospects: { ...overrides.prospects, [selectedProspectKey]: { ...prospectOverride, ...patch } } });
  };
  const updateTeam = (patch: TeamOverride) => {
    if (!selectedTeam) return;
    onOverridesChange({ ...overrides, teams: { ...overrides.teams, [selectedTeam]: { ...teamOverride, ...patch } } });
  };

  useEffect(() => {
    setJsonDraft(JSON.stringify(overrides, null, 2));
  }, [overrides]);

  return (
    <div className="offseason-data-grid">
      <section className="detail-panel">
        <div className="override-panel-head">
          <h3>{`Team Overrides (${overrideStats.teams})`}</h3>
          <button className="hdr-btn" onClick={() => onOverridesChange({ ...overrides, teams: {} })}>Clear teams</button>
        </div>
        <label>
          <span>Find team</span>
          <input value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="BOS, SAS, OKC" />
        </label>
        <label>
          <span>Team</span>
          <select value={selectedTeam} onChange={(event) => onTeamSelect(event.target.value)}>
            {(filteredTeams.length ? filteredTeams : teamCodes).map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={teamOverride.mode ?? ""} onChange={(event) => updateTeam({ mode: event.target.value as TeamMode || undefined })}>
            <option value="">Model default</option>
            {["rebuilding", "rising", "playoff hopeful", "contender", "tax-sensitive contender"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <label>
          <span>Needs</span>
          <input value={(teamOverride.needs ?? []).join(", ")} onChange={(event) => updateTeam({ needs: parseNeeds(event.target.value) })} placeholder="SHOOT, PASS, RIMPRO" />
        </label>
        <AssumptionInput label="Willingness" value={teamOverride.willingness ?? 0.5} min={0} max={1} step={0.01} onChange={(value) => updateTeam({ willingness: value })} />
      </section>

      <section className="detail-panel">
        <div className="override-panel-head">
          <h3>{`Player Overrides (${overrideStats.players})`}</h3>
          <button className="hdr-btn" onClick={() => onOverridesChange({ ...overrides, players: {} })}>Clear players</button>
        </div>
        <label>
          <span>Find player</span>
          <input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Search player" />
        </label>
        <label>
          <span>Player</span>
          <select value={selectedPlayerKey} onChange={(event) => onPlayerSelect(event.target.value)}>
            {filteredPlayers.map((player) => (
              <option key={playerKey(player)} value={playerKey(player)}>{player.player_name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={playerOverride.status ?? ""} onChange={(event) => updatePlayer({ status: event.target.value as ContractStatus || undefined })}>
            <option value="">Model default</option>
            {["Signed", "UFA", "RFA", "Player Option", "Team Option", "Non-Guaranteed", "Rookie FA"].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <MoneyInput label="Market value" value={playerOverride.marketValue ?? finiteNumber(selectedPlayer?.fa_value, 0)} onChange={(value) => updatePlayer({ marketValue: value })} />
        <label>
          <span>Incumbent</span>
          <input value={playerOverride.incumbentTeam ?? selectedPlayer?.incumbent_team ?? ""} onChange={(event) => updatePlayer({ incumbentTeam: event.target.value.toUpperCase() })} />
        </label>
      </section>

      <section className="detail-panel">
        <div className="override-panel-head">
          <h3>{`Prospect Overrides (${overrideStats.prospects})`}</h3>
          <button className="hdr-btn" onClick={() => onOverridesChange({ ...overrides, prospects: {} })}>Clear prospects</button>
        </div>
        <label>
          <span>Find prospect</span>
          <input value={prospectQuery} onChange={(event) => setProspectQuery(event.target.value)} placeholder="Search prospect" />
        </label>
        <label>
          <span>Prospect</span>
          <select value={selectedProspectKey} onChange={(event) => onProspectSelect(event.target.value)}>
            {filteredProspects.map((prospect) => (
              <option key={prospectKey(prospect)} value={prospectKey(prospect)}>{`${prospect.rank_in_class}. ${prospect.player}`}</option>
            ))}
          </select>
        </label>
        <AssumptionInput label="Rank" value={prospectOverride.rank ?? finiteNumber(selectedProspect?.rank_in_class, 1)} min={1} max={100} step={1} onChange={(value) => updateProspect({ rank: value })} />
        <label>
          <span>Tier</span>
          <input value={prospectOverride.tier ?? selectedProspect?.tier ?? ""} onChange={(event) => updateProspect({ tier: event.target.value })} />
        </label>
      </section>

      <section className="detail-panel data-json-panel">
        <div className="truth-qa-panel">
          <h3>Source QA</h3>
          <p>{offseasonTruth?.source_policy ?? "No offseason truth overlay loaded; simulator is using impact rows and fallback inference."}</p>
          {truthCap && (
            <div className="transaction-facts">
              <Fact label="Active salary" value={formatMoney(truthCap.active_salary)} />
              <Fact label="Holds" value={formatMoney(truthCap.cap_holds)} />
              <Fact label="Max room" value={formatSignedMoney(truthCap.maximum_cap_space)} />
              <Fact label="QA delta" value={truthCap.cap_validation_delta == null ? "-" : formatSignedMoney(truthCap.cap_validation_delta)} />
            </div>
          )}
          <div className="truth-conflict-list">
            {conflictRows.map((row) => <span key={`${row.player}-${row.team}`}>{`${row.player}: ${row.team} stale -> ${row.issue}`}</span>)}
            {conflictRows.length === 0 && <span>No stale roster conflicts reported.</span>}
          </div>
        </div>
        <div className="override-summary-strip">
          <strong>{`${overrideStats.total} active overrides`}</strong>
          <span>{overrideStats.affectedTeams.length ? `Affected teams: ${overrideStats.affectedTeams.join(", ")}` : "No affected teams yet"}</span>
        </div>
        <h3>Override JSON</h3>
        <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
        <div className="offseason-button-row">
          <button className="hdr-btn primary" onClick={() => onImport(jsonDraft)}>Apply JSON</button>
          <button className="hdr-btn" onClick={() => onOverridesChange(defaultOverrides)}>Clear overrides</button>
        </div>
      </section>
    </div>
  );
}

function makeScore(parts: Omit<DecisionScore, "total">): DecisionScore {
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

function optionExplanation(player: SimPlayer, team: TeamState, decision: string, optionSalary: number, score: DecisionScore, optionType: OptionDecision["optionType"]): string {
  const market = formatMoney(player.marketValue);
  const salary = formatMoney(optionSalary);
  if (optionType === "Team Option" || optionType === "Non-Guaranteed") {
    return `${team.team} ${decision === "exercise" ? "keeps" : "declines"} the option because model market is ${market} versus ${salary}, need fit is ${formatNumber(score.needFit, 2)}, and tax pain is ${formatNumber(score.taxPain, 2)}.`;
  }
  return `${player.name} ${decision === "exercise" ? "takes" : "passes on"} the option because market value is ${market} versus ${salary}, adjusted for age/risk and downside protection.`;
}

function draftOrder(teams: TeamState[], draftYear: number | undefined, rng: () => number): OfficialDraftPick[] {
  if (draftYear === 2026) {
    return OFFICIAL_2026_DRAFT_ORDER;
  }
  const sorted = [...teams].sort((a, b) => a.projectedWins - b.projectedWins);
  const lottery = sorted.slice(0, 14)
    .map((team, index) => ({ team, weight: 14 - index + rng() * 2 }))
    .sort((a, b) => b.weight - a.weight)
    .map((row) => row.team);
  return [...lottery, ...sorted.slice(14)].map((team, index) => ({ pick: index + 1, team: team.team, label: team.name }));
}

function prospectToPlayer(prospect: SimProspect, team: string, salary: number, pick: number): SimPlayer {
  return {
    id: `rookie-${prospect.id}-${pick}`,
    name: prospect.name,
    team,
    incumbentTeam: team,
    rightsTeam: team,
    status: "Signed",
    position: prospect.position,
    age: finiteNumber(prospect.original.draft_age, 20),
    salary,
    marketValue: salary,
    rights: "None",
    rightsSource: "rookie scale",
    capHold: 0,
    capHoldType: "Rookie scale signed",
    guaranteedSalary: salary,
    deadCap: 0,
    holdAction: "none",
    rightsValue: 0,
    holdRetainScore: 0,
    scarcityScore: 0,
    expectedMarketMinutes: salary >= 8_000_000 ? 1200 : 600,
    marketMinutesSource: "rookie role estimate",
    waivedDate: null,
    rosterStatusSource: "draft simulation",
    total: finiteNumber(prospect.original.TOTAL_pred, 0),
    score: prospect.score,
    tier: prospect.tier,
    tradeValue: salary * (pick <= 14 ? 2.5 : 1.4),
    upside: prospect.upside,
    declineRisk: prospect.risk * 0.35,
    replaceability: 0.25,
    skills: prospect.skills
  };
}

function movePlayer(from: TeamState, to: TeamState, player: SimPlayer) {
  from.roster = from.roster.filter((candidate) => candidate.id !== player.id);
  player.team = to.team;
  addPlayerToTeamRoster(to, player);
  from.explanations.push(`Traded ${player.name}`);
  to.explanations.push(`Acquired ${player.name}`);
}

function prospectFit(team: TeamState, prospect: SimProspect): number {
  return needFitScore(team, prospect.position, prospect.skills) * 0.7 + timelineProspectFit(team, prospect) * 0.3;
}

function timelineProspectFit(team: TeamState, prospect: SimProspect): number {
  if (team.mode === "rebuilding") return clamp(0.4 + prospect.upside * 0.6, 0, 1);
  if (team.mode === "rising") return clamp(0.3 + prospect.upside * 0.45 + (1 - prospect.risk) * 0.25, 0, 1);
  if (team.mode === "contender" || team.mode === "tax-sensitive contender") return clamp(0.65 - prospect.risk * 0.35 + prospect.score / 250, 0, 1);
  return clamp(0.4 + prospect.upside * 0.25 + (1 - prospect.risk) * 0.25, 0, 1);
}

function needFitScore(team: TeamState, position: string, skills: Record<SkillKey, number>): number {
  const skillNeed = team.needs.length === 0 ? 0.45 : avg(team.needs.map((need) => clamp((skills[need] + 2) / 5, 0, 1)));
  const positionNeed = team.needs.includes("RIMPRO") && position.includes("C") ? 0.16 : team.needs.includes("PASS") && position.includes("G") ? 0.1 : 0;
  return clamp(skillNeed + positionNeed, 0, 1);
}

function timelineFit(team: TeamState, player: SimPlayer): number {
  if (team.mode === "rebuilding") return clamp((28 - player.age) / 10 + player.upside * 0.35, 0, 1);
  if (team.mode === "rising") return clamp((31 - player.age) / 12 + player.upside * 0.25, 0, 1);
  if (team.mode === "contender" || team.mode === "tax-sensitive contender") return clamp(player.score / 100 - player.declineRisk * 0.25, 0, 1);
  return clamp(0.65 - Math.abs(player.age - 27) / 14 + player.score / 260, 0, 1);
}

function urgencyScore(team: TeamState): number {
  if (team.mode === "contender") return 0.95;
  if (team.mode === "tax-sensitive contender") return 0.82;
  if (team.mode === "playoff hopeful") return 0.68;
  if (team.mode === "rising") return 0.52;
  return 0.28;
}

function taxPainScore(team: TeamState, salary: number, assumptions: SimulatorAssumptions): number {
  const afterPayroll = team.payroll + salary;
  const tax = Math.max(0, afterPayroll - assumptions.tax) / assumptions.cap;
  const first = Math.max(0, afterPayroll - assumptions.firstApron) / assumptions.cap;
  const second = Math.max(0, afterPayroll - assumptions.secondApron) / assumptions.cap;
  const modeMultiplier = team.mode === "tax-sensitive contender" ? 1.45 : team.mode === "rebuilding" ? 0.75 : 1;
  return clamp((tax * 0.8 + first * 1.4 + second * 2.3) * modeMultiplier * assumptions.taxSensitivity * 3, 0, 1);
}

function plausibilityFromScore(score: DecisionScore, floor: number): number {
  return clamp(floor + score.total * 0.42 - Math.abs(score.randomness) * 0.08, 0.05, 0.98);
}

function inferNeeds(team: TeamProjection): SkillKey[] {
  return skillKeys
    .map((skill) => ({ skill, value: finiteNumber(team[skill], 0) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((row) => row.skill);
}

function teamMode(team: TeamProjection): TeamMode {
  if (team.projected_wins >= 52 && team.roster_count < 10) return "tax-sensitive contender";
  if (team.projected_wins >= 50) return "contender";
  if (team.projected_wins >= 42) return "playoff hopeful";
  if (team.projected_wins >= 32) return "rising";
  return "rebuilding";
}

function willingnessForMode(mode: TeamMode): number {
  if (mode === "contender") return 0.82;
  if (mode === "tax-sensitive contender") return 0.55;
  if (mode === "playoff hopeful") return 0.66;
  if (mode === "rising") return 0.58;
  return 0.44;
}

function targetRosterCountForMode(mode: TeamMode, standardLimit = STANDARD_ROSTER_LIMIT, minimumCount = MINIMUM_STANDARD_ROSTER): number {
  const target = mode === "tax-sensitive contender" || mode === "rebuilding" || mode === "rising" ? 14 : 15;
  return Math.min(standardLimit, Math.max(minimumCount, target));
}

function pickAssetMultiplier(mode: TeamMode): number {
  if (mode === "rebuilding") return 2.2;
  if (mode === "rising") return 1.6;
  if (mode === "playoff hopeful") return 1.1;
  return 0.75;
}

function skillProfile(player: PlayerImpact): Record<SkillKey, number> {
  return Object.fromEntries(skillKeys.map((skill) => [skill, finiteNumber(player[skill], 0)])) as Record<SkillKey, number>;
}

function prospectSkills(prospect: DraftProspect): Record<SkillKey, number> {
  return Object.fromEntries(skillKeys.map((skill) => [skill, finiteNumber(prospect[`${skill}_pred` as keyof DraftProspect] as number | null | undefined, 0)])) as Record<SkillKey, number>;
}

function upsideScore(player: PlayerImpact): number {
  return clamp((28 - finiteNumber(player.age, 25)) / 14 + (finiteNumber(player.projection_y3, player.total) - finiteNumber(player.total, 0)) / 7 + finiteNumber(player.scalability, 0) / 8, 0, 1);
}

function declineRisk(player: PlayerImpact): number {
  return clamp((finiteNumber(player.age, 25) - 30) / 12 + Math.max(0, finiteNumber(player.total, 0) - finiteNumber(player.projection_y3, player.total)) / 8, 0, 1);
}

function replaceabilityScore(player: PlayerImpact): number {
  return clamp(1 - finiteNumber(player.score, 50) / 115 + (finiteNumber(player.Minutes, 1000) < 900 ? 0.12 : 0), 0, 1);
}

function prospectUpside(prospect: DraftProspect): number {
  return clamp((105 - finiteNumber(prospect.rank_in_class, 60)) / 105 + (22 - finiteNumber(prospect.draft_age, 20)) / 12 + finiteNumber(prospect.TOTAL_pred, 0) / 9, 0, 1);
}

function prospectRisk(prospect: DraftProspect): number {
  const rankVol = Math.abs(finiteNumber(prospect.rank_in_class, 60) - finiteNumber(prospect.pick_proxy, prospect.rank_in_class)) / 35;
  const ageRisk = Math.max(0, finiteNumber(prospect.draft_age, 20) - 21.5) / 5;
  return clamp(rankVol + ageRisk + (finiteNumber(prospect.similarity_score, 90) < 90 ? 0.12 : 0), 0, 1);
}

function capSettingsForSeason(season: number, capTracker?: CapTrackerData): SimulatorAssumptions {
  const trackerSeason = capTracker?.seasons.find((row) => row.year === season);
  const settings = trackerSeason
    ? { cap: trackerSeason.salary_cap, tax: trackerSeason.tax_level, firstApron: trackerSeason.first_apron, secondApron: trackerSeason.second_apron }
    : CAP_SETTINGS_BY_SEASON[season] ?? CAP_SETTINGS_BY_SEASON[2027];
  return {
    seed: 2701,
    variance: 0.42,
    draftFitWeight: 0.22,
    marketAggression: 0.54,
    tradeAggression: 0.34,
    taxSensitivity: 0.56,
    runCount: 50,
    ...settings
  };
}

export function capYearForSeason(season: number, capTracker?: CapTrackerData): number {
  const years = (capTracker?.seasons ?? []).map((row) => row.year).filter(Number.isFinite).sort((a, b) => a - b);
  if (!years.length) return season + 1;
  if (years.includes(season)) return season;
  if (years.includes(season + 1)) return season + 1;
  return years[years.length - 1] ?? season + 1;
}

function buildCapTrackerIndex(capTracker: CapTrackerData | undefined, season: number, capYear: number): CapTrackerIndex {
  const index: CapTrackerIndex = {
    capYear,
    season: capTracker?.seasons.find((row) => row.year === capYear),
    teams: new Map((capTracker?.team_seasons ?? []).filter((row) => row.year === capYear).map((row) => [row.team, row])),
    exceptionsByTeam: groupCapTrackerExceptions(capTracker?.exceptions ?? [], capYear),
    cellsByNbaId: new Map(),
    cellsByNameTeam: new Map(),
    draftPickPlaceholdersByTeam: new Map()
  };
  (capTracker?.contracts ?? []).forEach((row) => {
    const cell = row.cells.find((item) => item.year === capYear);
    if (!cell || cell.kind === "empty") return;
    const matched = { row, cell };
    if (row.nba_id) index.cellsByNbaId.set(`${season}-${row.nba_id}`, matched);
    index.cellsByNameTeam.set(`${normalizeNameKey(row.player_name)}|${cleanTeam(row.team)}`, matched);
    if (cell.kind === "draft_pick") {
      const team = cleanTeam(row.team);
      const prior = index.draftPickPlaceholdersByTeam.get(team) ?? { count: 0, salary: 0 };
      index.draftPickPlaceholdersByTeam.set(team, { count: prior.count + 1, salary: prior.salary + cell.amount });
    }
  });
  return index;
}

function groupCapTrackerExceptions(rows: CapTrackerException[], capYear: number): Map<string, CapTrackerException[]> {
  const byTeam = new Map<string, CapTrackerException[]>();
  rows
    .filter((row) => row.year === capYear)
    .forEach((row) => {
      const team = cleanTeam(row.team);
      const list = byTeam.get(team) ?? [];
      list.push(row);
      byTeam.set(team, list);
    });
  return byTeam;
}

function capTrackerCellForPlayer(player: PlayerImpact, capIndex?: CapTrackerIndex): CapTrackerMatchedCell | undefined {
  if (!capIndex) return undefined;
  const byId = capIndex.cellsByNbaId.get(`${player.year}-${player.nba_id}`);
  if (byId) return byId;
  const teams = [
    player.current_roster_team,
    player.rights_team,
    player.incumbent_team,
    player.team
  ].map(cleanTeam);
  const name = normalizeNameKey(player.player_name);
  for (const team of teams) {
    const row = capIndex.cellsByNameTeam.get(`${name}|${team}`);
    if (row) return row;
  }
  return undefined;
}

function contractStatusFromCapCell(cell: CapTrackerContractCell | undefined): ContractStatus | undefined {
  if (!cell || cell.kind === "empty") return undefined;
  if (cell.kind === "guaranteed" || cell.kind === "partial_guarantee" || cell.kind === "draft_pick") return "Signed";
  if (cell.kind === "player_option") return "Player Option";
  if (cell.kind === "team_option") return "Team Option";
  if (cell.kind === "non_guaranteed") return "Non-Guaranteed";
  if (cell.kind === "cap_hold") {
    const status = String(cell.status ?? "").toUpperCase();
    if (status.includes("RFA")) return "RFA";
    return "UFA";
  }
  return undefined;
}

function inferDraftYear(prospects: DraftProspect[], season: number): number {
  const years = Array.from(new Set(prospects.map((prospect) => prospect.draft_year))).sort((a, b) => b - a);
  return years.find((year) => year <= season) ?? years[0] ?? season;
}

function normalizeStatus(status: string | null | undefined): ContractStatus {
  if (status === "RFA") return "RFA";
  if (status === "UFA") return "UFA";
  if (status === "Player Option") return "Player Option";
  if (status === "Team Option") return "Team Option";
  if (status === "Non-Guaranteed" || status === "Non Guaranteed" || status === "NG") return "Non-Guaranteed";
  if (status === "Rookie FA") return "Rookie FA";
  return "Signed";
}

function rightsForPlayer(player: PlayerImpact, status: ContractStatus): BirdRight {
  if (status === "Signed" || status === "Rookie FA") return "None";
  const yoe = finiteNumber(player.yoe, 0);
  if (status === "RFA" || yoe >= 3) return "Bird";
  if (yoe >= 2) return "Early Bird";
  return "Non-Bird";
}

function normalizeBirdRight(value: string | null | undefined): BirdRight {
  if (value === "Bird" || value === "Early Bird" || value === "Non-Bird") return value;
  return "None";
}

function playerTruth(player: PlayerImpact, truthData?: OffseasonTruthData): OffseasonPlayerTruth | undefined {
  return truthData?.players[playerKey(player)];
}

function truthTeamCap(team: string, season: number, truthData?: OffseasonTruthData): OffseasonTeamCapSheet | undefined {
  return truthData?.team_caps.find((row) => row.year === season && row.team === team);
}

function consensusRankForProspect(prospect: DraftProspect): number {
  const pickProxy = finitePositive(prospect.pick_proxy);
  if (pickProxy) return pickProxy;
  const mockRank = finitePositive(prospect.scv_draft);
  const baseRank = finitePositive(prospect.base_rank_in_class);
  const modelRank = finitePositive(prospect.rank_in_class) ?? 99;
  if (mockRank && baseRank) return mockRank <= 5 ? Math.min(baseRank, modelRank) : Math.round(baseRank * 0.7 + modelRank * 0.3);
  return baseRank ?? modelRank;
}

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function tierFromScore(score: number): string {
  if (score >= 97) return "Superstar";
  if (score >= 90) return "Star";
  if (score >= 80) return "Elite Starter";
  if (score >= 70) return "Starter";
  if (score >= 55) return "Bench";
  return "Project";
}

function tierRank(tier: string): number {
  const order = ["MVP", "Superstar", "Star", "Elite Starter", "Starter", "Fringe Starter", "Strong Bench", "Bench", "Deep Bench", "Project", "Out"];
  const index = order.indexOf(tier);
  return index === -1 ? order.length : index;
}

function rookieScaleSalary(pick: number, cap: number): number {
  if (pick <= 4) return cap * (0.055 - pick * 0.0025);
  if (pick <= 14) return cap * (0.038 - pick * 0.00115);
  if (pick <= 30) return cap * 0.012;
  return cap * 0.006;
}

function minimumSalary(player: SimPlayer): number {
  return player.age > 30 ? 2_500_000 : 1_500_000;
}

function playerKey(player: PlayerImpact): string {
  return `${player.year}-${player.nba_id}-${player.player_name}`;
}

function prospectKey(prospect: DraftProspect): string {
  return `${prospect.draft_year}-${prospect.player}`;
}

function cleanTeam(team: string | null | undefined): string {
  const value = String(team ?? "").trim().toUpperCase();
  return value || "FA";
}

function normalizeNameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readStoredString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function readStoredOffseasonTab(): OffseasonTab {
  const value = readStoredString(OFFSEASON_TAB_STORAGE_KEY, "dashboard");
  return isOffseasonTab(value) ? value : "dashboard";
}

function isOffseasonTab(value: string): value is OffseasonTab {
  return ["dashboard", "warRoom", "league", "draft", "options", "freeAgency", "trades", "teams", "markets", "overrides"].includes(value);
}

function parseNeeds(value: string): SkillKey[] {
  const allowed = new Set(skillKeys);
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is SkillKey => allowed.has(item as SkillKey));
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

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function centeredRandom(rng: () => number, variance: number): number {
  return (rng() - 0.5) * 2 * variance;
}

function weightedChoice<T>(items: T[], weight: (item: T) => number, rng: () => number): T {
  const weights = items.map((item) => Math.max(0.0001, weight(item)));
  const total = sum(weights);
  let ticket = rng() * total;
  for (let index = 0; index < items.length; index += 1) {
    ticket -= weights[index];
    if (ticket <= 0) return items[index];
  }
  return items[items.length - 1];
}

function mulberry32(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function runToCsv(run: SimulationRun): string {
  const rows = [
    ["section", "team", "player", "detail", "salary", "plausibility"],
    ...run.draft.map((item) => ["draft", item.team, item.prospect.name, `Pick ${item.pick}: ${item.pickLabel}`, "", String(item.plausibility)]),
    ...run.options.map((item) => ["option", item.team, item.player.name, item.decision, String(item.player.salary), String(item.plausibility)]),
    ...run.freeAgency.map((item) => ["free_agency", item.toTeam, item.player.name, `${item.years} years via ${item.tool}`, String(item.annualSalary), String(item.plausibility)]),
    ...run.trades.map((item) => ["trade", item.teamB, item.player.name, `from ${item.teamA}`, String(item.salary), String(item.plausibility)]),
    ...run.marketBids.map((item) => [
      "market_bid",
      item.team,
      item.player,
      `${item.tier}; ${item.tool}; priority ${formatNumber(item.teamPriority, 2)}; player ${formatNumber(item.playerUtility, 2)}; limiter ${item.limiter}`,
      String(item.submittedAav),
      String(item.teamUtility)
    ]),
    ...run.marketResolutions.map((item) => [
      "market_resolution",
      item.finalTeam ?? item.winnerTeam ?? "",
      item.player,
      `${item.clearingRule}; offer sheet ${item.offerSheetTeam ?? ""}; highest ${item.highestRawBidTeam ?? ""}; unresolved ${item.unresolvedReason ?? ""}`,
      String(item.finalAav ?? item.highestRawBid ?? ""),
      item.rfaMatchResult ?? ""
    ]),
    ...run.marketLedger.map((item) => [
      "market_ledger",
      item.team,
      item.player,
      `${item.status}; ${item.reason}; ${item.tool ?? ""}`,
      String(item.offer ?? ""),
      String(item.teamPriority ?? item.teamUtility ?? item.playerUtility ?? "")
    ]),
    ...run.teams.map((item) => ["team", item.team, "", item.mode, String(item.payroll), ""])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
