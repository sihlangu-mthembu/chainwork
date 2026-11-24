/**
 * SPDX-License-Identifier: MIT
 * Print-friendly PDF for a tree receipt, generated in the browser with jsPDF.
 * Borrowed library: jsPDF (MIT), https://github.com/parallax/jsPDF
 */
import { jsPDF } from "jspdf";
import type { TreeReceipt } from "@chainwork/types";
import { formatAmount, formatTimestamp } from "./format";
import { auditReceipt, OUTCOME_LABELS, sumByOutcome, totalsRows } from "./receipt";

export interface ReceiptPdfOptions {
  explorerUrl: string;
  escrow: string | null;
  chainName: string;
}

const MARGIN = 48;
const LINE = 16;
const PAGE_HEIGHT = 842;
const PAGE_WIDTH = 595;

export function buildReceiptPdf(receipt: TreeReceipt, options: ReceiptPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const audit = auditReceipt(receipt);
  let y = MARGIN;

  const ensure = (needed: number): void => {
    if (y + needed > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const text = (
    value: string,
    size: number,
    bold = false,
    color: [number, number, number] = [15, 23, 42],
  ): void => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(value, PAGE_WIDTH - MARGIN * 2) as string[];
    for (const line of lines) {
      ensure(LINE);
      doc.text(line, MARGIN, y);
      y += size + 4;
    }
  };

  text("Chainwork tree receipt", 20, true);
  text("Root job #" + receipt.rootId + " - " + options.chainName, 10, false, [71, 85, 105]);
  text("Client: " + receipt.client, 10);
  text("Escrow: " + (options.escrow ?? "not configured"), 10);
  text("Generated: " + formatTimestamp(Math.floor(Date.parse(receipt.generatedAt) / 1000)), 10);
  y += 8;

  text("Totals", 13, true);
  text("Root funded: " + formatAmount(audit.funded) + " tUSD8", 10);
  for (const row of totalsRows(sumByOutcome(receipt.lines))) {
    text(row.label + ": " + row.amount + " tUSD8", 10);
  }
  y += 4;
  text(audit.message, 10, true, audit.matches ? [21, 128, 61] : [185, 28, 28]);
  y += 9;

  text("Lines (" + receipt.lines.length.toString() + ")", 13, true);
  if (receipt.lines.length === 0) {
    text("No money movements found in the scanned range.", 10, false, [100, 116, 139]);
  }
  for (const line of receipt.lines) {
    const parent = line.parentId === null ? "root" : "parent #" + line.parentId;
    text(
      "#" +
        line.jobId +
        " (" +
        parent +
        ") - " +
        OUTCOME_LABELS[line.outcome] +
        " - " +
        formatAmount(BigInt(line.amount)) +
        " tUSD8 - " +
        line.provider,
      10,
    );
    text(options.explorerUrl + "/tx/" + line.txHash, 8, false, [37, 99, 235]);
    y += 2;
  }

  ensure(40);
  text(
    "Every line above is an escrow event with its transaction hash on " + options.chainName + ".",
    8,
    false,
    [100, 116, 139],
  );

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Chainwork - page " + page.toString() + " of " + pages.toString(), MARGIN, PAGE_HEIGHT - 24);
  }
  return doc;
}
