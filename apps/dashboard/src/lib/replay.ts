/**
 * SPDX-License-Identifier: MIT
 * Replay: rebuild what a job tree looked like after its first k on-chain events, and say which
 * money line moved at that step. Pure, so the scrubber, deep links and tests share one truth.
 */
import type { JobNode, UiJobState } from "@chainwork/types";
import type { RawEvent } from "./events";

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));

/** A coin run along one line of the money map. */
export interface Flow {
  /** "payer" for client → root, else the child job id as a string. */
  edge: string;
  /** "out" runs away from the payer/root, "back" runs toward it (refunds, returned budget). */
  direction: "out" | "back";
  kind: "fund" | "hire" | "pay" | "refund";
}

/** The money movement an event represents on the map of root `rootId`, if any. */
export function flowOf(e: Pick<RawEvent, "eventName" | "args">, rootId: bigint): Flow | null {
  const a = e.args;
  switch (e.eventName) {
    case "JobFunded":
      return big(a.jobId) === rootId ? { edge: "payer", direction: "out", kind: "fund" } : null;
    case "SubJobCreated":
      return { edge: big(a.childId).toString(), direction: "out", kind: "hire" };
    case "PaymentReleased":
      return big(a.jobId) === rootId ? null : { edge: big(a.jobId).toString(), direction: "out", kind: "pay" };
    case "ChildBudgetReturned":
      return { edge: big(a.childId).toString(), direction: "back", kind: "refund" };
    case "Refunded":
      return big(a.jobId) === rootId ? { edge: "payer", direction: "back", kind: "refund" } : { edge: big(a.jobId).toString(), direction: "back", kind: "refund" };
    default:
      return null;
  }
}

interface NodeState {
  visible: boolean;
  ui: UiJobState;
  accepted: boolean;
  challenged: boolean;
}

/**
 * The tree as it stood after events[0..step] (inclusive). Nodes not created yet are left out.
 * `events` must be this tree's events in chain order. step < 0 gives null (nothing happened yet).
 */
export function treeAt(tree: JobNode, events: readonly RawEvent[], step: number): JobNode | null {
  if (step < 0) return null;
  const states = new Map<string, NodeState>();
  const all = [tree, ...tree.children];
  for (const n of all) states.set(n.job.id.toString(), { visible: false, ui: "Quoted", accepted: false, challenged: false });
  const kidsSeen = new Set<string>();

  const upto = Math.min(step, events.length - 1);
  for (let i = 0; i <= upto; i++) {
    const e = events[i];
    if (!e) continue;
    const a = e.args;
    const id = a.jobId !== undefined ? big(a.jobId).toString() : "";
    const s = states.get(id);
    switch (e.eventName) {
      case "JobCreated":
        if (s) s.visible = true;
        break;
      case "SubJobCreated": {
        const child = states.get(big(a.childId).toString());
        if (child) child.visible = true;
        kidsSeen.add(big(a.childId).toString());
        break;
      }
      case "JobFunded":
        if (s) s.ui = "Escrowed";
        break;
      case "JobAccepted":
        if (s) {
          s.accepted = true;
          s.ui = "Accepted";
        }
        break;
      case "JobSubmitted":
        if (s) s.ui = "Submitted";
        break;
      case "Challenged":
        if (s) {
          s.challenged = true;
          s.ui = "Challenged";
        }
        break;
      case "JobCompleted":
        if (s) s.ui = "Settled";
        break;
      case "JobRejected":
        if (s) s.ui = "Rejected";
        break;
      case "JobExpired":
      case "Refunded":
        if (s && s.ui !== "Rejected") s.ui = "Refunded";
        break;
    }
  }

  const rootState = states.get(tree.job.id.toString());
  if (!rootState?.visible) return null;
  const children = tree.children
    .filter((c) => states.get(c.job.id.toString())?.visible)
    .map((c) => {
      const cs = states.get(c.job.id.toString())!;
      return { ...c, ui: cs.ui, ext: { ...c.ext, challenged: cs.challenged, accepted: cs.accepted }, children: [] };
    });
  const rootUi: UiJobState = rootState.ui === "Accepted" && children.length > 0 ? "Subcontracted" : rootState.ui;
  return { ...tree, ui: rootUi, ext: { ...tree.ext, accepted: rootState.accepted, challenged: rootState.challenged }, children };
}
