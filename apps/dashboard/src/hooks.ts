/**
 * SPDX-License-Identifier: MIT
 * Chain data hooks. Every read goes through viem/wagmi eth_call or the SDK's read views;
 * nothing here uses eth_getLogs (the tree must work past Aevum's 1,000-block log cap).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { Chainwork, configFromDeployment, readTree } from "@chainwork/sdk";
import type { Address, Job, JobExt, JobNode } from "@chainwork/types";
import { agentAccountAbi, budgetGuardHookAbi, fiatTokenV2_2Abi, reputationRegistryAbi } from "@chainwork/types/abis";
import { useConfig } from "./ConfigContext";
import { toPlainError } from "./lib/errors";
import { readRecentJobs, type JobsPage } from "./lib/escrowReads";
import {
  parseLimits,
  parseSession,
  parseStats,
  type AgentSession,
  type AgentStats,
  type GuardLimits,
} from "./lib/contracts";

export interface ChainworkHandle {
  cw: Chainwork;
  escrow: Address;
}

/** The SDK client for the configured deployment, or null while the escrow address is unknown. */
export function useChainwork(): ChainworkHandle | null {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  return useMemo(() => {
    if (!client || !config.escrow) return null;
    const sdkConfig = configFromDeployment(
      {
        chainId: config.chainId,
        escrow: config.escrow,
        token: config.token,
        reputation: config.reputation ?? zeroAddress,
        budgetGuard: config.budgetGuard ?? zeroAddress,
        deployedAtBlock: config.fromBlock === null ? 0 : Number(config.fromBlock),
      },
      config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {},
    );
    return { cw: new Chainwork(sdkConfig, client), escrow: config.escrow };
  }, [client, config]);
}

export interface TreeState {
  tree: JobNode | null;
  error: string | null;
  fetching: boolean;
  updatedAt: number | null;
}

/** Poll the tree every 1.5 s so the UI reflects a new block well inside the 2 s budget. */
export function useTree(rootId: bigint | null): TreeState {
  const handle = useChainwork();
  const query = useQuery({
    queryKey: ["tree", handle ? handle.escrow : "no-escrow", rootId === null ? "none" : rootId.toString()],
    enabled: handle !== null && rootId !== null,
    refetchInterval: 1500,
    retry: 1,
    queryFn: async (): Promise<JobNode | null> => {
      if (!handle || rootId === null) return null;
      return readTree(handle.cw, rootId);
    },
  });
  return {
    tree: query.data ?? null,
    error: query.error ? toPlainError(query.error) : null,
    fetching: query.isFetching,
    updatedAt: query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
  };
}

export interface RecentJobsState {
  jobs: readonly Job[];
  exts: readonly JobExt[];
  error: string | null;
}

/** Recent jobs from getJobsPage (eth_call only), refreshed every 5 s. */
export function useRecentJobs(limit = 12): RecentJobsState {
  const handle = useChainwork();
  const query = useQuery({
    queryKey: ["jobs", handle ? handle.escrow : "no-escrow", limit],
    enabled: handle !== null,
    refetchInterval: 5000,
    retry: 1,
    queryFn: async (): Promise<JobsPage | null> => {
      if (!handle) return null;
      const client = handle.cw.publicClient;
      return readRecentJobs(client, handle.escrow, limit);
    },
  });
  return {
    jobs: query.data ? query.data.jobs : [],
    exts: query.data ? query.data.exts : [],
    error: query.error ? toPlainError(query.error) : null,
  };
}

export interface WalletBalance {
  address: Address;
  native: bigint | null;
  token: bigint | null;
  error: string | null;
}

export interface BalancesState {
  rows: readonly WalletBalance[];
  error: string | null;
}

/** tQDAY (getBalance) and tUSD8 (balanceOf) for each address; refreshed every 5 s. */
export function useWalletBalances(addresses: readonly Address[]): BalancesState {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const key = addresses.map((a) => a.toLowerCase()).join(",");
  const query = useQuery({
    queryKey: ["balances", config.chainId, config.token, key],
    enabled: client !== undefined && addresses.length > 0,
    refetchInterval: 5000,
    retry: 1,
    queryFn: async (): Promise<WalletBalance[]> => {
      if (!client) return [];
      return Promise.all(
        addresses.map(async (address): Promise<WalletBalance> => {
          try {
            const [native, token] = await Promise.all([
              client.getBalance({ address }),
              client.readContract({
                address: config.token,
                abi: fiatTokenV2_2Abi,
                functionName: "balanceOf",
                args: [address],
              }),
            ]);
            return { address, native, token, error: null };
          } catch (err) {
            return { address, native: null, token: null, error: toPlainError(err) };
          }
        }),
      );
    },
  });
  return { rows: query.data ?? [], error: query.error ? toPlainError(query.error) : null };
}

export interface ReputationNumbers {
  score: bigint;
  bondBps: bigint;
  requiredBond: bigint;
  creditLimit: bigint;
  summaryCount: bigint;
  averageScore: number;
  stats: AgentStats;
}

export interface ReputationState {
  numbers: ReputationNumbers | null;
  error: string | null;
  fetching: boolean;
}

/** score, bondBps, requiredBond(budget), creditLimit, getSummary and stats for one agent. */
export function useReputation(agent: Address | null, budget: bigint): ReputationState {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const registry = config.reputation;
  const query = useQuery({
    queryKey: ["reputation", registry, agent, budget.toString()],
    enabled: client !== undefined && registry !== null && agent !== null,
    refetchInterval: 10000,
    retry: 1,
    queryFn: async (): Promise<ReputationNumbers | null> => {
      if (!client || !registry || !agent) return null;
      const [score, bondBps, requiredBond, creditLimit, summary, stats] = await Promise.all([
        client.readContract({ address: registry, abi: reputationRegistryAbi, functionName: "score", args: [agent] }),
        client.readContract({ address: registry, abi: reputationRegistryAbi, functionName: "bondBps", args: [agent] }),
        client.readContract({
          address: registry,
          abi: reputationRegistryAbi,
          functionName: "requiredBond",
          args: [agent, budget],
        }),
        client.readContract({
          address: registry,
          abi: reputationRegistryAbi,
          functionName: "creditLimit",
          args: [agent],
        }),
        client.readContract({
          address: registry,
          abi: reputationRegistryAbi,
          functionName: "getSummary",
          args: [agent],
        }),
        client.readContract({ address: registry, abi: reputationRegistryAbi, functionName: "stats", args: [agent] }),
      ]);
      const summaryTuple = summary as unknown as readonly [bigint, number];
      return {
        score,
        bondBps,
        requiredBond,
        creditLimit,
        summaryCount: summaryTuple[0] ?? 0n,
        averageScore: Number(summaryTuple[1] ?? 0),
        stats: parseStats(stats),
      };
    },
  });
  return {
    numbers: query.data ?? null,
    error: query.error ? toPlainError(query.error) : null,
    fetching: query.isFetching,
  };
}

export interface AgentAccountSnapshot {
  owner: Address;
  frozen: boolean;
  budgetGuard: Address;
  session: AgentSession;
}

/** owner(), frozen(), sessions(key) and budgetGuard() for the client's AgentAccount. */
export function useAgentAccount(account: Address | null, key: Address | null): {
  snapshot: AgentAccountSnapshot | null;
  error: string | null;
} {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const query = useQuery({
    queryKey: ["agent-account", account, key],
    enabled: client !== undefined && account !== null && key !== null,
    refetchInterval: 8000,
    retry: 1,
    queryFn: async (): Promise<AgentAccountSnapshot | null> => {
      if (!client || !account || !key) return null;
      const [owner, frozen, budgetGuard, session] = await Promise.all([
        client.readContract({ address: account, abi: agentAccountAbi, functionName: "owner" }),
        client.readContract({ address: account, abi: agentAccountAbi, functionName: "frozen" }),
        client.readContract({ address: account, abi: agentAccountAbi, functionName: "budgetGuard" }),
        client.readContract({ address: account, abi: agentAccountAbi, functionName: "sessions", args: [key] }),
      ]);
      return { owner, frozen, budgetGuard, session: parseSession(session) };
    },
  });
  return {
    snapshot: query.data ?? null,
    error: query.error ? toPlainError(query.error) : null,
  };
}

export interface GuardSnapshot {
  limits: GuardLimits;
  spentToday: bigint;
}

/** limits(client) and spentToday(client) for the BudgetGuardHook. */
export function useBudgetGuard(clientAddress: Address | null): {
  snapshot: GuardSnapshot | null;
  error: string | null;
} {
  const { config } = useConfig();
  const client = usePublicClient({ chainId: config.chainId });
  const guard = config.budgetGuard;
  const query = useQuery({
    queryKey: ["budget-guard", guard, clientAddress],
    enabled: client !== undefined && guard !== null && clientAddress !== null,
    refetchInterval: 8000,
    retry: 1,
    queryFn: async (): Promise<GuardSnapshot | null> => {
      if (!client || !guard || !clientAddress) return null;
      const [limits, spentToday] = await Promise.all([
        client.readContract({
          address: guard,
          abi: budgetGuardHookAbi,
          functionName: "limits",
          args: [clientAddress],
        }),
        client.readContract({
          address: guard,
          abi: budgetGuardHookAbi,
          functionName: "spentToday",
          args: [clientAddress],
        }),
      ]);
      return { limits: parseLimits(limits), spentToday };
    },
  });
  return {
    snapshot: query.data ?? null,
    error: query.error ? toPlainError(query.error) : null,
  };
}
