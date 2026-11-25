/**
 * Role accounts and per-role Chainwork clients. Local chain: anvil's keys. Aevum: the encrypted
 * keystores in <repo>/.keys (or KEYSTORE_DIR), unlocked with CHAINWORK_KEYSTORE_PASSWORD; raw
 * <ROLE>_PK variables are accepted for tests only.
 */
import { fileURLToPath } from "node:url";
import { createWalletClient, http, type WalletClient } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { Chainwork, type ChainworkConfig } from "@chainwork/sdk";
import { loadKeystoreAccount } from "@chainwork/sdk/node";
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

const keystoreCache = new Map<string, ReturnType<typeof privateKeyToAccount>>();

export function accountFor(
  role: string,
  network = process.env.NETWORK ?? "local",
): ReturnType<typeof privateKeyToAccount> | ReturnType<typeof anvilAccount> {
  const envName = `${role.toUpperCase().replace(/-/g, "_")}_PK`;
  const pk = process.env[envName];
  if (pk) return privateKeyToAccount(pk as `0x${string}`, { nonceManager });
  if (network === "local") {
    const index = ROLE_INDEX[role];
    if (index === undefined) throw new Error(`No local index for role "${role}".`);
    return anvilAccount(index);
  }
  const password = process.env.CHAINWORK_KEYSTORE_PASSWORD;
  if (!password) throw new Error(`Set CHAINWORK_KEYSTORE_PASSWORD to unlock the ${role} keystore for ${network}.`);
  const name = role.replace(/-/g, "_");
  const cached = keystoreCache.get(name);
  if (cached) return cached;
  const dir = process.env.KEYSTORE_DIR ?? fileURLToPath(new URL("../../../.keys", import.meta.url));
  const account = loadKeystoreAccount(dir, name, password);
  keystoreCache.set(name, account);
  return account;
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
