/**
 * SPDX-License-Identifier: MIT
 * Receipt maths for the dashboard: totals per outcome, the "paid lines sum to the funded total"
 * assertion, safe filename generation and the log-scan budget (Aevum rejects > 1,000 blocks).
 */
import type { ReceiptLine, TreeReceipt } from "@chainwork/types";
import { formatAmount } from "./format";

export type Outcome = ReceiptLine["outcome"];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  paid: "Paid to provider",
  refunded: "Refunded to client",
  "bond-returned": "Bond returned",
  "bond-slashed": "Bond slashed",
  "challenge-bond": "Challenge bond settled",
};

export const OUTCOME_ORDER: readonly Outcome[] = [
  "paid",
  "refunded",
  "bond-returned",
  "bond-slashed",
  "challenge-bond",
];

export interface OutcomeTotals {
  paid: bigint;
  refunded: bigint;
  bondReturned: bigint;
  bondSlashed: bigint;
  challengeBond: bigint;
}

const KEY: Record<Outcome, keyof OutcomeTotals> = {
  paid: "paid",
  refunded: "refunded",
  "bond-returned": "bondReturned",
  "bond-slashed": "bondSlashed",
  "challenge-bond": "challengeBond",
};

export const EMPTY_TOTALS: OutcomeTotals = {
  paid: 0n,
  refunded: 0n,
  bondReturned: 0n,
  bondSlashed: 0n,
  challengeBond: 0n,
};

/** Sum every line by outcome. */
export function sumByOutcome(lines: readonly ReceiptLine[]): OutcomeTotals {
  const totals: OutcomeTotals = { ...EMPTY_TOTALS };
  for (const line of lines) {
    const key = KEY[line.outcome];
    if (!key) continue;
    totals[key] = totals[key] + parseUnitsSafe(line.amount);
  }
  return totals;
}

function parseUnitsSafe(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function grandTotal(totals: OutcomeTotals): bigint {
  return totals.paid + totals.refunded + totals.bondReturned + totals.bondSlashed + totals.challengeBond;
}

/** Ordered rows for tables and the PDF. */
export function totalsRows(totals: OutcomeTotals): { label: string; amount: string; units: bigint }[] {
  return OUTCOME_ORDER.map((outcome) => {
    const units = totals[KEY[outcome]];
    return { label: OUTCOME_LABELS[outcome], amount: formatAmount(units), units };
  });
}

export interface ReceiptAudit {
  funded: bigint;
  paid: bigint;
  matches: boolean;
  lineCount: number;
  message: string;
}

/** The acceptance check for T5.4: paid lines must add up to the root's funded total. */
export function auditReceipt(receipt: TreeReceipt): ReceiptAudit {
  const totals = sumByOutcome(receipt.lines);
  const funded = parseUnitsSafe(receipt.totalFunded);
  const matches = funded === totals.paid;
  const lineCount = receipt.lines.length;
  const message = matches
    ? "Paid lines sum to the funded total (" + formatAmount(funded) + " tUSD8) across " + lineCount.toString() + " line(s)."
    : "Paid lines sum to " +
      formatAmount(totals.paid) +
      " tUSD8 but the root was funded with " +
      formatAmount(funded) +
      " tUSD8 - the tree is probably not fully settled yet, or the scan missed the funding block.";
  return { funded, paid: totals.paid, matches, lineCount, message };
}

/** chainwork-receipt-42-2026-11-24T12-30-05-123Z.json */
export function receiptFileName(receipt: TreeReceipt, extension: "json" | "pdf"): string {
  const stamp = receipt.generatedAt.replace(/[:.]/g, "-");
  return "chainwork-receipt-" + receipt.rootId + "-" + stamp + "." + extension;
}

export type ScanPlan = { ok: true; from: bigint; to: bigint; chunks: number } | { ok: false; reason: string };

/**
 * Aevum rejects eth_getLogs over 1,000 blocks, so the receipt builder pages in 500-block chunks.
 * Refuse a scan that would need more than maxChunks requests instead of hanging the browser.
 */
export function planLogScan(
  fromBlock: bigint | null,
  latest: bigint,
  chunkSize = 500n,
  maxChunks = 40,
): ScanPlan {
  if (fromBlock === null) {
    return {
      ok: false,
      reason:
        "No deployment block is configured. Set VITE_FROM_BLOCK (or ship deployment.json with deployedAtBlock) so receipts know where to start scanning.",
    };
  }
  if (fromBlock < 0n) return { ok: false, reason: "The deployment block cannot be negative." };
  if (latest < fromBlock) {
    return { ok: false, reason: "The deployment block is ahead of the chain head; is the RPC pointing at Aevum?" };
  }
  const span = latest - fromBlock + 1n;
  const chunks = Number((span + chunkSize - 1n) / chunkSize);
  if (chunks > maxChunks) {
    return {
      ok: false,
      reason:
        "That receipt would need " +
        chunks.toString() +
        " log requests of " +
        chunkSize.toString() +
        " blocks (limit " +
        maxChunks.toString() +
        "). Set VITE_FROM_BLOCK closer to the job's funding block.",
    };
  }
  return { ok: true, from: fromBlock, to: latest, chunks };
}
