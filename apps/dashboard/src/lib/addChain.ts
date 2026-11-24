/**
 * SPDX-License-Identifier: MIT
 * EIP-3085 "Add Aevum" parameters. Every value comes from @chainwork/types (AEVUM_TESTNET);
 * no number or URL is written by hand here.
 */
import { AEVUM_TESTNET } from "@chainwork/types";

export interface NativeCurrencyParameter {
  name: string;
  symbol: string;
  decimals: number;
}

/** Subset of EIP-3085 wallet_addEthereumChain params that we send. */
export interface AddEthereumChainParameter {
  chainId: string;
  chainName: string;
  nativeCurrency: NativeCurrencyParameter;
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export const AEVUM_CHAIN_ID_HEX = "0x" + AEVUM_TESTNET.id.toString(16);

/** 4902 = the wallet does not know this chain yet (EIP-1193 / EIP-3085). */
export const UNRECOGNIZED_CHAIN_CODE = 4902;

export function aevumAddChainParams(): AddEthereumChainParameter {
  return {
    chainId: AEVUM_CHAIN_ID_HEX,
    chainName: AEVUM_TESTNET.name,
    nativeCurrency: {
      name: AEVUM_TESTNET.nativeCurrency.name,
      symbol: AEVUM_TESTNET.nativeCurrency.symbol,
      decimals: AEVUM_TESTNET.nativeCurrency.decimals,
    },
    rpcUrls: [AEVUM_TESTNET.rpcUrl],
    blockExplorerUrls: [AEVUM_TESTNET.explorerUrl],
  };
}

/** Pull a numeric JSON-RPC error code out of whatever shape the wallet library threw. */
export function errorCode(err: unknown, depth = 0): number | null {
  if (depth > 4 || err === null || typeof err !== "object") return null;
  const record = err as Record<string, unknown>;
  const code = record["code"];
  if (typeof code === "number") return code;
  const nested = [record["cause"], record["data"], record["error"], record["originalError"]];
  for (const candidate of nested) {
    const found = errorCode(candidate, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export function isUnrecognizedChain(err: unknown): boolean {
  return errorCode(err) === UNRECOGNIZED_CHAIN_CODE;
}
