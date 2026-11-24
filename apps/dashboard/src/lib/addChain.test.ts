// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { AEVUM_TESTNET } from "@chainwork/types";
import { AEVUM_CHAIN_ID_HEX, aevumAddChainParams, errorCode, isUnrecognizedChain } from "./addChain";

describe("aevumAddChainParams", () => {
  it("builds EIP-3085 params from the chain facts only", () => {
    const params = aevumAddChainParams();
    expect(params.chainId).toBe("0xabe5");
    expect(params.chainId).toBe(AEVUM_CHAIN_ID_HEX);
    expect(params.chainName).toBe("Aevum Testnet");
    expect(params.nativeCurrency).toEqual({ name: "tQDAY", symbol: "tQDAY", decimals: 18 });
    expect(params.rpcUrls).toEqual([AEVUM_TESTNET.rpcUrl]);
    expect(params.blockExplorerUrls).toEqual([AEVUM_TESTNET.explorerUrl]);
  });

  it("derives the chain id from the shared constant", () => {
    expect(AEVUM_CHAIN_ID_HEX).toBe("0x" + AEVUM_TESTNET.id.toString(16));
    expect(AEVUM_TESTNET.id).toBe(44005);
  });
});

describe("wallet error codes", () => {
  it("finds a code on the error itself", () => {
    expect(errorCode({ code: 4902 })).toBe(4902);
  });

  it("finds a code nested inside cause/data/originalError", () => {
    expect(errorCode({ cause: { data: { originalError: { code: 4902 } } } })).toBe(4902);
    expect(isUnrecognizedChain(new Error("x"))).toBe(false);
    expect(isUnrecognizedChain({ code: 4001 })).toBe(false);
  });

  it("survives nonsense", () => {
    expect(errorCode(null)).toBeNull();
    expect(errorCode("nope")).toBeNull();
    expect(errorCode({})).toBeNull();
  });
});
