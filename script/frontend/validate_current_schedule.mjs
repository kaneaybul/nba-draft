import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const publicData = resolve(repoRoot, "frontend/public/data");
const schedulePath = resolve(publicData, "v2/team_schedules/2027.json");
const projectionPath = resolve(publicData, "v2/team_projections/2027.json");
const manifestPath = resolve(publicData, "manifest.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closeTo(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileDigest(path) {
  const contents = await readFile(path);
  return {
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

const [schedule, projections, manifest] = await Promise.all([
  loadJson(schedulePath),
  loadJson(projectionPath),
  loadJson(manifestPath),
]);

assert(Array.isArray(schedule), "2027 schedule shard must be an array");
assert(Array.isArray(projections), "2027 projection shard must be an array");

const knownGames = schedule.filter((game) => !game.is_placeholder);
const placeholders = schedule.filter((game) => game.is_placeholder);
assert(schedule.length === 1260, `Expected 1,260 schedule rows; found ${schedule.length}`);
assert(knownGames.length === 1200, `Expected 1,200 scheduled games; found ${knownGames.length}`);
assert(placeholders.length === 60, `Expected 60 team-level Cup placeholders; found ${placeholders.length}`);
assert(
  knownGames.filter((game) => game.notes === "NBA Cup Group Play").length === 60,
  "Expected 60 NBA Cup Group Play games",
);

const knownIds = knownGames.map((game) => game.game_id);
assert(knownIds.every(Boolean), "Every scheduled game must have an official game ID");
assert(new Set(knownIds).size === 1200, "Scheduled game IDs must be unique");

for (const game of schedule) {
  assert(game.season === 2027, `Unexpected schedule season: ${game.season}`);
  assert(game.season_type === "Regular Season", `Unexpected season type: ${game.season_type}`);
  assert(Number.isFinite(game.home_win_probability), `Missing home win probability for ${game.game_id}`);
  assert(Number.isFinite(game.away_win_probability), `Missing away win probability for ${game.game_id}`);
  if (!game.is_placeholder) {
    assert(
      closeTo(game.home_win_probability + game.away_win_probability, 1, 0.001),
      `Probabilities do not sum to 1 for ${game.game_id}`,
    );
  }
}

const teamRows = new Map();
for (const game of schedule) {
  const teams = game.is_placeholder
    ? [game.selected_team]
    : [game.home_team, game.away_team];
  for (const team of teams) {
    assert(team, `Schedule row ${game.game_id} is missing a team`);
    const rows = teamRows.get(team) ?? [];
    rows.push(game);
    teamRows.set(team, rows);
  }
}

assert(teamRows.size === 30, `Expected 30 teams; found ${teamRows.size}`);
for (const [team, games] of teamRows) {
  const fixed = games.filter((game) => !game.is_placeholder);
  const tbd = games.filter((game) => game.is_placeholder);
  assert(games.length === 82, `${team} must have 82 modeled games; found ${games.length}`);
  assert(fixed.length === 80, `${team} must have 80 scheduled games; found ${fixed.length}`);
  assert(tbd.length === 2, `${team} must have two Cup TBD slots; found ${tbd.length}`);
  for (const game of tbd) {
    assert(game.home_team === team && game.away_team === team, `${team} Cup placeholder must be team-local`);
    assert(game.selected_team_location === "TBD", `${team} Cup placeholder location must remain TBD`);
    assert(game.date_window === "Dec 4–10", `${team} Cup placeholder window is incorrect`);
    assert(
      game.probability_basis === "Expected win probability vs. the other 14 teams in the same conference",
      `${team} Cup placeholder must document its probability basis`,
    );
  }
}

assert(projections.length === 90, `Expected 90 projection rows; found ${projections.length}`);
const scenarios = new Map();
for (const row of projections) {
  assert(row.year === 2027, `Unexpected projection year: ${row.year}`);
  assert(closeTo(row.projected_wins + row.projected_losses, 82, 0.001), `${row.team} projection must total 82 games`);
  assert(closeTo(row.expected_wins + row.expected_losses, 82, 0.001), `${row.team} expectation must total 82 games`);
  assert(row.scheduled_games === 80, `${row.team} must report 80 scheduled games`);
  assert(row.cup_tbd_games === 2, `${row.team} must report two Cup TBD games`);
  assert(row.schedule_adjusted === true, `${row.team} projection must be schedule-adjusted`);
  const rows = scenarios.get(row.scenario_id) ?? [];
  rows.push(row);
  scenarios.set(row.scenario_id, rows);
}

assert(scenarios.size === 3, `Expected three projection scenarios; found ${scenarios.size}`);
for (const [scenario, rows] of scenarios) {
  assert(rows.length === 30, `${scenario} must contain 30 teams; found ${rows.length}`);
  const projectedWins = rows.reduce((sum, row) => sum + row.projected_wins, 0);
  const expectedWins = rows.reduce((sum, row) => sum + row.expected_wins, 0);
  assert(closeTo(projectedWins, 1230, 0.001), `${scenario} projected wins must sum to 1,230; found ${projectedWins}`);
  assert(closeTo(expectedWins, 1230, 0.001), `${scenario} expected wins must sum to 1,230; found ${expectedWins}`);
}

const scheduleManifest = manifest.static_data.datasets.team_schedules;
const projectionManifest = manifest.static_data.datasets.team_projections;
const scheduleShard = scheduleManifest.shards.find((shard) => shard.year === 2027);
const projectionShard = projectionManifest.shards.find((shard) => shard.year === 2027);
assert(scheduleManifest.rows === 15419, `Schedule manifest total is ${scheduleManifest.rows}`);
assert(scheduleShard?.rows === 1260, "Schedule manifest is missing the 2027 shard");
assert(projectionShard?.rows === 90, "Projection manifest is missing the 2027 shard");

const [scheduleDigest, projectionDigest] = await Promise.all([
  fileDigest(schedulePath),
  fileDigest(projectionPath),
]);
assert(scheduleShard.bytes === scheduleDigest.bytes, "Schedule shard byte count is stale");
assert(scheduleShard.sha256 === scheduleDigest.sha256, "Schedule shard digest is stale");
assert(projectionShard.bytes === projectionDigest.bytes, "Projection shard byte count is stale");
assert(projectionShard.sha256 === projectionDigest.sha256, "Projection shard digest is stale");

console.log(
  `Validated 2027 schedule: ${knownGames.length} fixed games, ${placeholders.length} Cup TBD slots, ` +
    `${teamRows.size} teams, and ${projections.length} projection rows.`,
);
