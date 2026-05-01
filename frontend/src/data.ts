import type {
  AppData,
  DraftProspect,
  DraftTrackerBoardScore,
  DraftTrackerBoardSummary,
  DraftTrackerProspectScore,
  Manifest,
  ModelSummary,
  PickAsset,
  PlayerImpact,
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
  const [manifest, players, teams, picks, prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary] = await Promise.all([
    loadJson<Manifest>("/data/manifest.json", cacheBust),
    loadJson<PlayerImpact[]>("/data/impact_players.json", cacheBust),
    loadJson<TeamProjection[]>("/data/team_projections.json", cacheBust),
    loadJson<PickAsset[]>("/data/pick_assets.json", cacheBust),
    loadJson<DraftProspect[]>("/data/draft_prospects.json", cacheBust),
    loadJson<DraftTrackerBoardSummary[]>("/data/draft_tracker_board_summary.json", cacheBust),
    loadJson<DraftTrackerBoardScore[]>("/data/draft_tracker_board_scores.json", cacheBust),
    loadJson<DraftTrackerProspectScore[]>("/data/draft_tracker_prospect_scores.json", cacheBust),
    loadJson<ModelSummary[]>("/data/draft_model_summary.json", cacheBust)
  ]);

  return { manifest, players, teams, picks, prospects, trackerBoardSummary, trackerBoardScores, trackerProspectScores, modelSummary };
}
