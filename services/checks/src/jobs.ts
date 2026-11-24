/**
 * The demo job: counterparty due diligence (docs/DEMO_SCENARIOS.md).
 * Every deliverable is recomputable from the chain, which is what lets watchers and evaluators
 * check work without trusting the worker.
 */
import { getAddress, isAddress, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { canonicalJson, hashJson } from "./canonical.js";

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// ------------------------------------------------------------------- dataset

export interface DatasetTransfer {
  /** block number */
  b: number;
  /** log index inside the block */
  i: number;
  from: Address;
  to: Address;
  /** base units, decimal string */
  value: string;
}

export interface Dataset {
  v: 1;
  subject: Address;
  token: Address;
  fromBlock: number;
  toBlock: number;
  transfers: DatasetTransfer[];
}

export interface TransferQuery {
  subject: Address;
  token: Address;
  fromBlock: number;
  toBlock: number;
}

/**
 * Every tUSD8 Transfer involving `subject` in [fromBlock, toBlock], sorted by block then log index.
 * Pages in <= 500-block chunks: Aevum rejects eth_getLogs ranges over 1,000 blocks.
 */
export async function fetchTransfers(
  pc: PublicClient,
  query: TransferQuery,
  chunk = 500,
): Promise<DatasetTransfer[]> {
  if (query.toBlock < query.fromBlock) throw new Error("toBlock must be at least fromBlock.");
  if (chunk < 1 || chunk > 1000) throw new Error("Log chunks must be between 1 and 1,000 blocks.");
  const subject = query.subject.toLowerCase();
  const out: DatasetTransfer[] = [];
  for (let start = query.fromBlock; start <= query.toBlock; start += chunk) {
    const stop = Math.min(start + chunk - 1, query.toBlock);
    const logs = await pc.getLogs({
      address: query.token,
      event: TRANSFER_EVENT,
      fromBlock: BigInt(start),
      toBlock: BigInt(stop),
    });
    for (const log of logs) {
      const args = log.args as { from?: Address; to?: Address; value?: bigint };
      if (!args.from || !args.to || args.value === undefined) continue;
      const from = args.from.toLowerCase();
      const to = args.to.toLowerCase();
      if (from !== subject && to !== subject) continue;
      out.push({
        b: Number(log.blockNumber ?? 0n),
        i: Number(log.logIndex ?? 0),
        from: args.from.toLowerCase() as Address,
        to: args.to.toLowerCase() as Address,
        value: args.value.toString(),
      });
    }
  }
  out.sort((a, b) => (a.b === b.b ? a.i - b.i : a.b - b.b));
  return out;
}

export function buildDataset(query: TransferQuery, transfers: DatasetTransfer[]): Dataset {
  const sorted = [...transfers].sort((a, b) => (a.b === b.b ? a.i - b.i : a.b - b.b));
  return {
    v: 1,
    subject: query.subject.toLowerCase() as Address,
    token: query.token.toLowerCase() as Address,
    fromBlock: query.fromBlock,
    toBlock: query.toBlock,
    transfers: sorted.map((t) => ({
      b: t.b,
      i: t.i,
      from: t.from.toLowerCase() as Address,
      to: t.to.toLowerCase() as Address,
      value: t.value,
    })),
  };
}

export function datasetShapeError(d: Dataset): string | undefined {
  if (d.v !== 1) return "dataset.v must be 1";
  if (!isAddress(d.subject) || !isAddress(d.token)) return "dataset subject/token must be addresses";
  if (!Number.isInteger(d.fromBlock) || !Number.isInteger(d.toBlock) || d.fromBlock < 0 || d.toBlock < d.fromBlock) {
    return "dataset block range is invalid";
  }
  if (!Array.isArray(d.transfers)) return "dataset.transfers must be an array";
  for (const t of d.transfers) {
    if (!Number.isInteger(t.b) || !Number.isInteger(t.i)) return "transfer b/i must be integers";
    if (!isAddress(t.from) || !isAddress(t.to)) return "transfer addresses are invalid";
    if (!/^\d+$/.test(t.value)) return "transfer value must be a decimal string";
  }
  return undefined;
}

// ------------------------------------------------------------------- metrics

export interface Metrics {
  v: 1;
  count: number;
  counterparties: number;
  datasetHash: Hex;
  flags: string[];
  inflow: string;
  largest: string;
  outflow: string;
  topCounterpartyShareBps: number;
}

export function metricsFor(dataset: Dataset): Metrics {
  const subject = dataset.subject.toLowerCase();
  let inflow = 0n;
  let outflow = 0n;
  let largest = 0n;
  const volume = new Map<string, bigint>();
  const others = new Set<string>();

  for (const t of dataset.transfers) {
    const value = BigInt(t.value);
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (to === subject) inflow += value;
    if (from === subject) outflow += value;
    const other = from === subject ? to : from;
    others.add(other);
    volume.set(other, (volume.get(other) ?? 0n) + value);
    if (value > largest) largest = value;
  }

  const total = inflow + outflow;
  let maxVolume = 0n;
  for (const v of volume.values()) if (v > maxVolume) maxVolume = v;
  const topCounterpartyShareBps = total > 0n ? Number((maxVolume * 10_000n) / total) : 0;

  const flags: string[] = [];
  if (topCounterpartyShareBps > 5000) flags.push("CONCENTRATED");
  if (dataset.transfers.length < 3) flags.push("THIN_HISTORY");
  if (largest * 2n > total) flags.push("LARGE_SINGLE");
  flags.sort();

  return {
    v: 1,
    count: dataset.transfers.length,
    counterparties: others.size,
    datasetHash: hashJson(dataset),
    flags,
    inflow: inflow.toString(),
    largest: largest.toString(),
    outflow: outflow.toString(),
    topCounterpartyShareBps,
  };
}

/** Parameters are fixed so a metrics document cannot be reinterpreted by a checker. */
export function metricsFromOutput(text: string): Metrics {
  return JSON.parse(text) as Metrics;
}

// ---------------------------------------------------------------------- pack

export interface Pack {
  v: 1;
  childrenRoot: Hex;
  datasetHash: Hex;
  metricsHash: Hex;
  subject: Address;
  summary: string;
}

export interface PackInput {
  subject: Address;
  childrenRoot: Hex;
  datasetHash: Hex;
  metricsHash: Hex;
  summary: string;
}

export const MAX_SUMMARY_CHARS = 600;

export function buildPack(input: PackInput): Pack {
  if (input.summary.length > MAX_SUMMARY_CHARS) {
    throw new Error(`The summary must be at most ${MAX_SUMMARY_CHARS} characters.`);
  }
  return {
    v: 1,
    childrenRoot: input.childrenRoot,
    datasetHash: input.datasetHash,
    metricsHash: input.metricsHash,
    subject: getAddress(input.subject),
    summary: input.summary,
  };
}

// ------------------------------------------------------------------ job spec

export type JobSpec =
  | { v: 1; kind: "dataset"; subject: Address; token: Address; fromBlock: number; toBlock: number }
  | { v: 1; kind: "metrics"; subject: Address }
  | { v: 1; kind: "pack"; subject: Address };

export const jobSpecDescription = (spec: JobSpec): string => canonicalJson(spec);

/** Job descriptions are canonical JSON specs; human text would not be checkable by a watcher. */
export function parseJobSpec(description: string): JobSpec | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(description);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.kind !== "string" || typeof o.subject !== "string" || !isAddress(o.subject)) return undefined;
  const subject = getAddress(o.subject);
  if (o.kind === "dataset") {
    if (typeof o.token !== "string" || !isAddress(o.token)) return undefined;
    if (!Number.isInteger(o.fromBlock) || !Number.isInteger(o.toBlock)) return undefined;
    const fromBlock = o.fromBlock as number;
    const toBlock = o.toBlock as number;
    if (fromBlock < 0 || toBlock < fromBlock) return undefined;
    return { v: 1, kind: "dataset", subject, token: getAddress(o.token), fromBlock, toBlock };
  }
  if (o.kind === "metrics") return { v: 1, kind: "metrics", subject };
  if (o.kind === "pack") return { v: 1, kind: "pack", subject };
  return undefined;
}

export function describeJob(description: string): string {
  const spec = parseJobSpec(description);
  if (!spec) return description.slice(0, 120);
  if (spec.kind === "dataset") return `tUSD8 history for ${spec.subject} in blocks ${spec.fromBlock}–${spec.toBlock}`;
  if (spec.kind === "metrics") return `risk metrics for ${spec.subject}`;
  return `due-diligence pack for ${spec.subject}`;
}
