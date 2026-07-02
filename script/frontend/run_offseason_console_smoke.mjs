import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const distRoot = path.join(root, "frontend", "dist");
const qaRoot = path.join(root, "processed", "qa");
const chromePath = findChrome();
const requestLog = [];
const networkLog = [];
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

await fs.mkdir(qaRoot, { recursive: true });

const staticServer = await startStaticServer();
const chromePort = await freePort();
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "offseason-console-chrome-"));
let cdp;
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-crash-reporter",
  "--disable-crashpad",
  "--disable-dev-shm-usage",
  "--blink-settings=imagesEnabled=false",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${userDataDir}`,
  "--window-size=1280,720",
  "about:blank"
], { stdio: "ignore" });

try {
  const wsUrl = await waitForWebSocketUrl(chromePort);
  cdp = await connectCdp(wsUrl);
  cdp.on("Network.requestWillBeSent", (params) => rememberNetwork({ event: "request", url: params.request?.url }));
  cdp.on("Network.responseReceived", (params) => rememberNetwork({ event: "response", url: params.response?.url, status: params.response?.status }));
  cdp.on("Network.loadingFailed", (params) => rememberNetwork({ event: "failed", requestId: params.requestId, errorText: params.errorText, blockedReason: params.blockedReason }));
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await installDebugHooks(cdp);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${staticServer.port}/` });
  await waitForLoad(cdp);
  await waitForCondition(cdp, "document.body.innerText.includes('Offseason Sim')", 20_000);
  await preflightDataFetch(cdp);
  await clickByText(cdp, "button", "Offseason Sim");
  await waitForCondition(cdp, "document.body.innerText.includes('Offseason Tape') && document.querySelectorAll('.tape-event-row').length > 0", 60_000);
  const desktop = await inspect(cdp, "desktop");
  assertCore(desktop, "desktop");
  assertRefinements(desktop, "desktop");
  const desktopPath = path.join(qaRoot, "offseason_console_desktop.png");
  await screenshot(cdp, desktopPath);

  await clickLens(cdp, "Teams");
  await waitForCondition(cdp, "Boolean(document.querySelector('.team-story-rail'))", 10_000);
  const teams = await inspect(cdp, "teams");
  if (!teams.hasTeamRail) throw new Error(`Teams lens did not render the team rail: ${JSON.stringify(teams)}`);
  if (teams.teamProjectionRows < 20) throw new Error(`Teams lens did not render a full projection rail: ${JSON.stringify(teams)}`);
  if (teams.teamMetricCells < 60) throw new Error(`Teams projection rail is missing ranked Net/Off/Def metrics: ${JSON.stringify(teams)}`);
  await clickLens(cdp, "Markets");
  await waitForCondition(cdp, "Boolean(document.querySelector('.market-board .story-batch-toggle'))", 10_000);
  const markets = await inspect(cdp, "markets");
  if (!markets.hasMarketBoard) throw new Error(`Markets lens did not render the market board: ${JSON.stringify(markets)}`);
  if (!markets.hasUnsignedBoard) throw new Error(`Markets lens did not render the still-available free-agent board: ${JSON.stringify(markets)}`);
  if (markets.sortHeaders < 6) throw new Error(`Markets lens is missing sortable table headers: ${JSON.stringify(markets)}`);
  if (markets.batchFilterControls < 1) throw new Error(`Markets lens is missing the batch-signal filter: ${JSON.stringify(markets)}`);
  await clickLens(cdp, "Lab");
  await waitForCondition(cdp, "document.body.innerText.includes('Simulation Lab')", 10_000);
  const lab = await inspect(cdp, "lab");
  if (!lab.hasLab) throw new Error(`Lab lens did not render simulation settings: ${JSON.stringify(lab)}`);

  await clickLens(cdp, "Story");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForLoad(cdp);
  await waitForCondition(cdp, "document.body.innerText.includes('Offseason Sim')", 20_000);
  await clickByText(cdp, "button", "Offseason Sim");
  await waitForCondition(cdp, "document.body.innerText.includes('Offseason Tape') && document.querySelectorAll('.tape-event-row').length > 0", 60_000);
  const mobile = await inspect(cdp, "mobile");
  assertCore(mobile, "mobile");
  assertRefinements(mobile, "mobile");
  if (mobile.bodyOverflow > 24) throw new Error(`mobile horizontal overflow too large: ${mobile.bodyOverflow}`);
  const mobilePath = path.join(qaRoot, "offseason_console_mobile.png");
  await screenshot(cdp, mobilePath);

  await cdp.close();
  console.log(`ok - desktop Story lens rendered ${desktop.rows} tape rows`);
  console.log("ok - Teams, Markets, and Lab lenses render");
  console.log(`ok - mobile Story lens rendered without major body overflow (${mobile.bodyOverflow}px)`);
  console.log(`screenshot - ${desktopPath}`);
  console.log(`screenshot - ${mobilePath}`);
} finally {
  await closeChrome(cdp, chrome);
  await closeServer(staticServer.server);
  await removeTempDir(userDataDir);
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No Chrome or Edge executable found for headless smoke QA.");
  return found;
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    let status = 200;
    let servedPath = "";
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^\/+/, "");
      const candidate = path.resolve(distRoot, rel);
      servedPath = rel;
      const rootPath = path.resolve(distRoot);
      if (!candidate.startsWith(rootPath)) {
        status = 403;
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const data = await fs.readFile(candidate);
      res.writeHead(200, {
        "content-type": mime.get(path.extname(candidate)) || "application/octet-stream",
        "content-length": data.byteLength,
        "cache-control": "no-store",
        "connection": "close"
      });
      res.end(data);
    } catch (error) {
      status = 404;
      res.writeHead(404);
      res.end("Not found");
      servedPath = servedPath || req.url || "";
      rememberRequest({ path: servedPath, status, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    rememberRequest({ path: servedPath || req.url || "", status });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Could not bind static server."));
      else resolve({ server, port: address.port });
    });
  });
}

function rememberRequest(entry) {
  requestLog.push(entry);
  if (requestLog.length > 40) requestLog.shift();
}

function rememberNetwork(entry) {
  networkLog.push(entry);
  if (networkLog.length > 60) networkLog.shift();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("Could not allocate free port."));
        else resolve(address.port);
      });
    });
  });
}

async function waitForWebSocketUrl(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const json = await requestJson(`http://127.0.0.1:${port}/json`);
      const page = json.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for Chrome remote debugging endpoint.");
}

async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const api = {
      send(method, params = {}) {
        const messageId = ++id;
        ws.send(JSON.stringify({ id: messageId, method, params }));
        return new Promise((messageResolve, messageReject) => {
          pending.set(messageId, { resolve: messageResolve, reject: messageReject, method });
          setTimeout(() => {
            if (pending.has(messageId)) {
              pending.delete(messageId);
              messageReject(new Error(`CDP timeout: ${method}`));
            }
          }, 60_000);
        });
      },
      close() {
        ws.close();
      },
      on(method, handler) {
        const handlers = listeners.get(method) ?? [];
        handlers.push(handler);
        listeners.set(method, handlers);
      }
    };
    const listeners = new Map();
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools WebSocket.")));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id && message.method && listeners.has(message.method)) {
        listeners.get(message.method).forEach((handler) => handler(message.params ?? {}));
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(`${item.method}: ${message.error.message}`));
      else item.resolve(message.result);
    });
  });
}

async function installDebugHooks(cdp) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        window.__offseasonSmoke = { fetches: [], errors: [] };
        const remember = (list, value) => {
          list.push(value);
          if (list.length > 30) list.shift();
        };
        const originalFetch = window.fetch.bind(window);
        window.fetch = (...args) => {
          const target = args[0];
          const url = typeof target === 'string' ? target : target && target.url ? target.url : String(target);
          remember(window.__offseasonSmoke.fetches, { url, state: 'start' });
          return originalFetch(...args).then(
            (response) => {
              remember(window.__offseasonSmoke.fetches, { url, state: 'done', status: response.status, ok: response.ok });
              return response;
            },
            (error) => {
              remember(window.__offseasonSmoke.fetches, { url, state: 'error', message: error && error.message ? error.message : String(error) });
              throw error;
            }
          );
        };
        window.addEventListener('error', (event) => {
          remember(window.__offseasonSmoke.errors, { kind: 'error', message: event.message, source: event.filename, line: event.lineno });
        });
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason;
          remember(window.__offseasonSmoke.errors, { kind: 'rejection', message: reason && reason.message ? reason.message : String(reason) });
        });
      })();
    `
  });
}

async function closeChrome(cdp, chrome) {
  if (cdp) {
    try {
      await cdp.send("Browser.close");
    } catch {
      // Browser.close commonly races with the DevTools socket closing.
    }
    try {
      cdp.close();
    } catch {
      // Best effort cleanup.
    }
  }
  if (chrome.exitCode === null) {
    try {
      chrome.kill();
    } catch {
      // Best effort cleanup.
    }
  }
  await waitForExit(chrome, 5_000);
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function removeTempDir(dir) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
      await delay(500);
    }
  }
  console.warn(`warning - could not remove temporary Chrome profile: ${dir}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForLoad(cdp) {
  await cdp.send("Runtime.evaluate", {
    expression: "new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else window.addEventListener('load', () => resolve(true), { once: true }); })",
    awaitPromise: true
  });
}

async function waitForCondition(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression: `Boolean(${expression})`, returnByValue: true });
    if (result.result.value) return;
    await delay(300);
  }
  const debug = await pageDebug(cdp);
  throw new Error(`Timed out waiting for condition: ${expression}\n${debug}`);
}

async function preflightDataFetch(cdp) {
  await cdp.send("Runtime.evaluate", {
    expression: `fetch('/data/manifest.json').catch(() => null)`,
    awaitPromise: true
  });
  const probes = [
    "/data/v2/team_projections/2027.json",
    "/data/pick_assets.json",
    "/data/draft_prospects.json",
    "/data/offseason_truth.json",
    "/data/cap_tracker.json",
    "/data/cap_transaction_review.json"
  ];
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {
      const urls = ${JSON.stringify(probes)};
      const results = [];
      for (const url of urls) {
        try {
          const response = await fetch(url);
          results.push({ url, ok: response.ok, status: response.status, length: (await response.text()).length });
        } catch (error) {
          results.push({ url, ok: false, error: error && error.message ? error.message : String(error) });
        }
      }
      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const value = result.result.value;
  if (!Array.isArray(value) || value.some((item) => !item.ok)) {
    throw new Error(`Browser data preflight failed: ${JSON.stringify(value)}\n${await pageDebug(cdp)}`);
  }
}

async function clickByText(cdp, selector, text) {
  const expression = `(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((node) => (node.textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  if (!result.result.value) throw new Error(`Could not click ${selector} containing ${text}`);
}

async function pageDebug(cdp) {
  try {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        readyState: document.readyState,
        title: document.title,
        rows: document.querySelectorAll('.tape-event-row').length,
        loading: document.body.innerText.includes('Preparing Offseason Sandbox'),
        error: document.body.innerText.includes('did not load'),
        smoke: window.__offseasonSmoke || null,
        text: document.body.innerText.slice(0, 800)
      })`,
      returnByValue: true
    });
    return `${result.result.value ?? "debug unavailable"}\nrecentRequests: ${JSON.stringify(requestLog.slice(-20))}\nnetwork: ${JSON.stringify(networkLog.slice(-30))}`;
  } catch (error) {
    return `debug unavailable: ${error instanceof Error ? error.message : String(error)}\nrecentRequests: ${JSON.stringify(requestLog.slice(-20))}\nnetwork: ${JSON.stringify(networkLog.slice(-30))}`;
  }
}

async function clickLens(cdp, label) {
  await clickByText(cdp, ".offseason-lensbar button", label);
  await delay(500);
}

async function inspect(cdp, label) {
  const expression = `(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const story = rect('.story-primary');
    const inspector = rect('.event-inspector');
    return {
      label: ${JSON.stringify(label)},
      text: document.body.innerText.slice(0, 400),
      hasTape: document.body.innerText.includes('Offseason Tape'),
      hasLab: document.body.innerText.includes('Simulation Lab'),
      hasTeamRail: Boolean(document.querySelector('.team-story-rail')),
      hasMarketBoard: Boolean(document.querySelector('.market-board')),
      hasUnsignedBoard: Boolean(document.querySelector('.unsigned-console-board')),
      lensCount: document.querySelectorAll('.offseason-lensbar button').length,
      rows: document.querySelectorAll('.tape-event-row').length,
      inspector: Boolean(document.querySelector('.event-inspector')),
      oldTabs: document.querySelectorAll('.offseason-tabs button').length,
      sortHeaders: document.querySelectorAll('.console-sort-header').length,
      batchSortHeaders: Array.from(document.querySelectorAll('.console-sort-header')).filter((node) => (node.textContent || '').includes('Batch')).length,
      batchFilterControls: Array.from(document.querySelectorAll('.story-batch-toggle')).filter((node) => (node.textContent || '').includes('Batch signals')).length,
      batchToggleTexts: Array.from(document.querySelectorAll('.story-batch-toggle')).map((node) => (node.textContent || '').trim()),
      marketToolbarText: document.querySelector('.market-board .story-toolbar')?.textContent?.trim() ?? "",
      playerAvatars: document.querySelectorAll('.sim-player-avatar').length,
      teamLogos: document.querySelectorAll('.sim-team-logo').length,
      teamProjectionRows: document.querySelectorAll('.team-projection-row').length,
      teamMetricCells: document.querySelectorAll('.team-projection-metrics b').length,
      bodyOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      desktopOverlap: story && inspector && window.innerWidth >= 1000 ? !(story.right <= inspector.left || inspector.right <= story.left || story.bottom <= inspector.top || inspector.bottom <= story.top) : false
    };
  })()`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return result.result.value;
}

function assertCore(state, label) {
  if (!state.hasTape) throw new Error(`${label}: Offseason Tape heading missing.`);
  if (state.lensCount !== 4) throw new Error(`${label}: expected 4 lens buttons, got ${state.lensCount}.`);
  if (state.rows < 1) throw new Error(`${label}: no event rows rendered.`);
  if (!state.inspector) throw new Error(`${label}: inspector missing.`);
  if (state.oldTabs !== 0) throw new Error(`${label}: legacy offseason tabs still rendered.`);
  if (state.desktopOverlap) throw new Error(`${label}: story and inspector panes overlap.`);
}

function assertRefinements(state, label) {
  if (state.sortHeaders < 6) throw new Error(`${label}: sortable headers missing or too sparse.`);
  if (state.batchSortHeaders < 1) throw new Error(`${label}: Batch sort header missing from event tape.`);
  if (state.batchFilterControls < 1) throw new Error(`${label}: Batch-only event filter missing from event tape.`);
  if (state.playerAvatars < 3) throw new Error(`${label}: player headshot/avatar cells missing.`);
  if (state.teamLogos < 3) throw new Error(`${label}: team logo cells missing.`);
}

async function screenshot(cdp, outfile) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await fs.writeFile(outfile, Buffer.from(shot.data, "base64"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
