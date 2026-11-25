/**
 * SPDX-License-Identifier: MIT
 * Data for the flow view: the escrow's event history (scanned once in 500-block chunks, then
 * incrementally), block times for the entries on screen, and the list of root jobs.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { decodeEventLog } from "viem";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import type { Job, JobExt } from "@chainwork/types";
import { useConfig } from "./ConfigContext";
import { useRecentJobs } from "./hooks";
import type { RawEvent } from "./lib/events";
import { toPlainError } from "./lib/errors";

const CHUNK = 500n;
/** On a long-lived deployment, look back at most this far on first load. */
const MAX_LOOKBACK = 20_000n;

interface EventCache {
  cursor: bigint;
  events: RawEvent[];
  truncatedBefore: bigint | null;
}
const caches = new Map<string, EventCache>();

export interface EscrowEvents {
  events: readonly RawEvent[];
  error: string | null;
  scanning: boolean;
  truncatedBefore: bigint | null;
}

export function useEscrowEvents(): EscrowEvents {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const key = `${config.chainId}:${config.escrow ?? "none"}`;
  const query = useQuery({
    queryKey: ["escrow-events", key],
    enabled: client !== undefined && config.escrow !== null,
    refetchInterval: 2000,
    retry: 1,
    queryFn: async () => {
      if (!client || !config.escrow) return 0;
      const latest = await client.getBlockNumber({ cacheTime: 0 });
      let cache = caches.get(key);
      if (!cache) {
        // A hosted build ships the history up to its build time (scripts/snapshot-events.mjs).
        cache = (await loadSnapshot(config.escrow, config.chainId)) ?? undefined;
        if (cache) caches.set(key, cache);
      }
      if (!cache) {
        const from = config.fromBlock ?? 0n;
        const floor = latest > MAX_LOOKBACK ? latest - MAX_LOOKBACK : 0n;
        cache = { cursor: (from > floor ? from : floor) - 1n, events: [], truncatedBefore: from < floor ? floor : null };
        caches.set(key, cache);
      }
      for (let start = cache.cursor + 1n; start <= latest; start += CHUNK) {
        const stop = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
        const logs = await client.getLogs({ address: config.escrow, fromBlock: start, toBlock: stop });
        for (const log of logs) {
          try {
            const d = decodeEventLog({ abi: chainworkEscrowImplAbi, data: log.data, topics: log.topics });
            cache.events.push({
              eventName: d.eventName,
              args: (d.args ?? {}) as Record<string, unknown>,
              blockNumber: log.blockNumber ?? stop,
              logIndex: log.logIndex ?? 0,
              txHash: log.transactionHash ?? "",
            });
          } catch {
            // Not an escrow event we know: skip.
          }
        }
        cache.cursor = stop;
      }
      return cache.events.length;
    },
  });
  const cache = caches.get(key);
  return {
    events: cache?.events ?? [],
    error: query.error ? toPlainError(query.error) : null,
    scanning: query.isFetching && (cache?.events.length ?? 0) === 0,
    truncatedBefore: cache?.truncatedBefore ?? null,
  };
}

interface SnapshotFile {
  escrow: string;
  chainId: number;
  cursor: string;
  logs: { data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]]; blockNumber: string; logIndex: string; transactionHash: string }[];
}

async function loadSnapshot(escrow: string, chainId: number): Promise<EventCache | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}events.json`, { cache: "no-cache" });
    if (!res.ok) return null;
    const snap = (await res.json()) as SnapshotFile;
    if (snap.escrow.toLowerCase() !== escrow.toLowerCase() || snap.chainId !== chainId) return null;
    const events: RawEvent[] = [];
    for (const log of snap.logs) {
      try {
        const d = decodeEventLog({ abi: chainworkEscrowImplAbi, data: log.data, topics: log.topics });
        events.push({
          eventName: d.eventName,
          args: (d.args ?? {}) as Record<string, unknown>,
          blockNumber: BigInt(log.blockNumber),
          logIndex: Number(log.logIndex),
          txHash: log.transactionHash,
        });
      } catch {
        // not an escrow event we know
      }
    }
    return { cursor: BigInt(snap.cursor), events, truncatedBefore: null };
  } catch {
    return null;
  }
}

const blockTimes = new Map<string, number>();

/** Unix seconds for each block number (cached forever: blocks don't change time). */
export function useBlockTimes(blocks: readonly bigint[]): Map<string, number> {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const missing = useMemo(() => [...new Set(blocks.map(String))].filter((b) => !blockTimes.has(`${config.chainId}:${b}`)), [blocks, config.chainId]);
  const query = useQuery({
    queryKey: ["block-times", config.chainId, missing.join(",")],
    enabled: client !== undefined && missing.length > 0,
    queryFn: async () => {
      if (!client) return 0;
      await Promise.all(
        missing.slice(0, 60).map(async (b) => {
          const block = await client.getBlock({ blockNumber: BigInt(b) });
          blockTimes.set(`${config.chainId}:${b}`, Number(block.timestamp));
        }),
      );
      return missing.length;
    },
  });
  void query.data;
  const out = new Map<string, number>();
  for (const b of blocks) {
    const t = blockTimes.get(`${config.chainId}:${b.toString()}`);
    if (t !== undefined) out.set(b.toString(), t);
  }
  return out;
}

export interface RootJob {
  job: Job;
  ext: JobExt;
}

/** Root jobs (no parent) among the most recent jobs, newest first. */
export function useRootJobs(limit = 40): { roots: RootJob[]; error: string | null } {
  const recent = useRecentJobs(limit);
  const roots = useMemo(() => {
    const out: RootJob[] = [];
    recent.jobs.forEach((job, i) => {
      const ext = recent.exts[i];
      if (ext && ext.parentId === 0n) out.push({ job, ext });
    });
    return out.sort((a, b) => (a.job.id > b.job.id ? -1 : 1));
  }, [recent.jobs, recent.exts]);
  return { roots, error: recent.error };
}
