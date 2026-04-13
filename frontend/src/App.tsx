import { type CSSProperties, type MouseEvent, useEffect, useMemo, useState } from "react";
import { loadAppData } from "./data";
import type { AppData, DraftProspect, PickAsset, PlayerImpact, TeamProjection } from "./types";
import { clamp, cls, formatMoney, formatNumber } from "./utils";

type View = "impact" | "teams" | "trade" | "draft" | "lineups" | "tracker";
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
  | "trade_value"
  | "fa_value"
  | "scalability"
  | "Minutes";
type SortDirection = "asc" | "desc";
type FilterKey = SortKey;

const skillKeys = ["FTD", "OREB", "PASS", "RIM", "SHOOT", "DPM", "DREB", "RIMPRO", "SWITCH"] as const;
const skillLabels: Record<(typeof skillKeys)[number], string> = {
  FTD: "Free Throws",
  OREB: "Off. Rebounding",
  PASS: "Passing",
  RIM: "Rim Pressure",
  SHOOT: "Shooting",
  DPM: "Def. Playmaking",
  DREB: "Def. Rebounding",
  RIMPRO: "Rim Protection",
  SWITCH: "Switchability"
};

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
        const latest = Math.max(...loaded.players.map((player) => player.year));
        setSeason(latest);
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
      const latest = Math.max(...loaded.players.map((player) => player.year));
      setSeason((current) => current ?? latest);
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

  if (!data || season === null) {
    return (
      <main className="loading">
        <div className="mark">NBA</div>
        <p>Loading impact lab</p>
      </main>
    );
  }

  const seasons = Array.from(new Set(data.players.map((player) => player.year))).sort((a, b) => b - a);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">SCV Analytics</div>
          <h1>NBA Impact Lab</h1>
        </div>
        <div className="topbar-actions">
          <label>
            Season
            <select value={season} onChange={(event) => setSeason(Number(event.target.value))}>
              {seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <div className="manifest">
            <span>Data</span>
            <strong>{new Date(data.manifest.generated_at).toLocaleString()}</strong>
          </div>
          <button className="refresh-button" onClick={reloadData} disabled={refreshing}>
            {refreshing ? "Reloading" : "Reload data"}
          </button>
          <button className="refresh-button" onClick={refreshBackend} disabled={refreshing}>
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
          <button key={key} className={cls(view === key && "active")} onClick={() => setView(key as View)}>
            {label}
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
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("All");
  const [position, setPosition] = useState("All");
  const [tier, setTier] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const activeFilterCount = Object.values(columnFilters).filter((value) => value?.trim()).length;
  const [detailPlayer, setDetailPlayer] = useState<PlayerImpact | null>(null);
  const [detailPosition, setDetailPosition] = useState({ left: 28, top: 138 });

  const teams = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.team))).sort()], [seasonPlayers]);
  const positions = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.position))).sort()], [seasonPlayers]);
  const tiers = useMemo(() => ["All", ...Array.from(new Set(seasonPlayers.map((player) => player.tier))).sort()], [seasonPlayers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seasonPlayers
      .filter((player) => !q || player.player_name.toLowerCase().includes(q))
      .filter((player) => team === "All" || player.team === team)
      .filter((player) => position === "All" || player.position === position)
      .filter((player) => tier === "All" || player.tier === tier)
      .filter((player) => passesColumnFilters(player, columnFilters))
      .sort((a, b) => comparePlayers(a, b, sortKey, sortDirection));
  }, [columnFilters, position, query, seasonPlayers, sortDirection, sortKey, team, tier]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(key);
    setSortDirection(["player_name", "team", "position", "tier"].includes(key) ? "asc" : "desc");
  };
  const handleFilter = (key: FilterKey, value: string) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  };
  const showDetail = (player: PlayerImpact, event: MouseEvent<HTMLButtonElement>) => {
    setDetailPlayer(player);
    setDetailPosition({
      left: Math.max(16, Math.min(event.clientX + 14, window.innerWidth - 448)),
      top: Math.max(16, Math.min(event.clientY - 18, window.innerHeight - 520))
    });
  };

  return (
    <main className="workspace impact-grid">
      <section className="control-strip">
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
        <button className="clear-filters" onClick={() => setColumnFilters({})} disabled={activeFilterCount === 0}>
          Clear column filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </button>
      </section>

      <section className="table-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Player Board</h2>
            <p>{filtered.length.toLocaleString()} players</p>
          </div>
        </div>
        <PlayerTable
          players={filtered}
          sortKey={sortKey}
          sortDirection={sortDirection}
          filters={columnFilters}
          onSort={handleSort}
          onFilter={handleFilter}
          onShowDetail={setDetailPlayer}
        />
      </section>

      {detailPlayer && (
        <div className="detail-overlay" role="dialog" aria-label={`${detailPlayer.player_name} detail`}>
          <div className="detail-popover" style={detailPosition} onMouseLeave={() => setDetailPlayer(null)}>
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
  filters,
  onSort,
  onFilter,
  onShowDetail
}: {
  players: PlayerImpact[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  filters: Partial<Record<FilterKey, string>>;
  onSort: (key: SortKey) => void;
  onFilter: (key: FilterKey, value: string) => void;
  onShowDetail: (player: PlayerImpact, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const sortableHeader = (key: SortKey, label: string) => (
    <button className={cls("sort-header", sortKey === key && "active")} onClick={() => onSort(key)}>
      {label}
      {sortKey === key && <span>{sortDirection === "desc" ? "v" : "^"}</span>}
    </button>
  );
  const filterInput = (key: FilterKey, placeholder = "Filter") => (
    <input
      className="column-filter"
      value={filters[key] ?? ""}
      onChange={(event) => onFilter(key, event.target.value)}
      placeholder={placeholder}
      aria-label={`Filter ${key}`}
    />
  );

  return (
    <div className="table-wrap">
      <table className="data-table player-table">
        <thead>
          <tr>
            <th className="col-rank">Rank</th>
            <th className="col-player">{sortableHeader("player_name", "Player")}</th>
            <th className="col-team align-center">{sortableHeader("team", "Team")}</th>
            <th className="col-pos align-center">{sortableHeader("position", "Pos")}</th>
            <th className="col-compact align-right">{sortableHeader("age", "Age")}</th>
            <th className="col-compact align-right">{sortableHeader("yoe", "YOE")}</th>
            <th className="col-min align-right">{sortableHeader("Minutes", "Min")}</th>
            <th className="col-rate align-right">{sortableHeader("offense", "Off")}</th>
            <th className="col-rate align-right">{sortableHeader("defense", "Def")}</th>
            <th className="col-rate align-right">{sortableHeader("total", "Total")}</th>
            <th className="col-score align-center">{sortableHeader("score", "Score")}</th>
            <th className="col-rate align-right">{sortableHeader("score_delta", "Delta")}</th>
            <th className="col-tier">{sortableHeader("tier", "Tier")}</th>
            <th className="col-money align-right">{sortableHeader("value", "Value")}</th>
            <th className="col-money align-right">{sortableHeader("fa_value", "FA")}</th>
            <th className="col-scale align-center">{sortableHeader("scalability", "Scale")}</th>
          </tr>
          <tr className="filter-row">
            <th />
            <th>{filterInput("player_name", "Name")}</th>
            <th>{filterInput("team", "Team")}</th>
            <th>{filterInput("position", "Pos")}</th>
            <th>{filterInput("age", ">24")}</th>
            <th>{filterInput("yoe", "<4")}</th>
            <th>{filterInput("Minutes", ">1000")}</th>
            <th>{filterInput("offense", ">1")}</th>
            <th>{filterInput("defense", ">1")}</th>
            <th>{filterInput("total", ">2")}</th>
            <th>{filterInput("score", ">80")}</th>
            <th>{filterInput("score_delta", ">0")}</th>
            <th>{filterInput("tier", "Tier")}</th>
            <th>{filterInput("value", ">20m")}</th>
            <th>{filterInput("fa_value", ">20m")}</th>
            <th>{filterInput("scalability", ">1")}</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, index) => (
            <tr key={`${player.year}-${player.nba_id}`}>
              <td className="rank-cell">{index + 1}</td>
              <td>
                <button className="row-button" onClick={(event) => onShowDetail(player, event)}>{player.player_name}</button>
              </td>
              <td className="align-center">{player.team}</td>
              <td className="align-center">{player.position}</td>
              <td className="align-right">{formatNumber(player.age, 1)}</td>
              <td className="align-right">{formatNumber(player.yoe, 0)}</td>
              <td className="align-right">{formatNumber(player.Minutes, 0)}</td>
              <td className="align-right"><span className="rate-value" style={rateStyle(player.offense)}>{formatSigned(player.offense, 1)}</span></td>
              <td className="align-right"><span className="rate-value" style={rateStyle(player.defense)}>{formatSigned(player.defense, 1)}</span></td>
              <td className="align-right"><span className="rate-value" style={rateStyle(player.total)}>{formatSigned(player.total, 1)}</span></td>
              <td className="align-center">
                <ScoreBar value={player.score} />
              </td>
              <td className={cls("align-right", (player.score_delta ?? 0) >= 0 ? "positive" : "negative")}>{formatSigned(player.score_delta, 0)}</td>
              <td>
                <span className="tier">{player.tier}</span>
              </td>
              <td className="align-right">{formatMoney(player.value)}</td>
              <td className="align-right">{formatMoney(player.fa_value)}</td>
              <td className="align-center">
                <span className="scale-pill" style={scaleStyle(player.scalability)}>
                  {formatNumber(player.scalability, 1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerDetail({ player }: { player: PlayerImpact }) {
  const projection = [
    { label: `${player.year}`, value: player.total },
    { label: "+1", value: player.projection_y1 },
    { label: "+2", value: player.projection_y2 },
    { label: "+3", value: player.projection_y3 },
    { label: "+4", value: player.projection_y4 }
  ];

  return (
    <aside className="detail-panel">
      <div className="player-head">
        <div>
          <p>{player.team} / {player.position}</p>
          <h2>{player.player_name}</h2>
        </div>
        <strong>{formatNumber(player.score, 1)}</strong>
      </div>
      <div className="metric-grid">
        <MetricPill label="Offense" value={formatNumber(player.offense, 1)} tone="green" />
        <MetricPill label="Defense" value={formatNumber(player.defense, 1)} tone="teal" />
        <MetricPill label="Total" value={formatNumber(player.total, 1)} tone="gold" />
        <MetricPill label="Minutes" value={formatNumber(player.Minutes, 0)} />
      </div>
      <ProjectionChart points={projection} />
      <section>
        <h3>Skill Shape</h3>
        <div className="skill-list">
          {skillKeys.map((key) => (
            <SkillRow key={key} label={skillLabels[key]} value={Number(player[key] ?? 0)} />
          ))}
        </div>
      </section>
      <section>
        <h3>Market Read</h3>
        <div className="market-grid">
          <div>
            <span>Impact value</span>
            <strong>{formatMoney(player.value)}</strong>
          </div>
          <div>
            <span>Trade value</span>
            <strong>{formatMoney(player.trade_value)}</strong>
          </div>
          <div>
            <span>FA value</span>
            <strong>{formatMoney(player.fa_value)}</strong>
          </div>
          <div>
            <span>Scalability</span>
            <strong>{formatNumber(player.scalability, 1)}</strong>
          </div>
        </div>
        <p className="note">{player.source_note}</p>
      </section>
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
        <div className="table-wrap compact">
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
        </div>
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
        <div className="trade-controls">
          <label>
            Player asset
            <select value={playerId} onChange={(event) => setPlayerId(Number(event.target.value))}>
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
            <select value={pickId} onChange={(event) => setPickId(event.target.value)}>
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
        </div>
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
  const [year, setYear] = useState(years[0]);
  const prospects = data.prospects.filter((prospect) => prospect.draft_year === year).slice(0, 80);

  return (
    <main className="workspace draft-grid">
      <section className="table-panel">
        <div className="panel-heading">
          <div>
            <h2>Draft Board</h2>
            <p>Model score and skill shape</p>
          </div>
          <label>
            Class
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <ProspectTable prospects={prospects} />
      </section>
      <section className="detail-panel wide">
        <h2>Model Diagnostics</h2>
        <div className="diagnostic-list">
          {data.modelSummary.slice(0, 10).map((row) => (
            <div key={row.skill} className="diagnostic-row">
              <strong>{row.skill}</strong>
              <span>{row.model_type}</span>
              <span>Temporal R2 {formatNumber(row.temporal_r2 ?? null, 2)}</span>
              <small>{row.top_variable ?? "No top variable"}</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProspectTable({ prospects }: { prospects: DraftProspect[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Pool</th>
            <th>Score</th>
            <th>Off</th>
            <th>Def</th>
            <th>Total</th>
            <th>Age</th>
            <th>SCV</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((prospect) => (
            <tr key={`${prospect.draft_year}-${prospect.player}`}>
              <td>{prospect.rank_in_class}</td>
              <td>{prospect.player}</td>
              <td>{prospect.prediction_pool}</td>
              <td><ScoreBar value={prospect.score} /></td>
              <td>{formatNumber(prospect.OFF_pred, 1)}</td>
              <td>{formatNumber(prospect.DEF_pred, 1)}</td>
              <td>{formatNumber(prospect.TOTAL_pred, 1)}</td>
              <td>{formatNumber(prospect.draft_age, 1)}</td>
              <td>{formatNumber(prospect.scv_draft, 0)}</td>
              <td>{prospect.pre_draft_team || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineupWorkspace({ data, season }: { data: AppData; season: number }) {
  const players = data.players.filter((player) => player.year === season).sort((a, b) => b.scalability - a.scalability);
  return (
    <main className="workspace split-preview">
      <section className="table-panel">
        <div className="panel-heading">
          <div>
            <h2>Lineup Synergy</h2>
            <p>Best scalable skill blends</p>
          </div>
        </div>
        <div className="skill-leaders">
          {players.slice(0, 12).map((player) => (
            <div key={player.nba_id} className="leader-row">
              <strong>{player.player_name}</strong>
              <span>{player.team}</span>
              <ScoreBar value={player.scalability} />
            </div>
          ))}
        </div>
      </section>
      <section className="detail-panel wide">
        <h2>Next Build Slice</h2>
        <p className="note">Five-player lineup averages, team-vs-team advantages, team needs, draft fit, and replacement baselines will reuse this skill data.</p>
      </section>
    </main>
  );
}

function TrackerWorkspace({ data }: { data: AppData }) {
  const classes = Array.from(new Set(data.prospects.map((prospect) => prospect.draft_year))).sort((a, b) => b - a);
  const classRows = classes.map((year) => {
    const rows = data.prospects.filter((prospect) => prospect.draft_year === year);
    return {
      year,
      rows: rows.length,
      top: rows.sort((a, b) => a.rank_in_class - b.rank_in_class)[0]?.player ?? "-",
      avgTotal: rows.reduce((sum, row) => sum + row.TOTAL_pred, 0) / Math.max(1, rows.length)
    };
  });

  return (
    <main className="workspace split-preview">
      <section className="table-panel">
        <div className="panel-heading">
          <div>
            <h2>Draft Tracker</h2>
            <p>Model accountability staging</p>
          </div>
        </div>
        <div className="table-wrap compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Prospects</th>
                <th>Model #1</th>
                <th>Avg Total</th>
              </tr>
            </thead>
            <tbody>
              {classRows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{row.rows}</td>
                  <td>{row.top}</td>
                  <td>{formatNumber(row.avgTotal, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="detail-panel wide">
        <h2>Next Build Slice</h2>
        <p className="note">Analyst boards, actual draft order, weighted realized value, and year-by-year accuracy scoring need one normalized tracker export.</p>
      </section>
    </main>
  );
}

function ScoreBar({ value }: { value: number }) {
  return (
    <span className="scorebar" style={scoreStyle(value)}>
      <span style={{ width: `${clamp(value, 0, 100)}%` }} />
      <strong>{formatNumber(value, 0)}</strong>
    </span>
  );
}

function scoreStyle(value: number): CSSProperties {
  const score = clamp(value, 0, 100);
  const pivot = score / 100;
  const eased = pivot < 0.82 ? pivot * 0.48 : 0.48 + ((pivot - 0.82) / 0.18) * 0.52;
  const hue = 4 + clamp(eased, 0, 1) * 158;
  const saturation = 82 - Math.max(0, score - 92) * 0.7;
  const lightness = 47 + Math.max(0, score - 70) * 0.22;
  return {
    "--score-fill": `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`
  } as CSSProperties;
}

function scaleStyle(value: number): CSSProperties {
  const scale = clamp(value, 0, 2.5);
  const hue = interpolateColor(scale, [
    [0, 2],
    [0.5, 7],
    [0.8, 48],
    [1.0, 118],
    [2.0, 156]
  ]);
  const lightness = interpolateColor(scale, [
    [0, 47],
    [0.5, 49],
    [0.8, 51],
    [1.0, 49],
    [2.0, 55]
  ]);
  return {
    "--scale-fill": `hsl(${hue.toFixed(1)} 76% ${lightness.toFixed(1)}%)`
  } as CSSProperties;
}

function rateStyle(value: number): CSSProperties {
  const rate = clamp(value, -3, 6);
  const hue = interpolateColor(rate, [
    [-3, 2],
    [-1, 8],
    [0, 72],
    [0.45, 112],
    [2, 146],
    [6, 162]
  ]);
  const lightness = interpolateColor(rate, [
    [-3, 47],
    [0, 50],
    [2, 53],
    [6, 58]
  ]);
  return {
    "--rate-fill": `hsl(${hue.toFixed(1)} 76% ${lightness.toFixed(1)}%)`
  } as CSSProperties;
}

function skillStyle(value: number): CSSProperties {
  const rateVars = rateStyle(value) as CSSProperties & { "--rate-fill": string };
  return {
    "--skill-fill": rateVars["--rate-fill"]
  } as CSSProperties;
}

function interpolateColor(value: number, stops: Array<[number, number]>): number {
  for (let index = 0; index < stops.length - 1; index += 1) {
    const [fromValue, fromColor] = stops[index];
    const [toValue, toColor] = stops[index + 1];
    if (value <= toValue) {
      const pct = (value - fromValue) / Math.max(0.001, toValue - fromValue);
      return fromColor + (toColor - fromColor) * clamp(pct, 0, 1);
    }
  }
  return stops[stops.length - 1][1];
}

function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const formatted = formatNumber(value, digits);
  return value > 0 ? `+${formatted}` : formatted;
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
  const width = 320;
  const height = 150;
  const coords = points.map((point, index) => {
    const x = 20 + index * ((width - 40) / (points.length - 1));
    const y = height - 24 - ((point.value - min) / Math.max(1, max - min)) * (height - 48);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <section>
      <h3>Projection Arc</h3>
      <svg className="projection" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player projection line">
        <line x1="20" x2={width - 20} y1={height - 24} y2={height - 24} />
        <path d={path} />
        {coords.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text x={point.x} y={height - 6} textAnchor="middle">{point.label}</text>
          </g>
        ))}
      </svg>
    </section>
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

function passesColumnFilters(player: PlayerImpact, filters: Partial<Record<FilterKey, string>>): boolean {
  return (Object.entries(filters) as Array<[FilterKey, string]>).every(([key, raw]) => {
    const filter = raw.trim();
    if (!filter) return true;
    const value = player[key];
    if (typeof value === "number") return passesNumericFilter(value, filter);
    return passesTextFilter(String(value ?? ""), filter);
  });
}

function passesTextFilter(value: string, filter: string): boolean {
  const trimmed = filter.trim();
  const exact = trimmed.match(/^=(.*)$/);
  if (exact) return value.toLowerCase() === exact[1].trim().toLowerCase();
  return value.toLowerCase().includes(trimmed.toLowerCase());
}

function passesNumericFilter(value: number, filter: string): boolean {
  if (!Number.isFinite(value)) return false;
  const range = filter.match(/^\s*(-?\$?[\d,.]+)\s*([mk])?\s*(?:\.\.|-)\s*(-?\$?[\d,.]+)\s*([mk])?\s*$/i);
  if (range) {
    const low = parseNumericToken(range[1], range[2]);
    const high = parseNumericToken(range[3], range[4]);
    return value >= Math.min(low, high) && value <= Math.max(low, high);
  }

  const clauses = filter.match(/(>=|<=|>|<|=)?\s*-?\$?[\d,.]+\s*[mk]?/gi);
  if (!clauses) return String(value).includes(filter);
  return clauses.every((clause) => passesNumericClause(value, clause));
}

function passesNumericClause(value: number, filter: string): boolean {
  const match = filter.trim().match(/^(>=|<=|>|<|=)?\s*(-?\$?[\d,.]+)\s*([mk])?$/i);
  if (!match) return false;
  const op = match[1] ?? "=";
  const target = parseNumericToken(match[2], match[3]);
  if (op === ">") return value > target;
  if (op === ">=") return value >= target;
  if (op === "<") return value < target;
  if (op === "<=") return value <= target;
  return Math.abs(value - target) < 0.0001;
}

function parseNumericToken(token: string, suffix?: string): number {
  const base = Number(token.replace(/[$,]/g, ""));
  if (suffix?.toLowerCase() === "m") return base * 1_000_000;
  if (suffix?.toLowerCase() === "k") return base * 1_000;
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

export default App;
