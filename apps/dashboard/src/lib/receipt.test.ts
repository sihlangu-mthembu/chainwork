// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Hex, ReceiptLine, TreeReceipt } from "@chainwork/types";

const TX_HASH = ("0x" + "ab".repeat(32)) as Hex;
import { auditReceipt, planLogScan, receiptFileName, sumByOutcome, totalsRows } from "./receipt";

const line = (outcome: ReceiptLine["outcome"], amount: string, jobId = "1"): ReceiptLine => ({
  jobId,
  parentId: "1",
  provider: "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1",
  amount,
  outcome,
  txHash: TX_HASH,
});

const receipt = (lines: ReceiptLine[], totalFunded = "100000"): TreeReceipt => ({
  rootId: "1",
  client: "0xbE213deEEf489afDf67842F411472Aa90f8f8D77",
  totalFunded,
  lines,
  generatedAt: "2026-11-24T12:30:05.123Z",
});

describe("sumByOutcome", () => {
  it("adds each outcome independently", () => {
    const totals = sumByOutcome([
      line("paid", "30000", "2"),
      line("paid", "70000", "1"),
      line("refunded", "5000"),
      line("bond-returned", "2000"),
      line("bond-slashed", "1000"),
      line("challenge-bond", "400"),
    ]);
    expect(totals.paid).toBe(100000n);
    expect(totals.refunded).toBe(5000n);
    expect(totals.bondReturned).toBe(2000n);
    expect(totals.bondSlashed).toBe(1000n);
    expect(totals.challengeBond).toBe(400n);
  });

  it("ignores malformed amounts instead of throwing", () => {
    const totals = sumByOutcome([line("paid", "not-a-number"), line("paid", "100")]);
    expect(totals.paid).toBe(100n);
  });

  it("returns zeros for an empty receipt", () => {
    expect(sumByOutcome([])).toEqual({
      paid: 0n,
      refunded: 0n,
      bondReturned: 0n,
      bondSlashed: 0n,
      challengeBond: 0n,
    });
  });
});

describe("auditReceipt", () => {
  it("passes when paid lines sum to the funded total", () => {
    const audit = auditReceipt(receipt([line("paid", "30000", "2"), line("paid", "70000", "1")]));
    expect(audit.matches).toBe(true);
    expect(audit.funded).toBe(100000n);
    expect(audit.paid).toBe(100000n);
    expect(audit.message).toContain("funded total");
  });

  it("fails when the tree is not settled yet", () => {
    const audit = auditReceipt(receipt([line("paid", "30000", "2")]));
    expect(audit.matches).toBe(false);
    expect(audit.message).toContain("funded with 0.1 tUSD8");
  });

  it("counts every line, not only payments", () => {
    const audit = auditReceipt(receipt([line("paid", "100000"), line("refunded", "5")]));
    expect(audit.matches).toBe(true);
    expect(audit.lineCount).toBe(2);
  });
});

describe("totalsRows", () => {
  it("keeps a stable order for tables and the PDF", () => {
    const rows = totalsRows(sumByOutcome([line("paid", "100")]));
    expect(rows.map((row) => row.label)).toEqual([
      "Paid to provider",
      "Refunded to client",
      "Bond returned",
      "Bond slashed",
      "Challenge bond settled",
    ]);
    expect(rows[0]?.amount).toBe("0.0001");
  });
});

describe("receiptFileName", () => {
  it("is filesystem safe", () => {
    expect(receiptFileName(receipt([]), "json")).toBe(
      "chainwork-receipt-1-2026-11-24T12-30-05-123Z.json",
    );
    expect(receiptFileName(receipt([]), "pdf")).toMatch(/\.pdf$/);
  });
});

describe("planLogScan", () => {
  it("accepts a small range and reports the chunk count", () => {
    const plan = planLogScan(1000n, 2200n);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.from).toBe(1000n);
      expect(plan.chunks).toBe(3);
    }
  });

  it("refuses an unbounded scan", () => {
    expect(planLogScan(null, 100n).ok).toBe(false);
  });

  it("refuses a scan past the request budget", () => {
    const plan = planLogScan(0n, 100000n);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("log requests");
  });

  it("refuses a deployment block ahead of the head", () => {
    expect(planLogScan(500n, 100n).ok).toBe(false);
  });
});
