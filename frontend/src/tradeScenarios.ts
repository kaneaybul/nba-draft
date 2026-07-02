import type { PickAsset, PlayerImpact } from "./types";

export type TradeAsset = { kind: "player" | "pick" | "cash"; id: string; player?: PlayerImpact; pick?: PickAsset; cashAmount?: number; toTeam?: string | null };
export type TradeSideState = { team: string; assets: TradeAsset[] };
export type TradeCalendarState = { tradeDate: string; tradeDeadlineDate: string; regularSeasonEndDate: string };
export type SavedTradeScenarioSnapshot = {
  verdict?: string | null;
  cbaStatus?: string | null;
  valueDiff?: number | null;
  scaleDiff?: number | null;
  note?: string | null;
  evaluatedAt?: string | null;
};
export type SavedTradeScenario = {
  id: string;
  name: string;
  createdAt: string;
  userNote?: string;
  pinned?: boolean;
  left: TradeSideState;
  right: TradeSideState;
  third?: TradeSideState | null;
  calendar?: TradeCalendarState;
  snapshot?: SavedTradeScenarioSnapshot;
};
export type SavedScenarioFilter = "all" | "pinned" | "accepted" | "review" | "declined" | "unevaluated";
export type SavedScenarioSort = "newest" | "status" | "value_diff" | "name";
export type SavedTradeScenarioExportScope = {
  kind: "all" | "visible";
  filter?: SavedScenarioFilter;
  query?: string;
  sort?: SavedScenarioSort;
};
export type SavedTradeScenarioExportPayload = {
  version: 1;
  exportedAt: string;
  season: number;
  scope?: SavedTradeScenarioExportScope;
  scenarios: SavedTradeScenario[];
};
export type SavedTradeScenarioImportMergeResult = {
  scenarios: SavedTradeScenario[];
  added: number;
  updated: number;
};
export type SavedTradeScenarioDeleteResult = {
  scenarios: SavedTradeScenario[];
  deleted: SavedTradeScenario[];
};

export const DEFAULT_SAVED_SCENARIO_FILTER: SavedScenarioFilter = "all";
export const DEFAULT_SAVED_SCENARIO_SORT: SavedScenarioSort = "newest";
export const SAVED_TRADE_SCENARIO_LIMIT = 12;
export const SAVED_SCENARIO_FILTERS: { key: SavedScenarioFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pinned", label: "Pinned" },
  { key: "accepted", label: "Accepted" },
  { key: "review", label: "Review" },
  { key: "declined", label: "Declined" },
  { key: "unevaluated", label: "Unevaluated" }
];
export const SAVED_SCENARIO_SORTS: { key: SavedScenarioSort; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "status", label: "Status priority" },
  { key: "value_diff", label: "Largest gap" },
  { key: "name", label: "Name" }
];

export function hydrateTradeAsset(asset: TradeAsset, playerMap: Map<number, PlayerImpact>, pickMap: Map<string, PickAsset>): TradeAsset | null {
  if (asset.kind === "player") {
    const playerId = asset.player?.nba_id ?? Number(String(asset.id).replace("player-", ""));
    const player = playerMap.get(playerId) ?? asset.player;
    return player ? { kind: "player", id: `player-${player.nba_id}`, player, toTeam: asset.toTeam ?? null } : null;
  }
  if (asset.kind === "cash") {
    const amount = Math.max(0, Number(asset.cashAmount ?? 0));
    return amount > 0 ? { ...asset, kind: "cash", cashAmount: amount } : null;
  }
  const pickAssetId = asset.pick?.asset_id ?? pickAssetIdFromTradeAsset(asset.id, pickMap);
  const pick = pickMap.get(pickAssetId) ?? asset.pick;
  return pick ? { ...asset, kind: "pick", pick } : null;
}

function pickAssetIdFromTradeAsset(id: string, pickMap: Map<string, PickAsset>): string {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return "";
  if (pickMap.has(cleanId)) return cleanId;
  const withoutPrefix = cleanId.startsWith("pick-") ? cleanId.slice(5) : cleanId;
  if (pickMap.has(withoutPrefix)) return withoutPrefix;
  const matchingKey = Array.from(pickMap.keys())
    .sort((a, b) => b.length - a.length)
    .find((key) => withoutPrefix === key || withoutPrefix.startsWith(`${key}-`));
  return matchingKey ?? withoutPrefix;
}

export function hydrateTradeSide(side: TradeSideState, playerMap: Map<number, PlayerImpact>, pickMap: Map<string, PickAsset>): TradeSideState {
  return {
    team: side.team,
    assets: side.assets.map((asset) => hydrateTradeAsset(asset, playerMap, pickMap)).filter((asset): asset is TradeAsset => Boolean(asset))
  };
}

export function savedTradeScenarioSides(scenario: SavedTradeScenario): TradeSideState[] {
  return [scenario.left, scenario.right, ...(scenario.third ? [scenario.third] : [])];
}

export function duplicateSavedTradeScenario(
  scenario: SavedTradeScenario,
  options: { id?: string; createdAt?: string; existingNames?: Iterable<string> } = {}
): SavedTradeScenario {
  return {
    ...scenario,
    id: options.id ?? `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: savedTradeScenarioCopyName(scenario.name, options.existingNames),
    createdAt: options.createdAt ?? new Date().toISOString(),
    left: cloneTradeSide(scenario.left),
    right: cloneTradeSide(scenario.right),
    third: scenario.third ? cloneTradeSide(scenario.third) : null,
    calendar: scenario.calendar ? { ...scenario.calendar } : undefined,
    snapshot: scenario.snapshot ? { ...scenario.snapshot } : undefined
  };
}

export function savedTradeScenarioCopyName(name: string, existingNames: Iterable<string> | undefined): string {
  const cleanName = name.trim() || "Scenario";
  const taken = new Set(Array.from(existingNames ?? [], (item) => item.trim().toLowerCase()));
  let suffix = 1;
  let candidate = `${cleanName} copy`;
  while (taken.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${cleanName} copy ${suffix}`;
  }
  return candidate;
}

function cloneTradeSide(side: TradeSideState): TradeSideState {
  return {
    team: side.team,
    assets: side.assets.map(cloneTradeAsset)
  };
}

function cloneTradeAsset(asset: TradeAsset): TradeAsset {
  return {
    ...asset,
    player: asset.player ? { ...asset.player } : undefined,
    pick: asset.pick ? { ...asset.pick } : undefined
  };
}

export function savedTradeScenarioFilterKey(scenario: SavedTradeScenario): Exclude<SavedScenarioFilter, "all" | "pinned"> {
  const snapshot = scenario.snapshot;
  if (!snapshot) return "unevaluated";
  if (snapshot.cbaStatus === "illegal" || snapshot.verdict === "Declined") return "declined";
  if (snapshot.cbaStatus === "legal" && snapshot.verdict === "Accepted") return "accepted";
  return "review";
}

export function savedTradeScenarioFilterCounts(scenarios: SavedTradeScenario[]): Record<SavedScenarioFilter, number> {
  const counts: Record<SavedScenarioFilter, number> = {
    all: scenarios.length,
    pinned: 0,
    accepted: 0,
    review: 0,
    declined: 0,
    unevaluated: 0
  };
  scenarios.forEach((scenario) => {
    if (scenario.pinned) counts.pinned += 1;
    counts[savedTradeScenarioFilterKey(scenario)] += 1;
  });
  return counts;
}

export function savedTradeScenarioMatchesFilter(scenario: SavedTradeScenario, filter: SavedScenarioFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pinned") return scenario.pinned === true;
  return savedTradeScenarioFilterKey(scenario) === filter;
}

export function savedTradeScenarioMatchesQuery(scenario: SavedTradeScenario, query: string, extraTerms: string[] = []): boolean {
  const clean = query.trim().toLowerCase();
  if (!clean) return true;
  return savedTradeScenarioSearchText(scenario, extraTerms).includes(clean);
}

export function savedTradeScenarioViewIsDefault(filter: SavedScenarioFilter, query: string, sort: SavedScenarioSort): boolean {
  return filter === DEFAULT_SAVED_SCENARIO_FILTER && query.trim() === "" && sort === DEFAULT_SAVED_SCENARIO_SORT;
}

export function savedTradeScenarioViewSummary(
  visibleCount: number,
  totalCount: number,
  filter: SavedScenarioFilter,
  query: string,
  sort: SavedScenarioSort
): string {
  const cleanVisible = Math.max(0, Math.floor(visibleCount));
  const cleanTotal = Math.max(0, Math.floor(totalCount));
  if (cleanTotal === 0) return "No saved deals";
  const noun = cleanTotal === 1 ? "deal" : "deals";
  if (savedTradeScenarioViewIsDefault(filter, query, sort)) return `${cleanTotal} saved ${noun}`;
  if (cleanVisible === cleanTotal) return `Showing all ${cleanTotal} saved ${noun}`;
  return `Showing ${cleanVisible} of ${cleanTotal} saved ${noun}`;
}

export function sortSavedTradeScenarios(scenarios: SavedTradeScenario[], sort: SavedScenarioSort): SavedTradeScenario[] {
  return [...scenarios].sort((a, b) => compareSavedTradeScenarios(a, b, sort));
}

export function retainSavedTradeScenarios(scenarios: SavedTradeScenario[], limit = SAVED_TRADE_SCENARIO_LIMIT): SavedTradeScenario[] {
  const cleanLimit = Math.max(0, Math.floor(limit));
  if (cleanLimit === 0) return [];
  if (scenarios.length <= cleanLimit) return scenarios;
  const pinned = scenarios.filter((scenario) => scenario.pinned);
  if (pinned.length >= cleanLimit) return [...pinned].sort(newestSavedScenarioFirst).slice(0, cleanLimit);
  return [
    ...pinned,
    ...scenarios.filter((scenario) => !scenario.pinned).slice(0, cleanLimit - pinned.length)
  ];
}

export function upsertSavedTradeScenario(
  scenarios: SavedTradeScenario[],
  scenario: SavedTradeScenario,
  options: { limit?: number; match?: "id" | "name" } = {}
): SavedTradeScenario[] {
  const matchBy = options.match ?? "name";
  const existing = scenarios.find((item) => matchBy === "id" ? item.id === scenario.id : savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name));
  const merged = existing
    ? {
      ...scenario,
      id: existing.id,
      pinned: Boolean(existing.pinned || scenario.pinned)
    }
    : scenario;
  return retainSavedTradeScenarios(
    [merged, ...scenarios.filter((item) => item.id !== merged.id && savedScenarioNameKey(item.name) !== savedScenarioNameKey(merged.name))],
    options.limit
  );
}

export function restoreSavedTradeScenario(
  scenarios: SavedTradeScenario[],
  scenario: SavedTradeScenario,
  options: { limit?: number } = {}
): SavedTradeScenario[] {
  return restoreSavedTradeScenarios(scenarios, [scenario], options);
}

export function restoreSavedTradeScenarios(
  scenarios: SavedTradeScenario[],
  restored: SavedTradeScenario[],
  options: { limit?: number } = {}
): SavedTradeScenario[] {
  const restoredScenarios = restored.filter((scenario, index) =>
    restored.findIndex((item) => item.id === scenario.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name)) === index
  );
  return retainSavedTradeScenarios(
    [
      ...restoredScenarios,
      ...scenarios.filter((item) => !restoredScenarios.some((scenario) =>
        item.id === scenario.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name)
      ))
    ],
    options.limit
  );
}

export function clearVisibleSavedTradeScenarios(
  scenarios: SavedTradeScenario[],
  visible: SavedTradeScenario[],
  options: { includePinned?: boolean } = {}
): SavedTradeScenarioDeleteResult {
  const visibleIds = new Set(visible.map((scenario) => scenario.id));
  const deleted = scenarios.filter((scenario) => visibleIds.has(scenario.id) && (options.includePinned || !scenario.pinned));
  if (deleted.length === 0) return { scenarios, deleted };
  const deletedIds = new Set(deleted.map((scenario) => scenario.id));
  return {
    scenarios: scenarios.filter((scenario) => !deletedIds.has(scenario.id)),
    deleted
  };
}

export function mergeImportedSavedTradeScenarios(
  current: SavedTradeScenario[],
  imported: SavedTradeScenario[],
  options: { limit?: number } = {}
): SavedTradeScenario[] {
  return mergeImportedSavedTradeScenarioResult(current, imported, options).scenarios;
}

export function mergeImportedSavedTradeScenarioResult(
  current: SavedTradeScenario[],
  imported: SavedTradeScenario[],
  options: { limit?: number } = {}
): SavedTradeScenarioImportMergeResult {
  const mergedImports: SavedTradeScenario[] = [];
  imported.forEach((scenario) => {
    const existing = current.find((item) => item.id === scenario.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name));
    const merged = existing
      ? { ...scenario, id: existing.id, pinned: Boolean(existing.pinned || scenario.pinned) }
      : scenario;
    const duplicateIndex = mergedImports.findIndex((item) => item.id === merged.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(merged.name));
    if (duplicateIndex >= 0) mergedImports.splice(duplicateIndex, 1);
    mergedImports.push(merged);
  });
  const scenarios = retainSavedTradeScenarios([
    ...mergedImports,
    ...current.filter((scenario) => !mergedImports.some((importedScenario) =>
      importedScenario.id === scenario.id || savedScenarioNameKey(importedScenario.name) === savedScenarioNameKey(scenario.name)
    ))
  ], options.limit);
  return {
    scenarios,
    added: mergedImports.filter((scenario) => !current.some((item) => item.id === scenario.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name))).length,
    updated: mergedImports.filter((scenario) => current.some((item) => item.id === scenario.id || savedScenarioNameKey(item.name) === savedScenarioNameKey(scenario.name))).length
  };
}

export function buildSavedTradeScenarioExportPayload(
  scenarios: SavedTradeScenario[],
  options: { season: number; exportedAt?: string; scope?: SavedTradeScenarioExportScope }
): SavedTradeScenarioExportPayload {
  return {
    version: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    season: options.season,
    scope: options.scope,
    scenarios
  };
}

function compareSavedTradeScenarios(a: SavedTradeScenario, b: SavedTradeScenario, sort: SavedScenarioSort): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (sort === "name") return a.name.localeCompare(b.name) || newestSavedScenarioFirst(a, b);
  if (sort === "value_diff") return savedScenarioValueDiff(b) - savedScenarioValueDiff(a) || newestSavedScenarioFirst(a, b);
  if (sort === "status") return savedScenarioStatusRank(a) - savedScenarioStatusRank(b) || newestSavedScenarioFirst(a, b);
  return newestSavedScenarioFirst(a, b);
}

function newestSavedScenarioFirst(a: SavedTradeScenario, b: SavedTradeScenario): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.name.localeCompare(b.name);
}

function savedScenarioNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function savedScenarioValueDiff(scenario: SavedTradeScenario): number {
  const diff = Number(scenario.snapshot?.valueDiff ?? Number.NEGATIVE_INFINITY);
  return Number.isFinite(diff) ? diff : Number.NEGATIVE_INFINITY;
}

function savedScenarioStatusRank(scenario: SavedTradeScenario): number {
  const key = savedTradeScenarioFilterKey(scenario);
  if (key === "declined") return 0;
  if (key === "review") return 1;
  if (key === "unevaluated") return 2;
  return 3;
}

function savedTradeScenarioSearchText(scenario: SavedTradeScenario, extraTerms: string[]): string {
  const sideTerms = savedTradeScenarioSides(scenario).flatMap((side) => [
    side.team,
    ...side.assets.flatMap(savedTradeAssetSearchTerms)
  ]);
  const snapshot = scenario.snapshot;
  return [
    scenario.id,
    scenario.name,
    scenario.userNote ?? "",
    scenario.createdAt,
    scenario.pinned ? "pinned" : "",
    snapshot?.verdict ?? "",
    snapshot?.cbaStatus ?? "",
    snapshot?.note ?? "",
    snapshot?.evaluatedAt ?? "",
    String(snapshot?.valueDiff ?? ""),
    String(snapshot?.scaleDiff ?? ""),
    ...sideTerms,
    ...extraTerms
  ].join(" ").toLowerCase();
}

function savedTradeAssetSearchTerms(asset: TradeAsset): string[] {
  if (asset.kind === "player") {
    return [
      asset.id,
      asset.toTeam ?? "",
      asset.player?.player_name ?? "",
      asset.player?.team ?? "",
      asset.player?.position ?? "",
      asset.player?.tier ?? "",
      asset.player?.contract_status ?? ""
    ];
  }
  if (asset.kind === "pick") {
    return [
      asset.id,
      asset.toTeam ?? "",
      asset.pick?.asset_id ?? "",
      asset.pick?.label ?? "",
      asset.pick?.asset_type ?? "",
      asset.pick?.origin_team ?? "",
      asset.pick?.counterparty_team ?? "",
      asset.pick?.protection ?? "",
      String(asset.pick?.draft_year ?? ""),
      String(asset.pick?.round ?? "")
    ];
  }
  return [asset.id, asset.toTeam ?? "", "cash", "cash considerations", String(asset.cashAmount ?? "")];
}

export function normalizeSavedTradeScenarios(payload: unknown, playerMap: Map<number, PlayerImpact>, pickMap: Map<string, PickAsset>): SavedTradeScenario[] {
  const rawScenarios = Array.isArray(payload)
    ? payload
    : isPlainRecord(payload) && Array.isArray(payload.scenarios)
      ? payload.scenarios
      : isPlainRecord(payload) && Array.isArray(payload.savedScenarios)
        ? payload.savedScenarios
        : [];
  return rawScenarios
    .map((scenario, index) => normalizeSavedTradeScenario(scenario, index, playerMap, pickMap))
    .filter((scenario): scenario is SavedTradeScenario => Boolean(scenario));
}

function normalizeSavedTradeScenario(
  value: unknown,
  index: number,
  playerMap: Map<number, PlayerImpact>,
  pickMap: Map<string, PickAsset>
): SavedTradeScenario | null {
  if (!isPlainRecord(value)) return null;
  const left = normalizeSavedTradeSide(value.left, playerMap, pickMap);
  const right = normalizeSavedTradeSide(value.right, playerMap, pickMap);
  if (!left || !right) return null;
  const third = normalizeSavedTradeSide(value.third, playerMap, pickMap);
  const scenario: SavedTradeScenario = {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `trade-import-${Date.now()}-${index}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Imported scenario ${index + 1}`,
    createdAt: typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : new Date().toISOString(),
    userNote: typeof value.userNote === "string" && value.userNote.trim() ? value.userNote.trim() : undefined,
    pinned: value.pinned === true,
    left,
    right,
    third,
    calendar: normalizeSavedTradeCalendar(value.calendar),
    snapshot: normalizeSavedTradeSnapshot(value.snapshot)
  };
  return savedTradeScenarioSides(scenario).some((side) => side.assets.length > 0) ? scenario : null;
}

function normalizeSavedTradeSide(value: unknown, playerMap: Map<number, PlayerImpact>, pickMap: Map<string, PickAsset>): TradeSideState | null {
  if (!isPlainRecord(value) || typeof value.team !== "string" || !Array.isArray(value.assets)) return null;
  return hydrateTradeSide({
    team: value.team,
    assets: value.assets
      .map((asset, index) => normalizeSavedTradeAsset(asset, index))
      .filter((asset): asset is TradeAsset => Boolean(asset))
  }, playerMap, pickMap);
}

function normalizeSavedTradeAsset(value: unknown, index: number): TradeAsset | null {
  if (!isPlainRecord(value)) return null;
  const toTeam = typeof value.toTeam === "string" && value.toTeam.trim() ? value.toTeam : null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id : "";
  if (value.kind === "player") {
    const player = isPlainRecord(value.player) ? value.player as unknown as PlayerImpact : undefined;
    const playerId = player && typeof player.nba_id === "number" ? `player-${player.nba_id}` : "";
    const assetId = id || playerId;
    return assetId || player ? { kind: "player", id: assetId || `player-import-${index}`, player, toTeam } : null;
  }
  if (value.kind === "pick") {
    const pick = isPlainRecord(value.pick) ? value.pick as unknown as PickAsset : undefined;
    const pickId = pick && typeof pick.asset_id === "string" ? `pick-${pick.asset_id}` : "";
    const assetId = id || pickId;
    return assetId || pick ? { kind: "pick", id: assetId || `pick-import-${index}`, pick, toTeam } : null;
  }
  if (value.kind === "cash") {
    const cashAmount = Math.max(0, Math.round(Number(value.cashAmount ?? 0)));
    return cashAmount > 0 ? { kind: "cash", id: id || `cash-import-${index}`, cashAmount, toTeam } : null;
  }
  return null;
}

function normalizeSavedTradeCalendar(value: unknown): TradeCalendarState | undefined {
  if (!isPlainRecord(value)) return undefined;
  return {
    tradeDate: typeof value.tradeDate === "string" ? value.tradeDate : "",
    tradeDeadlineDate: typeof value.tradeDeadlineDate === "string" ? value.tradeDeadlineDate : "",
    regularSeasonEndDate: typeof value.regularSeasonEndDate === "string" ? value.regularSeasonEndDate : ""
  };
}

function normalizeSavedTradeSnapshot(value: unknown): SavedTradeScenarioSnapshot | undefined {
  if (!isPlainRecord(value)) return undefined;
  const snapshot: SavedTradeScenarioSnapshot = {};
  if (typeof value.verdict === "string" && value.verdict.trim()) snapshot.verdict = value.verdict;
  if (typeof value.cbaStatus === "string" && value.cbaStatus.trim()) snapshot.cbaStatus = value.cbaStatus;
  if (Number.isFinite(Number(value.valueDiff))) snapshot.valueDiff = Number(value.valueDiff);
  if (Number.isFinite(Number(value.scaleDiff))) snapshot.scaleDiff = Number(value.scaleDiff);
  if (typeof value.note === "string" && value.note.trim()) snapshot.note = value.note;
  if (typeof value.evaluatedAt === "string" && value.evaluatedAt.trim()) snapshot.evaluatedAt = value.evaluatedAt;
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
