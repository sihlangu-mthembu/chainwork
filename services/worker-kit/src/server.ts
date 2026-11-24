/**
 * x402 escrow worker template:
 *   POST /jobs            → 402 PAYMENT-REQUIRED quote, or the funded job with PAYMENT-SIGNATURE
 *   GET  /jobs/:id/output → the exact bytes whose keccak256 the provider submitted
 *
 * The worker never holds the client's money: settlement goes through the facilitator into escrow.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { isAddressEqual, zeroAddress, zeroHash, type Address } from "viem";
import type { EscrowPaymentPayload, EscrowSettleResponse } from "@chainwork/types";
import { JobStatus } from "@chainwork/types";
import { chainworkEscrowImplAbi } from "@chainwork/types/abis";
import { chainworkFor, postJson, retry, type Logger, type ServiceConfig } from "@chainwork/service-kit";
import { buildEscrowQuote, toUnits } from "@chainwork/service-kit";
import { hashText } from "@chainwork/checks";
import type { Chainwork } from "@chainwork/sdk";
import type { WorkFn, WorkKind } from "./work.js";
import { WorkerStore } from "./store.js";

export const PAYMENT_HEADERS = {
  required: "PAYMENT-REQUIRED",
  signature: "PAYMENT-SIGNATURE",
  response: "PAYMENT-RESPONSE",
} as const;

export type SettleFn = (
  payload: EscrowPaymentPayload,
  description: string,
) => Promise<EscrowSettleResponse & { errorMessage?: string }>;

export interface WorkerAppDeps {
  config: ServiceConfig;
  store: WorkerStore;
  work: WorkFn;
  kind: WorkKind;
  /** Price for this worker's output, base units. */
  price?: bigint;
  evaluator: Address;
  provider?: Address;
  publicUrl?: string;
  challengeWindow?: number;
  expiresIn?: number;
  logger?: Logger;
  /** Pick up Funded jobs assigned to this provider on chain (how subcontracted agents get work). */
  autoAccept?: boolean;
  /** Injectable for tests; defaults to POST {facilitator}/escrow/fund. */
  settle?: SettleFn;
}

const base64 = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const cors = (reply: FastifyReply): FastifyReply =>
  reply
    .header("access-control-allow-origin", "*")
    .header("access-control-expose-headers", `${PAYMENT_HEADERS.required}, ${PAYMENT_HEADERS.response}`)
    .header("access-control-allow-headers", `content-type, ${PAYMENT_HEADERS.signature}`)
    .header("vary", "origin");

const defaultSettle = (config: ServiceConfig): SettleFn => (payload) => {
  if (!config.cfg.facilitatorUrl) throw new Error("No facilitator URL configured (FACILITATOR_URL).");
  // Retries are safe: the facilitator is idempotent per terms hash.
  return retry(
    "facilitator settle",
    () =>
      postJson<EscrowSettleResponse & { errorMessage?: string }>(`${config.cfg.facilitatorUrl}/escrow/fund`, payload, {
        timeoutMs: 60_000,
      }),
    { attempts: 4, baseMs: 500 },
  );
};

export function buildWorkerApp(deps: WorkerAppDeps): FastifyInstance {
  const cw = chainworkFor(deps.config);
  const settle = deps.settle ?? defaultSettle(deps.config);
  const provider = deps.provider ?? deps.config.relayer.address;
  const publicUrl = (deps.publicUrl ?? "http://localhost:4100").replace(/\/$/, "");
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const running = new Map<string, Promise<void>>();
  const challengeWindow = deps.challengeWindow ?? 60;

  const describePrice = deps.price ?? toUnits("0.03");

  app.get("/health", async () => ({
    ok: true,
    service: deps.kind,
    provider,
    price: describePrice.toString(),
    publicUrl,
  }));

  app.options("/*", async (_req, reply) => cors(reply).status(204).send());

  app.post("/jobs", async (req, reply) => {
    cors(reply);
    const body = (req.body ?? {}) as { description?: unknown };
    const description = typeof body.description === "string" ? body.description : "";
    if (!description) return reply.status(400).send({ error: "Send {description} with the job spec." });

    const signatureHeader = req.headers[PAYMENT_HEADERS.signature.toLowerCase()];
    if (!signatureHeader || Array.isArray(signatureHeader)) {
      let quote;
      try {
        quote = await buildEscrowQuote(cw, deps.config.cfg, {
          provider,
          evaluator: deps.evaluator,
          budget: describePrice,
          description,
          resource: `${publicUrl}/jobs`,
          expiresIn: deps.expiresIn ?? 1800,
          challengeWindow,
        });
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
      }
      const paymentRequired = {
        x402Version: 2,
        error: "PAYMENT-SIGNATURE header is required",
        resource: { url: `${publicUrl}/jobs`, description },
        accepts: [quote],
      };
      return reply
        .status(402)
        .header(PAYMENT_HEADERS.required, base64(paymentRequired))
        .send(paymentRequired);
    }

    let payload: EscrowPaymentPayload;
    try {
      payload = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8")) as EscrowPaymentPayload;
    } catch {
      return reply.status(400).send({ error: "PAYMENT-SIGNATURE is not base64 JSON." });
    }
    if (payload.payload?.client === undefined) {
      return reply.status(400).send({ error: "The payment payload has no client." });
    }

    let settled: EscrowSettleResponse & { errorMessage?: string; alreadySettled?: boolean };
    try {
      settled = await settle(payload, description);
    } catch (e) {
      return reply.status(502).send({ error: `Facilitator unreachable: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!settled.success || !settled.jobId) {
      const error = settled.errorMessage ?? settled.errorReason ?? "The facilitator rejected the payment.";
      return reply
        .status(402)
        .header(PAYMENT_HEADERS.response, base64(settled))
        .send({ error, ...settled });
    }

    const jobId = settled.jobId;
    const existing = deps.store.job(jobId);
    if (existing && existing.status !== "error") {
      return reply
        .status(202)
        .header(PAYMENT_HEADERS.response, base64(settled))
        .send({ jobId, status: existing.status, duplicate: true });
    }

    if (running.has(jobId)) {
      return reply
        .status(202)
        .header(PAYMENT_HEADERS.response, base64(settled))
        .send({ jobId, status: "accepted", duplicate: true });
    }
    // Reserve the job before any await so the auto-accept scan can't start it too.
    let release!: () => void;
    running.set(jobId, new Promise<void>((r) => (release = r)));
    try {
      const job = await cw.getJob(BigInt(jobId));
      if (!isAddressEqual(job.provider, provider)) {
        running.delete(jobId);
        release();
        return reply.status(403).send({ error: `Job ${jobId} is not assigned to this worker.` });
      }
      const ext = await cw.getJobExt(BigInt(jobId));
      if (!ext.accepted) {
        await cw.accept(BigInt(jobId));
      }
    } catch (e) {
      running.delete(jobId);
      release();
      deps.logger?.error("worker.accept-failed", { jobId, error: e instanceof Error ? e.message : String(e) });
      return reply.status(502).send({ error: `Could not accept job ${jobId}: ${e instanceof Error ? e.message : String(e)}` });
    }

    deps.store.setJob(jobId, description, "accepted");
    const task = runJob(cw, deps, jobId, description, provider).finally(() => {
      running.delete(jobId);
      release();
    });
    running.set(jobId, task);

    return reply
      .status(202)
      .header(PAYMENT_HEADERS.response, base64(settled))
      .send({ jobId, status: "accepted", price: describePrice.toString() });
  });

  app.get("/jobs/:id/output", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const output = deps.store.output(id);
    if (!output) return reply.status(404).send({ error: "No output for that job yet." });
    // Serve only once the hash is on chain, so readers can always check bytes against the job.
    let onChain = deps.store.job(id)?.status === "submitted";
    if (!onChain && /^\d+$/.test(id)) {
      const ext = await cw.getJobExt(BigInt(id)).catch(() => undefined);
      onChain = ext !== undefined && ext.deliverable.toLowerCase() === output.hash.toLowerCase();
    }
    if (!onChain) {
      return reply.status(425).header("retry-after", "1").send({ error: "Output is being submitted; try again shortly." });
    }
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("x-chainwork-deliverable", output.hash)
      .send(output.body);
  });

  app.get("/jobs/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    return deps.store.job(id) ?? { jobId: id, status: "unknown" };
  });

  if (deps.autoAccept) {
    const scan = async () => {
      try {
        const ids = await assignedFunded(cw, provider);
        const fresh = ids.filter((id) => !running.has(id.toString()) && !DONE.has(deps.store.job(id.toString())?.status ?? ""));
        if (fresh.length > 0) deps.logger?.debug?.("worker.scan", { provider, jobs: fresh.map((id) => id.toString()) });
        for (const jobId of fresh) {
          const key = jobId.toString();
          // Reserve the job before any await, so an overlapping scan or a paid POST can't start it twice.
          let release!: () => void;
          running.set(key, new Promise<void>((r) => (release = r)));
          try {
            const job = await cw.getJob(jobId);
            const ext = await cw.getJobExt(jobId);
            if (job.status !== JobStatus.Funded || ext.deliverable !== zeroHash) {
              running.delete(key);
              release();
              continue;
            }
            if (!ext.accepted) await cw.accept(jobId);
            deps.store.setJob(key, job.description, "accepted");
            const task = runJob(cw, deps, key, job.description, provider).finally(() => {
              running.delete(key);
              release();
            });
            running.set(key, task);
            deps.logger?.info("worker.auto-accepted", { jobId: key });
          } catch (e) {
            running.delete(key);
            release();
            // One expired or already-accepted job must not stop the whole scan.
            deps.logger?.warn("worker.auto-accept-failed", {
              jobId: jobId.toString(),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } catch (e) {
        deps.logger?.warn("worker.auto-accept-error", { error: e instanceof Error ? e.message : String(e) });
      }
    };
    const timer = setInterval(() => void scan(), 2_500);
    app.addHook("onClose", async () => clearInterval(timer));
    void scan();
  }

  return app;
}

/** Worker states after which a job never needs to be started again. */
const DONE = new Set(["working", "submitted"]);

async function assignedFunded(cw: Chainwork, provider: Address): Promise<bigint[]> {
  const out: bigint[] = [];
  let cursor = 1n;
  const now = Number((await cw.publicClient.getBlock({ blockTag: "pending" })).timestamp);
  for (let page = 0; page < 100; page++) {
    const [jobs, , next] = (await cw.publicClient.readContract({
      address: cw.cfg.escrow,
      abi: chainworkEscrowImplAbi,
      functionName: "getJobsPage",
      args: [cursor, 100n],
    })) as unknown as [
      Array<{ id: bigint; status: JobStatus; provider: Address; expiredAt: bigint }>,
      unknown[],
      bigint,
    ];
    for (const job of jobs) {
      if (job.status !== JobStatus.Funded || !isAddressEqual(job.provider, provider)) continue;
      // Expired jobs can no longer be accepted; leave them to claimRefund.
      if (job.expiredAt <= BigInt(now)) continue;
      out.push(job.id);
    }
    if (next === 0n) break;
    cursor = next;
  }
  return out;
}

async function runJob(
  cw: Chainwork,
  deps: WorkerAppDeps,
  jobId: string,
  description: string,
  provider: Address,
): Promise<void> {
  const id = BigInt(jobId);
  try {
    deps.store.setJob(jobId, description, "working");
    const ext = await cw.getJobExt(id);
    const output = await deps.work({ jobId: id, description, parentId: ext.parentId, provider });
    const deliverable = hashText(output);
    deps.store.putOutput(jobId, output, deliverable);
    const job = await cw.getJob(id);
    if (job.status !== JobStatus.Funded) {
      deps.logger?.warn("worker.job-not-funded", { jobId, status: job.status });
      deps.store.setJob(jobId, description, "error", `Job is ${JobStatus[job.status]}, cannot submit.`);
      return;
    }
    if (ext.verifier !== zeroAddress && ext.verifierSpec.toLowerCase() === deliverable.toLowerCase()) {
      await cw.submitWithProof(id, deliverable, "0x");
    } else {
      await cw.submit(id, deliverable);
    }
    deps.store.setJob(jobId, description, "submitted");
    deps.logger?.info("worker.submitted", { jobId, deliverable });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.store.setJob(jobId, description, "error", message);
    deps.logger?.error("worker.failed", { jobId, error: message });
  }
}
