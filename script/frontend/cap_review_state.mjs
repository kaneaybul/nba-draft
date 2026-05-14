import { buildReviewSummary, cleanTeam, normalizeName, numberValue, stringValue } from "./cap_tracker_rules.mjs";

export const DEAD_MONEY_COLUMNS = [
  "team",
  "year",
  "player_name",
  "amount",
  "note",
  "source",
  "source_quality",
  "event_key",
  "transaction_key",
  "effective_date"
];

export function capReviewPayload(rows, generatedAt = new Date().toISOString()) {
  const normalizedRows = rows.map(ensureReviewStateFields);
  return {
    generated_at: generatedAt,
    resolution_summary: resolutionSummary(normalizedRows),
    review_summary: buildReviewSummary(normalizedRows),
    rows: normalizedRows
  };
}

export function applyApprovedDeadMoneyRows(rows, existingDeadRows, now = new Date().toISOString()) {
  const existingKeys = new Set();
  for (const row of existingDeadRows) {
    for (const key of deadIdentityKeys(row)) existingKeys.add(key);
  }

  const additions = [];
  const appliedByTransaction = new Map();

  for (const row of rows) {
    if (row.status !== "approved" || row.classification !== "waive_release") continue;

    const amount = numberValue(row.approved_amount, row.suggested_amount);
    const team = cleanTeam(row.team_to || row.team_from);
    const year = seasonEndYear(row.transaction_date);
    const playerName = row.player_name || "";
    const eventKey = appliedEventKey(row);

    if (!amount || amount <= 0 || !team || !playerName) {
      appliedByTransaction.set(row.transaction_key, {
        status: row.status,
        last_error: "Approved waive/release rows need a positive amount, team, and player before apply."
      });
      continue;
    }

    const candidate = {
      team,
      year,
      player_name: playerName,
      amount: Math.round(amount),
      note: [
        row.source_quality === "estimated" ? "Estimated dead money." : "Approved dead-money review.",
        row.resolution_note,
        row.conflict_note
      ].filter(Boolean).join(" "),
      source: row.salary_source_url || row.salary_source || row.source_url || row.reference_url,
      source_quality: row.source_quality || (row.salary_resolution_status === "estimated" ? "estimated" : "override"),
      event_key: eventKey,
      transaction_key: row.transaction_key,
      effective_date: row.transaction_date
    };

    const candidateKeys = deadIdentityKeys(candidate);
    const alreadyExists = candidateKeys.some((key) => existingKeys.has(key));
    if (!alreadyExists) {
      additions.push(candidate);
      for (const key of candidateKeys) existingKeys.add(key);
    }

    appliedByTransaction.set(row.transaction_key, {
      status: "applied",
      applied_at: row.applied_at || now,
      applied_key: eventKey,
      applied_amount: String(Math.round(amount)),
      last_error: ""
    });
  }

  const updatedRows = rows.map((row) => {
    const applied = appliedByTransaction.get(row.transaction_key);
    return applied ? { ...row, ...applied } : row;
  });

  return {
    rows: updatedRows,
    deadMoneyRows: additions.length ? [...existingDeadRows, ...additions] : existingDeadRows,
    additions
  };
}

export function cleanMoneyText(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  return text && Number.isFinite(Number(text)) ? String(Math.round(Number(text))) : "";
}

export function seasonEndYear(dateValue) {
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return new Date().getUTCFullYear();
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

export function appliedEventKey(row) {
  return `review:${stringValue(row.transaction_key) || normalizeName(`${row.transaction_date}-${row.player_name}-${row.raw_text}`)}`;
}

function deadIdentityKeys(row) {
  const keys = [];
  if (stringValue(row.event_key)) keys.push(`event:${stringValue(row.event_key)}`);
  if (stringValue(row.transaction_key)) keys.push(`transaction:${stringValue(row.transaction_key)}`);
  keys.push(`natural:${cleanTeam(row.team)}||${numberValue(row.year) ?? ""}||${normalizeName(row.player_name)}||${numberValue(row.amount) ?? ""}`);
  return keys;
}

function resolutionSummary(rows) {
  const counts = {};
  for (const row of rows) {
    const key = row.salary_resolution_status || "unresolved";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ensureReviewStateFields(row) {
  return {
    ...row,
    applied_at: row.applied_at || "",
    applied_key: row.applied_key || "",
    applied_amount: row.applied_amount || "",
    last_error: row.last_error || ""
  };
}
