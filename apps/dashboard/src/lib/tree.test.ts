// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { JobStatus } from "@chainwork/types";
import type { Hex, Job, JobExt, JobNode } from "@chainwork/types";

const ZERO_32 = ("0x" + "00".repeat(32)) as Hex;
import { flattenTree, summarizeTree } from "./tree";

const A = "0x583BEfc4f5427C1d1d2E366EDAD25568e58154A1" as const;
const B = "0xbE213deEEf489afDf67842F411472Aa90f8f8D77" as const;

const job = (id: bigint, budget: bigint): Job => ({
  id,
  client: B,
  provider: A,
  evaluator: A,
  description: "test",
  budget,
  expiredAt: 1_764_000_000n,
  status: JobStatus.Completed,
  hook: A,
});

const ext = (parentId: bigint, paidToChildren: bigint): JobExt => ({
  parentId,
  depth: parentId > 0n ? 1 : 0,
  openChildren: 0,
  accepted: true,
  challenged: false,
  verifier: A,
  challengeWindow: 60n,
  submittedAt: 1_764_000_000n,
  bond: 0n,
  allocated: 0n,
  paidToChildren,
  verifierSpec: ZERO_32,
  deliverable: ZERO_32,
  challenger: A,
  challengeBond: 0n,
});

const child = (id: bigint, budget: bigint): JobNode => ({
  job: job(id, budget),
  ext: ext(1n, 0n),
  ui: "Settled",
  children: [],
});

const root: JobNode = {
  job: job(1n, 100000n),
  ext: ext(0n, 70000n),
  ui: "Settled",
  children: [child(2n, 30000n), child(3n, 40000n)],
};

describe("flattenTree", () => {
  it("walks root first, then children", () => {
    expect(flattenTree(root).map((node) => node.job.id)).toEqual([1n, 2n, 3n]);
  });

  it("returns a single node for a leaf", () => {
    expect(flattenTree(child(9n, 1n))).toHaveLength(1);
  });
});

describe("summarizeTree", () => {
  it("adds budgets and paid-to-children across the tree", () => {
    const summary = summarizeTree(root);
    expect(summary.nodes).toBe(3);
    expect(summary.totalBudget).toBe(170000n);
    expect(summary.paidToChildren).toBe(70000n);
    expect(summary.counts["Settled"]).toBe(3);
  });

  it("counts mixed states", () => {
    const mixed: JobNode = { ...root, children: [{ ...child(2n, 1n), ui: "Challenged" }] };
    const summary = summarizeTree(mixed);
    expect(summary.counts["Challenged"]).toBe(1);
    expect(summary.counts["Settled"]).toBe(1);
  });
});
