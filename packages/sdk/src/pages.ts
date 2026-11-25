/**
 * Paging over every job through the escrow's getJobsPage view (T2.6), so readers never need
 * eth_getLogs (capped at 1,000 blocks on Aevum) just to list jobs.
 */
import type { Address, PublicClient } from "viem";
import type { Job, JobExt } from "@chainwork/types";
import { chainworkEscrowAbi } from "@chainwork/types/abis";

export interface JobsPage {
  jobs: Job[];
  exts: JobExt[];
  /** First job id of the next page, or 0n when this was the last page. */
  nextCursor: bigint;
}

/** One page starting at job `cursor` (0 or 1 = the first job). The contract caps `limit`. */
export async function getJobsPage(client: PublicClient, escrow: Address, cursor: bigint, limit: number): Promise<JobsPage> {
  const [jobs, exts, nextCursor] = (await client.readContract({
    address: escrow,
    abi: chainworkEscrowAbi,
    functionName: "getJobsPage",
    args: [cursor, BigInt(Math.max(1, Math.trunc(limit)))],
  })) as unknown as [Job[], JobExt[], bigint];
  return { jobs: [...(jobs ?? [])], exts: [...(exts ?? [])], nextCursor: nextCursor ?? 0n };
}

/** The most recent `limit` jobs, oldest first. */
export async function getRecentJobs(client: PublicClient, escrow: Address, limit: number): Promise<JobsPage> {
  const count = (await client.readContract({ address: escrow, abi: chainworkEscrowAbi, functionName: "jobCount" })) as bigint;
  if (count === 0n) return { jobs: [], exts: [], nextCursor: 0n };
  const size = BigInt(Math.max(1, Math.trunc(limit)));
  const start = count > size ? count - size + 1n : 1n;
  return getJobsPage(client, escrow, start, Number(size));
}

/** Every job, page by page. */
export async function* allJobs(client: PublicClient, escrow: Address, pageSize = 50): AsyncGenerator<{ job: Job; ext: JobExt }> {
  let cursor = 1n;
  while (cursor !== 0n) {
    const page = await getJobsPage(client, escrow, cursor, pageSize);
    for (let i = 0; i < page.jobs.length; i++) yield { job: page.jobs[i]!, ext: page.exts[i]! };
    cursor = page.nextCursor;
  }
}
