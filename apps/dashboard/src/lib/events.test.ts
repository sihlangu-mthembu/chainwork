import { describe as suite, expect, it } from "vitest";
import { byChainOrder, describe, jobsOf, type RawEvent } from "./events";

const names: Record<string, string> = { "0xaa": "Coordinator agent", "0xbb": "Data agent", "0xcc": "Watcher" };
const nameOf = (a: string) => names[a.toLowerCase()] ?? `${a.slice(0, 6)}…`;
const ev = (eventName: string, args: Record<string, unknown>, block = 1n, logIndex = 0): RawEvent => ({ eventName, args, blockNumber: block, logIndex, txHash: "0x01" });

suite("timeline events", () => {
  it("names the hire with its budget, paid from escrow", () => {
    const e = describe(ev("SubJobCreated", { parentId: 6n, childId: 7n, provider: "0xbb", budget: 30_000n }), nameOf)!;
    expect(e.text).toBe("#6 hired Data agent as #7 for 0.03 tUSD8, paid from its own escrow");
    expect(e.jobId).toBe(7n);
    expect(jobsOf(ev("SubJobCreated", { parentId: 6n, childId: 7n }))).toEqual([6n, 7n]);
  });
  it("says when no bond was needed and when one was posted", () => {
    expect(describe(ev("JobAccepted", { jobId: 6n, provider: "0xaa", bond: 0n }), nameOf)!.text).toMatch(/no bond needed/);
    expect(describe(ev("JobAccepted", { jobId: 6n, provider: "0xaa", bond: 50_000n }), nameOf)!.text).toMatch(/0.05 tUSD8 bond/);
  });
  it("marks challenges and slashes as bad news, payments as good", () => {
    expect(describe(ev("Challenged", { jobId: 12n, challenger: "0xcc", bond: 4_000n }), nameOf)!.tone).toBe("bad");
    expect(describe(ev("PaymentReleased", { jobId: 7n, provider: "0xbb", amount: 30_000n }), nameOf)!.tone).toBe("good");
  });
  it("drops empty bond returns and unknown events", () => {
    expect(describe(ev("BondReturned", { jobId: 1n, provider: "0xaa", amount: 0n }), nameOf)).toBeNull();
    expect(describe(ev("BudgetSet", { jobId: 1n, amount: 1n }), nameOf)).toBeNull();
  });
  it("orders by block then log index", () => {
    const a = describe(ev("JobCompleted", { jobId: 1n }, 5n, 2), nameOf)!;
    const b = describe(ev("JobCompleted", { jobId: 1n }, 5n, 1), nameOf)!;
    const c = describe(ev("JobCompleted", { jobId: 1n }, 4n, 9), nameOf)!;
    expect([a, b, c].sort(byChainOrder).map((x) => x.logIndex)).toEqual([9, 1, 2]);
  });
});
