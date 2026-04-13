import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(scriptDir, "..", "..");
const port = Number(process.env.FRONTEND_REFRESH_PORT ?? 8787);
const rscript = process.env.RSCRIPT_PATH ?? "C:\\Program Files\\R\\R-4.3.2\\bin\\Rscript.exe";
const refreshScript = resolve(baseDir, "script", "frontend", "refresh_frontend_app.R");

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

createServer((request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 200, { ok: true });
    return;
  }

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

  sendJson(response, 404, { ok: false, error: "Not found" });
}).listen(port, "127.0.0.1", () => {
  console.log(`NBA refresh server listening at http://127.0.0.1:${port}`);
  console.log(`Refresh script: ${refreshScript}`);
});
