import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, CapReviewData, CapReviewRow, CapSandboxDecisionAction, CapSandboxScenario, CapTrackerContractCell, CapTrackerContractRow, CapTrackerData, CapTrackerTeamSeason } from "./types";
import { applyApprovedCapReviewRows, getRefreshStatus, refreshSalaryResolution, updateCapReviewStatus } from "./capReviewApi";
import { actionLabel, clearDecision, defaultScenario, deriveSandbox, loadSandboxScenarios, saveSandboxScenarios, supportedActions, upsertDecision } from "./capSandbox";
import { isLocalRefreshEnabled } from "./runtime";
import { cls, formatMoney, formatSignedMoney } from "./utils";

type HoldTreatment = "include" | "renounce";
type MoneyDisplay = "compact" | "full";
type WorkspaceMode = "base" | "sandbox";

const preferredDefaultTeams = ["UTA", "OKC", "BOS", "CHI", "SAS"];

const cellBadges: Record<CapTrackerContractCell["kind"], string> = {
  guaranteed: "G",
  partial_guarantee: "PG",
  player_option: "PO",
  team_option: "TO",
  non_guaranteed: "NG",
  draft_pick: "Pick",
  cap_hold: "Hold",
  dead: "Dead",
  empty: ""
};

export function CapTrackerWorkspace({ data }: { data: AppData }) {
  const tracker = data.capTracker;
  const defaultTeam = useMemo(() => defaultTeamForTracker(tracker), [tracker]);
  const [team, setTeam] = useState(defaultTeam);
  const [startYear, setStartYear] = useState(() => tracker?.seasons[0]?.year ?? 2027);
  const [endYear, setEndYear] = useState(() => tracker?.seasons[tracker.seasons.length - 1]?.year ?? 2031);
  const [holdTreatment, setHoldTreatment] = useState<HoldTreatment>("include");
  const [moneyDisplay, setMoneyDisplay] = useState<MoneyDisplay>("compact");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [contractSearch, setContractSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("base");
  const [scenarios, setScenarios] = useState<CapSandboxScenario[]>(() => loadSandboxScenarios());
  const [scenarioId, setScenarioId] = useState<string>("");

  if (!tracker) {
    return (
      <main className="workspace cap-tracker-workspace">
        <section className="table-panel cap-tracker-empty">
          <div className="empty-state">
            <h2>Cap tracker data is not available</h2>
            <p>Run the cap tracker data builder, then reload the app.</p>
          </div>
        </section>
      </main>
    );
  }

  const selectedTeam = tracker.teams.find((item) => item.team === team) ?? tracker.teams[0];
  const resolvedTeam = selectedTeam?.team ?? team;
  const teamScenarios = scenarios.filter((item) => item.team === resolvedTeam);
  const activeScenario = workspaceMode === "sandbox"
    ? teamScenarios.find((item) => item.id === scenarioId) ?? teamScenarios[0] ?? null
    : null;
  const sandbox = useMemo(() => tracker && workspaceMode === "sandbox" ? deriveSandbox(tracker, resolvedTeam, activeScenario) : null, [tracker, workspaceMode, resolvedTeam, activeScenario]);
  const yearOptions = tracker.seasons.map((season) => season.year);
  const boundedStart = Math.min(startYear, endYear);
  const boundedEnd = Math.max(startYear, endYear);
  const seasons = tracker.seasons.filter((season) => season.year >= boundedStart && season.year <= boundedEnd);
  const baseTeamSeasons = tracker.team_seasons.filter((item) => item.team === resolvedTeam && item.year >= boundedStart && item.year <= boundedEnd);
  const teamSeasons = (sandbox?.teamSeasons ?? tracker.team_seasons).filter((item) => item.team === resolvedTeam && item.year >= boundedStart && item.year <= boundedEnd);
  const sandboxContractById = new Map((sandbox?.contracts ?? []).map((row) => [row.id, row]));
  const allContractRows = tracker.contracts
    .filter((row) => row.team === resolvedTeam && rowHasMoneyInRange(row, boundedStart, boundedEnd))
    .map((row) => sandboxContractById.get(row.id) ?? row)
    .sort(contractRowSort);
  const contractRows = allContractRows.filter((row) => rowMatchesFilters(row, boundedStart, boundedEnd, contractSearch, kindFilter, sourceFilter));
  const selectedRow = contractRows.find((row) => row.id === selectedRowId) ?? contractRows[0] ?? null;
  const current = teamSeasons[0];
  const next = teamSeasons.find((row) => row.year === 2027) ?? teamSeasons[1] ?? current;
  const teamExceptions = (sandbox?.exceptions ?? tracker.exceptions).filter((item) => item.team === resolvedTeam && item.year >= boundedStart && item.year <= boundedEnd);
  const visibleExceptions = teamExceptions.filter((item) => item.path === pathForTreatment(holdTreatment) || item.path === "override");
  const teamPicks = tracker.picks.filter((item) => item.team === resolvedTeam && item.year >= boundedStart && item.year <= boundedEnd);
  const maxLevels = tracker.max_contracts.filter((item) => item.year >= boundedStart && item.year <= boundedEnd);
  const summaryRows = buildSummaryRows(holdTreatment);
  const saveScenarios = (next: CapSandboxScenario[]) => {
    setScenarios(next);
    saveSandboxScenarios(next);
  };
  const ensureScenario = () => {
    const current = activeScenario ?? teamScenarios[0] ?? defaultScenario(resolvedTeam);
    if (!teamScenarios.some((item) => item.id === current.id)) {
      const next = [...scenarios, current];
      saveScenarios(next);
      setScenarioId(current.id);
    }
    return current;
  };
  const updateScenario = (scenario: CapSandboxScenario) => {
    const next = scenarios.some((item) => item.id === scenario.id)
      ? scenarios.map((item) => item.id === scenario.id ? scenario : item)
      : [...scenarios, scenario];
    saveScenarios(next);
    setScenarioId(scenario.id);
  };

  useEffect(() => {
    if (workspaceMode !== "sandbox") return;
    if (!teamScenarios.length) {
      const created = defaultScenario(resolvedTeam);
      saveScenarios([...scenarios, created]);
      setScenarioId(created.id);
    } else if (!teamScenarios.some((item) => item.id === scenarioId)) {
      setScenarioId(teamScenarios[0].id);
    }
  }, [workspaceMode, resolvedTeam, scenarioId, scenarios, teamScenarios]);

  const applyDecision = (row: CapTrackerContractRow, cell: CapTrackerContractCell, action: string) => {
    const scenario = ensureScenario();
    updateScenario(upsertDecision(scenario, { team: row.team, row_id: row.id, year: cell.year, action: action as CapSandboxDecisionAction }));
  };
  const resetDecision = (row: CapTrackerContractRow, cell: CapTrackerContractCell) => {
    if (!activeScenario) return;
    updateScenario(clearDecision(activeScenario, row.team, row.id, cell.year));
  };

  return (
    <main className="workspace cap-tracker-workspace">
      <section className="cap-command-panel compact">
        <div className="cap-title-stack">
          <span>Cap Tracker</span>
          <h2>{selectedTeam?.team_name ?? resolvedTeam}</h2>
        </div>
        <div className="cap-controls">
          <label>
            <span>Team</span>
            <select value={resolvedTeam} onChange={(event) => setTeam(event.target.value)}>
              {tracker.teams.map((item) => (
                <option key={item.team} value={item.team}>
                  {item.team} - {item.team_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <select value={startYear} onChange={(event) => setStartYear(Number(event.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {seasonLabel(tracker, year)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Through</span>
            <select value={endYear} onChange={(event) => setEndYear(Number(event.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {seasonLabel(tracker, year)}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Mode"
            options={[
              ["base", "Base"],
              ["sandbox", "Sandbox"]
            ]}
            value={workspaceMode}
            onChange={(value) => setWorkspaceMode(value as WorkspaceMode)}
          />
          <Segmented
            label="Cap hold treatment"
            options={[
              ["include", "Holds"],
              ["renounce", "Room"]
            ]}
            value={holdTreatment}
            onChange={(value) => setHoldTreatment(value as HoldTreatment)}
          />
          <Segmented
            label="Money display"
            options={[
              ["compact", "$M"],
              ["full", "Full"]
            ]}
            value={moneyDisplay}
            onChange={(value) => setMoneyDisplay(value as MoneyDisplay)}
          />
          <label>
            <span>Search</span>
            <input value={contractSearch} onChange={(event) => setContractSearch(event.target.value)} placeholder="Player, source, note" />
          </label>
          <label>
            <span>Kind</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">All rows</option>
              <option value="guaranteed">Guaranteed</option>
              <option value="option">Options</option>
              <option value="non_guaranteed">Non-guaranteed</option>
              <option value="cap_hold">Holds</option>
              <option value="draft_pick">Picks</option>
              <option value="dead">Dead</option>
            </select>
          </label>
          <label>
            <span>Source</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All sources</option>
              <option value="spotrac">Spotrac</option>
              <option value="contract">Contract</option>
              <option value="cached">Prior estimate</option>
              <option value="bref-option">BRef option</option>
              <option value="override">Override</option>
              <option value="estimated">Estimated</option>
              <option value="projected">Projected</option>
            </select>
          </label>
        </div>
      </section>

      <CapKpiStrip current={current} next={next} holdTreatment={holdTreatment} moneyDisplay={moneyDisplay} />
      {workspaceMode === "sandbox" && (
        <SandboxScenarioBar
          scenarios={teamScenarios}
          activeScenario={activeScenario}
          resolvedTeam={resolvedTeam}
          baseCurrent={baseTeamSeasons[0]}
          current={current}
          holdTreatment={holdTreatment}
          moneyDisplay={moneyDisplay}
          onSelect={setScenarioId}
          onCreate={() => updateScenario(defaultScenario(resolvedTeam))}
          onReset={() => activeScenario && updateScenario({ ...activeScenario, updated_at: new Date().toISOString(), decisions: {} })}
          onDuplicate={() => activeScenario && updateScenario({ ...activeScenario, id: `scenario-${resolvedTeam}-${Date.now()}`, name: `${activeScenario.name} copy`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })}
          onDelete={() => {
            if (!activeScenario) return;
            const next = scenarios.filter((item) => item.id !== activeScenario.id);
            saveScenarios(next);
            setScenarioId(next.find((item) => item.team === resolvedTeam)?.id ?? "");
          }}
        />
      )}

      <section className="cap-main-grid compact">
        <section className="cap-sheet-panel">
          <div className="cap-sheet-toolbar">
            <div>
              <strong>{seasonLabel(tracker, current?.year)} {holdTreatment === "include" ? "retained-hold path" : "renounced-room path"}</strong>
              <span>
                Current room {current ? formatSignedMoneyMode(roomFor(current, holdTreatment), moneyDisplay) : "-"} / next offseason {next ? formatSignedMoneyMode(roomFor(next, holdTreatment), moneyDisplay) : "-"}
              </span>
            </div>
            <div className="cap-legend" aria-label="Cell legend">
              {["G", "PO", "TO", "NG", "Hold", "Pick", "Dead"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
          <div className="cap-sheet-wrap">
            <table className="cap-sheet-table">
              <thead>
                <tr>
                  <th className="cap-name-col">Line</th>
                  {seasons.map((season) => (
                    <th key={season.year}>
                      <span>{season.label}</span>
                      <small>{formatMoneyMode(season.salary_cap, moneyDisplay)} cap</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="cap-summary-body">
                {summaryRows.map((row) => (
                  <tr key={row.key} className={cls("cap-summary-row", row.emphasis && "emphasis")}>
                    <th className="cap-name-col">{row.label}</th>
                    {teamSeasons.map((seasonRow) => (
                      <td key={`${row.key}-${seasonRow.year}`}>
                        {row.signed ? formatSignedMoneyMode(row.value(seasonRow), moneyDisplay) : formatMoneyMode(row.value(seasonRow), moneyDisplay)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tbody>
                {contractRows.map((row) => (
                  <tr
                    key={row.id}
                    className={cls("cap-book-row", row.id === selectedRow?.id && "selected", `row-${row.row_type}`)}
                    onClick={() => setSelectedRowId(row.id)}
                  >
                    <th className="cap-name-col">
                      <div className="cap-line-name">
                        <strong>{row.player_name}</strong>
                        <span>{lineMeta(row)}</span>
                      </div>
                    </th>
                    {seasons.map((season) => {
                      const cell = row.cells.find((item) => item.year === season.year) ?? emptyCell(season.year);
                      return (
                        <ContractCell
                          key={`${row.id}-${season.year}`}
                          row={row}
                          cell={cell}
                          moneyDisplay={moneyDisplay}
                          holdTreatment={holdTreatment}
                          sandboxMode={workspaceMode === "sandbox"}
                          activeScenario={activeScenario}
                          onDecision={applyDecision}
                          onResetDecision={resetDecision}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {contractRows.length === 0 && <p className="empty">No contract rows match these filters.</p>}
          </div>
        </section>

        <aside className="cap-side-stack">
          <CapReviewPanel initialReview={data.capReview} moneyDisplay={moneyDisplay} />
          <SelectionPanel tracker={tracker} row={selectedRow} seasons={seasons.map((item) => item.year)} moneyDisplay={moneyDisplay} />
          <DataQualityPanel tracker={tracker} team={resolvedTeam} />
          <SidePanel title="Exceptions" empty="No projected or override exception rows for this path.">
            {visibleExceptions.map((item) => (
              <FactRow
                key={item.id}
                label={seasonLabel(tracker, item.year)}
                value={`${item.name}: ${formatMoneyMode(item.amount, moneyDisplay)}`}
                detail={item.note || item.source}
              />
            ))}
          </SidePanel>
          <SidePanel title="Picks" empty="No source-tagged pick rows in this range.">
            {teamPicks.map((item) => (
              <FactRow key={item.id} label={`${seasonLabel(tracker, item.year)} R${item.round}`} value={item.label} detail={item.protection || item.source} />
            ))}
          </SidePanel>
          <SidePanel title="Max Levels" empty="No max-contract levels.">
            {maxLevels.slice(0, 18).map((item) => (
              <FactRow
                key={`${item.year}-${item.tier}`}
                label={`${seasonLabel(tracker, item.year)} ${item.tier}`}
                value={formatMoneyMode(item.first_year_salary, moneyDisplay)}
                detail={`4Y ${formatMoneyMode(item.four_year_non_bird_total, moneyDisplay)} / 5Y ${formatMoneyMode(item.five_year_bird_total, moneyDisplay)}`}
              />
            ))}
          </SidePanel>
        </aside>
      </section>
    </main>
  );
}

function CapReviewPanel({ initialReview, moneyDisplay }: { initialReview?: CapReviewData; moneyDisplay: MoneyDisplay }) {
  const reviewActionsEnabled = isLocalRefreshEnabled();
  const [review, setReview] = useState<CapReviewData | undefined>(initialReview);
  const [activeStatus, setActiveStatus] = useState("pending_review");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setReview(initialReview);
  }, [initialReview]);

  useEffect(() => {
    setPage(0);
  }, [activeStatus, search, teamFilter, classFilter]);

  const rows = review?.rows ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status || "pending_review"] = (acc[row.status || "pending_review"] ?? 0) + 1;
    return acc;
  }, {});
  const teams = Array.from(new Set(rows.map((row) => row.team_to || row.team_from).filter((value): value is string => Boolean(value)))).sort();
  const classes = Array.from(new Set(rows.map((row) => row.classification).filter((value): value is string => Boolean(value)))).sort();
  const pageSize = 12;
  const filteredRows = rows
    .filter((row) => (row.status || "pending_review") === activeStatus)
    .filter((row) => teamFilter === "all" || row.team_to === teamFilter || row.team_from === teamFilter)
    .filter((row) => classFilter === "all" || row.classification === classFilter)
    .filter((row) => reviewRowMatchesSearch(row, search))
    .sort(reviewRiskSort);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const boundedPage = Math.min(page, pageCount - 1);
  const filtered = filteredRows.slice(boundedPage * pageSize, boundedPage * pageSize + pageSize);
  const pendingDeadMoney = rows.filter((row) => row.status === "approved" && row.classification === "waive_release" && moneyInputForRow(row, draftAmounts)).length;
  const summary = review?.review_summary;

  const refresh = async () => {
    setBusy(true);
    setNote("Refreshing salary resolution");
    try {
      await getRefreshStatus().catch(() => null);
      const payload = await refreshSalaryResolution();
      setReview(payload.review);
      setNote(payload.status && payload.status !== 0 ? `Review refreshed with script status ${payload.status}` : "Review refreshed");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (row: CapReviewRow, status: string) => {
    const amount = moneyInputForRow(row, draftAmounts);
    if (status === "approved" && row.classification === "waive_release" && !amount) {
      setNote("Enter an amount before approving a waive/release row.");
      return;
    }
    setBusy(true);
    setNote(`${status} ${row.player_name}`);
    try {
      const payload = await updateCapReviewStatus({
        transaction_key: row.transaction_key,
        status,
        approved_amount: amount,
        source_quality: row.source_quality || (row.salary_resolution_status === "estimated" ? "estimated" : "override")
      });
      setReview(payload);
      setNote("Review status saved");
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const applyApproved = async () => {
    setBusy(true);
    setNote("Applying approved rows");
    try {
      const payload = await applyApprovedCapReviewRows();
      setReview(payload.review);
      const rebuildStatus = payload.cap_tracker_rebuild?.status;
      setNote(`Applied ${payload.applied_dead_money_rows ?? 0} new dead-money rows${rebuildStatus && rebuildStatus !== 0 ? `; rebuild status ${rebuildStatus}` : ""}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cap-side-panel cap-review-panel">
      <div className="panel-heading">
        <h2>Cap Review</h2>
        {reviewActionsEnabled && <button onClick={refresh} disabled={busy}>Refresh</button>}
      </div>
      {!reviewActionsEnabled && <p className="cap-review-note">Public read-only mode. Review actions run through the local refresh server or scheduled CI.</p>}
      <div className="cap-review-tabs">
        {["pending_review", "needs_research", "approved", "rejected", "applied"].map((status) => (
          <button key={status} className={cls(activeStatus === status && "active")} onClick={() => setActiveStatus(status)}>
            {status.replace("_", " ")} {counts[status] ? `(${counts[status]})` : ""}
          </button>
        ))}
      </div>
      <div className="cap-review-summary">
        {["needs_research", "estimated", "reconciled", "exact"].map((key) => (
          <span key={key}>{key.replace("_", " ")} {summary?.by_resolution?.[key] ?? review?.resolution_summary?.[key] ?? 0}</span>
        ))}
        <span>approved {counts.approved ?? 0}</span>
        <span>applied {counts.applied ?? 0}</span>
      </div>
      <div className="cap-review-filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search review" />
        <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
          <option value="all">All teams</option>
          {teams.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
          <option value="all">All classes</option>
          {classes.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
        </select>
      </div>
      <div className="cap-side-body">
        {note && <p className="cap-review-note">{note}</p>}
        {reviewActionsEnabled && pendingDeadMoney > 0 && (
          <button className="cap-apply-button" onClick={applyApproved} disabled={busy}>
            Apply approved dead money ({pendingDeadMoney})
          </button>
        )}
        {filtered.length === 0 && <p className="empty">No rows in this review state.</p>}
        {filtered.map((row) => {
          const amountValue = moneyInputForRow(row, draftAmounts);
          return (
            <article className="cap-review-card" key={row.transaction_key}>
              <div className="cap-review-card-head">
                <strong>{row.player_name}</strong>
                <span>{[row.team_to || row.team_from, row.classification, row.salary_resolution_status || "unresolved"].filter(Boolean).join(" / ")}</span>
              </div>
              <p>{row.raw_text}</p>
              <div className="cap-review-detail-grid">
                <span>{row.recommended_action}</span>
                {row.contract_delta && <span>{row.contract_delta}</span>}
                {row.affected_files && <span>{row.affected_files}</span>}
                {row.applied_key && <span>Applied {row.applied_amount ? formatMoneyMode(Number(row.applied_amount), moneyDisplay) : ""} as {row.applied_key}</span>}
                {row.last_error && <span>{row.last_error}</span>}
              </div>
              <div className="cap-review-money">
                <label>
                  <span>Amount</span>
                  <input
                    value={amountValue}
                    inputMode="numeric"
                    disabled={!reviewActionsEnabled}
                    onChange={(event) => setDraftAmounts((current) => ({ ...current, [row.transaction_key]: event.target.value }))}
                    placeholder={row.suggested_amount ? String(row.suggested_amount) : "required if applying"}
                  />
                </label>
                <b>{amountValue ? formatMoneyMode(Number(String(amountValue).replace(/[$,\s]/g, "")), moneyDisplay) : "-"}</b>
              </div>
              <small>{[row.salary_source, row.resolution_note, row.conflict_note].filter(Boolean).join(" / ")}</small>
              <div className="cap-review-links">
                {row.source_url && <a href={row.source_url} target="_blank" rel="noreferrer">NBA</a>}
                {row.reference_url && <a href={row.reference_url} target="_blank" rel="noreferrer">Reference</a>}
                {row.salary_source_url && <a href={row.salary_source_url} target="_blank" rel="noreferrer">Salary</a>}
              </div>
              {reviewActionsEnabled && (
                <div className="cap-review-actions">
                  <button onClick={() => updateStatus(row, "approved")} disabled={busy}>Approve</button>
                  <button onClick={() => updateStatus(row, "needs_research")} disabled={busy}>Research</button>
                  <button onClick={() => updateStatus(row, "rejected")} disabled={busy}>Reject</button>
                </div>
              )}
            </article>
          );
        })}
        {filteredRows.length > pageSize && (
          <div className="cap-review-pager">
            <button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={busy || boundedPage === 0}>Prev</button>
            <span>{boundedPage + 1} / {pageCount}</span>
            <button onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={busy || boundedPage >= pageCount - 1}>Next</button>
          </div>
        )}
      </div>
    </section>
  );
}

function CapKpiStrip({ current, next, holdTreatment, moneyDisplay }: { current?: CapTrackerTeamSeason; next?: CapTrackerTeamSeason; holdTreatment: HoldTreatment; moneyDisplay: MoneyDisplay }) {
  const status = current ? statusForTreatment(current, holdTreatment) : "-";
  const kpis = [
    { label: "Path status", value: status, detail: holdTreatment === "include" ? "Retained holds" : "Room path" },
    { label: "Cap room", value: formatSignedMoneyMode(current ? roomFor(current, holdTreatment) : null, moneyDisplay), detail: "Selected path" },
    { label: "Tax room", value: formatSignedMoneyMode(current ? thresholdRoom(current, holdTreatment, "tax") : null, moneyDisplay), detail: "Path-sensitive" },
    { label: "1st apron", value: formatSignedMoneyMode(current ? thresholdRoom(current, holdTreatment, "first") : null, moneyDisplay), detail: "Path-sensitive" },
    { label: "2nd apron", value: formatSignedMoneyMode(current ? thresholdRoom(current, holdTreatment, "second") : null, moneyDisplay), detail: "Path-sensitive" },
    { label: "Roster / holds", value: current ? `${current.roster_count} / ${current.hold_count}` : "-", detail: next ? `Next room ${formatSignedMoneyMode(roomFor(next, holdTreatment), moneyDisplay)}` : "" }
  ];
  return (
    <section className="cap-kpi-strip">
      {kpis.map((item) => (
        <div className="cap-kpi" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </div>
      ))}
    </section>
  );
}

function DataQualityPanel({ tracker, team }: { tracker: CapTrackerData; team: string }) {
  const warningCount = tracker.warnings?.length ?? 0;
  const validation = tracker.validation_summary;
  return (
    <SidePanel title="Data Quality" empty="No data-quality notes.">
      <FactRow label="Schema" value={`v${tracker.schema_version ?? 1}`} detail={`Generated ${new Date(tracker.generated_at).toLocaleString()}`} />
      {validation && (
        <FactRow
          label="Validation"
          value={`${validation.team_season_rows_actual}/${validation.team_season_rows_expected}`}
          detail={`Dupes: contracts ${validation.duplicate_contract_ids}, team seasons ${validation.duplicate_team_seasons}, dead money ${validation.duplicate_dead_money_rows}`}
        />
      )}
      <FactRow label="Warnings" value={String(warningCount)} detail={tracker.warnings?.slice(0, 2).join(" / ") || "No projected-input warnings"} />
      {tracker.source_audit.slice(0, 5).map((item) => (
        <FactRow key={`${team}-${item.label}`} label={item.label} value={sourceLabel(item.quality)} detail={item.detail} />
      ))}
    </SidePanel>
  );
}

function ContractCell({
  row,
  cell,
  moneyDisplay,
  holdTreatment,
  sandboxMode,
  activeScenario,
  onDecision,
  onResetDecision
}: {
  row: CapTrackerContractRow;
  cell: CapTrackerContractCell;
  moneyDisplay: MoneyDisplay;
  holdTreatment: HoldTreatment;
  sandboxMode: boolean;
  activeScenario: CapSandboxScenario | null;
  onDecision: (row: CapTrackerContractRow, cell: CapTrackerContractCell, action: string) => void;
  onResetDecision: (row: CapTrackerContractRow, cell: CapTrackerContractCell) => void;
}) {
  if (!cell.amount) return <td className="cap-cell empty">-</td>;
  const renounced = holdTreatment === "renounce" && cell.kind === "cap_hold";
  const badge = cell.label || cellBadges[cell.kind] || cell.status;
  const actions = sandboxMode ? supportedActions(cell) : [];
  const decision = activeScenario?.decisions[`${row.team}||${row.id}||${cell.year}`];
  return (
    <td className={cls("cap-cell", `kind-${cell.kind}`, `source-${cell.source}`, renounced && "renounced", decision && "sandbox-changed")} title={[cell.status, cell.note, cell.guarantee_note].filter(Boolean).join(" - ")}>
      <div className="cap-cell-stack">
        <div>
          <span className="cap-money">{renounced ? formatMoneyMode(0, moneyDisplay) : formatMoneyMode(cell.amount, moneyDisplay)}</span>
          <span className="cap-badge">{renounced ? "Ren." : badge}</span>
        </div>
        {cell.unguaranteed_amount ? <small>Gtd {formatMoneyMode(cell.guaranteed_amount ?? 0, moneyDisplay)}</small> : null}
        {actions.length > 0 && (
          <div className="cap-sandbox-actions">
            {actions.map((action) => (
              <button key={action} className={cls(decision?.action === action && "active")} onClick={(event) => { event.stopPropagation(); onDecision(row, cell, action); }}>
                {actionLabel(action)}
              </button>
            ))}
            {decision && (
              <button onClick={(event) => { event.stopPropagation(); onResetDecision(row, cell); }}>
                Reset
              </button>
            )}
          </div>
        )}
      </div>
    </td>
  );
}

function SandboxScenarioBar({
  scenarios,
  activeScenario,
  resolvedTeam,
  baseCurrent,
  current,
  holdTreatment,
  moneyDisplay,
  onSelect,
  onCreate,
  onReset,
  onDuplicate,
  onDelete
}: {
  scenarios: CapSandboxScenario[];
  activeScenario: CapSandboxScenario | null;
  resolvedTeam: string;
  baseCurrent?: CapTrackerTeamSeason;
  current?: CapTrackerTeamSeason;
  holdTreatment: HoldTreatment;
  moneyDisplay: MoneyDisplay;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onReset: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const baseRoom = baseCurrent ? roomFor(baseCurrent, holdTreatment) : 0;
  const sandboxRoom = current ? roomFor(current, holdTreatment) : 0;
  const baseTax = baseCurrent ? thresholdRoom(baseCurrent, holdTreatment, "tax") : 0;
  const sandboxTax = current ? thresholdRoom(current, holdTreatment, "tax") : 0;
  const baseApron = baseCurrent ? thresholdRoom(baseCurrent, holdTreatment, "second") : 0;
  const sandboxApron = current ? thresholdRoom(current, holdTreatment, "second") : 0;
  const decisions = Object.values(activeScenario?.decisions ?? {});
  return (
    <section className="cap-sandbox-panel">
      <div className="cap-sandbox-head">
        <div>
          <span>Sandbox</span>
          <strong>{activeScenario?.name ?? `${resolvedTeam} sandbox`}</strong>
        </div>
        <select value={activeScenario?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
          {scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button onClick={onCreate}>New</button>
        <button onClick={onDuplicate} disabled={!activeScenario}>Duplicate</button>
        <button onClick={onReset} disabled={!activeScenario || decisions.length === 0}>Reset</button>
        <button onClick={onDelete} disabled={!activeScenario}>Delete</button>
      </div>
      <div className="cap-sandbox-deltas">
        <FactRow label="Cap room delta" value={formatSignedMoneyMode(sandboxRoom - baseRoom, moneyDisplay)} detail={`Now ${formatSignedMoneyMode(sandboxRoom, moneyDisplay)}`} />
        <FactRow label="Tax room delta" value={formatSignedMoneyMode(sandboxTax - baseTax, moneyDisplay)} detail={`Now ${formatSignedMoneyMode(sandboxTax, moneyDisplay)}`} />
        <FactRow label="2nd apron delta" value={formatSignedMoneyMode(sandboxApron - baseApron, moneyDisplay)} detail={`Now ${formatSignedMoneyMode(sandboxApron, moneyDisplay)}`} />
        <FactRow label="Dead money added" value={formatMoneyMode(current?.sandbox_dead_money_added ?? 0, moneyDisplay)} detail={`${decisions.length} decisions`} />
      </div>
    </section>
  );
}

function SelectionPanel({ tracker, row, seasons, moneyDisplay }: { tracker: CapTrackerData; row: CapTrackerContractRow | null; seasons: number[]; moneyDisplay: MoneyDisplay }) {
  if (!row) {
    return (
      <SidePanel title="Selection" empty="Select a cap-sheet row for source detail.">
        {null}
      </SidePanel>
    );
  }
  const visibleCells = row.cells.filter((cell) => seasons.includes(cell.year) && cell.amount > 0);
  return (
    <section className="cap-side-panel cap-selection-panel">
      <div className="panel-heading">
        <h2>Selection</h2>
      </div>
      <div className="cap-selection-head">
        <strong>{row.player_name}</strong>
        <span>{[row.position, row.age ? `${row.age.toFixed(1)}y` : null, row.rank ? `#${row.rank}` : null].filter(Boolean).join(" / ") || row.row_type}</span>
      </div>
      <div className="cap-side-body">
        {visibleCells.map((cell) => (
          <FactRow
            key={`${row.id}-${cell.year}`}
            label={`${seasonLabel(tracker, cell.year)} ${cell.label || cellBadges[cell.kind] || cell.status}`}
            value={formatMoneyMode(cell.amount, moneyDisplay)}
            detail={[cell.status, sourceLabel(cell.source), cell.note].filter(Boolean).join(" / ")}
          />
        ))}
        {row.contract_notes && <FactRow label="Notes" value={row.row_type.replace("_", " ")} detail={row.contract_notes} />}
        <FactRow label="Source" value={sourceLabel(row.source_quality)} detail={row.source} />
      </div>
    </section>
  );
}

function Segmented({ label, options, value, onChange }: { label: string; options: Array<[string, string]>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="cap-segmented" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} className={cls(value === option && "active")} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SidePanel({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="cap-side-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="cap-side-body">{hasChildren ? children : <p className="empty">{empty}</p>}</div>
    </section>
  );
}

function FactRow({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="cap-fact-row">
      <div>
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <b>{value}</b>
    </div>
  );
}

function buildSummaryRows(holdTreatment: HoldTreatment) {
  return [
    { key: "salary", label: "Contracts on books", value: (row: CapTrackerTeamSeason) => row.salary_on_books ?? row.active_salary, signed: false, emphasis: true },
    { key: "guaranteed-base", label: "Guaranteed base", value: (row: CapTrackerTeamSeason) => row.guaranteed_base_salary ?? row.guaranteed_salary, signed: false },
    { key: "at-risk", label: "At-risk salary", value: (row: CapTrackerTeamSeason) => row.at_risk_salary ?? 0, signed: false },
    { key: "draft", label: "Draft pick charges", value: (row: CapTrackerTeamSeason) => row.draft_pick_charges ?? 0, signed: false },
    { key: "holds", label: "Cap holds", value: (row: CapTrackerTeamSeason) => holdTreatment === "include" ? row.cap_holds : 0, signed: false },
    { key: "dead", label: "Dead money", value: (row: CapTrackerTeamSeason) => row.dead_money, signed: false },
    { key: "roster", label: "Roster charges", value: (row: CapTrackerTeamSeason) => holdTreatment === "include" ? row.roster_charges_with_holds : row.roster_charges_renounced, signed: false },
    { key: "books", label: "Team salary", value: (row: CapTrackerTeamSeason) => booksFor(row, holdTreatment), signed: false, emphasis: true },
    { key: "room", label: "Cap room", value: (row: CapTrackerTeamSeason) => roomFor(row, holdTreatment), signed: true },
    { key: "tax", label: "Tax room", value: (row: CapTrackerTeamSeason) => thresholdRoom(row, holdTreatment, "tax"), signed: true },
    { key: "first-apron", label: "1st apron room", value: (row: CapTrackerTeamSeason) => thresholdRoom(row, holdTreatment, "first"), signed: true },
    { key: "second-apron", label: "2nd apron room", value: (row: CapTrackerTeamSeason) => thresholdRoom(row, holdTreatment, "second"), signed: true }
  ];
}

function defaultTeamForTracker(tracker: CapTrackerData | undefined) {
  if (!tracker?.teams.length) return "UTA";
  return preferredDefaultTeams.find((item) => tracker.teams.some((team) => team.team === item)) ?? tracker.teams[0].team;
}

function rowHasMoneyInRange(row: CapTrackerContractRow, startYear: number, endYear: number) {
  return row.cells.some((cell) => cell.year >= startYear && cell.year <= endYear && cell.amount > 0);
}

function rowMatchesFilters(row: CapTrackerContractRow, startYear: number, endYear: number, search: string, kindFilter: string, sourceFilter: string) {
  const visibleCells = row.cells.filter((cell) => cell.year >= startYear && cell.year <= endYear && cell.amount > 0);
  const searchKey = search.trim().toLowerCase();
  if (searchKey) {
    const haystack = [
      row.player_name,
      row.position,
      row.contract_notes,
      row.source,
      row.source_quality,
      ...visibleCells.flatMap((cell) => [cell.kind, cell.status, cell.source, cell.note, cell.label])
    ].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(searchKey)) return false;
  }
  if (sourceFilter !== "all" && !visibleCells.some((cell) => cell.source === sourceFilter || row.source_quality === sourceFilter)) return false;
  if (kindFilter === "option") return visibleCells.some((cell) => cell.kind === "player_option" || cell.kind === "team_option");
  if (kindFilter !== "all") return visibleCells.some((cell) => cell.kind === kindFilter);
  return true;
}

function contractRowSort(a: CapTrackerContractRow, b: CapTrackerContractRow) {
  return (a.display_order ?? 9999) - (b.display_order ?? 9999) || a.player_name.localeCompare(b.player_name);
}

function booksFor(row: CapTrackerTeamSeason, holdTreatment: HoldTreatment) {
  return holdTreatment === "include" ? row.likely_books_with_holds : row.likely_books_renounced;
}

function roomFor(row: CapTrackerTeamSeason, holdTreatment: HoldTreatment) {
  return holdTreatment === "include" ? (row.room_if_holds_retained ?? row.cap_room_with_holds) : (row.room_if_renounced ?? row.cap_room_renounced);
}

function thresholdRoom(row: CapTrackerTeamSeason, holdTreatment: HoldTreatment, threshold: "tax" | "first" | "second") {
  if (holdTreatment === "renounce") {
    if (threshold === "tax") return row.tax_room_renounced ?? row.tax_room;
    if (threshold === "first") return row.first_apron_room_renounced ?? row.first_apron_room;
    return row.second_apron_room_renounced ?? row.second_apron_room;
  }
  if (threshold === "tax") return row.tax_room_with_holds ?? row.tax_room;
  if (threshold === "first") return row.first_apron_room_with_holds ?? row.first_apron_room;
  return row.second_apron_room_with_holds ?? row.second_apron_room;
}

function statusForTreatment(row: CapTrackerTeamSeason, holdTreatment: HoldTreatment) {
  return holdTreatment === "include" ? row.status_band_with_holds ?? row.status_band : row.status_band_renounced ?? row.status_band;
}

function reviewRowMatchesSearch(row: CapReviewRow, search: string) {
  const key = search.trim().toLowerCase();
  if (!key) return true;
  return [
    row.player_name,
    row.team_from,
    row.team_to,
    row.classification,
    row.raw_text,
    row.recommended_action,
    row.contract_delta,
    row.salary_source,
    row.resolution_note,
    row.conflict_note,
    row.affected_files,
    row.applied_key,
    row.last_error
  ].filter(Boolean).join(" ").toLowerCase().includes(key);
}

function reviewRiskSort(a: CapReviewRow, b: CapReviewRow) {
  return reviewRiskScore(b) - reviewRiskScore(a) || String(b.transaction_date).localeCompare(String(a.transaction_date)) || a.player_name.localeCompare(b.player_name);
}

function reviewRiskScore(row: CapReviewRow) {
  let score = 0;
  if (row.confidence === "high") score += 4;
  if (row.classification === "waive_release") score += 5;
  if (row.salary_resolution_status === "needs_research") score += 4;
  if (row.salary_resolution_status === "estimated") score += 3;
  if (row.conflict_note) score += 4;
  if (row.contract_delta) score += 2;
  return score;
}

function moneyInputForRow(row: CapReviewRow, draftAmounts: Record<string, string>) {
  return draftAmounts[row.transaction_key] ?? String(row.approved_amount || row.suggested_amount || "");
}

function seasonLabel(tracker: CapTrackerData, year: number | undefined) {
  if (!year) return "-";
  return tracker.seasons.find((season) => season.year === year)?.label ?? `${year - 1}-${String(year).slice(2)}`;
}

function formatMoneyMode(value: number | null | undefined, display: MoneyDisplay) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (display === "compact") return formatMoney(value);
  return `$${Math.round(value).toLocaleString()}`;
}

function formatSignedMoneyMode(value: number | null | undefined, display: MoneyDisplay) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (display === "compact") return formatSignedMoney(value);
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(Math.round(value)).toLocaleString()}`;
}

function emptyCell(year: number): CapTrackerContractCell {
  return { year, amount: 0, kind: "empty", status: "", source: "unavailable", label: null, note: null };
}

function lineMeta(row: CapTrackerContractRow) {
  if (row.row_type === "draft_pick") return "Draft pick placeholder";
  if (row.row_type === "dead_money") return "Dead money";
  return [row.position, row.age ? `${row.age.toFixed(1)}y` : null, row.rank ? `#${row.rank}` : null].filter(Boolean).join(" / ");
}

function sourceLabel(value: string) {
  if (value === "bref-option") return "BRef option";
  if (value === "spotrac") return "Spotrac";
  if (value === "contract") return "Contract";
  if (value === "cached") return "Prior estimate";
  if (value === "override") return "Override";
  if (value === "estimated") return "Estimated";
  if (value === "projected") return "Projected";
  return "Unavailable";
}

function pathForTreatment(value: HoldTreatment) {
  return value === "include" ? "retained" : "renounced";
}
