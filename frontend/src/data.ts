import type {
  AppData,
  DraftProspect,
  DraftTrackerBoardScore,
  DraftTrackerBoardSummary,
  DraftTrackerProspectScore,
  Manifest,
  ModelSummary,
  CapReviewData,
  CapTrackerData,
  OffseasonTruthData,
  PickAsset,
  PlayerImpact,
  TeamLineupRow,
  TeamScheduleGame,
  TeamProjection
} from "./types";

async function loadJson<T>(path: string, cacheBust?: string): Promise<T> {
  const response = await fetch(cacheBust ? `${path}?v=${cacheBust}` : path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function loadAppData(cacheBust?: string): Promise<AppData> {
  const [manifest, players, teams, lineups, schedules, picks, prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary, offseasonTruth, capTracker, capReview] = await Promise.all([
    loadJson<Manifest>("/data/manifest.json", cacheBust),
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
  return { manifest, players: normalized.players, teams, lineups: normalized.lineups, schedules, picks, prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary, offseasonTruth, capTracker, capReview };
}

function applyOffseasonTruth(players: PlayerImpact[], lineups: TeamLineupRow[], truth?: OffseasonTruthData): { players: PlayerImpact[]; lineups: TeamLineupRow[] } {
  if (!truth) return { players, lineups };
  const playersByIdYear = new Map<string, PlayerImpact>();
  const normalizedPlayers = players.map((player) => {
    const row = truth.players[playerKey(player)];
    if (!row) return player;
    const status = normalizeTruthStatus(row.contract_status, row.current_roster_team);
    const currentTeam = cleanTeam(row.current_roster_team);
    const rightsTeam = cleanTeam(row.rights_team);
    const isActiveRoster = currentTeam !== "FA";
    const isContractControlled = status === "Signed" || status === "Player Option" || status === "Team Option" || status === "Non-Guaranteed";
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
      projection_roster_status: isContractControlled ? "signed" : status === "RFA" ? "restricted" : "open_market",
      contract_status: status,
      contract: isContractControlled ? row.guaranteed_salary : player.contract ?? null,
      projection_effective_contract_y1: isContractControlled ? row.guaranteed_salary : player.projection_effective_contract_y1
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
  if (["Signed", "UFA", "RFA", "Player Option", "Team Option", "Non-Guaranteed", "Rookie FA"].includes(value)) return value;
  return cleanTeam(currentTeam) === "FA" ? "UFA" : "Signed";
}
