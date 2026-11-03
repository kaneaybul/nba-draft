import { useMemo, useState } from 'react';

export type Change = { key: string; label: string; value: number };
export type HistoryPoint = { date: string; total: number; players: number; picks: number; reporting_cap: number; vintage: string };
export type LeagueTeam = { team: string; points?: HistoryPoint[] };
export type AttributionAnalysis = {
  start: string; end: string; opening: number; closing: number; change: number;
  categories: Record<string, number>; components: Record<string, Record<string, number>>;
  contributors: Record<string, { player: string; value: number }[]>;
  validation: { reconciliation_error: number };
};
export const money = (value: number) => `${value <= -50000 ? '−' : ''}$${(Math.abs(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
export const signedMoney = (value: number) => `${value >= 50000 ? '+' : ''}${money(value)}`;
export const categoryLabels = {
  player: 'Player Development & Aging', draft: 'Draft Value Added / Destroyed', timing: 'Rolling Window / Valuation Basis', trades: 'Trades',
  contracts: 'Contract Management', fa: 'FA Signings', own_picks: 'Own Pick Revaluation',
  acquired_picks: 'Acquired Pick Revaluation', lottery: 'Lottery Luck',
  pick_rules: 'Pick Rights / Rules', automatic: 'Automatic Pick Additions',
};
export type CategoryKey = keyof typeof categoryLabels;
export const rankingLabels = { change: 'Value change', ...categoryLabels, total: 'Total asset value', players: 'Player value', picks: 'Pick value' };
export type RankingMetric = keyof typeof rankingLabels;
const categoryKeys = Object.keys(categoryLabels) as CategoryKey[];
const categoryLabel = (key: string) => categoryLabels[key as CategoryKey];

export type AttributionInterval = {
  start: string; end: string; opening: number; closing: number;
  categories: Record<string, number>; components: Record<string, Record<string, number>>;
  contributors: Record<string, { player: string; value: number }[]>;
  reconciliation_error: number;
};
export type AttributionLedger = { team: string; method: string; valuation_method: string; intervals: AttributionInterval[] };
export function aggregateAttribution(ledger: AttributionLedger, start: string, end: string, opening: number, closing: number, valuationMethod?: string): AttributionAnalysis | null {
  if (ledger.method !== 'rolling-endpoint-attribution-v3' || ledger.valuation_method !== valuationMethod || start > end) return null;
  const rows = ledger.intervals.filter(row => start < row.end && row.end <= end);
  if (start !== end && (!rows.length || rows[0].start !== start || rows[rows.length - 1].end !== end)) return null;
  const categories = Object.fromEntries(Object.keys(categoryLabels).map(key => [key, 0]));
  const components: Record<string, Record<string, number>> = {};
  const contributions: Record<string, Record<string, number>> = {};
  let prior = start, value = opening;
  for (const row of rows) {
    if (row.start !== prior || Math.abs(row.opening - value) > .01 || !Number.isFinite(row.reconciliation_error) || Math.abs(row.reconciliation_error) > .01) return null;
    if (Object.keys(row.categories).length !== Object.keys(categoryLabels).length || Object.keys(categoryLabels).some(key => !Number.isFinite(row.categories[key]))) return null;
    if (Math.abs(row.opening + Object.values(row.categories).reduce((a, b) => a + b, 0) - row.closing) > .01) return null;
    for (const [key, amount] of Object.entries(row.categories)) {
      categories[key] += amount;
      components[key] ??= {};
      const parts = row.components[key];
      if (!parts || Math.abs(Object.values(parts).reduce((a, b) => a + b, 0) - amount) > .01) return null;
      for (const [label, part] of Object.entries(parts)) components[key][label] = (components[key][label] ?? 0) + part;
      contributions[key] ??= {};
      for (const c of row.contributors[key] ?? []) contributions[key][c.player] = (contributions[key][c.player] ?? 0) + c.value;
    }
    prior = row.end; value = row.closing;
  }
  const error = opening + Object.values(categories).reduce((a, b) => a + b, 0) - closing;
  if (Math.abs(value - closing) > .01 || Math.abs(error) > .01) return null;
  return { start, end, opening, closing, change: closing - opening, categories, components,
    contributors: Object.fromEntries(Object.entries(contributions).map(([key, people]) => [key, Object.entries(people).map(([player, value]) => ({ player, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))])), validation: { reconciliation_error: error } };
}

export function Waterfall({ opening, closing, changes, analysis }: {
  opening: number; closing: number; changes: Change[]; analysis: AttributionAnalysis;
}) {
  const [active, setActive] = useState<string | null>(null);
  const error = opening + changes.reduce((sum, row) => sum + row.value, 0) - closing;
  if (![opening, closing, ...changes.map(row => row.value)].every(Number.isFinite) || Math.abs(error) > .01) {
    return <p role="status">The category breakdown is unavailable for this period. Total change: {signedMoney(closing - opening)}.</p>;
  }
  let running = opening;
  const rows = [
    { key: 'opening', label: 'Starting value', value: opening, from: 0, to: opening, total: true },
    ...changes.map(row => { const from = running; running += row.value; return { ...row, label: categoryLabel(row.key) ?? row.label, from, to: running, total: false }; }),
    { key: 'closing', label: 'Ending value', value: closing, from: 0, to: closing, total: true },
  ];
  const low = Math.min(0, ...rows.flatMap(row => [row.from, row.to]));
  const high = Math.max(0, ...rows.flatMap(row => [row.from, row.to]));
  const span = Math.max(1, high - low);
  const y = (value: number) => 300 - (value - low) / span * 250;
  const width = Math.max(850, rows.length * 100 + 90);
  const step = (width - 90) / rows.length;
  const picked = changes.find(row => row.key === active);
  return <>
    <div className="ah-waterfall-scroll" tabIndex={0} aria-label="Asset value waterfall, scroll horizontally">
      <svg viewBox={`0 0 ${width} 405`} style={{ minWidth: width }} role="img" aria-label={`Asset value changed from ${money(opening)} to ${money(closing)}`}>
        <title>Asset value waterfall</title>
        {[0, .5, 1].map(t => { const value = low + t * span; return <g key={t}><line x1="75" x2={width - 10} y1={y(value)} y2={y(value)} stroke="currentColor" opacity=".15"/><text x="0" y={y(value) + 4}>{money(value)}</text></g>; })}
        {rows.map((row, index) => {
          const x = 85 + index * step;
          const top = y(Math.max(row.from, row.to));
          return <g key={row.key}>
            {index > 0 && <line x1={x - step + 62} x2={x} y1={y(rows[index - 1].to)} y2={y(rows[index - 1].to)} stroke="currentColor" opacity=".4" strokeDasharray="3 3"/>}
            <rect x={x} y={top} width="62" height={Math.max(1, Math.abs(y(row.from) - y(row.to)))} rx="3" fill={row.total ? '#88a9e8' : row.value >= 0 ? '#6bd4c3' : '#f18f99'}><title>{`${row.label}: ${row.total ? money(row.value) : signedMoney(row.value)}`}</title></rect>
            <text x={x + 31} y={top - 9} textAnchor="middle">{row.total ? money(row.value) : signedMoney(row.value)}</text>
            <text x={x + 31} y="330" textAnchor="middle">{row.label.split(' ').reduce<string[][]>((lines, word) => { const line = lines[lines.length - 1]; if (line.join(' ').length + word.length > 15) lines.push([word]); else line.push(word); return lines; }, [[]]).map((words, line) => <tspan key={line} x={x + 31} dy={line ? 16 : 0}>{words.join(' ')}</tspan>)}</text>
          </g>;
        })}
      </svg>
    </div>
    <div className="ah-change-chips" aria-label="Change categories">{changes.map(row => <button key={row.key} aria-pressed={active === row.key} onClick={() => setActive(active === row.key ? null : row.key)}><span>{categoryLabel(row.key) ?? row.label}</span><strong className={row.value >= 0 ? 'ah-positive' : 'ah-negative'}>{signedMoney(row.value)}</strong></button>)}</div>
    {picked && <section className="ah-drilldown"><h3>{categoryLabel(picked.key) ?? picked.label}</h3>
      {analysis.components[picked.key] && <ul>{Object.entries(analysis.components[picked.key]).map(([label, value]) => <li key={label}><span>{label}</span><strong>{signedMoney(value)}</strong></li>)}</ul>}
      {!!analysis.contributors[picked.key]?.length && <><h4>Largest contributors</h4><ul>{analysis.contributors[picked.key].map(row => <li key={row.player}><span>{row.player}</span><strong>{signedMoney(row.value)}</strong></li>)}</ul></>}
    </section>}
  </>;
}

export type LeagueRow = {
  team: string; total: number; change: number; players: number; picks: number;
  categories: Record<string, number> | null;
};
export function leagueRows(teams: LeagueTeam[], ledgers: Record<string, AttributionLedger>, start: string, end: string, cap: number, valuationMethod?: string): LeagueRow[] {
  return teams.flatMap(team => {
    const first = team.points?.find(point => point.date === start && point.reporting_cap === cap);
    const last = team.points?.find(point => point.date === end && point.reporting_cap === cap);
    if (!first || !last || ![first.total, last.total, last.players, last.picks].every(Number.isFinite)) return [];
    const ledger = ledgers[team.team];
    const analysis = ledger?.team === team.team ? aggregateAttribution(ledger, start, end, first.total, last.total, valuationMethod) : null;
    return [{ team: team.team, total: last.total, change: last.total - first.total, players: last.players, picks: last.picks, categories: analysis?.categories ?? null }];
  });
}
export const leagueMetricValue = (row: LeagueRow, metric: RankingMetric): number | undefined =>
  metric in categoryLabels ? row.categories?.[metric] : row[metric as 'change' | 'total' | 'players' | 'picks'];
export function rankLeague(rows: LeagueRow[], metric: RankingMetric) {
  return rows.flatMap(row => {
    const value = leagueMetricValue(row, metric);
    return value !== undefined && Number.isFinite(value) ? [{ ...row, value }] : [];
  }).sort((a, b) => b.value - a.value || a.team.localeCompare(b.team));
}
export function LeagueComparison({ metric: selectedMetric, onMetricChange, teams, ledgers = {}, valuationMethod, loading = false, start, end, cap, selectedTeam, onSelect }: {
  metric?: RankingMetric; onMetricChange?: (metric: RankingMetric) => void;
  teams: LeagueTeam[]; ledgers?: Record<string, AttributionLedger>; valuationMethod?: string; loading?: boolean;
  start: string; end: string; cap: number; selectedTeam: string; onSelect: (team: string) => void;
}) {
  const [localMetric, setLocalMetric] = useState<RankingMetric>('change');
  const metric = selectedMetric ?? localMetric;
  const setMetric = onMetricChange ?? setLocalMetric;
  const rows = useMemo(() => leagueRows(teams, ledgers, start, end, cap, valuationMethod), [teams, ledgers, start, end, cap, valuationMethod]);
  const comparable = rankLeague(rows, metric);
  const missing = teams.filter(team => !comparable.some(row => row.team === team.team));
  const missingDates = teams.filter(team => !rows.some(row => row.team === team.team));
  const missingAttribution = rows.filter(row => !row.categories);
  const extent = Math.max(1, ...comparable.map(row => Math.abs(row.value)));
  const rank = comparable.findIndex(row => row.team === selectedTeam);
  const net = comparable.reduce((sum, row) => sum + row.value, 0);
  const label = rankingLabels[metric];
  const isChange = metric === 'change' || metric in categoryLabels;
  const format = isChange ? signedMoney : money;
  const columns: RankingMetric[] = ['total', 'change', ...categoryKeys, 'players', 'picks'];
  return <section className="ah-league-panel">
    <div className="ah-chart-heading"><div><h2>Across the league</h2><p className="ah-caption">{start} → {end} · {comparable.length} teams with matching {metric in categoryLabels ? 'waterfalls, dates and cap' : 'dates and cap'}</p></div><label>Rank by<select value={metric} onChange={event => setMetric(event.target.value as RankingMetric)}>{Object.entries(rankingLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></div>
    <div className="ah-stats ah-league-stats"><div><span>{selectedTeam} rank · {label}</span><strong>{rank >= 0 ? `${rank + 1} / ${comparable.length}` : 'Unavailable'}</strong></div><div><span>League combined · {label}</span><strong className={net >= 0 ? 'ah-positive' : 'ah-negative'}>{comparable.length ? format(net) : '—'}</strong></div><div><span>Highest · {label}</span><strong>{comparable[0]?.team ?? '—'}</strong></div><div><span>Lowest · {label}</span><strong>{comparable[comparable.length - 1]?.team ?? '—'}</strong></div></div>
    {loading && <p role="status" className="ah-caption">Loading league waterfall categories…</p>}
    {!loading && !comparable.length && <p role="status">No validated league data is available for this category and period.</p>}
    <div className="ah-ranking">{comparable.map((row, index) => <button key={row.team} className={row.team === selectedTeam ? 'ah-selected-team' : ''} onClick={() => onSelect(row.team)} aria-label={`${index + 1}. ${row.team}, ${label}: ${format(row.value)}`}><span className="ah-rank">{index + 1}</span><strong>{row.team}</strong><span className="ah-rank-track"><span className={row.value >= 0 ? 'ah-bar-positive' : 'ah-bar-negative'} style={{ left: row.value >= 0 ? '50%' : `${50 - Math.abs(row.value) / extent * 50}%`, width: `${Math.abs(row.value) / extent * 50}%` }}/></span><span>{format(row.value)}</span></button>)}</div>
    {!!missingDates.length && <p className="ah-caption">Missing matching observations: {missingDates.map(team => team.team).join(', ')}.</p>}
    {!loading && !!missingAttribution.length && <p className="ah-caption">Waterfall categories unavailable: {missingAttribution.map(row => row.team).join(', ')}. These teams are excluded from category rankings.</p>}
    {!!missing.length && metric in categoryLabels && <p className="ah-caption">Category ranking covers {comparable.length} of {teams.length} teams.</p>}
    <details className="ah-method"><summary>Full league table</summary><div className="ah-table ah-league-table" tabIndex={0} aria-label="League values and waterfall categories, scroll horizontally"><table><thead><tr><th scope="col">Rank</th><th scope="col">Team</th>{columns.map(key => <th key={key} scope="col" aria-sort={metric === key ? 'descending' : 'none'}><button onClick={() => setMetric(key)}>{rankingLabels[key]}</button></th>)}</tr></thead><tbody>{comparable.map((row, index) => <tr key={row.team}><td>{index + 1}</td><td>{row.team}</td>{columns.map(key => { const value = leagueMetricValue(row, key); return <td key={key}>{value === undefined ? '—' : key === 'change' || key in categoryLabels ? signedMoney(value) : money(value)}</td>; })}</tr>)}</tbody></table></div></details>
    <p className="ah-caption">Category rankings use the same waterfall amounts and selected dates. The categories sum to value change.</p>
  </section>;
}
