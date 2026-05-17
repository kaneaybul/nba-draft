export type Manifest = {
  generated_at: string;
  note: string;
  datasets: Array<{ dataset: string; rows: number; file: string }>;
  static_data?: StaticDataManifest;
};

export type StaticDataShard = {
  key: string;
  year?: number;
  rows: number;
  file: string;
  bytes: number;
  sha256: string;
};

export type StaticDataDataset = {
  strategy: "season" | "singleton";
  rows: number;
  file?: string;
  bytes?: number;
  sha256?: string;
  shards?: StaticDataShard[];
};

export type StaticDataManifest = {
  schema_version: number;
  generated_at: string;
  max_asset_bytes: number;
  seasons: number[];
  draft_years: number[];
  initial_view: string;
  datasets: Record<string, StaticDataDataset>;
};

export type PlayerImpact = {
  nba_id: number;
  player_name: string;
  year: number;
  team: string;
  current_roster_team?: string | null;
  roster_truth_team?: string | null;
  roster_truth_pulled_at?: string | null;
  rights_team?: string | null;
  bird_rights?: "Bird" | "Early Bird" | "Non-Bird" | "None" | string | null;
  cap_hold?: number | null;
  cap_hold_type?: string | null;
  guaranteed_salary?: number | null;
  dead_cap?: number | null;
  waived_date?: string | null;
  roster_status_source?: string | null;
  incumbent_team?: string | null;
  market_team?: string | null;
  team_projection_base?: string | null;
  projection_roster_status?: string | null;
  position: string;
  age?: number | null;
  yoe?: number | null;
  games?: number | null;
  Minutes: number;
  p_mpg?: number | null;
  p_usg?: number | null;
  o_epm?: number | null;
  o_dpm?: number | null;
  d_epm?: number | null;
  d_dpm?: number | null;
  off_dep: number;
  def_dep: number;
  offense: number;
  defense: number;
  total: number;
  replacement_total?: number | null;
  score: number;
  score_label?: string | null;
  score_delta?: number | null;
  tier: string;
  availability_status?: string | null;
  availability_reason?: string | null;
  skill_source?: string | null;
  skill_source_year?: number | null;
  timin: number;
  season_value?: number | null;
  raw_minutes?: number | null;
  raw_timin?: number | null;
  value: number;
  contract?: number | null;
  contract_status?: string | null;
  value_add?: number | null;
  trade_value: number;
  fa_value: number;
  fa_raw_value?: number | null;
  fa_uncapped_value?: number | null;
  fa_min_salary?: number | null;
  fa_max_salary?: number | null;
  fa_market_adjustment?: number | null;
  fa_projected_timin?: number | null;
  fa_missing_roster_slots?: number | null;
  fa_is_max?: boolean | null;
  fa_max_tier?: string | null;
  scalability: number;
  skill_model_off?: number | null;
  skill_model_def?: number | null;
  skill_off_total?: number | null;
  skill_def_total?: number | null;
  FTD?: number | null;
  OREB?: number | null;
  PASS?: number | null;
  RIM?: number | null;
  SHOOT?: number | null;
  DPM?: number | null;
  DREB?: number | null;
  RIMPRO?: number | null;
  SWITCH?: number | null;
  projection_y1: number;
  projection_y2: number;
  projection_y3: number;
  projection_y4: number;
  projection_y5?: number | null;
  projection_games_y1?: number | null;
  projection_games_y2?: number | null;
  projection_games_y3?: number | null;
  projection_games_y4?: number | null;
  projection_games_y5?: number | null;
  projection_mpg_y1?: number | null;
  projection_mpg_y2?: number | null;
  projection_mpg_y3?: number | null;
  projection_mpg_y4?: number | null;
  projection_mpg_y5?: number | null;
  projection_minutes_y1?: number | null;
  projection_minutes_y2?: number | null;
  projection_minutes_y3?: number | null;
  projection_minutes_y4?: number | null;
  projection_minutes_y5?: number | null;
  projection_offense_y1?: number | null;
  projection_offense_y2?: number | null;
  projection_offense_y3?: number | null;
  projection_offense_y4?: number | null;
  projection_offense_y5?: number | null;
  projection_defense_y1?: number | null;
  projection_defense_y2?: number | null;
  projection_defense_y3?: number | null;
  projection_defense_y4?: number | null;
  projection_defense_y5?: number | null;
  projection_skill_model_off_y1?: number | null;
  projection_skill_model_off_y2?: number | null;
  projection_skill_model_off_y3?: number | null;
  projection_skill_model_off_y4?: number | null;
  projection_skill_model_off_y5?: number | null;
  projection_skill_model_def_y1?: number | null;
  projection_skill_model_def_y2?: number | null;
  projection_skill_model_def_y3?: number | null;
  projection_skill_model_def_y4?: number | null;
  projection_skill_model_def_y5?: number | null;
  projection_timin_y1?: number | null;
  projection_timin_y2?: number | null;
  projection_timin_y3?: number | null;
  projection_timin_y4?: number | null;
  projection_timin_y5?: number | null;
  projection_value_y1?: number | null;
  projection_value_y2?: number | null;
  projection_value_y3?: number | null;
  projection_value_y4?: number | null;
  projection_value_y5?: number | null;
  projection_fa_value_y1?: number | null;
  projection_fa_value_y2?: number | null;
  projection_fa_value_y3?: number | null;
  projection_fa_value_y4?: number | null;
  projection_fa_value_y5?: number | null;
  projection_scalability_y1?: number | null;
  projection_scalability_y2?: number | null;
  projection_scalability_y3?: number | null;
  projection_scalability_y4?: number | null;
  projection_scalability_y5?: number | null;
  projection_contract_y1?: number | null;
  projection_contract_y2?: number | null;
  projection_contract_y3?: number | null;
  projection_contract_y4?: number | null;
  projection_contract_y5?: number | null;
  projection_effective_contract_y1?: number | null;
  projection_effective_contract_y2?: number | null;
  projection_effective_contract_y3?: number | null;
  projection_effective_contract_y4?: number | null;
  projection_effective_contract_y5?: number | null;
  projection_contract_source_y1?: string | null;
  projection_contract_source_y2?: string | null;
  projection_contract_source_y3?: string | null;
  projection_contract_source_y4?: string | null;
  projection_contract_source_y5?: string | null;
  projection_cap_y1?: number | null;
  projection_cap_y2?: number | null;
  projection_cap_y3?: number | null;
  projection_cap_y4?: number | null;
  projection_cap_y5?: number | null;
  lineup_original_minutes?: number | null;
  lineup_adjusted_minutes?: number | null;
  lineup_role?: string | null;
  lineup_role_order?: number | null;
  lineup_role_band_minutes?: number | null;
  source_note?: string;
};

export type PlayerCareerHistoryRow = {
  nba_id: number;
  player_name: string;
  year: number;
  total: number;
  value_add?: number | null;
  Minutes?: number | null;
};

export type TeamProjection = {
  scenario_id?: string | null;
  scenario_label?: string | null;
  year: number;
  team: string;
  team_name: string;
  team_abbr: string;
  team_logo_url?: string | null;
  conference: string;
  roster_count: number;
  minutes: number;
  minutes_coverage?: number | null;
  raw_offense: number;
  raw_defense: number;
  raw_total: number;
  adjusted_total: number;
  offense: number;
  defense: number;
  total: number;
  win_units: number;
  projected_wins: number;
  projected_losses: number;
  win_pct: number;
  expected_wins: number;
  expected_losses: number;
  actual_wins?: number | null;
  actual_losses?: number | null;
  remaining_games?: number | null;
  playoff_projected_wins?: number | null;
  playoff_projected_losses?: number | null;
  playoff_actual_wins?: number | null;
  playoff_actual_losses?: number | null;
  league_rank: number;
  rank: number;
  conference_rank: number;
  playoff_status: "Playoff" | "Play-In" | "Lottery" | string;
  FTD?: number | null;
  OREB?: number | null;
  PASS?: number | null;
  RIM?: number | null;
  SHOOT?: number | null;
  DPM?: number | null;
  DREB?: number | null;
  RIMPRO?: number | null;
  SWITCH?: number | null;
};

export type TeamScheduleGame = {
  season: number;
  season_type: "Regular Season" | "Playoffs" | string;
  date: string;
  time?: string | null;
  home_team: string;
  away_team: string;
  home_score?: number | null;
  away_score?: number | null;
  home_win_probability?: number | null;
  away_win_probability?: number | null;
  result?: string | null;
  selected_team_location?: string | null;
  arena?: string | null;
  notes?: string | null;
  is_completed: boolean;
};

export type TeamLineupRow = {
  scenario_id?: string | null;
  scenario_label?: string | null;
  year: number;
  team: string;
  team_name: string;
  team_abbr: string;
  team_logo_url?: string | null;
  conference: string;
  role_order: number;
  role_label: string;
  role_type: "Starter" | "Bench" | string;
  position_group: "Guard" | "Forward" | "Center" | "Bench" | string;
  role_band_minutes: number;
  lineup_rank: number;
  is_starter: boolean;
  nba_id: number;
  player_name: string;
  position: string;
  original_minutes: number;
  adjusted_minutes: number;
  minutes_delta: number;
  games?: number | null;
  mpg?: number | null;
  offense: number;
  defense: number;
  total: number;
  score: number;
  tier: string;
  role_score: number;
  contract_status?: string | null;
};

export type PickAsset = {
  asset_id: string;
  label: string;
  pick: number;
  round: number;
  normalized: number;
  value: number;
  asset_type?: "slot_value" | "team_pick" | "pick_swap" | string | null;
  origin_team?: string | null;
  draft_year?: number | null;
  protection?: string | null;
  protection_cutoff?: number | null;
  counterparty_team?: string | null;
  convey_probability?: number | null;
  expected_pick?: number | null;
  training_n?: number | null;
};

export type DraftProspect = {
  player: string;
  draft_year: number;
  rank_in_class: number;
  base_rank_in_class?: number | null;
  score: number;
  prediction_pool: string;
  tier?: string | null;
  scv_draft?: number | null;
  draft_age?: number | null;
  height_wo_shoes_in?: number | null;
  wingspan_in?: number | null;
  weight_lbs?: number | null;
  pos_code?: number | null;
  position?: string | null;
  replacement_total?: number | null;
  timin?: number | null;
  college?: string | null;
  pre_draft_team?: string | null;
  FTD_pred?: number | null;
  OREB_pred?: number | null;
  PASS_pred?: number | null;
  RIM_pred?: number | null;
  SHOOT_pred?: number | null;
  DPM_pred?: number | null;
  DREB_pred?: number | null;
  RIMPRO_pred?: number | null;
  SWITCH_pred?: number | null;
  OFF_pred: number;
  DEF_pred: number;
  TOTAL_pred: number;
  similarity_comp_player?: string | null;
  similarity_comp_year?: number | null;
  similarity_score?: number | null;
  similarity_distance?: number | null;
  similarity_comp_total?: number | null;
  similarity_comp_off?: number | null;
  similarity_comp_def?: number | null;
  similarity_comp_minutes?: number | null;
  actual_pick?: number | null;
  drafted_team?: string | null;
  pick_proxy?: number | null;
  pick_proxy_available?: boolean | null;
  age_feature?: number | null;
  pick_feature?: number | null;
  adjustment_age_component?: number | null;
  adjustment_pick_component?: number | null;
  adjustment_total_component?: number | null;
  adjustment_off_component?: number | null;
  adjustment_def_component?: number | null;
  adjustment_FTD_component?: number | null;
  adjustment_OREB_component?: number | null;
  adjustment_PASS_component?: number | null;
  adjustment_RIM_component?: number | null;
  adjustment_SHOOT_component?: number | null;
  adjustment_DPM_component?: number | null;
  adjustment_DREB_component?: number | null;
  adjustment_RIMPRO_component?: number | null;
  adjustment_SWITCH_component?: number | null;
  tracker_adjustment_version?: string | null;
};

export type ModelSummary = {
  skill: string;
  model_type: string;
  train_r2_pct?: number | null;
  temporal_r2?: number | null;
  temporal_mse?: number | null;
  validation_quality_flag?: string | null;
  top_variable?: string | null;
  predictors?: string | null;
};

export type DraftTrackerBoardSummary = {
  board: string;
  weighted_score?: number | null;
  weighted_z?: number | null;
  years?: number | null;
};

export type DraftTrackerBoardScore = {
  draft_year: number;
  board: string;
  score?: number | null;
  year_weight?: number | null;
  z_score?: number | null;
};

export type DraftTrackerProspectScore = {
  draft_year: number;
  board: string;
  display_board?: string | null;
  model_group?: "current" | "base" | "legacy" | "external" | string | null;
  player: string;
  nba_id?: number | null;
  actual_pick?: number | null;
  college?: string | null;
  actual_rank?: number | null;
  actual_weight?: number | null;
  career_minutes?: number | null;
  actual_impact?: number | null;
  actual_score?: number | null;
  board_rank?: number | null;
  eval_rank?: number | null;
  rank_error?: number | null;
  correct_pct?: number | null;
  weighted_score_contribution?: number | null;
  board_year_score?: number | null;
  board_year_z?: number | null;
};

export type OffseasonPlayerTruth = {
  key: string;
  nba_id?: number | null;
  player_name: string;
  year: number;
  current_roster_team: string;
  rights_team: string;
  bird_rights: "Bird" | "Early Bird" | "Non-Bird" | "None" | string;
  cap_hold: number;
  cap_hold_type: string;
  guaranteed_salary: number;
  dead_cap: number;
  waived_date?: string | null;
  roster_status_source: string;
  contract_status?: string | null;
  contract_status_source?: string | null;
  signed_using?: string | null;
  free_agent_status?: string | null;
};

export type OffseasonTeamCapSheet = {
  year: number;
  team: string;
  active_salary: number;
  guaranteed_salary: number;
  dead_cap: number;
  cap_holds: number;
  roster_charges: number;
  practical_cap_space: number;
  maximum_cap_space: number;
  tax_room: number;
  first_apron_room: number;
  second_apron_room: number;
  active_roster_count: number;
  hold_count: number;
  cap_validation_delta?: number | null;
  validation_source?: string | null;
};

export type OffseasonTruthData = {
  generated_at: string;
  source_policy: string;
  notes: string[];
  players: Record<string, OffseasonPlayerTruth>;
  team_caps: OffseasonTeamCapSheet[];
  stale_roster_conflicts: Array<{ player: string; team: string; issue: string; source: string }>;
};

export type CapTrackerMoneySource = "contract" | "bref-option" | "spotrac" | "override" | "estimated" | "projected" | "unavailable";
export type CapTrackerCellKind =
  | "guaranteed"
  | "partial_guarantee"
  | "player_option"
  | "team_option"
  | "non_guaranteed"
  | "draft_pick"
  | "cap_hold"
  | "dead"
  | "empty";

export type CapTrackerSeason = {
  year: number;
  label: string;
  salary_cap: number;
  tax_level: number;
  first_apron: number;
  second_apron: number;
  salary_floor: number;
  minimum_roster_charge: number;
  source: string;
  source_quality: CapTrackerMoneySource;
};

export type CapTrackerContractCell = {
  year: number;
  amount: number;
  kind: CapTrackerCellKind;
  status: string;
  source: CapTrackerMoneySource;
  label?: string | null;
  note?: string | null;
  guaranteed_amount?: number | null;
  unguaranteed_amount?: number | null;
  guarantee_deadline?: string | null;
  guarantee_note?: string | null;
  guarantee_source?: "contract_notes" | "override" | "unavailable" | string | null;
};

export type CapTrackerContractRow = {
  id: string;
  nba_id?: number | null;
  player_name: string;
  team: string;
  row_type: "player" | "draft_pick" | "dead_money";
  display_order: number;
  position?: string | null;
  age?: number | null;
  rank?: number | null;
  contract_notes?: string | null;
  source: string;
  source_quality: CapTrackerMoneySource;
  cells: CapTrackerContractCell[];
};

export type CapTrackerTeamSeason = {
  team: string;
  year: number;
  guaranteed_salary: number;
  guaranteed_base_salary?: number;
  at_risk_salary?: number;
  option_salary: number;
  non_guaranteed_salary: number;
  salary_on_books: number;
  draft_pick_charges: number;
  active_salary: number;
  dead_money: number;
  cap_holds: number;
  roster_charges_with_holds: number;
  roster_charges_renounced: number;
  tax_salary?: number;
  apron_salary?: number;
  team_salary_with_holds?: number;
  team_salary_renounced?: number;
  likely_books_with_holds: number;
  likely_books_renounced: number;
  cap_room_with_holds: number;
  cap_room_renounced: number;
  room_if_holds_retained: number;
  room_if_renounced: number;
  tax_room: number;
  first_apron_room: number;
  second_apron_room: number;
  tax_room_with_holds: number;
  tax_room_renounced: number;
  first_apron_room_with_holds: number;
  first_apron_room_renounced: number;
  second_apron_room_with_holds: number;
  second_apron_room_renounced: number;
  salary_floor_room: number;
  roster_count: number;
  hold_count: number;
  status_band: string;
  status_band_with_holds?: string;
  status_band_renounced?: string;
  tax_status_band?: string;
  apron_status_band?: string;
  sandbox_dead_money_added?: number;
  source_quality: CapTrackerMoneySource;
};

export type CapTrackerException = {
  id: string;
  team: string;
  year: number;
  name: string;
  amount: number;
  path: "retained" | "renounced" | "override" | string;
  expires?: string | null;
  note?: string | null;
  source: string;
  source_quality?: CapTrackerMoneySource;
};

export type CapTrackerPick = {
  id: string;
  team: string;
  year: number;
  round: number;
  label: string;
  protection?: string | null;
  source: string;
  source_quality: CapTrackerMoneySource;
};

export type CapTrackerDeadMoney = {
  id: string;
  canonical_key?: string;
  event_key?: string | null;
  transaction_key?: string | null;
  effective_date?: string | null;
  team: string;
  year: number;
  player_name: string;
  amount: number;
  note?: string | null;
  source: string;
  source_quality?: CapTrackerMoneySource;
};

export type CapTrackerMaxContractLevel = {
  year: number;
  tier: "25%" | "30%" | "35%";
  first_year_salary: number;
  four_year_non_bird_total: number;
  five_year_bird_total: number;
};

export type CapTrackerTeam = {
  team: string;
  team_name: string;
  team_abbr: string;
  conference?: string | null;
  team_logo_url?: string | null;
};

export type CapTrackerData = {
  schema_version?: number;
  generated_at: string;
  source_policy: string;
  notes: string[];
  seasons: CapTrackerSeason[];
  teams: CapTrackerTeam[];
  team_seasons: CapTrackerTeamSeason[];
  contracts: CapTrackerContractRow[];
  exceptions: CapTrackerException[];
  picks: CapTrackerPick[];
  dead_money: CapTrackerDeadMoney[];
  max_contracts: CapTrackerMaxContractLevel[];
  validation_summary?: {
    duplicate_contract_ids: number;
    duplicate_team_seasons: number;
    duplicate_dead_money_rows: number;
    team_season_rows_expected: number;
    team_season_rows_actual: number;
  };
  warnings?: string[];
  source_audit: Array<{ label: string; detail: string; quality: CapTrackerMoneySource }>;
};

export type CapSandboxDecisionAction =
  | "retain"
  | "renounce"
  | "exercise"
  | "decline"
  | "accept"
  | "keep"
  | "waive_before_guarantee"
  | "remove";

export type CapSandboxDecision = {
  id: string;
  team: string;
  row_id: string;
  year: number;
  action: CapSandboxDecisionAction;
  created_at: string;
};

export type CapSandboxScenario = {
  id: string;
  name: string;
  team: string;
  created_at: string;
  updated_at: string;
  decisions: Record<string, CapSandboxDecision>;
};

export type SandboxTeamSeason = CapTrackerTeamSeason & {
  base_likely_books_with_holds?: number;
  base_likely_books_renounced?: number;
  sandbox_dead_money_added?: number;
};

export type SandboxException = CapTrackerException & {
  sandbox?: boolean;
};

export type CapReviewRow = {
  transaction_key: string;
  transaction_date: string;
  source: string;
  source_url: string;
  reference_url: string;
  nba_id?: string | null;
  player_name: string;
  team_from?: string | null;
  team_to?: string | null;
  transaction_type: string;
  raw_text: string;
  classification: string;
  confidence: string;
  recommended_action: string;
  affected_files: string;
  contract_delta?: string | null;
  salary_resolution_status?: "exact" | "reconciled" | "estimated" | "needs_research" | string;
  salary_source?: string | null;
  salary_source_url?: string | null;
  suggested_amount?: string | number | null;
  approved_amount?: string | number | null;
  source_quality?: CapTrackerMoneySource | string | null;
  resolution_note?: string | null;
  conflict_note?: string | null;
  applied_at?: string | null;
  applied_key?: string | null;
  applied_amount?: string | number | null;
  last_error?: string | null;
  status: "pending_review" | "needs_amount" | "approved" | "rejected" | "needs_research" | "applied" | string;
};

export type CapReviewData = {
  generated_at: string;
  source_policy?: string;
  resolution_summary?: Record<string, number>;
  review_summary?: {
    total: number;
    by_status: Record<string, number>;
    by_resolution: Record<string, number>;
    by_classification: Record<string, number>;
    by_team: Record<string, number>;
  };
  rows: CapReviewRow[];
};

export type MarketToolKind = "cap" | "bird" | "mle" | "room" | "minimum";

export type MarketLedgerStatus =
  | "submitted"
  | "rejected"
  | "shortlisted"
  | "won"
  | "outbid"
  | "matched"
  | "declined"
  | "withdrawn"
  | "unresolved";

export type MarketComponentBreakdown = {
  salary: number;
  totalGuarantee: number;
  roleFit: number;
  timeline: number;
  familiarity: number;
  willingness: number;
  taxDrag: number;
  scarcity: number;
  security: number;
  closeOfferAdjustment: number;
  randomness: number;
  total: number;
};

export type MarketBid = {
  id: string;
  round: number;
  tier: string;
  team: string;
  playerId: string;
  player: string;
  tool: string;
  toolKind: MarketToolKind;
  submittedAav: number;
  years: number;
  legalMax: number;
  teamPriority: number;
  teamUtility: number;
  playerUtility: number;
  components: MarketComponentBreakdown;
  capSnapshot: {
    capSpace: number;
    heldCapSpace?: number;
    renouncedCapSpace?: number;
    taxRoom: number;
    firstApronRoom: number;
    secondApronRoom: number;
    toolAmount: number;
    toolRemaining?: number;
  };
  capPath?: "retained_rights" | "cap_room" | string;
  toolReason?: string;
  holdAction?: "retained" | "renounced" | "none" | string;
  rightsValue?: number;
  holdRetainScore?: number;
  scarcityScore?: number;
  expectedMarketMinutes?: number;
  marketMinutesSource?: string;
  limiter: string;
  reason: string;
};

export type MarketResolution = {
  playerId: string;
  player: string;
  round: number;
  tier: string;
  winnerTeam?: string;
  finalTeam?: string;
  offerSheetTeam?: string;
  finalAav?: number;
  submittedWinnerBid?: number;
  runnerUpTeam?: string;
  runnerUpBid?: number;
  highestRawBidTeam?: string;
  highestRawBid?: number;
  clearingRule: string;
  rfaMatchResult?: "matched" | "declined" | "not_applicable";
  unresolvedReason?: string;
};

export type MarketLedgerRow = {
  id: string;
  round: number;
  tier: string;
  team: string;
  playerId: string;
  player: string;
  status: MarketLedgerStatus;
  reason: string;
  offer?: number;
  legalMax?: number;
  tool?: string;
  playerUtility?: number;
  teamUtility?: number;
  teamPriority?: number;
  needFit?: number;
  rightsSource?: string;
  capHoldType?: string;
  capPath?: "retained_rights" | "cap_room" | string;
  toolReason?: string;
  holdAction?: "retained" | "renounced" | "none" | string;
  rightsValue?: number;
  holdRetainScore?: number;
  scarcityScore?: number;
  expectedMarketMinutes?: number;
  marketMinutesSource?: string;
};

export type AppData = {
  manifest: Manifest;
  players: PlayerImpact[];
  teams: TeamProjection[];
  lineups: TeamLineupRow[];
  schedules: TeamScheduleGame[];
  picks: PickAsset[];
  prospects: DraftProspect[];
  trackerBoardSummary: DraftTrackerBoardSummary[];
  trackerBoardScores: DraftTrackerBoardScore[];
  trackerProspectScores: DraftTrackerProspectScore[];
  modelSummary: ModelSummary[];
  offseasonTruth?: OffseasonTruthData;
  capTracker?: CapTrackerData;
  capReview?: CapReviewData;
};
