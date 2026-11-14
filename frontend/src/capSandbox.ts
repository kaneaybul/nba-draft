import type {
  CapSandboxDecision,
  CapSandboxDecisionAction,
  CapSandboxScenario,
  CapTrackerContractCell,
  CapTrackerContractRow,
  CapTrackerData,
  CapTrackerException,
  CapTrackerSeason,
  CapTrackerTeamSeason,
  SandboxTeamSeason
} from "./types";

export const CAP_SANDBOX_STORAGE_KEY = "capTracker:sandboxScenarios:v1";

export type SandboxResult = {
  teamSeasons: SandboxTeamSeason[];
  exceptions: CapTrackerException[];
  contracts: CapTrackerContractRow[];
  changedDecisionCount: number;
};

export function deriveSandbox(tracker: CapTrackerData, team: string, scenario: CapSandboxScenario | null): SandboxResult {
  const decisions = scenario?.decisions ?? {};
  const seasons = new Map(tracker.seasons.map((season) => [season.year, season]));
  const contracts = tracker.contracts.map((row) => row.team === team ? applyRowDecisions(row, decisions, tracker) : row);
  const teamSeasons = tracker.team_seasons
    .filter((row) => row.team === team)
    .map((base) => recomputeTeamSeason(base, seasons.get(base.year), contracts.filter((row) => row.team === team), tracker.dead_money.filter((row) => row.team === team && row.year === base.year)));
  return {
    teamSeasons,
    exceptions: buildSandboxExceptions(teamSeasons, tracker.seasons),
    contracts,
    changedDecisionCount: Object.keys(decisions).length
  };
}

export function defaultScenario(team: string): CapSandboxScenario {
  const now = new Date().toISOString();
  return {
    id: `scenario-${team}-${Date.now()}`,
    name: `${team} sandbox`,
    team,
    created_at: now,
    updated_at: now,
    decisions: {}
  };
}

export function decisionId(team: string, rowId: string, year: number) {
  return `${team}||${rowId}||${year}`;
}

export function upsertDecision(scenario: CapSandboxScenario, decision: Omit<CapSandboxDecision, "id" | "created_at">): CapSandboxScenario {
  const id = decisionId(decision.team, decision.row_id, decision.year);
  const now = new Date().toISOString();
  const nextDecision: CapSandboxDecision = { ...decision, id, created_at: scenario.decisions[id]?.created_at ?? now };
  return {
    ...scenario,
    updated_at: now,
    decisions: {
      ...scenario.decisions,
      [id]: nextDecision
    }
  };
}

export function clearDecision(scenario: CapSandboxScenario, team: string, rowId: string, year: number): CapSandboxScenario {
  const id = decisionId(team, rowId, year);
  const decisions = { ...scenario.decisions };
  delete decisions[id];
  return { ...scenario, updated_at: new Date().toISOString(), decisions };
}

export function loadSandboxScenarios(): CapSandboxScenario[] {
  try {
    const raw = window.localStorage.getItem(CAP_SANDBOX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSandboxScenarios(scenarios: CapSandboxScenario[]) {
  window.localStorage.setItem(CAP_SANDBOX_STORAGE_KEY, JSON.stringify(scenarios));
}

export function supportedActions(cell: CapTrackerContractCell): CapSandboxDecisionAction[] {
  if (!cell.amount) return [];
  if (cell.kind === "cap_hold") return ["retain", "renounce"];
  if (cell.kind === "team_option") return ["exercise", "decline"];
  if (cell.kind === "player_option") return ["accept", "decline"];
  if (cell.kind === "non_guaranteed" || cell.kind === "partial_guarantee") return ["keep", "waive_before_guarantee"];
  if (cell.kind === "draft_pick") return ["keep", "remove"];
  return [];
}

export function actionLabel(action: CapSandboxDecisionAction) {
  if (action === "waive_before_guarantee") return "Waive";
  if (action === "remove") return "Remove";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function applyRowDecisions(row: CapTrackerContractRow, decisions: Record<string, CapSandboxDecision>, tracker: CapTrackerData): CapTrackerContractRow {
  const cells = row.cells.map((cell) => {
    const decision = decisions[decisionId(row.team, row.id, cell.year)];
    return decision ? applyCellDecision(row, cell, decision.action, tracker) : cell;
  });
  return { ...row, cells };
}

function applyCellDecision(row: CapTrackerContractRow, cell: CapTrackerContractCell, action: CapSandboxDecisionAction, tracker: CapTrackerData): CapTrackerContractCell {
  if (action === "renounce" && cell.kind === "cap_hold") return removedCell(cell, "Renounced hold", "Hold renounced in sandbox");
  if (action === "decline" && (cell.kind === "team_option" || cell.kind === "player_option")) return optionDeclinedCell(row, cell, tracker);
  if (action === "waive_before_guarantee" && (cell.kind === "non_guaranteed" || cell.kind === "partial_guarantee")) {
    const dead = Math.max(0, Math.round(Math.min(cell.cap_amount ?? cell.amount, cell.guaranteed_amount ?? 0)));
    return {
      ...cell,
      amount: dead,
      cap_amount: dead,
      kind: dead > 0 ? "dead" : "empty",
      status: dead > 0 ? "Sandbox dead money" : "Waived",
      source: "override",
      label: dead > 0 ? "Dead" : null,
      note: dead > 0 ? `Waived before guarantee; dead money equals guaranteed amount. ${cell.guarantee_note || ""}`.trim() : "Waived before guarantee with no guaranteed salary."
    };
  }
  if (action === "remove" && cell.kind === "draft_pick") return removedCell(cell, "Pick removed", "Draft placeholder removed in sandbox");
  return cell;
}

function optionDeclinedCell(row: CapTrackerContractRow, cell: CapTrackerContractCell, tracker: CapTrackerData): CapTrackerContractCell {
  const hold = estimateOptionHold(row, cell, tracker);
  if (hold <= 0) return removedCell(cell, "Option declined", "Option declined in sandbox");
  return {
    ...cell,
    amount: hold,
    cap_amount: hold,
    counts_against_cap: true,
    kind: "cap_hold",
    status: "UFA",
    source: "estimated",
    label: "Hold",
    note: "Option declined in sandbox; estimated Bird-rights cap hold retained."
  };
}

function estimateOptionHold(row: CapTrackerContractRow, cell: CapTrackerContractCell, tracker: CapTrackerData) {
  const prior = row.cells.slice().reverse().find((candidate) => candidate.year < cell.year && candidate.amount > 0 && candidate.kind !== "cap_hold" && candidate.kind !== "dead");
  const priorAmount = prior?.amount ?? cell.amount;
  const season = tracker.seasons.find((item) => item.year === cell.year);
  const averageSalaryEstimate = (season?.salary_cap ?? 166_000_000) * 0.08;
  return Math.round(priorAmount < averageSalaryEstimate ? priorAmount * 1.9 : priorAmount * 1.5);
}

function removedCell(cell: CapTrackerContractCell, status: string, note: string): CapTrackerContractCell {
  return { ...cell, amount: 0, cap_amount: 0, kind: "empty", status, source: "override", label: null, note };
}

function recomputeTeamSeason(base: CapTrackerTeamSeason, season: CapTrackerSeason | undefined, rows: CapTrackerContractRow[], baseDeadRows: Array<{ amount: number }>): SandboxTeamSeason {
  const cellsWithRows = rows
    .map((row) => ({ row, cell: row.cells.find((cell) => cell.year === base.year) }))
    .filter((item): item is { row: CapTrackerContractRow; cell: CapTrackerContractCell } => Boolean(item.cell) && item.cell?.counts_against_cap !== false)
    .map(({row,cell}) => {
      const amount=cell.cap_amount ?? cell.amount;
      const guaranteed=cell.guaranteed_amount == null ? null : Math.min(amount,cell.guaranteed_amount);
      return {row,cell:{...cell,amount,guaranteed_amount:guaranteed,unguaranteed_amount:guaranteed == null ? cell.unguaranteed_amount : Math.max(0,amount-guaranteed)}};
    });
  const cells = cellsWithRows.map((item) => item.cell);
  const guaranteed = sum(cells.filter((cell) => cell.kind === "guaranteed" || cell.kind === "partial_guarantee").map((cell) => cell.amount));
  const optionSalary = sum(cells.filter((cell) => cell.kind === "player_option" || cell.kind === "team_option").map((cell) => cell.amount));
  const nonGuaranteed = sum(cells.filter((cell) => cell.kind === "non_guaranteed").map((cell) => cell.amount));
  const draftPickCharges = sum(cells.filter((cell) => cell.kind === "draft_pick").map((cell) => cell.amount));
  const capHolds = sum(cells.filter((cell) => cell.kind === "cap_hold").map((cell) => cell.amount));
  const displayedBaseDead = sum(cellsWithRows.filter(({ row, cell }) => row.row_type === "dead_money" && cell.kind === "dead").map(({ cell }) => cell.amount));
  const baseDead = displayedBaseDead > 0 ? displayedBaseDead : sum(baseDeadRows.map((row) => row.amount));
  const sandboxDead = sum(cellsWithRows.filter(({ row, cell }) => row.row_type !== "dead_money" && cell.kind === "dead").map(({ cell }) => cell.amount));
  const deadMoney = baseDead + sandboxDead;
  const salaryOnBooks = guaranteed + optionSalary + nonGuaranteed;
  const activeSalary = salaryOnBooks + draftPickCharges;
  const rosterCount = cells.filter((cell) => ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed", "draft_pick"].includes(cell.kind) && cell.amount > 0).length;
  const holdCount = cells.filter((cell) => cell.kind === "cap_hold" && cell.amount > 0).length;
  const rosterCharge = season?.minimum_roster_charge ?? 0;
  const rosterChargesWithHolds = Math.max(0, 12 - rosterCount - holdCount) * rosterCharge;
  const rosterChargesRenounced = Math.max(0, 12 - rosterCount) * rosterCharge;
  const likelyBooksWithHolds = activeSalary + deadMoney + capHolds + rosterChargesWithHolds;
  const likelyBooksRenounced = activeSalary + deadMoney + rosterChargesRenounced;
  const guaranteedBase = sum(cells.filter((cell) => ["guaranteed", "partial_guarantee", "player_option", "team_option", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.guaranteed_amount ?? cell.amount));
  const atRisk = sum(cells.filter((cell) => ["partial_guarantee", "non_guaranteed"].includes(cell.kind)).map((cell) => cell.unguaranteed_amount ?? 0));
  return {
    ...base,
    guaranteed_salary: Math.round(guaranteed),
    option_salary: Math.round(optionSalary),
    non_guaranteed_salary: Math.round(nonGuaranteed),
    salary_on_books: Math.round(salaryOnBooks),
    guaranteed_base_salary: Math.round(guaranteedBase),
    at_risk_salary: Math.round(atRisk),
    draft_pick_charges: Math.round(draftPickCharges),
    active_salary: Math.round(activeSalary),
    dead_money: Math.round(deadMoney),
    cap_holds: Math.round(capHolds),
    roster_charges_with_holds: Math.round(rosterChargesWithHolds),
    roster_charges_renounced: Math.round(rosterChargesRenounced),
    likely_books_with_holds: Math.round(likelyBooksWithHolds),
    likely_books_renounced: Math.round(likelyBooksRenounced),
    room_if_holds_retained: Math.round((season?.salary_cap ?? 0) - likelyBooksWithHolds),
    room_if_renounced: Math.round((season?.salary_cap ?? 0) - likelyBooksRenounced),
    tax_room_with_holds: Math.round((season?.tax_level ?? 0) - likelyBooksWithHolds),
    tax_room_renounced: Math.round((season?.tax_level ?? 0) - likelyBooksRenounced),
    first_apron_room_with_holds: Math.round((season?.first_apron ?? 0) - likelyBooksWithHolds),
    first_apron_room_renounced: Math.round((season?.first_apron ?? 0) - likelyBooksRenounced),
    second_apron_room_with_holds: Math.round((season?.second_apron ?? 0) - likelyBooksWithHolds),
    second_apron_room_renounced: Math.round((season?.second_apron ?? 0) - likelyBooksRenounced),
    roster_count: rosterCount,
    hold_count: holdCount,
    status_band_with_holds: statusBand(likelyBooksWithHolds, season),
    status_band_renounced: statusBand(likelyBooksRenounced, season),
    status_band: statusBand(likelyBooksWithHolds, season),
    base_likely_books_with_holds: base.likely_books_with_holds,
    base_likely_books_renounced: base.likely_books_renounced,
    sandbox_dead_money_added: Math.round(sandboxDead)
  };
}

function buildSandboxExceptions(teamSeasons: SandboxTeamSeason[], seasons: CapTrackerSeason[]): CapTrackerException[] {
  const byYear = new Map(seasons.map((season) => [season.year, season]));
  const out: CapTrackerException[] = [];
  for (const row of teamSeasons) {
    const season = byYear.get(row.year);
    if (!season) continue;
    if (row.room_if_holds_retained <= 0) {
      if ((row.first_apron_room_with_holds ?? row.first_apron_room) > 0) {
        out.push(exceptionRow(row.team, row.year, "Non-Taxpayer MLE", season.salary_cap * 0.0912, "retained"));
        out.push(exceptionRow(row.team, row.year, "Bi-Annual", season.salary_cap * 0.0353, "retained"));
      } else if ((row.second_apron_room_with_holds ?? row.second_apron_room) > 0) {
        out.push(exceptionRow(row.team, row.year, "Taxpayer MLE", 5_000_000 * (season.salary_cap / 136_021_000), "retained"));
      }
    }
    if (row.room_if_renounced > 0) {
      out.push(exceptionRow(row.team, row.year, "Room Exception", season.salary_cap * 0.05678, "renounced"));
    }
  }
  return out;
}

function exceptionRow(team: string, year: number, name: string, amount: number, path: string): CapTrackerException {
  return {
    id: `sandbox-${team}-${year}-${path}-${name}`,
    team,
    year,
    name,
    amount: Math.round(amount),
    path,
    expires: null,
    note: "Sandbox projection",
    source: "Sandbox recalculation",
    source_quality: "projected"
  };
}

function statusBand(amount: number, season?: CapTrackerSeason) {
  if (!season) return "Unavailable";
  if (amount > season.second_apron) return "Over 2nd Apron";
  if (amount > season.first_apron) return "1st Apron - 2nd Apron";
  if (amount > season.tax_level) return "Tax - 1st Apron";
  if (amount > season.salary_cap) return "Cap - Tax";
  return "Cap Space";
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}
