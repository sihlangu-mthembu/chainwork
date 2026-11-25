/**
 * Deterministic work functions for the demo agents. The LLM may choose whom to hire and what to
 * write in the summary, but the parts a watcher re-checks are computed here, in code.
 */
import { zeroHash, type Address } from "viem";
import {
  buildDataset,
  buildPack,
  canonicalJson,
  fetchTransfers,
  hashText,
  jobSpecDescription,
  metricsFor,
  parseJobSpec,
  type Dataset,
  type JobSpec,
  type Metrics,
} from "@chainwork/checks";
import { JobStatus } from "@chainwork/types";
import { buildSubTerms, toUnits, type Chainwork, type ChainworkConfig } from "@chainwork/sdk";
import type { Logger, ServiceConfig } from "@chainwork/service-kit";

export type WorkKind = "dataset" | "metrics" | "pack" | "coordinator" | "echo";

export interface WorkJob {
  jobId: bigint;
  description: string;
  parentId: bigint;
  provider: Address;
}

export type WorkFn = (job: WorkJob) => Promise<string>;

export interface WorkDeps {
  kind: WorkKind;
  cw: Chainwork;
  config: ServiceConfig;
  logger?: Logger;
  /** provider address (lowercase) → base URL */
  workerUrls: Record<string, string>;
  /** Make metrics wrong on purpose (specialist-bad in scenario S2). */
  bad?: boolean;
  summary?: string;
  /** Coordinator only: who to subcontract the two children to. */
  specialists?: { data?: Address; metrics?: Address; fallback?: Address };
  pollMs?: number;
  timeoutMs?: number;
}

export { parseWorkerUrls } from "@chainwork/service-kit";

export const urlForProvider = (provider: Address, urls: Record<string, string>): string => {
  const url = urls[provider.toLowerCase()];
  if (!url) throw new Error(`No worker URL registered for provider ${provider}. Set WORKER_URLS.`);
  return url;
};

async function fetchText(url: string, timeoutMs = 5_000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChildJob {
  id: bigint;
  description: string;
  spec: JobSpec;
  provider: Address;
  status: JobStatus;
  deliverable: `0x${string}`;
}

async function childrenOf(cw: Chainwork, parentId: bigint): Promise<ChildJob[]> {
  const ids = await cw.getChildren(parentId);
  return Promise.all(
    ids.map(async (id) => {
      const [job, ext] = await Promise.all([cw.getJob(id), cw.getJobExt(id)]);
      const spec = parseJobSpec(job.description);
      if (!spec) throw new Error(`Child ${id} has no checkable job spec.`);
      return {
        id,
        description: job.description,
        spec,
        provider: job.provider,
        status: job.status,
        deliverable: ext.deliverable,
      };
    }),
  );
}

async function outputOf(child: ChildJob, deps: WorkDeps): Promise<string> {
  return fetchText(`${urlForProvider(child.provider, deps.workerUrls)}/jobs/${child.id}/output`);
}

/** Wait until a predicate over the parent's children is true, then return them. */
async function waitForChildren(
  deps: WorkDeps,
  parentId: bigint,
  predicate: (children: ChildJob[]) => boolean,
  what: string,
): Promise<ChildJob[]> {
  const deadline = Date.now() + (deps.timeoutMs ?? 120_000);
  const pollMs = deps.pollMs ?? 1_000;
  for (;;) {
    const children = await childrenOf(deps.cw, parentId);
    if (predicate(children)) return children;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await sleep(pollMs);
  }
}

const datasetChild = (children: ChildJob[]): ChildJob | undefined =>
  children.find((c) => c.spec.kind === "dataset");

const bestMetricsChild = (children: ChildJob[]): ChildJob | undefined => {
  const metrics = children.filter((c) => c.spec.kind === "metrics");
  return metrics.find((c) => c.status === JobStatus.Completed) ?? metrics.reverse().find((c) => c.status !== JobStatus.Rejected);
};

export function makeWork(deps: WorkDeps): WorkFn {
  if (deps.kind === "dataset") return (job) => datasetWork(job, deps);
  if (deps.kind === "metrics") return (job) => metricsWork(job, deps);
  if (deps.kind === "pack") return (job) => packWork(job, deps);
  if (deps.kind === "coordinator") return (job) => coordinatorWork(job, deps);
  return async (job) => canonicalJson({ jobId: job.jobId.toString(), v: 1 });
}

async function datasetWork(job: WorkJob, deps: WorkDeps): Promise<string> {
  const spec = parseJobSpec(job.description);
  if (!spec || spec.kind !== "dataset") throw new Error("This worker only handles dataset jobs.");
  const transfers = await fetchTransfers(deps.config.publicClient, {
    subject: spec.subject,
    token: spec.token,
    fromBlock: spec.fromBlock,
    toBlock: spec.toBlock,
  });
  const dataset = buildDataset(
    { subject: spec.subject, token: spec.token, fromBlock: spec.fromBlock, toBlock: spec.toBlock },
    transfers,
  );
  deps.logger?.info("work.dataset", { jobId: job.jobId.toString(), transfers: dataset.transfers.length });
  return canonicalJson(dataset);
}

async function metricsWork(job: WorkJob, deps: WorkDeps): Promise<string> {
  const spec = parseJobSpec(job.description);
  if (!spec || spec.kind !== "metrics") throw new Error("This worker only handles metrics jobs.");
  const children = await waitForChildren(
    deps,
    job.parentId === 0n ? job.jobId : job.parentId,
    (kids) => {
      const dataset = datasetChild(kids);
      return dataset !== undefined && dataset.deliverable !== zeroHash;
    },
    "the dataset child to be submitted",
  );
  // For a root-level metrics job the coordinator passes the root id as parent; for a child job the
  // parent is the root. Either way, look at the tree that contains the dataset.
  const dataset = datasetChild(children);
  if (!dataset) throw new Error("No dataset child found to compute metrics from.");
  const datasetText = await outputOf(dataset, deps);
  const datasetJson = JSON.parse(datasetText) as Dataset;
  let metrics: Metrics = metricsFor(datasetJson);
  if (deps.bad) {
    // Hallucination mode: plausible-looking numbers that do not match the dataset.
    metrics = { ...metrics, inflow: (BigInt(metrics.inflow) * 2n).toString(), flags: [] };
  }
  deps.logger?.info("work.metrics", { jobId: job.jobId.toString(), bad: deps.bad === true });
  return canonicalJson(metrics);
}

/**
 * Coordinator: carve the two children out of the root's escrowed budget, wait for them to settle,
 * then assemble the pack. In S2 the first metrics worker is specialist-bad; once its child is
 * rejected the coordinator hires the backup and waits again.
 */
/**
 * First block of a dataset job: the deployment block, and never more than 20,000 blocks back
 * (~5.5 h on Aevum), so three readers (worker, watcher, evaluator) page at most 40 chunks each.
 */
export function datasetFrom(deployedAtBlock: number | undefined, latest: number): number {
  return Math.max(deployedAtBlock ?? 0, latest - 20_000, 0);
}

async function coordinatorWork(job: WorkJob, deps: WorkDeps): Promise<string> {
  const spec = parseJobSpec(job.description);
  if (!spec || spec.kind !== "pack") throw new Error("The coordinator only handles pack jobs.");
  const root = await deps.cw.getJob(job.jobId);
  const specialists = deps.specialists ?? {};
  if (!specialists.data || !specialists.metrics) throw new Error("Set the specialist provider addresses for the coordinator.");

  const childExpiry = root.expiredAt - 60n;
  const latest = Number(await deps.config.publicClient.getBlockNumber({ cacheTime: 0 }));
  const existing = await childrenOf(deps.cw, job.jobId);
  if (existing.length === 0) {
    const datasetSpec = {
      v: 1,
      kind: "dataset",
      subject: spec.subject,
      token: deps.config.cfg.token,
      fromBlock: datasetFrom(deps.config.deployment.deployedAtBlock, latest),
      toBlock: latest,
    } as const;
    await deps.cw.subcontract(
      job.jobId,
      buildSubTerms({
        provider: specialists.data,
        evaluator: root.evaluator,
        budget: toUnits("0.03"),
        expiredAt: childExpiry,
        challengeWindow: 30,
      }),
      jobSpecDescription(datasetSpec),
    );
    await deps.cw.subcontract(
      job.jobId,
      buildSubTerms({
        provider: specialists.metrics,
        evaluator: root.evaluator,
        budget: toUnits("0.04"),
        expiredAt: childExpiry,
        challengeWindow: 30,
      }),
      jobSpecDescription({ v: 1, kind: "metrics", subject: spec.subject }),
    );
    deps.logger?.info("coordinator.subcontracted", { root: job.jobId.toString(), data: specialists.data, metrics: specialists.metrics });
  }

  const deadline = Date.now() + (deps.timeoutMs ?? 180_000);
  let fallbackHired = false;
  for (;;) {
    const children = await childrenOf(deps.cw, job.jobId);
    const dataset = datasetChild(children);
    const completedMetrics = children.filter((c) => c.spec.kind === "metrics" && c.status === JobStatus.Completed);
    const rejectedMetrics = children.some((c) => c.spec.kind === "metrics" && c.status === JobStatus.Rejected);
    if (dataset && dataset.status === JobStatus.Completed && completedMetrics.length > 0) break;
    if (rejectedMetrics && specialists.fallback && !fallbackHired) {
      await deps.cw.subcontract(
        job.jobId,
        buildSubTerms({
          provider: specialists.fallback,
          evaluator: root.evaluator,
          budget: toUnits("0.04"),
          expiredAt: childExpiry,
          challengeWindow: 30,
        }),
        jobSpecDescription({ v: 1, kind: "metrics", subject: spec.subject }),
      );
      fallbackHired = true;
      deps.logger?.warn("coordinator.rehired", { root: job.jobId.toString(), fallback: specialists.fallback });
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for the children to settle.");
    await sleep(deps.pollMs ?? 2_000);
  }

  const children = await childrenOf(deps.cw, job.jobId);
  const dataset = datasetChild(children);
  const metrics = bestMetricsChild(children);
  if (!dataset || !metrics) throw new Error("The root needs a completed dataset and metrics child.");
  const [datasetText, metricsText, childrenRoot] = await Promise.all([
    outputOf(dataset, deps),
    outputOf(metrics, deps),
    deps.cw.childrenRoot(job.jobId),
  ]);
  const metricsJson = JSON.parse(metricsText) as Metrics;
  const summary =
    deps.summary ??
    `Due diligence for ${spec.subject}: ${metricsJson.count} transfers, inflow ${metricsJson.inflow}, outflow ${metricsJson.outflow}, ${metricsJson.counterparties} counterparties.`;
  return canonicalJson(
    buildPack({
      subject: spec.subject,
      childrenRoot,
      datasetHash: hashText(datasetText),
      metricsHash: hashText(metricsText),
      summary,
    }),
  );
}

async function packWork(job: WorkJob, deps: WorkDeps): Promise<string> {
  const spec = parseJobSpec(job.description);
  if (!spec || spec.kind !== "pack") throw new Error("This worker only handles pack jobs.");
  const children = await waitForChildren(
    deps,
    job.jobId,
    (kids) => {
      const dataset = datasetChild(kids);
      const metrics = bestMetricsChild(kids);
      const done = (c: ChildJob | undefined) => c !== undefined && c.status === JobStatus.Completed;
      return done(dataset) && done(metrics);
    },
    "both children to settle",
  );
  const dataset = datasetChild(children);
  const metrics = bestMetricsChild(children);
  if (!dataset || !metrics) throw new Error("The root needs a dataset child and a completed metrics child.");

  const [datasetText, metricsText, childrenRoot] = await Promise.all([
    outputOf(dataset, deps),
    outputOf(metrics, deps),
    deps.cw.childrenRoot(job.jobId),
  ]);
  const metricsJson = JSON.parse(metricsText) as Metrics;
  const summary =
    deps.summary ??
    `Due diligence for ${spec.subject}: ${metricsJson.count} transfers, inflow ${metricsJson.inflow}, outflow ${metricsJson.outflow}, ${metricsJson.counterparties} counterparties.`;
  const pack = buildPack({
    subject: spec.subject,
    childrenRoot,
    datasetHash: hashText(datasetText),
    metricsHash: hashText(metricsText),
    summary,
  });
  deps.logger?.info("work.pack", { jobId: job.jobId.toString(), childrenRoot });
  return canonicalJson(pack);
}

export type { ChainworkConfig };
