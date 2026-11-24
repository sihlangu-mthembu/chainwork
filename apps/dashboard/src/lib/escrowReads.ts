/**
 * SPDX-License-Identifier: MIT
 * Escrow READ VIEWS that the SDK does not wrap yet (getJobsPage). No eth_getLogs here: the tree and
 * the recent-jobs list are eth_call only, exactly like the SDK's readTree.
 */
import type { PublicClient } from "viem";
import type { Address, Job, JobExt } from "@chainwork/types";
import { chainworkEscrowAbi } from "@chainwork/types/abis";

export interface JobsPage {
  jobs: readonly Job[];
  exts: readonly JobExt[];
  nextCursor: bigint;
}

type JobsPageResult = readonly [readonly Job[], readonly JobExt[], bigint];

export async function readJobsPage(
  client: PublicClient,
  escrow: Address,
  cursor: bigint,
  limit: number,
): Promise<JobsPage> {
  const result = (await client.readContract({
    address: escrow,
    abi: chainworkEscrowAbi,
    functionName: "getJobsPage",
    args: [cursor, BigInt(Math.max(1, Math.trunc(limit)))],
  })) as unknown as JobsPageResult;
  const [jobs, exts, nextCursor] = result;
  return { jobs: jobs ?? [], exts: exts ?? [], nextCursor: nextCursor ?? 0n };
}

export async function readJobCount(client: PublicClient, escrow: Address): Promise<bigint> {
  const count = (await client.readContract({
    address: escrow,
    abi: chainworkEscrowAbi,
    functionName: "jobCount",
  })) as bigint;
  return count;
}

/** The last limit jobs, oldest first, via getJobsPage (cursor 0 means "start at job 1"). */
export async function readRecentJobs(
  client: PublicClient,
  escrow: Address,
  limit = 12,
): Promise<JobsPage> {
  const count = await readJobCount(client, escrow);
  if (count === 0n) return { jobs: [], exts: [], nextCursor: 0n };
  const size = BigInt(Math.max(1, Math.trunc(limit)));
  const start = count > size ? count - size + 1n : 1n;
  return readJobsPage(client, escrow, start, Number(size));
}
