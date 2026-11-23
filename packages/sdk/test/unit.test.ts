import { describe, expect, it } from "vitest";
import { encodeErrorResult, zeroAddress, type Hex } from "viem";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import type { EscrowPaymentRequirements } from "@chainwork/types";
import { checkQuote, configFromDeployment, decodeRaw, descriptionHash, formatUnits, toUnits } from "../src/index.js";

const cfg = configFromDeployment({
  chainId: 44005,
  token: "0x456569838f1d43009A91ebA4263147Afd7233483",
  reputation: "0x0000000000000000000000000000000000000001",
  escrow: "0x0000000000000000000000000000000000000002",
  budgetGuard: "0x0000000000000000000000000000000000000003",
});

const quote = (over: Partial<EscrowPaymentRequirements["extra"]> & { payTo?: `0x${string}` } = {}): EscrowPaymentRequirements => ({
  scheme: "escrow",
  network: "eip155:44005",
  asset: cfg.token,
  amount: "100000",
  payTo: over.payTo ?? cfg.escrow,
  resource: "https://worker.example/jobs",
  description: "fx data",
  maxTimeoutSeconds: 600,
  extra: {
    escrow: cfg.escrow,
    provider: "0x00000000000000000000000000000000000000AA",
    evaluator: "0x00000000000000000000000000000000000000EE",
    verifier: zeroAddress,
    verifierSpec: `0x${"00".repeat(32)}` as Hex,
    challengeWindow: 60,
    expiredAt: 2_000_000_000,
    bond: "0",
    creditLimit: "100000",
    worstCaseLoss: "100000",
    reputationScore: 10000,
    salt: `0x${"11".repeat(32)}` as Hex,
    descriptionHash: descriptionHash("fx data"),
    ...over,
  },
});

describe("units", () => {
  it("round-trips cents", () => {
    expect(toUnits("0.10")).toBe(100_000n);
    expect(toUnits(1)).toBe(1_000_000n);
    expect(formatUnits(30_000n)).toBe("0.03");
    expect(formatUnits(1_000_000n)).toBe("1");
  });
});

describe("checkQuote (HTTP-layer injection firewall)", () => {
  const now = 1_900_000_000;
  it("accepts a well-formed escrow quote", () => {
    const r = checkQuote(quote(), cfg, "fx data", { now });
    expect(r.ok).toBe(true);
  });
  it("refuses a quote that pays anyone but the escrow", () => {
    const r = checkQuote(quote({ payTo: "0x000000000000000000000000000000000000dEaD" }), cfg, "fx data", { now });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("other than the Chainwork escrow") });
  });
  it("refuses quotes over the budget or worst-case limit", () => {
    expect(checkQuote(quote(), cfg, "fx data", { now, maxBudget: 50_000n }).ok).toBe(false);
    expect(checkQuote(quote(), cfg, "fx data", { now, maxWorstCaseLoss: 10_000n }).ok).toBe(false);
  });
  it("refuses a quote for a different task", () => {
    expect(checkQuote(quote(), cfg, "something else", { now }).ok).toBe(false);
  });
  it("refuses a deadline too close to finish and verify", () => {
    expect(checkQuote(quote({ expiredAt: now + 30 }), cfg, "fx data", { now }).ok).toBe(false);
  });
});

describe("plain-English errors", () => {
  it("decodes CreditExceeded with amounts", () => {
    const data = encodeErrorResult({ abi: chainworkEscrowImplAbi, errorName: "CreditExceeded", args: [60_000n, 50_000n] });
    expect(decodeRaw(data)?.message).toBe(
      "Subcontracting that much would use 0.06 tUSD8, but this agent's bond plus earned credit is 0.05 tUSD8.",
    );
  });
  it("decodes ChildrenOpen", () => {
    const data = encodeErrorResult({ abi: chainworkEscrowImplAbi, errorName: "ChildrenOpen", args: [2] });
    expect(decodeRaw(data)?.message).toBe("2 sub-job(s) are still open; settle them first.");
  });
});
