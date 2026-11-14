import { useState } from "react";
import type { InjuryOutlookData, InjuryOutlookRow, PlayerImpact } from "./types";
import "./injuryOutlook.css";

function dateLabel(value: string | null | undefined): string {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
}

export function absenceLabel(row: InjuryOutlookRow): string {
  if (row.season_ending) return "Rest of season";
  if (row.return_earliest && row.return_latest && row.return_earliest !== row.return_latest) return `${dateLabel(row.return_earliest)} – ${dateLabel(row.return_latest)}`;
  if (row.return_expected) return `${dateLabel(row.return_expected)} (estimate)`;
  if (row.basis === "reevaluation") return `Review ${dateLabel(row.reevaluation_date)}; return unknown`;
  if (row.return_earliest) return `${dateLabel(row.return_earliest)} or later`;
  return "Return timetable unknown";
}

function gamesLabel(row: InjuryOutlookRow): string {
  if (row.games_missed_min != null && row.games_missed_max != null && row.games_missed_min !== row.games_missed_max) return `${row.games_missed_min}–${row.games_missed_max}`;
  if (row.games_missed_expected != null) return `~${row.games_missed_expected}`;
  if (row.games_missed_min != null) return `${row.games_missed_min}+`;
  return "Unknown";
}

export function injuryForPlayer(player: PlayerImpact, outlook?: InjuryOutlookData): InjuryOutlookRow | undefined {
  if (!outlook || player.year !== outlook.season) return undefined;
  const key = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z0-9]/g, "");
  const team = player.current_roster_team || player.roster_truth_team || player.team;
  return outlook.players.find((row) => row.name_key === key(player.player_name) && row.team === team);
}

export function PlayerInjuryNote({ injury, player }: { injury?: InjuryOutlookRow; player: PlayerImpact }) {
  const adjusted = player.injury_base_minutes != null && player.injury_minutes_delta != null && Math.abs(player.injury_minutes_delta) >= 1;
  if (!injury && !adjusted) return null;
  return <section className="injury-player-note" aria-label="Current injury outlook">
    {injury && <><strong>{injury.status} · {injury.injury_type}</strong><span>{absenceLabel(injury)}</span>
      <span>{gamesLabel(injury)} regular-season games remaining to miss · {injury.confidence} confidence</span></>}
    {adjusted && <><strong>Projected minutes: {Math.round(player.injury_base_minutes!).toLocaleString()} → {Math.round(player.Minutes).toLocaleString()}</strong>
      <span>{player.injury_projection_note || (player.injury_minutes_delta! > 0 ? "Additional rotation opportunity while teammates are unavailable." : "Rotation workload adjusted to the team's minutes budget.")}</span>
      <small>Included in team ratings and game-by-game win projections. {player.injury_base_games != null && player.games != null && `Expected appearances: ${player.injury_base_games.toFixed(1)} → ${player.games.toFixed(1)}.`}</small></>}
    {injury && <small>{injury.timeline_note} <a href={injury.source_url} target="_blank" rel="noreferrer">ESPN / RotoWire ↗</a></small>}
  </section>;
}

export function InjuryOutlookWorkspace({ outlook }: { outlook?: InjuryOutlookData }) {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("All");
  const [status, setStatus] = useState("All");
  if (!outlook) return <main className="injury-workspace"><section className="table-panel"><h2>Injury Outlook</h2><p>No injury refresh has been published yet. The next roster refresh will include current injury timelines.</p></section></main>;
  const stale = Date.now() - new Date(outlook.generated_at).getTime() > 24 * 60 * 60 * 1000;
  const rows = outlook.players.filter((row) => (team === "All" || row.team === team) && (status === "All" || row.status === status) && `${row.player_name} ${row.injury_type}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.games_missed_expected ?? b.games_missed_min ?? -1) - (a.games_missed_expected ?? a.games_missed_min ?? -1) || a.player_name.localeCompare(b.player_name));
  return <main className="injury-workspace">
    <section className="table-panel">
      <div className="injury-heading"><div><h2>Injury Outlook</h2><p>Remaining absences · {outlook.season - 1}–{String(outlook.season).slice(2)} regular season</p></div><div className="injury-timestamp"><span className={stale ? "injury-stale" : ""}>{stale ? "Snapshot over 24 hours old · " : ""}Updated {new Date(outlook.generated_at).toLocaleString()}</span><a href={outlook.source_url} target="_blank" rel="noreferrer">ESPN / RotoWire ↗</a></div></div>
      <div className="injury-summary"><span><strong>{outlook.players.length}</strong> listed players</span><span><strong>{outlook.players.filter((r) => r.season_ending).length}</strong> season-ending</span><span><strong>{outlook.players.filter((r) => !r.return_expected && !r.season_ending).length}</strong> without a point estimate</span><span><strong>{outlook.teams_checked}</strong> teams checked</span></div>
      <p className="injury-policy">These reports feed projected player minutes, replacement minutes, team ratings, and dated game odds. The forecast uses explicit availability assumptions when a return is uncertain; a re-evaluation is not clearance. The source outlook below keeps unknown timetables unknown. Source game counts exclude TBD Cup games except for season-ending absences; forecasts include estimated Cup slots. This live outlook shows the season above, independently of the historical season selector.</p>
      <div className="injury-filters"><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Player or injury" /></label><label>Team<select value={team} onChange={(event) => setTeam(event.target.value)}>{["All", ...new Set(outlook.players.map((r) => r.team).sort())].map((v) => <option key={v}>{v}</option>)}</select></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{["All", ...new Set(outlook.players.map((r) => r.status).sort())].map((v) => <option key={v}>{v}</option>)}</select></label><span>{rows.length} players</span></div>
      <div className="injury-table-scroll"><table className="injury-table"><thead><tr><th>Player</th><th>Status</th><th>Return outlook</th><th>Games to miss</th><th>Days remaining</th><th>Confidence / latest report</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.team}-${row.name_key}`}><td><strong>{row.player_name}</strong><span>{row.team} · {row.injury_type}</span></td><td><span className={`injury-status ${row.status === "Out" ? "out" : ""}`}>{row.status}</span></td><td><strong>{absenceLabel(row)}</strong><small>{row.timeline_note}</small>{row.provider_return_date && row.basis !== "provider_estimate" && <small>ESPN estimate: {dateLabel(row.provider_return_date)}</small>}</td><td><strong>{gamesLabel(row)}</strong>{row.games_missed_expected != null && row.games_missed_min != null && row.games_missed_max != null && row.games_missed_min !== row.games_missed_max && <small>Planning estimate: {row.games_missed_expected}</small>}</td><td>{row.season_ending ? "Rest of season" : row.days_remaining_min != null && row.days_remaining_max != null && row.days_remaining_min !== row.days_remaining_max ? `${row.days_remaining_min}–${row.days_remaining_max}` : row.days_remaining_expected != null ? `~${row.days_remaining_expected}` : row.days_remaining_min != null ? `${row.days_remaining_min}+` : "Unknown"}</td><td><strong>{row.confidence}</strong><small>{dateLabel(row.report_date)}{row.stale_report ? " · older report" : ""}</small><a href={row.source_url} target="_blank" rel="noreferrer">Source ↗</a></td></tr>)}</tbody></table>{rows.length === 0 && <p className="injury-empty">No current listings match these filters.</p>}</div>
    </section>
  </main>;
}
