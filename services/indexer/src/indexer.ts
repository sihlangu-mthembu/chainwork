/**
 * Event indexer. Aevum rejects eth_getLogs ranges over 1,000 blocks, so every request is at most
 * 500 blocks. The cursor is stored in SQLite and survives restarts; a small overlap re-scan makes
 * the index safe against a one-block reorg, and (tx_hash, log_index) is unique so nothing duplicates.
 */
import { decodeEventLog, type PublicClient } from "viem";
import { chainworkEscrowImplAbi, reputationRegistryImplAbi } from "@chainwork/types/abis";
import { jsonSafe } from "@chainwork/service-kit";
import type { Logger, ServiceConfig } from "@chainwork/service-kit";
import type { IndexerStore, NewEvent } from "./store.js";

export const MAX_CHUNK = 500;

export interface IndexDeps {
  config: ServiceConfig;
  store: IndexerStore;
  logger?: Logger;
  pc?: PublicClient;
  chunk?: number;
  reorgOverlap?: number;
}

export interface IndexPass {
  from: bigint;
  to: bigint;
  inserted: number;
  latest: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export async function indexOnce(deps: IndexDeps): Promise<IndexPass> {
  const pc = deps.pc ?? deps.config.publicClient;
  const chunk = deps.chunk ?? 500;
  if (chunk < 1 || chunk > 1000) throw new Error("Log chunks must be between 1 and 1,000 blocks.");
  const escrow = deps.config.cfg.escrow.toLowerCase();
  const reputation = deps.config.cfg.reputation.toLowerCase();
  const deploymentBlock = BigInt(deps.config.deployment.deployedAtBlock ?? 0);

  const latest = await pc.getBlockNumber({ cacheTime: 0 });
  const cursor = deps.store.cursor();
  let start = cursor === 0n ? deploymentBlock : cursor + 1n;
  if (cursor > 0n) {
    const overlap = BigInt(deps.reorgOverlap ?? 12);
    const replay = cursor > overlap ? cursor - overlap + 1n : deploymentBlock;
    if (replay < start) start = replay;
  }
  if (start < deploymentBlock) start = deploymentBlock;
  if (start > latest) return { from: start, to: start, inserted: 0, latest };

  let inserted = 0;
  let from = start;
  while (from <= latest) {
    const to = min(from + BigInt(chunk) - 1n, latest);
    const logs = await pc.getLogs({
      address: [deps.config.cfg.escrow, deps.config.cfg.reputation],
      fromBlock: from,
      toBlock: to,
    });
    const rows: NewEvent[] = [];
    for (const log of logs) {
      const address = log.address.toLowerCase();
      const abi = address === escrow ? chainworkEscrowImplAbi : address === reputation ? reputationRegistryImplAbi : undefined;
      if (!abi) continue;
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        const args = jsonSafe(decoded.args) as Record<string, unknown>;
        const jobId = args.jobId !== undefined ? String(args.jobId) : null;
        rows.push({
          block: Number(log.blockNumber ?? from),
          txHash: log.transactionHash ?? "",
          logIndex: Number(log.logIndex ?? 0),
          address,
          event: decoded.eventName,
          jobId,
          args: JSON.stringify(args),
        });
      } catch {
        /* not an event in this ABI; keep the cursor moving */
      }
    }
    inserted += deps.store.insert(rows);
    deps.store.setCursor(to);
    if (rows.length > 0) deps.logger?.info("indexer.batch", { from: from.toString(), to: to.toString(), events: rows.length });
    from = to + 1n;
  }
  return { from: start, to: latest, inserted, latest };
}
