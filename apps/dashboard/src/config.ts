/**
 * SPDX-License-Identifier: MIT
 * Dashboard configuration: Vite env vars with safe Aevum defaults, plus an optional
 * /deployment.json fetched at runtime (the file the deploy script writes).
 *
 * Precedence: an explicit VITE_* value wins; otherwise a deployment.json value is used;
 * otherwise the Aevum defaults from @chainwork/types.
 */
import { getAddress, isAddress } from "viem";
import { AEVUM_TESTNET, TUSD8, type Address } from "@chainwork/types";

/** Where the SPA looks for the runtime deployment file (served from public/ or the host root). */
export const DEPLOYMENT_PATH = "deployment.json";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface DashboardConfig {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  token: Address;
  /** True when VITE_TOKEN was set explicitly (so deployment.json may not override it). */
  tokenFromEnv: boolean;
  escrow: Address | null;
  reputation: Address | null;
  budgetGuard: Address | null;
  clientAccount: Address | null;
  facilitatorUrl: string | null;
  indexerUrl: string | null;
  /** First block to scan for receipts; null means "set VITE_FROM_BLOCK or deployment.json". */
  fromBlock: bigint | null;
}

export type ConfigField = "escrow" | "reputation" | "budgetGuard" | "clientAccount";

export const FIELD_LABELS: Record<ConfigField, string> = {
  escrow: "Escrow contract address (VITE_ESCROW)",
  reputation: "Reputation registry address (VITE_REPUTATION)",
  budgetGuard: "Budget guard hook address (VITE_BUDGET_GUARD)",
  clientAccount: "Client AgentAccount address (VITE_CLIENT_ACCOUNT)",
};

/** Shape of deployments/<network>.json (see packages/sdk DeploymentJson). */
export interface DeploymentFile {
  chainId?: number;
  token?: Address;
  escrow?: Address;
  reputation?: Address;
  budgetGuard?: Address;
  hashVerifier?: Address;
  signedDataVerifier?: Address;
  clientAccount?: Address;
  deployedAtBlock?: number;
}

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function parseAddress(value: string | undefined): Address | null {
  const trimmed = text(value);
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

function parsePositiveInt(value: string | undefined): number | null {
  const trimmed = text(value);
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const stripSlash = (url: string): string => url.replace(/\/+$/, "");

export function readConfig(env: EnvSource): DashboardConfig {
  const token = parseAddress(env["VITE_TOKEN"]);
  const chainId = parsePositiveInt(env["VITE_CHAIN_ID"]) ?? AEVUM_TESTNET.id;
  const url = (value: string | undefined, fallback: string): string => stripSlash(text(value) ?? fallback);
  return {
    chainId,
    rpcUrl: text(env["VITE_RPC_URL"]) ?? AEVUM_TESTNET.rpcUrl,
    explorerUrl: url(env["VITE_EXPLORER_URL"], AEVUM_TESTNET.explorerUrl),
    token: token ?? TUSD8.address,
    tokenFromEnv: token !== null,
    escrow: parseAddress(env["VITE_ESCROW"]),
    reputation: parseAddress(env["VITE_REPUTATION"]),
    budgetGuard: parseAddress(env["VITE_BUDGET_GUARD"]),
    clientAccount: parseAddress(env["VITE_CLIENT_ACCOUNT"]),
    facilitatorUrl: text(env["VITE_FACILITATOR_URL"]),
    indexerUrl: text(env["VITE_INDEXER_URL"]),
    fromBlock: parsePositiveInt(env["VITE_FROM_BLOCK"]) !== null ? BigInt(parsePositiveInt(env["VITE_FROM_BLOCK"]) as number) : null,
  };
}

/** Defensive parse of whatever /deployment.json contains. Unknown shapes yield null. */
export function parseDeploymentFile(raw: unknown): DeploymentFile | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const file: DeploymentFile = {};
  const address = (key: string): Address | null => {
    const value = source[key];
    return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
  };
  const escrow = address("escrow");
  if (escrow) file.escrow = escrow;
  const token = address("token");
  if (token) file.token = token;
  const reputation = address("reputation");
  if (reputation) file.reputation = reputation;
  const budgetGuard = address("budgetGuard");
  if (budgetGuard) file.budgetGuard = budgetGuard;
  const clientAccount = address("clientAccount");
  if (clientAccount) file.clientAccount = clientAccount;
  const hashVerifier = address("hashVerifier");
  if (hashVerifier) file.hashVerifier = hashVerifier;
  const signedDataVerifier = address("signedDataVerifier");
  if (signedDataVerifier) file.signedDataVerifier = signedDataVerifier;
  const chainId = source["chainId"];
  if (typeof chainId === "number" && Number.isSafeInteger(chainId)) file.chainId = chainId;
  const deployedAtBlock = source["deployedAtBlock"];
  if (typeof deployedAtBlock === "number" && Number.isSafeInteger(deployedAtBlock) && deployedAtBlock >= 0) {
    file.deployedAtBlock = deployedAtBlock;
  }
  if (Object.keys(file).length === 0) return null;
  return file;
}

export interface MergeResult {
  config: DashboardConfig;
  warnings: string[];
}

/** Fill the gaps the env left with values from deployment.json. Env always wins. */
export function mergeDeployment(base: DashboardConfig, file: DeploymentFile | null): MergeResult {
  if (!file) return { config: base, warnings: [] };
  const warnings: string[] = [];
  if (file.chainId !== undefined && file.chainId !== base.chainId) {
    warnings.push(
      "deployment.json is for chain " + file.chainId.toString() + " but the dashboard is configured for chain " + base.chainId.toString() + ". Its addresses were ignored.",
    );
    return { config: base, warnings };
  }
  const config: DashboardConfig = {
    ...base,
    token: !base.tokenFromEnv && file.token ? file.token : base.token,
    escrow: base.escrow ?? file.escrow ?? null,
    reputation: base.reputation ?? file.reputation ?? null,
    budgetGuard: base.budgetGuard ?? file.budgetGuard ?? null,
    clientAccount: base.clientAccount ?? file.clientAccount ?? null,
    fromBlock:
      base.fromBlock ?? (file.deployedAtBlock !== undefined && file.deployedAtBlock > 0 ? BigInt(file.deployedAtBlock) : null),
  };
  return { config, warnings };
}

export function missingFields(config: DashboardConfig): ConfigField[] {
  const missing: ConfigField[] = [];
  if (!config.escrow) missing.push("escrow");
  if (!config.reputation) missing.push("reputation");
  if (!config.budgetGuard) missing.push("budgetGuard");
  if (!config.clientAccount) missing.push("clientAccount");
  return missing;
}

export function configProblems(config: DashboardConfig): string[] {
  const problems: string[] = [];
  if (config.chainId === AEVUM_TESTNET.id && config.tokenFromEnv && config.token !== TUSD8.address) {
    problems.push(
      "VITE_TOKEN is not the Aevum tUSD8 address, so token balances would point at another contract. Balances are read from the configured address; clear VITE_TOKEN to use tUSD8.",
    );
  }
  if (config.fromBlock === null) {
    problems.push("No deployment block known: set VITE_FROM_BLOCK or ship deployment.json with deployedAtBlock so receipts can scan logs in 500-block chunks.");
  }
  return problems;
}

/** True when the tree, receipts and reputation panels have everything they need. */
export function isDeploymentReady(config: DashboardConfig): boolean {
  return config.escrow !== null && config.reputation !== null;
}

/** Fetch and parse /deployment.json. Returns null when the host has no such file. */
export async function fetchDeployment(url: string = DEPLOYMENT_PATH): Promise<DeploymentFile | null> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return parseDeploymentFile(raw);
  } catch {
    return null;
  }
}
