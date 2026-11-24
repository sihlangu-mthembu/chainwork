/**
 * SPDX-License-Identifier: MIT
 * The indexer is optional (services/indexer, T3.2). When VITE_INDEXER_URL is set the dashboard asks
 * GET /events?jobId=<id> for history; otherwise it says so plainly instead of failing.
 */
import type { Hex } from "@chainwork/types";

export interface IndexerEventSummary {
  event: string;
  jobId: string | null;
  txHash: Hex | null;
  block: number | null;
  amount: string | null;
}

export function indexerEventsUrl(baseUrl: string, jobId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base + "/events?jobId=" + encodeURIComponent(jobId);
}

const asText = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  if (typeof value === "bigint") return value.toString();
  return null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
};

const pick = (record: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

/** Normalise one indexer event row whatever field names the service chose. */
export function summarizeEvent(record: Record<string, unknown>): IndexerEventSummary {
  const txHash = asText(pick(record, ["txHash", "transactionHash", "tx_hash"]));
  return {
    event: asText(pick(record, ["event", "eventName", "name", "type"])) ?? "event",
    jobId: asText(pick(record, ["jobId", "job_id", "job"])),
    txHash: txHash !== null && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? (txHash as Hex) : null,
    block: asNumber(pick(record, ["blockNumber", "block_number", "block"])),
    amount: asText(pick(record, ["amount", "value"])),
  };
}

/** GET /events?jobId=... Returns [] when the service answers with an unexpected shape. */
export async function fetchJobEvents(
  baseUrl: string,
  jobId: string,
): Promise<readonly IndexerEventSummary[]> {
  const response = await fetch(indexerEventsUrl(baseUrl, jobId), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Indexer answered " + response.status.toString());
  const body: unknown = await response.json();
  const container = body as { events?: unknown } | null;
  const rows: unknown[] = Array.isArray(body) ? body : container && Array.isArray(container.events) ? container.events : [];
  return rows
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
    .map(summarizeEvent);
}
