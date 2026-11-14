export const CAP_TRACKER_SCHEMA_VERSION = 2;

export const CBA_REFERENCES = [
  "2023 NBA Collective Bargaining Agreement Article VII",
  "NBA CBA 101 system-level and apron-team-salary guidance"
];

export const CBA_RATIOS = {
  minimumTeamSalary: 0.9,
  taxLevel: 1.215,
  nonTaxpayerMle: 0.0912,
  biAnnual: 0.0353,
  roomMle: 0.05678,
  taxpayerMleBase2024: 5_000_000,
  taxpayerMleBaseCap2024: 136_021_000
};

export function canonicalContractKey(row) {
  const id = stringValue(row.nba_id);
  if (id) return `id:${id}`;
  return `name-team-salary:${normalizeName(row.player_name)}:${cleanTeam(row.team)}:${salarySignature(row)}`;
}

export function canonicalContractRowId(row, team) {
  const id = stringValue(row.nba_id);
  if (id) return `player-${id}`;
  return `player-${normalizeName(row.player_name)}-${cleanTeam(team)}`;
}

export function mergeDuplicateContractSources(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = canonicalContractKey(row);
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, mergeContractSourceRow(prior, row));
  }
  return Array.from(byKey.values());
}

export function canonicalDeadMoneyKey(row) {
  const eventKey = stringValue(row.event_key || row.transaction_key);
  if (eventKey) return `event:${eventKey}`;
  return [
    cleanTeam(row.team),
    numberValue(row.year) ?? "",
    normalizeName(row.player_name),
    numberValue(row.amount) ?? "",
    normalizeName(row.note || ""),
    normalizeName(row.source || "")
  ].join("||");
}

export function canonicalDeadMoneyDisplayKey(row) {
  return [
    cleanTeam(row.team),
    numberValue(row.year) ?? "",
    normalizeName(row.player_name),
    numberValue(row.amount) ?? "",
    normalizeName(row.note || "")
  ].join("||");
}

export function dedupeDeadMoneyRows(rows) {
  const byKey = new Map();
  const warnings = [];
  for (const row of rows) {
    const key = canonicalDeadMoneyKey(row);
    if (byKey.has(key)) {
      warnings.push(`Collapsed duplicate dead-money row for ${cleanTeam(row.team)} ${row.year} ${row.player_name}.`);
      continue;
    }
    byKey.set(key, row);
  }
  return { rows: Array.from(byKey.values()), warnings };
}

export function systemLevelSourceQuality(row, hasCap, hasTax, hasFirstApron, hasSecondApron) {
  if (hasCap && hasTax && hasFirstApron && hasSecondApron) return "contract";
  if (hasCap || row?.source) return "projected";
  return "unavailable";
}

export function salaryFloor(cap) {
  return Math.round(cap * CBA_RATIOS.minimumTeamSalary);
}

export function projectedTaxLevel(cap) {
  return Math.round(cap * CBA_RATIOS.taxLevel);
}

export function projectedFirstApron(cap, knownRows = []) {
  return Math.round(cap * medianRatio(knownRows, "first_apron", "salary_cap", 1.267));
}

export function projectedSecondApron(cap, knownRows = []) {
  return Math.round(cap * medianRatio(knownRows, "second_apron", "salary_cap", 1.344));
}

export function minimumRosterCharge(cap) {
  return Math.round(cap * (1_378_978 / 166_000_000));
}

export function cbaCapHoldAmount({ status, rights, previousSalary, isRookieScale, season }) {
  const cap = season?.salary_cap ?? 166_000_000;
  const averageSalaryEstimate = cap * 0.08;
  if (status === "RFA") return previousSalary * (isRookieScale ? 3 : 2.5);
  if (rights === "Bird") return previousSalary < averageSalaryEstimate ? previousSalary * 1.9 : previousSalary * 1.5;
  if (rights === "Early Bird") return previousSalary * 1.3;
  if (rights === "Non-Bird") return Math.max(1_500_000, previousSalary * 1.2);
  return 0;
}

export function guaranteeInfoForYear(row, year, amount, override) {
  const overrideAmount = numberValue(override?.guaranteed_amount);
  if (override && overrideAmount !== null) {
    return {
      guaranteed_amount: Math.max(0, Math.min(Math.round(amount), Math.round(overrideAmount))),
      unguaranteed_amount: Math.max(0, Math.round(amount) - Math.round(overrideAmount)),
      guarantee_deadline: override.guarantee_deadline || null,
      guarantee_note: override.note || override.source || "Manual guarantee override",
      guarantee_source: "override"
    };
  }

  const parsed = parseGuaranteeFromNotes(`${row?.contract_notes ?? ""} ${row?.notes ?? ""}`, year, amount);
  if (parsed) return parsed;
  return {
    guaranteed_amount: Math.round(amount),
    unguaranteed_amount: 0,
    guarantee_deadline: null,
    guarantee_note: null,
    guarantee_source: "unavailable"
  };
}

export function parseGuaranteeFromNotes(notes, year, amount) {
  const text = String(notes ?? "");
  if (!text.trim()) return null;
  const segment = guaranteeSegmentForYear(text, year);
  if (!segment) return null;
  const moneyMatches = Array.from(segment.matchAll(/\$([0-9,]+)\s+guaranteed\b/gi));
  if (moneyMatches.length) {
    const guaranteed = numberValue(moneyMatches[moneyMatches.length - 1][1]) ?? 0;
    return {
      guaranteed_amount: Math.max(0, Math.min(Math.round(amount), Math.round(guaranteed))),
      unguaranteed_amount: Math.max(0, Math.round(amount) - Math.round(guaranteed)),
      guarantee_deadline: guaranteeDeadline(segment),
      guarantee_note: segment.trim(),
      guarantee_source: "contract_notes"
    };
  }
  if (/\bnon[- ]guaranteed\b/i.test(segment)) {
    return {
      guaranteed_amount: 0,
      unguaranteed_amount: Math.round(amount),
      guarantee_deadline: guaranteeDeadline(segment),
      guarantee_note: segment.trim(),
      guarantee_source: "contract_notes"
    };
  }
  return null;
}

export function exceptionAmount(kind, season) {
  const cap = season?.salary_cap ?? 166_000_000;
  if (kind === "non_taxpayer_mle") return cap * CBA_RATIOS.nonTaxpayerMle;
  if (kind === "bi_annual") return cap * CBA_RATIOS.biAnnual;
  if (kind === "room_mle") return cap * CBA_RATIOS.roomMle;
  if (kind === "taxpayer_mle") return CBA_RATIOS.taxpayerMleBase2024 * (cap / CBA_RATIOS.taxpayerMleBaseCap2024);
  return 0;
}

function guaranteeSegmentForYear(notes, year) {
  const label = `${year - 1}-${String(year).slice(2)}`;
  const parts = notes.split(/\s*\|\s*/g);
  return parts.find((part) => part.includes(label) && /\b(guaranteed|non[- ]guaranteed)\b/i.test(part)) || "";
}

function guaranteeDeadline(segment) {
  const date = segment.match(/\b(?:deadline|guaranteed)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  if (date) return date[1];
  const draft = segment.match(/\bfully guaranteed\s+([^|.;)]+)/i);
  if (draft) return draft[1].trim();
  return null;
}

export function statusBandForAmount(amount, season) {
  if (amount > season.second_apron) return "Over 2nd Apron";
  if (amount > season.first_apron) return "1st Apron - 2nd Apron";
  if (amount > season.tax_level) return "Tax - 1st Apron";
  if (amount > season.salary_cap) return "Cap - Tax";
  return "Cap Space";
}

export function buildReviewSummary(rows) {
  const byStatus = {};
  const byResolution = {};
  const byClassification = {};
  const byTeam = {};
  for (const row of rows) {
    increment(byStatus, row.status || "pending_review");
    increment(byResolution, row.salary_resolution_status || "unresolved");
    increment(byClassification, row.classification || "unclassified");
    increment(byTeam, row.team_to || row.team_from || "UNK");
  }
  return {
    total: rows.length,
    by_status: byStatus,
    by_resolution: byResolution,
    by_classification: byClassification,
    by_team: byTeam
  };
}

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function cleanTeam(value) {
  return String(value ?? "").trim().toUpperCase() || "FA";
}

export function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const parsed = Number(String(value).replace(/[$,%]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function stringValue(value) {
  const text = String(value ?? "").trim();
  return text && text !== "NA" ? text : "";
}

function salarySignature(row) {
  const salaries = [];
  for (let index = 0; index <= 4; index += 1) {
    salaries.push(numberValue(row[`salary_y${index}`]) ?? "");
  }
  return salaries.join("-");
}

function mergeContractSourceRow(a, b) {
  const scoreA = sourceCompletenessScore(a);
  const scoreB = sourceCompletenessScore(b);
  const primary = scoreB > scoreA ? b : a;
  const secondary = primary === a ? b : a;
  const merged = { ...secondary, ...primary };
  for (let index = 0; index <= 4; index += 1) {
    merged[`salary_y${index}`] = stringValue(primary[`salary_y${index}`]) || stringValue(secondary[`salary_y${index}`]);
    merged[`contract_status_y${index}`] = stringValue(primary[`contract_status_y${index}`]) || stringValue(secondary[`contract_status_y${index}`]);
  }
  merged._bref = primary._bref || secondary._bref || {};
  merged.source = [primary.source, secondary.source].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).join("; ");
  return merged;
}

function sourceCompletenessScore(row) {
  let score = 0;
  if (stringValue(row.nba_id)) score += 8;
  for (const field of ["team", "free_agent_status", "free_agent_year", "guaranteed", "contract_type", "signed_using", "contract_notes"]) {
    if (stringValue(row[field])) score += 1;
  }
  for (let index = 0; index <= 4; index += 1) {
    if (numberValue(row[`salary_y${index}`])) score += 2;
    if (stringValue(row[`contract_status_y${index}`])) score += 1;
  }
  return score;
}

function medianRatio(rows, numerator, denominator, fallback) {
  const ratios = rows
    .map((row) => {
      const top = numberValue(row?.[numerator]);
      const bottom = numberValue(row?.[denominator]);
      return top && bottom ? top / bottom : null;
    })
    .filter((value) => Number.isFinite(value));
  if (!ratios.length) return fallback;
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}
