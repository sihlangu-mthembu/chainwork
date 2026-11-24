/**
 * Re-run a job's check against its output. Used by the watcher (before challenging) and the
 * evaluator (after a challenge), so both apply exactly the same rules.
 */
import type { Address, Hex, PublicClient } from "viem";
import { canonicalJson, hashJson, hashText, parseCanonical } from "./canonical.js";
import {
  MAX_SUMMARY_CHARS,
  buildDataset,
  datasetShapeError,
  fetchTransfers,
  metricsFor,
  type Dataset,
  type JobSpec,
  type Metrics,
  type Pack,
} from "./jobs.js";

export interface VerifyOutputContext {
  pc: PublicClient;
  token: Address;
  jobId: bigint;
  /** Child ids in escrow order: [dataset, metrics] for root jobs. */
  childJobIds: bigint[];
  /** Fetch the exact output bytes a worker serves for a job. */
  fetchOutput(jobId: bigint): Promise<string>;
  /** escrow.childrenRoot(rootId) at verification time. */
  childrenRoot?: Hex;
}

export type VerifyOutputResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): VerifyOutputResult => ({ ok: false, reason });

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export async function verifyOutput(
  spec: JobSpec,
  output: string,
  ctx: VerifyOutputContext,
): Promise<VerifyOutputResult> {
  if (spec.kind === "dataset") return verifyDataset(spec, output, ctx);
  if (spec.kind === "metrics") return verifyMetrics(spec, output, ctx);
  return verifyPack(spec, output, ctx);
}

async function verifyDataset(
  spec: Extract<JobSpec, { kind: "dataset" }>,
  output: string,
  ctx: VerifyOutputContext,
): Promise<VerifyOutputResult> {
  let dataset: Dataset;
  try {
    dataset = parseCanonical<Dataset>(output);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The dataset is not valid canonical JSON.");
  }
  const shape = datasetShapeError(dataset);
  if (shape) return fail(shape);
  if (!same(dataset.subject, spec.subject)) return fail("The dataset is about a different subject.");
  if (!same(dataset.token, spec.token)) return fail("The dataset uses a different token.");
  if (dataset.fromBlock !== spec.fromBlock || dataset.toBlock !== spec.toBlock) {
    return fail("The dataset covers a different block range than the job asked for.");
  }
  let expected: Dataset;
  try {
    const transfers = await fetchTransfers(ctx.pc, {
      subject: spec.subject,
      token: spec.token,
      fromBlock: spec.fromBlock,
      toBlock: spec.toBlock,
    });
    expected = buildDataset(
      { subject: spec.subject, token: spec.token, fromBlock: spec.fromBlock, toBlock: spec.toBlock },
      transfers,
    );
  } catch (e) {
    return fail(`Could not re-fetch the transfer log: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (canonicalJson(dataset) !== canonicalJson(expected)) {
    return fail(
      `The dataset does not match the chain: claimed ${hashJson(dataset)}, chain has ${hashJson(expected)}.`,
    );
  }
  return { ok: true };
}

async function verifyMetrics(
  spec: Extract<JobSpec, { kind: "metrics" }>,
  output: string,
  ctx: VerifyOutputContext,
): Promise<VerifyOutputResult> {
  const datasetJob = ctx.childJobIds[0];
  if (datasetJob === undefined) return fail("This job has no dataset child to recompute metrics from.");
  let dataset: Dataset;
  try {
    dataset = parseCanonical<Dataset>(await ctx.fetchOutput(datasetJob));
  } catch (e) {
    return fail(`The dataset output is unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const shape = datasetShapeError(dataset);
  if (shape) return fail(`The dataset output is invalid: ${shape}`);
  if (!same(dataset.subject, spec.subject)) return fail("The dataset is about a different subject.");

  let claimed: Metrics;
  try {
    claimed = parseCanonical<Metrics>(output);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The metrics output is not canonical JSON.");
  }
  const expected = metricsFor(dataset);
  if (canonicalJson(claimed) !== canonicalJson(expected)) {
    const differing = (Object.keys(expected) as Array<keyof Metrics>).filter(
      (k) => canonicalJson(claimed[k]) !== canonicalJson(expected[k]),
    );
    return fail(`The metrics do not match the dataset (fields: ${differing.join(", ") || "unknown"}).`);
  }
  if (!same(claimed.datasetHash, hashJson(dataset))) {
    return fail("The metrics commit to a different dataset hash.");
  }
  return { ok: true };
}

async function verifyPack(
  spec: Extract<JobSpec, { kind: "pack" }>,
  output: string,
  ctx: VerifyOutputContext,
): Promise<VerifyOutputResult> {
  let pack: Pack;
  try {
    pack = parseCanonical<Pack>(output);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The pack is not canonical JSON.");
  }
  if (pack.v !== 1) return fail("pack.v must be 1.");
  if (!same(pack.subject, spec.subject)) return fail("The pack is about a different subject.");
  if (typeof pack.summary !== "string" || pack.summary.length > MAX_SUMMARY_CHARS) {
    return fail(`The summary must be a string of at most ${MAX_SUMMARY_CHARS} characters.`);
  }

  const [datasetJob, metricsJob] = ctx.childJobIds;
  if (datasetJob === undefined || metricsJob === undefined) {
    return fail("The root has fewer than two children; cannot verify the pack.");
  }
  const [datasetText, metricsText] = await Promise.all([
    ctx.fetchOutput(datasetJob).catch(() => undefined),
    ctx.fetchOutput(metricsJob).catch(() => undefined),
  ]);
  if (datasetText === undefined || metricsText === undefined) {
    return fail("A child output is unavailable; the pack cannot be verified.");
  }
  if (!same(pack.datasetHash, hashText(datasetText))) {
    return fail("pack.datasetHash does not match the dataset child's output.");
  }
  if (!same(pack.metricsHash, hashText(metricsText))) {
    return fail("pack.metricsHash does not match the metrics child's output.");
  }
  if (ctx.childrenRoot && !same(pack.childrenRoot, ctx.childrenRoot)) {
    return fail("pack.childrenRoot does not match escrow.childrenRoot(root) at submit time.");
  }
  return { ok: true };
}

/** The on-chain deliverable is keccak256(utf8(exact output bytes)). */
export const deliverableOf = (output: string): Hex => hashText(output);

export const addressEq = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase();
