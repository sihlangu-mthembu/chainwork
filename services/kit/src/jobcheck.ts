/**
 * The one job check the watcher and the evaluator both run. It compares the worker's served bytes
 * with the submitted deliverable, then re-runs the job's content check from the job spec.
 */
import type { Address } from "viem";
import { hashText, parseJobSpec, verifyOutput, type JobSpec } from "@chainwork/checks";
import { JobStatus } from "@chainwork/types";
import type { Chainwork, ChainworkConfig } from "@chainwork/sdk";

export interface JobCheckSuccess {
  ok: true;
  reason: string;
  output: string;
  spec?: JobSpec;
}

export interface JobCheckFailure {
  ok: false;
  reason: string;
  /** The worker could not be reached or did not serve its output (as opposed to a wrong output). */
  unavailable?: boolean;
  output?: string;
  spec?: JobSpec;
}

export type JobCheck = JobCheckSuccess | JobCheckFailure;

export interface CheckJobDeps {
  cw: Chainwork;
  cfg: ChainworkConfig;
  /** provider address (lowercase) → base URL */
  workerUrls: Record<string, string>;
  timeoutMs?: number;
}

async function fetchText(url: string, timeoutMs = 5_000): Promise<string> {
  // A worker answers 425 for the second between its submit landing and it recording that: retry.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return res.text();
    if ((res.status === 425 || res.status === 503) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
}

const outputUrl = (base: string, jobId: bigint): string => `${base.replace(/\/$/, "")}/jobs/${jobId}/output`;

const urlFor = (provider: Address, urls: Record<string, string>): string => {
  const url = urls[provider.toLowerCase()];
  if (!url) throw new Error(`No worker URL registered for provider ${provider}.`);
  return url;
};

interface ChildInfo {
  id: bigint;
  spec: JobSpec | undefined;
  status: JobStatus;
  provider: Address;
}

async function children(cw: Chainwork, parentId: bigint): Promise<ChildInfo[]> {
  const ids = await cw.getChildren(parentId);
  return Promise.all(
    ids.map(async (id) => {
      const [job, ext] = await Promise.all([cw.getJob(id), cw.getJobExt(id)]);
      return { id, spec: parseJobSpec(job.description), status: job.status, provider: job.provider };
    }),
  );
}

const datasetOf = (kids: ChildInfo[]): ChildInfo | undefined => kids.find((k) => k.spec?.kind === "dataset");

/** Prefer the completed metrics child; a rejected one is the failure the coordinator is replacing. */
const metricsOf = (kids: ChildInfo[]): ChildInfo | undefined => {
  const candidates = kids.filter((k) => k.spec?.kind === "metrics" && k.status !== JobStatus.Rejected);
  return (
    candidates.find((k) => k.status === JobStatus.Completed) ??
    candidates.find((k) => k.status === JobStatus.Submitted) ??
    candidates[candidates.length - 1]
  );
};

export async function checkJob(deps: CheckJobDeps, jobId: bigint): Promise<JobCheck> {
  const { cw, cfg, workerUrls } = deps;
  const job = await cw.getJob(jobId);
  const ext = await cw.getJobExt(jobId);
  if (job.status !== JobStatus.Submitted) return { ok: false, reason: `Job ${jobId} is not Submitted.` };
  if (ext.deliverable === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return { ok: false, reason: "The job has no deliverable." };
  }

  let output: string;
  try {
    output = await fetchText(outputUrl(urlFor(job.provider, workerUrls), jobId), deps.timeoutMs);
  } catch (e) {
    return {
      ok: false,
      unavailable: true,
      reason: `The worker did not serve the output: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const spec = parseJobSpec(job.description);
  const committed = hashText(output);
  if (committed.toLowerCase() !== ext.deliverable.toLowerCase()) {
    return { ok: false, reason: "The served output does not match the submitted deliverable hash.", output, spec };
  }
  if (!spec) return { ok: true, reason: "No machine-checkable job spec; the hash matches.", output };

  const siblings = ext.parentId === 0n ? await children(cw, jobId) : await children(cw, ext.parentId);
  const dataset = datasetOf(siblings);
  const metrics = metricsOf(siblings);
  const childJobIds: bigint[] =
    spec.kind === "metrics" ? (dataset ? [dataset.id] : []) : spec.kind === "pack" ? [dataset?.id, metrics?.id].filter((v): v is bigint => v !== undefined) : [];

  const fetchOutput = async (childId: bigint): Promise<string> => {
    const child = await cw.getJob(childId);
    return fetchText(outputUrl(urlFor(child.provider, workerUrls), childId), deps.timeoutMs);
  };
  const childrenRoot = spec.kind === "pack" ? await cw.childrenRoot(jobId) : undefined;

  try {
    const result = await verifyOutput(spec, output, {
      pc: cw.publicClient,
      token: cfg.token,
      jobId,
      childJobIds,
      fetchOutput,
      childrenRoot,
    });
    return result.ok ? { ok: true, reason: "Output matches the job spec.", output, spec } : { ok: false, reason: result.reason, output, spec };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), output, spec };
  }
}
