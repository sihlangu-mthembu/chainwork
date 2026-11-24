/**
 * SPDX-License-Identifier: MIT
 * The escrow read views do not carry transaction hashes, so the UI collects every hash it
 * legitimately sees (receipt lines, indexer events, transactions sent from this tab) in a tiny
 * in-memory store keyed by job id. The tree then links those hashes to the explorer.
 */
import type { Hex } from "@chainwork/types";

const byJob = new Map<string, Hex[]>();
const listeners = new Set<() => void>();
let version = 0;

export function recordTx(jobId: string, hash: Hex): void {
  const existing = byJob.get(jobId) ?? [];
  if (existing.includes(hash)) return;
  byJob.set(jobId, [...existing, hash]);
  version += 1;
  for (const listener of listeners) listener();
}

export function recordReceiptTxs(lines: readonly { jobId: string; txHash: Hex }[]): void {
  for (const line of lines) recordTx(line.jobId, line.txHash);
}

export function txHashesFor(jobId: string): readonly Hex[] {
  return byJob.get(jobId) ?? [];
}

export function subscribeTxs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for useSyncExternalStore: a number that changes whenever the store does. */
export function txVersion(): number {
  return version;
}
