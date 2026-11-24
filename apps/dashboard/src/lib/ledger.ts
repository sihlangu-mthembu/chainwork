/**
 * SPDX-License-Identifier: MIT
 * "Where every cent went": split a tree's funded budget by final recipient from its escrow events,
 * and check the parts add up to what the client paid in.
 */
import type { RawEvent } from "./events";

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));

export interface LedgerPart {
  /** Recipient address (lower case), or "escrow" for money still held. */
  to: string;
  kind: "paid" | "refunded" | "held";
  amount: bigint;
  /** Job ids the money came from. */
  jobs: bigint[];
}

export interface Ledger {
  funded: bigint;
  parts: LedgerPart[];
  /** Sum of parts, which must equal funded. */
  accounted: bigint;
  balanced: boolean;
  /** Bonds and challenge stakes: they move between agents but are not the client's money. */
  stakes: { to: string; amount: bigint; job: bigint; kind: "slashed" | "challenge" }[];
}

export function ledgerOf(rootId: bigint, funded: bigint, events: readonly RawEvent[]): Ledger {
  const byKey = new Map<string, LedgerPart>();
  const add = (to: string, kind: LedgerPart["kind"], amount: bigint, job: bigint) => {
    if (amount === 0n) return;
    const key = `${kind}:${to}`;
    const part = byKey.get(key) ?? { to, kind, amount: 0n, jobs: [] };
    part.amount += amount;
    if (!part.jobs.includes(job)) part.jobs.push(job);
    byKey.set(key, part);
  };
  const stakes: Ledger["stakes"] = [];
  for (const e of events) {
    const a = e.args;
    const job = a.jobId !== undefined ? big(a.jobId) : 0n;
    if (e.eventName === "PaymentReleased") add(String(a.provider).toLowerCase(), "paid", big(a.amount), job);
    // A child's refund goes back into its parent's budget (ChildBudgetReturned), not out of the
    // tree: only the root's refund reaches the client.
    if (e.eventName === "Refunded" && job === rootId) add(String(a.client).toLowerCase(), "refunded", big(a.amount), job);
    if (e.eventName === "BondSlashed") stakes.push({ to: String(a.to).toLowerCase(), amount: big(a.amount), job, kind: "slashed" });
    if (e.eventName === "ChallengeBondSettled") stakes.push({ to: String(a.to).toLowerCase(), amount: big(a.amount), job, kind: "challenge" });
  }
  const parts = [...byKey.values()].sort((x, y) => (x.kind === y.kind ? (x.amount > y.amount ? -1 : 1) : x.kind === "paid" ? -1 : 1));
  const out = parts.reduce((s, p) => s + p.amount, 0n);
  if (funded > out) parts.push({ to: "escrow", kind: "held", amount: funded - out, jobs: [rootId] });
  const accounted = parts.reduce((s, p) => s + p.amount, 0n);
  return { funded, parts, accounted, balanced: accounted === funded, stakes };
}
