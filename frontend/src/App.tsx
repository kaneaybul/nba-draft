import { type CSSProperties, type MouseEvent, useEffect, useMemo, useState } from "react";
import { loadAppData } from "./data";
import type { AppData, DraftProspect, DraftTrackerProspectScore, PickAsset, PlayerImpact } from "./types";
import { clamp, cls, formatMoney, formatNumber, formatSignedMoney } from "./utils";

type View = "impact" | "teams" | "trade" | "draft" | "lineups" | "tracker";
type SkillKey = "FTD" | "OREB" | "PASS" | "RIM" | "SHOOT" | "DPM" | "DREB" | "RIMPRO" | "SWITCH";
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
  | "trade_value"
  | "fa_value"
  | "scalability"
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
  | `${SkillKey}_pred`;
type DraftFilterKey = DraftSortKey;
type DraftYearSelection = number | "All";
type FilterFieldType = "number" | "text";
type FilterOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte" | "between";
type FilterRule = {
  id: string;
  key: FilterKey | DraftFilterKey;
  operator: FilterOperator;
  value: string;
  valueTo?: string;
};
type LineupSide = "a" | "b";
type LineupSlot = PlayerImpact | null;
type LineupSkill = {
  key: SkillKey | "ID";
  label: string;
  source: SkillKey | SkillKey[];
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
};
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
const LINEUP_SUGGESTIONS_PER_PAGE = 8;
const LINEUP_SUGGESTION_PAGE_COUNT = 3;
const LINEUP_MAX_SUGGESTIONS = LINEUP_SUGGESTIONS_PER_PAGE * LINEUP_SUGGESTION_PAGE_COUNT;
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
const NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/260x190";
const BRENDAN_MODEL_BOARD = "Brendan Model";
const BRENDAN_BASE_BOARD = "Brendan Base";
const filterFields: Array<{ key: FilterKey; label: string; type: FilterFieldType }> = [
  { key: "player_name", label: "Player", type: "text" },
  { key: "team", label: "Team", type: "text" },
  { key: "position", label: "Position", type: "text" },
  { key: "tier", label: "Tier", type: "text" },
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
  { key: "value_add", label: "Szn VA", type: "number" },
  { key: "fa_value", label: "FA Value", type: "number" },
  { key: "scalability", label: "Scale", type: "number" },
  ...skillKeys.map((key) => ({ key, label: key, type: "number" as const }))
];
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
  { key: "scv_draft", label: "SCV", type: "number" },
  ...skillKeys.map((key) => ({ key: `${key}_pred` as DraftFilterKey, label: key, type: "number" as const }))
];

function useSessionState<T>(key: string, initialValue: T): [T, (value: T | ((current: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initialValue;
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

function latestPlayerSeason(players: PlayerImpact[]): number | null {
  const years = players.map((player) => player.year).filter(Number.isFinite);
  return years.length > 0 ? Math.max(...years) : null;
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("impact");
  const [season, setSeason] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  useEffect(() => {
    loadAppData()
      .then((loaded) => {
        setData(loaded);
        setSeason(latestPlayerSeason(loaded.players));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const reloadData = async () => {
    setRefreshing(true);
    setRefreshNote("Reloading exported data");
    try {
      const loaded = await loadAppData(String(Date.now()));
      setData(loaded);
      setError(null);
      const latest = latestPlayerSeason(loaded.players);
      setSeason((current) => (current !== null && loaded.players.some((player) => player.year === current) ? current : latest));
      setRefreshNote("Data reloaded");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const refreshBackend = async () => {
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
        <div className="mark">NBA</div>
        <p>Loading impact lab</p>
      </main>
    );
  }

  const seasons = Array.from(new Set(data.players.map((player) => player.year))).sort((a, b) => b - a);

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
          <div className="brand-eye">SCV Analytics</div>
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
          <div className="manifest data-stamp">
            <span>Data</span>
            <strong>{new Date(data.manifest.generated_at).toLocaleString()}</strong>
          </div>
          <button className="refresh-button hdr-btn" onClick={reloadData} disabled={refreshing}>
            {refreshing ? "Reloading" : "Reload data"}
          </button>
          <button className="refresh-button hdr-btn primary" onClick={refreshBackend} disabled={refreshing}>
            Refresh latest
          </button>
          {refreshNote && <div className="refresh-note">{refreshNote}</div>}
        </div>
      </header>

      <nav className="modebar" aria-label="Analysis modes">
        {[
          ["impact", "Player Impact"],
          ["teams", "Team Projections"],
          ["trade", "Trade Sandbox"],
          ["draft", "Draft Board"],
          ["lineups", "Lineup Synergy"],
          ["tracker", "Draft Tracker"]
        ].map(([key, label]) => (
          <button key={key} className={cls("modebar-btn", view === key && "active")} onClick={() => setView(key as View)}>
            {label}
            {key === "impact" && <span className="nav-pill">{data.players.filter((player) => player.year === season).length}</span>}
          </button>
        ))}
      </nav>

      {view === "impact" && <ImpactWorkspace data={data} season={season} />}
      {view === "teams" && <TeamWorkspace data={data} season={season} />}
      {view === "trade" && <TradeWorkspace data={data} season={season} />}
      {view === "draft" && <DraftWorkspace data={data} />}
      {view === "lineups" && <LineupWorkspace data={data} season={season} />}
      {view === "tracker" && <TrackerWorkspace data={data} />}
    </div>
  );
}

function ImpactWorkspace({ data, season }: { data: AppData; season: number }) {
  const seasonPlayers = useMemo(() => data.players.filter((player) => player.year === season), [data.players, season]);
  const [query, setQuery] = useSessionState("impact:query", "");
  const [team, setTeam] = useSessionState("impact:team", "All");
  const [position, setPosition] = useSessionState("impact:position", "All");
  const [tier, setTier] = useSessionState("impact:tier", "All");
  const [sortKey, setSortKey] = useSessionState<SortKey>("impact:sortKey", "score");
  const [sortDirection, setSortDirection] = useSessionState<SortDirection>("impact:sortDirection", "desc");
  const [filterRules, setFilterRules] = useSessionState<FilterRule[]>("impact:rules", []);
  const [filterKey, setFilterKey] = useSessionState<FilterKey>("impact:filterKey", "score");
  const [filterOperator, setFilterOperator] = useSessionState<FilterOperator>("impact:filterOperator", "gte");
  const [filterValue, setFilterValue] = useSessionState("impact:filterValue", "");
  const [filterValueTo, setFilterValueTo] = useSessionState("impact:filterValueTo", "");
  const [detailPlayer, setDetailPlayer] = useState<PlayerImpact | null>(null);
  const [detailPosition, setDetailPosition] = useState({ left: 28, top: 138 });

  const teams = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.team))).sort()], [seasonPlayers]);
  const positions = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.position))).sort()], [seasonPlayers]);
  const tiers = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.tier))).sort()], [seasonPlayers]);
  const selectedFilterField = filterFields.find((field) => field.key === filterKey) ?? filterFields[0];
  const availableOperators = selectedFilterField.type === "number" ? numericOperators : textOperators;
  const quickFilterCount = [query.trim(), team !== "All", position !== "All", tier !== "All"].filter(Boolean).length;
  const activeFilterCount = quickFilterCount + filterRules.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seasonPlayers
      .filter((player) => !q || player.player_name.toLowerCase().includes(q))
      .filter((player) => team === "All" || player.team === team)
      .filter((player) => position === "All" || player.position === position)
      .filter((player) => tier === "All" || player.tier === tier)
      .filter((player) => passesFilterRules(player, filterRules))
      .sort((a, b) => comparePlayers(a, b, sortKey, sortDirection));
  }, [filterRules, position, query, seasonPlayers, sortDirection, sortKey, team, tier]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(["player_name", "team", "position", "tier"].includes(key) ? "asc" : "desc");
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
    setFilterRules((current) => [
      ...current,
      {
        id: `${filterKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: filterKey,
        operator: filterOperator,
        value,
        valueTo: filterOperator === "between" ? valueTo : undefined
      }
    ]);
    setFilterValue("");
    setFilterValueTo("");
  };
  const clearAllFilters = () => {
    setQuery("");
    setTeam("All");
    setPosition("All");
    setTier("All");
    setFilterRules([]);
  };
  const showDetail = (player: PlayerImpact, event: MouseEvent<HTMLButtonElement>) => {
    setDetailPlayer(player);
    setDetailPosition({
      left: Math.max(16, Math.min(event.clientX + 14, window.innerWidth - 448)),
      top: Math.max(16, Math.min(event.clientY - 18, window.innerHeight - 520))
    });
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
        <section className="control-strip board-controls">
          <div className="quick-filters board-control-row">
            <div className="search">
              <span>Find</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Player name" />
            </div>
            <label>
              Team
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                {teams.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Position
              <select value={position} onChange={(event) => setPosition(event.target.value)}>
                {positions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Tier
              <select value={tier} onChange={(event) => setTier(event.target.value)}>
                {tiers.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <div className="board-count" aria-live="polite">
              <span>Players</span>
              <strong>{filtered.length.toLocaleString()}</strong>
            </div>
            <button className="clear-filters" onClick={clearAllFilters} disabled={activeFilterCount === 0}>
              Clear{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          </div>
          <div className="rule-builder board-control-row" aria-label="Add filter rule">
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
              Add
            </button>
          </div>
          {filterRules.length > 0 && (
            <div className="filter-chips" aria-label="Active filter rules">
              {filterRules.map((rule) => (
                <button key={rule.id} onClick={() => setFilterRules((current) => current.filter((item) => item.id !== rule.id))}>
                  {describeFilterRule(rule)}
                  <span>Remove</span>
                </button>
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
          <div className="detail-popover" role="dialog" aria-label={`${detailPlayer.player_name} detail`} style={detailPosition} onClick={(event) => event.stopPropagation()}>
            <PlayerDetail player={detailPlayer} />
          </div>
        </div>
      )}
    </main>
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
  const activeSkill = skillKeys.includes(sortKey as SkillKey) ? sortKey as SkillKey : null;

  return (
    <div className="table-wrap">
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
          <col className="cg-money" />
          <col className="cg-money" />
          <col className="cg-va" />
          <col className="cg-scale" />
          <col className="cg-skills" />
        </colgroup>
        <thead>
          <tr className="group-row">
            <th></th>
            <th colSpan={3}>Identity</th>
            <th colSpan={6}>Impact</th>
            <th colSpan={4}>Market</th>
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
            <th className="col-rate c-delta align-center">{sortableHeader("score_delta", "Delta")}</th>
            <th className="col-tier c-tier align-center group-end">{sortableHeader("tier", "Tier")}</th>
            <th className="col-money c-money align-right">{sortableHeader("value", "Value")}</th>
            <th className="col-money c-money align-right">{sortableHeader("contract", "Salary")}</th>
            <th className="col-money c-va align-right">{sortableHeader("value_add", "Szn VA")}</th>
            <th className="col-scale c-scale align-center">{sortableHeader("scalability", "Scale")}</th>
            <th className="col-skills c-skills align-center">
              <div className="skills-head">
                <button className={cls("skills-main-sort", activeSkill && "active")} onClick={() => onSort(activeSkill ?? "SHOOT")}>
                  Skills{activeSkill && <small>{activeSkill} {sortDirection === "desc" ? "v" : "^"}</small>}
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
                </div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
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
                    <div className="player-sub">{player.team} / {player.position}</div>
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
              <td className="money-text muted-num"><div className="cell-stage money-stage">{formatMoney(player.contract)}</div></td>
              <td className="va-cell" style={netMoneyStyle(player.value_add)}><div className="cell-stage money-stage">{formatSeasonValueAdd(player)}</div></td>
              <td className="align-center">
                <div className="cell-stage">
                  <span className="scale-value" style={scaleStyle(player.scalability)}>
                    {formatNumber(player.scalability, 1)}
                  </span>
                </div>
              </td>
              <td className="skill-fingerprint-cell">
                <SkillFingerprint player={player} activeSkill={activeSkill} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function PlayerDetail({ player }: { player: PlayerImpact }) {
  const projection = [
    { label: "Now", value: player.total },
    { label: "+1", value: player.projection_y1 },
    { label: "+2", value: player.projection_y2 },
    { label: "+3", value: player.projection_y3 },
    { label: "+4", value: player.projection_y4 },
    { label: "+5", value: player.projection_y5 ?? player.projection_y4 }
  ].filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(point.value));
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
              <div className="dp-meta">{player.team} / {player.position}</div>
              <div className="dp-name">{player.player_name}</div>
              <div className="dp-tags">
                <span className="tier-text">{player.tier}</span>
                {player.score_delta !== null && player.score_delta !== undefined && (
                  <span>{formatSigned(player.score_delta, 0)} pts this season</span>
                )}
              </div>
            </div>
          </div>
          <ScoreRing value={player.score} label={player.score_label} size={66} />
        </div>
      </div>

      <div className="dp-body">
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
          <h3 className="dp-section-head">Projection Arc</h3>
          <ProjectionChart points={projection} />
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
              <span>Raw Value</span>
              <strong>{formatMoney(player.value)}</strong>
            </div>
            <div className="mc">
              <span>Salary</span>
              <strong className="muted-num">{formatMoney(player.contract)}</strong>
            </div>
            <div className="mc">
              <span>Season VA</span>
              <strong style={netMoneyStyle(player.value_add)}>{formatSeasonValueAdd(player)}</strong>
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
              <strong style={scaleStyle(player.scalability)}>{formatNumber(player.scalability, 1)}</strong>
            </div>
          </div>
          <p className="note note-text">
            {formatNumber(player.Minutes, 0)} min / {formatNumber(player.yoe, 0)} yrs experience
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
  const teams = useMemo(
    () => data.teams.filter((team) => team.year === season).sort((a, b) => a.rank - b.rank),
    [data.teams, season]
  );
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const currentTeam = teams.find((team) => team.team === selectedTeam) ?? teams[0];
  if (!currentTeam) {
    return (
      <main className="workspace team-grid">
        <section className="table-panel">
          <EmptyState title="No team projections" detail={`No team projection rows are available for ${season}.`} />
        </section>
      </main>
    );
  }

  const contributors = data.players
    .filter((player) => player.year === season && player.team === currentTeam.team)
    .sort((a, b) => b.timin - a.timin)
    .slice(0, 12);

  return (
    <main className="workspace team-grid">
      <section className="table-panel">
        <div className="panel-heading">
          <div>
            <h2>Team Projection</h2>
            <p>Impact-derived wins by roster contribution</p>
          </div>
        </div>
        <div className="team-rank-list">
          {teams.map((team) => (
            <button
              key={team.team}
              className={cls(currentTeam.team === team.team && "selected")}
              onClick={() => setSelectedTeam(team.team)}
            >
              <span>{team.rank}. {team.team}</span>
              <strong>{formatNumber(team.projected_wins, 1)} W</strong>
              <small>{team.conference} #{team.conference_rank}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="detail-panel wide">
        <div className="player-head">
          <div>
            <p>{currentTeam.conference} / League #{currentTeam.rank}</p>
            <h2>{currentTeam.team}</h2>
          </div>
          <strong>{formatNumber(currentTeam.projected_wins, 1)}</strong>
        </div>
        <div className="metric-grid">
          <MetricPill label="Offense" value={formatNumber(currentTeam.offense, 1)} tone="green" />
          <MetricPill label="Defense" value={formatNumber(currentTeam.defense, 1)} tone="teal" />
          <MetricPill label="Total" value={formatNumber(currentTeam.total, 1)} tone="gold" />
          <MetricPill label="Minutes" value={formatNumber(currentTeam.minutes, 0)} />
        </div>
        <h3>Roster Drivers</h3>
        {contributors.length > 0 ? <div className="table-wrap compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Score</th>
                <th>Total</th>
                <th>TIMIN</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((player) => (
                <tr key={player.nba_id}>
                  <td>{player.player_name}</td>
                  <td>{formatNumber(player.score, 1)}</td>
                  <td>{formatNumber(player.total, 1)}</td>
                  <td>{formatNumber(player.timin, 0)}</td>
                  <td>{formatMoney(player.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : <EmptyState title="No roster drivers" detail={`No player rows are available for ${currentTeam.team} in ${season}.`} />}
      </section>
    </main>
  );
}

function TradeWorkspace({ data, season }: { data: AppData; season: number }) {
  const players = useMemo(
    () => data.players.filter((player) => player.year === season).sort((a, b) => b.trade_value - a.trade_value),
    [data.players, season]
  );
  const [playerId, setPlayerId] = useState(players[0]?.nba_id ?? 0);
  const [pickId, setPickId] = useState(data.picks[0]?.asset_id ?? "");
  const [left, setLeft] = useState<Array<PlayerImpact | PickAsset>>([]);
  const [right, setRight] = useState<Array<PlayerImpact | PickAsset>>([]);

  const selectedPlayer = players.find((player) => player.nba_id === Number(playerId)) ?? players[0] ?? null;
  const selectedPick = data.picks.find((pick) => pick.asset_id === pickId) ?? data.picks[0] ?? null;
  const hasAssets = players.length > 0 || data.picks.length > 0;
  const leftTotal = assetTotal(left);
  const rightTotal = assetTotal(right);
  const diff = Math.abs(leftTotal - rightTotal);
  const tolerance = Math.max(8_000_000, Math.max(leftTotal, rightTotal) * 0.12);
  const verdict = diff <= tolerance ? "Balanced" : "Declined";
  const whoSaysNo = diff <= tolerance ? "Neither" : leftTotal > rightTotal ? "Left side" : "Right side";

  return (
    <main className="workspace trade-grid">
      <section className="table-panel trade-builder">
        <div className="panel-heading">
          <div>
            <h2>Trade Sandbox</h2>
            <p>Player and pick value balance</p>
          </div>
        </div>
        {hasAssets ? <div className="trade-controls">
          <label>
            Player asset
            <select value={playerId} onChange={(event) => setPlayerId(Number(event.target.value))} disabled={players.length === 0}>
              {players.slice(0, 250).map((player) => (
                <option key={player.nba_id} value={player.nba_id}>
                  {player.player_name} / {formatMoney(player.trade_value)}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button disabled={!selectedPlayer} onClick={() => selectedPlayer && setLeft([...left, selectedPlayer])}>Add left</button>
            <button disabled={!selectedPlayer} onClick={() => selectedPlayer && setRight([...right, selectedPlayer])}>Add right</button>
          </div>
          <label>
            Pick asset
            <select value={pickId} onChange={(event) => setPickId(event.target.value)} disabled={data.picks.length === 0}>
              {data.picks.map((pick) => (
                <option key={pick.asset_id} value={pick.asset_id}>
                  {pick.label} / {formatMoney(pick.value)}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button disabled={!selectedPick} onClick={() => selectedPick && setLeft([...left, selectedPick])}>Add left</button>
            <button disabled={!selectedPick} onClick={() => selectedPick && setRight([...right, selectedPick])}>Add right</button>
          </div>
        </div> : <EmptyState title="No trade assets" detail={`No players or picks are available for ${season}.`} />}
      </section>

      <TradeSide title="Left Side" assets={left} setAssets={setLeft} total={leftTotal} />
      <TradeSide title="Right Side" assets={right} setAssets={setRight} total={rightTotal} />

      <section className="detail-panel trade-verdict">
        <p>Value Diff</p>
        <h2>{formatMoney(diff)}</h2>
        <div className={cls("verdict", verdict === "Balanced" ? "ok" : "bad")}>{verdict}</div>
        <span>{whoSaysNo} says no</span>
      </section>
    </main>
  );
}

function TradeSide({
  title,
  assets,
  setAssets,
  total
}: {
  title: string;
  assets: Array<PlayerImpact | PickAsset>;
  setAssets: (assets: Array<PlayerImpact | PickAsset>) => void;
  total: number;
}) {
  return (
    <section className="trade-side">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{formatMoney(total)}</p>
        </div>
        <button onClick={() => setAssets([])}>Clear</button>
      </div>
      <div className="asset-list">
        {assets.length === 0 && <p className="empty">No assets</p>}
        {assets.map((asset, index) => (
          <button key={`${assetLabel(asset)}-${index}`} onClick={() => setAssets(assets.filter((_, i) => i !== index))}>
            <span>{assetLabel(asset)}</span>
            <strong>{formatMoney(assetValue(asset))}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function DraftWorkspace({ data }: { data: AppData }) {
  const years = Array.from(new Set(data.prospects.map((prospect) => prospect.draft_year))).sort((a, b) => b - a);
  const [year, setYear] = useSessionState<DraftYearSelection>("draft:year", years[0] ?? "All");
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
  };

  return (
    <main className="workspace draft-model-grid">
      <section className="draft-board-main">
        <div className="impact-sticky-header">
          <section className="control-strip board-controls draft-controls">
            <div className="quick-filters board-control-row">
              <div className="search">
                <span>Find</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Prospect name" />
              </div>
              {years.length > 0 && <label>
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
              <label>
                Position
                <select value={position} onChange={(event) => setPosition(event.target.value)}>
                  {positions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Tier
                <select value={tier} onChange={(event) => setTier(event.target.value)}>
                  {tiers.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
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
            </div>
            <div className="rule-builder board-control-row" aria-label="Add draft filter rule">
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
  const activeSkill = draftSortSkill(sortKey);

  return (
    <div className="table-wrap">
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
        </colgroup>
        <thead>
          <tr className="group-row">
            <th></th>
            <th colSpan={4}>Identity</th>
            <th colSpan={6}>Impact</th>
            <th>Skills</th>
          </tr>
          <tr>
            <th className="align-center">{sortableHeader("rank_in_class", "#")}</th>
            <th className="sticky-player">{sortableHeader("player", "Player")}</th>
            <th className="align-center">{sortableHeader("position", "Pos")}</th>
            <th className="align-center">{sortableHeader("draft_age", "Age")}</th>
            <th className="align-center">{sortableHeader("scv_draft", "SCV")}</th>
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
                  {activeSkill && <small>{activeSkill}</small>}
                </button>
                <div className="skills-sort-strip">
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
          </tr>
        </thead>
        <tbody>
          {prospects.map((prospect, index) => (
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
                <ProspectSkillFingerprint prospect={prospect} activeSkill={activeSkill} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function draftSortSkill(key: DraftSortKey): SkillKey | null {
  if (!key.endsWith("_pred")) return null;
  const skill = key.replace("_pred", "") as SkillKey;
  return skillKeys.includes(skill) ? skill : null;
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
  const [lineupA, setLineupA] = useSessionState<string[]>("lineup:a", emptyLineup());
  const [lineupB, setLineupB] = useSessionState<string[]>("lineup:b", emptyLineup());
  const [suggestionSlot, setSuggestionSlot] = useSessionState<number | null>("lineup:suggestionSlot", null);
  const [suggestionPage, setSuggestionPage] = useSessionState("lineup:suggestionPage", 0);

  const summaryA = useMemo(() => summarizeLineup(lineupA, playerMap, percentileMap), [lineupA, playerMap, percentileMap]);
  const summaryB = useMemo(() => summarizeLineup(lineupB, playerMap, percentileMap), [lineupB, playerMap, percentileMap]);
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
            baseline: summaryA
          }),
    [lineupA, playerMap, percentileMap, players, suggestionSlot, summaryA]
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
                  <td>{player?.position ?? "-"}</td>
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
              <td>Total / Avg</td>
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
                    {suggestion.player.team} / {suggestion.player.position} / {suggestion.player.tier}
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
  const tone = featured ? lineupAverageTone(value) : value >= 0.6 ? "good" : value < 0.4 ? "bad" : "mid";
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
                      {option.player_name} / {option.team} / {option.position}
                    </option>
                  );
                })}
              </select>
              {player && (
                <div className="lineup-player-mini" style={rowAccentStyle(player)}>
                  <PlayerHeadshot player={player} />
                  <div>
                    <strong>{player.player_name}</strong>
                    <span>{player.position} / {player.tier}</span>
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
  baseline
}: {
  slotIndex: number;
  selectedIds: string[];
  players: PlayerImpact[];
  playerMap: Map<string, PlayerImpact>;
  percentileMap: Map<string, Record<string, number>>;
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
      const summary = summarizeLineup(nextIds, playerMap, percentileMap);
      const playerRanks = percentileMap.get(playerId) ?? {};
      const currentRanks = currentPlayer ? percentileMap.get(lineupPlayerId(currentPlayer)) ?? {} : {};
      const netDelta = summary.net - baseline.net;
      const scoreDelta = summary.score - baseline.score;
      const gapDelta = summary.gaps - baseline.gaps;
      const newGaps = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before >= 0.4 && after < 0.4;
      });
      const improvedGaps = baselineGaps
        .filter((skill) => {
          const before = baseline.skillAverages[skill.key] ?? 0;
          const after = summary.skillAverages[skill.key] ?? 0;
          return after >= 0.4 || after - before >= 0.06;
        })
        .sort((a, b) => (summary.skillAverages[b.key] ?? 0) - (baseline.skillAverages[b.key] ?? 0) - ((summary.skillAverages[a.key] ?? 0) - (baseline.skillAverages[a.key] ?? 0)));
      const needLift = needProfile.reduce((sum, need) => {
        const before = baseline.skillAverages[need.skill.key] ?? 0;
        const after = summary.skillAverages[need.skill.key] ?? 0;
        const currentRank = currentPlayer ? currentRanks[need.skill.key] ?? 0.5 : Math.min(0.5, before);
        const playerRank = playerRanks[need.skill.key] ?? 0.5;
        const lineupLift = Math.max(0, after - before) * (before < 0.4 ? 56 : 34);
        const directFit = Math.max(0, playerRank - currentRank) * need.weight * (before < 0.4 ? 2.6 : 1.5);
        return sum + need.weight * lineupLift + directFit;
      }, 0);
      const solvedHardGaps = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before < 0.4 && after >= 0.4;
      }).length;
      const stabilizesSoftNeeds = lineupSkills.filter((skill) => {
        const before = baseline.skillAverages[skill.key] ?? 0;
        const after = summary.skillAverages[skill.key] ?? 0;
        return before >= 0.4 && before < 0.52 && after >= 0.52;
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
  if (reasons.length === 1) reasons.unshift(`${player.position || "Lineup"} fit`);
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

function summarizeLineup(selectedIds: string[], playerMap: Map<string, PlayerImpact>, percentileMap: Map<string, Record<string, number>>): LineupSummary {
  const slots = selectedIds.map((id) => playerMap.get(id) ?? null);
  const players = slots.filter((player): player is PlayerImpact => Boolean(player));
  const divisor = Math.max(1, players.length);
  const skillAverages: Record<string, number> = {};

  lineupSkills.forEach((skill) => {
    skillAverages[skill.key] = players.reduce((sum, player) => sum + (percentileMap.get(lineupPlayerId(player))?.[skill.key] ?? 0.5), 0) / divisor;
  });

  return {
    slots,
    players,
    offense: players.reduce((sum, player) => sum + player.offense, 0),
    defense: players.reduce((sum, player) => sum + player.defense, 0),
    net: players.reduce((sum, player) => sum + player.total, 0),
    score: players.reduce((sum, player) => sum + player.score, 0) / divisor,
    gaps: lineupSkills.filter((skill) => (skillAverages[skill.key] ?? 0) < 0.4).length,
    spikes: lineupSkills.filter((skill) => (skillAverages[skill.key] ?? 0) > 0.6).length,
    skillAverages
  };
}

function lineupSkillValue(player: PlayerImpact, skill: LineupSkill): number {
  if (Array.isArray(skill.source)) {
    return skill.source.reduce((sum, key) => sum + Number(player[key] ?? 0), 0) / skill.source.length;
  }
  return Number(player[skill.source] ?? 0);
}

function lineupAverageTone(value: number): "good" | "mid" | "bad" {
  if (value >= 0.56) return "good";
  if (value < 0.46) return "bad";
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

function SkillFingerprint({
  player,
  activeSkill
}: {
  player: PlayerImpact;
  activeSkill: SkillKey | null;
}) {
  const [hoverSkill, setHoverSkill] = useState<string | null>(null);
  const aggregateBars = [
    { key: "OFF_SKILL", label: "OFF", title: "Skill model Off", value: player.skill_model_off ?? player.skill_off_total },
    { key: "DEF_SKILL", label: "DEF", title: "Skill model Def", value: player.skill_model_def ?? player.skill_def_total }
  ];

  return (
    <div className="skill-fingerprint">
      <div className="skill-bars" onMouseLeave={() => setHoverSkill(null)}>
        {skillKeys.map((key) => {
          const value = Number(player[key] ?? 0);
          const height = Math.max(4, clamp((value + 3) / 6, 0, 1) * 22);
          return (
            <span
              key={key}
              className={cls("skill-bar", key === "DREB" && "defense-start", activeSkill === key && "active", hoverSkill === key && "open")}
              onMouseEnter={() => setHoverSkill(key)}
              title={`${skillLabels[key]}: ${formatSigned(value, 1)}`}
              style={{ ...skillStyle(value), "--skill-h": `${height}px` } as CSSProperties}
            >
              <i />
              <em>{key} {formatSigned(value, 1)}</em>
            </span>
          );
        })}
        {aggregateBars.map((bar) => {
          const value = Number(bar.value ?? 0);
          const height = Math.max(4, clamp((value + 6) / 12, 0, 1) * 22);
          return (
            <span
              key={bar.key}
              className={cls("skill-bar", "skill-total-bar", bar.key === "OFF_SKILL" && "skill-total-start", hoverSkill === bar.key && "open")}
              onMouseEnter={() => setHoverSkill(bar.key)}
              title={`${bar.title}: ${formatSigned(value, 1)}`}
              style={{ ...skillStyle(value), "--skill-h": `${height}px` } as CSSProperties}
            >
              <i />
              <em>{bar.label} {formatSigned(value, 1)}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProspectSkillFingerprint({
  prospect,
  activeSkill
}: {
  prospect: DraftProspect;
  activeSkill: SkillKey | null;
}) {
  const [hoverSkill, setHoverSkill] = useState<SkillKey | null>(null);

  return (
    <div className="skill-fingerprint">
      <div className="skill-bars" onMouseLeave={() => setHoverSkill(null)}>
        {skillKeys.map((key) => {
          const value = getProspectSkillValue(prospect, key);
          const height = Math.max(4, clamp((value + 3) / 6, 0, 1) * 22);
          return (
            <span
              key={key}
              className={cls("skill-bar", key === "DREB" && "defense-start", activeSkill === key && "active", hoverSkill === key && "open")}
              onMouseEnter={() => setHoverSkill(key)}
              title={`${skillLabels[key]}: ${formatSigned(value, 1)}`}
              style={{ ...skillStyle(value), "--skill-h": `${height}px` } as CSSProperties}
            >
              <i />
              <em>{key} {formatSigned(value, 1)}</em>
            </span>
          );
        })}
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
  return heatStyleVars("scale", value - 1, 1.15);
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
  return formatSignedMoney(player.value_add);
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

function ProjectionChart({ points }: { points: Array<{ label: string; value: number }> }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values, -2);
  const max = Math.max(...values, 6);
  const width = 286;
  const height = 104;
  const padX = 14;
  const padY = 14;
  const coords = points.map((point, index) => {
    const x = padX + index * ((width - padX * 2) / Math.max(1, points.length - 1));
    const y = height - padY - ((point.value - min) / Math.max(1, max - min)) * (height - padY * 2);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const baselineValue = min <= 0 && max > 0 ? 0 : min;
  const baselineY = height - padY - ((baselineValue - min) / Math.max(1, max - min)) * (height - padY * 2);
  const areaPath = coords.length > 0
    ? `${path} L ${coords[coords.length - 1].x} ${baselineY} L ${coords[0].x} ${baselineY} Z`
    : "";

  return (
    <svg className="projection" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player projection line">
      {min <= 0 && max > 0 && <line x1={padX} x2={width - padX} y1={baselineY} y2={baselineY} />}
      {areaPath && <path className="projection-area" d={areaPath} />}
      <path className="projection-line" d={path} />
      {coords.map((point) => (
        <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="4" />
          <text x={point.x} y={height - 3} textAnchor="middle">{point.label}</text>
        </g>
      ))}
    </svg>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone?: "green" | "teal" | "gold" }) {
  return (
    <div className={cls("metric-pill", tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function assetValue(asset: PlayerImpact | PickAsset): number {
  return "trade_value" in asset ? asset.trade_value : asset.value;
}

function assetLabel(asset: PlayerImpact | PickAsset): string {
  return "player_name" in asset ? asset.player_name : asset.label;
}

function assetTotal(assets: Array<PlayerImpact | PickAsset>): number {
  return assets.reduce((sum, asset) => sum + assetValue(asset), 0);
}

function describeFilterRule(rule: FilterRule): string {
  const fieldLabel = filterFields.find((field) => field.key === rule.key)?.label ?? rule.key;
  const operatorLabel = [...numericOperators, ...textOperators].find((operator) => operator.value === rule.operator)?.label ?? rule.operator;
  if (rule.operator === "between") return `${fieldLabel} between ${rule.value} and ${rule.valueTo}`;
  return `${fieldLabel} ${operatorLabel} ${rule.value}`;
}

function passesFilterRules(player: PlayerImpact, rules: FilterRule[]): boolean {
  return rules.every((rule) => {
    const value = player[rule.key as FilterKey];
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

function comparePlayers(a: PlayerImpact, b: PlayerImpact, key: SortKey, direction: SortDirection): number {
  const aValue = a[key];
  const bValue = b[key];
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

  return prospect[key as keyof DraftProspect];
}

function displayDraftPosition(prospect: DraftProspect): string {
  const raw = prospect.position || "UNK";
  if (!raw.includes("/")) return raw;
  if (prospect.draft_year === 2026) return raw.split("/")[0] || "UNK";
  return raw;
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
