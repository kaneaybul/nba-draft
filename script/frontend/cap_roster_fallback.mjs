// A roster feed establishes membership, not a new salary/cap ledger.
export function retainCachedCapTeams({ teams, previous, years, contracts, deadMoney, teamSeasons }) {
  const cachedTeams = new Set(teams);
  if (!cachedTeams.size) return { contracts, deadMoney, teamSeasons, fallbacks: [] };
  const fallbacks = [];
  for (const team of cachedTeams) {
    const priorRows = previous?.team_seasons?.filter((row) => row.team === team) ?? [];
    if (!years.every((year) => priorRows.some((row) => row.year === year)) || !Array.isArray(previous?.contracts)) {
      throw new Error(`${team}: no complete previous cap snapshot; refusing to publish an empty salary ledger.`);
    }
    const prior = previous.cap_fallbacks?.find((row) => row.team === team) ?? previous.cap_component_fallbacks?.find((row) => row.team === team);
    fallbacks.push({ team, cached_as_of: prior?.cached_as_of ?? previous.generated_at,
      reason: "Spotrac unavailable; roster refreshed from ESPN; salary and cap figures retain the last verified snapshot." });
  }
  const preserved = (rows, name) => [
    ...rows.filter((row) => !cachedTeams.has(row.team)),
    ...(previous[name] ?? []).filter((row) => cachedTeams.has(row.team)).map((row) => ({
      ...row, source_quality: "cached", cached_as_of: fallbacks.find((item) => item.team === row.team).cached_as_of
    }))
  ];
  return { contracts: preserved(contracts, "contracts"), deadMoney: preserved(deadMoney, "dead_money"),
    teamSeasons: preserved(teamSeasons, "team_seasons"), fallbacks };
}
