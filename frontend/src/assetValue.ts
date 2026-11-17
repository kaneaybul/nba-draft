import type { CapTrackerData, PickAsset, PlayerImpact } from "./types";

// Shared with Asset History's peak4-payroll-0.8 model. Scale remains a
// diagnostic; it must not multiply an asset quote a second time.
export const PAYROLL_OPPORTUNITY_WEIGHT = 0.8;
export const ASSET_REPORTING_CAP = 164_961_000;

export type AnnualAssetValue = { production: number; asset: number; exposure: number };
export type AssetValuationData = {
  method?: string;
  history_version?: string;
  asset_history_version?: string;
  current_generated_at?: string;
  current_quote_source_method?: string;
  current_observation_date?: string;
  pick_observation_date?: string;
  historical_quote_release?: { method: string; history_version: string; generated_at: string };
  generated_at: string;
  observation_date: string;
  season: number;
  reporting_cap: number;
  players: Record<string, NonNullable<PlayerImpact["asset_valuation"]>>;
  slots: Record<string, number>;
  picks: Array<{ team: string; origin: string; year: number; round: number; value: number }>;
  reviewed_pick_ownership?: Array<{ team: string; origin: string; year: number; round: number; value: number; source_url: string }>;
  seasons?: Record<string, { observation_date: string; path: string }>;
};

export function annualAssetValue(production: number, salary: number, unsigned = false): AnnualAssetValue | null {
  if (!Number.isFinite(production) || !Number.isFinite(salary) || salary < 0) return null;
  const asset = production + PAYROLL_OPPORTUNITY_WEIGHT * (production - salary);
  // Hypothetical unsigned service can be declined. Zero both legs so declining
  // a negative-production year never creates an artificial contract bonus.
  return unsigned && asset < 0
    ? { production: 0, asset: 0, exposure: 1 }
    : { production, asset, exposure: 1 };
}

export function fourYearAssetQuote(rows: AnnualAssetValue[]): number | null {
  if (rows.some((row) => !Number.isFinite(row.production) || !Number.isFinite(row.asset)
    || !Number.isFinite(row.exposure) || row.exposure <= 0 || row.exposure > 1)
    || Math.abs(rows.reduce((sum, row) => sum + row.exposure, 0) - 4) > 1e-8) return null;
  let remaining = 2;
  let peakProduction = 0;
  for (const row of [...rows].sort((a, b) => b.production - a.production)) {
    const selected = Math.min(remaining, row.exposure);
    peakProduction += row.production * selected;
    remaining -= selected;
  }
  // Select on production, then include EVERY signed contract adjustment.
  // Selecting the best asset years would hide bad contracts in weaker years.
  return 2 * peakProduction + rows.reduce((sum, row) => sum + (row.asset - row.production) * row.exposure, 0);
}

export function playerValueExposures(player: PlayerImpact): Array<{ horizon: number; exposure: number }> {
  const games = finite(player.minutes_remaining_team_games);
  const fraction = games === null ? 1 : Math.max(0, Math.min(1, games / 82));
  return [fraction, 1, 1, 1, 1 - fraction]
    .map((exposure, horizon) => ({ horizon, exposure }))
    .filter((row) => row.exposure > 1e-12);
}

function playerAnnualValue(player: PlayerImpact, horizon: number, forward = false): AnnualAssetValue | null {
  let production = numberAt(player, horizon === 0 ? "value" : `projection_value_y${horizon}`);
  if (production === null) return null;
  const signedSalary = numberAt(player, horizon === 0 ? "contract" : `projection_contract_y${horizon}`);
  const status = horizon === 0 ? String(player.contract_status ?? "").trim() : "";
  const unsigned = horizon === 0
    ? ["UFA", "RFA", "Rookie"].includes(status) || player.pool_status === "free_agent" || signedSalary === null
    : signedSalary === null || signedSalary <= 0;
  const salary = unsigned
    ? numberAt(player, horizon === 0 ? "fa_value" : `projection_effective_contract_y${horizon}`)
      ?? numberAt(player, `projection_fa_value_y${horizon}`)
    : signedSalary;
  if (salary === null) return null;
  if (horizon === 0 && forward) {
    const fraction = playerValueExposures(player).find((row) => row.horizon === 0)?.exposure;
    const minutes = finite(player.Minutes);
    const remainingMinutes = finite(player.minutes_remaining);
    if (fraction && minutes !== null && minutes > 0 && remainingMinutes !== null) {
      production *= Math.max(0, remainingMinutes) / minutes / fraction;
    }
  }
  const annual = annualAssetValue(production, salary, unsigned);
  if (!annual) return null;
  const cap = player.valuation_salary_caps?.[horizon];
  if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0)) return null;
  const rebase = cap === undefined ? 1 : ASSET_REPORTING_CAP / cap;
  return { production: annual.production * rebase, asset: annual.asset * rebase, exposure: 1 };
}

export function playerSeasonAssetValue(player: PlayerImpact, horizon = 0): number | null {
  const canonical = player.asset_valuation?.annual.find((row) => row.season === player.year + horizon);
  if (canonical && Number.isFinite(canonical.asset)) return canonical.asset;
  if (player.valuation_quote_required) return null;
  return playerAnnualValue(player, horizon)?.asset ?? null;
}

export function playerFourYearAssetValue(player: PlayerImpact): number | null {
  if (player.asset_valuation && Number.isFinite(player.asset_valuation.value)) return player.asset_valuation.value;
  if (player.valuation_quote_required) return null;
  const rows: AnnualAssetValue[] = [];
  for (const { horizon, exposure } of playerValueExposures(player)) {
    const annual = playerAnnualValue(player, horizon, true);
    if (!annual) return null;
    rows.push({ ...annual, exposure });
  }
  return fourYearAssetQuote(rows);
}

// These are slice-specific annualized production rates from the rolling
// 328-team-game forecast, before options, draft padding or payroll economics.
// Annual asset rows supply ONLY exposure. Multiply the raw rate once, never
// reuse the calibrated/continuation-floored annual production or peak quote.
export function playerRollingFourYearProduction(player: PlayerImpact): number | null {
  const quote = player.asset_valuation;
  const raw = quote?.raw_annual_production;
  const annual = quote?.annual;
  if (!raw?.length || !annual?.length || raw.length !== annual.length) return null;
  const rates = new Map<number, number>();
  for (const row of raw) {
    if (!Number.isInteger(row.season) || !Number.isFinite(row.production) || rates.has(row.season)) return null;
    rates.set(row.season, row.production);
  }
  const seen = new Set<number>();
  let exposure = 0;
  let production = 0;
  for (const row of annual) {
    const rate = rates.get(row.season);
    if (rate === undefined || seen.has(row.season) || !Number.isFinite(row.exposure)
      || row.exposure <= 0 || row.exposure > 1) return null;
    seen.add(row.season);
    exposure += row.exposure;
    production += rate * row.exposure;
  }
  return Math.abs(exposure - 4) <= 1e-8 && Number.isFinite(production) ? production : null;
}

// These are the exporter's salary caps, never projection_cap_yN (which is a
// payroll/Scale budget). Attach once at ingestion, leaving production and
// market salary inputs intact for forecasting and free-agent pricing.
const HISTORICAL_SALARY_CAPS: Record<number, number> = {
  2016: 70_000_000, 2017: 94_143_000, 2018: 99_093_000, 2019: 101_869_000,
  2020: 109_140_000, 2021: 109_140_000, 2022: 112_414_000, 2023: 123_655_000,
  2024: 136_021_000, 2025: 140_588_000, 2026: 154_647_000
};

export function withAssetValueContext(players: PlayerImpact[], capTracker?: CapTrackerData, valuations?: AssetValuationData): PlayerImpact[] {
  const caps = new Map(capTracker?.seasons.map((row) => [row.year, row.salary_cap]) ?? []);
  return players.map((player) => ({
    ...player,
    valuation_quote_required: valuations !== undefined,
    asset_valuation: player.year === valuations?.season
      ? valuations.players[String(player.source_nba_id ?? player.nba_id)] ?? valuations.players[String(player.nba_id)]
      : undefined,
    valuation_salary_caps: Array.from({ length: 5 }, (_, horizon) => {
      const year = player.year + horizon;
      // The asset engine fixes the reporting season to the reporting cap.
      return year === 2027 ? ASSET_REPORTING_CAP : caps.get(year)
        ?? HISTORICAL_SALARY_CAPS[year] ?? ASSET_REPORTING_CAP * 1.05 ** (year - 2027);
    })
  }));
}

export function withAssetPickValues(picks: PickAsset[], valuations?: AssetValuationData): PickAsset[] {
  if (!valuations) return picks;
  // The generic future-picks feed can lag an officially reviewed transaction.
  // Replace only reviewed, fully owned physical picks with the replay's current owner.
  for (const right of valuations.reviewed_pick_ownership ?? []) {
    picks = picks.filter((pick) => !(pick.asset_type !== "slot_value" && pick.origin_team === right.origin
      && pick.draft_year === right.year && pick.round === right.round));
    picks.push({ asset_id: `reviewed-pick-${right.origin}-${right.year}-${right.round}`, team: right.team,
      origin_team: right.origin, draft_year: right.year, round: right.round, pick: right.round === 1 ? 15 : 45,
      label: `${right.year} ${right.origin} ${right.round === 1 ? "1st" : "2nd"} (unprotected)`,
      asset_type: "team_pick", value: right.value, normalized: 0, protection: "Unprotected",
      convey_probability: 1, source_url: right.source_url, description: "Ownership verified against the complete trade package and current legal replay." });
  }
  const key = (team: string, origin: string, year: number, round: number) => `${team}:${origin}:${year}:${round}`;
  const rights = new Map<string, number>();
  for (const pick of valuations.picks) {
    const id = key(pick.team, pick.origin, pick.year, pick.round);
    rights.set(id, (rights.get(id) ?? 0) + pick.value);
  }
  const groups = new Map<string, PickAsset[]>();
  for (const pick of picks) {
    if (!pick.team || !pick.origin_team || !pick.draft_year) continue;
    const id = key(pick.team, pick.origin_team, pick.draft_year, pick.round);
    groups.set(id, [...(groups.get(id) ?? []), pick]);
  }
  const slots = Object.entries(valuations.slots).map(([pick, value]) => ({ pick: Number(pick), value })).sort((a, b) => a.pick - b.pick);
  const curveAt = (selection: number) => {
    const lower = [...slots].reverse().find((slot) => slot.pick <= selection) ?? slots[0];
    const upper = slots.find((slot) => slot.pick >= selection) ?? slots[slots.length - 1];
    if (!lower || !upper) return null;
    const weight = upper.pick === lower.pick ? 0 : (selection - lower.pick) / (upper.pick - lower.pick);
    return lower.value * (1 - weight) + upper.value * weight;
  };
  return picks.map((pick) => {
    const slot = valuations.slots[String(pick.pick)];
    if (pick.asset_type === "slot_value" && Number.isFinite(slot)) {
      return { ...pick, value: slot, source: "asset_history_peak4_payroll_0.8" };
    }
    const id = key(pick.team ?? "", pick.origin_team ?? "", pick.draft_year ?? 0, pick.round);
    const matched = rights.get(id);
    // Preserve the existing legal-right identity and protection metadata. Only a
    // unique right can receive an exact portfolio quote; do not duplicate a
    // physical pick's EV across distinct swap/rollover claims.
    const exact = groups.get(id)?.length === 1 ? matched : undefined;
    if (exact === undefined && pick.team && pick.origin_team && pick.draft_year) {
      return { ...pick, value_priced: false, source: "asset_history_unresolved_legal_claim",
        description: "This legal claim could not be matched uniquely to the published portfolio; its trade value is unavailable." };
    }
    const expected = curveAt(pick.expected_pick ?? pick.pick);
    const probability = pick.convey_probability ?? (pick.asset_type === "pick_swap" ? 0.5 : 1);
    const value = exact ?? (expected === null ? pick.value : expected * probability);
    return { ...pick, value, value_priced: true, source: exact !== undefined ? "asset_history_joint_rights_quote" : "asset_history_peak4_payroll_0.8_curve" };
  });
}

function numberAt(player: PlayerImpact, key: string): number | null {
  return finite(player[key as keyof PlayerImpact]);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

