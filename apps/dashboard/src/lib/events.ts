/**
 * SPDX-License-Identifier: MIT
 * Escrow events → plain-English timeline entries. Pure: decoding and lookups happen in the hook.
 */
import { formatMoney } from "./format";
import type { Tone } from "./state";

export interface RawEvent {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
}

export interface TimelineEntry {
  key: string;
  block: bigint;
  logIndex: number;
  txHash: string;
  /** The job the entry is about (child id for SubJobCreated). */
  jobId: bigint;
  text: string;
  tone: Tone;
  /** Money that moved, in token base units, when the event moved money. */
  amount: bigint | null;
}

type NameOf = (address: string) => string;

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));
const str = (v: unknown): string => String(v ?? "");
const amt = (v: bigint): string => `${formatMoney(v)} tUSD8`;

/** Which jobs an event concerns, so a tree can filter the escrow's whole log. */
export function jobsOf(e: Pick<RawEvent, "eventName" | "args">): bigint[] {
  const a = e.args;
  if (e.eventName === "SubJobCreated" || e.eventName === "ChildBudgetReturned") return [big(a.parentId), big(a.childId)];
  if (e.eventName === "TreeSettled") return [big(a.rootId)];
  return a.jobId !== undefined ? [big(a.jobId)] : [];
}

/** One sentence per event, naming people by role where we know them. Null for events not worth a line. */
export function describe(e: RawEvent, nameOf: NameOf): TimelineEntry | null {
  const a = e.args;
  const base = { key: `${e.txHash}:${e.logIndex}`, block: e.blockNumber, logIndex: e.logIndex, txHash: e.txHash };
  const id = a.jobId !== undefined ? big(a.jobId) : 0n;
  const job = `#${id.toString()}`;
  switch (e.eventName) {
    case "JobCreated":
      return { ...base, jobId: id, tone: "neutral", amount: null, text: `${nameOf(str(a.client))} opened job ${job} for ${nameOf(str(a.provider))}` };
    case "JobFunded":
      return { ...base, jobId: id, tone: "info", amount: big(a.amount), text: `${amt(big(a.amount))} locked in escrow for ${job}` };
    case "SubJobCreated":
      return {
        ...base,
        jobId: big(a.childId),
        tone: "info",
        amount: big(a.budget),
        text: `#${str(a.parentId)} hired ${nameOf(str(a.provider))} as #${str(a.childId)} for ${amt(big(a.budget))}, paid from its own escrow`,
      };
    case "JobAccepted": {
      const bond = big(a.bond);
      return { ...base, jobId: id, tone: "neutral", amount: null, text: `${nameOf(str(a.provider))} took ${job}${bond > 0n ? `, posting a ${amt(bond)} bond` : " with no bond needed"}` };
    }
    case "JobSubmitted":
      return { ...base, jobId: id, tone: "warn", amount: null, text: `${nameOf(str(a.provider))} delivered ${job}; the challenge window opens` };
    case "Challenged":
      return { ...base, jobId: id, tone: "bad", amount: big(a.bond), text: `${nameOf(str(a.challenger))} challenged ${job}, staking ${amt(big(a.bond))}` };
    case "JobCompleted":
      return { ...base, jobId: id, tone: "good", amount: null, text: `${job} approved` };
    case "JobRejected":
      return { ...base, jobId: id, tone: "bad", amount: null, text: `${job} rejected by ${nameOf(str(a.rejector))}` };
    case "JobExpired":
      return { ...base, jobId: id, tone: "bad", amount: null, text: `${job} expired without delivery` };
    case "PaymentReleased":
      return { ...base, jobId: id, tone: "good", amount: big(a.amount), text: `${nameOf(str(a.provider))} paid ${amt(big(a.amount))} for ${job}` };
    case "Refunded":
      return { ...base, jobId: id, tone: "info", amount: big(a.amount), text: `${amt(big(a.amount))} refunded to ${nameOf(str(a.client))} from ${job}` };
    case "ChildBudgetReturned":
      return { ...base, jobId: big(a.childId), tone: "info", amount: big(a.amount), text: `${amt(big(a.amount))} from #${str(a.childId)} returned to #${str(a.parentId)}'s budget` };
    case "BondSlashed":
      return { ...base, jobId: id, tone: "bad", amount: big(a.amount), text: `${nameOf(str(a.provider))} lost its ${amt(big(a.amount))} bond on ${job}` };
    case "BondReturned":
      return big(a.amount) > 0n
        ? { ...base, jobId: id, tone: "neutral", amount: big(a.amount), text: `${amt(big(a.amount))} bond returned to ${nameOf(str(a.provider))}` }
        : null;
    case "ChallengeBondSettled":
      return { ...base, jobId: id, tone: "neutral", amount: big(a.amount), text: `Challenge stake of ${amt(big(a.amount))} on ${job} settled to ${nameOf(str(a.to))}` };
    case "TreeSettled":
      return { ...base, jobId: big(a.rootId), tone: "good", amount: null, text: `Tree #${str(a.rootId)} settled: ${str(a.nodesClosed)} jobs closed in one transaction` };
    default:
      return null;
  }
}

/** Oldest first. */
export const byChainOrder = (x: TimelineEntry, y: TimelineEntry): number =>
  x.block === y.block ? x.logIndex - y.logIndex : x.block < y.block ? -1 : 1;
