/**
 * Watcher: for every Submitted job with a challenge window, fetch the worker's output, re-run the
 * job's deterministic check, and challenge before the window closes if it fails.
 *
 * It never releases money: the only transaction it sends is `challenge`, which posts its own bond.
 */
import { hashText } from "@chainwork/checks";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import { JobStatus, type Job, type JobExt } from "@chainwork/types";
import { checkJob } from "@chainwork/service-kit";
import type { Logger, ServiceConfig } from "@chainwork/service-kit";
import type { Chainwork } from "@chainwork/sdk";
import type { WatcherStore } from "./store.js";

export interface WatcherDeps {
  config: ServiceConfig;
  cw: Chainwork;
  store: WatcherStore;
  logger: Logger;
  workerUrls: Record<string, string>;
  /** Do not start a check with less than this many seconds left (default 8). */
  minRemainingSec?: number;
}

export interface WatchOnceResult {
  checked: number;
  challenged: number;
  skipped: number;
}

export async function listSubmitted(cw: Chainwork): Promise<Array<{ job: Job; ext: JobExt }>> {
  const out: Array<{ job: Job; ext: JobExt }> = [];
  let cursor = 1n;
  for (let page = 0; page < 200; page++) {
    const [jobs, exts, next] = (await cw.publicClient.readContract({
      address: cw.cfg.escrow,
      abi: chainworkEscrowImplAbi,
      functionName: "getJobsPage",
      args: [cursor, 100n],
    })) as unknown as [Job[], JobExt[], bigint];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const ext = exts[i];
      if (job && ext && job.status === JobStatus.Submitted) out.push({ job, ext });
    }
    if (next === 0n) break;
    cursor = next;
  }
  return out;
}

export async function watchOnce(deps: WatcherDeps): Promise<WatchOnceResult> {
  const { config, cw, store, logger, workerUrls } = deps;
  const minRemaining = deps.minRemainingSec ?? 8;
  const now = Number((await cw.publicClient.getBlock({ blockTag: "pending" })).timestamp);
  const result: WatchOnceResult = { checked: 0, challenged: 0, skipped: 0 };

  for (const { job, ext } of await listSubmitted(cw)) {
    const window = Number(ext.challengeWindow);
    if (window === 0 || ext.challenged) {
      result.skipped++;
      continue;
    }
    const remaining = Number(ext.submittedAt) + window - now;
    if (remaining <= 0) {
      result.skipped++;
      continue;
    }
    const prior = store.get(job.id.toString());
    if (prior && prior.deliverable === ext.deliverable) {
      result.skipped++;
      continue;
    }
    if (remaining < minRemaining) {
      logger.warn("watch.too-late", { jobId: job.id.toString(), remaining });
      result.skipped++;
      continue;
    }

    result.checked++;
    let check;
    try {
      check = await checkJob({ cw, cfg: config.cfg, workerUrls }, job.id);
    } catch (e) {
      logger.warn("watch.check-error", { jobId: job.id.toString(), error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    if (check.ok) {
      store.mark({
        job_id: job.id.toString(),
        deliverable: ext.deliverable,
        verdict: "ok",
        reason: check.reason,
        tx_hash: null,
      });
      logger.info("watch.ok", { jobId: job.id.toString(), reason: check.reason });
      continue;
    }

    const stillLeft = Number(ext.submittedAt) + window - Number((await cw.publicClient.getBlock({ blockTag: "pending" })).timestamp);
    if (stillLeft <= 5) {
      logger.warn("watch.missed-window", { jobId: job.id.toString(), remaining: stillLeft, reason: check.reason });
      result.skipped++;
      continue;
    }
    try {
      const tx = await cw.challenge(job.id, hashText(`chainwork:${check.reason}`));
      store.mark({
        job_id: job.id.toString(),
        deliverable: ext.deliverable,
        verdict: "challenge",
        reason: check.reason,
        tx_hash: tx.hash,
      });
      result.challenged++;
      logger.info("watch.challenged", {
        jobId: job.id.toString(),
        reason: check.reason,
        txHash: tx.hash,
        explorer: config.explorerTx(tx.hash),
      });
    } catch (e) {
      logger.error("watch.challenge-failed", {
        jobId: job.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
