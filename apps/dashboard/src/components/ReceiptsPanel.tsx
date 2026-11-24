/**
 * SPDX-License-Identifier: MIT
 * T5.4 receipts: build a tree receipt with the SDK (500-block log chunks, never > 1,000), show the
 * money lines and totals, assert that paid lines sum to the funded total, and download JSON or PDF.
 */
import { useState } from "react";
import { AEVUM_TESTNET, type TreeReceipt } from "@chainwork/types";
import { buildReceipt } from "@chainwork/sdk";
import { useConfig } from "../ConfigContext";
import { useChainwork } from "../hooks";
import { downloadJson } from "../lib/download";
import { toPlainError } from "../lib/errors";
import { explorerTxUrl, formatAmount, formatTimestamp, parseJobId } from "../lib/format";
import {
  auditReceipt,
  OUTCOME_LABELS,
  planLogScan,
  receiptFileName,
  sumByOutcome,
  totalsRows,
} from "../lib/receipt";
import { buildReceiptPdf } from "../lib/receiptPdf";
import { recordReceiptTxs } from "../lib/txStore";
import { ErrorNote, ExternalLink, Field, Notice, Panel } from "./ui";

export function ReceiptsPanel() {
  const { config } = useConfig();
  const handle = useChainwork();
  const [rootInput, setRootInput] = useState("");
  const [fromInput, setFromInput] = useState(config.fromBlock === null ? "" : config.fromBlock.toString());
  const [receipt, setReceipt] = useState<TreeReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function build(): Promise<void> {
    setError(null);
    const rootId = parseJobId(rootInput);
    if (rootId === null) {
      setError("Enter the root job id (a whole number).");
      return;
    }
    if (!handle) {
      setError("Set the escrow address (VITE_ESCROW or deployment.json) first.");
      return;
    }
    const from = fromInput.trim() === "" ? config.fromBlock : /^\d+$/.test(fromInput.trim()) ? BigInt(fromInput.trim()) : null;
    setBusy(true);
    try {
      const latest = await handle.cw.publicClient.getBlockNumber({ cacheTime: 0 });
      const plan = planLogScan(from, latest);
      if (!plan.ok) {
        setError(plan.reason);
        return;
      }
      const built = await buildReceipt(handle.cw, rootId, plan.from, latest);
      setReceipt(built);
      recordReceiptTxs(built.lines);
    } catch (err) {
      setError(toPlainError(err, "The receipt couldn't be built."));
    } finally {
      setBusy(false);
    }
  }

  const audit = receipt ? auditReceipt(receipt) : null;
  const totals = receipt ? sumByOutcome(receipt.lines) : null;

  function download(extension: "json" | "pdf"): void {
    if (!receipt || !audit || !totals) return;
    if (extension === "json") {
      downloadJson(
        {
          receipt,
          audit: {
            funded: audit.funded.toString(),
            paid: audit.paid.toString(),
            matches: audit.matches,
            lineCount: audit.lineCount,
            message: audit.message,
          },
          totals: {
            paid: totals.paid.toString(),
            refunded: totals.refunded.toString(),
            bondReturned: totals.bondReturned.toString(),
            bondSlashed: totals.bondSlashed.toString(),
            challengeBond: totals.challengeBond.toString(),
          },
          chain: { id: AEVUM_TESTNET.id, name: AEVUM_TESTNET.name, explorer: config.explorerUrl },
        },
        receiptFileName(receipt, "json"),
      );
      return;
    }
    const doc = buildReceiptPdf(receipt, {
      explorerUrl: config.explorerUrl,
      escrow: config.escrow,
      chainName: AEVUM_TESTNET.name,
    });
    doc.save(receiptFileName(receipt, "pdf"));
  }

  return (
    <Panel
      title="Receipts"
      subtitle="Every money movement for a tree, with its transaction hash. Logs are read in 500-block chunks."
      wide
      actions={
        <>
          <button className="button button-small" type="button" disabled={!receipt} onClick={() => download("json")}>
            Download JSON
          </button>
          <button className="button button-small" type="button" disabled={!receipt} onClick={() => download("pdf")}>
            Download PDF
          </button>
        </>
      }
    >
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void build();
        }}
      >
        <Field label="Root job id">
          <input
            className="input mono"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={rootInput}
            onChange={(event) => setRootInput(event.target.value)}
          />
        </Field>
        <Field label="From block" hint="deployment block; keeps the scan inside the log cap">
          <input
            className="input mono"
            inputMode="numeric"
            placeholder="0"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
          />
        </Field>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Scanning…" : "Build receipt"}
        </button>
      </form>

      <ErrorNote message={error} />

      {audit && totals && receipt ? (
        <>
          <Notice kind={audit.matches ? "good" : "warn"}>
            <strong>{audit.matches ? "Reconciled. " : "Not reconciled yet. "}</strong>
            {audit.message}
          </Notice>

          <div className="receipt-head">
            <h3>
              Receipt for root #{receipt.rootId} · {formatAmount(audit.funded)} tUSD8 funded
            </h3>
            <p className="muted small">
              Client <span className="mono">{receipt.client}</span> · generated {formatTimestamp(Math.floor(Date.parse(receipt.generatedAt) / 1000))} ·{" "}
              {receipt.lines.length.toString()} line(s)
            </p>
          </div>

          <div className="totals">
            {totalsRows(totals).map((row) => (
              <div key={row.label} className="total-row">
                <span>{row.label}</span>
                <span className="mono">{row.amount} tUSD8</span>
              </div>
            ))}
          </div>

          {receipt.lines.length === 0 ? (
            <p className="muted">
              No money movements in that block range. Check the from block — the escrow events must be inside it.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Parent</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Counterparty</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((line, index) => (
                    <tr key={line.txHash + line.jobId + index.toString()}>
                      <td className="mono">#{line.jobId}</td>
                      <td className="mono">{line.parentId === null ? "root" : "#" + line.parentId}</td>
                      <td>{OUTCOME_LABELS[line.outcome] ?? line.outcome}</td>
                      <td className="mono small">{line.provider.slice(0, 12)}…</td>
                      <td className="num mono">{formatAmount(BigInt(line.amount))}</td>
                      <td>
                        <ExternalLink href={explorerTxUrl(config.explorerUrl, line.txHash)}>
                          <span className="mono small">{line.txHash.slice(0, 10)}…</span>
                        </ExternalLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="muted small">
          Build a receipt for a root job. The JSON and PDF carry the same lines, totals and the reconciliation check, so
          anyone can re-verify them against the explorer.
        </p>
      )}
    </Panel>
  );
}
