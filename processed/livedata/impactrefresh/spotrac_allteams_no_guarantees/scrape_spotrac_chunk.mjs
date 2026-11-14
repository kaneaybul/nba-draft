const pluginRoot = "file:///C:/Users/brend/.codex/plugins/cache/openai-bundled/chrome/0.1.7/scripts/browser-client.mjs";

export const teams = [
  { team: "Atlanta Hawks", slug: "atlanta-hawks" },
  { team: "Boston Celtics", slug: "boston-celtics" },
  { team: "Brooklyn Nets", slug: "brooklyn-nets" },
  { team: "Charlotte Hornets", slug: "charlotte-hornets" },
  { team: "Chicago Bulls", slug: "chicago-bulls" },
  { team: "Cleveland Cavaliers", slug: "cleveland-cavaliers" },
  { team: "Dallas Mavericks", slug: "dallas-mavericks" },
  { team: "Denver Nuggets", slug: "denver-nuggets" },
  { team: "Detroit Pistons", slug: "detroit-pistons" },
  { team: "Golden State Warriors", slug: "golden-state-warriors" },
  { team: "Houston Rockets", slug: "houston-rockets" },
  { team: "Indiana Pacers", slug: "indiana-pacers" },
  { team: "Los Angeles Clippers", slug: "la-clippers" },
  { team: "Los Angeles Lakers", slug: "los-angeles-lakers" },
  { team: "Memphis Grizzlies", slug: "memphis-grizzlies" },
  { team: "Miami Heat", slug: "miami-heat" },
  { team: "Milwaukee Bucks", slug: "milwaukee-bucks" },
  { team: "Minnesota Timberwolves", slug: "minnesota-timberwolves" },
  { team: "New Orleans Pelicans", slug: "new-orleans-pelicans" },
  { team: "New York Knicks", slug: "new-york-knicks" },
  { team: "Oklahoma City Thunder", slug: "oklahoma-city-thunder" },
  { team: "Orlando Magic", slug: "orlando-magic" },
  { team: "Philadelphia 76ers", slug: "philadelphia-76ers" },
  { team: "Phoenix Suns", slug: "phoenix-suns" },
  { team: "Portland Trail Blazers", slug: "portland-trail-blazers" },
  { team: "Sacramento Kings", slug: "sacramento-kings" },
  { team: "San Antonio Spurs", slug: "san-antonio-spurs" },
  { team: "Toronto Raptors", slug: "toronto-raptors" },
  { team: "Utah Jazz", slug: "utah-jazz" },
  { team: "Washington Wizards", slug: "washington-wizards" },
];

const seasonCols = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"];
const longCols = [
  "team", "section", "entity_type", "player_or_entity", "pos", "age", "season",
  "cell_text", "amount_text", "pct_of_cap", "status_flags", "guarantee_text",
  "guarantee_capture_status", "source_url", "scraped_at", "has_value",
];
const wideCols = [
  "team", "section", "entity_type", "player_or_entity", "pos", "age", "source_url",
  "scraped_at", "guarantee_capture_status", ...seasonCols, "raw_row_text",
];
const auditCols = [
  "team", "source_url", "status", "table_count", "active_roster_rows",
  "cap_hold_player_rows", "cap_hold_roster_charge_rows", "cap_hold_table_index",
  "elapsed_seconds", "scraped_at", "method", "error_message",
];
const rawCols = ["team", "section", "source_url", "raw_text"];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function appendCsv(fs, path, file, rows, cols, reset = false) {
  const target = path.join(outputDir(path), file);
  const header = cols.join(",") + "\r\n";
  const body = rows.map((row) => cols.map((col) => csvEscape(row[col])).join(",")).join("\r\n");
  if (reset) {
    await fs.writeFile(target, header + (body ? `${body}\r\n` : ""), "utf8");
  } else if (body) {
    await fs.appendFile(target, `${body}\r\n`, "utf8");
  }
}

function outputDir(path) {
  return path.join(nodeRepl.cwd, "processed", "livedata", "impactrefresh", "spotrac_allteams_no_guarantees");
}

function normalizeCell(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(cell) {
  const m = (cell || "").match(/\$[0-9,.]+[MK]?/i);
  return m ? m[0] : "";
}

function parsePct(cell) {
  const m = (cell || "").match(/\b\d+(?:\.\d+)?%/);
  return m ? m[0] : "";
}

function parseFlags(cell) {
  const statuses = [
    "Player Option", "Club Option", "Team Option", "Non-Guaranteed",
    "Ext. Elig.", "Extension Eligible", "Two-Way", "RFA", "UFA",
  ];
  return statuses
    .filter((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cell || ""))
    .join("; ");
}

function parseSection(text, section, team, sourceUrl, scrapedAt) {
  const clean = (text || "").replace(/\r\n/g, "\n");
  const bodyStart = clean.indexOf("\n\n");
  const body = bodyStart >= 0 ? clean.slice(bodyStart + 2) : clean;
  const rx = /^([^\n\t]+)\t([A-Z][A-Z\-/]*)\t(\d+)\t?/gm;
  const starts = [];
  let match;
  while ((match = rx.exec(body)) !== null) starts.push(match.index);

  const rows = [];
  for (let i = 0; i < starts.length; i += 1) {
    const block = body.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : body.length).trimEnd();
    const firstNl = block.indexOf("\n");
    const firstLine = firstNl >= 0 ? block.slice(0, firstNl) : block;
    const hm = firstLine.match(/^([^\n\t]+)\t([A-Z][A-Z\-/]*)\t(\d+)\t?/);
    if (!hm) continue;

    const row = {
      team,
      section,
      entity_type: "player",
      player_or_entity: hm[1].replace(/\s+/g, " ").trim(),
      pos: hm[2].trim(),
      age: hm[3].trim(),
      source_url: sourceUrl,
      scraped_at: scrapedAt,
      guarantee_capture_status: "not_attempted_hover_only",
    };
    const rest = firstNl >= 0 ? block.slice(firstNl + 1) : "";
    const rawCells = rest.split("\t").slice(0, seasonCols.length);
    while (rawCells.length < seasonCols.length) rawCells.push("");
    seasonCols.forEach((season, idx) => {
      row[season] = normalizeCell(rawCells[idx]);
    });
    row.raw_row_text = block.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    rows.push(row);
  }

  const rosterChargeIdx = body.indexOf("Incomplete Roster Charge");
  if (rosterChargeIdx >= 0) {
    const block = body.slice(rosterChargeIdx).trimEnd();
    const rawCells = block.split("\t").slice(1, 1 + seasonCols.length);
    while (rawCells.length < seasonCols.length) rawCells.push("");
    const row = {
      team,
      section,
      entity_type: "roster_charge",
      player_or_entity: "Incomplete Roster Charge",
      pos: "",
      age: "",
      source_url: sourceUrl,
      scraped_at: scrapedAt,
      guarantee_capture_status: "not_applicable",
    };
    seasonCols.forEach((season, idx) => {
      row[season] = normalizeCell(rawCells[idx]);
    });
    row.raw_row_text = block.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    rows.push(row);
  }

  return rows;
}

function toLong(rows) {
  const out = [];
  for (const row of rows) {
    for (const season of seasonCols) {
      const cell = row[season] || "";
      out.push({
        team: row.team,
        section: row.section,
        entity_type: row.entity_type,
        player_or_entity: row.player_or_entity,
        pos: row.pos,
        age: row.age,
        season,
        cell_text: cell,
        amount_text: parseAmount(cell),
        pct_of_cap: parsePct(cell),
        status_flags: parseFlags(cell),
        guarantee_text: "",
        guarantee_capture_status: row.guarantee_capture_status,
        source_url: row.source_url,
        scraped_at: row.scraped_at,
        has_value: cell ? "TRUE" : "FALSE",
      });
    }
  }
  return out;
}

function findCapHoldTableIndex(snapshot, tableCount) {
  const activeIdx = snapshot.indexOf('heading "Active Roster"');
  const deadIdx = snapshot.indexOf('heading "Dead Money"');
  const holdIdx = snapshot.indexOf('heading "Cap Hold"');
  if (holdIdx < 0) return 4;
  const deadBeforeHold = deadIdx > activeIdx && deadIdx < holdIdx;
  const candidate = deadBeforeHold ? 7 : 4;
  return candidate < tableCount ? candidate : 4;
}

export async function resetOutput() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = outputDir(path);
  await fs.mkdir(dir, { recursive: true });
  await appendCsv(fs, path, "spotrac_active_roster_cap_hold_allteams_long.csv", [], longCols, true);
  await appendCsv(fs, path, "spotrac_active_roster_cap_hold_allteams_wide.csv", [], wideCols, true);
  await appendCsv(fs, path, "scrape_audit.csv", [], auditCols, true);
  await appendCsv(fs, path, "raw_section_text.csv", [], rawCols, true);
  await fs.writeFile(path.join(dir, "chunk_results.jsonl"), "", "utf8");
  return dir;
}

export async function scrapeChunk(start, end) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { setupAtlasRuntime } = await import(pluginRoot);
  await setupAtlasRuntime({ globals: globalThis });
  const browser = await agent.browsers.get("extension");
  await browser.nameSession("Spotrac all-team no-guarantees scrape");
  const userTabs = await browser.user.openTabs();
  const tabInfo = userTabs.find((t) => (t.url || "").includes("spotrac.com") && ((t.title || "").includes("Multi-Year") || (t.url || "").includes("/yearly/")));
  const tab = tabInfo ? await browser.user.claimTab(tabInfo) : await browser.tabs.new();
  const selected = teams.slice(start, end);
  const wideRows = [];
  const longRows = [];
  const auditRows = [];
  const rawRows = [];
  const started = Date.now();

  for (const teamRec of selected) {
    const teamStarted = Date.now();
    const url = `https://www.spotrac.com/nba/${teamRec.slug}/yearly/_/sort/cap_total/view/roster`;
    try {
      await tab.goto(url);
      await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 25000 });
      await tab.playwright.getByText("Active Roster", { exact: true }).waitFor({ state: "visible", timeoutMs: 25000 });
      const tables = tab.playwright.locator("table");
      const tableCount = await tables.count();
      const snapshot = await tab.playwright.domSnapshot();
      const capHoldTableIndex = findCapHoldTableIndex(snapshot, tableCount);
      const activeText = await tables.nth(1).innerText({ timeoutMs: 15000 });
      const holdText = await tables.nth(capHoldTableIndex).innerText({ timeoutMs: 15000 });
      const scrapedAt = new Date().toISOString();
      const sourceUrl = await tab.url();
      const activeRows = parseSection(activeText, "Active Roster", teamRec.team, sourceUrl, scrapedAt);
      const holdRows = parseSection(holdText, "Cap Hold", teamRec.team, sourceUrl, scrapedAt);
      wideRows.push(...activeRows, ...holdRows);
      longRows.push(...toLong(activeRows), ...toLong(holdRows));
      rawRows.push({ team: teamRec.team, section: "Active Roster", source_url: sourceUrl, raw_text: activeText });
      rawRows.push({ team: teamRec.team, section: "Cap Hold", source_url: sourceUrl, raw_text: holdText });
      auditRows.push({
        team: teamRec.team,
        source_url: sourceUrl,
        status: "ok",
        table_count: tableCount,
        cap_hold_table_index: capHoldTableIndex,
        active_roster_rows: activeRows.filter((r) => r.entity_type === "player").length,
        cap_hold_player_rows: holdRows.filter((r) => r.entity_type === "player").length,
        cap_hold_roster_charge_rows: holdRows.filter((r) => r.entity_type === "roster_charge").length,
        elapsed_seconds: ((Date.now() - teamStarted) / 1000).toFixed(2),
        scraped_at: scrapedAt,
        method: "Chrome Spotrac table-level DOM innerText; Active Roster and Cap Hold; no guarantee hover pass",
        error_message: "",
      });
    } catch (error) {
      auditRows.push({
        team: teamRec.team,
        source_url: url,
        status: "error",
        table_count: "",
        active_roster_rows: 0,
        cap_hold_player_rows: 0,
        cap_hold_roster_charge_rows: 0,
        cap_hold_table_index: "",
        elapsed_seconds: ((Date.now() - teamStarted) / 1000).toFixed(2),
        scraped_at: new Date().toISOString(),
        method: "Chrome Spotrac table-level DOM innerText; Active Roster and Cap Hold; no guarantee hover pass",
        error_message: error.message,
      });
    }
  }

  await appendCsv(fs, path, "spotrac_active_roster_cap_hold_allteams_long.csv", longRows, longCols);
  await appendCsv(fs, path, "spotrac_active_roster_cap_hold_allteams_wide.csv", wideRows, wideCols);
  await appendCsv(fs, path, "scrape_audit.csv", auditRows, auditCols);
  await appendCsv(fs, path, "raw_section_text.csv", rawRows, rawCols);
  const summary = {
    start,
    end,
    total_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    teams_requested: selected.length,
    teams_ok: auditRows.filter((row) => row.status === "ok").length,
    teams_error: auditRows.filter((row) => row.status === "error").length,
    rows_wide: wideRows.length,
    rows_long: longRows.length,
    audit: auditRows,
  };
  await fs.appendFile(path.join(outputDir(path), "chunk_results.jsonl"), `${JSON.stringify(summary)}\n`, "utf8");
  await browser.tabs.finalize({ keep: [] });
  return { outDir: outputDir(path), ...summary };
}

export async function writeBenchmarkSummary() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = outputDir(path);
  const auditText = await fs.readFile(path.join(dir, "scrape_audit.csv"), "utf8");
  const lines = auditText.trim().split(/\r?\n/);
  const teamsOk = lines.slice(1).filter((line) => line.includes(",ok,")).length;
  const totalElapsed = lines.slice(1).reduce((sum, line) => {
    const parts = line.match(/(?:^|,)(?:"(?:[^"]|"")*"|[^,]*)/g)?.map((p) => p.replace(/^,/, "")) || [];
    return sum + Number(parts[8] || 0);
  }, 0);
  const longText = await fs.readFile(path.join(dir, "spotrac_active_roster_cap_hold_allteams_long.csv"), "utf8");
  const wideText = await fs.readFile(path.join(dir, "spotrac_active_roster_cap_hold_allteams_wide.csv"), "utf8");
  const summary = {
    total_team_elapsed_seconds: Number(totalElapsed.toFixed(2)),
    teams_requested: teams.length,
    teams_ok: teamsOk,
    teams_error: teams.length - teamsOk,
    rows_long: Math.max(0, longText.trim().split(/\r?\n/).length - 1),
    rows_wide: Math.max(0, wideText.trim().split(/\r?\n/).length - 1),
    guarantee_policy: "not captured; Spotrac guarantee percentages are hover-only tooltips",
  };
  await fs.writeFile(path.join(dir, "benchmark_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  return { outDir: dir, ...summary };
}
