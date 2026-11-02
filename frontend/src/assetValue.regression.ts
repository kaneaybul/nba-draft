import { annualAssetValue, ASSET_REPORTING_CAP, fourYearAssetQuote, playerFourYearAssetValue, playerSeasonAssetValue, playerValueExposures, withAssetPickValues, withAssetValueContext, type AssetValuationData } from "./assetValue";
import { futureScale4y, futureValue4y, getPlayerSortValue, playerTradeValue } from "./App";
import { playerTradeMachineAsset } from "./tradeMachine";
import type { PickAsset, PlayerImpact } from "./types";

export function runAssetValueRegressionTests(): string[] {
  expect(annualAssetValue(20, 10)?.asset === 28, "cheap production receives a payroll bonus");
  expect(annualAssetValue(20, 30)?.asset === 12, "expensive production receives a payroll penalty");
  expect(annualAssetValue(0, 10)?.asset === -8, "signed salary survives a full injury absence");
  const declined = annualAssetValue(-10, 5, true)!;
  expect(declined.asset === 0 && declined.production === 0, "declining unsigned service zeros both quote legs");

  const badContract = [10, 20, 30, 40].map((production, i) => annualAssetValue(production, [5, 100, 5, 5][i])!);
  expect(fourYearAssetQuote(badContract) === 128, "the best production years cannot hide an expensive weak year");
  expect(fourYearAssetQuote(badContract.slice(1)) === null, "a partial horizon is unavailable, not a sum over missing years");

  const cheap = player(20, 10);
  const expensive = player(20, 30);
  expect(playerFourYearAssetValue(cheap) === 112, "four flat cheap seasons match the asset methodology");
  expect(playerFourYearAssetValue(expensive) === 48, "four flat expensive seasons match the asset methodology");
  expect(playerSeasonAssetValue(cheap) === 28, "annual asset value retains the current asset methodology");
  expect(futureValue4y(cheap) === 80 && futureValue4y(expensive) === 80, "the Player Impact 4Y Value sums production independently of salary");
  expect(getPlayerSortValue(cheap, "value") === 20 && getPlayerSortValue(expensive, "value") === 20, "Value sorting and filters use original single-season production");
  expect(getPlayerSortValue(cheap, "asset_value") === 112 && getPlayerSortValue(expensive, "asset_value") === 48, "the separate Asset Value column keeps contract economics");
  const scales = { ...cheap, minutes_remaining_team_games: 41, scalability: 0.8, projection_scalability_y1: 1.2, projection_scalability_y2: 0.6, projection_scalability_y3: 1.4, projection_scalability_y4: 4 };
  expect(futureScale4y(scales) === 1, "4Y Scale restores the current-plus-three-year arithmetic average");
  expect(playerTradeValue(cheap) === playerFourYearAssetValue(cheap), "the Asset Value column and trade suggestions use one four-year quote");
  expect(playerTradeMachineAsset(cheap, "UTA").tradeValue === playerFourYearAssetValue(cheap), "direct trade-engine assets use the same quote");
  expect(playerFourYearAssetValue({ ...cheap, scalability: 99, projection_scalability_y1: 0 }) === 112, "diagnostic Scale cannot alter asset value");
  const missing = { ...cheap, projection_value_y2: null };
  expect(playerFourYearAssetValue(missing) === null && playerTradeMachineAsset(missing, "UTA").valuePriced === false,
    "missing forecast years cannot be priced as zero in trades");

  const rolling = { ...cheap, minutes_remaining_team_games: 41, Minutes: 2000, minutes_remaining: 1000 };
  expect(playerValueExposures(rolling).reduce((sum, row) => sum + row.exposure, 0) === 4, "a half-played season still quotes exactly four forward season-equivalents");
  expect(playerFourYearAssetValue(rolling) === 112, "partial first and final seasons keep identical flat economics");
  expect(playerFourYearAssetValue({ ...rolling, projection_value_y4: null }) === null, "a rolling quote requires the fractional final year");

  const lastHalf = { ...rolling, projection_value_y4: 100, projection_contract_y4: 10 };
  expect(playerFourYearAssetValue(lastHalf) === 224, "a half-season of peak talent cannot count as a full peak year");
  const normalized = { ...cheap, valuation_salary_caps: [1, 2, 4, 8, 16].map((x) => x * ASSET_REPORTING_CAP) };
  Object.assign(normalized, {
    projection_value_y1: 40, projection_value_y2: 80, projection_value_y3: 160,
    projection_contract_y1: 20, projection_contract_y2: 40, projection_contract_y3: 80
  });
  expect(playerFourYearAssetValue(normalized) === 112, "cap inflation alone cannot increase the four-year asset quote");
  const ingested = withAssetValueContext([cheap])[0];
  expect(ingested.value === cheap.value && ingested.scalability === cheap.scalability, "ingestion preserves production and diagnostic Scale inputs");
  expect(ingested.valuation_salary_caps?.[0] === ASSET_REPORTING_CAP, "the reporting year uses Asset History's reporting cap");
  const published: AssetValuationData = {
    generated_at: "2026-11-01", observation_date: "2026-11-01", season: 2027, reporting_cap: ASSET_REPORTING_CAP,
    players: { "1": { date: "2026-11-01", value: 123, annual: [{ season: 2027, production: 25, asset: 35, exposure: 1 }] } },
    slots: { "1": 200, "2": 100 }, picks: [{ team: "UTA", origin: "CLE", year: 2028, round: 1, value: 75 }]
  };
  const canonical = withAssetValueContext([cheap], undefined, published)[0];
  expect(playerSeasonAssetValue(canonical) === 35 && playerFourYearAssetValue(canonical) === 123,
    "published canonical quotes override separate forecast inputs on every live surface");
  expect(playerTradeValue(canonical) === 123 && playerTradeMachineAsset(canonical, "UTA").tradeValue === 123,
    "Asset Value and both trade entry points exactly match the published inventory");
  expect(futureValue4y(canonical) === 80 && getPlayerSortValue(canonical, "value") === 20,
    "canonical asset quotes must not replace the Player Impact production columns");
  expect(getPlayerSortValue(canonical, "asset_value") === 123 && getPlayerSortValue(canonical, "future_value_4y") === 80,
    "Asset Value and 4Y Value sorting and filtering stay distinct");
  const picks = withAssetPickValues([
    { asset_id: "slot1", asset_type: "slot_value", pick: 1, value: 1 },
    { asset_id: "right", asset_type: "team_pick", pick: 2, expected_pick: 2, team: "UTA", origin_team: "CLE", draft_year: 2028, round: 1, value: 10 }
  ] as PickAsset[], published);
  expect(picks[0].value === 200 && picks[1].value === 75, "trade picks use the asset curve and exact uniquely matched rights quote");
  return [
    "annual value rewards cheap production and preserves signed liabilities",
    "best-two production includes every four-year contract adjustment",
    "Player Impact production columns remain separate from asset and trade values",
    "rolling horizons handle partial seasons and unavailable years",
    "unsigned continuation and constant-cap reporting match the asset method"
  ];
}

function player(production: number, salary: number): PlayerImpact {
  return {
    nba_id: 1, player_name: "Asset fixture", team: "UTA", year: 2027,
    value: production, contract: salary, contract_status: "Signed", Minutes: 2000,
    scalability: 1, trade_value: 999999, fa_value: salary,
    projection_value_y1: production, projection_value_y2: production,
    projection_value_y3: production, projection_value_y4: production,
    projection_contract_y1: salary, projection_contract_y2: salary,
    projection_contract_y3: salary, projection_contract_y4: salary
  } as PlayerImpact;
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
