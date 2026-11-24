// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Hex, TreeReceipt } from "@chainwork/types";
import { buildReceiptPdf } from "./receiptPdf";

const TX = ("0x" + "ab".repeat(32)) as Hex;

const receipt: TreeReceipt = {
  rootId: "1",
  client: "0xbE213deEEf489afDf67842F411472Aa90f8f8D77",
  totalFunded: "100000",
  generatedAt: "2026-11-24T12:30:05.123Z",
  lines: [
    { jobId: "2", parentId: "1", provider: "0xa5130D2A006d13750Fbc2E7b66cad6Cb9ad9B5c3", amount: "30000", outcome: "paid", txHash: TX },
    { jobId: "3", parentId: "1", provider: "0x80Dec5f266418EB8ae26A6C2Ee592c9082E4c00d", amount: "40000", outcome: "paid", txHash: TX },
    { jobId: "1", parentId: null, provider: "0x28C0B52FAd3Ce860324C3DA7DfDdcD7b94cEA40A", amount: "30000", outcome: "paid", txHash: TX },
  ],
};

describe("buildReceiptPdf", () => {
  it("emits a real PDF document", () => {
    const doc = buildReceiptPdf(receipt, {
      explorerUrl: "https://explorer-test.qday.info",
      escrow: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
      chainName: "Aevum Testnet",
    });
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("still produces a document with no lines", () => {
    const doc = buildReceiptPdf({ ...receipt, lines: [] }, {
      explorerUrl: "https://explorer-test.qday.info",
      escrow: null,
      chainName: "Aevum Testnet",
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
