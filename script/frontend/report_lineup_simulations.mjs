import fs from "node:fs";
import path from "node:path";

const lineupSkills = ["FTD", "SHOOT", "PASS", "RIM", "OREB", "SWITCH", "DPM", "DREB", "RIMPRO"];
const LINEUP_SIMULATION_COUNT = 9000;
const LINEUP_SIMULATION_SEED = 20260709;
const LINEUP_SIMULATION_TEMPLATES = [
  { roles: ["guard", "guard", "wing", "forward", "big"], weight: 9 },
  { roles: ["guard", "guard", "wing", "wing", "big"], weight: 6 },
  { roles: ["guard", "wing", "wing", "forward", "big"], weight: 5 },
  { roles: ["guard", "wing", "forward", "forward", "big"], weight: 3 },
  { roles: ["guard", "guard", "forward", "big", "big"], weight: 1.5 },
  { roles: ["guard", "wing", "forward", "big", "big"], weight: 1 }
];

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "frontend", "public", "data", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const season = Number(process.argv[2] ?? manifest.static_data?.seasons?.[0]);
if (!Number.isFinite(season)) throw new Error("Could not resolve a season. Pass one as the first argument.");

const playerPath = path.join(repoRoot, "frontend", "public", "data", "v2", "impact_players", `${season}.json`);
const players = JSON.parse(fs.readFileSync(playerPath, "utf8")).filter((player) => player.year === season);
const simulated = buildSimulatedLineupCores(players).map((lineup, index) => {
  const skillTotals = Object.fromEntries(
    lineupSkills.map((skill) => [skill, lineup.reduce((sum, player) => sum + lineupSkillValue(player, skill), 0)])
  );
  return {
    index: index + 1,
    players: lineup,
    net: lineup.reduce((sum, player) => sum + Number(player.total ?? 0), 0),
    score: lineup.reduce((sum, player) => sum + Number(player.score ?? 0), 0) / Math.max(1, lineup.length),
    skillTotals
  };
});

const byNet = [...simulated].sort((a, b) => b.net - a.net || b.score - a.score || a.index - b.index);
const byNetAsc = [...simulated].sort((a, b) => a.net - b.net || a.score - b.score || a.index - b.index);
const median = byNetAsc[Math.floor(byNetAsc.length / 2)];

const lines = [
  `# Lineup Simulation Report ${season}`,
  "",
  `Generated ${simulated.length.toLocaleString("en-US")} position-sane simulated lineups from ${players.length.toLocaleString("en-US")} players.`,
  "",
  "## Best Overall",
  ...formatLineupRows(byNet.slice(0, 5), "net"),
  "",
  "## Worst Overall",
  ...formatLineupRows(byNetAsc.slice(0, 5), "net"),
  "",
  "## Median Overall",
  ...formatLineupRows([median], "net"),
  "",
  "## Skill Extremes"
];

for (const skill of lineupSkills) {
  const best = [...simulated].sort((a, b) => b.skillTotals[skill] - a.skillTotals[skill] || b.net - a.net)[0];
  const worst = [...simulated].sort((a, b) => a.skillTotals[skill] - b.skillTotals[skill] || a.net - b.net)[0];
  lines.push(`- ${skill} best ${formatNumber(best.skillTotals[skill], 2)} | net ${formatSigned(best.net, 1)} | ${formatPlayers(best.players)}`);
  lines.push(`- ${skill} worst ${formatNumber(worst.skillTotals[skill], 2)} | net ${formatSigned(worst.net, 1)} | ${formatPlayers(worst.players)}`);
}

const report = `${lines.join("\n")}\n`;
const outPath = path.join(repoRoot, "tmp", `lineup_simulation_report_${season}.md`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, report);
console.log(report);
console.error(`Wrote ${outPath}`);

function formatLineupRows(rows, metric) {
  return rows.map((row, index) => {
    const value = metric === "net" ? row.net : row.skillTotals[metric];
    return `${index + 1}. ${formatSigned(value, 1)} | score ${formatNumber(row.score, 1)} | ${formatPlayers(row.players)}`;
  });
}

function formatPlayers(lineup) {
  return lineup.map((player) => `${player.player_name} (${cleanTeamValue(player.team)} ${displayPosition(player.position)})`).join(" / ");
}

function formatSigned(value, digits) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const formatted = numeric.toFixed(digits);
  return numeric > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value, digits) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "-";
}

function buildSimulatedLineupCores(playerRows) {
  const pool = playerRows
    .filter((player) => Number.isFinite(player.total) && Number.isFinite(player.score) && lineupHasAnySlotFit(player))
    .sort((a, b) => lineupPlayerId(a).localeCompare(lineupPlayerId(b)));
  if (pool.length < 5) return [];

  const poolSeason = pool.find((player) => Number.isFinite(player.year))?.year ?? 0;
  const random = createLineupPrng(LINEUP_SIMULATION_SEED + poolSeason * 1009 + pool.length * 17);
  const lineups = [];
  let attempts = 0;
  const maxAttempts = LINEUP_SIMULATION_COUNT * 8;

  while (lineups.length < LINEUP_SIMULATION_COUNT && attempts < maxAttempts) {
    attempts += 1;
    const template = pickLineupSimulationTemplate(random);
    const lineup = sampleSimulatedLineup(pool, template, random);
    if (!lineup) continue;
    lineups.push([...lineup].sort(compareLineupBenchmarkPlayers));
  }

  return lineups;
}

function sampleSimulatedLineup(pool, template, random) {
  const selected = [];
  const used = new Set();

  for (const role of template.roles) {
    const player = pickLineupSlotPlayer(pool, role, used, random);
    if (!player) return null;
    selected.push(player);
    used.add(lineupPlayerId(player));
  }

  return lineupPassesSimulationSanity(selected) ? selected : null;
}

function pickLineupSlotPlayer(pool, role, used, random) {
  let totalWeight = 0;
  const weightedPlayers = [];

  for (const player of pool) {
    const id = lineupPlayerId(player);
    if (used.has(id)) continue;
    const fit = lineupSlotFit(player, role);
    if (fit < 0.12) continue;
    const weight = fit * lineupSamplingWeight(player);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    totalWeight += weight;
    weightedPlayers.push({ player, cumulative: totalWeight });
  }

  if (totalWeight <= 0 || weightedPlayers.length === 0) return null;
  const target = random() * totalWeight;
  return weightedPlayers.find((item) => item.cumulative >= target)?.player ?? weightedPlayers[weightedPlayers.length - 1]?.player ?? null;
}

function pickLineupSimulationTemplate(random) {
  const totalWeight = LINEUP_SIMULATION_TEMPLATES.reduce((sum, template) => sum + template.weight, 0);
  const target = random() * totalWeight;
  let cumulative = 0;
  for (const template of LINEUP_SIMULATION_TEMPLATES) {
    cumulative += template.weight;
    if (target <= cumulative) return template;
  }
  return LINEUP_SIMULATION_TEMPLATES[0];
}

function createLineupPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lineupHasAnySlotFit(player) {
  return lineupSlotFit(player, "guard") >= 0.12 || lineupSlotFit(player, "wing") >= 0.12 || lineupSlotFit(player, "forward") >= 0.12 || lineupSlotFit(player, "big") >= 0.12;
}

function lineupSlotFit(player, role) {
  const shares = lineupPositionShares(player);
  if (role === "guard") return clamp(shares.pg + shares.sg * 0.85 + shares.sf * 0.2, 0, 1);
  if (role === "wing") return clamp(shares.sg * 0.35 + shares.sf + shares.pf * 0.35, 0, 1);
  if (role === "forward") return clamp(shares.sf * 0.25 + shares.pf + shares.c * 0.08, 0, 1);
  return clamp(shares.pf * 0.25 + shares.c, 0, 1);
}

function lineupPassesSimulationSanity(lineup) {
  const primaryRoles = lineup.map(lineupPrimarySimulationRole);
  const primaryBigs = primaryRoles.filter((role) => role === "big").length;
  const primaryGuards = primaryRoles.filter((role) => role === "guard").length;
  const stars = lineup.filter(lineupIsSimulationStar).length;
  const highEndPlayers = lineup.filter(lineupIsHighEndSimulationPlayer).length;
  return primaryBigs <= 2 && primaryGuards <= 3 && stars <= 2 && highEndPlayers <= 3;
}

function lineupPrimarySimulationRole(player) {
  const shares = lineupPositionShares(player);
  const roleValues = [
    { role: "guard", value: shares.pg + shares.sg },
    { role: "wing", value: shares.sf },
    { role: "forward", value: shares.pf },
    { role: "big", value: shares.c }
  ];
  return roleValues.sort((a, b) => b.value - a.value)[0]?.role ?? "wing";
}

function lineupIsSimulationStar(player) {
  const tier = String(player.tier ?? "").trim();
  return tier === "MVP" || tier === "Superstar" || tier === "Star" || Number(player.score ?? 0) >= 94 || Number(player.total ?? 0) >= 4.2;
}

function lineupIsHighEndSimulationPlayer(player) {
  const tier = String(player.tier ?? "").trim();
  return lineupIsSimulationStar(player) || tier === "Elite Starter" || Number(player.score ?? 0) >= 90 || Number(player.total ?? 0) >= 3.2;
}

function lineupPositionShares(player) {
  const shares = {
    pg: lineupShareValue(player.pg_share),
    sg: lineupShareValue(player.sg_share),
    sf: lineupShareValue(player.sf_share),
    pf: lineupShareValue(player.pf_share),
    c: lineupShareValue(player.c_share)
  };
  const total = shares.pg + shares.sg + shares.sf + shares.pf + shares.c;
  if (total > 0.01) {
    return {
      pg: shares.pg / total,
      sg: shares.sg / total,
      sf: shares.sf / total,
      pf: shares.pf / total,
      c: shares.c / total
    };
  }

  const position = displayPosition(player.position).toUpperCase();
  if (position === "PG") return { pg: 1, sg: 0, sf: 0, pf: 0, c: 0 };
  if (position === "SG") return { pg: 0.2, sg: 0.8, sf: 0, pf: 0, c: 0 };
  if (position === "SF") return { pg: 0, sg: 0.1, sf: 0.8, pf: 0.1, c: 0 };
  if (position === "PF") return { pg: 0, sg: 0, sf: 0.1, pf: 0.8, c: 0.1 };
  if (position === "C") return { pg: 0, sg: 0, sf: 0, pf: 0.15, c: 0.85 };
  if (position === "G") return { pg: 0.5, sg: 0.5, sf: 0, pf: 0, c: 0 };
  if (position === "F") return { pg: 0, sg: 0, sf: 0.5, pf: 0.5, c: 0 };
  return { pg: 0, sg: 0.15, sf: 0.35, pf: 0.35, c: 0.15 };
}

function lineupShareValue(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
}

function lineupSamplingWeight(player) {
  const minutes = Math.max(80, Number(player.lineup_adjusted_minutes ?? player.Minutes ?? 0));
  const score = Number(player.score ?? 50);
  const total = Number(player.total ?? 0);
  const minutesWeight = Math.pow(minutes, 0.45);
  const scoreWeight = 0.82 + clamp((score - 45) / 55, 0, 1) * 0.28;
  const totalWeight = 0.9 + clamp((total + 1.5) / 5.5, 0, 1) * 0.22;
  return minutesWeight * scoreWeight * totalWeight * lineupTierMultiplier(player.tier);
}

function lineupTierMultiplier(tier) {
  const value = String(tier ?? "").trim();
  if (value === "MVP") return 1.18;
  if (value === "Superstar") return 1.15;
  if (value === "Star") return 1.12;
  if (value === "Elite Starter") return 1.08;
  if (value === "Starter") return 1.04;
  if (value === "Fringe Starter") return 1;
  if (value === "Strong Bench") return 0.96;
  if (value === "Bench") return 0.88;
  if (value === "Deep Bench") return 0.78;
  if (value === "Project") return 0.68;
  return 0.6;
}

function compareLineupBenchmarkPlayers(a, b) {
  const aRole = Number(a.lineup_role_order ?? 99);
  const bRole = Number(b.lineup_role_order ?? 99);
  if (aRole !== bRole) return aRole - bRole;
  const aMinutes = Number(a.lineup_adjusted_minutes ?? a.Minutes ?? 0);
  const bMinutes = Number(b.lineup_adjusted_minutes ?? b.Minutes ?? 0);
  return bMinutes - aMinutes || Number(b.total ?? 0) - Number(a.total ?? 0) || Number(b.score ?? 0) - Number(a.score ?? 0) || String(a.player_name ?? "").localeCompare(String(b.player_name ?? ""));
}

function lineupSkillValue(player, skill) {
  return Number(player[skill] ?? 0);
}

function lineupPlayerId(player) {
  return `${player.year}:${player.nba_id}:${player.player_name}`;
}

function cleanTeamValue(value) {
  const team = String(value ?? "").trim();
  return team ? team : "FA";
}

function displayPosition(position) {
  const raw = String(position ?? "").trim();
  if (!raw) return "UNK";
  return raw.split(/[/-]/)[0]?.trim() || "UNK";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
