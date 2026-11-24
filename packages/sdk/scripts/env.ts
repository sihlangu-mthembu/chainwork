/**
 * Shared setup for operator scripts. Keys come from environment variables (load them from a local,
 * never-committed .env or a secrets manager). Network comes from NETWORK=local|aevum.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { AEVUM_TESTNET } from "@chainwork/types";
import { Chainwork, configFromDeployment, type DeploymentJson } from "../src/index.js";
import { loadKeystoreAccount } from "../src/node.js";

export const aevum = defineChain({
  id: AEVUM_TESTNET.id,
  name: AEVUM_TESTNET.name,
  nativeCurrency: AEVUM_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [AEVUM_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Aevum Explorer", url: AEVUM_TESTNET.explorerUrl } },
});

export const ROLES = [
  "DEPLOYER",
  "CLIENT",
  "COORDINATOR",
  "SPECIALIST_DATA",
  "SPECIALIST_BAD",
  "BACKUP",
  "WATCHER",
  "EVALUATOR",
] as const;
export type Role = (typeof ROLES)[number];

// anvil's default mnemonic keys, used only when NETWORK=local and no env key is set
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
] as const;

export function setup() {
  const network = (process.env.NETWORK ?? "local") as "local" | "aevum";
  const chain: Chain = network === "aevum" ? aevum : foundry;
  const rpc = process.env.RPC_URL ?? (network === "aevum" ? AEVUM_TESTNET.rpcUrl : "http://127.0.0.1:8545");
  const depPath = process.env.DEPLOYMENT ?? fileURLToPath(new URL(`../../../deployments/${network}.json`, import.meta.url));
  const dep = JSON.parse(readFileSync(depPath, "utf8")) as DeploymentJson;
  const cfg = configFromDeployment(dep, { facilitatorUrl: process.env.FACILITATOR_URL });
  const transport = http(rpc, { retryCount: 3 });
  const publicClient = createPublicClient({ chain, transport });

  // Key sources, in order: encrypted keystore in KEYSTORE_DIR (default <repo>/.keys) unlocked with
  // CHAINWORK_KEYSTORE_PASSWORD; then anvil's default keys on the local chain. Raw keys are never read
  // from files. (A <ROLE>_PK env var is accepted only on the local chain, for tests.)
  const keystoreDir = process.env.KEYSTORE_DIR ?? fileURLToPath(new URL("../../../.keys", import.meta.url));
  const password = process.env.CHAINWORK_KEYSTORE_PASSWORD;
  const cache = new Map<Role, PrivateKeyAccount>();
  const key = (role: Role): PrivateKeyAccount => {
    const hit = cache.get(role);
    if (hit) return hit;
    let acct: PrivateKeyAccount | undefined;
    const name = role.toLowerCase();
    if (password && (existsSync(`${keystoreDir}/${name}`) || existsSync(`${keystoreDir}/${name}.json`))) {
      acct = loadKeystoreAccount(keystoreDir, name, password);
    } else if (network === "local") {
      const v = process.env[`${role}_PK`];
      acct = privateKeyToAccount((v ?? ANVIL_KEYS[ROLES.indexOf(role)]!) as `0x${string}`);
    } else {
      throw new Error(
        `No key for ${role}: put its keystore in ${keystoreDir} and set CHAINWORK_KEYSTORE_PASSWORD.`,
      );
    }
    cache.set(role, acct);
    return acct;
  };
  const wallet = (role: Role) => createWalletClient({ account: key(role), chain, transport });
  const as = (role: Role) => new Chainwork(cfg, publicClient, wallet(role));
  const explorer = (hash: string) =>
    network === "aevum" ? `${AEVUM_TESTNET.explorerUrl}/tx/${hash}` : hash;
  return { network, chain, cfg, dep, publicClient, key, wallet, as, explorer };
}
