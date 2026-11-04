import { withAssetPickValues, withAssetValueContext, type AssetValuationData } from "./assetValue";
import type {
  AppData,
  InjuryOutlookData,
  CapReviewData,
  CapTrackerData,
  DraftProspect,
  DraftTrackerBoardScore,
  DraftTrackerBoardSummary,
  DraftTrackerProspectScore,
  Manifest,
  ModelSummary,
  OffseasonTruthData,
  PickAsset,
  PlayerCareerHistoryRow,
  PlayerImpact,
  StaticDataDataset,
  TeamLineupRow,
  TeamProjection,
  TeamScheduleGame
} from "./types";

const jsonCache = new Map<string, Promise<unknown>>();

async function loadJson<T>(path: string, cacheBust?: string): Promise<T> {
  const cacheKey = cacheBust ? `${path}?v=${cacheBust}` : path;
  if (!cacheBust && jsonCache.has(cacheKey)) {
    return jsonCache.get(cacheKey) as Promise<T>;
  }

  const request = fetch(cacheKey, { cache: cacheBust ? "no-store" : path.endsWith("manifest.json") ? "no-cache" : "force-cache" }).then((response) => {
    if (!response.ok) {
      throw new Error(`Could not load ${path}: ${response.status}`);
    }
    return response.json() as Promise<T>;
  });

  if (!cacheBust) jsonCache.set(cacheKey, request);
  return request;
}

export async function loadAppData(cacheBust?: string): Promise<AppData> {
  const manifest = await loadJson<Manifest>("/data/manifest.json", cacheBust);
  if (isStaticManifest(manifest)) {
    return loadStaticInitialData(manifest, cacheBust);
  }
  return loadLegacyAppData(manifest, cacheBust);
}

export async function loadNewerAppData(current: Manifest): Promise<AppData | null> {
  const manifest = await loadJson<Manifest>("/data/manifest.json", String(Date.now()));
  const valuations = await loadAssetValuations(String(Date.now()));
  if (manifest.generated_at === current.generated_at && (!valuations || valuations.generated_at === current.valuation_generated_at)) return null;
  return isStaticManifest(manifest) ? loadStaticInitialData(manifest) : loadLegacyAppData(manifest);
}

export async function loadDataForView(data: AppData, view: string, season: number, cacheBust?: string): Promise<AppData> {
  if (!isStaticManifest(data.manifest)) return data;
  let next = data;

  const loadPlayers = async () => {
    if (hasSeasonRows(next.players, "year", season)) return;
    const [rawRows, capTracker, valuations] = await Promise.all([
      loadSeasonDataset<PlayerImpact>(next.manifest, "impact_players", season, cacheBust),
      next.capTracker ? Promise.resolve(next.capTracker) : loadOptionalSingleton<CapTrackerData>(next.manifest, "cap_tracker", cacheBust),
      loadAssetValuations(cacheBust, season)
    ]);
    const rows = withAssetValueContext(rawRows, capTracker, valuations);
    if (capTracker) next = { ...next, capTracker };
    if (rows.length > 0) next = { ...next, players: replaceSeasonRows(next.players, rows, "year", season) };
  };
  const loadTeams = async () => {
    if (hasSeasonRows(next.teams, "year", season)) return;
    const rows = await loadSeasonDataset<TeamProjection>(next.manifest, "team_projections", season, cacheBust);
    if (rows.length > 0) next = { ...next, teams: replaceSeasonRows(next.teams, rows, "year", season) };
  };
  const loadLineups = async () => {
    if (hasSeasonRows(next.lineups, "year", season)) return;
    const rows = await loadSeasonDataset<TeamLineupRow>(next.manifest, "team_lineups", season, cacheBust);
    if (rows.length > 0) next = { ...next, lineups: replaceSeasonRows(next.lineups, rows, "year", season) };
  };
  const loadSchedules = async () => {
    if (hasSeasonRows(next.schedules, "season", season)) return;
    const rows = await loadSeasonDataset<TeamScheduleGame>(next.manifest, "team_schedules", season, cacheBust);
    if (rows.length > 0) next = { ...next, schedules: replaceSeasonRows(next.schedules, rows, "season", season) };
  };
  const loadPicks = async () => {
    if (next.picks.length > 0) return;
    const [rawRows, valuations] = await Promise.all([
      loadSingletonDataset<PickAsset>(next.manifest, "pick_assets", cacheBust),
      loadAssetValuations(cacheBust)
    ]);
    const rows = withAssetPickValues(rawRows, valuations);
    if (rows.length > 0) next = { ...next, picks: rows };
  };
  const loadProspects = async () => {
    if (next.prospects.length > 0) return;
    const rows = await loadSingletonDataset<DraftProspect>(next.manifest, "draft_prospects", cacheBust);
    if (rows.length > 0) next = { ...next, prospects: rows };
  };
  const loadTracker = async () => {
    if (next.trackerBoardSummary.length > 0 || next.trackerProspectScores.length > 0) return;
    const [trackerBoardSummary, trackerBoardScores, trackerProspectScores] = await Promise.all([
      loadSingletonDataset<DraftTrackerBoardSummary>(next.manifest, "draft_tracker_board_summary", cacheBust),
      loadSingletonDataset<DraftTrackerBoardScore>(next.manifest, "draft_tracker_board_scores", cacheBust),
      loadSingletonDataset<DraftTrackerProspectScore>(next.manifest, "draft_tracker_prospect_scores", cacheBust)
    ]);
    next = { ...next, trackerBoardSummary, trackerBoardScores, trackerProspectScores };
  };
  const loadModelSummary = async () => {
    if (next.modelSummary.length > 0) return;
    const rows = await loadSingletonDataset<ModelSummary>(next.manifest, "draft_model_summary", cacheBust);
    if (rows.length > 0) next = { ...next, modelSummary: rows };
  };
  const loadOffseasonTruth = async () => {
    if (next.offseasonTruth) return;
    const offseasonTruth = await loadOptionalSingleton<OffseasonTruthData>(next.manifest, "offseason_truth", cacheBust);
    if (offseasonTruth) next = { ...next, offseasonTruth };
  };
  const loadCap = async () => {
    if (next.capTracker && next.capReview) return;
    const capTracker = next.capTracker ?? await loadOptionalSingleton<CapTrackerData>(next.manifest, "cap_tracker", cacheBust);
    const capReview = next.capReview ?? await loadOptionalSingleton<CapReviewData>(next.manifest, "cap_transaction_review", cacheBust);
    if (capTracker || capReview) next = { ...next, capTracker, capReview };
  };

  if (["impact", "lineups"].includes(view)) {
    await loadPlayers();
  } else if (view === "teams") {
    await Promise.all([loadPlayers(), loadTeams(), loadSchedules()]);
  } else if (view === "startingLineups") {
    await Promise.all([loadPlayers(), loadTeams(), loadLineups()]);
  } else if (view === "trade" || view === "tradeRecs") {
    await Promise.all([loadPlayers(), loadTeams(), loadPicks(), loadCap()]);
  } else if (view === "offseason") {
    await loadPlayers();
    await loadTeams();
    await loadPicks();
    await loadProspects();
    await loadOffseasonTruth();
    await loadCap();
  } else if (view === "capTracker") {
    await loadCap();
  } else if (view === "draft" || view === "draftElo") {
    await Promise.all([loadProspects(), loadModelSummary()]);
  } else if (view === "tracker") {
    await loadTracker();
  }

  return next;
}

export async function loadPlayerCareerHistory(manifest: Manifest, cacheBust?: string): Promise<PlayerCareerHistoryRow[]> {
  return loadSingletonDataset<PlayerCareerHistoryRow>(manifest, "impact_player_history", cacheBust);
}

export function manifestSeasons(manifest: Manifest, players: PlayerImpact[] = []): number[] {
  const seasons = isStaticManifest(manifest) ? manifest.static_data.seasons : [];
  const fallback = players.map((player) => player.year).filter(Number.isFinite);
  return Array.from(new Set([...seasons, ...fallback])).sort((a, b) => b - a);
}

export function latestManifestSeason(manifest: Manifest, players: PlayerImpact[] = []): number | null {
  return manifestSeasons(manifest, players)[0] ?? null;
}

function isStaticManifest(manifest: Manifest): manifest is Manifest & { static_data: NonNullable<Manifest["static_data"]> } {
  return Boolean(manifest.static_data && manifest.static_data.schema_version >= 2);
}

async function loadStaticInitialData(manifest: Manifest & { static_data: NonNullable<Manifest["static_data"]> }, cacheBust?: string): Promise<AppData> {
  const season = latestManifestSeason(manifest) ?? new Date().getFullYear();
  const [players, injuryOutlook, capTracker, valuations] = await Promise.all([
    loadSeasonDataset<PlayerImpact>(manifest, "impact_players", season, cacheBust),
    loadOptionalSingleton<InjuryOutlookData>(manifest, "injury_outlook", cacheBust),
    loadOptionalSingleton<CapTrackerData>(manifest, "cap_tracker", cacheBust),
    loadAssetValuations(cacheBust)
  ]);
  return emptyAppData({ ...manifest, valuation_generated_at: valuations?.generated_at }, {
    players: withAssetValueContext(players, capTracker, valuations), injuryOutlook, capTracker
  });
}

async function loadLegacyAppData(manifest: Manifest, cacheBust?: string): Promise<AppData> {
  const [players, teams, lineups, schedules, picks, prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary, offseasonTruth, capTracker, capReview] = await Promise.all([
    loadJson<PlayerImpact[]>("/data/impact_players.json", cacheBust),
    loadJson<TeamProjection[]>("/data/team_projections.json", cacheBust),
    loadJson<TeamLineupRow[]>("/data/team_lineups.json", cacheBust).catch(() => []),
    loadJson<TeamScheduleGame[]>("/data/team_schedules.json", cacheBust).catch(() => []),
    loadJson<PickAsset[]>("/data/pick_assets.json", cacheBust),
    loadJson<DraftProspect[]>("/data/draft_prospects.json", cacheBust),
    loadJson<DraftTrackerBoardSummary[]>("/data/draft_tracker_board_summary.json", cacheBust),
    loadJson<DraftTrackerBoardScore[]>("/data/draft_tracker_board_scores.json", cacheBust),
    loadJson<DraftTrackerProspectScore[]>("/data/draft_tracker_prospect_scores.json", cacheBust),
    loadJson<ModelSummary[]>("/data/draft_model_summary.json", cacheBust),
    loadJson<OffseasonTruthData>("/data/offseason_truth.json", cacheBust).catch(() => undefined),
    loadJson<CapTrackerData>("/data/cap_tracker.json", cacheBust).catch(() => undefined),
    loadJson<CapReviewData>("/data/cap_transaction_review.json", cacheBust).catch(() => undefined)
  ]);

  const normalized = applyOffseasonTruth(players, lineups, offseasonTruth);
  const injuryOutlook = await loadOptionalSingleton<InjuryOutlookData>(manifest, "injury_outlook", cacheBust);
  const valuations = await loadAssetValuations(cacheBust);
  return { manifest: { ...manifest, valuation_generated_at: valuations?.generated_at }, players: withAssetValueContext(normalized.players, capTracker, valuations), teams, lineups: normalized.lineups, schedules, picks: withAssetPickValues(picks, valuations), prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary, offseasonTruth, capTracker, capReview, injuryOutlook };
}

async function loadAssetValuations(cacheBust?: string, season?: number): Promise<AssetValuationData | undefined> {
  const data = await loadJson<AssetValuationData>("/data/asset_valuation.json", cacheBust ?? "current");
  if (data.method !== "peak4-payroll-0.8-v8" || data.history_version !== "v8") {
    throw new Error("The current asset valuation release is unavailable. Reload after the update finishes.");
  }
  if (season !== undefined && season !== data.season && data.seasons?.[String(season)]) {
    const entry = data.seasons[String(season)];
    const historical = await loadJson<AssetValuationData>(entry.path, cacheBust ?? data.generated_at);
    if (historical.method !== data.method || historical.history_version !== data.history_version
      || historical.season !== season || historical.observation_date !== entry.observation_date
      || historical.generated_at !== data.generated_at) {
      throw new Error("The dated asset valuation release is inconsistent. Reload after the update finishes.");
    }
    return historical;
  }
  return data;
}

function emptyAppData(manifest: Manifest, values: Partial<AppData> = {}): AppData {
  return {
    manifest,
    players: [],
    teams: [],
    lineups: [],
    schedules: [],
    picks: [],
    prospects: [],
    trackerBoardSummary: [],
    trackerBoardScores: [],
    trackerProspectScores: [],
    modelSummary: [],
    ...values
  };
}

async function loadSeasonDataset<T>(manifest: Manifest, datasetName: string, season: number, cacheBust?: string): Promise<T[]> {
  const dataset = manifest.static_data?.datasets[datasetName];
  const shard = dataset?.shards?.find((item) => Number(item.year) === season || Number(item.key) === season);
  if (shard) return loadJson<T[]>(`/data/${shard.file}`, cacheBust ?? shard.sha256);
  if (dataset?.strategy === "season") return [];
  return loadSingletonDataset<T>(manifest, datasetName, cacheBust).catch(() => []);
}

async function loadSingletonDataset<T>(manifest: Manifest, datasetName: string, cacheBust?: string): Promise<T[]> {
  const dataset = manifest.static_data?.datasets[datasetName];
  const file = singletonFile(dataset) ?? legacyFile(manifest, datasetName);
  if (!file) return [];
  return loadJson<T[]>(`/data/${file}`, cacheBust ?? dataset?.sha256);
}

async function loadOptionalSingleton<T>(manifest: Manifest, datasetName: string, cacheBust?: string): Promise<T | undefined> {
  const dataset = manifest.static_data?.datasets[datasetName];
  const file = singletonFile(dataset) ?? legacyFile(manifest, datasetName);
  if (!file) return undefined;
  return loadJson<T>(`/data/${file}`, cacheBust ?? dataset?.sha256).catch(() => undefined);
}

function singletonFile(dataset: StaticDataDataset | undefined): string | undefined {
  if (!dataset) return undefined;
  if (dataset.strategy === "singleton" && dataset.file) return dataset.file;
  return undefined;
}

function legacyFile(manifest: Manifest, datasetName: string): string | undefined {
  return manifest.datasets.find((item) => item.dataset === datasetName)?.file;
}

function hasSeasonRows<T extends Record<string, unknown>>(rows: T[], key: keyof T, season: number): boolean {
  return rows.some((row) => Number(row[key]) === season);
}

function replaceSeasonRows<T extends Record<string, unknown>>(current: T[], incoming: T[], key: keyof T, season: number): T[] {
  return [...current.filter((row) => Number(row[key]) !== season), ...incoming];
}

function applyOffseasonTruth(players: PlayerImpact[], lineups: TeamLineupRow[], truth?: OffseasonTruthData): { players: PlayerImpact[]; lineups: TeamLineupRow[] } {
  if (!truth) return { players, lineups };
  const playersByIdYear = new Map<string, PlayerImpact>();
  const normalizedPlayers = players.map((player) => {
    const row = truth.players[playerKey(player)];
    if (!row) return player;
    const currentTeam = cleanTeam(row.current_roster_team);
    const rightsTeam = cleanTeam(row.rights_team);
    const isActiveRoster = currentTeam !== "FA";
    const truthStatus = normalizeTruthStatus(row.contract_status, row.current_roster_team);
    const seasonContract = numberValue(player.contract);
    const hasSeasonContract = isActiveRoster && seasonContract !== null && seasonContract > 0;
    const status = hasSeasonContract ? normalizeSeasonContractStatus(player.contract_status, currentTeam) : truthStatus;
    const isContractControlled = isContractControlledStatus(status);
    const contract = hasSeasonContract ? seasonContract : (isContractControlled ? numberValue(row.guaranteed_salary) ?? 0 : player.contract ?? null);
    const normalized: PlayerImpact = {
      ...player,
      current_roster_team: currentTeam,
      rights_team: rightsTeam,
      bird_rights: row.bird_rights,
      cap_hold: row.cap_hold,
      cap_hold_type: row.cap_hold_type,
      guaranteed_salary: row.guaranteed_salary,
      dead_cap: row.dead_cap,
      waived_date: row.waived_date,
      roster_status_source: row.roster_status_source,
      team: isActiveRoster ? currentTeam : "FA",
      incumbent_team: rightsTeam !== "FA" ? rightsTeam : currentTeam,
      market_team: isActiveRoster ? currentTeam : "FA",
      team_projection_base: isActiveRoster ? currentTeam : "FA",
      projection_roster_status: projectionRosterStatus(status, contract),
      contract_status: status,
      contract,
      projection_effective_contract_y1: isContractControlled && !hasSeasonContract ? contract : player.projection_effective_contract_y1
    };
    playersByIdYear.set(`${normalized.year}-${normalized.nba_id}`, normalized);
    return normalized;
  });
  const normalizedLineups = lineups
    .map((lineup) => {
      const player = playersByIdYear.get(`${lineup.year}-${lineup.nba_id}`);
      if (!player) return lineup;
      const currentTeam = cleanTeam(player.current_roster_team);
      if (currentTeam === "FA") return null;
      return {
        ...lineup,
        team: currentTeam,
        contract_status: player.contract_status ?? lineup.contract_status
      };
    })
    .filter((lineup): lineup is TeamLineupRow => Boolean(lineup));
  return { players: normalizedPlayers, lineups: normalizedLineups };
}

function playerKey(player: PlayerImpact): string {
  return `${player.year}-${player.nba_id}-${player.player_name}`;
}

function cleanTeam(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase() || "FA";
}

function normalizeTruthStatus(status: string | null | undefined, currentTeam: string): PlayerImpact["contract_status"] {
  const value = String(status ?? "").trim();
  if (["Signed", "UFA", "RFA", "Player Option", "Team Option", "Non-Guaranteed", "Two-Way", "Rookie FA"].includes(value)) return value;
  return cleanTeam(currentTeam) === "FA" ? "UFA" : "Signed";
}

function normalizeSeasonContractStatus(status: string | null | undefined, currentTeam: string): PlayerImpact["contract_status"] {
  const value = String(status ?? "").trim();
  if (["Player Option", "Team Option", "Non-Guaranteed", "Two-Way"].includes(value)) return value;
  if (cleanTeam(currentTeam) === "FA") return value === "RFA" || value === "Rookie FA" ? value : "UFA";
  return "Signed";
}

function isContractControlledStatus(status: string | null | undefined): boolean {
  return ["Signed", "Player Option", "Team Option", "Non-Guaranteed", "Two-Way"].includes(String(status ?? "").trim());
}

function projectionRosterStatus(status: PlayerImpact["contract_status"], contract: number | null | undefined): PlayerImpact["projection_roster_status"] {
  if (status === "Two-Way") return "signed";
  if (isContractControlledStatus(status) && numberValue(contract) !== null && Number(contract) > 0) return "signed";
  if (status === "RFA") return "restricted";
  if (status === "Rookie FA") return "rookie_fa";
  return "open_market";
}

function numberValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
