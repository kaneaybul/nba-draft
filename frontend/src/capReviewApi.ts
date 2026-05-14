import type { CapReviewData } from "./types";

const DEFAULT_REFRESH_SERVER = "http://127.0.0.1:8787";

const refreshServerBase = () => {
  const env = (import.meta as unknown as { env?: { VITE_REFRESH_SERVER_URL?: string } }).env;
  const configured = env?.VITE_REFRESH_SERVER_URL || DEFAULT_REFRESH_SERVER;
  return String(configured).replace(/\/+$/, "");
};

export async function getRefreshStatus() {
  return requestJson<{ ok?: boolean; running: boolean; lastRun: { status: string; output?: string; exit_code?: number | null } }>("/status", { method: "GET" });
}

export async function refreshSalaryResolution() {
  return requestJson<{ ok: boolean; review: CapReviewData; stdout?: string; stderr?: string; status?: number }>("/cap-review/refresh-salary-resolution", { method: "POST" });
}

export async function updateCapReviewStatus(payload: {
  transaction_key: string;
  status: string;
  approved_amount?: string;
  source_quality?: string | null;
}) {
  return requestJson<CapReviewData & { ok: boolean }>("/cap-review/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function applyApprovedCapReviewRows() {
  return requestJson<{ ok: boolean; review: CapReviewData; applied_dead_money_rows?: number; cap_tracker_rebuild?: { status?: number; stdout?: string; stderr?: string } }>(
    "/cap-review/apply",
    { method: "POST" }
  );
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${refreshServerBase()}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Refresh server returned ${response.status}`);
  }
  return payload as T;
}
