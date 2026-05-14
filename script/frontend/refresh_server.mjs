import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REVIEW_COLUMNS, readCsvFile, writeCsvFile } from "./cap_transaction_rules.mjs";
import { SALARY_RESOLUTION_COLUMNS } from "./cap_salary_resolution.mjs";
import {
  DEAD_MONEY_COLUMNS,
  applyApprovedDeadMoneyRows,
  capReviewPayload,
  cleanMoneyText
} from "./cap_review_state.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(scriptDir, "..", "..");
const port = Number(process.env.FRONTEND_REFRESH_PORT ?? 8787);
const rscript = process.env.RSCRIPT_PATH ?? "C:\\Program Files\\R\\R-4.3.2\\bin\\Rscript.exe";
const refreshScript = resolve(baseDir, "script", "frontend", "refresh_frontend_app.R");
const capReviewScript = resolve(baseDir, "script", "frontend", "build_cap_transaction_review.mjs");
const capTrackerScript = resolve(baseDir, "script", "frontend", "build_cap_tracker_data.mjs");
const reviewPath = resolve(baseDir, "processed", "livedata", "impactrefresh", "cap_transaction_review.csv");
const resolutionPath = resolve(baseDir, "processed", "livedata", "impactrefresh", "cap_transaction_salary_resolution.csv");
const reviewJsonPath = resolve(baseDir, "frontend", "public", "data", "cap_transaction_review.json");
const deadMoneyPath = resolve(baseDir, "ref", "cap_tracker_dead_money.csv");

let running = false;
let lastRun = {
  status: "idle",
  started_at: null,
  finished_at: null,
  exit_code: null,
  output: ""
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        rejectBody(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    request.on("error", rejectBody);
  });
}

function runRefresh() {
  running = true;
  lastRun = {
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    output: ""
  };

  const child = spawn(rscript, [refreshScript], {
    cwd: baseDir,
    env: {
      ...process.env,
      REFRESH_FULL_SWITCH_HISTORY: process.env.REFRESH_FULL_SWITCH_HISTORY ?? "false"
    },
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => {
    lastRun.output += chunk.toString();
    lastRun.output = lastRun.output.slice(-12000);
  });

  child.stderr.on("data", (chunk) => {
    lastRun.output += chunk.toString();
    lastRun.output = lastRun.output.slice(-12000);
  });

  child.on("close", (code) => {
    running = false;
    lastRun.status = code === 0 ? "success" : "failed";
    lastRun.finished_at = new Date().toISOString();
    lastRun.exit_code = code;
  });

  child.on("error", (error) => {
    running = false;
    lastRun.status = "failed";
    lastRun.finished_at = new Date().toISOString();
    lastRun.exit_code = -1;
    lastRun.output += `\n${error.message}`;
  });
}

function readCapReviewPayload() {
  const rows = readCsvFile(resolutionPath);
  return capReviewPayload(rows);
}

function writeCapReviewArtifacts(rows) {
  fs.mkdirSync(dirname(resolutionPath), { recursive: true });
  fs.mkdirSync(dirname(reviewJsonPath), { recursive: true });
  writeCsvFile(resolutionPath, rows, SALARY_RESOLUTION_COLUMNS);
  writeCsvFile(reviewPath, rows, REVIEW_COLUMNS);
  fs.writeFileSync(reviewJsonPath, `${JSON.stringify({
    ...capReviewPayload(rows),
    generated_at: new Date().toISOString(),
    source_policy: "Local cap review state. Writes are handled by the refresh server."
  }, null, 2)}\n`);
}

function updateCapReviewStatus(payload) {
  const rows = readCsvFile(resolutionPath);
  const key = String(payload.transaction_key ?? "");
  if (!key) throw new Error("transaction_key is required.");
  let found = false;
  const updated = rows.map((row) => {
    if (row.transaction_key !== key) return row;
    found = true;
    return {
      ...row,
      status: String(payload.status ?? row.status ?? "pending_review"),
      approved_amount: payload.approved_amount === undefined ? row.approved_amount : cleanMoneyText(payload.approved_amount),
      source_quality: String(payload.source_quality ?? row.source_quality ?? ""),
      resolution_note: String(payload.resolution_note ?? row.resolution_note ?? ""),
      conflict_note: String(payload.conflict_note ?? row.conflict_note ?? ""),
      salary_resolution_status: String(payload.salary_resolution_status ?? row.salary_resolution_status ?? "")
    };
  });
  if (!found) throw new Error(`No review row found for ${key}`);
  writeCapReviewArtifacts(updated);
  return readCapReviewPayload();
}

function applyCapReview() {
  const rows = readCsvFile(resolutionPath);
  const existing = readCsvFile(deadMoneyPath);
  const applied = applyApprovedDeadMoneyRows(rows, existing);

  if (applied.additions.length) {
    fs.mkdirSync(dirname(deadMoneyPath), { recursive: true });
    writeCsvFile(deadMoneyPath, applied.deadMoneyRows, DEAD_MONEY_COLUMNS);
  }

  writeCapReviewArtifacts(applied.rows);

  const rebuild = spawnSync(process.execPath, [capTrackerScript], {
    cwd: baseDir,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    applied_dead_money_rows: applied.additions.length,
    cap_tracker_rebuild: {
      status: rebuild.status,
      stdout: rebuild.stdout,
      stderr: rebuild.stderr
    },
    review: readCapReviewPayload()
  };
}

function refreshSalaryResolution() {
  const today = new Date().toISOString().slice(0, 10);
  const result = spawnSync(process.execPath, [capReviewScript, "--start", process.env.CAP_REVIEW_BACKFILL_START ?? "2025-07-01", "--end", today], {
    cwd: baseDir,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    review: readCapReviewPayload()
  };
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 200, { ok: true });
    return;
  }

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (request.url === "/status" && request.method === "GET") {
    sendJson(response, 200, { running, lastRun });
    return;
  }

  if (request.url === "/refresh" && request.method === "POST") {
    if (running) {
      sendJson(response, 409, { ok: false, running, lastRun });
      return;
    }
    runRefresh();
    sendJson(response, 202, { ok: true, running: true, lastRun });
    return;
  }

  try {
    if (url.pathname === "/cap-review" && request.method === "GET") {
      sendJson(response, 200, { ok: true, ...readCapReviewPayload() });
      return;
    }

    if (url.pathname === "/cap-review/status" && request.method === "POST") {
      sendJson(response, 200, { ok: true, ...updateCapReviewStatus(await readBody(request)) });
      return;
    }

    if (url.pathname === "/cap-review/apply" && request.method === "POST") {
      sendJson(response, 200, { ok: true, ...applyCapReview() });
      return;
    }

    if (url.pathname === "/cap-review/refresh-salary-resolution" && request.method === "POST") {
      sendJson(response, 200, { ok: true, ...refreshSalaryResolution() });
      return;
    }
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || String(error) });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}).listen(port, "127.0.0.1", () => {
  console.log(`NBA refresh server listening at http://127.0.0.1:${port}`);
  console.log(`Refresh script: ${refreshScript}`);
});
