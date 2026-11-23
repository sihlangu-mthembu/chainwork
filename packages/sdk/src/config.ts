import type { Address } from "@chainwork/types";
import { AEVUM_TESTNET, TUSD8 } from "@chainwork/types";

/** Everything the SDK needs to talk to one Chainwork deployment. */
export interface ChainworkConfig {
  chainId: number;
  escrow: Address;
  token: Address;
  reputation: Address;
  budgetGuard?: Address;
  hashVerifier?: Address;
  signedDataVerifier?: Address;
  /** EIP-712 domain of the token (tUSD8 on Aevum: name "tUSD8", version "2"). */
  tokenDomain: { name: string; version: string; chainId: number; verifyingContract: Address };
  /** First block to scan for events (deployment block). */
  fromBlock?: bigint;
  /** Max eth_getLogs range per request. Aevum caps it at 1,000; we use 500. */
  logChunk?: bigint;
  /** Optional x402 escrow facilitator base URL. */
  facilitatorUrl?: string;
}

/** Shape of deployments/<network>.json written by contracts/script/Deploy.s.sol. */
export interface DeploymentJson {
  chainId: number;
  deployedAtBlock?: number;
  token: Address;
  reputation: Address;
  escrow: Address;
  budgetGuard: Address;
  hashVerifier?: Address;
  signedDataVerifier?: Address;
  clientAccount?: Address;
}

/** Build a config from a deployment file. On Aevum the token domain is the verified tUSD8 domain. */
export function configFromDeployment(d: DeploymentJson, opts: { facilitatorUrl?: string } = {}): ChainworkConfig {
  const isAevum = d.chainId === AEVUM_TESTNET.id;
  return {
    chainId: d.chainId,
    escrow: d.escrow,
    token: d.token,
    reputation: d.reputation,
    budgetGuard: d.budgetGuard,
    hashVerifier: d.hashVerifier,
    signedDataVerifier: d.signedDataVerifier,
    tokenDomain: isAevum
      ? { ...TUSD8.domain }
      : { name: "tUSD8", version: "2", chainId: d.chainId, verifyingContract: d.token },
    fromBlock: BigInt(d.deployedAtBlock ?? 0),
    logChunk: 500n,
    facilitatorUrl: opts.facilitatorUrl,
  };
}

/** tUSD8 has 6 decimals: 0.10 tUSD8 = 100_000n. */
export const toUnits = (amount: number | string): bigint => {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole ?? "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
};

export const formatUnits = (units: bigint): string => {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const s = `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
  return `${neg ? "-" : ""}${s === "" ? "0" : s}`;
};
