import { describe, expect, it } from "vitest";
import type { JobNode, UiJobState } from "@chainwork/types";
import { storyOf } from "../components/TreeStory";

const node = (id: bigint, budget: bigint, ui: UiJobState, provider: string, children: JobNode[] = [], bond = 0n): JobNode =>
  ({
    job: { id, client: "0xc", provider, evaluator: "0xe", description: "", budget, expiredAt: 0n, status: 0, hook: "0x0" },
    ext: { parentId: 0n, depth: 0, openChildren: 0, accepted: true, challenged: false, verifier: "0x0", challengeWindow: 0n, submittedAt: 0n, bond, allocated: 0n, paidToChildren: 0n, verifierSpec: "0x0", deliverable: "0x0", challenger: "0x0", challengeBond: 0n },
    ui,
    children,
  }) as unknown as JobNode;
const names: Record<string, string> = { "0xc": "Client", "0xa": "Coordinator", "0xd": "Data agent", "0xb": "Bad agent", "0xk": "Backup" };
const nameOf = (a: string) => names[a] ?? a;

describe("tree story", () => {
  it("tells the zero-capital re-hire story of S2", () => {
    const tree = node(10n, 100_000n, "Settled", "0xa", [
      node(11n, 30_000n, "Settled", "0xd"),
      node(12n, 40_000n, "Rejected", "0xb"),
      node(13n, 40_000n, "Settled", "0xk"),
    ]);
    const text = storyOf(tree, nameOf).join(" ");
    expect(text).toContain("Client put 0.10 tUSD8 into escrow for job #10");
    expect(text).toContain("without putting up any money of its own, and paid 2 of them 0.07 tUSD8");
    expect(text).toContain("One hire failed the check");
    expect(text).toContain("3 payments released");
  });
  it("mentions the hirer's bond when it posted one, and in-progress work", () => {
    const text = storyOf(node(1n, 100_000n, "Subcontracted", "0xa", [node(2n, 30_000n, "Accepted", "0xd")], 50_000n), nameOf).join(" ");
    expect(text).toContain("after posting a 0.05 tUSD8 bond of its own");
    expect(text).toContain("Work is in progress.");
  });
});
