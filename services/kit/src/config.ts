/**
 * One place that turns environment variables into a chain + relayer + deployment for a service.
 *
 * Keys are never written to disk or committed: on Aevum the relayer comes from an encrypted V3
 * keystore (RELAYER_KEYSTORE + RELAYER_KEYSTORE_PASSWORD) or, for local development only, from the
 * well-known anvil mnemonic. See docs/RUNBOOK.md.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { AEVUM_TESTNET } from "@chainwork/types";
import {
  Chainwork,
  configFromDeployment,
  type ChainworkConfig,
  type DeploymentJson,
} from "@chainwork/sdk";
import { loadKeystoreAccount } from "@chainwork/sdk/node";

export type NetworkName = "local" | "aevum";

export interface ServiceConfig {
  network: NetworkName;
  chain: Chain;
  rpcUrl: string;
  cfg: ChainworkConfig;
  deployment: DeploymentJson;
  publicClient: PublicClient;
  relayer: PrivateKeyAccount;
  wallet: WalletClient;
  /** Explorer link for a tx, or the hash itself on the local chain. */
  explorerTx(txHash: string): string;
  explorerAddress(address: string): string;
}

/** Aevum testnet as a viem chain. Chain facts come from @chainwork/types, never invented here. */
export const aevum = defineChain({
  id: AEVUM_TESTNET.id,
  name: AEVUM_TESTNET.name,
  nativeCurrency: AEVUM_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [AEVUM_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: AEVUM_TESTNET.explorerUrl } },
});

/** anvil account 0 (deployer/relayer). Local development only. */
const LOCAL_RELAYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** anvil's default mnemonic keys, by Chainwork role. Used only when NETWORK=local. */
const LOCAL_ROLE_KEYS: Record<string, `0x${string}`> = {
  deployer: LOCAL_RELAYER_PK,
  client: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  coordinator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "specialist-data": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "specialist-bad": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  backup: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  watcher: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  evaluator: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
};

export function networkName(): NetworkName {
  const n = process.env.NETWORK ?? "local";
  if (n !== "local" && n !== "aevum") throw new Error(`NETWORK must be "local" or "aevum", not "${n}".`);
  return n;
}

export function deploymentPath(network: NetworkName): string {
  const override = process.env.DEPLOYMENT;
  if (override) return isAbsolute(override) ? override : resolve(process.cwd(), override);
  return fileURLToPath(new URL(`../../../deployments/${network}.json`, import.meta.url));
}

export function readDeployment(network: NetworkName = networkName()): DeploymentJson {
  const path = deploymentPath(network);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DeploymentJson;
  } catch (e) {
    throw new Error(
      `Cannot read deployment file ${path}. Run the DeployLocal / DeployAevum script first (see docs/RUNBOOK.md).`,
      { cause: e },
    );
  }
}

/**
 * Load the relayer key. Priority: RELAYER_PK (hex, e.g. from a secrets manager) →
 * RELAYER_KEYSTORE + password → anvil account 0 when NETWORK=local.
 */
export function loadRelayer(network: NetworkName = networkName()): PrivateKeyAccount {
  const pk = process.env.RELAYER_PK;
  if (pk) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("RELAYER_PK must be a 32-byte hex private key.");
    return privateKeyToAccount(pk as `0x${string}`);
  }
  const keystore = process.env.RELAYER_KEYSTORE;
  const password = process.env.RELAYER_KEYSTORE_PASSWORD ?? process.env.CHAINWORK_KEYSTORE_PASSWORD;
  if (keystore) {
    if (!password) throw new Error("Set RELAYER_KEYSTORE_PASSWORD (or CHAINWORK_KEYSTORE_PASSWORD) to unlock the relayer keystore.");
    return loadKeystoreAccount(dirname(keystore), basename(keystore), password);
  }
  if (network === "local") {
    const role = process.env.AGENT_ROLE ?? process.env.SERVICE_ROLE ?? "deployer";
    const local = LOCAL_ROLE_KEYS[role];
    if (!local) throw new Error(`No local key for role "${role}". Use one of: ${Object.keys(LOCAL_ROLE_KEYS).join(", ")}.`);
    return privateKeyToAccount(local);
  }
  throw new Error(
    "No relayer key on Aevum. Set RELAYER_KEYSTORE to a local V3 keystore plus RELAYER_KEYSTORE_PASSWORD, or RELAYER_PK from a secrets manager.",
  );
}

export function localRoleAddress(role: string): `0x${string}` {
  const pk = LOCAL_ROLE_KEYS[role];
  if (!pk) throw new Error(`Unknown local role "${role}".`);
  return privateKeyToAccount(pk).address;
}

/** Parse WORKER_URLS: {"0xprovider":"http://host:port"} into a lowercase-keyed map. */
export function parseWorkerUrls(raw: string | undefined = process.env.WORKER_URLS): Record<string, string> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) out[k.toLowerCase()] = v.replace(/\/$/, "");
  return out;
}

export interface LoadConfigOptions {
  /** Skip loading a relayer (read-only services such as the indexer). */
  readOnly?: boolean;
}

export function loadServiceConfig(opts: LoadConfigOptions = {}): ServiceConfig {
  const network = networkName();
  const chain = network === "aevum" ? aevum : foundry;
  const rpcUrl =
    process.env.RPC_URL ?? (network === "aevum" ? AEVUM_TESTNET.rpcUrl : "http://127.0.0.1:8545");
  const deployment = readDeployment(network);
  if (deployment.chainId !== chain.id) {
    throw new Error(
      `deployments/${network}.json is for chain ${deployment.chainId}, but NETWORK=${network} expects ${chain.id}.`,
    );
  }
  const cfg = configFromDeployment(deployment, { facilitatorUrl: process.env.FACILITATOR_URL });
  const transport = http(rpcUrl, { retryCount: 3, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport });

  // Read-only services never sign; give them a throwaway address so no real key is loaded.
  const relayer = opts.readOnly ? privateKeyToAccount(generatePrivateKey()) : loadRelayer(network);
  const wallet = createWalletClient({ account: relayer, chain, transport });

  const explorer = (path: "tx" | "address", value: string) =>
    network === "aevum" ? `${AEVUM_TESTNET.explorerUrl}/${path}/${value}` : value;

  return {
    network,
    chain,
    rpcUrl,
    cfg,
    deployment,
    publicClient,
    relayer,
    wallet,
    explorerTx: (txHash) => explorer("tx", txHash),
    explorerAddress: (address) => explorer("address", address),
  };
}

/** A high-level SDK client for this service's relayer. */
export function chainworkFor(config: ServiceConfig): Chainwork {
  return new Chainwork(config.cfg, config.publicClient, config.wallet);
}
