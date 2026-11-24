import { describe, expect, it } from "vitest";
import type { JobNode, UiJobState } from "@chainwork/types";
import raw from "./fixtures/s2-events.json";
import type { RawEvent } from "./events";
import { ledgerOf } from "./ledger";
import { flowOf, treeAt } from "./replay";

/** Real events from scenario S2 on a local chain: root #10, children #11 (data), #12 (bad), #13 (backup). */
const revive = (v: unknown): unknown => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const events: RawEvent[] = (raw as Array<Record<string, unknown>>).map((e) => ({
  eventName: e.eventName as string,
  args: Object.fromEntries(Object.entries(e.args as Record<string, unknown>).map(([k, v]) => [k, revive(v)])),
  blockNumber: revive(e.blockNumber) as bigint,
  logIndex: e.logIndex as number,
  txHash: e.txHash as string,
}));

const COORD = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const node = (id: bigint, budget: bigint, ui: UiJobState, children: JobNode[] = []): JobNode =>
  ({
    job: { id, client: "0xc", provider: "0xp", evaluator: "0xe", description: "", budget, expiredAt: 0n, status: 3, hook: "0x0" },
    ext: { parentId: 0n, depth: 0, openChildren: 0, accepted: true, challenged: false, verifier: "0x0", challengeWindow: 30n, submittedAt: 0n, bond: 0n, allocated: 0n, paidToChildren: 0n, verifierSpec: "0x0", deliverable: "0x0", challenger: "0x0", challengeBond: 0n },
    ui,
    children,
  }) as unknown as JobNode;
const finalTree = node(10n, 100_000n, "Settled", [node(11n, 30_000n, "Settled"), node(12n, 40_000n, "Rejected"), node(13n, 40_000n, "Settled")]);
const idx = (name: string, job?: bigint) => events.findIndex((e) => e.eventName === name && (job === undefined || e.args.jobId === job || e.args.childId === job));

describe("replay from real S2 events", () => {
  it("shows nothing before the root exists, then only the hires made so far", () => {
    expect(treeAt(finalTree, events, -1)).toBeNull();
    const early = treeAt(finalTree, events, idx("JobAccepted", 10n))!;
    expect(early.ui).toBe("Accepted");
    expect(early.children).toHaveLength(0);
    const hired = treeAt(finalTree, events, idx("SubJobCreated", 12n))!;
    expect(hired.children.map((c) => c.job.id)).toEqual([11n, 12n]);
    expect(hired.ui).toBe("Subcontracted");
  });
  it("walks the bad hire through challenge to rejection", () => {
    expect(treeAt(finalTree, events, idx("Challenged", 12n))!.children.find((c) => c.job.id === 12n)!.ui).toBe("Challenged");
    expect(treeAt(finalTree, events, idx("JobRejected", 12n))!.children.find((c) => c.job.id === 12n)!.ui).toBe("Rejected");
  });
  it("ends exactly where the chain ends", () => {
    const end = treeAt(finalTree, events, events.length - 1)!;
    expect(end.ui).toBe("Settled");
    expect(end.children.map((c) => `${c.job.id}:${c.ui}`)).toEqual(["11:Settled", "12:Rejected", "13:Settled"]);
  });
  it("maps money events to lines on the map", () => {
    expect(flowOf(events[idx("JobFunded", 10n)]!, 10n)).toEqual({ edge: "payer", direction: "out", kind: "fund" });
    expect(flowOf(events[idx("ChildBudgetReturned", 12n)]!, 10n)).toEqual({ edge: "12", direction: "back", kind: "refund" });
    expect(flowOf(events[idx("PaymentReleased", 13n)]!, 10n)).toEqual({ edge: "13", direction: "out", kind: "pay" });
    expect(flowOf(events[idx("PaymentReleased", 10n)]!, 10n)).toBeNull();
  });
});

describe("ledger from real S2 events", () => {
  it("accounts for every cent of the 0.10 and lists who got it", () => {
    const l = ledgerOf(10n, 100_000n, events);
    expect(l.balanced).toBe(true);
    expect(l.parts.map((p) => `${p.kind}:${p.amount}`).sort()).toEqual(["paid:30000", "paid:30000", "paid:40000"]);
    expect(l.parts.find((p) => p.to === COORD.toLowerCase())?.amount).toBe(30_000n);
    expect(l.stakes).toEqual([
      { to: COORD.toLowerCase(), amount: 20_000n, job: 12n, kind: "slashed" },
      { to: "0x976ea74026e726554db657fa54763abd0c3a0aa9", amount: 4_000n, job: 12n, kind: "challenge" },
    ]);
  });
  it("shows the rest as still held while the tree is open", () => {
    const l = ledgerOf(10n, 100_000n, events.slice(0, idx("PaymentReleased", 11n) + 1));
    expect(l.parts.find((p) => p.kind === "held")?.amount).toBe(70_000n);
    expect(l.balanced).toBe(true);
  });
});
