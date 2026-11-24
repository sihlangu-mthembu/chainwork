/**
 * SPDX-License-Identifier: MIT
 * Tree helpers: flattening a JobNode tree and summarising it for the panel header.
 */
import type { JobNode, UiJobState } from "@chainwork/types";

export function flattenTree(node: JobNode): JobNode[] {
  const out: JobNode[] = [node];
  for (const child of node.children) out.push(...flattenTree(child));
  return out;
}

export interface TreeSummary {
  nodes: number;
  totalBudget: bigint;
  paidToChildren: bigint;
  counts: Partial<Record<UiJobState, number>>;
}

export function summarizeTree(node: JobNode): TreeSummary {
  const nodes = flattenTree(node);
  let totalBudget = 0n;
  let paidToChildren = 0n;
  const counts: Partial<Record<UiJobState, number>> = {};
  for (const entry of nodes) {
    totalBudget += entry.job.budget;
    paidToChildren += entry.ext.paidToChildren;
    counts[entry.ui] = (counts[entry.ui] ?? 0) + 1;
  }
  return { nodes: nodes.length, totalBudget, paidToChildren, counts };
}
