/** Role accounts and per-role Chainwork clients. Local anvil keys; on Aevum, <ROLE>_PK. */
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Chainwork, type ChainworkConfig } from "@chainwork/sdk";
import { loadServiceConfig, type ServiceConfig } from "@chainwork/service-kit";
import { anvilAccount } from "@chainwork/service-kit/testing";

export const ROLE_INDEX: Record<string, number> = {
  deployer: 0,
  client: 1,
  coordinator: 2,
  "specialist-data": 3,
  "specialist-bad": 4,
  backup: 5,
  watcher: 6,
  evaluator: 7,
};

export function accountFor(
  role: string,
  network = process.env.NETWORK ?? "local",
): ReturnType<typeof privateKeyToAccount> | ReturnType<typeof anvilAccount> {
  const envName = `${role.toUpperCase().replace(/-/g, "_")}_PK`;
  const pk = process.env[envName];
  if (pk) return privateKeyToAccount(pk as `0x${string}`);
  if (network === "local") {
    const index = ROLE_INDEX[role];
    if (index === undefined) throw new Error(`No local index for role "${role}".`);
    return anvilAccount(index);
  }
  throw new Error(`Set ${envName} for network ${network}.`);
}

/** Load a service config as a specific role (used by the in-process demo stack). */
export function configFor(role: string): ServiceConfig {
  const previous = process.env.AGENT_ROLE;
  process.env.AGENT_ROLE = role;
  try {
    return loadServiceConfig();
  } finally {
    if (previous === undefined) delete process.env.AGENT_ROLE;
    else process.env.AGENT_ROLE = previous;
  }
}

export function walletFor(role: string, base: ServiceConfig): WalletClient {
  return createWalletClient({
    account: accountFor(role, base.network),
    chain: base.chain,
    transport: http(base.rpcUrl),
  });
}

export function clientFor(role: string, base: ServiceConfig): Chainwork {
  return new Chainwork(base.cfg, base.publicClient, walletFor(role, base));
}

export const getConfig = (cfg: ChainworkConfig): ChainworkConfig => cfg;
