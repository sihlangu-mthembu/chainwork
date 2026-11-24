// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { AEVUM_TESTNET, TUSD8 } from "@chainwork/types";
import {
  configProblems,
  isDeploymentReady,
  mergeDeployment,
  missingFields,
  parseAddress,
  parseDeploymentFile,
  readConfig,
  type EnvSource,
} from "./config";

const env = (values: Record<string, string>): EnvSource => values;

describe("readConfig", () => {
  it("falls back to the Aevum facts when nothing is set", () => {
    const config = readConfig(env({}));
    expect(config.chainId).toBe(AEVUM_TESTNET.id);
    expect(config.rpcUrl).toBe(AEVUM_TESTNET.rpcUrl);
    expect(config.explorerUrl).toBe(AEVUM_TESTNET.explorerUrl);
    expect(config.token).toBe(TUSD8.address);
    expect(config.tokenFromEnv).toBe(false);
    expect(config.escrow).toBeNull();
    expect(config.fromBlock).toBeNull();
  });

  it("reads explicit env values and normalises them", () => {
    const config = readConfig(
      env({
        VITE_CHAIN_ID: "31337",
        VITE_ESCROW: "0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6",
        VITE_EXPLORER_URL: "https://explorer-test.qday.info/",
        VITE_FROM_BLOCK: "42",
        VITE_INDEXER_URL: "http://127.0.0.1:4100",
      }),
    );
    expect(config.chainId).toBe(31337);
    expect(config.escrow).toBe("0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6");
    expect(config.explorerUrl).toBe(AEVUM_TESTNET.explorerUrl);
    expect(config.fromBlock).toBe(42n);
    expect(config.indexerUrl).toBe("http://127.0.0.1:4100");
  });

  it("ignores malformed addresses instead of crashing", () => {
    expect(parseAddress("0x1234")).toBeNull();
    expect(parseAddress("")).toBeNull();
    expect(readConfig(env({ VITE_ESCROW: "not-an-address" })).escrow).toBeNull();
  });

  it("strips a trailing slash from the explorer url", () => {
    expect(readConfig(env({ VITE_EXPLORER_URL: "https://x.test/" })).explorerUrl).toBe("https://x.test");
  });
});

describe("missingFields", () => {
  it("lists every unset panel dependency", () => {
    expect(missingFields(readConfig(env({})))).toEqual(["escrow", "reputation", "budgetGuard", "clientAccount"]);
  });

  it("is empty for a complete config", () => {
    const config = readConfig(
      env({
        VITE_ESCROW: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
        VITE_REPUTATION: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
        VITE_BUDGET_GUARD: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
        VITE_CLIENT_ACCOUNT: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",
      }),
    );
    expect(missingFields(config)).toEqual([]);
    expect(isDeploymentReady(config)).toBe(true);
  });
});

describe("mergeDeployment", () => {
  const file = {
    chainId: AEVUM_TESTNET.id,
    escrow: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6" as const,
    reputation: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853" as const,
    budgetGuard: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788" as const,
    clientAccount: "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82" as const,
    token: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const,
    deployedAtBlock: 1234,
  };

  it("fills the gaps the env left", () => {
    const { config, warnings } = mergeDeployment(readConfig(env({})), file);
    expect(warnings).toEqual([]);
    expect(config.escrow).toBe(file.escrow);
    expect(config.reputation).toBe(file.reputation);
    expect(config.fromBlock).toBe(1234n);
    expect(config.token).toBe(file.token);
  });

  it("keeps explicit env values", () => {
    const base = readConfig(
      env({
        VITE_ESCROW: "0x00000000000000000000000000000000000000A1",
        VITE_TOKEN: "0x00000000000000000000000000000000000000A2",
      }),
    );
    const { config } = mergeDeployment(base, file);
    expect(config.escrow).toBe("0x00000000000000000000000000000000000000A1");
    expect(config.token).toBe("0x00000000000000000000000000000000000000A2");
  });

  it("warns and ignores a deployment for another chain", () => {
    const { config, warnings } = mergeDeployment(readConfig(env({})), { ...file, chainId: 31337 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("chain 31337");
    expect(config.escrow).toBeNull();
  });

  it("handles a missing file", () => {
    const base = readConfig(env({}));
    expect(mergeDeployment(base, null).config).toEqual(base);
  });
});

describe("parseDeploymentFile", () => {
  it("keeps the fields it recognises", () => {
    const parsed = parseDeploymentFile({
      chainId: 44005,
      escrow: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
      junk: true,
    });
    expect(parsed?.escrow).toBe("0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6");
    expect(parsed?.chainId).toBe(44005);
  });

  it("returns null for shapes it cannot use", () => {
    expect(parseDeploymentFile(null)).toBeNull();
    expect(parseDeploymentFile([])).toBeNull();
    expect(parseDeploymentFile({ escrow: "nope" })).toBeNull();
  });
});

describe("configProblems", () => {
  it("mentions the missing deployment block", () => {
    expect(configProblems(readConfig(env({}))).join(" ")).toContain("VITE_FROM_BLOCK");
  });

  it("flags a non-tUSD8 token on Aevum", () => {
    const config = readConfig(env({ VITE_TOKEN: "0x00000000000000000000000000000000000000A2" }));
    expect(configProblems(config).join(" ")).toContain("VITE_TOKEN");
  });
});
