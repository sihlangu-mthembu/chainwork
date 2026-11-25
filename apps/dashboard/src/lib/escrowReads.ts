/**
 * SPDX-License-Identifier: MIT
 * Escrow read views, through the SDK's paging wrapper (T2.6). No eth_getLogs here: the tree and
 * the recent-jobs list are eth_call only, exactly like the SDK's readTree.
 */
import type { PublicClient } from "viem";
import type { Address } from "@chainwork/types";
import { chainworkEscrowAbi } from "@chainwork/types/abis";
import { getJobsPage, getRecentJobs, type JobsPage } from "@chainwork/sdk";

export type { JobsPage };

export const readJobsPage = (client: PublicClient, escrow: Address, cursor: bigint, limit: number): Promise<JobsPage> =>
  getJobsPage(client, escrow, cursor, limit);

export async function readJobCount(client: PublicClient, escrow: Address): Promise<bigint> {
  return (await client.readContract({ address: escrow, abi: chainworkEscrowAbi, functionName: "jobCount" })) as bigint;
}

/** The last limit jobs, oldest first. */
export const readRecentJobs = (client: PublicClient, escrow: Address, limit = 12): Promise<JobsPage> => getRecentJobs(client, escrow, limit);
