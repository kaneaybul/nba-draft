import { ProjectionHistory } from "./PreseasonArchive";
import { Component, type CSSProperties, type ChangeEvent, type ErrorInfo, lazy, type MouseEvent, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { latestManifestSeason, loadAppData, loadDataForView, loadNewerAppData, loadPlayerCareerHistory, manifestSeasons } from "./data";
import { isLocalRefreshEnabled, isPublicReadOnlyMode } from "./runtime";
import { InjuryOutlookWorkspace, PlayerInjuryNote, injuryForPlayer } from "./InjuryOutlook";
import {
  capTrackerSeasonForYear,
  evaluateTradeMachine,
  pickTradeMachineAsset,
  playerTradeMachineAsset,
  tradeSalaryForPlayer,
  tradeTeamContextFromCapTracker,
  type TradeMachineAsset,
  type TradeMachineResult,
  type TradeMachineRuleCheck,
  type TradeMachineSide,
  type TradeMachineSides,
  type TradeMachineStatus,
  type TradeMachineTeamContext,
  type TradeMachineTeamResult,
  type TradeMachineTeamValueBalance,
  type TradeMachineValueVerdict
} from "./tradeMachine";
import {
  SAVED_SCENARIO_FILTERS,
  SAVED_SCENARIO_SORTS,
  buildSavedTradeScenarioExportPayload,
  clearVisibleSavedTradeScenarios,
  DEFAULT_SAVED_SCENARIO_FILTER,
  DEFAULT_SAVED_SCENARIO_SORT,
  duplicateSavedTradeScenario,
  hydrateTradeSide,
  mergeImportedSavedTradeScenarioResult,
  normalizeSavedTradeScenarios,
  retainSavedTradeScenarios,
  restoreSavedTradeScenarios,
  savedTradeScenarioFilterCounts,
  savedTradeScenarioMatchesFilter,
  savedTradeScenarioMatchesQuery,
  savedTradeScenarioCopyName,
  savedTradeScenarioSides,
  savedTradeScenarioViewSummary,
  savedTradeScenarioViewIsDefault,
  sortSavedTradeScenarios,
  upsertSavedTradeScenario,
  type SavedScenarioFilter,
  type SavedScenarioSort,
  type SavedTradeScenario,
  type SavedTradeScenarioSnapshot,
  type TradeAsset,
  type TradeCalendarState,
  type TradeSideState
} from "./tradeScenarios";
import type { AppData, CapTrackerContractRow, DraftProspect, DraftSimilarityComp as DraftSimilarityCompRow, DraftTrackerProspectScore, PickAsset, PlayerCareerHistoryRow, PlayerImpact, TeamLineupRow, TeamProjection, TeamScheduleGame } from "./types";
import { clamp, cls, formatMoney, formatNumber, formatSignedMoney } from "./utils";

const CapTrackerWorkspace = lazy(() => import("./CapTracker").then((module) => ({ default: module.CapTrackerWorkspace })));
const OffseasonSimulatorWorkspace = lazy(() => import("./OffseasonSimulator").then((module) => ({ default: module.OffseasonSimulatorWorkspace })));

type View = "impact" | "teams" | "startingLineups" | "tradeRecs" | "trade" | "offseason" | "capTracker" | "draft" | "draftElo" | "lineups" | "tracker" | "injuries";
type SkillKey = "FTD" | "OREB" | "PASS" | "RIM" | "SHOOT" | "DPM" | "DREB" | "RIMPRO" | "SWITCH";
type SkillAggregateSortKey = "skill_total" | "skill_off" | "skill_def";
type ImpactSkillSortKey = SkillKey | SkillAggregateSortKey;
type SortKey =
  | "player_name"
  | "team"
  | "position"
  | "age"
  | "yoe"
  | "score"
  | "score_delta"
  | "tier"
  | "total"
  | "offense"
  | "defense"
  | "value"
  | "value_add"
  | "contract"
  | "contract_status"
  | "trade_value"
  | "fa_value"
  | "scalability"
  | "future_value_4y"
  | "future_scale_4y"
  | "skill_total"
  | "skill_off"
  | "skill_def"
  | "Minutes"
  | SkillKey;
type SortDirection = "asc" | "desc";
type FilterKey = SortKey;
type DraftSortKey =
  | "rank_in_class"
  | "player"
  | "position"
  | "tier"
  | "college"
  | "prediction_pool"
  | "score"
  | "OFF_pred"
  | "DEF_pred"
  | "TOTAL_pred"
  | "timin"
  | "draft_age"
  | "scv_draft"
  | "similarity_score"
  | `${SkillKey}_pred`;
type DraftFilterKey = DraftSortKey;
type TeamSortKey =
  | "projected_wins"
  | "win_pct"
  | "adjusted_total"
  | "offense"
  | "defense"
  | "raw_offense"
  | "raw_defense"
  | "minutes"
  | SkillKey;
type TeamContributorSortKey = "player_name" | "share" | "offense_contribution" | "defense_contribution" | "total_contribution" | "Minutes";
type ConferenceFilter = "All" | "East" | "West";
type TeamProjectionScenario = "base" | "guaranteed" | "open_market";
type DraftYearSelection = number | "All";
type FilterFieldType = "number" | "text";
type FilterOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte" | "between";
type FaStatusFilter = "All" | "Signed" | "UFA" | "RFA" | "Rookie" | "PO" | "TO";
type FilterRule = {
  id: string;
  key: FilterKey | DraftFilterKey;
  operator: FilterOperator;
  value: string;
  valueTo?: string;
};

const viewLabels: Record<View, string> = {
  impact: "Player Impact",
  teams: "Team Projections",
  injuries: "Injury Outlook",
  startingLineups: "Starting Lineups",
  tradeRecs: "Trade Recs",
  trade: "Trade Sandbox",
  offseason: "Offseason Sim",
  capTracker: "Cap Tracker",
  draft: "Draft Board",
  draftElo: "Draft Elo",
  lineups: "Lineup Synergy",
  tracker: "Draft Tracker"
};

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; viewLabel: string; onReset: () => void },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Workspace render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.message) return this.props.children;
    return <WorkspaceErrorPanel title={`${this.props.viewLabel} did not load`} detail={this.state.message} onReset={this.props.onReset} />;
  }
}
type LineupSide = "a" | "b";
type LineupSlot = PlayerImpact | null;
type LineupSkill = {
  key: SkillKey | "ID";
  label: string;
  source: SkillKey | SkillKey[];
};
type LineupSlotRole = "guard" | "wing" | "forward" | "big";
type LineupPositionShares = Record<"pg" | "sg" | "sf" | "pf" | "c", number>;
type LineupSimulationTemplate = {
  roles: LineupSlotRole[];
  weight: number;
};
type LineupRolePool = {
  candidates: Array<{ player: PlayerImpact; cumulative: number }>;
  totalWeight: number;
};
type LineupSummary = {
  slots: LineupSlot[];
  players: PlayerImpact[];
  offense: number;
  defense: number;
  net: number;
  score: number;
  gaps: number;
  spikes: number;
  skillAverages: Record<string, number>;
  skillTotals: Record<string, number>;
};
type LineupBenchmark = {
  values: number[];
  average: number;
  simulatedValues: number[];
  simulatedAverage: number;
};
type LineupBenchmarks = Map<number, Record<string, LineupBenchmark>>;
type LineupSuggestion = {
  player: PlayerImpact;
  summary: LineupSummary;
  score: number;
  netDelta: number;
  scoreDelta: number;
  gapDelta: number;
  newGaps: LineupSkill[];
  improvedGaps: LineupSkill[];
  reasons: string[];
};
type CareerChartPoint = {
  label: string;
  year: number;
  value: number;
  valueAdd?: number | null;
  kind: "actual" | "projection";
  isCurrent?: boolean;
};
type TradePickKind = "first" | "second" | "swap";
type TradePickBuilderState = {
  assetType: TradePickKind;
  draftYear: number;
  protectionCutoff: number;
  counterpartyTeam?: string;
};
type PickDistributionPoint = { pick: number; probability: number };
type TradePickContext = {
  firstRound: PickDistributionPoint[];
  secondRound: PickDistributionPoint[];
  slotValues: Map<number, number>;
  yearScale: Map<number, number>;
};
type TradeVerdict = "Accepted" | "Maybe" | "Declined";
type TradeImpactSummary = {
  offense: number;
  defense: number;
  total: number;
  outgoingSalary: number;
};
type TradeRouteSummary = {
  team: string;
  sends: TradeAsset[];
  receives: TradeAsset[];
  outgoingValue: number;
  incomingValue: number;
  netValue: number;
  outgoingSalary: number;
  incomingSalary: number;
  netSalary: number;
  outgoingImpact: TradeImpactSummary;
  incomingImpact: TradeImpactSummary;
  netImpact: TradeImpactSummary;
  modelBalance?: TradeMachineTeamValueBalance | null;
  cbaResult?: TradeMachineTeamResult | null;
};
type TradeRouteLane = {
  fromTeam: string;
  toTeam: string;
  assets: TradeAsset[];
  value: number;
  salary: number;
  impact: TradeImpactSummary;
};
type TradeReviewItem = {
  severity: "fail" | "warn";
  label: string;
  detail: string;
  hint?: string;
  source: "Value" | "CBA" | "Setup";
};
type TradePanelTab = "review" | "suggestions";
type TradeSuggestion = {
  id: string;
  title: string;
  left: TradeSideState;
  right: TradeSideState;
  score: number;
  verdict: TradeVerdict;
  cbaStatus: TradeMachineStatus | "missing";
  valueDiff: number;
  scaleDiff: number;
  fitLift: number;
  timelineFit: number;
  reasons: string[];
};
type TradeRecommendation = TradeSuggestion & {
  focusTeam: string;
  opponentTeam: string;
  focusSends: TradeAsset[];
  focusReceives: TradeAsset[];
  opponentSends: TradeAsset[];
  opponentReceives: TradeAsset[];
  focusInterest: number;
  opponentInterest: number;
  mutualScore: number;
  netImpact: number;
  packageType: string;
};
type TradeSuggestionBuildOptions = {
  limit?: number;
  rosterLimit?: number;
  includePackages?: boolean;
  minScore?: number;
};
type DraftEloTab = "compare" | "results";
type DraftEloResponse = {
  id: string;
  draftYear: number;
  createdAt: string;
  playerAKey: string;
  playerBKey: string;
  winnerKey: string;
};
type DraftEloStorageMode = "loading" | "indexeddb" | "localstorage";
type DraftSimilarityDimension = "total" | "off" | "def";
type DraftEloStanding = {
  key: string;
  prospect: DraftProspect;
  rating: number;
  wins: number;
  losses: number;
  matches: number;
  lastPicked: string | null;
};

const skillKeys: SkillKey[] = ["FTD", "PASS", "SHOOT", "RIM", "OREB", "DREB", "SWITCH", "DPM", "RIMPRO"];
const emptyLineup = () => Array.from({ length: 5 }, () => "");
const lineupSkills: LineupSkill[] = [
  { key: "FTD", label: "FTD", source: "FTD" },
  { key: "SHOOT", label: "SHOOT", source: "SHOOT" },
  { key: "PASS", label: "PASS", source: "PASS" },
  { key: "RIM", label: "RIM", source: "RIM" },
  { key: "OREB", label: "OREB", source: "OREB" },
  { key: "SWITCH", label: "SWITCH", source: "SWITCH" },
  { key: "DPM", label: "DPM", source: "DPM" },
  { key: "DREB", label: "DREB", source: "DREB" },
  { key: "RIMPRO", label: "RIMPRO", source: "RIMPRO" }
];
const LINEUP_SIMULATION_COUNT = 9000;
const LINEUP_SIMULATION_SEED = 20260709;
const LINEUP_SIMULATED_BLEND_WEIGHT = 0.75;
const LINEUP_GAP_THRESHOLD = 0.5;
const LINEUP_SIMULATION_TEMPLATES: LineupSimulationTemplate[] = [
  { roles: ["guard", "guard", "wing", "forward", "big"], weight: 9 },
  { roles: ["guard", "guard", "wing", "wing", "big"], weight: 6 },
  { roles: ["guard", "wing", "wing", "forward", "big"], weight: 5 },
  { roles: ["guard", "wing", "forward", "forward", "big"], weight: 3 },
  { roles: ["guard", "guard", "forward", "big", "big"], weight: 1.5 },
  { roles: ["guard", "wing", "forward", "big", "big"], weight: 1 }
];
const LINEUP_SIMULATION_ROLES: LineupSlotRole[] = ["guard", "wing", "forward", "big"];
const LINEUP_SUGGESTIONS_PER_PAGE = 8;
const LINEUP_SUGGESTION_PAGE_COUNT = 6;
const LINEUP_MAX_SUGGESTIONS = LINEUP_SUGGESTIONS_PER_PAGE * LINEUP_SUGGESTION_PAGE_COUNT;
const MAX_VISIBLE_TABLE_ROWS = 500;
const DRAFT_ELO_INITIAL_RATING = 1500;
const DRAFT_ELO_K = 32;
const DRAFT_ELO_DB_NAME = "nba-impact-lab-draft-elo";
const DRAFT_ELO_DB_VERSION = 1;
const DRAFT_ELO_STORE = "responses";
const DRAFT_ELO_LOCAL_STORAGE_KEY = "draftElo:responses:v1";
const impactTierOrder = ["MVP", "Superstar", "Star", "Elite Starter", "Starter", "Fringe Starter", "Strong Bench", "Bench", "Deep Bench", "Project", "Out", "DNQ"];
const skillLabels: Record<SkillKey, string> = {
  FTD: "Free Throws",
  PASS: "Passing",
  SHOOT: "Shooting",
  RIM: "Rim Pressure",
  OREB: "Off. Rebounding",
  DREB: "Def. Rebounding",
  SWITCH: "Switchability",
  DPM: "Def. Playmaking",
  RIMPRO: "Rim Protection"
};
const skillAggregateSorts: Array<{ key: SkillAggregateSortKey; label: string; title: string }> = [
  { key: "skill_total", label: "Total", title: "skill model Total" },
  { key: "skill_off", label: "Off", title: "skill model Off" },
  { key: "skill_def", label: "Def", title: "skill model Def" }
];
const draftSkillAggregateSorts: Array<{ key: DraftSortKey; label: string; title: string }> = [
  { key: "TOTAL_pred", label: "Total", title: "projected Total" },
  { key: "OFF_pred", label: "Off", title: "projected Off" },
  { key: "DEF_pred", label: "Def", title: "projected Def" }
];
const NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/260x190";
const BRENDAN_MODEL_BOARD = "Brendan Model";
const BRENDAN_BASE_BOARD = "Brendan Base";
const filterFields: Array<{ key: FilterKey; label: string; type: FilterFieldType }> = [
  { key: "player_name", label: "Player", type: "text" },
  { key: "team", label: "Team", type: "text" },
  { key: "position", label: "Position", type: "text" },
  { key: "age", label: "Age", type: "number" },
  { key: "yoe", label: "YOE", type: "number" },
  { key: "Minutes", label: "Minutes", type: "number" },
  { key: "offense", label: "Offense", type: "number" },
  { key: "defense", label: "Defense", type: "number" },
  { key: "total", label: "Total", type: "number" },
  { key: "score", label: "Score", type: "number" },
  { key: "score_delta", label: "Delta", type: "number" },
  { key: "value", label: "Raw Value", type: "number" },
  { key: "contract", label: "Salary", type: "number" },
  { key: "contract_status", label: "FA Status", type: "text" },
  { key: "value_add", label: "Szn VA", type: "number" },
  { key: "fa_value", label: "FA Value", type: "number" },
  { key: "scalability", label: "Scale", type: "number" },
  { key: "future_value_4y", label: "4Y Value", type: "number" },
  { key: "future_scale_4y", label: "4Y Scale", type: "number" },
  { key: "skill_total", label: "Skill Total", type: "number" },
  { key: "skill_off", label: "Skill Off", type: "number" },
  { key: "skill_def", label: "Skill Def", type: "number" },
  ...skillKeys.map((key) => ({ key, label: key, type: "number" as const }))
];
const impactFilterKeys = new Set<FilterKey>(filterFields.map((field) => field.key));
function isImpactFilterKey(key: FilterRule["key"]): key is FilterKey {
  return impactFilterKeys.has(key as FilterKey);
}
const numericOperators: Array<{ value: FilterOperator; label: string }> = [
  { value: "gte", label: "at least" },
  { value: "lte", label: "at most" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "between", label: "between" },
  { value: "equals", label: "equals" }
];
const textOperators: Array<{ value: FilterOperator; label: string }> = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "is exactly" }
];
const draftFilterFields: Array<{ key: DraftFilterKey; label: string; type: FilterFieldType }> = [
  { key: "player", label: "Player", type: "text" },
  { key: "position", label: "Position", type: "text" },
  { key: "tier", label: "Tier", type: "text" },
  { key: "college", label: "College", type: "text" },
  { key: "prediction_pool", label: "Pool", type: "text" },
  { key: "rank_in_class", label: "Rank", type: "number" },
  { key: "score", label: "Score", type: "number" },
  { key: "OFF_pred", label: "Off", type: "number" },
  { key: "DEF_pred", label: "Def", type: "number" },
  { key: "TOTAL_pred", label: "Total", type: "number" },
  { key: "timin", label: "TIMIN", type: "number" },
  { key: "draft_age", label: "Age", type: "number" },
  { key: "scv_draft", label: "Model", type: "number" },
  { key: "similarity_score", label: "Comp Score", type: "number" },
  ...skillKeys.map((key) => ({ key: `${key}_pred` as DraftFilterKey, label: key, type: "number" as const }))
];

function useSessionState<T>(key: string, initialValue: T, deserialize?: (value: unknown) => T): [T, (value: T | ((current: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = window.sessionStorage.getItem(key);
      if (!stored) return initialValue;
      const parsed = JSON.parse(stored) as unknown;
      return deserialize ? deserialize(parsed) : parsed as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Session persistence is a convenience; the app should keep working if storage is unavailable.
    }
  }, [key, state]);

  return [state, setState];
}

function useDraftEloResponses() {
  const [responses, setResponses] = useState<DraftEloResponse[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageMode, setStorageMode] = useState<DraftEloStorageMode>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDraftEloResponses()
      .then((result) => {
        if (!active) return;
        setResponses(result.responses);
        setStorageMode(result.mode);
        setStorageError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResponses([]);
        setStorageMode("localstorage");
        setStorageError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveDraftEloResponses(responses, storageMode)
      .then((mode) => {
        setStorageMode(mode);
        setStorageError(null);
      })
      .catch((error: unknown) => {
        setStorageError(error instanceof Error ? error.message : String(error));
      });
  }, [loaded, responses, storageMode]);

  return { responses, setResponses, loaded, storageMode, storageError };
}

async function loadDraftEloResponses(): Promise<{ responses: DraftEloResponse[]; mode: DraftEloStorageMode }> {
  if (typeof window === "undefined") return { responses: [], mode: "localstorage" };

  if ("indexedDB" in window) {
    try {
      const db = await openDraftEloDb();
      const indexedResponses = await readDraftEloStore(db);
      db.close();
      const localResponses = loadDraftEloLocalStorage();
      const responses = indexedResponses.length > 0 ? indexedResponses : localResponses;
      if (indexedResponses.length === 0 && localResponses.length > 0) {
        await saveDraftEloIndexedDb(localResponses);
      }
      return { responses, mode: "indexeddb" };
    } catch {
      return { responses: loadDraftEloLocalStorage(), mode: "localstorage" };
    }
  }

  return { responses: loadDraftEloLocalStorage(), mode: "localstorage" };
}

async function saveDraftEloResponses(responses: DraftEloResponse[], preferredMode: DraftEloStorageMode): Promise<DraftEloStorageMode> {
  const normalized = normalizeDraftEloResponses(responses);
  if (typeof window === "undefined") return "localstorage";

  if (preferredMode !== "localstorage" && "indexedDB" in window) {
    try {
      await saveDraftEloIndexedDb(normalized);
      saveDraftEloLocalStorage(normalized);
      return "indexeddb";
    } catch {
      saveDraftEloLocalStorage(normalized);
      return "localstorage";
    }
  }

  saveDraftEloLocalStorage(normalized);
  return "localstorage";
}

function openDraftEloDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DRAFT_ELO_DB_NAME, DRAFT_ELO_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open Draft Elo storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_ELO_STORE)) {
        db.createObjectStore(DRAFT_ELO_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function readDraftEloStore(db: IDBDatabase): Promise<DraftEloResponse[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_ELO_STORE, "readonly");
    const store = transaction.objectStore(DRAFT_ELO_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error("Could not read Draft Elo responses."));
    request.onsuccess = () => resolve(normalizeDraftEloResponses(request.result));
  });
}

async function saveDraftEloIndexedDb(responses: DraftEloResponse[]): Promise<void> {
  const db = await openDraftEloDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DRAFT_ELO_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_ELO_STORE);
    store.clear();
    responses.forEach((response) => store.put(response));
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save Draft Elo responses."));
    transaction.oncomplete = () => resolve();
  }).finally(() => db.close());
}

function loadDraftEloLocalStorage(): DraftEloResponse[] {
  try {
    const raw = window.localStorage.getItem(DRAFT_ELO_LOCAL_STORAGE_KEY);
    return normalizeDraftEloResponses(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function saveDraftEloLocalStorage(responses: DraftEloResponse[]): void {
  window.localStorage.setItem(DRAFT_ELO_LOCAL_STORAGE_KEY, JSON.stringify(normalizeDraftEloResponses(responses)));
}

function normalizeDraftEloResponses(value: unknown): DraftEloResponse[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isDraftEloResponse)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function isDraftEloResponse(value: unknown): value is DraftEloResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.draftYear === "number" &&
    Number.isFinite(row.draftYear) &&
    typeof row.createdAt === "string" &&
    typeof row.playerAKey === "string" &&
    typeof row.playerBKey === "string" &&
    typeof row.winnerKey === "string" &&
    (row.winnerKey === row.playerAKey || row.winnerKey === row.playerBKey)
  );
}

function latestPlayerSeason(players: PlayerImpact[]): number | null {
  const years = players.map((player) => player.year).filter(Number.isFinite);
  return years.length > 0 ? Math.max(...years) : null;
}

function WorkspaceErrorPanel({ title, detail, onReset }: { title: string; detail: string; onReset: () => void }) {
  return (
    <main className="workspace workspace-error-shell">
      <section className="table-panel workspace-error-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>{title}</h2>
            <p>{detail}</p>
          </div>
          <button className="hdr-btn primary" onClick={onReset}>Back to Player Impact</button>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [view, setView] = useState<View>("impact");
  const [season, setSeason] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingViewData, setLoadingViewData] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const localRefreshEnabled = isLocalRefreshEnabled();

  useEffect(() => {
    loadAppData()
      .then((loaded) => {
        setData(loaded);
        setSeason(latestManifestSeason(loaded.manifest, loaded.players));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!data || season === null) return;
    let active = true;
    setViewError(null);
    setLoadingViewData(true);
    loadDataForView(data, view, season)
      .then((loaded) => {
        if (!active) return;
        if (loaded !== data) setData(loaded);
        setError(null);
        setViewError(null);
      })
      .catch((err: unknown) => {
        if (active) setViewError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoadingViewData(false);
      });
    return () => {
      active = false;
    };
  }, [data, season, view]);

  useEffect(() => {
    if (!data || refreshing) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (document.visibilityState === "hidden" || checking) return;
      checking = true;
      try {
        const loaded = await loadNewerAppData(data.manifest);
        if (!active || !loaded) return;
        setData(loaded);
        const seasons = manifestSeasons(loaded.manifest, loaded.players);
        setSeason((current) => current !== null && seasons.includes(current) ? current : seasons[0] ?? null);
        setRefreshNote("Updated to latest published data");
      } catch {
        // Keep the working snapshot during a transient connection failure.
      } finally { checking = false; }
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [data, refreshing]);

  const reloadData = async () => {
    setRefreshing(true);
    setRefreshNote("Reloading exported data");
    try {
      const loaded = await loadAppData(String(Date.now()));
      setData(loaded);
      setError(null);
      const seasons = manifestSeasons(loaded.manifest, loaded.players);
      const latest = seasons[0] ?? latestPlayerSeason(loaded.players);
      setSeason((current) => (current !== null && seasons.includes(current) ? current : latest));
      setRefreshNote("Data reloaded");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const refreshBackend = async () => {
    if (!localRefreshEnabled) return;
    setRefreshing(true);
    setRefreshNote("Starting refresh");
    try {
      const response = await fetch("http://127.0.0.1:8787/refresh", { method: "POST" });
      if (!response.ok && response.status !== 409) {
        throw new Error(`Refresh server returned ${response.status}`);
      }
      setRefreshNote(response.status === 409 ? "Refresh already running" : "Refresh running in local server");
    } catch {
      await reloadData();
      setRefreshNote("Local refresh server not running; exported data reloaded");
    } finally {
      setRefreshing(false);
    }
  };

  if (error) {
    return (
      <main className="fatal">
        <h1>Data export needed</h1>
        <p>{error}</p>
        <code>Rscript script/frontend/export_frontend_data.R</code>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading">
        <img className="mark" src="/logo.svg" alt="" aria-hidden="true" />
        <p>Loading impact lab</p>
      </main>
    );
  }

  const seasons = manifestSeasons(data.manifest, data.players);

  if (season === null) {
    return (
      <main className="fatal">
        <h1>No player seasons</h1>
        <p>The frontend data loaded, but `impact_players.json` has no season rows.</p>
        <code>Rscript script/frontend/export_frontend_data.R</code>
      </main>
    );
  }

  return (
    <div className="app" data-variant="editorial">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.svg" alt="" aria-hidden="true" />
          <h1 className="brand-name">
            <span className="brand-accent">NBA</span> Impact Lab
          </h1>
        </div>
        <div className="topbar-actions topbar-right">
          <label className="season-chip">
            <span>Season</span>
            <select value={season} onChange={(event) => setSeason(Number(event.target.value))}>
              {seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <ProjectionHistory />
          <div className="manifest data-stamp">
            <span>Data</span>
            <strong>{new Date(data.manifest.generated_at).toLocaleString()}</strong>
          </div>
          <button className="refresh-button hdr-btn" onClick={reloadData} disabled={refreshing}>
            {refreshing ? "Reloading" : "Reload data"}
          </button>
          {localRefreshEnabled && (
            <button className="refresh-button hdr-btn primary" onClick={refreshBackend} disabled={refreshing}>
              Refresh latest
            </button>
          )}
          {(refreshNote || loadingViewData || isPublicReadOnlyMode()) && (
            <div className="refresh-note">{loadingViewData ? "Loading view data" : refreshNote ?? "Public read-only"}</div>
          )}
        </div>
      </header>

      <nav className="modebar" aria-label="Analysis modes">
        {(Object.entries(viewLabels) as [View, string][]).map(([key, label]) => (
          <button key={key} className={cls("modebar-btn", view === key && "active")} onClick={() => setView(key as View)}>
            {label}
            {key === "impact" && <span className="nav-pill">{data.players.filter((player) => player.year === season).length}</span>}
          </button>
        ))}
      </nav>

      <WorkspaceErrorBoundary key={view} viewLabel={viewLabels[view]} onReset={() => setView("impact")}>
        {viewError ? (
          <WorkspaceErrorPanel title={`${viewLabels[view]} data did not load`} detail={viewError} onReset={() => setView("impact")} />
        ) : (
          <Suspense fallback={<main className="loading"><p>Loading workspace</p></main>}>
            {view === "impact" && <ImpactWorkspace data={data} season={season} />}
            {view === "teams" && <TeamWorkspace data={data} season={season} />}
            {view === "injuries" && <InjuryOutlookWorkspace outlook={data.injuryOutlook} />}
            {view === "startingLineups" && <StartingLineupsWorkspace data={data} season={season} />}
            {view === "tradeRecs" && <TradeRecommendationsWorkspace data={data} season={season} onOpenSandbox={() => setView("trade")} />}
            {view === "trade" && <TradeWorkspace data={data} season={season} />}
            {view === "offseason" && <OffseasonSimulatorWorkspace data={data} season={season} />}
            {view === "capTracker" && <CapTrackerWorkspace data={data} />}
            {view === "draft" && <DraftWorkspace data={data} />}
            {view === "draftElo" && <DraftEloWorkspace data={data} />}
            {view === "lineups" && <LineupWorkspace data={data} season={season} />}
            {view === "tracker" && <TrackerWorkspace data={data} />}
          </Suspense>
        )}
      </WorkspaceErrorBoundary>
    </div>
  );
}

function ImpactWorkspace({ data, season }: { data: AppData; season: number }) {
  const seasonPlayers = useMemo(() => data.players.filter((player) => player.year === season), [data.players, season]);
  const hasPlayerPool = seasonPlayers.some((player) => !!player.pool_status);
  const [poolScope, setPoolScope] = useSessionState<"roster" | "free_agent" | "all">("impact:poolScope", "roster");
  const [query, setQuery] = useSessionState("impact:query", "");
  const [team, setTeam] = useSessionState("impact:team", "All");
  const [faStatus, setFaStatus] = useSessionState<FaStatusFilter>("impact:faStatus", "All");
  const [positionSelections, setPositionSelections] = useSessionState<string[]>("impact:positions", []);
  const [sortKey, setSortKey] = useSessionState<SortKey>("impact:sortKey", "score");
  const [sortDirection, setSortDirection] = useSessionState<SortDirection>("impact:sortDirection", "desc");
  const [filterRules, setFilterRules] = useSessionState<FilterRule[]>("impact:rules", []);
  const [filterKey, setFilterKey] = useSessionState<FilterKey>("impact:filterKey", "score");
  const [filterOperator, setFilterOperator] = useSessionState<FilterOperator>("impact:filterOperator", "gte");
  const [filterValue, setFilterValue] = useSessionState("impact:filterValue", "");
  const [filterValueTo, setFilterValueTo] = useSessionState("impact:filterValueTo", "");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);
  const [detailPlayer, setDetailPlayer] = useState<PlayerImpact | null>(null);
  const [detailPosition, setDetailPosition] = useState({ left: 28, top: 138 });
  const [careerHistory, setCareerHistory] = useState<PlayerCareerHistoryRow[]>([]);
  const [careerHistoryError, setCareerHistoryError] = useState<string | null>(null);

  const teams = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => playerTeamFilterValue(player)))).sort()], [seasonPlayers]);
  const faStatuses = useMemo(() => {
    const order: FaStatusFilter[] = ["All", "Signed", "UFA", "RFA", "Rookie", "PO", "TO"];
    const available = new Set(seasonPlayers.map((player) => faStatusLabel(player)));
    return order.filter((status) => status === "All" || available.has(status));
  }, [seasonPlayers]);
  const positions = useMemo(
    () => Array.from(new Set(seasonPlayers.map((player) => displayPosition(player.position)).filter((position) => position !== "UNK"))).sort(),
    [seasonPlayers]
  );
  const activePositionSelections = useMemo(
    () => (Array.isArray(positionSelections) ? positionSelections.filter((item) => positions.includes(item)) : []),
    [positionSelections, positions]
  );
  const selectedPositionSet = useMemo(() => new Set(activePositionSelections), [activePositionSelections]);
  const selectedFilterField = filterFields.find((field) => field.key === filterKey) ?? filterFields[0];
  const availableOperators = selectedFilterField.type === "number" ? numericOperators : textOperators;
  const quickFilterCount = [hasPlayerPool && poolScope !== "roster", query.trim(), team !== "All", faStatus !== "All", activePositionSelections.length > 0].filter(Boolean).length;
  const activeFilterCount = quickFilterCount + filterRules.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seasonPlayers
      .filter((player) => !hasPlayerPool || poolScope === "all" || player.pool_status === poolScope)
      .filter((player) => !q || player.player_name.toLowerCase().includes(q))
      .filter((player) => team === "All" || playerTeamFilterValue(player) === team)
      .filter((player) => faStatus === "All" || faStatusLabel(player) === faStatus)
      .filter((player) => activePositionSelections.length === 0 || selectedPositionSet.has(displayPosition(player.position)))
      .filter((player) => passesFilterRules(player, filterRules))
      .sort((a, b) => comparePlayers(a, b, sortKey, sortDirection));
  }, [hasPlayerPool, poolScope, activePositionSelections.length, faStatus, filterRules, query, seasonPlayers, selectedPositionSet, sortDirection, sortKey, team]);

  useEffect(() => {
    setPositionSelections((current) => {
      const currentList = Array.isArray(current) ? current : [];
      const next = currentList.filter((item) => positions.includes(item));
      return next.length === currentList.length ? currentList : next;
    });
  }, [positions, setPositionSelections]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(["player_name", "team", "position", "tier", "contract_status"].includes(key) ? "asc" : "desc");
  };
  const handleFilterKeyChange = (key: FilterKey) => {
    const nextField = filterFields.find((field) => field.key === key) ?? filterFields[0];
    setFilterKey(key);
    setFilterOperator(nextField.type === "number" ? "gte" : "contains");
    setFilterValue("");
    setFilterValueTo("");
  };
  const addFilterRule = () => {
    const value = filterValue.trim();
    const valueTo = filterValueTo.trim();
    if (!value || (filterOperator === "between" && !valueTo)) return;
    const nextRule: FilterRule = {
      id: editingFilterId ?? `${filterKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key: filterKey,
      operator: filterOperator,
      value,
      valueTo: filterOperator === "between" ? valueTo : undefined
    };
    setFilterRules((current) => {
      if (!editingFilterId) return [...current, nextRule];
      return current.map((rule) => rule.id === editingFilterId ? nextRule : rule);
    });
    setEditingFilterId(null);
    setFilterValue("");
    setFilterValueTo("");
  };
  const editFilterRule = (rule: FilterRule) => {
    if (!isImpactFilterKey(rule.key)) return;
    const field = filterFields.find((item) => item.key === rule.key) ?? filterFields[0];
    setEditingFilterId(rule.id);
    setFilterKey(rule.key);
    setFilterOperator(rule.operator);
    setFilterValue(rule.value);
    setFilterValueTo(rule.valueTo ?? "");
    if (field.type === "number" && !numericOperators.some((operator) => operator.value === rule.operator)) {
      setFilterOperator("gte");
    }
    if (field.type === "text" && !textOperators.some((operator) => operator.value === rule.operator)) {
      setFilterOperator("contains");
    }
    setFilterDrawerOpen(true);
  };
  const removeFilterRule = (ruleId: string) => {
    setFilterRules((current) => current.filter((item) => item.id !== ruleId));
    if (editingFilterId === ruleId) {
      setEditingFilterId(null);
      setFilterValue("");
      setFilterValueTo("");
    }
  };
  const cancelFilterEdit = () => {
    setEditingFilterId(null);
    setFilterValue("");
    setFilterValueTo("");
  };
  useEffect(() => {
    setFilterRules((current) => {
      const next = current.filter((rule) => isImpactFilterKey(rule.key));
      return next.length === current.length ? current : next;
    });
  }, [setFilterRules]);
  useEffect(() => {
    if (isImpactFilterKey(filterKey)) return;
    setFilterKey("score");
    setFilterOperator("gte");
    setFilterValue("");
    setFilterValueTo("");
  }, [filterKey, setFilterKey, setFilterOperator, setFilterValue, setFilterValueTo]);
  const clearAllFilters = () => {
    setPoolScope("roster");
    setQuery("");
    setTeam("All");
    setFaStatus("All");
    setPositionSelections([]);
    setFilterRules([]);
    cancelFilterEdit();
    setFilterDrawerOpen(false);
  };
  const showDetail = (player: PlayerImpact, event: MouseEvent<HTMLButtonElement>) => {
    const width = Math.min(620, window.innerWidth - 32);
    const visibleHeight = Math.min(660, window.innerHeight - 32);
    setDetailPlayer(player);
    setDetailPosition({
      left: Math.max(16, Math.min(event.clientX + 14, window.innerWidth - width - 16)),
      top: Math.max(16, Math.min(event.clientY - 18, window.innerHeight - visibleHeight - 16))
    });
    if (careerHistory.length === 0 && !careerHistoryError) {
      loadPlayerCareerHistory(data.manifest)
        .then(setCareerHistory)
        .catch((error: unknown) => setCareerHistoryError(error instanceof Error ? error.message : String(error)));
    }
  };
  const closeDetail = () => setDetailPlayer(null);

  useEffect(() => {
    if (!detailPlayer) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailPlayer]);

  return (
    <main className="workspace impact-grid">
      <div className="impact-sticky-header">
        <section className={cls("control-strip board-controls", filterDrawerOpen && "mobile-filters-open")}>
          <div className="quick-filters board-control-row mobile-collapsible-filters">
            <div className="search">
              <span>Find</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Player name" />
            </div>
            {hasPlayerPool && <label className="mobile-drawer-filter">
              Player pool
              <select value={poolScope} onChange={(event) => setPoolScope(event.target.value as "roster" | "free_agent" | "all")}>
                <option value="roster">NBA rosters</option>
                <option value="free_agent">Free agents</option>
                <option value="all">All tracked</option>
              </select>
            </label>}
            <label className="mobile-drawer-filter">
              Team
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                {teams.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="mobile-drawer-filter">
              FA Status
              <select value={faStatus} onChange={(event) => setFaStatus(event.target.value as FaStatusFilter)}>
                {faStatuses.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <PositionFilter positions={positions} selectedPositions={activePositionSelections} onChange={setPositionSelections} />
            <div className="board-count" aria-live="polite">
              <span>Players</span>
              <strong>{filtered.length.toLocaleString()}</strong>
            </div>
            <button className="clear-filters" onClick={clearAllFilters} disabled={activeFilterCount === 0}>
              Clear{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
            <button
              type="button"
              className="mobile-filter-trigger"
              aria-controls="impact-mobile-filter-body"
              aria-expanded={filterDrawerOpen}
              onClick={() => setFilterDrawerOpen((open) => !open)}
            >
              <span>Filters</span>
              {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
            </button>
          </div>
          <details
            id="impact-mobile-filter-body"
            className="advanced-filter-drawer board-control-row mobile-drawer-filter"
            open={filterDrawerOpen || editingFilterId !== null}
            onToggle={(event) => setFilterDrawerOpen(event.currentTarget.open)}
          >
            <summary>Advanced filter</summary>
            <div className="rule-builder" aria-label="Add filter rule">
              <label>
                Filter
                <select value={filterKey} onChange={(event) => handleFilterKeyChange(event.target.value as FilterKey)}>
                  {filterFields.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Match
                <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as FilterOperator)}>
                  {availableOperators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="rule-value">
                Value
                <input
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addFilterRule();
                  }}
                  placeholder={selectedFilterField.type === "number" ? "80, 1.5, 20m" : "contains"}
                />
              </label>
              {filterOperator === "between" && (
                <label className="rule-value">
                  To
                  <input
                    value={filterValueTo}
                    onChange={(event) => setFilterValueTo(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addFilterRule();
                    }}
                    placeholder="100"
                  />
                </label>
              )}
              <button className="add-filter" onClick={addFilterRule} disabled={!filterValue.trim() || (filterOperator === "between" && !filterValueTo.trim())}>
                {editingFilterId ? "Update" : "Add"}
              </button>
              {editingFilterId && (
                <button className="clear-filters cancel-filter-edit" onClick={cancelFilterEdit}>
                  Cancel
                </button>
              )}
            </div>
          </details>
          {filterRules.length > 0 && (
            <div className="filter-chips" aria-label="Active filter rules">
              {filterRules.map((rule) => (
                <div key={rule.id} className={cls("filter-chip", editingFilterId === rule.id && "editing")}>
                  <button type="button" className="filter-chip-edit" onClick={() => editFilterRule(rule)}>
                    {describeFilterRule(rule)}
                    <span>Edit</span>
                  </button>
                  <button type="button" className="filter-chip-remove" aria-label={`Remove ${describeFilterRule(rule)}`} onClick={() => removeFilterRule(rule.id)}>
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="table-panel impact-table-panel">
        <PlayerTable
          players={filtered}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          onShowDetail={showDetail}
        />
      </section>

      {detailPlayer && (
        <div className="detail-overlay active" role="presentation" onClick={closeDetail}>
          <div
            className="detail-popover"
            role="dialog"
            aria-label={`${detailPlayer.player_name} detail`}
            style={{ ...detailPosition, "--detail-top": `${detailPosition.top}px` } as CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <PlayerDetail player={detailPlayer} allPlayers={data.players} careerHistory={careerHistory} careerHistoryError={careerHistoryError} injuryOutlook={data.injuryOutlook} />
          </div>
        </div>
      )}
    </main>
  );
}

function PositionFilter({
  positions,
  selectedPositions,
  onChange
}: {
  positions: string[];
  selectedPositions: string[];
  onChange: (value: string[] | ((current: string[]) => string[])) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedPositions), [selectedPositions]);
  const togglePosition = (position: string) => {
    onChange((current) => {
      const currentList = Array.isArray(current) ? current : [];
      return currentList.includes(position) ? currentList.filter((item) => item !== position) : [...currentList, position];
    });
  };

  return (
    <div className="filter-field position-multi-filter mobile-drawer-filter">
      <span>Position</span>
      <div className="position-toggle-group" role="group" aria-label="Position filter">
        <button type="button" className={cls(selectedPositions.length === 0 && "active")} aria-pressed={selectedPositions.length === 0} onClick={() => onChange([])}>
          All
        </button>
        {positions.map((position) => (
          <button
            key={position}
            type="button"
            className={cls(selectedSet.has(position) && "active")}
            aria-pressed={selectedSet.has(position)}
            onClick={() => togglePosition(position)}
          >
            {position}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerTable({
  players,
  sortKey,
  sortDirection,
  onSort,
  onShowDetail
}: {
  players: PlayerImpact[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onShowDetail: (player: PlayerImpact, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const sortableHeader = (key: SortKey, label: string) => (
    <button className={cls("sort-header sort-btn", sortKey === key && "active on")} onClick={() => onSort(key)}>
      {label}
      {sortKey === key && <span className="sort-arr">{sortDirection === "desc" ? "v" : "^"}</span>}
    </button>
  );
  const activeSkill = getActiveSkillSort(sortKey);
  const visiblePlayers = players.slice(0, MAX_VISIBLE_TABLE_ROWS);
  const hiddenCount = Math.max(0, players.length - visiblePlayers.length);

  return (
    <div className="table-wrap">
      {hiddenCount > 0 && <p className="table-limit-note">Showing first {visiblePlayers.length.toLocaleString()} of {players.length.toLocaleString()} rows. Tighten filters to inspect the rest.</p>}
      <table className="data-table player-table editorial-player-table">
        <colgroup>
          <col className="cg-rank" />
          <col className="cg-player" />
          <col className="cg-age" />
          <col className="cg-min" />
          <col className="cg-rate" />
          <col className="cg-rate" />
          <col className="cg-rate" />
          <col className="cg-score" />
          <col className="cg-delta" />
          <col className="cg-tier" />
          <col className="cg-money cg-current-money" />
          <col className="cg-money cg-current-money" />
          <col className="cg-va cg-current-va" />
          <col className="cg-scale cg-current-scale" />
          <col className="cg-money cg-future-money" />
          <col className="cg-money cg-fa" />
          <col className="cg-scale cg-future-scale" />
          <col className="cg-skills" />
        </colgroup>
        <thead>
          <tr className="group-row">
            <th></th>
            <th colSpan={3}>Identity</th>
            <th colSpan={6}>Impact</th>
            <th colSpan={4}>Current Season</th>
            <th colSpan={3}>This + 3Y</th>
            <th>Skills</th>
          </tr>
          <tr>
            <th className="col-rank c-rank">
              <span className="sort-header sort-btn">#</span>
            </th>
            <th className="col-player c-player sticky-player">{sortableHeader("player_name", "Player")}</th>
            <th className="col-compact c-age align-right">{sortableHeader("age", "Age")}</th>
            <th className="col-min c-min align-center group-end">{sortableHeader("Minutes", "Min")}</th>
            <th className="col-rate c-rate align-center">{sortableHeader("offense", "Off")}</th>
            <th className="col-rate c-rate align-center">{sortableHeader("defense", "Def")}</th>
            <th className="col-rate c-rate impact-total-head align-center">{sortableHeader("total", "Total")}</th>
            <th className="col-score c-score align-center">{sortableHeader("score", "Score")}</th>
<th className="col-rate c-delta align-center" title={players[0]?.year === 2027 ? "Score change versus frozen preseason" : "Score change versus last season"}>{sortableHeader("score_delta", players[0]?.year === 2027 ? "Δ Pre" : "Δ Year")}</th>
            <th className="col-tier c-tier align-center group-end">{sortableHeader("tier", "Tier")}</th>
            <th className="col-money c-money c-current-money align-right">{sortableHeader("value", "Value")}</th>
            <th className="col-money c-money c-current-money align-right">{sortableHeader("contract", "Contract")}</th>
            <th className="col-money c-va c-current-va align-right">{sortableHeader("value_add", "Szn VA")}</th>
            <th className="col-scale c-scale c-current-scale align-center group-end">{sortableHeader("scalability", "Scale")}</th>
            <th className="col-money c-money c-future-money align-right">{sortableHeader("future_value_4y", "4Y Value")}</th>
            <th className="col-money c-money c-fa align-right">{sortableHeader("fa_value", "FA")}</th>
            <th className="col-scale c-scale c-future-scale align-center group-end">{sortableHeader("future_scale_4y", "4Y Scale")}</th>
            <th className="col-skills c-skills align-center">
              <div className="skills-head">
                <button className={cls("skills-main-sort", activeSkill && "active")} onClick={() => onSort(activeSkill ?? "SHOOT")}>
                  Skills{activeSkill && <small>{skillSortLabel(activeSkill)} {sortDirection === "desc" ? "v" : "^"}</small>}
                </button>
                <div className="skills-sort-strip" aria-label="Sort by skill">
                  {skillKeys.map((key) => (
                    <button
                      key={key}
                      className={cls("skills-sort-btn", activeSkill === key && "active")}
                      onClick={() => onSort(key)}
                      title={`Sort by ${skillLabels[key]}`}
                    >
                      {key}
                      {activeSkill === key && <i>{sortDirection === "desc" ? "v" : "^"}</i>}
                    </button>
                  ))}
                  {skillAggregateSorts.map((item) => (
                    <button
                      key={item.key}
                      className={cls("skills-sort-btn aggregate", activeSkill === item.key && "active")}
                      onClick={() => onSort(item.key)}
                      title={`Sort by ${item.title}`}
                    >
                      {item.label}
                      {activeSkill === item.key && <i>{sortDirection === "desc" ? "v" : "^"}</i>}
                    </button>
                  ))}
                </div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {visiblePlayers.map((player, index) => (
            <tr key={`${player.year}-${player.nba_id}`} style={rowAccentStyle(player)}>
              <td className="rank-cell">{index + 1}</td>
              <td className="sticky-player">
                <div className="player-cell with-headshot">
                  <PlayerHeadshot player={player} />
                  <div className="player-copy">
                    <button
                      className="row-button row-link"
                      onClick={(event) => onShowDetail(player, event)}
                    >
                      {player.player_name}
                    </button>
                    <div className="player-sub">{playerMarketTeamLabel(player)} / {displayPosition(player.position)}</div>
                  </div>
                </div>
              </td>
              <td className="pad-r muted-num">{formatNumber(player.age, 1)}</td>
              <td className="muted-num min-cell group-end-cell">{formatNumber(player.Minutes, 0)}</td>
              <td className="stat-cell"><div className="cell-stage"><StatValue value={player.offense} tone="secondary" /></div></td>
              <td className="stat-cell"><div className="cell-stage"><StatValue value={player.defense} tone="secondary" /></div></td>
              <td className="stat-cell impact-total-cell"><div className="cell-stage"><StatValue value={player.total} /></div></td>
              <td className="align-center score-cell">
                <ScoreValue value={player.score} label={player.score_label} />
              </td>
              <td className="align-center">
                <span className="delta-value" style={deltaStyle(player.score_delta ?? 0)}>{formatSigned(player.score_delta, 0)}</span>
              </td>
              <td className="align-center group-end-cell">
                <span className="tier-text">{player.tier}</span>
              </td>
              <td className="money-text"><div className="cell-stage money-stage">{formatMoney(player.value)}</div></td>
              <td className="money-text muted-num"><div className="cell-stage money-stage">{formatContractValue(player)}</div></td>
              <td className="va-cell" style={netMoneyStyle(currentValueAdd(player))}><div className="cell-stage money-stage">{formatSeasonValueAdd(player)}</div></td>
              <td className="align-center group-end-cell">
                <div className="cell-stage">
                  <span className="scale-value" style={scaleStyle(currentScale(player))}>
                    {formatNumber(currentScale(player), 1)}
                  </span>
                </div>
              </td>
              <td className="money-text"><div className="cell-stage money-stage">{formatMoney(futureValue4y(player))}</div></td>
              <td className="money-text"><div className="cell-stage money-stage">{formatMoney(player.fa_value)}</div></td>
              <td className="align-center group-end-cell">
                <div className="cell-stage">
                  <span className="scale-value" style={scaleStyle(futureScale4y(player) ?? 0)}>
                    {formatNumber(futureScale4y(player), 1)}
                  </span>
                </div>
              </td>
              <td className="skill-fingerprint-cell">
                <SkillLedger
                  aggregates={playerSkillAggregates(player)}
                  skills={skillKeys.map((key) => ({
                    key,
                    label: key,
                    title: skillLabels[key],
                    value: Number(player[key] ?? 0),
                    sortKey: key
                  }))}
                  activeKey={activeSkill}
                  onSort={(key) => onSort(key as SortKey)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getActiveSkillSort(sortKey: SortKey): ImpactSkillSortKey | null {
  if (skillAggregateSorts.some((item) => item.key === sortKey)) return sortKey as SkillAggregateSortKey;
  return skillKeys.includes(sortKey as SkillKey) ? sortKey as SkillKey : null;
}

function skillSortLabel(key: ImpactSkillSortKey): string {
  const aggregate = skillAggregateSorts.find((item) => item.key === key);
  return aggregate ? aggregate.label : key;
}

function faStatusLabel(player: PlayerImpact): FaStatusFilter {
  const status = player.contract_status?.trim();
  if (status === "UFA") return "UFA";
  if (status === "RFA") return "RFA";
  if (status === "Rookie FA") return "Rookie";
  if (status === "Player Option") return "PO";
  if (status === "Team Option") return "TO";
  return "Signed";
}

function playerControlTeam(player: PlayerImpact): string {
  const incumbent = cleanTeamValue(player.incumbent_team);
  const team = cleanTeamValue(player.team);
  return incumbent !== "FA" ? incumbent : team;
}

function playerTeamFilterValue(player: PlayerImpact): string {
  const status = faStatusLabel(player);
  if (status === "UFA") return "FA";
  return playerControlTeam(player);
}

function playerMarketTeamLabel(player: PlayerImpact): string {
  const status = faStatusLabel(player);
  const controlTeam = playerControlTeam(player);
  if (status === "UFA") return "UFA";
  if (status === "Rookie") return controlTeam !== "FA" ? `${controlTeam} / Rookie` : "Rookie";
  if (status === "PO" || status === "TO") return controlTeam !== "FA" ? `${status} / ${controlTeam}` : status;
  if (status === "RFA") return controlTeam !== "FA" ? controlTeam : "RFA";
  return cleanTeamValue(player.team);
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function PlayerDetail({ player, allPlayers, careerHistory, careerHistoryError, injuryOutlook }: { player: PlayerImpact; allPlayers: PlayerImpact[]; careerHistory: PlayerCareerHistoryRow[]; careerHistoryError: string | null; injuryOutlook?: AppData["injuryOutlook"] }) {
  const trajectory = buildCareerTrajectory(player, allPlayers, careerHistory);
  const scoreVars = scoreStyle(player.score) as CSSProperties & { "--score-fill"?: string };
  const scoreColor = player.score_label === "DNQ" ? "var(--muted)" : scoreVars["--score-fill"] ?? "var(--teal)";
  const detailStyle = {
    ...scoreVars,
    "--detail-score": scoreColor,
    "--tc": scoreColor
  } as CSSProperties;

  return (
    <aside className="detail-panel player-detail-card" style={detailStyle}>
      <div className="dp-header">
        <div className="dp-watermark" aria-hidden="true">
          {player.score_label === "DNQ" ? "-" : Math.round(player.score)}
        </div>
        <div className="dp-top">
          <div className="dp-identity">
            <PlayerHeadshot player={player} size="detail" />
            <div className="dp-title-block">
              <div className="dp-meta">{player.team} / {displayPosition(player.position)}</div>
              <div className="dp-name">{player.player_name}</div>
              {player.pool_status && <p className="availability-note">{player.pool_review_pending ? "Roster needs review. " : ""}{player.pool_note}{player.pool_checked_at && <> Checked {new Date(player.pool_checked_at).toLocaleDateString()}.</>}</p>}
              <div className="dp-tags">
                <span className="tier-text">{player.tier}</span>
                {player.score_delta !== null && player.score_delta !== undefined && (
                  <span>{formatSigned(player.score_delta, 0)} pts vs {player.year === 2027 ? "preseason" : "last season"}</span>
                )}
              </div>
            </div>
          </div>
          <ScoreRing value={player.score} label={player.score_label} size={66} />
        </div>
      </div>

      <div className="dp-body">
        <PlayerInjuryNote injury={injuryForPlayer(player, injuryOutlook)} player={player} />
        {player.live_current_weight != null && <p className="availability-note" title={player.availability_reason ?? undefined}>
          Season evidence: {formatNumber(player.live_evidence_minutes ?? 0, 0)} actual minutes · {(100 * player.live_current_weight).toFixed(1)}% current evidence / {(100 * (1 - player.live_current_weight)).toFixed(1)}% preseason prior. Injuries apply separately.
        </p>}
        {player.availability_status === "DNQ" && (
          <p className="availability-note">
            {player.availability_reason || "DNQ"} / skills from {player.skill_source_year ?? "-"}
          </p>
        )}

        <div className="dp-metrics">
          <MetricPill label="Offense" value={formatSigned(player.offense, 1)} tone="green" />
          <MetricPill label="Defense" value={formatSigned(player.defense, 1)} tone="teal" />
          <MetricPill label="Total" value={formatSigned(player.total, 1)} tone="gold" />
        </div>

        <section>
          <div className="dp-section-row">
            <h3 className="dp-section-head">Career Arc</h3>
            <span>{careerHistoryError ? "Current row only" : "Total impact / bars are Szn VA"}</span>
          </div>
          <ProjectionChart points={trajectory} currentYear={player.year} />
        </section>

        <section>
          <h3 className="dp-section-head">Skill Shape</h3>
          <div className="skill-list">
            {skillKeys.map((key) => (
              <SkillRow key={key} label={skillLabels[key]} value={Number(player[key] ?? 0)} />
            ))}
          </div>
        </section>

        <section>
          <h3 className="dp-section-head">Market Read</h3>
          <div className="market-grid">
            <div className="mc">
              <span>Replacement</span>
              <strong>{formatSigned(Number(player.replacement_total ?? 0), 2)}</strong>
            </div>
            <div className="mc">
              <span>TIMIN</span>
              <strong>{formatNumber(player.timin, 0)}</strong>
            </div>
            <div className="mc">
              <span>Raw Value</span>
              <strong>{formatMoney(player.value)}</strong>
            </div>
            <div className="mc">
              <span>Salary</span>
              <strong className="muted-num">{formatContractValue(player)}</strong>
            </div>
            <div className="mc">
              <span>Season VA</span>
              <strong style={netMoneyStyle(currentValueAdd(player))}>{formatSeasonValueAdd(player)}</strong>
            </div>
            <div className="mc">
              <span>FA Value</span>
              <strong>{formatMoney(player.fa_value)}</strong>
            </div>
            <div className="mc">
              <span>Trade Val</span>
              <strong>{formatMoney(player.trade_value)}</strong>
            </div>
            <div className="mc">
              <span>Scalability</span>
              <strong style={scaleStyle(currentScale(player))}>{formatNumber(currentScale(player), 1)}</strong>
            </div>
          </div>
          <p className="note note-text">
            {formatNumber(player.Minutes, 0)} min / {formatNumber(player.yoe, 0)} yrs experience
          </p>
          <p className="note note-text">
            Replacement math: ({formatSigned(player.total, 2)} total - {formatSigned(Number(player.replacement_total ?? 0), 2)} replacement) x {formatNumber(player.Minutes, 0)} minutes = {formatNumber(player.timin, 0)} TIMIN.
          </p>
          <p className="note note-text">
            Replacement level uses a trailing 3-year plurality-position cutoff at the 75th rotation-useful player per position-season; this row is then weighted as {replacementPositionShareText(player)}.
          </p>
          <p className="note note-text">
            FA uses projected TIMIN, max salary tier {player.fa_max_tier ?? "-"}, and {formatNumber(player.fa_missing_roster_slots, 0)} reserved roster slots.
          </p>
        </section>
      </div>
    </aside>
  );
}

function TeamWorkspace({ data, season }: { data: AppData; season: number }) {
  const [conference, setConference] = useSessionState<ConferenceFilter>("teams:conference", "All");
  const scenario: TeamProjectionScenario = "base";
  const [sortKey, setSortKey] = useSessionState<TeamSortKey>("teams:sortKey", "projected_wins");
  const [sortDirection, setSortDirection] = useSessionState<SortDirection>("teams:sortDirection", "desc");
  const [contributorSortKey, setContributorSortKey] = useSessionState<TeamContributorSortKey>("teams:contributorSortKey", "Minutes");
  const [contributorSortDirection, setContributorSortDirection] = useSessionState<SortDirection>("teams:contributorSortDirection", "desc");
  const [selectedTeam, setSelectedTeam] = useSessionState<string>("teams:selected", "");
  const allTeams = useMemo(() => {
    return data.teams.filter((team) => team.year === season && ((team.scenario_id ?? "base") === "base"));
  }, [data.teams, season]);
  const teams = useMemo(() => {
    const filtered = allTeams.filter((team) => conference === "All" || team.conference === conference);
    return filtered.sort((a, b) => {
      const av = Number(a[sortKey] ?? 0);
      const bv = Number(b[sortKey] ?? 0);
      const diff = av === bv ? a.conference_rank - b.conference_rank : av - bv;
      return sortDirection === "desc" ? -diff : diff;
    });
  }, [allTeams, conference, sortDirection, sortKey]);
  const currentTeam = teams.find((team) => team.team === selectedTeam) ?? teams[0] ?? allTeams[0];
  useEffect(() => {
    if (currentTeam && currentTeam.team !== selectedTeam) setSelectedTeam(currentTeam.team);
  }, [currentTeam, selectedTeam, setSelectedTeam]);
  const teamMeta = useMemo(() => {
    const map = new Map<string, TeamProjection>();
    data.teams.forEach((team) => {
      if (!map.has(team.team)) map.set(team.team, team);
    });
    return map;
  }, [data.teams]);
  const contributorsByTeam = useMemo(() => {
    const map = new Map<string, PlayerImpact[]>();
    data.players.forEach((player) => {
      if (player.year !== season) return;
      const team = teamForProjectionScenario(player, scenario);
      const rows = map.get(team);
      if (rows) rows.push(player);
      else map.set(team, [player]);
    });
    return map;
  }, [data.players, scenario, season]);
  const selectedContributors = useMemo(() => {
    if (!currentTeam) return [];
    const rows = contributorsByTeam.get(currentTeam.team) ?? [];
    const rosterCount = Number(currentTeam.roster_count);
    const projectedPlayerCount = Number.isFinite(rosterCount) ? Math.max(0, Math.trunc(rosterCount)) : rows.length;
    const projectedPlayers = [...rows]
      .sort(compareTeamProjectionUsage)
      .slice(0, projectedPlayerCount);
    return projectedPlayers.sort((a, b) => compareTeamContributors(a, b, contributorSortKey, contributorSortDirection, currentTeam.minutes));
  }, [contributorSortDirection, contributorSortKey, contributorsByTeam, currentTeam]);
  const teamSkillRows = useMemo(() => currentTeam ? buildTeamSkillRows(currentTeam) : [], [currentTeam]);
  const schedulesByTeam = useMemo(() => {
    const map = new Map<string, TeamScheduleGame[]>();
    data.schedules.forEach((game) => {
      if (game.season !== season) return;
      const teamsForGame = game.home_team === game.away_team ? [game.home_team] : [game.home_team, game.away_team];
      teamsForGame.forEach((team) => {
        const rows = map.get(team);
        if (rows) rows.push(game);
        else map.set(team, [game]);
      });
    });
    map.forEach((rows) => rows.sort((a, b) => `${a.date ?? ""} ${a.time ?? ""}`.localeCompare(`${b.date ?? ""} ${b.time ?? ""}`)));
    return map;
  }, [data.schedules, season]);
  if (!currentTeam) {
    return (
      <main className="workspace team-board-workspace">
        <section className="table-panel">
          <EmptyState title="No team projections" detail={`No team projection rows are available for ${season}.`} />
        </section>
      </main>
    );
  }

  const contributors = selectedContributors;
  const schedule = schedulesByTeam.get(currentTeam.team) ?? [];
  const regularSchedule = schedule.filter((game) => game.season_type === "Regular Season");
  const playInSchedule = schedule.filter((game) => game.season_type === "Play-In");
  const playoffSchedule = schedule.filter((game) => game.season_type === "Playoffs");
  const cupTbdGames = regularSchedule.filter((game) => game.is_placeholder).length;
  const scheduledGames = regularSchedule.length - cupTbdGames;
  const handleSort = (key: TeamSortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };
  const handleContributorSort = (key: TeamContributorSortKey) => {
    if (contributorSortKey === key) {
      setContributorSortDirection(contributorSortDirection === "desc" ? "asc" : "desc");
    } else {
      setContributorSortKey(key);
      setContributorSortDirection(key === "player_name" ? "asc" : "desc");
    }
  };
  const seasonGames = Math.max(82, Number(currentTeam.projected_wins ?? 0) + Number(currentTeam.projected_losses ?? 0));
  const injuryAdjusted = data.players.some((player) => player.year === season && player.injury_projection_as_of != null);

  return (
    <main className="workspace team-board-workspace">
      <section className="table-panel team-board-panel">
        <div className="panel-heading">
          <div>
            <h2>Team Projections</h2>
            <p>{injuryAdjusted
              ? "Injury-adjusted minutes and dated game odds; NBA Cup TBD slots use conference-field expected value"
              : currentTeam.schedule_adjusted
              ? "Actual schedule-adjusted wins; NBA Cup TBD slots use conference-field expected value"
              : "Minute-share ratings under base roster assumptions"}</p>
          </div>
          <div className="team-controls">
            <div className="segmented-control" aria-label="Conference filter">
              {(["All", "East", "West"] as ConferenceFilter[]).map((item) => (
                <button key={item} className={cls(conference === item && "active")} onClick={() => setConference(item)}>
                  {item}
                </button>
              ))}
            </div>
            <span>{teams.length} teams</span>
          </div>
        </div>
        <div className="table-wrap team-board-wrap">
          <table className="data-table team-board-table">
            <thead>
              <tr>
                <th><TeamSortButton label="Rank" sortKey="projected_wins" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th>Team</th>
                <th><TeamSortButton label="W-L" sortKey="projected_wins" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th><TeamSortButton label="Win %" sortKey="win_pct" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th><TeamSortButton label="Adj" sortKey="adjusted_total" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th><TeamSortButton label="Off" sortKey="offense" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th><TeamSortButton label="Def" sortKey="defense" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th><TeamSortButton label="Min" sortKey="minutes" active={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                <th className="team-skills-head">Skills</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.team} className={cls(currentTeam.team === team.team && "selected-row")} onClick={() => setSelectedTeam(team.team)}>
                  <td className="team-rank-cell">{formatNumber(team.league_rank ?? team.rank, 0)}</td>
                  <td className="team-cell">
                    <div className="team-cell-inner">
                      <TeamLogo team={team} />
                      <div>
                        <strong>{team.team_name ?? team.team}</strong>
                      </div>
                      <span className={cls("playoff-badge", playoffBadgeClass(team.playoff_status))}>{team.playoff_status}</span>
                    </div>
                  </td>
                  <td className="team-record-cell">
                    <div className="team-record-stack">
                      <strong>{formatNumber(team.projected_wins, 1)}-{formatNumber(team.projected_losses, 1)}</strong>
                      <span>{formatNumber(team.expected_wins, 1)} xW</span>
                    </div>
                  </td>
                  <td>{formatPercent(team.win_pct, 1)}</td>
                  <td><StatValue value={team.adjusted_total} /></td>
                  <td><StatValue value={team.offense} tone="secondary" /></td>
                  <td><StatValue value={team.defense} tone="secondary" /></td>
                  <td>
                    <div className="minutes-coverage">
                      <strong>{formatNumber(team.minutes, 0)}</strong>
                      <span className="minutes-coverage-track">
                        <i style={{ width: `${clamp(Number(team.minutes_coverage ?? team.minutes / 19680), 0, 1) * 100}%` }} />
                      </span>
                    </div>
                  </td>
                  <td><TeamSkillStrip team={team} activeSkill={skillKeys.includes(sortKey as SkillKey) ? sortKey as SkillKey : null} onSort={handleSort} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="detail-panel team-detail-panel">
        <div className="team-detail-head">
          <div className="team-title-lockup">
            <TeamLogo team={currentTeam} size="large" />
            <div>
              <p>{currentTeam.conference} #{formatNumber(currentTeam.conference_rank, 0)} / {currentTeam.playoff_status}</p>
              <h2>{currentTeam.team_name ?? currentTeam.team}</h2>
            </div>
          </div>
          <div className="team-record-hero">
            <strong>{formatNumber(currentTeam.projected_wins, 1)}-{formatNumber(currentTeam.projected_losses, 1)}</strong>
            <span>{currentTeam.schedule_adjusted
              ? `${formatPercent(currentTeam.win_pct, 1)} · ${scheduledGames} scheduled + ${cupTbdGames} Cup TBD`
              : `${formatPercent(currentTeam.win_pct, 1)} over ${formatNumber(seasonGames, 0)} games`}</span>
          </div>
        </div>
        <div className="team-detail-statline">
          <span><b>Adj Total</b>{formatSigned(currentTeam.adjusted_total, 1)}</span>
          <span><b>Off</b>{formatSigned(currentTeam.offense, 1)}</span>
          <span><b>Def</b>{formatSigned(currentTeam.defense, 1)}</span>
          <span><b>Coverage</b>{formatPercent(Number(currentTeam.minutes_coverage ?? currentTeam.minutes / 19680), 0)}</span>
        </div>
        <section>
          <div className="section-heading-row">
            <h3>Roster Contributions</h3>
            <span>{contributors.length} projected players</span>
          </div>
          {contributors.length > 0 ? <div className="table-wrap compact team-contrib-wrap">
            <table className="data-table team-contrib-table">
              <thead>
                <tr>
                  <th><TeamContributorSortButton label="Player" sortKey="player_name" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                  <th><TeamContributorSortButton label="Share" sortKey="share" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                  <th><TeamContributorSortButton label="Off" sortKey="offense_contribution" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                  <th><TeamContributorSortButton label="Def" sortKey="defense_contribution" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                  <th><TeamContributorSortButton label="Total" sortKey="total_contribution" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                  <th><TeamContributorSortButton label="Min" sortKey="Minutes" active={contributorSortKey} direction={contributorSortDirection} onSort={handleContributorSort} /></th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((player) => {
                  const share = currentTeam.minutes > 0 ? player.Minutes / currentTeam.minutes : 0;
                  return (
                    <tr key={`${player.nba_id}-${player.player_name}`} style={rowAccentStyle(player)}>
                      <td>
                        <div className="player-cell with-headshot team-contrib-player">
                          <PlayerHeadshot player={player} />
                          <div className="player-copy">
                            <strong>{player.player_name}</strong>
                            <span>{playerMarketTeamLabel(player)} / {displayPosition(player.position)}</span>
                          </div>
                        </div>
                      </td>
                      <td>{formatPercent(share, 1)}</td>
                      <td>{formatSigned(player.offense * share * 5, 2)}</td>
                      <td>{formatSigned(player.defense * share * 5, 2)}</td>
                      <td>{formatSigned(player.total * share * 5, 2)}</td>
                      <td>{formatNumber(player.Minutes, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div> : <EmptyState title="No roster drivers" detail={`No player rows are available for ${currentTeam.team} in ${season}.`} />}
        </section>
        <section className="team-skill-panel">
          <div className="section-heading-row">
            <h3>Skill Profile</h3>
            <span>Strengths and gaps</span>
          </div>
          <TeamSkillProfile rows={teamSkillRows} />
        </section>
        <TeamScheduleTable team={currentTeam.team} games={regularSchedule} title="Regular Season Schedule" teamMeta={teamMeta} />
        {playInSchedule.length > 0 && <TeamScheduleTable team={currentTeam.team} games={playInSchedule} title="Play-In Schedule" teamMeta={teamMeta} />}
        {playoffSchedule.length > 0 && <TeamScheduleTable team={currentTeam.team} games={playoffSchedule} title="Playoff Schedule" teamMeta={teamMeta} />}
      </section>
    </main>
  );
}

function StartingLineupsWorkspace({ data, season }: { data: AppData; season: number }) {
  const [selectedTeam, setSelectedTeam] = useSessionState<string>("startingLineups:selected", "");
  const scenario: TeamProjectionScenario = "base";
  const seasonLineups = useMemo(
    () =>
      data.lineups
        .filter((row) => row.year === season && ((row.scenario_id ?? "base") === scenario))
        .sort((a, b) => a.team.localeCompare(b.team) || a.role_order - b.role_order),
    [data.lineups, scenario, season]
  );
  const seasonTeams = useMemo(
    () => data.teams.filter((team) => team.year === season && ((team.scenario_id ?? "base") === scenario)),
    [data.teams, scenario, season]
  );
  const teamMap = useMemo(() => new Map(seasonTeams.map((team) => [team.team, team])), [seasonTeams]);
  const playerMap = useMemo(() => {
    const map = new Map<string, PlayerImpact>();
    data.players
      .filter((player) => player.year === season)
      .forEach((player) => {
        map.set(`${player.nba_id}`, player);
        map.set(`${player.nba_id}-${teamForProjectionScenario(player, scenario)}`, player);
      });
    return map;
  }, [data.players, scenario, season]);
  const teams = useMemo(() => {
    const lineupTeams = Array.from(new Set(seasonLineups.map((row) => row.team)));
    return lineupTeams
      .map((team) => teamMap.get(team) ?? seasonTeams.find((item) => item.team === team))
      .filter((team): team is TeamProjection => Boolean(team))
      .sort((a, b) => (a.team_name ?? a.team).localeCompare(b.team_name ?? b.team));
  }, [seasonLineups, seasonTeams, teamMap]);
  const currentTeam = teams.find((team) => team.team === selectedTeam) ?? teams[0];

  useEffect(() => {
    if (currentTeam && currentTeam.team !== selectedTeam) setSelectedTeam(currentTeam.team);
  }, [currentTeam, selectedTeam, setSelectedTeam]);

  if (!currentTeam) {
    return (
      <main className="workspace starting-lineups-workspace">
        <section className="table-panel">
          <EmptyState title="No starting lineups" detail={`No lineup rows are available for ${season}.`} />
        </section>
      </main>
    );
  }

  const currentRows = seasonLineups.filter((row) => row.team === currentTeam.team).sort((a, b) => a.role_order - b.role_order);
  const starters = currentRows.filter((row) => row.role_type === "Starter");
  const orderedStarters = [...starters].sort((a, b) => {
    const aPlayer = playerMap.get(`${a.nba_id}-${a.team}`) ?? playerMap.get(`${a.nba_id}`);
    const bPlayer = playerMap.get(`${b.nba_id}-${b.team}`) ?? playerMap.get(`${b.nba_id}`);
    return startingLineupPositionCenter(a, aPlayer) - startingLineupPositionCenter(b, bPlayer) || a.role_order - b.role_order;
  });
  const bench = currentRows.filter((row) => row.role_type !== "Starter");
  const starterTotal = starters.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const starterAverage = starters.length ? starterTotal / starters.length : 0;
  const sortedStarters = [...starters].sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0));
  const strongestStarter = sortedStarters[0] ?? null;
  const weakestStarter = sortedStarters[sortedStarters.length - 1] ?? null;
  const starterSpread = strongestStarter && weakestStarter
    ? Number(strongestStarter.total ?? 0) - Number(weakestStarter.total ?? 0)
    : 0;

  return (
    <main className="workspace starting-lineups-workspace">
      <section className="detail-panel starting-detail-panel">
        <div className="panel-heading starting-lineups-heading">
          <div>
            <h2>Starting Lineups</h2>
            <p>Estimated five-man shape plus first five bench roles</p>
          </div>
          <div className="lineup-heading-controls">
            <label className="starting-team-select">
              <span>Team</span>
              <select value={currentTeam.team} onChange={(event) => setSelectedTeam(event.target.value)}>
                {teams.map((team) => (
                  <option key={team.team} value={team.team}>
                    {team.team_name ?? team.team}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="team-detail-head">
          <div className="team-title-lockup">
            <TeamLogo team={currentTeam} size="large" />
            <div>
              <p>{currentTeam.conference} #{formatNumber(currentTeam.conference_rank, 0)}</p>
              <h2>{currentTeam.team_name ?? currentTeam.team}</h2>
            </div>
          </div>
          <div className="team-record-hero">
            <strong>{formatSigned(starterTotal, 1)}</strong>
            <span>starter total</span>
          </div>
        </div>

        <div className="metric-grid starting-metric-grid">
          <MetricPill label="Projected Record" value={`${formatNumber(currentTeam.projected_wins, 0)}-${formatNumber(currentTeam.projected_losses, 0)}`} />
          <MetricPill label="Team Rating" value={formatSigned(currentTeam.adjusted_total, 1)} tone="gold" />
          <MetricPill label="Starter Avg" value={formatSigned(starterAverage, 1)} tone={starterAverage >= 0 ? "green" : "red"} />
          <MetricPill label="Starter Spread" value={formatSigned(starterSpread, 1)} tone={starterSpread <= 2 ? "green" : undefined} />
        </div>

        <section>
          <div className="section-heading-row">
            <h3>Starting Five</h3>
            <span>Balanced roles · stars prioritized · skill fit within 0.5 impact points of the strongest five</span>
          </div>
          {starters.some((row) => row.lineup_position_fallback) && (
            <p>This roster needs a positional compromise to fill all five roles.</p>
          )}
          <div className="starter-card-grid">
            {orderedStarters.map((row) => (
              <StartingLineupCard key={`${row.scenario_id ?? "base"}-${row.team}-${row.role_order}-${row.nba_id}`} row={row} player={playerMap.get(`${row.nba_id}-${row.team}`) ?? playerMap.get(`${row.nba_id}`)} />
            ))}
          </div>
        </section>

        <section>
          <div className="section-heading-row">
            <h3>Bench</h3>
            <span>Next five by role score</span>
          </div>
          <StartingBenchTable rows={bench} />
        </section>
      </section>
    </main>
  );
}

function startingLineupPositionCenter(row: TeamLineupRow, player?: PlayerImpact): number {
  if (row.lineup_position) return ["PG", "SG", "SF", "PF", "C"].indexOf(row.lineup_position) + 1;
  if (player) {
    const shares = lineupPositionShares(player);
    return shares.pg + shares.sg * 2 + shares.sf * 3 + shares.pf * 4 + shares.c * 5;
  }
  const position = displayPosition(row.position).toUpperCase();
  return position === "PG" ? 1 : position === "SG" ? 2 : position === "SF" ? 3 : position === "PF" ? 4 : position === "C" ? 5 : 3;
}

function StartingLineupCard({ row, player }: { row: TeamLineupRow; player?: PlayerImpact }) {
  return (
    <div className="starter-card">
      <div className="starter-card-top">
        {player ? <PlayerHeadshot player={player} /> : <span className="player-headshot">{row.player_name.slice(0, 2).toUpperCase()}</span>}
        <div>
          <span>{row.lineup_position ? `${row.lineup_position} role${row.lineup_position_fallback ? " (fill-in)" : ""}` : row.role_label} / {displayPosition(row.position)}</span>
          <strong>{row.player_name}</strong>
        </div>
      </div>
      <div className="starter-card-stats">
        <div>
          <span>Total</span>
          <strong style={rateStyle(row.total)}>{formatSigned(row.total, 1)}</strong>
        </div>
        <div>
          <span>Score</span>
          <strong>{formatNumber(row.score, 1)}</strong>
        </div>
        <div>
          <span>Projected Min</span>
          <strong>{formatNumber(row.adjusted_minutes, 0)}</strong>
        </div>
      </div>
      <div className="starter-minute-row">
        <span>{formatNumber(row.original_minutes, 0)} raw model</span>
        <strong className={cls(row.minutes_delta > 0 && "good-text", row.minutes_delta < 0 && "bad-text")}>{formatSigned(row.minutes_delta, 0)}</strong>
        <span>{formatNumber(row.role_band_minutes, 0)} role target</span>
      </div>
      <div className="starter-tier">{row.tier}</div>
    </div>
  );
}

function StartingBenchTable({ rows }: { rows: TeamLineupRow[] }) {
  if (!rows.length) return <EmptyState title="No bench estimate" detail="This team does not have enough eligible player rows for bench roles." />;
  return (
    <div className="table-wrap compact starting-bench-wrap">
      <table className="data-table starting-bench-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Player</th>
            <th>Pos</th>
            <th>Total</th>
            <th>Score</th>
            <th>Raw Model Minutes</th>
            <th>Projected Minutes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.team}-${row.role_order}-${row.nba_id}`}>
              <td>{row.role_label}</td>
              <td>{row.player_name}</td>
              <td>{displayPosition(row.position)}</td>
              <td><StatValue value={row.total} /></td>
              <td>{formatNumber(row.score, 1)}</td>
              <td>{formatNumber(row.original_minutes, 0)}</td>
              <td>
                {formatNumber(row.adjusted_minutes, 0)}
                <span className={cls("bench-delta", row.minutes_delta > 0 && "good-text", row.minutes_delta < 0 && "bad-text")}>
                  {formatSigned(row.minutes_delta, 0)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamSortButton({ label, sortKey, active, direction, onSort }: { label: string; sortKey: TeamSortKey; active: TeamSortKey; direction: SortDirection; onSort: (key: TeamSortKey) => void }) {
  return (
    <button className={cls("sort-header sort-btn", active === sortKey && "active on")} onClick={() => onSort(sortKey)}>
      {label}
      {active === sortKey && <span className="sort-arr">{direction === "desc" ? "v" : "^"}</span>}
    </button>
  );
}

function TeamContributorSortButton({
  label,
  sortKey,
  active,
  direction,
  onSort
}: {
  label: string;
  sortKey: TeamContributorSortKey;
  active: TeamContributorSortKey;
  direction: SortDirection;
  onSort: (key: TeamContributorSortKey) => void;
}) {
  return (
    <button className={cls("sort-header sort-btn", active === sortKey && "active on")} onClick={() => onSort(sortKey)}>
      {label}
      {active === sortKey && <span className="sort-arr">{direction === "desc" ? "v" : "^"}</span>}
    </button>
  );
}

function TeamLogo({ team, size = "normal" }: { team: TeamProjection; size?: "normal" | "large" }) {
  const [failed, setFailed] = useState(false);
  const label = team.team_abbr ?? team.team;
  useEffect(() => setFailed(false), [team.team_logo_url, label]);
  if (!team.team_logo_url || failed) {
    return <span className={cls("team-logo-fallback", size === "large" && "large")}>{label}</span>;
  }
  return <img className={cls("team-logo", size === "large" && "large")} src={team.team_logo_url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function TeamSkillStrip({ team, activeSkill, onSort }: { team: TeamProjection; activeSkill: SkillKey | null; onSort: (key: TeamSortKey) => void }) {
  return (
    <div className="team-skill-strip">
      {skillKeys.map((key) => {
        const value = Number(team[key] ?? 0);
        const height = Math.max(5, clamp(Math.abs(value) / 2.4, 0, 1) * 18);
        return (
          <button
            key={key}
            className={cls("team-skill-dot", activeSkill === key && "active")}
            onClick={(event) => {
              event.stopPropagation();
              onSort(key);
            }}
            title={`${skillLabels[key]}: ${formatSigned(value, 1)}`}
            style={{ ...skillStyle(value), "--skill-h": `${height}px` } as CSSProperties}
          >
            <small>{key}</small>
            <span className={cls(value < 0 && "negative")} />
          </button>
        );
      })}
    </div>
  );
}

type TeamSkillProfileRow = {
  key: SkillKey;
  label: string;
  value: number;
  marker: number;
  band: "strength" | "neutral" | "weakness";
};

function TeamSkillProfile({ rows }: { rows: TeamSkillProfileRow[] }) {
  const strengths = rows.filter((row) => row.value > 0).slice(0, 3);
  const weaknesses = [...rows].reverse().filter((row) => row.value < 0).slice(0, 3);
  const renderCallout = (row: TeamSkillProfileRow) => (
    <div key={row.key} className={cls("team-skill-callout", row.band)} style={skillStyle(row.value)}>
      <span>{row.label}</span>
      <strong>{formatSigned(row.value, 1)}</strong>
    </div>
  );

  return (
    <div className="team-skill-profile">
      <div className="team-skill-callouts">
        <div>
          <span className="team-skill-kicker">Strengths</span>
          {(strengths.length > 0 ? strengths : rows.slice(0, 3)).map(renderCallout)}
        </div>
        <div>
          <span className="team-skill-kicker">Weaknesses</span>
          {(weaknesses.length > 0 ? weaknesses : [...rows].reverse().slice(0, 3)).map(renderCallout)}
        </div>
      </div>
      <div className="team-skill-bars">
        {rows.map((row) => (
          <div key={row.key} className={cls("team-skill-bar-row", row.band)} style={skillStyle(row.value)}>
            <span>{row.label}</span>
            <div className="team-skill-bar-track">
              <i style={row.value >= 0 ? { left: "50%", width: `${row.marker}%` } : { right: "50%", width: `${row.marker}%` }} />
              <b />
            </div>
            <strong>{formatSigned(row.value, 1)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamScheduleTable({ team, games, title, teamMeta }: { team: string; games: TeamScheduleGame[]; title: string; teamMeta: Map<string, TeamProjection> }) {
  const placeholderGames = games.filter((game) => game.is_placeholder);
  const scheduledGames = games.filter((game) => !game.is_placeholder);
  return (
    <section>
      <div className="section-heading-row">
        <h3>{title}</h3>
        <span>{placeholderGames.length > 0
          ? `${scheduledGames.length} scheduled + ${placeholderGames.length} Cup TBD`
          : `${games.length} games`}</span>
      </div>
      {games.length > 0 ? <div className="table-wrap compact team-schedule-wrap">
        <table className="data-table team-schedule-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Loc</th>
              <th>Opponent</th>
              <th>Model</th>
              <th>Result</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game, index) => {
              const isPlaceholder = Boolean(game.is_placeholder);
              const isHome = !isPlaceholder && game.home_team === team;
              const opponent = isPlaceholder ? "TBD" : isHome ? game.away_team : game.home_team;
              const probability = isPlaceholder ? game.home_win_probability : isHome ? game.home_win_probability : game.away_win_probability;
              const teamScore = isHome ? game.home_score : game.away_score;
              const opponentScore = isHome ? game.away_score : game.home_score;
              const won = game.is_completed && game.result === team;
              const opponentMeta = isPlaceholder ? null : teamMeta.get(opponent) ?? {
                year: game.season,
                team: opponent,
                team_name: opponent,
                team_abbr: opponent,
                conference: "",
                roster_count: 0,
                minutes: 0,
                raw_offense: 0,
                raw_defense: 0,
                raw_total: 0,
                adjusted_total: 0,
                offense: 0,
                defense: 0,
                total: 0,
                win_units: 0,
                projected_wins: 0,
                projected_losses: 0,
                win_pct: 0,
                expected_wins: 0,
                expected_losses: 0,
                league_rank: 0,
                rank: 0,
                conference_rank: 0,
                playoff_status: ""
              };
              return (
                <tr key={`${game.date}-${game.home_team}-${game.away_team}-${index}`}>
                  <td>
                    <div className="schedule-date-cell">
                      <strong>{isPlaceholder ? game.date_window ?? "Dec 4–10" : formatDateLabel(game.date)}</strong>
                      <span>{game.time || "-"}</span>
                    </div>
                  </td>
                  <td>{isPlaceholder ? game.selected_team_location ?? "TBD" : isHome ? "Home" : "Away"}</td>
                  <td>
                    <div className="schedule-opponent">
                      {opponentMeta && <TeamLogo team={opponentMeta} />}
                      <span>{isPlaceholder ? "TBD after Cup Group Play" : opponent}</span>
                    </div>
                  </td>
                  <td title={isPlaceholder ? game.probability_basis ?? undefined : undefined}>{formatPercent(probability, 1)}</td>
                  <td><span className={cls("result-pill", game.is_completed ? won ? "win" : "loss" : "future")}>{isPlaceholder ? "TBD" : game.is_completed ? won ? "W" : "L" : "Proj"}</span></td>
                  <td>{game.is_completed ? `${formatNumber(teamScore, 0)}-${formatNumber(opponentScore, 0)}` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div> : <EmptyState title="No schedule rows" detail="No schedule rows are available for this team and season yet." />}
    </section>
  );
}

function playoffBadgeClass(status: string | null | undefined): string {
  if (status === "Playoff") return "playoff";
  if (status === "Play-In") return "play-in";
  return "lottery";
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TRADE_ACCEPTED_DIFF = 10_000_000;
const TRADE_MAYBE_DIFF = 20_000_000;
const TRADE_IMPACT_DENOMINATOR = 48 * 82 * 0.9;
const TRADE_PICK_VALUE_YEARS = 1;
const TRADE_PICK_PROTECTIONS = [
  { label: "Unprotected", cutoff: 0 },
  { label: "Top-3 protected", cutoff: 3 },
  { label: "Top-5 protected", cutoff: 5 },
  { label: "Top-8 protected", cutoff: 8 },
  { label: "Top-10 protected", cutoff: 10 },
  { label: "Top-14 protected", cutoff: 14 }
];
const TRADE_SWAP_VALUE_FACTOR = 0.35;

function TradeRecommendationsWorkspace({ data, season, onOpenSandbox }: { data: AppData; season: number; onOpenSandbox: () => void }) {
  const players = useMemo(() => data.players.filter((player) => player.year === season), [data.players, season]);
  const teamOptions = useMemo(() => {
    const baseTeams = data.teams
      .filter((team) => team.year === season && ((team.scenario_id ?? "base") === "base"))
      .sort((a, b) => a.team.localeCompare(b.team));
    const seen = new Set(baseTeams.map((team) => team.team));
    const fallbackTeams = Array.from(new Set(players.map((player) => player.team)))
      .filter((team) => team && !seen.has(team))
      .sort()
      .map((team) => ({
        year: season,
        team,
        team_abbr: team,
        projected_wins: 41,
        expected_wins: 41,
        conference_rank: 0,
        playoff_status: ""
      } as TeamProjection));
    return [...baseTeams, ...fallbackTeams];
  }, [data.teams, players, season]);
  const teamMeta = useMemo(() => new Map(teamOptions.map((team) => [team.team, team])), [teamOptions]);
  const defaultTeam = teamOptions[0]?.team ?? players[0]?.team ?? "";
  const [selectedTeam, setSelectedTeam] = useSessionState("tradeRecs:team", defaultTeam);
  const calendar = useMemo(() => defaultTradeCalendar(data.schedules, season), [data.schedules, season]);
  const contractMap = useMemo(() => buildTradeContractMap(data.capTracker?.contracts ?? []), [data.capTracker]);
  const pickContext = useMemo(() => buildTradePickContext(data.picks, data.capTracker, season), [data.capTracker, data.picks, season]);

  useEffect(() => {
    if (!teamOptions.length) return;
    setSelectedTeam((current) => teamOptions.some((team) => cleanTeamValue(team.team) === cleanTeamValue(current)) ? current : defaultTeam);
  }, [defaultTeam, setSelectedTeam, teamOptions]);

  const selectedMeta = tradeSuggestionTeamMeta(teamOptions, selectedTeam);
  const recommendations = useMemo(
    () => buildTeamTradeRecommendations({
      data,
      season,
      players,
      focusTeam: selectedTeam,
      teamOptions,
      pickContext,
      contractMap,
      calendar
    }),
    [calendar, contractMap, data, pickContext, players, season, selectedTeam, teamOptions]
  );
  const acceptedCount = recommendations.filter((item) => item.verdict === "Accepted").length;
  const maybeCount = recommendations.filter((item) => item.verdict === "Maybe").length;
  const needLabels = selectedMeta ? tradeRecommendationNeedLabels(selectedMeta) : [];

  const openRecommendation = (recommendation: TradeRecommendation) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("trade:left", JSON.stringify(recommendation.left));
      window.sessionStorage.setItem("trade:right", JSON.stringify(recommendation.right));
      window.sessionStorage.setItem("trade:third", JSON.stringify(null));
      window.sessionStorage.setItem("trade:panelTab", JSON.stringify("review"));
    }
    onOpenSandbox();
  };

  return (
    <main className="workspace trade-recs-workspace">
      <section className="trade-recs-toolbar">
        <div className="section-heading">
          <span>Trade recommendations</span>
          <h2>{selectedMeta ? teamLabel(selectedMeta.team, teamMeta) : "Select team"}</h2>
        </div>
        <label className="trade-recs-selector">
          <span>Team</span>
          <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
            {teamOptions.map((team) => (
              <option key={team.team} value={team.team}>{teamLabel(team.team, teamMeta)}</option>
            ))}
          </select>
        </label>
        <div className="trade-recs-kpis">
          <MetricPill label="Recommendations" value={formatNumber(recommendations.length, 0)} tone="gold" />
          <MetricPill label="Accepted" value={formatNumber(acceptedCount, 0)} tone="green" />
          <MetricPill label="Maybe" value={formatNumber(maybeCount, 0)} tone="teal" />
        </div>
      </section>

      <section className="trade-recs-context">
        <div>
          <span>Needs</span>
          <strong>{needLabels.length ? needLabels.join(" / ") : "Balanced"}</strong>
        </div>
        <div>
          <span>Sort</span>
          <strong>Mutual viability + interest</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>Fit, timeline, value, scale, CBA</strong>
        </div>
      </section>

      <section className="trade-recs-list">
        {recommendations.length === 0 ? (
          <div className="empty trade-recs-empty">No legal or reviewable recommendations cleared the model screens for this team.</div>
        ) : recommendations.map((recommendation, index) => (
          <TradeRecommendationCard
            key={recommendation.id}
            rank={index + 1}
            recommendation={recommendation}
            teamMeta={teamMeta}
            onOpen={() => openRecommendation(recommendation)}
          />
        ))}
      </section>
    </main>
  );
}

function TradeRecommendationCard({
  rank,
  recommendation,
  teamMeta,
  onOpen
}: {
  rank: number;
  recommendation: TradeRecommendation;
  teamMeta: Map<string, TeamProjection>;
  onOpen: () => void;
}) {
  return (
    <article className="trade-rec-card">
      <div className="trade-rec-rank">{rank}</div>
      <div className="trade-rec-main">
        <div className="trade-rec-head">
          <div>
            <span className={cls("trade-route-verdict", verdictClass(recommendation.verdict))}>{recommendation.verdict}</span>
            <h3>{recommendation.title}</h3>
            <small>{teamLabel(recommendation.focusTeam, teamMeta)} with {teamLabel(recommendation.opponentTeam, teamMeta)} / {recommendation.packageType}</small>
          </div>
          <div className="trade-rec-score">
            <span>Mutual</span>
            <strong>{formatNumber(recommendation.mutualScore, 1)}</strong>
          </div>
        </div>
        <div className="trade-rec-lanes">
          <TradeRecommendationLane label={`${teamLabel(recommendation.focusTeam, teamMeta)} sends`} assets={recommendation.focusSends} />
          <TradeRecommendationLane label={`${teamLabel(recommendation.focusTeam, teamMeta)} receives`} assets={recommendation.focusReceives} />
        </div>
        <div className="trade-suggestion-reasons trade-rec-reasons">
          {recommendation.reasons.slice(0, 5).map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      </div>
      <div className="trade-rec-metrics">
        <MetricPill label="Team interest" value={formatNumber(recommendation.focusInterest, 1)} tone={recommendation.focusInterest >= 60 ? "green" : "teal"} />
        <MetricPill label="Other interest" value={formatNumber(recommendation.opponentInterest, 1)} tone={recommendation.opponentInterest >= 60 ? "green" : "teal"} />
        <MetricPill label="Value diff" value={formatMoney(recommendation.valueDiff)} tone={recommendation.valueDiff <= TRADE_ACCEPTED_DIFF ? "green" : "teal"} />
        <MetricPill label="Scale diff" value={formatMoney(recommendation.scaleDiff)} tone={recommendation.scaleDiff <= TRADE_ACCEPTED_DIFF ? "green" : "teal"} />
        <MetricPill label="Net impact" value={formatSigned(recommendation.netImpact, 2)} tone={recommendation.netImpact >= 0 ? "green" : "teal"} />
        <MetricPill label="CBA" value={tradeMachineStatusLabel(recommendation.cbaStatus === "missing" ? undefined : recommendation.cbaStatus)} tone={tradeMachineTone(recommendation.cbaStatus === "missing" ? undefined : recommendation.cbaStatus)} />
      </div>
      <button className="trade-rec-open" onClick={onOpen}>Open</button>
    </article>
  );
}

function TradeRecommendationLane({ label, assets }: { label: string; assets: TradeAsset[] }) {
  return (
    <div className="trade-rec-lane">
      <span>{label}</span>
      {assets.length === 0 ? <strong>No outgoing assets</strong> : assets.map((asset) => (
        <div key={asset.id} className="trade-rec-asset">
          <strong>{assetLabel(asset)}</strong>
          <small>{assetMeta(asset)}</small>
        </div>
      ))}
    </div>
  );
}

function TradeWorkspace({ data, season }: { data: AppData; season: number }) {
  const players = useMemo(
    () => data.players.filter((player) => player.year === season).sort((a, b) => playerTradeValue(b) - playerTradeValue(a)),
    [data.players, season]
  );
  const playerMap = useMemo(() => new Map(players.map((player) => [player.nba_id, player])), [players]);
  const pickMap = useMemo(() => new Map(data.picks.map((pick) => [pick.asset_id, pick])), [data.picks]);
  const contractMap = useMemo(() => buildTradeContractMap(data.capTracker?.contracts ?? []), [data.capTracker]);
  const teamOptions = useMemo(() => {
    const baseTeams = data.teams
      .filter((team) => team.year === season && ((team.scenario_id ?? "base") === "base"))
      .sort((a, b) => (a.team_name ?? a.team).localeCompare(b.team_name ?? b.team));
    const seen = new Set(baseTeams.map((team) => team.team));
    const fallbackTeams = Array.from(new Set(players.map((player) => player.team)))
      .filter((team) => !seen.has(team))
      .sort()
      .map((team) => ({
        year: season,
        team,
        team_name: team,
        team_abbr: team,
        conference: "All",
        scenario_id: "base",
        scenario_label: "Base Case",
        roster_count: 0,
        minutes: 0,
        raw_offense: 0,
        raw_defense: 0,
        raw_total: 0,
        adjusted_total: 0,
        offense: 0,
        defense: 0,
        total: 0,
        win_units: 0,
        projected_wins: 0,
        projected_losses: 0,
        win_pct: 0,
        expected_wins: 0,
        expected_losses: 0,
        league_rank: 0,
        rank: 0,
        conference_rank: 0,
        playoff_status: ""
      } as TeamProjection));
    return [...baseTeams, ...fallbackTeams];
  }, [data.teams, players, season]);
  const teamMeta = useMemo(() => new Map(teamOptions.map((team) => [team.team, team])), [teamOptions]);
  const defaultLeftTeam = teamOptions[0]?.team ?? players[0]?.team ?? "";
  const defaultRightTeam = teamOptions[1]?.team ?? teamOptions[0]?.team ?? players[1]?.team ?? defaultLeftTeam;
  const calendarDefaults = useMemo(() => defaultTradeCalendar(data.schedules, season), [data.schedules, season]);
  const [left, setLeft] = useSessionState<TradeSideState>("trade:left", { team: defaultLeftTeam, assets: [] });
  const [right, setRight] = useSessionState<TradeSideState>("trade:right", { team: defaultRightTeam, assets: [] });
  const [third, setThird] = useSessionState<TradeSideState | null>("trade:third", null);
  const [savedScenarios, setSavedScenarios] = useSessionState<SavedTradeScenario[]>(
    "trade:savedScenarios",
    [],
    (stored) => normalizeSavedTradeScenarios(stored, playerMap, pickMap)
  );
  const [loadedScenarioId, setLoadedScenarioId] = useSessionState<string | null>("trade:loadedScenarioId", null);
  const [scenarioName, setScenarioName] = useSessionState("trade:scenarioName", "");
  const [scenarioUserNote, setScenarioUserNote] = useSessionState("trade:scenarioUserNote", "");
  const [savedScenarioFilter, setSavedScenarioFilter] = useSessionState<SavedScenarioFilter>("trade:savedScenarioFilter", DEFAULT_SAVED_SCENARIO_FILTER);
  const [savedScenarioQuery, setSavedScenarioQuery] = useSessionState("trade:savedScenarioQuery", "");
  const [savedScenarioSort, setSavedScenarioSort] = useSessionState<SavedScenarioSort>("trade:savedScenarioSort", DEFAULT_SAVED_SCENARIO_SORT);
  const [scenarioImportNote, setScenarioImportNote] = useState("");
  const [lastDeletedScenarios, setLastDeletedScenarios] = useState<SavedTradeScenario[]>([]);
  const [lastDeletedScenarioMode, setLastDeletedScenarioMode] = useState<"single" | "bulk">("single");
  const scenarioImportRef = useRef<HTMLInputElement | null>(null);
  const [calendar, setCalendar] = useSessionState<TradeCalendarState>("trade:calendar", calendarDefaults);
  const [leftCashAmount, setLeftCashAmount] = useSessionState("trade:leftCashAmount", "");
  const [rightCashAmount, setRightCashAmount] = useSessionState("trade:rightCashAmount", "");
  const [thirdCashAmount, setThirdCashAmount] = useSessionState("trade:thirdCashAmount", "");
  const [leftRosterQuery, setLeftRosterQuery] = useSessionState("trade:leftRosterQuery", "");
  const [rightRosterQuery, setRightRosterQuery] = useSessionState("trade:rightRosterQuery", "");
  const [thirdRosterQuery, setThirdRosterQuery] = useSessionState("trade:thirdRosterQuery", "");
  const [leftPickBuilder, setLeftPickBuilder] = useSessionState<TradePickBuilderState>(
    "trade:leftPickBuilder",
    defaultTradePickBuilder(season)
  );
  const [rightPickBuilder, setRightPickBuilder] = useSessionState<TradePickBuilderState>(
    "trade:rightPickBuilder",
    defaultTradePickBuilder(season)
  );
  const [thirdPickBuilder, setThirdPickBuilder] = useSessionState<TradePickBuilderState>(
    "trade:thirdPickBuilder",
    defaultTradePickBuilder(season)
  );
  const [leftActualPickId, setLeftActualPickId] = useSessionState("trade:leftActualPickId", "");
  const [rightActualPickId, setRightActualPickId] = useSessionState("trade:rightActualPickId", "");
  const [thirdActualPickId, setThirdActualPickId] = useSessionState("trade:thirdActualPickId", "");
  const [tradePanelTab, setTradePanelTab] = useSessionState<TradePanelTab>("trade:panelTab", "review");

  const leftSide = useMemo(() => hydrateTradeSide(left, playerMap, pickMap), [left, pickMap, playerMap]);
  const rightSide = useMemo(() => hydrateTradeSide(right, playerMap, pickMap), [right, pickMap, playerMap]);
  const thirdSide = useMemo(() => third ? hydrateTradeSide(third, playerMap, pickMap) : null, [pickMap, playerMap, third]);
  const activeSides = useMemo(() => [leftSide, rightSide, ...(thirdSide ? [thirdSide] : [])], [leftSide, rightSide, thirdSide]);
  const activeSideTeams = useMemo(() => activeSides.map((side) => side.team), [activeSides]);
  const isMultiTeamTrade = activeSides.length > 2;
  const pickContext = useMemo(() => buildTradePickContext(data.picks, data.capTracker, season), [data.capTracker, data.picks, season]);
  const hasAssets = players.length > 0 || data.picks.length > 0;
  const tradeMachineResult = useMemo(
    () => buildTradeMachineResult(data, season, players, activeSides, contractMap, calendar),
    [activeSides, calendar, contractMap, data, players, season]
  );
  const routeSummaries = useMemo(() => buildTradeRouteSummaries(activeSides, tradeMachineResult), [activeSides, tradeMachineResult]);
  const routeLanes = useMemo(() => buildTradeRouteLanes(activeSides), [activeSides]);
  const reviewItems = useMemo(() => buildTradeReviewItems(tradeMachineResult, teamMeta), [teamMeta, tradeMachineResult]);
  const valueBalance = !isMultiTeamTrade ? tradeMachineResult?.valueBalance : undefined;
  const teamValueBalances = isMultiTeamTrade ? tradeMachineResult?.teamValueBalances : undefined;
  const leftTeamBalance = tradeMachineTeamValueBalance(tradeMachineResult, leftSide.team);
  const rightTeamBalance = tradeMachineTeamValueBalance(tradeMachineResult, rightSide.team);
  const thirdTeamBalance = thirdSide ? tradeMachineTeamValueBalance(tradeMachineResult, thirdSide.team) : null;
  const leftTotal = valueBalance?.leftOutgoingValue ?? leftTeamBalance?.outgoingValue ?? assetTotal(leftSide.assets);
  const rightTotal = valueBalance?.rightOutgoingValue ?? rightTeamBalance?.outgoingValue ?? assetTotal(rightSide.assets);
  const thirdTotal = thirdSide ? thirdTeamBalance?.outgoingValue ?? assetTotal(thirdSide.assets) : 0;
  const leftScaleTotal = valueBalance?.leftOutgoingScaleAdjustedValue ?? leftTeamBalance?.outgoingScaleAdjustedValue ?? scaleAdjustedAssetTotal(leftSide.assets);
  const rightScaleTotal = valueBalance?.rightOutgoingScaleAdjustedValue ?? rightTeamBalance?.outgoingScaleAdjustedValue ?? scaleAdjustedAssetTotal(rightSide.assets);
  const multiValueDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.valueDeficit) ?? []));
  const multiScaleDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.scaleAdjustedDeficit) ?? []));
  const multiBalanceDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.balanceDeficit) ?? []));
  const diff = isMultiTeamTrade ? multiValueDeficit : valueBalance?.valueDiff ?? Math.abs(leftTotal - rightTotal);
  const scaleDiff = isMultiTeamTrade ? multiScaleDeficit : valueBalance?.scaleAdjustedDiff ?? Math.abs(leftScaleTotal - rightScaleTotal);
  const balanceDiff = isMultiTeamTrade ? multiBalanceDeficit : valueBalance?.balanceDiff ?? Math.max(diff, scaleDiff);
  const verdict = tradeMachineResult && !tradeMachineResult.legal
    ? "Declined"
    : isMultiTeamTrade
      ? tradeMachineMultiTeamVerdictLabel(tradeMachineResult) ?? tradeVerdict(balanceDiff)
      : tradeMachineValueVerdictLabel(valueBalance?.verdict) ?? tradeVerdict(balanceDiff);
  const whoSaysNo = tradeMachineResult && !tradeMachineResult.legal
    ? tradeMachineSaysNoLabel(tradeMachineResult)
    : isMultiTeamTrade
      ? tradeMachineMultiTeamSaysNoLabel(tradeMachineResult, teamMeta) ?? whoSaysNoLabel(leftSide, rightSide, balanceDiff)
      : tradeMachineValueSaysNoLabel(valueBalance) ?? whoSaysNoLabel(leftSide, rightSide, balanceDiff);
  const leftImpact = tradeImpactSummary(leftSide.assets);
  const rightImpact = tradeImpactSummary(rightSide.assets);
  const thirdImpact = thirdSide ? tradeImpactSummary(thirdSide.assets) : null;
  const leftDelta = subtractTradeImpact(tradeIncomingImpactForTeam(activeSides, leftSide.team), leftImpact);
  const rightDelta = subtractTradeImpact(tradeIncomingImpactForTeam(activeSides, rightSide.team), rightImpact);
  const thirdDelta = thirdSide ? subtractTradeImpact(tradeIncomingImpactForTeam(activeSides, thirdSide.team), thirdImpact ?? emptyTradeImpactSummary()) : null;
  const selectedPlayerIds = useMemo(() => selectedTradePlayerIds(...activeSides.map((side) => side.assets)), [activeSides]);
  const savedScenarioCounts = useMemo(() => savedTradeScenarioFilterCounts(savedScenarios), [savedScenarios]);
  const hasCustomSavedScenarioView = !savedTradeScenarioViewIsDefault(savedScenarioFilter, savedScenarioQuery, savedScenarioSort);
  const visibleSavedScenarios = useMemo(
    () => sortSavedTradeScenarios(
      savedScenarios.filter((scenario) =>
        savedTradeScenarioMatchesFilter(scenario, savedScenarioFilter)
        && savedTradeScenarioMatchesQuery(scenario, savedScenarioQuery, savedTradeScenarioSearchDisplayTerms(scenario, teamMeta))
      ),
      savedScenarioSort
    ),
    [savedScenarioFilter, savedScenarioQuery, savedScenarioSort, savedScenarios, teamMeta]
  );
  const savedScenarioViewSummary = useMemo(
    () => savedTradeScenarioViewSummary(visibleSavedScenarios.length, savedScenarios.length, savedScenarioFilter, savedScenarioQuery, savedScenarioSort),
    [savedScenarioFilter, savedScenarioQuery, savedScenarioSort, savedScenarios.length, visibleSavedScenarios.length]
  );
  const clearableVisibleSavedScenarios = useMemo(
    () => visibleSavedScenarios.filter((scenario) => savedScenarioFilter === "pinned" || !scenario.pinned),
    [savedScenarioFilter, visibleSavedScenarios]
  );
  const editingSavedScenario = useMemo(
    () => loadedScenarioId ? savedScenarios.find((scenario) => scenario.id === loadedScenarioId) ?? null : null,
    [loadedScenarioId, savedScenarios]
  );
  const leftRoster = useMemo(() => tradeRoster(players, leftSide.team), [leftSide.team, players]);
  const rightRoster = useMemo(() => tradeRoster(players, rightSide.team), [rightSide.team, players]);
  const thirdRoster = useMemo(() => thirdSide ? tradeRoster(players, thirdSide.team) : [], [players, thirdSide]);
  const leftPickPreview = useMemo(
    () => buildTradePickAsset(leftPickBuilder, pickContext, season, leftSide.team, teamOptions),
    [leftPickBuilder, leftSide.team, pickContext, season, teamOptions]
  );
  const rightPickPreview = useMemo(
    () => buildTradePickAsset(rightPickBuilder, pickContext, season, rightSide.team, teamOptions),
    [pickContext, rightPickBuilder, rightSide.team, season, teamOptions]
  );
  const thirdPickPreview = useMemo(
    () => buildTradePickAsset(thirdPickBuilder, pickContext, season, thirdSide?.team ?? "", teamOptions),
    [pickContext, season, thirdPickBuilder, thirdSide?.team, teamOptions]
  );
  const leftActualPicks = useMemo(() => tradeTeamPickAssets(data.picks, leftSide.team, season), [data.picks, leftSide.team, season]);
  const rightActualPicks = useMemo(() => tradeTeamPickAssets(data.picks, rightSide.team, season), [data.picks, rightSide.team, season]);
  const thirdActualPicks = useMemo(() => tradeTeamPickAssets(data.picks, thirdSide?.team ?? "", season), [data.picks, thirdSide?.team, season]);
  const leftActualPick = useMemo(() => selectedActualPick(leftActualPicks, leftActualPickId), [leftActualPickId, leftActualPicks]);
  const rightActualPick = useMemo(() => selectedActualPick(rightActualPicks, rightActualPickId), [rightActualPickId, rightActualPicks]);
  const thirdActualPick = useMemo(() => selectedActualPick(thirdActualPicks, thirdActualPickId), [thirdActualPickId, thirdActualPicks]);
  const tradeSuggestions = useMemo(
    () => buildTradeSuggestions({
      data,
      season,
      players,
      leftTeam: leftSide.team,
      rightTeam: rightSide.team,
      teamOptions,
      pickContext,
      contractMap,
      calendar
    }),
    [calendar, contractMap, data, leftSide.team, pickContext, players, rightSide.team, season, teamOptions]
  );

  useEffect(() => {
    if (teamOptions.length === 0) return;
    setLeft((current) => teamOptions.some((team) => team.team === current.team) ? current : { ...current, team: defaultLeftTeam });
    setRight((current) => teamOptions.some((team) => team.team === current.team) ? current : { ...current, team: defaultRightTeam });
    setThird((current) => {
      if (!current) return current;
      return teamOptions.some((team) => team.team === current.team) ? current : null;
    });
  }, [defaultLeftTeam, defaultRightTeam, setLeft, setRight, setThird, teamOptions]);

  const setSideTeam = (side: "left" | "right" | "third", team: string) => {
    const previousTeam = side === "left" ? leftSide.team : side === "right" ? rightSide.team : thirdSide?.team ?? "";
    if (side === "left") setLeft({ team, assets: [] });
    else if (side === "right") setRight({ team, assets: [] });
    else setThird({ team, assets: [] });
    if (previousTeam && previousTeam !== team) {
      retargetTradeDestinations(previousTeam, team, side);
    }
  };
  const updatePickBuilder = (side: "left" | "right" | "third", patch: Partial<TradePickBuilderState>) => {
    if (side === "left") setLeftPickBuilder((current) => ({ ...current, ...patch }));
    else if (side === "right") setRightPickBuilder((current) => ({ ...current, ...patch }));
    else setThirdPickBuilder((current) => ({ ...current, ...patch }));
  };
  const togglePlayer = (side: "left" | "right" | "third", player: PlayerImpact) => {
    const target = side === "left" ? leftSide : side === "right" ? rightSide : thirdSide;
    if (!target) return;
    const oppositeSides = activeSides.filter((item) => item.team !== target.team);
    const onTarget = target.assets.some((asset) => asset.kind === "player" && asset.player?.nba_id === player.nba_id);
    const onOpposite = oppositeSides.some((opposite) => opposite.assets.some((asset) => asset.kind === "player" && asset.player?.nba_id === player.nba_id));
    if (onOpposite) return;
    const nextAssets = onTarget
      ? target.assets.filter((asset) => !(asset.kind === "player" && asset.player?.nba_id === player.nba_id))
      : [...target.assets, withDefaultTradeDestination(playerTradeAsset(player), target.team, activeSides)];
    if (side === "left") setLeft({ ...target, assets: nextAssets });
    else if (side === "right") setRight({ ...target, assets: nextAssets });
    else setThird({ ...target, assets: nextAssets });
  };
  const addPick = (side: "left" | "right" | "third", pickOverride?: PickAsset | null) => {
    const selectedPick = pickOverride ?? (side === "left" ? leftPickPreview : side === "right" ? rightPickPreview : thirdPickPreview);
    const target = side === "left" ? leftSide : side === "right" ? rightSide : thirdSide;
    if (!selectedPick) return;
    if (!target) return;
    const asset = withDefaultTradeDestination(pickTradeAsset(selectedPick), target.team, activeSides);
    if (side === "left") setLeft((current) => ({ ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] }));
    else if (side === "right") setRight((current) => ({ ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] }));
    else setThird((current) => current ? { ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] } : current);
  };
  const addCash = (side: "left" | "right" | "third") => {
    const value = side === "left" ? leftCashAmount : side === "right" ? rightCashAmount : thirdCashAmount;
    const target = side === "left" ? leftSide : side === "right" ? rightSide : thirdSide;
    const amount = parseTradeCashInput(value);
    if (amount <= 0) return;
    if (!target) return;
    const asset = withDefaultTradeDestination(cashTradeAsset(amount), target.team, activeSides);
    if (side === "left") {
      setLeft((current) => ({ ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] }));
      setLeftCashAmount("");
    } else if (side === "right") {
      setRight((current) => ({ ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] }));
      setRightCashAmount("");
    } else {
      setThird((current) => current ? { ...current, assets: [...hydrateTradeSide(current, playerMap, pickMap).assets, asset] } : current);
      setThirdCashAmount("");
    }
  };
  const loadSuggestion = (suggestion: TradeSuggestion) => {
    setLeft(suggestion.left);
    setRight(suggestion.right);
    setThird(null);
    setScenarioName(suggestion.title);
    setScenarioUserNote(suggestion.reasons.join("; "));
    setTradePanelTab("review");
  };
  const removeAsset = (side: "left" | "right" | "third", index: number) => {
    if (side === "left") setLeft((current) => ({ ...current, assets: hydrateTradeSide(current, playerMap, pickMap).assets.filter((_, i) => i !== index) }));
    else if (side === "right") setRight((current) => ({ ...current, assets: hydrateTradeSide(current, playerMap, pickMap).assets.filter((_, i) => i !== index) }));
    else setThird((current) => current ? { ...current, assets: hydrateTradeSide(current, playerMap, pickMap).assets.filter((_, i) => i !== index) } : current);
  };
  const updateAssetDestination = (side: "left" | "right" | "third", index: number, toTeam: string) => {
    const update = (current: TradeSideState) => ({
      ...current,
      assets: hydrateTradeSide(current, playerMap, pickMap).assets.map((asset, i) => i === index ? { ...asset, toTeam } : asset)
    });
    if (side === "left") setLeft(update);
    else if (side === "right") setRight(update);
    else setThird((current) => current ? update(current) : current);
  };
  const clearSide = (side: "left" | "right" | "third") => {
    if (side === "left") setLeft((current) => ({ ...current, assets: [] }));
    else if (side === "right") setRight((current) => ({ ...current, assets: [] }));
    else setThird((current) => current ? { ...current, assets: [] } : current);
  };
  const addThirdTeam = () => {
    const team = defaultThirdTradeTeam(teamOptions, leftSide.team, rightSide.team);
    if (!team) return;
    setLeft((current) => routeTradeSideAssetsToTeam(hydrateTradeSide(current, playerMap, pickMap), rightSide.team));
    setRight((current) => routeTradeSideAssetsToTeam(hydrateTradeSide(current, playerMap, pickMap), leftSide.team));
    setThird({ team, assets: [] });
  };
  const removeThirdTeam = () => {
    setLeft((current) => routeTradeSideAssetsToTeam(hydrateTradeSide(current, playerMap, pickMap), rightSide.team));
    setRight((current) => routeTradeSideAssetsToTeam(hydrateTradeSide(current, playerMap, pickMap), leftSide.team));
    setThird(null);
    setThirdPickBuilder(defaultTradePickBuilder(season));
    setThirdCashAmount("");
    setThirdRosterQuery("");
  };
  const retargetTradeDestinations = (fromTeam: string, toTeam: string, changedSide: "left" | "right" | "third") => {
    const retarget = (current: TradeSideState) => ({
      ...current,
      assets: hydrateTradeSide(current, playerMap, pickMap).assets.map((asset) => asset.toTeam === fromTeam ? { ...asset, toTeam } : asset)
    });
    if (changedSide !== "left") setLeft(retarget);
    if (changedSide !== "right") setRight(retarget);
    if (changedSide !== "third") setThird((current) => current ? retarget(current) : current);
  };
  const resetTrade = () => {
    setLeft({ team: defaultLeftTeam, assets: [] });
    setRight({ team: defaultRightTeam, assets: [] });
    setThird(null);
    setLeftPickBuilder(defaultTradePickBuilder(season));
    setRightPickBuilder(defaultTradePickBuilder(season));
    setThirdPickBuilder(defaultTradePickBuilder(season));
    setLeftCashAmount("");
    setRightCashAmount("");
    setThirdCashAmount("");
    setLeftRosterQuery("");
    setRightRosterQuery("");
    setThirdRosterQuery("");
    setCalendar(calendarDefaults);
    setLoadedScenarioId(null);
    setScenarioName("");
    setScenarioUserNote("");
  };
  const clearSavedScenarioView = () => {
    setSavedScenarioFilter(DEFAULT_SAVED_SCENARIO_FILTER);
    setSavedScenarioQuery("");
    setSavedScenarioSort(DEFAULT_SAVED_SCENARIO_SORT);
  };
  const clearScenarioForm = () => {
    setLoadedScenarioId(null);
    setScenarioName("");
    setScenarioUserNote("");
    setScenarioImportNote("Cleared scenario form");
  };
  const saveScenario = () => {
    const name = scenarioName.trim() || `Scenario ${savedScenarios.length + 1}`;
    const existingByName = savedScenarios.find((scenario) => scenario.name.trim().toLowerCase() === name.trim().toLowerCase());
    const editingId = editingSavedScenario?.id ?? null;
    const scenario: SavedTradeScenario = {
      id: editingId ?? `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      userNote: scenarioUserNote.trim() || undefined,
      left: leftSide,
      right: rightSide,
      third: thirdSide,
      calendar,
      snapshot: currentSavedTradeSnapshot(verdict, tradeMachineResult, diff, scaleDiff, whoSaysNo)
    };
    setSavedScenarios((current) => upsertSavedTradeScenario(current, scenario, { match: editingId ? "id" : "name" }));
    setLoadedScenarioId(editingId ?? existingByName?.id ?? scenario.id);
    setScenarioName(name);
    setScenarioUserNote(scenario.userNote ?? "");
    setScenarioImportNote(editingId ? "Updated scenario" : "Saved scenario");
  };
  const saveScenarioCopy = () => {
    const baseName = scenarioName.trim() || editingSavedScenario?.name || `Scenario ${savedScenarios.length + 1}`;
    const name = savedTradeScenarioCopyName(baseName, savedScenarios.map((scenario) => scenario.name));
    const scenario: SavedTradeScenario = {
      id: `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: new Date().toISOString(),
      userNote: scenarioUserNote.trim() || undefined,
      left: leftSide,
      right: rightSide,
      third: thirdSide,
      calendar,
      snapshot: currentSavedTradeSnapshot(verdict, tradeMachineResult, diff, scaleDiff, whoSaysNo)
    };
    setSavedScenarios((current) => retainSavedTradeScenarios([scenario, ...current.filter((item) => item.id !== scenario.id)]));
    setLoadedScenarioId(scenario.id);
    setScenarioName(name);
    setScenarioUserNote(scenario.userNote ?? "");
    setScenarioImportNote(`Saved copy ${name}`);
  };
  const loadScenario = (scenario: SavedTradeScenario) => {
    setLeft(hydrateTradeSide(scenario.left, playerMap, pickMap));
    setRight(hydrateTradeSide(scenario.right, playerMap, pickMap));
    setThird(scenario.third ? hydrateTradeSide(scenario.third, playerMap, pickMap) : null);
    if (scenario.calendar) setCalendar(scenario.calendar);
    setLoadedScenarioId(scenario.id);
    setScenarioName(scenario.name);
    setScenarioUserNote(scenario.userNote ?? "");
  };
  const deleteScenario = (scenario: SavedTradeScenario) => {
    setSavedScenarios((current) => current.filter((item) => item.id !== scenario.id));
    if (loadedScenarioId === scenario.id) setLoadedScenarioId(null);
    setLastDeletedScenarios([scenario]);
    setLastDeletedScenarioMode("single");
    setScenarioImportNote(`Deleted ${scenario.name}`);
  };
  const restoreDeletedScenarios = () => {
    if (lastDeletedScenarios.length === 0) return;
    setSavedScenarios((current) => restoreSavedTradeScenarios(current, lastDeletedScenarios));
    setLoadedScenarioId(lastDeletedScenarios[0].id);
    setScenarioName(lastDeletedScenarios[0].name);
    setScenarioUserNote(lastDeletedScenarios[0].userNote ?? "");
    setScenarioImportNote(`Restored ${lastDeletedScenarios.length} scenario${lastDeletedScenarios.length === 1 ? "" : "s"}`);
    setLastDeletedScenarios([]);
    setLastDeletedScenarioMode("single");
  };
  const clearVisibleSavedScenarios = () => {
    if (clearableVisibleSavedScenarios.length === 0) {
      setScenarioImportNote(savedScenarioFilter === "pinned" ? "No pinned scenarios to clear" : "No visible unpinned scenarios to clear");
      return;
    }
    const result = clearVisibleSavedTradeScenarios(savedScenarios, visibleSavedScenarios, { includePinned: savedScenarioFilter === "pinned" });
    setSavedScenarios(result.scenarios);
    if (loadedScenarioId && result.deleted.some((scenario) => scenario.id === loadedScenarioId)) setLoadedScenarioId(null);
    setLastDeletedScenarios(result.deleted);
    setLastDeletedScenarioMode("bulk");
    setScenarioImportNote(`Cleared ${result.deleted.length} visible scenario${result.deleted.length === 1 ? "" : "s"}`);
  };
  const duplicateScenario = (scenario: SavedTradeScenario) => {
    const duplicated = duplicateSavedTradeScenario(scenario, { existingNames: savedScenarios.map((item) => item.name) });
    setSavedScenarios((current) => retainSavedTradeScenarios([duplicated, ...current.filter((item) => item.id !== duplicated.id)]));
    setLoadedScenarioId(duplicated.id);
    setScenarioName(duplicated.name);
    setScenarioUserNote(duplicated.userNote ?? "");
    setScenarioImportNote(`Duplicated ${duplicated.name}`);
  };
  const togglePinnedScenario = (scenario: SavedTradeScenario) => {
    const pinned = !scenario.pinned;
    setSavedScenarios((current) => current.map((item) => item.id === scenario.id ? { ...item, pinned } : item));
    setScenarioImportNote(`${pinned ? "Pinned" : "Unpinned"} ${scenario.name}`);
  };
  const refreshSavedScenarioStatuses = () => {
    const evaluatedAt = new Date().toISOString();
    setSavedScenarios((current) => current.map((scenario) => {
      const sides = savedTradeScenarioSides(scenario).map((side) => hydrateTradeSide(side, playerMap, pickMap));
      const scenarioCalendar = scenario.calendar ?? calendarDefaults;
      return {
        ...scenario,
        left: sides[0],
        right: sides[1],
        third: sides[2] ?? null,
        calendar: scenarioCalendar,
        snapshot: evaluateSavedTradeScenarioSnapshot(data, season, players, sides, contractMap, scenarioCalendar, teamMeta, evaluatedAt)
      };
    }));
    setScenarioImportNote(`Refreshed ${savedScenarios.length} saved status${savedScenarios.length === 1 ? "" : "es"}`);
  };
  const exportSavedScenarioSet = (
    scenariosToExport: SavedTradeScenario[],
    options: { visible?: boolean } = {}
  ) => {
    if (scenariosToExport.length === 0) {
      setScenarioImportNote(options.visible ? "No visible scenarios to export" : "No saved scenarios to export");
      return;
    }
    const payload = JSON.stringify(buildSavedTradeScenarioExportPayload(scenariosToExport, {
      season,
      scope: options.visible
        ? { kind: "visible", filter: savedScenarioFilter, query: savedScenarioQuery.trim(), sort: savedScenarioSort }
        : { kind: "all", sort: savedScenarioSort }
    }), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trade-scenarios-${season}${options.visible ? "-visible" : ""}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setScenarioImportNote(`Exported ${scenariosToExport.length} ${options.visible ? "visible " : ""}scenario${scenariosToExport.length === 1 ? "" : "s"}`);
  };
  const importSavedScenarios = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "[]")) as unknown;
        const imported = normalizeSavedTradeScenarios(parsed, playerMap, pickMap);
        if (imported.length === 0) {
          setScenarioImportNote("No valid trade scenarios found");
          return;
        }
        const importResult = mergeImportedSavedTradeScenarioResult(savedScenarios, imported);
        setSavedScenarios(importResult.scenarios);
        setScenarioImportNote(savedScenarioImportMergeNote(importResult.added, importResult.updated));
      } catch {
        setScenarioImportNote("Import failed: invalid JSON");
      }
    };
    reader.readAsText(file);
  };

  return (
    <main className={cls("workspace trade-grid", thirdSide && "three-team")}>
      {hasAssets ? <>
        <TradeSide
          title="Team 1 Sends"
          season={season}
          side={leftSide}
          roster={leftRoster}
          rosterQuery={leftRosterQuery}
          selectedPlayerIds={selectedPlayerIds}
          teamOptions={teamOptions}
          teamMeta={teamMeta}
          total={leftTotal}
          impact={leftImpact}
          delta={leftDelta}
          actualPicks={leftActualPicks}
          actualPickId={leftActualPick?.asset_id ?? ""}
          actualPickPreview={leftActualPick}
          unavailableTeams={activeSideTeams.filter((team) => team !== leftSide.team)}
          destinationOptions={tradeDestinationOptions(leftSide.team, activeSides)}
          showDestinations={isMultiTeamTrade}
          pickBuilder={leftPickBuilder}
          pickPreview={leftPickPreview}
          cashAmount={leftCashAmount}
          onTeamChange={(team) => setSideTeam("left", team)}
          onRosterQueryChange={setLeftRosterQuery}
          onTogglePlayer={(player) => togglePlayer("left", player)}
          onPickBuilderChange={(patch) => updatePickBuilder("left", patch)}
          onActualPickChange={setLeftActualPickId}
          onAddActualPick={() => addPick("left", leftActualPick)}
          onAddPick={() => addPick("left")}
          onCashAmountChange={setLeftCashAmount}
          onAddCash={() => addCash("left")}
          onRemove={(index) => removeAsset("left", index)}
          onDestinationChange={(index, toTeam) => updateAssetDestination("left", index, toTeam)}
          onClear={() => clearSide("left")}
        />
        <TradeSide
          title="Team 2 Sends"
          season={season}
          side={rightSide}
          roster={rightRoster}
          rosterQuery={rightRosterQuery}
          selectedPlayerIds={selectedPlayerIds}
          teamOptions={teamOptions}
          teamMeta={teamMeta}
          total={rightTotal}
          impact={rightImpact}
          delta={rightDelta}
          actualPicks={rightActualPicks}
          actualPickId={rightActualPick?.asset_id ?? ""}
          actualPickPreview={rightActualPick}
          unavailableTeams={activeSideTeams.filter((team) => team !== rightSide.team)}
          destinationOptions={tradeDestinationOptions(rightSide.team, activeSides)}
          showDestinations={isMultiTeamTrade}
          pickBuilder={rightPickBuilder}
          pickPreview={rightPickPreview}
          cashAmount={rightCashAmount}
          onTeamChange={(team) => setSideTeam("right", team)}
          onRosterQueryChange={setRightRosterQuery}
          onTogglePlayer={(player) => togglePlayer("right", player)}
          onPickBuilderChange={(patch) => updatePickBuilder("right", patch)}
          onActualPickChange={setRightActualPickId}
          onAddActualPick={() => addPick("right", rightActualPick)}
          onAddPick={() => addPick("right")}
          onCashAmountChange={setRightCashAmount}
          onAddCash={() => addCash("right")}
          onRemove={(index) => removeAsset("right", index)}
          onDestinationChange={(index, toTeam) => updateAssetDestination("right", index, toTeam)}
          onClear={() => clearSide("right")}
        />
        {thirdSide && <TradeSide
          title="Team 3 Sends"
          season={season}
          side={thirdSide}
          roster={thirdRoster}
          rosterQuery={thirdRosterQuery}
          selectedPlayerIds={selectedPlayerIds}
          teamOptions={teamOptions}
          teamMeta={teamMeta}
          total={thirdTotal}
          impact={thirdImpact ?? emptyTradeImpactSummary()}
          delta={thirdDelta ?? emptyTradeImpactSummary()}
          actualPicks={thirdActualPicks}
          actualPickId={thirdActualPick?.asset_id ?? ""}
          actualPickPreview={thirdActualPick}
          unavailableTeams={activeSideTeams.filter((team) => team !== thirdSide.team)}
          destinationOptions={tradeDestinationOptions(thirdSide.team, activeSides)}
          showDestinations={isMultiTeamTrade}
          pickBuilder={thirdPickBuilder}
          pickPreview={thirdPickPreview}
          cashAmount={thirdCashAmount}
          onTeamChange={(team) => setSideTeam("third", team)}
          onRosterQueryChange={setThirdRosterQuery}
          onTogglePlayer={(player) => togglePlayer("third", player)}
          onPickBuilderChange={(patch) => updatePickBuilder("third", patch)}
          onActualPickChange={setThirdActualPickId}
          onAddActualPick={() => addPick("third", thirdActualPick)}
          onAddPick={() => addPick("third")}
          onCashAmountChange={setThirdCashAmount}
          onAddCash={() => addCash("third")}
          onRemove={(index) => removeAsset("third", index)}
          onDestinationChange={(index, toTeam) => updateAssetDestination("third", index, toTeam)}
          onClear={() => clearSide("third")}
        />}
      </> : <section className="table-panel trade-side"><EmptyState title="No trade assets" detail={`No players or picks are available for ${season}.`} /></section>}
      <details className="detail-panel trade-verdict">
        <summary className="trade-verdict-summary">
          <span>Summary</span>
          <strong>{verdict}</strong>
          <em>{formatMoney(diff)}</em>
        </summary>
        <div className="trade-verdict-content">
          <div className="trade-verdict-head">
          <div className="trade-summary-title">
            <div>
              <h2>Trade Sandbox</h2>
              <p>4-year trade value: current season plus next 3 Player Impact seasons, adjusted for scale-based contract opportunity cost</p>
            </div>
            <div className="trade-summary-actions">
              <button className="clear-filters" disabled={!thirdSide && teamOptions.length < 3} onClick={thirdSide ? removeThirdTeam : addThirdTeam}>
                {thirdSide ? "Remove 3rd team" : "Add 3rd team"}
              </button>
              <button className="clear-filters" onClick={resetTrade}>Reset</button>
            </div>
          </div>
          <p>Value Diff</p>
          <h2>{formatMoney(diff)}</h2>
          <div className={cls("verdict", verdictClass(verdict))}>{verdict}</div>
          <span>{whoSaysNo}</span>
        </div>
          <div className="trade-scoreboard">
            <MetricPill label={`${teamLabel(leftSide.team, teamMeta)} sends`} value={formatMoney(leftTotal)} tone="gold" />
            <MetricPill label={`${teamLabel(rightSide.team, teamMeta)} sends`} value={formatMoney(rightTotal)} tone="gold" />
            {thirdSide && <MetricPill label={`${teamLabel(thirdSide.team, teamMeta)} sends`} value={formatMoney(thirdTotal)} tone="gold" />}
            <MetricPill label="Scale diff" value={formatMoney(scaleDiff)} tone={scaleDiff <= TRADE_ACCEPTED_DIFF ? "green" : "teal"} />
            <MetricPill label="CBA status" value={tradeMachineStatusLabel(tradeMachineResult?.status)} tone={tradeMachineTone(tradeMachineResult?.status)} />
            <MetricPill label={`${teamLabel(leftSide.team, teamMeta)} net`} value={formatSigned(leftDelta.total, 2)} tone={leftDelta.total >= 0 ? "green" : "teal"} />
            <MetricPill label={`${teamLabel(rightSide.team, teamMeta)} net`} value={formatSigned(rightDelta.total, 2)} tone={rightDelta.total >= 0 ? "green" : "teal"} />
            {thirdSide && thirdDelta && <MetricPill label={`${teamLabel(thirdSide.team, teamMeta)} net`} value={formatSigned(thirdDelta.total, 2)} tone={thirdDelta.total >= 0 ? "green" : "teal"} />}
          </div>
          <div className="segmented-control trade-summary-tabs" aria-label="Trade summary view">
            <button className={cls(tradePanelTab === "review" && "active")} onClick={() => setTradePanelTab("review")}>Review</button>
            <button className={cls(tradePanelTab === "suggestions" && "active")} onClick={() => setTradePanelTab("suggestions")}>Suggestions ({tradeSuggestions.length})</button>
          </div>
          {tradePanelTab === "review" ? <>
            <TradeRouteSummaryPanel summaries={routeSummaries} lanes={routeLanes} teamMeta={teamMeta} />
            <TradeReviewPanel items={reviewItems} />
            <TradeMachinePanel result={tradeMachineResult} teamMeta={teamMeta} />
          </> : <TradeSuggestionsPanel suggestions={tradeSuggestions} teamMeta={teamMeta} disabled={Boolean(thirdSide)} onLoad={loadSuggestion} />}
        <div className="scenario-tools">
          <label>
            Trade date
            <input type="date" value={calendar.tradeDate} onChange={(event) => setCalendar((current) => ({ ...current, tradeDate: event.target.value }))} />
          </label>
          <label>
            Trade deadline
            <input type="date" value={calendar.tradeDeadlineDate} onChange={(event) => setCalendar((current) => ({ ...current, tradeDeadlineDate: event.target.value }))} />
          </label>
          <label>
            Regular season end
            <input type="date" value={calendar.regularSeasonEndDate} onChange={(event) => setCalendar((current) => ({ ...current, regularSeasonEndDate: event.target.value }))} />
          </label>
          <button disabled={!calendarDefaults.regularSeasonEndDate || calendar.regularSeasonEndDate === calendarDefaults.regularSeasonEndDate} onClick={() => setCalendar((current) => ({ ...current, regularSeasonEndDate: calendarDefaults.regularSeasonEndDate }))}>Use schedule end</button>
        </div>
        <div className="scenario-tools scenario-save-tools">
          <label>
            Scenario
            <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Name this trade" />
          </label>
          <button onClick={saveScenario} disabled={activeSides.every((side) => side.assets.length === 0)}>{editingSavedScenario ? "Update" : "Save"}</button>
          {editingSavedScenario && <button onClick={saveScenarioCopy} disabled={activeSides.every((side) => side.assets.length === 0)}>Save copy</button>}
          <button onClick={clearScenarioForm} disabled={!editingSavedScenario && !scenarioName.trim() && !scenarioUserNote.trim()}>Clear form</button>
          <label className="scenario-note-field">
            Note
            <textarea value={scenarioUserNote} onChange={(event) => setScenarioUserNote(event.target.value)} placeholder="Why save this deal?" rows={2} />
          </label>
        </div>
        <div className="scenario-tools scenario-file-tools">
          <button onClick={() => exportSavedScenarioSet(savedScenarios)} disabled={savedScenarios.length === 0}>Export saved</button>
          <button onClick={() => exportSavedScenarioSet(visibleSavedScenarios, { visible: true })} disabled={visibleSavedScenarios.length === 0}>Export visible</button>
          <button onClick={() => scenarioImportRef.current?.click()}>Import saved</button>
          <button onClick={refreshSavedScenarioStatuses} disabled={savedScenarios.length === 0}>Refresh statuses</button>
          <button onClick={clearVisibleSavedScenarios} disabled={clearableVisibleSavedScenarios.length === 0}>{savedScenarioFilter === "pinned" ? "Clear visible" : "Clear unpinned"}</button>
          {lastDeletedScenarios.length > 0 && <button onClick={restoreDeletedScenarios}>{lastDeletedScenarioMode === "bulk" ? "Restore cleared" : "Restore deleted"}</button>}
          <input ref={scenarioImportRef} type="file" accept="application/json,.json" onChange={importSavedScenarios} hidden />
          {scenarioImportNote && <span className="scenario-import-note">{scenarioImportNote}</span>}
        </div>
        <div className="saved-scenarios">
          {savedScenarios.length === 0 && <p className="empty">No saved scenarios</p>}
          {savedScenarios.length > 0 && <div className="saved-scenario-filters" aria-label="Saved scenario filters">
            {SAVED_SCENARIO_FILTERS.map((filter) => (
              <button
                key={filter.key}
                className={cls(savedScenarioFilter === filter.key && "active")}
                onClick={() => setSavedScenarioFilter(filter.key)}
              >
                <span>{filter.label}</span>
                <strong>{savedScenarioCounts[filter.key]}</strong>
              </button>
            ))}
          </div>}
          {savedScenarios.length > 0 && <label className="saved-scenario-search">
            Search saved deals
            <input value={savedScenarioQuery} onChange={(event) => setSavedScenarioQuery(event.target.value)} placeholder="Name, team, asset, status" />
          </label>}
          {savedScenarios.length > 0 && <label className="saved-scenario-sort">
            Sort saved deals
            <select value={savedScenarioSort} onChange={(event) => setSavedScenarioSort(event.target.value as SavedScenarioSort)}>
              {SAVED_SCENARIO_SORTS.map((sort) => (
                <option key={sort.key} value={sort.key}>{sort.label}</option>
              ))}
            </select>
          </label>}
          {savedScenarios.length > 0 && hasCustomSavedScenarioView && <button className="clear-saved-view" onClick={clearSavedScenarioView}>Clear saved view</button>}
          {savedScenarios.length > 0 && <p className="saved-scenario-summary">{savedScenarioViewSummary}</p>}
          {savedScenarios.length > 0 && visibleSavedScenarios.length === 0 && <p className="empty">No saved scenarios match {savedScenarioFilterLabel(savedScenarioFilter)}{savedScenarioQuery.trim() ? ` and "${savedScenarioQuery.trim()}"` : ""}.</p>}
          {visibleSavedScenarios.map((scenario) => (
            <div key={scenario.id} className={cls("saved-scenario-row", scenario.pinned && "pinned")}>
              <button onClick={() => loadScenario(scenario)}>
                <strong>{scenario.name}</strong>
                {scenario.pinned && <span className="saved-scenario-pin">Pinned</span>}
                <span className={cls("saved-scenario-status", savedTradeScenarioStatusClass(scenario))}>{savedTradeScenarioStatusLabel(scenario)}</span>
                <span>{savedTradeScenarioTeamsLabel(scenario, teamMeta)}</span>
                <small>{savedTradeScenarioAssetSummary(scenario)}</small>
                {scenario.userNote && <small className="saved-scenario-user-note">{scenario.userNote}</small>}
                {scenario.snapshot?.note && <small className="saved-scenario-note">{scenario.snapshot.note}</small>}
                <em>{savedTradeScenarioMeta(scenario)} / {new Date(scenario.createdAt).toLocaleString()}</em>
              </button>
              <button className="pin-scenario" onClick={() => togglePinnedScenario(scenario)}>{scenario.pinned ? "Unpin" : "Pin"}</button>
              <button className="duplicate-scenario" onClick={() => duplicateScenario(scenario)}>Duplicate</button>
              <button className="remove-scenario" onClick={() => deleteScenario(scenario)}>Delete</button>
            </div>
          ))}
        </div>
        </div>
      </details>
    </main>
  );
}

function TradeSuggestionsPanel({
  suggestions,
  teamMeta,
  disabled,
  onLoad
}: {
  suggestions: TradeSuggestion[];
  teamMeta: Map<string, TeamProjection>;
  disabled: boolean;
  onLoad: (suggestion: TradeSuggestion) => void;
}) {
  if (disabled) {
    return (
      <div className="trade-suggestions-panel">
        <div className="trade-route-head">
          <span>Suggestions</span>
          <strong>Two-team only</strong>
        </div>
        <p className="empty">Remove the third team to generate direct trade suggestions.</p>
      </div>
    );
  }
  return (
    <div className="trade-suggestions-panel">
      <div className="trade-route-head">
        <span>Suggestions</span>
        <strong>{suggestions.length === 0 ? "No candidates" : `${suggestions.length} candidates`}</strong>
      </div>
      {suggestions.length === 0
        ? <p className="empty">No CBA-legal two-team suggestions cleared the value and fit screens for these teams.</p>
        : <div className="trade-suggestion-list">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="trade-suggestion-row">
              <div className="trade-suggestion-main">
                <span className={cls("trade-route-verdict", verdictClass(suggestion.verdict))}>{suggestion.verdict}</span>
                <strong>{suggestion.title}</strong>
                <small>
                  {teamLabel(suggestion.left.team, teamMeta)} sends {routeAssetLabels(suggestion.left.assets).join(", ")} / {teamLabel(suggestion.right.team, teamMeta)} sends {routeAssetLabels(suggestion.right.assets).join(", ")}
                </small>
                <div className="trade-suggestion-reasons">
                  {suggestion.reasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
                </div>
              </div>
              <div className="trade-suggestion-metrics">
                <MetricPill label="Score" value={formatNumber(suggestion.score, 1)} tone="gold" />
                <MetricPill label="Value diff" value={formatMoney(suggestion.valueDiff)} tone={suggestion.valueDiff <= TRADE_ACCEPTED_DIFF ? "green" : "teal"} />
                <MetricPill label="Scale diff" value={formatMoney(suggestion.scaleDiff)} tone={suggestion.scaleDiff <= TRADE_ACCEPTED_DIFF ? "green" : "teal"} />
                <MetricPill label="Fit lift" value={formatSigned(suggestion.fitLift, 1)} tone={suggestion.fitLift >= 0 ? "green" : "teal"} />
              </div>
              <button onClick={() => onLoad(suggestion)}>Load</button>
            </div>
          ))}
        </div>}
    </div>
  );
}

function TradeReviewPanel({ items }: { items: TradeReviewItem[] }) {
  const visibleItems = items.slice(0, 6);
  const remaining = Math.max(0, items.length - visibleItems.length);
  return (
    <div className="trade-review-panel">
      <div className="trade-route-head">
        <span>Review queue</span>
        <strong>{items.length === 0 ? "Clean" : `${items.length} item${items.length === 1 ? "" : "s"}`}</strong>
      </div>
      {visibleItems.length === 0
        ? <p className="empty">No value or CBA blockers surfaced.</p>
        : <div className="trade-review-list">
          {visibleItems.map((item, index) => (
            <div key={`${item.source}-${item.label}-${index}`} className={cls("trade-review-item", item.severity)}>
              <span>{item.source}</span>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
              {item.hint && <em>{item.hint}</em>}
            </div>
          ))}
          {remaining > 0 && <p className="trade-review-more">+{remaining} more in the CBA audit</p>}
        </div>}
    </div>
  );
}

function TradeRouteSummaryPanel({ summaries, lanes, teamMeta }: { summaries: TradeRouteSummary[]; lanes: TradeRouteLane[]; teamMeta: Map<string, TeamProjection> }) {
  return (
    <div className="trade-route-panel">
      <div className="trade-route-head">
        <span>Route summary</span>
        <strong>{summaries.length}-team flow</strong>
      </div>
      <div className="trade-flow-grid">
        {lanes.length === 0 && <p className="empty">No routed assets yet.</p>}
        {lanes.map((lane) => (
          <div key={`${lane.fromTeam}-${lane.toTeam}`} className="trade-flow-lane">
            <div className="trade-flow-teams">
              <span>{teamLabel(lane.fromTeam, teamMeta)}</span>
              <strong>to</strong>
              <span>{teamLabel(lane.toTeam, teamMeta)}</span>
            </div>
            <div className="trade-flow-main">
              <strong>{routeAssetLabels(lane.assets).join(", ")}</strong>
              <small>{formatMoney(lane.value)} value / {formatMoney(lane.salary)} salary / {formatSigned(lane.impact.total, 2)} impact</small>
            </div>
          </div>
        ))}
      </div>
      <div className="trade-route-grid">
        {summaries.map((summary) => (
          <div key={summary.team} className="trade-route-card">
            <div className="trade-route-team">
              <span>{teamLabel(summary.team, teamMeta)}</span>
              <strong>{formatSignedMoney(summary.netValue)}</strong>
            </div>
            <div className="trade-route-model">
              <span className={cls("trade-route-verdict", tradeMachineRouteVerdictClass(summary.modelBalance?.verdict))}>
                {tradeMachineValueVerdictLabel(summary.modelBalance?.verdict) ?? "No model"}
              </span>
              <span>{tradeMachineRouteDeficitLabel(summary.modelBalance)}</span>
            </div>
            <div className="trade-route-model">
              <span className={cls("trade-route-verdict", tradeMachineStatusClass(summary.cbaResult?.status))}>
                {tradeMachineShortStatusLabel(summary.cbaResult?.status)}
              </span>
              <span>{tradeMachineRouteCbaLabel(summary.cbaResult)}</span>
            </div>
            <div className="trade-route-metrics">
              <span>In {formatMoney(summary.incomingValue)}</span>
              <span>Out {formatMoney(summary.outgoingValue)}</span>
              <span>Salary {formatSignedMoney(summary.netSalary)}</span>
              <span>Impact {formatSigned(summary.netImpact.total, 2)}</span>
            </div>
            <div className="trade-route-assets">
              <div>
                <span>Receives</span>
                {routeAssetLabels(summary.receives).map((label, index) => <small key={`${label}-${index}`}>{label}</small>)}
              </div>
              <div>
                <span>Sends</span>
                {routeAssetLabels(summary.sends).map((label, index) => <small key={`${label}-${index}`}>{label}</small>)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeMachinePanel({ result, teamMeta }: { result: TradeMachineResult | null; teamMeta: Map<string, TeamProjection> }) {
  if (!result) {
    return (
      <div className="trade-cba-panel warning">
        <div className="trade-cba-head">
          <span>CBA legality</span>
          <strong>Cap data unavailable</strong>
        </div>
        <p>Load cap tracker data for this league year to evaluate salary matching, apron limits, BYC, and pick-trading rules.</p>
      </div>
    );
  }

  const checks = primaryTradeMachineChecks(result);
  const allChecks = tradeMachineAuditChecks(result);
  return (
    <div className={cls("trade-cba-panel", result.status)}>
      <div className="trade-cba-head">
        <span>CBA legality</span>
        <strong>{tradeMachineStatusLabel(result.status)}</strong>
        <small>{result.season.label} / cap {formatMoney(result.season.salary_cap)} / 1st apron {formatMoney(result.season.first_apron)} / 2nd apron {formatMoney(result.season.second_apron)}</small>
      </div>
      <div className="trade-cba-team-grid">
        {result.teams.map((team) => (
          <div key={team.team} className={cls("trade-cba-team", team.status)}>
            <span>{teamLabel(team.team, teamMeta)}</span>
            <strong>{formatMoney(team.afterSalary)}</strong>
            <small>{tradeMachineApronLabel(team.apronAfter)} / {team.salaryMatch.rule}</small>
            <small>Incoming {formatMoney(team.salaryMatch.incomingSalaryForMatching)} vs max {formatMoney(team.salaryMatch.maxIncomingSalary)}</small>
            {tradeMachineSalaryMatchDetails(team).map((detail) => (
              <small key={detail}>{detail}</small>
            ))}
          </div>
        ))}
      </div>
      <div className="trade-cba-checks">
        {checks.map((check) => (
          <div key={check.code} className={cls("trade-cba-check", check.status)}>
            <span>{check.label}</span>
            <p>{check.detail}</p>
          </div>
        ))}
      </div>
      <details className="trade-cba-audit">
        <summary>All CBA checks ({allChecks.length})</summary>
        <div className="trade-cba-checks">
          {allChecks.map((check, index) => (
            <div key={`${check.code}-${index}`} className={cls("trade-cba-check", check.status)}>
              <span>{check.label}</span>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function tradeMachineSalaryMatchDetails(team: TradeMachineTeamResult): string[] {
  const match = team.salaryMatch;
  const details: string[] = [];
  if (match.existingTradeExceptionName) {
    details.push(`Uses ${match.existingTradeExceptionName}${match.existingTradeExceptionExpires ? `, expires ${match.existingTradeExceptionExpires}` : ""}`);
    if (match.existingTradeExceptionFirstApronRestrictionApplies === true) details.push("Existing TPE triggers first-apron timing");
    if (match.existingTradeExceptionSignedAndTradedContract === true) details.push("S&T-origin TPE triggers second-apron timing");
  }
  if (match.disabledPlayerExceptionName) {
    details.push(`Uses ${match.disabledPlayerExceptionName} ${formatMoney(match.disabledPlayerExceptionAmount ?? 0)}${match.disabledPlayerExceptionExpires ? `, expires ${match.disabledPlayerExceptionExpires}` : ""}`);
  }
  if (match.assignmentExceptionName) {
    details.push(`Uses ${match.assignmentExceptionName} ${formatMoney(match.assignmentExceptionAmount ?? 0)}`);
  }
  if (match.minimumSalaryExceptionSalary > 0) {
    details.push(`Minimum exception covers ${formatMoney(match.minimumSalaryExceptionSalary)}`);
  }
  if (match.tradeExceptionCreated > 0) {
    details.push(`Creates TPE ${formatMoney(match.tradeExceptionCreated)}`);
  }
  return details;
}

function TradeSide({
  title,
  season,
  side,
  roster,
  rosterQuery,
  selectedPlayerIds,
  teamOptions,
  teamMeta,
  total,
  impact,
  delta,
  actualPicks,
  actualPickId,
  actualPickPreview,
  unavailableTeams,
  destinationOptions,
  showDestinations,
  pickBuilder,
  pickPreview,
  cashAmount,
  onTeamChange,
  onRosterQueryChange,
  onTogglePlayer,
  onPickBuilderChange,
  onActualPickChange,
  onAddActualPick,
  onAddPick,
  onCashAmountChange,
  onAddCash,
  onRemove,
  onDestinationChange,
  onClear
}: {
  title: string;
  season: number;
  side: TradeSideState;
  roster: PlayerImpact[];
  rosterQuery: string;
  selectedPlayerIds: Set<number>;
  teamOptions: TeamProjection[];
  teamMeta: Map<string, TeamProjection>;
  total: number;
  impact: TradeImpactSummary;
  delta: TradeImpactSummary;
  actualPicks: PickAsset[];
  actualPickId: string;
  actualPickPreview: PickAsset | null;
  unavailableTeams: string[];
  destinationOptions: string[];
  showDestinations: boolean;
  pickBuilder: TradePickBuilderState;
  pickPreview: PickAsset | null;
  cashAmount: string;
  onTeamChange: (team: string) => void;
  onRosterQueryChange: (value: string) => void;
  onTogglePlayer: (player: PlayerImpact) => void;
  onPickBuilderChange: (patch: Partial<TradePickBuilderState>) => void;
  onActualPickChange: (assetId: string) => void;
  onAddActualPick: () => void;
  onAddPick: () => void;
  onCashAmountChange: (value: string) => void;
  onAddCash: () => void;
  onRemove: (index: number) => void;
  onDestinationChange: (index: number, toTeam: string) => void;
  onClear: () => void;
}) {
  const selectedOnSide = new Set(
    side.assets
      .filter((asset) => asset.kind === "player" && asset.player)
      .map((asset) => asset.player!.nba_id)
  );
  const filteredRoster = filterTradeRoster(roster, rosterQuery);
  const sideTeamMeta = tradeTeamMeta(side.team, teamMeta);
  return (
    <section className="trade-side">
      <div className="panel-heading">
        <div className="trade-panel-title">
          {sideTeamMeta && <TeamLogo team={sideTeamMeta} />}
          <div>
            <h2>{title}</h2>
            <p>{teamFullName(side.team, teamMeta)} / {formatMoney(total)}</p>
          </div>
        </div>
        <button onClick={onClear} disabled={side.assets.length === 0}>Clear</button>
      </div>
      <label className="trade-side-team">
        Team
        <select value={side.team} onChange={(event) => onTeamChange(event.target.value)}>
          {teamOptions.map((team) => (
            <option key={team.team} value={team.team} disabled={teamOptions.length > 1 && unavailableTeams.includes(team.team)}>
              {team.team_name ?? team.team}
            </option>
          ))}
        </select>
      </label>
      <div className="trade-side-metrics">
        <MetricPill label="Value" value={formatMoney(total)} tone="gold" />
        <MetricPill label="Salary" value={formatMoney(impact.outgoingSalary)} />
        <MetricPill label="Out Impact" value={formatSigned(impact.total, 2)} tone="teal" />
        <MetricPill label="Net Impact" value={formatSigned(delta.total, 2)} tone={delta.total >= 0 ? "green" : "teal"} />
      </div>
      <label className="trade-roster-search">
        Find player
        <input value={rosterQuery} onChange={(event) => onRosterQueryChange(event.target.value)} placeholder="Name, position, tier, salary" />
      </label>
      <div className="trade-roster-list" aria-label={`${teamFullName(side.team, teamMeta)} roster`}>
        {filteredRoster.map((player) => {
          const selectedHere = selectedOnSide.has(player.nba_id);
          const selectedElsewhere = selectedPlayerIds.has(player.nba_id) && !selectedHere;
          return (
            <button
              key={player.nba_id}
              className={cls("trade-roster-row", selectedHere && "selected", selectedElsewhere && "disabled")}
              disabled={selectedElsewhere}
              onClick={() => onTogglePlayer(player)}
            >
              <PlayerHeadshot player={player} />
              <span className="trade-roster-main">
                <strong>{player.player_name}</strong>
                <small>{displayPosition(player.position)} / {tradeContractSummaryLabel(player)}</small>
              </span>
              <span className="trade-roster-money">
                <strong>{formatContractValue(player)}</strong>
                <small>{tradeContractSummary(player)?.years ?? "-"} yrs / 4Y trade {formatMoney(playerTradeValue(player))}</small>
              </span>
            </button>
          );
        })}
        {roster.length === 0 && <p className="empty">No roster rows for this team.</p>}
        {roster.length > 0 && filteredRoster.length === 0 && <p className="empty">No matching players.</p>}
      </div>
      {actualPicks.length > 0 && <div className="trade-pick-adder compact">
        <div className="trade-pick-fields">
          <label>
            Available pick
            <select value={actualPickId || actualPicks[0]?.asset_id || ""} onChange={(event) => onActualPickChange(event.target.value)}>
              {actualPicks.map((pick) => (
                <option key={pick.asset_id} value={pick.asset_id}>{pick.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="trade-pick-preview">
          <span>{actualPickPreview ? assetLabel({ kind: "pick", id: actualPickPreview.asset_id, pick: actualPickPreview }) : "No team pick"}</span>
          <strong>{actualPickPreview ? formatMoney(pickAssetTradeValue(actualPickPreview)) : "-"}</strong>
          <small>{actualPickPreview ? assetMeta({ kind: "pick", id: actualPickPreview.asset_id, pick: actualPickPreview }) : "No pick inventory"}</small>
        </div>
        <button disabled={!actualPickPreview} onClick={onAddActualPick}>Add actual</button>
      </div>}
      <div className="trade-pick-adder compact">
        <div className="trade-pick-fields">
          <label>
            Type
            <select value={coerceTradePickKind(pickBuilder.assetType)} onChange={(event) => onPickBuilderChange({ assetType: event.target.value as TradePickKind })}>
              <option value="first">1st round pick</option>
              <option value="second">2nd round pick</option>
              <option value="swap">1st swap right</option>
            </select>
          </label>
          <label>
            Draft
            <select value={coerceTradePickDraftYear(pickBuilder, season)} onChange={(event) => onPickBuilderChange({ draftYear: Number(event.target.value) })}>
              {tradePickDraftYears(season).map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          {coerceTradePickKind(pickBuilder.assetType) !== "second" && <label>
            Protection
            <select value={pickBuilder.protectionCutoff} onChange={(event) => onPickBuilderChange({ protectionCutoff: Number(event.target.value) })}>
              {TRADE_PICK_PROTECTIONS.map((protection) => (
                <option key={protection.cutoff} value={protection.cutoff}>{protection.label}</option>
              ))}
            </select>
          </label>}
          {coerceTradePickKind(pickBuilder.assetType) === "swap" && <label>
            Counterparty
            <select value={coerceTradePickCounterparty(pickBuilder, side.team, teamOptions)} onChange={(event) => onPickBuilderChange({ counterpartyTeam: event.target.value })}>
              {teamOptions
                .filter((team) => team.team !== side.team)
                .map((team) => (
                  <option key={team.team} value={team.team}>{team.team_name ?? team.team}</option>
                ))}
            </select>
          </label>}
        </div>
        <div className="trade-pick-preview">
          <span>{pickPreview ? assetLabel({ kind: "pick", id: pickPreview.asset_id, pick: pickPreview }) : "No pick value"}</span>
          <strong>{pickPreview ? formatMoney(pickAssetTradeValue(pickPreview)) : "-"}</strong>
          <small>{pickPreview ? assetMeta({ kind: "pick", id: pickPreview.asset_id, pick: pickPreview }) : "Pick curve unavailable"}</small>
        </div>
        <button disabled={!pickPreview} onClick={onAddPick}>Add pick</button>
      </div>
      <div className="trade-pick-adder compact">
        <div className="trade-pick-fields">
          <label>
            Cash ($M)
            <input
              type="number"
              min="0"
              step="0.1"
              value={cashAmount}
              onChange={(event) => onCashAmountChange(event.target.value)}
              placeholder="0.0"
            />
          </label>
        </div>
        <div className="trade-pick-preview">
          <span>Cash considerations</span>
          <strong>{formatMoney(parseTradeCashInput(cashAmount))}</strong>
          <small>Counts toward annual cash paid/received limits</small>
        </div>
        <button disabled={parseTradeCashInput(cashAmount) <= 0} onClick={onAddCash}>Add cash</button>
      </div>
      <div className="asset-list">
        {side.assets.length === 0 && <p className="empty">No assets</p>}
        {side.assets.map((asset, index) => (
          <div key={`${asset.id}-${index}`} className="asset-row">
            <button className="asset-remove" onClick={() => onRemove(index)} title="Remove asset">
              <span className="asset-identity">
                {asset.kind === "player" && asset.player && <PlayerHeadshot player={asset.player} />}
                {asset.kind !== "player" && <i className={cls("asset-icon", asset.kind)}>{asset.kind === "pick" ? "P" : "$"}</i>}
                <span>
                  <strong>{assetLabel(asset)}</strong>
                  <small>{assetMeta(asset)}</small>
                </span>
              </span>
              <span className="asset-money">
                <strong>{asset.kind === "player" && asset.player ? formatContractValue(asset.player) : formatMoney(assetValue(asset))}</strong>
                <small>{asset.kind === "player" && asset.player ? `${tradeContractSummary(asset.player)?.years ?? "-"} yrs / value ${formatMoney(assetValue(asset))}` : "value"}</small>
              </span>
            </button>
            {showDestinations && <label className="asset-destination">
              To
              <select value={asset.toTeam ?? ""} onChange={(event) => onDestinationChange(index, event.target.value)}>
                <option value="" disabled>Choose</option>
                {destinationOptions.map((team) => (
                  <option key={team} value={team}>{teamFullName(team, teamMeta)}</option>
                ))}
              </select>
            </label>}
          </div>
        ))}
      </div>
    </section>
  );
}

function DraftWorkspace({ data }: { data: AppData }) {
  const years = Array.from(new Set(data.prospects.map((prospect) => prospect.draft_year))).sort((a, b) => b - a);
  const latestYear = years[0] ?? "All";
  const [year, setYear] = useSessionState<DraftYearSelection>(
    "draft:year:v2",
    latestYear,
    (value) => value === "All" || (typeof value === "number" && years.includes(value)) ? value : latestYear
  );
  const [query, setQuery] = useSessionState("draft:query", "");
  const [position, setPosition] = useSessionState("draft:position", "All");
  const [tier, setTier] = useSessionState("draft:tier", "All");
  const [pool, setPool] = useSessionState("draft:pool", "All");
  const [sortKey, setSortKey] = useSessionState<DraftSortKey>("draft:sortKey", "score");
  const [sortDirection, setSortDirection] = useSessionState<SortDirection>("draft:sortDirection", "desc");
  const [filterRules, setFilterRules] = useSessionState<FilterRule[]>("draft:rules", []);
  const [filterKey, setFilterKey] = useSessionState<DraftFilterKey>("draft:filterKey", "score");
  const [filterOperator, setFilterOperator] = useSessionState<FilterOperator>("draft:filterOperator", "gte");
  const [filterValue, setFilterValue] = useSessionState("draft:filterValue", "");
  const [filterValueTo, setFilterValueTo] = useSessionState("draft:filterValueTo", "");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const yearProspects = useMemo(
    () => year === "All" ? data.prospects : data.prospects.filter((prospect) => prospect.draft_year === year),
    [data.prospects, year]
  );
  const positions = useMemo(() => ["All", ...Array.from(new Set(yearProspects.map((prospect) => displayDraftPosition(prospect)))).sort()], [yearProspects]);
  const tiers = useMemo(() => ["All", ...impactTierOrder.filter((item) => yearProspects.some((prospect) => draftTier(prospect) === item))], [yearProspects]);
  const pools = useMemo(() => ["All", ...Array.from(new Set(yearProspects.map((prospect) => prospect.prediction_pool).filter(Boolean))).sort()], [yearProspects]);
  const selectedFilterField = draftFilterFields.find((field) => field.key === filterKey) ?? draftFilterFields[0];
  const availableOperators = selectedFilterField.type === "number" ? numericOperators : textOperators;
  const quickFilterCount = [query.trim(), position !== "All", tier !== "All", pool !== "All"].filter(Boolean).length;
  const activeFilterCount = quickFilterCount + filterRules.length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return yearProspects
      .filter((prospect) => !q || prospect.player.toLowerCase().includes(q) || String(prospect.college ?? "").toLowerCase().includes(q))
      .filter((prospect) => position === "All" || displayDraftPosition(prospect) === position)
      .filter((prospect) => tier === "All" || draftTier(prospect) === tier)
      .filter((prospect) => pool === "All" || prospect.prediction_pool === pool)
      .filter((prospect) => passesDraftFilterRules(prospect, filterRules))
      .sort((a, b) => compareDraftProspects(a, b, sortKey, sortDirection));
  }, [filterRules, pool, position, query, sortDirection, sortKey, tier, yearProspects]);
  const summary = useMemo(() => {
    const avg = (values: Array<number | null | undefined>) => {
      const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return nums.length > 0 ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
    };
    return {
      count: filtered.length,
      avgTotal: avg(filtered.map((prospect) => prospect.TOTAL_pred)),
      avgTimin: avg(filtered.map((prospect) => prospect.timin)),
      top: filtered[0]
    };
  }, [filtered]);

  const handleSort = (key: DraftSortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(["rank_in_class", "player", "position", "tier", "college", "prediction_pool"].includes(key) ? "asc" : "desc");
  };
  const handleFilterKeyChange = (key: DraftFilterKey) => {
    const nextField = draftFilterFields.find((field) => field.key === key) ?? draftFilterFields[0];
    setFilterKey(key);
    setFilterOperator(nextField.type === "number" ? "gte" : "contains");
    setFilterValue("");
    setFilterValueTo("");
  };
  const addFilterRule = () => {
    const value = filterValue.trim();
    const valueTo = filterValueTo.trim();
    if (!value || (filterOperator === "between" && !valueTo)) return;
    setFilterRules((current) => [
      ...current,
      {
        id: `draft-${filterKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: filterKey,
        operator: filterOperator,
        value,
        valueTo: filterOperator === "between" ? valueTo : undefined
      }
    ]);
    setFilterValue("");
    setFilterValueTo("");
  };
  const clearFilters = () => {
    setQuery("");
    setPosition("All");
    setTier("All");
    setPool("All");
    setFilterRules([]);
    setFilterDrawerOpen(false);
  };

  useEffect(() => {
    if (year === "All" || years.includes(year)) return;
    setYear(latestYear);
  }, [latestYear, setYear, year, years]);

  return (
    <main className="workspace draft-model-grid">
      <section className="draft-board-main">
        <div className="impact-sticky-header">
          <section className={cls("control-strip board-controls draft-controls", filterDrawerOpen && "mobile-filters-open")}>
            <div className="quick-filters board-control-row mobile-collapsible-filters">
              <div className="search">
                <span>Find</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Prospect name" />
              </div>
              {years.length > 0 && <label className="mobile-drawer-filter">
                Class
                <select
                  value={String(year)}
                  onChange={(event) => setYear(event.target.value === "All" ? "All" : Number(event.target.value))}
                >
                  <option value="All">All</option>
                  {years.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>}
              <label className="mobile-drawer-filter">
                Position
                <select value={position} onChange={(event) => setPosition(event.target.value)}>
                  {positions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="mobile-drawer-filter">
                Tier
                <select value={tier} onChange={(event) => setTier(event.target.value)}>
                  {tiers.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="mobile-drawer-filter">
                Pool
                <select value={pool} onChange={(event) => setPool(event.target.value)}>
                  {pools.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div className="board-count" aria-live="polite">
                <span>Prospects</span>
                <strong>{summary.count.toLocaleString()}</strong>
              </div>
              <button className="clear-filters" onClick={clearFilters} disabled={activeFilterCount === 0}>
                Clear{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </button>
              <button
                type="button"
                className="mobile-filter-trigger"
                aria-controls="draft-mobile-filter-body"
                aria-expanded={filterDrawerOpen}
                onClick={() => setFilterDrawerOpen((open) => !open)}
              >
                <span>Filters</span>
                {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
              </button>
            </div>
            <details id="draft-mobile-filter-body" className="advanced-filter-drawer board-control-row mobile-drawer-filter" open>
              <summary>Advanced filter</summary>
              <div className="rule-builder" aria-label="Add draft filter rule">
                <label>
                  Filter
                  <select value={filterKey} onChange={(event) => handleFilterKeyChange(event.target.value as DraftFilterKey)}>
                    {draftFilterFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Match
                  <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as FilterOperator)}>
                    {availableOperators.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rule-value">
                  Value
                  <input
                    value={filterValue}
                    onChange={(event) => setFilterValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addFilterRule();
                    }}
                    placeholder={selectedFilterField.type === "number" ? "90, 1.5, 20m" : "contains"}
                  />
                </label>
                {filterOperator === "between" && (
                  <label className="rule-value">
                    To
                    <input
                      value={filterValueTo}
                      onChange={(event) => setFilterValueTo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addFilterRule();
                      }}
                      placeholder="100"
                    />
                  </label>
                )}
                <button className="add-filter" onClick={addFilterRule} disabled={!filterValue.trim() || (filterOperator === "between" && !filterValueTo.trim())}>
                  Add
                </button>
              </div>
            </details>
            {filterRules.length > 0 && (
              <div className="filter-chips" aria-label="Active draft filter rules">
                {filterRules.map((rule) => (
                  <button key={rule.id} onClick={() => setFilterRules((current) => current.filter((item) => item.id !== rule.id))}>
                    {describeDraftFilterRule(rule)}
                    <span>Remove</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="table-panel draft-table-panel">
          <div className="panel-heading compact-heading draft-heading">
            <div>
              <h2>Draft Model</h2>
              <p>Names, skills, impact, and TIMIN</p>
            </div>
            <div className="draft-summary-strip">
              <MetricPill label="Top" value={summary.top?.player ?? "-"} tone="green" />
              <MetricPill label="Avg Total" value={formatSigned(summary.avgTotal, 2)} tone="teal" />
              <MetricPill label="Avg TIMIN" value={formatNumber(summary.avgTimin, 0)} tone="gold" />
            </div>
          </div>
          {years.length > 0 ? (
            <ProspectTable
              prospects={filtered}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          ) : (
            <EmptyState title="No draft prospects" detail="No draft prospect rows are available." />
          )}
        </section>
      </section>

    </main>
  );
}

function ProspectTable({
  prospects,
  sortKey,
  sortDirection,
  onSort
}: {
  prospects: DraftProspect[];
  sortKey: DraftSortKey;
  sortDirection: SortDirection;
  onSort: (key: DraftSortKey) => void;
}) {
  if (prospects.length === 0) {
    return <EmptyState title="No prospects in class" detail="This draft class has no exported prospect rows." />;
  }

  const sortableHeader = (key: DraftSortKey, label: string) => (
    <button className={cls("sort-header sort-btn", sortKey === key && "active on")} onClick={() => onSort(key)}>
      {label}
      {sortKey === key && <span className="sort-arr">{sortDirection === "desc" ? "v" : "^"}</span>}
    </button>
  );
  const activeSkill = draftSkillSortKey(sortKey);
  const visibleProspects = prospects.slice(0, MAX_VISIBLE_TABLE_ROWS);
  const hiddenCount = Math.max(0, prospects.length - visibleProspects.length);

  return (
    <div className="table-wrap">
      {hiddenCount > 0 && <p className="table-limit-note">Showing first {visibleProspects.length.toLocaleString()} of {prospects.length.toLocaleString()} rows. Tighten filters to inspect the rest.</p>}
      <table className="data-table draft-model-table">
        <colgroup>
          <col className="cg-draft-rank" />
          <col className="cg-draft-player" />
          <col className="cg-draft-meta" />
          <col className="cg-draft-meta" />
          <col className="cg-draft-meta" />
          <col className="cg-draft-rate" />
          <col className="cg-draft-rate" />
          <col className="cg-draft-rate" />
          <col className="cg-draft-score" />
          <col className="cg-draft-tier" />
          <col className="cg-draft-timin" />
          <col className="cg-draft-skills" />
          <col className="cg-draft-comp" />
        </colgroup>
        <thead>
          <tr className="group-row">
            <th></th>
            <th colSpan={4}>Identity</th>
            <th colSpan={6}>Impact</th>
            <th>Skills</th>
            <th>Comp</th>
          </tr>
          <tr>
            <th className="align-center">{sortableHeader("rank_in_class", "#")}</th>
            <th className="sticky-player">{sortableHeader("player", "Player")}</th>
            <th className="align-center">{sortableHeader("position", "Pos")}</th>
            <th className="align-center">{sortableHeader("draft_age", "Age")}</th>
            <th className="align-center">{sortableHeader("scv_draft", "Model")}</th>
            <th className="align-right">{sortableHeader("OFF_pred", "Off")}</th>
            <th className="align-right">{sortableHeader("DEF_pred", "Def")}</th>
            <th className="align-right">{sortableHeader("TOTAL_pred", "Total")}</th>
            <th className="align-center">{sortableHeader("score", "Score")}</th>
            <th className="align-center">{sortableHeader("tier", "Tier")}</th>
            <th className="align-right group-end">{sortableHeader("timin", "TIMIN")}</th>
            <th className="align-center">
              <div className="skills-head">
                <button className={cls("skills-main-sort", activeSkill && "active")} onClick={() => onSort("TOTAL_pred")}>
                  Skills
                  {activeSkill && <small>{draftSkillSortLabel(activeSkill)}</small>}
                </button>
                <div className="skills-sort-strip" aria-label="Sort by prospect skill">
                  {draftSkillAggregateSorts.map((item) => (
                    <button
                      key={item.key}
                      className={cls("skills-sort-btn aggregate", sortKey === item.key && "active")}
                      onClick={() => onSort(item.key)}
                      title={`Sort by ${item.title}`}
                    >
                      {item.label}
                      {sortKey === item.key && <i>{sortDirection === "desc" ? "v" : "^"}</i>}
                    </button>
                  ))}
                  {skillKeys.map((key) => (
                    <button
                      key={key}
                      className={cls("skills-sort-btn", sortKey === `${key}_pred` && "active")}
                      onClick={() => onSort(`${key}_pred`)}
                    >
                      {key}
                      {sortKey === `${key}_pred` && <i>{sortDirection === "desc" ? "v" : "^"}</i>}
                    </button>
                  ))}
                </div>
              </div>
            </th>
            <th className="align-center">{sortableHeader("similarity_score", "Top Comp")}</th>
          </tr>
        </thead>
        <tbody>
          {visibleProspects.map((prospect, index) => (
            <tr key={`${prospect.draft_year}-${prospect.player}`} style={draftRowAccentStyle(prospect)}>
              <td className="rank-cell align-center">{index + 1}</td>
              <td className="sticky-player">
                <div className="draft-player-cell">
                  <strong>{prospect.player}</strong>
                  <span>{prospect.college || "-"}</span>
                </div>
              </td>
              <td className="align-center">
                <span className="tier-text">{displayDraftPosition(prospect)}</span>
              </td>
              <td className="align-center">
                {formatNumber(prospect.draft_age, 1)}
              </td>
              <td className="align-center">
                {formatNumber(prospect.scv_draft, 0)}
              </td>
              <td className="align-right">
                <StatValue value={prospect.OFF_pred} />
              </td>
              <td className="align-right">
                <StatValue value={prospect.DEF_pred} />
              </td>
              <td className="align-right">
                <StatValue value={prospect.TOTAL_pred} />
              </td>
              <td className="align-center score-cell">
                <ScoreValue value={prospect.score} />
              </td>
              <td className="align-center">
                <span className="tier-text">{draftTier(prospect)}</span>
              </td>
              <td className="align-right group-end-cell">
                <span className="timin-value">{formatNumber(prospect.timin, 0)}</span>
              </td>
              <td className="skill-fingerprint-cell">
                <SkillLedger
                  aggregates={[
                    { key: "TOTAL_pred", label: "Total", title: "Projected Total", value: prospect.TOTAL_pred, sortKey: "TOTAL_pred" },
                    { key: "OFF_pred", label: "Off", title: "Projected Off", value: prospect.OFF_pred, sortKey: "OFF_pred" },
                    { key: "DEF_pred", label: "Def", title: "Projected Def", value: prospect.DEF_pred, sortKey: "DEF_pred" }
                  ]}
                  skills={skillKeys.map((key) => ({
                    key,
                    label: key,
                    title: skillLabels[key],
                    value: getProspectSkillValue(prospect, key),
                    sortKey: `${key}_pred` as DraftSortKey
                  }))}
                  activeKey={activeSkill}
                  onSort={(key) => onSort(key as DraftSortKey)}
                />
              </td>
              <td className="draft-comp-cell">
                <DraftSimilarityCompStack prospect={prospect} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DraftSimilarityCompStack({ prospect }: { prospect: DraftProspect }) {
  const offComps = draftSimilarityComps(prospect, "off");
  const defComps = draftSimilarityComps(prospect, "def");
  if (!offComps.length && !defComps.length) {
    return <span className="muted-cell">-</span>;
  }

  return (
    <div className="draft-comp-stack">
      <DraftSimilarityComp prospect={prospect} dimension="off" label="Off" />
      <DraftSimilarityComp prospect={prospect} dimension="def" label="Def" />
    </div>
  );
}

function DraftSimilarityComp({ prospect, dimension, label }: { prospect: DraftProspect; dimension: DraftSimilarityDimension; label: string }) {
  const comps = draftSimilarityComps(prospect, dimension);
  const topComp = comps[0];
  if (!topComp) {
    return <span className="muted-cell">-</span>;
  }

  const scoreText = typeof topComp.score === "number" && Number.isFinite(topComp.score) ? `${formatNumber(topComp.score, 1)} sim` : "-";
  const title = [
    `${label} comp`,
    `${topComp.year} ${topComp.player}`,
    `Similarity: ${scoreText}`,
    `Total: ${formatSigned(topComp.total, 2)}`,
    `Off: ${formatSigned(topComp.off, 2)}`,
    `Def: ${formatSigned(topComp.def, 2)}`,
    `Minutes: ${formatNumber(topComp.minutes, 0)}`
  ].join("\n");

  return (
    <details className="draft-comp-details">
      <summary className="draft-comp" title={title}>
        <span className={cls("draft-comp-label", dimension)}>{label}</span>
        <strong>{topComp.year} {topComp.player}</strong>
        <span>{scoreText}</span>
      </summary>
      <div className="draft-comp-list">
        {comps.map((comp) => (
          <div className="draft-comp-row" key={`${dimension}-${comp.rank}-${comp.year}-${comp.player}`}>
            <strong>{comp.rank}. {comp.year} {comp.player}</strong>
            <span>{formatNumber(comp.score, 1)} sim</span>
            <span>{formatSigned(comp.total, 2)} tot</span>
            <span>{formatNumber(comp.minutes, 0)} min</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function draftSimilarityComps(prospect: DraftProspect, dimension: DraftSimilarityDimension = "total"): DraftSimilarityCompRow[] {
  const raw = draftSimilarityRawComps(prospect, dimension);
  let parsed: unknown = null;
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const comps = Array.isArray(parsed)
    ? parsed.map(toDraftSimilarityComp).filter((comp): comp is DraftSimilarityCompRow => comp !== null)
    : [];

  if (comps.length > 0) {
    return comps.sort((a, b) => a.rank - b.rank);
  }

  const fallback = draftSimilarityFallback(prospect, dimension);
  const player = fallback.player?.trim();
  const year = fallback.year;
  if (!player || typeof year !== "number" || !Number.isFinite(year)) return [];
  return [{
    rank: 1,
    player,
    year,
    score: fallback.score,
    distance: fallback.distance,
    total: fallback.total,
    off: fallback.off,
    def: fallback.def,
    minutes: fallback.minutes
  }];
}

function draftSimilarityRawComps(prospect: DraftProspect, dimension: DraftSimilarityDimension): DraftProspect["similarity_comps"] {
  if (dimension === "off") return prospect.off_similarity_comps;
  if (dimension === "def") return prospect.def_similarity_comps;
  return prospect.similarity_comps;
}

function draftSimilarityFallback(prospect: DraftProspect, dimension: DraftSimilarityDimension) {
  if (dimension === "off") {
    return {
      player: prospect.off_similarity_comp_player,
      year: prospect.off_similarity_comp_year,
      score: finiteNumberOrNull(prospect.off_similarity_score),
      distance: finiteNumberOrNull(prospect.off_similarity_distance),
      total: finiteNumberOrNull(prospect.off_similarity_comp_total),
      off: finiteNumberOrNull(prospect.off_similarity_comp_off),
      def: finiteNumberOrNull(prospect.off_similarity_comp_def),
      minutes: finiteNumberOrNull(prospect.off_similarity_comp_minutes)
    };
  }
  if (dimension === "def") {
    return {
      player: prospect.def_similarity_comp_player,
      year: prospect.def_similarity_comp_year,
      score: finiteNumberOrNull(prospect.def_similarity_score),
      distance: finiteNumberOrNull(prospect.def_similarity_distance),
      total: finiteNumberOrNull(prospect.def_similarity_comp_total),
      off: finiteNumberOrNull(prospect.def_similarity_comp_off),
      def: finiteNumberOrNull(prospect.def_similarity_comp_def),
      minutes: finiteNumberOrNull(prospect.def_similarity_comp_minutes)
    };
  }
  return {
    player: prospect.similarity_comp_player,
    year: prospect.similarity_comp_year,
    score: finiteNumberOrNull(prospect.similarity_score),
    distance: finiteNumberOrNull(prospect.similarity_distance),
    total: finiteNumberOrNull(prospect.similarity_comp_total),
    off: finiteNumberOrNull(prospect.similarity_comp_off),
    def: finiteNumberOrNull(prospect.similarity_comp_def),
    minutes: finiteNumberOrNull(prospect.similarity_comp_minutes)
  };
}

function toDraftSimilarityComp(value: unknown): DraftSimilarityCompRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const player = typeof row.player === "string" ? row.player.trim() : "";
  const rank = finiteNumberOrNull(row.rank);
  const year = finiteNumberOrNull(row.year);
  if (!player || rank === null || year === null) return null;
  return {
    rank,
    player,
    year,
    score: finiteNumberOrNull(row.score),
    distance: finiteNumberOrNull(row.distance),
    total: finiteNumberOrNull(row.total),
    off: finiteNumberOrNull(row.off),
    def: finiteNumberOrNull(row.def),
    minutes: finiteNumberOrNull(row.minutes)
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function draftSortSkill(key: DraftSortKey): SkillKey | null {
  if (!key.endsWith("_pred")) return null;
  const skill = key.replace("_pred", "") as SkillKey;
  return skillKeys.includes(skill) ? skill : null;
}

function draftSkillSortKey(key: DraftSortKey): DraftSortKey | null {
  if (draftSkillAggregateSorts.some((item) => item.key === key)) return key;
  return draftSortSkill(key) ? key : null;
}

function draftSkillSortLabel(key: DraftSortKey): string {
  const aggregate = draftSkillAggregateSorts.find((item) => item.key === key);
  if (aggregate) return aggregate.label;
  const skill = draftSortSkill(key);
  return skill ?? "";
}

function DraftEloWorkspace({ data }: { data: AppData }) {
  const { responses, setResponses, loaded, storageMode, storageError } = useDraftEloResponses();
  const [tab, setTab] = useSessionState<DraftEloTab>("draftElo:tab", "compare");
  const [matchup, setMatchup] = useState<[DraftProspect, DraftProspect] | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const latestYear = useMemo(() => latestDraftYear(data.prospects), [data.prospects]);
  const classProspects = useMemo(
    () => latestYear === null ? [] : data.prospects.filter((prospect) => prospect.draft_year === latestYear),
    [data.prospects, latestYear]
  );
  const prospectMap = useMemo(() => new Map(classProspects.map((prospect) => [draftProspectKey(prospect), prospect])), [classProspects]);
  const activeResponses = useMemo(
    () => latestYear === null ? [] : responses.filter((response) => response.draftYear === latestYear),
    [latestYear, responses]
  );
  const standings = useMemo(() => buildDraftEloStandings(classProspects, activeResponses), [activeResponses, classProspects]);
  const recentResponse = activeResponses[activeResponses.length - 1] ?? null;
  const canCompare = loaded && classProspects.length >= 2 && matchup !== null;

  useEffect(() => {
    setMatchup(sampleDraftEloPair(classProspects, null));
  }, [classProspects]);

  const recordChoice = (winner: DraftProspect) => {
    if (!matchup || latestYear === null) return;
    const [playerA, playerB] = matchup;
    const response: DraftEloResponse = {
      id: `elo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      draftYear: latestYear,
      createdAt: new Date().toISOString(),
      playerAKey: draftProspectKey(playerA),
      playerBKey: draftProspectKey(playerB),
      winnerKey: draftProspectKey(winner)
    };
    setResponses((current) => normalizeDraftEloResponses([...current, response]));
    const pairKey = draftEloPairKey(response.playerAKey, response.playerBKey);
    setMatchup(sampleDraftEloPair(classProspects, pairKey));
  };

  const flipResponse = (responseId: string) => {
    setResponses((current) =>
      normalizeDraftEloResponses(
        current.map((response) => {
          if (response.id !== responseId) return response;
          const winnerKey = response.winnerKey === response.playerAKey ? response.playerBKey : response.playerAKey;
          return { ...response, winnerKey };
        })
      )
    );
  };

  const deleteResponse = (responseId: string) => {
    setResponses((current) => current.filter((response) => response.id !== responseId));
  };

  const clearDraftElo = () => {
    const classLabel = latestYear ? `${latestYear}` : "this class";
    if (!window.confirm(`Clear all Draft Elo responses for ${classLabel}? This only affects the local Draft Elo store.`)) return;
    setResponses((current) => current.filter((response) => response.draftYear !== latestYear));
  };

  const exportResponses = () => {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), responses }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `draft-elo-responses-${latestYear ?? "all"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setImportNote("Exported Draft Elo responses");
  };

  const importResponses = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "[]")) as unknown;
        const imported = normalizeDraftEloResponses(Array.isArray(parsed) ? parsed : (parsed as { responses?: unknown }).responses);
        if (imported.length === 0) {
          setImportNote("No valid Draft Elo responses found");
          return;
        }
        setResponses((current) => {
          const byId = new Map(current.map((response) => [response.id, response]));
          imported.forEach((response) => byId.set(response.id, response));
          return normalizeDraftEloResponses([...byId.values()]);
        });
        setImportNote(`Imported ${imported.length.toLocaleString()} responses`);
      } catch {
        setImportNote("Import failed: invalid JSON");
      }
    };
    reader.readAsText(file);
  };

  return (
    <main className="workspace draft-elo-workspace">
      <section className="draft-elo-top">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Draft Elo</h2>
            <p>{latestYear ? `${latestYear} class blind comparisons` : "No draft class available"}</p>
          </div>
          <div className="draft-elo-status">
            <MetricPill label="Responses" value={activeResponses.length.toLocaleString()} tone="green" />
            <MetricPill label="Prospects" value={classProspects.length.toLocaleString()} tone="teal" />
            <MetricPill label="Storage" value={loaded ? storageLabel(storageMode) : "Loading"} tone="gold" />
          </div>
        </div>
        <div className="segmented-control draft-elo-tabs" aria-label="Draft Elo view">
          <button className={cls(tab === "compare" && "active")} onClick={() => setTab("compare")}>Compare</button>
          <button className={cls(tab === "results" && "active")} onClick={() => setTab("results")}>Results</button>
        </div>
      </section>

      {storageError && <p className="note-text draft-elo-note">Storage note: {storageError}</p>}

      {tab === "compare" && (
        <section className="draft-elo-compare">
          {!loaded && <EmptyState title="Loading choices" detail="Opening local Draft Elo storage." />}
          {loaded && classProspects.length < 2 && <EmptyState title="Not enough prospects" detail="At least two prospects are needed for blind comparisons." />}
          {canCompare && matchup && (
            <>
              <div className="draft-elo-prompt">
                <span>Choose one</span>
                <strong>{latestYear} class</strong>
                <em>{recentResponse ? recentChoiceText(recentResponse, prospectMap) : "No choices recorded yet"}</em>
              </div>
              <div className="draft-elo-card-grid">
                <DraftEloCard prospect={matchup[0]} side="A" onChoose={recordChoice} />
                <DraftEloCard prospect={matchup[1]} side="B" onChoose={recordChoice} />
              </div>
            </>
          )}
        </section>
      )}

      {tab === "results" && (
        <section className="draft-elo-results">
          <section className="table-panel draft-elo-leaderboard-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h2>Elo Leaderboard</h2>
                <p>Replayed from your saved choices</p>
              </div>
              <div className="button-row draft-elo-actions">
                <button onClick={exportResponses} disabled={!loaded}>Export JSON</button>
                <button onClick={() => importInputRef.current?.click()} disabled={!loaded}>Import JSON</button>
                <button onClick={clearDraftElo} disabled={!loaded || activeResponses.length === 0}>Reset class</button>
                <input ref={importInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importResponses} />
              </div>
            </div>
            {importNote && <p className="note-text draft-elo-note">{importNote}</p>}
            {standings.length > 0 ? <DraftEloLeaderboard standings={standings} /> : <EmptyState title="No Elo rows" detail="Make a comparison to populate the leaderboard." />}
          </section>

          <section className="table-panel draft-elo-history-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h2>Response History</h2>
                <p>Flip or delete old choices, then ratings replay automatically</p>
              </div>
            </div>
            {activeResponses.length > 0 ? (
              <DraftEloHistory responses={[...activeResponses].reverse()} prospectMap={prospectMap} onFlip={flipResponse} onDelete={deleteResponse} />
            ) : (
              <EmptyState title="No responses yet" detail="Your choices will appear here after you start comparing." />
            )}
          </section>
        </section>
      )}
    </main>
  );
}

function DraftEloCard({ prospect, side, onChoose }: { prospect: DraftProspect; side: "A" | "B"; onChoose: (prospect: DraftProspect) => void }) {
  const measurements = [
    { label: "Height", value: formatInches(prospect.height_wo_shoes_in) },
    { label: "Wingspan", value: formatInches(prospect.wingspan_in) },
    { label: "Weight", value: formatWeight(prospect.weight_lbs) }
  ];
  const school = prospect.college || prospect.pre_draft_team || "-";

  return (
    <button className="draft-elo-card" onClick={() => onChoose(prospect)}>
      <span className="draft-elo-side">Player {side}</span>
      <strong>{prospect.player}</strong>
      <span>{displayDraftPosition(prospect)} / Age {formatNumber(prospect.draft_age, 1)}</span>
      <em>{school}</em>
      <div className="draft-elo-bio-grid">
        {measurements.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </button>
  );
}

function DraftEloLeaderboard({ standings }: { standings: DraftEloStanding[] }) {
  return (
    <div className="table-wrap compact draft-elo-table-wrap">
      <table className="data-table draft-elo-table">
        <thead>
          <tr>
            <th className="align-center">#</th>
            <th>Player</th>
            <th className="align-right">Elo</th>
            <th className="align-right">W</th>
            <th className="align-right">L</th>
            <th className="align-right">Total</th>
            <th>Last Picked</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, index) => (
            <tr key={row.key}>
              <td className="rank-cell align-center">{index + 1}</td>
              <td>
                <div className="draft-player-cell">
                  <strong>{row.prospect.player}</strong>
                  <span>{displayDraftPosition(row.prospect)} / {row.prospect.college || row.prospect.pre_draft_team || "-"}</span>
                </div>
              </td>
              <td className="align-right"><strong>{formatNumber(row.rating, 0)}</strong></td>
              <td className="align-right">{row.wins}</td>
              <td className="align-right">{row.losses}</td>
              <td className="align-right">{row.matches}</td>
              <td>{formatDateTime(row.lastPicked)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DraftEloHistory({
  responses,
  prospectMap,
  onFlip,
  onDelete
}: {
  responses: DraftEloResponse[];
  prospectMap: Map<string, DraftProspect>;
  onFlip: (responseId: string) => void;
  onDelete: (responseId: string) => void;
}) {
  return (
    <div className="table-wrap compact draft-elo-history-wrap">
      <table className="data-table draft-elo-history-table">
        <thead>
          <tr>
            <th>Choice</th>
            <th>Matchup</th>
            <th>Time</th>
            <th className="align-center">Edit</th>
          </tr>
        </thead>
        <tbody>
          {responses.map((response) => {
            const playerA = prospectMap.get(response.playerAKey);
            const playerB = prospectMap.get(response.playerBKey);
            const winner = prospectMap.get(response.winnerKey);
            return (
              <tr key={response.id}>
                <td><strong>{winner?.player ?? "Unknown"}</strong></td>
                <td>{playerA?.player ?? "Unknown"} vs {playerB?.player ?? "Unknown"}</td>
                <td>{formatDateTime(response.createdAt)}</td>
                <td className="align-center">
                  <div className="draft-elo-row-actions">
                    <button onClick={() => onFlip(response.id)} disabled={!playerA || !playerB}>Flip</button>
                    <button onClick={() => onDelete(response.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function latestDraftYear(prospects: DraftProspect[]): number | null {
  const years = prospects.map((prospect) => prospect.draft_year).filter(Number.isFinite);
  return years.length > 0 ? Math.max(...years) : null;
}

function draftProspectKey(prospect: DraftProspect): string {
  return `${prospect.draft_year}::${prospect.player}`;
}

function draftEloPairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

function sampleDraftEloPair(prospects: DraftProspect[], previousPairKey: string | null): [DraftProspect, DraftProspect] | null {
  if (prospects.length < 2) return null;
  const attempts = prospects.length > 2 ? 20 : 1;
  for (let index = 0; index < attempts; index += 1) {
    const firstIndex = Math.floor(Math.random() * prospects.length);
    let secondIndex = Math.floor(Math.random() * prospects.length);
    while (secondIndex === firstIndex) {
      secondIndex = Math.floor(Math.random() * prospects.length);
    }
    const pair: [DraftProspect, DraftProspect] = [prospects[firstIndex], prospects[secondIndex]];
    const pairKey = draftEloPairKey(draftProspectKey(pair[0]), draftProspectKey(pair[1]));
    if (pairKey !== previousPairKey) return pair;
  }
  return [prospects[0], prospects[1]];
}

function buildDraftEloStandings(prospects: DraftProspect[], responses: DraftEloResponse[]): DraftEloStanding[] {
  const rows = new Map<string, DraftEloStanding>(
    prospects.map((prospect) => [
      draftProspectKey(prospect),
      {
        key: draftProspectKey(prospect),
        prospect,
        rating: DRAFT_ELO_INITIAL_RATING,
        wins: 0,
        losses: 0,
        matches: 0,
        lastPicked: null
      } satisfies DraftEloStanding
    ])
  );

  responses.forEach((response) => {
    const playerA = rows.get(response.playerAKey);
    const playerB = rows.get(response.playerBKey);
    if (!playerA || !playerB) return;

    const aExpected = expectedDraftEloScore(playerA.rating, playerB.rating);
    const bExpected = expectedDraftEloScore(playerB.rating, playerA.rating);
    const aScore = response.winnerKey === response.playerAKey ? 1 : 0;
    const bScore = response.winnerKey === response.playerBKey ? 1 : 0;
    playerA.rating += DRAFT_ELO_K * (aScore - aExpected);
    playerB.rating += DRAFT_ELO_K * (bScore - bExpected);
    playerA.matches += 1;
    playerB.matches += 1;
    playerA.lastPicked = response.createdAt;
    playerB.lastPicked = response.createdAt;
    if (aScore === 1) {
      playerA.wins += 1;
      playerB.losses += 1;
    } else {
      playerB.wins += 1;
      playerA.losses += 1;
    }
  });

  return [...rows.values()].sort((a, b) => b.rating - a.rating || b.matches - a.matches || a.prospect.player.localeCompare(b.prospect.player));
}

function expectedDraftEloScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

function recentChoiceText(response: DraftEloResponse, prospectMap: Map<string, DraftProspect>): string {
  const winner = prospectMap.get(response.winnerKey)?.player ?? "Unknown";
  const loserKey = response.winnerKey === response.playerAKey ? response.playerBKey : response.playerAKey;
  const loser = prospectMap.get(loserKey)?.player ?? "Unknown";
  return `Last pick: ${winner} over ${loser}`;
}

function formatInches(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const total = Math.round(value);
  const feet = Math.floor(total / 12);
  const inches = total % 12;
  return `${feet}'${inches}"`;
}

function formatWeight(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value, 0)} lb`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function storageLabel(mode: DraftEloStorageMode): string {
  if (mode === "indexeddb") return "IndexedDB";
  if (mode === "localstorage") return "Local";
  return "Loading";
}

function LineupWorkspace({ data, season }: { data: AppData; season: number }) {
  const players = useMemo(
    () =>
      data.players
        .filter((player) => player.year === season)
        .sort((a, b) => b.total - a.total || b.scalability - a.scalability || a.player_name.localeCompare(b.player_name)),
    [data.players, season]
  );
  const playerMap = useMemo(() => new Map(players.map((player) => [lineupPlayerId(player), player])), [players]);
  const percentileMap = useMemo(() => buildLineupPercentiles(players), [players]);
  const lineupBenchmarks = useMemo(() => buildLineupBenchmarks(players), [players]);
  const [lineupA, setLineupA] = useSessionState<string[]>("lineup:a", emptyLineup());
  const [lineupB, setLineupB] = useSessionState<string[]>("lineup:b", emptyLineup());
  const [suggestionSlot, setSuggestionSlot] = useSessionState<number | null>("lineup:suggestionSlot", null);
  const [suggestionPage, setSuggestionPage] = useSessionState("lineup:suggestionPage", 0);

  const summaryA = useMemo(() => summarizeLineup(lineupA, playerMap, lineupBenchmarks), [lineupA, playerMap, lineupBenchmarks]);
  const summaryB = useMemo(() => summarizeLineup(lineupB, playerMap, lineupBenchmarks), [lineupB, playerMap, lineupBenchmarks]);
  const availablePlayers = useMemo(
    () => [...players].sort((a, b) => a.player_name.localeCompare(b.player_name)),
    [players]
  );
  const setSlot = (side: LineupSide, index: number, value: string) => {
    const setter = side === "a" ? setLineupA : setLineupB;
    setter((current) => current.map((slot, slotIndex) => (slotIndex === index ? value : slot)));
    if (side === "a") {
      setSuggestionSlot(null);
      setSuggestionPage(0);
    }
  };
  const clearSlot = (side: LineupSide, index: number) => {
    setSlot(side, index, "");
  };
  const clearSide = (side: LineupSide) => {
    if (side === "a") {
      setLineupA(emptyLineup());
      setSuggestionSlot(null);
      setSuggestionPage(0);
    }
    else setLineupB(emptyLineup());
  };
  const suggestions = useMemo(
    () =>
      suggestionSlot === null
        ? []
        : buildLineupSuggestions({
            slotIndex: suggestionSlot,
            selectedIds: lineupA,
            players,
            playerMap,
            percentileMap,
            lineupBenchmarks,
            baseline: summaryA
          }),
    [lineupA, lineupBenchmarks, playerMap, percentileMap, players, suggestionSlot, summaryA]
  );
  const suggestedSlotPlayer = suggestionSlot === null ? null : summaryA.slots[suggestionSlot];

  return (
    <main className="workspace lineup-workspace">
      <section className="table-panel lineup-board">
        <div className="panel-heading">
          <div>
            <h2>Lineup Synergy</h2>
            <p>Primary lineup skill mesh, gaps, spikes, and fit texture</p>
          </div>
        </div>
        {players.length > 0 ? (
          <div className="lineup-content">
            <LineupSheet
              side="a"
              slots={summaryA.slots}
              selectedIds={lineupA}
              players={availablePlayers}
              summary={summaryA}
              percentileMap={percentileMap}
              suggestionSlot={suggestionSlot}
              suggestionPage={suggestionPage}
              suggestions={suggestions}
              suggestedSlotPlayer={suggestedSlotPlayer}
              onChange={setSlot}
              onClearSlot={clearSlot}
              onClear={clearSide}
              onToggleSuggestions={(index) => {
                setSuggestionSlot((current) => (current === index ? null : index));
                setSuggestionPage(0);
              }}
              onSuggestionPageChange={setSuggestionPage}
            />
            <div className="lineup-matchup-secondary">
              <div className="lineup-section-title">
                <h3>Matchup Edge</h3>
                <span>Optional A/B context</span>
              </div>
              <div className="lineup-matchup">
                <LineupVersus summaryA={summaryA} summaryB={summaryB} />
                <div className="lineup-skill-matrix compact">
                  {lineupSkills.map((skill) => {
                    const aValue = summaryA.skillAverages[skill.key] ?? 0;
                    const bValue = summaryB.skillAverages[skill.key] ?? 0;
                    return <LineupSkillRow key={skill.key} skill={skill} aValue={aValue} bValue={bValue} />;
                  })}
                </div>
                <LineupCard
                  title="Comparison Lineup"
                  side="b"
                  slots={summaryB.slots}
                  selectedIds={lineupB}
                  players={availablePlayers}
                  summary={summaryB}
                  onChange={setSlot}
                  onClearSlot={clearSlot}
                  onClear={clearSide}
                />
              </div>
            </div>
          </div>
        ) : <EmptyState title="No lineup players" detail={`No player rows are available for ${season}.`} />}
      </section>
    </main>
  );
}

function LineupSheet({
  side,
  slots,
  selectedIds,
  players,
  summary,
  percentileMap,
  suggestionSlot,
  suggestionPage,
  suggestions,
  suggestedSlotPlayer,
  onChange,
  onClearSlot,
  onClear,
  onToggleSuggestions,
  onSuggestionPageChange
}: {
  side: LineupSide;
  slots: LineupSlot[];
  selectedIds: string[];
  players: PlayerImpact[];
  summary: LineupSummary;
  percentileMap: Map<string, Record<string, number>>;
  suggestionSlot: number | null;
  suggestionPage: number;
  suggestions: LineupSuggestion[];
  suggestedSlotPlayer: LineupSlot;
  onChange: (side: LineupSide, index: number, value: string) => void;
  onClearSlot: (side: LineupSide, index: number) => void;
  onClear: (side: LineupSide) => void;
  onToggleSuggestions: (index: number) => void;
  onSuggestionPageChange: (page: number) => void;
}) {
  return (
    <div className="lineup-sheet">
      <div className="lineup-sheet-top">
        <div>
          <h3>Primary Lineup</h3>
          <strong>{formatSigned(summary.net, 1)}</strong>
        </div>
        <button onClick={() => onClear(side)}>Clear</button>
      </div>
      <LineupPlayerSearch selectedIds={selectedIds} players={players} side={side} onChange={onChange} />
      <div className="lineup-sheet-scroll">
        <table className="lineup-sheet-table">
          <thead>
            <tr>
              <th className="sheet-name-col">Name</th>
              <th>Pos</th>
              <th>Off</th>
              <th>Def</th>
              <th>Total</th>
              <th>Score</th>
              <th>Fit</th>
              <th>Tier</th>
              {lineupSkills.map((skill) => (
                <th key={skill.key}>{skill.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedIds.map((selectedId, index) => {
              const player = slots[index];
              const ranks = player ? percentileMap.get(lineupPlayerId(player)) ?? {} : {};
              return (
                <tr key={`${side}-${index}`} className={cls(!player && "empty")}>
                  <td className="sheet-name-cell">
                    <div className="sheet-name-pick" style={player ? rowAccentStyle(player) : undefined}>
                      {player && <PlayerHeadshot player={player} />}
                      <select value={selectedId} onChange={(event) => onChange(side, index, event.target.value)}>
                        <option value="">Open slot</option>
                        {players.map((option) => {
                          const id = lineupPlayerId(option);
                          return (
                            <option key={id} value={id}>
                              {option.player_name}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </td>
                  <td>{player ? displayPosition(player.position) : "-"}</td>
                  <td><SheetRate value={player?.offense} /></td>
                  <td><SheetRate value={player?.defense} /></td>
                  <td><SheetRate value={player?.total} strong /></td>
                  <td>{formatLineupScore(player)}</td>
                  <td>
                    <button
                      className={cls("lineup-fit-button", suggestionSlot === index && "active")}
                      onClick={() => onToggleSuggestions(index)}
                      title={player ? `Find lineup fits for ${player.player_name}` : "Find lineup fits for this open slot"}
                      aria-label={player ? `Find lineup fits for ${player.player_name}` : "Find lineup fits for this open slot"}
                    >
                      +
                    </button>
                    {player && (
                      <button
                        className="lineup-remove-button"
                        onClick={() => onClearSlot(side, index)}
                        title={`Remove ${player.player_name}`}
                        aria-label={`Remove ${player.player_name}`}
                      >
                        X
                      </button>
                    )}
                  </td>
                  <td className="sheet-tier">{player?.tier ?? "-"}</td>
                  {lineupSkills.map((skill) => (
                    <td key={skill.key}>
                      <SheetPercent value={player ? ranks[skill.key] ?? 0.5 : null} />
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="lineup-sheet-total">
              <td>Total / Team Pct</td>
              <td>{summary.players.length}/5</td>
              <td><SheetRate value={summary.offense} /></td>
              <td><SheetRate value={summary.defense} /></td>
              <td><SheetRate value={summary.net} strong /></td>
              <td>{formatNumber(summary.score, 0)}</td>
              <td>-</td>
              <td>{summary.gaps} gaps</td>
              {lineupSkills.map((skill) => (
                <td key={skill.key}>
                  <SheetPercent value={summary.skillAverages[skill.key] ?? 0} featured />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {suggestionSlot !== null && (
        <LineupSuggestionPanel
          slotIndex={suggestionSlot}
          currentPlayer={suggestedSlotPlayer}
          suggestions={suggestions}
          page={suggestionPage}
          onPageChange={onSuggestionPageChange}
          onPick={(player) => onChange(side, suggestionSlot, lineupPlayerId(player))}
        />
      )}
    </div>
  );
}

function LineupPlayerSearch({
  selectedIds,
  players,
  side,
  onChange
}: {
  selectedIds: string[];
  players: PlayerImpact[];
  side: LineupSide;
  onChange: (side: LineupSide, index: number, value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [targetSlot, setTargetSlot] = useState(() => Math.max(0, selectedIds.findIndex((id) => !id)));
  const selectedSet = useMemo(() => new Set(selectedIds.filter(Boolean)), [selectedIds]);
  const openSlot = selectedIds.findIndex((id) => !id);
  const activeSlot = clamp(targetSlot, 0, Math.max(0, selectedIds.length - 1));
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    return players
      .filter((player) => {
        const id = lineupPlayerId(player);
        if (selectedSet.has(id)) return false;
        const haystack = [
          player.player_name,
          player.team,
          displayPosition(player.position),
          player.tier,
          String(player.score ?? "")
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aName = a.player_name.toLowerCase();
        const bName = b.player_name.toLowerCase();
        const aStarts = aName.startsWith(normalizedQuery) ? 1 : 0;
        const bStarts = bName.startsWith(normalizedQuery) ? 1 : 0;
        return bStarts - aStarts || b.total - a.total || b.score - a.score || a.player_name.localeCompare(b.player_name);
      })
      .slice(0, 8);
  }, [normalizedQuery, players, selectedSet]);

  useEffect(() => {
    if (openSlot >= 0 && !selectedIds[activeSlot]) return;
    if (openSlot >= 0) setTargetSlot(openSlot);
  }, [activeSlot, openSlot, selectedIds]);

  const pickPlayer = (player: PlayerImpact) => {
    const slot = selectedIds[activeSlot] || openSlot < 0 ? activeSlot : openSlot;
    onChange(side, slot, lineupPlayerId(player));
    setQuery("");
    const nextOpenSlot = selectedIds.findIndex((id, index) => index !== slot && !id);
    if (nextOpenSlot >= 0) setTargetSlot(nextOpenSlot);
  };

  return (
    <div className="lineup-player-search">
      <label>
        <span>Find player</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type name, team, position, tier"
          aria-label="Find lineup player"
        />
      </label>
      <label>
        <span>Slot</span>
        <select value={activeSlot} onChange={(event) => setTargetSlot(Number(event.target.value))}>
          {selectedIds.map((id, index) => (
            <option key={index} value={index}>{`P${index + 1}${id ? "" : " open"}`}</option>
          ))}
        </select>
      </label>
      <div className={cls("lineup-player-search-results", normalizedQuery && "active")}>
        {normalizedQuery && matches.length === 0 && <span>No matches</span>}
        {matches.map((player) => (
          <button key={lineupPlayerId(player)} type="button" onClick={() => pickPlayer(player)} style={rowAccentStyle(player)}>
            <strong>{player.player_name}</strong>
            <span>{player.team} / {displayPosition(player.position)} / {formatSigned(player.total, 1)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LineupSuggestionPanel({
  slotIndex,
  currentPlayer,
  suggestions,
  page,
  onPageChange,
  onPick
}: {
  slotIndex: number;
  currentPlayer: LineupSlot;
  suggestions: LineupSuggestion[];
  page: number;
  onPageChange: (page: number) => void;
  onPick: (player: PlayerImpact) => void;
}) {
  const context = currentPlayer ? `Replace ${currentPlayer.player_name}` : `Fill Player ${slotIndex + 1}`;
  const totalPages = Math.max(1, Math.ceil(suggestions.length / LINEUP_SUGGESTIONS_PER_PAGE));
  const activePage = clamp(page, 0, totalPages - 1);
  const pageSuggestions = suggestions.slice(
    activePage * LINEUP_SUGGESTIONS_PER_PAGE,
    activePage * LINEUP_SUGGESTIONS_PER_PAGE + LINEUP_SUGGESTIONS_PER_PAGE
  );
  return (
    <div className="lineup-suggestion-panel">
      <div className="lineup-section-title">
        <h3>{context}</h3>
        <span>{suggestions.length > 0 ? `${suggestions.length} targeted fits` : "No targeted fits found"}</span>
      </div>
      {suggestions.length > 0 ? (
        <>
          <div className="lineup-suggestion-list">
            {pageSuggestions.map((suggestion) => (
              <button
                key={lineupPlayerId(suggestion.player)}
                className="lineup-suggestion-row"
                style={rowAccentStyle(suggestion.player)}
                onClick={() => onPick(suggestion.player)}
              >
                <PlayerHeadshot player={suggestion.player} />
                <div>
                  <strong>{suggestion.player.player_name}</strong>
                  <span>
                    {suggestion.player.team} / {displayPosition(suggestion.player.position)} / {suggestion.player.tier}
                  </span>
                  <em>{suggestion.reasons.join(" / ")}</em>
                </div>
                <div className="lineup-suggestion-metrics">
                  <small>Fit {formatNumber(suggestion.score, 1)}</small>
                  <small>Net {formatSigned(suggestion.netDelta, 1)}</small>
                  <small>{formatGapDelta(suggestion.gapDelta)}</small>
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="lineup-suggestion-pager">
              <button onClick={() => onPageChange(activePage - 1)} disabled={activePage === 0}>
                Previous
              </button>
              <span>{`Page ${activePage + 1} of ${totalPages}`}</span>
              <button onClick={() => onPageChange(activePage + 1)} disabled={activePage >= totalPages - 1}>
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="lineup-suggestion-empty">No one in the compatible role pool repairs a real lineup need without giving too much back.</p>
      )}
    </div>
  );
}

function SheetRate({ value, strong }: { value: number | null | undefined; strong?: boolean }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="sheet-rate empty">-</span>;
  return (
    <span className={cls("sheet-rate", strong && "strong")} style={rateStyle(value)}>
      {formatSigned(value, 1)}
    </span>
  );
}

function SheetPercent({ value, featured }: { value: number | null; featured?: boolean }) {
  if (value === null) return <span className="sheet-percent empty">-</span>;
  const tone = featured ? lineupAverageTone(value) : value >= 0.6 ? "good" : value < LINEUP_GAP_THRESHOLD ? "bad" : "mid";
  return (
    <span className={cls("sheet-percent", tone, featured && "featured")} style={percentileCellStyle(value, featured)}>
      {Math.round(value * 100)}
    </span>
  );
}

function formatLineupScore(player: PlayerImpact | null): string {
  if (!player) return "-";
  if (player.score_label === "DNQ") return "DNQ";
  return String(Math.round(player.score));
}

function LineupCard({
  title,
  side,
  slots,
  selectedIds,
  players,
  summary,
  onChange,
  onClearSlot,
  onClear
}: {
  title: string;
  side: LineupSide;
  slots: LineupSlot[];
  selectedIds: string[];
  players: PlayerImpact[];
  summary: LineupSummary;
  onChange: (side: LineupSide, index: number, value: string) => void;
  onClearSlot: (side: LineupSide, index: number) => void;
  onClear: (side: LineupSide) => void;
}) {
  return (
    <div className="lineup-card">
      <div className="lineup-card-head">
        <div>
          <h3>{title}</h3>
          <strong>{formatSigned(summary.net, 1)}</strong>
        </div>
        <button onClick={() => onClear(side)}>Clear</button>
      </div>
      <LineupPlayerSearch selectedIds={selectedIds} players={players} side={side} onChange={onChange} />
      <div className="lineup-slots">
        {selectedIds.map((selectedId, index) => {
          const player = slots[index];
          return (
            <label key={`${side}-${index}`} className="lineup-slot">
              <span>{`Player ${index + 1}`}</span>
              <select value={selectedId} onChange={(event) => onChange(side, index, event.target.value)}>
                <option value="">Open slot</option>
                {players.map((option) => {
                  const id = lineupPlayerId(option);
                  return (
                    <option key={id} value={id}>
                      {option.player_name} / {option.team} / {displayPosition(option.position)}
                    </option>
                  );
                })}
              </select>
              {player && (
                <div className="lineup-player-mini" style={rowAccentStyle(player)}>
                  <PlayerHeadshot player={player} />
                  <div>
                    <strong>{player.player_name}</strong>
                    <span>{displayPosition(player.position)} / {player.tier}</span>
                  </div>
                  <StatValue value={player.total} />
                  <button
                    className="lineup-mini-remove"
                    onClick={() => onClearSlot(side, index)}
                    title={`Remove ${player.player_name}`}
                    aria-label={`Remove ${player.player_name}`}
                  >
                    X
                  </button>
                </div>
              )}
            </label>
          );
        })}
      </div>
      <div className="lineup-metrics">
        <MetricPill label="Offense" value={formatSigned(summary.offense, 1)} tone="green" />
        <MetricPill label="Defense" value={formatSigned(summary.defense, 1)} tone="teal" />
        <MetricPill label="Score" value={formatNumber(summary.score, 1)} tone="gold" />
        <MetricPill label="Gaps / Spikes" value={`${summary.gaps} / ${summary.spikes}`} />
      </div>
    </div>
  );
}

function LineupVersus({ summaryA, summaryB }: { summaryA: LineupSummary; summaryB: LineupSummary }) {
  const edge = summaryA.net - summaryB.net;
  const label = Math.abs(edge) < 0.05 ? "Even" : edge > 0 ? "A Edge" : "B Edge";
  return (
    <div className="lineup-versus">
      <span>Projected NRTG</span>
      <strong style={rateStyle(edge)}>{formatSigned(edge, 1)}</strong>
      <em>{label}</em>
      <div>
        <small>A {formatSigned(summaryA.net, 1)}</small>
        <small>B {formatSigned(summaryB.net, 1)}</small>
      </div>
    </div>
  );
}

function LineupSkillRow({ skill, aValue, bValue }: { skill: LineupSkill; aValue: number; bValue: number }) {
  const edge = aValue - bValue;
  const aPct = clamp(aValue * 50, 0, 50);
  const bPct = clamp(bValue * 50, 0, 50);
  return (
    <div className="lineup-skill-row">
      <span>{skill.label}</span>
      <div className="lineup-skill-track">
        <i className="side-a" style={{ width: `${aPct}%` }} />
        <i className="side-b" style={{ width: `${bPct}%` }} />
        <em className="side-a-label">{Math.round(aValue * 100)}</em>
        <em className="side-b-label">{Math.round(bValue * 100)}</em>
      </div>
      <strong style={rateStyle(edge * 4)}>{formatSigned(edge, 2)}</strong>
    </div>
  );
}

function lineupPlayerId(player: PlayerImpact): string {
  return `${player.nba_id}-${player.year}`;
}

function buildLineupSuggestions({
  slotIndex,
  selectedIds,
  players,
  playerMap,
  percentileMap,
  lineupBenchmarks,
  baseline
}: {
  slotIndex: number;
  selectedIds: string[];
  players: PlayerImpact[];
  playerMap: Map<string, PlayerImpact>;
  percentileMap: Map<string, Record<string, number>>;
  lineupBenchmarks: LineupBenchmarks;
  baseline: LineupSummary;
}): LineupSuggestion[] {
  const currentPlayer = baseline.slots[slotIndex];
  const selectedElsewhere = new Set(selectedIds.filter((id, index) => id && index !== slotIndex));
  const needProfile = lineupSkills
    .map((skill) => ({ skill, weight: lineupNeedWeight(baseline.skillAverages[skill.key] ?? 0) }))
    .filter((need) => need.weight > 0);
  const baselineGaps = needProfile.map((need) => need.skill);
  const candidateSuggestions = players
    .filter((player) => !selectedElsewhere.has(lineupPlayerId(player)) && lineupPositionsCompatible(currentPlayer, player))
    .map((player) => {
      const playerId = lineupPlayerId(player);
      const nextIds = selectedIds.map((id, index) => (index === slotIndex ? playerId : id));
      const summary = summarizeLineup(nextIds, playerMap, lineupBenchmarks);
      const playerRanks = percentileMap.get(playerId) ?? {};
      const currentRanks = currentPlayer ? percentileMap.get(lineupPlayerId(currentPlayer)) ?? {} : {};
      const netDelta = summary.net - baseline.net;
      const scoreDelta = summary.score - baseline.score;
      const gapDelta = summary.gaps - baseline.gaps;
      const newGaps = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before >= LINEUP_GAP_THRESHOLD && after < LINEUP_GAP_THRESHOLD;
      });
      const improvedGaps = baselineGaps
        .filter((skill) => {
          const before = baseline.skillAverages[skill.key] ?? 0;
          const after = summary.skillAverages[skill.key] ?? 0;
          return after >= LINEUP_GAP_THRESHOLD || after - before >= 0.06;
        })
        .sort((a, b) => (summary.skillAverages[b.key] ?? 0) - (baseline.skillAverages[b.key] ?? 0) - ((summary.skillAverages[a.key] ?? 0) - (baseline.skillAverages[a.key] ?? 0)));
      const needLift = needProfile.reduce((sum, need) => {
        const before = baseline.skillAverages[need.skill.key] ?? 0;
        const after = summary.skillAverages[need.skill.key] ?? 0;
        const currentRank = currentPlayer ? currentRanks[need.skill.key] ?? 0.5 : Math.min(0.5, before);
        const playerRank = playerRanks[need.skill.key] ?? 0.5;
        const lineupLift = Math.max(0, after - before) * (before < LINEUP_GAP_THRESHOLD ? 56 : 34);
        const directFit = Math.max(0, playerRank - currentRank) * need.weight * (before < LINEUP_GAP_THRESHOLD ? 2.6 : 1.5);
        return sum + need.weight * lineupLift + directFit;
      }, 0);
      const solvedHardGaps = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before < LINEUP_GAP_THRESHOLD && after >= LINEUP_GAP_THRESHOLD;
      }).length;
      const stabilizesSoftNeeds = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before >= LINEUP_GAP_THRESHOLD && before < 0.52 && after >= 0.52;
      }).length;
      const regressionPenalty = lineupSkills.reduce((sum, skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return sum + Math.max(0, before - after - 0.025) * (before >= 0.56 ? 22 : 8);
      }, 0);
      const creationPenalty = newGaps.length * 5.5 + Math.max(0, gapDelta) * 4.5;
      const rawTalentBonus = clamp(netDelta, -0.9, 1.1) * 0.55 + clamp(scoreDelta, -8, 8) * 0.06;
      const rolePenalty = lineupRolePenalty(player, currentPlayer, needLift + solvedHardGaps * 3 + stabilizesSoftNeeds);
      const score =
        needLift +
        solvedHardGaps * 4.2 +
        stabilizesSoftNeeds * 1.6 +
        Math.max(0, -gapDelta) * 2.8 +
        (newGaps.length === 0 ? 1.1 : 0) +
        rawTalentBonus -
        creationPenalty -
        regressionPenalty -
        rolePenalty;
      const reasons = lineupSuggestionReasons(player, summary, baseline, improvedGaps, newGaps, netDelta, scoreDelta);

      return {
        player,
        summary,
        score,
        netDelta,
        scoreDelta,
        gapDelta,
        newGaps,
        improvedGaps,
        reasons
      };
    })
    .filter((suggestion) => {
      const currentId = selectedIds[slotIndex];
      const isCurrent = currentId && lineupPlayerId(suggestion.player) === currentId;
      if (isCurrent) return false;
      const meaningfulFit = suggestion.improvedGaps.length > 0 || suggestion.gapDelta < 0;
      const notJustTalent = suggestion.score > 1.25 && meaningfulFit;
      return notJustTalent && suggestion.newGaps.length <= 1 && suggestion.netDelta > -1.25;
    })
    .sort((a, b) => b.score - a.score || b.netDelta - a.netDelta || a.player.player_name.localeCompare(b.player.player_name));
  const cleanFits = candidateSuggestions.filter((suggestion) => suggestion.newGaps.length === 0);
  return curateLineupSuggestions(cleanFits.length >= LINEUP_SUGGESTIONS_PER_PAGE ? cleanFits : candidateSuggestions, currentPlayer, LINEUP_MAX_SUGGESTIONS);
}

function lineupNeedWeight(value: number): number {
  if (value >= 0.56) return 0;
  return Math.pow(clamp((0.56 - value) / 0.22, 0, 1), 1.15);
}

function lineupPositionsCompatible(currentPlayer: PlayerImpact | null, candidate: PlayerImpact): boolean {
  if (!currentPlayer) return true;
  const current = currentPlayer.position;
  const next = candidate.position;
  if (current === next) return true;
  const neighbors: Record<string, string[]> = {
    PG: ["SG"],
    SG: ["PG", "SF"],
    SF: ["SG", "PF"],
    PF: ["SF", "C"],
    C: ["PF"]
  };
  return neighbors[current]?.includes(next) ?? false;
}

function lineupRolePenalty(player: PlayerImpact, currentPlayer: PlayerImpact | null, fitStrength: number): number {
  const currentScore = currentPlayer?.score ?? 74;
  const currentTotal = currentPlayer?.total ?? 1.2;
  const scoreLeap = Math.max(0, player.score - currentScore - 14);
  const totalLeap = Math.max(0, player.total - currentTotal - 1.6);
  const eliteTax = Math.max(0, player.score - 86) * 0.1 + Math.max(0, player.total - 4.2) * 0.9;
  const fitDiscount = fitStrength >= 9 ? 0.35 : fitStrength >= 6 ? 0.6 : 1;
  return (scoreLeap * 0.11 + totalLeap * 1.15 + eliteTax) * fitDiscount;
}

function curateLineupSuggestions(suggestions: LineupSuggestion[], currentPlayer: PlayerImpact | null, maxResults: number): LineupSuggestion[] {
  const replacingStar = currentPlayer ? lineupIsObviousStar(currentPlayer) : false;
  const curated: LineupSuggestion[] = [];
  const starCap = replacingStar ? maxResults : Math.max(2, Math.ceil(maxResults / 6));
  let obviousStarAdds = 0;

  suggestions.forEach((suggestion) => {
    if (curated.length >= maxResults) return;
    const obviousStar = lineupIsObviousStar(suggestion.player) && !replacingStar;
    if (obviousStar && obviousStarAdds >= starCap) return;
    if (obviousStar) obviousStarAdds += 1;
    curated.push(suggestion);
  });

  suggestions.forEach((suggestion) => {
    if (curated.length >= maxResults) return;
    if (!curated.some((item) => lineupPlayerId(item.player) === lineupPlayerId(suggestion.player))) {
      curated.push(suggestion);
    }
  });
  return curated;
}

function lineupIsObviousStar(player: PlayerImpact): boolean {
  const tier = player.tier.toLowerCase();
  return player.score >= 88 || player.total >= 4.4 || tier.includes("franchise") || tier.includes("star+");
}

function lineupSuggestionReasons(
  player: PlayerImpact,
  summary: LineupSummary,
  baseline: LineupSummary,
  improvedGaps: LineupSkill[],
  newGaps: LineupSkill[],
  netDelta: number,
  scoreDelta: number
): string[] {
  const reasons: string[] = [];
  if (improvedGaps.length > 0) {
    reasons.push(`Lifts ${improvedGaps.slice(0, 2).map((skill) => skill.label).join(", ")}`);
  }
  if (summary.gaps < baseline.gaps) reasons.push(`${baseline.gaps - summary.gaps} fewer gap${baseline.gaps - summary.gaps === 1 ? "" : "s"}`);
  if (netDelta > 0.15) reasons.push(`${formatSigned(netDelta, 1)} net`);
  if (scoreDelta > 1) reasons.push(`${formatSigned(scoreDelta, 0)} score`);
  if (newGaps.length === 0) reasons.push("No new gaps");
  else reasons.push(`Watch ${newGaps[0].label}`);
  if (reasons.length === 1) reasons.unshift(`${displayPosition(player.position)} fit`);
  return reasons.slice(0, 4);
}

function formatGapDelta(value: number): string {
  if (value < 0) return `${Math.abs(value)} fewer gaps`;
  if (value > 0) return `${value} new gaps`;
  return "Gaps even";
}

function buildLineupPercentiles(players: PlayerImpact[]): Map<string, Record<string, number>> {
  const percentileMap = new Map<string, Record<string, number>>();
  const valueRanks = new Map<string, Map<string, number>>();

  lineupSkills.forEach((skill) => {
    const values = players
      .map((player) => ({ id: lineupPlayerId(player), value: lineupSkillValue(player, skill) }))
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => a.value - b.value);
    const ranks = new Map<string, number>();
    values.forEach((item, index) => {
      ranks.set(item.id, values.length <= 1 ? 0.5 : index / (values.length - 1));
    });
    valueRanks.set(skill.key, ranks);
  });

  players.forEach((player) => {
    const id = lineupPlayerId(player);
    const ranks: Record<string, number> = {};
    lineupSkills.forEach((skill) => {
      ranks[skill.key] = valueRanks.get(skill.key)?.get(id) ?? 0.5;
    });
    percentileMap.set(id, ranks);
  });

  return percentileMap;
}

function buildLineupBenchmarks(players: PlayerImpact[]): LineupBenchmarks {
  const byTeam = new Map<string, PlayerImpact[]>();
  players.forEach((player) => {
    const team = cleanTeamValue(player.team);
    if (!team) return;
    byTeam.set(team, [...(byTeam.get(team) ?? []), player]);
  });

  const teamCores = Array.from(byTeam.values())
    .map((teamPlayers) => [...teamPlayers].sort(compareLineupBenchmarkPlayers).slice(0, 5))
    .filter((teamPlayers) => teamPlayers.length > 0);
  const simulatedCores = buildSimulatedLineupCores(players);
  const benchmarks: LineupBenchmarks = new Map();

  for (let size = 1; size <= 5; size += 1) {
    const bySkill: Record<string, LineupBenchmark> = {};
    lineupSkills.forEach((skill) => {
      const values = teamCores
        .filter((teamPlayers) => teamPlayers.length >= size)
        .map((teamPlayers) => teamPlayers.slice(0, size).reduce((sum, player) => sum + lineupSkillValue(player, skill), 0))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      const simulatedValues = simulatedCores
        .filter((teamPlayers) => teamPlayers.length >= size)
        .map((teamPlayers) => teamPlayers.slice(0, size).reduce((sum, player) => sum + lineupSkillValue(player, skill), 0))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      bySkill[skill.key] = {
        values,
        average: lineupBenchmarkAverage(values),
        simulatedValues,
        simulatedAverage: lineupBenchmarkAverage(simulatedValues)
      };
    });
    benchmarks.set(size, bySkill);
  }

  return benchmarks;
}

function compareLineupBenchmarkPlayers(a: PlayerImpact, b: PlayerImpact): number {
  const aRole = Number(a.lineup_role_order ?? 99);
  const bRole = Number(b.lineup_role_order ?? 99);
  if (aRole !== bRole) return aRole - bRole;
  const aMinutes = Number(a.lineup_adjusted_minutes ?? a.Minutes ?? 0);
  const bMinutes = Number(b.lineup_adjusted_minutes ?? b.Minutes ?? 0);
  return bMinutes - aMinutes || b.total - a.total || b.score - a.score || a.player_name.localeCompare(b.player_name);
}

function buildSimulatedLineupCores(players: PlayerImpact[]): PlayerImpact[][] {
  const pool = players
    .filter((player) => Number.isFinite(player.total) && Number.isFinite(player.score) && lineupHasAnySlotFit(player))
    .sort((a, b) => lineupPlayerId(a).localeCompare(lineupPlayerId(b)));
  if (pool.length < 5) return [];

  const season = pool.find((player) => Number.isFinite(player.year))?.year ?? 0;
  const random = createLineupPrng(LINEUP_SIMULATION_SEED + season * 1009 + pool.length * 17);
  const rolePools = buildLineupRolePools(pool);
  const simulated: PlayerImpact[][] = [];
  let attempts = 0;
  const maxAttempts = LINEUP_SIMULATION_COUNT * 8;

  while (simulated.length < LINEUP_SIMULATION_COUNT && attempts < maxAttempts) {
    attempts += 1;
    const template = pickLineupSimulationTemplate(random);
    const lineup = sampleSimulatedLineup(rolePools, template, random);
    if (!lineup) continue;
    simulated.push([...lineup].sort(compareLineupBenchmarkPlayers));
  }

  return simulated;
}

function sampleSimulatedLineup(
  rolePools: Record<LineupSlotRole, LineupRolePool>,
  template: LineupSimulationTemplate,
  random: () => number
): PlayerImpact[] | null {
  const selected: PlayerImpact[] = [];
  const used = new Set<string>();

  for (const role of template.roles) {
    const player = pickLineupSlotPlayer(rolePools[role], used, random);
    if (!player) return null;
    selected.push(player);
    used.add(lineupPlayerId(player));
  }

  return lineupPassesSimulationSanity(selected) ? selected : null;
}

function buildLineupRolePools(pool: PlayerImpact[]): Record<LineupSlotRole, LineupRolePool> {
  return LINEUP_SIMULATION_ROLES.reduce((rolePools, role) => {
    rolePools[role] = buildLineupRolePool(pool, role);
    return rolePools;
  }, {} as Record<LineupSlotRole, LineupRolePool>);
}

function buildLineupRolePool(pool: PlayerImpact[], role: LineupSlotRole): LineupRolePool {
  let totalWeight = 0;
  const candidates: LineupRolePool["candidates"] = [];

  pool.forEach((player) => {
    const fit = lineupSlotFit(player, role);
    if (fit < 0.12) return;
    const weight = fit * lineupSamplingWeight(player);
    if (!Number.isFinite(weight) || weight <= 0) return;
    totalWeight += weight;
    candidates.push({ player, cumulative: totalWeight });
  });

  return { candidates, totalWeight };
}

function pickLineupSlotPlayer(rolePool: LineupRolePool, used: Set<string>, random: () => number): PlayerImpact | null {
  if (rolePool.totalWeight <= 0 || rolePool.candidates.length === 0) return null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const player = pickWeightedLineupRoleCandidate(rolePool, random);
    if (player && !used.has(lineupPlayerId(player))) return player;
  }

  const start = Math.floor(random() * rolePool.candidates.length);
  for (let offset = 0; offset < rolePool.candidates.length; offset += 1) {
    const player = rolePool.candidates[(start + offset) % rolePool.candidates.length]?.player;
    if (player && !used.has(lineupPlayerId(player))) return player;
  }

  return null;
}

function pickWeightedLineupRoleCandidate(rolePool: LineupRolePool, random: () => number): PlayerImpact | null {
  const target = random() * rolePool.totalWeight;
  let low = 0;
  let high = rolePool.candidates.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rolePool.candidates[mid].cumulative < target) low = mid + 1;
    else high = mid;
  }
  return rolePool.candidates[low]?.player ?? null;
}

function pickLineupSimulationTemplate(random: () => number): LineupSimulationTemplate {
  const totalWeight = LINEUP_SIMULATION_TEMPLATES.reduce((sum, template) => sum + template.weight, 0);
  const target = random() * totalWeight;
  let cumulative = 0;
  for (const template of LINEUP_SIMULATION_TEMPLATES) {
    cumulative += template.weight;
    if (target <= cumulative) return template;
  }
  return LINEUP_SIMULATION_TEMPLATES[0];
}

function createLineupPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lineupHasAnySlotFit(player: PlayerImpact): boolean {
  return lineupSlotFit(player, "guard") >= 0.12 || lineupSlotFit(player, "wing") >= 0.12 || lineupSlotFit(player, "forward") >= 0.12 || lineupSlotFit(player, "big") >= 0.12;
}

function lineupSlotFit(player: PlayerImpact, role: LineupSlotRole): number {
  const shares = lineupPositionShares(player);
  if (role === "guard") return clamp(shares.pg + shares.sg * 0.85 + shares.sf * 0.2, 0, 1);
  if (role === "wing") return clamp(shares.sg * 0.35 + shares.sf + shares.pf * 0.35, 0, 1);
  if (role === "forward") return clamp(shares.sf * 0.25 + shares.pf + shares.c * 0.08, 0, 1);
  return clamp(shares.pf * 0.25 + shares.c, 0, 1);
}

function lineupPassesSimulationSanity(lineup: PlayerImpact[]): boolean {
  const primaryRoles = lineup.map(lineupPrimarySimulationRole);
  const primaryBigs = primaryRoles.filter((role) => role === "big").length;
  const primaryGuards = primaryRoles.filter((role) => role === "guard").length;
  const stars = lineup.filter(lineupIsSimulationStar).length;
  const highEndPlayers = lineup.filter(lineupIsHighEndSimulationPlayer).length;
  return primaryBigs <= 2 && primaryGuards <= 3 && stars <= 2 && highEndPlayers <= 3;
}

function lineupPrimarySimulationRole(player: PlayerImpact): LineupSlotRole {
  const shares = lineupPositionShares(player);
  const roleValues: Array<{ role: LineupSlotRole; value: number }> = [
    { role: "guard", value: shares.pg + shares.sg },
    { role: "wing", value: shares.sf },
    { role: "forward", value: shares.pf },
    { role: "big", value: shares.c }
  ];
  return roleValues.sort((a, b) => b.value - a.value)[0]?.role ?? "wing";
}

function lineupIsSimulationStar(player: PlayerImpact): boolean {
  const tier = String(player.tier ?? "").trim();
  return tier === "MVP" || tier === "Superstar" || tier === "Star" || Number(player.score ?? 0) >= 94 || Number(player.total ?? 0) >= 4.2;
}

function lineupIsHighEndSimulationPlayer(player: PlayerImpact): boolean {
  const tier = String(player.tier ?? "").trim();
  return lineupIsSimulationStar(player) || tier === "Elite Starter" || Number(player.score ?? 0) >= 90 || Number(player.total ?? 0) >= 3.2;
}

function lineupPositionShares(player: PlayerImpact): LineupPositionShares {
  const shares = {
    pg: lineupShareValue(player.pg_share),
    sg: lineupShareValue(player.sg_share),
    sf: lineupShareValue(player.sf_share),
    pf: lineupShareValue(player.pf_share),
    c: lineupShareValue(player.c_share)
  };
  const total = shares.pg + shares.sg + shares.sf + shares.pf + shares.c;
  if (total > 0.01) {
    return {
      pg: shares.pg / total,
      sg: shares.sg / total,
      sf: shares.sf / total,
      pf: shares.pf / total,
      c: shares.c / total
    };
  }

  const position = displayPosition(player.position).toUpperCase();
  if (position === "PG") return { pg: 1, sg: 0, sf: 0, pf: 0, c: 0 };
  if (position === "SG") return { pg: 0.2, sg: 0.8, sf: 0, pf: 0, c: 0 };
  if (position === "SF") return { pg: 0, sg: 0.1, sf: 0.8, pf: 0.1, c: 0 };
  if (position === "PF") return { pg: 0, sg: 0, sf: 0.1, pf: 0.8, c: 0.1 };
  if (position === "C") return { pg: 0, sg: 0, sf: 0, pf: 0.15, c: 0.85 };
  if (position === "G") return { pg: 0.5, sg: 0.5, sf: 0, pf: 0, c: 0 };
  if (position === "F") return { pg: 0, sg: 0, sf: 0.5, pf: 0.5, c: 0 };
  return { pg: 0, sg: 0.15, sf: 0.35, pf: 0.35, c: 0.15 };
}

function lineupShareValue(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
}

function lineupSamplingWeight(player: PlayerImpact): number {
  const minutes = Math.max(80, Number(player.lineup_adjusted_minutes ?? player.Minutes ?? 0));
  const score = Number(player.score ?? 50);
  const total = Number(player.total ?? 0);
  const minutesWeight = Math.pow(minutes, 0.45);
  const scoreWeight = 0.82 + clamp((score - 45) / 55, 0, 1) * 0.28;
  const totalWeight = 0.9 + clamp((total + 1.5) / 5.5, 0, 1) * 0.22;
  return minutesWeight * scoreWeight * totalWeight * lineupTierMultiplier(player.tier);
}

function lineupTierMultiplier(tier: string | null | undefined): number {
  const value = String(tier ?? "").trim();
  if (value === "MVP") return 1.18;
  if (value === "Superstar") return 1.15;
  if (value === "Star") return 1.12;
  if (value === "Elite Starter") return 1.08;
  if (value === "Starter") return 1.04;
  if (value === "Fringe Starter") return 1;
  if (value === "Strong Bench") return 0.96;
  if (value === "Bench") return 0.88;
  if (value === "Deep Bench") return 0.78;
  if (value === "Project") return 0.68;
  return 0.6;
}

function lineupBenchmarkAverage(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarizeLineup(selectedIds: string[], playerMap: Map<string, PlayerImpact>, lineupBenchmarks: LineupBenchmarks): LineupSummary {
  const slots = selectedIds.map((id) => playerMap.get(id) ?? null);
  const players = slots.filter((player): player is PlayerImpact => Boolean(player));
  const divisor = Math.max(1, players.length);
  const skillAverages: Record<string, number> = {};
  const skillTotals: Record<string, number> = {};

  lineupSkills.forEach((skill) => {
    const total = players.reduce((sum, player) => sum + lineupSkillValue(player, skill), 0);
    skillTotals[skill.key] = total;
    skillAverages[skill.key] = players.length > 0 ? lineupAggregatePercentile(total, lineupBenchmarks.get(players.length)?.[skill.key]) : 0;
  });

  return {
    slots,
    players,
    offense: players.reduce((sum, player) => sum + player.offense, 0),
    defense: players.reduce((sum, player) => sum + player.defense, 0),
    net: players.reduce((sum, player) => sum + player.total, 0),
    score: players.reduce((sum, player) => sum + player.score, 0) / divisor,
    gaps: lineupSkills.filter((skill) => (skillAverages[skill.key] ?? 0) < LINEUP_GAP_THRESHOLD).length,
    spikes: lineupSkills.filter((skill) => (skillAverages[skill.key] ?? 0) > 0.6).length,
    skillAverages,
    skillTotals
  };
}

function lineupAggregatePercentile(value: number, benchmark: LineupBenchmark | undefined): number {
  const teamPercentile = lineupPercentileFromSortedValues(value, benchmark?.values ?? []);
  const simulatedPercentile = lineupPercentileFromSortedValues(value, benchmark?.simulatedValues ?? []);
  if (simulatedPercentile !== null && teamPercentile !== null) {
    return clamp(
      simulatedPercentile * LINEUP_SIMULATED_BLEND_WEIGHT + teamPercentile * (1 - LINEUP_SIMULATED_BLEND_WEIGHT),
      0,
      1
    );
  }
  if (simulatedPercentile !== null) return simulatedPercentile;
  if (teamPercentile !== null) return teamPercentile;
  return 0.5;
}

function lineupPercentileFromSortedValues(value: number, values: number[]): number | null {
  if (!values.length) return null;
  const below = lineupLowerBound(values, value);
  const above = lineupUpperBound(values, value);
  return clamp((below + (above - below) * 0.5) / values.length, 0, 1);
}

function lineupLowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lineupUpperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lineupSkillValue(player: PlayerImpact, skill: LineupSkill): number {
  if (Array.isArray(skill.source)) {
    return skill.source.reduce((sum, key) => sum + Number(player[key] ?? 0), 0) / skill.source.length;
  }
  return Number(player[skill.source] ?? 0);
}

function lineupAverageTone(value: number): "good" | "mid" | "bad" {
  if (value >= 0.56) return "good";
  if (value < LINEUP_GAP_THRESHOLD) return "bad";
  return "mid";
}

function percentileCellStyle(value: number, featured = false): CSSProperties {
  if (featured) return heatStyleVars("rate", value - 0.5, 0.22);
  return heatStyleVars("rate", (value - 0.5) * 4, 2);
}

function TrackerWorkspace({ data }: { data: AppData }) {
  const classes = useMemo(() => {
    const trackerYears = data.trackerProspectScores.map((row) => row.draft_year);
    return Array.from(new Set(trackerYears)).sort((a, b) => b - a);
  }, [data.trackerProspectScores]);
  const [year, setYear] = useState<number | undefined>(classes[0]);
  const [query, setQuery] = useState("");

  const boardScoreByYear = useMemo(() => {
    const map = new Map<string, number | null | undefined>();
    data.trackerBoardScores.forEach((row) => {
      map.set(`${row.draft_year}-${row.board}-score`, row.score);
      map.set(`${row.draft_year}-${row.board}-z`, row.z_score);
    });
    return map;
  }, [data.trackerBoardScores]);
  const leaderboard = useMemo(() => {
    return data.trackerBoardSummary
      .map((row) => ({
        ...row,
        displayBoard: trackerBoardLabel(row.board),
        modelGroup: trackerBoardGroup(row.board),
        yearScore: year === undefined ? null : boardScoreByYear.get(`${year}-${row.board}-score`),
        yearZ: year === undefined ? null : boardScoreByYear.get(`${year}-${row.board}-z`)
      }))
      .sort((a, b) => Number(b.yearZ ?? Number.NEGATIVE_INFINITY) - Number(a.yearZ ?? Number.NEGATIVE_INFINITY));
  }, [boardScoreByYear, data.trackerBoardSummary, year]);
  const classScores = useMemo(
    () => data.trackerProspectScores.filter((row) => row.draft_year === year),
    [data.trackerProspectScores, year]
  );
  const boardColumns = useMemo(() => {
    const present = Array.from(new Set(classScores.map((row) => row.board)));
    const summaryOrder = leaderboard.map((row) => row.board).filter((board) => present.includes(board));
    return summaryOrder.sort((a, b) => trackerBoardPriority(a) - trackerBoardPriority(b));
  }, [classScores, leaderboard]);
  const matrixRows = useMemo(() => {
    const grouped = new Map<string, { anchor: DraftTrackerProspectScore; byBoard: Map<string, DraftTrackerProspectScore> }>();
    classScores.forEach((row) => {
      const key = `${row.draft_year}-${row.player}`;
      const current = grouped.get(key);
      if (current) {
        current.byBoard.set(row.board, row);
        if ((row.actual_rank ?? 999) < (current.anchor.actual_rank ?? 999)) current.anchor = row;
      } else {
        grouped.set(key, { anchor: row, byBoard: new Map([[row.board, row]]) });
      }
    });
    const q = query.trim().toLowerCase();
    return Array.from(grouped.values())
      .filter((row) => !q || row.anchor.player.toLowerCase().includes(q) || String(row.anchor.college ?? "").toLowerCase().includes(q))
      .sort((a, b) => Number(a.anchor.actual_rank ?? 999) - Number(b.anchor.actual_rank ?? 999) || a.anchor.player.localeCompare(b.anchor.player));
  }, [classScores, query]);
  const currentModel = leaderboard.find((row) => row.board === BRENDAN_MODEL_BOARD);
  const bestExternal = leaderboard.find((row) => ![BRENDAN_MODEL_BOARD, BRENDAN_BASE_BOARD, "NBA Draft - Actual"].includes(row.board) && typeof row.yearZ === "number");
  const strongestProspect = matrixRows
    .map((row) => row.byBoard.get(BRENDAN_MODEL_BOARD))
    .filter((row): row is DraftTrackerProspectScore => Boolean(row))
    .sort((a, b) => Number(b.weighted_score_contribution ?? 0) - Number(a.weighted_score_contribution ?? 0))[0];

  const clearFilters = () => setQuery("");

  return (
    <main className="workspace tracker-workspace">
      <section className="tracker-top">
        <section className="control-strip board-controls draft-controls tracker-controls">
          <div className="quick-filters board-control-row">
            <div className="search">
              <span>Find</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Prospect name" />
            </div>
            {classes.length > 0 && <label>
              Class
              <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {classes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>}
            <div className="board-count" aria-live="polite">
              <span>Prospects</span>
              <strong>{matrixRows.length.toLocaleString()}</strong>
            </div>
            <button className="clear-filters" onClick={clearFilters} disabled={!query.trim()}>
              Clear
            </button>
          </div>
        </section>
        <div className="tracker-summary-grid">
          <MetricPill label="Brendan overall z" value={formatSigned(currentModel?.weighted_z, 2)} tone="green" />
          <MetricPill label={`${year ?? "-"} Brendan z`} value={formatSigned(currentModel?.yearZ, 2)} tone="teal" />
          <MetricPill label={`${year ?? "-"} best other`} value={bestExternal?.displayBoard ?? "-"} tone="gold" />
          <MetricPill label="Best prospect" value={strongestProspect?.player ?? "-"} />
        </div>
      </section>

      <section className="table-panel tracker-leaderboard-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Model Performance</h2>
            <p>Overall and selected-class comparison</p>
          </div>
        </div>
        {leaderboard.length > 0 ? <div className="table-wrap compact tracker-leaderboard-wrap">
          <table className="data-table tracker-board-table">
            <colgroup>
              <col className="tracker-rank-col" />
              <col className="tracker-model-col" />
              <col className="tracker-metric-col" />
              <col className="tracker-metric-col" />
              <col className="tracker-metric-col" />
              <col className="tracker-metric-col" />
            </colgroup>
            <thead>
              <tr>
                <th className="align-center">#</th>
                <th>Model</th>
                <th className="align-right">All z</th>
                <th className="align-right">All %</th>
                <th className="align-right">{year ?? "Class"} z</th>
                <th className="align-right">{year ?? "Class"} %</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, index) => (
                <tr key={row.board} style={trackerZStyle(row.yearZ)}>
                  <td className="align-center rank-cell">{index + 1}</td>
                  <td>
                    <div className="tracker-board-name">
                      <strong>{row.displayBoard}</strong>
                    </div>
                  </td>
                  <td className="align-right">{formatSigned(row.weighted_z, 2)}</td>
                  <td className="align-right">{formatPercent(row.weighted_score, 1)}</td>
                  <td className="align-right tracker-z-cell">{formatSigned(row.yearZ, 2)}</td>
                  <td className="align-right">{formatPercent(row.yearScore, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : <EmptyState title="No tracker scores" detail="Run the draft tracker benchmark and frontend export to populate model scores." />}
      </section>

      <section className="table-panel tracker-matrix-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Prospect Correctness</h2>
            <p>Per-prospect accuracy feeding each board score</p>
          </div>
          <div className="tracker-context">
            <span>{year ?? "-"}</span>
            <strong>{boardColumns.length} models</strong>
          </div>
        </div>
        {matrixRows.length > 0 ? <div className="table-wrap tracker-matrix-wrap">
          <table className="data-table tracker-matrix-table">
            <colgroup>
              <col className="tracker-prospect-col" />
              <col className="tracker-actual-col" />
              <col className="tracker-weight-col" />
              {boardColumns.map((board) => (
                <col key={board} className="tracker-board-col" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky-player">Prospect</th>
                <th className="align-center">Actual</th>
                <th className="align-right">Weight</th>
                {boardColumns.map((board) => (
                  <th key={board} className={cls("align-center", board === BRENDAN_MODEL_BOARD && "current-model-head")}>
                    {trackerBoardLabel(board)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={`${row.anchor.draft_year}-${row.anchor.player}`}>
                  <td className="sticky-player">
                    <div className="draft-player-cell">
                      <strong>{row.anchor.player}</strong>
                      <span>{row.anchor.college || "-"}</span>
                    </div>
                  </td>
                  <td className="align-center">
                    <div className="tracker-actual-cell">
                      <strong>#{formatNumber(row.anchor.actual_rank, 0)}</strong>
                      <span>Pick {formatNumber(row.anchor.actual_pick, 0)}</span>
                    </div>
                  </td>
                  <td className="align-right">{formatPercent(row.anchor.actual_weight, 1)}</td>
                  {boardColumns.map((board) => (
                    <td key={board} className="tracker-correct-cell" style={trackerCorrectStyle(row.byBoard.get(board)?.correct_pct)}>
                      <strong>{formatPercentFromWhole(row.byBoard.get(board)?.correct_pct, 0)}</strong>
                      <span>{formatTrackerRank(row.byBoard.get(board))}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div> : <EmptyState title="No prospect tracker rows" detail="No per-prospect tracker scores are available for this class." />}
      </section>
    </main>
  );
}

function trackerBoardLabel(board: string): string {
  return board;
}

function trackerBoardGroup(board: string): string {
  if (board === BRENDAN_MODEL_BOARD) return "current";
  if (board === BRENDAN_BASE_BOARD) return "base";
  if (board === "NBA Draft - Actual") return "draft";
  return "external";
}

function trackerBoardPriority(board: string): number {
  if (board === BRENDAN_MODEL_BOARD) return 0;
  if (board === BRENDAN_BASE_BOARD) return 1;
  if (board === "NBA Draft - Actual") return 2;
  return 10;
}

function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value * 100, digits)}%`;
}

function formatPercentFromWhole(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value, digits)}%`;
}

function formatTrackerRank(row: DraftTrackerProspectScore | undefined): string {
  if (!row) return "unranked";
  if (typeof row.board_rank !== "number" || !Number.isFinite(row.board_rank)) return "unranked";
  const delta = typeof row.rank_error === "number" && Number.isFinite(row.rank_error) ? `, off ${formatNumber(row.rank_error, 0)}` : "";
  return `rank ${formatNumber(row.board_rank, 0)}${delta}`;
}

function trackerCorrectStyle(value: number | null | undefined): CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) return {};
  return heatStyleVars("rate", value - 70, 30);
}

function trackerZStyle(value: number | null | undefined): CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) return {};
  return heatStyleVars("rate", value, 1.6);
}

function PlayerHeadshot({ player, size = "table" }: { player: PlayerImpact; size?: "table" | "detail" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [player.nba_id]);

  const initials = player.player_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const className = cls("player-headshot", size === "detail" && "large");

  if (!player.nba_id || failed) {
    return (
      <span className={className} aria-hidden="true">
        {initials || "?"}
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <img
        src={`${NBA_HEADSHOT_URL}/${player.nba_id}.png`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function ScoreRing({ value, label, size = 40 }: { value: number; label?: string | null; size?: number }) {
  const dnq = label === "DNQ";
  const radius = size / 2 - 4;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = dnq ? 0 : clamp(value, 0, 100) / 100 * circumference;
  const vars = scoreStyle(value) as CSSProperties & { "--score-fill"?: string };
  const color = dnq ? "var(--muted)" : vars["--score-fill"] ?? "var(--teal)";
  const text = dnq ? "DNQ" : String(Math.round(value));
  const strokeWidth = size > 42 ? 4 : 3;

  return (
    <svg className="score-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={vars} role="img" aria-label={`Score ${text}`}>
      <circle className="score-ring-bg" cx={center} cy={center} r={radius} fill="none" strokeWidth={strokeWidth} />
      {!dnq && (
        <circle
          className="score-ring-fg"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeDasharray={`${dash.toFixed(1)} ${(circumference - dash).toFixed(1)}`}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text
        x={center}
        y={center}
        dominantBaseline="central"
        fill={color}
        fontSize={dnq ? Math.round(size * 0.2) : Math.round(size * 0.24)}
        fontWeight="800"
        textAnchor="middle"
      >
        {text}
      </text>
    </svg>
  );
}

function StatValue({ value, tone }: { value: number; tone?: "secondary" }) {
  return (
    <span className={cls("stat-value", tone)} style={rateStyle(value)}>{formatSigned(value, 1)}</span>
  );
}

function ScoreValue({ value, label }: { value: number; label?: string | null }) {
  const dnq = label === "DNQ";
  return (
    <span className={cls("score-value", dnq && "dnq")} style={scoreStyle(value)}>
      {dnq ? "DNQ" : Math.round(value)}
    </span>
  );
}

function skillAggregateOff(player: PlayerImpact): number {
  const off = Number(player.skill_model_off ?? player.skill_off_total);
  return Number.isFinite(off) ? off : Number(player.offense ?? 0);
}

function skillAggregateDef(player: PlayerImpact): number {
  const def = Number(player.skill_model_def ?? player.skill_def_total);
  return Number.isFinite(def) ? def : Number(player.defense ?? 0);
}

function skillAggregateTotal(player: PlayerImpact): number {
  const off = skillAggregateOff(player);
  const def = skillAggregateDef(player);
  if (Number.isFinite(off) && Number.isFinite(def)) return off + def;
  return Number(player.total ?? 0);
}

function playerSkillAggregates(player: PlayerImpact): SkillLedgerAggregate[] {
  const off = skillAggregateOff(player);
  const def = skillAggregateDef(player);
  return [
    { key: "skill_total", label: "Total", title: "Skill model Total", value: off + def, sortKey: "skill_total" },
    { key: "skill_off", label: "Off", title: "Skill model Off", value: off, sortKey: "skill_off" },
    { key: "skill_def", label: "Def", title: "Skill model Def", value: def, sortKey: "skill_def" }
  ];
}

type SkillLedgerSortKey = SortKey | DraftSortKey;

type SkillLedgerAggregate<TKey extends SkillLedgerSortKey = SkillLedgerSortKey> = {
  key: string;
  label: string;
  title: string;
  value: number;
  sortKey: TKey;
};

type SkillLedgerSkill<TKey extends SkillLedgerSortKey = SkillLedgerSortKey> = {
  key: SkillKey;
  label: string;
  title: string;
  value: number;
  sortKey: TKey;
};

function SkillLedger<TKey extends SkillLedgerSortKey>({
  aggregates,
  skills,
  activeKey,
  onSort
}: {
  aggregates: SkillLedgerAggregate<TKey>[];
  skills: SkillLedgerSkill<TKey>[];
  activeKey: string | null;
  onSort: (key: TKey) => void;
}) {
  const offSkills = skills.filter((skill) => ["FTD", "OREB", "PASS", "RIM", "SHOOT"].includes(skill.key));
  const defSkills = skills.filter((skill) => ["DPM", "DREB", "RIMPRO", "SWITCH"].includes(skill.key));
  const findAggregate = (match: string) => aggregates.find((item) => String(item.sortKey).toLowerCase().includes(match));
  const offAggregate = findAggregate("off");
  const defAggregate = findAggregate("def");
  const totalAggregate = findAggregate("total");
  const renderAggregate = (item: SkillLedgerAggregate<TKey>, variant?: "total") => (
    <button
      key={item.key}
      type="button"
      className={cls("skill-aggregate-pill", variant === "total" && "total", activeKey === item.sortKey && "active")}
      onClick={(event) => {
        event.stopPropagation();
        onSort(item.sortKey);
      }}
      title={`${item.title}: ${formatSigned(item.value, 1)}`}
      style={skillStyle(item.value)}
    >
      <span>{item.label}</span>
      <strong>{formatSigned(item.value, 1)}</strong>
    </button>
  );
  const renderSkill = (skill: SkillLedgerSkill<TKey>) => (
    <button
      key={skill.key}
      type="button"
      className={cls("skill-chip", activeKey === skill.sortKey && "active")}
      onClick={(event) => {
        event.stopPropagation();
        onSort(skill.sortKey);
      }}
      title={`${skill.title}: ${formatSigned(skill.value, 1)}`}
      style={skillStyle(skill.value)}
    >
      <span>{skill.label}</span>
      <strong>{formatSigned(skill.value, 1)}</strong>
    </button>
  );

  return (
    <div className="skill-ledger">
      <div className="skill-ledger-groups" aria-label="Skill dimensions">
        <div className="skill-ledger-section offense">
          {offAggregate && renderAggregate(offAggregate)}
          <div className="skill-chip-group offense">{offSkills.map(renderSkill)}</div>
        </div>
        <div className="skill-ledger-section defense">
          {defAggregate && renderAggregate(defAggregate)}
          <div className="skill-chip-group defense">{defSkills.map(renderSkill)}</div>
        </div>
        {totalAggregate && (
          <div className="skill-total-rail">
            {renderAggregate(totalAggregate, "total")}
          </div>
        )}
      </div>
    </div>
  );
}

function getProspectSkillValue(prospect: DraftProspect, key: SkillKey): number {
  const value = prospect[`${key}_pred` as keyof DraftProspect];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scoreStyle(value: number): CSSProperties {
  const score = clamp(value, 0, 100);
  const shifted = (score - 50) / 50 * 2.4;
  const heat = heatStyleVars("score", shifted, 2.4) as CSSProperties & { "--score-fg": string; "--score-border": string };
  const color = heat["--score-fg"];
  return {
    "--score-fill": color,
    "--score-border": heat["--score-border"]
  } as CSSProperties;
}

function scaleStyle(value: number): CSSProperties {
  const neutral: Rgb = [245, 247, 245];
  const negative: Rgb = [232, 56, 42];
  const positive: Rgb = [126, 216, 82];
  const elite: Rgb = [43, 198, 162];
  const scale = Number.isFinite(value) ? value : 0.8;
  let color: Rgb;
  let intensity: number;

  if (scale >= 0.8) {
    const raw = clamp((scale - 0.8) / 0.7, 0, 1);
    intensity = Math.pow(raw, 0.82);
    color = intensity < 0.82
      ? mixRgb(neutral, positive, intensity / 0.82)
      : mixRgb(positive, elite, (intensity - 0.82) / 0.18);
  } else {
    intensity = Math.pow(clamp((0.8 - scale) / 0.8, 0, 1), 0.72);
    color = mixRgb(neutral, negative, intensity);
  }

  return {
    "--scale-fg": rgbString(color),
    "--scale-bg": rgbaString(color, 0.025 + intensity * 0.2),
    "--scale-border": rgbaString(color, 0.055 + intensity * 0.42)
  } as CSSProperties;
}

function rateStyle(value: number): CSSProperties {
  return heatStyleVars("rate", value, 2.4);
}

function deltaStyle(value: number): CSSProperties {
  return heatStyleVars("rate", value, 22);
}

function netMoneyStyle(value: number | null | undefined): CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) return {};
  return heatStyleVars("rate", value, 35_000_000);
}

function tierAccentStyle(tier: string): CSSProperties {
  const normalized = tier.toLowerCase();
  if (normalized.includes("franchise")) return { "--tc": "var(--green)" } as CSSProperties;
  if (normalized.includes("star") && normalized.includes("+")) return { "--tc": "var(--teal)" } as CSSProperties;
  if (normalized.includes("star")) return { "--tc": "var(--gold)" } as CSSProperties;
  return { "--tc": "var(--muted)" } as CSSProperties;
}

function rowAccentStyle(player: PlayerImpact): CSSProperties {
  if (player.score_label === "DNQ") return { "--tc": "color-mix(in srgb, var(--muted) 45%, var(--bg))" } as CSSProperties;
  const scoreVars = scoreStyle(player.score) as CSSProperties & { "--score-fill"?: string };
  const tierVars = tierAccentStyle(player.tier) as CSSProperties & { "--tc"?: string };
  return { "--tc": scoreVars["--score-fill"] ?? tierVars["--tc"] ?? "var(--muted)" } as CSSProperties;
}

function draftRowAccentStyle(prospect: DraftProspect): CSSProperties {
  const scoreVars = scoreStyle(prospect.score) as CSSProperties & { "--score-fill"?: string };
  return { "--tc": scoreVars["--score-fill"] ?? "var(--muted)" } as CSSProperties;
}

function skillStyle(value: number): CSSProperties {
  const rateVars = rateStyle(value) as CSSProperties & { "--rate-fg": string };
  return {
    "--skill-fill": rateVars["--rate-fg"]
  } as CSSProperties;
}

function heatStyleVars(prefix: "rate" | "scale" | "score", value: number, max: number): CSSProperties {
  const neutral: Rgb = [245, 247, 245];
  const negative: Rgb = [232, 56, 42];
  const positive: Rgb = [126, 216, 82];
  const elite: Rgb = [43, 198, 162];
  const rawIntensity = clamp(Math.abs(value) / Math.max(0.001, max), 0, 1);
  const positiveIntensity = Math.pow(rawIntensity, 0.98);
  const negativeIntensity = Math.pow(rawIntensity, 0.68);
  const intensity = value >= 0 ? positiveIntensity : negativeIntensity;
  const positiveColor = intensity < 0.86 ? mixRgb(neutral, positive, intensity / 0.86) : mixRgb(positive, elite, (intensity - 0.86) / 0.14);
  const color = value >= 0 ? positiveColor : mixRgb(neutral, negative, intensity);
  const bgAlpha = 0.025 + intensity * 0.2;
  const borderAlpha = 0.055 + intensity * 0.42;

  return {
    [`--${prefix}-fg`]: rgbString(color),
    [`--${prefix}-bg`]: rgbaString(color, bgAlpha),
    [`--${prefix}-border`]: rgbaString(color, borderAlpha)
  } as CSSProperties;
}

type Rgb = [number, number, number];

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount)
  ];
}

function rgbString(color: Rgb): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function rgbaString(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
}

function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const formatted = formatNumber(value, digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatSeasonValueAdd(player: PlayerImpact): string {
  if (player.availability_status === "DNQ") return "DNQ";
  return formatSignedMoney(currentValueAdd(player));
}

function formatContractValue(player: PlayerImpact): string {
  if (isOpenMarketContractStatus(player)) return "-";
  const salary = formatMoney(player.contract);
  if (salary !== "-") return salary;
  const status = player.contract_status?.trim();
  if (status === "Team Option") return "Team Opt";
  if (status === "Player Option") return "Player Opt";
  return status || "-";
}

function isOpenMarketContractStatus(player: PlayerImpact): boolean {
  const status = faStatusLabel(player);
  return status === "UFA" || status === "RFA" || status === "Rookie";
}

function currentValueAdd(player: PlayerImpact): number | null {
  if (isOpenMarketContractStatus(player)) return null;
  return impactNumber(player, "value_add");
}

function currentScale(player: PlayerImpact): number {
  if (isOpenMarketContractStatus(player)) return 0.8;
  return impactNumber(player, "scalability") ?? 0;
}

function impactNumber(player: PlayerImpact, key: keyof PlayerImpact): number | null {
  const value = player[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function futureValue4y(player: PlayerImpact): number | null {
  const values = [
    impactNumber(player, "value"),
    ...[1, 2, 3].map((index) => impactNumber(player, `projection_value_y${index}` as keyof PlayerImpact))
  ]
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function futureScale4y(player: PlayerImpact): number | null {
  const scales = [
    currentScale(player),
    ...[1, 2, 3].map((index) => impactNumber(player, `projection_scalability_y${index}` as keyof PlayerImpact))
  ]
    .filter((value): value is number => value !== null);
  return scales.length > 0 ? scales.reduce((sum, value) => sum + value, 0) / scales.length : null;
}

function playerTradeScale(player: PlayerImpact): number {
  return futureScale4y(player) ?? currentScale(player) ?? 1;
}

function projectedValueAdd(player: PlayerImpact, seasonIndex: number): number | null {
  const value = impactNumber(player, `projection_value_y${seasonIndex}` as keyof PlayerImpact);
  const contract = impactNumber(player, `projection_effective_contract_y${seasonIndex}` as keyof PlayerImpact)
    ?? impactNumber(player, `projection_contract_y${seasonIndex}` as keyof PlayerImpact);
  return value !== null && contract !== null ? value - contract : null;
}

function buildCareerTrajectory(player: PlayerImpact, allPlayers: PlayerImpact[], careerHistory: PlayerCareerHistoryRow[] = []): CareerChartPoint[] {
  const historyRows = careerHistory.length > 0 ? careerHistory : allPlayers;
  const actual = historyRows
    .filter((row) => row.nba_id === player.nba_id && row.year <= player.year && Number.isFinite(row.total))
    .sort((a, b) => a.year - b.year)
    .reduce<Array<PlayerImpact | PlayerCareerHistoryRow>>((rows, row) => {
      const existingIndex = rows.findIndex((item) => item.year === row.year);
      const resolvedRow = row.year === player.year ? player : row;
      if (existingIndex >= 0) {
        const current = rows[existingIndex];
        rows[existingIndex] = resolvedRow.year === player.year || Number(resolvedRow.Minutes ?? 0) >= Number(current.Minutes ?? 0) ? resolvedRow : current;
      }
      else rows.push(resolvedRow);
      return rows;
    }, [])
    .map((row) => ({
      label: String(row.year),
      year: row.year,
      value: row.total,
      valueAdd: row.value_add ?? null,
      kind: "actual" as const,
      isCurrent: row.year === player.year
    }));

  const projections = [1, 2, 3, 4, 5]
    .map((seasonIndex): CareerChartPoint | null => {
      const value = impactNumber(player, `projection_y${seasonIndex}` as keyof PlayerImpact);
      if (value === null) return null;
      const year = player.year + seasonIndex;
      return {
        label: String(year),
        year,
        value,
        valueAdd: projectedValueAdd(player, seasonIndex),
        kind: "projection" as const
      };
    })
    .filter((point): point is CareerChartPoint => point !== null);

  return [...actual, ...projections];
}

function chartPointTitle(point: CareerChartPoint): string {
  const label = point.kind === "projection" ? "Projected" : point.isCurrent ? "Current season" : "Actual";
  const valueAdd = point.valueAdd !== null && point.valueAdd !== undefined && Number.isFinite(point.valueAdd)
    ? `\nSzn VA: ${formatSignedMoney(point.valueAdd)}`
    : "";
  return `${point.year} ${label}\nTotal impact: ${formatSigned(point.value, 2)}${valueAdd}`;
}

function valueAddBarTitle(point: CareerChartPoint): string {
  const label = point.kind === "projection" ? "Projected" : point.isCurrent ? "Current season" : "Actual";
  return `${point.year} ${label}\nSzn VA: ${formatSignedMoney(point.valueAdd)}\nTotal impact: ${formatSigned(point.value, 2)}`;
}

function SkillRow({ label, value }: { label: string; value: number }) {
  const shifted = clamp((value + 3) / 6 * 100, 0, 100);
  return (
    <div className="skill-row" style={skillStyle(value)}>
      <span>{label}</span>
      <div>
        <i style={{ width: `${shifted}%` }} />
      </div>
      <strong>{gradeFromValue(value)}</strong>
    </div>
  );
}

function gradeFromValue(value: number): string {
  if (value >= 2.4) return "A+";
  if (value >= 1.8) return "A";
  if (value >= 1.2) return "A-";
  if (value >= 0.8) return "B+";
  if (value >= 0.4) return "B";
  if (value >= 0.0) return "B-";
  if (value >= -0.4) return "C+";
  if (value >= -0.8) return "C";
  if (value >= -1.2) return "C-";
  if (value >= -1.8) return "D";
  return "F";
}

function ProjectionChart({ points, currentYear }: { points: CareerChartPoint[]; currentYear: number }) {
  const values = points.map((point) => point.value);
  if (values.length === 0) {
    return <div className="projection-empty">No career rows available</div>;
  }
  const valueAdds = points
    .map((point) => point.valueAdd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rangePad = Math.max(0.75, (rawMax - rawMin) * 0.18);
  const min = Math.min(rawMin - rangePad, 0);
  const max = Math.max(rawMax + rangePad, 2);
  const width = 560;
  const height = 236;
  const padLeft = 42;
  const padRight = 22;
  const padTop = 24;
  const padBottom = 40;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const yFor = (value: number) => height - padBottom - ((value - min) / Math.max(1, max - min)) * plotHeight;
  const coords = points.map((point, index) => {
    const x = padLeft + index * (plotWidth / Math.max(1, points.length - 1));
    const y = yFor(point.value);
    return { ...point, x, y };
  });
  const actualCoords = coords.filter((point) => point.kind === "actual");
  const projectionCoords = coords.filter((point) => point.kind === "projection");
  const bridgeCoords = projectionCoords.length > 0 && actualCoords.length > 0 ? [actualCoords[actualCoords.length - 1], ...projectionCoords] : projectionCoords;
  const pathFor = (items: typeof coords) => items.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const actualPath = pathFor(actualCoords);
  const projectionPath = pathFor(bridgeCoords);
  const baselineY = yFor(0);
  const yTicks = [max, (max + min) / 2, min];
  const labelPoints = coords.filter((point, index) => {
    const actualPeak = point.kind === "actual" && point.value === Math.max(...actualCoords.map((item) => item.value));
    return point.isCurrent || actualPeak || index === 0 || point.kind === "projection" && index === coords.length - 1;
  });
  const maxAbsValueAdd = Math.max(...valueAdds.map((value) => Math.abs(value)), 1);

  return (
    <div className="projection-card">
      <svg className="projection" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${points[0]?.label ?? ""} through ${points[points.length - 1]?.label ?? ""} impact trajectory`}>
        <defs>
          <linearGradient id={`projectionFill-${currentYear}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--detail-score, var(--score-fill, var(--green)))" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--detail-score, var(--score-fill, var(--green)))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect className="projection-plot-bg" x={padLeft} y={padTop} width={plotWidth} height={plotHeight} rx="4" />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick.toFixed(2)} className="projection-gridline">
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} />
              <text x={padLeft - 10} y={y + 4} textAnchor="end">{formatSigned(tick, 1)}</text>
            </g>
          );
        })}
        {min <= 0 && max > 0 && <line className="projection-zero" x1={padLeft} x2={width - padRight} y1={baselineY} y2={baselineY} />}
        {coords.map((point) => {
          if (point.valueAdd === null || point.valueAdd === undefined || !Number.isFinite(point.valueAdd)) return null;
          const barMaxHeight = 48;
          const barHeight = Math.max(3, Math.abs(point.valueAdd) / maxAbsValueAdd * barMaxHeight);
          const barY = point.valueAdd >= 0 ? baselineY - barHeight : baselineY;
          return (
            <g key={`${point.label}-va`}>
              <title>{valueAddBarTitle(point)}</title>
              <rect
                className={cls("projection-va-bar", point.valueAdd < 0 && "negative", point.kind === "projection" && "projected")}
                x={point.x - 5}
                y={barY}
                width="10"
                height={barHeight}
                rx="3"
              />
              <rect
                className="projection-bar-hit-target"
                x={point.x - 8}
                y={Math.min(barY, baselineY) - 3}
                width="16"
                height={barHeight + 6}
                rx="5"
              />
            </g>
          );
        })}
        {actualCoords.length > 1 && (
          <path
            className="projection-area"
            d={`${actualPath} L ${actualCoords[actualCoords.length - 1].x} ${baselineY} L ${actualCoords[0].x} ${baselineY} Z`}
            fill={`url(#projectionFill-${currentYear})`}
          />
        )}
        {actualPath && <path className="projection-line actual-line" d={actualPath} />}
        {projectionPath && <path className="projection-line projection-line-dashed" d={projectionPath} />}
        {coords.map((point) => (
          <g key={`${point.kind}-${point.label}`} className={cls("projection-point", point.kind === "projection" ? "projected" : "actual", point.isCurrent && "current")}>
            <title>{chartPointTitle(point)}</title>
            {point.isCurrent && <line className="projection-current-line" x1={point.x} x2={point.x} y1={padTop} y2={height - padBottom} />}
            <circle cx={point.x} cy={point.y} r={point.isCurrent ? 5 : 3.5} />
            <circle className="projection-hit-target" cx={point.x} cy={point.y} r="11" />
          </g>
        ))}
        {labelPoints.map((point, index) => {
          const labelY = clamp(point.y + (index % 2 === 0 ? -28 : 12), 4, height - padBottom - 22);
          return (
            <g key={`${point.label}-value-label`} className="projection-value-label">
              <rect x={point.x - 22} y={labelY} width="44" height="17" rx="4" />
              <text x={point.x} y={labelY + 12} textAnchor="middle">{formatSigned(point.value, 1)}</text>
            </g>
          );
        })}
        {coords.map((point, index) => {
          const shouldLabel = points.length <= 12 || point.isCurrent || point.kind === "projection" || index === 0 || index === coords.length - 1 || index % 2 === 0;
          return shouldLabel ? (
            <text key={`${point.label}-axis`} className={cls("projection-x-label", point.kind === "projection" && "projected")} x={point.x} y={height - 13} textAnchor="middle">
              {point.label}
            </text>
          ) : null;
        })}
      </svg>
      <div className="projection-legend">
        <span><i className="legend-line actual" /> Actual</span>
        <span><i className="legend-line projected" /> Projection</span>
        <span><i className="legend-bar" /> Szn VA</span>
      </div>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone?: "green" | "teal" | "gold" | "red" }) {
  return (
    <div className={cls("metric-pill", tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildTradeMachineResult(
  data: AppData,
  season: number,
  players: PlayerImpact[],
  sides: TradeSideState[],
  contractMap: Map<string, CapTrackerContractRow>,
  calendar: TradeCalendarState
): TradeMachineResult | null {
  const capSeason = capTrackerSeasonForYear(data.capTracker, season);
  if (!capSeason) return null;
  if (sides.length < 2) return null;
  const machineSides = sides.map<TradeMachineSide>((side) => {
    const context = tradeTeamContextFromCapTracker(data.capTracker, side.team, season, tradeRoster(players, side.team).length)
      ?? fallbackTradeMachineContext(side.team, season, players);
    return {
      team: context,
      sends: tradeMachineAssets(side.assets, side.team, season, contractMap)
    };
  });
  return evaluateTradeMachine({
    season: capSeason,
    tradeDate: blankToNull(calendar.tradeDate),
    tradeDeadlineDate: blankToNull(calendar.tradeDeadlineDate),
    regularSeasonEndDate: blankToNull(calendar.regularSeasonEndDate),
    sides: machineSides as TradeMachineSides
  });
}

function currentSavedTradeSnapshot(
  verdict: TradeVerdict,
  result: TradeMachineResult | null | undefined,
  valueDiff: number,
  scaleDiff: number,
  note: string
): SavedTradeScenarioSnapshot {
  return {
    verdict,
    cbaStatus: result?.status ?? null,
    valueDiff,
    scaleDiff,
    note,
    evaluatedAt: new Date().toISOString()
  };
}

function evaluateSavedTradeScenarioSnapshot(
  data: AppData,
  season: number,
  players: PlayerImpact[],
  sides: TradeSideState[],
  contractMap: Map<string, CapTrackerContractRow>,
  calendar: TradeCalendarState,
  teamMeta: Map<string, TeamProjection>,
  evaluatedAt: string
): SavedTradeScenarioSnapshot {
  const result = buildTradeMachineResult(data, season, players, sides, contractMap, calendar);
  const isMultiTeam = sides.length > 2;
  const valueBalance = !isMultiTeam ? result?.valueBalance : undefined;
  const teamValueBalances = isMultiTeam ? result?.teamValueBalances : undefined;
  const leftBalance = tradeMachineTeamValueBalance(result, sides[0]?.team ?? "");
  const rightBalance = tradeMachineTeamValueBalance(result, sides[1]?.team ?? "");
  const leftTotal = valueBalance?.leftOutgoingValue ?? leftBalance?.outgoingValue ?? assetTotal(sides[0]?.assets ?? []);
  const rightTotal = valueBalance?.rightOutgoingValue ?? rightBalance?.outgoingValue ?? assetTotal(sides[1]?.assets ?? []);
  const leftScaleTotal = valueBalance?.leftOutgoingScaleAdjustedValue ?? leftBalance?.outgoingScaleAdjustedValue ?? scaleAdjustedAssetTotal(sides[0]?.assets ?? []);
  const rightScaleTotal = valueBalance?.rightOutgoingScaleAdjustedValue ?? rightBalance?.outgoingScaleAdjustedValue ?? scaleAdjustedAssetTotal(sides[1]?.assets ?? []);
  const multiValueDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.valueDeficit) ?? []));
  const multiScaleDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.scaleAdjustedDeficit) ?? []));
  const multiBalanceDeficit = Math.max(0, ...(teamValueBalances?.map((balance) => balance.balanceDeficit) ?? []));
  const valueDiff = isMultiTeam ? multiValueDeficit : valueBalance?.valueDiff ?? Math.abs(leftTotal - rightTotal);
  const scaleDiff = isMultiTeam ? multiScaleDeficit : valueBalance?.scaleAdjustedDiff ?? Math.abs(leftScaleTotal - rightScaleTotal);
  const balanceDiff = isMultiTeam ? multiBalanceDeficit : valueBalance?.balanceDiff ?? Math.max(valueDiff, scaleDiff);
  const verdict = result && !result.legal
    ? "Declined"
    : isMultiTeam
      ? tradeMachineMultiTeamVerdictLabel(result) ?? tradeVerdict(balanceDiff)
      : tradeMachineValueVerdictLabel(valueBalance?.verdict) ?? tradeVerdict(balanceDiff);
  const note = result && !result.legal
    ? tradeMachineSaysNoLabel(result)
    : isMultiTeam
      ? tradeMachineMultiTeamSaysNoLabel(result, teamMeta) ?? "No model blockers"
      : tradeMachineValueSaysNoLabel(valueBalance) ?? whoSaysNoLabel(sides[0], sides[1], balanceDiff);
  return {
    verdict,
    cbaStatus: result?.status ?? null,
    valueDiff,
    scaleDiff,
    note,
    evaluatedAt
  };
}

const TRADE_SUGGESTION_LIMIT = 12;
const TRADE_SUGGESTION_ROSTER_LIMIT = 18;
const TRADE_RECOMMENDATION_LIMIT = 36;
const TRADE_RECOMMENDATION_PER_OPPONENT = 5;
const TRADE_RECOMMENDATION_ROSTER_LIMIT = 12;
const TRADE_TARGET_PACKAGE_ANCHOR_LIMIT = 8;
const TRADE_TARGET_PACKAGE_PER_TARGET = 4;
const TRADE_TARGET_PACKAGE_MIN_VALUE_GAP = 4_000_000;

export function buildTradeSuggestions({
  data,
  season,
  players,
  leftTeam,
  rightTeam,
  teamOptions,
  pickContext,
  contractMap,
  calendar,
  options
}: {
  data: AppData;
  season: number;
  players: PlayerImpact[];
  leftTeam: string;
  rightTeam: string;
  teamOptions: TeamProjection[];
  pickContext: TradePickContext;
  contractMap: Map<string, CapTrackerContractRow>;
  calendar: TradeCalendarState;
  options?: TradeSuggestionBuildOptions;
}): TradeSuggestion[] {
  if (!leftTeam || !rightTeam || cleanTeamValue(leftTeam) === cleanTeamValue(rightTeam)) return [];
  const limit = options?.limit ?? TRADE_SUGGESTION_LIMIT;
  const rosterLimit = options?.rosterLimit ?? TRADE_SUGGESTION_ROSTER_LIMIT;
  const includePackages = options?.includePackages ?? true;
  const minScore = options?.minScore ?? 20;
  const leftMeta = tradeSuggestionTeamMeta(teamOptions, leftTeam);
  const rightMeta = tradeSuggestionTeamMeta(teamOptions, rightTeam);
  if (!leftMeta || !rightMeta) return [];

  const leftRoster = tradeSuggestionRoster(players, leftTeam, rosterLimit);
  const rightRoster = tradeSuggestionRoster(players, rightTeam, rosterLimit);
  const candidates: TradeSuggestion[] = [];

  candidates.push(...buildTradeTargetPackageSuggestions({
    data,
    season,
    players,
    leftMeta,
    rightMeta,
    buyerMeta: leftMeta,
    sellerMeta: rightMeta,
    buyerRoster: leftRoster,
    sellerRoster: rightRoster,
    pickContext,
    contractMap,
    calendar
  }));
  candidates.push(...buildTradeTargetPackageSuggestions({
    data,
    season,
    players,
    leftMeta,
    rightMeta,
    buyerMeta: rightMeta,
    sellerMeta: leftMeta,
    buyerRoster: rightRoster,
    sellerRoster: leftRoster,
    pickContext,
    contractMap,
    calendar
  }));

  leftRoster.forEach((leftPlayer) => {
    rightRoster.forEach((rightPlayer) => {
      const baseLeftAssets = [suggestionPlayerAsset(leftPlayer, rightTeam)];
      const baseRightAssets = [suggestionPlayerAsset(rightPlayer, leftTeam)];
      const base = evaluateTradeSuggestion(data, season, players, leftMeta, rightMeta, baseLeftAssets, baseRightAssets, contractMap, calendar);
      if (base) candidates.push(base);

      const leftValue = scaleAdjustedAssetTotal(baseLeftAssets);
      const rightValue = scaleAdjustedAssetTotal(baseRightAssets);
      const gap = Math.abs(leftValue - rightValue);
      if (!includePackages || gap < 8_000_000) return;
      const payerTeam = leftValue < rightValue ? leftTeam : rightTeam;
      const receiverTeam = leftValue < rightValue ? rightTeam : leftTeam;
      const makeweight = tradeSuggestionPickForGap(data.picks, payerTeam, receiverTeam, gap, pickContext, season, teamOptions);
      if (makeweight) {
        const leftAssets = payerTeam === leftTeam ? [...baseLeftAssets, makeweight] : baseLeftAssets;
        const rightAssets = payerTeam === rightTeam ? [...baseRightAssets, makeweight] : baseRightAssets;
        const withPick = evaluateTradeSuggestion(data, season, players, leftMeta, rightMeta, leftAssets, rightAssets, contractMap, calendar);
        if (withPick) candidates.push(withPick);
      }

      const payerRoster = payerTeam === leftTeam ? leftRoster : rightRoster;
      const playerMakeweight = tradeSuggestionPlayerForGap(
        payerRoster,
        receiverTeam,
        gap,
        new Set([leftPlayer.nba_id, rightPlayer.nba_id])
      );
      if (playerMakeweight) {
        const leftAssets = payerTeam === leftTeam ? [...baseLeftAssets, playerMakeweight] : baseLeftAssets;
        const rightAssets = payerTeam === rightTeam ? [...baseRightAssets, playerMakeweight] : baseRightAssets;
        const withPlayer = evaluateTradeSuggestion(data, season, players, leftMeta, rightMeta, leftAssets, rightAssets, contractMap, calendar);
        if (withPlayer) candidates.push(withPlayer);
      }
    });
  });

  const deduped = new Map<string, TradeSuggestion>();
  candidates
    .filter((suggestion) => suggestion.score >= minScore)
    .filter((suggestion) => suggestion.verdict !== "Declined" || Math.max(suggestion.valueDiff, suggestion.scaleDiff) <= TRADE_MAYBE_DIFF)
    .forEach((suggestion) => {
      const existing = deduped.get(suggestion.id);
      if (!existing || suggestion.score > existing.score) deduped.set(suggestion.id, suggestion);
    });
  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function evaluateTradeSuggestion(
  data: AppData,
  season: number,
  players: PlayerImpact[],
  leftMeta: TeamProjection,
  rightMeta: TeamProjection,
  leftAssets: TradeAsset[],
  rightAssets: TradeAsset[],
  contractMap: Map<string, CapTrackerContractRow>,
  calendar: TradeCalendarState
): TradeSuggestion | null {
  const sides: TradeSideState[] = [
    { team: leftMeta.team, assets: leftAssets },
    { team: rightMeta.team, assets: rightAssets }
  ];
  const result = buildTradeMachineResult(data, season, players, sides, contractMap, calendar);
  if (!result || result.status === "illegal") return null;
  const leftBalance = tradeMachineTeamValueBalance(result, leftMeta.team);
  const rightBalance = tradeMachineTeamValueBalance(result, rightMeta.team);
  const valueDiff = result.valueBalance?.valueDiff ?? Math.abs(assetTotal(leftAssets) - assetTotal(rightAssets));
  const scaleDiff = result.valueBalance?.scaleAdjustedDiff ?? Math.abs(scaleAdjustedAssetTotal(leftAssets) - scaleAdjustedAssetTotal(rightAssets));
  const balanceDiff = result.valueBalance?.balanceDiff ?? Math.max(valueDiff, scaleDiff);
  const verdict = tradeMachineValueVerdictLabel(result.valueBalance?.verdict) ?? tradeVerdict(balanceDiff);
  if (verdict === "Declined" && balanceDiff > TRADE_MAYBE_DIFF) return null;

  const leftFit = tradeSuggestionFitLift(rightAssets, leftAssets, leftMeta);
  const rightFit = tradeSuggestionFitLift(leftAssets, rightAssets, rightMeta);
  const fitLift = leftFit + rightFit;
  const timelineFit = tradeSuggestionTimelineLift(rightAssets, leftAssets, leftMeta) + tradeSuggestionTimelineLift(leftAssets, rightAssets, rightMeta);
  const cbaBonus = result.status === "legal" ? 8 : 2;
  const verdictBonus = verdict === "Accepted" ? 14 : verdict === "Maybe" ? 5 : -8;
  const score = roundTo(
    50
      + cbaBonus
      + verdictBonus
      + fitLift * 5.5
      + timelineFit * 4.5
      + tradeSuggestionPackageIntentBonus(leftAssets, rightAssets)
      - Math.max(valueDiff, scaleDiff) / 1_000_000 * 1.15
      - tradeSuggestionStarPenalty(leftAssets, rightAssets),
    1
  );
  if (score < 20) return null;

  return {
    id: tradeSuggestionId(leftMeta.team, rightMeta.team, leftAssets, rightAssets),
    title: `${assetShortLabel(leftAssets)} for ${assetShortLabel(rightAssets)}`,
    left: { team: leftMeta.team, assets: leftAssets },
    right: { team: rightMeta.team, assets: rightAssets },
    score,
    verdict,
    cbaStatus: result.status,
    valueDiff,
    scaleDiff,
    fitLift: roundTo(fitLift, 1),
    timelineFit: roundTo(timelineFit, 1),
    reasons: tradeSuggestionReasons(result.status, verdict, leftMeta, rightMeta, leftAssets, rightAssets, leftFit, rightFit, timelineFit, leftBalance, rightBalance)
  };
}

function buildTradeTargetPackageSuggestions({
  data,
  season,
  players,
  leftMeta,
  rightMeta,
  buyerMeta,
  sellerMeta,
  buyerRoster,
  sellerRoster,
  pickContext,
  contractMap,
  calendar
}: {
  data: AppData;
  season: number;
  players: PlayerImpact[];
  leftMeta: TeamProjection;
  rightMeta: TeamProjection;
  buyerMeta: TeamProjection;
  sellerMeta: TeamProjection;
  buyerRoster: PlayerImpact[];
  sellerRoster: PlayerImpact[];
  pickContext: TradePickContext;
  contractMap: Map<string, CapTrackerContractRow>;
  calendar: TradeCalendarState;
}): TradeSuggestion[] {
  const buyerIsLeft = cleanTeamValue(buyerMeta.team) === cleanTeamValue(leftMeta.team);
  const candidates: TradeSuggestion[] = [];
  sellerRoster.forEach((targetPlayer) => {
    const targetAsset = suggestionPlayerAsset(targetPlayer, buyerMeta.team);
    const offerPackages = tradeSuggestionTargetOfferPackages({
      targetPlayer,
      buyerRoster,
      buyerTeam: buyerMeta.team,
      sellerTeam: sellerMeta.team,
      picks: data.picks,
      pickContext,
      season,
      teamOptions: [leftMeta, rightMeta]
    });
    offerPackages.forEach((offerAssets) => {
      const leftAssets = buyerIsLeft ? offerAssets : [targetAsset];
      const rightAssets = buyerIsLeft ? [targetAsset] : offerAssets;
      const suggestion = evaluateTradeSuggestion(data, season, players, leftMeta, rightMeta, leftAssets, rightAssets, contractMap, calendar);
      if (suggestion) candidates.push(suggestion);
    });
  });
  return candidates;
}

function buildTeamTradeRecommendations({
  data,
  season,
  players,
  focusTeam,
  teamOptions,
  pickContext,
  contractMap,
  calendar
}: {
  data: AppData;
  season: number;
  players: PlayerImpact[];
  focusTeam: string;
  teamOptions: TeamProjection[];
  pickContext: TradePickContext;
  contractMap: Map<string, CapTrackerContractRow>;
  calendar: TradeCalendarState;
}): TradeRecommendation[] {
  const focusMeta = tradeSuggestionTeamMeta(teamOptions, focusTeam);
  if (!focusMeta) return [];
  const recommendations = teamOptions
    .filter((team) => cleanTeamValue(team.team) !== cleanTeamValue(focusTeam))
    .flatMap((opponent) => buildTradeSuggestions({
      data,
      season,
      players,
      leftTeam: focusTeam,
      rightTeam: opponent.team,
      teamOptions,
      pickContext,
      contractMap,
      calendar,
      options: {
        limit: TRADE_RECOMMENDATION_PER_OPPONENT,
        rosterLimit: TRADE_RECOMMENDATION_ROSTER_LIMIT,
        includePackages: true,
        minScore: 24
      }
    }).map((suggestion) => tradeSuggestionToRecommendation(suggestion, focusMeta, opponent)).filter((item): item is TradeRecommendation => Boolean(item)));

  const deduped = new Map<string, TradeRecommendation>();
  recommendations.forEach((recommendation) => {
    const existing = deduped.get(recommendation.id);
    if (!existing || recommendation.mutualScore > existing.mutualScore) deduped.set(recommendation.id, recommendation);
  });
  return Array.from(deduped.values())
    .sort((a, b) => b.mutualScore - a.mutualScore || b.focusInterest + b.opponentInterest - (a.focusInterest + a.opponentInterest))
    .slice(0, TRADE_RECOMMENDATION_LIMIT);
}

function tradeSuggestionToRecommendation(suggestion: TradeSuggestion, focusMeta: TeamProjection, opponentMeta: TeamProjection): TradeRecommendation | null {
  const focusIsLeft = cleanTeamValue(suggestion.left.team) === cleanTeamValue(focusMeta.team);
  const focusSends = focusIsLeft ? suggestion.left.assets : suggestion.right.assets;
  const focusReceives = focusIsLeft ? suggestion.right.assets : suggestion.left.assets;
  const opponentSends = focusIsLeft ? suggestion.right.assets : suggestion.left.assets;
  const opponentReceives = focusIsLeft ? suggestion.left.assets : suggestion.right.assets;
  const focusInterest = tradeRecommendationInterest(focusMeta, focusReceives, focusSends, suggestion);
  const opponentInterest = tradeRecommendationInterest(opponentMeta, opponentReceives, opponentSends, suggestion);
  const netImpact = subtractTradeImpact(tradeImpactSummary(focusReceives), tradeImpactSummary(focusSends)).total;
  const mutualScore = roundTo(
    suggestion.score * 0.48
      + Math.min(focusInterest, opponentInterest) * 0.34
      + ((focusInterest + opponentInterest) / 2) * 0.18,
    1
  );
  return {
    ...suggestion,
    focusTeam: focusMeta.team,
    opponentTeam: opponentMeta.team,
    focusSends,
    focusReceives,
    opponentSends,
    opponentReceives,
    focusInterest,
    opponentInterest,
    mutualScore,
    netImpact: roundTo(netImpact, 2),
    packageType: tradeRecommendationPackageType(suggestion.left.assets, suggestion.right.assets)
  };
}

function tradeRecommendationInterest(team: TeamProjection, incoming: TradeAsset[], outgoing: TradeAsset[], suggestion: TradeSuggestion): number {
  const fit = tradeSuggestionFitLift(incoming, outgoing, team);
  const timeline = tradeSuggestionTimelineLift(incoming, outgoing, team);
  const netImpact = subtractTradeImpact(tradeImpactSummary(incoming), tradeImpactSummary(outgoing)).total;
  const valuePenalty = Math.max(suggestion.valueDiff, suggestion.scaleDiff) / 1_000_000 * 0.42;
  const verdictBase = suggestion.verdict === "Accepted" ? 64 : suggestion.verdict === "Maybe" ? 55 : 43;
  const outgoingStarPenalty = tradeSuggestionStarPenalty(outgoing, incoming) * 0.28;
  return roundTo(clamp(verdictBase + fit * 7.2 + timeline * 5.5 + netImpact * 2.6 - valuePenalty - outgoingStarPenalty, 0, 100), 1);
}

function tradeRecommendationPackageType(leftAssets: TradeAsset[], rightAssets: TradeAsset[]): string {
  const maxCount = Math.max(leftAssets.length, rightAssets.length);
  const hasPick = [...leftAssets, ...rightAssets].some((asset) => asset.kind === "pick");
  if (maxCount >= 3) return hasPick ? "multi-asset + picks" : "multi-player";
  if (maxCount === 2) return hasPick ? "player + pick" : "two-player package";
  return "one-for-one";
}

function tradeRecommendationNeedLabels(team: TeamProjection): string[] {
  return skillKeys
    .map((key) => ({ key, value: Number(team[key] ?? 0) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((item) => item.key);
}

function tradeSuggestionRoster(players: PlayerImpact[], team: string, limit = TRADE_SUGGESTION_ROSTER_LIMIT): PlayerImpact[] {
  return tradeRoster(players, team)
    .filter((player) => !isOpenMarketContractStatus(player))
    .filter((player) => tradeSalaryForPlayer(player) > 0 && playerTradeValue(player) > 0)
    .filter((player) => player.availability_status !== "DNQ")
    .slice(0, limit);
}

function tradeSuggestionTeamMeta(teams: TeamProjection[], team: string): TeamProjection | null {
  const clean = cleanTeamValue(team);
  return teams.find((item) => cleanTeamValue(item.team) === clean) ?? null;
}

function suggestionPlayerAsset(player: PlayerImpact, toTeam: string): TradeAsset {
  return { ...playerTradeAsset(player), toTeam };
}

function suggestionPickAsset(pick: PickAsset, toTeam: string): TradeAsset {
  return { ...pickTradeAsset(pick), toTeam };
}

function tradeSuggestionPlayerForGap(roster: PlayerImpact[], toTeam: string, gap: number, excludedIds: Set<number>): TradeAsset | null {
  const target = Math.max(0, gap);
  const player = roster
    .filter((candidate) => !excludedIds.has(candidate.nba_id))
    .map((candidate) => ({ candidate, value: scaleAdjustedAssetValue(suggestionPlayerAsset(candidate, toTeam)) }))
    .filter((item) => item.value >= 2_000_000 && item.value <= target * 1.7)
    .sort((a, b) => Math.abs(a.value - target) - Math.abs(b.value - target) || playerTradeValue(a.candidate) - playerTradeValue(b.candidate))[0]?.candidate;
  return player ? suggestionPlayerAsset(player, toTeam) : null;
}

function tradeSuggestionPickForGap(
  picks: PickAsset[],
  fromTeam: string,
  toTeam: string,
  gap: number,
  pickContext: TradePickContext,
  season: number,
  teamOptions: TeamProjection[]
): TradeAsset | null {
  const actual = tradeTeamPickAssets(picks, fromTeam, season)
    .filter((pick) => pick.round === 2 || pickAssetTradeValue(pick) <= gap * 1.55)
    .sort((a, b) => Math.abs(pickAssetTradeValue(a) - gap) - Math.abs(pickAssetTradeValue(b) - gap))[0];
  if (actual) return suggestionPickAsset(actual, toTeam);
  const builder: TradePickBuilderState = gap >= 24_000_000
    ? { assetType: "first", draftYear: season + 1, protectionCutoff: gap >= 48_000_000 ? 8 : 14 }
    : { assetType: "second", draftYear: season + 1, protectionCutoff: 0 };
  const generic = buildTradePickAsset(builder, pickContext, season, fromTeam, teamOptions);
  return generic ? suggestionPickAsset(generic, toTeam) : null;
}

function tradeSuggestionTargetOfferPackages({
  targetPlayer,
  buyerRoster,
  buyerTeam,
  sellerTeam,
  picks,
  pickContext,
  season,
  teamOptions
}: {
  targetPlayer: PlayerImpact;
  buyerRoster: PlayerImpact[];
  buyerTeam: string;
  sellerTeam: string;
  picks: PickAsset[];
  pickContext: TradePickContext;
  season: number;
  teamOptions: TeamProjection[];
}): TradeAsset[][] {
  const targetAsset = suggestionPlayerAsset(targetPlayer, buyerTeam);
  const targetValue = scaleAdjustedAssetValue(targetAsset);
  const targetSalary = tradeSalaryForPlayer(targetPlayer);
  if (targetValue <= 0 || targetSalary <= 0) return [];

  const anchors = tradeSuggestionPackageAnchors(buyerRoster, targetPlayer, targetValue, targetSalary);
  const packages = new Map<string, TradeAsset[]>();
  anchors.forEach((anchor) => {
    let assets = [suggestionPlayerAsset(anchor, sellerTeam)];
    const excluded = new Set([anchor.nba_id]);
    assets = tradeSuggestionAddSalaryFillers(assets, buyerRoster, sellerTeam, targetSalary, targetValue, excluded);
    assets = tradeSuggestionAddValueMakeweights(assets, buyerRoster, buyerTeam, sellerTeam, targetValue, picks, pickContext, season, teamOptions, excluded);
    if (assets.length < 2) return;
    const packageValue = scaleAdjustedAssetTotal(assets);
    if (packageValue < targetValue - TRADE_MAYBE_DIFF) return;
    if (packageValue > targetValue + Math.max(TRADE_MAYBE_DIFF, targetValue * 0.55)) return;
    packages.set(tradeSuggestionPackageKey(assets), assets);
  });
  return Array.from(packages.values())
    .sort((a, b) =>
      Math.abs(scaleAdjustedAssetTotal(a) - targetValue) - Math.abs(scaleAdjustedAssetTotal(b) - targetValue)
      || tradeSuggestionPackagePickCount(b) - tradeSuggestionPackagePickCount(a)
      || a.length - b.length
    )
    .slice(0, TRADE_TARGET_PACKAGE_PER_TARGET);
}

function tradeSuggestionPackageAnchors(roster: PlayerImpact[], targetPlayer: PlayerImpact, targetValue: number, targetSalary: number): PlayerImpact[] {
  const salaryMatchTarget = tradeSuggestionSalaryMatchTarget(targetSalary);
  return roster
    .filter((candidate) => candidate.nba_id !== targetPlayer.nba_id)
    .map((candidate) => ({
      candidate,
      value: scaleAdjustedAssetValue(suggestionPlayerAsset(candidate, targetPlayer.team)),
      salary: tradeSalaryForPlayer(candidate)
    }))
    .filter((item) => item.value >= 2_000_000 && item.salary > 0 && item.value <= targetValue * 1.2)
    .sort((a, b) =>
      tradeSuggestionAnchorScore(a.value, a.salary, targetValue, salaryMatchTarget)
      - tradeSuggestionAnchorScore(b.value, b.salary, targetValue, salaryMatchTarget)
    )
    .slice(0, TRADE_TARGET_PACKAGE_ANCHOR_LIMIT)
    .map((item) => item.candidate);
}

function tradeSuggestionAnchorScore(value: number, salary: number, targetValue: number, salaryMatchTarget: number): number {
  const desiredValue = targetValue * 0.58;
  return Math.abs(value - desiredValue) / 1_000_000 + Math.max(0, salaryMatchTarget - salary) / 2_000_000 + (value > targetValue ? 12 : 0);
}

function tradeSuggestionSalaryMatchTarget(targetSalary: number): number {
  if (targetSalary < 12_000_000) return targetSalary * 0.55;
  return targetSalary * 0.72;
}

function tradeSuggestionAddSalaryFillers(
  assets: TradeAsset[],
  roster: PlayerImpact[],
  toTeam: string,
  targetSalary: number,
  targetValue: number,
  excludedIds: Set<number>
): TradeAsset[] {
  const salaryTarget = tradeSuggestionSalaryMatchTarget(targetSalary);
  let out = assets;
  while (tradeSuggestionPackageSalary(out) < salaryTarget && out.length < 3) {
    const filler = roster
      .filter((candidate) => !excludedIds.has(candidate.nba_id))
      .map((candidate) => ({
        candidate,
        salary: tradeSalaryForPlayer(candidate),
        value: scaleAdjustedAssetValue(suggestionPlayerAsset(candidate, toTeam))
      }))
      .filter((item) => item.salary > 0 && item.value <= Math.max(18_000_000, targetValue * 0.42))
      .sort((a, b) =>
        Math.abs((tradeSuggestionPackageSalary(out) + a.salary) - salaryTarget)
        - Math.abs((tradeSuggestionPackageSalary(out) + b.salary) - salaryTarget)
        || a.value - b.value
      )[0]?.candidate;
    if (!filler) break;
    excludedIds.add(filler.nba_id);
    out = [...out, suggestionPlayerAsset(filler, toTeam)];
  }
  return out;
}

function tradeSuggestionAddValueMakeweights(
  assets: TradeAsset[],
  roster: PlayerImpact[],
  fromTeam: string,
  toTeam: string,
  targetValue: number,
  picks: PickAsset[],
  pickContext: TradePickContext,
  season: number,
  teamOptions: TeamProjection[],
  excludedIds: Set<number>
): TradeAsset[] {
  let out = assets;
  let gap = targetValue - scaleAdjustedAssetTotal(out);
  if (gap > TRADE_TARGET_PACKAGE_MIN_VALUE_GAP) {
    const pick = tradeSuggestionPickForGap(picks, fromTeam, toTeam, gap, pickContext, season, teamOptions);
    if (pick) out = [...out, pick];
  }
  gap = targetValue - scaleAdjustedAssetTotal(out);
  if (gap > TRADE_TARGET_PACKAGE_MIN_VALUE_GAP && out.length < 4) {
    const playerMakeweight = tradeSuggestionPlayerForGap(roster, toTeam, gap, excludedIds);
    if (playerMakeweight?.player) {
      excludedIds.add(playerMakeweight.player.nba_id);
      out = [...out, playerMakeweight];
    }
  }
  if (out.length === 1) {
    const sweetener = tradeSuggestionPickForGap(picks, fromTeam, toTeam, TRADE_TARGET_PACKAGE_MIN_VALUE_GAP, pickContext, season, teamOptions);
    if (sweetener) out = [...out, sweetener];
  }
  return out;
}

function tradeSuggestionPackageSalary(assets: TradeAsset[]): number {
  return assets.reduce((sum, asset) => sum + (asset.kind === "player" && asset.player ? tradeSalaryForPlayer(asset.player) : 0), 0);
}

function tradeSuggestionPackagePickCount(assets: TradeAsset[]): number {
  return assets.filter((asset) => asset.kind === "pick").length;
}

function tradeSuggestionPackageKey(assets: TradeAsset[]): string {
  return assets
    .map((asset) => asset.kind === "player" ? `p${asset.player?.nba_id}` : asset.kind === "pick" ? `k${asset.pick?.asset_id}` : `c${asset.cashAmount}`)
    .sort()
    .join("|");
}

function tradeSuggestionFitLift(incoming: TradeAsset[], outgoing: TradeAsset[], team: TeamProjection): number {
  return tradeSuggestionAssetFitTotal(incoming, team) - tradeSuggestionAssetFitTotal(outgoing, team);
}

function tradeSuggestionAssetFitTotal(assets: TradeAsset[], team: TeamProjection): number {
  return assets.reduce((sum, asset) => sum + tradeSuggestionAssetFit(asset, team), 0);
}

function tradeSuggestionAssetFit(asset: TradeAsset, team: TeamProjection): number {
  if (asset.kind === "pick") return (1 - teamTimelineIndex(team)) * 1.2 + Math.max(0, Number(asset.pick?.normalized ?? 0)) * 0.8;
  if (asset.kind !== "player" || !asset.player) return 0;
  const player = asset.player;
  const needFit = skillKeys.reduce((sum, key) => {
    const teamValue = Number(team[key] ?? 0);
    const playerValue = Number(player[key] ?? 0);
    const need = clamp((0.25 - teamValue) / 2.25, 0, 1);
    return sum + Math.max(0, playerValue) * need;
  }, 0);
  return needFit + Number(player.total ?? 0) * 0.45 + Math.max(0, playerTradeScale(player) - 1) * 0.45;
}

function tradeSuggestionTimelineLift(incoming: TradeAsset[], outgoing: TradeAsset[], team: TeamProjection): number {
  return tradeSuggestionTimelineTotal(incoming, team) - tradeSuggestionTimelineTotal(outgoing, team);
}

function tradeSuggestionTimelineTotal(assets: TradeAsset[], team: TeamProjection): number {
  return assets.reduce((sum, asset) => sum + tradeSuggestionAssetTimeline(asset, team), 0);
}

function tradeSuggestionAssetTimeline(asset: TradeAsset, team: TeamProjection): number {
  const timeline = teamTimelineIndex(team);
  if (asset.kind === "pick") return (1 - timeline) * (1.6 + Math.max(0, Number(asset.pick?.normalized ?? 0)));
  if (asset.kind !== "player" || !asset.player) return 0;
  const age = Number(asset.player.age ?? 27);
  const currentImpact = Number(asset.player.total ?? 0);
  const futureScale = playerTradeScale(asset.player);
  const primeFit = clamp(1 - Math.abs(age - 27) / 8, 0, 1);
  const youthFit = clamp((27 - age) / 8, 0, 1);
  return timeline * (primeFit + Math.max(0, currentImpact) * 0.25) + (1 - timeline) * (youthFit + Math.max(0, futureScale - 1) * 0.35);
}

function teamTimelineIndex(team: TeamProjection): number {
  const wins = Number(team.projected_wins ?? team.expected_wins ?? 41);
  return clamp((wins - 28) / 24, 0, 1);
}

function tradeSuggestionStarPenalty(leftAssets: TradeAsset[], rightAssets: TradeAsset[]): number {
  return [...leftAssets, ...rightAssets].reduce((sum, asset) => {
    if (asset.kind !== "player" || !asset.player) return sum;
    const value = playerTradeValue(asset.player);
    const impact = Number(asset.player.total ?? 0);
    return sum + (value > 260_000_000 || impact > 4 ? 12 : 0);
  }, 0);
}

function tradeSuggestionPackageIntentBonus(leftAssets: TradeAsset[], rightAssets: TradeAsset[]): number {
  const packageSide = tradeSuggestionTargetPackageSide(leftAssets, rightAssets);
  if (!packageSide) return 0;
  return packageSide.some((asset) => asset.kind === "pick") ? 7 : 4;
}

function tradeSuggestionTargetPackageSide(leftAssets: TradeAsset[], rightAssets: TradeAsset[]): TradeAsset[] | null {
  const leftSingleTarget = leftAssets.length === 1 && leftAssets[0]?.kind === "player" && rightAssets.length >= 2;
  const rightSingleTarget = rightAssets.length === 1 && rightAssets[0]?.kind === "player" && leftAssets.length >= 2;
  if (leftSingleTarget) return rightAssets;
  if (rightSingleTarget) return leftAssets;
  return null;
}

function tradeSuggestionPackageReason(leftAssets: TradeAsset[], rightAssets: TradeAsset[]): string | null {
  const packageSide = tradeSuggestionTargetPackageSide(leftAssets, rightAssets);
  if (!packageSide) return null;
  return packageSide.some((asset) => asset.kind === "pick") ? "Target package with pick" : "Target package";
}

function tradeSuggestionReasons(
  status: TradeMachineStatus,
  verdict: TradeVerdict,
  leftTeam: TeamProjection,
  rightTeam: TeamProjection,
  leftAssets: TradeAsset[],
  rightAssets: TradeAsset[],
  leftFit: number,
  rightFit: number,
  timelineFit: number,
  leftBalance: TradeMachineTeamValueBalance | null,
  rightBalance: TradeMachineTeamValueBalance | null
): string[] {
  const reasons = [`${tradeMachineShortStatusLabel(status)} / ${verdict}`];
  const packageReason = tradeSuggestionPackageReason(leftAssets, rightAssets);
  if (packageReason) reasons.push(packageReason);
  const leftLabel = leftTeam.team_abbr ?? leftTeam.team;
  const rightLabel = rightTeam.team_abbr ?? rightTeam.team;
  if (leftFit > 0.2) reasons.push(`${leftLabel} fit ${formatSigned(leftFit, 1)}`);
  if (rightFit > 0.2) reasons.push(`${rightLabel} fit ${formatSigned(rightFit, 1)}`);
  if (timelineFit > 0.2) reasons.push(`Timeline ${formatSigned(timelineFit, 1)}`);
  const blocker = [leftBalance, rightBalance].find((balance) => balance?.teamSaysNo);
  if (blocker?.teamSaysNo) reasons.push(`${blocker.teamSaysNo} value gap ${formatMoney(blocker.balanceDeficit)}`);
  if (reasons.length === 1) reasons.push("Value and fit screens cleared");
  return reasons;
}

function tradeSuggestionId(leftTeam: string, rightTeam: string, leftAssets: TradeAsset[], rightAssets: TradeAsset[]): string {
  const ids = (assets: TradeAsset[]) => assets.map((asset) => asset.kind === "player" ? `p${asset.player?.nba_id}` : `k${asset.pick?.asset_id}`).sort().join("-");
  return `${cleanTeamValue(leftTeam)}:${ids(leftAssets)}|${cleanTeamValue(rightTeam)}:${ids(rightAssets)}`;
}

function assetShortLabel(assets: TradeAsset[]): string {
  const labels = routeAssetLabels(assets);
  return labels.length > 2 ? `${labels.slice(0, 2).join(" + ")} + ${labels.length - 2}` : labels.join(" + ");
}

function defaultTradeCalendar(schedules: TeamScheduleGame[] = [], season?: number): TradeCalendarState {
  return {
    tradeDate: "",
    tradeDeadlineDate: "",
    regularSeasonEndDate: regularSeasonEndDateFromSchedule(schedules, season)
  };
}

function regularSeasonEndDateFromSchedule(schedules: TeamScheduleGame[], season?: number): string {
  const dates = schedules
    .filter((game) => (season === undefined || game.season === season) && game.season_type === "Regular Season" && isIsoDateString(game.date))
    .map((game) => game.date)
    .sort();
  return dates[dates.length - 1] ?? "";
}

function isIsoDateString(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function blankToNull(value: string): string | null {
  const clean = value.trim();
  return clean ? clean : null;
}

function fallbackTradeMachineContext(team: string, season: number, players: PlayerImpact[]): TradeMachineTeamContext {
  const roster = tradeRoster(players, team);
  return {
    team,
    seasonYear: season,
    teamSalary: roster.reduce((sum, player) => sum + tradeSalaryForPlayer(player), 0),
    rosterCount: roster.length,
    firstRoundPickYears: []
  };
}

function tradeMachineAssets(assets: TradeAsset[], team: string, season: number, contractMap: Map<string, CapTrackerContractRow>): TradeMachineAsset[] {
  return assets
    .map((asset) => tradeMachineAsset(asset, team, season, contractMap))
    .filter((asset): asset is TradeMachineAsset => Boolean(asset));
}

function tradeMachineAsset(asset: TradeAsset, team: string, season: number, contractMap: Map<string, CapTrackerContractRow>): TradeMachineAsset | null {
  if (asset.kind === "player" && asset.player) {
    const playerAsset = playerTradeMachineAsset(asset.player, team, 1);
    const contractRow = tradeContractRowForPlayer(asset.player, team, contractMap);
    return {
      ...playerAsset,
      toTeam: asset.toTeam ?? null,
      tradeValue: playerTradeValue(asset.player),
      scaleValue: 1,
      ...tradeContractRulesFromNotes(asset.player, contractRow, season)
    };
  }
  if (asset.kind === "pick" && asset.pick) {
    return {
      ...pickTradeMachineAsset(asset.pick, team),
      toTeam: asset.toTeam ?? null,
      tradeValue: pickAssetTradeValue(asset.pick)
    };
  }
  if (asset.kind === "cash") {
    const amount = Math.max(0, Number(asset.cashAmount ?? 0));
    if (amount <= 0) return null;
    return {
      id: asset.id,
      kind: "cash",
      label: "Cash considerations",
      team,
      toTeam: asset.toTeam ?? null,
      cashAmount: amount,
      tradeValue: amount
    };
  }
  return null;
}

function buildTradeContractMap(rows: CapTrackerContractRow[]): Map<string, CapTrackerContractRow> {
  const out = new Map<string, CapTrackerContractRow>();
  rows
    .filter((row) => row.row_type === "player")
    .forEach((row) => {
      const team = cleanTeamValue(row.team);
      if (typeof row.nba_id === "number" && Number.isFinite(row.nba_id)) out.set(tradeContractIdKey(row.nba_id), row);
      out.set(tradeContractNameKey(row.player_name, team), row);
    });
  return out;
}

function tradeContractRowForPlayer(player: PlayerImpact, team: string, contractMap: Map<string, CapTrackerContractRow>): CapTrackerContractRow | undefined {
  const byId = contractMap.get(tradeContractIdKey(player.nba_id));
  if (byId) return byId;
  const teams = [
    team,
    player.current_roster_team,
    player.roster_truth_team,
    player.rights_team,
    player.incumbent_team,
    player.team
  ].map(cleanTeamValue);
  const seen = new Set<string>();
  for (const teamValue of teams) {
    if (seen.has(teamValue)) continue;
    seen.add(teamValue);
    const row = contractMap.get(tradeContractNameKey(player.player_name, teamValue));
    if (row) return row;
  }
  return undefined;
}

function tradeContractRulesFromNotes(
  player: PlayerImpact,
  row: CapTrackerContractRow | undefined,
  season: number
): Pick<
  TradeMachineAsset,
  | "tradeBonus"
  | "noTradeConsentRequired"
  | "noTradeConsentGranted"
  | "noTradeConsentUntil"
  | "tradeRestrictionUntil"
  | "tradeRestrictionDestinationTeam"
  | "couldBeLastContractSeason"
  | "lastContractSeasonReason"
  | "acquiredByTradeDate"
  | "acquiredByTradeDateUnknown"
  | "acquiredByTradeSource"
  | "signingTradeRestrictionType"
  | "signingTradeRestrictionSignedDate"
  | "signingTradeRestrictionUntil"
  | "signingTradeRestrictionReason"
  | "currentSeasonGuaranteedSalary"
  | "nextSeasonSalary"
  | "nextSeasonGuaranteedSalary"
  | "contractSeasonsRemaining"
  | "isTwoWay"
  | "isMinimumSalary"
> {
  const notes = row?.contract_notes ?? "";
  const tradeBonus = tradeBonusFromContractNotes(notes, row, player, season);
  const timedRestriction = tradeRestrictionFromContractNotes(notes);
  const deadlineContract = tradeDeadlineContractFacts(row, season);
  const signingRestriction = signingTradeRestrictionFacts(row, notes, season);
  const recentAcquisition = recentTradeAcquisitionFacts(notes);
  const implicitConsent = implicitNoTradeConsentFacts(row, season, notes);
  const noTradeClause = findContractNoteClause(notes, /\b(?:full\s+)?no[- ]trade clause\b|\bimplicit no[- ]trade\b/i);
  const explicitNoTradeWaived = Boolean(noTradeClause && /\bwaived\b/i.test(noTradeClause));
  const explicitNoTradeRequired = Boolean(noTradeClause && !explicitNoTradeWaived);
  const noTradeConsentRequired = Boolean(explicitNoTradeRequired || timedRestriction?.noTradeConsentRequired || (implicitConsent?.noTradeConsentRequired && !explicitNoTradeWaived));
  const noTradeConsentGranted = Boolean(explicitNoTradeWaived && !noTradeConsentRequired);
  return {
    ...tradeContractSalaryProtection(row, season),
    ...deadlineContract,
    ...(signingRestriction ? signingRestriction : {}),
    ...(recentAcquisition ? recentAcquisition : {}),
    ...(tradeBonus ? { tradeBonus } : {}),
    ...(timedRestriction ? timedRestriction : {}),
    ...(noTradeClause || timedRestriction?.noTradeConsentRequired || implicitConsent
      ? { noTradeConsentRequired, noTradeConsentGranted, noTradeConsentUntil: timedRestriction?.noTradeConsentUntil ?? null }
      : {})
  };
}

function implicitNoTradeConsentFacts(
  row: CapTrackerContractRow | undefined,
  season: number,
  notes: string
): Pick<TradeMachineAsset, "noTradeConsentRequired" | "noTradeConsentGranted"> | null {
  if (!isImplicitNoTradeConsentContract(row, season)) return null;
  if (/\bwaived\s+implicit\s+no[- ]trade\b/i.test(notes)) {
    return {
      noTradeConsentRequired: false,
      noTradeConsentGranted: true
    };
  }
  return {
    noTradeConsentRequired: true,
    noTradeConsentGranted: false
  };
}

function isImplicitNoTradeConsentContract(row: CapTrackerContractRow | undefined, season: number): boolean {
  if (!row) return false;
  const current = row.cells.find((cell) => cell.year === season);
  if (!current || !isTradeBonusBaseCellKind(current.kind) || current.kind === "player_option" || current.kind === "team_option") return false;
  const signedUsing = String(row.signed_using ?? "").trim().toLowerCase();
  if (signedUsing !== "bird rights" && signedUsing !== "early bird rights") return false;
  return !row.cells.some((cell) =>
    cell.year > season &&
    cell.amount > 0 &&
    isTradeBonusBaseCellKind(cell.kind) &&
    cell.kind !== "player_option" &&
    cell.kind !== "team_option"
  );
}

function recentTradeAcquisitionFacts(
  notes: string
): Pick<TradeMachineAsset, "acquiredByTradeDate" | "acquiredByTradeDateUnknown" | "acquiredByTradeSource"> | null {
  const clause = findContractNoteClause(notes, /\bacquired via\b|\btriggered\s+(?:via|with)\b.*\btrade\b|\bvia\s+[A-Z]{2,3}-[A-Z]{2,3}\s+trade\b/i);
  if (!clause) return null;
  const date = parseSlashDateFromText(clause);
  const source = recentTradeAcquisitionSource(clause);
  return {
    ...(date ? { acquiredByTradeDate: isoDate(date) } : { acquiredByTradeDateUnknown: true }),
    ...(source ? { acquiredByTradeSource: source } : {})
  };
}

function recentTradeAcquisitionSource(clause: string): string | null {
  const acquired = clause.match(/\bacquired via\s+([^|;,\[]+)/i);
  if (acquired?.[1]) return acquired[1].trim();
  const teams = clause.match(/\b([A-Z]{2,3}-[A-Z]{2,3}(?:-[A-Z]{2,3})?)\s+trade\b/i);
  return teams?.[1] ?? null;
}

function signingTradeRestrictionFacts(
  row: CapTrackerContractRow | undefined,
  notes: string,
  season: number
): Pick<
  TradeMachineAsset,
  "signingTradeRestrictionType" | "signingTradeRestrictionSignedDate" | "signingTradeRestrictionUntil" | "signingTradeRestrictionReason"
> | null {
  const current = row?.cells.find((cell) => cell.year === season);
  if (row?.row_type === "draft_pick" && current?.kind === "draft_pick") {
    return {
      signingTradeRestrictionType: "draft_rookie_or_two_way",
      signingTradeRestrictionReason: "30-day draft rookie signing restriction"
    };
  }
  const clause = findContractNoteClause(notes, /\bsigned\b|\bconverted\b|\bdraft rookie\b|\btwo[-\s]?way\b/i);
  if (!clause) return null;
  const type = signingTradeRestrictionTypeFromClause(clause);
  if (!type) return null;
  const signedDate = parseSlashDateFromText(clause);
  return {
    signingTradeRestrictionType: type,
    ...(signedDate ? { signingTradeRestrictionSignedDate: isoDate(signedDate) } : {}),
    signingTradeRestrictionReason: signingTradeRestrictionReason(type)
  };
}

function signingTradeRestrictionTypeFromClause(clause: string): TradeMachineAsset["signingTradeRestrictionType"] | null {
  if (/\bdraft rookie\b|\brookie[-\s]?scale\b|\btwo[-\s]?way\b/i.test(clause)) return "draft_rookie_or_two_way";
  if (/\b(?:qualifying|early qualifying)\s+veteran\b|\b120\s*%\b|\bbird[-\s]?rights raise\b/i.test(clause)) return "bird_raise";
  if (/\bsigned\b|\bconverted\b|\bstandard nba contract\b|\bfree agent\b/i.test(clause)) return "free_agent";
  return null;
}

function signingTradeRestrictionReason(type: NonNullable<TradeMachineAsset["signingTradeRestrictionType"]>): string {
  if (type === "draft_rookie_or_two_way") return "30-day rookie/Two-Way signing restriction";
  if (type === "bird_raise") return "three-month/Jan. 15 Bird-rights signing restriction";
  return "three-month/Dec. 15 free-agent signing restriction";
}

function tradeDeadlineContractFacts(
  row: CapTrackerContractRow | undefined,
  season: number
): Pick<TradeMachineAsset, "couldBeLastContractSeason" | "lastContractSeasonReason"> {
  const current = row?.cells.find((cell) => cell.year === season);
  if (!current || !isTradeBonusBaseCellKind(current.kind)) return {};
  const next = row?.cells.find((cell) => cell.year === season + 1);
  if (!next || isEmptyContractCell(next)) {
    return {
      couldBeLastContractSeason: true,
      lastContractSeasonReason: "last contract season"
    };
  }
  if (isOptionOrEtoContractSeason(next, row?.contract_notes, season + 1)) {
    return {
      couldBeLastContractSeason: true,
      lastContractSeasonReason: `${seasonLabel(season + 1)} option/ETO could make this the last season`
    };
  }
  return {};
}

function isEmptyContractCell(cell: CapTrackerContractRow["cells"][number]): boolean {
  return cell.kind === "empty" || cell.kind === "cap_hold" || cell.kind === "dead" || cell.amount <= 0;
}

function isOptionOrEtoContractSeason(cell: CapTrackerContractRow["cells"][number], notes: string | null | undefined, season: number): boolean {
  const text = `${cell.kind} ${cell.status ?? ""} ${cell.label ?? ""} ${cell.note ?? ""}`;
  if (/\b(?:player|team|club)\s+option\b|\beto\b|\bearly termination option\b/i.test(text)) return true;
  const label = escapeRegex(seasonLabel(season));
  const optionForSeason = new RegExp(`${label}\\s*:[^|;]*(?:player\\s+option|team\\s+option|club\\s+option|\\bETO\\b|early termination option)`, "i");
  return optionForSeason.test(notes ?? "");
}

function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(-2)}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tradeRestrictionFromContractNotes(
  notes: string
): Pick<TradeMachineAsset, "noTradeConsentRequired" | "noTradeConsentUntil" | "tradeRestrictionUntil" | "tradeRestrictionDestinationTeam"> | null {
  const clause = findContractNoteClause(notes, /\bright to veto any trade\b|\bcannot be traded to\b/i);
  if (!clause) return null;
  const rightToVeto = /\bright to veto any trade\b/i.test(clause);
  const destination = tradeRestrictionDestinationFromClause(clause);
  const until = tradeRestrictionUntilFromNotes(notes, clause);
  if (!rightToVeto && !destination && !until) return null;
  return {
    ...(rightToVeto ? { noTradeConsentRequired: true, noTradeConsentUntil: until } : {}),
    ...(until ? { tradeRestrictionUntil: until } : {}),
    ...(destination ? { tradeRestrictionDestinationTeam: destination } : {})
  };
}

function tradeRestrictionDestinationFromClause(clause: string): string | null {
  const match = clause.match(/\bcannot be traded to\s+([A-Z]{2,3})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function tradeRestrictionUntilFromNotes(notes: string, clause: string): string | null {
  if (!/\b(?:one|1)\s+(?:season|year)\b/i.test(clause)) return null;
  const start = parseRestrictionStartDate(notes, clause);
  return start ? addYearsIso(start, 1) : null;
}

function parseRestrictionStartDate(notes: string, clause: string): Date | null {
  const marker = clause ? notes.indexOf(clause) : -1;
  const beforeClause = marker > 0 ? notes.slice(0, marker) : notes;
  const matches = Array.from(beforeClause.matchAll(/\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\)/g));
  const match = matches[matches.length - 1];
  return match ? dateFromSlashMatch(match) : null;
}

function parseSlashDateFromText(text: string): Date | null {
  const match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return null;
  return dateFromSlashMatch(match);
}

function dateFromSlashMatch(match: RegExpMatchArray | RegExpExecArray): Date | null {
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addYearsIso(date: Date, years: number): string {
  const out = new Date(date.getTime());
  out.setFullYear(out.getFullYear() + years);
  return isoDate(out);
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function tradeContractSalaryProtection(
  row: CapTrackerContractRow | undefined,
  season: number
): Pick<TradeMachineAsset, "currentSeasonGuaranteedSalary" | "nextSeasonSalary" | "nextSeasonGuaranteedSalary" | "contractSeasonsRemaining" | "isTwoWay" | "isMinimumSalary"> {
  const current = row?.cells.find((cell) => cell.year === season);
  const next = row?.cells.find((cell) => cell.year === season + 1);
  return {
    currentSeasonGuaranteedSalary: protectedCellAmount(current),
    nextSeasonSalary: salaryCellAmount(next),
    nextSeasonGuaranteedSalary: protectedCellAmount(next),
    contractSeasonsRemaining: remainingContractSeasons(row, season),
    isTwoWay: isTwoWayContractCell(current, row),
    isMinimumSalary: isMinimumSalaryContractCell(current, row)
  };
}

function remainingContractSeasons(row: CapTrackerContractRow | undefined, season: number): number | null {
  if (!row) return null;
  const count = row.cells.filter((cell) => cell.year >= season && salaryCellAmount(cell) !== null).length;
  return count > 0 ? count : null;
}

function protectedCellAmount(cell: CapTrackerContractRow["cells"][number] | undefined): number | null {
  if (!cell || !isTradeBonusBaseCellKind(cell.kind)) return null;
  const guaranteed = Number(cell.guaranteed_amount);
  if (Number.isFinite(guaranteed)) return Math.max(0, guaranteed);
  return null;
}

function salaryCellAmount(cell: CapTrackerContractRow["cells"][number] | undefined): number | null {
  if (!cell || !isTradeBonusBaseCellKind(cell.kind)) return null;
  const amount = Number(cell.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isTwoWayContractCell(cell: CapTrackerContractRow["cells"][number] | undefined, row: CapTrackerContractRow | undefined): boolean {
  const text = `${cell?.status ?? ""} ${cell?.label ?? ""} ${cell?.note ?? ""} ${row?.contract_notes ?? ""}`;
  return /\btwo[-\s]?way\b/i.test(text);
}

function isMinimumSalaryContractCell(cell: CapTrackerContractRow["cells"][number] | undefined, row: CapTrackerContractRow | undefined): boolean {
  const text = `${cell?.status ?? ""} ${cell?.label ?? ""} ${cell?.note ?? ""} ${row?.signed_using ?? ""} ${row?.contract_notes ?? ""}`;
  return /\bminimum\b/i.test(text) && !/\btwo[-\s]?way\b/i.test(text);
}

function tradeBonusFromContractNotes(
  notes: string,
  row: CapTrackerContractRow | undefined,
  player: PlayerImpact,
  season: number
): TradeMachineAsset["tradeBonus"] | undefined {
  const clause = findContractNoteClause(notes, /\btrade\s+(?:bonus|kicker)\b/i);
  if (!clause) return undefined;
  const percent = parseTradeBonusPercent(clause);
  const amount = parseTradeBonusAmount(clause);
  return {
    percent,
    amount,
    remainingBaseCompensation: remainingTradeBonusBase(row, season),
    waived: /\b(?:waived|voided)\b/i.test(clause),
    previouslyEarned: /\b(?:paid|triggered|trigged)\b/i.test(clause),
    yoe: typeof player.yoe === "number" && Number.isFinite(player.yoe) ? player.yoe : null,
    priorYearSalary: salaryCellAmountForYear(row, season - 1),
    maxSalaryPercent: parseMaxSalaryPercent(notes)
  };
}

function remainingTradeBonusBase(row: CapTrackerContractRow | undefined, season: number): number | null {
  if (!row) return null;
  const total = row.cells
    .filter((cell) => cell.year >= season && isTradeBonusBaseCellKind(cell.kind))
    .reduce((sum, cell) => sum + Math.max(0, Number(cell.amount) || 0), 0);
  return total > 0 ? total : null;
}

function salaryCellAmountForYear(row: CapTrackerContractRow | undefined, year: number): number | null {
  if (!row) return null;
  const total = row.cells
    .filter((cell) => cell.year === year && isTradeBonusBaseCellKind(cell.kind))
    .reduce((sum, cell) => sum + Math.max(0, Number(cell.amount) || 0), 0);
  return total > 0 ? total : null;
}

function isTradeBonusBaseCellKind(kind: CapTrackerContractRow["cells"][number]["kind"]): boolean {
  return kind === "guaranteed" || kind === "partial_guarantee" || kind === "player_option" || kind === "team_option" || kind === "non_guaranteed";
}

function parseTradeBonusPercent(clause: string): number | null {
  const direct = clause.match(/(\d+(?:\.\d+)?)\s*%\s*trade\s+(?:bonus|kicker)/i);
  if (direct) return clamp(Number(direct[1]) / 100, 0, 0.15);
  const markerIndex = clause.search(/\btrade\s+(?:bonus|kicker)\b/i);
  const beforeMarker = markerIndex >= 0 ? clause.slice(0, markerIndex) : clause;
  const matches = Array.from(beforeMarker.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
  const match = matches[matches.length - 1];
  return match ? clamp(Number(match[1]) / 100, 0, 0.15) : null;
}

function parseTradeBonusAmount(clause: string): number | null {
  const match = clause.match(/\$([0-9][\d,.]*)(?:\s*([mk]))?/i);
  if (!match) return null;
  const amount = parseNumericToken(`$${match[1]}${match[2] ?? ""}`);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseMaxSalaryPercent(notes: string): number | null {
  const match = notes.match(/(\d+(?:\.\d+)?)\s*%\s*max/i);
  if (!match) return null;
  const percent = Number(match[1]) / 100;
  return Number.isFinite(percent) && percent > 0 ? percent : null;
}

function findContractNoteClause(notes: string, pattern: RegExp): string {
  const chunks = String(notes ?? "")
    .split(/\s*[;|]\s*/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.find((chunk) => pattern.test(chunk)) ?? (pattern.test(notes) ? notes : "");
}

function tradeContractIdKey(nbaId: number): string {
  return `id:${nbaId}`;
}

function tradeContractNameKey(playerName: string, team: string): string {
  return `name:${normalizeTradeNameKey(playerName)}|${cleanTeamValue(team)}`;
}

function normalizeTradeNameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tradeMachineStatusLabel(status: TradeMachineStatus | undefined): string {
  if (status === "legal") return "CBA legal";
  if (status === "illegal") return "CBA illegal";
  if (status === "warning") return "Needs review";
  return "Needs cap data";
}

function tradeMachineTone(status: TradeMachineStatus | undefined): "green" | "gold" | "red" {
  if (status === "legal") return "green";
  if (status === "illegal") return "red";
  return "gold";
}

function tradeMachineSaysNoLabel(result: TradeMachineResult): string {
  const blockingTeam = result.teams.find((team) => team.checks.some((check) => check.status === "fail"));
  return blockingTeam ? `${blockingTeam.team} CBA block` : "CBA block";
}

function tradeMachineValueVerdictLabel(verdict: TradeMachineValueVerdict | undefined): TradeVerdict | null {
  if (verdict === "accepted") return "Accepted";
  if (verdict === "maybe") return "Maybe";
  if (verdict === "declined") return "Declined";
  return null;
}

function tradeMachineValueSaysNoLabel(balance: TradeMachineResult["valueBalance"] | undefined): string | null {
  if (!balance) return null;
  if (!balance.teamSaysNo) return "Toss-up";
  const basis = balance.imbalanceBasis === "scale_adjusted_value" ? "scale-adjusted value" : "trade value";
  return `${balance.teamSaysNo} says no (${basis})`;
}

function tradeMachineTeamValueBalance(result: TradeMachineResult | null | undefined, team: string) {
  const target = cleanTeamValue(team);
  return result?.teamValueBalances.find((balance) => cleanTeamValue(balance.team) === target) ?? null;
}

function tradeMachineMultiTeamVerdictLabel(result: TradeMachineResult | null | undefined): TradeVerdict | null {
  if (!result) return null;
  if (result.modelAccepted) return "Accepted";
  if (result.modelViable) return "Maybe";
  return "Declined";
}

function tradeMachineMultiTeamSaysNoLabel(result: TradeMachineResult | null | undefined, teamMeta: Map<string, TeamProjection>): string | null {
  if (!result) return null;
  const blockers = result.teamValueBalances.filter((balance) => balance.teamSaysNo);
  if (blockers.length === 0) return "Toss-up";
  const basis = blockers.some((balance) => balance.imbalanceBasis === "scale_adjusted_value") ? "scale-adjusted value" : "trade value";
  return `${blockers.map((balance) => teamLabel(balance.team, teamMeta)).join(", ")} says no (${basis})`;
}

function buildTradeReviewItems(result: TradeMachineResult | null | undefined, teamMeta: Map<string, TeamProjection>): TradeReviewItem[] {
  if (!result) {
    return [{
      severity: "warn",
      source: "Setup",
      label: "Cap data unavailable",
      detail: "Load cap tracker data to evaluate salary matching, apron limits, cash, and pick-trading rules."
    }];
  }
  const valueItems = result.teamValueBalances
    .filter((balance) => balance.verdict !== "accepted")
    .map<TradeReviewItem>((balance) => ({
      severity: balance.verdict === "declined" ? "fail" : "warn",
      source: "Value",
      label: `${teamLabel(balance.team, teamMeta)} ${balance.verdict === "declined" ? "declines" : "needs value"}`,
      detail: tradeMachineRouteDeficitLabel(balance),
      hint: tradeMachineValueRepairHint(balance)
    }));
  const cbaItems = result.checks
    .filter(isTradeReviewRuleCheck)
    .map<TradeReviewItem>((check) => ({
      severity: check.status,
      source: "CBA",
      label: check.label,
      detail: check.detail
    }));
  const deduped = new Map<string, TradeReviewItem>();
  [...valueItems, ...cbaItems].forEach((item) => {
    const key = `${item.severity}|${item.source}|${item.label}|${item.detail}`;
    if (!deduped.has(key)) deduped.set(key, item);
  });
  return Array.from(deduped.values()).sort((a, b) => reviewSeverityRank(a.severity) - reviewSeverityRank(b.severity));
}

function reviewSeverityRank(severity: TradeReviewItem["severity"]): number {
  return severity === "fail" ? 0 : 1;
}

function isTradeReviewRuleCheck(check: TradeMachineRuleCheck): check is TradeMachineRuleCheck & { status: TradeReviewItem["severity"] } {
  return check.status === "fail" || check.status === "warn";
}

function primaryTradeMachineChecks(result: TradeMachineResult): TradeMachineRuleCheck[] {
  const review = result.checks.filter((check) => check.status !== "pass");
  if (review.length > 0) return review.slice(0, 6);
  const priority = result.teams.flatMap((team) =>
    team.checks.filter((check) =>
      check.code.includes(":salary-match") ||
      check.code.includes(":first-apron") ||
      check.code.includes(":second-apron-aggregation") ||
      check.code.includes(":stepien")
    )
  );
  return priority.slice(0, 6);
}

function tradeMachineAuditChecks(result: TradeMachineResult): TradeMachineRuleCheck[] {
  const review = result.checks.filter((check) => check.status !== "pass");
  const passes = result.checks.filter((check) => check.status === "pass");
  return [...review, ...passes];
}

function tradeMachineApronLabel(band: TradeMachineTeamResult["apronAfter"]): string {
  if (band === "second_apron") return "Over second apron";
  if (band === "first_apron") return "Over first apron";
  if (band === "tax") return "Tax team";
  if (band === "over_cap") return "Over cap";
  return "Cap room";
}

function defaultTradePickBuilder(season: number): TradePickBuilderState {
  return {
    assetType: "first",
    draftYear: season + 1,
    protectionCutoff: 0,
    counterpartyTeam: ""
  };
}

function coerceTradePickKind(value: string | null | undefined): TradePickKind {
  if (value === "swap") return "swap";
  return value === "second" ? "second" : "first";
}

function coerceTradePickDraftYear(builder: TradePickBuilderState, season: number): number {
  const year = Number(builder.draftYear);
  const years = tradePickDraftYears(season);
  return years.includes(year) ? year : years[0];
}

function tradePickDraftYears(season: number): number[] {
  return Array.from({ length: 8 }, (_, index) => season + index + 1);
}

function coerceTradePickCounterparty(builder: TradePickBuilderState, sideTeam: string, teamOptions: TeamProjection[]): string {
  const rawSelected = String(builder.counterpartyTeam ?? "").trim();
  const selected = rawSelected ? cleanTeamValue(rawSelected) : "";
  if (selected && selected !== cleanTeamValue(sideTeam) && teamOptions.some((team) => cleanTeamValue(team.team) === selected)) {
    return rawSelected;
  }
  return teamOptions.find((team) => cleanTeamValue(team.team) !== cleanTeamValue(sideTeam))?.team ?? "";
}

function tradeTeamPickAssets(picks: PickAsset[], team: string, season: number): PickAsset[] {
  const cleanTeam = cleanTeamValue(team);
  return picks
    .filter((pick) => pick.asset_type === "team_pick" || pick.asset_type === "pick_swap")
    .filter((pick) => cleanTeamValue(pick.team ?? "") === cleanTeam)
    .filter((pick) => typeof pick.draft_year !== "number" || pick.draft_year >= season)
    .sort((a, b) => (a.draft_year ?? 9999) - (b.draft_year ?? 9999) || a.round - b.round || pickAssetTradeValue(b) - pickAssetTradeValue(a));
}

function selectedActualPick(picks: PickAsset[], assetId: string): PickAsset | null {
  return picks.find((pick) => pick.asset_id === assetId) ?? picks[0] ?? null;
}

function buildTradePickContext(slotAssets: PickAsset[], capTracker: AppData["capTracker"], season: number): TradePickContext {
  const slotValues = new Map<number, number>();
  slotAssets.filter((asset) => asset.asset_type === "slot_value").forEach((asset) => {
    const pick = Number(asset.pick);
    const value = Number(asset.value);
    if (Number.isFinite(pick) && Number.isFinite(value)) slotValues.set(pick, value);
  });
  const years = tradePickDraftYears(season);
  const baseYear = years[0];
  const baseCap = tradePickScaleCap(capTracker, baseYear);
  const yearScale = new Map(years.map((year) => {
    const cap = tradePickScaleCap(capTracker, year);
    return [year, baseCap > 0 && cap > 0 ? cap / baseCap : 1];
  }));
  const lotteryWeights = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
  const lotteryDistributions = weightedLotteryDistributions(lotteryWeights);
  const firstRound = averageDistributions([
    ...lotteryDistributions,
    ...Array.from({ length: 16 }, (_, index) => [{ pick: 15 + index, probability: 1 }])
  ]);
  const secondRound = Array.from({ length: 30 }, (_, index) => ({ pick: 31 + index, probability: 1 / 30 }));
  return { firstRound, secondRound, slotValues, yearScale };
}

function tradePickScaleCap(capTracker: AppData["capTracker"], year: number): number {
  const seasons = [...(capTracker?.seasons ?? [])].sort((a, b) => a.year - b.year);
  if (seasons.length === 0) return 1;
  const exact = seasons.find((item) => item.year === year);
  const capValue = (item: typeof seasons[number]) => Number(item.first_apron || item.tax_level || item.salary_cap || 0);
  if (exact) return capValue(exact);
  const prior = [...seasons].reverse().find((item) => item.year < year);
  if (prior) return capValue(prior) * Math.pow(1.05, year - prior.year);
  return capValue(seasons[0]);
}

function weightedLotteryDistributions(weights: number[]): PickDistributionPoint[][] {
  const n = weights.length;
  if (n === 0) return [];
  const topPicks = Math.min(4, n);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const teamPickProbability: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  const draw = (selected: number[], probability: number, remainingWeight: number) => {
    if (selected.length === topPicks) {
      selected.forEach((teamIndex, pickIndex) => {
        teamPickProbability[teamIndex][pickIndex] += probability;
      });
      const selectedSet = new Set(selected);
      const remainingTeams = Array.from({ length: n }, (_, index) => index).filter((index) => !selectedSet.has(index));
      remainingTeams.forEach((teamIndex, index) => {
        teamPickProbability[teamIndex][topPicks + index] += probability;
      });
      return;
    }
    for (let index = 0; index < n; index += 1) {
      if (selected.includes(index)) continue;
      const weight = weights[index];
      if (weight <= 0 || remainingWeight <= 0) continue;
      draw([...selected, index], probability * weight / remainingWeight, remainingWeight - weight);
    }
  };
  draw([], 1, totalWeight);
  return teamPickProbability.map((distribution) => distribution.map((probability, pickIndex) => ({ pick: pickIndex + 1, probability })));
}

function averageDistributions(distributions: PickDistributionPoint[][]): PickDistributionPoint[] {
  const byPick = new Map<number, number>();
  if (distributions.length === 0) return [];
  distributions.forEach((distribution) => {
    distribution.forEach((point) => {
      byPick.set(point.pick, (byPick.get(point.pick) ?? 0) + point.probability / distributions.length);
    });
  });
  return Array.from(byPick.entries())
    .map(([pick, probability]) => ({ pick, probability }))
    .sort((a, b) => a.pick - b.pick);
}

function buildTradePickAsset(builder: TradePickBuilderState, context: TradePickContext, season: number, sideTeam: string, teamOptions: TeamProjection[]): PickAsset | null {
  const assetType = coerceTradePickKind(builder.assetType);
  const draftYear = coerceTradePickDraftYear(builder, season);
  const protectionCutoff = assetType === "second" ? 0 : Number(builder.protectionCutoff ?? 0);
  const protection = protectionLabel(protectionCutoff);
  const distribution = assetType === "second" ? context.secondRound : context.firstRound;
  if (!distribution) return null;
  const summary = tradePickSummary(distribution, context.slotValues, protectionCutoff);
  const round = assetType === "second" ? 2 : 1;
  const counterpartyTeam = assetType === "swap" ? coerceTradePickCounterparty(builder, sideTeam, teamOptions) : null;
  if (assetType === "swap" && !counterpartyTeam) return null;
  const ordinal = round === 1 ? "1st" : "2nd";
  const label = assetType === "swap"
    ? `${draftYear} ${protectionCutoff > 0 ? `${protection[0].toUpperCase()}${protection.slice(1)} ` : ""}Swap Right vs ${counterpartyTeam}`
    : round === 1
    ? `${draftYear} ${protectionCutoff > 0 ? `${protection[0].toUpperCase()}${protection.slice(1)} ` : "Unprotected "}${ordinal}`
    : `${draftYear} Generic ${ordinal}`;
  const yearScale = context.yearScale.get(draftYear) ?? 1;
  const value = (assetType === "swap" ? summary.value * TRADE_SWAP_VALUE_FACTOR : summary.value) * yearScale;
  return {
    asset_id: assetType === "swap"
      ? `generic-swap-${draftYear}-${counterpartyTeam}-${protectionCutoff}`
      : `generic-pick-${draftYear}-r${round}-${protectionCutoff}`,
    label,
    pick: Math.round(summary.expectedPick),
    round,
    normalized: normalizedPickValue(value, context.slotValues),
    scale_value: pickScaleFromNormalized(normalizedPickValue(value, context.slotValues)),
    value: Math.round(value),
    asset_type: assetType === "swap" ? "pick_swap" : "generic_pick",
    origin_team: null,
    draft_year: draftYear,
    protection,
    protection_cutoff: protectionCutoff,
    counterparty_team: counterpartyTeam,
    convey_probability: assetType === "swap" ? 0.5 : roundProbability(summary.conveyProbability),
    expected_pick: roundTo(summary.expectedPick, 1)
  };
}

function tradePickSummary(distribution: PickDistributionPoint[], slotValues: Map<number, number>, protectionCutoff: number) {
  let value = 0;
  let conveyProbability = 0;
  let expectedPick = 0;
  distribution.forEach((point) => {
    expectedPick += point.pick * point.probability;
    if (protectionCutoff > 0 && point.pick <= protectionCutoff) return;
    conveyProbability += point.probability;
    value += point.probability * pickSlotValue(slotValues, point.pick);
  });
  return { value, conveyProbability, expectedPick };
}

function pickSlotValue(slotValues: Map<number, number>, pick: number): number {
  const exact = slotValues.get(pick);
  if (exact !== undefined) return exact;
  return pick <= 30 ? 34_000_000 * Math.exp(-(pick - 1) / 19) : 4_200_000 * Math.exp(-(pick - 31) / 18);
}

function pickAssetTradeValue(pick: PickAsset): number {
  const value = Number(pick.value);
  return Number.isFinite(value) ? Math.max(0, value) * TRADE_PICK_VALUE_YEARS : 0;
}

function normalizedPickValue(value: number, slotValues: Map<number, number>): number {
  const maxValue = Math.max(...Array.from(slotValues.values()).filter(Number.isFinite), 1);
  return roundTo(clamp(value / maxValue, 0, 1), 3);
}

function pickScaleFromNormalized(normalized: number | null | undefined): number {
  const value = Number(normalized);
  return roundTo(1 + clamp(Number.isFinite(value) ? value : 0, 0, 1), 3);
}

function protectionLabel(cutoff: number): string {
  return TRADE_PICK_PROTECTIONS.find((protection) => protection.cutoff === cutoff)?.label.toLowerCase() ?? "unprotected";
}

function roundProbability(value: number): number {
  return roundTo(clamp(value, 0, 1), 3);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatSalarySlot(player: PlayerImpact): string {
  const status = player.contract_status?.trim();
  if (status === "Team Option" || status === "Player Option") return status;
  const salary = formatMoney(player.contract);
  if (salary !== "-") {
    return status && status !== "Signed" ? `${salary} ${status}` : salary;
  }
  return status || "-";
}

function playerTradeAsset(player: PlayerImpact): TradeAsset {
  return { kind: "player", id: `player-${player.nba_id}`, player };
}

function pickTradeAsset(pick: PickAsset): TradeAsset {
  return { kind: "pick", id: `pick-${pick.asset_id}-${Date.now()}-${Math.random().toString(16).slice(2)}`, pick };
}

function cashTradeAsset(amount: number): TradeAsset {
  const cleanAmount = Math.max(0, Math.round(amount));
  return { kind: "cash", id: `cash-${Date.now()}-${Math.random().toString(16).slice(2)}`, cashAmount: cleanAmount };
}

function selectedTradePlayerIds(...assetGroups: TradeAsset[][]): Set<number> {
  const ids = new Set<number>();
  assetGroups.flat().forEach((asset) => {
    if (asset.kind === "player" && asset.player) ids.add(asset.player.nba_id);
  });
  return ids;
}

export function playerTradeValue(player: PlayerImpact): number {
  const seasons = [
    {
      value: impactNumber(player, "value"),
      scale: currentScale(player),
      contract: impactNumber(player, "contract") ?? impactNumber(player, "fa_value")
    },
    ...[1, 2, 3].map((seasonIndex) => ({
      value: impactNumber(player, `projection_value_y${seasonIndex}` as keyof PlayerImpact),
      scale: impactNumber(player, `projection_scalability_y${seasonIndex}` as keyof PlayerImpact),
      contract: impactNumber(player, `projection_effective_contract_y${seasonIndex}` as keyof PlayerImpact)
        ?? impactNumber(player, `projection_contract_y${seasonIndex}` as keyof PlayerImpact)
    }))
  ];
  const seasonValues = seasons
    .filter((season) => season.value !== null)
    .map((season) => {
      const value = season.value ?? 0;
      const contract = season.contract ?? 0;
      const scale = Math.max(0, season.scale ?? 1);
      return value - contract * (1 - scale);
    });
  if (seasonValues.length > 0) return seasonValues.reduce((sum, value) => sum + value, 0);
  return Number(player.trade_value ?? 0);
}

function assetValue(asset: TradeAsset): number {
  if (asset.kind === "player") return asset.player ? playerTradeValue(asset.player) : 0;
  if (asset.kind === "cash") return Math.max(0, Number(asset.cashAmount ?? 0));
  return asset.pick ? pickAssetTradeValue(asset.pick) : 0;
}

function scaleAdjustedAssetValue(asset: TradeAsset): number {
  const value = assetValue(asset);
  if (asset.kind === "player" && asset.player) return value;
  if (asset.kind === "pick" && asset.pick) {
    const scale = Number(asset.pick.scale_value ?? pickScaleFromNormalized(asset.pick.normalized));
    return value * Math.max(0, Number.isFinite(scale) ? scale : 1);
  }
  return value;
}

function scaleAdjustedAssetTotal(assets: TradeAsset[]): number {
  return assets.reduce((sum, asset) => sum + scaleAdjustedAssetValue(asset), 0);
}

function assetLabel(asset: TradeAsset): string {
  if (asset.kind === "player") return asset.player?.player_name ?? "Unknown player";
  if (asset.kind === "cash") return "Cash considerations";
  return asset.pick?.label ?? "Pick asset";
}

function assetMeta(asset: TradeAsset): string {
  if (asset.kind === "player" && asset.player) {
    return `${asset.player.team} / ${displayPosition(asset.player.position)} / ${tradeContractSummaryLabel(asset.player)}`;
  }
  if (asset.kind === "cash") return formatMoney(Math.max(0, Number(asset.cashAmount ?? 0)));
  if (asset.pick?.asset_type === "generic_pick") {
    const convey = typeof asset.pick.convey_probability === "number" ? `${formatNumber(asset.pick.convey_probability * 100, 1)}% convey` : "EV";
    const expected = typeof asset.pick.expected_pick === "number" ? `xPick ${formatNumber(asset.pick.expected_pick, 1)}` : `Pick ${asset.pick.pick}`;
    const protection = asset.pick.protection && asset.pick.protection !== "unprotected" ? ` / ${asset.pick.protection}` : "";
    return `${convey} / ${expected}${protection}`;
  }
  if (asset.pick?.asset_type === "team_pick") {
    const convey = typeof asset.pick.convey_probability === "number" ? `${formatNumber(asset.pick.convey_probability * 100, 1)}% convey` : "EV";
    const expected = typeof asset.pick.expected_pick === "number" ? `xPick ${formatNumber(asset.pick.expected_pick, 1)}` : `Pick ${asset.pick.pick}`;
    const protection = asset.pick.protection && asset.pick.protection !== "unprotected" ? ` / ${asset.pick.protection}` : "";
    return `${asset.pick.origin_team ?? "Team"} / ${convey} / ${expected}${protection}`;
  }
  if (asset.pick?.asset_type === "pick_swap") {
    const positive = typeof asset.pick.convey_probability === "number" ? `${formatNumber(asset.pick.convey_probability * 100, 1)}% positive` : "Swap right";
    const protection = asset.pick.protection && asset.pick.protection !== "unprotected" ? ` / ${asset.pick.protection}` : "";
    return `${asset.pick.origin_team ?? "Team"} with ${asset.pick.counterparty_team ?? "Team"} / ${positive}${protection}`;
  }
  if (asset.pick) return `Pick ${asset.pick.pick} / Round ${asset.pick.round} / ${formatNumber(asset.pick.normalized, 2)} norm`;
  return "Asset";
}

function assetTotal(assets: TradeAsset[]): number {
  return assets.reduce((sum, asset) => sum + assetValue(asset), 0);
}

function parseTradeCashInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1_000_000)) : 0;
}

function tradeRoster(players: PlayerImpact[], team: string): PlayerImpact[] {
  return players
    .filter((player) => player.team === team)
    .sort((a, b) => playerTradeValue(b) - playerTradeValue(a) || b.total - a.total);
}

function filterTradeRoster(roster: PlayerImpact[], query: string): PlayerImpact[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return roster;
  return roster.filter((player) => {
    const haystack = [
      player.player_name,
      player.team,
      displayPosition(player.position),
      player.tier,
      player.contract_status,
      formatSalarySlot(player)
    ].join(" ").toLowerCase();
    return haystack.includes(clean);
  });
}

function tradeImpactSummary(assets: TradeAsset[]): TradeImpactSummary {
  return assets.reduce<TradeImpactSummary>((sum, asset) => {
    if (asset.kind !== "player" || !asset.player) return sum;
    const minuteShare = Number(asset.player.Minutes ?? 0) / TRADE_IMPACT_DENOMINATOR;
    return {
      offense: sum.offense + Number(asset.player.offense ?? 0) * minuteShare,
      defense: sum.defense + Number(asset.player.defense ?? 0) * minuteShare,
      total: sum.total + Number(asset.player.total ?? 0) * minuteShare,
      outgoingSalary: sum.outgoingSalary + (Number.isFinite(Number(asset.player.contract)) ? Number(asset.player.contract) : 0)
    };
  }, { offense: 0, defense: 0, total: 0, outgoingSalary: 0 });
}

function subtractTradeImpact(incoming: TradeImpactSummary, outgoing: TradeImpactSummary): TradeImpactSummary {
  return {
    offense: incoming.offense - outgoing.offense,
    defense: incoming.defense - outgoing.defense,
    total: incoming.total - outgoing.total,
    outgoingSalary: incoming.outgoingSalary - outgoing.outgoingSalary
  };
}

function emptyTradeImpactSummary(): TradeImpactSummary {
  return { offense: 0, defense: 0, total: 0, outgoingSalary: 0 };
}

function buildTradeRouteSummaries(sides: TradeSideState[], result: TradeMachineResult | null | undefined): TradeRouteSummary[] {
  const balances = new Map((result?.teamValueBalances ?? []).map((balance) => [cleanTeamValue(balance.team), balance]));
  const cbaResults = new Map((result?.teams ?? []).map((team) => [cleanTeamValue(team.team), team]));
  return sides.map((side) => {
    const sends = side.assets;
    const receives = tradeAssetsReceivedByTeam(sides, side.team);
    const outgoingImpact = tradeImpactSummary(sends);
    const incomingImpact = tradeImpactSummary(receives);
    const outgoingValue = assetTotal(sends);
    const incomingValue = assetTotal(receives);
    const outgoingSalary = tradeAssetSalaryTotal(sends);
    const incomingSalary = tradeAssetSalaryTotal(receives);
    return {
      team: side.team,
      sends,
      receives,
      outgoingValue,
      incomingValue,
      netValue: incomingValue - outgoingValue,
      outgoingSalary,
      incomingSalary,
      netSalary: incomingSalary - outgoingSalary,
      outgoingImpact,
      incomingImpact,
      netImpact: subtractTradeImpact(incomingImpact, outgoingImpact),
      modelBalance: balances.get(cleanTeamValue(side.team)) ?? null,
      cbaResult: cbaResults.get(cleanTeamValue(side.team)) ?? null
    };
  });
}

function buildTradeRouteLanes(sides: TradeSideState[]): TradeRouteLane[] {
  const lanes = new Map<string, TradeRouteLane>();
  sides.forEach((side) => {
    side.assets.forEach((asset) => {
      const toTeam = tradeAssetRouteDestination(asset, side, sides);
      const laneKey = `${cleanTeamValue(side.team)}|${cleanTeamValue(toTeam)}`;
      const existing = lanes.get(laneKey);
      const assets = [...(existing?.assets ?? []), asset];
      lanes.set(laneKey, {
        fromTeam: side.team,
        toTeam,
        assets,
        value: assetTotal(assets),
        salary: tradeAssetSalaryTotal(assets),
        impact: tradeImpactSummary(assets)
      });
    });
  });
  return Array.from(lanes.values()).sort((a, b) =>
    a.fromTeam.localeCompare(b.fromTeam) || a.toTeam.localeCompare(b.toTeam)
  );
}

function tradeAssetRouteDestination(asset: TradeAsset, side: TradeSideState, sides: TradeSideState[]): string {
  if (sides.length === 2) {
    return sides.find((item) => cleanTeamValue(item.team) !== cleanTeamValue(side.team))?.team ?? "Unassigned";
  }
  return asset.toTeam || "Unassigned";
}

function tradeAssetsReceivedByTeam(sides: TradeSideState[], team: string): TradeAsset[] {
  const target = cleanTeamValue(team);
  if (sides.length === 2) {
    return sides.find((side) => cleanTeamValue(side.team) !== target)?.assets ?? [];
  }
  return sides
    .filter((side) => cleanTeamValue(side.team) !== target)
    .flatMap((side) => side.assets.filter((asset) => cleanTeamValue(asset.toTeam) === target));
}

function tradeAssetSalaryTotal(assets: TradeAsset[]): number {
  return assets.reduce((sum, asset) => {
    if (asset.kind !== "player" || !asset.player) return sum;
    return sum + tradeSalaryForPlayer(asset.player);
  }, 0);
}

function routeAssetLabels(assets: TradeAsset[]): string[] {
  if (assets.length === 0) return ["None"];
  const labels = assets.slice(0, 3).map(assetLabel);
  if (assets.length > labels.length) labels.push(`+${assets.length - labels.length} more`);
  return labels;
}

function savedTradeScenarioTeamsLabel(scenario: SavedTradeScenario, teamMeta: Map<string, TeamProjection>): string {
  return savedTradeScenarioSides(scenario)
    .map((side) => teamLabel(side.team, teamMeta))
    .join(" / ");
}

function savedTradeScenarioAssetSummary(scenario: SavedTradeScenario): string {
  const summaries = savedTradeScenarioSides(scenario)
    .filter((side) => side.assets.length > 0)
    .map((side) => `${side.team}: ${routeAssetLabels(side.assets).join(", ")}`);
  return summaries.length > 0 ? summaries.join(" | ") : "No assets";
}

function savedTradeScenarioMeta(scenario: SavedTradeScenario): string {
  const sides = savedTradeScenarioSides(scenario);
  const assetCount = sides.reduce((sum, side) => sum + side.assets.length, 0);
  const teamLabel = `${sides.length}-team`;
  const assetLabel = `${assetCount} asset${assetCount === 1 ? "" : "s"}`;
  return `${teamLabel} / ${assetLabel}`;
}

function savedTradeScenarioStatusLabel(scenario: SavedTradeScenario): string {
  const snapshot = scenario.snapshot;
  if (!snapshot) return "Not evaluated";
  const verdict = snapshot.verdict ?? "Review";
  const cba = snapshot.cbaStatus ? tradeMachineStatusLabel(snapshot.cbaStatus as TradeMachineStatus) : "No CBA";
  const diff = typeof snapshot.valueDiff === "number" ? ` / ${formatMoney(snapshot.valueDiff)} diff` : "";
  const evaluated = snapshot.evaluatedAt ? ` / eval ${new Date(snapshot.evaluatedAt).toLocaleDateString()}` : "";
  return `${verdict} / ${cba}${diff}${evaluated}`;
}

function savedTradeScenarioStatusClass(scenario: SavedTradeScenario): "ok" | "warn" | "bad" | "neutral" {
  const snapshot = scenario.snapshot;
  if (!snapshot) return "neutral";
  if (snapshot.cbaStatus === "illegal" || snapshot.verdict === "Declined") return "bad";
  if (snapshot.cbaStatus === "warning" || snapshot.verdict === "Maybe") return "warn";
  if (snapshot.cbaStatus === "legal" && snapshot.verdict === "Accepted") return "ok";
  return "neutral";
}

function savedTradeScenarioSearchDisplayTerms(scenario: SavedTradeScenario, teamMeta: Map<string, TeamProjection>): string[] {
  return [
    scenario.name,
    scenario.userNote ?? "",
    savedTradeScenarioStatusLabel(scenario),
    savedTradeScenarioTeamsLabel(scenario, teamMeta),
    savedTradeScenarioAssetSummary(scenario),
    savedTradeScenarioMeta(scenario),
    scenario.snapshot?.note ?? "",
    ...savedTradeScenarioSides(scenario).flatMap((side) => [side.team, teamLabel(side.team, teamMeta), teamFullName(side.team, teamMeta)])
  ];
}

function savedScenarioFilterLabel(filter: SavedScenarioFilter): string {
  return SAVED_SCENARIO_FILTERS.find((item) => item.key === filter)?.label.toLowerCase() ?? "this filter";
}

function savedScenarioImportMergeNote(added: number, updated: number): string {
  const parts = [
    added > 0 ? `${added} added` : "",
    updated > 0 ? `${updated} updated` : ""
  ].filter(Boolean);
  return parts.length > 0 ? `Imported scenarios: ${parts.join(", ")}` : "No saved scenarios changed";
}

function tradeMachineRouteVerdictClass(verdict: TradeMachineValueVerdict | undefined): "ok" | "warn" | "bad" | "neutral" {
  if (verdict === "accepted") return "ok";
  if (verdict === "maybe") return "warn";
  if (verdict === "declined") return "bad";
  return "neutral";
}

function tradeMachineStatusClass(status: TradeMachineStatus | undefined): "ok" | "warn" | "bad" | "neutral" {
  if (status === "legal") return "ok";
  if (status === "warning") return "warn";
  if (status === "illegal") return "bad";
  return "neutral";
}

function tradeMachineShortStatusLabel(status: TradeMachineStatus | undefined): string {
  if (status === "legal") return "CBA legal";
  if (status === "warning") return "Review";
  if (status === "illegal") return "CBA block";
  return "No CBA";
}

function tradeMachineRouteDeficitLabel(balance: TradeMachineTeamValueBalance | null | undefined): string {
  if (!balance) return "Awaiting cap/value model";
  const basis = balance.imbalanceBasis === "scale_adjusted_value" ? "scale gap" : "value gap";
  if (balance.balanceDeficit <= TRADE_ACCEPTED_DIFF) return `Within model range (${basis})`;
  return `${basis} ${formatMoney(balance.balanceDeficit)}`;
}

function tradeMachineValueRepairHint(balance: TradeMachineTeamValueBalance): string {
  const basis = balance.imbalanceBasis === "scale_adjusted_value" ? "scale-adjusted value" : "trade value";
  return `Add about ${formatMoney(balance.balanceDeficit)} in ${basis} to ${balance.team}.`;
}

function tradeMachineRouteCbaLabel(result: TradeMachineTeamResult | null | undefined): string {
  if (!result) return "Awaiting cap model";
  const issue = result.checks.find((check) => check.status === "fail") ?? result.checks.find((check) => check.status === "warn");
  if (!issue) return `${tradeMachineApronLabel(result.apronAfter)} after trade`;
  return issue.detail;
}

function tradeIncomingImpactForTeam(sides: TradeSideState[], team: string): TradeImpactSummary {
  const target = cleanTeamValue(team);
  if (sides.length === 2) {
    const sender = sides.find((side) => cleanTeamValue(side.team) !== target);
    return sender ? tradeImpactSummary(sender.assets) : emptyTradeImpactSummary();
  }
  return tradeImpactSummary(
    sides
      .filter((side) => cleanTeamValue(side.team) !== target)
      .flatMap((side) => side.assets.filter((asset) => cleanTeamValue(asset.toTeam) === target))
  );
}

function tradeDestinationOptions(team: string, sides: TradeSideState[]): string[] {
  const source = cleanTeamValue(team);
  return sides.map((side) => side.team).filter((sideTeam) => cleanTeamValue(sideTeam) !== source);
}

function defaultTradeDestination(team: string, sides: TradeSideState[]): string | null {
  return tradeDestinationOptions(team, sides)[0] ?? null;
}

function withDefaultTradeDestination(asset: TradeAsset, team: string, sides: TradeSideState[]): TradeAsset {
  if (sides.length < 3) return asset;
  const destination = asset.toTeam && cleanTeamValue(asset.toTeam) !== cleanTeamValue(team)
    ? asset.toTeam
    : defaultTradeDestination(team, sides);
  return destination ? { ...asset, toTeam: destination } : asset;
}

function routeTradeSideAssetsToTeam(side: TradeSideState, toTeam: string): TradeSideState {
  return {
    ...side,
    assets: side.assets.map((asset) => ({ ...asset, toTeam }))
  };
}

function defaultThirdTradeTeam(teamOptions: TeamProjection[], leftTeam: string, rightTeam: string): string {
  const used = new Set([leftTeam, rightTeam].map(cleanTeamValue));
  return teamOptions.find((team) => !used.has(cleanTeamValue(team.team)))?.team ?? "";
}

function tradeVerdict(diff: number): TradeVerdict {
  if (diff <= TRADE_ACCEPTED_DIFF) return "Accepted";
  if (diff <= TRADE_MAYBE_DIFF) return "Maybe";
  return "Declined";
}

function verdictClass(verdict: TradeVerdict): "ok" | "warn" | "bad" {
  if (verdict === "Accepted") return "ok";
  if (verdict === "Maybe") return "warn";
  return "bad";
}

function whoSaysNoLabel(left: TradeSideState, right: TradeSideState, diff: number): string {
  if (diff <= TRADE_ACCEPTED_DIFF) return "Toss-up";
  const leftTotal = assetTotal(left.assets);
  const rightTotal = assetTotal(right.assets);
  return `${leftTotal > rightTotal ? left.team || "Team 1" : right.team || "Team 2"} says no`;
}

function teamLabel(team: string, teamMeta: Map<string, TeamProjection>): string {
  const meta = teamMeta.get(team);
  return meta?.team_abbr ?? team;
}

function teamFullName(team: string, teamMeta: Map<string, TeamProjection>): string {
  const meta = teamMeta.get(team);
  return meta?.team_name ?? team;
}

function describeFilterRule(rule: FilterRule): string {
  const fieldLabel = filterFields.find((field) => field.key === rule.key)?.label ?? rule.key;
  const operatorLabel = [...numericOperators, ...textOperators].find((operator) => operator.value === rule.operator)?.label ?? rule.operator;
  if (rule.operator === "between") return `${fieldLabel} between ${rule.value} and ${rule.valueTo}`;
  return `${fieldLabel} ${operatorLabel} ${rule.value}`;
}

function tradeContractSummary(player: PlayerImpact): { years: number; total: number } | null {
  const salaries = [
    tradeSalaryForPlayer(player),
    impactNumber(player, "projection_effective_contract_y1") ?? impactNumber(player, "projection_contract_y1"),
    impactNumber(player, "projection_effective_contract_y2") ?? impactNumber(player, "projection_contract_y2"),
    impactNumber(player, "projection_effective_contract_y3") ?? impactNumber(player, "projection_contract_y3")
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (salaries.length === 0) return null;
  return {
    years: salaries.length,
    total: salaries.reduce((sum, value) => sum + value, 0)
  };
}

function tradeContractSummaryLabel(player: PlayerImpact): string {
  const summary = tradeContractSummary(player);
  if (!summary) return formatSalarySlot(player);
  const years = `${summary.years} yr${summary.years === 1 ? "" : "s"}`;
  return `${formatSalarySlot(player)} / ${years}, ${formatMoney(summary.total)} rem`;
}

function tradeTeamMeta(team: string, teamMeta: Map<string, TeamProjection>): TeamProjection | null {
  return teamMeta.get(team) ?? null;
}

function passesFilterRules(player: PlayerImpact, rules: FilterRule[]): boolean {
  return rules.every((rule) => {
    if (!isImpactFilterKey(rule.key)) return true;
    const value = getPlayerSortValue(player, rule.key as FilterKey);
    const field = filterFields.find((item) => item.key === rule.key);
    if (field?.type === "number") return passesNumericRule(Number(value), rule);
    return passesTextRule(String(value ?? ""), rule);
  });
}

function describeDraftFilterRule(rule: FilterRule): string {
  const fieldLabel = draftFilterFields.find((field) => field.key === rule.key)?.label ?? rule.key;
  const operatorLabel = [...numericOperators, ...textOperators].find((operator) => operator.value === rule.operator)?.label ?? rule.operator;
  if (rule.operator === "between") return `${fieldLabel} between ${rule.value} and ${rule.valueTo}`;
  return `${fieldLabel} ${operatorLabel} ${rule.value}`;
}

function passesDraftFilterRules(prospect: DraftProspect, rules: FilterRule[]): boolean {
  return rules.every((rule) => {
    const value = getDraftSortValue(prospect, rule.key as DraftFilterKey);
    const field = draftFilterFields.find((item) => item.key === rule.key);
    if (field?.type === "number") return passesNumericRule(Number(value), rule);
    return passesTextRule(String(value ?? ""), rule);
  });
}

function passesTextRule(value: string, rule: FilterRule): boolean {
  const source = value.trim().toLowerCase();
  const target = rule.value.trim().toLowerCase();
  if (rule.operator === "equals") return source === target;
  return source.includes(target);
}

function passesNumericRule(value: number, rule: FilterRule): boolean {
  if (!Number.isFinite(value)) return false;
  const target = parseNumericToken(rule.value);
  if (!Number.isFinite(target)) return false;
  if (rule.operator === "gt") return value > target;
  if (rule.operator === "gte") return value >= target;
  if (rule.operator === "lt") return value < target;
  if (rule.operator === "lte") return value <= target;
  if (rule.operator === "between") {
    const high = parseNumericToken(rule.valueTo ?? "");
    if (!Number.isFinite(high)) return false;
    return value >= Math.min(target, high) && value <= Math.max(target, high);
  }
  return Math.abs(value - target) < 0.0001;
}

function parseNumericToken(token: string): number {
  const match = token.trim().match(/^(-?\$?[\d,.]+)\s*([mk])?$/i);
  if (!match) return Number.NaN;
  const base = Number(match[1].replace(/[$,]/g, ""));
  if (match[2]?.toLowerCase() === "m") return base * 1_000_000;
  if (match[2]?.toLowerCase() === "k") return base * 1_000;
  return base;
}

function cleanTeamValue(value?: string | null): string {
  const team = String(value ?? "").trim();
  return team ? team : "FA";
}

function buildTeamSkillRows(team: TeamProjection): TeamSkillProfileRow[] {
  return skillKeys
    .map((key) => {
      const value = Number(team[key] ?? 0);
      const safeValue = Number.isFinite(value) ? value : 0;
      return {
        key,
        label: skillLabels[key],
        value: safeValue,
        marker: clamp(Math.abs(safeValue) / 2.4, 0, 1) * 50,
        band: safeValue >= 0.8 ? "strength" : safeValue <= -0.8 ? "weakness" : "neutral"
      } satisfies TeamSkillProfileRow;
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function compareTeamContributors(a: PlayerImpact, b: PlayerImpact, key: TeamContributorSortKey, direction: SortDirection, teamMinutes: number): number {
  const aValue = getTeamContributorSortValue(a, key, teamMinutes);
  const bValue = getTeamContributorSortValue(b, key, teamMinutes);
  let result = 0;

  if (typeof aValue === "string" || typeof bValue === "string") {
    result = String(aValue ?? "").localeCompare(String(bValue ?? ""));
  } else {
    result = Number(aValue ?? Number.NEGATIVE_INFINITY) - Number(bValue ?? Number.NEGATIVE_INFINITY);
  }

  if (result === 0) {
    result = b.Minutes - a.Minutes || a.player_name.localeCompare(b.player_name);
  }

  return direction === "asc" ? result : -result;
}

function compareTeamProjectionUsage(a: PlayerImpact, b: PlayerImpact): number {
  return (
    teamProjectionMinutesRank(b) - teamProjectionMinutesRank(a) ||
    a.player_name.localeCompare(b.player_name) ||
    a.nba_id - b.nba_id
  );
}

function teamProjectionMinutesRank(player: PlayerImpact): number {
  const candidates = [player.lineup_adjusted_minutes, player.Minutes, player.projection_minutes_y1];
  for (const candidate of candidates) {
    const minutes = Number(candidate);
    if (Number.isFinite(minutes)) return minutes;
  }
  return 0;
}

function getTeamContributorSortValue(player: PlayerImpact, key: TeamContributorSortKey, teamMinutes: number): string | number {
  const share = teamMinutes > 0 ? player.Minutes / teamMinutes : 0;
  if (key === "player_name") return player.player_name;
  if (key === "share") return share;
  if (key === "offense_contribution") return player.offense * share * 5;
  if (key === "defense_contribution") return player.defense * share * 5;
  if (key === "total_contribution") return player.total * share * 5;
  return player.Minutes;
}

function displayPosition(position?: string | null): string {
  const raw = String(position ?? "").trim();
  if (!raw) return "UNK";
  return raw.split(/[/-]/)[0]?.trim() || "UNK";
}

function replacementPositionShareText(player: PlayerImpact): string {
  const shares: Array<[string, number | null | undefined]> = [
    ["PG", player.pg_share],
    ["SG", player.sg_share],
    ["SF", player.sf_share],
    ["PF", player.pf_share],
    ["C", player.c_share]
  ];
  const finiteShares = shares
    .map(([label, value]) => [label, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value > 0.005)
    .sort((a, b) => b[1] - a[1]);
  if (finiteShares.length === 0) return displayPosition(player.position);
  return finiteShares.map(([label, value]) => `${label} ${Math.round(value * 100)}%`).join(" / ");
}

function teamForProjectionScenario(player: PlayerImpact, scenario: TeamProjectionScenario): string {
  const isProjected = player.availability_status === "projected" || player.availability_status === "rookie_projection";
  if (!isProjected) return cleanTeamValue(player.team);
  const rosterStatus = player.projection_roster_status ?? "";
  const incumbentTeam = cleanTeamValue(player.incumbent_team ?? player.team);
  if (scenario === "guaranteed") return rosterStatus === "signed" || rosterStatus === "rookie_fa" ? incumbentTeam : "FA";
  if (scenario === "open_market") return cleanTeamValue(player.market_team ?? player.team);
  return cleanTeamValue(player.team_projection_base ?? player.team);
}

function comparePlayers(a: PlayerImpact, b: PlayerImpact, key: SortKey, direction: SortDirection): number {
  const aValue = getPlayerSortValue(a, key);
  const bValue = getPlayerSortValue(b, key);
  let result = 0;

  if (typeof aValue === "string" || typeof bValue === "string") {
    result = String(aValue ?? "").localeCompare(String(bValue ?? ""));
  } else {
    result = Number(aValue ?? Number.NEGATIVE_INFINITY) - Number(bValue ?? Number.NEGATIVE_INFINITY);
  }

  if (result === 0) {
    result = b.score - a.score || a.player_name.localeCompare(b.player_name);
  }

  return direction === "asc" ? result : -result;
}

function getPlayerSortValue(player: PlayerImpact, key: FilterKey): string | number | null | undefined {
  if (key === "position") return displayPosition(player.position);
  if (key === "future_value_4y") return futureValue4y(player);
  if (key === "future_scale_4y") return futureScale4y(player);
  if (key === "skill_total") return skillAggregateTotal(player);
  if (key === "skill_off") return skillAggregateOff(player);
  if (key === "skill_def") return skillAggregateDef(player);
  if (key === "scalability") return currentScale(player);
  if (key === "value_add") return currentValueAdd(player);
  return player[key as keyof PlayerImpact] as string | number | null | undefined;
}

function compareDraftProspects(a: DraftProspect, b: DraftProspect, key: DraftSortKey, direction: SortDirection): number {
  const aValue = getDraftSortValue(a, key);
  const bValue = getDraftSortValue(b, key);
  let result = 0;

  if (typeof aValue === "string" || typeof bValue === "string") {
    result = String(aValue ?? "").localeCompare(String(bValue ?? ""));
  } else {
    const aNumber = Number(aValue ?? Number.NEGATIVE_INFINITY);
    const bNumber = Number(bValue ?? Number.NEGATIVE_INFINITY);
    result = aNumber - bNumber;
  }

  if (result === 0) {
    result = a.rank_in_class - b.rank_in_class || a.player.localeCompare(b.player);
  }

  return direction === "asc" ? result : -result;
}

function getDraftSortValue(prospect: DraftProspect, key: DraftSortKey): string | number | boolean | null | undefined {
  const skill = draftSortSkill(key);
  if (skill) {
    return getProspectSkillValue(prospect, skill);
  }
  if (key === "position") return displayDraftPosition(prospect);
  if (key === "tier") return draftTierRank(draftTier(prospect));

  const value = prospect[key as keyof DraftProspect];
  return Array.isArray(value) ? null : value;
}

function displayDraftPosition(prospect: DraftProspect): string {
  return displayPosition(prospect.position);
}

function draftTier(prospect: DraftProspect): string {
  if (prospect.tier) return prospect.tier;
  const score = prospect.score;
  if (!Number.isFinite(score) || score < 0) return "Out";
  if (score >= 99.5) return "MVP";
  if (score >= 97) return "Superstar";
  if (score >= 94) return "Star";
  if (score >= 89) return "Elite Starter";
  if (score >= 79) return "Starter";
  if (score >= 69) return "Fringe Starter";
  if (score >= 59) return "Strong Bench";
  if (score >= 45) return "Bench";
  if (score >= 25) return "Deep Bench";
  return "Project";
}

function draftTierRank(tier: string): number {
  const index = impactTierOrder.indexOf(tier);
  return index === -1 ? impactTierOrder.length : index;
}

export default App;
