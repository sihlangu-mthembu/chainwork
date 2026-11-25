/**
 * Evaluator: when a job is challenged, re-run the same check the watcher ran and resolve it.
 * It can only complete or reject a challenged job it is the named evaluator for; it never moves
 * money on its own beyond the escrow's own settlement rules.
 */
import { hashText } from "@chainwork/checks";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import { JobStatus, type Job, type JobExt } from "@chainwork/types";
import { checkJob } from "@chainwork/service-kit";
import type { Logger, ServiceConfig } from "@chainwork/service-kit";
import type { Chainwork } from "@chainwork/sdk";
import type { EvaluatorStore } from "./store.js";

/** Jobs a pass is deciding right now (passes can overlap when the chain is slow). */
const inFlight = new Set<string>();

export interface EvaluatorDeps {
  config: ServiceConfig;
  cw: Chainwork;
  store: EvaluatorStore;
  logger: Logger;
  workerUrls: Record<string, string>;
}

export interface ResolveOnceResult {
  resolved: number;
  completed: number;
  rejected: number;
  skipped: number;
}

export async function listChallenged(cw: Chainwork): Promise<Array<{ job: Job; ext: JobExt }>> {
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
      if (job && ext && job.status === JobStatus.Submitted && ext.challenged) out.push({ job, ext });
    }
    if (next === 0n) break;
    cursor = next;
  }
  return out;
}

export async function resolveOnce(deps: EvaluatorDeps): Promise<ResolveOnceResult> {
  const { config, cw, store, logger, workerUrls } = deps;
  const me = cw.walletClient?.account?.address;
  const result: ResolveOnceResult = { resolved: 0, completed: 0, rejected: 0, skipped: 0 };

  for (const { job } of await listChallenged(cw)) {
    if (!me || job.evaluator.toLowerCase() !== me.toLowerCase()) {
      result.skipped++;
      continue;
    }
    if (store.get(job.id.toString()) || inFlight.has(job.id.toString())) {
      result.skipped++;
      continue;
    }
    // Overlapping passes on a slow RPC could both decide the same job: claim it first.
    inFlight.add(job.id.toString());

    let ok = false;
    let reason: string;
    try {
      const check = await checkJob({ cw, cfg: config.cfg, workerUrls }, job.id);
      ok = check.ok;
      reason = check.reason;
    } catch (e) {
      ok = false;
      reason = e instanceof Error ? e.message : String(e);
    }

    const decision = ok ? "complete" : "reject";
    const reasonHash = hashText(`chainwork:${decision}:${reason}`);
    try {
      const tx = ok ? await cw.complete(job.id, reasonHash) : await cw.reject(job.id, reasonHash);
      store.put({ job_id: job.id.toString(), decision, reason, tx_hash: tx.hash });
      result.resolved++;
      if (ok) result.completed++;
      else result.rejected++;
      logger.info("evaluator.decision", {
        jobId: job.id.toString(),
        decision,
        reason,
        txHash: tx.hash,
        explorer: config.explorerTx(tx.hash),
      });
    } catch (e) {
      logger.error("evaluator.failed", {
        jobId: job.id.toString(),
        decision,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      inFlight.delete(job.id.toString());
    }
  }
  return result;
}
