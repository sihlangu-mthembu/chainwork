import { decodeEventLog, type PublicClient } from "viem";
import type { Address, Hex, JobNode, ReceiptLine, TreeReceipt, UiJobState } from "@chainwork/types";
import { JobStatus } from "@chainwork/types";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import type { Chainwork } from "./client.js";
import type { ChainworkConfig } from "./config.js";

/** Map on-chain state to the labels the dashboard and receipts use. */
export function uiState(n: Pick<JobNode, "job" | "ext">, hasChildren: boolean): UiJobState {
  const { job, ext } = n;
  switch (job.status) {
    case JobStatus.Open:
      return "Quoted";
    case JobStatus.Funded:
      if (!ext.accepted) return "Escrowed";
      return hasChildren ? "Subcontracted" : "Accepted";
    case JobStatus.Submitted:
      return ext.challenged ? "Challenged" : "Submitted";
    case JobStatus.Completed:
      return "Settled";
    case JobStatus.Rejected:
      return "Rejected";
    case JobStatus.Expired:
      return "Refunded";
    default:
      return "Escrowed";
  }
}

/** Read a whole tree with eth_call only (no eth_getLogs), so it works past Aevum's 1,000-block log cap. */
export async function readTree(cw: Chainwork, rootId: bigint): Promise<JobNode> {
  const [job, ext, kids] = await Promise.all([cw.getJob(rootId), cw.getJobExt(rootId), cw.getChildren(rootId)]);
  const children = await Promise.all(
    kids.map(async (id) => {
      const [cj, ce] = await Promise.all([cw.getJob(id), cw.getJobExt(id)]);
      const node: JobNode = { job: cj, ext: ce, ui: "Escrowed", children: [] };
      node.ui = uiState(node, false);
      return node;
    }),
  );
  const root: JobNode = { job, ext, ui: "Escrowed", children };
  root.ui = uiState(root, kids.length > 0);
  return root;
}

/** eth_getLogs in chunks no larger than cfg.logChunk (default 500; Aevum rejects > 1,000). */
export async function getEscrowLogsChunked(
  pc: PublicClient,
  cfg: ChainworkConfig,
  fromBlock: bigint,
  toBlock?: bigint,
) {
  const chunk = cfg.logChunk ?? 500n;
  const end = toBlock ?? (await pc.getBlockNumber());
  const out = [];
  for (let start = fromBlock; start <= end; start += chunk) {
    const stop = start + chunk - 1n > end ? end : start + chunk - 1n;
    out.push(...(await pc.getLogs({ address: cfg.escrow, fromBlock: start, toBlock: stop })));
  }
  return out;
}

const OUTCOME: Record<string, ReceiptLine["outcome"]> = {
  PaymentReleased: "paid",
  Refunded: "refunded",
  BondReturned: "bond-returned",
  BondSlashed: "bond-slashed",
  ChallengeBondSettled: "challenge-bond",
};

/** Build a verifiable receipt for a settled tree: every money movement with its tx hash. */
export async function buildReceipt(
  cw: Chainwork,
  rootId: bigint,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<TreeReceipt> {
  const tree = await readTree(cw, rootId);
  const ids = new Set([rootId, ...tree.children.map((c) => c.job.id)]);
  const parentOf = new Map<bigint, bigint | null>([[rootId, null]]);
  for (const c of tree.children) parentOf.set(c.job.id, rootId);
  const logs = await getEscrowLogsChunked(cw.publicClient, cw.cfg, fromBlock, toBlock);
  const lines: ReceiptLine[] = [];
  for (const log of logs) {
    let ev;
    try {
      ev = decodeEventLog({ abi: chainworkEscrowImplAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const outcome = OUTCOME[ev.eventName];
    if (!outcome) continue;
    const a = ev.args as unknown as { jobId: bigint; amount: bigint } & Record<string, Address>;
    if (!ids.has(a.jobId)) continue;
    const who = (a.provider ?? a.client ?? a.to) as Address;
    lines.push({
      jobId: a.jobId.toString(),
      parentId: parentOf.get(a.jobId)?.toString() ?? null,
      provider: who,
      amount: a.amount.toString(),
      outcome,
      txHash: log.transactionHash as Hex,
    });
  }
  return {
    rootId: rootId.toString(),
    client: tree.job.client,
    totalFunded: tree.job.budget.toString(),
    lines,
    generatedAt: new Date().toISOString(),
  };
}
